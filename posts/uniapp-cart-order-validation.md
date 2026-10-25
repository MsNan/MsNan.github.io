---
title: "购物车价格前端算过了，后端为什么还要再算？uni-app 商城里 5 个下单链路的坑"
date: 2026-10-25
category: 前端
tags: [uni-app, Node.js, Pinia, Express]
description: "用 curl 直接打 uni-app + Express 商城的接口，翻出 5 个问题：游客车价格快照过期、登录合并失败丢商品、数量传 -7 和 0.01 能下单、下架商品照样成交、401 后 Pinia 状态不同步。"
---

之前写过一个 uni-app 商城的练手项目：前端 uni-app（Vue3 + Pinia），后端 Express + lowdb，支付是模拟的。页面、下单、订单状态流转都能跑通，自己点了很多遍也没发现问题。

最近回头补测试，换了个方式：不点页面，直接用 curl 打后端接口。结果购物车和下单这条链路上翻出好几个问题，有前端的，也有后端的。这篇按"数据从哪来、在哪算、谁说了算"的顺序把它们理一遍。代码都是项目里的真实代码，问题都实际跑过。

## 购物车的数据结构

先看购物车一项长什么样。商品详情页的规格弹窗里，用户选完规格，弹窗把选中的选项拼成字符串：

```js
// components/spec-popup.vue
const emit = action => { ev('confirm', { action, spec: picked.value.join(' / '), qty: qty.value }); close() }
```

购物车用 `商品id|规格字符串` 当唯一键，同一个商品选了不同规格就是两行，相同规格再加一次就累加数量：

```js
// store/index.js（游客分支）
const key = product.id + '|' + spec
const f = this.guestCart.find(i => i.key === key)
if (f) f.qty += qty
else this.guestCart.push({ key, productId: product.id, spec, qty, checked: true, product })
this.persist()   // 写进 uni.setStorageSync('guestCart')
```

Pinia 里有两份购物车：未登录时用本地存储里的 `guestCart`，登录后用服务端返回的 `serverCart`，靠一个 getter 切换：

```js
getters: {
  cart(s) { return s.token ? s.serverCart : s.guestCart },
  checkedItems() { return this.cart.filter(i => i.checked) },
  checkedTotal() { return this.checkedItems.reduce((t, i) => t + i.product.price * i.qty, 0) }
}
```

这个设计本身没什么问题，页面只管用 `store.cart`，不用关心登没登录。问题出在 `product` 这个字段上。

## 问题 1：游客车里存的是商品快照，价格会过期

游客分支 push 进去的是整个 `product` 对象，然后整个数组写进本地存储。之后购物车页每次 `onShow` 调的是：

```js
async loadCart() { if (this.token) this.serverCart = await api.cart().catch(() => this.serverCart) }
```

只有登录了才去服务端刷新。游客车里的 `product` 从加购那一刻起就再也没更新过。

登录用户的购物车不一样，服务端每次返回时都按 id 重新查商品：

```js
const cartView = uid => cartOf(uid).map(i => ({ ...i, product: findP(i.productId) })).filter(i => i.product)
```

我在后台把 1 号商品从 2999 改成 2599，同时设成下架，然后看两边：

```text
登录用户 GET /api/cart  => [["1|a", onSale=false, price=2599]]
游客本地 guestCart      => 还是加购时的 price=2999，也看不出已下架
```

游客看到的是旧价格，合计、满减提示也都按旧价格算。等登录后合并到服务端，价格才"跳"成新的。

**改法：本地只存"指针"，不存数据。** 游客车只保留 `{ key, productId, spec, qty, checked }`，商品信息在购物车页 `onShow` 时按 id 重新拉一次。项目里目前只有单个商品的接口，商品多了建议加一个按 id 批量查询的接口，一次请求拿回来。拿回来发现商品没了或下架了，就在页面上标成"已失效"，不参与勾选和合计。

## 问题 2：登录时合并游客车，失败了怎么办

登录成功后，把游客车合并到服务端：

```js
async login(phone, code) {
  const r = await api.login(phone, code)
  this.token = r.token; this.user = r.user
  uni.setStorageSync('token', r.token); uni.setStorageSync('user', r.user)
  if (this.guestCart.length) {
    this.serverCart = await api.cartMerge(this.guestCart.map(({ productId, spec, qty, checked }) => ({ productId, spec, qty, checked })))
    this.guestCart = []; this.persist()
  } else await this.loadCart()
}
```

服务端的合并就是逐条调用"加入购物车"，同 key 的数量相加。所以游客车里有 2 件、账号里原来有 3 件，合并后是 5 件。有的商城取较大值，有的相加，这是产品选择，不算 bug，但要想清楚。

真正要注意的是顺序：**token 先写进去了，合并请求才发出去。** 如果合并这一步网络失败，`login()` 抛异常，用户看到的是"网络开小差了"，停在登录页上，但 token 已经存好了，其实已经是登录状态。游客车没被清空，可 getter 已经切到 `serverCart`，这些商品在界面上"消失"了，直到退出登录才重新出现。

改法有两种：要么合并失败时不清空 `guestCart`，在下一次 `loadCart` 时发现本地还有游客车就再合并一次；要么把合并放进登录接口，让服务端在一个请求里完成登录和合并。练手项目用前一种就够了。

## 问题 3：价格是后端算的，可数量是前端说了算

这是这次最严重的问题。先说做对的部分：下单接口没有用前端传来的价格，而是按商品 id 重新查价：

```js
const lines = items.map(i => {
  const p = findP(i.productId)
  return p && { productId: p.id, name: p.name, image: p.images[0], price: p.price, spec: i.spec, qty: Number(i.qty) }
}).filter(Boolean)
const goods = lines.reduce((t, i) => t + i.price * i.qty, 0)
const discount = goods >= 300 ? 50 : 0
```

但 `qty: Number(i.qty)` 没有任何校验。前端的数量步进器最小是 1，可接口不在乎前端长什么样。直接用 curl 下单：

```bash
curl -s -H 'Content-Type: application/json' -H "Authorization: Bearer $T" \
  -d '{"addressId":1001,"items":[{"productId":1,"spec":"a","qty":2},{"productId":2,"spec":"b","qty":-7}]}' \
  http://localhost:3000/api/orders
```

返回的订单：

```text
items:  [[1, 2999, 2], [2, 399, -7]]
goods:  3205   discount: 50   total: 3155
```

两台 2999 的手机，加上负 7 件 399 的商品，总价从 5948 变成 3155，满减照样生效。再试小数：

```text
qty: 0.01（单价 39.9）  =>  goods: 0.399   total: 0.4
```

一个 4 毛钱的订单。演示项目里支付是模拟的，没有真实损失，但如果有人照着这套结构接真实支付，这就是一个直接的资金漏洞。

购物车接口也一样：`POST /api/cart` 传 `qty: -5` 会存进去一个数量为 -5 的行；合并接口传 `qty: "abc"`，`Number("abc")` 是 `NaN`，写进 JSON 文件后变成 `null`。只有修改数量的 `PUT` 接口用了 `Math.max(1, Number(qty))`，可 `Math.max(1, NaN)` 结果还是 `NaN`。

另外两个同类问题：

- **下架商品照样能下单。** 商品列表接口过滤了 `onSale`，但下单和购物车都用的是不看上下架的 `findP`。上面那个下架的 1 号商品，下单返回 `price: 2599, total: 2549`，成功了。
- **规格字符串不校验。** `spec` 是什么后端都收，购物车里可以出现商品根本没有的规格。（这条我这次没改，后面说。）

修复：数量只接受 1～999 的整数，商品必须存在且在售，不符合就直接拒绝，而不是悄悄修正：

```js
const toQty = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null }
const buyable = id => { const p = findP(id); return p && p.onSale !== false ? p : null }

// 下单
const lines = []
for (const i of items) {
  const p = buyable(i.productId), qty = toQty(i.qty)
  if (!p) return fail(res, '有商品已下架，请返回购物车查看')
  if (!qty) return fail(res, '商品数量不正确')
  lines.push({ productId: p.id, name: p.name, image: p.images[0], price: p.price, spec: i.spec, qty })
}
```

加购、合并、改数量三个接口也换成 `toQty` 和 `buyable`。改完再跑同样的请求：

```text
qty: -7            => 商品数量不正确
qty: 0.01          => 商品数量不正确
POST /cart qty:-5  => 商品已下架或数量不正确
merge [abc, 2, 3]  => [["3|x", 5]]   非法那条被丢弃
PUT qty:"x"        => 数量不正确
```

`Number.isInteger` 很合适：它对字符串 `"3"` 返回 false，所以先 `Number(v)` 再判断，`"3"` 能通过，`"3.5"`、`"abc"`、`-1` 都过不去。

## 问题 4：金额精度和"同一条规则写了三遍"

`39.9 * 3` 在 JS 里是 `119.69999999999999`。项目里展示金额都过一遍 `money = n => Number(n || 0).toFixed(2)`，所以页面上是 `119.70`，看不出问题；订单的 `total` 也做了 `Math.round(x * 100) / 100`。但 `goodsAmount` 没处理，订单里存的就是 `119.69999999999999`，以后做对账、导出、退款计算时会冒出来。

修法是在服务端按"分"计算：

```js
const goods = lines.reduce((t, i) => t + Math.round(i.price * 100) * i.qty, 0) / 100
```

单价先转成整数分再乘数量，整数运算没有误差，最后除一次 100。改完同样三件 39.9 的订单，`goodsAmount` 是 `119.7`。

另一个问题是满减规则。"满 300 减 50"在项目里写了三遍：购物车页一遍，确认订单页一遍，后端下单接口一遍：

```js
// pages/cart/cart.vue
const discount = computed(() => (store.checkedTotal >= 300 ? 50 : 0))
// pages/order/confirm.vue
const discount = computed(() => (goods.value >= 300 ? 50 : 0))
// server/index.js
const discount = goods >= 300 ? 50 : 0
```

再加上问题 1 的价格快照，确认页显示的"实付"和收银台显示的 `order.total`（后端算的）可能不是同一个数。以后改规则，漏改一处就对不上。比较稳的做法是后端提供一个"试算"接口，确认订单页把商品和数量传过去，拿回商品金额、优惠、实付，前端只负责显示。购物车页的"再凑多少"提示可以保留前端估算，但确认页一定要以后端为准。

## 问题 5：401 之后，Pinia 还以为自己登录着

最后一个是前端的。请求封装里，遇到 401 会清掉 token：

```js
// api/request.js
if (r.statusCode === 401) { uni.removeStorageSync('token') }
uni.showToast({ title: msg, icon: 'none' }); reject(new Error(msg))
```

但清的只是本地存储，Pinia 里的 `store.token` 还在。于是 `loggedIn` 还是 true，`requireLogin()` 直接放行，购物车 getter 还在用 `serverCart`。token 过期（项目里设的 30 天）或者账号被后台禁用后，用户每次操作都只看到一个"请先登录"的提示，不会被带去登录页，直到重启应用，store 从存储里重新读到空 token 才恢复。

request.js 不能直接 import store（store 本身 import 了 api，会循环引用），可以用 uni 的全局事件解耦：

```js
// api/request.js
if (r.statusCode === 401) uni.$emit('auth:expired')

// App.vue
import { onLaunch } from '@dcloudio/uni-app'
import { useShopStore } from './store'
onLaunch(() => {
  const store = useShopStore()
  store.loadCart()   // 原有逻辑
  uni.$on('auth:expired', () => {
    if (!store.token) return
    store.logout()
    uni.navigateTo({ url: '/pages/login/login' })
  })
})
```

`logout()` 里本来就会同时清 store 和存储，状态只从一个地方改，就不会再出现两边不一致。这段我按代码逻辑写的，没有在真机上跑过 token 过期的场景。

## 自查清单

- [ ] 本地购物车只存 id、规格、数量、勾选状态，商品信息每次展示时重新拉
- [ ] 登录合并失败时不丢游客车，有重试的时机
- [ ] 下单、加购、合并、改数量四个接口都校验数量是正整数且有上限
- [ ] 下单时检查商品是否在售，规格是否属于该商品
- [ ] 金额在服务端按分计算，入库前就是精确值
- [ ] 优惠规则只在后端算一份，确认页以后端试算结果为准
- [ ] 401 时同时清 store 和存储，并引导重新登录

还没做的：规格校验（需要按商品的 `specs` 配置核对 `spec` 字符串）、库存（规格弹窗里的库存目前是写死的展示数字，下单也不扣库存）。这两块要动数据结构，后面单独写。

上面问题 3、4 的后端修复我整理成了补丁，本地验证过，还没合进仓库；问题 1、2、5 是改进方向。仓库里目前还是修改前的代码。

仓库：https://github.com/MsNan/taohaowu-shop
