---
title: "搜 platform 却给出 Form 表单：离线文档检索把短关键词当成了子串"
date: 2026-11-19
category: 前端
tags: [JavaScript, Node.js, MCP]
description: "searchDocs 用检索词包含关键词来加分，platform、information 会命中 form。搜 https 时，http 这个短词让 uni.request 排到和域名配置并列。"
---

<div v-pre>


cn-dev-mcp 里有两个离线文档工具：`dev_docs_search` 和 `dev_docs_get`。数据是仓库里手写的 30 条摘要，覆盖 uni-app、微信小程序、Element Plus 和 Vant，每条都附了官方文档链接。README 写得很清楚：摘要是社区整理，不是官方原文，详细用法以链接为准。

我今晚用的是提交 3bcf473（当前 main 的 HEAD），在 Node v24.22.1 下先跑了官方测试，14 条全过，然后直接 `import` 构建产物里的 `searchDocs` / `getDoc`。没有连 MCP 客户端，也没有把摘要逐条跟官方页面核对。

正常查询是能用的。搜「分包」，前两条是 `pages.json` 和 `wx.subpackages`；在 Element Plus 里搜「表单 校验」，`el-form` 排在第一。接下去我随手丢了几个英文词，结果就偏了。

## 搜 platform，出来的是 Form 表单

```text
query: "platform"
- el-form   [Element Plus]  score=3  kw+3 "form" via t.includes(k)
- van-form  [Vant]          score=3  kw+3 "form" via t.includes(k)
```

`information`、`performance`、`format` 也是这两条，分数一样。评分函数在 `src/lib/docs.ts`，对每个检索词 `t` 做四件事：id 命中加 5，标题命中加 4，关键词命中加 3，摘要命中加 1。关键词这一行原来是：

```ts
if (d.keywords.some((k) => k.toLowerCase().includes(t) || t.includes(k.toLowerCase()))) score += 3
```

后半段 `t.includes(k)` 的意思是：只要检索词里包含某个关键词，就算命中。`form` 是表单条目的关键词，而 `platform`、`information`、`performance`、`format` 都包含 `form` 这四个字母，于是两条 Form 文档就出现了。它们的标题、id、摘要里都没有 platform 或 information。

## https 会和 http 打成平手

搜 `https`：

```text
- uni.request  [uni-app]     score=4  kw+3 "http" via t.includes(k) | summary+1
- wx.domain    [微信小程序]  score=4  kw+3 "https" via eq           | summary+1
```

`wx.domain` 本身就是讲合法域名、必须用 https 的，关键词里就有 `https`。`uni.request` 能排到并列第一，是因为关键词写了 `http`，而 `https`.includes(`http`) 为真，先加了 3 分；摘要里提到「小程序需在后台配置 https 合法域名」，再加 1 分。两条都是 4 分，排序稳定时 `uni.request` 会排在前面。

把查询写成「https 合法域名」时，`wx.domain` 会回到第一，这是对的。但只敲 `https` 时，网络请求接口会压过域名配置，就是这段子串规则造成的。

## 搜 MP，会碰到 compile、import、jumper

`MP` 会被转成小写 `mp`。`condition-compile` 能排到第一，一部分是关键词 `MP-WEIXIN` 合理命中，另一部分是 id 里的 `compile` 包含 `mp`，直接加了 5 分。`el-auto-import` 的 id 里有 `import`，同样加 5 分，其实这条讲的是 Element Plus 按需引入。排在后面的几条更勉强：`uni.navigate` 的摘要里有 `encodeURIComponent`，`uni.requestPayment` 里有 `timeStamp`，`el-pagination` 的摘要里有 `jumper`，都只因为中间这段 `mp` 加了 1 分。

默认只返回 5 条，这些误伤会把更相关的条目挤出去。`lib` 过滤器也是精确匹配：写成 `uniapp` 会得到空数组，必须是 `uni-app`。

`getDoc` 按 id 精确取值，大小写和首尾空格都不放过。`uni.request` 能取到，`uni.Request` 和 `uni.request `（多一个空格）都是 `undefined`。搜索那边会做 `toLowerCase()`，取值这边不做，两种调用的松紧不一致。

## 补丁和还没做的事

补丁里关键词只保留 `k.includes(t)`，不再用检索词包含关键词来加分；`getDoc` 改为忽略大小写并去掉首尾空白。原来的 14 条测试仍然通过，并补了 `platform` / `information` / `performance` 应无结果、以及搜 `https` 时 `wx.domain` 应排在第一的断言。改的是 TypeScript 源文件，需要重新构建。还没有提交，也没有推送。

补丁之后，`uni.request` 仍可能出现在 `https` 的结果里，因为它的摘要确实写了 https 合法域名，只是不会再靠 `http` 这个短词拿到 3 分、排到最前。摘要里提到某个词仍会加 1 分，比如「表单 校验」在 Element Plus 下仍会带上 `el-dialog`、`el-upload`（摘要里分别出现了「重置表单」和「校验类型和大小」）。这 30 条本来就不是完整的官方文档检索，查到之后还是要打开每条自带的官方链接。

仓库：https://github.com/MsNan/cn-dev-mcp

</div>
