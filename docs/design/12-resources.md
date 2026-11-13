# P2-5 资源与工作量核心设计

## 1. 结论

资源与工作量以纯函数模块 `js/resources.js` 实现，全局对象为 `Resources`。模块按负责人和日期汇总任务占用，支持按日、按周两种粒度，按任务工期均摊工时，并输出容量冲突和整体统计。所有函数只读取入参，不读写 `localStorage`，不修改传入的任务数组、任务对象和配置对象。本阶段只交付纯函数、测试和本文档，不接入任何 UI。

## 2. 范围

本阶段包含：

- 按负责人和日期汇总任务工时。
- 日粒度和周粒度分桶。
- 默认容量与按负责人覆盖容量。
- 按工期均摊 `estimatedHours`，缺省时按每天 8 小时计算。
- 超容量冲突检测。
- 人数、总工时、超载人数、超载天数的汇总统计。

本阶段不包含：

- GridPane、TimelinePane 的资源视图渲染。
- 资源列表维护、人员排班和资源日历。
- 任务的拖拽分配和自动排期。
- 冲突的持久化、通知和消解流程。
- 工作日历、节假日和加班规则。

## 3. 数据口径

模块只消费任务上的以下字段。

| 字段 | 类型 | 说明 |
|------|------|------|
| `assignee` | string | 负责人，空字符串或纯空白视为未分配 |
| `startDate` | string \| null | `YYYY-MM-DD`，包含在工期内 |
| `endDate` | string \| null | `YYYY-MM-DD`，包含在工期内 |
| `estimatedHours` | number | 可选，任务总估算工时 |

处理规则：

- 调用方传入的任务数组是唯一数据来源，模块不遍历任务树，也不依赖 `TaskManager`。
- 传入叶子任务时汇总的是执行工作量，传入父任务时该父任务按单个任务处理，两种情况都只遵循入参。
- 负责人字符串先去除首尾空白，去空白后为空则整条任务被忽略。
- `startDate` 或 `endDate` 缺失、格式非法、日期不存在，或结束早于开始时，整条任务被忽略。
- 任务数组为空、非数组、包含 `null` 项时都安全返回空结果。
- 日期按 UTC 解析，避免本地时区和夏令时误差。

## 4. 工时均摊

任务的总工时按工期天数平均分配到每一天。

```text
dailyHours = totalHours / durationDays
durationDays = endDate - startDate + 1
```

总工时的取值顺序：

1. `estimatedHours` 为有限且不小于 0 的数字时，直接作为任务总工时。
2. 其他情况，包括缺失、负数、字符串、`NaN`，按 `hoursPerDay × durationDays` 计算，`hoursPerDay` 默认 `8`。

说明：

- `estimatedHours` 表示整个任务的总工时。任务跨 3 天、`estimatedHours = 12` 时，每天 4 小时。
- `estimatedHours = 0` 表示任务不占资源，负责人仍会出现在结果中，但不产生任何日期占用。
- 未填写 `estimatedHours` 时，默认每个自然日 8 小时。任务跨 3 天即总工时 24 小时。
- 工期按自然日计算，周末和节假日同样参与均摊。工作日口径由后续资源日历接入处理。
- 所有输出数值统一保留 6 位小数，降低浮点累计误差。

## 5. 粒度与分桶

`buildWorkload(tasks, options)` 的 `options.granularity` 支持两个值：

| 值 | 含义 | 日期键 |
|----|------|--------|
| `day` | 按天汇总，默认值 | `YYYY-MM-DD` |
| `week` | 按周汇总 | 该周周一的 `YYYY-MM-DD` |

周粒度的规则：

- 以周一为一周起点，周日结束。
- 日期键使用周一的日期，便于字符串排序和跨年展示。
- 采用周一日期而不采用 ISO 周号，避免跨年周号归属的歧义。
- 工时仍按天均摊后再累加到周，周合计等于该周内每日占用之和。

## 6. 容量

容量表示每人每天的可用工时。

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `options.capacity` | `8` | 所有负责人的每日容量 |
| `options.capacityByAssignee` | 无 | 按负责人覆盖每日容量 |
| `options.hoursPerDay` | `8` | 任务未填工时时的每日工时 |

规则：

- `capacity` 只接受有限数字。负数、字符串、`NaN` 回退为默认值 `8`。
- `capacity = 0` 是合法配置，表示该负责人没有可用容量，任何占用都会形成冲突。
- `capacityByAssignee` 的键为负责人名称，值为该负责人的每日容量。值非法时回退到 `options.capacity`。
- 周粒度的容量为 `capacityPerDay × 7`，与自然日均摊口径保持一致。
- 每个负责人的实际每日容量写入结果的 `capacityPerDay` 字段。

## 7. 输出结构

```js
workload = {
  granularity: 'day' | 'week',
  byAssignee: {
    [assignee]: {
      assignee: string,
      capacityPerDay: number,
      dates: { [dateKey]: number },
      totalHours: number
    }
  },
  byDate: {
    [dateKey]: {
      date: string,
      totalHours: number,
      byAssignee: { [assignee]: number }
    }
  },
  conflicts: Conflict[]
}

Conflict = {
  assignee: string,
  date: string,
  hours: number,
  capacity: number,
  overtime: number
}
```

约定：

- `byAssignee` 的负责人键按名称升序插入，`dates` 和 `byDate` 的日期键按字符串升序插入，输出顺序稳定。
- `byAssignee[name].dates[date]` 与 `byDate[date].byAssignee[name]` 表示同一份数据，便于按人查和按日查。
- `byDate[date].totalHours` 是当天或当周所有负责人的工时合计。
- `byAssignee[name].totalHours` 是该负责人整个区间的工时合计。
- 每个负责人使用独立对象和独立 `dates` 对象，调用方修改返回值不会影响其他调用结果。

## 8. 冲突定义

冲突的判定条件：

```text
hours > capacity
```

- 只有严格超出容量才算冲突，等于容量不构成冲突。
- 日粒度下容量为每日容量，周粒度下容量为每日容量乘以 7。
- 冲突记录中的 `date` 为当前粒度的日期键，周粒度为周一日期。
- `overtime` 为超出量，等于 `hours - capacity`。
- 冲突按负责人名称和日期键升序排列。

`findConflicts(workload, capacity)` 的行为：

- 从 `workload.byAssignee` 逐人逐日期读取工时。
- 省略 `capacity` 时使用每个负责人自身的 `capacityPerDay`，可以正确处理个人容量差异。
- 传入数字 `capacity` 时，对所有负责人使用同一套每日容量，用于全局容量调整或模拟。
- 非数字容量按省略处理。
- 输入为空或结构缺失时返回空数组。

## 9. 汇总统计

`summarize(workload)` 返回四个指标。

| 字段 | 含义 |
|------|------|
| `totalAssignees` | `byAssignee` 中的负责人数量 |
| `totalHours` | 所有负责人 `totalHours` 之和 |
| `overloadedAssignees` | 至少存在一条冲突的负责人数量 |
| `overloadedDates` | 至少存在一条冲突的日期数量 |

规则：

- `overloadedAssignees` 和 `overloadedDates` 按去重计数，同一人同一天只计一次。
- `workload.conflicts` 缺失时，内部调用 `findConflicts(workload)` 重新计算。
- 输入为空或结构缺失时返回全部为 0 的对象。

## 10. 与资源和分配模型的关系

本模块是只读投影，不负责创建、修改或保存资源与分配数据。

- 任务上的 `assignee` 是当前唯一的分配来源，模块不引入新的分配表。
- 后续若增加独立的资源与分配模型，分配结果应先落到任务字段或分配数组，再作为本模块的输入。
- `capacity` 和 `capacityByAssignee` 来自资源配置或设置项，由调用方传入，模块不读取全局配置。
- `estimatedHours` 的任务总工时口径与分配模型一致。分配模型负责确定由谁完成多少工时，本模块负责按日期展开并检查容量。
- 资源视图、冲突列表和统计卡片都消费同一份 `workload`，避免多处重复计算。

## 11. 与 Grid 的接入点

本阶段不修改 `js/grid-pane.js`。后续接入方式：

```js
var workload = Resources.buildWorkload(TaskManager.getAllTasks(), {
  granularity: 'day',
  capacity: settings.resourceCapacity || 8,
  capacityByAssignee: settings.resourceCapacityByAssignee || {},
  hoursPerDay: 8
});
var summary = Resources.summarize(workload);
GridPane.render(rows, { workload: workload, resourceSummary: summary });
```

- 负责人列可以显示该负责人的 `workload.byAssignee[name].totalHours`。
- 追加资源视图列时，按当前可见日期读取 `byAssignee[name].dates[date]`，无占用显示为空。
- 超载负责人或超载日期使用 `workload.conflicts` 高亮，单元格可显示 `overtime`。
- 任务增删改后重新调用 `buildWorkload`，不要缓存跨渲染周期的结果。

## 12. 与 Timeline 的接入点

本阶段不修改 `js/timeline-pane.js`。后续接入方式：

```js
TimelinePane.render(rows, { workload: workload });
```

- 资源视图按负责人增加行，每行按日期显示占用热力块。
- 单元格颜色由 `hours` 与 `capacity` 的比值决定，冲突日期使用告警色。
- 周粒度下，时间轴按周列渲染，读取 `byDate[weekStart]`。
- 任务条拖拽调整日期后，工期和均摊结果变化，必须重新调用 `buildWorkload`。
- 切换日粒度和周粒度时重新分桶，不修改原始任务数据。

## 13. 纯函数约束

- 不读取或写入 `localStorage`。
- 不修改传入的任务数组、任务对象和配置对象。
- 不缓存跨调用状态，每次调用独立计算。
- 不依赖 DOM、`TaskManager`、`WorkCalendar` 或其他全局对象。
- 内部 `Map` 和临时集合只在调用期间存在。
- 输出中的对象和数组全部为新建对象，调用方修改不会污染后续调用。

## 14. 测试

测试文件为 `tests/resources.test.js`，通过 `node tests/resources.test.js` 运行，覆盖：

- 单负责人和多负责人的按日汇总。
- 同日多负责人合计与 `byDate` 和 `byAssignee` 的一致性。
- 跨天、跨周、跨月、跨年。
- 默认每日 8 小时、自定义 `hoursPerDay`、`estimatedHours` 均摊和非法估算值回退。
- 全局容量、个人容量覆盖、容量为 0、非法容量回退。
- 日粒度和周粒度的超载检测、周容量计算和冲突字段。
- `findConflicts` 的容量覆盖和非法输入。
- 空任务、无负责人、非法日期、倒置区间、非数组输入。
- `summarize` 的四项统计、空输入和缺失冲突时的重算。
- 纯函数不修改入参，多次调用结果相互独立。

## 15. 未覆盖项

- 浏览器中的实际渲染、交互和样式。
- 工作日历、节假日和加班对容量与均摊的影响。
- 跨时区、半天粒度和非 8 小时工作制。
- 资源分配、任务拆分和自动排期。
- 大规模任务量下的性能与增量更新。
- 冲突的持久化、通知和消解流程。
