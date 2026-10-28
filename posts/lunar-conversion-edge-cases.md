---
title: "农历转换的 4 个边界：2 月 30 日能转出\"正月十四\"、小月没有三十、闰月、立春到春节之间的干支"
date: 2026-10-28
category: 前端
tags: [JavaScript, 农历, 日期处理, MCP]
description: "lunar-javascript 不按月份天数校验公历日，2 月 30 日被当 3 月 2 日算；小月三十直接抛英文错；闰月每年不同；年干支按春节、月干支按节气。附修复与测试。"
---

# 农历转换的 4 个边界：2 月 30 日能转出"正月十四"、小月没有三十、闰月、立春到春节之间的干支

我写过一个离线的 MCP 工具集，给 AI 编程助手用，里面有一对公历、农历互转的工具，底层用的是 `lunar-javascript`（仓库里锁的是 1.7.7）。这类需求在业务里不算少：生日按农历提醒、节日活动页、黄历类小程序。

接口本身很简单，传日期，返回农历、干支、生肖、节气。但边界情况比我写的时候想的多。这两天回头给它补边界测试，翻出一个真实的 bug，还有几个容易误解的输出。下面的输出都是我在 Node 20.19.2 上实际跑的。

## 先看代码

公历转农历：

```ts
export function solarToLunar(date: string) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim())
  if (!m) throw new Error('日期格式应为 YYYY-MM-DD')
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  if (y < 1900 || y > 2100) throw new Error('支持 1900–2100 年')
  const s = Solar.fromYmd(y, mo, d)
  if (s.getMonth() !== mo || s.getDay() !== d) throw new Error('无效日期')
  return describe(s.getLunar())
}
```

农历转公历：

```ts
export function lunarToSolar(year: number, month: number, day: number, isLeapMonth = false) {
  if (year < 1900 || year > 2100) throw new Error('支持 1900–2100 年')
  if (isLeapMonth) {
    const leap = (lunarPkg as any).LunarYear.fromYear(year).getLeapMonth()
    if (leap !== month) throw new Error(leap ? `${year} 年闰月为闰${leap}月` : `${year} 年没有闰月`)
  }
  const l = Lunar.fromYmd(year, isLeapMonth ? -month : month, day)
  if (l.getDay() !== day) throw new Error('该农历日期不存在（小月没有三十）')
  return describe(l)
}
```

两个函数各有一行"构造完再比较一下"的校验。写的时候我的假设是：传了不存在的日期，库会像 JS 的 `Date` 一样自动进位，比较一下就能发现。这个假设两边都错了，而且错的方向相反。

## 边界一：2026 年 2 月 30 日，能转出"正月十四"

```js
solarToLunar('2026-02-30')
// { solar: '2026-02-30', weekday: '周一', lunar: { ..., text: '二〇二六年正月十四' }, ... }
```

没报错，还返回了一个看起来很正常的结果。`2026-02-29`、`2026-02-31`、`2026-04-31` 也一样，分别是正月十三、正月十五、三月十五。

直接测库：

```js
const s = Solar.fromYmd(2026, 2, 30)
s.toYmd()          // '2026-02-30'
s.getMonth()       // 2
s.getDay()         // 30
s.getLunar().toString()                         // '二〇二六年正月十四'
Solar.fromJulianDay(s.getJulianDay()).toYmd()   // '2026-03-02'
```

`lunar-javascript` 对公历日只检查了是否在 1–31 之间（`2026-02-00` 报 `wrong day 0`，`2026-01-32` 报 `wrong day 32`），并不按月份天数判断。它也不进位：对象里原样存着 2 月 30 日，但换算儒略日的时候按 3 月 2 日算。所以农历和星期都是 3 月 2 日的（`2026-03-02` 确实是周一、正月十四），而 `solar` 字段还写着 `2026-02-30`。

我那行 `s.getMonth() !== mo || s.getDay() !== d` 比较的是对象里存的字段，永远相等，等于没校验。

顺带一提，JS 自己的 `Date` 在这里也不可靠：

```js
new Date(2026, 1, 30)        // 2026-03-02，构造函数本来就会进位
new Date('2026-02-30')       // Node 20 里也是 Mar 02 2026，没有 Invalid Date
new Date('2026-02-32')       // Invalid Date
```

字符串解析在 V8 里对日也只卡到 31。所以"用 Date 解析一下看是不是 Invalid Date"这种校验，挡不住 2 月 30 日。

正确的做法是按月份天数自己判断。`lunar-javascript` 里就有现成的工具函数：

```js
SolarUtil.getDaysOfMonth(2026, 2)   // 28
SolarUtil.getDaysOfMonth(2024, 2)   // 29
SolarUtil.getDaysOfMonth(1900, 2)   // 28（1900 不是闰年）
SolarUtil.getDaysOfMonth(2000, 2)   // 29
```

不想依赖库的话，用 `Date.UTC` 构造再把年月日读回来比较也行，关键是比较"构造之后的结果"而不是"传进去的值"：

```js
const isValidYmd = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
```

## 边界二：小月没有三十，但我的中文提示从来没出现过

农历月只有 29 天（小月）或 30 天（大月）。2026 年农历十二个月的天数，我用 `LunarYear` 打出来是：

```
正月 30, 二月 29, 三月 30, 四月 29, 五月 29, 六月 30,
七月 29, 八月 29, 九月 30, 十月 30, 冬月 30, 腊月 29
```

所以"农历 2026 年腊月三十"不存在。我原本以为库会进位到下个月初一，于是写了 `l.getDay() !== day` 的判断。实际上库直接抛错：

```js
lunarToSolar(2026, 12, 30)
// Error: only 29 days in lunar year 2026 month 12
lunarToSolar(2025, 6, 30, true)
// Error: only 29 days in lunar year 2025 month -6
```

功能上没问题，日期确实被拒了，但通过 MCP 返回给用户的是一句英文，`month -6` 还是库内部"负数表示闰月"的写法。我写的"小月没有三十"那行，是一段永远走不到的代码。

和公历那边正好相反：公历不该过的过了，农历是报了错，但报错不是我以为的那条。两处都是"没验证过库的行为就写了兜底"。

改法是先查当月天数：

```js
const days = LunarMonth.fromYm(year, isLeapMonth ? -month : month).getDayCount()
if (day > days) throw new Error(`农历 ${year} 年${isLeapMonth ? '闰' : ''}${month}月只有 ${days} 天`)
```

改完之后：

```
lunarToSolar(2026, 12, 30)        → 农历 2026 年12月只有 29 天
lunarToSolar(2025, 6, 30, true)   → 农历 2025 年闰6月只有 29 天
lunarToSolar(2025, 6, 29, true)   → 2025-08-22（闰六月廿九）
lunarToSolar(2026, 1, 30)         → 2026-03-18（正月三十）
```

腊月只有 29 天还有一个直接的后果：2025 年农历腊月也是 29 天，所以 2026 年的除夕是腊月廿九（公历 2026-02-16），这一年没有"年三十"。如果你的活动页写死了"腊月三十 = 除夕"，这年就对不上。转换结果里的 `festivals` 字段给的是 `["除夕"]`，按节日名判断比按日期判断稳。

## 边界三：闰月要单独传，而且每年不一样

农历闰月在库里用负数月份表示，`Lunar.fromYmd(2025, -6, 1)` 是闰六月初一。对外接口里我拆成了 `month` + `isLeapMonth`，返回值里也用 `isLeapMonth` 标出来，不让调用方接触负数。

同一个月份数字，闰和不闰差了一个月：

```
lunarToSolar(2025, 6, 1)          → 2025-06-25（六月初一）
lunarToSolar(2025, 6, 1, true)    → 2025-07-25（闰六月初一）
```

近几年的闰月（`LunarYear.fromYear(y).getLeapMonth()`，0 表示没有）：

```
2023: 2   2024: 0   2025: 6   2026: 0   2027: 0   2028: 5
```

`isLeapMonth` 传错的时候要明确报错，不能悄悄当成普通月处理。直接问库要 2026 年闰三月，它的报错是 `wrong lunar year 2026 month -3`；所以函数里提前查了闰月，给出"2026 年没有闰月"或"2025 年闰月为闰6月"这样能看懂的提示。这一段是原来就有、确实生效的。

做"每年农历生日提醒"时还有一个产品问题：有人生日是闰六月，大多数年份没有闰六月。一般做法是没有闰月的年份按同数字的普通月提醒，但这属于业务约定，库不会替你决定，最好在需求里写清楚。

## 边界四：立春到春节之间，年和月的干支"不同步"

这个不是 bug，但第一次看输出很容易以为错了。2026 年立春是 2 月 4 日（库给的时刻是 `2026-02-04 04:02:08`），春节是 2 月 17 日。看这几天的输出：

```
2026-02-03  ganzhi: 乙巳年 己丑月 戊申日   zodiac: 蛇
2026-02-04  ganzhi: 乙巳年 庚寅月 己酉日   zodiac: 蛇   jieqi: 立春
2026-02-16  ganzhi: 乙巳年 庚寅月 辛酉日   zodiac: 蛇   festivals: 除夕
2026-02-17  ganzhi: 丙午年 庚寅月 壬戌日   zodiac: 马   festivals: 春节
```

月干支在立春这天就从己丑变成了庚寅（干支纪月以节气为界），年干支和生肖却要到春节才从乙巳、蛇变成丙午、马。2 月 4 日到 16 日这十三天，就是"乙巳年庚寅月"。

原因是 `getYearInGanZhi()` 和 `getYearShengXiao()` 默认以正月初一为界。库也提供了以立春为界的版本，2026-02-10 这天对比：

```js
l.getYearInGanZhi()          // '乙巳'
l.getYearInGanZhiByLiChun()  // '丙午'
l.getYearShengXiao()         // '蛇'
l.getYearShengXiaoByLiChun() // '马'
```

日常说"属什么"一般按春节，命理排八字一般按立春，哪个"对"取决于用途。我的工具用的是库的默认（按春节），工具说明里还没写这一点，这次一起记进了待办；如果你做的是排盘类功能，就要换成 `ByLiChun` 的方法。

## 准备补的测试

原来的农历测试覆盖了 4 种情况：2026 春节那天是正月初一、属马，2026 中秋是 9 月 25 日，2027 春节是 2 月 6 日，2026 年闰三月要报错。这次的思路是每一个"我以为库会怎样"的地方都写一条断言：

```js
assert.throws(() => solarToLunar('2026-02-29'), /无效日期/)
assert.throws(() => solarToLunar('2026-04-31'), /无效日期/)
assert.equal(solarToLunar('2024-02-29').lunar.text, '二〇二四年正月二十')
assert.throws(() => lunarToSolar(2026, 12, 30), /只有 29 天/)
assert.equal(lunarToSolar(2025, 6, 29, true).solar, '2025-08-22')
assert.equal(solarToLunar('2026-02-16').festivals[0], '除夕')
```

改动在本地验证过：加上这条新测试，修改后的代码跑 `node --test` 是 12 条全部通过，原有的 11 条一条没坏。写这篇时修改还没有合进仓库，仓库里目前还是上面"先看代码"那一版。

## 小结

- `lunar-javascript` 的 `Solar.fromYmd` 不按月份天数校验，2 月 30 日会被当成 3 月 2 日计算，但 `solar` 字段还是 2 月 30 日。用 `SolarUtil.getDaysOfMonth` 先校验。
- JS 的 `Date` 构造函数会进位，Node 里 `new Date('2026-02-30')` 也不是 Invalid Date，都不能拿来校验日期。
- 农历日不存在时库会直接抛英文错误，想要中文提示就先用 `LunarMonth.fromYm(...).getDayCount()` 查天数。
- 闰月每年不同，`isLeapMonth` 传错要显式报错；2026 年腊月只有 29 天，除夕是廿九。
- 年干支、生肖默认按春节，月干支按节气，立春到春节之间两者不同步是正常的。

写兜底代码之前，先把库在边界上的真实行为跑一遍。这次两个"以为"，一个让错误日期蒙混过关，一个让我的报错提示成了死代码。

仓库：https://github.com/MsNan/cn-dev-mcp
