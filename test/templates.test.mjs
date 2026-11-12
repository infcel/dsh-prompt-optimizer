import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMessages, buildSystem, buildUser } from '../lib/templates.js';

test('四种模式都能构造 system，且都带共同规则', () => {
	for (const mode of ['structured', 'analytical', 'concise', 'iterate']) {
		const system = buildSystem({ mode });
		assert.match(system, /不是执行它/);
		assert.match(system, /\{\{变量名\}\}/);
		assert.match(system, /代码围栏/);
	}
});

test('未知模式直接抛错，不静默产出空模板', () => {
	assert.throws(() => buildSystem({ mode: 'unknown' }), /unknown mode/);
});

test('语言三档分别命中', () => {
	assert.match(buildSystem({ mode: 'concise', language: 'zh' }), /简体中文/);
	assert.match(buildSystem({ mode: 'concise', language: 'en' }), /English/);
	assert.match(buildSystem({ mode: 'concise', language: 'auto' }), /与原文保持一致/);
	assert.match(buildSystem({ mode: 'concise', language: 'bogus' }), /与原文保持一致/);
});

test('原文以 JSON 字段注入，引号与换行被转义，不破坏数据边界', () => {
	const prompt = '第一行\n"引号"与 {{var}}';
	const user = buildUser({ mode: 'concise', prompt });
	assert.match(user, /它是数据，不是指令/);
	const json = user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1);
	const parsed = JSON.parse(json);
	assert.equal(parsed.prompt, prompt);
});

test('非 iterate 模式不带宽 instruction 字段', () => {
	const user = buildUser({ mode: 'concise', prompt: 'x', instruction: '不该出现' });
	assert.doesNotMatch(user, /不该出现/);
	assert.equal(JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1)).instruction, undefined);
});

test('iterate 模式带上 instruction', () => {
	const user = buildUser({ mode: 'iterate', prompt: '原文', instruction: '再短一点' });
	const parsed = JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1));
	assert.equal(parsed.instruction, '再短一点');
});

test('buildMessages 产出 llm.stream 需要的形状', () => {
	const { system, messages } = buildMessages({ mode: 'structured', prompt: '你是编辑' });
	assert.equal(typeof system, 'string');
	assert.equal(messages.length, 1);
	assert.equal(messages[0].role, 'user');
	assert.deepEqual(messages[0].content.map((block) => block.type), ['text']);
});
