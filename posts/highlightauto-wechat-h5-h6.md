---
title: "没标语言的代码块被认成 Perl：highlightAuto 在公众号排版里的误判，以及比正文还小的 h5/h6"
date: 2026-11-01
category: 前端
tags: [JavaScript, highlight.js, 公众号, CSS]
description: "未标语言或 vue/nginx 等不认识的代码块走 highlightAuto，目录树被认成 CSS、日志成 YAML、短 Vue 模板成 Perl，还拖慢预览；relevance 阈值也救不了。附改法和 h5/h6 字号问题。"
---

我那个 Markdown 多平台排版工具，公众号那一路是把 highlight.js 的输出转成内联颜色再塞进 `<pre>`。前几天整理还没处理的问题时，列表里有两条一直没动：没标语言的代码块会被自动上色，五六级标题没有样式。本来以为都是小毛病，这两天真去跑了一下，发现前一条比我想的离谱。

## 代码是怎么上色的

渲染代码块的函数就这一句关键逻辑：

```js
html = lang && hljs.getLanguage(lang)
  ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  : hljs.highlightAuto(code).value
```

写了语言、并且 highlight.js 认识，就按这个语言高亮；否则交给 `highlightAuto`，让它自己猜。拿到 `<span class="hljs-keyword">` 这种输出后，再按一张颜色表把 class 换成 `style="color:..."`，因为公众号会把 class 全部过滤掉。

当初的想法是：很多人写 Markdown 懒得标语言，自动识别一下，好歹有点颜色。

## 喂几段常见的"没标语言"的内容

我写技术文章时，不标语言的代码块基本是这几类：目录树、日志、报错输出、几行操作步骤。挑了几段真实长相的内容，直接调 `hljs.highlightAuto`（highlight.js 11.12.0，项目里引的是 `highlight.js/lib/common`），看它猜成什么、哪些片段被上了色：

```text
src/
├── core/
│   ├── render.js
│   └── themes.js
└── main.js
```

结果被认成 **CSS**（relevance 2，第二名 less 是 1）。`src` 被当成属性名，`.js` 被当成类选择器，`main` 被当成标签选择器，各上一种颜色。

日志：

```text
2026-10-31 09:12:03 INFO  server started on :3000
2026-10-31 09:12:05 ERROR connect ECONNREFUSED 127.0.0.1:5432
```

被认成 **YAML**（relevance 2）。日期时间整段是数字色，`INFO`、`server`、`started`、`on` 每个单词都是字符串的绿色，`ERROR` 也是绿的，IP 地址被拆成 `127.0`、`.0`、`.1` 三个数字。

npm 报错：

```text
npm ERR! code ERESOLVE
npm ERR! While resolving: demo@1.0.0
npm ERR! Found: vue@3.5.13
```

被认成 **Ruby**。`ERR` 是常量色，`While` 和 `Found` 被当成类名，`resolving:` 是符号色，`demo@1.0.0` 里的 `@1` 被当成 Ruby 的实例变量。

三行中文操作步骤（里面有个 `"隐私"` 和 `config.json`）被认成 **Lua**，引号那段变成字符串，`config` 被当成内置函数。

还有一个反过来的例子：`npm install` / `npm run dev` 两行，`highlightAuto` 一个语言都没给（relevance 0），完全不上色。也就是说，同样是"没标语言的命令"，有的有颜色有的没有，读者看不出规律。

这些颜色单看都不算错，highlight.js 只是在按它见过的语法打分。问题在于放到公众号文章里，读者会以为这些颜色有含义：日志里 `ERROR` 和 `INFO` 一样绿，目录树里 `main` 和 `.js` 不同色，反而干扰阅读。

## 标了语言也会走到自动识别

更隐蔽的是这个分支条件：`hljs.getLanguage(lang)` 认不出来时，同样走 `highlightAuto`。`lib/common` 只打包了 36 种语言，我逐个查了一遍常用的标签：

- 认识：`text`、`txt`、`plaintext`、`sh`、`shell`、`console`、`bash`、`ts`、`tsx`、`jsx`、`jsonc`、`yaml`、`toml`、`ini`、`sql`、`diff`、`scss`、`less`
- 不认识：`vue`、`wxml`、`nginx`、`dockerfile`、`powershell`、`bat`、`http`、`mermaid`

`vue` 不认识这一点对我影响最大，我自己的文章里 uni-app 代码几乎都标 ```` ```vue ````。拿一段很短的模板试：

```vue
<template>
  <view class="box">{{ title }}</view>
</template>
```

`highlightAuto` 给出的是 **Perl**，relevance 7，第二名 xml 只有 5。渲染出来 `class` 是关键字色，`box` 被当成类名，最离谱的是 `/view>` 一直到下一行的 `</` 被当成了一个正则表达式，整段刷成绿色。

但同一个 ```` ```vue ```` 标签，内容长一点、带上 `<script setup>` 之后，又会被正确认成 xml（relevance 14），script 里的 JS 也正常高亮。所以文章里的 Vue 代码块颜色时对时错，取决于这一块有多长。

`nginx` 和 `dockerfile` 也一样：一段 nginx 的 `server {}` 配置被认成 Perl，`listen` 成了关键字，`http://127.0.0.1` 里的 `//` 被当成正则；Dockerfile 被认成 SQL，`FROM`、`COPY` 碰巧是 SQL 关键字所以上了色，`WORKDIR`、`RUN` 没有。

## 能不能加个 relevance 阈值

第一反应是：relevance 太低就不上色。但上面的数据把这条路堵了——认错的目录树和日志 relevance 是 2，认对的一段 JSON 是 4.02，而把 Vue 模板认成 Perl 的那次是 7，比认对的 JSON 还高。阈值定在哪都会一边误伤一边漏掉。

## 顺带一个性能问题

`highlightAuto` 的实现是把所有已注册语言都跑一遍再比分数。在这个工具里，公众号预览是一个 `computed`：

```js
const wechatHtml = computed(() => toWechat(text.value, theme.value))
```

`text` 绑在 textarea 的 `v-model` 上，停在公众号标签页时每敲一个字都会重新渲染整篇。我在本机用 Node 20 测了一个 200 行、没标语言的日志代码块：`toWechat` 平均 63.0 ms 一次；同样内容标成 `plaintext`，0.3 ms。正文里有一两段长日志，打字就能感觉到卡。

## 我的改法

思路是：**不标语言就不上色，标了但不认识的先查别名，查不到也不上色**，不再调用 `highlightAuto`。

```js
import nginx from 'highlight.js/lib/languages/nginx'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import powershell from 'highlight.js/lib/languages/powershell'

hljs.registerLanguage('nginx', nginx)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('powershell', powershell)

// 小程序 / Vue 的标记语言按 XML 高亮（<script> 里的 JS 由 xml 子语言处理）
const LANG_ALIAS = { vue: 'xml', nvue: 'xml', uvue: 'xml', wxml: 'xml', axml: 'xml', swan: 'xml', wxss: 'css', acss: 'css' }

export function highlightInline(code, lang, palette) {
  let html
  const name = LANG_ALIAS[(lang || '').toLowerCase()] || lang
  try {
    html = name && hljs.getLanguage(name)
      ? hljs.highlight(code, { language: name, ignoreIllegals: true }).value
      : escapeHtml(code)
  } catch { html = escapeHtml(code) }
  // ...后面 class 转内联颜色的部分不变
}
```

几点说明：

- 知乎那一路本来就是这么处理的：没标语言时输出 `class="language-plaintext"`，交给知乎自己处理。公众号这一路改完和它一致了。
- 把 vue 映射成 xml 而不是引第三方的 vue 语法包，是因为 highlight.js 的 xml 定义里 `<script>`、`<style>` 会切到 JS/CSS 子语言，对 SFC 来说够用。`{{ }}` 插值不会高亮，这点我能接受。
- 单独注册三个语言后，Vite 打出来的 JS 从 453.41 kB 变成 459.96 kB（gzip 163.87 → 166.46 kB）。

改完再跑一遍：目录树、日志、npm 报错、中文步骤都不再上色；短的 Vue 模板标签名、属性、属性值按 XML 正确着色；Dockerfile 的 `FROM`、`WORKDIR`、`COPY`、`RUN` 都是关键字色；200 行日志块的渲染从 63.0 ms 降到 0.5 ms。

nginx 还留了个尾巴：它的 `server`、`location` 输出的是 `hljs-section`，而我的颜色表里没有 `section` 这一项，所以这两个词目前不上色，`listen`、`proxy_pass` 这种指令按 attribute 着色。这个等我想好配色再加。

## 五级、六级标题比正文还小

另一个问题和高亮无关，但也是"没配置就走默认值"导致的。

标题的渲染规则是按 `token.tag` 去主题里取样式，主题只写了 `h1` 到 `h4`。`#####` 和 `######` 渲染出来就是光秃秃的 `<h5>`、`<h6>`，字号完全交给浏览器默认样式表。

问题在于外层容器把正文设成了 15px，而浏览器默认的 h5 是 `0.83em`、h6 是 `0.67em`。我用 Chrome 156 无头模式把渲染结果打开，读 `getComputedStyle`：

| 元素 | 字号 | 上下外边距 |
| --- | --- | --- |
| h3 | 17px | 22px / 10px |
| h4 | 16px | 18px / 8px |
| h5 | 12.45px | 20.79px / 20.79px |
| h6 | 10.05px | 23.42px / 23.42px |
| p | 15px | 12px / 12px |

五级标题比正文小两号多，六级标题只有 10px，上下还各留了二十多像素的空。在预览里看就像一行掉了队的小字。公众号编辑器粘贴进去会怎么显示，取决于它自己的默认样式，我没有在公众号后台逐一核对，但"不写死就不可控"这一点是确定的。

改法就是在主题里补两条，字号不低于正文，用颜色和粗细区分层级：

```js
h5: `font-size:15px;font-weight:700;color:${c.text};margin:16px 0 8px;`,
h6: `font-size:15px;font-weight:700;color:${c.muted};margin:16px 0 8px;`,
```

## 最后

这两处改动加上 4 条测试（无语言不上色、vue 按 xml、nginx 能高亮、h5/h6 有内联字号），原来的 33 条测试和新增的一共 37 条都通过。补丁还没合进仓库，等我在公众号后台实际贴几篇确认效果再合。

回头看，这两个问题本质上是一回事：给一个"没指定"的情况选了默认行为，而这个默认行为在我的场景里是错的。代码高亮这件事上，不上色永远不会误导人，上错了色才会。

仓库：https://github.com/MsNan/md-multi-format
