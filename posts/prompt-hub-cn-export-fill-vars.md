---
title: "一行命令导出 Cursor rules 和 Claude skills，回头补变量时 6 个文件全被跳过：「跳过」和「覆盖」之间缺一个选项"
date: 2026-11-13
category: 前端
tags: [Node.js, CLI, AI编程, JavaScript]
description: "prompt-hub-cn 导出 Cursor rules / Claude skills 的命令：先导出再 --set 全部跳过、--force 冲掉用户改动，补 --fill；变量名少空格静默失效；{{constructor}} 让 fillVars 抛错；--only 缺值和宽松 frontmatter 解析。"
---

<div v-pre>

prompt-hub-cn 是我整理的一个中文提示词库，其中有 6 条 Cursor rules 和 6 个 Claude skills 可以直接导出成文件：

```bash
npx -y github:MsNan/prompt-hub-cn . --only rules --set "UI 库=Element Plus"
```

rules 写到 `.cursor/rules/<名字>.mdc`，skills 写到 `.claude/skills/<name>/SKILL.md`。提示词里用 `{{变量}}` 占位，`--set` 负责替换。已经存在的文件默认跳过，加 `--force` 才会覆盖。测试 15 条全绿。

这周我把自己当成第一次用的人，照 README 从头走了一遍，碰到几个问题。下面每一条都用脚本复现过，原代码是仓库 d3b0006。

## 一、先导出、后补变量：第二次 6 个文件全部跳过

第一次用的人一般不知道有哪些变量，所以会先不带 `--set` 跑一次。跑完 CLI 会提示：

```text
✅ .claude/skills/release/SKILL.md  ← 还需要填写：主分支、检查命令
```

接着照提示补上变量，再跑一次：

```bash
npx -y github:MsNan/prompt-hub-cn . --only skills --set 主分支=main --set "检查命令=npm test"
```

结果：

```text
第二次 --set：跳过 6 个，写入 0 个；release 仍含 {{主分支}}： true
```

因为文件已经存在，"默认不覆盖"这条规则先生效，变量根本没机会替换。那就加 `--force`：

```text
加 --force 后：release 已填 = true ；我加在 code-review 里的那行还在 = false
```

变量是填上了，可我在 `code-review/SKILL.md` 末尾手动加的一条规则也被冲掉了。`--force` 是整个文件重写，它分不出哪个文件是你改过的。

"跳过"和"覆盖"中间少了一个选项：**只替换已有文件里还没填的占位，其他内容一个字不动**。补丁里加了 `--fill`：

```js
if (existsSync(target) && !force) {
  if (fill) {
    const old = readFileSync(target, 'utf8'), next = fillVars(old, values)
    if (next !== old) { writeFileSync(target, next); result.push({ path: f.path, status: 'filled', left: leftVars(next) }); continue }
  }
  result.push({ path: f.path, status: 'skipped' }); continue
}
```

这里对**磁盘上的文件**调用 `fillVars`，而不是拿仓库里的原文重新生成一份，所以用户加的内容会保留。占位已经被用户手动改掉的文件，`next === old`，照样跳过。

## 二、`--set "UI库=..."` 少一个空格，静默失效

变量名是中文，有的还带空格，比如 `UI 库`。少打一个空格：

```text
退出正常： true ；vue3.mdc 输出行： ✅ .cursor/rules/vue3.mdc  ← 还需要填写：UI 库
文件里还是占位： true
```

退出码是 0，输出里也确实写了"还需要填写：UI 库"，但很少有人会想到是自己 `--set` 写错了，多半以为工具没生效。

补丁加了一个 `unknownVars`：`--set` 的变量如果没有任何文件用到，就打一行警告；去掉空白后能对上某个变量名的，顺便提示一下：

```text
⚠️  --set 的变量「UI库」没有文件用到，是不是「UI 库」？
```

只警告、不报错。因为 `--only rules` 时传了 skills 才用的变量，也会落进这个提示，不能因为这个就退出。

## 三、`{{constructor}}` 会让 fillVars 直接抛错

```js
export function fillVars(text, values = {}) {
  return text.replace(/{{(.+?)}}/g, (m, k) => (values[k]?.trim() ? values[k] : m))
}
```

`values` 是普通对象。变量名如果刚好是 `constructor`、`toString`，`values[k]` 读到的是原型上的函数，`?.` 只防 `null`/`undefined`，函数没有 `trim`，于是：

```text
fillVars("{{constructor}}", {}) → TypeError: values[k]?.trim is not a function
```

反过来，`--set __proto__=x` 走的是 `__proto__` 的 setter，字符串不能当原型，这次赋值被直接忽略，`Object.keys(values)` 是空的。现在的提示词都没用到这些名字，但网页详情页的 `computed` 调的也是这个函数，以后数据里只要出现一个这样的变量名，详情页渲染就会报错。修起来很简单：读的时候用 `Object.hasOwn`，并且只接受字符串；写的时候用 `Object.defineProperty`。

## 四、两个老问题，在这个仓库又出现了一次

这两个问题我在 vue-uniapp-skills 和 bishe-doc-skills 里都写过，这次在 prompt-hub-cn 里又遇到了，只简单记一下：

- `--only` 写在最后、忘了写值：`argv[++i] ?? ''` 得到空字符串，后面的 `if (opts.only && ...)` 把它当成"没传"，结果 12 个文件全部导出（`共写入 12 个文件`）。补丁改成取值时检查缺值，或者值以 `-` 开头就报错。新写的 CLI 直接用 `node:util` 的 `parseArgs`，缺值时它会抛 `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`。
- 手写的 frontmatter 解析比 YAML 宽松，`check.js` 拿它做校验就拦不住一些写法。这次和 `yaml` 包对照，碰到的是之前没写过的三种：`globs: **/*.vue` 不加引号，`*` 会被当成别名，直接报 `Unresolved alias`；描述里写半角 `: `，报 `Nested mappings are not allowed`；描述里有 ` #`，后面的内容被当成注释，**悄悄截断、不报错**。现有 12 条用 YAML 解析全部通过（globs 都加了引号，冒号都是全角），属于碰巧没出事。导出命令要保持零依赖，所以补丁没有引入 YAML 库，而是在 check 里加了一个保守的 `yamlRisk`：值没加引号，又以特殊字符开头、或者包含"冒号+空格""空格+#"时，就要求加引号。

## 补丁和验证

补丁改了 `src/files.js`、`scripts/export.js`、`scripts/check.js`，另外加了 4 条测试：`--fill` 只补占位、保留用户内容；`--only` 缺值和 `unknownVars` 提示；`fillVars` 不读原型属性、CRLF frontmatter、`yamlRisk`；check 拦下不加引号的 glob。这 4 条在原代码上都失败，改完后 19 条全部通过，`npm run check` 仍然是 66 条通过。补丁还没合进仓库。

有两个行为变化要说明：以前 `--only` 缺值时会"顺手"导出全部，改完后会报错退出；frontmatter 值的写法比以前严格，以后提 PR 的规则可能要多加引号。

## 小结

- "不覆盖"和"全覆盖"之间，最好留一个"只改我负责的那部分"的选项。
- 参数名是中文、还带空格时，写错了要能提示出来，退出码为 0 不代表用户的意图生效了。
- 自己写的简化解析器拿来做校验时，要清楚它和真实解析器差在哪，差的地方要么补检查，要么写进文档。同一类问题在三个仓库里各出现了一次，说明值得抽成公共代码。
- 用普通对象当字典查用户给的键，要用 `Object.hasOwn`。

仓库：https://github.com/MsNan/prompt-hub-cn

</div>
