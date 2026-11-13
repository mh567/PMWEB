# P2-3 关键路径设计

## 1. 结论

关键路径以纯函数模块 `js/critical-path.js` 实现，全局对象为 `CriticalPath`。模块只使用 `FS` 依赖和任务工期，计算最早开始、最早结束、最晚开始、最晚结束和总浮动。可选使用 `work-calendar.js` 的工作日口径。模块不读写 `localStorage`，不修改传入的任务、依赖和配置，不依赖 DOM。

本阶段交付模块、测试和本文档。时间轴高亮和排期提示由后续接入任务完成。

## 2. 范围

本阶段包含：

- 基于 `FS` 依赖的前推与后推计算。
- 总浮动与关键任务判定。
- 工作日模式与自然日模式的工期换算。
- 环、缺失任务、非法日期和非法 `lag` 的错误返回。

本阶段不包含：

- `SS`、`FF`、`SF` 依赖的最晚时间推导。
- 资源约束、资源平衡和日历切换。
- 时间轴着色、图例和交互。
- 关键路径动画与冲突提示。
- 基线与关键路径的联合分析。

## 3. API

```js
CriticalPath.compute(tasks, links, config) -> {
  nodes: Node[],
  criticalIds: string[],
  totalDuration: number,
  errors: Error[]
}

CriticalPath.criticalTaskIds(tasks, links, config) -> string[]
```

`criticalTaskIds` 复用 `compute`，返回浮动为 `0` 的任务 id 数组，顺序与 `tasks` 入参一致。

`config` 的语义与 `Scheduler` 相同：

| 写法 | 模式 |
|------|------|
| 省略或 `null` | 自然日 |
| `{ weekends, holidays, workdays }` | 工作日 |
| `{ workCalendar: {...} }` | 工作日 |
| `{ workCalendar: null }` | 自然日 |
| `{ useWorkCalendar: false }` | 自然日 |

运行环境中不存在 `WorkCalendar` 时自动回退自然日。

## 4. 节点结构

```js
Node {
  id: string,
  duration: number,            // 工期，自然日或工作日
  earliestStart: string|null,  // 最早开始
  earliestFinish: string|null, // 最早结束
  latestStart: string|null,    // 最晚开始
  latestFinish: string|null,   // 最晚结束
  totalFloat: number|null,     // 总浮动，单位天
  critical: boolean            // totalFloat === 0
}
```

任务缺少有效日期时节点仍保留，日期字段为 `null`，`critical` 为 `false`，同时产生 `MISSING_DATE` 错误。

## 5. 算法

### 5.1 图构建

只保留 `type === 'FS'` 且两端任务都有效的依赖。其余依赖类型忽略，不参与前后推。重复边不合并，入度按边数累计，拓扑序仍然正确。

节点顺序按 `tasks` 入参顺序登记。拓扑排序在多个节点同时就绪时按登记顺序选取，结果稳定。

### 5.2 前推

1. 根节点的最早开始取任务自身的 `startDate`，工作日模式下向后吸附到最近工作日。
2. 其余节点的最早开始取自身开始日期与所有前置约束中的最大值。
3. 前置约束为 `shift(前置 earliestFinish, lag)`。
4. 最早结束为 `shift(最早开始, duration - 1)`。

依赖约束晚于计划开始时推迟最早开始，约束早于计划开始时保留计划开始。这与 `Scheduler` 的下界语义一致。

### 5.3 后推

1. 项目结束取所有节点最早结束的最大值。
2. 没有后继的节点，最晚结束等于项目结束。
3. 其余节点的最晚结束取所有后继最晚开始减去 `lag` 后的最小值，并受项目结束约束。
4. 最晚开始为 `shift(最晚结束, -(duration - 1))`。

### 5.4 浮动与关键判定

```js
totalFloat = daysBetween(earliestStart, latestStart)
critical = totalFloat === 0
```

自然日模式按日期差计算。工作日模式按工作日差计算。计算结果为负时按 `0` 处理，表示计划日期与依赖冲突，这类任务同样视为关键任务。

`totalDuration` 取项目最早开始到项目结束的含首尾天数，工作日模式按工作日计。

### 5.5 FS 日期口径

`FS` 且 `lag` 为 `0` 时，后置任务可以从前置任务结束当天开始，与 `Links.computeConstraint` 和 `Scheduler` 保持一致。连续接续的测试数据使用 `lag` 为 `1`，此时后置任务在前置任务结束后的下一个工作日开始。

## 6. 工作日口径

工作日模式复用 `WorkCalendar`：

- 工期为任务起止区间内的工作日数量，最少为 `1`。
- 日期推进使用 `WorkCalendar.addWorkingDays`。
- 计划开始落在非工作日时，用 `WorkCalendar.adjustToWorkingDay` 向后吸附。
- `totalDuration` 使用 `WorkCalendar.workingDaysBetween`。

自然日模式直接按 UTC 日期差计算，不跳过周末和节假日。

## 7. 错误码

错误项结构：

```js
{
  code: string,
  message: string,
  taskId: string | null,
  linkId: string | null
}
```

| code | 触发条件 |
|------|----------|
| `INVALID_TASKS` | `tasks` 不是数组 |
| `INVALID_TASK` | 任务缺少有效 id |
| `DUPLICATE_TASK` | 任务 id 重复 |
| `INVALID_LINKS` | `links` 既不是数组也不是空值 |
| `INVALID_LINK` | 依赖项不是对象 |
| `INVALID_LAG` | `FS` 依赖的 `lag` 不是有限整数 |
| `MISSING_SOURCE` | 依赖引用了不存在的任务 |
| `MISSING_TARGET` | 依赖目标任务不存在 |
| `MISSING_DATE` | 任务缺少有效的开始或结束日期 |
| `INVALID_RANGE` | 结束日期早于开始日期 |
| `INVALID_DATE` | 日期无法参与计算 |
| `CYCLE` | `FS` 依赖存在环 |

存在环时 `nodes` 保留但日期为空，`criticalIds` 为空数组，`totalDuration` 为 `0`。其余错误允许部分计算，错误任务排除在前后推之外。

## 8. 纯函数约束

- 不读取或写入 `localStorage`。
- 不修改传入的 `tasks`、`links`、`config`。
- 节点和错误都是新对象，调用方修改返回值不影响入参。
- 不依赖 DOM、`TaskManager`、`Progress`。
- 只在 `WorkCalendar` 存在时调用它，缺失时回退自然日。
- 同一输入下拓扑序、关键任务顺序和数值稳定。

## 9. 接入点

### 9.1 脚本挂载

`index.html` 中加入脚本，顺序在 `links.js` 和 `work-calendar.js` 之后：

```html
<script src="js/links.js"></script>
<script src="js/work-calendar.js"></script>
<script src="js/scheduler.js"></script>
<script src="js/critical-path.js"></script>
```

### 9.2 Timeline 高亮

时间轴渲染前计算一次关键任务集合，按 id 建立查询表：

```js
var config = { workCalendar: TaskManager.getSetting('workCalendar') || null };
var result = CriticalPath.compute(TaskManager.getAllTasks(), TaskManager.getLinks(), config);
var criticalSet = new Set(result.criticalIds);
```

`TimelinePane` 绘制任务条时读取 `criticalSet.has(task.id)`，命中时叠加高亮描边或颜色。建议：

- 关键任务条使用强调色描边，保持原有填充色，避免与任务颜色冲突。
- 图例中增加“关键路径”一项。
- 存在 `CYCLE` 或 `MISSING_DATE` 时在状态栏提示，不绘制高亮。
- 高亮只影响 overlay 和样式，不改变行高和布局计算。

`Workbench.render()` 内缓存最近一次结果，依赖或日期变化后重新计算。200 行规模下全量计算成本可以接受，虚拟化时只需对可见子集使用同一份结果。

### 9.3 Scheduler 覆盖提示

自动排期写回前执行一次 `CriticalPath.compute`：

- 用排期结果作为输入，比较排期前后 `criticalIds` 的变化。
- 关键任务数量增加或关键链变化时，在确认框中列出新增的关键任务名称。
- 存在冲突浮动（负浮动被压到 `0`）时提示用户检查依赖约束。
- 排期存在 `CYCLE` 时禁止写回，关键路径同步返回 `CYCLE`，只需展示一次。

### 9.4 手动锁定

锁定任务仍参与关键路径计算，只是 `Scheduler` 不修改其日期。这样可以观察锁定任务是否位于关键链上。

- 锁定任务落在关键链上时，排期结果对它的依赖更强，提示用户可以优先关注。
- 锁定任务不在关键链上时，说明它有浮动，可以延后处理。
- 关键路径模块只读取 `locked` 字段，不修改锁定状态。

### 9.5 导入导出

关键路径结果不写入数据文件，属于派生数据。导入后首次渲染重新计算。导出时保持原始任务和依赖不变。导入校验建议先执行 `Links.validate` 和 `Links.detectCycle`，再执行 `CriticalPath.compute`，避免把环数据带进渲染。

## 10. 测试

测试文件为 `tests/critical-path.test.js`，通过 `node tests/critical-path.test.js` 运行，覆盖：

- 单链 FS 的全部任务浮动为 `0`。
- 依赖约束推迟最早开始。
- 并行分支中较短分支产生浮动。
- 多个根节点按各自计划开始计算。
- `critical` 标记与 `criticalTaskIds` 一致。
- 工作日模式的工期和跨周末推进。
- 环、缺失源任务、缺失目标任务、缺少日期。
- 非 `FS` 依赖不参与计算。
- 入参不被修改，返回节点与入参隔离。
- 空输入不抛错。

## 11. 未覆盖项

- 浏览器中的高亮样式与图例。
- 关键路径高亮的性能基准。
- 资源约束、资源平衡和资源日历。
- `SS`、`FF`、`SF` 依赖的最晚时间推导。
- 多项目、跨时区和超长工期。
- 基线与关键路径的联合分析。
