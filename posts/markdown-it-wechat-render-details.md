---
title: "用 markdown-it 给公众号生成内联样式：表格、代码空格和链接脚注的几个细节"
date: 2026-10-29
category: 前端
tags: [JavaScript, markdown-it, 公众号, CSS]
description: "markdown-it 自定义渲染做公众号排版：attrJoin 用空格拼 style 导致表格边框和对齐丢失、nowrap 合并代码行中空格、按 token.markup 区分链接做脚注去重，以及还没修的几处。"
---

# 用 markdown-it 给公众号生成内联样式：表格、代码空格和链接脚注的几个细节

md-multi-format 是我写的一个小工具，把 Markdown 转成公众号、知乎能直接粘贴的 HTML。之前写过一篇讲"公众号会吞掉 class，所以要把样式全部内联"，那篇说的是大方向。这篇说几个更细的地方：都是 markdown-it 自定义渲染规则时容易写错的点，有两个是我自己写出来又改掉的 bug，还有几个到现在都没处理，一并列出来。

下面的代码都来自仓库当前版本（src/core/render.js），markdown-it 版本 15.0.3。

## 一、给 token 加样式别用 attrJoin

内联样式的思路很直接：覆盖 `paragraph_open`、`th_open`、`td_open` 这些规则，渲染之前往 token 上塞一个 `style` 属性。最早我是这么写的：

```js
md.renderer.rules[rule] = (tokens, idx, opts, env, self) => {
  const t = tokens[idx]
  if (inlineStyle && S[k]) t.attrJoin('style', S[k])
  return self.renderToken(tokens, idx, opts)
}
```

普通段落没问题，表格出事了。Markdown 表格写了对齐：

```md
| 名称 | 数量 |
|:---:|---:|
| 苹果 | 3 |
```

markdown-it 会自己给 `th`/`td` 加上 `style="text-align:center"`。`attrJoin` 的行为是：属性已存在就用**空格**把新值拼上去。于是生成了这样的东西：

```html
<th style="text-align:center border:1px solid #d1d5db;padding:8px 10px;background:#ecfdf5;font-weight:700;text-align:left;">
<th style="text-align:right border:1px solid #d1d5db;padding:8px 10px;background:#ecfdf5;font-weight:700;text-align:left;">
```

class 属性用空格拼是对的，style 用空格拼就成了 `text-align:center border:1px solid ...` 这一整条无效声明。我把这串 style 丢进 Chrome（156，headless）里，读 `element.style.cssText`：

```
padding: 8px 10px; background: rgb(236, 253, 245); font-weight: 700; text-align: left;
```

第一条声明整个被丢掉了，丢的不只是对齐，还有紧跟在后面的 `border`。表头边框没了，居中也没了（后面主题自带的 `text-align:left` 反而生效）。`td` 那边更惨，主题里没有 `text-align`，`text-align:right border:...;padding:8px 10px;` 解析完只剩 `padding: 8px 10px;`。

这个问题不报错，预览时也不容易发现，只是"表格怎么没边框"。现在的写法是自己读、自己拼：

```js
if (inlineStyle && S[k]) {
  const own = (t.attrGet('style') || '').trim()
  t.attrSet('style', S[k] + (own ? own.replace(/;?$/, ';') : ''))
}
```

顺序也有讲究：主题样式放前面，markdown-it 自带的对齐放后面。同一个属性写两次，后面的生效，所以主题里 `th` 默认的 `text-align:left` 会被表格里写的对齐覆盖。现在的输出：

```html
<th style="border:1px solid #d1d5db;padding:8px 10px;background:#ecfdf5;font-weight:700;text-align:left;white-space:nowrap;text-align:center;">
```

`own.replace(/;?$/, ';')` 是为了保证拼接处有分号，不管原来那段结尾有没有。

仓库里还有一处 `attrJoin`：不转脚注的预览模式下给 `link_open` 加样式。markdown-it 不会给链接自带 style，那里拼不出问题，就没动。

## 二、宽表格包一层可以横向滚动的容器

手机上列多的表格会被挤成一个字一行。现在 `table_open` 渲染完会在外面包一层 `section`，`table_close` 补上闭合标签：

```js
const out = self.renderToken(tokens, idx, opts)
if (inlineStyle && rule === 'table_open') return `<section style="${S.tableWrap}">` + out
```

```js
md.renderer.rules.table_close = (tokens, idx, opts, env, self) =>
  self.renderToken(tokens, idx, opts).replace(/\n$/, '') + '</section>\n'
```

配套的样式：

```js
tableWrap: `max-width:100%;overflow-x:auto;margin:16px 0;`,
table: `border-collapse:collapse;min-width:100%;margin:0;font-size:14px;word-break:normal;`,
th: `...;white-space:nowrap;`,
td: `...;min-width:3em;`,
```

表头不换行、单元格给个最小宽度，表格宽了就让外层滚动。这在浏览器预览里是对的。公众号编辑器粘贴后会不会保留 `section` 上的 `overflow-x`，我这次没有重新实测，代码注释里写的是"保留"。如果你照着做，粘进去以后在手机预览里自己看一眼。

## 三、white-space:nowrap 会把行中间的连续空格合并

代码块最早的问题是公众号会吃掉换行和缩进，所以换行转 `<br/>`、行首空格转 `&nbsp;`。后来发现只处理行首不够。这段代码：

```js
const a = 1   // 对齐
const bb = 22 // 对齐
```

注释是用空格对齐的。早期版本输出是：

```html
<span>const</span> a = <span>1</span>   <span>// 对齐</span>
```

`1` 后面三个普通空格。代码块的 `code` 样式在主题的 `white-space:pre` 后面又追加了 `white-space:nowrap`（后写的生效），而 `nowrap` 和默认的 `normal` 一样会合并连续空白，只是不换行。我在 Chrome 里量了一下同一行 `x = 1    //c` 的宽度：

```
white-space:pre，普通空格   94px
white-space:nowrap，普通空格 70px
white-space:nowrap，&nbsp;  94px
```

四个空格在 nowrap 下只剩一个的宽度，对齐就乱了。所以现在每一行高亮完之后，把文本里所有空格都换成 `&nbsp;`：

```js
export function preserveSpaces(line) {
  return line.split(/(<[^>]*>)/).map((part, i) =>
    (i % 2 ? part : part.replace(/\t/g, '    ').replace(/ /g, '&nbsp;'))).join('')
}
```

这里不能直接对整行 `replace(/ /g, '&nbsp;')`，因为 highlight.js 输出里有 `<span style="color:#xxx;">` 这样的标签，标签里的空格换掉就把 HTML 弄坏了。`split` 用带捕获组的正则，切出来的数组里奇数下标正好是标签，偶数下标是文本，只改文本部分。

现在同一段代码的输出：

```html
<span>const</span>&nbsp;a&nbsp;=&nbsp;<span>1</span>&nbsp;&nbsp;&nbsp;<span>//&nbsp;对齐</span><br/>
```

（为了好看，我把 style 属性去掉了。）

## 四、链接转脚注：靠 token 的 markup 区分三种链接

公众号正文里的外链点不了，常见做法是把链接变成上标编号，文末列出地址。第一版的写法是每遇到一个 `link_open` 就编一个号，结果有两个问题：

```md
看 [文档](https://a.com/x) 和 [再看](https://a.com/x)，官网 https://b.com 和 <https://c.com>
```

早期版本输出：

```
看 文档[1] 和 再看[2]，官网 https://b.com[3] 和 https://c.com[4]
[1] https://a.com/x
[2] https://a.com/x
[3] https://b.com
[4] https://c.com
```

同一个地址编了两次号；正文里本来就写着网址的，又在文末重复列一遍。

第二个问题的关键是：markdown-it 对这三种写法生成的都是 `link_open` token，区别在 `token.markup`：

- `[文字](url)`：`markup` 是空字符串
- 开了 `linkify` 后识别出的裸网址：`markup` 是 `'linkify'`
- `<https://...>` 尖括号自动链接：`markup` 是 `'autolink'`

后两种正文里已经显示了完整地址，不用再加脚注。去重就是在 `env` 上维护一个数组，用 `indexOf` 查编号：

```js
md.renderer.rules.link_open = (tokens, idx, opts, env) => {
  const t = tokens[idx]
  const href = t.attrGet('href') || ''
  env.links ||= []
  env.linkStack ||= []
  if (/^https?:\/\/mp\.weixin\.qq\.com/.test(href)) { env.linkStack.push('a'); return `<a href="${escapeHtml(href)}"${st('a')}>` }
  if (t.markup === 'linkify' || t.markup === 'autolink') { env.linkStack.push(''); return `<span${st('a')}>` }
  let n = env.links.indexOf(href) + 1
  if (!n) n = env.links.push(href)
  env.linkStack.push(n)
  return `<span${st('a')}>`
}
md.renderer.rules.link_close = (tokens, idx, opts, env) => {
  const n = env.linkStack.pop()
  if (n === 'a') return '</a>'
  return n ? `</span><sup style="...">[${n}]</sup>` : '</span>'
}
```

几个点：

1. `link_close` 拿不到 href，也不知道这个链接分到了几号。早期版本用一个 `env.inlineLink` 布尔值标记，编号直接取 `env.links.length`，不去重时这样凑巧是对的；去重以后编号不再等于数组长度，所以改成 `link_open` 时把"这个链接该怎么收尾"压栈，`link_close` 弹出来。公众号自己的文章链接（mp.weixin.qq.com）是可以点的，保留 `<a>`。
2. 状态放在 `env` 上，不放在闭包变量里。`env` 是每次 `md.render(src, env)` 传进来的，以后就算把 `md` 实例缓存起来复用，编号也不会串到下一篇文章去。
3. `Array.prototype.push` 返回新长度，正好就是从 1 开始的编号。

现在的输出：

```
看 文档[1] 和 再看[1]，官网 https://b.com 和 https://c.com
[1] https://a.com/x
```

## 五、目前还没处理的几处

这些是我这次对着当前代码跑出来的，仓库里还没改。

**页内锚点也被当成外链编号。** `跳到 [第二节](#sec)` 会生成 `第二节[2]`，文末出现一行 `[2] #sec`，在公众号里没有任何意义。`mailto:` 同理。

**链接文字就是网址本身时也会加脚注。** `[https://e.com](https://e.com)` 的 `markup` 是空字符串，走的是普通链接分支，结果正文和文末各出现一次同一个地址。

这两个可以在 `link_open` 里多判断一下：href 不是 http(s) 开头的不编号；下一个 token 是 text、再下一个是 `link_close`，并且文字和 href 相同，也不编号。我本地试了这个改法，原有 33 个用例都通过，上面那段的输出变成只剩 `[1] https://a.com/x`。不过它只覆盖"链接里只有纯文字"的情况，链接文字里有加粗之类就判断不到，所以还没合进去。

**h5、h6 没有主题样式。** 规则表里标题是按 `t.tag` 取样式的，主题只定义到 h4，`#####` 渲染出来就是一个光秃秃的 `<h5>`，到了公众号用的是编辑器默认样式。

**没写语言的代码块会被自动识别。** 缩进式代码块和没有语言标记的围栏代码块走 `hljs.highlightAuto`。我试了一段两行的 `indented code / line2`，它猜了一个语言，把 `code` 这个单词染了色。对纯文本、日志、命令输出来说，这种上色是干扰。比较稳的做法是没写语言就不高亮，只转义。

**Tab 固定换成 4 个空格。** `preserveSpaces` 里 `\t` 直接替换成 4 个空格，不是按制表位对齐。行首缩进没问题，行中间用 Tab 对齐的内容会错位。

## 小结

- markdown-it 的 `attrJoin` 用空格拼接，适合 class，不适合 style。往已有 style 的 token 上追加样式，用 `attrGet` + `attrSet` 自己拼，注意分号和覆盖顺序。
- 样式出错时浏览器不报错，只是静默丢掉整条声明。拿 `element.style.cssText` 看解析结果最直接。
- `white-space:nowrap` 也会合并连续空白。代码块要么用 `pre`，要么把空格都转成 `&nbsp;`，转的时候避开标签内部。
- 区分普通链接、裸网址和尖括号链接，看 `link_open` 的 `markup`；跨 open/close 的状态用栈，放在 `env` 上。

仓库：https://github.com/MsNan/md-multi-format
