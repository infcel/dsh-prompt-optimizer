window.__ModuleLoader__.load({
	id: '@infcel/dsh-prompt-optimizer',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'prompt-optimizer';
		const ROUTE = '/api/dsh-prompt-optimizer';
		const SLOT_BUTTON = 'conversation.input.right';
		const SLOT_PANEL = 'conversation.input.overlay';
		const PREFS_KEY = 'dsh.prompt-optimizer.prefs';
		const TOAST_MS = 4000;
		// 主修饰键：菜单栏是 ⌘，Windows/Linux 是 Ctrl。客户端插件跑在浏览器里，
		// 用 navigator 判定即可；测试环境没有 navigator 时退回 Ctrl，保证不抛错。
		const IS_MAC =
			typeof navigator !== 'undefined' &&
			/Mac|iPhone|iPad|iPod/i.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
		const REPLACE_KEY = IS_MAC ? '⌘↵' : 'Ctrl+↵';

		// ---------------------------------------------------------------- i18n
		// 字典内联在客户端：插件的 locale/*.json 只服务插件管理页的标题与简介，
		// 组件文案必须随 bundle 一起到浏览器，靠 require 拿不到相对路径文件。
		const DICT = {
			zh: {
				button: '优化',
				buttonTitle: '把草稿改写成更清晰的提示词',
				title: '提示词优化',
				close: '关闭',
				auto: '自动',
				structured: '结构化',
				analytical: '分析式',
				concise: '精修',
				iterate: '迭代',
				resolved: '已识别',
				language: '输出语言',
				langAuto: '跟随原文',
				langZh: '中文',
				langEn: 'English',
				defaultModel: '默认模型',
				noModel: '模型未就绪',
				preparing: '正在分析提示词…',
				stop: '停止',
				empty: '草稿是空的，先写一句再优化。',
				instruction: '这次怎么改？',
				instructionPlaceholder: '例如：再短一点，保留变量，加一个「不做」清单',
				error: '优化失败',
				tooLong: (n, max) => `草稿 ${n} 字，超过 ${max} 上限，先分段优化`,
				retry: '重试',
				copyOriginal: '复制原文',
				conflict: '草稿已变动，不能直接替换',
				conflictHint: '优化期间你改了输入框的内容。',
				overwrite: '覆盖为新结果',
				cancel: '取消',
				applied: '已替换草稿',
				appliedHint: (undo) => `一次可撤销的编辑，${undo} 可还原。`,
				undo: '撤销',
				reoptimize: '重新优化',
				copy: '复制',
				copied: '已复制',
				replace: '替换草稿',
				reexpand: '展开',
				collapse: '收起',
				chars: '字',
				vars: '变量',
				varsKept: '全部保留',
				varsLost: '丢失',
				elapsed: '耗时',
				tokens: 'tokens',
				unavailable: '当前宿主未提供模型服务',
				unavailableHint: '按钮可用，打开后会说明原因。',
				unavailableBody: '在设置里选一个可用模型，或稍后重试。',
				streamBroken: '连接中断，已保留已生成的部分',
				failedGeneric: '请求失败，请重试',
				wholeDraft: '含 @ 引用，按整段优化',
				modelInfo: (label) => `默认模型 · ${label}`,
				varCount: (n) => `${n} 个`,
			},
			en: {
				button: 'Optimize',
				buttonTitle: 'Rewrite the draft into a clearer prompt',
				title: 'Prompt optimizer',
				close: 'Close',
				auto: 'Auto',
				structured: 'Structured',
				analytical: 'Analytical',
				concise: 'Polish',
				iterate: 'Iterate',
				resolved: 'Detected',
				language: 'Language',
				langAuto: 'Match source',
				langZh: 'Chinese',
				langEn: 'English',
				defaultModel: 'Default model',
				noModel: 'Model unavailable',
				preparing: 'Reading the prompt…',
				stop: 'Stop',
				empty: 'The draft is empty. Write something first.',
				instruction: 'What should change?',
				instructionPlaceholder: 'e.g. shorter, keep variables, add a "don\'t" list',
				error: 'Optimization failed',
				tooLong: (n, max) => `Draft is ${n} characters; the limit is ${max}. Optimize it in parts.`,
				retry: 'Retry',
				copyOriginal: 'Copy original',
				conflict: 'Draft changed, cannot replace',
				conflictHint: 'You edited the composer while this ran.',
				overwrite: 'Overwrite with result',
				cancel: 'Cancel',
				applied: 'Draft replaced',
				appliedHint: (undo) => `One undoable edit — ${undo} restores it.`,
				undo: 'Undo',
				reoptimize: 'Run again',
				copy: 'Copy',
				copied: 'Copied',
				replace: 'Replace draft',
				reexpand: 'Expand',
				collapse: 'Collapse',
				chars: 'chars',
				vars: 'variables',
				varsKept: 'all kept',
				varsLost: 'missing',
				elapsed: 'elapsed',
				tokens: 'tokens',
				unavailable: 'The host exposes no model service',
				unavailableHint: 'The button opens and explains why.',
				unavailableBody: 'Pick a usable model in Settings, or retry later.',
				streamBroken: 'Stream broke; partial text was kept',
				failedGeneric: 'Request failed, retry',
				wholeDraft: 'Contains @ references — optimizes the whole draft',
				modelInfo: (label) => `Default model · ${label}`,
				varCount: (n) => `${n}`,
			},
		};

		let locale = 'zh';

		/**
		 * locale 服务给的是一份快照（{active, locales, revision}），不是字符串。
		 * 支持 en-US / zh-CN 这类带区域的 id，未知语言一律回落中文。
		 */
		const pickLocale = (snapshot) => {
			const raw = typeof snapshot === 'string' ? snapshot : snapshot?.active;
			const base = typeof raw === 'string' ? raw.toLowerCase().split(/[-_]/)[0] : '';
			return base === 'en' ? 'en' : 'zh';
		};

		const t = (key, ...args) => {
			const dict = DICT[locale] ?? DICT.zh;
			const value = dict[key] ?? DICT.zh[key] ?? key;
			return typeof value === 'function' ? value(...args) : value;
		};

		// --------------------------------------------------------------- store
		// 单例 store：按钮与浮层是两个注册项，必须共享同一份状态。
		// 用不可变快照 + useSyncExternalStore，避免就地 mutate 导致 React 不重渲染。
		let state = {
			open: false,
			mode: 'auto',
			language: 'auto',
			resolvedMode: null,
			status: 'idle', // idle | preparing | streaming | done | error | conflict | unavailable
			text: '',
			draft: '',
			span: null,
			whole: false,
			instruction: '',
			error: null,
			usage: null,
			elapsedMs: 0,
			missing: [],
			chars: 0,
			meta: null,
			modelLabel: null,
			toast: null,
		};
		const listeners = new Set();
		const getState = () => state;
		const subscribe = (fn) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		};
		const patch = (next) => {
			state = { ...state, ...next };
			for (const fn of listeners) fn();
		};

		const useStore = (selector) =>
			React.useSyncExternalStore(
				subscribe,
				() => (selector ? selector(state) : state),
				() => (selector ? selector(state) : state),
			);

		// ------------------------------------------------------------- helpers
		let runId = 0;
		let controller = null;
		const instructionRef = { current: null };
		let toastTimer = null;

		const readPrefs = () => {
			try {
				const raw = window.localStorage.getItem(PREFS_KEY);
				if (!raw) return null;
				const parsed = JSON.parse(raw);
				return parsed && typeof parsed === 'object' ? parsed : null;
			} catch {
				return null;
			}
		};

		const writePrefs = (next) => {
			try {
				window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
			} catch {
				// 隐私模式或配额满：偏好丢失不影响功能。
			}
		};

		let prefsLoaded = false;
		const loadPrefs = () => {
			if (prefsLoaded) return;
			prefsLoaded = true;
			const prefs = readPrefs();
			if (!prefs) return;
			const mode = ['auto', 'structured', 'analytical', 'concise', 'iterate'].includes(prefs.mode)
				? prefs.mode
				: 'auto';
			const language = ['auto', 'zh', 'en'].includes(prefs.language) ? prefs.language : 'auto';
			patch({ mode, language });
		};

		const savePrefs = () => writePrefs({ mode: state.mode, language: state.language });

		const metaPromise = { current: null };
		const loadMeta = () => {
			if (metaPromise.current) return metaPromise.current;
			metaPromise.current = fetch(`${ROUTE}/meta`, { cache: 'no-store', credentials: 'same-origin' })
				.then((res) => (res.ok ? res.json() : null))
				.then((body) => {
					if (!body || body.ok !== true) {
						patch({ meta: { model: null }, modelLabel: null });
						return null;
					}
					patch({
						meta: body,
						modelLabel: body.model ? body.model.label ?? body.model.model : null,
					});
					return body;
				})
				.catch(() => {
					patch({ meta: { model: null }, modelLabel: null });
					return null;
				});
			return metaPromise.current;
		};

		const showToast = (text) => {
			patch({ toast: { text, at: Date.now() } });
			if (toastTimer) window.clearTimeout(toastTimer);
			toastTimer = window.setTimeout(() => {
				toastTimer = null;
				patch({ toast: null });
			}, TOAST_MS);
		};

		/** 把 SSE 文本流解析成完整帧；每 1 字节切一刀也必须得到同样结果。 */
		function createFrameParser(onEvent) {
			let buffer = '';
			const flush = (raw) => {
				let event = 'message';
				const data = [];
				for (const line of raw.split('\n')) {
					if (line === '' || line.startsWith(':')) continue;
					const colon = line.indexOf(':');
					const field = colon === -1 ? line : line.slice(0, colon);
					let value = colon === -1 ? '' : line.slice(colon + 1);
					if (value.startsWith(' ')) value = value.slice(1);
					if (field === 'event') event = value;
					else if (field === 'data') data.push(value);
				}
				if (data.length === 0) return;
				let payload = null;
				try {
					payload = JSON.parse(data.join('\n'));
				} catch {
					return;
				}
				onEvent(event, payload);
			};
			return {
				push(chunk) {
					buffer += chunk;
					let index = buffer.indexOf('\n\n');
					while (index !== -1) {
						flush(buffer.slice(0, index));
						buffer = buffer.slice(index + 2);
						index = buffer.indexOf('\n\n');
					}
				},
				end() {
					if (buffer.trim() !== '') {
						flush(buffer);
						buffer = '';
					}
				},
			};
		}

		const stripFence = (text) => {
			const trimmed = text.trim();
			if (!trimmed.startsWith('```')) return text;
			const lines = trimmed.split('\n');
			if (lines.length < 2) return text;
			lines.shift();
			if (lines.length > 0 && lines[lines.length - 1].trim() === '```') lines.pop();
			return lines.join('\n');
		};

		const applyEvent = (event, payload) => {
			if (event === 'start') {
				patch({
					status: 'streaming',
					resolvedMode: payload?.resolvedMode ?? state.resolvedMode,
					modelLabel: payload?.model ?? state.modelLabel,
				});
				return;
			}
			if (event === 'delta') {
				const text = state.text + (payload?.text ?? '');
				patch({ text });
				return;
			}
			if (event === 'done') {
				const text = stripFence(state.text);
				patch({
					status: 'done',
					text,
					missing: Array.isArray(payload?.missingVariables) ? payload.missingVariables : [],
					usage: payload?.usage ?? null,
					elapsedMs: payload?.elapsedMs ?? state.elapsedMs,
					chars: text.length,
				});
				return;
			}
			if (event === 'error') {
				patch({ status: 'error', error: payload?.message ?? t('failedGeneric') });
			}
		};

		const failFromResponse = async (res) => {
			let message = t('failedGeneric');
			let code = 'HTTP_' + res.status;
			try {
				const body = await res.json();
				if (body?.error?.message) message = body.error.message;
				if (body?.error?.code) code = body.error.code;
			} catch {
				// 非 JSON 错误体：保留状态码。
			}
			return { code, message };
		};

		async function runOptimize() {
			// 迭代模式缺指令时别发请求：Host 会回 400，用户还得自己找原因。
			if (state.mode === 'iterate' && state.instruction.trim() === '') {
				instructionRef.current?.focus();
				patch({ status: 'idle', error: null });
				return;
			}
			const id = ++runId;
			if (controller) controller.abort();
			controller = new AbortController();
			const started = performance.now();
			patch({ status: 'preparing', text: '', error: null, missing: [], usage: null, elapsedMs: 0 });

			try {
				const res = await fetch(`${ROUTE}/optimize`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						prompt: state.draft,
						mode: state.mode,
						language: state.language,
						instruction: state.instruction,
					}),
					signal: controller.signal,
					cache: 'no-store',
					credentials: 'same-origin',
				});
				if (id !== runId) return;
				if (!res.ok) {
					const failure = await failFromResponse(res);
					if (failure.code === 'LLM_UNAVAILABLE') patch({ status: 'unavailable' });
					else patch({ status: 'error', error: failure.message });
					return;
				}
				if (!res.body) {
					patch({ status: 'error', error: t('failedGeneric') });
					return;
				}
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				const parser = createFrameParser(applyEvent);
				for (;;) {
					const { done, value } = await reader.read();
					if (id !== runId) return;
					if (done) break;
					parser.push(decoder.decode(value, { stream: true }));
				}
				parser.push(decoder.decode());
				parser.end();
				if (id !== runId) return;
				if (state.status === 'streaming') {
					if (state.text.trim() === '') patch({ status: 'error', error: t('streamBroken') });
					else patch({ status: 'done', text: stripFence(state.text), chars: state.text.length });
				}
				if (state.status === 'done' || state.status === 'error') {
					patch({ elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
				}
			} catch (error) {
				if (id !== runId) return;
				if (error?.name === 'AbortError') {
					patch({ status: state.text.trim() === '' ? 'idle' : 'done' });
					return;
				}
				patch({ status: 'error', error: t('failedGeneric') });
			}
		}

		async function classify() {
			if (state.mode !== 'auto' || state.draft.trim() === '') return;
			try {
				const res = await fetch(`${ROUTE}/classify`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ prompt: state.draft, mode: 'auto' }),
					cache: 'no-store',
					credentials: 'same-origin',
				});
				if (!res.ok) return;
				const body = await res.json();
				if (body?.ok && body.resolvedMode && state.mode === 'auto') {
					patch({ resolvedMode: body.resolvedMode });
				}
			} catch {
				// 识别失败只丢标签，不影响优化本身。
			}
		}

		/**
		 * 选区只在「坐标能直接当字符串下标用」时才生效。
		 * 草稿里带 @ 引用 chip 时，detect 坐标与字符串下标会错位，
		 * 用长度校验兜底：对不上就退回整段优化，并标记 whole 让界面说清楚。
		 */
		function scopeDraft(draft, span, occurrences) {
			const chips = occurrences ?? 0;
			// 有 @ 引用 chip 时，detect 坐标与字符串下标根本不同源，别猜，一律整段。
			// 即使没选区也照样标记：让用户知道这里永远不是「只改选中的那截」。
			if (chips > 0) return { draft, whole: true };
			const selected = Boolean(span) && span.end > span.start;
			if (!selected) return { draft, whole: false };
			const candidate = draft.slice(span.start, span.end);
			if (candidate.length === span.end - span.start) return { draft: candidate, whole: false };
			return { draft, whole: true };
		}

		async function openPanel(input) {
			loadPrefs();
			const span = input.captureInsertion();
			const scoped = scopeDraft(input.draft, span, input.occurrences);
			const draft = scoped.draft;
			patch({
				open: true,
				draft,
				span,
				whole: scoped.whole,
				text: '',
				error: null,
				missing: [],
				usage: null,
				elapsedMs: 0,
				chars: 0,
				resolvedMode: null,
				status: draft.trim() === '' ? 'idle' : 'preparing',
			});
			if (draft.trim() === '') return;
			// 先确认宿主有没有模型：没有就直接进降级态，不白跑一趟 503。
			const meta = await loadMeta();
			if (!state.open) return;
			if (meta && meta.model === null) {
				patch({ status: 'unavailable' });
				return;
			}
			const maxChars = meta?.limits?.maxChars;
			if (typeof maxChars === 'number' && draft.length > maxChars) {
				patch({ status: 'error', error: t('tooLong', draft.length, maxChars) });
				return;
			}
			void classify();
			void runOptimize();
		}

		function closePanel() {
			runId += 1;
			if (controller) controller.abort();
			controller = null;
			patch({ open: false, status: 'idle' });
		}

		function stopRun() {
			runId += 1;
			if (controller) controller.abort();
			controller = null;
			patch({ status: state.text.trim() === '' ? 'idle' : 'done' });
		}

		function restart() {
			if (state.draft.trim() === '') return;
			metaPromise.current = null;
			void loadMeta();
			void runOptimize();
		}

		// ------------------------------------------------------------ components
		function OptimizeButton(props) {
			const draft = props.useInput((snapshot) => snapshot.draft);
			// occurrences 是草稿里的 @ 引用 chip；有它时选区坐标不可信。
			const occurrences = props.useInput((snapshot) => snapshot.occurrences?.length ?? 0);
			const toast = useStore((snapshot) => snapshot.toast);
			const open = useStore((snapshot) => snapshot.open);
			// 组件常驻：已应用 toast 挂在按钮旁边，浮层关掉也不会丢。
			const onOpen = () => {
				if (state.open) {
					closePanel();
					return;
				}
				openPanel({
					draft,
					occurrences,
					captureInsertion: () => props.inputActions.captureInsertion(),
				});
			};
			return h(
				'div',
				{ className: 'po-btn-wrap' },
				h(
					'button',
					{
						type: 'button',
						className: 'po-btn' + (open ? ' po-btn-on' : ''),
						title: t('buttonTitle'),
						'aria-label': t('buttonTitle'),
						onClick: onOpen,
					},
					h('span', { className: 'po-spark', 'aria-hidden': 'true' }, '✦'),
					h('span', null, t('button')),
				),
				toast
					? h(
							'div',
							{ className: 'po-toast', role: 'status' },
							h('span', { className: 'po-toast-dot', 'aria-hidden': 'true' }),
							h('span', null, toast.text),
						)
					: null,
			);
		}

		function ModeTabs() {
			const mode = useStore((snapshot) => snapshot.mode);
			const resolved = useStore((snapshot) => snapshot.resolvedMode);
			const status = useStore((snapshot) => snapshot.status);
			const busy = status === 'preparing' || status === 'streaming';
			const modes = ['auto', 'structured', 'analytical', 'concise', 'iterate'];
			return h(
				'div',
				{ className: 'po-tabs' },
				...modes.map((value) =>
					h(
						'button',
						{
							key: value,
							type: 'button',
							className: 'po-tab' + (mode === value ? ' po-tab-on' : ''),
							disabled: busy,
							onClick: () => {
								patch({ mode: value });
								savePrefs();
								if (value === 'iterate' && state.instruction.trim() === '') {
									// 切到迭代就把光标放进指令框，省得点了优化才发现缺东西。
									setTimeout(() => instructionRef.current?.focus(), 0);
								}
							},
						},
						t(value),
					),
				),
				mode === 'auto' && resolved
					? h('span', { className: 'po-hint' }, `${t('resolved')}：${t(resolved)}`)
					: null,
			);
		}

		function LanguagePicker() {
			const language = useStore((snapshot) => snapshot.language);
			const status = useStore((snapshot) => snapshot.status);
			const busy = status === 'preparing' || status === 'streaming';
			return h(
				'select',
				{
					className: 'po-lang',
					value: language,
					disabled: busy,
					'aria-label': t('language'),
					onChange: (event) => {
						patch({ language: event.target.value });
						savePrefs();
					},
				},
				h('option', { value: 'auto' }, t('langAuto')),
				h('option', { value: 'zh' }, t('langZh')),
				h('option', { value: 'en' }, t('langEn')),
			);
		}

		/**
		 * 草稿里有 @ 引用 chip 时，选区坐标不可信，一律按整段优化。
		 * 这条必须自己显形：否则用户以为「只改了选中的那截」。
		 */
		function WholeNote() {
			const whole = useStore((snapshot) => snapshot.whole);
			if (!whole) return null;
			return h(
				'div',
				{ className: 'po-note', role: 'note' },
				h('span', { className: 'po-note-badge', 'aria-hidden': 'true' }, '@'),
				h('span', null, t('wholeDraft')),
			);
		}

		function MetaLine() {
			const status = useStore((snapshot) => snapshot.status);
			const chars = useStore((snapshot) => snapshot.chars);
			const usage = useStore((snapshot) => snapshot.usage);
			const elapsed = useStore((snapshot) => snapshot.elapsedMs);
			const missing = useStore((snapshot) => snapshot.missing);
			const whole = useStore((snapshot) => snapshot.whole);
			if (status !== 'done') return null;
			const parts = [];
			parts.push(`${chars} ${t('chars')}`);
			if (missing.length === 0) parts.push(`✓ ${t('vars')}`);
			else parts.push(`⚠ ${t('varsLost')} ${missing.join(', ')}`);
			if (elapsed > 0) parts.push(`${(elapsed / 1000).toFixed(1)}s`);
			if (usage?.outputTokens) parts.push(`${usage.outputTokens} ${t('tokens')}`);
			if (whole) parts.push(t('wholeDraft'));
			return h(
				'div',
				{ className: 'po-meta' },
				...parts.map((part, i) =>
					h('span', { key: i, className: whole && i === parts.length - 1 ? 'po-hint' : undefined }, part),
				),
			);
		}

		function ResultBody(props) {
			const status = useStore((snapshot) => snapshot.status);
			const text = useStore((snapshot) => snapshot.text);
			const error = useStore((snapshot) => snapshot.error);
			const ref = React.useRef(null);
			React.useEffect(() => {
				if (status === 'streaming' && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
			}, [text, status]);
			if (status === 'preparing') {
				return h(
					'div',
					{ className: 'po-skeleton' },
					h('div', { className: 'po-sk-line' }),
					h('div', { className: 'po-sk-line po-sk-80' }),
					h('div', { className: 'po-sk-line po-sk-60' }),
				);
			}
			if (status === 'unavailable') {
				return h(
					'div',
					{ className: 'po-error po-info' },
					h('div', { className: 'po-error-title' }, t('unavailable')),
					h('div', { className: 'po-error-body' }, t('unavailableBody')),
					h(
						'div',
						{ className: 'po-error-actions' },
						h('button', { type: 'button', className: 'po-mini', onClick: () => restart() }, t('retry')),
						h(
							'button',
							{ type: 'button', className: 'po-mini po-mini-ghost', onClick: () => closePanel() },
							t('cancel'),
						),
					),
				);
			}
			if (status === 'error') {
				return h(
					'div',
					{ className: 'po-error' },
					h('div', { className: 'po-error-title' }, t('error')),
					h('div', { className: 'po-error-body' }, error ?? ''),
					h(
						'div',
						{ className: 'po-error-actions' },
						h('button', { type: 'button', className: 'po-mini', onClick: () => restart() }, t('retry')),
					),
				);
			}
			if (status === 'conflict') {
				return h(
					'div',
					{ className: 'po-error po-warn' },
					h('div', { className: 'po-error-title' }, t('conflict')),
					h('div', { className: 'po-error-body' }, t('conflictHint')),
					h(
						'div',
						{ className: 'po-error-actions' },
						h('button', { type: 'button', className: 'po-mini', onClick: () => props.onOverwrite() }, t('overwrite')),
						h('button', { type: 'button', className: 'po-mini po-mini-ghost', onClick: () => closePanel() }, t('cancel')),
					),
				);
			}
			return h('textarea', {
				ref,
				className: 'po-result',
				value: text,
				readOnly: status !== 'done',
				spellCheck: false,
				onChange: (event) => patch({ text: event.target.value, chars: event.target.value.length }),
				onKeyDown: (event) => {
					// 输入法组合期间的回车不算快捷键，否则中文选词会被打断。
					if (event.nativeEvent?.isComposing) return;
					if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						if (status === 'done' && text.trim() !== '') props.onReplace();
					}
				},
			});
		}

		function Panel(props) {
			const open = useStore((snapshot) => snapshot.open);
			const status = useStore((snapshot) => snapshot.status);
			const draft = useStore((snapshot) => snapshot.draft);
			const text = useStore((snapshot) => snapshot.text);
			const mode = useStore((snapshot) => snapshot.mode);
			const modelLabel = useStore((snapshot) => snapshot.modelLabel);
			const meta = useStore((snapshot) => snapshot.meta);
			const busy = status === 'preparing' || status === 'streaming';
			const canReplace = status === 'done' && text.trim() !== '';

			if (!open) return null;

			const copy = async () => {
				try {
					await navigator.clipboard.writeText(text);
					showToast(t('copied'));
				} catch {
					showToast(t('failedGeneric'));
				}
			};

			const replace = () => {
				const span = state.span;
				if (!span) return;
				const liveRev = props.rev;
				if (liveRev !== span.draftRev) {
					patch({ status: 'conflict', text: state.text });
					return;
				}
				const ok = props.inputActions.insertText(state.text, span);
				if (!ok) {
					patch({ status: 'conflict' });
					return;
				}
				patch({ open: false, status: 'idle', toast: null });
				showToast(t('applied'));
			};

			const overwrite = () => {
				if (props.inputActions && typeof props.inputActions.setDraft === 'function') {
					props.inputActions.setDraft(text);
					patch({ open: false, status: 'idle' });
					showToast(t('applied'));
				}
			};

			const modelLine = meta?.model === null ? t('noModel') : modelLabel ? t('modelInfo', modelLabel) : '';

			return h(
				'div',
				{
					className: 'po-panel',
					role: 'dialog',
					'aria-label': t('title'),
					onKeyDown: (event) => {
						if (event.key === 'Escape') {
							event.stopPropagation();
							closePanel();
						}
					},
				},
				h(
					'div',
					{ className: 'po-head' },
					h('span', { className: 'po-spark', 'aria-hidden': 'true' }, '✦'),
					h('span', { className: 'po-title' }, t('title')),
					h(
						'div',
						{ className: 'po-right' },
						modelLine
							? h(
									'span',
									{ className: 'po-model' + (meta?.model === null ? ' po-model-off' : '') },
									modelLine,
								)
							: null,
						h(LanguagePicker),
						h(
							'button',
							{ type: 'button', className: 'po-x', title: t('close'), 'aria-label': t('close'), onClick: () => closePanel() },
							'×',
						),
					),
				),
				h(ModeTabs),
				h(WholeNote),
				mode === 'iterate'
					? h('input', {
							className: 'po-instruction',
							ref: (node) => {
								instructionRef.current = node;
							},
							value: state.instruction,
							placeholder: t('instructionPlaceholder'),
							disabled: busy,
							onChange: (event) => patch({ instruction: event.target.value }),
						})
					: null,
				draft.trim() === '' && status === 'idle'
					? h('div', { className: 'po-empty' }, t('empty'))
					: h(ResultBody, { onOverwrite: overwrite, onReplace: replace }),
				status === 'streaming' || status === 'preparing'
					? h(
							'div',
							{ className: 'po-progress' },
							h('span', { className: 'po-progress-text' }, t('preparing')),
							h('span', { className: 'po-grow' }),
							h('button', { type: 'button', className: 'po-mini', onClick: () => stopRun() }, t('stop')),
						)
					: null,
				h(MetaLine),
				h(
					'div',
					{ className: 'po-foot' },
					h(
						'button',
						{
							type: 'button',
							className: 'po-mini po-mini-ghost',
							disabled: busy || draft.trim() === '',
							onClick: () => restart(),
						},
						t('reoptimize'),
					),
					h('span', { className: 'po-grow' }),
					h(
						'button',
						{
							type: 'button',
							className: 'po-mini',
							disabled: text.trim() === '',
							onClick: () => void copy(),
						},
						t('copy'),
					),
					h(
						'button',
						{
							type: 'button',
							className: 'po-primary',
							disabled: !canReplace,
							onClick: () => replace(),
						},
						t('replace'),
						h('kbd', null, REPLACE_KEY),
					),
				),
			);
		}

		// ----------------------------------------------------------------- css
		const CSS = `
.po-btn-wrap{position:relative;display:inline-flex;align-items:center}
.po-btn{height:26px;display:inline-flex;align-items:center;gap:4px;padding:0 9px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease}
.po-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}
.po-btn-on{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.po-spark{color:var(--dsw-alias-brand-primary);font-size:11px;line-height:1}
.po-toast{position:absolute;right:0;bottom:calc(100% + 8px);display:flex;align-items:center;gap:6px;padding:6px 10px;
  border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-primary);font-size:12px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.18);z-index:41}
.po-toast-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.po-panel{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);width:min(720px,calc(100% - 24px));container-type:inline-size;
  max-height:min(70vh,620px);display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);
  box-shadow:0 16px 48px rgba(0,0,0,.32);z-index:40;box-sizing:border-box;overflow:hidden}
.po-head{display:flex;align-items:center;gap:8px;flex-wrap:nowrap}
.po-spark{flex:0 0 auto}
.po-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);flex:0 1 auto;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.po-right{margin-left:auto;display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto}
.po-model{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:0 1 auto;
  min-width:0;max-width:min(320px,42cqw);overflow:hidden;text-overflow:ellipsis}
.po-model-off{color:var(--dsw-alias-state-warn-primary)}
@container (max-width:420px){.po-model{display:none}}
.po-lang{height:24px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:0 6px;cursor:pointer;flex:0 0 auto}
.po-x{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);
  font-size:16px;line-height:1;cursor:pointer;flex:0 0 auto}
.po-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.po-tabs{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.po-tab{height:24px;padding:0 10px;border-radius:12px;border:1px solid transparent;background:transparent;
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;appearance:none;-webkit-appearance:none}
.po-tab:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.po-tab-on{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.po-tab:disabled{opacity:.55;cursor:default}
.po-hint{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.po-note{display:flex;align-items:center;gap:7px;margin:0 0 8px;padding:6px 9px;border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11.5px}
.po-note-badge{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;
  border-radius:5px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);
  font-size:10px;font-weight:600}
.po-instruction{height:30px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 10px;outline:none}
.po-instruction:focus{border-color:var(--dsw-alias-brand-primary)}
.po-result{flex:1;min-height:132px;max-height:340px;resize:none;border-radius:10px;padding:10px 12px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font:inherit;font-size:13px;line-height:1.6;outline:none;box-sizing:border-box;overflow-y:auto}
.po-skeleton{display:flex;flex-direction:column;gap:8px;padding:12px;min-height:132px;box-sizing:border-box;
  border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.po-sk-line{height:10px;border-radius:5px;background:var(--dsw-alias-border-l1);animation:po-pulse 1.2s ease-in-out infinite}
.po-sk-80{width:80%}.po-sk-60{width:60%}
@keyframes po-pulse{0%,100%{opacity:.45}50%{opacity:.9}}
.po-error{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:10px;
  border:1px solid var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}
.po-info{border-color:var(--dsw-alias-border-l2)}
.po-warn{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent)}
.po-error-title{font-size:12px;font-weight:600;color:var(--dsw-alias-state-error-primary)}
.po-warn .po-error-title{color:var(--dsw-alias-state-warn-primary)}
.po-error-body{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;word-break:break-word}
.po-error-actions{display:flex;gap:6px;margin-top:2px}
.po-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:18px 4px;text-align:center}
.po-progress{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.po-progress-text{display:inline-flex;align-items:center;gap:6px}
.po-progress-text::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);
  animation:po-pulse 1s ease-in-out infinite}
.po-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.po-foot{display:flex;align-items:center;gap:6px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}
.po-grow{flex:1}
.po-mini{height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.po-mini:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary)}
.po-mini:disabled{opacity:.45;cursor:default}
.po-mini-ghost{background:transparent}
.po-primary{height:26px;padding:0 10px 0 12px;border-radius:7px;border:1px solid transparent;
  background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;font-weight:600;
  display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.po-primary:disabled{opacity:.45;cursor:default}
.po-primary kbd{font:inherit;font-size:10px;line-height:1;border:0;border-radius:5px;padding:2px 5px;margin-left:2px;
  background:rgba(127,127,127,.25);background:color-mix(in srgb,currentColor 18%,transparent);letter-spacing:.02em}
@media (prefers-color-scheme: light){.po-toast,.po-panel{box-shadow:0 16px 40px rgba(0,0,0,.12)}}
`;

		// ---------------------------------------------------------------- apply
		return {
			name: 'dsh-prompt-optimizer',
			inject: ['slots', 'locale'],
			apply(ctx) {
				const readLocale = () => {
					try {
						return pickLocale(ctx.locale?.getSnapshot?.() ?? ctx.locale?.getLocale?.());
					} catch {
						// locale 服务异常时按中文兜底。
						return 'zh';
					}
				};
				locale = readLocale();

				// 切语言时按钮与面板要立刻换文案，不能等下次挂载。
				ctx.effect(() => {
					const off = ctx.locale?.subscribe?.(() => {
						const next = readLocale();
						if (next === locale) return;
						locale = next;
						patch({});
					});
					return typeof off === 'function' ? off : undefined;
				}, 'dsh-prompt-optimizer: locale');

				const disposers = [];

				ctx.effect(() => {
					const style = document.createElement('style');
					style.dataset.plugin = NS;
					style.textContent = CSS;
					document.head.appendChild(style);
					return () => style.remove();
				}, 'dsh-prompt-optimizer: styles');

				// 两个注册项共享同一 store；input.right 的按钮常驻，浮层只负责面板。
				const registerSlot = (slot, id, order, Component) => {
					const dispose = ctx.slots.inject(slot, () =>
						ctx.slots.register(
							{ name: slot, id, order, locale: NS },
							Component,
						),
					);
					if (typeof dispose === 'function') disposers.push(dispose);
				};

				const Button = (props) => h(OptimizeButton, props);
				// 面板要拿到「此刻」的 draftRev 才能判断草稿是否被改过。
				const PanelHost = (props) => {
					const rev = props.useInput((snapshot) => snapshot.draftRev);
					return h(Panel, { ...props, rev });
				};

				registerSlot(SLOT_BUTTON, 'prompt-optimizer', 0, Button);
				registerSlot(SLOT_PANEL, 'prompt-optimizer-panel', 20, PanelHost);

				ctx.effect(() => () => {
					for (const dispose of disposers.splice(0)) {
						try {
							dispose();
						} catch {
							// 已随宿主卸载。
						}
					}
					if (toastTimer) window.clearTimeout(toastTimer);
					toastTimer = null;
					if (controller) controller.abort();
				}, 'dsh-prompt-optimizer: cleanup');
			},
			__test: { createFrameParser, stripFence, DICT, pickLocale, scopeDraft },
		};
	},
});
