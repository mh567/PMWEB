# P1-2 时间轴依赖箭头与进度填充设计

## 1. 结论

依赖数据沿用 P1-1 的 `{ id, source, target, type, lag }` 模型，存放在 `TaskManager.data.links`。本阶段新增 `js/arrows.js` 负责纯几何计算，`TimelinePane` 在 `.timeline-content` 内追加一层 SVG overlay 绘制箭头，任务条内增加进度填充层。箭头不进入行模型，不改变行高和滚动计算。

## 2. 范围

包含：

- `index.html` 挂载 `js/links.js`、`js/arrows.js`，顺序在 `js/timeline-pane.js` 之前。
- `TaskManager` 依赖 CRUD：`getLinks`、`addLink`、`updateLink`、`deleteLink`，删除任务时级联删除依赖。
- 时间轴箭头渲染与命中删除。
- 任务条右键菜单的“添加依赖”和“删除依赖”。
- 叶子任务条进度填充。

不包含：

- 进度汇总条计算，留给 Progress 模块。
- 自动排期、关键路径、拖拽连线创建依赖。
- 依赖数据在导入导出中的可视化编辑。

## 3. 脚本顺序

```html
<script src="js/links.js"></script>
<script src="js/arrows.js"></script>
<script src="js/timeline-pane.js"></script>
```

`links.js` 只依赖 `Date`，`arrows.js` 为纯函数，二者都不依赖 DOM，保持经典脚本和 `file://` 双击可运行。

## 4. 数据写入

### 4.1 TaskManager

| 方法 | 返回 | 说明 |
|------|------|------|
| `getLinks()` | `Link[]` | 返回浅拷贝，避免外部直接改数组 |
| `getLink(id)` | `Link \| null` | 按 id 查找 |
| `addLink(source, target, type, lag)` | `{ ok, code, reason, link }` | 先 `Links.canAdd`，再校验任务存在和 lag 整数 |
| `updateLink(id, updates)` | `{ ok, code, reason, link }` | 合并后重新执行 `canAdd`，排除自身后检查重复和成环 |
| `deleteLink(id)` | `boolean` | 不存在时返回 `false` |

失败原因沿用 `Links` 的错误码：`SELF_REFERENCE`、`DUPLICATE_EDGE`、`CYCLE`、`INVALID_TYPE`、`INVALID_LAG`、`INVALID_ENDPOINT`、`MISSING_SOURCE`、`MISSING_TARGET`。调用方把 `reason` 显示在弹窗内联错误区。

`deleteTask` 在删除任务和子任务的同时，过滤掉 `source` 或 `target` 落在删除集合中的依赖。

### 4.2 保存与校验

所有写入最终调用 `DataStore.save`，`TaskManager._buildIndex` 不重建 links。`DataStore.load` 的 v3 校验只要求 `links` 是数组，因此新增依赖前必须在 `TaskManager` 内完成端点和成环检查。

## 5. 箭头几何

`js/arrows.js` 导出 `Arrows`：

```js
Arrows.box(rowIndex, left, width, options) -> Box
Arrows.endpoints(sourceBox, targetBox, type) -> Geo | null
Arrows.path(geo, stub) -> string
Arrows.headPoints(geo, size) -> string
Arrows.layout(links, boxes, options) -> Arrow[]
```

`Box` 为 `{ left, top, width, height, rowIndex }`，`left` 是时间轴横坐标，`top` 是 `rowIndex * 40 + 条内偏移`。叶子条用 `top = 10`、`height = 20`，汇总条用 `top = 14`、`height = 12`。

四种依赖类型的出边和入边：

| 类型 | 出边 | 入边 | 目标约束字段 |
|------|------|------|--------------|
| `FS` | 源右边缘 | 目标左边缘 | `startDate` |
| `SS` | 源左边缘 | 目标左边缘 | `startDate` |
| `FF` | 源右边缘 | 目标右边缘 | `endDate` |
| `SF` | 源左边缘 | 目标右边缘 | `endDate` |

箭头纵向锚定在任务条中心线。路径为正交折线：

```text
起边短支（STUB = 12）
  -> 行间中位通道
  -> 入边外侧短支
  -> 目标边缘
```

入边外侧点使用 `x2 - entryDir * STUB`，保证箭头从条外指向条边缘，不会穿过任务条。`headPoints` 生成三角形顶点，方向由 `entryDir` 决定。

`layout` 跳过缺失端点、自引用和非法类型，不修改 `links` 与 `boxes`。

## 6. SVG overlay

`TimelinePane._renderBody` 在行渲染完成后追加：

```html
<svg class="dep-arrows" width="..." height="..." viewBox="...">
  <g class="dep-arrow" data-link-id data-source data-target>
    <path class="dep-arrow-hit" d="..."></path>
    <path class="dep-arrow-line dep-arrow-FS" d="..."></path>
    <polygon class="dep-arrow-head" points="..."></polygon>
  </g>
</svg>
```

约束：

- SVG 绝对定位在 `.timeline-content` 内，宽高等于内容宽和 `rows.length * 40`，随横向滚动自然移动。
- 容器 `pointer-events: none`，只有 `.dep-arrow-hit` 设置 `pointer-events: stroke`，任务条点击不被阻挡。
- 命中路径宽 12px，视觉线宽 1.4px，二者分离。
- 颜色使用 `--color-slate-light`，选中或 hover 关联任务时切换为 `--color-action-blue`。
- 覆盖层 `z-index: 6`，位于行背景和任务条之上，`today-line` 之下不影响。

无依赖或所有端点不可见时返回空字符串，不创建 SVG。

## 7. 交互

### 7.1 添加依赖

任务条右键菜单新增“添加依赖”。弹窗通过 `ModalManager.open` 构造，包含：

- 前置任务：只读显示当前任务名称。
- 后置任务：下拉选择其他任务。
- 依赖类型：`FS`、`SS`、`FF`、`SF`。
- lag：整数输入框，正则 `^-?\d+$` 校验。
- 内联错误区 `#modal-link-error`，显示 `TaskManager.addLink` 的 `reason`。

提交成功后关闭弹窗并调用 `App.renderAll()`，箭头随全量重渲染出现。

### 7.2 删除依赖

两种入口：

- 点击箭头命中路径，或右键箭头，走 `App.deleteLink(linkId)` 确认删除。
- 任务条右键“删除依赖”，弹窗列出与该任务相关的所有依赖，逐条删除。

删除后同样 `App.renderAll()`。箭头点击在 `TimelinePane._onClick` 内 `stopPropagation`，不会同时选中任务。

### 7.3 高亮

`updateSelection` 和 `updateHover` 分别给相关 `.dep-arrow` 加 `selected` 和 `hovered` 类，CSS 只改描边和箭头填充，不重渲染。

## 8. 进度填充

叶子任务条内部新增：

```html
<span class="gantt-bar-progress" style="width:40%"></span>
```

- 绝对定位在任务条内，`left: 0; top: 0; bottom: 0`，宽度等于 `task.progress`。
- 不改变任务条高度、位置和 `data-task-id`。
- `progress` 缺失按 0，越界钳制到 0 到 100，小数四舍五入。
- 汇总条不渲染进度层，父任务进度仍由 Progress 模块后续接入。
- 标签 `.gantt-bar-label` 提升 `z-index`，保持文字在填充层之上。

## 9. 测试

- `tests/arrows.test.js`：盒子坐标、四种类型端点、四种路径、非法类型、缺失端点、空 links、输入不可变。
- `tests/timeline.test.js`：进度填充宽度、百分比钳制、汇总条无填充、依赖数量决定箭头数量、缺失端点跳过、空 links 不渲染。

命令：

```bash
node --check js/arrows.js
node tests/run-all.js
```

## 10. 风险与后续

- 全量重渲染时箭头随之重建，200 行以上成本与现有时间轴一致。
- 行间箭头交叉暂未避让，密集依赖需要后续引入通道分配。
- 汇总条作为依赖端点时使用汇总条中心线，语义正确但视觉高度较窄。
- 父任务进度、关键路径、拖拽连线分别属于 Progress 和后续 P1 阶段。
