'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'resources.js',
  'task-manager.js',
  'workbench.js',
  'app.js'
]);

var TaskManager = app.get('TaskManager');
var Workbench = app.get('Workbench');
var App = app.get('App');
var ViewState = app.get('ViewState');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

function reset() {
  app.localStorage._store = {};
  app.alerts.length = 0;
  helper.resetProject(app);
  return TaskManager;
}

function task(id, assignee, startDate, endDate, estimatedHours) {
  var item = {
    id: id,
    name: id,
    assignee: assignee,
    startDate: startDate,
    endDate: endDate
  };
  if (estimatedHours !== undefined) item.estimatedHours = estimatedHours;
  return item;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ------------------------------------------------------------
// 工作视图模型
// ------------------------------------------------------------

test('buildResourceModel: 按日展示每人每日工时和容量', function() {
  var model = Workbench.buildResourceModel([
    task('t1', '张三', '2026-01-05', '2026-01-06'),
    task('t2', '李四', '2026-01-05', '2026-01-05', 4)
  ], { granularity: 'day', capacity: 8 });

  assert.strictEqual(model.granularity, 'day');
  assert.deepStrictEqual(plain(model.dates), ['2026-01-05', '2026-01-06']);
  assert.deepStrictEqual(plain(model.rows.map(function(row) { return row.assignee; })),
    ['张三', '李四']);
  assert.strictEqual(model.rows[0].capacityLimit, 8);
  assert.deepStrictEqual(plain(model.rows[0].cells.map(function(cell) { return cell.hours; })),
    [8, 8]);
  assert.strictEqual(model.rows[0].overloadCount, 0);
  assert.strictEqual(model.summary.totalAssignees, 2);
  assert.strictEqual(model.summary.totalHours, 20);
  assert.strictEqual(model.summary.overloadedAssignees, 0);
  assert.deepStrictEqual(plain(model.conflicts), []);
});

test('buildResourceModel: 容量覆盖后标记超载单元格', function() {
  var model = Workbench.buildResourceModel([
    task('t1', '张三', '2026-01-05', '2026-01-06')
  ], { granularity: 'day', capacity: 4 });

  var row = model.rows[0];
  assert.strictEqual(row.capacityLimit, 4);
  assert.strictEqual(row.overloadCount, 2);
  assert.strictEqual(row.cells[0].overload, true);
  assert.strictEqual(row.cells[0].overtime, 4);
  assert.strictEqual(model.summary.overloadedAssignees, 1);
  assert.strictEqual(model.summary.overloadedDates, 2);
  assert.deepStrictEqual(plain(model.conflicts.map(function(conflict) {
    return [conflict.assignee, conflict.date, conflict.overtime];
  })), [['张三', '2026-01-05', 4], ['张三', '2026-01-06', 4]]);
});

test('buildResourceModel: 周粒度的日期键和容量为每日容量乘 7', function() {
  var model = Workbench.buildResourceModel([
    task('t1', '张三', '2026-01-05', '2026-01-09')
  ], { granularity: 'week', capacity: 6 });

  assert.strictEqual(model.granularity, 'week');
  assert.deepStrictEqual(plain(model.dates), ['2026-01-05']);
  assert.strictEqual(model.rows[0].capacityLimit, 42);
  assert.strictEqual(model.rows[0].cells[0].hours, 40);
  assert.strictEqual(model.rows[0].cells[0].overload, false);
});

test('buildResourceModel: 空任务和无负责人返回空模型', function() {
  var empty = Workbench.buildResourceModel([], { granularity: 'day', capacity: 8 });
  assert.deepStrictEqual(plain(empty.dates), []);
  assert.deepStrictEqual(plain(empty.rows), []);
  assert.deepStrictEqual(plain(empty.conflicts), []);
  assert.strictEqual(empty.summary.totalHours, 0);

  var unassigned = Workbench.buildResourceModel([
    task('t1', '   ', '2026-01-05', '2026-01-06')
  ], { granularity: 'day', capacity: 8 });
  assert.deepStrictEqual(plain(unassigned.rows), []);
});

test('getResourceOptions: 从设置读取容量和粒度', function() {
  reset();
  TaskManager.setSetting('resourceCapacity', 6);
  TaskManager.setSetting('resourceGranularity', 'week');

  var options = Workbench.getResourceOptions();
  assert.strictEqual(options.capacity, 6);
  assert.strictEqual(options.granularity, 'week');

  var model = Workbench.buildResourceModel([
    task('t1', '张三', '2026-01-05', '2026-01-05', 10)
  ]);
  assert.strictEqual(model.capacity, 6);
  assert.strictEqual(model.granularity, 'week');
  assert.strictEqual(model.rows[0].capacityLimit, 42);
  assert.strictEqual(model.rows[0].cells[0].overload, false);
});

test('getResourceOptions: 非法设置回退默认值', function() {
  reset();
  TaskManager.setSetting('resourceCapacity', -5);
  TaskManager.setSetting('resourceGranularity', 'quarter');

  var options = Workbench.getResourceOptions();
  assert.strictEqual(options.capacity, 8);
  assert.strictEqual(options.granularity, 'day');
});

test('buildResourceModel 不修改传入任务和配置', function() {
  var tasks = [
    task('t1', '张三', '2026-01-05', '2026-01-06', 20),
    task('t2', '李四', '2026-01-05', '2026-01-05')
  ];
  var options = { granularity: 'day', capacity: 4, capacityByAssignee: { '张三': 2 } };
  var tasksBefore = JSON.stringify(tasks);
  var optionsBefore = JSON.stringify(options);

  Workbench.buildResourceModel(tasks, options);
  assert.strictEqual(JSON.stringify(tasks), tasksBefore);
  assert.strictEqual(JSON.stringify(options), optionsBefore);
});

// ------------------------------------------------------------
// 渲染
// ------------------------------------------------------------

test('renderResourceModel: 空数据提示', function() {
  var html = Workbench.renderResourceModel(Workbench.buildResourceModel([]));
  assert.ok(html.indexOf('暂无资源数据') !== -1);
  assert.ok(html.indexOf('resource-summary') !== -1);
});

test('renderResourceModel: 超载高亮和冲突列表', function() {
  var model = Workbench.buildResourceModel([
    task('t1', '张三', '2026-01-05', '2026-01-05', 10)
  ], { granularity: 'day', capacity: 8 });
  var html = Workbench.renderResourceModel(model);

  assert.ok(html.indexOf('resource-cell is-overload') !== -1);
  assert.ok(html.indexOf('resource-conflict-list') !== -1);
  assert.ok(html.indexOf('超 2 h') !== -1);
  assert.ok(html.indexOf('resource-stat is-overload') !== -1);
});

test('renderResourceModel: 转义负责人名称', function() {
  var model = Workbench.buildResourceModel([
    task('t1', '<b>张三</b>', '2026-01-05', '2026-01-05', 4)
  ], { granularity: 'day', capacity: 8 });
  var html = Workbench.renderResourceModel(model);

  assert.ok(html.indexOf('&lt;b&gt;张三&lt;/b&gt;') !== -1);
  assert.strictEqual(html.indexOf('<b>张三</b>'), -1);
});

test('renderResourceModel: 无冲突时显示空状态', function() {
  var model = Workbench.buildResourceModel([
    task('t1', '张三', '2026-01-05', '2026-01-05', 4)
  ], { granularity: 'day', capacity: 8 });
  var html = Workbench.renderResourceModel(model);
  assert.ok(html.indexOf('无超载冲突') !== -1);
  assert.strictEqual(html.indexOf('resource-conflict-list'), -1);
});

// ------------------------------------------------------------
// 设置写入与状态隔离
// ------------------------------------------------------------

test('App.setResourceCapacity: 写入 settings.resourceCapacity 并拒绝非法值', function() {
  reset();
  assert.strictEqual(App.setResourceCapacity(6), 6);
  assert.strictEqual(TaskManager.getSetting('resourceCapacity'), 6);
  assert.strictEqual(App.setResourceCapacity('7.5'), 7.5);
  assert.strictEqual(TaskManager.getSetting('resourceCapacity'), 7.5);

  assert.strictEqual(App.setResourceCapacity(-1), null);
  assert.strictEqual(App.setResourceCapacity('bad'), null);
  assert.strictEqual(TaskManager.getSetting('resourceCapacity'), 7.5);
});

test('App.setResourceGranularity: 写入日月粒度', function() {
  reset();
  assert.strictEqual(App.setResourceGranularity('week'), 'week');
  assert.strictEqual(TaskManager.getSetting('resourceGranularity'), 'week');
  assert.strictEqual(App.setResourceGranularity('day'), 'day');
  assert.strictEqual(App.setResourceGranularity('year'), null);
  assert.strictEqual(TaskManager.getSetting('resourceGranularity'), 'day');
});

test('资源视图渲染不改变表格选中与筛选状态', function() {
  reset();
  ViewState.selectedTaskId = 'task-1';
  ViewState.statusFilter = { inProgress: true, thirdParty: false, done: true };
  var beforeFilter = JSON.stringify(ViewState.statusFilter);

  Workbench.buildResourceModel([
    task('t1', '张三', '2026-01-05', '2026-01-05')
  ]);
  Workbench.renderResourceModel(Workbench.buildResourceModel([]));

  assert.strictEqual(ViewState.selectedTaskId, 'task-1');
  assert.strictEqual(JSON.stringify(ViewState.statusFilter), beforeFilter);

  // 无 document 时渲染直接跳过，也不应触碰视图状态
  assert.strictEqual(Workbench.renderResourceView(), false);
  assert.strictEqual(ViewState.selectedTaskId, 'task-1');
  assert.strictEqual(JSON.stringify(ViewState.statusFilter), beforeFilter);
});

var failures = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + t.name);
    console.log('  ' + (err && err.message ? err.message : err));
  }
});

console.log('\nresources-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
