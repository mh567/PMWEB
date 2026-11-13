'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'work-calendar.js',
  'progress.js',
  'baseline.js',
  'links.js',
  'task-manager.js'
]);

var TaskManager = app.get('TaskManager');
var History = app.get('History');

var renders = 0;

function reset() {
  app.localStorage._store = {};
  app.alerts.length = 0;
  renders = 0;
  helper.resetProject(app);
  TaskManager.setChangeHandler(function() { renders++; });
  return TaskManager;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function names(tasks) {
  return plain(tasks.map(function(task) { return task.name; }));
}

function rootOrder() {
  return plain(TaskManager.getRootTasks().map(function(task) { return task.name + ':' + task.order; }));
}

function childNames(parentId) {
  return plain(TaskManager.getChildren(parentId).map(function(task) { return task.name; }));
}

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---- 任务增删改 ----

test('新增任务可撤销和重做，并触发渲染回调', function() {
  reset();
  var task = TaskManager.addTask(null, '任务A');
  assert.ok(task && task.id);
  assert.strictEqual(TaskManager.getAllTasks().length, 1);
  assert.strictEqual(TaskManager.canUndo(), true);
  assert.strictEqual(TaskManager.canRedo(), false);
  assert.strictEqual(renders, 0);

  assert.ok(TaskManager.undo());
  assert.strictEqual(TaskManager.getTask(task.id), null);
  assert.strictEqual(TaskManager.canRedo(), true);
  assert.strictEqual(renders, 1);

  assert.ok(TaskManager.redo());
  assert.strictEqual(TaskManager.getTask(task.id).name, '任务A');
  assert.strictEqual(renders, 2);
});

test('新增子任务撤销后索引同步重建', function() {
  reset();
  var parent = TaskManager.addTask(null, '父');
  var child = TaskManager.addTask(parent.id, '子');
  assert.strictEqual(TaskManager.getChildren(parent.id).length, 1);

  TaskManager.undo();
  assert.strictEqual(TaskManager.getChildren(parent.id).length, 0);
  assert.strictEqual(TaskManager.getTask(child.id), null);

  TaskManager.redo();
  assert.strictEqual(TaskManager.getChildren(parent.id).length, 1);
  assert.strictEqual(TaskManager.getTask(child.id).name, '子');
});

test('字段编辑只记录变更字段并可往返恢复', function() {
  reset();
  var task = TaskManager.addTask(null, '原名');
  TaskManager.clearHistory();
  renders = 0;

  TaskManager.updateTask(task.id, { name: '新名', status: 'done', progress: 100 });
  assert.strictEqual(TaskManager.getTask(task.id).name, '新名');
  assert.strictEqual(TaskManager.getTask(task.id).status, 'done');
  assert.strictEqual(TaskManager.history.size(), 1);
  assert.strictEqual(TaskManager.getTask(task.id).description, '');

  TaskManager.undo();
  var restored = TaskManager.getTask(task.id);
  assert.strictEqual(restored.name, '原名');
  assert.strictEqual(restored.status, 'todo');
  assert.strictEqual(restored.progress, 0);
  assert.strictEqual(renders, 1);

  TaskManager.redo();
  assert.strictEqual(TaskManager.getTask(task.id).name, '新名');
  assert.strictEqual(TaskManager.getTask(task.id).status, 'done');
});

test('没有实际变化时不产生历史记录', function() {
  reset();
  var task = TaskManager.addTask(null, '任务');
  TaskManager.clearHistory();

  TaskManager.updateTask(task.id, { name: '任务' });
  assert.strictEqual(TaskManager.canUndo(), false);
});

test('删除任务撤销后恢复子树、里程碑和依赖', function() {
  reset();
  var parent = TaskManager.addTask(null, '父');
  var child = TaskManager.addTask(parent.id, '子');
  var milestone = TaskManager.addMilestone(child.id, '里程碑', child.startDate);
  var link = TaskManager.addLink(child.id, parent.id, 'FS', 0);
  assert.strictEqual(link.ok, true);
  TaskManager.clearHistory();

  TaskManager.deleteTask(parent.id);
  assert.strictEqual(TaskManager.getAllTasks().length, 0);
  assert.strictEqual(TaskManager.getAllMilestones().length, 0);
  assert.strictEqual(TaskManager.getLinks().length, 0);

  TaskManager.undo();
  assert.strictEqual(TaskManager.getAllTasks().length, 2);
  assert.ok(TaskManager.getTask(parent.id));
  assert.ok(TaskManager.getTask(child.id));
  assert.ok(TaskManager.getMilestone(milestone.id));
  assert.strictEqual(TaskManager.getMilestone(milestone.id).taskId, child.id);
  assert.strictEqual(TaskManager.getLinks().length, 1);

  TaskManager.redo();
  assert.strictEqual(TaskManager.getAllTasks().length, 0);
  assert.strictEqual(TaskManager.getLinks().length, 0);
});

// ---- 移动 ----

test('同层移动撤销和重做恢复兄弟顺序', function() {
  reset();
  var a = TaskManager.addTask(null, 'A');
  TaskManager.addTask(null, 'B');
  var c = TaskManager.addTask(null, 'C');
  TaskManager.clearHistory();

  assert.strictEqual(TaskManager.moveTask(c.id, null, 0), true);
  assert.deepStrictEqual(rootOrder(), ['C:0', 'A:1', 'B:2']);

  TaskManager.undo();
  assert.deepStrictEqual(rootOrder(), ['A:0', 'B:1', 'C:2']);

  TaskManager.redo();
  assert.deepStrictEqual(rootOrder(), ['C:0', 'A:1', 'B:2']);
});

test('跨父移动撤销后回到原父级和位置', function() {
  reset();
  var parent = TaskManager.addTask(null, 'P');
  var first = TaskManager.addTask(parent.id, 'A1');
  TaskManager.addTask(parent.id, 'A2');
  var other = TaskManager.addTask(null, 'B');
  TaskManager.clearHistory();

  assert.strictEqual(TaskManager.moveTask(first.id, other.id, 0), true);
  assert.strictEqual(TaskManager.getTask(first.id).parentId, other.id);
  assert.strictEqual(TaskManager.getChildren(other.id).length, 1);
  assert.strictEqual(TaskManager.getChildren(parent.id).length, 1);

  TaskManager.undo();
  assert.strictEqual(TaskManager.getTask(first.id).parentId, parent.id);
  assert.strictEqual(TaskManager.getChildren(other.id).length, 0);
  assert.deepStrictEqual(childNames(parent.id), ['A1', 'A2']);

  TaskManager.redo();
  assert.strictEqual(TaskManager.getTask(first.id).parentId, other.id);
  assert.deepStrictEqual(childNames(parent.id), ['A2']);
});

// ---- 里程碑 ----

test('里程碑新增、编辑和删除都可撤销重做', function() {
  reset();
  var task = TaskManager.addTask(null, '任务');
  TaskManager.clearHistory();

  var milestone = TaskManager.addMilestone(task.id, '里程碑', task.startDate);
  assert.ok(TaskManager.getMilestone(milestone.id));
  TaskManager.undo();
  assert.strictEqual(TaskManager.getMilestone(milestone.id), null);
  TaskManager.redo();
  assert.ok(TaskManager.getMilestone(milestone.id));

  TaskManager.clearHistory();
  TaskManager.updateMilestone(milestone.id, { status: 'done' });
  assert.strictEqual(TaskManager.getMilestone(milestone.id).status, 'done');
  TaskManager.undo();
  assert.strictEqual(TaskManager.getMilestone(milestone.id).status, 'pending');
  TaskManager.redo();
  assert.strictEqual(TaskManager.getMilestone(milestone.id).status, 'done');

  TaskManager.clearHistory();
  TaskManager.deleteMilestone(milestone.id);
  assert.strictEqual(TaskManager.getMilestone(milestone.id), null);
  TaskManager.undo();
  assert.strictEqual(TaskManager.getMilestone(milestone.id).status, 'done');
});

// ---- 批量与事务 ----

test('批量改状态合并成一条历史记录', function() {
  reset();
  var a = TaskManager.addTask(null, 'A');
  var b = TaskManager.addTask(null, 'B');
  var c = TaskManager.addTask(null, 'C');
  TaskManager.clearHistory();
  renders = 0;

  TaskManager.updateTasks([a.id, b.id, c.id], { status: 'done' });
  assert.strictEqual(TaskManager.history.size(), 1);
  assert.strictEqual(TaskManager.getTask(a.id).status, 'done');
  assert.strictEqual(TaskManager.getTask(b.id).status, 'done');
  assert.strictEqual(TaskManager.getTask(c.id).status, 'done');

  TaskManager.undo();
  assert.strictEqual(renders, 1);
  assert.strictEqual(TaskManager.getTask(a.id).status, 'todo');
  assert.strictEqual(TaskManager.getTask(b.id).status, 'todo');
  assert.strictEqual(TaskManager.getTask(c.id).status, 'todo');
  assert.strictEqual(TaskManager.canUndo(), false);

  TaskManager.redo();
  assert.strictEqual(TaskManager.getTask(c.id).status, 'done');
});

test('事务把新增和后续编辑合并为单条命令', function() {
  reset();
  var created = null;

  TaskManager.transaction('新建任务', function() {
    created = TaskManager.addTask(null, '新任务');
    TaskManager.updateTask(created.id, { description: '描述', assignee: '张三' });
  });

  assert.ok(created);
  assert.strictEqual(TaskManager.history.size(), 1);
  assert.strictEqual(TaskManager.getTask(created.id).description, '描述');

  TaskManager.undo();
  assert.strictEqual(TaskManager.getTask(created.id), null);
  assert.strictEqual(TaskManager.canUndo(), false);

  TaskManager.redo();
  assert.strictEqual(TaskManager.getTask(created.id).description, '描述');
  assert.strictEqual(TaskManager.getTask(created.id).assignee, '张三');
});

test('事务把多个任务的编辑合并为一条命令', function() {
  reset();
  var a = TaskManager.addTask(null, 'A');
  var b = TaskManager.addTask(null, 'B');
  TaskManager.clearHistory();

  TaskManager.transaction('批量编辑', function() {
    TaskManager.updateTask(a.id, { assignee: '李四' });
    TaskManager.updateTask(b.id, { assignee: '王五' });
  });

  assert.strictEqual(TaskManager.history.size(), 1);
  TaskManager.undo();
  assert.strictEqual(TaskManager.getTask(a.id).assignee, '');
  assert.strictEqual(TaskManager.getTask(b.id).assignee, '');
});

// ---- 栈顺序与边界 ----

test('撤销栈后进先出，新命令清空重做栈', function() {
  reset();
  var a = TaskManager.addTask(null, 'A');
  var b = TaskManager.addTask(null, 'B');

  TaskManager.undo();
  assert.deepStrictEqual(names(TaskManager.getAllTasks()), ['A']);
  TaskManager.undo();
  assert.deepStrictEqual(names(TaskManager.getAllTasks()), []);

  assert.ok(TaskManager.redo());
  assert.deepStrictEqual(names(TaskManager.getAllTasks()), ['A']);
  assert.ok(TaskManager.redo());
  assert.deepStrictEqual(names(TaskManager.getAllTasks()), ['A', 'B']);

  TaskManager.undo();
  assert.strictEqual(TaskManager.canRedo(), true);
  TaskManager.addTask(null, 'C');
  assert.strictEqual(TaskManager.canRedo(), false);
  assert.deepStrictEqual(names(TaskManager.getAllTasks()), ['A', 'C']);
  assert.strictEqual(b.id.length > 0, true);
});

test('空栈撤销重做返回 null 且不触发渲染', function() {
  reset();
  renders = 0;
  assert.strictEqual(TaskManager.undo(), null);
  assert.strictEqual(TaskManager.redo(), null);
  assert.strictEqual(renders, 0);
  assert.strictEqual(TaskManager.canUndo(), false);
  assert.strictEqual(TaskManager.canRedo(), false);
});

test('History.push 不重复执行 redo', function() {
  reset();
  var stack = History.create();
  var applied = 0;
  stack.push({
    label: '手动入栈',
    undo: function() { applied--; },
    redo: function() { applied++; }
  });
  assert.strictEqual(applied, 0);
  assert.strictEqual(stack.canUndo(), true);
  stack.undo();
  assert.strictEqual(applied, -1);
  stack.redo();
  assert.strictEqual(applied, 0);
});

test('初始化历史为空', function() {
  reset();
  assert.strictEqual(TaskManager.canUndo(), false);
  assert.strictEqual(TaskManager.canRedo(), false);
  assert.strictEqual(TaskManager.history.size(), 0);
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

console.log('\nhistory-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
