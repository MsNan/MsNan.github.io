---
title: "Express + JWT 实现前台用户与管理后台双角色鉴权（uni-app 商城实战）"
date: 2026-10-15
category: 后端
tags: [Node.js, Express, JWT, uni-app]
description: "同一 JWT 密钥、不同载荷，实现前台用户与管理后台互不越权，附前端请求封装与 401 处理的坑。"
---

做商城类项目时，前台用户和管理后台通常是两套登录体系：用户用手机号验证码登录，要求长时间保持登录；管理员用账号密码登录，权限大，登录态要短。本文结合一个 uni-app + Express 的商城项目，拆解它是如何用**同一个 JWT 密钥**实现两种角色互不越权的，以及前端请求封装、401 处理中容易踩的坑。

技术栈：后端 Express + jsonwebtoken + lowdb；前台 uni-app（Vue 3 + Pinia）；管理后台为原生 JS 单页。

## 一、整体思路

| 角色 | 登录方式 | Token 载荷 | 有效期 | 校验中间件 |
| --- | --- | --- | --- | --- |
| 前台用户 | 手机号 + 验证码 | `{ uid }` | 30 天 | `auth` |
| 管理员 | 账号 + 密码 | `{ admin }` | 12 小时 | `guard` |

关键点在于：**两类 Token 用同一个 SECRET 签发，但载荷字段不同，各自的中间件只认自己的字段**。这样即使用户拿着自己的 Token 去请求 `/api/admin/*`，也会因为没有 `admin` 字段被拒绝；反过来管理员 Token 没有 `uid`，也调不了用户接口。

## 二、密钥配置：开发与生产区分

```js
const SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (await import('node:crypto')).randomBytes(32).toString('hex') : 'taohaowu-dev-secret')
```

这一行做了三层兜底：

1. 优先读环境变量 `JWT_SECRET`；
2. 生产环境没配置时，启动时随机生成 32 字节密钥，避免使用人人都知道的默认值；
3. 开发环境用固定字符串，方便重启后 Token 仍然有效。

注意第 2 点的副作用：**服务每次重启，所有已签发的 Token 都会失效**。所以生产环境一定要显式配置 `JWT_SECRET`，随机密钥只是安全兜底，不是推荐用法。

## 三、前台用户：签发与校验

### 1. 登录签发

```js
app.post('/api/auth/login', async (req, res) => {
  const { phone, code } = req.body
  const c = db.data.codes[phone]
  if (!c || c.code !== String(code) || Date.now() > c.exp) return fail(res, '验证码错误或已过期')
  delete db.data.codes[phone]
  let u = db.data.users.find(u => u.phone === phone)
  if (!u) { u = { id: nid(), phone, nickname: '淘友' + phone.slice(-4), createdAt: Date.now() }; db.data.users.push(u) }
  if (u.disabled) return fail(res, '账号已被禁用', 403)
  await db.write()
  ok(res, { token: jwt.sign({ uid: u.id }, SECRET, { expiresIn: '30d' }), user: u })
})
```

几个细节值得注意：

- 验证码校验通过后立即 `delete`，保证**一码一用**，防止重放；
- `String(code)` 统一类型，避免前端传数字导致 `!==` 判断失败；
- 首次登录自动注册，登录和注册合并成一个接口；
- 载荷里只放 `uid`，**不放手机号、昵称等信息**。JWT 只是 Base64 编码而不是加密，任何人都能解出载荷内容。

### 2. 校验中间件

```js
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '')
  try { req.uid = jwt.verify(t, SECRET).uid; if (!req.uid || db.data.users.find(u => u.id === req.uid)?.disabled) throw 0; next() } catch { fail(res, '请先登录', 401) }
}
```

这个中间件把所有失败情况都收敛到一个 `catch` 里，统一返回 401：

- 没带 Token / 格式错 / 签名不对 / 已过期 —— `jwt.verify` 直接抛错；
- Token 合法但没有 `uid`（比如拿管理员 Token 来调）—— 手动 `throw 0`；
- 用户已被后台禁用 —— 同样 `throw 0`。

最后一点很重要：**JWT 本身是无状态的，签出去就无法撤回**。30 天有效期内如果用户被封禁，单靠 `jwt.verify` 是拦不住的。这里每次请求都去查一下用户的 `disabled` 标记，用一次轻量查询换来了"即时封禁"的能力。

使用时直接挂在路由上：

```js
app.get('/api/me', auth, (req, res) => ok(res, db.data.users.find(u => u.id === req.uid)))
```

## 四、管理后台：签发与统一守卫

```js
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }
app.post(A + '/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!safeEq(username, ADMIN_USER) || !safeEq(password, ADMIN_PASSWORD)) return fail(res, '账号或密码错误', 401)
  ok(res, { token: jwt.sign({ admin: username }, SECRET, { expiresIn: '12h' }), edition: EDITION })
})
const guard = (req, res, next) => {
  try { const p = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), SECRET); if (!p.admin) throw 0; next() } catch { fail(res, '请先登录后台', 401) }
}
app.use(A, (req, res, next) => (req.path === '/login' ? next() : guard(req, res, next)))
```

和用户侧相比有三处不同：

**1. 用 `timingSafeEqual` 比较密码。** 普通的 `===` 在遇到第一个不同字符时就返回，攻击者理论上可以通过响应时间差逐位猜测。`crypto.timingSafeEqual` 是常量时间比较，但它要求两个 Buffer 长度一致，否则直接抛异常，所以前面先判断了 `x.length === y.length`。

**2. 有效期只有 12 小时。** 后台权限大，Token 泄露的代价远高于普通用户，缩短有效期是最简单的降低风险的方式。

**3. 用前缀中间件统一守卫。** 不必在每个后台路由上手动写 `guard`，而是 `app.use('/api/admin', ...)` 一次性拦截，只放行 `/login`。新增后台接口时不会因为忘记加中间件而裸奔，这比逐个路由挂中间件更不容易出错。

此外，管理员密码也做了和 SECRET 类似的兜底：

```js
if (!ADMIN_PASSWORD) {
  if (process.env.NODE_ENV === 'production') { ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url'); console.warn('[admin] 未设置 ADMIN_PASSWORD，本次随机密码：' + ADMIN_PASSWORD) }
  else { ADMIN_PASSWORD = 'admin123'; console.warn('[admin] 开发模式默认账号 admin / admin123，生产环境请设置 ADMIN_PASSWORD') }
}
```

生产环境绝不使用弱口令默认值，这是很多开源项目上线后被入侵的常见原因。

## 五、uni-app 请求封装：自动携带 JWT

```js
export function request(url, { method = 'GET', data } = {}) {
  const token = uni.getStorageSync('token')
  return new Promise((resolve, reject) => {
    uni.request({
      url: API_BASE + '/api' + url, method, data,
      header: token ? { Authorization: 'Bearer ' + token } : {},
      success: r => {
        if (r.statusCode === 200 && r.data.code === 0) return resolve(r.data.data)
        const msg = r.data?.message || '请求失败'
        if (r.statusCode === 401) { uni.removeStorageSync('token') }
        uni.showToast({ title: msg, icon: 'none' }); reject(new Error(msg))
      },
      fail: e => { uni.showToast({ title: '网络开小差了', icon: 'none' }); reject(e) }
    })
  })
}
```

要点：

- **每次请求时才读取 Token**，而不是在模块顶部读一次缓存起来。否则登录后旧模块里的变量还是空值，要刷新页面才生效。
- 没有 Token 时不发送 `Authorization` 头，避免后端收到 `Bearer undefined`。
- `uni.request` 的 `success` 回调**只要服务器有响应就会触发，包括 4xx/5xx**，只有网络层失败才进 `fail`。所以必须同时判断 `statusCode` 和业务码 `code`。
- 统一解包 `r.data.data`，业务代码拿到的直接就是数据。

登录成功后在 Pinia 中写入 Token：

```js
async login(phone, code) {
  const r = await api.login(phone, code)
  this.token = r.token; this.user = r.user
  uni.setStorageSync('token', r.token); uni.setStorageSync('user', r.user)
  // ...合并游客购物车
},
requireLogin() {
  if (this.token) return true
  uni.navigateTo({ url: '/pages/login/login' }); return false
}
```

## 六、管理后台的 401 处理

```js
async function api(url, opt = {}) {
  const r = await fetch('/api/admin' + url, { method: opt.method || 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: opt.body && JSON.stringify(opt.body) })
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 && url !== '/login') { logout(); throw new Error('登录已过期') }
  if (j.code !== 0) { toast(j.message || '请求失败'); throw new Error(j.message) }
  return j.data
}
```

注意 `url !== '/login'` 这个条件：登录接口密码错误时也返回 401，如果不排除，用户输错密码会被当成"登录过期"，提示信息就错了。这是 401 统一处理时非常常见的一个坑。

## 七、常见坑总结

1. **用户 Token 越权调用后台接口。** 两套 Token 共用 SECRET 时，中间件必须校验角色字段（本文的 `uid` / `admin`），只校验签名等于没有角色隔离。更严格的做法是两个角色使用不同的密钥。
2. **封禁后 Token 依然可用。** JWT 无法主动撤销，需要在中间件里查一次用户状态，或者维护黑名单。
3. **生产环境沿用默认密钥 / 默认密码。** 一旦源码公开，等于把签名密钥公开，任何人都能伪造管理员 Token。
4. **401 只清了 Storage，没清内存状态。** 本文的 uni-app 封装在 401 时执行了 `uni.removeStorageSync('token')`，但 Pinia 里的 `this.token` 还在，`requireLogin()` 仍会返回 true，页面会显示已登录。修正方法是在 401 时同时调用 store 的 `logout()`。由于 store 本身也 import 了 request.js，两者存在循环引用，所以 `useShopStore()` 要放在回调内部调用，而不是在模块顶层执行：

   ```js
   import { useShopStore } from '../store'
   // ...
   if (r.statusCode === 401) { uni.removeStorageSync('token'); try { useShopStore().logout() } catch (e) {} }
   ```

5. **登录接口自身的 401 被误判为过期**，如第六节所示，需要排除登录地址。
6. **把敏感信息放进载荷。** JWT 载荷可被任意解码，只放 ID 和角色标识。
7. **`uni.request` 的 `success` 不等于成功。** 一定要判断 `statusCode`。

## 八、小结

这套方案的核心可以归纳为三句话：同一密钥、不同载荷、中间件只认自己的字段；有效期按权限大小区分；前端在请求层统一携带 Token、统一处理 401。对于中小型项目，这样已经能满足大部分双角色场景。如果后续角色增多，可以把载荷改为 `{ sub, role }`，再写一个 `requireRole('admin')` 的中间件工厂来扩展。

完整代码见 GitHub：MsNan/taohaowu-shop
