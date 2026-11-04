---
title: "Express 登录失败限流的 6 个坑：TRUST_PROXY 配错就形同虚设，账号不存在时快 40 倍"
date: 2026-11-04
category: 后端
tags: [Node.js, Express, 安全, JavaScript]
description: "Express 5 + sql.js 登录限流复现：TRUST_PROXY 配错可伪造 IP 绕过、共用出口 IP 误锁、账号不存在不跑 bcrypt 可计时枚举、固定窗口边界多试、内存表无上限全表扫描、参数非字符串 500。"
---

前几天给自己的毕设脚手架 bishe-kit 加了登录失败限流：同一个 IP 对同一个账号连续输错 5 次，锁 15 分钟；同一个 IP 不管换多少账号，累计错 20 次也锁。逻辑不复杂，一个 `Map` 存计数，单元测试也都绿了。

写完过了几天回头看，总觉得单元测试测的都是"计数器本身对不对"，没测"计数器拿到的 IP 和账号对不对"。于是写了个脚本，用 supertest 直接打登录接口，换着请求头、换着参数去试。结果翻出来 6 个问题，有两个是配置一改就让限流完全失效的那种。

下面的数字都是我在本机跑出来的：Node 24.22.1，Express 5.3.0，bcryptjs 3.0.3，sql.js 1.15.0，数据库用 `:memory:`，演示账号是仓库自带的 seed 数据。

## 原来的实现

限流器本身（删掉了注释）：

```js
export function createLoginLimiter({ maxFails = 5, maxIpFails = 20, windowMs = 15 * 60_000, lockMs = 15 * 60_000, now = Date.now } = {}) {
  const map = new Map() // key -> { count, first, lockedUntil }
  const keys = (ip, username) => [`u|${ip}|${String(username).toLowerCase()}`, `ip|${ip}`]

  function prune() {
    const t = now()
    for (const [k, v] of map) if (v.lockedUntil <= t && t - v.first > windowMs) map.delete(k)
  }
  function bump(key, limit) {
    if (!limit) return
    const t = now()
    let v = map.get(key)
    if (!v || (v.lockedUntil ? v.lockedUntil <= t : t - v.first > windowMs)) v = { count: 0, first: t, lockedUntil: 0 }
    v.count += 1
    if (v.count >= limit) v.lockedUntil = t + lockMs
    map.set(key, v)
  }
  return {
    retryAfter(ip, username) { /* 取两个 key 里最晚的 lockedUntil */ },
    fail(ip, username) {
      const [u, i] = keys(ip, username)
      bump(u, maxFails); bump(i, maxIpFails)
      if (map.size > 10_000) prune()
    },
    success(ip, username) { map.delete(keys(ip, username)[0]) },
  }
}
```

登录路由里这样用：

```js
const { username, password } = req.body || {}
if (!username || !password) throw new HttpError(400, '请输入账号和密码')
const wait = limiter.retryAfter(req.ip, username)
if (wait) { res.set('Retry-After', String(wait)); throw new HttpError(429, '...') }
const u = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username)
if (!u || !bcrypt.compareSync(password, u.password)) {
  limiter.fail(req.ip, username)
  throw new HttpError(400, '账号或密码错误')
}
```

IP 用的是 `req.ip`，部署在 Nginx 后面时靠环境变量 `TRUST_PROXY=1` 打开 Express 的 `trust proxy`。

## 1. 没有反向代理却设了 TRUST_PROXY：限流形同虚设

`trust proxy` 打开以后，`req.ip` 不再是 TCP 连接的对端地址，而是从 `X-Forwarded-For` 里取。这个头谁都能写。

脚本里设 `TRUST_PROXY=1`，客户端直连（不经过任何代理），每次请求自己带一个不同的 `X-Forwarded-For`：

```
[1] 直连 + 每次换 XFF，30 次错密码状态码: { '400': 30 }  之后正确密码: 200
[1b] 不带 XFF，连续 7 次错密码: 400,400,400,400,400,429,429
```

30 次错密码一次都没被锁，第 31 次用正确密码照样登录成功。不带这个头的时候，第 6 次就是 429，说明限流本身没问题，问题出在"IP 是谁说了算"。

那放在 Nginx 后面就安全吗？取决于两件事。

Nginx 一般这样配：

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

`$proxy_add_x_forwarded_for` 是在客户端带来的值后面追加真实对端 IP，所以后端看到的是 `伪造的, 真实IP`。`trust proxy` 设成数字 `1` 时，Express 从右往左数，跳过 1 层可信代理，取到的是最右边那个，也就是 Nginx 追加的真实 IP：

```
[2] TRUST_PROXY=1，XFF="伪造, 198.51.100.7"，连续 7 次: 400,400,400,400,400,429,429
```

但如果设成 `TRUST_PROXY=true`（这个项目的 config 也支持），Express 会信任所有代理，取最左边那个，也就是客户端随便写的值：

```
[2] TRUST_PROXY=true，同样的请求连续 7 次: 400,400,400,400,400,400,400
```

结论很简单：

- 没有代理就别设；
- 有一层 Nginx 设 `1`，CDN + Nginx 两层设 `2`，别图省事写 `true`；
- Nginx 那边用 `$proxy_add_x_forwarded_for` 或者直接 `$remote_addr`，不要把客户端的头原样透传。

这一条代码没法替你判断，只能写进文档。我在补丁里把 README 的 `TRUST_PROXY` 说明补全了。

## 2. 校园网里一个人试错，全班登不上

反过来的情况：很多人共用一个出口 IP。毕设项目答辩、上课演示都在学校，校园网、机房基本都是 NAT 出去的；或者前面有 CDN 但 `trust proxy` 层数少设了一层，后端看到的全是 CDN 节点 IP。

模拟同一个出口 IP 上 20 个同学各输错一次（账号都不一样），然后管理员用正确密码登录：

```
[3] 同一出口 IP 上 20 个不同账号各错 1 次，状态码: 400；随后 admin 正确密码: 429 Retry-After=900
```

20 个人每人只错了一次，第 21 个人密码完全正确，被锁 15 分钟。

这是"按 IP 防撞库"本身的代价，不算 bug：撞库的特征恰好就是"同一来源、很多账号、每个只试一两次"，和"一个教室里每人手滑一次"在服务端看来一模一样。能做的是：

- 共用出口的场景把 `LOGIN_MAX_IP_FAILS` 调大，或者设成 `0` 关掉 IP 级的锁，只保留"IP+账号"那一级；
- 更好的做法是 IP 级别超阈值后不直接锁，而是要求验证码，这个脚手架里没做；
- 千万不要为了"防撞库"改成只按账号锁，那样任何人都能故意输错把别人的号锁住。原实现只按"IP+账号"锁是对的。

## 3. 账号不存在时快了 40 倍，可以靠响应时间枚举账号

原来的判断是 `!u || !bcrypt.compareSync(...)`，账号不存在时短路，不算 bcrypt。两种情况返回的提示都是"账号或密码错误"，看起来没泄露信息，但耗时差很多。每种各请求 30 次取平均（每次换一个 IP，避免被锁）：

```
[4] 平均耗时（30 次）：不存在的账号 1.7ms，存在的账号错密码 69.0ms
```

另一次运行是 1.4ms 和 68.0ms。差出来的这六十多毫秒就是一次 cost 10 的 bcrypt 比对。本地回环上差 40 倍，放到公网上有网络抖动，但几十毫秒的差距多请求几次取平均还是很容易分出来的。

修法是账号不存在时也和一个固定的假哈希比一次：

```js
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10)
// ...
const ok = bcrypt.compareSync(password, u ? u.password : DUMMY_HASH)
if (!u || !ok) { /* 计失败 */ }
```

补丁后同样的测量是 70.2ms 和 70.4ms。

顺带说一句，注册接口会提示"用户名已存在"，所以这个系统本来就能枚举用户名。登录接口补上它是为了不多开一个口子，要彻底防枚举得连注册的提示一起改，这里没动。

## 4. 卡在窗口边界，20 秒里能试 7 次

原实现是固定窗口：从第一次失败开始计时，`t - first > windowMs` 就清零重来。所以如果第一次失败发生在很早以前，窗口快到期时连错几次，窗口一过又能再错几次。用假时钟模拟（窗口和锁定都是 15 分钟）：

```
第 0 分钟错 1 次，第 14:50 错 3 次，第 15:10 错 4 次，一共 8 次
[5] retryAfter: 0 0
```

14:50 到 15:10 这 20 秒里错了 7 次，没锁。5 次的上限实际变成了"接近 2×5−1 次"。

改成"距**上一次**失败超过窗口才清零"，也就是记录 `last` 而不是 `first`。这样只要两次失败的间隔都不到 15 分钟，就一直累计，"连续输错"这几个字才名副其实。补丁后同样的序列 `retryAfter` 是 900 秒。原有的"超过窗口的失败不累计"测试（失败 2 次，过 61 秒，再失败 1 次，不锁）照样通过，因为那里间隔超过了窗口。

## 5. 内存表没有上限，超过 1 万条以后每次失败都全表扫描

原来的清理策略是 `map.size > 10_000` 时调一次 `prune()`。问题是刚写进去的记录都没过期，`prune()` 什么也删不掉，而下一次 `fail()` 时 size 依旧大于 1 万，于是**每一次**失败都要把整张表遍历一遍。

单独对限流器做压测，每次用不同的 IP、不同的账号调 `fail()`（每次写两个 key）：

```
前 4000 次        平均   1.8µs/次 (size=8000)
4000→10000 次     平均 114.8µs/次 (size=20000)
10000→50000 次    平均 562.8µs/次 (size=100000)
再 1000 次        平均 833.2µs/次 (size=102000)
堆增长约 27.2MB
```

每次失败的开销随表大小线性上涨，表本身也没有上限。正常情况下一个 IP 最多产生 20 个账号 key 就被锁住了，表涨不到这么大；但只要碰上第 1 条（`TRUST_PROXY` 配错、IP 随便伪造），或者攻击者手里有大量 IPv6 地址，这张表就能一直涨下去。何况账号不存在的请求不走 bcrypt，一次只要一两毫秒，写起来很快。

补丁做了两件事：清理最多每秒做一次；清理完还超过上限（默认 5 万条）就按写入顺序淘汰最早的未锁定记录，还不够再淘汰最早的记录。同样的压测：

```
前 4000 次 1.0µs，4000→10000 次 2.1µs，10000→50000 次 12.0µs，再 1000 次 39.7µs (size=50000)
堆增长约 22.5MB
```

淘汰记录有个代价：被淘汰的计数等于清零。所以这个上限只是兜底，防的是内存失控；真正挡住伪造 IP 的还是第 1 条的正确配置。仓库 README 里原本就写了"多实例部署请换成 Redis"，用 Redis 时给 key 设 TTL，这个问题自然没有了。

## 6. 账号传个对象，接口返回 500

`if (!username || !password)` 只判断了真假，没判断类型。JSON 请求体里传别的类型：

```
username=["admin"]        → 400 账号或密码错误
username={"a":1}          → 500 服务器错误（sql.js: Wrong API use : tried to bind a value of an unknown type）
password=["admin123"]     → 500 服务器错误（bcryptjs: Illegal arguments: object, string）
```

500 不是安全问题，错误处理中间件兜住了，进程没挂，但会在日志里留一堆堆栈；而且这两种请求不会被计入失败次数。另外 `String(["admin"])` 正好等于 `"admin"`，数组和字符串会落到同一个限流 key 上，这种隐式转换最好别依赖。补丁里直接要求两个字段都是非空字符串，否则 400，三种情况现在都是 400。

## 补丁和测试

改动在 4 个文件里：`server/src/login-limiter.js`（`last` 代替 `first`、清理节流、记录上限）、`server/src/routes/auth.js`（类型校验、假哈希）、两个测试文件，再加上 README 里 `TRUST_PROXY`、`LOGIN_MAX_IP_FAILS` 的说明。新增两个用例：窗口边界上的连续失败会锁、记录数不超过上限；登录参数不是字符串返回 400。原来 13 个测试，补丁后 15 个，全部通过。

几条可以直接搬走的经验：

1. 限流按什么 key 计数，先确认 key 本身可信。`req.ip` 可不可信取决于 `trust proxy` 的配置，而这个配置要和实际部署的代理层数一致。
2. IP 级别的锁一定会误伤共用出口的人，阈值要按部署场景调，最好用验证码代替直接锁。
3. 登录失败的两种分支（账号不存在、密码错）不只返回的文字要一样，耗时也要一样。
4. "连续 N 次"用距上次失败的间隔来判断，不要用固定窗口。
5. 内存里的计数表要有上限，清理不能每次请求都全表扫。

补丁目前只在我的本地副本里跑过，仓库里还是原来的代码。

仓库：https://github.com/MsNan/bishe-kit
