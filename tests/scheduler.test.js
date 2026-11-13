'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['links.js', 'work-calendar.js', 'scheduler.js']);
var Scheduler = app.get('Scheduler');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function task(id, startDate, endDate, extra) {
  var value = { id: id, startDate: startDate || null, endDate: endDate || null };
  if (extra) {
    Object.keys(extra).forEach(function(key) { value[key] = extra[key]; });
  }
  return value;
}

function link(id, source, target, type, lag) {
  return { id: id, source: source, target: target, type: type, lag: lag };
}

function byId(tasks) {
  var map = {};
  tasks.forEach(function(item) { map[item.id] = item; });
  return map;
}

function codes(result) {
  return result.errors.map(function(error) { return error.code; });
}

// ---------- 单任务四种依赖 ----------

test('FS：目标开始不早于前置结束加 lag', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-20'),
    task('b', '2026-01-05', '2026-01-08')
  ];
  var result = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'FS', 3)], tasks);
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.task.startDate, '2026-01-23');
  assert.strictEqual(result.task.endDate, '2026-01-26');
  assert.deepStrictEqual(plain(result.errors), []);
});

test('SS：目标开始不早于前置开始加 lag', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-20'),
    task('b', '2026-01-05', '2026-01-08')
  ];
  var result = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'SS', 2)], tasks);
  assert.strictEqual(result.task.startDate, '2026-01-12');
  assert.strictEqual(result.task.endDate, '2026-01-15');
});

test('FF：目标结束不早于前置结束加 lag', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-20'),
    task('b', '2026-01-05', '2026-01-08')
  ];
  var result = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'FF', 5)], tasks);
  assert.strictEqual(result.task.endDate, '2026-01-25');
  assert.strictEqual(result.task.startDate, '2026-01-22');
});

test('SF：目标结束不早于前置开始加 lag', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-20'),
    task('b', '2026-01-05', '2026-01-08')
  ];
  var result = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'SF', 4)], tasks);
  assert.strictEqual(result.task.endDate, '2026-01-14');
  assert.strictEqual(result.task.startDate, '2026-01-11');
});

test('FS lag 为 0 时约束与 Links.computeConstraint 一致', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-20'),
    task('b', '2026-01-05', '2026-01-08')
  ];
  var result = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'FS', 0)], tasks);
  assert.strictEqual(result.task.startDate, '2026-01-20');
  assert.strictEqual(result.task.endDate, '2026-01-23');
});

test('负 lag 作为提前量计算约束', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-20'),
    task('b', '2026-01-05', '2026-01-08')
  ];
  var result = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'FS', -2)], tasks);
  assert.strictEqual(result.task.startDate, '2026-01-18');
  assert.strictEqual(result.task.endDate, '2026-01-21');
});

test('目标已满足约束时不改动日期', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-20'),
    task('b', '2026-01-22', '2026-01-24')
  ];
  var result = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'FS', -2)], tasks);
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.task.startDate, '2026-01-22');
  assert.strictEqual(result.task.endDate, '2026-01-24');
});

test('多条依赖取最晚的开始约束', function() {
  var tasks = [
    task('a', '2026-01-10', '2026-01-20'),
    task('b', '2026-01-15', '2026-01-18'),
    task('c', '2026-01-01', '2026-01-02')
  ];
  var links = [
    link('l1', 'a', 'c', 'FS', 0),
    link('l2', 'b', 'c', 'SS', 3)
  ];
  var result = Scheduler.scheduleTask(tasks[2], links, tasks);
  assert.strictEqual(result.task.startDate, '2026-01-20');
  assert.strictEqual(result.task.endDate, '2026-01-21');
});

// ---------- 工作日历 ----------

test('工作日模式跨周末推迟到下一个工作日', function() {
  var tasks = [
    task('a', '2025-12-31', '2026-01-02'),
    task('b', '2025-12-30', '2026-01-01')
  ];
  var links = [link('l1', 'a', 'b', 'FS', 1)];
  var calendar = { weekends: [0, 6] };

  var scheduled = Scheduler.scheduleTask(tasks[1], links, tasks, calendar);
  assert.strictEqual(scheduled.task.startDate, '2026-01-05');
  assert.strictEqual(scheduled.task.endDate, '2026-01-07');
});

test('缺少工作日历时回退自然日', function() {
  var tasks = [
    task('a', '2025-12-31', '2026-01-02'),
    task('b', '2025-12-30', '2026-01-01')
  ];
  var links = [link('l1', 'a', 'b', 'FS', 1)];

  var scheduled = Scheduler.scheduleTask(tasks[1], links, tasks);
  assert.strictEqual(scheduled.task.startDate, '2026-01-03');
  assert.strictEqual(scheduled.task.endDate, '2026-01-05');
});

test('workCalendar 包装配置同样生效', function() {
  var tasks = [
    task('a', '2026-01-02', '2026-01-02'),
    task('b', '2026-01-03', '2026-01-03')
  ];
  var links = [link('l1', 'a', 'b', 'FS', 1)];
  var result = Scheduler.scheduleTask(tasks[1], links, tasks, {
    workCalendar: { weekends: [0, 6] }
  });
  assert.strictEqual(result.task.startDate, '2026-01-05');
});

// ---------- 批量排期 ----------

test('scheduleAll 按拓扑序传播新日期', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03'),
    task('c', '2026-01-01', '2026-01-03')
  ];
  var links = [
    link('l1', 'a', 'b', 'FS', 1),
    link('l2', 'b', 'c', 'FS', 1)
  ];

  var result = Scheduler.scheduleAll(tasks, links);
  var map = byId(result.tasks);

  assert.strictEqual(result.changed, true);
  assert.strictEqual(map.a.startDate, '2026-01-01');
  assert.strictEqual(map.b.startDate, '2026-01-04');
  assert.strictEqual(map.b.endDate, '2026-01-06');
  assert.strictEqual(map.c.startDate, '2026-01-07');
  assert.strictEqual(map.c.endDate, '2026-01-09');
  assert.deepStrictEqual(plain(result.errors), []);
});

test('scheduleAll 保持入参任务顺序', function() {
  var tasks = [
    task('c', '2026-01-01', '2026-01-02'),
    task('a', '2026-01-01', '2026-01-02'),
    task('b', '2026-01-01', '2026-01-02')
  ];
  var links = [
    link('l1', 'a', 'b', 'FS', 0),
    link('l2', 'b', 'c', 'FS', 0)
  ];
  var result = Scheduler.scheduleAll(tasks, links);
  assert.deepStrictEqual(result.tasks.map(function(item) { return item.id; }), ['c', 'a', 'b']);
});

test('scheduleAll 跳过锁定任务但用其日期约束后继', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-02', { locked: true }),
    task('c', '2026-01-01', '2026-01-01')
  ];
  var links = [
    link('l1', 'a', 'b', 'FS', 1),
    link('l2', 'b', 'c', 'FS', 1)
  ];

  var result = Scheduler.scheduleAll(tasks, links);
  var map = byId(result.tasks);

  assert.strictEqual(map.b.startDate, '2026-01-01');
  assert.strictEqual(map.b.endDate, '2026-01-02');
  assert.strictEqual(map.c.startDate, '2026-01-03');
  assert.strictEqual(map.c.endDate, '2026-01-03');
  assert.strictEqual(result.changed, true);
});

test('manualLock 是 locked 的别名', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-02', { manualLock: true })
  ];
  var links = [link('l1', 'a', 'b', 'FS', 1)];
  var result = Scheduler.scheduleAll(tasks, links);
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.tasks[1].startDate, '2026-01-01');
});

test('没有依赖时 scheduleAll 不改动任务', function() {
  var tasks = [task('a', '2026-01-01', '2026-01-03')];
  var result = Scheduler.scheduleAll(tasks, []);
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.tasks[0].startDate, '2026-01-01');
});

// ---------- 错误 ----------

test('环返回 CYCLE 且不改动日期', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ];
  var links = [
    link('l1', 'a', 'b', 'FS', 1),
    link('l2', 'b', 'a', 'FS', 1)
  ];

  var result = Scheduler.scheduleAll(tasks, links);
  assert.ok(codes(result).indexOf('CYCLE') !== -1);
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.tasks[0].startDate, '2026-01-01');
  assert.strictEqual(result.tasks[1].startDate, '2026-01-04');
});

test('缺失任务返回 MISSING_SOURCE', function() {
  var tasks = [task('a', '2026-01-01', '2026-01-03')];
  var result = Scheduler.scheduleAll(tasks, [link('l1', 'ghost', 'a', 'FS', 0)]);
  assert.ok(codes(result).indexOf('MISSING_SOURCE') !== -1);
});

test('缺失目标返回 MISSING_TARGET', function() {
  var tasks = [task('a', '2026-01-01', '2026-01-03')];
  var result = Scheduler.scheduleAll(tasks, [link('l1', 'a', 'ghost', 'FS', 0)]);
  assert.ok(codes(result).indexOf('MISSING_TARGET') !== -1);
});

test('非法日期返回 INVALID_DATE 与 MISSING_DATE', function() {
  var tasks = [
    task('a', '2026-02-01', '2026-02-30'),
    task('b', '2026-03-01', '2026-03-03')
  ];
  var result = Scheduler.scheduleAll(tasks, [link('l1', 'a', 'b', 'FS', 0)]);
  assert.ok(codes(result).indexOf('INVALID_DATE') !== -1);
  assert.ok(codes(result).indexOf('MISSING_DATE') !== -1);
});

test('非法依赖类型与 lag 返回明确错误', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ];
  var badType = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'XX', 0)], tasks);
  assert.ok(codes(badType).indexOf('INVALID_TYPE') !== -1);
  assert.strictEqual(badType.changed, false);

  var badLag = Scheduler.scheduleAll(tasks, [link('l2', 'a', 'b', 'FS', 1.5)]);
  assert.ok(codes(badLag).indexOf('INVALID_LAG') !== -1);
});

test('缺少前置日期返回 MISSING_DATE', function() {
  var tasks = [
    task('a', null, '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ];
  var result = Scheduler.scheduleTask(tasks[1], [link('l1', 'a', 'b', 'SS', 1)], tasks);
  assert.ok(codes(result).indexOf('MISSING_DATE') !== -1);
  assert.strictEqual(result.changed, false);
});

test('没有入边时返回同值副本', function() {
  var tasks = [task('a', '2026-01-01', '2026-01-03')];
  var result = Scheduler.scheduleTask(tasks[0], [], tasks);
  assert.strictEqual(result.changed, false);
  assert.notStrictEqual(result.task, tasks[0]);
  assert.strictEqual(result.task.startDate, '2026-01-01');
});

// ---------- 纯函数 ----------

test('scheduleTask 与 scheduleAll 不修改入参', function() {
  var tasks = [
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03')
  ];
  var links = [link('l1', 'a', 'b', 'FS', 1)];
  var config = { weekends: [0, 6], holidays: ['2026-01-05'] };

  var tasksBefore = JSON.stringify(tasks);
  var linksBefore = JSON.stringify(links);
  var configBefore = JSON.stringify(config);

  Scheduler.scheduleTask(tasks[1], links, tasks, config);
  var result = Scheduler.scheduleAll(tasks, links, config);

  assert.strictEqual(JSON.stringify(tasks), tasksBefore);
  assert.strictEqual(JSON.stringify(links), linksBefore);
  assert.strictEqual(JSON.stringify(config), configBefore);

  result.tasks[1].startDate = '1999-01-01';
  assert.strictEqual(tasks[1].startDate, '2026-01-01');
});

test('空输入不抛错', function() {
  assert.deepStrictEqual(plain(Scheduler.scheduleAll([], [])), {
    tasks: [], changed: false, errors: []
  });
  var single = Scheduler.scheduleTask(task('a', '2026-01-01', '2026-01-02'), [], []);
  assert.strictEqual(single.changed, false);
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

console.log('\nscheduler: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
