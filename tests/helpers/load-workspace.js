'use strict';

var helper = require('./load');
var fixtures = require('../fixtures/workspace-v4');

function fresh(options) {
  options = options || {};
  var scripts = [
    'date.js',
    'validate.js',
    'store.js',
    'workspace.js',
    'history.js',
    'comments.js',
    'activity.js',
    'attachment-meta.js',
    'task-manager.js'
  ];
  if (options.scripts) {
    scripts = options.scripts;
  }
  var app = helper.createApp(scripts, options);
  var store = app.get('DataStore');
  var workspace = app.get('Workspace');
  var manager = app.get('TaskManager');

  if (options.initialData) {
    app.localStorage.setItem('pmweb_data', JSON.stringify(options.initialData));
  } else if (options.initialRaw !== undefined) {
    if (options.initialRaw !== null) {
      app.localStorage.setItem('pmweb_data', options.initialRaw);
    }
  }

  if (options.autoInit !== false) {
    workspace.init();
    if (options.activeProjectId) {
      workspace.activate(options.activeProjectId);
    } else if (options.activeProject) {
      workspace.activate(options.activeProject);
    }
  }

  return {
    app: app,
    store: store,
    workspace: workspace,
    manager: manager
  };
}

module.exports = {
  fresh: fresh,
  makeWorkspace: fixtures.makeWorkspace
};
