'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'workbench.js']);
var Workbench = app.get('Workbench');
var ViewState = app.get('ViewState');

// 用桩替代真实面板与行模型，只验证 workbench 的纯逻辑与转发。
app.run([
  'var _wbRows = [];',
  'var _wbById = new Map();',
  'var _wbBuildOptions = null;',
  'var _wbGridCalls = [];',
  'var _wbTimelineCalls = [];',
  'var _wbWindowCalls = 0;',
  'var setTimeout = function(callback) { return 0; };',
  'var GridPane = {',
  '  init: function() {},',
  '  render: function(rows) { _wbGridCalls.push(rows); },',
  '  updateSelection: function() {},',
  '  updateHover: function() {},',
  '  syncHeader: function() {}',
  '};',
  'var TimelinePane = {',
  '  init: function() {},',
  '  render: function(rows) { _wbTimelineCalls.push(rows); },',
  '  updateSelection: function() {},',
  '  updateHover: function() {},',
  '  syncHeader: function() {},',
  '  setGranularity: function() {},',
  '  scheduleWindowUpdate: function() { _wbWindowCalls++; },',
  '  refreshWindow: function() { _wbWindowCalls++; }',
  '};',
  'var RowModel = {',
  '  build: function(options) {',
  '    _wbBuildOptions = options;',
  '    return { rows: _wbRows, byId: _wbById };',
  '  }',
  '};'
].join('\n'));

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function resetWorkbench() {
  app.run('_wbRows = []; _wbById = new Map(); _wbBuildOptions = null; _wbGridCalls = []; _wbTimelineCalls = []; _wbWindowCalls = 0;');
  Workbench._els = null;
  ViewState.timelineMode = 'gantt';
  ViewState.selectedTaskId = null;
  ViewState.hoveredTaskId = null;
  ViewState.collapsed = new Set();
  Workbench._rows = [];
  Workbench._byId = null;
  Workbench._syncing = false;
  Workbench._rafId = 0;
}

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('分割条宽度下限固定为 320', function() {
  assert.strictEqual(Workbench.clampGridWidth(100, 1000), 320);
  assert.strictEqual(Workbench.clampGridWidth(-500, 1000), 320);
  assert.strictEqual(Workbench.clampGridWidth(0, 2000), 320);
});

test('分割条宽度上限为容器 60%', function() {
  assert.strictEqual(Workbench.maxGridWidth(1000), 600);
  assert.strictEqual(Workbench.clampGridWidth(900, 1000), 600);
  assert.strictEqual(Workbench.clampGridWidth(1400, 2000), 1200);
});

test('容器过窄时下限优先于 60% 上限', function() {
  assert.strictEqual(Workbench.maxGridWidth(400), 320);
  assert.strictEqual(Workbench.clampGridWidth(560, 400), 320);
  assert.strictEqual(Workbench.clampGridWidth(560, 0), 320);
});

test('容器宽度未知时使用默认宽度', function() {
  assert.strictEqual(Workbench.clampGridWidth(NaN, 1000), Workbench.DEFAULT_GRID_WIDTH);
  assert.strictEqual(Workbench.DEFAULT_GRID_WIDTH, 560);
});

test('分割条宽度取整不越界', function() {
  assert.strictEqual(Workbench.clampGridWidth(559.6, 1000), 559.6);
  assert.strictEqual(Workbench.clampGridWidth(321, 1000), 321);
});

test('滚动同步直接映射 scrollTop 并钳制到目标最大值', function() {
  assert.strictEqual(Workbench.computeScrollTop(120, 500), 120);
  assert.strictEqual(Workbench.computeScrollTop(700, 500), 500);
  assert.strictEqual(Workbench.computeScrollTop(500, 500), 500);
});

test('滚动同步对负值和非法值做保护', function() {
  assert.strictEqual(Workbench.computeScrollTop(-10, 500), 0);
  assert.strictEqual(Workbench.computeScrollTop(NaN, 500), 0);
  assert.strictEqual(Workbench.computeScrollTop(100, -1), 0);
  assert.strictEqual(Workbench.computeScrollTop(100, NaN), 0);
});

test('折叠集合切换父任务', function() {
  resetWorkbench();
  Workbench._byId = new Map([['P', { id: 'P', hasChildren: true }]]);

  assert.strictEqual(Workbench.toggleCollapsed('P'), true);
  assert.strictEqual(ViewState.collapsed.has('P'), true);

  assert.strictEqual(Workbench.toggleCollapsed('P'), false);
  assert.strictEqual(ViewState.collapsed.has('P'), false);
});

test('折叠叶子任务无效果', function() {
  resetWorkbench();
  Workbench._byId = new Map([['L', { id: 'L', hasChildren: false }]]);

  assert.strictEqual(Workbench.toggleCollapsed('L'), false);
  assert.strictEqual(ViewState.collapsed.has('L'), false);
});

test('折叠空任务 ID 不抛错', function() {
  resetWorkbench();
  assert.strictEqual(Workbench.toggleCollapsed(''), false);
  assert.strictEqual(Workbench.toggleCollapsed(null), false);
  assert.strictEqual(ViewState.collapsed.size, 0);
});

test('render 使用 RowModel 结果并同时传给两栏', function() {
  resetWorkbench();
  var rows = [
    { id: 'A', task: { name: 'A' }, depth: 0, hasChildren: true, isCollapsed: false, isSummary: true, childCount: 1, startDate: '2026-01-01', endDate: '2026-01-31' },
    { id: 'A1', task: { name: 'A1' }, depth: 1, hasChildren: false, isCollapsed: false, isSummary: false, childCount: 0, startDate: '2026-01-01', endDate: '2026-01-10' }
  ];
  app.run('_wbRows = ' + JSON.stringify(rows) + '; _wbById = new Map();');

  Workbench.render();

  assert.strictEqual(app.run('_wbBuildOptions.collapsed'), ViewState.collapsed);
  assert.strictEqual(app.run('_wbBuildOptions.statusFilter'), ViewState.statusFilter);
  assert.strictEqual(app.run('_wbGridCalls.length'), 1);
  assert.strictEqual(app.run('_wbTimelineCalls.length'), 1);
  assert.deepStrictEqual(plain(app.run('_wbGridCalls[0]')), rows);
  assert.deepStrictEqual(plain(app.run('_wbTimelineCalls[0]')), rows);
});

test('render 后重新应用选中和 hover', function() {
  resetWorkbench();
  ViewState.selectedTaskId = 'A1';
  ViewState.hoveredTaskId = 'A';
  var calls = [];
  app.run('GridPane.updateSelection = function(id) { _wbCalls.push(["select", id]); };');
  app.run('GridPane.updateHover = function(id) { _wbCalls.push(["hover", id]); };');
  app.run('var _wbCalls = [];');

  Workbench.render();

  calls = plain(app.run('_wbCalls'));
  assert.deepStrictEqual(calls, [['select', 'A1'], ['hover', 'A']]);
});

test('表格滚动同步后通知时间轴刷新可视窗口', function() {
  resetWorkbench();
  var source = { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 };
  var timelineBody = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
  var gridBody = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
  Workbench._els = { gridBody: gridBody, timelineBody: timelineBody };

  Workbench._syncScroll(source, timelineBody);

  assert.strictEqual(timelineBody.scrollTop, 200);
  assert.strictEqual(app.run('_wbWindowCalls'), 1);
});

test('时间轴作为滚动来源时不重复通知自身窗口', function() {
  resetWorkbench();
  var source = { scrollTop: 160, scrollHeight: 1000, clientHeight: 400 };
  var timelineBody = { scrollTop: 160, scrollHeight: 1000, clientHeight: 400 };
  var gridBody = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
  Workbench._els = { gridBody: gridBody, timelineBody: timelineBody };

  Workbench._syncScroll(source, gridBody);

  assert.strictEqual(gridBody.scrollTop, 160);
  assert.strictEqual(app.run('_wbWindowCalls'), 0);
});

test('恢复滚动位置后通知时间轴刷新可视窗口', function() {
  resetWorkbench();
  var timelineBody = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
  var gridBody = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
  Workbench._els = { gridBody: gridBody, timelineBody: timelineBody };
  Workbench._syncing = false;

  Workbench._restoreScrollTop(320);

  assert.strictEqual(timelineBody.scrollTop, 320);
  assert.strictEqual(gridBody.scrollTop, 320);
  assert.strictEqual(app.run('_wbWindowCalls'), 1);
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

console.log('\nworkbench: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
