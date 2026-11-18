---
title: "Cursor 规则迁到官方 Skills：为什么不再写 .cursor/rules，以及 paths 怎么用"
date: 2026-11-18
category: 前端
tags: [JavaScript, Node.js, Cursor]
description: "对照官方文档后，--tool cursor 改为写入技能目录，源文件的匹配条件转成 paths 列表。默认全量仍不写 Cursor 目录。旧规则只提示不删除。全局安装目前不会检查用户目录里的旧规则。"
---

<div v-pre>


我这边给 uni-app 项目装 Cursor 规则，以前 `--tool cursor` 写的是 `.cursor/rules/<技能名>.mdc`。对照 Cursor 官方文档 https://cursor.com/docs/skills 之后，vue-uniapp-skills 改了一版（提交 70ee355）。现在这条命令写的是 `.cursor/skills/<技能名>/SKILL.md`，源文件里的 `globs` 会转成官方的 `paths` 列表。版本号还是 0.1.1，没有打 tag，也没有发 release。今晚在 Node 24.22.1 下对着这个提交跑了官方测试，22 条全绿，GitHub Actions 的 Node 18、20、22 也通过（run 44149719184）。下面的目录和文件内容，都是我在临时目录里实际装出来的。没有在真实的团队 Cursor 账号里核对过加载效果，依据是官方文档和本地安装结果。

## 一、官方文档里，技能不在 .cursor/rules

文档写得很清楚。Cursor 启动时会从这些位置发现技能：项目级是 `.cursor/skills/` 和 `.agents/skills/`，用户级是 `~/.cursor/skills/` 和 `~/.agents/skills/`。为了兼容，它还会读 `.claude/skills/`、`.codex/skills/`，以及对应的家目录。每个技能是一个文件夹，里面放 `SKILL.md`。YAML 头里 `name` 和 `description` 必填，`name` 必须跟父文件夹名一致。

可选字段里有一个 `paths`：用 glob 把技能限定在匹配的文件上，写法可以是 YAML 列表，也可以是逗号分隔的字符串。文档的原话是：设置之后，只有智能体在处理匹配文件时才会把这个技能呈现出来；如果希望打开任意文件都可用，就不要写 `paths`。

还有两句我特别在意。一句是：旧的 `globs` 字段仍然作为后备被接受，但新技能应该用 `paths`。另一句是内置的 `/migrate-to-skills`（文档写的是 Cursor 2.4）：它会转换「Apply Intelligently」、并且没有写 `globs` 的动态规则，以及斜杠命令；`alwaysApply: true`，或者带了具体 `globs` 的规则，不会被迁移。也就是说，如果旧的 `.mdc` 里本身就写了文件匹配，指望这条官方迁移命令把它变成技能，文档明确说不会转。

## 二、--tool cursor 现在写出的文件

在一个空目录里执行：

```bash
node bin/cli.js --tool cursor --dir /tmp/demo
```

终端是：

```text
✅ 已写入 12 个文件（工具: cursor，技能: 12 个）
```

项目里出现的是 `.cursor/skills/<name>/SKILL.md`，一共 12 个，没有 `.cursor/rules`。仓库里 12 个技能源文件，只有 3 个带了 `globs`：

- `vue3-composition`：`**/*.vue,**/composables/**/*.ts`
- `uniapp-cross-platform`：`**/*.vue,**/pages.json,**/manifest.json`
- `pinia-store`：`**/stores/**/*.ts`

装出来的 `vue3-composition` 头是这样的：

```yaml
---
name: vue3-composition
description: "Vue3 组合式 API 编码规范。编写或重构 .vue / composable 文件时使用：……"
paths:
  - "**/*.vue"
  - "**/composables/**/*.ts"
---
```

完整的 `description` 是源文件里那一整句，安装器会按 YAML 双引号字符串写出来。这里省略中间的例子，只看 `paths` 这两项。

`uniapp-cross-platform` 会拆成 `**/*.vue`、`**/pages.json`、`**/manifest.json` 三项；`pinia-store` 只有 `**/stores/**/*.ts` 一项。转换很直接：按逗号切开，去掉空白，写成带引号的 YAML 列表。没有 `globs` 的 9 个技能，比如 `uniapp-login`、`release-checklist`，头里只有 `name` 和 `description`，没有 `paths` 字段。这和文档说的「不设 paths，就不管打开哪些文件都可被呈现」是对齐的。

Claude 和 Codex 的 `SKILL.md` 仍然只写 `name` 和 `description`，不会带上 `paths` 或 `globs`。`paths` 是 Cursor 官方字段，我没有把它写进别的工具的格式里。

## 三、默认 --tool all 仍然不写 Cursor 目录

不带 `--tool`，或者写成 `--tool all`，会装 Claude、Trae、Codex，并更新 `AGENTS.md`，一共 37 个文件（12×3+1）。项目里不会出现 `.cursor`。终端会提示：

```text
ℹ️  未写入 .cursor/skills：按 Cursor 官方文档，Cursor 会从 .claude/skills/ 和 .agents/skills/ 加载技能（https://cursor.com/docs/skills）。只需 Cursor 时请用 --tool cursor。
ℹ️  同时安装了 Claude 与 Codex 技能目录时，Cursor 可能把同一技能显示两次；主要用 Cursor 请改用 --tool cursor。
```

`--tool cursor,claude` 或 `cursor,codex` 同样会跳过 `.cursor/skills`。`--tool cursor,trae` 仍会写入，因为 Trae 用的是 `.trae/rules`，不是 Cursor 会去兼容加载的技能目录。这些行为我都在临时目录里核对过。提示里的「可能显示两次」，依据也是官方那句兼容加载，我没有在 Cursor 界面里亲眼看过重复项。

## 四、--global 装到 ~/.cursor/skills

文档把 `~/.cursor/skills/` 标成用户级，对本机所有项目生效。`--tool cursor --global` 会往这里写，不会在项目目录里建 `.cursor`，也不会写 `~/.cursor/rules`。有 `globs` 的技能，全局安装同样带 `paths`。为了不碰到本机真实的家目录，我是把 `HOME` 指到临时目录再跑命令的。

## 五、旧的 .mdc 只提示，不会自动删

如果项目里还留着以前装的 `.cursor/rules/vue3-composition.mdc`，再跑 `--tool cursor`，新的 `SKILL.md` 会写出来，旧文件还在，终端会多一行：

```text
⚠️  检测到先前安装留下的 1 个 .cursor/rules 文件，Cursor 还会从技能目录加载同一内容，建议删掉以免重复：
   /tmp/.../.cursor/rules/vue3-composition.mdc
```

我把文件内容读了一遍，还是原来那份。默认 `--tool all` 虽然不写新的 Cursor 技能目录，但只要参数里包含 cursor（默认 all 包含它），同样会扫这些旧文件并提示，也不会删。

有一处没拦住。`--global` 检查旧规则时，只看了项目目录的 `.cursor/rules`，没有看 `~/.cursor/rules`。我在临时家目录和项目目录各放了一个同名的旧 `.mdc`，装完之后，提示列表里只有项目那一份，家里那一份还在，也没有出现在 `staleCursorRules` 里。按文档，用户级旧规则如果还停在 `~/.cursor/rules`，是有可能继续被加载的；安装器现在不会提醒你。我按这个行为写了一个补丁：加上之后，`--global` 会同时提示家目录和项目目录里的旧文件，仍然不会自动删除。官方测试从 22 条变成 23 条，都通过。还没有提交，也没有推送。

## 还没做的事

我没有在真实的 Cursor 窗口里确认这些 `SKILL.md` 一定会被发现，也没有跑过官方的 `/migrate-to-skills`。`paths` 是否只在打开匹配文件时出现，只引用了文档原话。bishe-doc-skills 还没有做同样的改写，不能把它当成已经同步。版本号仍是 0.1.1。

仓库：https://github.com/MsNan/vue-uniapp-skills

</div>
