// ============================================================
// GridPane: 消费 RowModel 行数组的任务表格
// 只负责 DOM、事件与调用 ColumnConfig / CellEditor 两个模块。
// ============================================================
function _gridColumnConfig() {
  return typeof ColumnConfig !== 'undefined' && ColumnConfig ? ColumnConfig : null;
}

function _gridCellEditor() {
  return typeof CellEditor !== 'undefined' && CellEditor ? CellEditor : null;
}

function _cloneGridColumn(column) {
  if (!column) return null;
  var cloned = {
    key: column.key,
    label: column.label,
    width: column.width,
    minWidth: column.minWidth,
    visible: column.visible !== false,
    type: column.type,
    builtin: column.builtin !== false
  };
  if (Array.isArray(column.options)) {
    cloned.options = column.options.map(function(opt) {
      return { id: String(opt.id), label: String(opt.label) };
    });
  }
  return cloned;
}

var GridPane = {
  ROW_HEIGHT: 40,
  INDENT_STEP: 16,
  DEFAULT_COLOR: '#1e40af',
  RESIZER_WIDTH: 6,

  // ColumnConfig 未加载时的降级默认值，保证页面仍可渲染
  DEFAULT_COLUMNS: (typeof ColumnConfig !== 'undefined' && ColumnConfig)
    ? ColumnConfig.DEFAULT_COLUMNS
    : [
        { key: 'name', label: '任务名称', width: 260, minWidth: 160, visible: true, type: 'name' },
        { key: 'status', label: '状态', width: 110, minWidth: 80, visible: true, type: 'status' },
        { key: 'assignee', label: '负责人', width: 100, minWidth: 70, visible: true, type: 'text' },
        { key: 'startDate', label: '开始', width: 110, minWidth: 88, visible: true, type: 'date' },
        { key: 'endDate', label: '结束', width: 110, minWidth: 88, visible: true, type: 'date' },
        { key: 'plannedEndDate', label: '计划完成', width: 120, minWidth: 96, visible: true, type: 'date' },
        { key: 'progress', label: '进度', width: 120, minWidth: 90, visible: true, type: 'progress' },
        { key: 'description', label: '描述', width: 220, minWidth: 120, visible: true, type: 'text' }
      ],

  columns: null,
  header: null,
  body: null,
  rows: [],
  selectedId: null,
  hoveredId: null,
  baselineById: null,
  criticalIds: null,
  selection: new Set(),
  _anchorId: null,
  _rovingTaskId: null,
  _gridRoot: null,
  _columnsInitialized: false,
  _bodyBound: false,
  _headerBound: false,
  _docBound: false,
  _localMenu: null,
  _panel: null,
  _panelTrigger: null,
  _editing: null,
  _lastEdit: null,

  // ---- 列模型（委托 ColumnConfig，保留纯函数接口） ----

  defaultColumns: function() {
    var config = _gridColumnConfig();
    if (config) return config.defaultColumns();
    return (this.DEFAULT_COLUMNS || []).map(_cloneGridColumn);
  },

  getVisibleColumns: function(columns) {
    var list = columns || this.columns || this.defaultColumns();
    var config = _gridColumnConfig();
    if (config) return config.getVisibleColumns(list);
    return list.filter(function(col) {
      return col.visible !== false;
    });
  },

  getColumnsWidth: function(columns) {
    var list = columns || this.columns || this.defaultColumns();
    var config = _gridColumnConfig();
    if (config) return config.getColumnsWidth(list);
    return this.getVisibleColumns(list).reduce(function(sum, col) {
      return sum + col.width;
    }, 0);
  },

  clampColumnWidth: function(column, width) {
    var config = _gridColumnConfig();
    if (config) return config.clampWidth(column, width);
    var min = column && column.minWidth ? column.minWidth : 0;
    var value = Number(width);
    if (!isFinite(value) || value <= 0) {
      return column ? column.width : min;
    }
    return Math.max(min, Math.round(value));
  },

  formatProgress: function(value) {
    var numeric = this.getProgressValue(value);
    return numeric === null ? '' : numeric + '%';
  },

  getProgressValue: function(value) {
    if (value === null || value === undefined || value === '') return null;
    var numeric = Number(value);
    if (!isFinite(numeric)) return null;
    if (numeric < 0) numeric = 0;
    if (numeric > 100) numeric = 100;
    return Math.round(numeric);
  },

  getIndent: function(depth) {
    var level = Number(depth);
    if (!isFinite(level) || level < 0) level = 0;
    return Math.round(level) * this.INDENT_STEP;
  },

  getStatusMeta: function(status) {
    if (status === 'todo') {
      return { key: 'todo', label: '未开始' };
    }
    if (status === 'done') {
      return { key: 'done', label: '已完成' };
    }
    if (status === 'thirdParty') {
      return { key: 'thirdParty', label: '第三方' };
    }
    return { key: 'inProgress', label: '进行中' };
  },

  formatDate: function(value) {
    return value ? String(value) : '';
  },

  // ---- 基线偏差提示 ----
  // map: Map<taskId, Baseline.diff() 条目>，null 表示未保存基线
  setBaselineById: function(map) {
    this.baselineById = map && typeof map.get === 'function' ? map : null;
    return this.baselineById;
  },

  _baselineEntry: function(row) {
    if (!this.baselineById || !row || row.id === null || row.id === undefined) return null;
    return this.baselineById.get(String(row.id)) || null;
  },

  // ---- 关键路径高亮 ----
  // set: Set<taskId>，null 表示关闭高亮
  setCriticalIds: function(set) {
    this.criticalIds = set && typeof set.has === 'function' ? set : null;
    this.syncCriticalDom();
    return this.criticalIds;
  },

  isCritical: function(taskId) {
    if (!this.criticalIds || taskId === null || taskId === undefined) return false;
    return this.criticalIds.has(String(taskId));
  },

  // 只切换 class，不改变行高与列宽
  syncCriticalDom: function() {
    if (!this.body) return;
    var self = this;
    this.body.querySelectorAll('.grid-row').forEach(function(row) {
      var id = row.getAttribute('data-task-id');
      row.classList.toggle('critical', self.isCritical(id));
    });
  },

  formatBaselineVariance: function(days) {
    if (typeof days !== 'number' || !isFinite(days)) return '';
    if (typeof Baseline !== 'undefined' && Baseline &&
        typeof Baseline.formatVariance === 'function') {
      return Baseline.formatVariance(days);
    }
    var rounded = Math.round(days);
    if (rounded > 0) return '+' + rounded;
    if (rounded < 0) return String(rounded);
    return '0';
  },

  renderBaselineBadge: function(row) {
    var entry = this._baselineEntry(row);
    if (!entry) return '';

    if (entry.added) {
      return '<span class="grid-baseline-badge variance-added" title="基线中不存在该任务">新增</span>';
    }

    var days = entry.endVarianceDays;
    if (typeof days !== 'number' || !isFinite(days) || days === 0) return '';

    var text = this.formatBaselineVariance(days);
    var cls = days > 0 ? 'variance-delayed' : 'variance-advanced';
    var title = '基线 ' + (entry.baselineStartDate || '—') + ' ~ ' + (entry.baselineEndDate || '—')
      + '，结束偏差 ' + text + ' 天';
    return '<span class="grid-baseline-badge ' + cls + '" title="' + this.escapeHtml(title) + '">'
      + this.escapeHtml(text + '天') + '</span>';
  },

  // ---- 键盘导航与选择（纯函数，供测试直接调用） ----

  getNavigationIndex: function(currentIndex, key, rowCount) {
    var count = Number(rowCount);
    if (!isFinite(count) || count <= 0) return -1;
    count = Math.floor(count);
    var index = -1;
    if (currentIndex !== null && currentIndex !== undefined && currentIndex !== '') {
      var numeric = Number(currentIndex);
      if (isFinite(numeric)) index = Math.floor(numeric);
    }
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (key === 'ArrowDown') {
      if (index < 0) return 0;
      return Math.min(count - 1, index + 1);
    }
    if (key === 'ArrowUp') {
      if (index <= 0) return 0;
      return Math.min(count - 1, index - 1);
    }
    if (index < 0 || index >= count) return 0;
    return index;
  },

  getRovingTabIndex: function(index, activeIndex) {
    var value = Number(index);
    var active = Number(activeIndex);
    if (!isFinite(value) || !isFinite(active)) return -1;
    return Math.floor(value) === Math.floor(active) ? 0 : -1;
  },

  getActiveRowIndex: function(rows, selectedId, rovingId) {
    if (!Array.isArray(rows) || rows.length === 0) return -1;
    var selected = selectedId === null || selectedId === undefined ? null : String(selectedId);
    var roving = rovingId === null || rovingId === undefined ? null : String(rovingId);
    var fallback = -1;
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i] && rows[i].id !== undefined ? String(rows[i].id) : null;
      if (id !== null && id === selected) return i;
      if (id !== null && id === roving && fallback < 0) fallback = i;
    }
    return fallback >= 0 ? fallback : 0;
  },

  getCollapseCommand: function(row, key) {
    if (!row || !row.hasChildren) return null;
    if (key === 'ArrowLeft' && !row.isCollapsed) return 'collapse';
    if (key === 'ArrowRight' && row.isCollapsed) return 'expand';
    return null;
  },

  toggleSelection: function(selection, taskId) {
    var ids = Array.isArray(selection) ? selection.slice() : [];
    if (taskId === null || taskId === undefined) return ids;
    var id = String(taskId);
    var index = ids.indexOf(id);
    if (index === -1) ids.push(id);
    else ids.splice(index, 1);
    return ids;
  },

  getRangeSelection: function(rows, anchorIndex, targetIndex) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    var anchor = Number(anchorIndex);
    var target = Number(targetIndex);
    if (!isFinite(anchor)) anchor = target;
    if (!isFinite(target)) target = anchor;
    anchor = Math.max(0, Math.min(rows.length - 1, Math.floor(anchor)));
    target = Math.max(0, Math.min(rows.length - 1, Math.floor(target)));
    var start = Math.min(anchor, target);
    var end = Math.max(anchor, target);
    var ids = [];
    for (var i = start; i <= end; i++) {
      if (rows[i] && rows[i].id !== undefined && !rows[i].isGroupHeader) ids.push(String(rows[i].id));
    }
    return ids;
  },

  applyClickSelection: function(rows, selection, anchorIndex, targetIndex, modifiers) {
    var options = modifiers || {};
    var list = Array.isArray(rows) ? rows : [];
    var target = Number(targetIndex);
    if (!isFinite(target)) target = -1;
    target = Math.floor(target);
    if (target < 0 || target >= list.length) {
      return { selection: [], anchorIndex: -1, primaryId: null };
    }
    var targetId = list[target] && list[target].id !== undefined ? String(list[target].id) : null;
    var anchor = Number(anchorIndex);
    if (!isFinite(anchor)) anchor = target;
    anchor = Math.floor(anchor);

    if (options.shift) {
      return {
        selection: this.getRangeSelection(list, anchor, target),
        anchorIndex: anchor,
        primaryId: targetId
      };
    }

    if (options.toggle) {
      var toggled = this.toggleSelection(selection, targetId);
      var primary = targetId;
      if (toggled.indexOf(targetId) === -1) {
        primary = toggled.length ? toggled[toggled.length - 1] : null;
      }
      return { selection: toggled, anchorIndex: target, primaryId: primary };
    }

    return {
      selection: targetId === null ? [] : [targetId],
      anchorIndex: target,
      primaryId: targetId
    };
  },

  getBulkStatusTargets: function(selection, fallbackTaskId) {
    var ids = [];
    if (selection && typeof selection.forEach === 'function') {
      selection.forEach(function(id) {
        if (id === null || id === undefined) return;
        var value = String(id);
        if (ids.indexOf(value) === -1) ids.push(value);
      });
    }
    if (ids.length === 0 && fallbackTaskId !== null && fallbackTaskId !== undefined) {
      ids.push(String(fallbackTaskId));
    }
    return ids;
  },

  // ---- 列状态与持久化 ----

  setColumns: function(saved) {
    var config = _gridColumnConfig();
    this.columns = config ? config.normalize(saved) : this._normalizeColumns(saved);
    return this.columns;
  },

  // 项目切换后必须按新项目的 settings.columns 重新载入列状态，
  // 否则启动时读到的上一个项目列设置会残留到后续项目的表格。
  reloadColumnsForCurrentProject: function() {
    this.setColumns(this._readSavedColumns());
    this._columnsInitialized = true;
    this.renderHeader();
    return this.columns;
  },

  getColumnState: function() {
    var config = _gridColumnConfig();
    var columns = this.columns || this.defaultColumns();
    if (config) return config.getState(columns);
    return columns.map(function(col) {
      return { key: col.key, width: col.width, visible: col.visible !== false };
    });
  },

  setColumnWidth: function(key, width) {
    var col = this._findColumn(key);
    if (!col) return null;
    col.width = this.clampColumnWidth(col, width);
    this._repaint();
    return col.width;
  },

  setColumnVisible: function(key, visible) {
    var col = this._findColumn(key);
    if (!col) return null;
    col.visible = visible !== false;
    this._repaint();
    return col.visible;
  },

  moveTo: function(key, targetIndex) {
    var config = _gridColumnConfig();
    var columns = this.columns || this.defaultColumns();
    if (config && typeof config.moveTo === 'function') {
      this.columns = config.moveTo(columns, key, targetIndex);
    } else {
      var list = (columns || []).slice();
      var fromIndex = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].key === key) { fromIndex = i; break; }
      }
      if (fromIndex !== -1) {
        var item = list.splice(fromIndex, 1)[0];
        var target = Number(targetIndex);
        if (!isFinite(target)) target = 0;
        if (target < 0) target = 0;
        if (target >= list.length) target = list.length;
        list.splice(target, 0, item);
        this.columns = list;
      }
    }
    this._repaint();
    return this.columns;
  },

  moveColumn: function(key, offset) {
    var current = this.columns || this.defaultColumns();
    var config = _gridColumnConfig();
    var next = config
      ? config.moveColumn(current, key, offset)
      : this._moveColumnFallback(current, key, offset);
    var unchanged = next.length === current.length;
    if (unchanged) {
      for (var i = 0; i < next.length; i++) {
        if (next[i] !== current[i]) {
          unchanged = false;
          break;
        }
      }
    }
    if (unchanged) return false;
    this.columns = next;
    this._repaint();
    return true;
  },

  _findColumn: function(key) {
    var list = this.columns || this.defaultColumns();
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i];
    }
    return null;
  },

  _findVisibleColumn: function(key) {
    var visible = this.getVisibleColumns();
    for (var i = 0; i < visible.length; i++) {
      if (visible[i].key === key) return visible[i];
    }
    return null;
  },

  _normalizeColumns: function(saved) {
    var defaults = this.defaultColumns();
    if (!Array.isArray(saved)) return defaults;
    var seen = [];
    var overrides = {};
    saved.forEach(function(item) {
      if (!item || typeof item.key !== 'string') return;
      var known = false;
      for (var i = 0; i < defaults.length; i++) {
        if (defaults[i].key === item.key) known = true;
      }
      if (!known || seen.indexOf(item.key) !== -1) return;
      seen.push(item.key);
      overrides[item.key] = item;
    });
    var result = [];
    var self = this;
    seen.forEach(function(key) {
      var base = null;
      for (var i = 0; i < defaults.length; i++) {
        if (defaults[i].key === key) base = defaults[i];
      }
      result.push(self._mergeColumn(base, overrides[key]));
    });
    defaults.forEach(function(base) {
      if (seen.indexOf(base.key) === -1) result.push(self._mergeColumn(base, null));
    });
    return result;
  },

  _mergeColumn: function(base, override) {
    var merged = _cloneGridColumn(base);
    if (override) {
      merged.width = this.clampColumnWidth(base, override.width);
      merged.visible = override.visible !== false;
    }
    return merged;
  },

  _moveColumnFallback: function(columns, key, offset) {
    var list = (columns || []).slice();
    var index = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) {
        index = i;
        break;
      }
    }
    var step = Number(offset);
    if (index === -1 || !isFinite(step) || step === 0) return list;
    var target = index + (step > 0 ? 1 : -1);
    if (target < 0 || target >= list.length) return list;
    var moved = list.splice(index, 1)[0];
    list.splice(target, 0, moved);
    return list;
  },

  _readSavedColumns: function() {
    if (typeof TaskManager === 'undefined' || !TaskManager) return null;
    if (!TaskManager.data || !TaskManager.data.settings) return null;
    if (typeof TaskManager.getSetting !== 'function') return null;
    return TaskManager.getSetting('columns');
  },

  _persistColumns: function() {
    if (typeof TaskManager === 'undefined' || !TaskManager) return;
    if (!TaskManager.data || !TaskManager.data.settings) return;
    if (typeof TaskManager.setSetting !== 'function') return;
    TaskManager.setSetting('columns', this.getColumnState());
  },

  // ---- 初始化与渲染 ----

  init: function(options) {
    options = options || {};
    if (!this._columnsInitialized) {
      var saved = options.columns !== undefined ? options.columns : this._readSavedColumns();
      this.columns = this.setColumns(saved);
      this._columnsInitialized = true;
    }

    var doc = this._document();
    this.header = options.header || (doc ? doc.getElementById('grid-header') : null);
    this.body = options.body || (doc ? doc.getElementById('grid-body') : null);

    this._initGridStructure();
    this._bindEvents();
    this.renderHeader();
    this.render(this.rows);
    return this;
  },

  render: function(rows) {
    this.rows = Array.isArray(rows) ? rows : [];
    this._progressById = this._computeProgress(this.rows);
    this._statusById = this._computeStatus(this.rows);
    this.renderHeader();
    this.renderBody();
    this._updateGridAria();
    this.syncHeader();
    this._scheduleHeaderSync();
    return this;
  },

  // 优先使用 TaskManager 的工作日权重汇总，缺失时退回 Progress 的自然日口径
  _computeProgress: function(rows) {
    if (typeof TaskManager !== 'undefined' && TaskManager &&
        typeof TaskManager.computeRowProgress === 'function') {
      return TaskManager.computeRowProgress(rows);
    }
    if (typeof Progress !== 'undefined' && Progress &&
        typeof Progress.computeRowProgress === 'function') {
      return Progress.computeRowProgress(rows, function(id) {
        return TaskManager.getChildren(id);
      });
    }
    return null;
  },

  _computeStatus: function(rows) {
    if (typeof TaskManager !== 'undefined' && TaskManager &&
        typeof TaskManager.computeRowStatus === 'function') {
      return TaskManager.computeRowStatus(rows);
    }
    if (typeof Progress !== 'undefined' && Progress &&
        typeof Progress.computeRowStatus === 'function') {
      return Progress.computeRowStatus(rows, function(id) {
        return TaskManager.getChildren(id);
      });
    }
    return null;
  },

  _initGridStructure: function() {
    if (this.header && this.header.setAttribute) this.header.setAttribute('role', 'rowgroup');
    if (this.body && this.body.setAttribute) this.body.setAttribute('role', 'rowgroup');
    var root = this.body && this.body.parentElement ? this.body.parentElement : null;
    this._gridRoot = root;
    if (!root || !root.setAttribute) return;
    root.setAttribute('role', 'grid');
    root.setAttribute('aria-multiselectable', 'true');
    if (root.getAttribute && !root.getAttribute('aria-label')) {
      root.setAttribute('aria-label', '任务表格');
    }
  },

  _updateGridAria: function() {
    var root = this._gridRoot;
    if (!root || !root.setAttribute) return;
    root.setAttribute('aria-rowcount', String(this.rows.length + 1));
    root.setAttribute('aria-colcount', String(this.getVisibleColumns().length));
  },

  renderHeader: function() {
    if (!this.header) return;
    var self = this;
    var columns = this.getVisibleColumns();
    var expanded = this._panel ? 'true' : 'false';
    var html = '<button type="button" class="grid-columns-btn" aria-haspopup="dialog" aria-expanded="'
      + expanded + '" title="配置列">列</button>'
      + '<div class="grid-header" role="row" aria-rowindex="1" style="width:' + this.getColumnsWidth() + 'px">';
    columns.forEach(function(col, index) {
      html += '<div class="grid-header-cell cell-' + col.key + '" data-column-key="' + col.key
        + '" role="columnheader" aria-colindex="' + (index + 1) + '" style="' + self._columnStyle(col) + '">'
        + '<span class="grid-header-label">' + self.escapeHtml(col.label) + '</span>'
        + '<span class="grid-col-resizer" role="separator" aria-orientation="vertical"'
        + ' data-column-resize="' + col.key + '" aria-label="调整' + self.escapeHtml(col.label)
        + '列宽" style="width:' + self.RESIZER_WIDTH + 'px"></span>'
        + '</div>';
    });
    html += '</div>';
    this.header.innerHTML = html;
  },

  renderBody: function() {
    if (!this.body) return;
    var focus = this._captureFocus();
    if (focus && focus.taskId) this._rovingTaskId = focus.taskId;
    if (this._editing) this._editing = null;
    if (this.getVisibleColumns().length === 0) {
      this.body.innerHTML = '<div class="grid-empty grid-all-hidden-hint">所有列均已隐藏，可通过 <button type="button" class="btn btn-sm btn-restore-columns" data-action="open-column-settings">恢复列设置</button> 或顶部工具栏重新显示</div>';
      var restoreBtn = this.body.querySelector('[data-action="open-column-settings"]');
      if (restoreBtn) {
        var selfRestore = this;
        restoreBtn.addEventListener('click', function() {
          selfRestore._showColumnPanel();
        });
      }
      return;
    }
    if (this.rows.length === 0) {
      this.body.innerHTML = '<div class="grid-empty">暂无任务</div>';
      return;
    }
    var activeIndex = this._activeIndexForRender();
    var html = '<div class="grid-table" role="presentation" style="width:' + this.getColumnsWidth() + 'px">';
    for (var i = 0; i < this.rows.length; i++) {
      html += this.renderRow(this.rows[i], i, activeIndex);
    }
    html += '</div>';
    this.body.innerHTML = html;
    this._restoreFocus(focus);
  },

  _activeIndexForRender: function() {
    var index = this.getActiveRowIndex(this.rows, this.selectedId, this._rovingTaskId);
    if (index >= 0 && !this._isSelectableIndex(index)) {
      index = this._nearestSelectableIndex(index, 1);
    }
    return index;
  },

  _isSelectableIndex: function(index) {
    var row = this.rows[index];
    return !!row && !row.isGroupHeader;
  },

  _nearestSelectableIndex: function(index, direction) {
    var count = this.rows.length;
    if (count === 0) return -1;
    var start = Number(index);
    if (!isFinite(start)) start = 0;
    start = Math.floor(start);
    if (start < 0) start = 0;
    if (start >= count) start = count - 1;
    var step = direction < 0 ? -1 : 1;
    for (var i = start; i >= 0 && i < count; i += step) {
      if (this._isSelectableIndex(i)) return i;
    }
    for (var j = start; j >= 0 && j < count; j -= step) {
      if (this._isSelectableIndex(j)) return j;
    }
    return -1;
  },

  _captureFocus: function() {
    var doc = this._document();
    var active = doc && doc.activeElement;
    if (!active || !this.body || !this.body.contains(active) || !active.closest) return null;
    var row = active.closest('.grid-row');
    if (!row) return null;
    var cell = active.closest('[data-column-key]');
    return {
      taskId: row.getAttribute('data-task-id'),
      key: cell ? cell.getAttribute('data-column-key') : null,
      editing: !!(this._editing && this._editing.control === active),
      onExpander: !!active.closest('.grid-expander')
    };
  },

  _findRowNode: function(taskId) {
    if (!this.body || taskId === null || taskId === undefined) return null;
    var id = String(taskId);
    var rows = this.body.querySelectorAll('.grid-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-task-id') === id) return rows[i];
    }
    return null;
  },

  _focusRowNode: function(taskId) {
    var row = this._findRowNode(taskId);
    if (!row) return;
    this._syncRoving(taskId);
    try {
      row.focus({ preventScroll: true });
    } catch (err) {
      row.focus();
    }
  },

  _restoreFocus: function(focus) {
    if (!focus || !focus.taskId || !this.body) return;
    this._rovingTaskId = focus.taskId;
    if (focus.editing && focus.key && this._startEdit(focus.taskId, focus.key)) return;
    var row = this._findRowNode(focus.taskId);
    if (!row) return;
    this._syncRoving(focus.taskId);
    var target = row;
    if (focus.onExpander) {
      var expander = row.querySelector('button.grid-expander');
      if (expander) target = expander;
    }
    try {
      target.focus({ preventScroll: true });
    } catch (err) {
      target.focus();
    }
  },

  renderRow: function(row, index, activeIndex) {
    if (row && row.isGroupHeader) return this.renderGroupRow(row, index);

    var self = this;
    var columns = this.getVisibleColumns();
    var rowIndex = typeof index === 'number' && isFinite(index) ? Math.floor(index) : 0;
    var active = typeof activeIndex === 'number' ? activeIndex : this._activeIndexForRender();
    var selected = this._isSelected(row.id);
    var classes = ['grid-row'];
    if (row.isSummary) classes.push('is-summary');
    if (row.isCollapsed) classes.push('is-collapsed');
    if (selected) classes.push('selected');
    if (row.id === this.hoveredId) classes.push('hovered');
    if (this.isCritical(row.id)) classes.push('critical');

    var html = '<div class="' + classes.join(' ') + '"'
      + ' data-task-id="' + this.escapeHtml(row.id) + '"'
      + ' data-depth="' + row.depth + '"'
      + ' role="row" aria-rowindex="' + (rowIndex + 2) + '"'
      + ' aria-selected="' + (selected ? 'true' : 'false') + '"'
      + ' tabindex="' + this.getRovingTabIndex(rowIndex, active) + '"'
      + ' style="height:' + this.ROW_HEIGHT + 'px">';
    columns.forEach(function(col, columnIndex) {
      html += '<div class="grid-cell cell-' + col.key + '" data-column-key="' + col.key
        + '" role="gridcell" aria-colindex="' + (columnIndex + 1) + '" style="' + self._columnStyle(col) + '">'
        + self.renderCell(row, col, rowIndex === active)
        + '</div>';
    });
    html += '</div>';
    return html;
  },

  renderGroupRow: function(row, index) {
    var rowIndex = typeof index === 'number' && isFinite(index) ? Math.floor(index) : 0;
    var label = row && row.label !== null && row.label !== undefined ? String(row.label) : '';
    var count = row && typeof row.count === 'number' ? row.count : 0;
    var key = row && row.groupKey !== null && row.groupKey !== undefined ? String(row.groupKey) : '';
    return '<div class="grid-row grid-group-row"'
      + ' data-group-key="' + this.escapeHtml(key) + '"'
      + ' role="row" aria-rowindex="' + (rowIndex + 2) + '"'
      + ' aria-selected="false" tabindex="-1"'
      + ' style="height:' + this.ROW_HEIGHT + 'px;width:' + this.getColumnsWidth() + 'px">'
      + '<span class="grid-group-label">' + this.escapeHtml(label)
      + '<span class="grid-group-count">' + count + '</span></span>'
      + '</div>';
  },

  renderCell: function(row, column, isActive) {
    var task = row.task || {};
    var statusValue = task.status;
    if (row.isSummary && this._statusById && this._statusById.has(row.id)) {
      statusValue = this._statusById.get(row.id);
    }
    if (column.type === 'name') return this.renderNameCell(row, isActive);
    if (column.type === 'status') return this.renderStatusCell(statusValue);
    if (column.type === 'progress') {
      var progressValue = task.progress;
      if (row.isSummary && this._progressById && this._progressById.has(row.id)) {
        progressValue = this._progressById.get(row.id);
      }
      return this.renderProgressCell(progressValue, statusValue);
    }
    if (column.type === 'date' && column.builtin !== false) {
      var dateValue = column.key === 'startDate' || column.key === 'endDate' ? row[column.key] : task[column.key];
      var dateText = this.formatDate(dateValue);
      return '<span class="grid-cell-text">' + this.escapeHtml(dateText) + '</span>';
    }
    if (column.builtin === false) {
      var customVal = task.customFields ? task.customFields[column.key] : undefined;
      if (customVal === null || customVal === undefined || customVal === '') {
        return '<span class="grid-cell-text"></span>';
      }
      if (column.type === 'select' && Array.isArray(column.options)) {
        for (var i = 0; i < column.options.length; i++) {
          if (column.options[i] && String(column.options[i].id) === String(customVal)) {
            var optLabel = column.options[i].label;
            return '<span class="grid-cell-text" title="' + this.escapeHtml(optLabel) + '">' + this.escapeHtml(optLabel) + '</span>';
          }
        }
      }
      var displayStr = String(customVal);
      return '<span class="grid-cell-text" title="' + this.escapeHtml(displayStr) + '">' + this.escapeHtml(displayStr) + '</span>';
    }
    var text = task[column.key] === null || task[column.key] === undefined ? '' : String(task[column.key]);
    return '<span class="grid-cell-text" title="' + this.escapeHtml(text) + '">' + this.escapeHtml(text) + '</span>';
  },

  renderNameCell: function(row, isActive) {
    var task = row.task || {};
    var arrowClass = 'grid-expander';
    if (!row.hasChildren) {
      arrowClass += ' empty';
    } else if (row.isCollapsed) {
      arrowClass += ' collapsed';
    }
    var name = task.name === null || task.name === undefined ? '' : String(task.name);
    var expander;
    if (row.hasChildren) {
      var action = row.isCollapsed ? '展开' : '折叠';
      expander = '<button type="button" class="' + arrowClass + '"'
        + ' aria-expanded="' + (row.isCollapsed ? 'false' : 'true') + '"'
        + ' aria-label="' + this.escapeHtml(action + ' ' + name) + '"'
        + ' tabindex="' + (isActive ? 0 : -1) + '">▼</button>';
    } else {
      expander = '<span class="' + arrowClass + '" aria-hidden="true">▼</span>';
    }
    var collabBadge = '';
    if (typeof RealtimeClient !== 'undefined' && RealtimeClient && typeof RealtimeClient.getCollaboratorForTask === 'function') {
      var collab = RealtimeClient.getCollaboratorForTask(row.id);
      if (collab) {
        collabBadge = '<span class="grid-collaborator-badge" style="border-color:' + this.escapeHtml(collab.avatarColor) + ';color:' + this.escapeHtml(collab.avatarColor) + ';" title="' + this.escapeHtml(collab.name) + ' 正在协同编辑">' + this.escapeHtml(collab.name) + ' 在此</span>';
      }
    }
    return '<span class="grid-indent" style="width:' + this.getIndent(row.depth) + 'px" aria-hidden="true"></span>'
      + expander
      + '<span class="grid-color-dot" style="background:' + this.safeColor(this._effectiveColor(task)) + '"></span>'
      + '<span class="grid-name" title="' + this.escapeHtml(name) + '">' + this.escapeHtml(name) + '</span>'
      + collabBadge
      + (task.locked ? '<span class="grid-lock-badge" title="日期已锁定，自动排期将跳过该任务">锁</span>' : '')
      + this.renderBaselineBadge(row);
  },

  renderStatusCell: function(status) {
    var meta = this.getStatusMeta(status);
    return '<span class="status-badge status-' + meta.key + '">'
      + '<span class="status-dot"></span>' + meta.label
      + '</span>';
  },

  renderProgressCell: function(value, status) {
    var numeric = this.getProgressValue(value);
    if (numeric === null) {
      return '<span class="grid-cell-text"></span>';
    }
    var meta = this.getStatusMeta(status);
    return '<span class="grid-progress">'
      + '<span class="grid-progress-track">'
      + '<span class="grid-progress-fill status-' + meta.key + '" style="width:' + numeric + '%"></span>'
      + '</span>'
      + '<span class="grid-progress-text">' + numeric + '%</span>'
      + '</span>';
  },

  syncHeader: function() {
    if (!this.header) return;
    var inner = this.header.querySelector('.grid-header');
    if (!inner) return;
    var left = this.body ? this.body.scrollLeft : 0;
    inner.style.transform = 'translateX(' + (-left) + 'px)';
  },

  // 列宽缩小后 scrollLeft 可能在下一帧才被浏览器钳制，补一次同步
  _scheduleHeaderSync: function() {
    if (typeof requestAnimationFrame !== 'function') return;
    var self = this;
    requestAnimationFrame(function() { self.syncHeader(); });
  },

  // ---- 选中与 hover：只切换 class ----

  _ensureSelection: function() {
    if (!this.selection || typeof this.selection.has !== 'function') {
      this.selection = new Set();
    }
    return this.selection;
  },

  _isSelected: function(taskId) {
    if (taskId === null || taskId === undefined) return false;
    return this._ensureSelection().has(String(taskId));
  },

  _selectionList: function() {
    var ids = [];
    this._ensureSelection().forEach(function(id) { ids.push(id); });
    return ids;
  },

  _rowIndex: function(taskId) {
    if (taskId === null || taskId === undefined) return -1;
    var id = String(taskId);
    for (var i = 0; i < this.rows.length; i++) {
      if (this.rows[i] && String(this.rows[i].id) === id) return i;
    }
    return -1;
  },

  _anchorIndex: function() {
    var index = this._rowIndex(this._anchorId);
    if (index >= 0) return index;
    return this._rowIndex(this.selectedId);
  },

  updateSelection: function(taskId) {
    var id = taskId === null || taskId === undefined ? null : String(taskId);
    var selection = this._ensureSelection();
    if (id === null) {
      selection.clear();
      this.selectedId = null;
    } else {
      if (!selection.has(id)) {
        this.selection = new Set([id]);
      }
      this.selectedId = id;
      if (this._rowIndex(id) >= 0) this._rovingTaskId = id;
      if (typeof RealtimeClient !== 'undefined' && RealtimeClient && typeof RealtimeClient.sendHeartbeat === 'function') {
        RealtimeClient.sendHeartbeat(id);
      }
    }
    this._syncSelectionDom();
  },

  _syncSelectionDom: function() {
    if (!this.body) return;
    var selection = this._ensureSelection();
    var rows = this.body.querySelectorAll('.grid-row');
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].getAttribute('data-task-id');
      var selected = id !== null && selection.has(id);
      rows[i].classList.toggle('selected', selected);
      rows[i].setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    this._syncRoving();
  },

  _syncRoving: function(preferredId) {
    if (!this.body) return;
    var nodes = this.body.querySelectorAll('.grid-row');
    var candidate = preferredId;
    if (candidate === null || candidate === undefined) {
      candidate = this.selectedId || this._rovingTaskId;
    }
    var activeIndex = this._rowIndex(candidate);
    if (activeIndex < 0 && nodes.length > 0) activeIndex = 0;
    if (activeIndex >= nodes.length) activeIndex = nodes.length - 1;
    if (activeIndex >= 0 && !this._isSelectableIndex(activeIndex)) {
      activeIndex = this._nearestSelectableIndex(activeIndex, 1);
    }
    for (var i = 0; i < nodes.length; i++) {
      var tabIndex = this.getRovingTabIndex(i, activeIndex);
      nodes[i].setAttribute('tabindex', String(tabIndex));
      var expander = nodes[i].querySelector('button.grid-expander');
      if (expander) expander.setAttribute('tabindex', String(tabIndex));
    }
    if (activeIndex >= 0 && nodes[activeIndex]) {
      this._rovingTaskId = nodes[activeIndex].getAttribute('data-task-id');
    }
  },

  updateHover: function(taskId) {
    taskId = taskId === null || taskId === undefined ? null : String(taskId);
    this.hoveredId = taskId;
    if (!this.body) return;
    var rows = this.body.querySelectorAll('.grid-row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('hovered', rows[i].getAttribute('data-task-id') === taskId);
    }
  },

  // ---- 事件委托 ----

  _bindEvents: function() {
    var self = this;
    if (this.body && !this._bodyBound) {
      this.body.addEventListener('scroll', function() { self.syncHeader(); });
      this.body.addEventListener('click', function(e) { self._onClick(e); });
      this.body.addEventListener('dblclick', function(e) { self._onDoubleClick(e); });
      this.body.addEventListener('contextmenu', function(e) { self._onContextMenu(e); });
      this.body.addEventListener('mouseover', function(e) { self._onMouseOver(e); });
      this.body.addEventListener('mouseout', function(e) { self._onMouseOut(e); });
      this.body.addEventListener('mouseleave', function() {
        if (self.hoveredId !== null) self._setHover(null);
      });
      this.body.addEventListener('keydown', function(e) { self._onKeyDown(e); });
      this._bodyBound = true;
    }
    if (this.header && !this._headerBound) {
      this.header.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('.grid-columns-btn')) {
          self._toggleColumnPanel(e.target.closest('.grid-columns-btn'));
        }
      });
      this.header.addEventListener('pointerdown', function(e) {
        self._onHeaderPointerDown(e);
      });
      this._headerBound = true;
    }

    var doc = this._document();
    if (doc && !this._docBound) {
      doc.addEventListener('click', function(e) {
        self._hideLocalMenu();
        if (!self._panel) return;
        if (e && e.__gridPaneInnerClick) return;
        if (self._panel.contains(e.target)) return;
        if (e.target && e.target.closest && (e.target.closest('.grid-columns-btn') || e.target.closest('#btn-column-settings') || e.target.closest('[data-action="open-column-settings"]'))) return;
        self._hideColumnPanel();
      });
      doc.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          self._hideLocalMenu();
          self._hideColumnPanel({ restoreFocus: true });
        }
      });
      this._docBound = true;
    }
  },

  _onClick: function(e) {
    if (this._editing) {
      var editingCell = e.target && e.target.closest ? e.target.closest('.grid-cell.is-editing') : null;
      if (editingCell) return;
    }
    var row = this._closestRowInEvent(e.target);
    if (!row) return;
    if (row.classList && row.classList.contains('grid-group-row')) return;
    var taskId = row.getAttribute('data-task-id');
    var expander = e.target.closest ? e.target.closest('.grid-expander') : null;
    if (expander) {
      e.stopPropagation();
      this.toggleCollapsed(taskId);
      return;
    }
    var cell = e.target.closest ? e.target.closest('[data-column-key]') : null;
    if (cell) this._lastEdit = { taskId: taskId, key: cell.getAttribute('data-column-key') };

    var index = this._rowIndex(taskId);
    var result = this.applyClickSelection(this.rows, this._selectionList(), this._anchorIndex(), index, {
      toggle: !!(e.ctrlKey || e.metaKey),
      shift: !!e.shiftKey
    });
    this.selection = new Set(result.selection);
    this._anchorId = result.anchorIndex >= 0 && this.rows[result.anchorIndex]
      ? String(this.rows[result.anchorIndex].id) : null;
    this.selectedId = result.primaryId;
    this._rovingTaskId = taskId;
    this._syncSelectionDom();
    this._dispatchSelected(result.primaryId);
    this._syncRoving(taskId);

    if (row.focus) {
      try {
        row.focus({ preventScroll: true });
      } catch (err) {
        row.focus();
      }
    }
  },

  _onDoubleClick: function(e) {
    var row = this._closestRowInEvent(e.target);
    if (!row) return;
    if (row.classList && row.classList.contains('grid-group-row')) return;
    if (e.target.closest && e.target.closest('.grid-expander')) return;
    var taskId = row.getAttribute('data-task-id');
    var cell = e.target.closest ? e.target.closest('[data-column-key]') : null;
    var key = cell ? cell.getAttribute('data-column-key') : null;
    if (key) this._lastEdit = { taskId: taskId, key: key };
    if (key && this._startEdit(taskId, key)) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      return;
    }
    if (e.stopPropagation) e.stopPropagation();
    this.updateSelection(taskId);
    this._dispatchSelected(taskId);
    var app = this._app();
    if (app && typeof app.showEditTask === 'function') {
      app.showEditTask(taskId);
    }
  },

  _onContextMenu: function(e) {
    var row = this._closestRowInEvent(e.target);
    if (!row) return;
    if (row.classList && row.classList.contains('grid-group-row')) return;
    e.preventDefault();
    this._hideColumnPanel();
    var taskId = row.getAttribute('data-task-id');
    this.updateSelection(taskId);
    this._dispatchSelected(taskId);
    this.showContextMenu(taskId, e.clientX, e.clientY);
  },

  _onMouseOver: function(e) {
    var row = this._closestRow(e.target);
    if (!row) return;
    if (e.relatedTarget && row.contains(e.relatedTarget)) return;
    var taskId = row.getAttribute('data-task-id');
    if (!taskId) return;
    if (taskId === this.hoveredId) return;
    this._setHover(taskId);
  },

  _onMouseOut: function(e) {
    var row = this._closestRow(e.target);
    if (!row) return;
    if (e.relatedTarget && row.contains(e.relatedTarget)) return;
    var taskId = row.getAttribute('data-task-id');
    if (!taskId) return;
    if (taskId !== this.hoveredId) return;
    this._setHover(null);
  },

  _onKeyDown: function(e) {
    if (this._editing) return;

    var expander = e.target && e.target.closest ? e.target.closest('.grid-expander') : null;
    if (expander) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        var expanderRow = this._closestRow(expander);
        if (expanderRow) {
          e.preventDefault();
          e.stopPropagation();
          this.toggleCollapsed(expanderRow.getAttribute('data-task-id'));
        }
      }
      return;
    }

    var row = this._closestRow(e.target);
    if (!row) return;
    var taskId = row.getAttribute('data-task-id');
    if (!taskId) return;
    var index = this._rowIndex(taskId);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      var next = this.getNavigationIndex(index, e.key, this.rows.length);
      if (next >= 0 && next !== index) this._moveSelection(next, index);
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      var data = index >= 0 ? this.rows[index] : null;
      if (this.getCollapseCommand(data, e.key)) {
        e.preventDefault();
        this._selectRowForKeyboard(taskId);
        this.toggleCollapsed(taskId);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      var key = this._preferredEditKey(taskId, e.target);
      if (key && this._startEdit(taskId, key)) return;
      var app = this._app();
      if (app && typeof app.showEditTask === 'function') app.showEditTask(taskId);
      return;
    }

    if (e.key === 'Escape') {
      this._hideColumnPanel();
      this._hideLocalMenu();
    }
  },

  _selectRowForKeyboard: function(taskId) {
    if (taskId === null || taskId === undefined) return;
    var id = String(taskId);
    this.selection = new Set([id]);
    this._anchorId = id;
    this.selectedId = id;
    this._rovingTaskId = id;
    this._syncSelectionDom();
    this._dispatchSelected(id);
  },

  _moveSelection: function(index, fromIndex) {
    var reference = typeof fromIndex === 'number' && isFinite(fromIndex) ? fromIndex : index;
    var direction = index < reference ? -1 : 1;
    var target = this._nearestSelectableIndex(index, direction);
    if (target < 0) return;
    var row = this.rows[target];
    if (!row) return;
    this._selectRowForKeyboard(row.id);
    this._focusRowAt(target);
  },

  _focusRowAt: function(index) {
    if (!this.body) return;
    var nodes = this.body.querySelectorAll('.grid-row');
    var node = nodes[index];
    if (!node) return;
    this._syncRoving(node.getAttribute('data-task-id'));
    try {
      node.focus({ preventScroll: true });
    } catch (err) {
      node.focus();
    }
    if (node.scrollIntoView) {
      try {
        node.scrollIntoView({ block: 'nearest' });
      } catch (err2) {}
    }
  },

  _closestRow: function(target) {
    if (!target || !target.closest) return null;
    var row = target.closest('.grid-row');
    if (!row || !this.body || !this.body.contains(row)) return null;
    return row;
  },

  // 点击/双击时允许命中刚刚被重渲染替换掉的旧节点，避免失焦提交后丢失选中
  _closestRowInEvent: function(target) {
    if (!target || !target.closest) return null;
    return target.closest('.grid-row');
  },

  _setHover: function(taskId) {
    this.updateHover(taskId);
    var workbench = this._workbench();
    if (workbench && typeof workbench.setHovered === 'function') {
      workbench.setHovered(taskId);
      return;
    }
    var app = this._app();
    if (app && typeof app.onTaskHovered === 'function') {
      app.onTaskHovered(taskId);
    }
  },

  _dispatchSelected: function(taskId) {
    var workbench = this._workbench();
    if (workbench && typeof workbench.setSelected === 'function') {
      workbench.setSelected(taskId);
      return;
    }
    var app = this._app();
    if (app && typeof app.onTaskSelected === 'function') {
      app.onTaskSelected(taskId);
    }
  },

  toggleCollapsed: function(taskId) {
    var workbench = this._workbench();
    if (workbench && typeof workbench.toggleCollapsed === 'function') {
      workbench.toggleCollapsed(taskId);
      return;
    }
    var app = this._app();
    if (app && typeof app.renderAll === 'function') app.renderAll();
  },

  // ---- 列宽拖拽 ----

  _onHeaderPointerDown: function(e) {
    var resizer = e.target && e.target.closest ? e.target.closest('[data-column-resize]') : null;
    if (!resizer) return;
    this._startColumnResize(e, resizer.getAttribute('data-column-resize'), resizer);
  },

  _startColumnResize: function(event, key, resizer) {
    var column = this._findColumn(key);
    if (!column) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    var self = this;
    var doc = this._document();
    var startX = event.clientX;
    var startWidth = column.width;
    var moved = false;

    resizer.classList.add('dragging');
    if (doc && doc.body) doc.body.classList.add('wb-resizing');

    function onMove(moveEvent) {
      moved = true;
      self._applyColumnWidth(key, startWidth + (moveEvent.clientX - startX));
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      resizer.classList.remove('dragging');
      if (doc && doc.body) doc.body.classList.remove('wb-resizing');
      if (moved) self._persistColumns();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  },

  _applyColumnWidth: function(key, width) {
    var col = this._findColumn(key);
    if (!col) return null;
    col.width = this.clampColumnWidth(col, width);

    var self = this;
    var selector = '[data-column-key="' + key + '"]';
    var nodes = [];
    if (this.header) nodes = nodes.concat(Array.prototype.slice.call(this.header.querySelectorAll(selector)));
    if (this.body) nodes = nodes.concat(Array.prototype.slice.call(this.body.querySelectorAll(selector)));
    nodes.forEach(function(node) {
      node.style.setProperty('--col-width', col.width + 'px');
      node.style.setProperty('--col-min', col.minWidth + 'px');
      node.style.width = col.width + 'px';
      node.style.flex = '0 0 ' + col.width + 'px';
      node.style.minWidth = col.minWidth + 'px';
    });

    var total = this.getColumnsWidth();
    var headerRow = this.header ? this.header.querySelector('.grid-header') : null;
    if (headerRow) headerRow.style.width = total + 'px';
    var table = this.body ? this.body.querySelector('.grid-table') : null;
    if (table) table.style.width = total + 'px';
    this.syncHeader();
    this._scheduleHeaderSync();
    return col.width;
  },

  // ---- 列配置面板 ----

  _toggleColumnPanel: function(trigger) {
    if (this._panel) {
      this._hideColumnPanel();
      return;
    }
    this._showColumnPanel(trigger, { toggle: true });
  },

  _showColumnPanel: function(trigger, options) {
    options = options || {};
    var doc = this._document();
    if (!doc || !doc.body || !this.header) return;
    if (!trigger || typeof trigger.getBoundingClientRect !== 'function') {
      trigger = this.header.querySelector('.grid-columns-btn');
    }
    if (this._panel) {
      if (options.toggle && this._panelTrigger === trigger) {
        this._hideColumnPanel();
        return;
      }
      this._hideColumnPanel({ restoreFocus: false });
    }
    this._panelTrigger = trigger || null;
    var self = this;
    var config = _gridColumnConfig();

    var currentProj = (typeof TaskManager !== 'undefined' && TaskManager) ? TaskManager.currentProject : null;
    var wsProj = (typeof Workspace !== 'undefined' && Workspace && typeof Workspace.currentProject === 'function')
      ? Workspace.currentProject()
      : null;
    this._capturedProjectId = currentProj
      ? currentProj.id
      : (wsProj ? wsProj.id : ((typeof Workspace !== 'undefined' && Workspace) ? Workspace.activeProjectId : null));

    this._columnDraft = config
      ? config.getState(this.columns || this.defaultColumns())
      : (this.columns || this.defaultColumns()).map(_cloneGridColumn);
    this._expandedOptKey = null;

    var panel = doc.createElement('div');
    panel.className = 'grid-column-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '列配置');

    panel.addEventListener('change', function(e) {
      var input = e.target;
      if (!input || !input.getAttribute) return;
      var visKey = input.getAttribute('data-draft-visible');
      if (visKey && self._columnDraft) {
        var col = config ? config.findColumn(self._columnDraft, visKey) : self._findDraftColumn(visKey);
        if (col) col.visible = !!input.checked;
      }
    });

    panel.addEventListener('input', function(e) {
      var input = e.target;
      if (!input || !input.getAttribute) return;
      var labelKey = input.getAttribute('data-draft-label');
      if (labelKey && self._columnDraft) {
        var col = config ? config.findColumn(self._columnDraft, labelKey) : self._findDraftColumn(labelKey);
        if (col) col.label = input.value;
      }
      var optId = input.getAttribute('data-opt-label');
      var optColKey = input.getAttribute('data-opt-col');
      if (optId && optColKey && self._columnDraft) {
        var sCol = config ? config.findColumn(self._columnDraft, optColKey) : self._findDraftColumn(optColKey);
        if (sCol && Array.isArray(sCol.options)) {
          for (var i = 0; i < sCol.options.length; i++) {
            if (String(sCol.options[i].id) === String(optId)) {
              sCol.options[i].label = input.value;
              break;
            }
          }
        }
      }
    });

    panel.addEventListener('click', function(e) {
      var target = e.target;
      if (!target) return;
      // 面板内部点击可能触发列表重渲染，使原节点脱离面板；标记该事件来源于面板内部，
      // 供 document 外部点击监听放行，避免误判为外部点击而关闭面板。
      if (e) e.__gridPaneInnerClick = true;

      if (target.id === 'grid-draft-cancel') {
        if (e.preventDefault) e.preventDefault();
        self._columnDraft = null;
        self._capturedProjectId = null;
        self._hideColumnPanel();
        return;
      }

      if (target.id === 'grid-draft-save') {
        if (e.preventDefault) e.preventDefault();
        self._saveDraft(panel);
        return;
      }

      var delColKey = target.getAttribute ? target.getAttribute('data-del-col') : null;
      if (delColKey) {
        if (e.preventDefault) e.preventDefault();
        var confirmed = true;
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          confirmed = window.confirm('确认删除该自定义列？此操作将在保存后清理活动任务及回收站中该列数据。');
        }
        if (confirmed) {
          // 草稿阶段仅从草稿列表中移除该列定义，绝对不立即清洗活动任务及回收站内存数据
          self._columnDraft = (self._columnDraft || []).filter(function(c) { return c && c.key !== delColKey; });
          self._renderPanelList(panel);
        }
        return;
      }

      var toggleOptKey = target.getAttribute ? target.getAttribute('data-toggle-opt') : null;
      if (toggleOptKey) {
        if (e.preventDefault) e.preventDefault();
        self._expandedOptKey = self._expandedOptKey === toggleOptKey ? null : toggleOptKey;
        self._renderPanelList(panel);
        return;
      }

      var addOptColKey = target.getAttribute ? target.getAttribute('data-add-opt') : null;
      if (addOptColKey) {
        if (e.preventDefault) e.preventDefault();
        var optInput = panel.querySelector('#grid-new-opt-' + addOptColKey);
        var optLabel = optInput ? optInput.value.trim() : '';
        if (optLabel) {
          var selCol = config ? config.findColumn(self._columnDraft, addOptColKey) : self._findDraftColumn(addOptColKey);
          if (selCol) {
            if (!Array.isArray(selCol.options)) selCol.options = [];
            selCol.options.push({
              id: 'opt-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
              label: optLabel
            });
            self._renderPanelList(panel);
          }
        }
        return;
      }

      var delOptId = target.getAttribute ? target.getAttribute('data-del-opt') : null;
      var delOptCol = target.getAttribute ? target.getAttribute('data-opt-col') : null;
      if (delOptId && delOptCol) {
        if (e.preventDefault) e.preventDefault();
        var cDef = config ? config.findColumn(self._columnDraft, delOptCol) : self._findDraftColumn(delOptCol);
        if (cDef && Array.isArray(cDef.options)) {
          cDef.options = cDef.options.filter(function(o) { return String(o.id) !== String(delOptId); });
          self._renderPanelList(panel);
        }
        return;
      }

      if (target.id === 'grid-add-col-btn') {
        if (e.preventDefault) e.preventDefault();
        var nameInput = panel.querySelector('#grid-new-col-name');
        var typeSelect = panel.querySelector('#grid-new-col-type');
        var colName = nameInput ? nameInput.value.trim() : '';
        if (!colName) {
          var errDiv = panel.querySelector('#grid-draft-error');
          if (errDiv) { errDiv.textContent = '列名称不能为空'; errDiv.style.display = 'block'; }
          return;
        }
        var uuidPart = (typeof DataStore !== 'undefined' && typeof DataStore.uuid === 'function')
          ? DataStore.uuid()
          : (Date.now() + '-' + Math.floor(Math.random() * 10000));
        var newKey = 'col-' + uuidPart;
        var newType = typeSelect ? typeSelect.value : 'text';
        var newColumn = {
          key: newKey,
          label: colName,
          width: 120,
          minWidth: 60,
          visible: true,
          type: newType,
          builtin: false
        };
        if (newType === 'select') newColumn.options = [];
        self._columnDraft.push(newColumn);
        self._renderPanelList(panel);
        return;
      }
    });

    panel.addEventListener('keydown', function(e) {
      if (!self._columnDraft) return;
      if (e.key === 'Escape') {
        self._hideColumnPanel({ restoreFocus: true });
        return;
      }
      var itemNode = e.target && e.target.closest ? e.target.closest('[data-column-item]') : null;
      if (!itemNode) return;
      var colKey = itemNode.getAttribute('data-column-item');
      if (e.altKey && e.key === 'ArrowUp') {
        if (e.preventDefault) e.preventDefault();
        var idx = self._draftIndex(colKey);
        if (idx > 0) {
          self._columnDraft = config ? config.moveTo(self._columnDraft, colKey, idx - 1) : self._moveColumnFallback(self._columnDraft, colKey, -1);
          self._renderPanelList(panel);
          var nextNode = panel.querySelector('[data-column-item="' + colKey + '"]');
          if (nextNode && nextNode.focus) nextNode.focus();
        }
      } else if (e.altKey && e.key === 'ArrowDown') {
        if (e.preventDefault) e.preventDefault();
        var idxD = self._draftIndex(colKey);
        if (idxD !== -1 && idxD < self._columnDraft.length - 1) {
          self._columnDraft = config ? config.moveTo(self._columnDraft, colKey, idxD + 1) : self._moveColumnFallback(self._columnDraft, colKey, 1);
          self._renderPanelList(panel);
          var nextNodeD = panel.querySelector('[data-column-item="' + colKey + '"]');
          if (nextNodeD && nextNodeD.focus) nextNodeD.focus();
        }
      }
    });

    panel.addEventListener('dragstart', function(e) {
      var handle = e.target && e.target.closest ? e.target.closest('[data-drag-key]') : null;
      if (handle) {
        self._dragColKey = handle.getAttribute('data-drag-key');
        if (e.dataTransfer && e.dataTransfer.setData) {
          e.dataTransfer.setData('text/plain', self._dragColKey);
        }
      }
    });

    panel.addEventListener('dragover', function(e) {
      if (e.preventDefault) e.preventDefault();
    });

    panel.addEventListener('drop', function(e) {
      if (e.preventDefault) e.preventDefault();
      var dropItem = e.target && e.target.closest ? e.target.closest('[data-column-item]') : null;
      if (dropItem && self._dragColKey && self._columnDraft) {
        var targetKey = dropItem.getAttribute('data-column-item');
        var targetIdx = self._draftIndex(targetKey);
        if (targetIdx !== -1) {
          self._columnDraft = config ? config.moveTo(self._columnDraft, self._dragColKey, targetIdx) : self._columnDraft;
          self._renderPanelList(panel);
        }
      }
      self._dragColKey = null;
    });

    doc.body.appendChild(panel);
    this._panel = panel;
    this._renderPanelList(panel);
    this._positionPanel(panel);
    this._syncPanelAria(true);
  },

  _draftIndex: function(key) {
    if (!this._columnDraft) return -1;
    for (var i = 0; i < this._columnDraft.length; i++) {
      if (this._columnDraft[i].key === key) return i;
    }
    return -1;
  },

  _findDraftColumn: function(key) {
    if (!this._columnDraft) return null;
    for (var i = 0; i < this._columnDraft.length; i++) {
      if (this._columnDraft[i].key === key) return this._columnDraft[i];
    }
    return null;
  },

  _saveDraft: function(panel) {
    if (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.assertWritable === 'function') {
      TaskManager.assertWritable();
    }

    var config = _gridColumnConfig();
    var currentProj = (typeof TaskManager !== 'undefined' && TaskManager) ? TaskManager.currentProject : null;
    var wsProj = (typeof Workspace !== 'undefined' && Workspace && typeof Workspace.currentProject === 'function')
      ? Workspace.currentProject()
      : null;
    var currentProjId = currentProj
      ? currentProj.id
      : (wsProj ? wsProj.id : ((typeof Workspace !== 'undefined' && Workspace) ? Workspace.activeProjectId : null));

    if (!this._capturedProjectId || this._capturedProjectId !== currentProjId) {
      var errBox = panel ? panel.querySelector('#grid-draft-error') : null;
      var msg = '当前项目已切换或未绑定，列配置保存已被拒绝';
      if (errBox) { errBox.textContent = msg; errBox.style.display = 'block'; }
      return;
    }

    var pData = (typeof TaskManager !== 'undefined' && TaskManager) ? TaskManager.data : null;
    var allBatches = (typeof Workspace !== 'undefined' && Workspace.data && Array.isArray(Workspace.data.recycleBin)) ? Workspace.data.recycleBin : [];
    // 边界调用仅提取当前项目批次
    var targetBatches = allBatches.filter(function(b) { return b && b.projectId === currentProjId; });

    // 从当前输入框收集最新 label
    if (panel && typeof panel.querySelectorAll === 'function') {
      var labelInputs = panel.querySelectorAll('[data-draft-label]');
      for (var i = 0; i < labelInputs.length; i++) {
        var inp = labelInputs[i];
        var k = inp.getAttribute('data-draft-label');
        var col = config ? config.findColumn(this._columnDraft, k) : this._findDraftColumn(k);
        if (col) col.label = inp.value;
      }
    }

    // 校验草稿
    if (config && typeof config.validateDraft === 'function') {
      var validation = config.validateDraft(this._columnDraft, pData, targetBatches);
      if (!validation.valid) {
        var errBoxV = panel ? panel.querySelector('#grid-draft-error') : null;
        if (errBoxV) {
          errBoxV.textContent = validation.errors.join('；');
          errBoxV.style.display = 'block';
        } else if (typeof alert === 'function') {
          alert(validation.errors.join('；'));
        }
        return;
      }
    }

    // 比对原列设置，找出被删除的自定义列键集合
    var initialCols = (pData && pData.settings && Array.isArray(pData.settings.columns))
      ? pData.settings.columns
      : (this.columns || this.defaultColumns());
    var draftKeys = new Set((this._columnDraft || []).map(function(c) { return c.key; }));
    var deletedCustomKeys = [];
    initialCols.forEach(function(c) {
      if (c && c.builtin === false && !draftKeys.has(c.key)) {
        deletedCustomKeys.push(c.key);
      }
    });

    var nextColumnsState = config ? config.getState(this._columnDraft) : this._columnDraft.map(_cloneGridColumn);

    if (typeof Workspace !== 'undefined' && Workspace.data && Array.isArray(Workspace.data.projects)) {
      var nextWorkspace = JSON.parse(JSON.stringify(Workspace.data));
      var targetProjIndex = -1;
      for (var pIdx = 0; pIdx < nextWorkspace.projects.length; pIdx++) {
        if (nextWorkspace.projects[pIdx].id === currentProjId) {
          targetProjIndex = pIdx;
          break;
        }
      }
      if (targetProjIndex === -1) {
        throw new Error('未找到当前项目: ' + currentProjId);
      }

      var targetProj = nextWorkspace.projects[targetProjIndex];
      if (targetProj.archived) {
        throw new Error('已归档项目处于只读状态，禁止保存列配置');
      }

      if (!targetProj.data.settings) targetProj.data.settings = {};
      targetProj.data.settings.columns = nextColumnsState;

      if (deletedCustomKeys.length > 0) {
        var targetTrashBatches = (Array.isArray(nextWorkspace.recycleBin) ? nextWorkspace.recycleBin : []).filter(function(b) {
          return b && b.projectId === currentProjId;
        });
        deletedCustomKeys.forEach(function(delKey) {
          if (config && typeof config.deleteCustomColumn === 'function') {
            targetProj.data.settings.columns = config.deleteCustomColumn(
              targetProj.data.settings.columns,
              delKey,
              targetProj.data,
              targetTrashBatches
            );
          } else {
            if (Array.isArray(targetProj.data.tasks)) {
              targetProj.data.tasks.forEach(function(t) {
                if (t && t.customFields) delete t.customFields[delKey];
              });
            }
          }
        });
      }

      targetProj.updatedAt = new Date().toISOString();

      // 原子持久化提交！失败则向外抛错且原内存对象完全不变
      Workspace.commit(nextWorkspace);

      if (pData) {
        pData.settings.columns = JSON.parse(JSON.stringify(targetProj.data.settings.columns));
        pData.tasks = JSON.parse(JSON.stringify(targetProj.data.tasks));
      }
      if (TaskManager && typeof TaskManager._buildIndex === 'function') {
        TaskManager._lastCommittedData = JSON.parse(JSON.stringify(pData));
        TaskManager._buildIndex();
      }
    } else {
      var nextProjectData = JSON.parse(JSON.stringify(pData || {}));
      if (!nextProjectData.settings) nextProjectData.settings = {};
      nextProjectData.settings.columns = nextColumnsState;

      if (deletedCustomKeys.length > 0) {
        deletedCustomKeys.forEach(function(delKey) {
          if (config && typeof config.deleteCustomColumn === 'function') {
            nextProjectData.settings.columns = config.deleteCustomColumn(
              nextProjectData.settings.columns,
              delKey,
              nextProjectData,
              []
            );
          }
        });
      }

      if (typeof DataStore !== 'undefined' && typeof DataStore.save === 'function') {
        DataStore.save(nextProjectData);
      }
      if (TaskManager) {
        TaskManager.data = nextProjectData;
        TaskManager._lastCommittedData = JSON.parse(JSON.stringify(nextProjectData));
        if (typeof TaskManager._buildIndex === 'function') TaskManager._buildIndex();
      }
    }

    this.setColumns(this._columnDraft);
    this._repaint();
    this._columnDraft = null;
    this._capturedProjectId = null;
    this._hideColumnPanel();
  },

  _renderPanelList: function(panel) {
    var self = this;
    var columns = this._columnDraft || this.columns || this.defaultColumns();
    var html = '<div class="grid-column-panel-title">列配置</div><div class="grid-column-panel-list">';
    columns.forEach(function(col, index) {
      var key = col.key;
      html += '<div class="grid-column-panel-item" data-column-item="' + self.escapeHtml(key) + '" tabindex="0">'
        + '<span class="grid-column-drag-handle" draggable="true" data-drag-key="' + self.escapeHtml(key) + '" title="拖拽或Alt+方向键排序">⋮⋮</span>'
        + '<label class="grid-column-panel-label">'
        + '<input type="checkbox" data-draft-visible="' + self.escapeHtml(key) + '"'
        + (col.visible !== false ? ' checked' : '')
        + ' aria-label="显示' + self.escapeHtml(col.label) + '列">'
        + '</label>'
        + '<input type="text" class="grid-column-label-input" data-draft-label="' + self.escapeHtml(key)
        + '" value="' + self.escapeHtml(col.label) + '" placeholder="列名" style="flex:1;min-width:60px;padding:2px 4px;font-size:12px;border:1px solid var(--color-border);border-radius:4px;">'
        + '<span class="grid-column-type-badge" style="font-size:10px;padding:1px 4px;background:var(--color-slate-mist,#f1f5f9);border-radius:3px;color:var(--color-slate,#64748b);">'
        + (col.builtin ? '内置' : self.escapeHtml(col.type))
        + '</span>';

      if (col.type === 'select') {
        html += '<button type="button" class="grid-column-opt-btn" data-toggle-opt="' + self.escapeHtml(key) + '" style="font-size:11px;padding:1px 4px;border:1px solid var(--color-border);border-radius:4px;background:transparent;cursor:pointer;">选项</button>';
      }
      if (col.builtin === false) {
        html += '<button type="button" class="grid-column-del-btn" data-del-col="' + self.escapeHtml(key) + '" title="删除此列" style="font-size:11px;padding:1px 4px;border:1px solid var(--color-border);border-radius:4px;background:transparent;color:#dc2626;cursor:pointer;">✕</button>';
      }
      html += '</div>';

      if (col.type === 'select' && self._expandedOptKey === key) {
        html += '<div class="grid-column-options-box" style="margin:4px 0 8px 24px;padding:6px;background:var(--color-slate-mist,#f8fafc);border-radius:6px;border:1px dashed var(--color-border);">'
          + '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--color-slate,#64748b);">单选选项：</div>';
        var opts = Array.isArray(col.options) ? col.options : [];
        opts.forEach(function(opt) {
          html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">'
            + '<input type="text" data-opt-label="' + self.escapeHtml(opt.id) + '" data-opt-col="' + self.escapeHtml(key) + '" value="' + self.escapeHtml(opt.label) + '" style="flex:1;font-size:11px;padding:1px 4px;border:1px solid var(--color-border);border-radius:3px;">'
            + '<button type="button" data-del-opt="' + self.escapeHtml(opt.id) + '" data-opt-col="' + self.escapeHtml(key) + '" style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:11px;">✕</button>'
            + '</div>';
        });
        html += '<div style="display:flex;gap:4px;margin-top:4px;">'
          + '<input type="text" id="grid-new-opt-' + self.escapeHtml(key) + '" placeholder="新选项" style="flex:1;font-size:11px;padding:1px 4px;border:1px solid var(--color-border);border-radius:3px;">'
          + '<button type="button" data-add-opt="' + self.escapeHtml(key) + '" style="font-size:11px;padding:1px 6px;border:1px solid var(--color-border);border-radius:3px;background:var(--color-surface,#fff);cursor:pointer;">添加</button>'
          + '</div></div>';
      }
    });
    html += '</div>';

    // 添加自定义列区
    html += '<div class="grid-column-add-section" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border);">'
      + '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--color-slate,#64748b);">新增自定义列</div>'
      + '<div class="grid-column-add-row" style="display:flex;gap:4px;align-items:center;">'
      + '<input type="text" id="grid-new-col-name" placeholder="列名称" style="flex:1;padding:2px 4px;font-size:12px;border:1px solid var(--color-border);border-radius:4px;">'
      + '<select id="grid-new-col-type" style="font-size:11px;padding:2px;border:1px solid var(--color-border);border-radius:4px;">'
      + '<option value="text">文本</option>'
      + '<option value="number">数字</option>'
      + '<option value="date">日期</option>'
      + '<option value="select">单选</option>'
      + '</select>'
      + '<button type="button" id="grid-add-col-btn" style="padding:2px 8px;font-size:12px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface,#fff);cursor:pointer;">添加</button>'
      + '</div></div>';

    // 底部保存与取消
    html += '<div class="grid-column-panel-footer" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--color-border);display:flex;flex-direction:column;gap:6px;">'
      + '<div class="grid-column-panel-error" id="grid-draft-error" style="display:none;color:#dc2626;font-size:12px;"></div>'
      + '<div style="display:flex;justify-content:flex-end;gap:6px;">'
      + '<button type="button" id="grid-draft-cancel" style="padding:4px 10px;font-size:12px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface,#fff);cursor:pointer;">取消</button>'
      + '<button type="button" class="btn-primary" id="grid-draft-save" style="padding:4px 12px;font-size:12px;border-radius:6px;cursor:pointer;">保存</button>'
      + '</div></div>';

    panel.innerHTML = html;
  },

  _positionPanel: function(panel) {
    var trigger = this._panelTrigger
      || (this.header ? this.header.querySelector('.grid-columns-btn') : null);
    if (!trigger || typeof trigger.getBoundingClientRect !== 'function' || typeof window === 'undefined') return;
    var rect = trigger.getBoundingClientRect();
    var doc = this._document();
    var docEl = doc && doc.documentElement ? doc.documentElement : null;
    var viewportWidth = window.innerWidth || (docEl ? docEl.clientWidth : 0) || 0;
    var viewportHeight = window.innerHeight || (docEl ? docEl.clientHeight : 0) || 0;
    var width = panel.offsetWidth || 232;
    var height = panel.offsetHeight || 0;
    var maxLeft = viewportWidth - width - 4;
    var left = Math.max(4, Math.min(rect.left, maxLeft));
    var top = rect.bottom + 4;
    if (viewportHeight && height && top + height > viewportHeight - 4) {
      top = Math.max(4, rect.top - height - 4);
    }
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  },

  _syncPanelAria: function(expanded) {
    var value = expanded ? 'true' : 'false';
    var gridBtn = this.header ? this.header.querySelector('.grid-columns-btn') : null;
    if (gridBtn && gridBtn.setAttribute) gridBtn.setAttribute('aria-expanded', value);
    var doc = this._document();
    var topBtn = doc && doc.getElementById ? doc.getElementById('btn-column-settings') : null;
    if (topBtn && topBtn.setAttribute) topBtn.setAttribute('aria-expanded', value);
  },

  _hideColumnPanel: function(options) {
    options = options || {};
    var trigger = this._panelTrigger;
    var hadPanel = !!this._panel;
    if (this._panel) {
      if (this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
      this._panel = null;
    }
    this._columnDraft = null;
    this._capturedProjectId = null;
    this._expandedOptKey = null;
    this._panelTrigger = null;
    if (hadPanel) this._syncPanelAria(false);
    if (hadPanel && options.restoreFocus && trigger && typeof trigger.focus === 'function') {
      try {
        trigger.focus();
      } catch (err) {
        // 焦点归还失败不影响关闭
      }
    }
  },

  // ---- 行内编辑 ----

  _preferredEditKey: function(taskId, target) {
    var editor = _gridCellEditor();
    if (!editor) return null;
    if (this._lastEdit && this._lastEdit.taskId === taskId
      && this._findVisibleColumn(this._lastEdit.key)
      && editor.isEditable(this._lastEdit.key)) {
      return this._lastEdit.key;
    }
    var cell = target && target.closest ? target.closest('[data-column-key]') : null;
    if (cell) {
      var cellKey = cell.getAttribute('data-column-key');
      var targetCol = this._findVisibleColumn(cellKey);
      if (targetCol && editor.isEditable(cellKey, targetCol)) return cellKey;
    }
    var visible = this.getVisibleColumns();
    for (var i = 0; i < visible.length; i++) {
      if (editor.isEditable(visible[i].key, visible[i])) return visible[i].key;
    }
    return null;
  },

  _startEdit: function(taskId, key) {
    if (this._readonly || (typeof ShareManager !== 'undefined' && ShareManager && typeof ShareManager.isReadonly === 'function' && ShareManager.isReadonly())) {
      return false;
    }
    if (typeof RealtimeClient !== 'undefined' && RealtimeClient && typeof RealtimeClient.sendHeartbeat === 'function') {
      RealtimeClient.sendHeartbeat(taskId);
    }
    var editor = _gridCellEditor();
    if (!editor || !key) return false;
    var task = this._getTask(taskId);
    var column = this._findVisibleColumn(key);
    if (!task || !column || !editor.isEditable(key, column) || !this.body) return false;

    if (this._editing) this._commitEdit(true);

    var cell = this._findCell(taskId, key);
    if (!cell) return false;

    var control = this._createEditorControl(key, column, task);
    var state = {
      taskId: String(taskId),
      key: key,
      column: column,
      cell: cell,
      control: control,
      originalHtml: cell.innerHTML,
      finishing: false
    };

    cell.classList.add('is-editing');
    cell.innerHTML = '';
    cell.appendChild(control);
    this._editing = state;

    var self = this;
    control.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        self._commitEdit(false);
      } else if (e.key === 'Escape') {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        self._cancelEdit(true);
      }
    });
    control.addEventListener('blur', function() {
      if (self._editing === state) self._commitEdit(true);
    });

    if (control.focus) control.focus();
    if (control.select) {
      try { control.select(); } catch (err) {}
    }
    return true;
  },

  _createEditorControl: function(key, column, task) {
    var editor = _gridCellEditor();
    var doc = this._document();
    var kind = editor ? editor.controlFor(key, column) : null;
    var control = doc.createElement(kind === 'select' ? 'select' : 'input');
    control.className = 'grid-edit-input';

    if (kind === 'select') {
      if (column && column.builtin === false) {
        var emptyOpt = doc.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '请选择';
        control.appendChild(emptyOpt);
        var customOpts = Array.isArray(column.options) ? column.options : [];
        customOpts.forEach(function(option) {
          var node = doc.createElement('option');
          node.value = option.id;
          node.textContent = option.label;
          control.appendChild(node);
        });
        control.value = (task.customFields && task.customFields[key]) || '';
        return control;
      }
      editor.STATUS_OPTIONS.forEach(function(option) {
        var node = doc.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        control.appendChild(node);
      });
      control.value = task.status || 'todo';
      return control;
    }

    if (kind === 'date') {
      control.type = 'date';
      control.value = (column && column.builtin === false)
        ? ((task.customFields && task.customFields[key]) || '')
        : (task[key] || '');
      return control;
    }

    if (kind === 'number') {
      control.type = 'number';
      control.step = 'any';
      var numVal = (column && column.builtin === false)
        ? ((task.customFields && task.customFields[key] !== undefined && task.customFields[key] !== null) ? String(task.customFields[key]) : '')
        : (task[key] !== undefined && task[key] !== null ? String(task[key]) : '');
      control.value = numVal;
      return control;
    }

    if (kind === 'progress') {
      control.type = 'number';
      control.min = '0';
      control.max = '100';
      control.step = '1';
      var numeric = this.getProgressValue(task.progress);
      control.value = numeric === null ? '' : String(numeric);
      return control;
    }

    control.type = 'text';
    control.value = (column && column.builtin === false)
      ? ((task.customFields && task.customFields[key]) || '')
      : (task[key] === null || task[key] === undefined ? '' : String(task[key]));
    return control;
  },

  _readEditorValue: function(state) {
    return state && state.control ? state.control.value : '';
  },

  _commitEdit: function(fromBlur) {
    var state = this._editing;
    if (!state || state.finishing) return false;
    var editor = _gridCellEditor();
    var task = editor ? this._getTask(state.taskId) : null;
    if (!editor || !task) {
      this._cancelEdit();
      return false;
    }

    var result = editor.commit(task, state.key, this._readEditorValue(state), state.column);

    if (result.error) {
      if (fromBlur) {
        this._cancelEdit();
        return false;
      }
      state.control.classList.add('is-invalid');
      state.cell.classList.add('is-invalid');
      state.cell.setAttribute('title', result.error);
      if (state.control.focus) state.control.focus();
      return false;
    }

    this._editing = null;
    state.finishing = true;

    if (!result.changed) {
      this._restoreCell(state);
      if (!fromBlur) this._focusRowNode(state.taskId);
      return false;
    }

    var updated = null;
    if (typeof TaskManager !== 'undefined' && TaskManager
      && typeof TaskManager.updateTask === 'function') {
      updated = TaskManager.updateTask(state.taskId, result.updates);
    }
    if (updated) {
      this._refresh();
    } else {
      this._restoreCell(state);
    }
    return true;
  },

  _cancelEdit: function(restoreFocus) {
    var state = this._editing;
    if (!state) return false;
    this._editing = null;
    state.finishing = true;
    this._restoreCell(state);
    if (restoreFocus) this._focusRowNode(state.taskId);
    return true;
  },

  _restoreCell: function(state) {
    if (!state || !state.cell) return;
    state.cell.innerHTML = state.originalHtml;
    state.cell.classList.remove('is-editing');
    state.cell.classList.remove('is-invalid');
    if (state.cell.removeAttribute) state.cell.removeAttribute('title');
  },

  _findCell: function(taskId, key) {
    if (!this.body) return null;
    var rows = this.body.querySelectorAll('.grid-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-task-id') === String(taskId)) {
        return rows[i].querySelector('[data-column-key="' + key + '"]');
      }
    }
    return null;
  },

  _getTask: function(taskId) {
    if (typeof TaskManager !== 'undefined' && TaskManager
      && typeof TaskManager.getTask === 'function') {
      return TaskManager.getTask(taskId);
    }
    return null;
  },

  // ---- 右键菜单 ----

  showContextMenu: function(taskId, x, y) {
    var app = this._app();
    if (app && typeof app.showTaskMenu === 'function') {
      app.showTaskMenu(taskId, x, y);
      return;
    }
    if (typeof TreeView !== 'undefined' && TreeView && TreeView.contextMenu
      && typeof TreeView.showContextMenu === 'function') {
      TreeView.showContextMenu(x, y, this._buildMenuItems(taskId));
      return;
    }
    this._showLocalMenu(taskId, x, y);
  },

  _buildMenuItems: function(taskId) {
    var self = this;
    var items = [];
    if (this._taskDepth(taskId) < 2) {
      items.push({
        label: '添加子任务',
        action: function() {
          var app = self._app();
          if (app && typeof app.showAddTask === 'function') app.showAddTask(taskId);
        }
      });
    }
    items.push({
      label: '编辑任务',
      action: function() {
        var app = self._app();
        if (app && typeof app.showEditTask === 'function') app.showEditTask(taskId);
      }
    });
    items.push({
      label: '评论 / 活动 / 附件',
      action: function() {
        var app = self._app();
        if (app && typeof app.showTaskDetail === 'function') app.showTaskDetail(taskId);
      }
    });
    [
      { label: '标记为未开始', status: 'todo' },
      { label: '标记为进行中', status: 'inProgress' },
      { label: '标记为第三方跟进', status: 'thirdParty' },
      { label: '标记为已完成', status: 'done' }
    ].forEach(function(entry) {
      items.push({
        label: entry.label,
        action: function() { self._setStatus(taskId, entry.status); }
      });
    });
    items.push({
      label: '删除任务',
      danger: true,
      action: function() {
        var app = self._app();
        if (app && typeof app.deleteTask === 'function') app.deleteTask(taskId);
      }
    });
    return items;
  },

  _applyStatus: function(targets, status) {
    if (targets.length === 0) return;
    if (typeof TaskManager.updateTasks === 'function') {
      TaskManager.updateTasks(targets, { status: status });
      return;
    }
    for (var i = 0; i < targets.length; i++) {
      TaskManager.updateTask(targets[i], { status: status });
    }
  },

  _setStatus: function(taskId, status) {
    if (typeof TaskManager === 'undefined' || !TaskManager) return;
    var targets = this.getBulkStatusTargets(this.selection, taskId);
    this._applyStatus(targets, status);
    this._refresh();
  },

  bulkSetStatus: function(status) {
    if (typeof TaskManager === 'undefined' || !TaskManager) return [];
    var targets = this.getBulkStatusTargets(this.selection, this.selectedId);
    this._applyStatus(targets, status);
    if (targets.length > 0) this._refresh();
    return targets;
  },

  _refresh: function() {
    var workbench = this._workbench();
    if (workbench && typeof workbench.render === 'function') {
      workbench.render();
      return;
    }
    var app = this._app();
    if (app && typeof app.renderAll === 'function') app.renderAll();
  },

  _taskDepth: function(taskId) {
    if (typeof TaskManager === 'undefined' || !TaskManager) return 0;
    return TaskManager.getDepth(taskId);
  },

  _showLocalMenu: function(taskId, x, y) {
    var doc = this._document();
    if (!doc || !doc.body) return;
    this._hideLocalMenu();
    var self = this;
    var menu = doc.createElement('div');
    menu.className = 'grid-context-menu';
    menu.setAttribute('role', 'menu');
    this._buildMenuItems(taskId).forEach(function(item) {
      var el = doc.createElement('div');
      el.className = 'grid-context-menu-item' + (item.danger ? ' danger' : '');
      el.setAttribute('role', 'menuitem');
      el.textContent = item.label;
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        self._hideLocalMenu();
        item.action();
      });
      menu.appendChild(el);
    });
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    doc.body.appendChild(menu);

    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 4) {
      menu.style.left = Math.max(4, x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight - 4) {
      menu.style.top = Math.max(4, y - rect.height) + 'px';
    }
    this._localMenu = menu;
  },

  _hideLocalMenu: function() {
    if (this._localMenu && this._localMenu.parentNode) {
      this._localMenu.parentNode.removeChild(this._localMenu);
    }
    this._localMenu = null;
  },

  // ---- 辅助 ----

  _repaint: function() {
    this._cancelEdit();
    this.renderHeader();
    this.renderBody();
    this.syncHeader();
    this._scheduleHeaderSync();
  },

  _columnStyle: function(col) {
    return '--col-width:' + col.width + 'px;'
      + '--col-min:' + col.minWidth + 'px;'
      + 'flex:0 0 ' + col.width + 'px;'
      + 'width:' + col.width + 'px;';
  },

  _effectiveColor: function(task) {
    if (!task) return this.DEFAULT_COLOR;
    if (typeof TaskManager !== 'undefined' && TaskManager
      && typeof TaskManager.getEffectiveColor === 'function') {
      return TaskManager.getEffectiveColor(task);
    }
    return task.color || this.DEFAULT_COLOR;
  },

  safeColor: function(color) {
    return /^#[0-9a-fA-F]{3,8}$/.test(String(color)) ? color : this.DEFAULT_COLOR;
  },

  escapeHtml: function(value) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>"']/g, function(ch) { return map[ch]; });
  },

  _document: function() {
    return this._doc || (typeof document !== 'undefined' ? document : null);
  },

  _workbench: function() {
    return typeof Workbench !== 'undefined' && Workbench ? Workbench : null;
  },

  _app: function() {
    return typeof App !== 'undefined' && App ? App : null;
  }
};
