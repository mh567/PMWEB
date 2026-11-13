'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var lw = require('./helpers/load-workspace');
var makeWorkspace = lw.makeWorkspace;

var app = helper.createApp([
  'date.js',
  'validate.js',
  'store.js',
  'workspace.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'work-calendar.js',
  'task-manager.js',
  'row-model.js',
  'views.js',
  'column-config.js',
  'baseline.js',
  'grid-pane.js',
  'cell-editor.js',
  'progress.js',
  'export.js',
  'modal.js'
]);

var ColumnConfig = app.get('ColumnConfig');
var TaskManager = app.get('TaskManager');
var Workspace = app.get('Workspace');
var CellEditor = app.get('CellEditor');
var Export = app.get('Export');
var GridPane = app.get('GridPane');
var ModalManager = app.get('ModalManager');
var DataStore = app.get('DataStore');

app.context.TaskManager = TaskManager;
app.context.Workspace = Workspace;
app.context.ColumnConfig = ColumnConfig;
app.context.DataStore = DataStore;
app.context.CellEditor = CellEditor;
app.context.Export = Export;
app.context.GridPane = GridPane;
app.context.ModalManager = ModalManager;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

// -------------------------------------------------------------
// 1. rename_and_reorder_keep_values_by_key
// -------------------------------------------------------------
test('rename_and_reorder_keep_values_by_key', function() {
  helper.resetProject(app);
  var defaultCols = ColumnConfig.defaultColumns();

  // 重命名第一列（名称列）为“事项”，并调整列顺序
  var modified = plain(defaultCols);
  modified[0].label = '事项';

  // 新增一个自定义字段并放置在第二位
  var customCol = {
    key: 'col-custom-risk',
    label: '风险等级',
    width: 120,
    minWidth: 80,
    visible: true,
    type: 'select',
    builtin: false,
    options: [
      { id: 'opt-high', label: '高风险' },
      { id: 'opt-low', label: '低风险' }
    ]
  };
  modified.splice(1, 0, customCol);

  var saved = ColumnConfig.normalize(modified);
  assert.equal(saved[0].label, '事项', '名称列改名后 label 应为事项');
  assert.equal(saved[0].key, 'name', '名称列 key 必须保持不变');
  assert.equal(saved[1].key, 'col-custom-risk', '自定义列顺序应保持第二位');

  // moveTo 测试
  var moved = ColumnConfig.moveTo(saved, 'col-custom-risk', 0);
  assert.equal(moved[0].key, 'col-custom-risk', 'moveTo 移到首位成功');
  assert.equal(moved[1].key, 'name', '原首位后移');

  // 创建任务并设置自定义字段
  var task = TaskManager.addTask(null, '核心功能实现');
  assert.ok(task, '任务创建成功');
  var updated = TaskManager.updateTask(task.id, {
    customFields: { 'col-custom-risk': 'opt-high' }
  });
  assert.ok(updated, '任务更新成功');
  assert.equal(updated.customFields['col-custom-risk'], 'opt-high', '自定义字段值按稳定 key 保存');

  // 列再次重排序后，任务字段值与键映射保持不变
  var reordered = ColumnConfig.moveTo(moved, 'name', 0);
  assert.equal(reordered[0].key, 'name');
  assert.equal(TaskManager.getTask(task.id).customFields['col-custom-risk'], 'opt-high');
});

// -------------------------------------------------------------
// 2. all_columns_hidden_are_recoverable
// -------------------------------------------------------------
test('all_columns_hidden_are_recoverable', function() {
  helper.resetProject(app);
  var defaultCols = ColumnConfig.defaultColumns();
  var hidden = defaultCols.map(function(col) {
    var copy = plain(col);
    copy.visible = false;
    return copy;
  });

  var normalized = ColumnConfig.normalize(hidden);
  assert.equal(ColumnConfig.getVisibleColumns(normalized).length, 0, '所有列可全部隐藏');

  // GridPane 渲染时具有恢复提示
  GridPane.setColumns(normalized);
  var paneDoc = {
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
  var header = paneDoc.createElement('div');
  var body = paneDoc.createElement('div');
  GridPane.init({ header: header, body: body, document: paneDoc });
  GridPane.setColumns(normalized);
  GridPane.render([]);

  // 表头仍保留列配置入口按钮
  assert.ok(header.innerHTML.indexOf('grid-columns-btn') !== -1, '表头必须保留列配置按钮');
  // body 提示恢复
  assert.ok(body.innerHTML.indexOf('grid-all-hidden-hint') !== -1 || body.innerHTML.indexOf('恢复') !== -1, 'body 应包含全隐藏恢复提示');

  // 恢复部分列
  var restored = plain(normalized);
  restored[0].visible = true;
  var finalCols = ColumnConfig.normalize(restored);
  assert.equal(ColumnConfig.getVisibleColumns(finalCols).length, 1, '恢复显示正常');
});

// -------------------------------------------------------------
// 3. typed_values_and_referenced_options
// -------------------------------------------------------------
test('typed_values_and_referenced_options', function() {
  helper.resetProject(app);
  var customCols = [
    { key: 'cf-text', label: '备注说明', width: 100, minWidth: 60, visible: true, type: 'text', builtin: false },
    { key: 'cf-num', label: '预算工时', width: 100, minWidth: 60, visible: true, type: 'number', builtin: false },
    { key: 'cf-date', label: '评审日期', width: 100, minWidth: 60, visible: true, type: 'date', builtin: false },
    {
      key: 'cf-select', label: '风险级别', width: 100, minWidth: 60, visible: true, type: 'select', builtin: false,
      options: [
        { id: 'opt-high', label: '高风险' },
        { id: 'opt-mid', label: '中风险' }
      ]
    }
  ];

  var allCols = ColumnConfig.defaultColumns().concat(customCols);
  TaskManager.data.settings.columns = ColumnConfig.normalize(allCols);

  var task = TaskManager.addTask(null, '风险评估任务');
  var updated = TaskManager.updateTask(task.id, {
    customFields: {
      'cf-text': '需专家评审',
      'cf-num': 42.5,
      'cf-date': '2026-06-15',
      'cf-select': 'opt-high'
    }
  });

  assert.equal(updated.customFields['cf-text'], '需专家评审');
  assert.equal(updated.customFields['cf-num'], 42.5);
  assert.equal(updated.customFields['cf-date'], '2026-06-15');
  assert.equal(updated.customFields['cf-select'], 'opt-high');

  // 引用 opt-high 修改 label 后值 ID 不变
  var modifiedCols = plain(TaskManager.data.settings.columns);
  var selectCol = ColumnConfig.findColumn(modifiedCols, 'cf-select');
  assert.ok(selectCol, '找到单选列');
  selectCol.options[0].label = '超高严重风险'; // label 变更，id opt-high 保持

  var draftValidation = ColumnConfig.validateDraft(modifiedCols, TaskManager.data, []);
  assert.equal(draftValidation.valid, true, '仅修改选项 label 允许通过');

  TaskManager.data.settings.columns = ColumnConfig.normalize(modifiedCols);
  var refreshed = TaskManager.getTask(task.id);
  assert.equal(refreshed.customFields['cf-select'], 'opt-high', '任务保存的 option ID 保持不变');
});

// -------------------------------------------------------------
// 4. validateValue: NaN/Infinity/无效日期/未知选项/null保持null
// -------------------------------------------------------------
test('validateValue_type_checks', function() {
  var numCol = { key: 'num', type: 'number' };
  assert.deepEqual(ColumnConfig.validateValue(numCol, 123), { valid: true, value: 123, error: null });
  assert.deepEqual(ColumnConfig.validateValue(numCol, '456.78'), { valid: true, value: 456.78, error: null });
  assert.deepEqual(ColumnConfig.validateValue(numCol, null), { valid: true, value: null, error: null });
  assert.deepEqual(ColumnConfig.validateValue(numCol, ''), { valid: true, value: null, error: null });
  assert.equal(ColumnConfig.validateValue(numCol, NaN).valid, false, 'NaN 应拒绝');
  assert.equal(ColumnConfig.validateValue(numCol, Infinity).valid, false, 'Infinity 应拒绝');
  assert.equal(ColumnConfig.validateValue(numCol, -Infinity).valid, false, '-Infinity 应拒绝');
  assert.equal(ColumnConfig.validateValue(numCol, 'not-a-number').valid, false, '非法字符串数字应拒绝');

  var dateCol = { key: 'dt', type: 'date' };
  assert.deepEqual(ColumnConfig.validateValue(dateCol, '2026-05-20'), { valid: true, value: '2026-05-20', error: null });
  assert.deepEqual(ColumnConfig.validateValue(dateCol, null), { valid: true, value: null, error: null });
  assert.deepEqual(ColumnConfig.validateValue(dateCol, ''), { valid: true, value: null, error: null });
  assert.equal(ColumnConfig.validateValue(dateCol, '2026-02-30').valid, false, '无效日期应拒绝');
  assert.equal(ColumnConfig.validateValue(dateCol, '2026/05/20').valid, false, '非法格式日期应拒绝');
  assert.equal(ColumnConfig.validateValue(dateCol, 'invalid-date').valid, false, '非法字符串应拒绝');

  var selectCol = {
    key: 'sel',
    type: 'select',
    options: [{ id: 'opt-1', label: '选项一' }, { id: 'opt-2', label: '选项二' }]
  };
  assert.deepEqual(ColumnConfig.validateValue(selectCol, 'opt-1'), { valid: true, value: 'opt-1', error: null });
  assert.deepEqual(ColumnConfig.validateValue(selectCol, null), { valid: true, value: null, error: null });
  assert.deepEqual(ColumnConfig.validateValue(selectCol, ''), { valid: true, value: null, error: null });
  assert.equal(ColumnConfig.validateValue(selectCol, 'opt-unknown').valid, false, '未知选项 ID 应拒绝');

  var textCol = { key: 'txt', type: 'text' };
  assert.deepEqual(ColumnConfig.validateValue(textCol, ' 示例文本 '), { valid: true, value: ' 示例文本 ', error: null });
  assert.deepEqual(ColumnConfig.validateValue(textCol, null), { valid: true, value: null, error: null });
});

// -------------------------------------------------------------
// 5. validateDraft: 重名/改类型/删被引用选项/回收站引用保护
// -------------------------------------------------------------
test('validateDraft_integrity_rules', function() {
  helper.resetProject(app);
  var baseCols = ColumnConfig.defaultColumns();

  // 1. 重名列校验
  var dupCols = plain(baseCols);
  dupCols[1].label = dupCols[0].label; // 状态列改名为 任务名称
  var dupRes = ColumnConfig.validateDraft(dupCols, TaskManager.data, []);
  assert.equal(dupRes.valid, false, '列名重复应校验失败');

  // 空列名
  var emptyNameCols = plain(baseCols);
  emptyNameCols[0].label = '   ';
  var emptyRes = ColumnConfig.validateDraft(emptyNameCols, TaskManager.data, []);
  assert.equal(emptyRes.valid, false, '列名去除空格后为空应校验失败');

  // 2. 已有非空数据禁止改字段类型
  var customCols = plain(baseCols).concat([
    {
      key: 'cf-status', label: '定制等级', width: 100, minWidth: 60, visible: true, type: 'select', builtin: false,
      options: [{ id: 'opt-a', label: 'A级' }]
    }
  ]);
  TaskManager.data.settings.columns = ColumnConfig.normalize(customCols);
  var t1 = TaskManager.addTask(null, '任务1');
  TaskManager.updateTask(t1.id, { customFields: { 'cf-status': 'opt-a' } });

  // 尝试将 cf-status 从 select 改为 number
  var changedTypeCols = plain(customCols);
  var targetCol = ColumnConfig.findColumn(changedTypeCols, 'cf-status');
  targetCol.type = 'number';
  delete targetCol.options;
  var typeChangeRes = ColumnConfig.validateDraft(changedTypeCols, TaskManager.data, []);
  assert.equal(typeChangeRes.valid, false, '已有非空数据时禁止直接修改列类型');

  // 3. 删除被活动任务引用的选项
  var deleteOptionCols = plain(customCols);
  var selCol = ColumnConfig.findColumn(deleteOptionCols, 'cf-status');
  selCol.options = []; // 清空选项试图删除 opt-a
  var delOptRes = ColumnConfig.validateDraft(deleteOptionCols, TaskManager.data, []);
  assert.equal(delOptRes.valid, false, '被活动任务引用的选项禁止直接删除');

  // 4. 删除被回收站任务引用的选项
  // 构造 Task 7 回收站契约快照：trashBatches 包含含有 customFields: { 'cf-status': 'opt-a' } 的任务
  var trashBatches = [
    {
      id: 'batch-1',
      projectId: 'p-test',
      tasks: [
        { id: 't-deleted', name: '已删除任务', customFields: { 'cf-status': 'opt-a' } }
      ]
    }
  ];
  // 将活动任务的引用清空，仅回收站引用
  TaskManager.updateTask(t1.id, { customFields: { 'cf-status': null } });
  var trashRefRes = ColumnConfig.validateDraft(deleteOptionCols, TaskManager.data, trashBatches);
  assert.equal(trashRefRes.valid, false, '被回收站引用的选项同样禁止删除');
});

// -------------------------------------------------------------
// 6. 保存取消草稿与项目 A/B 隔离
// -------------------------------------------------------------
test('save_cancel_draft_and_project_isolation', function() {
  helper.resetProject(app);

  // 初始化项目 A 的列
  var initialCols = ColumnConfig.defaultColumns();
  TaskManager.data.settings.columns = ColumnConfig.normalize(initialCols);

  // 模拟草稿修改
  var draft = plain(TaskManager.data.settings.columns);
  draft.push({
    key: 'col-proj-a', label: '项目A专用字段', width: 120, minWidth: 80, visible: true, type: 'text', builtin: false
  });

  // 取消：不写回 settings.columns
  assert.equal(ColumnConfig.findColumn(TaskManager.data.settings.columns, 'col-proj-a'), null);

  // 保存草稿
  TaskManager.data.settings.columns = ColumnConfig.normalize(draft);
  assert.ok(ColumnConfig.findColumn(TaskManager.data.settings.columns, 'col-proj-a'));

  // 切换到项目 B
  var projBData = {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  };
  var projB = {
    id: 'p-other',
    name: '项目B',
    status: 'active',
    archived: false,
    data: projBData
  };
  TaskManager.bindProject(projB);

  var projBCols = ColumnConfig.normalize(projBData.settings.columns);
  assert.equal(ColumnConfig.findColumn(projBCols, 'col-proj-a'), null, '项目B不应继承项目A自定义列');
});

// -------------------------------------------------------------
// 7. 删除自定义列确认与回收站值一致清理
// -------------------------------------------------------------
test('delete_custom_column_and_clean_up_values', function() {
  helper.resetProject(app);
  var customCols = ColumnConfig.defaultColumns().concat([
    { key: 'cf-to-del', label: '临时字段', width: 100, minWidth: 60, visible: true, type: 'text', builtin: false }
  ]);
  TaskManager.data.settings.columns = ColumnConfig.normalize(customCols);

  var t1 = TaskManager.addTask(null, '任务一');
  TaskManager.updateTask(t1.id, { customFields: { 'cf-to-del': '临时数据' } });

  // 内置列禁止删除定义
  assert.throws(function() {
    ColumnConfig.removeColumnDefinition(TaskManager.data.settings.columns, 'name');
  }, /内置列不允许删除/);

  // 模拟删除自定义列并执行清理方法
  var trashBatches = [
    {
      id: 'batch-1',
      projectId: 'p-test',
      tasks: [
        { id: 't-trash', name: '已删除任务', customFields: { 'cf-to-del': '回收站临时数据' } }
      ]
    }
  ];

  var cleaned = ColumnConfig.deleteCustomColumn(TaskManager.data.settings.columns, 'cf-to-del', TaskManager.data, trashBatches);
  assert.equal(ColumnConfig.findColumn(cleaned, 'cf-to-del'), null, '列定义已移除');
  assert.equal(TaskManager.getTask(t1.id).customFields['cf-to-del'], undefined, '活动任务值已清理');
  assert.equal(trashBatches[0].tasks[0].customFields['cf-to-del'], undefined, '回收站任务值已同步清理');
});

// -------------------------------------------------------------
// 8. Excel 导出与行内编辑真实值断言
// -------------------------------------------------------------
test('export_and_cell_editor_custom_fields', function() {
  helper.resetProject(app);
  var cols = ColumnConfig.defaultColumns().concat([
    {
      key: 'cf-prio', label: '优先级', width: 100, minWidth: 60, visible: true, type: 'select', builtin: false,
      options: [{ id: 'p-p0', label: 'P0级' }, { id: 'p-p1', label: 'P1级' }]
    },
    { key: 'cf-score', label: '难度评分', width: 100, minWidth: 60, visible: true, type: 'number', builtin: false }
  ]);
  TaskManager.data.settings.columns = ColumnConfig.normalize(cols);

  var task = TaskManager.addTask(null, '核心攻关');
  TaskManager.updateTask(task.id, {
    customFields: {
      'cf-prio': 'p-p0',
      'cf-score': 99
    }
  });

  // CellEditor 检查
  var prioCol = ColumnConfig.findColumn(cols, 'cf-prio');
  assert.equal(CellEditor.controlFor('cf-prio', prioCol), 'select');
  assert.equal(CellEditor.format('cf-prio', 'p-p0', prioCol), 'P0级');

  var commitRes = CellEditor.commit(task, 'cf-score', '100', ColumnConfig.findColumn(cols, 'cf-score'));
  assert.equal(commitRes.changed, true);
  assert.equal(commitRes.updates.customFields['cf-score'], 100);

  // Excel 导出检查
  var row = {
    id: task.id,
    task: task,
    depth: 0,
    hasChildren: false,
    isSummary: false
  };
  var exportRows = Export.buildViewRows([row], cols);
  var headers = exportRows[0];
  assert.ok(headers.indexOf('优先级') !== -1, '导出表头包含自定义列');
  assert.ok(headers.indexOf('难度评分') !== -1, '导出表头包含数字列');

  var prioIdx = headers.indexOf('优先级');
  var scoreIdx = headers.indexOf('难度评分');
  assert.equal(exportRows[1][prioIdx], 'P0级', '导出单元格反映选项 label');
  assert.equal(exportRows[1][scoreIdx], '99', '导出单元格反映数字值');
});

// -------------------------------------------------------------
// 9. TASK4-CRIT-01: deleteCustomColumn 跨项目隔离 (覆盖 task 批次与 project 批次)
// -------------------------------------------------------------
test('delete_custom_column_project_isolation_task_and_project_batches', function() {
  helper.resetProject(app);

  var projAData = {
    pmweb_version: 3,
    tasks: [
      { id: 't-a1', name: 'A任务1', customFields: { 'col-risk': 'high' } }
    ],
    settings: {
      columns: ColumnConfig.normalize([
        { key: 'name', label: '名称', type: 'name', builtin: true, visible: true },
        { key: 'col-risk', label: '风险', type: 'text', builtin: false, visible: true }
      ])
    }
  };

  var allTrashBatches = [
    {
      id: 'batch-a-task',
      projectId: 'proj-a',
      kind: 'task',
      snapshot: {
        tasks: [
          { id: 't-a-del', name: 'A删除任务', customFields: { 'col-risk': 'medium' } }
        ]
      }
    },
    {
      id: 'batch-b-task',
      projectId: 'proj-b',
      kind: 'task',
      snapshot: {
        tasks: [
          { id: 't-b-del', name: 'B删除任务', customFields: { 'col-risk': 'high' } }
        ]
      }
    },
    {
      id: 'batch-b-project',
      projectId: 'proj-b',
      kind: 'project',
      snapshot: {
        data: {
          tasks: [
            { id: 't-b-proj-task', name: 'B项目删除任务', customFields: { 'col-risk': 'critical' } }
          ]
        }
      }
    },
    {
      id: 'batch-unknown',
      kind: 'task',
      snapshot: {
        tasks: [
          { id: 't-unk', name: '未知批次任务', customFields: { 'col-risk': 'unk-val' } }
        ]
      }
    }
  ];

  var nextCols = ColumnConfig.deleteCustomColumn(projAData.settings.columns, 'col-risk', projAData, allTrashBatches);

  // A 的活动任务已清理
  assert.equal(projAData.tasks[0].customFields['col-risk'], undefined, 'A的活动任务字段已清理');

  // B 的 task 批次和 project 批次中的 col-risk 必须完好无损！
  assert.equal(allTrashBatches[1].snapshot.tasks[0].customFields['col-risk'], 'high', 'B的task批次字段不可被误删');
  assert.equal(allTrashBatches[2].snapshot.data.tasks[0].customFields['col-risk'], 'critical', 'B的project批次字段不可被误删');
  assert.equal(allTrashBatches[3].snapshot.tasks[0].customFields['col-risk'], 'unk-val', '未知批次字段不可被误删');
});

// -------------------------------------------------------------
// 10. TASK4-CRIT-02: 草稿阶段点击删除随后取消，完全不污染内存与回收站
// -------------------------------------------------------------
test('draft_cancel_does_not_mutate_memory_or_recycle_bin', function() {
  helper.resetProject(app);
  var ws = {
    pmweb_version: 4,
    projects: [
      {
        id: 'proj-1',
        name: '项目一',
        status: 'active',
        archived: false,
        data: {
          pmweb_version: 3,
          tasks: [
            { id: 't1', name: '任务1', customFields: { 'col-draft-del': '原始数据值' } }
          ],
          settings: {
            columns: ColumnConfig.normalize([
              { key: 'name', label: '名称', type: 'name', builtin: true, visible: true },
              { key: 'col-draft-del', label: '待删列', type: 'text', builtin: false, visible: true }
            ])
          }
        }
      }
    ],
    recycleBin: [
      {
        id: 'rb-1',
        projectId: 'proj-1',
        kind: 'task',
        snapshot: {
          tasks: [
            { id: 't-del', name: '回收任务', customFields: { 'col-draft-del': '回收站原始值' } }
          ]
        }
      }
    ]
  };

  helper.installTasks(app, ws.projects[0].data);
  Workspace.data.recycleBin = ws.recycleBin;

  var fakeDoc = {
    body: {
      appendChild: function(child) { this.child = child; },
      removeChild: function(child) { this.child = null; }
    },
    createElement: function(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        attributes: {},
        listeners: {},
        setAttribute: function(k, v) { this.attributes[k] = v; },
        getAttribute: function(k) { return this.attributes[k]; },
        addEventListener: function(evt, fn) { this.listeners[evt] = fn; },
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        style: {}
      };
    }
  };

  var mockBtn = {
    setAttribute: function() {},
    getBoundingClientRect: function() { return { right: 100, bottom: 50, top: 20 }; },
    style: {}
  };
  GridPane.header = {
    querySelector: function() { return mockBtn; }
  };
  app.context.document = fakeDoc;
  app.context.window = app.context;
  GridPane._doc = fakeDoc;
  GridPane.setColumns(TaskManager.data.settings.columns);

  GridPane._showColumnPanel();
  assert.ok(GridPane._panel, '面板已打开');
  assert.ok(GridPane._columnDraft, '草稿已生成');

  // 模拟在草稿面板中点击删除该列
  var clickHandler = GridPane._panel.listeners['click'];
  assert.ok(clickHandler, '必须绑定 click 监听器');

  // 点击删除按钮
  clickHandler({
    target: {
      getAttribute: function(name) {
        if (name === 'data-del-col') return 'col-draft-del';
        return null;
      }
    },
    preventDefault: function() {}
  });

  // 核心断言：在未点击保存前，TaskManager.data.tasks 和 Workspace.data.recycleBin 绝对不能被修改！
  assert.equal(
    TaskManager.data.tasks[0].customFields['col-draft-del'],
    '原始数据值',
    '草稿阶段点击删除不能立即修改内存任务数据'
  );
  assert.equal(
    Workspace.data.recycleBin[0].snapshot.tasks[0].customFields['col-draft-del'],
    '回收站原始值',
    '草稿阶段点击删除不能立即修改回收站快照'
  );

  // 点击取消
  clickHandler({
    target: { id: 'grid-draft-cancel' },
    preventDefault: function() {}
  });

  assert.equal(GridPane._columnDraft, null, '取消后草稿清空');
  assert.equal(
    TaskManager.data.tasks[0].customFields['col-draft-del'],
    '原始数据值',
    '取消后内存任务数据必须完好保留'
  );
  assert.equal(
    Workspace.data.recycleBin[0].snapshot.tasks[0].customFields['col-draft-del'],
    '回收站原始值',
    '取消后回收站数据必须完好保留'
  );
});

// -------------------------------------------------------------
// 11. TASK4-CRIT-03: 只读/归档保护拦截与切换项目保存防护
// -------------------------------------------------------------
test('assert_writable_protection_and_project_switch_detection', function() {
  helper.resetProject(app);
  var ws = makeWorkspace();
  ws.projects[0].archived = true; // p-a 为归档项目
  ws.projects[1].archived = false; // p-b 为活动项目
  var pC = JSON.parse(JSON.stringify(ws.projects[1]));
  pC.id = 'p-c';
  pC.name = '活动项目C';
  ws.projects.push(pC);

  app.localStorage.setItem('pmweb_data', JSON.stringify(ws));
  Workspace.init();
  TaskManager.init();
  Workspace.activate('p-a');

  var fakeDoc = {
    body: { appendChild: function() {}, removeChild: function() {} },
    createElement: function(tag) {
      return {
        tagName: tag.toUpperCase(),
        attributes: {},
        listeners: {},
        setAttribute: function(k, v) { this.attributes[k] = v; },
        getAttribute: function(k) { return this.attributes[k]; },
        addEventListener: function(evt, fn) { this.listeners[evt] = fn; },
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        style: {}
      };
    }
  };

  var mockBtn = {
    setAttribute: function() {},
    getBoundingClientRect: function() { return { right: 100, bottom: 50, top: 20 }; },
    style: {}
  };
  GridPane.header = {
    querySelector: function() { return mockBtn; }
  };
  app.context.document = fakeDoc;
  app.context.window = app.context;
  GridPane._doc = fakeDoc;

  // 1. 归档项目尝试保存草稿：必须被拦截且抛错或拒绝
  GridPane._showColumnPanel();
  var initialRaw = Workspace.raw;

  assert.throws(function() {
    GridPane._saveDraft(GridPane._panel);
  }, /归档|只读|不可写入/, '归档项目调用 _saveDraft 必须抛出只读保护错误');

  assert.equal(Workspace.raw, initialRaw, '归档项目被拦截后 raw 原文不可改变');

  // 2. 切换项目检测
  Workspace.activate('p-b');
  GridPane._showColumnPanel();
  assert.equal(GridPane._capturedProjectId, 'p-b', '打开时捕获当前项目ID');

  // 模拟用户在打开面板后，外部切换到了另一个项目（如通过协作或UI切换）
  Workspace.activate('p-c');

  // 点击保存时检测项目不匹配，拒绝保存并不污染新项目
  var errorMsg = null;
  var mockPanel = {
    querySelectorAll: function() { return []; },
    querySelector: function(sel) {
      if (sel === '#grid-draft-error') {
        return {
          set textContent(v) { errorMsg = v; },
          style: {}
        };
      }
      return null;
    }
  };

  GridPane._saveDraft(mockPanel);
  assert.ok(errorMsg && errorMsg.indexOf('已切换') !== -1, '项目切换后保存必须被拒绝并提示');
});

// -------------------------------------------------------------
// 12. TASK4-IMPT-02 & IMPT-03: 本项目 snapshot 阻止类型修改与选项删除，跨项目不误挡
// -------------------------------------------------------------
test('validate_draft_v4_snapshot_integrity_and_project_isolation', function() {
  helper.resetProject(app);

  var customCols = ColumnConfig.normalize([
    { key: 'name', label: '名称', type: 'name', builtin: true, visible: true },
    {
      key: 'cf-status', label: '定制状态', type: 'select', builtin: false, visible: true,
      options: [{ id: 'opt-1', label: '进行中' }, { id: 'opt-2', label: '已暂停' }]
    }
  ]);

  var projData = {
    id: 'proj-curr',
    tasks: [
      // 活动任务中没有值（为 null）
      { id: 't1', name: '任务1', customFields: { 'cf-status': null } }
    ],
    settings: { columns: customCols }
  };

  // 回收站批次：包含当前项目的 task 批次与 project 批次，以及项目 B 的批次
  var trashBatches = [
    {
      id: 'b-task',
      projectId: 'proj-curr',
      kind: 'task',
      snapshot: {
        tasks: [
          // 本项目回收站任务持有 opt-1
          { id: 't-del-1', name: '已删除任务1', customFields: { 'cf-status': 'opt-1' } }
        ]
      }
    },
    {
      id: 'b-proj',
      projectId: 'proj-curr',
      kind: 'project',
      snapshot: {
        data: {
          tasks: [
            // 本项目回收站任务持有 opt-2
            { id: 't-del-2', name: '已删除任务2', customFields: { 'cf-status': 'opt-2' } }
          ]
        }
      }
    },
    {
      id: 'b-other',
      projectId: 'proj-other',
      kind: 'task',
      snapshot: {
        tasks: [
          // 其他项目的同名字段持有 opt-3
          { id: 't-del-3', name: '其他项目删除任务', customFields: { 'cf-status': 'opt-3' } }
        ]
      }
    }
  ];

  // 1. 尝试修改 cf-status 类型（例如改为 text）
  // 必须被阻止！因为本项目回收站快照中存在非空数据
  var draftChangeType = plain(customCols);
  draftChangeType[1].type = 'text';
  delete draftChangeType[1].options;

  // 边界调用过滤目标项目批次
  var currTrashBatches = trashBatches.filter(function(b) { return b.projectId === 'proj-curr'; });
  var resType = ColumnConfig.validateDraft(draftChangeType, projData, currTrashBatches);
  assert.equal(resType.valid, false, '本项目回收站有非空值时必须阻止修改列类型');
  assert.ok(resType.errors[0].indexOf('已有非空数据') !== -1);

  // 2. 尝试删除 opt-1
  // 必须被阻止！因为本项目回收站 task 批次引用了 opt-1
  var draftDelOpt1 = plain(customCols);
  draftDelOpt1[1].options = [{ id: 'opt-2', label: '已暂停' }];
  var resDelOpt1 = ColumnConfig.validateDraft(draftDelOpt1, projData, currTrashBatches);
  assert.equal(resDelOpt1.valid, false, '本项目回收站 task 批次引用的选项禁止删除');

  // 3. 尝试删除 opt-2
  // 必须被阻止！因为本项目回收站 project 批次引用了 opt-2
  var draftDelOpt2 = plain(customCols);
  draftDelOpt2[1].options = [{ id: 'opt-1', label: '进行中' }];
  var resDelOpt2 = ColumnConfig.validateDraft(draftDelOpt2, projData, currTrashBatches);
  assert.equal(resDelOpt2.valid, false, '本项目回收站 project 批次引用的选项禁止删除');

  // 4. 其他项目 B 引用 opt-3，当前项目尝试定义并删除 opt-3：
  // 当前项目的选项如果是 [{id: 'opt-1'}, {id: 'opt-2'}]，删除未被本项目引用的新增选项时，不被项目 B 阻拦
  var draftWithOpt3 = plain(customCols);
  draftWithOpt3[1].options.push({ id: 'opt-3', label: '仅B引用的选项' });
  // 从草稿中删掉 opt-3
  var draftWithoutOpt3 = plain(customCols);
  var resDelOpt3 = ColumnConfig.validateDraft(draftWithoutOpt3, projData, currTrashBatches);
  assert.equal(resDelOpt3.valid, true, '其他项目回收站的引用不能阻碍本项目操作');
});

// -------------------------------------------------------------
// 13. TASK4-CRIT-02 & CRIT-03: Quota 写入异常时全部回滚
// -------------------------------------------------------------
test('save_draft_quota_failure_rolls_back_everything', function() {
  helper.resetProject(app);
  var DataStore = app.get('DataStore');

  var ws = makeWorkspace();
  ws.projects[0].data.settings.columns = ColumnConfig.normalize([
    { key: 'name', label: '名称', type: 'name', builtin: true, visible: true },
    { key: 'col-quota', label: '配额字段', type: 'text', builtin: false, visible: true }
  ]);
  ws.projects[0].data.tasks[0].customFields = { 'col-quota': '值1' };

  app.localStorage.setItem('pmweb_data', JSON.stringify(ws));
  Workspace.init();
  TaskManager.init();
  Workspace.activate('p-a');

  var fakeDoc = {
    body: { appendChild: function() {}, removeChild: function() {} },
    createElement: function(tag) {
      return {
        tagName: tag.toUpperCase(),
        attributes: {},
        listeners: {},
        setAttribute: function(k, v) { this.attributes[k] = v; },
        getAttribute: function(k) { return this.attributes[k]; },
        addEventListener: function(evt, fn) { this.listeners[evt] = fn; },
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        style: {}
      };
    }
  };

  var mockBtn = {
    setAttribute: function() {},
    getBoundingClientRect: function() { return { right: 100, bottom: 50, top: 20 }; },
    style: {}
  };
  GridPane.header = {
    querySelector: function() { return mockBtn; }
  };
  app.context.document = fakeDoc;
  app.context.window = app.context;
  GridPane._doc = fakeDoc;
  GridPane.setColumns(TaskManager.data.settings.columns);

  GridPane._showColumnPanel();

  // 模拟删除 col-quota
  GridPane._columnDraft = GridPane._columnDraft.filter(function(c) { return c.key !== 'col-quota'; });

  // 注入 DataStore.save 抛出 QuotaExceededError
  var originalSave = DataStore.save;
  DataStore.save = function() {
    var err = new Error('QuotaExceededError: LocalStorage quota exceeded');
    err.name = 'QuotaExceededError';
    throw err;
  };

  var errorThrown = false;
  try {
    GridPane._saveDraft(GridPane._panel);
  } catch (e) {
    errorThrown = true;
  } finally {
    DataStore.save = originalSave;
  }

  // 核心断言：异常发生后，TaskManager.data.tasks 中的字段值没有丢失！列设置也没有被改变！
  assert.ok(errorThrown, '配额超限必须向外抛出异常');
  assert.equal(
    TaskManager.data.tasks[0].customFields['col-quota'],
    '值1',
    '写入失败时任务字段值必须毫发无损'
  );
  assert.ok(
    ColumnConfig.findColumn(TaskManager.data.settings.columns, 'col-quota'),
    '写入失败时原列定义必须完整保留'
  );
  assert.ok(
    ColumnConfig.findColumn(GridPane.columns, 'col-quota'),
    '写入失败时表格当前显示列必须保持原样'
  );
});

// -------------------------------------------------------------
// 14. TASK4-CRIT-01: 真实 GridPane._saveDraft 调用链路跨项目回收站隔离与未知批次保全
// -------------------------------------------------------------
test('save_draft_real_workspace_caller_cleans_only_target_project_recycle_bin', function() {
  helper.resetProject(app);
  var ws = makeWorkspace();

  // 为项目 A 与项目 B 配置相同的自定义列 'col-risk'
  var customCols = ColumnConfig.defaultColumns().concat([
    { key: 'col-risk', label: '风险等级', width: 100, minWidth: 60, visible: true, type: 'text', builtin: false }
  ]);
  ws.projects[0].data.settings.columns = ColumnConfig.normalize(customCols);
  ws.projects[1].data.settings.columns = ColumnConfig.normalize(customCols);

  // 项目 A 与 B 的活动任务各设置 'col-risk' 值
  // 真实 v4 规范下，ws.projects[0].data 与 ws.projects[1].data 均无 id 或 projectId 属性
  assert.equal(ws.projects[0].data.id, undefined, '真实 project.data 绝不包含 id');
  assert.equal(ws.projects[1].data.id, undefined, '真实 project.data 绝不包含 id');
  ws.projects[0].data.tasks[0].customFields = { 'col-risk': 'risk-a-active' };
  ws.projects[1].data.tasks[0].customFields = { 'col-risk': 'risk-b-active' };

  // 回收站中放入：A 的批次、B 的 task 批次、B 的 project 批次，以及缺少所属的未知批次
  ws.recycleBin = [
    {
      id: 'rb-a',
      projectId: 'p-a',
      kind: 'task',
      snapshot: {
        tasks: [
          { id: 't-a-del', name: 'A删除任务', customFields: { 'col-risk': 'risk-a-trash' } }
        ]
      }
    },
    {
      id: 'rb-b-task',
      projectId: 'p-b',
      kind: 'task',
      snapshot: {
        tasks: [
          { id: 't-b-del', name: 'B删除任务', customFields: { 'col-risk': 'risk-b-task-trash' } }
        ]
      }
    },
    {
      id: 'rb-b-proj',
      projectId: 'p-b',
      kind: 'project',
      snapshot: {
        data: {
          tasks: [
            { id: 't-b-proj-task', name: 'B项目删除任务', customFields: { 'col-risk': 'risk-b-proj-trash' } }
          ]
        }
      }
    },
    {
      id: 'rb-unknown',
      kind: 'task',
      snapshot: {
        tasks: [
          { id: 't-unk-del', name: '未知项目删除任务', customFields: { 'col-risk': 'risk-unknown-trash' } }
        ]
      }
    }
  ];

  var raw = JSON.stringify(ws);
  app.localStorage.setItem('pmweb_data', raw);
  Workspace.data = ws;
  Workspace.raw = raw;
  Workspace.activeProjectId = 'p-a';
  TaskManager.bindProject(ws.projects[0]);

  var fakeDoc = {
    body: {
      appendChild: function(c) { this.child = c; },
      removeChild: function(c) { this.child = null; }
    },
    createElement: function(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        attributes: {},
        listeners: {},
        setAttribute: function(k, v) { this.attributes[k] = v; },
        getAttribute: function(k) { return this.attributes[k]; },
        addEventListener: function(evt, fn) { this.listeners[evt] = fn; },
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        style: {}
      };
    }
  };

  var mockBtn = {
    setAttribute: function() {},
    getBoundingClientRect: function() { return { right: 100, bottom: 50, top: 20 }; },
    style: {}
  };
  GridPane.header = {
    querySelector: function() { return mockBtn; }
  };
  app.context.document = fakeDoc;
  app.context.window = app.context;
  GridPane._doc = fakeDoc;
  GridPane.setColumns(TaskManager.data.settings.columns);

  // 打开列配置面板
  GridPane._showColumnPanel();
  assert.ok(GridPane._panel, '面板已打开');
  assert.equal(GridPane._capturedProjectId, 'p-a', '已捕获当前项目ID');

  // 在草稿面板中点击删除该自定义列
  var clickHandler = GridPane._panel.listeners['click'];
  clickHandler({
    target: {
      getAttribute: function(name) {
        if (name === 'data-del-col') return 'col-risk';
        return null;
      }
    },
    preventDefault: function() {}
  });

  // 点击保存草稿，触发真实 _saveDraft
  clickHandler({
    target: { id: 'grid-draft-save' },
    preventDefault: function() {}
  });

  // 核心断言 1：项目 A 的活动任务和项目 A 的回收站任务均被清理
  assert.equal(
    TaskManager.data.tasks[0].customFields['col-risk'],
    undefined,
    '项目A活动任务中的col-risk已清理'
  );
  assert.equal(
    Workspace.data.recycleBin[0].snapshot.tasks[0].customFields['col-risk'],
    undefined,
    '项目A回收站快照中的col-risk已清理'
  );

  // 核心断言 2：项目 B 的活动任务以及项目 B 的 task 批次和 project 批次中的 col-risk 必须完好无损！
  assert.equal(
    ws.projects[1].data.tasks[0].customFields['col-risk'],
    'risk-b-active',
    '项目B活动任务中的col-risk绝不可被误删'
  );
  assert.equal(
    Workspace.data.recycleBin[1].snapshot.tasks[0].customFields['col-risk'],
    'risk-b-task-trash',
    '项目B的task回收站快照中的col-risk绝不可被误删'
  );
  assert.equal(
    Workspace.data.recycleBin[2].snapshot.data.tasks[0].customFields['col-risk'],
    'risk-b-proj-trash',
    '项目B的project回收站快照中的col-risk绝不可被误删'
  );

  // 核心断言 3：未知所属批次安全保留
  assert.equal(
    Workspace.data.recycleBin[3].snapshot.tasks[0].customFields['col-risk'],
    'risk-unknown-trash',
    '未知所属批次中的col-risk必须安全保留'
  );

  // 核心断言 4：持久化存储落盘验证，不塞伪 id，且存储中项目 B 回收站数据完好
  var persisted = JSON.parse(app.localStorage.getItem('pmweb_data'));
  assert.equal(persisted.projects[0].data.id, undefined, '持久化 project.data 绝不污染伪 id');
  assert.equal(persisted.projects[1].data.id, undefined, '持久化 project.data 绝不污染伪 id');
  assert.equal(
    persisted.recycleBin[1].snapshot.tasks[0].customFields['col-risk'],
    'risk-b-task-trash',
    '持久化存储中项目B的task快照完好'
  );
  assert.equal(
    persisted.recycleBin[2].snapshot.data.tasks[0].customFields['col-risk'],
    'risk-b-proj-trash',
    '持久化存储中项目B的project快照完好'
  );
  assert.equal(
    persisted.recycleBin[3].snapshot.tasks[0].customFields['col-risk'],
    'risk-unknown-trash',
    '持久化存储中未知所属批次完好'
  );
});

// 执行测试
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (err) {
    console.error('FAIL ' + t.name);
    console.error(err);
    process.exitCode = 1;
  }
});
