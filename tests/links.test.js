'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'links.js']);
var Links = app.get('Links');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function task(id, startDate, endDate) {
  return {
    id: id,
    startDate: startDate || null,
    endDate: endDate || null
  };
}

function link(source, target, type, lag) {
  return { id: source + '-' + target + '-' + type, source: source, target: target, type: type, lag: lag };
}

function codes(result) {
  return result.errors.map(function(error) { return error.code; });
}

// ---------- 类型常量与 create ----------

test('TYPES 包含 FS、SS、FF、SF', function() {
  assert.deepStrictEqual(plain(Links.TYPES), ['FS', 'SS', 'FF', 'SF']);
});

test('create 生成完整 link，缺省 type 为 FS、lag 为 0', function() {
  var created = Links.create('a', 'b', 'SS', 3);
  assert.strictEqual(created.source, 'a');
  assert.strictEqual(created.target, 'b');
  assert.strictEqual(created.type, 'SS');
  assert.strictEqual(created.lag, 3);
  assert.strictEqual(typeof created.id, 'string');
  assert.ok(created.id.length > 0);

  var defaults = Links.create('a', 'b');
  assert.strictEqual(defaults.type, 'FS');
  assert.strictEqual(defaults.lag, 0);
});

test('create 生成的 id 唯一', function() {
  var ids = new Set();
  for (var i = 0; i < 200; i++) {
    ids.add(Links.create('a', 'b', 'FS', 0).id);
  }
  assert.strictEqual(ids.size, 200);
});

// ---------- validate ----------

test('合法 FS 依赖通过校验', function() {
  var result = Links.validate(
    [link('a', 'b', 'FS', 0)],
    [task('a'), task('b')]
  );
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(plain(result.errors), []);
});

test('四种合法类型均通过校验', function() {
  var result = Links.validate(
    [
      link('a', 'b', 'FS', 0),
      link('b', 'c', 'SS', 1),
      link('c', 'd', 'FF', 2),
      link('d', 'e', 'SF', -1)
    ],
    [task('a'), task('b'), task('c'), task('d'), task('e')]
  );
  assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
});

test('非法类型失败', function() {
  var result = Links.validate(
    [link('a', 'b', 'XX', 0)],
    [task('a'), task('b')]
  );
  assert.strictEqual(result.valid, false);
  assert.ok(codes(result).indexOf('INVALID_TYPE') !== -1);
});

test('非法 lag 失败', function() {
  var nonNumeric = Links.validate(
    [link('a', 'b', 'FS', '2')],
    [task('a'), task('b')]
  );
  assert.strictEqual(nonNumeric.valid, false);
  assert.ok(codes(nonNumeric).indexOf('INVALID_LAG') !== -1);

  var fractional = Links.validate(
    [link('a', 'b', 'FS', 1.5)],
    [task('a'), task('b')]
  );
  assert.strictEqual(fractional.valid, false);
  assert.ok(codes(fractional).indexOf('INVALID_LAG') !== -1);
});

test('自引用失败', function() {
  var result = Links.validate(
    [link('a', 'a', 'FS', 0)],
    [task('a')]
  );
  assert.strictEqual(result.valid, false);
  assert.ok(codes(result).indexOf('SELF_REFERENCE') !== -1);
});

test('重复边失败', function() {
  var result = Links.validate(
    [link('a', 'b', 'FS', 0), link('a', 'b', 'SS', 1)],
    [task('a'), task('b')]
  );
  assert.strictEqual(result.valid, false);
  assert.ok(codes(result).indexOf('DUPLICATE_EDGE') !== -1);
  assert.strictEqual(result.errors.filter(function(error) {
    return error.code === 'DUPLICATE_EDGE';
  })[0].index, 1);
});

test('source 与 target 缺失任务失败', function() {
  var missingSource = Links.validate(
    [link('ghost', 'b', 'FS', 0)],
    [task('a'), task('b')]
  );
  assert.strictEqual(missingSource.valid, false);
  assert.ok(codes(missingSource).indexOf('MISSING_SOURCE') !== -1);

  var missingTarget = Links.validate(
    [link('a', 'ghost', 'FS', 0)],
    [task('a'), task('b')]
  );
  assert.strictEqual(missingTarget.valid, false);
  assert.ok(codes(missingTarget).indexOf('MISSING_TARGET') !== -1);
});

test('link 不是对象或 links 不是数组时失败', function() {
  var notArray = Links.validate({}, [task('a')]);
  assert.strictEqual(notArray.valid, false);
  assert.ok(codes(notArray).indexOf('INVALID_LINKS') !== -1);

  var notObject = Links.validate([null], [task('a')]);
  assert.strictEqual(notObject.valid, false);
  assert.ok(codes(notObject).indexOf('INVALID_LINK') !== -1);
});

// ---------- detectCycle ----------

test('无环返回 null', function() {
  assert.strictEqual(
    Links.detectCycle([link('a', 'b', 'FS', 0), link('b', 'c', 'FS', 0)]),
    null
  );
});

test('简单环 a -> b -> a 被检测', function() {
  var cycle = Links.detectCycle([
    link('a', 'b', 'FS', 0),
    link('b', 'a', 'FS', 0)
  ]);
  assert.deepStrictEqual(plain(cycle), ['a', 'b']);
});

test('多节点环 a -> b -> c -> a 被检测', function() {
  var cycle = Links.detectCycle([
    link('a', 'b', 'FS', 0),
    link('b', 'c', 'FS', 0),
    link('c', 'a', 'FS', 0)
  ]);
  assert.deepStrictEqual(plain(cycle), ['a', 'b', 'c']);
});

test('自引用环被检测', function() {
  var cycle = Links.detectCycle([link('a', 'a', 'FS', 0)]);
  assert.deepStrictEqual(plain(cycle), ['a']);
});

test('环外的边不影响环检测结果', function() {
  var cycle = Links.detectCycle([
    link('x', 'a', 'FS', 0),
    link('a', 'b', 'FS', 0),
    link('b', 'c', 'FS', 0),
    link('c', 'a', 'FS', 0),
    link('c', 'y', 'FS', 0)
  ]);
  assert.deepStrictEqual(plain(cycle).sort(), ['a', 'b', 'c']);
});

// ---------- topologicalOrder ----------

test('拓扑序稳定，多根节点按输入顺序输出', function() {
  var result = Links.topologicalOrder(
    [
      link('a', 'c', 'FS', 0),
      link('b', 'c', 'FS', 0),
      link('c', 'd', 'FS', 0)
    ],
    ['a', 'b', 'c', 'd']
  );
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.cycle, null);
  assert.deepStrictEqual(plain(result.order), ['a', 'b', 'c', 'd']);
});

test('无依赖时保持 taskIds 顺序，孤立节点也在结果中', function() {
  var result = Links.topologicalOrder([], ['x', 'a', 'b']);
  assert.deepStrictEqual(plain(result.order), ['x', 'a', 'b']);
});

test('多个根节点与孤立节点混合时顺序稳定', function() {
  var result = Links.topologicalOrder(
    [
      link('b', 'e', 'FS', 0),
      link('d', 'e', 'FS', 0)
    ],
    ['a', 'b', 'c', 'd', 'e']
  );
  assert.deepStrictEqual(plain(result.order), ['a', 'b', 'c', 'd', 'e']);
});

test('taskIds 之外的端点被忽略', function() {
  var result = Links.topologicalOrder(
    [link('a', 'ghost', 'FS', 0)],
    ['a', 'b']
  );
  assert.strictEqual(result.error, null);
  assert.deepStrictEqual(plain(result.order), ['a', 'b']);
});

test('存在环时返回错误与环路节点', function() {
  var result = Links.topologicalOrder(
    [
      link('a', 'b', 'FS', 0),
      link('b', 'c', 'FS', 0),
      link('c', 'a', 'FS', 0)
    ],
    ['a', 'b', 'c']
  );
  assert.deepStrictEqual(plain(result.order), []);
  assert.deepStrictEqual(plain(result.cycle), ['a', 'b', 'c']);
  assert.ok(/cycle detected/.test(result.error));
});

// ---------- successors / predecessors ----------

test('successors 返回直接后继并去重', function() {
  var links = [
    link('a', 'b', 'FS', 0),
    link('a', 'c', 'FS', 0),
    link('d', 'c', 'FS', 0),
    link('a', 'b', 'SS', 0)
  ];
  assert.deepStrictEqual(plain(Links.successors('a', links)), ['b', 'c']);
  assert.deepStrictEqual(plain(Links.successors('b', links)), []);
});

test('predecessors 返回直接前驱并去重', function() {
  var links = [
    link('a', 'c', 'FS', 0),
    link('d', 'c', 'FS', 0),
    link('d', 'e', 'FS', 0),
    link('d', 'c', 'SS', 0)
  ];
  assert.deepStrictEqual(plain(Links.predecessors('c', links)), ['a', 'd']);
  assert.deepStrictEqual(plain(Links.predecessors('a', links)), []);
});

// ---------- canAdd ----------

test('canAdd 允许合法的非成环依赖', function() {
  var result = Links.canAdd(
    [link('a', 'b', 'FS', 0), link('b', 'c', 'FS', 0)],
    'a', 'c', 'FS'
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, null);
});

test('canAdd 拒绝自引用', function() {
  var result = Links.canAdd([], 'a', 'a', 'FS');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'SELF_REFERENCE');
});

test('canAdd 拒绝重复边', function() {
  var result = Links.canAdd([link('a', 'b', 'FS', 0)], 'a', 'b', 'SS');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DUPLICATE_EDGE');
});

test('canAdd 拒绝成环', function() {
  var links = [link('a', 'b', 'FS', 0), link('b', 'c', 'FS', 0)];
  var result = Links.canAdd(links, 'c', 'a', 'FS');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'CYCLE');
});

test('canAdd 拒绝非法类型与空端点', function() {
  assert.strictEqual(Links.canAdd([], 'a', 'b', 'XX').code, 'INVALID_TYPE');
  assert.strictEqual(Links.canAdd([], '', 'b', 'FS').code, 'INVALID_ENDPOINT');
});

// ---------- computeConstraint ----------

test('FS 约束目标开始日期为 source 结束日期加 lag', function() {
  var source = task('a', '2026-01-10', '2026-01-20');
  var result = Links.computeConstraint(link('a', 'b', 'FS', 3), source);
  assert.strictEqual(result.field, 'startDate');
  assert.strictEqual(result.date, '2026-01-23');
  assert.strictEqual(result.type, 'FS');
  assert.strictEqual(result.lag, 3);
});

test('SS 约束目标开始日期为 source 开始日期加 lag', function() {
  var source = task('a', '2026-01-10', '2026-01-20');
  var result = Links.computeConstraint(link('a', 'b', 'SS', 2), source);
  assert.strictEqual(result.field, 'startDate');
  assert.strictEqual(result.date, '2026-01-12');
});

test('FF 约束目标结束日期为 source 结束日期加 lag', function() {
  var source = task('a', '2026-01-10', '2026-01-20');
  var result = Links.computeConstraint(link('a', 'b', 'FF', 5), source);
  assert.strictEqual(result.field, 'endDate');
  assert.strictEqual(result.date, '2026-01-25');
});

test('SF 约束目标结束日期为 source 开始日期加 lag', function() {
  var source = task('a', '2026-01-10', '2026-01-20');
  var result = Links.computeConstraint(link('a', 'b', 'SF', 4), source);
  assert.strictEqual(result.field, 'endDate');
  assert.strictEqual(result.date, '2026-01-14');
});

test('lag 为 0 与负 lag 正确计算', function() {
  var source = task('a', '2026-01-10', '2026-01-20');
  assert.strictEqual(
    Links.computeConstraint(link('a', 'b', 'FS', 0), source).date,
    '2026-01-20'
  );
  assert.strictEqual(
    Links.computeConstraint(link('a', 'b', 'FS', -2), source).date,
    '2026-01-18'
  );
});

test('跨月与跨年日期正确计算', function() {
  var monthEnd = task('a', '2026-01-10', '2026-01-31');
  assert.strictEqual(
    Links.computeConstraint(link('a', 'b', 'FS', 1), monthEnd).date,
    '2026-02-01'
  );

  var yearEnd = task('a', '2025-12-30', '2025-12-31');
  assert.strictEqual(
    Links.computeConstraint(link('a', 'b', 'FF', 1), yearEnd).date,
    '2026-01-01'
  );
});

test('缺少必要日期或非法类型时返回 null', function() {
  var noStart = task('a', null, '2026-01-20');
  assert.strictEqual(
    Links.computeConstraint(link('a', 'b', 'SS', 0), noStart),
    null
  );

  var noEnd = task('a', '2026-01-10', null);
  assert.strictEqual(
    Links.computeConstraint(link('a', 'b', 'FS', 0), noEnd),
    null
  );

  assert.strictEqual(
    Links.computeConstraint(link('a', 'b', 'XX', 0), task('a', '2026-01-01', '2026-01-02')),
    null
  );
  assert.strictEqual(Links.computeConstraint(null, task('a', '2026-01-01', '2026-01-02')), null);
});

// ---------- 纯函数 ----------

test('所有函数不修改传入的 links、tasks、taskIds', function() {
  var links = [
    link('a', 'b', 'FS', 2),
    link('b', 'c', 'SS', 1),
    link('d', 'c', 'FF', 0)
  ];
  var tasks = [
    task('a', '2026-01-01', '2026-01-05'),
    task('b', '2026-01-06', '2026-01-10'),
    task('c', '2026-01-11', '2026-01-20'),
    task('d', '2026-01-01', '2026-01-03')
  ];
  var taskIds = ['a', 'b', 'c', 'd'];

  var linksBefore = JSON.stringify(links);
  var tasksBefore = JSON.stringify(tasks);
  var idsBefore = JSON.stringify(taskIds);

  Links.validate(links, tasks);
  Links.detectCycle(links);
  Links.topologicalOrder(links, taskIds);
  Links.successors('a', links);
  Links.predecessors('c', links);
  Links.canAdd(links, 'a', 'd', 'FS');
  Links.computeConstraint(links[0], tasks[0]);

  assert.strictEqual(JSON.stringify(links), linksBefore);
  assert.strictEqual(JSON.stringify(tasks), tasksBefore);
  assert.strictEqual(JSON.stringify(taskIds), idsBefore);
});

test('空输入不抛错', function() {
  assert.deepStrictEqual(plain(Links.validate([], [])), { valid: true, errors: [] });
  assert.strictEqual(Links.detectCycle([]), null);
  assert.deepStrictEqual(plain(Links.topologicalOrder([], [])), {
    order: [], cycle: null, error: null
  });
  assert.deepStrictEqual(plain(Links.successors('a', [])), []);
  assert.deepStrictEqual(plain(Links.predecessors('a', [])), []);
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

console.log('\nlinks: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
