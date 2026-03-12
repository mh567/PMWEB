# PMWEB Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency, single-file HTML project management tool with Gantt chart, calendar view, and milestone tracking for XinChuang Linux intranet environments.

**Architecture:** Single `index.html` file containing all HTML, CSS, and JS. JS is organized as plain objects/functions (no ES6 modules) in logical sections: DataStore, ProjectManager, ModalManager, TreeView, GanttView, CalendarView, App. Data persists in localStorage with JSON import/export.

**Tech Stack:** Vanilla HTML5, CSS3 (flexbox, CSS variables), ES6 JavaScript (no modules, no build tools, no dependencies)

**Spec:** `docs/superpowers/specs/2026-03-12-pmweb-design.md`

---

## Chunk 1: Foundation (Tasks 1-3)

### Task 1: HTML Skeleton + CSS Layout

**Files:**
- Create: `index.html`

Build the page shell: toolbar, left panel, right panel, status bar. No functionality yet — just the visual structure.

- [ ] **Step 1: Create index.html with full layout structure**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PMWEB - 项目管理</title>
<style>
/* == 全局变量 == */
:root {
  --color-bg: #f5f6fa;
  --color-surface: #ffffff;
  --color-border: #e0e0e0;
  --color-primary: #4a90d9;
  --color-primary-hover: #357abd;
  --color-text: #333333;
  --color-text-light: #888888;
  --color-danger: #e74c3c;
  --sidebar-width: 260px;
  --toolbar-height: 48px;
  --statusbar-height: 28px;
}

/* == 重置 == */
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, "Microsoft YaHei", "PingFang SC", "Helvetica Neue", sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* == 顶部工具栏 == */
.toolbar {
  height: var(--toolbar-height);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
  flex-shrink: 0;
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.toolbar-separator {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  margin: 0 8px;
}
.toolbar button {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
}
.toolbar button:hover { background: #f0f0f0; }
.toolbar button.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

/* == 主体区域 == */
.main-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* == 左侧面板 == */
.sidebar {
  width: var(--sidebar-width);
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
}
.sidebar-header {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

/* == 右侧主区域 == */
.content-area {
  flex: 1;
  overflow: auto;
  position: relative;
}

/* == 底部状态栏 == */
.statusbar {
  height: var(--statusbar-height);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 12px;
  color: var(--color-text-light);
  flex-shrink: 0;
}
</style>
</head>
<body>

<!-- 顶部工具栏 -->
<div class="toolbar">
  <div class="toolbar-group">
    <button id="btn-manage-projects">项目管理</button>
  </div>
  <div class="toolbar-separator"></div>
  <div class="toolbar-group">
    <button id="btn-import">导入</button>
    <button id="btn-export">导出</button>
  </div>
  <div class="toolbar-separator"></div>
  <div class="toolbar-group">
    <button id="btn-view-gantt" class="active">甘特图</button>
    <button id="btn-view-calendar">日历</button>
  </div>
  <div class="toolbar-separator"></div>
  <div class="toolbar-group">
    <button id="btn-granularity-year">年</button>
    <button id="btn-granularity-month" class="active">月</button>
    <button id="btn-granularity-week">周</button>
  </div>
</div>

<!-- 主体 -->
<div class="main-container">
  <div class="sidebar">
    <div class="sidebar-header">
      <span>任务列表</span>
      <button id="btn-add-task" title="添加任务" style="padding:2px 8px;font-size:16px;border:none;background:none;cursor:pointer;color:var(--color-primary);">+</button>
    </div>
    <div class="sidebar-content" id="tree-container"></div>
  </div>
  <div class="content-area" id="content-area">
    <!-- 甘特图或日历视图渲染在此 -->
  </div>
</div>

<!-- 底部状态栏 -->
<div class="statusbar">
  <span id="status-text">就绪</span>
</div>

<!-- 模态框容器 -->
<div id="modal-overlay" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:1000;display:none;justify-content:center;align-items:center;">
  <div id="modal-content" style="background:#fff;border-radius:8px;padding:24px;min-width:360px;max-width:500px;box-shadow:0 4px 24px rgba(0,0,0,0.15);"></div>
</div>

<script>
// JS 逻辑将在后续任务中添加
</script>
</body>
</html>
```

- [ ] **Step 2: Verify layout in browser**

Run: Open `index.html` in browser
Expected: See toolbar with all buttons at top, left sidebar panel (260px wide), right content area (empty), status bar at bottom. Layout fills the full viewport with no scrollbars.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add HTML skeleton with toolbar, sidebar, content area, and status bar"
```

---

### Task 2: DataStore — localStorage + Import/Export

**Files:**
- Modify: `index.html` (add JS inside `<script>` tag)

Implement the data persistence layer: auto-save to localStorage, JSON export/import with validation.

- [ ] **Step 1: Implement DataStore object**

Add inside the `<script>` tag:

```javascript
// ============================================================
// == DataStore: localStorage 读写、导入导出
// ============================================================
const DataStore = {
  STORAGE_KEY: 'pmweb_data',

  // 默认空数据
  createEmpty() {
    return {
      version: 1,
      projects: [],
      tasks: [],
      milestones: [],
      settings: { lastView: 'gantt', lastGranularity: 'month' }
    };
  },

  // 从 localStorage 加载
  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return this.createEmpty();
      const data = JSON.parse(raw);
      if (!data.version || !Array.isArray(data.projects)) {
        return this.createEmpty();
      }
      return data;
    } catch (e) {
      console.error('DataStore.load failed:', e);
      return this.createEmpty();
    }
  },

  // 保存到 localStorage
  save(data) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('DataStore.save failed:', e);
      alert('数据保存失败，可能 localStorage 已满');
    }
  },

  // 导出为 JSON 文件
  exportJSON(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pmweb-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // 从 JSON 文件导入
  importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          // 校验结构
          if (!data.version || !Array.isArray(data.projects) ||
              !Array.isArray(data.tasks) || !Array.isArray(data.milestones)) {
            reject(new Error('JSON 格式不正确：缺少必要字段'));
            return;
          }
          resolve(data);
        } catch (err) {
          reject(new Error('JSON 解析失败：文件内容无效'));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  },

  // 本地日期格式化（避免 toISOString 的 UTC 时区问题）
  formatDate(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  },

  // 生成 UUID
  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
};
```

- [ ] **Step 2: Verify in browser console**

Run: Open `index.html`, open browser console (F12), type:
```javascript
const d = DataStore.createEmpty();
DataStore.save(d);
console.log(DataStore.load());
```
Expected: Console logs an object with `version: 1`, empty arrays for projects/tasks/milestones, and settings.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add DataStore with localStorage persistence and JSON import/export"
```

---

### Task 3: ProjectManager — CRUD with Validation

**Files:**
- Modify: `index.html` (add JS after DataStore)

Implement all CRUD operations for projects, tasks, and milestones with validation rules from the spec.

- [ ] **Step 1: Implement ProjectManager object**

Add after DataStore in `<script>`:

```javascript
// ============================================================
// == ProjectManager: 项目/任务/里程碑 CRUD
// ============================================================
const ProjectManager = {
  data: null,

  // 预定义项目颜色
  COLORS: ['#4a90d9', '#e67e22', '#2ecc71', '#9b59b6', '#e74c3c', '#1abc9c', '#f39c12', '#3498db', '#e91e63', '#00bcd4', '#8bc34a', '#ff5722'],

  init() {
    this.data = DataStore.load();
  },

  _save() {
    DataStore.save(this.data);
  },

  // -- 项目 CRUD --
  getProjects() {
    return this.data.projects.slice().sort((a, b) => a.order - b.order);
  },

  addProject(name) {
    const project = {
      id: DataStore.uuid(),
      name: name.trim(),
      color: this.COLORS[this.data.projects.length % this.COLORS.length],
      order: this.data.projects.length
    };
    this.data.projects.push(project);
    this._save();
    return project;
  },

  updateProject(id, updates) {
    const project = this.data.projects.find(p => p.id === id);
    if (!project) return null;
    if (updates.name !== undefined) project.name = updates.name.trim();
    if (updates.color !== undefined) project.color = updates.color;
    if (updates.order !== undefined) project.order = updates.order;
    this._save();
    return project;
  },

  deleteProject(id) {
    this.data.projects = this.data.projects.filter(p => p.id !== id);
    // 级联删除任务和里程碑
    const taskIds = this.data.tasks.filter(t => t.projectId === id).map(t => t.id);
    this.data.milestones = this.data.milestones.filter(m => m.taskId == null || !taskIds.includes(m.taskId));
    this.data.milestones = this.data.milestones.filter(m => m.projectId !== id);
    this.data.tasks = this.data.tasks.filter(t => t.projectId !== id);
    this._save();
  },

  // -- 任务 CRUD --
  getTasksByProject(projectId) {
    return this.data.tasks
      .filter(t => t.projectId === projectId)
      .sort((a, b) => a.order - b.order);
  },

  getAllTasks() {
    return this.data.tasks.slice();
  },

  addTask(projectId, name, startDate, endDate) {
    if (endDate < startDate) {
      alert('结束日期不能早于开始日期');
      return null;
    }
    const task = {
      id: DataStore.uuid(),
      projectId,
      name: name.trim(),
      description: '',
      assignee: '',
      startDate,
      endDate,
      status: 'todo',
      order: this.data.tasks.filter(t => t.projectId === projectId).length
    };
    this.data.tasks.push(task);
    this._save();
    return task;
  },

  updateTask(id, updates) {
    const task = this.data.tasks.find(t => t.id === id);
    if (!task) return null;
    const newStart = updates.startDate !== undefined ? updates.startDate : task.startDate;
    const newEnd = updates.endDate !== undefined ? updates.endDate : task.endDate;
    if (newEnd < newStart) {
      alert('结束日期不能早于开始日期');
      return null;
    }
    if (updates.name !== undefined) task.name = updates.name.trim();
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.assignee !== undefined) task.assignee = updates.assignee.trim();
    if (updates.startDate !== undefined) task.startDate = updates.startDate;
    if (updates.endDate !== undefined) task.endDate = updates.endDate;
    if (updates.status !== undefined) task.status = updates.status;
    if (updates.order !== undefined) task.order = updates.order;
    this._save();
    return task;
  },

  deleteTask(id) {
    this.data.tasks = this.data.tasks.filter(t => t.id !== id);
    this.data.milestones = this.data.milestones.filter(m => m.taskId !== id);
    this._save();
  },

  // -- 里程碑 CRUD --
  getMilestonesByTask(taskId) {
    return this.data.milestones.filter(m => m.taskId === taskId).sort((a, b) => a.date.localeCompare(b.date));
  },

  getMilestonesByProject(projectId) {
    return this.data.milestones.filter(m => m.projectId === projectId && !m.taskId).sort((a, b) => a.date.localeCompare(b.date));
  },

  getAllMilestones() {
    return this.data.milestones.slice();
  },

  addMilestone(name, date, icon, { taskId, projectId }) {
    // 任务级里程碑需要校验日期范围
    if (taskId) {
      const task = this.data.tasks.find(t => t.id === taskId);
      if (task && (date < task.startDate || date > task.endDate)) {
        alert('里程碑日期必须在任务的时间范围内');
        return null;
      }
    }
    const milestone = {
      id: DataStore.uuid(),
      taskId: taskId || null,
      projectId: projectId || null,
      name: name.trim(),
      date,
      icon: icon || '◆'
    };
    this.data.milestones.push(milestone);
    this._save();
    return milestone;
  },

  updateMilestone(id, updates) {
    const milestone = this.data.milestones.find(m => m.id === id);
    if (!milestone) return null;
    const newDate = updates.date !== undefined ? updates.date : milestone.date;
    // 校验任务级里程碑日期范围
    if (milestone.taskId) {
      const task = this.data.tasks.find(t => t.id === milestone.taskId);
      if (task && (newDate < task.startDate || newDate > task.endDate)) {
        alert('里程碑日期必须在任务的时间范围内');
        return null;
      }
    }
    if (updates.name !== undefined) milestone.name = updates.name.trim();
    if (updates.date !== undefined) milestone.date = updates.date;
    if (updates.icon !== undefined) milestone.icon = updates.icon;
    this._save();
    return milestone;
  },

  deleteMilestone(id) {
    this.data.milestones = this.data.milestones.filter(m => m.id !== id);
    this._save();
  },

  // -- 设置 --
  getSetting(key) {
    return this.data.settings[key];
  },

  setSetting(key, value) {
    this.data.settings[key] = value;
    this._save();
  },

  // -- 导入 --
  replaceData(newData) {
    this.data = newData;
    this._save();
  }
};
```

- [ ] **Step 2: Verify in browser console**

Run: Open `index.html`, in console:
```javascript
ProjectManager.init();
const p = ProjectManager.addProject('测试项目');
const t = ProjectManager.addTask(p.id, '任务1', '2026-03-01', '2026-03-15');
const m = ProjectManager.addMilestone('需求确认', '2026-03-05', '◆', { taskId: t.id });
console.log(ProjectManager.getProjects());
console.log(ProjectManager.getTasksByProject(p.id));
console.log(ProjectManager.getMilestonesByTask(t.id));
```
Expected: Console logs arrays with the created project, task, and milestone. Data persists after page refresh.

- [ ] **Step 3: Test validation — endDate before startDate**

Run: In console:
```javascript
ProjectManager.addTask(ProjectManager.getProjects()[0].id, '非法任务', '2026-03-15', '2026-03-01');
```
Expected: Alert "结束日期不能早于开始日期", returns null.

- [ ] **Step 4: Test validation — milestone out of task range**

Run: In console:
```javascript
const tasks = ProjectManager.getAllTasks();
ProjectManager.addMilestone('越界', '2026-04-01', '◆', { taskId: tasks[0].id });
```
Expected: Alert "里程碑日期必须在任务的时间范围内", returns null.

- [ ] **Step 5: Test cascade delete**

Run: In console:
```javascript
const projects = ProjectManager.getProjects();
ProjectManager.deleteProject(projects[0].id);
console.log(ProjectManager.getAllTasks().length); // 0
console.log(ProjectManager.getAllMilestones().length); // 0
```
Expected: All tasks and milestones under the deleted project are gone.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add ProjectManager with CRUD and validation for projects, tasks, milestones"
```

---

## Chunk 2: UI Components (Tasks 4-5)

### Task 4: ModalManager — Dialog System

**Files:**
- Modify: `index.html` (add CSS + JS)

Build a reusable modal dialog system for create/edit/delete confirmations.

- [ ] **Step 1: Add modal CSS**

Add to the `<style>` section:

```css
/* == 模态框 == */
.modal-overlay {
  display: none;
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.4);
  z-index: 1000;
  justify-content: center;
  align-items: center;
}
.modal-overlay.active {
  display: flex;
}
.modal-box {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  min-width: 360px;
  max-width: 500px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.15);
}
.modal-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}
.modal-field {
  margin-bottom: 12px;
}
.modal-field label {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 4px;
}
.modal-field input,
.modal-field select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 14px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.modal-actions button {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  font-size: 13px;
}
.modal-actions .btn-primary {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.modal-actions .btn-primary:hover { background: var(--color-primary-hover); }
.modal-actions .btn-danger {
  background: var(--color-danger);
  color: #fff;
  border-color: var(--color-danger);
}
```

- [ ] **Step 2: Update HTML — replace inline modal with class-based**

Replace the existing `modal-overlay` div in the HTML body with:

```html
<div class="modal-overlay" id="modal-overlay">
  <div class="modal-box" id="modal-content"></div>
</div>
```

- [ ] **Step 3: Implement ModalManager object**

Add after ProjectManager in `<script>`:

```javascript
// ============================================================
// == ModalManager: 模态框管理
// ============================================================
const ModalManager = {
  overlay: null,
  content: null,

  init() {
    this.overlay = document.getElementById('modal-overlay');
    this.content = document.getElementById('modal-content');
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  },

  open(html) {
    this.content.innerHTML = html;
    this.overlay.classList.add('active');
  },

  close() {
    this.overlay.classList.remove('active');
    this.content.innerHTML = '';
  },

  // 确认对话框
  confirm(message, onConfirm) {
    this.open(`
      <div class="modal-title">确认</div>
      <p style="margin-bottom:16px;font-size:14px;">${message}</p>
      <div class="modal-actions">
        <button onclick="ModalManager.close()">取消</button>
        <button class="btn-danger" id="modal-confirm-btn">确定</button>
      </div>
    `);
    document.getElementById('modal-confirm-btn').addEventListener('click', () => {
      this.close();
      onConfirm();
    });
  },

  // 项目编辑表单
  showProjectForm(project, onSave) {
    const isEdit = !!project;
    const title = isEdit ? '编辑项目' : '新建项目';
    const name = isEdit ? project.name : '';
    const color = isEdit ? project.color : ProjectManager.COLORS[ProjectManager.data.projects.length % ProjectManager.COLORS.length];

    this.open(`
      <div class="modal-title">${title}</div>
      <div class="modal-field">
        <label>项目名称</label>
        <input type="text" id="modal-project-name" value="${name}" placeholder="请输入项目名称">
      </div>
      <div class="modal-field">
        <label>项目颜色</label>
        <input type="color" id="modal-project-color" value="${color}" style="width:60px;height:32px;padding:2px;">
      </div>
      <div class="modal-actions">
        <button onclick="ModalManager.close()">取消</button>
        <button class="btn-primary" id="modal-save-btn">保存</button>
      </div>
    `);

    document.getElementById('modal-save-btn').addEventListener('click', () => {
      const nameVal = document.getElementById('modal-project-name').value.trim();
      const colorVal = document.getElementById('modal-project-color').value;
      if (!nameVal) { alert('请输入项目名称'); return; }
      this.close();
      onSave({ name: nameVal, color: colorVal });
    });
  },

  // 任务编辑表单
  showTaskForm(task, projectId, onSave) {
    const isEdit = !!task;
    const title = isEdit ? '编辑任务' : '新建任务';
    const name = isEdit ? task.name : '';
    const description = isEdit ? (task.description || '') : '';
    const assignee = isEdit ? (task.assignee || '') : '';
    const startDate = isEdit ? task.startDate : DataStore.formatDate(new Date());
    const endDate = isEdit ? task.endDate : DataStore.formatDate(new Date(Date.now() + 7 * 86400000));
    const status = isEdit ? task.status : 'todo';

    this.open(`
      <div class="modal-title">${title}</div>
      <div class="modal-field">
        <label>任务名称</label>
        <input type="text" id="modal-task-name" value="${name}" placeholder="请输入任务名称">
      </div>
      <div class="modal-field">
        <label>负责人</label>
        <input type="text" id="modal-task-assignee" value="${assignee}" placeholder="请输入负责人（可选）">
      </div>
      <div class="modal-field">
        <label>描述/备注</label>
        <textarea id="modal-task-desc" rows="3" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:4px;font-size:14px;resize:vertical;" placeholder="请输入描述（可选）">${description}</textarea>
      </div>
      <div class="modal-field">
        <label>开始日期</label>
        <input type="date" id="modal-task-start" value="${startDate}">
      </div>
      <div class="modal-field">
        <label>结束日期</label>
        <input type="date" id="modal-task-end" value="${endDate}">
      </div>
      <div class="modal-field">
        <label>状态</label>
        <select id="modal-task-status">
          <option value="todo" ${status === 'todo' ? 'selected' : ''}>待办</option>
          <option value="inProgress" ${status === 'inProgress' ? 'selected' : ''}>进行中</option>
          <option value="done" ${status === 'done' ? 'selected' : ''}>已完成</option>
        </select>
      </div>
      <div class="modal-actions">
        <button onclick="ModalManager.close()">取消</button>
        <button class="btn-primary" id="modal-save-btn">保存</button>
      </div>
    `);

    document.getElementById('modal-save-btn').addEventListener('click', () => {
      const nameVal = document.getElementById('modal-task-name').value.trim();
      const descVal = document.getElementById('modal-task-desc').value;
      const assigneeVal = document.getElementById('modal-task-assignee').value.trim();
      const startVal = document.getElementById('modal-task-start').value;
      const endVal = document.getElementById('modal-task-end').value;
      const statusVal = document.getElementById('modal-task-status').value;
      if (!nameVal) { alert('请输入任务名称'); return; }
      if (!startVal || !endVal) { alert('请选择日期'); return; }
      this.close();
      onSave({ name: nameVal, description: descVal, assignee: assigneeVal, startDate: startVal, endDate: endVal, status: statusVal, projectId });
    });
  },

  // 里程碑编辑表单
  showMilestoneForm(milestone, parentInfo, onSave) {
    const isEdit = !!milestone;
    const title = isEdit ? '编辑里程碑' : '新建里程碑';
    const name = isEdit ? milestone.name : '';
    const date = isEdit ? milestone.date : DataStore.formatDate(new Date());
    const icon = isEdit ? milestone.icon : '◆';

    this.open(`
      <div class="modal-title">${title}</div>
      <div class="modal-field">
        <label>里程碑名称</label>
        <input type="text" id="modal-ms-name" value="${name}" placeholder="请输入名称">
      </div>
      <div class="modal-field">
        <label>日期</label>
        <input type="date" id="modal-ms-date" value="${date}">
      </div>
      <div class="modal-field">
        <label>图标</label>
        <select id="modal-ms-icon">
          <option value="◆" ${icon === '◆' ? 'selected' : ''}>◆ 菱形</option>
          <option value="★" ${icon === '★' ? 'selected' : ''}>★ 星形</option>
          <option value="●" ${icon === '●' ? 'selected' : ''}>● 圆形</option>
          <option value="▲" ${icon === '▲' ? 'selected' : ''}>▲ 三角</option>
        </select>
      </div>
      <div class="modal-actions">
        <button onclick="ModalManager.close()">取消</button>
        <button class="btn-primary" id="modal-save-btn">保存</button>
      </div>
    `);

    document.getElementById('modal-save-btn').addEventListener('click', () => {
      const nameVal = document.getElementById('modal-ms-name').value.trim();
      const dateVal = document.getElementById('modal-ms-date').value;
      const iconVal = document.getElementById('modal-ms-icon').value;
      if (!nameVal) { alert('请输入名称'); return; }
      if (!dateVal) { alert('请选择日期'); return; }
      this.close();
      onSave({ name: nameVal, date: dateVal, icon: iconVal, ...parentInfo });
    });
  }
};
```

- [ ] **Step 4: Verify modal open/close**

Run: Open `index.html`, in console:
```javascript
ModalManager.init();
ModalManager.showProjectForm(null, (data) => console.log('save:', data));
```
Expected: Modal dialog appears with project form. Clicking "取消" closes it. Filling form and clicking "保存" logs the data.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add ModalManager with project, task, and milestone form dialogs"
```

---

### Task 5: TreeView — Sidebar Task List

**Files:**
- Modify: `index.html` (add CSS + JS)

Build the left sidebar tree view: projects as collapsible groups, tasks as items, right-click context menu.

- [ ] **Step 1: Add tree view and context menu CSS**

Add to `<style>`:

```css
/* == 树形列表 == */
.tree-project {
  border-bottom: 1px solid var(--color-border);
}
.tree-project-header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  gap: 6px;
}
.tree-project-header:hover { background: #f5f5f5; }
.tree-project-header .arrow {
  font-size: 10px;
  transition: transform 0.15s;
  color: var(--color-text-light);
}
.tree-project-header .arrow.collapsed { transform: rotate(-90deg); }
.tree-project-header .color-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tree-project-tasks {
  overflow: hidden;
}
.tree-project-tasks.collapsed {
  display: none;
}
.tree-task {
  display: flex;
  align-items: center;
  padding: 6px 16px 6px 36px;
  cursor: pointer;
  font-size: 13px;
  gap: 6px;
}
.tree-task:hover { background: #f0f4ff; }
.tree-task.selected { background: #e3ecfa; }
.tree-task .status-icon {
  font-size: 11px;
  flex-shrink: 0;
}
.tree-task .task-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-milestone-list {
  padding-left: 48px;
}
.tree-milestone {
  display: flex;
  align-items: center;
  padding: 3px 16px 3px 0;
  font-size: 12px;
  color: var(--color-text-light);
  gap: 4px;
  cursor: pointer;
}
.tree-milestone:hover { color: var(--color-text); }

/* == 右键菜单 == */
.context-menu {
  display: none;
  position: fixed;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.12);
  z-index: 2000;
  min-width: 140px;
  padding: 4px 0;
}
.context-menu.active { display: block; }
.context-menu-item {
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}
.context-menu-item:hover { background: #f0f4ff; }
.context-menu-item.danger { color: var(--color-danger); }
```

- [ ] **Step 2: Add context menu HTML**

Add before `</body>`:

```html
<div class="context-menu" id="context-menu"></div>
```

- [ ] **Step 3: Implement TreeView object**

Add after ModalManager in `<script>`:

```javascript
// ============================================================
// == TreeView: 左侧树形任务列表
// ============================================================
const TreeView = {
  container: null,
  contextMenu: null,
  collapsedProjects: new Set(),
  selectedTaskId: null,

  init() {
    this.container = document.getElementById('tree-container');
    this.contextMenu = document.getElementById('context-menu');

    // 点击空白处关闭右键菜单
    document.addEventListener('click', () => this.hideContextMenu());
  },

  render() {
    const projects = ProjectManager.getProjects();
    if (projects.length === 0) {
      this.container.innerHTML = '<div style="padding:24px 16px;color:var(--color-text-light);font-size:13px;text-align:center;">暂无项目<br>点击「项目管理」创建</div>';
      return;
    }

    let html = '';
    projects.forEach(project => {
      const tasks = ProjectManager.getTasksByProject(project.id);
      const isCollapsed = this.collapsedProjects.has(project.id);
      const projectMilestones = ProjectManager.getMilestonesByProject(project.id);

      html += `<div class="tree-project" data-project-id="${project.id}">`;
      html += `<div class="tree-project-header" data-project-id="${project.id}">`;
      html += `<span class="arrow ${isCollapsed ? 'collapsed' : ''}">▼</span>`;
      html += `<span class="color-dot" style="background:${project.color}"></span>`;
      html += `<span style="flex:1">${this._escapeHtml(project.name)}</span>`;
      html += `</div>`;

      html += `<div class="tree-project-tasks ${isCollapsed ? 'collapsed' : ''}">`;

      // 项目级里程碑
      projectMilestones.forEach(ms => {
        html += `<div class="tree-milestone" data-milestone-id="${ms.id}" data-project-id="${project.id}">`;
        html += `<span>${ms.icon}</span>`;
        html += `<span>${this._escapeHtml(ms.name)}</span>`;
        html += `<span style="margin-left:auto;font-size:11px;">${ms.date.slice(5)}</span>`;
        html += `</div>`;
      });

      tasks.forEach(task => {
        const statusIcon = task.status === 'done' ? '✓' : task.status === 'inProgress' ? '►' : '○';
        const statusColor = task.status === 'done' ? '#2ecc71' : task.status === 'inProgress' ? '#f39c12' : '#ccc';
        const selected = this.selectedTaskId === task.id ? ' selected' : '';

        html += `<div class="tree-task${selected}" data-task-id="${task.id}" data-project-id="${project.id}">`;
        html += `<span class="status-icon" style="color:${statusColor}">${statusIcon}</span>`;
        html += `<span class="task-name">${this._escapeHtml(task.name)}</span>`;
        if (task.assignee) html += `<span style="font-size:11px;color:var(--color-text-light);flex-shrink:0;">${this._escapeHtml(task.assignee)}</span>`;
        html += `</div>`;

        // 任务级里程碑
        const taskMilestones = ProjectManager.getMilestonesByTask(task.id);
        if (taskMilestones.length > 0) {
          html += `<div class="tree-milestone-list">`;
          taskMilestones.forEach(ms => {
            html += `<div class="tree-milestone" data-milestone-id="${ms.id}" data-task-id="${task.id}">`;
            html += `<span>${ms.icon}</span>`;
            html += `<span>${this._escapeHtml(ms.name)}</span>`;
            html += `<span style="margin-left:auto;font-size:11px;">${ms.date.slice(5)}</span>`;
            html += `</div>`;
          });
          html += `</div>`;
        }
      });

      html += `</div></div>`;
    });

    this.container.innerHTML = html;
    this._bindEvents();
  },

  _bindEvents() {
    // 折叠/展开项目
    this.container.querySelectorAll('.tree-project-header').forEach(el => {
      el.addEventListener('click', (e) => {
        const projectId = el.dataset.projectId;
        if (this.collapsedProjects.has(projectId)) {
          this.collapsedProjects.delete(projectId);
        } else {
          this.collapsedProjects.add(projectId);
        }
        this.render();
      });

      // 项目右键菜单
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, [
          { label: '添加任务', action: () => App.showAddTask(el.dataset.projectId) },
          { label: '添加里程碑', action: () => App.showAddProjectMilestone(el.dataset.projectId) },
          { label: '编辑项目', action: () => App.showEditProject(el.dataset.projectId) },
          { label: '删除项目', action: () => App.deleteProject(el.dataset.projectId), danger: true }
        ]);
      });
    });

    // 点击任务
    this.container.querySelectorAll('.tree-task').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedTaskId = el.dataset.taskId;
        this.render();
      });

      // 任务右键菜单
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, [
          { label: '添加里程碑', action: () => App.showAddTaskMilestone(el.dataset.taskId) },
          { label: '编辑任务', action: () => App.showEditTask(el.dataset.taskId) },
          { label: '删除任务', action: () => App.deleteTask(el.dataset.taskId), danger: true }
        ]);
      });
    });

    // 里程碑点击编辑
    this.container.querySelectorAll('.tree-milestone').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        App.showEditMilestone(el.dataset.milestoneId);
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e.clientX, e.clientY, [
          { label: '编辑里程碑', action: () => App.showEditMilestone(el.dataset.milestoneId) },
          { label: '删除里程碑', action: () => App.deleteMilestone(el.dataset.milestoneId), danger: true }
        ]);
      });
    });
  },

  showContextMenu(x, y, items) {
    let html = '';
    items.forEach(item => {
      const cls = item.danger ? ' danger' : '';
      html += `<div class="context-menu-item${cls}" data-action="${item.label}">${item.label}</div>`;
    });
    this.contextMenu.innerHTML = html;
    this.contextMenu.style.left = x + 'px';
    this.contextMenu.style.top = y + 'px';
    this.contextMenu.classList.add('active');

    this.contextMenu.querySelectorAll('.context-menu-item').forEach((el, i) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideContextMenu();
        items[i].action();
      });
    });
  },

  hideContextMenu() {
    this.contextMenu.classList.remove('active');
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
```

- [ ] **Step 4: Verify tree renders with test data**

Run: Open `index.html`, in console:
```javascript
ProjectManager.init();
const p1 = ProjectManager.addProject('前端开发');
const p2 = ProjectManager.addProject('后端开发');
ProjectManager.addTask(p1.id, '登录页面', '2026-03-01', '2026-03-10');
ProjectManager.addTask(p1.id, '仪表盘', '2026-03-05', '2026-03-20');
ProjectManager.addTask(p2.id, 'API开发', '2026-03-01', '2026-03-15');
ModalManager.init();
TreeView.init();
TreeView.render();
```
Expected: Left sidebar shows two project groups with tasks. Clicking project header collapses/expands. Right-click shows context menu.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add TreeView with collapsible projects, tasks, context menu"
```

---

## Chunk 3: Gantt Chart View (Task 6)

### Task 6: GanttView — Timeline Rendering

**Files:**
- Modify: `index.html` (add CSS + JS)

Build the core Gantt chart: time axis header, task bars with project colors, milestone diamonds, granularity switching (year/month/week).

- [ ] **Step 1: Add Gantt chart CSS**

Add to `<style>`:

```css
/* == 甘特图 == */
.gantt-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.gantt-header {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}
.gantt-header-cell {
  flex-shrink: 0;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-light);
  border-right: 1px solid #eee;
  padding: 6px 0;
  position: relative;
}
.gantt-body {
  flex: 1;
  overflow: auto;
  position: relative;
}
.gantt-row {
  display: flex;
  position: relative;
  height: 36px;
  border-bottom: 1px solid #f0f0f0;
  align-items: center;
}
.gantt-row:hover { background: #fafbfe; }
.gantt-grid-cell {
  flex-shrink: 0;
  height: 100%;
  border-right: 1px solid #f0f0f0;
}
.gantt-grid-cell.today {
  background: rgba(74, 144, 217, 0.06);
}
.gantt-grid-cell.weekend {
  background: rgba(0,0,0,0.02);
}
.gantt-bar {
  position: absolute;
  height: 20px;
  border-radius: 3px;
  top: 8px;
  cursor: pointer;
  font-size: 11px;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 6px;
  overflow: hidden;
  white-space: nowrap;
  min-width: 4px;
}
.gantt-bar:hover { filter: brightness(1.1); }
.gantt-bar.status-done { opacity: 0.6; }
.gantt-milestone {
  position: absolute;
  top: 6px;
  width: 16px; height: 16px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  transform: translateX(-8px);
}
.gantt-milestone:hover { transform: translateX(-8px) scale(1.3); }
.gantt-milestone-row {
  height: 28px;
  background: #fafafa;
}
.gantt-today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-danger);
  z-index: 5;
  pointer-events: none;
}
```

- [ ] **Step 2: Implement GanttView object**

Add after TreeView in `<script>`:

```javascript
// ============================================================
// == GanttView: 甘特图渲染、时间轴计算、粒度切换
// ============================================================
const GanttView = {
  container: null,
  granularity: 'month', // 'year' | 'month' | 'week'
  cellWidth: 80,
  startDate: null,
  endDate: null,
  cells: [],

  init(container) {
    this.container = container;
  },

  setGranularity(g) {
    this.granularity = g;
    this.render();
  },

  // 计算时间范围
  _calcDateRange() {
    const tasks = ProjectManager.getAllTasks();
    const milestones = ProjectManager.getAllMilestones();
    const allDates = [];

    tasks.forEach(t => { allDates.push(t.startDate, t.endDate); });
    milestones.forEach(m => { allDates.push(m.date); });

    if (allDates.length === 0) {
      // 默认显示当前月
      const now = new Date();
      this.startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      this.endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      return;
    }

    allDates.sort();
    const minDate = new Date(allDates[0]);
    const maxDate = new Date(allDates[allDates.length - 1]);

    // 根据粒度添加前后边距
    const pad = this.granularity === 'year' ? 30 : this.granularity === 'month' ? 14 : 7;
    this.startDate = new Date(minDate);
    this.startDate.setDate(this.startDate.getDate() - pad);
    this.endDate = new Date(maxDate);
    this.endDate.setDate(this.endDate.getDate() + pad);

    // 对齐到合适的边界
    if (this.granularity === 'year') {
      this.startDate.setDate(1);
    } else if (this.granularity === 'month') {
      // 对齐到周一
      const day = this.startDate.getDay();
      this.startDate.setDate(this.startDate.getDate() - ((day + 6) % 7));
    }
  },

  // 生成时间轴单元格
  _generateCells() {
    this.cells = [];
    const d = new Date(this.startDate);

    if (this.granularity === 'year') {
      // 每月一个单元格
      this.cellWidth = 80;
      d.setDate(1);
      while (d <= this.endDate) {
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const start = new Date(d);
        d.setMonth(d.getMonth() + 1);
        const end = new Date(d);
        end.setDate(end.getDate() - 1);
        this.cells.push({ label, start, end, days: this._daysBetween(start, end) + 1 });
      }
    } else if (this.granularity === 'month') {
      // 每周一个单元格
      this.cellWidth = 80;
      // 对齐到周一
      const day = d.getDay();
      d.setDate(d.getDate() - ((day + 6) % 7));
      while (d <= this.endDate) {
        const start = new Date(d);
        d.setDate(d.getDate() + 7);
        const end = new Date(d);
        end.setDate(end.getDate() - 1);
        const weekNum = this._getWeekNumber(start);
        const label = `W${weekNum}`;
        this.cells.push({ label, start, end, days: 7 });
      }
    } else {
      // week: 每天一个单元格
      this.cellWidth = 40;
      while (d <= this.endDate) {
        const start = new Date(d);
        const dayNum = d.getDate();
        const dayOfWeek = d.getDay();
        const label = `${d.getMonth() + 1}/${dayNum}`;
        this.cells.push({ label, start, end: new Date(d), days: 1, isWeekend: dayOfWeek === 0 || dayOfWeek === 6 });
        d.setDate(d.getDate() + 1);
      }
    }
  },

  // 日期转像素位置
  _dateToX(dateStr) {
    const date = new Date(dateStr);
    const totalDays = this._daysBetween(this.startDate, this.endDate);
    const dayOffset = this._daysBetween(this.startDate, date);
    const totalWidth = this.cells.reduce((sum, c) => sum + this.cellWidth, 0);
    return (dayOffset / totalDays) * totalWidth;
  },

  // 日期范围转宽度
  _dateRangeToWidth(startStr, endStr) {
    const x1 = this._dateToX(startStr);
    const x2 = this._dateToX(endStr);
    const oneDayWidth = this._dateToX(
      DataStore.formatDate(new Date(new Date(startStr).getTime() + 86400000))
    ) - this._dateToX(startStr);
    return Math.max(x2 - x1 + oneDayWidth, 4);
  },

  _daysBetween(d1, d2) {
    const t1 = new Date(d1).setHours(0, 0, 0, 0);
    const t2 = new Date(d2).setHours(0, 0, 0, 0);
    return Math.round((t2 - t1) / 86400000);
  },

  _getWeekNumber(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  },

  _formatDate(dateStr) {
    return dateStr;
  },

  render() {
    this._calcDateRange();
    this._generateCells();

    const projects = ProjectManager.getProjects();
    const totalWidth = this.cells.length * this.cellWidth;
    const today = DataStore.formatDate(new Date());

    // 构建 header
    let headerHtml = '<div class="gantt-header" style="width:' + totalWidth + 'px;">';
    this.cells.forEach(cell => {
      headerHtml += `<div class="gantt-header-cell" style="width:${this.cellWidth}px;">${cell.label}</div>`;
    });
    headerHtml += '</div>';

    // 构建 body
    let bodyHtml = '<div class="gantt-body"><div style="position:relative;width:' + totalWidth + 'px;">';

    // Today line
    const todayX = this._dateToX(today);
    if (todayX >= 0 && todayX <= totalWidth) {
      bodyHtml += `<div class="gantt-today-line" style="left:${todayX}px;"></div>`;
    }

    projects.forEach(project => {
      const tasks = ProjectManager.getTasksByProject(project.id);
      const projectMilestones = ProjectManager.getMilestonesByProject(project.id);

      // 项目级里程碑行
      if (projectMilestones.length > 0) {
        bodyHtml += `<div class="gantt-row gantt-milestone-row" style="width:${totalWidth}px;">`;
        // 网格背景
        this.cells.forEach(cell => {
          const cls = cell.isWeekend ? ' weekend' : '';
          bodyHtml += `<div class="gantt-grid-cell${cls}" style="width:${this.cellWidth}px;"></div>`;
        });
        projectMilestones.forEach(ms => {
          const x = this._dateToX(ms.date);
          bodyHtml += `<div class="gantt-milestone" style="left:${x}px;color:${project.color};" data-milestone-id="${ms.id}" title="${this._escapeHtml(ms.name)} (${ms.date})">${ms.icon}</div>`;
        });
        bodyHtml += '</div>';
      }

      tasks.forEach(task => {
        bodyHtml += `<div class="gantt-row" style="width:${totalWidth}px;">`;
        // 网格背景
        this.cells.forEach(cell => {
          const cls = cell.isWeekend ? ' weekend' : '';
          bodyHtml += `<div class="gantt-grid-cell${cls}" style="width:${this.cellWidth}px;"></div>`;
        });

        // 任务条
        const barX = this._dateToX(task.startDate);
        const barW = this._dateRangeToWidth(task.startDate, task.endDate);
        const statusCls = task.status === 'done' ? ' status-done' : '';
        const assigneeText = task.assignee ? ` [${this._escapeHtml(task.assignee)}]` : '';
        bodyHtml += `<div class="gantt-bar${statusCls}" style="left:${barX}px;width:${barW}px;background:${project.color};" data-task-id="${task.id}" title="${this._escapeHtml(task.name)}${assigneeText} (${task.startDate} ~ ${task.endDate})">${this._escapeHtml(task.name)}</div>`;

        // 任务级里程碑
        const taskMilestones = ProjectManager.getMilestonesByTask(task.id);
        taskMilestones.forEach(ms => {
          const msX = this._dateToX(ms.date);
          bodyHtml += `<div class="gantt-milestone" style="left:${msX}px;color:${project.color};" data-milestone-id="${ms.id}" title="${this._escapeHtml(ms.name)} (${ms.date})">${ms.icon}</div>`;
        });

        bodyHtml += '</div>';
      });
    });

    bodyHtml += '</div></div>';

    this.container.innerHTML = `<div class="gantt-container">${headerHtml}${bodyHtml}</div>`;

    // 绑定点击事件
    this.container.querySelectorAll('.gantt-bar').forEach(el => {
      el.addEventListener('click', () => App.showEditTask(el.dataset.taskId));
    });
    this.container.querySelectorAll('.gantt-milestone').forEach(el => {
      el.addEventListener('click', () => App.showEditMilestone(el.dataset.milestoneId));
    });

    // 滚动到 today
    const ganttBody = this.container.querySelector('.gantt-body');
    if (ganttBody && todayX > 0) {
      ganttBody.scrollLeft = Math.max(0, todayX - ganttBody.clientWidth / 2);
    }
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
```

- [ ] **Step 3: Verify Gantt renders**

Run: Open `index.html`, in console:
```javascript
// Clear old data first
localStorage.removeItem('pmweb_data');
ProjectManager.init();
const p = ProjectManager.addProject('测试项目');
ProjectManager.addTask(p.id, '设计阶段', '2026-03-01', '2026-03-10');
ProjectManager.addTask(p.id, '开发阶段', '2026-03-08', '2026-03-25');
ProjectManager.addTask(p.id, '测试阶段', '2026-03-20', '2026-03-31');
const t = ProjectManager.getAllTasks()[0];
ProjectManager.addMilestone('需求评审', '2026-03-05', '◆', { taskId: t.id });
ProjectManager.addMilestone('一期上线', '2026-03-28', '★', { projectId: p.id });
ModalManager.init();
TreeView.init();
GanttView.init(document.getElementById('content-area'));
GanttView.render();
TreeView.render();
```
Expected: Right panel shows Gantt chart with three colored task bars, diamond milestone on first task, star milestone in separate row. Today line visible as red vertical line.

- [ ] **Step 4: Test granularity switching**

Run: In console:
```javascript
GanttView.setGranularity('year');
// Then:
GanttView.setGranularity('week');
// Then:
GanttView.setGranularity('month');
```
Expected: Header labels change — year shows months (2026-03), month shows week numbers (W10), week shows daily dates (3/1). Cell widths adjust.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add GanttView with task bars, milestones, granularity switching, today line"
```

---

## Chunk 4: Calendar View + App Controller (Tasks 7-8)

### Task 7: CalendarView — Monthly Grid

**Files:**
- Modify: `index.html` (add CSS + JS)

Build the monthly calendar grid showing tasks as colored bars and milestones as icons.

- [ ] **Step 1: Add calendar CSS**

Add to `<style>`:

```css
/* == 日历视图 == */
.calendar-container {
  padding: 16px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.calendar-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.calendar-nav button {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  cursor: pointer;
  font-size: 14px;
}
.calendar-nav button:hover { background: #f0f0f0; }
.calendar-nav .month-label {
  font-size: 16px;
  font-weight: 600;
  min-width: 120px;
  text-align: center;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: 1;
  gap: 1px;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}
.calendar-weekday {
  background: #f8f9fa;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-light);
  padding: 8px 4px;
}
.calendar-day {
  background: var(--color-surface);
  min-height: 80px;
  padding: 4px;
  cursor: pointer;
  overflow: hidden;
}
.calendar-day:hover { background: #f8f9fc; }
.calendar-day.other-month {
  background: #fafafa;
  color: #ccc;
}
.calendar-day.today {
  background: #f0f4ff;
}
.calendar-day-number {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}
.calendar-task-bar {
  font-size: 10px;
  color: #fff;
  padding: 1px 4px;
  border-radius: 2px;
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.calendar-milestone-item {
  font-size: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  color: var(--color-text);
}
.calendar-milestone-item:hover { font-weight: 600; }
```

- [ ] **Step 2: Implement CalendarView object**

Add after GanttView in `<script>`:

```javascript
// ============================================================
// == CalendarView: 月历渲染
// ============================================================
const CalendarView = {
  container: null,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),

  init(container) {
    this.container = container;
  },

  render() {
    const year = this.currentYear;
    const month = this.currentMonth;
    const today = new Date();
    const todayStr = DataStore.formatDate(today);

    // 月份导航
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    let html = `<div class="calendar-container">`;
    html += `<div class="calendar-nav">`;
    html += `<button id="cal-prev-month">◀</button>`;
    html += `<span class="month-label">${year}年 ${monthNames[month]}</span>`;
    html += `<button id="cal-next-month">▶</button>`;
    html += `</div>`;

    // 网格
    html += `<div class="calendar-grid">`;

    // 星期头
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    weekdays.forEach(d => {
      html += `<div class="calendar-weekday">${d}</div>`;
    });

    // 计算日期范围
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    // 周一为起始
    let startDay = new Date(firstDay);
    const dayOfWeek = (firstDay.getDay() + 6) % 7; // 周一=0
    startDay.setDate(startDay.getDate() - dayOfWeek);

    // 获取所有任务和里程碑
    const allTasks = ProjectManager.getAllTasks();
    const allMilestones = ProjectManager.getAllMilestones();
    const projects = {};
    ProjectManager.getProjects().forEach(p => { projects[p.id] = p; });

    // 渲染6周
    for (let i = 0; i < 42; i++) {
      const date = new Date(startDay);
      date.setDate(date.getDate() + i);
      const dateStr = DataStore.formatDate(date);
      const isCurrentMonth = date.getMonth() === month;
      const isToday = dateStr === todayStr;

      let cls = 'calendar-day';
      if (!isCurrentMonth) cls += ' other-month';
      if (isToday) cls += ' today';

      html += `<div class="${cls}" data-date="${dateStr}">`;
      html += `<div class="calendar-day-number">${date.getDate()}</div>`;

      if (isCurrentMonth || true) {
        // 当天的任务
        allTasks.forEach(task => {
          if (dateStr >= task.startDate && dateStr <= task.endDate) {
            const project = projects[task.projectId];
            if (project) {
              const opacity = task.status === 'done' ? '0.5' : '1';
              // 只在起始日或每周一显示名称
              const showName = dateStr === task.startDate || date.getDay() === 1;
              html += `<div class="calendar-task-bar" style="background:${project.color};opacity:${opacity};" data-task-id="${task.id}" title="${this._escapeHtml(task.name)}">${showName ? this._escapeHtml(task.name) : '&nbsp;'}</div>`;
            }
          }
        });

        // 当天的里程碑
        allMilestones.forEach(ms => {
          if (ms.date === dateStr) {
            html += `<div class="calendar-milestone-item" data-milestone-id="${ms.id}" title="${this._escapeHtml(ms.name)}">${ms.icon} ${this._escapeHtml(ms.name)}</div>`;
          }
        });
      }

      html += '</div>';
    }

    html += '</div></div>';
    this.container.innerHTML = html;

    // 绑定事件
    document.getElementById('cal-prev-month').addEventListener('click', () => {
      this.currentMonth--;
      if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; }
      this.render();
    });
    document.getElementById('cal-next-month').addEventListener('click', () => {
      this.currentMonth++;
      if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; }
      this.render();
    });

    // 点击任务
    this.container.querySelectorAll('.calendar-task-bar').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        App.showEditTask(el.dataset.taskId);
      });
    });

    // 点击里程碑
    this.container.querySelectorAll('.calendar-milestone-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        App.showEditMilestone(el.dataset.milestoneId);
      });
    });
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
```

- [ ] **Step 3: Verify calendar renders**

Run: After setting up test data (from Task 6 verification), in console:
```javascript
CalendarView.init(document.getElementById('content-area'));
CalendarView.render();
```
Expected: Monthly calendar grid with colored task bars spanning across days. Milestones shown with icons. Navigation buttons switch months.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add CalendarView with monthly grid, task bars, milestones, and month navigation"
```

---

### Task 8: App Controller — Wire Everything Together

**Files:**
- Modify: `index.html` (add JS)

The App object initializes all components, handles toolbar buttons, and connects all CRUD operations to the UI.

- [ ] **Step 1: Implement App object and initialization**

Add after CalendarView in `<script>`:

```javascript
// ============================================================
// == App: 初始化、事件绑定、视图切换
// ============================================================
const App = {
  currentView: 'gantt', // 'gantt' | 'calendar'

  init() {
    ProjectManager.init();
    ModalManager.init();
    TreeView.init();
    GanttView.init(document.getElementById('content-area'));
    CalendarView.init(document.getElementById('content-area'));

    // 恢复上次设置
    this.currentView = ProjectManager.getSetting('lastView') || 'gantt';
    const granularity = ProjectManager.getSetting('lastGranularity') || 'month';
    GanttView.granularity = granularity;

    this._bindToolbar();
    this._updateViewButtons();
    this._updateGranularityButtons();
    this.renderAll();
  },

  renderAll() {
    TreeView.render();
    if (this.currentView === 'gantt') {
      GanttView.render();
    } else {
      CalendarView.render();
    }
    this._updateStatusBar();
  },

  _bindToolbar() {
    // 项目管理
    document.getElementById('btn-manage-projects').addEventListener('click', () => this.showProjectManager());

    // 导入导出
    document.getElementById('btn-import').addEventListener('click', () => this.importData());
    document.getElementById('btn-export').addEventListener('click', () => this.exportData());

    // 视图切换
    document.getElementById('btn-view-gantt').addEventListener('click', () => this.switchView('gantt'));
    document.getElementById('btn-view-calendar').addEventListener('click', () => this.switchView('calendar'));

    // 粒度切换
    document.getElementById('btn-granularity-year').addEventListener('click', () => this.switchGranularity('year'));
    document.getElementById('btn-granularity-month').addEventListener('click', () => this.switchGranularity('month'));
    document.getElementById('btn-granularity-week').addEventListener('click', () => this.switchGranularity('week'));

    // 添加任务按钮
    document.getElementById('btn-add-task').addEventListener('click', () => {
      const projects = ProjectManager.getProjects();
      if (projects.length === 0) {
        alert('请先创建项目');
        this.showProjectManager();
        return;
      }
      // 如果只有一个项目，直接添加到该项目
      if (projects.length === 1) {
        this.showAddTask(projects[0].id);
      } else {
        // 让用户选择项目
        this._showProjectSelector((projectId) => {
          this.showAddTask(projectId);
        });
      }
    });
  },

  switchView(view) {
    this.currentView = view;
    ProjectManager.setSetting('lastView', view);
    this._updateViewButtons();
    this.renderAll();
  },

  switchGranularity(g) {
    GanttView.granularity = g;
    ProjectManager.setSetting('lastGranularity', g);
    this._updateGranularityButtons();
    if (this.currentView === 'gantt') {
      GanttView.render();
    }
  },

  _updateViewButtons() {
    document.getElementById('btn-view-gantt').classList.toggle('active', this.currentView === 'gantt');
    document.getElementById('btn-view-calendar').classList.toggle('active', this.currentView === 'calendar');
  },

  _updateGranularityButtons() {
    document.getElementById('btn-granularity-year').classList.toggle('active', GanttView.granularity === 'year');
    document.getElementById('btn-granularity-month').classList.toggle('active', GanttView.granularity === 'month');
    document.getElementById('btn-granularity-week').classList.toggle('active', GanttView.granularity === 'week');
  },

  _updateStatusBar() {
    const projects = ProjectManager.getProjects();
    const tasks = ProjectManager.getAllTasks();
    const done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'inProgress').length;
    document.getElementById('status-text').textContent =
      `${projects.length} 个项目 · ${tasks.length} 个任务（进行中 ${inProgress}，已完成 ${done}）`;
  },

  // -- 项目管理 --
  showProjectManager() {
    const projects = ProjectManager.getProjects();
    let listHtml = '';
    projects.forEach(p => {
      listHtml += `<div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;gap:8px;">`;
      listHtml += `<span style="width:14px;height:14px;border-radius:50%;background:${p.color};flex-shrink:0;"></span>`;
      listHtml += `<span style="flex:1;">${TreeView._escapeHtml(p.name)}</span>`;
      listHtml += `<button style="padding:2px 8px;border:1px solid #ddd;border-radius:3px;background:#fff;cursor:pointer;font-size:12px;" onclick="App.showEditProject('${p.id}')">编辑</button>`;
      listHtml += `<button style="padding:2px 8px;border:1px solid #ddd;border-radius:3px;background:#fff;cursor:pointer;font-size:12px;color:var(--color-danger);" onclick="App.deleteProject('${p.id}')">删除</button>`;
      listHtml += `</div>`;
    });
    if (projects.length === 0) {
      listHtml = '<p style="color:var(--color-text-light);text-align:center;padding:16px;">暂无项目</p>';
    }

    ModalManager.open(`
      <div class="modal-title">项目管理</div>
      <div style="max-height:300px;overflow-y:auto;">${listHtml}</div>
      <div class="modal-actions">
        <button onclick="ModalManager.close()">关闭</button>
        <button class="btn-primary" onclick="ModalManager.close();App.showAddProject();">新建项目</button>
      </div>
    `);
  },

  showAddProject() {
    ModalManager.showProjectForm(null, (data) => {
      const p = ProjectManager.addProject(data.name);
      if (p && data.color) ProjectManager.updateProject(p.id, { color: data.color });
      this.renderAll();
    });
  },

  showEditProject(projectId) {
    const project = ProjectManager.data.projects.find(p => p.id === projectId);
    if (!project) return;
    ModalManager.showProjectForm(project, (data) => {
      ProjectManager.updateProject(projectId, data);
      this.renderAll();
    });
  },

  deleteProject(projectId) {
    const project = ProjectManager.data.projects.find(p => p.id === projectId);
    if (!project) return;
    ModalManager.confirm(`确定要删除项目「${project.name}」及其所有任务和里程碑吗？`, () => {
      ProjectManager.deleteProject(projectId);
      this.renderAll();
    });
  },

  // -- 任务操作 --
  showAddTask(projectId) {
    ModalManager.showTaskForm(null, projectId, (data) => {
      const t = ProjectManager.addTask(data.projectId, data.name, data.startDate, data.endDate);
      if (t) {
        ProjectManager.updateTask(t.id, { description: data.description, assignee: data.assignee });
      }
      this.renderAll();
    });
  },

  showEditTask(taskId) {
    const task = ProjectManager.data.tasks.find(t => t.id === taskId);
    if (!task) return;
    ModalManager.showTaskForm(task, task.projectId, (data) => {
      ProjectManager.updateTask(taskId, data);
      this.renderAll();
    });
  },

  deleteTask(taskId) {
    const task = ProjectManager.data.tasks.find(t => t.id === taskId);
    if (!task) return;
    ModalManager.confirm(`确定要删除任务「${task.name}」吗？`, () => {
      ProjectManager.deleteTask(taskId);
      this.renderAll();
    });
  },

  // -- 里程碑操作 --
  showAddTaskMilestone(taskId) {
    ModalManager.showMilestoneForm(null, { taskId }, (data) => {
      ProjectManager.addMilestone(data.name, data.date, data.icon, { taskId: data.taskId });
      this.renderAll();
    });
  },

  showAddProjectMilestone(projectId) {
    ModalManager.showMilestoneForm(null, { projectId }, (data) => {
      ProjectManager.addMilestone(data.name, data.date, data.icon, { projectId: data.projectId });
      this.renderAll();
    });
  },

  showEditMilestone(milestoneId) {
    const milestone = ProjectManager.data.milestones.find(m => m.id === milestoneId);
    if (!milestone) return;
    const parentInfo = milestone.taskId ? { taskId: milestone.taskId } : { projectId: milestone.projectId };
    ModalManager.showMilestoneForm(milestone, parentInfo, (data) => {
      ProjectManager.updateMilestone(milestoneId, data);
      this.renderAll();
    });
  },

  deleteMilestone(milestoneId) {
    const milestone = ProjectManager.data.milestones.find(m => m.id === milestoneId);
    if (!milestone) return;
    ModalManager.confirm(`确定要删除里程碑「${milestone.name}」吗？`, () => {
      ProjectManager.deleteMilestone(milestoneId);
      this.renderAll();
    });
  },

  // -- 导入导出 --
  exportData() {
    DataStore.exportJSON(ProjectManager.data);
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = await DataStore.importJSON(file);
        ModalManager.confirm('导入将覆盖当前所有数据，确定继续吗？', () => {
          ProjectManager.replaceData(data);
          this.renderAll();
        });
      } catch (err) {
        alert(err.message);
      }
    });
    input.click();
  },

  // -- 辅助：选择项目 --
  _showProjectSelector(onSelect) {
    const projects = ProjectManager.getProjects();
    let listHtml = '';
    projects.forEach(p => {
      listHtml += `<div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;gap:8px;cursor:pointer;" class="project-select-item" data-project-id="${p.id}">`;
      listHtml += `<span style="width:12px;height:12px;border-radius:50%;background:${p.color};"></span>`;
      listHtml += `<span>${TreeView._escapeHtml(p.name)}</span>`;
      listHtml += `</div>`;
    });
    ModalManager.open(`
      <div class="modal-title">选择项目</div>
      <div>${listHtml}</div>
    `);
    document.querySelectorAll('.project-select-item').forEach(el => {
      el.addEventListener('click', () => {
        ModalManager.close();
        onSelect(el.dataset.projectId);
      });
    });
  }
};

// ============================================================
// == 启动
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
```

- [ ] **Step 2: Clear test data and verify full app**

Run: Open `index.html` fresh (clear localStorage first if needed).
Expected:
1. Empty state: sidebar shows "暂无项目" message
2. Click "项目管理" → modal with "新建项目" button
3. Create a project → appears in sidebar
4. Click sidebar "+" → task form appears
5. Create tasks → appear in sidebar and Gantt chart
6. Right-click task → context menu with "添加里程碑"
7. Switch to "日历" view → monthly calendar with task bars
8. Switch granularity buttons → Gantt chart updates
9. "导出" → downloads JSON file
10. Status bar shows project/task counts

- [ ] **Step 3: Verify import/export round-trip**

Run:
1. Create some test data (projects, tasks, milestones)
2. Click "导出" → save the JSON file
3. Clear localStorage (`localStorage.removeItem('pmweb_data')`)
4. Refresh page
5. Click "导入" → select the saved JSON file
6. Confirm the import

Expected: All previously created data is restored. Sidebar and Gantt chart match what was there before.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add App controller, wire all components, complete PMWEB application"
```

---

## Chunk 5: Polish & Final Verification (Task 9)

### Task 9: Polish and Edge Cases

**Files:**
- Modify: `index.html`

Handle empty states, scrolling sync, and minor UX polish.

- [ ] **Step 1: Add empty state for Gantt view**

In GanttView.render(), at the beginning after `_generateCells()`, add an empty state check:

```javascript
// Add at start of render(), after _generateCells():
if (ProjectManager.getProjects().length === 0) {
  this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-light);font-size:14px;">请先创建项目和任务</div>';
  return;
}
```

- [ ] **Step 2: Sync Gantt header horizontal scroll with body**

Add at the end of GanttView.render(), after the "scroll to today" block:

```javascript
// Sync header scroll with body
const ganttHeader = this.container.querySelector('.gantt-header');
if (ganttBody && ganttHeader) {
  ganttBody.addEventListener('scroll', () => {
    ganttHeader.style.transform = `translateX(-${ganttBody.scrollLeft}px)`;
  });
}
```

And update the `.gantt-container` and `.gantt-header` structure in render() so that the header is inside a wrapper that clips overflow:

Replace the header HTML generation with:
```javascript
let headerHtml = '<div style="overflow:hidden;flex-shrink:0;border-bottom:1px solid var(--color-border);"><div class="gantt-header" style="width:' + totalWidth + 'px;">';
// ... cells ...
headerHtml += '</div></div>';
```

- [ ] **Step 3: Final end-to-end verification**

Run through this checklist in the browser:

1. **Fresh start:** Open `index.html` with no localStorage data
2. **Create project:** Click "项目管理" → "新建项目" → enter name → save
3. **Create tasks:** Click "+" in sidebar → fill form → save (create 3 tasks with different dates)
4. **Add milestone:** Right-click task → "添加里程碑" → fill form → save
5. **Add project milestone:** Right-click project header → "添加里程碑"
6. **Edit task:** Click task bar in Gantt → modify dates → save
7. **Edit milestone:** Click milestone diamond → modify → save
8. **Delete task:** Right-click task → "删除任务" → confirm
9. **View switching:** Click "甘特图" / "日历" buttons
10. **Granularity:** Click "年" / "月" / "周" buttons
11. **Calendar navigation:** Switch to calendar → click ◀ / ▶ to change months
12. **Export:** Click "导出" → verify JSON downloads
13. **Import:** Click "导入" → select file → confirm → verify data restored
14. **Persistence:** Refresh browser → all data still present
15. **Status bar:** Shows correct project/task counts
16. **Collapse/expand:** Click project header in sidebar → toggles task visibility

Expected: All 16 checks pass.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add empty states, scroll sync, final polish"
```
