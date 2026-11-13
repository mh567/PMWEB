// ============================================================
// == App: 初始化、事件绑定、视图切换
// ============================================================
function _collabEscape(value) {
  var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value === null || value === undefined ? '' : value)
    .replace(/[&<>"']/g, function(ch) { return map[ch]; });
}

var ACTIVITY_FIELD_LABELS = {
  name: '任务名称',
  status: '状态',
  assignee: '负责人',
  startDate: '开始日期',
  endDate: '结束日期',
  plannedEndDate: '计划完成',
  progress: '进度'
};

var COLLAB_STATUS_LABELS = {
  todo: '未开始',
  inProgress: '进行中',
  thirdParty: '第三方',
  done: '已完成'
};

var App = {
  currentView: 'gantt',

  init: function() {
    TaskManager.init();
    ModalManager.init();

    var self = this;
    if (typeof ProjectUI !== 'undefined' && ProjectUI && typeof ProjectUI.init === 'function') {
      ProjectUI.init({
        onSelect: function(projectId) {
          if (typeof Workspace !== 'undefined' && Workspace.activate) {
            Workspace.activate(projectId);
          }
          self._restoreProjectPanels();
          self._reloadProjectColumns();
          var gran = (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getSetting === 'function')
            ? (TaskManager.getSetting('lastGranularity') || 'day')
            : 'day';
          if (typeof GanttView !== 'undefined' && GanttView) GanttView.granularity = gran;
          if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setGranularity === 'function') {
            Workbench.setGranularity(gran);
          }
          self.renderAll();
          self._setupMidnightTimer();
        }
      });
    }

    if (typeof RecycleBinUI !== 'undefined' && RecycleBinUI && typeof RecycleBinUI.init === 'function') {
      RecycleBinUI.init();
    }

    TreeView.init();
    ViewState.statusFilter = TreeView.statusFilter;
    Workbench.init();
    var calContainer = document.getElementById('calendar-panel') || document.getElementById('timeline-body');
    if (calContainer && typeof CalendarView !== 'undefined' && CalendarView && typeof CalendarView.init === 'function') {
      CalendarView.init(calContainer);
    }
    DragManager.init();
    _bindKeyboardActivation();

    TaskManager.setChangeHandler(function() { self.renderAll(); });

    this._restoreProjectPanels();
    this._reloadProjectColumns();
    var granularity = (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getSetting === 'function')
      ? (TaskManager.getSetting('lastGranularity') || 'day')
      : 'day';
    if (typeof GanttView !== 'undefined' && GanttView) GanttView.granularity = granularity;
    if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setGranularity === 'function') {
      Workbench.setGranularity(granularity);
    }

    this._bindToolbar();
    this._bindMenuEvents();
    this._bindQuickFilters();
    this._initUndoRedoControls();
    this._initHolidaySubscription();
    this._bindHistoryShortcuts();
    this._updateViewButtons();
    this._updateGranularityButtons();
    this.renderAll();
    this._bindVisibilityChange();
    this._setupMidnightTimer();

    var todosContainer = document.getElementById('todos-list');
    if (todosContainer && !this._todosClickBound) {
      this._todosClickBound = true;
      todosContainer.addEventListener('click', function(e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var item = target.closest('.todo-item');
        if (item && item.dataset && item.dataset.milestoneId) {
          self.toggleMilestoneStatus(item.dataset.milestoneId);
        }
      });
    }

    if (typeof Workspace !== 'undefined' && !Workspace.currentProject()) {
      if (typeof ProjectUI !== 'undefined' && ProjectUI && typeof ProjectUI.open === 'function') {
        ProjectUI.open();
      }
    }
  },

  _reloadProjectColumns: function() {
    if (typeof GridPane !== 'undefined' && GridPane &&
        typeof GridPane.reloadColumnsForCurrentProject === 'function') {
      try {
        GridPane.reloadColumnsForCurrentProject();
      } catch (err) {}
    }
  },

  _restoreProjectPanels: function() {
    var saved = null;
    if (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getSetting === 'function') {
      saved = TaskManager.getSetting('panels');
    }
    var panels;
    if (saved && typeof saved === 'object') {
      panels = {
        ganttVisible: typeof saved.ganttVisible === 'boolean' ? saved.ganttVisible : true,
        calendarVisible: typeof saved.calendarVisible === 'boolean' ? saved.calendarVisible : false,
        nodesVisible: typeof saved.nodesVisible === 'boolean' ? saved.nodesVisible : true
      };
    } else {
      var lastView = (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getSetting === 'function')
        ? TaskManager.getSetting('lastView')
        : 'gantt';
      if (lastView === 'calendar') {
        panels = { ganttVisible: false, calendarVisible: true, nodesVisible: true };
      } else {
        panels = { ganttVisible: true, calendarVisible: false, nodesVisible: true };
      }
    }
    this.currentPanels = panels;
    this.currentView = panels.calendarVisible && !panels.ganttVisible ? 'calendar' : 'gantt';
    if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setPanels === 'function') {
      Workbench.setPanels(panels);
    }
    this._updateViewButtons();
    return panels;
  },

  setPanels: function(settings) {
    if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setPanels === 'function') {
      Workbench.setPanels(settings);
    }
    var current = (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.getPanels === 'function')
      ? Workbench.getPanels()
      : (settings || { ganttVisible: true, calendarVisible: false, nodesVisible: true });
    this.currentPanels = current;
    this.currentView = current.calendarVisible && !current.ganttVisible ? 'calendar' : 'gantt';

    var isReadOnly = false;
    if (typeof Workspace !== 'undefined' && Workspace) {
      if (typeof Workspace.isReadOnly === 'function' && Workspace.isReadOnly()) {
        isReadOnly = true;
      }
      var curProj = typeof Workspace.currentProject === 'function' ? Workspace.currentProject() : null;
      if (curProj && curProj.archived) {
        isReadOnly = true;
      }
    }

    if (!isReadOnly && typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.setSetting === 'function') {
      try {
        TaskManager.setSetting('panels', current);
      } catch (err) {}
    }
    this._updateViewButtons();
  },

  togglePanel: function(name) {
    var cur = (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.getPanels === 'function')
      ? Workbench.getPanels()
      : (this.currentPanels || { ganttVisible: true, calendarVisible: false, nodesVisible: true });
    if (name === 'gantt') {
      this.setPanels({ ganttVisible: !cur.ganttVisible });
    } else if (name === 'calendar') {
      this.setPanels({ calendarVisible: !cur.calendarVisible });
    } else if (name === 'nodes') {
      this.setPanels({ nodesVisible: !cur.nodesVisible });
    }
  },

  renderAll: function() {
    Workbench.render();
    this._syncProjectButton();
    this._syncHistoryButtons();
    this._updateStatusBar();
    this._updateTodosSidebar();
  },

  _updateTodosSidebar: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    var today = DateUtil.format(new Date());
    var allMilestones = (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getAllMilestones === 'function')
      ? TaskManager.getAllMilestones()
      : [];
    var todayMilestones = allMilestones.filter(function(ms) {
      return ms && ms.date === today;
    });

    var container = doc.getElementById('todos-list');
    if (!container) return;

    if (todayMilestones.length === 0) {
      container.innerHTML = '<div class="todos-empty" data-legacy="今日暂无待办">今日暂无节点</div>';
      return;
    }

    var html = '';
    todayMilestones.forEach(function(ms) {
      var task = TaskManager.getTask(ms.taskId);
      var isDone = ms.status === 'done';
      var icon = isDone ? '○' : '□';
      var doneClass = isDone ? ' done' : '';
      html += '<div class="todo-item' + doneClass + '" role="button" tabindex="0" data-keyboard-activate data-milestone-id="' + _escapeHtml(ms.id) + '">'
        + '<span class="todo-icon">' + icon + '</span>'
        + '<div class="todo-content">'
        + '<div class="todo-name">' + _escapeHtml(ms.name) + '</div>'
        + '<div class="todo-task">' + (task ? _escapeHtml(task.name) : '') + '</div>'
        + '</div></div>';
    });
    container.innerHTML = html;
  },

  _midnightTimer: null,
  _visibilityBound: false,
  _onVisibilityChange: null,

  _setupMidnightTimer: function() {
    if (this._midnightTimer) {
      clearTimeout(this._midnightTimer);
      this._midnightTimer = null;
    }
    var now = new Date();
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    var msUntilMidnight = Math.max(tomorrow.getTime() - now.getTime(), 1000);
    var self = this;
    this._midnightTimer = setTimeout(function() {
      self._onDayCrossed();
    }, msUntilMidnight);
  },

  _bindVisibilityChange: function() {
    if (this._visibilityBound) return;
    var self = this;
    this._onVisibilityChange = function() {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        self._onDayCrossed();
      }
    };
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
      this._visibilityBound = true;
    }
  },

  _onDayCrossed: function() {
    this._setupMidnightTimer();
    if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.render === 'function') {
      Workbench.render();
    }
    this._updateTodosSidebar();
    this._updateStatusBar();
  },

  _teardownMidnight: function() {
    if (this._midnightTimer) {
      clearTimeout(this._midnightTimer);
      this._midnightTimer = null;
    }
    if (this._visibilityBound && this._onVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._visibilityBound = false;
      this._onVisibilityChange = null;
    }
  },

  _bindToolbar: function() {
    var self = this;
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;

    var projectSelectBtn = doc.getElementById('btn-project-select');
    if (projectSelectBtn) {
      projectSelectBtn.addEventListener('click', function() {
        if (typeof ProjectUI !== 'undefined' && ProjectUI && typeof ProjectUI.open === 'function') {
          ProjectUI.open();
        }
      });
    }

    var searchInput = doc.getElementById('search-task') || doc.getElementById('search');
    if (searchInput) {
      searchInput.addEventListener('input', function(e) {
        if (typeof ViewState !== 'undefined' && ViewState && ViewState.view && ViewState.view.filters) {
          ViewState.view.filters.search = e.target.value;
        }
        self.renderAll();
      });
    }

    var btnAddRoot = doc.getElementById('btn-add-root-task') || doc.getElementById('btn-new-task');
    if (btnAddRoot) {
      btnAddRoot.addEventListener('click', function() {
        self.showAddTask(null);
      });
    }

    var btnViewGantt = doc.getElementById('btn-view-gantt');
    if (btnViewGantt) {
      btnViewGantt.addEventListener('click', function() { self.togglePanel('gantt'); });
    }

    var btnViewCalendar = doc.getElementById('btn-view-calendar');
    if (btnViewCalendar) {
      btnViewCalendar.addEventListener('click', function() { self.togglePanel('calendar'); });
    }

    var btnColumnSettings = doc.getElementById('btn-column-settings');
    if (btnColumnSettings) {
      btnColumnSettings.addEventListener('click', function() {
        self.openColumnSettings(btnColumnSettings);
      });
    }

    var btnMenu = doc.getElementById('btn-menu');
    if (btnMenu) {
      btnMenu.addEventListener('click', function(e) {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        self.toggleMenu();
      });
    }

    var btnToggleNodes = doc.getElementById('btn-toggle-nodes');
    if (btnToggleNodes) {
      btnToggleNodes.addEventListener('click', function() {
        if (btnToggleNodes.type === 'checkbox') {
          self.setPanels({ nodesVisible: btnToggleNodes.checked });
        } else {
          self.togglePanel('nodes');
        }
      });
      btnToggleNodes.addEventListener('change', function() {
        self.setPanels({ nodesVisible: btnToggleNodes.checked });
      });
    }

    var fileInput = doc.getElementById('import-backup-file');
    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        if (e.target && e.target.files && e.target.files[0]) {
          self.previewImport(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // 兼容历史按钮
    var btnImport = doc.getElementById('btn-import');
    if (btnImport) btnImport.addEventListener('click', function() { self.importData(); });
    var btnExport = doc.getElementById('btn-export');
    if (btnExport) btnExport.addEventListener('click', function() { self.exportBackup('workspace'); });
    var btnExportExcel = doc.getElementById('btn-export-excel');
    if (btnExportExcel) btnExportExcel.addEventListener('click', function() { self.exportToExcel(); });
  },

  _bindMenuEvents: function() {
    var self = this;
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;

    var menuDropdown = doc.getElementById('menu-dropdown') || doc.getElementById('app-menu-dropdown');
    if (menuDropdown) {
      menuDropdown.addEventListener('click', function(e) {
        var target = e.target ? (e.target.closest ? e.target.closest('[data-action]') : e.target) : null;
        if (!target) return;
        var action = target.getAttribute('data-action');
        if (!action) return;

        self.closeMenu();

        if (action === 'open-projects') {
          if (typeof ProjectUI !== 'undefined' && ProjectUI && typeof ProjectUI.open === 'function') {
            ProjectUI.open();
          }
        } else if (action === 'open-work-calendar') {
          self.showWorkCalendar();
        } else if (action === 'open-recycle-bin') {
          self.openRecycleBin();
        } else if (action === 'export-workspace') {
          self.exportBackup('workspace');
        } else if (action === 'export-project') {
          self.exportBackup('project');
        } else if (action === 'import-backup') {
          var fi = doc.getElementById('import-backup-file');
          if (fi && typeof fi.click === 'function') {
            fi.click();
          }
        } else if (action === 'export-excel') {
          self.exportToExcel();
        } else if (action === 'open-startup') {
          self.showStartupSettings();
        } else if (action === 'print') {
          self.print();
        }
      });
    }

    // 外部点击关闭
    doc.addEventListener('click', function(e) {
      if (!self.isMenuOpen()) return;
      var menuContainer = doc.getElementById('app-menu');
      if (menuContainer && menuContainer.contains && menuContainer.contains(e.target)) return;
      self.closeMenu();
    });

    // Escape 键关闭与方向键导航
    doc.addEventListener('keydown', function(e) {
      if (!self.isMenuOpen()) return;
      if (e.key === 'Escape') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        self.closeMenu();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        var menuEl = doc.getElementById('menu-dropdown') || doc.getElementById('app-menu-dropdown');
        var items = menuEl ? menuEl.querySelectorAll('.menu-item') : [];
        if (!items || items.length === 0) return;
        var active = doc.activeElement;
        var idx = -1;
        for (var i = 0; i < items.length; i++) {
          if (items[i] === active) { idx = i; break; }
        }
        var nextIdx = 0;
        if (e.key === 'ArrowDown') {
          nextIdx = (idx + 1) % items.length;
        } else {
          nextIdx = (idx - 1 + items.length) % items.length;
        }
        if (items[nextIdx] && typeof items[nextIdx].focus === 'function') {
          items[nextIdx].focus();
        }
      }
    });
  },

  _bindQuickFilters: function() {
    var self = this;
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    var filterContainer = doc.getElementById('quick-filters');
    if (!filterContainer) return;

    filterContainer.addEventListener('click', function(e) {
      var btn = e.target ? (e.target.closest ? e.target.closest('[data-filter]') : e.target) : null;
      if (!btn) return;
      var filterKey = btn.getAttribute('data-filter');
      if (!filterKey) return;

      if (typeof ViewState !== 'undefined' && ViewState && ViewState.view && ViewState.view.filters) {
        if (filterKey === 'all') {
          ViewState.view.filters.status = '';
          ViewState.view.filters.due = '';
        } else if (['todo', 'inProgress', 'thirdParty', 'done'].indexOf(filterKey) !== -1) {
          ViewState.view.filters.status = filterKey;
          ViewState.view.filters.due = '';
        } else if (['overdue', 'today', 'next7'].indexOf(filterKey) !== -1) {
          ViewState.view.filters.status = '';
          ViewState.view.filters.due = filterKey;
        }
      }

      var allBtns = filterContainer.querySelectorAll('[data-filter]');
      for (var i = 0; i < allBtns.length; i++) {
        allBtns[i].classList.toggle('active', allBtns[i] === btn);
      }

      self.renderAll();
    });
  },

  isMenuOpen: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return false;
    var menuDropdown = doc.getElementById('menu-dropdown') || doc.getElementById('app-menu-dropdown');
    if (!menuDropdown) return false;
    return !menuDropdown.hasAttribute('hidden') && menuDropdown.style.display !== 'none';
  },

  openMenu: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    var menuDropdown = doc.getElementById('menu-dropdown') || doc.getElementById('app-menu-dropdown');
    var btnMenu = doc.getElementById('btn-menu');
    if (menuDropdown) {
      menuDropdown.removeAttribute('hidden');
      menuDropdown.style.display = 'block';
      if (btnMenu) btnMenu.setAttribute('aria-expanded', 'true');
      var firstItem = menuDropdown.querySelector('.menu-item');
      if (firstItem && typeof firstItem.focus === 'function') firstItem.focus();
    }
  },

  closeMenu: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    var menuDropdown = doc.getElementById('menu-dropdown') || doc.getElementById('app-menu-dropdown');
    var btnMenu = doc.getElementById('btn-menu');
    if (menuDropdown) {
      menuDropdown.setAttribute('hidden', '');
      menuDropdown.style.display = 'none';
      if (btnMenu) {
        btnMenu.setAttribute('aria-expanded', 'false');
        if (typeof btnMenu.focus === 'function') btnMenu.focus();
      }
    }
  },

  toggleMenu: function() {
    if (this.isMenuOpen()) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  },

  _syncProjectButton: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    var btn = doc.getElementById('btn-project-select');
    if (!btn) return;
    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    var cur = (ws && typeof ws.currentProject === 'function') ? ws.currentProject() : null;
    if (cur) {
      var title = cur.name;
      if (cur.archived) title += ' [已归档/只读]';
      else if (cur.status === 'completed') title += ' [已完成]';
      btn.textContent = title + ' ▾';
      btn.title = cur.name + (cur.description ? ' - ' + cur.description : '');
    } else {
      btn.textContent = '选择项目 ▾';
      btn.title = '未选择项目，点击选择或新建项目';
    }
  },

  // -- 撤销重做 UI --
  _initUndoRedoControls: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    var btnUndo = doc.getElementById('btn-undo');
    var btnRedo = doc.getElementById('btn-redo');

    // 若 DOM 中未提供，则就近挂载到表格附近（context-left 或 grid-header）
    if (!btnUndo || !btnRedo) {
      var container = doc.querySelector('.context-left') || doc.getElementById('context-bar') || doc.getElementById('grid-header');
      if (container) {
        var group = doc.createElement('div');
        group.className = 'btn-group history-group-compact';
        group.id = 'history-group';
        group.innerHTML =
          '<button class="btn btn-sm btn-icon" id="btn-undo" type="button" disabled title="撤销 (Ctrl+Z)">撤销</button>'
          + '<button class="btn btn-sm btn-icon" id="btn-redo" type="button" disabled title="重做 (Ctrl+Shift+Z)">重做</button>';
        container.appendChild(group);
        btnUndo = doc.getElementById('btn-undo');
        btnRedo = doc.getElementById('btn-redo');
      }
    }

    var self = this;
    if (btnUndo && !btnUndo._bound) {
      btnUndo._bound = true;
      btnUndo.addEventListener('click', function() { self.undo(); });
    }
    if (btnRedo && !btnRedo._bound) {
      btnRedo._bound = true;
      btnRedo.addEventListener('click', function() { self.redo(); });
    }
    this._syncHistoryButtons();
  },

  _syncHistoryButtons: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    var undoBtn = doc.getElementById('btn-undo');
    var redoBtn = doc.getElementById('btn-redo');
    if (!undoBtn || !redoBtn) return;
    var canUndo = typeof TaskManager !== 'undefined' && TaskManager &&
      typeof TaskManager.canUndo === 'function' && TaskManager.canUndo();
    var canRedo = typeof TaskManager !== 'undefined' && TaskManager &&
      typeof TaskManager.canRedo === 'function' && TaskManager.canRedo();
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  },

  undo: function() {
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.undo !== 'function') return null;
    var command = TaskManager.undo();
    this._syncHistoryButtons();
    return command;
  },

  redo: function() {
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.redo !== 'function') return null;
    var command = TaskManager.redo();
    this._syncHistoryButtons();
    return command;
  },

  _isTextEditingTarget: function(target) {
    if (!target || !target.tagName) return false;
    var tag = String(target.tagName).toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!target.isContentEditable;
  },

  _bindHistoryShortcuts: function() {
    if (typeof document === 'undefined' || this._historyShortcutsBound) return;
    var self = this;
    document.addEventListener('keydown', function(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey) return;
      var key = e.key ? String(e.key).toLowerCase() : '';
      if (key !== 'z') return;
      if (typeof ModalManager !== 'undefined' && ModalManager &&
          typeof ModalManager.isOpen === 'function' && ModalManager.isOpen()) return;
      if (self._isTextEditingTarget(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) self.redo();
      else self.undo();
    });
    this._historyShortcutsBound = true;
  },

  // -- 工作日历 --
  _initWorkCalendarButton: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    if (doc.getElementById('btn-work-calendar')) return;
    var toolbar = doc.getElementById('toolbar');
    if (!toolbar) return;

    var self = this;
    var button = doc.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.id = 'btn-work-calendar';
    button.title = '设置周末、节假日和补班日';
    button.textContent = '工作日历';
    button.addEventListener('click', function() { self.showWorkCalendarSettings(); });

    var anchor = doc.getElementById('btn-add-root-task');
    if (anchor && toolbar.insertBefore) toolbar.insertBefore(button, anchor);
    else toolbar.appendChild(button);
  },

  _initHolidaySubscription: function() {
    if (typeof HolidaySource === 'undefined' || !HolidaySource) return;
    if (typeof Workspace === 'undefined' || !Workspace || !Workspace.data || !Workspace.data.calendar) return;
    if (Workspace.data.calendar.subscribed === false) return;
    var curYear = new Date().getFullYear();
    var self = this;
    HolidaySource.refresh(curYear, { force: false }).then(function() {
      self.renderAll();
    }).catch(function() {});
  },

  showWorkCalendar: function() {
    this.showWorkCalendarSettings();
  },

  showWorkCalendarSettings: function() {
    if (typeof ModalManager === 'undefined' || !ModalManager ||
        typeof ModalManager.showWorkCalendarForm !== 'function') return;
    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    var originProjectId = ws ? (ws.activeProjectId || (ws.currentProject ? (ws.currentProject() ? ws.currentProject().id : null) : null)) : null;
    if (!originProjectId) {
      this.showNotice('未选择项目，无法配置工作日历', 'error');
      return;
    }
    var config = null;
    if (typeof TaskManager !== 'undefined' && TaskManager &&
        typeof TaskManager.getWorkCalendar === 'function') {
      config = TaskManager.getWorkCalendar();
    }
    var self = this;
    ModalManager.showWorkCalendarForm(config, function(options) {
      if (!options) return;
      var curId = ws ? (ws.activeProjectId || (ws.currentProject ? (ws.currentProject() ? ws.currentProject().id : null) : null)) : null;
      if (curId !== originProjectId) {
        self.showNotice('当前项目已切换，工作日历修改已取消', 'error');
        return;
      }
      if (ws) {
        if (typeof ws.isReadOnly === 'function' && ws.isReadOnly()) {
          self.showNotice('工作区处于只读状态，无法保存工作日历', 'error');
          return;
        }
        if (typeof ws.isLocked === 'function' && ws.isLocked()) {
          self.showNotice('工作区已被写锁锁定，无法保存工作日历', 'error');
          return;
        }
      }
      if (typeof TaskManager !== 'undefined' && TaskManager &&
          typeof TaskManager.setWorkCalendar === 'function') {
        try {
          TaskManager.setWorkCalendar(options);
          self.showNotice('工作日历保存成功', 'success');
        } catch (err) {
          self.showNotice('工作日历保存失败：' + (err && err.message ? err.message : err), 'error');
        }
      }
      self.renderAll();
    });
  },

  openColumnSettings: function(trigger) {
    if (typeof GridPane !== 'undefined' && GridPane && typeof GridPane._showColumnPanel === 'function') {
      GridPane._showColumnPanel(trigger, { toggle: true });
    }
  },

  showNotice: function(message, type) {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    var banner = doc.getElementById('app-notice-banner');
    if (!banner) {
      banner = doc.createElement('div');
      banner.id = 'app-notice-banner';
      banner.setAttribute('role', 'alert');
      doc.body.appendChild(banner);
    }
    type = type || 'info';
    banner.className = 'app-notice-banner active ' + type;
    banner.textContent = message;
    if (this._noticeTimeout) clearTimeout(this._noticeTimeout);
    var self = this;
    this._noticeTimeout = setTimeout(function() {
      if (banner && banner.classList) banner.classList.remove('active');
    }, 4000);
  },

  exportBackup: function(scope) {
    scope = scope || 'workspace';
    var self = this;
    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    if (!ws || !ws.data) {
      self.showNotice('工作区未初始化，无法导出备份', 'error');
      return Promise.reject(new Error('工作区未初始化'));
    }
    var projId = undefined;
    var curProj = typeof ws.currentProject === 'function' ? ws.currentProject() : null;
    if (scope === 'project') {
      if (!curProj) {
        self.showNotice('未选择项目，无法导出项目备份', 'error');
        return Promise.reject(new Error('未选择项目'));
      }
      projId = curProj.id;
    }
    var BackupService = typeof Backup !== 'undefined' ? Backup : null;
    if (!BackupService || typeof BackupService.exportPackage !== 'function') {
      self.showNotice('备份服务未就绪', 'error');
      return Promise.reject(new Error('Backup service not available'));
    }

    self.showNotice('正在导出' + (scope === 'workspace' ? '全量工作区' : '项目「' + curProj.name + '」') + '备份...', 'info');

    return BackupService.exportPackage({
      kind: scope,
      projectId: projId
    }).then(function(pkg) {
      var dateStr = (typeof DateUtil !== 'undefined' && DateUtil && typeof DateUtil.format === 'function')
        ? DateUtil.format(new Date())
        : new Date().toISOString().slice(0, 10);
      var filename = 'pmweb-backup-' + scope + '-' + dateStr + '.json';
      var content = JSON.stringify(pkg, null, 2);
      self._downloadFile(filename, content, 'application/json');
      var projCount = (pkg.summary && pkg.summary.projectCount !== undefined)
        ? pkg.summary.projectCount
        : (scope === 'workspace' && pkg.payload && Array.isArray(pkg.payload.projects) ? pkg.payload.projects.length : 1);
      var attCount = (pkg.summary && pkg.summary.attachmentCount !== undefined)
        ? pkg.summary.attachmentCount
        : (pkg.attachments ? pkg.attachments.length : 0);
      self.showNotice('导出成功：' + projCount + ' 个项目，' + attCount + ' 个附件', 'success');
      return pkg;
    }).catch(function(err) {
      self.showNotice('导出失败：' + (err && err.message ? err.message : err), 'error');
      throw err;
    });
  },

  previewImport: function(file) {
    var self = this;
    if (!file) return Promise.reject(new Error('未选择文件'));

    return Promise.resolve(file.text ? file.text() : new Promise(function(resolve, reject) {
      if (typeof FileReader === 'undefined') {
        return reject(new Error('FileReader not available'));
      }
      var reader = new FileReader();
      reader.onload = function(e) { resolve(e.target.result); };
      reader.onerror = reject;
      reader.readAsText(file);
    })).then(function(text) {
      var pkg;
      try {
        pkg = JSON.parse(text);
      } catch (e) {
        self.showNotice('JSON 解析失败：' + e.message, 'error');
        throw new Error('JSON 解析失败：' + e.message);
      }

      var BackupService = typeof Backup !== 'undefined' ? Backup : null;
      if (!BackupService || typeof BackupService.validatePackage !== 'function') {
        throw new Error('备份服务未就绪');
      }

      var validation = BackupService.validatePackage(pkg);
      var preview = validation.preview || {};
      var errors = validation.errors || [];
      var isValid = validation.valid;

      var isWs = (pkg.kind === 'workspace');
      var target = isWs ? 'replace-workspace' : 'new-project';

      var html = '<div class="backup-import-preview" id="backup-preview-box" role="dialog" aria-modal="true" aria-labelledby="import-preview-title">'
        + '<div class="modal-header"><h3 id="import-preview-title">备份包预览与恢复确认</h3></div>'
        + '<div class="modal-body" style="padding:16px;max-height:60vh;overflow-y:auto;">';

      if (!isValid) {
        html += '<div class="notice-banner notice-error" role="alert" style="padding:10px 14px;background:#fee2e2;color:#991b1b;border-radius:6px;margin-bottom:12px;">'
          + '<strong>备份校验未通过，禁止恢复：</strong>'
          + '<ul style="margin:6px 0 0 18px;padding:0;">';
        errors.forEach(function(err) {
          html += '<li>' + _escapeHtml(err) + '</li>';
        });
        html += '</ul></div>';
      }

      var projNamesStr = preview.projectNames
        ? preview.projectNames.map(_escapeHtml).join('、')
        : (pkg.payload && pkg.payload.name ? _escapeHtml(pkg.payload.name) : (preview.projectCount || 0) + ' 个项目');

      html += '<div class="preview-meta-grid" style="display:grid;grid-template-columns:100px 1fr;gap:8px 12px;font-size:13px;margin-bottom:14px;">'
        + '<span style="color:#64748b;">包类型：</span><strong>' + (isWs ? '全量工作区备份 (workspace)' : '单项目备份 (project)') + '</strong>'
        + '<span style="color:#64748b;">导出时间：</span><span>' + _escapeHtml(pkg.exportedAt || '未知') + '</span>'
        + '<span style="color:#64748b;">项目范围：</span><span>' + projNamesStr + '</span>'
        + '<span style="color:#64748b;">附件数量：</span><span>' + (preview.attachmentCount !== undefined ? preview.attachmentCount : (pkg.attachments ? pkg.attachments.length : 0)) + ' 个附件（约 ' + Math.round((preview.totalBytes || 0) / 1024) + ' KB）</span>'
        + '</div>';

      if (preview.missingAttachments && preview.missingAttachments.length > 0) {
        html += '<div class="notice-banner notice-warning" style="padding:8px 12px;background:#fef3c7;color:#92400e;border-radius:6px;font-size:12px;margin-bottom:12px;">'
          + '⚠️ 提示：备份包中引用的 ' + preview.missingAttachments.length + ' 个附件实体缺失，导入后相关文件将无法下载。'
          + '</div>';
      }

      var scopeNotice = isWs
        ? '⚠️ <strong>全量恢复警告：</strong>此操作将完全替换当前整个工作区（包含所有活动项目、归档项目和回收站）。'
        : 'ℹ️ <strong>单项目导入：</strong>将作为独立的新项目导入，不会覆盖或修改现有同名项目。';
      html += '<div class="preview-scope-notice" style="padding:10px 14px;background:#f1f5f9;border-left:4px solid ' + (isWs ? '#f59e0b' : '#3b82f6') + ';border-radius:4px;font-size:13px;margin-bottom:16px;">'
        + scopeNotice
        + '</div>';

      html += '<div style="margin-bottom:12px;">'
        + '<button type="button" class="btn btn-secondary" id="btn-export-before-import" style="font-size:13px;">📥 导出现有完整备份（推荐）</button>'
        + '</div>';

      html += '</div>' // modal-body
        + '<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 16px;border-top:1px solid #e2e8f0;">'
        + '<button type="button" class="btn btn-secondary btn-cancel" id="btn-cancel-import" data-action="cancel-import">取消</button>';

      if (isValid) {
        html += '<button type="button" class="btn btn-primary" id="btn-confirm-import" data-action="confirm-import">'
          + (isWs ? '确认全量恢复' : '确认导入新项目')
          + '</button>';
      }
      html += '</div></div>';

      if (typeof ModalManager !== 'undefined' && ModalManager) {
        if (typeof ModalManager.open === 'function') {
          ModalManager.open(html);
        } else if (typeof ModalManager.show === 'function') {
          ModalManager.show(html);
        }

        var doc = typeof document !== 'undefined' ? document : null;
        if (doc) {
          var exportBtn = doc.getElementById('btn-export-before-import');
          if (exportBtn) {
            exportBtn.addEventListener('click', function() {
              self.exportBackup('workspace');
            });
          }

          var cancelBtn = doc.getElementById('btn-cancel-import');
          if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
              ModalManager.close();
            });
          }

          var confirmBtn = doc.getElementById('btn-confirm-import');
          if (confirmBtn) {
            confirmBtn.addEventListener('click', function() {
              function resetButton() {
                confirmBtn.disabled = false;
                confirmBtn.textContent = (isWs ? '确认全量恢复' : '确认导入新项目');
              }

              if (typeof Workspace !== 'undefined' && Workspace.isLocked && Workspace.isLocked()) {
                resetButton();
                self.showNotice('工作区已被写锁锁定，请稍后重试', 'error');
                return;
              }

              confirmBtn.disabled = true;
              confirmBtn.textContent = '正在恢复中...';

              BackupService.importPackage(pkg, {
                target: target,
                confirmed: true
              }).then(function() {
                ModalManager.close();
                self.showNotice('导入成功！', 'success');
                self.renderAll();
              }).catch(function(err) {
                resetButton();
                self.showNotice('导入失败：' + (err && err.message ? err.message : err), 'error');
              });
            });
          }
        }
      }
    });
  },

  exportRawStorage: function() {
    var raw = '';
    if (typeof Workspace !== 'undefined' && Workspace.raw !== null && Workspace.raw !== undefined) {
      raw = Workspace.raw;
    } else if (typeof DataStore !== 'undefined' && DataStore.load) {
      var res = DataStore.load();
      raw = res.raw || '';
    }
    if (!raw) {
      this.showNotice('没有可导出的原始存储文本', 'warning');
      return;
    }
    var filename = 'pmweb-corrupt-raw-' + new Date().toISOString().slice(0, 10) + '.json';
    this._downloadFile(filename, raw, 'application/json');
    this.showNotice('已导出原始存储文本', 'info');
  },

  showStartupSettings: function() {
    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    if (!ws) return;
    var settings = (ws.data && ws.data.settings) ? ws.data.settings : {};
    var startupMode = settings.startupMode || 'choose';
    var defaultProjectId = settings.defaultProjectId || '';
    var projects = (ws.data && Array.isArray(ws.data.projects)) ? ws.data.projects : [];

    var html = '<div class="startup-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="startup-modal-title">'
      + '<div class="modal-header"><h3 id="startup-modal-title">启动偏好设置</h3></div>'
      + '<div class="modal-body" style="padding:16px;">'
      + '<p style="color:#64748b;font-size:13px;margin-bottom:14px;">决定下次打开软件时默认进入哪里：</p>'
      + '<div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">'
      + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">'
      + '<input type="radio" name="startup-choice" value="choose"' + (startupMode === 'choose' ? ' checked' : '') + '> '
      + '每次启动时选择项目（默认）'
      + '</label>'
      + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">'
      + '<input type="radio" name="startup-choice" value="last"' + (startupMode === 'last' ? ' checked' : '') + '> '
      + '自动进入上次打开的项目'
      + '</label>'
      + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">'
      + '<input type="radio" name="startup-choice" value="fixed"' + (startupMode === 'fixed' ? ' checked' : '') + '> '
      + '固定进入指定项目'
      + '</label>'
      + '</div>'
      + '<div style="margin-top:12px;' + (startupMode === 'fixed' ? '' : 'display:none;') + '" id="fixed-project-row">'
      + '<label style="font-size:13px;color:#64748b;display:block;margin-bottom:4px;">选择默认项目：</label>'
      + '<select id="startup-fixed-project-select" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;width:100%;font-size:13px;">';

    projects.forEach(function(p) {
      var isSel = (p.id === defaultProjectId);
      html += '<option value="' + _escapeHtml(p.id) + '"' + (isSel ? ' selected' : '') + '>' + _escapeHtml(p.name) + '</option>';
    });

    html += '</select></div></div>'
      + '<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0;">'
      + '<button type="button" class="btn btn-secondary btn-cancel" id="btn-cancel-startup">取消</button>'
      + '<button type="button" class="btn btn-primary" id="btn-save-startup">保存偏好</button>'
      + '</div></div>';

    var self = this;
    if (typeof ModalManager !== 'undefined' && ModalManager) {
      if (typeof ModalManager.open === 'function') {
        ModalManager.open(html);
      } else if (typeof ModalManager.show === 'function') {
        ModalManager.show(html);
      }
      var doc = typeof document !== 'undefined' ? document : null;
      if (!doc) return;

      var radios = doc.querySelectorAll('[name="startup-choice"]');
      var fixedRow = doc.getElementById('fixed-project-row');
      var sel = doc.getElementById('startup-fixed-project-select');

      for (var r = 0; r < radios.length; r++) {
        radios[r].addEventListener('change', function(e) {
          if (fixedRow) fixedRow.style.display = (e.target.value === 'fixed') ? 'block' : 'none';
        });
      }

      var cancelBtn = doc.getElementById('btn-cancel-startup');
      if (cancelBtn) cancelBtn.addEventListener('click', function() { ModalManager.close(); });

      var saveBtn = doc.getElementById('btn-save-startup');
      if (saveBtn) {
        saveBtn.addEventListener('click', function() {
          var chosen = 'choose';
          for (var i = 0; i < radios.length; i++) {
            if (radios[i].checked) { chosen = radios[i].value; break; }
          }
          var fixId = (chosen === 'fixed' && sel) ? sel.value : undefined;
          try {
            ws.setStartup({ mode: chosen, projectId: fixId });
            ModalManager.close();
            self.showNotice('启动偏好已保存', 'success');
          } catch (err) {
            self.showNotice(err.message || '保存启动偏好失败', 'error');
          }
        });
      }
    }
  },

  print: function() {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    } else if (typeof ShareManager !== 'undefined' && ShareManager && typeof ShareManager.print === 'function') {
      ShareManager.print();
    }
  },

  openRecycleBin: function() {
    if (typeof RecycleBinUI !== 'undefined' && RecycleBinUI && typeof RecycleBinUI.open === 'function') {
      RecycleBinUI.open();
    }
  },

  // -- 云端同步与协作 --
  _initSyncControls: function() {
    if (typeof SyncUI !== 'undefined' && SyncUI && typeof SyncUI.init === 'function') {
      SyncUI.init();
    }
  },

  // -- 只读分享、审计与打印 --
  _initShareControls: function() {
    if (typeof ShareManager !== 'undefined' && ShareManager && typeof ShareManager.init === 'function') {
      ShareManager.init();
    }
  },

  // -- 自动排期与关键路径 --

  _initSchedulerControls: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    if (doc.getElementById('btn-auto-schedule')) return;
    var toolbar = doc.getElementById('toolbar');
    if (!toolbar) return;

    var self = this;
    var group = doc.createElement('div');
    group.className = 'btn-group';
    group.id = 'scheduler-group';
    group.innerHTML =
      '<button class="btn" id="btn-auto-schedule" type="button"'
      + ' title="按依赖关系重新计算任务日期">自动排期</button>'
      + '<button class="btn" id="btn-critical-path" type="button"'
      + ' aria-pressed="false" title="高亮关键路径任务">关键路径</button>';

    var anchor = doc.getElementById('btn-add-root-task');
    if (anchor && toolbar.insertBefore) toolbar.insertBefore(group, anchor);
    else toolbar.appendChild(group);

    group.querySelector('#btn-auto-schedule').addEventListener('click', function() {
      self.autoSchedule();
    });
    group.querySelector('#btn-critical-path').addEventListener('click', function() {
      self.toggleCriticalPath();
    });

    if (typeof ViewState !== 'undefined' && ViewState) {
      this._restoreCriticalPath();
    }
    this._syncCriticalPathButton();
  },

  // 从设置恢复开关状态，刷新后保持
  _restoreCriticalPath: function() {
    var enabled = typeof TaskManager !== 'undefined' && TaskManager &&
      typeof TaskManager.getSetting === 'function' &&
      TaskManager.getSetting('criticalPath') === true;
    if (typeof ViewState !== 'undefined' && ViewState) ViewState.criticalPath = enabled;
    return enabled;
  },

  _syncCriticalPathButton: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    var button = doc && doc.getElementById ? doc.getElementById('btn-critical-path') : null;
    if (!button) return;
    var enabled = typeof ViewState !== 'undefined' && ViewState && ViewState.criticalPath === true;
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  },

  // 状态栏消息，不覆盖任务统计和版本号
  setStatusMessage: function(message, kind) {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return null;
    var bar = doc.getElementById('status-bar');
    if (!bar) return null;

    var el = doc.getElementById('status-message');
    if (!el) {
      el = doc.createElement('span');
      el.id = 'status-message';
      el.className = 'status-item status-message';
      var info = doc.getElementById('status-info');
      if (info && info.parentNode === bar) bar.insertBefore(el, info);
      else bar.appendChild(el);
    }

    var text = message === null || message === undefined ? '' : String(message);
    el.textContent = text;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-warning', kind === 'warning');
    el.hidden = text === '';
    return el;
  },

  // 纯计算：返回 { tasks, changed, errors }，不写数据
  buildSchedule: function() {
    if (typeof Scheduler === 'undefined' || !Scheduler ||
        typeof Scheduler.scheduleAll !== 'function') {
      return { tasks: [], changed: [], errors: [{ code: 'MODULE_MISSING', message: '自动排期模块未加载' }] };
    }
    var tasks = TaskManager.getAllTasks();
    var links = TaskManager.getLinks();
    var config = typeof TaskManager.getSchedulerConfig === 'function'
      ? TaskManager.getSchedulerConfig()
      : null;
    var result = Scheduler.scheduleAll(tasks, links, config);

    var before = new Map();
    tasks.forEach(function(task) {
      before.set(task.id, task.startDate + '~' + task.endDate);
    });

    var changed = [];
    (result.tasks || []).forEach(function(task) {
      if (!task || task.id === undefined || task.id === null) return;
      var after = task.startDate + '~' + task.endDate;
      if (before.get(task.id) === after) return;
      changed.push({
        id: task.id,
        name: task.name,
        startDate: task.startDate,
        endDate: task.endDate
      });
    });

    return {
      tasks: result.tasks || [],
      changed: changed,
      errors: result.errors || []
    };
  },

  // 把排期结果写回，整批合并为一条历史记录
  applySchedule: function(changed) {
    var list = Array.isArray(changed) ? changed : [];
    if (list.length === 0) return 0;
    TaskManager.transaction('自动排期', function() {
      list.forEach(function(entry) {
        TaskManager.updateTask(entry.id, {
          startDate: entry.startDate,
          endDate: entry.endDate
        });
      });
    });
    this.renderAll();
    return list.length;
  },

  autoSchedule: function() {
    var preview = this.buildSchedule();
    var errors = preview.errors || [];
    var cycle = null;
    for (var i = 0; i < errors.length; i++) {
      if (errors[i] && errors[i].code === 'CYCLE') {
        cycle = errors[i];
        break;
      }
    }
    if (cycle) {
      this.setStatusMessage('自动排期失败：' + cycle.message, 'error');
      return preview;
    }
    if (preview.changed.length === 0) {
      var hint = errors.length > 0
        ? '自动排期完成：' + errors[0].message + '，日期无需调整'
        : '自动排期完成：日期已满足依赖，无需调整';
      this.setStatusMessage(hint, errors.length > 0 ? 'warning' : null);
      return preview;
    }

    var self = this;
    var count = preview.changed.length;
    var apply = function() {
      var applied = self.applySchedule(preview.changed);
      var message = '自动排期完成：更新 ' + applied + ' 个任务';
      if (errors.length > 0) message += '（' + errors[0].message + '）';
      self.setStatusMessage(message, errors.length > 0 ? 'warning' : null);
    };

    if (typeof ModalManager !== 'undefined' && ModalManager &&
        typeof ModalManager.confirm === 'function') {
      ModalManager.confirm('自动排期将调整 ' + count + ' 个任务的日期，确定继续吗？', apply);
    } else {
      apply();
    }
    return preview;
  },

  toggleCriticalPath: function() {
    if (typeof Workbench === 'undefined' || !Workbench ||
        typeof Workbench.setCriticalPath !== 'function') return false;
    var enabled = !(typeof ViewState !== 'undefined' && ViewState && ViewState.criticalPath === true);
    Workbench.setCriticalPath(enabled);
    TaskManager.setSetting('criticalPath', enabled);
    this._syncCriticalPathButton();

    if (!enabled) {
      this.setStatusMessage('');
      return false;
    }

    var errors = typeof Workbench.getCriticalErrors === 'function'
      ? Workbench.getCriticalErrors()
      : [];
    for (var i = 0; i < errors.length; i++) {
      if (errors[i] && errors[i].code === 'CYCLE') {
        this.setStatusMessage('关键路径：' + errors[i].message, 'error');
        return true;
      }
    }
    var ids = typeof Workbench.getCriticalIds === 'function' ? Workbench.getCriticalIds() : null;
    this.setStatusMessage('关键路径已开启：' + (ids ? ids.size : 0) + ' 个关键任务');
    return true;
  },

  // TaskManager 没有锁定字段的表单入口，在弹窗内补一个勾选项
  _injectLockField: function(locked) {
    var doc = typeof document !== 'undefined' ? document : null;
    var value = locked === true;
    if (!doc || !doc.getElementById) return { read: function() { return value; } };
    var box = doc.getElementById('modal-box');
    if (!box) return { read: function() { return value; } };
    var actions = box.querySelector('.modal-actions');
    if (!actions || !actions.parentNode) return { read: function() { return value; } };

    var field = doc.createElement('div');
    field.className = 'modal-field modal-lock-field';
    var input = doc.createElement('input');
    input.type = 'checkbox';
    input.id = 'modal-task-locked';
    input.checked = value;
    var label = doc.createElement('label');
    label.className = 'modal-check';
    label.appendChild(input);
    label.appendChild(doc.createTextNode(' 锁定日期（自动排期跳过该任务，其日期仍约束后继）'));
    field.appendChild(label);
    actions.parentNode.insertBefore(field, actions);

    input.addEventListener('change', function() { value = !!input.checked; });
    return { read: function() { return value; } };
  },

  // -- 基线 UI --
  _baselineCount: function(value) {
    return typeof value === 'number' && isFinite(value) ? Math.round(value) : 0;
  },

  formatBaselineCapturedAt: function(capturedAt) {
    if (typeof capturedAt !== 'string') return '';
    return capturedAt.replace('T', ' ').replace('Z', '').slice(0, 16);
  },

  formatBaselineVarianceText: function(days) {
    if (typeof days !== 'number' || !isFinite(days)) return '—';
    var text = typeof Baseline !== 'undefined' && Baseline &&
      typeof Baseline.formatVariance === 'function'
      ? Baseline.formatVariance(days)
      : String(Math.round(days));
    return text + ' 天';
  },

  formatBaselineProgressText: function(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    var rounded = Math.round(value);
    return (rounded > 0 ? '+' + rounded : String(rounded)) + '%';
  },

  buildBaselineSummaryText: function(summary, capturedAt) {
    var stats = summary || {};
    var parts = [
      '共 ' + this._baselineCount(stats.total) + ' 项',
      '变更 ' + this._baselineCount(stats.changed),
      '延期 ' + this._baselineCount(stats.delayed),
      '提前 ' + this._baselineCount(stats.advanced),
      '新增 ' + this._baselineCount(stats.added),
      '删除 ' + this._baselineCount(stats.removed),
      '平均延期 ' + (typeof stats.averageDelayDays === 'number' && isFinite(stats.averageDelayDays)
        ? Math.round(stats.averageDelayDays * 100) / 100
        : 0) + ' 天'
    ];
    var prefix = capturedAt ? '基线采集于 ' + this.formatBaselineCapturedAt(capturedAt) + ' · ' : '';
    return prefix + parts.join(' · ');
  },

  buildBaselineChangeList: function(diffResult) {
    var entries = diffResult && Array.isArray(diffResult.tasks) ? diffResult.tasks : [];
    var self = this;
    var rows = [];
    entries.forEach(function(entry) {
      if (!entry) return;
      var kind = entry.added ? 'added' : entry.removed ? 'removed' : entry.changed ? 'changed' : null;
      if (!kind) return;
      rows.push({
        id: entry.id,
        name: entry.name === null || entry.name === undefined ? '' : String(entry.name),
        kind: kind,
        kindLabel: kind === 'added' ? '新增' : kind === 'removed' ? '删除' : '变更',
        startVarianceDays: entry.startVarianceDays,
        endVarianceDays: entry.endVarianceDays,
        progressVariance: entry.progressVariance,
        startVarianceText: self.formatBaselineVarianceText(entry.startVarianceDays),
        endVarianceText: self.formatBaselineVarianceText(entry.endVarianceDays),
        progressVarianceText: self.formatBaselineProgressText(entry.progressVariance)
      });
    });
    return rows;
  },

  _initBaselineMenu: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    if (doc.getElementById('btn-baseline-menu')) return;
    var toolbar = doc.getElementById('toolbar');
    if (!toolbar) return;

    var wrap = doc.createElement('div');
    wrap.className = 'baseline-menu';
    wrap.id = 'baseline-menu';
    wrap.innerHTML =
      '<button type="button" class="baseline-btn" id="btn-baseline-menu"'
      + ' aria-haspopup="menu" aria-expanded="false" title="尚未保存基线">基线</button>'
      + '<div class="baseline-dropdown" role="menu" hidden>'
      + '<button type="button" role="menuitem" data-baseline-action="save">保存基线</button>'
      + '<button type="button" role="menuitem" data-baseline-action="diff">查看差异</button>'
      + '<button type="button" role="menuitem" data-baseline-action="clear">清除基线</button>'
      + '</div>';

    var anchor = doc.getElementById('btn-add-root-task');
    if (anchor && toolbar.insertBefore) toolbar.insertBefore(wrap, anchor);
    else toolbar.appendChild(wrap);

    var self = this;
    var button = wrap.querySelector('#btn-baseline-menu');
    var dropdown = wrap.querySelector('.baseline-dropdown');

    function setOpen(open) {
      if (dropdown) dropdown.hidden = !open;
      if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    if (button) {
      button.addEventListener('click', function(e) {
        if (e.stopPropagation) e.stopPropagation();
        setOpen(dropdown ? !!dropdown.hidden : false);
      });
    }

    if (dropdown) {
      dropdown.addEventListener('click', function(e) {
        var action = e.target && e.target.closest ? e.target.closest('[data-baseline-action]') : null;
        if (!action) return;
        if (action.disabled) return;
        setOpen(false);
        self._handleBaselineAction(action.getAttribute('data-baseline-action'));
      });
    }

    doc.addEventListener('click', function(e) {
      if (!wrap.contains(e.target)) setOpen(false);
    });

    doc.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') setOpen(false);
    });

    this._baselineMenu = wrap;
    this._syncBaselineMenu();
  },

  _syncBaselineMenu: function() {
    if (!this._baselineMenu) return;
    var has = typeof TaskManager !== 'undefined' && TaskManager &&
      typeof TaskManager.hasBaseline === 'function' && TaskManager.hasBaseline();
    var button = this._baselineMenu.querySelector('#btn-baseline-menu');
    var diff = this._baselineMenu.querySelector('[data-baseline-action="diff"]');
    var clear = this._baselineMenu.querySelector('[data-baseline-action="clear"]');
    if (button) {
      button.classList.toggle('has-baseline', has);
      button.setAttribute('title', has ? '基线已保存' : '尚未保存基线');
    }
    if (diff) diff.disabled = !has;
    if (clear) clear.disabled = !has;
  },

  _handleBaselineAction: function(action) {
    if (action === 'save') return this.saveBaseline();
    if (action === 'diff') return this.showBaselineDiff();
    if (action === 'clear') return this.clearBaseline();
    return null;
  },

  _baselineConfirm: function(message, onConfirm) {
    if (typeof ModalManager !== 'undefined' && ModalManager &&
        typeof ModalManager.confirm === 'function') {
      ModalManager.confirm(message, onConfirm);
      return;
    }
    onConfirm();
  },

  saveBaseline: function() {
    var self = this;
    var has = typeof TaskManager.hasBaseline === 'function' && TaskManager.hasBaseline();
    var message = has
      ? '已有基线，保存后将覆盖原基线，确定继续吗？'
      : '将当前任务计划保存为基线？';
    this._baselineConfirm(message, function() {
      TaskManager.saveBaseline();
      self.renderAll();
      self._syncBaselineMenu();
    });
  },

  clearBaseline: function() {
    var self = this;
    if (!(typeof TaskManager.hasBaseline === 'function' && TaskManager.hasBaseline())) return;
    this._baselineConfirm('确定清除基线吗？清除后基线偏差和基线条将不再显示。', function() {
      TaskManager.clearBaseline();
      self.renderAll();
      self._syncBaselineMenu();
    });
  },

  showBaselineDiff: function() {
    var snapshot = typeof TaskManager.getBaseline === 'function' ? TaskManager.getBaseline() : null;
    if (!snapshot) {
      ModalManager.open(
        '<div class="modal-title">基线差异</div>'
        + '<p class="baseline-diff-empty">尚未保存基线，请先在“基线”菜单中保存一次。</p>'
        + '<div class="modal-actions"><button onclick="ModalManager.close()">关闭</button></div>'
      );
      return;
    }

    var diffResult = Baseline.diff(snapshot, TaskManager.getAllTasks());
    var summary = Baseline.summarize(diffResult);
    var rows = this.buildBaselineChangeList(diffResult);

    var html = '<div class="modal-title">基线差异</div>'
      + '<div class="baseline-diff-summary">'
      + _escapeHtml(this.buildBaselineSummaryText(summary, snapshot.capturedAt)) + '</div>';

    if (rows.length === 0) {
      html += '<p class="baseline-diff-empty">当前计划与基线一致。</p>';
    } else {
      html += '<div class="baseline-diff-list" role="list">';
      rows.forEach(function(row) {
        html += '<div class="baseline-diff-row" role="listitem" data-task-id="' + _escapeHtml(row.id) + '">'
          + '<span class="baseline-diff-name">' + _escapeHtml(row.name) + '</span>'
          + '<span class="baseline-diff-kind kind-' + row.kind + '">' + row.kindLabel + '</span>'
          + '<span class="baseline-diff-value">开始 ' + _escapeHtml(row.startVarianceText) + '</span>'
          + '<span class="baseline-diff-value">结束 ' + _escapeHtml(row.endVarianceText) + '</span>'
          + '<span class="baseline-diff-value">进度 ' + _escapeHtml(row.progressVarianceText) + '</span>'
          + '</div>';
      });
      html += '</div>';
    }

    html += '<div class="modal-actions"><button onclick="ModalManager.close()">关闭</button></div>';
    ModalManager.open(html);
  },

  switchView: function(view) {
    this.currentView = view === 'calendar' ? 'calendar' : 'gantt';
    if (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.setSetting === 'function') {
      try { TaskManager.setSetting('lastView', this.currentView); } catch (err) {}
    }
    if (this.currentView === 'calendar') {
      this.setPanels({ ganttVisible: false, calendarVisible: true });
    } else {
      this.setPanels({ ganttVisible: true, calendarVisible: false });
    }
  },

  switchGranularity: function(g) {
    if (typeof GanttView !== 'undefined' && GanttView) GanttView.granularity = g;
    if (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.setSetting === 'function') {
      try { TaskManager.setSetting('lastGranularity', g); } catch (err) {}
    }
    if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setGranularity === 'function') {
      Workbench.setGranularity(g);
      Workbench.render();
    }
    this._updateGranularityButtons();
  },

  _updateViewButtons: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    var panels = (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.getPanels === 'function')
      ? Workbench.getPanels()
      : (this.currentPanels || { ganttVisible: true, calendarVisible: false, nodesVisible: true });

    var btnGantt = doc.getElementById('btn-view-gantt');
    if (btnGantt) {
      btnGantt.classList.toggle('active', panels.ganttVisible);
      btnGantt.setAttribute('aria-pressed', panels.ganttVisible ? 'true' : 'false');
    }
    var btnCal = doc.getElementById('btn-view-calendar');
    if (btnCal) {
      btnCal.classList.toggle('active', panels.calendarVisible);
      btnCal.setAttribute('aria-pressed', panels.calendarVisible ? 'true' : 'false');
    }
    var btnNodes = doc.getElementById('btn-toggle-nodes');
    if (btnNodes) {
      btnNodes.classList.toggle('active', panels.nodesVisible);
      btnNodes.setAttribute('aria-pressed', panels.nodesVisible ? 'true' : 'false');
    }
  },

  _updateGranularityButtons: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    var gran = (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.getGranularity === 'function')
      ? Workbench.getGranularity()
      : (typeof GanttView !== 'undefined' && GanttView ? GanttView.granularity : 'day');

    var btnMonth = doc.getElementById('btn-granularity-month');
    if (btnMonth) btnMonth.classList.toggle('active', gran === 'month');
    var btnWeek = doc.getElementById('btn-granularity-week');
    if (btnWeek) btnWeek.classList.toggle('active', gran === 'week');
    var btnDay = doc.getElementById('btn-granularity-day');
    if (btnDay) btnDay.classList.toggle('active', gran === 'day');

    var label = doc.getElementById('gantt-granularity-label');
    if (label) {
      label.textContent = gran === 'day' ? '日' : gran === 'week' ? '周' : '月';
    }
    var zoomIn = doc.getElementById('btn-gantt-zoom-in');
    if (zoomIn) zoomIn.disabled = (gran === 'day');
    var zoomOut = doc.getElementById('btn-gantt-zoom-out');
    if (zoomOut) zoomOut.disabled = (gran === 'month');
  },

  _updateStatusBar: function() {
    var allTasks = TaskManager.getAllTasks();
    var leafTasks = allTasks.filter(function(t) { return TaskManager.getChildren(t.id).length === 0; });
    var todo = leafTasks.filter(function(t) { return t.status === 'todo'; }).length;
    var inProgress = leafTasks.filter(function(t) { return t.status === 'inProgress'; }).length;
    var thirdParty = leafTasks.filter(function(t) { return t.status === 'thirdParty'; }).length;
    var done = leafTasks.filter(function(t) { return t.status === 'done'; }).length;
    document.getElementById('status-text').textContent =
      allTasks.length + ' 个任务 · ' + leafTasks.length + ' 个叶子任务（未开始 ' + todo + '，进行中 ' + inProgress + '，第三方 ' + thirdParty + '，已完成 ' + done + '）';
    document.getElementById('status-info').textContent = 'PMWEB v3.0';
  },

  // -- Highlight sync --
  onTaskSelected: function(taskId) {
    Workbench.setSelected(taskId);
  },

  onTaskHovered: function(taskId) {
    Workbench.setHovered(taskId);
  },

  onGanttTaskClicked: function(taskId) {
    Workbench.setSelected(taskId);
  },

  // -- Task operations --
  showAddTask: function(parentId) {
    var self = this;
    var lock = null;
    ModalManager.showTaskForm(null, parentId, function(data) {
      var locked = lock ? lock.read() : false;
      TaskManager.transaction('新建任务', function() {
        var t = TaskManager.addTask(data.parentId, data.name);
        if (t) {
          TaskManager.updateTask(t.id, { description: data.description, assignee: data.assignee, startDate: data.startDate, endDate: data.endDate, status: data.status, locked: locked, customFields: data.customFields });
        }
      });
      self.renderAll();
    });
    lock = this._injectLockField(false);
  },

  showEditTask: function(taskId) {
    var self = this;
    var task = TaskManager.getTask(taskId);
    if (!task) return;
    var lock = null;
    ModalManager.showTaskForm(task, task.parentId, function(data) {
      var updates = {};
      Object.keys(data).forEach(function(key) { updates[key] = data[key]; });
      updates.locked = lock ? lock.read() : false;
      TaskManager.updateTask(taskId, updates);
      self.renderAll();
    });
    lock = this._injectLockField(task.locked === true);
  },

  deleteTask: function(taskId) {
    var self = this;
    var task = TaskManager.getTask(taskId);
    if (!task) return;
    ModalManager.confirm('确定要删除任务「' + task.name + '」及其所有子任务吗？', function() {
      TaskManager.deleteTask(taskId);
      self.renderAll();
    });
  },

  // -- Dependency operations --
  showAddDependency: function(taskId) {
    var self = this;
    var source = TaskManager.getTask(taskId);
    if (!source) return;

    var candidates = TaskManager.getAllTasks().filter(function(task) {
      return task.id !== taskId;
    });
    if (candidates.length === 0) {
      alert('没有可供选择的后置任务');
      return;
    }

    var targetOptions = candidates.map(function(task) {
      return '<option value="' + _escapeHtml(task.id) + '">' + _escapeHtml(task.name) + '</option>';
    }).join('');

    ModalManager.open(
      '<div class="modal-title">添加依赖</div>'
      + '<div class="modal-field"><label>前置任务</label>'
      + '<input type="text" value="' + _escapeHtml(source.name) + '" disabled></div>'
      + '<div class="modal-field"><label>后置任务</label>'
      + '<select id="modal-link-target">' + targetOptions + '</select></div>'
      + '<div class="modal-field"><label>依赖类型</label>'
      + '<select id="modal-link-type">'
      + '<option value="FS">FS 完成-开始</option>'
      + '<option value="SS">SS 开始-开始</option>'
      + '<option value="FF">FF 完成-完成</option>'
      + '<option value="SF">SF 开始-完成</option>'
      + '</select></div>'
      + '<div class="modal-field"><label>lag（天）</label>'
      + '<input type="number" id="modal-link-lag" step="1" value="0"></div>'
      + '<div class="modal-error" id="modal-link-error" role="alert" hidden></div>'
      + '<div class="modal-actions">'
      + '<button onclick="ModalManager.close()">取消</button>'
      + '<button class="btn-primary" id="modal-link-save">保存</button>'
      + '</div>'
    );

    var errorBox = document.getElementById('modal-link-error');
    function showError(message) {
      if (!errorBox) { alert(message); return; }
      errorBox.textContent = message;
      errorBox.hidden = false;
    }

    document.getElementById('modal-link-save').addEventListener('click', function() {
      var target = document.getElementById('modal-link-target').value;
      var type = document.getElementById('modal-link-type').value;
      var lagText = String(document.getElementById('modal-link-lag').value || '').trim();

      if (!/^-?\d+$/.test(lagText)) {
        showError('lag 必须是整数（单位：天）');
        return;
      }

      var result = TaskManager.addLink(taskId, target, type, parseInt(lagText, 10));
      if (!result.ok) {
        showError(result.reason || '添加依赖失败');
        return;
      }
      ModalManager.close();
      self.renderAll();
    });
  },

  showDeleteDependency: function(taskId) {
    var self = this;
    var links = TaskManager.getLinks().filter(function(link) {
      return link.source === taskId || link.target === taskId;
    });
    if (links.length === 0) {
      alert('该任务暂无依赖');
      return;
    }

    var rowsHtml = links.map(function(link) {
      var source = TaskManager.getTask(link.source);
      var target = TaskManager.getTask(link.target);
      var sourceName = source ? source.name : link.source;
      var targetName = target ? target.name : link.target;
      return '<div class="dep-link-row" data-link-id="' + _escapeHtml(link.id) + '">'
        + '<span class="dep-link-text">' + _escapeHtml(sourceName) + ' → '
        + _escapeHtml(targetName) + ' · ' + _escapeHtml(link.type)
        + ' · lag ' + _escapeHtml(String(link.lag)) + '</span>'
        + '<button type="button" class="btn-danger" data-link-delete="' + _escapeHtml(link.id) + '">删除</button>'
        + '</div>';
    }).join('');

    ModalManager.open(
      '<div class="modal-title">删除依赖</div>'
      + '<div class="dep-link-list">' + rowsHtml + '</div>'
      + '<div class="modal-actions">'
      + '<button onclick="ModalManager.close()">关闭</button>'
      + '</div>'
    );

    document.querySelectorAll('[data-link-delete]').forEach(function(button) {
      button.addEventListener('click', function() {
        TaskManager.deleteLink(button.getAttribute('data-link-delete'));
        ModalManager.close();
        self.renderAll();
      });
    });
  },

  deleteLink: function(linkId) {
    var self = this;
    var link = TaskManager.getLink(linkId);
    if (!link) return;
    var source = TaskManager.getTask(link.source);
    var target = TaskManager.getTask(link.target);
    var label = (source ? source.name : link.source) + ' → ' + (target ? target.name : link.target);
    ModalManager.confirm('确定要删除依赖「' + label + '」吗？', function() {
      TaskManager.deleteLink(linkId);
      self.renderAll();
    });
  },

  // -- Color picker --
  showColorPicker: function(taskId) {
    var task = TaskManager.getTask(taskId);
    if (!task) return;
    var currentColor = TaskManager.getEffectiveColor(task);
    var self = this;

    var swatchesHtml = TaskManager.COLORS.map(function(c) {
      return '<span class="color-swatch" data-color="' + c + '" style="display:inline-block;width:28px;height:28px;border-radius:50%;cursor:pointer;margin:3px;border:2px solid ' + (c === currentColor ? 'var(--color-text)' : 'transparent') + ';background:' + c + '"></span>';
    }).join('');

    ModalManager.open(
      '<div class="modal-title">选择颜色</div>'
      + '<div style="padding:8px 0;">' + swatchesHtml + '</div>'
      + '<div class="modal-actions">'
      + '<button onclick="ModalManager.close()">取消</button>'
      + '</div>'
    );

    document.querySelectorAll('.color-swatch').forEach(function(sw) {
      sw.addEventListener('click', function() {
        TaskManager.updateTask(taskId, { color: sw.dataset.color });
        ModalManager.close();
        self.renderAll();
      });
    });
  },

  // -- Milestone operations --
  showAddMilestoneAtDate: function(taskId, date) {
    var self = this;
    ModalManager.showMilestoneForm(null, { taskId: taskId }, function(data) {
      TaskManager.addMilestone(data.taskId, data.name, data.date, data.status);
      self.renderAll();
    });
    var dateInput = document.getElementById('modal-ms-date');
    if (dateInput) dateInput.value = date;
  },

  showEditMilestone: function(milestoneId) {
    var self = this;
    var milestone = TaskManager.getMilestone(milestoneId);
    if (!milestone) return;
    ModalManager.showMilestoneForm(milestone, { taskId: milestone.taskId }, function(data) {
      TaskManager.updateMilestone(milestoneId, data);
      self.renderAll();
    });
  },

  toggleMilestoneStatus: function(milestoneId) {
    if (typeof Workspace !== 'undefined' && Workspace) {
      if (typeof Workspace.isReadOnly === 'function' && Workspace.isReadOnly()) {
        return; // 只读模式禁止修改
      }
      var curProj = typeof Workspace.currentProject === 'function' ? Workspace.currentProject() : null;
      if (curProj && curProj.archived) {
        return; // 归档项目不能修改今日节点状态
      }
    }
    var milestone = TaskManager.getMilestone(milestoneId);
    if (!milestone) return;
    var newStatus = (milestone.status === 'done') ? 'pending' : 'done';
    try {
      TaskManager.updateMilestone(milestoneId, { status: newStatus });
      this.renderAll();
    } catch (err) {}
  },

  deleteMilestone: function(milestoneId) {
    var self = this;
    var milestone = TaskManager.getMilestone(milestoneId);
    if (!milestone) return;
    ModalManager.confirm('确定要删除里程碑「' + milestone.name + '」吗？', function() {
      TaskManager.deleteMilestone(milestoneId);
      self.renderAll();
    });
  },

  // -- Import/Export --
  exportData: function() {
    DataStore.exportJSON(TaskManager.data);
  },

  importData: function() {
    var self = this;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      DataStore.importJSON(file).then(function(data) {
        ModalManager.confirm('导入将覆盖当前所有数据，确定继续吗？', function() {
          TaskManager.replaceData(data);
          self.renderAll();
        });
      }).catch(function(err) {
        alert(err.message);
      });
    });
    input.click();
  },

  // -- Export to Excel --
  exportToExcel: function() {
    if (typeof XLSX === 'undefined') {
      alert('Excel 库未加载，请确保 xlsx.full.min.js 文件与 index.html 在同一目录下，并刷新页面重试。');
      console.log('XLSX status:', typeof XLSX);
      return;
    }
    if (typeof Export === 'undefined' || !Export) return;

    var rows = typeof Workbench !== 'undefined' && Workbench &&
      typeof Workbench.getRows === 'function'
      ? Workbench.getRows()
      : [];
    var columns = typeof GridPane !== 'undefined' && GridPane &&
      typeof GridPane.getVisibleColumns === 'function'
      ? GridPane.getVisibleColumns()
      : null;

    var result = Export.exportToExcel({
      tasks: TaskManager.getAllTasks(),
      milestones: TaskManager.getAllMilestones(),
      rows: rows,
      columns: columns,
      date: DateUtil.format(new Date()),
      taskManager: TaskManager
    });

    if (result && result.reason === 'empty') {
      alert('没有任务数据可导出');
    }
  },

  // -- 协作详情：评论 / 活动 / 附件 --

  escapeText: function(value) {
    return _collabEscape(value);
  },

  formatTimestamp: function(value) {
    if (typeof value !== 'string' || value.length === 0) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  },

  formatAttachmentSize: function(bytes) {
    var value = typeof bytes === 'number' && isFinite(bytes) && bytes >= 0 ? bytes : 0;
    var units = ['B', 'KB', 'MB', 'GB'];
    var index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value = value / 1024;
      index++;
    }
    var rounded = index === 0 ? Math.round(value) : Math.round(value * 10) / 10;
    return rounded + ' ' + units[index];
  },

  formatActivityValue: function(field, value) {
    if (value === null || value === undefined) return '未设置';
    if (value === '') return '（空）';
    if (field === 'status') return COLLAB_STATUS_LABELS[value] || String(value);
    if (field === 'progress') return String(value) + '%';
    return String(value);
  },

  buildCommentRows: function(taskId) {
    var self = this;
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.getComments !== 'function') return [];
    return TaskManager.getComments(taskId).map(function(comment) {
      return {
        id: comment.id,
        author: comment.author,
        text: comment.text,
        createdAt: comment.createdAt,
        timeText: self.formatTimestamp(comment.createdAt),
        edited: !!comment.updatedAt,
        updatedText: comment.updatedAt ? self.formatTimestamp(comment.updatedAt) : ''
      };
    });
  },

  buildActivityRows: function(taskId) {
    var self = this;
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.getActivity !== 'function') return [];
    var entries = TaskManager.getActivity(taskId).slice().reverse();
    return entries.map(function(entry) {
      var fieldLabel = ACTIVITY_FIELD_LABELS[entry.field] || entry.field;
      var beforeText = self.formatActivityValue(entry.field, entry.before);
      var afterText = self.formatActivityValue(entry.field, entry.after);
      return {
        id: entry.id,
        actor: entry.actor,
        field: entry.field,
        fieldLabel: fieldLabel,
        beforeText: beforeText,
        afterText: afterText,
        at: entry.at,
        timeText: self.formatTimestamp(entry.at),
        text: entry.actor + ' 将 ' + fieldLabel + ' 从「' + beforeText + '」改为「' + afterText + '」'
      };
    });
  },

  buildAttachmentRows: function(taskId) {
    var self = this;
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.getAttachments !== 'function') return [];
    return TaskManager.getAttachments(taskId).map(function(meta) {
      return {
        id: meta.id,
        name: meta.name,
        size: meta.size,
        type: meta.type,
        sizeText: self.formatAttachmentSize(meta.size),
        createdAt: meta.createdAt,
        timeText: self.formatTimestamp(meta.createdAt)
      };
    });
  },

  _collabDoc: function() {
    return typeof document !== 'undefined' ? document : null;
  },

  _collabSetError: function(message) {
    var doc = this._collabDoc();
    if (!doc || !doc.getElementById) return;
    var box = doc.getElementById('collab-error');
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
  },

  _collabFocus: function(selector) {
    var doc = this._collabDoc();
    if (!doc || !selector || !doc.querySelector) return;
    var node = doc.querySelector(selector);
    if (!node || !node.focus) return;
    try {
      node.focus({ preventScroll: true });
    } catch (error) {
      node.focus();
    }
  },

  showTaskDetail: function(taskId) {
    if (typeof ModalManager === 'undefined' || !ModalManager ||
        typeof ModalManager.open !== 'function') return;
    if (typeof TaskManager === 'undefined' || !TaskManager) return;
    var task = TaskManager.getTask(taskId);
    if (!task) return;

    this._collabEditingCommentId = null;
    this._collabSetError('');

    var settings = TaskManager.data && TaskManager.data.settings
      ? TaskManager.data.settings
      : {};
    var initialAuthor = typeof settings.currentUser === 'string' ? settings.currentUser : '';
    var accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp';

    var html = '<div class="modal-title collab-modal-title">协作详情 · ' + _collabEscape(task.name) + '</div>'
      + '<div class="collab-modal">'
      + '<section class="collab-section" aria-labelledby="collab-comments-heading">'
      + '<h4 class="collab-section-title" id="collab-comments-heading">评论'
      + '<span class="collab-count" id="collab-comment-count"></span></h4>'
      + '<div class="collab-comment-form">'
      + '<label class="collab-field"><span>作者</span>'
      + '<input type="text" id="collab-comment-author" maxlength="120" value="'
      + _collabEscape(initialAuthor) + '" placeholder="你的名字"></label>'
      + '<label class="collab-field"><span>内容</span>'
      + '<textarea id="collab-comment-text" rows="3" maxlength="2000"'
      + ' placeholder="输入评论，Ctrl/Cmd + Enter 提交"></textarea></label>'
      + '<div class="collab-form-footer">'
      + '<span class="collab-error" id="collab-error" role="alert" hidden></span>'
      + '<button type="button" class="btn-primary" id="collab-comment-add">添加评论</button>'
      + '</div></div>'
      + '<div class="collab-list" id="collab-comments-list" aria-live="polite"></div>'
      + '</section>'
      + '<section class="collab-section" aria-labelledby="collab-activity-heading">'
      + '<h4 class="collab-section-title" id="collab-activity-heading">活动</h4>'
      + '<div class="collab-list collab-activity-list" id="collab-activity-list" aria-live="polite"></div>'
      + '</section>'
      + '<section class="collab-section" aria-labelledby="collab-attachments-heading">'
      + '<h4 class="collab-section-title" id="collab-attachments-heading">附件'
      + '<span class="collab-count" id="collab-attachment-count"></span></h4>'
      + '<div class="collab-upload">'
      + '<label class="collab-file-label">选择文件'
      + '<input type="file" id="collab-file-input" multiple accept="' + accept + '"></label>'
      + '<span class="collab-hint">单个文件不超过 10 MB</span>'
      + '</div>'
      + '<div class="collab-list" id="collab-attachments-list" aria-live="polite"></div>'
      + '</section>'
      + '</div>'
      + '<div class="modal-actions"><button type="button" id="collab-close">关闭</button></div>';

    ModalManager.open(html);
    this._bindCollabEvents(taskId);
    this._renderCollabComments(taskId);
    this._renderCollabAttachments(taskId);
    this._renderCollabActivity(taskId);
  },

  _bindCollabEvents: function(taskId) {
    var doc = this._collabDoc();
    if (!doc || !doc.getElementById) return;
    var self = this;

    var addButton = doc.getElementById('collab-comment-add');
    if (addButton) addButton.addEventListener('click', function() { self._addCollabComment(taskId); });

    var text = doc.getElementById('collab-comment-text');
    if (text) {
      text.addEventListener('keydown', function(event) {
        if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
        event.preventDefault();
        self._addCollabComment(taskId);
      });
    }

    var comments = doc.getElementById('collab-comments-list');
    if (comments) {
      comments.addEventListener('click', function(event) {
        self._onCollabCommentClick(taskId, event);
      });
    }

    var input = doc.getElementById('collab-file-input');
    if (input) {
      input.addEventListener('change', function() {
        self._uploadCollabFiles(taskId, input);
      });
    }

    var attachments = doc.getElementById('collab-attachments-list');
    if (attachments) {
      attachments.addEventListener('click', function(event) {
        self._onCollabAttachmentClick(taskId, event);
      });
    }

    var close = doc.getElementById('collab-close');
    if (close && typeof ModalManager !== 'undefined' && ModalManager) {
      close.addEventListener('click', function() { ModalManager.close(); });
    }
  },

  _addCollabComment: function(taskId) {
    var doc = this._collabDoc();
    if (!doc || !doc.getElementById) return null;
    var authorInput = doc.getElementById('collab-comment-author');
    var textInput = doc.getElementById('collab-comment-text');
    if (!authorInput || !textInput) return null;

    var author = authorInput.value;
    var comment = TaskManager.addComment(taskId, author, textInput.value);
    if (!comment) {
      this._collabSetError('评论内容不能为空，作者和内容长度需符合要求');
      return null;
    }

    this._collabSetError('');
    textInput.value = '';
    var trimmedAuthor = String(author || '').trim();
    if (trimmedAuthor) TaskManager.setSetting('currentUser', trimmedAuthor);
    this._renderCollabComments(taskId);
    this._collabFocus('#collab-comment-text');
    return comment;
  },

  _onCollabCommentClick: function(taskId, event) {
    var doc = this._collabDoc();
    var actionEl = event && event.target && event.target.closest
      ? event.target.closest('[data-collab-action]')
      : null;
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-collab-action');
    var id = actionEl.getAttribute('data-comment-id');

    if (action === 'edit-comment') {
      this._collabEditingCommentId = id;
      this._renderCollabComments(taskId);
      this._collabFocus('#collab-edit-text');
      return;
    }
    if (action === 'cancel-edit') {
      this._collabEditingCommentId = null;
      this._renderCollabComments(taskId);
      this._collabFocus('[data-collab-action="edit-comment"][data-comment-id="' + id + '"]');
      return;
    }
    if (action === 'save-edit') {
      var editor = doc ? doc.getElementById('collab-edit-text') : null;
      var updated = TaskManager.updateComment(id, editor ? editor.value : '');
      if (!updated) {
        this._collabSetError('评论内容不能为空且不能超过 2000 字');
        return;
      }
      this._collabEditingCommentId = null;
      this._collabSetError('');
      this._renderCollabComments(taskId);
      this._collabFocus('[data-collab-action="edit-comment"][data-comment-id="' + id + '"]');
      return;
    }
    if (action === 'delete-comment') {
      if (!this._collabConfirm('确定删除该评论吗？')) return;
      TaskManager.deleteComment(id);
      if (this._collabEditingCommentId === id) this._collabEditingCommentId = null;
      this._renderCollabComments(taskId);
      this._collabFocus('#collab-comment-text');
    }
  },

  _collabConfirm: function(message) {
    if (typeof confirm === 'function') return confirm(message);
    return true;
  },

  _renderCollabComments: function(taskId) {
    var doc = this._collabDoc();
    if (!doc || !doc.getElementById) return;
    var list = doc.getElementById('collab-comments-list');
    if (!list) return;

    var rows = this.buildCommentRows(taskId);
    var count = doc.getElementById('collab-comment-count');
    if (count) count.textContent = String(rows.length);

    if (rows.length === 0) {
      list.innerHTML = '<div class="collab-empty">暂无评论</div>';
      return;
    }

    var html = '';
    var self = this;
    rows.forEach(function(row) {
      var editing = self._collabEditingCommentId === row.id;
      html += '<article class="collab-item" data-comment-id="' + _collabEscape(row.id) + '">'
        + '<div class="collab-item-head">'
        + '<span class="collab-author">' + _collabEscape(row.author) + '</span>'
        + '<time class="collab-time" datetime="' + _collabEscape(row.createdAt) + '">'
        + _collabEscape(row.timeText) + '</time>'
        + (row.edited ? '<span class="collab-edited" title="编辑于 ' + _collabEscape(row.updatedText) + '">已编辑</span>' : '')
        + '</div>';
      if (editing) {
        html += '<textarea id="collab-edit-text" class="collab-edit-text" rows="3" maxlength="2000">'
          + _collabEscape(row.text) + '</textarea>'
          + '<div class="collab-item-actions">'
          + '<button type="button" class="btn-primary" data-collab-action="save-edit" data-comment-id="'
          + _collabEscape(row.id) + '">保存</button>'
          + '<button type="button" data-collab-action="cancel-edit" data-comment-id="'
          + _collabEscape(row.id) + '">取消</button>'
          + '</div>';
      } else {
        html += '<div class="collab-text">' + _collabEscape(row.text) + '</div>'
          + '<div class="collab-item-actions">'
          + '<button type="button" data-collab-action="edit-comment" data-comment-id="'
          + _collabEscape(row.id) + '">编辑</button>'
          + '<button type="button" class="collab-danger" data-collab-action="delete-comment" data-comment-id="'
          + _collabEscape(row.id) + '">删除</button>'
          + '</div>';
      }
      html += '</article>';
    });
    list.innerHTML = html;
  },

  _renderCollabAttachments: function(taskId) {
    var doc = this._collabDoc();
    if (!doc || !doc.getElementById) return;
    var list = doc.getElementById('collab-attachments-list');
    if (!list) return;

    var rows = this.buildAttachmentRows(taskId);
    var count = doc.getElementById('collab-attachment-count');
    if (count) count.textContent = String(rows.length);

    if (rows.length === 0) {
      list.innerHTML = '<div class="collab-empty">暂无附件</div>';
      return;
    }

    var html = '';
    rows.forEach(function(row) {
      html += '<article class="collab-item collab-attachment" data-attachment-id="'
        + _collabEscape(row.id) + '">'
        + '<div class="collab-attach-main">'
        + '<span class="collab-attach-name" title="' + _collabEscape(row.name) + '">'
        + _collabEscape(row.name) + '</span>'
        + '<span class="collab-attach-meta">' + _collabEscape(row.sizeText)
        + ' · ' + _collabEscape(row.type) + '</span>'
        + '</div>'
        + '<div class="collab-item-actions">'
        + '<button type="button" data-collab-action="download-attachment" data-attachment-id="'
        + _collabEscape(row.id) + '">下载</button>'
        + '<button type="button" class="collab-danger" data-collab-action="delete-attachment" data-attachment-id="'
        + _collabEscape(row.id) + '">删除</button>'
        + '</div></article>';
    });
    list.innerHTML = html;
  },

  _renderCollabActivity: function(taskId) {
    var doc = this._collabDoc();
    if (!doc || !doc.getElementById) return;
    var list = doc.getElementById('collab-activity-list');
    if (!list) return;

    var rows = this.buildActivityRows(taskId);
    if (rows.length === 0) {
      list.innerHTML = '<div class="collab-empty">暂无活动记录</div>';
      return;
    }

    var html = '';
    rows.forEach(function(row) {
      html += '<div class="collab-activity" data-activity-id="' + _collabEscape(row.id) + '">'
        + '<div class="collab-activity-text">' + _collabEscape(row.text) + '</div>'
        + '<time class="collab-time" datetime="' + _collabEscape(row.at) + '">'
        + _collabEscape(row.timeText) + '</time></div>';
    });
    list.innerHTML = html;
  },

  _onCollabAttachmentClick: function(taskId, event) {
    var actionEl = event && event.target && event.target.closest
      ? event.target.closest('[data-collab-action]')
      : null;
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-collab-action');
    var id = actionEl.getAttribute('data-attachment-id');
    var meta = typeof TaskManager.getAttachment === 'function' ? TaskManager.getAttachment(id) : null;
    if (!meta) return;

    if (action === 'download-attachment') {
      this._downloadCollabAttachment(meta);
      return;
    }
    if (action === 'delete-attachment') {
      if (!this._collabConfirm('确定删除附件「' + meta.name + '」吗？')) return;
      var self = this;
      var removeBlob = typeof AttachmentStore !== 'undefined' && AttachmentStore &&
        typeof AttachmentStore.delete === 'function'
        ? AttachmentStore.delete(meta.blobKey)
        : Promise.resolve();
      removeBlob.then(function() {
        TaskManager.deleteAttachment(meta.id);
        self._renderCollabAttachments(taskId);
        self._renderCollabActivity(taskId);
      });
    }
  },

  _uploadOneCollabFile: function(taskId, file, expectedProjectId) {
    var self = this;
    if (typeof AttachmentStore === 'undefined' || !AttachmentStore ||
        typeof AttachmentStore.put !== 'function') {
      return Promise.resolve(false);
    }

    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    var originProjectId = expectedProjectId !== undefined
      ? expectedProjectId
      : (ws ? (ws.activeProjectId || (ws.currentProject ? (ws.currentProject() ? ws.currentProject().id : null) : null)) : null);

    if (!originProjectId) {
      this._collabSetError('未选择项目，无法上传附件，未保存');
      return Promise.resolve(false);
    }

    if (ws) {
      if (typeof ws.isReadOnly === 'function' && ws.isReadOnly()) {
        this._collabSetError('工作区处于只读状态，无法上传附件，未保存');
        return Promise.resolve(false);
      }
      if (typeof ws.isLocked === 'function' && ws.isLocked()) {
        this._collabSetError('工作区已被写锁锁定，无法上传附件，未保存');
        return Promise.resolve(false);
      }
      var curProj = typeof ws.currentProject === 'function' ? ws.currentProject() : null;
      if (curProj && curProj.archived) {
        this._collabSetError('项目已归档，无法上传附件，未保存');
        return Promise.resolve(false);
      }
    }

    if (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getTask === 'function') {
      var task = TaskManager.getTask(taskId);
      if (!task) {
        this._collabSetError('任务不存在或已删除，无法上传附件，未保存');
        return Promise.resolve(false);
      }
    }

    var blobKey = 'blob-' + Date.now().toString(36) + '-'
      + Math.random().toString(36).slice(2, 10);
    var fileMeta = {
      name: file.name,
      size: file.size,
      type: String(file.type || '').toLowerCase(),
      blobKey: blobKey
    };
    var preview = typeof AttachmentMeta !== 'undefined' && AttachmentMeta &&
      typeof AttachmentMeta.create === 'function'
      ? AttachmentMeta.create(taskId, fileMeta)
      : null;
    if (!preview) {
      this._collabSetError('附件「' + file.name + '」类型不支持或超过 10 MB');
      return Promise.resolve(false);
    }

    function cleanTemporaryBlob() {
      if (typeof AttachmentStore.delete === 'function') {
        return AttachmentStore.delete(blobKey).catch(function(delErr) {
          console.warn('清理临时附件失败: ' + blobKey, delErr);
        });
      }
      return Promise.resolve();
    }

    return AttachmentStore.put(blobKey, file, {
      taskId: taskId,
      size: file.size,
      type: fileMeta.type,
      createdAt: preview.createdAt
    }).then(function() {
      var currentProjectId = ws ? (ws.activeProjectId || (ws.currentProject ? (ws.currentProject() ? ws.currentProject().id : null) : null)) : null;
      if (currentProjectId !== originProjectId) {
        self._collabSetError('当前项目已切换，附件上传已取消，未保存');
        return cleanTemporaryBlob().then(function() { return false; });
      }

      if (ws) {
        if (typeof ws.isReadOnly === 'function' && ws.isReadOnly()) {
          self._collabSetError('工作区处于只读状态，未保存');
          return cleanTemporaryBlob().then(function() { return false; });
        }
        if (typeof ws.isLocked === 'function' && ws.isLocked()) {
          self._collabSetError('工作区已被写锁锁定，未保存');
          return cleanTemporaryBlob().then(function() { return false; });
        }
      }

      var taskNow = (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getTask === 'function')
        ? TaskManager.getTask(taskId)
        : null;
      if (!taskNow) {
        self._collabSetError('任务不存在或已被删除，未保存');
        return cleanTemporaryBlob().then(function() { return false; });
      }

      var saved = false;
      try {
        saved = TaskManager.addAttachment(taskId, fileMeta);
      } catch (saveErr) {
        saved = false;
      }

      if (saved) return true;
      self._collabSetError('附件「' + file.name + '」保存失败，未保存');
      return cleanTemporaryBlob().then(function() { return false; });
    }).catch(function(err) {
      self._collabSetError('附件「' + file.name + '」上传失败，未保存');
      return cleanTemporaryBlob().then(function() { return false; });
    });
  },

  _uploadCollabFiles: function(taskId, input) {
    var self = this;
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    if (files.length === 0) return Promise.resolve(0);
    this._collabSetError('');

    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    var originProjectId = ws ? (ws.activeProjectId || (ws.currentProject ? (ws.currentProject() ? ws.currentProject().id : null) : null)) : null;

    var chain = Promise.resolve();
    var uploaded = 0;
    files.forEach(function(file) {
      chain = chain.then(function() {
        return self._uploadOneCollabFile(taskId, file, originProjectId).then(function(ok) {
          if (ok) uploaded++;
        });
      });
    });
    return chain.then(function() {
      if (input) input.value = '';
      var currentProjectId = ws ? (ws.activeProjectId || (ws.currentProject ? (ws.currentProject() ? ws.currentProject().id : null) : null)) : null;
      if (currentProjectId === originProjectId) {
        self._renderCollabAttachments(taskId);
        self._renderCollabActivity(taskId);
      }
      return uploaded;
    });
  },

  _downloadCollabAttachment: function(meta) {
    var self = this;
    if (!meta || typeof AttachmentStore === 'undefined' || !AttachmentStore ||
        typeof AttachmentStore.get !== 'function') return;
    AttachmentStore.get(meta.blobKey).then(function(blob) {
      if (!blob) {
        self._collabSetError('附件内容缺失，可能已被清理');
        return;
      }
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' ||
          typeof document === 'undefined') return;
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = meta.name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (typeof setTimeout === 'function') {
        setTimeout(function() { URL.revokeObjectURL(url); }, 0);
      }
    }).catch(function() {
      self._collabSetError('附件下载失败');
    });
  },

  _downloadFile: function(filename, content, mimeType) {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    var blob = (typeof Blob !== 'undefined' && content instanceof Blob)
      ? content
      : (typeof Blob !== 'undefined' ? new Blob([content], { type: mimeType || 'application/octet-stream' }) : null);
    if (!blob) return;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    var url = URL.createObjectURL(blob);
    var link = doc.createElement('a');
    link.href = url;
    link.download = filename || 'download';
    link.rel = 'noopener';
    if (doc.body && typeof doc.body.appendChild === 'function') {
      doc.body.appendChild(link);
    }
    if (typeof link.click === 'function') {
      link.click();
    }
    if (link.parentNode && typeof link.parentNode.removeChild === 'function') {
      link.parentNode.removeChild(link);
    }
    if (typeof setTimeout === 'function') {
      setTimeout(function() { URL.revokeObjectURL(url); }, 0);
    }
  },

  // -- 资源工作量视图 --

  _initResourceControls: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return;
    if (doc.getElementById('btn-resource-view')) return;
    var toolbar = doc.getElementById('toolbar');
    if (!toolbar) return;

    var self = this;
    var button = doc.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.id = 'btn-resource-view';
    button.title = '按负责人查看每日/每周工作量与容量冲突';
    button.textContent = '资源';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', function() {
      if (typeof Workbench === 'undefined' || !Workbench ||
          typeof Workbench.toggleResourceView !== 'function') return;
      var open = Workbench.toggleResourceView();
      self._syncResourceButton(open);
    });

    var anchor = doc.getElementById('btn-add-root-task');
    if (anchor && toolbar.insertBefore) toolbar.insertBefore(button, anchor);
    else toolbar.appendChild(button);
  },

  _syncResourceButton: function(open) {
    var doc = typeof document !== 'undefined' ? document : null;
    var button = doc && doc.getElementById ? doc.getElementById('btn-resource-view') : null;
    if (!button) return;
    var active = open === undefined
      ? !!(typeof Workbench !== 'undefined' && Workbench && Workbench.isResourceViewOpen())
      : !!open;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  },

  setResourceCapacity: function(value) {
    if (typeof Workbench === 'undefined' || !Workbench ||
        typeof Workbench.setResourceCapacity !== 'function') return null;
    var applied = Workbench.setResourceCapacity(value);
    this._syncResourceButton();
    return applied;
  },

  setResourceGranularity: function(value) {
    if (typeof Workbench === 'undefined' || !Workbench ||
        typeof Workbench.setResourceGranularity !== 'function') return null;
    return Workbench.setResourceGranularity(value);
  },

  toggleResourceView: function() {
    if (typeof Workbench === 'undefined' || !Workbench ||
        typeof Workbench.toggleResourceView !== 'function') return false;
    var open = Workbench.toggleResourceView();
    this._syncResourceButton(open);
    return open;
  }
};
