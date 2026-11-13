'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var schema = require('../js/validate.js');
var validateData = schema.validateData;
var isValidId = schema.isValidId;

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.log('FAIL ' + name);
    console.log('  ' + (error && error.message ? error.message : error));
  }
}

var XSS_ID = 'x"><img src=x onerror="window.__xss=1">';
var SELECTOR_ID = 'x2"] , .gantt-bar';

function baseData() {
  return {
    pmweb_version: 3,
    tasks: [
      {
        id: 'root-1', parentId: null, name: 'Root', status: 'inProgress',
        startDate: '2026-01-01', endDate: '2026-01-20', order: 0,
        progress: 40, plannedEndDate: '2026-01-20'
      },
      {
        id: 'child-1', parentId: 'root-1', name: 'Child', status: 'done',
        startDate: '2026-01-02', endDate: '2026-01-10', order: 0,
        progress: 100, plannedEndDate: null
      }
    ],
    milestones: [
      { id: 'ms-1', taskId: 'child-1', name: 'M1', date: '2026-01-05', status: 'pending' }
    ],
    links: [],
    views: [],
    settings: { statusFilter: { inProgress: true, thirdParty: true, done: true } }
  };
}

test('合法 ID 通过白名单', function() {
  assert.strictEqual(isValidId('abc-123_X'), true);
  assert.strictEqual(isValidId('t1'), true);
  assert.strictEqual(isValidId(''), false);
  assert.strictEqual(isValidId('has space'), false);
  assert.strictEqual(isValidId('has"quote'), false);
  assert.strictEqual(isValidId(new Array(130).join('a')), false);
});

test('合法 v3 数据通过校验', function() {
  var result = validateData(baseData());
  assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
});

test('任务 ID 含 HTML 时校验失败', function() {
  var data = baseData();
  data.tasks[0].id = XSS_ID;
  var result = validateData(data);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(function(error) {
    return error.path === 'tasks[0].id' && /A-Za-z0-9_-/.test(error.message);
  }), JSON.stringify(result.errors));
});

test('里程碑 ID 含 HTML 时校验失败', function() {
  var data = baseData();
  data.milestones[0].id = XSS_ID;
  var result = validateData(data);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(function(error) {
    return error.path === 'milestones[0].id';
  }), JSON.stringify(result.errors));
});

test('parentId 含引号时校验失败', function() {
  var data = baseData();
  data.tasks[1].parentId = SELECTOR_ID;
  var result = validateData(data);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(function(error) {
    return error.path === 'tasks[1].parentId';
  }), JSON.stringify(result.errors));
});

test('导入数据校验返回明确错误路径', function() {
  var app = helper.createApp(['validate.js', 'store.js']);
  var DataStore = app.get('DataStore');
  var data = baseData();
  data.tasks[0].id = XSS_ID;
  var checked = DataStore.validateImportData(data);
  assert.strictEqual(checked.valid, false);
  var message = DataStore._formatValidationError(checked.errors);
  assert.ok(message.indexOf('tasks[0].id') !== -1, message);
  assert.ok(message.indexOf('导入失败') !== -1, message);
});

test('localStorage 中的非法 ID 在加载时被重写', function() {
  var app = helper.createApp(['validate.js', 'store.js']);
  var DataStore = app.get('DataStore');
  var data = baseData();
  data.tasks[0].id = XSS_ID;
  data.tasks[1].parentId = XSS_ID;
  data.milestones[0].taskId = XSS_ID;
  data.milestones[0].id = XSS_ID;
  app.localStorage.setItem(DataStore.STORAGE_KEY, JSON.stringify(data));

  var loaded = DataStore.load();
  var project = (loaded && loaded.data && loaded.data.projects && loaded.data.projects[0]) ? loaded.data.projects[0].data : loaded;
  assert.strictEqual(project.tasks.length, 2);
  project.tasks.forEach(function(task) {
    assert.ok(isValidId(task.id), 'invalid task id: ' + task.id);
  });
  assert.ok(isValidId(project.milestones[0].id), 'invalid milestone id: ' + project.milestones[0].id);
  assert.strictEqual(project.tasks[1].parentId, project.tasks[0].id);
  assert.strictEqual(project.milestones[0].taskId, project.tasks[0].id);
  assert.ok(JSON.stringify(loaded).indexOf('<img') === -1);
});

test('渲染转义函数不产生标签', function() {
  var app = helper.createApp(['tree-view.js', 'timeline-pane.js', 'grid-pane.js']);
  var escapedHtml = app.run('_escapeHtml')(XSS_ID);
  var escapedTimeline = app.run('_timelineEscape')(XSS_ID);
  var GridPane = app.get('GridPane');
  var escapedGrid = GridPane.escapeHtml(XSS_ID);
  [escapedHtml, escapedTimeline, escapedGrid].forEach(function(value) {
    assert.ok(value.indexOf('<') === -1, value);
    assert.ok(value.indexOf('&lt;') !== -1, value);
    assert.ok(value.indexOf('&quot;') !== -1, value);
  });
});

function fakeElement(taskId) {
  var classes = new Set();
  return {
    _taskId: taskId,
    classList: {
      add: function(name) { classes.add(name); },
      remove: function(name) { classes.delete(name); },
      toggle: function(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains: function(name) { return classes.has(name); }
    },
    getAttribute: function(name) {
      return name === 'data-task-id' ? this._taskId : null;
    },
    hasClass: function(name) { return classes.has(name); }
  };
}

function unsafeContainer(nodes) {
  return {
    querySelectorAll: function(selector) {
      if (selector.indexOf('data-task-id=') !== -1) {
        throw new SyntaxError('unsafe attribute selector: ' + selector);
      }
      return nodes;
    },
    querySelector: function() {
      throw new SyntaxError('unsafe querySelector');
    }
  };
}

test('TimelinePane 对特殊字符 ID 不使用 CSS 选择器拼接', function() {
  var app = helper.createApp(['timeline-pane.js']);
  var TimelinePane = app.get('TimelinePane');
  var node = fakeElement(SELECTOR_ID);
  TimelinePane.body = unsafeContainer([node]);

  assert.doesNotThrow(function() {
    TimelinePane.updateSelection(SELECTOR_ID);
  });
  assert.strictEqual(node.hasClass('selected'), true);
  assert.doesNotThrow(function() {
    TimelinePane.updateHover(SELECTOR_ID);
  });
  assert.strictEqual(node.hasClass('highlight'), true);
  TimelinePane.body = null;
});

test('CalendarView 对特殊字符 ID 不使用 CSS 选择器拼接', function() {
  var app = helper.createApp(['calendar-view.js']);
  var CalendarView = app.get('CalendarView');
  var node = fakeElement(SELECTOR_ID);
  CalendarView.container = unsafeContainer([node]);

  assert.doesNotThrow(function() {
    CalendarView.selectBar(SELECTOR_ID);
  });
  assert.strictEqual(node.hasClass('selected'), true);
  CalendarView.container = null;
});

console.log('\nsecurity: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exitCode = 1;
}
