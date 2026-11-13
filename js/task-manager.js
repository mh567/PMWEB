// ============================================================
// == TaskManager: 统一任务树 CRUD (replaces ProjectManager)
// ============================================================
var TaskManager = {
  data: null,
  _project: null,
  _lastCommittedData: null,
  _byId: null,
  _childrenByParent: null,
  _roots: null,
  _depth: null,
  history: null,
  _group: null,
  _changeHandler: null,
  COLORS: [DEFAULT_TASK_COLOR, '#0f766e', '#4d7c0f', '#9a3412', '#7e22ce', '#0e7490', '#be123c', '#475569', '#713f12', '#15803d', '#a16207', '#6b21a8'],

  init: function() {
    if (typeof Workspace !== 'undefined' && Workspace.init) {
      var res = Workspace.init();
      var targetId = (typeof Workspace.resolveStartup === 'function')
        ? Workspace.resolveStartup()
        : null;
      if (targetId) {
        Workspace.activate(targetId);
      } else {
        this.bindProject(null);
      }
    } else {
      var loadRes = DataStore.load();
      var loaded = (loadRes && loadRes.data !== undefined) ? loadRes.data : loadRes;
      if (loaded && Array.isArray(loaded.projects) && loaded.projects.length > 0) {
        this.bindProject(loaded.projects[0]);
      } else if (loaded && loaded.tasks) {
        this.data = loaded;
        this._lastCommittedData = JSON.parse(JSON.stringify(loaded));
        this._ensureCollaboration();
        this._buildIndex();
      } else {
        this.bindProject(null);
      }
    }
    this.history = (typeof History !== 'undefined' && History) ? History.create() : null;
    this._group = null;
  },

  assertWritable: function() {
    if (!this.data) {
      throw new Error('当前无项目或未选中项目，不可写入');
    }
    if (this._project && this._project.archived) {
      throw new Error('已归档项目处于只读状态，不可写入');
    }
    if (typeof Workspace !== 'undefined' && Workspace) {
      if (Workspace.isLocked && Workspace.isLocked()) {
        throw new Error('工作区正在执行写锁保护操作，不可写入');
      }
      if (Workspace.currentProject) {
        var cur = Workspace.currentProject();
        if (cur && cur.archived) {
          throw new Error('已归档项目处于只读状态，不可写入');
        }
      }
      if (Workspace.isReadOnly && Workspace.isReadOnly()) {
        throw new Error('工作区只读，不可写入');
      }
    }
  },

  _refreshProjectData: function(project) {
    this._project = project || null;
    if (!project || !project.data) {
      this.data = null;
      this._lastCommittedData = null;
      this._byId = new Map();
      this._childrenByParent = new Map();
      this._roots = [];
      this._depth = new Map();
      return;
    }
    this.data = JSON.parse(JSON.stringify(project.data));
    this._lastCommittedData = JSON.parse(JSON.stringify(project.data));
    this._ensureCollaboration();
    this._buildIndex();
    if (typeof this._changeHandler === 'function') this._changeHandler();
  },

  bindProject: function(project) {
    this._refreshProjectData(project);
    if (this.history) {
      this.history.clear();
    }
    if (typeof ViewState !== 'undefined' && ViewState.collapsed) {
      ViewState.collapsed.clear();
    }
    if (typeof GridPane !== 'undefined') {
      GridPane.selectedId = null;
      if (GridPane.selection) GridPane.selection.clear();
    }
    if (typeof TreeView !== 'undefined' && TreeView.collapsedTasks) {
      TreeView.collapsedTasks.clear();
    }
  },

  _buildIndex: function() {
    var byId = new Map();
    var childrenByParent = new Map();
    var roots = [];
    var depth = new Map();

    if (this.data && Array.isArray(this.data.tasks)) {
      this.data.tasks.forEach(function(task) {
        byId.set(task.id, task);
        if (task.parentId) {
          if (!childrenByParent.has(task.parentId)) childrenByParent.set(task.parentId, []);
          childrenByParent.get(task.parentId).push(task);
        } else {
          roots.push(task);
        }
      });

      var byOrder = function(a, b) { return a.order - b.order; };
      childrenByParent.forEach(function(list) { list.sort(byOrder); });
      roots.sort(byOrder);

      byId.forEach(function(task) {
        if (depth.has(task.id)) return;
        var chain = [];
        var cursor = task;
        var guard = 0;
        while (cursor && !depth.has(cursor.id) && guard++ < 100) {
          chain.push(cursor);
          cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
        }
        var base = cursor && depth.has(cursor.id) ? depth.get(cursor.id) + 1 : 0;
        for (var i = chain.length - 1; i >= 0; i--) {
          depth.set(chain[i].id, base);
          base++;
        }
      });
    }

    this._byId = byId;
    this._childrenByParent = childrenByParent;
    this._roots = roots;
    this._depth = depth;
  },

  _migrateStatuses: function() {
    // 迁移里程碑：icon → status (所有旧里程碑默认为待办)
    var needsSave = false;
    if (this.data && Array.isArray(this.data.milestones)) {
      this.data.milestones.forEach(function(m) {
        if (m.icon && !m.status) {
          m.status = 'pending';
          delete m.icon;
          needsSave = true;
        }
      });
    }
    if (needsSave) this._save();
  },

  _save: function() {
    this.assertWritable();
    if (typeof Workspace !== 'undefined' && Workspace.data) {
      var curr = Workspace.currentProject();
      if (!curr) {
        throw new Error('当前无项目或未选中项目，不可写入');
      }
      try {
        Workspace.updateProjectData(curr.id, this.data);
        this._lastCommittedData = JSON.parse(JSON.stringify(this.data));
      } catch (err) {
        if (this._lastCommittedData) {
          this.data = JSON.parse(JSON.stringify(this._lastCommittedData));
          this._buildIndex();
        }
        throw err;
      }
    } else {
      DataStore.save(this.data);
      this._lastCommittedData = JSON.parse(JSON.stringify(this.data));
    }
    this._buildIndex();
  },

  _ensureCollaboration: function() {
    if (!this.data || typeof this.data !== 'object') return;
    if (!Array.isArray(this.data.comments)) this.data.comments = [];
    if (!Array.isArray(this.data.activity)) this.data.activity = [];
    if (!Array.isArray(this.data.attachments)) this.data.attachments = [];
    if (!this.data.settings || typeof this.data.settings !== 'object') this.data.settings = {};
  },

  // ---- 协作数据 ----

  _activityActor: function() {
    var settings = this.data && this.data.settings ? this.data.settings : null;
    var name = settings ? settings.currentUser : null;
    if (typeof name === 'string' && name.trim().length > 0) return name.trim();
    return '本机用户';
  },

  _appendActivityEntries: function(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    if (!Array.isArray(this.data.activity)) this.data.activity = [];
    var existing = new Set();
    this.data.activity.forEach(function(entry) {
      if (entry && entry.id) existing.add(entry.id);
    });
    var added = 0;
    var self = this;
    entries.forEach(function(entry) {
      if (!entry || !entry.id || existing.has(entry.id)) return;
      existing.add(entry.id);
      self.data.activity.push(entry);
      added++;
    });
    if (added > 0) this._save();
    return added;
  },

  _removeActivityEntries: function(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    var ids = new Set();
    entries.forEach(function(entry) {
      if (entry && entry.id) ids.add(entry.id);
    });
    if (ids.size === 0) return 0;
    var before = Array.isArray(this.data.activity) ? this.data.activity.length : 0;
    this.data.activity = (this.data.activity || []).filter(function(entry) {
      return !(entry && ids.has(entry.id));
    });
    var removed = before - this.data.activity.length;
    if (removed > 0) this._save();
    return removed;
  },

  _activityDiff: function(beforeTask, afterTask) {
    if (typeof Activity === 'undefined' || !Activity ||
        typeof Activity.diffTask !== 'function') return [];
    return Activity.diffTask(beforeTask, afterTask, this._activityActor());
  },

  getComments: function(taskId) {
    if (!this.data || !Array.isArray(this.data.comments)) return [];
    if (typeof Comments === 'undefined' || !Comments ||
        typeof Comments.listByTask !== 'function') return [];
    return Comments.listByTask(this.data.comments, taskId);
  },

  addComment: function(taskId, author, text) {
    this.assertWritable();
    if (typeof Comments === 'undefined' || !Comments ||
        typeof Comments.create !== 'function') return null;
    var comment = Comments.create(taskId, author, text);
    if (!comment) return null;
    if (!Array.isArray(this.data.comments)) this.data.comments = [];
    this.data.comments.push(comment);
    this._save();
    return comment;
  },

  updateComment: function(id, text) {
    this.assertWritable();
    if (typeof Comments === 'undefined' || !Comments ||
        typeof Comments.update !== 'function') return null;
    var list = Array.isArray(this.data.comments) ? this.data.comments : [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || list[i].id !== id) continue;
      var updated = Comments.update(list[i], text);
      if (!updated) return null;
      list[i] = updated;
      this._save();
      return updated;
    }
    return null;
  },

  deleteComment: function(id) {
    this.assertWritable();
    if (typeof Comments === 'undefined' || !Comments ||
        typeof Comments.remove !== 'function') return false;
    var list = Array.isArray(this.data.comments) ? this.data.comments : [];
    var next = Comments.remove(list, id);
    if (next.length === list.length) return false;
    this.data.comments = next;
    this._save();
    return true;
  },

  getActivity: function(taskId) {
    if (!this.data || !Array.isArray(this.data.activity)) return [];
    if (typeof Activity === 'undefined' || !Activity ||
        typeof Activity.listByTask !== 'function') return [];
    return Activity.listByTask(this.data.activity, taskId);
  },

  getAttachments: function(taskId) {
    if (!this.data || !Array.isArray(this.data.attachments)) return [];
    if (typeof AttachmentMeta === 'undefined' || !AttachmentMeta ||
        typeof AttachmentMeta.listByTask !== 'function') return [];
    return AttachmentMeta.listByTask(this.data.attachments, taskId);
  },

  getAttachment: function(id) {
    if (!this.data || !Array.isArray(this.data.attachments)) return null;
    var list = this.data.attachments;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  },

  addAttachment: function(taskId, fileMeta) {
    this.assertWritable();
    if (typeof AttachmentMeta === 'undefined' || !AttachmentMeta ||
        typeof AttachmentMeta.create !== 'function') return null;
    var meta = AttachmentMeta.create(taskId, fileMeta);
    if (!meta) return null;
    if (!Array.isArray(this.data.attachments)) this.data.attachments = [];
    this.data.attachments.push(meta);
    this._save();
    return meta;
  },

  deleteAttachment: function(id) {
    this.assertWritable();
    if (typeof AttachmentMeta === 'undefined' || !AttachmentMeta ||
        typeof AttachmentMeta.remove !== 'function') return false;
    var list = Array.isArray(this.data.attachments) ? this.data.attachments : [];
    var next = AttachmentMeta.remove(list, id);
    if (next.length === list.length) return false;
    this.data.attachments = next;
    this._save();
    return true;
  },

  // ---- 撤销重做 ----

  setChangeHandler: function(fn) {
    this._changeHandler = typeof fn === 'function' ? fn : null;
  },

  _notifyChange: function() {
    if (typeof this._changeHandler === 'function') this._changeHandler();
  },

  _historyStack: function() {
    if (!this.history && typeof History !== 'undefined' && History) {
      this.history = History.create();
    }
    return this.history;
  },

  _record: function(command) {
    if (!command) return null;
    if (this._group) {
      command.redo();
      this._group.commands.push(command);
      return command;
    }
    var stack = this._historyStack();
    if (stack) stack.execute(command);
    else command.redo();
    return command;
  },

  // 把一次操作里的多条命令合并成单条历史记录
  transaction: function(label, fn) {
    if (typeof fn !== 'function') return undefined;
    if (this._group) return fn();

    var group = { label: label || '', commands: [] };
    this._group = group;
    var result;
    try {
      result = fn();
    } catch (error) {
      this._group = null;
      for (var i = group.commands.length - 1; i >= 0; i--) {
        try { group.commands[i].undo(); } catch (ignored) {}
      }
      this._buildIndex();
      throw error;
    }
    this._group = null;

    var stack = this._historyStack();
    if (!stack) return result;
    if (group.commands.length === 1) {
      stack.push(group.commands[0]);
    } else if (group.commands.length > 1) {
      var commands = group.commands;
      stack.push({
        label: label || '批量操作',
        undo: function() {
          for (var j = commands.length - 1; j >= 0; j--) commands[j].undo();
        },
        redo: function() {
          for (var k = 0; k < commands.length; k++) commands[k].redo();
        }
      });
    }
    return result;
  },

  undo: function() {
    this.assertWritable();
    var stack = this._historyStack();
    if (!stack) return null;
    var command = stack.undo();
    if (!command) return null;
    this._buildIndex();
    this._notifyChange();
    return command;
  },

  redo: function() {
    this.assertWritable();
    var stack = this._historyStack();
    if (!stack) return null;
    var command = stack.redo();
    if (!command) return null;
    this._buildIndex();
    this._notifyChange();
    return command;
  },

  canUndo: function() {
    var stack = this._historyStack();
    return !!(stack && stack.canUndo());
  },

  canRedo: function() {
    var stack = this._historyStack();
    return !!(stack && stack.canRedo());
  },

  clearHistory: function() {
    var stack = this._historyStack();
    if (stack) stack.clear();
  },

  _snapshot: function(value) {
    if (!value || typeof value !== 'object') return null;
    var copy = {};
    Object.keys(value).forEach(function(key) {
      if (key === 'customFields' && value[key] && typeof value[key] === 'object') {
        copy[key] = JSON.parse(JSON.stringify(value[key]));
      } else {
        copy[key] = value[key];
      }
    });
    return copy;
  },

  _insertTaskSnapshot: function(snapshot) {
    if (!snapshot) return null;
    if (this.getTask(snapshot.id)) return this.getTask(snapshot.id);
    var copy = this._snapshot(snapshot);
    this.data.tasks.push(copy);
    this._save();
    return this.getTask(copy.id);
  },

  _insertMilestoneSnapshot: function(snapshot) {
    if (!snapshot) return null;
    if (this.getMilestone(snapshot.id)) return this.getMilestone(snapshot.id);
    var copy = this._snapshot(snapshot);
    if (!Array.isArray(this.data.milestones)) this.data.milestones = [];
    this.data.milestones.push(copy);
    this._save();
    return this.getMilestone(copy.id);
  },

  _setTaskFields: function(id, fields) {
    var task = this.getTask(id);
    if (!task || !fields) return null;
    Object.keys(fields).forEach(function(key) {
      if (key === 'customFields') {
        task.customFields = fields[key] ? JSON.parse(JSON.stringify(fields[key])) : {};
      } else {
        task[key] = fields[key];
      }
    });
    this._save();
    return task;
  },

  _setMilestoneFields: function(id, fields) {
    var milestone = this.getMilestone(id);
    if (!milestone || !fields) return null;
    Object.keys(fields).forEach(function(key) { milestone[key] = fields[key]; });
    this._save();
    return milestone;
  },

  _removeTasksByIds: function(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    var removed = {};
    ids.forEach(function(id) { removed[id] = true; });
    this.data.tasks = this.data.tasks.filter(function(task) { return !removed[task.id]; });
    this.data.milestones = (this.data.milestones || []).filter(function(m) {
      return !removed[m.taskId];
    });
    this.data.links = this._linkList().filter(function(link) {
      return !removed[link.source] && !removed[link.target];
    });
    this._save();
  },

  _restoreSnapshots: function(taskSnapshots, milestoneSnapshots, linkSnapshots) {
    var self = this;
    (taskSnapshots || []).forEach(function(snapshot) {
      if (!snapshot || self.getTask(snapshot.id)) return;
      self.data.tasks.push(self._snapshot(snapshot));
    });
    if (!Array.isArray(this.data.milestones)) this.data.milestones = [];
    (milestoneSnapshots || []).forEach(function(snapshot) {
      if (!snapshot || self.getMilestone(snapshot.id)) return;
      self.data.milestones.push(self._snapshot(snapshot));
    });
    var links = this._linkList();
    (linkSnapshots || []).forEach(function(snapshot) {
      if (!snapshot) return;
      for (var i = 0; i < links.length; i++) {
        if (links[i] && links[i].id === snapshot.id) return;
      }
      links.push(self._snapshot(snapshot));
    });
    this._save();
  },

  getDepth: function(taskId) {
    if (!this._depth) return 0;
    var depth = this._depth.get(taskId);
    return typeof depth === 'number' ? depth : 0;
  },

  getTask: function(id) {
    if (!this._byId) return null;
    return this._byId.get(id) || null;
  },

  getRootTasks: function() {
    return this._roots ? this._roots.slice() : [];
  },

  getChildren: function(parentId) {
    if (!this._childrenByParent) return [];
    var children = this._childrenByParent.get(parentId);
    return children ? children.slice() : [];
  },

  getDescendants: function(taskId) {
    var result = [];
    var self = this;
    var children = this.getChildren(taskId);
    children.forEach(function(child) {
      result.push(child);
      result = result.concat(self.getDescendants(child.id));
    });
    return result;
  },

  getAllTasks: function() {
    return this.data && Array.isArray(this.data.tasks) ? this.data.tasks.slice() : [];
  },

  getEffectiveColor: function(task) {
    if (task.color) return task.color;
    if (task.parentId) {
      var parent = this.getTask(task.parentId);
      if (parent) return this.getEffectiveColor(parent);
    }
    return DEFAULT_TASK_COLOR;
  },

  getEffectiveStatus: function(task) {
    if (!task) return 'todo';
    var children = this.getChildren(task.id);
    if (!children || children.length === 0) return task.status || 'todo';
    if (typeof Progress !== 'undefined' && Progress && typeof Progress.rollupStatus === 'function') {
      var self = this;
      return Progress.rollupStatus(task, children, function(id) {
        return self.getChildren(id);
      });
    }
    return task.status || 'todo';
  },

  computeRowStatus: function(rows) {
    var result = new Map();
    if (!Array.isArray(rows)) return result;
    var self = this;
    rows.forEach(function(row) {
      if (!row || !row.task) return;
      var id = row.id !== undefined && row.id !== null ? row.id : row.task.id;
      result.set(id, self.getEffectiveStatus(row.task));
    });
    return result;
  },

  getDateRange: function(task) {
    if (task.startDate && task.endDate) {
      return { startDate: task.startDate, endDate: task.endDate };
    }
    var children = this.getChildren(task.id);
    if (children.length === 0) {
      return { startDate: null, endDate: null };
    }
    var minStart = null;
    var maxEnd = null;
    var self = this;
    children.forEach(function(child) {
      var range = self.getDateRange(child);
      if (range.startDate) {
        if (!minStart || range.startDate < minStart) minStart = range.startDate;
      }
      if (range.endDate) {
        if (!maxEnd || range.endDate > maxEnd) maxEnd = range.endDate;
      }
    });
    return { startDate: minStart, endDate: maxEnd };
  },

  addTask: function(parentId, name) {
    this.assertWritable();
    if (parentId) {
      var depth = this.getDepth(parentId);
      if (depth >= 2) {
        alert('最多支持 3 层任务');
        return null;
      }
    }
    var siblings = parentId ? this.getChildren(parentId) : this.getRootTasks();
    var color = null;
    if (!parentId) {
      color = this.COLORS[this.data.tasks.filter(function(t) { return t.parentId === null; }).length % this.COLORS.length];
    }
    var today = DateUtil.format(new Date());
    var weekLater = typeof DateUtil.addDays === 'function'
      ? DateUtil.addDays(today, 7)
      : DateUtil.format(new Date(Date.now() + 7 * 86400000));
    var task = {
      id: DataStore.uuid(), parentId: parentId, name: name.trim(),
      description: '', assignee: '', color: color,
      startDate: today, endDate: weekLater, status: 'todo',
      progress: 0, plannedEndDate: weekLater, locked: false,
      order: siblings.length, ganttRow: null,
      customFields: {}
    };
    var self = this;
    var snapshot = this._snapshot(task);
    var activityEntries = this._activityDiff({ id: task.id }, task);
    this._record({
      label: '新建任务',
      undo: function() {
        self._removeTasksByIds([snapshot.id]);
        self._removeActivityEntries(activityEntries);
      },
      redo: function() {
        self._insertTaskSnapshot(snapshot);
        self._appendActivityEntries(activityEntries);
      }
    });
    return this.getTask(task.id);
  },

  updateTask: function(id, updates) {
    this.assertWritable();
    var task = this.getTask(id);
    if (!task) return null;
    updates = updates || {};
    var newStart = updates.startDate !== undefined ? updates.startDate : task.startDate;
    var newEnd = updates.endDate !== undefined ? updates.endDate : task.endDate;
    if (newStart && newEnd && newEnd < newStart) {
      alert('结束日期不能早于开始日期');
      return null;
    }
    var allowed = ['name', 'description', 'assignee', 'color', 'startDate', 'endDate', 'status', 'order', 'ganttRow', 'parentId', 'progress', 'plannedEndDate', 'locked', 'customFields'];
    var before = {};
    var after = {};
    for (var i = 0; i < allowed.length; i++) {
      var key = allowed[i];
      if (updates[key] === undefined) continue;
      before[key] = task[key];
      after[key] = updates[key];
    }
    if (after.name !== undefined) after.name = String(after.name).trim();
    if (after.assignee !== undefined && after.assignee) after.assignee = String(after.assignee).trim();

    if (updates.customFields !== undefined) {
      var cols = (this.data && this.data.settings && this.data.settings.columns) || [];
      if (typeof ColumnConfig !== 'undefined' && ColumnConfig && typeof ColumnConfig.normalize === 'function') {
        cols = ColumnConfig.normalize(cols);
      }
      var mergedCustom = Object.assign({}, task.customFields || {});
      var customMap = updates.customFields || {};
      for (var fKey in customMap) {
        if (Object.prototype.hasOwnProperty.call(customMap, fKey)) {
          var val = customMap[fKey];
          var colDef = null;
          for (var c = 0; c < cols.length; c++) {
            if (cols[c] && cols[c].key === fKey) {
              colDef = cols[c];
              break;
            }
          }
          if (colDef && typeof ColumnConfig !== 'undefined' && typeof ColumnConfig.validateValue === 'function') {
            var check = ColumnConfig.validateValue(colDef, val);
            if (!check.valid) {
              if (typeof alert === 'function') alert(check.error || '自定义字段校验失败');
              return null;
            }
            val = check.value;
          }
          if (val === null || val === undefined) {
            delete mergedCustom[fKey];
          } else {
            mergedCustom[fKey] = val;
          }
        }
      }
      after.customFields = mergedCustom;
      before.customFields = Object.assign({}, task.customFields || {});
    }

    var beforeFields = {};
    var afterFields = {};
    var changed = false;
    Object.keys(after).forEach(function(field) {
      if (field === 'customFields') {
        if (JSON.stringify(before[field] || {}) === JSON.stringify(after[field] || {})) return;
      } else {
        if (before[field] === after[field]) return;
      }
      beforeFields[field] = before[field];
      afterFields[field] = after[field];
      changed = true;
    });
    if (!changed) return task;

    var beforeTask = this._snapshot(task);
    var afterTask = this._snapshot(task);
    Object.keys(afterFields).forEach(function(field) {
      afterTask[field] = afterFields[field];
    });
    var activityEntries = this._activityDiff(beforeTask, afterTask);

    var self = this;
    this._record({
      label: '编辑任务',
      undo: function() {
        self._setTaskFields(id, beforeFields);
        self._removeActivityEntries(activityEntries);
      },
      redo: function() {
        self._setTaskFields(id, afterFields);
        self._appendActivityEntries(activityEntries);
      }
    });
    return this.getTask(id);
  },

  updateTasks: function(ids, updates) {
    this.assertWritable();
    var self = this;
    var list = Array.isArray(ids) ? ids : [];
    var changed = 0;
    this.transaction('批量更新任务', function() {
      list.forEach(function(id) {
        if (self.updateTask(id, updates)) changed++;
      });
    });
    return changed;
  },

  deleteTask: function(id) {
    this.assertWritable();
    var self = this;
    var bin = typeof RecycleBin !== 'undefined' ? RecycleBin : null;
    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    if (bin && typeof bin.removeTask === 'function' && ws && ws.data) {
      var curr = ws.currentProject();
      if (!curr) {
        throw new Error('当前无项目或未选中项目，不可写入');
      }
      var projectId = curr.id;
      var activeBatchId = null;

      this._record({
        label: '删除任务',
        undo: function() {
          if (!activeBatchId) return;
          var nextWs = bin.restore(ws.data, activeBatchId, { acceptWarnings: true });
          ws.commit(nextWs);
          self._refreshProjectData(ws.currentProject());
          activeBatchId = null;
        },
        redo: function() {
          var res = bin.removeTask(ws.data, projectId, id);
          activeBatchId = res.batchId;
          ws.commit(res.workspace);
          self._refreshProjectData(ws.currentProject());
        }
      });
      return;
    }

    var descendants = this.getDescendants(id);
    var idsToDelete = [id];
    descendants.forEach(function(d) { idsToDelete.push(d.id); });

    var removed = {};
    idsToDelete.forEach(function(taskId) { removed[taskId] = true; });
    var self = this;
    var taskSnapshots = this.data.tasks
      .filter(function(t) { return removed[t.id]; })
      .map(function(t) { return self._snapshot(t); });
    var milestoneSnapshots = (this.data.milestones || [])
      .filter(function(m) { return removed[m.taskId]; })
      .map(function(m) { return self._snapshot(m); });
    var linkSnapshots = this._linkList()
      .filter(function(link) { return removed[link.source] || removed[link.target]; })
      .map(function(link) { return self._snapshot(link); });

    var activityEntries = [];
    taskSnapshots.forEach(function(snapshot) {
      activityEntries = activityEntries.concat(self._activityDiff(snapshot, { id: snapshot.id }));
    });

    this._record({
      label: '删除任务',
      undo: function() {
        self._restoreSnapshots(taskSnapshots, milestoneSnapshots, linkSnapshots);
        self._removeActivityEntries(activityEntries);
      },
      redo: function() {
        self._removeTasksByIds(idsToDelete);
        self._appendActivityEntries(activityEntries);
      }
    });
  },

  // -- 依赖 CRUD --
  _linkList: function() {
    if (!this.data) return [];
    if (!Array.isArray(this.data.links)) this.data.links = [];
    return this.data.links;
  },

  getLinks: function() {
    return this._linkList().slice();
  },

  getLink: function(id) {
    var list = this._linkList();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  },

  addLink: function(source, target, type, lag) {
    this.assertWritable();
    var resolvedType = type === undefined ? 'FS' : type;
    var check = Links.canAdd(this._linkList(), source, target, resolvedType);
    if (!check.ok) {
      return { ok: false, code: check.code, reason: check.reason, link: null };
    }
    if (!this.getTask(source)) {
      return { ok: false, code: 'MISSING_SOURCE', reason: '前置任务不存在', link: null };
    }
    if (!this.getTask(target)) {
      return { ok: false, code: 'MISSING_TARGET', reason: '后置任务不存在', link: null };
    }
    var resolvedLag = lag === undefined ? 0 : lag;
    if (typeof resolvedLag !== 'number' || !isFinite(resolvedLag) ||
        Math.floor(resolvedLag) !== resolvedLag) {
      return { ok: false, code: 'INVALID_LAG', reason: 'lag 必须是以天为单位的整数', link: null };
    }

    var link = Links.create(source, target, resolvedType, resolvedLag);
    this._linkList().push(link);
    this._save();
    return { ok: true, code: null, reason: null, link: link };
  },

  updateLink: function(id, updates) {
    this.assertWritable();
    var link = this.getLink(id);
    if (!link) {
      return { ok: false, code: 'MISSING_LINK', reason: '依赖不存在', link: null };
    }

    updates = updates || {};
    var candidate = {
      id: link.id,
      source: updates.source === undefined ? link.source : updates.source,
      target: updates.target === undefined ? link.target : updates.target,
      type: updates.type === undefined ? link.type : updates.type,
      lag: updates.lag === undefined ? link.lag : updates.lag
    };

    if (typeof candidate.lag !== 'number' || !isFinite(candidate.lag) ||
        Math.floor(candidate.lag) !== candidate.lag) {
      return { ok: false, code: 'INVALID_LAG', reason: 'lag 必须是以天为单位的整数', link: null };
    }

    var others = this._linkList().filter(function(item) {
      return !item || item.id !== id;
    });
    var check = Links.canAdd(others, candidate.source, candidate.target, candidate.type);
    if (!check.ok) {
      return { ok: false, code: check.code, reason: check.reason, link: null };
    }
    if (!this.getTask(candidate.source)) {
      return { ok: false, code: 'MISSING_SOURCE', reason: '前置任务不存在', link: null };
    }
    if (!this.getTask(candidate.target)) {
      return { ok: false, code: 'MISSING_TARGET', reason: '后置任务不存在', link: null };
    }

    link.source = candidate.source;
    link.target = candidate.target;
    link.type = candidate.type;
    link.lag = candidate.lag;
    this._save();
    return { ok: true, code: null, reason: null, link: link };
  },

  deleteLink: function(id) {
    this.assertWritable();
    var list = this._linkList();
    var next = list.filter(function(item) {
      return !item || item.id !== id;
    });
    if (next.length === list.length) return false;
    this.data.links = next;
    this._save();
    return true;
  },

  moveTask: function(taskId, newParentId, newOrder) {
    this.assertWritable();
    var task = this.getTask(taskId);
    if (!task) return false;

    // Prevent moving to self or descendant
    if (taskId === newParentId) return false;
    var descendants = this.getDescendants(taskId);
    for (var i = 0; i < descendants.length; i++) {
      if (descendants[i].id === newParentId) return false;
    }

    // Check depth limit (max 3 layers, depth 0-2)
    var newDepth = 0;
    if (newParentId) {
      newDepth = this.getDepth(newParentId) + 1;
    }

    // Calculate max descendant depth
    var maxDescendantDepth = 0;
    if (descendants.length > 0) {
      for (var i = 0; i < descendants.length; i++) {
        var d = this.getDepth(descendants[i].id);
        if (d > maxDescendantDepth) maxDescendantDepth = d;
      }
    }

    // New depth + relative descendant depth must not exceed limit
    var relativeDescendantDepth = maxDescendantDepth - this.getDepth(taskId);
    if (newDepth + relativeDescendantDepth > 2) {
      alert('移动后子任务层级将超过限制（最多支持 3 层）');
      return false;
    }

    var targetSiblings = newParentId ? this.getChildren(newParentId) : this.getRootTasks();
    var targetIndex = Number(newOrder);
    if (!isFinite(targetIndex)) targetIndex = targetSiblings.length;
    targetIndex = Math.floor(targetIndex);

    // 同父移动时新位置按移除后的兄弟列表计算
    if (task.parentId === newParentId) {
      var oldIndex = -1;
      for (var j = 0; j < targetSiblings.length; j++) {
        if (targetSiblings[j].id === taskId) {
          oldIndex = j;
          break;
        }
      }
      if (oldIndex >= 0 && targetIndex > oldIndex) targetIndex--;
    }

    var before = { parentId: task.parentId, order: task.order };
    var self = this;
    this._record({
      label: '移动任务',
      undo: function() { self._moveTaskCore(taskId, before.parentId, before.order); },
      redo: function() { self._moveTaskCore(taskId, newParentId, targetIndex); }
    });
    return true;
  },

  _moveTaskCore: function(taskId, targetParentId, targetIndex) {
    var task = this.getTask(taskId);
    if (!task) return false;
    var parentId = targetParentId || null;

    var oldSiblings = (task.parentId ? this.getChildren(task.parentId) : this.getRootTasks())
      .filter(function(t) { return t.id !== taskId; });
    var newSiblings = (parentId ? this.getChildren(parentId) : this.getRootTasks())
      .filter(function(t) { return t.id !== taskId; });

    var index = Number(targetIndex);
    if (!isFinite(index)) index = newSiblings.length;
    index = Math.floor(index);
    if (index < 0) index = 0;
    if (index > newSiblings.length) index = newSiblings.length;

    task.parentId = parentId;
    oldSiblings.forEach(function(t, i) { t.order = i; });
    newSiblings.splice(index, 0, task);
    newSiblings.forEach(function(t, i) { t.order = i; });

    this._save();
    return true;
  },

  getMilestone: function(id) {
    if (!this.data || !Array.isArray(this.data.milestones)) return null;
    return this.data.milestones.find(function(m) { return m.id === id; }) || null;
  },

  getMilestonesByTask: function(taskId) {
    if (!this.data || !Array.isArray(this.data.milestones)) return [];
    return this.data.milestones
      .filter(function(m) { return m.taskId === taskId; })
      .sort(function(a, b) { return a.date.localeCompare(b.date); });
  },

  getAllMilestones: function() {
    if (!this.data || !Array.isArray(this.data.milestones)) return [];
    return this.data.milestones.slice();
  },

  addMilestone: function(taskId, name, date, status) {
    this.assertWritable();
    var task = this.getTask(taskId);
    if (task) {
      var range = this.getDateRange(task);
      if (range.startDate && range.endDate) {
        if (date < range.startDate || date > range.endDate) {
          alert('里程碑日期必须在任务的时间范围内');
          return null;
        }
      }
    }
    var milestone = {
      id: DataStore.uuid(), taskId: taskId, name: name.trim(), date: date, status: status || 'pending'
    };
    var self = this;
    var snapshot = this._snapshot(milestone);
    this._record({
      label: '新建里程碑',
      undo: function() {
        self.data.milestones = (self.data.milestones || []).filter(function(m) {
          return m.id !== snapshot.id;
        });
        self._save();
      },
      redo: function() { self._insertMilestoneSnapshot(snapshot); }
    });
    return this.getMilestone(milestone.id);
  },

  updateMilestone: function(id, updates) {
    this.assertWritable();
    var milestone = this.getMilestone(id);
    if (!milestone) return null;
    updates = updates || {};
    var before = {};
    var after = {};
    if (updates.name !== undefined) {
      before.name = milestone.name;
      after.name = String(updates.name).trim();
    }
    if (updates.date !== undefined) {
      before.date = milestone.date;
      after.date = updates.date;
    }
    if (updates.status !== undefined) {
      before.status = milestone.status;
      after.status = updates.status;
    }

    var beforeFields = {};
    var afterFields = {};
    var changed = false;
    Object.keys(after).forEach(function(field) {
      if (before[field] === after[field]) return;
      beforeFields[field] = before[field];
      afterFields[field] = after[field];
      changed = true;
    });
    if (!changed) return milestone;

    var self = this;
    this._record({
      label: '编辑里程碑',
      undo: function() { self._setMilestoneFields(id, beforeFields); },
      redo: function() { self._setMilestoneFields(id, afterFields); }
    });
    return this.getMilestone(id);
  },

  deleteMilestone: function(id) {
    this.assertWritable();
    var milestone = this.getMilestone(id);
    if (!milestone) return;
    var self = this;
    var snapshot = this._snapshot(milestone);
    this._record({
      label: '删除里程碑',
      undo: function() { self._insertMilestoneSnapshot(snapshot); },
      redo: function() {
        self.data.milestones = (self.data.milestones || []).filter(function(m) {
          return m.id !== snapshot.id;
        });
        self._save();
      }
    });
  },

  // -- 基线 --
  // 快照存放在数据根节点的 baseline 字段，读取时先做结构校验
  getBaseline: function() {
    if (!this.data) return null;
    var snapshot = this.data.baseline;
    if (!snapshot) return null;
    if (typeof Baseline === 'undefined' || !Baseline ||
        typeof Baseline.validateSnapshot !== 'function') {
      return null;
    }
    var result = Baseline.validateSnapshot(snapshot);
    if (!result || !result.valid) {
      if (this._baselineWarned !== snapshot) {
        this._baselineWarned = snapshot;
        var message = result && result.errors && result.errors.length
          ? result.errors[0].message
          : '结构不完整';
        alert('基线数据无效，已忽略：' + message);
      }
      return null;
    }
    return snapshot;
  },

  hasBaseline: function() {
    return this.getBaseline() !== null;
  },

  saveBaseline: function() {
    this.assertWritable();
    if (!this.data) return null;
    if (typeof Baseline === 'undefined' || !Baseline ||
        typeof Baseline.createSnapshot !== 'function') {
      return null;
    }
    var snapshot = Baseline.createSnapshot(this.getAllTasks(), new Date().toISOString());
    this.data.baseline = snapshot;
    this._baselineWarned = null;
    this._save();
    return snapshot;
  },

  clearBaseline: function() {
    this.assertWritable();
    if (!this.data) return false;
    if (this.data.baseline === undefined || this.data.baseline === null) return false;
    this.data.baseline = null;
    this._baselineWarned = null;
    this._save();
    return true;
  },

  // -- 工作日历与工作日权重 --

  _workCalendarRaw: function() {
    if (!this.data || !this.data.settings) return null;
    var settings = this.data.settings;
    var rawWork = (settings.workCalendar && typeof settings.workCalendar === 'object') ? settings.workCalendar : null;
    var rawOverrides = (settings.calendarOverrides && typeof settings.calendarOverrides === 'object') ? settings.calendarOverrides : null;

    if (!rawWork && !rawOverrides) return null;
    if (!rawOverrides) return rawWork;

    // 解包可能的嵌套 calendarOverrides (TASK6-MINR03 兼容)
    var overrides = (rawOverrides.calendarOverrides && typeof rawOverrides.calendarOverrides === 'object')
      ? rawOverrides.calendarOverrides
      : rawOverrides;

    // 确定周规则 (weekends)：优先取 overrides 中的 weekends（若显式配置），否则平滑回退到 workCalendar 中的 weekends
    var weekends;
    if (overrides && overrides.weekends !== undefined) {
      weekends = overrides.weekends;
    } else if (rawWork && rawWork.weekends !== undefined) {
      weekends = rawWork.weekends;
    }

    // 收集 overrides 中的显式节假日与工作日
    var overrideHolidayList = [];
    var overrideWorkdayList = [];

    if (Array.isArray(overrides.holidays)) {
      overrideHolidayList = overrideHolidayList.concat(overrides.holidays);
    }
    if (Array.isArray(overrides.workdays)) {
      overrideWorkdayList = overrideWorkdayList.concat(overrides.workdays);
    }

    // 兼容日期键名字典或数组形式的 overrides
    if (Array.isArray(overrides)) {
      overrides.forEach(function(item) {
        if (item && item.date) {
          if (item.working) overrideWorkdayList.push(item.date);
          else overrideHolidayList.push(item.date);
        }
      });
    } else if (typeof overrides === 'object') {
      var dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
      Object.keys(overrides).forEach(function(key) {
        if (dateKeyPattern.test(key)) {
          var val = overrides[key];
          if (val === false || (val && typeof val === 'object' && val.working === false)) {
            overrideHolidayList.push(key);
          } else if (val === true || (val && typeof val === 'object' && val.working === true)) {
            overrideWorkdayList.push(key);
          }
        }
      });
    }

    var overrideHolidaySet = new Set(overrideHolidayList);
    var overrideWorkdaySet = new Set(overrideWorkdayList);

    // 同一 override 内部若同时存在同一日期，依 WorkCalendar 规范 workdays 优先级高于 holidays
    overrideWorkdaySet.forEach(function(d) {
      overrideHolidaySet.delete(d);
    });

    // 收集旧 settings.workCalendar 的列表，消除被 override 反向覆盖的冲突项
    var legacyHolidays = (rawWork && Array.isArray(rawWork.holidays)) ? rawWork.holidays : [];
    var legacyWorkdays = (rawWork && Array.isArray(rawWork.workdays)) ? rawWork.workdays : [];

    var holidaySet = new Set();
    var workdaySet = new Set();

    // 1. 继承未被 override 冲突覆盖的 legacy 项：
    //    overrideHolidaySet 消除旧 workdays 中的冲突日期；
    //    overrideWorkdaySet 消除旧 holidays 中的冲突日期。
    legacyHolidays.forEach(function(d) {
      if (!overrideWorkdaySet.has(d) && !overrideHolidaySet.has(d)) {
        holidaySet.add(d);
      }
    });

    legacyWorkdays.forEach(function(d) {
      if (!overrideHolidaySet.has(d) && !overrideWorkdaySet.has(d)) {
        workdaySet.add(d);
      }
    });

    // 2. 叠加 override 中的明确项
    overrideHolidaySet.forEach(function(d) {
      holidaySet.add(d);
    });

    overrideWorkdaySet.forEach(function(d) {
      workdaySet.add(d);
    });

    // 再次保证两者绝对互斥（workdays 优先）
    workdaySet.forEach(function(d) {
      holidaySet.delete(d);
    });

    var holidays = [];
    holidaySet.forEach(function(d) { holidays.push(d); });
    var workdays = [];
    workdaySet.forEach(function(d) { workdays.push(d); });

    if (weekends === undefined && holidays.length === 0 && workdays.length === 0) {
      return null;
    }

    return {
      weekends: weekends,
      holidays: holidays,
      workdays: workdays
    };
  },

  hasWorkCalendarConfig: function() {
    var raw = this._workCalendarRaw();
    return !!raw && typeof raw === 'object';
  },

  getWorkCalendar: function() {
    if (typeof WorkCalendar === 'undefined' || !WorkCalendar) return null;
    return WorkCalendar.createConfig(this._workCalendarRaw() || {});
  },

  taskDurationWeight: function(task) {
    if (!task || !this.hasWorkCalendarConfig()) return null;
    var config = this.getWorkCalendar();
    if (!config || typeof WorkCalendar === 'undefined' || !WorkCalendar) return null;
    return WorkCalendar.durationWeight(task.startDate, task.endDate, config);
  },

  setWorkCalendar: function(options) {
    this.assertWritable();
    if (typeof WorkCalendar === 'undefined' || !WorkCalendar) return null;
    var config = WorkCalendar.createConfig(options || {});
    this.setSetting('workCalendar', config);
    return config;
  },

  // 未配置工作日历时返回 null，排期与关键路径按自然日计算
  getSchedulerConfig: function() {
    if (!this.hasWorkCalendarConfig()) return null;
    return { workCalendar: this.getWorkCalendar() };
  },

  isTaskLocked: function(task) {
    return !!(task && (task.locked === true || task.manualLock === true));
  },

  _isDateString: function(value) {
    if (typeof value !== 'string') return false;
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    var year = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    var day = parseInt(match[3], 10);
    var date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
  },

  // 配置了工作日历时按工作日权重汇总，未配置时沿用 Progress 的自然日口径
  computeRowProgress: function(rows) {
    var result = new Map();
    if (!Array.isArray(rows)) return result;
    if (typeof Progress === 'undefined' || !Progress ||
        typeof Progress.computeRowProgress !== 'function') {
      return result;
    }

    var self = this;
    var config = this.hasWorkCalendarConfig() ? this.getWorkCalendar() : null;
    if (!config || typeof WorkCalendar === 'undefined' || !WorkCalendar) {
      return Progress.computeRowProgress(rows, function(id) {
        return self.getChildren(id);
      });
    }

    function clamp(value) {
      if (typeof value !== 'number' || value !== value) return 0;
      if (value <= 0) return 0;
      if (value >= 100) return 100;
      return value;
    }

    function leafProgress(task) {
      if (!task) return 0;
      if (task.status === 'done') return 100;
      var value = clamp(task.progress);
      if (task.status === 'thirdParty') return value < 30 ? 30 : value;
      return value;
    }

    function rollup(task, seen) {
      if (!task) return 0;
      var id = task.id;
      if (id !== undefined && id !== null) {
        if (seen.has(id)) return leafProgress(task);
        seen.add(id);
      }

      var children = self.getChildren(id);
      if (children.length === 0) return leafProgress(task);

      var allDated = children.every(function(child) {
        return !!child && self._isDateString(child.startDate) && self._isDateString(child.endDate);
      });

      var weighted = 0;
      var weightSum = 0;
      children.forEach(function(child) {
        if (!child) return;
        var childProgress = rollup(child, seen);
        var weight = allDated
          ? WorkCalendar.durationWeight(child.startDate, child.endDate, config)
          : 1;
        weighted += childProgress * weight;
        weightSum += weight;
      });

      if (weightSum <= 0) return leafProgress(task);
      return clamp(weighted / weightSum);
    }

    rows.forEach(function(row) {
      if (!row || !row.task) return;
      var id = row.id !== undefined && row.id !== null ? row.id : row.task.id;
      result.set(id, rollup(row.task, new Set()));
    });
    return result;
  },

  getSetting: function(key) {
    if (!this.data || !this.data.settings) return undefined;
    return this.data.settings[key];
  },

  setSetting: function(key, value) {
    this.assertWritable();
    if (!this.data.settings) this.data.settings = {};
    this.data.settings[key] = value;
    this._save();
  },

  replaceData: function(newData) {
    this.assertWritable();
    this.data = newData;
    this._ensureCollaboration();
    this._save();
  }
};
