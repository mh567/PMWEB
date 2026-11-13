'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'validate.js',
  'store.js',
  'workspace.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'work-calendar.js',
  'task-manager.js',
  'row-model.js',
  'views.js',
  'cell-editor.js',
  'progress.js',
  'export.js',
  'modal.js'
]);

var DateUtil = app.get('DateUtil');
var TaskManager = app.get('TaskManager');
var CellEditor = app.get('CellEditor');
var Views = app.get('Views');
var Progress = app.get('Progress');
var Export = app.get('Export');
var RowModel = app.get('RowModel');
var Workspace = app.get('Workspace');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

// 1. 新建任务默认为 todo 且进度为 0
test('new_task_is_todo_with_zero_progress', function() {
  helper.resetProject(app);
  var newTask = TaskManager.addTask(null, '新功能开发');
  assert.ok(newTask, '任务应创建成功');
  assert.equal(newTask.status, 'todo');
  assert.equal(newTask.progress, 0);

  // 子任务也必须是 todo 且进度为 0
  var childTask = TaskManager.addTask(newTask.id, '子任务模块');
  assert.ok(childTask, '子任务应创建成功');
  assert.equal(childTask.status, 'todo');
  assert.equal(childTask.progress, 0);
});

// 2. 四状态创建、编辑、导入导出往返
test('four_statuses_round_trip', function() {
  helper.resetProject(app);

  var t1 = TaskManager.addTask(null, '任务未开始');
  var t2 = TaskManager.addTask(null, '任务进行中');
  TaskManager.updateTask(t2.id, { status: 'inProgress', progress: 40 });
  var t3 = TaskManager.addTask(null, '任务第三方');
  TaskManager.updateTask(t3.id, { status: 'thirdParty', progress: 30 });
  var t4 = TaskManager.addTask(null, '任务已完成');
  TaskManager.updateTask(t4.id, { status: 'done', progress: 100 });

  assert.equal(TaskManager.getTask(t1.id).status, 'todo');
  assert.equal(TaskManager.getTask(t2.id).status, 'inProgress');
  assert.equal(TaskManager.getTask(t3.id).status, 'thirdParty');
  assert.equal(TaskManager.getTask(t4.id).status, 'done');

  // CellEditor 解析与格式化
  ['todo', 'inProgress', 'thirdParty', 'done'].forEach(function(st) {
    var parsed = CellEditor.parse('status', st, {});
    assert.equal(parsed.ok, true, 'CellEditor 应接受状态: ' + st);
    assert.equal(parsed.value, st);
  });
  assert.equal(CellEditor.format('status', 'todo'), '未开始');
  assert.equal(CellEditor.format('status', 'inProgress'), '进行中');
  assert.equal(CellEditor.format('status', 'thirdParty'), '第三方');
  assert.equal(CellEditor.format('status', 'done'), '已完成');

  // Export 视图与任务表导出
  var rows = RowModel.build({ collapsed: new Set(), statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true } }).rows;
  var viewRows = Export.buildViewRows(rows, [
    { key: 'name', label: '名称', visible: true },
    { key: 'status', label: '状态', visible: true }
  ]);
  var statusLabelsInExport = viewRows.slice(1).map(function(r) { return r[1]; });
  assert.ok(statusLabelsInExport.indexOf('未开始') !== -1, '导出应包含 未开始');
  assert.ok(statusLabelsInExport.indexOf('进行中') !== -1, '导出应包含 进行中');
  assert.ok(statusLabelsInExport.indexOf('第三方') !== -1, '导出应包含 第三方');
  assert.ok(statusLabelsInExport.indexOf('已完成') !== -1, '导出应包含 已完成');

  var taskRows = Export.buildTaskRows(TaskManager.getAllTasks(), { taskManager: TaskManager });
  var legacyLabels = taskRows.slice(1).map(function(r) { return r[5]; });
  assert.ok(legacyLabels.indexOf('未开始') !== -1, '任务列表导出应包含 未开始');

  // 存储持久化与重新加载
  var savedRaw = app.localStorage.getItem('pmweb_data');
  var parsedWs = JSON.parse(savedRaw);
  var projectTasks = parsedWs.projects[0].data.tasks;
  var reloadedT1 = projectTasks.find(function(t) { return t.id === t1.id; });
  assert.equal(reloadedT1.status, 'todo', '重载后原状态 todo 必须保持');
  assert.equal(reloadedT1.progress, 0, '重载后原进度 0 必须保持');
});

// 3. 相对日期边界与父层级保留
test('relative_due_boundaries_keep_parent_context', function() {
  helper.resetProject(app);
  var fixedToday = '2026-11-11';

  var p = TaskManager.addTask(null, '父任务P');
  var c10 = TaskManager.addTask(p.id, '任务逾期10');
  TaskManager.updateTask(c10.id, { startDate: '2026-11-01', endDate: '2026-11-10', status: 'todo' });

  var c11 = TaskManager.addTask(p.id, '任务今日11');
  TaskManager.updateTask(c11.id, { startDate: '2026-11-01', endDate: '2026-11-11', status: 'inProgress' });

  var c17 = TaskManager.addTask(p.id, '任务边界17');
  TaskManager.updateTask(c17.id, { startDate: '2026-11-05', endDate: '2026-11-17', status: 'thirdParty' });

  var c18 = TaskManager.addTask(p.id, '任务界外18');
  TaskManager.updateTask(c18.id, { startDate: '2026-11-05', endDate: '2026-11-18', status: 'todo' });

  var cDone10 = TaskManager.addTask(p.id, '任务已完成10');
  TaskManager.updateTask(cDone10.id, { startDate: '2026-11-01', endDate: '2026-11-10', status: 'done', progress: 100 });

  var cDone11 = TaskManager.addTask(p.id, '任务已完成11');
  TaskManager.updateTask(cDone11.id, { startDate: '2026-11-01', endDate: '2026-11-11', status: 'done', progress: 100 });

  var cNoDate = TaskManager.addTask(p.id, '任务无日期');
  TaskManager.updateTask(cNoDate.id, { startDate: null, endDate: null, status: 'todo' });

  var pOnlyDate = TaskManager.addTask(null, '父任务仅有日期');
  TaskManager.updateTask(pOnlyDate.id, { startDate: '2026-11-01', endDate: '2026-11-11' });
  var cFar = TaskManager.addTask(pOnlyDate.id, '子任务远期');
  TaskManager.updateTask(cFar.id, { startDate: '2026-12-01', endDate: '2026-12-10', status: 'todo' });

  var rows = RowModel.build({
    collapsed: new Set(),
    statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true }
  }).rows;

  // 1. 测试 overdue
  var overdueRows = Views.filterRows(rows, { due: 'overdue' }, fixedToday);
  var overdueLeafIds = plain(overdueRows.filter(function(r) { return !r.isSummary; }).map(function(r) { return r.id; }));
  assert.deepEqual(overdueLeafIds, [c10.id], 'overdue 仅包含未完成且结束日期早于今天的叶子任务');
  // 父任务 P 应保留作为层级上下文
  assert.ok(overdueRows.some(function(r) { return r.id === p.id; }), '父任务 P 作为上下文保留');
  assert.ok(!overdueRows.some(function(r) { return r.id === pOnlyDate.id; }), '无到期子任务的父任务不保留');

  // 2. 测试 today
  var todayRows = Views.filterRows(rows, { due: 'today' }, fixedToday);
  var todayLeafIds = plain(todayRows.filter(function(r) { return !r.isSummary; }).map(function(r) { return r.id; }));
  assert.deepEqual(todayLeafIds, [c11.id], 'today 仅包含未完成且结束日期等于今天的叶子任务');
  assert.ok(todayRows.some(function(r) { return r.id === p.id; }), '父任务 P 作为上下文保留');

  // 3. 测试 next7
  var next7Rows = Views.filterRows(rows, { due: 'next7' }, fixedToday);
  var next7LeafIds = plain(next7Rows.filter(function(r) { return !r.isSummary; }).map(function(r) { return r.id; }));
  assert.deepEqual(next7LeafIds, [c11.id, c17.id], 'next7 只包含今天到后第6天(11和17)，不含18和已完成');
  assert.ok(next7Rows.some(function(r) { return r.id === p.id; }), '父任务 P 作为上下文保留');

  // 4. TASK3-IMPT-01: 父任务 raw status 为 todo，子任务全为 inProgress。筛选 todo 时，父行绝不能孤立保留
  var pIso = TaskManager.addTask(null, '孤立父任务');
  var cIso1 = TaskManager.addTask(pIso.id, '子任务1');
  var cIso2 = TaskManager.addTask(pIso.id, '子任务2');
  TaskManager.updateTask(cIso1.id, { status: 'inProgress', progress: 50 });
  TaskManager.updateTask(cIso2.id, { status: 'inProgress', progress: 50 });
  var rowsWithIso = RowModel.build({
    collapsed: new Set(),
    statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true }
  }).rows;
  var todoFiltered = Views.filterRows(rowsWithIso, { status: 'todo' });
  assert.ok(!todoFiltered.some(function(r) { return r.id === pIso.id; }), '子任务全为 inProgress 时，筛选 todo 绝不能孤立保留父行');
});

// 4. 父任务状态汇总与原进度保持
test('parent_task_status_rollup', function() {
  helper.resetProject(app);

  // 场景 A: 子任务全 todo -> 汇总状态为 todo
  var pA = TaskManager.addTask(null, '全未开始父任务');
  var a1 = TaskManager.addTask(pA.id, 'A1');
  var a2 = TaskManager.addTask(pA.id, 'A2');
  TaskManager.updateTask(a1.id, { status: 'todo', progress: 0 });
  TaskManager.updateTask(a2.id, { status: 'todo', progress: 0 });

  // 场景 B: 子任务全 done -> 汇总状态为 done
  var pB = TaskManager.addTask(null, '全完成父任务');
  var b1 = TaskManager.addTask(pB.id, 'B1');
  var b2 = TaskManager.addTask(pB.id, 'B2');
  TaskManager.updateTask(b1.id, { status: 'done', progress: 100 });
  TaskManager.updateTask(b2.id, { status: 'done', progress: 100 });

  // 场景 C: 子任务混合 -> 进行中
  var pC = TaskManager.addTask(null, '混合父任务');
  var c1 = TaskManager.addTask(pC.id, 'C1');
  var c2 = TaskManager.addTask(pC.id, 'C2');
  TaskManager.updateTask(c1.id, { status: 'todo', progress: 0 });
  TaskManager.updateTask(c2.id, { status: 'inProgress', progress: 50 });

  // 场景 D: 子任务含第三方跟进且无进行中 -> 第三方跟进
  var pD = TaskManager.addTask(null, '第三方父任务');
  var d1 = TaskManager.addTask(pD.id, 'D1');
  var d2 = TaskManager.addTask(pD.id, 'D2');
  TaskManager.updateTask(d1.id, { status: 'thirdParty', progress: 30 });
  TaskManager.updateTask(d2.id, { status: 'todo', progress: 0 });
  // 原任务在存储中的 progress 和日期绝不能被批量改写
  assert.equal(TaskManager.getTask(a1.id).progress, 0);
  assert.equal(TaskManager.getTask(a2.id).progress, 0);

  var statusA = Progress.rollupStatus(pA, TaskManager.getChildren(pA.id), function(id) { return TaskManager.getChildren(id); });
  assert.equal(statusA, 'todo', '全 todo 子任务汇总应为 todo');

  var statusB = Progress.rollupStatus(pB, TaskManager.getChildren(pB.id), function(id) { return TaskManager.getChildren(id); });
  assert.equal(statusB, 'done', '全 done 子任务汇总应为 done');

  var statusC = Progress.rollupStatus(pC, TaskManager.getChildren(pC.id), function(id) { return TaskManager.getChildren(id); });
  assert.equal(statusC, 'inProgress', '混合子任务汇总应为 inProgress');

  var statusD = Progress.rollupStatus(pD, TaskManager.getChildren(pD.id), function(id) { return TaskManager.getChildren(id); });
  assert.equal(statusD, 'thirdParty', '含第三方子任务汇总应为 thirdParty');

  // 场景 E (TASK3-IMPT-02): 父任务 raw status 为 thirdParty，但子任务全部为 inProgress -> 必须汇总为 inProgress
  var pE = TaskManager.addTask(null, '原始第三方父任务');
  TaskManager.updateTask(pE.id, { status: 'thirdParty' });
  var e1 = TaskManager.addTask(pE.id, 'E1');
  var e2 = TaskManager.addTask(pE.id, 'E2');
  TaskManager.updateTask(e1.id, { status: 'inProgress', progress: 40 });
  TaskManager.updateTask(e2.id, { status: 'inProgress', progress: 60 });
  var statusE = Progress.rollupStatus(pE, TaskManager.getChildren(pE.id), function(id) { return TaskManager.getChildren(id); });
  assert.equal(statusE, 'inProgress', '父 raw thirdParty 但子全 inProgress 必须汇总为 inProgress');
});

test('calendar_add_days_local_timezone', function() {
  assert.equal(typeof DateUtil.addDays, 'function', 'DateUtil.addDays 必须为函数');

  // 月底跨月
  assert.equal(DateUtil.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(DateUtil.addDays('2026-11-30', 1), '2026-12-01');

  // 闰年与平年 2 月加天
  assert.equal(DateUtil.addDays('2024-02-28', 1), '2024-02-29', '2024 闰年 2-28 + 1 天应为 2-29');
  assert.equal(DateUtil.addDays('2024-02-28', 2), '2024-03-01', '2024 闰年 2-28 + 2 天应为 3-01');
  assert.equal(DateUtil.addDays('2023-02-28', 1), '2023-03-01', '2023 平年 2-28 + 1 天应为 3-01');

  // 跨年加天
  assert.equal(DateUtil.addDays('2026-12-31', 1), '2027-01-01');

  // 减天
  assert.equal(DateUtil.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(DateUtil.addDays('2024-03-01', -1), '2024-02-29');

  // 显式在 America/New_York 时区验证夏令时 23 小时与 25 小时切换日
  var cp = require('child_process');
  var dstOutput = cp.execSync(
    'TZ=America/New_York node -e "var helper = require(\'./tests/helpers/load\'); var app = helper.createApp([\'date.js\']); var DateUtil = app.get(\'DateUtil\'); console.log(DateUtil.addDays(\'2026-03-07\', 1) + \',\' + DateUtil.addDays(\'2026-03-07\', 2) + \',\' + DateUtil.addDays(\'2026-10-31\', 1) + \',\' + DateUtil.addDays(\'2026-10-31\', 2));"',
    { cwd: require('path').resolve(__dirname, '..'), encoding: 'utf8' }
  ).trim();
  assert.equal(dstOutput, '2026-03-08,2026-03-09,2026-11-01,2026-11-02', 'America/New_York 夏令时 23h/25h 切换日计算准确');
});

// 6. 跨天与 visibilitychange 重算
test('cross_day_and_visibilitychange_recalculation', function() {
  // 固定 today 为 2026-11-11
  var view = Views.normalizeView({ filters: { due: 'today' } });
  assert.equal(view.filters.due, 'today');

  var rowItem = {
    id: 't-today',
    isSummary: false,
    startDate: '2026-11-01',
    endDate: '2026-11-11',
    task: { id: 't-today', status: 'inProgress', endDate: '2026-11-11' }
  };

  // 2026-11-11 当天匹配 today
  var filtered1 = Views.filterRows([rowItem], view.filters, '2026-11-11');
  assert.equal(filtered1.length, 1);

  // 跨午夜后日期变为 2026-11-12，同一视图重算该任务不再是 today，而是 overdue
  var filtered2 = Views.filterRows([rowItem], view.filters, '2026-11-12');
  assert.equal(filtered2.length, 0, '跨天后 11-11 任务不再匹配 today');

  var overdueView = Views.normalizeView({ filters: { due: 'overdue' } });
  var filteredOverdue = Views.filterRows([rowItem], overdueView.filters, '2026-11-12');
  assert.equal(filteredOverdue.length, 1, '跨天后 11-11 任务匹配 overdue');
});

// 7. 今日节点仅看当前项目当天里程碑
test('today_milestones_only_milestones_not_mixed_with_due_tasks', function() {
  helper.resetProject(app);
  var t1 = TaskManager.addTask(null, '到期任务无节点');
  TaskManager.updateTask(t1.id, { startDate: '2026-11-01', endDate: '2026-11-11', status: 'inProgress' });

  var t2 = TaskManager.addTask(null, '节点所属任务');
  TaskManager.updateTask(t2.id, { startDate: '2026-11-01', endDate: '2026-11-15' });
  var m1 = TaskManager.addMilestone(t2.id, '今日重要节点', '2026-11-11', 'pending');

  var allMilestones = TaskManager.getAllMilestones();
  var todayMs = allMilestones.filter(function(m) { return m.date === '2026-11-11'; });
  assert.equal(todayMs.length, 1);
  assert.equal(todayMs[0].name, '今日重要节点');
  assert.equal(todayMs[0].taskId, t2.id);
});

// 8. 真实 App 定时器与 visibilitychange 跨天及项目切换生命周期
test('app_real_timer_visibilitychange_and_project_switch_lifecycle', function() {
  var domStub = require('./helpers/dom-stub');
  var doc = domStub.createDocument();
  var todosList = domStub.createElement('div'); todosList.id = 'todos-list'; doc.body.appendChild(todosList);
  var statusText = domStub.createElement('div'); statusText.id = 'status-text'; doc.body.appendChild(statusText);
  var statusInfo = domStub.createElement('div'); statusInfo.id = 'status-info'; doc.body.appendChild(statusInfo);

  var scripts = [
    'date.js', 'validate.js', 'store.js', 'workspace.js', 'history.js',
    'comments.js', 'activity.js', 'attachment-meta.js', 'attachment-store.js',
    'work-calendar.js', 'task-manager.js', 'row-model.js', 'views.js',
    'cell-editor.js', 'progress.js', 'export.js', 'modal.js', 'tree-view.js', 'workbench.js', 'app.js'
  ];
  var harness = helper.createApp(scripts);
  harness.context.document = doc;
  helper.resetProject(harness);

  var appInstance = harness.get('App');
  var tm = harness.get('TaskManager');
  var ws = harness.get('Workspace');
  var wb = harness.get('Workbench');
  var vs = harness.get('ViewState');

  var activeTimer = null;
  var timerCount = 0;
  harness.context.setTimeout = function(fn, ms) {
    timerCount++;
    activeTimer = { fn: fn, ms: ms };
    return timerCount;
  };
  harness.context.clearTimeout = function(id) {
    if (activeTimer) activeTimer = null;
  };

  var currentDate = '2026-11-11';
  var origFormat = harness.get('DateUtil').format;
  harness.get('DateUtil').format = function() { return currentDate; };

  // 1. 初始化数据：含当天到期任务与当天里程碑
  var t1 = tm.addTask(null, '今日任务');
  tm.updateTask(t1.id, { startDate: '2026-11-01', endDate: '2026-11-11', status: 'inProgress' });
  var m1 = tm.addMilestone(t1.id, '今日节点', '2026-11-11', 'pending');
  vs.view.filters.due = 'today';
  wb._today = '2026-11-11';
  wb.render();

  appInstance._bindVisibilityChange();
  appInstance._setupMidnightTimer();

  assert.ok(activeTimer, '必须实际注册午夜定时器回调');
  assert.equal(appInstance._visibilityBound, true, '必须标记 visibilitychange 已绑定');

  appInstance._updateTodosSidebar();
  assert.ok(todosList.innerHTML.indexOf('今日节点') !== -1, '初始状态应展示今日节点');

  // 2. 模拟本地跨午夜触发
  currentDate = '2026-11-12';
  wb._today = '2026-11-12';

  var firstTimerCallback = activeTimer.fn;
  firstTimerCallback();

  assert.ok(todosList.innerHTML.indexOf('今日暂无节点') !== -1 || todosList.innerHTML.indexOf('今日暂无待办') !== -1, '跨天后 11-11 节点不再展示在今日待办');
  assert.equal(wb._rows.filter(function(r) { return !r.isSummary; }).length, 0, '跨天后视图重新计算，today 筛选不再匹配昨天任务');
  assert.ok(activeTimer, '跨天后必须重新安排下一次午夜定时器');

  // 3. 模拟 visibilitychange 从 hidden 到 visible
  currentDate = '2026-11-13';
  wb._today = '2026-11-13';
  tm.updateTask(t1.id, { endDate: '2026-11-20' });
  var m2 = tm.addMilestone(t1.id, '新一天节点', '2026-11-13', 'pending');
  assert.ok(m2, '里程碑必须成功添加在任务有效日期范围内');

  doc.visibilityState = 'hidden';
  doc.dispatchEvent({ type: 'visibilitychange' });

  doc.visibilityState = 'visible';
  doc.dispatchEvent({ type: 'visibilitychange' });

  assert.ok(todosList.innerHTML.indexOf('新一天节点') !== -1, '可见性恢复后真实触发重算并渲染 11-13 节点');

  // 4. 重复初始化与项目切换：验证定时器不累积、监听不重复
  var initialListenerCount = doc._listeners['visibilitychange'].length;
  assert.equal(initialListenerCount, 1, 'visibilitychange 监听器数量应为 1');

  appInstance._bindVisibilityChange();
  assert.equal(doc._listeners['visibilitychange'].length, 1, '重复绑定不应累积 visibilitychange 监听器');

  var p2 = ws.createProject({ name: '第二项目' });
  ws.activate(p2.id);
  appInstance._setupMidnightTimer();

  assert.ok(activeTimer, '项目切换后维持单一活跃午夜定时器');
  assert.equal(doc._listeners['visibilitychange'].length, 1, '项目切换后不累积监听器');

  harness.get('DateUtil').format = origFormat;
});

// 运行测试
var failed = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (e) {
    failed++;
    console.error('FAIL ' + t.name + '\n  ' + e.message + '\n' + e.stack);
  }
});

if (failed > 0) {
  process.exitCode = 1;
}
