---
title: "默认 --tool all 会给 Trae 和 Codex 各写一份技能：毕设文档包也改到官方 .trae/skills 了"
date: 2026-11-24
category: 前端
tags: [JavaScript, Node.js, Trae]
description: "bishe-doc-skills 的 --tool trae 已改到官方 .trae/skills。默认 all 一次写入 22 个文件，会同时给 Trae 和 Codex 各写一份同名技能，但不会写 .cursor/skills。"
---

<div v-pre>

前两天我改的是 vue-uniapp-skills 的 Trae 安装路径。同样对照官方技能文档（国际版 https://docs.trae.ai/ide/skills ，国内版 https://docs.trae.cn/ide_skills），今天把 bishe-doc-skills 也跟上了（提交 385dfe7）：指定 --tool trae 时，不再写 `.trae/rules/<name>.md`，改为官方的 `.trae/skills/<name>/SKILL.md`。版本号仍是 0.1.1，没有打 tag，也没有发 release。

这是一套毕设文档技能，一共 7 个：开题报告、需求分析、系统设计、论文规范、从代码提取素材、测试章节、答辩准备。技能本身要求先从自己的代码里提取事实，不编造文献、测试结果和截图。今天在 Node v24.22.1 下对着这个提交跑官方测试，21 条全绿；GitHub Actions 的 Node 18、20、22 也通过（run 45239868991）。下面说的目录和加载规则，依据是我今天重新读到的官方文档，以及本地把文件写出来的结果；我没有在真实的 Trae 窗口里核对过这些文件一定会被加载。

## 默认 all 会同时写入三套目录

不加 --tool 时，默认是 all。我在一个干净的临时目录里直接装全部 7 个技能，命令行输出是：

```
✅ 已写入 22 个文件（工具: claude, cursor, trae, codex，技能: 7 个）
ℹ️  未写入 .cursor/skills：按 Cursor 官方文档，Cursor 会从 .claude/skills/ 和 .agents/skills/ 加载技能（https://cursor.com/docs/skills）。只需 Cursor 时请用 --tool cursor。
ℹ️  同时安装了 Claude 与 Codex 技能目录时，Cursor 可能把同一技能显示两次；主要用 Cursor 请改用 --tool cursor。
```

这 22 个文件是这样来的：`.claude/skills`、`.trae/skills`、`.agents/skills` 各 7 个技能目录，再加上一份 `AGENTS.md`。项目里没有 `.cursor/skills`，也没有新建 `.trae/rules`。提示里虽然把 cursor 也列进了工具名，但实际按兼容加载规则跳过了，没有往 Cursor 目录写文件。

也就是说，默认一次安装会给 Trae 和 Codex 各写一份同名技能。国内版文档写过：在设置里打开「启用 .agents 技能目录」后，Trae 也可以加载 `.agents/skills/`；若和 `.trae/skills/` 重名，以 `.trae/skills/` 为准。我没有打开过这个开关，也没有在客户端里看过它会不会真的把两份都列出来。

## 写出来的技能文件头

`.trae/skills` 下面这 7 个目录都在：`code-to-thesis`、`defense-prep`、`requirements-analysis`、`system-design`、`test-chapter`、`thesis-proposal`、`thesis-writing`。我打开刚写出的 `thesis-proposal/SKILL.md`，开头是这样的（原文照抄）：

```
---
name: thesis-proposal
description: "计算机类毕业设计开题报告 / 任务书写作（选题意义、国内外现状、研究内容、技术路线、进度安排）。写开题报告、任务书、选题申请时使用。"
---
# 开题报告 / 任务书
```

以前旧安装器写的是规则文件；现在是带 `name` / `description` 的技能文件，一个技能一个目录。加 --global 时才会写到用户级目录：只有本机存在 `~/.trae-cn`、不存在 `~/.trae` 时才用 `~/.trae-cn/skills`，其余情况都用 `~/.trae/skills`。这些同样只是本地写文件的结果，不能写成「客户端已经加载成功」。

仓库：https://github.com/MsNan/bishe-doc-skills

</div>
