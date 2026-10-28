---
title: "手写 CLI 参数解析和读 frontmatter 时踩的三个坑：-d 缺值崩溃、CRLF 让元数据整段消失、分批安装覆盖索引"
date: 2026-10-28
category: 前端
tags: [Node.js, JavaScript, CLI, AI编程]
description: "零依赖 Node CLI 三个坑：-d 缺值抛 TypeError、-d -f 把 -f 当目录名；CRLF 让 frontmatter 失配；分批安装覆盖 AGENTS.md 索引。附修复与测试。"
---

# 手写 CLI 参数解析和读 frontmatter 时踩的三个坑：-d 缺值崩溃、CRLF 让元数据整段消失、分批安装覆盖索引

我有一个给 AI 编程工具用的技能包仓库，里面是 12 个 Vue3 + uni-app 的 SKILL.md，配了一个几十行的安装脚本：`npx` 一跑，把技能分别写成 Claude Code 的 `.claude/skills/<名字>/SKILL.md`、Cursor 的 `.cursor/rules/<名字>.mdc`、Trae 的规则文件和 Codex 的 `.agents/skills` + `AGENTS.md` 索引。

脚本没用任何依赖，参数解析和 frontmatter 解析都是手写的。第一版能用，但前几天回头看，发现三个地方写得想当然。这篇把修改前后的代码和实际运行结果都放出来，文中输出都是我在 Node 20.19.2 上跑出来的。

## 坑一：`-d` 后面忘了写路径，直接甩一屏堆栈

第一版的参数解析是这样的：

```js
function parseArgs(argv) {
  const o = { tool: 'all', skills: null, dir: process.cwd(), global: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i]
    if (a === '-t' || a === '--tool') o.tool = next()
    else if (a === '-s' || a === '--skills') o.skills = next().split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '-d' || a === '--dir') o.dir = path.resolve(next())
    else if (a === '-g' || a === '--global') o.global = true
    else if (a === '-f' || a === '--force') o.force = true
    // ...
    else { console.error('未知参数: ' + a); process.exit(1) }
  }
  return o
}
```

`next()` 就是"取下一个参数"，没有任何检查。参数写全的时候一切正常，少写一个就出问题了。

只写 `-d`：

```
TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be of type string. Received undefined
    at Object.resolve (node:path:1187:7)
    at parseArgs (/tmp/vus-old/bin/cli.js:29:56)
```

只写 `-s`：

```
TypeError: Cannot read properties of undefined (reading 'split')
    at parseArgs (/tmp/vus-old/bin/cli.js:28:63)
```

只写 `-t` 更隐蔽：`o.tool` 被赋成 `undefined`，解析阶段不报错，一直走到后面 `o.tool.split(',')` 才崩，堆栈指向 `main`，看着像是安装逻辑出了 bug。

这三种退出码都是 1，从脚本角度看"失败了"没错，但用户看到的是 Node 内部错误，不知道是自己少写了参数。

还有一种情况比崩溃更糟：`-d -f`。本意可能是"先写 -d，路径待会补，再加个 -f"，结果 `next()` 老老实实把 `-f` 当成了目录名。我在一个空目录里跑了 `node cli.js -d -f -t trae`，输出是：

```
✅ 已写入 12 个文件（工具: trae，技能: 12 个）
```

然后当前目录下多了一个叫 `-f` 的文件夹，12 个规则文件都写在里面。没报错，`--force` 也没生效。这种"成功了但不是你想要的"，比崩溃更难发现。

现在的写法：

```js
class CliError extends Error {}

function parseArgs(argv, cwd = process.cwd()) {
  const o = { tool: 'all', skills: null, dir: cwd, global: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new CliError(`参数 ${a} 缺少值`)
      return v
    }
    if (a === '-t' || a === '--tool') o.tool = next()
    else if (a === '-s' || a === '--skills') o.skills = next().split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '-d' || a === '--dir') o.dir = path.resolve(cwd, next())
    // ...
    else throw new CliError('未知参数: ' + a)
  }
  return o
}
```

改了三处：

1. `next()` 里检查值存不存在、是不是另一个选项，缺值时抛自己的 `CliError`。
2. 解析函数里不再直接 `process.exit(1)`，统一抛错，由 `main` 决定怎么处理：

```js
} catch (e) {
  if (e instanceof CliError) { console.error(e.message); process.exitCode = 1 } else throw e
}
```

用户输错只打印一行中文；真正的程序 bug 照样抛出来带堆栈，不会被吞掉。用 `process.exitCode` 而不是 `process.exit()`，是让已经排队的输出能正常写完。

3. `cwd` 作为参数传进来。这样测试里可以直接调 `parseArgs(['-d', 'x'], '/base')`，断言结果是 `path.resolve('/base', 'x')`，不用真的切换工作目录。

现在 `-d`、`-s`、`-t` 单独出现，以及 `-d -f`，都只输出一行"参数 -d 缺少值"，退出码 1。

`startsWith('-')` 这条规则有个代价：目录名本身以 `-` 开头就传不进去了，要写成 `-d ./-dir`。对这个工具来说可以接受。另外 `--dir=x` 这种带等号的写法也不支持，会提示未知参数。

如果你的工具只需要支持 Node 18.3 / 16.17 以上，可以直接用内置的 `util.parseArgs`，这两种情况它都处理了。我用同样的选项试了一下：

```js
const { parseArgs } = require('node:util')
const options = { dir: { type: 'string', short: 'd' }, force: { type: 'boolean', short: 'f' } }
parseArgs({ args: ['-d'], options })
// ERR_PARSE_ARGS_INVALID_OPTION_VALUE: Option '-d, --dir <value>' argument missing
parseArgs({ args: ['-d', '-f'], options })
// ERR_PARSE_ARGS_INVALID_OPTION_VALUE: Option '-d' argument is ambiguous.
// To specify an option argument starting with a dash use '--dir=-XYZ' or '-d-XYZ'.
parseArgs({ args: ['--dir=x'], options })
// { dir: 'x' }
```

它对"值以 - 开头"的处理比我的更周到：默认报错，但给了 `--dir=-XYZ` 这个出口。我这个包的 `engines` 写的是 `>=16`，所以还是保留了手写版本。

## 坑二：SKILL.md 是 CRLF 换行时，frontmatter 整段"消失"

解析 frontmatter 的正则是：

```js
const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
```

文件如果在 Windows 上编辑、保存成 CRLF（`\r\n`），第一行就是 `---\r\n`，`^---\n` 匹配不上，`m` 是 `null`。代码里的兜底逻辑是"没有 frontmatter 就把整个文件当正文"，于是不会报错，但结果完全不对。

我造了一个 CRLF 的测试技能，用旧脚本装给 Claude Code，生成的 SKILL.md 用 `cat -A` 看（`^M` 是 `\r`，`$` 是行尾）：

```
---$
name: demo-skill$
description: demo-skill$
---$
---^M$
name: demo-skill^M$
description: Windows 下编辑的技能，测试时使用^M$
globs: "**/*.vue"^M$
---^M$
```

两个问题叠在一起：description 退化成了技能名 `demo-skill`，原来的 frontmatter 又被原样塞进了正文。对 Claude Code 来说，description 是它判断"什么时候用这个技能"的依据，变成一个名字等于没写。Cursor 的 `.mdc` 也一样，globs 还变成了空的。

一个容易想到的修法是把正则改宽：`/^---\r?\n([\s\S]*?)\r?\n---/`。这能匹配上，但 frontmatter 内部每一行还是以 `\r` 结尾。我试了一下，如果按行切分后不 trim，拿到的值是：

```
{"name":"demo-skill\r","description":"Windows 下编辑的技能，测试时使用\r", ...}
```

`\r` 打印出来看不见，但 `meta.name === 'demo-skill'` 会是 `false`。我的校验脚本里正好有一条"name 必须和目录名一致"，这种情况下会报一个看起来莫名其妙的错。

所以最后的做法是在入口处统一换行，后面的代码一律只处理 `\n`：

```js
function parseSkill(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  // ...
}
```

顺带的好处是输出文件也全是 LF，测试里加了一条断言：生成的文件不包含 `\r`。

还有一个同类问题现在没处理：BOM。文件开头如果有 UTF-8 BOM（老版本 Windows 记事本保存 UTF-8 时会加），`^---` 同样匹配不上。我拿现在的 `parseSkill` 试了一个带 BOM 的文件，返回的 meta 是空对象 `{}`，整个文件进了正文。要处理的话再加一个 `.replace(/^\uFEFF/, '')` 就行，仓库里的技能文件目前都没有 BOM，这条先记下。

## 坑三：分两次安装，AGENTS.md 里的索引只剩最后一批

Codex 那边除了写 `.agents/skills/<名字>/SKILL.md`，还会在项目根目录的 `AGENTS.md` 里维护一个索引区块，用一对 HTML 注释圈起来，用户自己写的内容不动：

```
<!-- vue-uniapp-skills:start -->
## Vue3 + uni-app 技能
按任务需要先阅读对应技能文件再编码：
- `pinia-store`：……（详见 .agents/skills/pinia-store/SKILL.md）
<!-- vue-uniapp-skills:end -->
```

旧逻辑是：用这次安装的技能生成整个区块，有旧区块就整块替换。问题在于工具支持 `-s` 只装部分技能。我先 `-s uniapp-request`，再 `-s pinia-store`，旧脚本跑完的 AGENTS.md 里只剩 `pinia-store` 一行。`uniapp-request` 的技能文件还在磁盘上，索引里却没了。

修改后的函数：

```js
function upsertAgentsBlock(file, entries) {
  const start = `<!-- ${MARK}:start -->`, end = `<!-- ${MARK}:end -->`
  let cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const re = new RegExp(`${start}[\\s\\S]*?${end}\\n?`)
  const old = cur.match(re)
  const map = new Map()
  if (old) for (const m of old[0].matchAll(/^- `([^`]+)`.*$/gm)) map.set(m[1], m[0])
  for (const [n, line] of entries) map.set(n, line)
  const lines = [...map.keys()].sort().map(k => map.get(k))
  const block = `${start}\n## Vue3 + uni-app 技能\n按任务需要先阅读对应技能文件再编码：\n${lines.join('\n')}\n${end}\n`
  const next = old ? cur.replace(re, () => block) : (cur ? cur.replace(/\n*$/, '\n\n') : '') + block
  if (next === cur) return false
  fs.writeFileSync(file, next)
  return true
}
```

几个细节：

- **先读旧条目，再合并。** 用技能名做 Map 的 key，同名的以本次为准（`--force` 重装时描述更新了也能刷新），不会出现重复行。
- **排序。** 不排序的话，条目顺序取决于安装顺序，同样一组技能分几次装，AGENTS.md 的内容就不一样，提交到 git 里会产生没意义的 diff。
- **内容没变就不写文件。** 之前每次运行都重写，哪怕所有技能文件都因为已存在被跳过，AGENTS.md 的修改时间也会变，编辑器会提示文件被外部修改。测试里用 `fs.utimesSync` 把修改时间设成一个固定值，再装一次同样的技能，断言 `mtimeMs` 没变。
- **`replace` 的第二个参数用函数。** 区块里有技能描述，描述里如果出现 `$&`、`$1` 这类字符，字符串形式的替换会把它们当成特殊替换符。用函数返回值就是原样插入。

同样的两步操作，新脚本跑完的 AGENTS.md：

```
# 我的项目规则
不要改 dist

<!-- vue-uniapp-skills:start -->
## Vue3 + uni-app 技能
按任务需要先阅读对应技能文件再编码：
- `pinia-store`：Pinia 状态管理规范（setup store 写法、持久化到 uni storage、storeToRefs、模块划分）。新建或修改 stores/ 时使用。（详见 .agents/skills/pinia-store/SKILL.md）
- `uniapp-request`：基于 uni.request 的 TypeScript 请求封装：baseURL、拦截、统一错误、loading、401 自动刷新 token / 跳转登录、并发去重。新建或修改 api 层时使用。（详见 .agents/skills/uniapp-request/SKILL.md）
<!-- vue-uniapp-skills:end -->
```

再装一次 `pinia-store`，输出"已写入 0 个文件"，AGENTS.md 的修改时间没变。

这个方案也有局限：索引只增不减。用户手动删了某个技能目录，索引里那一行还在。要做到完全一致，得扫描 `.agents/skills/` 下实际存在的目录来生成，但那样又要区分哪些目录属于这个包，暂时没做。

## 为了能测，把逻辑从 main 里拆出来

旧脚本是一个 `main()` 从头写到尾，最后一行直接调用，`require` 一下就会真的往当前目录写文件，没法测。这次拆成了 `parseArgs`、`parseSkill`、`install`、`upsertAgentsBlock` 几个函数导出，`install` 的技能目录和 home 目录都可以传参替换，测试里全部指向临时目录：

```js
function install(o, { skillsDir = SKILLS_DIR, home = os.homedir() } = {}) { /* ... */ }

module.exports = { parseArgs, parseSkill, listSkills, install, upsertAgentsBlock, TOOLS, CliError }

// npx 下 bin 是软链接，需比较真实路径
if (require.main && fs.realpathSync(require.main.filename) === fs.realpathSync(__filename)) main()
```

最后一行是"只有被直接执行时才跑 main"。用 `npx` 安装时，`node_modules/.bin` 里的命令是软链接，所以两边都取真实路径再比较。测试里专门有一条：建一个指向 cli.js 的软链接，通过它执行，确认文件真的写出来了。

测试用的是 Node 内置的 `node:test`，一共 9 条，覆盖上面三个坑、`--force`、`--global`，以及通过子进程执行时缺值报错退出码为 1、stderr 里没有 `TypeError`。`npm test` 先跑一遍技能格式校验，再跑测试，GitHub Actions 上 Node 18/20/22 三个版本都跑。

## 小结

- 手写参数解析时，"取下一个值"要检查是否存在、是否其实是下一个选项。`-d -f` 这种不崩但悄悄出错的情况最难发现。
- 用户输入错误和程序 bug 分开处理：前者一行提示加退出码 1，后者保留堆栈。
- 读文本文件先统一换行（必要时去 BOM），不要在正则里到处补 `\r?`。
- 往用户文件里写"受管理的区块"，要合并而不是覆盖，排序保证结果稳定，内容没变就别写。

仓库：https://github.com/MsNan/vue-uniapp-skills
