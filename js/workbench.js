// ============================================================
// Workbench: 双面板布局、滚动同步、分割条、选中与 hover
// ============================================================

function _wbViews() {
  return typeof Views !== 'undefined' && Views ? Views : null;
}

var ViewState = {
  selectedTaskId: null,
  hoveredTaskId: null,
  collapsed: new Set(),
  statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true },
  gridWidth: 560,
  timelineMode: 'gantt',
  granularity: 'day',
  panels: {
    ganttVisible: true,
    calendarVisible: false,
    nodesVisible: true
  },
  criticalPath: false,
  view: (typeof Views !== 'undefined' && Views && typeof Views.defaultView === 'function')
    ? Views.defaultView()
    : { name: '', filters: {}, sort: { field: '', direction: 'asc' }, groupBy: 'none' },
  activeViewId: null
};

function _wbEscape(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _wbColor(color) {
  var fallback = typeof DEFAULT_TASK_COLOR === 'string' ? DEFAULT_TASK_COLOR : '#1e40af';
  return /^#[0-9a-fA-F]{3,8}$/.test(String(color)) ? color : fallback;
}

function _wbEffectiveColor(task) {
  if (typeof TaskManager !== 'undefined' && TaskManager &&
      typeof TaskManager.getEffectiveColor === 'function' && task) {
    return TaskManager.getEffectiveColor(task);
  }
  return task && task.color ? task.color : null;
}

function _wbStatusKey(task) {
  if (!task) return 'todo';
  if (task.status === 'todo') return 'todo';
  if (task.status === 'done') return 'done';
  if (task.status === 'thirdParty') return 'thirdParty';
  return 'inProgress';
}

function _wbStatusLabel(task) {
  var key = _wbStatusKey(task);
  return key === 'todo' ? '未开始' : key === 'done' ? '已完成' : key === 'thirdParty' ? '第三方' : '进行中';
}

function _wbToggleRowClass(body, taskId, className, rowSelector) {
  if (!body || !body.querySelectorAll) return;
  var nodes = body.querySelectorAll(rowSelector);
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].classList.toggle(className, taskId !== null && taskId !== undefined &&
      nodes[i].getAttribute('data-task-id') === taskId);
  }
}

function _wbRound(value) {
  var numeric = typeof value === 'number' && isFinite(value) ? value : 0;
  return Math.round(numeric * 1e6) / 1e6;
}

function _wbFormatHours(value) {
  var numeric = _wbRound(value);
  return String(Math.round(numeric * 10) / 10);
}

function _wbResourceDateLabel(date, granularity) {
  var text = String(date === null || date === undefined ? '' : date);
  if (text.length < 10) return text;
  var shortText = text.slice(5);
  return granularity === 'week' ? '周 ' + shortText : shortText;
}

// ------------------------------------------------------------
// GridPane 缺失时的最小降级实现，保证 workbench 分支可单独打开
// ------------------------------------------------------------
var _WorkbenchFallbackGrid = {
  _header: null,
  _body: null,

  init: function(options) {
    options = options || {};
    this._header = options.header || null;
    this._body = options.body || null;
  },

  render: function(rows) {
    rows = rows || [];
    if (this._header) {
      this._header.innerHTML =
        '<div class="wb-grid-header-row">' +
          '<div class="wb-grid-col wb-col-name">任务名称</div>' +
          '<div class="wb-grid-col wb-col-status">状态</div>' +
          '<div class="wb-grid-col wb-col-date">开始</div>' +
          '<div class="wb-grid-col wb-col-date">结束</div>' +
        '</div>';
    }
    if (!this._body) return;
    if (rows.length === 0) {
      this._body.innerHTML = '<div class="workbench-empty">暂无任务</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      html += _WorkbenchFallbackGrid._rowHtml(rows[i]);
    }
    this._body.innerHTML = html;
  },

  _rowHtml: function(row) {
    var task = row.task || {};
    var key = _wbStatusKey(task);
    var id = _wbEscape(row.id);
    var toggle = row.hasChildren
      ? '<button type="button" class="wb-toggle" data-action="toggle-collapse" data-task-id="' + id + '" aria-label="折叠或展开">' + (row.isCollapsed ? '▸' : '▾') + '</button>'
      : '<span class="wb-toggle-placeholder"></span>';
    var marker = row.isSummary
      ? '<span class="wb-summary-mark"></span>'
      : '<span class="wb-color-dot" style="background:' + _wbColor(_wbEffectiveColor(task)) + '"></span>';
    var indent = 8 + (row.depth || 0) * 16;
    return '<div class="wb-grid-row' + (row.isSummary ? ' is-summary' : '') + '" data-task-id="' + id + '" data-depth="' + (row.depth || 0) + '" role="row" tabindex="0">' +
      '<div class="wb-grid-col wb-col-name" style="padding-left:' + indent + 'px">' + toggle + marker +
        '<span class="wb-row-name">' + _wbEscape(task.name) + '</span></div>' +
      '<div class="wb-grid-col wb-col-status"><span class="status-badge status-' + key + '"><span class="status-dot"></span>' + _wbStatusLabel(task) + '</span></div>' +
      '<div class="wb-grid-col wb-col-date">' + _wbEscape(row.startDate || '') + '</div>' +
      '<div class="wb-grid-col wb-col-date">' + _wbEscape(row.endDate || '') + '</div>' +
    '</div>';
  },

  updateSelection: function(taskId) {
    _wbToggleRowClass(this._body, taskId, 'selected', '.wb-grid-row');
  },

  updateHover: function(taskId) {
    _wbToggleRowClass(this._body, taskId, 'hovered', '.wb-grid-row');
  },

  syncHeader: function() {}
};

// ------------------------------------------------------------
// TimelinePane 缺失时的最小降级实现
// ------------------------------------------------------------
var _WorkbenchFallbackTimeline = {
  _header: null,
  _body: null,
  _granularity: 'day',

  init: function(options) {
    options = options || {};
    this._header = options.header || null;
    this._body = options.body || null;
  },

  render: function(rows) {
    rows = rows || [];
    if (this._header) {
      this._header.innerHTML = '<div class="wb-timeline-header">时间轴</div>';
    }
    if (!this._body) return;
    if (rows.length === 0) {
      this._body.innerHTML = '<div class="workbench-empty">暂无任务</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var task = row.task || {};
      var range = row.startDate && row.endDate ? ' (' + row.startDate + ' ~ ' + row.endDate + ')' : '';
      html += '<div class="wb-timeline-row' + (row.isSummary ? ' is-summary' : '') + '" data-task-id="' + _wbEscape(row.id) + '">' +
        '<span class="wb-timeline-label">' + _wbEscape(task.name) + '</span>' +
        '<span class="wb-timeline-range">' + _wbEscape(range) + '</span>' +
      '</div>';
    }
    this._body.innerHTML = html;
  },

  updateSelection: function(taskId) {
    _wbToggleRowClass(this._body, taskId, 'selected', '.wb-timeline-row');
  },

  updateHover: function(taskId) {
    _wbToggleRowClass(this._body, taskId, 'hovered', '.wb-timeline-row');
  },

  syncHeader: function() {},

  setGranularity: function(g) {
    if (g) this._granularity = g;
  }
};

var Workbench = {
  MIN_GRID_WIDTH: 320,
  DEFAULT_GRID_WIDTH: 560,
  MAX_GRID_RATIO: 0.6,
  SPLITTER_STEP: 16,
  ROW_HEIGHT: 40,

  _els: null,
  _gridImpl: null,
  _timelineImpl: null,
  _rows: [],
  _byId: null,
  _syncing: false,
  _rafId: 0,
  _dragging: false,
  _criticalIds: null,
  _criticalErrors: [],
  _resourceOpen: false,
  _resourcePanel: null,

  init: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return this;

    this._els = {
      workbench: doc.getElementById('workbench'),
      gridPane: doc.getElementById('grid-pane'),
      gridHeader: doc.getElementById('grid-header'),
      gridBody: doc.getElementById('grid-body'),
      splitter: doc.getElementById('workbench-splitter'),
      datePanels: doc.getElementById('date-panels'),
      timelinePane: doc.getElementById('timeline-pane'),
      timelineHeader: doc.getElementById('timeline-header'),
      timelineBody: doc.getElementById('timeline-body'),
      calendarPanel: doc.getElementById('calendar-panel'),
      todosSidebar: doc.getElementById('todos-sidebar')
    };

    this._gridImpl = this._resolveGrid();
    this._timelineImpl = this._resolveTimeline();

    this._call(this._gridImpl, 'init', {
      header: this._els.gridHeader,
      body: this._els.gridBody
    });
    this._call(this._timelineImpl, 'init', {
      header: this._els.timelineHeader,
      body: this._els.timelineBody
    });

    if (this._els.calendarPanel && typeof CalendarView !== 'undefined' && CalendarView && typeof CalendarView.init === 'function') {
      CalendarView.init(this._els.calendarPanel);
    }

    this._bindScrollSync();
    this._bindSplitter();
    this._bindWindowResize();
    this.initViews();

    var saved = null;
    if (typeof TaskManager !== 'undefined' && typeof TaskManager.getSetting === 'function') {
      saved = TaskManager.getSetting('gridWidth');
    }
    this.setGridWidth(typeof saved === 'number' ? saved : this.DEFAULT_GRID_WIDTH, false);
    this.setPanels(ViewState.panels);

    return this;
  },

  // -- 行模型与渲染 --------------------------------------------------

  render: function() {
    if (typeof RowModel === 'undefined' || typeof RowModel.build !== 'function') return this;

    var result = RowModel.build({
      collapsed: ViewState.collapsed,
      statusFilter: ViewState.statusFilter
    });
    var views = _wbViews();
    this._rows = views && typeof views.apply === 'function'
      ? views.apply(result.rows, ViewState.view, this._today)
      : result.rows;
    this._byId = result.byId;

    this._applyCriticalPath();

    var baselineById = this._baselineMap();
    this._safeCall(this._activeGrid(), 'setBaselineById', baselineById);

    var ganttVisible = Boolean(ViewState.panels && ViewState.panels.ganttVisible);
    var calendarVisible = Boolean(ViewState.panels && ViewState.panels.calendarVisible);

    if (ganttVisible) {
      this._safeCall(this._activeTimeline(), 'setBaseline', baselineById);
      this._safeCall(this._activeTimeline(), 'render', this._rows);
    }
    if (calendarVisible) {
      this._renderCalendar();
    }
    this._safeCall(this._activeGrid(), 'render', this._rows);

    this._syncSelectionHover();
    this._renderResourcesIfActive();
    return this;
  },

  // -- 关键路径 ------------------------------------------------------

  // 开启时按当前依赖和日期重算，关闭时清空集合
  computeCriticalSet: function() {
    if (!ViewState.criticalPath) {
      this._criticalIds = null;
      this._criticalErrors = [];
      return null;
    }
    if (typeof CriticalPath === 'undefined' || !CriticalPath ||
        typeof CriticalPath.compute !== 'function' ||
        typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.getAllTasks !== 'function') {
      this._criticalIds = new Set();
      this._criticalErrors = [];
      return this._criticalIds;
    }

    var config = typeof TaskManager.getSchedulerConfig === 'function'
      ? TaskManager.getSchedulerConfig()
      : null;
    var result = CriticalPath.compute(
      TaskManager.getAllTasks(),
      TaskManager.getLinks ? TaskManager.getLinks() : [],
      config
    );
    this._criticalIds = new Set(result.criticalIds || []);
    this._criticalErrors = result.errors || [];
    return this._criticalIds;
  },

  getCriticalIds: function() {
    return this._criticalIds;
  },

  getCriticalErrors: function() {
    return Array.isArray(this._criticalErrors) ? this._criticalErrors.slice() : [];
  },

  isCritical: function(taskId) {
    if (!this._criticalIds || taskId === null || taskId === undefined) return false;
    return this._criticalIds.has(String(taskId));
  },

  // 把关键任务集合下发到两个面板，面板只切 class 不改布局
  _applyCriticalPath: function() {
    var set = this.computeCriticalSet();
    this._safeCall(this._activeGrid(), 'setCriticalIds', set);
    var calendar = this._calendar();
    if (ViewState.timelineMode === 'calendar' && calendar &&
        typeof calendar.setCriticalIds === 'function') {
      this._safeCall(calendar, 'setCriticalIds', set);
    } else {
      this._safeCall(this._activeTimeline(), 'setCriticalIds', set);
    }
    return set;
  },

  setCriticalPath: function(enabled) {
    ViewState.criticalPath = enabled === true;
    this.render();
    return ViewState.criticalPath;
  },

  toggleCriticalPath: function() {
    return this.setCriticalPath(!ViewState.criticalPath);
  },

  _baselineMap: function() {
    if (typeof Baseline === 'undefined' || !Baseline ||
        typeof Baseline.diff !== 'function') return null;
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.getBaseline !== 'function' ||
        typeof TaskManager.getAllTasks !== 'function') return null;
    var snapshot = TaskManager.getBaseline();
    if (!snapshot) return null;
    var result = Baseline.diff(snapshot, TaskManager.getAllTasks());
    var map = new Map();
    (result.tasks || []).forEach(function(entry) {
      if (entry && entry.id !== undefined) map.set(entry.id, entry);
    });
    return map;
  },

  _renderCalendar: function() {
    var calendar = this._calendar();
    if (!calendar) return;
    this._safeCall(calendar, 'render');
  },

  _syncSelectionHover: function() {
    this.setSelected(ViewState.selectedTaskId);
    this.setHovered(ViewState.hoveredTaskId);
  },

  // -- 选中与 hover --------------------------------------------------

  setSelected: function(taskId) {
    var id = taskId || null;
    ViewState.selectedTaskId = id;
    this._safeCall(this._activeGrid(), 'updateSelection', id);
    if (ViewState.timelineMode === 'calendar') {
      this._safeCall(this._calendar(), 'selectBar', id);
    } else {
      this._safeCall(this._activeTimeline(), 'updateSelection', id);
    }
    return id;
  },

  setHovered: function(taskId) {
    var id = taskId || null;
    ViewState.hoveredTaskId = id;
    this._safeCall(this._activeGrid(), 'updateHover', id);
    if (ViewState.timelineMode === 'calendar') {
      if (id) this._safeCall(this._calendar(), 'highlightBar', id);
      else this._safeCall(this._calendar(), 'clearHighlight');
    } else {
      this._safeCall(this._activeTimeline(), 'updateHover', id);
    }
    return id;
  },

  toggleCollapsed: function(taskId) {
    if (!taskId) return false;
    var row = this._byId && typeof this._byId.get === 'function' ? this._byId.get(taskId) : null;
    if (row && !row.hasChildren) return false;

    if (ViewState.collapsed.has(taskId)) {
      ViewState.collapsed.delete(taskId);
    } else {
      ViewState.collapsed.add(taskId);
    }
    this.render();
    return ViewState.collapsed.has(taskId);
  },

  getRows: function() {
    return Array.isArray(this._rows) ? this._rows.slice() : [];
  },

  getView: function() {
    var views = _wbViews();
    if (!views) return ViewState.view;
    ViewState.view = views.normalizeView(ViewState.view);
    return ViewState.view;
  },

  // -- 资源与工作量视图 ---------------------------------------------

  getResourceOptions: function() {
    var settings = null;
    if (typeof TaskManager !== 'undefined' && TaskManager &&
        TaskManager.data && TaskManager.data.settings) {
      settings = TaskManager.data.settings;
    }
    var opts = settings || {};
    var capacity = typeof opts.resourceCapacity === 'number' &&
      isFinite(opts.resourceCapacity) && opts.resourceCapacity >= 0
      ? opts.resourceCapacity
      : 8;
    var granularity = opts.resourceGranularity === 'week' ? 'week' : 'day';
    var capacityByAssignee = opts.resourceCapacityByAssignee &&
      typeof opts.resourceCapacityByAssignee === 'object'
      ? opts.resourceCapacityByAssignee
      : {};
    return {
      granularity: granularity,
      capacity: capacity,
      capacityByAssignee: capacityByAssignee,
      hoursPerDay: 8
    };
  },

  // 纯函数：把任务汇总成可渲染的资源视图模型
  buildResourceModel: function(tasks, options) {
    var opts = options && typeof options === 'object' ? options : this.getResourceOptions();
    var granularity = opts.granularity === 'week' ? 'week' : 'day';
    var capacity = typeof opts.capacity === 'number' && isFinite(opts.capacity) && opts.capacity >= 0
      ? opts.capacity
      : 8;
    var capacityByAssignee = opts.capacityByAssignee && typeof opts.capacityByAssignee === 'object'
      ? opts.capacityByAssignee
      : {};
    var hoursPerDay = typeof opts.hoursPerDay === 'number' && isFinite(opts.hoursPerDay) && opts.hoursPerDay > 0
      ? opts.hoursPerDay
      : 8;

    var empty = {
      granularity: granularity,
      capacity: capacity,
      dates: [],
      rows: [],
      conflicts: [],
      summary: { totalAssignees: 0, totalHours: 0, overloadedAssignees: 0, overloadedDates: 0 }
    };
    if (typeof Resources === 'undefined' || !Resources ||
        typeof Resources.buildWorkload !== 'function') {
      return empty;
    }

    var workload = Resources.buildWorkload(Array.isArray(tasks) ? tasks : [], {
      granularity: granularity,
      capacity: capacity,
      capacityByAssignee: capacityByAssignee,
      hoursPerDay: hoursPerDay
    });
    var summary = typeof Resources.summarize === 'function'
      ? Resources.summarize(workload)
      : empty.summary;
    var dates = Object.keys(workload.byDate || {}).sort();
    var factor = granularity === 'week' ? 7 : 1;

    var rows = Object.keys(workload.byAssignee || {}).sort().map(function(name) {
      var entry = workload.byAssignee[name];
      var limit = _wbRound((entry.capacityPerDay || 0) * factor);
      var cells = dates.map(function(date) {
        var hours = _wbRound(entry.dates[date] || 0);
        var overload = hours > limit;
        return {
          date: date,
          hours: hours,
          capacity: limit,
          overload: overload,
          overtime: overload ? _wbRound(hours - limit) : 0
        };
      });
      var overloadCount = cells.filter(function(cell) { return cell.overload; }).length;
      return {
        assignee: name,
        capacityPerDay: entry.capacityPerDay,
        capacityLimit: limit,
        totalHours: entry.totalHours,
        cells: cells,
        overloadCount: overloadCount
      };
    });

    return {
      granularity: granularity,
      capacity: capacity,
      dates: dates,
      rows: rows,
      conflicts: Array.isArray(workload.conflicts) ? workload.conflicts : [],
      summary: summary
    };
  },

  // 纯函数：资源视图模型转 HTML
  renderResourceModel: function(model) {
    var data = model && typeof model === 'object' ? model : null;
    if (!data) return '<div class="resource-empty">暂无资源数据</div>';
    var factor = data.granularity === 'week' ? '周' : '日';
    var summary = data.summary || {};
    var rows = Array.isArray(data.rows) ? data.rows : [];
    var dates = Array.isArray(data.dates) ? data.dates : [];
    var conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];

    var html = '<div class="resource-summary" role="status">'
      + '<div class="resource-stat"><span class="resource-stat-label">负责人</span>'
      + '<span class="resource-stat-value">' + _wbEscape(String(summary.totalAssignees || 0)) + '</span></div>'
      + '<div class="resource-stat"><span class="resource-stat-label">总工时</span>'
      + '<span class="resource-stat-value">' + _wbEscape(_wbFormatHours(summary.totalHours || 0)) + ' h</span></div>'
      + '<div class="resource-stat' + (summary.overloadedAssignees > 0 ? ' is-overload' : '') + '">'
      + '<span class="resource-stat-label">超载负责人</span>'
      + '<span class="resource-stat-value">' + _wbEscape(String(summary.overloadedAssignees || 0)) + '</span></div>'
      + '<div class="resource-stat' + (summary.overloadedDates > 0 ? ' is-overload' : '') + '">'
      + '<span class="resource-stat-label">超载' + factor + '期</span>'
      + '<span class="resource-stat-value">' + _wbEscape(String(summary.overloadedDates || 0)) + '</span></div>'
      + '</div>';

    if (rows.length === 0 || dates.length === 0) {
      html += '<div class="resource-empty">暂无资源数据（需要任务填写负责人和起止日期）</div>';
      return html;
    }

    html += '<div class="resource-table-wrap" role="region" aria-label="资源工作量表格" tabindex="0">'
      + '<table class="resource-table"><thead><tr>'
      + '<th class="resource-col-name" scope="col">负责人</th>'
      + '<th scope="col">容量/' + factor + '</th>'
      + '<th scope="col">总工时</th>';
    dates.forEach(function(date) {
      html += '<th scope="col">' + _wbEscape(_wbResourceDateLabel(date, data.granularity)) + '</th>';
    });
    html += '</tr></thead><tbody>';

    rows.forEach(function(row) {
      html += '<tr>'
        + '<th class="resource-col-name" scope="row">' + _wbEscape(row.assignee) + '</th>'
        + '<td class="resource-capacity-cell">' + _wbEscape(_wbFormatHours(row.capacityLimit)) + ' h</td>'
        + '<td>' + _wbEscape(_wbFormatHours(row.totalHours)) + ' h</td>';
      row.cells.forEach(function(cell) {
        var classes = 'resource-cell' + (cell.overload ? ' is-overload' : '');
        var title = _wbEscape(row.assignee + ' ' + cell.date + '：' + _wbFormatHours(cell.hours)
          + ' h / 容量 ' + _wbFormatHours(cell.capacity) + ' h'
          + (cell.overload ? '（超 ' + _wbFormatHours(cell.overtime) + ' h）' : ''));
        html += '<td class="' + classes + '" title="' + title + '">'
          + _wbEscape(_wbFormatHours(cell.hours)) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="resource-conflicts">'
      + '<h5 class="resource-conflicts-title">容量冲突</h5>';
    if (conflicts.length === 0) {
      html += '<div class="resource-empty">无超载冲突</div>';
    } else {
      html += '<ul class="resource-conflict-list" role="list">';
      conflicts.forEach(function(conflict) {
        html += '<li class="resource-conflict">'
          + '<span class="resource-conflict-name">' + _wbEscape(conflict.assignee) + '</span>'
          + '<span class="resource-conflict-date">' + _wbEscape(conflict.date) + '</span>'
          + '<span class="resource-conflict-hours">' + _wbEscape(_wbFormatHours(conflict.hours))
          + ' h / ' + _wbEscape(_wbFormatHours(conflict.capacity)) + ' h</span>'
          + '<span class="resource-conflict-overtime">超 '
          + _wbEscape(_wbFormatHours(conflict.overtime)) + ' h</span>'
          + '</li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  },

  isResourceViewOpen: function() {
    return this._resourceOpen === true;
  },

  toggleResourceView: function(force) {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.createElement) {
      this._resourceOpen = typeof force === 'boolean' ? force : !this._resourceOpen;
      return this._resourceOpen;
    }
    this._ensureResourcePanel();
    var panel = this._resourcePanel;
    if (!panel) return false;

    var open = typeof force === 'boolean' ? force : !this._resourceOpen;
    this._resourceOpen = open;
    panel.hidden = !open;
    var button = doc.getElementById('btn-resource-view');
    if (button) {
      button.classList.toggle('active', open);
      button.setAttribute('aria-pressed', open ? 'true' : 'false');
    }
    if (open) this.renderResourceView();
    return open;
  },

  refreshResourceView: function() {
    if (!this._resourceOpen) return false;
    this.renderResourceView();
    return true;
  },

  _renderResourcesIfActive: function() {
    if (this._resourceOpen) this.refreshResourceView();
  },

  renderResourceView: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.getElementById) return false;
    this._ensureResourcePanel();
    var panel = this._resourcePanel;
    if (!panel) return false;

    var container = doc.getElementById('resource-content');
    if (!container) return false;
    var tasks = typeof TaskManager !== 'undefined' && TaskManager &&
      typeof TaskManager.getAllTasks === 'function'
      ? TaskManager.getAllTasks()
      : [];
    var model = this.buildResourceModel(tasks);
    container.innerHTML = this.renderResourceModel(model);

    var input = doc.getElementById('resource-capacity');
    if (input && doc.activeElement !== input) input.value = String(model.capacity);

    var dayButton = panel.querySelector('[data-resource-granularity="day"]');
    var weekButton = panel.querySelector('[data-resource-granularity="week"]');
    if (dayButton) {
      dayButton.classList.toggle('active', model.granularity === 'day');
      dayButton.setAttribute('aria-pressed', model.granularity === 'day' ? 'true' : 'false');
    }
    if (weekButton) {
      weekButton.classList.toggle('active', model.granularity === 'week');
      weekButton.setAttribute('aria-pressed', model.granularity === 'week' ? 'true' : 'false');
    }
    return true;
  },

  setResourceCapacity: function(value) {
    var numeric = typeof value === 'number' ? value : Number(value);
    if (!isFinite(numeric) || numeric < 0) return null;
    if (typeof TaskManager !== 'undefined' && TaskManager &&
        typeof TaskManager.setSetting === 'function') {
      TaskManager.setSetting('resourceCapacity', numeric);
    }
    this.refreshResourceView();
    return numeric;
  },

  setResourceGranularity: function(value) {
    if (value !== 'day' && value !== 'week') return null;
    if (typeof TaskManager !== 'undefined' && TaskManager &&
        typeof TaskManager.setSetting === 'function') {
      TaskManager.setSetting('resourceGranularity', value);
    }
    this.refreshResourceView();
    return value;
  },

  _ensureResourcePanel: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.createElement) return null;
    if (this._resourcePanel) return this._resourcePanel;
    if (doc.getElementById && doc.getElementById('resource-panel')) {
      this._resourcePanel = doc.getElementById('resource-panel');
      return this._resourcePanel;
    }

    var pane = doc.getElementById ? doc.getElementById('timeline-pane') : null;
    if (!pane) return null;

    var panel = doc.createElement('div');
    panel.id = 'resource-panel';
    panel.className = 'resource-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', '资源与工作量');
    panel.innerHTML =
      '<div class="resource-toolbar">'
      + '<span class="resource-title">资源与工作量</span>'
      + '<div class="btn-group resource-granularity" role="group" aria-label="工作量粒度">'
      + '<button type="button" class="btn" data-resource-granularity="day" aria-pressed="true">日</button>'
      + '<button type="button" class="btn" data-resource-granularity="week" aria-pressed="false">周</button>'
      + '</div>'
      + '<label class="resource-capacity-label">每日容量'
      + '<input type="number" id="resource-capacity" min="0" step="0.5" inputmode="decimal"></label>'
      + '<button type="button" class="btn" data-resource-action="apply-capacity">应用</button>'
      + '<button type="button" class="btn" data-resource-action="close">关闭</button>'
      + '</div>'
      + '<div class="resource-content" id="resource-content"></div>';

    pane.appendChild(panel);
    this._resourcePanel = panel;

    var self = this;
    panel.addEventListener('click', function(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var granularity = target.closest('[data-resource-granularity]');
      if (granularity) {
        event.preventDefault();
        self.setResourceGranularity(granularity.getAttribute('data-resource-granularity'));
        return;
      }
      var action = target.closest('[data-resource-action]');
      if (!action) return;
      event.preventDefault();
      var name = action.getAttribute('data-resource-action');
      if (name === 'close') {
        self.toggleResourceView(false);
        if (typeof App !== 'undefined' && App && typeof App._syncResourceButton === 'function') {
          App._syncResourceButton(false);
        }
        return;
      }
      if (name === 'apply-capacity') {
        var input = doc.getElementById('resource-capacity');
        var applied = self.setResourceCapacity(input ? input.value : '');
        if (applied === null) {
          if (typeof App !== 'undefined' && App && typeof App.setStatusMessage === 'function') {
            App.setStatusMessage('容量必须是不小于 0 的数字', 'error');
          }
        }
      }
    });

    var capacityInput = panel.querySelector('#resource-capacity');
    if (capacityInput) {
      capacityInput.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        self.setResourceCapacity(capacityInput.value);
      });
    }

    return panel;
  },

  // -- 视图：搜索、筛选、排序、分组、保存 --------------------------

  initViews: function() {
    this._restoreView();
    this._buildViewsBar();
    this._syncViewControls();
    return this;
  },

  _restoreView: function() {
    var views = _wbViews();
    if (!views) return;
    var activeId = this._getSetting('activeViewId');
    var saved = this._savedViews();
    var found = null;
    if (activeId) {
      for (var i = 0; i < saved.length; i++) {
        if (saved[i].id === activeId) {
          found = saved[i];
          break;
        }
      }
    }
    if (found) {
      ViewState.activeViewId = found.id;
      ViewState.view = views.normalizeView(found);
    } else {
      ViewState.activeViewId = null;
      ViewState.view = views.defaultView();
    }
  },

  _getSetting: function(key) {
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.getSetting !== 'function') {
      return null;
    }
    return TaskManager.getSetting(key);
  },

  _setSetting: function(key, value) {
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.setSetting !== 'function') {
      return;
    }
    TaskManager.setSetting(key, value);
  },

  _savedViews: function() {
    var views = _wbViews();
    if (!views) return [];
    var raw = this._getSetting('views');
    var list = Array.isArray(raw) ? raw : [];
    var result = [];
    list.forEach(function(item, index) {
      if (!item || typeof item !== 'object') return;
      var view = views.normalizeView(item);
      view.id = typeof item.id === 'string' && item.id ? item.id : 'view-' + index;
      if (!view.name) view.name = '视图 ' + (index + 1);
      result.push(view);
    });
    return result;
  },

  _findSavedView: function(id) {
    if (!id) return null;
    var list = this._savedViews();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  },

  _buildViewsBar: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || typeof doc.getElementById !== 'function') return;
    if (this._viewsBar && this._viewsBar.parentNode) return;

    var toolbar = doc.getElementById('toolbar');
    if (!toolbar) return;

    var bar = doc.createElement('div');
    bar.className = 'views-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '视图');
    bar.innerHTML =
      '<input class="views-search" type="search" placeholder="搜索任务" aria-label="搜索任务">'
      + '<div class="views-nav">'
      + '<button type="button" class="views-btn" data-views-action="filter" aria-haspopup="true" aria-expanded="false">筛选</button>'
      + '<div class="views-filter-panel" hidden>'
      + '<label class="views-field"><span>状态</span><select data-view-filter="status">'
      + '<option value="">全部状态</option>'
      + '<option value="todo">未开始</option>'
      + '<option value="inProgress">进行中</option>'
      + '<option value="thirdParty">第三方</option>'
      + '<option value="done">已完成</option>'
      + '</select></label>'
      + '<label class="views-field"><span>快捷到期</span><select data-view-filter="due">'
      + '<option value="">全部</option>'
      + '<option value="overdue">已逾期</option>'
      + '<option value="today">今日到期</option>'
      + '<option value="next7">未来7天</option>'
      + '</select></label>'
      + '<label class="views-field"><span>负责人</span><select data-view-filter="assignee">'
      + '<option value="">全部负责人</option>'
      + '</select></label>'
      + '<label class="views-field"><span>开始不早于</span><input type="date" data-view-filter="startDate"></label>'
      + '<label class="views-field"><span>结束不晚于</span><input type="date" data-view-filter="endDate"></label>'
      + '<button type="button" class="views-btn" data-views-action="clear-filters">清除筛选</button>'
      + '</div></div>'
      + '<select class="views-select views-due-select" data-view-control="due" aria-label="快捷到期">'
      + '<option value="">全部任务</option>'
      + '<option value="overdue">已逾期</option>'
      + '<option value="today">今日到期</option>'
      + '<option value="next7">未来7天</option>'
      + '</select>'
      + '<select class="views-select" data-view-control="groupBy" aria-label="分组">'
      + '<option value="none">不分组</option>'
      + '<option value="status">按状态分组</option>'
      + '<option value="assignee">按负责人分组</option>'
      + '</select>'
      + '<select class="views-select" data-view-control="sortField" aria-label="排序字段">'
      + '<option value="">默认顺序</option>'
      + '<option value="name">名称</option>'
      + '<option value="status">状态</option>'
      + '<option value="assignee">负责人</option>'
      + '<option value="startDate">开始日期</option>'
      + '<option value="endDate">结束日期</option>'
      + '<option value="progress">进度</option>'
      + '</select>'
      + '<button type="button" class="views-btn views-sort-dir" data-views-action="sort-direction" aria-label="切换升降序">↑</button>'
      + '<select class="views-select views-view-select" data-view-control="viewId" aria-label="选择已保存视图">'
      + '<option value="">未保存视图</option>'
      + '</select>'
      + '<button type="button" class="views-btn" data-views-action="save">保存</button>'
      + '<button type="button" class="views-btn" data-views-action="rename">重命名</button>'
      + '<button type="button" class="views-btn" data-views-action="delete">删除</button>';

    var anchor = doc.getElementById('btn-add-root-task');
    if (anchor && toolbar.insertBefore) toolbar.insertBefore(bar, anchor);
    else toolbar.appendChild(bar);

    this._viewsBar = bar;
    var self = this;

    bar.addEventListener('input', function(e) {
      if (!e.target || !e.target.classList || !e.target.classList.contains('views-search')) return;
      ViewState.view.filters.search = e.target.value;
      self._applyViewChange();
    });

    bar.addEventListener('change', function(e) {
      var target = e.target;
      if (!target || !target.getAttribute) return;
      var control = target.getAttribute('data-view-control');
      if (control === 'due') {
        ViewState.view.filters.due = target.value;
        self._applyViewChange();
        return;
      }
      if (control === 'groupBy') {
        ViewState.view.groupBy = target.value;
        self._applyViewChange();
        return;
      }
      if (control === 'sortField') {
        ViewState.view.sort.field = target.value;
        self._applyViewChange();
        return;
      }
      if (control === 'viewId') {
        self.loadView(target.value);
        return;
      }
      var filter = target.getAttribute('data-view-filter');
      if (filter) {
        ViewState.view.filters[filter] = target.value;
        self._applyViewChange();
      }
    });

    bar.addEventListener('click', function(e) {
      var actionEl = e.target && e.target.closest ? e.target.closest('[data-views-action]') : null;
      if (!actionEl) return;
      e.preventDefault();
      self._handleViewAction(actionEl.getAttribute('data-views-action'));
    });

    if (!this._viewsDocBound) {
      doc.addEventListener('click', function(e) {
        if (!self._viewsBar || !self._viewsBar.contains(e.target)) self._hideFilterPanel();
      });
      this._viewsDocBound = true;
    }
  },

  _handleViewAction: function(action) {
    if (action === 'filter') {
      var panel = this._viewsBar ? this._viewsBar.querySelector('.views-filter-panel') : null;
      var button = this._viewsBar ? this._viewsBar.querySelector('[data-views-action="filter"]') : null;
      if (!panel) return;
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      if (button) button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) this._syncAssigneeOptions();
      return;
    }
    if (action === 'clear-filters') {
      ViewState.view.filters = _wbViews().defaultView().filters;
      this._applyViewChange();
      return;
    }
    if (action === 'sort-direction') {
      ViewState.view.sort.direction = ViewState.view.sort.direction === 'desc' ? 'asc' : 'desc';
      this._applyViewChange();
      return;
    }
    if (action === 'save') {
      this.saveCurrentView();
      return;
    }
    if (action === 'rename') {
      this.renameCurrentView();
      return;
    }
    if (action === 'delete') {
      this.deleteCurrentView();
    }
  },

  _hideFilterPanel: function() {
    if (!this._viewsBar) return;
    var panel = this._viewsBar.querySelector('.views-filter-panel');
    var button = this._viewsBar.querySelector('[data-views-action="filter"]');
    if (panel) panel.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  },

  _applyViewChange: function() {
    var views = _wbViews();
    if (views) ViewState.view = views.normalizeView(ViewState.view);
    this._syncViewControls();
    this.render();
  },

  _syncViewControls: function() {
    if (!this._viewsBar) return;
    var view = ViewState.view;
    var filters = view.filters || {};

    var search = this._viewsBar.querySelector('.views-search');
    if (search && search.value !== filters.search) search.value = filters.search || '';

    this._setControlValue('[data-view-control="groupBy"]', view.groupBy || 'none');
    this._setControlValue('[data-view-control="sortField"]', (view.sort && view.sort.field) || '');
    this._setControlValue('[data-view-control="due"]', filters.due || '');
    this._setControlValue('[data-view-filter="due"]', filters.due || '');
    this._setControlValue('[data-view-filter="status"]', filters.status || '');
    this._setControlValue('[data-view-filter="startDate"]', filters.startDate || '');
    this._setControlValue('[data-view-filter="endDate"]', filters.endDate || '');
    this._syncAssigneeOptions();
    this._syncViewOptions();

    var direction = this._viewsBar.querySelector('[data-views-action="sort-direction"]');
    if (direction) {
      var desc = view.sort && view.sort.direction === 'desc';
      direction.textContent = desc ? '↓' : '↑';
      direction.setAttribute('aria-label', desc ? '当前降序，切换为升序' : '当前升序，切换为降序');
      direction.classList.toggle('is-desc', desc);
    }

    var hasActive = !!ViewState.activeViewId;
    var rename = this._viewsBar.querySelector('[data-views-action="rename"]');
    var remove = this._viewsBar.querySelector('[data-views-action="delete"]');
    if (rename) rename.disabled = !hasActive;
    if (remove) remove.disabled = !hasActive;
  },

  _setControlValue: function(selector, value) {
    if (!this._viewsBar) return;
    var node = this._viewsBar.querySelector(selector);
    if (!node) return;
    if (node.value !== value) node.value = value;
  },

  _syncAssigneeOptions: function() {
    if (!this._viewsBar) return;
    var select = this._viewsBar.querySelector('[data-view-filter="assignee"]');
    if (!select) return;
    var current = (ViewState.view.filters && ViewState.view.filters.assignee) || '';
    var seen = [];
    if (typeof TaskManager !== 'undefined' && TaskManager &&
        typeof TaskManager.getAllTasks === 'function') {
      TaskManager.getAllTasks().forEach(function(task) {
        var assignee = task && task.assignee ? String(task.assignee).trim() : '';
        if (assignee && seen.indexOf(assignee) === -1) seen.push(assignee);
      });
    }
    seen.sort(function(a, b) { return a.localeCompare(b, 'zh-CN'); });

    var html = '<option value="">全部负责人</option>';
    seen.forEach(function(assignee) {
      html += '<option value="' + _wbEscape(assignee) + '">' + _wbEscape(assignee) + '</option>';
    });
    select.innerHTML = html;
    select.value = seen.indexOf(current) === -1 ? '' : current;
    if (current && seen.indexOf(current) === -1) {
      ViewState.view.filters.assignee = '';
    }
  },

  _syncViewOptions: function() {
    if (!this._viewsBar) return;
    var select = this._viewsBar.querySelector('[data-view-control="viewId"]');
    if (!select) return;
    var saved = this._savedViews();
    var html = '<option value="">未保存视图</option>';
    saved.forEach(function(view) {
      html += '<option value="' + _wbEscape(view.id) + '">' + _wbEscape(view.name) + '</option>';
    });
    select.innerHTML = html;
    select.value = ViewState.activeViewId || '';
  },

  _showViewNameDialog: function(title, value, onSave) {
    var modal = typeof ModalManager !== 'undefined' ? ModalManager : null;
    if (!modal || typeof modal.open !== 'function') return;
    modal.open(
      '<div class="modal-title">' + _wbEscape(title) + '</div>'
      + '<div class="modal-field"><label>视图名称</label>'
      + '<input type="text" id="modal-view-name" value="' + _wbEscape(value || '') + '"></div>'
      + '<div class="modal-actions">'
      + '<button onclick="ModalManager.close()">取消</button>'
      + '<button class="btn-primary" id="modal-view-save">保存</button>'
      + '</div>'
    );
    var input = typeof document !== 'undefined' ? document.getElementById('modal-view-name') : null;
    if (input && input.focus) input.focus();
    var saveButton = typeof document !== 'undefined' ? document.getElementById('modal-view-save') : null;
    if (saveButton) {
      saveButton.addEventListener('click', function() {
        var name = input ? input.value.trim() : '';
        if (!name) {
          alert('请输入视图名称');
          return;
        }
        modal.close();
        onSave(name);
      });
    }
  },

  saveCurrentView: function() {
    var self = this;
    var suggested = ViewState.view.name || ('视图 ' + (this._savedViews().length + 1));
    this._showViewNameDialog('保存视图', suggested, function(name) {
      self._commitView(name);
    });
  },

  _commitView: function(name) {
    var views = _wbViews();
    if (!views) return;
    var saved = this._savedViews();
    var view = views.normalizeView(ViewState.view);
    view.name = name;

    var index = -1;
    for (var i = 0; i < saved.length; i++) {
      if (saved[i].id === ViewState.activeViewId) {
        index = i;
        break;
      }
    }

    if (index === -1) {
      view.id = 'view-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      saved.push(view);
    } else {
      view.id = saved[index].id;
      saved[index] = view;
    }

    ViewState.activeViewId = view.id;
    ViewState.view = views.normalizeView(view);
    this._setSetting('views', saved);
    this._setSetting('activeViewId', view.id);
    this._syncViewControls();
  },

  renameCurrentView: function() {
    var saved = this._savedViews();
    var current = null;
    for (var i = 0; i < saved.length; i++) {
      if (saved[i].id === ViewState.activeViewId) {
        current = saved[i];
        break;
      }
    }
    if (!current) {
      this.saveCurrentView();
      return;
    }
    var self = this;
    this._showViewNameDialog('重命名视图', current.name, function(name) {
      var list = self._savedViews();
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === current.id) {
          list[j].name = name;
          break;
        }
      }
      ViewState.view.name = name;
      self._setSetting('views', list);
      self._syncViewControls();
    });
  },

  deleteCurrentView: function() {
    if (!ViewState.activeViewId) {
      alert('当前没有已保存的视图');
      return;
    }
    var id = ViewState.activeViewId;
    var self = this;
    var modal = typeof ModalManager !== 'undefined' ? ModalManager : null;
    if (!modal || typeof modal.confirm !== 'function') return;
    modal.confirm('确定删除当前视图吗？', function() {
      var list = self._savedViews().filter(function(view) { return view.id !== id; });
      self._setSetting('views', list);
      self._setSetting('activeViewId', null);
      ViewState.activeViewId = null;
      ViewState.view.name = '';
      self._syncViewControls();
    });
  },

  loadView: function(id) {
    var views = _wbViews();
    if (!views) return;
    if (!id) {
      ViewState.activeViewId = null;
      ViewState.view = views.defaultView();
      this._setSetting('activeViewId', null);
      this._syncViewControls();
      this.render();
      return;
    }
    var found = this._findSavedView(id);
    if (!found) return;
    ViewState.activeViewId = found.id;
    ViewState.view = views.normalizeView(found);
    this._setSetting('activeViewId', found.id);
    this._syncViewControls();
    this.render();
  },

  // -- 时间轴模式、面板与粒度 ------------------------------------------

  getPanels: function() {
    if (!ViewState.panels) {
      ViewState.panels = { ganttVisible: true, calendarVisible: false, nodesVisible: true };
    }
    return {
      ganttVisible: Boolean(ViewState.panels.ganttVisible),
      calendarVisible: Boolean(ViewState.panels.calendarVisible),
      nodesVisible: Boolean(ViewState.panels.nodesVisible)
    };
  },

  setPanels: function(settings) {
    settings = settings || {};
    if (!ViewState.panels) {
      ViewState.panels = { ganttVisible: true, calendarVisible: false, nodesVisible: true };
    }
    if (typeof settings.ganttVisible === 'boolean') {
      ViewState.panels.ganttVisible = settings.ganttVisible;
    }
    if (typeof settings.calendarVisible === 'boolean') {
      ViewState.panels.calendarVisible = settings.calendarVisible;
    }
    if (typeof settings.nodesVisible === 'boolean') {
      ViewState.panels.nodesVisible = settings.nodesVisible;
    }

    var ganttVisible = Boolean(ViewState.panels.ganttVisible);
    var calendarVisible = Boolean(ViewState.panels.calendarVisible);
    var nodesVisible = Boolean(ViewState.panels.nodesVisible);
    var datePanelsVisible = ganttVisible || calendarVisible;

    var els = this._els;
    if (els) {
      if (els.timelinePane) {
        els.timelinePane.hidden = !ganttVisible;
      }
      if (els.calendarPanel) {
        els.calendarPanel.hidden = !calendarVisible;
      }
      if (els.splitter) {
        els.splitter.hidden = !datePanelsVisible;
      }
      if (els.datePanels) {
        els.datePanels.hidden = !datePanelsVisible;
        els.datePanels.classList.toggle('dual-view', ganttVisible && calendarVisible);
      }
      if (els.gridPane) {
        els.gridPane.classList.toggle('no-date-panels', !datePanelsVisible);
      }
      if (els.workbench) {
        els.workbench.classList.toggle('no-date-panels', !datePanelsVisible);
      }
      if (els.todosSidebar) {
        els.todosSidebar.hidden = !nodesVisible;
      }
    }

    this.render();
  },

  getGranularity: function() {
    return ViewState.granularity || 'day';
  },

  setTimelineMode: function(mode) {
    if (mode !== 'gantt' && mode !== 'calendar') return ViewState.timelineMode;
    ViewState.timelineMode = mode;
    var currentNodes = ViewState.panels ? Boolean(ViewState.panels.nodesVisible) : true;
    if (mode === 'calendar') {
      this.setPanels({ ganttVisible: false, calendarVisible: true, nodesVisible: currentNodes });
    } else {
      this.setPanels({ ganttVisible: true, calendarVisible: false, nodesVisible: currentNodes });
    }
    return mode;
  },

  _restoreScrollTop: function(value) {
    if (!this._els) return;
    var top = typeof value === 'number' && isFinite(value) ? value : 0;
    this._syncing = true;
    if (this._els.timelineBody) this._els.timelineBody.scrollTop = top;
    if (this._els.gridBody) this._els.gridBody.scrollTop = top;
    this._call(this._activeTimeline(), 'refreshWindow');
    this._releaseSyncLock();
  },

  setGranularity: function(granularity) {
    if (!granularity) return ViewState.granularity;
    if (granularity !== 'day' && granularity !== 'week' && granularity !== 'month') return ViewState.granularity;
    ViewState.granularity = granularity;
    if (typeof GanttView !== 'undefined' && GanttView) {
      GanttView.granularity = granularity;
    }
    var timeline = this._activeTimeline();
    if (timeline && typeof timeline.setGranularity === 'function') {
      timeline.setGranularity(granularity);
      this._call(timeline, 'updateSelection', ViewState.selectedTaskId);
      this._call(timeline, 'updateHover', ViewState.hoveredTaskId);
    }
    return granularity;
  },

  // -- 分割条 --------------------------------------------------------

  maxGridWidth: function(containerWidth) {
    var width = typeof containerWidth === 'number' && isFinite(containerWidth) ? containerWidth : 0;
    return Math.max(Workbench.MIN_GRID_WIDTH, Math.floor(width * Workbench.MAX_GRID_RATIO));
  },

  clampGridWidth: function(width, containerWidth) {
    var value = typeof width === 'number' && isFinite(width) ? width : Workbench.DEFAULT_GRID_WIDTH;
    var max = Workbench.maxGridWidth(containerWidth);
    if (value < Workbench.MIN_GRID_WIDTH) value = Workbench.MIN_GRID_WIDTH;
    if (value > max) value = max;
    return value;
  },

  setGridWidth: function(width, persist) {
    var applied = this._applyGridWidth(width);
    if (persist) this._persistGridWidth();
    return applied;
  },

  _applyGridWidth: function(width) {
    if (!this._els) {
      ViewState.gridWidth = Workbench.clampGridWidth(width, 0);
      return ViewState.gridWidth;
    }
    var container = this._els.workbench && typeof this._els.workbench.clientWidth === 'number'
      ? this._els.workbench.clientWidth
      : 0;
    var applied = Math.round(Workbench.clampGridWidth(width, container));
    ViewState.gridWidth = applied;

    if (this._els.gridPane && this._els.gridPane.style) {
      this._els.gridPane.style.width = applied + 'px';
      this._els.gridPane.style.flexBasis = applied + 'px';
    }
    if (this._els.workbench && this._els.workbench.style && this._els.workbench.style.setProperty) {
      this._els.workbench.style.setProperty('--grid-width', applied + 'px');
    }
    if (this._els.splitter && this._els.splitter.setAttribute) {
      this._els.splitter.setAttribute('aria-valuenow', String(applied));
    }
    return applied;
  },

  _currentGridWidth: function() {
    if (this._els && this._els.gridPane && typeof this._els.gridPane.getBoundingClientRect === 'function') {
      var rect = this._els.gridPane.getBoundingClientRect();
      if (rect && rect.width) return rect.width;
    }
    return typeof ViewState.gridWidth === 'number' ? ViewState.gridWidth : this.DEFAULT_GRID_WIDTH;
  },

  _persistGridWidth: function() {
    if (typeof TaskManager !== 'undefined' && typeof TaskManager.setSetting === 'function') {
      TaskManager.setSetting('gridWidth', ViewState.gridWidth);
    }
  },

  _bindSplitter: function() {
    var self = this;
    var els = this._els;
    if (!els || !els.splitter) return;
    var splitter = els.splitter;
    var startX = 0;
    var startWidth = self.DEFAULT_GRID_WIDTH;

    function onMove(event) {
      if (!self._dragging) return;
      self._applyGridWidth(startWidth + (event.clientX - startX));
    }

    function onUp(event) {
      if (!self._dragging) return;
      self._dragging = false;
      splitter.classList.remove('dragging');
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('wb-resizing');
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (splitter.releasePointerCapture && event && event.pointerId !== undefined) {
        try { splitter.releasePointerCapture(event.pointerId); } catch (err) {}
      }
      self._persistGridWidth();
    }

    splitter.addEventListener('pointerdown', function(event) {
      if (event.button !== undefined && event.button !== 0) return;
      if (splitter.focus) {
        try {
          splitter.focus({ preventScroll: true });
        } catch (err) {
          splitter.focus();
        }
      }
      self._dragging = true;
      startX = event.clientX;
      startWidth = self._currentGridWidth();
      splitter.classList.add('dragging');
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('wb-resizing');
      }
      if (splitter.setPointerCapture && event.pointerId !== undefined) {
        try { splitter.setPointerCapture(event.pointerId); } catch (err) {}
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      event.preventDefault();
    });

    splitter.addEventListener('dblclick', function() {
      self.setGridWidth(self.DEFAULT_GRID_WIDTH, true);
    });

    splitter.addEventListener('keydown', function(event) {
      var current = self._currentGridWidth();
      var next = null;
      if (event.key === 'ArrowLeft') next = current - self.SPLITTER_STEP;
      else if (event.key === 'ArrowRight') next = current + self.SPLITTER_STEP;
      else if (event.key === 'Home') next = self.MIN_GRID_WIDTH;
      else if (event.key === 'End') {
        var container = els.workbench && typeof els.workbench.clientWidth === 'number'
          ? els.workbench.clientWidth
          : 0;
        next = self.maxGridWidth(container);
      }
      if (next === null) return;
      event.preventDefault();
      self.setGridWidth(next, true);
    });
  },

  // -- 滚动同步 ------------------------------------------------------

  computeScrollTop: function(sourceTop, targetMax) {
    var top = typeof sourceTop === 'number' && isFinite(sourceTop) ? sourceTop : 0;
    if (top < 0) top = 0;
    var max = typeof targetMax === 'number' && isFinite(targetMax) ? targetMax : 0;
    if (max < 0) max = 0;
    return top > max ? max : top;
  },

  _bindScrollSync: function() {
    if (this._scrollSyncBound) return;
    var self = this;
    var els = this._els;
    if (!els || !els.gridBody || !els.timelineBody) return;
    this._scrollSyncBound = true;

    this._onGridScroll = function() {
      self._syncScroll(els.gridBody, els.timelineBody);
      self._call(self._gridImpl, 'syncHeader');
    };
    this._onTimelineScroll = function() {
      self._syncScroll(els.timelineBody, els.gridBody);
      self._call(self._timelineImpl, 'syncHeader');
    };

    els.gridBody.addEventListener('scroll', this._onGridScroll, { passive: true });
    els.timelineBody.addEventListener('scroll', this._onTimelineScroll, { passive: true });
  },

  _syncScroll: function(source, target) {
    if (!source || !target || this._syncing) return;
    var max = Math.max(0, (target.scrollHeight || 0) - (target.clientHeight || 0));
    var sourceMax = Math.max(0, (source.scrollHeight || 0) - (source.clientHeight || 0));
    var sourceTop = source.scrollTop || 0;
    var targetTop = target.scrollTop || 0;
    if (sourceTop >= sourceMax - 1 && targetTop >= max - 1) return;
    var next = this.computeScrollTop(sourceTop, max);
    if (Math.abs(targetTop - next) < 1) return;

    this._syncing = true;
    target.scrollTop = next;
    this._notifyTimelineWindow(target);
    this._releaseSyncLock();
  },

  // 时间轴按窗口渲染，滚动同步后立即刷新窗口，避免等待下一次 scroll 事件
  _notifyTimelineWindow: function(target) {
    if (!this._els || target !== this._els.timelineBody) return;
    this._call(this._activeTimeline(), 'scheduleWindowUpdate');
  },

  _releaseSyncLock: function() {
    var self = this;
    var raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : function(callback) { return setTimeout(callback, 16); };
    if (this._rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
    }
    this._rafId = raf(function() {
      self._syncing = false;
      self._rafId = 0;
    });
  },

  _bindWindowResize: function() {
    var self = this;
    this._onResize = function() {
      self._applyGridWidth(ViewState.gridWidth);
      self._call(self._activeTimeline(), 'scheduleWindowUpdate');
    };
    window.addEventListener('resize', this._onResize);
  },

  // -- 实现解析 ------------------------------------------------------

  _resolveGrid: function() {
    if (typeof GridPane !== 'undefined' && GridPane) return GridPane;
    return _WorkbenchFallbackGrid;
  },

  _resolveTimeline: function() {
    if (typeof TimelinePane !== 'undefined' && TimelinePane) return TimelinePane;
    return _WorkbenchFallbackTimeline;
  },

  _activeGrid: function() {
    if (this._gridImpl) return this._gridImpl;
    return this._resolveGrid();
  },

  _activeTimeline: function() {
    if (this._timelineImpl) return this._timelineImpl;
    return this._resolveTimeline();
  },

  _calendar: function() {
    return typeof CalendarView !== 'undefined' && CalendarView ? CalendarView : null;
  },

  _call: function(target, method, argument) {
    if (target && typeof target[method] === 'function') {
      return target[method](argument);
    }
    return undefined;
  },

  _safeCall: function(target, method, argument) {
    try {
      return this._call(target, method, argument);
    } catch (error) {
      console.error('Workbench panel call failed:', method, error);
      return undefined;
    }
  }
};
