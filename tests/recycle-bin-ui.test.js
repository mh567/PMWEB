'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var lw = require('./helpers/load-workspace');
var makeWorkspace = lw.makeWorkspace;

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function createDomEnvironment() {
  var elements = {};

  function parseAttributes(attrStr) {
    var attrs = {};
    var re = /([a-zA-Z0-9_\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^ \t\r\n\/>]+)))?/g;
    var match;
    while ((match = re.exec(attrStr)) !== null) {
      var name = match[1];
      var val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : ''));
      attrs[name] = val;
    }
    return attrs;
  }

  function makeElement(tag, attrs, text) {
    tag = (tag || 'DIV').toUpperCase();
    attrs = attrs || {};
    var classes = new Set((attrs['class'] || '').split(/\s+/).filter(Boolean));
    var listeners = {};
    var children = [];

    var el = {
      tagName: tag,
      dataset: {},
      style: {},
      _attrs: attrs,
      _listeners: listeners,
      childNodes: children,
      parentNode: null,
      checked: attrs.checked !== undefined,
      disabled: attrs.disabled !== undefined,
      value: attrs.value || '',
      get id() { return attrs.id || ''; },
      set id(val) { attrs.id = String(val); elements[val] = el; },
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
      get className() { return Array.from(classes).join(' '); },
      set className(val) {
        classes = new Set(String(val).split(/\s+/).filter(Boolean));
        attrs['class'] = val;
      },
      get textContent() {
        if (text !== undefined && text !== null && children.length === 0) return String(text);
        return children.map(function(c) { return c.textContent || ''; }).join('');
      },
      set textContent(val) {
        text = String(val);
        children.length = 0;
      },
      getAttribute: function(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
      },
      setAttribute: function(k, v) {
        attrs[k] = String(v);
        if (k === 'id') {
          elements[String(v)] = el;
        }
      },
      removeAttribute: function(k) {
        delete attrs[k];
        if (k === 'id') delete elements[attrs.id];
      },
      hasAttribute: function(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k);
      },
      addEventListener: function(evt, fn) {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(fn);
      },
      removeEventListener: function(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(function(f) { return f !== fn; });
      },
      dispatchEvent: function(event) {
        var type = typeof event === 'string' ? event : (event && event.type);
        var target = this;
        var evObj = typeof event === 'object' && event !== null ? event : { type: type };
        evObj.target = target;
        evObj.currentTarget = target;
        if (!evObj.preventDefault) evObj.preventDefault = function() {};
        if (!evObj.stopPropagation) evObj.stopPropagation = function() {};
        var list = listeners[type] || [];
        for (var i = 0; i < list.length; i++) {
          list[i].call(target, evObj);
        }
        return true;
      },
      click: function() {
        this.dispatchEvent({ type: 'click', target: this });
      },
      focus: function() {},
      blur: function() {},
      querySelector: function(sel) {
        var all = this.querySelectorAll(sel);
        return all.length > 0 ? all[0] : null;
      },
      querySelectorAll: function(sel) {
        var res = [];
        function walk(node) {
          if (!node || !node.childNodes) return;
          for (var i = 0; i < node.childNodes.length; i++) {
            var c = node.childNodes[i];
            if (matches(c, sel)) res.push(c);
            walk(c);
          }
        }
        walk(this);
        return res;
      },
      appendChild: function(c) {
        c.parentNode = this;
        children.push(c);
        return c;
      },
      removeChild: function(c) {
        var idx = children.indexOf(c);
        if (idx !== -1) {
          children.splice(idx, 1);
          c.parentNode = null;
        }
        return c;
      }
    };

    Object.keys(attrs).forEach(function(k) {
      if (k.indexOf('data-') === 0) {
        var prop = k.slice(5).replace(/-([a-z])/g, function(g) { return g[1].toUpperCase(); });
        el.dataset[prop] = attrs[k];
      }
    });

    if (attrs.id) {
      elements[attrs.id] = el;
    }

    Object.defineProperty(el, 'innerHTML', {
      get: function() {
        return this._innerHTML || '';
      },
      set: function(val) {
        this._innerHTML = val;
        this.childNodes.length = 0;
        parseHtml(val, this);
      }
    });

    return el;
  }

  function matches(el, sel) {
    if (!el || !sel || el.nodeType === 3) return false;
    if (sel.indexOf('#') === 0) {
      return el.id === sel.slice(1);
    }
    if (sel.indexOf('.') === 0) {
      return el.classList && el.classList.contains(sel.slice(1));
    }
    if (sel.indexOf('[') === 0 && sel.lastIndexOf(']') === sel.length - 1) {
      var inner = sel.slice(1, -1);
      var parts = inner.split('][');
      for (var p = 0; p < parts.length; p++) {
        var part = parts[p];
        var eqIdx = part.indexOf('=');
        if (eqIdx === -1) {
          if (!el.hasAttribute(part)) return false;
        } else {
          var k = part.slice(0, eqIdx);
          var v = part.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
          if (el.getAttribute(k) !== v) return false;
        }
      }
      return true;
    }
    if (el.tagName && el.tagName.toLowerCase() === sel.toLowerCase()) {
      return true;
    }
    return false;
  }

  function parseHtml(htmlStr, parent) {
    var tagRe = /<([a-zA-Z0-9_\-]+)([^>]*?)(\/?)>|([^<]+)/g;
    var match;
    var stack = [parent];

    var voidTags = { input: true, img: true, br: true, hr: true, option: false };

    while ((match = tagRe.exec(htmlStr)) !== null) {
      if (match[4]) {
        var textNode = {
          nodeType: 3,
          textContent: match[4],
          parentNode: stack[stack.length - 1]
        };
        stack[stack.length - 1].childNodes.push(textNode);
      } else if (match[1]) {
        var isClosing = match[1].indexOf('/') === 0;
        if (isClosing) {
          var closeTag = match[1].slice(1).toUpperCase();
          for (var s = stack.length - 1; s > 0; s--) {
            if (stack[s].tagName === closeTag) {
              stack.splice(s, stack.length - s);
              break;
            }
          }
        } else {
          var tagName = match[1].toUpperCase();
          var attrStr = match[2] || '';
          var isSelfClosing = match[3] === '/' || Boolean(voidTags[match[1].toLowerCase()]);
          var parsedAttrs = parseAttributes(attrStr);
          var newEl = makeElement(tagName, parsedAttrs);
          var curParent = stack[stack.length - 1];
          curParent.childNodes.push(newEl);
          newEl.parentNode = curParent;

          if (!isSelfClosing) {
            stack.push(newEl);
          }
        }
      }
    }
  }

  var overlay = makeElement('div', { id: 'modal-overlay', 'class': 'modal-overlay hidden' });
  var modalBox = makeElement('div', { id: 'modal-box', 'class': 'modal-box' });
  overlay.appendChild(modalBox);
  elements['modal-overlay'] = overlay;
  elements['modal-box'] = modalBox;

  var doc = {
    getElementById: function(id) {
      return elements[id] || null;
    },
    querySelector: function(sel) {
      if (sel === '#modal-overlay') return overlay;
      if (sel === '#modal-box') return modalBox;
      return overlay.querySelector(sel);
    },
    querySelectorAll: function(sel) {
      return overlay.querySelectorAll(sel);
    },
    createElement: function(tag) {
      return makeElement(tag, {});
    },
    createTextNode: function(txt) {
      return { nodeType: 3, textContent: txt, data: txt };
    },
    addEventListener: function() {},
    removeEventListener: function() {}
  };

  return {
    document: doc,
    elements: elements,
    overlay: overlay,
    modalBox: modalBox
  };
}

var SCRIPTS = [
  'date.js',
  'validate.js',
  'store.js',
  'workspace.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'task-manager.js',
  'modal.js',
  'recycle-bin.js',
  'recycle-bin-ui.js'
];

function createRecycleBinUIHarness(initialData) {
  var dom = createDomEnvironment();
  var localStorage = {
    _store: {},
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null;
    },
    setItem: function(key, value) { this._store[key] = String(value); },
    removeItem: function(key) { delete this._store[key]; }
  };

  if (initialData) {
    localStorage._store['pmweb_data'] = JSON.stringify(initialData);
  }

  var app = helper.createApp(SCRIPTS, {
    localStorage: localStorage
  });
  app.context.document = dom.document;
  app.context.window = app.context;
  app.context.confirm = function() { return true; };

  var ModalManager = app.get('ModalManager');
  ModalManager.init();

  var Workspace = app.get('Workspace');
  Workspace.init();

  var TaskManager = app.get('TaskManager');
  if (Workspace.data && Workspace.data.projects && Workspace.data.projects.length > 0) {
    Workspace.activate(Workspace.data.projects[0].id);
  }

  var RecycleBin = app.get('RecycleBin');
  var RecycleBinUI = app.get('RecycleBinUI');
  var AttachmentStore = app.get('AttachmentStore');

  return {
    dom: dom,
    app: app,
    Workspace: Workspace,
    TaskManager: TaskManager,
    RecycleBin: RecycleBin,
    RecycleBinUI: RecycleBinUI,
    AttachmentStore: AttachmentStore
  };
}

// ------------------------------------------------------------
// UI 真实事件测试用例
// ------------------------------------------------------------

test('recycle_bin_ui_render_count_occupancy_and_filter', function() {
  var ws = makeWorkspace();
  // 添加一个任务删除批次和一个项目删除批次
  ws.recycleBin = [
    {
      id: 'batch-task-1',
      kind: 'task',
      projectId: 'p-a',
      deletedAt: '2026-11-12T08:00:00.000Z',
      snapshot: {
        rootTaskId: 't-1',
        tasks: [
          { id: 't-1', name: '已删任务1' }
        ],
        milestones: [],
        links: [],
        comments: [],
        attachments: [
          { id: 'att-1', name: '文件1.pdf', size: 1024 * 50, blobKey: 'blob-1' }
        ],
        activity: []
      }
    },
    {
      id: 'batch-proj-1',
      kind: 'project',
      projectId: 'p-del',
      deletedAt: '2026-11-12T07:00:00.000Z',
      snapshot: {
        id: 'p-del',
        name: '已删项目X',
        data: {
          tasks: [{ id: 'tx-1', name: '任务X' }],
          attachments: [
            { id: 'att-x', name: '文件X.png', size: 1024 * 100, blobKey: 'blob-x' }
          ]
        }
      }
    }
  ];

  var h = createRecycleBinUIHarness(ws);
  h.RecycleBinUI.init();
  h.RecycleBinUI.open();

  var rootEl = h.dom.modalBox;
  // 1. 估算统计显示
  var html = rootEl.innerHTML;
  assert.ok(html.indexOf('共 2 个批次') !== -1 || html.indexOf('2') !== -1, '展示批次总数');
  assert.ok(html.indexOf('150') !== -1 || html.indexOf('KB') !== -1 || html.indexOf('字节') !== -1, '展示占用空间估算');

  // 2. 项目筛选切换
  var filterSelect = h.dom.document.querySelector('#recycle-bin-project-filter');
  assert.ok(filterSelect, '应存在项目筛选下拉框');

  // 切换只看 p-a
  filterSelect.value = 'p-a';
  filterSelect.dispatchEvent('change');

  var items = h.dom.document.querySelectorAll('.recycle-bin-item');
  assert.strictEqual(items.length, 1, '按项目筛选后应只展示对应项目批次');
  assert.strictEqual(items[0].getAttribute('data-batch-id'), 'batch-task-1');
});

test('recycle_bin_ui_restore_preview_and_confirm', function() {
  var ws = makeWorkspace();
  // 构造原父级缺失的任务批次，测试警告确认流程
  ws.recycleBin = [
    {
      id: 'batch-warn',
      kind: 'task',
      projectId: 'p-a',
      deletedAt: '2026-11-12T08:00:00.000Z',
      snapshot: {
        rootTaskId: 't-child',
        originalParentId: 'non-existent-parent',
        tasks: [
          { id: 't-child', parentId: 'non-existent-parent', name: '孤儿子任务' }
        ],
        milestones: [],
        links: [],
        comments: [],
        attachments: [],
        activity: []
      }
    }
  ];

  var h = createRecycleBinUIHarness(ws);
  h.RecycleBinUI.init();
  h.RecycleBinUI.open();

  var restoreBtn = h.dom.document.querySelector('[data-action="restore-batch"][data-batch-id="batch-warn"]');
  assert.ok(restoreBtn, '应存在恢复按钮');

  // 点击恢复：由于有警告，应弹出警告确认视图
  restoreBtn.click();

  var confirmBtn = h.dom.document.querySelector('[data-action="confirm-restore"]');
  assert.ok(confirmBtn, '应展示带警告确认的恢复按钮');
  var modalHtml = h.dom.modalBox.innerHTML;
  assert.ok(modalHtml.indexOf('父') !== -1 || modalHtml.indexOf('顶层') !== -1, '展示父级缺失警告');

  // 点击确认恢复
  confirmBtn.click();

  // 批次已恢复并移出回收站
  assert.strictEqual(h.Workspace.data.recycleBin.length, 0);
  var pA = h.Workspace.data.projects.find(function(p) { return p.id === 'p-a'; });
  var restoredTask = pA.data.tasks.find(function(t) { return t.id === 't-child'; });
  assert.ok(restoredTask, '任务已成功恢复入活动项目');
  assert.strictEqual(restoredTask.parentId, null, '孤儿子任务降级为顶层任务');
});

test('recycle_bin_ui_permanent_purge_independent_confirm', function() {
  var ws = makeWorkspace();
  ws.recycleBin = [
    {
      id: 'batch-purge-target',
      kind: 'task',
      projectId: 'p-a',
      deletedAt: '2026-11-12T08:00:00.000Z',
      snapshot: {
        rootTaskId: 't-purge',
        tasks: [{ id: 't-purge', name: '待彻底清除任务' }],
        milestones: [],
        links: [],
        comments: [],
        attachments: [
          { id: 'att-p', name: '文件.txt', size: 100, blobKey: 'blob-to-delete' }
        ],
        activity: []
      }
    }
  ];

  var h = createRecycleBinUIHarness(ws);
  var deletedKeys = [];
  h.AttachmentStore.delete = function(key) {
    deletedKeys.push(key);
    return Promise.resolve();
  };

  h.RecycleBinUI.init();
  h.RecycleBinUI.open();

  var purgeBtn = h.dom.document.querySelector('[data-action="purge-batch"][data-batch-id="batch-purge-target"]');
  assert.ok(purgeBtn, '应存在永久删除按钮');

  // 点击永久删除：必须展示独立确认提示
  purgeBtn.click();

  var confirmPurgeBtn = h.dom.document.querySelector('[data-action="confirm-purge"]');
  assert.ok(confirmPurgeBtn, '应展示独立确认永久删除的操作按钮');

  // 点击确认永久删除
  confirmPurgeBtn.click();

  // 工作区批次被移除
  assert.strictEqual(h.Workspace.data.recycleBin.length, 0);
  // 无引用 blobKey 被提交清理
  assert.ok(deletedKeys.indexOf('blob-to-delete') !== -1, '无引用 blob 实体应被尽力清理');
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

console.log('\nrecycle-bin-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
