# 提示词优化（@infcel/dsh-prompt-optimizer）

给 DeepSeek Harness 的输入框加一个 **✦ 优化** 按钮：把随手写下的一句糙话，改写成结构清楚、约束明确的提示词，替换回输入框，一次 ⌘Z 就能撤回。

已发布：npm [`@infcel/dsh-prompt-optimizer`](https://www.npmjs.com/package/@infcel/dsh-prompt-optimizer) · 仓库 [infcel/dsh-prompt-optimizer](https://github.com/infcel/dsh-prompt-optimizer)

模板思路移植自 [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer)，但调用链改成了 DSH 原生：**用当前会话的默认模型，不需要再配一套 API Key**。

## 定位

补的是「写提示词」这一步：想到什么就写什么，提交前让模型把这段话整理成它自己能读懂的版本。给不想维护提示词库、只想把话说明白的人用。

## 安装

已发布到 npm 时，直接按包名装：

```
plugin_manager(action: "install_bundle", target: "@infcel/dsh-prompt-optimizer")
```

也可以装离线包（`npm run release` 产出的 tgz）：

```
plugin_manager(action: "install_bundle", target: "/绝对路径/infcel-dsh-prompt-optimizer-1.0.1.tgz")
```

开发时指向源码目录即可：

```
plugin_manager(action: "install_bundle", target: "<本仓库目录的绝对路径>")
```

安装后需要重启一次 Harness（bundle/patch 是启动快照）。装好后输入框右侧出现 ✦ 优化。发布流程见 `RELEASING.md`。

## 用法

1. 在输入框写一段草稿。有选区就只优化选区，没有选区就整段优化。
2. 点 **✦ 优化**，或直接按按钮；面板从输入框上方浮出，开始逐字流式生成。
3. 选模式：**自动**（按文本启发式判断）、**结构化**（角色/技能/规则/流程骨架）、**分析式**（补齐背景、约束、输出格式）、**精修**（只修语病与歧义，不动结构）、**迭代**（保留结构，按你写的「这次怎么改」定向修改）。
4. 输出语言可选：跟随原文 / 简体中文 / English。
5. 结果可编辑。**替换草稿**（或结果区按 ⌘↵）写回输入框；不满意就**重新优化**或**复制**。

### 回填与撤销

- 回填是一次独立的可撤销编辑，⌘Z 一步还原（不是逐字撤回）。
- 生成期间如果你改了草稿，替换会被拦下并提示「草稿已变动」，需要显式点**覆盖为新结果**——不会悄悄盖掉你刚写的东西。
- 替换成功后按钮上方有 4 秒确认条；撤销请用 ⌘Z。

### 变量

`{{变量名}}` 占位符逐字保留：不新增、不删除、不改名、不翻译。生成结束后会统计原文里的变量是否都还在，缺失的会在元信息行点名。

### 语言

界面文案跟随 Harness 的语言（中文 / English），在设置里切换后按钮与面板立即换文案，不需要重载页面。`locale/*.json` 只给插件管理页用，面板文案内联在 `client.js` 的 `DICT` 里，两份字典的键由单测强制对齐。

## 挂载点与数据源

| 项目 | 值 |
| --- | --- |
| 入口按钮 | slot `conversation.input.right`，id `prompt-optimizer`，order 0 |
| 浮层面板 | slot `conversation.input.overlay`，id `prompt-optimizer-panel`，order 20 |
| 模型 | Host `llm.stream()` + `agentDefaultModel.currentSelection()`（四步回落，见下） |
| 路由 | `GET /api/dsh-prompt-optimizer/meta`、`POST /api/dsh-prompt-optimizer/classify`、`POST /api/dsh-prompt-optimizer/optimize`（SSE） |
| 偏好 | `localStorage` 键 `dsh.prompt-optimizer.prefs`（`{mode, language}`，非法值回落 `auto`） |
| 日志 | 不写文件、不留历史 |

模型选择顺序：当前默认选择 → 该 provider 的首个模型 → 首个 provider 的首个模型 → 都没有则返回 503，面板显示「当前宿主未提供模型服务」。

## 影响范围

- 只往两个 composer 子槽各注册一项，不替换宿主节点，不 append 到 `document.body`。
- 样式全部走 `--dsw-alias-*` / `--dsw-*` token，随亮暗主题切换；`<style data-plugin>` 由 `ctx.effect` 注入并在卸载时移除。
- 网络只发本机同源 `/api/dsh-prompt-optimizer/*`，不访问外部服务。
- 不注册 window 级键盘监听，不改宿主快捷键。

## 失败与降级

| 情况 | 用户看到什么 |
| --- | --- |
| 宿主没有模型服务 | 面板顶部黄条说明原因；按钮仍可点，但不会发请求 |
| 上游 429 / 限流 | 面板红条给出可读原因 + **重试** / **复制原文** |
| 草稿超过 2 万字 | 打开面板时按 `/meta` 的上限就地拦下并提示分段；即使绕过预检，Host 也会用 413 兜底 |
| 提交时草稿已变 | 黄条「草稿已变动」，提供**覆盖为新结果**与**取消** |
| 中途关闭面板 | 请求 abort，控制台不报未捕获错误 |
| 未登录 / token 失效 | 路由返回 401，面板按错误态显示 |

## 升级后会发生什么

插件自身升级：改 `client.js` 后**硬刷新**（⇧⌘R）即可拿到新客户端——普通刷新可能命中 boot graph 的缓存；改 Host 侧（`index.js` / `lib/*`）需要重启。

宿主升级：如果 `conversation.input.right` 或 `conversation.input.overlay` 被移除/改名，客户端注册会被跳过并打一条 warn，输入框不会多出按钮——不会出现半截 UI。此时需要按新槽位名改 `client.js` 的注册。

## 回滚

1. 禁用：`plugin_manager(action: "set_plugin", target: "@infcel/dsh-prompt-optimizer", enabled: false)`，重启后按钮与浮层一起消失。
2. 卸载：`plugin_manager(action: "remove_bundle", target: "@infcel/dsh-prompt-optimizer")`，再从 profile 的 `package.json` / `dsh.profile.bundles` 里清掉条目。
3. 安装前备份：profile 的 `package.json.bak-*` 与 `cordis.patch.yml.bak-*`；恢复这两个文件并重启即可回到安装前。

`localStorage` 里的 `dsh.prompt-optimizer.prefs` 不会自动清除，需要手动删（只影响模式默认值）。

## 已知限制

- **不执行提示词**：只改写文本本身，不会顺手把活干完。
- **不渲染**：只处理文本，不产出任何媒体文件。
- **不存历史**：关掉面板就没了，没有收藏与模板库（上游的模板库/评估/文生图不在移植范围内）。
- **变量只校验不改写**：`{{变量}}` 不会被自动填值。
- 草稿里带 `@` 引用 chip 时，选区坐标和字符串下标不同源，此时会**退回整段优化**（宁可多改，不会改错位），面板里会显示一条横幅「含 @ 引用，按整段优化」，不会静默降级；不带 `@` 引用时选中哪段就只改哪段。
- 需要已登录的 GUI 会话；命令行 curl 这些路由一律 401。

## 开发与测试

```
node --test test/*.test.mjs          # 47 passing
node plugin-dev/scripts/plugin-check.mjs dsh-prompt-optimizer   # 1 PASS / 0 WARN / 0 FAIL
node --check index.js lib/*.js client.js
```

`client.js` 是 bundle 形式（`window.__ModuleLoader__.load({id, factory})`），插件自己的 `lib/*.js` **不能**被它 `require`——客户端模块加载器只按模块 id 解析，所以 SSE 帧解析器内联在 `client.js` 里；测试用假 loader 抓 factory 来跑。

## 许可与致谢

模板结构与文案思路来自 [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer)（AGPL-3.0），本插件为其 DSH 原生改写。

因为改写了上游的提示词模板，本插件同样以 **AGPL-3.0-or-later** 发布：仓库内已附 [`LICENSE`](LICENSE) 全文，`package.json` 的 `license` 字段同值。对外分发时请保留上游署名与仓库链接；上游的模板文件位于 `packages/core/src/services/template/default-templates/`。


## 验证记录

| 日期 | 版本 | 验证项 | 结果 |
| --- | --- | --- | --- |
| 2026-11-11 | 1.0.0 | 单测 44 条、plugin-check P0–P2 | PASS / 0 WARN / 0 FAIL |
| 2026-11-11 | 1.0.0 | slot 上屏（input.right + overlay）、`/meta` 四步回落取到真实模型 | 通过，截图确认 |
| 2026-11-12 | 1.0.0 | 真机：逐字流式、自动识别标签、替换后 ⌘Z 一步还原 | 通过 |
| 2026-11-12 | 1.0.0 | 真机：草稿冲突拦截、4 秒确认条、模式与语言持久化、⌘↵ 替换 | 通过 |
| 2026-11-12 | 1.0.0 | 单测 46 条（新增 locale 解析、中英字典对齐） | 通过 |
| 2026-11-12 | 1.0.0 | 真机：选中一段只改一段，其余文字不动 | 通过 |
| 2026-11-12 | 1.0.0 | 真机（注入无模型）：面板直接进「未提供模型服务」态，不发请求 | 通过 |
| 2026-11-12 | 1.0.0 | 真机：含 @ 引用时面板显示「按整段优化」横幅 | 通过 |
| 2026-11-12 | 1.0.0 | 单测 47 条（新增选区/整段判定） | 通过 |
| 2026-11-12 | 1.0.1 | 包名统一为 `@infcel/…`，npm 拉回的 tgz 解包跑 `--strict` | PASS |

未验证：超长草稿（>2 万字）真机提示、上游 429 真机复现（错误态用注入方式验过）。英文界面已实机确认。
