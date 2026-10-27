---
title: "微信自己升了一次级，群机器人就再也读不到消息：用 WM_GETOBJECT 一步分清「找不到窗口」和「窗口里没有控件树」"
date: 2026-10-27
category: 后端
tags: [Python, Windows, UI Automation, 排查]
description: "微信静默升级后 UI 自动化读不到任何控件：用 WM_GETOBJECT 区分找不到窗口与无无障碍接口，异常分档、版本号别比字符串，堵自动更新只改名不够。"
---

> 先说明：这篇讲的是 Windows UI Automation 的排查方法。个人微信的第三方自动化有封号风险，我自己的项目也只建议用小号做实验。

我写过一个微信群自动回复的小程序，原理是 Windows 的 UI Automation（无障碍接口）：只"看"界面上的控件、模拟键盘输入，不注入进程。之前写过它怎么读消息、怎么判断谁发的，这篇记一次让我白忙了一整轮的故障。

## 事情经过

9 月 4 日，我在一台 Windows 11 虚拟机上装好微信 4.1.8.107，机器人跑得好好的。过了几天再看，整条链路都失效了：连不上微信，什么都读不到。

我当时的排查顺序，基本是按"最常见的原因"来的，结果三个方向全错：

| 我的假设 | 实际验证 |
|---|---|
| 微信改版，主窗口类名变了 | **不是**。新旧两个版本主窗口类名完全一样，都是 `Qt51514QWindowIcon` |
| 微信没登录 / 主窗口被关了 | **不是**。截图确认是登录状态，会话列表、目标群都正常显示 |
| 微信刚启动，控件还没准备好 | **不是**。等窗口完全就绪后重试，一样失败 |

最后才发现：**微信自己静默升级到了 4.1.13.12**。

## 关键的一步：问窗口"你有没有无障碍接口"

UI Automation 能读到控件，前提是程序自己实现了无障碍接口。Windows 的做法是给窗口发一条 `WM_GETOBJECT`（0x003D）消息，窗口如果有无障碍提供者，会返回一个非 0 的值；返回 0 就是没有。

用 Python 的 ctypes 就能发：

```python
import ctypes
u32 = ctypes.windll.user32
OBJID_CLIENT = 0xFFFFFFFC
r = u32.SendMessageW(hwnd, 0x003D, 0, ctypes.c_long(OBJID_CLIENT).value)
print(r)   # 0 = 没有无障碍接口
```

同一台机器上的 A/B 对照（2026-09-07 的记录）：

```
微信 4.1.13.12
  主窗口 ClassName = 'Qt51514QWindowIcon'（两个同名顶层窗口，同一 pid）
  SendMessageW(hwnd, WM_GETOBJECT, 0, OBJID_CLIENT)
      hwnd=197498 -> 0
      hwnd=197526 -> 0
  UIA 树：WindowControl(Name='微信') -> PaneControl(Name='Weixin') -> 到底，零子控件

微信 4.1.8.107
  主窗口 ClassName = 'Qt51514QWindowIcon'（同一个类名！）
  SendMessageW(hwnd, WM_GETOBJECT, 0, OBJID_CLIENT)
      hwnd=328140 -> 49275
  UIA 树：
      WindowControl(Name='微信')
        └ GroupControl(Class='QWidget')
            ├ CustomControl(Class='QStackedWidget')
            │   └ GroupControl(Class='mmui::MainView')
            ├ ToolBarControl(Class='mmui::TitleBar')
            ...
```

新版本窗口还在、类名也对，但控件树到 `PaneControl` 就到底了，会话列表、消息列表一个都拿不到。这种情况下**换任何基于 UI Automation 的库都没用**，在代码上折腾全是白费，只能换微信版本。

一个小细节：`OBJID_CLIENT` 是 -4，作为 32 位值写成 `0xFFFFFFFC`。Windows 上 `c_long` 是 32 位，`ctypes.c_long(0xFFFFFFFC).value` 得到 -4。我在 Linux 上验算的时候发现 `c_long` 是 64 位，结果变成了 4294967292：

```
>>> ctypes.c_long(0xFFFFFFFC).value, ctypes.sizeof(ctypes.c_long)
(4294967292, 8)        # Linux x86_64
>>> ctypes.c_int32(0xFFFFFFFC).value
-4
```

代码只在 Windows 上跑，所以项目里的写法没问题；但如果想写得不依赖平台，用 `c_int32` 更明确。

## 把"找不到"和"读不到"拆成两种异常

这次之后，我把连接时的判断改成两步，并抛两种不同的异常：

```python
def find_main_window(check_accessibility=True):
    ...
    if best is None:
        raise WeChatNotRunning(
            "没有找到微信主窗口。请确认：微信在运行、已登录、窗口没有最小化到托盘。")

    if check_accessibility:
        ...
        if hwnd:
            code = _has_accessibility(hwnd)
            if code == 0:
                raise AccessibilityUnavailable(
                    "微信窗口没有实现无障碍接口（WM_GETOBJECT 返回 0）。"
                    "实测微信 4.1.13 及以上是这种情况，界面自动化完全读不到内容，"
                    "只能改用受支持的微信版本。")
    return best
```

两者的出路完全不同：

- `WeChatNotRunning`：可能是微信还没起来、没登录、缩到托盘了，**可以等**；
- `AccessibilityUnavailable`：版本不对，**等多久、重启多少次都没用**。

找主窗口这一步也是踩过坑的：同一台机器上见过 `mmui::MainWindow` 和 `Qt51514QWindowIcon` 两种类名，所以按"类名命中其一 + 标题是『微信』+ 宽高够大（排除登录窗、托盘小窗）"来找，多个候选取面积最大的。

异常整体分了三档，调用方按档决定是退避、重试还是放弃，而不是像最早那样所有失败都当成同一种、每 1.5 秒重试一次：

| 档 | 异常 | 处理 |
|---|---|---|
| 环境级 | `WeChatNotRunning`、`WeChatNotLoggedIn`、`AccessibilityUnavailable` | 重试无意义，等外部条件恢复，明确告警 |
| 会话级 | `ChatNotFound`、`ChatSwitchFailed` | 可以重试或切换 |
| 操作级 | `ReadFailed`、`SendFailed`（含 `TargetMismatch`） | 通常可重试；会话对不上就放弃发送 |

## 启动时先报版本，而不是等连不上再猜

光有异常还不够，最好在启动时就把微信版本读出来，和"实测可用的上限"比一下，超了就直接打出来。

读版本这块也有一个被我自己记错的地方。最早我记的是"4.1.13 把注册表里的 InstallPath 挪走了，键都不存在"，后来在 4.1.13.12 上复测，`HKCU\Software\Tencent\Weixin` 其实是存在的（`InstallPath='C:\Program Files\Tencent\Weixin'`）。但卸载重装后这个键会短暂缺失，所以仍然不能只靠它。最后按三条路依次找：

1. 卸载信息表（`...\CurrentVersion\Uninstall` 下 `DisplayName` 是 微信 / WeChat / Weixin 的项），读 `DisplayVersion` 或安装目录里 exe 的文件版本；
2. 老的 `Tencent\WeChat`、`Tencent\Weixin` 注册表键里的 `InstallPath`（3.9.x 的安装目录下还有 `[3.9.12.17]` 这样的版本号文件夹）；
3. 固定安装目录兜底。

exe 的文件版本用 ctypes 调 `GetFileVersionInfoW` / `VerQueryValueW` 读 `VS_FIXEDFILEINFO`，不用装 pywin32：

```python
d = ctypes.string_at(r.value, ln.value)
ms = int.from_bytes(d[8:12], "little")   # dwFileVersionMS
ls = int.from_bytes(d[12:16], "little")  # dwFileVersionLS
return f"{ms >> 16}.{ms & 0xFFFF}.{ls >> 16}.{ls & 0xFFFF}"
```

然后是比较。版本号千万别直接比字符串，我在 Python 3.13 上跑了一下：

```python
def _ver_tuple(v):
    try:
        return tuple(int(x) for x in str(v).split(".")[:4])
    except Exception:
        return ()

C = (4, 1, 8, 107)
for v in ['4.1.13.12', '4.1.8.107', '3.9.12.17', '4.1.10.0']:
    print(v, 'str>', v > '4.1.8.107', 'tuple>', _ver_tuple(v) > C)
```

```
4.1.13.12 str> False tuple> True
4.1.8.107 str> False tuple> False
3.9.12.17 str> False tuple> False
4.1.10.0 str> False tuple> True
```

字符串比较是逐字符的，`'1'` 小于 `'8'`，所以 `'4.1.13.12' > '4.1.8.107'` 是 False——恰好把这次出事的版本判成"不高于上限"。转成整数元组再比才对。

还有一个要知道的边界：`_ver_tuple` 解析失败会返回 `()`，而 `() > (4, 1, 8, 107)` 是 False，也就是"读不懂的版本号会被当成不超上限"。项目里在比较之前会先过滤掉不是数字开头的候选值，读不到版本时单独打一条"没读出版本，请手动核对"的 warning，不会静默放过。

启动日志里超上限时会这样写：

```python
if _ver_tuple(wv) > SUPPORTED_CEILING:
    log.warning(f"微信 {wv} 高于适配上限 {top}")
    log.warning("这个版本没有无障碍接口，连接时会直接报 AccessibilityUnavailable。")
    log.warning(f"出路：把微信降回 {top}，并【关掉自动更新】——")
```

## 堵自动更新：只改名是不够的

降回 4.1.8.107 只是第一步，不堵住更新，过几天又会被升上去。顺便说一下另外两条路：3.9.12.17 能装上，但登录时被服务端以"版本过低"拒绝，客户端这边没有办法。

更新器在带版本号的子目录里：

```
C:\Program Files\Tencent\Weixin\<版本号>\WeixinUpdate.exe
```

只改名是不够的：升级时微信会在新的版本子目录里重新生成一个，等于没堵。最后有效的做法是三层：

1. `WeixinUpdate.exe` 改名为 `WeixinUpdate.exe.bak`（保留，方便还原）；
2. **在原路径创建一个同名的"目录"**。同一个目录下文件和目录不能同名，占位之后这个文件就写不回来了；
3. 再加一条防火墙出站拦截规则。

这里又有一个 PowerShell 的坑：这个路径里带方括号，而 `-Path` 参数会把 `[ ]` 当通配符解析。所以创建目录和验证都直接用 .NET 方法：

```powershell
[System.IO.Directory]::CreateDirectory($upd)

# 验收：试着把文件写回去，必须被拒绝
try   { [System.IO.File]::WriteAllBytes($upd, [byte[]](1,2,3)); "!! 占位没生效" }
catch { "写回被拒绝【符合预期】" }
```

设置完一定要做"写回去"这一步验收，不能设置完就当成功。还有时机：**装完微信、第一次启动之前就要堵**。上一次就是装完先启动了一下，又被它自己升掉了。

## 回头看

这次最大的教训是排查顺序。"连不上"有两种完全不同的原因：

- 找不到窗口：检查窗口是否可见、是否登录、是不是锁屏；
- 窗口在，但里面没有控件树：只能换版本。

先发一条 `WM_GETOBJECT` 就能分清是哪一种，比我按"类名变了 → 没登录 → 启动竞态"一个个去试快得多。现在这一步放在连接逻辑里自动做，错误信息里直接写明"这是版本问题"，部署的人不用再猜。

完整的排查记录在仓库 docs 目录的《版本锁定与运行成本》里：

https://github.com/MsNan/wechat-group-bot
