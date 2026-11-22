---
title: "官方示例里 source 写的是子目录，单插件仓库如果写成仓库名，会去找一个不存在的 plugin.json"
date: 2026-11-22
category: 前端
tags: [JavaScript, Node.js, Cursor]
description: "Cursor 官方 marketplace.json 示例里 source 是子目录名。单插件仓库的技能就在根目录 skills/，source 必须是点，写成仓库名会去找一个不存在的 plugin.json。"
---

<div v-pre>

vue-uniapp-skills 这份 Vue3 + uni-app 技能包，原来主要靠 `npx` 往项目里装技能。对照 Cursor 官方插件文档 https://cursor.com/docs/reference/plugins 之后，仓库根目录加了两份清单：`.cursor-plugin/plugin.json` 和 `.cursor-plugin/marketplace.json`（提交 cbe8252）。技能还是在原来的 `skills/` 里，原来的安装器路径也没有改。版本号仍是 0.1.1，没有打 tag，也没有发 release。今晚在 Node v24.22.1 下对着这个提交跑了官方测试，23 条全绿；GitHub Actions 的 Node 18、20、22 也通过（run 44793565816）。下面说的解析规则，依据是我今天读到的官方文档；我没有在真实的 Teams / Enterprise 账号里做过导入。

## 一、官方示例里，source 写的是子目录名

文档把 `.cursor-plugin/marketplace.json` 放在「多插件仓库」这一节。示例是一个仓库里放两个插件，`plugins` 数组里分别写 `"source": "plugin-one"` 和 `"source": "plugin-two"`。对应的目录结构是：每个插件一个子目录，子目录里再放自己的 `.cursor-plugin/plugin.json`，技能或规则也在那个子目录下面。

同一页写了解析步骤。以 `"source": "my-plugin"` 为例：

1. 先找 `my-plugin/.cursor-plugin/plugin.json`
2. 找到了，就把这份清单和市场条目合并（市场条目上的字段优先）
3. 组件发现在 `my-plugin/` 目录里进行，清单里写了路径就用清单的，否则按默认目录扫描

也就是说，`source` 不是仓库的名字，而是「从仓库根目录走到插件根目录」的相对路径。

## 二、这份仓库没有那一层子目录

vue-uniapp-skills 是单插件仓库。根目录就是插件根目录：`.cursor-plugin/plugin.json` 直接放在仓库根下，12 个技能仍在根目录的 `skills/` 里，并没有再套一层 `vue-uniapp-skills/skills`。如果照着示例把 source 写成仓库名 `vue-uniapp-skills`，按文档会去找 `vue-uniapp-skills/.cursor-plugin/plugin.json`。这个路径在仓库里不存在。

所以 marketplace.json 现在是这样的（我从提交 cbe8252 里读到的原文）：

```json
{
  "name": "vue-uniapp-skills",
  "owner": {
    "name": "MsNan"
  },
  "metadata": {
    "description": "Vue3 + uni-app 中文 AI 编程技能包"
  },
  "plugins": [
    {
      "name": "vue-uniapp-skills",
      "source": ".",
      "description": "Vue3 + uni-app 中文 AI 编程技能包：跨端、请求封装、登录支付、分包与审核自查"
    }
  ]
}
```

`source` 为 `"."`，解析时就会找 `./.cursor-plugin/plugin.json`，组件发现也落在仓库根上，默认能扫到根目录的 `skills/`。

plugin.json 里只写了 name、displayName、version、description、author 这些元信息，没有写 `skills` 字段。官方文档说：清单如果指定了某个组件的路径，就不再扫描默认目录。这份仓库的技能本来就在默认的 `skills/` 下，不必再写一遍路径。

## 三、本地测试对过这几项

官方测试里有一条专门核对清单：`plugin.name`、`version` 跟 package.json 一致，`license` 是 MIT，author 是「Theo（涛哥）」，plugin.json 没有 `skills` 字段，marketplace 里只有 1 个插件，它的 `source` 是 `"."`，而且跟 plugin.json 的 name 一致；`package.json` 的 `files` 里包含了 `.cursor-plugin`，`skills/` 下至少有 12 个带 SKILL.md 的目录。今晚这条和其余 22 条都通过了，check.js 也会先打印「12 个技能校验通过」和「.cursor-plugin 清单校验通过」。

## 四、还没做的事

团队市场导入，我是按今天读到的 https://cursor.com/docs/plugins 来写的：打开 Dashboard → Plugins & MCPs，在 Team Marketplaces 里点 Add Marketplace，再用 Import from Repo 粘贴仓库地址。这是文档上的步骤，我没有在真实的 Teams 或 Enterprise 账号里点过，不能当成已经验证过的界面路径。团队市场本身也只在 Teams / Enterprise 方案里提供。

另外也还没有提交到官方 Cursor Marketplace。文档写的入口是 cursor.com/marketplace/publish，提交后由 Cursor 团队审核。需要的话可以以后再做。

日常使用我仍然建议用原来的 npx 安装器，因为它同时照顾 Cursor、Claude Code、Trae 和 Codex。这两份清单是给「按官方插件格式导入」用的可选入口，不是要把安装器换掉。

后来 bishe-doc-skills 也加了同样布局的清单（提交 44c2b33）。我今晚对着那份提交跑了官方测试，19 条全绿，Actions 的 Node 18、20、22 也通过（run 44935880743）。它同样是单插件仓库，`source` 也是 `"."`，技能仍在根目录 `skills/`。

仓库：https://github.com/MsNan/vue-uniapp-skills

</div>
