# 发布流程

本文只讲「怎么把这个插件发出去」。功能与验证状态见 `README.md`。

## 先选包名

`dsh-prompt-optimizer` 这个最自然的名字 **已经有人在 npm 上占了**（winditer 的 2.0.3，功能高度重合）；`dsh-prompt-optimizer-plugin`、`dsh-prompt-optimize` 也已被占。所以发布前必须先定一个不冲突的名字，两条路：

- **自己的 scope**：`@<npm 用户名>/dsh-prompt-optimizer`。这是最省事的做法，不用赌名字。当前用的就是 **`@infcel/dsh-prompt-optimizer`**，`package.json` 的 `name` 与 `cordis.patch.yml` 的 `name` 已经是它，`npm run release` 直接用。
- **不带 scope 的新名字**：先查空不空，`npm view <名字> version` 返回 404 才算空。

本机 profile 里也是同一个名字（`link:` 到本目录），所以打包不需要再改写包名——`scripts/release.mjs` 仍保留 `--name` 参数，换名发布时用。

## 打包

```
npm run release                                    # 版本取 package.json，包名取 package.json
npm run release -- --version 1.0.2                  # 临时指定版本
```

脚本做的事：复制源码到临时目录 → 把 `package.json` 的 `name` 改成目标名、`private` 改成 `false` → 把 `cordis.patch.yml` 里的 `name` 改成同一个名字 → `node --check` 全部 JS → `npm pack` 到 `dist/`。产物只含 `files` 字段列出的 12 个文件（不含 `test/`、`scripts/`）。

## 发布前必须过的门禁

```
node --test test/*.test.mjs                                  # 47 条
node ../plugin-dev/scripts/plugin-check.mjs . --strict        # 0 WARN / 0 FAIL
node ../plugin-dev/scripts/plugin-check.mjs /tmp/解包目录 --strict
```

最后一条最容易被跳过：**要验的是 tgz 解包后的那一份**，不是源码目录。跑完在 [`docs/verification.md`](docs/verification.md) 对应版本下追加一行（日期 / 验证项 / 结果）。解包命令：

```
mkdir -p /tmp/po-release && tar -xzf dist/<包名>-<版本>.tgz -C /tmp/po-release
```

## 发布

```
npm publish /绝对路径/dist/<包名>-<版本>.tgz --access public --registry=https://registry.npmjs.org
```

两个坑都踩过：

- **tarball 必须给绝对路径**。`npm publish dist/x.tgz` 会被当成 git 依赖去 `ls-remote ssh://git@github.com/...`，报 `Repository not found`。
- **显式带 `--registry`**。本机 `npm config get registry` 是 npmmirror，不带的话会往镜像发，而镜像不接受 scoped 包发布。

发布后用干净的 profile 装一次，确认能起来再宣布：

```
plugin_manager(action: "install_bundle", target: "<包名>")
```

发布成功后 npm 会先回一句 `Your package is being processed and may take a few minutes to become available`。这段时间：

- `https://registry.npmjs.org/@infcel%2Fdsh-prompt-optimizer/1.0.1`（带版本号的端点）已经是 200，可以先核对 `dist.integrity`；
- `npm view <包名>` 要读整份 packument，可能继续 404 几分钟，别当成发布失败。

2027 年 1 月起「带 bypass 2FA 的 token 直接发布」会被取消，届时改用 `npm stage publish` + 人工放行（或 Trusted Publishing/OIDC）。现在这条直接发布仍然有效。

## 发布后

- 打 tag / 存一份 tgz 到 release 附件，`dist/` 不进 git。
- 更新 `CHANGELOG.md`，版本号与 `package.json` 对齐。
- `lib/templates.js` 的四种模板是本仓库原创，不跟进上游；许可证 MIT，可自由改写（改了记得同步 README 的模式表）。
