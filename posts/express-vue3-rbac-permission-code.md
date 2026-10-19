---
title: "后台权限别再写 if (role === 'admin')：SQLite + Express + Vue3 的权限码 RBAC 实践"
date: 2026-10-19
category: 后端
tags: [Node.js, Express, Vue3, RBAC, SQLite]
description: "SQLite 三张表存角色和权限码，Express 中间件每次请求现查权限让改动立即生效，Vue3 菜单和按钮共用同一个 can 判断，以及几个容易踩的坑。"
---

之前给一个图书 + 公告的小后台写权限，第一版只有一个管理员，接口里写个 `if (user.role === 'admin')` 就完事了。后来需求加了两个角色：一个"内容编辑"，能改图书和公告，但不能动用户；一个"只读访客"，给老师看演示用，什么都能看、什么都不能改。

我顺着原来的思路往下写，很快就变成了 `if (role === 'admin' || role === 'editor')` 这种判断散落在十几个接口里，前端菜单和按钮还要再写一遍。再加一个"图书管理员"角色，就得把所有地方翻一遍。

后来我把它改成了按权限码判断：代码里只问"这个人有没有 `book:write`"，至于哪个角色有 `book:write`，交给数据库里的配置。这篇记录一下这套小型 RBAC 的实现，技术栈是 Express + SQLite 后端、Vue3 + Element Plus 后台。

## 思路：代码只认权限码，不认角色

RBAC 的核心就是在"用户"和"能做什么"之间加一层"角色"：

- 用户属于某个角色（这里一个用户一个角色，够用了）
- 角色拥有一组权限码，比如 `book:read`、`book:write`、`user:read`
- 接口、菜单、按钮只检查权限码

这样新增角色就是往表里插几行数据，不用改代码。权限码我统一用 `资源:动作` 的格式，动作只分 `read` 和 `write` 两种。分得更细（create / update / delete 各一个）当然也行，但对中小后台来说，勾权限的人会很烦，两档基本够用。

## 表结构：三张表加一个外键

```sql
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  builtin INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS permissions (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
  perm_code TEXT REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, perm_code)
);
-- users 表里加一列 role_id
-- role_id INTEGER REFERENCES roles(id)
```

几个细节：

- `permissions` 直接用 `code` 做主键，关联表里存的也是 `perm_code` 字符串而不是数字 id。查数据库的时候一眼就能看懂，调试方便很多。
- `role_permissions` 用联合主键，同一个角色不会重复插入同一个权限，配合 `INSERT OR IGNORE` 写初始化脚本时可以放心重复执行。
- `builtin` 标记内置角色，后面删除接口会用到。
- SQLite 默认不开外键约束，`ON DELETE CASCADE` 写了也不生效，每次打开连接都要执行一次 `PRAGMA foreign_keys = ON`。这一步很容易漏，漏了的话删掉角色，关联表里会留下一堆孤儿数据。

## 权限码从哪来

权限分两部分。一部分是系统固定的：

```js
const BASE_PERMS = [
  ['*', '全部权限'],
  ['user:read', '用户-查看'], ['user:write', '用户-编辑'],
  ['role:read', '角色-查看'], ['role:write', '角色-编辑'],
]
```

`*` 是给超级管理员的通配符，后面判断时单独处理。

另一部分跟业务模块走。我的后台里每个业务模块（图书、公告）都是一个 JSON 定义，比如：

```json
{
  "name": "book",
  "label": "图书",
  "fields": [
    { "name": "title", "label": "书名", "type": "string", "required": true, "search": true },
    { "name": "price", "label": "价格", "type": "number" }
  ]
}
```

服务启动时遍历这些定义，建表的同时把对应的两个权限码写进去：

```js
const perm = db.prepare('INSERT OR IGNORE INTO permissions (code, name) VALUES (?, ?)')
for (const e of entities) {
  // ...建表、补字段
  perm.run(`${e.name}:read`, `${e.label}-查看`)
  perm.run(`${e.name}:write`, `${e.label}-编辑`)
}
```

这样做的好处是，新加一个模块不需要手动去权限表里登记，重启之后在角色管理页面就能直接勾选"商品-查看""商品-编辑"。启动时的这些初始化操作我放在一个事务里，超级管理员角色和它的 `*` 权限也在这一步用 `INSERT OR IGNORE` 补上，保证任何时候至少有一个能登录进来管理的角色。

## Express 中间件：每次请求现查权限

鉴权分两步。第一步是全局的 `parseToken`，解析 token 后从数据库查出用户，再把他的权限码挂到 `req.user` 上：

```js
export function permsOf(user) {
  if (!user.role_id) return []
  return getDb()
    .prepare('SELECT perm_code FROM role_permissions WHERE role_id = ?')
    .all(user.role_id)
    .map((r) => r.perm_code)
}

export function parseToken(req, _res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (token) {
    try {
      const p = jwt.verify(token, config.jwtSecret)
      const u = getDb()
        .prepare('SELECT id, username, nickname, avatar, phone, type, role_id, status FROM users WHERE id = ?')
        .get(p.uid)
      if (u && u.status === 1) { req.user = u; req.user.perms = permsOf(u) }
    } catch { /* token 无效视为未登录 */ }
  }
  next()
}
```

第二步是按接口声明需要的权限：

```js
export const can = (user, perm) =>
  !!user && (user.perms.includes('*') || user.perms.includes(perm))

export const requirePerm = (perm) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, '请先登录'))
  if (req.user.type !== 'admin' || !can(req.user, perm)) {
    return next(new HttpError(403, `缺少权限：${perm}`))
  }
  next()
}
```

用起来就是在路由上声明：

```js
r.get('/', requirePerm(`${t}:read`), listHandler)
r.post('/', requirePerm(`${t}:write`), createHandler)
r.delete('/:id', requirePerm(`${t}:write`), removeHandler)
```

这里有个取舍我想了挺久：权限要不要直接写进 JWT 里？写进去的话每次请求省一次查询，但问题是 token 签发之后就改不了了。管理员把某个编辑的写权限收回，对方只要不重新登录，手里的 token 照样能改数据，一直到过期为止。禁用账号也是一样。

所以我的 JWT 里只放 `uid` 和账号类型，权限每次请求现查。实际测下来，把"内容编辑"角色的 `notice:write` 去掉之后，编辑用原来的 token 再发一次新增公告的请求，直接就是 403 `缺少权限：notice:write`，不需要重新登录。代价是每个请求多两次很轻的查询，对 SQLite 上的中小后台来说完全感觉不到；真到了并发很高的时候，再给 `permsOf` 加一层按 `role_id` 的内存缓存，改角色时清掉就行。

另外 `requirePerm` 里顺手检查了 `type !== 'admin'`。我的用户端账号和后台账号在同一张表里，用户端注册的账号 `role_id` 是空的，理论上 `permsOf` 已经返回空数组了，但多一层类型判断，哪天有人手滑给普通用户填了 `role_id` 也不会出事。

## 分配权限的接口要防几种误操作

角色和权限能在后台页面上勾选，所以保存接口得自己兜底：

```js
function savePerms(roleId, perms) {
  const valid = new Set(db().prepare('SELECT code FROM permissions').all().map((p) => p.code))
  const bad = perms.filter((p) => !valid.has(p))
  if (bad.length) throw new HttpError(400, '未知权限：' + bad.join(','))
  db().prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
  const ins = db().prepare('INSERT INTO role_permissions (role_id, perm_code) VALUES (?, ?)')
  perms.forEach((p) => ins.run(roleId, p))
}
```

保存用的是"先删后插"，所以调用的地方包在事务里，避免插到一半报错把角色的权限清空。除此之外还有三条规则：

- `super_admin` 角色不允许修改，防止有人把自己的超管权限取消掉，结果谁都进不了角色管理
- `builtin` 的内置角色不允许删除
- 还有用户在用的角色不允许删除。`users.role_id` 有外键，直接删数据库也会报错，但那是 500，提前查一下能返回一句看得懂的提示

## Vue3 前端：菜单和按钮用同一个 can

后台登录后请求一次 `/api/admin/meta`，拿到所有模块定义和当前用户的权限码，存进 Pinia：

```js
const perms = ref([])
const can = (p) => perms.value.includes('*') || perms.value.includes(p)
const menus = computed(() => entities.value.filter((e) => can(`${e.name}:read`)))
```

判断逻辑和后端的 `can` 一模一样，这点很重要，两边规则不一致的话，就会出现"按钮能点，点了报 403"的情况。

菜单直接用 `menus` 渲染，系统管理的子菜单按权限显示：

```vue
<el-sub-menu v-if="store.can('user:read') || store.can('role:read')" index="system">
  <el-menu-item v-if="store.can('user:read')" index="/system/users">用户管理</el-menu-item>
  <el-menu-item v-if="store.can('role:read')" index="/system/roles">角色权限</el-menu-item>
</el-sub-menu>
```

按钮级别也一样：

```vue
<el-button v-if="canWrite" type="primary" icon="Plus" @click="openForm()">新增</el-button>
<el-table-column v-if="canWrite" label="操作" width="150" fixed="right">...</el-table-column>
```

我没有写网上常见的 `v-permission` 自定义指令。那种指令一般是在 `mounted` 里 `el.parentNode.removeChild(el)`，有两个问题：一是权限变化之后元素删了就回不来，不是响应式的；二是对 `el-table-column` 这种组件基本没用，它在挂载时已经把列注册进表格内部的状态里了，删掉它的 DOM 节点，表格里那一列照样在。`v-if` 加一个 `can` 函数，写起来多几个字，但行为是确定的。

路由这边我也没有用 `addRoute` 动态注册，所有业务模块共用一条 `entity/:name` 路由，页面根据路由参数去模块定义里找字段、生成表格和表单。模块是后端定义的，前端不需要为每个模块单独写路由。

## 踩过的坑和现在的取舍

**1. 前端隐藏不等于没权限。** 比如一个只分配了图书权限的账号，菜单里看不到公告，但在地址栏直接输入 `#/entity/notice`，页面是能打开的，因为路由守卫只检查了登录状态。真正拦住他的是后端：列表接口返回 403，页面弹出"缺少权限：notice:read"。所以前端的 `v-if` 只是为了体验，权限必须以后端为准。想让体验更好一点，可以在 `beforeEach` 里对 `entity/:name` 也判断一下 `can`。

**2. 通配符 `*` 只在界面上藏了。** 角色编辑弹窗里我把 `*` 从复选框里过滤掉了，但 `savePerms` 只校验权限码是否存在，`*` 本身是存在的。也就是说有 `role:write` 的人直接调接口，是能把 `*` 分给任意角色的。默认只有超管有 `role:write`，问题不大，但更严谨的做法是在接口里直接拒绝 `*`，只允许 `super_admin` 持有。

**3. 删掉模块后权限会残留。** 启动时只做 `INSERT OR IGNORE`，不会删除。删掉一个模块定义之后，它的两个权限码还留在表里，角色页面上也还能勾。这是我有意保守处理的，自动删权限容易误伤，目前需要手动清理。

**4. 改了权限，前端菜单不会自己变。** 后端是实时生效的，但前端的 `perms` 是登录时拉的。被收回权限的人刷新一下页面才会看到菜单变化，在刷新前点按钮会收到 403。对后台来说可以接受，要做到实时就得加轮询或推送，不太值得。

## 用测试把规则钉住

权限这种东西最怕改着改着就漏了，我用 `node:test` + `supertest` 写了一组用例，用内存数据库跑：

```js
test('RBAC：角色权限控制', async () => {
  assert.equal((await request(app).get('/api/admin/notice').set(auth(user))).status, 403, '用户端 token 不能访问后台')
  assert.equal((await request(app).get('/api/admin/notice').set(auth(viewer))).status, 200)
  assert.equal((await request(app).post('/api/admin/notice').set(auth(viewer)).send({ title: 'x', content: 'y' })).status, 403, '只读角色不能写')
  assert.equal((await request(app).post('/api/admin/notice').set(auth(editor)).send({ title: 'x', content: 'y' })).status, 200)
  assert.equal((await request(app).get('/api/admin/system/users').set(auth(editor))).status, 403, '编辑没有用户权限')
  // 新建"图书管理员"角色，只给 book 权限，登录后只能访问图书
})
```

后来每次改中间件或者角色接口，先跑一遍这组用例，心里就有底了。

## 最后

整套东西拆开看并不复杂：三张表、两个中间件、一个前后端一致的 `can`。关键是让代码只认权限码，角色交给数据，再加上每次请求现查权限，改配置能马上生效。我把它和通用增删改查、模块生成器放在了同一个 Vue3 + Express + SQLite 的脚手架里，上面的代码都能在里面找到完整版本。

有需要可以看看：[bishe-kit](https://github.com/MsNan/bishe-kit)
