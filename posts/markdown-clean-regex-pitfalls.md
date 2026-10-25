---
title: "逐行正则整理 Markdown，我把原文改坏了 7 处：代码块空行、嵌套围栏、分隔线和硬换行"
date: 2026-10-25
category: 前端
tags: [Markdown, JavaScript, 正则表达式, Vitest]
description: "给掘金/CSDN 做 Markdown 规范化时补测试，翻出 7 处改坏原文的地方：代码块空行被合并、```js 提前关闭围栏、* * * 变列表、#话题变标题、硬换行丢失等，附修复与用例。"
---

我那个 Markdown 多平台排版工具里，除了公众号那个标签页，还有一个「掘金 / CSDN」标签页。它不生成 HTML，只把 Markdown 本身整理一遍，复制出去直接粘贴进编辑器。做的事情很朴素：

- 中文和英文、数字之间加空格（`使用Vue3开发` → `使用 Vue3 开发`）
- `#标题` 补成 `# 标题`
- 列表符号 `*`、`+` 统一成 `-`
- 没写语言的代码块补上 `plaintext`
- 去掉 front matter，合并多余空行，去掉行尾空格

实现也朴素：按行扫描，用一个 `inCode` 标记当前是不是在代码块里，代码块里的行原样输出，代码块外的行跑几条正则。原来的单元测试 26 条全部通过，我也一直这么用。

前几天想给它补测试，专门挑了一批"正常人写文章会出现、但我写正则时没想到"的输入，结果一下翻出 7 处会把原文改坏的地方。这篇把它们一个个列出来，最后给出修好的版本。逐行正则处理 Markdown 的场景很多（格式化脚本、lint、发布前的预处理），这些坑基本是通用的。

## 先看原来的实现

去掉细节，核心逻辑是这样的：

```js
export function cleanMarkdown(md, { cjkSpace = true, defaultLang = 'plaintext' } = {}) {
  let text = md.replace(/\r\n?/g, '\n')
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, '')          // 去 front matter
  const out = []
  let inCode = false, fence = ''
  for (let line of text.split('\n')) {
    const f = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
    if (f && (!inCode || f[2].startsWith(fence))) {
      if (!inCode) { inCode = true; fence = f[2]; out.push(`${f[1]}${f[2]}${f[3].trim() || defaultLang}`) }
      else { inCode = false; out.push(line.trimEnd()); out.push('') }
      continue
    }
    if (inCode) { out.push(line); continue }
    line = line.replace(/\s+$/, '')                              // 去行尾空格
    line = line.replace(/^(#{1,6})([^#\s])/, '$1 $2')            // # 后补空格
    line = line.replace(/^(\s*)[*+] (?=\S)/, '$1- ')             // 列表统一用 -
    if (cjkSpace) line = spaceCjk(line)
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'  // 合并空行
}
```

中英文加空格的 `spaceCjk` 单独说一下，因为它本身写得还算对：

```js
const CJK = '\\u2e80-\\u2eff\\u2f00-\\u2fdf\\u3040-\\u309f\\u30a0-\\u30ff\\u3100-\\u312f\\u3200-\\u32ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'

export function spaceCjk(line) {
  const parts = line.split(/(`[^`]*`|\]\([^)]*\)|https?:\/\/\S+)/)
  return parts.map((p, i) => (i % 2 ? p : p
    .replace(new RegExp(`([${CJK}])([A-Za-z0-9])`, 'g'), '$1 $2')
    .replace(new RegExp(`([A-Za-z0-9%])([${CJK}])`, 'g'), '$1 $2'))).join('')
}
```

两个细节：

1. **用带捕获组的 `split` 做"跳过区"。** `split` 的正则带括号时，匹配到的分隔符也会留在结果数组里，而且一定落在奇数下标。所以 `i % 2` 为真的就是行内代码、链接地址、裸网址，原样保留；偶数下标才是普通文本。这比写一个"不在反引号里"的复杂正则好维护得多。
2. **CJK 范围里故意没有 `\u3000-\u303f`。** 这一段是中文标点（`，。、「」`），标点和英文之间不该加空格。`%` 只放在左边的字符集里，是为了 `提升50%性能` 能变成 `提升 50% 性能`。

问题出在外面那个逐行循环上。

## 坑 1：代码块里的连续空行被合并了

最后一行的 `.replace(/\n{3,}/g, '\n\n')` 是对整篇输出做的，代码块也在里面。Python 按 PEP 8 函数之间空两行，正好是三个连续 `\n`：

```python
def a():
    pass


def b():
    pass
```

整理后两个空行变成一个。原来的测试里有一条叫"代码块补默认语言、不改代码内容"，可它的样例里恰好没有连续空行。

修法：合并空行不要在最后对整串做，改成逐行处理时，在代码块外遇到空行再判断上一行是不是已经是空行。

## 坑 2：一行 ```js 把代码块提前关掉了

写 Markdown 教程时很常见：在代码块里展示另一个代码块的写法。

````text
```
下面这行是代码块的开头：
```js
let a = 1
```
后面是正文Vue
````

原实现在代码块里看到 ```` ```js ````，`f[2].startsWith(fence)` 成立，就当成了关闭围栏。后面的 ```` ``` ```` 又被当成新代码块的开头，正文 `后面是正文Vue` 被包进了一个不会闭合的代码块，最后还被"补全未闭合的代码块"补了一个 ```` ``` ````。整篇后半段全变成代码。

对照 CommonMark 规范，关闭围栏有三个条件：

- 和开头用同一种字符（反引号对反引号，`~` 对 `~`）
- 长度不短于开头
- **后面除了空白不能有别的内容**

第三条是关键，```` ```js ```` 带了 info string，它不能关闭代码块，只是代码块里的普通一行。我用 markdown-it 验证过，它会把这几行都当作代码内容。

另外还有一条开头的规则：反引号围栏的 info string 里不能再出现反引号，所以 ```` ```js` 不是围栏 ```` 这种行不能当成代码块开头。

## 坑 3：分隔线 `* * *` 变成了三层嵌套列表

"列表统一用 `-`" 那条正则是 `^(\s*)[*+] (?=\S)`，意思是"星号或加号，后面一个空格，再后面不是空白"。`* * *` 完全符合，于是变成 `- * *`。

用 markdown-it 渲染一下这两行：

```text
"* * *"  => <hr>
"- * *"  => <ul><li><ul><li><ul><li></li></ul></li></ul></li></ul>
```

一条分隔线变成三层空列表。修法是先判断是不是分隔线：

```js
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
if (!HR.test(line)) line = line.replace(/^(\s*)[*+] (?=\S)/, '$1- ')
```

`\1` 反向引用保证三个符号是同一种，`* - *` 这种混用不算分隔线，和规范一致。

## 坑 4：`#Vue3 #前端` 被补成了一级标题

`#标题` 补空格的初衷是修正手误。但很多人从小红书、微博搬内容过来，第一行就是话题标签。按 CommonMark，`#Vue3` 后面没空格，本来就不是标题，显示的就是原文；补完空格反而成了 `<h1>Vue3 #前端</h1>`。

这条没有完美的判断方法，"手误的标题"和"话题标签"在字面上一样。我选了一个保守的规则：同一行里如果后面还有 ` #xxx` 这种形式，就认为是话题，不补：

```js
line = line.replace(/^(#{1,6})([^#\s])(?!.*\s#\S)/, '$1 $2')
```

代价是 `#第 1 章 #1` 这种也不会被修正。宁可少修，也别把正文改成标题。

## 坑 5：行尾两个空格是硬换行，被一起删了

`line.replace(/\s+$/, '')` 把行尾空白全去掉。但 Markdown 里行尾两个及以上空格表示硬换行（`<br>`）：

```text
"第一行  \n第二行" => <p>第一行<br>第二行</p>
"第一行\n第二行"   => <p>第一行 第二行</p>
```

写地址、诗歌、签名档的人会用这个。删掉之后两行合成一行。

修法：处理前先记住这一行是不是以两个空格结尾，最后再判断下一行是不是还有正文。段落最后一行的两个空格没有意义，可以去掉；后面紧跟正文的才补回来。

## 坑 6：缩进代码块里的内容被加了空格

除了围栏代码块，Markdown 还有"缩进 4 个空格"的代码块。原实现只认围栏，缩进代码块里的 `const s="中文a"` 会被改成 `const s="中文 a"`，字符串内容变了。

完整判断缩进代码块需要知道上下文（列表项里缩进 4 格的可能只是续行段落），逐行处理拿不到这个信息。我的处理是：缩进 4 格或以 Tab 开头的行一律不动。最坏情况是列表里的续行段落没加空格，不会改坏东西。

## 坑 7：HTML 标签的属性被加了空格

Markdown 里可以直接写 HTML，比如控制图片宽度时：

```html
<img src="架构图v2.png" width="600">
```

`spaceCjk` 的跳过区里没有 HTML 标签，于是 `src` 变成 `"架构图 v2.png"`，图片直接 404。修法是把 `<[^>]+>` 也加进 `split` 的捕获组。顺手把行内代码的规则从 `` `[^`]*` `` 改成 `` `+[^`]*?`+ ``：原来的写法遇到用双反引号包起来的行内代码（比如 ``` ``中文a`` ```）会匹配成两段空字符串，里面的 `中文a` 照样被加上空格。

## 修好之后的版本

```js
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

export function spaceCjk(line) {
  const parts = line.split(/(`+[^`]*?`+|\]\([^)]*\)|https?:\/\/\S+|<[^>]+>)/)
  return parts.map((p, i) => (i % 2 ? p : p
    .replace(new RegExp(`([${CJK}])([A-Za-z0-9])`, 'g'), '$1 $2')
    .replace(new RegExp(`([A-Za-z0-9%])([${CJK}])`, 'g'), '$1 $2'))).join('')
}

export function cleanMarkdown(md, { cjkSpace = true, stripFrontMatter = true, defaultLang = 'plaintext' } = {}) {
  let text = md.replace(/\r\n?/g, '\n')
  if (stripFrontMatter) text = text.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const out = []
  const blank = () => out.length && out[out.length - 1] === ''
  const breaks = new Set()            // 记录硬换行所在的行
  let inCode = false, fence = ''
  for (let line of text.split('\n')) {
    const f = line.match(FENCE)
    if (inCode) {
      // 同种字符、长度不短于开头、后面没有内容，才是关闭
      if (f && f[2][0] === fence[0] && f[2].length >= fence.length && f[3].trim() === '') {
        inCode = false; out.push(line.trimEnd()); out.push('')
      } else out.push(line)           // 代码里的空行、空格原样保留
      continue
    }
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) {
      inCode = true; fence = f[2]
      if (out.length && !blank()) out.push('')
      out.push(`${f[1]}${f[2]}${f[3].trim() || defaultLang}`)
      continue
    }
    const hardBreak = / {2,}$/.test(line)
    line = line.replace(/\s+$/, '')
    if (line === '') { if (!blank()) out.push(''); continue }   // 只在代码块外合并空行
    if (/^( {4}|\t)/.test(line)) { out.push(line); continue }   // 可能是缩进代码块，不动
    line = line.replace(/^(#{1,6})([^#\s])(?!.*\s#\S)/, '$1 $2')
    if (!HR.test(line)) line = line.replace(/^(\s*)[*+] (?=\S)/, '$1- ')
    if (cjkSpace) line = spaceCjk(line)
    if (/^#{1,6} /.test(line)) {
      if (out.length && !blank()) out.push('')
      out.push(line); out.push(''); continue
    }
    if (hardBreak) breaks.add(out.length)
    out.push(line)
  }
  if (inCode) out.push(fence)          // 补全未闭合的代码块
  for (const i of breaks) if (out[i + 1]) out[i] += '  '
  while (blank()) out.pop()
  while (out[0] === '') out.shift()
  return out.join('\n') + '\n'
}
```

围栏的缩进我还是用 `\s*`，没有按规范限制成 0～3 个空格。原因是列表项里的代码块经常缩进 4 格，逐行处理不知道自己在不在列表里，按规范卡死反而会漏掉这些代码块。

## 用测试把这些情况固定下来

每个坑对应一条用例，加进原来的 vitest 测试：

```js
it('代码块里的连续空行原样保留', () => {
  const src = '```python\ndef a():\n    pass\n\n\ndef b():\n    pass\n```\n'
  expect(cleanMarkdown(src)).toBe(src)
})
it('```js 不能关闭代码块', () => {
  expect(cleanMarkdown('```\n```js\nlet a=1\n```\n后文Vue'))
    .toBe('```plaintext\n```js\nlet a=1\n```\n\n后文 Vue\n')
})
it('分隔线、#话题、硬换行、缩进代码、HTML 属性不被改坏', () => {
  expect(cleanMarkdown('上文\n\n* * *\n\n下文')).toBe('上文\n\n* * *\n\n下文\n')
  expect(cleanMarkdown('#Vue3 #前端')).toBe('#Vue3 #前端\n')
  expect(cleanMarkdown('第一行  \n第二行')).toBe('第一行  \n第二行\n')
  expect(cleanMarkdown('段落\n\n    s="中文a"')).toBe('段落\n\n    s="中文a"\n')
  expect(cleanMarkdown('<img src="图a.png">')).toBe('<img src="图a.png">\n')
})
it('列表里缩进的代码块照样识别', () => {
  const src = '- 第一步\n\n    ```bash\n    npm i中文a\n\n\n    ```\n'
  expect(cleanMarkdown(src)).toBe(src)
})
```

原实现跑这 4 条全部失败，换成新版本后，加上原来的 26 条，30 条全部通过。

## 几点体会

- **逐行处理 Markdown，状态机只记"在不在代码块里"是不够的**，至少还要知道围栏的字符和长度。真要处理列表、引用里的嵌套，就该上 markdown-it 或 remark 拿 AST，在文本节点上改，不要再加正则。
- **"整理"类工具第一原则是不改语义。** 合并空行、去行尾空格看起来都是无害的格式调整，但 Markdown 里空白是有语法含义的。
- **测试样例要从真实文章里取。** 我原来的样例都是自己为了验证功能写的，天然绕开了坑。这次的用例来自教程文章、Python 代码、小红书搬运的内容，一下就暴露出来了。

上面的修复我已经整理成补丁，还没合进仓库，仓库里目前还是原来的实现。

仓库：https://github.com/MsNan/md-multi-format
