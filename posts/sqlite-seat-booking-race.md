---
title: "先查再插挡不住并发：20 个请求同时抢座位，SQLite 座位预约被重复约上的复现与修复"
date: 2026-10-22
category: 后端
tags: [Python, SQLite, 并发, 数据库]
description: "20 线程同时预约同一座位，8 轮里 4 轮出现重复。分析先查再插的竞态，用 SQLite 部分唯一索引或 BEGIN IMMEDIATE 修复，附演示数据冲突等坑。"
---

前段时间写了一个图书馆座位预约的学习示例：Python 标准库 `http.server` + `sqlite3`，前端是原生 JS 的移动端 H5。预约接口的逻辑很常见：先查"这个人这个时段有没有预约"，再查"这个座位这个时段有没有被占"，都没有就插入一条。

功能测试一直是好的，点两次同一个座位，第二次会提示"该座位已被预约"。但这次我专门写了个脚本，让 20 个账号在同一时刻去抢同一个座位，结果 8 轮里有 4 轮出现了一个座位被两三个人同时约上。这篇把复现过程、原因和修法记下来，所有输出都是在我自己机器上跑出来的（Python 3.13.5）。

## 原来的写法

预约接口去掉参数校验后，核心就这几行：

```python
with app.db() as c:
    if c.execute("select 1 from bookings where user_id=? and day=? and slot=? and status in ('已预约','已签到')",
                 (u['id'], day, slot)).fetchone():
        raise HttpError(400, '该时段你已有预约')
    if c.execute("select 1 from bookings where room_id=? and seat=? and day=? and slot=? and status in ('已预约','已签到')",
                 (room, seat, day, slot)).fetchone():
        raise HttpError(400, '该座位已被预约')
    c.execute('insert into bookings(user_id,room_id,seat,day,slot,status,created_at) values(?,?,?,?,?,?,?)',
              (u['id'], room, seat, day, slot, '已预约', int(time.time())))
```

`app.db()` 每次新开一个 `sqlite3.connect()`，服务端用的是 `ThreadingHTTPServer`，每个请求一个线程。

## 复现：20 个人同时抢一个座位

脚本只用标准库。每一轮先登录 20 个新学号拿 token，然后用 `threading.Barrier` 让 20 个线程卡在同一个点，一起放行去调预约接口：

```python
# race2.py：每轮换一批新学号、换一个座位，20 个线程在同一时刻抢同一个座位
import json, sys, threading, urllib.request, urllib.error
from collections import Counter
BASE, ROUNDS, N = sys.argv[1], int(sys.argv[2]), 20

def call(method, path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e: return e.code, json.load(e)

day = call('GET', '/api/meta')[1]['data']['days'][1]
for rd in range(ROUNDS):
    seat = f'{rd % 5 + 1}-{rd // 5 + 1}'
    tokens = [call('POST', '/api/login', {'sid': f'4{rd:02d}{i:02d}', 'password': '123456'})[1]['data']['token'] for i in range(N)]
    barrier, results = threading.Barrier(N), []
    def worker(t):
        barrier.wait()
        try: results.append(call('POST', '/api/bookings', {'day': day, 'slot': 1, 'roomId': 2, 'seat': seat}, t))
        except OSError as e: results.append((0, {'message': type(e).__name__}))
    ths = [threading.Thread(target=worker, args=(t,)) for t in tokens]
    [t.start() for t in ths]; [t.join() for t in ths]
    c = Counter(r[1].get('message', '成功') for r in results)
    print(f'第 {rd + 1} 轮 座位 {seat}：', dict(c))
```

删掉数据库、用原代码启动服务，跑 8 轮：

```bash
PORT=18002 python3 app.py &
python3 race2.py http://localhost:18002 8
```

```
第 1 轮 座位 1-1： {'成功': 1, '该座位已被预约': 19}
第 2 轮 座位 2-1： {'成功': 2, '该座位已被预约': 18}
第 3 轮 座位 3-1： {'成功': 1, '该座位已被预约': 18, 'ConnectionResetError': 1}
第 4 轮 座位 4-1： {'成功': 1, '该座位已被预约': 19}
第 5 轮 座位 5-1： {'成功': 2, '该座位已被预约': 15, 'ConnectionResetError': 3}
第 6 轮 座位 1-2： {'成功': 2, '该座位已被预约': 18}
第 7 轮 座位 2-2： {'成功': 1, '该座位已被预约': 19}
第 8 轮 座位 3-2： {'成功': 3, '该座位已被预约': 17}
```

再去库里按"座位 + 日期 + 时段"分组，找有效预约超过一条的：

```python
c.execute("select room_id,seat,day,slot,count(*) n from bookings where status='已预约' "
          "group by 1,2,3,4 having n>1").fetchall()
```

```
[(1, '1-4', '2026-10-21', 0, 2), (2, '1-2', '2026-10-22', 1, 2), (2, '2-1', '2026-10-22', 1, 2), (2, '3-2', '2026-10-22', 1, 3), (2, '5-1', '2026-10-22', 1, 2)]
```

后四条和上面"成功 2/3 个"的轮次一一对应。第一条 `(1, '1-4', '2026-10-21', 0, 2)` 不是压测造成的，后面单独说。`ConnectionResetError` 也是另一个问题，放到最后。

## 为什么平时测不出来

我手动测试时是在手机上点一次、再换个账号点一次，两次请求之间隔了好几秒，第二次 SELECT 的时候第一条早就插进去了，所以永远是"该座位已被预约"。竞态需要两个请求的 SELECT 都落在对方 INSERT 之前，这个窗口只有几毫秒。但如果真的上线，比如在固定时间统一放出第二天的座位，很多人同时刷新、同时去点那几个靠窗的位置，这个窗口就很容易撞上。

这类问题用单元测试也不好测，因为单元测试一般是顺序调用。我用的办法就是上面这种：多线程 + Barrier 让请求尽量同时到达，然后不看接口返回，直接去库里查有没有重复数据。接口返回"成功 2 个"只是现象，库里两条有效记录才是结论。

## 为什么"先查再插"挡不住

两个请求的执行顺序可能是这样：

```
请求 A：select 座位 2-1 → 没人
请求 B：select 座位 2-1 → 没人
请求 A：insert → 成功
请求 B：insert → 也成功
```

查询和插入之间没有任何东西把它们绑成一个整体。这里还有一个 Python `sqlite3` 的细节：默认（`isolation_level=''`，旧式事务控制）下，模块只会在 INSERT/UPDATE/DELETE/REPLACE 之前自动发一个 `BEGIN`，前面的两条 SELECT 根本不在事务里。即使在事务里，默认的 `BEGIN` 也是 DEFERRED，读的时候不拿写锁，两个连接同样可以都读到"没人"。

所以问题不在 if 写得对不对，而在"唯一"这件事只存在于应用代码里，数据库并不知道。

## 修法一：让数据库保证唯一（部分唯一索引）

一个座位同一时段可以有多条记录（取消了再约、违约记录都要留着），所以不能对 `(room_id, seat, day, slot)` 直接建唯一索引。SQLite 支持带 `WHERE` 的部分索引，只对"有效"状态的行做唯一约束：

```python
c.execute("create unique index if not exists uq_seat_active on bookings(room_id, seat, day, slot) "
          "where status in ('已预约','已签到')")
c.execute("create unique index if not exists uq_user_active on bookings(user_id, day, slot) "
          "where status in ('已预约','已签到')")
```

第二个索引对应"同一个人同一时段只能约一个座位"，它和座位检查有同样的竞态。

插入时捕获 `sqlite3.IntegrityError`，换成和原来一样的提示。原来的两条 SELECT 我保留了，正常情况下它们先拦住请求，提示更友好；唯一索引是兜底：

```python
try:
    c.execute('insert into bookings(user_id,room_id,seat,day,slot,status,created_at) values(?,?,?,?,?,?,?)',
              (u['id'], room, seat, day, slot, '已预约', int(time.time())))
except sqlite3.IntegrityError as e:
    raise HttpError(400, '该时段你已有预约' if 'bookings.user_id' in str(e) else '该座位已被预约')
```

区分两个索引靠的是错误信息里的列名，实际拿到的信息是这样的：

```
UNIQUE constraint failed: bookings.room_id, bookings.seat, bookings.day, bookings.slot
```

## 加完索引，服务起不来了

改完重启，直接报错退出：

```
  File "/tmp/dlp/02-seat-booking-mobile/app.py", line 29, in init
    c.execute('insert into bookings(user_id,room_id,seat,day,slot,status,created_at) values(?,?,?,?,?,?,?)', (i + 2, 1, f'{random.randint(1,4)}-{random.randint(1,8)}', today, random.randint(0, 2), '已预约', int(time.time())))
sqlite3.IntegrityError: UNIQUE constraint failed: bookings.room_id, bookings.seat, bookings.day, bookings.slot
```

这就是前面那条 `(1, '1-4', '2026-10-21', 0, 2)`：初始化演示数据时，用 `random.seed(7)` 给 14 个演示同学随机分配座位和时段，随机数撞了，同一个座位同一时段被塞了两条预约。因为种子固定，每次新建库都会撞在同一个位置。没有约束的时候它安安静静地躺在库里，加上约束才暴露出来。

改成不放回抽样：

```python
picks = random.sample([(f'{r}-{c}', s) for r in range(1, 5) for c in range(1, 9) for s in range(3)], 14)
for i, (seat, slot) in enumerate(picks):  # 演示占座：不放回抽样，保证不重复
    ...
```

如果是线上已经有数据的库，建索引之前要先用上面那条 `group by ... having n>1` 把重复数据找出来处理掉，否则 `create unique index` 会和这里一样失败。

## 修复后的结果

同样的脚本跑 8 轮：

```
第 1 轮 座位 1-1： {'成功': 1, '该座位已被预约': 19}
第 2 轮 座位 2-1： {'成功': 1, '该座位已被预约': 19}
第 3 轮 座位 3-1： {'成功': 1, '该座位已被预约': 19}
第 4 轮 座位 4-1： {'成功': 1, '该座位已被预约': 19}
第 5 轮 座位 5-1： {'成功': 1, '该座位已被预约': 19}
第 6 轮 座位 1-2： {'该座位已被预约': 19, '成功': 1}
第 7 轮 座位 2-2： {'成功': 1, '该座位已被预约': 19}
第 8 轮 座位 3-2： {'成功': 1, '该座位已被预约': 19}
```

库里重复数据为空。为了确认索引真的起了作用，而不是这几轮刚好没撞上，我临时把 `IntegrityError` 分支的提示改成"该座位已被预约（唯一索引拦下）"又跑了 5 轮：

```
第 1 轮 座位 1-1： {'成功': 1, '该座位已被预约': 17, '该座位已被预约（唯一索引拦下）': 2}
第 2 轮 座位 2-1： {'成功': 1, '该座位已被预约（唯一索引拦下）': 2, '该座位已被预约': 14, 'ConnectionResetError': 3}
第 3 轮 座位 3-1： {'成功': 1, '该座位已被预约': 19}
第 4 轮 座位 4-1： {'成功': 1, '该座位已被预约': 16, '该座位已被预约（唯一索引拦下）': 3}
第 5 轮 座位 5-1： {'成功': 1, '该座位已被预约': 18, '该座位已被预约（唯一索引拦下）': 1}
```

每轮都只有 1 个成功，其中有好几个请求是越过了 SELECT 检查、在 INSERT 时被索引拦下的，也就是说没有索引的话它们就成功了。

另外两个场景也测了：

- 同一个人"手抖连点"，同时抢 10 个不同座位。原代码跑 3 次，分别成功了 3、3、5 个；加索引后只成功 1 个，其余 9 个都是"该时段你已有预约"。
- A 预约后取消，B 再约同一个座位：取消后状态变成"已取消"，不在部分索引的范围内，B 可以正常预约。这正是用部分索引而不是普通唯一索引的原因。

## 修法二：BEGIN IMMEDIATE

另一种思路是让"查 + 插"串行执行。在原代码（不加索引）的 `with app.db() as c:` 下面第一行加：

```python
c.execute('begin immediate')  # 一开始就拿写锁，后面的检查和插入串行执行
```

`BEGIN IMMEDIATE` 开始事务时就拿写锁，其他连接想开写事务时要等它提交。同样跑 5 轮，每轮都只有 1 个成功；同一个人连点 10 个座位也只成功 1 个。

两种我都试了，最后倾向于唯一索引：约束写在库里，以后别的接口、后台脚本往这张表插数据也绕不过去；`BEGIN IMMEDIATE` 只保护写了它的那段代码。而且 Python `sqlite3` 默认的等锁超时是 5 秒，并发更高、事务更长的时候，等锁的请求会拿到 `database is locked`，这个在我这次的测试里没有出现，但需要心里有数。

## 顺带发现的几个问题

**1. `with sqlite3.connect(...)` 不会关闭连接。** 连接对象的上下文管理器只负责提交或回滚，不负责 `close()`。验证一下：

```python
import sqlite3, gc
def db():
    c = sqlite3.connect('/tmp/leak.db'); return c
with db() as c:
    c.execute('create table if not exists t(x)')
    c.execute('insert into t values(1)')
print('with 结束后还能查：', c.execute('select count(*) from t').fetchone(), flush=True)
del c; gc.collect()
```

```bash
python3 -W always::ResourceWarning /tmp/leak.py
```

```
with 结束后还能查： (1,)
/tmp/leak.py:8: ResourceWarning: unclosed database in <sqlite3.Connection object at 0x7fa26ce76a70>
  del c; gc.collect()
ResourceWarning: Enable tracemalloc to get the object allocation traceback
```

项目里所有接口都是 `with app.db() as c:` 的写法，连接靠垃圾回收释放。要显式关闭可以套一层 `contextlib.closing`，或者自己写个上下文管理器，在里面 commit/rollback 之后再 close。

**2. 并发压测时偶尔出现 `ConnectionResetError`。** `ThreadingHTTPServer` 继承自 `socketserver.TCPServer`，`listen` 队列长度 `request_queue_size` 默认是 5：

```bash
python3 -c "import http.server; print(http.server.ThreadingHTTPServer.request_queue_size)"
```

```
5
```

20 个连接同一时刻进来，队列装不下的会被重置。我在启动前把它设成 128 再跑 10 轮，一次都没再出现。学习示例用 5 问题不大，但压测时要知道这些报错不是业务逻辑的问题。

**3. `day` 参数没有校验。** 现在接口里 `day` 传 `abc` 或者 `1999-01-01` 都能预约成功，返回 `{"code": 0, "data": true}`。应该解析成日期，并限制在 `/api/meta` 返回的可选日期范围内。

## 小结

1. "先查再插"在并发下不可靠，唯一性要交给数据库：唯一索引，或者让查和插在同一个加了写锁的事务里。
2. 有"取消/历史记录"的表，用带 `WHERE` 的部分唯一索引，只约束有效状态。
3. 加约束之前先查一遍现有数据有没有重复，演示数据、种子数据也算。
4. 捕获 `IntegrityError` 转成业务提示，前面的 SELECT 检查可以保留，用来给大部分请求更友好的提示。
5. 修完要用同样的并发脚本再跑一遍，最好能区分出"被检查拦下"和"被约束拦下"，确认约束真的生效了。

上面的修改我只在本地副本里做了验证，仓库里目前还是原来的写法，后面会把唯一索引、演示数据和 `day` 校验一起补上。

完整代码在 https://github.com/MsNan/dev-learning-projects
