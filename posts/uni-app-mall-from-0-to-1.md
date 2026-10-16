---
title: "从 0 到 1 做一个带管理后台的 uni-app 商城（附免费源码）"
date: 2026-10-14
category: 前端
tags: [uni-app, Vue3, Node.js, Express]
description: "一套 uni-app 代码跑 H5、小程序和 App，后端 Express，自带 /admin 管理后台，按真实代码讲架构与关键实现。"
---

> 一套 uni-app 代码跑 H5、小程序和 App，后端 Node.js + Express，自带 `/admin` 管理后台，开源免费。本文按真实代码讲技术栈、架构和几段关键实现。

## 一、技术栈

| 层 | 选型 |
|---|---|
| 前端 | uni-app（Vue 3 + Vite）+ Pinia + uni-icons，一套代码出 H5 / 微信小程序 / Android / iOS |
| 后端 | Node.js + Express，依赖只有 `express`、`cors`、`jsonwebtoken`、`lowdb` 四个 |
| 数据 | lowdb（单个 JSON 文件 `server/data/db.json`，删掉即重置） |
| 鉴权 | JWT（前台用户 30 天，后台管理员 12 小时） |
| 管理后台 | 原生 JS + HTML，挂在 `/admin`，不需要构建 |

## 二、整体架构

```
src/                 uni-app 前端（pages / components / store / api）
  api/request.js     统一请求封装，自动带 JWT
server/
  index.js           前台全部 REST 接口（约 200 行）
  admin.js           管理后台接口
  edition.js         免费版 / 付费版功能开关
  admin/             后台页面（原生 JS）
  seed.json          商品、分类、轮播种子数据
```

前台和后台共用同一份 lowdb 数据，后端构建 H5 后还会顺手托管 `dist/build/h5`，所以一个 `npm start` 就能同时访问商城和后台。

前台已实现：首页（搜索、轮播、秒杀倒计时、商品流）、分类、搜索、商品详情与规格弹层、购物车（游客购物车登录后自动合并）、手机号验证码登录（模拟短信）、收货地址、下单 → 模拟收银台 → 订单列表/详情、售后申请（仅退款 / 退货退款 / 换货）。

## 三、关键代码

### 1. JWT 登录

验证码登录成功后签发 token，未注册手机号自动建号：

```js
app.post('/api/auth/login', async (req, res) => {
  const { phone, code } = req.body
  const c = db.data.codes[phone]
  if (!c || c.code !== String(code) || Date.now() > c.exp) return fail(res, '验证码错误或已过期')
  delete db.data.codes[phone]            // 验证码一次性
  let u = db.data.users.find(u => u.phone === phone)
  if (!u) { u = { id: nid(), phone, nickname: '淘友' + phone.slice(-4), createdAt: Date.now() }; db.data.users.push(u) }
  if (u.disabled) return fail(res, '账号已被禁用', 403)
  await db.write()
  ok(res, { token: jwt.sign({ uid: u.id }, SECRET, { expiresIn: '30d' }), user: u })
})
```

鉴权中间件同时检查“用户是否被后台禁用”：

```js
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '')
  try {
    req.uid = jwt.verify(t, SECRET).uid
    if (!req.uid || db.data.users.find(u => u.id === req.uid)?.disabled) throw 0
    next()
  } catch { fail(res, '请先登录', 401) }
}
```

前端在 `request.js` 里统一加 `Authorization: Bearer <token>`，收到 401 就清掉本地 token。后台登录用 `crypto.timingSafeEqual` 比较账号密码，签发的 token 里带 `admin` 字段，和前台 token 互不通用。

### 2. 订单状态流转

状态：`待付款 → 待发货 → 待收货 → 已完成`，待付款可转 `已取消`。用一个小工厂函数统一做“当前状态是否允许这个动作”的校验，并记录时间线：

```js
function transit(from, to, msg, extra) {
  return async (req, res) => {
    sweep(); const o = myOrder(req.uid, req.params.id)
    if (!o) return fail(res, '订单不存在', 404)
    if (!from.includes(o.status)) return fail(res, `当前状态「${o.status}」不可操作`)
    o.status = to; o.timeline.push({ t: Date.now(), s: msg }); extra?.(o, req); await db.write(); ok(res, o)
  }
}
app.post('/api/orders/:id/pay',     auth, transit(['待付款'], '待发货', '支付成功（模拟）', ...))
app.post('/api/orders/:id/cancel',  auth, transit(['待付款'], '已取消', '用户取消订单', ...))
app.post('/api/orders/:id/confirm', auth, transit(['待收货'], '已完成', '已确认收货，交易完成'))
```

未支付超时自动取消（默认 15 分钟，`PAY_TIMEOUT_MS` 可改）：定时器每 10 秒扫一次，查询订单前也会先扫一次。

```js
function sweep() {
  const now = Date.now(); let changed = false
  for (const o of db.data.orders)
    if (o.status === '待付款' && now > o.expireAt) { o.status = '已取消'; o.cancelReason = '超时未支付'; changed = true }
  if (changed) db.write()
}
setInterval(sweep, 10 * 1000)
```

### 3. 免费版 / 付费版授权校验思路

所有功能登记在一张表里，`free` 人人可用，`pro` 需要授权：

```js
export const FEATURE_TABLE = {
  'admin.products': 'free', 'admin.orders': 'free', 'admin.dashboard.basic': 'free', ...
  'admin.dashboard.charts': 'pro', 'admin.export.csv': 'pro', 'admin.aftersale': 'pro',
  'admin.products.batch': 'pro', 'admin.rewards.manage': 'pro', 'admin.users.disable': 'pro'
}
```

启动时用 `EDITION`、`LICENSE_OWNER`、`LICENSE_SALT`、`LICENSE_KEY` 校验授权码（`TH-PRO-` + sha256(owner:salt) 前 16 位），不匹配就自动回退免费版。关键在于**接口层拦截**，不是只把前端按钮藏起来：

```js
const need = f => (req, res, next) =>
  has(f) ? next() : fail(res, '该功能属于付费版，请配置授权后使用', 402)
app.get(`${A}/orders-export`, need('admin.export.csv'), ...)
app.get(`${A}/aftersales`,    need('admin.aftersale'), ...)
```

> 实话说一句：开源代码里的离线校验只是“功能开关”，不是防破解机制。想做真正的授权，需要服务端在线校验。

## 四、截图

![后台登录](/images/shop-admin-login.png)
![数据概览（免费版）](/images/shop-admin-dashboard-free.png)
![数据概览（付费版：趋势图、分类销售额、热销 TOP5）](/images/shop-admin-dashboard-pro.png)
![商品管理](/images/shop-admin-products.png)
![订单管理与发货](/images/shop-admin-orders.png)
![免费版访问售后审核：接口返回 402，页面提示升级](/images/shop-admin-aftersales-free-locked.png)
![H5「我的」页](/images/shop-h5-my.png)

## 五、运行步骤

需要 Node.js 18+。

```bash
git clone https://github.com/MsNan/taohaowu-shop.git
cd taohaowu-shop/server && npm install && npm start   # http://localhost:3000
# 另开终端，在项目根目录
npm install && npm run dev:h5                          # H5 开发调试
# 或 npm run build:h5，构建后直接访问 http://localhost:3000
```

- 管理后台：http://localhost:3000/admin/ ，开发模式默认 `admin / admin123`；生产环境务必设置 `JWT_SECRET` 和 `ADMIN_PASSWORD`（不设置时会生成随机密码打印到控制台）。
- 验证码：开发模式会打印在后端控制台，并显示在登录页。
- 微信小程序：`npm run build:mp-weixin`，用微信开发者工具导入 `dist/build/mp-weixin`。
- App：用 HBuilderX 打开项目云打包（iOS 需要 Apple 开发者账号）。
- 端到端测试：`node tests/e2e.cjs`（puppeteer-core + 无头 Chrome）。

## 六、局限（写在前面免得踩坑）

- lowdb 是单文件数据库，只适合演示和小流量，正式环境建议换 MySQL/PostgreSQL。
- 短信和支付都是模拟的，上线需要接入真实短信服务和微信/支付宝支付。

## 获取源码

- **免费版（开源）**：https://github.com/MsNan/taohaowu-shop
- **付费进阶版**（趋势图表、CSV 导出、售后审核、批量上下架、用户禁用、打赏核对）：正在整理，上架后会在公众号「程序员项目库」发通知
- 交流：关注公众号「程序员项目库」

> 本项目仅供学习参考。

