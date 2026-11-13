'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['resources.js']);
var Resources = app.get('Resources');

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

function keys(object) {
  return Object.keys(object).sort();
}

function snapshot(value) {
  return JSON.stringify(value);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertPlain(actual, expected, message) {
  assert.deepStrictEqual(plain(actual), expected, message);
}

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('buildWorkload: 单人按日汇总', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-09')
  ]);

  assert.strictEqual(workload.granularity, 'day');
  assertPlain(Object.keys(workload.byAssignee), ['张三']);

  var entry = workload.byAssignee['张三'];
  assert.strictEqual(entry.assignee, '张三');
  assert.strictEqual(entry.capacityPerDay, 8);
  assert.strictEqual(entry.totalHours, 40);
  assertPlain(Object.keys(entry.dates), [
    '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'
  ]);
  assert.strictEqual(entry.dates['2026-01-05'], 8);
  assert.strictEqual(entry.dates['2026-01-09'], 8);

  assert.strictEqual(workload.byDate['2026-01-05'].totalHours, 8);
  assertPlain(workload.byDate['2026-01-05'].byAssignee, { '张三': 8 });
  assert.strictEqual(workload.conflicts.length, 0);
});

test('buildWorkload: 多负责人同日汇总', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-06'),
    task('t2', '李四', '2026-01-05', '2026-01-05', 4)
  ]);

  assert.strictEqual(Object.keys(workload.byAssignee).length, 2);
  assert.strictEqual(workload.byAssignee['张三'].totalHours, 16);
  assert.strictEqual(workload.byAssignee['李四'].totalHours, 4);

  assert.strictEqual(workload.byDate['2026-01-05'].totalHours, 12);
  assert.strictEqual(workload.byDate['2026-01-05'].byAssignee['张三'], 8);
  assert.strictEqual(workload.byDate['2026-01-05'].byAssignee['李四'], 4);
  assert.strictEqual(workload.byDate['2026-01-06'].totalHours, 8);
  assert.strictEqual(workload.conflicts.length, 0);
});

test('buildWorkload: 没有 estimatedHours 时默认每天 8 小时', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-07')
  ]);

  var entry = workload.byAssignee['张三'];
  assert.strictEqual(entry.totalHours, 24);
  assert.strictEqual(entry.dates['2026-01-05'], 8);
  assert.strictEqual(entry.dates['2026-01-06'], 8);
  assert.strictEqual(entry.dates['2026-01-07'], 8);
});

test('buildWorkload: 自定义 hoursPerDay 影响默认工时', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-07')
  ], { hoursPerDay: 6 });

  var entry = workload.byAssignee['张三'];
  assert.strictEqual(entry.totalHours, 18);
  assert.strictEqual(entry.dates['2026-01-05'], 6);
});

test('buildWorkload: estimatedHours 按工期均摊', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-07', 12)
  ]);

  var entry = workload.byAssignee['张三'];
  assert.strictEqual(entry.totalHours, 12);
  assert.strictEqual(entry.dates['2026-01-05'], 4);
  assert.strictEqual(entry.dates['2026-01-06'], 4);
  assert.strictEqual(entry.dates['2026-01-07'], 4);
});

test('buildWorkload: estimatedHours 为 0 时不产生日期占用', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-06', 0)
  ]);

  assert.strictEqual(workload.byAssignee['张三'].totalHours, 0);
  assertPlain(workload.byAssignee['张三'].dates, {});
  assertPlain(workload.byDate, {});
  assert.strictEqual(workload.conflicts.length, 0);
});

test('buildWorkload: 非法 estimatedHours 回退到默认工时', function() {
  var negative = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-06', -5)
  ]);
  var stringValue = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-06', '12')
  ]);
  var notANumber = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-06', NaN)
  ]);

  assert.strictEqual(negative.byAssignee['张三'].totalHours, 16);
  assert.strictEqual(stringValue.byAssignee['张三'].totalHours, 16);
  assert.strictEqual(notANumber.byAssignee['张三'].totalHours, 16);
});

test('buildWorkload: 跨天均摊并检测每日超载', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-07', 30)
  ]);

  var entry = workload.byAssignee['张三'];
  assert.strictEqual(entry.totalHours, 30);
  assert.strictEqual(entry.dates['2026-01-05'], 10);
  assert.strictEqual(workload.conflicts.length, 3);
  workload.conflicts.forEach(function(conflict) {
    assert.strictEqual(conflict.assignee, '张三');
    assert.strictEqual(conflict.hours, 10);
    assert.strictEqual(conflict.capacity, 8);
    assert.strictEqual(conflict.overtime, 2);
  });
  assertPlain(workload.conflicts.map(function(c) { return c.date; }), [
    '2026-01-05', '2026-01-06', '2026-01-07'
  ]);
});

test('buildWorkload: 跨周按周一分桶', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-01', '2026-01-05')
  ], { granularity: 'week' });

  var entry = workload.byAssignee['张三'];
  assert.strictEqual(workload.granularity, 'week');
  assertPlain(Object.keys(entry.dates), ['2025-12-29', '2026-01-05']);
  assert.strictEqual(entry.dates['2025-12-29'], 32);
  assert.strictEqual(entry.dates['2026-01-05'], 8);
  assert.strictEqual(entry.totalHours, 40);
  assert.strictEqual(workload.byDate['2025-12-29'].totalHours, 32);
  assert.strictEqual(workload.conflicts.length, 0);
});

test('buildWorkload: 跨月连续汇总', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-30', '2026-02-02')
  ]);

  var entry = workload.byAssignee['张三'];
  assert.strictEqual(entry.totalHours, 32);
  assertPlain(Object.keys(entry.dates), [
    '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'
  ]);
  assertPlain(keys(workload.byDate), [
    '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'
  ]);
});

test('buildWorkload: 跨年连续汇总', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2025-12-30', '2026-01-02')
  ]);

  assert.strictEqual(workload.byAssignee['张三'].totalHours, 32);
  assertPlain(keys(workload.byDate), [
    '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'
  ]);
});

test('buildWorkload: 自定义容量触发每日超载', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 8)
  ], { capacity: 4 });

  assert.strictEqual(workload.byAssignee['张三'].capacityPerDay, 4);
  assert.strictEqual(workload.conflicts.length, 1);
  assert.strictEqual(workload.conflicts[0].capacity, 4);
  assert.strictEqual(workload.conflicts[0].hours, 8);
  assert.strictEqual(workload.conflicts[0].overtime, 4);
});

test('buildWorkload: capacityByAssignee 覆盖个人容量', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 8),
    task('t2', '李四', '2026-01-05', '2026-01-05', 8)
  ], {
    capacity: 8,
    capacityByAssignee: { '张三': 4 }
  });

  assert.strictEqual(workload.byAssignee['张三'].capacityPerDay, 4);
  assert.strictEqual(workload.byAssignee['李四'].capacityPerDay, 8);
  assert.strictEqual(workload.conflicts.length, 1);
  assert.strictEqual(workload.conflicts[0].assignee, '张三');
});

test('buildWorkload: 周容量为每日容量乘 7', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-09'),
    task('t2', '张三', '2026-01-05', '2026-01-05', 20)
  ], { granularity: 'week' });

  assert.strictEqual(workload.byAssignee['张三'].dates['2026-01-05'], 60);
  assert.strictEqual(workload.conflicts.length, 1);
  assert.strictEqual(workload.conflicts[0].date, '2026-01-05');
  assert.strictEqual(workload.conflicts[0].capacity, 56);
  assert.strictEqual(workload.conflicts[0].overtime, 4);
});

test('buildWorkload: 非法容量回退到默认 8 小时', function() {
  var negative = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 8)
  ], { capacity: -2 });
  var stringValue = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 8)
  ], { capacity: '4' });

  assert.strictEqual(negative.byAssignee['张三'].capacityPerDay, 8);
  assert.strictEqual(negative.conflicts.length, 0);
  assert.strictEqual(stringValue.byAssignee['张三'].capacityPerDay, 8);
});

test('buildWorkload: 容量为 0 时任何工时都超载', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 1)
  ], { capacity: 0 });

  assert.strictEqual(workload.byAssignee['张三'].capacityPerDay, 0);
  assert.strictEqual(workload.conflicts.length, 1);
  assert.strictEqual(workload.conflicts[0].overtime, 1);
});

test('findConflicts: 传入容量覆盖个人配置', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 8)
  ], { capacity: 4 });

  assert.strictEqual(Resources.findConflicts(workload, 10).length, 0);
  assert.strictEqual(Resources.findConflicts(workload, 4).length, 1);
  assert.strictEqual(Resources.findConflicts(workload, 0).length, 1);
});

test('findConflicts: 非法输入返回空数组', function() {
  assertPlain(Resources.findConflicts(null), []);
  assertPlain(Resources.findConflicts(undefined), []);
  assertPlain(Resources.findConflicts({}), []);
  assertPlain(Resources.findConflicts({ byAssignee: {} }), []);
});

test('buildWorkload: 空任务和无负责人不产生汇总', function() {
  assertPlain(Resources.buildWorkload([]), {
    granularity: 'day',
    byAssignee: {},
    byDate: {},
    conflicts: []
  });
  assertPlain(Resources.buildWorkload(null), {
    granularity: 'day',
    byAssignee: {},
    byDate: {},
    conflicts: []
  });
  assertPlain(Resources.buildWorkload('bad'), {
    granularity: 'day',
    byAssignee: {},
    byDate: {},
    conflicts: []
  });

  var workload = Resources.buildWorkload([
    task('t1', '', '2026-01-05', '2026-01-06'),
    task('t2', '   ', '2026-01-05', '2026-01-06'),
    task('t3', null, '2026-01-05', '2026-01-06'),
    task('t4', undefined, '2026-01-05', '2026-01-06'),
    task('t5', 42, '2026-01-05', '2026-01-06'),
    null
  ]);
  assertPlain(workload.byAssignee, {});
  assertPlain(workload.byDate, {});
});

test('buildWorkload: 非法日期和倒置区间被忽略', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', 'bad', '2026-01-06'),
    task('t2', '张三', '2026-01-05', 'bad'),
    task('t3', '张三', '2026-02-30', '2026-03-02'),
    task('t4', '张三', null, '2026-01-06'),
    task('t5', '张三', '2026-01-10', '2026-01-05'),
    task('t6', '张三', '2026-1-5', '2026-01-06')
  ]);

  assertPlain(workload.byAssignee, {});
  assertPlain(workload.byDate, {});
  assert.strictEqual(workload.conflicts.length, 0);
});

test('buildWorkload: 负责人字符串前后空格归一', function() {
  var workload = Resources.buildWorkload([
    task('t1', ' 张三 ', '2026-01-05', '2026-01-05', 4),
    task('t2', '张三', '2026-01-06', '2026-01-06', 4)
  ]);

  assertPlain(Object.keys(workload.byAssignee), ['张三']);
  assert.strictEqual(workload.byAssignee['张三'].totalHours, 8);
});

test('summarize: 统计人数、总工时、超载人数和超载天数', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 10),
    task('t2', '李四', '2026-01-05', '2026-01-05', 12),
    task('t3', '李四', '2026-01-06', '2026-01-06', 9)
  ]);

  var summary = Resources.summarize(workload);
  assert.strictEqual(summary.totalAssignees, 2);
  assert.strictEqual(summary.totalHours, 31);
  assert.strictEqual(summary.overloadedAssignees, 2);
  assert.strictEqual(summary.overloadedDates, 2);
});

test('summarize: 无超载时人数统计仍准确', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 4),
    task('t2', '李四', '2026-01-05', '2026-01-05', 6)
  ]);

  var summary = Resources.summarize(workload);
  assert.strictEqual(summary.totalAssignees, 2);
  assert.strictEqual(summary.totalHours, 10);
  assert.strictEqual(summary.overloadedAssignees, 0);
  assert.strictEqual(summary.overloadedDates, 0);
});

test('summarize: 空工作量和非法输入返回零值', function() {
  var empty = { totalAssignees: 0, totalHours: 0, overloadedAssignees: 0, overloadedDates: 0 };
  assertPlain(Resources.summarize(Resources.buildWorkload([])), empty);
  assertPlain(Resources.summarize(null), empty);
  assertPlain(Resources.summarize({}), empty);
});

test('summarize: 缺少 conflicts 时按容量重新计算', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-05', 10)
  ]);
  var withoutConflicts = {
    granularity: workload.granularity,
    byAssignee: workload.byAssignee,
    byDate: workload.byDate
  };

  var summary = Resources.summarize(withoutConflicts);
  assert.strictEqual(summary.overloadedAssignees, 1);
  assert.strictEqual(summary.overloadedDates, 1);
});

test('buildWorkload: 周粒度超载日期使用周起始键', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-09', 60)
  ], { granularity: 'week', capacity: 8 });

  assert.strictEqual(workload.conflicts.length, 1);
  assert.strictEqual(workload.conflicts[0].date, '2026-01-05');
  assert.strictEqual(workload.conflicts[0].hours, 60);
});

test('纯函数不修改传入任务和配置', function() {
  var tasks = [
    task('t1', '张三', '2026-01-05', '2026-01-09', 20),
    task('t2', '李四', '2026-01-05', '2026-01-06'),
    task('t3', '', '2026-01-05', '2026-01-06')
  ];
  var options = {
    granularity: 'week',
    capacity: 6,
    hoursPerDay: 7,
    capacityByAssignee: { '李四': 5 }
  };
  var tasksBefore = snapshot(tasks);
  var optionsBefore = snapshot(options);

  var workload = Resources.buildWorkload(tasks, options);
  Resources.findConflicts(workload, 3);
  Resources.summarize(workload);

  assert.strictEqual(snapshot(tasks), tasksBefore);
  assert.strictEqual(snapshot(options), optionsBefore);
});

test('buildWorkload: 每次调用返回独立数据', function() {
  var tasks = [task('t1', '张三', '2026-01-05', '2026-01-06', 16)];
  var first = Resources.buildWorkload(tasks);
  var second = Resources.buildWorkload(tasks);

  first.byAssignee['张三'].dates['2026-01-05'] = 999;
  first.byAssignee['张三'].totalHours = 999;
  first.byDate['2026-01-05'].totalHours = 999;

  assert.strictEqual(second.byAssignee['张三'].dates['2026-01-05'], 8);
  assert.strictEqual(second.byAssignee['张三'].totalHours, 16);
  assert.strictEqual(second.byDate['2026-01-05'].totalHours, 8);
});

test('buildWorkload: byDate 与 byAssignee 数据一致', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-06', 10),
    task('t2', '李四', '2026-01-05', '2026-01-05', 6)
  ]);

  Object.keys(workload.byDate).forEach(function(date) {
    var bucket = workload.byDate[date];
    var sum = 0;
    Object.keys(bucket.byAssignee).forEach(function(name) {
      sum += bucket.byAssignee[name];
      assert.strictEqual(
        workload.byAssignee[name].dates[date],
        bucket.byAssignee[name],
        date + ' ' + name
      );
    });
    assert.ok(Math.abs(bucket.totalHours - sum) < 1e-9, date + ' 合计一致');
  });
});

test('buildWorkload: 周粒度下 capacityByAssignee 按每日容量乘 7', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-09')
  ], {
    granularity: 'week',
    capacity: 8,
    capacityByAssignee: { '张三': 4 }
  });

  assert.strictEqual(workload.granularity, 'week');
  assert.strictEqual(workload.byAssignee['张三'].capacityPerDay, 4);
  assert.strictEqual(workload.conflicts.length, 1);
  assert.strictEqual(workload.conflicts[0].date, '2026-01-05');
  assert.strictEqual(workload.conflicts[0].hours, 40);
  assert.strictEqual(workload.conflicts[0].capacity, 28);
  assert.strictEqual(workload.conflicts[0].overtime, 12);
});

test('buildWorkload: 冲突按负责人和日期升序排列', function() {
  var workload = Resources.buildWorkload([
    task('t1', '李四', '2026-01-05', '2026-01-05', 10),
    task('t2', '张三', '2026-01-06', '2026-01-06', 10),
    task('t3', '张三', '2026-01-05', '2026-01-05', 10)
  ], { capacity: 8 });

  assertPlain(workload.conflicts.map(function(conflict) {
    return conflict.assignee + ':' + conflict.date;
  }), ['张三:2026-01-05', '张三:2026-01-06', '李四:2026-01-05']);
});

test('findConflicts: 周粒度传入容量时按 7 倍容量判断', function() {
  var workload = Resources.buildWorkload([
    task('t1', '张三', '2026-01-05', '2026-01-09')
  ], { granularity: 'week', capacity: 8 });

  assert.strictEqual(Resources.findConflicts(workload, 8).length, 0);
  assert.strictEqual(Resources.findConflicts(workload, 5).length, 1);
  assert.strictEqual(Resources.findConflicts(workload, 5)[0].capacity, 35);
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

console.log('\nresources: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
