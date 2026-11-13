(function(root) {
  'use strict';

  var activeLockToken = null;
  var activeLockReason = null;

  var Workspace = {
    data: null,
    raw: null,
    activeProjectId: null,
    _readOnly: false,

    isReadOnly: function() {
      return this._readOnly;
    },

    isLocked: function() {
      return !!activeLockToken;
    },

    _resetLockForTests: function() {
      activeLockToken = null;
      activeLockReason = null;
    },

    withWriteLock: function(reason, fn) {
      if (activeLockToken) {
        return Promise.reject(new Error('工作区当前已持有写锁（' + (activeLockReason || '未知') + '），禁止重入或重复加锁'));
      }
      if (typeof fn !== 'function') {
        return Promise.reject(new Error('Workspace.withWriteLock 需要传入执行函数'));
      }
      var token = 'lock-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      activeLockToken = token;
      activeLockReason = reason || 'write-lock';

      return Promise.resolve().then(function() {
        return fn(token);
      }).finally(function() {
        if (activeLockToken === token) {
          activeLockToken = null;
          activeLockReason = null;
        }
      });
    },

    init: function() {
      var store = typeof DataStore !== 'undefined' ? DataStore : null;
      if (!store) {
        throw new Error('Workspace.init: DataStore 未定义');
      }
      var res = store.load();
      this.data = res.data;
      this.raw = res.raw;
      this.activeProjectId = null;
      this._readOnly = !!res.readOnly;

      var manager = typeof TaskManager !== 'undefined' ? TaskManager : null;
      if (manager && typeof manager.bindProject === 'function') {
        manager.bindProject(null);
      }

      return res;
    },

    currentProject: function() {
      if (!this.data || !Array.isArray(this.data.projects)) return null;
      if (!this.activeProjectId) return null;
      for (var i = 0; i < this.data.projects.length; i++) {
        if (this.data.projects[i].id === this.activeProjectId) {
          return this.data.projects[i];
        }
      }
      return null;
    },

    activate: function(id, options) {
      options = options || {};
      var manager = typeof TaskManager !== 'undefined' ? TaskManager : null;
      if (!this.data || !Array.isArray(this.data.projects) || !id) {
        this.activeProjectId = null;
        if (manager && typeof manager.bindProject === 'function') {
          manager.bindProject(null);
        }
        return;
      }

      var target = null;
      for (var i = 0; i < this.data.projects.length; i++) {
        if (this.data.projects[i].id === id) {
          target = this.data.projects[i];
          break;
        }
      }

      if (target) {
        this.activeProjectId = id;
        if (this.data && this.data.settings && !options.keepLastProjectId) {
          this.data.settings.lastProjectId = id;
        }
        if (manager && typeof manager.bindProject === 'function') {
          manager.bindProject(target);
        }
      } else {
        this.activeProjectId = null;
        if (manager && typeof manager.bindProject === 'function') {
          manager.bindProject(null);
        }
      }
    },

    createProject: function(params) {
      if (this.isLocked()) {
        throw new Error('工作区正在执行写锁保护操作，不可写入');
      }
      if (this.isReadOnly()) {
        throw new Error('工作区处于只读状态，禁止创建项目');
      }
      if (!this.data || !Array.isArray(this.data.projects)) {
        throw new Error('工作区未初始化');
      }
      if (!params || typeof params.name !== 'string' || !params.name.trim()) {
        throw new Error('项目名称不能为空');
      }
      var name = params.name.trim();
      var description = (params.description !== undefined && params.description !== null)
        ? String(params.description).trim()
        : '';
      var id = 'proj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      var now = new Date().toISOString();

      var store = typeof DataStore !== 'undefined' ? DataStore : null;
      var projectData = (store && typeof store.createEmptyProjectData === 'function')
        ? store.createEmptyProjectData(name)
        : {
            pmweb_version: 3,
            tasks: [],
            milestones: [],
            links: [],
            views: [],
            comments: [],
            activity: [],
            attachments: [],
            settings: {
              lastView: 'gantt',
              lastGranularity: 'day',
              statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true },
              layoutVersion: 'workbench',
              gridWidth: 560,
              columns: null
            }
          };

      var project = {
        id: id,
        name: name,
        description: description,
        createdAt: now,
        updatedAt: now,
        status: 'active',
        archived: false,
        data: projectData
      };

      var next = JSON.parse(JSON.stringify(this.data));
      next.projects.push(project);
      this.commit(next);

      return project;
    },

    updateProject: function(id, patch) {
      if (this.isLocked()) {
        throw new Error('工作区正在执行写锁保护操作，不可写入');
      }
      if (this.isReadOnly()) {
        throw new Error('工作区处于只读状态，禁止修改项目');
      }
      if (!this.data || !Array.isArray(this.data.projects)) {
        throw new Error('工作区未初始化');
      }
      if (!id) {
        throw new Error('项目 ID 不能为空');
      }
      if (!patch || typeof patch !== 'object') {
        throw new Error('更新内容必须为对象');
      }

      var index = -1;
      for (var i = 0; i < this.data.projects.length; i++) {
        if (this.data.projects[i].id === id) {
          index = i;
          break;
        }
      }
      if (index === -1) {
        throw new Error('未找到项目: ' + id);
      }

      var currentProj = this.data.projects[index];
      if (currentProj.archived) {
        if (patch.archived !== false) {
          throw new Error('已归档项目处于只读状态，需修改请先恢复归档');
        }
        var patchKeys = Object.keys(patch);
        for (var k = 0; k < patchKeys.length; k++) {
          if (patchKeys[k] !== 'archived') {
            throw new Error('已归档项目解除归档时禁止同时修改元数据');
          }
        }
      }

      if (patch.name !== undefined) {
        if (typeof patch.name !== 'string' || !patch.name.trim()) {
          throw new Error('项目名称不能为空');
        }
      }

      var next = JSON.parse(JSON.stringify(this.data));
      var target = next.projects[index];

      if (patch.name !== undefined) {
        target.name = patch.name.trim();
      }
      if (patch.description !== undefined) {
        target.description = String(patch.description);
      }
      if (patch.status !== undefined) {
        if (patch.status === 'active' || patch.status === 'completed') {
          target.status = patch.status;
        }
      }
      if (patch.archived !== undefined) {
        target.archived = Boolean(patch.archived);
      }
      target.updatedAt = new Date().toISOString();

      this.commit(next);

      if (this.activeProjectId === id) {
        var manager = typeof TaskManager !== 'undefined' ? TaskManager : null;
        if (manager && typeof manager.bindProject === 'function') {
          var updatedCur = this.currentProject();
          manager._project = updatedCur;
        }
      }
    },

    setStartup: function(options) {
      if (this.isLocked()) {
        throw new Error('工作区正在执行写锁保护操作，不可写入');
      }
      if (this.isReadOnly()) {
        throw new Error('工作区处于只读状态，禁止修改启动偏好');
      }
      if (!this.data) {
        throw new Error('工作区未初始化');
      }
      options = options || {};
      var mode = options.mode;
      if (mode !== 'choose' && mode !== 'last' && mode !== 'fixed') {
        throw new Error('未知的启动模式: ' + mode);
      }

      var next = JSON.parse(JSON.stringify(this.data));
      if (!next.settings) next.settings = {};
      next.settings.startupMode = mode;
      if (mode === 'fixed') {
        next.settings.defaultProjectId = options.projectId !== undefined ? options.projectId : null;
      } else if (mode === 'last' && options.projectId !== undefined) {
        next.settings.lastProjectId = options.projectId || null;
      }

      this.commit(next);
    },

    resolveStartup: function() {
      if (!this.data || !Array.isArray(this.data.projects) || this.data.projects.length === 0) {
        return null;
      }
      var s = this.data.settings || {};
      var mode = s.startupMode || 'choose';
      var targetId = null;

      if (mode === 'choose') {
        return null;
      } else if (mode === 'last') {
        targetId = s.lastProjectId;
      } else if (mode === 'fixed') {
        targetId = s.defaultProjectId;
      } else {
        return null;
      }

      if (!targetId) return null;

      for (var i = 0; i < this.data.projects.length; i++) {
        var p = this.data.projects[i];
        if (p.id === targetId) {
          if (p.archived) {
            return null;
          }
          return p.id;
        }
      }

      return null;
    },

    deleteProject: function(id) {
      if (this.isLocked()) {
        throw new Error('工作区正在执行写锁保护操作，不可写入');
      }
      if (this.isReadOnly()) {
        throw new Error('工作区处于只读状态，禁止删除项目');
      }
      var bin = typeof RecycleBin !== 'undefined' ? RecycleBin : null;
      if (!bin || typeof bin.removeProject !== 'function') {
        throw new Error('删除功能需等待回收站服务（Task 7）接入，当前禁止永久删除项目');
      }
      if (!this.data || !Array.isArray(this.data.projects)) {
        throw new Error('工作区未初始化');
      }
      var res = bin.removeProject(this.data, id);
      this.commit(res.workspace);
      if (this.activeProjectId === id) {
        this.activate(null);
      }
      return res.batchId;
    },

    commit: function(next, options) {
      options = options || {};
      if (activeLockToken) {
        if (options.lockToken !== activeLockToken) {
          throw new Error('当前工作区正在执行写锁保护操作（' + (activeLockReason || '未知') + '），禁止提交保存');
        }
      }
      if (this.isReadOnly()) {
        if (!options.recoveryConfirmed) {
          throw new Error('工作区处于只读状态，禁止提交保存');
        }
      }
      if (!next || typeof next !== 'object') {
        throw new Error('Workspace.commit: next 必须是合法的 WorkspaceData 对象');
      }
      var store = typeof DataStore !== 'undefined' ? DataStore : null;
      if (!store) {
        throw new Error('Workspace.commit: DataStore 未定义');
      }

      var written = store.save(next, this.raw);
      this.data = next;
      this.raw = written;
      if (options.recoveryConfirmed) {
        this._readOnly = false;
      }
    },

    updateProjectData: function(projectId, nextData) {
      if (this.isLocked()) {
        throw new Error('工作区正在执行写锁保护操作，不可写入');
      }
      if (this.isReadOnly()) {
        throw new Error('工作区处于只读状态，禁止修改项目数据');
      }
      if (!this.data || !Array.isArray(this.data.projects)) {
        throw new Error('工作区未初始化或项目列表不存在');
      }
      var projectIndex = -1;
      for (var i = 0; i < this.data.projects.length; i++) {
        if (this.data.projects[i].id === projectId) {
          projectIndex = i;
          break;
        }
      }
      if (projectIndex === -1) {
        throw new Error('未找到项目: ' + projectId);
      }

      if (this.data.projects[projectIndex].archived) {
        throw new Error('已归档项目处于只读状态，禁止修改项目数据');
      }

      var nextWorkspace = JSON.parse(JSON.stringify(this.data));
      nextWorkspace.projects[projectIndex].data = JSON.parse(JSON.stringify(nextData));
      nextWorkspace.projects[projectIndex].updatedAt = new Date().toISOString();

      this.commit(nextWorkspace);
    }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = Workspace;
  }
  if (root) {
    root.Workspace = Workspace;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
