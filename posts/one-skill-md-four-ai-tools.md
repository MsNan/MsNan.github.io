---
title: "一份 SKILL.md 装给 Claude Code、Cursor、Trae、Codex：四种格式对照和我踩的坑"
date: 2026-10-24
category: 人工智能
tags: [AI编程, Claude Code, Cursor, Node.js]
description: "同一套技能装给四个 AI 编程工具：目录和 frontmatter 对照，AGENTS.md 区块更新，以及 Cursor 重复加载、Trae 无头部、YAML 未转义、分批安装丢索引等坑。"
---

最近写了个小工具：把一套写好的技能（就是给 AI 编程助手看的说明文件）一条命令装进项目里，同时给 Claude Code、Cursor、Trae、Codex 四个工具用。

一开始我以为这活儿很简单——不就是复制几个 Markdown 文件吗？真写下来才发现，四家各有各的目录、各有各的头部格式，而且这一年里它们还在互相"兼容"对方的目录，装多了反而会重复。这篇把我实际落地的格式、踩到的坑和还没修的问题都摊开说。

先说结论：**源文件只维护一份 `skills/<name>/SKILL.md`，安装时按目标工具各转一次格式。**

## 源文件长什么样

每个技能一个目录，里面一个 `SKILL.md`，头部是 YAML frontmatter：

```markdown
---
name: code-to-thesis
description: 从已有毕设项目代码中提取论文素材（技术栈、功能模块清单、数据库表……）。已经写完代码、要开始写论文或核对论文与代码是否一致时使用。
---
# 从代码提取论文素材
...
```

`description` 我强制要求写清"什么时候用"，因为几个工具都是**先只看 description，判断相关了才读正文**。描述写成"论文助手"这种，AI 根本不知道什么时候该调它。仓库里有个 `bin/check.js` 专门卡这一点：

```js
if (meta.name !== n) errors.push(`${n}: frontmatter name (${meta.name}) 与目录名不一致`)
if (meta.description.length < 20) errors.push(`${n}: description 太短，写清「什么时候用」`)
if (!/使用|时用/.test(meta.description)) errors.push(`${n}: description 需说明使用时机（包含「…时使用」）`)
```

`name` 必须和目录名一致、只能小写字母数字加短横线——这条不是我拍脑袋定的，Claude Code、Codex、Cursor 的 skills 都按目录名识别，Trae 的规则文件名也只支持小写字母、数字和连字符。

## 四种输出，对照着看

在一个空目录里装两个技能，实际得到的文件是这样的：

```
.agents/skills/code-to-thesis/SKILL.md
.agents/skills/test-chapter/SKILL.md
.claude/skills/code-to-thesis/SKILL.md
.claude/skills/test-chapter/SKILL.md
.cursor/rules/code-to-thesis.mdc
.cursor/rules/test-chapter.mdc
.trae/rules/code-to-thesis.md
.trae/rules/test-chapter.md
AGENTS.md
```

对应到代码里就是一个 `if/else`：

```js
const skillMd = `---\nname: ${n}\ndescription: ${desc}\n---\n${body}`
if (t === 'claude') {
  const base = o.global ? path.join(home, '.claude', 'skills') : path.join(o.dir, '.claude', 'skills')
  write(path.join(base, n, 'SKILL.md'), skillMd, o.force, stats)
} else if (t === 'cursor') {
  write(path.join(o.dir, '.cursor', 'rules', `${n}.mdc`),
    `---\ndescription: ${desc}\nglobs:\nalwaysApply: false\n---\n${body}`, o.force, stats)
} else if (t === 'trae') {
  write(path.join(o.dir, '.trae', 'rules', `${n}.md`), `<!-- ${desc} -->\n${body}`, o.force, stats)
} else if (t === 'codex') {
  write(path.join(o.dir, '.agents', 'skills', n, 'SKILL.md'), skillMd, o.force, stats)
  agentsLines.push(`- \`${n}\`：${desc}（详见 .agents/skills/${n}/SKILL.md）`)
}
```

列个表：

| 工具 | 写到哪 | 头部 | 怎么被用上 |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/<name>/SKILL.md`（`-g` 时写 `~/.claude/skills`） | `name` + `description` | 按 description 自动加载 |
| Cursor | `.cursor/rules/<name>.mdc` | `description` + 空 `globs` + `alwaysApply: false` | 按描述由 Agent 判断是否引用 |
| Trae | `.trae/rules/<name>.md` | 没有 frontmatter，只有一行 HTML 注释 | 项目规则 |
| Codex | `.agents/skills/<name>/SKILL.md` + `AGENTS.md` 索引 | `name` + `description` | 按 description 加载，AGENTS.md 做目录 |

几个细节：

**1. Claude 和 Codex 的 SKILL.md 是"重写"头部，不是原样拷贝。** 源文件里如果还有别的字段（比如我另一个仓库里给 Cursor 用的 `globs`），转出来只保留 `name` 和 `description`。好处是不会把一个工具的私有字段带给另一个工具。

**2. Cursor 的 `globs:` 留空、`alwaysApply: false`。** 毕设文档这种技能跟具体文件类型无关，没法按 glob 自动挂，所以交给 Agent 看描述决定。用 js-yaml 解析出来是 `{ globs: null, alwaysApply: false }`，没问题。

**3. Codex 那边多写了一个 `AGENTS.md` 区块。** 用一对 HTML 注释圈起来，重复安装只替换自己的区块，用户原来写在 AGENTS.md 里的内容不动：

```js
const start = `<!-- ${MARK}:start -->`, end = `<!-- ${MARK}:end -->`
const re = new RegExp(`${start}[\\s\\S]*?${end}\\n?`)
cur = re.test(cur) ? cur.replace(re, block) : (cur ? cur.replace(/\n*$/, '\n\n') : '') + block
```

实测原文件是"# 我的项目 / 已有说明"，装完后原内容在上面，区块追加在后面，中间空一行。

**4. 读源文件先把 `\r\n` 换成 `\n`。** Windows 上 clone 下来如果被 git 转成 CRLF，`^---\n` 这个正则就匹配不上，整个 frontmatter 会被当成正文。我另一个更早的技能仓库（vue-uniapp-skills）的解析函数到现在还没加这一行。

## 坑一：Cursor 现在会读别人家的目录

这个是写这篇时重新查文档才注意到的。Cursor 现在也支持 Agent Skills，自己的目录是 `.cursor/skills/` 和 `.agents/skills/`，而且"为了兼容"还会读 `.claude/skills/` 和 `.codex/skills/`。

也就是说，默认 `--tool all` 装完之后，在 Cursor 里同一个技能可能出现三份：`.cursor/rules` 里的规则、`.claude/skills` 里的技能、`.agents/skills` 里的技能。内容一样，只是多占一点上下文，不至于出错，但确实没必要。

我的建议是按实际用的工具装：

```bash
# 只用 Claude Code 和 Cursor：装 claude 一份就够两边用
npx -y github:MsNan/bishe-doc-skills --tool claude

# 只用 Cursor：装成规则，或者装 codex 那份（.agents/skills Cursor 也读）
npx -y github:MsNan/bishe-doc-skills --tool cursor
```

反过来，Claude Code 的文档里列的加载路径只有 `.claude/skills`，没有 `.agents/skills`，所以 Claude 那份不能省。

## 坑二：Trae 那份没有 frontmatter

Trae 的项目规则放在 `.trae/rules/`，可以放多个 Markdown 文件。它的规则也有 frontmatter：`alwaysApply: true` 是始终生效，`alwaysApply: false` 配 `globs` 是按文件生效，配 `description` 是"智能生效"。

而我现在写出去的是这样：

```markdown
<!-- 从已有毕设项目代码中提取论文素材（……）。已经写完代码、要开始写论文或核对论文与代码是否一致时使用。 -->
# 从代码提取论文素材
```

描述只放在 HTML 注释里，Trae 不会把它当 `description`。没有 frontmatter 的规则文件按什么方式生效，文档里没写清楚。如果是当作始终生效，7 个技能加起来大约 14.8KB，会全部塞进每次对话；Trae 官方 FAQ 里也提到规则内容过长会被裁剪。

更合适的写法应该和 Cursor 那份一样带上头部，让它走"智能生效"：

```markdown
---
description: 从已有毕设项目代码中提取论文素材……时使用。
alwaysApply: false
---
```

这个我还没改，装完之后建议到 Trae 的「设置 > 规则」里确认一下每条规则的生效方式。

## 坑三：description 是直接拼进 YAML 的

上面四个分支里，`description` 都是原样拼在 `description: ` 后面，没有加引号。现在 7 个技能的描述都是中文标点，用 js-yaml 解析都正常。但只要哪天有人写了一个半角冒号加空格：

```
description: 写论文时使用。注意: 不编造
```

严格的 YAML 解析器就会报 `bad indentation of a mapping entry`。同理，我另一个 uni-app 技能仓库把 `globs: **/*.vue,**/pages.json` 不加引号写进 `.mdc`，js-yaml 会报 `unidentified alias`，因为 `*` 开头在 YAML 里是别名语法。Cursor 自己的解析器能不能容忍这种写法我没逐个验证，但最稳的办法是输出时用 `JSON.stringify(desc)` 包一层——JSON 字符串本身就是合法的 YAML 双引号字符串。`check.js` 里也可以顺手加一条"拼出来的头部能被 YAML 解析"的检查。

## 坑四：分两次装，AGENTS.md 会"丢"一半

这个是写文章时顺手试出来的。先装两个技能：

```bash
node bin/cli.js -s code-to-thesis,test-chapter
```

AGENTS.md 区块里有两行。再单独装一个：

```bash
node bin/cli.js -s thesis-writing
```

区块被整个替换，只剩 `thesis-writing` 一行。前两个技能的文件还在 `.agents/skills/` 里，但索引里没了。原因很直接：区块内容只由"这次安装的技能"生成。

修起来也不难：生成区块时不用本次的 `names`，而是扫一遍 `.agents/skills/` 下实际存在、且属于这个技能包的目录。好在 Codex 本身就会扫描 `.agents/skills`，索引丢了不影响 Codex 加载技能，影响的是那些只读 AGENTS.md 的工具。

## 还有两个小点

- `-g/--global` 只对 Claude 生效。`-g -t cursor` 不会报错，也不会装到全局，而是照常写进当前目录（已存在就跳过）。Codex 其实也有个人目录 `~/.agents/skills`，以后可以一起支持。
- npx 下 bin 是软链接，判断"是不是被直接执行"要比较真实路径，不然 `require.main.filename` 和 `__filename` 对不上，`main()` 根本不跑：

```js
if (require.main && fs.realpathSync(require.main.filename) === fs.realpathSync(__filename)) main()
```

## 小结

1. 源文件只维护一份 SKILL.md，`name` 等于目录名，`description` 写清使用时机，其余格式安装时生成。
2. Claude Code 和 Codex 的 SKILL.md 格式基本一致，区别只在目录：`.claude/skills` 和 `.agents/skills`。
3. Cursor 现在兼容读取 `.claude/skills` 和 `.agents/skills`，同时装 `.cursor/rules` 会重复，按实际使用的工具装就好。
4. Trae 的规则也有 frontmatter，描述别只放在注释里。
5. 往 YAML 里拼字符串记得转义，`JSON.stringify` 一下最省事。

上面提到的 Trae 头部、YAML 转义、AGENTS.md 分批安装这几个问题，仓库里目前还没改，文章里写的是现状。

仓库：https://github.com/MsNan/bishe-doc-skills
