---
title: "不写 AST 怎么判断「同意隐私前调用了定位」？我给自己的 uni-app 检查工具写了 14 个反例"
date: 2026-11-01
category: 前端
tags: [JavaScript, uni-app, 隐私合规, 正则]
description: "uni-app 隐私检查工具里「同意前调用敏感 API」的启发式判断：抹字符串、数括号、找提前 return，14 个用例里找出的误报漏报、改法，以及跨文件、模板字符串、正则字面量这三类还没解决的问题。"
---

uni-app 打包 App 上架，最常见的驳回理由之一是"用户同意隐私政策之前就调用了定位、设备信息之类的接口"。我做过一个纯前端的检查工具：在网页里选中项目文件夹（或者粘贴配置和代码），直接在浏览器里扫一遍 manifest.json、androidPrivacy.json、pages.json 和代码，列出可能被驳回的地方。其中代码那部分（规则编号 C1）要回答的问题是：**这一处敏感 API 调用，是不是发生在用户同意之前。**

这个问题严格做要上 AST 加数据流，我没这么做，整个分析器就是一个不依赖解析器的 JS 文件，靠几条启发式规则。最近回头给它补测试，写了 12 个小用例专门去戳它，结果比预想的多出好几处误报和漏报。这篇把判断逻辑、踩到的坑和改法记一下。

## 它是怎么判断的

大致四步。

**第一步，抹掉注释和字符串。** 后面要靠数 `{` `}` 判断代码在哪个函数里，字符串里的花括号、注释里的 `uni.getLocation` 都会干扰，所以先把它们替换成空格。关键是只换内容、保留长度和换行，这样后面算出来的位置还能直接对回原文的行号：

```js
// 把注释与字符串内容替换成空格(保持长度与换行)
function sanitize(src) {
  // ...遇到 // 和 /* */ 整段置空；遇到 ' " ` 把引号之间置空
}
```

**第二步，找到调用点外面套着哪些块。** 从文件开头扫到调用位置，遇到 `{` 入栈、`}` 出栈，栈里剩下的就是包住这次调用的所有块：

```js
function enclosingBlocks(s, pos) {
  const st = []
  for (let i = 0; i < pos; i++) { const c = s[i]; if (c === '{') st.push(i); else if (c === '}') st.pop() }
  return st
}
```

**第三步，看每个块的"头"。** 取块的 `{` 前面一小段（最多 220 个字符，截到上一个 `; { }` 为止），用正则看它是不是 `onLaunch`、`onLoad`、`mounted`、`setup` 这类生命周期，同时看里面有没有"已同意"的判断，比如 `if (this.globalData.privacyAgreed)`。

**第四步，找提前 return。** 很多人习惯写 `if (!agreed) return`，调用本身不在 if 里面。原来的写法是在块开头到调用点之间跑这个正则：

```js
/if\s*\(([^)]*)\)\s*(?:\{[^}]*)?\breturn\b/gi
```

把括号里的条件抠出来，再匹配一组关键字（`privacyAgree*`、`isAgree`、`consent*`、`agreed` 等），带 `!` 的才算守卫。

最后按"在哪个钩子里、有没有守卫、manifest 里有没有配原生隐私弹窗"定级：App.vue 的 `onLaunch` 里直接调定位，又没配弹窗，就是 HIGH。

## 12 个用例

用例都写在 `App.vue` 的 `onLaunch` 里，manifest 只放最小内容（不配 androidPrivacy.json，这样不会因为有原生弹窗而降级），调用的都是 `uni.getLocation`。原版的结果：

| # | 写法 | 原版结果 | 应该是 |
| --- | --- | --- | --- |
| 1 | 不做任何判断 | HIGH | HIGH |
| 2 | `if (this.globalData.privacyAgreed) { 调用 }` | 已守卫 | 已守卫 |
| 3 | `if (uni.getStorageSync('privacyAgreed')) { 调用 }` | **HIGH** | 已守卫 |
| 4 | `if (!this.globalData.privacyAgreed) return` | 已守卫 | 已守卫 |
| 5 | `if (!getApp().globalData.privacyAgreed) return` | **HIGH** | 已守卫 |
| 6 | `if (!uni.getStorageSync('privacyAgreed')) return` | **HIGH** | 已守卫 |
| 7 | 定位封装在 `utils/location.js`，onLaunch 里调封装函数 | LOW，位置报在 utils 里，归为"事件处理/普通函数内" | 应该算启动期 |
| 8 | 模板字符串里调用 `` `${uni.getSystemInfoSync().osName}` `` | 没扫到 | 应该扫到 |
| 9 | `if (this.isAgreementPageOpen) { 调用 }` | **已守卫** | HIGH |
| 10 | 前面某个方法里有正则 `` /`/g `` | 后面的调用全没扫到 | HIGH |
| 11 | Vue 3 `<script setup>` + `onLaunch(() => {})` | HIGH | HIGH |
| 12 | 前面有个字符串 `'请先同意 { 隐私政策'` | 已守卫 | 已守卫 |

后来又补了两个：

- 块形式的提前 return，`if (!this.globalData.privacyAgreed) { uni.showToast({ title: 'x', icon: 'none' }); return }`，原版报 **HIGH**。
- `onShow` 里写了 `if (!this.globalData.privacyAgreed) return`，`onLaunch` 里直接调定位，原版判成**已守卫**。

用例 12 说明抹字符串这一步是必要的：不抹的话，那个 `{` 会让括号栈错位。但下面几个问题，恰恰也有两个出在这一步上。

## 问题一：判断条件写在字符串里，被抹掉了

用例 3 和 6。`uni.getStorageSync('privacyAgreed')` 是很常见的写法，同意状态存在本地存储里。可是 sanitize 之后它变成了 `uni.getStorageSync('             ')`，关键字没了，自然认不出来。

抹字符串是为了数括号，找关键字的时候却需要字符串内容，两个需求是冲突的。

## 问题二：`[^)]*` 遇到第一个右括号就停

用例 5。`if\s*\(([^)]*)\)` 抠条件时，碰到 `getApp()` 的那个 `)` 就结束了，抠出来的条件只有 `!getApp(`，后面的 `privacyAgreed` 根本没进来。

更尴尬的是，`!getApp().globalData.privacyAgreed` 正是这个工具在修复建议里推荐的写法，仓库里那个"正确示例"项目的页面也是这么写的。原版扫正确示例时没报问题，是因为示例配了原生隐私弹窗，这两处调用又都在点击事件里，被当成"有弹窗兜底"放过了。报告里写的是"已见同意判断 0 处，用户触发函数内且已有原生弹窗兜底 2 处"：它其实没认出这两处判断。

用例 6 是问题一和问题二叠在一起。

## 问题三：块形式的 return

`(?:\{[^}]*)?\breturn\b` 允许 if 后面跟一个块，但 `[^}]*` 遇到块里第一个 `}` 就停。正确示例里另一个方法正是这么写的：先 `uni.showToast({ title: '请先同意隐私政策', icon: 'none' })`，再 `return`。`showToast` 参数对象的 `}` 一出现，正则就够不到后面的 `return` 了。

## 问题四：关键字没有边界，`isAgree` 吃掉了 `isAgreementPageOpen`

用例 9 是漏报，比误报危险。关键字列表里有 `isAgree`，正则没有加结尾边界，`this.isAgreementPageOpen` 前半截正好匹配上，于是"协议页是否打开"被当成了"用户已同意"，直接调定位也没报。

## 问题五：别的函数里的 return 也算数

提前 return 的正则是在"块开头到调用点"这段文本里跑的。外层块是 `export default { ... }` 这个对象时，这段文本包含了前面所有的兄弟方法。所以 `onShow` 里的 `if (!agreed) return` 被算到了 `onLaunch` 头上，这也是漏报。

## 改法

针对上面五个问题，改动都集中在分析器里：

1. **抹两份。** `sanitize` 加一个 `keepStrings` 参数，同一段源码生成两份：`s` 抹掉字符串，用来数括号、定位；`g` 只抹注释、保留字符串，用来找同意关键字。两份长度完全一样，所以在 `s` 上算出的下标可以直接拿去 `g` 上截取。

```js
const raw = scriptOnly(text, isVue)
const s = sanitize(raw), g = sanitize(raw, true)
```

2. **条件用括号配对取。** 不再用 `[^)]*`，而是在 `s` 上从 `if (` 的左括号开始计数，找到配对的右括号，再去 `g` 上取这一段作为条件。在 `s` 上数是因为字符串里的括号已经被抹掉了，不会干扰。

```js
function closeParen(s, open, end) {
  let d = 0
  for (let i = open; i < end; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) return i }
  return -1
}
```

3. **return 按块的层级找。** 右括号后面如果是 `{`，就往里走，只在这个块的第一层找 `return`，嵌套的 `{}` 跳过。

4. **只认同一层的 if。** 从块开头到这个 if 之间，`{` 和 `}` 必须正好抵消，否则这个 if 在某个已经结束的兄弟函数里，不算。

5. **关键字加结尾边界** `(?![\w$])`，同时把关键字前面允许的字符从 `[\w$.]` 放宽到 `[\w$.()\[\]'"]`，否则 `!getApp().globalData.privacyAgreed` 里的 `!` 隔着 `()` 连不上关键字，取反信息就丢了。

改完后用例 3、5、6 判为已守卫，9 报 HIGH，块形式 return 判为已守卫，兄弟函数的 return 不再算数，其余用例结果不变。原有的 33 条测试加上新补的 7 条，一共 40 条都通过；页面交互的 27 条 UI 测试也通过。两个示例项目的结果：错误示例的问题列表和改之前逐条一致；正确示例仍然没有问题项，统计从"已见同意判断 0 处、弹窗兜底 2 处"变成了"已见同意判断 2 处"，这才是对的。

## 还没解决的

剩下三个用例我没改，因为在不引入解析器的前提下没有干净的办法：

- **跨文件（用例 7）。** 分析是按文件做的，`onLaunch` 里调 `locate()`，分析器不知道 `locate` 里有什么；到了 `utils/location.js`，它只知道这是个普通函数，于是按"用户触发"处理，只给 LOW。更麻烦的是，如果项目配了原生隐私弹窗，普通函数里的调用会被直接放过：我把同一个项目加上 androidPrivacy.json 再扫，这一处一条都不报，而同样的调用直接写在 `onLaunch` 里会报 MEDIUM。
- **模板字符串插值（用例 8）。** 反引号之间整段被抹掉，`${}` 里的调用也一起没了。
- **正则字面量（用例 10）。** sanitize 不认识正则字面量，`` /`/g `` 里的反引号被当成模板字符串的开头，一直吞到文件末尾。

所以这类工具的结果只能当提示用，"没报"不等于"没问题"。尤其是封装在 utils 里的定位、统计 SDK 初始化，还是得自己顺着 `onLaunch` 往下翻一遍。

这次的改动整理成了补丁，还没合进仓库。

仓库：https://github.com/MsNan/uniapp-privacy-check-web
