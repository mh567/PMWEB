'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'baseline.js',
  'task-manager.js',
  'app.js'
]);

var TaskManager = app.get('TaskManager');
var Baseline = app.get('Baseline');
var App = app.get('App');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function task(id, startDate, endDate, progress, name) {
  return {
    id: id,
    parentId: null,
    name: name === undefined ? id : name,
    description: '',
    assignee: '',
    color: null,
    startDate: startDate === undefined ? null : startDate,
    endDate: endDate === undefined ? null : endDate,
    status: 'inProgress',
    progress: progress === undefined ? 0 : progress,
    plannedEndDate: endDate === undefined ? null : endDate,
    order: 0,
    ganttRow: null
  };
}

function makeData(tasks) {
  return {
    pmweb_version: 3,
    tasks: tasks || [],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  };
}

function install(tasks) {
  TaskManager._baselineWarned = null;
  return helper.installTasks(app, makeData(tasks));
}

// ---------- TaskManager 基线持久化 ----------

test('saveBaseline 把快照写入 data.baseline 并持久化到 localStorage', function() {
  install([
    task('B', '2026-02-01', '2026-02-10', 30, '乙'),
    task('A', '2026-01-01', '2026-01-10', 20, '甲')
  ]);

  var snapshot = TaskManager.saveBaseline();

  assert.ok(snapshot, '应返回快照');
  assert.strictEqual(TaskManager.data.baseline, snapshot);
  assert.strictEqual(snapshot.version, Baseline.VERSION);
  assert.ok(!isNaN(Date.parse(snapshot.capturedAt)), 'capturedAt 应可解析');
  assert.deepStrictEqual(plain(snapshot.tasks.map(function(item) { return item.id; })), ['A', 'B']);

  var raw = JSON.parse(app.localStorage.getItem('pmweb_data'));
  var projectData = raw.projects ? raw.projects[0].data : raw;
  assert.ok(projectData.baseline, 'localStorage 中应包含 baseline');
  assert.strictEqual(projectData.baseline.version, Baseline.VERSION);
  assert.strictEqual(projectData.baseline.tasks.length, 2);
});

test('getBaseline 返回已保存的合法快照', function() {
  install([task('A', '2026-01-01', '2026-01-10', 20, '甲')]);
  TaskManager.saveBaseline();

  var snapshot = TaskManager.getBaseline();
  assert.ok(snapshot);
  assert.strictEqual(snapshot.version, Baseline.VERSION);
  assert.strictEqual(snapshot.tasks.length, 1);
  assert.strictEqual(TaskManager.hasBaseline(), true);
});

test('getBaseline 对非法快照返回 null 并只提示一次', function() {
  install([task('A', '2026-01-01', '2026-01-10', 20, '甲')]);
  TaskManager.data.baseline = { version: 99, capturedAt: 'bad', tasks: {} };

  var before = app.alerts.length;
  assert.strictEqual(TaskManager.getBaseline(), null);
  assert.ok(app.alerts.length > before, '应提示基线无效');
  assert.ok(app.alerts[app.alerts.length - 1].indexOf('基线数据无效') !== -1);

  var afterFirst = app.alerts.length;
  assert.strictEqual(TaskManager.getBaseline(), null);
  assert.strictEqual(app.alerts.length, afterFirst, '同一非法快照不重复提示');
  assert.strictEqual(TaskManager.hasBaseline(), false);
});

test('getBaseline 在任务被删除后仍视为合法，差异标记为删除', function() {
  install([
    task('A', '2026-01-01', '2026-01-10', 20, '甲'),
    task('B', '2026-02-01', '2026-02-10', 30, '乙')
  ]);
  TaskManager.saveBaseline();
  TaskManager.deleteTask('B');

  var snapshot = TaskManager.getBaseline();
  assert.ok(snapshot, '删除任务不应让快照失效');
  var diff = Baseline.diff(snapshot, TaskManager.getAllTasks());
  assert.deepStrictEqual(plain(diff.removed), ['B']);
});

test('clearBaseline 移除快照并返回结果', function() {
  install([task('A', '2026-01-01', '2026-01-10', 20, '甲')]);
  TaskManager.saveBaseline();
  assert.ok(TaskManager.getBaseline());

  assert.strictEqual(TaskManager.clearBaseline(), true);
  assert.strictEqual(TaskManager.data.baseline, null);
  assert.strictEqual(TaskManager.getBaseline(), null);
  assert.strictEqual(TaskManager.clearBaseline(), false);
});

test('保存的基线在重新加载数据后仍然存在', function() {
  install([task('A', '2026-01-01', '2026-01-10', 20, '甲')]);
  TaskManager.saveBaseline();

  TaskManager.data = null;
  TaskManager._baselineWarned = null;
  TaskManager.init();

  var snapshot = TaskManager.getBaseline();
  assert.ok(snapshot, '重新加载后基线应保留');
  assert.strictEqual(snapshot.tasks.length, 1);
  assert.strictEqual(snapshot.tasks[0].id, 'A');
});

// ---------- UI 摘要文本 ----------

test('buildBaselineSummaryText 输出统计和采集时间', function() {
  var text = App.buildBaselineSummaryText({
    total: 5,
    changed: 2,
    delayed: 1,
    advanced: 1,
    added: 1,
    removed: 1,
    averageDelayDays: 4
  }, '2026-06-01T08:00:00.000Z');

  assert.strictEqual(
    text,
    '基线采集于 2026-06-01 08:00 · 共 5 项 · 变更 2 · 延期 1 · 提前 1 · 新增 1 · 删除 1 · 平均延期 4 天'
  );
});

test('buildBaselineSummaryText 容忍空统计和缺失采集时间', function() {
  assert.strictEqual(
    App.buildBaselineSummaryText(null, null),
    '共 0 项 · 变更 0 · 延期 0 · 提前 0 · 新增 0 · 删除 0 · 平均延期 0 天'
  );
  assert.strictEqual(
    App.buildBaselineSummaryText({ total: 2, averageDelayDays: 1.333 }, undefined),
    '共 2 项 · 变更 0 · 延期 0 · 提前 0 · 新增 0 · 删除 0 · 平均延期 1.33 天'
  );
});

// ---------- UI 差异列表 ----------

test('buildBaselineChangeList 只保留变更、新增和删除条目', function() {
  var snapshot = Baseline.createSnapshot([
    task('A', '2026-01-01', '2026-01-10', 40, '甲'),
    task('C', '2026-03-01', '2026-03-10', 10, '丙'),
    task('D', '2026-04-01', '2026-04-10', 20, '丁')
  ], '2026-06-01T08:00:00.000Z');

  var current = [
    task('A', '2026-01-01', '2026-01-15', 60, '甲'),
    task('D', '2026-04-01', '2026-04-10', 20, '丁'),
    task('B', '2026-02-01', '2026-02-10', 0, '乙')
  ];

  var rows = App.buildBaselineChangeList(Baseline.diff(snapshot, current));

  assert.deepStrictEqual(plain(rows.map(function(row) { return row.id; })), ['A', 'B', 'C']);
  assert.deepStrictEqual(plain(rows.map(function(row) { return row.kind; })),
    ['changed', 'added', 'removed']);
  assert.deepStrictEqual(plain(rows.map(function(row) { return row.kindLabel; })),
    ['变更', '新增', '删除']);
});

test('buildBaselineChangeList 输出带符号的偏差文本', function() {
  var snapshot = Baseline.createSnapshot([
    task('A', '2026-01-01', '2026-01-10', 40, '甲'),
    task('B', '2026-01-01', '2026-01-10', 40, '乙'),
    task('C', '2026-01-01', '2026-01-10', 40, '丙')
  ], '2026-06-01T08:00:00.000Z');

  var current = [
    task('A', '2026-01-03', '2026-01-15', 70, '甲'),
    task('B', '2026-01-01', '2026-01-07', 40, '乙'),
    task('C', '2026-01-01', '2026-01-10', 40, '丙')
  ];

  var rows = App.buildBaselineChangeList(Baseline.diff(snapshot, current));

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, '甲');
  assert.strictEqual(rows[0].startVarianceText, '+2 天');
  assert.strictEqual(rows[0].endVarianceText, '+5 天');
  assert.strictEqual(rows[0].progressVarianceText, '+30%');
  assert.strictEqual(rows[1].name, '乙');
  assert.strictEqual(rows[1].endVarianceText, '-3 天');
});

test('buildBaselineChangeList 对新增和删除任务输出不可比较偏差', function() {
  var snapshot = Baseline.createSnapshot([task('A', '2026-01-01', '2026-01-10', 40, '甲')],
    '2026-06-01T08:00:00.000Z');
  var current = [task('B', '2026-02-01', '2026-02-10', 0, '乙')];

  var rows = App.buildBaselineChangeList(Baseline.diff(snapshot, current));
  var added = rows.filter(function(row) { return row.kind === 'added'; })[0];
  var removed = rows.filter(function(row) { return row.kind === 'removed'; })[0];

  assert.strictEqual(added.endVarianceText, '—');
  assert.strictEqual(added.startVarianceText, '—');
  assert.strictEqual(removed.endVarianceText, '—');
});

test('buildBaselineChangeList 对无差异返回空列表', function() {
  var snapshot = Baseline.createSnapshot([task('A', '2026-01-01', '2026-01-10', 40, '甲')]);
  var rows = App.buildBaselineChangeList(Baseline.diff(snapshot, [task('A', '2026-01-01', '2026-01-10', 40, '甲')]));
  assert.deepStrictEqual(plain(rows), []);
  assert.deepStrictEqual(plain(App.buildBaselineChangeList(null)), []);
});

// ---------- 保存基线与摘要联动 ----------

test('保存后差异汇总与摘要文本一致', function() {
  install([
    task('A', '2026-01-01', '2026-01-10', 40, '甲'),
    task('B', '2026-01-05', '2026-01-15', 40, '乙')
  ]);
  var snapshot = TaskManager.saveBaseline();
  TaskManager.updateTask('A', { endDate: '2026-01-14' });

  var diff = Baseline.diff(snapshot, TaskManager.getAllTasks());
  var summary = Baseline.summarize(diff);
  var text = App.buildBaselineSummaryText(summary, snapshot.capturedAt);

  assert.strictEqual(summary.total, 2);
  assert.strictEqual(summary.changed, 1);
  assert.strictEqual(summary.delayed, 1);
  assert.ok(text.indexOf('变更 1') !== -1, text);
  assert.ok(text.indexOf('延期 1') !== -1, text);
  assert.ok(text.indexOf('平均延期 4 天') !== -1, text);
  assert.strictEqual(App.buildBaselineChangeList(diff).length, 1);
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

console.log('\nbaseline-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
