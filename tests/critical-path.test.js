'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['links.js', 'work-calendar.js', 'critical-path.js']);
var CriticalPath = app.get('CriticalPath');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function task(id, startDate, endDate) {
  return { id: id, startDate: startDate === undefined ? null : startDate, endDate: endDate === undefined ? null : endDate };
}

function link(id, source, target, lag) {
  return { id: id, source: source, target: target, type: 'FS', lag: lag === undefined ? 0 : lag };
}

function nodeOf(result, id) {
  return result.nodes.filter(function(node) { return node.id === id; })[0];
}

function codes(result) {
  return result.errors.map(function(error) { return error.code; });
}

// ---------- 单链 ----------

test('单链 FS 全部任务浮点为 0', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06'),
    task('c', '2026-01-07', '2026-01-09')
  ];
  var links = [link('l1', 'a', 'b', 1), link('l2', 'b', 'c', 1)];

  var result = CriticalPath.compute(tasks, links);

  assert.deepStrictEqual(plain(result.criticalIds), ['a', 'b', 'c']);
  assert.strictEqual(result.totalDuration, 9);
  assert.deepStrictEqual(plain(result.errors), []);

  var a = nodeOf(result, 'a');
  assert.strictEqual(a.duration, 3);
  assert.strictEqual(a.earliestStart, '2026-01-01');
  assert.strictEqual(a.earliestFinish, '2026-01-03');
  assert.strictEqual(a.latestStart, '2026-01-01');
  assert.strictEqual(a.latestFinish, '2026-01-03');
  assert.strictEqual(a.totalFloat, 0);
  assert.strictEqual(a.critical, true);

  var c = nodeOf(result, 'c');
  assert.strictEqual(c.earliestStart, '2026-01-07');
  assert.strictEqual(c.earliestFinish, '2026-01-09');
  assert.strictEqual(c.totalFloat, 0);
});

test('依赖约束晚于计划开始时会推迟最早开始', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-05'),
    task('b', '2026-01-02', '2026-01-04')
  ];
  var links = [link('l1', 'a', 'b', 2)];

  var result = CriticalPath.compute(tasks, links);
  var b = nodeOf(result, 'b');
  assert.strictEqual(b.earliestStart, '2026-01-07');
  assert.strictEqual(b.earliestFinish, '2026-01-09');
});

// ---------- 并行分支 ----------

test('并行分支中较短的分支有浮动', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06'),
    task('c', '2026-01-04', '2026-01-04')
  ];
  var links = [link('l1', 'a', 'b', 1), link('l2', 'a', 'c', 1)];

  var result = CriticalPath.compute(tasks, links);

  assert.deepStrictEqual(plain(result.criticalIds), ['a', 'b']);
  assert.strictEqual(nodeOf(result, 'a').totalFloat, 0);
  assert.strictEqual(nodeOf(result, 'b').totalFloat, 0);
  assert.strictEqual(nodeOf(result, 'c').totalFloat, 2);
  assert.strictEqual(nodeOf(result, 'c').critical, false);
  assert.strictEqual(result.totalDuration, 6);
});

// ---------- 多根 ----------

test('多个根节点按各自计划开始，浮动正确', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-05'),
    task('b', '2026-01-03', '2026-01-07')
  ];

  var result = CriticalPath.compute(tasks, []);
  assert.deepStrictEqual(plain(result.criticalIds), ['b']);
  assert.strictEqual(nodeOf(result, 'a').totalFloat, 2);
  assert.strictEqual(nodeOf(result, 'b').totalFloat, 0);
  assert.strictEqual(result.totalDuration, 7);
});

test('零浮动节点被标记为 critical 并进入 criticalTaskIds', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ];
  var links = [link('l1', 'a', 'b', 1)];

  var result = CriticalPath.compute(tasks, links);
  assert.deepStrictEqual(
    plain(result.nodes.map(function(node) { return node.critical; })),
    [true, true]
  );
  assert.deepStrictEqual(plain(CriticalPath.criticalTaskIds(tasks, links)), ['a', 'b']);
});

// ---------- 工作日 ----------

test('工作日模式下工期按工作日计算', function() {
  var tasks = [task('a', '2026-01-01', '2026-01-05')];
  var calendar = { weekends: [0, 6] };

  var natural = CriticalPath.compute(tasks, []);
  assert.strictEqual(nodeOf(natural, 'a').duration, 5);
  assert.strictEqual(natural.totalDuration, 5);

  var working = CriticalPath.compute(tasks, [], calendar);
  assert.strictEqual(nodeOf(working, 'a').duration, 3);
  assert.strictEqual(working.totalDuration, 3);
});

test('工作日模式跨周末推进', function() {
  var tasks = [
    task('a', '2025-12-31', '2026-01-02'),
    task('b', '2026-01-05', '2026-01-07')
  ];
  var links = [link('l1', 'a', 'b', 1)];
  var calendar = { weekends: [0, 6] };

  var result = CriticalPath.compute(tasks, links, calendar);
  assert.strictEqual(nodeOf(result, 'a').duration, 3);
  assert.strictEqual(nodeOf(result, 'b').duration, 3);
  assert.strictEqual(nodeOf(result, 'a').earliestFinish, '2026-01-02');
  assert.strictEqual(nodeOf(result, 'b').earliestStart, '2026-01-05');
  assert.strictEqual(nodeOf(result, 'b').earliestFinish, '2026-01-07');
  assert.deepStrictEqual(plain(result.criticalIds), ['a', 'b']);
  assert.strictEqual(result.totalDuration, 6);
});

// ---------- 错误 ----------

test('环返回 CYCLE 且不产生关键任务', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-02'),
    task('b', '2026-01-03', '2026-01-04')
  ];
  var links = [link('l1', 'a', 'b', 0), link('l2', 'b', 'a', 0)];

  var result = CriticalPath.compute(tasks, links);
  assert.ok(codes(result).indexOf('CYCLE') !== -1);
  assert.deepStrictEqual(plain(result.criticalIds), []);
  assert.strictEqual(result.totalDuration, 0);
  assert.strictEqual(nodeOf(result, 'a').earliestStart, null);
});

test('缺失源任务返回 MISSING_SOURCE', function() {
  var tasks = [task('a', '2026-01-01', '2026-01-03')];
  var result = CriticalPath.compute(tasks, [link('l1', 'ghost', 'a', 0)]);
  assert.ok(codes(result).indexOf('MISSING_SOURCE') !== -1);
});

test('缺失目标任务返回 MISSING_TARGET', function() {
  var tasks = [task('a', '2026-01-01', '2026-01-03')];
  var result = CriticalPath.compute(tasks, [link('l1', 'a', 'ghost', 0)]);
  assert.ok(codes(result).indexOf('MISSING_TARGET') !== -1);
});

test('缺少日期的任务记录 MISSING_DATE', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', null, null)
  ];
  var result = CriticalPath.compute(tasks, []);
  assert.ok(codes(result).indexOf('MISSING_DATE') !== -1);
  assert.strictEqual(nodeOf(result, 'b').earliestStart, null);
  assert.deepStrictEqual(plain(result.criticalIds), ['a']);
});

test('非 FS 依赖不参与关键路径', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-12'),
    task('b', '2026-01-01', '2026-01-03')
  ];
  var links = [{ id: 'l1', source: 'a', target: 'b', type: 'SS', lag: 0 }];

  var result = CriticalPath.compute(tasks, links);
  assert.strictEqual(nodeOf(result, 'b').earliestStart, '2026-01-01');
  assert.deepStrictEqual(plain(result.errors), []);
});

// ---------- 纯函数 ----------

test('compute 不修改入参并返回新节点', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ];
  var links = [link('l1', 'a', 'b', 1)];
  var config = { weekends: [0, 6] };

  var tasksBefore = JSON.stringify(tasks);
  var linksBefore = JSON.stringify(links);
  var configBefore = JSON.stringify(config);

  var result = CriticalPath.compute(tasks, links, config);

  assert.strictEqual(JSON.stringify(tasks), tasksBefore);
  assert.strictEqual(JSON.stringify(links), linksBefore);
  assert.strictEqual(JSON.stringify(config), configBefore);
  assert.notStrictEqual(result.nodes[0], tasks[0]);

  result.nodes[0].earliestStart = '1999-01-01';
  assert.strictEqual(tasks[0].startDate, '2026-01-01');
});

test('空输入不抛错', function() {
  assert.deepStrictEqual(plain(CriticalPath.compute([], [])), {
    nodes: [], criticalIds: [], totalDuration: 0, errors: []
  });
  assert.deepStrictEqual(plain(CriticalPath.criticalTaskIds([], [])), []);
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

console.log('\ncritical-path: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
