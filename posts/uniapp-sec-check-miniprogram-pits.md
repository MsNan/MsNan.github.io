---
title: "uni-app 小程序上线前扫了一遍：AppSecret 写进前端、http 地址、requiredPrivateInfos 漏声明，扫描器自己也会误报和漏报"
date: 2026-11-14
category: 前端
tags: [uni-app, 小程序, Node.js, 安全]
description: "uniapp-sec-check c20d259 实测：bad-app 扫出 10 个错误；sec-check-ignore 行尾会吞下一行，config.json 的 http 漏报，字符串里的 getLocation 会误报；本地补丁未推送。"
---

<div v-pre>


这周我给自己的 uni-app / 微信小程序项目写了一个上线前检查脚本，叫 uniapp-sec-check。一条命令离线扫 20 条确定性规则：有没有把 AppSecret、支付密钥、私钥写进前端，请求是不是还在用 http，manifest 里 requiredPrivateInfos 和 permission.desc 有没有漏，隐私接口要不要去后台声明，以及 vConsole、setEnableDebug 这类调试残留。

它不联网、零依赖，密钥在报告里会打码。有错误时退出码 1，可以放进 CI。没发 npm，只能 `npx -y github:MsNan/uniapp-sec-check`。仓库当前 HEAD 是 c20d259，官方测试 35 条全绿，GitHub Actions 在 Node 18/20/22 上通过。

先说清楚边界：检查通过只代表这 20 条规则没命中，不等于能过审，更不是绝对安全。我也没有在真实上线的商业项目上验证过，只在仓库自带的 fixtures，以及我们另一个联调实验室 uniapp-wx-lab 的示例页上跑过。示例页本身不是完整的 uni-app 工程（没有 manifest.json），所以只报了一条「找不到 manifest」的警告，不能当成一次完整的上线扫描。

下面的数字都是脚本实测。假密钥全部是 `FAKE_` 开头，报告里只会看到 `FAKE***（29 位）` 这种打码。

## 一、fixtures 里一眼能看到的坑

官方样例 `test/fixtures/bad-app` 是故意写坏的：

```text
合计：10 错误，10 警告，6 提示
退出码 1
```

`clean-app`（Vite 布局，manifest 在 `src/`）是 0 错误 0 警告，2 条提示，退出码 0。

这 10 个错误大致是 8 类上线前常见问题。

**1. AppSecret / 支付密钥写进前端。** `config/wx.js` 里有写死的 `appSecret` 和 `apiV3Key`，`.env.production` 里还有 `VITE_WX_APP_SECRET`。VITE_ / VUE_APP_ / UNI_ 前缀的变量会被打进小程序包，等于把密钥发布出去。微信自己的安全指引也写了：小程序代码可被外部获取，AppSecret 这类敏感信息不应出现在小程序文件里。已经提交过 git 或发过版的，只删代码不够，要到公众平台 / 商户平台重置。

占位符 `your_mch_key_here` 不会报，这点是对的。输出的 JSON 里也搜不到完整假密钥。

**2. 私钥和证书文件进了工程。** `cert/apiclient_key.pem` 同时触发「文件里出现 `BEGIN PRIVATE KEY`」和「这是微信支付商户 API 证书的默认文件名」。`.p12` / `.pfx` / `.key` 是错误，普通 `.crt` 是警告。

**3. 小程序端直接请求 `api.weixin.qq.com`。** 样例里用它去换 access_token。微信规定这个域名不能配成服务器域名，相关 API 也不能在小程序内调用。正确做法是前端 `wx.login()` 拿 code，发给自己的服务端，由服务端带 AppSecret 调 `code2Session`。

**4. 请求地址还是 http。** `http://api.example.com` 在 `BASE_URL` 这一行报错误；页面上展示用的 `http://help.example.com` 是警告（这一行不像请求地址）；`localhost` 是警告，局域网地址是提示；`http://www.w3.org` 和注释里的地址不算。小程序网络请求只支持 https / wss，并且要在后台配服务器域名。

**5. `sslVerify: false` 和 `urlCheck: false`。** 前者关闭 App 安卓端证书校验，uni-app 文档标了「不推荐」；后者只在开发者工具里跳过域名校验，真机关掉调试后请求会失败。

**6. permission.desc 缺失或超过 30 个字。** `scope.userLocation` 写成了空对象，报错误；`scope.userFuzzyLocation` 的说明有 34 个字，报警告。计数用的是 `[...desc].length`，按 Unicode 码点，中文一个字算一个。

**7. 用了 `uni.getLocation`，manifest 的 `requiredPrivateInfos` 里没声明。** 这是错误。微信要求 2022-07-14 之后发布的小程序，地理位置接口必须在这里声明，否则真机无法调用。样例里还声明了一个不存在的 `getFoo`（警告），以及声明了但代码里没扫到的 `chooseAddress`（提示，可能在插件里）。

**8. 调试残留和过时的隐私开关。** `uni.setEnableDebug({ enableDebug: true })` 对正式版也生效，是错误。`vconsole` 在 `main.js` 和 `dependencies` 里各报一条警告。`__usePrivacyCheck__` 是提示：我对照了微信《小程序隐私协议开发指南》2023.09.14 那次更新，2023 年 10 月 17 日之后，不论 app.json 里有没有配这个字段，隐私相关功能都已启用，可以删掉。

另外，用到手机号、位置、选图这类隐私接口时，会按信息类型汇总成提示，提醒去后台《用户隐私保护指引》声明，否则可能报 errno 112。工具不会联网核对你有没有真的勾上，只是提醒。

`node_modules`、`unpackage`、`uni_modules` 默认跳过。样例在 `uni_modules` 里放了 `chooseLocation`，默认扫描不会要求声明；加上 `--include-uni-modules` 才会。这是有意的，但真实项目如果定位能力全在插件里，默认扫描会漏，需要自己加这个开关。

## 二、扫描器自己的问题

fixtures 全绿，不代表规则没有盲区。我按常见写法搭了十来个临时小项目，用同一份 `lib/scan.js` 去扫，原代码上测到这些。

**行尾的忽略注释会吞掉下一行。** 文档写的是「在该行或上一行写 `sec-check-ignore`」。实现却是：只要这一行出现这个标记，当前行和下一行都被忽略。于是：

```js
export const appSecret = 'FAKE***' // sec-check-ignore
export const apiV3Key = 'FAKE***'
```

原版结果：SEC001、SEC002 都是 0。第一行被忽略是符合预期的，第二行的支付密钥被一起放过去了。上一行单独写 `// sec-check-ignore` 的用法仍然正确，对照用例里 `legacy.example.com` 被忽略、下一行的 `api.example.com` 仍会报。

**`config.json` 里的 http 不扫。** 代码规则只看 `.js` / `.ts` / `.vue` 这些扩展名。不少 uni-app 项目把 `baseURL` 放在 `config.json` 或 `siteinfo.json` 里：

```json
{ "baseURL": "http://api.example.com" }
```

原版：0 条 NET001。这个地址会打进小程序包，跟写在 JS 里没有区别。

**字符串里的 `uni.getLocation()` 会误报。** 一行帮助文案：

```js
export const tip = "出错时请不要直接调用 uni.getLocation()，先检查权限"
```

原版：1 个 MAN004 错误，外加 MAN006 警告和 PRV001 提示。定位接口检测没有避开字符串字面量，说明文字被当成了真的调用。如果有人据此去 manifest 里补 `requiredPrivateInfos`，等于被误报带着走。

还有几处漏报，同样是实测：

- `uni['getLocation']()` 这种括号取值，原版 MAN004 为 0。
- `uni.createCameraContext()` 不在「摄像头」分组里（只认 `createVKSession` 和 `<camera>` 标签），PRV001 为空。
- 目录里只有原生小程序的 `app.json`、没有 `manifest.json` 时，工具报「找不到 manifest，跳过相关检查」，即使 `wx.getLocation` 已经出现、`requiredPrivateInfos` 是空数组，MAN004 仍为 0。
- `.env.local` 里的 `WX_ACCESS_TOKEN=...` 不在密钥变量名列表里（原名单有 SECRET、APIV3、MCH_KEY 等，没有 ACCESS_TOKEN）。
- `sslVerify: 0` 不报，只认 `false`。
- `import VConsole from 'vconsole/dist/vconsole.min.js'` 且没有 `new VConsole()` 时，DBG002 为 0；同一文件如果写了 `new VConsole()`，仍会被抓住。
- `` url = (host) => `http://${host}/api` `` 这种模板字符串，正则要求 `//` 后面是主机名，匹配不到。
- vite 里 `drop: ... ? ['console'] : []` 如果拆成多行，DBG001 不会降为「构建时已移除」的提示，仍是警告。

另外有一条我没有改：`appSecret: 'FAKE_' + 'CONCAT_…'`，因为正则要求等号后面是一段至少 8 个字符的字面量，两段都拼起来才是密钥时，原版 SEC001 为 0。补丁里也还没覆盖这种写法。

## 三、本地补丁怎么改

补丁只打在本地工作副本，没有提交，也没有推到仓库。改完后官方 35 条测试仍然全部通过，新加的 5 条在原代码上会失败，合入后一共 40 条全过。

主要改动：

- `sec-check-ignore`：标记写在代码行尾时只忽略当前行；只有一行里就是注释加这个标记时，才顺带忽略下一行。
- 字符串里的 JS API 调用不再计入定位 / 隐私接口（Vue 模板上的 `open-type`、`<camera>` 不受影响）。
- `.json` 配置里的 `http://` 纳入 NET001（跳过 `package.json` / `package-lock.json`）。
- 没有 manifest 但有 `app.json` 时，按原生小程序顶层的 `requiredPrivateInfos` / `permission` 检查。
- 补上 `uni['getLocation']()`、`createCameraContext`、`.env` 的 ACCESS_TOKEN、`sslVerify: 0` / `!1`、`vconsole/dist/...`、`http://${...}`，以及 vite `drop` 跨行。

复现：

```bash
node daily/2026-11-14-sec-check-repro.mjs .scratch-1113/uniapp-sec-check-orig
node daily/2026-11-14-sec-check-repro.mjs .scratch-1113/uniapp-sec-check
```

补丁后，第 1 条用例会报出第 2 行的 apiV3Key；第 3 条不再误报；`config.json` 的 http、`app.json` 的 getLocation、ACCESS_TOKEN、`sslVerify: 0` 都能抓到。拼接密钥那一条仍然是 0，我在复现输出里留着，免得以为已经扫全了。

再次强调：这只是静态规则自查，没有在商业项目的正式发布上验证过。能扫到的先修，扫不到的不要当成不存在。

仓库：https://github.com/MsNan/uniapp-sec-check

</div>
