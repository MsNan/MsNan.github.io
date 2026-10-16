---
title: "用 Python + UI Automation 读写微信 PC 版：群消息自动回复的实现与踩坑"
date: 2026-10-16
category: Python
tags: [Python, UI Automation, AI, Windows]
description: "基于 Windows UI Automation 读取微信 PC 版群消息，三层决策回复、多模型降级熔断与限流，附踩坑记录。"
---

> ⚠️ **先说风险**：个人微信的第三方自动化违反《微信个人账号使用规范》，存在封号风险。本文仅供学习 Windows UI 自动化与消息处理的技术思路，**请勿用于商业或骚扰用途，实验请用小号**。

## 一、背景：为什么选 UI 自动化

想让程序读微信群消息，常见路子有三条：Hook 注入、协议逆向、UI 自动化。前两条风险高、维护成本也高，微信一升级就要重新逆向。UI 自动化走的是 Windows 给读屏软件准备的**无障碍接口（UI Automation）**，只"看"界面、"按"键盘，不碰进程内存，实现上最朴素。

代价也很明确：

- 只能在 Windows 上跑，而且必须是**已登录的交互式桌面**（锁屏就读不到）；
- 强依赖微信客户端版本——实测 **4.1.8.107** 可用，**4.1.13 起**关闭了无障碍接口，任何 UI 自动化方案都读不到内容。

整个项目只依赖一个开源库 `uiautomation`（Apache-2.0），读写微信界面的部分自己封装在 `wxui/` 里。

## 二、wxui：把微信窗口"读"出来

### 2.1 找主窗口：别只认一个类名

第一个坑：微信主窗口的 ClassName 不固定。同一台机器上实测出现过 `mmui::MainWindow` 和 `Qt51514QWindowIcon` 两种，重启后还会变。所以按"类名 + 标题 + 尺寸"多特征匹配：

```python
MAIN_WINDOW_CLASSES = ("mmui::MainWindow", "Qt51514QWindowIcon")
MIN_MAIN_WIDTH = 500
MIN_MAIN_HEIGHT = 400

for child in root.GetChildren():
    cls = str(child.ClassName or "")
    name = str(child.Name or "")
    rect = child.BoundingRectangle
    if cls not in MAIN_WINDOW_CLASSES:
        continue
    if name != "微信":
        continue
    w, h = rect.width(), rect.height()
    if w < MIN_MAIN_WIDTH or h < MIN_MAIN_HEIGHT:
        continue   # 登录窗、托盘小窗也可能同类名，用尺寸排除
    if w * h > best_area:
        best, best_area = child, w * h
```

### 2.2 先判断"读不读得到"，再谈别的

版本不对时，症状是"窗口找得到，内容全是空的"，非常迷惑。我用 `WM_GETOBJECT` 直接探测窗口有没有实现无障碍接口：

```python
def _has_accessibility(hwnd):
    # 返回 0 表示完全没有 —— 实测微信 4.1.13.12 就是 0
    return int(ctypes.windll.user32.SendMessageW(
        hwnd, _WM_GETOBJECT, 0, ctypes.c_long(_OBJID_CLIENT).value))
```

返回 0 就直接抛 `AccessibilityUnavailable`，和"微信没启动"的 `WeChatNotRunning` 区分开：前者等多久都没用，后者可以等。**把不同性质的失败分成不同异常**，上层才能做对的决策。

### 2.3 新消息怎么算：最长公共后缀对齐

UI 自动化只能拿到"当前屏幕上可见的消息列表"，没有消息 id。每轮轮询拿到一个列表，要算出"本轮新增"。

直觉做法是用集合去重，但那样"同一个人连发两条『在吗』"会被吞掉一条。最后用的是**最长公共后缀对齐**：

```python
def diff_new(previous, current):
    """
        previous:  A B C D
        current:      C D E F   -> 新增 E F
    刻意不用集合去重，所以「D D」这种重复内容能正确识别成两条。
    """
    prev_keys = [m.key() for m in previous]
    cur_keys = [m.key() for m in current]
    max_k = min(len(prev_keys), len(cur_keys))
    for k in range(max_k, 0, -1):
        if prev_keys[-k:] == cur_keys[:k]:
            return current[k:]
    # 完全对不上：可能切了会话或列表被整体刷新，交给上层重建基线
    return None
```

对不上时返回 `None` 而不是"全部当新消息"——后者会导致一次性回复一大堆，相当于刷屏。

### 2.4 判断"是不是自己发的"：看气泡颜色

不识别自己的消息，机器人就会自问自答进入死循环。UIA 树里没有可靠的"发送方"字段，位置判断又受窗口宽度和缩放影响，最终方案是**沿消息行中线横扫像素，找最宽的非背景色块（即气泡），按颜色判定**：

```python
if best is None or best[0] < 30:
    return None
color = best[1]
if _rgb_close(color, SELF_BUBBLE_RGB):
    return True
if _rgb_close(color, PEER_BUBBLE_RGB):
    return False
return None
```

关键约定：**判不出来返回 `None`，业务层把 `None` 当成"不可回复"**，绝不默认成"别人发的"。另一个踩过的坑是视口边缘只露出半截的消息，行中线落在可见区外，扫出来是空的——所以采样 y 要先夹到列表可见范围内。

### 2.5 发送：宁可不发，绝不发错群

发错群是最严重的事故，所以 `send_text` 做了三道确认：

```python
cur = self.current_chat()
if cur != expect_chat:
    raise TargetMismatch("发送前复核不通过 ...")

uia.SetClipboardText(text)          # 中文用剪贴板粘贴，SendKeys 打中文不可靠
box.SendKeys("{Ctrl}a", waitTime=0.05)
box.SendKeys("{Ctrl}v", waitTime=0.15)

cur2 = self.current_chat()          # 输入过程中焦点可能被别的窗口抢走
if cur2 != expect_chat:
    raise TargetMismatch("输入完成后复核不通过 ...")

box.SendKeys("{Enter}", waitTime=0.1)
verified = self._verify_sent(text, verify_timeout)   # 回读界面确认
```

最后一步 `_verify_sent` 会在几秒内回读最近的"自己发的消息"，确认内容真的出现了。**"调用没报错"不等于发出去了**，这一步不能省。

## 三、三层回复决策链

收到一条消息后，按顺序走三层，命中即停：

| 层 | 作用 | 成本 |
|---|---|---|
| 1. 业务指令 `handlers.py` | 查自己的系统（HTTP / MySQL）拿真实数据 | 零 |
| 2. 关键词规则 `RULES` | 固定话术，秒回 | 零 |
| 3. AI 兜底 `ai_provider.py` | 开放式对话，默认只在被 @ 时触发 | 按 token |

为什么业务指令必须排在 AI 前面？**订单号、库存、金额这类有唯一正确答案的问题，交给大模型它会编，而且编得很像真的。**所以这类问题先由业务指令拦下：

```python
result = handlers.route(sender, content, group, api=API, db=DB, store=STORE)

if isinstance(result, handlers.AIAnswer):
    # 查到真实数据了，让 AI 只负责"用人话组织一下"
    if AI and AI.enabled:
        text = _ai_reply(trace, sender, content, group,
                         extra_context=result.as_context())
        if text:
            return text, "业务指令+AI播报"
    # AI 不可用就把原始数据直接给出去，总比不回强
    return result.as_context(), "业务指令(AI不可用,直出数据)"

if isinstance(result, str) and result:
    return result, "业务指令"

text = match_rules(sender, content, group)
if text:
    return text, "关键词规则"

if AI and AI.enabled:
    ...  # 第 3 层：AI 兜底
```

"业务指令 + AI 播报"模式下，system prompt 里会硬性追加：

```python
sys_text += f"\n\n【以下是系统查询到的真实数据，回答必须基于它，不要编造】\n{extra_context}"
```

AI 只负责措辞，不负责事实。

## 四、多模型降级与熔断

AI 层支持配置多个 OpenAI 兼容接口（智谱、DeepSeek、通义等），按顺序尝试，一个失败就换下一个：

```python
for p in self.providers:
    if not p.available:
        continue
    text = p.chat(messages)
    if text:
        self.memory.add(group, "user", f"{sender}: {content}")
        self.memory.add(group, "assistant", text)
        return text

log.warning("[AI] 所有模型都失败了，降级不回复")
return None
```

单个 provider 连续失败 3 次就熔断 120 秒，避免每条消息都去撞一个已经挂掉的接口：

```python
def _mark_fail(self, reason):
    self._fails += 1
    if self._fails >= 3:
        self._blocked_until = time.time() + 120
        self._fails = 0
```

几个兼容性细节：

- 有的厂商 `base_url` 自带 `/v1`，有的不带，`_endpoint()` 统一拼成 `.../chat/completions`；
- 智谱 GLM-4.5 起的"思考模式"会把输出吃光、`content` 返回空，需要传关闭开关；但别的厂商传了这个字段会直接 400，所以按"厂商 + 模型名"双重判定，**宁可不传也不要报错**；
- 会话记忆按群隔离，只保留最近几轮，控制 token 成本。

## 五、降低封号风险的几道闸

再强调一次：这些措施只能**降低**风险，不能消除。

```python
def check(self, sender, group):
    while self._hour_window and now - self._hour_window[0] > 3600:
        self._hour_window.popleft()
    if len(self._hour_window) >= config.MAX_REPLIES_PER_HOUR:
        return False, f"已达每小时上限 {config.MAX_REPLIES_PER_HOUR} 条"
    if now - self._sender_last.get(sender, 0) < config.PER_SENDER_COOLDOWN:
        return False, f"对 {sender} 冷却中"
    if now - self._group_last.get(group, 0) < config.PER_GROUP_COOLDOWN:
        return False, f"群 {group} 冷却中"
    return True, ""
```

- **每小时上限**：滑动窗口计数；
- **同人冷却 / 同群冷却**：避免短时间对同一人、同一群连续回复；
- **随机延迟**：`random.uniform(*config.REPLY_DELAY_RANGE)`，不在收到消息的同一秒回复；
- **连续发送失败保护**：连续失败到阈值进入冷静期，期间只收不发，不在微信异常时反复操作。

注意 `check` 和 `commit` 是分开的：只有**真正发送成功**才记入冷却和计数，失败的尝试不占额度。

## 六、踩过的坑汇总

1. **内容指纹去重误杀**：最初在 id 去重之外又叠了一层"内容指纹去重"，结果用户故意连发两条"在吗"，第二条被吞了。后来改为：适配层已经按序列对齐分配稳定 id 时，关掉指纹去重。
2. **去重有效期不能永久**：否则同一个人今天说"在吗"、明天再说"在吗"，第二次永远收不到回复。
3. **@ 功能放弃了**：微信的 @ 需要从候选列表里挑人，无法在发送前确认挑对了，干脆改成在正文里带称呼。
4. **昵称不稳定**：多条消息同一瞬间到达时，只有最后一条能拿到发送者昵称，其余只能显示"群成员"。依赖严格白名单的场景要提前评估。
5. **微信会静默自动升级**：这是故障复发的头号原因，升级到 4.1.13+ 就彻底读不到。部署时必须堵掉自动更新，启动时也会打印当前微信版本用于排查。
6. **剪贴板被覆盖**：中文用剪贴板粘贴发送，会覆盖系统剪贴板，挂机的机器上要知道这一点。

## 七、小结

这个项目最大的体会是：**UI 自动化的难点不在"能不能读到"，而在"读错了怎么办"。** 判不出是谁发的就不回、会话对不上就不发、发了要回读确认、AI 不知道的事不让它答——每一处都选择保守，代价是偶尔漏回，换来的是不发错、不刷屏、不胡说。

再次提醒：个人微信自动化有封号风险，仅供学习交流，请用小号测试。


---

完整源码开源在 GitHub https://github.com/MsNan/wechat-group-bot

顺带一提，作者之前还开源了一个 uni-app 商城项目，有兴趣可以看看：https://github.com/MsNan/taohaowu-shop
