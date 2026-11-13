'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function makeDom() {
  var elements = {};
  var allCreated = [];

  function makeElement(tag, id) {
    var classes = new Set();
    var listeners = {};
    var attrs = {};
    var el = {
      tagName: (tag || 'DIV').toUpperCase(),
      id: id || '',
      className: '',
      style: {},
      value: '',
      textContent: '',
      _innerHTML: '',
      checked: false,
      disabled: false,
      parentNode: null,
      childNodes: [],
      classList: {
        add: function(c) { classes.add(c); },
        remove: function(c) { classes.delete(c); },
        contains: function(c) { return classes.has(c); }
      },
      setAttribute: function(k, v) { attrs[k] = String(v); },
      getAttribute: function(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      removeAttribute: function(k) { delete attrs[k]; },
      addEventListener: function(evt, fn) {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(fn);
      },
      removeEventListener: function(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(function(f) { return f !== fn; });
      },
      dispatchEvent: function(event) {
        var list = listeners[event.type] || [];
        for (var i = 0; i < list.length; i++) {
          list[i].call(this, event);
        }
      },
      querySelector: function(sel) {
        if (sel && sel.charAt(0) === '#') {
          return elements[sel.slice(1)] || null;
        }
        return null;
      },
      querySelectorAll: function(sel) {
        return [];
      },
      focus: function() {}
    };

    Object.defineProperty(el, 'innerHTML', {
      get: function() { return this._innerHTML; },
      set: function(val) {
        this._innerHTML = String(val);
        // 简单提取其中的 id 和 data-custom-field 并注册元素
        var idMatches = val.matchAll(/id="([^"]+)"/g);
        for (var m of idMatches) {
          var elId = m[1];
          if (!elements[elId]) {
            elements[elId] = makeElement('DIV', elId);
          }
        }
        var cfMatches = val.matchAll(/data-custom-field="([^"]+)"/g);
        for (var cf of cfMatches) {
          var cfKey = cf[1];
          var subEl = makeElement('INPUT');
          subEl.setAttribute('data-custom-field', cfKey);
          allCreated.push(subEl);
        }
      }
    });

    allCreated.push(el);
    return el;
  }

  var doc = {
    body: makeElement('BODY', 'body'),
    documentElement: makeElement('HTML', 'html'),
    getElementById: function(id) {
      if (!elements[id]) {
        elements[id] = makeElement('DIV', id);
      }
      return elements[id];
    },
    createElement: function(tag) { return makeElement(tag); },
    createTextNode: function(txt) { return { nodeType: 3, textContent: txt }; },
    querySelector: function(sel) {
      if (sel && sel.charAt(0) === '#') {
        return this.getElementById(sel.slice(1));
      }
      return null;
    },
    querySelectorAll: function(sel) {
      if (sel === '[data-custom-field]') {
        var map = new Map();
        allCreated.forEach(function(e) {
          var k = e.getAttribute('data-custom-field');
          if (k !== null) {
            map.set(k, e);
          }
        });
        return Array.from(map.values());
      }
      return [];
    },
    addEventListener: function() {},
    removeEventListener: function() {}
  };

  return { doc: doc, elements: elements, allCreated: allCreated };
}

var ALL_SCRIPTS = [
  'date.js',
  'validate.js',
  'store.js',
  'workspace.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'resources.js',
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
  'app.js'
];

function setupApp() {
  var storage = {};
  var localStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem: function(k, v) { storage[k] = String(v); },
    removeItem: function(k) { delete storage[k]; }
  };

  var app = helper.createApp(ALL_SCRIPTS, { localStorage: localStorage });
  var dom = makeDom();
  app.context.document = dom.doc;
  app.context.window = app.context;
  app.context.alert = function() {};

  var App = app.get('App');
  var TaskManager = app.get('TaskManager');
  var Workspace = app.get('Workspace');
  var ColumnConfig = app.get('ColumnConfig');
  var ModalManager = app.get('ModalManager');

  var customCols = ColumnConfig.normalize([
    { key: 'name', label: '任务名称', type: 'name', builtin: true, visible: true },
    { key: 'status', label: '状态', type: 'status', builtin: true, visible: true },
    { key: 'col-text', label: '文本备注', type: 'text', builtin: false, visible: true },
    { key: 'col-num', label: '预估人天', type: 'number', builtin: false, visible: true },
    { key: 'col-date', label: '截止基线', type: 'date', builtin: false, visible: true },
    {
      key: 'col-sel', label: '优先级', type: 'select', builtin: false, visible: true,
      options: [{ id: 'opt-p0', label: 'P0级' }, { id: 'opt-p1', label: 'P1级' }]
    }
  ]);

  var data = {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    settings: { columns: customCols }
  };

  helper.installTasks(app, data);
  ModalManager.init();

  return {
    app: app,
    dom: dom,
    App: App,
    TaskManager: TaskManager,
    Workspace: Workspace,
    ColumnConfig: ColumnConfig,
    ModalManager: ModalManager
  };
}

// -------------------------------------------------------------
// 1. TASK4-IMPT-01: ModalManager -> App.showAddTask -> TaskManager 真实持久化往返
// -------------------------------------------------------------
test('app_show_add_task_persists_custom_fields_end_to_end', function() {
  var h = setupApp();

  h.App.renderAll = function() {};
  h.App.showAddTask(null);

  var nameEl = h.dom.doc.getElementById('modal-task-name');
  assert.ok(nameEl, '任务名称输入框存在');
  nameEl.value = '全功能新建任务';

  var startEl = h.dom.doc.getElementById('modal-task-start');
  var endEl = h.dom.doc.getElementById('modal-task-end');
  startEl.value = '2026-06-01';
  endEl.value = '2026-06-07';

  var cfInputs = h.dom.doc.querySelectorAll('[data-custom-field]');
  assert.equal(cfInputs.length, 4, '必须渲染4个自定义字段控件');

  cfInputs.forEach(function(inp) {
    var k = inp.getAttribute('data-custom-field');
    if (k === 'col-text') inp.value = '必须真实持久化文本';
    if (k === 'col-num') inp.value = '16.5';
    if (k === 'col-date') inp.value = '2026-06-30';
    if (k === 'col-sel') inp.value = 'opt-p0';
  });

  var saveBtn = h.dom.doc.getElementById('modal-save-btn');
  assert.ok(saveBtn, '保存按钮存在');
  saveBtn.dispatchEvent({ type: 'click' });

  var tasks = h.TaskManager.data.tasks;
  assert.equal(tasks.length, 1, '任务已成功创建');
  var created = tasks[0];
  assert.equal(created.name, '全功能新建任务');

  // 核心断言：customFields 必须真实落盘！
  assert.ok(created.customFields, '任务必须包含 customFields 对象');
  assert.equal(created.customFields['col-text'], '必须真实持久化文本', '文本字段真实落盘');
  assert.equal(created.customFields['col-num'], 16.5, '数字字段真实落盘');
  assert.equal(created.customFields['col-date'], '2026-06-30', '日期字段真实落盘');
  assert.equal(created.customFields['col-sel'], 'opt-p0', '单选字段真实落盘');
});

// -------------------------------------------------------------
// 2. TASK4-IMPT-01: App.showEditTask 增量编辑不覆盖其他字段
// -------------------------------------------------------------
test('app_show_edit_task_preserves_unmodified_custom_fields', function() {
  var h = setupApp();

  var t = h.TaskManager.addTask(null, '原始任务');
  h.TaskManager.updateTask(t.id, {
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    customFields: {
      'col-text': '旧备注',
      'col-num': 10,
      'col-date': '2026-07-01',
      'col-sel': 'opt-p1'
    }
  });

  h.App.renderAll = function() {};
  h.App.showEditTask(t.id);

  var nameEl = h.dom.doc.getElementById('modal-task-name');
  nameEl.value = '原始任务';
  var startEl = h.dom.doc.getElementById('modal-task-start');
  var endEl = h.dom.doc.getElementById('modal-task-end');
  startEl.value = '2026-06-01';
  endEl.value = '2026-06-07';

  // 仅修改备注字段，其他字段留空（在编辑时若输入框值保留原值或仅修改某项）
  var cfInputs = h.dom.doc.querySelectorAll('[data-custom-field]');
  cfInputs.forEach(function(inp) {
    var k = inp.getAttribute('data-custom-field');
    if (k === 'col-text') inp.value = '更新后的备注';
    if (k === 'col-num') inp.value = '10';
    if (k === 'col-date') inp.value = '2026-07-01';
    if (k === 'col-sel') inp.value = 'opt-p1';
  });

  var saveBtn = h.dom.doc.getElementById('modal-save-btn');
  saveBtn.dispatchEvent({ type: 'click' });

  var updated = h.TaskManager.getTask(t.id);
  assert.equal(updated.customFields['col-text'], '更新后的备注', '修改字段已更新');
  assert.equal(updated.customFields['col-num'], 10, '未修改数字字段保持不变');
  assert.equal(updated.customFields['col-date'], '2026-07-01', '未修改日期字段保持不变');
  assert.equal(updated.customFields['col-sel'], 'opt-p1', '未修改单选字段保持不变');
});

// 执行测试
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (err) {
    console.error('FAIL ' + t.name);
    console.error(err);
    process.exitCode = 1;
  }
});
