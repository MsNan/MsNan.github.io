---
title: "我把 marketplace.json 的 source 改成仓库名，本地校验立刻红了：单插件清单这几条是故意收紧的"
date: 2026-11-22
category: 前端
tags: [JavaScript, Node.js, Cursor]
description: "单插件仓库的 check.js 比官方 schema 更紧。把 source 改成仓库名或 skills、在 plugin.json 里写 skills 路径、或列出两个插件，本地校验都会直接失败。"
---

<div v-pre>

给技能包补上 Cursor 官方插件清单之后，我担心以后改 marketplace.json 时，一不小心按文档示例把 `source` 写成子目录名，本地却发现不了。vue-uniapp-skills 在提交 cbe8252 里给 `bin/check.js` 加了一段清单校验，不只检查 JSON 能不能解析，还加了几条这个仓库自己的约束。官方 schema 其实允许一个市场清单里挂多个插件、`source` 指向子目录，那些规则是给多插件仓库用的；这份仓库是单插件，技能就在根目录的 `skills/`，所以校验比 schema 更紧。

今晚我在 Node v24.22.1 下先对着提交 cbe8252 跑了官方测试，23 条全绿。然后复制了一份工作副本（没有改原仓库，也没有提交），只改清单再跑 `node bin/check.js`，看它到底拦什么。

## 一、source 写成仓库名，或写成 skills，都会被拦住

原文件里 `plugins[0].source` 是 `"."`。我先改成 `"vue-uniapp-skills"`，再改成 `"skills"`，两次都是退出码 1，stderr 同一句：

```text
✗ .cursor-plugin/marketplace.json: 单插件仓库的 source 应为 "."（技能仍在仓库根目录 skills/）
```

这句话不是官方文档的原文，是这个仓库自己的校验。对照文档的解析规则，就能理解为什么要拦：`source` 是相对仓库根的插件目录。写成仓库名，会去找 `vue-uniapp-skills/.cursor-plugin/plugin.json`；写成 `skills`，会去找 `skills/.cursor-plugin/plugin.json`。这两处在这份仓库里都不存在。技能目录是 `skills/`，插件清单在仓库根的 `.cursor-plugin/`，所以只能是 `"."`。

## 二、plugin.json 里不要手写 skills 路径

官方文档说，清单一旦写了某个组件的路径，就不再扫描默认目录。这份仓库的技能正好在默认的 `skills/` 下，plugin.json 里本来就没有 `skills` 字段。我在副本里给它加了 `"skills": "skills"`，check.js 退出码 1，报错是：

```text
✗ .cursor-plugin/plugin.json: 不要写 skills 路径，沿用默认的 skills/ 目录发现
```

官方测试也断言了这一点：`plugin` 对象上不能有 `skills` 这个键。

## 三、plugins 数组必须恰好 1 项

我又在副本的 `plugins` 里加了第二项，name 和 source 都写成 `another-plugin`。校验报的是：

```text
✗ .cursor-plugin/marketplace.json: plugins 必须是只含 1 个插件的数组
```

文档示例可以列两个子目录插件，但那些子目录在这份仓库里并不存在。与其留下一个「看起来像多插件市场、实际只有根目录一份技能」的清单，不如在本地直接挡住。

改完副本后我把文件恢复了，没有把这些失败用例提交回去。干净的提交上，`node bin/check.js` 仍是「12 个技能校验通过」和「.cursor-plugin 清单校验通过」。

## 四、官方测试里对过的字段

测试标题是「Cursor 插件清单符合官方 schema，source 为仓库根目录，技能仍在 skills/」。除了 `source === '.'` 和没有 `skills` 字段，它还检查 plugin 的 name、version 与 package.json 一致，license 是 MIT，author 是「Theo（涛哥）」，市场条目的 name 跟 plugin.json 一致，`package.json` 的 `files` 包含 `.cursor-plugin`，以及 `skills/` 下至少 12 个带 SKILL.md 的目录。GitHub Actions 在 Node 18、20、22 上也是通过的（run 44793565816）。

同一套校验后来加进了 bishe-doc-skills（提交 44c2b33）。我今晚对着那份提交跑测试，19 条全绿，Actions 同样通过（run 44935880743）。它也是单插件仓库，`source` 同样要求是 `"."`。

我没有在真实的 Teams 账号里导入过这两份仓库，也还没有提交到官方 Cursor Marketplace。清单只保证本地字段和目录布局对得上文档里的解析规则。

仓库：https://github.com/MsNan/bishe-doc-skills

</div>
