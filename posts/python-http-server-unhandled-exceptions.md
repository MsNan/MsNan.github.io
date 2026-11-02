---
title: "改书的馆藏数量时多打了个“本”字，请求直接断开：标准库 http.server 吞异常、CSV 公式注入和几个借阅边界"
date: 2026-11-02
category: 后端
tags: [Python, http.server, SQLite, JavaScript]
description: "Python 标准库 http.server 的 handler 抛出未捕获异常时连接直接断开、前端毫无提示；附 NaN 变 null、or 1 吞掉 0、CSV 公式注入、删书丢历史借阅、重复借同一本和库存并发的复现与修复。"
---

我那个学习示例仓库里有个图书管理系统：后端是 Python 标准库 `http.server` + `sqlite3`，三个小项目共用一个几十行的 `web.py` 当"框架"，前端是原生 JS。之前写过同仓库座位预约的并发问题，这次回头翻图书管理这一个，起因很小：管理员改馆藏数量时，在弹框里填了"3本"，点确定以后页面什么反应都没有——没有"保存成功"，也没有报错。

顺着这个查下去，一共翻出来五个问题，有的是框架层的，有的是业务逻辑的。下面的输出都是我在本机跑出来的（Python 3.13.5，Node 20.19.2），用的是仓库当前的代码，服务以 `EDITION=pro` 启动。

## 一、一个 int() 报错，连接直接断开

先看前端改书的代码：

```js
for (const k of f) {
  const x = prompt(lab[k], b[k] ?? (k === 'total' ? 1 : ''))
  if (x === null) return
  o[k] = k === 'total' ? Number(x) : x
}
```

`Number('3本')` 是 `NaN`，而 `JSON.stringify({ total: NaN })` 得到的是 `{"total":null}`——JSON 里没有 NaN，序列化时会变成 null。

后端编辑接口这样取值：

```python
total = int(b.get('total', old['total']))
```

key 存在、值是 None，于是 `int(None)`，抛 `TypeError`。

问题在于框架的请求处理只接了自己定义的那一种异常：

```python
try:
    res = fn(self)
    ...
    return self._send(200, {'code': 0, 'data': res})
except HttpError as e:
    return self._send(e.status, {'code': e.status, 'message': e.msg})
```

`TypeError` 不是 `HttpError`，一路往上抛到 `socketserver`。标准库在这里的行为是：在终端打一段 traceback，然后把这个连接关掉。服务进程不会挂，下一个请求照常处理，但这一个请求**没有任何 HTTP 响应**，连 500 都没有。

用 curl 看是这样：

```
curl: (52) Empty reply from server
```

用 Python 的 `urllib` 发，拿到的是 `RemoteDisconnected`。我把三种请求放进复现脚本里，结果一样：

```
PUT  /api/books/2   {"total": null}  -> DISCONNECTED
POST /api/books     {"total": "abc"} -> DISCONNECTED
POST /api/register  []               -> DISCONNECTED
```

第三个是请求体不是对象的情况。`json.loads('[]')` 不会报错，得到一个 list，后面 `r.body.get(...)` 就是 `AttributeError`，同样断开。

### 前端为什么一声不吭

公共请求封装是这样写的：

```js
const r = await fetch(url, { ... })
const j = await r.json().catch(() => ({}))
if (j.code !== 0) { toast(j.message || '请求失败'); throw ... }
```

它只处理了"收到了响应、但 code 不是 0"的情况。连接被断开时，`fetch` 本身就会 reject 一个 `TypeError`，根本走不到 `toast` 那一行。调用方 `edit()` 里也没有 catch，于是这个错误变成一个未处理的 Promise rejection，只在控制台里出现，页面上什么都没有。

我在 Node 20 里用 vm 加载了仓库的 `common.js`，把 `toast` 换成记录函数，对着一个会断连接的服务发请求：原版 `API()` 以 `TypeError: fetch failed` 失败，`toast` 一次都没被调用。

### 改法

框架层兜底，是最该先做的：

```python
except HttpError as e:
    return self._send(e.status, {'code': e.status, 'message': e.msg})
except Exception:
    traceback.print_exc()
    return self._send(500, {'code': 500, 'message': '服务器内部错误'})
```

traceback 继续打在服务端终端里方便排查，客户端只拿到一句笼统的提示，不把异常细节暴露出去。我加了一个故意 `1/0` 的测试路由验证，返回的是 `500 {"code":500,"message":"服务器内部错误"}`。

请求体在解析完后加一行类型检查：

```python
if not isinstance(self.body, dict):
    return self._send(400, {'code': 400, 'message': '请求体必须是 JSON 对象'})
```

前端的 `fetch` 包一层 try/catch：

```js
let r
try { r = await fetch(url, { ... }) }
catch (e) { toast('网络错误或服务器无响应'); throw e }
```

只有兜底还不够。用户填错一个数字，看到的是"服务器内部错误"，还是不知道哪里填错了。所以我在 `web.py` 里加了一个取整数字段的小函数：

```python
def int_field(b, key, default=None, name=None):
    v = b.get(key, default)
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        raise HttpError(400, f'{name or key}必须是整数')
    try: f = float(v)
    except ValueError: raise HttpError(400, f'{name or key}必须是整数')
    if f != f or f % 1: raise HttpError(400, f'{name or key}必须是整数')
    return int(f)
```

几个细节：`bool` 在 Python 里是 `int` 的子类，`True` 会被当成 1，所以单独排除；`f != f` 是判断 NaN；`3.5` 这种带小数的也拒掉。改完以后，上面三个请求分别返回：

```
PUT  total=null -> 400 馆藏数量必须是整数
POST total=abc  -> 400 馆藏数量必须是整数
register []     -> 400 请求体必须是 JSON 对象
```

### 新增图书那边的另一个坑

新增接口写的是 `int(b.get('total') or 1)`。`or 1` 的本意是"没填就默认 1"，但它对 null 和 0 也生效：前端填"3本"传过来是 null，结果**静默建了一本馆藏为 1 的书**；管理员明确填 0（比如书还没到货），也会变成 1。这个没有报错，比断连接还难发现。改成 `int_field(b, 'total', 1, '馆藏数量')` 以后，只有字段缺失才用默认值，填了就按填的来，负数单独提示。

## 二、导出的 CSV 能被当成公式

借阅记录可以导出 CSV，里面有读者姓名。注册时姓名是用户自己填的，没有限制。我注册了一个姓名叫 `=1+1` 的账号借了本书，导出的那一行是：

```
4,机器学习实战,=1+1,2026-11-01,2026-12-01,,,0.0
```

用 LibreOffice 25.2 打开，这一格显示的是 `2`，也就是被当成公式算了。`=1+1` 只是演示，换成别的公式（比如带外部链接的）就是常说的 CSV 注入。Excel 我手头没有，没测，但业内的通行做法是一样的：以 `=`、`+`、`-`、`@`、制表符、回车开头的单元格，前面加一个单引号。

```python
def _csv_cell(v):
    return "'" + v if isinstance(v, str) and v[:1] in ('=', '+', '-', '@', '\t', '\r') else v
```

改完后导出的是 `'=1+1`，LibreOffice 里显示为文本 `'=1+1`。代价是单引号会作为字符显示出来，对这种导出给人看的场景我觉得可以接受。只处理字符串，数字列不受影响，所以负数金额之类不会被加引号。

## 三、删一本书，它的历史借阅一起"消失"

删除接口只拦了"还有未归还的借阅"：

```python
if c.execute('select 1 from loans where book_id=? and returned_at is null', ...).fetchone():
    raise HttpError(400, '该书还有未归还的借阅')
c.execute('delete from books where id=?', ...)
```

而借阅记录列表、统计、导出三处查询都是 `loans join books`，内连接。书删了，loans 表里的记录还在，但再也连不上，列表里就看不到了。复现里删掉一本已经全部归还的书之后，`/api/loans` 返回的条数从 4 变成 2。数据其实没丢，但对管理员来说等于"这本书从来没被借过"，统计和导出也一起少了。

两种改法：要么查询改成 `left join`，标题用 `coalesce(b.title, '(已删除)')` 兜一下；要么有借阅历史的书就不让删，改成把馆藏数量设为 0。我选了后者，改动小，也更符合图书馆的实际做法：

```python
if c.execute('select 1 from loans where book_id=?', ...).fetchone():
    raise HttpError(400, '该书有借阅历史，不能删除，可把馆藏数量改为 0')
```

## 四、同一本书可以借两本

借书时只检查了库存和"最多同时借 5 本"，没检查这个人是不是已经借着这本书。复现里同一个账号连续借同一本书两次，返回 `200 200`，库存也扣了两次。对一个演示项目来说不算大事，但一个读者占着同一本书的两本，大概率不是想要的。加一行：

```python
if c.execute('select 1 from loans where user_id=? and book_id=? and returned_at is null', ...).fetchone():
    raise HttpError(400, '这本书你已经借了，还没归还')
```

## 五、顺便：借书的库存也有并发问题

借书是"先查 available > 0，再插记录，再 `available-1`"，和之前座位预约是同一类先查再改的竞态。我用 20 个账号同时借一本馆藏 3 本的书，每次都用新建的库，跑了 5 次，成功次数在 6 到 14 次之间，`available` 最低到了 -11。

修法也一样，把判断和扣减合成一条带条件的 update，看影响行数：

```python
if c.execute('update books set available=available-1 where id=? and available>0',
             (b['id'],)).rowcount == 0:
    raise HttpError(400, '该书暂无库存')
c.execute('insert into loans(...) values(...)', ...)
```

改完后同样的脚本，成功 3 次，`available` 为 0。不过要说明，"同一本书借两本"那个检查仍然是先查再插，同一个人同时点两次理论上还能穿过去，要彻底挡住得在 loans 上加部分唯一索引，这次没做。

## 一个没改的地方：罚金按整天向下取整

高级版有逾期罚金，算法是：

```python
round(max(0, (end - l['due_at']) // DAY) * FINE_PER_DAY, 2)
```

`//` 是向下取整，所以逾期 1 小时、23 小时，罚金都是 0；25 小时、47 小时是 0.5；49 小时是 1.0。列表里状态已经显示"已逾期"，但罚金是 0。这算不上 bug，是规则怎么定的问题——很多图书馆就是"满一天才算"。如果想"不满一天按一天"，把 `//` 换成向上取整就行。我没改，只是记在这里，免得以后有人看到"已逾期 ¥0"以为是算错了。

## 小结

1. `http.server` 的 handler 里抛出未捕获的异常，客户端拿不到任何响应，只看到连接被断开。自己写框架时，最外层一定要有一个 `except Exception` 返回 500。
2. 前端的请求封装要同时处理"有响应但失败"和"根本没响应"两种情况，`fetch` 的网络错误是直接 reject 的。
3. `NaN` 经过 `JSON.stringify` 会变成 `null`，前端用 `Number()` 转用户输入时要先判断。
4. `x or default` 会把 0 也当成没填。
5. 导出给表格软件打开的 CSV，对用户可控的文本做公式前缀处理。
6. 列表查询用内连接时，删除主表记录要想清楚关联数据还看不看得到。

上面的改动我只在本地副本上做了验证，仓库里目前还是原来的代码。

仓库：https://github.com/MsNan/dev-learning-projects
