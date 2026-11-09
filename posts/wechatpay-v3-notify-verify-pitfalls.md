---
title: "微信支付 APIv3 回调验签总失败？用 Node 内置 crypto 把常见原因挨个复现了一遍"
date: 2026-11-09
category: 后端
tags: [Node.js, JavaScript, 微信支付, 小程序]
description: "uniapp-wx-lab pay-v3 复现：express.json 改写 body、全局中间件顺序、商户证书误用、漏尾换行、探测签名、maxSkewSeconds 非法值悄悄关掉时间戳检查、GCM tag 在末尾、APIv3 密钥多换行。"
---

<div v-pre>

做小程序支付联调，最让人心慌的一步是回调：本地代码跑通了，上了服务器，商户平台说已经通知，日志里却全是"验签失败"。偏偏这一步又没法拿真实商户号反复试。

前几天我给联调实验室 uniapp-wx-lab 加了 APIv3 回调的本地验签和解密（`lib/pay-v3.js`，零依赖，只用 Node 内置 `crypto`），顺手把常见的失败原因一条条做成了可复现的脚本。先说清楚边界：下面的实验用的是本地生成的 RSA 密钥对和仓库里的公开测试密钥，规则按微信支付官方文档实现，并用 openssl 和 Python 的 `cryptography` 交叉核对过；**没有在真实商户号的回调上验证过**。环境是 Node 24.22.1。

## 先把规则摆出来

APIv3 回调验签只有三样东西：

```text
验签串 = Wechatpay-Timestamp + "\n"
       + Wechatpay-Nonce     + "\n"
       + 原始请求体           + "\n"
签名   = Base64 解码(Wechatpay-Signature)
公钥   = Wechatpay-Serial 对应的「微信支付平台证书」或「微信支付公钥」
算法   = SHA256 with RSA
```

验过签以后，body 里的 `resource` 还要用 APIv3 密钥做 AEAD_AES_256_GCM 解密才能拿到订单信息。规则就这几行，但每一行都能出错。

## 1. body 被框架解析过一遍，再拼回去就不是原来那串了

这是我见得最多的一种。Express 项目习惯全局挂 `express.json()`，到了回调路由里拿 `JSON.stringify(req.body)` 去验签。问题是 JSON 有很多种合法写法，`JSON.parse` 再 `stringify` 只能还原"值"，还原不了"字节"。

我在复现里造了一个带空格、中文被 `\u` 转义、斜杠被 `\/` 转义的 body（都是合法 JSON），用平台私钥签好名，然后：

```text
原始 body 长度 / 重新序列化后长度   [118, 88]
重新序列化后  {"id":"EV-1","summary":"支付成功","url":"https://example.com","resource":{"ciphertext":"x"}}
verify       {"ok":false,"reason":"签名不匹配（检查是否用了原始 body、是否用了平台证书而不是商户证书）"}
```

再真起一个 Express 5 服务，同一个请求分别打到两个路由：

```js
app.post('/json', express.json(), (req, res) => {
  verify({ body: JSON.stringify(req.body) }) // false
})
app.post('/raw', express.raw({ type: 'application/json' }), (req, res) => {
  verify({ body: req.body })                 // req.body 是 Buffer，true
})
```

结果是 `/json` 验签失败，`/raw` 通过。

还有一个顺序问题：如果全局已经 `app.use(express.json())`，再在回调路由上加 `express.raw()` 是没用的，body 已经被前一个中间件读完解析了，raw 会直接跳过。我试了一下，这时路由里的 `req.body` 还是普通对象，验签函数直接返回"body 必须是原始请求体字符串或 Buffer"。所以回调路由要注册在全局 JSON 中间件**之前**，或者全局中间件跳过这个路径。Koa、Nest 也是同一回事，去找它们"拿原始 body"的配置。

## 2. 公钥拿错了：商户证书 ≠ 平台证书

商户申请 APIv3 时会拿到一套「商户 API 证书」，那是你**发请求**时签名用的；微信回调时用的是**它自己的**私钥签名，你要用「微信支付平台证书」（或在商户平台开通的「微信支付公钥」）来验。

拿商户证书的公钥去验，结果和第 1 条一模一样：

```text
verify(merchant pubkey)  {"ok":false,"reason":"签名不匹配（...）"}
```

两种错误报错一样，排查时先确认用的是哪把公钥，再查 body。

顺带一个小发现：Node 的 `crypto.verify` 可以直接吃 X.509 证书 PEM（`-----BEGIN CERTIFICATE-----` 开头的那种），不用先手动提取公钥，我用 openssl 生成的自签证书验过，结果 `ok: true`。证书序列号可以用 `new crypto.X509Certificate(pem).serialNumber` 取，Node 返回的是大写十六进制，跟请求头 `Wechatpay-Serial` 比之前建议两边都统一大小写。

## 3. 自己拼验签串，漏了最后一个换行

很多人会自己写验签而不用 SDK，最容易漏的是**最后那个 `\n`**。body 后面也有一个换行，即便 body 是空串也要保留：

```text
crypto.verify(漏尾 \n)   false
crypto.verify(带尾 \n)   true
```

这种错在代码评审时很难看出来，最好直接写成一个函数，用单测钉死：

```js
function buildNotifySignMessage(timestamp, nonce, body) {
  return `${timestamp}\n${nonce}\n${body == null ? '' : body}\n`
}
// '1554209980\nabc\n{"a":1}\n'
// 空 body：'1\nn\n\n'
```

## 4. 签名探测流量：WECHATPAY/SIGNTEST/ 开头的签名必须判失败

微信支付会发一种"签名探测"请求，`Wechatpay-Signature` 以 `WECHATPAY/SIGNTEST/` 开头，用来检查商户到底有没有在验签。官方要求这种请求必须按验签失败处理，返回 4xx/5xx。

如果你的代码为了联调方便写了"验签失败也先返回 200"，或者签名解析出错就放行，正好会被它查出来。uniapp-wx-lab 里遇到这个前缀直接返回：

```text
{"ok":false,"probe":true,"reason":"签名探测流量（WECHATPAY/SIGNTEST/），应按验签失败应答 4xx/5xx"}
```

## 5. 时间戳检查，以及我自己代码里的一个漏洞

验签通过只说明"这条消息确实是微信签的"，不说明"这条消息是刚发的"。拿一条旧通知重放，签名照样对。所以要检查 `Wechatpay-Timestamp` 和服务器当前时间的偏差，默认我给了 300 秒：

```text
now = ts + 301   {"ok":false,"reason":"时间戳与当前时间相差超过 300 秒（可能是重放或服务器时间不准）"}
```

服务器时间不准也会触发这一条，上线前确认一下 NTP。

写这篇时我把参数也挨个试了一遍，发现 `maxSkewSeconds` 这个选项有个口子。原来的代码是：

```js
const maxSkew = o.maxSkewSeconds === undefined ? 300 : Number(o.maxSkewSeconds)
if (maxSkew > 0) { /* 检查偏差 */ }
```

只要传进来的值不是 `undefined`，就走 `Number()`。于是 `''` 变成 0，`'abc'`、`'5m'` 变成 `NaN`，`-1` 是负数，这些情况下 `maxSkew > 0` 都是 false，时间戳检查就被悄悄关掉了：

```text
now = ts + 86400，maxSkewSeconds=""     {"ok":true}
now = ts + 86400，maxSkewSeconds="abc"  {"ok":true}
now = ts + 86400，maxSkewSeconds="5m"   {"ok":true}
now = ts + 86400，maxSkewSeconds=-1     {"ok":true}
```

最常见的触发方式是 `maxSkewSeconds: process.env.WX_SKEW`，而部署时 `.env` 里写了 `WX_SKEW=` 或 `WX_SKEW=5m`。一天前的通知照样通过，还不会报任何错。

同一类问题还有一个：设置了 `expectedSerial`，但请求头里干脆没带 `Wechatpay-Serial` 时，序列号比对被跳过了（签名本身还是要用你的公钥验过，所以不算能伪造，但"我设置了比对"和"实际没比对"不一致）。

改法很简单：传了就必须是 >= 0 的有限数字，0 才表示"不检查"；设置了 `expectedSerial` 就要求请求头必须带序列号：

```js
const maxSkew = o.maxSkewSeconds === undefined ? 300 : Number(o.maxSkewSeconds)
if (o.maxSkewSeconds === null || String(o.maxSkewSeconds).trim() === '' ||
    !Number.isFinite(maxSkew) || maxSkew < 0) {
  return { ok: false, reason: `maxSkewSeconds 必须是 >= 0 的数字（0 表示不检查）` }
}
```

补丁后上面四种写法都返回明确的错误，仓库原有 30 条测试加 2 条新用例，32 条全绿。这个改动我还没合进仓库。

还有一点时间戳挡不住：5 分钟内的重复通知。微信本身就可能重复通知同一笔订单，所以业务侧要按 `out_trade_no` / `transaction_id` 做幂等，订单已是"已支付"就直接应答成功，别再加一遍积分或发一遍货。

## 6. 解密：32 字节、tag 在末尾、associated_data 别改

验签过了，解密 `resource` 还有三个常见的坑。

**密钥多了一个换行。** APIv3 密钥必须正好 32 字节。从 `.env` 或密钥文件里读，最容易带进一个 `\n`，Windows 上是 `\r\n`：

```text
密钥末尾带 \n      APIv3 密钥必须是 32 字节，当前 33 字节
密钥末尾带 \r\n    APIv3 密钥必须是 32 字节，当前 34 字节
```

长度检查能拦住这种。但它拦不住另一种：商户平台上还有一把 APIv2 密钥，同样是 32 位字符串，误填进来长度完全对，只会得到一个笼统的"解密失败"：

```text
同样 32 字符的另一把密钥   解密失败：APIv3 密钥、nonce 或 associated_data 不对，或密文被改动
```

GCM 失败时不会告诉你是哪一项错了，所以看到这个报错，第一件事是去商户平台确认填的是 APIv3 密钥。

**认证标签在密文末尾。** `ciphertext` Base64 解码后，最后 16 字节是 GCM 的 auth tag，前面才是真正的密文。仓库样例解出来是 397 字节，去掉 tag 剩 381 字节。如果整段塞进 `update()`，又不 `setAuthTag()`，`final()` 就会抛：

```text
Unsupported state or unable to authenticate data
```

这里有个容易混的地方：Python `cryptography` 的 `AESGCM.decrypt()` 恰好要的就是"密文 + tag"整段，所以从 Python 示例翻译成 Node 时很容易忘了拆。正确写法：

```js
const raw = Buffer.from(resource.ciphertext, 'base64')
const data = raw.subarray(0, raw.length - 16)
const tag = raw.subarray(raw.length - 16)
const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'))
d.setAuthTag(tag)
d.setAAD(Buffer.from(resource.associated_data || '', 'utf8'))
const plain = Buffer.concat([d.update(data), d.final()]).toString('utf8')
```

我用 Python 的 `AESGCM` 整段解同一份样例，得到的字段和 Node 版一致（amount、appid、out_trade_no、transaction_id 等 11 个）。

**associated_data 一个字都不能动。** 它参与认证但不加密，少一个字母（`transaction` 改成 `transactio`）就会解密失败。`associated_data` 为空时传空串，不要传 `undefined` 拼出 `"undefined"`。

## 本地怎么快速核对

不想写代码时，uniapp-wx-lab 带了一个命令，密钥只从环境变量读（不从命令行参数读，避免进 shell 历史）：

```bash
# 用仓库样例和公开测试密钥试一下
npx -y github:MsNan/uniapp-wx-lab decrypt-notify examples/payloads/pay-notify-v3.json --lab-key

# 解自己抓到的回调
WXPAY_APIV3_KEY=你的32字节APIv3密钥 npx -y github:MsNan/uniapp-wx-lab decrypt-notify notify.json
```

代码里用的话：

```js
// npm i github:MsNan/uniapp-wx-lab （没发 npm，直接从 GitHub 装）
const { verifyNotifySignature, decryptNotifyResource } = require('uniapp-wx-lab')

// 注册在 app.use(express.json()) 之前
app.post('/pay/notify', express.raw({ type: 'application/json' }), (req, res) => {
  const v = verifyNotifySignature({
    headers: req.headers,
    body: req.body,                 // Buffer，原样
    publicKey: PLATFORM_CERT_PEM,   // 平台证书或微信支付公钥
    expectedSerial: PLATFORM_SERIAL,
  })
  if (!v.ok) return res.status(401).json({ code: 'FAIL', message: v.reason })
  const notify = JSON.parse(req.body.toString('utf8'))
  const order = decryptNotifyResource(notify.resource, process.env.WXPAY_APIV3_KEY)
  // 按 out_trade_no 幂等处理 ...
  res.status(204).end()
})
```

## 排查顺序

最后把我的排查顺序列一下，按"最常见、最便宜"排：

1. 回调路由拿到的是不是原始 body（Buffer / 原字符串），有没有被全局 JSON 中间件先吃掉（路由注册顺序）；
2. 公钥是平台证书 / 微信支付公钥，不是商户证书；序列号对得上；
3. 自己拼验签串的话，三行，每行都以 `\n` 结尾；
4. 探测签名要判失败，别为了联调写"失败也返回 200"；
5. 时间戳偏差检查有没有真的生效（打印一下最终用的阈值）；服务器时间准不准；
6. 解密失败：先看密钥长度和是不是 APIv3 密钥，再看 tag 有没有拆、associated_data 有没有原样传。

复现脚本跑一遍不到一秒，每条都能看到"错的时候报什么"。下次线上看到验签失败，对着报错查表就行。

仓库：https://github.com/MsNan/uniapp-wx-lab

</div>
