// ============================================================
// DataStore — localStorage persistence + JSON import/export (v4)
// ============================================================
const DataStore = {
  STORAGE_KEY: 'pmweb_data',
  CURRENT_VERSION: 4,

  createEmpty: function() {
    return {
      pmweb_version: this.CURRENT_VERSION,
      projects: [],
      settings: {
        startupMode: 'choose',
        defaultProjectId: null,
        lastProjectId: null
      },
      calendar: {
        subscribed: true,
        source: 'cg-zhou/CN',
        cacheByYear: {},
        importedByYear: {},
        lastAttemptByYear: {}
      },
      recycleBin: [],
      legacy: {}
    };
  },

  createEmptyProjectData: function(name) {
    return {
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
  },

  load: function() {
    var raw = null;
    try {
      raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) {
        return {
          data: this.createEmpty(),
          raw: null,
          error: null,
          readOnly: false
        };
      }

      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.error('DataStore.load JSON parse failed:', err);
        return {
          data: null,
          raw: raw,
          error: err,
          readOnly: true
        };
      }

      var version = parsed.pmweb_version || parsed.version || 0;
      if (version > this.CURRENT_VERSION) {
        var verMsg = '数据版本过新（v' + version + '），请升级软件。当前支持最高版本：v' + this.CURRENT_VERSION;
        if (typeof alert === 'function') {
          alert(verMsg);
        }
        return {
          data: null,
          raw: raw,
          error: new Error(verMsg),
          readOnly: true
        };
      }

      var migrated;
      if (version < 4) {
        migrated = this.migrate(parsed);
      } else {
        migrated = parsed;
      }
      if (migrated && Array.isArray(migrated.projects)) {
        var self = this;
        migrated.projects.forEach(function(proj) {
          if (proj && proj.data) {
            self._sanitizeTaskStatuses(self._sanitizeIds(proj.data));
          }
        });
      }

      var result = this._validate(migrated);
      if (!result.valid) {
        console.error('DataStore.load validation failed:', result.errors);
        return {
          data: null,
          raw: raw,
          error: new Error(this._formatValidationError(result.errors)),
          readOnly: true
        };
      }

      var activeRaw = raw;
      if (version < 4) {
        try {
          localStorage.setItem('pmweb_data_backup_pre_v4', raw);
          activeRaw = this.save(migrated, raw);
        } catch (saveErr) {
          console.error('DataStore.load migration save failed:', saveErr);
          return {
            data: null,
            raw: raw,
            error: saveErr,
            readOnly: true
          };
        }
      }

      return {
        data: migrated,
        raw: activeRaw,
        error: null,
        readOnly: false
      };
    } catch (e) {
      console.error('DataStore.load failed:', e);
      return {
        data: null,
        raw: raw,
        error: e,
        readOnly: true
      };
    }
  },

  save: function(data, expectedRaw) {
    if (expectedRaw !== undefined) {
      var current = localStorage.getItem(this.STORAGE_KEY);
      if (current !== expectedRaw) {
        throw new Error('存储基线不匹配，请刷新页面重新加载最新数据');
      }
    }
    var text = JSON.stringify(data);
    localStorage.setItem(this.STORAGE_KEY, text);
    return text;
  },

  exportJSON: function(data) {
    var exportData = JSON.parse(JSON.stringify(data));
    exportData.exported_at = new Date().toISOString();
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pmweb-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  importJSON: function(file) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var data = JSON.parse(e.target.result);
          if (!data.version && !data.pmweb_version) {
            reject(new Error('JSON 格式不正确：缺少版本号'));
            return;
          }
          var checked = self.validateImportData(data);
          if (!checked.valid) {
            reject(new Error(self._formatValidationError(checked.errors)));
            return;
          }
          resolve(checked.data);
        } catch (err) {
          reject(new Error('JSON 解析失败：文件内容无效'));
        }
      };
      reader.onerror = function() { reject(new Error('文件读取失败')); };
      reader.readAsText(file);
    });
  },

  validateImportData: function(data) {
    var migrated = this.migrate(data);
    var result = this._validate(migrated);
    return { valid: result.valid, errors: result.errors, data: migrated };
  },

  _validate: function(data) {
    var validator = typeof PMWebValidate !== 'undefined' ? PMWebValidate : null;
    if (validator && typeof validator.validateData === 'function') {
      return validator.validateData(data);
    }
    return { valid: true, errors: [] };
  },

  _formatValidationError: function(errors) {
    var list = Array.isArray(errors) ? errors : [];
    var details = list.slice(0, 5).map(function(error) {
      return error.path + ' ' + error.message;
    });
    return '导入失败：数据校验未通过。' + details.join('；');
  },

  _sanitizeIds: function(data) {
    if (!data || !Array.isArray(data.tasks)) return data;
    var validator = typeof PMWebValidate !== 'undefined' ? PMWebValidate : null;
    var isValid = validator && typeof validator.isValidId === 'function'
      ? validator.isValidId
      : function(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); };
    var self = this;
    var used = new Set();
    var idMap = new Map();

    data.tasks.forEach(function(task) {
      if (!task || typeof task !== 'object') return;
      var original = task.id;
      if (!isValid(original) || used.has(original)) {
        var next = self.uuid();
        while (used.has(next)) next = self.uuid();
        if (typeof original === 'string') idMap.set(original, next);
        task.id = next;
      }
      used.add(task.id);
    });

    data.tasks.forEach(function(task) {
      if (!task || typeof task !== 'object') return;
      if (task.parentId === null || task.parentId === undefined) return;
      var parentId = String(task.parentId);
      if (idMap.has(parentId)) {
        task.parentId = idMap.get(parentId);
      } else if (!isValid(task.parentId) || !used.has(task.parentId)) {
        task.parentId = null;
      }
    });

    if (Array.isArray(data.milestones)) {
      data.milestones.forEach(function(milestone) {
        if (!milestone || typeof milestone !== 'object') return;
        if (!isValid(milestone.id) || used.has(milestone.id)) {
          var next = self.uuid();
          while (used.has(next)) next = self.uuid();
          milestone.id = next;
        }
        used.add(milestone.id);
        if (idMap.has(String(milestone.taskId))) {
          milestone.taskId = idMap.get(String(milestone.taskId));
        }
      });
    }

    return data;
  },

  _sanitizeTaskStatuses: function(data) {
    if (!data || !Array.isArray(data.tasks)) return data;
    var valid = { todo: true, inProgress: true, thirdParty: true, done: true };
    data.tasks.forEach(function(task) {
      if (!task || typeof task !== 'object') return;
      if (!valid[task.status]) {
        task.status = 'inProgress';
      }
    });
    return data;
  },

  migrate: function(input) {
    if (!input || typeof input !== 'object') {
      return this.createEmpty();
    }
    var version = input.pmweb_version || input.version || 0;
    if (version > this.CURRENT_VERSION) {
      if (typeof alert === 'function') {
        alert('数据版本过新（v' + version + '），请升级软件。当前支持最高版本：v' + this.CURRENT_VERSION);
      }
      return this.createEmpty();
    }
    if (version === 4) {
      return input;
    }

    var legacy = {};
    var knownRootKeys = {
      version: true,
      pmweb_version: true,
      projects: true,
      tasks: true,
      milestones: true,
      links: true,
      views: true,
      comments: true,
      activity: true,
      attachments: true,
      settings: true
    };
    Object.keys(input).forEach(function(k) {
      if (!knownRootKeys[k]) {
        legacy[k] = input[k];
      }
    });

    var data = input;
    if (version < 2) {
      data = this._migrateV1toV2(data, legacy);
    }
    if (version < 3) {
      data = this._migrateV2toV3(data);
    }
    return this._migrateV3toV4(data, legacy);
  },

  _migrateV3toV4: function(v3, legacy) {
    var projectData = {
      pmweb_version: 3,
      tasks: v3.tasks || [],
      milestones: v3.milestones || [],
      links: v3.links || [],
      views: v3.views || [],
      comments: v3.comments || [],
      activity: v3.activity || [],
      attachments: v3.attachments || [],
      settings: v3.settings || {}
    };

    var knownV3Keys = {
      pmweb_version: true,
      tasks: true,
      milestones: true,
      links: true,
      views: true,
      comments: true,
      activity: true,
      attachments: true,
      settings: true
    };
    Object.keys(v3).forEach(function(k) {
      if (!knownV3Keys[k]) {
        projectData[k] = v3[k];
        if (legacy && legacy[k] === undefined) {
          legacy[k] = v3[k];
        }
      }
    });

    if (!projectData.settings.statusFilter) {
      projectData.settings.statusFilter = { todo: true, inProgress: true, thirdParty: true, done: true };
    }

    var now = new Date().toISOString();
    var project = {
      id: 'p-original',
      name: '原有项目',
      description: '',
      createdAt: now,
      updatedAt: now,
      status: 'active',
      archived: false,
      data: projectData
    };

    return {
      pmweb_version: 4,
      projects: [project],
      settings: {
        startupMode: 'choose',
        defaultProjectId: null,
        lastProjectId: null
      },
      calendar: {
        subscribed: true,
        source: 'cg-zhou/CN',
        cacheByYear: {},
        importedByYear: {},
        lastAttemptByYear: {}
      },
      recycleBin: [],
      legacy: legacy || {}
    };
  },

  _migrateV2toV3: function(v2) {
    var settings = v2.settings || {};
    var data = {
      pmweb_version: 3,
      tasks: v2.tasks || [],
      milestones: v2.milestones || [],
      links: v2.links || [],
      views: v2.views || [],
      comments: v2.comments || [],
      activity: v2.activity || [],
      attachments: v2.attachments || [],
      settings: settings
    };

    data.tasks.forEach(function(task) {
      if (typeof task.progress !== 'number') {
        task.progress = task.status === 'done' ? 100 :
                        task.status === 'todo' ? 0 :
                        task.status === 'thirdParty' ? 30 : 50;
      }
      if (task.plannedEndDate === undefined) {
        task.plannedEndDate = task.endDate || null;
      }
    });

    if (typeof settings.gridWidth !== 'number') {
      settings.gridWidth = 560;
    }
    if (settings.layoutVersion === undefined) {
      settings.layoutVersion = 'workbench';
    }
    if (settings.columns === undefined) {
      settings.columns = null;
    }
    if (!settings.statusFilter) {
      settings.statusFilter = { todo: true, inProgress: true, thirdParty: true, done: true };
    }

    return data;
  },

  _migrateV1toV2: function(v1, legacy) {
    var v2 = {
      pmweb_version: 2,
      tasks: [],
      milestones: [],
      settings: v1.settings || { lastView: 'gantt', lastGranularity: 'day' }
    };
    var projectIdMap = {};
    var projects = v1.projects || [];
    if (legacy && Array.isArray(projects)) {
      legacy.originalProjects = projects;
    }
    var defaultColor = typeof DEFAULT_TASK_COLOR !== 'undefined' ? DEFAULT_TASK_COLOR : '#3b82f6';
    projects.forEach(function(p, i) {
      var newId = DataStore.uuid();
      projectIdMap[p.id] = newId;
      v2.tasks.push({
        id: newId, parentId: null, name: p.name, description: '', assignee: '',
        color: p.color || defaultColor, startDate: null, endDate: null,
        status: 'inProgress', order: i, ganttRow: null
      });
    });
    var oldTasks = v1.tasks || [];
    oldTasks.forEach(function(t) {
      var parentId = projectIdMap[t.projectId] || null;
      v2.tasks.push({
        id: t.id, parentId: parentId, name: t.name,
        description: t.description || '', assignee: t.assignee || '',
        color: null, startDate: t.startDate || null, endDate: t.endDate || null,
        status: t.status || 'todo', order: t.order || 0, ganttRow: null
      });
    });
    var oldMilestones = v1.milestones || [];
    oldMilestones.forEach(function(m) {
      var taskId = m.taskId;
      if (!taskId && m.projectId) {
        taskId = projectIdMap[m.projectId] || null;
      }
      if (taskId) {
        v2.milestones.push({
          id: m.id, taskId: taskId, name: m.name, date: m.date, status: 'pending'
        });
      }
    });
    return v2;
  },

  uuid: function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
};
