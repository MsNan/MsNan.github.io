---
title: "sql.js 包成同步 API 后，外键约束在第一次落盘时悄悄失效了"
date: 2026-10-29
category: 后端
tags: [Node.js, SQLite, sql.js]
description: "sql.js 的 export() 会关库重开：PRAGMA foreign_keys 被重置、预编译语句被释放。另测了防抖落盘饿死、退出时丢数据和整库写盘耗时，附修法。"
---

# sql.js 包成同步 API 后，外键约束在第一次落盘时悄悄失效了

bishe-kit 是我做的毕设脚手架，后端用的是 sql.js（SQLite 编译成 WebAssembly）。选它是为了让同学在 Windows 上 `npm i` 完就能跑，不用装 Python、不用编译原生模块。代价是 sql.js 整个库都在内存里，写文件这件事得自己管。

我在 `server/src/db.js` 里把它包成了类似 better-sqlite3 的同步 API。这几天回头检查落盘逻辑，翻出一个之前没注意的问题：**`PRAGMA foreign_keys = ON` 在第一次落盘之后就失效了**，`ON DELETE CASCADE` 和外键检查都不再生效，而且没有任何报错。顺带也把防抖落盘的其他几个边界情况测了一遍。

环境：sql.js 1.15.0，Node 20.19.2，下面的结果都是在仓库当前代码上实际跑出来的。

## 先看封装是怎么落盘的

核心就是一个 `save()` 加一个 `flush()`：

```js
save() {
  if (this.file === ':memory:' || this.inTx) return
  clearTimeout(this.timer)
  this.timer = setTimeout(() => this.flush(), 50)
}
flush() {
  if (this.file === ':memory:') return
  clearTimeout(this.timer)
  fs.mkdirSync(path.dirname(this.file), { recursive: true })
  const tmp = this.file + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(this.raw.export()))
  fs.renameSync(tmp, this.file)
}
```

每次 `exec` 或 `run` 之后调 `save()`，50ms 防抖，连续几次写只落一次盘。落盘是先写 `.tmp` 再 `rename`，写到一半进程挂了也不会留下半个数据库文件。事务进行中（`inTx` 大于 0）不落盘，等 `COMMIT` 后再说。另外注册了 SIGINT/SIGTERM，退出前同步 `flush()` 一次。

`getDb()` 初始化时开了外键：

```js
db = new Wrapper(config.dbPath)
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, ...);
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    perm_code TEXT REFERENCES permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, perm_code));
  ...
`)
```

删除角色的接口只执行 `DELETE FROM roles WHERE id = ?`，角色和权限的关联行指望 `ON DELETE CASCADE` 自动清掉。

## 问题：export() 会把数据库关掉再打开

写了个脚本，用文件数据库跑一遍"建角色、挂权限、删角色"，中间手动 `flush()` 一次：

```js
process.env.DB_PATH = '/tmp/fk.db'
const { getDb } = await import('./src/db.js')
const db = getDb()
const fk = () => db.prepare('PRAGMA foreign_keys').get().foreign_keys
console.log('启动后 foreign_keys =', fk())
db.prepare("INSERT INTO roles (code,name) VALUES ('r1','R1')").run()
db.prepare("INSERT INTO permissions (code,name) VALUES ('a:read','A')").run()
db.prepare("INSERT INTO role_permissions VALUES (1,'a:read')").run()
db.prepare("DELETE FROM roles WHERE id = 1").run()
console.log('flush 前删除角色后 role_permissions 行数 =', db.prepare('SELECT COUNT(*) c FROM role_permissions').get().c)
db.flush()
console.log('flush 后 foreign_keys =', fk())
// 再建一个角色、挂权限、删掉
// ...
try { db.prepare("INSERT INTO role_permissions VALUES (999,'nope')").run(); console.log('插入不存在的 role_id/perm_code：成功') }
catch (e) { console.log('插入失败', e.message) }
```

输出：

```
启动后 foreign_keys = 1
flush 前删除角色后 role_permissions 行数 = 0
flush 后 foreign_keys = 0
flush 后删除角色, role_permissions 行数 = 1
插入不存在的 role_id/perm_code：成功
```

flush 之前一切正常，flush 之后外键开关变回 0：级联删除不执行，指向不存在记录的行也能插进去。

原因在 sql.js 的 `Database.prototype.export`。它为了拿到完整的文件内容，会先 `sqlite3_close_v2` 关闭数据库，读出字节后再 `sqlite3_open` 打开。文档注释里其实写了：

```
Exports the contents of the database to a binary array. This
operation will close and re-open the database which will cause
any pragmas to be set back to their default values.
```

`foreign_keys` 是连接级别的设置，不存进数据库文件，重新打开就回到默认的 OFF。

更麻烦的是失效的时间点。`getDb()` 里那句 `CREATE TABLE IF NOT EXISTS` 走的是 `exec`，会触发一次 `save()`，50ms 后定时器自己 flush。也就是说服务一启动，什么请求都没处理，外键就已经关了：

```js
const db = getDb()
console.log('getDb() 刚返回：foreign_keys =', fk())
await new Promise(r => setTimeout(r, 100))
console.log('100ms 后（没做任何写操作）：foreign_keys =', fk())
```

```
getDb() 刚返回：foreign_keys = 1
100ms 后（没做任何写操作）：foreign_keys = 0
```

测试为什么没发现：`test/api.test.js` 里设的是 `DB_PATH = ':memory:'`，内存库 `save()` 直接 return，从来不 export，外键一直是开的。

对这个项目当前的实际影响我也核对了一下，范围不算大：

- 删角色前，代码里已经先查了 `SELECT 1 FROM users WHERE role_id = ?`，有用户在用就报"仍有用户使用该角色"。所以 `users.role_id` 不会因为外键失效而指向被删的角色。
- 受影响的是 `role_permissions`：删掉的角色，它的权限关联行会留在表里成为孤儿数据。
- `roles.id` 是 `INTEGER PRIMARY KEY`，没加 `AUTOINCREMENT`。删掉 id 最大的角色以后，新建的角色可能拿到同一个 id。好在新建角色时 `savePerms` 会先 `DELETE FROM role_permissions WHERE role_id = ?` 再插入，旧的孤儿行会被清掉，新角色不会继承到别人的权限。
- 通过实体配置生成的业务表（book、notice）没有外键。

但这是个脚手架，同学会在上面加自己的表。如果有人照着 `role_permissions` 的写法给订单明细加 `ON DELETE CASCADE`，就会遇到"本地测试全过，部署后删订单明细不跟着删"的情况。

修法是在 `flush()` 里 export 之后把设过的 pragma 重新执行一遍：

```js
pragma(p) { this.raw.exec('PRAGMA ' + p); if (p.includes('=')) this.pragmas.push(p) }

flush() {
  // ...写 tmp、rename
  for (const p of this.pragmas) this.raw.exec('PRAGMA ' + p)
}
```

`flush()` 只会在事务外被调用（`save()` 在 `inTx` 时直接返回），所以这里重新设置 `foreign_keys` 不会遇到"事务内改不了"的问题。改完再跑上面的脚本，flush 后 `foreign_keys = 1`，级联删除生效，插入不存在的 role_id 报 `FOREIGN KEY constraint failed`。

## export() 还会释放所有预编译语句

测落盘耗时的时候又撞到一个：我在脚本里 `prepare` 了一条 INSERT 反复用，中间 `export()` 了一次，再用这条语句就抛错：

```
Statement closed
```

翻 `export()` 的源码，第一步就是遍历 `this.statements` 逐个 `free()`，接着把 `create_function` 注册的自定义函数也移除，然后才关库、读文件、重新打开。仓库里的封装恰好避开了：`prepare()` 返回的对象不持有 Statement，每次 `get/all/run` 时才 `raw.prepare`，用完 `free()`。看起来像是浪费，但换成"缓存语句"的写法，第一次落盘之后就会报错。以后有人想做语句缓存优化，这一点得记着。

## 防抖：一直有写入就一直不落盘

`save()` 每次都 `clearTimeout` 再重新计时，这是典型的 trailing debounce。只要写入间隔一直小于 50ms，定时器就一直被推后。用 30ms 一次的频率持续插入：

```
1s: 内存 31 行, 磁盘 无 log 表
3s: 内存 97 行, 磁盘 无 log 表
5s: 内存 163 行, 磁盘 无 log 表
停止写入 100ms 后: 磁盘 163
```

5 秒钟里一次都没写盘（脚本开头先 flush 了一个空库，所以磁盘上连 log 表都还没有）。毕设项目正常点页面很难持续这么密集地写，但批量导入、压测、或者某个接口里循环插入几百行（不包在事务里的话每行都触发一次 `save()`），都可能这样。

加一个最长等待时间就行：记录第一次未落盘写入的时间，超过 1 秒直接 flush：

```js
save() {
  if (this.file === ':memory:' || this.inTx) return
  clearTimeout(this.timer)
  if (!this.dirtySince) this.dirtySince = Date.now()
  if (Date.now() - this.dirtySince >= 1000) return this.flush()
  this.timer = setTimeout(() => this.flush(), 50)
}
```

`flush()` 末尾把 `dirtySince` 清零。同样的脚本，改完以后：

```
1s: 内存 30 行, 磁盘 无 log 表
3s: 内存 96 行, 磁盘 66
5s: 内存 163 行, 磁盘 134
停止写入 100ms 后: 磁盘 163
```

## 那 50ms 窗口里退出，数据会不会丢

分几种退出方式测了。脚本插入一行，然后：

| 退出方式 | 结果 |
|---|---|
| 10ms 后抛未捕获异常 | 丢了 |
| 立刻 `process.exit(1)` | 丢了 |
| 200ms 后 `process.exit(0)` | 在（定时器已经 flush 过） |
| Ctrl+C / SIGTERM | 在（信号处理里 flush） |

SIGINT/SIGTERM 处理得没问题。顺便确认了 `node --watch-path` 改代码重启时发的是 SIGTERM（我写了个只记录信号的脚本，touch 一下监听目录，记到的是 SIGTERM），所以 `npm run dev` 热重启不会丢数据。Dockerfile 里 `CMD` 是 exec 形式直接跑 node，`docker stop` 的 SIGTERM 也会到 Node 进程本身。

丢数据的是 `process.exit()` 和未捕获异常。Express 5 会接住路由处理函数里抛出的错误（包括 async 函数 reject），所以普通接口报错不会让进程退出；真正会走到这里的是定时任务、事件回调之类不在请求链路里的代码出错。

`flush()` 全是同步操作，可以挂在 `exit` 事件上，`process.exit()` 和未捕获异常导致的退出都会触发它：

```js
process.once('exit', () => { if (db?.dirtySince) db.flush() })
```

加上以后前两种也不丢了。`kill -9`、断电、OOM 被系统杀掉，这些没有办法，最多丢最后 50ms 到 1 秒的写入。这是选 sql.js 这种"整库在内存"方案时就要接受的。

## 每次落盘都是整库写一遍

最后量了一下落盘本身的耗时。`export()` 每次导出的是完整的数据库文件，不是增量：

```
5.2MB   export 4ms   写文件 13~18ms
20.6MB  export 15ms  写文件 45ms
50.5MB  export 35ms  写文件 120~159ms
```

这是在一台 8 核 Linux 虚拟机上的数字，换到学生的笔记本和机械硬盘上只会更慢。整个过程是同步的，几十毫秒到上百毫秒里事件循环被堵住，期间所有请求都要等。对毕设来说，几 MB 的库完全没问题；要是有人往库里存图片 base64、或者上万行日志，就会开始感觉到卡。仓库里上传的文件是存磁盘、库里只存路径，这一点是对的。

另外，因为每次都是用内存里的内容整个覆盖文件，服务运行时用 DB Browser 之类的工具直接改 `app.db`，改动会在下一次落盘时被覆盖掉，这个我在之前讲权限的文章里提过。

## 小结

- sql.js 的 `export()` 会关闭并重新打开数据库：所有 PRAGMA 回到默认值，所有预编译语句被释放。`foreign_keys` 默认是关的，所以第一次落盘后外键约束和级联删除就静默失效了。
- 用 `:memory:` 跑测试发现不了这类问题，至少要有一条用例走文件库，并且等过一次落盘。
- trailing debounce 要配一个最长等待时间，否则持续写入时永远不落盘。
- SIGINT/SIGTERM 之外，再在 `exit` 事件上同步 flush 一次，能兜住 `process.exit()` 和未捕获异常。
- 整库导出的开销随库大小线性增长，而且会阻塞事件循环，大文件别往库里放。

上面三处修改（重设 pragma、最长等待、exit 时 flush）我在本地改完跑了仓库自带的 6 个接口测试，都通过，还没提交到仓库。

仓库：https://github.com/MsNan/bishe-kit
