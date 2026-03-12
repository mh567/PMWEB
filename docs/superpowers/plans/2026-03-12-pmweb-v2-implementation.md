# PMWEB v2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor PMWEB from project/task model to multi-level task tree with Gantt drag-and-drop, chart-only milestone interaction, highlight sync, and versioned data format.

**Architecture:** Single `index.html` file (~2000 lines). All JS is organized as plain objects: DataStore, TaskManager (replaces ProjectManager), ModalManager, TreeView, GanttView, CalendarView, DragManager (new), App. Data format changes from v1 (projects+tasks) to v2 (unified task tree with parentId).

**Tech Stack:** Vanilla HTML5, CSS3 (flexbox, absolute positioning), ES6 JavaScript (no modules, no dependencies). Drag via native mousedown/mousemove/mouseup.

**Spec:** `docs/superpowers/specs/2026-03-12-pmweb-v2-design.md`

**Current file:** `index.html` (~2000 lines) with sections: DataStore (line 690), ProjectManager (line 778), ModalManager (line 1024), TreeView (line 1199), GanttView (line 1382), CalendarView (line 1600), App (line 1713).

---

## Chunk 1: Data Layer Refactor (Tasks 1-2)

### Task 1: DataStore — v2 Format + Migration

**Files:**
- Modify: `index.html` (DataStore section, lines 690-775)

Replace DataStore to support v2 format with migration chain.

- [ ] **Step 1: Replace DataStore object**

Replace the entire DataStore object (lines 693-775) with:

```javascript
const DataStore = {
  STORAGE_KEY: 'pmweb_data',
  CURRENT_VERSION: 2,

  createEmpty: function() {
    return {
      pmweb_version: this.CURRENT_VERSION,
      tasks: [],
      milestones: [],
      settings: { lastView: 'gantt', lastGranularity: 'month' }
    };
  },

  load: function() {
    try {
      var raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return this.createEmpty();
      var data = JSON.parse(raw);
      return this.migrate(data);
    } catch (e) {
      console.error('DataStore.load failed:', e);
      return this.createEmpty();
    }
  },

  save: function(data) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('DataStore.save failed:', e);
      alert('数据保存失败，可能 localStorage 已满');
    }
  },

  exportJSON: function(data) {
    var exportData = JSON.parse(JSON.stringify(data));
    exportData.exported_at = new Date().toISOString();
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pmweb-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  importJSON: function(file) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var data = JSON.parse(e.target.result);
          // Accept both v1 and v2 formats
          if (!data.version && !data.pmweb_version) {
            reject(new Error('JSON 格式不正确：缺少版本号'));
            return;
          }
          var migrated = self.migrate(data);
          resolve(migrated);
        } catch (err) {
          reject(new Error('JSON 解析失败：文件内容无效'));
        }
      };
      reader.onerror = function() { reject(new Error('文件读取失败')); };
      reader.readAsText(file);
    });
  },

  // Migration chain
  migrate: function(data) {
    // Detect version
    var version = data.pmweb_version || data.version || 0;

    if (version > this.CURRENT_VERSION) {
      alert('数据版本过新（v' + version + '），请升级软件。当前支持最高版本：v' + this.CURRENT_VERSION);
      return this.createEmpty();
    }

    if (version < 2) {
      data = this._migrateV1toV2(data);
    }

    // Future: if (version < 3) { data = this._migrateV2toV3(data); }

    return data;
  },

  _migrateV1toV2: function(v1) {
    var v2 = {
      pmweb_version: 2,
      tasks: [],
      milestones: [],
      settings: v1.settings || { lastView: 'gantt', lastGranularity: 'month' }
    };

    var projectIdMap = {}; // old project.id → new task.id

    // Convert projects to top-level tasks
    var projects = v1.projects || [];
    projects.forEach(function(p, i) {
      var newId = DataStore.uuid();
      projectIdMap[p.id] = newId;
      v2.tasks.push({
        id: newId,
        parentId: null,
        name: p.name,
        description: '',
        assignee: '',
        color: p.color || '#4a90d9',
        startDate: null,
        endDate: null,
        status: 'todo',
        order: i,
        ganttRow: null
      });
    });

    // Convert tasks, reparent under converted projects
    var oldTasks = v1.tasks || [];
    oldTasks.forEach(function(t) {
      var parentId = projectIdMap[t.projectId] || null;
      v2.tasks.push({
        id: t.id,
        parentId: parentId,
        name: t.name,
        description: t.description || '',
        assignee: t.assignee || '',
        color: null, // inherit from parent
        startDate: t.startDate,
        endDate: t.endDate,
        status: t.status || 'todo',
        order: t.order || 0,
        ganttRow: null
      });
    });

    // Convert milestones
    var oldMilestones = v1.milestones || [];
    oldMilestones.forEach(function(m) {
      var taskId = m.taskId;
      // If milestone was project-level, assign to the converted project task
      if (!taskId && m.projectId) {
        taskId = projectIdMap[m.projectId] || null;
      }
      if (taskId) {
        v2.milestones.push({
          id: m.id,
          taskId: taskId,
          name: m.name,
          date: m.date,
          icon: m.icon || '◆'
        });
      }
    });

    return v2;
  },

  formatDate: function(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  },

  uuid: function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
};
```

- [ ] **Step 2: Verify in browser console**

Open `index.html`, open console (F12):
```javascript
// Test v1 migration
var v1 = {version:1, projects:[{id:'p1',name:'Test',color:'#e67e22',order:0}], tasks:[{id:'t1',projectId:'p1',name:'Task1',startDate:'2026-03-01',endDate:'2026-03-10',status:'todo',order:0}], milestones:[], settings:{}};
var v2 = DataStore.migrate(v1);
console.log(v2.pmweb_version); // 2
console.log(v2.tasks.length); // 2 (1 project→task + 1 task)
console.log(v2.tasks[0].parentId); // null
console.log(v2.tasks[1].parentId); // the converted project's new ID
```
Expected: Migration produces correct v2 structure.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: refactor DataStore for v2 format with migration chain"
```

---

### Task 2: TaskManager — Replace ProjectManager

**Files:**
- Modify: `index.html` (replace ProjectManager section, lines 778-1023)

Replace ProjectManager with TaskManager that operates on the unified task tree.

- [ ] **Step 1: Replace ProjectManager with TaskManager**

Replace the entire ProjectManager object with:

```javascript
// ============================================================
// == TaskManager: 统一任务树 CRUD
// ============================================================
var TaskManager = {
  data: null,

  COLORS: ['#4a90d9', '#e67e22', '#2ecc71', '#9b59b6', '#e74c3c', '#1abc9c', '#f39c12', '#3498db', '#e91e63', '#00bcd4', '#8bc34a', '#ff5722'],

  init: function() {
    this.data = DataStore.load();
  },

  _save: function() {
    DataStore.save(this.data);
  },

  // -- Task tree queries --

  // Get depth of a task (0 = top-level)
  getDepth: function(taskId) {
    var depth = 0;
    var task = this.getTask(taskId);
    while (task && task.parentId) {
      depth++;
      task = this.getTask(task.parentId);
      if (depth > 3) break; // safety
    }
    return depth;
  },

  getTask: function(id) {
    return this.data.tasks.find(function(t) { return t.id === id; }) || null;
  },

  // Get top-level tasks sorted by order
  getRootTasks: function() {
    return this.data.tasks
      .filter(function(t) { return t.parentId === null; })
      .sort(function(a, b) { return a.order - b.order; });
  },

  // Get children of a task sorted by order
  getChildren: function(parentId) {
    return this.data.tasks
      .filter(function(t) { return t.parentId === parentId; })
      .sort(function(a, b) { return a.order - b.order; });
  },

  // Get all descendants (recursive)
  getDescendants: function(taskId) {
    var result = [];
    var self = this;
    var children = this.getChildren(taskId);
    children.forEach(function(child) {
      result.push(child);
      result = result.concat(self.getDescendants(child.id));
    });
    return result;
  },

  // Get all tasks (flat)
  getAllTasks: function() {
    return this.data.tasks.slice();
  },

  // Get effective color (inherit from parent if null)
  getEffectiveColor: function(task) {
    if (task.color) return task.color;
    if (task.parentId) {
      var parent = this.getTask(task.parentId);
      if (parent) return this.getEffectiveColor(parent);
    }
    return '#4a90d9';
  },

  // Get computed date range for a task (auto-calc from children if needed)
  getDateRange: function(task) {
    if (task.startDate && task.endDate) {
      return { startDate: task.startDate, endDate: task.endDate };
    }
    // Auto-compute from children
    var children = this.getChildren(task.id);
    if (children.length === 0) {
      return { startDate: null, endDate: null };
    }
    var minStart = null;
    var maxEnd = null;
    var self = this;
    children.forEach(function(child) {
      var range = self.getDateRange(child);
      if (range.startDate) {
        if (!minStart || range.startDate < minStart) minStart = range.startDate;
      }
      if (range.endDate) {
        if (!maxEnd || range.endDate > maxEnd) maxEnd = range.endDate;
      }
    });
    return { startDate: minStart, endDate: maxEnd };
  },

  // -- Task CRUD --

  addTask: function(parentId, name) {
    // Check depth
    if (parentId) {
      var depth = this.getDepth(parentId);
      if (depth >= 2) {
        alert('最多支持 3 层任务');
        return null;
      }
    }

    var siblings = parentId ? this.getChildren(parentId) : this.getRootTasks();
    var color = null;
    if (!parentId) {
      // Top-level: assign a color
      color = this.COLORS[this.data.tasks.filter(function(t) { return t.parentId === null; }).length % this.COLORS.length];
    }

    var today = DataStore.formatDate(new Date());
    var weekLater = DataStore.formatDate(new Date(Date.now() + 7 * 86400000));

    var task = {
      id: DataStore.uuid(),
      parentId: parentId,
      name: name.trim(),
      description: '',
      assignee: '',
      color: color,
      startDate: today,
      endDate: weekLater,
      status: 'todo',
      order: siblings.length,
      ganttRow: null
    };

    this.data.tasks.push(task);
    this._save();
    return task;
  },

  updateTask: function(id, updates) {
    var task = this.getTask(id);
    if (!task) return null;

    // Validate dates if both present
    var newStart = updates.startDate !== undefined ? updates.startDate : task.startDate;
    var newEnd = updates.endDate !== undefined ? updates.endDate : task.endDate;
    if (newStart && newEnd && newEnd < newStart) {
      alert('结束日期不能早于开始日期');
      return null;
    }

    var allowed = ['name', 'description', 'assignee', 'color', 'startDate', 'endDate', 'status', 'order', 'ganttRow'];
    for (var i = 0; i < allowed.length; i++) {
      var key = allowed[i];
      if (updates[key] !== undefined) {
        task[key] = updates[key];
      }
    }
    if (updates.name !== undefined) task.name = task.name.trim();
    if (updates.assignee !== undefined && task.assignee) task.assignee = task.assignee.trim();

    this._save();
    return task;
  },

  deleteTask: function(id) {
    // Cascade delete descendants
    var descendants = this.getDescendants(id);
    var idsToDelete = [id];
    descendants.forEach(function(d) { idsToDelete.push(d.id); });

    // Delete milestones for all deleted tasks
    this.data.milestones = this.data.milestones.filter(function(m) {
      return idsToDelete.indexOf(m.taskId) === -1;
    });

    // Delete tasks
    this.data.tasks = this.data.tasks.filter(function(t) {
      return idsToDelete.indexOf(t.id) === -1;
    });

    this._save();
  },

  // -- Milestone CRUD --

  getMilestonesByTask: function(taskId) {
    return this.data.milestones
      .filter(function(m) { return m.taskId === taskId; })
      .sort(function(a, b) { return a.date.localeCompare(b.date); });
  },

  getAllMilestones: function() {
    return this.data.milestones.slice();
  },

  addMilestone: function(taskId, name, date, icon) {
    var task = this.getTask(taskId);
    if (task) {
      var range = this.getDateRange(task);
      if (range.startDate && range.endDate) {
        if (date < range.startDate || date > range.endDate) {
          alert('里程碑日期必须在任务的时间范围内');
          return null;
        }
      }
    }
    var milestone = {
      id: DataStore.uuid(),
      taskId: taskId,
      name: name.trim(),
      date: date,
      icon: icon || '◆'
    };
    this.data.milestones.push(milestone);
    this._save();
    return milestone;
  },

  updateMilestone: function(id, updates) {
    var milestone = this.data.milestones.find(function(m) { return m.id === id; });
    if (!milestone) return null;
    if (updates.name !== undefined) milestone.name = updates.name.trim();
    if (updates.date !== undefined) milestone.date = updates.date;
    if (updates.icon !== undefined) milestone.icon = updates.icon;
    this._save();
    return milestone;
  },

  deleteMilestone: function(id) {
    this.data.milestones = this.data.milestones.filter(function(m) { return m.id !== id; });
    this._save();
  },

  // -- Settings --

  getSetting: function(key) {
    return this.data.settings[key];
  },

  setSetting: function(key, value) {
    this.data.settings[key] = value;
    this._save();
  },

  replaceData: function(newData) {
    this.data = newData;
    this._save();
  }
};
```

- [ ] **Step 2: Global rename — update all references from ProjectManager to TaskManager**

Search and replace throughout the rest of `index.html`:
- `ProjectManager.` → `TaskManager.`
- `ProjectManager` (standalone references) → `TaskManager`

This includes ModalManager, TreeView, GanttView, CalendarView, and App sections.

Also update API calls:
- `TaskManager.getProjects()` → `TaskManager.getRootTasks()`
- `TaskManager.getTasksByProject(id)` → `TaskManager.getChildren(id)`
- `TaskManager.addProject(name)` → `TaskManager.addTask(null, name)`
- `TaskManager.updateProject(id, updates)` → `TaskManager.updateTask(id, updates)`
- `TaskManager.deleteProject(id)` → `TaskManager.deleteTask(id)`
- `TaskManager.addTask(projectId, name, start, end)` → `TaskManager.addTask(parentId, name)` then `TaskManager.updateTask(id, {startDate, endDate})`
- `TaskManager.getMilestonesByProject(projectId)` → `TaskManager.getMilestonesByTask(taskId)`

- [ ] **Step 3: Verify in browser console**

Open `index.html`, console:
```javascript
TaskManager.init();
var root = TaskManager.addTask(null, '测试项目');
var child = TaskManager.addTask(root.id, '子任务1');
var grandchild = TaskManager.addTask(child.id, '孙任务');
console.log(TaskManager.getDepth(grandchild.id)); // 2
console.log(TaskManager.getChildren(root.id).length); // 1
console.log(TaskManager.getDescendants(root.id).length); // 2
// Should fail:
TaskManager.addTask(grandchild.id, '第四层'); // alert: 最多支持3层
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: replace ProjectManager with TaskManager for multi-level task tree"
```

---

## Chunk 2: UI Refactor — Toolbar + TreeView (Tasks 3-4)

### Task 3: Toolbar Simplification

**Files:**
- Modify: `index.html` (toolbar HTML, lines ~630-654)

Remove project management button and top-level add task button from toolbar.

- [ ] **Step 1: Simplify toolbar HTML**

Replace the toolbar content (inside `<div id="toolbar">`) with:

```html
<div id="toolbar">
  <span class="toolbar-title">PMWEB</span>
  <div class="toolbar-sep"></div>
  <div class="toolbar-group">
    <button class="btn" id="btn-import">导入</button>
    <button class="btn" id="btn-export">导出</button>
  </div>
  <div class="toolbar-sep"></div>
  <div class="toolbar-group" id="view-toggle-group">
    <button class="btn active" id="btn-view-gantt">甘特图</button>
    <button class="btn" id="btn-view-calendar">日历</button>
  </div>
  <div class="toolbar-sep"></div>
  <div class="toolbar-group" id="granularity-group">
    <button class="btn" id="btn-granularity-year">年</button>
    <button class="btn active" id="btn-granularity-month">月</button>
    <button class="btn" id="btn-granularity-week">周</button>
  </div>
</div>
```

Key changes:
- Removed `btn-project-manager` button
- Removed `btn-add-task` button from toolbar
- Removed spacer before add-task

- [ ] **Step 2: Update sidebar HTML**

Replace sidebar section with:

```html
<div id="sidebar">
  <div id="sidebar-header">
    <h2>任务列表</h2>
  </div>
  <div id="tree-container"></div>
  <div id="sidebar-footer">
    <button class="btn btn-primary" id="btn-add-root-task" style="width:100%;padding:8px;">+ 新建顶层任务</button>
  </div>
</div>
```

Key changes:
- Removed `btn-add-project` from sidebar header
- Added `sidebar-footer` with `btn-add-root-task` button

- [ ] **Step 3: Add sidebar-footer CSS**

Add to `<style>` section (in the SIDEBAR area):

```css
#sidebar-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}
```

- [ ] **Step 4: Update App._bindToolbar()**

In the App object's `_bindToolbar` method:
- Remove the `btn-project-manager` event listener
- Remove the `btn-add-task` event listener
- Remove the `btn-add-project` event listener
- Add: `document.getElementById('btn-add-root-task').addEventListener('click', function() { self.showAddTask(null); });`

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: simplify toolbar, move add-task to sidebar footer"
```

---

### Task 4: TreeView — Multi-Level Task Tree with Hover Actions

**Files:**
- Modify: `index.html` (TreeView CSS + JS)

Rewrite TreeView to render multi-level task tree with hover action buttons. Remove milestone display from tree.

- [ ] **Step 1: Update tree CSS**

Replace existing tree CSS with:

```css
/* == 树形列表 == */
.tree-node {
  position: relative;
}
.tree-node-row {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  cursor: pointer;
  font-size: 13px;
  gap: 4px;
  position: relative;
}
.tree-node-row:hover { background: #f0f4ff; }
.tree-node-row.selected { background: #e3ecfa; }
.tree-node-row.highlighted { background: #fff3cd; }
.tree-node-row .arrow {
  font-size: 10px;
  width: 16px;
  text-align: center;
  color: var(--color-text-light);
  flex-shrink: 0;
  transition: transform 0.15s;
}
.tree-node-row .arrow.collapsed { transform: rotate(-90deg); }
.tree-node-row .arrow.empty { visibility: hidden; }
.tree-node-row .color-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tree-node-row .node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-node-row .status-icon {
  font-size: 11px;
  flex-shrink: 0;
}
.tree-node-row .node-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.tree-node-row:hover .node-actions { display: flex; }
.tree-node-row .node-actions button {
  padding: 0 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-light);
  border-radius: 3px;
}
.tree-node-row .node-actions button:hover {
  background: var(--color-border);
  color: var(--color-text);
}
.tree-children {
  overflow: hidden;
}
.tree-children.collapsed { display: none; }
/* Indentation per depth level */
.tree-node[data-depth="0"] > .tree-node-row { padding-left: 8px; }
.tree-node[data-depth="1"] > .tree-node-row { padding-left: 28px; }
.tree-node[data-depth="2"] > .tree-node-row { padding-left: 48px; }
```

- [ ] **Step 2: Rewrite TreeView JS**

Replace the entire TreeView object with:

```javascript
var TreeView = {
  container: null,
  contextMenu: null,
  collapsedTasks: new Set(),
  selectedTaskId: null,
  hoveredTaskId: null,

  init: function() {
    this.container = document.getElementById('tree-container');
    this.contextMenu = document.getElementById('context-menu');
    document.addEventListener('click', function() { TreeView.hideContextMenu(); });
  },

  render: function() {
    var roots = TaskManager.getRootTasks();
    if (roots.length === 0) {
      this.container.innerHTML = '<div style="padding:24px 16px;color:var(--color-text-light);font-size:13px;text-align:center;">暂无任务<br>点击下方按钮新建</div>';
      return;
    }

    var html = '';
    var self = this;
    roots.forEach(function(task) {
      html += self._renderNode(task, 0);
    });
    this.container.innerHTML = html;
    this._bindEvents();
  },

  _renderNode: function(task, depth) {
    var children = TaskManager.getChildren(task.id);
    var hasChildren = children.length > 0;
    var isCollapsed = this.collapsedTasks.has(task.id);
    var isSelected = this.selectedTaskId === task.id;
    var isHighlighted = this.hoveredTaskId === task.id;
    var color = TaskManager.getEffectiveColor(task);

    var statusIcon = task.status === 'done' ? '✓' : task.status === 'inProgress' ? '►' : '○';
    var statusColor = task.status === 'done' ? '#2ecc71' : task.status === 'inProgress' ? '#f39c12' : '#ccc';

    var rowCls = 'tree-node-row';
    if (isSelected) rowCls += ' selected';
    if (isHighlighted) rowCls += ' highlighted';

    var arrowCls = 'arrow';
    if (!hasChildren) arrowCls += ' empty';
    else if (isCollapsed) arrowCls += ' collapsed';

    var html = '<div class="tree-node" data-task-id="' + task.id + '" data-depth="' + depth + '">';
    html += '<div class="' + rowCls + '" data-task-id="' + task.id + '">';
    html += '<span class="' + arrowCls + '">▼</span>';
    html += '<span class="color-dot" style="background:' + color + '"></span>';
    html += '<span class="status-icon" style="color:' + statusColor + '">' + statusIcon + '</span>';
    html += '<span class="node-name">' + _escapeHtml(task.name) + '</span>';
    if (task.assignee) {
      html += '<span style="font-size:11px;color:var(--color-text-light);flex-shrink:0;margin-right:4px;">' + _escapeHtml(task.assignee) + '</span>';
    }
    html += '<span class="node-actions">';
    if (depth < 2) {
      html += '<button class="btn-add-child" data-task-id="' + task.id + '" title="添加子任务">+</button>';
    }
    html += '<button class="btn-more" data-task-id="' + task.id + '" title="更多操作">⋯</button>';
    html += '</span>';
    html += '</div>';

    // Children
    if (hasChildren) {
      html += '<div class="tree-children' + (isCollapsed ? ' collapsed' : '') + '">';
      var self = this;
      children.forEach(function(child) {
        html += self._renderNode(child, depth + 1);
      });
      html += '</div>';
    }

    html += '</div>';
    return html;
  },

  _bindEvents: function() {
    var self = this;

    this.container.querySelectorAll('.tree-node-row').forEach(function(el) {
      var taskId = el.dataset.taskId;

      // Click to select
      el.addEventListener('click', function(e) {
        if (e.target.closest('.node-actions')) return;
        var task = TaskManager.getTask(taskId);
        var children = TaskManager.getChildren(taskId);

        // Toggle collapse if has children and clicked on arrow area
        if (children.length > 0 && e.target.classList.contains('arrow')) {
          if (self.collapsedTasks.has(taskId)) {
            self.collapsedTasks.delete(taskId);
          } else {
            self.collapsedTasks.add(taskId);
          }
          self.render();
          return;
        }

        self.selectedTaskId = taskId;
        self.render();
        App.onTaskSelected(taskId);
      });

      // Hover for highlight sync
      el.addEventListener('mouseenter', function() {
        self.hoveredTaskId = taskId;
        App.onTaskHovered(taskId);
      });
      el.addEventListener('mouseleave', function() {
        self.hoveredTaskId = null;
        App.onTaskHovered(null);
      });

      // Context menu
      el.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        var depth = TaskManager.getDepth(taskId);
        var items = [];
        if (depth < 2) {
          items.push({ label: '添加子任务', action: function() { App.showAddTask(taskId); } });
        }
        items.push({ label: '编辑任务', action: function() { App.showEditTask(taskId); } });
        items.push({ label: '设置颜色', action: function() { App.showColorPicker(taskId); } });
        items.push({ label: '删除任务', action: function() { App.deleteTask(taskId); }, danger: true });
        self.showContextMenu(e.clientX, e.clientY, items);
      });
    });

    // Add child buttons
    this.container.querySelectorAll('.btn-add-child').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        App.showAddTask(btn.dataset.taskId);
      });
    });

    // More actions buttons
    this.container.querySelectorAll('.btn-more').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var taskId = btn.dataset.taskId;
        var depth = TaskManager.getDepth(taskId);
        var rect = btn.getBoundingClientRect();
        var items = [];
        if (depth < 2) {
          items.push({ label: '添加子任务', action: function() { App.showAddTask(taskId); } });
        }
        items.push({ label: '编辑任务', action: function() { App.showEditTask(taskId); } });
        items.push({ label: '设置颜色', action: function() { App.showColorPicker(taskId); } });
        items.push({ label: '删除任务', action: function() { App.deleteTask(taskId); }, danger: true });
        self.showContextMenu(rect.left, rect.bottom, items);
      });
    });
  },

  showContextMenu: function(x, y, items) {
    var self = this;
    var html = '';
    items.forEach(function(item) {
      var cls = item.danger ? ' danger' : '';
      html += '<div class="context-menu-item' + cls + '">' + item.label + '</div>';
    });
    this.contextMenu.innerHTML = html;
    this.contextMenu.style.left = x + 'px';
    this.contextMenu.style.top = y + 'px';
    this.contextMenu.classList.add('active');

    this.contextMenu.querySelectorAll('.context-menu-item').forEach(function(el, i) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        self.hideContextMenu();
        items[i].action();
      });
    });
  },

  hideContextMenu: function() {
    this.contextMenu.classList.remove('active');
  },

  // Highlight a task from external source (gantt click)
  highlightTask: function(taskId) {
    this.selectedTaskId = taskId;
    this.render();
    // Scroll the selected item into view
    var el = this.container.querySelector('[data-task-id="' + taskId + '"].tree-node-row');
    if (el) el.scrollIntoView({ block: 'nearest' });
  },

  // Temporary hover highlight from gantt
  setHoverHighlight: function(taskId) {
    // Remove previous highlight
    this.container.querySelectorAll('.tree-node-row.highlighted').forEach(function(el) {
      el.classList.remove('highlighted');
    });
    if (taskId) {
      var el = this.container.querySelector('.tree-node-row[data-task-id="' + taskId + '"]');
      if (el) el.classList.add('highlighted');
    }
  }
};
```

- [ ] **Step 3: Verify tree renders with multi-level data**

Open `index.html`, console:
```javascript
localStorage.removeItem('pmweb_data');
location.reload();
// Then:
TaskManager.addTask(null, '需求跟踪');
var root = TaskManager.getRootTasks()[0];
TaskManager.addTask(root.id, '用户模块');
var child = TaskManager.getChildren(root.id)[0];
TaskManager.addTask(child.id, '登录功能');
App.renderAll();
```
Expected: Tree shows 3-level hierarchy with expand/collapse arrows, hover shows [+] and [⋯] buttons, [+] not visible on depth-2 nodes.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: rewrite TreeView for multi-level task tree with hover actions"
```

---

## Chunk 3: GanttView Refactor + Drag (Tasks 5-6)

### Task 5: GanttView — Adapt to Multi-Level Tasks + Highlight

**Files:**
- Modify: `index.html` (GanttView JS + CSS)

Update GanttView to render tasks from the unified tree, support highlight sync, and update milestone styling.

- [ ] **Step 1: Update milestone CSS for red color + white outline**

Replace existing `.gantt-milestone` CSS and add highlight CSS:

```css
.gantt-milestone {
  position: absolute;
  top: 4px;
  width: 20px; height: 20px;
  cursor: pointer;
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
.gantt-milestone:hover { transform: translateX(-10px) scale(1.3); }

/* Highlight sync */
.gantt-bar.highlight {
  filter: brightness(1.2);
  box-shadow: 0 0 8px rgba(74, 144, 217, 0.6);
  z-index: 4;
}
.gantt-bar.selected {
  box-shadow: 0 0 0 2px var(--color-primary), 0 0 12px rgba(74, 144, 217, 0.4);
  z-index: 4;
}

/* Drag tooltip */
.gantt-drag-tooltip {
  position: fixed;
  background: rgba(0,0,0,0.8);
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
  z-index: 100;
  white-space: nowrap;
}
```

- [ ] **Step 2: Rewrite GanttView.render() for unified task tree**

Update GanttView's render method to:
- Iterate all tasks recursively (flattened in tree order), not by project
- Use `TaskManager.getEffectiveColor(task)` for bar colors
- Use `TaskManager.getDateRange(task)` for computed date ranges
- Add `data-task-id` attribute to bars for highlight sync
- Render milestones with fixed red color
- Support `ganttRow` merging (tasks with same ganttRow value on same row)
- Add mouseenter/mouseleave events on bars for hover sync
- Add click on bars for selection sync (calls `App.onGanttTaskClicked`)
- Double-click on bars for milestone creation
- Right-click on milestones for delete

The full render rewrite:

```javascript
render: function() {
  this._calcDateRange();
  this._generateCells();

  var allTasks = TaskManager.getAllTasks();
  var leafTasks = allTasks.filter(function(t) {
    return TaskManager.getChildren(t.id).length === 0;
  });

  if (leafTasks.length === 0) {
    this.container.innerHTML = '<div class="gantt-empty">暂无任务，请先创建任务</div>';
    return;
  }

  var totalWidth = this.cells.length * this.cellWidth;
  var today = DataStore.formatDate(new Date());
  var self = this;

  // Build header
  var headerHtml = '<div class="gantt-header" style="width:' + totalWidth + 'px;">';
  this.cells.forEach(function(cell) {
    headerHtml += '<div class="gantt-header-cell" style="width:' + self.cellWidth + 'px;">' + cell.label + '</div>';
  });
  headerHtml += '</div>';

  // Build rows — group by ganttRow, render leaf tasks only
  var rows = this._buildRows(leafTasks);
  var bodyHtml = '<div class="gantt-body"><div style="position:relative;width:' + totalWidth + 'px;min-height:' + (rows.length * 36) + 'px;">';

  // Today line
  var todayX = this._dateToX(today);
  if (todayX >= 0 && todayX <= totalWidth) {
    bodyHtml += '<div class="gantt-today-line" style="left:' + todayX + 'px;"></div>';
  }

  // Grid background
  rows.forEach(function(row, rowIndex) {
    bodyHtml += '<div class="gantt-row" style="width:' + totalWidth + 'px;top:' + (rowIndex * 36) + 'px;position:absolute;left:0;" data-row-index="' + rowIndex + '">';
    self.cells.forEach(function(cell) {
      var cls = cell.isWeekend ? ' weekend' : '';
      bodyHtml += '<div class="gantt-grid-cell' + cls + '" style="width:' + self.cellWidth + 'px;"></div>';
    });
    bodyHtml += '</div>';

    // Task bars in this row
    row.forEach(function(task) {
      var range = TaskManager.getDateRange(task);
      if (!range.startDate || !range.endDate) return;

      var color = TaskManager.getEffectiveColor(task);
      var barX = self._dateToX(range.startDate);
      var barW = self._dateRangeToWidth(range.startDate, range.endDate);
      var statusCls = task.status === 'done' ? ' status-done' : '';
      var selectedCls = (TreeView.selectedTaskId === task.id) ? ' selected' : '';
      var assigneeText = task.assignee ? ' [' + _escapeHtml(task.assignee) + ']' : '';

      bodyHtml += '<div class="gantt-bar' + statusCls + selectedCls + '" style="left:' + barX + 'px;width:' + barW + 'px;top:' + (rowIndex * 36 + 8) + 'px;background:' + color + ';" data-task-id="' + task.id + '" title="' + _escapeHtml(task.name) + assigneeText + ' (' + range.startDate + ' ~ ' + range.endDate + ')">' + _escapeHtml(task.name) + '</div>';

      // Milestones on this task
      var milestones = TaskManager.getMilestonesByTask(task.id);
      milestones.forEach(function(ms) {
        var msX = self._dateToX(ms.date);
        bodyHtml += '<div class="gantt-milestone" style="left:' + msX + 'px;top:' + (rowIndex * 36 + 4) + 'px;" data-milestone-id="' + ms.id + '" data-task-id="' + task.id + '" title="' + _escapeHtml(ms.name) + ' (' + ms.date + ')">' + ms.icon + '</div>';
      });
    });
  });

  bodyHtml += '</div></div>';

  this.container.innerHTML = '<div class="gantt-container">' + headerHtml + bodyHtml + '</div>';
  this._bindBarEvents();

  // Scroll to today
  var ganttBody = this.container.querySelector('.gantt-body');
  if (ganttBody && todayX > 0) {
    ganttBody.scrollLeft = Math.max(0, todayX - ganttBody.clientWidth / 2);
  }
},

// Build row layout from leaf tasks, respecting ganttRow
_buildRows: function(leafTasks) {
  var rows = [];
  var rowMap = {}; // ganttRow value → row index

  leafTasks.forEach(function(task) {
    if (task.ganttRow !== null && task.ganttRow !== undefined && rowMap[task.ganttRow] !== undefined) {
      // Add to existing row
      rows[rowMap[task.ganttRow]].push(task);
    } else {
      // New row
      var rowIndex = rows.length;
      rows.push([task]);
      if (task.ganttRow !== null && task.ganttRow !== undefined) {
        rowMap[task.ganttRow] = rowIndex;
      }
    }
  });

  return rows;
},

_bindBarEvents: function() {
  var self = this;

  // Bar hover highlight
  this.container.querySelectorAll('.gantt-bar').forEach(function(el) {
    el.addEventListener('mouseenter', function() {
      el.classList.add('highlight');
      TreeView.setHoverHighlight(el.dataset.taskId);
    });
    el.addEventListener('mouseleave', function() {
      el.classList.remove('highlight');
      TreeView.setHoverHighlight(null);
    });
    el.addEventListener('click', function(e) {
      if (e.detail === 1) { // single click
        App.onGanttTaskClicked(el.dataset.taskId);
      }
    });
    el.addEventListener('dblclick', function(e) {
      // Double-click to add milestone
      var taskId = el.dataset.taskId;
      var rect = el.getBoundingClientRect();
      var clickX = e.clientX - rect.left;
      var barStartX = parseFloat(el.style.left);
      var dateAtClick = self._xToDate(barStartX + clickX);
      App.showAddMilestoneAtDate(taskId, dateAtClick);
    });
  });

  // Milestone click/right-click
  this.container.querySelectorAll('.gantt-milestone').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      App.showEditMilestone(el.dataset.milestoneId);
    });
    el.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      TreeView.showContextMenu(e.clientX, e.clientY, [
        { label: '编辑里程碑', action: function() { App.showEditMilestone(el.dataset.milestoneId); } },
        { label: '删除里程碑', action: function() { App.deleteMilestone(el.dataset.milestoneId); }, danger: true }
      ]);
    });
  });
},

// Convert pixel X position to date string
_xToDate: function(x) {
  var totalWidth = this.cells.length * this.cellWidth;
  var totalDays = this._daysBetween(this.startDate, this.endDate);
  var dayOffset = Math.round((x / totalWidth) * totalDays);
  var date = new Date(this.startDate);
  date.setDate(date.getDate() + dayOffset);
  return DataStore.formatDate(date);
},

// Highlight/unhighlight a task bar
highlightBar: function(taskId) {
  this.container.querySelectorAll('.gantt-bar').forEach(function(el) {
    el.classList.toggle('highlight', el.dataset.taskId === taskId);
  });
},

clearHighlight: function() {
  this.container.querySelectorAll('.gantt-bar.highlight').forEach(function(el) {
    el.classList.remove('highlight');
  });
},

selectBar: function(taskId) {
  this.container.querySelectorAll('.gantt-bar.selected').forEach(function(el) {
    el.classList.remove('selected');
  });
  if (taskId) {
    var el = this.container.querySelector('.gantt-bar[data-task-id="' + taskId + '"]');
    if (el) {
      el.classList.add('selected');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
},
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: adapt GanttView for unified task tree, add highlight sync and milestone styling"
```

---

### Task 6: DragManager — Gantt Drag-and-Drop

**Files:**
- Modify: `index.html` (add DragManager JS section after GanttView)

Implement all four drag operations: move, resize, milestone drag, row merge.

- [ ] **Step 1: Add DragManager object**

Add after GanttView, before CalendarView:

```javascript
// ============================================================
// == DragManager: 甘特图拖拽操作
// ============================================================
var DragManager = {
  isDragging: false,
  dragType: null, // 'move' | 'resize-left' | 'resize-right' | 'milestone' | 'row-merge'
  dragTarget: null, // task or milestone object
  startX: 0,
  startY: 0,
  originalStartDate: null,
  originalEndDate: null,
  originalDate: null,
  originalRow: null,
  tooltip: null,

  init: function() {
    var self = this;
    document.addEventListener('mousemove', function(e) { self._onMouseMove(e); });
    document.addEventListener('mouseup', function(e) { self._onMouseUp(e); });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && self.isDragging) {
        self._cancelDrag();
      }
    });
  },

  // Called by GanttView after render to attach drag handlers
  attachDragHandlers: function() {
    var self = this;

    // Task bar drag
    document.querySelectorAll('.gantt-bar').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        var taskId = el.dataset.taskId;
        var task = TaskManager.getTask(taskId);
        if (!task) return;

        var rect = el.getBoundingClientRect();
        var offsetX = e.clientX - rect.left;
        var barWidth = rect.width;

        // Determine drag type
        if (offsetX < 5) {
          self._startDrag(e, 'resize-left', task, el);
        } else if (offsetX > barWidth - 5) {
          self._startDrag(e, 'resize-right', task, el);
        } else {
          self._startDrag(e, 'move', task, el);
        }
      });

      // Cursor hint for resize zones
      el.addEventListener('mousemove', function(e) {
        if (self.isDragging) return;
        var rect = el.getBoundingClientRect();
        var offsetX = e.clientX - rect.left;
        if (offsetX < 5 || offsetX > rect.width - 5) {
          el.style.cursor = 'col-resize';
        } else {
          el.style.cursor = 'grab';
        }
      });
    });

    // Milestone drag
    document.querySelectorAll('.gantt-milestone').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var msId = el.dataset.milestoneId;
        var ms = TaskManager.data.milestones.find(function(m) { return m.id === msId; });
        if (ms) {
          self._startDrag(e, 'milestone', ms, el);
        }
      });
    });
  },

  _startDrag: function(e, type, target, element) {
    this.isDragging = true;
    this.dragType = type;
    this.dragTarget = target;
    this.dragElement = element;
    this.startX = e.clientX;
    this.startY = e.clientY;

    if (type === 'move' || type === 'resize-left' || type === 'resize-right') {
      this.originalStartDate = target.startDate;
      this.originalEndDate = target.endDate;
    } else if (type === 'milestone') {
      this.originalDate = target.date;
    }

    // Create tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'gantt-drag-tooltip';
    document.body.appendChild(this.tooltip);

    document.body.style.userSelect = 'none';
    document.body.style.cursor = type === 'move' ? 'grabbing' : 'col-resize';
  },

  _onMouseMove: function(e) {
    if (!this.isDragging) return;

    var deltaX = e.clientX - this.startX;
    var daysDelta = Math.round(deltaX / GanttView.cellWidth * this._daysPerCell());

    if (this.dragType === 'move') {
      var newStart = this._addDays(this.originalStartDate, daysDelta);
      var newEnd = this._addDays(this.originalEndDate, daysDelta);
      this.dragElement.style.left = (parseFloat(this.dragElement.style.left) + deltaX) + 'px';
      this.startX = e.clientX; // reset for incremental
      this.tooltip.textContent = newStart + ' ~ ' + newEnd;
      this.dragTarget._tempStart = newStart;
      this.dragTarget._tempEnd = newEnd;
    } else if (this.dragType === 'resize-left') {
      var newStart = this._addDays(this.originalStartDate, daysDelta);
      if (newStart >= this.originalEndDate) return;
      this.tooltip.textContent = '开始: ' + newStart;
      this.dragTarget._tempStart = newStart;
    } else if (this.dragType === 'resize-right') {
      var newEnd = this._addDays(this.originalEndDate, daysDelta);
      if (newEnd <= this.originalStartDate) return;
      this.tooltip.textContent = '结束: ' + newEnd;
      this.dragTarget._tempEnd = newEnd;
    } else if (this.dragType === 'milestone') {
      var newDate = this._addDays(this.originalDate, daysDelta);
      this.tooltip.textContent = newDate;
      this.dragTarget._tempDate = newDate;
    }

    this.tooltip.style.left = (e.clientX + 12) + 'px';
    this.tooltip.style.top = (e.clientY - 30) + 'px';
  },

  _onMouseUp: function(e) {
    if (!this.isDragging) return;

    var target = this.dragTarget;

    if (this.dragType === 'move') {
      if (target._tempStart && target._tempEnd) {
        TaskManager.updateTask(target.id, { startDate: target._tempStart, endDate: target._tempEnd });
      }
    } else if (this.dragType === 'resize-left') {
      if (target._tempStart) {
        TaskManager.updateTask(target.id, { startDate: target._tempStart });
      }
    } else if (this.dragType === 'resize-right') {
      if (target._tempEnd) {
        TaskManager.updateTask(target.id, { endDate: target._tempEnd });
      }
    } else if (this.dragType === 'milestone') {
      if (target._tempDate) {
        // Validate within task range
        var task = TaskManager.getTask(target.taskId);
        if (task) {
          var range = TaskManager.getDateRange(task);
          if (range.startDate && range.endDate) {
            if (target._tempDate < range.startDate || target._tempDate > range.endDate) {
              // Revert
              this._cleanup();
              App.renderAll();
              return;
            }
          }
        }
        TaskManager.updateMilestone(target.id, { date: target._tempDate });
      }
    }

    // Clean up temp properties
    delete target._tempStart;
    delete target._tempEnd;
    delete target._tempDate;

    this._cleanup();
    App.renderAll();
  },

  _cancelDrag: function() {
    if (!this.isDragging) return;
    delete this.dragTarget._tempStart;
    delete this.dragTarget._tempEnd;
    delete this.dragTarget._tempDate;
    this._cleanup();
    App.renderAll();
  },

  _cleanup: function() {
    this.isDragging = false;
    this.dragType = null;
    this.dragTarget = null;
    this.dragElement = null;
    if (this.tooltip && this.tooltip.parentNode) {
      document.body.removeChild(this.tooltip);
    }
    this.tooltip = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  },

  _daysPerCell: function() {
    if (GanttView.granularity === 'year') return 30;
    if (GanttView.granularity === 'month') return 7;
    return 1;
  },

  _addDays: function(dateStr, days) {
    var d = _parseDate(dateStr);
    d.setDate(d.getDate() + days);
    return DataStore.formatDate(d);
  }
};
```

- [ ] **Step 2: Integrate DragManager into GanttView._bindBarEvents()**

At the end of `GanttView._bindBarEvents()`, add:

```javascript
DragManager.attachDragHandlers();
```

- [ ] **Step 3: Initialize DragManager in App.init()**

Add `DragManager.init();` after `GanttView.init(...)` in App.init().

- [ ] **Step 4: Verify drag in browser**

Open `index.html`, create a task, try:
1. Grab middle of bar → drag left/right → dates change
2. Grab left edge → resize → start date changes
3. Grab right edge → resize → end date changes
4. Press Esc during drag → reverts
5. Add a milestone, drag it left/right → date changes

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add DragManager with move, resize, and milestone drag support"
```

---

## Chunk 4: CalendarView Update + App Controller (Tasks 7-8)

### Task 7: CalendarView — Milestone Interaction + Highlight

**Files:**
- Modify: `index.html` (CalendarView JS + CSS)

Update CalendarView to use TaskManager, add right-click milestone creation, and highlight sync.

- [ ] **Step 1: Update CalendarView milestone styling CSS**

Add/update calendar milestone CSS:

```css
.calendar-milestone-item {
  font-size: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  color: #E74C3C;
  font-weight: 600;
}
.calendar-milestone-item:hover { text-decoration: underline; }

.calendar-task-bar.highlight {
  filter: brightness(1.3);
  box-shadow: 0 0 4px rgba(74, 144, 217, 0.5);
}
.calendar-task-bar.selected {
  box-shadow: 0 0 0 1px var(--color-primary);
}
```

- [ ] **Step 2: Update CalendarView.render()**

Update CalendarView to:
- Replace `ProjectManager` calls with `TaskManager` calls
- Use `TaskManager.getEffectiveColor(task)` for colors
- Use `TaskManager.getDateRange(task)` for date ranges
- Render only leaf tasks (no children)
- Add `data-task-id` to task bars for highlight sync
- Add mouseenter/mouseleave on task bars for hover sync
- Add right-click on calendar days for "添加里程碑" context menu
- Use red color for milestones

- [ ] **Step 3: Add CalendarView highlight methods**

```javascript
highlightBar: function(taskId) {
  this.container.querySelectorAll('.calendar-task-bar').forEach(function(el) {
    el.classList.toggle('highlight', el.dataset.taskId === taskId);
  });
},

clearHighlight: function() {
  this.container.querySelectorAll('.calendar-task-bar.highlight').forEach(function(el) {
    el.classList.remove('highlight');
  });
},

selectBar: function(taskId) {
  this.container.querySelectorAll('.calendar-task-bar.selected').forEach(function(el) {
    el.classList.remove('selected');
  });
  if (taskId) {
    this.container.querySelectorAll('.calendar-task-bar[data-task-id="' + taskId + '"]').forEach(function(el) {
      el.classList.add('selected');
    });
  }
},
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: update CalendarView for TaskManager, milestone styling, and highlight sync"
```

---

### Task 8: App Controller — Wire Everything Together

**Files:**
- Modify: `index.html` (App JS section)

Rewrite App controller for the new architecture.

- [ ] **Step 1: Rewrite App object**

Update App to:
- Remove all project-related methods (`showProjectManager`, `showAddProject`, `showEditProject`, `deleteProject`)
- Update `showAddTask(parentId)` — parentId is null for root tasks, otherwise parent task ID
- Add `showColorPicker(taskId)` — modal to pick task color
- Add `showAddMilestoneAtDate(taskId, date)` — called from Gantt double-click
- Add highlight sync methods:

```javascript
onTaskSelected: function(taskId) {
  TreeView.selectedTaskId = taskId;
  if (this.currentView === 'gantt') {
    GanttView.selectBar(taskId);
  } else {
    CalendarView.selectBar(taskId);
  }
},

onTaskHovered: function(taskId) {
  if (this.currentView === 'gantt') {
    if (taskId) GanttView.highlightBar(taskId);
    else GanttView.clearHighlight();
  } else {
    if (taskId) CalendarView.highlightBar(taskId);
    else CalendarView.clearHighlight();
  }
},

onGanttTaskClicked: function(taskId) {
  TreeView.highlightTask(taskId);
  TreeView.selectedTaskId = taskId;
  if (this.currentView === 'gantt') {
    GanttView.selectBar(taskId);
  }
},

showColorPicker: function(taskId) {
  var task = TaskManager.getTask(taskId);
  if (!task) return;
  var currentColor = TaskManager.getEffectiveColor(task);
  var self = this;

  var swatchesHtml = TaskManager.COLORS.map(function(c) {
    return '<span class="color-swatch" data-color="' + c + '" style="display:inline-block;width:28px;height:28px;border-radius:50%;cursor:pointer;margin:3px;border:2px solid ' + (c === currentColor ? '#333' : 'transparent') + ';background:' + c + '"></span>';
  }).join('');

  ModalManager.open(
    '<div class="modal-title">选择颜色</div>'
    + '<div style="padding:8px 0;">' + swatchesHtml + '</div>'
    + '<div class="modal-actions">'
    + '<button onclick="ModalManager.close()">取消</button>'
    + '</div>'
  );

  document.querySelectorAll('.color-swatch').forEach(function(sw) {
    sw.addEventListener('click', function() {
      TaskManager.updateTask(taskId, { color: sw.dataset.color });
      ModalManager.close();
      self.renderAll();
    });
  });
},

showAddMilestoneAtDate: function(taskId, date) {
  var self = this;
  var milestone = { date: date };
  ModalManager.showMilestoneForm(null, { taskId: taskId }, function(data) {
    TaskManager.addMilestone(data.taskId, data.name, data.date, data.icon);
    self.renderAll();
  });
  // Pre-fill the date
  var dateInput = document.getElementById('modal-ms-date');
  if (dateInput) dateInput.value = date;
},
```

- [ ] **Step 2: Update _bindToolbar()**

Remove references to deleted buttons. Wire `btn-add-root-task`:

```javascript
document.getElementById('btn-add-root-task').addEventListener('click', function() {
  self.showAddTask(null);
});
```

- [ ] **Step 3: Update _updateStatusBar()**

```javascript
_updateStatusBar: function() {
  var allTasks = TaskManager.getAllTasks();
  var leafTasks = allTasks.filter(function(t) { return TaskManager.getChildren(t.id).length === 0; });
  var done = leafTasks.filter(function(t) { return t.status === 'done'; }).length;
  var inProgress = leafTasks.filter(function(t) { return t.status === 'inProgress'; }).length;
  document.getElementById('status-text').textContent =
    allTasks.length + ' 个任务 · ' + leafTasks.length + ' 个叶子任务（进行中 ' + inProgress + '，已完成 ' + done + '）';
  document.getElementById('status-info').textContent = 'PMWEB v2.0';
},
```

- [ ] **Step 4: Update ModalManager.showTaskForm()**

Update to work with TaskManager instead of ProjectManager. Remove projectId parameter, use parentId instead.

- [ ] **Step 5: Full app verification**

Clear localStorage, refresh, test:
1. Click "新建顶层任务" → creates root task
2. Hover root task → [+] button appears → click to add child
3. Add 3 levels deep → 4th level blocked with alert
4. Gantt shows task bars with correct colors
5. Hover task in sidebar → bar highlights in gantt
6. Click task in sidebar → bar has selection ring, gantt scrolls
7. Click bar in gantt → sidebar item highlights
8. Double-click bar → milestone creation dialog
9. Drag bar left/right → dates update
10. Drag bar edge → resize works
11. Right-click milestone → delete option
12. Switch to calendar → milestones show in red
13. Export → import → all data preserved
14. Status bar shows "PMWEB v2.0"

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: wire App controller for v2 with highlight sync, color picker, milestone interactions"
```

---

## Chunk 5: Polish + Row Merge (Task 9)

### Task 9: Row Merge Drag + Final Polish

**Files:**
- Modify: `index.html`

Add row merge drag support and handle edge cases.

- [ ] **Step 1: Add row merge to DragManager**

Add vertical drag detection to DragManager._onMouseMove():

```javascript
// In _onMouseMove, add row merge detection:
if (this.dragType === 'move') {
  var deltaY = e.clientY - this.startY;
  // If dragged more than half a row height vertically, switch to row-merge mode
  if (Math.abs(deltaY) > 18 && this.dragType === 'move') {
    var targetRowIndex = Math.floor((this.dragElement.offsetTop + deltaY) / 36);
    // Highlight target row
    document.querySelectorAll('.gantt-row').forEach(function(row) {
      row.style.background = '';
    });
    var targetRow = document.querySelector('.gantt-row[data-row-index="' + targetRowIndex + '"]');
    if (targetRow) {
      targetRow.style.background = 'rgba(74, 144, 217, 0.1)';
    }
  }
}
```

On mouseup for row merge: check if tasks overlap in time, if not assign same `ganttRow` value.

- [ ] **Step 2: Handle empty states**

- When all tasks are deleted, show empty state in Gantt and Calendar
- When switching views with no data, show appropriate message

- [ ] **Step 3: Version info in export**

Ensure exported JSON always includes `pmweb_version: 2` and `exported_at` timestamp.

- [ ] **Step 4: Final verification**

Run through all 6 requirements:
1. ✅ Multi-level task tree (3 layers max)
2. ✅ Gantt drag (move, resize, milestone, row merge)
3. ✅ Milestones only in charts, not in tree
4. ✅ Red milestones with white outline
5. ✅ Versioned data format with migration
6. ✅ Hover/click highlight sync between tree and chart

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add row merge drag, polish edge cases, complete PMWEB v2"
```
