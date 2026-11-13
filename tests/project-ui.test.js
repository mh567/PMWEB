'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var lw = require('./helpers/load-workspace');
var makeWorkspace = lw.makeWorkspace;

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// 构造支持 innerHTML 解析与查询的测试 DOM 环境，完全匹配现有 ModalManager 模式
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
        classes.clear();
        String(val).split(/\s+/).filter(Boolean).forEach(function(c) { classes.add(c); });
      },
      setAttribute: function(k, v) {
        attrs[k] = String(v);
        if (k === 'id') elements[v] = el;
        if (k.indexOf('data-') === 0) {
          var camel = k.slice(5).replace(/-([a-z])/g, function(_, g) { return g.toUpperCase(); });
          el.dataset[camel] = String(v);
        }
      },
      getAttribute: function(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
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
        listeners[evt] = listeners[evt].filter(function(l) { return l !== fn; });
      },
      dispatchEvent: function(event) {
        event.target = event.target || el;
        var list = (listeners[event.type] || []).slice();
        for (var i = 0; i < list.length; i++) {
          list[i].call(el, event);
        }
        return true;
      },
      click: function() {
        el.dispatchEvent({ type: 'click' });
      },
      focus: function() {},
      appendChild: function(c) {
        c.parentNode = el;
        children.push(c);
        return c;
      },
      removeChild: function(c) {
        var idx = children.indexOf(c);
        if (idx !== -1) children.splice(idx, 1);
        c.parentNode = null;
        return c;
      },
      querySelector: function(sel) {
        return querySelectorInternal(el, sel);
      },
      querySelectorAll: function(sel) {
        var res = [];
        querySelectorAllInternal(el, sel, res);
        return res;
      }
    };

    Object.keys(attrs).forEach(function(k) {
      if (k.indexOf('data-') === 0) {
        var camel = k.slice(5).replace(/-([a-z])/g, function(_, g) { return g.toUpperCase(); });
        el.dataset[camel] = attrs[k];
      }
    });

    if (attrs.id) {
      elements[attrs.id] = el;
    }

    var VOID_TAGS = {
      INPUT: true, IMG: true, BR: true, HR: true, META: true, LINK: true
    };

    function serializeElement(node) {
      if (!node.childNodes || node.childNodes.length === 0) {
        return node._rawInner || '';
      }
      var res = '';
      for (var i = 0; i < node.childNodes.length; i++) {
        var child = node.childNodes[i];
        var tag = child.tagName.toLowerCase();
        var attrsStr = '';
        if (child._attrs) {
          var keys = Object.keys(child._attrs);
          for (var k = 0; k < keys.length; k++) {
            attrsStr += ' ' + keys[k] + '="' + child._attrs[keys[k]] + '"';
          }
        }
        if (VOID_TAGS[child.tagName]) {
          res += '<' + tag + attrsStr + '>';
        } else {
          res += '<' + tag + attrsStr + '>' + serializeElement(child) + '</' + tag + '>';
        }
      }
      return res;
    }

    el._rawInner = text || '';
    Object.defineProperty(el, 'innerHTML', {
      get: function() {
        if (children.length === 0) return el._rawInner;
        return serializeElement(el);
      },
      set: function(html) {
        el._rawInner = html;
        children.length = 0;
        parseHtmlToDom(html, el);
      }
    });

    Object.defineProperty(el, 'textContent', {
      get: function() {
        if (children.length === 0) return (el._rawInner || '').replace(/<[^>]+>/g, '');
        return children.map(function(c) { return c.textContent; }).join('');
      },
      set: function(txt) {
        el._rawInner = String(txt);
        children.length = 0;
      }
    });

    return el;
  }

  var VOID_TAGS = {
    INPUT: true, IMG: true, BR: true, HR: true, META: true, LINK: true
  };

  function parseHtmlToDom(html, rootElement) {
    var tokenRe = /<!--[\s\S]*?-->|<([a-zA-Z0-9_\-]+)([^>]*?)(\/?)>|<\/([a-zA-Z0-9_\-]+)>|([^<]+)/g;
    var stack = [rootElement];
    var match;

    while ((match = tokenRe.exec(html)) !== null) {
      if (match[0].indexOf('<!--') === 0) {
        continue;
      }
      var openTag = match[1];
      var attrStr = match[2];
      var selfClosing = match[3];
      var closeTag = match[4];
      var text = match[5];

      var current = stack[stack.length - 1];

      if (openTag) {
        var tagUpper = openTag.toUpperCase();
        var isVoid = Boolean(selfClosing) || Boolean(VOID_TAGS[tagUpper]);
        var attrs = parseAttributes(attrStr || '');
        var el = makeElement(tagUpper, attrs, '');
        current.appendChild(el);
        if (!isVoid) {
          stack.push(el);
        }
      } else if (closeTag) {
        var closeUpper = closeTag.toUpperCase();
        for (var k = stack.length - 1; k > 0; k--) {
          if (stack[k].tagName === closeUpper) {
            stack.splice(k, stack.length - k);
            break;
          }
        }
      } else if (text && text.trim()) {
        current.textContent = (current.textContent || '') + text.trim();
      }
    }
  }

  function matches(node, sel) {
    if (!sel || !node || !node.tagName) return false;
    sel = sel.trim();
    if (sel.indexOf('#') === 0) {
      return node.id === sel.slice(1);
    }
    if (sel.indexOf('.') === 0) {
      return node.classList.contains(sel.slice(1));
    }
    if (sel.indexOf('[') !== -1) {
      var attrRe = /\[([a-zA-Z0-9_\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^ \t\r\n\/>\]]+)))?\]/g;
      var m;
      var matchedAll = true;
      var foundAny = false;
      while ((m = attrRe.exec(sel)) !== null) {
        foundAny = true;
        var aName = m[1];
        var aVal = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
        if (aVal === undefined) {
          if (!node.hasAttribute(aName)) { matchedAll = false; break; }
        } else {
          if (node.getAttribute(aName) !== aVal) { matchedAll = false; break; }
        }
      }
      if (foundAny) return matchedAll;
    }
    return node.tagName.toLowerCase() === sel.toLowerCase();
  }

  function querySelectorInternal(node, sel) {
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (matches(child, sel)) return child;
      var found = querySelectorInternal(child, sel);
      if (found) return found;
    }
    return null;
  }

  function querySelectorAllInternal(node, sel, acc) {
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (matches(child, sel)) acc.push(child);
      querySelectorAllInternal(child, sel, acc);
    }
  }

  var body = makeElement('BODY', { id: 'body' });
  var overlay = makeElement('DIV', { id: 'modal-overlay', class: 'modal-overlay' });
  var modalBox = makeElement('DIV', { id: 'modal-box', class: 'modal-box' });
  overlay.appendChild(modalBox);
  body.appendChild(overlay);

  var doc = {
    nodeType: 9,
    body: body,
    documentElement: makeElement('HTML'),
    getElementById: function(id) {
      return elements[id] || body.querySelector('#' + id);
    },
    querySelector: function(sel) {
      return body.querySelector(sel);
    },
    querySelectorAll: function(sel) {
      return body.querySelectorAll(sel);
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
  'resources.js',
  'work-calendar.js',
  'recycle-bin.js',
  'task-manager.js',
  'row-model.js',
  'views.js',
  'modal.js',
  'project-ui.js'
];

function createProjectUIHarness(initialData, options) {
  options = options || {};
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
  } else if (options.initialRaw !== undefined && options.initialRaw !== null) {
    localStorage._store['pmweb_data'] = options.initialRaw;
  }

  var app = helper.createApp(SCRIPTS, {
    localStorage: localStorage
  });
  app.context.document = dom.document;
  app.context.window = app.context;

  var ModalManager = app.get('ModalManager');
  var Workspace = app.get('Workspace');
  var ProjectUI = app.get('ProjectUI');
  var TaskManager = app.get('TaskManager');

  ModalManager.init();
  Workspace.init();

  return {
    app: app,
    dom: dom,
    ModalManager: ModalManager,
    Workspace: Workspace,
    ProjectUI: ProjectUI,
    TaskManager: TaskManager
  };
}

function makeProjectData() {
  return {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    comments: [],
    activity: [],
    attachments: [],
    settings: {
      layoutVersion: 'workbench',
      gridWidth: 560,
      columns: null,
      statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true }
    }
  };
}

test('ProjectUI.init 初始化并支持注册 onSelect 回调', function() {
  var h = createProjectUIHarness(makeWorkspace());
  var selectedId = null;
  assert.strictEqual(typeof h.ProjectUI.init, 'function');
  assert.strictEqual(typeof h.ProjectUI.open, 'function');

  h.ProjectUI.init({
    onSelect: function(id) {
      selectedId = id;
    }
  });

  assert.strictEqual(selectedId, null);
});

test('ProjectUI.open 渲染项目管理弹窗，默认隐藏已归档项目', function() {
  var ws = makeWorkspace();
  // ws 拥有 p-a, p-b
  ws.projects.push({
    id: 'p-archived',
    name: '历史归档项目',
    description: '已被归档',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    status: 'completed',
    archived: true,
    data: makeProjectData()
  });

  var h = createProjectUIHarness(ws);
  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  assert.strictEqual(h.ModalManager.isOpen(), true);
  var html = h.dom.modalBox.innerHTML;
  assert.ok(html.indexOf('项目 A') !== -1);
  assert.ok(html.indexOf('项目 B') !== -1);
  // 默认归档项目被隐藏
  assert.strictEqual(html.indexOf('历史归档项目'), -1);
});

test('ProjectUI 支持切换显示已归档项目', function() {
  var ws = makeWorkspace();
  ws.projects.push({
    id: 'p-archived',
    name: '历史归档项目',
    description: '已被归档',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    status: 'completed',
    archived: true,
    data: makeProjectData()
  });

  var h = createProjectUIHarness(ws);
  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  var toggleArchived = h.dom.document.getElementById('toggle-show-archived');
  assert.ok(toggleArchived, '应存在显示已归档切换控件');
  toggleArchived.checked = true;
  toggleArchived.dispatchEvent({ type: 'change' });

  var htmlAfter = h.dom.modalBox.innerHTML;
  assert.ok(htmlAfter.indexOf('历史归档项目') !== -1, '勾选后应显示已归档项目');
  assert.ok(htmlAfter.indexOf('已归档') !== -1, '已归档项目应有明确标识');
});

test('ProjectUI 搜索功能按项目名称和描述过滤', function() {
  var ws = makeWorkspace();
  var h = createProjectUIHarness(ws);
  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  var searchInput = h.dom.document.getElementById('project-search-input');
  assert.ok(searchInput, '应存在搜索输入框');

  // 搜索 "项目 B"
  searchInput.value = '项目 B';
  searchInput.dispatchEvent({ type: 'input' });

  var listEl = h.dom.document.getElementById('project-list');
  assert.ok(listEl.textContent.indexOf('项目 B') !== -1);
  assert.strictEqual(listEl.textContent.indexOf('项目 A'), -1);

  // 清空搜索
  searchInput.value = '';
  searchInput.dispatchEvent({ type: 'input' });
  var listAll = h.dom.document.getElementById('project-list');
  assert.ok(listAll.textContent.indexOf('项目 A') !== -1);
  assert.ok(listAll.textContent.indexOf('项目 B') !== -1);
});

test('ProjectUI 点击项目项触发 onSelect 并关闭弹窗', function() {
  var ws = makeWorkspace();
  var h = createProjectUIHarness(ws);
  var selectedId = null;

  h.ProjectUI.init({
    onSelect: function(id) {
      selectedId = id;
    }
  });
  h.ProjectUI.open();

  var selectBtn = h.dom.document.querySelector('[data-action="select-project"][data-project-id="p-b"]');
  assert.ok(selectBtn, '应存在选择项目 B 的按钮');
  selectBtn.click();

  assert.strictEqual(selectedId, 'p-b');
  assert.strictEqual(h.ModalManager.isOpen(), false);
});

test('ProjectUI 新建项目校验名称并在提交后自动选中新项目', function() {
  var ws = makeWorkspace();
  var h = createProjectUIHarness(ws);
  var selectedId = null;

  h.ProjectUI.init({
    onSelect: function(id) {
      selectedId = id;
    }
  });
  h.ProjectUI.open();

  var btnNew = h.dom.document.getElementById('btn-new-project');
  assert.ok(btnNew, '应存在新建项目按钮');
  btnNew.click();

  var nameInput = h.dom.document.getElementById('new-project-name');
  var descInput = h.dom.document.getElementById('new-project-desc');
  var saveBtn = h.dom.document.getElementById('btn-save-new-project');
  assert.ok(nameInput && saveBtn, '应展示新建项目表单');

  // 空名称保存被拒绝
  nameInput.value = '   ';
  saveBtn.click();
  var errorBox = h.dom.document.getElementById('project-form-error');
  assert.ok(errorBox && errorBox.textContent.indexOf('名称不能为空') !== -1);

  // 输入合法名称与描述
  nameInput.value = '电商重构项目';
  if (descInput) descInput.value = '全新中台电商系统';
  saveBtn.click();

  assert.ok(selectedId, '创建成功后应自动选中');
  var cur = h.Workspace.currentProject();
  assert.ok(cur);
  assert.strictEqual(cur.id, selectedId);
  assert.strictEqual(cur.name, '电商重构项目');
  assert.strictEqual(cur.description, '全新中台电商系统');
});

test('ProjectUI 同名项目和长项目名通过稳定 ID 索引且安全无串扰', function() {
  var ws = makeWorkspace();
  var h = createProjectUIHarness(ws);
  var selectedId = null;

  h.ProjectUI.init({
    onSelect: function(id) {
      selectedId = id;
    }
  });

  // 创建两个同名但 ID 不同的项目
  var p1 = h.Workspace.createProject({ name: '同一名称', description: '第一版' });
  var p2 = h.Workspace.createProject({ name: '同一名称', description: '第二版' });
  assert.notStrictEqual(p1.id, p2.id);

  h.ProjectUI.open();

  var p2Btn = h.dom.document.querySelector('[data-action="select-project"][data-project-id="' + p2.id + '"]');
  assert.ok(p2Btn);
  p2Btn.click();

  assert.strictEqual(selectedId, p2.id);
  assert.strictEqual(h.Workspace.currentProject().id, p2.id);
  assert.strictEqual(h.Workspace.currentProject().description, '第二版');
});

test('ProjectUI 严格转义用户输入防止 XSS', function() {
  var ws = makeWorkspace();
  var maliciousName = '<script>window._xss=1;</script><img src=x onerror=alert(1)>';
  ws.projects.push({
    id: 'p-xss',
    name: maliciousName,
    description: '<script>evil()</script>',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    status: 'active',
    archived: false,
    data: makeProjectData()
  });

  var h = createProjectUIHarness(ws);
  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  var html = h.dom.modalBox.innerHTML;
  // 必须转义，不能直接出现未转义的标签
  assert.strictEqual(html.indexOf('<script>window._xss=1;</script>'), -1);
  assert.ok(html.indexOf('&lt;script&gt;') !== -1 || html.indexOf('&#39;') !== -1);
  assert.strictEqual(h.app.context.window._xss, undefined);
});

test('ProjectUI 项目改名、编辑描述、标记完成与归档操作', function() {
  var ws = makeWorkspace();
  var h = createProjectUIHarness(ws);
  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  // 1. 标记完成
  var completeBtn = h.dom.document.querySelector('[data-action="toggle-status"][data-project-id="p-a"]');
  assert.ok(completeBtn, '应存在状态切换按钮');
  completeBtn.click();

  var projA = h.Workspace.data.projects.find(function(p) { return p.id === 'p-a'; });
  assert.strictEqual(projA.status, 'completed');

  // 2. 归档
  var archiveBtn = h.dom.document.querySelector('[data-action="toggle-archive"][data-project-id="p-a"]');
  assert.ok(archiveBtn, '应存在归档按钮');
  archiveBtn.click();

  var projAArchived = h.Workspace.data.projects.find(function(p) { return p.id === 'p-a'; });
  assert.strictEqual(projAArchived.archived, true);
  assert.strictEqual(projAArchived.status, 'completed');

  // 3. 恢复归档
  var toggleArchived = h.dom.document.getElementById('toggle-show-archived');
  toggleArchived.checked = true;
  toggleArchived.dispatchEvent({ type: 'change' });

  var unarchiveBtn = h.dom.document.querySelector('[data-action="toggle-archive"][data-project-id="p-a"]');
  assert.ok(unarchiveBtn);
  unarchiveBtn.click();

  var projARestored = h.Workspace.data.projects.find(function(p) { return p.id === 'p-a'; });
  assert.strictEqual(projARestored.archived, false);
  assert.strictEqual(projARestored.status, 'completed', '恢复归档保留 completed 状态');
});

test('ProjectUI 删除入口将项目移入回收站并显示确认，禁止直接永久删除', function() {
  var ws = makeWorkspace();
  var h = createProjectUIHarness(ws);
  var selected = 'initial';
  h.ProjectUI.init({ onSelect: function(p) { selected = p; } });
  h.ProjectUI.open();

  var deleteBtn = h.dom.document.querySelector('[data-action="delete-project"][data-project-id="p-a"]');
  assert.ok(deleteBtn, '应存在删除项目按钮');

  // 1. 取消删除
  h.app.context.confirm = function() { return false; };
  deleteBtn.click();
  assert.strictEqual(h.Workspace.data.projects.length, 2, '取消时不得删除');

  // 2. 确认移入回收站
  h.app.context.confirm = function() { return true; };
  deleteBtn.click();

  assert.strictEqual(h.Workspace.data.projects.length, 1, '确认后从活动项目移出');
  assert.strictEqual(h.Workspace.data.recycleBin.length, 1, '移入持久回收站');
  assert.strictEqual(h.Workspace.data.recycleBin[0].kind, 'project');
  assert.strictEqual(h.Workspace.data.recycleBin[0].projectId, 'p-a');
  var html = h.dom.modalBox.innerHTML;
  assert.ok(html.indexOf('回收站') !== -1);
});

test('ProjectUI 启动偏好设置同步写入 Workspace.setStartup', function() {
  var ws = makeWorkspace();
  var h = createProjectUIHarness(ws);
  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  var startupSelect = h.dom.document.getElementById('project-startup-mode');
  assert.ok(startupSelect, '应存在启动偏好设置控件');

  startupSelect.value = 'fixed';
  var defaultProjectSelect = h.dom.document.getElementById('project-default-select');
  if (defaultProjectSelect) defaultProjectSelect.value = 'p-b';
  startupSelect.dispatchEvent({ type: 'change' });

  assert.strictEqual(h.Workspace.data.settings.startupMode, 'fixed');
});

test('ProjectUI 在只读工作区下拒绝新建项目，保护原始存储不变', function() {
  var corrupt = '{broken: json';
  var h = createProjectUIHarness(null, { initialRaw: corrupt });

  assert.strictEqual(h.Workspace.isReadOnly(), true);

  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  var btnNew = h.dom.document.getElementById('btn-new-project');
  if (btnNew) {
    btnNew.click();
    var saveBtn = h.dom.document.getElementById('btn-save-new-project');
    var nameInput = h.dom.document.getElementById('new-project-name');
    if (saveBtn && nameInput) {
      nameInput.value = '非法新项目';
      saveBtn.click();
    }
  }

  // 原始存储内容完全未被更改
  assert.strictEqual(h.app.localStorage.getItem('pmweb_data'), corrupt);
});

test('ProjectUI 归档项目不可编辑与修改状态', function() {
  var ws = makeWorkspace();
  // 将 p-a 归档
  ws.projects[0].archived = true;
  var h = createProjectUIHarness(ws);
  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  // 开启显示归档
  var toggle = h.dom.document.getElementById('toggle-show-archived');
  assert.ok(toggle, '应存在显示归档切换复选框');
  toggle.checked = true;
  toggle.dispatchEvent({ type: 'change' });

  // 归档项目 p-a 卡片内不应存在 edit-project 与 toggle-status 按钮（或按钮 disabled）
  var pAItem = h.dom.document.querySelector('[data-project-id="p-a"]');
  assert.ok(pAItem, '列表中应存在已归档项目 p-a');
  var editBtn = pAItem.querySelector('[data-action="edit-project"]');
  assert.strictEqual(editBtn === null, true, '已归档项目不应渲染编辑按钮');
  var statusBtn = pAItem.querySelector('[data-action="toggle-status"]');
  assert.strictEqual(statusBtn === null, true, '已归档项目不应渲染修改完成状态按钮');
});

test('ProjectUI 连续输入搜索保持输入节点身份、焦点与过滤有效性', function() {
  var ws = makeWorkspace();
  var h = createProjectUIHarness(ws);
  h.ProjectUI.init({ onSelect: function() {} });
  h.ProjectUI.open();

  var searchInput = h.dom.document.getElementById('project-search-input');
  assert.ok(searchInput, '初始应存在搜索框');

  // 模拟连续键入字符：'项' -> '项目' -> '项目 B'
  searchInput.value = '项';
  searchInput.dispatchEvent({ type: 'input' });

  var inputAfter1 = h.dom.document.getElementById('project-search-input');
  assert.strictEqual(inputAfter1, searchInput, '第1次输入后搜索框DOM节点身份不应改变');

  searchInput.value = '项目';
  searchInput.dispatchEvent({ type: 'input' });
  var inputAfter2 = h.dom.document.getElementById('project-search-input');
  assert.strictEqual(inputAfter2, searchInput, '第2次输入后搜索框DOM节点身份不应改变');

  searchInput.value = '项目 B';
  searchInput.dispatchEvent({ type: 'input' });
  var inputAfter3 = h.dom.document.getElementById('project-search-input');
  assert.strictEqual(inputAfter3, searchInput, '第3次输入后搜索框DOM节点身份不应改变');

  // 验证搜索过滤正确
  var listEl = h.dom.document.querySelector('.project-list');
  assert.ok(listEl.textContent.indexOf('项目 B') !== -1, '列表应包含项目 B');
  assert.strictEqual(listEl.textContent.indexOf('项目 A'), -1, '列表不应包含项目 A');

  // 切换 showArchived 后搜索行为仍有效
  var toggleArchived = h.dom.document.getElementById('toggle-show-archived');
  toggleArchived.checked = true;
  toggleArchived.dispatchEvent({ type: 'change' });

  // 搜索框仍是同一节点
  var inputAfterToggle = h.dom.document.getElementById('project-search-input');
  assert.strictEqual(inputAfterToggle, searchInput, '切换归档后搜索框DOM节点身份不应改变');

  // 搜索框清空并重新搜索
  searchInput.value = '项目 A';
  searchInput.dispatchEvent({ type: 'input' });
  assert.ok(listEl.textContent.indexOf('项目 A') !== -1);
  assert.strictEqual(listEl.textContent.indexOf('项目 B'), -1);
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

console.log('\nproject-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
