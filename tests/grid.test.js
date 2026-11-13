'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'work-calendar.js',
  'progress.js',
  'links.js',
  'task-manager.js',
  'row-model.js',
  'column-config.js',
  'baseline.js',
  'grid-pane.js'
]);
var GridPane = app.get('GridPane');
var ColumnConfig = app.get('ColumnConfig');
var TaskManager = app.get('TaskManager');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('默认列包含八个字段且顺序固定', function() {
  var columns = GridPane.defaultColumns();
  assert.deepStrictEqual(plain(columns.map(function(col) { return col.key; })),
    ['name', 'status', 'assignee', 'startDate', 'endDate', 'plannedEndDate', 'progress', 'description']);
  assert.deepStrictEqual(plain(columns.map(function(col) { return col.label; })),
    ['任务名称', '状态', '负责人', '开始', '结束', '计划完成', '进度', '描述']);
});

test('默认列宽符合设计表', function() {
  var widths = GridPane.defaultColumns().map(function(col) { return col.width; });
  assert.deepStrictEqual(plain(widths), [260, 110, 100, 110, 110, 120, 120, 220]);
  assert.strictEqual(GridPane.getColumnsWidth(GridPane.defaultColumns()), 1150);
});

test('每列都有 key、label、width、minWidth、visible、type', function() {
  GridPane.defaultColumns().forEach(function(col) {
    assert.strictEqual(typeof col.key, 'string');
    assert.strictEqual(typeof col.label, 'string');
    assert.strictEqual(typeof col.width, 'number');
    assert.strictEqual(typeof col.minWidth, 'number');
    assert.strictEqual(typeof col.visible, 'boolean');
    assert.strictEqual(typeof col.type, 'string');
    assert.ok(col.minWidth > 0);
    assert.ok(col.width >= col.minWidth);
  });
});

test('defaultColumns 每次返回副本，修改不污染默认值', function() {
  var first = GridPane.defaultColumns();
  first[0].width = 1;
  first[1].visible = false;
  var second = GridPane.defaultColumns();
  assert.strictEqual(second[0].width, 260);
  assert.strictEqual(second[1].visible, true);
});

test('getVisibleColumns 只返回 visible 不为 false 的列', function() {
  var columns = GridPane.defaultColumns();
  columns[1].visible = false;
  columns[6].visible = false;
  var visible = GridPane.getVisibleColumns(columns);
  assert.deepStrictEqual(plain(visible.map(function(col) { return col.key; })),
    ['name', 'assignee', 'startDate', 'endDate', 'plannedEndDate', 'description']);
});

test('getColumnsWidth 只累加可见列宽', function() {
  var columns = GridPane.defaultColumns();
  columns[1].visible = false;
  columns[6].visible = false;
  assert.strictEqual(GridPane.getColumnsWidth(columns), 1150 - 110 - 120);
});

test('全部列隐藏时宽度为 0', function() {
  var columns = GridPane.defaultColumns().map(function(col) {
    col.visible = false;
    return col;
  });
  assert.strictEqual(GridPane.getVisibleColumns(columns).length, 0);
  assert.strictEqual(GridPane.getColumnsWidth(columns), 0);
});

test('formatProgress 输出整数百分比文本', function() {
  assert.strictEqual(GridPane.formatProgress(0), '0%');
  assert.strictEqual(GridPane.formatProgress(50), '50%');
  assert.strictEqual(GridPane.formatProgress(100), '100%');
  assert.strictEqual(GridPane.formatProgress(33.6), '34%');
  assert.strictEqual(GridPane.formatProgress('42'), '42%');
});

test('formatProgress 对空值和非法值返回空字符串', function() {
  assert.strictEqual(GridPane.formatProgress(null), '');
  assert.strictEqual(GridPane.formatProgress(undefined), '');
  assert.strictEqual(GridPane.formatProgress(''), '');
  assert.strictEqual(GridPane.formatProgress('abc'), '');
  assert.strictEqual(GridPane.formatProgress(NaN), '');
});

test('formatProgress 把越界值收敛到 0 到 100', function() {
  assert.strictEqual(GridPane.formatProgress(-10), '0%');
  assert.strictEqual(GridPane.formatProgress(130), '100%');
  assert.strictEqual(GridPane.getProgressValue('200'), 100);
  assert.strictEqual(GridPane.getProgressValue('-3'), 0);
});

test('getIndent 按层级乘以缩进步长', function() {
  assert.strictEqual(GridPane.INDENT_STEP, 16);
  assert.strictEqual(GridPane.getIndent(0), 0);
  assert.strictEqual(GridPane.getIndent(1), 16);
  assert.strictEqual(GridPane.getIndent(2), 32);
});

test('getIndent 对负数、小数和非法值做安全处理', function() {
  assert.strictEqual(GridPane.getIndent(-2), 0);
  assert.strictEqual(GridPane.getIndent(2.4), 32);
  assert.strictEqual(GridPane.getIndent(undefined), 0);
  assert.strictEqual(GridPane.getIndent('1'), 16);
  assert.strictEqual(GridPane.getIndent('abc'), 0);
});

test('getStatusMeta 映射三种状态', function() {
  assert.deepStrictEqual(plain(GridPane.getStatusMeta('inProgress')),
    { key: 'inProgress', label: '进行中' });
  assert.deepStrictEqual(plain(GridPane.getStatusMeta('thirdParty')),
    { key: 'thirdParty', label: '第三方' });
  assert.deepStrictEqual(plain(GridPane.getStatusMeta('done')),
    { key: 'done', label: '已完成' });
  assert.deepStrictEqual(plain(GridPane.getStatusMeta(undefined)),
    { key: 'inProgress', label: '进行中' });
});

test('clampColumnWidth 不低于 minWidth 且取整', function() {
  var column = { key: 'name', width: 260, minWidth: 160 };
  assert.strictEqual(GridPane.clampColumnWidth(column, 120), 160);
  assert.strictEqual(GridPane.clampColumnWidth(column, 300.7), 301);
  assert.strictEqual(GridPane.clampColumnWidth(column, 160), 160);
  assert.strictEqual(GridPane.clampColumnWidth(column, null), 260);
});

test('setColumns 合并持久化状态，缺省列回落到默认值', function() {
  GridPane.setColumns([
    { key: 'name', width: 320, visible: true },
    { key: 'status', width: 10, visible: false }
  ]);
  var columns = GridPane.columns;
  assert.strictEqual(columns.length, 8);
  assert.strictEqual(columns[0].width, 320);
  assert.strictEqual(columns[1].width, 80);
  assert.strictEqual(columns[1].visible, false);
  assert.strictEqual(columns[7].width, 220);
  assert.strictEqual(columns[7].visible, true);
  GridPane.setColumns(null);
});

test('getColumnState 保留完整 Column 字段（按获批契约）', function() {
  GridPane.setColumns(null);
  var state = GridPane.getColumnState();
  assert.strictEqual(state.length, 8);
  assert.deepStrictEqual(plain(Object.keys(state[0]).sort()), ['builtin', 'key', 'label', 'minWidth', 'type', 'visible', 'width']);
  assert.strictEqual(state[0].key, 'name');
  assert.strictEqual(state[0].width, 260);
  assert.strictEqual(state[0].visible, true);
});

test('setColumnVisible 与 setColumnWidth 修改对应列', function() {
  GridPane.setColumns(null);
  assert.strictEqual(GridPane.setColumnVisible('assignee', false), false);
  assert.strictEqual(GridPane._findColumn('assignee').visible, false);
  assert.strictEqual(GridPane.setColumnWidth('assignee', 50), 70);
  assert.strictEqual(GridPane._findColumn('assignee').width, 70);
  assert.strictEqual(GridPane.setColumnWidth('missing', 100), null);
  GridPane.setColumns(null);
});

test('setColumns 按持久化顺序恢复，缺失列按默认顺序补齐', function() {
  GridPane.setColumns([
    { key: 'description', width: 200, visible: true },
    { key: 'progress', width: 130, visible: false },
    { key: 'name', width: 300, visible: true }
  ]);
  assert.deepStrictEqual(plain(GridPane.columns.map(function(col) { return col.key; })),
    ['description', 'progress', 'name', 'status', 'assignee', 'startDate', 'endDate', 'plannedEndDate']);
  assert.strictEqual(GridPane.columns[1].visible, false);
  assert.strictEqual(GridPane.columns[0].width, 200);
  assert.strictEqual(GridPane.getColumnsWidth(), 200 + 300 + 110 + 100 + 110 + 110 + 120);
  GridPane.setColumns(null);
});

test('setColumns 忽略未知列和重复 key', function() {
  GridPane.setColumns([
    { key: 'unknown', width: 100 },
    { key: 'name', width: 200 },
    { key: 'name', width: 240 },
    null
  ]);
  assert.strictEqual(GridPane.columns.length, 8);
  assert.strictEqual(GridPane.columns[0].key, 'name');
  assert.strictEqual(GridPane.columns[0].width, 200);
  GridPane.setColumns(null);
});

test('setColumns 允许任务名称列隐藏（按获批设计第5节）', function() {
  GridPane.setColumns([{ key: 'name', width: 260, visible: false }]);
  assert.strictEqual(GridPane.columns[0].key, 'name');
  assert.strictEqual(GridPane.columns[0].visible, false);
  GridPane.setColumns(null);
});

test('setColumnVisible 允许隐藏任务名称列（按获批设计第5节）', function() {
  GridPane.setColumns(null);
  assert.strictEqual(GridPane.setColumnVisible('name', false), false);
  assert.strictEqual(GridPane._findColumn('name').visible, false);
  GridPane.setColumns(null);
});

test('moveColumn 上移下移并在边界返回 false', function() {
  GridPane.setColumns(null);
  assert.strictEqual(GridPane.moveColumn('status', -1), true);
  assert.deepStrictEqual(plain(GridPane.columns.slice(0, 2).map(function(col) { return col.key; })),
    ['status', 'name']);
  assert.strictEqual(GridPane.moveColumn('status', -1), false);
  assert.strictEqual(GridPane.moveColumn('description', 1), false);
  assert.strictEqual(GridPane.moveColumn('status', 1), true);
  assert.deepStrictEqual(plain(GridPane.columns.slice(0, 2).map(function(col) { return col.key; })),
    ['name', 'status']);
  GridPane.setColumns(null);
});

test('列状态序列化后可完整还原宽度、可见性和顺序', function() {
  GridPane.setColumns(null);
  GridPane.setColumnWidth('name', 300);
  GridPane.setColumnVisible('assignee', false);
  GridPane.moveColumn('progress', -1);
  var state = plain(GridPane.getColumnState());

  GridPane.setColumns(null);
  GridPane.setColumns(state);

  assert.deepStrictEqual(plain(GridPane.getColumnState()), state);
  assert.deepStrictEqual(plain(GridPane.columns.map(function(col) { return col.key; })),
    state.map(function(col) { return col.key; }));
  GridPane.setColumns(null);
});

test('init 从 TaskManager 设置恢复列配置', function() {
  TaskManager.data = {
    tasks: [],
    milestones: [],
    settings: {
      columns: [
        { key: 'progress', width: 150, visible: true },
        { key: 'name', width: 280, visible: true }
      ]
    }
  };
  GridPane._columnsInitialized = false;
  GridPane.columns = null;

  GridPane.init({ header: null, body: null });

  assert.deepStrictEqual(plain(GridPane.columns.slice(0, 3).map(function(col) { return col.key; })),
    ['progress', 'name', 'status']);
  assert.strictEqual(GridPane.columns[0].width, 150);
  assert.strictEqual(GridPane.columns[1].width, 280);

  TaskManager.data = null;
  GridPane._columnsInitialized = false;
  GridPane.setColumns(null);
});

test('reloadColumnsForCurrentProject 按当前项目 settings.columns 重新载入列状态', function() {
  TaskManager.data = {
    tasks: [],
    milestones: [],
    settings: {
      columns: [
        { key: 'name', label: '任务名称', width: 300, minWidth: 160, visible: true, type: 'name', builtin: true },
        { key: 'assignee', label: '执行负责人', width: 120, minWidth: 70, visible: true, type: 'text', builtin: true },
        { key: 'status', label: '状态', width: 110, minWidth: 80, visible: false, type: 'status', builtin: true }
      ]
    }
  };
  GridPane._columnsInitialized = false;
  GridPane.columns = null;

  // 模拟启动时先以空项目初始化，随后切换到已有列设置的项目
  TaskManager.data = { tasks: [], milestones: [], settings: {} };
  GridPane.init({ header: null, body: null });
  assert.strictEqual(GridPane.getVisibleColumns().length, 8, '启动时无列设置则使用八个默认列');

  TaskManager.data = {
    tasks: [],
    milestones: [],
    settings: {
      columns: [
        { key: 'name', label: '任务名称', width: 300, minWidth: 160, visible: true, type: 'name', builtin: true },
        { key: 'assignee', label: '执行负责人', width: 120, minWidth: 70, visible: true, type: 'text', builtin: true },
        { key: 'status', label: '状态', width: 110, minWidth: 80, visible: false, type: 'status', builtin: true }
      ]
    }
  };
  GridPane.reloadColumnsForCurrentProject();

  var byKey = {};
  GridPane.columns.forEach(function(col) { byKey[col.key] = col; });
  assert.strictEqual(byKey.assignee.label, '执行负责人', '切换到带列设置的项目后必须恢复该项目的列改名');
  assert.strictEqual(byKey.status.visible, false, '切换到带列设置的项目后必须恢复该项目的隐藏列');
  assert.strictEqual(byKey.name.width, 300, '切换到带列设置的项目后必须恢复该项目的列宽');

  TaskManager.data = null;
  GridPane.setColumns(null);
  GridPane._columnsInitialized = false;
});

test('init 优先使用显式传入的列状态', function() {
  GridPane._columnsInitialized = false;
  GridPane.columns = null;

  GridPane.init({
    header: null,
    body: null,
    columns: [{ key: 'name', width: 200, visible: true }]
  });

  assert.strictEqual(GridPane.columns[0].key, 'name');
  assert.strictEqual(GridPane.columns[0].width, 200);
  assert.strictEqual(GridPane.columns.length, 8);

  GridPane.setColumns(null);
  GridPane._columnsInitialized = false;
});

test('_persistColumns 把完整列状态写入 settings.columns', function() {
  TaskManager.data = {
    tasks: [],
    milestones: [],
    settings: {}
  };
  GridPane.setColumns(null);
  GridPane.setColumnWidth('progress', 140);

  GridPane._persistColumns();

  var saved = plain(TaskManager.data.settings.columns);
  assert.strictEqual(saved.length, 8);
  assert.strictEqual(saved[6].key, 'progress');
  assert.strictEqual(saved[6].width, 140);

  TaskManager.data = null;
  GridPane.setColumns(null);
});

test('ColumnConfig.normalize 不修改传入对象', function() {
  var saved = [{ key: 'name', width: 260, visible: true }];
  var snapshot = plain(saved);
  ColumnConfig.normalize(saved);
  assert.deepStrictEqual(plain(saved), snapshot);
});

test('汇总行进度单元格使用 computed progress', function() {
  GridPane._progressById = new Map([['A', 80]]);
  var row = {
    id: 'A',
    task: { progress: 10, status: 'inProgress' },
    isSummary: true
  };
  var html = GridPane.renderCell(row, { type: 'progress', key: 'progress' }, false);
  assert.ok(html.indexOf('80%') !== -1, html);
  GridPane._progressById = null;
});

// ---------- 基线偏差提示 ----------

function nameRow(id, name, startDate, endDate) {
  return {
    id: id,
    task: { id: id, name: name, color: '#1e40af', status: 'inProgress' },
    depth: 0,
    hasChildren: false,
    isCollapsed: false,
    isSummary: false,
    childCount: 0,
    startDate: startDate,
    endDate: endDate
  };
}

function baselineEntry(id, startDate, endDate, varianceDays) {
  return {
    id: id,
    baselineStartDate: startDate,
    baselineEndDate: endDate,
    endVarianceDays: varianceDays
  };
}

test('未设置基线时任务名称不渲染偏差提示', function() {
  GridPane.setBaselineById(null);
  var html = GridPane.renderNameCell(nameRow('A', '任务A', '2026-01-01', '2026-01-10'), false);
  assert.strictEqual(html.indexOf('grid-baseline-badge'), -1, html);
});

test('基线延期时任务名称渲染正向偏差和 tooltip', function() {
  GridPane.setBaselineById(new Map([
    ['A', baselineEntry('A', '2026-01-01', '2026-01-10', 5)]
  ]));
  var html = GridPane.renderNameCell(nameRow('A', '任务A', '2026-01-01', '2026-01-15'), false);

  assert.ok(html.indexOf('grid-baseline-badge') !== -1, html);
  assert.ok(html.indexOf('variance-delayed') !== -1, html);
  assert.ok(html.indexOf('+5天') !== -1, html);
  assert.ok(html.indexOf('基线 2026-01-01 ~ 2026-01-10') !== -1, html);
  GridPane.setBaselineById(null);
});

test('基线提前时渲染负向偏差，零偏差不渲染', function() {
  GridPane.setBaselineById(new Map([
    ['A', baselineEntry('A', '2026-01-01', '2026-01-10', -3)]
  ]));
  var advanced = GridPane.renderNameCell(nameRow('A', '任务A', '2026-01-01', '2026-01-07'), false);
  assert.ok(advanced.indexOf('variance-advanced') !== -1, advanced);
  assert.ok(advanced.indexOf('-3天') !== -1, advanced);

  GridPane.setBaselineById(new Map([
    ['A', baselineEntry('A', '2026-01-01', '2026-01-10', 0)]
  ]));
  var flat = GridPane.renderNameCell(nameRow('A', '任务A', '2026-01-01', '2026-01-10'), false);
  assert.strictEqual(flat.indexOf('grid-baseline-badge'), -1, flat);
  GridPane.setBaselineById(null);
});

test('新增任务渲染新增标记，缺失基线条目不渲染', function() {
  GridPane.setBaselineById(new Map([
    ['B', { id: 'B', added: true, baselineStartDate: null, baselineEndDate: null, endVarianceDays: null }]
  ]));
  var added = GridPane.renderNameCell(nameRow('B', '任务B', '2026-02-01', '2026-02-10'), false);
  assert.ok(added.indexOf('variance-added') !== -1, added);
  assert.ok(added.indexOf('新增') !== -1, added);

  var missing = GridPane.renderNameCell(nameRow('C', '任务C', '2026-02-01', '2026-02-10'), false);
  assert.strictEqual(missing.indexOf('grid-baseline-badge'), -1, missing);
  GridPane.setBaselineById(null);
});

test('formatBaselineVariance 输出带符号整数', function() {
  assert.strictEqual(GridPane.formatBaselineVariance(3), '+3');
  assert.strictEqual(GridPane.formatBaselineVariance(-2), '-2');
  assert.strictEqual(GridPane.formatBaselineVariance(0), '0');
  assert.strictEqual(GridPane.formatBaselineVariance(null), '');
  assert.strictEqual(GridPane.formatBaselineVariance(NaN), '');
});

// ---------- 工作日权重进度 ----------

function weightedTask(id, parentId, order, startDate, endDate, progress) {
  return {
    id: id,
    parentId: parentId,
    name: id,
    description: '',
    assignee: '',
    color: null,
    startDate: startDate,
    endDate: endDate,
    status: 'inProgress',
    progress: progress,
    plannedEndDate: endDate,
    order: order,
    ganttRow: null
  };
}

function weightedData(workCalendar) {
  var settings = {};
  if (workCalendar !== undefined) settings.workCalendar = workCalendar;
  return {
    pmweb_version: 3,
    milestones: [],
    links: [],
    views: [],
    settings: settings,
    tasks: [
      weightedTask('P', null, 0, '2026-01-01', '2026-01-05', 0),
      weightedTask('A', 'P', 0, '2026-01-01', '2026-01-05', 0),
      weightedTask('B', 'P', 1, '2026-01-05', '2026-01-05', 100)
    ]
  };
}

function summaryRowForGrid() {
  return { id: 'P', task: TaskManager.getTask('P'), isSummary: true, hasChildren: true };
}

function resetGridProgress() {
  TaskManager.data = null;
  GridPane._progressById = null;
  GridPane.columns = null;
  GridPane.header = null;
  GridPane.body = null;
  GridPane._columnsInitialized = false;
}

test('render 配置工作日历时使用工作日权重汇总进度', function() {
  GridPane.columns = GridPane.defaultColumns();
  GridPane.header = null;
  GridPane.body = null;
  helper.installTasks(app, weightedData({ weekends: [0, 6], holidays: [], workdays: [] }));

  GridPane.render([summaryRowForGrid()]);

  assert.strictEqual(GridPane._progressById.get('P'), 25);
  resetGridProgress();
});

test('render 未配置工作日历时保持自然日权重', function() {
  GridPane.columns = GridPane.defaultColumns();
  GridPane.header = null;
  GridPane.body = null;
  helper.installTasks(app, weightedData());

  GridPane.render([summaryRowForGrid()]);

  assert.ok(Math.abs(GridPane._progressById.get('P') - 100 / 6) < 1e-9);
  resetGridProgress();
});

// ---------- 行高契约：时间轴窗口化依赖左右行高一致 ----------

test('表格行高固定为 40 且每行渲染全部可见列', function() {
  GridPane.setColumns(null);
  assert.strictEqual(GridPane.ROW_HEIGHT, 40);

  var html = GridPane.renderRow(nameRow('A', '任务A', '2026-01-01', '2026-01-10'), 2, 0);
  assert.ok(html.indexOf('style="height:40px"') !== -1, html);
  assert.ok(html.indexOf('aria-rowindex="4"') !== -1, html);
  assert.strictEqual(html.split('data-column-key=').length - 1, 8);
});

// ---------- Task 4 新增测试场景 ----------

test('ColumnConfig.moveTo 支持将任意列移至目标位置', function() {
  var cols = ColumnConfig.defaultColumns();
  var moved = ColumnConfig.moveTo(cols, 'progress', 0);
  assert.strictEqual(moved[0].key, 'progress');
  assert.strictEqual(moved.length, cols.length);

  // 移出边界安全处理
  var clamped = ColumnConfig.moveTo(cols, 'progress', 999);
  assert.strictEqual(clamped[clamped.length - 1].key, 'progress');
});

test('ColumnConfig.getState 保留完整 Column 属性', function() {
  var custom = {
    key: 'col-cust',
    label: '自定义列',
    width: 150,
    minWidth: 80,
    visible: true,
    type: 'select',
    builtin: false,
    options: [{ id: 'opt1', label: '选项1' }]
  };
  var cols = [custom].concat(ColumnConfig.defaultColumns());
  var state = ColumnConfig.getState(cols);
  assert.strictEqual(state[0].key, 'col-cust');
  assert.strictEqual(state[0].label, '自定义列');
  assert.strictEqual(state[0].type, 'select');
  assert.strictEqual(state[0].builtin, false);
  assert.deepStrictEqual(plain(state[0].options), [{ id: 'opt1', label: '选项1' }]);
});

test('GridPane.renderCell 渲染自定义列及转义保护', function() {
  var row = {
    id: 'T1',
    task: {
      id: 'T1',
      name: '测试任务',
      customFields: {
        'cf-text': '<script>alert(1)</script>',
        'cf-num': 100,
        'cf-date': '2026-10-01',
        'cf-sel': 'opt-ok'
      }
    }
  };
  var textCol = { key: 'cf-text', type: 'text', builtin: false };
  var numCol = { key: 'cf-num', type: 'number', builtin: false };
  var dateCol = { key: 'cf-date', type: 'date', builtin: false };
  var selCol = {
    key: 'cf-sel',
    type: 'select',
    builtin: false,
    options: [{ id: 'opt-ok', label: '<b>通过</b>' }]
  };

  var textHtml = GridPane.renderCell(row, textCol, false);
  assert.ok(textHtml.indexOf('&lt;script&gt;') !== -1, '自定义文本须安全转义');
  assert.strictEqual(textHtml.indexOf('<script>'), -1);

  var numHtml = GridPane.renderCell(row, numCol, false);
  assert.ok(numHtml.indexOf('100') !== -1, '自定义数字渲染');

  var dateHtml = GridPane.renderCell(row, dateCol, false);
  assert.ok(dateHtml.indexOf('2026-10-01') !== -1, '自定义日期渲染');

  var selHtml = GridPane.renderCell(row, selCol, false);
  assert.ok(selHtml.indexOf('&lt;b&gt;通过&lt;/b&gt;') !== -1, '选项 label 须安全转义');
  assert.strictEqual(selHtml.indexOf('<b>通过</b>'), -1);
});

test('GridPane 在所有列隐藏时提示恢复且列配置按钮可用', function() {
  var hidden = ColumnConfig.defaultColumns().map(function(c) {
    var copy = plain(c);
    copy.visible = false;
    return copy;
  });
  GridPane.setColumns(hidden);
  var doc = {
    createElement: function(tag) {
      return {
        tagName: tag,
        className: '',
        style: {},
        innerHTML: '',
        setAttribute: function() {},
        getAttribute: function() { return null; },
        appendChild: function() {},
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        addEventListener: function() {}
      };
    },
    getElementById: function() { return null; },
    body: { appendChild: function() {} }
  };
  var header = doc.createElement('div');
  var body = doc.createElement('div');
  GridPane.init({ header: header, body: body, document: doc });
  GridPane.setColumns(hidden);
  GridPane.render([]);

  assert.ok(header.innerHTML.indexOf('grid-columns-btn') !== -1, '列配置按钮可用');
  assert.ok(body.innerHTML.indexOf('恢复') !== -1 || body.innerHTML.indexOf('grid-all-hidden-hint') !== -1, '包含恢复提示');
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

console.log('\ngrid: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
