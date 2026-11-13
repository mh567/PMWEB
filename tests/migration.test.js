'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'store.js']);
var DataStore = app.get('DataStore');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function v2Data() {
  return {
    pmweb_version: 2,
    tasks: [
      {
        id: 'done-task', parentId: null, name: 'Done', description: '', assignee: '',
        color: null, startDate: '2026-01-01', endDate: '2026-01-05',
        status: 'done', order: 0, ganttRow: null
      },
      {
        id: 'third-party-task', parentId: null, name: 'Third', description: '', assignee: '',
        color: null, startDate: '2026-02-01', endDate: '2026-02-10',
        status: 'thirdParty', order: 1, ganttRow: null
      },
      {
        id: 'progress-task', parentId: null, name: 'Progress', description: '', assignee: '',
        color: null, startDate: '2026-03-01', endDate: '2026-03-10',
        status: 'inProgress', order: 2, ganttRow: null
      }
    ],
    milestones: [{ id: 'm1', taskId: 'done-task', name: 'M', date: '2026-01-03', status: 'pending' }],
    settings: { lastView: 'gantt', lastGranularity: 'day' }
  };
}

test('v2 到 v3 补齐 progress 默认值', function() {
  var data = DataStore.migrate(v2Data());
  assert.strictEqual(data.pmweb_version, 4);
  var pData = data.projects[0].data;
  assert.strictEqual(pData.pmweb_version, 3);
  assert.strictEqual(pData.tasks[0].progress, 100);
  assert.strictEqual(pData.tasks[1].progress, 30);
  assert.strictEqual(pData.tasks[2].progress, 50);
});

test('v2 到 v3 plannedEndDate 默认等于 endDate', function() {
  var data = DataStore.migrate(v2Data());
  var pData = data.projects[0].data;
  assert.strictEqual(pData.tasks[0].plannedEndDate, '2026-01-05');
  assert.strictEqual(pData.tasks[1].plannedEndDate, '2026-02-10');
  assert.strictEqual(pData.tasks[2].plannedEndDate, '2026-03-10');
});

test('v2 到 v3 补 links、views、gridWidth、layoutVersion、columns', function() {
  var data = DataStore.migrate(v2Data());
  var pData = data.projects[0].data;
  assert.strictEqual(pData.links.length, 0);
  assert.strictEqual(pData.views.length, 0);
  assert.strictEqual(pData.settings.gridWidth, 560);
  assert.strictEqual(pData.settings.layoutVersion, 'workbench');
  assert.strictEqual(pData.settings.columns, null);
  assert.deepStrictEqual(plain(pData.settings.statusFilter), { todo: true, inProgress: true, thirdParty: true, done: true });
});

test('v2 到 v3 不覆盖已有的 progress 和 plannedEndDate', function() {
  var input = v2Data();
  input.tasks[0].progress = 0;
  input.tasks[0].plannedEndDate = null;
  input.tasks[1].progress = 77;
  input.tasks[1].plannedEndDate = '2026-02-20';
  var data = DataStore.migrate(input);
  var pData = data.projects[0].data;
  assert.strictEqual(pData.tasks[0].progress, 0);
  assert.strictEqual(pData.tasks[0].plannedEndDate, null);
  assert.strictEqual(pData.tasks[1].progress, 77);
  assert.strictEqual(pData.tasks[1].plannedEndDate, '2026-02-20');
});

test('v2 到 v3 保留已有设置和用户数据', function() {
  var input = v2Data();
  input.links = [{ id: 'l1', from: 'done-task', to: 'progress-task', type: 'FS' }];
  input.views = [{ id: 'v1', name: '默认视图' }];
  input.settings.gridWidth = 720;
  input.settings.layoutVersion = 'legacy';
  input.settings.statusFilter = { todo: true, inProgress: true, thirdParty: false, done: true };
  var data = DataStore.migrate(input);
  var pData = data.projects[0].data;
  assert.strictEqual(pData.links.length, 1);
  assert.strictEqual(pData.views.length, 1);
  assert.strictEqual(pData.settings.gridWidth, 720);
  assert.strictEqual(pData.settings.layoutVersion, 'legacy');
  assert.deepStrictEqual(plain(pData.settings.statusFilter), { todo: true, inProgress: true, thirdParty: false, done: true });
  assert.strictEqual(pData.tasks[0].name, 'Done');
  assert.strictEqual(pData.milestones.length, 1);
});

test('v1 经 v2 迁移到 v4', function() {
  var v1 = {
    version: 1,
    projects: [{ id: 'p1', name: '项目一', color: '#123456' }],
    tasks: [{
      id: 't1', projectId: 'p1', name: '旧任务', startDate: '2026-01-01',
      endDate: '2026-01-09', status: 'todo', order: 0
    }],
    milestones: []
  };
  var data = DataStore.migrate(v1);
  assert.strictEqual(data.pmweb_version, 4);
  var pData = data.projects[0].data;
  assert.strictEqual(pData.pmweb_version, 3);
  assert.strictEqual(pData.tasks.length, 2);
  pData.tasks.forEach(function(task) {
    assert.strictEqual(typeof task.progress, 'number');
    assert.ok('plannedEndDate' in task);
  });
  assert.strictEqual(pData.links.length, 0);
  assert.strictEqual(pData.views.length, 0);
  assert.strictEqual(pData.settings.layoutVersion, 'workbench');
});

test('createEmpty 生成 v4 结构', function() {
  var data = DataStore.createEmpty();
  assert.strictEqual(data.pmweb_version, 4);
  assert.strictEqual(data.projects.length, 0);
  assert.strictEqual(data.settings.startupMode, 'choose');
  assert.ok(data.calendar);
  assert.ok(Array.isArray(data.recycleBin));
});

test('版本过新时返回空数据并提示', function() {
  app.alerts.length = 0;
  var data = DataStore.migrate({ pmweb_version: 99, tasks: [], settings: {} });
  assert.strictEqual(data.pmweb_version, 4);
  assert.strictEqual(data.projects.length, 0);
  assert.strictEqual(app.alerts.length, 1);
});

test('v1 迁移到 v4 迁入原有项目且顶层版本4嵌套版本3保留todo和扩展字段', function() {
  var v1 = {
    version: 1,
    projects: [{ id: 'p1', name: '旧项目', color: '#123456' }],
    tasks: [{
      id: 't1', projectId: 'p1', name: '旧任务', startDate: '2026-01-01',
      endDate: '2026-01-09', status: 'todo', order: 0
    }],
    milestones: [],
    custom_extension_field: 'preserved_val'
  };
  var result = DataStore.migrate(v1);
  assert.strictEqual(result.projects.length, 1);
  assert.strictEqual(result.pmweb_version, 4);
  assert.strictEqual(result.projects[0].name, '原有项目');
  assert.strictEqual(result.projects[0].data.pmweb_version, 3);
  assert.strictEqual(result.projects[0].data.tasks[1].status, 'todo');
  assert.strictEqual(result.legacy.custom_extension_field, 'preserved_val');
});

test('v2 迁移到 v4 迁入原有项目且顶层版本4嵌套版本3保留原有层级', function() {
  var v2 = v2Data();
  v2.tasks[0].status = 'todo';
  v2.unknown_extra = 12345;
  var result = DataStore.migrate(v2);
  assert.strictEqual(result.projects.length, 1);
  assert.strictEqual(result.pmweb_version, 4);
  assert.strictEqual(result.projects[0].name, '原有项目');
  assert.strictEqual(result.projects[0].data.pmweb_version, 3);
  assert.strictEqual(result.projects[0].data.tasks[0].status, 'todo');
  assert.strictEqual(result.projects[0].data.tasks.length, 3);
  assert.strictEqual(result.projects[0].data.milestones.length, 1);
});

test('v3 迁移到 v4 迁入原有项目且顶层版本4嵌套版本3保留todo和业务字段', function() {
  var v3 = {
    pmweb_version: 3,
    tasks: [
      {
        id: 'task-todo', parentId: null, name: '未开始任务', status: 'todo',
        startDate: '2026-11-01', endDate: '2026-11-05', plannedEndDate: '2026-11-05',
        order: 0, progress: 0, assignee: '', description: ''
      }
    ],
    milestones: [],
    links: [],
    views: [],
    comments: [],
    activity: [],
    attachments: [],
    settings: { gridWidth: 600, layoutVersion: 'workbench' },
    custom_root_prop: 'hello'
  };
  var result = DataStore.migrate(v3);
  assert.strictEqual(result.projects.length, 1);
  assert.strictEqual(result.pmweb_version, 4);
  assert.strictEqual(result.projects[0].name, '原有项目');
  assert.strictEqual(result.projects[0].data.pmweb_version, 3);
  assert.strictEqual(result.projects[0].data.tasks[0].status, 'todo');
  assert.strictEqual(result.projects[0].data.settings.gridWidth, 600);
});

test('异常输入保护：损坏数据和更高版本不写空覆盖原存储', function() {
  var corrupt = '{"invalid_json: 123';
  app.localStorage.setItem('pmweb_data', corrupt);
  var storageBefore = app.localStorage.getItem('pmweb_data');
  var loadResult = DataStore.load();
  var storageAfter = app.localStorage.getItem('pmweb_data');
  assert.strictEqual(storageAfter, storageBefore);
  assert.strictEqual(loadResult.readOnly, true);
  assert.strictEqual(loadResult.data, null);

  var highVersion = JSON.stringify({ pmweb_version: 99, tasks: [] });
  app.localStorage.setItem('pmweb_data', highVersion);
  var highBefore = app.localStorage.getItem('pmweb_data');
  var highResult = DataStore.load();
  var highAfter = app.localStorage.getItem('pmweb_data');
  assert.strictEqual(highAfter, highBefore);
  assert.strictEqual(highResult.readOnly, true);
  assert.strictEqual(highResult.data, null);
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

console.log('\nmigration: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
