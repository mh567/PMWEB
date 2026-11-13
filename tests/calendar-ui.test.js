'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'holiday-source.js',
  'work-calendar.js',
  'progress.js',
  'baseline.js',
  'links.js',
  'task-manager.js',
  'modal.js'
]);

var TaskManager = app.get('TaskManager');
var WorkCalendar = app.get('WorkCalendar');
var Progress = app.get('Progress');
var ModalManager = app.get('ModalManager');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeTask(id, parentId, order, startDate, endDate, progress) {
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
    progress: progress === undefined ? 50 : progress,
    plannedEndDate: endDate,
    order: order,
    ganttRow: null
  };
}

function progressData(workCalendar) {
  var settings = {};
  if (workCalendar !== undefined) settings.workCalendar = workCalendar;
  return {
    pmweb_version: 3,
    tasks: [
      makeTask('P', null, 0, '2026-01-01', '2026-01-05', 0),
      makeTask('A', 'P', 0, '2026-01-01', '2026-01-05', 0),
      makeTask('B', 'P', 1, '2026-01-05', '2026-01-05', 100)
    ],
    milestones: [],
    links: [],
    views: [],
    settings: settings
  };
}

function summaryRow() {
  return {
    id: 'P',
    task: TaskManager.getTask('P'),
    depth: 0,
    hasChildren: true,
    isCollapsed: false,
    isSummary: true,
    childCount: 2,
    startDate: '2026-01-01',
    endDate: '2026-01-05'
  };
}

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---- 配置持久化 ----

test('工作日历配置写入 settings 并在重新加载后恢复', function() {
  helper.resetProject(app);

  TaskManager.setWorkCalendar({
    weekends: [5, 6],
    holidays: ['2026-01-05'],
    workdays: ['2026-01-03']
  });

  var stored = JSON.parse(app.localStorage.getItem('pmweb_data'));
  var projectData = stored.projects ? stored.projects[0].data : stored;
  assert.deepStrictEqual(plain(projectData.settings.workCalendar.weekends), [5, 6]);
  assert.deepStrictEqual(plain(projectData.settings.workCalendar.holidays), ['2026-01-05']);

  TaskManager.data = null;
  TaskManager.init();

  var config = TaskManager.getWorkCalendar();
  assert.deepStrictEqual(plain(config.weekends), [5, 6]);
  assert.deepStrictEqual(plain(config.holidays), ['2026-01-05']);
  assert.deepStrictEqual(plain(config.workdays), ['2026-01-03']);
  assert.strictEqual(TaskManager.hasWorkCalendarConfig(), true);
});

test('未配置工作日历时使用默认周末且不启用工作日权重', function() {
  helper.resetProject(app);

  assert.strictEqual(TaskManager.hasWorkCalendarConfig(), false);
  var config = TaskManager.getWorkCalendar();
  assert.deepStrictEqual(plain(config.weekends), [0, 6]);
  assert.deepStrictEqual(plain(config.holidays), []);
  assert.deepStrictEqual(plain(config.workdays), []);
  assert.strictEqual(TaskManager.taskDurationWeight({ startDate: '2026-01-01', endDate: '2026-01-05' }), null);
});

test('非法配置回退到默认值', function() {
  helper.resetProject(app);

  TaskManager.data.settings.workCalendar = 'not-an-object';
  assert.strictEqual(TaskManager.hasWorkCalendarConfig(), false);
  assert.deepStrictEqual(plain(TaskManager.getWorkCalendar().weekends), [0, 6]);

  TaskManager.data.settings.workCalendar = { weekends: 'x', holidays: 7, workdays: {} };
  assert.strictEqual(TaskManager.hasWorkCalendarConfig(), true);
  var config = TaskManager.getWorkCalendar();
  assert.deepStrictEqual(plain(config.weekends), [0, 6]);
  assert.deepStrictEqual(plain(config.holidays), []);
  assert.deepStrictEqual(plain(config.workdays), []);
});

test('setWorkCalendar 返回规范化配置', function() {
  helper.resetProject(app);
  var config = TaskManager.setWorkCalendar({
    weekends: [6, 5, 5, 9],
    holidays: ['2026-01-02', 'bad', '2026-02-30']
  });
  assert.deepStrictEqual(plain(config.weekends), [5, 6]);
  assert.deepStrictEqual(plain(config.holidays), ['2026-01-02']);
});

// ---- 工作日权重进度 ----

test('配置工作日历后进度汇总使用工作日权重', function() {
  helper.installTasks(app, progressData({ weekends: [0, 6], holidays: [], workdays: [] }));

  var weighted = TaskManager.computeRowProgress([summaryRow()]);
  assert.strictEqual(weighted.get('P'), 25);

  var natural = Progress.computeRowProgress([summaryRow()], function(id) {
    return TaskManager.getChildren(id);
  });
  assert.ok(Math.abs(natural.get('P') - 100 / 6) < 1e-9);
  assert.notStrictEqual(weighted.get('P'), natural.get('P'));
});

test('未配置工作日历时进度汇总保持自然日口径', function() {
  helper.installTasks(app, progressData());

  var result = TaskManager.computeRowProgress([summaryRow()]);
  var natural = Progress.computeRowProgress([summaryRow()], function(id) {
    return TaskManager.getChildren(id);
  });
  assert.ok(Math.abs(result.get('P') - natural.get('P')) < 1e-9);
  assert.ok(Math.abs(result.get('P') - 100 / 6) < 1e-9);
});

test('节假日改变工作日权重并影响进度汇总', function() {
  helper.installTasks(app, progressData({
    weekends: [0, 6],
    holidays: ['2026-01-05'],
    workdays: []
  }));

  var result = TaskManager.computeRowProgress([summaryRow()]);
  // A 的工作日从 3 天降为 2 天，B 的 2026-01-05 变成非工作日，权重仍为 1
  assert.strictEqual(result.get('P'), 100 / 3);
});

test('taskDurationWeight 按工作日计算工期', function() {
  helper.installTasks(app, progressData({ weekends: [0, 6], holidays: ['2026-01-02'], workdays: [] }));
  var task = TaskManager.getTask('A');
  assert.strictEqual(TaskManager.taskDurationWeight(task), 2);
});

// ---- 表单输入解析 ----

test('parseCalendarDates 过滤非法日期并去重排序', function() {
  var parsed = ModalManager.parseCalendarDates('2026-01-02\n坏日期, 2026-02-30\n2026-01-01 2026-01-02');
  assert.deepStrictEqual(plain(parsed.dates), ['2026-01-01', '2026-01-02']);
  assert.deepStrictEqual(plain(parsed.invalid), ['坏日期', '2026-02-30']);
});

test('parseCalendarDates 空输入返回空结果', function() {
  var parsed = ModalManager.parseCalendarDates('');
  assert.deepStrictEqual(plain(parsed.dates), []);
  assert.deepStrictEqual(plain(parsed.invalid), []);
  assert.deepStrictEqual(plain(ModalManager.parseCalendarDates(null).dates), []);
});

test('parseCalendarDates 接受逗号和分号分隔', function() {
  var parsed = ModalManager.parseCalendarDates('2026-01-01，2026-01-02;2026-01-03');
  assert.deepStrictEqual(plain(parsed.dates), ['2026-01-01', '2026-01-02', '2026-01-03']);
});

test('工作日历配置不写入撤销历史', function() {
  helper.resetProject(app);
  TaskManager.setWorkCalendar({ weekends: [6] });
  assert.strictEqual(TaskManager.canUndo(), false);
});

test('showWorkCalendarForm 渲染节假日订阅与导入节点且保存时写入 calendarOverrides', function() {
  var domStub = require('./helpers/dom-stub');
  var doc = domStub.createDocument();
  var modalOverlay = domStub.createElement('div');
  modalOverlay.id = 'modal-overlay';
  var modalBox = domStub.createElement('div');
  modalBox.id = 'modal-box';
  modalOverlay.appendChild(modalBox);
  doc.body.appendChild(modalOverlay);

  var testApp = helper.createApp([
    'date.js',
    'store.js',
    'workspace.js',
    'holiday-source.js',
    'work-calendar.js',
    'task-manager.js',
    'modal.js'
  ]);
  testApp.context.document = doc;
  testApp.context.window = { document: doc };

  var tManager = helper.installTasks(testApp, {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  });

  var mManager = testApp.get('ModalManager');
  var ws = testApp.get('Workspace');
  mManager.init();

  var savedOptions = null;
  mManager.showWorkCalendarForm(tManager.getWorkCalendar(), function(opts) {
    savedOptions = opts;
  });

  var subInput = doc.getElementById('modal-calendar-subscribed');
  assert.ok(subInput);
  assert.strictEqual(subInput.checked, true);

  var statusBox = doc.getElementById('modal-calendar-status');
  assert.ok(statusBox);

  var importInput = doc.getElementById('modal-calendar-import-input');
  assert.ok(importInput);

  var holidaysInput = doc.getElementById('modal-calendar-holidays');
  assert.ok(holidaysInput);
  holidaysInput.value = '2026-06-01';

  var workdaysInput = doc.getElementById('modal-calendar-workdays');
  assert.ok(workdaysInput);
  workdaysInput.value = '2026-06-07';

  var saveBtn = doc.getElementById('modal-calendar-save');
  saveBtn.click();

  assert.ok(savedOptions);
  assert.deepStrictEqual(plain(savedOptions.holidays), ['2026-06-01']);
  assert.deepStrictEqual(plain(savedOptions.workdays), ['2026-06-07']);

  var curProj = ws.currentProject();
  assert.ok(curProj);
  assert.ok(curProj.data.settings.calendarOverrides);
  assert.deepStrictEqual(plain(curProj.data.settings.calendarOverrides.holidays), ['2026-06-01']);
});

// ---- TASK6-IMPT-01: 日历弹窗真实 DOM 交互事件调用链测试 ----

test('showWorkCalendarForm: 订阅开关 change 事件更新工作区订阅状态与界面', function() {
  var domStub = require('./helpers/dom-stub');
  var doc = domStub.createDocument();
  var modalOverlay = domStub.createElement('div');
  modalOverlay.id = 'modal-overlay';
  var modalBox = domStub.createElement('div');
  modalBox.id = 'modal-box';
  modalOverlay.appendChild(modalBox);
  doc.body.appendChild(modalOverlay);

  var testApp = helper.createApp([
    'date.js',
    'store.js',
    'workspace.js',
    'holiday-source.js',
    'work-calendar.js',
    'task-manager.js',
    'modal.js'
  ]);
  testApp.context.document = doc;
  testApp.context.window = { document: doc };

  var tManager = helper.installTasks(testApp, {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  });

  var mManager = testApp.get('ModalManager');
  var ws = testApp.get('Workspace');
  mManager.init();

  mManager.showWorkCalendarForm(tManager.getWorkCalendar(), function() {});

  var subInput = doc.getElementById('modal-calendar-subscribed');
  var statusBox = doc.getElementById('modal-calendar-status');
  assert.strictEqual(subInput.checked, true);
  assert.strictEqual(ws.data.calendar.subscribed, true);

  // 派发 change 事件关闭订阅
  subInput.checked = false;
  subInput.dispatchEvent({ type: 'change' });

  assert.strictEqual(ws.data.calendar.subscribed, false, '工作区订阅状态应变更为 false');
  assert.ok(statusBox.textContent.indexOf('已暂停自动同步') !== -1, '状态栏应提示已暂停自动同步');

  // 再次派发 change 事件重新开启订阅
  subInput.checked = true;
  subInput.dispatchEvent({ type: 'change' });

  assert.strictEqual(ws.data.calendar.subscribed, true, '工作区订阅状态应恢复为 true');
  assert.ok(statusBox.textContent.indexOf('订阅正常启用') !== -1, '状态栏应提示订阅正常启用');
});

test('showWorkCalendarForm: 手动刷新按钮 click 事件触发 HolidaySource.refresh 并更新状态', async function() {
  var domStub = require('./helpers/dom-stub');
  var doc = domStub.createDocument();
  var modalOverlay = domStub.createElement('div');
  modalOverlay.id = 'modal-overlay';
  var modalBox = domStub.createElement('div');
  modalBox.id = 'modal-box';
  modalOverlay.appendChild(modalBox);
  doc.body.appendChild(modalOverlay);

  var testApp = helper.createApp([
    'date.js',
    'store.js',
    'workspace.js',
    'holiday-source.js',
    'work-calendar.js',
    'task-manager.js',
    'modal.js'
  ]);
  testApp.context.document = doc;
  testApp.context.window = { document: doc };

  var tManager = helper.installTasks(testApp, {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  });

  var mManager = testApp.get('ModalManager');
  var HolidaySource = testApp.get('HolidaySource');
  var ws = testApp.get('Workspace');
  mManager.init();

  var curYear = new Date().getFullYear();
  var refreshCalls = 0;
  var origRefresh = HolidaySource.refresh;
  HolidaySource.refresh = function(year, opts) {
    refreshCalls++;
    assert.strictEqual(year, curYear);
    assert.strictEqual(opts.force, true);
    var cal = ws.data.calendar;
    cal.cacheByYear[year] = {
      year: year,
      region: 'CN',
      dates: [{ date: year + '-01-01', name: '元旦', type: 'public_holiday' }]
    };
    return Promise.resolve(cal);
  };

  mManager.showWorkCalendarForm(tManager.getWorkCalendar(), function() {});

  var refreshBtn = doc.getElementById('modal-calendar-refresh');
  var statusBox = doc.getElementById('modal-calendar-status');
  assert.ok(refreshBtn);

  refreshBtn.click();
  await new Promise(function(resolve) { setTimeout(resolve, 10); });

  assert.strictEqual(refreshCalls, 1, '应调用一次 HolidaySource.refresh');
  assert.ok(statusBox.textContent.indexOf(String(curYear)) !== -1, '状态区应显示已缓存当前年份');
  HolidaySource.refresh = origRefresh;
});

test('showWorkCalendarForm: 导入校验预览、输入变动重置预览与确认替换导入完整流程', function() {
  var domStub = require('./helpers/dom-stub');
  var doc = domStub.createDocument();
  var modalOverlay = domStub.createElement('div');
  modalOverlay.id = 'modal-overlay';
  var modalBox = domStub.createElement('div');
  modalBox.id = 'modal-box';
  modalOverlay.appendChild(modalBox);
  doc.body.appendChild(modalOverlay);

  var testApp = helper.createApp([
    'date.js',
    'store.js',
    'workspace.js',
    'holiday-source.js',
    'work-calendar.js',
    'task-manager.js',
    'modal.js'
  ]);
  testApp.context.document = doc;
  testApp.context.window = { document: doc };

  var tManager = helper.installTasks(testApp, {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  });

  var mManager = testApp.get('ModalManager');
  var ws = testApp.get('Workspace');
  mManager.init();

  mManager.showWorkCalendarForm(tManager.getWorkCalendar(), function() {});

  var importInput = doc.getElementById('modal-calendar-import-input');
  var previewBtn = doc.getElementById('modal-calendar-import-preview-btn');
  var confirmBtn = doc.getElementById('modal-calendar-import-confirm');
  var previewBox = doc.getElementById('modal-calendar-import-preview');
  var statusBox = doc.getElementById('modal-calendar-status');

  assert.strictEqual(confirmBtn.disabled, true);

  // 1. 输入合法 JSON 并点击校验预览
  var validJson = JSON.stringify({
    year: 2026,
    region: 'CN',
    dates: [
      { date: '2026-01-01', name: '元旦节', type: 'public_holiday' },
      { date: '2026-01-04', name: '元旦补班', type: 'transfer_workday' }
    ]
  });
  importInput.value = validJson;
  previewBtn.click();

  assert.strictEqual(confirmBtn.disabled, false, '合法预览通过后确认按钮应解锁');
  assert.ok(previewBox.textContent.indexOf('已识别 2026 年 CN 数据') !== -1);
  assert.ok(previewBox.textContent.indexOf('1 天节假日') !== -1);
  assert.ok(previewBox.textContent.indexOf('1 天调休补班') !== -1);

  // 2. MINR-02：在预览通过后修改输入框内容，应重置预览并再次禁用确认按钮
  importInput.value = '{"year":2026';
  importInput.dispatchEvent({ type: 'input' });

  assert.strictEqual(confirmBtn.disabled, true, '修改输入内容后确认按钮应重置为禁用');
  assert.strictEqual(previewBox.style.display, 'none', '修改输入内容后预览容器应隐藏');

  // 3. 重新输入合法内容并预览、确认导入
  importInput.value = validJson;
  previewBtn.click();
  assert.strictEqual(confirmBtn.disabled, false);

  confirmBtn.click();

  assert.ok(ws.data.calendar.importedByYear[2026], '工作区应记录 2026 年导入数据');
  assert.strictEqual(ws.data.calendar.importedByYear[2026].dates.length, 2);
  assert.strictEqual(confirmBtn.disabled, true, '导入完成后确认按钮应重新禁用');
  assert.ok(statusBox.textContent.indexOf('2026') !== -1, '状态区应展示已导入 2026 年');
});

test('showWorkCalendarForm: 非法导入数据校验失败提示与确认按钮保持禁用', function() {
  var domStub = require('./helpers/dom-stub');
  var doc = domStub.createDocument();
  var modalOverlay = domStub.createElement('div');
  modalOverlay.id = 'modal-overlay';
  var modalBox = domStub.createElement('div');
  modalBox.id = 'modal-box';
  modalOverlay.appendChild(modalBox);
  doc.body.appendChild(modalOverlay);

  var testApp = helper.createApp([
    'date.js',
    'store.js',
    'workspace.js',
    'holiday-source.js',
    'work-calendar.js',
    'task-manager.js',
    'modal.js'
  ]);
  testApp.context.document = doc;
  testApp.context.window = { document: doc };

  var tManager = helper.installTasks(testApp, {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  });

  var mManager = testApp.get('ModalManager');
  mManager.init();

  mManager.showWorkCalendarForm(tManager.getWorkCalendar(), function() {});

  var importInput = doc.getElementById('modal-calendar-import-input');
  var previewBtn = doc.getElementById('modal-calendar-import-preview-btn');
  var confirmBtn = doc.getElementById('modal-calendar-import-confirm');
  var previewBox = doc.getElementById('modal-calendar-import-preview');

  // 空输入校验
  importInput.value = '   ';
  previewBtn.click();
  assert.strictEqual(confirmBtn.disabled, true);
  assert.ok(previewBox.textContent.indexOf('请输入导入 JSON 内容') !== -1);

  // 非法 JSON 校验
  importInput.value = '{invalid:json}';
  previewBtn.click();
  assert.strictEqual(confirmBtn.disabled, true);
  assert.ok(previewBox.textContent.indexOf('校验失败') !== -1);
});

test('showWorkCalendarForm: 取消按钮点击关闭弹窗且不触发保存回调', function() {
  var domStub = require('./helpers/dom-stub');
  var doc = domStub.createDocument();
  var modalOverlay = domStub.createElement('div');
  modalOverlay.id = 'modal-overlay';
  var modalBox = domStub.createElement('div');
  modalBox.id = 'modal-box';
  modalOverlay.appendChild(modalBox);
  doc.body.appendChild(modalOverlay);

  var testApp = helper.createApp([
    'date.js',
    'store.js',
    'workspace.js',
    'holiday-source.js',
    'work-calendar.js',
    'task-manager.js',
    'modal.js'
  ]);
  testApp.context.document = doc;
  testApp.context.window = { document: doc };

  var tManager = helper.installTasks(testApp, {
    pmweb_version: 3,
    tasks: [],
    milestones: [],
    links: [],
    views: [],
    settings: {}
  });

  var mManager = testApp.get('ModalManager');
  mManager.init();

  var saved = false;
  mManager.showWorkCalendarForm(tManager.getWorkCalendar(), function() {
    saved = true;
  });

  assert.strictEqual(mManager.isOpen(), true);

  doc.getElementById('modal-calendar-holidays').value = '2026-10-01';

  var cancelBtn = doc.getElementById('modal-calendar-cancel');
  assert.ok(cancelBtn, '取消按钮应具有 modal-calendar-cancel id');
  cancelBtn.click();

  assert.strictEqual(mManager.isOpen(), false, '弹窗应已关闭');
  assert.strictEqual(saved, false, '取消操作不应触发保存回调');
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
      console.log('FAIL ' + t.name);
      console.log('  ' + (err && err.message ? err.message : err));
    }
  }

  console.log('\ncalendar-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
  process.exit(failures === 0 ? 0 : 1);
}

run();
