---
title: "跳到「第二节」，文末却出现了 [1] #sec：公众号脚注把页内锚点和邮箱也编号了"
date: 2026-11-17
category: 前端
tags: [JavaScript, Markdown, 公众号]
description: "md-multi-format 的 toWechat 在 HEAD 061854a 上复现：页内锚点、mailto/tel、相对路径、空 href 会被收进参考链接，链接文字等于网址时正文和文末会各写一次。"
---

<div v-pre>


给公众号排版时，正文里的外链不能点，我是把它们收成文末的「参考链接」，同一地址只编一次号。裸网址和 `<https://…>` 这种本身就能读，不再加脚注；`mp.weixin.qq.com` 的文章链接则保留成可点的 `<a>`。这些规则之前写过，今晚没有改它们。

今晚是把各种 `href` 挨个喂给 `toWechat`，看哪些不该出现在参考链接里的也被编号了。仓库是 md-multi-format，HEAD `061854a`，Node 24.22.1，官方测试 45 条全绿，CI run 42399778580 通过。下面的 HTML 都是函数直接返回的，没有粘到公众号编辑器里再看一遍。

## 页内锚点变成了 `[1] #sec`

Markdown 里写 `跳到 [第二节](#sec)`，本意是页内跳转。公众号输出却是：正文「第二节」后面跟一个 `[1]`，文末多一行：

```text
[1] #sec
```

`#sec` 既不能在公众号里点，单独抄下来也没有用。预览和知乎那两路没有做脚注，还保留着 `href="#sec"`，只有公众号这条链路会把它收进参考链接。

## 邮箱、电话、相对路径也会进文末

同一套逻辑对所有「不是裸网址、也不是微信文章链接」的 `href` 一视同仁，只要 markdown-it 认成了链接，就编号。我试下来这些都会出现在参考链接里：

| 写法 | 文末出现的内容 |
| --- | --- |
| `[写信](mailto:foo@example.com)` | `[1] mailto:foo@example.com` |
| `[打电话](tel:+8613800138000)` | `[1] tel:+8613800138000` |
| `[ftp](ftp://files.example.com/a)` | `[1] ftp://files.example.com/a` |
| `[打开](weixin://dl/business/?t=1)` | `[1] weixin://dl/business/?t=1` |
| `[页](/posts/hi)`、`[相对](./foo.md)`、`[无斜杠](foo.md)` | 三个编号，分别是 `/posts/hi`、`./foo.md`、`foo.md` |
| `[空]()` | `[1] `，编号在，地址是空的 |

`javascript:alert(1)` 和 `data:text/plain,hi` 没有走进脚注，正文里还是原来的方括号写法。这是 markdown-it 默认不把这类协议解析成链接，不是脚注逻辑把它拦下来的。

真正的 http(s) 地址该编号的仍然会编号。`[定位](https://example.com/page#hash)` 的文末是 `[1] https://example.com/page#hash`，这个井号是网址的一部分，应该保留。

## 链接文字就是网址时，正文和文末会各写一次

`[https://e.com](https://e.com)` 的 `markup` 是空字符串，走的是普通链接，不是 linkify。结果正文已经写出了 `https://e.com`，后面再跟一个 `[1]`，文末再列一次同一个地址。

我把几种情况写在同一段里：

```md
目录 [第二节](#sec) 和 [文档](https://a.com/x) 和 [https://e.com](https://e.com) 和 [写信](mailto:a@b.com) 官网 https://a.com/x
```

输出的参考链接是：

```text
[1] #sec
[2] https://a.com/x
[3] https://e.com
[4] mailto:a@b.com
```

最后那个裸网址 `https://a.com/x` 没有再占一个新编号，这一条原来的去重还在。真正有用的其实只有 `[2]`。

## 我改了什么

补丁在 `daily/2026-11-17-fn-href.patch`，对 `061854a` 可以 `git apply --check`。还没有提交，也没有推送。

规则补了两条：`href` 不是 `http://` 或 `https://` 开头的，不编号；下一个 token 是纯文字、再下一个是 `link_close`，并且文字和 `href` 完全相同的，也不编号。`mp.weixin.qq.com`、裸网址、同一地址只编一次，这些原有行为没有动。补丁后，上面那段混写只剩下 `[1] https://a.com/x`。官方测试从 45 条加到 47 条，全部通过。

限制也要说清。文字和地址相同这一条，只覆盖链接里是一段纯文字的情况；如果写成 `[**https://e.com**](https://e.com)`，中间夹了加粗，这次的判断就够不到，这种我没有改。也没有把这段 HTML 再贴进公众号后台看一次实际显示。

仓库：https://github.com/MsNan/md-multi-format

</div>
