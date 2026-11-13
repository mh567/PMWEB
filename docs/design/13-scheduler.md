# P2-2 自动排期设计

## 1. 结论

自动排期以纯函数模块 `js/scheduler.js` 实现，全局对象为 `Scheduler`。模块读取 `links.js` 的依赖口径与 `work-calendar.js` 的工作日口径，只计算新的日期，不读写 `localStorage`，不修改传入的任务、依赖和配置。

本阶段交付模块、测试和本文档，不修改 `index.html`、`TaskManager`、`Workbench` 或任何渲染代码。脚本挂载、按钮和覆盖提示由工作台负责人在后续接入。

## 2. 范围

本阶段包含：

- 单任务四种依赖类型的约束计算。
- `lag` 正数、零和负数的处理。
- 按拓扑序批量排期。
- 手动锁定任务的跳过规则。
- 工作日模式与自然日模式的切换。
- 环、缺失任务、非法日期、冲突约束的错误返回。

本阶段不包含：

- 排期结果的持久化写回。
- 排期按钮、覆盖提示和撤销交互。
- 父任务日期的派生与联动。
- 资源日历、多日历和跨时区排期。
- 关键路径的绘制，关键路径由 `js/critical-path.js` 独立提供。

## 3. 输入与配置

```js
Scheduler.scheduleTask(task, links, tasks, config) -> {
  task: Task,
  changed: boolean,
  errors: Error[]
}

Scheduler.scheduleAll(tasks, links, config) -> {
  tasks: Task[],
  changed: boolean,
  errors: Error[]
}
```

参数说明：

| 参数 | 类型 | 说明 |
|------|------|------|
| `task` | Task | 待排期的单个任务 |
| `tasks` | Task[] \| Map \| object | 任务全集，用于按 id 查找前置任务 |
| `links` | Link[] | 依赖数组，结构见 `03-dependency-model.md` |
| `config` | object \| null | 工作日配置，省略时按自然日计算 |

`config` 支持三种写法：

```js
// 直接传工作日历配置
{ weekends: [0, 6], holidays: ['2026-01-01'], workdays: ['2026-01-04'] }

// 包装在 workCalendar 字段中
{ workCalendar: { weekends: [0, 6] } }

// 显式关闭工作日模式
{ useWorkCalendar: false }
```

省略 `config` 表示自然日。传入任意日历配置对象表示工作日模式，空对象 `{}` 使用默认周末。`{ workCalendar: null }` 或 `{ useWorkCalendar: false }` 强制回到自然日。运行环境中不存在 `WorkCalendar` 时自动回退自然日，不抛错。

## 4. 依赖语义

约束公式与 `Links.computeConstraint` 保持一致，`L` 为 `lag`：

| 类型 | 约束字段 | 公式 |
|------|----------|------|
| `FS` | 目标 `startDate` | 前置 `endDate` 加 `L` |
| `SS` | 目标 `startDate` | 前置 `startDate` 加 `L` |
| `FF` | 目标 `endDate` | 前置 `endDate` 加 `L` |
| `SF` | 目标 `endDate` | 前置 `startDate` 加 `L` |

日期按 `YYYY-MM-DD` 字符串比较，内部使用 UTC 计算。自然日模式直接加减天数。工作日模式调用 `WorkCalendar.addWorkingDays`，并在结果不是工作日时向后吸附到最近工作日。

`FS` 且 `lag` 为 `0` 时，后置任务的开始日期等于前置任务的结束日期，与依赖模型的既定口径一致。需要首个任务次日开工时，把 `lag` 设为 `1`。

前置任务缺少对应日期时返回 `MISSING_DATE`，该条约束被跳过，其余约束继续生效。

## 5. 单任务算法

`scheduleTask` 的处理顺序：

1. 从 `links` 中筛出 `target` 等于当前任务 id 的入边。
2. 校验任务自身的 `startDate` 与 `endDate`，非法时返回 `INVALID_DATE` 并保持原值。
3. 对每条入边校验类型、`lag`、前置任务存在性、前置日期有效性和约束日期可计算性。
4. 开始约束取所有 `startDate` 约束中的最大值，结束约束取所有 `endDate` 约束中的最大值。
5. 任务工期取当前 `startDate` 到 `endDate` 的天数，工作日模式按工作日计，最小为 `1`。日期缺失时工期按 `1` 处理。
6. 当前开始日期早于开始约束时，把开始日期推到约束值，结束日期按工期顺延。
7. 当前结束日期早于结束约束时，把结束日期推到约束值，开始日期按工期回推。
8. 只有一端日期存在时，按工期补齐另一端。
9. 起止仍然倒挂时返回 `CONFLICT`，并把结束日期落到开始日期加工期减一。

约束是下界。当前日期已经晚于约束时保持不动，避免把用户已有的排期向前拉动。`scheduleTask` 返回任务副本，`changed` 表示复本与入参日期是否不同。

## 6. 批量排期

`scheduleAll` 的流程：

1. 复制任务到内部 Map，输出保持入参任务顺序。
2. 校验任务数组、依赖数组、重复 id 和非法日期。
3. 用入边构建入度表，按任务在 `tasks` 中的原始顺序稳定地做拓扑排序。
4. 存在环时返回 `CYCLE`，输出保持原日期，`changed` 为 `false`。
5. 按拓扑序逐个调用 `scheduleTask`，前置任务的新日期立即参与后继任务的计算。
6. 合并错误并按 `code + linkId + taskId` 去重。
7. 用最终 Map 生成输出数组，未参与排期的任务同样返回副本。

多条路径汇聚到同一任务时，拓扑序保证所有前置任务先完成计算。多个根节点同时就绪时按 `tasks` 中的原始顺序处理，结果稳定。

## 7. 手动锁定

任务满足以下任一条件时视为锁定：

```js
task.locked === true
task.manualLock === true
```

锁定任务在 `scheduleAll` 中被跳过，自身日期保持不变。它的日期仍然作为后继任务的约束来源。文档推荐统一使用 `locked`，`manualLock` 仅作为旧数据的兼容别名。

锁定状态由调用方维护，本模块只读取，不写入。

## 8. 错误码

错误项结构：

```js
{
  code: string,
  message: string,
  linkId: string | null,
  taskId: string | null
}
```

| code | 触发条件 |
|------|----------|
| `INVALID_TASKS` | `tasks` 不是数组 |
| `INVALID_TASK` | 任务项不是对象 |
| `DUPLICATE_TASK` | 任务 id 重复 |
| `INVALID_LINKS` | `links` 既不是数组也不是空值 |
| `INVALID_LINK` | 依赖项不是对象 |
| `INVALID_ENDPOINT` | `source` 或 `target` 不是非空字符串 |
| `INVALID_TYPE` | 依赖类型不在 FS、SS、FF、SF 中 |
| `INVALID_LAG` | `lag` 不是有限整数 |
| `SELF_REFERENCE` | 依赖两端指向同一任务 |
| `MISSING_SOURCE` | 依赖引用了不存在的任务 |
| `MISSING_TARGET` | 依赖目标任务不在任务集合中 |
| `MISSING_DATE` | 前置任务缺少约束所需日期 |
| `INVALID_DATE` | 日期格式非法或不存在 |
| `CONFLICT` | 开始与结束约束互相矛盾 |
| `CYCLE` | 依赖图存在环 |

存在错误时模块尽可能继续排期其余任务，环和 `INVALID_LINKS` 会直接中止并返回原日期。

## 9. 纯函数约束

- 不读取或写入 `localStorage`。
- 不修改传入的 `tasks`、`links`、`config`，`tasks` 为数组或 Map 时均按只读处理。
- 返回的任务和错误都是新对象，调用方修改返回值不会影响入参。
- 不依赖 DOM、`TaskManager`、`Progress`。
- 只在 `WorkCalendar` 存在时调用它，缺失时静默回退自然日。
- 结果只由入参决定，拓扑排序在相同输入下稳定。

## 10. 接入点

### 10.1 脚本挂载

工作台负责人在 `index.html` 中按以下顺序加入脚本，保持经典脚本和 `file://` 双击可运行：

```html
<script src="js/links.js"></script>
<script src="js/work-calendar.js"></script>
<script src="js/scheduler.js"></script>
<script src="js/critical-path.js"></script>
```

`Scheduler` 不强制依赖 `Links` 对象本身，只有生成环路提示时会读取 `Links.detectCycle`。`WorkCalendar` 可选，缺失时自动按自然日工作。

### 10.2 排期入口

建议在工具栏增加“自动排期”按钮，点击后执行：

```js
var config = { workCalendar: TaskManager.getSetting('workCalendar') || null };
var result = Scheduler.scheduleAll(TaskManager.getAllTasks(), TaskManager.getLinks(), config);
if (result.errors.length > 0) {
  StatusBar.show(result.errors[0].message);
  return;
}
if (!result.changed) return;
result.tasks.forEach(function(task) {
  TaskManager.updateTask(task.id, {
    startDate: task.startDate,
    endDate: task.endDate
  });
});
Workbench.render();
```

调用前先备份当前数据，调用后一次性写回并重绘。逐条调用 `updateTask` 会触发多次保存和索引重建，任务量大时应改为批量写入 `TaskManager.data.tasks` 后统一保存。

### 10.3 覆盖提示

排期会修改日期，接入时需要在执行前给出确认，并展示被覆盖的任务数量：

```js
var before = new Map();
TaskManager.getAllTasks().forEach(function(task) {
  before.set(task.id, task.startDate + '~' + task.endDate);
});
var result = Scheduler.scheduleAll(tasks, links, config);
var changedTasks = result.tasks.filter(function(task) {
  return before.get(task.id) !== task.startDate + '~' + task.endDate;
});
```

确认框展示 `changedTasks` 的数量和名称。存在 `CYCLE` 时禁止写回，提示用户先处理环路。存在 `MISSING_DATE` 时允许写回，未参与计算的任务保持原值。

### 10.4 时间轴联动

排期完成后由 `Workbench.render()` 统一刷新行列模型和任务条，`Scheduler` 不直接操作 DOM。拖拽任务条结束后可以只对当前任务调用 `scheduleTask`，让后继任务保持提示状态，由用户决定是否批量重排。

### 10.5 导入导出

`Scheduler` 不改变数据格式。锁定字段随任务对象一起导入导出，导入时保持 `locked` 原值即可。导入后的首次自动排期会跳过锁定任务。导出前建议执行一次校验，存在 `CYCLE` 时提示用户，导出文件仍然保留原始依赖，便于人工修复。

## 11. 测试

测试文件为 `tests/scheduler.test.js`，通过 `node tests/scheduler.test.js` 运行，覆盖：

- FS、SS、FF、SF 四种依赖的约束结果。
- `lag` 为零、正数和负数。
- 目标已经满足约束时保持不动。
- 多条入边取最晚约束。
- 工作日模式跨周末推进。
- 缺少工作日历时回退自然日。
- `workCalendar` 包装配置。
- 批量排期的拓扑传播和输出顺序。
- 锁定任务跳过且继续约束后继。
- 环、缺失源、缺失目标、非法日期、非法类型和非法 `lag`。
- 入参不被修改，返回值与入参隔离。
- 空输入不抛错。

## 12. 未覆盖项

- 浏览器中的按钮、确认框和状态栏提示。
- 父任务与子任务的日期派生联动。
- 排期结果的持久化事务与撤销。
- 资源约束、多日历和跨时区。
- 超大规模任务的性能基线。
- 与关键路径高亮的联合交互。
