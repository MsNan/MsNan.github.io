---
title: "给纯小程序项目跑 App 上架隐私扫描：缺 androidPrivacy.json 报了 HIGH，后头又说可以忽略"
date: 2026-11-19
category: 前端
tags: [JavaScript, uni-app, 小程序]
description: "只有 mp-weixin、没有 app-plus 的项目，也会被报缺少 androidPrivacy.json，并给出 permissionPhoneState 的中等级别。官方文档针对的是 Android 应用市场。未加引号的 href 还会被当成没有链接。"
---

<div v-pre>


我做过一个纯前端的 uni-app 隐私合规自查工具：在网页里选中项目文件夹，或者把配置和代码贴进去，它会在本地扫 manifest.json、androidPrivacy.json 和源码。11 月初我写过它的代码规则（C1），专门看敏感 API 是不是在用户同意之前就调用了。今天换了个更简单的输入：一份只有小程序配置、根本没有 App 节点的 manifest，再跑一遍分析器。

仓库还是 uniapp-privacy-check-web，提交 caca78d，版本 1.0.0，没有打 tag。分析器零依赖，浏览器和 Node 都能跑。今晚在 Node v24.22.1 下跑了官方测试，33 条全过。复现脚本是 `daily/2026-11-19-privacy-mp-only-repro.mjs`，不需要装依赖，对着这份提交的 `src/analyzer.js` 直接跑即可。下面的结果都是脚本调 `analyze()` 打出来的，没有连应用市场，也没有在真实上架包上复核。

## 纯小程序项目，先报了一条 HIGH

输入只有这些：

```json
{
  "name": "demo-mp",
  "mp-weixin": {
    "appid": "wx123",
    "setting": { "urlCheck": true }
  }
}
```

另外放了一个只有首页的 `pages.json`，页面里只打了 `console.log`，没有定位、没有设备信息接口。分析器返回：

```text
HIGH 1 / MEDIUM 1 / LOW 0 / INFO 6
isMpProject: true
androidPrivacyPath: null
consentGate: false

[HIGH]   P1 缺少 androidPrivacy.json (未配置原生隐私政策提示框)
[MEDIUM] A2 未显式配置 permissionPhoneState
[INFO]   A1 未显式配置 permissionExternalStorage
[INFO]   A3 未开启 checkPermissionDenied
[INFO]   A4 manifest 中未手动添加 Android 权限
[INFO]   A7 云打包默认自动添加的权限 (不在 manifest 里显示)
[INFO]   B0 未发现 app-plus 配置
[INFO]   J0 pages.json 已读取 (1 个页面)
```

P1 的说明写的是：官方要求上架应用市场必须使用 uni 提供的 template 模式隐私弹窗，应用内自己实现的也不行。A2 则提醒启动时弹「电话」权限是常见驳回点，建议写上 `"permissionPhoneState": {"request": "none"}`。

同一份报告的末尾，B0 又说：「若项目仅发布小程序/H5，可忽略 App 相关项。」前面已经给了 HIGH 和 MEDIUM，后面才说可以忽略，这两句挨在一起，读起来是拧的。只放 `h5` 节点、不放 `mp-weixin` 的 manifest，也会得到同样的 P1 和 A2，只是 `isMpProject` 为 false。

返回值里其实有 `isMpProject`。我对着源码看了一下，它只是 `!!mpWeixin`，用来决定要不要跑小程序那一组 W 规则，并没有用来跳过 App 上架检查。`app-plus` 取不到时会被写成空对象 `{}`，后面的权限策略检查就把「没写 permissionPhoneState」当成漏配。

## 文档针对的是 Android 应用市场，不是微信小程序

P1 引用的来源是 DCloud 的《Android平台隐私与政策提示框配置方法》。我在 2026-11-18 PT 读了这篇页面（https://uniapp.dcloud.net.cn/tutorial/app-privacy-android.html）。标题和正文都围着 Android 应用市场上架：开头写「根据工业和信息化部关于开展APP侵害用户权益专项整治要求，App提交到应用市场必须满足以下条件」，其中第一条是应用启动时弹出隐私政策协议。同页还写：「HBuilderX3.2.1+版本开始支持androidPrivacy.json文件配置隐私政策提示框，真机运行时也可生效」，以及请使用 HBuilderX 3.2.15+ 打包并用 template 配置隐私弹窗，否则无法正常上架应用市场。

这些要求针对的是打 Android 包、提交应用市场的 App。把它们套到一份只有 `mp-weixin`、没有 `app-plus` 的项目上，会让人误以为小程序也必须在仓库根目录放 `androidPrivacy.json`，还要去配 Android 的电话权限策略。工具自己的说明里写了「结果是静态启发式线索，以应用市场检测报告为准」，这一点本身没问题；问题是项目类型都还没判断，就先给了最高级别。

小程序真正该看的，是另一组规则。我在同一份纯小程序项目里加了一个用户点击时调用的 `uni.getLocation`，W1、W3 会按预期报：`requiredPrivateInfos` 没配、`scope.userLocation` 没写、代码里也没有隐私同意按钮。这些我保留，该报还是要报。不该报的是同一份结果里仍然打头的那条 P1 HIGH，以及 A2 MEDIUM。

## 什么情况下 P1 仍然该在

如果 manifest 里写了 `"app-plus": {}`，即使对象是空的，我也把它当成准备打 App 的项目。这条对照里，P1 和 A2 仍然出现，`isMpProject` 为 false。典型的双端项目（同时有 `app-plus` 和 `mp-weixin`）同样会报 P1，这是对的：要出 Android 包，原生隐私弹窗本来就该配。我改分析器时也按这个分界来写，避免把「空的 app-plus」误判成可以跳过。

## 另外一处：链接其实写了，却报没有

给一个确有 `app-plus` 的项目配上 `androidPrivacy.json`，`prompt` 为 `template`，`message` 里放了「请阅读 `<a href=https://example.com/privacy.html>《隐私政策》</a>`」，也就是 href 没加引号。分析器报了 P4 MEDIUM：「message 中没有《隐私政策》链接 (`<a href>`)」。把引号换成中文弯引号 `“...”`，还是同样一条。改成普通的英文双引号后，这条 P4 就消失了。

原因在提取 href 的正则：它只认单引号或双引号包起来的值，可选地容忍一个反斜杠，未加引号和弯引号都进不去。HTML 里未加引号的 URL 很常见，从富文本编辑器贴过来时，弯引号也偶尔会出现。链接其实在，扫描结果却说没有。

## 补丁和还没做的事

我写了一个补丁：只有出现 `app-plus`、`app` 或 `app-android`，或者项目里已经放了 `androidPrivacy.json`，才按 Android 应用市场上架规则去查隐私弹窗和权限策略；纯小程序或只有 H5 时，改成一条 INFO，说明已跳过这些 App 项。href 同时接受未加引号的值和中文弯引号。把补丁打到副本上再跑同一条纯小程序用例，P1 和 A2 都不再出现，只剩下 B0 那条 INFO，计数是 HIGH 0 / MEDIUM 0；原来带 `app-plus` 的用例，P1 仍然是 HIGH。官方测试从 33 条变成 38 条，都通过。补丁还没有提交，也没有推送，能不能合入由仓库维护者决定。

这次没有在应用市场的真实检测报告上对照，也没有改 C1 的代码分析逻辑。它和 uniapp-sec-check 不是同一个工具：后者扫的是小程序上线前的密钥、http、分包结构，这边是 App 上架隐私弹窗和 Android 权限。不要把「扫描通过」理解成「一定能过审」。

仓库：https://github.com/MsNan/uniapp-privacy-check-web

</div>
