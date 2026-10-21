---
title: "RBAC 里最容易漏的一条规则：授权者不能给出自己没有的权限"
date: 2026-10-21
category: 后端
tags: [Node.js, Express, RBAC, 安全]
description: "有 role:write 的人能给自己分 *、改超管密码。被授予的权限必须是自己权限的子集：授权、分配角色、改角色、管账号四类接口的检查，校验顺序、事务、测试和遗留问题。"
---

10 月 19 号我写过一篇权限码 RBAC 的实践，用 SQLite 存角色和权限码，Express 中间件每次请求现查权限。文章最后"踩过的坑"里有一条是这么写的：角色编辑弹窗里把 `*` 从复选框里过滤掉了，但接口没拦，有 `role:write` 的人直接调接口能把 `*` 分给任意角色；默认只有超管有 `role:write`，问题不大。

发出去以后我又想了一下，"问题不大"这个判断是错的。`role:write` 这个权限存在的意义，就是让超管以外的人也能管理角色。只要哪天给某个"系统管理员"分了它，这个人就等于超管，而且还能顺手把真正的超管踢掉。这不是一个能留着以后再说的问题，所以紧接着就修了。

修完回头看，这类漏洞的根源可以归结成一条规则：**授权者不能给出自己没有的权限**。听起来很显然，但它在代码里要落到好几个不太显眼的地方，漏掉任何一个都等于没做。这篇把复现、修复和测试的过程记下来，代码来自我的脚手架项目 bishe-kit，后端是 Express 5 + sql.js。

## 先把漏洞跑出来

为了对比，我把修复前后两个版本的 server 目录分别导出到临时目录，用内存数据库各起一个服务：

```bash
git archive 3099fc8 server | tar x -C /tmp/bk-old   # 修复前
git archive HEAD    server | tar x -C /tmp/bk-new   # 修复后
cd /tmp/bk-old/server && DB_PATH=:memory: PORT=3101 node src/index.js
cd /tmp/bk-new/server && DB_PATH=:memory: PORT=3102 node src/index.js
```

首次启动会自动写入演示数据：超管 `admin`、内容编辑 `editor`、只读访客 `viewer`。

然后写了一个 curl 脚本模拟一个真实的场景：超管建了一个"系统管理员"角色，只给了用户和角色管理的四个权限 `user:read`、`user:write`、`role:read`、`role:write`，再建一个账号 `ops` 绑定这个角色。接下来用 `ops` 的 token 做几件它本不该能做的事。脚本的核心是两个函数：

```bash
login() {
  curl -s $B/auth/admin/login -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .data.token
}
call() { # method url token body
  curl -s -o /tmp/resp.json -w '%{http_code}' -X $1 "$B$2" \
    -H "Authorization: Bearer $3" -H 'Content-Type: application/json' ${4:+-d "$4"}
  echo " $(jq -c . /tmp/resp.json)"
}
```

对修复前的服务跑一遍：

```
sys_admin 角色 id=4，ops 用户 id=5
# 0. ops 现在能发公告吗
403 {"code":403,"msg":"缺少权限：notice:write"}
# 1. ops 建一个带 * 的角色
200 {"code":0,"data":{"id":5}}
# 2. ops 把自己改成这个角色
200 {"code":0}
# 3. 同一个 token 再发公告
200 {"code":0,"data":{"id":5}}
# 4. ops 重置超管密码
200 {"code":0}
# 5. 超管用原密码登录
登录失败
```

四步就完成了提权，最后连超管都登录不上了。第 3 步值得注意：`ops` 没有重新登录，用的还是原来那个 token。因为这套 RBAC 的权限是每次请求现查数据库的，上一篇我把这当成优点（改了权限立即生效），在这里它同样让提权立即生效。

## 漏洞不止一个入口

`*` 只是最显眼的一个。我又写了一组探测请求，用 `ops2` 这个同样是"系统管理员"的账号去试各个接口，修复前后的结果对比如下：

| 操作 | 修复前 | 修复后 |
| --- | --- | --- |
| a. 把自己的角色改成 super_admin | 200 | 403 不能分配权限比自己高的角色 |
| b. 新建管理员并指定 super_admin | 200 | 403 不能分配权限比自己高的角色 |
| c. 新建管理员，role_id 不存在 | 500 服务器错误 | 400 角色不存在 |
| d. 建角色时带一个不存在的权限码 | 400，但留下空角色 | 403 不能分配自己没有的权限 |
| e. perms 传字符串而不是数组 | 500 服务器错误 | 400 perms 必须是字符串数组 |
| f. 给自己的角色加 notice:write | 200 | 403 不能分配自己没有的权限 |
| g. 改 editor 角色的名字 | 200 | 403 不能修改权限比自己高的角色 |
| h. 建一个只有 user:read 的角色并分配给新人 | 200 | 200 |
| i. 重置另一个系统管理员的密码 | 200 | 200 |
| j. 删除超管账号 | 200 | 403 不能操作权限比自己高的账号 |

a、b、f 是另外三条提权路径，不需要 `*` 也能做到：直接把现成的超管角色分给自己，或者往自己的角色里加权限。g 和 j 是"以下犯上"，改不了自己的权限，但能动比自己高的角色和账号。h 和 i 是正常操作，修复后应该继续允许，后面会讨论 i。

c 和 e 不是越权，但返回 500 说明输入没校验，服务端日志里分别是：

```
Error: FOREIGN KEY constraint failed
TypeError: perms.filter is not a function
```

d 的问题在修复前的代码里：

```js
const id = Number(db().prepare('INSERT INTO roles (code, name) VALUES (?, ?)').run(code, name).lastInsertRowid)
db().transaction(() => savePerms(id, perms))()
```

先插入角色，再在事务里保存权限。权限校验失败时事务回滚的只是权限，角色已经插进去了。探测跑完以后看角色表，多了两个空壳：

```
[5,"half",[]]
[6,"strperm",[]]
```

分别是 d 和 e 两次失败的请求留下的。

## 规则：被授予的权限必须是自己权限的子集

如果角色是线性的，比如"超管 > 管理员 > 编辑 > 访客"，可以给每个角色一个等级数字，只能管理等级比自己低的。但权限码模型下，角色之间通常没有高低关系：演示数据里的"内容编辑"有公告和图书的读写共四个权限，上面的"系统管理员"有用户和角色的读写共四个权限，两者谁也不比谁高。用等级数字表达不了这种关系。

所以判断标准直接落在权限集合上：A 能把一组权限交出去，当且仅当这组权限是 A 自己权限的子集。`*` 不能当作普通的权限码参与比较，因为它代表的是"全部"，只有本身就持有 `*` 的超管能授予。

代码里这条规则只写了一次，其余地方都调用它：

```js
const isSuper = (user) => user.perms.includes('*')
const rolePerms = (roleId) => db().prepare('SELECT perm_code FROM role_permissions WHERE role_id = ?')
  .all(roleId).map((p) => p.perm_code)

/** perms 中当前操作者没有的权限（超管返回空数组） */
const beyond = (user, perms) =>
  (isSuper(user) ? [] : perms.filter((p) => p === '*' || !user.perms.includes(p)))
```

`beyond` 返回的是"超出部分"而不是一个布尔值，这样报错时能直接告诉对方是哪几个权限不能给。`p === '*'` 那个条件是为了防一种情况：非超管的 `user.perms` 里理论上不会有 `*`（有的话就是超管了），但不加这个判断，代码的正确性就要依赖这个隐含前提，显式写出来更稳。

## 要落到哪几个地方

规则只有一条，但授权行为分散在好几个接口里。我按"谁的权限被改变了"来梳理，一共四类。

**一、直接授予权限：新建角色、修改角色的权限列表。**

```js
function assertCanGrant(user, perms) {
  if (isSuper(user)) return
  if (perms.includes('*')) throw new HttpError(403, '只有超级管理员可以分配「全部权限」')
  const extra = beyond(user, perms)
  if (extra.length) throw new HttpError(403, '不能分配自己没有的权限：' + extra.join(','))
}
```

前面 curl 脚本的第 1 步和表格里的 d、f 都在这里被拦下。`*` 单独给了一句提示，因为"不能分配自己没有的权限：*"这个报错对使用者来说不太好理解。

**二、间接授予权限：把某个角色分配给用户。**

分配角色等于把这个角色的全部权限交给对方，所以要检查的是角色当前的权限：

```js
function assertCanAssignRole(user, roleId) {
  if (roleId === null || roleId === undefined) return
  if (!db().prepare('SELECT 1 FROM roles WHERE id = ?').get(roleId)) throw new HttpError(400, '角色不存在')
  if (beyond(user, rolePerms(roleId)).length) throw new HttpError(403, '不能分配权限比自己高的角色')
}
```

新建用户和修改用户两个接口都要调用，curl 脚本的第 2 步和表格里的 a、b 靠的就是它。顺便先查一下角色是否存在，把 c 那个外键约束导致的 500 变成 400。新建用户时只有 `type === 'admin'` 才检查，因为普通用户端账号的 `role_id` 本来就会被写成 `null`。

**三、修改比自己高的角色。**

```js
r.put('/roles/:id', requirePerm('role:write'), (req, res) => {
  // ...
  if (beyond(req.user, rolePerms(role.id)).length) throw new HttpError(403, '不能修改权限比自己高的角色')
  const { name, perms } = req.body || {}
  if (perms !== undefined) { checkPermsShape(perms); assertCanGrant(req.user, perms) }
  // ...
})
```

这里有两次检查，容易只写后一次。只检查新权限列表的话，系统管理员可以把"内容编辑"这个角色的权限清空（新列表是空数组，当然是他权限的子集），或者把名字改成别的，影响所有持有这个角色的人。所以要先确认这个角色**当前**的权限不超过自己，才允许动它。删除角色同理。

**四、管理比自己高的账号。**

重置密码、禁用、删除这些操作虽然不直接改权限，但能让对方失去账号，效果比改权限还严重：

```js
function assertCanManageUser(user, targetId) {
  const t = db().prepare('SELECT role_id FROM users WHERE id = ?').get(targetId)
  if (!t) throw new HttpError(404, '用户不存在')
  if (t.role_id && beyond(user, rolePerms(t.role_id)).length) throw new HttpError(403, '不能操作权限比自己高的账号')
}
```

修改用户接口里，它和 `assertCanAssignRole` 都要调用，顺序是先检查能不能动这个人，再检查要给他的角色：

```js
r.put('/users/:id', requirePerm('user:write'), (req, res) => {
  const { nickname, role_id, status, password, phone } = req.body || {}
  if (Number(req.params.id) === req.user.id && status === 0) throw new HttpError(400, '不能禁用自己')
  assertCanManageUser(req.user, req.params.id)
  assertCanAssignRole(req.user, role_id)
  // UPDATE ...
})
```

这样"把超管降级成访客"会在第一步被拦住，"把自己升成超管"会在第二步被拦住。

## 校验顺序和事务

除了权限规则本身，这次还改了两处和顺序有关的地方。

第一，先校验类型，再做权限判断。原来 `perms` 传字符串时，`savePerms` 里的 `perms.filter` 直接抛 TypeError。现在加了一个形状检查，放在 `assertCanGrant` 之前：

```js
function checkPermsShape(perms) {
  if (!Array.isArray(perms) || perms.some((p) => typeof p !== 'string')) throw new HttpError(400, 'perms 必须是字符串数组')
}
```

放在前面不只是为了返回好看的 400。字符串也有 `includes` 方法，`'*'.includes('*')` 是 true，`'user:*'` 这种字符串同样能匹配；而 `[...new Set('user:read')]` 会被拆成一个个字符。权限判断的代码是按数组写的，传进来的不是数组时，它的行为就不可预期，所以类型必须先确定。

第二，建角色时把插入角色和保存权限放进同一个事务：

```js
checkPermsShape(perms)
assertCanGrant(req.user, perms)
let id
db().transaction(() => {
  id = Number(db().prepare('INSERT INTO roles (code, name) VALUES (?, ?)').run(code, name).lastInsertRowid)
  savePerms(id, perms)
})()
```

这里的 `db()` 不是 better-sqlite3，而是我在 sql.js 外面包的一层同步 API，`transaction` 的实现就是 `BEGIN`，执行函数，成功 `COMMIT`，抛错 `ROLLBACK`。权限码不存在之类的错误在 `savePerms` 里抛出，整个事务回滚，不会再留下空角色。

有一个细节是修复后表格里 d 的返回从 400 变成了 403。因为 `assertCanGrant` 在 `savePerms` 之前执行，对非超管来说，一个不存在的权限码自然也是"自己没有的权限"，先被 403 拦下了。超管跳过了这一步，我用超管试了一下，返回的仍然是 `400 未知权限：no:such`，角色表里也没有留下空角色。我觉得这样没问题：非超管没必要知道某个权限码是不存在还是自己没有。

## 用测试把规则固定下来

这类规则最怕以后加新接口时忘了调用，所以在 `server/test/api.test.js` 里加了第 5 组用例，场景和上面的 curl 脚本一致，先由超管建"系统管理员"角色和 `ops` 账号，再用 `ops` 逐条尝试：

```js
// 角色：不能分配 * 或自己没有的权限，也不能留下半成品角色
assert.equal((await post('/api/admin/system/roles', { code: 'evil', name: 'x', perms: ['*'] })).status, 403)
assert.equal((await post('/api/admin/system/roles', { code: 'evil2', name: 'x', perms: ['book:write'] })).status, 403)
assert.equal((await post('/api/admin/system/roles', { code: 'evil3', name: 'x', perms: '*' })).status, 400)
assert.equal((await post('/api/admin/system/roles', { code: 'okrole', name: '用户查看', perms: ['user:read'] })).body.code, 0, '自己有的权限可以分配')
// 用户：不能把人设成超管，不能改/删超管账号
assert.equal((await put(`/api/admin/system/users/${me.id}`, { role_id: sa.id })).status, 403, '不能给自己升级成超管')
assert.equal((await put(`/api/admin/system/users/${root.id}`, { password: 'hacked1' })).status, 403, '不能重置超管密码')
assert.ok(await login('admin', 'admin123'), '超管密码未被改')
const roleCodes = (await request(app).get('/api/admin/system/roles').set(auth(admin))).body.data.map((r) => r.code)
assert.ok(!roleCodes.some((c) => c.startsWith('evil')), '被拒绝的请求没有建出角色')
```

除了"不能做"，也测了"能做"：分配自己有的权限要成功，超管修改任何角色要成功。只测拒绝的话，一个把所有请求都拒掉的实现也能通过。

为了确认这组用例真的能抓住问题，我把新的测试文件复制到修复前的代码里跑了一下：

```
ok 1 - 认证：登录、错误密码、双端隔离、注册、me
ok 2 - RBAC：角色权限控制
ok 3 - CRUD：增删改查、分页、搜索、校验、公开接口
ok 4 - 上传：需要登录、类型和大小限制
not ok 5 - 防越权：只能分配/管理不超过自己的权限
  expected: 403
  actual: 200
# pass 4
# fail 1
```

在当前代码上运行 `npm test`，5 组全部通过。前 4 组在修复前后都是绿的，这也说明了原来的测试只覆盖了"没权限的人被拦住"，没覆盖"有管理权限的人能不能越界"。

## 还没解决的几个问题

修完之后我又用新代码试了几种边界情况，有些是有意保留的，有些是还没做的，一并记下来。

**同级之间可以互相管理。** 表格里的 i，一个系统管理员能重置另一个系统管理员的密码。按"不超过自己"的规则，权限相等是允许的。如果改成严格子集（只能管理权限比自己少的人），同级就不能互管了，但这样第一个系统管理员也没法帮另一个同事重置密码，只能找超管。我目前保留了前者，团队里有需要可以把 `beyond` 的判断改严。

**可以缩减自己角色的权限，把自己锁在外面。** 我用 `ops2` 把自己所在的"系统管理员"角色改成只剩 `user:read`，接口返回 200，紧接着再查角色列表就是 `403 缺少权限：role:read`。而且同一角色的其他人也一起被降了权限。这符合规则，新权限是旧权限的子集，但体验上很容易误操作。前端可以在修改自己所在的角色时多一次确认。

**超管可以把自己降级，系统里就没有超管了。** 我用 `admin` 把自己的角色改成"只读访客"，返回 200，之后 `admin` 查角色列表也是 403。启动时的初始化只保证 `super_admin` 这个角色和它的 `*` 权限存在，并不保证有用户持有它。这种情况只能直接改数据库恢复。比较稳妥的做法是在修改和删除用户时检查：如果目标当前是超管，并且操作完成后系统里不再有任何持有 `*` 的启用账号，就拒绝。这一条目前还没有加。

**前端复选框没有跟着收紧。** 角色编辑弹窗里只过滤了 `*`，系统管理员打开时仍然能看到并勾选自己没有的权限，提交后才收到 403。后端拦住了，安全上没问题，但更好的体验是把自己没有的权限置灰，前端 store 里已经有 `can` 判断，改起来不难。

## 小结

把这次的经验浓缩一下：

1. 判断标准是权限集合的子集关系，不是角色名，也不是等级数字。`*` 单独处理，只有持有 `*` 的人能授予。
2. 授权有直接和间接两种。往角色里加权限是直接授予，把角色分配给人是间接授予，两个都要检查。
3. 改一个角色、动一个账号之前，先检查对象**当前**的权限是否超过自己，不能只看请求里的新值。
4. 先校验参数类型，再做权限判断；涉及多张表的写入放进同一个事务。
5. 测试既要测"不能做"，也要测"能做"，并且拿修复前的代码跑一遍，确认测试真的会失败。

完整代码在 https://github.com/MsNan/bishe-kit
