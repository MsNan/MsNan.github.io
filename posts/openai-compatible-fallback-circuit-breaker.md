---
title: "HTTP 200 但回复是空的：OpenAI 兼容接口的主备降级与熔断，用本地假服务把每种失败跑一遍"
date: 2026-10-23
category: 后端
tags: [Python, 大模型, OpenAI, 测试]
description: "用本地假服务模拟空内容、429、500、HTML、超时，验证大模型主备降级与熔断：推理模型 max_tokens 被思考吃光、429 直接让位、失败轮次不进记忆。"
---

我的微信群机器人（wechat-group-bot）里有一层"AI 兜底"：业务指令和关键词都没命中、并且有人 @ 它的时候，才去调大模型。国内几家（智谱、DeepSeek、通义、Kimi、豆包、文心）都提供 OpenAI 兼容的 `/chat/completions` 接口，所以这一层没装任何厂商 SDK，就是 `requests.post`，配置里可以按顺序放好几个模型，前一个失败就换下一个。

这层代码不长，`ai_provider.py` 不到 400 行。但"失败"的样子比我一开始想的多：超时、429、500、返回了 HTML、HTTP 200 但内容是空的……每一种都应该走到下一个模型，而且日志里要能看出是哪一种。

线上的接口没法按需让它坏，所以我写了个本地的假服务，按 URL 路径决定返回哪种失败，然后用仓库里原样的 `ai_provider.py` 去打它。这篇记录这个过程。环境：Python 3.13.5，requests 2.34.2；下面的输出都是在这台机器上实际跑出来的，没有用任何真实的 API key。

## 接入层的结构

两个类：`Provider` 负责调一个模型，`AIEngine` 按顺序试多个 `Provider`。

```python
class Provider:
    def __init__(self, key, api_key, base_url=None, model=None,
                 timeout=20, max_tokens=300, temperature=0.7):
        preset = PRESETS.get(key, PRESETS["custom"])
        self.base_url = (base_url or preset["base_url"]).rstrip("/")
        self.model = model or preset["model"]
        ...
        self._fails = 0           # 连续失败计数
        self._blocked_until = 0   # 熔断到什么时候

    @property
    def available(self):
        if not self.api_key or not self.base_url or not self.model:
            return False
        return time.time() >= self._blocked_until
```

`chat()` 成功返回文本，任何失败都返回 `None`，并且按失败类型处理熔断：

- 网络异常（包括超时）、非 200、响应解析失败、内容为空：`_fails += 1`，连续 3 次熔断 120 秒；
- 429：直接熔断 60 秒，不计入 `_fails`；
- 成功：`_fails` 清零。

`AIEngine.reply()` 跳过 `available` 为 False 的，按顺序调，第一个拿到非空文本就返回；全部失败返回 `None`，上层就不回这条消息。

## 一个按路径"坏掉"的假服务

只用标准库，路径第一段决定行为，顺便把收到的请求打出来（带没带 `thinking` 字段、`messages` 有几条），后面要用：

```python
# fake_llm.py
import json, time, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def ok(text, **usage):
    return {"choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": text}}],
            "usage": usage}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        mode = self.path.split("/")[1]
        print(f"  [fake] {self.path}  thinking={body.get('thinking')}  messages={len(body['messages'])}", flush=True)
        if mode == "slow":
            time.sleep(3)
        if mode == "ratelimit":
            return self.send(429, {"error": {"message": "rate limit"}})
        if mode == "down":
            return self.send(500, {"error": {"message": "internal error"}})
        if mode == "empty":   # 推理模型把 max_tokens 用在思考上，content 为空
            return self.send(200, {"choices": [{"index": 0, "finish_reason": "length",
                    "message": {"role": "assistant", "content": ""}}],
                    "usage": {"completion_tokens": 64, "completion_tokens_details": {"reasoning_tokens": 64}}})
        if mode == "html":    # 网关返回了一个 200 的 HTML 页面
            return self.send(200, "<html>502 Bad Gateway</html>", raw=True)
        return self.send(200, ok(f"在的（来自 {mode}）"))
    def send(self, code, data, raw=False):
        b = (data if raw else json.dumps(data, ensure_ascii=False)).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 18080), H).serve_forever()
```

`Provider` 的 `base_url` 可以随便填，所以把它指到 `http://127.0.0.1:18080/empty`、`/ok` 之类就行，被测代码一行不用改。

## 最隐蔽的一种：HTTP 200，content 是空字符串

推理模型（会先"思考"再回答的那类）有个特点：思考过程也算在 `max_tokens` 里。群聊回复我只给了 300 个 token 的额度，如果模型想得多，额度在思考阶段就用完了，最终 `content` 是空字符串，`finish_reason` 是 `length`，而 HTTP 状态码是 200。

仓库代码注释里记着 9 月 7 日对智谱 glm-4.7-flash 的实测（max_tokens=64）：默认情况下 `finish_reason='length'`、`content=''`、`reasoning_tokens=64`；请求里带上 `"thinking": {"type": "disabled"}` 之后正常返回，总消耗从 64 降到 14。这次我手上没有 key，没有重测，假服务的 `/empty` 就是照着这个形状返回的。

代码里对应两处处理。一是对支持的模型主动关掉思考：

```python
if self._supports_thinking_switch():
    payload["thinking"] = {"type": "disabled"}
```

二是把空内容当失败上报，并且把 `finish_reason` 和 `reasoning_tokens` 写进日志：

```python
text = choice["message"].get("content")
if not (text or "").strip():
    fr = choice.get("finish_reason")
    rt = ((data.get("usage") or {}).get("completion_tokens_details")
          or {}).get("reasoning_tokens")
    self._mark_fail(
        f"返回内容为空 (finish_reason={fr}, reasoning_tokens={rt})。"
        f"若 finish_reason=length 且 reasoning_tokens 很大，"
        f"说明 max_tokens 被思考过程吃光了，调大 max_tokens 或关掉 thinking")
    return None
```

主模型指向 `/empty`，备用指向 `/ok`，连发 4 条消息：

```python
import sys, logging, time
sys.path.insert(0, "/path/to/wechat-group-bot")
logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
from ai_provider import Provider, AIEngine
B = "http://127.0.0.1:18080"
main = Provider("zhipu", "k1", base_url=f"{B}/empty/v4", model="glm-4.7-flash")
backup = Provider("deepseek", "k2", base_url=f"{B}/ok", model="deepseek-v4-flash")
eng = AIEngine([main, backup], system_prompt="你是群助手")
for i in range(4):
    print(f"--- 第 {i+1} 条消息")
    print("回复：", eng.reply("小王", "在吗", "测试群"))
print("主模型 available =", main.available, " 剩余熔断秒数 =", round(main._blocked_until - time.time()))
```

```
--- 第 1 条消息
[AI/智谱 GLM] 调用失败(1): 返回内容为空 (finish_reason=length, reasoning_tokens=64)。若 finish_reason=length 且 reasoning_tokens 很大，说明 max_tokens 被思考过程吃光了，调大 max_tokens 或关掉 thinking
[AI/DeepSeek] 生成回复成功
回复： 在的（来自 ok）
--- 第 2 条消息
[AI/智谱 GLM] 调用失败(2): 返回内容为空 (finish_reason=length, reasoning_tokens=64)。……
[AI/DeepSeek] 生成回复成功
回复： 在的（来自 ok）
--- 第 3 条消息
[AI/智谱 GLM] 调用失败(3): 返回内容为空 (finish_reason=length, reasoning_tokens=64)。……
[AI/智谱 GLM] 连续失败，熔断 120 秒
[AI/DeepSeek] 生成回复成功
回复： 在的（来自 ok）
--- 第 4 条消息
[AI/DeepSeek] 生成回复成功
回复： 在的（来自 ok）
主模型 available = False  剩余熔断秒数 = 120
```

（重复的提示文字我用省略号截掉了。）假服务这边收到的请求：

```
  [fake] /empty/v4/chat/completions  thinking={'type': 'disabled'}  messages=2
  [fake] /ok/chat/completions  thinking=None  messages=2
  [fake] /empty/v4/chat/completions  thinking={'type': 'disabled'}  messages=4
  [fake] /ok/chat/completions  thinking=None  messages=4
  [fake] /empty/v4/chat/completions  thinking={'type': 'disabled'}  messages=6
  [fake] /ok/chat/completions  thinking=None  messages=6
  [fake] /ok/chat/completions  thinking=None  messages=8
```

能看出几件事：

1. 第 4 条消息时主模型已经熔断，直接跳过，没有再发请求。
2. `thinking` 只发给了智谱，DeepSeek 那边没有这个字段。
3. `messages` 从 2 涨到 8，是同一个群的对话记忆在累积（system + 历史 + 本条）。

顺便说一下，如果没有那段"空内容当失败"的判断，`chat()` 最后一行 `return (text or "").strip() or None` 也会返回 `None`，备用模型照样会顶上。区别在于：不计失败次数（永远不熔断，每条消息都先白打一次主模型），日志里也什么都没有。"机器人偶尔不回、日志一片正常"这种问题，排查起来最费时间。

## 429：不一定是你调得太快

```python
P = lambda mode, **kw: Provider("deepseek", "k", base_url=f"{B}/{mode}", model="m", **kw)
left = lambda p: round(max(0, p._blocked_until - time.time()))

p = P("ratelimit"); print("返回", p.chat([{"role": "user", "content": "hi"}]), "| _fails =", p._fails, "| 熔断剩余", left(p), "秒")
```

```
[AI/DeepSeek] 被限流(429)，熔断 60 秒
返回 None | _fails = 0 | 熔断剩余 60 秒
```

429 是一次就熔断 60 秒，不等连续 3 次。限流的时候紧接着重试基本还是 429，不如直接让给备用模型。

仓库的配置注释里还记了一个现象：同一天测智谱的 glm-4.7-flash，持续返回 429，错误码是 1305（"该模型当前访问量过大"），而账号自己超速是 1302。也就是说免费模型被挤爆时你也会收到 429，跟自己的调用频率无关。所以它在我的配置里被放在了备用位置，主力换成了 glm-4-flash-250414。

## 500、超时、200 的 HTML

```python
p = P("down")
for _ in range(3): p.chat([{"role": "user", "content": "hi"}])
print("熔断剩余", left(p), "秒, available =", p.available)

p = P("html"); p.chat([{"role": "user", "content": "hi"}])

eng = AIEngine([P("slow", timeout=1), P("ok")])
t = time.time(); r = eng.reply("小王", "在吗", "群A"); print("回复", r, f"耗时 {time.time()-t:.1f}s")
```

```
[AI/DeepSeek] 调用失败(1): HTTP 500: {"error": {"message": "internal error"}}
[AI/DeepSeek] 调用失败(2): HTTP 500: {"error": {"message": "internal error"}}
[AI/DeepSeek] 调用失败(3): HTTP 500: {"error": {"message": "internal error"}}
[AI/DeepSeek] 连续失败，熔断 120 秒
熔断剩余 120 秒, available = False
[AI/DeepSeek] 调用失败(1): 响应解析失败: Expecting value: line 1 column 1 (char 0) | 原文: <html>502 Bad Gateway</html>
[AI/DeepSeek] 调用失败(1): 网络异常: HTTPConnectionPool(host='127.0.0.1', port=18080): Read timed out. (read timeout=1)
[AI/DeepSeek] 生成回复成功
回复 在的（来自 ok） 耗时 1.0s
```

（假服务那边这时会打印一个 BrokenPipeError：它睡完 3 秒想回写时客户端已经断开了，不影响结果。）

200 + HTML 这种情况在走代理或网关时会遇到，状态码看着正常，`resp.json()` 才报错。代码把解析放在 try 里，失败时把原文前 200 个字符写进日志，一眼就能看出返回的不是 JSON。

超时那组要注意：降级是串行的，最坏情况下的等待时间是每个模型的 timeout 加起来。我的默认配置是 20 秒，两个模型都卡住就是 40 秒后才放弃。群聊里一条回复晚 40 秒基本没意义了，所以 timeout 宁可设短一点；连续 3 次超时也会触发熔断，之后就不会每条都等满 20 秒。

## 全部失败时，这一轮不进记忆

```python
eng = AIEngine([P("down"), P("ratelimit")], memory_turns=2)
print("返回", eng.reply("小王", "在吗", "群B"), "| 记忆条数", len(eng.memory.get("群B")))
```

```
[AI/DeepSeek] 调用失败(1): HTTP 500: {"error": {"message": "internal error"}}
[AI/DeepSeek] 被限流(429)，熔断 60 秒
[AI] 所有模型都失败了，降级不回复
返回 None | 记忆条数 0
```

`reply()` 里只有拿到回复之后才把这一轮写进记忆：

```python
for p in self.providers:
    if not p.available:
        continue
    text = p.chat(messages)
    if text:
        self.memory.add(group, "user", f"{sender}: {content}")
        self.memory.add(group, "assistant", text)
        return text
```

如果先写用户消息再调模型，失败时记忆里就会留下一条"没有回答的问题"，下一轮模型可能会去回答上一个问题。

记忆按群隔离，用 `deque(maxlen=max_turns * 2)` 只留最近几轮：

```python
eng = AIEngine([P("ok")], system_prompt="sys", memory_turns=2)
for i in range(4): eng.reply("小王", f"第{i+1}句", "群C")
eng.reply("小李", "你好", "群D")
print("群C 记忆：", [m["content"] for m in eng.memory.get("群C")])
print("群D 记忆条数：", len(eng.memory.get("群D")))
```

```
群C 记忆： ['小王: 第3句', '在的（来自 ok）', '小王: 第4句', '在的（来自 ok）']
群D 记忆条数： 2
```

假服务看到群 C 四次请求的 `messages` 是 2、4、6、6，到上限后就不再增长；群 D 的第一次请求是 2，没有混进群 C 的内容。这就是控制 token 成本的方式：每次请求的长度有上限。

## base_url 和 thinking 开关的判定

各家 `base_url` 写法不一致，有的带 `/v1`，有的不带，有人会直接把完整的 `/chat/completions` 地址贴进来：

```python
def _endpoint(self):
    if self.base_url.endswith("/chat/completions"):
        return self.base_url
    return f"{self.base_url}/chat/completions"
```

```
https://api.deepseek.com                         -> https://api.deepseek.com/chat/completions
https://api.moonshot.cn/v1/                      -> https://api.moonshot.cn/v1/chat/completions
http://127.0.0.1:11434/v1/chat/completions       -> http://127.0.0.1:11434/v1/chat/completions
```

末尾的 `/` 在构造函数里 `rstrip` 掉了。代码不去猜要不要补 `/v1`，`base_url` 填什么就用什么，各家预设里已经写好了正确的值。

`thinking` 字段不是 OpenAI 标准参数，别的厂商不一定认，所以判断条件是"预设是智谱，或者模型名里带 glm-4.5/4.6/4.7/glm-5"：

```
zhipu    glm-4-flash        -> True
custom   glm-4.7-flash      -> True
deepseek deepseek-v4-flash  -> False
custom   qwen-turbo         -> False
```

预设是 zhipu 时，非推理的 glm-4-flash 也会带上这个字段。仓库默认主力就是 zhipu 预设的 glm-4-flash-250414，配置注释记着它实测 HTTP 200，但注释没写那次请求带没带 thinking，我这次没有 key，这一点没法重测。第二行是另一种情况：用 custom 预设、经过别的网关调 glm 模型时也会带上，如果那个网关不认这个字段报 400，就会按普通失败处理、切到下一个模型，日志里能看到 400 和返回内容。

## 小结

1. HTTP 200 不等于成功。至少还要检查 JSON 能不能解析、`content` 是不是空，空的时候把 `finish_reason` 和 `reasoning_tokens` 打出来。
2. 推理模型做短回复，`max_tokens` 可能全被思考用掉；能关思考就关掉。
3. 429 一次就让位，其他错误连续几次再熔断；429 也可能是对方免费池被挤爆。
4. 串行降级的最坏耗时是各个 timeout 之和，按场景能接受的延迟来设。
5. 只有成功的一轮才写进对话记忆；记忆按会话隔离并限制长度。
6. 这类代码用一个按路径返回不同错误的本地假服务来测最省事，被测代码只要 `base_url` 可配就行，不需要 key，也不花钱。

完整代码在 https://github.com/MsNan/wechat-group-bot
