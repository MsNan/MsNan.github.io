---
title: "给 Cursor / Claude 装上 uni-app 老手经验：开源 vue-uniapp-skills"
date: 2026-10-16
category: 前端
tags: [uni-app, Vue3, AI, Cursor, Claude Code]
description: "12 个中文 AI 技能：条件编译、分包、登录、支付、401 请求封装、Pinia、发版审核清单。一行 npx 装进 Cursor / Claude Code / Trae / Codex。"
---

AI 写 uni-app 代码时经常踩这些坑：用了 `axios` / `localStorage` / `div`，到小程序直接报错；忘了条件编译，H5 能跑、小程序白屏；401 一来，并发请求一起跳登录页；主包超过 2MB 传不上去。

我把这些踩坑经验写成 **12 个中文 AI 技能包**，开源成 [vue-uniapp-skills](https://github.com/MsNan/vue-uniapp-skills)，支持 Cursor Rules、Claude Code Skills、Trae Rules、Codex（`AGENTS.md`），一行命令装进项目。

## 一行安装

在 uni-app 项目根目录执行：

```bash
npx -y github:MsNan/vue-uniapp-skills
```

只装某个工具，或只装部分技能：

```bash
npx -y github:MsNan/vue-uniapp-skills --tool cursor
npx -y github:MsNan/vue-uniapp-skills --skills uniapp-request,uniapp-cross-platform
npx -y github:MsNan/vue-uniapp-skills --list
```

## 12 个技能覆盖什么

| 技能 | 解决什么 |
| --- | --- |
| `vue3-composition` | `<script setup>`、Composition API 写法 |
| `uniapp-project-structure` | 目录、命名、环境变量约定 |
| `uniapp-cross-platform` | 条件编译、跨端必知坑 |
| `uniapp-request` | `uni.request` 封装 + 401 只刷新一次 |
| `uniapp-login` | 微信 / H5 / App 多端登录 |
| `uniapp-payment` | 小程序 / App / H5 支付与订单确认 |
| `uniapp-subpackages` | 主包 2MB、分包与预下载 |
| `pinia-store` | setup store、持久化到 uni storage |
| `uniapp-ui-libs` | uni-ui / uView Plus easycom |
| `uniapp-permissions` | 定位相机等权限与隐私合规 |
| `uniapp-performance` | 长列表、图片、首屏 |
| `release-checklist` | 发版审核自查与常见驳回 |

## 技能长什么样：以请求封装为例

AI 最容易写错的是 401。多个接口同时 401 时，如果每个都去刷新 token、每个都跳登录页，用户会看到一串闪屏。技能里的写法是：**并发 401 共享一个 `refreshing` Promise，刷新失败只跳一次登录**。

```ts
let refreshing: Promise<boolean> | null = null
async function refreshToken(): Promise<boolean> {
  const user = useUserStore()
  if (!user.refreshToken) return false
  refreshing ||= new Promise<boolean>((resolve) => {
    uni.request({
      url: BASE_URL + '/auth/refresh',
      method: 'POST',
      data: { refreshToken: user.refreshToken },
      success: (r: any) => {
        if (r.statusCode === 200 && r.data.code === 0) {
          user.setToken(r.data.data)
          resolve(true)
        } else resolve(false)
      },
      fail: () => resolve(false),
    })
  }).finally(() => { refreshing = null })
  return refreshing
}
```

另外几条硬约束也会写进规则里：

- 用 `uni.request`，不要用 axios（小程序没有 XHR，除非单独装适配器）
- 标签用 `view` / `text` / `image`，不用 `div` / `span` / `img`
- 尺寸用 `rpx`，1px 边框单独用 `px`
- 平台差异大时用条件编译，并给出降级方案

## 跨端条件编译怎么写

```vue
<!-- #ifdef MP-WEIXIN -->
<button open-type="getPhoneNumber" @getphonenumber="onPhone">手机号登录</button>
<!-- #endif -->
<!-- #ifdef H5 || APP-PLUS -->
<SmsLogin />
<!-- #endif -->
```

JS 用 `// #ifdef`，CSS 用 `/* #ifdef */`。平台标识：`H5`、`MP-WEIXIN`、`APP-PLUS`、`MP`（所有小程序）。业务层尽量调统一接口，平台细节收到 `platform/` 里。

## 适合谁

- 用 Cursor / Claude Code / Trae / Codex 写 Vue3 + uni-app 的同学
- 接单、做毕设、维护小程序的人（审核清单和分包规则特别实用）
- 想让 AI「一开始就写对」，而不是生成完再改 20 分钟的人

## 相关链接

- 源码：[github.com/MsNan/vue-uniapp-skills](https://github.com/MsNan/vue-uniapp-skills)
- 同系列：[cn-dev-mcp](https://github.com/MsNan/cn-dev-mcp)（国内开发者离线 MCP 工具集）
- 博客项目页：[msnan.github.io](https://msnan.github.io/)

MIT 开源。有问题或想加新技能，直接提 Issue / PR。
