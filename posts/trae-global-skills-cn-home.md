---
title: "本机只有 ~/.trae-cn 时，--global 才会装到国内版目录：两边都在就走 ~/.trae/skills"
date: 2026-11-23
category: 前端
tags: [JavaScript, Node.js, Trae]
description: "Trae 国际版和国内版文档对全局技能目录写法不同。用三个临时 home 目录实测：只有单独存在 ~/.trae-cn 时才写到国内版路径，两边都在或两个都没有则写 ~/.trae/skills。"
---

<div v-pre>

vue-uniapp-skills 的 --tool trae 已经改成往官方技能目录写文件（提交 bba7783）。项目里是 `.trae/skills/<name>/SKILL.md`，这一点国际版文档 https://docs.trae.ai/ide/skills 和国内版 https://docs.trae.cn/ide_skills 是一致的。有分歧的是全局目录：国际版写 `~/.trae/skills`，国内版写 `~/.trae-cn/skills`。安装器要在 --global 时做一次选择。我今天没有打开真实的 Trae 窗口去看客户端扫描哪边，只在三个临时 home 目录里把文件写出来核对路径。测试环境是 Node v24.22.1，对着这个提交跑官方测试 25 条全绿；Actions 的 Node 18、20、22 也通过（run 45055598677）。版本号仍是 0.1.1，没有打 tag。

## 临时 home 里的三种情况

安装函数可以传入一个假的 `home`，这样不会动我自己机器上的 `~/.trae`。三个用例分别是：

1. 空的 home，既没有 `.trae` 也没有 `.trae-cn`
2. 只提前建了 `.trae-cn` 目录
3. `.trae` 和 `.trae-cn` 两个目录都在

三个用例都是 --global，只装 `uniapp-login`，目标项目是另一个空目录。结果如下。

空 home：写出了 `<home>/.trae/skills/uniapp-login/SKILL.md`，项目目录下没有 `.trae`，也没有写出 `<home>/.trae/rules`。

只存在国内版目录：写出了 `<home>/.trae-cn/skills/uniapp-login/SKILL.md`，这个 home 下没有新建 `.trae`，项目目录也没有被写入。

两个目录都在：仍然写出 `<home>/.trae/skills/uniapp-login/SKILL.md`，`<home>/.trae-cn/skills` 不存在。也就是说，国内版目录不会因为「也在」就被写一份。

对应的判断很短：只有「国内版目录在、国际版目录不在」时才走 `~/.trae-cn/skills`，其余情况都走 `~/.trae/skills`。两个目录都不在时，安装器会按国际版路径把 `.trae/skills` 建出来，而不是去建 `.trae-cn`。

## 项目安装不再创建 .trae/rules

不加 --global 时，文件落在项目里的 `.trae/skills/<name>/SKILL.md`，并且不会创建 `.trae/rules`。我用命令行对一个干净目录执行 -t trae -s uniapp-login，确认规则目录没有出现。

如果项目里已经有旧安装器留下的 `.trae/rules/uniapp-login.md`，再装一次会保留那份旧文件，同时写出新的技能文件，并打印：

```
⚠️  检测到先前安装留下的 1 个 .trae/rules 文件，Trae 还会从 .trae/skills 加载同一内容，建议删掉以免规则和技能重复：
   <项目目录>/.trae/rules/uniapp-login.md
```

我把旧文件事先写成 `old rule`，提示出现后它仍是这几个字，没有被覆盖。安装器故意不自动删除，免得误伤你改过的规则；但这份旧规则若仍被 Trae 整份注入，就会和技能目录里的同一内容叠在一起，需要自己决定要不要删。

## 这些结果不能直接当成客户端行为

路径是按今天读到的两份官方文档写的，本地测试只证明「安装器会把文件放到这些位置」。国际版和国内版客户端启动后究竟扫描哪个家目录、两边都在时会不会都扫，我没有在真实 Trae 里核对过。若你本机同时装着国际版和国内版，按现在的规则，--global 只会写到 `~/.trae/skills`；国内版会不会读到，要以客户端实际行为为准。

仓库：https://github.com/MsNan/vue-uniapp-skills

</div>
