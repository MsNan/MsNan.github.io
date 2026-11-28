---
title: "#ifdef H5 || MP-WEIXIN 里写了 document，小程序端还是会报错"
date: 2026-11-27
category: 前端
tags: [JavaScript, uni-app, 微信小程序, 条件编译]
description: "官方组合条件会同时编进 H5 和微信小程序；平台名写成 MP_WEIXIN 时，#ifdef 里的保护代码不会生效。"
---

<div v-pre>

今天对着一份 mixed 夹具把检查器跑完，有一条结果我自己也要再看一眼才放心：`document.title = 'both'` 已经写在条件编译里了，还是被报成 WEB001。

打开文件才想起来，那一行外面是这样的：

```js
// #ifdef H5 || MP-WEIXIN
document.title = 'both';
// #ifdef H5
document.body.className = 'only-h5';
// #endif
// #endif
```

官方条件编译文档举过几乎一样的例子：`#ifdef H5 || MP-WEIXIN` 表示这段代码在 H5 **或** 微信小程序都会存在。所以 `document.title` 会进小程序逻辑层。小程序的 JS 不在浏览器里跑，[注意](https://uniapp.dcloud.io/matter.html) 和 [JS 语法](https://uniapp.dcloud.io/tutorial/syntax-js.html) 都写了，没有 `document`、`window` 这些对象。H5 调得再顺，编到微信端也可能直接 `document is not defined`。

内层那个 `#ifdef H5` 包住的 `document.body.className` 没有报，这是对的。同文件里 `typeof window !== 'undefined'` 没报，字符串里的 `"document.getElementById('x')"` 也没报。我是用仓库 `uniapp-compat-check`（v0.1.0，提交 b61f5e6）在 Node v24.22.1 下跑的，`node bin/cli.js test/fixtures/mixed-app` 输出 3 个错误、0 个警告；仓库测试 20/20，Actions run 45878421811 的 Node 18、20、22 都是 success。没有打 tag，也没有发 npm。

同一份输出里还有一条 HTML001：`v-html` 也写在 `<!-- #ifdef H5 || MP-WEIXIN -->` 里。官方说 `v-html` 在 H5 和 App-Vue 支持，小程序不支持，所以组合条件仍然会进微信端，照样报错。

和这件事容易搅在一起的，是平台名写错。bad-app 夹具里有一行 `// #ifdef MP_WEIXIN`。官方表里的名字是 `MP-WEIXIN`，中间是连字符，而且要大写。[条件编译](https://uniapp.dcloud.io/tutorial/platform) 写得很死：未定义的平台名（写错，或当前 HBuilderX 还不认识），`#ifdef` 中的代码不会生效，`#ifndef` 中的代码会生效。我跑 `node bin/cli.js test/fixtures/bad-app` 时，这条以 IFDEF002 警告出现，原文就是「未定义的平台名称：MP_WEIXIN。官方规定此时 #ifdef 中的代码不会生效」。看起来像保护，编译时等于没包。

普通 ESLint 的 `no-restricted-globals` 不太能处理这些分层：它既可能误报 `#ifdef H5`、renderjs、`platforms/h5` 里合理的 `document`，也可能漏掉「条件写了但其实仍会进小程序」的代码。样式里的 `var(--window-top)` 也不是 JS 的 `window`；干净夹具的 `<style>` 里就有这两个官方 CSS 变量，扫完是 0 错误 0 警告，因为检查器在 Vue 单文件里只看 `<script>`。

它和 `uniapp-sec-check` 不是同一个东西，那个看密钥、明文 http、权限和分包，这个只看跨端 API 和条件编译。有些限制也要说在前面：不做完整 JS 解析，变量别名和拼出来的平台名检查不到；也不分析运行期的 `uniPlatform === 'web'`。官方原文列举的浏览器对象里是 `localstorage`，`sessionStorage` 是按同类 Web Storage 补进去的。我没有在真实上线的商业项目或微信开发者工具里做一次全量编译对照，规则可能有漏报或误报。

项目根目录（含 `manifest.json` 或 `src/manifest.json`）可以这样跑：

```bash
npx -y github:MsNan/uniapp-compat-check
```

仓库：https://github.com/MsNan/uniapp-compat-check

</div>
