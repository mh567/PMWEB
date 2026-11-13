'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var helper = require('./helpers/load');

var app = helper.createApp(['history.js']);
var History = app.get('History');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function makeRecorder() {
  var log = [];
  function make(name, options) {
    options = options || {};
    return {
      label: name,
      undo: function() {
        log.push('undo:' + name);
        if (options.undoThrows) throw new Error('undo ' + name);
      },
      redo: function() {
        log.push('redo:' + name);
        if (options.redoThrows) throw new Error('redo ' + name);
      }
    };
  }
  return { log: log, make: make };
}

// ---- 执行顺序 --------------------------------------------------

test('execute 按顺序压栈，undo 后进先出', function() {
  var rec = makeRecorder();
  var stack = History.create();
  stack.execute(rec.make('a'));
  stack.execute(rec.make('b'));

  assert.strictEqual(stack.size(), 2);
  assert.strictEqual(stack.canUndo(), true);
  assert.strictEqual(stack.canRedo(), false);

  stack.undo();
  stack.undo();

  assert.deepStrictEqual(rec.log, ['redo:a', 'redo:b', 'undo:b', 'undo:a']);
  assert.strictEqual(stack.size(), 0);
  assert.strictEqual(stack.canUndo(), false);
  assert.strictEqual(stack.canRedo(), true);
});

test('undo 后 redo 恢复顺序，并可再次 undo', function() {
  var rec = makeRecorder();
  var stack = History.create();
  stack.execute(rec.make('a'));
  stack.execute(rec.make('b'));
  stack.undo();
  stack.undo();
  rec.log.length = 0;

  stack.redo();
  stack.redo();

  assert.deepStrictEqual(rec.log, ['redo:a', 'redo:b']);
  assert.strictEqual(stack.size(), 2);
  assert.strictEqual(stack.canRedo(), false);

  stack.undo();
  assert.deepStrictEqual(rec.log, ['redo:a', 'redo:b', 'undo:b']);
});

test('execute、undo、redo 返回对应命令', function() {
  var rec = makeRecorder();
  var command = rec.make('a');
  var stack = History.create();

  assert.strictEqual(stack.execute(command), command);
  assert.strictEqual(stack.undo(), command);
  assert.strictEqual(stack.redo(), command);
});

// ---- redo 栈清空 ----------------------------------------------

test('执行新命令清空 redo 栈', function() {
  var rec = makeRecorder();
  var stack = History.create();
  stack.execute(rec.make('a'));
  stack.execute(rec.make('b'));
  stack.undo();
  assert.strictEqual(stack.canRedo(), true);

  stack.execute(rec.make('c'));

  assert.strictEqual(stack.canRedo(), false);
  assert.strictEqual(stack.size(), 2);
  rec.log.length = 0;
  stack.undo();
  stack.undo();
  assert.deepStrictEqual(rec.log, ['undo:c', 'undo:a']);
});

// ---- 上限淘汰 --------------------------------------------------

test('默认上限为 100', function() {
  assert.strictEqual(History.DEFAULT_LIMIT, 100);
  var rec = makeRecorder();
  var stack = History.create();
  for (var i = 0; i < 101; i++) stack.execute(rec.make('c' + i));
  assert.strictEqual(stack.size(), 100);
  rec.log.length = 0;
  for (var j = 0; j < 100; j++) stack.undo();
  assert.strictEqual(stack.canUndo(), false);
  assert.strictEqual(rec.log.length, 100);
  assert.strictEqual(rec.log[0], 'undo:c100');
  assert.strictEqual(rec.log[rec.log.length - 1], 'undo:c1');
  assert.strictEqual(rec.log.indexOf('undo:c0'), -1);
});

test('超过上限时丢弃最旧命令', function() {
  var rec = makeRecorder();
  var stack = History.create(2);
  stack.execute(rec.make('a'));
  stack.execute(rec.make('b'));
  stack.execute(rec.make('c'));

  assert.strictEqual(stack.size(), 2);
  rec.log.length = 0;
  stack.undo();
  stack.undo();
  assert.deepStrictEqual(rec.log, ['undo:c', 'undo:b']);
  assert.strictEqual(stack.canUndo(), false);
});

test('非法上限回退到默认值', function() {
  var rec = makeRecorder();
  [0, -5, 1.5, NaN, Infinity, '10', null].forEach(function(limit) {
    var stack = History.create(limit);
    for (var i = 0; i < 101; i++) stack.execute(rec.make('x' + i));
    assert.strictEqual(stack.size(), 100, 'limit=' + String(limit));
  });
});

// ---- 空栈 ------------------------------------------------------

test('空栈 undo 和 redo 安全返回 null', function() {
  var stack = History.create();
  assert.strictEqual(stack.undo(), null);
  assert.strictEqual(stack.redo(), null);
  assert.strictEqual(stack.canUndo(), false);
  assert.strictEqual(stack.canRedo(), false);
  assert.strictEqual(stack.size(), 0);
});

// ---- 异常处理 --------------------------------------------------

test('execute 失败时两个栈都不变', function() {
  var rec = makeRecorder();
  var stack = History.create();
  stack.execute(rec.make('a'));
  stack.undo();
  assert.strictEqual(stack.canRedo(), true);

  assert.throws(function() {
    stack.execute(rec.make('boom', { redoThrows: true }));
  }, /redo boom/);

  assert.strictEqual(stack.size(), 0);
  assert.strictEqual(stack.canUndo(), false);
  assert.strictEqual(stack.canRedo(), true);
});

test('undo 失败时命令留在撤销栈', function() {
  var rec = makeRecorder();
  var stack = History.create();
  stack.execute(rec.make('a', { undoThrows: true }));

  assert.throws(function() { stack.undo(); }, /undo a/);

  assert.strictEqual(stack.size(), 1);
  assert.strictEqual(stack.canUndo(), true);
  assert.strictEqual(stack.canRedo(), false);
});

test('redo 失败时命令留在重做栈', function() {
  var rec = makeRecorder();
  var stack = History.create();
  stack.execute(rec.make('a'));
  stack.undo();

  var failing = rec.make('b');
  stack.execute(failing);
  stack.undo();
  failing.redo = function() { throw new Error('redo b'); };

  assert.throws(function() { stack.redo(); }, /redo b/);

  assert.strictEqual(stack.canRedo(), true);
  assert.strictEqual(stack.size(), 0);
});

test('命令结构非法时抛 TypeError 且不改变栈', function() {
  var stack = History.create();
  var invalid = [null, undefined, {}, { undo: function() {} }, { redo: function() {} }];

  invalid.forEach(function(command) {
    assert.throws(function() { stack.execute(command); }, { name: 'TypeError' });
  });

  assert.strictEqual(stack.size(), 0);
  assert.strictEqual(stack.canUndo(), false);
  assert.strictEqual(stack.canRedo(), false);
});

// ---- clear -----------------------------------------------------

test('clear 后 canUndo 和 canRedo 均为 false', function() {
  var rec = makeRecorder();
  var stack = History.create();
  stack.execute(rec.make('a'));
  stack.execute(rec.make('b'));
  stack.undo();
  assert.strictEqual(stack.canUndo(), true);
  assert.strictEqual(stack.canRedo(), true);

  stack.clear();

  assert.strictEqual(stack.size(), 0);
  assert.strictEqual(stack.canUndo(), false);
  assert.strictEqual(stack.canRedo(), false);
  assert.strictEqual(stack.undo(), null);
  assert.strictEqual(stack.redo(), null);
});

// ---- 纯内存，不修改外部状态 ------------------------------------

test('模块只调用命令方法，不修改命令对象', function() {
  var external = { value: 0 };
  var command = {
    label: 'counter',
    undo: function() { external.value--; },
    redo: function() { external.value++; }
  };
  var snapshot = Object.keys(command).sort();

  var stack = History.create();
  stack.execute(command);
  stack.undo();
  stack.redo();
  stack.clear();

  assert.strictEqual(external.value, 1);
  assert.deepStrictEqual(Object.keys(command).sort(), snapshot);
});

test('加载和执行都不访问 localStorage 与 DOM', function() {
  var source = fs.readFileSync(path.join(__dirname, '..', 'js', 'history.js'), 'utf8');
  var sandbox = { console: console };
  ['localStorage', 'sessionStorage', 'document', 'window'].forEach(function(name) {
    Object.defineProperty(sandbox, name, {
      configurable: true,
      get: function() { throw new Error('History 不应访问 ' + name); }
    });
  });

  var context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'js/history.js' });
  var Isolated = vm.runInContext('History', context);

  var log = [];
  var stack = Isolated.create(5);
  stack.execute({
    label: 'noop',
    undo: function() { log.push('undo'); },
    redo: function() { log.push('redo'); }
  });
  stack.undo();
  stack.redo();

  assert.deepStrictEqual(log, ['redo', 'undo', 'redo']);
  assert.strictEqual(stack.size(), 1);
});

test('两个栈实例互不影响', function() {
  var rec = makeRecorder();
  var first = History.create();
  var second = History.create();

  first.execute(rec.make('a'));
  second.execute(rec.make('b'));

  assert.strictEqual(first.size(), 1);
  assert.strictEqual(second.size(), 1);
  first.undo();
  assert.strictEqual(first.canUndo(), false);
  assert.strictEqual(second.canUndo(), true);
});

test('删除与撤销重做支持动态批次生成且不串扰命令状态', function() {
  var currentBatchId = null;
  var batchLog = [];
  var stack = History.create();

  var deleteCommand = {
    label: '删除任务',
    undo: function() {
      batchLog.push('undo:' + currentBatchId);
      currentBatchId = null;
    },
    redo: function() {
      currentBatchId = 'batch-' + Math.random().toString(36).slice(2, 6);
      batchLog.push('redo:' + currentBatchId);
    }
  };

  stack.execute(deleteCommand);
  var firstBatch = currentBatchId;
  assert.ok(firstBatch);

  stack.undo();
  assert.strictEqual(currentBatchId, null);
  assert.strictEqual(batchLog[1], 'undo:' + firstBatch);

  stack.redo();
  var secondBatch = currentBatchId;
  assert.ok(secondBatch);
  assert.notStrictEqual(secondBatch, firstBatch);
  assert.strictEqual(batchLog[2], 'redo:' + secondBatch);

  stack.undo();
  assert.strictEqual(batchLog[3], 'undo:' + secondBatch);
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

console.log('\nhistory: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
