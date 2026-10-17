---
title: "「3 个工作日内发货」是哪天？用 JS 处理中国节假日调休"
date: 2026-10-17
category: 前端
tags: [JavaScript, 日期处理, MCP, AI, Node.js]
description: "法定节假日 + 调休上班日的工作日计算：数据结构、判断顺序、时区坑，以及把它封装成 MCP 工具让 Cursor / Claude 也能答对。"
---

前阵子给一个订单后台加"3 个工作日内发货"的截止日期提示，第一版我只用 `getDay()` 判断周末，测试的时候就翻车了：9 月 30 号下的单，按"跳过周六日"算出来是 10 月 5 号，可那几天整个国庆都在放假。

中国的工作日没法只靠星期几算，得同时处理两件事：**法定节假日放假**，和**调休上班**（比如 2026 年 10 月 10 号是周六，但要上班）。这篇记录一下我最后的写法，以及顺手把它封装成 MCP 给 AI 用的过程。

## 数据从哪来

每年国务院办公厅会发一份《关于 X 年部分节假日安排的通知》，一般在前一年 11 月前后。里面就两类信息：哪几段放假，哪几天周末要补班。我直接把它整理成静态数据，不调第三方接口，原因很简单：

- 一年就更新一次，没必要为它挂一个在线服务
- 第三方免费接口说停就停，订单系统不能跟着挂
- 离线数据可以写单测，结果可复现

2026 年的数据长这样：

```js
const HOLIDAYS_2026 = [
  { name: '元旦', start: '2026-01-01', end: '2026-01-03' },
  { name: '春节', start: '2026-02-15', end: '2026-02-23' },
  { name: '清明节', start: '2026-04-04', end: '2026-04-06' },
  { name: '劳动节', start: '2026-05-01', end: '2026-05-05' },
  { name: '端午节', start: '2026-06-19', end: '2026-06-21' },
  { name: '中秋节', start: '2026-09-25', end: '2026-09-27' },
  { name: '国庆节', start: '2026-10-01', end: '2026-10-07' },
]
// 调休上班日（周末但要上班）
const WORKDAYS_2026 = ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']
```

存区间而不是逐天列出来，是因为对照通知原文核对的时候一眼就能看出有没有录错。

## 判断某一天是什么类型

判断顺序很重要：**法定节假日 > 调休上班 > 周末 > 普通工作日**。

```js
const DAY = 864e5
// 统一用 UTC 处理日期，后面会说为什么
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const fmt = (d) => d.toISOString().slice(0, 10)

// 预先把放假区间展开成 Map，查询是 O(1)
const holidayMap = new Map()
for (const h of HOLIDAYS_2026) {
  for (let d = parse(h.start); fmt(d) <= h.end; d = new Date(d.getTime() + DAY)) {
    holidayMap.set(fmt(d), h.name)
  }
}
const workSet = new Set(WORKDAYS_2026)

function dayType(dateStr) {
  const d = parse(dateStr)
  const key = fmt(d)
  if (holidayMap.has(key)) return { type: '法定节假日', isWorkday: false, name: holidayMap.get(key) }
  if (workSet.has(key)) return { type: '调休上班', isWorkday: true }
  const wd = d.getUTCDay()
  if (wd === 0 || wd === 6) return { type: '周末', isWorkday: false }
  return { type: '工作日', isWorkday: true }
}

dayType('2026-10-10') // { type: '调休上班', isWorkday: true }
dayType('2026-10-03') // { type: '法定节假日', isWorkday: false, name: '国庆节' }
```

## 统计工作日 & 第 N 个工作日

有了 `dayType`，剩下两个常用需求就是循环：

```js
// [start, end] 闭区间内有几个工作日
function countWorkdays(start, end) {
  let n = 0
  for (let d = parse(start); d <= parse(end); d = new Date(d.getTime() + DAY)) {
    if (dayType(fmt(d)).isWorkday) n++
  }
  return n
}

// 从 start 往后数第 n 个工作日（不含当天）
function addWorkdays(start, n) {
  let d = parse(start)
  while (n > 0) {
    d = new Date(d.getTime() + DAY)
    if (dayType(fmt(d)).isWorkday) n--
  }
  return fmt(d)
}

countWorkdays('2026-10-01', '2026-10-31') // 18
addWorkdays('2026-09-30', 3)              // '2026-10-10'，正好落在调休的周六
```

回到开头的例子：9 月 30 号下单，3 个工作日是 10 月 8 号、9 号和 10 号（周六补班），截止日是 `2026-10-10`，而不是只跳周末算出来的 10 月 5 号。

## 踩过的几个坑

**1. 时区。** `new Date(2026, 9, 10)` 按本地时间创建，在东八区调用 `toISOString()` 会得到 `2026-10-09T16:00:00.000Z`，日期直接少一天。所以上面全程用 `Date.UTC` 创建、用 `getUTCDay()` 取星期，只在 UTC 里做日期运算，服务器和浏览器在哪个时区都不受影响。

**2. 下一年的数据还没公布。** 比如现在（2026 年 10 月）去算 2027 年元旦前后的工作日，通知还没出。这时候不要静默按周末算，最好在返回值里带一句提示，让调用方知道结果可能不准。

**3. "N 个工作日内"的口径。** 当天算不算第一天、下午 6 点后下单算不算当天，这是业务规则不是技术问题，写代码前先和产品对齐，然后在函数注释里写清楚。

**4. 每年记得更新数据。** 我在数据文件里留了来源链接和"待公布年份"列表，通知一出来对着改，再跑一遍单测。

## 顺手封装成 MCP，让 AI 也能答对

写完之后我发现另一个问题：在 Cursor 里问 AI"10 月 10 号上不上班"，它经常按周末回答。模型的知识有截止时间，当年的放假通知它多半不知道。

MCP（Model Context Protocol）正好解决这个：把函数注册成工具，AI 遇到相关问题会自己调用。用官方 SDK 注册一个工具大概是这样：

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'cn-holiday', version: '0.1.0' })

server.registerTool(
  'holiday_check',
  {
    title: '节假日/调休查询',
    description: '查询某天是法定节假日、调休上班、周末还是工作日',
    inputSchema: { date: z.string().describe('日期，格式 YYYY-MM-DD') },
  },
  async ({ date }) => ({
    content: [{ type: 'text', text: JSON.stringify(dayType(date)) }],
  }),
)

await server.connect(new StdioServerTransport())
```

`description` 要写清楚这个工具能回答什么问题，AI 是靠它来决定要不要调用的。配进 Cursor 的 `mcp.json` 之后，再问"9 月 30 号下单 3 个工作日内发货最晚哪天"，它会先调工具拿到 `2026-10-10` 再回答。

## 最后

我把节假日这部分和平时常用的几个小工具（身份证/统一信用代码校验、拼音、农历、行政区划、uni-app 文档速查）整理成了一个离线 MCP 工具集，数据都打包在里面，一行 `npx` 就能跑。只想要工作日计算的话，直接复制上面的代码也够用了。

有需要可以看看：[cn-dev-mcp](https://github.com/MsNan/cn-dev-mcp)
