---
title: "一个手机号验证码登录接口的五个坑：无限发码、无限试码，传个数字就让 Express 进程退出"
date: 2026-11-03
category: 后端
tags: [Node.js, Express, 安全, JavaScript]
description: "Express 4 + lowdb 短信登录的五个问题：发码无频率限制、验证码无限试、regex.test 隐式转字符串导致数组重复注册与 async 抛错让进程退出、过期码不清理、地址 PUT 合并整个 body。"
---

我那个 uni-app 电商练手项目「淘好物」带了一个演示后端：Express 4 + lowdb（JSON 文件当数据库）+ JWT，登录方式是手机号 + 短信验证码（短信是模拟的，验证码打印在控制台）。之前写过它的购物车数量和售后状态，这次看的是登录接口和紧挨着的收货地址接口。

一开始只是想确认"验证码能不能被猜出来"，写了个脚本逐项去打，结果比预想的多：一个号码可以无限发验证码、验证码可以无限次试、传数组能注册出一个新账号、传数字能让整个服务直接退出，地址编辑接口能写进任意字段。下面的数字都是我在本机跑出来的（Node 24.22.1，Express 4.22.3），服务用仓库当前代码以开发模式启动。

## 原来的两个接口

```js
app.post('/api/auth/sms', async (req, res) => {
  const { phone } = req.body
  if (!/^1\d{10}$/.test(phone || '')) return fail(res, '手机号格式不正确')
  const code = String(Math.floor(100000 + Math.random() * 900000))
  db.data.codes[phone] = { code, exp: Date.now() + 5 * 60 * 1000 }; await db.write()
  console.log(`[模拟短信] ${phone} 验证码 ${code}`)
  ok(res, DEV ? { devCode: code } : {})
})
app.post('/api/auth/login', async (req, res) => {
  const { phone, code } = req.body
  const c = db.data.codes[phone]
  if (!c || c.code !== String(code) || Date.now() > c.exp) return fail(res, '验证码错误或已过期')
  delete db.data.codes[phone]
  let u = db.data.users.find(u => u.phone === phone)
  if (!u) { u = { id: nid(), phone, nickname: '淘友' + phone.slice(-4), createdAt: Date.now() }; db.data.users.push(u) }
  // ...签发 JWT
})
```

开发模式下接口会把验证码直接返回（`devCode`），README 里写了部署时设 `NODE_ENV=production` 关掉，这个没问题。下面讨论的都是关掉之后仍然存在的问题。

## 一、发送没有任何频率限制

同一个号码连发 50 次：

```text
同一号码连发 50 次 sms    {"200":50}，146ms
```

全部成功。换成真短信通道，这就是一个现成的"短信轰炸"接口：别人可以拿你的接口去刷任意号码，钱是你出的。每次请求还会把新码覆盖旧码，用户刚收到的验证码随时可能失效。

至少要有两层限制：

- **按号码**：同一号码 60 秒内只能发一次，这也是前端"60 秒后重新获取"按钮背后应该对应的服务端规则。只在前端倒计时等于没限制。
- **按来源 IP**：防止换着号码刷。我这里先用一个内存 `Map` 记每个 IP 一小时内的发送时间，超过 20 次拒绝。

```js
const SMS_GAP_MS = 60 * 1000, SMS_MAX_PER_IP_HOUR = 20
const ipHits = new Map() // 单进程内存计数，多实例部署要换成 Redis
function ipLimited(ip, now) {
  const list = (ipHits.get(ip) || []).filter(t => now - t < 3600 * 1000)
  if (list.length >= SMS_MAX_PER_IP_HOUR) { ipHits.set(ip, list); return true }
  list.push(now); ipHits.set(ip, list); return false
}
// 在 /api/auth/sms 里
const now = Date.now(), old = db.data.codes[phone]
if (old && now - old.sentAt < SMS_GAP_MS)
  return fail(res, `发送太频繁，请 ${Math.ceil((SMS_GAP_MS - (now - old.sentAt)) / 1000)} 秒后再试`, 429)
if (ipLimited(req.ip, now)) return fail(res, '发送次数过多，请稍后再试', 429)
```

改完后同样的 50 次：`{"200":1,"429":49}`。

两点提醒：内存计数在多进程或多实例下各算各的，正式环境要放 Redis；另外如果服务放在 Nginx 后面，`req.ip` 拿到的是代理地址，需要配置 Express 的 `trust proxy`，否则所有用户共享一个 IP 额度。真实项目里一般还会在发送前加图形验证码或滑块，这个演示项目没做。

## 二、验证码可以无限次试

登录接口对错误次数没有任何记录。我先发一次码，然后用 200 个错误验证码去试，最后再用正确的：

```text
错 200 次后用正确码    {"400 验证码错误或已过期":200}；正确码 → 200 拿到 token
本机串行校验速度        2803 次/秒
```

错了 200 次，正确的码照样能用。6 位验证码一共 90 万种（100000～999999），有效期 5 分钟。本机串行一个连接大约每秒 2800 次，5 分钟大约 84 万次，已经接近全部覆盖了，并发起来更快。这只是本地回环的数字，隔着公网会慢很多，但"限制次数"不能指望"网络慢"。

改法是在验证码记录里加一个计数，错到第 5 次就作废，必须重新获取：

```js
if (c.code !== code) {
  if ((c.tries = (c.tries || 0) + 1) >= CODE_MAX_TRIES) {
    delete db.data.codes[phone]; await db.write()
    return fail(res, '验证码错误次数过多，请重新获取')
  }
  await db.write(); return fail(res, '验证码错误或已过期')
}
```

这里有个我自己第一次写错的地方：一开始写的是 `++c.tries`。补丁上线时库里已经存在的旧验证码记录没有 `tries` 字段，`++undefined` 是 `NaN`，`NaN >= 5` 永远是 `false`，这些旧码就永远不会被作废。改成 `(c.tries || 0) + 1` 以后，我手动造了一条没有 `tries` 的旧记录试了，错 5 次后被正常作废。

改完后的结果：

```text
错 200 次后用正确码    {"400 验证码错误或已过期":199,"400 验证码错误次数过多，请重新获取":1}；正确码 → 400
```

第 5 次错误时作废，之后连正确的码也不再有效，攻击者每轮最多试 5 次，而每轮重新发码又受第一节的 60 秒限制。

顺手把验证码生成从 `Math.random()` 换成了 `crypto.randomInt(100000, 1000000)`。`Math.random` 不是密码学安全的随机数，对验证码这种要防猜的场景，用 `crypto` 没有任何额外成本。

## 三、`regex.test()` 会把数组和数字转成字符串

这一节是最出乎我意料的。手机号校验用的是 `/^1\d{10}$/.test(phone || '')`，看起来没问题，但 `RegExp.prototype.test` 会先把参数转成字符串。于是：

```js
/^1\d{10}$/.test(['13900000002'])  // true，数组转成 "13900000002"
/^1\d{10}$/.test(13900000003)      // true，数字转成 "13900000003"
```

`express.json()` 解析出来的 `req.body` 里什么类型都可能有。

**传数组：注册出一个新账号。** 先用字符串 `"13900000002"` 正常登录一次，拿到 uid 1001。再用 `phone: ["13900000002"]` 发码、登录：

```text
sms 传 phone: [号码]    200
用数组登录               200 uid=1002（字符串登录 uid=1001）phone=["13900000002"] nickname=淘友13900000002
```

`db.data.codes[phone]` 用数组当对象的键，会被转成字符串 `"13900000002"`，所以发码、取码都走通了；但 `users.find(u => u.phone === phone)` 是严格相等，数组不等于字符串，于是又建了一个新用户，库里存的 `phone` 是一个数组。昵称也是错的：数组的 `slice(-4)` 返回的是最后一个元素组成的数组，拼成字符串就是整个号码。

**传数字：整个服务退出。**

```text
sms/login 传 phone: 数字    sms 200，login ERR UND_ERR_SOCKET，之后 GET /categories → ERR ECONNREFUSED，进程退出码 1
服务端 stderr              TypeError: phone.slice is not a function
```

数字没有 `slice` 方法，抛出 `TypeError`。关键在于这个 handler 是 `async` 函数，Express 4 不会捕获 async 函数返回的 Promise 被 reject 的情况，错误一路冒成未处理的 Promise 拒绝。Node 15 以后未处理的拒绝默认会让进程退出，所以一个请求就能把服务打挂（之后所有接口都连接被拒）。如果是用 pm2 之类的进程管理器托管会被拉起来，但反复发这一个请求就能一直打断服务。

修法分两层：

```js
const PHONE_RE = /^1[3-9]\d{9}$/
const asPhone = v => (typeof v === 'string' && PHONE_RE.test(v) ? v : null)
// 登录接口里 code 也要求是 6 位数字字符串
if (!phone || typeof code !== 'string' || !/^\d{6}$/.test(code)) return fail(res, '验证码错误或已过期')
```

1. 对外部输入**先判断类型再用正则**。正则只管字符串长什么样，管不了它是不是字符串。
2. 更根本的是 async 路由的错误兜底：Express 4 里要么每个 async handler 自己 `try/catch`，要么包一层把 reject 传给 `next`，再加一个错误处理中间件返回 500。Express 5 已经原生支持 async handler 抛出的错误。这个补丁只修了类型校验，没有改全局错误处理，这点单独记下来。

改完后：数组和数字都在发码时就返回 400 "手机号格式不正确"，服务不受影响。

## 四、过期的验证码永远留在库里

`codes` 只在登录成功时 `delete`。没登录成功的号码，记录会一直留在 `db.json` 里。300 个号码各发一次：

```text
db.json 16998 → 40698 字节
```

lowdb 每次 `write()` 都是把整个 JSON 重写一遍，这个文件越大，每次写入越慢。项目里本来就有一个每 10 秒跑一次的 `sweep()`（用来把超时未付款订单取消），我把清理过期验证码加进去：

```js
for (const [k, c] of Object.entries(db.data.codes))
  if (now > c.exp + SMS_GAP_MS) { delete db.data.codes[k]; changed = true }
```

多留一个 `SMS_GAP_MS` 是为了让 60 秒发送间隔的判断在验证码过期后仍然能读到 `sentAt`。我把过期时间临时调短，确认 sweep 之后记录确实被删掉了。

（改完后同样的 300 次只增长到 18739 字节，但这主要是因为第一节的 IP 限制只放过了 20 次，不能算作清理的效果，清理是单独验证的。）

## 五、地址编辑接口：POST 有校验，PUT 没有

登录拿到 token 之后，紧接着就是收货地址。新增地址的 POST 有校验：

```js
if (!name || !/^1\d{10}$/.test(phone || '') || !region || !detail) return fail(res, '请完整填写收货信息')
```

但编辑地址的 PUT 是这样的：

```js
if (req.body.isDefault) myAddr(req.uid).forEach(x => (x.isDefault = false))
Object.assign(a, { ...req.body, id: a.id, uid: a.uid })
```

`id` 和 `uid` 有保护，其余字段原样合并。用同样的非法值和几个多余字段去 PUT：

```text
POST 空姓名/手机号 123         400 请完整填写收货信息
PUT 同样的值 + 额外字段          200 name="" phone=123 isDefault=false uid=1001 admin=true note=50000
唯一地址之后的默认地址数          0
用这个地址下单                  200 收货手机号=123 收货人=""
```

三个问题：

1. POST 拦下的非法值，PUT 全部能写进去，而且能用这个地址正常下单。
2. 请求里的任意字段（这里的 `admin`、`note`）都会被存进库。这个项目里地址对象没有被别处当权限依据，所以 `admin: true` 本身没有效果，但这种"整个 body 合并进去"的写法换到用户表上就是越权。`note` 我传的是 5 万个字符，也照单全收。
3. 把唯一一个默认地址的 `isDefault` 改成 `false` 以后，这个用户就没有默认地址了。确认订单页取不到默认地址时会退回取第一个，所以不影响下单，但删除地址接口里专门维护了"删完以后总要留一个默认"，PUT 这里却能绕开这个约定。

改法是抽一个 POST 和 PUT 共用的字段白名单函数：

```js
function addrFields(b = {}) {
  const str = (v, max) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)
  const a = { name: str(b.name, 20), phone: asPhone(b.phone), region: str(b.region, 60), detail: str(b.detail, 120) }
  return Object.values(a).every(Boolean) ? { ...a, isDefault: b.isDefault === true } : null
}
// PUT 里
const f = addrFields(req.body)
if (!f) return fail(res, '请完整填写收货信息')
if (f.isDefault) myAddr(req.uid).forEach(x => (x.isDefault = false))
// 只能通过「把别的地址设为默认」来取消默认，保证始终有一个默认地址
Object.assign(a, { ...f, isDefault: f.isDefault || a.isDefault })
```

`isDefault` 只认严格的 `true`，原来的 `!!isDefault` 会把字符串 `"false"` 也当成真。改完后同样的 PUT 返回 400，默认地址数保持 1；正常编辑一个地址、把另一个地址设为默认，我也手动试过，行为和原来一致。

## 小结

1. 短信接口必须有服务端的发送频率限制，按号码、按 IP 至少各一层，前端倒计时不算。
2. 验证码要限制错误次数，错到上限就作废；新增字段时考虑旧数据没有这个字段的情况。
3. `regex.test()` 会把参数转成字符串，外部输入先 `typeof` 再用正则。
4. Express 4 的 async handler 里抛错会变成未处理的 Promise 拒绝，Node 15+ 默认直接退出进程。
5. 有过期时间的数据要有清理逻辑，尤其是 lowdb 这种每次全量写文件的存储。
6. 新增和编辑共用一套校验和字段白名单，不要 `Object.assign(obj, req.body)`。

完整的复现脚本和补丁目前只在我本地副本里跑过，仓库里还是原来的代码。

仓库：https://github.com/MsNan/taohaowu-shop
