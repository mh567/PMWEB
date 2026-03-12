# Gantt 交互改进实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改进甘特图交互体验：任务条右键菜单添加里程碑、拖拽时视觉跟随（ghost 元素）、hover/cursor/点击区域优化。

**Architecture:** 在现有 GanttView + DragManager 架构上增量修改。新增 CSS 样式用于 ghost 元素和 hover 效果。右键菜单复用 TreeView.showContextMenu。DragManager 新增 ghost 创建/销毁逻辑和拖拽阈值。

**Tech Stack:** Vanilla JS, CSS, 单文件 HTML（index.html）

**Spec:** `docs/superpowers/specs/2026-03-12-gantt-interaction-v3-design.md`

---

## File Structure

所有改动在单文件 `index.html` 中：

| 区域 | 行范围（约） | 改动内容 |
|------|------------|---------|
| CSS `.gantt-bar` | 401-426 | 添加 `cursor: grab`，hover 上浮 + 阴影，`min-width: 20px` |
| CSS `.gantt-milestone` | 427-442 | 添加 `cursor: grab`，hover 放大，点击热区扩大 |
| CSS 新增 | ~453 | `.drag-ghost` 样式，`.snap-line` 吸附线样式 |
| GanttView._bindBarEvents | 1542-1585 | 任务条 contextmenu 事件，移除 JS mouseenter/mouseleave |
| DragManager | 1616-1921 | ghost 创建/销毁，拖拽阈值，吸附线 |

---

## Chunk 1: 交互优化

### Task 1: CSS hover 和 cursor 优化

**Files:**
- Modify: `index.html:401-453` (CSS section)

- [ ] **Step 1: 更新 `.gantt-bar` 样式**

找到 `index.html` 中现有 `.gantt-bar` CSS（约第 401 行），替换为：

```css
.gantt-bar {
  position: absolute;
  height: 20px;
  border-radius: 3px;
  top: 8px;
  cursor: grab;
  font-size: 11px;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 6px;
  overflow: hidden;
  white-space: nowrap;
  min-width: 20px;
  transition: transform 0.12s, box-shadow 0.12s;
}
.gantt-bar:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.18);
}
```

关键改动：
- `cursor: pointer` → `cursor: grab`
- `min-width: 4px` → `min-width: 20px`（确保极短任务可点击）
- hover 加 `translateY(-1px)` + `box-shadow` 上浮效果
- 加 `transition` 使 hover 平滑

- [ ] **Step 2: 更新 `.gantt-milestone` 样式**

找到现有 `.gantt-milestone` CSS（约第 427 行），替换为：

```css
.gantt-milestone {
  position: absolute;
  top: 4px;
  width: 20px; height: 20px;
  cursor: grab;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  transform: translateX(-10px);
  color: #E74C3C;
  filter: drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff);
  transition: transform 0.15s;
}
.gantt-milestone::before {
  content: '';
  position: absolute;
  width: 28px;
  height: 28px;
  top: -4px;
  left: -4px;
  border-radius: 50%;
}
.gantt-milestone:hover { transform: translateX(-10px) scale(1.2); }
```

关键改动：
- `cursor: pointer` → `cursor: grab`
- hover 放大为 `scale(1.2)`（与 spec 一致）
- 添加 `::before` 伪元素扩大透明点击热区（视觉不变，实际可点击区域增大）

- [ ] **Step 3: 添加 ghost 和吸附线 CSS**

在 `.gantt-drag-tooltip` CSS 之后（约第 453 行后），添加新样式：

```css
.drag-ghost {
  position: fixed;
  opacity: 0.6;
  pointer-events: none;
  z-index: 9999;
}
.drag-ghost-bar {
  height: 20px;
  border-radius: 3px;
  font-size: 11px;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 6px;
  overflow: hidden;
  white-space: nowrap;
}
.drag-ghost-milestone {
  font-size: 16px;
  color: #E74C3C;
  filter: drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff);
}
.snap-line {
  position: absolute;
  top: 0;
  width: 1px;
  height: 100%;
  background: var(--color-primary);
  opacity: 0.5;
  pointer-events: none;
  z-index: 50;
}
```

- [ ] **Step 4: 移除 GanttView 中任务条的 JS mouseenter/mouseleave**

在 `_bindBarEvents`（约第 1542 行）中，删除这段代码：

```javascript
// 删除这 8 行：
el.addEventListener('mouseenter', function() {
  el.classList.add('highlight');
  TreeView.setHoverHighlight(el.dataset.taskId);
});
el.addEventListener('mouseleave', function() {
  el.classList.remove('highlight');
  TreeView.setHoverHighlight(null);
});
```

CSS `:hover` 已经提供了视觉反馈（上浮 + 阴影），不再需要 JS 控制高亮 class。

注意：保留 `GanttView.highlightBar()` 和 `GanttView.clearHighlight()` 方法，因为 TreeView hover 仍通过 `App.onTaskHovered` 调用它们来做双向高亮。甘特图条自身的 hover 改为 CSS 处理，但从树视图触发的高亮仍需要 JS。

- [ ] **Step 5: 在浏览器中验证**

打开 `index.html`：
- 任务条 hover 应上浮 + 出现阴影
- 里程碑 hover 应放大
- 任务条中间区域 cursor 应为 `grab`
- 任务条两端（5px 内）cursor 应为 `col-resize`（已在 DragManager 中处理）
- 极短任务条（1 天）应至少 20px 宽可点击

- [ ] **Step 6: 提交**

```bash
git add index.html
git commit -m "feat: improve gantt hover feedback and cursor states"
```

---

## Chunk 2: 右键菜单添加里程碑

### Task 2: 任务条右键菜单

**Files:**
- Modify: `index.html:1542-1567` (GanttView._bindBarEvents)

- [ ] **Step 1: 在 `_bindBarEvents` 中为任务条添加 contextmenu 事件**

在 `_bindBarEvents` 方法中，`el.addEventListener('dblclick', ...)` 代码块之后（约第 1567 行后），添加：

```javascript
el.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  e.stopPropagation();
  var taskId = el.dataset.taskId;
  var rect = self.container.querySelector('.gantt-body').getBoundingClientRect();
  var clickX = e.clientX - rect.left + self.container.querySelector('.gantt-body').scrollLeft;
  var dateAtClick = self._xToDate(clickX);
  TreeView.showContextMenu(e.clientX, e.clientY, [
    { label: '添加里程碑', action: function() { App.showAddMilestoneAtDate(taskId, dateAtClick); } }
  ]);
});
```

关键逻辑：
- `e.clientX - rect.left + scrollLeft` 得到相对于甘特图内容区的 X 坐标
- `_xToDate()` 将 X 坐标转换为日期
- 复用 `TreeView.showContextMenu()` 显示菜单
- 点击「添加里程碑」调用现有的 `App.showAddMilestoneAtDate()`，日期预填

- [ ] **Step 2: 在浏览器中验证**

打开 `index.html`：
- 在任务条上右键，应弹出只有「添加里程碑」的菜单
- 点击菜单项，弹出里程碑表单，日期应预填为右键位置对应的日期
- 点击空白处或按 Esc 应关闭菜单
- 里程碑右键菜单（编辑/删除）应不受影响
- 浏览器默认右键菜单应被阻止

- [ ] **Step 3: 提交**

```bash
git add index.html
git commit -m "feat: add milestone via right-click context menu on gantt bars"
```

---

## Chunk 3: 拖拽视觉跟随

### Task 3: DragManager ghost 元素和拖拽阈值

**Files:**
- Modify: `index.html:1616-1921` (DragManager)

- [ ] **Step 1: 在 `_startDrag` 中添加拖拽阈值支持**

修改 `_startDrag` 方法（约第 1689 行），不再立即进入拖拽状态，改为记录待拖拽信息：

将当前的 `_startDrag` 替换为：

```javascript
_startDrag: function(e, type, target, element) {
  // Don't immediately start drag — wait for threshold
  this._pendingDrag = {
    type: type,
    target: target,
    element: element,
    startX: e.clientX,
    startY: e.clientY
  };

  if (type === 'move' || type === 'resize-left' || type === 'resize-right') {
    this._pendingDrag.originalStartDate = target.startDate;
    this._pendingDrag.originalEndDate = target.endDate;
  } else if (type === 'milestone') {
    this._pendingDrag.originalDate = target.date;
  }

  document.body.style.userSelect = 'none';
},
```

- [ ] **Step 2: 修改 `_onMouseMove` 添加阈值检测和 ghost 逻辑**

将整个 `_onMouseMove` 方法替换为：

```javascript
_onMouseMove: function(e) {
  // Phase 1: threshold check
  if (this._pendingDrag && !this.isDragging) {
    var dx = e.clientX - this._pendingDrag.startX;
    var dy = e.clientY - this._pendingDrag.startY;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    // Threshold exceeded — activate drag
    this._activateDrag(this._pendingDrag);
    this._pendingDrag = null;
  }

  if (!this.isDragging) return;

  var deltaX = e.clientX - this.startX;
  var deltaY = e.clientY - this.startY;
  var daysDelta = Math.round(deltaX / GanttView.cellWidth * this._daysPerCell());

  // Update ghost position
  if (this._ghost) {
    if (this.dragType === 'milestone') {
      // Milestone: horizontal only
      this._ghost.style.left = (e.clientX - this._ghostOffsetX) + 'px';
    } else {
      this._ghost.style.left = (e.clientX - this._ghostOffsetX) + 'px';
      this._ghost.style.top = (e.clientY - this._ghostOffsetY) + 'px';
    }
  }

  if (this.dragType === 'move') {
    // Detect vertical drag intent for row merge
    if (Math.abs(deltaY) > 18) {
      this._rowMergeMode = true;
      var barTop = parseFloat(this.dragElement.style.top);
      var targetRowIndex = Math.max(0, Math.round((barTop + deltaY) / 36));
      this._targetRowIndex = targetRowIndex;

      // Highlight target row
      document.querySelectorAll('.gantt-row').forEach(function(row) {
        row.style.background = '';
      });
      var targetRow = document.querySelector('.gantt-row[data-row-index="' + targetRowIndex + '"]');
      if (targetRow) {
        targetRow.style.background = 'rgba(74, 144, 217, 0.1)';
      }
      this.tooltip.textContent = '移动到行 ' + (targetRowIndex + 1);
    } else {
      this._rowMergeMode = false;
      // Clear row highlights
      document.querySelectorAll('.gantt-row').forEach(function(row) {
        row.style.background = '';
      });
      var newStart = this._addDays(this.originalStartDate, daysDelta);
      var newEnd = this._addDays(this.originalEndDate, daysDelta);
      this.tooltip.textContent = newStart + ' ~ ' + newEnd;
      this.dragTarget._tempStart = newStart;
      this.dragTarget._tempEnd = newEnd;

      // Update snap line
      this._updateSnapLine(newStart);
    }
  } else if (this.dragType === 'resize-left') {
    var newStart = this._addDays(this.originalStartDate, daysDelta);
    if (newStart >= this.originalEndDate) return;
    this.tooltip.textContent = '开始: ' + newStart;
    this.dragTarget._tempStart = newStart;
    this._updateSnapLine(newStart);
  } else if (this.dragType === 'resize-right') {
    var newEnd = this._addDays(this.originalEndDate, daysDelta);
    if (newEnd <= this.originalStartDate) return;
    this.tooltip.textContent = '结束: ' + newEnd;
    this.dragTarget._tempEnd = newEnd;
    this._updateSnapLine(newEnd);
  } else if (this.dragType === 'milestone') {
    var newDate = this._addDays(this.originalDate, daysDelta);
    this.tooltip.textContent = newDate;
    this.dragTarget._tempDate = newDate;
    this._updateSnapLine(newDate);
  }

  this.tooltip.style.left = (e.clientX + 12) + 'px';
  this.tooltip.style.top = (e.clientY - 30) + 'px';
},
```

- [ ] **Step 3: 添加 `_activateDrag` 方法（创建 ghost）**

在 `_startDrag` 方法之后，添加新方法：

```javascript
_activateDrag: function(pending) {
  this.isDragging = true;
  this.dragType = pending.type;
  this.dragTarget = pending.target;
  this.dragElement = pending.element;
  this.startX = pending.startX;
  this.startY = pending.startY;
  this._rowMergeMode = false;
  this._targetRowIndex = -1;

  if (pending.type === 'move' || pending.type === 'resize-left' || pending.type === 'resize-right') {
    this.originalStartDate = pending.originalStartDate;
    this.originalEndDate = pending.originalEndDate;
  } else if (pending.type === 'milestone') {
    this.originalDate = pending.originalDate;
  }

  // Create tooltip
  this.tooltip = document.createElement('div');
  this.tooltip.className = 'gantt-drag-tooltip';
  document.body.appendChild(this.tooltip);

  // Create ghost element
  this._createGhost(pending.element, pending.type);

  // Dim original element
  pending.element.style.opacity = '0.3';

  document.body.style.cursor = (pending.type === 'move' || pending.type === 'milestone') ? 'grabbing' : 'col-resize';
},
```

- [ ] **Step 4: 添加 `_createGhost` 方法**

紧跟 `_activateDrag` 方法之后，添加：

```javascript
_createGhost: function(element, type) {
  var rect = element.getBoundingClientRect();
  var ghost = document.createElement('div');
  ghost.className = 'drag-ghost';

  if (type === 'milestone') {
    ghost.innerHTML = '<span class="drag-ghost-milestone">' + element.textContent + '</span>';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
  } else {
    var bgColor = element.style.background || getComputedStyle(element).backgroundColor;
    ghost.innerHTML = '<div class="drag-ghost-bar" style="background:' + bgColor + ';width:' + rect.width + 'px;">' + element.textContent + '</div>';
  }

  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';

  document.body.appendChild(ghost);

  this._ghost = ghost;
  this._ghostOffsetX = this.startX - rect.left;
  this._ghostOffsetY = this.startY - rect.top;
},
```

- [ ] **Step 5: 添加 `_updateSnapLine` 方法**

紧跟 `_createGhost` 之后，添加：

```javascript
_updateSnapLine: function(dateStr) {
  // Remove existing snap line
  if (this._snapLine && this._snapLine.parentNode) {
    this._snapLine.parentNode.removeChild(this._snapLine);
  }

  var ganttBody = document.querySelector('.gantt-body');
  if (!ganttBody) return;

  var x = GanttView._dateToX(dateStr);
  if (x <= 0) return;

  var line = document.createElement('div');
  line.className = 'snap-line';
  line.style.left = x + 'px';

  var rowContainer = ganttBody.firstElementChild;
  if (rowContainer) {
    rowContainer.appendChild(line);
    this._snapLine = line;
  }
},
```

- [ ] **Step 6: 修改 `_cleanup` 方法清理 ghost 和 snap line**

将现有 `_cleanup` 方法（约第 1829 行）替换为：

```javascript
_cleanup: function() {
  this.isDragging = false;
  this.dragType = null;
  this._pendingDrag = null;

  // Restore original element opacity
  if (this.dragElement) {
    this.dragElement.style.opacity = '';
  }
  this.dragElement = null;
  this.dragTarget = null;

  // Remove ghost
  if (this._ghost && this._ghost.parentNode) {
    document.body.removeChild(this._ghost);
  }
  this._ghost = null;

  // Remove snap line
  if (this._snapLine && this._snapLine.parentNode) {
    this._snapLine.parentNode.removeChild(this._snapLine);
  }
  this._snapLine = null;

  // Remove tooltip
  if (this.tooltip && this.tooltip.parentNode) {
    document.body.removeChild(this.tooltip);
  }
  this.tooltip = null;

  document.body.style.userSelect = '';
  document.body.style.cursor = '';
},
```

- [ ] **Step 7: 修改 `_onMouseUp` 处理拖拽阈值场景**

在 `_onMouseUp` 方法开头（约第 1770 行），添加对 pending 但未激活拖拽的处理：

将 `_onMouseUp` 的前两行替换为：

```javascript
_onMouseUp: function(e) {
  // Handle case where mouse was released before threshold
  if (this._pendingDrag) {
    this._pendingDrag = null;
    document.body.style.userSelect = '';
    return;
  }
  if (!this.isDragging) return;
```

其余 `_onMouseUp` 逻辑保持不变。

- [ ] **Step 8: 修改 `_cancelDrag` 处理 pending 场景**

将 `_cancelDrag` 替换为：

```javascript
_cancelDrag: function() {
  if (this._pendingDrag) {
    this._pendingDrag = null;
    document.body.style.userSelect = '';
    return;
  }
  if (!this.isDragging) return;
  delete this.dragTarget._tempStart;
  delete this.dragTarget._tempEnd;
  delete this.dragTarget._tempDate;
  this._cleanup();
  App.renderAll();
},
```

- [ ] **Step 8b: 修改 `init()` 中 Escape 键处理和添加 mouseleave 清理**

在 `DragManager.init()` 方法中（约第 1628 行），将 keydown 监听替换为：

```javascript
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && (self.isDragging || self._pendingDrag)) {
    self._cancelDrag();
  }
});
document.addEventListener('mouseleave', function(e) {
  if (!e.relatedTarget && (self.isDragging || self._pendingDrag)) {
    self._cancelDrag();
  }
});
```

关键修复：
- Escape 键现在也能取消 pending 状态（阈值内的 mousedown）
- 鼠标离开浏览器窗口时自动取消拖拽，清理 ghost 和 userSelect

- [ ] **Step 9: 在浏览器中验证**

打开 `index.html`：
- **拖拽阈值**：点击任务条后微小移动（< 4px）不应启动拖拽；松开后应视为点击
- **任务条 ghost**：
  - 拖拽任务条，应出现半透明克隆跟随鼠标
  - 原始任务条应变为 0.3 透明度
  - 松开后 ghost 消失，原始任务条恢复
- **里程碑 ghost**：
  - 拖拽里程碑，应出现半透明菱形跟随鼠标（水平移动）
- **吸附线**：拖拽时应在甘特图上显示蓝色竖线指示目标日期
- **行合并**：垂直拖拽超过 18px 应高亮目标行，ghost 跟随纵向移动
- **取消拖拽**：按 Esc 应取消拖拽，ghost 消失，任务条恢复
- **Cursor**：拖拽中 cursor 应为 `grabbing`

- [ ] **Step 10: 提交**

```bash
git add index.html
git commit -m "feat: add ghost visual feedback and drag threshold for gantt interactions"
```

---

## Chunk 4: 最终集成验证

### Task 4: 端到端验证和收尾

- [ ] **Step 1: 完整功能验证**

在浏览器中打开 `index.html`，逐项验证：

1. 创建一个任务（有开始/结束日期），切换到甘特图视图
2. hover 任务条 → 应上浮 + 阴影
3. hover 里程碑 → 应放大
4. 右键任务条 → 弹出「添加里程碑」菜单
5. 点击菜单 → 弹窗日期预填正确
6. 拖拽任务条 → ghost 跟随 + 吸附线 + 原始条变淡
7. 松开 → 日期更新正确
8. 拖拽里程碑 → ghost 水平跟随
9. 纵向拖拽 → 行合并模式，目标行高亮
10. 点击任务条（< 4px 移动）→ 选中，不触发拖拽
11. Esc 取消拖拽 → 恢复原状

- [ ] **Step 2: 提交最终状态（如有修复）**

```bash
git add index.html
git commit -m "fix: polish gantt interaction improvements"
```
