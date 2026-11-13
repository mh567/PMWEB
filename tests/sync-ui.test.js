'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['sync.js', 'sync-queue.js', 'sync-ui.js']);
var SyncUI = app.get('SyncUI');
var SyncClient = app.get('SyncClient');
var SyncQueue = app.get('SyncQueue');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function makeStorage(initial) {
  var data = {};
  if (initial) {
    Object.keys(initial).forEach(function(key) { data[key] = initial[key]; });
  }
  return {
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function(key, val) { data[key] = String(val); },
    removeItem: function(key) { delete data[key]; }
  };
}

function makeTransport(handler) {
  var calls = [];
  function transport(req) {
    calls.push(req);
    return Promise.resolve().then(function() {
      return handler(req, calls.length - 1);
    });
  }
  transport.calls = calls;
  return transport;
}

function jsonResponse(status, data) {
  return { status: status, data: data };
}

// ---- 初始化与配置持久化 ----

test('SyncUI.init 加载默认配置并初始化客户端与队列', function() {
  var storage = makeStorage();
  SyncUI.init({ storage: storage });
  var cfg = SyncUI.getConfig();
  assert.strictEqual(cfg.serverUrl, 'http://127.0.0.1:8090');
  assert.strictEqual(cfg.projectId, 'default');
  assert.strictEqual(cfg.token, null);
  assert.strictEqual(cfg.autoSync, false);

  var state = SyncUI.getState();
  assert.strictEqual(state.status, 'offline');
  assert.strictEqual(state.queueSize, 0);
});

test('SyncUI.setServerUrl 和 setProjectId 更新配置并持久化', function() {
  var storage = makeStorage();
  SyncUI.init({ storage: storage });

  SyncUI.setServerUrl('https://pb.test.internal:8090/');
  SyncUI.setProjectId('proj-alpha');

  var cfg = SyncUI.getConfig();
  assert.strictEqual(cfg.serverUrl, 'https://pb.test.internal:8090/');
  assert.strictEqual(cfg.projectId, 'proj-alpha');

  // 验证重新 init 后依然能恢复
  SyncUI.init({ storage: storage });
  var cfg2 = SyncUI.getConfig();
  assert.strictEqual(cfg2.serverUrl, 'https://pb.test.internal:8090/');
  assert.strictEqual(cfg2.projectId, 'proj-alpha');
});

// ---- 登录与登出 ----

test('SyncUI.login 调用客户端鉴权，保存 token 并更新状态为 idle', async function() {
  var storage = makeStorage();
  var transport = makeTransport(function(req) {
    if (req.url.indexOf('auth-with-password') !== -1) {
      return jsonResponse(200, {
        token: 'jwt-token-123',
        record: { id: 'u-1', email: 'admin@test.com' }
      });
    }
    return jsonResponse(200, {});
  });

  SyncUI.init({ storage: storage, transport: transport });
  var res = await SyncUI.login('admin@test.com', 'pass123');

  assert.strictEqual(res.token, 'jwt-token-123');
  var state = SyncUI.getState();
  assert.strictEqual(state.status, 'idle');
  assert.strictEqual(state.user.email, 'admin@test.com');
  assert.strictEqual(SyncUI.getConfig().token, 'jwt-token-123');

  // 测试 logout
  SyncUI.logout();
  var stateAfter = SyncUI.getState();
  assert.strictEqual(stateAfter.status, 'offline');
  assert.strictEqual(stateAfter.user, null);
  assert.strictEqual(SyncUI.getConfig().token, null);
});

test('SyncUI.login 失败时更新状态为 error 并记录 lastError', async function() {
  var storage = makeStorage();
  var transport = makeTransport(function() {
    return jsonResponse(400, { message: 'Invalid credentials' });
  });

  SyncUI.init({ storage: storage, transport: transport });
  var failed = false;
  try {
    await SyncUI.login('wrong@test.com', 'badpass');
  } catch (err) {
    failed = true;
  }
  assert.strictEqual(failed, true);
  var state = SyncUI.getState();
  assert.strictEqual(state.status, 'error');
  assert.strictEqual(typeof state.lastError, 'string');
});

// ---- 首次上传本地数据 ----

test('SyncUI.uploadInitialData 转换本地数据并批量推送到服务端', async function() {
  SyncUI._resetForTesting();
  var storage = makeStorage();
  var pushCaptured = null;
  var transport = makeTransport(function(req) {
    if (req.url.indexOf('push') !== -1) {
      pushCaptured = req;
      var ops = req.body.ops || [];
      return jsonResponse(200, {
        results: ops.map(function(o) { return { opId: o.opId, status: 'ok', rev: 1 }; })
      });
    }
    return jsonResponse(200, {});
  });

  storage.setItem('pmweb_sync_config', JSON.stringify({ token: 'valid-token' }));
  SyncUI.init({ storage: storage, transport: transport });

  var localData = {
    pmweb_version: 3,
    tasks: [
      { id: 't1', name: '首个任务', startDate: '2026-01-01', endDate: '2026-01-05', status: 'inProgress' }
    ],
    milestones: [],
    links: []
  };

  var res = await SyncUI.uploadInitialData(localData);
  // localData 中包含 1 个任务和 1 个 settings
  assert.strictEqual(res.total, 2);
  assert.strictEqual(res.success, 2);
  assert.strictEqual(res.failed, 0);
  assert.strictEqual(pushCaptured.method, 'POST');
  assert.strictEqual(pushCaptured.body.projectId, 'default');
  assert.strictEqual(pushCaptured.body.ops.length, 2);

  var state = SyncUI.getState();
  assert.strictEqual(state.status, 'synced');
  assert.strictEqual(typeof state.lastSyncAt, 'string');
});

// ---- 队列入队与双向同步 syncNow ----

test('SyncUI.enqueueChange 将变更写入队列，更新状态为 queued', function() {
  var storage = makeStorage();
  SyncUI.init({ storage: storage });
  SyncUI.enqueueChange('tasks', 'task-101', 'update', { name: '新任务名' });

  var state = SyncUI.getState();
  assert.strictEqual(state.queueSize, 1);
  assert.strictEqual(state.status, 'queued');

  var q = SyncUI.getQueue();
  var item = q.peek();
  assert.strictEqual(item.entityId, 'task-101');
  assert.strictEqual(item.op, 'update');
  assert.deepEqual(item.patch, { name: '新任务名' });
});

test('SyncUI.syncNow 推送待同步队列并拉取远端变更', async function() {
  var storage = makeStorage();
  storage.setItem('pmweb_sync_config', JSON.stringify({ token: 'mock-jwt-token' }));
  var pushedOps = [];
  var transport = makeTransport(function(req) {
    if (req.url.indexOf('push') !== -1) {
      pushedOps = req.body.ops;
      return jsonResponse(200, {
        results: pushedOps.map(function(o) { return { opId: o.opId, status: 'ok', rev: 2 }; })
      });
    }
    if (req.url.indexOf('pull') !== -1) {
      return jsonResponse(200, {
        changes: [
          {
            entity: 'tasks',
            entityId: 'remote-1',
            op: 'create',
            rev: 1,
            record: { id: 'remote-1', name: '远端新增任务' }
          }
        ],
        cursor: 105
      });
    }
    return jsonResponse(200, {});
  });

  var appliedTasks = [];
  var mockTaskManager = {
    getTask: function() { return null; },
    addTask: function(t) { appliedTasks.push(t); },
    updateTask: function() {},
    deleteTask: function() {},
    getAllMilestones: function() { return []; },
    getAllLinks: function() { return []; }
  };

  SyncUI.init({ storage: storage, transport: transport, taskManager: mockTaskManager });
  SyncUI.enqueueChange('tasks', 'local-1', 'create', { id: 'local-1', name: '本地待推' });
  assert.strictEqual(SyncUI.getState().queueSize, 1);

  var syncRes = await SyncUI.syncNow();
  assert.strictEqual(syncRes.success, true);
  assert.strictEqual(pushedOps.length, 1);
  assert.strictEqual(SyncUI.getState().queueSize, 0);
  assert.strictEqual(SyncUI.getState().status, 'synced');
  assert.strictEqual(appliedTasks.length, 1);
  assert.strictEqual(appliedTasks[0].id, 'remote-1');
  assert.strictEqual(SyncUI.getConfig().cursor, 105);
});

test('SyncUI.buildModalHtml 生成包含状态、配置与操作按钮的 HTML 结构', function() {
  var storage = makeStorage();
  SyncUI.init({ storage: storage });
  var html = SyncUI.buildModalHtml();

  assert.strictEqual(typeof html, 'string');
  assert.ok(html.indexOf('PocketBase 地址') !== -1);
  assert.ok(html.indexOf('项目 ID') !== -1);
  assert.ok(html.indexOf('立即双向同步') !== -1);
  assert.ok(html.indexOf('首次上传本地数据到云端') !== -1);
  assert.ok(html.indexOf('清空本地待推队列') !== -1);
});

// ---- 执行所有用例 ----

async function run() {
  var passed = 0;
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      await t.fn();
      passed++;
      console.log('PASS ' + t.name);
    } catch (err) {
      console.error('FAIL ' + t.name);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log('\nsync-ui: ' + passed + '/' + tests.length + ' passed');
}

run();
