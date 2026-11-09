---
title: "一份 JSON 生成增删改查接口，入参清洗漏了什么：Number(\" \") 是 0，搜 100% 把 1000 元券也搜出来"
date: 2026-11-09
category: 后端
tags: [Node.js, Express, SQLite, JavaScript]
description: "bishe-kit 通用 CRUD 复现：Number() 接受空格/0x1F/Infinity（库里存无穷大）、全空格过必填、日期不校验、LIKE 未转义 % 和 _、重复查询参数静默查空；附补丁。"
---

<div v-pre>

我的毕设脚手架 bishe-kit 有个偷懒的设计：在 `server/src/entities/` 下放一份 JSON，后端自动建表、生成权限码和 `/api/admin/<实体>` 的增删改查接口，后台自动出菜单和表格页。比如图书：

```json
{
  "name": "book", "label": "图书", "public": true,
  "fields": [
    { "name": "title", "label": "书名", "type": "string", "required": true, "search": true },
    { "name": "price", "label": "价格", "type": "number" },
    { "name": "stock", "label": "库存", "type": "int" },
    { "name": "publish_date", "label": "出版日期", "type": "date" }
  ]
}
```

所有实体共用一个 `clean()` 函数清洗入参，一个 `buildWhere()` 拼查询条件。这意味着这两个函数漏一个口子，所有生成出来的模块都漏。SQL 注入是早就防住的（字段名过正则白名单，值全部走占位符，测试里有 `' OR 1=1 --`），这次我想看的是更不起眼的地方：**值本身对不对**。

我用 supertest 直接打接口，存进去再读出来看实际落库的值。环境：Node 24.22.1，Express 5，sql.js（SQLite 的 WebAssembly 版），仓库 HEAD `3093142`。

## 原来的清洗逻辑

```js
function clean(entity, body, partial) {
  const out = {}
  for (const f of entity.fields) {
    let v = body?.[f.name]
    if (v === undefined) { if (!partial && f.required) throw new HttpError(400, `${f.label}不能为空`); continue }
    if (v === '' || v === null) { if (f.required) throw new HttpError(400, `${f.label}不能为空`); out[f.name] = null; continue }
    if (f.type === 'number' || f.type === 'int') {
      v = Number(v)
      if (Number.isNaN(v)) throw new HttpError(400, `${f.label}必须是数字`)
      if (f.type === 'int') v = Math.trunc(v)
    }
    else if (f.type === 'bool') v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0
    else { v = String(v); /* select 校验 options */ }
    out[f.name] = v
  }
  return out
}
```

看起来该有的都有：必填、数字、下拉选项。问题出在 `Number()`、`String()` 和"空"的判断上。

## 1. Number() 认得的写法比你想的多

`Number.isNaN` 只能拦住 `'abc'` 这种完全不像数字的输入。下面这些都能过，括号里是读回来的值：

```text
price=" "         → 200，存成 0
price="\t"        → 200，存成 0
price="0x1F"      → 200，存成 31
price="1e3"       → 200，存成 1000
price=[5]         → 200，存成 5
price=true        → 200，存成 1
price="Infinity"  → 200，读回来是 null
price="1e400"     → 200，读回来是 null
```

空格变 0 最麻烦：后台表单里价格框不小心敲了个空格，保存后价格不是"未填"而是 0 元，列表里看着就像免费。

`Infinity` 那一行更隐蔽。接口读回来是 `null`，看着像没存进去，但我直接查库：

```text
{ price: Infinity, typeof: 'real' }
SELECT SUM(price), AVG(price) → { s: Infinity, a: Infinity }
```

库里存的是真正的无穷大，只是 `JSON.stringify(Infinity)` 输出 `null`，所以接口层看不出来。一条这样的记录，会让所有求和、平均的统计都变成 Infinity。`1e400` 超出 double 范围，`Number('1e400')` 也是 Infinity，同一个问题。

`int` 字段也一样：`1e21` 能通过，`Math.trunc` 之后还是 `1e21`，存进 INTEGER 列，`typeof()` 查出来是 `real`。

## 2. 必填字符串：全是空格也算填了

```text
title="   "      → 200，存成 "   "
title="　"       → 200（一个全角空格）
title={"a":1}    → 200，存成 "[object Object]"
title=["a","b"]  → 200，存成 "a,b"
```

必填判断只比较 `v === ''`，几个空格就绕过去了。全角空格 `\u3000` 在中文输入法下很容易打出来。对象和数组被 `String()` 悄悄转成字符串，库里多出 `[object Object]` 这种书名，后台表格里看到会很懵。正常前端不会这么传，但接口不能指望调用方都是自己的前端。

## 3. 日期字段等于没校验

`date` 类型走的是最后那个 `String(v)` 分支：

```text
publish_date="abc"         → 200
publish_date="2026-02-30"  → 200
publish_date="2026/1/5"    → 200
```

后台的 `el-date-picker` 用 `value-format="YYYY-MM-DD"`，正常提交不会出错。但只要有一条 `2026/1/5` 混进去，按日期排序、按月统计（`substr(publish_date,1,7)`）就会出错，而且这种数据是事后最难查的。

## 4. 搜索框里的 % 和 _ 是通配符

关键字搜索是这么拼的：

```js
where.push('(' + searchable.map((f) => `${f.name} LIKE ?`).join(' OR ') + ')')
args.push(`%${kw}%`)
```

值走了占位符，所以不是注入，但用户输入的 `%` 和 `_` 在 LIKE 里仍然是通配符。我插了四本书：`100%纯棉T恤`、`1000元优惠券`、`a_b 手册`、`axb 手册`，然后搜：

```text
keyword=100%   → ["1000元优惠券","100%纯棉T恤"]
keyword=a_b    → ["axb 手册","a_b 手册","a,b"]
keyword=%      → 命中 29 条（表里一共 29 条）
keyword=_      → 命中 29 条
```

搜 `100%` 把 1000 元券也搜出来了，因为 `%` 匹配任意字符；搜 `a_b` 时 `_` 匹配任意一个字符，连上面那条被转成 `a,b` 的书名都搜出来了。商品名带百分号、文件名带下划线都很常见，这不是凭空构造的场景。

修法是转义后加 `ESCAPE`：

```js
export function escapeLike(s) { return s.replace(/[\\%_]/g, (c) => '\\' + c) }

`${f.name} LIKE ? ESCAPE '\\'`   // 模板字符串里写两个反斜杠，SQL 里是一个
args.push(`%${escapeLike(kw)}%`)
```

注意反斜杠本身也要转义，否则用户搜 `\` 会把后面的字符吃掉。

## 5. 重复的查询参数：不报错，只是查不到

列表接口支持按字段精确筛选，`?stock=3` 会拼成 `stock = ?`。Express 5 默认的查询解析器遇到重复参数会给数组：

```text
GET /api/admin/book?stock=3&stock=4   → 200，total 0
GET /api/book?title=t&title=x         → 200，total 0（公开接口也一样）
```

数组被直接当成占位符的值。sql.js 绑定参数时会把数组当成 BLOB 处理，于是条件变成"stock 等于某个二进制串"，永远查不到，接口照样返回 200。前端拼参数时手滑拼了两次，你只会看到"列表空了"，不会看到任何报错。这里直接返回 400 比静默返回空结果好查得多。

## 改法：只认十进制写法，空白算空，日期要真实存在

补丁只改 `clean()` 和 `buildWhere()` 两个函数，核心是这几行：

```js
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/

// 非 text 字段先 trim（String.prototype.trim 会去掉全角空格 \u3000）
if (typeof v === 'string' && f.type !== 'text') v = v.trim()
if (v === '' || v === null) { /* 必填报错，否则存 null */ }
if (typeof v === 'object') throw new HttpError(400, `${f.label}格式不正确`)

if (f.type === 'number' || f.type === 'int') {
  if (typeof v === 'boolean' || (typeof v === 'string' && !NUM_RE.test(v)))
    throw new HttpError(400, `${f.label}必须是数字`)
  v = Number(v)
  if (!Number.isFinite(v)) throw new HttpError(400, `${f.label}必须是数字`)
  if (f.type === 'int') {
    v = Math.trunc(v)
    if (!Number.isSafeInteger(v)) throw new HttpError(400, `${f.label}超出整数范围`)
  }
}
else if (f.type === 'date') {
  v = String(v)
  if (!isRealDate(v)) throw new HttpError(400, `${f.label}必须是 YYYY-MM-DD 格式的有效日期`)
}
```

`isRealDate` 先用正则卡 `YYYY-MM-DD`，再用 `Date.UTC` 构造一次、把年月日读回来比对，`2026-02-30` 会被构造成 3 月 2 日，比对不上就拒绝；`2024-02-29` 能过。

几个取舍说明一下：

- **`text` 类型不 trim。** 简介、正文这类长文本，开头的缩进可能是有意的；其他字段的首尾空格基本都是误输入。这个改动会改变落库的值（`" 12.5 "` 现在存成 12.5），算是行为变化，合并前要想清楚。
- **`int` 仍然截断小数。** 原有测试里 `stock: 3.7` 期望存成 3，我没改这个行为。要严格的话可以改成 `Number.isInteger` 不通过就报错。
- **负数没拦。** `stock=-5` 照样能存。库存不能为负是业务规则，不是"格式"，更适合在实体 JSON 里加 `min` 配置去做，这次没加。
- **数字只认十进制。** `1e3` 这种科学计数法也拒了。后台表单不会有人这么填，宁可严一点。

改完再跑一遍复现脚本：

```text
price=" "         → 200，存成 null（不再是 0）
price="0x1F"      → 400 价格必须是数字
price="Infinity"  → 400 价格必须是数字
price=[5]         → 400 价格格式不正确
stock=1e21        → 400 库存超出整数范围
title="   "       → 400 书名不能为空
title="　"        → 400 书名不能为空
publish_date="2026-02-30" → 400
keyword=100%      → ["100%纯棉T恤"]
keyword=a_b       → ["a_b 手册"]
?stock=3&stock=4  → 400 筛选参数 stock 只能出现一次
```

原有 13 条测试加 1 条新用例，14 条全绿。补丁还没合进仓库。

## 小结

这类"一份配置生成所有接口"的写法，好处是加一个模块只要几分钟，代价是公共函数里的每个疏忽都会被乘以实体数量。这次查出来的问题都不是什么高深漏洞，就是 JavaScript 的类型转换比直觉宽松：`Number(' ')` 是 0，`Number('0x1F')` 是 31，`String({})` 是 `[object Object]`，LIKE 里 `%` 不是百分号。写通用清洗函数时，与其想"怎么把输入转成我要的类型"，不如先想"哪些输入我根本不该接受"。

仓库：https://github.com/MsNan/bishe-kit

</div>
