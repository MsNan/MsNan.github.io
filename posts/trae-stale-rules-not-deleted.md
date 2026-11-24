---
title: "先留下两份旧的 .trae/rules，再装 7 个毕设技能：提示有了，旧文件一个字都没改"
date: 2026-11-24
category: 前端
tags: [JavaScript, Node.js, Trae]
description: "在临时目录先留下两份旧的 .trae/rules，再把 7 个毕设技能装进官方 .trae/skills：安装器会提示，但旧文件内容一个字都不会改。"
---

<div v-pre>

bishe-doc-skills 的 --tool trae 今天也改到了官方技能目录（提交 385dfe7），和前两天 vue-uniapp-skills 那次是同类改动。项目里现在写的是 `.trae/skills/<name>/SKILL.md`，不再创建 `.trae/rules`。依据是国际版 https://docs.trae.ai/ide/skills 和国内版 https://docs.trae.cn/ide_skills。我今天重新读过这两份文档，并在本地把 7 个毕设技能都装出来核对；没有打开真实的 Trae 窗口去看客户端是否加载。测试环境是 Node v24.22.1，对着这个提交跑官方测试 21 条全绿；Actions 的 Node 18、20、22 也通过（run 45239868991）。版本号仍是 0.1.1，没有打 tag。

这次我想确认的是另一件事：如果项目里还留着旧安装器写过的 `.trae/rules`，新安装器会不会动手去改。

## 先留下两份旧规则，再装全部 7 个技能

我在临时目录里先放了两个旧文件，内容都写成 `old rule`：

`.trae/rules/thesis-proposal.md`
`.trae/rules/test-chapter.md`

然后用命令行执行 `--tool trae`，不带 --force，把 7 个技能全部装进去。输出是：

```
✅ 已写入 7 个文件（工具: trae，技能: 7 个）
⚠️  检测到先前安装留下的 2 个 .trae/rules 文件，Trae 还会从 .trae/skills 加载同一内容，建议删掉以免规则和技能重复：
   <项目目录>/.trae/rules/test-chapter.md
   <项目目录>/.trae/rules/thesis-proposal.md
```

装完之后，`.trae/skills` 下面 7 个目录都在：`code-to-thesis`、`defense-prep`、`requirements-analysis`、`system-design`、`test-chapter`、`thesis-proposal`、`thesis-writing`。那两份旧规则也还在，内容仍是 `old rule`，一个字都没被改掉。

这是有意的：安装器不替你删可能改过的旧文件。不过按文档的说法，`.trae/rules/` 里的内容会在对话开始时整份注入上下文，技能则是先扫简要描述、相关时才加载正文。旧规则如果还留着，就可能和技能目录里的同一份内容叠在一起，要不要删得自己决定。

## 默认 all 还会在 .agents/skills 写一份

如果不用 `--tool trae`，而是走默认的 all，同一套 7 个技能还会写到 `.agents/skills`，并更新 `AGENTS.md` 里属于这个工具的区块。我在干净目录里试过，一共写出 22 个文件：三套技能目录各 7 个，外加一份 `AGENTS.md`，项目里没有 `.cursor/skills`，也没有新建 `.trae/rules`。

国内版文档写过，需要在设置里打开「启用 .agents 技能目录」，Trae 才会加载 `.agents/skills/`；若和 `.trae/skills/` 重名，以 `.trae/skills/` 为准。我没有打开过这个开关，所以不能把「目录里有两份同名技能」写成「客户端会显示两份」。

仓库：https://github.com/MsNan/bishe-doc-skills

</div>
