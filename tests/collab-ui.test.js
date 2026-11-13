'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'task-manager.js',
  'app.js'
]);

var TaskManager = app.get('TaskManager');
var Activity = app.get('Activity');
var AttachmentStore = app.get('AttachmentStore');
var App = app.get('App');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

function reset() {
  app.localStorage._store = {};
  app.alerts.length = 0;
  helper.resetProject(app);
  return TaskManager;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ------------------------------------------------------------
// 纯视图辅助函数
// ------------------------------------------------------------

test('formatAttachmentSize: 字节、KB 和 MB 显示', function() {
  assert.strictEqual(App.formatAttachmentSize(0), '0 B');
  assert.strictEqual(App.formatAttachmentSize(512), '512 B');
  assert.strictEqual(App.formatAttachmentSize(1024), '1 KB');
  assert.strictEqual(App.formatAttachmentSize(1536), '1.5 KB');
  assert.strictEqual(App.formatAttachmentSize(10 * 1024 * 1024), '10 MB');
  assert.strictEqual(App.formatAttachmentSize(-1), '0 B');
  assert.strictEqual(App.formatAttachmentSize('bad'), '0 B');
});

test('formatActivityValue: 空值、状态和进度文本', function() {
  assert.strictEqual(App.formatActivityValue('assignee', null), '未设置');
  assert.strictEqual(App.formatActivityValue('assignee', ''), '（空）');
  assert.strictEqual(App.formatActivityValue('status', 'done'), '已完成');
  assert.strictEqual(App.formatActivityValue('status', 'thirdParty'), '第三方');
  assert.strictEqual(App.formatActivityValue('progress', 60), '60%');
  assert.strictEqual(App.formatActivityValue('name', '任务A'), '任务A');
});

test('escapeText: 转义评论和附件名中的 HTML', function() {
  var escaped = App.escapeText('<img src=x onerror="alert(1)">');
  assert.strictEqual(escaped, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.strictEqual(App.escapeText("a & b 'c'"), 'a &amp; b &#39;c&#39;');
  assert.strictEqual(App.escapeText(null), '');
});

test('buildCommentRows: 按时间升序并带显示字段', function() {
  reset();
  var task = TaskManager.addTask(null, '任务');
  TaskManager.data.comments = [
    {
      id: 'comment-2', taskId: task.id, author: 'bob', text: '第二条',
      createdAt: '2026-01-02T00:00:00.000Z', updatedAt: null
    },
    {
      id: 'comment-1', taskId: task.id, author: 'alice', text: '第一条',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z'
    }
  ];

  var rows = App.buildCommentRows(task.id);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].author, 'alice');
  assert.strictEqual(rows[1].author, 'bob');
  assert.strictEqual(rows[0].edited, true);
  assert.strictEqual(rows[1].edited, false);
  assert.ok(rows[0].timeText.length > 0);
});

test('buildActivityRows: 按时间倒序并输出字段变化文本', function() {
  reset();
  var task = TaskManager.addTask(null, '任务');
  TaskManager.data.activity = [
    Activity.record(task.id, 'alice', 'status', 'inProgress', 'done', '2026-01-01T00:00:00.000Z'),
    Activity.record(task.id, 'bob', 'name', '旧名', '新名', '2026-01-02T00:00:00.000Z')
  ];

  var rows = App.buildActivityRows(task.id);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].actor, 'bob');
  assert.strictEqual(rows[0].fieldLabel, '任务名称');
  assert.strictEqual(rows[0].beforeText, '旧名');
  assert.strictEqual(rows[0].afterText, '新名');
  assert.strictEqual(rows[0].text, 'bob 将 任务名称 从「旧名」改为「新名」');
  assert.strictEqual(rows[1].fieldLabel, '状态');
  assert.strictEqual(rows[1].afterText, '已完成');
});

test('buildAttachmentRows: 显示大小和类型', function() {
  reset();
  var task = TaskManager.addTask(null, '任务');
  TaskManager.addAttachment(task.id, {
    name: '说明.txt', size: 2048, type: 'text/plain', blobKey: 'blob-1'
  });

  var rows = App.buildAttachmentRows(task.id);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, '说明.txt');
  assert.strictEqual(rows[0].sizeText, '2 KB');
  assert.strictEqual(rows[0].type, 'text/plain');
});

test('buildActivityRows / buildCommentRows 无数据时返回空数组', function() {
  reset();
  var task = TaskManager.addTask(null, '任务');
  TaskManager.data.activity = [];
  assert.deepStrictEqual(plain(App.buildActivityRows(task.id)), []);
  assert.deepStrictEqual(plain(App.buildCommentRows(task.id)), []);
  assert.deepStrictEqual(plain(App.buildAttachmentRows(task.id)), []);
});

// ------------------------------------------------------------
// AttachmentStore 内存 fallback
// ------------------------------------------------------------

test('AttachmentStore: put/get/listByTask/delete 内存回退', async function() {
  await AttachmentStore.reset();
  var blob = { size: 5, type: 'text/plain' };

  await AttachmentStore.put('blob-a', blob, {
    taskId: 'task-1', size: 5, type: 'text/plain', createdAt: '2026-01-01T00:00:00.000Z'
  });
  await AttachmentStore.put('blob-b', { size: 6 }, {
    taskId: 'task-2', size: 6, type: 'text/plain'
  });

  assert.strictEqual(await AttachmentStore.has('blob-a'), true);
  assert.strictEqual(await AttachmentStore.get('blob-a'), blob);
  assert.deepStrictEqual(plain(await AttachmentStore.listByTask('task-1')), ['blob-a']);
  assert.deepStrictEqual(plain(await AttachmentStore.listByTask('task-2')), ['blob-b']);
  assert.deepStrictEqual(plain(await AttachmentStore.listByTask('missing')), []);

  await AttachmentStore.delete('blob-a');
  assert.strictEqual(await AttachmentStore.get('blob-a'), null);
  assert.strictEqual(await AttachmentStore.has('blob-a'), false);
  assert.deepStrictEqual(plain(await AttachmentStore.listByTask('task-1')), []);

  var usage = await AttachmentStore.usage();
  assert.strictEqual(usage.count, 1);
  assert.strictEqual(usage.bytes, 6);
});

test('AttachmentStore: 非法键和空任务返回安全值', async function() {
  await AttachmentStore.reset();
  var rejected = false;
  try {
    await AttachmentStore.put('', { size: 1 });
  } catch (error) {
    rejected = true;
  }
  assert.strictEqual(rejected, true);
  assert.strictEqual(await AttachmentStore.get(''), null);
  assert.strictEqual(await AttachmentStore.has(''), false);
  assert.deepStrictEqual(plain(await AttachmentStore.listByTask('')), []);
  await AttachmentStore.delete('missing');
  assert.strictEqual((await AttachmentStore.usage()).count, 0);
});

test('AttachmentStore: 上传后可下载删除，元数据同步', async function() {
  reset();
  var task = TaskManager.addTask(null, '任务');
  var blobKey = 'blob-upload-1';
  var blob = { size: 12, type: 'text/plain' };

  await AttachmentStore.put(blobKey, blob, { taskId: task.id, size: 12, type: 'text/plain' });
  var meta = TaskManager.addAttachment(task.id, {
    name: '记录.txt', size: 12, type: 'text/plain', blobKey: blobKey
  });
  assert.ok(meta);
  assert.deepStrictEqual(plain(await AttachmentStore.listByTask(task.id)), [blobKey]);
  assert.strictEqual(await AttachmentStore.get(meta.blobKey), blob);

  await AttachmentStore.delete(meta.blobKey);
  assert.strictEqual(TaskManager.deleteAttachment(meta.id), true);
  assert.strictEqual(await AttachmentStore.get(blobKey), null);
  assert.strictEqual(TaskManager.getAttachments(task.id).length, 0);
});

(async function run() {
  var failures = 0;
  for (var i = 0; i < tests.length; i++) {
    var entry = tests[i];
    try {
      await entry.fn();
      console.log('PASS ' + entry.name);
    } catch (err) {
      failures++;
      console.log('FAIL ' + entry.name);
      console.log('  ' + (err && err.message ? err.message : err));
    }
  }
  console.log('\ncollab-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
  process.exit(failures === 0 ? 0 : 1);
})();
