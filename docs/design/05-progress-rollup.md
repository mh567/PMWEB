# P1-2 进度汇总设计

## 1. 结论

进度汇总以纯函数模块 `js/progress.js` 实现，全局对象为 `Progress`。叶子任务直接读取自身进度，父任务按子任务工期加权递归汇总。所有函数只读取入参，不读写 `localStorage`，不修改传入任务对象和行数组。本阶段只交付纯函数、测试和本设计文档，不修改任何 UI 文件。

## 2. 范围

本阶段包含：

- 进度数值收敛。
- 叶子任务进度取值规则。
- 工期权重计算。
- 父任务递归加权汇总。
- 行数组到进度映射的批量计算。
- 进度到任务状态的推导规则。

本阶段不包含：

- GridPane 进度列渲染。
- TimelinePane 任务条填充和汇总条渲染。
- 行内编辑提交。
- 进度变更后的持久化。
- 工作日历、节假日扣除和关键路径。

## 3. 依赖字段

进度汇总只消费以下现有字段。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 任务唯一标识，用于行映射和环检测 |
| `status` | string | `inProgress`、`thirdParty`、`done` 三态 |
| `progress` | number | 0 到 100，缺省或非法时按 0 处理 |
| `startDate` | string \| null | `YYYY-MM-DD`，用于计算工期 |
| `endDate` | string \| null | `YYYY-MM-DD`，包含在工期内 |

父子关系来自 `TaskManager.getChildren(taskId)`，不新增冗余字段。父任务自身的 `progress` 不参与汇总，父任务进度完全由子树派生。

## 4. API

| 函数 | 签名 | 返回值 | 说明 |
|------|------|--------|------|
| `clamp` | `clamp(value)` | number | 收敛到 `[0, 100]`，非数字返回 0 |
| `leafProgress` | `leafProgress(task)` | number | 叶子任务进度 |
| `durationWeight` | `durationWeight(task)` | number | 工期天数，至少 1 |
| `rollupProgress` | `rollupProgress(task, children, getChildren)` | number | 父任务按子树加权汇总 |
| `computeRowProgress` | `computeRowProgress(rows, getChildren)` | Map<string, number> | 批量计算 RowModel 行进度 |
| `statusFromProgress` | `statusFromProgress(progress, currentStatus)` | string | 由进度推导状态 |

`rollupProgress` 的 `children` 省略或非数组时，通过 `getChildren(task.id)` 获取子任务。`computeRowProgress` 的 `rows` 为 `RowModel.build()` 返回的 `rows`，每行读取 `row.id` 与 `row.task`。

## 5. 叶子进度规则

`leafProgress(task)` 按状态分支：

| 状态 | 规则 | 示例 |
|------|------|------|
| `done` | 固定返回 100，忽略 `progress` | `progress = 40` 返回 100 |
| `thirdParty` | 返回 `max(30, clamp(progress))` | `progress = 10` 返回 30，`progress = 80` 返回 80 |
| `inProgress` | 返回 `clamp(progress)` | `progress = 65` 返回 65 |
| 其他或缺失 | 返回 `clamp(progress)` | 无 `progress` 返回 0 |

`thirdParty` 的 30 分下限表达外部依赖至少已经启动。`done` 以状态为准，避免出现进度 100 但状态未完成的不一致。

## 6. 工期权重规则

`durationWeight(task)` 的规则：

- 使用 `startDate` 与 `endDate`，两端都包含，按自然日计算。
- 同日开始结束记为 1 天。
- 跨月、跨年按实际天数累加，不做工作日扣除。
- 日期按 UTC 解析，避免本地时区和夏令时造成误差。
- 日期缺失、格式非法或结束早于开始时回退为 1。

示例：

| 开始 | 结束 | 权重 |
|------|------|------|
| 2026-01-01 | 2026-01-01 | 1 |
| 2026-01-01 | 2026-01-31 | 31 |
| 2026-01-30 | 2026-02-02 | 4 |
| 2025-12-30 | 2026-01-02 | 4 |

## 7. 父任务汇总规则

`rollupProgress` 对子任务逐层递归：

1. 没有子任务时返回 `leafProgress(task)`。
2. 子任务都有合法日期时，权重取 `durationWeight(child)`。
3. 任意一个子任务缺少合法日期时，整组子任务按等权 1 计算，避免部分缺失导致权重偏斜。
4. 单个子任务本身是父任务时，先递归得到它的汇总进度，再作为该子节点的进度参与上层加权。
5. 结果为 `sum(progress_i * weight_i) / sum(weight_i)`，最后经 `clamp` 收敛。

公式：

```text
parentProgress = clamp( Σ(childProgress × childWeight) / Σ(childWeight) )
```

示例：父任务有两个子任务，A1 进度 75、工期 10 天，A2 进度 50、工期 21 天，则：

```text
(75 × 10 + 50 × 21) / (10 + 21) = 1800 / 31 ≈ 58.06
```

父任务折叠或状态筛选隐藏子行时，汇总仍基于完整子树，结果与展开状态一致。

## 8. 行映射规则

`computeRowProgress(rows, getChildren)` 遍历可见行，对每行调用 `rollupProgress(row.task, getChildren(row.task.id), getChildren)`，返回 `Map<row.id, number>`。

- 键使用 `row.id`，与 `RowModel.byId` 保持同一套标识。
- 叶子行结果等于 `leafProgress`。
- 父行结果等于完整子树汇总。
- 空数组或非数组返回空 `Map`。
- 不向 `rows` 写入任何字段。

## 9. 状态一致性

`statusFromProgress(progress, currentStatus)` 的规则：

| 进度 | 返回状态 | 说明 |
|------|----------|------|
| `<= 0` | `inProgress` | 未开始一律回到进行中 |
| `>= 100` | `done` | 只有满进度才是完成 |
| `0 < p < 100` 且当前为 `thirdParty` | `thirdParty` | 中间区间保留外部依赖语义 |
| `0 < p < 100` 且当前为其他状态 | `inProgress` | 包括当前为 `done` 的情况 |

明确约束：

- `done` 必须由 100 驱动。中间进度即使当前状态是 `done`，也回退为 `inProgress`。
- `thirdParty` 的 30 分下限只影响显示进度，不自动改写状态。
- 状态推导是建议值，写回仍由调用方通过 `TaskManager.updateTask` 完成。

## 10. 与 GridPane 的接入点

本阶段不修改 `js/grid-pane.js`。后续接入方式：

```js
var rows = RowModel.build({
  collapsed: ViewState.collapsed,
  statusFilter: ViewState.statusFilter
}).rows;
var progressById = Progress.computeRowProgress(rows, TaskManager.getChildren);
GridPane.render(rows, { progressById: progressById });
```

- 进度列读取 `progressById.get(row.id)`，显示时四舍五入为整数百分比。
- 父行进度单元格只读，样式使用汇总行弱化色。
- 叶子行编辑进度后调用 `TaskManager.updateTask(taskId, { progress: value })`，再调用 `Workbench.render()` 重新计算。
- 需要同步状态时调用 `Progress.statusFromProgress(value, task.status)`，把结果一并写回。
- 状态筛选和折叠只影响可见行，不影响 `computeRowProgress` 的汇总口径。

## 11. 与 TimelinePane 的接入点

本阶段不修改 `js/timeline-pane.js`。后续接入方式：

```js
var progressById = Progress.computeRowProgress(rows, TaskManager.getChildren);
TimelinePane.render(rows, { progressById: progressById });
```

- 叶子任务条内部填充宽度按 `progressById.get(row.id)` 计算。
- 父任务汇总条使用同一进度值，可显示为条内填充或文字标签。
- 任务条和汇总条的 tooltip 共用同一百分比，避免左右面板读数不一致。
- 拖拽调整日期后，工期权重会变化，必须重新调用 `Progress.computeRowProgress`。

## 12. 纯函数约束

- 不读取或写入 `localStorage`，数据访问完全由调用方注入。
- 不修改 `task`、`children`、`rows` 对象。
- 不缓存跨调用状态，每次调用独立计算。
- 递归使用局部 `Set` 防止环导致的死循环，环上的节点回退为叶子进度。
- 不依赖 DOM、`TaskManager` 全局或 `RowModel` 全局，只通过参数接收数据。

## 13. 测试

测试文件为 `tests/progress.test.js`，通过 `node tests/progress.test.js` 运行，覆盖：

- `clamp` 边界与非数字输入。
- 叶子进度、`done` 固定 100、`thirdParty` 30 下限。
- 工期权重的单日、跨月、跨年和非法日期回退。
- 父级加权汇总、多层嵌套、无子任务、子任务无日期和混合日期。
- `computeRowProgress` 与 `RowModel` 行结构一致，折叠父行仍按完整子树汇总。
- 状态推导的中间区间规则。
- 所有函数调用前后输入数据与行数组保持不变。

## 14. 未覆盖项

- 浏览器中的实际渲染效果和交互。
- 大量任务下的汇总性能。
- 工作日历与节假日扣除。
- 进度写回后的持久化和撤销。
- 与依赖排期、关键路径的联动。
