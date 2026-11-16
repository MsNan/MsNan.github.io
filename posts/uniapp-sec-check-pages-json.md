---
title: "tabBar 写进分包、路径带上了 root：pages.json 里这几处，我加了 12 条本地检查"
date: 2026-11-16
category: 前端
tags: [uni-app, JavaScript, 小程序, 微信]
description: "uniapp-sec-check v0.2.0（e4d7464）新增 PAG001–PAG012：tabBar 必须在主包、分包 path 不能写成全路径、root 不能嵌套；本地 49 测全绿，自家两个项目无 PAG 误报。"
---

<div v-pre>


前几天写过 uniapp-sec-check 的第一版，主要扫密钥、http、隐私声明和调试残留。那篇发出去之后，仓库里又补了一组跟 `pages.json`、分包结构有关的规则，版本号到了 0.2.0，提交是 e4d7464。官方测试从 35 条加到 49 条，GitHub Actions 在 Node 18/20/22 上通过（run 43627145768）。今天只谈这 12 条新规则，密钥和隐私那些不再展开。

先把边界说清楚。检查通过只说明这些结构规则没命中，不等于能过审，更不是包体积或跨包引用都没问题。它不检查分包 2M、整个小程序 20M 这种要真实构建才能量的限制，也不做跨包 `require` / `import` 的静态分析，独立分包的隔离也没查。tabBar 的图标文件是否存在，同样不在范围内。仓库还没打 tag，也没发 npm，只能 `npx -y github:MsNan/uniapp-sec-check`。我没有在真实上线的商业项目上验证过，只在自己的 bishe-kit/client 和 taohaowu-shop 上冒了个烟。下面的例子都是在 Node 24.22.1 下用临时项目跑出来的，对照的是微信《使用分包》和 uni-app pages.json 文档。官方测试我本地也跑过，49 条全绿。

## 扫描器怎么找到 pages.json

它先找 `manifest.json`（根目录或 `src/`），再在同一目录找 `pages.json`，找不到再看 `app.json`。这样 Vite / CLI 那种把配置放在 `src/` 里的布局也能用。路径都相对配置文件所在目录解析，不写后缀；页面项既可以是字符串，也可以是 uni-app 那种带 `path` 的对象。归一化时会去掉开头的 `./`、多余斜杠和 `.vue` / `.nvue` / `.uvue` / `.js` / `.ts` 后缀，开头的 `/` 也会去掉。文件按同样规则去对。我试过 `src/pages.json` 加一个相对路径写对的分包，PAG 规则全部沉默。

`pages.json` 按 JSONC 解析，注释和尾逗号可以有。解析失败是 PAG001 错误。字段名写成小写 `subpackages` 也可以，微信和扫描器都认。如果 `subPackages` 和 `subpackages` 同时出现，会警告 PAG001，并且只采用官方写法 `subPackages`，另一个字段里的页面不会被拿去查文件——我把 `pagesB` 只写在小写字段里，并没有出现缺文件的 PAG003。

## 一、tabBar 必须写在主包

微信文档写得很干脆：「tabBar 页面必须在主包内」。主包要在启动时就下载完，底部这几个入口不能等用户点了再去拉分包。uni-app 也要求 `pagePath` 必须先在 `pages` 里定义。

我故意写了这样一个配置：主包有首页和「我的」，列表页放在 `root` 为 `pagesA` 的分包里，然后把第二个 tab 指到 `pagesA/list/list`。扫描直接报 PAG008：

```text
tabBar.list[1].pagePath "pagesA/list/list" 只出现在分包中。微信规定：tabBar 页面必须在主包内。
```

把这个 tab 改回主包里的 `pages/home/home`，这条就沉默了。就算加了 `custom: true` 做自定义 tabBar，`list` 里如果还指着分包页面，PAG008 一样会报。我试过，结果相同。

`list` 的数量也有规定，最少 2 个、最多 5 个。我试过只留 1 项，会报 PAG009：「tabBar.list 有 1 项」；6 项同样报错；2 项且都在主包时通过。图标文件缺了不会报，这一点要自己看。

## 二、分包 path 不要写成全路径

这是我自己也很容易写错的一处。`root` 已经是 `pagesA`，`pages` 里却习惯性地写成 `pagesA/list/list`，跟主包路径的写法保持一致。uni-app 文档专门写了：`subPackages` 里的 `pages` 的路径是 `root` 下的相对路径，不是全路径。正确写法是 `list/list`。

扫描会报 PAG006。同时还会多一条 PAG003：它按「root + 你写的 path」去拼完整路径，变成了 `pagesA/pagesA/list/list`，对应的文件当然不存在。这是同一处笔误触发的两条错误，把路径改成相对写法之后，两条一起消失。我对照过写成 `list/list`、并且文件在 `pagesA/list/list.vue` 时，PAG006 和 PAG003 都是 0。

路径以 `/` 开头也会走 PAG006，比如 `/list/list`。这一次没有再叠一条 PAG003，因为去掉斜杠之后拼出来的完整路径恰好还能对上文件。所以这两条不是总会一起出现，修的时候以 PAG006 那句「不是相对路径」为准。

## 三、分包根目录不能互相嵌套，但 package 和 packageA 不算

微信还有一句：「subPackages 的根目录不能是另外一个 subPackages 内的子目录」。我用 `pkg` 和 `pkg/sub` 去试，报了 PAG007。两个分包如果共用同一个非空 `name`，也会报，因为 `preloadRule` 的 `packages` 将无法区分。

容易误伤的是 `package` 和 `packageA`。如果只做字符串前缀判断，`packageA` 看起来像是以 `package` 开头。规则里用的是目录前缀（后面跟 `/`），这两个名字不会被当成嵌套，扫描结果是 0。这是有意的。

## 四、重复路径、缺文件、预下载

主包 `pages` 里如果已经写了 `pagesA/list/list`，分包 `root` 为 `pagesA`、`pages` 为 `list/list`，完整路径就重复了，会报 PAG004。`pages` 缺失或空数组报 PAG002；配置了页面但找不到 `.vue` / `.nvue` / `.uvue` / `.js` / `.ts` 报 PAG003；分包缺少 `root`、或 `pages` 不是数组报 PAG005。这些我都单独跑过。

PAG002 的文案里写了「第一项是首页」，这是对照官方说明。实际检查只确认 `pages` 是非空数组、每一项能解析出路径，并不会判断你把哪一页放在第一位。我把第一项改成一个普通页、第二项才是原来的首页，PAG 规则没有报。首页顺序还得自己看。

`preloadRule` 对得上微信分包预下载文档。key 必须是已经配置过的页面完整路径（PAG010），`packages` 只能是已知分包的 `root`、`name` 或表示主包的 `__APP__`（PAG011），`network` 只允许 `all` 或 `wifi`（PAG012）。我用一个不存在的页面、未知分包名、`network: "4g"` 同时打这三条，都会报；改成 `pages/index/index` 预下载 `pagesA` 且 `network` 为 `all`，三条都沉默。

原生小程序只有 `app.json`、没有 manifest 时，字符串形式的 `pages` 也能认，并且不会用 PAG001 去叠「找不到 pages.json」的警告。

## 五、在自己项目上的冒烟

bishe-kit 的客户端和 taohaowu-shop 的 `pages.json`，我按当前 GitHub 内容核对过，对应的页面文件也在。两份配置都没有分包。bishe-kit 的 tabBar 是公告、图书、我的三项，路径分别是 `pages/index/index`、`pages/book/book`、`pages/mine/mine`；淘好物是首页、分类、购物车、我的四项。全部落在主包 `pages` 里。PAG001 到 PAG012 没有命中。

扫描器对这两份工程还有一些跟本文无关的警告：两边都是 `mp-weixin.appid` 为空、`urlCheck` 关闭；bishe-kit 还有一处 `console.log`，淘好物的开发地址仍是 `http://localhost:3000`。那些是 v0.1.0 就有的规则，今天不展开。冒烟只说明新的结构规则没有在这两份真实配置上误报，不是一次完整的上线结论。

## 六、仍然没做的事

体积上限要看构建产物，静态看 `pages.json` 说了不算。跨包引用、独立分包是否真的隔离，也没有做分析。tabBar 图标、自定义 tabBar 组件本身的位置，都不在这 12 条里。11-14 那篇里提到的忽略注释误伤、字符串里的接口名误报，补丁还没有合进这个版本，这篇也不假装那些已经修了。我没有在微信开发者工具里跑编译，没有走真实提审。

对我自己来说，这 12 条的价值很具体：把 tab 放进分包、把 `root` 再写进 path、把两个分包目录套在一起，这些在开发者工具里有时要等到编译或预览才会暴露。能在仓库里先扫一遍，至少能少排一次。

仓库：https://github.com/MsNan/uniapp-sec-check

</div>
