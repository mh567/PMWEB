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
  'column-config.js',
  'baseline.js',
  'grid-pane.js',
  'critical-path.js',
  'timeline-pane.js',
  'workbench.js',
  'app.js'
]);

var App = app.get('App');
var GridPane = app.get('GridPane');
var TimelinePane = app.get('TimelinePane');
var Workbench = app.get('Workbench');
var ViewState = app.get('ViewState');
var TaskManager = app.get('TaskManager');
var DateUtil = app.get('DateUtil');
var History = app.get('History');

App.renderAll = function() {};

function task(id, startDate, endDate, extra) {
  var value = {
    id: id,
    parentId: null,
    name: id,
    description: '',
    assignee: '',
    color: null,
    startDate: startDate,
    endDate: endDate,
    status: 'inProgress',
    progress: 50,
    plannedEndDate: endDate,
    order: 0,
    ganttRow: null
  };
  if (extra) Object.keys(extra).forEach(function(key) { value[key] = extra[key]; });
  return value;
}

function link(id, source, target, lag) {
  return { id: id, source: source, target: target, type: 'FS', lag: lag === undefined ? 1 : lag };
}

function install(tasks, links) {
  helper.installTasks(app, {
    pmweb_version: 3,
    views: [],
    settings: {},
    milestones: [],
    tasks: tasks,
    links: links || []
  });
  TaskManager.history = History.create();
  TaskManager._group = null;
  ViewState.criticalPath = false;
  ViewState.timelineMode = 'gantt';
  ViewState.selectedTaskId = null;
  ViewState.hoveredTaskId = null;
  ViewState.collapsed = new Set();
  Workbench._rows = [];
  Workbench._byId = null;
  Workbench._criticalIds = null;
  Workbench._criticalErrors = [];
  GridPane.setCriticalIds(null);
  TimelinePane.setCriticalIds(null);
  return TaskManager;
}

function gridRow(id, startDate, endDate) {
  return {
    id: id,
    task: task(id, startDate, endDate),
    depth: 0,
    hasChildren: false,
    isCollapsed: false,
    isSummary: false,
    childCount: 0,
    startDate: startDate,
    endDate: endDate
  };
}

function prepareCells() {
  var generated = TimelinePane.generateCells(
    DateUtil.parse('2026-01-05'),
    DateUtil.parse('2026-01-11'),
    'day'
  );
  TimelinePane.cells = generated.cells;
  TimelinePane.cellWidth = generated.cellWidth;
  TimelinePane.parentGroups = generated.parentGroups;
  TimelinePane.selectedTaskId = null;
  TimelinePane.hoveredTaskId = null;
  TimelinePane.setBaseline(null);
}

function fakeDocument() {
  function makeElement(tag) {
    var classes = {};
    return {
      tagName: String(tag || 'div').toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      hidden: false,
      children: [],
      classList: {
        add: function(name) { classes[name] = true; },
        remove: function(name) { delete classes[name]; },
        contains: function(name) { return !!classes[name]; },
        toggle: function(name, force) {
          var on = force === undefined ? !classes[name] : !!force;
          if (on) classes[name] = true;
          else delete classes[name];
          return on;
        }
      },
      setAttribute: function() {},
      appendChild: function(child) { this.children.push(child); return child; },
      insertBefore: function(child) { this.children.push(child); return child; },
      lastChild: function() { return this.children[this.children.length - 1]; }
    };
  }

  var nodes = {
    'status-bar': makeElement('div'),
    'status-info': makeElement('span')
  };

  return {
    nodes: nodes,
    createElement: makeElement,
    getElementById: function(id) {
      return Object.prototype.hasOwnProperty.call(nodes, id) ? nodes[id] : null;
    }
  };
}

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---------- 关键任务 class ----------

test('关键任务在表格行上带 critical class', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b')]);

  GridPane.setCriticalIds(Workbench.setCriticalPath(true) === true
    ? Workbench.getCriticalIds()
    : null);

  var html = GridPane.renderRow(gridRow('a', '2026-01-01', '2026-01-03'), 0, 0);
  assert.ok(html.indexOf('grid-row critical') !== -1, html);
});

test('非关键任务不带 critical class', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06'),
    task('c', '2026-01-04', '2026-01-04')
  ], [link('l1', 'a', 'b'), link('l2', 'a', 'c')]);

  Workbench.setCriticalPath(true);
  GridPane.setCriticalIds(Workbench.getCriticalIds());

  assert.strictEqual(GridPane.isCritical('a'), true);
  assert.strictEqual(GridPane.isCritical('b'), true);
  assert.strictEqual(GridPane.isCritical('c'), false);

  var html = GridPane.renderRow(gridRow('c', '2026-01-04', '2026-01-04'), 2, 0);
  assert.strictEqual(html.indexOf('critical'), -1);
});

test('关键任务的时间轴条带 critical class', function() {
  install([
    task('a', '2026-01-05', '2026-01-07'),
    task('b', '2026-01-08', '2026-01-10')
  ], [link('l1', 'a', 'b')]);

  Workbench.setCriticalPath(true);
  TimelinePane.setCriticalIds(Workbench.getCriticalIds());
  prepareCells();

  var html = TimelinePane._renderBar({
    id: 'a',
    task: task('a', '2026-01-05', '2026-01-07'),
    depth: 0,
    hasChildren: false,
    isCollapsed: false,
    isSummary: false,
    childCount: 0,
    startDate: '2026-01-05',
    endDate: '2026-01-07'
  });

  assert.ok(html.indexOf('gantt-bar') !== -1, html);
  assert.ok(html.indexOf(' critical') !== -1, html);
});

test('关键汇总条同样带 critical class', function() {
  install([task('a', '2026-01-05', '2026-01-07')]);
  Workbench.setCriticalPath(true);
  TimelinePane.setCriticalIds(Workbench.getCriticalIds());
  prepareCells();

  var row = {
    id: 'a',
    task: task('a', '2026-01-05', '2026-01-07'),
    depth: 0,
    hasChildren: true,
    isCollapsed: false,
    isSummary: true,
    childCount: 1,
    startDate: '2026-01-05',
    endDate: '2026-01-07'
  };
  var html = TimelinePane._renderBar(row);

  assert.ok(html.indexOf('gantt-summary-bar') !== -1, html);
  assert.ok(html.indexOf(' critical') !== -1, html);
});

test('时间轴行也跟随关键路径高亮', function() {
  install([task('a', '2026-01-05', '2026-01-07')]);
  Workbench.setCriticalPath(true);
  TimelinePane.setCriticalIds(Workbench.getCriticalIds());
  prepareCells();
  TimelinePane.rows = [gridRow('a', '2026-01-05', '2026-01-07')];

  var html = TimelinePane._renderBody(TimelinePane.cells.length * TimelinePane.cellWidth);
  assert.ok(html.indexOf('timeline-row critical') !== -1, html);
});

// ---------- 关闭与清除 ----------

test('关闭关键路径后两处高亮都被清除', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b')]);

  Workbench.setCriticalPath(true);
  assert.ok(Workbench.getCriticalIds().size > 0);

  Workbench.setCriticalPath(false);

  assert.strictEqual(Workbench.getCriticalIds(), null);
  assert.strictEqual(GridPane.criticalIds, null);
  assert.strictEqual(TimelinePane.criticalIds, null);

  var gridHtml = GridPane.renderRow(gridRow('a', '2026-01-01', '2026-01-03'), 0, 0);
  assert.strictEqual(gridHtml.indexOf('critical'), -1);
});

test('无关键路径时集合为空且渲染不带 class', function() {
  install([task('a', null, null)]);
  Workbench.setCriticalPath(true);

  assert.strictEqual(Workbench.getCriticalIds().size, 0);
  var html = GridPane.renderRow(gridRow('a', '2026-01-01', '2026-01-02'), 0, 0);
  assert.strictEqual(html.indexOf('critical'), -1);
});

test('依赖或日期变化后重算关键路径', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b')]);

  Workbench.setCriticalPath(true);
  assert.strictEqual(Workbench.isCritical('b'), true);

  TaskManager.updateTask('b', { startDate: '2026-01-10', endDate: '2026-01-20' });
  Workbench.render();

  assert.strictEqual(Workbench.isCritical('a'), false);
  assert.strictEqual(Workbench.isCritical('b'), true);
});

// ---------- 环错误 ----------

test('存在环路时关键路径返回 CYCLE 且没有关键任务', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b'), link('l2', 'b', 'a')]);

  var set = Workbench.setCriticalPath(true);
  assert.strictEqual(set, true);
  assert.strictEqual(Workbench.getCriticalIds().size, 0);

  var codes = Workbench.getCriticalErrors().map(function(error) { return error.code; });
  assert.ok(codes.indexOf('CYCLE') !== -1);
});

test('开启关键路径遇到环路时状态栏给出错误提示', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b'), link('l2', 'b', 'a')]);

  var doc = fakeDocument();
  app.context.document = doc;
  try {
    App.toggleCriticalPath();
    var message = doc.nodes['status-bar'].lastChild();
    assert.ok(message, '应创建状态栏消息节点');
    assert.ok(message.textContent.indexOf('关键路径') === 0, message.textContent);
    assert.ok(message.textContent.indexOf('环路') !== -1, message.textContent);
    assert.strictEqual(message.classList.contains('is-error'), true);
  } finally {
    delete app.context.document;
  }
});

test('关闭关键路径时清空状态栏提示', function() {
  install([task('a', '2026-01-01', '2026-01-03')]);

  var doc = fakeDocument();
  app.context.document = doc;
  try {
    App.toggleCriticalPath();
    var on = doc.nodes['status-bar'].lastChild();
    assert.ok(on.textContent.indexOf('关键路径已开启') === 0, on.textContent);

    App.toggleCriticalPath();
    var off = doc.nodes['status-bar'].lastChild();
    assert.strictEqual(off.textContent, '');
    assert.strictEqual(off.hidden, true);
  } finally {
    delete app.context.document;
  }
});

// ---------- 开关持久化 ----------

test('开关状态写入设置并可恢复', function() {
  install([task('a', '2026-01-01', '2026-01-03')]);

  app.context.document = fakeDocument();
  try {
    App.toggleCriticalPath();
  } finally {
    delete app.context.document;
  }

  assert.strictEqual(TaskManager.getSetting('criticalPath'), true);
  assert.strictEqual(ViewState.criticalPath, true);

  ViewState.criticalPath = false;
  assert.strictEqual(App._restoreCriticalPath(), true);
  assert.strictEqual(ViewState.criticalPath, true);
});

test('未保存过开关时默认关闭', function() {
  install([task('a', '2026-01-01', '2026-01-03')]);
  assert.strictEqual(App._restoreCriticalPath(), false);
  assert.strictEqual(ViewState.criticalPath, false);
});

test('setCriticalPath 同步设置范围外的重复调用保持幂等', function() {
  install([task('a', '2026-01-01', '2026-01-03')]);
  Workbench.setCriticalPath(true);
  var first = Workbench.getCriticalIds().size;
  Workbench.setCriticalPath(true);
  assert.strictEqual(Workbench.getCriticalIds().size, first);
  assert.strictEqual(ViewState.criticalPath, true);
});

// ---------- 高亮跟随选中与筛选 ----------

test('选中和筛选变化后 critical class 仍然保留', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b')]);

  Workbench.setCriticalPath(true);
  ViewState.selectedTaskId = 'a';
  GridPane.selectedId = null;
  GridPane.selection = new Set();

  var html = GridPane.renderRow(gridRow('b', '2026-01-04', '2026-01-06'), 1, 0);
  assert.ok(html.indexOf(' critical') !== -1, html);

  ViewState.statusFilter.done = false;
  Workbench.render();
  assert.strictEqual(Workbench.isCritical('b'), true);
  ViewState.statusFilter.done = true;
});

test('关闭筛选后重算不会丢失关键任务集合', function() {
  install([
    task('a', '2026-01-01', '2026-01-03', { status: 'done' }),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b')]);

  Workbench.setCriticalPath(true);
  var ids = Workbench.getCriticalIds();
  assert.strictEqual(ids.has('a'), true);
  assert.strictEqual(ids.has('b'), true);
});

// ---------- 锁定标记 ----------

test('锁定任务在表格和提示中带锁标记', function() {
  install([task('a', '2026-01-01', '2026-01-03', { locked: true })]);

  var html = GridPane.renderRow({
    id: 'a',
    task: task('a', '2026-01-01', '2026-01-03', { locked: true }),
    depth: 0,
    hasChildren: false,
    isCollapsed: false,
    isSummary: false,
    childCount: 0,
    startDate: '2026-01-01',
    endDate: '2026-01-03'
  }, 0, 0);

  assert.ok(html.indexOf('grid-lock-badge') !== -1, html);
  assert.ok(html.indexOf('自动排期将跳过该任务') !== -1, html);
});

test('未锁定任务不带锁标记', function() {
  install([task('a', '2026-01-01', '2026-01-03')]);

  var html = GridPane.renderRow(gridRow('a', '2026-01-01', '2026-01-03'), 0, 0);
  assert.strictEqual(html.indexOf('grid-lock-badge'), -1);
});

test('时间轴提示标注已锁定', function() {
  install([task('a', '2026-01-05', '2026-01-07', { locked: true })]);
  prepareCells();

  var html = TimelinePane._renderBar({
    id: 'a',
    task: task('a', '2026-01-05', '2026-01-07', { locked: true }),
    depth: 0,
    hasChildren: false,
    isCollapsed: false,
    isSummary: false,
    childCount: 0,
    startDate: '2026-01-05',
    endDate: '2026-01-07'
  });

  assert.ok(html.indexOf('已锁定') !== -1, html);
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

console.log('\ncritical-path-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
