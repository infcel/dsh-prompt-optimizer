import test from 'node:test';
import assert from 'node:assert/strict';

import { frame, headers, jsonHeaders } from '../lib/sse.js';

test('frame 产出标准 SSE 分帧', () => {
	assert.equal(frame('delta', { text: '你好' }), 'event: delta\ndata: {"text":"你好"}\n\n');
});

test('frame 不会因为正文换行而破坏分帧', () => {
	const raw = frame('delta', { text: '第一行\n第二行' });
	const body = raw.slice(raw.indexOf('data: ') + 6).trim();
	assert.equal(JSON.parse(body).text, '第一行\n第二行');
	assert.equal(raw.split('\n\n').length, 2);
});

test('data 里的冒号、引号都能被 JSON 安全承载', () => {
	const raw = frame('error', { code: 'UPSTREAM_ERROR', message: '失败: "429"' });
	assert.match(raw, /^event: error\ndata: /);
	assert.equal(JSON.parse(raw.split('data: ')[1].trim()).message, '失败: "429"');
});

test('SSE 头禁止缓存与代理缓冲', () => {
	const h = headers();
	assert.match(h['content-type'], /text\/event-stream/);
	assert.equal(h['cache-control'], 'no-store');
	assert.equal(h['x-accel-buffering'], 'no');
});

test('JSON 头同样是 no-store', () => {
	const h = jsonHeaders();
	assert.match(h['content-type'], /application\/json/);
	assert.equal(h['cache-control'], 'no-store');
});
