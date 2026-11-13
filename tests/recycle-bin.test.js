'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var helper = require('./helpers/load');
var lw = require('./helpers/load-workspace');
var makeWorkspace = lw.makeWorkspace;

var app = helper.createApp([
  'date.js',
  'store.js',
  'history.js',
  'comments.js',
  'activity.js',
  'attachment-meta.js',
  'attachment-store.js',
  'workspace.js',
  'recycle-bin.js',
  'task-manager.js'
]);

var RecycleBin = app.get('RecycleBin');
var Workspace = app.get('Workspace');
var TaskManager = app.get('TaskManager');
var AttachmentStore = app.get('AttachmentStore');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ------------------------------------------------------------
// Step 1: 核心 RED 测试用例
// ------------------------------------------------------------

test('delete_refresh_restore_whole_subtree', function() {
  var ws = makeWorkspace();
  // 在 p-a 中构建完整三层子树与附属业务数据
  var pA = ws.projects.find(function(p) { return p.id === 'p-a'; });
  var pB = ws.projects.find(function(p) { return p.id === 'p-b'; });
  var pBOriginal = JSON.parse(JSON.stringify(pB));

  pA.data.tasks = [
    { id: 'T1', parentId: null, name: '根任务', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-20', order: 0 },
    { id: 'T2', parentId: 'T1', name: '子任务', status: 'inProgress', startDate: '2026-11-12', endDate: '2026-11-18', order: 0 },
    { id: 'T3', parentId: 'T2', name: '孙任务', status: 'todo', startDate: '2026-11-13', endDate: '2026-11-15', order: 0 }
  ];
  pA.data.milestones = [
    { id: 'M1', taskId: 'T2', name: '节点1', date: '2026-11-15', status: 'pending' }
  ];
  pA.data.links = [
    { id: 'L1', source: 'T2', target: 'T3', type: 'FS', lag: 0 }
  ];
  pA.data.comments = [
    { id: 'C1', taskId: 'T2', author: 'alice', text: '评论内容', createdAt: '2026-11-12T00:00:00.000Z' }
  ];
  pA.data.attachments = [
    { id: 'A1', taskId: 'T3', name: '附件1.txt', size: 100, type: 'text/plain', blobKey: 'blob-1', createdAt: '2026-11-12T00:00:00.000Z' }
  ];
  pA.data.activity = [
    { id: 'act-1', taskId: 'T1', field: 'name', before: '', after: '根任务', at: '2026-11-11T00:00:00.000Z' },
    { id: 'act-2', taskId: 'T2', field: 'name', before: '', after: '子任务', at: '2026-11-12T00:00:00.000Z' }
  ];

  // 1. 删除根任务 T1
  var removeRes = RecycleBin.removeTask(ws, 'p-a', 'T1');
  assert.ok(removeRes.batchId, '应返回生成的批次 ID');
  var wsDeleted = removeRes.workspace;

  // 纯函数检查：入参未被污染
  assert.strictEqual(ws.projects[0].data.tasks.length, 3, '入参 workspace 不得被原地修改');

  var pADeleted = wsDeleted.projects.find(function(p) { return p.id === 'p-a'; });
  assert.strictEqual(pADeleted.data.tasks.length, 0, '子树所有任务应从活动数组移出');
  assert.strictEqual(pADeleted.data.milestones.length, 0, '相关节点应移出');
  assert.strictEqual(pADeleted.data.links.length, 0, '相关依赖应移出');
  assert.strictEqual(pADeleted.data.comments.length, 0, '相关评论应移出');
  assert.strictEqual(pADeleted.data.attachments.length, 0, '相关附件引用应移出');
  assert.strictEqual(pADeleted.data.activity.length, 0, '相关活动上下文应移出');

  // 回收站批次结构断言
  assert.strictEqual(wsDeleted.recycleBin.length, 1);
  var batch = wsDeleted.recycleBin[0];
  assert.strictEqual(batch.id, removeRes.batchId);
  assert.strictEqual(batch.kind, 'task');
  assert.strictEqual(batch.projectId, 'p-a');
  assert.ok(batch.deletedAt);
  assert.strictEqual(batch.snapshot.tasks.length, 3);
  assert.strictEqual(batch.snapshot.milestones.length, 1);
  assert.strictEqual(batch.snapshot.links.length, 1);
  assert.strictEqual(batch.snapshot.comments.length, 1);
  assert.strictEqual(batch.snapshot.attachments.length, 1);
  assert.strictEqual(batch.snapshot.activity.length, 2);

  // 项目 B 完全不变
  var pBAfter = wsDeleted.projects.find(function(p) { return p.id === 'p-b'; });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pBAfter)), pBOriginal, '其他项目不得受删除影响');

  // 2. 模拟跨刷新序列化与重新加载
  var rawJson = JSON.stringify(wsDeleted);
  var wsReloaded = JSON.parse(rawJson);

  // 3. 预览恢复
  var preview = RecycleBin.previewRestore(wsReloaded, batch.id);
  assert.strictEqual(preview.canRestore, true);
  assert.strictEqual(preview.warnings.length, 0, '正常子树恢复无警告');
  assert.strictEqual(preview.details.taskCount, 3);

  // 4. 执行恢复
  var wsRestored = RecycleBin.restore(wsReloaded, batch.id, { acceptWarnings: false });
  assert.strictEqual(wsRestored.recycleBin.length, 0, '恢复后批次应从回收站移除');

  var pARestored = wsRestored.projects.find(function(p) { return p.id === 'p-a'; });
  assert.strictEqual(pARestored.data.tasks.length, 3);
  assert.strictEqual(pARestored.data.milestones.length, 1);
  assert.strictEqual(pARestored.data.links.length, 1);
  assert.strictEqual(pARestored.data.comments.length, 1);
  assert.strictEqual(pARestored.data.attachments.length, 1);
  assert.strictEqual(pARestored.data.activity.length, 2);
  assert.strictEqual(pARestored.data.tasks[0].id, 'T1');
  assert.strictEqual(pARestored.data.tasks[1].parentId, 'T1');
  assert.strictEqual(pARestored.data.tasks[2].parentId, 'T2');
});

test('missing_parent_and_crossing_links_preview', function() {
  var ws = makeWorkspace();
  var pA = ws.projects.find(function(p) { return p.id === 'p-a'; });

  pA.data.tasks = [
    { id: 'T1', parentId: null, name: '父任务', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-20', order: 0 },
    { id: 'T2', parentId: 'T1', name: '子任务', status: 'inProgress', startDate: '2026-11-12', endDate: '2026-11-18', order: 0 },
    { id: 'T_ext', parentId: null, name: '独立任务', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-15', order: 1 }
  ];
  pA.data.links = [
    { id: 'L_ext', source: 'T2', target: 'T_ext', type: 'FS', lag: 0 }
  ];

  // 删除子任务 T2
  var resT2 = RecycleBin.removeTask(ws, 'p-a', 'T2');
  var wsAfterT2 = resT2.workspace;

  // 模拟父任务 T1 和独立任务 T_ext 随后被移除或修改丢失
  var pAChanged = wsAfterT2.projects.find(function(p) { return p.id === 'p-a'; });
  pAChanged.data.tasks = []; // T1 和 T_ext 均不存在了
  pAChanged.data.links = [];

  // 预览恢复 T2
  var preview = RecycleBin.previewRestore(wsAfterT2, resT2.batchId);
  assert.strictEqual(preview.canRestore, true);
  assert.ok(preview.warnings.length >= 2, '应包含父级缺失和外依赖缺失警告');

  var hasParentWarn = preview.warnings.some(function(w) { return w.indexOf('父') !== -1; });
  var hasLinkWarn = preview.warnings.some(function(w) { return w.indexOf('依赖') !== -1; });
  assert.ok(hasParentWarn, '必须列出原父任务缺失警告');
  assert.ok(hasLinkWarn, '必须列出外部依赖另一端不存在的悬空链接警告');

  // 未确认警告时应拒绝恢复
  assert.throws(function() {
    RecycleBin.restore(wsAfterT2, resT2.batchId, { acceptWarnings: false });
  }, /警告/);

  // 确认警告后恢复
  var wsRestored = RecycleBin.restore(wsAfterT2, resT2.batchId, { acceptWarnings: true });
  var pARestored = wsRestored.projects.find(function(p) { return p.id === 'p-a'; });
  assert.strictEqual(pARestored.data.tasks.length, 1);
  var restoredT2 = pARestored.data.tasks[0];
  assert.strictEqual(restoredT2.id, 'T2');
  assert.strictEqual(restoredT2.parentId, null, '缺失父级确认后应降级为顶层任务');
  assert.strictEqual(pARestored.data.links.length, 0, '另一端不存在的悬空链接不得被建立');
});

test('purge_preserves_other_references', function() {
  var ws = makeWorkspace();
  var pA = ws.projects.find(function(p) { return p.id === 'p-a'; });

  // 场景：附件 shared-blob
  // 1. 活动任务 T_act 引用 shared-blob
  // 2. 批次 1 引用 shared-blob
  // 3. 批次 2 引用 shared-blob
  pA.data.tasks = [
    { id: 'T_act', parentId: null, name: '活动任务', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-15', order: 0 },
    { id: 'T_del1', parentId: null, name: '删除任务1', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-15', order: 1 },
    { id: 'T_del2', parentId: null, name: '删除任务2', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-15', order: 2 }
  ];
  pA.data.attachments = [
    { id: 'att-act', taskId: 'T_act', name: '文件.txt', size: 100, type: 'text/plain', blobKey: 'shared-blob' },
    { id: 'att-1', taskId: 'T_del1', name: '文件.txt', size: 100, type: 'text/plain', blobKey: 'shared-blob' },
    { id: 'att-2', taskId: 'T_del2', name: '文件.txt', size: 100, type: 'text/plain', blobKey: 'shared-blob' }
  ];

  var r1 = RecycleBin.removeTask(ws, 'p-a', 'T_del1');
  var r2 = RecycleBin.removeTask(r1.workspace, 'p-a', 'T_del2');
  var wsBothDeleted = r2.workspace;

  // 引用统计检查
  var allRefs = RecycleBin.referencedBlobKeys(wsBothDeleted);
  assert.ok(allRefs.has('shared-blob'));

  // 永久清除批次 1：由于活动任务 T_act 与批次 2 仍在引用，不得释放 shared-blob
  var purge1 = RecycleBin.purge(wsBothDeleted, r1.batchId);
  assert.strictEqual(purge1.unreferencedBlobKeys.indexOf('shared-blob'), -1, '仍有活动及批次2引用，不可清除');
  assert.strictEqual(purge1.workspace.recycleBin.length, 1);

  // 移除活动任务中的引用
  var pAInPurged = purge1.workspace.projects.find(function(p) { return p.id === 'p-a'; });
  pAInPurged.data.attachments = [];

  // 永久清除批次 2：此时已无任何活动项目、归档或批次引用，shared-blob 应作为无引用键返回
  var purge2 = RecycleBin.purge(purge1.workspace, r2.batchId);
  assert.ok(purge2.unreferencedBlobKeys.indexOf('shared-blob') !== -1, '已无任何引用，此时必须返回待清理键');
  assert.strictEqual(purge2.workspace.recycleBin.length, 0);
});

test('undo_removes_same_batch', function() {
  var ws = makeWorkspace();
  app.localStorage.setItem('pmweb_data', JSON.stringify(ws));
  Workspace.init();
  Workspace.activate('p-a');

  var task = TaskManager.addTask(null, '待删任务');
  assert.ok(task && task.id);
  TaskManager.clearHistory();

  var beforeBinCount = (Workspace.data.recycleBin || []).length;

  // 执行删除
  TaskManager.deleteTask(task.id);
  assert.strictEqual((Workspace.data.recycleBin || []).length, beforeBinCount + 1);
  var batchId = Workspace.data.recycleBin[Workspace.data.recycleBin.length - 1].id;
  assert.ok(batchId);
  assert.strictEqual(TaskManager.getTask(task.id), null);

  // 撤销删除：应恢复任务并从回收站移除对应批次
  TaskManager.undo();
  assert.strictEqual((Workspace.data.recycleBin || []).length, beforeBinCount, 'undo 应移除同批次');
  var restored = TaskManager.getTask(task.id);
  assert.ok(restored, '任务应已恢复');
  assert.strictEqual(restored.name, '待删任务');

  // 重做删除：应生成新批次，不双重快照
  TaskManager.redo();
  assert.strictEqual(TaskManager.getTask(task.id), null);
  assert.strictEqual((Workspace.data.recycleBin || []).length, beforeBinCount + 1);
  var newBatchId = Workspace.data.recycleBin[Workspace.data.recycleBin.length - 1].id;
  assert.notStrictEqual(newBatchId, batchId, 'redo 应生成新批次 ID');

  // 再次撤销
  TaskManager.undo();
  assert.strictEqual((Workspace.data.recycleBin || []).length, beforeBinCount);
  assert.ok(TaskManager.getTask(task.id));
});

test('two_projects_and_cross_refresh_reload', function() {
  var ws = makeWorkspace();
  var pA = ws.projects[0];
  var pB = ws.projects[1];

  var r = RecycleBin.removeProject(ws, pA.id);
  assert.strictEqual(r.workspace.projects.length, 1);
  assert.strictEqual(r.workspace.projects[0].id, pB.id);
  assert.strictEqual(r.workspace.recycleBin.length, 1);
  var batch = r.workspace.recycleBin[0];
  assert.strictEqual(batch.kind, 'project');
  assert.strictEqual(batch.projectId, pA.id);
  assert.strictEqual(batch.snapshot.id, pA.id);

  // 跨刷新加载
  var reloaded = JSON.parse(JSON.stringify(r.workspace));
  var preview = RecycleBin.previewRestore(reloaded, batch.id);
  assert.strictEqual(preview.canRestore, true);

  var restored = RecycleBin.restore(reloaded, batch.id, { acceptWarnings: false });
  assert.strictEqual(restored.projects.length, 2);
  assert.strictEqual(restored.recycleBin.length, 0);
  assert.ok(restored.projects.some(function(p) { return p.id === pA.id; }));
});

test('task_restore_rejects_when_project_is_missing', function() {
  var ws = makeWorkspace();
  var pA = ws.projects[0];
  var task = pA.data.tasks[0];

  // 先删除任务
  var rTask = RecycleBin.removeTask(ws, pA.id, task.id);
  // 再删除整个项目
  var rProj = RecycleBin.removeProject(rTask.workspace, pA.id);

  // 在项目未恢复前尝试恢复任务应被拒绝
  var preview = RecycleBin.previewRestore(rProj.workspace, rTask.batchId);
  assert.strictEqual(preview.canRestore, false);
  assert.ok(preview.blockingReason.indexOf('项目') !== -1, '提示需先恢复项目');

  assert.throws(function() {
    RecycleBin.restore(rProj.workspace, rTask.batchId, { acceptWarnings: true });
  }, /项目/);
});

test('readonly_and_archived_boundaries', function() {
  var ws = makeWorkspace();
  var pA = ws.projects[0];
  pA.archived = true;

  // 1. 删除归档项目本身允许走回收站
  var rProj = RecycleBin.removeProject(ws, pA.id);
  assert.strictEqual(rProj.workspace.recycleBin.length, 1);
  assert.strictEqual(rProj.workspace.recycleBin[0].kind, 'project');

  // 恢复归档项目，恢复后仍保持归档状态
  var restoredProjWs = RecycleBin.restore(rProj.workspace, rProj.batchId, { acceptWarnings: false });
  var restoredProj = restoredProjWs.projects.find(function(p) { return p.id === pA.id; });
  assert.strictEqual(restoredProj.archived, true);

  // 2. 归档项目内的任务恢复不得绕过只读
  // 模拟之前删除了任务，后项目被归档
  pA.archived = false;
  var rTask = RecycleBin.removeTask(ws, pA.id, pA.data.tasks[0].id);
  var pAInWs = rTask.workspace.projects.find(function(p) { return p.id === pA.id; });
  pAInWs.archived = true;

  var preview = RecycleBin.previewRestore(rTask.workspace, rTask.batchId);
  assert.strictEqual(preview.canRestore, false);
  assert.ok(preview.blockingReason.indexOf('归档') !== -1 || preview.blockingReason.indexOf('只读') !== -1);

  assert.throws(function() {
    RecycleBin.restore(rTask.workspace, rTask.batchId, { acceptWarnings: true });
  }, /归档|只读/);
});

test('id_conflict_remapping', function() {
  var ws = makeWorkspace();
  var pA = ws.projects[0];
  pA.data.tasks = [
    { id: 'T1', parentId: null, name: '原任务', status: 'todo', startDate: '2026-11-11', endDate: '2026-11-15' }
  ];
  var origId = 'T1';

  // 删除任务
  var rTask = RecycleBin.removeTask(ws, pA.id, origId);
  var wsAfterDel = rTask.workspace;

  // 在原项目中以相同 ID 导入或新建了一个新任务
  var pAAfter = wsAfterDel.projects.find(function(p) { return p.id === pA.id; });
  pAAfter.data.tasks.push({
    id: origId,
    parentId: null,
    name: '冲突任务',
    status: 'done',
    startDate: '2026-11-11',
    endDate: '2026-11-15'
  });

  // 预览应检测到冲突
  var preview = RecycleBin.previewRestore(wsAfterDel, rTask.batchId);
  assert.strictEqual(preview.canRestore, true);
  assert.ok(preview.warnings.some(function(w) { return w.indexOf('冲突') !== -1 || w.indexOf('ID') !== -1; }));
  assert.ok(preview.details.idConflicts.indexOf(origId) !== -1);

  // 恢复时自动重映射 ID 并保持两个任务并存
  var wsRestored = RecycleBin.restore(wsAfterDel, rTask.batchId, { acceptWarnings: true });
  var pARestored = wsRestored.projects.find(function(p) { return p.id === pA.id; });
  assert.strictEqual(pARestored.data.tasks.length, 2);

  var ids = pARestored.data.tasks.map(function(t) { return t.id; });
  assert.ok(ids.indexOf(origId) !== -1, '原冲突任务保留');
  assert.strictEqual(new Set(ids).size, 2, '两任务 ID 必须互不相同');
});

test('project_deletion_updates_startup_and_preserves_extensions', function() {
  var ws = makeWorkspace();
  var pA = ws.projects[0];
  ws.settings.defaultProjectId = pA.id;
  ws.settings.lastProjectId = pA.id;
  ws.unknownExtensionField = { custom: 123 };
  pA.unknownProjectMeta = 'keep-me';

  var r = RecycleBin.removeProject(ws, pA.id);
  assert.strictEqual(r.workspace.settings.defaultProjectId, null, '默认启动应降级为 null');
  assert.strictEqual(r.workspace.settings.lastProjectId, null, '上次项目应降级为 null');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.workspace.unknownExtensionField)), { custom: 123 }, '保留工作区未知扩展字段');
  assert.strictEqual(r.workspace.recycleBin[0].snapshot.unknownProjectMeta, 'keep-me', '保留项目未知扩展字段');
});

test('storage_commit_failure_preserves_blob', function() {
  var ws = makeWorkspace();
  var pA = ws.projects[0];
  ws.recycleBin = [
    {
      id: 'batch-f',
      kind: 'task',
      projectId: pA.id,
      deletedAt: '2026-11-12T08:00:00.000Z',
      snapshot: {
        rootTaskId: 't-f',
        tasks: [{ id: 't-f', name: '失败任务' }],
        attachments: [
          { id: 'att-f', taskId: 't-f', name: 'f.txt', size: 10, type: 'text/plain', blobKey: 'blob-safe' }
        ]
      }
    }
  ];

  app.localStorage.setItem('pmweb_data', JSON.stringify(ws));
  Workspace.init();
  Workspace.activate(pA.id);

  // 模拟只读工作区或存储异常
  Workspace._readOnly = true;

  var blobDeleted = false;
  AttachmentStore.delete = function(key) {
    blobDeleted = true;
    return Promise.resolve();
  };

  // 尝试彻底删除
  var purgeRes = RecycleBin.purge(Workspace.data, 'batch-f');
  assert.ok(purgeRes.unreferencedBlobKeys.indexOf('blob-safe') !== -1);

  // 工作区提交失败
  assert.throws(function() {
    Workspace.commit(purgeRes.workspace);
  }, /只读/);

  // 验证 Blob 从未被删除
  assert.strictEqual(blobDeleted, false, '存储提交失败严禁删除 Blob');
});

test('project_restore_id_conflict_syncs_task_batches', function() {
  var ws = makeWorkspace();
  // 两个真实项目：p-a 与 p-b
  var pA = ws.projects.find(function(p) { return p.id === 'p-a'; });
  var pB = ws.projects.find(function(p) { return p.id === 'p-b'; });
  assert.ok(pA && pB, '需要两个初始真实项目');

  // 初始化 pA 和 pB 的任务与名称
  pA.name = '原有项目A';
  pA.data.tasks = [
    { id: 'T_A1', parentId: null, name: '项目A任务1', status: 'todo' },
    { id: 'T_A2', parentId: null, name: '项目A任务2', status: 'done' }
  ];
  pB.name = '原有项目B';
  pB.data.tasks = [
    { id: 'T_B1', parentId: null, name: '项目B任务1', status: 'todo' }
  ];

  var origProjAId = pA.id;
  var origProjBId = pB.id;

  // 1. 先在项目 A 中删除任务 T_A1
  var rTaskA = RecycleBin.removeTask(ws, origProjAId, 'T_A1');
  var taskBatchA1Id = rTaskA.batchId;
  var wsAfterTaskDel = rTaskA.workspace;

  // 2. 再删除项目 A
  var rProjA = RecycleBin.removeProject(wsAfterTaskDel, origProjAId);
  var projBatchAId = rProjA.batchId;
  var wsAfterProjDel = rProjA.workspace;

  // 3. 冲突引入：在当前工作区中引入一个 ID 同样为 origProjAId 的全新无关项目
  var conflictProject = {
    id: origProjAId,
    name: '无关冲突项目',
    description: '外部导入的同ID无关项目',
    data: {
      tasks: [
        { id: 'T_CONF_1', parentId: null, name: '冲突项目原有任务', status: 'inProgress' },
        { id: 'T_CONF_2', parentId: null, name: '冲突项目待删任务', status: 'todo' }
      ],
      milestones: [],
      links: [],
      comments: [],
      attachments: [],
      activity: []
    }
  };
  wsAfterProjDel.projects.push(conflictProject);

  // 并在该冲突项目中也删除一个任务，验证冲突项目自身的回收站批次不会被错误改动
  var rTaskConf = RecycleBin.removeTask(wsAfterProjDel, origProjAId, 'T_CONF_2');
  var taskBatchConfId = rTaskConf.batchId;
  var wsWithConflict = rTaskConf.workspace;

  // 保存冲突项目与项目 B 在恢复前的深拷贝快照，用于逐值比对不变性
  var conflictProjBefore = JSON.parse(JSON.stringify(wsWithConflict.projects.find(function(p) { return p.id === origProjAId; })));
  var projBBefore = JSON.parse(JSON.stringify(wsWithConflict.projects.find(function(p) { return p.id === origProjBId; })));
  var confBatchBefore = JSON.parse(JSON.stringify(wsWithConflict.recycleBin.find(function(b) { return b.id === taskBatchConfId; })));

  // 3.1 在原项目 A 恢复之前尝试预览与恢复旧任务批次：必须严格拦截，禁止误入同 ID 的新无关项目
  var previewTaskBeforeProjRestore = RecycleBin.previewRestore(wsWithConflict, taskBatchA1Id);
  assert.strictEqual(previewTaskBeforeProjRestore.canRestore, false, '原项目在回收站时禁止恢复其任务批次');
  assert.strictEqual(previewTaskBeforeProjRestore.blockingReason, '原项目已删除，需先恢复项目');
  assert.throws(function() {
    RecycleBin.restore(wsWithConflict, taskBatchA1Id);
  }, /原项目已删除，需先恢复项目/);

  // 4. 恢复项目 A（检测到 ID 冲突，分配新 ID）
  var previewProj = RecycleBin.previewRestore(wsWithConflict, projBatchAId);
  assert.strictEqual(previewProj.canRestore, true);
  assert.ok(previewProj.warnings.some(function(w) { return w.indexOf('冲突') !== -1; }));

  var wsAfterProjRestore = RecycleBin.restore(wsWithConflict, projBatchAId, { acceptWarnings: true });
  var restoredProjA = wsAfterProjRestore.projects.find(function(p) { return p.name === '原有项目A'; });
  assert.ok(restoredProjA, '恢复的原项目 A 必须存在');
  assert.notStrictEqual(restoredProjA.id, origProjAId, '原项目 A 恢复后必须被分配全新 ID');
  var newProjAId = restoredProjA.id;

  // 5. previewRestore 旧任务批次
  var previewTask = RecycleBin.previewRestore(wsAfterProjRestore, taskBatchA1Id);
  assert.strictEqual(previewTask.canRestore, true, '旧任务批次应当可以恢复');
  assert.strictEqual(previewTask.projectName, '原有项目A', '预览中项目名称必须指向恢复后的原项目 A，绝不能指向无关冲突项目');
  assert.strictEqual(previewTask.projectId, newProjAId, '任务批次绑定的 projectId 必须已跟随更新为新分配的项目 ID');

  // 6. restore 旧任务批次
  var wsFinal = RecycleBin.restore(wsAfterProjRestore, taskBatchA1Id, { acceptWarnings: true });

  // 7. 详细断言
  // 7.1 恢复旧项目与正确任务关联
  var finalProjA = wsFinal.projects.find(function(p) { return p.id === newProjAId; });
  assert.ok(finalProjA, '新 ID 项目 A 必须存在');
  var taskAIds = finalProjA.data.tasks.map(function(t) { return t.id; });
  assert.ok(taskAIds.indexOf('T_A1') !== -1, 'T_A1 必须成功恢复至项目 A 中');
  assert.ok(taskAIds.indexOf('T_A2') !== -1, '项目 A 原有未删任务 T_A2 必须依然存在');

  // 7.2 无关冲突项目和其他项目/批次逐值不变
  var finalConflictProj = wsFinal.projects.find(function(p) { return p.id === origProjAId; });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(finalConflictProj)), conflictProjBefore, '无关冲突项目必须逐值完全不变');

  var finalProjB = wsFinal.projects.find(function(p) { return p.id === origProjBId; });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(finalProjB)), projBBefore, '项目 B 必须逐值完全不变');

  var finalConfBatch = wsFinal.recycleBin.find(function(b) { return b.id === taskBatchConfId; });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(finalConfBatch)), confBatchBefore, '冲突项目自身的任务批次必须逐值完全不变');

  // 7.3 持久化与重载后关联仍正确
  app.localStorage.setItem('pmweb_data', JSON.stringify(wsFinal));
  Workspace.init();
  var reloadedWs = Workspace.data;
  var reloadedProjA = reloadedWs.projects.find(function(p) { return p.id === newProjAId; });
  assert.ok(reloadedProjA, '持久化重载后新 ID 项目 A 依然存在');
  var reloadedTasksA = reloadedProjA.data.tasks.map(function(t) { return t.id; });
  assert.ok(reloadedTasksA.indexOf('T_A1') !== -1, '重载后 T_A1 依然正确关联在项目 A 中');

  var reloadedConflictProj = reloadedWs.projects.find(function(p) { return p.id === origProjAId; });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(reloadedConflictProj)), conflictProjBefore, '重载后无关冲突项目依然逐值一致');
});

// 运行测试
var failures = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + t.name);
    console.log('  ' + (err && err.stack ? err.stack : err));
  }
});

console.log('\nrecycle-bin: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
