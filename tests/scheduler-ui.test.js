'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'work-calendar.js',
  'links.js',
  'task-manager.js',
  'scheduler.js',
  'critical-path.js',
  'app.js'
]);

var App = app.get('App');
var TaskManager = app.get('TaskManager');
var History = app.get('History');

// app.js 只在这些函数里访问 DOM，未注入 document 时自动跳过提示
App.renderAll = function() {};

function plain(value) { return JSON.parse(JSON.stringify(value)); }

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

function link(id, source, target, type, lag) {
  return { id: id, source: source, target: target, type: type || 'FS', lag: lag === undefined ? 1 : lag };
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
  return TaskManager;
}

function current(id) {
  var value = TaskManager.getTask(id);
  return value.startDate + '~' + value.endDate;
}

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---------- 排期结果应用 ----------

test('buildSchedule 按依赖算出新日期并列出变更任务', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03')
  ], [link('l1', 'a', 'b', 'FS', 1)]);

  var preview = App.buildSchedule();

  assert.strictEqual(preview.errors.length, 0);
  assert.strictEqual(preview.changed.length, 1);
  assert.strictEqual(preview.changed[0].id, 'b');
  assert.strictEqual(preview.changed[0].startDate, '2026-01-04');
  assert.strictEqual(preview.changed[0].endDate, '2026-01-06');
  assert.strictEqual(preview.changed[0].name, 'b');
});

test('buildSchedule 只计算不写回', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03')
  ], [link('l1', 'a', 'b', 'FS', 1)]);

  App.buildSchedule();
  assert.strictEqual(current('b'), '2026-01-01~2026-01-03');
  assert.strictEqual(TaskManager.canUndo(), false);
});

test('applySchedule 写回日期并返回更新数量', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03')
  ], [link('l1', 'a', 'b', 'FS', 1)]);

  var preview = App.buildSchedule();
  var applied = App.applySchedule(preview.changed);

  assert.strictEqual(applied, 1);
  assert.strictEqual(current('b'), '2026-01-04~2026-01-06');
  assert.strictEqual(current('a'), '2026-01-01~2026-01-03');
});

test('自动排期整批只产生一条历史记录，撤销一次全部还原', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03'),
    task('c', '2026-01-01', '2026-01-03')
  ], [link('l1', 'a', 'b', 'FS', 1), link('l2', 'b', 'c', 'FS', 1)]);

  App.applySchedule(App.buildSchedule().changed);

  assert.strictEqual(current('b'), '2026-01-04~2026-01-06');
  assert.strictEqual(current('c'), '2026-01-07~2026-01-09');
  assert.strictEqual(TaskManager.history.size(), 1);

  TaskManager.undo();
  assert.strictEqual(current('b'), '2026-01-01~2026-01-03');
  assert.strictEqual(current('c'), '2026-01-01~2026-01-03');

  TaskManager.redo();
  assert.strictEqual(current('b'), '2026-01-04~2026-01-06');
  assert.strictEqual(current('c'), '2026-01-07~2026-01-09');
  assert.strictEqual(TaskManager.history.size(), 1);
});

test('自动排期与后续手动编辑各自独立撤销', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03')
  ], [link('l1', 'a', 'b', 'FS', 1)]);

  App.applySchedule(App.buildSchedule().changed);
  TaskManager.updateTask('a', { name: '改名后' });

  assert.strictEqual(TaskManager.history.size(), 2);
  TaskManager.undo();
  assert.strictEqual(TaskManager.getTask('a').name, 'a');
  assert.strictEqual(current('b'), '2026-01-04~2026-01-06');
  TaskManager.undo();
  assert.strictEqual(current('b'), '2026-01-01~2026-01-03');
});

// ---------- 锁定任务 ----------

test('锁定任务不参与自动排期但仍约束后继', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-02', { locked: true }),
    task('c', '2026-01-01', '2026-01-01')
  ], [link('l1', 'a', 'b', 'FS', 1), link('l2', 'b', 'c', 'FS', 1)]);

  var preview = App.buildSchedule();
  var changedIds = preview.changed.map(function(item) { return item.id; });

  assert.strictEqual(changedIds.indexOf('b'), -1);
  assert.ok(changedIds.indexOf('c') !== -1);

  App.applySchedule(preview.changed);

  assert.strictEqual(current('b'), '2026-01-01~2026-01-02');
  assert.strictEqual(current('c'), '2026-01-03~2026-01-03');
});

test('locked 字段通过 updateTask 写入并可撤销', function() {
  install([task('a', '2026-01-01', '2026-01-03')]);

  TaskManager.updateTask('a', { locked: true });
  assert.strictEqual(TaskManager.getTask('a').locked, true);
  assert.strictEqual(TaskManager.isTaskLocked(TaskManager.getTask('a')), true);

  TaskManager.undo();
  assert.ok(!TaskManager.getTask('a').locked);
  assert.strictEqual(TaskManager.isTaskLocked(TaskManager.getTask('a')), false);
});

test('解锁后任务重新参与自动排期', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03', { locked: true })
  ], [link('l1', 'a', 'b', 'FS', 1)]);

  assert.strictEqual(App.buildSchedule().changed.length, 0);

  TaskManager.updateTask('b', { locked: false });
  var preview = App.buildSchedule();

  assert.strictEqual(preview.changed.length, 1);
  assert.strictEqual(preview.changed[0].startDate, '2026-01-04');
});

test('新建任务默认未锁定', function() {
  install([]);
  var created = TaskManager.addTask(null, '新任务');
  assert.strictEqual(created.locked, false);
});

// ---------- 错误提示 ----------

test('存在环路时排期返回 CYCLE 且不写回', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b', 'FS', 1), link('l2', 'b', 'a', 'FS', 1)]);

  var preview = App.buildSchedule();
  var codes = preview.errors.map(function(error) { return error.code; });

  assert.ok(codes.indexOf('CYCLE') !== -1);
  assert.strictEqual(preview.changed.length, 0);
  assert.strictEqual(current('a'), '2026-01-01~2026-01-03');
  assert.strictEqual(current('b'), '2026-01-04~2026-01-06');
  assert.strictEqual(TaskManager.canUndo(), false);
});

test('autoSchedule 遇到环路时不调用写回', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b', 'FS', 1), link('l2', 'b', 'a', 'FS', 1)]);

  var result = App.autoSchedule();

  assert.ok(result.errors.some(function(error) { return error.code === 'CYCLE'; }));
  assert.strictEqual(TaskManager.canUndo(), false);
});

test('无依赖时排期不产生变更', function() {
  install([task('a', '2026-01-01', '2026-01-03')]);
  var preview = App.buildSchedule();
  assert.strictEqual(preview.changed.length, 0);
  assert.strictEqual(preview.errors.length, 0);
});

// ---------- 工作日历 ----------

test('配置工作日历后自动排期跨周末推进', function() {
  install([
    task('a', '2025-12-31', '2026-01-02'),
    task('b', '2025-12-30', '2026-01-01')
  ], [link('l1', 'a', 'b', 'FS', 1)]);
  TaskManager.setWorkCalendar({ weekends: [0, 6] });

  var preview = App.buildSchedule();
  assert.strictEqual(preview.changed[0].startDate, '2026-01-05');
  assert.strictEqual(preview.changed[0].endDate, '2026-01-07');
});

test('未配置工作日历时按自然日推进', function() {
  install([
    task('a', '2025-12-31', '2026-01-02'),
    task('b', '2025-12-30', '2026-01-01')
  ], [link('l1', 'a', 'b', 'FS', 1)]);

  assert.strictEqual(TaskManager.getSchedulerConfig(), null);
  var preview = App.buildSchedule();
  assert.strictEqual(preview.changed[0].startDate, '2026-01-03');
});

// ---------- 状态栏提示 ----------

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
      getAttribute: function() { return null; },
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

test('成功排期后在状态栏显示更新数量', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-01', '2026-01-03')
  ], [link('l1', 'a', 'b', 'FS', 1)]);

  var doc = fakeDocument();
  app.context.document = doc;
  try {
    App.autoSchedule();
    var message = doc.nodes['status-bar'].lastChild();
    assert.ok(message, '应创建状态栏消息节点');
    assert.strictEqual(message.textContent, '自动排期完成：更新 1 个任务');
    assert.strictEqual(message.hidden, false);
    assert.strictEqual(message.classList.contains('is-error'), false);
  } finally {
    delete app.context.document;
  }
});

test('环路错误在状态栏用错误样式显示', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b', 'FS', 1), link('l2', 'b', 'a', 'FS', 1)]);

  var doc = fakeDocument();
  app.context.document = doc;
  try {
    App.autoSchedule();
    var message = doc.nodes['status-bar'].lastChild();
    assert.ok(message, '应创建状态栏消息节点');
    assert.ok(message.textContent.indexOf('自动排期失败') === 0, message.textContent);
    assert.ok(message.textContent.indexOf('环路') !== -1, message.textContent);
    assert.strictEqual(message.classList.contains('is-error'), true);
  } finally {
    delete app.context.document;
  }
});

test('无变更时状态栏说明日期已满足依赖', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', '2026-01-04', '2026-01-06')
  ], [link('l1', 'a', 'b', 'FS', 1)]);

  var doc = fakeDocument();
  app.context.document = doc;
  try {
    App.autoSchedule();
    var message = doc.nodes['status-bar'].lastChild();
    assert.strictEqual(message.textContent, '自动排期完成：日期已满足依赖，无需调整');
    assert.strictEqual(message.hidden, false);
  } finally {
    delete app.context.document;
  }
});

test('存在 MISSING_DATE 时仍写回可排期任务并提示', function() {
  install([
    task('a', '2026-01-01', '2026-01-03'),
    task('b', null, null),
    task('c', '2026-01-01', '2026-01-02')
  ], [link('l1', 'a', 'c', 'FS', 1), link('l2', 'b', 'c', 'FS', 1)]);

  var doc = fakeDocument();
  app.context.document = doc;
  try {
    App.autoSchedule();
    var message = doc.nodes['status-bar'].lastChild();
    assert.ok(message.textContent.indexOf('自动排期完成：更新 1 个任务') === 0, message.textContent);
    assert.strictEqual(message.classList.contains('is-warning'), true);
  } finally {
    delete app.context.document;
  }
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

console.log('\nscheduler-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
