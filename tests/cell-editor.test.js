'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'store.js', 'column-config.js', 'task-manager.js', 'cell-editor.js']);
var CellEditor = app.get('CellEditor');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('controlFor 映射四类编辑器', function() {
  assert.strictEqual(CellEditor.controlFor('name'), 'text');
  assert.strictEqual(CellEditor.controlFor('assignee'), 'text');
  assert.strictEqual(CellEditor.controlFor('description'), 'text');
  assert.strictEqual(CellEditor.controlFor('startDate'), 'date');
  assert.strictEqual(CellEditor.controlFor('endDate'), 'date');
  assert.strictEqual(CellEditor.controlFor('plannedEndDate'), 'date');
  assert.strictEqual(CellEditor.controlFor('status'), 'select');
  assert.strictEqual(CellEditor.controlFor('progress'), 'progress');
  assert.strictEqual(CellEditor.controlFor('unknown'), null);
});

test('isEditable 只认可四类可编辑列', function() {
  assert.strictEqual(CellEditor.isEditable('name'), true);
  assert.strictEqual(CellEditor.isEditable('status'), true);
  assert.strictEqual(CellEditor.isEditable('progress'), true);
  assert.strictEqual(CellEditor.isEditable('endDate'), true);
  assert.strictEqual(CellEditor.isEditable('unknown'), false);
});

test('format 输出状态标签、百分比和日期文本', function() {
  assert.strictEqual(CellEditor.format('status', 'todo'), '未开始');
  assert.strictEqual(CellEditor.format('status', 'inProgress'), '进行中');
  assert.strictEqual(CellEditor.format('status', 'thirdParty'), '第三方');
  assert.strictEqual(CellEditor.format('status', 'done'), '已完成');
  assert.strictEqual(CellEditor.format('status', undefined), '');
  assert.strictEqual(CellEditor.format('progress', 0), '0%');
  assert.strictEqual(CellEditor.format('progress', 45), '45%');
  assert.strictEqual(CellEditor.format('progress', 120), '100%');
  assert.strictEqual(CellEditor.format('progress', null), '');
  assert.strictEqual(CellEditor.format('endDate', '2026-01-31'), '2026-01-31');
  assert.strictEqual(CellEditor.format('endDate', null), '');
  assert.strictEqual(CellEditor.format('name', '任务A'), '任务A');
});

test('文本解析：姓名去空格且不能为空', function() {
  assert.deepStrictEqual(plain(CellEditor.parse('name', '  任务A  ', {})),
    { ok: true, value: '任务A', error: null });
  var empty = CellEditor.parse('name', '   ', {});
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.error, '任务名称不能为空');
});

test('文本解析：负责人去空格，描述保留原文本', function() {
  assert.deepStrictEqual(plain(CellEditor.parse('assignee', '  张三 ', {})),
    { ok: true, value: '张三', error: null });
  assert.deepStrictEqual(plain(CellEditor.parse('description', ' 多行 描述 ', {})),
    { ok: true, value: ' 多行 描述 ', error: null });
  assert.strictEqual(CellEditor.parse('assignee', '', {}).ok, true);
});

test('日期解析：接受合法日期，拒绝格式错误和不存在日期', function() {
  assert.deepStrictEqual(plain(CellEditor.parse('startDate', '2026-01-05', {})),
    { ok: true, value: '2026-01-05', error: null });
  assert.strictEqual(CellEditor.parse('startDate', '2026-1-5', {}).error, '日期格式不正确');
  assert.strictEqual(CellEditor.parse('startDate', '2026-02-30', {}).error, '日期格式不正确');
  assert.strictEqual(CellEditor.parse('startDate', '2026-13-01', {}).error, '日期格式不正确');
  assert.strictEqual(CellEditor.parse('startDate', '', {}).error, '日期不能为空');
  assert.strictEqual(CellEditor.isValidDate('2024-02-29'), true);
  assert.strictEqual(CellEditor.isValidDate('2025-02-29'), false);
});

test('日期解析：结束日期不早于开始日期', function() {
  var task = { startDate: '2026-04-01' };
  assert.strictEqual(CellEditor.parse('endDate', '2026-03-31', task).error, '结束日期不能早于开始日期');
  assert.strictEqual(CellEditor.parse('endDate', '2026-04-01', task).ok, true);
  assert.strictEqual(CellEditor.parse('endDate', '2026-05-01', task).ok, true);
});

test('日期解析：开始日期不晚于结束日期', function() {
  var task = { endDate: '2026-04-01' };
  assert.strictEqual(CellEditor.parse('startDate', '2026-04-02', task).error, '开始日期不能晚于结束日期');
  assert.strictEqual(CellEditor.parse('startDate', '2026-04-01', task).ok, true);
});

test('计划完成日期只校验格式', function() {
  var task = { startDate: '2026-04-01', endDate: '2026-04-30' };
  assert.strictEqual(CellEditor.parse('plannedEndDate', '2026-03-01', task).ok, true);
  assert.strictEqual(CellEditor.parse('plannedEndDate', '2026-04-31', task).ok, false);
});

test('状态解析只允许 todo、inProgress、thirdParty、done', function() {
  ['todo', 'inProgress', 'thirdParty', 'done'].forEach(function(status) {
    assert.deepStrictEqual(plain(CellEditor.parse('status', status, {})),
      { ok: true, value: status, error: null });
  });
  var invalid = CellEditor.parse('status', 'blocked', {});
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.error, '状态不合法');
  assert.strictEqual(invalid.value, 'todo');
});

test('百分比解析：去掉百分号并收敛到 0 到 100', function() {
  assert.strictEqual(CellEditor.parse('progress', '45%', {}).value, 45);
  assert.strictEqual(CellEditor.parse('progress', '45 %', {}).value, 45);
  assert.strictEqual(CellEditor.parse('progress', '150', {}).value, 100);
  assert.strictEqual(CellEditor.parse('progress', '-5', {}).value, 0);
  assert.strictEqual(CellEditor.parse('progress', '33.6', {}).value, 34);
  assert.strictEqual(CellEditor.parse('progress', 0, {}).value, 0);
  assert.strictEqual(CellEditor.parse('progress', 100, {}).value, 100);
});

test('百分比解析：空值和非数字报错', function() {
  assert.strictEqual(CellEditor.parse('progress', '', {}).error, '进度不能为空');
  assert.strictEqual(CellEditor.parse('progress', 'abc', {}).error, '进度必须是数字');
  assert.strictEqual(CellEditor.parse('progress', '50%abc', {}).error, '进度必须是数字');
});

test('commit 在值未变化时返回 changed=false', function() {
  var task = { name: '任务A', progress: 50, status: 'done', startDate: '2026-01-01' };
  var nameResult = CellEditor.commit(task, 'name', ' 任务A ');
  assert.strictEqual(nameResult.changed, false);
  assert.strictEqual(nameResult.updates, null);
  assert.strictEqual(nameResult.error, null);

  assert.strictEqual(CellEditor.commit(task, 'progress', '50%').changed, false);
  assert.strictEqual(CellEditor.commit(task, 'status', 'done').changed, false);
  assert.strictEqual(CellEditor.commit(task, 'startDate', '2026-01-01').changed, false);
});

test('commit 在值变化时返回 updateTask 需要的更新对象', function() {
  var task = { name: '任务A', progress: 50, status: 'inProgress', startDate: '2026-01-01', endDate: '2026-01-31' };

  var nameResult = CellEditor.commit(task, 'name', '  任务B ');
  assert.deepStrictEqual(plain(nameResult.updates), { name: '任务B' });

  assert.deepStrictEqual(plain(CellEditor.commit(task, 'progress', '80%').updates), { progress: 80 });
  assert.deepStrictEqual(plain(CellEditor.commit(task, 'status', 'thirdParty').updates), { status: 'thirdParty' });
  assert.deepStrictEqual(plain(CellEditor.commit(task, 'endDate', '2026-02-15').updates), { endDate: '2026-02-15' });
  assert.deepStrictEqual(plain(CellEditor.commit(task, 'assignee', '李四').updates), { assignee: '李四' });
  assert.deepStrictEqual(plain(CellEditor.commit(task, 'description', '说明').updates), { description: '说明' });
});

test('commit 校验失败时不产生更新', function() {
  var task = { startDate: '2026-04-01', endDate: '2026-04-30' };
  var invalidDate = CellEditor.commit(task, 'endDate', '2026-03-01');
  assert.strictEqual(invalidDate.changed, false);
  assert.strictEqual(invalidDate.updates, null);
  assert.strictEqual(invalidDate.error, '结束日期不能早于开始日期');

  var invalidStatus = CellEditor.commit(task, 'status', 'blocked');
  assert.strictEqual(invalidStatus.changed, false);
  assert.strictEqual(invalidStatus.updates, null);
  assert.strictEqual(invalidStatus.error, '状态不合法');

  var invalidProgress = CellEditor.commit(task, 'progress', 'abc');
  assert.strictEqual(invalidProgress.error, '进度必须是数字');
});

test('未知列不可编辑且提交报错', function() {
  assert.strictEqual(CellEditor.parse('unknown', 'x', {}).error, '该列不支持编辑');
  var result = CellEditor.commit({}, 'unknown', 'x');
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.error, '该列不支持编辑');
});

test('cancel 不产生任何修改', function() {
  var result = CellEditor.cancel({ name: '任务A' }, 'name', '任务B');
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.updates, null);
  assert.strictEqual(result.error, null);
});

// ---------- Task 4 自定义字段单元测试 ----------

test('CellEditor 支持自定义列的 controlFor、format、parse 与 commit', function() {
  var numCol = { key: 'cf-num', type: 'number', builtin: false };
  assert.strictEqual(CellEditor.controlFor('cf-num', numCol), 'number');
  assert.strictEqual(CellEditor.isEditable('cf-num', numCol), true);
  assert.strictEqual(CellEditor.format('cf-num', 42.5, numCol), '42.5');
  assert.strictEqual(CellEditor.format('cf-num', null, numCol), '');

  var numParse = CellEditor.parse('cf-num', '99.9', {}, numCol);
  assert.deepStrictEqual(plain(numParse), { ok: true, value: 99.9, error: null });
  assert.strictEqual(CellEditor.parse('cf-num', 'invalid', {}, numCol).ok, false);

  var task = { id: 'T1', customFields: { 'cf-num': 10 } };
  var numCommit = CellEditor.commit(task, 'cf-num', '20', numCol);
  assert.strictEqual(numCommit.changed, true);
  assert.deepStrictEqual(plain(numCommit.updates), {
    customFields: { 'cf-num': 20 }
  });

  // 单选列
  var selCol = {
    key: 'cf-sel',
    type: 'select',
    builtin: false,
    options: [{ id: 'opt-1', label: '高优先级' }]
  };
  assert.strictEqual(CellEditor.controlFor('cf-sel', selCol), 'select');
  assert.strictEqual(CellEditor.format('cf-sel', 'opt-1', selCol), '高优先级');
  assert.strictEqual(CellEditor.parse('cf-sel', 'opt-1', {}, selCol).ok, true);
  assert.strictEqual(CellEditor.parse('cf-sel', 'unknown', {}, selCol).ok, false);
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

console.log('\ncell-editor: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
