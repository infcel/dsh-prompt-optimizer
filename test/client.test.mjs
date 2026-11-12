import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// client.js 是 bundle 形式的脚本：模块体只调用 window.__ModuleLoader__.load。
// 用假装载器抓 factory，就能在不启动浏览器的情况下测里面的纯函数。
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
let captured = null;
globalThis.window = {
	__ModuleLoader__: {
		load(options) {
			captured = options;
		},
	},
};
new Function('window', source)(globalThis.window);

const React = {
	createElement: (...args) => args,
	useSyncExternalStore: () => undefined,
	useRef: () => ({ current: null }),
	useEffect: () => undefined,
};

const requireStub = (id) => {
	if (id === 'react') return React;
	throw new Error(`unexpected require(${id})`);
};

assert.ok(captured, 'client.js must register a module');
assert.equal(captured.id, '@local/dsh-prompt-optimizer');
const mod = captured.factory(requireStub);
const { createFrameParser, stripFence, DICT, pickLocale, scopeDraft } = mod.__test;

const collect = () => {
	const events = [];
	const parser = createFrameParser((event, payload) => events.push({ event, payload }));
	return { events, parser };
};

test('client exports a cordis plugin shape', () => {
	assert.equal(typeof mod.apply, 'function');
	assert.deepEqual(mod.inject, ['slots', 'locale']);
	assert.equal(mod.name, 'dsh-prompt-optimizer');
});

test('parses whole frames', () => {
	const { events, parser } = collect();
	parser.push('event: start\ndata: {"resolvedMode":"concise"}\n\n');
	parser.push('event: delta\ndata: {"text":"你"}\n\n');
	parser.end();
	assert.deepEqual(events, [
		{ event: 'start', payload: { resolvedMode: 'concise' } },
		{ event: 'delta', payload: { text: '你' } },
	]);
});

test('one byte at a time yields identical events', () => {
	const frame = 'event: done\ndata: {"chars":3,"missingVariables":["a"]}\n\nevent: delta\ndata: {"text":"x"}\n\n';
	const one = collect();
	for (const byte of Buffer.from(frame, 'utf8')) one.parser.push(String.fromCharCode(byte));
	one.parser.end();
	const many = collect();
	many.parser.push(frame);
	many.parser.end();
	assert.deepEqual(one.events, many.events);
	assert.equal(one.events.length, 2);
	assert.deepEqual(one.events[0].payload, { chars: 3, missingVariables: ['a'] });
});

test('multi-byte characters survive byte splitting', () => {
	// 真实链路上 fetch reader 给的是 Uint8Array，客户端用 TextDecoder({stream:true}) 解码；
	// 这里复刻同样的顺序，确认按字节切分不会把汉字切坏。
	const frame = 'event: delta\ndata: {"text":"提示词"}\n\n';
	const { events, parser } = collect();
	const decoder = new TextDecoder();
	for (const byte of Buffer.from(frame, 'utf8')) {
		parser.push(decoder.decode(Uint8Array.of(byte), { stream: true }));
	}
	parser.push(decoder.decode());
	parser.end();
	assert.equal(events.length, 1);
	assert.equal(events[0].payload.text, '提示词');
});

test('joins multi-line data and ignores comments', () => {
	const { events, parser } = collect();
	parser.push(': keepalive\nevent: delta\ndata: {"text":"a"}\ndata: \n\n');
	parser.end();
	assert.deepEqual(events, [{ event: 'delta', payload: { text: 'a' } }]);
});

test('flushes a trailing frame without the blank line', () => {
	const { events, parser } = collect();
	parser.push('event: error\ndata: {"code":"RATE_LIMIT","message":"限流"}');
	parser.end();
	assert.deepEqual(events, [{ event: 'error', payload: { code: 'RATE_LIMIT', message: '限流' } }]);
});

test('malformed JSON is dropped, not thrown', () => {
	const { events, parser } = collect();
	parser.push('event: delta\ndata: {oops\n\n');
	parser.push('event: delta\ndata: {"text":"ok"}\n\n');
	parser.end();
	assert.deepEqual(events, [{ event: 'delta', payload: { text: 'ok' } }]);
});

test('stripFence unwraps a single code fence', () => {
	assert.equal(stripFence('```\n你是助手\n```'), '你是助手');
	assert.equal(stripFence('```markdown\n你是助手\n```'), '你是助手');
	assert.equal(stripFence('你是助手'), '你是助手');
	assert.equal(stripFence('不用 ``` 包裹'), '不用 ``` 包裹');
});


test('locale: 快照里解析出 en / zh，带区域与未知语言都兜底', () => {
	assert.equal(pickLocale({ active: 'en', locales: [], revision: 1 }), 'en');
	assert.equal(pickLocale({ active: 'en-US', locales: [], revision: 2 }), 'en');
	assert.equal(pickLocale({ active: 'zh-CN', locales: [], revision: 3 }), 'zh');
	assert.equal(pickLocale('en'), 'en');
	// 未知语言、缺字段、不是快照：一律中文，不能让面板出现英文键名。
	assert.equal(pickLocale({ active: 'ja', locales: [], revision: 4 }), 'zh');
	assert.equal(pickLocale(undefined), 'zh');
	assert.equal(pickLocale(null), 'zh');
});

test('DICT: 中英两份键完全对齐，缺一条就会在界面上露出 key', () => {
	const zh = Object.keys(DICT.zh).sort();
	const en = Object.keys(DICT.en).sort();
	assert.deepEqual(en, zh, 'en 与 zh 的键集合必须一致');
	for (const key of zh) {
		const zhValue = DICT.zh[key];
		const enValue = DICT.en[key];
		if (typeof zhValue === 'function') {
			assert.equal(typeof enValue, 'function', `${key} 在英文里应该是函数`);
			continue;
		}
		assert.equal(typeof enValue, 'string', `${key} 在英文里应该是字符串`);
		assert.ok(enValue.trim() !== '', `${key} 的英文文案不能为空`);
	}
});

test('scopeDraft: 无 chip 时按选区；有 chip 时一律整段并打标记', () => {
	const draft = '请审查这段代码的性能问题';
	// 正常选区：detect 坐标与字符串下标一致，只取选区
	assert.deepEqual(scopeDraft(draft, { start: 1, end: 5, draftRev: 1 }, 0), {
		draft: '审查这段',
		whole: false,
	});
	// 没有选区、也没有 chip：整段，不挂提示
	assert.deepEqual(scopeDraft(draft, { start: 0, end: 0, draftRev: 1 }, 0), { draft, whole: false });
	// 有 @ chip：即使有选区也不猜坐标
	assert.deepEqual(scopeDraft(draft, { start: 1, end: 5, draftRev: 2 }, 2), { draft, whole: true });
	// 有 @ chip、没有选区：照样标记，让用户知道选区不会生效
	assert.deepEqual(scopeDraft(draft, { start: 0, end: 0, draftRev: 2 }, 1), { draft, whole: true });
	// 没有 occurrence 信息但切片长度对不上（越界）：退回整段
	assert.deepEqual(scopeDraft(draft, { start: 5, end: 999, draftRev: 3 }, 0), { draft, whole: true });
});
