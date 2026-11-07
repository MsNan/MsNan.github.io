---
title: "订阅消息弹窗必须在用户点击里调：联调实验室里 timing 和 Mock 支付通知踩的坑"
date: 2026-11-07
category: 前端
tags: [uni-app, JavaScript, 订阅消息, Node.js]
description: "uniapp-wx-lab timing 复现：checkSubscribeTiming 只认布尔 flag、pay-lab setTimeout+afterPayCallback 演示绿灯、checklist 不扫代码、Mock 支付 CORS 未放行 x-lab-sign。"
---

<div v-pre>

同一天 CSDN 那篇写的是 uniapp-wx-lab 字段校验的边界；这篇换一条线：`requestSubscribeMessage` 什么时候能弹、Mock 支付为什么「看起来能弹」、以及支付回调验签在 H5 联调里怎么卡死。对照仓库 HEAD `bea299c`（`lib/check-subscribe-timing.js`、`examples/uni-app/utils/pay-lab.js`、`bin/cli.js`、`server/mock-server.js`），数字是本机 Node 24.22.1 跑出来的。

## 微信真正认的，是调用栈；实验室认的，是两个布尔值

微信要求：`uni.requestSubscribeMessage` 只能出现在用户点击手势，或 `uni.requestPayment` 的 success 同步回调里。页面 `onLoad` / `onShow`、接口返回后自动弹、定时器里弹，真机都会失败。

实验室把这件事收成了纯函数 `checkSubscribeTiming`：

```js
checkSubscribeTiming({})
// → allowed: false, reason: 'no_gesture_or_pay'
// tip 里明确写了：定时器、接口返回后自动弹都不行

checkSubscribeTiming({ afterUserGesture: true })  // allowed: true
checkSubscribeTiming({ afterPayCallback: true })  // allowed: true
```

它**不会**去读微信运行时，也不会看调用栈——你传什么 flag，它就信什么。`Boolean('yes')` 也会被当成 true。两个 flag 都传时，`reason` 优先记成 `after_pay_callback`（实现里先看支付回调）。`examples/uni-app/utils/subscribe-lab.js` 里的 `checkTiming` 是同一套逻辑的前端版：`!!(afterUserGesture || afterPayCallback)`；不合法就直接 `Promise.resolve({ ok: false })`，连 `uni.requestSubscribeMessage` 都不会调。

所以：`allowed: true` 只证明「你声称自己在合法上下文」，不证明「微信还认这笔手势」。代码审查可以靠它拦明显的空调用；真机是否能弹，仍要以平台规则为准。仓库里对 timing 的测试也只断言这三个布尔分支，没有、也做不到「模拟微信调用栈」。

## Mock 支付：setTimeout 之后再标 afterPayCallback

`examples/uni-app/utils/pay-lab.js` 的 `mockPayThenSubscribe` 默认 `delayMs = 600`，用 `setTimeout` 假装支付成功，然后：

```js
const sub = await requestSubscribeLab(tmplIds, { afterPayCallback: true });
```

实验室里这条路径会「成功」——因为 flag 被手动打开了。同一文件底部的 `REAL_PAY_HINT` 写得很清楚：生产必须在 `uni.requestPayment` 的 **success 同步回调**里调订阅；并且刻意不调用真实 `uni.requestPayment`，避免误拉收银台。

矛盾在于：`checkSubscribeTiming` 的失败 tip 点名「定时器……都不行」，而联调示例偏偏用定时器 + `afterPayCallback: true` 来演示「支付后订阅」。HEAD 上的 `pay-lab.js` 在 `setTimeout` 上方**没有**再写一句「真机上下文会丢」的警告——拷贝示例上线、却没换成真实支付 success 同步调用，就会在真机上翻车。实验室开关是为了可演示，不是平台豁免。

示例页 `pages/lab/index.vue` 的「仅点击后订阅」做得对：在 `@tap` 回调里传 `afterUserGesture: true`。那条路径可以学；模拟支付那条，只能学「支付成功后再订」的产品意图，不能学 `setTimeout` 那一层延迟。订阅详情页里还有一处故意传 `afterUserGesture: false, afterPayCallback: false` 的演示，用来打印「时机不合法」的 tip——那才是和 tip 文案一致的用法。

另外：`subscribe-lab` 对一次超过 3 个 `tmplId` 只 `console.warn`，不会拦截请求。平台历史上一次最多 3 个，建议仍 ≤3；警告不是硬失败，联调时别被「没抛错」骗过。

## checklist：提醒清单，不是静态分析

```bash
npx -y github:MsNan/uniapp-wx-lab checklist
```

`bin/cli.js` 把一段中文 Markdown 打到 stdout：手势 / 支付回调、一次 ≤3 个 tmplId、一次性与长期模板不要混、47003 先本地 `validate`、Mock 支付勿提交商户密钥、notify 按 `out_trade_no` 幂等等。大约 34 行，**不读你的工程、不扫 `setTimeout`、不解析 Vue `@tap`**。

它和 `checkSubscribeTiming` 是同一类工具：帮你列该问的问题。清单里写了「支付成功回调后再订阅」，但没有写「别在 setTimeout 里假装还在支付回调」——那一层要自己对着 `pay-lab.js` 看 `REAL_PAY_HINT`，并记住 tip 与示例之间的张力。

## 支付 Mock 通知：文档认 x-lab-sign，CORS 名单里却没有它

`POST /mock/pay/notify` 默认要验签（`MOCK_SKIP_SIGN=1` 可跳过）。签名来源：

```js
const sign = notify.sign || notify.signature || req.headers['x-lab-sign'];
```

对 body 做 `HMAC-SHA256`（`MOCK_API_KEY`，默认 `lab-test-key`）的 hex。本机实测：

| 请求 | 结果 |
| --- | --- |
| 无签名 | `401 sign verify failed` |
| Header `x-lab-sign` = HMAC(body) | `200`，`errcode: 0` |
| 把 `sign` 塞进 JSON，却对「不含 sign 的对象」算 HMAC | `401`（服务端对**整段 raw body**验签，字段里带 sign 会对不上） |

小程序原生请求通常不走浏览器 CORS。但若你在 **H5 页**对 `127.0.0.1:3789` 联调支付回调，预检会碰壁：`json()` 响应头里

```text
Access-Control-Allow-Headers: Content-Type, Authorization
```

没有 `x-lab-sign`。OPTIONS 实测返回的就是这两项——哪怕请求里带了 `Access-Control-Request-Headers: content-type,x-lab-sign`，服务端仍回固定名单。Node / curl 带自定义头仍然 200；浏览器预检过不去，表现就像「文档写了 HMAC 头、联调却一直失败」。

正确姿势（HEAD 行为下）：用 Header 传 `x-lab-sign`，或临时 `MOCK_SKIP_SIGN=1`；不要指望把 sign 塞进 JSON 再对「未含 sign 的片段」哈希。若要在 H5 里联调，还得把 `x-lab-sign` 加进 `Access-Control-Allow-Headers`（本地可改，未进当前 HEAD）。

## 和「字段全绿」是两件独立的事

联调经常两头同时翻车：一边是模板 `data` 过不了类型/长度；一边是弹窗根本起不来。把 timing 和字段拆开查，能少绕半天。本地 Mock 的 `POST /mock/subscribe/send` 只负责字段与 `errcode`；它**不会**检查你是不是在手势里调的客户端 API。反过来，`checkSubscribeTiming` 再绿，也不保证服务端下发能过。支付 Mock 的 CORS / 验签，则是第三条线——H5 联调支付回调时才会撞上。

## 联调时怎么用这三件套

1. **点击订阅**：只在 `@tap` / `@click` 里调，并显式传 `afterUserGesture: true`（给实验室看；真机靠调用栈）。
2. **支付后订阅**：接真实 `requestPayment` 的 success **同步**调用；不要把 `mockPayThenSubscribe` 的 `setTimeout` 拷进生产。
3. **支付回调 Mock**：Header 签名或显式跳过；H5 联调先看 CORS 是否放行自定义签名头。
4. **上线前再跑一遍 `checklist`**，当人工核对表，不当「已经静态证明安全」。

字段类型怎么被本地规则误伤，是另一篇文章的事。这篇只想钉死一件事：**实验室绿灯 ≠ 微信还认你的调用时机**；Mock 为了演示，会用布尔开关和延迟回调代替平台约束——拷贝示例时，把那一层开关当成警告，而不是通行证。

仓库：https://github.com/MsNan/uniapp-wx-lab

</div>
