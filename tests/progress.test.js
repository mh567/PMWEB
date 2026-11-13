'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'store.js', 'task-manager.js', 'row-model.js', 'progress.js']);
var Progress = app.get('Progress');
var RowModel = app.get('RowModel');
var TaskManager = app.get('TaskManager');

function task(id, parentId, order, status, startDate, endDate, progress) {
  return {
    id: id,
    parentId: parentId,
    name: id,
    description: '',
    assignee: '',
    color: null,
    startDate: startDate === undefined ? null : startDate,
    endDate: endDate === undefined ? null : endDate,
    status: status || 'inProgress',
    progress: progress === undefined ? 50 : progress,
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
      task('A', null, 0, 'inProgress', '2026-01-01', '2026-01-31', 50),
      task('A1', 'A', 0, 'inProgress', '2026-01-01', '2026-01-10', 50),
      task('A1a', 'A1', 0, 'done', '2026-01-01', '2026-01-05', 40),
      task('A1b', 'A1', 1, 'inProgress', '2026-01-06', '2026-01-10', 50),
      task('A2', 'A', 1, 'thirdParty', '2026-01-11', '2026-01-31', 50),
      task('B', null, 1, 'inProgress', '2026-02-01', '2026-02-28', 50),
      task('B1', 'B', 0, 'inProgress', '2026-02-01', '2026-02-20', 50)
    ]
  };
}

var allVisible = { inProgress: true, thirdParty: true, done: true };

function getChildren(id) {
  return TaskManager.getChildren(id);
}

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, message + ': expected ' + expected + ', got ' + actual);
}

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('clamp 收敛到 0 到 100', function() {
  assert.strictEqual(Progress.clamp(0), 0);
  assert.strictEqual(Progress.clamp(100), 100);
  assert.strictEqual(Progress.clamp(-1), 0);
  assert.strictEqual(Progress.clamp(-999), 0);
  assert.strictEqual(Progress.clamp(101), 100);
  assert.strictEqual(Progress.clamp(42.5), 42.5);
});

test('clamp 对非数字返回 0', function() {
  assert.strictEqual(Progress.clamp(NaN), 0);
  assert.strictEqual(Progress.clamp('50'), 0);
  assert.strictEqual(Progress.clamp(null), 0);
  assert.strictEqual(Progress.clamp(undefined), 0);
  assert.strictEqual(Progress.clamp({}), 0);
  assert.strictEqual(Progress.clamp([]), 0);
});

test('leafProgress: done 视为 100，忽略 progress', function() {
  assert.strictEqual(Progress.leafProgress({ status: 'done', progress: 40 }), 100);
  assert.strictEqual(Progress.leafProgress({ status: 'done', progress: 0 }), 100);
});

test('leafProgress: thirdParty 最低 30', function() {
  assert.strictEqual(Progress.leafProgress({ status: 'thirdParty', progress: 10 }), 30);
  assert.strictEqual(Progress.leafProgress({ status: 'thirdParty', progress: 80 }), 80);
  assert.strictEqual(Progress.leafProgress({ status: 'thirdParty' }), 30);
});

test('leafProgress: inProgress 使用 task.progress', function() {
  assert.strictEqual(Progress.leafProgress({ status: 'inProgress', progress: 65 }), 65);
  assert.strictEqual(Progress.leafProgress({ status: 'inProgress', progress: 120 }), 100);
  assert.strictEqual(Progress.leafProgress({ status: 'inProgress' }), 0);
});

test('durationWeight: 单日至少 1 天', function() {
  assert.strictEqual(Progress.durationWeight(task('x', null, 0, 'inProgress', '2026-01-01', '2026-01-01')), 1);
  assert.strictEqual(Progress.durationWeight(task('x', null, 0, 'inProgress', '2026-01-01', '2026-01-31')), 31);
});

test('durationWeight: 跨月与跨年', function() {
  assert.strictEqual(Progress.durationWeight(task('x', null, 0, 'inProgress', '2026-01-30', '2026-02-02')), 4);
  assert.strictEqual(Progress.durationWeight(task('x', null, 0, 'inProgress', '2025-12-30', '2026-01-02')), 4);
});

test('durationWeight: 缺失或非法日期回退为 1', function() {
  assert.strictEqual(Progress.durationWeight(task('x', null, 0, 'inProgress', null, null)), 1);
  assert.strictEqual(Progress.durationWeight(task('x', null, 0, 'inProgress', '2026-01-10', '2026-01-01')), 1);
  assert.strictEqual(Progress.durationWeight(task('x', null, 0, 'inProgress', 'bad', '2026-01-01')), 1);
  assert.strictEqual(Progress.durationWeight(null), 1);
});

test('rollupProgress: 无子任务返回叶子进度', function() {
  var leaf = task('L', null, 0, 'thirdParty', '2026-01-01', '2026-01-05', 10);
  assert.strictEqual(Progress.rollupProgress(leaf, []), 30);
  assert.strictEqual(Progress.rollupProgress(leaf), 30);
});

test('rollupProgress: 按子任务工期加权', function() {
  helper.installTasks(app, baseData());
  var a = TaskManager.getTask('A');
  closeTo(Progress.rollupProgress(a, TaskManager.getChildren('A'), getChildren), 1800 / 31,
    'A 层加权（A1 75 占 10 天，A2 50 占 21 天）');
});

test('rollupProgress: 多层嵌套逐层汇总', function() {
  helper.installTasks(app, {
    pmweb_version: 3,
    links: [],
    views: [],
    settings: {},
    milestones: [],
    tasks: [
      task('P', null, 0, 'inProgress', '2026-03-01', '2026-03-30', 0),
      task('C1', 'P', 0, 'inProgress', '2026-03-01', '2026-03-20', 0),
      task('C1a', 'C1', 0, 'done', '2026-03-01', '2026-03-10', 100),
      task('C1b', 'C1', 1, 'thirdParty', '2026-03-11', '2026-03-20', 10),
      task('C2', 'P', 1, 'inProgress', '2026-03-21', '2026-03-30', 50)
    ]
  });
  var p = TaskManager.getTask('P');
  closeTo(Progress.rollupProgress(p, TaskManager.getChildren('P'), getChildren), 60,
    'P = (C1 65 占 20 天 + C2 50 占 10 天) / 30');
});

test('rollupProgress: 子任务无日期时按等权', function() {
  var parent = task('P', null, 0, 'inProgress', null, null, 0);
  var children = [
    task('U1', 'P', 0, 'done', null, null, 100),
    task('U2', 'P', 1, 'inProgress', null, null, 0)
  ];
  closeTo(Progress.rollupProgress(parent, children), 50, '无日期等权');
});

test('rollupProgress: 混合有无日期时整体等权', function() {
  var parent = task('P', null, 0, 'inProgress', null, null, 0);
  var children = [
    task('D1', 'P', 0, 'inProgress', '2026-01-01', '2026-01-10', 0),
    task('U1', 'P', 1, 'done', null, null, 100)
  ];
  closeTo(Progress.rollupProgress(parent, children), 50, '混合等权');
});

test('rollupProgress: 不修改传入任务对象', function() {
  helper.installTasks(app, baseData());
  var a = TaskManager.getTask('A');
  var children = TaskManager.getChildren('A');
  var before = JSON.stringify({ a: a, children: children });
  Progress.rollupProgress(a, children, getChildren);
  assert.strictEqual(JSON.stringify({ a: a, children: children }), before);
});

test('computeRowProgress: 与 RowModel 行结构一致', function() {
  helper.installTasks(app, baseData());
  var rows = RowModel.build({ collapsed: new Set(), statusFilter: allVisible }).rows;
  var map = Progress.computeRowProgress(rows, getChildren);

  assert.strictEqual(map.size, rows.length);
  assert.strictEqual(map.get('A1a'), 100);
  assert.strictEqual(map.get('A1b'), 50);
  closeTo(map.get('A1'), 75, 'A1');
  assert.strictEqual(map.get('A2'), 50);
  closeTo(map.get('A'), 1800 / 31, 'A');
  assert.strictEqual(map.get('B'), 50);
  assert.strictEqual(map.get('B1'), 50);
});

test('computeRowProgress: 折叠父行仍按完整子树汇总', function() {
  helper.installTasks(app, baseData());
  var rows = RowModel.build({ collapsed: new Set(['A']), statusFilter: allVisible }).rows;
  var map = Progress.computeRowProgress(rows, getChildren);
  assert.strictEqual(rows.length, 3);
  closeTo(map.get('A'), 1800 / 31, '折叠后 A 仍为子树汇总');
});

test('computeRowProgress: 空行数组返回空 Map', function() {
  var map = Progress.computeRowProgress([], getChildren);
  assert.strictEqual(map.size, 0);
  assert.strictEqual(Progress.computeRowProgress(null, getChildren).size, 0);
});

test('statusFromProgress: 0 为 inProgress，100 为 done', function() {
  assert.strictEqual(Progress.statusFromProgress(0), 'inProgress');
  assert.strictEqual(Progress.statusFromProgress(-3), 'inProgress');
  assert.strictEqual(Progress.statusFromProgress(100), 'done');
  assert.strictEqual(Progress.statusFromProgress(130), 'done');
});

test('statusFromProgress: 中间区间规则明确', function() {
  assert.strictEqual(Progress.statusFromProgress(37), 'inProgress');
  assert.strictEqual(Progress.statusFromProgress(37, 'inProgress'), 'inProgress');
  assert.strictEqual(Progress.statusFromProgress(37, 'thirdParty'), 'thirdParty');
  assert.strictEqual(Progress.statusFromProgress(37, 'done'), 'inProgress');
  assert.strictEqual(Progress.statusFromProgress(NaN, 'thirdParty'), 'inProgress');
});

test('rollupStatus 状态汇总完全由子树派生，不被父任务原始状态抢先决定', function() {
  var p1 = { id: 'p1', status: 'thirdParty' };
  var c1 = [{ id: 'c1', status: 'inProgress' }, { id: 'c2', status: 'inProgress' }];
  assert.strictEqual(Progress.rollupStatus(p1, c1, function() { return []; }), 'inProgress', '父 raw thirdParty 但子全 inProgress 时应汇总为 inProgress');

  var p2 = { id: 'p2', status: 'todo' };
  var c2 = [{ id: 'c3', status: 'done' }, { id: 'c4', status: 'done' }];
  assert.strictEqual(Progress.rollupStatus(p2, c2, function() { return []; }), 'done', '父 raw todo 但子全 done 时应汇总为 done');

  var p3 = { id: 'p3', status: 'done' };
  var c3 = [{ id: 'c5', status: 'todo' }, { id: 'c6', status: 'todo' }];
  assert.strictEqual(Progress.rollupStatus(p3, c3, function() { return []; }), 'todo', '父 raw done 但子全 todo 时应汇总为 todo');

  var root = { id: 'root', status: 'thirdParty' };
  var mid = { id: 'mid', status: 'thirdParty' };
  var leaves = [{ id: 'l1', status: 'inProgress' }, { id: 'l2', status: 'inProgress' }];
  var treeMap = {
    root: [mid],
    mid: leaves,
    l1: [],
    l2: []
  };
  assert.strictEqual(Progress.rollupStatus(root, [mid], function(id) { return treeMap[id] || []; }), 'inProgress', '多层嵌套时子树全 inProgress 应汇总为 inProgress');
});

test('纯函数不修改输入数据', function() {
  var data = baseData();
  helper.installTasks(app, data);
  var rows = RowModel.build({ collapsed: new Set(), statusFilter: allVisible }).rows;
  var snapshot = JSON.stringify(data);
  var rowSnapshot = JSON.stringify(rows);

  Progress.clamp(data.tasks[0].progress);
  Progress.leafProgress(data.tasks[0]);
  Progress.durationWeight(data.tasks[0]);
  Progress.rollupProgress(data.tasks[0], TaskManager.getChildren('A'), getChildren);
  Progress.computeRowProgress(rows, getChildren);
  Progress.statusFromProgress(50, 'thirdParty');

  assert.strictEqual(JSON.stringify(data), snapshot);
  assert.strictEqual(JSON.stringify(rows), rowSnapshot);
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

console.log('\nprogress: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
