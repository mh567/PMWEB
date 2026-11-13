'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var lw = require('./helpers/load-workspace');
var domMock = require('./helpers/dom-mock');
var makeWorkspace = lw.makeWorkspace;

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function setupAppEnvironment(options) {
  options = options || {};
  var dom = domMock.createDomEnvironment();
  var doc = dom.doc;
  var body = dom.body;

  // 构造标准 HTML 容器结构
  var indexHtml = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  var tStart = indexHtml.indexOf('<div id="toolbar"');
  var tContentStart = indexHtml.indexOf('>', tStart) + 1;
  var tEnd = indexHtml.indexOf('<!-- CONTEXT BAR');
  var lastDiv = indexHtml.lastIndexOf('</div>', tEnd);
  var toolbarInner = indexHtml.substring(tContentStart, lastDiv);

  var cStart = indexHtml.indexOf('<div id="context-bar"');
  var cContentStart = indexHtml.indexOf('>', cStart) + 1;
  var cEnd = indexHtml.indexOf('<!-- MAIN CONTAINER');
  var cLastDiv = indexHtml.lastIndexOf('</div>', cEnd);
  var contextInner = indexHtml.substring(cContentStart, cLastDiv);

  var toolbar = dom.makeElement('DIV', { id: 'toolbar', class: 'toolbar' });
  toolbar.innerHTML = toolbarInner;

  var contextBar = dom.makeElement('DIV', { id: 'context-bar', class: 'context-bar' });
  contextBar.innerHTML = contextInner;
  var mainContainer = dom.makeElement('DIV', { id: 'main-container', class: 'main-container' });
  var workbench = dom.makeElement('DIV', { id: 'workbench', class: 'workbench' });
  var gridPane = dom.makeElement('DIV', { id: 'grid-pane', class: 'grid-pane' });
  var gridHeader = dom.makeElement('DIV', { id: 'grid-header', class: 'pane-header' });
  var gridBody = dom.makeElement('DIV', { id: 'grid-body', class: 'pane-body' });
  gridPane.appendChild(gridHeader);
  gridPane.appendChild(gridBody);

  var datePanels = dom.makeElement('DIV', { id: 'date-panels', class: 'date-panels' });
  var timelinePane = dom.makeElement('DIV', { id: 'timeline-pane', class: 'timeline-pane' });
  var timelineHeader = dom.makeElement('DIV', { id: 'timeline-header', class: 'pane-header' });
  var timelineBody = dom.makeElement('DIV', { id: 'timeline-body', class: 'pane-body' });
  timelinePane.appendChild(timelineHeader);
  timelinePane.appendChild(timelineBody);

  var calendarPanel = dom.makeElement('DIV', { id: 'calendar-panel', class: 'calendar-panel' });
  datePanels.appendChild(timelinePane);
  datePanels.appendChild(calendarPanel);

  workbench.appendChild(gridPane);
  workbench.appendChild(datePanels);

  var todosSidebar = dom.makeElement('DIV', { id: 'todos-sidebar', class: 'todos-sidebar' });
  var todosHeader = dom.makeElement('DIV', { id: 'todos-sidebar-header' });
  var todosTitle = dom.makeElement('H3');
  todosTitle.textContent = '今日节点';
  todosHeader.appendChild(todosTitle);
  var todosList = dom.makeElement('DIV', { id: 'todos-list' });
  todosSidebar.appendChild(todosHeader);
  todosSidebar.appendChild(todosList);

  mainContainer.appendChild(workbench);
  mainContainer.appendChild(todosSidebar);

  var statusBar = dom.makeElement('DIV', { id: 'status-bar' });
  var statusText = dom.makeElement('SPAN', { id: 'status-text' });
  var statusInfo = dom.makeElement('SPAN', { id: 'status-info' });
  statusBar.appendChild(statusText);
  statusBar.appendChild(statusInfo);

  var treeContainer = dom.makeElement('DIV', { id: 'tree-container', hidden: 'true' });
  body.appendChild(treeContainer);
  var contextMenu = dom.makeElement('DIV', { id: 'context-menu', class: 'context-menu' });
  body.appendChild(contextMenu);

  body.appendChild(toolbar);
  body.appendChild(contextBar);
  body.appendChild(mainContainer);
  body.appendChild(statusBar);

  // 初始化工作区数据
  var wsData = options.workspaceData || makeWorkspace();
  var appEnv = helper.createApp([
    'date.js',
    'validate.js',
    'store.js',
    'workspace.js',
    'recycle-bin.js',
    'history.js',
    'comments.js',
    'activity.js',
    'attachment-meta.js',
    'attachment-store.js',
    'resources.js',
    'holiday-source.js',
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
    'recycle-bin-ui.js',
    'backup.js',
    'app.js'
  ], {
    localStorage: options.localStorage
  });

  // 注入 DOM 到全局上下文
  appEnv.context.document = doc;
  appEnv.context.window = {
    location: options.location || { hash: '', search: '', pathname: '/' },
    addEventListener: function(evt, fn) { doc.addEventListener(evt, fn); },
    removeEventListener: function(evt, fn) { doc.removeEventListener(evt, fn); },
    print: function() { appEnv.context.__printed = true; }
  };

  appEnv.localStorage.setItem('pmweb_data', JSON.stringify(wsData));
  var Workspace = appEnv.get('Workspace');
  var TaskManager = appEnv.get('TaskManager');
  var App = appEnv.get('App');
  var ModalManager = appEnv.get('ModalManager');
  var ProjectUI = appEnv.get('ProjectUI');
  var RecycleBinUI = appEnv.get('RecycleBinUI');
  var Backup = appEnv.get('Backup');
  var GridPane = appEnv.get('GridPane');
  var Workbench = appEnv.get('Workbench');

  return {
    appEnv: appEnv,
    dom: dom,
    doc: doc,
    body: body,
    toolbar: toolbar,
    contextBar: contextBar,
    mainContainer: mainContainer,
    workbench: workbench,
    gridPane: gridPane,
    datePanels: datePanels,
    todosSidebar: todosSidebar,
    Workspace: Workspace,
    TaskManager: TaskManager,
    App: App,
    ModalManager: ModalManager,
    ProjectUI: ProjectUI,
    RecycleBinUI: RecycleBinUI,
    Backup: Backup,
    GridPane: GridPane,
    Workbench: Workbench
  };
}

// -------------------------------------------------------------
// 场景 1: toolbar_controls_and_menu_focus
// -------------------------------------------------------------
test('toolbar_controls_and_menu_focus: 第一行顺序、搜索尺寸、外置列设置、分组菜单及焦点交互', function() {
  var env = setupAppEnvironment();
  var App = env.App;
  var doc = env.doc;
  var toolbar = env.toolbar;

  App.init();

  // 1. 验证第一行工具栏入口存在且按设计严格排序
  // 顺序: PMWEB / 当前项目 / 搜索任务 / 新建任务 / 甘特图 / 日历 / 列设置 / 菜单
  var brand = doc.querySelector('.toolbar-title, .brand');
  assert.ok(brand, '第一行必须包含 PMWEB 品牌标识');
  assert.ok(brand.textContent.indexOf('PMWEB') !== -1, '品牌文案为 PMWEB');

  var btnProject = doc.getElementById('btn-project-select');
  assert.ok(btnProject, '第一行必须包含当前项目按钮');

  var searchInput = doc.getElementById('search-task') || doc.getElementById('search');
  assert.ok(searchInput, '第一行必须包含任务搜索框');
  assert.strictEqual(searchInput.getAttribute('placeholder') || searchInput.getAttribute('aria-label'), '搜索任务');

  var btnNewTask = doc.getElementById('btn-add-root-task') || doc.getElementById('btn-new-task');
  assert.ok(btnNewTask, '第一行必须包含新建任务按钮');

  var btnGantt = doc.getElementById('btn-view-gantt');
  assert.ok(btnGantt, '第一行必须包含甘特图开关');

  var btnCalendar = doc.getElementById('btn-view-calendar');
  assert.ok(btnCalendar, '第一行必须包含日历开关');

  var btnColSettings = doc.getElementById('btn-column-settings');
  assert.ok(btnColSettings, '第一行必须包含外置列设置按钮');

  var btnMenu = doc.getElementById('btn-menu') || doc.getElementById('menu-trigger') || doc.querySelector('#app-menu summary');
  assert.ok(btnMenu, '第一行必须包含菜单入口');

  // 验证第一行元素在 DOM 中的顺序
  var toolbarChildren = toolbar.childNodes.filter(function(n) {
    return n.tagName && n.tagName !== 'DIV' && n.id !== 'history-group' && n.id !== 'toolbar-sep';
  });
  // 检验各入口的顺序索引
  function getToolbarIndex(el) {
    var cur = el;
    while (cur && cur.parentNode && cur.parentNode !== toolbar) {
      cur = cur.parentNode;
    }
    return toolbar.childNodes.indexOf(cur);
  }
  var brandIdx = getToolbarIndex(brand);
  var projIdx = getToolbarIndex(btnProject);
  var searchIdx = getToolbarIndex(searchInput);
  var newIdx = getToolbarIndex(btnNewTask);
  var ganttIdx = getToolbarIndex(btnGantt);
  var calIdx = getToolbarIndex(btnCalendar);
  var colIdx = getToolbarIndex(btnColSettings);
  var menuContainer = doc.getElementById('app-menu') || doc.getElementById('menu') || btnMenu;
  var menuIdx = getToolbarIndex(menuContainer);

  assert.ok(brandIdx !== -1 && projIdx !== -1 && projIdx > brandIdx, '当前项目在 PMWEB 后');
  assert.ok(searchIdx > projIdx, '搜索在当前项目后');
  assert.ok(newIdx > searchIdx, '新建任务在搜索后');
  assert.ok(ganttIdx > newIdx, '甘特图在新建任务后');
  if (btnGantt.parentNode === btnCalendar.parentNode) {
    assert.ok(btnGantt.parentNode.childNodes.indexOf(btnCalendar) > btnGantt.parentNode.childNodes.indexOf(btnGantt), '日历在甘特图后');
  } else {
    assert.ok(calIdx > ganttIdx, '日历在甘特图后');
  }
  assert.ok(colIdx > calIdx, '列设置在日历后');
  assert.ok(menuIdx > colIdx, '菜单在列设置后');

  // 2. 搜索框宽度与 flex-grow 规则
  // 注意：Node mock 环境下 DOM 元素无 CSS 计算引擎（computedStyle），此处静态断言类名与 CSS 文件规则存在性，真实 computedStyle 布局表现由 Task 10 真实浏览器统一验收。
  var layoutCss = require('fs').readFileSync(require('path').join(__dirname, '..', 'css/layout.css'), 'utf8');
  assert.ok((layoutCss.indexOf('152px') !== -1 && layoutCss.indexOf('flex-grow: 0') !== -1) || layoutCss.indexOf('0 0 152px') !== -1, 'layout.css 必须声明桌面 152px 与 flex-grow: 0');
  assert.ok(layoutCss.indexOf('max-width: 520px') !== -1 && layoutCss.indexOf('132px') !== -1, 'layout.css 必须声明窄屏 132px');
  assert.ok(!searchInput.style.flexGrow || searchInput.style.flexGrow === '0', '搜索框不得自动拉伸 flex-grow: 0 (Node mock 兜底)');
  assert.ok(searchInput.classList.contains('search') || searchInput.classList.contains('search-input'), '搜索框包含规范类名');

  // 3. 列设置外置且调用真实 GridPane._showColumnPanel
  var columnPanelOpened = false;
  env.GridPane._showColumnPanel = function() { columnPanelOpened = true; };
  btnColSettings.click();
  assert.strictEqual(columnPanelOpened, true, '点击列设置按钮必须调用 GridPane._showColumnPanel');

  // 菜单内部不得重复放置列设置
  var menuItems = doc.querySelectorAll('.menu-item, .menu button, [data-menu-action]');
  var hasDuplicateColumnSettings = false;
  for (var m = 0; m < menuItems.length; m++) {
    if (menuItems[m].textContent.indexOf('列设置') !== -1) {
      hasDuplicateColumnSettings = true;
      break;
    }
  }
  assert.strictEqual(hasDuplicateColumnSettings, false, '菜单内不得重复出现列设置项');

  // 4. 菜单分组检验：项目管理、工作日历、回收站、导入导出、启动偏好、低频打印
  var menuEl = doc.getElementById('menu-dropdown') || doc.getElementById('app-menu-dropdown') || doc.querySelector('.menu');
  assert.ok(menuEl, '必须存在菜单面板');
  var menuHtml = menuEl.innerHTML || menuEl._rawInner || '';
  assert.ok(menuHtml.indexOf('项目管理') !== -1, '菜单必须包含项目管理');
  assert.ok(menuHtml.indexOf('工作日历') !== -1, '菜单必须包含工作日历');
  assert.ok(menuHtml.indexOf('回收站') !== -1, '菜单必须包含回收站');
  assert.ok(menuHtml.indexOf('导出') !== -1 && menuHtml.indexOf('导入') !== -1, '菜单必须包含导入导出');
  assert.ok(menuHtml.indexOf('启动偏好') !== -1, '菜单必须包含启动偏好');
  assert.ok(menuHtml.indexOf('打印') !== -1, '菜单必须包含打印低频入口');

  // 5. 菜单交互与键盘焦点
  // 点击菜单按钮打开菜单
  btnMenu.click();
  assert.strictEqual(App.isMenuOpen(), true, '点击后菜单处于打开状态');

  // Escape 键关闭菜单并返回焦点
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.strictEqual(App.isMenuOpen(), false, '按 Escape 键必须关闭菜单');
  assert.strictEqual(doc.activeElement, btnMenu, '关闭菜单后焦点回到菜单按钮');

  // 外部点击关闭菜单
  btnMenu.click();
  assert.strictEqual(App.isMenuOpen(), true);
  doc.dispatchEvent({ type: 'click', target: env.body });
  assert.strictEqual(App.isMenuOpen(), false, '点击外部必须关闭菜单');

  // 6. 第二行布局：当前项目任务数、快捷筛选、今日节点开关
  var contextLabel = doc.getElementById('context-label') || doc.getElementById('project-task-count');
  assert.ok(contextLabel, '第二行必须显示当前项目与任务数量');
  assert.ok(contextLabel.textContent.indexOf('个任务') !== -1, '任务数文案包含「个任务」');

  var quickFilters = doc.getElementById('quick-filters') || doc.querySelector('.quick-filters');
  assert.ok(quickFilters, '第二行必须包含快捷筛选区');

  var btnToggleNodes = doc.getElementById('btn-toggle-nodes') || doc.getElementById('show-nodes');
  assert.ok(btnToggleNodes, '第二行或工具栏必须包含独立的今日节点开关');

  // 7. 撤销重做紧凑入口与快捷键
  var btnUndo = doc.getElementById('btn-undo');
  var btnRedo = doc.getElementById('btn-redo');
  assert.ok(btnUndo && btnRedo, '表格附近必须存在撤销与重做入口');
  var undoParent = btnUndo.closest('#grid-pane, #grid-header, .context-bar, #history-group');
  assert.ok(undoParent, '撤销重做按钮必须放置在表格附近');

  // 快捷键测试
  var undoCalled = false;
  var redoCalled = false;
  App.undo = function() { undoCalled = true; };
  App.redo = function() { redoCalled = true; };

  doc.dispatchEvent({ type: 'keydown', key: 'z', ctrlKey: true, shiftKey: false });
  assert.strictEqual(undoCalled, true, 'Ctrl+Z 触发撤销');

  doc.dispatchEvent({ type: 'keydown', key: 'z', ctrlKey: true, shiftKey: true });
  assert.strictEqual(redoCalled, true, 'Ctrl+Shift+Z 触发重做');

  // 8. 删月周日三按钮，甘特图右上加减粒度保持
  assert.strictEqual(doc.getElementById('btn-granularity-month'), null, '移除月视图切换按钮');
  assert.strictEqual(doc.getElementById('btn-granularity-week'), null, '移除周视图切换按钮');
  assert.strictEqual(doc.getElementById('btn-granularity-day'), null, '移除日视图切换按钮');

  var zoomIn = doc.getElementById('btn-gantt-zoom-in');
  var zoomOut = doc.getElementById('btn-gantt-zoom-out');
  assert.ok(zoomIn && zoomOut, '甘特图右上角必须保持加减粒度控件');

  // 9. 今日待办文案统一为今日节点
  var fullHtml = env.body.innerHTML;
  assert.strictEqual(fullHtml.indexOf('今日待办'), -1, '所有文案中不得出现「今日待办」');
  assert.ok(fullHtml.indexOf('今日节点') !== -1, '所有待办统一文案为「今日节点」');
});

// -------------------------------------------------------------
// 场景 2: disabled_features_do_not_initialize
// -------------------------------------------------------------
test('disabled_features_do_not_initialize: 启动不初始化旧功能、不发请求且算法保持', function() {
  var env = setupAppEnvironment({
    location: {
      hash: '#share=token-1234567890abcdef',
      search: '?readonly=1',
      pathname: '/'
    }
  });
  var App = env.App;
  var doc = env.doc;
  var appEnv = env.appEnv;

  // 注入初始化调用计数器
  var syncInitCount = 0;
  var shareInitCount = 0;
  var realtimeInitCount = 0;
  var realtimeConnectCount = 0;

  var SyncUI = appEnv.get('SyncUI');
  if (SyncUI) SyncUI.init = function() { syncInitCount++; };

  var ShareManager = appEnv.get('ShareManager');
  if (ShareManager) ShareManager.init = function() { shareInitCount++; };

  var RealtimeClient = appEnv.get('RealtimeClient');
  if (RealtimeClient) {
    RealtimeClient.init = function() { realtimeInitCount++; };
    RealtimeClient.connect = function() { realtimeConnectCount++; };
  }

  // 预设旧同步配置与旧分享链接
  appEnv.localStorage.setItem('pmweb_sync_config', JSON.stringify({
    serverUrl: 'https://evil-pocketbase.example.com',
    token: 'stale-token-xyz',
    projectId: 'remote-proj-1'
  }));
  appEnv.localStorage.setItem('pmweb_share_links', JSON.stringify([
    { tokenHash: 'hash-xyz', createdAt: '2026-01-01T00:00:00Z' }
  ]));

  // 注入网络请求拦截器，断言请求次数为 0
  var fetchCallCount = 0;
  appEnv.context.fetch = function(url) {
    fetchCallCount++;
    return Promise.reject(new Error('不应发起网络请求: ' + url));
  };

  App.init();

  // 1. 断言旧高级功能初始化计数均为 0
  assert.strictEqual(syncInitCount, 0, 'App 启动不得调用 SyncUI.init');
  assert.strictEqual(shareInitCount, 0, 'App 启动不得调用 ShareManager.init');
  assert.strictEqual(realtimeInitCount, 0, 'App 启动不得调用 RealtimeClient.init');
  assert.strictEqual(realtimeConnectCount, 0, 'App 启动不得调用 RealtimeClient.connect');

  // 2. 断言工具栏不挂载已移除功能的入口
  assert.strictEqual(doc.getElementById('btn-auto-schedule'), null, '工具栏不得存在自动排期入口');
  assert.strictEqual(doc.getElementById('btn-critical-path'), null, '工具栏不得存在关键路径开关');
  assert.strictEqual(doc.getElementById('baseline-dropdown'), null, '工具栏不得存在基线菜单');
  assert.strictEqual(doc.getElementById('btn-sync'), null, '工具栏不得存在云同步入口');
  assert.strictEqual(doc.getElementById('btn-share'), null, '工具栏不得存在远程分享入口');

  // 3. 断言旧同步配置不发网络请求
  assert.strictEqual(fetchCallCount, 0, '不得因旧同步配置触发任何网络请求');

  // 4. 断言旧分享 hash 不触发只读模式或远程请求
  assert.strictEqual(doc.getElementById('readonly-banner'), null, '不得因旧分享 hash 挂载只读横幅');
  assert.strictEqual(doc.body.classList.contains('readonly-mode'), false, '不得因旧分享 hash 触发 body.readonly-mode');

  // 5. 保持纯函数与模型算法
  var Baseline = appEnv.get('Baseline');
  var Scheduler = appEnv.get('Scheduler');
  var CriticalPath = appEnv.get('CriticalPath');

  assert.strictEqual(typeof Baseline.diff, 'function', '保留 Baseline.diff 纯函数算法');
  assert.strictEqual(typeof Scheduler.scheduleAll, 'function', '保留 Scheduler.scheduleAll 纯函数算法');
  assert.strictEqual(typeof CriticalPath.compute, 'function', '保留 CriticalPath.compute 纯函数算法');
});

// -------------------------------------------------------------
// 场景 4: column_settings_button_bubble_and_persistence
// -------------------------------------------------------------
test('column_settings_button_bubble_and_persistence: 工具栏外置列设置与全隐藏恢复按钮冒泡防护与面板可用性', function() {
  var env = setupAppEnvironment();
  var App = env.App;
  var doc = env.doc;
  var GridPane = env.GridPane;
  var Workspace = env.Workspace;

  App.init();
  var defaultProject = Workspace.data.projects[0];
  Workspace.activate(defaultProject.id);
  App.renderAll();

  var btnColumnSettings = doc.getElementById('btn-column-settings');
  assert.ok(btnColumnSettings, '工具栏外置列设置按钮必须存在');

  // 1. 真实触发工具栏外置列设置按钮 click 事件（允许沿 DOM 树冒泡至 document）
  btnColumnSettings.click();

  var panel = doc.querySelector('.grid-column-panel');
  assert.ok(panel, '点击工具栏外置按钮后列配置面板必须创建并挂载');
  assert.ok(panel.parentNode, '事件冒泡到 document 后列配置面板必须保持挂载开启状态，严禁同帧关闭');

  // 2. 验证面板内部交互能力
  var checkboxes = panel.querySelectorAll('input[data-draft-visible]');
  assert.ok(checkboxes.length > 0, '列配置面板必须包含列显隐复选框');

  // 3. 验证点击外部区域（如 document.body）后正常关闭
  doc.body.click();
  assert.strictEqual(doc.querySelector('.grid-column-panel'), null, '点击面板外部区域后列配置面板必须从 DOM 中移除关闭');

  // 4. 模拟全列隐藏场景，验证空状态恢复按钮冒泡与面板可用性
  // 再次打开面板
  btnColumnSettings.click();
  panel = doc.querySelector('.grid-column-panel');
  assert.ok(panel && panel.parentNode, '再次点击工具栏按钮列配置面板重新挂载打开');

  // 勾除所有列包括名称列
  checkboxes = panel.querySelectorAll('input[data-draft-visible]');
  checkboxes.forEach(function(cb) {
    cb.checked = false;
    cb.dispatchEvent({ type: 'change', bubbles: true });
  });

  // 点击面板内的保存按钮
  var saveBtn = panel.querySelector('#grid-draft-save');
  assert.ok(saveBtn, '列配置面板必须包含保存按钮');
  saveBtn.click();

  // 验证面板关闭且表格渲染全隐藏提示
  assert.strictEqual(doc.querySelector('.grid-column-panel'), null, '保存后面板正常关闭移除');
  var emptyHint = doc.querySelector('.grid-all-hidden-hint');
  assert.ok(emptyHint, '所有列隐藏后必须渲染 .grid-all-hidden-hint 空状态提示');
  var restoreBtn = emptyHint.querySelector('[data-action="open-column-settings"]');
  assert.ok(restoreBtn, '空状态提示必须包含 [data-action="open-column-settings"] 恢复入口按钮');

  // 点击恢复入口按钮（真实事件冒泡至 document）
  restoreBtn.click();

  var panelReopened = doc.querySelector('.grid-column-panel');
  assert.ok(panelReopened, '点击全隐藏恢复按钮后列配置面板必须重新挂载');
  assert.ok(panelReopened.parentNode, '点击全隐藏恢复按钮且事件冒泡到 document 后，列配置面板必须保持挂载开启');

  // 恢复一列并保存，验证空状态消失
  var firstCb = panelReopened.querySelector('input[data-draft-visible]');
  firstCb.checked = true;
  firstCb.dispatchEvent({ type: 'change', bubbles: true });
  var saveBtn2 = panelReopened.querySelector('#grid-draft-save');
  saveBtn2.click();

  assert.strictEqual(doc.querySelector('.grid-column-panel'), null, '恢复列保存后面板关闭移除');
  assert.strictEqual(doc.querySelector('.grid-all-hidden-hint'), null, '恢复可见列后空状态提示必须消失');
});

// -------------------------------------------------------------
// 场景 5: column_panel_stays_open_when_inner_click_rerenders
// -------------------------------------------------------------
test('column_panel_stays_open_when_inner_click_rerenders: 面板内部点击触发列表重渲染后面板必须保持打开', function() {
  var env = setupAppEnvironment();
  var App = env.App;
  var doc = env.doc;
  var Workspace = env.Workspace;

  App.init();
  Workspace.activate(Workspace.data.projects[0].id);
  App.renderAll();

  doc.getElementById('btn-column-settings').click();
  var panel = doc.querySelector('.grid-column-panel');
  assert.ok(panel && panel.parentNode, '工具栏按钮打开列配置面板');

  // 真实点击「添加」按钮：该按钮的父面板已在同一帧内被 _renderPanelList 重渲染
  var addBtn = panel.querySelector('#grid-add-col-btn');
  assert.ok(addBtn, '列配置面板必须包含新增自定义列按钮');
  var nameInput = panel.querySelector('#grid-new-col-name');
  nameInput.value = '重渲染列';
  addBtn.click();

  var reopened = doc.querySelector('.grid-column-panel');
  assert.ok(reopened, '面板内部点击触发列表重渲染后，document 外点监听严禁把已脱离节点的点击误判为外部点击');
  assert.ok(reopened.parentNode, '面板必须保持挂载开启状态');
  var labels = reopened.querySelectorAll('input[data-draft-label]');
  var found = false;
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].value === '重渲染列') { found = true; break; }
  }
  assert.strictEqual(found, true, '新增列必须进入草稿列表并在面板中渲染');
});

// -------------------------------------------------------------
// 场景 6: column_panel_add_row_wraps_within_panel
// -------------------------------------------------------------
test('column_panel_add_row_wraps_within_panel: 新增列一行必须可换行，避免按钮被面板裁切而无法点击', function() {
  var fs = require('fs');
  var path = require('path');
  var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'grid.css'), 'utf8');

  assert.ok(/\.grid-column-add-row\s*\{[^}]*flex-wrap:\s*wrap/.test(css),
    'css/grid.css 必须定义 .grid-column-add-row 且允许 flex-wrap: wrap，避免 232px 面板内新增列一行横向溢出');
  assert.ok(/\.grid-column-add-row\s+input\s*\{[^}]*min-width:\s*0/.test(css),
    '.grid-column-add-row 内的输入框必须允许收缩到 min-width: 0，避免挤压按钮');

  var env = setupAppEnvironment();
  var App = env.App;
  var doc = env.doc;
  var Workspace = env.Workspace;

  App.init();
  Workspace.activate(Workspace.data.projects[0].id);
  App.renderAll();

  doc.getElementById('btn-column-settings').click();
  var panel = doc.querySelector('.grid-column-panel');
  assert.ok(panel, '列配置面板必须打开');

  var addBtn = panel.querySelector('#grid-add-col-btn');
  assert.ok(addBtn, '面板必须包含新增按钮');
  var row = addBtn.parentNode;
  assert.ok(row.classList.contains('grid-column-add-row'),
    '新增列一行必须使用 .grid-column-add-row 布局类，保证真实指针可点击');
});

// -------------------------------------------------------------
// 场景 7: startup_last_mode_keeps_last_project_id
// -------------------------------------------------------------
test('startup_last_mode_keeps_last_project_id: 启动偏好选择 last 模式保存时不得清空 lastProjectId', function() {
  var env = setupAppEnvironment();
  var App = env.App;
  var doc = env.doc;
  var Workspace = env.Workspace;
  var ModalManager = env.appEnv.get('ModalManager');

  App.init();
  var projectA = Workspace.data.projects[0];
  Workspace.activate(projectA.id);
  App.renderAll();

  var lastBefore = Workspace.data.settings.lastProjectId;
  assert.strictEqual(lastBefore, projectA.id, '激活项目后 lastProjectId 应记录当前项目');

  App.showStartupSettings();
  var lastRadio = doc.querySelector('input[name="startup-choice"][value="last"]');
  assert.ok(lastRadio, '启动偏好弹窗必须包含「自动进入上次打开的项目」选项');
  lastRadio.checked = true;
  lastRadio.dispatchEvent({ type: 'change', bubbles: true });

  var saveBtn = doc.getElementById('btn-save-startup');
  assert.ok(saveBtn, '启动偏好弹窗必须包含保存按钮');
  saveBtn.click();

  assert.strictEqual(Workspace.data.settings.startupMode, 'last');
  assert.strictEqual(Workspace.data.settings.lastProjectId, projectA.id,
    '仅切换到 last 模式时严禁把 lastProjectId 清空，否则该偏好永远无法生效');
  assert.strictEqual(Workspace.resolveStartup(), projectA.id, 'last 模式必须能解析到上次打开的项目');
});

// -------------------------------------------------------------
// 场景 8: search_input_matches_toolbar_controls
// -------------------------------------------------------------
test('search_input_matches_toolbar_controls: 搜索框复用工具栏控件 token 且保持既有宽度', function() {
  var fs = require('fs');
  var path = require('path');
  var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'layout.css'), 'utf8');

  var shared = css.match(/\.search-input,\s*\n\.search\s*\{([\s\S]*?)\}/);
  assert.ok(shared, 'layout.css 必须存在 .search-input 与 .search 共享样式块');
  var block = shared[1];
  assert.ok(/height:\s*36px/.test(block), '搜索框高度必须与 .btn 的 36px 对齐');
  assert.ok(/border:\s*1px solid var\(--color-border\)/.test(block), '搜索框必须复用 --color-border 边框');
  assert.ok(/border-radius:\s*var\(--radius-inputs/.test(block), '搜索框必须复用 --radius-inputs 圆角');
  assert.ok(/background:\s*var\(--color-surface\)/.test(block), '搜索框必须复用 --color-surface 背景');
  assert.ok(/padding:\s*0 12px/.test(block), '搜索框必须有与控件一致的横向内边距');
  assert.ok(/font-size:\s*var\(--text-body-sm\)/.test(block), '搜索框字号必须与 .btn 一致');
  assert.ok(/0 0 152px/.test(block), '搜索框桌面宽度必须保持 152px 且 flex-grow: 0');

  assert.ok(/\.search-input:focus,\s*\n\.search:focus\s*\{[\s\S]*?border-color:\s*var\(--color-action-blue\)/.test(css),
    '搜索框聚焦必须使用系统 focus ring 的同色边框');
  assert.ok(/\.search-input::placeholder,\s*\n\.search::placeholder\s*\{[\s\S]*?color:\s*var\(--color-slate-light\)/.test(css),
    '搜索框 placeholder 必须使用弱化文字色');
  assert.ok(css.indexOf('max-width: 520px') !== -1 && css.indexOf('132px') !== -1, '窄屏 132px 规则必须保留');
});

// -------------------------------------------------------------
// 场景 9: column_panel_top_trigger_anchor_toggle_aria
// -------------------------------------------------------------
function setupColumnPanelEnv() {
  var env = setupAppEnvironment();
  env.App.init();
  env.Workspace.activate(env.Workspace.data.projects[0].id);
  env.App.renderAll();
  env.appEnv.context.window.innerWidth = 1280;
  env.appEnv.context.window.innerHeight = 800;
  return env;
}

function stubTriggerRect(btn) {
  btn.getBoundingClientRect = function() {
    return { left: 600, right: 700, top: 10, bottom: 46, width: 100, height: 36 };
  };
}

test('column_panel_top_trigger_anchor_toggle_aria: 顶部按钮触发时面板锚定该按钮且同按钮二次点击关闭', function() {
  var env = setupColumnPanelEnv();
  var doc = env.doc;
  var btn = doc.getElementById('btn-column-settings');
  assert.ok(btn, '顶部列设置按钮必须存在');
  stubTriggerRect(btn);

  btn.click();
  var panels = doc.querySelectorAll('.grid-column-panel');
  assert.strictEqual(panels.length, 1, '点击顶部按钮必须只创建一个列配置面板');
  var panel = panels[0];
  assert.ok(panel.parentNode, '面板必须挂载到文档');

  var left = parseFloat(panel.style.left);
  var top = parseFloat(panel.style.top);
  assert.ok(isFinite(left) && isFinite(top), '面板必须写入有效 left/top 定位');
  assert.strictEqual(left, 600, '面板左边缘必须对齐顶部触发按钮，而非表格内部按钮');
  assert.ok(top >= 46 && top <= 60, '面板必须出现在触发按钮下方（bottom + 4）');

  assert.strictEqual(btn.getAttribute('aria-haspopup'), 'dialog', '顶部列设置按钮必须声明 aria-haspopup="dialog"');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true', '打开后顶部按钮 aria-expanded 必须为 true');
  var gridBtn = doc.querySelector('.grid-columns-btn');
  assert.ok(gridBtn, '表格内部列按钮必须存在');
  assert.strictEqual(gridBtn.getAttribute('aria-expanded'), 'true', '打开后表格内部按钮 aria-expanded 必须同步为 true');

  btn.click();
  assert.strictEqual(doc.querySelector('.grid-column-panel'), null, '再次点击同一顶部按钮必须关闭面板且不叠加');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false', '关闭后顶部按钮 aria-expanded 必须为 false');
  assert.strictEqual(doc.querySelector('.grid-columns-btn').getAttribute('aria-expanded'), 'false',
    '关闭后表格内部按钮 aria-expanded 必须同步为 false');
});

test('column_panel_top_trigger_clamps_to_viewport: 窄视口下顶部触发面板不得越界', function() {
  var env = setupColumnPanelEnv();
  var doc = env.doc;
  var btn = doc.getElementById('btn-column-settings');
  env.appEnv.context.window.innerWidth = 390;
  btn.getBoundingClientRect = function() {
    return { left: 300, right: 380, top: 10, bottom: 46, width: 80, height: 36 };
  };

  btn.click();
  var panel = doc.querySelector('.grid-column-panel');
  assert.ok(panel, '窄视口下面板必须打开');
  var left = parseFloat(panel.style.left);
  assert.ok(left >= 4 && left + 232 <= 390 - 4 + 1, '面板必须水平夹取在 390px 视口内');
});

test('column_panel_draft_not_persisted_on_trigger_close: 关闭不保存草稿', function() {
  var env = setupColumnPanelEnv();
  var doc = env.doc;
  var btn = doc.getElementById('btn-column-settings');
  stubTriggerRect(btn);

  btn.click();
  var panel = doc.querySelector('.grid-column-panel');
  var checkbox = panel.querySelector('input[data-draft-visible]');
  assert.strictEqual(checkbox.checked, true, '名称列默认可见');
  checkbox.checked = false;
  checkbox.dispatchEvent({ type: 'change', bubbles: true });

  btn.click();
  assert.strictEqual(doc.querySelector('.grid-column-panel'), null, '同按钮关闭面板');

  btn.click();
  var reopened = doc.querySelector('.grid-column-panel');
  assert.ok(reopened, '面板可重新打开');
  var reopenedCheckbox = reopened.querySelector('input[data-draft-visible]');
  assert.strictEqual(reopenedCheckbox.checked, true, '未保存的草稿不得在关闭后持久化');
});

// -------------------------------------------------------------
// 场景 10: column_panel_outside_escape_cancel_focus
// -------------------------------------------------------------
test('column_panel_outside_escape_cancel_focus: 外点/Esc/取消关闭且 Esc 归还焦点', function() {
  var env = setupColumnPanelEnv();
  var doc = env.doc;
  var btn = doc.getElementById('btn-column-settings');
  stubTriggerRect(btn);

  btn.click();
  assert.ok(doc.querySelector('.grid-column-panel'), '顶部按钮打开面板');
  doc.body.click();
  assert.strictEqual(doc.querySelector('.grid-column-panel'), null, '点击面板外部必须关闭');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false', '外点关闭后 aria-expanded 同步');

  btn.click();
  assert.ok(doc.querySelector('.grid-column-panel'), '重新打开面板');
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.strictEqual(doc.querySelector('.grid-column-panel'), null, 'Esc 必须关闭面板');
  assert.strictEqual(doc.activeElement, btn, 'Esc 关闭后焦点必须回到触发按钮');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false', 'Esc 关闭后 aria-expanded 同步');

  btn.click();
  var panel = doc.querySelector('.grid-column-panel');
  var labelInput = panel.querySelector('input[data-draft-label]');
  var original = labelInput.value;
  labelInput.value = '临时改名';
  labelInput.dispatchEvent({ type: 'input', bubbles: true });
  panel.querySelector('#grid-draft-cancel').click();
  assert.strictEqual(doc.querySelector('.grid-column-panel'), null, '取消按钮必须关闭面板');

  btn.click();
  var reopened = doc.querySelector('.grid-column-panel');
  assert.strictEqual(reopened.querySelector('input[data-draft-label]').value, original,
    '取消不得保存列名草稿');
});

// 执行本文件所有测试
var failures = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + t.name);
    console.log('  ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.log(err.stack);
  }
});

console.log('\nnavigation: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
