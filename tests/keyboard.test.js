'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'task-manager.js',
  'row-model.js',
  'column-config.js',
  'cell-editor.js',
  'grid-pane.js'
]);
var GridPane = app.get('GridPane');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function makeRows(count) {
  var rows = [];
  for (var i = 0; i < count; i++) rows.push({ id: 't' + i });
  return rows;
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('getNavigationIndex 上下移动并停在边界', function() {
  assert.strictEqual(GridPane.getNavigationIndex(2, 'ArrowDown', 5), 3);
  assert.strictEqual(GridPane.getNavigationIndex(4, 'ArrowDown', 5), 4);
  assert.strictEqual(GridPane.getNavigationIndex(2, 'ArrowUp', 5), 1);
  assert.strictEqual(GridPane.getNavigationIndex(0, 'ArrowUp', 5), 0);
});

test('getNavigationIndex 支持 Home 和 End', function() {
  assert.strictEqual(GridPane.getNavigationIndex(3, 'Home', 5), 0);
  assert.strictEqual(GridPane.getNavigationIndex(1, 'End', 5), 4);
  assert.strictEqual(GridPane.getNavigationIndex(-1, 'Home', 5), 0);
});

test('getNavigationIndex 处理空表和非法输入', function() {
  assert.strictEqual(GridPane.getNavigationIndex(0, 'ArrowDown', 0), -1);
  assert.strictEqual(GridPane.getNavigationIndex(0, 'ArrowDown', -3), -1);
  assert.strictEqual(GridPane.getNavigationIndex(0, 'ArrowDown', 'abc'), -1);
  assert.strictEqual(GridPane.getNavigationIndex(null, 'ArrowDown', 3), 0);
  assert.strictEqual(GridPane.getNavigationIndex(1, 'PageDown', 3), 1);
});

test('getRovingTabIndex 只有当前行返回 0', function() {
  assert.strictEqual(GridPane.getRovingTabIndex(0, 0), 0);
  assert.strictEqual(GridPane.getRovingTabIndex(1, 0), -1);
  assert.strictEqual(GridPane.getRovingTabIndex(9, 9), 0);
  assert.strictEqual(GridPane.getRovingTabIndex(2, -1), -1);
});

test('getActiveRowIndex 优先选中行，其次 roving 行', function() {
  var rows = makeRows(4);
  assert.strictEqual(GridPane.getActiveRowIndex(rows, 't2', 't0'), 2);
  assert.strictEqual(GridPane.getActiveRowIndex(rows, null, 't3'), 3);
  assert.strictEqual(GridPane.getActiveRowIndex(rows, 'missing', 't1'), 1);
  assert.strictEqual(GridPane.getActiveRowIndex(rows, null, null), 0);
  assert.strictEqual(GridPane.getActiveRowIndex([], 't0', 't0'), -1);
});

test('getCollapseCommand 只对父任务返回动作', function() {
  var expanded = { hasChildren: true, isCollapsed: false };
  var collapsed = { hasChildren: true, isCollapsed: true };
  var leaf = { hasChildren: false, isCollapsed: false };
  assert.strictEqual(GridPane.getCollapseCommand(expanded, 'ArrowLeft'), 'collapse');
  assert.strictEqual(GridPane.getCollapseCommand(collapsed, 'ArrowLeft'), null);
  assert.strictEqual(GridPane.getCollapseCommand(collapsed, 'ArrowRight'), 'expand');
  assert.strictEqual(GridPane.getCollapseCommand(expanded, 'ArrowRight'), null);
  assert.strictEqual(GridPane.getCollapseCommand(leaf, 'ArrowLeft'), null);
  assert.strictEqual(GridPane.getCollapseCommand(null, 'ArrowLeft'), null);
});

test('toggleSelection 增加、移除且不修改原数组', function() {
  var original = ['a', 'b'];
  var added = GridPane.toggleSelection(original, 'c');
  assert.deepStrictEqual(plain(added), ['a', 'b', 'c']);
  assert.deepStrictEqual(original, ['a', 'b']);

  var removed = GridPane.toggleSelection(original, 'a');
  assert.deepStrictEqual(plain(removed), ['b']);
  assert.deepStrictEqual(original, ['a', 'b']);

  assert.deepStrictEqual(plain(GridPane.toggleSelection(original, null)), ['a', 'b']);
});

test('getRangeSelection 支持正向、反向和边界收敛', function() {
  var rows = makeRows(5);
  assert.deepStrictEqual(plain(GridPane.getRangeSelection(rows, 1, 3)), ['t1', 't2', 't3']);
  assert.deepStrictEqual(plain(GridPane.getRangeSelection(rows, 3, 1)), ['t1', 't2', 't3']);
  assert.deepStrictEqual(plain(GridPane.getRangeSelection(rows, 0, 0)), ['t0']);
  assert.deepStrictEqual(plain(GridPane.getRangeSelection(rows, -5, 99)), ['t0', 't1', 't2', 't3', 't4']);
  assert.deepStrictEqual(plain(GridPane.getRangeSelection([], 0, 1)), []);
});

test('applyClickSelection 普通点击只保留目标行', function() {
  var rows = makeRows(4);
  var result = GridPane.applyClickSelection(rows, ['t1', 't2'], 1, 3, {});
  assert.deepStrictEqual(plain(result.selection), ['t3']);
  assert.strictEqual(result.primaryId, 't3');
  assert.strictEqual(result.anchorIndex, 3);
});

test('applyClickSelection Ctrl 切换选中并保持主选中', function() {
  var rows = makeRows(4);
  var added = GridPane.applyClickSelection(rows, ['t1'], 1, 2, { toggle: true });
  assert.deepStrictEqual(plain(added.selection), ['t1', 't2']);
  assert.strictEqual(added.primaryId, 't2');

  var removed = GridPane.applyClickSelection(rows, ['t1', 't2'], 1, 2, { toggle: true });
  assert.deepStrictEqual(plain(removed.selection), ['t1']);
  assert.strictEqual(removed.primaryId, 't1');

  var empty = GridPane.applyClickSelection(rows, ['t2'], 2, 2, { toggle: true });
  assert.deepStrictEqual(plain(empty.selection), []);
  assert.strictEqual(empty.primaryId, null);
});

test('applyClickSelection Shift 从锚点连续选择', function() {
  var rows = makeRows(5);
  var result = GridPane.applyClickSelection(rows, ['t0'], 1, 3, { shift: true });
  assert.deepStrictEqual(plain(result.selection), ['t1', 't2', 't3']);
  assert.strictEqual(result.primaryId, 't3');
  assert.strictEqual(result.anchorIndex, 1);
});

test('applyClickSelection 越界索引返回空选择', function() {
  var rows = makeRows(2);
  assert.deepStrictEqual(plain(GridPane.applyClickSelection(rows, [], 0, 5, {}).selection), []);
  assert.strictEqual(GridPane.applyClickSelection(rows, [], 0, -1, {}).primaryId, null);
});

test('getBulkStatusTargets 去重并回落到当前行', function() {
  var set = new Set(['a', 'b', 'a']);
  assert.deepStrictEqual(plain(GridPane.getBulkStatusTargets(set, 'c')), ['a', 'b']);
  assert.deepStrictEqual(plain(GridPane.getBulkStatusTargets(new Set(), 'c')), ['c']);
  assert.deepStrictEqual(plain(GridPane.getBulkStatusTargets([], 'c')), ['c']);
  assert.deepStrictEqual(plain(GridPane.getBulkStatusTargets(new Set(), null)), []);
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

console.log('\nkeyboard: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
