'use strict';

// 时间轴可视窗口的纯函数与切片渲染测试，不依赖 DOM。
var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'timeline-pane.js']);
var TimelinePane = app.get('TimelinePane');
var DateUtil = app.get('DateUtil');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function prepareRows(count) {
  var rows = [];
  for (var i = 0; i < count; i++) {
    rows.push({ id: 'r' + i, task: { name: 'r' + i }, startDate: null, endDate: null });
  }
  return rows;
}

function preparePane(rows) {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-01-11'),
    'day'
  );
  TimelinePane.cells = generated.cells;
  TimelinePane.cellWidth = generated.cellWidth;
  TimelinePane.parentGroups = generated.parentGroups;
  TimelinePane.rows = rows;
  TimelinePane.selectedTaskId = null;
  TimelinePane.hoveredTaskId = null;
  TimelinePane.baselineById = null;
  TimelinePane.criticalIds = null;
  TimelinePane._cellsHtml = null;
  TimelinePane._cellsHtmlCells = null;
  TimelinePane._cellsHtmlWidth = 0;
  return generated;
}

// ---------- 窗口计算 ----------

test('顶部窗口从首行开始并包含 overscan', function() {
  var win = TimelinePane.computeWindow(0, 400, 40, 200, 3);
  assert.strictEqual(win.start, 0);
  assert.strictEqual(win.end, 13);
  assert.strictEqual(win.offsetTop, 0);
  assert.strictEqual(win.totalHeight, 8000);
  assert.strictEqual(win.rowHeight, 40);
});

test('中部滚动窗口前后各留 overscan 行', function() {
  var win = TimelinePane.computeWindow(400, 400, 40, 200, 3);
  assert.strictEqual(win.start, 7);
  assert.strictEqual(win.end, 23);
  assert.strictEqual(win.offsetTop, 280);
});

test('滚到底部时窗口收敛到最后一行', function() {
  var win = TimelinePane.computeWindow(99999, 400, 40, 200, 3);
  assert.strictEqual(win.start, 187);
  assert.strictEqual(win.end, 200);
  assert.strictEqual(win.totalHeight, 8000);
});

test('内容少于视口时渲染全部行', function() {
  var win = TimelinePane.computeWindow(0, 1000, 40, 5, 3);
  assert.strictEqual(win.start, 0);
  assert.strictEqual(win.end, 5);
});

test('空数据返回空窗口和零高度', function() {
  var win = TimelinePane.computeWindow(120, 400, 40, 0, 3);
  assert.strictEqual(win.start, 0);
  assert.strictEqual(win.end, 0);
  assert.strictEqual(win.offsetTop, 0);
  assert.strictEqual(win.totalHeight, 0);
  assert.strictEqual(win.rowHeight, 40);
});

test('视口高度为 0 时至少渲染一行', function() {
  var win = TimelinePane.computeWindow(80, 0, 40, 10, 0);
  assert.strictEqual(win.start, 2);
  assert.strictEqual(win.end, 3);
});

test('非法输入回退到安全默认值', function() {
  var win = TimelinePane.computeWindow(NaN, NaN, 0, 10, -2);
  assert.strictEqual(win.start, 0);
  assert.strictEqual(win.end, 1);
  assert.strictEqual(win.totalHeight, 400);
  assert.strictEqual(win.rowHeight, 40);

  var negative = TimelinePane.computeWindow(-50, 400, 40, 10, 3);
  assert.strictEqual(negative.start, 0);
  assert.strictEqual(negative.end, 10);
});

test('负行数视为空数据', function() {
  var win = TimelinePane.computeWindow(0, 100, 40, -5, 3);
  assert.strictEqual(win.end, 0);
  assert.strictEqual(win.totalHeight, 0);
});

test('overscan 大于行数时被收敛', function() {
  var win = TimelinePane.computeWindow(0, 40, 40, 3, 50);
  assert.strictEqual(win.start, 0);
  assert.strictEqual(win.end, 3);
});

test('总高度始终等于行数乘行高', function() {
  [0, 1, 5, 200, 1000].forEach(function(count) {
    var win = TimelinePane.computeWindow(0, 400, 40, count, 3);
    assert.strictEqual(win.totalHeight, count * 40);
  });
});

// ---------- 行切片 ----------

test('windowRows 返回左闭右开区间内的行', function() {
  var rows = prepareRows(10);
  var win = { start: 3, end: 6 };
  var sliced = TimelinePane.windowRows(rows, win);
  assert.deepStrictEqual(sliced.map(function(row) { return row.id; }), ['r3', 'r4', 'r5']);
});

test('windowRows 对越界和非法窗口返回空数组', function() {
  var rows = prepareRows(5);
  assert.strictEqual(TimelinePane.windowRows(rows, { start: 5, end: 9 }).length, 0);
  assert.strictEqual(TimelinePane.windowRows(rows, { start: 3, end: 2 }).length, 0);
  assert.strictEqual(TimelinePane.windowRows(rows, null).length, 0);
  assert.strictEqual(TimelinePane.windowRows(null, { start: 0, end: 2 }).length, 0);
});

// ---------- 切片渲染 ----------

test('切片渲染只输出窗口内行并按绝对行号定位', function() {
  var rows = prepareRows(30);
  preparePane(rows);
  var html = TimelinePane._renderRowsHtml(10, 13, 270);

  assert.strictEqual(countOccurrences(html, 'class="timeline-row'), 3);
  assert.ok(html.indexOf('data-row-index="10" style="top:400px') !== -1, html);
  assert.ok(html.indexOf('data-row-index="12" style="top:480px') !== -1, html);
  assert.strictEqual(html.indexOf('data-row-index="9"'), -1);
  assert.strictEqual(html.indexOf('data-row-index="13"'), -1);
});

test('切片越界时返回空字符串', function() {
  preparePane(prepareRows(3));
  assert.strictEqual(TimelinePane._renderRowsHtml(5, 9, 270), '');
  assert.strictEqual(TimelinePane._renderRowsHtml(2, 2, 270), '');
});

test('日期网格单元缓存随单元格集合变化失效', function() {
  preparePane(prepareRows(2));
  var first = TimelinePane._gridCellsHtml();
  assert.strictEqual(TimelinePane._gridCellsHtml(), first);

  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-02-02'),
    DateUtil.parse('2026-02-05'),
    'day'
  );
  TimelinePane.cells = generated.cells;
  TimelinePane.cellWidth = generated.cellWidth;
  var second = TimelinePane._gridCellsHtml();

  assert.notStrictEqual(second, first);
  assert.strictEqual(countOccurrences(second, 'timeline-grid-cell'), 4);
});

test('结构渲染固定内容总高度且不包含行节点', function() {
  preparePane(prepareRows(20));
  var html = TimelinePane._renderBodyShell(270);

  assert.ok(html.indexOf('timeline-content') !== -1, html);
  assert.ok(html.indexOf('height:800px') !== -1, html);
  assert.ok(html.indexOf('class="timeline-rows"') !== -1, html);
  assert.strictEqual(html.indexOf('data-row-index'), -1);
  assert.strictEqual(html.indexOf('data-task-id'), -1);
});

test('全量渲染保留所有行，行为不变', function() {
  var rows = prepareRows(30);
  preparePane(rows);
  var html = TimelinePane._renderBody(270);

  assert.strictEqual(countOccurrences(html, 'class="timeline-row'), 30);
  assert.strictEqual(countOccurrences(html, 'data-row-index="'), 30);
});

test('窗口切换后选中态仍然写进行节点', function() {
  var rows = prepareRows(30);
  preparePane(rows);
  TimelinePane.selectedTaskId = 'r20';
  TimelinePane.hoveredTaskId = 'r21';

  var html = TimelinePane._renderRowsHtml(18, 24, 270);
  assert.ok(html.indexOf('timeline-row selected') !== -1, html);
  assert.ok(html.indexOf('timeline-row hovered') !== -1, html);
  assert.strictEqual(html.indexOf('data-task-id="r17"'), -1);
  assert.strictEqual(html.indexOf('data-task-id="r24"'), -1);
});

// ---------- 1000 行超大数据集性能基准 ----------

test('1000 行数据集可视窗口切片与切片渲染耗时在预算内', function() {
  var rows = prepareRows(1000);
  preparePane(rows);

  var t0 = Date.now();
  for (var i = 0; i < 50; i++) {
    var win = TimelinePane.computeWindow(i * 40, 600, 40, 1000, 3);
    var sliced = TimelinePane.windowRows(rows, win);
    assert.strictEqual(sliced.length, win.end - win.start);
  }
  var sliceElapsed = Date.now() - t0;
  assert.ok(sliceElapsed < 50, '50 次窗口切片耗时应小于 50ms (实测: ' + sliceElapsed + 'ms)');

  var t1 = Date.now();
  var html = TimelinePane._renderRowsHtml(200, 225, 270);
  var renderElapsed = Date.now() - t1;
  assert.strictEqual(countOccurrences(html, 'class="timeline-row'), 25);
  assert.ok(renderElapsed < 25, '1000 行中切片渲染 25 行耗时应小于 25ms (实测: ' + renderElapsed + 'ms)');
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

console.log('\nperformance: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
