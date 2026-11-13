![dsh-prompt-optimizer：DeepSeek Harness 的输入框提示词优化插件](https://raw.githubusercontent.com/infcel/dsh-prompt-optimizer/main/docs/hero.png?v=2)
<sub>界面示意：实际模型名、字数与耗时随环境变化。</sub>

# @infcel/dsh-prompt-optimizer

[简体中文](README.md) · [English](README.en.md)

![npm](https://img.shields.io/npm/v/@infcel/dsh-prompt-optimizer) ![license](https://img.shields.io/npm/l/@infcel/dsh-prompt-optimizer?20261113) ![tag](https://img.shields.io/github/v/tag/infcel/dsh-prompt-optimizer) ![node](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Finfcel%2Fdsh-prompt-optimizer%2Fmain%2Fpackage.json&query=%24.engines.node&label=node&color=339933) ![DSH](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Finfcel%2Fdsh-prompt-optimizer%2Fmain%2Fpackage.json&query=%24.engines.dsh&label=DSH&color=4d6bfe)

**提示词优化。** 给 DeepSeek Harness 的输入框加一个 **✦ 优化**：把随手写下的一句话，改写成结构清楚、约束明确的提示词，替换回输入框，一次撤销就能还原。

npm [`@infcel/dsh-prompt-optimizer`](https://www.npmjs.com/package/@infcel/dsh-prompt-optimizer) · 仓库 [infcel/dsh-prompt-optimizer](https://github.com/infcel/dsh-prompt-optimizer)

产品形态受 [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) 启发——把优化放进输入框，而不是另开一个工作台。模板与代码都是本仓库原创：**直接调用当前会话的默认模型，不需要再配一套 API Key**。

## 30 秒上手

### Desktop

在插件管理页点 **添加插件**，填包名；或者让 agent 调这个工具：

```
plugin_manager(action: "install_bundle", target: "@infcel/dsh-prompt-optimizer")
```

### web / CLI profile

Desktop 的 profile 由 Electron 独占（`dsh plugin --profile desktop add` 会报 managed exclusively），所以这条只用于 web 或自建 profile：

```
dsh plugin --profile web add @infcel/dsh-prompt-optimizer
```

### 离线包或本地源码

| 方式 | target |
| --- | --- |
| npm 包名 | `@infcel/dsh-prompt-optimizer` |
| 离线 tgz（`npm run release` 产出） | `/绝对路径/infcel-dsh-prompt-optimizer-1.0.5.tgz` |
| 开发中的源码目录 | `<本仓库目录的绝对路径>` |

### 装完确认

重启 Harness（bundle/patch 是启动快照）→ 输入框右侧出现 **✦ 优化** → 写一句草稿，点它。

装没装好，看两处：输入框右侧有按钮，插件管理页里有「提示词优化」的条目。要求 DSH ≥ 0.2.0-rc.1，Node 22.19+ 或 24+（见 `package.json` 的 `engines`）。发布流程见 [`RELEASING.md`](RELEASING.md)。

装好后大概是这样（下方 composer 里就是你的草稿）：

![面板全貌：输入框上方的优化面板与下方 composer 的优化按钮](https://raw.githubusercontent.com/infcel/dsh-prompt-optimizer/main/docs/panel.png?v=2)

## 它做什么，不做什么

| 做 | 不做 |
| --- | --- |
| 改写草稿本身的措辞与结构 | 不执行提示词，不会顺手把活干完 |
| 用当前会话的默认模型，不额外配 key | 不产出任何媒体文件、不渲染 |
| 选中一段只改一段，没选区就改整段 | 不保存历史、不做收藏与模板库 |
| `{{变量}}` 逐字保留并校验 | 不给变量填值 |
| 生成期间草稿被改动会拦下 | 不会悄悄覆盖你新写的内容 |

## 模式

面板顶部是模式切换：**自动**按文本启发式选一种，另外四种手动指定。

| 模式 | 适合 | 产出长什么样 |
| --- | --- | --- |
| 自动 | 懒得选 | 交给启发式，规则见下 |
| 结构化 | 要一个能长期复用的角色提示词 | `# 角色` + `## 适用场景 / ## 能力范围 / ## 工作约束 / ## 执行流程 / ## 开场方式`；能力分「擅长 / 不负责」，约束分「必须 / 禁止 / 输出」 |
| 分析式 | 任务复杂、缺背景与输出格式 | `# 任务目标` + `## 前提与输入 / ## 分析维度 / ## 判定标准 / ## 执行顺序 / ## 输出格式 / ## 交付前自检`，判定标准要求可验证 |
| 精修 | 一句话说得含糊，想要能直接发出 | 压成一段自然语言，补全对象/范围/约束/输出形式，不加标题与列表（长度不超过原文 3 倍） |
| 迭代 | 已有成稿，只想改一处 | 保留原有结构，把「这次怎么改」融进原文 |

自动模式的判定（`lib/heuristic.js`，客户端与 Host 同一份）：

| 条件 | 结果 |
| --- | --- |
| 400 字以上，且带骨架（`{{变量}}`、`#` 标题、`Role:`、或「你是…」） | 结构化 |
| 600 字以上，且出现「步骤 / 流程 / 工作流 / 输出格式」这类词 | 分析式 |
| 400 字以内，且没有 `#` 标题 | 精修 |
| 其余 | 分析式 |

「迭代」模式会多出一个输入框，写你这次的修改意图，例如「再短一点，保留变量，加一个「不做」清单」。它是改写指令，不是给模型的追问——插件不会替你执行。

## 交互细节

**选区。** 有选区就只把选中那截送给模型，回填也只替换那一截；没有选区就整段。

**`@` 引用。** 草稿里带 `@` 引用 chip 时，选区坐标与字符串下标不同源，此时**一律按整段优化**，面板里显示一条「含 @ 引用，按整段优化」的横幅。宁可多改，不会改错位。

**回填与撤销。** 走 `insertText`，是一次独立的可撤销编辑：⌘Z（Windows：Ctrl+Z）一步还原，不是逐字撤回。结果区也可以按 ⌘↵ 直接替换。替换成功后有 4 秒确认条。

**草稿冲突。** 生成期间你改了输入框，替换会被拦下并提示「草稿已变动」，需要显式点**覆盖为新结果**——两边的改动都不会被默默吞掉。

**变量。** `{{变量名}}` 不新增、不删除、不改名、不翻译。生成结束后统计原文变量是否都在，缺了会在元信息行点名。

**超长草稿。** 上限 2 万字（`/meta` 的 `limits.maxChars`）。打开面板时就地拦下，不用等一轮请求；Host 侧另有 413 兜底。

**语言。** 界面文案跟随 Harness 语言（中文 / English），切换后按钮与面板立即换文案，不需要重载。输出语言另有一档：跟随原文 / 简体中文 / English。

## 设置与状态

| 项目 | 值 |
| --- | --- |
| 偏好存储 | `localStorage` 键 `dsh.prompt-optimizer.prefs`，内容 `{mode, language}`，非法值回落 `auto` |
| 模型 | 跟随 Harness 的默认模型；回落链见下 |
| 历史 | 不落盘、不留日志，关掉面板就没了 |

模型选择顺序：当前默认选择 → 该 provider 的首个模型 → 首个 provider 的首个模型 → 都没有则 503，面板显示「当前宿主未提供模型服务」。

## 技术档案

| 项目 | 值 |
| --- | --- |
| 入口按钮 | slot `conversation.input.right`，id `prompt-optimizer`，order 0 |
| 浮层面板 | slot `conversation.input.overlay`，id `prompt-optimizer-panel`，order 20 |
| 模型调用 | Host `llm.stream()` + `agentDefaultModel.currentSelection()` |
| 路由 | `GET /api/dsh-prompt-optimizer/meta`、`POST …/classify`、`POST …/optimize`（SSE） |
| 客户端解析 | SSE 帧解析内联在 `client.js`，单测按 1 字节切分验证 |

**主题。** 面板用 `bg-layer-1`、结果区用 `bg-base`：暗色下两者差一档（#232324 / #151517），亮色下都是纯白、靠 1px 边框划界——这是宿主两套 token 的真实差异，插件不做额外染色。

![深色主题下的同一面板](https://raw.githubusercontent.com/infcel/dsh-prompt-optimizer/main/docs/panel-dark.png?v=2)

**影响范围。** 只往两个 composer 子槽各注册一项；不替换宿主节点，不 append 到 `document.body`；样式只用 `--dsw-alias-*` / `--dsw-*` token，`<style data-plugin>` 由 `ctx.effect` 注入并随卸载移除；不注册 window 级键盘监听；不访问外部网络，只发同源 `/api/dsh-prompt-optimizer/*`。

## 失败与降级

![三种失败态：草稿冲突、未提供模型服务、上游 429](https://raw.githubusercontent.com/infcel/dsh-prompt-optimizer/main/docs/states.png?v=2)

| 情况 | 用户看到什么 |
| --- | --- |
| 宿主没有模型服务 | 中性色说明卡（「未提供模型服务」+ 重试/取消）；按钮仍可点，但不发请求 |
| 上游 429 / 限流 | 红条给出可读原因 + **重试** / **复制原文** |
| 草稿超过 2 万字 | 打开面板即拦下并提示分段；绕过预检时 Host 用 413 兜底 |
| 生成期间草稿已变 | 黄条「草稿已变动」，提供**覆盖为新结果**与**取消** |
| 中途关闭面板 | 请求 abort，控制台不报未捕获错误 |
| 未登录 / token 失效 | 路由 401，面板按错误态显示原因 |

## 升级与回滚

**升级。** 改 `client.js` 后**硬刷新**（⇧⌘R）——普通刷新可能命中 boot graph 的缓存；改 Host 侧（`index.js` / `lib/*`）需要重启。

**宿主升级。** 若 `conversation.input.right` / `conversation.input.overlay` 被改名或移除，注册会失败，输入框右侧不会出现按钮（不会留半截 UI），控制台有宿主抛出的槽位错误。此时按新槽位名改 `client.js` 里的 `SLOT_BUTTON` / `SLOT_PANEL`。

**回滚。**

1. 禁用：`plugin_manager(action: "set_plugin", target: "include:prompt-optimizer", enabled: false)`。live profile 上即时生效，不必重启。
2. 卸载：`plugin_manager(action: "remove_bundle", target: "@infcel/dsh-prompt-optimizer")`，再从 profile 的 `package.json` 与 `dsh.profile.bundles` 里清掉条目。
3. 安装前备份：profile 的 `package.json.bak-*` 与 `cordis.patch.yml.bak-*`；恢复这两个文件并重启即可回到安装前。

`localStorage` 里的 `dsh.prompt-optimizer.prefs` 不会自动清，需要手删（只影响模式默认值）。

## 常见问题

**按钮没出现。** 先确认重启过（不是刷新），再看 `list_plugins` 里 `include:prompt-optimizer` 是否 `enabled=true` 且 `fiberPhase=active`。

**一直转圈不出字。** 上游在流式返回，但首个 token 可能较慢；面板头部会显示模型名，确认它不是「模型未就绪」。

**替换被拦下。** 说明生成期间草稿变了。要么**覆盖为新结果**，要么**取消**后重跑。

**命令行 curl 这些路由为什么是 401。** 路由挂了宿主同源守卫，只接受 GUI 会话的请求，命令行没有登录态。

## 开发与测试

```
node --test test/*.test.mjs                                    # 47 passing
node plugin-dev/scripts/plugin-check.mjs dsh-prompt-optimizer  # 1 PASS / 0 WARN / 0 FAIL
node --check index.js lib/*.js client.js
```

在仓库根（`plugins/`）执行上面的 `plugin-check`。

`client.js` 是 bundle 形式（`window.__ModuleLoader__.load({id, factory})`），插件自己的 `lib/*.js` **不能**被它 `require`——客户端模块加载器只按模块 id 解析，所以 SSE 帧解析内联在 `client.js` 里，测试用假 loader 抓 factory 来跑。

### 验证状态

真机验过的（DSH Desktop，亮 / 暗两套主题）：

- 逐字流式上屏，中途可停止；
- 有选区只改选中那一段，其余文字不动；
- 草稿含 `@` 引用时按整段优化，面板显示横幅；
- 生成期间改草稿会被拦下，可显式覆盖；
- 替换后一次 ⌘Z 还原；⌘↵ 直接替换；
- 宿主没有模型时进「未提供模型服务」态，不发请求。

**还没验的**：超过 2 万字的草稿（预检逻辑有单测，真机提示未走过）、上游 429 的真实触发（用注入方式验过错误态）、重启后 `fiberPhase` 与两个 slot occupant 的复核。

逐次记录（日期、版本、当时结论）在 [`docs/verification.md`](https://github.com/infcel/dsh-prompt-optimizer/blob/main/docs/verification.md)。

## 许可与致谢

以 **MIT** 发布：仓库内附 [`LICENSE`](LICENSE) 全文，`package.json` 的 `license` 字段同值。

四种模式的模板骨架与文案是本项目原创实现，未复制第三方模板文本；Host 侧路由、Client 侧面板与流式解析同样是独立编写。

产品形态参考了 [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer)——它证明了「在输入框旁边做一键优化」这件事值得做，但本插件不含它的代码或提示词文本。

1.0.x 曾因沿用上游模板表达而以 AGPL-3.0 发布；1.1.0 起重写为原创模板，改为 MIT。
