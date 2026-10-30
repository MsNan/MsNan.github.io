---
title: "通讯录按拼音首字母分组，单雄信被分进了 D 组：姓氏、地名多音字和 pinyin-pro 的 surname 模式"
date: 2026-10-30
category: 前端
tags: [JavaScript, Node.js, 拼音, MCP]
description: "拼音库对姓和地名默认按常用读音：单雄信进 D 组、乐清首字母 L。实测 pinyin-pro surname 的 head/all 区别、customPinyin 跨词误伤和全局状态，附修法。"
---

# 通讯录按拼音首字母分组，单雄信被分进了 D 组：姓氏、地名多音字和 pinyin-pro 的 surname 模式

我的离线 MCP 工具集 cn-dev-mcp 里有一个 `pinyin` 工具，底层是 `pinyin-pro`（仓库里锁的是 3.29.5）。README 里给它举的例子是"把城市列表按拼音首字母分组"，我自己最常用的场景是通讯录和下拉选人：按姓的首字母分 A–Z 组，再支持输入 `zs` 搜出"张三"。

这两天给它补测试，拿一批真实的人名和县名去跑，结果挺难看：**单雄信被分进了 D 组，曾国藩进了 C 组，乐清市的首字母是 L**。下面把问题、`pinyin-pro` 自带的解法和它自己的坑一起记下来。环境是 Node 20.19.2，输出都是实际跑出来的。

## 先看工具现在怎么转

```ts
export function toPinyin(text: string, tone: 'symbol' | 'num' | 'none' = 'symbol', mode: 'full' | 'initial' = 'full') {
  if (text.length > 5000) throw new Error('文本过长（上限 5000 字）')
  if (mode === 'initial') return { text, initials: pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('') }
  const arr = pinyin(text, { toneType: tone, type: 'array', nonZh: 'consecutive' })
  return { text, pinyin: arr.join(' '), array: arr }
}
```

普通词语的多音字，`pinyin-pro` 靠内置词典分词处理得不错：

```
重庆   chóng qìng
银行   yín háng
行长   háng zhǎng
蚌埠   bèng bù
六安   lù ān
```

问题出在两类专名上：姓和地名。

## 问题一：姓氏多音字

把一批人名丢进去（`toPinyin(name)` 和 `toPinyin(name, 'none', 'initial')`）：

| 名字 | 现在的结果 | 首字母 | 正确读音 |
|---|---|---|---|
| 单雄信 | dān xióng xìn | dxx | shàn |
| 曾国藩 | céng guó fān | cgf | zēng |
| 解缙 | jiě jìn | jj | xiè |
| 仇英 | chóu yīng | cy | qiú |
| 区志明 | qū zhì míng | qzm | ōu |
| 查良镛 | chá liáng yōng | cly | zhā |
| 朴树 | pǔ shù | ps | piáo |
| 尉迟恭 | wèi chí gōng | wcg | yù chí |
| 万俟卨 | wàn sì xiè | wsx | mò qí |

原因不复杂：这些字作为普通字时最常见的读音不是姓氏读音，词典里也不可能收录每一个人名，分词时就按单字的默认读音走了。

放到通讯录里就是：用户找"曾"姓同事，去 Z 组翻不到，最后在 C 组里找到；输入 `zgf` 搜不出曾国藩，输入 `cgf` 反而能搜到。

有人会想用浏览器自带的中文排序 `Intl.Collator('zh')` 绕过去。我在 Node（ICU 76.1）里试了一下：

```js
const names = ['张三', '单雄信', '曾国藩', '解缙', '仇英', '区志明', '查良镛', '朴树', '曹操', '安然', '欧阳修', '尉迟恭']
console.log([...names].sort(new Intl.Collator('zh-Hans-CN').compare).join(' '))
// 安然 曹操 曾国藩 查良镛 仇英 单雄信 解缙 欧阳修 朴树 区志明 尉迟恭 张三
```

曾排在曹和查之间（按 céng），单在 D 的位置，解在 J。排序规则同样按常用读音，并不知道这是个姓。

## pinyin-pro 的 surname 选项

`pinyin-pro` 其实有专门的姓氏模式，`surname` 有三个取值：`off`（默认）、`head`（只作用于字符串开头）、`all`（整个字符串里遇到姓氏用字都按姓氏读）。

```js
pinyin('单雄信', { surname: 'head' })                                    // shàn xióng xìn
pinyin('曾国藩', { surname: 'head', pattern: 'first', toneType: 'none' }) // z g f
pinyin('万俟卨', { surname: 'head' })                                    // mò qí xiè
pinyin('尉迟恭', { surname: 'head' })                                    // yù chí gōng
```

上面那张表里的九个名字，开了 `head` 之后全部变成了正确的姓氏读音，复姓也认得。

按首字母分组的对比（同样 12 个名字）：

```js
// 不开 surname
{"Z":["张三"],"D":["单雄信"],"C":["曾国藩","仇英","查良镛","曹操"],"J":["解缙"],"Q":["区志明"],"P":["朴树"],"A":["安然"],"O":["欧阳修"],"W":["尉迟恭"]}
// surname: 'head'
{"Z":["张三","曾国藩","查良镛"],"S":["单雄信"],"X":["解缙"],"Q":["仇英"],"O":["区志明","欧阳修"],"P":["朴树"],"C":["曹操"],"A":["安然"],"Y":["尉迟恭"]}
```

## 但是 surname 不能随手打开

我一开始的想法是：工具里干脆默认开 `all`，反正姓氏读音"更准"。试了几句普通文本就放弃了：

```
输入              off                               head                              all
行长单雄信        háng zhǎng dān xióng xìn          xíng cháng dān xióng xìn          háng zhǎng shàn xióng xìn
我曾经见过曾国藩  wǒ céng jīng jiàn guò céng guó fān  （同 off）                          wǒ zēng jīng jiàn guō zēng guó fān
解放              jiě fàng                          xiè fàng                          xiè fàng
区长              qū zhǎng                          ōu cháng                          ōu cháng
单于              chán yú                           shàn yú                           shàn yú
朴实              pǔ shí                            piáo shí                          piáo shí
```

几个结论：

- `all` 会把正文里的"曾经"读成 zēng jīng，"见过"读成 jiàn guō（过 也是姓）。它只适合"整串都是人名"的场景，比如一个字段里存了多个用顿号分开的名字，普通文本千万别用。
- `head` 也只能用在人名字段上。"行长""区长""解放"放在开头，同样会被当成姓，连"长"都跟着读错成 cháng。
- 姓氏模式本身也不是万能的。"单于"这种专有名词本来读 chán yú，开了反而错。

所以这个开关的正确用法是：**调用方明确知道这是一个人名时才开 `head`**，而不是工具替调用方猜。

## 问题二：地名，surname 帮不上

再拿行政区划里的县市名跑一遍（数据就用 cn-dev-mcp 自带的省市县表）：

| 地名 | 结果 | 正确读音 |
|---|---|---|
| 乐清市 | lè qīng | yuè qīng |
| 乐亭县 | lè tíng | lào tíng |
| 单县 | dān xiàn | shàn xiàn |
| 洪洞县 | hóng dòng | hóng tóng |
| 歙县 | xī xiàn | shè xiàn |
| 涡阳县 | wō yáng | guō yáng |
| 黄陂区 | huáng bēi | huáng pí |
| 筠连县 | yún lián | jūn lián |
| 大埔县 | dà pǔ | dà bù |
| 郫都区 | pí dōu | pí dū |
| 台州市 | tái zhōu | tāi zhōu（浙江） |

也有本来就对的：六安 lù ān、蚌埠 bèng bù、番禺 pān yú、铅山 yán shān、亳州 bó zhōu、犍为 qián wéi，说明词典里收了一部分，但覆盖不全。README 里那句"按拼音首字母分组城市列表"，乐清会进 L 组，乐亭也是。

地名不是姓，`surname` 管不到。`pinyin-pro` 提供了 `customPinyin` 自定义词典：

```js
import { pinyin, customPinyin } from 'pinyin-pro'
customPinyin({ '乐清': 'yuè qīng', '单县': 'shàn xiàn', '洪洞': 'hóng tóng' })
pinyin('乐清市')   // yuè qīng shì
pinyin('洪洞县')   // hóng tóng xiàn
pinyin('快乐清单') // kuài yuè qīng dān  ← 出事了
```

这里有两个坑：

1. **自定义词条会跨词匹配**。"快乐清单"里恰好有连续的"乐清"，被替换成了 yuè qīng，结果比不加词典还差。词条越短越容易误伤。
2. **它是全局状态**。在 Node 进程里调用一次，之后所有 `pinyin()` 调用都受影响；我以为 `customPinyin({})` 能清空，实测不行，`乐清市` 还是 yuè qīng。要用 `clearCustomDict('pinyin')` 才能清掉。MCP 服务器、Web 服务这种长驻进程里尤其要注意，一个请求加的词条会影响后面所有请求。

我最后的做法是不碰全局词典，**在"地名字段"这一层做覆盖**：

```js
// 只覆盖完整地名，按字段查表，查不到再交给 pinyin-pro
const PLACE_PINYIN = {
  '乐清市': 'yuè qīng shì',
  '乐亭县': 'lào tíng xiàn',
  '单县': 'shàn xiàn',
  '洪洞县': 'hóng tóng xiàn',
  // ...
}
const placePinyin = (name) => PLACE_PINYIN[name] ?? pinyin(name)
```

键用完整的"乐清市"而不是"乐清"，又只在地名字段上查表，普通文本里的"快乐清单"不会被碰到。表需要自己维护，但县级以上的多音地名数量有限，一次整理好就行。

## 做首字母索引时顺带要注意的几处

**声调变调。** `pinyin-pro` 默认开启"一""不"变调：

```js
pinyin('一个不对')                       // yí gè bú duì
pinyin('一个不对', { toneSandhi: false }) // yī gè bù duì
```

做朗读、注音是对的；如果要和别的系统按"字的本调"对齐（比如拿带声调的拼音做唯一键），记得关掉。只做首字母或无声调检索时没影响。

**ü 怎么写。** `toneType: 'none'` 时"吕"输出 `lü`，用户在搜索框里输入的是 `lv`。加 `v: true` 会输出 `lv`，适合生成搜索关键词：

```js
pinyin('吕布绿女', { toneType: 'none' })          // lü bu lü nü
pinyin('吕布绿女', { toneType: 'none', v: true }) // lv bu lv nv
```

**非中文字符。** 不加 `nonZh: 'consecutive'` 时，`Vue3教程` 取首字母会被拆成 `V u e 3 j c` 六项；加了之后是 `Vue3 j c`。cn-dev-mcp 已经加了这个选项，所以首字母是 `Vue3jc`。如果要做大小写不敏感的搜索，还得自己再 `toLowerCase()` 一下，工具不会替你转。

## 给工具补的改动

改动思路就是上面那条：不默认开，加一个参数让调用方声明"这是人名"。

```ts
export function toPinyin(text: string, tone = 'symbol', mode = 'full', isName = false) {
  const surname = isName ? 'head' : 'off'
  if (mode === 'initial') return { text, initials: pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive', surname }).join('') }
  const arr = pinyin(text, { toneType: tone, type: 'array', nonZh: 'consecutive', surname })
  return { text, pinyin: arr.join(' '), array: arr }
}
```

MCP 工具的入参里加一个可选的 `isName: z.boolean()`，描述里写清楚"text 是一个人名时才设为 true"，这样 AI 助手在处理通讯录时会带上它，处理普通句子时不会。测试补了四条，包括"不带 isName 时'解放'仍然是 jiě fàng"，防止以后有人图省事把默认值改成开。

本地用官方 SDK 的 stdio 客户端调了一遍：改之前传 `{ text: '单雄信', isName: true }` 返回 `dān xióng xìn`（未知参数被 zod 直接丢掉，不会报错，这一点也挺容易让人误以为生效了）；改之后返回 `shàn xióng xìn`。`npm test` 12 条全部通过。

写这篇时这个改动还没有合进仓库，仓库里目前还是上面"先看代码"那一版，地名覆盖表也还没加。

## 小结

- 汉字转拼音库对普通词语的多音字处理得不错，问题集中在姓氏和地名这两类专名上，`Intl.Collator` 排序也一样会错。
- `pinyin-pro` 的 `surname: 'head'` 能解决姓氏，但只能用在人名字段；`all` 会把正文读错，普通文本一律别开。
- 地名用 `customPinyin` 要小心跨词误伤和全局状态，更稳的是在字段层用完整地名查表覆盖。
- 生成搜索关键词时注意 ü → v、非中文字符和大小写。

一句话：多音字的上下文，调用方比库清楚。工具能做的是把开关留出来，而不是替调用方猜。

仓库：https://github.com/MsNan/cn-dev-mcp
