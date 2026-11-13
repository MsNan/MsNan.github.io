---
title: "不传 day 参数，座位图显示全空：用 Python 标准库手写 Web 框架，请求到业务代码前的 5 个细节"
date: 2026-11-13
category: 后端
tags: [Python, http.server, 后端, Web 安全]
description: "dev-learning-projects 共用的标准库 Web 框架：parse_qs 丢空值导致座位图全空、float() 接受 1_000 和 True、静态文件 startswith 前缀判断、中文 Content-Disposition 断连、方法不对返回 404。"
---

<div v-pre>

dev-learning-projects 里有三个练手项目：图书管理、座位预约、电影推荐。它们共用一个 `common/web.py`，只靠标准库 `http.server`，路由、JSON 读写、静态文件、token 登录一共一百来行。之前写过这几个项目的并发预约和异常断连，这次专门看这一百来行本身：请求在到达业务函数之前，经过了哪些处理。

我起了一个只挂演示路由的服务，用 Node 的 `http.request` 按原样发请求（`fetch` 会把路径里的 `..` 规范化掉）。复现脚本、补丁和下面的输出都对应仓库 02cedd4，Python 3.13。

## 一、查询串：空值的键会整个消失

```python
u = urlparse(self.path); self.query = {k: v[0] for k, v in parse_qs(u.query).items()}
```

`parse_qs` 默认 `keep_blank_values=False`，`?day=&slot=` 解析出来是空字典。座位预约的查座接口是这样写的：

```python
day, slot = r.query.get('day'), int(r.query.get('slot', 0))
```

于是：

```text
?day=2026-11-12&slot=0  → ["1-4", "1-7", "2-6", "3-3"]
?day=2026-11-12&slot=   → ["1-4", "1-7", "2-6", "3-3"]   ← slot 没传，按 0（08:00-12:00）算了
?slot=1（没有 day）      → []                             ← day 是 None
```

第二行，前端某个分支漏传了时段，后端不报错，返回的是上午的座位。第三行更隐蔽：`day=None` 进 SQL 变成 `day = NULL`，这个条件永远不成立，返回空列表。前端只要有一次漏传 day，用户看到的就是一张全空的座位图，接口还返回 200。

同一行还有两个行为要知道：

```text
?q=C++（没编码）               → "C  "
?q=C%2B%2B（encodeURIComponent）→ "C++"
?slot=2&slot=0                  → 取 "2"，第二个被丢掉
```

前端这几个项目都用了 `encodeURIComponent`，所以 `+` 没出过问题，但手写测试用例或用 curl 调接口时容易踩到。

改法分两步：解析时加上 `keep_blank_values=True`，让"传了空值"和"没传"能区分开；接口自己校验必填参数，不要给默认值：

```python
day, slot = r.query.get('day', ''), r.query.get('slot', '')
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) or not slot.isdigit(): raise HttpError(400, '请选择日期和时段')
```

注意这两步必须一起改。只打开 `keep_blank_values`，`int(r.query.get('slot', 0))` 会拿到 `''`，`int('')` 抛 `ValueError`，在这个框架里会直接断开连接，比原来还糟。我在复现里专门跑了这一种，确实是 `ECONNRESET`。

## 二、金额：JSON 和 float() 都比你想的宽松

打赏接口的校验：

```python
try: amt = round(float(b.get('amount', 0)), 2)
except ValueError: raise HttpError(400, '金额不正确')
if not 0 < amt <= 10000: raise HttpError(400, '金额不正确')
```

一组输入跑下来：

```text
amount: "1_000"  → 200   float("1_000") == 1000.0
amount: true     → 200   float(True) == 1.0，记录里多了一条 1.0 元
amount: " 8 "    → 200
amount: NaN      → 400
amount: 1e999    → 400
amount: [1]      → 连接断开：ECONNRESET（TypeError，不是 ValueError）
```

几个容易忽略的点：

- Python 3.6 起数字字符串可以带下划线，`float("1_000")` 是一千。
- `json.loads` 默认接受 `NaN`、`Infinity`，`1e999` 会解析成 `inf`。这里 `NaN` 和 `inf` 碰巧被 `0 < amt <= 10000` 拦住了：NaN 的任何比较都是 False，`round(inf, 2)` 返回 inf 而不是抛异常。我原本以为 `round` 会抛 `OverflowError`，实测不会（不带位数的 `round(inf)` 才会），这条得靠比较兜底。
- `bool` 是 `int` 的子类，`true` 一路畅通。
- 传列表时 `float()` 抛的是 `TypeError`，`except ValueError` 接不住。

补丁的写法是"白名单"：类型只认数字和字符串（排除 bool），字符串必须是 `\d+(\.\d{1,2})?`，用 `Decimal` 比较范围；`json.loads` 加 `parse_constant` 直接拒绝 NaN/Infinity，顺便要求请求体必须是 JSON 对象（以前传 `[]`，`r.body.get` 会抛 AttributeError）。

```python
def parse_amount(v, lo=Decimal('0.01'), hi=Decimal('10000')):
    if isinstance(v, bool) or not isinstance(v, (int, float, str)): raise HttpError(400, '金额不正确')
    s = (repr(v) if isinstance(v, float) else str(v)).strip()
    if not re.fullmatch(r'\d+(\.\d{1,2})?', s): raise HttpError(400, '金额不正确')
    d = Decimal(s)
    if not lo <= d <= hi: raise HttpError(400, '金额不正确')
    return float(d)
```

这里有个行为变化：以前 `8.888` 会被四舍五入成 8.89 后接受，现在直接拒绝。金额这种东西，我倾向于让前端改输入，而不是后端悄悄帮你改数字。

## 三、静态文件：startswith 判断目录，同前缀的兄弟目录能读

```python
f = os.path.realpath(os.path.join(base, p))
if not f.startswith(os.path.realpath(base)) or not os.path.isfile(f): return self._send(404, ...)
```

`realpath` 之后再判断前缀，思路是对的，但字符串前缀不等于目录包含：`/x/static-old/secret.txt` 也以 `/x/static` 开头。我在演示目录里放了一个 `static-old`：

```text
/index.html                → 200
/../demo.py                → 404
/../static-old/secret.txt  → 200 SECRET: 不该被访问到的旧目录
```

浏览器和 `fetch` 会把 `..` 规范化掉，但 curl 加 `--path-as-is`、或者直接写 socket，路径会原样到达 `http.server`。现在三个项目的 `static` 旁边都没有以 static 开头的东西，所以眼下读不到；但哪天有人顺手 `cp -r static static-bak`，这个目录就能被读到了。

改成按路径组件比较：

```python
root = os.path.realpath(base); f = os.path.realpath(os.path.join(root, p))
if os.path.commonpath([root, f]) != root or not os.path.isfile(f): ...
```

## 四、下载文件名换成中文，连接直接断开

导出接口返回 `('file', bytes, ctype, filename)`，框架拼响应头：

```python
{'Content-Disposition': f'attachment; filename={res[3]}'}
```

图书导出现在用的是 `loans.csv`，没问题。我把文件名改成 `借阅记录.csv` 试了一下：

```text
?name=loans.csv     → 200
?name=借阅记录.csv   → 连接断开：ECONNRESET
UnicodeEncodeError: 'latin-1' codec can't encode characters in position 42-45
```

`http.server` 的 `send_header` 用 latin-1 编码响应头，中文直接抛异常。毕设项目改成中文文件名的概率很高，这个坑值得提前填上。标准做法是 RFC 5987 的 `filename*`，再给一个 ASCII 兜底名：

```python
ascii_name = re.sub(r'[^A-Za-z0-9._-]', '_', filename).strip('_') or 'download'
return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
```

## 顺带：方法不对时返回 404

只注册了 POST 的 `/api/login`，用 GET 访问返回"接口不存在"，排查时会先去查路径拼写。补丁在路径匹配上、方法不对时返回 405 并带 `Allow` 头。HEAD/OPTIONS 由 `http.server` 返回 501，同源项目用不到预检，没动。

## 补丁和验证

补丁改了 `common/web.py`，以及座位预约的查座接口（必填校验）。改完重新跑复现：`1_000`、`true`、`[1]` 返回 400，NaN/Infinity 返回"JSON 格式错误"，`static-old` 返回 404，中文文件名返回 200，GET 登录返回 405；真实的座位预约项目里，缺 day 或 slot 返回 400，正常请求结果不变。补丁还没合进仓库。

## 小结

- `parse_qs` 默认丢空值，"没传"和"传了空"要不要区分，得自己决定，再配合接口校验一起改。
- 解析数字别只靠 `float()` 加 `except ValueError`：下划线、bool、NaN、列表各有各的走法。
- 判断路径是否在某个目录下，用 `commonpath`，不要用字符串前缀。
- 响应头只能放 latin-1，中文文件名用 `filename*`。

仓库：https://github.com/MsNan/dev-learning-projects

</div>
