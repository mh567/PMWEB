'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'work-calendar.js',
  'progress.js',
  'links.js',
  'task-manager.js',
  'row-model.js',
  'arrows.js',
  'baseline.js',
  'timeline-pane.js'
]);

var TimelinePane = app.get('TimelinePane');
var RowModel = app.get('RowModel');
var DateUtil = app.get('DateUtil');
var WorkCalendar = app.get('WorkCalendar');
var TaskManager = app.get('TaskManager');

function format(date) {
  return DateUtil.format(date);
}

function daysBetween(startDate, endDate) {
  var out = [];
  var cursor = DateUtil.parse(startDate);
  var limit = DateUtil.parse(endDate);
  while (cursor <= limit) {
    out.push(DateUtil.format(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return out;
}

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

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('day 粒度日期范围按 7 天留白', function() {
  var range = TimelinePane.calcDateRange([
    { startDate: '2026-01-10', endDate: '2026-01-20' }
  ], 'day');
  assert.strictEqual(format(range.startDate), '2026-01-03');
  assert.strictEqual(format(range.endDate), '2026-01-27');
});

test('week 粒度日期范围对齐到周一和周日', function() {
  var range = TimelinePane.calcDateRange([
    { startDate: '2026-01-10', endDate: '2026-01-20' }
  ], 'week');
  assert.strictEqual(format(range.startDate), '2025-12-22');
  assert.strictEqual(format(range.endDate), '2026-02-08');
});

test('month 粒度日期范围对齐到月初和月末', function() {
  var range = TimelinePane.calcDateRange([
    { startDate: '2026-01-10', endDate: '2026-01-20' }
  ], 'month');
  assert.strictEqual(format(range.startDate), '2025-11-01');
  assert.strictEqual(format(range.endDate), '2026-03-31');
});

test('里程碑日期参与日期范围计算', function() {
  var range = TimelinePane.calcDateRange([
    { startDate: '2026-01-10', endDate: '2026-01-20' }
  ], 'day', ['2026-02-01']);
  assert.strictEqual(format(range.startDate), '2026-01-03');
  assert.strictEqual(format(range.endDate), '2026-02-08');
});

test('空行返回当前月起的默认范围', function() {
  var range = TimelinePane.calcDateRange([], 'day');
  assert.strictEqual(range.startDate.getDate(), 1);
  assert.strictEqual(range.startDate.getHours(), 0);
  assert.strictEqual(range.endDate >= range.startDate, true);
});

test('day 单元格逐日生成并标记周末', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-01-11'),
    'day'
  );
  assert.strictEqual(generated.cellWidth, 45);
  assert.strictEqual(generated.cells.length, 7);
  assert.strictEqual(generated.cells[0].label, '1/05');
  assert.strictEqual(generated.cells[0].weekday, '周一');
  assert.strictEqual(generated.cells[0].isWeekend, false);
  assert.strictEqual(generated.cells[5].weekday, '周六');
  assert.strictEqual(generated.cells[5].isWeekend, true);
  assert.strictEqual(generated.cells[6].isWeekend, true);
  assert.strictEqual(generated.cells[6].days, 1);
});

test('day 表头按月份分组', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-01-11'),
    'day'
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(generated.parentGroups)), [
    { label: '2026年1月', startIndex: 0, count: 7 }
  ]);
});

test('week 单元格按周生成并对齐周一', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-02-01'),
    'week'
  );
  assert.strictEqual(generated.cellWidth, 60);
  assert.strictEqual(generated.cells.length, 4);
  assert.strictEqual(format(generated.cells[0].start), '2026-01-05');
  assert.strictEqual(format(generated.cells[0].end), '2026-01-11');
  assert.strictEqual(generated.cells[0].label, 'W2');
  assert.strictEqual(generated.cells[0].days, 7);
  assert.strictEqual(format(generated.cells[3].start), '2026-01-26');
  assert.strictEqual(format(generated.cells[3].end), '2026-02-01');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(generated.parentGroups)), [
    { label: '2026年1月', startIndex: 0, count: 4 }
  ]);
});

test('month 单元格逐月生成并标注天数', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-01'),
    DateUtil.parse('2026-03-31'),
    'month'
  );
  assert.strictEqual(generated.cellWidth, 80);
  assert.strictEqual(generated.cells.length, 3);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(generated.cells.map(function(cell) { return cell.label; }))),
    ['1月', '2月', '3月']
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(generated.cells.map(function(cell) { return cell.days; }))),
    [31, 28, 31]
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(generated.parentGroups)), [
    { label: '2026年', startIndex: 0, count: 3 }
  ]);
});

test('dateToX 按日单元格计算精确坐标', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-01-11'),
    'day'
  );
  assert.strictEqual(
    TimelinePane.dateToX('2026-01-05', generated.cells, generated.cellWidth),
    0
  );
  assert.strictEqual(
    TimelinePane.dateToX('2026-01-07', generated.cells, generated.cellWidth),
    90
  );
  assert.strictEqual(
    TimelinePane.dateToX('2026-01-11', generated.cells, generated.cellWidth),
    270
  );
});

test('dateToX 对范围外的日期做线性外推', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-01-11'),
    'day'
  );
  assert.strictEqual(
    TimelinePane.dateToX('2026-01-04', generated.cells, generated.cellWidth),
    -45
  );
  assert.strictEqual(
    TimelinePane.dateToX('2026-01-12', generated.cells, generated.cellWidth),
    315
  );
});

test('day 粒度 dateToX 与 xToDate 互为逆运算', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-01-11'),
    'day'
  );
  daysBetween('2026-01-05', '2026-01-11').forEach(function(date) {
    var x = TimelinePane.dateToX(date, generated.cells, generated.cellWidth);
    assert.strictEqual(TimelinePane.xToDate(x, generated.cells, generated.cellWidth), date);
  });
});

test('week 粒度 dateToX 与 xToDate 互为逆运算', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-02-01'),
    'week'
  );
  daysBetween('2026-01-05', '2026-02-01').forEach(function(date) {
    var x = TimelinePane.dateToX(date, generated.cells, generated.cellWidth);
    assert.strictEqual(TimelinePane.xToDate(x, generated.cells, generated.cellWidth), date);
  });
});

test('month 粒度 dateToX 与 xToDate 互为逆运算', function() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-01'),
    DateUtil.parse('2026-03-31'),
    'month'
  );
  daysBetween('2026-01-01', '2026-03-31').forEach(function(date) {
    var x = TimelinePane.dateToX(date, generated.cells, generated.cellWidth);
    assert.strictEqual(TimelinePane.xToDate(x, generated.cells, generated.cellWidth), date);
  });
});

test('空单元格数组时坐标函数返回安全默认值', function() {
  assert.strictEqual(TimelinePane.dateToX('2026-01-01', [], 45), 0);
  assert.strictEqual(typeof TimelinePane.xToDate(10, [], 45), 'string');
});

test('classifyRow 区分叶子行、汇总行和无日期行', function() {
  helper.installTasks(app, {
    pmweb_version: 3,
    links: [],
    views: [],
    settings: {},
    milestones: [],
    tasks: [
      task('A', null, 0, 'inProgress', '2026-01-01', '2026-01-31'),
      task('A1', 'A', 0, 'inProgress', '2026-01-01', '2026-01-10'),
      task('C', null, 1, 'inProgress', null, null)
    ]
  });

  var result = RowModel.build({
    collapsed: new Set(),
    statusFilter: { inProgress: true, thirdParty: true, done: true }
  });

  assert.strictEqual(TimelinePane.classifyRow(result.byId.get('A')), 'summary');
  assert.strictEqual(TimelinePane.classifyRow(result.byId.get('A1')), 'leaf');
  assert.strictEqual(TimelinePane.classifyRow(result.byId.get('C')), 'empty');
  assert.strictEqual(TimelinePane.classifyRow(null), 'empty');
  assert.strictEqual(TimelinePane.classifyRow({ task: {}, startDate: null, endDate: null }), 'empty');
});

// ---------- 进度填充 ----------

function prepareCells() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-01-11'),
    'day'
  );
  TimelinePane.cells = generated.cells;
  TimelinePane.cellWidth = generated.cellWidth;
  TimelinePane.selectedTaskId = null;
  TimelinePane.hoveredTaskId = null;
}

function leafRow(id, progress, startDate, endDate) {
  var t = task(id, null, 0, 'inProgress', startDate, endDate);
  t.progress = progress;
  return {
    id: id,
    task: t,
    depth: 0,
    hasChildren: false,
    isCollapsed: false,
    isSummary: false,
    childCount: 0,
    startDate: startDate,
    endDate: endDate
  };
}

test('叶子任务条渲染进度填充宽度', function() {
  prepareCells();
  var html = TimelinePane._renderBar(leafRow('A1', 40, '2026-01-05', '2026-01-07'));
  assert.ok(html.indexOf('class="gantt-bar-progress" style="width:40%"') !== -1, html);
});

test('进度百分比对齐 0 到 100 并对异常值兜底', function() {
  assert.strictEqual(TimelinePane.progressPercent({ progress: 0 }), 0);
  assert.strictEqual(TimelinePane.progressPercent({ progress: 100 }), 100);
  assert.strictEqual(TimelinePane.progressPercent({ progress: 140 }), 100);
  assert.strictEqual(TimelinePane.progressPercent({ progress: -20 }), 0);
  assert.strictEqual(TimelinePane.progressPercent({ progress: 33.6 }), 34);
  assert.strictEqual(TimelinePane.progressPercent({}), 0);
  assert.strictEqual(TimelinePane.progressPercent(null), 0);
});

test('汇总条渲染进度填充', function() {
  prepareCells();
  var summary = leafRow('A', 50, '2026-01-05', '2026-01-09');
  summary.isSummary = true;
  summary.hasChildren = true;
  summary.childCount = 2;
  TimelinePane._progressById = new Map([['A', 75]]);
  var html = TimelinePane._renderBar(summary);
  assert.ok(html.indexOf('gantt-summary-bar') !== -1, html);
  assert.ok(html.indexOf('gantt-summary-progress') !== -1, html);
  assert.ok(html.indexOf('style="width:75%"') !== -1, html);
  TimelinePane._progressById = null;
});

// ---------- 依赖箭头渲染 ----------

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function arrowRow(id, order, startDate, endDate) {
  return {
    id: id,
    task: task(id, null, order, 'inProgress', startDate, endDate),
    depth: 0,
    hasChildren: false,
    isCollapsed: false,
    isSummary: false,
    childCount: 0,
    startDate: startDate,
    endDate: endDate
  };
}

test('links 数量决定渲染的箭头数量', function() {
  helper.installTasks(app, {
    pmweb_version: 3,
    views: [],
    settings: {},
    milestones: [],
    tasks: [
      task('A', null, 0, 'inProgress', '2026-01-05', '2026-01-06'),
      task('B', null, 1, 'inProgress', '2026-01-07', '2026-01-08'),
      task('C', null, 2, 'inProgress', '2026-01-09', '2026-01-10')
    ],
    links: [
      { id: 'l1', source: 'A', target: 'B', type: 'FS', lag: 0 },
      { id: 'l2', source: 'B', target: 'C', type: 'SS', lag: 1 }
    ]
  });
  prepareCells();

  var rows = [
    arrowRow('A', 0, '2026-01-05', '2026-01-06'),
    arrowRow('B', 1, '2026-01-07', '2026-01-08'),
    arrowRow('C', 2, '2026-01-09', '2026-01-10')
  ];
  var html = TimelinePane._renderArrows(rows);

  assert.strictEqual(countOccurrences(html, 'class="dep-arrow-line'), 2);
  assert.strictEqual(countOccurrences(html, 'class="dep-arrow-hit"'), 2);
  assert.strictEqual(countOccurrences(html, 'class="dep-arrow-head"'), 2);
  assert.ok(html.indexOf('data-link-id="l1"') !== -1);
  assert.ok(html.indexOf('data-link-id="l2"') !== -1);
  assert.ok(html.indexOf('class="dep-arrows"') !== -1);
});

test('端点不可见的 links 不渲染箭头', function() {
  helper.installTasks(app, {
    pmweb_version: 3,
    views: [],
    settings: {},
    milestones: [],
    tasks: [
      task('A', null, 0, 'inProgress', '2026-01-05', '2026-01-06'),
      task('B', null, 1, 'inProgress', '2026-01-07', '2026-01-08')
    ],
    links: [
      { id: 'l1', source: 'A', target: 'ghost', type: 'FS', lag: 0 },
      { id: 'l2', source: 'A', target: 'B', type: 'FS', lag: 0 }
    ]
  });
  prepareCells();

  var html = TimelinePane._renderArrows([
    arrowRow('A', 0, '2026-01-05', '2026-01-06'),
    arrowRow('B', 1, '2026-01-07', '2026-01-08')
  ]);

  assert.strictEqual(countOccurrences(html, 'class="dep-arrow-line'), 1);
  assert.ok(html.indexOf('data-link-id="l2"') !== -1);
  assert.ok(html.indexOf('data-link-id="l1"') === -1);
});

test('空 links 不渲染箭头覆盖层', function() {
  helper.installTasks(app, {
    pmweb_version: 3,
    links: [],
    views: [],
    settings: {},
    milestones: [],
    tasks: [task('A', null, 0, 'inProgress', '2026-01-05', '2026-01-06')]
  });
  prepareCells();

  var html = TimelinePane._renderArrows([arrowRow('A', 0, '2026-01-05', '2026-01-06')]);
  assert.strictEqual(html, '');
});

// ---------- 基线 ghost 条 ----------

function setBaselineEntry(id, startDate, endDate, varianceDays) {
  var map = new Map();
  map.set(id, {
    id: id,
    baselineStartDate: startDate,
    baselineEndDate: endDate,
    endVarianceDays: varianceDays === undefined ? 0 : varianceDays
  });
  TimelinePane.setBaseline(map);
  return map;
}

test('有基线的任务渲染 ghost 条并按时段定位', function() {
  prepareCells();
  setBaselineEntry('A1', '2026-01-05', '2026-01-06', 2);

  var html = TimelinePane._renderBaselineBar(leafRow('A1', 40, '2026-01-07', '2026-01-08'));

  assert.ok(html.indexOf('gantt-baseline-bar') !== -1, html);
  assert.ok(html.indexOf('left:0px') !== -1, html);
  assert.ok(html.indexOf('width:90px') !== -1, html);
  assert.ok(html.indexOf('top:' + TimelinePane.BASELINE_TOP + 'px') !== -1, html);
  assert.ok(html.indexOf('is-delayed') !== -1, html);
  assert.ok(html.indexOf('结束偏差 +2 天') !== -1, html);
  assert.ok(html.indexOf('data-task-id="A1"') !== -1, html);
  TimelinePane.setBaseline(null);
});

test('缺失基线的任务不渲染 ghost 条', function() {
  prepareCells();
  TimelinePane.setBaseline(null);
  assert.strictEqual(TimelinePane._renderBaselineBar(leafRow('A1', 40, '2026-01-05', '2026-01-06')), '');

  setBaselineEntry('B', '2026-01-05', '2026-01-06', 0);
  assert.strictEqual(TimelinePane._renderBaselineBar(leafRow('A1', 40, '2026-01-05', '2026-01-06')), '');
  TimelinePane.setBaseline(null);
});

test('基线缺少一端日期时不渲染 ghost 条', function() {
  prepareCells();
  setBaselineEntry('A1', null, '2026-01-06', 0);
  assert.strictEqual(TimelinePane._renderBaselineBar(leafRow('A1', 40, '2026-01-05', '2026-01-06')), '');

  setBaselineEntry('A1', '2026-01-05', null, 0);
  assert.strictEqual(TimelinePane._renderBaselineBar(leafRow('A1', 40, '2026-01-05', '2026-01-06')), '');
  TimelinePane.setBaseline(null);
});

test('基线日期变化后 ghost 条位置随之变化', function() {
  prepareCells();
  setBaselineEntry('A1', '2026-01-05', '2026-01-06', 0);
  var first = TimelinePane._renderBaselineBar(leafRow('A1', 40, '2026-01-05', '2026-01-06'));
  assert.ok(first.indexOf('left:0px') !== -1, first);

  setBaselineEntry('A1', '2026-01-08', '2026-01-09', 3);
  var second = TimelinePane._renderBaselineBar(leafRow('A1', 40, '2026-01-05', '2026-01-06'));
  assert.ok(second.indexOf('left:135px') !== -1, second);
  assert.ok(second.indexOf('width:90px') !== -1, second);
  assert.notStrictEqual(first, second);
  TimelinePane.setBaseline(null);
});

test('ghost 条按结束偏差区分延期、提前和持平样式', function() {
  prepareCells();
  var row = leafRow('A1', 40, '2026-01-05', '2026-01-06');

  setBaselineEntry('A1', '2026-01-05', '2026-01-06', 4);
  assert.ok(TimelinePane._renderBaselineBar(row).indexOf('is-delayed') !== -1);

  setBaselineEntry('A1', '2026-01-05', '2026-01-06', -2);
  assert.ok(TimelinePane._renderBaselineBar(row).indexOf('is-advanced') !== -1);

  setBaselineEntry('A1', '2026-01-05', '2026-01-06', 0);
  assert.ok(TimelinePane._renderBaselineBar(row).indexOf('is-flat') !== -1);
  TimelinePane.setBaseline(null);
});

test('ghost 条跟随选中和 hover 状态', function() {
  prepareCells();
  setBaselineEntry('A1', '2026-01-05', '2026-01-06', 0);
  TimelinePane.selectedTaskId = 'A1';
  TimelinePane.hoveredTaskId = 'A1';

  var html = TimelinePane._renderBaselineBar(leafRow('A1', 40, '2026-01-05', '2026-01-06'));
  assert.ok(html.indexOf(' selected') !== -1, html);
  assert.ok(html.indexOf(' highlight') !== -1, html);

  TimelinePane.selectedTaskId = null;
  TimelinePane.hoveredTaskId = null;
  TimelinePane.setBaseline(null);
});

test('setBaseline 忽略非法 map', function() {
  assert.strictEqual(TimelinePane.setBaseline(null), null);
  assert.strictEqual(TimelinePane.setBaseline({}), null);
  assert.strictEqual(TimelinePane.baselineById, null);
});

// ---------- 工作日历视觉标记 ----------

function calendarCells(config, startDate, endDate) {
  return TimelinePane.generateCells(
    DateUtil.parse(startDate),
    DateUtil.parse(endDate),
    'day',
    config
  );
}

test('day 单元格标记节假日与补班日', function() {
  var config = WorkCalendar.createConfig({
    holidays: ['2026-01-07'],
    workdays: ['2026-01-03']
  });
  var generated = calendarCells(config, '2026-01-01', '2026-01-07');
  var byDate = {};
  generated.cells.forEach(function(cell) { byDate[cell.date] = cell; });

  assert.strictEqual(byDate['2026-01-03'].isMakeup, true);
  assert.strictEqual(byDate['2026-01-03'].isWeekend, false);
  assert.strictEqual(byDate['2026-01-04'].isWeekend, true);
  assert.strictEqual(byDate['2026-01-04'].isMakeup, false);
  assert.strictEqual(byDate['2026-01-07'].isHoliday, true);
  assert.strictEqual(byDate['2026-01-07'].isWeekend, false);
  assert.strictEqual(byDate['2026-01-05'].isHoliday, false);
});

test('自定义周末参与时间轴标记', function() {
  var config = WorkCalendar.createConfig({ weekends: [5, 6] });
  var generated = calendarCells(config, '2026-01-01', '2026-01-05');
  var byDate = {};
  generated.cells.forEach(function(cell) { byDate[cell.date] = cell; });

  assert.strictEqual(byDate['2026-01-02'].isWeekend, true);
  assert.strictEqual(byDate['2026-01-04'].isWeekend, false);
});

test('未传配置时保持原有周末标记', function() {
  var generated = calendarCells(undefined, '2026-01-05', '2026-01-11');
  assert.strictEqual(generated.cells[5].isWeekend, true);
  assert.strictEqual(generated.cells[6].isWeekend, true);
  assert.strictEqual(generated.cells[0].isHoliday, false);
  assert.strictEqual(generated.cells[0].isMakeup, false);
});

test('时间轴表头渲染节假日和补班日标记', function() {
  var config = WorkCalendar.createConfig({
    holidays: ['2026-01-07'],
    workdays: ['2026-01-03']
  });
  var generated = calendarCells(config, '2026-01-01', '2026-01-07');
  TimelinePane.cells = generated.cells;
  TimelinePane.cellWidth = generated.cellWidth;
  TimelinePane.parentGroups = generated.parentGroups;

  var html = TimelinePane._renderHeader(generated.cells.length * generated.cellWidth);

  assert.ok(html.indexOf('timeline-header-cell holiday') !== -1, html);
  assert.ok(html.indexOf('timeline-header-cell makeup') !== -1, html);
  assert.ok(html.indexOf('timeline-header-cell weekend') !== -1, html);
  assert.ok(html.indexOf('timeline-calendar-marker holiday') !== -1, html);
  assert.ok(html.indexOf('timeline-calendar-marker makeup') !== -1, html);
});

test('时间轴网格按节假日和补班日着色', function() {
  helper.installTasks(app, {
    pmweb_version: 3,
    views: [],
    settings: {},
    links: [],
    milestones: [],
    tasks: [task('A', null, 0, 'inProgress', '2026-01-01', '2026-01-07')]
  });
  var config = WorkCalendar.createConfig({
    holidays: ['2026-01-07'],
    workdays: ['2026-01-03']
  });
  var generated = calendarCells(config, '2026-01-01', '2026-01-07');

  TimelinePane.cells = generated.cells;
  TimelinePane.cellWidth = generated.cellWidth;
  TimelinePane.parentGroups = generated.parentGroups;
  TimelinePane.rows = [arrowRow('A', 0, '2026-01-01', '2026-01-07')];
  TimelinePane.selectedTaskId = null;
  TimelinePane.hoveredTaskId = null;
  TimelinePane.setBaseline(null);

  var html = TimelinePane._renderBody(generated.cells.length * generated.cellWidth);

  assert.ok(html.indexOf('timeline-grid-cell holiday') !== -1, html);
  assert.ok(html.indexOf('timeline-grid-cell makeup') !== -1, html);
  assert.ok(html.indexOf('timeline-grid-cell weekend') !== -1, html);
  assert.ok(html.indexOf('rgba(220,38,38,0.10)') !== -1, html);
  assert.ok(html.indexOf('rgba(22,163,74,0.10)') !== -1, html);
  TaskManager.data = null;
});

test('配置工作日历后任务条提示显示工作日工期', function() {
  helper.installTasks(app, {
    pmweb_version: 3,
    views: [],
    links: [],
    milestones: [],
    settings: { workCalendar: { weekends: [0, 6], holidays: [], workdays: [] } },
    tasks: [task('A', null, 0, 'inProgress', '2026-01-01', '2026-01-05')]
  });
  prepareCells();

  var html = TimelinePane._renderBar(leafRow('A', 40, '2026-01-01', '2026-01-05'));

  assert.ok(html.indexOf('工期 3 个工作日') !== -1, html);
  TaskManager.data = null;
});

// ---------- 关键路径高亮 ----------

test('setCriticalIds 接受 Set 并支持查询', function() {
  TimelinePane.setCriticalIds(new Set(['A1']));
  assert.strictEqual(TimelinePane.isCritical('A1'), true);
  assert.strictEqual(TimelinePane.isCritical('B'), false);
  assert.strictEqual(TimelinePane.isCritical(null), false);
  TimelinePane.setCriticalIds(null);
});

test('setCriticalIds 忽略非集合入参', function() {
  assert.strictEqual(TimelinePane.setCriticalIds(null), null);
  assert.strictEqual(TimelinePane.setCriticalIds({}), null);
  assert.strictEqual(TimelinePane.setCriticalIds(['A']), null);
  assert.strictEqual(TimelinePane.criticalIds, null);
});

test('关键任务条带 critical 且不改动位置和高度', function() {
  prepareCells();
  TimelinePane.setCriticalIds(null);

  var plain = TimelinePane._renderBar(leafRow('A1', 40, '2026-01-05', '2026-01-07'));
  assert.strictEqual(plain.indexOf(' critical'), -1);

  TimelinePane.setCriticalIds(new Set(['A1']));
  var critical = TimelinePane._renderBar(leafRow('A1', 40, '2026-01-05', '2026-01-07'));
  assert.ok(critical.indexOf(' critical') !== -1, critical);
  assert.ok(critical.indexOf('left:0px') !== -1, critical);
  assert.ok(critical.indexOf('width:135px') !== -1, critical);
  assert.ok(critical.indexOf('top:' + TimelinePane.BAR_TOP + 'px') !== -1, critical);

  TimelinePane.setCriticalIds(null);
});

test('关键汇总条带 critical 且保持汇总条高度', function() {
  prepareCells();
  TimelinePane.setCriticalIds(new Set(['A']));

  var row = leafRow('A', 50, '2026-01-05', '2026-01-09');
  row.isSummary = true;
  row.hasChildren = true;
  row.childCount = 2;
  var html = TimelinePane._renderBar(row);

  assert.ok(html.indexOf('gantt-summary-bar') !== -1, html);
  assert.ok(html.indexOf(' critical') !== -1, html);
  assert.ok(html.indexOf('top:' + TimelinePane.SUMMARY_TOP + 'px') !== -1, html);

  TimelinePane.setCriticalIds(null);
});

test('关闭关键路径后条形不再带 critical', function() {
  prepareCells();
  TimelinePane.setCriticalIds(new Set(['A1']));
  assert.ok(TimelinePane._renderBar(leafRow('A1', 40, '2026-01-05', '2026-01-07')).indexOf(' critical') !== -1);

  TimelinePane.setCriticalIds(null);
  assert.strictEqual(
    TimelinePane._renderBar(leafRow('A1', 40, '2026-01-05', '2026-01-07')).indexOf('critical'),
    -1
  );
});

test('时间轴行渲染关键路径 class', function() {
  helper.installTasks(app, {
    pmweb_version: 3,
    views: [],
    settings: {},
    links: [],
    milestones: [],
    tasks: [task('A', null, 0, 'inProgress', '2026-01-05', '2026-01-07')]
  });
  prepareCells();
  TimelinePane.rows = [arrowRow('A', 0, '2026-01-05', '2026-01-07')];
  TimelinePane.setCriticalIds(new Set(['A']));

  var html = TimelinePane._renderBody(TimelinePane.cells.length * TimelinePane.cellWidth);

  assert.ok(html.indexOf('timeline-row critical') !== -1, html);
  TimelinePane.setCriticalIds(null);
  TaskManager.data = null;
});

test('关键路径高亮与选中、hover 同时存在', function() {
  prepareCells();
  TimelinePane.setCriticalIds(new Set(['A1']));
  TimelinePane.selectedTaskId = 'A1';
  TimelinePane.hoveredTaskId = 'A1';

  var html = TimelinePane._renderBar(leafRow('A1', 40, '2026-01-05', '2026-01-07'));

  assert.ok(html.indexOf(' selected') !== -1, html);
  assert.ok(html.indexOf(' highlight') !== -1, html);
  assert.ok(html.indexOf(' critical') !== -1, html);

  TimelinePane.selectedTaskId = null;
  TimelinePane.hoveredTaskId = null;
  TimelinePane.setCriticalIds(null);
});

// ---------- 可视窗口渲染 ----------

function windowRowsForRender() {
  helper.installTasks(app, {
    pmweb_version: 3,
    views: [],
    settings: {},
    links: [],
    milestones: [],
    tasks: [
      task('A', null, 0, 'inProgress', '2026-01-05', '2026-01-06'),
      task('B', null, 1, 'inProgress', '2026-01-07', '2026-01-08'),
      task('C', null, 2, 'inProgress', '2026-01-09', '2026-01-10')
    ]
  });
  prepareCells();
  TimelinePane.rows = [
    arrowRow('A', 0, '2026-01-05', '2026-01-06'),
    arrowRow('B', 1, '2026-01-07', '2026-01-08'),
    arrowRow('C', 2, '2026-01-09', '2026-01-10')
  ];
  TimelinePane.selectedTaskId = null;
  TimelinePane.hoveredTaskId = null;
  TimelinePane.setBaseline(null);
  TimelinePane.setCriticalIds(null);
  return TimelinePane.cells.length * TimelinePane.cellWidth;
}

test('结构渲染固定内容高度并留出窗口行容器', function() {
  var width = windowRowsForRender();
  var shell = TimelinePane._renderBodyShell(width);

  assert.ok(shell.indexOf('class="timeline-content"') !== -1, shell);
  assert.ok(shell.indexOf('height:120px') !== -1, shell);
  assert.ok(shell.indexOf('class="timeline-rows"') !== -1, shell);
  assert.strictEqual(shell.indexOf('data-row-index'), -1);
  TaskManager.data = null;
});

test('窗口切片只渲染区间内的任务条并按绝对行号定位', function() {
  var width = windowRowsForRender();
  var html = TimelinePane._renderRowsHtml(1, 3, width);

  assert.strictEqual(countOccurrences(html, 'class="timeline-row'), 2);
  assert.ok(html.indexOf('data-row-index="1" style="top:40px') !== -1, html);
  assert.ok(html.indexOf('data-row-index="2" style="top:80px') !== -1, html);
  assert.ok(html.indexOf('data-task-id="B"') !== -1, html);
  assert.ok(html.indexOf('data-task-id="C"') !== -1, html);
  assert.strictEqual(html.indexOf('data-task-id="A"'), -1);
  assert.strictEqual(countOccurrences(html, 'class="gantt-bar status-'), 2);
  TaskManager.data = null;
});

test('窗口切片复用同一日期网格片段', function() {
  var width = windowRowsForRender();
  var cellsHtml = TimelinePane._gridCellsHtml();
  var html = TimelinePane._renderRowsHtml(0, 2, width);

  assert.strictEqual(countOccurrences(cellsHtml, 'timeline-grid-cell'), 7);
  assert.strictEqual(countOccurrences(html, 'timeline-grid-cell'), 14);
  assert.strictEqual(TimelinePane._gridCellsHtml(), cellsHtml);
  TaskManager.data = null;
});

test('TASK3-MINR-01: TimelinePane 与 GanttView 父条样式类名消费派生有效状态', function() {
  helper.resetProject(app);
  var parentTask = TaskManager.addTask(null, '父任务');
  TaskManager.updateTask(parentTask.id, { startDate: '2026-01-01', endDate: '2026-01-10', status: 'todo' });
  var c1 = TaskManager.addTask(parentTask.id, '子任务1');
  var c2 = TaskManager.addTask(parentTask.id, '子任务2');
  TaskManager.updateTask(c1.id, { startDate: '2026-01-01', endDate: '2026-01-05', status: 'done', progress: 100 });
  TaskManager.updateTask(c2.id, { startDate: '2026-01-06', endDate: '2026-01-10', status: 'done', progress: 100 });

  assert.strictEqual(TaskManager.getEffectiveStatus(parentTask), 'done');

  var row = {
    id: parentTask.id,
    task: parentTask,
    depth: 0,
    hasChildren: true,
    isCollapsed: false,
    isSummary: false,
    childCount: 2,
    startDate: '2026-01-01',
    endDate: '2026-01-10'
  };

  var barHtml = TimelinePane._renderBar(row);
  assert.ok(barHtml.indexOf('status-done') !== -1, '时间轴父条必须消费派生状态 done，实际生成: ' + barHtml);
  assert.strictEqual(barHtml.indexOf('status-todo'), -1, '时间轴父条不应保留原始 todo 样式类');

  // GanttView 渲染断言：消费派生有效状态
  var ganttApp = helper.createApp([
    'date.js',
    'store.js',
    'history.js',
    'work-calendar.js',
    'progress.js',
    'task-manager.js',
    'tree-view.js',
    'gantt-view.js'
  ]);
  var gTm = ganttApp.get('TaskManager');
  var gView = ganttApp.get('GanttView');
  helper.resetProject(ganttApp);
  var gParent = gTm.addTask(null, '甘特父任务');
  var gChild1 = gTm.addTask(gParent.id, '子任务1');
  var gChild2 = gTm.addTask(gParent.id, '子任务2');
  gTm.updateTask(gChild1.id, { startDate: '2026-01-01', endDate: '2026-01-05', status: 'done', progress: 100 });
  gTm.updateTask(gChild2.id, { startDate: '2026-01-06', endDate: '2026-01-10', status: 'done', progress: 100 });
  assert.strictEqual(gTm.getEffectiveStatus(gParent), 'done');

  var container = {
    innerHTML: '',
    querySelector: function() { return null; },
    addEventListener: function() {}
  };
  gView.init(container);
  gView._buildRows = function() { return [[gParent]]; };
  gView.render();
  assert.ok(container.innerHTML.indexOf('status-done') !== -1, 'GanttView 渲染的父条必须消费派生状态 done，带有 status-done 类名');
  assert.strictEqual(container.innerHTML.indexOf('status-todo'), -1, 'GanttView 渲染的父条不应保留原始 todo 样式类');
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

console.log('\ntimeline: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
