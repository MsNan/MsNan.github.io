---
title: "订阅消息字段校验全绿，联调实验室里我还是挖出了 5 个坑"
date: 2026-11-06
category: 前端
tags: [uni-app, 小程序, 订阅消息, Node.js]
description: "uniapp-wx-lab 字段校验复现：value:null 变成 null 字符串放行、time/date 只认格式、电话\\d{7,15}过宽、英文名带数字掉进混合≤10、thing 全空白与 soft 注释名不副实。"
---

<div v-pre>

昨晚把 uni-app 微信小程序「支付 + 订阅消息」联调实验室跑通了：离线字段校验、时机检查、本地 Mock、18 条 `node:test` 全绿。样例 payload 一校验就过，`errcode: 0` 也回来了，看着挺安心。

越是这种「规则写在表里、测试也绿」的工具，越值得拿边界值去撞。今晚对着仓库 HEAD `bea299c`（`lib/validate-subscribe-data.js` / `lib/build-subscribe-payload.js`）挖了 5 处会在联调里误导人的行为。数字都是本机 Node 24.22.1 跑出来的，不是凭印象。

## 实验室在校验什么

微信订阅消息下发时，`data` 的 key 要和模板关键词对上，`value` 还要符合 thing / time / amount / name / phrase 等类型的长度和格式。实验室把这些规则收成纯函数，CLI 可以：

```bash
npx -y github:MsNan/uniapp-wx-lab validate examples/payloads/order-shipped.json
```

合法样例会打印 `ok: true`；非法样例则给出字段级 `errors`，Mock 服务对应微信常见的 `47003`。问题不在「正常路径」，而在「看起来像合法、其实不该过」的输入。

## 1. `{ value: null }` 会变成字符串 `"null"` 然后放行

校验入口会先拆 `{ value }`：

```js
const value = typeof raw === 'object' && raw !== null && 'value' in raw
  ? raw.value
  : raw
```

`null` / `undefined` 过不了「缺少字段」那一关（那一关看的是整个 `raw`），却进得了 `rule.check`。`thing` 里第一句是 `String(value)`——`String(null) === 'null'`，长度 4，于是：

```js
validateSubscribeData({ thing1: 'thing' }, { thing1: { value: null } })
// → { ok: true, errors: [] }
```

`buildSubscribePayload` 同样走 `String(raw)`，HEAD 上会直接造出 `{ value: 'null' }`。后端若用 `??` 或 ORM 空值填字段，本地校验可能一路绿灯，真发到微信才报 `47003`，或者更糟——把字面量 `"null"` 推到用户手机上。

## 2. time / date 只认「长得像」，不认日历

`time` / `date` 用了几条正则，例如 `YYYY-MM-DD HH:mm`。正则不管月份有没有 13、2 月有没有 30、小时能不能到 25：

```js
validateSubscribeData({ t: 'time' }, { t: { value: '2026-13-40 25:99' } }) // ok: true
validateSubscribeData({ d: 'date' }, { d: { value: '2026-02-30' } })       // ok: true
```

联调时这类脏数据常来自前端日期组件的原始字符串、或后端把「未选日期」格式化成了占位。格式过了、日历不过，Mock 还是 `errcode: 0`，真机下发才翻车。比较稳的做法是：正则过了之后再用 `Date` 回读年月日（以及时分秒上下界）做二次确认。

## 3. `phone_number` 的 `\d{7,15}` 兜底太宽

规则本意是「内地 11 位 / 带 +86」，后面又加了一条「7～15 位纯数字」当国际号兜底：

```js
/^(\+?86[-\s]?)?1[3-9]\d{9}$/  ||  /^\d{7,15}$/
```

结果是这些也会 `ok: true`：

| 输入 | 为什么能过 |
| --- | --- |
| `1234567` | 7 位数字走兜底 |
| `00000000000` | 11 位全 0，走兜底 |
| `11111111111` | 不以 `1[3-9]` 开头，仍走兜底 |

测试里只覆盖了 `13800138000` 和明显的 `abc`，没覆盖「纯数字垃圾」。国际号更合理的约束是**必须带 `+`**，例如 `^\+[1-9]\d{6,14}$`，不要用裸 `\d{7,15}`。

## 4. 英文名多一个数字，就掉进「混合 ≤10」

`name` 分三条路：偏中文 ≤10，纯 ASCII 字母（含空格 `.'-`）≤20，其余「混合」按中文 ≤10。`Theodore Tangping`（17）走英文，能过；改成 `Theodore Tangpin1`（同样 17，只是多了个数字）就报：

```text
name 混合内容按中文规则最长 10，当前 17
```

用户昵称、客服工号、`Theo2` 这类名字很常见。规则表写「英文 ≤20」，实现却把「带数字的英文」踹进中文桶——文档和行为不一致，比单纯拒掉更坑。

## 5. 全空白 thing 放行；注释里的 soft error 其实是硬失败

`thing` 用 `String(value)` 后直接判空，**不 trim**：

```js
validateSubscribeData({ thing1: 'thing' }, { thing1: { value: '   ' } }) // ok: true
```

三个空格长度是 3，既不是空，也没超 20。UI 没填内容、只留下 placeholder 空格时，本地仍算通过。

另一处是注释与行为不符：多余字段那段写着 “warn as soft errors”，但错误被推进同一个 `errors` 数组，最终 `ok: errors.length === 0`。多写一个 `thing99` 会直接 `ok: false`——作为实验室偏严其实合理（微信侧多余 key 也常直接 47003），但注释说 soft，读代码的人会以为「只告警不失败」。

## 顺手提一嘴：模拟支付里的 setTimeout

`examples/uni-app/utils/pay-lab.js` 用 `setTimeout` 假装支付成功，再带 `{ afterPayCallback: true }` 调订阅。实验室开关可以「放行」，**真实微信不会**：离开 `requestPayment` 的 success 同步调用栈后再异步弹订阅，手势/支付上下文就丢了。拷贝示例时务必看注释：生产只能在支付 success 里同步拉起，不能学 setTimeout 那一层延迟。

这一点和字段校验是同一类问题——**实验室为了可演示，用布尔开关代替了平台真实约束**。`checkSubscribeTiming` 本身只看你传入的 flag，不会去读微信运行时；它适合做代码审查提示，不适合当成「真机已经允许」的证明。

## Mock 绿了也不等于微信绿了

本地 `serve` 默认挂在 `127.0.0.1:3789`，`POST /mock/subscribe/send` 走的就是上面这套 `validateSubscribeData`。所以文中 1～5 在 Mock 里同样会放行或误杀：你用非法日历、`"null"` 字符串、垃圾电话号打本地接口，照样可能拿到 `errcode: 0`。CLI `validate` 与 Mock 共用规则，是好事（改一处两端一起变），也意味着规则漏洞会双向传播。

另外 CORS 响应头里的 `Access-Control-Allow-Headers` 起初只有 `Content-Type, Authorization`，没有 `x-lab-sign`。小程序里通常不走浏览器 CORS，但如果你在 H5 页面对 Mock 支付回调做联调，预检会卡在自定义签名头——这是边角，却是「文档写了 HMAC 头、浏览器预检没放行」的典型疏漏。

## 打算怎么改

本地补丁对 `bea299c` 可 `git apply --check`（未提交、未推送）：

1. `{ value: null/undefined }` 直接报错；`buildSubscribePayload` 同步抛 `TypeError`
2. time/date 在正则之后做日历与时分秒校验
3. 电话国际号改为必须 `+` 开头，去掉裸 `\d{7,15}`
4. 纯 ASCII（含数字）姓名走英文上限 20
5. thing 按 `trim()` 后判空；注释改成与硬失败一致；CORS 允许 `x-lab-sign`；pay-lab 补上 setTimeout 警告

补丁后原 18 条测试仍绿，并加到 24 条。合法的 `order-shipped.json` 不受影响。

## 一点复盘

订阅消息联调最费时间的不是「会不会调 API」，而是 **本地绿、微信红**。离线校验的价值在于提前暴露脏数据；它的风险也在于：正则过宽、`String()` 吞空值、分支表与文档不一致时，会给你虚假的安全感。写校验时我现在会固定问三句：

- 空值（`null` / `''` / 纯空白）分别怎么走？
- 「格式合法」和「语义合法」是不是两层？
- 注释里的 soft / hard，和 `ok` 布尔值是否同一套定义？

仓库：https://github.com/MsNan/uniapp-wx-lab

</div>
