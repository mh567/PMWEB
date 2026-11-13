'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var helper = require('./helpers/load');

var app = helper.createApp(['sync.js']);
var SyncClient = app.get('SyncClient');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function makeTransport(handler) {
  var calls = [];
  function transport(request) {
    calls.push(request);
    return Promise.resolve().then(function() {
      return handler(request, calls.length - 1);
    });
  }
  transport.calls = calls;
  return transport;
}

function jsonResponse(status, data) {
  return { status: status, data: data };
}

function makeClient(handler, extra) {
  var transport = makeTransport(handler);
  var options = {
    baseUrl: 'https://pb.example.com/',
    projectId: 'p1',
    token: 'tok-0',
    transport: transport
  };
  if (extra) {
    Object.keys(extra).forEach(function(key) { options[key] = extra[key]; });
  }
  return { client: SyncClient.createClient(options), transport: transport };
}

function sampleData() {
  return {
    pmweb_version: 3,
    tasks: [
      {
        id: 'child', parentId: 'parent', name: '子任务', description: 'desc',
        assignee: '张三', color: null, startDate: '2026-01-01',
        endDate: '2026-01-05', status: 'inProgress', order: 0,
        ganttRow: null, progress: 20, plannedEndDate: '2026-01-06',
        estimatedHours: 8, locked: false
      },
      {
        id: 'parent', parentId: null, name: '父任务', description: '',
        assignee: '', color: '#111111', startDate: '2026-01-01',
        endDate: '2026-01-10', status: 'thirdParty', order: 0,
        ganttRow: 1, progress: 40, plannedEndDate: '2026-01-10',
        estimatedHours: 16, locked: true
      }
    ],
    milestones: [
      { id: 'm1', taskId: 'child', name: '里程碑', date: '2026-01-05' },
      { id: 'm2', taskId: 'ghost', name: '孤儿', date: '2026-01-05' }
    ],
    links: [
      { id: 'l1', source: 'parent', target: 'child', type: 'FS', lag: 1 },
      { id: 'l2', source: 'parent', target: 'ghost', type: 'SS', lag: 0 }
    ],
    comments: [
      {
        id: 'c1', taskId: 'child', author: '李四', text: '第一条',
        createdAt: '2026-01-02T00:00:00.000Z', updatedAt: null
      },
      { id: 'c2', taskId: 'ghost', author: '李四', text: '孤儿', createdAt: '2026-01-02T00:00:00.000Z' }
    ],
    activity: [
      {
        id: 'a1', taskId: 'child', actor: '王五', field: 'name',
        before: '旧', after: '新', at: '2026-01-03T00:00:00.000Z'
      }
    ],
    attachments: [
      {
        id: 'at1', taskId: 'child', name: '需求.pdf', size: 1024,
        type: 'application/pdf', createdAt: '2026-01-02T00:00:00.000Z',
        blobKey: 'blob-1'
      }
    ],
    views: [
      { id: 'v1', name: '默认视图', config: { granularity: 'week' } }
    ],
    settings: {
      currentUser: '王五',
      statusFilter: { inProgress: true, thirdParty: true, done: true }
    }
  };
}

// ---- 登录与令牌 ------------------------------------------------

test('login 发送密码认证并保存 token', async function() {
  var captured;
  var built = makeClient(function(request) {
    captured = request;
    return jsonResponse(200, { token: 'tok-1', record: { id: 'user-1' } });
  }, { token: null });

  var result = await built.client.login('me@example.com', 'secret');
  assert.strictEqual(result.token, 'tok-1');
  assert.deepEqual(result.record, { id: 'user-1' });
  assert.strictEqual(built.client.getToken(), 'tok-1');
  assert.strictEqual(captured.method, 'POST');
  assert.strictEqual(captured.url, 'https://pb.example.com/api/collections/users/auth-with-password');
  assert.strictEqual(captured.headers.Authorization, undefined);
  assert.deepEqual(captured.body, { identity: 'me@example.com', password: 'secret' });
});

test('登录成功后后续请求带 Authorization，logout 清空', async function() {
  var built = makeClient(function(request) {
    if (request.url.indexOf('auth-with-password') !== -1) {
      return jsonResponse(200, { token: 'tok-abc' });
    }
    return jsonResponse(200, { changes: [], cursor: 0, hasMore: false });
  });

  await built.client.login('me@example.com', 'secret');
  await built.client.pullChanges();
  assert.strictEqual(built.transport.calls[1].headers.Authorization, 'tok-abc');

  assert.strictEqual(built.client.logout(), true);
  assert.strictEqual(built.client.getToken(), null);
  await built.client.pullChanges();
  assert.strictEqual(built.transport.calls[2].headers.Authorization, undefined);
});

test('setToken 接受字符串并忽略空值', function() {
  var built = makeClient(function() { return jsonResponse(200, {}); });
  assert.strictEqual(built.client.setToken('tok-x'), 'tok-x');
  assert.strictEqual(built.client.getToken(), 'tok-x');
  assert.strictEqual(built.client.setToken(''), null);
  assert.strictEqual(built.client.setToken(null), null);
});

test('login 缺少邮箱或密码时返回 validation 错误', async function() {
  var built = makeClient(function() { return jsonResponse(200, {}); });
  await assert.rejects(built.client.login('', 'x'), function(error) {
    return error.name === 'SyncError' && error.kind === 'validation';
  });
  await assert.rejects(built.client.login('a@b.c', '   '), function(error) {
    return error.kind === 'validation';
  });
});

// ---- 增量拉取 --------------------------------------------------

test('pullChanges 按 updated 游标请求并规范化结果', async function() {
  var built = makeClient(function(request) {
    return jsonResponse(200, {
      changes: [
        {
          entity: 'task',
          id: 't1',
          op: 'update',
          rev: 3,
          updated: '2026-01-04T00:00:00.000Z',
          record: { external_id: 't1', name: 'A' }
        }
      ],
      cursor: 9,
      hasMore: true
    });
  });

  var result = await built.client.pullChanges({ since: 7, collections: ['tasks', 'links'] });
  var request = built.transport.calls[0];
  var url = new URL(request.url);

  assert.strictEqual(request.method, 'GET');
  assert.strictEqual(url.pathname, '/api/sync/pull');
  assert.strictEqual(url.searchParams.get('projectId'), 'p1');
  assert.strictEqual(url.searchParams.get('since'), '7');
  assert.strictEqual(url.searchParams.get('collections'), 'tasks,links');
  assert.deepEqual(result.changes[0], {
    entity: 'tasks',
    entityId: 't1',
    op: 'update',
    rev: 3,
    updated: '2026-01-04T00:00:00.000Z',
    record: { external_id: 't1', name: 'A' }
  });
  assert.strictEqual(result.cursor, 9);
  assert.strictEqual(result.hasMore, true);
});

test('pullChanges 默认拉取全部六个集合且 since 为 0', async function() {
  var built = makeClient(function() {
    return jsonResponse(200, { changes: [], cursor: 0 });
  });
  var result = await built.client.pullChanges();
  var url = new URL(built.transport.calls[0].url);
  assert.strictEqual(url.searchParams.get('since'), '0');
  assert.strictEqual(
    url.searchParams.get('collections'),
    'tasks,milestones,links,comments,activity,attachments'
  );
  assert.deepEqual(result.changes, []);
  assert.strictEqual(result.hasMore, false);
});

test('pullChanges 拒绝未知集合、写入集合和非法 since', async function() {
  var built = makeClient(function() {
    return jsonResponse(200, { changes: [] });
  });
  await assert.rejects(built.client.pullChanges({ collections: ['unknown'] }), function(error) {
    return error.kind === 'validation';
  });
  await assert.rejects(built.client.pullChanges({ collections: ['views'] }), function(error) {
    return error.kind === 'validation';
  });
  await assert.rejects(built.client.pullChanges({ since: -1 }), function(error) {
    return error.kind === 'validation';
  });
  await assert.rejects(built.client.pullChanges({ since: 1.5 }), function(error) {
    return error.kind === 'validation';
  });
});

test('pullChanges 缺少 projectId 时拒绝请求', async function() {
  var built = makeClient(function() { return jsonResponse(200, {}); }, { projectId: null });
  await assert.rejects(built.client.pullChanges(), function(error) {
    return error.kind === 'validation' && /projectId/.test(error.message);
  });
});

// ---- 批量推送 --------------------------------------------------

test('pushChanges 发送批量操作并映射逐条结果', async function() {
  var built = makeClient(function(request) {
    return jsonResponse(200, {
      results: [
        { opId: 'op-1', status: 'ok', rev: 2 },
        { opId: 'op-2', status: 'conflict', current: { rev: 4, name: '远端' } }
      ]
    });
  });

  var result = await built.client.pushChanges([
    {
      opId: 'op-1', entity: 'task', entityId: 't1', op: 'update',
      baseRev: 1, patch: { name: '本地' }
    },
    {
      opId: 'op-2', entity: 'tasks', entityId: 't2', op: 'delete',
      baseRev: 3
    }
  ]);

  var request = built.transport.calls[0];
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.url, 'https://pb.example.com/api/sync/push');
  assert.strictEqual(request.body.projectId, 'p1');
  assert.deepEqual(request.body.ops, [
    {
      opId: 'op-1', entity: 'tasks', entityId: 't1', op: 'update',
      baseRev: 1, patch: { name: '本地' }
    },
    {
      opId: 'op-2', entity: 'tasks', entityId: 't2', op: 'delete',
      baseRev: 3, patch: null
    }
  ]);
  assert.deepEqual(result.results[0], {
    opId: 'op-1', entity: 'tasks', entityId: 't1', status: 'ok',
    rev: 2, current: null, error: null
  });
  assert.strictEqual(result.results[1].status, 'conflict');
  assert.deepEqual(result.results[1].current, { rev: 4, name: '远端' });
});

test('pushChanges 缺少服务端结果时逐条报错', async function() {
  var built = makeClient(function() {
    return jsonResponse(200, { results: [] });
  });
  var result = await built.client.pushChanges([
    { opId: 'op-1', entity: 'tasks', entityId: 't1', op: 'update', patch: {} }
  ]);
  assert.strictEqual(result.results[0].status, 'error');
  assert.strictEqual(result.results[0].error.kind, 'server');
});

test('pushChanges 生成缺失的 opId，拒绝非法操作和只读集合', async function() {
  var built = makeClient(function() {
    return jsonResponse(200, { results: [] });
  });

  var generated = await built.client.pushChanges([
    { entity: 'tasks', entityId: 't1', op: 'create', patch: { name: 'A' } }
  ]);
  assert.ok(/^op-/.test(built.transport.calls[0].body.ops[0].opId));
  assert.strictEqual(generated.results[0].opId, built.transport.calls[0].body.ops[0].opId);

  await assert.rejects(
    built.client.pushChanges([{ entity: 'tasks', entityId: 't1', op: 'merge' }]),
    function(error) { return error.kind === 'validation'; }
  );
  await assert.rejects(
    built.client.pushChanges([{ entity: 'activity', entityId: 'a1', op: 'update' }]),
    function(error) { return error.kind === 'validation'; }
  );
  await assert.rejects(
    built.client.pushChanges([{ entity: 'tasks', entityId: '', op: 'update' }]),
    function(error) { return error.kind === 'validation'; }
  );
});

test('pushChanges 空数组不发起请求', async function() {
  var built = makeClient(function() { return jsonResponse(200, {}); });
  var result = await built.client.pushChanges([]);
  assert.deepEqual(result.results, []);
  assert.strictEqual(built.transport.calls.length, 0);
});

// ---- 错误分类 --------------------------------------------------

test('HTTP 状态映射为 network、auth、validation、conflict、server', async function() {
  var cases = [
    { status: 401, kind: 'auth' },
    { status: 403, kind: 'auth' },
    { status: 400, kind: 'validation' },
    { status: 404, kind: 'validation' },
    { status: 422, kind: 'validation' },
    { status: 409, kind: 'conflict' },
    { status: 500, kind: 'server' },
    { status: 503, kind: 'server' }
  ];

  for (var i = 0; i < cases.length; i++) {
    var entry = cases[i];
    var built = makeClient(function() {
      return jsonResponse(entry.status, { message: 'boom' });
    });
    await assert.rejects(built.client.pullChanges(), function(error) {
      return error.name === 'SyncError' && error.kind === entry.kind &&
        error.details.status === entry.status;
    });
    assert.strictEqual(SyncClient.classifyStatus(entry.status), entry.kind);
  }
});

test('传输层抛错和无效响应都归为 network', async function() {
  var offline = makeClient(function() {
    throw new Error('offline');
  });
  await assert.rejects(offline.client.pullChanges(), function(error) {
    return error.kind === 'network' && /offline/.test(error.message);
  });

  var invalid = makeClient(function() {
    return { status: 'oops' };
  });
  await assert.rejects(invalid.client.pullChanges(), function(error) {
    return error.kind === 'network';
  });
});

test('SyncError 保留错误名、分类和细节', async function() {
  var built = makeClient(function() {
    return jsonResponse(401, { message: 'nope' });
  });
  try {
    await built.client.pullChanges();
    assert.fail('应当抛错');
  } catch (error) {
    assert.strictEqual(error.name, 'SyncError');
    assert.strictEqual(SyncClient.isSyncError(error), true);
    assert.strictEqual(error.kind, 'auth');
  }
});

// ---- 迁移 payload ----------------------------------------------

test('migrateLocalData 按父先子后排序并映射字段', function() {
  var data = sampleData();
  var before = JSON.stringify(data);
  var payload = SyncClient.migrateLocalData(data, {
    projectId: 'p1',
    now: '2026-11-10T00:00:00.000Z',
    user: 'user-1'
  });

  assert.strictEqual(payload.projectId, 'p1');
  assert.strictEqual(payload.sourceVersion, 3);
  assert.strictEqual(payload.generatedAt, '2026-11-10T00:00:00.000Z');

  var tasks = payload.collections.tasks;
  assert.strictEqual(tasks.length, 2);
  assert.strictEqual(tasks[0].external_id, 'parent');
  assert.strictEqual(tasks[0].parent_external_id, null);
  assert.strictEqual(tasks[1].external_id, 'child');
  assert.strictEqual(tasks[1].parent_external_id, 'parent');
  assert.strictEqual(tasks[1].sort_order, 0);
  assert.strictEqual(tasks[1].planned_end_date, '2026-01-06');
  assert.strictEqual(tasks[1].estimated_hours, 8);
  assert.strictEqual(tasks[1].gantt_row, null);
  assert.strictEqual(tasks[0].locked, true);
  assert.strictEqual(tasks[1].rev, 1);
  assert.strictEqual(tasks[1].created_at, '2026-11-10T00:00:00.000Z');
  assert.strictEqual(tasks[1].updated_by, 'user-1');
  assert.strictEqual(tasks[1].deleted_at, null);

  var milestone = payload.collections.milestones[0];
  assert.deepEqual(milestone, {
    external_id: 'm1',
    project: 'p1',
    task_external_id: 'child',
    name: '里程碑',
    date: '2026-01-05',
    status: 'pending',
    rev: 1,
    created_at: '2026-11-10T00:00:00.000Z',
    updated_at: '2026-11-10T00:00:00.000Z',
    updated_by: 'user-1',
    deleted_at: null
  });

  var link = payload.collections.links[0];
  assert.strictEqual(link.source_external_id, 'parent');
  assert.strictEqual(link.target_external_id, 'child');
  assert.strictEqual(link.type, 'FS');
  assert.strictEqual(link.lag, 1);

  var comment = payload.collections.comments[0];
  assert.strictEqual(comment.author_name, '李四');
  assert.strictEqual(comment.text, '第一条');
  assert.strictEqual(comment.created_at, '2026-01-02T00:00:00.000Z');

  var activity = payload.collections.activity[0];
  assert.strictEqual(activity.actor_name, '王五');
  assert.strictEqual(activity.field, 'name');
  assert.strictEqual(activity.before_json, '旧');
  assert.strictEqual(activity.after_json, '新');

  var attachment = payload.collections.attachments[0];
  assert.strictEqual(attachment.storage_key, 'blob-1');
  assert.strictEqual(attachment.checksum, null);
  assert.strictEqual(attachment.task_external_id, 'child');

  assert.deepEqual(payload.collections.views[0].config_json, { granularity: 'week' });
  assert.deepEqual(payload.collections.settings[0].settings_json, data.settings);
  assert.strictEqual(payload.collections.settings[0].external_id, 'settings');

  assert.deepEqual(payload.counts, {
    tasks: 2,
    milestones: 1,
    links: 1,
    comments: 1,
    activity: 1,
    attachments: 1,
    views: 1,
    settings: 1
  });
  assert.strictEqual(payload.errors.length, 3);
  assert.deepEqual(payload.order, [
    'tasks', 'milestones', 'links', 'comments', 'activity',
    'attachments', 'views', 'settings'
  ]);
  assert.strictEqual(JSON.stringify(data), before, '迁移不能修改输入');
});

test('migrateLocalData 处理缺失父级、孤儿引用与环路', function() {
  var orphan = SyncClient.migrateLocalData({
    pmweb_version: 3,
    tasks: [
      { id: 'child', parentId: 'ghost', name: '子', status: 'inProgress', order: 0 },
      { id: 'a', parentId: 'b', name: 'A', status: 'inProgress', order: 0 },
      { id: 'b', parentId: 'a', name: 'B', status: 'inProgress', order: 0 }
    ],
    milestones: [{ id: 'm1', taskId: 'ghost', name: 'M', date: '2026-01-01' }],
    links: [{ id: 'l1', source: 'child', target: 'ghost', type: 'FS', lag: 0 }],
    comments: [{ id: 'c1', taskId: 'ghost', author: 'A', text: 'x', createdAt: '2026-01-01' }],
    activity: [],
    attachments: [],
    views: [],
    settings: {}
  }, { projectId: 'p1', now: '2026-11-10T00:00:00.000Z' });

  var child = orphan.collections.tasks.filter(function(task) {
    return task.external_id === 'child';
  })[0];
  assert.strictEqual(child.parent_external_id, null);
  assert.ok(orphan.errors.some(function(error) { return error.code === 'MISSING_PARENT'; }));
  assert.ok(orphan.errors.some(function(error) { return error.code === 'CYCLE'; }));
  assert.ok(orphan.errors.some(function(error) { return error.code === 'ORPHAN_MILESTONE'; }));
  assert.ok(orphan.errors.some(function(error) { return error.code === 'ORPHAN_LINK'; }));
  assert.ok(orphan.errors.some(function(error) { return error.code === 'ORPHAN_COMMENT'; }));
  assert.strictEqual(orphan.collections.milestones.length, 0);
  assert.strictEqual(orphan.collections.links.length, 0);
  assert.strictEqual(orphan.collections.comments.length, 0);
  assert.strictEqual(orphan.counts.tasks, 3);
});

test('migrateLocalData 缺 projectId 时返回 validation', function() {
  assert.throws(function() {
    SyncClient.migrateLocalData({ tasks: [] });
  }, function(error) {
    return error.name === 'SyncError' && error.kind === 'validation';
  });
});

test('client.migrateLocalData 使用客户端 projectId', function() {
  var built = makeClient(function() { return jsonResponse(200, {}); });
  var payload = built.client.migrateLocalData({ tasks: [] });
  assert.strictEqual(payload.projectId, 'p1');
  assert.strictEqual(payload.counts.tasks, 0);
});

// ---- 冲突合并 --------------------------------------------------

test('resolveConflict 本地更新时按 updated 取胜', function() {
  var local = { id: 't1', name: '本地', status: 'done', rev: 2, updated: '2026-01-02T00:00:00Z' };
  var remote = { id: 't1', name: '远端', status: 'inProgress', rev: 1, updated: '2026-01-01T00:00:00Z' };
  var result = SyncClient.resolveConflict(local, remote);
  assert.strictEqual(result.source, 'local');
  assert.strictEqual(result.record.name, '本地');
  assert.strictEqual(result.record.status, 'done');
  assert.strictEqual(result.record.rev, 2);
  assert.deepEqual(result.conflicts, []);
});

test('resolveConflict 远端更新时采用远端', function() {
  var local = { id: 't1', name: '本地', rev: 1, updated: '2026-01-01T00:00:00Z' };
  var remote = { id: 't1', name: '远端', rev: 3, updated: '2026-01-03T00:00:00Z' };
  var result = SyncClient.resolveConflict(local, remote);
  assert.strictEqual(result.source, 'remote');
  assert.strictEqual(result.record.name, '远端');
  assert.strictEqual(result.record.rev, 3);
});

test('resolveConflict 不同字段各自合并', function() {
  var local = {
    id: 't1', name: '本地名', rev: 2, updated: '2026-01-02T00:00:00Z',
    changed: ['name']
  };
  var remote = {
    id: 't1', status: 'done', rev: 2, updated: '2026-01-03T00:00:00Z',
    changed: ['status']
  };
  var result = SyncClient.resolveConflict(local, remote);
  assert.strictEqual(result.source, 'merge');
  assert.strictEqual(result.record.name, '本地名');
  assert.strictEqual(result.record.status, 'done');
  assert.deepEqual(result.conflicts, []);
});

test('resolveConflict 同一字段冲突时较新者胜出并记录冲突', function() {
  var local = {
    id: 't1', name: '本地名', rev: 2, updated: '2026-01-04T00:00:00Z',
    changed: ['name']
  };
  var remote = {
    id: 't1', name: '远端名', rev: 2, updated: '2026-01-03T00:00:00Z',
    changed: ['name']
  };
  var result = SyncClient.resolveConflict(local, remote);
  assert.strictEqual(result.record.name, '本地名');
  assert.deepEqual(result.conflicts, ['name']);
});

test('resolveConflict 结构性字段始终采用远端', function() {
  var local = {
    id: 't1', name: '本地', parentId: 'p1', rev: 2,
    updated: '2026-01-04T00:00:00Z'
  };
  var remote = {
    id: 't1', name: '远端', parentId: 'p2', rev: 1,
    updated: '2026-01-01T00:00:00Z'
  };
  var result = SyncClient.resolveConflict(local, remote);
  assert.strictEqual(result.record.name, '本地');
  assert.strictEqual(result.record.parentId, 'p2');
  assert.deepEqual(result.conflicts, ['parentId']);
});

test('resolveConflict 远端墓碑优先于本地编辑', function() {
  var local = { id: 't1', name: '本地', rev: 2, updated: '2026-01-04T00:00:00Z' };
  var remote = {
    id: 't1', name: '远端', rev: 3, updated: '2026-01-03T00:00:00Z',
    deleted_at: '2026-01-03T00:00:00Z'
  };
  var result = SyncClient.resolveConflict(local, remote);
  assert.strictEqual(result.deleted, true);
  assert.strictEqual(result.record.deleted, true);
  assert.strictEqual(result.record.deleted_at, '2026-01-03T00:00:00Z');
  assert.deepEqual(result.conflicts, ['deleted_at']);
});

test('resolveConflict 本地墓碑优先于较新的远端编辑', function() {
  var local = {
    id: 't1', deleted: true, deleted_at: '2026-01-03T00:00:00Z',
    rev: 2, updated: '2026-01-03T00:00:00Z'
  };
  var remote = { id: 't1', name: '远端', rev: 3, updated: '2026-01-04T00:00:00Z' };
  var result = SyncClient.resolveConflict(local, remote);
  assert.strictEqual(result.deleted, true);
  assert.strictEqual(result.record.deleted, true);
});

test('resolveConflict 显式恢复可以覆盖远端墓碑', function() {
  var local = {
    id: 't1', name: '恢复', deleted: false, rev: 4,
    updated: '2026-01-05T00:00:00Z'
  };
  var remote = {
    id: 't1', deleted_at: '2026-01-03T00:00:00Z',
    rev: 3, updated: '2026-01-03T00:00:00Z'
  };
  var result = SyncClient.resolveConflict(local, remote);
  assert.strictEqual(result.deleted, false);
  assert.strictEqual(result.record.name, '恢复');
  assert.deepEqual(result.conflicts, ['deleted_at']);
});

test('resolveConflict 支持 local 和 remote 强制策略', function() {
  var local = { id: 't1', name: '本地', rev: 1, updated: '2026-01-01T00:00:00Z' };
  var remote = {
    id: 't1', name: '远端', rev: 2, updated: '2026-01-02T00:00:00Z',
    deleted_at: '2026-01-02T00:00:00Z'
  };

  var localWin = SyncClient.resolveConflict(local, remote, 'local');
  assert.strictEqual(localWin.record.name, '本地');
  assert.strictEqual(localWin.deleted, false);

  var remoteWin = SyncClient.resolveConflict(local, remote, 'remote');
  assert.strictEqual(remoteWin.record.deleted, true);
  assert.strictEqual(remoteWin.deleted, true);
});

test('resolveConflict 不修改输入且返回新对象', function() {
  var local = {
    id: 't1', name: '本地', rev: 2, updated: '2026-01-02T00:00:00Z',
    changed: ['name'], nested: { a: 1 }
  };
  var remote = {
    id: 't1', status: 'done', rev: 2, updated: '2026-01-01T00:00:00Z',
    changed: ['status'], nested: { b: 2 }
  };
  var localBefore = JSON.stringify(local);
  var remoteBefore = JSON.stringify(remote);

  var result = SyncClient.resolveConflict(local, remote);
  result.record.nested.a = 99;

  assert.strictEqual(JSON.stringify(local), localBefore);
  assert.strictEqual(JSON.stringify(remote), remoteBefore);
  assert.notStrictEqual(result.record, local);
  assert.notStrictEqual(result.record, remote);
  assert.strictEqual(local.nested.a, 1);
  assert.strictEqual(remote.nested.b, 2);
});

test('resolveConflict 非法输入抛出 validation', function() {
  assert.throws(function() {
    SyncClient.resolveConflict(null, null);
  }, function(error) { return error.kind === 'validation'; });
  assert.throws(function() {
    SyncClient.resolveConflict({ id: 't1' }, { id: 't1' }, 'magic');
  }, function(error) { return error.kind === 'validation'; });
});

// ---- 加载隔离 --------------------------------------------------

test('模块加载与基本调用不访问 localStorage 和 DOM', function() {
  var source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8');
  var sandbox = {
    console: console,
    Promise: Promise,
    Date: Date,
    Map: Map,
    Math: Math,
    JSON: JSON,
    Error: Error,
    String: String,
    Number: Number,
    Object: Object,
    Array: Array,
    Set: Set,
    encodeURIComponent: encodeURIComponent
  };
  ['localStorage', 'sessionStorage', 'document', 'window'].forEach(function(name) {
    Object.defineProperty(sandbox, name, {
      configurable: true,
      get: function() { throw new Error('SyncClient 不应访问 ' + name); }
    });
  });

  var context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'js/sync.js' });
  var Isolated = vm.runInContext('SyncClient', context);
  var client = Isolated.createClient({
    projectId: 'p1',
    transport: function() {
      return Promise.resolve({ status: 200, data: { changes: [], cursor: 0 } });
    }
  });

  var merged = Isolated.resolveConflict(
    { id: 't1', name: '本地', rev: 2, updated: '2026-01-02T00:00:00Z' },
    { id: 't1', name: '远端', rev: 1, updated: '2026-01-01T00:00:00Z' }
  );
  assert.strictEqual(merged.record.name, '本地');
  assert.strictEqual(typeof client.pullChanges, 'function');
});

(async function() {
  var failures = 0;
  for (var i = 0; i < tests.length; i++) {
    var current = tests[i];
    try {
      await current.fn();
      console.log('PASS ' + current.name);
    } catch (error) {
      failures++;
      console.log('FAIL ' + current.name);
      console.log('  ' + (error && error.stack ? error.stack : error));
    }
  }
  console.log('\nsync: ' + (tests.length - failures) + '/' + tests.length + ' passed');
  process.exit(failures === 0 ? 0 : 1);
})();
