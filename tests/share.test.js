'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['share.js']);
var ShareManager = app.get('ShareManager');

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

// ---- 令牌生成与哈希计算 ----

test('generateToken 生成 32 位随机十六进制字符串', function() {
  var t1 = ShareManager.generateToken();
  var t2 = ShareManager.generateToken();
  assert.strictEqual(typeof t1, 'string');
  assert.strictEqual(t1.length, 32);
  assert.ok(/^[0-9a-f]{32}$/.test(t1));
  assert.notStrictEqual(t1, t2);
});

test('hashToken 确定性计算 SHA-256 哈希值', function() {
  var token = 'test-token-123456';
  var h1 = ShareManager.hashToken(token);
  var h2 = ShareManager.hashToken(token);
  assert.strictEqual(typeof h1, 'string');
  assert.strictEqual(h1.length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(h1));
  assert.strictEqual(h1, h2);

  // 验证固定字符串的已知 SHA-256
  // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
  assert.strictEqual(
    ShareManager.hashToken('hello'),
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
  );
});

// ---- 分享链接创建、列表与撤销 ----

test('createShareLink 创建带有效期的只读分享记录并持久化', function() {
  ShareManager._resetForTesting();
  var storage = makeStorage();
  ShareManager.init({ storage: storage });

  var link7d = ShareManager.createShareLink({ projectId: 'proj-1', expiresInDays: 7 });
  assert.strictEqual(link7d.projectId, 'proj-1');
  assert.strictEqual(link7d.role, 'viewer');
  assert.strictEqual(typeof link7d.token, 'string');
  assert.strictEqual(typeof link7d.tokenHash, 'string');
  assert.strictEqual(link7d.tokenHash, ShareManager.hashToken(link7d.token));
  assert.ok(link7d.expiresAt !== null);

  var linkPerm = ShareManager.createShareLink({ projectId: 'proj-1', expiresInDays: 0 });
  assert.strictEqual(linkPerm.expiresAt, null);

  var list = ShareManager.listShareLinks('proj-1');
  assert.strictEqual(list.length, 2);
});

test('revokeShareLink 撤销指定分享链接', function() {
  ShareManager._resetForTesting();
  var storage = makeStorage();
  ShareManager.init({ storage: storage });

  var link = ShareManager.createShareLink({ projectId: 'proj-1' });
  assert.strictEqual(link.revokedAt, null);

  var revoked = ShareManager.revokeShareLink(link.id);
  assert.ok(revoked !== null);
  assert.strictEqual(typeof revoked.revokedAt, 'string');

  var check = ShareManager.listShareLinks('proj-1')[0];
  assert.strictEqual(check.revokedAt, revoked.revokedAt);
});

// ---- 令牌校验逻辑 ----

test('validateToken 校验正常、已撤销与过期令牌', function() {
  ShareManager._resetForTesting();
  var storage = makeStorage();
  ShareManager.init({ storage: storage });

  // 1. 正常有效链接
  var link = ShareManager.createShareLink({ projectId: 'p1', expiresInDays: 7 });
  var resValid = ShareManager.validateToken(link.token, 'p1');
  assert.strictEqual(resValid.valid, true);
  assert.strictEqual(resValid.link.id, link.id);

  // 2. 伪造或不存在的令牌
  var resUnknown = ShareManager.validateToken('non-existent-token', 'p1');
  assert.strictEqual(resUnknown.valid, false);
  assert.strictEqual(resUnknown.reason, '分享链接不存在');

  // 3. 撤销后的令牌
  ShareManager.revokeShareLink(link.id);
  var resRevoked = ShareManager.validateToken(link.token, 'p1');
  assert.strictEqual(resRevoked.valid, false);
  assert.strictEqual(resRevoked.reason, '该分享链接已被撤销');

  // 4. 已过期的令牌（手动置为过去时间）
  var expiredLink = ShareManager.createShareLink({ projectId: 'p1', expiresInDays: 1 });
  expiredLink.expiresAt = new Date(Date.now() - 3600 * 1000).toISOString();
  var allLinks = ShareManager.listShareLinks();
  allLinks[0] = expiredLink;
  storage.setItem('pmweb_share_links', JSON.stringify(allLinks));

  var resExpired = ShareManager.validateToken(expiredLink.token, 'p1');
  assert.strictEqual(resExpired.valid, false);
  assert.strictEqual(resExpired.reason, '该分享链接已过期');
});

// ---- 只读模式控制 ----

test('isReadonly 与 setReadonly 控制只读模式', function() {
  ShareManager._resetForTesting();
  assert.strictEqual(ShareManager.isReadonly(), false);

  ShareManager.setReadonly(true);
  assert.strictEqual(ShareManager.isReadonly(), true);

  ShareManager.setReadonly(false);
  assert.strictEqual(ShareManager.isReadonly(), false);
});

// ---- 审计日志解析与格式化 ----

test('getAuditLogs 格式化活动数据为中文标签与变更明细', function() {
  ShareManager._resetForTesting();
  // 注入 mock TaskManager.data.activity
  var mockApp = helper.createApp(['activity.js', 'share.js']);
  var SM = mockApp.get('ShareManager');

  mockApp.context.TaskManager = {
    data: {
      activity: [
        {
          id: 'act-1',
          taskId: 't-1',
          actor: '张三',
          action: 'update',
          field: 'status',
          before: 'inProgress',
          after: 'done',
          at: '2026-01-02T10:00:00Z'
        },
        {
          id: 'act-2',
          taskId: 't-1',
          actor: '李四',
          action: 'update',
          field: 'progress',
          before: 20,
          after: 80,
          at: '2026-01-03T11:00:00Z'
        }
      ]
    }
  };

  var logs = SM.getAuditLogs();
  assert.strictEqual(logs.length, 2);
  // 按时间倒序：最新在前面
  assert.strictEqual(logs[0].id, 'act-2');
  assert.strictEqual(logs[0].fieldLabel, '进度百分比');
  assert.strictEqual(logs[0].detail, '20 ➔ 80');

  assert.strictEqual(logs[1].id, 'act-1');
  assert.strictEqual(logs[1].fieldLabel, '任务状态');
  assert.strictEqual(logs[1].detail, 'inProgress ➔ done');
});

// ---- 弹窗 HTML 渲染 ----

test('buildShareModalHtml 生成包含生成链接、凭证列表与审计日志的对话框结构', function() {
  ShareManager._resetForTesting();
  var storage = makeStorage();
  ShareManager.init({ storage: storage });

  var html = ShareManager.buildShareModalHtml();
  assert.strictEqual(typeof html, 'string');
  assert.ok(html.indexOf('创建只读分享链接') !== -1);
  assert.ok(html.indexOf('已生成的分享链接') !== -1);
  assert.ok(html.indexOf('操作变更审计日志') !== -1);
  assert.ok(html.indexOf('一键打印 / 导出PDF') !== -1);
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
  console.log('\nshare: ' + passed + '/' + tests.length + ' passed');
}

run();
