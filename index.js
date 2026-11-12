/**
 * Host 半边：三个 exact 路由。
 *
 *   POST /api/dsh-prompt-optimizer/optimize   text/event-stream
 *   GET  /api/dsh-prompt-optimizer/meta       application/json
 *   POST /api/dsh-prompt-optimizer/classify   application/json
 *
 * 认证复用宿主 `connection.requestRejection`（与 dsh-plugin-patches 同款），
 * 不新开端口、不改监听地址。模型走 `llm` + `agentDefaultModel`，不落盘、不记正文。
 */
import { buildMessages } from './lib/templates.js';
import { LANGUAGES, MODES, REQUEST_MODES, missingVariables, resolveMode } from './lib/heuristic.js';
import { frame, headers as sseHeaders, jsonHeaders } from './lib/sse.js';

export const inject = ['webServer'];

const BASE = '/api/dsh-prompt-optimizer';

/** 三个路由路径，测试与 Client 共用。 */
export const ROUTES = Object.freeze({
	optimize: `${BASE}/optimize`,
	meta: `${BASE}/meta`,
	classify: `${BASE}/classify`,
});

/** 与设计 §6.2 对齐的上限；`/meta` 会把 maxChars 告诉客户端做预检。 */
export const LIMITS = Object.freeze({
	maxChars: 20000,
	maxInstruction: 500,
	maxBody: 128 * 1024,
	maxTokens: 4096,
	temperature: 0.4,
});

const FAILURE_TEXT = {
	NO_ADAPTER: '当前宿主没有可用的模型适配器',
	MISSING_CREDENTIAL: '模型服务还没有配置凭据',
	INVALID_CREDENTIAL: '模型服务凭据无效',
	AUTH: '模型服务鉴权失败',
	RATE_LIMIT: '模型服务限流了，稍后再试',
	QUOTA: '模型额度不足',
	ACCOUNT_QUOTA: '账户额度不足',
	CONTEXT_WINDOW_EXCEEDED: '草稿超出了模型的上下文窗口',
	ABORTED: '已取消',
};

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------

function sendJson(response, status, body) {
	if (response.writableEnded) return;
	response.writeHead(status, jsonHeaders());
	response.end(JSON.stringify(body));
}

function sendError(response, status, code, message) {
	sendJson(response, status, { ok: false, error: { code, message } });
}

/** 读 JSON body：超限 413、坏 JSON 400、非对象 400。 */
async function readJsonBody(request) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > LIMITS.maxBody) throw Object.assign(new Error('body too large'), { code: 'BODY_TOO_LONG' });
		chunks.push(chunk);
	}
	const raw = Buffer.concat(chunks).toString('utf8');
	if (!raw.trim()) return {};
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw Object.assign(new Error('malformed json'), { code: 'BAD_JSON' });
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw Object.assign(new Error('body must be an object'), { code: 'BAD_JSON' });
	}
	return parsed;
}

// ---------------------------------------------------------------------------
// 模型选择：设计 §6.2 的四步回落链
// ---------------------------------------------------------------------------

/** provider 可能是字符串、`{ id | name }` 描述符，或会话选择的 `{ provider }`。 */
export function providerId(value) {
	if (typeof value === 'string') return value;
	return value?.provider ?? value?.id ?? value?.name ?? null;
}

/** 模型条目同理，另外带一个给人看的 label。 */
export function modelId(value) {
	if (typeof value === 'string') return value;
	return value?.id ?? value?.model ?? value?.name ?? null;
}

/** 模型条目同理；`LlmModelInfo` 的展示名在 `name`，不是 displayName。 */
export function modelLabel(value) {
	if (typeof value === 'string') return value;
	return value?.displayName ?? value?.label ?? value?.name ?? modelId(value);
}

/**
 * 四步回落链，纯函数（`modelsFor` 由调用方注入，便于单测）：
 * ① 会话默认 provider + 同名 model；② 会话默认 provider + 它第一个 model；
 * ③ 第一个 provider 的第一个 model；④ 都没有 → null。
 */
export async function pickModel({ selection, providerIds, modelsFor }) {
	const ids = [...new Set((providerIds ?? []).map(providerId).filter(Boolean))];
	const models = async (provider) => {
		try {
			const list = await modelsFor(provider);
			return Array.isArray(list) ? list.filter((entry) => modelId(entry)) : [];
		} catch {
			return [];
		}
	};

	const preferred = providerId(selection);
	if (preferred) {
		const list = await models(preferred);
		const wanted = typeof selection?.model === 'string' ? selection.model : modelId(selection?.model);
		const exact = wanted ? list.find((entry) => modelId(entry) === wanted) : undefined;
		if (exact) {
			return { provider: preferred, model: modelId(exact), label: modelLabel(exact), source: 'session-default' };
		}
		if (list[0]) {
			return { provider: preferred, model: modelId(list[0]), label: modelLabel(list[0]), source: 'provider-first-model' };
		}
	}

	for (const provider of ids) {
		if (provider === preferred) continue;
		const list = await models(provider);
		if (list[0]) {
			return { provider, model: modelId(list[0]), label: modelLabel(list[0]), source: 'first-provider' };
		}
	}

	return null;
}

/** 从 ctx 里拿服务并解析模型；任何一步缺失都返回 null，由调用方转 503。 */
export async function resolveModel(ctx) {
	let llm;
	try {
		llm = ctx.get('llm');
	} catch {
		llm = undefined;
	}
	if (!llm || typeof llm.stream !== 'function') return null;

	let providers = [];
	try {
		providers = (await llm.listProviders?.()) ?? [];
	} catch {
		providers = [];
	}

	let selection = null;
	try {
		selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null;
	} catch {
		selection = null;
	}

	const model = await pickModel({
		selection,
		providerIds: providers,
		modelsFor: (provider) => llm.listModels?.(provider) ?? [],
	});
	return model ? { ...model, llm } : null;
}

// ---------------------------------------------------------------------------
// 参数校验
// ---------------------------------------------------------------------------

/** 校验 /optimize 的 body；返回归一化后的请求或抛 {status, code, message}。 */
export function validateOptimize(body) {
	const fail = (status, code, message) => {
		throw Object.assign(new Error(message), { status, code });
	};

	const mode = typeof body.mode === 'string' ? body.mode : 'auto';
	if (!REQUEST_MODES.includes(mode)) fail(400, 'BAD_MODE', '模式无效');

	const prompt = typeof body.prompt === 'string' ? body.prompt : '';
	if (!prompt.trim()) fail(400, 'EMPTY_PROMPT', '先写点内容');
	if (prompt.length > LIMITS.maxChars) fail(413, 'PROMPT_TOO_LONG', '草稿超过 2 万字，先分段优化');

	const language = LANGUAGES.includes(body.language) ? body.language : 'auto';

	let instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
	if (mode === 'iterate') {
		if (!instruction) fail(400, 'MISSING_INSTRUCTION', '先写迭代指令');
		if (instruction.length > LIMITS.maxInstruction) fail(400, 'INSTRUCTION_TOO_LONG', '迭代指令太长了');
	} else {
		instruction = '';
	}

	return { mode, prompt, instruction, language };
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

/** 认证 + 方法检查；通过返回 true。 */
function guard(ctx, request, response) {
	let connection;
	try {
		connection = ctx.get('connection');
	} catch {
		connection = undefined;
	}
	if (typeof connection?.requestRejection !== 'function') {
		sendError(response, 503, 'GUARD_UNAVAILABLE', '宿主认证服务暂不可用。');
		return false;
	}
	const rejection = connection.requestRejection(request);
	if (rejection === undefined) return true;
	sendError(response, rejection, 'REJECTED', rejection === 401 ? '请先登录 DSH。' : '已拒绝不可信或跨站请求。');
	return false;
}

function methodAllowed(request, response, allowed) {
	if (allowed.includes(request.method)) return true;
	response.writeHead(405, { allow: allowed.join(', ') });
	response.end();
	return false;
}

/** 建三个 handler；`ctx` 只需提供 `get`，单测里传假对象即可。 */
export function createHandlers(ctx) {
	async function meta(request, response) {
		if (!guard(ctx, request, response)) return;
		if (!methodAllowed(request, response, ['GET'])) return;
		let model = null;
		try {
			model = await resolveModel(ctx);
		} catch {
			model = null;
		}
		sendJson(response, 200, {
			ok: true,
			model: model ? { provider: model.provider, model: model.model, label: model.label } : null,
			modelSource: model?.source ?? 'unavailable',
			limits: { maxChars: LIMITS.maxChars, maxInstruction: LIMITS.maxInstruction },
			modes: MODES,
			languages: LANGUAGES,
		});
	}

	async function classify(request, response) {
		if (!guard(ctx, request, response)) return;
		if (!methodAllowed(request, response, ['POST'])) return;
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			if (error.code === 'BODY_TOO_LONG') return sendError(response, 413, 'BODY_TOO_LONG', '请求体过大');
			return sendError(response, 400, 'BAD_JSON', '请求体不是合法 JSON');
		}
		const prompt = typeof body.prompt === 'string' ? body.prompt : '';
		const mode = typeof body.mode === 'string' ? body.mode : 'auto';
		sendJson(response, 200, { ok: true, resolvedMode: resolveMode(mode, prompt) });
	}

	async function optimize(request, response) {
		if (!guard(ctx, request, response)) return;
		if (!methodAllowed(request, response, ['POST'])) return;

		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			if (error.code === 'BODY_TOO_LONG') return sendError(response, 413, 'PROMPT_TOO_LONG', '草稿超过 2 万字，先分段优化');
			return sendError(response, 400, 'BAD_JSON', '请求体不是合法 JSON');
		}

		let input;
		try {
			input = validateOptimize(body);
		} catch (error) {
			return sendError(response, error.status ?? 400, error.code ?? 'BAD_REQUEST', error.message);
		}

		const model = await resolveModel(ctx).catch(() => null);
		if (!model) {
			return sendError(response, 503, 'LLM_UNAVAILABLE', '当前宿主未提供模型服务');
		}

		let payload;
		try {
			payload = buildMessages({ ...input, mode: resolveMode(input.mode, input.prompt) });
		} catch {
			payload = null;
		}
		if (!payload) return sendError(response, 500, 'TEMPLATE_ERROR', '模板构造失败');
		const resolvedMode = resolveMode(input.mode, input.prompt);

		response.writeHead(200, sseHeaders());
		const write = (event, data) => {
			if (response.writableEnded || response.destroyed) return false;
			try {
				response.write(frame(event, data));
				return true;
			} catch {
				return false;
			}
		};

		write('start', { resolvedMode, model: model.label, modelSource: model.source });

		const controller = new AbortController();
		const onClose = () => controller.abort();
		response.on('close', onClose);

		const startedAt = Date.now();
		let text = '';
		let usage = null;
		let reason = null;

		try {
			const stream = model.llm.stream({
				provider: model.provider,
				model: model.model,
				system: payload.system,
				messages: payload.messages,
				temperature: LIMITS.temperature,
				maxTokens: LIMITS.maxTokens,
				signal: controller.signal,
			});
			for await (const chunk of stream) {
				if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
					text += chunk.text;
					write('delta', { text: chunk.text });
				} else if (chunk?.type === 'usage') {
					usage = chunk.usage ?? null;
				} else if (chunk?.type === 'finish') {
					reason = chunk.reason ?? null;
				}
			}
		} catch (error) {
			const code = error?.code === 'ABORTED' ? 'ABORTED' : 'UPSTREAM_ERROR';
			write('error', { code, message: code === 'ABORTED' ? '已取消' : String(error?.message ?? error) });
		} finally {
			response.removeListener('close', onClose);
		}

		const aborted = controller.signal.aborted || reason?.kind === 'aborted';

		if (!aborted && reason?.kind === 'error') {
			const failure = reason.failure ?? {};
			const code = typeof failure.code === 'string' ? failure.code : 'UPSTREAM_ERROR';
			write('error', { code, message: FAILURE_TEXT[code] ?? String(failure.message ?? '模型返回失败') });
		} else if (aborted) {
			write('error', { code: 'ABORTED', message: '已取消' });
		} else {
			write('done', {
				chars: text.length,
				missingVariables: missingVariables(input.prompt, text),
				usage: usage
					? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
					: null,
				elapsedMs: Date.now() - startedAt,
			});
		}

		if (!response.writableEnded) response.end();
	}

	return { meta, classify, optimize };
}

/** Host 入口：注册路由，全部交给 ctx.effect 回收。 */
export function apply(ctx) {
	const webServer = ctx.get('webServer');
	if (typeof webServer?.register !== 'function') return;
	const handlers = createHandlers(ctx);
	const disposers = [
		webServer.register({ kind: 'exact', path: ROUTES.meta, handler: handlers.meta }),
		webServer.register({ kind: 'exact', path: ROUTES.classify, handler: handlers.classify }),
		webServer.register({ kind: 'exact', path: ROUTES.optimize, handler: handlers.optimize }),
	];
	ctx.effect(() => () => disposers.forEach((dispose) => dispose?.()));
}
