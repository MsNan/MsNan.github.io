---
title: "把 uni-app 踩坑经验写成 AI 编码规则：条件编译、页面生命周期、并发 401 与分包"
date: 2026-10-20
category: 前端
tags: [uni-app, Vue3, 小程序, AI, Cursor]
description: "AI 写 uni-app 默认带着 Web 习惯。条件编译收拢、页面与组件生命周期、路由限制、rpx 与 1px、并发 401 只刷新一次、分包配置，以及一份规则源文件转换成多种工具格式。"
---

这一年写 uni-app 项目，越来越多的代码是让 Cursor 和 Claude Code 先出初稿、我再改。用下来最大的问题不是 AI 写不出来，而是它默认按 Web 的习惯写：请求用 `axios`，token 存 `localStorage`，布局用 `div`，页面参数在 `onMounted` 里取。H5 上跑得好好的，编译到微信小程序就报错或者白屏。

同样的话我在对话里说了很多遍，后来干脆把这些约束整理成规则文件放进项目，让 AI 动手前先读。整理的过程其实就是把 uni-app 的平台差异重新梳理了一遍，这篇把里面最常用的几块技术点记下来，最后再说一下规则文件本身怎么组织。

## 为什么 Web 的写法在小程序里跑不起来

微信小程序是逻辑层和渲染层分开的，业务 JS 跑在单独的 JS 引擎里，没有 DOM，也没有 `window`、`document`。所以下面这些东西在 H5 上能用，到了小程序要么是 undefined，要么直接报错：

- `localStorage` / `sessionStorage`，要换成 `uni.setStorageSync` / `uni.getStorageSync`；
- `axios`，它在浏览器里依赖 XHR，小程序没有 XHR，除非额外装适配器，否则直接用 `uni.request`；
- `window.location`、`history` 做跳转，要换成 `uni.navigateTo` 这一套路由 API；
- `div`、`span`、`img` 这些标签，要写成 `view`、`text`、`image`。

标签这一条里还有个容易忽略的细节：纯文本最好包在 `<text>` 里。H5 和小程序上裸写文字一般能显示，但在 App 端有可能不显示。AI 生成的模板里经常是 `<view>暂无数据</view>` 这种写法，我在规则里明确写了"纯文本必须包在 `<text>` 中"。

这些规则写成一句话很简单，但如果不写下来，AI 每次都会按它最熟悉的 Web 写法来。

## 条件编译：语法不难，难的是别让它散得到处都是

uni-app 用注释来做条件编译，模板、JS、CSS 各自用对应的注释语法：

```vue
<!-- #ifdef MP-WEIXIN -->
<button open-type="getPhoneNumber" @getphonenumber="onPhone">手机号登录</button>
<!-- #endif -->
<!-- #ifdef H5 || APP-PLUS -->
<SmsLogin />
<!-- #endif -->
```

JS 里写 `// #ifdef`，CSS 里写 `/* #ifdef */`。常用的平台标识是 `H5`、`MP-WEIXIN`、`MP-ALIPAY`、`APP-PLUS`（Vue3 项目里也可以写 `APP`）、`MP`（所有小程序）。

因为它本质上是注释，平台名写错了不会有任何编译错误，那段代码只是在所有平台上都被去掉。比如把 `MP-WEIXIN` 写成 `MP-WECHAT`，小程序上那个按钮就是不出来，也没有任何提示，只能靠肉眼对照平台标识去查。

真正影响维护的是条件编译散落在各个页面里。一个登录页里有三四处 `#ifdef`，过半年再看根本理不清每个平台到底走哪条路。我的做法是把平台差异收拢到 `utils/platform.ts`，业务层只调统一的函数：

```ts
// utils/platform.ts
export function loginType(): 'weixin' | 'sms' {
  // #ifdef MP-WEIXIN
  return 'weixin'
  // #endif
  // #ifndef MP-WEIXIN
  return 'sms'
  // #endif
}
```

编译到微信小程序时只剩 `return 'weixin'`，其他平台只剩 `return 'sms'`。页面里写 `if (loginType() === 'weixin')`，条件编译只出现在这一个文件里。另外 uni-app 不像有些框架那样支持 `login.mp-weixin.vue` 这种按文件名后缀自动选择平台的写法，AI 偶尔会这样生成，规则里我专门写了一句"不可行"。

## 页面生命周期和组件生命周期

这是 AI 最容易写错、也最难一眼看出来的地方。Vue3 的 `onMounted` 在 uni-app 页面里能用，但页面参数、下拉刷新、触底加载这些是页面级的生命周期，要从 `@dcloudio/uni-app` 导入：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'

const id = ref('')
onLoad((query) => {
  id.value = query?.id ?? ''
  loadDetail()
})
onShow(() => {
  // 从下一页返回时也会触发，适合刷新购物车数量这类数据
})
onPullDownRefresh(async () => {
  await loadDetail()
  uni.stopPullDownRefresh()
})
onReachBottom(() => loadMore())
</script>
```

有几个细节：

1. 页面参数只能在 `onLoad` 里拿到，`onMounted` 没有这个参数。AI 经常写成在 `onMounted` 里读 `route.query`，那是 vue-router 的写法，uni-app 里没有。
2. `onShow` 每次页面显示都会触发，包括从下一级页面返回。`onLoad` 只在页面创建时触发一次。需要"回来就刷新"的数据放 `onShow`。
3. 下拉刷新要在 `pages.json` 里给这个页面配 `"enablePullDownRefresh": true`，刷新完必须手动调 `uni.stopPullDownRefresh()`，否则那个加载动画会一直挂着。
4. 这些页面生命周期是给页面用的，组件里不要指望拿到 `onLoad`。我的规则是页面拿到参数后通过 props 传给组件，组件只用 Vue 自己的生命周期。

## 路由的几条硬限制

uni-app 的路由不是 vue-router，有几条平台本身的限制：

- tabBar 页面只能用 `uni.switchTab` 跳转，用 `navigateTo` 跳过去会失败；
- 页面栈最多 10 层，商品详情跳商品详情这种场景，层级深了要用 `redirectTo`；
- URL 传参只适合简单值，传对象要先编码：

```ts
// 跳转
const data = encodeURIComponent(JSON.stringify({ skuId: 1, count: 2 }))
uni.navigateTo({ url: `/pkg-order/confirm/confirm?data=${data}` })

// 目标页
onLoad((query) => {
  const params = JSON.parse(decodeURIComponent(query?.data ?? '{}'))
})
```

不编码的话，对象里的 `&`、`=`、中文都可能把参数截断。数据量大的话就别走 URL 了，放到 Pinia 里或者只传一个 id 让目标页自己查。

## 尺寸和样式

样式这块规则写得比较细，因为 AI 生成的 CSS 基本都是 Web 写法：

- 尺寸用 `rpx`，按 750 宽的设计稿 1:1 写；但 1 像素的边框用 `1px`，不要写 `1rpx`。在 375 宽的屏幕上 `1rpx` 只有 0.5px，屏幕更窄时还会更小，部分机型上这条线会被舍掉直接看不见；
- 小程序不支持 `*` 选择器，`body` 要写成 `page`；
- 改子组件样式用 `:deep()`；
- `image` 组件有默认宽高（320×240），不设宽高和 `mode` 的话图片会被拉伸，商品图一般用 `mode="aspectFill"`；
- 底部固定按钮加 `padding-bottom: env(safe-area-inset-bottom)`，不然在有底部横条的手机上会被挡住一部分。

## 请求封装：并发 401 只刷新一次

这是整套规则里代码最多的一块。要解决的问题是：一个页面同时发了三四个请求，token 恰好过期，几个请求同时返回 401。如果每个请求都自己去刷新 token、刷新失败都自己跳登录页，用户会看到登录页被连续打开好几次。

刷新 token 的部分用一个模块级的 Promise 做去重：

```ts
let refreshing: Promise<boolean> | null = null
async function refreshToken(): Promise<boolean> {
  const user = useUserStore()
  if (!user.refreshToken) return false
  refreshing ||= new Promise<boolean>((resolve) => {
    uni.request({
      url: BASE_URL + '/auth/refresh', method: 'POST', data: { refreshToken: user.refreshToken },
      success: (r: any) => { if (r.statusCode === 200 && r.data.code === 0) { user.setToken(r.data.data); resolve(true) } else resolve(false) },
      fail: () => resolve(false),
    })
  }).finally(() => { refreshing = null })
  return refreshing
}
```

第一个 401 进来时 `refreshing` 是 null，创建刷新请求；后面几个 401 进来时 `refreshing` 已经有值，直接复用同一个 Promise，所以不管多少个请求同时 401，刷新接口只调一次。刷新结束后在 `finally` 里把它清空，下次过期还能重新刷新。注意这个 Promise 永远 resolve，失败时 resolve 成 false，调用方不需要再写 try/catch。如果项目的构建目标比较老，不支持 `||=`，改成 `if (!refreshing) refreshing = ...` 是一样的。

跳登录页也要去重：

```ts
let toLogin = false
function gotoLogin() {
  if (toLogin) return
  toLogin = true
  useUserStore().logout()
  const pages = getCurrentPages(); const cur = pages[pages.length - 1]
  uni.navigateTo({ url: '/pages/login/login?redirect=' + encodeURIComponent('/' + (cur?.route ?? '')), complete: () => (toLogin = false) })
}
```

`getCurrentPages()` 拿到当前页面栈，最后一个就是当前页，把它的路由带到登录页的 `redirect` 参数里，登录成功后可以跳回来。

在 `uni.request` 的 success 回调里，401 的处理是这样（`opt` 是调用 `request` 时传进来的参数）：

```ts
if (res.statusCode === 401) {
  if (!opt.retried && (await refreshToken())) return resolve(request<T>({ ...opt, retried: true }))
  gotoLogin(); return reject(new Error('未登录'))
}
```

拿一个具体场景走一遍：首页同时发了 banner、商品列表、未读消息三个请求，token 刚好过期，三个都返回 401。第一个进入 `refreshToken` 时发起刷新，另外两个拿到的是同一个 `refreshing`，三者一起等。刷新成功后，三个请求各自带着 `retried: true` 用新 token 重发；刷新失败的话，三个都会调用 `gotoLogin`，但只有第一个真正跳转，后两个被 `toLogin` 挡掉。

`retried` 这个标记是防死循环的：刷新成功后用新 token 重发一次原请求，如果重发后还是 401（比如后端把这个账号禁用了），就不会再去刷新，直接跳登录。`resolve` 里传的是另一个 Promise，外层的 Promise 会跟随它的结果，调用方完全感知不到中间发生过刷新。

token 本身放在 Pinia 里，初始值从 uni 的本地存储读，这样冷启动以后登录态还在：

```ts
const token = ref(uni.getStorageSync('token') || '')
const refreshToken = ref(uni.getStorageSync('refreshToken') || '')
```

如果用 `pinia-plugin-persistedstate` 做持久化，要把它的 storage 配成 `uni.getStorageSync` / `uni.setStorageSync`，它默认用的是 `localStorage`，在小程序里同样不能用。

## 分包：主包体积是硬限制

微信小程序主包有 2MB 的限制（具体以官方当前限制为准），超过了根本传不上去。AI 新建页面时默认都往 `pages/` 里放，几十个页面以后主包很快就满了。规则里的原则是主包只放 tabBar 页、登录页、公共组件和核心工具函数，其余按业务模块分包：

```json
{
  "pages": [{ "path": "pages/index/index" }, { "path": "pages/mine/mine" }],
  "subPackages": [
    { "root": "pkg-order", "pages": [{ "path": "list/list" }, { "path": "detail/detail" }] },
    { "root": "pkg-user",  "pages": [{ "path": "setting/setting" }] }
  ],
  "preloadRule": { "pages/index/index": { "network": "all", "packages": ["pkg-order"] } }
}
```

`preloadRule` 的意思是用户进入首页后，在后台预先下载订单分包，等真正点进订单列表时就不用等下载。另外几条：`manifest.json` 里打开 `mp-weixin.optimization.subPackages`，只被分包引用的组件和 JS 会被打进分包而不是主包；分包内的页面跳转路径要写全，比如 `/pkg-order/detail/detail?id=1`；一个分包不能引用另一个分包的资源，公共的东西只能放主包。

## 规则文件怎么组织

上面这些内容我按主题拆成了 12 个文件，每个文件一个目录，统一叫 `SKILL.md`，头部是 YAML：

```markdown
---
name: uniapp-cross-platform
description: uni-app 跨端（H5 / 微信小程序 / App）开发与条件编译规范及常见坑。编写 uni-app 页面、组件、pages.json、manifest.json 时使用。
globs: "**/*.vue,**/pages.json,**/manifest.json"
---
```

`description` 是最关键的一行。Claude Code 的 Skills 和 Cursor 里 `alwaysApply: false` 的规则，都是先看描述再决定要不要把整份规则读进来，所以描述里一定要写"什么时候用"，而不只是"这是什么"。`globs` 是给 Cursor 用的，编辑匹配的文件时自动带上这条规则。

不同工具认的格式不一样，我写了一个零依赖的小脚本，从同一份 `SKILL.md` 转换出各家的格式。在临时目录里试一下：

```bash
node bin/cli.js -d /tmp/vus -s uniapp-cross-platform,uniapp-request
```

两个技能、四种工具，一共写出 9 个文件：`.claude/skills/` 下两个，`.cursor/rules/` 下两个 `.mdc`，`.trae/rules/` 下两个，`.agents/skills/` 下两个，再加一个 `AGENTS.md`。生成的 Cursor 规则头部是这样的：

```markdown
---
description: uni-app 跨端（H5 / 微信小程序 / App）开发与条件编译规范及常见坑。编写 uni-app 页面、组件、pages.json、manifest.json 时使用。
globs: **/*.vue,**/pages.json,**/manifest.json
alwaysApply: false
---
```

`AGENTS.md` 是写给 Codex 这类读项目说明的工具的，但很多项目里本来就有这个文件，不能直接覆盖。我的处理是用一对注释把自己的内容包起来，再次执行时只替换这一段：

```js
const re = /<!-- vue-uniapp-skills:start -->[\s\S]*?<!-- vue-uniapp-skills:end -->\n?/
cur = re.test(cur) ? cur.replace(re, block) : (cur ? cur.replace(/\n*$/, '\n\n') : '') + block
```

其他工具的文件默认是存在就跳过。比如对刚才那个目录再执行一次 `node bin/cli.js -d /tmp/vus -s uniapp-request -t cursor`，输出是"已写入 0 个文件""跳过 1 个已存在文件，加 --force 覆盖"。要更新得显式加 `--force`，避免把别人改过的规则覆盖掉。

写规则的过程中有几条体会：

1. 给能直接抄的代码，而不是大段描述。AI 对"像这样写"的理解远好于"注意不要怎样"；
2. 每个文件控制在几十行以内，我这 12 个文件最长的是请求封装，69 行。太长了占上下文，AI 也抓不住重点；
3. 会变的数字写上"以官方当前限制为准"，比如包体积限制，免得过时的数字被当成事实；
4. 在规则末尾加输出要求，比如跨端规则里要求生成代码时注明哪些平台测试过、平台独有能力必须有条件编译和降级方案。这一条能逼着 AI 在回答里主动交代平台差异，我审代码时省了不少事。

这些规则说到底就是一个 uni-app 老手写代码前心里过一遍的清单，只是现在要先把它写给 AI 看。

完整代码在 https://github.com/MsNan/vue-uniapp-skills
