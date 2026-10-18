---
title: "公众号吞掉了我的 class：做一个 Markdown 多平台排版工具踩过的坑"
date: 2026-10-18
category: 前端
tags: [JavaScript, Markdown, markdown-it, 公众号, 小红书]
description: "公众号会过滤 style 和 class：用 markdown-it 内联全部样式、代码高亮转内联颜色、外链转脚注，以及把长文拆成小红书 3:4 卡片并导出 1080×1440 PNG 的实现和踩坑。"
---

我平时写技术文章都用 Markdown，写完要往好几个地方发：掘金、CSDN 直接贴 Markdown 就行，麻烦的是公众号。第一次把 Markdown 渲染出来的 HTML 贴进公众号编辑器，代码高亮全没了，标题样式掉光，代码块的缩进也被吃掉，外链还点不开。

市面上的公众号排版器不少，但我还想顺手把同一篇文章拆成小红书的 3:4 图片卡片，找了一圈没有合适的，就自己写了一个纯前端的小工具。这篇不讲工具怎么用，主要记录两个实际的工程问题：**怎么让 Markdown 在公众号编辑器里活下来**，以及**怎么把长文拆成卡片并导出 1080×1440 的 PNG，同时不把代码块拆开**。代码都来自项目源码，为了好读做了一些删减。

## 公众号编辑器会留下什么

先说结论：公众号编辑器粘贴富文本时，会过滤掉 `<style>` 标签和 `class` 属性，基本只认元素自己身上的内联 `style`。所以平时那套"Markdown 渲染成 HTML + 一份 CSS"的做法完全行不通，CSS 写得再好看，粘过去也只剩裸标签。

办法只有一个：**每个元素都自带样式**。我把主题定义成"元素名 → 样式字符串"的映射：

```js
const base = (c) => ({
  h2: `font-size:19px;font-weight:700;color:${c.primary};margin:28px 0 14px;padding-left:10px;border-left:4px solid ${c.primary};`,
  p: `margin:12px 0;`,
  strong: `font-weight:700;color:${c.primary};`,
  blockquote: `margin:16px 0;padding:10px 14px;background:${c.soft};border-left:4px solid ${c.primary};`,
  code: `font-family:Menlo,Consolas,monospace;font-size:13px;background:${c.soft};color:${c.primary};padding:2px 5px;border-radius:4px;`,
  // ... ul / li / table / th / td / img / hr 等
})
```

换主题时只换颜色变量（翡翠绿、极简黑、活力橙、科技蓝四套），结构不动。

渲染用的是 markdown-it。它的好处是每种 token 都有对应的渲染规则，可以逐个改写。对段落、标题、列表、表格这些"开标签"，我在渲染前把样式塞进 token 的属性里，再交给默认的 `renderToken`：

```js
const tags = { heading_open: null, paragraph_open: 'p', blockquote_open: 'blockquote',
  bullet_list_open: 'ul', list_item_open: 'li', table_open: 'table', th_open: 'th', td_open: 'td',
  strong_open: 'strong', em_open: 'em' }

for (const [rule, key] of Object.entries(tags)) {
  md.renderer.rules[rule] = (tokens, idx, opts, env, self) => {
    const t = tokens[idx]
    const k = key || t.tag // 标题按 h1/h2/h3 分别取样式
    if (S[k]) t.attrJoin('style', S[k])
    return self.renderToken(tokens, idx, opts)
  }
}
```

这样写的好处是不用自己拼开标签，属性转义、嵌套这些都还是 markdown-it 处理。另外我把 markdown-it 的 `html` 选项关掉了，用户粘进来的原始 HTML 会被转义，不会在预览里执行脚本。

## 代码高亮：把 class 翻译成颜色

highlight.js 的输出长这样：`<span class="hljs-keyword">if</span>`。粘进公众号后 class 被删，颜色自然就没了。我的做法是高亮完以后再扫一遍，把 class 换成内联颜色：

```js
export function highlightInline(code, lang, palette) {
  let html
  try {
    html = lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : hljs.highlightAuto(code).value
  } catch {
    html = escapeHtml(code)
  }
  return html.replace(/<span class="([^"]+)">/g, (_, cls) => {
    const key = cls.split(/\s+/)
      .map((c) => c.replace(/^hljs-/, ''))
      .find((c) => palette[c]) || ''
    const extra = cls.includes('comment') ? 'font-style:italic;' : ''
    return key ? `<span style="color:${palette[key]};${extra}">` : '<span>'
  })
}
```

有几个细节：

- 一个 span 可能有多个 class，比如 `hljs-title function_`，所以要拆开后找第一个在调色板里有定义的。
- 找不到颜色的 class 不能直接删掉整个 span，否则后面的 `</span>` 就对不上了，所以替换成一个干净的 `<span>`。
- 语言写错或者不认识时，`hljs.highlight` 会抛错，这里退回到转义后的纯文本，至少内容不会丢。

调色板准备了深色、浅色两套。用哪套不是按主题名硬编码的，而是根据代码块背景色算一下亮度：

```js
export function codePalette(theme) {
  const bg = theme.colors.codeBg.replace('#', '')
  const lum = parseInt(bg.slice(0, 2), 16) * 0.299
            + parseInt(bg.slice(2, 4), 16) * 0.587
            + parseInt(bg.slice(4, 6), 16) * 0.114
  return lum < 128 ? DARK : LIGHT
}
```

以后加新主题只要给一个代码背景色，高亮配色会自己跟上。

## 代码块的换行和缩进

颜色解决了，又遇到第二个问题：粘进公众号以后，代码块里的换行和行首空格经常会被吞掉，Python 这种靠缩进的代码基本就没法看了。`<pre>` 的 `white-space:pre` 在这里靠不住。

我最后的处理比较"土"，但很稳：不依赖 `white-space`，直接把格式写死在 HTML 里——换行转成 `<br/>`，行首空格转成 `&nbsp;`，Tab 转成 4 个 `&nbsp;`：

```js
md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx]
  const lang = (t.info || '').trim().split(/\s+/)[0]
  const code = t.content.replace(/\n$/, '')
  const body = highlightInline(code, lang, palette)
    .split('\n')
    .map((l) => l
      .replace(/^( +)/, (m) => '&nbsp;'.repeat(m.length))
      .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;'))
    .join('<br/>')
  return `<pre style="${S.pre}"><code style="${S.preCode}white-space:nowrap;">${body}</code></pre>\n`
}
```

注意这里是在高亮**之后**再按 `\n` 切行。highlight.js 有时会让一个 span 跨行（比如多行注释），先切行再高亮会把标签切断。

加 `white-space:nowrap` 是为了让长行不自动折行，配合 `<pre>` 上的 `overflow-x:auto` 横向滚动，手机上看代码不会被折得乱七八糟。

这个方案有个已知的局限：我只替换了**行首**的空格。行中间连续的多个空格（比如为了对齐注释）在 `nowrap` 下还是会被合并成一个。对大部分代码影响不大，但如果你的代码依赖行内对齐，需要注意。

## 外链：改成文末脚注

公众号正文里只有公众号自己的文章链接能点，其他外链点了没反应。与其留一堆点不动的蓝字，不如学纸质书，把链接收集起来放到文末。

markdown-it 的渲染规则第四个参数是 `env`，同一次 `render` 调用里共享，正好拿来收集链接：

```js
md.renderer.rules.link_open = (tokens, idx, opts, env) => {
  const href = tokens[idx].attrGet('href') || ''
  env.links ||= []
  if (/^https?:\/\/mp\.weixin\.qq\.com/.test(href)) { // 公众号文章链接保留
    env.inlineLink = true
    return `<a href="${escapeHtml(href)}" style="${S.a}">`
  }
  env.links.push(href)
  env.inlineLink = false
  return `<span style="${S.a}">`
}
md.renderer.rules.link_close = (tokens, idx, opts, env) =>
  env.inlineLink ? '</a>' : `</span><sup style="color:${primary};font-size:12px;">[${env.links.length}]</sup>`
```

`link_open` 和 `link_close` 是分开调用的，close 的时候并不知道 open 输出了 `<a>` 还是 `<span>`，所以用 `env.inlineLink` 记一下状态。渲染完以后，如果 `env.links` 不为空，就在文末追加一个"参考链接"小节，按编号列出地址。

这里也是为什么公众号和预览要用两套渲染配置：预览里链接要能点，公众号里要转脚注，其他样式完全一样。

## 复制：要写 text/html，不是 text/plain

HTML 生成好了，还得让用户"复制一下就能粘进去"。`navigator.clipboard.writeText` 只能写纯文本，粘进去会是一堆标签源码。需要用 `ClipboardItem` 同时写入 `text/html` 和 `text/plain`：

```js
await navigator.clipboard.write([new ClipboardItem({
  'text/html': new Blob([html], { type: 'text/html' }),
  'text/plain': new Blob([plain], { type: 'text/plain' }),
})])
```

有些浏览器（或非 HTTPS 环境）不支持 `ClipboardItem`，这时退回到老办法：把 HTML 塞进一个移到屏幕外的 div，用 `Range` 选中，再 `document.execCommand('copy')`。这个 API 已经标记为废弃，但作为兜底目前还能用。

## 小红书卡片：怎么分页才不切坏代码

小红书只能发图片，所以思路是：把 Markdown 拆成若干段，每段渲染成一张 3:4 的卡片，再导出成图片。难点在"拆"。

第一步是把文本切成"块"，块是最小的不可拆单位。关键是遇到代码围栏时要进入"代码模式"，在围栏闭合之前，空行、标题、分页符统统不处理：

```js
for (const l of lines) {
  if (/^\s*(```|~~~)/.test(l)) { inCode = !inCode; cur.push(l); if (!inCode) flush(); continue }
  if (inCode) { cur.push(l); continue }                         // 代码块内部原样收集
  if (CARD_BREAK.test(l)) { flush(); out.push('\u0000BREAK'); continue } // === 或 <!-- card -->
  if (l.trim() === '') { flush(); continue }                    // 空行结束一个段落
  if (/^#{1,6}\s/.test(l)) { flush(); out.push(l); continue }   // 标题单独成块
  cur.push(l)
}
```

如果只是简单地按空行切段落，代码里只要有一个空行，代码块就会被劈成两张卡片，后半张没有开头的围栏，渲染出来是乱的。加上 `inCode` 判断以后，一个代码块无论多长都是一个整体。

第二步是装箱。卡片的高度是固定的，但"一段内容占多高"没法在纯函数里精确算，我用了一个粗略的"重量"估计：

```js
export function weight(b) {
  if (/^\s*(```|~~~)/.test(b)) return b.split('\n').length * 22 // 代码按行算，每行很占地方
  if (/!\[[^\]]*\]\([^)]+\)/.test(b)) return 220                 // 图片基本占大半张
  if (/^#{1,2}\s/.test(b)) return 40
  return b.replace(/\s/g, '').length + b.split('\n').length * 8   // 正文按字数
}
```

分页规则很简单：一级标题当封面；遇到二级标题就换一张新卡；当前卡累计重量超过 260 也换一张。只要正文里出现过一次 `===`，就认为作者想自己控制分页，自动规则全部关掉。

这些数字是对着 360px 宽的预览卡片调出来的经验值，不是什么精确模型，估算一定会有不准的时候。比如一个二三十行的代码块本身就超过一张卡的容量，又不能拆，那它只能单独占一张，并且溢出。

## 估算不准时：让 DOM 来判断

既然纯函数算不准，那就在渲染后用 DOM 兜底。卡片内容区是固定高度加 `overflow:hidden`，渲染完比较一下 `scrollHeight` 和 `clientHeight`：

```js
watch([pages, S], async () => {
  await nextTick()
  overflow.value = cardEls.value.map((el) => {
    const ct = el.querySelector('.content')
    return ct ? ct.scrollHeight > ct.clientHeight + 2 : false
  })
}, { immediate: true })
```

溢出的卡片下面会出现一行提示，建议用 `===` 手动分页。那个 `+ 2` 是给小数像素的舍入留的余量，避免内容刚好贴边时被误判成溢出。

这样分工比较舒服：自动分页负责"大部分情况差不多"，DOM 检测负责"告诉你哪里不对"，最终决定权交给作者。

## 导出 1080×1440

卡片在页面上是这样定义的：

```css
.card { width: min(360px, calc(100vw - 40px)); aspect-ratio: 3 / 4; }
```

导出用的是 html-to-image 的 `toPng`。想要固定输出 1080 宽，不是去改卡片的 CSS 尺寸，而是动态算 `pixelRatio`：

```js
async function render(i) {
  const el = cardEls.value[i]
  return toPng(el, { pixelRatio: 1080 / el.offsetWidth, cacheBust: true })
}
```

电脑上卡片宽 360px，倍率就是 3；手机屏幕窄，卡片可能只有 330px 左右，倍率会自动变大。因为有 `aspect-ratio: 3 / 4`，宽度是 1080 时高度自然就是 1440，不用单独处理。批量导出就是循环调用 `render`，把 dataURL 的 base64 部分塞进 JSZip，打包成一个 zip 下载。

这里踩过两个坑：

1. **图片跨域**。html-to-image 的原理是把 DOM 序列化进 SVG 的 `foreignObject` 再画到 canvas 上，卡片里如果有不允许跨域的外部图片，canvas 就会被"污染"，导出直接失败。我没办法在前端绕过这个限制，只能在报错提示里写清楚：换一个支持跨域的图床。
2. **内联样式反过来坑了自己**。卡片内容复用了公众号那套渲染函数，样式全是内联的，而"暗夜极客"这种深色卡片需要浅色文字。内联样式优先级最高，普通 CSS 盖不住，只能二选一：对字号这种通用调整用 `:deep(h2) { font-size: 20px !important; }`，对文字颜色则直接在渲染结果上把主题的正文色字符串替换成卡片的文字色。不算优雅，但范围可控。

## 写在最后

回头看，这个工具没有用到什么复杂技术，核心转换逻辑（公众号渲染、Markdown 规范化、卡片拆分）都是和界面无关的纯函数，放在 `src/core/` 下，用 Vitest 写了单元测试，比如"输出里不能有 class 和 `<style>`""代码块不会被拆开"这种断言。排版工具很容易出现"改了 A 坏了 B"的情况，有测试兜着心里踏实很多。

另外它只做排版，不碰任何平台的登录和发布，全部在浏览器本地跑，文章不会上传。如果你也有一稿多发的需求，或者想参考 markdown-it 自定义渲染规则的写法，可以看看源码，有问题欢迎提 issue。

项目地址：[md-multi-format](https://github.com/MsNan/md-multi-format)
