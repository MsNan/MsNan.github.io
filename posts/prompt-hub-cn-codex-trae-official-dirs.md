---
title: "一行命令把同一套中文技能写到 Codex 和 Trae：默认会写出 24 个文件"
date: 2026-11-25
category: 前端
tags: [JavaScript, Node.js, Codex]
description: "prompt-hub-cn 0.3.0 默认会把同一套 6 个技能写到 .claude/skills、.agents/skills 和 .trae/skills，再加上 6 条 Cursor rules，一共 24 个文件。"
---

<div v-pre>

提示词百宝箱 prompt-hub-cn 今天升到了 0.3.0（提交 54b53f7）。以前一行命令只会把 6 条 Cursor rules 写到 `.cursor/rules`，再把同一套 6 个技能写到 `.claude/skills`。对照 Codex 官方技能文档 https://learn.chatgpt.com/docs/build-skills ，以及 Trae 官方技能文档（国际版 https://docs.trae.ai/ide/skills ，国内版 https://docs.trae.cn/ide_skills），现在默认会再写两份：Codex 用的 `.agents/skills/<name>/SKILL.md`，以及 Trae 用的 `.trae/skills/<name>/SKILL.md`。package.json 里的版本是 0.3.0，没有打 git tag，也没有发 GitHub Release。

我今天在 Node v24.22.1 下对着这个提交跑官方测试，22 条全绿；GitHub Actions 的 Node 20、22 也通过（run 45460815207）。下面说的目录，依据是我今天重新读到的官方文档，以及本地把文件写出来的结果。我没有在真实的 Codex 或 Trae 窗口里核对过这些文件一定会被加载。

## 默认一次导出是 24 个文件

在一个干净的临时目录里直接跑 `node scripts/export.js <项目目录>`（和 `npx -y github:MsNan/prompt-hub-cn .` 是同一条入口），输出是：

```
✅ .cursor/rules/vue3.mdc  ← 还需要填写：UI 库
✅ .cursor/rules/api.mdc  ← 还需要填写：测试框架
✅ .cursor/rules/commit.mdc  ← 还需要填写：模块示例
✅ .cursor/rules/test.mdc
✅ .cursor/rules/docs.mdc  ← 还需要填写：占位符示例
✅ .cursor/rules/uniapp.mdc  ← 还需要填写：目标平台
✅ .claude/skills/code-review/SKILL.md  ← 还需要填写：对比分支
✅ .claude/skills/release/SKILL.md  ← 还需要填写：主分支、检查命令
✅ .claude/skills/bug-hunt/SKILL.md  ← 还需要填写：测试命令
✅ .claude/skills/doc-sync/SKILL.md  ← 还需要填写：文档文件
✅ .claude/skills/i18n-extract/SKILL.md  ← 还需要填写：目录
✅ .claude/skills/db-migration/SKILL.md  ← 还需要填写：数据库
✅ .agents/skills/code-review/SKILL.md  ← 还需要填写：对比分支
✅ .agents/skills/release/SKILL.md  ← 还需要填写：主分支、检查命令
✅ .agents/skills/bug-hunt/SKILL.md  ← 还需要填写：测试命令
✅ .agents/skills/doc-sync/SKILL.md  ← 还需要填写：文档文件
✅ .agents/skills/i18n-extract/SKILL.md  ← 还需要填写：目录
✅ .agents/skills/db-migration/SKILL.md  ← 还需要填写：数据库
✅ .trae/skills/code-review/SKILL.md  ← 还需要填写：对比分支
✅ .trae/skills/release/SKILL.md  ← 还需要填写：主分支、检查命令
✅ .trae/skills/bug-hunt/SKILL.md  ← 还需要填写：测试命令
✅ .trae/skills/doc-sync/SKILL.md  ← 还需要填写：文档文件
✅ .trae/skills/i18n-extract/SKILL.md  ← 还需要填写：目录
✅ .trae/skills/db-migration/SKILL.md  ← 还需要填写：数据库

共写入 24 个文件到 <项目目录>
```

这 24 个文件是：`.cursor/rules` 里 6 条规则，再加上 `code-review`、`release`、`bug-hunt`、`doc-sync`、`i18n-extract`、`db-migration` 这 6 个技能，分别写到 `.claude/skills`、`.agents/skills`、`.trae/skills`。我抽查了刚写出的 `release/SKILL.md`，三份内容完全一样，开头是：

```
---
name: release
description: 准备新版本发布：检查、改版本号、生成更新日志、打 tag。用户说「发版」「release」时使用。
---
# 发版流程
```

Codex 文档写的是，仓库里从当前工作目录一直扫到仓库根目录的 `.agents/skills`，用户级则是 `$HOME/.agents/skills`。Trae 文档写的是项目技能在 `.trae/skills`，国内版全局目录是 `~/.trae-cn/skills`。技能文件头都要有 `name` 和 `description`，先扫描述、相关时再加载正文。这些是文档原意，不是我在客户端里点出来的效果。

## 同一套技能可能在 Cursor 里出现两次

默认会同时写入 `.claude/skills` 和 `.agents/skills`。我今天读到的 Cursor 技能文档（https://cursor.com/docs/skills）里，项目级技能目录本身就包括 `.agents/skills/`，另外为了兼容也会加载 `.claude/skills/`。所以这两份同名文件都可能被扫到。主要只用 Cursor 的话，可以加 `--only rules`，或者自行删掉其中一份技能目录。我没有打开 Cursor 去数它到底显示了几份。

只要其中一类，可以用 `--only rules|skills|codex|trae`，也支持逗号组合，比如 `--only codex,trae`。已存在的文件默认跳过，不会覆盖你改过的内容。

仓库：https://github.com/MsNan/prompt-hub-cn

</div>
