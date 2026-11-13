'use strict';

var assert = require('assert');
var lw = require('./helpers/load-workspace');
var makeWorkspace = lw.makeWorkspace;

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('DataStore.load 空存储返回默认 v4 结构且 readOnly 为 false', function() {
  var env = lw.fresh({ autoInit: false });
  var result = env.store.load();
  assert.strictEqual(typeof result, 'object');
  assert.strictEqual(result.readOnly, false);
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.raw, null);
  assert.ok(result.data);
  assert.strictEqual(result.data.pmweb_version, 4);
  assert.strictEqual(result.data.projects.length, 0);
  assert.strictEqual(result.data.settings.startupMode, 'choose');
});

test('DataStore.load 损坏 JSON 返回 readOnly 且不覆盖原存储', function() {
  var corrupt = '{bad json: true';
  var env = lw.fresh({ autoInit: false, initialRaw: corrupt });
  var storageBefore = env.app.localStorage.getItem('pmweb_data');
  var result = env.store.load();
  var storageAfter = env.app.localStorage.getItem('pmweb_data');

  assert.strictEqual(result.readOnly, true);
  assert.ok(result.error);
  assert.strictEqual(result.data, null);
  assert.strictEqual(result.raw, corrupt);
  assert.strictEqual(storageAfter, storageBefore);
});

test('DataStore.load 更高版本返回 readOnly 且不覆盖原存储', function() {
  var future = JSON.stringify({ pmweb_version: 99, projects: [] });
  var env = lw.fresh({ autoInit: false, initialRaw: future });
  var storageBefore = env.app.localStorage.getItem('pmweb_data');
  var result = env.store.load();
  var storageAfter = env.app.localStorage.getItem('pmweb_data');

  assert.strictEqual(result.readOnly, true);
  assert.ok(result.error);
  assert.strictEqual(result.data, null);
  assert.strictEqual(storageAfter, storageBefore);
});

test('DataStore.save 正常写入返回已写原文', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ autoInit: false });
  var written = env.store.save(ws, null);
  assert.strictEqual(typeof written, 'string');
  assert.strictEqual(env.app.localStorage.getItem('pmweb_data'), written);
});

test('DataStore.save 当 expectedRaw 与存储不匹配时拒绝并抛错', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ autoInit: false });
  env.app.localStorage.setItem('pmweb_data', JSON.stringify({ pmweb_version: 4, fromOtherTab: true }));

  assert.throws(function() {
    env.store.save(ws, 'expected-old-string');
  }, /存储基线不匹配|基线/);
});

test('DataStore.save 遇到存储异常向上抛错', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ autoInit: false });
  env.app.localStorage.setItem = function() {
    var err = new Error('QuotaExceededError');
    err.name = 'QuotaExceededError';
    throw err;
  };

  assert.throws(function() {
    env.store.save(ws, null);
  }, /QuotaExceededError/);
});

test('Workspace.init 初始化并返回 LoadResult', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ autoInit: false, initialData: ws });
  var result = env.workspace.init();
  assert.strictEqual(result.readOnly, false);
  assert.strictEqual(result.data.pmweb_version, 4);
  assert.strictEqual(result.data.projects.length, 2);
  assert.strictEqual(env.workspace.currentProject(), null);
});

test('Workspace.activate 切换项目并更新 currentProject', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws });
  assert.strictEqual(env.workspace.currentProject(), null);

  env.workspace.activate('p-a');
  var curA = env.workspace.currentProject();
  assert.ok(curA);
  assert.strictEqual(curA.id, 'p-a');
  assert.strictEqual(curA.name, '项目 A');

  env.workspace.activate('p-b');
  var curB = env.workspace.currentProject();
  assert.ok(curB);
  assert.strictEqual(curB.id, 'p-b');
  assert.strictEqual(curB.name, '项目 B');

  env.workspace.activate('non-existent');
  assert.strictEqual(env.workspace.currentProject(), null);
});

test('TaskManager.data 是工作副本而非 Workspace.data 的可变引用', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws, activeProjectId: 'p-a' });
  var projectA = env.workspace.currentProject();

  assert.notStrictEqual(env.manager.data, projectA.data);
  assert.strictEqual(env.manager.data.tasks[0].id, 't-a');
});

test('两个项目工作数据不互相引用且修改隔离', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws, activeProjectId: 'p-a' });

  // 在项目 A 新增任务
  var newTask = env.manager.addTask(null, '任务 A-2');
  assert.ok(newTask);
  assert.strictEqual(env.manager.data.tasks.length, 3);

  // 切换到项目 B
  env.workspace.activate('p-b');
  assert.strictEqual(env.manager.data.tasks.length, 1);
  assert.strictEqual(env.manager.data.tasks[0].id, 't-b');

  // 切回项目 A，任务依然存在
  env.workspace.activate('p-a');
  assert.strictEqual(env.manager.data.tasks.length, 3);
  var found = env.manager.data.tasks.some(function(t) { return t.id === newTask.id; });
  assert.ok(found);
});

test('切换项目清理撤销历史与缓存状态', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws, activeProjectId: 'p-a' });

  env.manager.addTask(null, '临时任务');
  assert.strictEqual(env.manager.canUndo(), true);

  env.workspace.activate('p-b');
  assert.strictEqual(env.manager.canUndo(), false);
});

test('TaskManager.assertWritable 无项目绑定时写操作被拒绝', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws });
  env.manager.bindProject(null);

  assert.throws(function() {
    env.manager.addTask(null, '新任务');
  }, /无项目|不可写入/);

  assert.throws(function() {
    env.manager.updateTask('t-a', { name: '改名' });
  }, /无项目|不可写入/);

  assert.throws(function() {
    env.manager.deleteTask('t-a');
  }, /无项目|不可写入/);

  assert.throws(function() {
    env.manager.addComment('t-a', 'author', 'text');
  }, /无项目|不可写入/);

  assert.throws(function() {
    env.manager.addAttachment('t-a', { name: 'f.txt', size: 10, type: 'text/plain', blobKey: 'b1' });
  }, /无项目|不可写入/);
});

test('TaskManager.assertWritable 归档项目写操作被拒绝', function() {
  var ws = makeWorkspace();
  ws.projects[0].archived = true;
  var env = lw.fresh({ initialData: ws, activeProjectId: 'p-a' });

  assert.throws(function() {
    env.manager.addTask(null, '新任务');
  }, /归档|只读/);

  assert.throws(function() {
    env.manager.updateTask('t-a', { name: '改名' });
  }, /归档|只读/);
});

test('写失败时回滚已绑定数据并向外报错', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws, activeProjectId: 'p-a' });

  var originalName = env.manager.data.tasks[0].name;

  // 模拟并发导致 expectedRaw 不匹配
  env.app.localStorage.setItem('pmweb_data', JSON.stringify({ pmweb_version: 4, fromOtherTab: true }));

  env.manager.data.tasks[0].name = '未成功的新名称';

  assert.throws(function() {
    env.manager._save();
  }, /存储基线不匹配|基线/);

  // 失败后重新绑定上次已提交数据
  assert.strictEqual(env.manager.data.tasks[0].name, originalName);
});

test('第二个 vm 使用旧原文提交被拒绝', function() {
  var ws = makeWorkspace();
  var raw1 = JSON.stringify(ws);

  var sharedStore = { pmweb_data: raw1 };
  var sharedStorage = {
    _store: sharedStore,
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null;
    },
    setItem: function(key, value) { this._store[key] = String(value); },
    removeItem: function(key) { delete this._store[key]; }
  };

  // 模拟标签页 1
  var tab1 = lw.fresh({ localStorage: sharedStorage, activeProjectId: 'p-a' });
  // 模拟标签页 2，初始状态相同
  var tab2 = lw.fresh({ localStorage: sharedStorage, activeProjectId: 'p-a' });

  // 标签页 1 进行保存
  tab1.manager.addTask(null, '标签页1任务');

  // 此时标签页 2 尝试保存，基线已不匹配
  assert.throws(function() {
    tab2.manager.addTask(null, '标签页2任务');
  }, /存储基线不匹配|基线/);
});

test('Workspace.commit 在损坏 JSON 只读模式下拒绝并抛错，且 data/raw/storage 完全不变', function() {
  var corrupt = '{bad json: true';
  var env = lw.fresh({ autoInit: false, initialRaw: corrupt });
  env.workspace.init();
  assert.strictEqual(env.workspace.isReadOnly(), true);

  var storageBefore = env.app.localStorage.getItem('pmweb_data');
  var rawBefore = env.workspace.raw;
  var dataBefore = env.workspace.data;

  assert.throws(function() {
    env.workspace.commit(makeWorkspace());
  }, /只读/);

  assert.strictEqual(env.app.localStorage.getItem('pmweb_data'), storageBefore);
  assert.strictEqual(env.workspace.raw, rawBefore);
  assert.strictEqual(env.workspace.data, dataBefore);
});

test('Workspace.commit 在更高版本只读模式下拒绝并抛错，且 data/raw/storage 完全不变', function() {
  var future = JSON.stringify({ pmweb_version: 99, projects: [] });
  var env = lw.fresh({ autoInit: false, initialRaw: future });
  env.workspace.init();
  assert.strictEqual(env.workspace.isReadOnly(), true);

  var storageBefore = env.app.localStorage.getItem('pmweb_data');
  var rawBefore = env.workspace.raw;
  var dataBefore = env.workspace.data;

  assert.throws(function() {
    env.workspace.commit(makeWorkspace());
  }, /只读/);

  assert.strictEqual(env.app.localStorage.getItem('pmweb_data'), storageBefore);
  assert.strictEqual(env.workspace.raw, rawBefore);
  assert.strictEqual(env.workspace.data, dataBefore);
});

test('DataStore.save 当 expectedRaw 为 null 且当前存储非 null 时拒绝并抛错', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ autoInit: false });
  // 模拟另一个页面在当前页面空状态时写入了数据
  env.app.localStorage.setItem('pmweb_data', JSON.stringify({ pmweb_version: 4, fromOtherTab: true }));

  assert.throws(function() {
    env.store.save(ws, null);
  }, /存储基线不匹配|基线/);
});

test('DataStore.save 当 expectedRaw 为 null 且当前存储为 null 时成功写入首次数据', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ autoInit: false });
  assert.strictEqual(env.app.localStorage.getItem('pmweb_data'), null);

  var written = env.store.save(ws, null);
  assert.strictEqual(typeof written, 'string');
  assert.strictEqual(env.app.localStorage.getItem('pmweb_data'), written);
});

test('startup_modes_and_archived_default', function() {
  var ws = makeWorkspace();
  ws.settings = { startupMode: 'choose', defaultProjectId: null, lastProjectId: null };
  var env = lw.fresh({ autoInit: false, initialData: ws });
  env.workspace.init();

  // 1. 默认 choose 模式返回 null
  assert.strictEqual(env.workspace.resolveStartup(), null);

  // 2. last 模式：设置有效上次项目并返回目标
  env.workspace.setStartup({ mode: 'last', projectId: 'p-b' });
  assert.strictEqual(env.workspace.resolveStartup(), 'p-b');

  // 3. fixed 模式：固定指定项目
  env.workspace.setStartup({ mode: 'fixed', projectId: 'p-a' });
  assert.strictEqual(env.workspace.resolveStartup(), 'p-a');

  // 4. fixed 目标项目被归档时返回 null，不擅自选择其他项目
  env.workspace.updateProject('p-a', { archived: true });
  assert.strictEqual(env.workspace.resolveStartup(), null);

  // 恢复归档后再次解析返回该项目
  env.workspace.updateProject('p-a', { archived: false });
  assert.strictEqual(env.workspace.resolveStartup(), 'p-a');

  // 5. last 目标项目被归档时返回 null
  env.workspace.setStartup({ mode: 'last', projectId: 'p-b' });
  assert.strictEqual(env.workspace.resolveStartup(), 'p-b');
  env.workspace.updateProject('p-b', { archived: true });
  assert.strictEqual(env.workspace.resolveStartup(), null);

  // 6. 目标项目不存在（模拟被删除）时返回 null
  env.workspace.setStartup({ mode: 'fixed', projectId: 'deleted-proj-id' });
  assert.strictEqual(env.workspace.resolveStartup(), null);

  // 7. 无项目时返回 null
  var emptyWs = { pmweb_version: 4, projects: [], settings: { startupMode: 'fixed', defaultProjectId: 'p-a' } };
  var emptyEnv = lw.fresh({ autoInit: false, initialData: emptyWs });
  emptyEnv.workspace.init();
  assert.strictEqual(emptyEnv.workspace.resolveStartup(), null);
});

test('archived_project_is_read_only_at_model_boundary', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws, activeProjectId: 'p-a' });

  // 确认活跃项目可正常写入
  var t1 = env.manager.addTask(null, '活跃项目任务');
  assert.ok(t1);

  // 将 p-a 归档
  env.workspace.updateProject('p-a', { archived: true });

  var cur = env.workspace.currentProject();
  assert.strictEqual(cur.archived, true);

  var rawBefore = env.app.localStorage.getItem('pmweb_data');

  // 归档后所有公开写路径必须 throw，且原 localStorage 与内存 raw 不变
  var expectArchived = /归档|只读/;

  assert.throws(function() { env.manager.addTask(null, '新任务'); }, expectArchived);
  assert.throws(function() { env.manager.updateTask(t1.id, { name: '改名' }); }, expectArchived);
  assert.throws(function() { env.manager.updateTasks([t1.id], { progress: 80 }); }, expectArchived);
  assert.throws(function() { env.manager.deleteTask(t1.id); }, expectArchived);
  assert.throws(function() { env.manager.moveTask(t1.id, null, 0); }, expectArchived);
  assert.throws(function() { env.manager.addMilestone(t1.id, '节点', '2026-11-20', 'pending'); }, expectArchived);
  assert.throws(function() { env.manager.updateMilestone('m-a', { name: '改名节点' }); }, expectArchived);
  assert.throws(function() { env.manager.deleteMilestone('m-a'); }, expectArchived);
  assert.throws(function() { env.manager.addLink('t-a', 't-a-child', 'FS'); }, expectArchived);
  assert.throws(function() { env.manager.deleteLink('any-link'); }, expectArchived);
  assert.throws(function() { env.manager.addComment(t1.id, 'tester', '评论'); }, expectArchived);
  assert.throws(function() { env.manager.updateComment('c-a', '修改评论'); }, expectArchived);
  assert.throws(function() { env.manager.deleteComment('c-a'); }, expectArchived);
  assert.throws(function() { env.manager.addAttachment(t1.id, { name: 'att.txt', size: 10, type: 'text/plain', blobKey: 'k1' }); }, expectArchived);
  assert.throws(function() { env.manager.deleteAttachment('a-a'); }, expectArchived);
  assert.throws(function() { env.manager.saveBaseline(); }, expectArchived);
  assert.throws(function() { env.manager.clearBaseline(); }, expectArchived);
  assert.throws(function() { env.manager.setSetting('k', 'v'); }, expectArchived);
  assert.throws(function() { env.manager.replaceData({}); }, expectArchived);
  assert.throws(function() { env.manager.setWorkCalendar({ weekends: [0] }); }, expectArchived);
  assert.throws(function() { env.manager.undo(); }, expectArchived);
  assert.throws(function() { env.manager.redo(); }, expectArchived);

  // 验证 localStorage 物理内容未被修改
  var rawAfter = env.app.localStorage.getItem('pmweb_data');
  assert.strictEqual(rawAfter, rawBefore);
  assert.strictEqual(env.workspace.raw, rawBefore);
});

test('project_crud_and_same_name', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws });

  // 1. 创建项目校验：名称 trim 后非空
  assert.throws(function() { env.workspace.createProject({ name: '' }); }, /名称不能为空/);
  assert.throws(function() { env.workspace.createProject({ name: '   ' }); }, /名称不能为空/);
  assert.throws(function() { env.workspace.createProject({}); }, /名称不能为空/);

  // 2. 创建有效项目
  var p1 = env.workspace.createProject({ name: '核心系统', description: '第一期核心系统' });
  assert.ok(p1.id);
  assert.strictEqual(p1.name, '核心系统');
  assert.strictEqual(p1.description, '第一期核心系统');
  assert.strictEqual(p1.status, 'active');
  assert.strictEqual(p1.archived, false);
  assert.ok(p1.createdAt);
  assert.ok(p1.updatedAt);
  assert.ok(p1.data);
  assert.strictEqual(p1.data.tasks.length, 0);

  // 3. 允许同名项目，依靠稳定 ID 区分
  var p2 = env.workspace.createProject({ name: '核心系统', description: '第二期同名项目' });
  assert.ok(p2.id);
  assert.notStrictEqual(p2.id, p1.id);
  assert.strictEqual(p2.name, '核心系统');
  assert.strictEqual(p2.description, '第二期同名项目');

  // 分别激活两个同名项目
  env.workspace.activate(p1.id);
  assert.strictEqual(env.workspace.currentProject().id, p1.id);
  env.manager.addTask(null, 'p1 专有任务');

  env.workspace.activate(p2.id);
  assert.strictEqual(env.workspace.currentProject().id, p2.id);
  assert.strictEqual(env.manager.data.tasks.length, 0);
  env.manager.addTask(null, 'p2 专有任务');

  // 切回 p1，数据各自独立
  env.workspace.activate(p1.id);
  assert.strictEqual(env.manager.data.tasks.length, 1);
  assert.strictEqual(env.manager.data.tasks[0].name, 'p1 专有任务');

  // 4. updateProject 更新说明与改名
  assert.throws(function() { env.workspace.updateProject(p1.id, { name: '  ' }); }, /名称不能为空/);
  env.workspace.updateProject(p1.id, { name: '核心系统重构', description: '更新说明' });
  var updatedP1 = env.workspace.currentProject();
  assert.strictEqual(updatedP1.name, '核心系统重构');
  assert.strictEqual(updatedP1.description, '更新说明');

  // 5. 标记完成不改任务状态与日期
  var taskBefore = JSON.parse(JSON.stringify(env.manager.data.tasks[0]));
  env.workspace.updateProject(p1.id, { status: 'completed' });
  assert.strictEqual(env.workspace.currentProject().status, 'completed');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(env.manager.data.tasks[0])), taskBefore);

  // 恢复进行中
  env.workspace.updateProject(p1.id, { status: 'active' });
  assert.strictEqual(env.workspace.currentProject().status, 'active');

  // 6. 归档与恢复归档：恢复归档保留原完成状态
  env.workspace.updateProject(p1.id, { status: 'completed' });
  env.workspace.updateProject(p1.id, { archived: true });
  assert.strictEqual(env.workspace.currentProject().archived, true);
  assert.strictEqual(env.workspace.currentProject().status, 'completed');

  // 恢复归档
  env.workspace.updateProject(p1.id, { archived: false });
  assert.strictEqual(env.workspace.currentProject().archived, false);
  assert.strictEqual(env.workspace.currentProject().status, 'completed'); // 保留 completed 状态

  // 7. 删除入口等待 Task 7 回收站服务，未装载服务时抛错拦截
  if (typeof env.workspace.deleteProject === 'function') {
    assert.throws(function() { env.workspace.deleteProject(p1.id); }, /回收站/);
  }
});

test('Workspace.deleteProject 配合 RecycleBin 移入回收站并提交存储', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({
    initialData: ws,
    activeProjectId: 'p-a',
    scripts: [
      'date.js',
      'validate.js',
      'store.js',
      'workspace.js',
      'recycle-bin.js',
      'history.js',
      'comments.js',
      'activity.js',
      'attachment-meta.js',
      'task-manager.js'
    ]
  });

  var batchId = env.workspace.deleteProject('p-a');
  assert.ok(batchId);
  assert.strictEqual(env.workspace.data.projects.length, 1);
  assert.strictEqual(env.workspace.activeProjectId, null);
  assert.strictEqual(env.workspace.data.recycleBin.length, 1);
  assert.strictEqual(env.workspace.data.recycleBin[0].id, batchId);
});

test('archived_project_metadata_and_data_update_rejected_at_workspace_boundary', function() {
  var ws = makeWorkspace();
  var env = lw.fresh({ initialData: ws, activeProjectId: 'p-a' });

  // 将 p-b 设为 completed 状态并归档（作为非当前项目测试）
  env.workspace.updateProject('p-b', { status: 'completed' });
  env.workspace.updateProject('p-b', { archived: true });

  var projB = env.workspace.data.projects.find(function(p) { return p.id === 'p-b'; });
  assert.strictEqual(projB.archived, true);
  assert.strictEqual(projB.status, 'completed');

  var rawBefore = env.app.localStorage.getItem('pmweb_data');

  // 1. archived metadata update 拒绝（name, description, status）
  assert.throws(function() {
    env.workspace.updateProject('p-b', { name: '篡改归档名称' });
  }, /归档|只读/);

  assert.throws(function() {
    env.workspace.updateProject('p-b', { description: '篡改归档描述' });
  }, /归档|只读/);

  assert.throws(function() {
    env.workspace.updateProject('p-b', { status: 'active' });
  }, /归档|只读/);

  // 2. mixed unarchive + edit 拒绝
  assert.throws(function() {
    env.workspace.updateProject('p-b', { archived: false, name: '同时改名' });
  }, /归档|只读/);

  assert.throws(function() {
    env.workspace.updateProject('p-b', { archived: false, status: 'active' });
  }, /归档|只读/);

  assert.throws(function() {
    env.workspace.updateProject('p-b', { archived: false, description: '同时改说明' });
  }, /归档|只读/);

  // 验证 metadata 未被篡改且 storage/raw 不变
  var projBAfter = env.workspace.data.projects.find(function(p) { return p.id === 'p-b'; });
  assert.strictEqual(projBAfter.name, '项目 B');
  assert.strictEqual(projBAfter.status, 'completed');
  assert.strictEqual(projBAfter.archived, true);
  assert.strictEqual(env.app.localStorage.getItem('pmweb_data'), rawBefore);
  assert.strictEqual(env.workspace.raw, rawBefore);

  // 3. archived updateProjectData 拒绝且 raw/data/storage 不变（覆盖非当前项目）
  var initialTasksCount = projBAfter.data.tasks.length;
  var injectData = JSON.parse(JSON.stringify(projBAfter.data));
  injectData.tasks.push({ id: 'injected-task', name: '注入任务' });

  assert.throws(function() {
    env.workspace.updateProjectData('p-b', injectData);
  }, /归档|只读/);

  // 验证项目数据未被篡改，raw/data/storage 完全不变
  var projBAfterData = env.workspace.data.projects.find(function(p) { return p.id === 'p-b'; });
  assert.strictEqual(projBAfterData.data.tasks.length, initialTasksCount);
  assert.strictEqual(env.app.localStorage.getItem('pmweb_data'), rawBefore);
  assert.strictEqual(env.workspace.raw, rawBefore);

  // 4. 当前激活项目若是已归档项目，updateProjectData 同样拒绝
  env.workspace.updateProject('p-a', { archived: true });
  var curA = env.workspace.currentProject();
  assert.strictEqual(curA.id, 'p-a');
  assert.strictEqual(curA.archived, true);
  assert.throws(function() {
    env.workspace.updateProjectData('p-a', curA.data);
  }, /归档|只读/);

  // 5. 仅 unarchive 成功并保留 status
  env.workspace.updateProject('p-b', { archived: false });
  var unarchivedB = env.workspace.data.projects.find(function(p) { return p.id === 'p-b'; });
  assert.strictEqual(unarchivedB.archived, false);
  assert.strictEqual(unarchivedB.status, 'completed', '解归档后应完整保留原完成状态');

  // 解归档后允许正常更新 metadata
  env.workspace.updateProject('p-b', { name: '解归档后合法修改名称' });
  var renamedB = env.workspace.data.projects.find(function(p) { return p.id === 'p-b'; });
  assert.strictEqual(renamedB.name, '解归档后合法修改名称');
});

test('setStartup_last_mode_keeps_current_last_project', function() {
  var ws = makeWorkspace();
  ws.settings = { startupMode: 'choose', defaultProjectId: null, lastProjectId: 'p-b' };
  var env = lw.fresh({ autoInit: false, initialData: ws });
  env.workspace.init();

  // 用户在启动偏好弹窗中仅切换为「自动进入上次打开的项目」，
  // 未显式传 projectId 时必须保留已有的 lastProjectId，不得清空导致该偏好永远失效。
  env.workspace.setStartup({ mode: 'last' });
  assert.strictEqual(env.workspace.data.settings.lastProjectId, 'p-b', '切换为 last 模式时不得清空已有 lastProjectId');
  assert.strictEqual(env.workspace.resolveStartup(), 'p-b', 'last 模式必须能解析到上次项目');

  // 显式传 null 仍允许清空
  env.workspace.setStartup({ mode: 'last', projectId: null });
  assert.strictEqual(env.workspace.data.settings.lastProjectId, null);
  assert.strictEqual(env.workspace.resolveStartup(), null);
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

console.log('\nworkspace: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
