---
title: "想把带某个标签的提示词拷走：prompt-hub-cn 0.4.0 的 --markdown --tag"
date: 2026-11-28
category: 前端
tags: [JavaScript, Node.js, 提示词]
description: "prompt-hub-cn 0.4.0 可用 --markdown --tag 按标签写出 prompts/<id>.md；正文里已有代码围栏时会加长围栏，详情页「复制链接」是 GitHub Pages 上的 #/p/<id> 地址。"
---

<div v-pre>

提示词百宝箱 prompt-hub-cn 的网站上现在有 66 条中文提示词。以前一行命令主要是把 Cursor rules 和 Claude / Codex / Trae 的技能写到官方目录，普通提示词只能在网页上复制。提交 e3f54f6（package.json 版本 0.4.0）加了一件事：按标签把提示词写成 `prompts/<id>.md`，详情页也可以复制这条的在线地址。没有打 git tag，也没有发 GitHub Release，也没有发到 npm。

我今天在 Node v24.22.1 下对着这个提交跑仓库测试，32 条全绿；GitHub Actions 的 Node 20、22 也通过（run 46051083395），Pages 部署通过（run 46051083407）。下面的命令输出都是我在干净临时目录里跑 `node scripts/export.js` 得到的，它和 `npx -y github:MsNan/prompt-hub-cn` 是同一条入口。我没有在浏览器里逐个点「复制链接」做手工回归，链接格式来自源码里的 `promptShareUrl`。

## 先看有哪些标签

```bash
npx -y github:MsNan/prompt-hub-cn --list-tags
```

输出按出现次数从高到低排，开头是：

```
   6  Claude Code
   4  面试
   4  Cursor
   2  安全
   ...
   2  uni-app
   2  Vue3
   ...
共 106 个标签
```

这里的数字是「这个标签出现了几次」，不是「有多少条互不相同的提示词」。Vue3 是 2，因为一条普通提示词、一条 Cursor rule 都打了这个标签。

## 只带走带 Vue3 标签的提示词

```bash
npx -y github:MsNan/prompt-hub-cn . --markdown --tag Vue3
```

我这边的输出是：

```
✅ prompts/fe-component.md  ← 还需要填写：组件名、场景
✅ prompts/rule-vue3.md  ← 还需要填写：UI 库

共写入 2 个文件到 <项目目录>
```

`fe-component.md` 开头是这样的（我没填变量，所以正文里还留着 `{{组件名}}`）：

```
# 设计一个 Vue3 通用组件

- 分类：前端
- 标签：#Vue3、#组件设计
- 在线：https://msnan.github.io/prompt-hub-cn/#/p/fe-component

## 适用场景

要封装一个会被多处复用的组件。

## 提示词

请用 Vue3 <script setup lang="ts"> 设计一个「{{组件名}}」组件。
...
```

后面还有「变量」和「示例」两节。`--tag Vue3,uni-app` 是匹配任一标签，不是要求一条提示词同时带两个标签。我在另一个临时目录里跑了一次，写出了 4 个文件：`fe-component.md`、`fe-uniapp.md`、`rule-vue3.md`、`rule-uniapp.md`。标签大小写不敏感，`--tag vue3` 和 `--tag Vue3` 数量一样。写错标签会退出，提示「未知标签：……。用 --list-tags 查看全部标签」。

不加 `--markdown`、只写 `--tag` 时，过滤的是规则和技能的导出。比如 `--only rules --tag Vue3` 只会写出 `.cursor/rules/vue3.mdc`。如果某个标签下没有可导出到那些目录的条目，命令会提示：若要导出普通提示词，请加上 `--markdown`。

`--markdown` 不能和 `--only` 或 `--global` 一起用，会退出并说明原因。已存在的文件默认跳过，不会覆盖你改过的内容，要覆盖再加 `--force`。也可以加 `--set "组件名=SearchSelect"`，写出时就把变量填上。不加 `--tag` 的 `--markdown` 会把全部 66 条都写出来，我试过一次，文件数确实是 66。

## 正文里已经有代码围栏的时候

有的提示词本身就包含 Markdown 代码块。例如 `code-explain`（逐段讲解陌生代码）的正文里，示例代码是用三个反引号包起来的。如果导出时再一律用三个反引号去包整段提示词，外层围栏会在内层那里结束，文件就拆坏了。导出时会先数正文里连续反引号最长的一串，再用比它多一个的围栏包起来。我实际得到的外层是四个反引号，内层仍是三个，整段提示词是完整的一块。

## 详情页的「复制链接」不是短链

每条提示词的在线地址是 `https://msnan.github.io/prompt-hub-cn/#/p/<id>`，比如 https://msnan.github.io/prompt-hub-cn/#/p/fe-component 。网站是 GitHub Pages 上的纯静态页，路由写在 `location.hash` 里，打开详情就是 `#/p/<id>`，不需要服务器再配一条重写规则。详情页的「复制链接」只是把这个地址复制到剪贴板，不是短链，也不会做访问统计。导出的 Markdown 里「在线」那一行，用的是同一个函数。

仓库：https://github.com/MsNan/prompt-hub-cn


</div>
