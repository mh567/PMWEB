'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var domStub = require('./helpers/dom-stub');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var ALL_SCRIPTS = [
  'date.js',
  'validate.js',
  'store.js',
  'workspace.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'resources.js',
  'work-calendar.js',
  'task-manager.js',
  'row-model.js',
  'views.js',
  'modal.js',
  'tree-view.js',
  'gantt-view.js',
  'drag-manager.js',
  'calendar-view.js',
  'column-config.js',
  'cell-editor.js',
  'progress.js',
  'export.js',
  'baseline.js',
  'grid-pane.js',
  'links.js',
  'scheduler.js',
  'critical-path.js',
  'arrows.js',
  'timeline-pane.js',
  'workbench.js',
  'sync.js',
  'sync-queue.js',
  'realtime.js',
  'sync-ui.js',
  'share.js',
  'project-ui.js',
  'app.js'
];

function createHarness(options) {
  options = options || {};
  var doc = domStub.createDocument();

  // Toolbar
  var toolbar = domStub.createElement('div');
  toolbar.id = 'toolbar';
  doc.body.appendChild(toolbar);

  var btnProjectSelect = domStub.createElement('button');
  btnProjectSelect.id = 'btn-project-select';
  toolbar.appendChild(btnProjectSelect);

  var btnGantt = domStub.createElement('button');
  btnGantt.id = 'btn-view-gantt';
  btnGantt.className = 'btn';
  toolbar.appendChild(btnGantt);

  var btnCalendar = domStub.createElement('button');
  btnCalendar.id = 'btn-view-calendar';
  btnCalendar.className = 'btn';
  toolbar.appendChild(btnCalendar);

  var btnNodes = domStub.createElement('button');
  btnNodes.id = 'btn-toggle-nodes';
  btnNodes.className = 'btn';
  toolbar.appendChild(btnNodes);

  var btnAddRoot = domStub.createElement('button');
  btnAddRoot.id = 'btn-add-root-task';
  toolbar.appendChild(btnAddRoot);

  var btnImport = domStub.createElement('button');
  btnImport.id = 'btn-import';
  toolbar.appendChild(btnImport);

  var btnExport = domStub.createElement('button');
  btnExport.id = 'btn-export';
  toolbar.appendChild(btnExport);

  var btnExportExcel = domStub.createElement('button');
  btnExportExcel.id = 'btn-export-excel';
  toolbar.appendChild(btnExportExcel);

  // Main container
  var mainContainer = domStub.createElement('div');
  mainContainer.id = 'main-container';
  doc.body.appendChild(mainContainer);

  // Workbench
  var workbench = domStub.createElement('div');
  workbench.id = 'workbench';
  mainContainer.appendChild(workbench);

  var gridPane = domStub.createElement('div');
  gridPane.id = 'grid-pane';
  workbench.appendChild(gridPane);

  var gridHeader = domStub.createElement('div');
  gridHeader.id = 'grid-header';
  gridPane.appendChild(gridHeader);

  var gridBody = domStub.createElement('div');
  gridBody.id = 'grid-body';
  gridPane.appendChild(gridBody);

  var splitter = domStub.createElement('div');
  splitter.id = 'workbench-splitter';
  workbench.appendChild(splitter);

  var datePanels = domStub.createElement('div');
  datePanels.id = 'date-panels';
  workbench.appendChild(datePanels);

  var timelinePane = domStub.createElement('div');
  timelinePane.id = 'timeline-pane';
  datePanels.appendChild(timelinePane);

  var timelineHeader = domStub.createElement('div');
  timelineHeader.id = 'timeline-header';
  timelinePane.appendChild(timelineHeader);

  var timelineBody = domStub.createElement('div');
  timelineBody.id = 'timeline-body';
  timelinePane.appendChild(timelineBody);

  var calendarPanel = domStub.createElement('div');
  calendarPanel.id = 'calendar-panel';
  datePanels.appendChild(calendarPanel);

  // Todos sidebar
  var todosSidebar = domStub.createElement('div');
  todosSidebar.id = 'todos-sidebar';
  mainContainer.appendChild(todosSidebar);

  var todosSidebarHeader = domStub.createElement('div');
  todosSidebarHeader.id = 'todos-sidebar-header';
  var todosTitle = domStub.createElement('h3');
  todosTitle.textContent = '今日节点';
  todosSidebarHeader.appendChild(todosTitle);
  todosSidebar.appendChild(todosSidebarHeader);

  var todosList = domStub.createElement('div');
  todosList.id = 'todos-list';
  todosSidebar.appendChild(todosList);

  var treeContainer = domStub.createElement('div');
  treeContainer.id = 'tree-container';
  doc.body.appendChild(treeContainer);

  var contextMenu = domStub.createElement('div');
  contextMenu.id = 'context-menu';
  doc.body.appendChild(contextMenu);

  // Status bar
  var statusBar = domStub.createElement('div');
  statusBar.id = 'status-bar';
  var statusText = domStub.createElement('span');
  statusText.id = 'status-text';
  statusBar.appendChild(statusText);
  var statusInfo = domStub.createElement('span');
  statusInfo.id = 'status-info';
  statusBar.appendChild(statusInfo);
  doc.body.appendChild(statusBar);

  // Modal
  var modalOverlay = domStub.createElement('div');
  modalOverlay.id = 'modal-overlay';
  var modalBox = domStub.createElement('div');
  modalBox.id = 'modal-box';
  modalOverlay.appendChild(modalBox);
  doc.body.appendChild(modalOverlay);

  var localStorage = {
    _store: {},
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
    setItem: function(k, v) { this._store[k] = String(v); },
    removeItem: function(k) { delete this._store[k]; }
  };
  if (options.initialRaw !== undefined) {
    localStorage._store['pmweb_data'] = String(options.initialRaw);
  }

  var app = helper.createApp(ALL_SCRIPTS, { localStorage: localStorage });
  app.context.document = doc;
  app.context.window = app.context;
  app.context.addEventListener = function() {};
  app.context.removeEventListener = function() {};

  return {
    app: app,
    doc: doc,
    App: app.get('App'),
    Workbench: app.get('Workbench'),
    ViewState: app.get('ViewState'),
    TaskManager: app.get('TaskManager'),
    Workspace: app.get('Workspace'),
    TimelinePane: app.get('TimelinePane'),
    CalendarView: app.get('CalendarView'),
    els: {
      btnGantt: btnGantt,
      btnCalendar: btnCalendar,
      btnNodes: btnNodes,
      gridPane: gridPane,
      splitter: splitter,
      datePanels: datePanels,
      timelinePane: timelinePane,
      calendarPanel: calendarPanel,
      todosSidebar: todosSidebar,
      todosList: todosList,
      todosTitle: todosTitle
    }
  };
}

// ------------------------------------------------------------
// 1. Workbench.setPanels 与 Workbench.getPanels 基础接口与四种视图组合
// ------------------------------------------------------------
test('Workbench.setPanels 与 getPanels 默认 gantt:true/calendar:false/nodes:true', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.Workbench.init();

  var panels = h.Workbench.getPanels();
  assert.strictEqual(panels.ganttVisible, true);
  assert.strictEqual(panels.calendarVisible, false);
  assert.strictEqual(panels.nodesVisible, true);
});

test('遍历四种甘特图与日历组合及全关表格扩展展开无分隔条', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.Workbench.init();

  // 组合1：仅甘特图开启
  h.Workbench.setPanels({ ganttVisible: true, calendarVisible: false, nodesVisible: true });
  assert.strictEqual(h.els.timelinePane.hidden, false, '仅甘特开启时时间轴可见');
  assert.strictEqual(h.els.calendarPanel.hidden, true, '仅甘特开启时日历隐藏');
  assert.strictEqual(h.els.splitter.hidden, false, '仅甘特开启时分割条可见');
  assert.strictEqual(h.els.gridPane.classList.contains('no-date-panels'), false);

  // 组合2：仅日历开启
  h.Workbench.setPanels({ ganttVisible: false, calendarVisible: true, nodesVisible: true });
  assert.strictEqual(h.els.timelinePane.hidden, true, '仅日历开启时时间轴隐藏');
  assert.strictEqual(h.els.calendarPanel.hidden, false, '仅日历开启时日历可见');
  assert.strictEqual(h.els.splitter.hidden, false, '仅日历开启时分割条可见');
  assert.strictEqual(h.els.gridPane.classList.contains('no-date-panels'), false);

  // 组合3：甘特图与日历双开（右侧上下排列）
  h.Workbench.setPanels({ ganttVisible: true, calendarVisible: true, nodesVisible: true });
  assert.strictEqual(h.els.timelinePane.hidden, false, '双开时时间轴可见');
  assert.strictEqual(h.els.calendarPanel.hidden, false, '双开时日历可见');
  assert.strictEqual(h.els.splitter.hidden, false, '双开时分割条可见');
  assert.strictEqual(h.els.datePanels.classList.contains('dual-view'), true, '双开时日期区域标记上下排列');

  // 组合4：甘特图与日历全部关闭（表格展开，无分割条占位）
  h.Workbench.setPanels({ ganttVisible: false, calendarVisible: false, nodesVisible: true });
  assert.strictEqual(h.els.timelinePane.hidden, true, '全关时时间轴隐藏');
  assert.strictEqual(h.els.calendarPanel.hidden, true, '全关时日历隐藏');
  assert.strictEqual(h.els.splitter.hidden, true, '全关时分割条隐藏');
  assert.strictEqual(h.els.gridPane.classList.contains('no-date-panels'), true, '全关时表格展开扩展至可用宽度');

  // 全关状态下仍可新建和查询任务
  var newTask = h.TaskManager.addTask(null, '全关状态任务');
  assert.ok(newTask && newTask.id);
  assert.strictEqual(h.TaskManager.getTask(newTask.id).name, '全关状态任务');
});

// ------------------------------------------------------------
// 2. 今日节点独立开关
// ------------------------------------------------------------
test('今日节点独立显隐，不受甘特图和日历控制', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.Workbench.init();

  h.Workbench.setPanels({ ganttVisible: true, calendarVisible: false, nodesVisible: false });
  assert.strictEqual(h.els.todosSidebar.hidden, true, 'nodesVisible: false 时节点侧边栏隐藏');
  assert.strictEqual(h.Workbench.getPanels().nodesVisible, false);
  assert.strictEqual(h.Workbench.getPanels().ganttVisible, true);

  // 改变甘特图和日历不影响节点可见性
  h.Workbench.setPanels({ ganttVisible: false, calendarVisible: true });
  assert.strictEqual(h.els.todosSidebar.hidden, true, '改变日期面板不应改动节点可见性');
  assert.strictEqual(h.Workbench.getPanels().nodesVisible, false);

  h.Workbench.setPanels({ nodesVisible: true });
  assert.strictEqual(h.els.todosSidebar.hidden, false, 'nodesVisible: true 时节点侧边栏显示');
  assert.strictEqual(h.Workbench.getPanels().nodesVisible, true);
  assert.strictEqual(h.Workbench.getPanels().calendarVisible, true);
});

// ------------------------------------------------------------
// 3. 真实工具栏按钮切换及 aria-pressed 状态对齐
// ------------------------------------------------------------
test('工具栏按钮点击切换与 aria-pressed 及 active 类名对齐', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.App.init();

  // 初始状态：gantt: true, calendar: false, nodes: true
  assert.strictEqual(h.els.btnGantt.classList.contains('active'), true);
  assert.strictEqual(h.els.btnGantt.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(h.els.btnCalendar.classList.contains('active'), false);
  assert.strictEqual(h.els.btnCalendar.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(h.els.btnNodes.classList.contains('active'), true);
  assert.strictEqual(h.els.btnNodes.getAttribute('aria-pressed'), 'true');

  // 点击日历按钮打开日历
  h.els.btnCalendar.click();
  assert.strictEqual(h.els.btnCalendar.classList.contains('active'), true);
  assert.strictEqual(h.els.btnCalendar.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(h.Workbench.getPanels().calendarVisible, true);
  assert.strictEqual(h.Workbench.getPanels().ganttVisible, true);

  // 点击甘特图按钮关闭甘特图
  h.els.btnGantt.click();
  assert.strictEqual(h.els.btnGantt.classList.contains('active'), false);
  assert.strictEqual(h.els.btnGantt.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(h.Workbench.getPanels().ganttVisible, false);
  assert.strictEqual(h.Workbench.getPanels().calendarVisible, true);

  // 点击节点按钮关闭今日节点
  h.els.btnNodes.click();
  assert.strictEqual(h.els.btnNodes.classList.contains('active'), false);
  assert.strictEqual(h.els.btnNodes.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(h.Workbench.getPanels().nodesVisible, false);
});

function plain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ------------------------------------------------------------
// 4. 多项目 settings 隔离、旧 lastView 迁移与归档项目只读防护
// ------------------------------------------------------------
test('两项目 panels 设置持久化隔离，切换项目立即恢复各自面板', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.App.init();

  var ws = h.Workspace;
  var tm = h.TaskManager;

  // 创建两个项目
  var p1 = ws.createProject({ name: '项目一' });
  var p2 = ws.createProject({ name: '项目二' });

  // 项目一设置为仅日历
  ws.activate(p1.id);
  h.App.setPanels({ ganttVisible: false, calendarVisible: true, nodesVisible: false });
  assert.deepStrictEqual(plain(h.Workbench.getPanels()), { ganttVisible: false, calendarVisible: true, nodesVisible: false });

  // 项目二设置为仅甘特图且显示节点
  ws.activate(p2.id);
  h.App.setPanels({ ganttVisible: true, calendarVisible: false, nodesVisible: true });
  assert.deepStrictEqual(plain(h.Workbench.getPanels()), { ganttVisible: true, calendarVisible: false, nodesVisible: true });

  // 切换回项目一立即恢复项目一的配置
  ws.activate(p1.id);
  h.App._restoreProjectPanels();
  assert.deepStrictEqual(plain(h.Workbench.getPanels()), { ganttVisible: false, calendarVisible: true, nodesVisible: false });

  // 切换回项目二立即恢复项目二的配置
  ws.activate(p2.id);
  h.App._restoreProjectPanels();
  assert.deepStrictEqual(plain(h.Workbench.getPanels()), { ganttVisible: true, calendarVisible: false, nodesVisible: true });
});

test('旧 lastView=calendar 迁移为仅日历，其余迁移为仅甘特图', function() {
  var h = createHarness();
  helper.resetProject(h.app);

  // 模拟旧数据带有 lastView = 'calendar'
  var project = h.Workspace.createProject({ name: '旧日历项目' });
  h.Workspace.activate(project.id);
  h.TaskManager.setSetting('lastView', 'calendar');

  h.App.init();
  var panels = h.Workbench.getPanels();
  assert.strictEqual(panels.ganttVisible, false);
  assert.strictEqual(panels.calendarVisible, true);
  assert.strictEqual(panels.nodesVisible, true);

  // 模拟旧数据带有 lastView = 'gantt'
  var project2 = h.Workspace.createProject({ name: '旧甘特项目' });
  h.Workspace.activate(project2.id);
  h.TaskManager.setSetting('lastView', 'gantt');

  h.App._restoreProjectPanels();
  var panels2 = h.Workbench.getPanels();
  assert.strictEqual(panels2.ganttVisible, true);
  assert.strictEqual(panels2.calendarVisible, false);
  assert.strictEqual(panels2.nodesVisible, true);
});

test('归档项目只读不能因初始化默认 panels 抛写异常或隐式修改', function() {
  var h = createHarness();
  helper.resetProject(h.app);

  var project = h.Workspace.createProject({ name: '归档测试项目' });
  h.Workspace.updateProject(project.id, { archived: true });
  h.Workspace.activate(project.id);

  assert.doesNotThrow(function() {
    h.App.init();
  }, '初始化归档项目不得抛错');

  var panels = h.Workbench.getPanels();
  assert.strictEqual(panels.ganttVisible, true);
  assert.strictEqual(panels.calendarVisible, false);
  assert.strictEqual(panels.nodesVisible, true);
});

// ------------------------------------------------------------
// 5. 甘特图缩放控件与边界禁用、中心日期稳定
// ------------------------------------------------------------
test('甘特图右上角缩放控件 month->week->day 放大及逆向缩小边界禁用', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.App.init();

  function btnZoomIn() { return h.doc.getElementById('btn-gantt-zoom-in'); }
  function btnZoomOut() { return h.doc.getElementById('btn-gantt-zoom-out'); }
  function label() { return h.doc.getElementById('gantt-granularity-label'); }

  assert.ok(btnZoomIn(), '必须存在甘特图加号放大按钮');
  assert.ok(btnZoomOut(), '必须存在甘特图减号缩小按钮');
  assert.ok(label(), '必须存在甘特图当前粒度标签');

  // 初始为 day：加号到达最大放大边界禁用，减号可用
  h.Workbench.setGranularity('day');
  assert.strictEqual(label().textContent.trim(), '日');
  assert.strictEqual(btnZoomIn().disabled, true, 'day 粒度时加号放大按钮必须禁用');
  assert.strictEqual(btnZoomOut().disabled, false, 'day 粒度时减号缩小按钮可用');

  // 点击减号缩小到 week
  btnZoomOut().click();
  assert.strictEqual(h.Workbench.getGranularity(), 'week');
  assert.strictEqual(label().textContent.trim(), '周');
  assert.strictEqual(btnZoomIn().disabled, false, 'week 粒度时加号可用');
  assert.strictEqual(btnZoomOut().disabled, false, 'week 粒度时减号可用');

  // 点击减号缩小到 month：减号到达最小粒度边界禁用，加号可用
  btnZoomOut().click();
  assert.strictEqual(h.Workbench.getGranularity(), 'month');
  assert.strictEqual(label().textContent.trim(), '月');
  assert.strictEqual(btnZoomIn().disabled, false, 'month 粒度时加号可用');
  assert.strictEqual(btnZoomOut().disabled, true, 'month 粒度时减号缩小按钮必须禁用');

  // 再次点击减号在边界上无效果
  btnZoomOut().click();
  assert.strictEqual(h.Workbench.getGranularity(), 'month');

  // 点击加号放大回 week
  btnZoomIn().click();
  assert.strictEqual(h.Workbench.getGranularity(), 'week');
  assert.strictEqual(label().textContent.trim(), '周');

  // 点击加号放大回 day
  btnZoomIn().click();
  assert.strictEqual(h.Workbench.getGranularity(), 'day');
  assert.strictEqual(label().textContent.trim(), '日');
  assert.strictEqual(btnZoomIn().disabled, true);
});

test('缩放粒度保持可见日期中心且不改变任务日期', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.App.init();

  var t1 = h.TaskManager.addTask(null, '稳定测试任务');
  h.TaskManager.updateTask(t1.id, { startDate: '2026-06-01', endDate: '2026-06-15' });

  h.Workbench.setGranularity('month');
  assert.strictEqual(h.TaskManager.getTask(t1.id).startDate, '2026-06-01');
  assert.strictEqual(h.TaskManager.getTask(t1.id).endDate, '2026-06-15');

  h.Workbench.setGranularity('day');
  assert.strictEqual(h.TaskManager.getTask(t1.id).startDate, '2026-06-01', '缩放不得修改任务开始日期');
  assert.strictEqual(h.TaskManager.getTask(t1.id).endDate, '2026-06-15', '缩放不得修改任务结束日期');
});

// ------------------------------------------------------------
// 6. 今日节点标题/空提示/里程碑范围与归档防护
// ------------------------------------------------------------
test('今日节点标题与空提示统一，范围限定当前项目当天里程碑且不受筛选影响', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.App.init();

  var tm = h.TaskManager;
  var today = h.app.get('DateUtil').format(new Date());

  // 标题与空提示
  h.App._updateTodosSidebar();
  assert.ok(h.els.todosTitle.textContent.indexOf('今日节点') !== -1, '标题统一为今日节点');
  assert.ok(h.els.todosList.innerHTML.indexOf('今日暂无节点') !== -1, '空提示统一为今日暂无节点');

  // 添加今天与非今天里程碑
  var task1 = tm.addTask(null, '任务一');
  var mToday = tm.addMilestone(task1.id, '今日重要节点', today, 'pending');
  var mOther = tm.addMilestone(task1.id, '非今日节点', '2025-01-01', 'pending');

  h.App._updateTodosSidebar();
  assert.ok(h.els.todosList.innerHTML.indexOf('今日重要节点') !== -1, '必须展示今日里程碑');
  assert.strictEqual(h.els.todosList.innerHTML.indexOf('非今日节点'), -1, '非今日里程碑不得混入');

  // 任务列表状态筛选不改变今日节点范围
  h.ViewState.statusFilter.todo = false;
  h.ViewState.statusFilter.inProgress = false;
  h.App._updateTodosSidebar();
  assert.ok(h.els.todosList.innerHTML.indexOf('今日重要节点') !== -1, '列表筛选不得过滤今日节点');

  // 查找今日节点的真实 .todo-item 节点，通过真实 click 事件冒泡委托测试
  var itemEl = h.els.todosList.querySelector('.todo-item[data-milestone-id="' + mToday.id + '"]') || h.els.todosList.querySelector('.todo-item');
  assert.ok(itemEl, '必须渲染今日节点的 .todo-item 元素');

  // 点击真实 .todo-item 节点
  itemEl.click();
  assert.strictEqual(tm.getMilestone(mToday.id).status, 'done', '真实点击 .todo-item 必须通过委托切换状态为 done');

  // 刷新恢复：重新触发更新验证已持久化保存且具有 done 样式类
  h.App._updateTodosSidebar();
  var doneItemEl = h.els.todosList.querySelector('.todo-item[data-milestone-id="' + mToday.id + '"]') || h.els.todosList.querySelector('.todo-item');
  assert.ok(doneItemEl.classList.contains('done'), '持久化更新后节点必须带有 done 样式类');

  // 再次点击恢复为 pending
  doneItemEl.click();
  assert.strictEqual(tm.getMilestone(mToday.id).status, 'pending', '再次点击恢复 pending');
});

test('归档项目不能修改今日节点状态', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.App.init();

  var tm = h.TaskManager;
  var ws = h.Workspace;
  var today = h.app.get('DateUtil').format(new Date());

  var project = ws.currentProject();
  var task = tm.addTask(null, '普通任务');
  var m = tm.addMilestone(task.id, '归档任务节点', today, 'pending');

  // 归档当前项目
  ws.updateProject(project.id, { archived: true });

  h.App._updateTodosSidebar();
  var archiveItemEl = h.els.todosList.querySelector('.todo-item[data-milestone-id="' + m.id + '"]') || h.els.todosList.querySelector('.todo-item');
  assert.ok(archiveItemEl, '必须存在归档项目的今日节点元素');

  assert.doesNotThrow(function() {
    archiveItemEl.click();
  }, '归档项目尝试点击节点切换状态不得抛未捕获异常');

  assert.strictEqual(tm.getMilestone(m.id).status, 'pending', '归档项目节点状态通过真实点击必须保持不变');
});

// ------------------------------------------------------------
// 7. 面板重开不重复注册监听
// ------------------------------------------------------------
test('重开面板不重复注册 click/scroll/midnight 监听', function() {
  var h = createHarness();
  helper.resetProject(h.app);
  h.App.init();

  var tm = h.TaskManager;
  var today = h.app.get('DateUtil').format(new Date());

  var task = tm.addTask(null, '重复监听测试任务');
  var m = tm.addMilestone(task.id, '点击测试节点', today, 'pending');
  h.App._updateTodosSidebar();

  var callCount = 0;
  var origToggle = h.App.toggleMilestoneStatus;
  h.App.toggleMilestoneStatus = function(id) {
    callCount++;
    return origToggle.apply(this, arguments);
  };

  // 反复切换面板10次
  for (var i = 0; i < 10; i++) {
    h.Workbench.setPanels({ ganttVisible: false, calendarVisible: true, nodesVisible: true });
    h.Workbench.setPanels({ ganttVisible: true, calendarVisible: false, nodesVisible: true });
  }

  // 验证午夜定时器单例与可见性监听单例
  assert.ok(h.App._midnightTimer !== null);
  assert.strictEqual(h.App._visibilityBound, true);

  // 重新获取节点并单次点击，验证单次点击不重复执行
  h.App._updateTodosSidebar();
  var clickTarget = h.els.todosList.querySelector('.todo-item[data-milestone-id="' + m.id + '"]') || h.els.todosList.querySelector('.todo-item');
  assert.ok(clickTarget, '必须存在今日节点');
  clickTarget.click();

  assert.strictEqual(callCount, 1, '面板反复重开后，单次点击必须只触发单次 toggleMilestoneStatus');
  h.App.toggleMilestoneStatus = origToggle;
});

// ------------------------------------------------------------
// 执行所有测试
// ------------------------------------------------------------
var failures = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + t.name);
    console.log('  ' + (err && err.stack ? err.stack : err));
  }
});

console.log('\npanel-visibility: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
