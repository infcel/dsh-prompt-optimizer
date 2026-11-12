import test from 'node:test';
import assert from 'node:assert/strict';

import { detectMode, hasStructure, missingVariables, resolveMode, variableNames } from '../lib/heuristic.js';

test('结构化：变量 + 长度 > 400', () => {
	const prompt = `你是资深前端工程师，请审查代码。${'补充说明。'.repeat(90)}\n变量：{{code}}`;
	assert.equal(detectMode(prompt), 'structured');
});

test('结构化：标题骨架 + 长度 > 400', () => {
	const prompt = `# Role\n代码审查员\n${'请检查性能问题并给出建议。'.repeat(30)}`;
	assert.equal(detectMode(prompt), 'structured');
});

test('分析式：长文 + 流程类词', () => {
	const prompt = `帮我整理一份上线方案。${'需要覆盖回滚与灰度。'.repeat(50)}输出格式按步骤写清流程。`;
	assert.equal(detectMode(prompt), 'analytical');
});

test('精修：短且无骨架', () => {
	assert.equal(detectMode('帮我把这段 React 代码看一下有没有性能问题'), 'concise');
});

test('分析式：短但有标题结构', () => {
	assert.equal(detectMode('# 任务\n写个周报'), 'analytical');
});

test('空草稿也落在精修，不抛错', () => {
	assert.equal(detectMode(''), 'concise');
	assert.equal(detectMode(undefined), 'concise');
});

test('resolveMode 保持具体模式，非法值回落到启发式', () => {
	assert.equal(resolveMode('iterate', '# 标题'), 'iterate');
	assert.equal(resolveMode('nope', '短句'), 'concise');
	assert.equal(resolveMode('auto', '短句'), 'concise');
});

test('hasStructure 识别四种特征', () => {
	assert.equal(hasStructure('提到 {{x}}'), true);
	assert.equal(hasStructure('Role: 审查员'), true);
	assert.equal(hasStructure('你是一名编辑'), true);
	assert.equal(hasStructure('普通的一句话'), false);
});

test('variableNames 去重保序，missingVariables 只报丢掉的', () => {
	assert.deepEqual(variableNames('{{a}} 与 {{ b }} 还有 {{a}}'), ['a', 'b']);
	assert.deepEqual(missingVariables('{{a}} {{b}} {{c}}', '保留 {{a}} 和 {{c}}'), ['b']);
	assert.deepEqual(missingVariables('没有变量', '也没有'), []);
});
