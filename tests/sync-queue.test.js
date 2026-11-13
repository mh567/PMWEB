'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['sync-queue.js']);
var SyncQueue = app.get('SyncQueue');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function makeStorage(initial) {
  var data = {};
  if (initial) {
    Object.keys(initial).forEach(function(key) { data[key] = initial[key]; });
  }
  return {
    data: data,
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function(key, value) { data[key] = String(value); },
    removeItem: function(key) { delete data[key]; }
  };
}

function makeClock(start) {
  var value = start;
  return {
    now: function() { return value; },
    set: function(next) { value = next; },
    advance: function(delta) { value += delta; }
  };
}

function baseItem(overrides) {
  var item = {
    projectId: 'p1',
    entity: 'tasks',
    entityId: 't1',
    op: 'update',
    patch: { name: 'A' },
    baseRev: 1
  };
  Object.keys(overrides || {}).forEach(function(key) { item[key] = overrides[key]; });
  return item;
}

// ---- 入队与持久化 ----------------------------------------------

test('enqueue 写入 localStorage 并可被新实例读取', function() {
  var storage = makeStorage();
  var clock = makeClock(1000);
  var queue = SyncQueue.create({ storage: storage, now: clock.now });

  var result = queue.enqueue(baseItem({ opId: 'op-1' }));
  assert.strictEqual(result.duplicate, false);
  assert.strictEqual(result.item.opId, 'op-1');
  assert.strictEqual(result.item.entity, 'tasks');
  assert.strictEqual(result.item.attempts, 0);
  assert.strictEqual(result.item.status, 'pending');
  assert.strictEqual(result.item.nextAttemptAt, 0);
  assert.strictEqual(result.item.clientAt, 1000);
  assert.strictEqual(queue.size(), 1);

  var raw = JSON.parse(storage.getItem(SyncQueue.STORAGE_KEY));
  assert.strictEqual(raw.version, SyncQueue.VERSION);
  assert.strictEqual(raw.items.length, 1);

  var reloaded = SyncQueue.create({ storage: storage, now: clock.now });
  assert.strictEqual(reloaded.size(), 1);
  assert.deepEqual(reloaded.get('op-1'), result.item);
});

test('enqueue 为缺失的 opId 生成唯一键', function() {
  var clock = makeClock(1000);
  var queue = SyncQueue.create({ storage: makeStorage(), now: clock.now });
  var first = queue.enqueue(baseItem());
  var second = queue.enqueue(baseItem({ entityId: 't2' }));

  assert.ok(/^op-/.test(first.item.opId));
  assert.ok(/^op-/.test(second.item.opId));
  assert.notStrictEqual(first.item.opId, second.item.opId);
  assert.strictEqual(queue.size(), 2);
});

test('enqueue 按 opId 幂等，重复入队不覆盖原项', function() {
  var queue = SyncQueue.create({ storage: makeStorage(), now: makeClock(1000).now });
  queue.enqueue(baseItem({ opId: 'op-1', patch: { name: '第一次' } }));

  var result = queue.enqueue(baseItem({ opId: 'op-1', patch: { name: '第二次' } }));

  assert.strictEqual(result.duplicate, true);
  assert.strictEqual(queue.size(), 1);
  assert.deepEqual(queue.get('op-1').patch, { name: '第一次' });
});

function throwsTypeError(fn) {
  assert.throws(fn, function(error) {
    return error && error.name === 'TypeError';
  });
}

test('enqueue 规范化实体别名并拒绝非法输入', function() {
  var queue = SyncQueue.create({ storage: makeStorage(), now: makeClock(1000).now });
  var result = queue.enqueue(baseItem({ entity: 'task', opId: 'op-1' }));
  assert.strictEqual(result.item.entity, 'tasks');

  throwsTypeError(function() {
    queue.enqueue(baseItem({ entity: 'unknown', opId: 'op-2' }));
  });
  throwsTypeError(function() {
    queue.enqueue(baseItem({ entityId: '', opId: 'op-3' }));
  });
  throwsTypeError(function() {
    queue.enqueue(baseItem({ op: 'merge', opId: 'op-4' }));
  });
  throwsTypeError(function() {
    queue.enqueue(baseItem({ patch: 'not-an-object', opId: 'op-5' }));
  });
  assert.strictEqual(queue.size(), 1);
});

test('队列不修改传入对象，list 和 get 返回副本', function() {
  var queue = SyncQueue.create({ storage: makeStorage(), now: makeClock(1000).now });
  var input = baseItem({
    opId: 'op-1',
    patch: { name: 'A', nested: { value: 1 } }
  });
  var before = JSON.stringify(input);
  var result = queue.enqueue(input);

  assert.strictEqual(JSON.stringify(input), before);
  result.item.patch.nested.value = 99;
  assert.strictEqual(input.patch.nested.value, 1);
  assert.strictEqual(queue.get('op-1').patch.nested.value, 1);

  var listed = queue.list();
  listed[0].patch.nested.value = 42;
  assert.strictEqual(queue.get('op-1').patch.nested.value, 1);
  assert.notStrictEqual(queue.list()[0], queue.list()[0]);
});

test('存储内容损坏时安全回退为空队列', function() {
  var storage = makeStorage();
  storage.setItem(SyncQueue.STORAGE_KEY, '{broken');
  var queue = SyncQueue.create({ storage: storage, now: makeClock(1000).now });
  assert.strictEqual(queue.size(), 0);
  assert.strictEqual(queue.peek(), null);
});

test('存储中的重复 opId 和非法项在加载时被剔除', function() {
  var storage = makeStorage();
  storage.setItem(SyncQueue.STORAGE_KEY, JSON.stringify({
    version: 1,
    items: [
      { opId: 'op-1', entity: 'tasks', entityId: 't1', op: 'update' },
      { opId: 'op-1', entity: 'tasks', entityId: 't2', op: 'update' },
      { opId: 'op-2', entity: 'unknown', entityId: 't1', op: 'update' },
      { opId: 'op-3', entity: 'tasks', entityId: 't1', op: 'bad' }
    ]
  }));
  var queue = SyncQueue.create({ storage: storage, now: makeClock(1000).now });
  assert.strictEqual(queue.size(), 1);
  assert.strictEqual(queue.get('op-1').entityId, 't1');
});

// ---- 顺序与 peek ----------------------------------------------

test('list 保持入队顺序，peek 返回最早可运行项', function() {
  var queue = SyncQueue.create({ storage: makeStorage(), now: makeClock(1000).now });
  queue.enqueue(baseItem({ opId: 'op-1', entityId: 't1' }));
  queue.enqueue(baseItem({ opId: 'op-2', entityId: 't2' }));
  queue.enqueue(baseItem({ opId: 'op-3', entity: 'milestones', entityId: 'm1' }));

  assert.deepEqual(
    queue.list().map(function(item) { return item.opId; }),
    ['op-1', 'op-2', 'op-3']
  );
  assert.strictEqual(queue.peek().opId, 'op-1');

  queue.ack('op-1');
  assert.strictEqual(queue.peek().opId, 'op-2');
});

test('同实体后续操作不会越过未确认的前序操作', function() {
  var clock = makeClock(1000);
  var queue = SyncQueue.create({
    storage: makeStorage(),
    now: clock.now,
    baseDelayMs: 100,
    maxDelayMs: 1000
  });
  queue.enqueue(baseItem({ opId: 'op-1', entityId: 't1' }));
  queue.enqueue(baseItem({ opId: 'op-2', entityId: 't1' }));
  queue.enqueue(baseItem({ opId: 'op-3', entity: 'milestones', entityId: 'm1' }));

  queue.fail('op-1', 'temporary');

  assert.strictEqual(queue.peek().opId, 'op-3');
  assert.strictEqual(queue.peek({ includeDelayed: true }).opId, 'op-1');

  clock.set(1100);
  assert.strictEqual(queue.peek().opId, 'op-1');
});

// ---- 退避与重试上限 --------------------------------------------

test('fail 使用指数退避并在达到上限后标记 dead', function() {
  var clock = makeClock(1000);
  var queue = SyncQueue.create({
    storage: makeStorage(),
    now: clock.now,
    baseDelayMs: 100,
    maxDelayMs: 250,
    maxAttempts: 5
  });
  queue.enqueue(baseItem({ opId: 'op-1' }));

  var first = queue.fail('op-1', 'e1');
  assert.strictEqual(first.attempts, 1);
  assert.strictEqual(first.status, 'pending');
  assert.strictEqual(first.nextAttemptAt, 1100);
  assert.strictEqual(first.lastError, 'e1');

  clock.set(2000);
  var second = queue.fail('op-1', new Error('e2'));
  assert.strictEqual(second.attempts, 2);
  assert.strictEqual(second.nextAttemptAt, 2200);
  assert.strictEqual(second.lastError, 'e2');

  clock.set(3000);
  var third = queue.fail('op-1', 'e3');
  assert.strictEqual(third.attempts, 3);
  assert.strictEqual(third.nextAttemptAt, 3250);

  clock.set(4000);
  queue.fail('op-1', 'e4');
  clock.set(5000);
  var fifth = queue.fail('op-1', 'e5');

  assert.strictEqual(fifth.attempts, 5);
  assert.strictEqual(fifth.status, 'dead');
  assert.strictEqual(fifth.nextAttemptAt, null);
  assert.strictEqual(queue.peek(), null);
  assert.strictEqual(queue.peek({ includeDead: true }).opId, 'op-1');
  assert.strictEqual(queue.size(), 1);
});

test('fail 未知 opId 返回 null，退避不产生负值', function() {
  var queue = SyncQueue.create({ storage: makeStorage(), now: makeClock(1000).now });
  assert.strictEqual(queue.fail('missing', 'x'), null);

  var zero = SyncQueue.create({
    storage: makeStorage(),
    now: makeClock(1000).now,
    baseDelayMs: 0,
    maxDelayMs: 0
  });
  zero.enqueue(baseItem({ opId: 'op-1' }));
  var result = zero.fail('op-1', 'x');
  assert.strictEqual(result.nextAttemptAt, 1000);
});

// ---- ack、clear、size -----------------------------------------

test('ack 删除指定项并返回是否存在', function() {
  var queue = SyncQueue.create({ storage: makeStorage(), now: makeClock(1000).now });
  queue.enqueue(baseItem({ opId: 'op-1' }));
  queue.enqueue(baseItem({ opId: 'op-2' }));

  assert.strictEqual(queue.ack('op-1'), true);
  assert.strictEqual(queue.size(), 1);
  assert.strictEqual(queue.get('op-1'), null);
  assert.strictEqual(queue.ack('op-1'), false);
});

test('ack 后持久化内容同步更新', function() {
  var storage = makeStorage();
  var queue = SyncQueue.create({ storage: storage, now: makeClock(1000).now });
  queue.enqueue(baseItem({ opId: 'op-1' }));
  queue.ack('op-1');

  var raw = JSON.parse(storage.getItem(SyncQueue.STORAGE_KEY));
  assert.strictEqual(raw.items.length, 0);
  assert.strictEqual(SyncQueue.create({ storage: storage }).size(), 0);
});

test('clear 返回删除数量并清空队列', function() {
  var queue = SyncQueue.create({ storage: makeStorage(), now: makeClock(1000).now });
  queue.enqueue(baseItem({ opId: 'op-1' }));
  queue.enqueue(baseItem({ opId: 'op-2' }));

  assert.strictEqual(queue.clear(), 2);
  assert.strictEqual(queue.size(), 0);
  assert.strictEqual(queue.peek(), null);
  assert.strictEqual(queue.clear(), 0);
});

test('默认 key 为 pmweb_sync_queue', function() {
  assert.strictEqual(SyncQueue.STORAGE_KEY, 'pmweb_sync_queue');
  var storage = makeStorage();
  var queue = SyncQueue.create({ storage: storage, now: makeClock(1000).now });
  queue.enqueue(baseItem({ opId: 'op-1' }));
  assert.ok(storage.getItem('pmweb_sync_queue'));
});

test('默认实例方法委托到同一个队列', function() {
  SyncQueue._resetDefault();
  SyncQueue.clear();
  SyncQueue.enqueue(baseItem({ opId: 'global-1' }));
  assert.strictEqual(SyncQueue.size(), 1);
  assert.strictEqual(SyncQueue.peek().opId, 'global-1');
  assert.strictEqual(SyncQueue.ack('global-1'), true);
  assert.strictEqual(SyncQueue.size(), 0);
  SyncQueue._resetDefault();
});

test('队列只做数据操作，不定义网络方法', function() {
  var queue = SyncQueue.create({ storage: makeStorage(), now: makeClock(1000).now });
  assert.strictEqual(typeof queue.fetch, 'undefined');
  assert.strictEqual(typeof queue.push, 'undefined');
  assert.deepEqual(
    Object.keys(queue).sort(),
    [
      'ack', 'baseDelayMs', 'clear', 'enqueue', 'fail', 'get', 'list',
      'maxAttempts', 'maxDelayMs', 'peek', 'size', 'storageKey'
    ].sort()
  );
});

var failures = 0;
tests.forEach(function(current) {
  try {
    current.fn();
    console.log('PASS ' + current.name);
  } catch (error) {
    failures++;
    console.log('FAIL ' + current.name);
    console.log('  ' + (error && error.stack ? error.stack : error));
  }
});

console.log('\nsync-queue: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
