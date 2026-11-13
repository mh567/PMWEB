'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js', 'store.js', 'task-manager.js', 'row-model.js', 'views.js',
  'progress.js', 'column-config.js', 'export.js'
]);
var Export = app.get('Export');
var Views = app.get('Views');
var RowModel = app.get('RowModel');
var TaskManager = app.get('TaskManager');
var ColumnConfig = app.get('ColumnConfig');

function baseData() {
  return {
    tasks: [
      { id: 'R', parentId: null, name: '项目', order: 0, status: 'inProgress', progress: 50, assignee: '', startDate: null, endDate: null, plannedEndDate: null, color: '#1e40af' },
      { id: 'A', parentId: 'R', name: '设计', order: 0, status: 'done', progress: 100, assignee: '张三', startDate: '2024-01-01', endDate: '2024-01-05', plannedEndDate: '2024-01-05', color: null },
      { id: 'B', parentId: 'R', name: '开发', order: 1, status: 'inProgress', progress: 40, assignee: '李四', startDate: '2024-01-06', endDate: '2024-01-10', plannedEndDate: '2024-01-10', color: null },
      { id: 'C', parentId: null, name: '验收', order: 1, status: 'inProgress', progress: 10, assignee: '张三', startDate: '2024-02-01', endDate: '2024-02-02', plannedEndDate: '2024-02-02', color: '#0f766e' }
    ],
    milestones: [
      { id: 'm1', taskId: 'A', name: '设计完成', date: '2024-01-05', status: 'done' },
      { id: 'm2', taskId: 'B', name: '联调', date: '2024-01-08', status: 'pending' }
    ],
    links: [],
    views: [],
    settings: {}
  };
}

function install(data) {
  helper.installTasks(app, data || baseData());
  return RowModel.build({ collapsed: new Set(), statusFilter: {} }).rows;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('filename 保持 PMWEB_YYYY-MM-DD.xlsx', function() {
  assert.strictEqual(Export.filename('2024-05-01'), 'PMWEB_2024-05-01.xlsx');
});

test('buildViewRows 按可见列顺序生成表头', function() {
  var columns = ColumnConfig.defaultColumns();
  columns[7].visible = false;
  var data = Export.buildViewRows([], columns);
  assert.deepStrictEqual(plain(data), [[
    '任务名称', '状态', '负责人', '开始', '结束', '计划完成', '进度'
  ]]);
});

test('buildViewRows 使用筛选后的行和视图状态文案', function() {
  var rows = install();
  var view = { filters: { status: 'done' } };
  var filtered = Views.apply(rows, view);
  var data = Export.buildViewRows(filtered, ColumnConfig.defaultColumns());
  assert.strictEqual(data.length, 3);
  assert.deepStrictEqual(plain(data[1].slice(0, 3)), ['项目', '进行中', '']);
  assert.deepStrictEqual(plain(data[2].slice(0, 6)), ['  设计', '已完成', '张三', '2024-01-01', '2024-01-05', '2024-01-05']);
  assert.strictEqual(data[2][6], '100%');
});

test('buildViewRows 输出分组标题行', function() {
  var rows = install();
  var grouped = Views.apply(rows, { groupBy: 'status' });
  var data = Export.buildViewRows(grouped, ColumnConfig.defaultColumns());
  var headers = data.map(function(line) { return line[0]; }).filter(function(value) {
    return String(value).indexOf('分组：') === 0;
  });
  assert.deepStrictEqual(plain(headers), ['分组：进行中（3）', '分组：已完成（1）']);
  assert.strictEqual(data[1].length, ColumnConfig.defaultColumns().length);
  assert.strictEqual(data[1][1], '');
});

test('buildViewRows 空数据只保留表头', function() {
  var data = Export.buildViewRows([], ColumnConfig.defaultColumns());
  assert.strictEqual(data.length, 1);
  assert.strictEqual(data[0][0], '任务名称');
});

test('buildTaskRows 保留层级结构', function() {
  var data = Export.buildTaskRows(TaskManager.getAllTasks(), { taskManager: TaskManager });
  assert.deepStrictEqual(plain(data[0]), ['层级', '任务名称', '开始日期', '结束日期', '负责人', '状态', '颜色']);
  assert.strictEqual(data[1][0], 1);
  assert.strictEqual(data[1][1], '项目');
  assert.strictEqual(data[2][0], 2);
  assert.ok(data[2][1].indexOf('设计') !== -1);
  assert.strictEqual(data[2][5], '已完成');
});

test('buildMilestoneRows 带任务名称和状态', function() {
  var data = Export.buildMilestoneRows(TaskManager.getAllMilestones(), TaskManager.getAllTasks(), { taskManager: TaskManager });
  assert.deepStrictEqual(plain(data[1]), ['设计', '设计完成', '2024-01-05', '已完成']);
  assert.deepStrictEqual(plain(data[2]), ['开发', '联调', '2024-01-08', '待办']);
});

test('buildGanttRows 只导出叶子任务并生成日期列', function() {
  var gantt = Export.buildGanttRows(TaskManager.getAllTasks(), { taskManager: TaskManager });
  assert.strictEqual(gantt.dates[0], '2024-01-01');
  assert.strictEqual(gantt.dates[gantt.dates.length - 1], '2024-02-02');
  assert.strictEqual(gantt.rows[0][1], '01-01');
  assert.deepStrictEqual(plain(gantt.rows.slice(1).map(function(line) { return line[0]; })), ['设计', '开发', '验收']);
});

test('buildWorkbook 保留三个既有 sheet 并增加当前视图', function() {
  var rows = install();
  var built = Export.buildWorkbook({
    tasks: TaskManager.getAllTasks(),
    milestones: TaskManager.getAllMilestones(),
    rows: rows,
    columns: ColumnConfig.defaultColumns(),
    date: '2024-05-01',
    taskManager: TaskManager
  });
  assert.strictEqual(built.filename, 'PMWEB_2024-05-01.xlsx');
  assert.deepStrictEqual(plain(built.sheets.map(function(sheet) { return sheet.name; })),
    ['任务列表', '里程碑', '甘特图', '当前视图']);
  assert.strictEqual(built.empty, false);
  assert.strictEqual(built.sheets[3].rows.length, rows.length + 1);
});

test('buildWorkbook 无日期时省略甘特图并标记 empty', function() {
  var data = {
    tasks: [{ id: 'X', parentId: null, name: '无日期任务', order: 0, status: 'inProgress', progress: 0, assignee: '' }],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  };
  var rows = install(data);
  var built = Export.buildWorkbook({
    tasks: TaskManager.getAllTasks(),
    milestones: [],
    rows: rows,
    columns: ColumnConfig.defaultColumns(),
    date: '2024-05-01',
    taskManager: TaskManager
  });
  assert.deepStrictEqual(plain(built.sheets.map(function(sheet) { return sheet.name; })),
    ['任务列表', '里程碑', '当前视图']);
  assert.strictEqual(built.empty, true);
});

test('exportToExcel 在缺少 XLSX 时返回 missing-xlsx', function() {
  install();
  var result = Export.exportToExcel({
    tasks: TaskManager.getAllTasks(),
    milestones: TaskManager.getAllMilestones(),
    rows: [],
    columns: ColumnConfig.defaultColumns(),
    date: '2024-05-01',
    taskManager: TaskManager
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'missing-xlsx');
});

// ---------- Task 4 自定义字段导出测试 ----------

test('buildViewRows 同步自定义列顺序、表头和字段值', function() {
  var cols = [
    { key: 'name', label: '事项名称', width: 200, visible: true, type: 'name', builtin: true },
    {
      key: 'cf-risk', label: '风险', width: 100, visible: true, type: 'select', builtin: false,
      options: [{ id: 'opt-high', label: '极高' }]
    },
    { key: 'cf-score', label: '积分', width: 80, visible: true, type: 'number', builtin: false }
  ];
  var rows = [
    {
      id: 'T1',
      task: {
        id: 'T1',
        name: '安全审计',
        customFields: { 'cf-risk': 'opt-high', 'cf-score': 88 }
      },
      depth: 0,
      hasChildren: false,
      isSummary: false
    }
  ];
  var data = Export.buildViewRows(rows, cols);
  assert.deepStrictEqual(plain(data[0]), ['事项名称', '风险', '积分']);
  assert.strictEqual(data[1][0], '安全审计');
  assert.strictEqual(data[1][1], '极高');
  assert.strictEqual(data[1][2], '88');
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

console.log('\nexport: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
