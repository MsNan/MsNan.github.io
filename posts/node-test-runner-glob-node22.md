---
title: "Node 22 下 node --test test/ 报 MODULE_NOT_FOUND：内置测试运行器的文件匹配规则"
date: 2026-10-20
category: 后端
tags: [Node.js, 测试, GitHub Actions]
description: "Node 21 起 node --test 的参数改成 glob，传目录会被当成文件执行。用 20/22/24 实测复现与修复，默认匹配规则、引号、零测试退出码、进程隔离和 CI 矩阵的几个坑。"
---

前两天给一个 Express + SQLite 的后端加 GitHub Actions，矩阵配了 Node 20 和 22 两个版本。本地我一直用的是 Node 20.19.2，`npm test` 五个用例全绿，推上去以后第一次 CI 却是红的：`server (22)` 这个 job 失败，`server (20)` 显示的是 cancelled，连跑都没跑完。

测试脚本只有一行：

```json
"scripts": {
  "test": "node --test test/"
}
```

Node 20 已经在今年 4 月底停止维护了，这个项目迟早要切到 22 或 24，所以 CI 里加 22 本来就是为了提前暴露这类问题，只是没想到第一次就撞上了。查下来是 Node 21 改了 `node --test` 对参数的解释方式。改法很简单，去掉 `test/` 就行，但顺着这个问题把内置测试运行器的文件匹配规则重新过了一遍，发现还有几个不太显眼的坑，记在这里。

## 先在本地复现

我不想为了这个装 nvm，直接从 Node 官网的发布目录下了 22 的 linux-x64 二进制包，对照同目录下的 `SHASUMS256.txt` 校验完，解压到 `/tmp` 就能用，不影响系统里的 Node 20：

```bash
cd /tmp
sha256sum -c SHASUMS256.txt --ignore-missing
tar xf node-v22.23.3-linux-x64.tar.xz
N22=/tmp/node-v22.23.3-linux-x64/bin/node
$N22 -v   # v22.23.3
```

然后在 server 目录下用两个版本分别跑同一条命令。Node 20：

```
$ node --test test/
...
1..5
# tests 5
# pass 5
# fail 0
```

Node 22：

```
$ $N22 --test test/
TAP version 13
# node:internal/modules/cjs/loader:1433
#   throw err;
#   ^
# Error: Cannot find module '/workspace/bishe-kit/server/test'
#     at Function._resolveFilename (node:internal/modules/cjs/loader:1430:15)
#     ...
#   code: 'MODULE_NOT_FOUND',
#   requireStack: []
# }
# Node.js v22.23.3
# Subtest: test
not ok 1 - test
...
# tests 1
# pass 0
# fail 1
```

退出码是 1。注意最后那几行：Node 22 把 `test` 这个目录当成了**一个测试文件**，报的是"1 个测试、失败 1 个"，而不是"找不到测试"。

## 原因：从 Node 21 开始，参数是 glob 不是路径

翻 Node 21.0.0 的 changelog，里面有一条标着 SEMVER-MAJOR 的改动：`test_runner: support passing globs`。也就是说：

- Node 20 及以前：`node --test` 后面跟的是路径。传文件就跑这个文件，传目录就在目录里递归找符合命名规则的文件。
- Node 21 及以后：后面跟的是 glob 模式，匹配到的每个路径都当作测试文件执行。

`test/` 当作 glob 去匹配，能匹配上的只有 `test` 这个目录本身。于是测试运行器起了一个子进程去"执行"这个目录，相当于 `node test`，CommonJS 加载器去找 `test/index.js` 或者 `test/package.json` 里的 main，都没有，就报了 `MODULE_NOT_FOUND`。

这里我顺手验证了一个更危险的情况：如果 `test/` 下面恰好有个 `index.js` 会怎样。新建一个目录，放一个真正的测试 `test/x.test.js`，再放一个只打印一行字的 `test/index.js`：

```
$ $N22 --test test/
# index.js was executed
ok 1 - test
# tests 1
```

它没报错，而是把 `index.js` 当成测试跑了，结果"通过"，真正的 `x.test.js` 一个都没执行。这种情况在 CI 里是绿的，比直接报错难发现得多。

## 修复：不传参数，让它自己找

最后的改动只有一行：

```diff
-    "test": "node --test test/"
+    "test": "node --test"
```

不带参数时，Node 会从当前工作目录开始按默认规则自动发现测试文件。这个写法在 20 和 22 上都能用，两边跑出来都是同样的结果：

```
ok 1 - 认证：登录、错误密码、双端隔离、注册、me
ok 2 - RBAC：角色权限控制
ok 3 - CRUD：增删改查、分页、搜索、校验、公开接口
ok 4 - 上传：需要登录、类型和大小限制
ok 5 - 防越权：只能分配/管理不超过自己的权限
# tests 5
# pass 5
# fail 0
```

根目录的 `package.json` 里是 `npm --prefix server test`，npm 会在 server 目录下执行脚本，所以自动发现的起点是 server，不会扫到旁边的 admin 和 client。如果你的项目是 monorepo，而且直接在根目录跑 `node --test`，就要留意它会把整个仓库都扫一遍。

为了确认这不是 22 某个小版本的问题，我又下了 24.22.0 试了一遍。`node --test test/` 同样报 `Cannot find module '/workspace/bishe-kit/server/test'`，前面那个放了 `index.js` 就"假通过"的例子在 24 上也一样能复现；不带参数时 5 个用例全部通过。也就是说，从 21 开始这就是固定行为，不会在后面的版本里改回去，升级时只能改脚本。

## 默认会匹配哪些文件

Node 22 文档里列的默认规则是这几条：

```
**/*.test.{cjs,mjs,js}
**/*-test.{cjs,mjs,js}
**/*_test.{cjs,mjs,js}
**/test-*.{cjs,mjs,js}
**/test.{cjs,mjs,js}
**/test/**/*.{cjs,mjs,js}
```

光看规则容易想当然，我建了一个目录把常见的命名都放进去，每个文件里只有一个以自己路径命名的空测试，分别用 20 和 22 跑 `node --test`：

| 文件 | Node 20 | Node 22 |
| --- | --- | --- |
| `src/d.test.js` | 跑 | 跑 |
| `src/f_test.js` | 跑 | 跑 |
| `src/g-test.mjs` | 跑 | 跑 |
| `src/test-h.cjs` | 跑 | 跑 |
| `src/test.js` | 跑 | 跑 |
| `test/a.js` | 跑 | 跑 |
| `test/unit/deep/c.js` | 跑 | 跑 |
| `src/e.spec.js` | 不跑 | 不跑 |
| `lib/__tests__/i.js` | 不跑 | 不跑 |
| `tests/user.js` | 不跑 | 不跑 |
| `node_modules/foo/j.test.js` | 不跑 | 不跑 |
| `src/k.test.ts` | 不跑 | 跑 |

有几点和我原来的印象不一样：

1. `.spec.js` 不在默认规则里。从 Jest 或 Vitest 迁过来的项目如果习惯用 spec 命名，直接 `node --test` 一个都找不到。
2. 目录名只认单数的 `test`，`tests` 和 `__tests__` 都不算。
3. 被排除的只有 `node_modules`。我在 `dist/` 里放了一个 `app.test.js`，20 和 22 都把它跑了，构建产物目录里如果带着测试文件，要自己注意。
4. `.ts` 文件在 22 上也会被跑。我用的 22.23.3 里 `process.features.typescript` 的值是 `'strip'`，说明默认开了类型剥离，文档也写了，这种情况下会额外匹配 `*.test.ts` 等规则。以前在 20 上被忽略的 ts 测试文件，升级之后可能突然开始执行。

## 一定要指定文件时，记得加引号

如果项目里的命名不符合默认规则，就只能自己传 glob。这时候要给 glob 加引号，否则会先被 shell 展开。npm scripts 默认用的是 `sh`，而 `sh` 不认识 `**`，会把它当成普通的 `*`，只匹配一层目录：

```
$ sh -c "$N22 --test test/**/*.js"
ok 1 - test/unit/b.test.js

$ $N22 --test 'test/**/*.js'
ok 1 - test/a.js
ok 2 - test/unit/b.test.js
ok 3 - test/unit/deep/c.js
```

不加引号时只跑了一个文件，而且不会有任何提示。写在 `package.json` 里就是：

```json
"test": "node --test \"test/**/*.test.js\""
```

但这个写法在 Node 20 上又不行了，20 会把它当成字面路径：

```
$ node --test 'test/**/*.js'
Could not find '/tmp/nt/test/**/*.js'
```

所以如果项目要同时支持 20 和 22，能在两边都正常工作的写法只有两种：不传参数走自动发现，或者老老实实列出具体的文件路径。

还有一个容易手滑的写法是 `'test/**'`。它会把目录也匹配进来，每个目录都会被当成文件执行一次：

```
$ $N22 --test 'test/**'
not ok 1 - test
ok 2 - test/a.js
not ok 3 - test/unit
ok 4 - test/unit/b.test.js
not ok 5 - test/unit/deep
ok 6 - test/unit/deep/c.js
```

## 常见写法在两个版本上的表现

把上面的试验整理一下，下面这几种 npm scripts 里常见的写法，我都在 bishe-kit 的 server 目录下用 20.19.2 和 22.23.3 各跑了一遍（npm scripts 在 Linux 和 macOS 上走的是 `sh`，所以我也用 `sh -c` 来模拟）：

| 写法 | Node 20 | Node 22 |
| --- | --- | --- |
| `node --test` | 5 个通过 | 5 个通过 |
| `node --test test/` | 5 个通过 | MODULE_NOT_FOUND |
| `node --test test/api.test.js` | 5 个通过 | 5 个通过 |
| `node --test test/*.test.js`（不加引号） | 5 个通过 | 5 个通过 |
| `node --test "test/**/*.test.js"` | Could not find | 5 个通过 |

第四种不加引号的写法两边都能过，是因为 `sh` 先把它展开成了具体的文件名，Node 收到的其实是 `test/api.test.js`，跟第三种没有区别。但它依赖 shell 的展开行为，测试文件多了一层子目录就会漏掉；而且 npm 在 Windows 上默认用 `cmd.exe` 执行脚本，`cmd.exe` 不展开通配符，这时 Node 收到的就是原样的模式字符串，20 和 22 的表现又会不一样。我手上没有 Windows 环境去验证，只是提醒一下：这种写法看起来兼容，其实是碰巧。

真正判断要不要改脚本，看一条就够了：后面跟的是目录，就一定要改；跟的是具体文件，不用动；跟的是带引号的 glob，说明已经不打算支持 20 了。

## 找不到测试时，退出码是 0

这一点我觉得最需要在 CI 里防一下。把测试文件放到一个默认规则匹配不到的地方，比如 `tests/user.spec.mjs`，然后跑：

```
$ node --test
# tests 0
# pass 0
# fail 0
$ echo $?
0
```

20 和 22 都一样，0 个测试，退出码 0，CI 是绿的。重命名文件、挪目录、改 glob 这类操作之后，最好看一眼输出里 `# tests` 后面的数字和预期是否一致。

## 每个测试文件是一个独立进程

默认情况下，每个匹配到的测试文件都在单独的子进程里执行。我写了两个文件，`a.test.js` 里改了 `process.env.DB_PATH` 并打印 pid，`b.test.js` 里断言这个环境变量不存在：

```
# a pid 116905
ok 1 - a 文件
# b pid 116906
ok 2 - b 文件看不到 a 改的环境变量
```

两个文件的 pid 不同，b 也看不到 a 设置的环境变量。这个特性在写接口测试时很有用。项目里的测试文件开头是这样的：

```js
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
process.env.DB_PATH = ':memory:'
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-up-'))
const request = (await import('supertest')).default
const { createApp } = await import('../src/app.js')
const { seed } = await import('../src/seed.js')
```

先设环境变量，让数据库走内存、上传目录走临时目录，再用动态 `import()` 加载业务代码。这里不能用静态 `import`，因为静态导入会被提升到模块最前面执行，那时候环境变量还没设置，`app.js` 读到的就是默认的数据库路径。又因为每个文件一个进程，这些环境变量只影响当前文件，以后再加测试文件也不会互相污染。

## test.only 需要额外的参数

调试时我习惯把某个用例改成 `test.only`，在 22 上直接跑会发现所有用例照样执行，输出里多了一行提示：

```
# 'only' and 'runOnly' require the --test-only command-line option.
```

加上 `--test-only` 才只跑那一个：

```bash
node --test --test-only test/api.test.js
```

这里传的是具体文件路径，在 20 和 22 上都能用。区别只在输出：20 会把其他用例列出来并标成 `# SKIP 'only' option not set`，22 只列出被 `only` 标记的那一个。

## CI 日志的格式和版本有关

这次排查时还注意到一个细节：同样是把输出重定向到文件或管道，20 和 22 打出来的是 TAP 格式，就是前面那些 `ok 1 - ...`、`# tests 5` 的样子；24 打出来的却是带对勾符号和耗时的 spec 格式。原因是 20 和 22 的默认规则是终端（TTY）里用 spec、非终端用 TAP，而 24 不管是不是终端都默认用 spec。GitHub Actions 的日志不是 TTY，所以同一个矩阵里不同版本的日志长得不一样。

TAP 适合机器读，人看起来比较费劲。我在 CI 里更倾向于显式指定，顺便多输出一份 JUnit 格式的报告，方便以后接测试结果展示：

```bash
node --test \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=junit --test-reporter-destination=junit.xml
```

`--test-reporter` 和 `--test-reporter-destination` 按顺序一一对应，可以写多组。这条命令我在 20.19.2 和 22.23.3 上都跑过，终端里是 spec 格式的结果，`junit.xml` 里是 5 个 `<testcase>`，用例名就是 `test()` 的第一个参数，中文也没问题。

## CI 矩阵里加上 fail-fast: false

回到开头那次 CI：22 失败了，20 却显示 cancelled。原因是 GitHub Actions 的矩阵策略默认 `fail-fast: true`，一个 job 失败，其他还在跑的 job 会被取消。这样我只知道 22 挂了，不知道 20 本身是好的还是也有问题。对于多版本兼容测试，我更想看到每个版本各自的结果，所以修复的那次提交里顺手把它关了：

```yaml
jobs:
  server:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
          cache-dependency-path: server/package-lock.json
      - run: npm ci
        working-directory: server
      - run: npm test
        working-directory: server
```

改完之后第二次 CI 两个版本都通过了。考虑到 20 已经停止维护，这个矩阵接下来更合理的组合是 22 和 24，20 留着只是为了照顾还没升级的使用者。

回头看，这个问题本身不难，难的是在我原来的开发环境里根本暴露不出来：我本地是 20，`test/` 这种写法在 20 上一直是对的。如果没有加 22 的矩阵，等哪天本地升级了 Node 才会发现。用内置测试运行器的话，我现在的习惯是：能不传参数就不传，测试文件按 `*.test.js` 命名或者放进单数的 `test/` 目录；非要传 glob 就加引号，并且确认不需要再兼容 20；CI 里至少覆盖还在维护的两个 LTS 版本。

完整代码在 https://github.com/MsNan/bishe-kit
