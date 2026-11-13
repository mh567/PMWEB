'use strict';

// 用 Node 的 vm 模拟浏览器经典 script 的全局词法作用域：
// 多个 <script> 顶层 const/var 在同一全局环境中互相可见。
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..', '..');

function createApp(scriptFiles, options) {
  options = options || {};
  var alerts = [];
  var localStorage = options.localStorage || {
    _store: {},
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null;
    },
    setItem: function(key, value) { this._store[key] = String(value); },
    removeItem: function(key) { delete this._store[key]; }
  };

  var idbHelper = require('./idb-mock');
  var resolvedIndexedDB = options.indexedDB !== undefined ? options.indexedDB : idbHelper.createIndexedDBMock();

  var context = vm.createContext({
    console: console,
    alert: function(message) { alerts.push(message); },
    localStorage: localStorage,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    indexedDB: resolvedIndexedDB,
    Blob: typeof Blob !== 'undefined' ? Blob : null,
    btoa: typeof btoa !== 'undefined' ? btoa : null,
    atob: typeof atob !== 'undefined' ? atob : null,
    Buffer: typeof Buffer !== 'undefined' ? Buffer : null
  });

  var filesToLoad = scriptFiles.slice();
  var tmIndex = filesToLoad.indexOf('task-manager.js');
  if (tmIndex !== -1 && filesToLoad.indexOf('workspace.js') === -1) {
    filesToLoad.splice(tmIndex, 0, 'workspace.js');
  }

  filesToLoad.forEach(function(file) {
    var abs = path.join(ROOT, 'js', file);
    var code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, context, { filename: abs });
  });

  return {
    context: context,
    alerts: alerts,
    localStorage: localStorage,
    get: function(name) { return vm.runInContext(name, context); },
    run: function(code) { return vm.runInContext(code, context); }
  };
}

function installTasks(app, data) {
  var TaskManager = app.get('TaskManager');
  var Workspace = app.get('Workspace');
  if (Workspace) {
    var project = {
      id: 'p-test',
      name: '测试项目',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
      archived: false,
      data: data
    };
    var ws = {
      pmweb_version: 4,
      projects: [project],
      settings: { startupMode: 'last', defaultProjectId: 'p-test', lastProjectId: 'p-test' },
      calendar: { subscribed: true, source: 'cg-zhou/CN', cacheByYear: {}, importedByYear: {}, lastAttemptByYear: {} },
      recycleBin: [],
      legacy: {}
    };
    var raw = JSON.stringify(ws);
    Workspace.data = ws;
    Workspace.raw = raw;
    Workspace.activeProjectId = 'p-test';
    app.localStorage.setItem('pmweb_data', raw);
    TaskManager.bindProject(project);
    TaskManager.data = data;
    TaskManager._buildIndex();
  } else {
    TaskManager.data = data;
    TaskManager._lastCommittedData = JSON.parse(JSON.stringify(data));
    TaskManager._buildIndex();
  }
  return TaskManager;
}

function resetProject(app) {
  var DataStore = app.get('DataStore');
  var emptyData = DataStore && typeof DataStore.createEmptyProjectData === 'function'
    ? DataStore.createEmptyProjectData()
    : {
        pmweb_version: 3,
        tasks: [],
        milestones: [],
        links: [],
        views: [],
        comments: [],
        activity: [],
        attachments: [],
        settings: {}
      };
  return installTasks(app, emptyData);
}

module.exports = {
  createApp: createApp,
  installTasks: installTasks,
  resetProject: resetProject
};
