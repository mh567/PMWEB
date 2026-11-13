# P1-3 基线与差异设计

## 1. 结论

基线能力以纯函数模块 `js/baseline.js` 实现，全局对象为 `Baseline`。基线快照保存任务在某个时间点的计划字段，差异函数把快照与当前任务逐项比较，输出开始日期、结束日期、进度的偏差以及新增、删除标记。所有函数只读取入参，不读写 `localStorage`，不修改传入对象。本阶段只交付纯函数、测试和本设计文档，不修改任何 UI 文件。

## 2. 范围

本阶段包含：

- 基线快照创建与按 id 排序。
- 快照结构校验与可选 id 白名单校验。
- 快照与当前任务的逐任务差异计算。
- 差异汇总统计与天数格式化。
- Timeline 双条和 Grid 基线列的接口约定。

本阶段不包含：

- 快照的持久化、命名和版本历史。
- TimelinePane 双条渲染。
- GridPane 基线列渲染。
- 基线切换、清除和多个基线并存。
- 关键路径、工作日历和自动排期。

## 3. 快照结构

```js
{
  version: 1,                                  // Baseline.VERSION
  capturedAt: '2026-06-01T08:00:00.000Z',      // 采集时间，可解析的时间字符串
  tasks: [
    {
      id: 'task-1',                            // 任务唯一标识
      name: '需求评审',                         // 任务名称，用于展示
      startDate: '2026-01-01',                 // YYYY-MM-DD 或 null
      endDate: '2026-01-10',                   // YYYY-MM-DD 或 null
      progress: 40                             // 0 到 100
    }
  ]
}
```

快照版本 `Baseline.VERSION` 当前为 `1`，与数据根节点的 `pmweb_version` 相互独立。快照版本只描述快照结构，数据版本只描述 `TaskManager` 数据根结构。

## 4. 字段口径

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | number | 必须等于 `Baseline.VERSION` |
| `capturedAt` | string | 采集时间，必须能被 `Date.parse` 解析 |
| `tasks` | array | 任务快照数组 |
| `tasks[].id` | string | 非空，快照内唯一 |
| `tasks[].name` | string | 允许空字符串 |
| `tasks[].startDate` | string \| null | `YYYY-MM-DD`，无日期为 `null` |
| `tasks[].endDate` | string \| null | `YYYY-MM-DD`，无日期为 `null` |
| `tasks[].progress` | number | `[0, 100]`，越界在创建时收敛 |

快照只记录任务自身字段，不依赖 `TaskManager`。父任务的日期如果希望保存派生范围，调用方应先通过 `TaskManager.getDateRange(task)` 得到范围，再投影成带 `startDate`、`endDate` 的对象传给 `createSnapshot`。

## 5. API

| 函数 | 签名 | 返回值 | 说明 |
|------|------|--------|------|
| `createSnapshot` | `createSnapshot(tasks, capturedAt)` | Snapshot | 创建快照，按 `id` 升序 |
| `validateSnapshot` | `validateSnapshot(snapshot, allowedIds)` | `{ valid, errors }` | 校验结构与可选 id 白名单 |
| `diff` | `diff(snapshot, currentTasks)` | `{ tasks, added, removed }` | 逐任务比较 |
| `summarize` | `summarize(diffResult)` | Summary | 统计变更、延期、提前、新增、删除和平均延期 |
| `formatVariance` | `formatVariance(days)` | string | 输出 `+3`、`-2`、`0` |

## 6. 创建与排序

`createSnapshot(tasks, capturedAt)` 的规则：

- 只读取 `id`、`name`、`startDate`、`endDate`、`progress`，生成新的快照对象。
- 跳过空对象、非对象、缺少合法字符串 `id` 的条目。
- 同一 `id` 只保留首次出现的任务，保证输出快照自身合法。
- `name` 缺失时写空字符串。
- 非法日期写 `null`。
- `progress` 非数字写 0，小于 0 写 0，大于 100 写 100。
- 结果按 `id` 字符串升序排列，排序与输入顺序无关。
- `capturedAt` 省略时取当前时间的 ISO 字符串，测试和持久化场景应显式传入。

## 7. 校验规则

`validateSnapshot(snapshot, allowedIds)` 返回 `{ valid: boolean, errors: [{ index, code, message }] }`，与 `Links.validate` 的错误结构一致。

| 错误码 | 触发条件 |
|--------|----------|
| `INVALID_SNAPSHOT` | 快照不是对象或为数组 |
| `INVALID_VERSION` | `version` 不等于 `Baseline.VERSION` |
| `INVALID_CAPTURED_AT` | `capturedAt` 缺失、为空或不可解析 |
| `INVALID_TASKS` | `tasks` 不是数组 |
| `INVALID_TASK` | 任务条目不是对象 |
| `INVALID_ID` | `id` 不是非空字符串 |
| `DUPLICATE_ID` | 快照内 `id` 重复 |
| `NOT_IN_WHITELIST` | 提供白名单且 `id` 不在其中 |
| `INVALID_NAME` | `name` 不是字符串 |
| `INVALID_DATE` | 日期既不是 `YYYY-MM-DD` 也不是 `null` |
| `INVALID_PROGRESS` | `progress` 不是 `[0, 100]` 的数字 |

`allowedIds` 可选，接受字符串数组、`Set` 或任务数组。提供后快照中的每个 `id` 必须出现在白名单内，用于防止把过期快照与另一批任务错配。

## 8. 差异口径

`diff(snapshot, currentTasks)` 取快照任务集合与当前任务集合的并集，按 `id` 升序生成比较条目。

### 8.1 日期偏差

```text
startVarianceDays = currentStartDate - baselineStartDate
endVarianceDays   = currentEndDate   - baselineEndDate
```

- 单位是自然日，正数表示延后，负数表示提前，0 表示不变。
- 日期按 UTC 解析，避免本地时区和夏令时造成跨日误差。
- 两端都缺失日期时为 0。
- 只有一端缺失日期时为 `null`，表示不可比较。
- 新增和删除任务的日期偏差固定为 `null`。

### 8.2 进度偏差

```text
progressVariance = currentProgress - baselineProgress
```

新增和删除任务的 `progressVariance` 为 `null`。

### 8.3 changed、added、removed

- `added` 为 `true` 表示任务在快照中不存在、在当前任务中存在。
- `removed` 为 `true` 表示任务在快照中存在、在当前任务中不存在。
- `changed` 仅在任务同时存在时判断，任一项不同即为 `true`：
  - `name` 不同。
  - `startDate` 不同。
  - `endDate` 不同。
  - `progress` 不同。
- 新增和删除任务的 `changed` 固定为 `false`，避免汇总时重复计数。

## 9. 差异结果结构

```js
{
  tasks: [
    {
      id: 'task-1',
      name: '需求评审',
      baselineStartDate: '2026-01-01',
      baselineEndDate: '2026-01-10',
      baselineProgress: 40,
      currentStartDate: '2026-01-03',
      currentEndDate: '2026-01-15',
      currentProgress: 65,
      startVarianceDays: 2,
      endVarianceDays: 5,
      progressVariance: 25,
      changed: true,
      added: false,
      removed: false
    }
  ],
  added: ['task-9'],
  removed: ['task-8']
}
```

- `tasks` 按 `id` 升序，包含变更、未变更、新增和删除的全部条目。
- `added` 和 `removed` 是便捷 id 数组，顺序与 `tasks` 一致。
- 新增任务的基线字段为 `null`，删除任务的当前字段为 `null`。

## 10. 汇总统计

`summarize(diffResult)` 返回：

| 字段 | 说明 |
|------|------|
| `total` | 比较条目总数 |
| `changed` | `changed === true` 的任务数，不含新增和删除 |
| `delayed` | `endVarianceDays > 0` 的任务数 |
| `advanced` | `endVarianceDays < 0` 的任务数 |
| `added` | 新增任务数 |
| `removed` | 删除任务数 |
| `averageDelayDays` | 延期任务的平均 `endVarianceDays`，保留两位小数 |

延期和提前以结束日期为准，因为交付时间决定项目是否滞后。开始日期偏差仍然保留在逐任务条目中，供表格列和提示信息使用。没有延期任务时 `averageDelayDays` 为 0。`endVarianceDays` 为 `null` 的任务不参与延期、提前和平均延期统计。

## 11. 格式化

`formatVariance(days)` 输出带符号的整数文本：

| 输入 | 输出 |
|------|------|
| `3` | `+3` |
| `-2` | `-2` |
| `0` | `0` |
| `2.6` | `+3` |
| `-1.6` | `-2` |
| `null`、`NaN`、`Infinity`、非数字 | `0` |

单位“天”由渲染层决定，函数只负责数值符号，避免表格和提示信息出现单位重复。

## 12. 与 TimelinePane 双条接入

本阶段不修改 `js/timeline-pane.js`。后续接入方式：

```js
var snapshot = getActiveBaseline();  // 由调用方从持久化层读取
var diffResult = Baseline.diff(snapshot, TaskManager.getAllTasks());
var entryById = new Map();
diffResult.tasks.forEach(function(entry) {
  entryById.set(entry.id, entry);
});

var rows = RowModel.build({
  collapsed: ViewState.collapsed,
  statusFilter: ViewState.statusFilter
}).rows;

TimelinePane.render(rows, { baselineById: entryById });
```

渲染约定：

- 当前任务条继续使用 `row.startDate` 和 `row.endDate`。
- 基线任务条使用 `entry.baselineStartDate` 和 `entry.baselineEndDate`，仅当两个日期都存在时绘制。
- 基线任务条放在当前任务条下方或同一行的浅色底层，建议高度 4 到 6px。
- 当前任务条与基线任务条使用不同颜色，基线使用低饱和度或虚线描边。
- `entry.endVarianceDays > 0` 的任务条使用延期强调色，`< 0` 使用提前色。
- 新增任务没有基线条，删除任务不出现在 `rows` 中，自然不绘制。
- 折叠和筛选只影响可见行，不影响 `diff` 的完整比较结果。

## 13. 与 GridPane 基线列接入

本阶段不修改 `js/grid-pane.js`。后续接入方式：

- 在默认列配置中增加只读列 `baseline`，标题“基线偏差”。
- 单元格读取 `entryById.get(row.id)`。
- 显示文本使用 `Baseline.formatVariance(entry.endVarianceDays)`。
- 样式类约定：
  - `variance-delayed`：`endVarianceDays > 0`。
  - `variance-advanced`：`endVarianceDays < 0`。
  - `variance-flat`：`endVarianceDays === 0`。
  - `variance-missing`：`endVarianceDays === null` 或任务不存在。
- tooltip 展示基线开始、基线结束和当前结束日期，便于定位偏差来源。
- 新增任务在该列显示新增标记，删除任务没有对应行，可在统计区显示删除数量。
- 该列只读，不参与行内编辑提交。

## 14. 持久化边界

`js/baseline.js` 不接触 `localStorage`。快照的保存、读取、删除和命名由调用方负责，建议：

```js
var snapshot = Baseline.createSnapshot(TaskManager.getAllTasks(), new Date().toISOString());
DataStore.save({ pmweb_version: 3, baseline: snapshot });
```

- 快照可以存放在数据根节点的独立 `baseline` 字段，或单独的存储键。
- 读取后应先调用 `Baseline.validateSnapshot(snapshot, TaskManager.getAllTasks())` 再参与差异计算。
- `capturedAt` 用于展示“基线于某时采集”，不参与排期计算。
- 多个基线并存、基线历史和基线切换属于后续阶段。

## 15. 纯函数约束

- 不读取或写入 `localStorage`。
- 不依赖 DOM、`TaskManager`、`RowModel` 或任何其他全局对象。
- 不修改传入的任务数组、快照对象和差异结果。
- 不使用跨调用缓存，每次调用独立计算。
- 所有日期运算按 UTC 进行，只做自然日差，不扣除工作日。
- `createSnapshot` 省略 `capturedAt` 时读取系统时间，这是唯一的非确定输入，持久化场景应显式传入。

## 16. 测试

测试文件为 `tests/baseline.test.js`，通过 `node tests/baseline.test.js` 运行，覆盖：

- 快照创建、字段保存、按 id 排序、重复 id 保留首个和非法条目跳过。
- 合法快照与版本、时间、任务数组、id、名称、日期、进度、重复 id、白名单等非法场景。
- 日期延后、提前、跨年、无变化和单端缺失。
- 进度变化、名称变化、新增任务和删除任务。
- 差异结果的 id 并集与排序。
- 汇总统计、平均延期和格式化。
- 所有函数调用前后输入保持不变。

## 17. 未覆盖项

- 浏览器中的双条渲染和基线列显示效果。
- 快照持久化、基线命名、多基线和基线切换。
- 大量任务下的差异计算性能。
- 工作日历、节假日扣除和自动排期联动。
- 关键路径与基线偏差的联合分析。

## 18. P1-3 接入实现

本节记录实际接入结果，取代第 12、13、14 节的后续接入约定。

### 18.1 持久化

`TaskManager` 新增三个方法，快照直接存放在数据根节点的 `data.baseline`：

| 方法 | 行为 |
|------|------|
| `getBaseline()` | 调用 `Baseline.validateSnapshot(snapshot)`，非法时返回 `null` 并 `alert` 一次；同一非法快照不重复提示 |
| `saveBaseline()` | 用 `Baseline.createSnapshot(TaskManager.getAllTasks(), new Date().toISOString())` 覆盖保存，并 `DataStore.save` |
| `clearBaseline()` | 把 `data.baseline` 置 `null`，返回是否发生了清除 |

读取校验不传 `allowedIds`。基线保存后任务可能被删除，白名单校验会把合法快照判为非法，而差异函数本身已经用 `removed` 表达这种情况。`data.baseline` 属于数据根节点的附加字段，`PMWebValidate.validateData` 不拒绝未知根字段，导入导出和 `DataStore.load` 都会原样保留。

### 18.2 工具栏菜单

`App.init` 在 `_bindToolbar` 之后调用 `_initBaselineMenu`，在 `#btn-add-root-task` 之前动态插入：

```text
基线 ▾
├── 保存基线
├── 查看差异
└── 清除基线
```

- 保存和清除都经 `ModalManager.confirm` 二次确认。
- 未保存基线时“查看差异”和“清除基线”禁用，按钮文字颜色表示基线已存在。
- `renderAll` 末尾调用 `_syncBaselineMenu` 刷新菜单状态。
- 差异弹窗展示 `Baseline.summarize` 统计文本（`App.buildBaselineSummaryText`）和 `App.buildBaselineChangeList` 生成的变更列表，只列出 `changed`、`added`、`removed` 条目。
- 清除基线后 `Workbench.render` 重绘，网格偏差提示和时间轴 ghost 条全部消失。

### 18.3 Timeline 双条

- `Workbench.render` 通过 `_baselineMap()` 计算 `Map<taskId, diffEntry>`，先 `setBaseline(map)` 再 `render(rows)`。
- `TimelinePane._renderBaselineBar(row)` 仅在 `baselineStartDate` 与 `baselineEndDate` 都存在时绘制。
- 位置用当前单元格和 `dateToX` 计算，粒度和滚动天然同步。
- ghost 条固定 `BASELINE_TOP = 32`、高度 5px，位于任务条下方；`pointer-events: none` 不拦截点击。
- 样式类：`is-delayed`（结束延后）、`is-advanced`（提前）、`is-flat`（持平）。
- `updateSelection` 和 `updateHover` 的选择器已包含 `.gantt-baseline-bar`，选中和 hover 时 ghost 条跟随高亮。

### 18.4 Grid 偏差提示

没有新增列，避免改动 `ColumnConfig.DEFAULT_COLUMNS` 和既有列持久化格式。改为在任务名称单元格末尾追加只读徽标：

- `GridPane.setBaselineById(map)` 接收差异映射。
- `renderBaselineBadge(row)` 输出 `+5天`、`-3天` 或“新增”。
- 结束偏差为 0、缺失基线或缺少日期时不显示徽标。
- tooltip 展示基线开始、基线结束和结束偏差天数。
- 徽标不参与行内编辑和列配置。

### 18.5 脚本挂载

`index.html` 在 `js/grid-pane.js` 之前增加 `<script src="js/baseline.js"></script>`，确保 `TaskManager`、`Workbench`、`GridPane` 和 `TimelinePane` 运行时能看到 `Baseline`。

### 18.6 测试

- `tests/baseline.test.js`：纯函数行为不变。
- `tests/baseline-ui.test.js`：TaskManager 保存、读取、清除、非法快照、重新加载后持久化、摘要文本和差异列表。
- `tests/timeline.test.js`：ghost 条渲染、缺失基线不渲染、日期变化后的位置、偏差样式和选中态。
- `tests/grid.test.js`：名称单元格偏差徽标和格式化。
