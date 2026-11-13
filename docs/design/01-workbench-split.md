# P0-1 统一行模型与分栏骨架设计

## 1. 背景

当前 PMWEB 的左侧是窄任务树，右侧是独立甘特图。两者各自遍历任务数据：任务树递归渲染全部层级，甘特图只展平叶子任务。结果是父任务没有对应的时间轴行，左右行号、折叠状态、选中态和滚动位置都无法对齐。

亿图图示、Smartsheet、MS Project 这类工具的共同点是：左侧任务表格和右侧时间轴共享同一份行模型。表格负责字段编辑，时间轴负责时间表达，左右只是同一数据的不同视图。P0-1 的目标就是先把这套底座搭起来。

## 2. 目标

- 建立唯一的行数组，左侧表格和右侧时间轴都消费它。
- 新增左右分栏工作台，支持分割条拖动和宽度持久化。
- 两个面板共用行高、行顺序、深度、折叠状态、选中态和 hover 态。
- 垂直滚动同步，水平滚动各自独立。
- 为后续列配置、行内编辑、父级汇总、依赖箭头留出稳定接口。
- 不破坏现有导入、导出、拖拽、日历和键盘操作。

## 3. 非目标

- P0-1 不实现列显示隐藏和行内编辑，这些属于 P0-2 和 P0-3。
- P0-1 不实现依赖箭头、基线、工作日历和关键路径。
- P0-1 不引入后端、权限和实时协同。
- P0-1 不重写视觉风格，沿用现有企业风令牌。

## 4. 现状与约束

- 单文件 `index.html`，原生 JavaScript 和 CSS，无构建步骤。
- 数据存放 localStorage，当前版本 v2。
- `TaskManager` 已有 `_byId`、`_childrenByParent`、`_roots`、`_depth` 索引。
- `TreeView` 渲染到 `#tree-container`，`GanttView` 渲染到 `#content-area`。
- `App.renderAll()` 全量重渲染。
- `DragManager` 依赖 `.gantt-body`、`.gantt-bar`、`.gantt-milestone` 选择器。
- 必须继续支持双击 `index.html` 直接运行。

## 5. 目标结构

```text
#toolbar
#main-container
  #workbench
    #grid-pane
      .pane-header  列标题
      .pane-body    任务表格行
    #workbench-splitter
    #timeline-pane
      .pane-header  时间轴表头
      .pane-body    时间轴行、任务条、里程碑
  #todos-sidebar
#status-bar
```

工具栏保留。原来的 `#sidebar` 任务树被 `#grid-pane` 取代。`#todos-sidebar` 暂时保留为右侧栏。

```text
┌─────────────────────────────────────────────────────────────┐
│ 工具栏                                                       │
├────────────────────────────┬────────────────────────────────┤
│ 网格表头（固定）            │ 时间轴表头（固定）              │
├────────────────────────────┼────────────────────────────────┤
│ 行 1：任务名称/状态/日期    │ 行 1：任务条/里程碑             │
│ 行 2：...                   │ 行 2：...                       │
│ 行 3：...                   │ 行 3：...                       │
│ 垂直滚动同步                │ 水平滚动独立                    │
└────────────────────────────┴────────────────────────────────┘
```

## 6. 核心技术选择

### 6.1 双面板，不做单个滚动容器

候选方案：

1. 单个横向滚动容器，左侧列用 `position: sticky` 固定。
2. 两个独立面板，JS 同步垂直滚动。

选择方案 2，原因：

- 左侧表格需要独立横向滚动来容纳更多列。
- 右侧时间轴需要独立横向滚动和缩放。
- 分割条宽度可调，两个视图域边界清晰，符合目标交互。
- 行对齐由同一行数组和固定行高保证，不依赖 sticky 的层叠细节。

代价是需要处理滚动同步回路，下面的方案用同步锁加 `requestAnimationFrame` 解决。

### 6.2 固定行高

P0 统一使用 `40px` 行高。父任务汇总行也使用 40px，只改变字重和背景，不改变高度。

固定行高带来三个好处：

- 两个面板的 `scrollTop` 可以直接一一对应。
- 后续虚拟滚动只需要按 `rowIndex * 40` 计算位置。
- 时间轴任务条的 `top` 计算简单。

单元格内容单行截断，长描述放进 tooltip 或详情弹层。

## 7. 统一行模型

### 7.1 接口

```js
RowModel.build(options) -> {
  rows: Row[],
  byId: Map<string, Row>
}

Row = {
  id: string,
  task: Task,
  depth: number,
  hasChildren: boolean,
  isCollapsed: boolean,
  isSummary: boolean,
  childCount: number,
  startDate: string | null,
  endDate: string | null
}
```

`Row` 是表格和时间的唯一输入。渲染层不再自行调用 `getChildren` 或 `getLeafTasksInTreeOrder`。

### 7.2 展平算法

采用 DFS 前序遍历，父行在子行之前。父任务是否显示由子树可见性决定。

```js
function visit(task, depth) {
  const children = TaskManager.getChildren(task.id);
  const isSummary = children.length > 0;

  if (!isSummary) {
    if (!passesFilter(task)) return { visible: false, rows: [] };
    return {
      visible: true,
      rows: [makeRow(task, depth, { isSummary: false, hasChildren: false })]
    };
  }

  const childResults = children.map(function (child) {
    return visit(child, depth + 1);
  });
  const anyVisible = childResults.some(function (result) {
    return result.visible;
  });

  if (!anyVisible) return { visible: false, rows: [] };

  const row = makeRow(task, depth, {
    isSummary: true,
    hasChildren: true,
    isCollapsed: collapsed.has(task.id),
    childCount: children.length
  });

  const childRows = collapsed.has(task.id)
    ? []
    : childResults.reduce(function (all, result) {
        return all.concat(result.rows);
      }, []);

  return { visible: true, rows: [row].concat(childRows) };
}
```

规则：

- 叶子任务通过状态筛选才显示。
- 父任务只要有一个可见后代就显示。
- 折叠父任务时，父行保留，子行不进入数组。
- 父任务日期由 `TaskManager.getDateRange(task)` 派生。
- P0-1 不计算父级进度，P0-4 再加。

### 7.3 过滤、折叠和搜索

- `collapsed` 放在 `ViewState`，P0-1 先内存保存，后续再持久化。
- 状态筛选沿用现有 `statusFilter`，P0-1 保留三态。
- 搜索和高级筛选放到 P1，`RowModel` 预留 `passesFilter` 注入点。

### 7.4 与 TaskManager 的关系

`TaskManager` 继续负责数据读写和索引。`RowModel` 是只读投影，不修改任务数据。所有增删改仍然走 `TaskManager`，修改完成后调用 `Workbench.render()` 重新生成行数组。

## 8. 数据模型 v3

P0-1 需要两个新字段来支撑表格列：

```js
Task {
  ...现有字段,
  progress: number,          // 0 到 100
  plannedEndDate: string|null // YYYY-MM-DD
}
```

数据根节点增加：

```js
{
  pmweb_version: 3,
  tasks: [],
  milestones: [],
  links: [],
  views: [],
  settings: {
    ...现有设置,
    layoutVersion: 'workbench',
    gridWidth: 560,
    columns: null,
    statusFilter: { inProgress: true, thirdParty: true, done: true }
  }
}
```

迁移规则：

```js
if (version < 3) {
  data.tasks.forEach(function (task) {
    if (typeof task.progress !== 'number') {
      task.progress = task.status === 'done' ? 100 :
                       task.status === 'thirdParty' ? 30 : 50;
    }
    if (task.plannedEndDate === undefined) {
      task.plannedEndDate = task.endDate || null;
    }
  });
  data.links = data.links || [];
  data.views = data.views || [];
  data.pmweb_version = 3;
}
```

迁移只增加字段，不删除数据。旧版本应用读取到 v3 数据时会提示版本过新，因此升级前建议导出一次 JSON 备份。

## 9. 状态模型

```js
ViewState = {
  selectedTaskId: string | null,
  hoveredTaskId: string | null,
  collapsed: Set<string>,
  statusFilter: { inProgress: boolean, thirdParty: boolean, done: boolean },
  gridWidth: number,
  timelineMode: 'gantt' | 'calendar',
  granularity: 'day' | 'week' | 'month'
}
```

持久化范围：

- `gridWidth` 写入 `settings.gridWidth`。
- `collapsed` 和 `timelineMode` 可以写入 `settings`，P0-1 先只持久化 `gridWidth`。
- `selectedTaskId` 和 `hoveredTaskId` 为临时状态，不持久化。

## 10. 渲染管线

```text
TaskManager 数据变化
  -> RowModel.build()
  -> GridPane.render(rows)
  -> TimelinePane.render(rows)
  -> Workbench.syncSelection()
  -> Workbench.syncHover()
```

统一入口：

```js
Workbench.render = function () {
  var rows = RowModel.build({
    collapsed: ViewState.collapsed,
    statusFilter: ViewState.statusFilter
  }).rows;
  GridPane.render(rows);
  TimelinePane.render(rows);
  Workbench.syncSelection();
  Workbench.syncHover();
  Workbench.syncStatusBar();
};
```

`App.renderAll()` 改为调用 `Workbench.render()`。任务树和旧甘特图在过渡期通过 `settings.layoutVersion` 开关切换，验收通过后删除旧代码。

### 10.1 表格面板

表头固定在 `.pane-header`，内容宽度等于所有列宽之和。内容横向滚动时，表头用 `transform: translateX(-scrollLeft)` 同步。

行结构：

```html
<div class="grid-row" data-task-id="..." data-depth="0">
  <div class="grid-cell cell-name">...</div>
  <div class="grid-cell cell-status">...</div>
  <div class="grid-cell cell-assignee">...</div>
  <div class="grid-cell cell-date">...</div>
  <div class="grid-cell cell-date">...</div>
  <div class="grid-cell cell-date">...</div>
  <div class="grid-cell cell-progress">...</div>
  <div class="grid-cell cell-description">...</div>
</div>
```

P0-1 默认列：

| 列 | 宽度 | 说明 |
|----|------|------|
| 任务名称 | 260 | 层级缩进、展开箭头、颜色点 |
| 状态 | 110 | 状态徽标 |
| 负责人 | 100 | 文本 |
| 开始 | 110 | 日期 |
| 结束 | 110 | 日期 |
| 计划完成 | 120 | 日期 |
| 进度 | 120 | 百分比 |
| 描述 | 220 | 单行截断 |

### 10.2 时间轴面板

表头两行，第一行显示年或月分组，第二行显示日、周或月。表头宽度等于整个时间轴宽度，横向滚动时用 `transform` 同步。

行结构：

```html
<div class="timeline-row" data-task-id="..." style="height:40px">
  <div class="timeline-grid-cell" style="width:45px"></div>
  ...
  <div class="gantt-bar" data-task-id="..." style="left:...;width:...;top:10px"></div>
  <div class="gantt-milestone" data-milestone-id="..."></div>
</div>
```

父任务行使用汇总条：

```html
<div class="gantt-summary-bar" style="left:...;width:...;top:14px"></div>
```

P0-1 只要求汇总条占位和视觉区分，具体日期沿用 `getDateRange` 的派生结果。

### 10.3 表头高度对齐

两个面板的表头都使用 `--pane-header-height: 64px`。表格表头内部可以分成 24px 工具条和 40px 列标题，时间轴表头分成两行日期。两侧 body 都从 64px 之后开始，行号自然对齐。

## 11. 垂直滚动同步

```js
var syncing = false;

function syncScroll(source, target) {
  if (syncing) return;
  syncing = true;
  target.scrollTop = source.scrollTop;
  requestAnimationFrame(function () {
    syncing = false;
  });
}

gridBody.addEventListener('scroll', function () {
  syncScroll(gridBody, timelineBody);
  GridPane.syncHeader();
});

timelineBody.addEventListener('scroll', function () {
  syncScroll(timelineBody, gridBody);
  TimelinePane.syncHeader();
});
```

注意事项：

- 只同步 `scrollTop`，不同步 `scrollLeft`。
- 用 `syncing` 锁防止两个面板互相触发。
- 行数相同时，两侧最大 `scrollTop` 相同。表头高度和行高必须严格一致。
- 选中行时调用 `scrollRowIntoView(taskId)`，两个面板同时滚动到该行。
- 切换时间轴模式时重新计算最大滚动高度。

## 12. 分割条

```js
splitter.addEventListener('pointerdown', function (event) {
  splitter.setPointerCapture(event.pointerId);
  var startX = event.clientX;
  var startWidth = gridPane.getBoundingClientRect().width;

  function onMove(moveEvent) {
    var next = startWidth + moveEvent.clientX - startX;
    next = Math.max(320, Math.min(next, workbench.clientWidth * 0.6));
    gridPane.style.width = next + 'px';
  }

  function onUp() {
    splitter.removeEventListener('pointermove', onMove);
    splitter.removeEventListener('pointerup', onUp);
    TaskManager.setSetting('gridWidth', gridPane.getBoundingClientRect().width);
  }

  splitter.addEventListener('pointermove', onMove);
  splitter.addEventListener('pointerup', onUp);
});
```

交互细节：

- 分割条宽度 8px，hover 和拖动时显示企业蓝。
- 双击分割条恢复默认 560px。
- 分割条支持键盘：左右方向键每次 16px，`Home` 和 `End` 到最小和最大值。
- `role="separator"`、`aria-orientation="vertical"`、`aria-valuenow` 随宽度更新。
- 拖动时给 `body` 加 `cursor: col-resize` 和 `user-select: none`。

## 13. 选中与 hover

```js
function setSelected(taskId) {
  ViewState.selectedTaskId = taskId;
  GridPane.updateSelection(taskId);
  TimelinePane.updateSelection(taskId);
}

function setHovered(taskId) {
  ViewState.hoveredTaskId = taskId;
  GridPane.updateHover(taskId);
  TimelinePane.updateHover(taskId);
}
```

实现要求：

- `updateSelection` 只切换 `.selected` 类，不重新渲染整个表格。
- `updateHover` 只切换 `.hovered` 类。
- 两个面板都用事件委托，选择器统一为 `[data-task-id]`。
- 时间轴任务条 hover 时，表格对应行高亮；表格行 hover 时，任务条高亮。
- 点击表格行或任务条都设置同一个 `selectedTaskId`。
- 从任务条拖拽时，拖拽期间暂停 hover 更新，避免闪烁。

## 14. 编辑联动接口

P0-1 只定义接口，P0-3 实现编辑器。

```js
GridPane.onCellCommit = function (taskId, key, value) {
  TaskManager.updateTask(taskId, { [key]: value });
  Workbench.render();
};

TimelinePane.onBarChange = function (taskId, changes) {
  TaskManager.updateTask(taskId, changes);
  Workbench.render();
};
```

所有写操作最终落到 `TaskManager`，再统一重渲染。禁止表格直接改 DOM 数据或时间轴直接改任务对象。

## 15. 事件映射

| 事件 | 来源 | 行为 |
|------|------|------|
| click row | 表格 | 选中任务 |
| click bar | 时间轴 | 选中任务 |
| dblclick row | 表格 | 打开编辑弹窗，P0-3 改为行内编辑 |
| dblclick bar | 时间轴 | 打开编辑弹窗 |
| contextmenu row | 表格 | 任务菜单 |
| contextmenu bar | 时间轴 | 里程碑菜单 |
| mouseover row | 表格 | 同步 hover |
| mouseover bar | 时间轴 | 同步 hover |
| drag bar | 时间轴 | 调整日期，沿用 DragManager |
| drag milestone | 时间轴 | 调整里程碑日期 |
| scroll grid body | 表格 | 同步垂直滚动 |
| scroll timeline body | 时间轴 | 同步垂直滚动 |
| splitter drag | 分割条 | 调整表格宽度 |
| toolbar view toggle | 工具栏 | 切换甘特图或日历 |

## 16. 键盘与可访问性

- 表格行 `tabindex="0"`，上下方向键移动选中行。
- 左右方向键折叠或展开父任务。
- Enter 进入编辑，Escape 退出编辑。
- Shift+F10 打开当前行菜单。
- 分割条可聚焦，方向键调整宽度。
- 时间轴任务条可聚焦，Enter 打开编辑，Delete 删除前确认。
- 所有焦点态使用 2px offset 焦点环。
- 滚动同步和选中切换不影响焦点位置。

## 17. CSS 结构

```css
#workbench {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
}

#grid-pane {
  width: var(--grid-width, 560px);
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

#timeline-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
}

.pane-header {
  height: var(--pane-header-height, 64px);
  flex-shrink: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border);
}

.pane-body {
  flex: 1;
  overflow: auto;
  position: relative;
}

.grid-row,
.timeline-row {
  height: var(--row-height, 40px);
  display: flex;
  box-sizing: border-box;
  border-bottom: 1px solid #f1f5f9;
}

.grid-row.selected,
.timeline-row.selected {
  background: var(--color-blue-tint);
}

.grid-row.hovered,
.timeline-row.hovered {
  background: var(--color-slate-mist);
}
```

`#grid-pane` 宽度用内联样式写入，分割条拖动时更新。`--row-height` 和 `--pane-header-height` 由 JS 与 CSS 共用一个常量来源，避免 40 和 40.5 的偏差。

## 18. 模块拆分

继续单文件交付，但内部按命名空间组织，为后续拆文件做准备：

```text
DateUtil / DEFAULT_TASK_COLOR
DataStore
TaskManager
ViewState
RowModel
GridPane
TimelinePane
Workbench
DragManager
CalendarView
ModalManager
App
```

P0-1 新增 `RowModel`、`ViewState`、`GridPane`、`TimelinePane`、`Workbench`。`GanttView` 的时间轴计算和 `DragManager` 的拖拽逻辑迁入或复用，旧 `TreeView` 在验收后删除。

## 19. 实施步骤

1. 数据 v3 迁移，补 `progress`、`plannedEndDate`、`links`、`views`、`gridWidth`。
2. 新增 `RowModel` 和纯函数测试，先不改 UI。
3. 新增 `ViewState`，收敛折叠、筛选、选中、hover。
4. 新增 workbench DOM 和 CSS，用 `settings.layoutVersion` 开关控制新旧布局。
5. 实现 `GridPane`，复用现有任务树的行渲染、上下文菜单和筛选逻辑。
6. 实现 `TimelinePane`，把 `GanttView` 的坐标计算和渲染迁入，行来源改为 `RowModel`。
7. 接入滚动同步、分割条、选中和 hover。
8. 改造 `DragManager` 选择器和行定位。
9. 让 `CalendarView` 复用同一行模型，或在时间轴面板内切换。
10. 回归导入、导出、拖拽、日历、键盘操作。
11. 删除旧的 `TreeView` 和独立甘特图布局代码。
12. 更新设计文档和进度日志。

## 20. 测试计划

### 纯函数测试

- 三层任务展平顺序正确。
- 折叠父任务后，父行保留，子行消失。
- 状态筛选后，父任务只在有可见后代时出现。
- 空任务、单任务、孤儿任务不抛错。
- v2 到 v3 迁移补全字段，不覆盖已有值。
- 父任务日期汇总与 `getDateRange` 一致。

### DOM 与交互检查

- 3 层任务在左右两栏行数、顺序、行高一致。
- 200 行滚动时两侧无可见错位。
- 表格横向滚动时表头跟随。
- 时间轴横向滚动不影响表格。
- 分割条拖动、双击重置、键盘调整、刷新后宽度保持。
- 点击表格行和任务条，选中态双向同步。
- hover 表格行和任务条，高亮双向同步。
- 原有导入、导出、拖拽、里程碑、日历功能不回归。
- 键盘可以完成选中、折叠、编辑、菜单操作。

## 21. 风险与开放问题

### 风险

- 双面板滚动同步出现抖动或回环。
- 行高受边框、内边距和字体影响，导致累计错位。
- 表格列宽总宽小于面板宽度时，表头与内容宽度不一致。
- `GanttView` 和 `DragManager` 对旧 DOM 选择器依赖较深，迁移时容易漏改。
- 全量重渲染在 200 行以上变慢，需要后续虚拟化。
- localStorage 容量和迁移不可逆性。

### 开放问题

1. 父任务哪些单元格可编辑，哪些只读派生。
2. 折叠状态是否按视图持久化。
3. 日历模式是否保留表格，还是整页切换到日历。
4. 窄屏分栏如何降级。
5. P0 默认列是否包含优先级和标签，还是留到 P1。
6. 是否需要一次性的 JSON 备份提示。

## 22. 验收清单

- [ ] 数据版本升到 v3，旧数据自动补字段。
- [ ] 存在统一 `RowModel`，表格和时间轴不再各自展平任务。
- [ ] 左右面板行数、顺序、行高一致。
- [ ] 垂直滚动同步，水平滚动独立。
- [ ] 分割条可拖动、可键盘调整、宽度持久化。
- [ ] 选中和 hover 双向同步。
- [ ] 父任务有独立行和汇总条。
- [ ] 现有导入、导出、拖拽、里程碑、日历功能不回归。
- [ ] 200 行数据滚动无明显错位和卡顿。
- [ ] 设计文档、任务计划和进度日志已更新。
