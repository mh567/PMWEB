'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var idbHelper = require('./helpers/idb-mock');

var idbMock = idbHelper.createIndexedDBMock();

var app = helper.createApp([
  'attachment-meta.js',
  'attachment-store.js'
], {
  indexedDB: idbMock
});

var AttachmentStore = app.get('AttachmentStore');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function resetEnv() {
  idbMock.reset();
  return AttachmentStore.reset();
}

test('put: 仅在真实 IDB 事务 oncomplete 成功后 resolve', async function() {
  await resetEnv();
  var blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' });
  var completed = false;

  var putPromise = AttachmentStore.put('blob-1', blob, {
    size: 3,
    type: 'text/plain',
    taskId: 'task-1'
  }).then(function() {
    completed = true;
  });

  // 必须是异步事务完成后才 resolve
  assert.strictEqual(completed, false, 'put 不得同步立即判定成功');
  await putPromise;
  assert.strictEqual(completed, true, '事务完成后必须 resolve');

  // 验证底层 IDB 存储真实写入
  var storeData = idbMock.getStoreData('pmweb-attachments', 'blobs');
  assert.strictEqual(storeData.has('blob-1'), true, 'IDB store 必须持久化记录');
  var rec = storeData.get('blob-1');
  assert.strictEqual(rec.size, 3);
  assert.strictEqual(rec.type, 'text/plain');
});

test('put: IDB 不可用时直接 reject，严禁静默内存保存成功', async function() {
  await resetEnv();
  idbMock.setFailOpen(true, new Error('IndexedDB 无法打开'));

  var blob = new Blob([new Uint8Array([4, 5, 6])], { type: 'text/plain' });
  var rejected = false;
  var thrownErr = null;

  try {
    await AttachmentStore.put('blob-fail-open', blob, { size: 3 });
  } catch (err) {
    rejected = true;
    thrownErr = err;
  }

  assert.strictEqual(rejected, true, 'IDB 打开失败时 put 必须 reject');
  assert.ok(thrownErr, '应抛出明确失败原因');

  // 严禁静默降级到内存：查询该键必须不存在
  var cached = await AttachmentStore.get('blob-fail-open');
  assert.strictEqual(cached, null, '失败写入不得留存于内存冒充成功');
});

test('put: IDB 事务 abort 时必须 reject 并回滚，内存不留存', async function() {
  await resetEnv();
  idbMock.setAbortOnPutKey('blob-abort');

  var blob = new Blob([new Uint8Array([7, 8, 9])], { type: 'text/plain' });
  var rejected = false;

  try {
    await AttachmentStore.put('blob-abort', blob, { size: 3 });
  } catch (err) {
    rejected = true;
  }

  assert.strictEqual(rejected, true, '事务 abort 时 put 必须 reject');

  // 底层 IDB 未写入
  var storeData = idbMock.getStoreData('pmweb-attachments', 'blobs');
  assert.strictEqual(storeData.has('blob-abort'), false, 'abort 后底层 store 不得有数据');

  // 内存缓存不得保留
  var cached = await AttachmentStore.get('blob-abort');
  assert.strictEqual(cached, null, 'abort 后内存缓存不得保留该键');
});

test('put: IDB 写入错误时必须 reject 并回滚', async function() {
  await resetEnv();
  idbMock.setFailOnPutKey('blob-err');

  var blob = new Blob([new Uint8Array([10])], { type: 'text/plain' });
  var rejected = false;

  try {
    await AttachmentStore.put('blob-err', blob, { size: 1 });
  } catch (err) {
    rejected = true;
  }

  assert.strictEqual(rejected, true, '写入出错时 put 必须 reject');
  var storeData = idbMock.getStoreData('pmweb-attachments', 'blobs');
  assert.strictEqual(storeData.has('blob-err'), false);
  assert.strictEqual(await AttachmentStore.get('blob-err'), null);
});

test('get 与 delete: 读写持久一致，删除后两层均清除', async function() {
  await resetEnv();
  var rawBytes = [0, 1, 127, 128, 255];
  var blob = new Blob([new Uint8Array(rawBytes)], { type: 'application/octet-stream' });

  await AttachmentStore.put('blob-bytes', blob, { size: 5, type: 'application/octet-stream' });

  var retrieved = await AttachmentStore.get('blob-bytes');
  assert.ok(retrieved, '应读回 Blob');
  var buf = await retrieved.arrayBuffer();
  assert.deepStrictEqual(Array.from(new Uint8Array(buf)), rawBytes, '读回字节必须完全一致');

  await AttachmentStore.delete('blob-bytes');
  assert.strictEqual(await AttachmentStore.get('blob-bytes'), null, '删除后 get 必须返回 null');
  var storeData = idbMock.getStoreData('pmweb-attachments', 'blobs');
  assert.strictEqual(storeData.has('blob-bytes'), false, 'IDB store 记录已被移除');
});

async function run() {
  var failures = 0;
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      await t.fn();
      console.log('PASS ' + t.name);
    } catch (err) {
      failures++;
      console.log('FAIL ' + t.name + ': ' + err.message);
      if (err.stack) console.log(err.stack);
    }
  }
  console.log('\nattachment-store: ' + (tests.length - failures) + '/' + tests.length + ' passed');
  process.exit(failures === 0 ? 0 : 1);
}

run();
