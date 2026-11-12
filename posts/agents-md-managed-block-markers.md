---
title: "往用户的 AGENTS.md 里写自动生成区块：删掉一行 end 标记，第二次安装就把他写的规则吞了"
date: 2026-11-12
category: 前端
tags: [Node.js, CLI, AI编程, Markdown]
description: "bishe-doc-skills 安装器在 AGENTS.md 里维护自动生成区块：删掉 end 标记后第二次安装吞掉用户内容、代码块和行内提到的标记被当真、CRLF 混用、合并后出现两个区块；改成按整行扫描、拿不准就报错。"
---

<div v-pre>

bishe-doc-skills 是我做的一个毕设文档技能包，装给 Codex 时除了写 `.agents/skills/<名字>/SKILL.md`，还会在项目根目录的 `AGENTS.md` 里维护一段索引，用一对 HTML 注释圈起来：

```markdown
<!-- bishe-doc-skills:start -->
## 毕设文档技能
写开题报告、论文章节、测试或答辩材料前，先阅读对应技能文件：
- `test-chapter`：毕设论文系统测试章节……（详见 .agents/skills/test-chapter/SKILL.md）
- `thesis-proposal`：计算机类毕业设计开题报告……（详见 .agents/skills/thesis-proposal/SKILL.md）
<!-- bishe-doc-skills:end -->
```

README 里的承诺是："`AGENTS.md` 里你自己的内容会保留，重复安装只更新本工具的区块"。分批安装时索引会累积、`$&` 不会被当成替换符，这两个问题之前已经修过，测试也覆盖了。这次我换了个方向：不测安装器自己写出来的文件，而是测"用户动过之后"的文件。

## 现在的实现

```js
function upsertAgentsBlock(file, entries) {
  const start = `<!-- ${MARK}:start -->`, end = `<!-- ${MARK}:end -->`
  let cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const re = new RegExp(`${start}[\\s\\S]*?${end}\\n?`)
  const old = cur.match(re)
  // ……把旧区块里的条目和这次的条目合并、排序，拼成 block
  const next = old ? cur.replace(re, () => block) : (cur ? cur.replace(/\n*$/, '\n\n') : '') + block
  if (next === cur) return false
  fs.writeFileSync(file, next)
  return true
}
```

思路是"找到第一个 start，再往后找最近的 end，中间整段换掉；找不到就追加到文件末尾"。只要文件里的标记都是安装器自己写的，这样没问题。

## 测试方法

复现脚本在临时目录里直接调用 `install({ tool: 'codex', skills, dir })`，每个场景先准备一份 AGENTS.md，中间按需模拟用户的修改，最后检查三件事：用户写的"我的规则"还在不在、整行的 start 标记有几个、换行符是什么。用户内容统一是这三行：

```markdown
## 我的规则
- 不要改 dist/
- 提交前跑 npm test
```

环境 Node 24，仓库 HEAD `a408111`，原有 9 条测试和 `bin/check.js` 都通过。

## 1. 删掉 end 标记，第二次安装时才出事

用户觉得区块碍眼，删了几行，正好把 end 那行删了，然后在下面写自己的规则。之后又装了两次：

```text
--- 用户删掉了 end 标记，又在下面写了自己的规则
   报错: 无
   "我的规则"还在: 否；整行 start 标记 1 个；技能目录 3 个
```

过程是这样的：

1. 第一次再装：正则找不到"start……end"这一对，就当成没有区块，在文件末尾追加一个新的。这时文件里有两个 start、一个 end，用户的规则夹在中间，还在。
2. 第二次再装：正则从**第一个** start（就是残留的那个）匹配到新区块的 end，把中间的旧条目、用户的三行规则、新的 start 一起换掉了。

第一次看起来一切正常，第二次才把内容吞掉，而且安装器什么都没提示。用户要么看 git diff 才发现，要么根本发现不了。

## 2. 用代码块演示过区块格式

有人会在 AGENTS.md 开头写一段说明，告诉协作者"安装器会生成下面这样的区块，别手改"，然后贴一个示例：

````markdown
安装器会写入下面这样的区块：
```markdown
<!-- bishe-doc-skills:start -->
（自动生成）
<!-- bishe-doc-skills:end -->
```
````

装一次之后，代码块里的示例被换成了真实的技能列表，而真正的区块没有生成，整个文件里只有代码块里那一份。对读 AGENTS.md 的 Agent 来说，这段内容在代码块里，更像一段示例，而不是要遵守的规则。

## 3. 正文里顺手提了一句标记

比第 2 种更常见的是行内提一句：

```markdown
别手改 `<!-- bishe-doc-skills:start -->` 和 end 之间的内容。
```

第一次安装时只有 start 没有 end，追加新区块，没事。第二次安装，正则从这句话中间的 start 一直匹配到真正区块的 end：

```text
# 项目
别手改 `<!-- bishe-doc-skills:start -->
## 毕设文档技能
……
<!-- bishe-doc-skills:end -->
```

这句话后半截和"我的规则"三行都没了，反引号也只剩一个，后面的 Markdown 渲染全乱。

## 4. Windows 上的 CRLF

在 Windows 上开了 `core.autocrlf`，AGENTS.md 检出时是 CRLF。再装一次：

```text
   "我的规则"还在: 是；CRLF 行 6 / LF 行 6
```

新区块是用 `\n` 拼的，文件变成一半 CRLF、一半 LF。内容没丢，但 diff 很难看，有些编辑器打开时还会提示换行符不一致。

## 5. 合并分支后出现两个区块

两个分支各自装过一次，合并时 AGENTS.md 冲突，解决冲突的人两边都保留了。之后再装：只有第一个区块被更新，第二个区块里还是旧条目，`thesis-proposal` 在文件里出现两次。

## 改法：只认整行标记，拿不准就报错

正则匹配的问题在于它不知道文件结构：它分不清一行里的标记和整行标记，也分不清代码块内外。改成按行扫描：

```js
function findAgentsBlock(text) {
  const lines = text.split('\n')
  const starts = [], ends = []
  let fence = null
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '').trim()
    const f = line.match(/^(`{3,}|~{3,})/)
    if (f) { /* 进入或退出代码块 */ return }
    if (fence) return               // 代码块里的标记不算
    if (line === start) starts.push(i)  // 只认整行
    else if (line === end) ends.push(i)
  })
  if (!starts.length && !ends.length) return null
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new CliError('AGENTS.md 里的标记不成对或出现了多次……为避免覆盖你的内容没有修改它')
  }
  return { lines, from: starts[0], to: ends[0] }
}
```

几个取舍：

- **标记不成对时直接报错，不去猜。** 残留的 start 后面到底哪些是旧区块、哪些是用户后来写的，程序判断不了。猜错就是删用户的内容，报错只是让用户多花一分钟手动删一行。
- **先检查再写文件。** `install` 一开始就对 AGENTS.md 跑一遍 `findAgentsBlock`，出错时一个技能文件都不写，不会留下装了一半的状态。
- **换行符跟着文件走。** 原文件里有 `\r\n` 就用 CRLF，替换区块时每一行都补上 `\r`。
- 多个区块也报错，不自动合并。合并分支留下两个区块，说明有人手动处理过这个文件，让他再看一眼比较稳妥。

改完再跑同一份复现：

```text
1. 正常分批安装       → 我的规则在，区块累积 2 个技能（和原来一样）
2. 删掉 end 标记      → 报错，文件没动，没写技能文件
3. 代码块里有示例     → 示例原样保留，真正的区块追加在末尾
4. 正文提到标记       → 那句话原样保留，区块正常更新
5. CRLF 文件          → CRLF 11 行 / LF 0 行
6. 两个区块           → 报错，文件没动
```

补丁另外加了 3 条测试（不成对报错且不写文件、代码块和行内标记不算、CRLF 保持），在原代码上这 3 条失败，改后 12 条全部通过。补丁还没合进仓库。另外，vue-uniapp-skills 的安装器里有一份几乎一样的 `upsertAgentsBlock`，问题相同，打算一起改。

## 小结

往用户文件里写自动生成内容，Ansible 的 `blockinfile`、`conda init` 往 `.bashrc` 里写的 `>>> conda initialize >>>` 都是这个思路。我这次学到的是：

- 标记要按"整行"认，还要跳过代码块，不然用户写的说明文字也会被当成标记。
- 标记残缺时，宁可停下来报错，也不要按"最近的一对"去猜。第 1 种情况要装两次才出事，平时很难发现。
- 测试别只测自己生成的文件，要模拟用户删一行、贴示例、换行符被 git 改过、合并冲突这些情况。

仓库：https://github.com/MsNan/bishe-doc-skills

</div>
