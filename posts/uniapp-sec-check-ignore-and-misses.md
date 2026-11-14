---
title: "sec-check-ignore 写在行尾，下一行的支付密钥也被放过：给小程序安全扫描器找漏和误报"
date: 2026-11-14
category: 前端
tags: [uni-app, 小程序, Node.js, 安全]
description: "给 uniapp-sec-check 找漏：行尾 sec-check-ignore 会吞掉下一行支付密钥，字符串里的 getLocation 会误报，config.json 里的 http 原版扫不到。"
---

<div v-pre>


工具的测试全绿，并不等于它在真实写法里不会漏、也不会误报。这周我刚写完一个 uni-app / 微信小程序上线前的自查脚本，仓库测试 35 条全过，CI 在 Node 18/20/22 上是绿的。然后我把自己当成用户，按项目里常见的写法搭了十几个最小例子，专门找它的盲区。

脚本叫 uniapp-sec-check，当前提交是 c20d259，没发 npm。官方样例 bad-app 会扫出 10 个错误、10 个警告，密钥在报告里打成 `FAKE***（29 位）`，这些是它能抓住的部分，我在另一篇里写过。下面只谈原代码上复现过的漏报和误报。假数据都用 `FAKE_` 开头。

## 忽略注释比文档多吃一行

README 写的是：不想让某一行告警，就在该行或上一行写注释 `sec-check-ignore`。对应的实现是：

```js
if (l.includes(IGNORE_MARK)) { set.add(i + 1); set.add(i + 2); }
```

只要这一行出现标记，当前行号和下一行号都会放进忽略集合。上一行单独写注释时，这是对的；标记写在代码行尾时，下一行也会被放过：

```js
export const appSecret = 'FAKE***' // sec-check-ignore
export const apiV3Key = 'FAKE***'
```

原版扫描结果：SEC001 0 条，SEC002 0 条，合计 0 错误。第一行被忽略没问题，第二行的支付密钥是被「顺带」吃掉的。

对照一下文档里那种上一行注释的写法：

```js
// sec-check-ignore
export const LEGACY = 'http://legacy.example.com'
export const LIVE = 'http://api.example.com'
```

`legacy` 被忽略，`LIVE` 仍会报，这一条原版就是对的。问题只出在「行尾标记」。

我改成：行尾标记只忽略当前行；只有整行就是注释加这个标记时，才忽略下一行。补丁后，上面第一段代码会报出第 2 行的 `apiV3Key`（打码后 36 位），第一行仍然安静。

## 一句说明文字，被当成真的定位调用

帮助文案里写了接口名字，也会被当成调用：

```js
export const tip = "出错时请不要直接调用 uni.getLocation()，先检查权限"
```

原版给出 1 个 MAN004 错误（requiredPrivateInfos 没声明）、1 个 MAN006 警告（没有 scope.userLocation 的用途说明），再加 1 条隐私接口提示。错误级别，看起来像上线阻断。

原因是定位 / 隐私接口用的是去掉注释之后的整段代码，字符串字面量还在里面。`uni.getLocation()` 出现在引号里，照样匹配。Vue 模板上的 `open-type="getPhoneNumber"` 倒是应该保留，所以不能简单地把整个 `.vue` 文件的字符串都抹掉。

补丁里加了 `stripJsStrings`：把 JS 字符串内容换成空格，行号不变；`.vue` 文件只处理 `<script>` 内部，模板属性不动。改完后再扫这一行，MAN004、MAN006、PRV001 都是 0。官方样例里页面上那个真的 `uni.getLocation()` 仍然会报，35 条旧测试没有因此失败。

## 配置写在 JSON 里，http 就看不见了

不少项目把接口根地址放在 `config.json` 里，并不写进 JS：

```json
{ "baseURL": "http://api.example.com" }
```

原版 NET001 为 0。因为 http 规则只跑在 `.js` / `.ts` / `.vue` 上，`.json` 只参与密钥扫描。这个地址最后还是会打进小程序包，和写在 `request.js` 里没有本质区别。

补丁后这一条是错误级 NET001，行号在 `config.json:2`。`package.json` 和 `package-lock.json` 故意跳过，避免把依赖仓库地址也扫进来。

## 还有几处漏，都是按真实写法测的

这几条原版都是 0，补丁后能抓住：

把 `uni.getLocation()` 写成 `uni['getLocation']()`，原版的正则只认点号调用。这里有个细节：如果先把字符串内容抹掉再匹配，方括号里的名字也会被抹掉，所以括号取值这一路必须对着未抹字符串的源码匹配。

`uni.createCameraContext()` 没有进入「摄像头」分组，原名单只有 `createVKSession` 和 `<camera>` 标签。扫完 PRV001 是空的，不会提醒去《用户隐私保护指引》里声明摄像头。

如果目录是原生小程序——根上是 `app.json` 而不是 uni-app 的 `manifest.json`——原版只给一条警告：「没找到 manifest，跳过相关检查」。我在 `app.json` 里把 `requiredPrivateInfos` 写成空数组，页面里调用 `wx.getLocation`，MAN004 仍是 0。也就是说，最需要被拦住的「用了定位却没声明」，在这种目录结构下直接被跳过。补丁把 `app.json` 顶层的 `requiredPrivateInfos` / `permission` 接进同一套检查；原生小程序的 appid 一般写在 `project.config.json` 里，这里不会误报 appid 为空。

`.env.local` 里的 `WX_ACCESS_TOKEN` 不在原变量名名单里（有 SECRET、APIV3、MCH_KEY，没有 ACCESS_TOKEN）。`sslVerify: 0` 只认 `false`。只写 `import VConsole from 'vconsole/dist/vconsole.min.js'`、文件里没有 `new VConsole()` 时，也不会报（有 `new VConsole()` 的仍能抓住）。模板字符串 `` `http://${host}/api` `` 因为 `//` 后面不是主机名，原版匹配不到。vite 把 `drop: ... ? ['console'] : []` 拆成多行时，不会把 console 告警降成「构建时已移除」的提示。

有一条我刻意没改：`appSecret: 'FAKE_' + 'CONCAT_…'`。等号后面每一段都不足 8 个字符，原版 SEC001 为 0，补丁后仍是 0。要覆盖所有拼接写法容易误伤，先留在复现脚本里，免得以为已经扫全了。

## 补丁只在本地

改动都配了测试。原仓库 35 条在补丁上仍然全过；新加的 5 条在 c20d259 上会失败，合入后一共 40 条全过。补丁没有提交，也没有推送。

复现命令：

```bash
node daily/2026-11-14-sec-check-repro.mjs .scratch-1113/uniapp-sec-check-orig
node daily/2026-11-14-sec-check-repro.mjs .scratch-1113/uniapp-sec-check
```

写这类静态检查，我觉得有三条比「规则条数」更要紧：忽略注释的范围必须和文档一致，多吃一行就会把真密钥放走；匹配 API 时要分清「代码」和「说明文字」；配置不一定写在 JS 里，JSON 里的 http 跟源码里的是同一个问题。就算这几处都补上了，检查通过也不等于能过审或绝对安全，它只是把能静态判断的坑先排掉。

仓库：https://github.com/MsNan/uniapp-sec-check

</div>
