'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

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

function createModalHarness() {
  var app = helper.createApp(['modal.js']);
  return app.get('ModalManager');
}

function fakeContent(title) {
  var attrs = {};
  return {
    innerHTML: '',
    _attrs: attrs,
    setAttribute: function(name, value) { attrs[name] = String(value); },
    removeAttribute: function(name) { delete attrs[name]; },
    getAttribute: function(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    querySelector: function(selector) {
      if (selector === '.modal-title') return title || null;
      return null;
    },
    querySelectorAll: function() { return []; },
    contains: function() { return false; },
    focus: function() {}
  };
}

function fakeOverlay(active) {
  var classes = new Set(active ? ['active'] : []);
  return {
    classList: {
      contains: function(name) { return classes.has(name); },
      add: function(name) { classes.add(name); },
      remove: function(name) { classes.delete(name); }
    }
  };
}

test('Escape 是唯一触发关闭的按键', function() {
  var ModalManager = createModalHarness();
  assert.strictEqual(ModalManager._shouldCloseForKey('Escape'), true);
  assert.strictEqual(ModalManager._shouldCloseForKey('Enter'), false);
  assert.strictEqual(ModalManager._shouldCloseForKey('Tab'), false);
});

test('Escape 在弹窗打开时关闭弹窗', function() {
  var ModalManager = createModalHarness();
  ModalManager.overlay = fakeOverlay(true);
  ModalManager.content = fakeContent(null);
  var prevented = false;
  var handled = ModalManager._handleKeyDown({
    key: 'Escape',
    preventDefault: function() { prevented = true; }
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(prevented, true);
  assert.strictEqual(ModalManager.isOpen(), false);
});

test('关闭后焦点恢复到打开前的元素', function() {
  var ModalManager = createModalHarness();
  ModalManager.overlay = fakeOverlay(true);
  ModalManager.content = fakeContent(null);
  var restored = 0;
  ModalManager._lastFocused = {
    focus: function() { restored += 1; }
  };
  ModalManager.close();
  assert.strictEqual(restored, 1);
  assert.strictEqual(ModalManager._lastFocused, null);
});

test('焦点陷阱在首尾循环', function() {
  var ModalManager = createModalHarness();
  assert.strictEqual(ModalManager._nextFocusIndex(0, 3, true), 2);
  assert.strictEqual(ModalManager._nextFocusIndex(2, 3, false), 0);
  assert.strictEqual(ModalManager._nextFocusIndex(1, 3, false), 2);
  assert.strictEqual(ModalManager._nextFocusIndex(1, 3, true), 0);
  assert.strictEqual(ModalManager._nextFocusIndex(-1, 3, false), 0);
  assert.strictEqual(ModalManager._nextFocusIndex(-1, 3, true), 2);
  assert.strictEqual(ModalManager._nextFocusIndex(0, 0, false), -1);
});

test('弹窗装饰写入 dialog 语义', function() {
  var ModalManager = createModalHarness();
  var title = { id: '' };
  ModalManager.content = fakeContent(title);
  ModalManager._decorate();
  assert.strictEqual(ModalManager.content.getAttribute('role'), 'dialog');
  assert.strictEqual(ModalManager.content.getAttribute('aria-modal'), 'true');
  assert.strictEqual(title.id, 'modal-title');
  assert.strictEqual(ModalManager.content.getAttribute('aria-labelledby'), 'modal-title');
});

console.log('\naccessibility: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exitCode = 1;
}
