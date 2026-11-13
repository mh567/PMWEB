'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['comments.js', 'activity.js', 'attachment-meta.js']);
var Comments = app.get('Comments');
var Activity = app.get('Activity');
var AttachmentMeta = app.get('AttachmentMeta');

var managerApp = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'task-manager.js'
]);
var Manager = managerApp.get('TaskManager');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

function snapshot(value) {
  return JSON.stringify(value);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function resetManager() {
  managerApp.localStorage._store = {};
  managerApp.alerts.length = 0;
  helper.resetProject(managerApp);
  return Manager;
}

// ------------------------------------------------------------
// Comments
// ------------------------------------------------------------

test('Comments.create: 生成完整评论并保留文本内部空白', function() {
  var comment = Comments.create('task-1', '  alice  ', '  第一行\n  第二行  ', '2026-01-01T00:00:00.000Z');
  assert.ok(/^comment-/.test(comment.id));
  assert.strictEqual(comment.taskId, 'task-1');
  assert.strictEqual(comment.author, 'alice');
  assert.strictEqual(comment.text, '第一行\n  第二行');
  assert.strictEqual(comment.createdAt, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(comment.updatedAt, null);
});

test('Comments.create: 未传 createdAt 时生成时间戳', function() {
  var comment = Comments.create('task-1', 'alice', 'hello');
  assert.strictEqual(typeof comment.createdAt, 'string');
  assert.ok(comment.createdAt.length > 0);
});

test('Comments.create: 拒绝空文本和纯空白文本', function() {
  assert.strictEqual(Comments.create('task-1', 'alice', ''), null);
  assert.strictEqual(Comments.create('task-1', 'alice', '   \n\t '), null);
  assert.strictEqual(Comments.create('task-1', 'alice', null), null);
  assert.strictEqual(Comments.create('task-1', 'alice', 123), null);
});

test('Comments.create: 文本长度边界', function() {
  var max = new Array(Comments.MAX_TEXT_LENGTH + 1).join('a');
  assert.strictEqual(max.length, Comments.MAX_TEXT_LENGTH);
  assert.ok(Comments.create('task-1', 'alice', max));
  assert.strictEqual(Comments.create('task-1', 'alice', max + 'a'), null);
});

test('Comments.create: 拒绝非法任务 ID 和空作者', function() {
  assert.strictEqual(Comments.create('bad id', 'alice', 'hello'), null);
  assert.strictEqual(Comments.create('', 'alice', 'hello'), null);
  assert.strictEqual(Comments.create(null, 'alice', 'hello'), null);
  assert.strictEqual(Comments.create('task-1', '   ', 'hello'), null);
  assert.strictEqual(Comments.create('task-1', null, 'hello'), null);
});

test('Comments.create: 作者长度上限', function() {
  var max = new Array(Comments.MAX_AUTHOR_LENGTH + 1).join('a');
  assert.ok(Comments.create('task-1', max, 'hello'));
  assert.strictEqual(Comments.create('task-1', max + 'a', 'hello'), null);
});

test('Comments.update: 返回新评论且不修改入参', function() {
  var original = Comments.create('task-1', 'alice', '旧文本', '2026-01-01T00:00:00.000Z');
  var before = snapshot(original);
  var updated = Comments.update(original, '  新文本  ', '2026-01-02T00:00:00.000Z');

  assert.notStrictEqual(updated, original);
  assert.strictEqual(updated.id, original.id);
  assert.strictEqual(updated.taskId, original.taskId);
  assert.strictEqual(updated.author, original.author);
  assert.strictEqual(updated.createdAt, original.createdAt);
  assert.strictEqual(updated.text, '新文本');
  assert.strictEqual(updated.updatedAt, '2026-01-02T00:00:00.000Z');
  assert.strictEqual(snapshot(original), before);
});

test('Comments.update: 拒绝空文本、超长文本和非法评论', function() {
  var original = Comments.create('task-1', 'alice', '旧文本');
  assert.strictEqual(Comments.update(original, '   ', '2026-01-02T00:00:00.000Z'), null);
  assert.strictEqual(Comments.update(original,
    new Array(Comments.MAX_TEXT_LENGTH + 2).join('a'), '2026-01-02T00:00:00.000Z'), null);
  assert.strictEqual(Comments.update(null, '新文本', '2026-01-02T00:00:00.000Z'), null);
  assert.strictEqual(Comments.update([], '新文本', '2026-01-02T00:00:00.000Z'), null);
});

test('Comments.listByTask: 按时间升序并过滤其他任务', function() {
  var list = [
    Comments.create('task-1', 'bob', '第三条', '2026-01-03T00:00:00.000Z'),
    Comments.create('task-2', 'bob', '其他任务', '2026-01-01T00:00:00.000Z'),
    Comments.create('task-1', 'alice', '第一条', '2026-01-01T00:00:00.000Z'),
    Comments.create('task-1', 'carol', '第二条', '2026-01-02T00:00:00.000Z')
  ];
  var before = snapshot(list);
  var result = Comments.listByTask(list, 'task-1');

  assert.deepStrictEqual(result.map(function(item) { return item.text; }),
    ['第一条', '第二条', '第三条']);
  assert.strictEqual(snapshot(list), before);
});

test('Comments.listByTask: 相同时间按 id 稳定排序', function() {
  var at = '2026-01-01T00:00:00.000Z';
  var list = [
    Comments.create('task-1', 'a', 'a', at),
    Comments.create('task-1', 'b', 'b', at),
    Comments.create('task-1', 'c', 'c', at)
  ];
  var expected = list.map(function(item) { return item.id; }).sort();
  var actual = Comments.listByTask(list, 'task-1').map(function(item) { return item.id; });
  assert.deepStrictEqual(actual, expected);
});

test('Comments.listByTask: 非法输入返回空数组', function() {
  assert.deepStrictEqual(plain(Comments.listByTask(null, 'task-1')), []);
  assert.deepStrictEqual(plain(Comments.listByTask([], 'task-1')), []);
  assert.deepStrictEqual(plain(Comments.listByTask([
    Comments.create('task-1', 'alice', 'hello')
  ], 'missing')), []);
});

test('Comments.remove: 返回新数组且不修改入参', function() {
  var keep = Comments.create('task-1', 'alice', '保留');
  var drop = Comments.create('task-1', 'bob', '删除');
  var list = [keep, drop];
  var before = snapshot(list);
  var result = Comments.remove(list, drop.id);

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, keep.id);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(snapshot(list), before);
});

test('Comments.remove: 未知 id 和非数组输入', function() {
  var list = [Comments.create('task-1', 'alice', 'hello')];
  assert.deepStrictEqual(plain(Comments.remove(list, 'missing')), plain(list));
  assert.deepStrictEqual(plain(Comments.remove(null, 'x')), []);
});

// ------------------------------------------------------------
// Activity
// ------------------------------------------------------------

test('Activity.record: 值变化时生成记录', function() {
  var entry = Activity.record('task-1', '  alice  ', 'status', 'inProgress', 'done',
    '2026-01-01T00:00:00.000Z');
  assert.ok(/^activity-/.test(entry.id));
  assert.strictEqual(entry.taskId, 'task-1');
  assert.strictEqual(entry.actor, 'alice');
  assert.strictEqual(entry.field, 'status');
  assert.strictEqual(entry.before, 'inProgress');
  assert.strictEqual(entry.after, 'done');
  assert.strictEqual(entry.at, '2026-01-01T00:00:00.000Z');
});

test('Activity.record: 值未变化时不生成记录', function() {
  assert.strictEqual(Activity.record('task-1', 'alice', 'status', 'done', 'done'), null);
  assert.strictEqual(Activity.record('task-1', 'alice', 'progress', 50, 50), null);
  assert.strictEqual(Activity.record('task-1', 'alice', 'assignee', null, null), null);
  assert.strictEqual(Activity.record('task-1', 'alice', 'assignee', undefined, null), null);
});

test('Activity.record: 数字和布尔变化都会被记录', function() {
  assert.strictEqual(Activity.record('task-1', 'alice', 'progress', 50, 51).after, 51);
  assert.strictEqual(Activity.record('task-1', 'alice', 'archived', false, true).after, true);
});

test('Activity.record: 拒绝非法任务 ID、字段和操作人', function() {
  assert.strictEqual(Activity.record('bad id', 'alice', 'status', 'a', 'b'), null);
  assert.strictEqual(Activity.record('task-1', 'alice', '', 'a', 'b'), null);
  assert.strictEqual(Activity.record('task-1', 'alice', null, 'a', 'b'), null);
  assert.strictEqual(Activity.record('task-1', '   ', 'status', 'a', 'b'), null);
  assert.strictEqual(Activity.record('task-1', null, 'status', 'a', 'b'), null);
});

test('Activity.diffTask: 只为变化的字段生成记录', function() {
  var before = {
    id: 'task-1', name: '旧名称', status: 'inProgress', assignee: 'bob',
    startDate: '2026-01-01', endDate: '2026-01-05', plannedEndDate: '2026-01-05',
    progress: 50, description: '旧描述', color: '#ffffff', order: 0
  };
  var after = {
    id: 'task-1', name: '新名称', status: 'done', assignee: 'bob',
    startDate: '2026-01-02', endDate: '2026-01-05', plannedEndDate: '2026-01-06',
    progress: 60, description: '新描述', color: '#000000', order: 1
  };

  var entries = Activity.diffTask(before, after, 'alice', '2026-01-10T00:00:00.000Z');
  var fields = entries.map(function(entry) { return entry.field; });

  assert.deepStrictEqual(plain(fields), ['name', 'status', 'startDate', 'plannedEndDate', 'progress']);
  assert.deepStrictEqual(plain(entries.map(function(entry) { return entry.before; })),
    ['旧名称', 'inProgress', '2026-01-01', '2026-01-05', 50]);
  assert.deepStrictEqual(plain(entries.map(function(entry) { return entry.after; })),
    ['新名称', 'done', '2026-01-02', '2026-01-06', 60]);
  entries.forEach(function(entry) {
    assert.strictEqual(entry.taskId, 'task-1');
    assert.strictEqual(entry.actor, 'alice');
    assert.strictEqual(entry.at, '2026-01-10T00:00:00.000Z');
  });
});

test('Activity.diffTask: 覆盖全部白名单字段', function() {
  var before = {
    id: 'task-1', name: 'A', status: 'inProgress', assignee: 'bob',
    startDate: '2026-01-01', endDate: '2026-01-05', plannedEndDate: '2026-01-05', progress: 10
  };
  var after = {
    id: 'task-1', name: 'B', status: 'done', assignee: 'carol',
    startDate: '2026-01-02', endDate: '2026-01-06', plannedEndDate: '2026-01-07', progress: 90
  };
  var fields = Activity.diffTask(before, after, 'alice').map(function(entry) { return entry.field; });
  assert.deepStrictEqual(plain(fields), plain(Activity.FIELDS));
  assert.strictEqual(fields.length, 7);
});

test('Activity.diffTask: 无变化返回空数组', function() {
  var task = {
    id: 'task-1', name: 'A', status: 'inProgress', assignee: 'bob',
    startDate: '2026-01-01', endDate: '2026-01-05', plannedEndDate: '2026-01-05', progress: 10
  };
  assert.deepStrictEqual(plain(Activity.diffTask(task, plain(task), 'alice')), []);
});

test('Activity.diffTask: undefined 和 null 视为同一个空值', function() {
  var before = { id: 'task-1', name: 'A', startDate: undefined };
  var after = { id: 'task-1', name: 'A', startDate: null };
  assert.deepStrictEqual(plain(Activity.diffTask(before, after, 'alice')), []);
});

test('Activity.diffTask: 白名单之外的字段不记录', function() {
  var before = { id: 'task-1', description: '旧', color: '#fff', order: 0, parentId: null };
  var after = { id: 'task-1', description: '新', color: '#000', order: 9, parentId: 'task-2' };
  assert.deepStrictEqual(plain(Activity.diffTask(before, after, 'alice')), []);
});

test('Activity.diffTask: 缺少任务对象返回空数组且不修改入参', function() {
  var before = { id: 'task-1', name: 'A', progress: 10 };
  var after = { id: 'task-1', name: 'B', progress: 20 };
  var beforeSnapshot = snapshot(before);
  var afterSnapshot = snapshot(after);

  Activity.diffTask(before, after, 'alice', '2026-01-01T00:00:00.000Z');
  assert.strictEqual(snapshot(before), beforeSnapshot);
  assert.strictEqual(snapshot(after), afterSnapshot);
  assert.deepStrictEqual(plain(Activity.diffTask(null, after, 'alice')), []);
  assert.deepStrictEqual(plain(Activity.diffTask(before, null, 'alice')), []);
});

test('Activity.listByTask: 按时间升序并过滤其他任务', function() {
  var list = [
    Activity.record('task-1', 'alice', 'progress', 10, 20, '2026-01-02T00:00:00.000Z'),
    Activity.record('task-2', 'alice', 'progress', 10, 20, '2026-01-01T00:00:00.000Z'),
    Activity.record('task-1', 'alice', 'progress', 20, 30, '2026-01-03T00:00:00.000Z'),
    Activity.record('task-1', 'alice', 'progress', 0, 10, '2026-01-01T00:00:00.000Z')
  ];
  var before = snapshot(list);
  var result = Activity.listByTask(list, 'task-1');

  assert.deepStrictEqual(result.map(function(entry) { return entry.before; }), [0, 10, 20]);
  assert.strictEqual(snapshot(list), before);
});

test('Activity.listByTask: 非法输入返回空数组', function() {
  assert.deepStrictEqual(plain(Activity.listByTask(null, 'task-1')), []);
  assert.deepStrictEqual(plain(Activity.listByTask([], 'task-1')), []);
  assert.deepStrictEqual(plain(Activity.listByTask([
    Activity.record('task-1', 'alice', 'progress', 1, 2)
  ], 'missing')), []);
});

// ------------------------------------------------------------
// AttachmentMeta
// ------------------------------------------------------------

test('AttachmentMeta.create: 生成元数据并规范化类型和名称', function() {
  var meta = AttachmentMeta.create('task-1', {
    name: '  报告.pdf  ',
    size: 1024,
    type: 'Application/PDF',
    blobKey: 'blob-1'
  }, '2026-01-01T00:00:00.000Z');

  assert.ok(/^attachment-/.test(meta.id));
  assert.strictEqual(meta.taskId, 'task-1');
  assert.strictEqual(meta.name, '报告.pdf');
  assert.strictEqual(meta.size, 1024);
  assert.strictEqual(meta.type, 'application/pdf');
  assert.strictEqual(meta.blobKey, 'blob-1');
  assert.strictEqual(meta.createdAt, '2026-01-01T00:00:00.000Z');
});

test('AttachmentMeta.create: 大小上限边界', function() {
  function build(size) {
    return AttachmentMeta.create('task-1', {
      name: 'a.txt', size: size, type: 'text/plain', blobKey: 'blob-1'
    }, '2026-01-01T00:00:00.000Z');
  }
  assert.ok(build(0));
  assert.ok(build(AttachmentMeta.MAX_SIZE));
  assert.strictEqual(build(AttachmentMeta.MAX_SIZE + 1), null);
  assert.strictEqual(build(-1), null);
  assert.strictEqual(build(1.5), null);
  assert.strictEqual(build('10'), null);
});

test('AttachmentMeta.create: 拒绝白名单之外的类型', function() {
  function build(type) {
    return AttachmentMeta.create('task-1', {
      name: 'a.bin', size: 10, type: type, blobKey: 'blob-1'
    }, '2026-01-01T00:00:00.000Z');
  }
  assert.strictEqual(build('application/x-msdownload'), null);
  assert.strictEqual(build(''), null);
  assert.strictEqual(build(null), null);
  assert.ok(build('image/png'));
  assert.ok(build('IMAGE/PNG'));
});

test('AttachmentMeta.create: 名称和 blobKey 必填', function() {
  function build(overrides) {
    var fileMeta = { name: 'a.txt', size: 10, type: 'text/plain', blobKey: 'blob-1' };
    Object.keys(overrides).forEach(function(key) { fileMeta[key] = overrides[key]; });
    return AttachmentMeta.create('task-1', fileMeta, '2026-01-01T00:00:00.000Z');
  }
  assert.strictEqual(build({ name: '' }), null);
  assert.strictEqual(build({ name: '   ' }), null);
  assert.strictEqual(build({ name: '../etc/passwd' }), null);
  assert.strictEqual(build({ name: new Array(AttachmentMeta.MAX_NAME_LENGTH + 2).join('a') }), null);
  assert.strictEqual(build({ blobKey: '' }), null);
  assert.strictEqual(build({ blobKey: 'bad key' }), null);
  assert.strictEqual(AttachmentMeta.create('task-1', null, '2026-01-01T00:00:00.000Z'), null);
  assert.strictEqual(AttachmentMeta.create('bad id', {
    name: 'a.txt', size: 10, type: 'text/plain', blobKey: 'blob-1'
  }, '2026-01-01T00:00:00.000Z'), null);
});

test('AttachmentMeta.validate: 合法元数据通过校验', function() {
  var meta = AttachmentMeta.create('task-1', {
    name: 'a.txt', size: 10, type: 'text/plain', blobKey: 'blob-1'
  }, '2026-01-01T00:00:00.000Z');
  var result = AttachmentMeta.validate(meta);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(plain(result.errors), []);
});

test('AttachmentMeta.validate: 逐项返回错误码', function() {
  var result = AttachmentMeta.validate({
    id: 'attachment-1',
    taskId: 'bad id',
    name: '   ',
    size: AttachmentMeta.MAX_SIZE + 1,
    type: 'application/x-msdownload',
    blobKey: '',
    createdAt: '2026-01-01T00:00:00.000Z'
  });
  var codes = result.errors.map(function(error) { return error.code; });

  assert.strictEqual(result.valid, false);
  assert.ok(codes.indexOf('INVALID_TASK_ID') !== -1);
  assert.ok(codes.indexOf('INVALID_NAME') !== -1);
  assert.ok(codes.indexOf('SIZE_EXCEEDED') !== -1);
  assert.ok(codes.indexOf('INVALID_TYPE') !== -1);
  assert.ok(codes.indexOf('INVALID_BLOB_KEY') !== -1);
  result.errors.forEach(function(error) {
    assert.strictEqual(typeof error.field, 'string');
    assert.strictEqual(typeof error.message, 'string');
  });
});

test('AttachmentMeta.validate: 非对象输入返回 INVALID_META', function() {
  [null, undefined, 'meta', 1, []].forEach(function(value) {
    var result = AttachmentMeta.validate(value);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].code, 'INVALID_META');
  });
});

test('AttachmentMeta.create: 不修改传入的 fileMeta', function() {
  var fileMeta = {
    name: '  报告.pdf  ',
    size: 1024,
    type: 'Application/PDF',
    blobKey: 'blob-1'
  };
  var before = snapshot(fileMeta);
  AttachmentMeta.create('task-1', fileMeta, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(snapshot(fileMeta), before);
});

test('AttachmentMeta.listByTask: 按时间升序并过滤其他任务', function() {
  function build(taskId, name, blobKey, createdAt) {
    return AttachmentMeta.create(taskId, {
      name: name, size: 10, type: 'text/plain', blobKey: blobKey
    }, createdAt);
  }
  var list = [
    build('task-1', 'c.txt', 'blob-c', '2026-01-03T00:00:00.000Z'),
    build('task-2', 'x.txt', 'blob-x', '2026-01-01T00:00:00.000Z'),
    build('task-1', 'a.txt', 'blob-a', '2026-01-01T00:00:00.000Z'),
    build('task-1', 'b.txt', 'blob-b', '2026-01-02T00:00:00.000Z')
  ];
  var before = snapshot(list);
  var result = AttachmentMeta.listByTask(list, 'task-1');

  assert.deepStrictEqual(result.map(function(meta) { return meta.name; }),
    ['a.txt', 'b.txt', 'c.txt']);
  assert.strictEqual(snapshot(list), before);
});

test('AttachmentMeta.listByTask: 非法输入返回空数组', function() {
  assert.deepStrictEqual(plain(AttachmentMeta.listByTask(null, 'task-1')), []);
  assert.deepStrictEqual(plain(AttachmentMeta.listByTask([], 'task-1')), []);
});

test('AttachmentMeta.remove: 返回新数组且不修改入参', function() {
  var keep = AttachmentMeta.create('task-1', {
    name: 'a.txt', size: 10, type: 'text/plain', blobKey: 'blob-1'
  }, '2026-01-01T00:00:00.000Z');
  var drop = AttachmentMeta.create('task-1', {
    name: 'b.txt', size: 10, type: 'text/plain', blobKey: 'blob-2'
  }, '2026-01-02T00:00:00.000Z');
  var list = [keep, drop];
  var before = snapshot(list);
  var result = AttachmentMeta.remove(list, drop.id);

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, keep.id);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(snapshot(list), before);
  assert.deepStrictEqual(plain(AttachmentMeta.remove(list, 'missing')), plain(list));
  assert.deepStrictEqual(plain(AttachmentMeta.remove(null, 'x')), []);
});

// ------------------------------------------------------------
// TaskManager 协作数据持久化
// ------------------------------------------------------------

test('TaskManager.init: 补齐 comments/activity/attachments 数组', function() {
  resetManager();
  assert.deepStrictEqual(plain(Manager.data.comments), []);
  assert.deepStrictEqual(plain(Manager.data.activity), []);
  assert.deepStrictEqual(plain(Manager.data.attachments), []);
});

test('TaskManager 评论增删改并写入 localStorage', function() {
  resetManager();
  var task = Manager.addTask(null, '任务');
  var comment = Manager.addComment(task.id, '  alice  ', '  第一条  ');
  assert.ok(comment);
  assert.strictEqual(comment.author, 'alice');
  assert.strictEqual(comment.text, '第一条');
  assert.strictEqual(Manager.getComments(task.id).length, 1);

  var updated = Manager.updateComment(comment.id, '  第二条  ');
  assert.strictEqual(updated.text, '第二条');
  assert.ok(updated.updatedAt);
  assert.strictEqual(Manager.getComments(task.id)[0].text, '第二条');

  var saved = JSON.parse(managerApp.localStorage.getItem('pmweb_data'));
  var projSaved = saved.projects ? saved.projects[0].data : saved;
  assert.strictEqual(projSaved.comments.length, 1);
  assert.strictEqual(projSaved.comments[0].text, '第二条');

  Manager.init();
  assert.strictEqual(Manager.getComments(task.id).length, 1);
  assert.strictEqual(Manager.getComments(task.id)[0].text, '第二条');

  assert.strictEqual(Manager.deleteComment(comment.id), true);
  assert.strictEqual(Manager.deleteComment(comment.id), false);
  assert.strictEqual(Manager.getComments(task.id).length, 0);
});

test('TaskManager 评论拒绝非法输入', function() {
  resetManager();
  var task = Manager.addTask(null, '任务');
  assert.strictEqual(Manager.addComment(task.id, 'alice', '   '), null);
  assert.strictEqual(Manager.addComment('bad id', 'alice', 'hello'), null);
  assert.strictEqual(Manager.updateComment('missing', 'hello'), null);
  assert.strictEqual(Manager.getComments('missing').length, 0);
});

test('TaskManager 附件元数据增删并持久化', function() {
  resetManager();
  var task = Manager.addTask(null, '任务');
  var meta = Manager.addAttachment(task.id, {
    name: '  说明.txt  ',
    size: 42,
    type: 'TEXT/PLAIN',
    blobKey: 'blob-1'
  });

  assert.ok(meta);
  assert.strictEqual(meta.name, '说明.txt');
  assert.strictEqual(meta.type, 'text/plain');
  assert.strictEqual(Manager.getAttachments(task.id).length, 1);
  assert.strictEqual(Manager.getAttachment(meta.id).blobKey, 'blob-1');

  var saved = JSON.parse(managerApp.localStorage.getItem('pmweb_data'));
  var projSaved = saved.projects ? saved.projects[0].data : saved;
  assert.strictEqual(projSaved.attachments.length, 1);

  assert.strictEqual(Manager.deleteAttachment(meta.id), true);
  assert.strictEqual(Manager.deleteAttachment(meta.id), false);
  assert.strictEqual(Manager.getAttachments(task.id).length, 0);
});

test('updateTask 通过 diffTask 记录活动，撤销移除重做恢复且不重复', function() {
  resetManager();
  var task = Manager.addTask(null, '原名');
  Manager.clearHistory();
  var base = Manager.getActivity(task.id).length;

  Manager.updateTask(task.id, { name: '新名', status: 'done', progress: 100 });
  var entries = Manager.getActivity(task.id);
  assert.strictEqual(entries.length, base + 3);
  var fields = entries.slice(base).map(function(entry) { return entry.field; });
  assert.deepStrictEqual(plain(fields), ['name', 'status', 'progress']);
  assert.deepStrictEqual(plain(entries.slice(base).map(function(entry) { return entry.before; })),
    ['原名', 'todo', 0]);
  assert.deepStrictEqual(plain(entries.slice(base).map(function(entry) { return entry.after; })),
    ['新名', 'done', 100]);

  Manager.undo();
  assert.strictEqual(Manager.getActivity(task.id).length, base);
  assert.strictEqual(Manager.getTask(task.id).name, '原名');

  Manager.redo();
  assert.strictEqual(Manager.getActivity(task.id).length, base + 3);
  assert.strictEqual(Manager.getTask(task.id).name, '新名');
  assert.strictEqual(Manager.redo(), null);
  assert.strictEqual(Manager.getActivity(task.id).length, base + 3);
});

test('updateTask 未变化的字段不产生活动记录', function() {
  resetManager();
  var task = Manager.addTask(null, '任务');
  Manager.clearHistory();
  var base = Manager.getActivity(task.id).length;

  Manager.updateTask(task.id, { description: '只改描述' });
  assert.strictEqual(Manager.getActivity(task.id).length, base);
});

test('addTask 记录活动，撤销移除、重做恢复', function() {
  resetManager();
  var task = Manager.addTask(null, '任务A');
  var count = Manager.getActivity(task.id).length;
  assert.ok(count > 0);

  Manager.undo();
  assert.strictEqual(Manager.getActivity(task.id).length, 0);

  Manager.redo();
  assert.strictEqual(Manager.getActivity(task.id).length, count);
});

test('deleteTask 记录活动，撤销移除、重做恢复', function() {
  resetManager();
  var task = Manager.addTask(null, '任务A');
  Manager.clearHistory();
  var before = Manager.getActivity(task.id).length;

  Manager.deleteTask(task.id);
  var after = Manager.getActivity(task.id).length;
  assert.ok(after > before);

  Manager.undo();
  assert.strictEqual(Manager.getActivity(task.id).length, before);

  Manager.redo();
  assert.strictEqual(Manager.getActivity(task.id).length, after);
});

test('活动记录使用 currentUser 作为操作人', function() {
  resetManager();
  var task = Manager.addTask(null, '任务');
  Manager.setSetting('currentUser', '张三');
  Manager.clearHistory();
  Manager.updateTask(task.id, { name: '改名' });

  var entries = Manager.getActivity(task.id).filter(function(entry) {
    return entry.field === 'name' && entry.actor === '张三';
  });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].after, '改名');
});

test('switch_isolates_comments_and_attachments', function() {
  var lw = require('./helpers/load-workspace');
  var ws = lw.makeWorkspace();
  var env = lw.fresh({ initialData: ws, activeProjectId: 'p-a' });

  // 项目 A 初始已有评论 c-a 和附件 a-a (属于 t-a)
  assert.strictEqual(env.manager.getComments('t-a').length, 1);
  assert.strictEqual(env.manager.getAttachments('t-a').length, 1);

  // 在项目 A 新增一条评论
  env.manager.addComment('t-a', 'alice', 'A项目评论2');
  assert.strictEqual(env.manager.getComments('t-a').length, 2);

  // 切换到项目 B
  env.workspace.activate('p-b');
  assert.strictEqual(env.workspace.activeProjectId, 'p-b');
  // 项目 B 查 t-a 的评论和附件应为空
  assert.deepStrictEqual(plain(env.manager.getComments('t-a')), []);
  assert.deepStrictEqual(plain(env.manager.getAttachments('t-a')), []);
  // 项目 B 查自身任务 t-b
  assert.deepStrictEqual(plain(env.manager.getComments('t-b')), []);
  assert.deepStrictEqual(plain(env.manager.getAttachments('t-b')), []);

  // 在项目 B 增加评论和附件
  env.manager.addComment('t-b', 'bob', 'B项目评论1');
  env.manager.addAttachment('t-b', { name: 'b-att.pdf', size: 200, type: 'application/pdf', blobKey: 'blob-b' });
  assert.strictEqual(env.manager.getComments('t-b').length, 1);
  assert.strictEqual(env.manager.getAttachments('t-b').length, 1);

  // 切回项目 A
  env.workspace.activate('p-a');
  // 项目 A 不含 B 的评论和附件
  assert.strictEqual(env.manager.getComments('t-a').length, 2);
  assert.strictEqual(env.manager.getAttachments('t-a').length, 1);
  assert.deepStrictEqual(plain(env.manager.getComments('t-b')), []);
  assert.deepStrictEqual(plain(env.manager.getAttachments('t-b')), []);
});

test('同一附件被活动任务和两个批次引用，逐次 purge 不提前删文件', function() {
  var appWithBin = helper.createApp([
    'date.js',
    'validate.js',
    'store.js',
    'workspace.js',
    'history.js',
    'comments.js',
    'activity.js',
    'attachment-meta.js',
    'attachment-store.js',
    'recycle-bin.js',
    'task-manager.js'
  ]);
  var RB = appWithBin.get('RecycleBin');
  var WS = appWithBin.get('Workspace');
  var lw = require('./helpers/load-workspace');
  var ws = lw.makeWorkspace();

  var pA = ws.projects[0];
  pA.data.tasks = [
    { id: 'T_act', parentId: null, name: '活动任务', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-15' },
    { id: 'T_b1', parentId: null, name: '批次1任务', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-15' },
    { id: 'T_b2', parentId: null, name: '批次2任务', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-15' }
  ];
  pA.data.attachments = [
    { id: 'att-act', taskId: 'T_act', name: 'f.txt', size: 100, type: 'text/plain', blobKey: 'blob-shared' },
    { id: 'att-b1', taskId: 'T_b1', name: 'f.txt', size: 100, type: 'text/plain', blobKey: 'blob-shared' },
    { id: 'att-b2', taskId: 'T_b2', name: 'f.txt', size: 100, type: 'text/plain', blobKey: 'blob-shared' }
  ];

  // 1. 删除 T_b1 得到批次 1
  var r1 = RB.removeTask(ws, pA.id, 'T_b1');
  // 2. 删除 T_b2 得到批次 2
  var r2 = RB.removeTask(r1.workspace, pA.id, 'T_b2');
  var wsBoth = r2.workspace;

  // 3. 第一次 purge 批次 1：活动任务与批次 2 仍在引用，不包含 blob-shared
  var p1 = RB.purge(wsBoth, r1.batchId);
  assert.strictEqual(p1.unreferencedBlobKeys.indexOf('blob-shared'), -1, '批次1清理不得误删仍被引用的附件');

  // 4. 第二次 purge 批次 2：活动任务仍在引用，依然不包含 blob-shared
  var p2 = RB.purge(p1.workspace, r2.batchId);
  assert.strictEqual(p2.unreferencedBlobKeys.indexOf('blob-shared'), -1, '批次2清理不得误删活动任务引用的附件');

  // 5. 移出活动任务引用
  var pAInWs = p2.workspace.projects.find(function(p) { return p.id === pA.id; });
  pAInWs.data.attachments = [];

  // 此时全工作区已无任何引用
  var finalRefs = RB.referencedBlobKeys(p2.workspace);
  assert.strictEqual(finalRefs.has('blob-shared'), false);
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

console.log('\ncollab: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
