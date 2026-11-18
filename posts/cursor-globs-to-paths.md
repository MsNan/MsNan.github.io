---
title: "源文件写的是 globs，装出来却是 paths：Cursor 技能字段怎么转，以及 --global 会漏看哪里"
date: 2026-11-18
category: 前端
tags: [JavaScript, Node.js, Cursor]
description: "源文件里逗号分隔的匹配条件，会转成官方 paths 列表；12 个技能里只有 3 个带这个字段。全局安装写到用户技能目录，但旧规则提示目前只扫项目目录。"
---

<div v-pre>


源文件里写的是 `globs`，装给 Cursor 之后，字段名变成了 `paths`，写法也从一行逗号分隔，变成了 YAML 列表。这是 vue-uniapp-skills 提交 70ee355 里，我专门给 `--tool cursor` 做的转换。版本还是 0.1.1，没有打 tag。今晚在 Node 24.22.1 下跑官方测试，22 条全绿，GitHub Actions 的 Node 18、20、22 也通过（run 44149719184）。下面的文件内容都是临时目录里装出来的，没有在真实 Cursor 账号里看过加载效果。

仓库里 12 个技能，只有 3 个源文件带了 `globs`。`vue3-composition` 原来是一行：

```yaml
globs: "**/*.vue,**/composables/**/*.ts"
```

在空目录执行 `node bin/cli.js --tool cursor --dir /tmp/demo`，终端是「已写入 12 个文件」，项目里出现 12 个 `.cursor/skills/<name>/SKILL.md`，没有 `.cursor/rules`。其中 `vue3-composition` 的头变成：

```yaml
paths:
  - "**/*.vue"
  - "**/composables/**/*.ts"
```

`uniapp-cross-platform` 的源字段是 `**/*.vue,**/pages.json,**/manifest.json`，会拆成三项；`pinia-store` 只有 `**/stores/**/*.ts`，对应一项。转换函数按逗号切开再去掉空白，写成带引号的 YAML 列表；切完如果没有任何项，就不写 `paths` 这个字段。剩下 9 个技能，比如 `uniapp-login`、`uniapp-payment`、`uniapp-subpackages`、`release-checklist`，装出来的头里只有 `name` 和 `description`。

官方文档 https://cursor.com/docs/skills 对 `paths` 的说明是：接受列表或逗号分隔的字符串；设置之后，只有智能体在处理匹配文件时才呈现该技能；希望打开任意文件都可用，就不要设。文档还写了，旧的 `globs` 仍可作为后备，但新技能应该用 `paths`。我没有把源文件里的 `globs` 原样抄进 Cursor 的 `SKILL.md`，就是按这句来的。同一页里另外一个相关的点：内置 `/migrate-to-skills`（文档写的是 Cursor 2.4）会转换没有 `globs` 的动态规则，以及斜杠命令；带了具体 `globs` 的规则不会被迁移。也就是说，上面这 3 个带匹配条件的技能，如果还停在旧的 `.mdc` 上，指望官方迁移命令去转，按文档是不会动的。我没有在 Cursor 里实际跑过这条命令，只对照了文档。

`--global` 会把 Cursor 技能写到 `~/.cursor/skills`，项目目录里不会出现 `.cursor`，也不会写 `~/.cursor/rules`。有 `paths` 的技能，全局安装同样带着那份列表。为了不碰到本机真实家目录，我是把 `HOME` 指到临时目录再跑的。例如：

```bash
HOME=/tmp/fake-home node bin/cli.js --tool cursor --global --skills vue3-composition,uniapp-login --dir /tmp/demo
```

终端是「已写入 2 个文件」。`/tmp/fake-home/.cursor/skills/vue3-composition/SKILL.md` 里仍然有上面那份 `paths` 列表，`uniapp-login` 仍然没有这个字段，`/tmp/demo` 下没有 `.cursor`。

旧的 `.mdc` 只提示、不删除。项目里若还有 `.cursor/rules/vue3-composition.mdc`，再跑一遍 `--tool cursor`，新的 `SKILL.md` 会写在 `.cursor/skills` 里，旧文件内容不变，终端会提示：

```text
⚠️  检测到先前安装留下的 1 个 .cursor/rules 文件，Cursor 还会从技能目录加载同一内容，建议删掉以免重复：
   /tmp/.../.cursor/rules/vue3-composition.mdc
```

我读了那个 `.mdc`，还是原来的内容。

这里有一个当前行为要注意：`--global` 扫旧规则时，只看项目目录的 `.cursor/rules`，不看 `~/.cursor/rules`。我在临时家目录和项目目录各放了一个同名旧文件，安装结果写进了家目录的 `.cursor/skills`，提示列表里却只有项目那一份，家里那一份还在，也没有出现在 `staleCursorRules` 里。我按这个行为写了一个补丁：加上之后两条都会提示，仍然不自动删，官方测试从 22 条变成 23 条，都通过。还没有提交，也没有推送。

默认 `--tool all` 仍然不写 `.cursor` 目录，因为文档写了 Cursor 会兼容加载 `.claude/skills` 和 `.agents/skills`。只要用 Cursor，需要显式加 `--tool cursor`。转换和全局安装的细节跟这一条是分开的，这里不再展开默认全量安装的文件清单。

仓库：https://github.com/MsNan/vue-uniapp-skills

</div>
