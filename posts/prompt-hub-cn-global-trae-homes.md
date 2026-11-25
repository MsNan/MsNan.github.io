---
title: "给 prompt-hub-cn 加上 --global 后，我用三个临时 home 试了 Trae 技能写到哪一边"
date: 2026-11-25
category: 前端
tags: [JavaScript, Node.js, Trae]
description: "prompt-hub-cn 新增 --global。用三个临时 home 实测：只有 ~/.trae-cn、没有 ~/.trae 时才写到国内版目录，空目录或两边都在则写 ~/.trae/skills；Codex 始终写到 ~/.agents/skills。"
---

<div v-pre>

prompt-hub-cn 今天升到了 0.3.0（提交 54b53f7）。除了能把同一套 6 个技能写到项目里的 Codex / Trae 官方目录，还加了 `--global`。用户级目录按文档分别是：Codex 的 `$HOME/.agents/skills`（https://learn.chatgpt.com/docs/build-skills），Trae 国内版的 `~/.trae-cn/skills`（https://docs.trae.cn/ide_skills）；国际版文档对应的是 `~/.trae/skills`（https://docs.trae.ai/ide/skills）。我今天重新读过这些文档，并在本地用临时 home 试写文件；没有打开真实的 Codex 或 Trae 窗口去看客户端是否加载。

测试环境是 Node v24.22.1，对着这个提交跑官方测试 22 条全绿；Actions 的 Node 20、22 也通过（run 45460815207）。版本号写在 package.json 里，没有打 git tag，也没有发 GitHub Release。

## 三个临时 home，只导出 Codex 和 Trae

我不想把 Cursor rules 和 Claude 技能也装进用户目录，所以导出时用了 `--only codex,trae`，并传入不同的假 home（相当于加 `--global`）。每一次都写入 12 个文件：6 个技能各写到 Codex 和 Trae 两个目录。

空的 home：Trae 写到 `~/.trae/skills`，Codex 写到 `~/.agents/skills`，没有创建 `~/.trae-cn`。

home 里只放一个空的 `.trae-cn` 目录、没有 `.trae`：Trae 改写到 `~/.trae-cn/skills`，`~/.trae/skills` 不存在，Codex 仍然是 `~/.agents/skills`。

两个目录都在：Trae 回到 `~/.trae/skills`，`~/.trae-cn/skills` 下面没有写出技能文件。

规则就是：只有「存在国内版目录、又不存在国际版目录」时才用 `~/.trae-cn/skills`，其他情况都写 `~/.trae/skills`。两边都在时，不会再往国内版目录复制一份。这是本地写文件的结果，不能写成「客户端已经扫到了这一边」。

命令行也可以这样用：`npx -y github:MsNan/prompt-hub-cn --only codex,trae --global`。加了 `--global` 之后，项目目录可以省略。已存在的文件默认跳过。

仓库：https://github.com/MsNan/prompt-hub-cn

</div>
