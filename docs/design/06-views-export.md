# P1-4 / P1-6 视图与导出设计

## 结论

P1-4 在 RowModel 之后增加一层纯函数视图管线，筛选、排序、分组同时作用于表格和时间轴。P1-6 复用这条管线的输出，在原有三个 sheet 之外新增「当前视图」sheet，导出列顺序与当前可见列一致。

## 1. 目标

- 表格与时间轴共享同一份筛选、排序、分组结果。
- 支持状态、负责人、日期范围和文本搜索四种筛选条件。
- 支持名称、状态、负责人、开始日期、结束日期、进度六种排序字段，升降序稳定。
- 支持不分组、按状态分组、按负责人分组。
- 支持保存、重命名、删除视图，刷新后恢复上次视图。
- Excel 导出按当前视图的数据和当前可见列生成。
- 保持列配置、选中、hover、键盘导航和滚动同步行为不变。

## 2. 数据流

```text
TaskManager 数据
  -> RowModel.build()                 只读行投影，状态筛选与折叠
  -> Views.apply(rows, ViewState.view)
       filterRows -> sortRows -> groupRows
  -> GridPane.render(rows)
  -> TimelinePane.render(rows)
```

`Workbench.render()` 在 `RowModel.build()` 之后调用 `Views.apply`，两栏拿到同一数组。分组标题行也同时进入两栏，保证行数、行高和滚动位置一致。时间轴把分组行渲染为空行，只保留背景色。

## 3. 视图结构

```js
View = {
  id: string,          // 已保存视图才有
  name: string,
  filters: {
    status: '' | 'inProgress' | 'thirdParty' | 'done',
    assignee: string,
    search: string,
    startDate: '' | 'YYYY-MM-DD',
    endDate: '' | 'YYYY-MM-DD'
  },
  sort: {
    field: '' | 'name' | 'status' | 'assignee' | 'startDate' | 'endDate' | 'progress',
    direction: 'asc' | 'desc'
  },
  groupBy: 'none' | 'status' | 'assignee'
}
```

`Views.normalizeView(view)` 清理非法值，补齐默认字段，返回新对象。所有函数不修改输入行数组和输入视图。

## 4. 筛选语义

- 状态：叶子任务按 `task.status` 精确匹配。
- 负责人：按 `task.assignee` 去空格后精确匹配，忽略大小写。
- 日期范围：叶子任务的 `[startDate, endDate]` 与筛选区间求交集，边界当天包含在内；缺少日期的叶子在有日期筛选时排除。
- 文本搜索：在名称、描述、负责人三个字段中做不区分大小写的子串匹配。
- 父任务：汇总行由子任务派生日期，日期筛选只判断叶子；父行只要有一个可见后代就保留，没有可见后代时移除。
- 空筛选返回原顺序的新数组。

## 5. 排序语义

- 使用装饰下标做稳定排序，相同键保持输入顺序。
- 状态顺序固定为进行中、第三方、已完成。
- 进度按数值比较。
- 名称、负责人、日期使用本地化字符串比较。
- 空负责人和空日期固定排在最后，不随升降序翻转。
- 未选择排序字段时只复制数组，不改变顺序。

## 6. 分组语义

- `groupRows(rows, 'none')` 返回副本。
- 按状态或负责人分组时，组顺序按首次出现顺序，组内保持输入顺序。
- 分组标题行结构：

```js
{
  id: '__group__status__inProgress',
  isGroupHeader: true,
  groupBy: 'status',
  groupKey: 'inProgress',
  label: '进行中',
  count: 3,
  task: null
}
```

- 负责人为空时归入「未分配」。
- 表格渲染整行标题，时间轴对应位置留空，两栏行数一致。
- 表格点击、双击、右键和键盘导航跳过分组行，Shift 范围选择不包含分组行。

## 7. 保存与恢复

- 已保存视图写入 `settings.views`，结构为 `View[]`。
- 当前视图 id 写入 `settings.activeViewId`。
- 启动时 `Workbench.initViews()` 读取 `activeViewId`，恢复对应视图并同步工具栏控件。
- 保存按钮打开命名弹窗；已有活动视图时更新该视图，否则新建。
- 重命名只修改名称。删除会移除视图并清空 `activeViewId`，当前筛选条件保留。
- 选择「未保存视图」恢复默认视图。
- 列配置仍独立存放在 `settings.columns`。

## 8. 工具栏

`Workbench` 在 `#toolbar` 中注入 `.views-bar`，包含：

- 搜索框
- 筛选弹层：状态、负责人、开始不早于、结束不晚于、清除筛选
- 分组下拉框
- 排序字段下拉框与升降序按钮
- 已保存视图下拉框
- 保存、重命名、删除按钮

筛选弹层用 `hidden` 控制显示，点击外部或再次点击按钮关闭。重命名和删除在未选中已保存视图时禁用。

## 9. 导出

`js/export.js` 提供数据构建函数和写文件函数。

- `Export.buildViewRows(rows, columns)`：按可见列顺序生成二维数组，分组标题行输出为 `分组：进行中（3）` 并在其余列补空字符串。
- `Export.buildTaskRows()`：保留原有层级任务列表，列与缩进规则不变。
- `Export.buildMilestoneRows()`：保留原有里程碑列表。
- `Export.buildGanttRows()`：保留原有按天甘特图，日期无数据时返回空。
- `Export.buildWorkbook(options)`：返回 `{ filename, sheets, empty }`，sheet 顺序为任务列表、里程碑、甘特图、当前视图。
- `Export.exportToExcel(options)`：缺少 XLSX 时返回 `missing-xlsx`，无日期数据时返回 `empty`，成功时写出 `PMWEB_YYYY-MM-DD.xlsx`。

`App.exportToExcel()` 只负责取当前行、当前可见列并调用 Export，缺少 XLSX 时保留原有提示。

## 10. 测试

- `tests/views.test.js`：状态、负责人、日期边界、文本搜索、空结果、排序稳定性、空值排序、分组标题与顺序、视图序列化、组合应用、输入不可变。
- `tests/export.test.js`：表头列顺序、可见列过滤、筛选结果、分组标题、空数据、层级任务、里程碑、甘特图、工作簿 sheet 顺序、缺少 XLSX 分支。
- `node --check` 覆盖新增与修改的 JS 文件。
- `node tests/run-all.js` 运行全部测试。

## 11. 未覆盖项

- 视图不保存列配置，列顺序和可见性仍由列配置面板单独维护。
- 未保存的临时筛选条件刷新后不保留，只恢复已保存视图。
- 分组只影响展示顺序，不改变父子层级和任务数据。
- 导出「当前视图」sheet 暂不写公式、冻结窗格或单元格样式。
