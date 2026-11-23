---
title: "Trae 的技能不是写在 .trae/rules 里的：官方目录是 .trae/skills，国内版全局还要看 ~/.trae-cn"
date: 2026-11-23
category: 前端
tags: [JavaScript, Node.js, Trae]
description: "对照 Trae 官方技能文档后，项目技能应写入 .trae/skills，而不是旧的 .trae/rules。国际版与国内版的全局目录也不一样，只有本机单独存在 ~/.trae-cn 时才走国内版路径。"
---

<div v-pre>

以前给 Trae 装项目约定，我是把内容写成 `.trae/rules` 下面的 `.md` 文件。今天对照了官方技能文档（国际版 https://docs.trae.ai/ide/skills ，国内版 https://docs.trae.cn/ide_skills），技能的位置不是规则目录，而是 `.trae/skills/<名称>/SKILL.md`。规则和技能也不是一回事：文档写得很清楚，规则会在对话开始时整份注入上下文，技能是先扫简要描述，真正相关时才加载正文。

我把 vue-uniapp-skills 这个 Vue3 + uni-app 技能安装器改了一版（提交 bba7783）。指定 --tool trae 时，改为往官方技能目录写；加 --global 则装到用户级目录。版本号仍是 0.1.1，没有打 tag，也没有发 release。今天在 Node v24.22.1 下对着这个提交跑官方测试，25 条全绿；GitHub Actions 的 Node 18、20、22 也通过（run 45055598677）。下面说的目录和加载规则，依据是我今天读到的官方文档；我没有在真实的 Trae 窗口里核对过这些文件一定会被加载。

## 一、官方文档里的目录，国际版和国内版并不完全一样

两份文档都约定，项目技能放在项目下的 `.trae/skills/`。一个技能一个目录，里面必须有 `SKILL.md`，开头用 YAML 写 `name` 和 `description`。

差别在全局技能。国际版文档写的是 macOS/Linux 下的 `~/.trae/skills`（Windows 是 `%userprofile%/.trae/skills`）。国内版文档写的是 `~/.trae-cn/skills`（Windows 对应 `%userprofile%/.trae-cn/skills`）。也就是说，不能想当然地只认其中一个家目录。

国内版文档另外还写了：如果在设置里启用「.agents 技能目录」，Trae 也可以加载 `.agents/skills/`；若和 `.trae/skills/` 里的技能重名，以 `.trae/skills/` 为准。

`.trae/rules/` 在文档里仍然是规则，不是技能。以前把技能正文丢进规则目录，等于一直占着上下文，而且还没走技能那套按需加载。

## 二、安装器现在写出的文件

指定 --tool trae 之后，项目里不再出现 `.trae/rules/<name>.md`，而是：

`.trae/skills/<name>/SKILL.md`

我在干净目录里只装了 `uniapp-login`，写出来的文件开头是这样的（从这次安装结果里抄的原文）：

```
---
name: uniapp-login
description: "uni-app 多端登录流程（微信小程序 wx.login + 手机号、H5 短信/微信网页授权、App 一键登录/微信登录），token 存储与登录态守卫。实现登录、退出、未登录拦截时使用。"
---
# 登录流程
```

也就是说，现在写成了带 `name` / `description` 的技能文件，不再是旧的「HTML 注释 + 正文」规则文件。

## 三、旧的 .trae/rules 只提示，不会自动删

如果项目里还留着以前安装器写过的 `.trae/rules/uniapp-login.md`，这次再装同一条技能，会同时写出新的技能文件，但那份旧规则原封不动。命令行会打出这样的提示（路径随目标目录变化）：

```
⚠️  检测到先前安装留下的 1 个 .trae/rules 文件，Trae 还会从 .trae/skills 加载同一内容，建议删掉以免规则和技能重复：
   <项目目录>/.trae/rules/uniapp-login.md
```

我核对过，提示出现之后，旧文件内容仍是原来的 `old rule`，没有被改掉或删掉。这是有意的：安装器不替你动可能改过的旧文件，但 Trae 若仍把规则整份注入，就会和技能目录里的同一份内容叠在一起。

## 四、--global 怎么选家目录，以及我没做的事

加 --global 时，技能不会写到当前项目，而是写到用户级目录。逻辑是：如果本机只存在 `~/.trae-cn`、不存在 `~/.trae`，就用 `~/.trae-cn/skills`；其他情况（只有国际版目录、两个都有、两个都没有）都用 `~/.trae/skills`。我用三个临时 home 目录分别试过这几种情况，结果和上面一致。两边目录都在时，不会往 `~/.trae-cn/skills` 再写一份。

这些都是本地写文件的结果。我没有用真实的 Trae 国际版或国内版客户端，去看它启动后到底扫描了哪一个家目录，所以不能把「写到这个路径」写成「客户端已经加载成功」。

仓库：https://github.com/MsNan/vue-uniapp-skills

</div>
