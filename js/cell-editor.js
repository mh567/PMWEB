// ============================================================
// CellEditor: 行内编辑器的类型、解析、格式化与校验
// 纯函数模块，不依赖 DOM。GridPane 只负责把结果写回 TaskManager。
// ============================================================
var CellEditor = {
  STATUS_OPTIONS: [
    { value: 'todo', label: '未开始' },
    { value: 'inProgress', label: '进行中' },
    { value: 'thirdParty', label: '第三方' },
    { value: 'done', label: '已完成' }
  ],

  TEXT_KEYS: { name: true, assignee: true, description: true },
  DATE_KEYS: { startDate: true, endDate: true, plannedEndDate: true },

  controlFor: function(key, column) {
    if (column && !column.builtin) {
      if (column.type === 'number') return 'number';
      if (column.type === 'select') return 'select';
      if (column.type === 'date') return 'date';
      if (column.type === 'text') return 'text';
      return null;
    }
    if (this.TEXT_KEYS[key]) return 'text';
    if (this.DATE_KEYS[key]) return 'date';
    if (key === 'status') return 'select';
    if (key === 'progress') return 'progress';
    if (column && column.type) {
      if (column.type === 'number') return 'number';
      if (column.type === 'select') return 'select';
      if (column.type === 'date') return 'date';
      if (column.type === 'text' || column.type === 'name') return 'text';
      if (column.type === 'progress') return 'progress';
      if (column.type === 'status') return 'select';
    }
    return null;
  },

  isEditable: function(key, column) {
    return this.controlFor(key, column) !== null;
  },

  isValidDate: function(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    var parts = value.split('-');
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    var date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  },

  statusLabel: function(status) {
    for (var i = 0; i < this.STATUS_OPTIONS.length; i++) {
      if (this.STATUS_OPTIONS[i].value === status) return this.STATUS_OPTIONS[i].label;
    }
    return '';
  },

  normalizeProgress: function(value) {
    var numeric = Number(value);
    if (!isFinite(numeric)) return null;
    return Math.max(0, Math.min(100, Math.round(numeric)));
  },

  format: function(key, value, column) {
    if (key === 'status') return this.statusLabel(value);
    if (key === 'progress') {
      var numeric = this.normalizeProgress(value);
      return numeric === null || value === null || value === undefined || value === ''
        ? ''
        : numeric + '%';
    }
    if (column && !column.builtin) {
      if (value === null || value === undefined || value === '') return '';
      if (column.type === 'select') {
        var options = Array.isArray(column.options) ? column.options : [];
        for (var i = 0; i < options.length; i++) {
          if (options[i] && String(options[i].id) === String(value)) {
            return options[i].label;
          }
        }
        return String(value);
      }
      return String(value);
    }
    if (key === 'startDate' || key === 'endDate' || key === 'plannedEndDate') {
      return value === null || value === undefined ? '' : String(value);
    }
    return value === null || value === undefined ? '' : String(value);
  },

  parse: function(key, raw, task, column) {
    task = task || {};
    var control = this.controlFor(key, column);
    if (control === null) {
      return { ok: false, value: null, error: '该列不支持编辑' };
    }
    if (column && !column.builtin) {
      return this._parseCustom(column, raw);
    }
    if (control === 'text') return this._parseText(key, raw);
    if (control === 'date') return this._parseDate(key, raw, task);
    if (control === 'select') return this._parseStatus(raw);
    return this._parseProgress(raw);
  },

  _parseCustom: function(column, raw) {
    if (typeof ColumnConfig !== 'undefined' && ColumnConfig && typeof ColumnConfig.validateValue === 'function') {
      var check = ColumnConfig.validateValue(column, raw);
      return { ok: check.valid, value: check.value, error: check.error };
    }
    return { ok: true, value: raw, error: null };
  },

  commit: function(task, key, raw, column) {
    var parsed = this.parse(key, raw, task, column);
    if (!parsed.ok) {
      return { changed: false, value: parsed.value, updates: null, error: parsed.error };
    }
    var beforeVal = (column && !column.builtin)
      ? (task && task.customFields ? task.customFields[key] : null)
      : (task ? task[key] : null);
    var before = this.format(key, beforeVal, column);
    var after = this.format(key, parsed.value, column);
    if (before === after) {
      return { changed: false, value: parsed.value, updates: null, error: null };
    }
    var updates = {};
    if (column && !column.builtin) {
      updates.customFields = Object.assign({}, task && task.customFields);
      if (parsed.value === null || parsed.value === undefined) {
        delete updates.customFields[key];
      } else {
        updates.customFields[key] = parsed.value;
      }
    } else {
      updates[key] = parsed.value;
    }
    return { changed: true, value: parsed.value, updates: updates, error: null };
  },

  cancel: function() {
    return { changed: false, value: null, updates: null, error: null };
  },

  _parseText: function(key, raw) {
    var text = raw === null || raw === undefined ? '' : String(raw);
    if (key === 'description') {
      return { ok: true, value: text, error: null };
    }
    var trimmed = text.trim();
    if (key === 'name' && trimmed === '') {
      return { ok: false, value: '', error: '任务名称不能为空' };
    }
    return { ok: true, value: trimmed, error: null };
  },

  _parseDate: function(key, raw, task) {
    var value = raw === null || raw === undefined ? '' : String(raw).trim();
    if (value === '') {
      return { ok: false, value: null, error: '日期不能为空' };
    }
    if (!this.isValidDate(value)) {
      return { ok: false, value: null, error: '日期格式不正确' };
    }
    if (key === 'endDate' && task.startDate && value < task.startDate) {
      return { ok: false, value: null, error: '结束日期不能早于开始日期' };
    }
    if (key === 'startDate' && task.endDate && value > task.endDate) {
      return { ok: false, value: null, error: '开始日期不能晚于结束日期' };
    }
    return { ok: true, value: value, error: null };
  },

  _parseStatus: function(raw) {
    var value = raw === null || raw === undefined ? '' : String(raw).trim();
    for (var i = 0; i < this.STATUS_OPTIONS.length; i++) {
      if (this.STATUS_OPTIONS[i].value === value) {
        return { ok: true, value: value, error: null };
      }
    }
    return { ok: false, value: 'todo', error: '状态不合法' };
  },

  _parseProgress: function(raw) {
    var text = raw === null || raw === undefined ? '' : String(raw).trim();
    if (text.slice(-1) === '%') text = text.slice(0, -1).trim();
    if (text === '') {
      return { ok: false, value: null, error: '进度不能为空' };
    }
    var numeric = Number(text);
    if (!isFinite(numeric)) {
      return { ok: false, value: null, error: '进度必须是数字' };
    }
    return { ok: true, value: Math.max(0, Math.min(100, Math.round(numeric))), error: null };
  }
};
