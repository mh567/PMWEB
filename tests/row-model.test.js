'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'store.js', 'task-manager.js', 'row-model.js']);
var RowModel = app.get('RowModel');

function task(id, parentId, order, status, startDate, endDate) {
  return {
    id: id,
    parentId: parentId,
    name: id,
    description: '',
    assignee: '',
    color: null,
    startDate: startDate || null,
    endDate: endDate || null,
    status: status || 'inProgress',
    progress: 50,
    plannedEndDate: endDate || null,
    order: order,
    ganttRow: null
  };
}

function baseData() {
  return {
    pmweb_version: 3,
    links: [],
    views: [],
    settings: {},
    milestones: [],
    tasks: [
      task('A', null, 0, 'inProgress', '2026-01-01', '2026-01-31'),
      task('A1', 'A', 0, 'inProgress', '2026-01-01', '2026-01-10'),
      task('A1a', 'A1', 0, 'done', '2026-01-01', '2026-01-05'),
      task('A1b', 'A1', 1, 'inProgress', '2026-01-06', '2026-01-10'),
      task('A2', 'A', 1, 'thirdParty', '2026-01-11', '2026-01-31'),
      task('B', null, 1, 'inProgress', '2026-02-01', '2026-02-28'),
      task('B1', 'B', 0, 'inProgress', '2026-02-01', '2026-02-20')
    ]
  };
}

var allVisible = { inProgress: true, thirdParty: true, done: true };
function plain(value) { return JSON.parse(JSON.stringify(value)); }

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('三层任务按 DFS 前序展平，父行在子行之前', function() {
  helper.installTasks(app, baseData());
  var result = RowModel.build({ collapsed: new Set(), statusFilter: allVisible });
  assert.deepStrictEqual(plain(result.rows.map(function(r) { return r.id; })),
    ['A', 'A1', 'A1a', 'A1b', 'A2', 'B', 'B1']);
  assert.deepStrictEqual(plain(result.rows.map(function(r) { return r.depth; })),
    [0, 1, 2, 2, 1, 0, 1]);
});

test('行字段完整，摘要行与叶子行标记正确', function() {
  helper.installTasks(app, baseData());
  var result = RowModel.build({ collapsed: new Set(), statusFilter: allVisible });
  var a = result.byId.get('A');
  assert.strictEqual(a.isSummary, true);
  assert.strictEqual(a.hasChildren, true);
  assert.strictEqual(a.childCount, 2);
  assert.strictEqual(a.isCollapsed, false);
  assert.strictEqual(a.startDate, '2026-01-01');
  assert.strictEqual(a.endDate, '2026-01-31');

  var leaf = result.byId.get('A1a');
  assert.strictEqual(leaf.isSummary, false);
  assert.strictEqual(leaf.hasChildren, false);
  assert.strictEqual(leaf.childCount, 0);
  assert.strictEqual(leaf.startDate, '2026-01-01');
  assert.strictEqual(leaf.endDate, '2026-01-05');
});

test('父任务日期由子树派生', function() {
  helper.installTasks(app, baseData());
  var result = RowModel.build({ collapsed: new Set(), statusFilter: allVisible });
  var a1 = result.byId.get('A1');
  assert.strictEqual(a1.startDate, '2026-01-01');
  assert.strictEqual(a1.endDate, '2026-01-10');
});

test('折叠父任务保留父行并隐藏子行', function() {
  helper.installTasks(app, baseData());
  var result = RowModel.build({ collapsed: new Set(['A']), statusFilter: allVisible });
  assert.deepStrictEqual(plain(result.rows.map(function(r) { return r.id; })), ['A', 'B', 'B1']);
  assert.strictEqual(result.byId.get('A').isCollapsed, true);
  assert.strictEqual(result.byId.has('A1'), false);
});

test('折叠叶子任务无影响', function() {
  helper.installTasks(app, baseData());
  var result = RowModel.build({ collapsed: new Set(['A1a']), statusFilter: allVisible });
  assert.strictEqual(result.rows.length, 7);
  assert.strictEqual(result.byId.get('A1a').isCollapsed, false);
});

test('状态筛选只作用于叶子，父任务仅在存在可见后代时出现', function() {
  helper.installTasks(app, baseData());
  var result = RowModel.build({
    collapsed: new Set(),
    statusFilter: { inProgress: false, thirdParty: false, done: true }
  });
  assert.deepStrictEqual(plain(result.rows.map(function(r) { return r.id; })), ['A', 'A1', 'A1a']);
});

test('筛选后 byId 只包含可见行', function() {
  helper.installTasks(app, baseData());
  var result = RowModel.build({
    collapsed: new Set(),
    statusFilter: { inProgress: false, thirdParty: false, done: true }
  });
  assert.deepStrictEqual(Array.from(result.byId.keys()).sort(), ['A', 'A1', 'A1a']);
});

test('空数据返回空行数组和空索引', function() {
  helper.installTasks(app, {
    pmweb_version: 3, tasks: [], milestones: [], links: [], views: [], settings: {}
  });
  var result = RowModel.build({ collapsed: new Set(), statusFilter: allVisible });
  assert.strictEqual(result.rows.length, 0);
  assert.strictEqual(result.byId.size, 0);
});

test('默认参数不抛错', function() {
  helper.installTasks(app, baseData());
  var result = RowModel.build();
  assert.strictEqual(result.rows.length, 7);
});

test('只读投影，不修改任务数据', function() {
  var data = baseData();
  helper.installTasks(app, data);
  var before = JSON.stringify(data);
  RowModel.build({ collapsed: new Set(['A']), statusFilter: { inProgress: true } });
  assert.strictEqual(JSON.stringify(data), before);
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

console.log('\nrow-model: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
