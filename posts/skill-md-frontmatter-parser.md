---
title: "二十行手写的 SKILL.md 头部解析，遇到 YAML 的折叠写法、单引号和嵌套键就读错：和 js-yaml 逐条对照"
date: 2026-11-02
category: 人工智能
tags: [Node.js, YAML, AI编程, Claude Code]
description: "零依赖手写 frontmatter 解析与 js-yaml 对照：>- 被读成字面量、单引号和注释原样保留、metadata 子键覆盖顶层；check.js 补上 64 字符、保留词和尖括号检查。"
---

我有个给毕业设计写论文用的技能包，一份 `SKILL.md` 能装给 Claude Code、Cursor、Trae、Codex 四个工具。安装脚本零依赖，读 `SKILL.md` 头部的 frontmatter 是自己写的二十来行代码。之前写过输出那一侧：拼回 YAML 时要转义。这次看的是读入这一侧：别人照着 YAML 的正常写法写一个技能，我的解析器能不能读对。

结论是有好几种合法的 YAML 写法会被读错，而且校验脚本 `check.js` 有时候拦下了、但报的原因不对，有时候干脆放过去了。下面所有结果都是我在 Node 20.19.2 上实际跑出来的，对照用的是 js-yaml 4.3.2。

## 解析器长什么样

```js
function unquote(v) {
  if (/^".*"$/.test(v)) { try { return JSON.parse(v) } catch { return v.slice(1, -1) } }
  return v
}

function parseSkill(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta = {}
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = unquote(line.slice(i + 1).trim())
  }
  return { meta, body: m ? m[2] : raw }
}
```

思路很直接：逐行找第一个冒号，左边是键，右边是值，值如果是双引号包着的就当 JSON 字符串解析。对仓库里自带的 7 个技能来说完全够用，它们都是一行一个 `name`、一行一个 `description`。

问题出在"别人写的技能"。这个包欢迎别人加技能，加的人多半是照着 YAML 或者 Agent Skills 规范里的例子写的。

## 逐条对照

我准备了几种写法，每种都放进一个临时目录，依次做三件事：用仓库的 `parseSkill` 解析、跑仓库的 `bin/check.js`、再用 `install` 装一次 Claude Code 的格式，看装出去的 `description` 是什么。

### 1. 折叠写法 `>-`

description 写长了，很多人会这样换行：

```yaml
description: >-
  写论文第 5 章系统实现、整理核心代码片段时使用。
  会读取项目代码。
```

js-yaml 读出来是正常的一段文字。我的解析器读出来是：

```
{"name":"demo-skill","description":">-"}
```

逐行处理，第一行冒号后面就是 `>-`；后面两行有缩进，但里面没有半角冒号，被直接忽略了。

`check.js` 确实拦下了，但报的是：

```
✗ demo-skill: description 太短，写清「什么时候用」
✗ demo-skill: description 需说明使用时机（包含「…时使用」）
```

写的人一看，description 明明很长、也写了"时使用"，完全想不到是换行写法的问题。如果跳过校验直接安装，装出去的就是 `description: ">-"`。

### 2. 单引号

```yaml
description: '写论文第 5 章系统实现、整理核心代码片段时使用。'
```

YAML 里单引号也是字符串。解析器只认双引号，于是单引号被当成内容的一部分保留下来。校验能过（长度够、有"时使用"），装出去是：

```
description: "'写论文第 5 章系统实现、整理核心代码片段时使用。'"
```

不影响使用，但工具里看到的描述两头多了引号。

### 3. 引号后面跟注释

```yaml
description: "写论文第 5 章系统实现、整理核心代码片段时使用。" # 备注
```

`/^".*"$/` 要求以引号结尾，这里结尾是"备注"，匹配不上，整串原样当值。校验能过，装出去的 description 带着引号和 `# 备注`。

### 4. 嵌套的 metadata

Agent Skills 规范里有一个可选的 `metadata` 字段，是个键值映射。如果有人在里面也写了 `name` 或 `description`：

```yaml
name: demo-skill
description: 写论文第 5 章系统实现、整理核心代码片段时使用。
metadata:
  name: 系统实现
  version: "1.0"
```

缩进的 `  name: 系统实现` 也有冒号，`trim()` 之后键就是 `name`，把顶层的覆盖了。校验报"frontmatter name (系统实现) 与目录名不一致"，写的人会很困惑，因为顶层 name 明明是对的。

换成 `metadata` 下面有个 `description`，情况更糟：

```yaml
metadata:
  description: 旧版说明，写第 4 章系统设计时使用（已废弃）
```

这一行长度够、也有"时使用"，校验**直接通过**，装出去的 description 是那句"旧版说明……（已废弃）"。工具是靠 description 判断什么时候用这个技能的，等于悄悄换掉了触发条件。

### 5. 两个解析器意见相反的情况

也有我的解析器更宽松的时候：

```yaml
description: 用途: 写论文第 5 章时使用
```

不加引号的值里有 `: `，严格的 YAML 不允许，js-yaml 报 `bad indentation of a mapping entry`。我的解析器只切第一个冒号，后面原样保留，能读对；而且安装时输出会用 `JSON.stringify` 包成双引号字符串，装出去的是合法 YAML。仓库里有一条测试专门覆盖了这种"不规范但能用"的写法，所以修的时候我刻意没动不加引号的值。

## 校验规则和规范的差距

顺便对了一下 `check.js` 和 Agent Skills 规范、Anthropic 文档里的要求：

| 要求 | 规范 | check.js |
|---|---|---|
| name 小写字母数字和短横线、与目录同名 | 有 | 有 |
| name 不超过 64 个字符 | 有 | 没有 |
| name 不能含 `anthropic`、`claude` | Anthropic 文档有 | 没有 |
| description 1 到 1024 个字符 | 有 | 有（下限我自己设成 20） |
| description 不能含 XML 标签 | Anthropic 文档有 | 没有 |

我用 70 个字母的名字（目录同名）、`claude-thesis`、description 里带 `<thesis>` 三种情况各试了一次，原版校验全部通过。

要说明的是：保留词和 XML 标签这两条，我是从 Anthropic 的文档里看到的，它写的是技能的元数据要求；本地的 Claude Code 遇到这种技能会不会报错或者忽略，我没有验证。所以这两条我是当"按文档写，别踩线"加进校验的。

还有一条是我自己的规则：description 必须说明使用时机，原来的正则是 `/使用|时用/`。"使用 GB/T 7714 规范整理参考文献的格式要求说明"这句话里有"使用"两个字，但根本没说什么时候用，也能通过。

## 怎么改

我没打算引入 YAML 库。这个安装器是用 `npx -y github:...` 直接从仓库跑的，package.json 里没有任何依赖，我想保持这一点。所以思路是：**只支持单行标量，看不懂的写法明确报错，不去猜**。

```js
function unquote(v, key = '') {
  if (/^[|>][+-]?[0-9]?$/.test(v))
    throw new CliError(`frontmatter ${key}: 不支持多行写法（| 或 >），请写成一行`)
  let m
  if ((m = v.match(/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/))) return JSON.parse(m[1])
  if ((m = v.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/))) return m[1].replace(/''/g, "'")
  if (/^["']/.test(v)) throw new CliError(`frontmatter ${key}: 引号没有正确闭合`)
  return v
}
```

- `|`、`>` 以及带 `-`、`+`、数字的变体，直接报错，告诉人"写成一行"。
- 双引号：引号内部按 JSON 字符串解析，后面允许跟 `# 注释`。
- 单引号：YAML 单引号里唯一的转义是两个单引号表示一个，照做。
- 以引号开头但没闭合，报错。这是一个行为变化：以前会原样当值，现在不行了。YAML 里这本来就是错的，我觉得报出来更好。
- 不加引号的值原样返回，`#` 不当注释截掉。这是为了兼容上面那条已有测试。

`parseSkill` 里跳过缩进行和注释行，嵌套的子键不再覆盖顶层：

```js
if (/^\s/.test(line) || /^#/.test(line)) continue
```

这样 `metadata:` 本身会被读成空字符串，子项全部忽略。安装器本来就只输出 name 和 description，读不到子项不影响结果。

`check.js` 把 `parseSkill` 包进 try/catch，把上面的报错原样列出来，再补三条规则，并把使用时机的正则收紧成 `/(时|的时候)使用|时用/`：

```js
if (n.length > 64) errors.push(`${n}: 名称超过 64 个字符`)
if (/anthropic|claude/.test(n)) errors.push(`${n}: 名称不能包含保留词 anthropic / claude`)
if (/[<>]/.test(meta.description)) errors.push(`${n}: description 不能包含尖括号 / XML 标签`)
```

改完再跑同一组用例：

```
折叠 >-            ✗ frontmatter description: 不支持多行写法（| 或 >），请写成一行
单引号             ✓ 读出不带引号的文字
双引号 + 注释       ✓ 注释被去掉
metadata.name      ✓ 顶层 name 不再被覆盖
metadata.description ✓ 装出去的是顶层 description
70 字符名字         ✗ 名称超过 64 个字符
claude-thesis      ✗ 名称不能包含保留词 anthropic / claude
<thesis>           ✗ description 不能包含尖括号 / XML 标签
"使用 GB/T 7714…"  ✗ description 需说明使用时机
```

仓库自带的 7 个技能校验仍然全部通过，`node --test` 从 9 条变成 10 条，全部通过；新加的一条测试覆盖了单引号、引号后注释、缩进子键和多行块。

还有一种情况没处理：不加引号的 `name: demo-skill # 和目录同名`，注释会被当成名字的一部分，校验报"与目录名不一致"。至少能拦下来，报错里也能看到多出来的那段，我就没再加特判。

## 一个意外：另一个技能包当场不过

我另一个 Vue3 + uni-app 的技能包用的是同一份解析和校验代码。把改动搬过去一跑，12 个技能里有一个当场报错：

```
✗ vue3-composition: description 不能包含尖括号 / XML 标签
```

它的 description 里写着"编写或重构 .vue / composable 文件时使用：`<script setup lang="ts">`、……"。我自己写的时候完全没意识到这是个标签。按 Anthropic 文档的说法，这条描述不符合要求；在本地 Claude Code 里实际会怎样我同样没验证。改成 `script setup + lang="ts"` 以后 12 个技能全部通过，原有 9 条测试也都通过。

## 小结

1. 手写解析器最大的问题不是"读不了"，而是"读错了还不吭声"。宁可对看不懂的写法明确报错。
2. 逐行切冒号的解析，一定要处理缩进行，否则嵌套映射会覆盖顶层键。
3. 校验报错要指向真正的原因。`>-` 被读成两个字符再报"太短"，比不报还误导人。
4. 规则里的关键词判断别太宽，"使用"两个字随处可见。
5. 加了新规则，先拿手头所有现成的数据跑一遍，很可能先抓到自己。

上面的改动只在本地副本上验证过，两个仓库里目前都还是原来的代码。

仓库：https://github.com/MsNan/bishe-doc-skills
