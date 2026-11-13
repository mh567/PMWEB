# W1 工作台合并后审查与浏览器 Smoke

## 1. 审查范围与环境

| 项 | 内容 |
|----|------|
| 审查分支 | `feat/review-workbench` |
| 基线 | `feat/workbench-integration`，提交 `7957762` |
| 审查日期 | 2026-11-10 |
| 工作目录 | 独立 git worktree |
| Node | v22.23.1 |
| Python | 3.14.4 |
| 浏览器工具 | agent-browser 0.27.0，Chromium |
| 视口 | 1280 × 800，补充 1280 × 700 与 1280 × 577 |

审查对象：

- `docs/design/01-workbench-split.md`
- `docs/acceptance/p0-1.md`
- `js/workbench.js`、`js/grid-pane.js`、`js/timeline-pane.js`、`js/app.js`、`js/drag-manager.js`
- `index.html`、`css/*.css`
- `tests/run-all.js` 及其发现的全部测试文件

本轮未修改业务代码、测试、`progress.md`、`task_plan.md` 或其他文档。只新增本文件。

### 1.1 执行命令

```bash
node tests/run-all.js

python3 -m http.server 8124 --bind 127.0.0.1
agent-browser open http://127.0.0.1:8124/index.html
agent-browser --session vis --headed open http://127.0.0.1:8124/index.html
```

Fixture 注入方式：

```js
const data = await (await fetch('/tests/fixtures/tasks-3-level.json')).json();
localStorage.setItem('pmweb_data', JSON.stringify(data));
location.reload();
```

注入的 JSON 结构与导入路径 `DataStore.importJSON` 迁移后的结果一致，但本轮没有自动化系统文件选择框。涉及导入、导出的结论均标注为未验证。

### 1.2 可见性与测量说明

无头会话的 `document.visibilityState` 为 `hidden`，`requestAnimationFrame` 不触发。滚动同步锁依赖 rAF 释放，因此无头会话下观察到的“左右滚动不一致”不作为产品结论，相关结论全部在 `--headed` 可见会话中复核。

`agent-browser click` 对时间轴中横向跨度很大的行和任务条存在命中偏差。时间轴选中、hover 使用 DOM 事件派发验证应用逻辑；左侧表格点击、分割条拖动、工具栏按钮、弹窗按钮使用真实指针操作验证。

## 2. 自动测试

命令：`node tests/run-all.js`

| 测试文件 | 结果 |
|----------|------|
| `grid.test.js` | 17/17 passed |
| `migration.test.js` | 8/8 passed |
| `row-model.test.js` | 10/10 passed |
| `schema/validate.test.js` | 17/17 passed |
| `smoke.test.js` | 全部通过 |
| `timeline.test.js` | 16/16 passed |
| `workbench.test.js` | 12/12 passed |
| 汇总 | 7/7 test files passed，退出码 0 |

自动测试覆盖了列模型、迁移、行模型、v3 校验、时间轴纯函数、分割条宽度和滚动计算。没有覆盖浏览器事件组合、模式切换滚动、重复监听器、ARIA 和恶意 ID。

## 3. 浏览器 Smoke 结果

### 3.1 通过的检查

| 检查 | 实际结果 |
|------|---------|
| 页面加载 | `index.html` 返回 200，13 个脚本与 9 个样式表全部加载 |
| 控制台与资源 | 干净可见会话中 `errors` 为空、`console` 为空、无 4xx/5xx |
| 三层 fixture 行数 | 左侧 27 行，右侧 27 行 |
| 三层 fixture 顺序 | 两侧 `data-task-id` 逐行一致，首行 `root-web`，末行 `app-store-review` |
| 三层 fixture 深度 | 行 `data-depth` 覆盖 0、1、2 |
| 父任务与叶子 | 11 个汇总条，16 个叶子任务条；父任务有独立行 |
| 状态徽标 | `status-inProgress`、`status-thirdParty`、`status-done` 三种均出现 |
| 200 行 fixture 行数 | 左右各 200 行 |
| 200 行 fixture 顺序 | 首行 `t200-root-01`，末行 `t200-leaf-08-4-5`，两侧完全一致 |
| 200 行结构 | 40 个汇总条，160 个叶子任务条 |
| 行高 | 左右首行、末行均为 40px |
| 表头高度 | `#grid-header` 与 `#timeline-header` 均为 64px |
| 最大滚动高度 | 默认列宽下两侧均为 7593，客户端高度均为 407 |
| 垂直滚动同步 | 左滚 5000、右滚 1200、左滚到底、右滚到顶，两个方向均保持 `scrollTop` 相等；可见行 ID 一致 |
| 水平滚动独立 | 左滚 300 时右侧仍为 0；右滚 500 时左侧仍为 300 |
| 表头横向同步 | 左侧 `translateX(-300px)`，右侧 `translateX(-500px)`，与各自 `scrollLeft` 一致 |
| 选中联动 | 点击左行后右侧行与汇总条选中；右侧点击后左侧行选中；任意时刻只有一个任务选中 |
| hover 联动 | 左行 hover 时右侧行与任务条高亮；右行 hover 时左侧行高亮；移出后清除 |
| 分割条鼠标拖动 | 从 320 拖到 520，`aria-valuenow` 同步为 520，写入 `settings.gridWidth` |
| 分割条双击 | 恢复到 560 |
| 分割条键盘 | 聚焦后 `ArrowRight` 560 → 576，`End` 到 624，`Home` 到 320 |
| 分割条持久化 | 设为 576 后刷新，宽度与 `aria-valuenow` 均为 576 |
| 分割条约束 | 下限 320，上限 1040 工作台宽度的 60%，即 624 |
| 日历切换 | 点击日历后时间轴面板出现 42 个日期格，左侧 27 行保留，时间轴表头清空 |
| 日历粒度 | 日、周、月按钮切换后日历仍在，左侧行数保持 27 |
| 切回甘特图 | 左右各 27 行且顺序一致，选中态保留 |
| 新建任务弹窗 | 标题“新建任务”，3 个状态下拉项，名称输入框自动聚焦 |
| 新建任务保存 | 行数 27 → 28，两侧行数一致，新任务行、时间轴行、任务条均出现，状态栏更新 |
| 双击编辑 | 双击左行打开“编辑任务”，保存后左侧名称与右侧任务条 title 同步更新 |
| 折叠 | 折叠 `root-web` 后左右各 18 行，展开后恢复 27 行，顺序一致 |
| 隐藏选中 | 折叠包含选中任务的分组后可见选中数为 0，`ViewState` 仍保留 ID；展开后选中恢复 |
| 筛选 | 关闭“已完成”后左右各 11 行，剩余行中无 `status-done`；恢复后 27 行 |
| 日历选中 | 将日历切到 2025-11 后点击任务条，左侧对应行选中，同一任务的 12 个日期条同时选中 |
| 今日待办 | 构造当天里程碑后出现 1 个待办项，`role=button`、`tabindex=0`，侧栏宽 240px，项宽 215px、高 67px |
| 列宽一致性 | 表头与行单元格宽度完全一致：260 / 110 / 100 / 110 / 110 / 120 / 120 / 220 |
| 左右行起点 | 两侧首行 `y=128`，行起点一致 |
| 汇总条与任务条 | 汇总条 `top=14`、高 12；叶子条 `top=10`、高 20；均在 40px 行内 |
| 工具栏 | 1280px 下 `scrollWidth` 等于 `clientWidth`，无溢出；按钮高度 36px |
| 状态徽标尺寸 | 高度 21px，40px 行内垂直居中 |

### 3.2 部分通过或发现问题的检查

| 检查 | 实际结果 | 说明 |
|------|---------|------|
| 时间轴表头内部对齐 | 外部高度 64px，内部两行共 64px，客户高度 63px | 第二行底部 1px 被裁切，见 L2 |
| 分割条鼠标点击后键盘 | 点击后焦点留在 `BODY`，方向键无效；`focus()` 后方向键有效 | `pointerdown` 阻止默认行为，见 L3 |
| 日历模式滚动 | 可见会话中滚动到 4000 后切日历，两侧被重置为 0，切回甘特仍为 0 | 工作位置丢失，见 L1 |
| 键盘行导航 | 行有 `tabindex=0`，`ArrowDown`、`Enter` 均无效果 | 200 行时形成 200 个 Tab 停靠点，见 M4 |
| 时间轴任务条键盘 | `Enter` 只触发选中，不打开编辑；`Delete` 无反应 | 与设计文档第 16 节不一致，见 M4 |
| 弹窗在矮视口 | 1280 × 577 时弹窗高 734px，顶部 y=-78，取消按钮 y=594 到 630，超出视口 | 鼠标无法点击，Escape 也不关闭，见 M3 |
| reduced motion | `prefers-reduced-motion: reduce` 下 `.btn` 过渡仍为 0.15s | `base.css` 该媒体查询被未闭合注释吞掉，见 M6 |
| 200 行性能 | 42,367 个 DOM 节点，36,200 个时间轴网格单元，全量重渲染 62 到 93ms | 每次折叠、筛选、修改都全量重建，见 M5 |

### 3.3 未验证项

- 通过系统文件选择框导入 JSON，以及导出 JSON、导出 Excel 的文件内容和回导。
- 时间轴任务条拖动、左右缩放、里程碑拖动。
- 时间轴任务条真实双击编辑。本轮验证的是左侧行双击。
- 右键菜单中的菜单项动作。菜单打开、构建次数已验证，未执行“设置颜色”“删除任务”等动作。
- 日历上个月、下个月按钮的真实点击。月份通过 `CalendarView.currentMonth` 设置。
- `Shift+F10`、`Delete` 确认、完整 Tab 顺序和键盘焦点环的视觉表现。
- Chrome 之外的浏览器、Safari、窄屏 1080/860/720 断点。
- localStorage 接近配额时的表现。
- 长时间使用后的监听器数量与内存增长。

## 4. 问题列表

严重程度定义：高为安全或数据可信度问题；中为明显影响可用性、可访问性或性能的问题；低为边界、维护性或轻微视觉问题。

### 高

#### H1 导入数据中的任务 ID 与里程碑 ID 未转义，存在存储型 XSS

位置：

- `js/calendar-view.js:69`，任务 ID 直接拼入 `innerHTML` 的 `data-task-id`
- `js/calendar-view.js:77`，里程碑 ID 直接拼入 `data-milestone-id`
- `js/tree-view.js:134`，隐藏任务树的 `data-task-id` 直接拼接
- `js/app.js:96`，今日待办的 `data-milestone-id` 直接拼接
- 根因相关：`js/store.js:61-80` 的导入只做版本迁移，不调用已有的 `tests/schema/validate.js`；`js/app.js:292` 直接使用导入结果

复现：

1. 将一条任务的 `id` 设为 `x"><img src=x onerror="window.__xss=1">`，写入 `pmweb_data` 后刷新。
2. 切换到日历。日历渲染后 `window.__xss` 变为 `1`，时间轴内出现 30 个注入的 `img` 节点。
3. 在甘特模式下调用 `TreeView.render()`，隐藏的 `#tree-container` 内出现 4 个注入的 `img`，500ms 后 `window.__xssTree` 变为 `1`。
4. 本地存储中的等价数据可以通过“导入 JSON”进入同一路径。

实际结果：注入的 `<img onerror>` 被执行。任务名称、描述、日期、颜色都有转义或白名单校验，ID 没有。

建议：

- 在导入流程接入 `validateData`，并对 ID 增加字符白名单，例如 `^[A-Za-z0-9_-]{1,128}$`。
- 所有 `innerHTML` 中的 ID 统一走 `escapeHtml`，包括当前未转义的四处。
- 更好的做法是 ID 只通过 `dataset` 或 DOM API 赋值，不参与 HTML 字符串拼接。

#### H2 任务 ID 直接拼入 CSS 选择器，导致语法错误和选中不同步

位置：

- `js/timeline-pane.js:295`、`299`、`312`、`316`
- `js/calendar-view.js:168`

复现：

1. 写入 ID 为 `x"><img src=x onerror="window.__xss=1">` 的任务后刷新。
2. 点击左侧该任务行。
3. `Workbench.setSelected` 先更新左侧行，随后 `TimelinePane.updateSelection` 抛出 `SyntaxError: not a valid selector`。
4. 左侧行显示选中，时间轴对应行和任务条没有选中，`ViewState.selectedTaskId` 已更新。

实际结果：事件监听器内抛错，选中态左右不一致。ID 为 `x2"] , .gantt-bar` 时同样抛错，并且该形状的选择器可能匹配到非目标任务。

建议：

- 使用 `CSS.escape(taskId)` 构造选择器，或按 `dataset.taskId` 遍历过滤。
- 优先复用 `RowModel.byId`，通过行索引定位 DOM，避免属性选择器拼接。
- 在 `setSelected` 和 `updateSelection` 外层增加异常隔离，避免一个面板失败阻断另一个面板。

### 中

#### M1 事件被多层重复处理，点击、hover、双击、右键各执行两次

位置：

- `js/grid-pane.js:321-332` 在 `#grid-body` 上绑定 click、dblclick、contextmenu、mouseover、mouseout
- `js/grid-pane.js:343-380` 的 `_onClick`、`_onDoubleClick`、`_onContextMenu`、`_onMouseOver` 调用 `_dispatchSelected`、`_setHover`
- `js/workbench.js:520-558` 在 `#workbench` 根节点再次处理 click、mouseover、mouseout
- `js/app.js:36-66` 在 `#workbench` 根节点再次处理 dblclick、contextmenu
- `js/timeline-pane.js:464-590` 自身又绑定 click、dblclick、mouseover、mouseout、contextmenu

实测：

- 单次左行点击，`Workbench.setSelected` 调用 2 次。
- 单次行 hover，`Workbench.setHovered` 调用 2 次。
- 单次行双击，`App.showEditTask` 调用 2 次。
- 单次行右键，`TreeView.showContextMenu` 调用 2 次，菜单被构建两次。第一次来自 `GridPane._buildMenuItems`，第二次来自 `TreeView._buildTaskMenuItems`，最终显示的是第二份菜单，第一份代码实际不可见。

影响：200 行时每次点击、hover 都要额外遍历一次全部行，弹窗被重复打开、菜单重复构建，后续任何一侧新增监听器都会放大重复行为。

建议：

- 明确单一所有者。建议 GridPane 和 TimelinePane 负责本面板事件，Workbench 只负责跨面板同步，App 只负责工具栏和全局快捷键。
- 删除 App 根节点上的 dblclick 和 contextmenu 网格处理，或让面板事件调用 `stopPropagation`。
- 删除 Workbench 根节点上的 click、mouseover、mouseout，改由两个面板各自派发。

#### M2 全量重渲染丢失键盘焦点

位置：

- `js/workbench.js:236-254`，`render()` 每次重建两个面板
- `js/grid-pane.js:202-214`，`renderBody()` 直接替换 `innerHTML`
- `js/timeline-pane.js:212-245`，`render()` 重建表头与内容

复现：

1. 导入 200 行数据。
2. 聚焦第 50 行。
3. 调用 `Workbench.render()`，或触发折叠、筛选、修改状态。
4. `document.activeElement` 变为 `body`。

影响：折叠、筛选、右键改状态、拖拽结束等操作都会让键盘用户失去当前位置。选中态会通过 `_syncSelectionHover` 恢复，焦点不会。

建议：

- 渲染前记录 `document.activeElement` 的任务 ID 和单元格类型，渲染后按任务 ID 恢复焦点，参考 `TreeView.render` 在 `js/tree-view.js:89-112` 的做法。
- 折叠、状态切换等局部变化优先做定向更新，减少整表重建。

#### M3 任务弹窗在矮视口溢出，底部按钮不可达，Escape 不关闭

位置：

- `css/components.css:397-421`，`.modal-overlay` 固定定位、`align-items:center`、无 `overflow`
- `css/components.css:412-421`，`.modal-box` 没有 `max-height` 和内部滚动
- `js/modal.js` 没有 keydown 处理，没有 Escape 关闭、焦点陷阱和焦点恢复

复现：

1. 将视口设为 1280 × 577。
2. 点击“+ 新建任务”。
3. 弹窗高度 734px，顶部 y=-78，底部 y=655。
4. “取消”按钮位于 y=594 到 630，完全在视口之外，无滚动方式可达。
5. 真实点击取消按钮无效；Escape 也不关闭。

补充测量：

- 1280 × 700 时弹窗顶部 y=-17，取消按钮仍可见，标题区域被裁。
- 1280 × 900 时按钮可见，真实点击可关闭。

影响：常见 720p 笔记本浏览器视口高度约 600 到 650，新建和编辑任务无法用鼠标提交或取消。

建议：

- `.modal-overlay { overflow:auto; }`，`.modal-box { max-height: calc(100vh - 32px); overflow:auto; }`。
- 增加 Escape 关闭、`role="dialog"`、`aria-modal="true"`、`aria-labelledby`、焦点陷阱与关闭后焦点恢复。

#### M4 键盘操作与 ARIA 缺口

位置：

- `js/grid-pane.js:228`，行设置为 `tabindex="0"`，但没有行级 keydown 处理
- `js/grid-pane.js:253-265`，展开器是 `span role="button"`，不可聚焦，没有 `aria-expanded`
- `index.html:61-66`，分割条缺少 `aria-valuemax`；`js/workbench.js` 的 `_applyGridWidth` 只更新 `aria-valuenow`
- `js/grid-pane.js:192`、`208`，表头行、行组和单元格没有 `role="grid"` 祖先，`rowgroup` 直接嵌套 `rowgroup`
- `js/timeline-pane.js:409-414`，任务条 `data-keyboard-activate`，Enter 通过 `js/tree-view.js:554-563` 触发 `click`，只选中不编辑
- 设计文档第 16 节要求的 `Shift+F10`、左右键折叠、Delete 删除确认均未实现

实测：

- 行聚焦后 `ArrowDown`、`Enter` 不改变选中，也不打开编辑。
- 展开器 `tabIndex=-1`、`aria-expanded=null`，键盘无法折叠。
- 200 行数据产生 200 个行级 Tab 停靠点，分割条排在这些行之后。
- 分割条 `aria-valuemax` 为 `null`。
- 任务条 Enter 后 `modal=false`，Delete 后任务数不变。

建议：

- 行容器使用 `tabindex=0` 并配合 roving tabindex，方向键移动选中，聚焦行滚入视图。
- 展开器改为可聚焦按钮，补充 `aria-expanded` 和键盘 Enter、Space。
- 表格使用 `role="grid"`、`role="row"`、`role="gridcell"` 的完整结构，列头与单元格建立关联。
- 分割条补充并动态更新 `aria-valuemax`，或在宽度变化时同步设置。
- 任务条 Enter 打开编辑，Delete 走确认流程。

#### M5 200 行全量渲染开销偏高，缺少虚拟化

位置：

- `js/grid-pane.js:202-214`，每次渲染重建全部行与单元格
- `js/timeline-pane.js:347-372`，每行渲染全部日期单元格
- `js/workbench.js:236-254`，每次数据变化调用整表渲染

实测：

- 200 行时 DOM 总节点 42,367。
- 时间轴网格单元 36,200 个，表格单元格 1,600 个。
- `Workbench.render()` 连续 5 次耗时 92.6、64.1、62.4、62.7、61.6ms。
- 每次折叠、筛选、状态修改、拖拽结束都会触发同样量级的重建。
- 隐藏的旧 `TreeView` 在筛选变化时仍会渲染 201 行（`js/tree-view.js:89-112`）。

影响：200 行已经超过 60fps 的单帧预算，后续 P0-2 列显隐、P0-3 行内编辑和拖拽会进一步放大。

建议：

- 时间轴按可视窗口渲染日期单元格，或按日期列复用节点。
- 表格引入可视区域渲染，至少让 `render` 分片执行。
- 折叠、选中、hover 使用定向更新，避免整表 `innerHTML`。
- 合并后删除隐藏 `TreeView` 的渲染调用，或在筛选时跳过。

#### M6 `base.css` 未闭合注释导致 reduced motion 规则失效

位置：

- `css/base.css:112-135`，第 112 行打开注释后没有 `*/`
- 对比 `css/timeline.css` 中存在一个有效的 `prefers-reduced-motion` 规则

实测：

- 枚举 CSSOM 时只有 `timeline.css` 包含 `prefers-reduced-motion` 媒体规则，`base.css` 的规则不存在。
- 在 `prefers-reduced-motion: reduce` 下，`.btn` 的 `transitionDuration` 仍为 `0.15s`。

影响：开启减少动效的用户仍会看到按钮、待办项、弹窗按钮、甘特条的过渡动画。

建议：

- 补回 `css/base.css` 第 112 行注释的标题行和结束标记，例如补一行 `*/`。
- 增加 CSS 注释配对检查，避免拆分样式时再次出现同类问题。

### 低

#### L1 切换到日历再切回甘特会丢失垂直滚动位置

位置：

- `js/workbench.js:317-325`，`setTimelineMode` 只切换类名并调用 `render`
- `js/workbench.js:236-254`，`render` 不重新同步两侧 `scrollTop`
- `js/timeline-pane.js:212-245`，日历内容较短时会钳制右侧滚动位置

复现（可见会话）：

1. 导入 200 行，左侧滚动到 4000，两侧 `scrollTop` 均为 4000。
2. 点击“日历”，两侧变为 0，右侧日历内容不可滚动。
3. 点击“甘特图”，两侧仍为 0。

影响：用户从日历返回后回到列表顶部，工作位置丢失。无头会话下因 rAF 暂停还会表现为左右可见行不一致，该现象不作为产品结论。

建议：

- 进入日历前记录左侧 `scrollTop`，切回甘特并在渲染后恢复，再主动同步一次两侧滚动。
- 或者让日历模式下的时间轴容器使用独立滚动域，不参与网格的垂直同步。

#### L2 时间轴表头第二行底部被裁 1px

位置：

- `css/timeline.css:5`，表头容器高度 64px，包含 1px 下边框
- `css/timeline.css:20-22`，每个表头行 32px，两行合计 64px
- `css/workbench.css:43`，全局盒模型为 `border-box`

实测：`#timeline-header` 客户高度 63px，滚动高度 64px，内容溢出 1px；左侧表头客户高度 63px。

影响：时间轴表头第二行的底边被裁切，左右表头的文字基线有轻微偏差。数据行起点仍同为 64px，不影响行对齐。

建议：把表头内容高度改为 `calc(var(--pane-header-height) - 1px)`，或让两行分别为 31.5px，或把边框改为 `box-shadow` 不占高度。

#### L3 点击分割条不会获得焦点，随后方向键无效

位置：

- `js/workbench.js:427-443`，`pointerdown` 中调用 `event.preventDefault()`

复现：真实点击分割条后，`document.activeElement` 为 `BODY`，按方向键宽度不变；调用 `focus()` 后 `ArrowRight` 可以调整到 576。

影响：鼠标用户点击分割条后无法立即用键盘微调，需要先 Tab 到分割条。

建议：在 `pointerdown` 中调用 `splitter.focus({ preventScroll: true })`，或仅对文本选择做限制，不使用 `preventDefault` 阻断焦点。

#### L4 `GridPane.init` 默认元素 ID 与 `index.html` 不一致

位置：

- `js/grid-pane.js:167-168`，默认查找 `grid-pane-header` 和 `grid-pane-body`
- `index.html:38-39`，实际 ID 为 `grid-header` 和 `grid-body`

影响：当前 `Workbench.init` 显式传入元素，因此线上未触发；单独调用 `GridPane.init()` 或替换布局时会静默拿不到元素。现有测试也显式传入元素，未覆盖此路径。

建议：统一默认 ID，或把 `header`、`body` 设为必填参数并在缺失时抛错。

#### L5 Workbench 内置 fallback 面板与正式实现重复

位置：

- `js/workbench.js:61-180`，`_WorkbenchFallbackGrid` 与 `_WorkbenchFallbackTimeline`
- `css/workbench.css:102-260`，fallback 行、表头、状态样式

影响：在 `index.html` 的脚本顺序下，`GridPane` 与 `TimelinePane` 始终存在，fallback 在生产路径不可达。它复制了行渲染、选中、hover 和表头逻辑，但与正式实现列、类名、交互不同，后续修改容易分叉。属于文件所有权和维护性问题。

建议：合并完成后删除 fallback，或仅在开发开关下加载，并让测试覆盖正式实现。

#### L6 单侧横向滚动条导致时间轴底部 10px 无法到达

位置：

- `js/workbench.js:495-504`，滚动同步按目标最大滚动高度钳制
- `css/base.css:96-110`，自定义滚动条高度 10px

复现（可见会话）：

1. 隐藏除“任务名称”外的列，使左侧内容宽 549，小于面板宽度，左侧没有横向滚动条。
2. 左侧客户高度 518，右侧客户高度 508，两侧最大滚动高度分别为 7482 和 7492。
3. 将右侧滚到底，被同步拉回 7482，最后 10px 内容不可见。

影响：行仍然对齐，时间轴最后一行底部有 10px 不可达。窗口足够宽导致左侧列不再溢出时也会出现。

建议：两侧统一设置 `scrollbar-gutter: stable`，或给两个面板预留相同高度的滚动条空间，避免客户端高度差。

#### L7 隐藏标签页中滚动同步锁不会释放

位置：

- `js/workbench.js:495-518`，`_syncing` 依赖 `requestAnimationFrame` 释放

实测：`document.visibilityState` 为 `hidden` 时 rAF 不触发，`_syncing` 在 500ms 后仍为 `true`，`_rafId` 保持在 1，所有滚动同步调用直接返回。

影响：前台可见时无影响。后台标签页中如果发生程序化滚动，锁会一直保持到页面重新可见，期间的滚动同步被忽略。

建议：增加 `visibilitychange` 时强制释放锁，或使用 `setTimeout` 作为兜底，与 rAF 竞速。

### 其他观察

- `#grid-pane` 的 `border-right` 与 `#workbench-splitter` 的 `border-left` 相邻，形成 2px 视觉分隔，与设计中 8px 分割条不一致，属于轻微视觉冗余。
- `TimelinePane._syncLegacyGantt` 在 `js/timeline-pane.js:456-462` 直接写入 `GanttView.cells`、`cellWidth`、`granularity`。旧甘特图已不再渲染，但状态仍被跨模块修改，归入 L5 的所有权问题。
- 右键菜单在 `GridPane` 与 `TreeView` 中各有一份实现，菜单项顺序和内容不同。当前 `GridPane` 版本被覆盖，属于 M1 的组成部分。

## 5. P0-1 验收清单对照

| 验收项 | 结论 | 依据 |
|--------|------|------|
| 数据版本 v3，旧数据补字段 | 通过（自动测试） | `migration.test.js` 8/8 |
| 统一 RowModel，两栏不再各自展平 | 通过 | 两栏行数与顺序一致，`Workbench.render` 只调用一次 `RowModel.build` |
| 左右行数、顺序、行高一致 | 通过 | 27/27、200/200，行高均 40px |
| 垂直滚动同步，水平滚动独立 | 通过（默认列宽、可见会话） | 双向 scrollTop 相等，横向互不影响 |
| 分割条可拖动、键盘调整、持久化 | 通过，附 L3 | 320 到 624，双击 560，刷新保持 |
| 选中和 hover 双向同步 | 通过，附 M1 | 双向高亮，单任务选中 |
| 父任务独立行和汇总条 | 通过 | 11 个三层汇总条，40 个 200 行汇总条 |
| 导入、导出、拖拽、里程碑、日历不回归 | 部分通过 | 日历通过；导入导出和任务条拖拽未验证 |
| 200 行无明显错位和卡顿 | 对齐通过，性能存疑 | 无错位；62 到 93ms 全量渲染，见 M5 |
| 设计文档、任务计划、进度日志更新 | 不在本轮范围 | 未修改 |

键盘与可访问性对应验收项（4.4、4.9）部分失败：分割条键盘可用，行键盘导航、折叠、Enter 编辑、Delete 确认、`Shift+F10` 未实现。

## 6. 结论

W1 的核心目标已经达到：两栏共享行模型、行数顺序一致、垂直滚动同步、选中与 hover 双向联动、分割条、父级汇总条、日历切换和编辑弹窗在正常视口下都能工作。合并后在功能交互层面可以继续推进 P0-2。

建议在继续之前优先处理 H1、H2、M1、M2、M3：

- H1 与 H2 都来自不可信的 ID。修复应同时覆盖导入校验、渲染转义和选择器构造。
- M1 的重复监听器会持续放大后续功能的事件副作用，越晚处理成本越高。
- M2 和 M3 直接影响键盘用户与常见笔记本视口下的可用性。
- M5 的性能数字说明 200 行已经接近全量重渲染的上限，进入 P0-2 前应确定虚拟化或定向更新策略。
