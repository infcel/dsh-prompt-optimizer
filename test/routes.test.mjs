import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers, pickModel, validateOptimize } from '../index.js';

// --- 测试替身 ---------------------------------------------------------------

class FakeResponse {
	constructor() {
		this.status = null;
		this.headers = null;
		this.chunks = [];
		this.writableEnded = false;
		this.destroyed = false;
		this.listeners = new Map();
	}
	writeHead(status, headers) {
		this.status = status;
		this.headers = headers;
	}
	write(chunk) {
		this.chunks.push(chunk);
		return true;
	}
	end(chunk) {
		if (chunk) this.chunks.push(chunk);
		this.writableEnded = true;
	}
	on(event, listener) {
		if (!this.listeners.has(event)) this.listeners.set(event, []);
		this.listeners.get(event).push(listener);
	}
	removeListener(event, listener) {
		const list = this.listeners.get(event) ?? [];
		this.listeners.set(event, list.filter((item) => item !== listener));
	}
	body() {
		return this.chunks.join('');
	}
}

function fakeRequest(method, body) {
	const json = body === undefined ? '' : JSON.stringify(body);
	return {
		method,
		async *[Symbol.asyncIterator]() {
			if (json) yield Buffer.from(json);
		},
	};
}

function makeCtx({ llm, selection } = {}) {
	const services = {
		connection: { requestRejection: () => undefined },
		agentDefaultModel: { currentSelection: () => selection ?? null },
	};
	if (llm) services.llm = llm;
	return {
		get(name) {
			return services[name];
		},
	};
}

function streamingLlm(chunks) {
	return {
		async listProviders() {
			return ['deepseek'];
		},
		listModels() {
			return [{ id: 'deepseek-v3', displayName: 'DeepSeek-V3' }];
		},
		stream() {
			return (async function* generate() {
				for (const chunk of chunks) yield chunk;
			})();
		},
	};
}

// --- 模型选择 ---------------------------------------------------------------

test('pickModel：会话默认 provider/model 都在 → session-default', async () => {
	const model = await pickModel({
		selection: { provider: 'p', model: 'm2' },
		providerIds: ['p'],
		modelsFor: () => [{ id: 'm1' }, { id: 'm2' }],
	});
	assert.deepEqual(model, { provider: 'p', model: 'm2', label: 'm2', source: 'session-default' });
});

test('pickModel：会话 provider 有、model 不在 → provider-first-model', async () => {
	const model = await pickModel({
		selection: { provider: 'p', model: 'gone' },
		providerIds: ['p', 'q'],
		modelsFor: (provider) => (provider === 'p' ? [{ id: 'm1' }] : [{ id: 'q1' }]),
	});
	assert.equal(model.provider, 'p');
	assert.equal(model.model, 'm1');
	assert.equal(model.source, 'provider-first-model');
});

test('pickModel：会话 provider 取不到模型 → first-provider', async () => {
	const model = await pickModel({
		selection: { provider: 'gone' },
		providerIds: ['gone', 'q'],
		modelsFor: (provider) => (provider === 'gone' ? [] : [{ id: 'q1', displayName: 'Q1' }]),
	});
	assert.deepEqual(model, { provider: 'q', model: 'q1', label: 'Q1', source: 'first-provider' });
});

test('pickModel：全都取不到 → null', async () => {
	const model = await pickModel({
		selection: null,
		providerIds: ['p'],
		modelsFor: () => {
			throw new Error('boom');
		},
	});
	assert.equal(model, null);
});

// --- 校验 -------------------------------------------------------------------

test('validateOptimize：正常值通过并归一化语言', () => {
	assert.deepEqual(validateOptimize({ mode: 'concise', prompt: ' 嗨 ', language: 'xx' }), {
		mode: 'concise',
		prompt: ' 嗨 ',
		instruction: '',
		language: 'auto',
	});
});

test('validateOptimize：空草稿 / 坏模式 / 迭代无指令 / 超长', () => {
	assert.throws(() => validateOptimize({ prompt: '  ' }), (error) => error.code === 'EMPTY_PROMPT' && error.status === 400);
	assert.throws(() => validateOptimize({ mode: 'nope', prompt: 'x' }), (error) => error.code === 'BAD_MODE');
	assert.throws(() => validateOptimize({ mode: 'iterate', prompt: 'x' }), (error) => error.code === 'MISSING_INSTRUCTION');
	assert.throws(
		() => validateOptimize({ prompt: 'x'.repeat(20001) }),
		(error) => error.code === 'PROMPT_TOO_LONG' && error.status === 413,
	);
});

// --- /meta ------------------------------------------------------------------

test('meta：有模型时给出 label 与来源', async () => {
	const handlers = createHandlers(makeCtx({ llm: streamingLlm([]), selection: { provider: 'deepseek', model: 'deepseek-v3' } }));
	const response = new FakeResponse();
	await handlers.meta(fakeRequest('GET'), response);
	const body = JSON.parse(response.body());
	assert.equal(response.status, 200);
	assert.deepEqual(body.model, { provider: 'deepseek', model: 'deepseek-v3', label: 'DeepSeek-V3' });
	assert.equal(body.modelSource, 'session-default');
	assert.equal(body.limits.maxChars, 20000);
});

test('meta：宿主没有 llm 时仍 200，但 model=null（供浮层降级）', async () => {
	const handlers = createHandlers(makeCtx({}));
	const response = new FakeResponse();
	await handlers.meta(fakeRequest('GET'), response);
	const body = JSON.parse(response.body());
	assert.equal(response.status, 200);
	assert.equal(body.model, null);
	assert.equal(body.modelSource, 'unavailable');
});

// --- /classify --------------------------------------------------------------

test('classify：auto 返回与 /optimize 同一套规则的结果', async () => {
	const handlers = createHandlers(makeCtx({}));
	const response = new FakeResponse();
	await handlers.classify(fakeRequest('POST', { mode: 'auto', prompt: '帮我看下这段代码' }), response);
	assert.deepEqual(JSON.parse(response.body()), { ok: true, resolvedMode: 'concise' });
});

test('classify：坏 JSON → 400', async () => {
	const handlers = createHandlers(makeCtx({}));
	const response = new FakeResponse();
	const request = {
		method: 'POST',
		async *[Symbol.asyncIterator]() {
			yield Buffer.from('{oops');
		},
	};
	await handlers.classify(request, response);
	assert.equal(response.status, 400);
	assert.equal(JSON.parse(response.body()).error.code, 'BAD_JSON');
});

// --- /optimize --------------------------------------------------------------

test('optimize：流式回传 start/delta/done，并检出丢掉的变量', async () => {
	const llm = streamingLlm([
		{ type: 'text-delta', index: 0, text: '关于' },
		{ type: 'text-delta', index: 0, text: ' {{topic}} 的报告' },
		{ type: 'usage', usage: { inputTokens: 620, outputTokens: 12 } },
		{ type: 'finish', reason: { kind: 'stop' } },
	]);
	const handlers = createHandlers(makeCtx({ llm, selection: { provider: 'deepseek', model: 'deepseek-v3' } }));
	const response = new FakeResponse();
	await handlers.optimize(
		fakeRequest('POST', { mode: 'concise', prompt: '写一个 {{topic}} 的 {{n}} 段报告' }),
		response,
	);

	assert.equal(response.status, 200);
	assert.match(response.headers['content-type'], /text\/event-stream/);
	const frames = response.body().split('\n\n').filter(Boolean);
	const events = frames.map((raw) => JSON.parse(raw.split('data: ')[1]));
	assert.equal(events[0].resolvedMode, 'concise');
	assert.equal(events[0].model, 'DeepSeek-V3');
	const done = events.at(-1);
	assert.equal(done.chars, '关于 {{topic}} 的报告'.length);
	assert.deepEqual(done.missingVariables, ['n']);
	assert.deepEqual(done.usage, { input: 620, output: 12 });
});

test('optimize：宿主没有 llm → 503 LLM_UNAVAILABLE', async () => {
	const handlers = createHandlers(makeCtx({}));
	const response = new FakeResponse();
	await handlers.optimize(fakeRequest('POST', { prompt: '你好' }), response);
	assert.equal(response.status, 503);
	assert.equal(JSON.parse(response.body()).error.code, 'LLM_UNAVAILABLE');
});

test('optimize：上游 finish 报错 → error 事件带中文文案', async () => {
	const llm = streamingLlm([
		{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429' } } },
	]);
	const handlers = createHandlers(makeCtx({ llm }));
	const response = new FakeResponse();
	await handlers.optimize(fakeRequest('POST', { prompt: '你好' }), response);
	const events = response.body().split('\n\n').filter(Boolean).map((raw) => JSON.parse(raw.split('data: ')[1]));
	assert.equal(events.at(-1).code, 'RATE_LIMIT');
	assert.match(events.at(-1).message, /限流/);
});

test('optimize：GET → 405，并带 allow 头', async () => {
	const handlers = createHandlers(makeCtx({ llm: streamingLlm([]) }));
	const response = new FakeResponse();
	await handlers.optimize(fakeRequest('GET'), response);
	assert.equal(response.status, 405);
	assert.equal(response.headers.allow, 'POST');
});

test('optimize：认证被拒 → 原样回状态码与文案', async () => {
	const ctx = makeCtx({ llm: streamingLlm([]) });
	ctx.get = () => ({ requestRejection: () => 403 });
	const handlers = createHandlers(ctx);
	const response = new FakeResponse();
	await handlers.optimize(fakeRequest('POST', { prompt: '你好' }), response);
	assert.equal(response.status, 403);
	assert.equal(JSON.parse(response.body()).error.code, 'REJECTED');
});
