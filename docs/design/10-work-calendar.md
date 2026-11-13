# P2-1 工作日历核心设计

## 1. 结论

工作日历以纯函数模块 `js/work-calendar.js` 实现，全局对象为 `WorkCalendar`。模块只处理日期与配置，不读写 `localStorage`，不修改传入的配置对象，不依赖 DOM、`TaskManager` 或 `Progress`。本阶段只交付纯函数、测试和本文档，不接入任何 UI。

## 2. 范围

本阶段包含：

- 工作日配置的标准化与默认值。
- 单日工作日判断。
- 区间内工作日计数。
- 按工作日加减日期。
- 将非工作日调整为最近工作日。
- 供进度汇总使用的工作日权重。

本阶段不包含：

- GridPane、TimelinePane、CalendarView 的渲染改造。
- 节假日数据的导入、维护界面和持久化。
- 关键路径、资源日历和多套日历切换。
- 工期计算的 UI 展示与拖拽联动。

## 3. 配置结构

```js
config = {
  weekends: number[],   // 星期编号，0 为周日，6 为周六
  holidays: string[],   // YYYY-MM-DD 法定节假日
  workdays: string[]    // YYYY-MM-DD 调休补班日
}
```

`createConfig(options)` 接收可选对象并返回规范化后的新对象。字段全部可省略：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `weekends` | `[0, 6]` | 周六、周日为非工作日 |
| `holidays` | `[]` | 无节假日 |
| `workdays` | `[]` | 无调休补班日 |

规范化规则：

- `weekends` 只保留 0 到 6 之间的整数，去重后升序排列；传入非数组时回退为默认值。
- `holidays` 与 `workdays` 只保留合法 `YYYY-MM-DD`，统一格式、去重后升序排列。
- 传入数组或 Set 均可，输入对象本身不被修改。
- 每次调用 `createConfig` 都返回全新的数组，调用方修改返回值不会影响其他配置。

优先级从高到低为 `workdays`、`holidays`、`weekends`。补班日即使落在周末或节假日，也按工作日处理。

## 4. API

| 函数 | 签名 | 返回值 | 说明 |
|------|------|--------|------|
| `createConfig` | `createConfig(options)` | config | 生成规范化配置 |
| `isWorkingDay` | `isWorkingDay(dateStr, config)` | boolean | 单日是否工作日 |
| `workingDaysBetween` | `workingDaysBetween(startDate, endDate, config)` | number | 含首尾的工作日数量 |
| `addWorkingDays` | `addWorkingDays(dateStr, days, config)` | string \| null | 按工作日加减 |
| `adjustToWorkingDay` | `adjustToWorkingDay(dateStr, direction, config)` | string \| null | 找最近工作日 |
| `durationWeight` | `durationWeight(startDate, endDate, config)` | number | 工作日权重，至少 1 |

所有函数在 `config` 省略时使用默认配置。

## 5. 日期规则

- 日期字符串统一为 `YYYY-MM-DD`，使用 UTC 解析，避免本地时区和夏令时误差。
- 非法格式、不存在的日期（如 `2026-02-30`）按无效处理：判断函数返回 `false`，计数返回 `0`，加减和调整返回 `null`。
- 星期编号按 UTC 计算，`0` 为周日，`6` 为周六。
- 区间统计包含首尾两天。开始日期晚于结束日期时返回 `0`。
- 工作日计数只做日历运算，不产生跨天的舍入问题。

## 6. 工作日判断

`isWorkingDay(dateStr, config)` 的判断顺序：

1. 日期是否合法。
2. 是否在 `workdays` 中，是则返回 `true`。
3. 是否在 `holidays` 中，是则返回 `false`。
4. 星期编号是否在 `weekends` 中，是则返回 `false`。
5. 其余返回 `true`。

示例（默认配置）：

| 日期 | 星期 | 结果 |
|------|------|------|
| `2026-01-01` | 周四 | `true` |
| `2026-01-03` | 周六 | `false` |
| `2026-01-04` | 周日 | `false` |
| `2026-01-05` | 周一 | `true` |

## 7. 区间工作日计数

`workingDaysBetween(startDate, endDate, config)` 从开始日期逐日推进到结束日期，对每一天调用工作日判断并累加。

- 单日区间，若该日是工作日返回 `1`，否则返回 `0`。
- 跨周末时自动扣除周六和周日。
- 跨月、跨年按实际日期连续计算，月末和年末不做特殊处理。
- 闰年 2 月 29 日按正常工作日参与判断。

示例（默认配置）：

| 开始 | 结束 | 工作日 |
|------|------|--------|
| `2026-01-01` | `2026-01-05` | 3（周四、周五、周一） |
| `2026-01-01` | `2026-01-07` | 5 |
| `2025-12-29` | `2026-01-02` | 5 |
| `2028-02-01` | `2028-02-29` | 21（闰年） |

## 8. 按工作日加减

`addWorkingDays(dateStr, days, config)` 的行为：

- `days` 为正时向后推进，为负时向前推进，`0` 返回原日期。
- 起始日期本身不计入步数。从周一加 1 个工作日得到周二，从周一减 1 个工作日得到上周五。
- 起始日期是非工作日时，先向后或向前找到第一个工作日，再继续计数。
- 节假日和周末跳过，补班日计入工作日。
- `days` 非数字时按 `0` 处理；非法起始日期返回 `null`。
- 内部设置搜索上限，极端配置（例如全部日期都是节假日）下返回 `null`，不会死循环。

示例（默认配置）：

| 起始 | days | 结果 |
|------|------|------|
| `2026-01-05`（周一） | 1 | `2026-01-06` |
| `2026-01-02`（周五） | 1 | `2026-01-05` |
| `2026-01-03`（周六） | 1 | `2026-01-05` |
| `2026-01-05`（周一） | -1 | `2026-01-02` |
| `2026-01-01` | -1 | `2025-12-31` |
| `2026-01-30`（周五） | 1 | `2026-02-02` |

## 9. 调整到最近工作日

`adjustToWorkingDay(dateStr, direction, config)` 的行为：

- 日期已是工作日时原样返回。
- `direction` 为 `forward`、`next` 或其他未识别值时向后查找。
- `direction` 为 `backward`、`prev`、`previous`、`before` 或 `-1` 时向前查找。
- 查找包含节假日和周末，补班日视为工作日。
- 非法日期返回 `null`；在搜索上限内找不到工作日也返回 `null`。

示例（默认配置）：

| 日期 | direction | 结果 |
|------|-----------|------|
| `2026-01-03`（周六） | `forward` | `2026-01-05` |
| `2026-01-03`（周六） | `backward` | `2026-01-02` |
| `2026-01-05`（周一） | `forward` | `2026-01-05` |

## 10. 工作日权重

`durationWeight(startDate, endDate, config)` 返回区间内的工作日数量，并保证最小值为 `1`。

- 结果直接复用 `workingDaysBetween` 的计算口径。
- 日期非法、结束早于开始，或区间内没有工作日时返回 `1`。
- 该函数用于替换 `Progress.durationWeight` 的自然日口径，保持“权重至少为 1”的契约不变。

与 `Progress.durationWeight(task)` 的兼容关系：

- 两者签名不同，本模块接收两个日期字符串，`Progress` 接收任务对象。
- 对只包含工作日的区间，两者结果一致。
- 对包含周末的区间，本模块结果小于自然日天数，这是引入工作日历后的预期差异。
- 单日区间两者都返回 `1`。

## 11. 与 Progress 的接入点

本阶段不修改 `js/progress.js`。后续接入方式：

```js
function taskWeight(task, config) {
  return WorkCalendar.durationWeight(task.startDate, task.endDate, config);
}
```

- 调用方在构建 `Progress.rollupProgress` 的权重时注入该函数，或给 `progress.js` 增加可选的权重回调参数。
- 计算前先调用 `WorkCalendar.createConfig(settings.workCalendar)` 生成配置，同一次汇总内复用，避免重复规范化。
- 父任务日期派生仍来自 `TaskManager.getDateRange`，不改变汇总层级结构。
- 未配置工作日历时保持现有自然日权重，保证旧数据行为不变。

## 12. 与 Timeline 的接入点

后续时间轴接入方式：

- 任务条起止位置仍按自然日映射到像素，工作日历只影响工期和进度权重，不压缩时间轴比例。
- 拖拽任务条时，调用 `adjustToWorkingDay(date, 'forward', config)` 把落点吸附到最近工作日。
- 拖拽调整结束日期后，用 `durationWeight` 重新计算工期文本和进度汇总。
- 条形长度需要区分自然日跨度和工作日工期时，由渲染层分别读取两种数据，不修改本模块。
- 时间轴缩放、节假日高亮等展示能力不属于本阶段。

## 13. 纯函数约束

- 不读取或写入 `localStorage`。
- 不修改传入的 `config`、日期字符串或数组。
- 不缓存跨调用状态，每次调用独立计算。
- 不依赖 DOM、`TaskManager`、`Progress` 或其他全局对象。
- 所有内部查找集合在调用内构建，调用结束即释放。

## 14. 测试

测试文件为 `tests/work-calendar.test.js`，通过 `node tests/work-calendar.test.js` 运行，覆盖：

- 默认与自定义周末的工作日判断。
- 节假日、补班日及其优先级。
- 非法日期、开始晚于结束等边界。
- 跨周末、跨月、跨年、闰年的区间计数。
- `addWorkingDays` 正负方向、零步长、跨年和节假日跳过。
- `adjustToWorkingDay` 前后查找和已是工作日的情况。
- `durationWeight` 的最小值、节假日扣除和与 `Progress.durationWeight` 的一致性。
- `createConfig` 默认值和去重规范化。
- 所有函数调用前后配置对象保持不变。

## 15. 未覆盖项

- 浏览器中的实际渲染与拖拽吸附效果。
- 节假日数据的导入来源和维护界面。
- 多日历、资源日历和跨时区场景。
- 超长区间和极端节假日配置的性能。
- 与关键路径、自动排期的联动。
