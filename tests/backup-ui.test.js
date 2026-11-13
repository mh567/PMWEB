'use strict';

var assert = require('assert');
var helper = require('./helpers/load');
var lw = require('./helpers/load-workspace');
var domMock = require('./helpers/dom-mock');
var makeWorkspace = lw.makeWorkspace;

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function setupBackupEnv(options) {
  options = options || {};
  var dom = domMock.createDomEnvironment();
  var doc = dom.doc;
  var body = dom.body;

  var indexHtml = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  var tStart = indexHtml.indexOf('<div id="toolbar"');
  var tContentStart = indexHtml.indexOf('>', tStart) + 1;
  var tEnd = indexHtml.indexOf('<!-- CONTEXT BAR');
  var lastDiv = indexHtml.lastIndexOf('</div>', tEnd);
  var toolbarInner = indexHtml.substring(tContentStart, lastDiv);

  var cStart = indexHtml.indexOf('<div id="context-bar"');
  var cContentStart = indexHtml.indexOf('>', cStart) + 1;
  var cEnd = indexHtml.indexOf('<!-- MAIN CONTAINER');
  var cLastDiv = indexHtml.lastIndexOf('</div>', cEnd);
  var contextInner = indexHtml.substring(cContentStart, cLastDiv);

  var toolbar = dom.makeElement('DIV', { id: 'toolbar', class: 'toolbar' });
  toolbar.innerHTML = toolbarInner;

  var contextBar = dom.makeElement('DIV', { id: 'context-bar', class: 'context-bar' });
  contextBar.innerHTML = contextInner;
  var mainContainer = dom.makeElement('DIV', { id: 'main-container', class: 'main-container' });
  var workbench = dom.makeElement('DIV', { id: 'workbench', class: 'workbench' });
  var gridPane = dom.makeElement('DIV', { id: 'grid-pane', class: 'grid-pane' });
  var gridHeader = dom.makeElement('DIV', { id: 'grid-header', class: 'pane-header' });
  var gridBody = dom.makeElement('DIV', { id: 'grid-body', class: 'pane-body' });
  gridPane.appendChild(gridHeader);
  gridPane.appendChild(gridBody);

  var datePanels = dom.makeElement('DIV', { id: 'date-panels', class: 'date-panels' });
  var timelinePane = dom.makeElement('DIV', { id: 'timeline-pane', class: 'timeline-pane' });
  var timelineHeader = dom.makeElement('DIV', { id: 'timeline-header', class: 'pane-header' });
  var timelineBody = dom.makeElement('DIV', { id: 'timeline-body', class: 'pane-body' });
  timelinePane.appendChild(timelineHeader);
  timelinePane.appendChild(timelineBody);

  var calendarPanel = dom.makeElement('DIV', { id: 'calendar-panel', class: 'calendar-panel' });
  datePanels.appendChild(timelinePane);
  datePanels.appendChild(calendarPanel);

  workbench.appendChild(gridPane);
  workbench.appendChild(datePanels);

  var todosSidebar = dom.makeElement('DIV', { id: 'todos-sidebar', class: 'todos-sidebar' });
  var todosHeader = dom.makeElement('DIV', { id: 'todos-sidebar-header' });
  var todosTitle = dom.makeElement('H3');
  todosTitle.textContent = '今日节点';
  todosHeader.appendChild(todosTitle);
  var todosList = dom.makeElement('DIV', { id: 'todos-list' });
  todosSidebar.appendChild(todosHeader);
  todosSidebar.appendChild(todosList);

  mainContainer.appendChild(workbench);
  mainContainer.appendChild(todosSidebar);

  var statusBar = dom.makeElement('DIV', { id: 'status-bar' });
  var statusText = dom.makeElement('SPAN', { id: 'status-text' });
  var statusInfo = dom.makeElement('SPAN', { id: 'status-info' });
  statusBar.appendChild(statusText);
  statusBar.appendChild(statusInfo);

  var treeContainer = dom.makeElement('DIV', { id: 'tree-container', hidden: 'true' });
  body.appendChild(treeContainer);
  var contextMenu = dom.makeElement('DIV', { id: 'context-menu', class: 'context-menu' });
  body.appendChild(contextMenu);

  body.appendChild(toolbar);
  body.appendChild(contextBar);
  body.appendChild(mainContainer);
  body.appendChild(statusBar);

  var wsData = options.workspaceData || makeWorkspace();
  var appEnv = helper.createApp([
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
    'backup.js',
    'app.js'
  ], {
    localStorage: options.localStorage,
    indexedDB: options.indexedDB
  });

  appEnv.context.document = doc;
  appEnv.context.window = {
    location: { hash: '', search: '', pathname: '/' },
    addEventListener: function(evt, fn) { doc.addEventListener(evt, fn); },
    removeEventListener: function(evt, fn) { doc.removeEventListener(evt, fn); }
  };

  var downloads = [];
  appEnv.context.App = appEnv.get('App');
  if (options.mockDownload !== false) {
    appEnv.context.App._downloadFile = function(filename, content, type) {
      downloads.push({ filename: filename, content: content, type: type });
    };
  }

  if (options.initialRaw !== undefined) {
    if (options.initialRaw !== null) {
      appEnv.localStorage.setItem('pmweb_data', options.initialRaw);
    }
  } else {
    appEnv.localStorage.setItem('pmweb_data', JSON.stringify(wsData));
  }

  var Workspace = appEnv.get('Workspace');
  var TaskManager = appEnv.get('TaskManager');
  var App = appEnv.get('App');
  var ModalManager = appEnv.get('ModalManager');
  var Backup = appEnv.get('Backup');
  var AttachmentStore = appEnv.get('AttachmentStore');

  return {
    appEnv: appEnv,
    dom: dom,
    doc: doc,
    body: body,
    downloads: downloads,
    Workspace: Workspace,
    TaskManager: TaskManager,
    App: App,
    ModalManager: ModalManager,
    Backup: Backup,
    AttachmentStore: AttachmentStore
  };
}

function makeFakeFile(name, contentStr) {
  return {
    name: name,
    size: Buffer.byteLength(contentStr, 'utf8'),
    type: 'application/json',
    text: function() { return Promise.resolve(contentStr); }
  };
}

// -------------------------------------------------------------
// 场景 3: async_import_targets_original_project 与导入导出完整性
// -------------------------------------------------------------
test('async_import_targets_original_project: 预览完整性、确认前零写、切项目异步隔离与单项目新项目语义', async function() {
  var env = setupBackupEnv();
  var App = env.App;
  var Workspace = env.Workspace;
  var doc = env.doc;
  var appEnv = env.appEnv;

  App.init();
  Workspace.activate('p-a');

  // 为 fixture 中的默认附件 blobKey 填充存储实体，确保 exportPackage 能够读取
  if (env.AttachmentStore && typeof env.AttachmentStore.put === 'function') {
    var BlobConstructor = env.appEnv.context.Blob || (typeof Blob !== 'undefined' ? Blob : null);
    if (BlobConstructor) {
      await env.AttachmentStore.put('blob-a', new BlobConstructor([Buffer.alloc(100)]), { size: 100, type: 'text/plain' });
    }
  }

  // 1. App.exportBackup 接口测试
  // 导出工作区完整备份
  await App.exportBackup('workspace');
  assert.strictEqual(env.downloads.length, 1, '导出工作区备份应触发一次文件下载');
  assert.ok(env.downloads[0].filename.indexOf('pmweb-backup-workspace') !== -1, '文件名包含 workspace 标识');
  var exportedWsPkg = JSON.parse(env.downloads[0].content);
  assert.strictEqual(exportedWsPkg.kind, 'workspace');
  assert.strictEqual(exportedWsPkg.backupVersion, 1);
  assert.ok(Array.isArray(exportedWsPkg.payload.projects), '包含项目列表');

  // 导出单项目备份
  await App.exportBackup('project');
  assert.strictEqual(env.downloads.length, 2, '导出单项目备份应触发一次文件下载');
  assert.ok(env.downloads[1].filename.indexOf('pmweb-backup-project') !== -1, '文件名包含 project 标识');
  var exportedProjPkg = JSON.parse(env.downloads[1].content);
  assert.strictEqual(exportedProjPkg.kind, 'project');
  assert.strictEqual((exportedProjPkg.payload.project || exportedProjPkg.payload).name, '项目 A');

  // 导出失败时不下载伪完整包
  var origExport = env.Backup.exportPackage;
  env.Backup.exportPackage = function() {
    return Promise.reject(new Error('模拟附件缺失阻断导出'));
  };
  try {
    await App.exportBackup('workspace');
  } catch (e) {}
  assert.strictEqual(env.downloads.length, 2, '导出失败绝不得下载伪完整包');
  env.Backup.exportPackage = origExport;

  // 2. App.previewImport 预览结构与确认前零写
  var validProjPkg = {
    backupVersion: 1,
    kind: 'project',
    exportedAt: '2026-11-12T00:00:00.000Z',
    payload: {
      id: 'p-external',
      name: '外部导入项目',
      data: {
        tasks: [{ id: 't-ext-1', name: '外部任务 1', status: 'todo' }],
        milestones: [],
        links: [],
        attachments: []
      }
    },
    attachments: [],
    summary: { projectCount: 1, attachmentCount: 0, totalBytes: 0 }
  };

  var fakeFile = makeFakeFile('project-import.json', JSON.stringify(validProjPkg));

  var rawBefore = appEnv.localStorage.getItem('pmweb_data');
  var projectsBeforeCount = Workspace.data.projects.length;

  // 调用 previewImport
  await App.previewImport(fakeFile);

  // 确认前零写入
  assert.strictEqual(appEnv.localStorage.getItem('pmweb_data'), rawBefore, '导入确认前不得写入 localStorage');
  assert.strictEqual(Workspace.data.projects.length, projectsBeforeCount, '导入确认前不得添加项目');

  // 检验预览弹窗内容：类型、项目名、替换范围说明与导出备份入口
  var previewEl = doc.querySelector('.backup-import-preview, #backup-preview-box, .modal-box');
  assert.ok(previewEl, '必须弹出备份预览对话框');
  var previewHtml = previewEl.innerHTML;
  assert.ok(previewHtml.indexOf('外部导入项目') !== -1, '预览中包含导入项目名称');
  assert.ok(previewHtml.indexOf('单项目') !== -1, '预览中显示包类型为单项目');
  assert.ok(previewHtml.indexOf('新项目') !== -1, '单项目导入明确展示「新项目」范围');
  assert.ok(previewHtml.indexOf('导出现有完整备份') !== -1 || previewHtml.indexOf('导出备份') !== -1, '必须提供导出现有备份入口');

  // 3. 异步切项目隔离测试：用户在弹窗等待确认期间切换了项目
  // 模拟切换到项目 B
  Workspace.activate('p-b');
  assert.strictEqual(Workspace.currentProject().id, 'p-b', '已切换到项目 B');

  // 点击确认导入
  var confirmBtn = previewEl.querySelector('[data-action="confirm-import"], #btn-confirm-import');
  assert.ok(confirmBtn, '必须存在确认导入按钮');
  confirmBtn.click();

  // 等待异步导入完成
  await new Promise(function(r) { setTimeout(r, 50); });

  // 验证单项目导入采用了新项目语义，不会污染项目 B，也不会覆盖原有项目
  var projectsAfter = Workspace.data.projects;
  assert.strictEqual(projectsAfter.length, projectsBeforeCount + 1, '导入作为全新项目添加');
  var importedProj = projectsAfter.find(function(p) { return p.name === '外部导入项目'; });
  assert.ok(importedProj, '成功找到导入的新项目');
  assert.notStrictEqual(importedProj.id, 'p-b', '导入项目未覆盖当前项目 B');
  assert.notStrictEqual(importedProj.id, 'p-a', '导入项目未覆盖原项目 A');

  // 验证项目 B 的任务数据保持原样未被污染
  var projB = projectsAfter.find(function(p) { return p.id === 'p-b'; });
  assert.strictEqual(projB.data.tasks[0].id, 't-b', '项目 B 任务未受干扰');

  // 4. 全量备份预览与替换确认
  var validWsPkg = {
    backupVersion: 1,
    kind: 'workspace',
    exportedAt: '2026-11-12T00:00:00.000Z',
    payload: {
      pmweb_version: 4,
      projects: [
        {
          id: 'p-new-full',
          name: '全量恢复项目',
          data: { tasks: [{ id: 't-full-1', name: '全量任务 1', status: 'todo' }] }
        }
      ],
      settings: { startupMode: 'choose' },
      calendar: { subscribed: true, cacheByYear: {}, importedByYear: {}, lastAttemptByYear: {} },
      recycleBin: []
    },
    attachments: [],
    summary: { projectCount: 1, attachmentCount: 0, totalBytes: 0 }
  };

  var fakeWsFile = makeFakeFile('workspace-full.json', JSON.stringify(validWsPkg));
  await App.previewImport(fakeWsFile);

  var wsPreviewEl = doc.querySelector('.backup-import-preview, #backup-preview-box, .modal-box');
  assert.ok(wsPreviewEl.innerHTML.indexOf('替换当前整个工作区') !== -1 || wsPreviewEl.innerHTML.indexOf('全量') !== -1, '全量导入明确警示替换范围');

  // 取消操作验证
  var cancelBtn = wsPreviewEl.querySelector('[data-action="cancel-import"], #btn-cancel-import, .btn-cancel');
  if (cancelBtn) {
    cancelBtn.click();
    assert.strictEqual(Workspace.data.projects.find(function(p) { return p.name === '全量恢复项目'; }), undefined, '取消后不得写入数据');
  }

  // 5. 损坏存储下导出原文与确认恢复支持
  var corruptEnv = setupBackupEnv({
    initialRaw: '{"pmweb_version":4, INVALID_JSON_HERE'
  });
  corruptEnv.App.init();
  assert.strictEqual(corruptEnv.Workspace.isReadOnly(), true, '损坏存储工作区处于只读模式');
  assert.ok(typeof corruptEnv.App.exportRawStorage === 'function', '提供 exportRawStorage 入口');

  // 损坏存储下导出原文
  corruptEnv.App.exportRawStorage();
  assert.strictEqual(corruptEnv.downloads.length, 1, '损坏存储应能导出原始损坏文本');
  assert.ok(corruptEnv.downloads[0].content.indexOf('INVALID_JSON_HERE') !== -1, '导出内容为原始未截断文本');

  // 损坏存储下全量恢复已确认的完整备份
  await corruptEnv.App.previewImport(fakeWsFile);
  var corruptConfirmBtn = corruptEnv.doc.querySelector('[data-action="confirm-import"], #btn-confirm-import');
  assert.ok(corruptConfirmBtn, '损坏存储下允许确认恢复完整备份');
  corruptConfirmBtn.click();
  await new Promise(function(r) { setTimeout(r, 50); });

  assert.strictEqual(corruptEnv.Workspace.isReadOnly(), false, '恢复成功后工作区退出只读状态');
  assert.strictEqual(corruptEnv.Workspace.data.projects[0].name, '全量恢复项目', '全量项目成功恢复');

  // 6. 附件上传失败必须显示未保存且元数据不悬空
  var uploadEnv = setupBackupEnv();
  uploadEnv.App.init();
  uploadEnv.Workspace.activate('p-a');
  // 注入 AttachmentStore.put 失败
  uploadEnv.AttachmentStore.put = function() {
    return Promise.reject(new Error('IndexedDB 写入失败'));
  };

  var fakeAttachmentFile = {
    name: 'test-fail.pdf',
    size: 1024,
    type: 'application/pdf'
  };

  var uploadErrorMsg = '';
  uploadEnv.App._collabSetError = function(msg) { uploadErrorMsg = msg; };

  var uploadResult = await uploadEnv.App._uploadOneCollabFile('t-a', fakeAttachmentFile);
  assert.strictEqual(uploadResult, false, '上传失败返回 false');
  assert.ok(uploadErrorMsg.indexOf('未保存') !== -1, '上传失败文案必须包含「未保存」');
  var taskAAttachments = uploadEnv.TaskManager.getAttachments('t-a');
  var hasDanglingMeta = (taskAAttachments || []).some(function(a) { return a.name === 'test-fail.pdf'; });
  assert.strictEqual(hasDanglingMeta, false, '上传失败不得在元数据中留存悬空引用');
});

// -------------------------------------------------------------
// 场景 4: TASK9-CRIT01 异步附件上传切项目隔离、批处理源项目贯穿与临时Blob清理
// -------------------------------------------------------------
test('async_attachment_upload_project_switch_isolated: 异步上传切项目隔离、批处理源项目贯穿与临时Blob清理', async function() {
  var env = setupBackupEnv();
  var App = env.App;
  var Workspace = env.Workspace;
  var AttachmentStore = env.AttachmentStore;

  App.init();
  Workspace.activate('p-a');

  var putResolve;
  var delayedPutPromise = new Promise(function(resolve) { putResolve = resolve; });
  var origPut = AttachmentStore.put;
  var deletedKeys = [];
  var origDelete = AttachmentStore.delete;
  AttachmentStore.delete = function(k) {
    deletedKeys.push(k);
    return origDelete.call(AttachmentStore, k);
  };

  AttachmentStore.put = function(key, data, opts) {
    return delayedPutPromise.then(function() {
      return origPut.call(AttachmentStore, key, data, opts);
    });
  };

  var errorMsg = '';
  App._collabSetError = function(msg) { errorMsg = msg; };

  // 1. 单文件上传在 A 发起，等待 IDB 期间切至 B
  var uploadP = App._uploadOneCollabFile('t-a', {
    name: 'contract-p-a.pdf',
    size: 512,
    type: 'application/pdf'
  });

  // 模拟用户切换到项目 B
  Workspace.activate('p-b');

  // IDB 写入完成
  putResolve();
  var res = await uploadP;

  assert.strictEqual(res, false, '切项目后上传必须返回 false');
  assert.ok(errorMsg.indexOf('已切换') !== -1 || errorMsg.indexOf('未保存') !== -1, '提示项目已切换且未保存');

  var projA = Workspace.data.projects.find(function(p) { return p.id === 'p-a'; });
  var projB = Workspace.data.projects.find(function(p) { return p.id === 'p-b'; });
  var inA = (projA.data.attachments || []).some(function(a) { return a.name === 'contract-p-a.pdf'; });
  var inB = (projB.data.attachments || []).some(function(a) { return a.name === 'contract-p-a.pdf'; });

  assert.strictEqual(inB, false, '项目 B 绝不得包含项目 A 任务的野附件');
  assert.strictEqual(inA, false, '项目 A 未完成绑定因此不含该附件');
  assert.ok(deletedKeys.length > 0, '切项目取消后必须清理本次临时 blob');

  // 2. 批量上传贯穿源项目验证
  Workspace.activate('p-a');
  var batchFiles = [
    { name: 'batch-1.pdf', size: 100, type: 'application/pdf' },
    { name: 'batch-2.pdf', size: 100, type: 'application/pdf' }
  ];
  var fakeInput = { files: batchFiles, value: 'fake' };
  var stepResolvers = [];
  AttachmentStore.put = function(key, data, opts) {
    var p = new Promise(function(resolve) {
      stepResolvers.push(resolve);
    });
    return p.then(function() {
      return origPut.call(AttachmentStore, key, data, opts);
    });
  };

  var batchP = App._uploadCollabFiles('t-a', fakeInput);

  // 第一个文件开始写入，中途切换到项目 B
  await new Promise(function(r) { setTimeout(r, 20); });
  assert.ok(stepResolvers.length > 0, '首个文件已进入 IDB 写入阶段');
  stepResolvers[0]();
  await new Promise(function(r) { setTimeout(r, 20); });
  Workspace.activate('p-b');

  // 释放第二个文件写入
  await new Promise(function(r) { setTimeout(r, 20); });
  if (stepResolvers[1]) stepResolvers[1]();

  await batchP;

  // 验证项目 B 没有任何 batch 文件
  var inB1 = (projB.data.attachments || []).some(function(a) { return a.name === 'batch-1.pdf'; });
  var inB2 = (projB.data.attachments || []).some(function(a) { return a.name === 'batch-2.pdf'; });
  assert.strictEqual(inB1, false, '批量上传中途切项目不得污染项目 B (文件1)');
  assert.strictEqual(inB2, false, '批量上传中途切项目不得在后继文件错写项目 B (文件2)');

  AttachmentStore.put = origPut;
  AttachmentStore.delete = origDelete;
});

// -------------------------------------------------------------
// 场景 5: TASK9-IMPT01 工作日历弹窗切项目拒绝保存且不污染任何项目
// -------------------------------------------------------------
test('work_calendar_save_project_switch_isolated: 工作日历弹窗切项目拒绝保存且不污染任何项目', async function() {
  var env = setupBackupEnv();
  var App = env.App;
  var Workspace = env.Workspace;
  var TaskManager = env.TaskManager;
  var ModalManager = env.ModalManager;

  App.init();
  Workspace.activate('p-a');

  // 项目 A 初始日历
  TaskManager.setWorkCalendar({
    weekends: [0, 6],
    holidays: ['2026-05-01'],
    workdays: []
  });

  var modalCallback = null;
  var origShowForm = ModalManager.showWorkCalendarForm;
  ModalManager.showWorkCalendarForm = function(config, onSave) {
    modalCallback = onSave;
  };

  var noticeMsg = '';
  App.showNotice = function(msg) { noticeMsg = msg; };

  // 用户在项目 A 打开工作日历弹窗
  App.showWorkCalendarSettings();
  assert.ok(typeof modalCallback === 'function', '已获取弹窗保存回调');

  // 用户在弹窗未关闭时切换到项目 B
  Workspace.activate('p-b');

  // 用户在弹窗中提交保存
  modalCallback({
    weekends: [0],
    holidays: ['2026-10-01'],
    workdays: []
  });

  var projA = Workspace.data.projects.find(function(p) { return p.id === 'p-a'; });
  var projB = Workspace.data.projects.find(function(p) { return p.id === 'p-b'; });

  // 验证项目 B 未被冲毁
  var bSettings = projB.data.settings && projB.data.settings.workCalendar;
  var bHolidays = bSettings ? bSettings.holidays || [] : [];
  assert.ok(bHolidays.indexOf('2026-10-01') === -1, '项目 B 日历绝不得被项目 A 弹窗错写冲毁');

  // 验证项目 A 亦未被半保存或错写
  var aSettings = projA.data.settings && projA.data.settings.workCalendar;
  assert.strictEqual(JSON.stringify(aSettings.holidays), JSON.stringify(['2026-05-01']), '项目 A 保持原日历');

  assert.ok(noticeMsg.indexOf('已切换') !== -1 || noticeMsg.indexOf('取消') !== -1, '提示项目已切换取消保存');

  ModalManager.showWorkCalendarForm = origShowForm;
});

// -------------------------------------------------------------
// 场景 6: TASK9-IMPT02 写锁驳回重置按钮状态且允许释放后原地重试
// -------------------------------------------------------------
test('confirm_import_button_lock_rejection_and_retry: 写锁驳回重置按钮状态且允许释放后原地重试', async function() {
  var env = setupBackupEnv();
  var App = env.App;
  var Workspace = env.Workspace;
  var doc = env.doc;

  App.init();

  var fakeFile = makeFakeFile('p-retry.json', JSON.stringify({
    backupVersion: 1,
    kind: 'project',
    exportedAt: '2026-11-12T00:00:00Z',
    payload: { id: 'p-ext-retry', name: '重试新项目', data: { tasks: [] } },
    attachments: [],
    summary: { projectCount: 1, attachmentCount: 0, totalBytes: 0 }
  }));

  await App.previewImport(fakeFile);

  var confirmBtn = doc.getElementById('btn-confirm-import');
  assert.ok(confirmBtn, '确认按钮存在');
  assert.strictEqual(confirmBtn.disabled, false, '初始状态按钮未禁用');

  // 模拟写锁生效
  Workspace.isLocked = function() { return true; };

  // 点击确认按钮
  confirmBtn.click();

  // 检验写锁被拒后按钮状态恢复，未永久冻结
  assert.strictEqual(confirmBtn.disabled, false, '写锁驳回后按钮必须恢复可用');
  assert.strictEqual(confirmBtn.textContent, '确认导入新项目', '按钮文案必须恢复原始确认文案');

  // 模拟写锁释放
  Workspace.isLocked = function() { return false; };

  // 同一弹窗内再次点击确认
  confirmBtn.click();
  await new Promise(function(r) { setTimeout(r, 60); });

  // 验证导入成功完成
  var imported = Workspace.data.projects.find(function(p) { return p.name === '重试新项目'; });
  assert.ok(imported, '同一弹窗重试后成功完成导入');
});

test('app_download_file_default_implementation: 默认 _downloadFile 方法存在并通过 DOM 触发下载', function() {
  var env = setupBackupEnv({ mockDownload: false });
  var App = env.App;
  var doc = env.doc;

  assert.strictEqual(typeof App._downloadFile, 'function', 'App 必须提供默认 _downloadFile 方法');

  var clicked = false;
  var origCreateElement = doc.createElement;
  doc.createElement = function(tag) {
    var el = origCreateElement.call(doc, tag);
    if (tag.toUpperCase() === 'A') {
      el.click = function() { clicked = true; };
    }
    return el;
  };

  env.appEnv.context.Blob = function(parts, opts) {
    this.parts = parts;
    this.type = (opts && opts.type) || '';
  };
  env.appEnv.context.URL = {
    createObjectURL: function() { return 'blob:mock-url'; },
    revokeObjectURL: function() {}
  };

  App._downloadFile('backup.json', '{"a":1}', 'application/json');
  assert.strictEqual(clicked, true, '调用 _downloadFile 必须自动触发 a 标签点击下载');
});

// 执行本文件测试
var failures = 0;
async function runTests() {
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      await t.fn();
      console.log('PASS ' + t.name);
    } catch (err) {
      failures++;
      console.log('FAIL ' + t.name);
      console.log('  ' + (err && err.message ? err.message : err));
      if (err && err.stack) console.log(err.stack);
    }
  }
  console.log('\nbackup-ui: ' + (tests.length - failures) + '/' + tests.length + ' passed');
  process.exit(failures === 0 ? 0 : 1);
}

runTests();
