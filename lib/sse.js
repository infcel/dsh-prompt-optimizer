/**
 * SSE 编码——Host 侧纯函数，便于单测。
 * 客户端解析器在 client 侧（M2），这里只负责把事件变成字节。
 */

/** 事件名固定四种，写错客户端就解析不到。 */
export const EVENTS = ['start', 'delta', 'done', 'error'];

/** 一帧：`event: x\ndata: {...}\n\n`。JSON 里的换行会被转义成 \n，不会破坏分帧。 */
export function frame(event, data) {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 首字节前的响应头；`x-accel-buffering` 针对 nginx 类反向代理。 */
export function headers() {
	return {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-store',
		connection: 'keep-alive',
		'x-accel-buffering': 'no',
	};
}

/** 统一 JSON 响应的头。 */
export function jsonHeaders() {
	return { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
}
