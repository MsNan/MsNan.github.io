---
title: "H5 能跑、小程序白屏：为什么 ESLint 抓不住 uni-app 的条件编译"
date: 2026-11-27
category: 前端
tags: [JavaScript, uni-app, 小程序, 条件编译]
description: "普通 ESLint 不理解 #ifdef、renderjs 和 platforms/h5；组合条件 H5 || MP-WEIXIN 里的 document 仍会进小程序，平台名写成 MP_WEIXIN 时 ifdef 不会生效。"
---

<div v-pre>

uni-app 项目里有一种很常见的情况：H5 调试一切正常，一编到微信小程序，控制台就开始报 `document is not defined`，页面白屏。官方其实把原因写得很清楚。[注意](https://uniapp.dcloud.io/matter.html) 里说，小程序和 App 的 JS 跑在 JSCore 里，不是浏览器，没有 `document`、`window`、`localStorage`、`navigator`、`XMLHttpRequest` 这些对象；[JS 语法](https://uniapp.dcloud.io/tutorial/syntax-js.html) 也强调，不要把浏览器扩展出来的对象当成标准 JS。该用条件编译把浏览器相关代码只留给 H5，或者在 App 视图层用 renderjs。

问题是，这类错误用普通 ESLint 不太好抓。`no-restricted-globals` 可以禁止 `window` / `document`，但它不认 `// #ifdef H5`，也不认 `lang="renderjs"` 和 `platforms/h5` 目录。结果往往是：写在条件编译里、本来只给 H5 用的代码被误报；平台名写错、条件编译根本没生效的代码，反而漏掉。样式里的官方 CSS 变量 `var(--window-top)`、`var(--window-bottom)` 如果被当成 JS 的 `window`，还会再误报一次。

所以我做了一个离线的小检查器 `uniapp-compat-check`（v0.1.0，提交 b61f5e6）。它不发明规则，每条都对着官方文档：未用条件编译包起来的浏览器对象、axios / jQuery、会进小程序的 `v-html`、出现在非 App 代码里的 `plus` / Native.js，以及 `#ifdef` 未闭合、平台名不在官方 %PLATFORM% 表里。和之前那个 `uniapp-sec-check` 分工不同：那个管密钥、明文 http、权限和分包结构，这个只看跨端 API 和条件编译，也不替代 ESLint。package.json 版本是 0.1.0，没有打 git tag，也没有发 npm。

今天我在 Node v24.22.1 下对着这个提交跑仓库测试，20 条全绿；GitHub Actions 的 Node 18、20、22 也通过（run 45878421811）。下面的例子来自仓库自带的夹具，以及我在本机实际跑出来的输出。我没有在真实上线的商业项目里跑全量扫描，也没有用微信开发者工具做一次完整编译来对照。

## 组合条件并不等于「只在 H5 生效」

官方条件编译文档里有一个例子：`#ifdef H5 || MP-WEIXIN` 表示这段代码会进 H5，也会进微信小程序。如果在这个块里写 `document.title`，H5 没问题，小程序照样会报错。需要再包一层 `#ifdef H5`，或者把浏览器代码拆出去。

我用仓库里的 `test/fixtures/mixed-app` 跑了 `node bin/cli.js test/fixtures/mixed-app`，输出是 3 个错误、0 个警告。其中两条 WEB001 分别是：

- `pages/index.vue:17` 的 `document.title`，它写在 `// #ifdef H5 || MP-WEIXIN` 里，所以被报出来；
- 同文件更下面还有一处会进非 H5 的 `window`。

同一段里，内层又包了 `// #ifdef H5` 的 `document.body.className` 没有报。`typeof window !== 'undefined'` 这种特征检测没有报。字符串和注释里的 `document` 也没有报。该文件样式不在这个夹具里，但干净夹具 `clean-app` 的 `<style>` 里写了 `var(--window-top)` 和 `var(--window-bottom)`，扫描 5 个文件，0 个错误 0 个警告。检查器在 Vue 单文件里只扫 `<script>`，不会把 CSS 变量里的 `window` 当成浏览器对象。

`clean-app` 里，`document.title` / `window.scrollTo` 写在 `#ifdef H5` 中，`plus.runtime` 写在 `#ifdef APP-PLUS` 中，`v-html` 分别用 H5 和 APP-PLUS 包起来，renderjs 脚本里也可以用 `document`，这些都视为安全。

## 平台名写错时，#ifdef 等于没写

更隐蔽的是平台名。官方 [条件编译](https://uniapp.dcloud.io/tutorial/platform) 写得很明确：未定义的平台名称（写错了，或当前 HBuilderX 还不认识），`#ifdef` 里的代码不会生效，`#ifndef` 里的代码会生效。大小写和连字符必须和官方表一致，微信小程序是 `MP-WEIXIN`，不是 `MP_WEIXIN`，也不是 `mp_weixin`。

`test/fixtures/bad-app` 里就有一处 `// #ifdef MP_WEIXIN`。跑 `node bin/cli.js test/fixtures/bad-app`，除了未包裹的 `document` / `window` / `localStorage` 等 14 个错误，还有 3 个警告，其中一条 IFDEF002 的原文是：「未定义的平台名称：MP_WEIXIN。官方规定此时 #ifdef 中的代码不会生效。」也就是说，你以为已经用条件编译把代码保护起来了，编译时这块根本不会按「仅微信小程序」留下，保护等于没写。

另外补一句：官方在「注意」里列举的是 `localstorage`，检查器把同属 Web Storage 的 `sessionStorage` 也纳入了 WEB001。这是按同类对象补的，不是官方原文逐字列出的名字。工具也不做完整 JS 解析，`const d = document` 再使用 `d`、拼接出来的平台名，以及运行期 `if (uni.getSystemInfoSync().uniPlatform === 'web')` 这种判断，都检查不到。

项目根目录（有 `manifest.json` 或 `src/manifest.json`）可以直接跑：

```bash
npx -y github:MsNan/uniapp-compat-check
```

仓库：https://github.com/MsNan/uniapp-compat-check

</div>
