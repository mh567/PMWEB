'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'holiday-source.js', 'progress.js', 'work-calendar.js']);
var WorkCalendar = app.get('WorkCalendar');
var HolidaySource = app.get('HolidaySource');
var Progress = app.get('Progress');

var DEFAULT = WorkCalendar.createConfig();

function snapshot(value) {
  return JSON.stringify(value);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('createConfig: 默认周末为周六周日，节假日和补班为空', function() {
  var config = WorkCalendar.createConfig();
  assert.deepStrictEqual(plain(config.weekends), [0, 6]);
  assert.deepStrictEqual(plain(config.holidays), []);
  assert.deepStrictEqual(plain(config.workdays), []);
});

test('createConfig: 省略参数与空对象等价', function() {
  assert.deepStrictEqual(plain(WorkCalendar.createConfig()), plain(WorkCalendar.createConfig({})));
  assert.deepStrictEqual(plain(WorkCalendar.createConfig(null)), plain(WorkCalendar.createConfig()));
});

test('createConfig: 周末去重排序并过滤非法值', function() {
  var config = WorkCalendar.createConfig({ weekends: [6, 5, 6, 9, -1, 2.5, '1'] });
  assert.deepStrictEqual(plain(config.weekends), [5, 6]);
});

test('createConfig: weekends 非数组回退默认值', function() {
  assert.deepStrictEqual(plain(WorkCalendar.createConfig({ weekends: 'weekend' }).weekends), [0, 6]);
});

test('createConfig: 空 weekends 表示没有周末', function() {
  var config = WorkCalendar.createConfig({ weekends: [] });
  assert.deepStrictEqual(plain(config.weekends), []);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-03', config), true);
});

test('createConfig: 节假日规范化去重并过滤非法日期', function() {
  var config = WorkCalendar.createConfig({
    holidays: ['2026-01-02', '2026-01-02', 'bad', '2026-02-30', '2026-01-01']
  });
  assert.deepStrictEqual(plain(config.holidays), ['2026-01-01', '2026-01-02']);
});

test('createConfig: 接受 Set 作为节假日来源', function() {
  var config = WorkCalendar.createConfig({ holidays: new Set(['2026-01-02']) });
  assert.deepStrictEqual(plain(config.holidays), ['2026-01-02']);
});

test('createConfig: 多次调用返回独立数组', function() {
  var first = WorkCalendar.createConfig();
  var second = WorkCalendar.createConfig();
  first.weekends.push(3);
  first.holidays.push('2026-01-01');
  assert.deepStrictEqual(plain(second.weekends), [0, 6]);
  assert.deepStrictEqual(plain(second.holidays), []);
});

test('isWorkingDay: 默认配置下周一至周五为工作日', function() {
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-01', DEFAULT), true);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-02', DEFAULT), true);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-05', DEFAULT), true);
});

test('isWorkingDay: 周六周日为非工作日', function() {
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-03', DEFAULT), false);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-04', DEFAULT), false);
});

test('isWorkingDay: 自定义周末生效', function() {
  var config = WorkCalendar.createConfig({ weekends: [5, 6] });
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-02', config), false);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-04', config), true);
});

test('isWorkingDay: 节假日为非工作日', function() {
  var config = WorkCalendar.createConfig({ holidays: ['2026-01-05'] });
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-05', config), false);
});

test('isWorkingDay: 补班日优先于周末和节假日', function() {
  var config = WorkCalendar.createConfig({
    holidays: ['2026-01-04'],
    workdays: ['2026-01-03', '2026-01-04']
  });
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-03', config), true);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-04', config), true);
});

test('isWorkingDay: 非法日期返回 false', function() {
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-02-30', DEFAULT), false);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-1-1', DEFAULT), false);
  assert.strictEqual(WorkCalendar.isWorkingDay('', DEFAULT), false);
  assert.strictEqual(WorkCalendar.isWorkingDay(null, DEFAULT), false);
  assert.strictEqual(WorkCalendar.isWorkingDay(undefined, DEFAULT), false);
});

test('workingDaysBetween: 含首尾按工作日计数', function() {
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-01', '2026-01-05', DEFAULT), 3);
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-05', '2026-01-05', DEFAULT), 1);
});

test('workingDaysBetween: 跨周末扣除周六周日', function() {
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-01', '2026-01-07', DEFAULT), 5);
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-03', '2026-01-04', DEFAULT), 0);
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-03', '2026-01-05', DEFAULT), 1);
});

test('workingDaysBetween: 扣除节假日', function() {
  var config = WorkCalendar.createConfig({ holidays: ['2026-01-02'] });
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-01', '2026-01-05', config), 2);
});

test('workingDaysBetween: 计入补班日', function() {
  var config = WorkCalendar.createConfig({
    holidays: ['2026-01-05'],
    workdays: ['2026-01-03']
  });
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-02', '2026-01-05', config), 2);
});

test('workingDaysBetween: 跨月跨年连续计算', function() {
  assert.strictEqual(WorkCalendar.workingDaysBetween('2025-12-29', '2026-01-02', DEFAULT), 5);
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-30', '2026-02-02', DEFAULT), 2);
});

test('workingDaysBetween: 闰年 2 月 29 日参与计算', function() {
  assert.strictEqual(WorkCalendar.isWorkingDay('2028-02-29', DEFAULT), true);
  assert.strictEqual(WorkCalendar.workingDaysBetween('2028-02-01', '2028-02-29', DEFAULT), 21);
});

test('workingDaysBetween: 非法区间返回 0', function() {
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-05', '2026-01-01', DEFAULT), 0);
  assert.strictEqual(WorkCalendar.workingDaysBetween('bad', '2026-01-01', DEFAULT), 0);
  assert.strictEqual(WorkCalendar.workingDaysBetween('2026-01-01', null, DEFAULT), 0);
});

test('addWorkingDays: 正方向推进', function() {
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-05', 1, DEFAULT), '2026-01-06');
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-05', 4, DEFAULT), '2026-01-09');
});

test('addWorkingDays: 跨周末', function() {
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-02', 1, DEFAULT), '2026-01-05');
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-03', 1, DEFAULT), '2026-01-05');
});

test('addWorkingDays: 负方向回退', function() {
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-05', -1, DEFAULT), '2026-01-02');
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-05', -4, DEFAULT), '2025-12-30');
});

test('addWorkingDays: 负方向跨年和跨月', function() {
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-01', -1, DEFAULT), '2025-12-31');
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-30', 1, DEFAULT), '2026-02-02');
});

test('addWorkingDays: 零步长返回原日期', function() {
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-03', 0, DEFAULT), '2026-01-03');
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-05', 0, DEFAULT), '2026-01-05');
});

test('addWorkingDays: 跳过节假日', function() {
  var config = WorkCalendar.createConfig({ holidays: ['2026-01-02'] });
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-01', 1, config), '2026-01-05');
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-05', -1, config), '2026-01-01');
});

test('addWorkingDays: 补班日计入工作日', function() {
  var config = WorkCalendar.createConfig({ workdays: ['2026-01-03'] });
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-02', 1, config), '2026-01-03');
});

test('addWorkingDays: 非数字步长按 0 处理，非法日期返回 null', function() {
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-01-05', 'x', DEFAULT), '2026-01-05');
  assert.strictEqual(WorkCalendar.addWorkingDays('2026-02-30', 1, DEFAULT), null);
  assert.strictEqual(WorkCalendar.addWorkingDays(null, 1, DEFAULT), null);
});

test('adjustToWorkingDay: 向后查找最近工作日', function() {
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2026-01-03', 'forward', DEFAULT), '2026-01-05');
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2026-01-04', 'next', DEFAULT), '2026-01-05');
});

test('adjustToWorkingDay: 向前查找最近工作日', function() {
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2026-01-03', 'backward', DEFAULT), '2026-01-02');
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2026-01-04', 'prev', DEFAULT), '2026-01-02');
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2026-01-03', -1, DEFAULT), '2026-01-02');
});

test('adjustToWorkingDay: 已是工作日原样返回', function() {
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2026-01-05', 'forward', DEFAULT), '2026-01-05');
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2026-01-05', 'backward', DEFAULT), '2026-01-05');
});

test('adjustToWorkingDay: 跳过节假日和跨年', function() {
  var config = WorkCalendar.createConfig({ holidays: ['2026-01-02'] });
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2026-01-03', 'backward', config), '2026-01-01');
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('2025-12-27', 'forward', DEFAULT), '2025-12-29');
});

test('adjustToWorkingDay: 非法日期返回 null', function() {
  assert.strictEqual(WorkCalendar.adjustToWorkingDay('bad', 'forward', DEFAULT), null);
  assert.strictEqual(WorkCalendar.adjustToWorkingDay(null, 'forward', DEFAULT), null);
});

test('durationWeight: 工作日区间等于工作日数量', function() {
  assert.strictEqual(WorkCalendar.durationWeight('2026-01-01', '2026-01-05', DEFAULT), 3);
  assert.strictEqual(WorkCalendar.durationWeight('2026-01-05', '2026-01-09', DEFAULT), 5);
  assert.strictEqual(WorkCalendar.durationWeight('2026-01-05', '2026-01-05', DEFAULT), 1);
});

test('durationWeight: 扣除节假日', function() {
  var config = WorkCalendar.createConfig({ holidays: ['2026-01-02'] });
  assert.strictEqual(WorkCalendar.durationWeight('2026-01-01', '2026-01-05', config), 2);
});

test('durationWeight: 至少为 1', function() {
  assert.strictEqual(WorkCalendar.durationWeight('2026-01-03', '2026-01-04', DEFAULT), 1);
  assert.strictEqual(WorkCalendar.durationWeight('2026-01-05', '2026-01-01', DEFAULT), 1);
  assert.strictEqual(WorkCalendar.durationWeight('bad', '2026-01-01', DEFAULT), 1);
  assert.strictEqual(WorkCalendar.durationWeight(null, null, DEFAULT), 1);
});

test('durationWeight: 与 Progress.durationWeight 在工作日区间一致', function() {
  var task = { startDate: '2026-01-05', endDate: '2026-01-09' };
  assert.strictEqual(WorkCalendar.durationWeight(task.startDate, task.endDate, DEFAULT),
    Progress.durationWeight(task));

  var single = { startDate: '2026-01-05', endDate: '2026-01-05' };
  assert.strictEqual(WorkCalendar.durationWeight(single.startDate, single.endDate, DEFAULT),
    Progress.durationWeight(single));
});

test('durationWeight: 包含周末时小于 Progress 的自然日口径', function() {
  var task = { startDate: '2026-01-01', endDate: '2026-01-05' };
  assert.strictEqual(Progress.durationWeight(task), 5);
  assert.strictEqual(WorkCalendar.durationWeight(task.startDate, task.endDate, DEFAULT), 3);
});

test('纯函数不修改配置对象', function() {
  var config = WorkCalendar.createConfig({
    weekends: [0, 6],
    holidays: ['2026-01-02'],
    workdays: ['2026-01-03']
  });
  var before = snapshot(config);

  WorkCalendar.isWorkingDay('2026-01-05', config);
  WorkCalendar.workingDaysBetween('2026-01-01', '2026-01-31', config);
  WorkCalendar.addWorkingDays('2026-01-01', 10, config);
  WorkCalendar.addWorkingDays('2026-01-31', -10, config);
  WorkCalendar.adjustToWorkingDay('2026-01-04', 'forward', config);
  WorkCalendar.durationWeight('2026-01-01', '2026-01-31', config);

  assert.strictEqual(snapshot(config), before);
});

test('createConfig 不修改传入的 options', function() {
  var options = {
    weekends: [6, 0],
    holidays: ['2026-01-02'],
    workdays: ['2026-01-03']
  };
  var before = snapshot(options);
  WorkCalendar.createConfig(options);
  assert.strictEqual(snapshot(options), before);
});

test('默认配置对象不被调用方修改污染', function() {
  var config = WorkCalendar.createConfig();
  var before = snapshot(DEFAULT);
  config.weekends.push(1);
  config.holidays.push('2026-01-01');
  config.workdays.push('2026-01-03');
  assert.strictEqual(snapshot(DEFAULT), before);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-03', DEFAULT), false);
});

test('resolveDate 与 isWorkingDay 支持全局日历和项目例外', function() {
  var calendar = {
    subscribed: true,
    cacheByYear: {
      2026: {
        year: 2026,
        region: 'CN',
        dates: [
          { date: '2026-01-01', name: '元旦', type: 'public_holiday' },
          { date: '2026-01-04', name: '元旦补班', type: 'transfer_workday' }
        ]
      }
    },
    importedByYear: {},
    lastAttemptByYear: {}
  };

  var res1 = WorkCalendar.resolveDate('2026-01-01', calendar, null);
  assert.strictEqual(res1.working, false);
  assert.strictEqual(res1.name, '元旦');
  assert.strictEqual(res1.source, 'subscription');

  var res2 = WorkCalendar.resolveDate('2026-01-04', calendar, null);
  assert.strictEqual(res2.working, true);
  assert.strictEqual(res2.name, '元旦补班');
  assert.strictEqual(res2.source, 'subscription');

  // isWorkingDay 委托验证
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-01', { calendar: calendar }), false);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-04', { calendar: calendar }), true);

  // 项目例外覆盖验证
  var overrides = {
    '2026-01-01': { working: true, name: '项目赶工' }
  };
  var res3 = WorkCalendar.resolveDate('2026-01-01', calendar, overrides);
  assert.strictEqual(res3.working, true);
  assert.strictEqual(res3.name, '项目赶工');
  assert.strictEqual(res3.source, 'manual');
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-01', { calendar: calendar, calendarOverrides: overrides }), true);
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

console.log('\nwork-calendar: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
