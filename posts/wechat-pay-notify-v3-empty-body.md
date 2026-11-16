---
title: "微信支付 APIv3 回调成功了，别再回 200 加一段 JSON"
date: 2026-11-16
category: 后端
tags: [Node.js, 微信支付, JavaScript, Express]
description: "对照微信支付官方回调文档和 uniapp-wx-lab v0.3.0 Mock：成功应回 200 或 204 且无包体；200+JSON、sendStatus(200) 的 OK、APIv2 XML 都会带上包体。未在真实商户号上验证。"
---

<div v-pre>


前几天花了一篇文章，把微信支付 APIv3 回调验签总失败的常见原因挨个复现了一遍：原始 body 被框架解析后再拼回去、拿商户证书去验平台签名、验签串漏了最后的换行。那是 uniapp-wx-lab v0.2.0 的内容。v0.3.0（提交 4a8944d）在本地 Mock 里加了一个商户端参考实现：`POST /mock/pay/notify-v3`。今天只谈应答，验签细节不再展开。

先看官方怎么写。微信支付商户文档《支付成功回调通知》（小程序支付，https://pay.weixin.qq.com/doc/v3/merchant/4012791902）里，「对回调通知进行应答」这一节是这样规定的：

- 验签通过：HTTP 状态码返回 200 或 204，无需返回应答报文。成功示例就是「无应答包体」。
- 验签不通过：返回 4xx 或 5xx，同时返回 `{"code":"FAIL","message":"..."}`。
- 要在 5 秒内先完成验签和应答，业务处理放到应答之后，避免超时。
- 同样的通知可能多次到达，已经处理过也要继续应答成功；文档的说法是「持续应答 200」。失败或超时，微信会按 15s / 15s / 30s / 3m / 10m / 20m / 30m / 30m / 30m / 60m / 3h / 3h / 3h / 6h / 6h 的频率重试，最多 15 次。
- 不能只靠回调下结论，还要结合查单接口，避免通知丢失或延迟。

200 和 204 都可以，关键是成功时不要带包体。失败时才需要 `code` 和 `message`。我在 Express 4.22.3 里对照了几种常见写法，并且用原始 TCP 看了线上字节，不只是看 http 客户端解析后的 body。环境是 Node 24.22.1。官方测试 41 条全绿，CI run 43070644932 通过。

## 符合文档的两种成功应答

`res.status(204).end()` 线上是：

```text
HTTP/1.1 204 No Content
（没有 Content-Type，没有包体）
```

`res.status(200).end()` 线上是 200，`Content-Length: 0`，包体为空。这两种都符合「200 或 204，无应答包体」。参考实现选的是 204。重复通知到达时，文档写「持续应答 200」，回 204 空包体同样是成功应答；实验室对重复通知也是 204，只在自己的记录里打 `duplicate`。

Koa、Nest 是同一回事：成功时把状态码设成 200 或 204，把 body 留空，不要再 `ctx.body = { code: 'SUCCESS' }`。

## 三种会带上包体的写法

`res.status(200).json({ code: 'SUCCESS', message: '成功' })` 状态码是 200，但线上是 37 字节的 JSON：

```text
Content-Type: application/json; charset=utf-8
Content-Length: 37

{"code":"SUCCESS","message":"成功"}
```

这是从 APIv2 带着「回一段 SUCCESS」的习惯过来的。文档的成功示例里没有这段 JSON；`code` 和 `message` 是失败时才要返回的字段。

`res.sendStatus(200)` 更容易被忽略。它看起来只是设了状态码，Express 却会把状态文本写进包体。线上是 `Content-Type: text/plain`，`Content-Length: 2`，包体就是两个字母：`OK`。状态码看起来成功，其实已经带了包体。

再往后是直接把 APIv2 的 XML 拿来用：

```xml
<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>
```

状态码 200，包体 96 字节。APIv3 已经不用这种应答了。

同一个实验室里，还有一个较老的 `POST /mock/pay/notify` 端点，用来模拟 APIv2 风格的通知，成功时会回 200，并且带上 `return_code: SUCCESS` 这段 JSON。那是故意留给旧链路对照的，不要把它的应答方式抄到 APIv3 的 `/mock/pay/notify-v3` 上。我这次打的是新端点。

## 204 加上 JSON，框架往往会把包体剥掉

还有一种容易误会的：`res.status(204).json({ code: 'SUCCESS' })`。Express 4 会把 204 的包体和 Content-Type 剥掉，线上是干净的 204。Node 自己的 `ServerResponse` 遇到 204 也不会把 `end()` 里的内容发出去，但如果你手写了 `Content-Type` 甚至 `Content-Length`，头里可能还留着这些字段，包体却是空的。我试过 `writeHead(204, { Content-Type, Content-Length: 18 })` 再 `end` 一段 JSON，线上只有头，没有那 18 个字节，`Content-Length` 却写着 18。这种报文本身就不干净，对端如果较真，未必会按「无包体的 204」来理解。

参考实现没有走这条路。成功时是 `writeHead(204)` 然后 `end()`，头里也不带 Content-Type。

## 对着官方 Mock 打了一遍

用本地生成的 RSA 密钥对签好通知，打 `POST /mock/pay/notify-v3`，返回 204，包体 0 字节，没有 Content-Type。同一笔再打一次，仍然是 204，`GET /mock/pay/recent` 里会标 `duplicate: true`。改一个字节再拿原来的签名去打，是 401，JSON 里是 `code: FAIL`。签名探测头 `WECHATPAY/SIGNTEST/` 即使开了 `MOCK_SKIP_SIGN=1` 也按失败回 4xx——探测流量本来就应该走验签失败这条路，微信随后会带正确签名重发。仓库自带的 `examples/payloads/pay-notify-v3.json` 在跳过验签时也能走到 204。

失败应答里会多一个实验室自己的 `lab` 字段，是本地排费用的，真实后端不需要。微信不会回调 `127.0.0.1`，这个 Mock 只用来对照自己的处理逻辑，不能代替真实回调。我也没有在真实商户号上验证过：如果成功时回了 200 再加一段 JSON，微信会不会把它当成失败，我不知道。所以只对照文档和本地报文，不把它写成「线上一定会被重试」。

另外两个跟应答有关、这次只能按文档讲的点：业务处理如果放在应答前并且超过 5 秒，会触发重试；如果把重复通知当成错误回 4xx，微信也会一直重发，最坏会持续大约一天。参考实现的做法是先验签、再解密、立刻回 204，已经处理过也还是 204，只在自己的记录里打标记。真正改订单状态，应该放在应答之后，并且按订单号做重入保护。

仓库：https://github.com/MsNan/uniapp-wx-lab

</div>
