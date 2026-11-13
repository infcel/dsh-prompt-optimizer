# 更新记录

## 1.1.0

- **许可证改为 MIT**。四种模式的模板骨架与文案重写为原创实现，不再沿用上游 `prompt-optimizer` 的模板表达；`LICENSE` 换成 MIT 全文，`package.json` 的 `license` 字段同步。
- 结构化模式改用 `# 角色 / ## 适用场景 / ## 能力范围 / ## 工作约束 / ## 执行流程 / ## 开场方式`；分析式改用 `# 任务目标 / ## 前提与输入 / ## 分析维度 / ## 判定标准 / ## 执行顺序 / ## 输出格式 / ## 交付前自检`。
- README 两份的「模式」表与「许可与致谢」同步；安装方式拆成 Desktop / web-CLI / 离线包与源码三小节。

## 1.0.5

文档版：顶图与下方「界面示意」提示语并为同一段，去掉两者之间的段落间距。无行为变更。

## 1.0.4

文档版：中英双语 README（`README.en.md`）、标题下的语言入口与徽章排布、顶图改为亮色示例并垂直居中；去掉与 h1 底边框重复的分隔线。无行为变更。

## 1.0.3

文档版：README 换成亮色示例图并重排图文（顶图 → 上手 → 失败态），验证记录从 README 拆到 `docs/verification.md`，README 只保留结论。无行为变更。

## 1.0.2 — 2026-11-12

- 打开面板时先按 `/meta` 的 `limits.maxChars` 就地拦下超长草稿（原来只有 Host 侧 413 兜底）。
- 文档修正：安装/回滚命令、升级后的刷新方式（需硬刷新）、失败表里的超长说明、单测数量；移除已失效的 `private: true` 说明。
- `package.json` 补 `author`；仓库里误提交的 `*.bak-rename` 备份删除并加入 `.gitignore`。

## 1.0.1 — 2026-11-12

- 包名统一为 `@infcel/dsh-prompt-optimizer`（源码、patch、client 模块 id、本机 profile 依赖全部对齐），发布不再依赖打包期改写。
- 补 `repository` / `homepage` / `bugs`，npm 页面可跳回仓库。
- 无功能变更，无行为变更。

## 1.0.0 — 2026-11-12

首个可发布版本，已发布到 npm：`@infcel/dsh-prompt-optimizer@1.0.0`。功能与验证状态见 README 的「验证记录」。

- 输入框右侧 **✦ 优化** 按钮，面板从输入框上方浮出，逐字流式生成（SSE）。
- 五个模式：自动、结构化、分析式、精修、迭代；输出语言可跟随原文 / 简体中文 / English。
- 用当前会话的默认模型（`agentDefaultModel.currentSelection()` 四步回落），不需要另配 API Key；模型缺失时面板直接进降级态，不发请求。
- 回填是一次可撤销编辑，⌘Z 一步还原；生成期间草稿变动会拦下并要你显式覆盖。
- `{{变量}}` 逐字保留并在生成后核对缺失；含 `@` 引用时按整段优化并给出横幅提示。
- 中英双语界面，跟随 Harness 语言设置即时切换。
- 移植自 [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) 的四个模板，按 AGPL-3.0-or-later 发布。
