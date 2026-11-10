---
title: "curl | bash 的安装脚本下载到一半断了会怎样？我把脚本在每个字节处截断跑了一遍"
date: 2026-11-10
category: 前端
tags: [Shell, Bash, Node.js, CLI]
description: "vue-uniapp-skills 的 curl | bash 安装脚本复现：下载失败与代理网页、Node 版本检查的真实意义、逐字节截断脚本后有几处会变成全量安装，以及为什么用 { } 包住整个脚本比 main \"$@\" 更稳。"
---

<div v-pre>

我维护的 vue-uniapp-skills 是一组 Vue3 + uni-app 的 AI 编程技能，安装有两条路：`npx -y github:MsNan/vue-uniapp-skills`，或者一行 curl：

```bash
curl -fsSL https://raw.githubusercontent.com/MsNan/vue-uniapp-skills/main/install.sh | bash -s -- --tool cursor
```

`install.sh` 本身只有十来行：检查 node、建临时目录、下载 main 分支的 tarball 解压、把参数原样交给 `bin/cli.js`。前两天刚改过一版（commit `5609ff0`）：加了 `set -o pipefail`，下载失败时提示改用 npx，检查 Node 主版本 >= 16，还补了离线的端到端测试。

改完我又多问了一句：这个脚本还会在哪些情况下表现得不对？于是把旧版（`2c9fbd2`）、当前版（`5609ff0`）和我后来改的版本放在一起，用同一套假环境跑了一遍。

## 测试环境：PATH 里放一个假 curl

不联网，做法跟仓库里的测试一样：在临时目录写一个叫 `curl` 的脚本，放到 `PATH` 最前面，按模式返回本地打包的 tarball、直接失败，或者返回一段 HTML。`TMPDIR` 也指到一个空目录，跑完看里面有没有残留，就知道 `trap` 清理有没有生效。

```js
fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
spawnSync('bash', ['-s', '--', ...args], {
  cwd, input: scriptText, encoding: 'utf8',
  env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, TMPDIR: t }
})
```

脚本内容从 stdin 喂给 `bash -s --`，跟 `curl ... | bash -s -- --tool cursor` 的执行方式一致。环境是 Node 24.22.1、GNU bash，正常安装三个版本都是 exit 0、只写 `.cursor`、临时目录清理干净。

## 1. 下载失败：退出码对了，报错还是 gzip

curl 返回 22（比如 404）时：

```text
旧版  exit=2  curl: (22) ... 404 | gzip: stdin: unexpected end of file | tar: Child returned status 1 | tar: Error is not recoverable: exiting now
当前  exit=1  （同上四行）| 下载失败：https://codeload.github.com/... | 可以改用 npx -y github:MsNan/vue-uniapp-skills，或检查网络/代理后重试
```

其实旧版在下载失败时也是非零退出的：`set -e` 虽然只看管道最后一个命令的退出码，但 tar 读到空输入自己就会失败。问题在于用户看到的是一串 gzip/tar 的报错，第一反应是"压缩包坏了"。

当前版本加了提示，但 tar 那几行还在，因为 `curl | tar` 管道里 tar 照样会跑完再失败。想让输出干净，就别用管道，先落盘再解压：

```bash
if ! curl -fsSL "$URL" > "$TMP/main.tar.gz"; then
  echo "下载失败：$URL" >&2
  ...
fi
```

改完后下载失败只剩 curl 自己那一行，加上我们的两行提示。

## 2. 代理返回了 200 的网页：curl -f 拦不住

`-f` 只在 HTTP 状态码 >= 400 时让 curl 失败。公司网关、酒店 Wi-Fi 认证页这类情况，返回的是 200 加一个 HTML 页面，curl 认为下载成功了。我让假 curl 输出一段 `<!DOCTYPE html>...Wi-Fi 认证...`：

```text
旧版  exit=2  gzip: stdin: not in gzip format | tar: Child returned status 1 | ...
当前  exit=1  gzip: stdin: not in gzip format | ... | 下载失败：https://codeload.github.com/...
```

当前版本这时也说"下载失败"，但下载其实是成功的，只是内容不对。用户照着提示去检查网络，网络是通的，容易绕进去。分开下载和解压之后，这两种情况就能给不同的提示：

```bash
if ! tar -xzf "$TMP/main.tar.gz" -C "$TMP" 2>/dev/null; then
  echo "下载到的内容不是 tar.gz，开头是：$(head -c 60 "$TMP/main.tar.gz" | tr -d '\r\n')" >&2
  echo "多半是代理或网关返回了网页；可以改用 npx -y github:MsNan/vue-uniapp-skills" >&2
  exit 1
fi
```

实际输出：

```text
下载到的内容不是 tar.gz，开头是：<!DOCTYPE html><html><head><title>Wi-Fi 认证</title></head
```

把内容开头打出来，一眼就知道被谁拦了。

## 3. Node 版本检查：旧版本其实能跑，检查的意义在别处

当前版本加了这两行：

```bash
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 16 ] 2>/dev/null || { echo "需要 Node.js >= 16，当前是 $(node -v)" >&2; exit 1; }
```

我好奇低版本到底会怎样，就下载了 Node 10.24.1、12.22.12、14.21.3 的官方二进制，直接跑 `bin/cli.js` 全量安装：

```text
v24.22.1  条目数=81 摘要=c71d99359f1e
v10.24.1  exit=0 条目数=81 摘要=c71d99359f1e
v12.22.12 exit=0 条目数=81 摘要=c71d99359f1e
v14.21.3  exit=0 条目数=81 摘要=c71d99359f1e
```

（摘要是所有生成文件逐个 sha1 后再 sha1 一次。）第一次全新安装，四个版本的产物完全一样。

但换个场景就不一样了。用 Node 10 先装一个 codex 技能，再用 `-s` 补装第二个：

```text
TypeError: old[0].matchAll(...) is not a function or its return value is not iterable
```

`cli.js` 合并 `AGENTS.md` 里已有的索引块时用了 `String.prototype.matchAll`，这是 Node 12 才有的。第一次安装还没有旧块，走不到这一行，所以看起来一切正常。同样的操作 Node 12 就能通过。

所以这个检查的意义不在于"14 一定会崩"，而是只承诺测过的版本：它跟 `package.json` 的 `engines: >=16` 和 CI 的 18/20/22 对齐。上面 Node 10 这种"大部分时候能用、某条分支突然报错"的情况，比直接拒绝更难排查。用户看到一句"需要 Node.js >= 16"，比看到一个 `TypeError` 强。顺带一提，走 npx/npm 那条路时 `engines` 默认只是警告，我用 npm 11.21.1 装一个 `engines: >=99` 的包，只打了 `npm warn EBADENGINE`，照常安装。curl 这条路的检查反而更严格。

不过这两行有个小漏洞：`set -e` 下，`NODE_MAJOR=$(...)` 里的命令失败会直接让脚本退出。nvm、fnm 这类版本管理器的 shim 指向一个没装的版本时就会这样。我用一个打印 `N/A: version "v18" is not yet installed.` 并 exit 3 的假 node 试了一下：

```text
当前  exit=3  stderr: N/A: version "v18" is not yet installed.
改后  exit=1  stderr: 需要 Node.js >= 16，当前是 无法运行的 node
```

当前版本的提示其实也能看懂，只是我们自己那句没机会说出来。改法是给命令替换兜个底：

```bash
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || NODE_MAJOR=""
```

## 4. 脚本下载到一半断了：有 3 个截断位置会变成全量安装

这是这次最想验证的一点。`curl | bash` 是边下载边执行的：bash 从管道里读一行、执行一行。如果连接在中途断了，bash 会执行它已经读到的部分，最后那半行也会执行。

我把脚本在每一个字节位置截断，分别喂给 `bash -s -- --tool cursor`，看结果：

```text
旧版  430 个截断点：什么都没做 424，只装了 cursor 1，装了别的工具 3，在当前目录解出了源码 2
当前  777 个截断点：什么都没做 773，只装了 cursor 1，装了别的工具 3
```

"只装了 cursor"那 1 个是完整脚本只少了末尾换行，这是正确结果。问题是"装了别的工具"那 3 个，都截在最后一行：

```text
node "$TMP"/vue-uniapp-skills-main/bin/cli        → .agents .claude .cursor .trae AGENTS.md
node "$TMP"/vue-uniapp-skills-main/bin/cli.js     → 同上
node "$TMP"/vue-uniapp-skills-main/bin/cli.js␠    → 同上
```

`"$@"` 没下载到，cli 收不到 `--tool cursor`，就按默认值把四种工具全装了，还在项目根目录写了一个 `AGENTS.md`。第一个截断点只到 `cli`，没有 `.js` 也能跑，是因为 node 解析入口文件时会自动补 `.js`。

旧版另外 2 个更离谱，截在 `| tar -xz` 后面、`-C "$TMP"` 前面：

```text
curl -fsSL https://codeload.github.com/... | tar -xz     → 当前目录多了 vue-uniapp-skills-main/
```

整个仓库源码被解压到了用户的项目目录里。当前版本把这一行放进了 `if ...; then ... fi`，bash 要读到 `fi` 才会执行整个 if，所以这个问题已经顺带消失了。

还有 26 个截断点会留下临时目录，都在 `TMP=$(mktemp -d)` 之后、`trap` 那行完整读到之前，影响不大。

### 为什么常见的 main 函数写法还不够

常见的做法是把逻辑包进函数，最后一行 `main "$@"`。我也按这个写法包了一份当前脚本试了一下：

```text
func  798 个截断点：什么都没做 795，只装了 cursor 1，装了别的工具 2
      例：最后一行 "main" → .agents .claude .cursor .trae AGENTS.md
```

函数体被截断时确实会因为缺少 `}` 报语法错误，但最后一行恰好截成 `main` 或者 `main␠` 时，函数是完整的，调用时没带参数，结果跟上面一样。（rustup 的安装脚本把 `main "$@" || exit 1` 放在一个 `case ... esac` 里面，正好避开了这个问题，不知道是不是有意的。）

我最后用的是把整个脚本放进一个 `{ ... }` 代码块，块的最后加一个 `exit`：

```bash
#!/usr/bin/env bash
{
set -eo pipefail
# ...原来的全部内容...
node "$TMP"/vue-uniapp-skills-main/bin/cli.js "$@"
exit
}
```

bash 必须读到最后那个 `}` 才会开始执行这一整块，读不到就报 `syntax error: unexpected end of file`，一行都不执行。结果：

```text
改后  1429 个截断点：什么都没做 1428，只装了 cursor 1
```

唯一会执行的那个截断点就是只缺最后一个换行的完整脚本。块里的 `exit` 保证即使 `}` 后面还有别的内容，也不会被执行。

## 5. 把这些情况写进测试

仓库里的 `test/install-sh.test.js` 已经有假 curl 的骨架，我在 `run()` 里加了一个 `input` 参数，传了就用 `bash -s --` 从 stdin 读脚本，然后补了两条用例：

```js
test('install.sh：curl | bash 中途断开时不执行半截脚本', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  // 截在最后一条 node 命令的 cli.js 之后、"$@" 之前
  const cut = src.indexOf('cli.js "$@"') + 'cli.js'.length
  const proj = tmp()
  run(['--tool', 'cursor'], { cwd: proj, input: src.slice(0, cut) })
  assert.deepStrictEqual(fs.readdirSync(proj), [])
})
```

另一条是代理返回 HTML 时要出现"不是 tar.gz"的提示。用当前的 `install.sh` 跑，这两条新用例失败，其余 4 条 install.sh 用例通过；换上改后的脚本，全部 15 条测试通过（原来 13 条加 2 条新的）。这个补丁我还没合进仓库。

## 小结

- `curl -f` 只管 HTTP 状态码，200 的错误页面要靠解压或者校验内容来发现。
- 管道里的报错会混在一起，下载和解压分两步，提示才说得准。
- 版本检查的价值不一定是"防崩溃"，也可以是"只承诺测过的版本"，前提是它自己别在命令替换上先退出。
- `curl | bash` 要防的不只是下载失败，还有下载了一半。把整个脚本放进 `{ }`，比 `main "$@"` 少两个漏洞，这次是把每个截断点都跑了一遍才看出来的。

复现脚本跑一遍二十来秒，大部分时间花在那一千多次截断测试上。

仓库：https://github.com/MsNan/vue-uniapp-skills

</div>
