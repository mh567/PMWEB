'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'views.js']);
var Views = app.get('Views');

function row(id, options) {
  options = options || {};
  var task = {
    id: id,
    name: options.name === undefined ? id : options.name,
    status: options.status || 'inProgress',
    assignee: options.assignee === undefined ? '' : options.assignee,
    progress: options.progress === undefined ? 0 : options.progress,
    startDate: options.startDate || null,
    endDate: options.endDate || null,
    description: options.description || ''
  };
  return {
    id: id,
    task: task,
    depth: options.depth || 0,
    hasChildren: !!options.isSummary,
    isCollapsed: false,
    isSummary: !!options.isSummary,
    childCount: options.isSummary ? 1 : 0,
    startDate: options.startDate || null,
    endDate: options.endDate || null
  };
}

function ids(rows) {
  return plain(rows.map(function(item) { return item.id; }));
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---- 筛选 ------------------------------------------------------

test('filterRows 按状态筛选，父行随可见子任务保留', function() {
  var rows = [
    row('P', { isSummary: true, depth: 0, startDate: '2024-01-01', endDate: '2024-02-10' }),
    row('A', { depth: 1, status: 'inProgress', assignee: '张三', startDate: '2024-01-01', endDate: '2024-01-10' }),
    row('B', { depth: 1, status: 'done', assignee: '李四', startDate: '2024-02-01', endDate: '2024-02-10' }),
    row('R', { status: 'done', assignee: '张三', startDate: '2024-01-05', endDate: '2024-01-06' })
  ];
  var result = Views.filterRows(rows, { status: 'done' });
  assert.deepStrictEqual(ids(result), ['P', 'B', 'R']);
});

test('filterRows 父任务没有可见后代时被移除', function() {
  var rows = [
    row('P', { isSummary: true, depth: 0 }),
    row('A', { depth: 1, status: 'inProgress' })
  ];
  var result = Views.filterRows(rows, { status: 'done' });
  assert.deepStrictEqual(ids(result), []);
});

test('filterRows 状态筛选只匹配叶子，父行不因原始状态匹配而孤立保留', function() {
  var rows1 = [
    row('P1', { isSummary: true, depth: 0, status: 'todo' }),
    row('C1', { depth: 1, status: 'inProgress' }),
    row('C2', { depth: 1, status: 'inProgress' })
  ];
  assert.deepStrictEqual(ids(Views.filterRows(rows1, { status: 'todo' })), [], '子任务全为 inProgress 时筛选 todo 不应孤立保留父行');

  var rows2 = [
    row('P2', { isSummary: true, depth: 0, status: 'inProgress' }),
    row('C3', { depth: 1, status: 'todo' })
  ];
  assert.deepStrictEqual(ids(Views.filterRows(rows2, { status: 'inProgress' })), [], '子任务全为 todo 时筛选 inProgress 不应孤立保留父行');

  var rows3 = [
    row('P3', { isSummary: true, depth: 0, status: 'todo' }),
    row('C4', { depth: 1, status: 'inProgress' })
  ];
  assert.deepStrictEqual(ids(Views.filterRows(rows3, { status: 'inProgress' })), ['P3', 'C4'], '子任务匹配时父行应保留层级上下文');
});

test('filterRows 按负责人筛选', function() {
  var rows = [
    row('P', { isSummary: true, depth: 0 }),
    row('A', { depth: 1, assignee: '张三' }),
    row('B', { depth: 1, assignee: '李四' }),
    row('R', { assignee: '张三' })
  ];
  assert.deepStrictEqual(ids(Views.filterRows(rows, { assignee: '张三' })), ['P', 'A', 'R']);
});

test('filterRows 日期边界按交集计算并包含边界当天', function() {
  var rows = [
    row('P', { isSummary: true, depth: 0, startDate: '2024-01-01', endDate: '2024-02-10' }),
    row('A', { depth: 1, startDate: '2024-01-01', endDate: '2024-01-10' }),
    row('B', { depth: 1, startDate: '2024-02-01', endDate: '2024-02-10' }),
    row('C', { depth: 1, startDate: '2024-03-01', endDate: '2024-03-05' })
  ];
  var result = Views.filterRows(rows, { startDate: '2024-01-10', endDate: '2024-02-01' });
  assert.deepStrictEqual(ids(result), ['P', 'A', 'B']);
});

test('filterRows 缺日期的叶子在有日期筛选时被排除', function() {
  var rows = [row('A'), row('B', { startDate: '2024-01-01', endDate: '2024-01-02' })];
  assert.deepStrictEqual(ids(Views.filterRows(rows, { startDate: '2024-01-01' })), ['B']);
});

test('filterRows 文本搜索不区分大小写并覆盖名称、描述、负责人', function() {
  var rows = [
    row('A', { name: 'Alpha 模块', description: '' }),
    row('B', { name: 'Beta', description: '包含 ALPHA 关键字' }),
    row('C', { name: 'Gamma', assignee: 'alpha-team' }),
    row('D', { name: 'Delta' })
  ];
  assert.deepStrictEqual(ids(Views.filterRows(rows, { search: 'alpha' })), ['A', 'B', 'C']);
});

test('filterRows 空结果返回空数组', function() {
  var rows = [row('A', { status: 'inProgress' })];
  assert.deepStrictEqual(plain(Views.filterRows(rows, { status: 'done' })), []);
});

test('filterRows 不修改输入且返回新数组', function() {
  var rows = [row('A'), row('B')];
  var snapshot = plain(rows);
  var result = Views.filterRows(rows, {});
  assert.deepStrictEqual(plain(rows), snapshot);
  assert.notStrictEqual(result, rows);
  assert.deepStrictEqual(ids(result), ['A', 'B']);
});

// ---- 排序 ------------------------------------------------------

test('sortRows 相同键保持原始顺序（稳定）', function() {
  var rows = [row('A', { name: 'same' }), row('B', { name: 'same' }), row('C', { name: 'same' })];
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'name', direction: 'asc' })), ['A', 'B', 'C']);
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'name', direction: 'desc' })), ['A', 'B', 'C']);
});

test('sortRows 按名称升降序且不修改输入', function() {
  var rows = [row('A', { name: 'b' }), row('B', { name: 'a' }), row('C', { name: 'c' })];
  var snapshot = plain(rows);
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'name', direction: 'asc' })), ['B', 'A', 'C']);
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'name', direction: 'desc' })), ['C', 'A', 'B']);
  assert.deepStrictEqual(plain(rows), snapshot);
});

test('sortRows 按状态固定顺序排序', function() {
  var rows = [row('A', { status: 'done' }), row('B', { status: 'inProgress' }), row('C', { status: 'thirdParty' })];
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'status', direction: 'asc' })), ['B', 'C', 'A']);
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'status', direction: 'desc' })), ['A', 'C', 'B']);
});

test('sortRows 负责人空值固定排最后', function() {
  var rows = [row('A', { assignee: '' }), row('B', { assignee: 'b' }), row('C', { assignee: 'a' })];
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'assignee', direction: 'asc' })), ['C', 'B', 'A']);
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'assignee', direction: 'desc' })), ['B', 'C', 'A']);
});

test('sortRows 日期空值固定排最后', function() {
  var rows = [
    row('A'),
    row('B', { startDate: '2024-02-01' }),
    row('C', { startDate: '2024-01-01' })
  ];
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'startDate', direction: 'asc' })), ['C', 'B', 'A']);
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'startDate', direction: 'desc' })), ['B', 'C', 'A']);
});

test('sortRows 进度按数值排序', function() {
  var rows = [row('A', { progress: 80 }), row('B', { progress: 10 }), row('C', { progress: 50 })];
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'progress', direction: 'asc' })), ['B', 'C', 'A']);
  assert.deepStrictEqual(ids(Views.sortRows(rows, { field: 'progress', direction: 'desc' })), ['A', 'C', 'B']);
});

test('sortRows 非法字段返回副本并保持顺序', function() {
  var rows = [row('A'), row('B')];
  var result = Views.sortRows(rows, { field: 'unknown', direction: 'asc' });
  assert.notStrictEqual(result, rows);
  assert.deepStrictEqual(ids(result), ['A', 'B']);
});

// ---- 分组 ------------------------------------------------------

test('groupRows none 返回副本且不插入标题行', function() {
  var rows = [row('A'), row('B')];
  var result = Views.groupRows(rows, 'none');
  assert.notStrictEqual(result, rows);
  assert.deepStrictEqual(ids(result), ['A', 'B']);
});

test('groupRows 按状态分组，组内保留行顺序并带标题计数', function() {
  var rows = [
    row('A', { status: 'inProgress' }),
    row('B', { status: 'done' }),
    row('C', { status: 'inProgress' })
  ];
  var result = Views.groupRows(rows, 'status');
  assert.deepStrictEqual(ids(result), [
    '__group__status__inProgress', 'A', 'C',
    '__group__status__done', 'B'
  ]);
  assert.strictEqual(result[0].isGroupHeader, true);
  assert.strictEqual(result[0].label, '进行中');
  assert.strictEqual(result[0].count, 2);
  assert.strictEqual(result[3].label, '已完成');
  assert.strictEqual(result[3].count, 1);
});

test('groupRows 按负责人分组，空负责人归入未分配', function() {
  var rows = [
    row('A', { assignee: '张三' }),
    row('B', { assignee: '' }),
    row('C', { assignee: '张三' })
  ];
  var result = Views.groupRows(rows, 'assignee');
  assert.deepStrictEqual(ids(result), [
    '__group__assignee__%E5%BC%A0%E4%B8%89', 'A', 'C',
    '__group__assignee__', 'B'
  ]);
  assert.strictEqual(result[0].label, '张三');
  assert.strictEqual(result[3].label, '未分配');
});

test('groupRows 不修改输入数组', function() {
  var rows = [row('A', { status: 'done' }), row('B', { status: 'done' })];
  var snapshot = plain(rows);
  Views.groupRows(rows, 'status');
  assert.deepStrictEqual(plain(rows), snapshot);
});

// ---- 视图序列化与组合 ------------------------------------------

test('normalizeView 输出完整默认结构', function() {
  assert.deepStrictEqual(plain(Views.normalizeView(null)), {
    name: '',
    filters: { status: '', assignee: '', search: '', startDate: '', endDate: '', due: '' },
    sort: { field: '', direction: 'asc' },
    groupBy: 'none'
  });
});

test('normalizeView 清理非法值且不修改输入', function() {
  var input = {
    name: '  我的视图  ',
    filters: { status: 'bogus', assignee: ' 张三 ', search: 'x', startDate: '2024-1-1', endDate: '2024-02-01' },
    sort: { field: 'bogus', direction: 'desc' },
    groupBy: 'bogus'
  };
  var snapshot = plain(input);
  var view = Views.normalizeView(input);
  assert.strictEqual(view.name, '我的视图');
  assert.strictEqual(view.filters.status, '');
  assert.strictEqual(view.filters.assignee, '张三');
  assert.strictEqual(view.filters.startDate, '');
  assert.strictEqual(view.filters.endDate, '2024-02-01');
  assert.strictEqual(view.sort.field, '');
  assert.strictEqual(view.sort.direction, 'desc');
  assert.strictEqual(view.groupBy, 'none');
  assert.deepStrictEqual(plain(input), snapshot);
});

test('apply 组合筛选、排序和分组', function() {
  var rows = [
    row('A', { name: '甲', status: 'done', assignee: '张三' }),
    row('B', { name: '乙', status: 'inProgress', assignee: '李四' }),
    row('C', { name: '丙', status: 'done', assignee: '李四' })
  ];
  var view = {
    filters: { assignee: '李四' },
    sort: { field: 'name', direction: 'asc' },
    groupBy: 'status'
  };
  var result = Views.apply(rows, view);
  assert.deepStrictEqual(ids(result), [
    '__group__status__done', 'C',
    '__group__status__inProgress', 'B'
  ]);
});

test('apply 不修改输入行数组', function() {
  var rows = [row('A', { name: 'b' }), row('B', { name: 'a' })];
  var snapshot = plain(rows);
  Views.apply(rows, { sort: { field: 'name', direction: 'asc' } });
  assert.deepStrictEqual(plain(rows), snapshot);
});

test('normalizeView 规范化 filters.due 枚举与非法值清除', function() {
  assert.strictEqual(Views.normalizeView({ filters: { due: 'overdue' } }).filters.due, 'overdue');
  assert.strictEqual(Views.normalizeView({ filters: { due: 'today' } }).filters.due, 'today');
  assert.strictEqual(Views.normalizeView({ filters: { due: 'next7' } }).filters.due, 'next7');
  assert.strictEqual(Views.normalizeView({ filters: { due: '' } }).filters.due, '');
  assert.strictEqual(Views.normalizeView({ filters: { due: 'invalid' } }).filters.due, '');
  assert.strictEqual(Views.normalizeView({ filters: { due: 123 } }).filters.due, '');
  assert.strictEqual(Views.normalizeView({}).filters.due, '');
});

test('STATUS_VALUES 与 STATUS_LABELS 包含 todo 未开始四状态', function() {
  assert.ok(Views.STATUS_VALUES.indexOf('todo') !== -1, 'STATUS_VALUES 应包含 todo');
  assert.strictEqual(Views.STATUS_LABELS['todo'], '未开始');
});

test('filterRows filters.due 相对日期筛选边界与父行上下文保留', function() {
  var fixedToday = '2026-11-11';
  var rows = [
    row('P', { isSummary: true, depth: 0, startDate: '2026-11-01', endDate: '2026-11-18' }),
    row('due-10', { depth: 1, startDate: '2026-11-01', endDate: '2026-11-10', status: 'todo' }),
    row('due-11', { depth: 1, startDate: '2026-11-01', endDate: '2026-11-11', status: 'inProgress' }),
    row('due-17', { depth: 1, startDate: '2026-11-05', endDate: '2026-11-17', status: 'thirdParty' }),
    row('due-18', { depth: 1, startDate: '2026-11-05', endDate: '2026-11-18', status: 'todo' }),
    row('done-10', { depth: 1, startDate: '2026-11-01', endDate: '2026-11-10', status: 'done' }),
    row('done-11', { depth: 1, startDate: '2026-11-01', endDate: '2026-11-11', status: 'done' }),
    row('no-date', { depth: 1, startDate: null, endDate: null, status: 'todo' }),
    row('P-only-date', { isSummary: true, depth: 0, startDate: '2026-11-01', endDate: '2026-11-11' }),
    row('far-child', { depth: 1, startDate: '2026-12-01', endDate: '2026-12-10', status: 'todo' })
  ];

  // overdue
  var overdueResult = Views.filterRows(rows, { due: 'overdue' }, fixedToday);
  assert.deepStrictEqual(ids(overdueResult), ['P', 'due-10']);

  // today
  var todayResult = Views.filterRows(rows, { due: 'today' }, fixedToday);
  assert.deepStrictEqual(ids(todayResult), ['P', 'due-11']);

  // next7 (包含 11 和 17，不含 18，排除已完成与无日期，不含仅父有日期的 P-only-date)
  var next7Result = Views.filterRows(rows, { due: 'next7' }, fixedToday);
  assert.deepStrictEqual(ids(next7Result), ['P', 'due-11', 'due-17']);

  // 叶子 ID 校验
  var next7LeafIds = next7Result.filter(function(r) { return !r.isSummary; }).map(function(r) { return r.id; });
  assert.deepStrictEqual(plain(next7LeafIds), ['due-11', 'due-17']);
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

console.log('\nviews: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
