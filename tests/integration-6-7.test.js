'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');

// 真实 index.html 脚本顺序清单
var INDEX_SCRIPTS = [
  'date.js',
  'validate.js',
  'store.js',
  'workspace.js',
  'recycle-bin.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'resources.js',
  'holiday-source.js',
  'work-calendar.js',
  'task-manager.js',
  'row-model.js',
  'views.js',
  'modal.js',
  'tree-view.js',
  'gantt-view.js',
  'drag-manager.js',
  'calendar-view.js',
  'column-config.js',
  'cell-editor.js',
  'progress.js',
  'export.js',
  'baseline.js',
  'grid-pane.js',
  'links.js',
  'scheduler.js',
  'critical-path.js',
  'arrows.js',
  'timeline-pane.js',
  'workbench.js',
  'sync.js',
  'sync-queue.js',
  'realtime.js',
  'sync-ui.js',
  'share.js',
  'project-ui.js',
  'recycle-bin-ui.js',
  'app.js'
];

function createHarness(options) {
  options = options || {};
  var domStub = require('./helpers/dom-stub');
  var doc = domStub.createDocument();

  var modalOverlay = doc.createElement('div'); modalOverlay.id = 'modal-overlay'; doc.body.appendChild(modalOverlay);
  var modalBox = doc.createElement('div'); modalBox.id = 'modal-box'; modalOverlay.appendChild(modalBox);

  var toolbar = doc.createElement('div'); toolbar.id = 'toolbar'; doc.body.appendChild(toolbar);
  var btnAdd = doc.createElement('button'); btnAdd.id = 'btn-add-root-task'; toolbar.appendChild(btnAdd);
  var btnProj = doc.createElement('button'); btnProj.id = 'btn-project-select'; toolbar.appendChild(btnProj);
  var treeContainer = doc.createElement('div'); treeContainer.id = 'tree-container'; doc.body.appendChild(treeContainer);
  var contextMenu = doc.createElement('div'); contextMenu.id = 'context-menu'; doc.body.appendChild(contextMenu);
  var calPanel = doc.createElement('div'); calPanel.id = 'calendar-panel'; doc.body.appendChild(calPanel);
  var tlBody = doc.createElement('div'); tlBody.id = 'timeline-body'; doc.body.appendChild(tlBody);
  var statusText = doc.createElement('div'); statusText.id = 'status-text'; doc.body.appendChild(statusText);
  var statusInfo = doc.createElement('div'); statusInfo.id = 'status-info'; doc.body.appendChild(statusInfo);

  var localStorage = {
    _store: {},
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null;
    },
    setItem: function(key, val) { this._store[key] = String(val); },
    removeItem: function(key) { delete this._store[key]; }
  };

  var alerts = [];
  var context = vm.createContext({
    console: console,
    alert: function(msg) { alerts.push(msg); },
    confirm: function() { return true; },
    localStorage: localStorage,
    document: doc,
    window: {
      location: { origin: 'http://localhost' },
      addEventListener: function() {},
      removeEventListener: function() {}
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval
  });

  INDEX_SCRIPTS.forEach(function(file) {
    var abs = path.join(ROOT, 'js', file);
    var code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, context, { filename: abs });
  });

  return {
    context: context,
    doc: doc,
    alerts: alerts,
    localStorage: localStorage,
    get: function(name) { return vm.runInContext(name, context); },
    run: function(code) { return vm.runInContext(code, context); }
  };
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// 1. 按 index.html 真实顺序加载并成功初始化
test('index 真实脚本顺序完整加载并初始化 App / Workspace / TaskManager / RecycleBinUI', function() {
  var h = createHarness();
  var App = h.get('App');
  var Workspace = h.get('Workspace');
  var TaskManager = h.get('TaskManager');
  var RecycleBin = h.get('RecycleBin');
  var RecycleBinUI = h.get('RecycleBinUI');
  var HolidaySource = h.get('HolidaySource');
  var WorkCalendar = h.get('WorkCalendar');

  assert.ok(App, 'App 必须已加载');
  assert.ok(Workspace, 'Workspace 必须已加载');
  assert.ok(TaskManager, 'TaskManager 必须已加载');
  assert.ok(RecycleBin, 'RecycleBin 必须已加载');
  assert.ok(RecycleBinUI, 'RecycleBinUI 必须已加载');
  assert.ok(HolidaySource, 'HolidaySource 必须已加载');
  assert.ok(WorkCalendar, 'WorkCalendar 必须已加载');

  assert.strictEqual(typeof App.openRecycleBin, 'function', 'App.openRecycleBin 必须作为公开方法挂载');

  // 初始化验证
  assert.doesNotThrow(function() {
    App.init();
  }, 'App.init 不得抛错');
});

// 2. TaskManager calendarOverrides 结构解析与周规则合并兼容
test('TaskManager._workCalendarRaw 正确解析并合并 calendarOverrides 与旧 settings.workCalendar', function() {
  var h = createHarness();
  var TaskManager = h.get('TaskManager');
  var WorkCalendar = h.get('WorkCalendar');

  // a) 仅旧 settings.workCalendar：平滑兼容
  TaskManager.data = {
    settings: {
      workCalendar: { weekends: [5, 6], holidays: ['2026-01-01'], workdays: [] }
    }
  };
  var rawA = TaskManager._workCalendarRaw();
  assert.ok(rawA, '应返回有效日历配置');
  assert.deepStrictEqual(rawA.weekends, [5, 6]);
  assert.deepStrictEqual(rawA.holidays, ['2026-01-01']);

  // b) 存在 calendarOverrides 且覆盖节假日，无 weekends 时继承 workCalendar 的周规则 [5, 6]
  TaskManager.data = {
    settings: {
      workCalendar: { weekends: [5, 6], holidays: ['2026-01-01'], workdays: [] },
      calendarOverrides: { holidays: ['2026-05-01'], workdays: ['2026-05-09'] }
    }
  };
  var rawB = TaskManager._workCalendarRaw();
  assert.deepStrictEqual(rawB.weekends, [5, 6], '应保留 workCalendar 的周规则');
  var cfgB = WorkCalendar.createConfig(rawB);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-05-01', cfgB), false, '2026-05-01 必须为休息日');
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-05-09', cfgB), true, '2026-05-09 补班日必须为工作日');

  // c) calendarOverrides 采用嵌套结构 (TASK6-MINR03)
  TaskManager.data = {
    settings: {
      calendarOverrides: {
        calendarOverrides: {
          weekends: [0, 6],
          holidays: ['2026-10-01'],
          workdays: []
        }
      }
    }
  };
  var rawC = TaskManager._workCalendarRaw();
  assert.ok(rawC, '嵌套结构应被正确解包');
  assert.deepStrictEqual(rawC.weekends, [0, 6]);
  assert.ok(rawC.holidays.indexOf('2026-10-01') !== -1);

  // d) calendarOverrides 采用字典键名形式
  TaskManager.data = {
    settings: {
      calendarOverrides: {
        '2026-01-01': false,
        '2026-01-04': true
      }
    }
  };
  var rawD = TaskManager._workCalendarRaw();
  assert.ok(rawD, '字典结构应被正确解析');
  assert.ok(rawD.holidays.indexOf('2026-01-01') !== -1);
  assert.ok(rawD.workdays.indexOf('2026-01-04') !== -1);
});

// 2.1 INT67-IMPT-01: workCalendar 与 calendarOverrides 冲突覆盖消除并保证视图模型口径一致
test('INT67-IMPT-01: TaskManager._workCalendarRaw 解决 workCalendar 与 calendarOverrides 冲突覆盖消除', function() {
  var h = createHarness();
  var TaskManager = h.get('TaskManager');
  var WorkCalendar = h.get('WorkCalendar');
  var HolidaySource = h.get('HolidaySource');

  // 场景 1: 旧 workdays 补班 vs 新 overrides.holidays 节假日
  // 验证 override holiday 必须消除 legacy workday，且模型层与视图层均判定为非工作日
  TaskManager.data = {
    settings: {
      workCalendar: { weekends: [0, 6], holidays: [], workdays: ['2026-05-02'] },
      calendarOverrides: { holidays: ['2026-05-02'], workdays: [] }
    }
  };
  var raw1 = TaskManager._workCalendarRaw();
  assert.ok(raw1, '必须返回配置');
  assert.strictEqual(raw1.workdays.indexOf('2026-05-02'), -1, '旧 workdays 中的 2026-05-02 必须被 overrides.holidays 消除');
  assert.ok(raw1.holidays.indexOf('2026-05-02') !== -1, 'holidays 必须包含 2026-05-02');
  var cfg1 = WorkCalendar.createConfig(raw1);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-05-02', cfg1), false, '模型层判定 2026-05-02 必须为非工作日');
  var view1 = HolidaySource.resolveDate('2026-05-02', null, TaskManager.data.settings.calendarOverrides);
  assert.strictEqual(view1.working, false, '视图层判定 2026-05-02 为非工作日');
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-05-02', cfg1), view1.working, '模型与视图口径必须完全一致');

  // 场景 2: 旧 holidays 节假日 vs 新 overrides.workdays 补班
  // 验证 override workday 必须消除 legacy holiday，且模型层与视图层均判定为工作日
  TaskManager.data = {
    settings: {
      workCalendar: { weekends: [0, 6], holidays: ['2026-01-01'], workdays: [] },
      calendarOverrides: { holidays: [], workdays: ['2026-01-01'] }
    }
  };
  var raw2 = TaskManager._workCalendarRaw();
  assert.ok(raw2, '必须返回配置');
  assert.strictEqual(raw2.holidays.indexOf('2026-01-01'), -1, '旧 holidays 中的 2026-01-01 必须被 overrides.workdays 消除');
  assert.ok(raw2.workdays.indexOf('2026-01-01') !== -1, 'workdays 必须包含 2026-01-01');
  var cfg2 = WorkCalendar.createConfig(raw2);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-01', cfg2), true, '模型层判定 2026-01-01 必须为工作日');
  var view2 = HolidaySource.resolveDate('2026-01-01', null, TaskManager.data.settings.calendarOverrides);
  assert.strictEqual(view2.working, true, '视图层判定 2026-01-01 为工作日');
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-01', cfg2), view2.working, '模型与视图口径必须完全一致');

  // 场景 3: 字典形式 overrides 消除旧冲突
  TaskManager.data = {
    settings: {
      workCalendar: { weekends: [0, 6], holidays: [], workdays: ['2026-05-02'] },
      calendarOverrides: { '2026-05-02': false }
    }
  };
  var raw3 = TaskManager._workCalendarRaw();
  assert.strictEqual(raw3.workdays.indexOf('2026-05-02'), -1, '字典形式假期必须消除旧 workdays');
  assert.ok(raw3.holidays.indexOf('2026-05-02') !== -1, 'holidays 包含 2026-05-02');
  var cfg3 = WorkCalendar.createConfig(raw3);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-05-02', cfg3), false, '字典形式假期模型层判定必须为非工作日');

  // 场景 4: 数组对象形式 overrides 消除旧冲突
  TaskManager.data = {
    settings: {
      workCalendar: { weekends: [0, 6], holidays: ['2026-01-01'], workdays: [] },
      calendarOverrides: [{ date: '2026-01-01', working: true }]
    }
  };
  var raw4 = TaskManager._workCalendarRaw();
  assert.strictEqual(raw4.holidays.indexOf('2026-01-01'), -1, '数组对象形式补班必须消除旧 holidays');
  assert.ok(raw4.workdays.indexOf('2026-01-01') !== -1, 'workdays 包含 2026-01-01');
  var cfg4 = WorkCalendar.createConfig(raw4);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-01-01', cfg4), true, '数组对象形式补班模型层判定必须为工作日');

  // 场景 5: 无冲突的旧配置与周末规则保持平滑继承与去重
  TaskManager.data = {
    settings: {
      workCalendar: { weekends: [5, 6], holidays: ['2026-10-01'], workdays: ['2026-10-10'] },
      calendarOverrides: { holidays: ['2026-10-02'], workdays: ['2026-10-11'] }
    }
  };
  var raw5 = TaskManager._workCalendarRaw();
  assert.deepStrictEqual(raw5.weekends, [5, 6], '周末规则完整继承');
  assert.ok(raw5.holidays.indexOf('2026-10-01') !== -1 && raw5.holidays.indexOf('2026-10-02') !== -1, '无冲突旧假期与新假期均保留');
  assert.ok(raw5.workdays.indexOf('2026-10-10') !== -1 && raw5.workdays.indexOf('2026-10-11') !== -1, '无冲突旧补班与新补班均保留');
});

// 3. 两项功能同时工作：日历权重与回收站删除/撤销/恢复共存
test('日历例外与回收站删除/撤销/恢复协同工作', function() {
  var h = createHarness();
  var Workspace = h.get('Workspace');
  var TaskManager = h.get('TaskManager');
  var RecycleBin = h.get('RecycleBin');
  var WorkCalendar = h.get('WorkCalendar');

  Workspace.init();
  var proj = Workspace.createProject({ name: '日历协同项目' });
  Workspace.activate(proj.id);

  // 配置项目日历例外：2026-05-01 节假日，2026-05-02 (周六) 赶工补班
  proj.data.settings.calendarOverrides = {
    weekends: [0, 6],
    holidays: ['2026-05-01'],
    workdays: ['2026-05-02']
  };
  TaskManager.bindProject(proj);

  var task = TaskManager.addTask(null, '赶工任务');
  TaskManager.updateTask(task.id, {
    startDate: '2026-05-01',
    endDate: '2026-05-03'
  });
  task = TaskManager.getTask(task.id);

  // 验证工作日权重：05-01 假(0), 05-02 班(1), 05-03 周日(0) => 权重 1
  var weight = TaskManager.taskDurationWeight(task);
  assert.strictEqual(weight, 1, 'taskDurationWeight 计算必须考虑日历例外');

  // 回收站删除任务
  var originalTaskId = task.id;
  TaskManager.deleteTask(originalTaskId);
  assert.strictEqual(TaskManager.getTask(originalTaskId), null, '任务应已被删除');
  assert.strictEqual(Workspace.data.recycleBin.length, 1, '回收站应有 1 个删除批次');

  // 撤销删除
  TaskManager.undo();
  var restored = TaskManager.getTask(originalTaskId);
  assert.ok(restored, '撤销后任务应恢复');
  assert.strictEqual(restored.startDate, '2026-05-01', '任务起始日期不受影响');
  assert.strictEqual(TaskManager.taskDurationWeight(restored), 1, '恢复后工作日权重保持一致');
});

// 4. 日历异步刷新与回收站操作并发写不互相覆盖
test('HolidaySource 异步刷新与 RecycleBin 操作并发写不覆盖彼此数据', function() {
  var h = createHarness();
  var Workspace = h.get('Workspace');
  var TaskManager = h.get('TaskManager');
  var HolidaySource = h.get('HolidaySource');

  Workspace.init();
  var proj = Workspace.createProject({ name: '并发测试项目' });
  Workspace.activate(proj.id);

  var task = TaskManager.addTask(null, '待删任务');
  var taskId = task.id;

  var mockJson = JSON.stringify({
    year: 2026,
    region: 'CN',
    papers: ['国办发明电〔2025〕X号'],
    dates: [{ date: '2026-01-01', name: '元旦', type: 'public_holiday' }]
  });

  var fetchResolver;
  var fetchDeferred = new Promise(function(resolve) {
    fetchResolver = resolve;
  });
  var customFetch = function() {
    return fetchDeferred.then(function() {
      return {
        ok: true,
        status: 200,
        text: function() { return Promise.resolve(mockJson); }
      };
    });
  };

  // 1. 发起异步节假日刷新 (处于 in-flight 状态)
  var refreshPromise = HolidaySource.refresh(2026, {
    fetch: customFetch,
    force: true
  });

  // 2. 在网络等待期间，用户执行回收站删除任务
  TaskManager.deleteTask(taskId);
  assert.strictEqual(TaskManager.getTask(taskId), null);
  assert.strictEqual(Workspace.data.recycleBin.length, 1, '回收站写入必须已提交');

  // 3. 网络返回，异步刷新完成提交
  fetchResolver();
  return refreshPromise.then(function() {
    // 验证：工作区同时拥有节假日缓存 与 回收站删除记录
    var wsData = Workspace.data;
    assert.ok(wsData.calendar.cacheByYear[2026], '节假日缓存必须成功写入');
    assert.strictEqual(wsData.recycleBin.length, 1, '并发提交不得覆盖回收站批次');
    assert.strictEqual(wsData.recycleBin[0].kind, 'task');
    assert.strictEqual(wsData.recycleBin[0].snapshot.rootTaskId, taskId);
  });
});

// 5. 删除当前激活项目与回收站兼容性
test('删除当前激活项目后进入回收站且 TaskManager 安全置空', function() {
  var h = createHarness();
  var Workspace = h.get('Workspace');
  var TaskManager = h.get('TaskManager');
  var RecycleBin = h.get('RecycleBin');

  Workspace.init();
  var proj = Workspace.createProject({ name: '待删项目' });
  Workspace.activate(proj.id);
  TaskManager.addTask(null, '项目任务');

  assert.strictEqual(Workspace.activeProjectId, proj.id);
  assert.ok(TaskManager.data);

  // 删除当前项目
  var batchId = Workspace.deleteProject(proj.id);
  assert.ok(batchId, '应返回批次 ID');
  assert.strictEqual(Workspace.activeProjectId, null, '激活项目应置为 null');
  assert.strictEqual(TaskManager.data, null, 'TaskManager 数据应置空');

  // 确认 TaskManager 处于只读/未绑定安全状态
  assert.throws(function() {
    TaskManager.addTask(null, '不可写入');
  }, /当前无项目或未选中项目，不可写入|未绑定项目/);

  // 从回收站恢复项目
  var restoredWs = RecycleBin.restore(Workspace.data, batchId, { acceptWarnings: true });
  Workspace.commit(restoredWs);
  Workspace.activate(proj.id);

  assert.strictEqual(Workspace.activeProjectId, proj.id);
  var tasks = TaskManager.getAllTasks();
  assert.strictEqual(tasks.length, 1, '恢复项目后任务完整保留');
  assert.strictEqual(tasks[0].name, '项目任务');
});

// 6. 节假日订阅/导入/例外操作绝不自动修改任务日期
test('节假日订阅刷新、导入与项目例外修改不改动任何任务的 startDate 与 endDate', function() {
  var h = createHarness();
  var Workspace = h.get('Workspace');
  var TaskManager = h.get('TaskManager');
  var HolidaySource = h.get('HolidaySource');
  var WorkCalendar = h.get('WorkCalendar');

  Workspace.init();
  var proj = Workspace.createProject({ name: '日期不可变项目' });
  Workspace.activate(proj.id);

  var task = TaskManager.addTask(null, '固定排期任务');
  TaskManager.updateTask(task.id, {
    startDate: '2026-05-01',
    endDate: '2026-05-05'
  });
  task = TaskManager.getTask(task.id);

  var origStart = task.startDate;
  var origEnd = task.endDate;

  // 1. 模拟导入节假日
  var annualData = JSON.stringify({
    year: 2026,
    region: 'CN',
    dates: [{ date: '2026-05-01', name: '劳动节', type: 'public_holiday' }]
  });
  var nextCal = HolidaySource.importAnnual(Workspace.data.calendar, annualData);
  var nextWs = JSON.parse(JSON.stringify(Workspace.data));
  nextWs.calendar = nextCal;
  Workspace.commit(nextWs);

  // 2. 模拟保存项目例外
  HolidaySource.saveProjectCalendarOverrides(proj.id, {
    holidays: ['2026-05-01', '2026-05-02'],
    workdays: ['2026-05-03']
  });
  Workspace.activate(proj.id);

  // 3. 计算排期权重与行进度
  var weight = TaskManager.taskDurationWeight(task);
  assert.ok(weight >= 1);
  TaskManager.computeRowProgress([task]);

  // 验证日期字段绝对保持不变
  var currentTask = TaskManager.getTask(task.id);
  assert.strictEqual(currentTask.startDate, origStart, '任务开始日期禁止被篡改');
  assert.strictEqual(currentTask.endDate, origEnd, '任务结束日期禁止被篡改');
});

var failures = 0;
var runIndex = 0;
function runNext() {
  if (runIndex >= tests.length) {
    console.log('\nintegration-6-7: ' + (tests.length - failures) + '/' + tests.length + ' passed');
    process.exit(failures > 0 ? 1 : 0);
  }
  var t = tests[runIndex++];
  try {
    var res = t.fn();
    if (res && typeof res.then === 'function') {
      res.then(function() {
        console.log('PASS ' + t.name);
        runNext();
      }).catch(function(err) {
        console.log('FAIL ' + t.name);
        console.error(err);
        failures++;
        runNext();
      });
    } else {
      console.log('PASS ' + t.name);
      runNext();
    }
  } catch (err) {
    console.log('FAIL ' + t.name);
    console.error(err);
    failures++;
    runNext();
  }
}

runNext();
