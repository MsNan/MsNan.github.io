---
title: "群里 @ 机器人发\"查订单\"，指令一条都没命中：微信群机器人在路由前漏掉的几步归一化"
date: 2026-11-10
category: 后端
tags: [Python, 微信, 正则表达式, 机器人]
description: "wechat-group-bot 复现：消息开头的 @ 让指令正则全部落空、全角数字和中文冒号不命中、前缀匹配过宽、contains 关键词误伤、冷却吞掉第二次查询、settings.json 带 BOM 整份失效；附补丁。"
---

<div v-pre>

我写的 wechat-group-bot 是一个 Windows 上跑的微信群自动回复机器人，通过 UI Automation 读群消息。每条消息依次过三层：

1. **业务指令**（`handlers.py`）：`查订单 xxx`、`查库存 xxx` 这类，查库或调后端接口，结果来自真实数据；
2. **关键词规则**（`config.RULES`）：固定话术，比如有人问"在吗"；
3. **AI 兜底**：前两层都没命中才轮到它，默认只在被 @ 时调用。

业务指令排在 AI 前面，是为了让订单号、库存这类有唯一答案的问题不交给 AI 去猜。指令用正则注册，从上往下匹配：

```python
HANDLERS = [
    {"name": "查订单", "pattern": r"^查订单\s*([A-Za-z0-9_-]+)", "func": handle_query_order},
    {"name": "查库存", "pattern": r"^查库存\s*([A-Za-z0-9_-]+)", "func": handle_query_stock},
    {"name": "今日销售", "pattern": r"^今天?销售", "func": handle_today_sales},
    {"name": "记录备注", "pattern": r"^记一笔\s*(.+)", "func": handle_note},
    ...
]

def route(sender, content, group, api=None, db=None, store=None):
    text = (content or "").strip()
    for pattern, h in _COMPILED:
        m = pattern.match(text)
        ...
```

自测脚本 `python handlers.py` 里的六条用例全部通过。问题在于，群里真实发出来的消息和自测用例长得不一样。

这次我没连微信，而是把 `bot.py` 里 Windows 专用的 `uiautomation`、`comtypes` 用 `MagicMock` 顶掉，直接调 `handlers.route()`、`bot.should_handle()`、`bot.build_reply()` 这几个纯逻辑函数。Python 3.13.5，仓库 HEAD `e694eb7`。

## 1. 消息开头带着 @，`^` 锚点永远对不上

在群里叫机器人干活，大家的习惯是先 @ 它再说事。从界面读到的消息正文里是带着这个 @ 的，`bot.py` 判断"有没有 @ 我"就是在正文里找 `@tao`：

```python
def _is_at_me(content):
    """微信的 @ 后面跟的是特殊空格 U+2005，不是普通空格，所以只匹配前缀。"""
    return f"@{config.MY_NICKNAME}" in content
```

而指令正则全都以 `^` 开头：

```text
'查订单 202608270001'              -> 命中「查订单」参数=('202608270001',)
'@tao\u2005查订单 202608270001'    -> 没命中任何指令
'@tao 查订单 202608270001'         -> 没命中任何指令
```

没命中业务指令，消息会继续往下走。AI 默认配置是 `only_when_at_me: True`，而这条消息恰好 @ 了机器人，于是：

```text
AI 关：(None, '无命中')                    → 不回复
AI 开：('（AI 自由发挥的回复）', 'AI')        → 交给 AI 回答
```

（AI 那一层我用一个假的 AI 对象顶替，只看消息落到了哪一层。）

也就是说，带 @ 的查单请求恰好绕过了专门为它设计的那一层，落到了最不该回答它的 AI 手里。system prompt 里虽然写了"没有真实数据就让对方发查询指令"，但用户已经发了指令。

如果再按 README 的说法把 `ONLY_REPLY_WHEN_AT_ME` 改成 True（"只在被 @ 时回复，最不惹人烦"），情况更明显：

```text
'查订单 202608270001'          should_handle=False 没有 @ 我    -> 不处理
'@tao\u2005查订单 202608270001' should_handle=True              -> (None, '无命中')
'查订单 202608270001 @tao'      should_handle=True              -> 命中业务指令
```

不 @ 被过滤，先 @ 再说又匹配不上，只有把 @ 放到句尾才能用。可微信里 @ 人基本都是先 @ 再打字的。

## 2. 全角数字和中文冒号

中文输入法下打字，下面两种写法都很常见：

```text
'查订单 ２０２６０８２７０００１'  -> 没命中任何指令
'查订单：202608270001'            -> 没命中任何指令
```

正则里写的是 `[0-9]`，全角数字 `０-９` 是另外一组码位。冒号是被 `\s*` 卡住的：它只允许空白。这两种情况用户看起来"格式没错"，机器人却不理他。

## 3. 前缀匹配太宽：抱怨一句也会触发播报

反过来的问题是有的正则太松：

```text
'今天销售'                -> 命中「今日销售」
'今天销售额怎么掉这么多'    -> 命中「今日销售」
```

`^今天?销售` 只锚了开头，没锚结尾。群里有人吐槽一句，机器人就跑去查库，再让 AI 用一句话"自然地播报"今天的销售额，场面会很尴尬。这一条要收紧到整句匹配，允许带个问号就够了。

（`查库存 A100 和 B200` 只查 A100，这个是设计如此：一条指令查一个编号。这里只是记一下，没改。）

## 4. 改法：匹配前先整理文本，只用于匹配

我在 `handlers.py` 里加了一个 `command_text()`，`route()` 先用它整理再去匹配：

```python
# 全角数字和字母（０-９ Ａ-Ｚ ａ-ｚ）转半角。只转这三段：中文的逗号、括号这些全角标点
# 要原样留着，「记一笔」会把内容原文存下来。
_FULLWIDTH_ALNUM = {cp: cp - 0xFEE0 for cp in (
    *range(0xFF10, 0xFF1A), *range(0xFF21, 0xFF3B), *range(0xFF41, 0xFF5B))}

def command_text(content, nickname=""):
    text = (content or "").translate(_FULLWIDTH_ALNUM).strip()
    nick = (nickname or "").strip()
    if nick:
        mention = "@" + nick
        while text.startswith(mention):
            rest = text[len(mention):]
            if rest and not rest[0].isspace():    # @taobao 不是 @tao
                break
            text = rest.lstrip()                  # str.lstrip 会去掉 U+2005、全角空格
    return text
```

正则那边改成：

```python
r"^查订单[\s:：]*([A-Za-z0-9_-]+)"
r"^查库存[\s:：]*([A-Za-z0-9_-]+)"
r"^今天?销售(?:额|情况|统计)?[?？!！。]*$"
```

有几个地方是刻意的：

- **一开始我直接用了 `unicodedata.normalize("NFKC", ...)`**，一行就把全角数字、全角冒号、U+2005 都处理了。跑了一下 `记一笔 客户要１０个，㎡价另算`，存下来变成了 `客户要10个,m2价另算`：中文逗号变成了英文逗号，㎡ 变成了 m2。NFKC 改动的范围比"全角转半角"大得多，而备注是要原样存的。所以最后只转数字和字母三段，冒号在正则里单独允许。
- **只去掉 @ 自己的部分。** `@小李 查订单 xxx` 是在叫小李，机器人不该抢答，改完之后这条仍然不命中。
- **`@taobao` 不能当成 `@tao`**，所以 @ 后面必须紧跟空白或者结束。
- **`ctx.content` 仍然是原文**，只有匹配和捕获参数用整理后的文本。

改完后同一批用例：

```text
'@tao\u2005查订单 202608270001'            -> 命中「查订单」参数=('202608270001',)
'@tao\u2005@tao\u2005查订单 202608270001'  -> 命中「查订单」参数=('202608270001',)
'查订单 ２０２６０８２７０００１'              -> 命中「查订单」参数=('202608270001',)
'查订单：202608270001'                      -> 命中「查订单」参数=('202608270001',)
'@小李\u2005查订单 202608270001'             -> 没命中任何指令
'今天销售额怎么掉这么多'                       -> 没命中任何指令
'@tao\u2005记一笔 客户要１０个，明早前（加急）' -> 命中「记录备注」参数=('客户要10个，明早前（加急）',)
```

`ONLY_REPLY_WHEN_AT_ME = True` 时，`@tao 查订单` 也能走到业务指令了。备注里的数字转成了半角，中文标点保持不变，这是唯一的行为变化。

## 5. 关键词规则：contains 模式对短词太宽

第二层的默认规则是这样的：

```python
{"keywords": ["在吗", "在不在", "有人吗"], "reply": "在的 {sender}，有什么事你说～", "mode": "contains"}
```

实际跑一下：

```text
'在吗'              -> '在的 小王，有什么事你说～'
'这个 bug 还存在吗'   -> '在的 小王，有什么事你说～'
'他现在不在线吗'      -> '在的 小王，有什么事你说～'
```

"存在吗"里有"在吗"，"现在不在线"里有"在不在"。两个字的关键词用"包含"匹配，在中文里很容易撞上别的词。这一条我没改代码，因为默认规则只是示例，改法取决于你的群：要么把这类问候改成 `exact`，把"在吗？""在吗在吗"这些常见变体列全；要么加一个长度限制，比如消息超过 6 个字就不走 contains。

## 6. 冷却时间会吞掉第二次查询

防风控的配置里有一条 `PER_SENDER_COOLDOWN = 30`：同一个人 30 秒内只回一次。

```text
第一单 check: (True, '')
第二单 check: (False, '对 小王 冷却中（还剩 29s）')
```

对闲聊来说这很合理，但对业务指令来说，一个人连查两个订单是正常操作，第二条会被静默丢掉，只在日志里留一行"有回复内容但不发"。这也没改，因为冷却是为了防封号，放宽之前要想清楚。比较稳妥的做法是给业务指令单独设一个更短的冷却，或者在冷却期内把第二条攒起来，冷却结束再合并回复。

## 7. 顺带：settings.json 带 BOM 会整个失效

打包成 exe 后改配置只能靠 `settings.json`，打包说明里写的是"用记事本打开 settings.json"。记事本保存时可以选"带 BOM 的 UTF-8"，老版本的 Windows 记事本存 UTF-8 时默认就带 BOM。试了一下：

```text
无 BOM    LOADED_FROM_JSON=True  DRY_RUN=False
带 BOM    LOADED_FROM_JSON=False DRY_RUN=True   [!] settings.json 解析失败，将使用 config.py 的默认值: Unexpected UTF-8 BOM (decode using utf-8-sig)
键名拼错   LOADED_FROM_JSON=True  DRY_RUN=True   （没有任何提示）
```

带 BOM 时整份配置都不生效：`DRY_RUN` 还是 True，AI 的 key 也没读进去，机器人只在日志里打 `[演习] 本来会回复: ...`。好在默认值是安全的，只是会让人以为配置改了没用。改法是读文件时用 `encoding="utf-8-sig"`，有没有 BOM 都能读。另外，键名拼错（比如 `DRY_RUM`）会被当成一个新属性悄悄写进去，我加了一行提示，照常写入、只是告诉你"这不是已知配置项"。

## 小结

这次的问题都不在正则本身，而在"测试用例是开发者打的，真实消息是群友打的"：开头带 @、全角数字、中文冒号、随口一句话里恰好有关键词。在消息进入任何匹配之前先整理一遍，并且只用于匹配、不改原文，是性价比最高的一步。补丁只改了 `handlers.py` 和 `config.py`，还没合进仓库。

仓库：https://github.com/MsNan/wechat-group-bot

</div>
