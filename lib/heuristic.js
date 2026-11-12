/**
 * 自动模式启发式——全插件唯一实现。
 *
 * Client 不复制这套规则，而是走 `POST /classify` 拿结果；
 * `/optimize` 收到 `mode: 'auto'` 时也用这里再算一次，保证两处一致。
 */

/** 四种具体模式的机器名，顺序即 UI 里的顺序。 */
export const MODES = ['structured', 'analytical', 'concise', 'iterate'];

/** 请求里允许的 mode 值（多一个 auto）。 */
export const REQUEST_MODES = ['auto', ...MODES];

/** 输出语言枚举；auto 表示跟随原文。 */
export const LANGUAGES = ['auto', 'zh', 'en'];

const VARIABLE = /\{\{\s*[^{}\n]+\s*\}\}/;
const HEADING = /(^|\n)\s{0,3}#{1,6}\s+\S/;
const ROLE_MARK = /(^|\n)\s*(Role|角色)\s*[:：]/i;
const YOU_ARE = /你是|你是一位|你是一名|You are\b/;
const WORKFLOW_WORDS = /步骤|流程|工作流|输出格式|step by step|workflow|output format/i;

/** 是否含结构化提示词特征（变量占位符、标题、Role、你是…）。 */
export function hasStructure(text) {
	const value = String(text ?? '');
	return VARIABLE.test(value) || HEADING.test(value) || ROLE_MARK.test(value) || YOU_ARE.test(value);
}

/**
 * 按设计 §3.5 的四条规则判定模式。
 * 顺序有讲究：结构化条件最具体，先判；精修只吃「短且无骨架」。
 */
export function detectMode(prompt) {
	const text = String(prompt ?? '');
	const length = text.length;
	if (length > 400 && hasStructure(text)) return 'structured';
	if (length > 600 && WORKFLOW_WORDS.test(text)) return 'analytical';
	if (length <= 400 && !HEADING.test(text)) return 'concise';
	return 'analytical';
}

/** 把请求里的 mode 解析成具体模式；非法值按 auto 处理。 */
export function resolveMode(mode, prompt) {
	if (MODES.includes(mode)) return mode;
	return detectMode(prompt);
}

/** 取出原文里出现的全部变量占位符（去重，保序）。 */
export function variableNames(text) {
	const found = String(text ?? '').match(/\{\{\s*([^{}\n]+?)\s*\}\}/g) ?? [];
	const seen = new Set();
	const names = [];
	for (const raw of found) {
		const name = raw.slice(2, -2).trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		names.push(name);
	}
	return names;
}

/** 比较原文与改写结果，返回被丢掉的变量名。 */
export function missingVariables(original, rewritten) {
	const kept = new Set(variableNames(rewritten));
	return variableNames(original).filter((name) => !kept.has(name));
}
