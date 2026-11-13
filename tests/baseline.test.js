'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['baseline.js']);
var Baseline = app.get('Baseline');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function entryTask(id, startDate, endDate, progress, name) {
  return {
    id: id,
    name: name === undefined ? id : name,
    startDate: startDate === undefined ? null : startDate,
    endDate: endDate === undefined ? null : endDate,
    progress: progress === undefined ? 0 : progress
  };
}

function snapshot(tasks, capturedAt) {
  return {
    version: 1,
    capturedAt: capturedAt || '2026-01-01T00:00:00.000Z',
    tasks: tasks
  };
}

function codes(result) {
  return result.errors.map(function(error) { return error.code; });
}

// ---------- createSnapshot ----------

test('createSnapshot 保存 id、name、日期和进度，并按 id 升序', function() {
  var result = Baseline.createSnapshot([
    entryTask('c', '2026-03-01', '2026-03-10', 30, '丙'),
    entryTask('a', '2026-01-01', '2026-01-10', 10, '甲'),
    entryTask('b', '2026-02-01', null, 20, '乙')
  ], '2026-06-01T08:00:00.000Z');

  assert.strictEqual(result.version, Baseline.VERSION);
  assert.strictEqual(result.capturedAt, '2026-06-01T08:00:00.000Z');
  assert.deepStrictEqual(plain(result.tasks), [
    { id: 'a', name: '甲', startDate: '2026-01-01', endDate: '2026-01-10', progress: 10 },
    { id: 'b', name: '乙', startDate: '2026-02-01', endDate: null, progress: 20 },
    { id: 'c', name: '丙', startDate: '2026-03-01', endDate: '2026-03-10', progress: 30 }
  ]);
});

test('createSnapshot 不修改输入数组和任务对象', function() {
  var tasks = [
    entryTask('b', '2026-02-01', '2026-02-10', 20),
    entryTask('a', '2026-01-01', '2026-01-10', 10)
  ];
  var before = JSON.stringify(tasks);
  Baseline.createSnapshot(tasks, '2026-06-01T00:00:00.000Z');
  assert.strictEqual(JSON.stringify(tasks), before);
});

test('createSnapshot 忽略非法任务，归一化空日期与越界进度，重复 id 保留首个', function() {
  var result = Baseline.createSnapshot([
    null,
    {},
    { id: '', name: '空 id' },
    { id: 'a', startDate: 'not-a-date', endDate: '2026-01-05', progress: 150 },
    { id: 'a', name: '第二份', startDate: '2026-01-01', endDate: '2026-01-02', progress: 0 }
  ], '2026-06-01T00:00:00.000Z');

  assert.deepStrictEqual(plain(result.tasks), [
    { id: 'a', name: '', startDate: null, endDate: '2026-01-05', progress: 100 }
  ]);
  assert.strictEqual(Baseline.validateSnapshot(result).valid, true);
});

test('createSnapshot 省略 capturedAt 时生成可解析的时间', function() {
  var result = Baseline.createSnapshot([entryTask('a')]);
  assert.strictEqual(typeof result.capturedAt, 'string');
  assert.ok(!isNaN(Date.parse(result.capturedAt)));
  assert.strictEqual(Baseline.validateSnapshot(result).valid, true);
});

// ---------- validateSnapshot ----------

test('合法快照通过校验', function() {
  var result = Baseline.validateSnapshot(snapshot([
    entryTask('a', '2026-01-01', '2026-01-10', 40, '甲'),
    entryTask('b', null, null, 0, '乙')
  ]));
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(plain(result.errors), []);
});

test('非对象快照失败', function() {
  assert.strictEqual(Baseline.validateSnapshot(null).valid, false);
  assert.strictEqual(Baseline.validateSnapshot([]).valid, false);
  assert.strictEqual(codes(Baseline.validateSnapshot('x')).indexOf('INVALID_SNAPSHOT') !== -1, true);
});

test('版本不匹配失败', function() {
  var result = Baseline.validateSnapshot({
    version: 2,
    capturedAt: '2026-01-01T00:00:00.000Z',
    tasks: []
  });
  assert.strictEqual(result.valid, false);
  assert.ok(codes(result).indexOf('INVALID_VERSION') !== -1);
});

test('capturedAt 缺失或不可解析失败', function() {
  var missing = Baseline.validateSnapshot({ version: 1, tasks: [] });
  assert.strictEqual(missing.valid, false);
  assert.ok(codes(missing).indexOf('INVALID_CAPTURED_AT') !== -1);

  var invalid = Baseline.validateSnapshot({
    version: 1,
    capturedAt: 'not-a-time',
    tasks: []
  });
  assert.strictEqual(invalid.valid, false);
  assert.ok(codes(invalid).indexOf('INVALID_CAPTURED_AT') !== -1);
});

test('tasks 不是数组时失败', function() {
  var result = Baseline.validateSnapshot({
    version: 1,
    capturedAt: '2026-01-01T00:00:00.000Z',
    tasks: {}
  });
  assert.strictEqual(result.valid, false);
  assert.ok(codes(result).indexOf('INVALID_TASKS') !== -1);
});

test('非法任务条目、id 和 name 失败', function() {
  var result = Baseline.validateSnapshot(snapshot([
    null,
    { id: '', name: '空 id', startDate: null, endDate: null, progress: 0 },
    { id: 7, name: '数字 id', startDate: null, endDate: null, progress: 0 },
    { id: 'a', name: 5, startDate: null, endDate: null, progress: 0 }
  ]));
  assert.strictEqual(result.valid, false);
  var list = codes(result);
  assert.ok(list.indexOf('INVALID_TASK') !== -1);
  assert.ok(list.indexOf('INVALID_ID') !== -1);
  assert.ok(list.indexOf('INVALID_NAME') !== -1);
});

test('重复任务 id 失败', function() {
  var result = Baseline.validateSnapshot(snapshot([
    entryTask('a'),
    entryTask('a')
  ]));
  assert.strictEqual(result.valid, false);
  assert.ok(codes(result).indexOf('DUPLICATE_ID') !== -1);
});

test('非法日期和非法进度失败', function() {
  var result = Baseline.validateSnapshot(snapshot([
    { id: 'a', name: 'a', startDate: '2026-13-01', endDate: '2026-02-30', progress: -1 },
    { id: 'b', name: 'b', startDate: undefined, endDate: null, progress: 101 },
    { id: 'c', name: 'c', startDate: null, endDate: null, progress: '50' }
  ]));
  assert.strictEqual(result.valid, false);
  var list = codes(result);
  assert.strictEqual(list.filter(function(code) { return code === 'INVALID_DATE'; }).length, 3);
  assert.strictEqual(list.filter(function(code) { return code === 'INVALID_PROGRESS'; }).length, 3);
});

test('提供白名单时校验 id 是否在允许范围内', function() {
  var data = snapshot([entryTask('a'), entryTask('b')]);
  assert.strictEqual(Baseline.validateSnapshot(data, ['a', 'b']).valid, true);
  assert.strictEqual(Baseline.validateSnapshot(data, new Set(['a', 'b'])).valid, true);
  assert.strictEqual(Baseline.validateSnapshot(data, [{ id: 'a' }, { id: 'b' }]).valid, true);

  var result = Baseline.validateSnapshot(data, ['a']);
  assert.strictEqual(result.valid, false);
  assert.ok(codes(result).indexOf('NOT_IN_WHITELIST') !== -1);
});

// ---------- diff ----------

test('无变化的任务方差为 0，changed 为 false', function() {
  var base = snapshot([entryTask('a', '2026-01-01', '2026-01-10', 40, '甲')]);
  var result = Baseline.diff(base, [entryTask('a', '2026-01-01', '2026-01-10', 40, '甲')]);

  var entry = result.tasks[0];
  assert.deepStrictEqual(plain(result.added), []);
  assert.deepStrictEqual(plain(result.removed), []);
  assert.strictEqual(entry.startVarianceDays, 0);
  assert.strictEqual(entry.endVarianceDays, 0);
  assert.strictEqual(entry.progressVariance, 0);
  assert.strictEqual(entry.changed, false);
  assert.strictEqual(entry.added, false);
  assert.strictEqual(entry.removed, false);
});

test('日期延后产生正方差并标记 changed', function() {
  var base = snapshot([entryTask('a', '2026-01-01', '2026-01-10', 40)]);
  var result = Baseline.diff(base, [entryTask('a', '2026-01-03', '2026-01-15', 40)]);

  var entry = result.tasks[0];
  assert.strictEqual(entry.startVarianceDays, 2);
  assert.strictEqual(entry.endVarianceDays, 5);
  assert.strictEqual(entry.changed, true);
});

test('日期提前产生负方差并支持跨年', function() {
  var base = snapshot([entryTask('a', '2026-01-04', '2026-01-10', 40)]);
  var result = Baseline.diff(base, [entryTask('a', '2026-01-01', '2026-01-07', 40)]);

  var entry = result.tasks[0];
  assert.strictEqual(entry.startVarianceDays, -3);
  assert.strictEqual(entry.endVarianceDays, -3);
  assert.strictEqual(entry.changed, true);

  var crossYear = Baseline.diff(
    snapshot([entryTask('b', '2025-12-31', '2026-01-05', 0)]),
    [entryTask('b', '2026-01-02', '2026-01-09', 0)]
  );
  assert.strictEqual(crossYear.tasks[0].startVarianceDays, 2);
  assert.strictEqual(crossYear.tasks[0].endVarianceDays, 4);
});

test('进度变化只影响 progressVariance', function() {
  var base = snapshot([entryTask('a', '2026-01-01', '2026-01-10', 40)]);
  var result = Baseline.diff(base, [entryTask('a', '2026-01-01', '2026-01-10', 65)]);

  var entry = result.tasks[0];
  assert.strictEqual(entry.progressVariance, 25);
  assert.strictEqual(entry.startVarianceDays, 0);
  assert.strictEqual(entry.endVarianceDays, 0);
  assert.strictEqual(entry.changed, true);
});

test('名称变化标记 changed', function() {
  var base = snapshot([entryTask('a', '2026-01-01', '2026-01-10', 40, '旧名')]);
  var result = Baseline.diff(base, [entryTask('a', '2026-01-01', '2026-01-10', 40, '新名')]);
  assert.strictEqual(result.tasks[0].changed, true);
  assert.strictEqual(result.tasks[0].name, '新名');
});

test('新增任务标记 added，基线字段与方差为 null', function() {
  var base = snapshot([entryTask('a', '2026-01-01', '2026-01-10', 40)]);
  var result = Baseline.diff(base, [
    entryTask('a', '2026-01-01', '2026-01-10', 40),
    entryTask('b', '2026-02-01', '2026-02-10', 10)
  ]);

  var added = result.tasks.filter(function(entry) { return entry.id === 'b'; })[0];
  assert.strictEqual(added.added, true);
  assert.strictEqual(added.removed, false);
  assert.strictEqual(added.changed, false);
  assert.strictEqual(added.baselineStartDate, null);
  assert.strictEqual(added.baselineEndDate, null);
  assert.strictEqual(added.baselineProgress, null);
  assert.strictEqual(added.currentStartDate, '2026-02-01');
  assert.strictEqual(added.currentProgress, 10);
  assert.strictEqual(added.startVarianceDays, null);
  assert.strictEqual(added.endVarianceDays, null);
  assert.strictEqual(added.progressVariance, null);
  assert.deepStrictEqual(plain(result.added), ['b']);
});

test('删除任务标记 removed，当前字段与方差为 null', function() {
  var base = snapshot([
    entryTask('a', '2026-01-01', '2026-01-10', 40),
    entryTask('b', '2026-02-01', '2026-02-10', 10)
  ]);
  var result = Baseline.diff(base, [entryTask('a', '2026-01-01', '2026-01-10', 40)]);

  var removed = result.tasks.filter(function(entry) { return entry.id === 'b'; })[0];
  assert.strictEqual(removed.removed, true);
  assert.strictEqual(removed.added, false);
  assert.strictEqual(removed.changed, false);
  assert.strictEqual(removed.currentStartDate, null);
  assert.strictEqual(removed.currentEndDate, null);
  assert.strictEqual(removed.currentProgress, null);
  assert.strictEqual(removed.startVarianceDays, null);
  assert.strictEqual(removed.endVarianceDays, null);
  assert.strictEqual(removed.progressVariance, null);
  assert.deepStrictEqual(plain(result.removed), ['b']);
});

test('diff 结果按 id 升序，包含基线与当前任务的并集', function() {
  var base = snapshot([entryTask('c'), entryTask('a')]);
  var result = Baseline.diff(base, [entryTask('b'), entryTask('c')]);

  assert.deepStrictEqual(plain(result.tasks.map(function(entry) { return entry.id; })),
    ['a', 'b', 'c']);
  assert.deepStrictEqual(plain(result.added), ['b']);
  assert.deepStrictEqual(plain(result.removed), ['a']);
});

test('日期一端缺失时方差为 null，两端缺失为 0', function() {
  var base = snapshot([entryTask('a', null, null, 0)]);
  var result = Baseline.diff(base, [entryTask('a', '2026-01-01', null, 0)]);
  var entry = result.tasks[0];
  assert.strictEqual(entry.startVarianceDays, null);
  assert.strictEqual(entry.endVarianceDays, 0);
  assert.strictEqual(entry.changed, true);

  var bothNull = Baseline.diff(
    snapshot([entryTask('b', null, null, 0)]),
    [entryTask('b', null, null, 0)]
  );
  assert.strictEqual(bothNull.tasks[0].startVarianceDays, 0);
  assert.strictEqual(bothNull.tasks[0].endVarianceDays, 0);
  assert.strictEqual(bothNull.tasks[0].changed, false);
});

test('diff 不修改快照和当前任务数组', function() {
  var base = snapshot([
    entryTask('a', '2026-01-01', '2026-01-10', 40),
    entryTask('b', '2026-02-01', '2026-02-10', 20)
  ]);
  var current = [entryTask('a', '2026-01-02', '2026-01-12', 60), entryTask('c')];
  var baseBefore = JSON.stringify(base);
  var currentBefore = JSON.stringify(current);

  Baseline.diff(base, current);

  assert.strictEqual(JSON.stringify(base), baseBefore);
  assert.strictEqual(JSON.stringify(current), currentBefore);
});

// ---------- summarize ----------

test('summarize 统计变更、延期、提前、新增和删除', function() {
  var base = snapshot([
    entryTask('a', '2026-01-01', '2026-01-10', 40),
    entryTask('b', '2026-01-01', '2026-01-10', 40),
    entryTask('c', '2026-01-01', '2026-01-10', 40),
    entryTask('d', '2026-01-01', '2026-01-10', 40)
  ]);
  var current = [
    entryTask('a', '2026-01-01', '2026-01-14', 40),
    entryTask('b', '2026-01-01', '2026-01-08', 40),
    entryTask('d', '2026-01-01', '2026-01-10', 40),
    entryTask('e', '2026-02-01', '2026-02-10', 0)
  ];
  var result = Baseline.summarize(Baseline.diff(base, current));

  assert.strictEqual(result.total, 5);
  assert.strictEqual(result.changed, 2);
  assert.strictEqual(result.delayed, 1);
  assert.strictEqual(result.advanced, 1);
  assert.strictEqual(result.added, 1);
  assert.strictEqual(result.removed, 1);
  assert.strictEqual(result.averageDelayDays, 4);
});

test('summarize 平均延期只统计延期任务并保留两位小数', function() {
  var base = snapshot([
    entryTask('a', '2026-01-01', '2026-01-10', 0),
    entryTask('b', '2026-01-01', '2026-01-10', 0),
    entryTask('c', '2026-01-01', '2026-01-10', 0)
  ]);
  var current = [
    entryTask('a', '2026-01-01', '2026-01-16', 0),
    entryTask('b', '2026-01-01', '2026-01-13', 0),
    entryTask('c', '2026-01-01', '2026-01-10', 0)
  ];
  var result = Baseline.summarize(Baseline.diff(base, current));

  assert.strictEqual(result.delayed, 2);
  assert.strictEqual(result.averageDelayDays, 4.5);
});

test('summarize 空差异返回全 0', function() {
  assert.deepStrictEqual(plain(Baseline.summarize({ tasks: [] })), {
    total: 0,
    changed: 0,
    delayed: 0,
    advanced: 0,
    added: 0,
    removed: 0,
    averageDelayDays: 0
  });
  assert.deepStrictEqual(plain(Baseline.summarize(null)), {
    total: 0,
    changed: 0,
    delayed: 0,
    advanced: 0,
    added: 0,
    removed: 0,
    averageDelayDays: 0
  });
});

// ---------- formatVariance ----------

test('formatVariance 输出带符号的天数文本', function() {
  assert.strictEqual(Baseline.formatVariance(3), '+3');
  assert.strictEqual(Baseline.formatVariance(-2), '-2');
  assert.strictEqual(Baseline.formatVariance(0), '0');
});

test('formatVariance 四舍五入并容错非法输入', function() {
  assert.strictEqual(Baseline.formatVariance(2.6), '+3');
  assert.strictEqual(Baseline.formatVariance(-1.6), '-2');
  assert.strictEqual(Baseline.formatVariance(0.4), '0');
  assert.strictEqual(Baseline.formatVariance(null), '0');
  assert.strictEqual(Baseline.formatVariance('3'), '0');
  assert.strictEqual(Baseline.formatVariance(NaN), '0');
  assert.strictEqual(Baseline.formatVariance(Infinity), '0');
});

// ---------- 纯函数 ----------

test('所有函数调用前后输入保持不变', function() {
  var tasks = [
    entryTask('b', '2026-02-01', '2026-02-10', 20, '乙'),
    entryTask('a', '2026-01-01', '2026-01-10', 10, '甲')
  ];
  var capturedAt = '2026-06-01T00:00:00.000Z';
  var created = Baseline.createSnapshot(tasks, capturedAt);
  var current = [
    entryTask('a', '2026-01-02', '2026-01-12', 60, '甲'),
    entryTask('c', '2026-03-01', '2026-03-10', 0, '丙')
  ];

  var tasksBefore = JSON.stringify(tasks);
  var createdBefore = JSON.stringify(created);
  var currentBefore = JSON.stringify(current);

  Baseline.validateSnapshot(created, ['a', 'b']);
  var result = Baseline.diff(created, current);
  var resultBefore = JSON.stringify(result);
  Baseline.summarize(result);
  Baseline.formatVariance(result.tasks[0].endVarianceDays);

  assert.strictEqual(JSON.stringify(tasks), tasksBefore);
  assert.strictEqual(JSON.stringify(created), createdBefore);
  assert.strictEqual(JSON.stringify(current), currentBefore);
  assert.strictEqual(JSON.stringify(result), resultBefore);
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

console.log('\nbaseline: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
