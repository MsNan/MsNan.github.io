---
title: "不发 npm 也能 npx：用 github: 协议分发一个零依赖 CLI"
date: 2026-10-21
category: 前端
tags: [Node.js, npm, CLI, GitHub]
description: "不发 npm，用 npx -y github: 分发零依赖 CLI。npx 拉取 git 依赖的过程，bin、files、version 的写法，软链接让入口判断失效，以及 npx 多装 19M 依赖的原因。"
---

前几天给自己的提示词仓库 prompt-hub-cn 加了一个小功能：把里面的 6 条 Cursor rules 和 6 个 Claude skills 直接写进当前项目的 `.cursor/rules/` 和 `.claude/skills/` 目录。功能本身只是一个一百行不到的 Node 脚本，只用了 `node:fs`、`node:path`、`node:url` 这几个内置模块。

问题是怎么让别人用。让人先 `git clone` 再 `node scripts/export.js`，步骤太多；发到 npm 上又觉得为了一个小脚本去注册账号、起包名、每次改完都发版，有点重。最后用的是 npm 自带的 git 依赖：

```bash
npx -y github:MsNan/prompt-hub-cn .
```

在一个空目录里跑一下，输出是这样的：

```
✅ .cursor/rules/vue3.mdc  ← 还需要填写：UI 库
✅ .cursor/rules/api.mdc  ← 还需要填写：测试框架
✅ .cursor/rules/commit.mdc  ← 还需要填写：模块示例
✅ .cursor/rules/test.mdc
✅ .cursor/rules/docs.mdc  ← 还需要填写：占位符示例
✅ .cursor/rules/uniapp.mdc  ← 还需要填写：目标平台
✅ .claude/skills/code-review/SKILL.md  ← 还需要填写：对比分支
...
共写入 12 个文件到 /tmp/proj
```

用起来确实就是一行。但从"能跑"到"跑得对"，中间有几个地方我一开始没想到，有一个还是写这篇文章时实测才发现的。下面按顺序记录。文中的命令我都在 Node 20.19.2（npm 11.21.0）上跑过，`github:` 这条主命令另外在 Node 22.23.3（npm 10.9.9）和 24.22.0（npm 11.19.1）上也确认过能用。

## npx github: 到底做了什么

先把过程看清楚，后面的坑才好理解。用一个干净的缓存目录跑一遍，再去翻 npm 的日志和安装结果：

```bash
export NPM_CONFIG_CACHE=/tmp/cache-gh
npx -y --loglevel silly github:MsNan/prompt-hub-cn --help
```

日志里有一行很关键：

```
npm http fetch GET 200 https://codeload.github.com/MsNan/prompt-hub-cn/tar.gz/fcb5e885fb2a9d1e6a7d8643b1fe4af9462ed93a
```

也就是说，npm 先把 `github:MsNan/prompt-hub-cn` 解析成默认分支最新的那个完整 commit，再去 codeload 下载这个 commit 的源码压缩包。解析 commit 这一步是调用本机的 `git` 完成的，我把 `git` 从 PATH 里拿掉再跑，直接报错：

```
npm error code ENOENT
npm error syscall spawn git
npm error path git
npm error errno -2
npm error enoent An unknown git error occurred
```

所以用这种方式分发，使用者的机器上必须装了 git。这一点值得写进 README。

下载下来的源码会按 package.json 的规则打包一次，然后装进 `~/.npm/_npx/<hash>/node_modules`（我这里把缓存目录指到了 `/tmp/cache-gh`）。这个目录里有一份自动生成的 package.json 和 lock 文件：

```json
"node_modules/prompt-hub-cn": {
  "version": "0.2.0",
  "resolved": "git+ssh://git@github.com/MsNan/prompt-hub-cn.git#fcb5e885fb2a9d1e6a7d8643b1fe4af9462ed93a",
  "bin": {
    "prompt-hub-cn": "scripts/export.js"
  }
}
```

最后 npm 在 `node_modules/.bin` 下面建一个和 bin 同名的链接，执行它，并把包名后面的参数原样传过去：

```
$ ls -la node_modules/.bin
lrwxrwxrwx  prompt-hub-cn -> ../prompt-hub-cn/scripts/export.js
```

记住这个 `.bin` 是软链接，后面第一个坑就出在这里。

## package.json 需要哪几个字段

仓库本身是一个 Vite + Vue3 的网站，package.json 里跟命令行相关的是这几项：

```json
{
  "name": "prompt-hub-cn",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "bin": {
    "prompt-hub-cn": "scripts/export.js"
  },
  "files": [
    "scripts/export.js",
    "src/files.js",
    "src/data"
  ],
  "engines": {
    "node": ">=20"
  }
}
```

逐个说一下：

- `bin`：npx 靠它找到要执行的文件。只有一个 bin 时，名字叫什么都能跑，我把它改成 `phc` 试过，照样执行。但如果写了两个 bin，并且没有一个和包名同名，npx 会报 `npm error could not determine executable to run`，这时使用者得写成 `npx -p github:xxx/yyy phc` 才行。一个仓库只放一个命令，名字和包名保持一致，最省事。
- `type: "module"`：脚本用的是 ESM 的 `import`，文件后缀是 `.js`，所以需要这一项。
- `private: true`：这个字段只阻止 `npm publish`，对 git 依赖没有任何影响，网站项目原来就有，不用删。
- `files`：决定装到使用者机器上的是哪些文件，下面单独说。

另外，入口文件第一行必须是 shebang：

```js
#!/usr/bin/env node
```

我把这一行删掉试了一下，`.bin` 里的链接会被 shell 当成脚本执行，报一串莫名其妙的错：

```
.../node_modules/.bin/prompt-hub-cn: 3: import: not found
.../node_modules/.bin/prompt-hub-cn: 4: import: not found
```

可执行权限倒是不用太担心。我在仓库里提交的是 `100755`，但特意 `chmod -x` 再提交一次测试，装完以后 `.bin` 指向的文件还是 `-rwxr-xr-x`，npm 会自己补上。

## 坑一：判断"是否被直接执行"，要先 realpath

`scripts/export.js` 有两个用途：一是被命令行直接执行，二是被测试文件 import，用来测里面的 `parseArgs` 和 `exportFiles`。所以文件末尾需要判断一下自己是不是入口文件，是的话才去解析参数、写文件，否则只导出函数。

比较常见的写法是这样：

```js
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
```

这种写法在本地 `node scripts/export.js` 时没有问题，可一旦走 npx，这个判断就是 false。我在脚本里临时加了两行打印，通过 npx 执行：

```
argv[1] = /tmp/cache-debug/_npx/1f5c2dfc6060597f/node_modules/.bin/prompt-hub-cn
import.meta.url = file:///tmp/cache-debug/_npx/1f5c2dfc6060597f/node_modules/prompt-hub-cn/scripts/export.js
```

`process.argv[1]` 是 `.bin` 里那个软链接的路径，`import.meta.url` 则是 Node 解析软链接之后的真实路径，两者永远对不上。最麻烦的是它不报错：我用上面那种写法构造了一个版本，`npx` 跑完退出码是 0，没有任何输出，目标目录里一个文件都没有。用户只会觉得"这个命令什么都没干"。

现在仓库里的写法是先把 `argv[1]` 变成真实路径再比较：

```js
const isMain = () => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}
if (process.argv[1] && isMain()) {
  // 解析参数、写文件……
}
```

`try/catch` 是为了 `node -e`、REPL 这类没有 `argv[1]` 或者路径不存在的场景，`realpathSync` 会抛错，这时当成"不是入口"处理。

为了确认不是我理解错，我又单独写了一个最小例子：`real/cli.mjs` 打印各种判断结果，再建一个软链接 `link` 指向它，分别用三个版本的 Node 执行 `node ./link`：

| 判断方式 | Node 20.19.2 | Node 22.23.3 | Node 24.22.0 |
| --- | --- | --- | --- |
| 直接比较 `argv[1]` | false | false | false |
| 先 `realpathSync` 再比较 | true | true | true |
| `import.meta.main` | undefined | true | true |

`import.meta.main` 是 Node 新加的属性，专门回答"我是不是入口模块"，软链接的情况也处理好了；被别的模块 import 时它是 false，我也试过。如果你的 CLI 只支持新版本 Node，用它最省心。但这个仓库的 `engines` 写的是 `>=20`，20 上它是 `undefined`，所以我还是保留了 `realpathSync` 的写法。

这个坑的另一个教训是测试要覆盖真实的调用方式。仓库里现有的"命令行可以直接运行"那条用例是用 `execFileSync(process.execPath, ['scripts/export.js', ...])` 直接执行脚本，不经过软链接，就算入口判断写错了也测不出来。可以再加一条模拟 `.bin` 的用例：

```js
test('通过软链接调用（模拟 npx 的 .bin）也能执行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phc-link-'))
  try {
    const link = join(dir, 'prompt-hub-cn')
    symlinkSync(resolve('scripts/export.js'), link)
    const out = execFileSync(link, [join(dir, 'proj'), '--only', 'rules'], { encoding: 'utf8' })
    assert.match(out, /共写入 6 个文件/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
```

我在本地副本上用这条用例分别跑了两个版本的代码：用 `realpathSync` 的版本 `ok 1`；直接比较的版本 `not ok 1`，断言里 `actual: ''`，正好对应"什么都没输出"。

## 坑二：files 漏写一个文件，本地完全发现不了

`files` 是白名单，只有列出来的文件（加上 package.json、README、LICENSE 这几个固定会带上的）才会装到使用者那边。`export.js` 依赖 `src/files.js` 和 `src/data/` 下的数据，少写一个，本地仓库里怎么跑都没问题，通过 npx 一跑就是：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../node_modules/prompt-hub-cn/src/files.js' imported from .../node_modules/prompt-hub-cn/scripts/export.js
```

这是我故意从 `files` 里删掉 `src/files.js` 构造出来的。

那不写 `files` 行不行？也能跑，但会把整个仓库都装过去。我试了一下，没有 `files` 时 npm 会先给一个警告：

```
npm warn gitignore-fallback No .npmignore file found, using .gitignore for file exclusion.
```

然后装进去 29 个文件、956K，包括网站的 Vue 组件、截图、GitHub Actions 配置，全是命令行用不上的。

检查打包结果最直接的办法是 `npm pack --dry-run`，它会列出最终包含的文件：

```
npm notice 📦  prompt-hub-cn@0.2.0
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 4.9kB README.md
npm notice 735B package.json
npm notice 3.2kB scripts/export.js
npm notice 550B src/data/index.js
npm notice 11.7kB src/data/p1.js
npm notice 14.6kB src/data/p2.js
npm notice 17.9kB src/data/p3.js
npm notice 1.4kB src/files.js
...
npm notice total files: 9
```

## 坑三：没有 version，npm pack 直接拒绝

这个仓库 v0.1.0 的时候只是一个网站，package.json 里没有 `version` 字段，网站构建用不到它。加命令行功能时我补上了 `"version": "0.2.0"`。

需要说明的是，我专门把 `version` 删掉试过，`npx github:` 本身并不在乎，照样能装能跑，lock 文件里只是少了 `version` 这一行。真正会报错的是上面那个自检命令：

```
$ npm pack --dry-run
npm error Invalid package, must have name and version
```

也就是说，没有 version 你就没法用 `npm pack` 检查 `files` 的结果。再加上 version 还能让使用者在 lock 文件里一眼看出装的是哪个版本，配合下面说的 tag 固定版本也更直观，没理由不写。

## 坑四："零依赖"的脚本，npx 却装了 19M

这是写这篇文章时才发现的，也是我觉得最值得说的一点。

`export.js` 一个第三方依赖都没有，但第一次跑完 npx，我去看了一眼安装目录：

```
$ ls node_modules
@babel  @jridgewell  @vue  csstype  entities  estree-walker  magic-string
nanoid  picocolors  postcss  prompt-hub-cn  source-map-js  vue
$ du -sh node_modules
19M	node_modules
```

原因很简单：这个仓库同时是一个 Vue 网站，`vue` 写在 `dependencies` 里。npm 安装 git 依赖和安装普通包一样，会把它的 `dependencies` 一起装上，它并不知道你只想用里面的 bin。

还有一个更隐蔽的开销。npm 的日志目录里，除了 npx 自己的日志，还多了一份：

```
verbose title npm install
verbose argv "install" "--force" ... "--include" "dev" "--include" "peer" "--include" "optional" ...
verbose cwd /tmp/cache-gh/_cacache/tmp/git-clonekXS4BX
```

npm 在一个临时目录里把仓库的完整依赖（包括 devDependencies，vite、rolldown、lightningcss 都在里面）装了一遍。翻了一下 npm 用来拉取 git 依赖的 pacote 源码，触发条件是这段：

```js
if (!mani.workspaces && (!scripts || !(
  scripts.postinstall ||
    scripts.build ||
    scripts.preinstall ||
    scripts.install ||
    scripts.prepack ||
    scripts.prepare))) {
  return
}
```

只要 package.json 的 scripts 里有 `build`、`prepare`、`prepack` 等任意一个，npm 就认为这个 git 依赖需要"准备"，先在临时目录里执行一次带 dev 依赖的 `npm install`。我的网站项目恰好有 `"build": "vite build"`。有意思的是，它只为了 `prepare` 去装依赖，`build` 脚本本身并不会被执行，临时目录用完就删，装的这些东西对使用者来说纯粹是浪费。我加了一个 `"prepare"` 脚本，在里面把临时目录的 `node_modules` 列出来验证过，vite 确实在里面。

为了看清楚两个因素各自的影响，我在本地建了一个仓库副本，用 `git+file://` 协议代替 `github:`（走的是同一套 git 依赖逻辑，只是不经过网络），每次清空缓存后执行一遍，统计 npm 日志里成功的网络请求数、最终的 `node_modules` 大小和缓存目录大小：

| package.json 状态 | 网络请求 | node_modules | npm 缓存 |
| --- | --- | --- | --- |
| 现状：vue 在 dependencies，有 build 脚本 | 63 | 19M | 42M |
| 只把 vue 挪到 devDependencies | 37 | 104K | 29M |
| 只把 build 改名为 build:site | 48 | 19M | 18M |
| 两个都改 | 0 | 104K | 64K |

两个都改之后，安装过程不再访问 npm registry，只剩一次 git 拉取。耗时我各跑了两次只计 npx 本身：现状是 3.27 秒和 3.30 秒，两个都改之后是 1.18 秒和 1.14 秒。这是本地 `git+file` 的数字，真实的 `github:` 还要加上下载 codeload 压缩包的时间，我这边第一次冷启动整体是 7 秒左右。

改法：

```json
"scripts": {
  "build:site": "vite build"
},
"devDependencies": {
  "@vitejs/plugin-vue": "^6.0.10",
  "vite": "^8.3.4",
  "vue": "^3.5.44"
}
```

`vue` 挪到 devDependencies 不影响网站，Vite 构建时会把它打进产物，我用改过的 package.json 跑了一遍 `npm run build:site`，正常输出 `dist/`。`build` 改名之后，CI 里原来的 `npm run build` 也要一起改，否则部署会挂。写这篇文章的时候，仓库里的 package.json 还是表格第一行的状态。

如果你的仓库也是"一个项目 + 顺带一个命令行工具"，建议跑完 npx 之后去 `~/.npm/_npx` 下面看一眼到底装了什么。

## 坑五：参数的位置，以及更新和固定版本

包名后面的参数会原样传给你的脚本，包名前面的参数归 npm。脚本里有个 `--force`（覆盖已存在的文件），npm 自己也有一个 `--force`，位置不同效果完全不同：

```
$ npx -y github:MsNan/prompt-hub-cn . --only rules --force
✅ .cursor/rules/vue3.mdc  ← 还需要填写：UI 库

$ npx --force -y github:MsNan/prompt-hub-cn . --only rules
npm warn using --force Recommended protections disabled.
⏭  .cursor/rules/vue3.mdc（已存在，加 --force 覆盖）
```

第二种写法 `--force` 被 npm 吃掉了，脚本根本没收到，文件也没覆盖。README 里的示例最好统一把选项写在最后。

`-y` 是跳过安装确认。不加的话，第一次执行会停下来问：

```
Need to install the following packages:
github:MsNan/prompt-hub-cn
Ok to proceed? (y)
```

在 CI 或者脚本里没人回答，所以示例命令里我都带上了 `-y`。

关于更新：npx 每次执行都会重新解析一次分支对应的 commit，和缓存里装过的比较，不一样就重装。我在本地仓库副本上验证过：先跑一次，再提交一个修改了帮助文字的 commit，同样的命令第二次执行，输出就变成了新版本的内容。好处是使用者永远拿到最新的；代价是每次都需要访问 GitHub，而且主分支上的任何改动都会立刻影响所有人。第二次执行没有变化时会快很多，我这边从冷启动的 7 秒降到 1.6 秒左右。

如果希望使用者用一个固定的版本，可以在后面加 `#`：

```bash
# 固定到某个 commit，短 hash 也可以
npx -y github:MsNan/prompt-hub-cn#fcb5e88 .
# 固定到 tag
npx -y github:MsNan/prompt-hub-cn#v0.2.0 .
# 按 semver 匹配 tag
npx -y "github:MsNan/prompt-hub-cn#semver:^0.2.0" .
```

短 hash 我是直接对 GitHub 上的仓库试的；tag 和 `semver:` 这两种我在本地副本上打了一个 `v0.2.0` 的 tag 验证过，主分支已经往前走了一个 commit，两种写法拿到的都是 tag 那个版本。`semver:` 里有 `^` 这类符号，保险起见整体加上引号。

## 什么时候还是该发 npm

用下来，`github:` 适合这种场景：工具很小，使用者不多，主要是自己和熟人用，不想维护发版流程。它的限制也很明确：使用者必须装 git、能访问 GitHub；没有 registry 那样的版本范围和下载统计；每次执行都要联网解析 commit。另外我手上没有 Windows 环境，npm 在 Windows 上会为 bin 生成 `.cmd` 包装文件而不是软链接，`realpathSync` 那一段在那边的表现我没有实测，不敢打包票。

如果哪天用的人多了，需要语义化版本、离线缓存或者更快的安装，再去发 npm 也不迟。到那时 package.json 里的 `bin`、`files`、`version` 都已经是现成的，`npm pack --dry-run` 的结果就是最终发布的内容。

最后把检查清单列一下，给同样想这么做的人参考：

1. 入口文件第一行写 shebang，`type` 和文件后缀对应好。
2. 判断入口文件时先 `realpathSync(process.argv[1])`，并补一条通过软链接调用的测试。
3. 写 `files` 白名单，用 `npm pack --dry-run` 检查，所以 `version` 也要有。
4. 命令行用不到的依赖不要放在 `dependencies` 里；scripts 里避免 `build`、`prepare`、`prepack` 这些会触发 git 依赖准备的名字，除非你确实需要。
5. README 里的示例把选项放在包名后面，带上 `-y`，注明需要 git。
6. 需要稳定版本就打 tag，让使用者用 `#tag` 固定。

完整代码在 https://github.com/MsNan/prompt-hub-cn
