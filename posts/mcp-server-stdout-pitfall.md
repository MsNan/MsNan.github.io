---
title: "写 MCP 服务器踩的坑：stdout 是协议通道，一行不带换行的日志就能让客户端超时"
date: 2026-10-22
category: 后端
tags: [MCP, Node.js, AI, 测试]
description: "实测 stdio 传输下 stdout 混入日志的后果：整行被跳过、不带换行则超时；dotenv 17 也会写 stdout。附守门测试、zod 校验错误格式与 Inspector CLI。"
---

我写过一个离线的 MCP 服务器 cn-dev-mcp，里面是 13 个面向国内开发的小工具：节假日调休、工作日计算、身份证/信用代码格式校验、拼音、农历之类，用 Node + 官方 TypeScript SDK 写的，走 stdio，给 Cursor、Claude Code 这些客户端用。

工具本身的逻辑都不复杂，真正花时间的是"服务器和客户端之间到底发生了什么"。这篇把 stdio 传输最容易踩的坑记下来：stdout 只能留给协议。顺带说说参数校验失败时客户端到底收到什么，以及不开任何 AI 客户端怎么测。

环境：Node 20.19.2，`@modelcontextprotocol/sdk` 1.32.1，`zod` 4.6.7。下面所有输出都是我在这台机器上实际跑出来的。

## stdio 传输就是"一行一个 JSON"

先不用任何客户端，直接用 `printf` 往服务器的 stdin 里塞三行 JSON-RPC：初始化、初始化完成通知、调用一个工具。

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"shell","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"workday_add","arguments":{"date":"2026-09-30","n":3}}}' \
  | node dist/index.js
```

```
cn-dev-mcp v0.1.0 已启动（stdio）
{"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"cn-dev-mcp","version":"0.1.0"}},"jsonrpc":"2.0","id":1}
{"result":{"content":[{"type":"text","text":"{\n  \"from\": \"2026-09-30\",\n  \"n\": 3,\n  \"result\": \"2026-10-10\",\n  \"weekday\": \"周六\",\n  \"notes\": []\n}"}]},"jsonrpc":"2.0","id":2}
```

（9 月 30 日之后的第 3 个工作日是 10 月 10 日周六，因为那天是国庆调休上班。）

第一行"已启动"是我写到 stderr 的，终端里两个流混在一起显示。加上 `2>/dev/null` 就只剩两行 JSON。这就是 stdio 传输的全部：客户端把服务器当子进程启动，往 stdin 写，从 stdout 读，每条消息是一行 JSON，用换行分隔。

看 SDK 的源码也是这么实现的，`shared/stdio.js` 里的 `ReadBuffer`：

```js
readMessage() {
    ...
    const index = this._buffer.indexOf('\n');
    if (index === -1) {
        return null;
    }
    const line = this._buffer.toString('utf8', 0, index).replace(/\r$/, '');
    this._buffer = this._buffer.subarray(index + 1);
    return deserializeMessage(line);
}
// deserializeMessage(line) = JSONRPCMessageSchema.parse(JSON.parse(line))
```

按换行切，每一段 `JSON.parse` 再用 schema 校验。所以 stdout 上出现任何不是 JSON-RPC 的东西，都会进到这个解析流程里。

## 实验：往 stdout 打一行日志会怎样

入口文件原来是这样的：

```js
const server = createServer()
await server.connect(new StdioServerTransport())
console.error(`cn-dev-mcp v${VERSION} 已启动（stdio）`)
```

为了观察，我写了个小脚本，用 SDK 自带的 `Client` 连服务器，挂上 `onerror`，超时设成 5 秒：

```js
// call2.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const [, , entry] = process.argv
const client = new Client({ name: 'call', version: '0' })
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'ignore' })
client.onerror = (e) => console.log('onerror:', e.message.split('\n')[0])
const t0 = Date.now()
try {
  await client.connect(transport, { timeout: 5000 })
  const r = await client.callTool({ name: 'holiday_check', arguments: { date: '2026-10-01' } })
  console.log('调用成功：', JSON.parse(r.content[0].text).holiday)
} catch (e) {
  console.log('失败：', e.message, `（${Date.now() - t0}ms）`)
}
await client.close()
```

做了两个坏版本：

- `index-bad.js`：把最后一行 `console.error` 改成 `console.log`。
- `index-bad2.js`：在 `createServer()` 前面加一句 `process.stdout.write("[debug] loading holidays... ")`，不带换行，模拟那种"打个进度、后面再补结果"的写法。

```bash
node call2.mjs dist/index-bad.js
node call2.mjs dist/index-bad2.js
node call2.mjs dist/index.js
```

```
== console.log 一整行
onerror: Unexpected token 'c', "cn-dev-mcp"... is not valid JSON
调用成功： 国庆节
== stdout.write 不带换行
onerror: Unexpected token 'd', "[debug] loa"... is not valid JSON
失败： MCP error -32001: Request timed out （5011ms）
== 正常
调用成功： 国庆节
```

第一种情况，SDK 的客户端把那一行当成解析错误交给 `onerror`，然后跳过，后面的消息照常处理，所以调用还是成功了。这其实是 TypeScript SDK 客户端比较宽容；别的客户端遇到非法行怎么处理，我手上没法一一验证，不建议赌。

第二种情况才是真正要命的：没有换行的日志会和下一条消息拼在同一行里。服务器对 `initialize` 的回复变成了 `[debug] loading holidays... {"result":...}`，整行解析失败被丢掉，客户端永远等不到初始化的响应，5 秒后超时。服务器进程本身没有报错，也没有退出，从服务器这边看一切正常。

用官方的 Inspector 命令行连这个坏版本，现象一样，只是它的默认连接超时是 15 秒：

```bash
npx -y @modelcontextprotocol/inspector@2.12.0 --cli node dist/index-bad2.js --method tools/list
```

```
cn-dev-mcp v0.1.0 已启动（stdio）
{"error":{"code":"unreachable","message":"Connection timed out after 15000 ms. To accommodate a slower server, pass a larger --connect-timeout <ms>, or set connectionTimeout on the server's catalog or config entry."}}
```

如果在 AI 客户端里遇到"MCP 服务一直连不上 / 工具列表是空的 / 超时"，而服务器单独跑又没报错，第一件事就是看它的 stdout 里有没有混进别的东西。

## 不是你写的 console.log 也会污染

自己代码里的 `console.log` 好找，依赖库往 stdout 打字就比较隐蔽。一个我实际验证过的例子是 dotenv 17：

```bash
npm i dotenv@17
echo "A=1" > .env
node -e 'require("dotenv").config()' > out.txt 2> err.txt
echo stdout:; cat out.txt; echo stderr:; cat err.txt
```

```
stdout:
◇ injected env (1) from .env // tip: ⌘ suppress logs { quiet: true }
stderr:
```

这条提示走的是 stdout（版本 17.4.2）。如果 MCP 服务器里用了 dotenv 而没加 `{ quiet: true }`，启动时 stdout 上就会多出这一行。按上面的实验，它是独立的一行，TS SDK 客户端会跳过；但这依赖客户端的容错，加上 `quiet: true` 后输出是 0 字节：

```bash
node -e 'require("dotenv").config({quiet:true})' | wc -c
```

```
0
```

我自己的规则是：

1. 服务器进程里所有日志都走 `console.error` 或 `process.stderr.write`。客户端一般会把 stderr 收进它自己的日志，不会当协议解析。
2. 只有在 `connect` 之前就退出的分支可以用 stdout，比如 `--version`：

```js
if (process.argv.includes('--version')) { console.log(VERSION); process.exit(0) }
```

```bash
node dist/index.js --version
```

```
0.1.0
```

3. 引入新依赖后跑一遍下面的守门测试。

## 写一个"stdout 只有 JSON-RPC"的守门测试

规则靠自觉不靠谱，我加了一个用 `node:test` 写的测试：启动服务器，发几条请求，然后检查 stdout 上的每一行都能 `JSON.parse`，并且三个请求的响应都在。

```js
// test/stdout.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const ENTRY = process.env.MCP_ENTRY ?? 'dist/index.js'

test('stdout 只输出 JSON-RPC', async () => {
  const p = spawn(process.execPath, [ENTRY], { stdio: ['pipe', 'pipe', 'ignore'] })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  const send = (m) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
  send({ method: 'notifications/initialized' })
  send({ id: 2, method: 'tools/list' })
  send({ id: 3, method: 'tools/call', params: { name: 'holiday_check', arguments: { date: '2026-10-01' } } })
  await new Promise((r) => setTimeout(r, 1000))
  p.kill()
  const lines = out.split('\n').filter(Boolean)
  for (const line of lines) {
    let msg
    assert.doesNotThrow(() => (msg = JSON.parse(line)), `不是 JSON：${line.slice(0, 60)}`)
    assert.equal(msg.jsonrpc, '2.0')
  }
  assert.deepEqual(lines.map((l) => JSON.parse(l).id).sort(), [1, 2, 3])
})
```

对正常版本和两个坏版本各跑一次（下面是三次输出的摘录，用 --- 隔开）：

```bash
node --test test/stdout.test.js
MCP_ENTRY=dist/index-bad.js node --test test/stdout.test.js
MCP_ENTRY=dist/index-bad2.js node --test test/stdout.test.js
```

```
# pass 1
# fail 0
---
    Got unwanted exception: 不是 JSON：cn-dev-mcp v0.1.0 已启动（stdio）
# pass 0
# fail 1
---
    Got unwanted exception: 不是 JSON：[debug] loading holidays... {"result":{"protocolVersion":"20
# pass 0
# fail 1
```

两个坏版本都能被抓出来，而且失败信息直接告诉你是哪一行。等 1 秒的写法比较粗糙，但对这种冒烟测试够用。

## 参数校验失败，客户端收到的是什么

工具参数用 zod 定义，SDK 会把它转成 JSON Schema 放进 `tools/list`。我的写法：

```ts
const DATE = z.string().describe('日期，格式 YYYY-MM-DD')
s.registerTool('workday_add', {
  title: '第 N 个工作日',
  description: '计算某日期之后（n 为负数则之前）的第 n 个工作日……',
  inputSchema: { date: DATE, n: z.number().int().describe('工作日数，可为负') },
}, wrap(({ date, n }) => addWorkdays(date, n)))
```

`tools/list` 里实际给到客户端的（节选）：

```json
"inputSchema": {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "date": { "type": "string", "description": "日期，格式 YYYY-MM-DD" },
    "n": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991,
      "description": "工作日数，可为负"
    }
  },
  "required": ["date", "n"]
}
```

`.describe()` 的内容就是模型看到的参数说明，值得认真写。`z.number().int()` 会变成 `integer` 加安全整数范围。

然后故意传错参数，一次发 5 个调用（`2>/dev/null` 只看 stdout）：

```
{"result":{"content":[{"type":"text","text":"MCP error -32602: Tool no_such_tool not found"}],"isError":true},"jsonrpc":"2.0","id":6}
{"result":{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool holiday_check: Invalid input: expected string, received number at date"}],"isError":true},"jsonrpc":"2.0","id":3}
{"result":{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool holiday_check: Invalid input: expected string, received undefined at date"}],"isError":true},"jsonrpc":"2.0","id":4}
{"result":{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool workday_add: Invalid input: expected int, received number at n"}],"isError":true},"jsonrpc":"2.0","id":7}
{"result":{"content":[{"type":"text","text":"错误：无效日期：2026-13-01"}],"isError":true},"jsonrpc":"2.0","id":5}
```

分别是：调用不存在的工具（id 6）、`date` 传数字（id 3）、不传 `date`（id 4）、`n` 传 1.5（id 7）、`date` 传 `2026-13-01`（id 5）。

有三点我之前没注意到：

1. 在这个 SDK 版本里，参数校验失败和工具不存在都不是 JSON-RPC 的 `error` 响应，而是一个正常的 `result`，带 `isError: true`，错误码写在文本里。好处是模型能看到这段文字，有机会自己改参数重试。
2. `2026-13-01` 能通过 zod（它只是个字符串），是在我的业务函数里抛出的错误，被我自己写的 `wrap` 包成了同样的 `isError` 格式：

```ts
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => {
  try { return ok(await fn(a)) }
  catch (e: any) { return { isError: true, content: [{ type: 'text' as const, text: '错误：' + (e?.message ?? String(e)) }] } }
}
```

如果不包这一层，业务异常会变成什么样取决于 SDK 的处理，错误信息也不一定是中文，所以我统一自己包。

3. 响应顺序和请求顺序不一致，id 6 比 id 3 先回来。stdio 上的消息只按 id 对应，测试和自己写的客户端都不能假设顺序。

日期我在 zod 里只写了 `z.string()`，没加正则，格式检查放在业务函数里，所以 `2026-10-1`、前面带空格的 ` 2026-10-01` 都会被正常解析成 10 月 1 日，`2026/10/01` 则返回"日期格式应为 YYYY-MM-DD"。这是有意宽松的写法：模型偶尔会少写一个 0，没必要因此失败。如果你希望在 schema 里就把格式告诉模型，可以用 `z.string().regex(...)`，代价是这类输入直接被拒。

## 不开 AI 客户端怎么测

**Inspector 命令行。** 不用打开网页界面，一条命令列出工具或调用工具：

```bash
npx -y @modelcontextprotocol/inspector@2.12.0 --cli node dist/index.js \
  --method tools/call --tool-name workday_add \
  --tool-arg date=2026-09-30 --tool-arg n=3
```

```
cn-dev-mcp v0.1.0 已启动（stdio）
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"from\": \"2026-09-30\",\n  \"n\": 3,\n  \"result\": \"2026-10-10\",\n  \"weekday\": \"周六\",\n  \"notes\": []\n}"
    }
  ]
}
```

`--tool-arg n=3` 被当成数字传了过去，没有触发上面那种"expected int"的错误。注意 2.12.0 版本的 `engines` 要求 Node >= 22.19.0，我在 Node 20 上跑会打一串 `EBADENGINE` 警告，但这几条命令都能正常出结果；遇到问题先换 Node 22 再说。

**用 SDK 的 Client 写进 `node:test`。** 仓库里的冒烟测试就是这么写的：通过 stdio 启动 `dist/index.js`，先断言工具列表，再把 13 个工具各调一遍，最后确认非法日期会返回 `isError`：

```js
const client = new Client({ name: 'smoke', version: '1.0.0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], stderr: 'ignore' }))
const { tools } = await client.listTools()
// ...逐个 callTool，断言 !r.isError，并且 content[0].text 能 JSON.parse
const bad = await client.callTool({ name: 'holiday_check', arguments: { date: '2026-13-01' } })
assert.equal(bad.isError, true)
await client.close()
```

```bash
npm test
```

```
# tests 11
# pass 11
# fail 0
```

这里有个要注意的地方：这个测试连的是 SDK 的客户端，它会跳过 stdout 上的非法行，所以 `console.log` 一整行的那种污染它是测不出来的，这也是我另外加 stdout 守门测试的原因。

## 小结

1. stdio 传输里 stdout 是协议通道，日志一律走 stderr；`--version` 这类在连接前就退出的分支除外。
2. 不带换行的输出最危险，会把下一条 JSON 拼坏，表现为客户端超时、服务器无报错。
3. 依赖库也可能写 stdout（dotenv 17 默认就会），加依赖后跑一遍"每行都是 JSON"的测试。
4. `.describe()` 就是模型看到的参数文档；参数校验失败和业务错误都以 `isError` 结果返回，业务错误自己包一层保证格式一致。
5. 响应可能乱序，按 id 对应。
6. 测试分两层：Inspector CLI 手动点查，SDK Client + `node:test` 做自动化，再加一个直接读原始 stdout 的测试。

完整代码在 https://github.com/MsNan/cn-dev-mcp
