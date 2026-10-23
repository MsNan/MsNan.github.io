---
title: "后台管理员把自己锁在门外：RBAC 里「自己的权限只能由别人来减」"
date: 2026-10-23
category: 后端
tags: [Node.js, Express, RBAC, 安全]
description: "实测 Express+SQLite 后台：唯一超管把自己降级后系统再无超管，改自己角色也会当场 403，重跑种子救不回。给出后端校验、前端置灰、测试与恢复脚本。"
---

之前在 bishe-kit（Vue3 后台 + Express + SQLite 的脚手架）里做过一轮"防越权"：非超管不能分配 `*`、不能分配自己没有的权限、不能动比自己权限高的账号。那一轮防的都是"往上够"。

这次回头看，发现另一个方向完全没管：**往下减**。管理员可以把自己的权限减掉，减完立刻生效，然后就进不去了。最极端的情况是唯一的超级管理员把自己改成了普通角色，整个系统一个超管都不剩。

这篇把复现、原因、修法和测试记下来。环境：Node 20.19.2，Express 5，数据库是 sql.js（WebAssembly 版 SQLite），测试用 `node:test` + supertest。下面的输出都是我实际跑出来的。

## 三个能把自己锁在门外的操作

为了复现，写了一个小的公共模块，用内存数据库起应用、灌演示数据（admin 是超管，另外有 editor、viewer 两个内置角色）：

```js
// repro/common.mjs
process.env.DB_PATH ??= ':memory:'
const request = (await import('supertest')).default
const { createApp } = await import('../src/app.js')
const { seed } = await import('../src/seed.js')
export const app = createApp(); seed()
export const login = async (u, p) => (await request(app).post('/api/auth/admin/login').send({ username: u, password: p })).body.data?.token
export const as = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  put: (u, b) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b),
  del: (u) => request(app).delete(u).set('Authorization', `Bearer ${t}`),
})
export const S = '/api/admin/system'
```

**场景 1：唯一的超管把自己改成"只读访客"。**

```js
const root = as(await login('admin', 'admin123'))
const roles = (await root.get(`${S}/roles`)).body.data
const sa = roles.find((r) => r.code === 'super_admin'), viewer = roles.find((r) => r.code === 'viewer')
const me = (await root.get(`${S}/users?size=100`)).body.data.list.find((u) => u.username === 'admin')
console.log('1. 超管把自己降级 ->', (await root.put(`${S}/users/${me.id}`, { role_id: viewer.id })).status)
// 重新登录后统计还剩几个超管，再试着建一个角色
```

```
1. 超管把自己降级 -> 200
   剩余超管数量 -> 0
   admin 再建角色 -> 403
```

**场景 2：系统管理员把自己所在的角色缩小。** 超管先建一个"系统管理员"角色（`user:read/write`、`role:read/write`），给 ops 和 ops2 两个账号用。然后 ops 编辑这个角色，只留 `user:read`：

```js
console.log('2. 缩小自己所在的角色 ->', (await ops.put(`${S}/roles/${sys}`, { perms: ['user:read'] })).status)
console.log('   ops  再看角色列表 ->', (await ops.get(`${S}/roles`)).status)
console.log('   ops2 再看角色列表 ->', (await ops2.get(`${S}/roles`)).status)
```

```
2. 缩小自己所在的角色 -> 200
   ops  再看角色列表 -> 403
   ops2 再看角色列表 -> 403
```

这个比场景 1 更隐蔽：改的是角色，不是账号，同一角色的 ops2 什么都没做也跟着被锁了。

**场景 3：系统管理员把自己的账号换成低权限角色。**

```
3. 把自己改成低权限角色 -> 200
   ops 再改用户 -> 403
```

三个请求都返回 200。原有的防越权检查都通过了，因为它们只检查"新权限有没有超过你"，而这三个操作都是在减。

## 为什么改完立刻生效

bishe-kit 的 JWT 里只放了用户 id 和类型，权限是每次请求时从数据库现查的：

```js
// server/src/auth.js
export const sign = (u) => jwt.sign({ uid: u.id, type: u.type }, config.jwtSecret, { expiresIn: config.jwtExpires })

export function parseToken(req, _res, next) {
  // ...验证 token 后
  const u = getDb().prepare('SELECT id, username, nickname, avatar, phone, type, role_id, status FROM users WHERE id = ?').get(p.uid)
  if (u && u.status === 1) { req.user = u; req.user.perms = permsOf(u) }
  next()
}
```

这本来是个优点：收回某人的权限不用等 token 过期，下一个请求就生效。但同一个特性也意味着，手滑把自己的权限减了，下一个请求就是 403，没有缓冲期。

## 锁死之后怎么救

第一反应是"重新跑一遍 seed"。试了一下，没用：

```bash
DB_PATH=/tmp/bkdb/app.db node repro/demote-file.mjs   # 用文件数据库复现场景 1
DB_PATH=/tmp/bkdb/app.db npm run seed --silent
# 然后查一下几个管理端账号的角色
```

```
降级 -> 200
✅ 演示数据已就绪：管理端 admin/admin123、editor/editor123、viewer/viewer123；用户端 test/test123
[
  { username: 'admin', code: 'viewer' },
  { username: 'editor', code: 'editor' },
  { username: 'viewer', code: 'viewer' }
]
```

seed 里插用户用的是 `INSERT OR IGNORE`，账号已经存在就跳过，不会把角色改回去。能救的办法只剩直接改库，我写了个小脚本：

```js
// restore-admin.mjs，放在 server 目录下
// 用法：node restore-admin.mjs admin   （先停掉服务）
import { getDb, closeDb } from './src/db.js'
const name = process.argv[2]
const db = getDb()
const sa = db.prepare("SELECT id FROM roles WHERE code = 'super_admin'").get().id
const r = db.prepare("UPDATE users SET role_id = ?, status = 1 WHERE username = ? AND type = 'admin'").run(sa, name)
console.log(r.changes ? `已把 ${name} 恢复为超级管理员` : `没找到管理端账号 ${name}`)
closeDb()
```

```
已把 admin 恢复为超级管理员
{ username: 'admin', code: 'super_admin' }
```

"先停掉服务"这一条要注意：sql.js 是把整个数据库文件读进内存操作的，`db.js` 里每次写入后、以及进程收到 SIGINT/SIGTERM 时，都会把内存里的整份数据导出覆盖回文件。服务开着的时候用脚本改文件，服务下次写入或退出时会把你的修改盖掉。

能救，但要有服务器权限、要停服务、要知道表结构。部署到别人那里的系统，这就是一次工单。所以还是在接口上拦住比较好。

## 规则：自己的权限只能由别人来减

我最后定的规则很简单：**一个操作如果会让当前操作者自己失去任何一条权限，就拒绝**，提示让其他管理员来做。

实现上不需要区分是哪种操作，只要算出"操作之后我的权限是什么"，和现在比较：

```js
// server/src/routes/system.js
// —— 防自锁：自己的权限只能由别人来减 ——
/** 把「当前操作者」的权限换成 nextPerms 后，会丢掉哪些权限 */
const lostPerms = (user, nextPerms) => user.perms.filter((p) => !nextPerms.includes(p))
function assertNotShrinkSelf(user, nextPerms) {
  const lost = lostPerms(user, nextPerms)
  if (lost.length) throw new HttpError(400, '不能减少自己的权限（会失去：' + lost.join(',') + '），请让其他管理员操作')
}
```

然后在两个会改到"我的权限"的地方调用：

```diff
 r.put('/users/:id', requirePerm('user:write'), (req, res) => {
   ...
   assertCanAssignRole(req.user, role_id)
+  if (Number(req.params.id) === req.user.id && role_id != null) assertNotShrinkSelf(req.user, rolePerms(role_id))
   db().prepare('UPDATE users SET ...').run(...)

 r.put('/roles/:id', requirePerm('role:write'), (req, res) => {
   ...
-  if (perms !== undefined) { checkPermsShape(perms); assertCanGrant(req.user, perms) }
+  if (perms !== undefined) {
+    checkPermsShape(perms); assertCanGrant(req.user, perms)
+    if (role.id === req.user.role_id) assertNotShrinkSelf(req.user, perms)
+  }
```

为什么不直接写成"不能修改自己的角色"：

- 改自己角色的名称、或者换到一个权限完全相同的角色，没有任何风险，没必要拦。
- 提示里能直接告诉对方"会失去哪几条"，比一句"不允许"好排查。
- 编辑自己所在的角色时，原有的 `assertCanGrant` 已经保证加不了自己没有的权限，所以对自己所在角色的任何权限变更，要么是原样保存，要么一定是在减。按"会不会减"来判断，正好覆盖。

用之前的复现脚本再跑一遍，同时看一下几个相关的操作：

```
超管降级自己 -> 400 不能减少自己的权限（会失去：*），请让其他管理员操作
超管禁用自己 -> 400 不能禁用自己
超管删除自己 -> 400 不能删除自己
ops 缩小自己所在角色 -> 400 不能减少自己的权限（会失去：role:read,role:write,user:write），请让其他管理员操作
```

## "至少保留一个超管"还要不要单独数

很多系统会加一条"最后一个超级管理员不能被降级/禁用/删除"。我先看了一下现在的代码里，超管数量还有哪些路径可能变成 0：

- 删除、禁用：不能删自己、不能禁用自己，原来就有；
- 非超管动超管账号：`assertCanManageUser` 会拒绝"操作权限比自己高的账号"；
- 改 `super_admin` 角色本身：原来就禁止修改；
- 超管 A 降级、禁用、删除超管 B：A 自己还是超管，数量不会到 0。

剩下的唯一路径就是场景 1，超管降级自己，现在已经被上面的规则拦住了。所以在目前的接口下，单独的计数检查不会被触发，我就没加。

但如果你要加（比如以后有批量导入、批量改角色），有个细节：**不要按角色编码数超管，要按 `*` 权限数**。超管可以新建一个带 `*` 的角色，再把自己换过去，这个操作不会损失任何权限，上面的规则也放行：

```
超管建一个带 * 的角色 -> 200
超管把自己换到这个角色 -> 200
```

这时候按 `super_admin` 角色数和按 `*` 权限数，结果就不一样了：

```js
const countSupers = () => getDb().prepare(`
  SELECT COUNT(DISTINCT u.id) c FROM users u
  JOIN role_permissions rp ON rp.role_id = u.role_id
  WHERE rp.perm_code = '*' AND u.status = 1 AND u.type = 'admin'`).get().c
```

```
初始： 1
admin 换到 root2 后：按角色编码数 = 0 ，按 * 权限数 = 1
```

按角色编码数会误判成"没有超管了"。

另外，这里的检查和写入是在同一个同步的 Express 处理函数里完成的（sql.js 的 API 是同步的，单进程），中间不会插进别的请求，所以不存在两个超管同时互相降级的竞态。如果换成 MySQL 这种异步驱动、或者多进程部署，"先检查再写入"就要放进事务里加锁，否则检查结果可能在写入前就过期了。

## 测试

在原来的接口测试文件里加了一组，覆盖"不能减自己"和"不该误拦的情况"：

```js
test('防自锁：自己的权限只能由别人来减', async () => {
  const roles = (await request(app).get('/api/admin/system/roles').set(auth(admin))).body.data
  const sa = roles.find((r) => r.code === 'super_admin'), viewerRole = roles.find((r) => r.code === 'viewer')
  const S = '/api/admin/system'
  const users = (await request(app).get(`${S}/users?size=100`).set(auth(admin))).body.data.list
  const root = users.find((u) => u.username === 'admin')
  // 唯一的超管不能把自己降级
  const r1 = await request(app).put(`${S}/users/${root.id}`).set(auth(admin)).send({ role_id: viewerRole.id })
  assert.equal(r1.status, 400); assert.match(r1.body.msg, /会失去：\*/)
  // 改成同一个角色、只改昵称都不受影响
  assert.equal((await request(app).put(`${S}/users/${root.id}`).set(auth(admin)).send({ role_id: sa.id, nickname: '超管' })).body.code, 0)

  const sys = (await request(app).post(`${S}/roles`).set(auth(admin)).send({ code: 'sys2', name: '系统管理员2', perms: ['user:read', 'user:write', 'role:read', 'role:write'] })).body.data.id
  const low = (await request(app).post(`${S}/roles`).set(auth(admin)).send({ code: 'low2', name: '用户查看2', perms: ['user:read'] })).body.data.id
  await request(app).post(`${S}/users`).set(auth(admin)).send({ username: 'ops2', password: '123456', type: 'admin', role_id: sys })
  const ops = await login('ops2', '123456')
  const me = (await request(app).get(`${S}/users?size=100`).set(auth(ops))).body.data.list.find((u) => u.username === 'ops2')
  // 不能缩小自己所在的角色，不能把自己换成低权限角色
  assert.equal((await request(app).put(`${S}/roles/${sys}`).set(auth(ops)).send({ perms: ['user:read'] })).status, 400)
  assert.equal((await request(app).put(`${S}/users/${me.id}`).set(auth(ops)).send({ role_id: low })).status, 400)
  // 改自己角色的名称、权限不变（顺序不同）时可以
  assert.equal((await request(app).put(`${S}/roles/${sys}`).set(auth(ops)).send({ name: '运维', perms: ['role:write', 'role:read', 'user:write', 'user:read'] })).body.code, 0)
  // 别人（超管）来减是允许的
  assert.equal((await request(app).put(`${S}/roles/${sys}`).set(auth(admin)).send({ perms: ['user:read'] })).body.code, 0)
  assert.equal((await request(app).get(`${S}/roles`).set(auth(ops))).status, 403)
})
```

修改前跑，新加的这组失败（第一个断言就挂了）：

```
not ok 6 - 防自锁：自己的权限只能由别人来减
  expected: 400
  actual: 200
# pass 5
# fail 1
```

修改后：

```
ok 1 - 认证：登录、错误密码、双端隔离、注册、me
ok 2 - RBAC：角色权限控制
ok 3 - CRUD：增删改查、分页、搜索、校验、公开接口
ok 4 - 上传：需要登录、类型和大小限制
ok 5 - 防越权：只能分配/管理不超过自己的权限
ok 6 - 防自锁：自己的权限只能由别人来减
# tests 6
# pass 6
# fail 0
```

最后一个断言我特意留着：规则拦的是"自己减自己"，不是"不能减"。超管来减 ops 的角色照常生效，ops 随即 403。

## 前端顺手改两处

后端拦住才是真的拦住，前端只是让人少点几次报错。Element Plus 里改了两行：

```html
<!-- Roles.vue：自己没有的权限，勾选框置灰 -->
<el-checkbox v-for="p in perms.filter((x) => x.code !== '*')" :key="p.code" :value="p.code"
  :disabled="!store.can(p.code)">{{ p.name }}</el-checkbox>

<!-- Users.vue：编辑自己时角色下拉禁用；权限超过自己的角色不可选 -->
<el-select v-model="form.role_id" :disabled="form.id === store.user?.id">
  <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id"
    :disabled="!r.perms.every(store.can)" />
</el-select>
```

`store.can` 本身就处理了 `*`（有 `*` 的人 `can` 任何权限都返回 true），所以超管看到的还是全部可选。这两处我只确认了 `vite build` 能通过，没有逐个点界面验证；就算前端漏了，请求到后端也会被上面的规则拒绝，提示文字会通过 axios 拦截器弹出来。

## 小结

1. 权限检查要两个方向都看：不能给出超过自己的（防越权），也不能减掉自己正在用的（防自锁）。
2. 判断"会不会减掉自己的权限"，比"禁止改自己的角色"更准：改名、换等价角色不受影响，提示里还能列出会失去哪几条。
3. 改的是角色时，同角色的其他人会一起受影响，这比改单个账号更容易被忽略。
4. 如果要数"还剩几个超管"，按 `*` 权限数，不要按角色编码数。
5. 权限每次请求现查的设计，撤权立刻生效，误操作也立刻生效；提前想好锁死后的恢复办法（seed 不一定能救）。

上面的修改我在本地副本里跑通了测试，仓库里目前还是修改前的代码。

完整代码在 https://github.com/MsNan/bishe-kit
