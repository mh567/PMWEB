'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var lw = require('./helpers/load-workspace');
var makeWorkspace = lw.makeWorkspace;

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function makeFakeDom() {
  var elements = {};
  function makeElement(id) {
    var classes = new Set();
    var listeners = {};
    var el = {
      id: id || '',
      tagName: 'DIV',
      dataset: {},
      style: {},
      innerHTML: '',
      textContent: '',
      value: '',
      checked: false,
      disabled: false,
      classList: {
        add: function(c) { classes.add(c); },
        remove: function(c) { classes.delete(c); },
        toggle: function(c, force) {
          if (force !== undefined) {
            if (force) classes.add(c); else classes.delete(c);
          } else {
            if (classes.has(c)) classes.delete(c); else classes.add(c);
          }
        },
        contains: function(c) { return classes.has(c); }
      },
      addEventListener: function(evt, fn) {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(fn);
      },
      removeEventListener: function(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(function(l) { return l !== fn; });
      },
      setAttribute: function() {},
      removeAttribute: function() {},
      getAttribute: function() { return null; },
      querySelector: function(sel) { return makeElement(); },
      querySelectorAll: function(sel) { return []; },
      closest: function(sel) { return null; },
      appendChild: function(c) { return c; },
      focus: function() {}
    };
    return el;
  }

  return {
    nodeType: 9,
    body: makeElement('body'),
    documentElement: makeElement('html'),
    getElementById: function(id) {
      if (!elements[id]) elements[id] = makeElement(id);
      return elements[id];
    },
    querySelector: function(sel) { return makeElement(); },
    querySelectorAll: function(sel) { return []; },
    createElement: function(tag) { return makeElement(); },
    createTextNode: function(txt) { return { nodeType: 3, textContent: txt }; },
    addEventListener: function(evt, fn) {},
    removeEventListener: function(evt, fn) {}
  };
}

var ALL_SCRIPTS = [
  'date.js',
  'validate.js',
  'store.js',
  'workspace.js',
  'recycle-bin.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'resources.js',
  'holiday-source.js',
  'work-calendar.js',
  'task-manager.js',
  'row-model.js',
  'views.js',
  'modal.js',
  'tree-view.js',
  'gantt-view.js',
  'drag-manager.js',
  'calendar-view.js',
  'column-config.js',
  'cell-editor.js',
  'progress.js',
  'export.js',
  'baseline.js',
  'grid-pane.js',
  'links.js',
  'scheduler.js',
  'critical-path.js',
  'arrows.js',
  'timeline-pane.js',
  'workbench.js',
  'sync.js',
  'sync-queue.js',
  'realtime.js',
  'sync-ui.js',
  'share.js',
  'project-ui.js',
  'recycle-bin-ui.js',
  'app.js'
];

function createAppHarness(initialRaw) {
  var localStorage = {
    _store: {},
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null;
    },
    setItem: function(key, value) { this._store[key] = String(value); },
    removeItem: function(key) { delete this._store[key]; }
  };
  if (initialRaw !== undefined && initialRaw !== null) {
    localStorage._store['pmweb_data'] = String(initialRaw);
  }

  var app = helper.createApp(ALL_SCRIPTS, { localStorage: localStorage });
  var doc = makeFakeDom();
  app.context.document = doc;
  app.context.window = app.context;
  app.context.addEventListener = function() {};
  app.context.removeEventListener = function() {};
  return {
    app: app,
    App: app.get('App'),
    TaskManager: app.get('TaskManager'),
    Workspace: app.get('Workspace'),
    DataStore: app.get('DataStore'),
    localStorage: localStorage
  };
}

test('App.init 空存储场景下安全启动不抛错，TaskManager 无绑定项目', function() {
  var h = createAppHarness(null);
  assert.doesNotThrow(function() {
    h.App.init();
  });
  assert.strictEqual(h.TaskManager.data, null);
  assert.strictEqual(h.Workspace.currentProject(), null);
  assert.strictEqual(h.Workspace.isReadOnly(), false);
  assert.strictEqual(h.Workspace.data.projects.length, 0);
});

test('App.init 默认 startupMode 为 choose 且有项目时安全启动不抛错，TaskManager 保持未激活', function() {
  var ws = makeWorkspace();
  ws.settings.startupMode = 'choose';
  var h = createAppHarness(JSON.stringify(ws));
  assert.doesNotThrow(function() {
    h.App.init();
  });
  assert.strictEqual(h.TaskManager.data, null);
  assert.strictEqual(h.Workspace.currentProject(), null);
  assert.strictEqual(h.Workspace.data.projects.length, 2);
});

test('App.init 损坏存储场景下安全启动不抛错，工作区标记为只读且 TaskManager 保持未激活', function() {
  var corrupt = '{broken json: 123';
  var h = createAppHarness(corrupt);
  assert.doesNotThrow(function() {
    h.App.init();
  });
  assert.strictEqual(h.TaskManager.data, null);
  assert.strictEqual(h.Workspace.currentProject(), null);
  assert.strictEqual(h.Workspace.isReadOnly(), true);
  assert.strictEqual(h.localStorage.getItem('pmweb_data'), corrupt);
});

function plain(val) {
  return JSON.parse(JSON.stringify(val));
}

test('未绑定项目状态下所有只读查询安全返回空集合或 null，不隐式创建项目', function() {
  var h = createAppHarness(null);
  h.App.init();

  assert.strictEqual(h.TaskManager.data, null);
  assert.deepStrictEqual(plain(h.TaskManager.getAllTasks()), []);
  assert.deepStrictEqual(plain(h.TaskManager.getAllMilestones()), []);
  assert.deepStrictEqual(plain(h.TaskManager.getMilestonesByTask('any-id')), []);
  assert.strictEqual(h.TaskManager.getMilestone('any-id'), null);
  assert.deepStrictEqual(plain(h.TaskManager.getLinks()), []);
  assert.strictEqual(h.TaskManager.getLink('any-id'), null);
  assert.deepStrictEqual(plain(h.TaskManager.getComments('any-id')), []);
  assert.deepStrictEqual(plain(h.TaskManager.getActivity('any-id')), []);
  assert.deepStrictEqual(plain(h.TaskManager.getAttachments('any-id')), []);
  assert.strictEqual(h.TaskManager.getAttachment('any-id'), null);
  assert.strictEqual(h.TaskManager.getBaseline(), null);
  assert.strictEqual(h.TaskManager.hasBaseline(), false);
  assert.strictEqual(h.TaskManager.getSetting('any-key'), undefined);
  assert.deepStrictEqual(plain(h.TaskManager.getWorkCalendar().weekends), [0, 6]);
  assert.strictEqual(h.TaskManager.hasWorkCalendarConfig(), false);
  assert.deepStrictEqual(plain(h.TaskManager.getRootTasks()), []);
  assert.deepStrictEqual(plain(h.TaskManager.getChildren('any-id')), []);
  assert.strictEqual(h.TaskManager.getTask('any-id'), null);

  assert.strictEqual(h.TaskManager.data, null);
  assert.strictEqual(h.Workspace.data.projects.length, 0);
});

test('未绑定项目状态下所有公开写入口均被 assertWritable 拦截拒绝', function() {
  var h = createAppHarness(null);
  h.App.init();

  var tm = h.TaskManager;
  var expectMsg = /无项目|未选中项目|只读/;

  assert.throws(function() { tm.addTask(null, 't'); }, expectMsg);
  assert.throws(function() { tm.updateTask('t', { name: 't2' }); }, expectMsg);
  assert.throws(function() { tm.updateTasks(['t'], { progress: 50 }); }, expectMsg);
  assert.throws(function() { tm.deleteTask('t'); }, expectMsg);
  assert.throws(function() { tm.moveTask('t', null, 0); }, expectMsg);
  assert.throws(function() { tm.addMilestone('t', 'm', '2026-01-01', 'pending'); }, expectMsg);
  assert.throws(function() { tm.updateMilestone('m', { name: 'm2' }); }, expectMsg);
  assert.throws(function() { tm.deleteMilestone('m'); }, expectMsg);
  assert.throws(function() { tm.addLink('a', 'b', 'FS'); }, expectMsg);
  assert.throws(function() { tm.updateLink('l', { lag: 1 }); }, expectMsg);
  assert.throws(function() { tm.deleteLink('l'); }, expectMsg);
  assert.throws(function() { tm.addComment('t', 'author', 'text'); }, expectMsg);
  assert.throws(function() { tm.updateComment('c', 'text2'); }, expectMsg);
  assert.throws(function() { tm.deleteComment('c'); }, expectMsg);
  assert.throws(function() { tm.addAttachment('t', { name: 'a.txt', size: 10, type: 'text/plain', blobKey: 'k' }); }, expectMsg);
  assert.throws(function() { tm.deleteAttachment('a'); }, expectMsg);
  assert.throws(function() { tm.saveBaseline(); }, expectMsg);
  assert.throws(function() { tm.clearBaseline(); }, expectMsg);
  assert.throws(function() { tm.setSetting('k', 'v'); }, expectMsg);
  assert.throws(function() { tm.replaceData({}); }, expectMsg);
  assert.throws(function() { tm.setWorkCalendar({ weekends: [5] }); }, expectMsg);
  assert.throws(function() { tm.setWorkCalendar({ weekends: [5] }); }, expectMsg);

  assert.strictEqual(h.TaskManager.data, null);
  assert.strictEqual(h.Workspace.data.projects.length, 0);
});

var failures = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + t.name);
    console.log('  ' + (err && err.stack ? err.stack : err));
  }
});

console.log('\napp-init: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
