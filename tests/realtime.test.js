'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['realtime.js']);
var RealtimeClient = app.get('RealtimeClient');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function makeMockTransport() {
  var listeners = {};
  var sentPresence = [];
  var subscribed = [];

  return {
    sentPresence: sentPresence,
    subscribed: subscribed,
    listeners: listeners,
    connect: function(url, handlers) {
      listeners.onOpen = handlers.onOpen;
      listeners.onMessage = handlers.onMessage;
      listeners.onError = handlers.onError;
      return {
        close: function() {
          listeners.closed = true;
        }
      };
    },
    subscribe: function(cid, subs) {
      subscribed.push({ cid: cid, subs: subs });
    },
    sendPresence: function(payload) {
      sentPresence.push(payload);
    },
    emitOpen: function() {
      if (listeners.onOpen) listeners.onOpen();
    },
    emitMessage: function(data) {
      if (listeners.onMessage) listeners.onMessage(data);
    },
    emitError: function(err) {
      if (listeners.onError) listeners.onError(err);
    }
  };
}

// ---- 自产生变更回显防抖 ----

test('trackLocalOp 与 isLocalEcho 精确过滤本地产生的操作', function() {
  RealtimeClient._resetForTesting();
  RealtimeClient.init();

  assert.strictEqual(RealtimeClient.isLocalEcho('op-123'), false);

  RealtimeClient.trackLocalOp('op-123');
  assert.strictEqual(RealtimeClient.isLocalEcho('op-123'), true);
  assert.strictEqual(RealtimeClient.isLocalEcho('op-456'), false);
});

// ---- 连接握手与订阅 ----

test('connect 与 handleMessage 完成客户端握手并订阅集合', function() {
  RealtimeClient._resetForTesting();
  var transport = makeMockTransport();
  RealtimeClient.init({ transport: transport });

  RealtimeClient.connect();
  assert.strictEqual(RealtimeClient.getState().status, 'connecting');

  transport.emitOpen();
  assert.strictEqual(RealtimeClient.getState().status, 'connected');

  // 服务端下发首次握手 clientId
  transport.emitMessage({ clientId: 'conn-abc-1' });
  assert.strictEqual(RealtimeClient.getState().clientId, 'conn-abc-1');
  assert.strictEqual(transport.subscribed.length, 1);
  assert.strictEqual(transport.subscribed[0].cid, 'conn-abc-1');
});

// ---- 事件过滤与批量合并应用 ----

test('handleMessage 过滤自产生回显，批量合并非自身事件', function() {
  RealtimeClient._resetForTesting();
  var transport = makeMockTransport();
  var batchReceived = null;
  var updatedTasks = [];

  var mockTaskManager = {
    getTask: function(id) { return id === 't1' ? { id: 't1', name: '旧名称' } : null; },
    updateTask: function(id, patch) { updatedTasks.push({ id: id, patch: patch }); },
    addTask: function() {},
    deleteTask: function() {},
    getAllMilestones: function() { return []; },
    getAllLinks: function() { return []; }
  };

  RealtimeClient.init({
    transport: transport,
    taskManager: mockTaskManager,
    onBatchApplied: function(batch) {
      batchReceived = batch;
    }
  });

  RealtimeClient.connect();
  transport.emitOpen();

  // 1. 模拟本地刚刚推送的 opId
  RealtimeClient.trackLocalOp('local-op-999');

  // 服务端广播事件：包含一条本地推送的回显，和一条他人操作
  transport.emitMessage({
    action: 'update',
    collection: 'tasks',
    opId: 'local-op-999', // 应该被忽略
    record: { id: 't1', name: '本地回显' }
  });

  transport.emitMessage({
    action: 'update',
    collection: 'tasks',
    opId: 'remote-op-888', // 应该被接收
    record: { id: 't1', name: '远程修改' }
  });

  // 立即刷新测试专用批处理
  RealtimeClient._flushPendingBatchForTesting();

  assert.ok(batchReceived !== null);
  assert.strictEqual(batchReceived.length, 1);
  assert.strictEqual(batchReceived[0].record.name, '远程修改');

  assert.strictEqual(updatedTasks.length, 1);
  assert.strictEqual(updatedTasks[0].id, 't1');
  assert.strictEqual(updatedTasks[0].patch.name, '远程修改');
});

// ---- 协同在线状态与心跳感知 ----

test('updateCollaborator 记录在线协作者并定位正在编辑任务', function() {
  RealtimeClient._resetForTesting();
  RealtimeClient.init({
    user: { id: 'me-1', name: '本人' }
  });

  // 收到自身心跳：应被忽略
  RealtimeClient.updateCollaborator({ userId: 'me-1', name: '本人' });
  assert.strictEqual(RealtimeClient.getOnlineCollaborators().length, 0);

  // 收到他人心跳
  RealtimeClient.updateCollaborator({
    userId: 'user-2',
    name: '张三',
    email: 'zhangsan@example.com',
    activeTaskId: 'task-101'
  });

  var list = RealtimeClient.getOnlineCollaborators();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'user-2');
  assert.strictEqual(list[0].name, '张三');
  assert.strictEqual(list[0].activeTaskId, 'task-101');

  // 查找编辑 task-101 的协作者
  var matched = RealtimeClient.getCollaboratorForTask('task-101');
  assert.ok(matched !== null);
  assert.strictEqual(matched.name, '张三');

  var notMatched = RealtimeClient.getCollaboratorForTask('task-999');
  assert.strictEqual(notMatched, null);
});

// ---- 断线重连与增量补齐触发 ----

test('handleError 触发重连，重连成功后调用 onReconnect 补齐数据', function() {
  RealtimeClient._resetForTesting();
  var transport = makeMockTransport();
  var reconnected = false;

  RealtimeClient.init({
    transport: transport,
    onReconnect: function() {
      reconnected = true;
    }
  });

  RealtimeClient.connect();
  transport.emitOpen();
  assert.strictEqual(RealtimeClient.getState().status, 'connected');

  // 模拟异常断线
  transport.emitError(new Error('Connection lost'));
  assert.strictEqual(RealtimeClient.getState().status, 'reconnecting');
  assert.strictEqual(RealtimeClient.getState().reconnectAttempts, 1);

  // 模拟重新连接握手成功
  transport.emitOpen();
  assert.strictEqual(RealtimeClient.getState().status, 'connected');
  assert.strictEqual(RealtimeClient.getState().reconnectAttempts, 0);
  assert.strictEqual(reconnected, true);
});

// ---- 协作者心跳与正在查看任务状态 ----

test('sendHeartbeat 上报当前活跃任务与成员凭证', function() {
  RealtimeClient._resetForTesting();
  var transport = makeMockTransport();
  RealtimeClient.init({
    transport: transport,
    user: { id: 'u-self', name: '我' }
  });

  RealtimeClient.sendHeartbeat('task-888');
  assert.strictEqual(transport.sentPresence.length, 1);
  var pres = transport.sentPresence[0];
  assert.strictEqual(pres.userId, 'u-self');
  assert.strictEqual(pres.name, '我');
  assert.strictEqual(pres.activeTaskId, 'task-888');
  assert.strictEqual(typeof pres.avatarColor, 'string');
});

test('getCollaboratorForTask 精确返回正在编辑该任务的协作者', function() {
  RealtimeClient._resetForTesting();
  RealtimeClient.init();

  RealtimeClient.updateCollaborator({
    userId: 'u-alice',
    name: 'Alice',
    activeTaskId: 'task-101'
  });
  RealtimeClient.updateCollaborator({
    userId: 'u-bob',
    name: 'Bob',
    activeTaskId: 'task-102'
  });

  var col1 = RealtimeClient.getCollaboratorForTask('task-101');
  assert.ok(col1);
  assert.strictEqual(col1.name, 'Alice');

  var col2 = RealtimeClient.getCollaboratorForTask('task-102');
  assert.ok(col2);
  assert.strictEqual(col2.name, 'Bob');

  var colNone = RealtimeClient.getCollaboratorForTask('task-999');
  assert.strictEqual(colNone, null);
});

test('GridPane 在协作者正在编辑该任务时渲染徽标', function() {
  var gridApp = helper.createApp(['realtime.js', 'grid-pane.js']);
  var RT = gridApp.get('RealtimeClient');
  var GP = gridApp.get('GridPane');

  RT._resetForTesting();
  RT.init();
  RT.updateCollaborator({
    userId: 'u-charlie',
    name: 'Charlie',
    activeTaskId: 'task-77'
  });

  var row = {
    id: 'task-77',
    depth: 0,
    hasChildren: false,
    isCollapsed: false,
    task: { id: 'task-77', name: '用户调研' }
  };

  var html = GP.renderNameCell(row, false);
  assert.ok(html.indexOf('grid-collaborator-badge') !== -1, '包含协同徽标');
  assert.ok(html.indexOf('Charlie 在此') !== -1, '包含成员名称提示');
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
    } finally {
      RealtimeClient.disconnect();
    }
  }
  console.log('\nrealtime: ' + passed + '/' + tests.length + ' passed');
}

run();
