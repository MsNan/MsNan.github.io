---
title: "纯前端模板工具的 4 个细节：{{变量}} 替换里的 replace 特殊替换符陷阱、数据自检脚本、剪贴板兜底和浏览器端生成下载"
date: 2026-10-27
category: 前端
tags: [JavaScript, Vue3, 正则表达式, GitHub Pages]
description: "{{变量}} 替换为何要用函数作 replace 第二参数（$& 陷阱实测）、模板数据双向校验进 CI、Clipboard API 与 execCommand 兜底、Blob 生成文件下载，以及 GitHub Pages 用 hash 路由。"
---

<div v-pre>

我维护着一个中文提示词小站：Vue 3 + Vite，部署在 GitHub Pages 上，没有后端。66 条提示词模板直接写在 JS 文件里，模板里用 `{{变量}}` 占位，页面上填好变量，一键复制，或者把其中的 Cursor rules / Claude skills 直接下载成 `.mdc`、`SKILL.md` 文件。

功能很简单，但几个"看起来一行就能写完"的地方，真写下来都有细节。这篇按实现顺序整理成 4 块：

1. `{{变量}}` 替换和"还剩哪些没填"
2. 把模板数据当代码校验，放进 CI
3. 一键复制：Clipboard API 和兜底
4. 不经过服务器，在浏览器里生成文件下载

最后顺带说一下 GitHub Pages 上为什么用 hash 路由。文中代码都是仓库里的原代码，运行结果是我在 Node 20.19.2 上实际跑出来的。

## 一、{{变量}} 替换

### 1.1 实现

模板长这样：

```js
{ id: 'code-explain', cat: '编程', title: '逐段讲解陌生代码',
  prompt: `你是一位耐心的资深工程师。请讲解下面这段 {{语言}} 代码：
...
{{代码}}`,
  vars: ['语言', '代码'], ... }
```

替换和"列出剩余变量"两个函数，放在一个 Node 和浏览器都能用的纯函数文件 `src/files.js` 里：

```js
// 用 values 替换 {{变量}}，没填的保留原样
export function fillVars(text, values = {}) {
  return text.replace(/{{(.+?)}}/g, (m, k) => (values[k]?.trim() ? values[k] : m))
}

// 列出文本中仍未替换的变量
export function leftVars(text) {
  return [...new Set([...text.matchAll(/{{(.+?)}}/g)].map((m) => m[1]))]
}
```

几个刻意的选择：

- **没填的变量保留 `{{原样}}`**，而不是替换成空字符串。复制出去以后，用户（或者 AI）一眼就能看出哪里还没填。
- **只填了空格也算没填**：`values[k]?.trim()` 为空时保留占位符。表单里不小心敲了个空格，不会把占位符"吃掉"。
- `leftVars` 用 `Set` 去重，同一个变量出现多次只列一次。命令行导出时就是靠它在每个文件后面提示"还需要填写：xxx"。
- `(.+?)` 是非贪婪匹配，`{{a}} 和 {{b}}` 会匹配成两个变量，而不是一个 `a}} 和 {{b`。

### 1.2 坑：replace 的第二个参数别传字符串

最直觉的写法是把值作为字符串直接传给 `replace`：

```js
text.replace(/{{(.+?)}}/g, value)
```

问题在于 `String.prototype.replace` 的**字符串**替换参数里，`$&`、`$1`、`` $` ``、`$'` 这些是特殊模式。用户填的值里只要带 `$`，结果就不对了。写个小脚本对比一下：

```js
import { fillVars } from './src/files.js'
const tpl = '把价格改成 {{价格}}'
console.log('string :', tpl.replace(/{{(.+?)}}/g, '$&100'))
console.log('fillVars:', fillVars(tpl, { 价格: '$&100' }))
```

实际输出：

```
string : 把价格改成 {{价格}}100
fillVars: 把价格改成 $&100
```

字符串写法里 `$&` 被解释成"整个匹配到的文本"，于是占位符原样留下，后面多了个 100。提示词里出现 `$` 并不罕见：Shell 变量、jQuery、模板字符串 `${}`、价格……**用函数作为第二个参数**，返回值会按字面插入，不会再解析 `$` 模式，这个问题就没了。

### 1.3 另外两个边界，跑一下就清楚

```js
console.log(fillVars('{{a}}/{{b}}', { a: 'X', b: '   ' }))   // X/{{b}}
console.log(leftVars('{{跨\n行}} {{正常}}'))                   // [ '正常' ]
```

- 只填空格的 `b` 保留了占位符，符合预期；
- `.` 默认不匹配换行，所以跨行的 `{{跨\n行}}` 不会被当成变量。对这个项目来说是好事：变量名本来就不该跨行，校验脚本（下一节）也用同一个正则，二者口径一致。

### 1.4 高亮未填变量：先转义，再包标签

详情页要把还没填的 `{{变量}}` 高亮出来，用的是 `v-html`。顺序很重要：**先对整段文本做 HTML 转义，再把占位符包成 `<span>`**。

```js
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const highlighted = computed(() => esc(filled.value).replace(/{{(.+?)}}/g, '<span class="var">{{$1}}</span>'))
```

用一段带标签的文本试一下：

```js
esc('<b>{{UI 库}}</b>').replace(/{{(.+?)}}/g, '<span class="var">{{$1}}</span>')
// &lt;b&gt;<span class="var">{{UI 库}}</span>&lt;/b&gt;
```

提示词里经常有 `<script setup>`、`<template>` 这种内容，反过来先包 span 再转义，span 本身也会被转义掉；不转义直接 `v-html`，用户填进去的内容就会被当成 HTML 解析。注意这里第二步用的是**字符串**替换参数 `{{$1}}`，`$1` 正是我们想要的捕获组；而它的输入已经转义过，用户的值不会以 HTML 的身份出现。

## 二、模板数据当代码校验，放进 CI

模板一多，最容易出的错是：`vars` 里声明了变量，正文里没用；或者正文里写了 `{{xx}}`，`vars` 里忘了声明。前者会在页面上多出一个填了也没用的输入框，后者则根本没有输入框可填。

仓库里有一个 `scripts/check.js`，用和 `fillVars` 同一个正则做双向比对：

```js
const used = [...new Set([...p.prompt.matchAll(/{{(.+?)}}/g)].map((m) => m[1]))]
const miss = p.vars.filter((v) => !used.includes(v)), extra = used.filter((u) => !p.vars.includes(u))
if (miss.length) err.push('vars 未在 prompt 中使用：' + miss)
if (extra.length) err.push('prompt 中的变量未声明：' + extra)
```

除此之外还检查：

- `id` 只能是小写字母、数字、`-`，且不能重复（它会出现在 URL `#/p/<id>` 里）；
- 分类必须在 `CATS` 列表里；`title`、`scene`、`prompt`、`example` 不能为空；
- 对 Cursor rules / Claude skills 两类"文件型"模板：开头必须有 `---` frontmatter，必须有 `description`；skill 的 `name` 只能小写字母、数字、`-`；rule 要么有 `globs`，要么 `alwaysApply: true`；rule 的 id 必须以 `rule-` 开头（它决定导出的文件名）；导出路径不能重复。

有问题就逐条打印，并以退出码 1 结束。为了确认它真能拦住，我在一个临时副本里故意改坏两处数据：给 `code-explain` 的 `vars` 加一个没用到的"框架"，在正文里加一个没声明的 `{{输出语言}}`：

```
$ node scripts/check.js
❌ code-explain: vars 未在 prompt 中使用：框架；prompt 中的变量未声明：输出语言
1 条有问题
exit=1
```

再还原，删掉 `rule-vue3` 里的 `globs` 那一行：

```
❌ rule-vue3: rule 需要 globs，或者 alwaysApply: true
1 条有问题
exit=1
```

原始数据跑一遍：

```
$ npm run check
✅ 66 条提示词校验通过
```

退出码非 0 才能让 CI 失败。仓库的 GitHub Actions（测试和部署两个 workflow）里顺序都是：

```yaml
- run: npm ci
- run: npm run check
- run: npm test
- run: npm run build:site
```

数据校验排在测试和构建前面，坏数据不会被部署出去。

顺带一提，frontmatter 的解析是自己写的极简版本，只支持本项目用到的 `key: value` 单行写法：

```js
export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) return null
  ...
}
```

它只认 `\n`。我试了一下 CRLF 的文本：

```js
parseFrontmatter('---\ndescription: x\n---\nbody')        // { description: 'x' }
parseFrontmatter('---\r\ndescription: x\r\n---\r\nbody')  // null
```

模板数据是写在 JS 模板字符串里的，换行是 `\n`，所以这里没问题；但如果以后改成从外部 `.md` 文件读取（比如 Windows 上编辑过的文件），就得先把 `\r\n` 统一成 `\n`。这类"只为当前数据成立"的假设，最好在注释里写明——项目里这个函数上方的注释就是"只支持本项目用到的 key: value 单行写法"。

## 三、一键复制：Clipboard API 和兜底

```js
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    let ok = false; try { ok = document.execCommand('copy') } catch {}
    ta.remove(); return ok
  }
}
```

要点：

- `navigator.clipboard` 只在**安全上下文**（HTTPS 或 localhost）里可用。GitHub Pages 是 HTTPS，正常会走第一条路；但开发时用 `vite --host` 在手机上通过 `http://192.168.x.x` 访问，就不是安全上下文，`navigator.clipboard` 是 `undefined`，访问 `.writeText` 会抛 TypeError——正好落进 `catch` 走兜底，不需要单独判断。
- 兜底用一个临时 `textarea` + `document.execCommand('copy')`。这个 API 已被标记为废弃，但目前作为兜底仍然常用。`position: fixed` 是为了避免把元素加到页面底部时页面跳动，`opacity: 0` 让它不可见。
- 函数返回布尔值，调用方只有在 `true` 时才把按钮改成"✅ 已复制"，1.5 秒后恢复。复制失败就不提示成功。

另外要区分两个"复制"：列表卡片上的复制按钮复制的是原始模板（还没填变量）；详情页复制的是 `fillVars` 之后的文本 `filled.value`。

## 四、不经过服务器，在浏览器里生成文件下载

Cursor rules 和 Claude skills 两类模板，详情页多一个"下载 xxx.mdc / SKILL.md"按钮。文件内容就是填好变量的文本，没有服务器，用 Blob + Object URL 现场生成：

```js
function download() {
  const text = filled.value.endsWith('\n') ? filled.value : filled.value + '\n'
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: file.value.filename })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
```

几个细节：

- **补一个结尾换行**。文本文件以换行结尾是惯例，没有的话 `git diff` 会显示 `\ No newline at end of file`。
- 文件名来自 `fileFor(p)`：rule 是 `<id 去掉 rule- 前缀>.mdc`，skill 固定叫 `SKILL.md`，放在 `.claude/skills/<name>/` 下。页面上会同时提示应该放到项目里的哪个路径。
- `a` 元素先挂到 `document.body` 再 `click()`，然后移除。
- `URL.revokeObjectURL` 释放 Blob 占用的内存，但不要在 `click()` 之后同步立刻 revoke，这里延迟 1 秒再释放，给浏览器开始下载留出时间。

文件名映射和导出用的是同一个 `fileFor`，浏览器下载和命令行导出（`scripts/export.js`）共用这一份纯函数，`node --test` 里有对应用例：

```js
test('Cursor rule 映射到 .cursor/rules/<slug>.mdc', () => {
  assert.deepEqual(fileFor(byId('rule-vue3')), { path: '.cursor/rules/vue3.mdc', filename: 'vue3.mdc' })
})
test('12 条文件型提示词的导出路径互不重复', ...)
test('fillVars 只替换填了值的变量，leftVars 列出剩下的', () => {
  const out = fillVars('{{a}} 和 {{b}} 和 {{a}}', { a: 'X', b: '  ' })
  assert.equal(out, 'X 和 {{b}} 和 X')
  assert.deepEqual(leftVars(out), ['b'])
})
```

本地跑 `npm test`：9 个用例，9 个通过。

## 五、顺带：GitHub Pages 上为什么用 hash 路由

站点部署在 `<用户名>.github.io/prompt-hub-cn/` 这种子路径下，所以 `vite.config.js` 里要设 `base`：

```js
export default defineConfig({ base: '/prompt-hub-cn/', plugins: [vue()], build: { sourcemap: false } })
```

路由没有引 vue-router，而是用 `location.hash` 自己解析了三种页面（列表、详情 `#/p/<id>`、贡献/打赏页），监听 `hashchange`。原因是 GitHub Pages 是纯静态托管，没有"所有路径都回退到 index.html"的配置，history 模式下直接打开或刷新 `/prompt-hub-cn/p/xxx` 会 404；hash 部分不会发给服务器，就没有这个问题。页面只有三四种，自己解析几行代码就够了。

## 小结

- 模板替换用**函数**作为 `replace` 的第二个参数，用户值里的 `$&`、`$1` 才不会被解释；
- 没填的变量保留原样、空格不算填写，复制出去一眼能看出缺什么；
- `v-html` 高亮前先整体转义；
- 模板数据用同一个正则做双向校验，退出码非 0，放在 CI 的测试和构建之前；
- 剪贴板优先用 Clipboard API，非安全上下文时会抛错，正好落进 `execCommand` 兜底；
- 浏览器端生成下载记得补结尾换行，revoke 稍等一下再做。

仓库：https://github.com/MsNan/prompt-hub-cn

</div>
