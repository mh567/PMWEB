'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var idbHelper = require('./helpers/idb-mock');

var idbMock = idbHelper.createIndexedDBMock();

var app = helper.createApp([
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
  'holiday-source.js',
  'work-calendar.js',
  'task-manager.js',
  'backup.js'
], {
  indexedDB: idbMock
});

var DataStore = app.get('DataStore');
var Workspace = app.get('Workspace');
var TaskManager = app.get('TaskManager');
var AttachmentStore = app.get('AttachmentStore');
var RecycleBin = app.get('RecycleBin');
var Backup = app.get('Backup');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function plain(val) { return JSON.parse(JSON.stringify(val)); }

async function resetEnvironment() {
  idbMock.reset();
  app.localStorage._store = {};
  await AttachmentStore.reset();
  Workspace.data = null;
  Workspace.raw = null;
  Workspace.activeProjectId = null;
  Workspace._readOnly = false;
  if (typeof Workspace._resetLockForTests === 'function') {
    Workspace._resetLockForTests();
  } else {
    Workspace._lockToken = null;
    Workspace._lockReason = null;
  }
}

function createSampleWorkspace() {
  return {
    pmweb_version: 4,
    projects: [
      {
        id: 'proj-1',
        name: '项目一',
        description: '活动项目',
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
        status: 'active',
        archived: false,
        data: {
          pmweb_version: 3,
          tasks: [
            { id: 'task-1', parentId: null, name: '任务1', status: 'todo', startDate: '2026-11-12', endDate: '2026-11-15', plannedEndDate: '2026-11-15', order: 0, progress: 0, assignee: '', description: '', customFields: { col_status: 'opt_1' } },
            { id: 'task-1-sub', parentId: 'task-1', name: '子任务1', status: 'inProgress', startDate: '2026-11-12', endDate: '2026-11-14', plannedEndDate: '2026-11-14', order: 0, progress: 50, assignee: '', description: '' }
          ],
          milestones: [
            { id: 'ms-1', taskId: 'task-1', name: '里程碑1', date: '2026-11-15', status: 'pending' }
          ],
          links: [
            { id: 'link-1', source: 'task-1-sub', target: 'task-1', type: 'FS', lag: 0 }
          ],
          views: [],
          comments: [
            { id: 'comm-1', taskId: 'task-1', author: 'tester', text: '评论内容', createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z' }
          ],
          activity: [],
          attachments: [
            { id: 'att-1', taskId: 'task-1', name: 'exact-bytes.pdf', size: 5, type: 'application/pdf', blobKey: 'blob-exact', createdAt: '2026-11-12T00:00:00.000Z' }
          ],
          settings: {
            columns: [
              { key: 'col_status', label: '自定义状态', type: 'select', builtin: false, options: [{ id: 'opt_1', label: '一级' }, { id: 'opt_2', label: '二级' }] }
            ],
            layoutVersion: 'workbench',
            gridWidth: 560
          }
        }
      },
      {
        id: 'proj-archived',
        name: '归档项目',
        description: '已归档',
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
        status: 'completed',
        archived: true,
        data: {
          pmweb_version: 3,
          tasks: [
            { id: 'task-arc', parentId: null, name: '归档任务', status: 'done', startDate: '2026-11-10', endDate: '2026-11-11', plannedEndDate: '2026-11-11', order: 0, progress: 100, assignee: '', description: '' }
          ],
          milestones: [],
          links: [],
          views: [],
          comments: [],
          activity: [],
          attachments: [
            { id: 'att-arc', taskId: 'task-arc', name: 'arc.txt', size: 3, type: 'text/plain', blobKey: 'blob-arc', createdAt: '2026-11-10T00:00:00.000Z' }
          ],
          settings: {}
        }
      }
    ],
    settings: {
      startupMode: 'fixed',
      defaultProjectId: 'proj-1',
      lastProjectId: 'proj-1'
    },
    calendar: {
      subscribed: true,
      source: 'cg-zhou/CN',
      cacheByYear: { '2026': { holidays: ['2026-01-01'] } },
      importedByYear: {},
      lastAttemptByYear: {}
    },
    recycleBin: [
      {
        id: 'trash-task-1',
        kind: 'task',
        projectId: 'proj-1',
        deletedAt: '2026-11-12T01:00:00.000Z',
        snapshot: {
          rootTaskId: 'task-del',
          tasks: [{ id: 'task-del', parentId: null, name: '已删除任务' }],
          attachments: [
            { id: 'att-del', taskId: 'task-del', name: 'shared.pdf', size: 5, type: 'application/pdf', blobKey: 'blob-exact' }
          ]
        }
      }
    ],
    legacy: {
      unknownBusinessField: 'preserved_value'
    }
  };
}

test('attachments_round_trip_exact_bytes: 字节 [0,1,127,128,255] 导出再恢复逐字节完全一致', async function() {
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  var rawBytes = [0, 1, 127, 128, 255];
  var exactBlob = new Blob([new Uint8Array(rawBytes)], { type: 'application/pdf' });
  var arcBlob = new Blob([new Uint8Array([97, 114, 99])], { type: 'text/plain' });

  // 写入现有存储与附件
  app.localStorage.setItem('pmweb_data', JSON.stringify(sampleWs));
  Workspace.init();
  Workspace.activate('proj-1');

  await AttachmentStore.put('blob-exact', exactBlob, { size: 5, type: 'application/pdf' });
  await AttachmentStore.put('blob-arc', arcBlob, { size: 3, type: 'text/plain' });

  // 1. 全量导出
  var pkg = await Backup.exportPackage({ kind: 'workspace' });
  assert.strictEqual(pkg.backupVersion, 1);
  assert.strictEqual(pkg.kind, 'workspace');
  assert.strictEqual(pkg.summary.projectCount, 2);
  assert.strictEqual(pkg.summary.attachmentCount, 2, 'blob-exact 虽然在活动项目与回收站被两次引用，导出的附件实体仅 1 份');

  // 2. 校验包合法性
  var validation = Backup.validatePackage(pkg);
  assert.strictEqual(validation.valid, true, '合法包校验必须通过');

  // 3. 在全新的空白隔离环境中进行全量恢复
  await resetEnvironment();
  Workspace.init();

  await Backup.importPackage(pkg, { target: 'replace-workspace', confirmed: true });

  // 4. 验证恢复后的项目与附件实体
  assert.strictEqual(Workspace.data.projects.length, 2);
  assert.strictEqual(Workspace.data.recycleBin.length, 1);

  var restoredProj1 = Workspace.data.projects[0];
  var restoredAtt = restoredProj1.data.attachments[0];
  assert.ok(restoredAtt, '项目附件元数据应存在');
  assert.notStrictEqual(restoredAtt.blobKey, 'blob-exact', '导入必须分配新的独立 blobKey，绝不覆旧键');

  var retrievedBlob = await AttachmentStore.get(restoredAtt.blobKey);
  assert.ok(retrievedBlob, '新 blobKey 必须可读出 Blob');
  var restoredBytes = Array.from(new Uint8Array(await retrievedBlob.arrayBuffer()));
  assert.deepStrictEqual(restoredBytes, rawBytes, '读回字节与 [0,1,127,128,255] 必须逐字节绝对一致');

  // 回收站中的同一附件应引用同一个新分配的 blobKey
  var trashAtt = Workspace.data.recycleBin[0].snapshot.attachments[0];
  assert.strictEqual(trashAtt.blobKey, restoredAtt.blobKey, '共享引用的新 blobKey 必须同步保持');
});

test('missing_blob_prevents_complete_export: 快照引用的附件在 IDB 缺失时明确拒绝并列出清单', async function() {
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  app.localStorage.setItem('pmweb_data', JSON.stringify(sampleWs));
  Workspace.init();
  Workspace.activate('proj-1');

  // 故意不写入 blob-exact 与 blob-arc
  var rejected = false;
  var errMessage = '';
  try {
    await Backup.exportPackage({ kind: 'workspace' });
  } catch (err) {
    rejected = true;
    errMessage = err.message;
  }

  assert.strictEqual(rejected, true, '缺失附件时必须拒绝完整导出');
  assert.ok(errMessage.indexOf('blob-exact') !== -1, '错误信息必须列出缺失的 blobKey');
  assert.ok(errMessage.indexOf('blob-arc') !== -1, '错误信息必须列出缺失的 blobKey');
});

test('staging_or_main_commit_failure_preserves_old_data: 注入暂存/主提交失败时旧主数据原文与旧附件完好且新暂存安全清理', async function() {
  // Case A: 写入第二个附件时事务失败
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  var oldRaw = JSON.stringify(sampleWs);
  app.localStorage.setItem('pmweb_data', oldRaw);
  Workspace.init();
  await AttachmentStore.put('blob-exact', new Blob([new Uint8Array([1, 2, 3])]), { size: 3 });
  await AttachmentStore.put('blob-arc', new Blob([new Uint8Array([4, 5, 6])]), { size: 3 });

  var pkg = await Backup.exportPackage({ kind: 'workspace' });

  // 模拟要导入一个包含 2 个附件的备份包，但写入第 2 个附件时抛错
  var targetPkg = JSON.parse(JSON.stringify(pkg));
  var key1 = targetPkg.attachments[0].key;
  var key2 = targetPkg.attachments[1].key;

  // 注入第 2 个暂存附件失败
  idbMock.setFailOnPutKey(null);
  // 当 AttachmentStore.put 被执行时，拦截并使第 2 个键失败
  var origPut = AttachmentStore.put;
  var putCount = 0;
  AttachmentStore.put = function(k, b, opt) {
    putCount++;
    if (putCount === 2) {
      return Promise.reject(new Error('注入的第 2 附件暂存写入失败'));
    }
    return origPut.call(AttachmentStore, k, b, opt);
  };

  var threw = false;
  try {
    await Backup.importPackage(targetPkg, { target: 'replace-workspace', confirmed: true });
  } catch (err) {
    threw = true;
  }
  AttachmentStore.put = origPut;
  assert.strictEqual(threw, true, '暂存失败必须向外报错');

  // 断言：原主数据完全未变
  assert.strictEqual(app.localStorage.getItem('pmweb_data'), oldRaw, '原主数据原文必须完全未变');
  assert.deepStrictEqual(plain(Workspace.data), plain(sampleWs), 'Workspace.data 必须保留原值');

  // 断言：原附件未被删除
  var oldBlob = await AttachmentStore.get('blob-exact');
  assert.ok(oldBlob, '原附件必须完好');

  // Case B: 提交前 expectedRaw 变化（并发修改或 storage 事件）拒绝提交
  await resetEnvironment();
  app.localStorage.setItem('pmweb_data', oldRaw);
  Workspace.init();
  await AttachmentStore.put('blob-exact', new Blob([new Uint8Array([1, 2, 3])]), { size: 3 });
  await AttachmentStore.put('blob-arc', new Blob([new Uint8Array([4, 5, 6])]), { size: 3 });

  // 在提交主数据前修改 localStorage 中的原文，模拟并发
  var origCommit = Workspace.commit;
  Workspace.commit = function(next, options) {
    app.localStorage.setItem('pmweb_data', '{"pmweb_version":4,"concurrent":true}');
    return origCommit.call(Workspace, next, options);
  };

  threw = false;
  try {
    await Backup.importPackage(pkg, { target: 'replace-workspace', confirmed: true });
  } catch (err) {
    threw = true;
  }
  Workspace.commit = origCommit;
  assert.strictEqual(threw, true, '并发 baseline 冲突必须拒绝提交');
});

test('write_lock_blocks_mutations_and_releases_in_finally: 写锁阻止新建/删除/更新且在 finally 彻底释放', async function() {
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  app.localStorage.setItem('pmweb_data', JSON.stringify(sampleWs));
  Workspace.init();
  Workspace.activate('proj-1');

  var lockPromise = Workspace.withWriteLock('测试导出中', async function(token) {
    // 1. 尝试新建项目必须被拦截
    var createBlocked = false;
    try {
      Workspace.createProject({ name: '并发项目' });
    } catch (err) {
      createBlocked = true;
    }
    assert.strictEqual(createBlocked, true, '写锁保护期间禁止创建项目');

    // 2. 尝试修改项目必须被拦截
    var updateBlocked = false;
    try {
      Workspace.updateProject('proj-1', { name: '并发改名' });
    } catch (err) {
      updateBlocked = true;
    }
    assert.strictEqual(updateBlocked, true, '写锁保护期间禁止更新项目');

    // 2.1 尝试删除项目必须被拦截
    var deleteProjBlocked = false;
    try {
      Workspace.deleteProject('proj-1');
    } catch (err) {
      deleteProjBlocked = true;
    }
    assert.strictEqual(deleteProjBlocked, true, '写锁保护期间禁止删除项目');

    // 3. 尝试 TaskManager 写操作必须被 assertWritable 拦截在模型边界，不得改动工作副本
    var taskCountBefore = TaskManager.data.tasks.length;
    var taskAddBlocked = false;
    try {
      TaskManager.addTask(null, '并发任务');
    } catch (err) {
      taskAddBlocked = true;
    }
    assert.strictEqual(taskAddBlocked, true, '写锁保护期间 TaskManager 写操作必须被 assertWritable 拦截');
    assert.strictEqual(TaskManager.data.tasks.length, taskCountBefore, '被拦截操作不得改动 TaskManager.data 工作副本');

    // 3.1 尝试 TaskManager 删除任务操作被拦截
    var taskDelBlocked = false;
    try {
      TaskManager.deleteTask('task-1');
    } catch (err) {
      taskDelBlocked = true;
    }
    assert.strictEqual(taskDelBlocked, true, '写锁保护期间 TaskManager 删除操作必须被拦截');
    assert.strictEqual(TaskManager.data.tasks.length, taskCountBefore);

    // 3.2 尝试回收站永久删除 purge 提交保存必须被拒绝
    var purgeRes = RecycleBin.purge(sampleWs, 'trash-task-1');
    var purgeCommitBlocked = false;
    try {
      Workspace.commit(purgeRes.workspace);
    } catch (err) {
      purgeCommitBlocked = true;
    }
    assert.strictEqual(purgeCommitBlocked, true, '写锁保护期间永久清理提交必须被拒绝');

    // 4. 尝试无 token 的 Workspace.commit 必须被拒绝
    var commitBlocked = false;
    try {
      Workspace.commit(sampleWs);
    } catch (err) {
      commitBlocked = true;
    }
    assert.strictEqual(commitBlocked, true, '无 valid token 的 commit 必须被拒绝');

    // 5. 尝试伪造 token 的 commit 必须被拒绝
    var fakeCommitBlocked = false;
    try {
      Workspace.commit(sampleWs, { lockToken: 'fake-token' });
    } catch (err) {
      fakeCommitBlocked = true;
    }
    assert.strictEqual(fakeCommitBlocked, true, '伪造 token 的 commit 必须被拒绝');

    return 'locked-work-done';
  });

  var result = await lockPromise;
  assert.strictEqual(result, 'locked-work-done');

  // 释放后验证正常写入恢复
  assert.strictEqual(Workspace.isLocked(), false, 'finally 必须释放写锁');
  var newTask = TaskManager.addTask(null, '锁释放后新建任务');
  assert.ok(newTask, '锁释放后 TaskManager 恢复可写');

  // 验证抛出异常时写锁同样在 finally 彻底释放
  var threwInLock = false;
  try {
    await Workspace.withWriteLock('异常测试', async function() {
      throw new Error('锁内抛出异常');
    });
  } catch (err) {
    threwInLock = true;
  }
  assert.strictEqual(threwInLock, true);
  assert.strictEqual(Workspace.isLocked(), false, '锁内发生异常时 finally 必须释放写锁');
});

test('single_project_import_remaps_all_references_and_preserves_globals: 单项目导入为新项目，重映射所有业务ID且全局配置不变', async function() {
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  app.localStorage.setItem('pmweb_data', JSON.stringify(sampleWs));
  Workspace.init();
  Workspace.activate('proj-1');

  var exactBlob = new Blob([new Uint8Array([0, 1, 127, 128, 255])], { type: 'application/pdf' });
  await AttachmentStore.put('blob-exact', exactBlob, { size: 5, type: 'application/pdf' });

  // 导出单项目包
  var projectPkg = await Backup.exportPackage({ kind: 'project', projectId: 'proj-1' });
  assert.strictEqual(projectPkg.kind, 'project');
  assert.strictEqual(projectPkg.summary.projectCount, 1);
  assert.strictEqual(projectPkg.attachments.length, 1);

  // 导入单项目包到当前工作区
  var initialProjCount = Workspace.data.projects.length;
  var initialStartupSettings = JSON.parse(JSON.stringify(Workspace.data.settings));
  var initialCalendar = JSON.parse(JSON.stringify(Workspace.data.calendar));

  await Backup.importPackage(projectPkg, { target: 'new-project', confirmed: true });

  // 断言：项目数增加 1，全局偏好与全局日历绝不改动
  assert.strictEqual(Workspace.data.projects.length, initialProjCount + 1, '应增加一个新项目');
  assert.deepStrictEqual(plain(Workspace.data.settings), plain(initialStartupSettings), '单项目导入绝不改动全局启动偏好');
  assert.deepStrictEqual(plain(Workspace.data.calendar), plain(initialCalendar), '单项目导入绝不改动全局日历');

  var importedProject = Workspace.data.projects[Workspace.data.projects.length - 1];
  assert.notStrictEqual(importedProject.id, 'proj-1', '项目 ID 必须重映射为全新 ID');

  var impTasks = importedProject.data.tasks;
  assert.strictEqual(impTasks.length, 2);
  var impTask1 = impTasks.find(function(t) { return t.name === '任务1'; });
  var impSubTask = impTasks.find(function(t) { return t.name === '子任务1'; });
  assert.notStrictEqual(impTask1.id, 'task-1', '任务 ID 必须重映射');
  assert.notStrictEqual(impSubTask.id, 'task-1-sub', '子任务 ID 必须重映射');
  assert.strictEqual(impSubTask.parentId, impTask1.id, '父子级引用必须修复为新任务 ID');

  var impMilestone = importedProject.data.milestones[0];
  assert.strictEqual(impMilestone.taskId, impTask1.id, '里程碑 taskId 必须指向新任务 ID');

  var impLink = importedProject.data.links[0];
  assert.strictEqual(impLink.source, impSubTask.id, '依赖 source 必须指向新子任务 ID');
  assert.strictEqual(impLink.target, impTask1.id, '依赖 target 必须指向新任务 ID');

  var impComment = importedProject.data.comments[0];
  assert.strictEqual(impComment.taskId, impTask1.id, '评论 taskId 必须指向新任务 ID');

  var impAttachment = importedProject.data.attachments[0];
  assert.strictEqual(impAttachment.taskId, impTask1.id, '附件 taskId 必须指向新任务 ID');
  assert.notStrictEqual(impAttachment.blobKey, 'blob-exact', '附件 blobKey 必须使用本次新键');

  // 自定义列选项引用重映射
  var opt1 = importedProject.data.settings.columns[0].options[0];
  assert.notStrictEqual(opt1.id, 'opt_1', '选项 ID 必须重映射');
  assert.strictEqual(impTask1.customFields.col_status, opt1.id, '任务自定义字段中的选项 ID 必须同步更新');
});

test('bad_package_prevalidation_zero_writes: 高版本/坏引用/缺少附件预校验失败且零写入', async function() {
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  var initialRaw = JSON.stringify(sampleWs);
  app.localStorage.setItem('pmweb_data', initialRaw);
  Workspace.init();

  // 1. 高版本包
  var highPkg = { backupVersion: 99, kind: 'workspace', exportedAt: new Date().toISOString(), payload: {}, attachments: [] };
  var v1 = Backup.validatePackage(highPkg);
  assert.strictEqual(v1.valid, false, '高版本包必须验证失败');
  var threw = false;
  try {
    await Backup.importPackage(highPkg, { target: 'replace-workspace', confirmed: true });
  } catch (err) {
    threw = true;
  }
  assert.strictEqual(threw, true);
  assert.strictEqual(app.localStorage.getItem('pmweb_data'), initialRaw, '零写入存储');

  // 2. 坏引用（任务父级不存在）
  var badRefPkg = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p-bad',
        name: '坏引用项目',
        data: {
          tasks: [{ id: 't-1', parentId: 'non-existent-parent', name: '悬空任务' }],
          attachments: []
        }
      }
    },
    attachments: []
  };
  var v2 = Backup.validatePackage(badRefPkg);
  assert.strictEqual(v2.valid, false, '悬空坏引用必须验证失败');

  // 3. confirmed: false 零写入
  var validPkg = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p-valid',
        name: '合法项目',
        data: { tasks: [{ id: 't-ok', parentId: null, name: '任务' }], attachments: [] }
      }
    },
    attachments: []
  };
  var unconfirmedThrew = false;
  try {
    await Backup.importPackage(validPkg, { target: 'new-project', confirmed: false });
  } catch (err) {
    unconfirmedThrew = true;
  }
  assert.strictEqual(unconfirmedThrew, true, 'confirmed false 必须拒绝');
  assert.strictEqual(app.localStorage.getItem('pmweb_data'), initialRaw, 'confirmed false 零写入存储');
});

test('corrupt_raw_storage_recovery: 损坏存储只读模式下允许已确认的完整备份恢复且不写空覆盖原文', async function() {
  await resetEnvironment();
  var corruptText = '{"invalid_json: 12345';
  app.localStorage.setItem('pmweb_data', corruptText);

  var res = Workspace.init();
  assert.strictEqual(res.readOnly, true, '初始化损坏数据必须为只读模式');
  assert.strictEqual(Workspace.isReadOnly(), true);

  // 普通写入仍然被严格拦截
  var createBlocked = false;
  try {
    Workspace.createProject({ name: '禁止写入' });
  } catch (err) {
    createBlocked = true;
  }
  assert.strictEqual(createBlocked, true, '损坏状态下普通写入必须被严格拦截');
  assert.strictEqual(app.localStorage.getItem('pmweb_data'), corruptText, '原损坏文本不得被空值覆盖');

  // 执行已确认的全量备份恢复路径
  var sampleWs = createSampleWorkspace();
  var pkg = {
    backupVersion: 1,
    kind: 'workspace',
    exportedAt: new Date().toISOString(),
    payload: sampleWs,
    attachments: [
      { key: 'blob-exact', name: 'exact.pdf', type: 'application/pdf', size: 5, base64: Buffer.from(new Uint8Array([0, 1, 127, 128, 255])).toString('base64') },
      { key: 'blob-arc', name: 'arc.txt', type: 'text/plain', size: 3, base64: Buffer.from('arc').toString('base64') }
    ],
    summary: { projectCount: 2, attachmentCount: 2, totalBytes: 8 }
  };

  await Backup.importPackage(pkg, { target: 'replace-workspace', confirmed: true });

  // 恢复成功后工作区脱离只读模式，主数据成功更新
  assert.strictEqual(Workspace.isReadOnly(), false, '已确认恢复完成后解除只读状态');
  assert.strictEqual(Workspace.data.projects.length, 2);
  assert.notStrictEqual(app.localStorage.getItem('pmweb_data'), corruptText, '恢复后写入合法数据');
});

test('legacy_json_without_blobs_shows_missing_in_preview: 历史 JSON 无实体仅预览列出缺失不冒称文件存在', function() {
  var legacyPkg = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p-leg',
        name: '历史项目',
        data: {
          tasks: [{ id: 't-1', parentId: null, name: '任务' }],
          attachments: [
            { id: 'att-old', taskId: 't-1', name: 'lost.pdf', size: 1024, type: 'application/pdf', blobKey: 'blob-lost' }
          ]
        }
      }
    },
    attachments: [] // 无实体
  };

  var validation = Backup.validatePackage(legacyPkg);
  assert.strictEqual(validation.valid, false, '缺少附件实体必须标记不合法');
  assert.ok(validation.preview.missingAttachments.length > 0, '预览中必须列出缺失附件');
  assert.strictEqual(validation.preview.missingAttachments[0].name, 'lost.pdf');
});

test('unknown_target_rejected_without_writes: project与workspace包对非法target逐一拒绝且零调用零修改', async function() {
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  var originalRaw = JSON.stringify(sampleWs);
  app.localStorage.setItem('pmweb_data', originalRaw);
  Workspace.init();
  Workspace.activate('proj-1');

  // 预写入旧 Blob，验证后续拒绝时旧数据绝对完好
  var initialBlobBytes = new Uint8Array([10, 20, 30]);
  await AttachmentStore.put('blob-exact', new Blob([initialBlobBytes]), { size: 3, type: 'application/pdf' });

  var singleProjectPkg = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p-bad-target',
        name: '非法目标单项目',
        data: {
          tasks: [{ id: 't-1', parentId: null, name: '任务1', startDate: '2026-11-12', endDate: '2026-11-15', plannedEndDate: '2026-11-15', order: 0, progress: 0, assignee: '', description: '' }],
          attachments: []
        }
      }
    },
    attachments: []
  };

  var workspacePkg = {
    backupVersion: 1,
    kind: 'workspace',
    exportedAt: new Date().toISOString(),
    payload: createSampleWorkspace(),
    attachments: [
      { key: 'blob-exact', name: 'exact-bytes.pdf', type: 'application/pdf', size: 5, base64: Buffer.from(new Uint8Array([0, 1, 127, 128, 255])).toString('base64') },
      { key: 'blob-arc', name: 'arc.txt', type: 'text/plain', size: 3, base64: Buffer.from('arc').toString('base64') }
    ]
  };

  var testPackages = [
    { label: 'project', pkg: singleProjectPkg },
    { label: 'workspace', pkg: workspacePkg }
  ];

  var invalidTargets = ['', null, false, 0, NaN, {}, [], 'new_project'];

  for (var p = 0; p < testPackages.length; p++) {
    var pItem = testPackages[p];
    for (var i = 0; i < invalidTargets.length; i++) {
      var badTarget = invalidTargets[i];

      var putCalls = 0;
      var deleteCalls = 0;
      var commitCalls = 0;
      var origPut = AttachmentStore.put;
      var origDelete = AttachmentStore.delete;
      var origCommit = Workspace.commit;

      AttachmentStore.put = function() {
        putCalls++;
        return origPut.apply(AttachmentStore, arguments);
      };
      AttachmentStore.delete = function() {
        deleteCalls++;
        return origDelete.apply(AttachmentStore, arguments);
      };
      Workspace.commit = function() {
        commitCalls++;
        return origCommit.apply(Workspace, arguments);
      };

      var threw = false;
      var errorMsg = '';
      try {
        await Backup.importPackage(pItem.pkg, { target: badTarget, confirmed: true });
      } catch (err) {
        threw = true;
        errorMsg = err.message || '';
      } finally {
        AttachmentStore.put = origPut;
        AttachmentStore.delete = origDelete;
        Workspace.commit = origCommit;
      }

      var targetDesc = (typeof badTarget === 'number' && isNaN(badTarget)) ? 'NaN' : JSON.stringify(badTarget);
      assert.strictEqual(threw, true, pItem.label + ' 包传入非法 target ' + targetDesc + ' 必须抛错拒绝');
      assert.ok(errorMsg.indexOf('未知的导入目标类型') !== -1, pItem.label + ' 包传入非法 target ' + targetDesc + ' 必须提示未知的导入目标类型，实际提示: ' + errorMsg);
      assert.strictEqual(app.localStorage.getItem('pmweb_data'), originalRaw, pItem.label + ' 包在 target ' + targetDesc + ' 下 localStorage 原文不得变化');
      assert.deepStrictEqual(plain(Workspace.data), plain(sampleWs), pItem.label + ' 包在 target ' + targetDesc + ' 下 Workspace 业务对象不得变化');

      var checkBlob = await AttachmentStore.get('blob-exact');
      assert.ok(checkBlob, '旧 Blob 必须完好存在');
      var checkBytes = new Uint8Array(await checkBlob.arrayBuffer());
      assert.deepStrictEqual(Array.from(checkBytes), [10, 20, 30], '旧 Blob 二进制字节不得被修改');

      assert.strictEqual(putCalls, 0, pItem.label + ' 包在 target ' + targetDesc + ' 下 AttachmentStore.put 必须零调用');
      assert.strictEqual(deleteCalls, 0, pItem.label + ' 包在 target ' + targetDesc + ' 下 AttachmentStore.delete 必须零调用');
      assert.strictEqual(commitCalls, 0, pItem.label + ' 包在 target ' + targetDesc + ' 下 Workspace.commit 必须零调用');
    }
  }
});

test('target_default_and_explicit_legal_values: 省略target与undefined依pkg.kind约定默认且合法显式值正常成功', async function() {
  // 1. 单项目包：省略 target
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  app.localStorage.setItem('pmweb_data', JSON.stringify(sampleWs));
  Workspace.init();
  Workspace.activate('proj-1');

  var projectPkg = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p-default',
        name: '缺省导入单项目',
        data: {
          tasks: [{ id: 't-def-1', parentId: null, name: '任务Def', startDate: '2026-11-12', endDate: '2026-11-15', plannedEndDate: '2026-11-15', order: 0, progress: 0, assignee: '', description: '' }],
          attachments: []
        }
      }
    },
    attachments: []
  };

  await Backup.importPackage(projectPkg, { confirmed: true });
  assert.strictEqual(Workspace.data.projects.length, 3, '省略 target 单项目包默认作为 new-project 导入');

  // 2. 单项目包：显式 target: undefined
  await Backup.importPackage(projectPkg, { target: undefined, confirmed: true });
  assert.strictEqual(Workspace.data.projects.length, 4, 'target 为 undefined 单项目包默认作为 new-project 导入');

  // 3. 单项目包：显式 target: 'new-project'
  await Backup.importPackage(projectPkg, { target: 'new-project', confirmed: true });
  assert.strictEqual(Workspace.data.projects.length, 5, '显式 target new-project 导入成功');

  // 4. 单项目包：显式 target: 'replace-workspace' 契约拒绝
  var threwKind = false;
  try {
    await Backup.importPackage(projectPkg, { target: 'replace-workspace', confirmed: true });
  } catch (err) {
    threwKind = true;
    assert.ok(err.message.indexOf('单项目备份包不支持作为全量工作区替换') !== -1);
  }
  assert.strictEqual(threwKind, true, '单项目包传入 replace-workspace 必须被阻断');

  // 5. 全量包：省略 target 默认作为 replace-workspace 成功
  var wsPkg = {
    backupVersion: 1,
    kind: 'workspace',
    exportedAt: new Date().toISOString(),
    payload: createSampleWorkspace(),
    attachments: [
      { key: 'blob-exact', name: 'exact-bytes.pdf', type: 'application/pdf', size: 5, base64: Buffer.from(new Uint8Array([0, 1, 127, 128, 255])).toString('base64') },
      { key: 'blob-arc', name: 'arc.txt', type: 'text/plain', size: 3, base64: Buffer.from('arc').toString('base64') }
    ]
  };
  await Backup.importPackage(wsPkg, { confirmed: true });
  assert.strictEqual(Workspace.data.projects.length, 2, '省略 target 全量包默认作为 replace-workspace 替换成功');

  // 6. 全量包：显式 target: undefined 默认作为 replace-workspace 成功
  await Backup.importPackage(wsPkg, { target: undefined, confirmed: true });
  assert.strictEqual(Workspace.data.projects.length, 2, 'target 为 undefined 全量包默认作为 replace-workspace 替换成功');

  // 7. 全量包：显式 target: 'replace-workspace' 成功
  await Backup.importPackage(wsPkg, { target: 'replace-workspace', confirmed: true });
  assert.strictEqual(Workspace.data.projects.length, 2, '显式 target replace-workspace 替换成功');

  // 8. 全量包：显式 target: 'new-project' 导入其中第一个项目
  await Backup.importPackage(wsPkg, { target: 'new-project', confirmed: true });
  assert.strictEqual(Workspace.data.projects.length, 3, '全量包显式 target new-project 导入单个项目成功');
});

test('write_lock_covers_entire_import_lifecycle: 写锁必须覆盖附件暂存与重映射全周期且拦截外部修改', async function() {
  await resetEnvironment();
  var sampleWs = createSampleWorkspace();
  sampleWs.projects[0].data.attachments = [
    { id: 'att-1', taskId: 'task-1', name: 'lock.pdf', size: 4, type: 'application/pdf', blobKey: 'blob-staging-lock' }
  ];
  sampleWs.projects.splice(1, 1);
  sampleWs.recycleBin = [];
  app.localStorage.setItem('pmweb_data', JSON.stringify(sampleWs));
  Workspace.init();
  Workspace.activate('proj-1');

  var pkg = {
    backupVersion: 1,
    kind: 'workspace',
    exportedAt: new Date().toISOString(),
    payload: sampleWs,
    attachments: [
      { key: 'blob-staging-lock', name: 'lock.pdf', type: 'application/pdf', size: 4, base64: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64') }
    ]
  };

  var origPut = AttachmentStore.put;
  var isLockedDuringPut = null;
  var addTaskBlocked = false;

  AttachmentStore.put = async function(key, blob, opt) {
    isLockedDuringPut = Workspace.isLocked();
    try {
      TaskManager.addTask(null, '并发写任务');
    } catch (err) {
      if (err.message.indexOf('写锁保护') !== -1 || err.message.indexOf('不可写入') !== -1) {
        addTaskBlocked = true;
      }
    }
    return origPut.call(AttachmentStore, key, blob, opt);
  };

  try {
    await Backup.importPackage(pkg, { target: 'replace-workspace', confirmed: true });
  } finally {
    AttachmentStore.put = origPut;
  }

  assert.strictEqual(isLockedDuringPut, true, 'IDB 暂存期间 Workspace.isLocked 必须为 true');
  assert.strictEqual(addTaskBlocked, true, 'IDB 暂存期间外部 TaskManager.addTask 必须被写锁拦截');
  assert.strictEqual(Workspace.isLocked(), false, '导入完成后写锁必须已正常释放');
});

test('staged_readback_exact_byte_comparison: 暂存读回时同长度但字节内容损坏必须被拒绝并清理暂存', async function() {
  await resetEnvironment();
  var originalBytes = new Uint8Array([1, 2, 3, 4, 5]);
  var sampleWs = createSampleWorkspace();
  sampleWs.projects[0].data.attachments = [
    { id: 'att-1', taskId: 'task-1', name: 'corrupt.pdf', size: 5, type: 'application/pdf', blobKey: 'blob-corrupt-bytes' }
  ];
  sampleWs.projects.splice(1, 1);
  sampleWs.recycleBin = [];
  app.localStorage.setItem('pmweb_data', JSON.stringify(sampleWs));
  Workspace.init();
  Workspace.activate('proj-1');

  var pkg = {
    backupVersion: 1,
    kind: 'workspace',
    exportedAt: new Date().toISOString(),
    payload: sampleWs,
    attachments: [
      { key: 'blob-corrupt-bytes', name: 'corrupt.pdf', type: 'application/pdf', size: 5, base64: Buffer.from(originalBytes).toString('base64') }
    ]
  };

  var origGet = AttachmentStore.get;
  var corruptBytes = new Uint8Array([0, 0, 0, 0, 0]); // 相同长度 5，但内容不一致
  AttachmentStore.get = async function(key) {
    return new Blob([corruptBytes], { type: 'application/pdf' });
  };

  var threw = false;
  try {
    await Backup.importPackage(pkg, { target: 'replace-workspace', confirmed: true });
  } catch (err) {
    threw = true;
    assert.ok(err.message.indexOf('字节内容不一致') !== -1 || err.message.indexOf('不一致') !== -1, '必须提示字节内容不一致');
  } finally {
    AttachmentStore.get = origGet;
  }

  assert.strictEqual(threw, true, '同长度但内容损坏必须抛出异常拒绝导入');
  var storeData = idbMock.getStoreData('pmweb-attachments', 'blobs');
  assert.strictEqual(storeData.size, 0, '读回校验失败后本次暂存的所有新键必须被清理');
});

test('validate_package_rejects_duplicate_ids: 校验必须拒绝重复项目ID、同项目重复任务ID与重复附件Key', function() {
  // 1. 同项目内重复任务 ID
  var pkgDupTasks = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p1', name: '重ID任务项目',
        data: {
          tasks: [
            { id: 't1', parentId: null, name: '任务1' },
            { id: 't1', parentId: null, name: '重复任务1' }
          ],
          attachments: []
        }
      }
    },
    attachments: []
  };
  var resTasks = Backup.validatePackage(pkgDupTasks);
  assert.strictEqual(resTasks.valid, false, '同项目重复任务 ID 必须拒绝');
  assert.ok(resTasks.errors.some(function(e) { return e.indexOf('重复') !== -1 && e.indexOf('t1') !== -1; }));

  // 2. 重复附件 key
  var pkgDupAtts = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p1', name: '重附件项目',
        data: {
          tasks: [{ id: 't1', parentId: null }],
          attachments: [{ id: 'a1', taskId: 't1', blobKey: 'k1' }]
        }
      }
    },
    attachments: [
      { key: 'k1', name: 'f1.pdf', size: 3, type: 'application/pdf', base64: Buffer.from('123').toString('base64') },
      { key: 'k1', name: 'f2.pdf', size: 3, type: 'application/pdf', base64: Buffer.from('456').toString('base64') }
    ]
  };
  var resAtts = Backup.validatePackage(pkgDupAtts);
  assert.strictEqual(resAtts.valid, false, '重复附件 key 必须拒绝');
  assert.ok(resAtts.errors.some(function(e) { return e.indexOf('重复') !== -1 && e.indexOf('k1') !== -1; }));

  // 3. 全量备份重复项目 ID
  var pkgDupProjects = {
    backupVersion: 1,
    kind: 'workspace',
    exportedAt: new Date().toISOString(),
    payload: {
      projects: [
        { id: 'p1', name: '项目1', data: { tasks: [], attachments: [] } },
        { id: 'p1', name: '重复项目1', data: { tasks: [], attachments: [] } }
      ]
    },
    attachments: []
  };
  var resProjects = Backup.validatePackage(pkgDupProjects);
  assert.strictEqual(resProjects.valid, false, '重复项目 ID 必须拒绝');
  assert.ok(resProjects.errors.some(function(e) { return e.indexOf('重复') !== -1 && e.indexOf('p1') !== -1; }));
});

test('validate_package_rejects_dangling_custom_field_options: 任务 customFields 引用不存在的单选选项必须被拒绝', function() {
  var pkgBadOption = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p1', name: '坏选项引用项目',
        data: {
          tasks: [
            { id: 't1', parentId: null, name: '任务1', customFields: { col_status: 'opt_invalid_404' } }
          ],
          attachments: [],
          settings: {
            columns: [
              { key: 'col_status', label: '状态', type: 'select', options: [{ id: 'opt_1', label: '有效' }] }
            ]
          }
        }
      }
    },
    attachments: []
  };

  var res = Backup.validatePackage(pkgBadOption);
  assert.strictEqual(res.valid, false, '引用不存在的单选选项 ID 必须拒绝');
  assert.ok(res.errors.some(function(e) { return e.indexOf('opt_invalid_404') !== -1; }));
  assert.ok(res.preview.invalidReferences.length > 0, 'preview.invalidReferences 需记录坏引用');

  // 空值或合法选项应通过
  var pkgGoodOption = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p1', name: '好选项引用项目',
        data: {
          tasks: [
            { id: 't1', parentId: null, name: '任务1', customFields: { col_status: 'opt_1' } },
            { id: 't2', parentId: null, name: '任务2', customFields: { col_status: '' } }
          ],
          attachments: [],
          settings: {
            columns: [
              { key: 'col_status', label: '状态', type: 'select', options: [{ id: 'opt_1', label: '有效' }] }
            ]
          }
        }
      }
    },
    attachments: []
  };
  var resGood = Backup.validatePackage(pkgGoodOption);
  assert.strictEqual(resGood.valid, true, '合法选项或空选项应当通过校验');
});

test('validate_package_strict_base64: 非法 Base64 字符必须被拒绝', function() {
  var pkgCorruptBase64 = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p1', name: '坏base64项目',
        data: { tasks: [{ id: 't1', parentId: null }], attachments: [{ id: 'a1', taskId: 't1', blobKey: 'k1' }] }
      }
    },
    attachments: [
      { key: 'k1', name: 'f.pdf', size: 12, type: 'application/pdf', base64: '###NOT-VALID-BASE64###' }
    ]
  };

  var res = Backup.validatePackage(pkgCorruptBase64);
  assert.strictEqual(res.valid, false, '非法 base64 字符必须被拒绝');
  assert.ok(res.errors.some(function(e) { return e.indexOf('Base64') !== -1; }));
});

test('workspace_lock_token_private_closure: Workspace._lockToken 不应直接暴露给外部借用', async function() {
  await resetEnvironment();
  assert.strictEqual(Workspace.isLocked(), false);
  var lockObserved = false;
  await Workspace.withWriteLock('test-private-lock', function(token) {
    assert.strictEqual(Workspace.isLocked(), true);
    assert.strictEqual(Workspace._lockToken, undefined, '_lockToken 属性不应公开挂在 Workspace 对象上');
    lockObserved = true;
  });
  assert.strictEqual(lockObserved, true);
  assert.strictEqual(Workspace.isLocked(), false);
});

test('import_package_null_workspace_data_guard: Workspace.data 为 null 时导入新项目必须优雅报错而不是抛未捕获 TypeError', async function() {
  await resetEnvironment();
  Workspace.data = null;

  var validPkg = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    payload: {
      project: {
        id: 'p-valid',
        name: '合法项目',
        data: { tasks: [{ id: 't-ok', parentId: null, name: '任务' }], attachments: [] }
      }
    },
    attachments: []
  };

  var threw = false;
  try {
    await Backup.importPackage(validPkg, { target: 'new-project', confirmed: true });
  } catch (err) {
    threw = true;
    assert.ok(err.message.indexOf('工作区未初始化') !== -1, '错误信息应为优雅提示: ' + err.message);
  }
  assert.strictEqual(threw, true, 'Workspace.data 为 null 必须被防御性拦截');
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
      console.log('FAIL ' + t.name + ': ' + err.message);
      if (err.stack) console.log(err.stack);
    }
  }
  console.log('\nbackup: ' + (tests.length - failures) + '/' + tests.length + ' passed');
  process.exit(failures === 0 ? 0 : 1);
}

run();
