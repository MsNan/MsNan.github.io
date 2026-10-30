---
title: "一个收藏按钮让整页白屏：Vue 3 纯前端页面读写 localStorage 的 5 个边界（附 jsdom 复现）"
date: 2026-10-30
category: 前端
tags: [JavaScript, Vue3, localStorage, jsdom]
description: "用 jsdom 把 Vue 3 静态站整页跑起来复现：存储值损坏或不可用导致白屏、字符串被 new Set 拆成字符、多标签页互相覆盖收藏、已下线 id 占收藏数，附修法和取舍。"
---

# 一个收藏按钮让整页白屏：Vue 3 纯前端页面读写 localStorage 的 5 个边界（附 jsdom 复现）

<div v-pre>

提示词百宝箱（prompt-hub-cn）是我做的一个纯静态站：Vue 3 + Vite，部署在 GitHub Pages，没有后端。卡片上有个星标收藏按钮，收藏列表就存在浏览器的 `localStorage` 里。

这种功能大家都写过，十来行代码，看起来没什么可说的。这两天我给它补测试，用 jsdom 把整个页面跑起来，换着花样往 `localStorage` 里塞数据，结果一个收藏按钮翻出了 4 个问题外加 1 个小问题，其中两个会让整页白屏。下面是复现过程和修法。

## 现在的代码

`src/App.vue` 里和收藏有关的就这几行：

```js
const favs = ref(new Set(JSON.parse(localStorage.getItem('ph-favs') || '[]')))
function toggleFav(id) {
  const s = new Set(favs.value)
  s.has(id) ? s.delete(id) : s.add(id)
  favs.value = s
  localStorage.setItem('ph-favs', JSON.stringify([...s]))
}
```

模板里分类条上显示 `⭐ 收藏 {{ favs.size }}`，点它只看收藏的卡片。

深色模式也用了 `localStorage`，不过写法不一样，放在 `index.html` 的 `<head>` 里，在 Vue 加载之前执行，避免首屏先白后黑地闪一下：

```html
<script>try{const t=localStorage.getItem('ph-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}</script>
```

注意这里包了 `try/catch`，而收藏那段没有。后面会看到这个差别。

## 怎么在 Node 里把页面跑起来

不想开浏览器一个个手点，我用 Vite 把 `src/main.js` 单独打成一个 IIFE 包，再用 jsdom 执行它：

```js
// vite 配置（放在仓库外，不改项目）
build: {
  outDir: '/tmp/phtest/out',
  lib: { entry: 'src/main.js', name: 'App', formats: ['iife'], fileName: () => 'app.js' },
},
define: { 'process.env.NODE_ENV': '"production"' },
```

```js
const { JSDOM } = require('jsdom') // 用的 jsdom 25；最新的 jsdom 30 在我这台 Node 20.19 上一 require 就报错（依赖的 undici 要更新的 Node）
function tab(preset = {}) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://msnan.github.io/prompt-hub-cn/', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  w.matchMedia = () => ({ matches: false, addEventListener() {} })
  w.scrollTo = () => {}
  for (const [k, v] of Object.entries(preset)) w.localStorage.setItem(k, v)
  w.eval(code) // 打包出来的 app.js
  return w
}
```

判断页面是否正常，就数一下渲染出来的卡片数（正常是 66 张），再读分类条上收藏按钮的文字。

## 问题一：存储里的值坏了，整页白屏

`JSON.parse` 遇到非法 JSON 会抛错，而这行代码在 `<script setup>` 的顶层，抛出来组件就挂载失败：

```
ph-favs = (不存在)         → 卡片 66，⭐ 收藏 0
ph-favs = ["code-explain"] → 卡片 66，⭐ 收藏 1
ph-favs = [                → 卡片 0，#app 里只剩一个 <!---->，SyntaxError: Unexpected end of JSON input
ph-favs = {"a":1}          → 卡片 0，TypeError: object is not iterable
```

值怎么会坏？常见的有几种：以前的版本存过别的格式；用户（或者浏览器插件）在开发者工具里手改过；同域名下别的项目用了同一个键名。最后这一条在 GitHub Pages 上要特别注意：**`msnan.github.io` 下面所有项目页面共用一个源**，`/prompt-hub-cn/` 和 `/另一个项目/` 读写的是同一份 `localStorage`。键名不加前缀，迟早撞车。我这里用的是 `ph-favs`，算是加了前缀，但也只能防君子。

## 问题二：类型不对，不报错但数字是错的

比白屏更隐蔽的是"能解析但类型不对"：

```
ph-favs = "code-explain" → 卡片 66，⭐ 收藏 11
```

`JSON.parse('"code-explain"')` 得到一个字符串，`new Set('code-explain')` 会把字符串当成可迭代对象，拆成字符：c、o、d、e、-、x、p、l、a、i、n，去重后正好 11 个。页面不报错，收藏数显示 11，点进去一条都没有。

`null` 倒是没事：`JSON.parse('null')` 是 `null`，`new Set(null)` 是空集合。

## 问题三：存储不可用，同样白屏

有些环境下，连访问 `window.localStorage` 这个属性都会抛错，比如浏览器设置里禁用了站点数据，或者页面被嵌进了带 sandbox 限制的 iframe。抛的是 `SecurityError`。

在 jsdom 里把 `localStorage` 的 getter 改成抛 `SecurityError` 来模拟：

```js
Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('The operation is insecure.', 'SecurityError') } })
```

结果卡片数是 0，页面空白。`index.html` 里的深色模式脚本因为包了 `try/catch` 没事，收藏这行没包，整个应用挂了。一个可有可无的收藏功能，把整个站拖下水，这是最不划算的。

写入也一样：`setItem` 在存储满了的时候会抛 `QuotaExceededError`，`toggleDark` 里的 `setItem` 也没有兜底。

## 问题四：开两个标签页，收藏互相覆盖

`toggleFav` 的逻辑是"拿内存里的集合改一下，整个写回存储"。内存里的集合只在页面加载时读过一次，所以：

1. 打开标签页 A 和标签页 B，此时收藏都是空的；
2. 在 A 收藏第 1 条，存储里是 `["code-explain"]`；
3. 在 B 收藏第 2 条，B 内存里还是空集合，加上第 2 条后整个写回，存储变成 `["code-refactor"]`。

A 刚收藏的那条就这么没了。jsdom 里每个窗口的 `localStorage` 默认是独立的，我把 B 的 `localStorage` 指向 A 的同一个对象来模拟同源的两个标签页，jsdom 也不会自动派发 `storage` 事件，我在 A 写入后手动往 B 派发一次，模拟浏览器的行为。跑出来是这样：

```
两个标签页（修改前）→ 存储 ["code-refactor"]
```

浏览器其实会在**其他**同源标签页里触发 `storage` 事件来通知存储变了，但代码没监听，A 和 B 都不知道对方改过。

## 问题五（小问题）：已下线条目还占着收藏数

收藏存的是 id。以后某条提示词改了 id 或者删掉了，存储里的旧 id 还在，`favs.size` 会把它算进去：

```
ph-favs = ["code-explain","old-removed-id"] → ⭐ 收藏 2，点进去"共 1 条"
```

## 修法

改动集中在 `App.vue`：

```js
// localStorage 可能不可用（隐私模式/禁用存储时访问即抛错），内容也可能被改坏：读写都要兜底
function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem('ph-favs') || '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch { return new Set() }
}
function saveFavs(s) { try { localStorage.setItem('ph-favs', JSON.stringify([...s])) } catch {} }

const favs = ref(loadFavs())

// 先读存储里的最新值再改，另一个标签页刚加的收藏不会被覆盖
function toggleFav(id) {
  const s = loadFavs()
  s.has(id) ? s.delete(id) : s.add(id)
  favs.value = s
  saveFavs(s)
}

// 其他标签页改了收藏，这边跟着刷新（key 为 null 表示对方调用了 clear()）
onMounted(() => window.addEventListener('storage', (e) => {
  if (e.key === 'ph-favs' || e.key === null) favs.value = loadFavs()
}))

// 已下线的 id 留在存储里不删，只是不计数
const favCount = computed(() => PROMPTS.filter((p) => favs.value.has(p.id)).length)
```

模板里的 `favs.size` 换成 `favCount`，`toggleDark` 里的 `setItem` 也包一层 `try`。

几个取舍说明一下：

- **读的时候兜底成空集合，而不是把坏数据删掉。** 删除也是一次写操作，在存储不可用的环境下照样会抛错；而且数据坏了不代表用户想清空，下次 `toggleFav` 时自然会被正常值覆盖。
- **已下线的 id 不主动清理。** 如果用户同时开着新旧两个版本（比如浏览器缓存了旧的 JS），清理会把旧版本里还存在的收藏删掉。只在计数时过滤，代价是存储里多几个字符串。
- **写之前重新读一次**解决的是"先后点"的覆盖。两个标签页在同一毫秒点击这种真正的并发 `localStorage` 解决不了，收藏功能也没必要为它上锁。
- **存储不可用时收藏功能静默失效**，页面照常可用。要更友好的话可以在这种情况下隐藏星标按钮，我暂时没做。

把修改后的代码用同样的方法打包、跑一遍：

```
存储不可用          → 卡片 66
ph-favs = [          → 卡片 66，⭐ 收藏 0
ph-favs = "code-explain" → 卡片 66，⭐ 收藏 0
已下线 id            → ⭐ 收藏 1，列表 1 条
两个标签页          → 存储 ["code-explain","code-refactor"]，两边都显示 收藏 2
```

项目原有的 `node --test` 9 条也都通过（它们测的是导出脚本，和这次改动不冲突）。

写这篇的时候这个修改还没有合进仓库，线上和仓库里都还是"现在的代码"那一版，本地验证过的改动我留着等合并。

## 小结

把 `localStorage` 当成"外部输入"来对待，而不是自己的变量：

1. 访问本身可能抛错，读写都包 `try/catch`，别让可选功能拖垮整页；
2. 解析结果要校验类型，`new Set('字符串')` 不会报错，只会给你一个错的数字；
3. 多标签页下内存里的副本会过期，写之前重新读，再监听 `storage` 事件；
4. 存的是 id 就要考虑 id 失效，显示的数量以当前数据为准；
5. GitHub Pages 的项目页共用一个源，键名带上项目前缀。

如果你的页面用了 `<script setup>` 顶层读存储，可以照着上面的方法用 jsdom 塞一个 `[` 进去试试，几分钟就能知道会不会白屏。

仓库：https://github.com/MsNan/prompt-hub-cn

</div>
