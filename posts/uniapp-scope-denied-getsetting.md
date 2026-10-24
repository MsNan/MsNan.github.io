---
title: "uni-app 小程序授权被拒一次就再也不弹？getSetting 三态 + 隐私协议弹窗的完整处理"
date: 2026-10-24
category: 前端
tags: [uni-app, 微信小程序, Vue]
description: "微信小程序授权拒绝一次后 authorize 不再弹窗。按 getSetting 三态封装 ensureScope，openSetting 引导、隐私协议弹窗注册与 App 端权限说明，附自查清单。"
---

做小程序的同学大概都遇到过这种反馈：「点了定位没反应」「上传头像按钮点了没用」。一查日志，是 `authorize:fail auth deny`——用户第一次弹窗时点了拒绝，之后再调 `uni.authorize`，微信不会再弹任何窗口，直接失败。

再往后，2023 年微信又加了一层「隐私协议」，没同意隐私协议时，连授权弹窗都不会出现，报的错还不一样。两层叠在一起，很多项目的授权逻辑就是一堆零散的 `try/catch`，哪里报错补哪里。

这篇把 uni-app（Vue3 + TS）里微信小程序授权这件事按步骤理一遍：先声明、再判断三种授权状态、被拒后怎么引导、隐私协议弹窗怎么接、两种失败怎么区分。最后简单说一下 App 端。

## 第 1 步：先分清两层"授权"

小程序里其实有两个独立的开关：

| 层 | 管什么 | 用户在哪操作 | 没过时的表现 |
| --- | --- | --- | --- |
| 隐私协议 | 能不能调用"隐私接口"（定位、相册、剪贴板、手机号等） | 你的隐私弹窗 / 微信官方弹窗 | `xxx:fail privacy permission is not authorized` |
| scope 授权 | 具体某项权限（`scope.userLocation`、`scope.camera`、`scope.record` 等） | 微信的授权弹窗、设置页 | `authorize:fail auth deny` 之类 |

顺序是：先过隐私协议，再过 scope 授权。很多"点了没反应"的问题，就是只处理了第二层。

## 第 2 步：在 manifest.json 里声明

uni-app 的 `manifest.json` 里 `mp-weixin` 节点下的内容会写进小程序的 `app.json`。定位这类接口需要两处声明：

```json
{
  "mp-weixin": {
    "permission": {
      "scope.userLocation": { "desc": "用于展示离你最近的门店" }
    },
    "requiredPrivateInfos": ["getLocation"]
  }
}
```

- `permission.xxx.desc` 是授权弹窗里显示的用途说明，写具体用途，"用于更好的服务"这种很容易被审核打回。
- `requiredPrivateInfos` 用于定位相关接口（`getLocation`、`chooseLocation` 等），不声明的话接口直接不可用。

另外，小程序管理后台要填写《用户隐私保护指引》，把用到的信息类型都勾上。微信文档写得很明确：**只有在指引里声明过的信息，对应接口才能调用，没声明的直接禁用**。这一步不在代码里，但最常漏。

## 第 3 步：用 getSetting 判断三种状态

`uni.getSetting()` 返回的 `authSetting` 里，某个 scope 的值有三种情况：

- `true`：已经同意；
- `false`：曾经拒绝过，这时 `uni.authorize` 不会再弹窗，只能引导去设置页；
- `undefined`：从来没问过，可以调 `uni.authorize` 弹窗。

按这三种状态写一个统一函数：

```ts
// utils/permission.ts
export async function ensureScope(scope: string, tip: string) {
  const { authSetting } = await uni.getSetting()
  if (authSetting[scope]) return true
  if (authSetting[scope] === false) {
    const { confirm } = await uni.showModal({ title: '需要授权', content: tip, confirmText: '去设置' })
    if (!confirm) return false
    const r = await uni.openSetting()
    return !!r.authSetting[scope]
  }
  try { await uni.authorize({ scope }); return true } catch { return false }
}
```

业务里这样用：

```ts
async function locate() {
  const ok = await ensureScope('scope.userLocation', '需要你的位置来推荐附近门店，请在设置中打开"位置信息"')
  if (!ok) {
    // 降级：让用户手动选城市，而不是什么都不做
    showCityPicker.value = true
    return
  }
  const { latitude, longitude } = await uni.getLocation({ type: 'gcj02' })
  // ...
}
```

两点说明：

1. uni-app Vue3 项目里 `uni.xxx()` 不传回调时返回 Promise，所以可以直接 `await`。
2. 拿不到授权时一定要有降级路径。审核规范里也有"不得强制授权才能使用"这一条，用户拒绝了定位，至少还能手动选城市。

## 第 4 步：openSetting 只能在点击里调用

微信文档对 `wx.openSetting` 的限制是"仅在点击行为时调用"（基础库 2.3.0 起）。上面那段在 `showModal` 点"去设置"之后调用，是社区常见写法；但如果你的调用链前面还有别的异步操作，离用户点击太远，可能会遇到打不开设置页的情况。

稳妥一点的做法是在页面上直接放一个按钮，用 `open-type="openSetting"`：

```vue
<template>
  <view v-if="denied" class="perm-tip">
    <text>没有定位权限，附近门店无法显示</text>
    <!-- #ifdef MP-WEIXIN -->
    <button size="mini" open-type="openSetting" @opensetting="onOpenSetting">去开启</button>
    <!-- #endif -->
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const denied = ref(false)
function onOpenSetting(e: any) {
  if (e.detail.authSetting['scope.userLocation']) {
    denied.value = false
    locate()
  }
}
</script>
```

`open-type="openSetting"` 是微信小程序的能力，所以用条件编译包起来。另外设置页只会显示"小程序已经向用户请求过"的权限，从没调过 `authorize` 的权限在设置页里是看不到的。

## 第 5 步：接上隐私协议弹窗

基础库 2.32.3 起有 `onNeedPrivacyAuthorization`：当用户还没同意隐私协议、而你调用了隐私接口时，这个事件会触发，原接口进入等待状态，直到你调用 `resolve`。

几个要点直接来自微信文档：

- 它是**覆盖式注册**，多次注册只有最后一次生效，所以放在 `App.vue` 的 `onLaunch` 里注册一次；
- 注册了就**必须调用 resolve**，否则原接口一直挂着；
- 同意时调用 `resolve({ buttonId, event: 'agree' })`，`buttonId` 必须是一个 `open-type="agreePrivacyAuthorization"` 按钮的 id，基础库会检查这个按钮是不是真的被点过；
- 拒绝时调用 `resolve({ event: 'disagree' })`，原接口失败。

先用 Pinia 存一下 resolve 和弹窗状态：

```ts
// stores/privacy.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

type Resolver = (r: { event: 'agree' | 'disagree'; buttonId?: string }) => void

export const usePrivacyStore = defineStore('privacy', () => {
  const show = ref(false)
  let resolver: Resolver | null = null
  function open(r: Resolver) { resolver = r; show.value = true }
  function answer(agree: boolean, buttonId?: string) {
    resolver?.(agree ? { event: 'agree', buttonId } : { event: 'disagree' })
    resolver = null
    show.value = false
  }
  return { show, open, answer }
})
```

在 `App.vue` 里注册监听：

```ts
// App.vue
import { onLaunch } from '@dcloudio/uni-app'
import { usePrivacyStore } from '@/stores/privacy'

onLaunch(() => {
  // #ifdef MP-WEIXIN
  if (uni.canIUse('onNeedPrivacyAuthorization')) {
    const privacy = usePrivacyStore()
    uni.onNeedPrivacyAuthorization((resolve) => privacy.open(resolve))
  }
  // #endif
})
```

如果 TS 提示 `uni` 上没有 `onNeedPrivacyAuthorization` / `openPrivacyContract` 的类型（取决于你装的类型包版本），在条件编译块里直接用 `wx.xxx` 或补一个类型声明即可，微信端运行时 uni 一般会把这类调用转给 wx。

弹窗组件里，同意按钮要用 `open-type` 和对应事件，**不能只写 `@click`**（社区里不少"同意了还是报 privacy permission is not authorized"的问题就是这个原因）：

```vue
<!-- components/privacy-popup/privacy-popup.vue -->
<template>
  <view v-if="privacy.show" class="mask">
    <view class="box">
      <text class="title">隐私保护提示</text>
      <text class="desc">使用前请阅读</text>
      <text class="link" @click="openContract">《用户隐私保护指引》</text>
      <view class="btns">
        <button @click="privacy.answer(false)">拒绝</button>
        <button id="agree-btn" open-type="agreePrivacyAuthorization"
          @agreeprivacyauthorization="privacy.answer(true, 'agree-btn')">同意</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { usePrivacyStore } from '@/stores/privacy'
const privacy = usePrivacyStore()
const openContract = () => uni.openPrivacyContract({})
</script>
```

这个组件要放在会调用隐私接口的页面里（或者用全局组件方案）。如果你注册了监听却没弹出自己的窗口、也没调用 resolve，接口就会一直等着；而如果完全不注册监听，微信会在需要时弹官方的隐私弹窗。用户拒绝官方弹窗后 10 秒内再调隐私接口，不会再弹，直接报错。

## 第 6 步：区分"拒绝了隐私协议"和"拒绝了授权"

第 3 步的 `ensureScope` 有个不够细的地方：`uni.authorize` 失败一律返回 `false`。但失败可能有两种原因：

- 用户拒绝了 scope 授权：`authSetting[scope]` 会变成 `false`，下次走"去设置"分支，没问题；
- 用户拒绝了**隐私协议**：这时根本没到 scope 授权那一步，`authSetting[scope]` 还是 `undefined`，错误信息里带 `privacy`。如果这时提示"请去设置里打开定位"，用户去了设置页也找不到这一项。

所以 catch 里可以把原因带出来：

```ts
type ScopeResult = 'ok' | 'denied' | 'privacy'

export async function ensureScopeEx(scope: string, tip: string): Promise<ScopeResult> {
  const { authSetting } = await uni.getSetting()
  if (authSetting[scope]) return 'ok'
  if (authSetting[scope] === false) {
    const { confirm } = await uni.showModal({ title: '需要授权', content: tip, confirmText: '去设置' })
    if (!confirm) return 'denied'
    const r = await uni.openSetting()
    return r.authSetting[scope] ? 'ok' : 'denied'
  }
  try {
    await uni.authorize({ scope })
    return 'ok'
  } catch (e: any) {
    return String(e?.errMsg ?? '').includes('privacy') ? 'privacy' : 'denied'
  }
}
```

调用方拿到 `'privacy'` 时，提示"需要先同意隐私保护指引"，并允许用户再次触发；拿到 `'denied'` 再走"去设置"。

## 第 7 步：App 端简单说两句

App 端没有 scope 这套机制，但应用商店审核更严，几条硬要求：

1. **首次启动先弹隐私政策**，用户同意之前不初始化任何第三方 SDK、不读取设备信息。uni-app 提供了隐私政策提示框的配置（`androidPrivacy.json` 模板），具体字段以 DCloud 文档为准。
2. Android 申请敏感权限前，先弹一个说明"为什么需要"的提示，再调系统授权（`plus.android.requestPermissions`）。国内几个主流商店都会检查这一点。
3. iOS 在 manifest 里填写各个 `NSxxxUsageDescription`，文案写清用途。
4. 原则和小程序一样：用到再申请，不要启动就要全部权限；拒绝后功能降级而不是卡住。

## 自检清单

发版前对照一遍：

- [ ] `manifest.json` 里 `permission` 写了具体用途，定位类接口加了 `requiredPrivateInfos`
- [ ] 小程序后台《用户隐私保护指引》勾选了所有用到的信息类型
- [ ] 授权统一走一个函数，按 `true / false / undefined` 三种状态处理
- [ ] 被拒后有"去设置"入口，且由用户点击触发
- [ ] `onNeedPrivacyAuthorization` 只在 `App.vue` 注册一次，所有分支都会调用 resolve
- [ ] 同意按钮用的是 `open-type="agreePrivacyAuthorization"`，id 和 resolve 里的 buttonId 一致
- [ ] 每个需要授权的功能都有拒绝后的降级方案

## 最后

上面第 3 步的 `ensureScope` 和"按需申请、拒绝后降级"的原则，是我整理在 uni-app 技能包里的 `uniapp-permissions` 规则，给 Cursor / Claude Code 这类工具写代码时参考；第 6 步区分隐私拒绝的写法是这次整理时补的，仓库里的规则还是第 3 步的版本。

仓库：https://github.com/MsNan/vue-uniapp-skills
