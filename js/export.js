// ============================================================
// Export: 按当前视图生成 Excel 工作簿数据
// 纯数据构建函数可供测试；exportToExcel 负责调用 XLSX 写文件。
// ============================================================
var Export = (function() {
  'use strict';

  var FILE_PREFIX = 'PMWEB_';
  var VIEW_SHEET = '当前视图';

  var LEGACY_STATUS_LABELS = {
    todo: '未开始',
    inProgress: '正在进行',
    thirdParty: '第三方跟进',
    done: '已完成'
  };

  var VIEW_STATUS_LABELS = {
    todo: '未开始',
    inProgress: '进行中',
    thirdParty: '第三方',
    done: '已完成'
  };

  var TASK_HEADERS = ['层级', '任务名称', '开始日期', '结束日期', '负责人', '状态', '颜色'];
  var TASK_COLS = [
    { wch: 6 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 8 }
  ];

  var MILESTONE_HEADERS = ['任务名称', '里程碑名称', '日期', '状态'];
  var MILESTONE_COLS = [{ wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 6 }];

  var DEFAULT_COLUMNS = [
    { key: 'name', label: '任务名称', width: 260, visible: true, type: 'name' },
    { key: 'status', label: '状态', width: 110, visible: true, type: 'status' },
    { key: 'assignee', label: '负责人', width: 100, visible: true, type: 'text' },
    { key: 'startDate', label: '开始', width: 110, visible: true, type: 'date' },
    { key: 'endDate', label: '结束', width: 110, visible: true, type: 'date' },
    { key: 'plannedEndDate', label: '计划完成', width: 120, visible: true, type: 'date' },
    { key: 'progress', label: '进度', width: 120, visible: true, type: 'progress' },
    { key: 'description', label: '描述', width: 220, visible: true, type: 'text' }
  ];

  function text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function cloneColumns(columns) {
    return (columns || []).map(function(column) {
      var col = {
        key: column.key,
        label: column.label,
        width: column.width,
        visible: column.visible !== false,
        type: column.type,
        builtin: column.builtin !== false
      };
      if (Array.isArray(column.options)) {
        col.options = column.options.map(function(opt) {
          return { id: String(opt.id), label: String(opt.label) };
        });
      }
      return col;
    });
  }

  function visibleColumns(columns) {
    var list;
    if (Array.isArray(columns) && columns.length > 0) list = cloneColumns(columns);
    else if (typeof ColumnConfig !== 'undefined' && ColumnConfig && typeof ColumnConfig.defaultColumns === 'function') {
      list = ColumnConfig.defaultColumns();
    } else {
      list = cloneColumns(DEFAULT_COLUMNS);
    }
    return list.filter(function(column) {
      return column && column.key && column.visible !== false;
    });
  }

  function resolveManager(options) {
    if (options && options.taskManager) return options.taskManager;
    if (typeof TaskManager !== 'undefined') return TaskManager;
    return null;
  }

  function byOrder(a, b) {
    var aOrder = Number(a && a.order);
    var bOrder = Number(b && b.order);
    if (!isFinite(aOrder)) aOrder = 0;
    if (!isFinite(bOrder)) bOrder = 0;
    return aOrder - bOrder;
  }

  function getRoots(manager, tasks) {
    if (manager && typeof manager.getRootTasks === 'function') return manager.getRootTasks();
    return tasks.filter(function(task) { return !task.parentId; }).sort(byOrder);
  }

  function getChildren(manager, tasks, task) {
    if (manager && typeof manager.getChildren === 'function') return manager.getChildren(task.id);
    return tasks.filter(function(item) { return item.parentId === task.id; }).sort(byOrder);
  }

  function getTask(manager, tasks, taskId) {
    if (manager && typeof manager.getTask === 'function') return manager.getTask(taskId);
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === taskId) return tasks[i];
    }
    return null;
  }

  function getRange(manager, task) {
    if (manager && typeof manager.getDateRange === 'function') return manager.getDateRange(task);
    return {
      startDate: task.startDate || null,
      endDate: task.endDate || null
    };
  }

  function legacyStatus(status) {
    return LEGACY_STATUS_LABELS[status] || text(status);
  }

  function viewStatus(status) {
    return VIEW_STATUS_LABELS[status] || text(status);
  }

  function progressText(value) {
    if (value === null || value === undefined || value === '') return '';
    var numeric = Number(value);
    if (!isFinite(numeric)) return '';
    if (numeric < 0) numeric = 0;
    if (numeric > 100) numeric = 100;
    return Math.round(numeric) + '%';
  }

  function filename(dateText) {
    var date = dateText;
    if (!date) {
      date = typeof DateUtil !== 'undefined' && DateUtil
        ? DateUtil.format(new Date())
        : new Date().toISOString().slice(0, 10);
    }
    return FILE_PREFIX + date + '.xlsx';
  }

  // ---- Sheet 1：任务列表（保留原有层级结构） --------------------
  function buildTaskRows(tasks, options) {
    var manager = resolveManager(options);
    var list = Array.isArray(tasks) ? tasks : [];
    var data = [TASK_HEADERS.slice()];

    function addTaskRow(task, depth) {
      var indent = '';
      for (var i = 1; i < depth; i++) indent += '　';
      if (depth > 1) indent += '├ ';
      var range = getRange(manager, task);
      data.push([
        depth,
        indent + text(task.name),
        range.startDate || '',
        range.endDate || '',
        task.assignee || '',
        legacyStatus(task.status),
        task.color || ''
      ]);
      getChildren(manager, list, task).forEach(function(child) {
        addTaskRow(child, depth + 1);
      });
    }

    getRoots(manager, list).forEach(function(task) {
      addTaskRow(task, 1);
    });
    return data;
  }

  // ---- Sheet 2：里程碑 -----------------------------------------
  function buildMilestoneRows(milestones, tasks, options) {
    var manager = resolveManager(options);
    var list = Array.isArray(tasks) ? tasks : [];
    var data = [MILESTONE_HEADERS.slice()];
    (milestones || []).forEach(function(milestone) {
      var task = getTask(manager, list, milestone.taskId);
      data.push([
        task ? text(task.name) : '',
        text(milestone.name),
        text(milestone.date),
        milestone.status === 'done' ? '已完成' : '待办'
      ]);
    });
    return data;
  }

  // ---- Sheet 3：甘特图 -----------------------------------------
  function buildGanttRows(tasks, options) {
    var manager = resolveManager(options);
    var list = Array.isArray(tasks) ? tasks : [];
    var dates = [];

    list.forEach(function(task) {
      var range = getRange(manager, task);
      if (range.startDate) dates.push(range.startDate);
      if (range.endDate) dates.push(range.endDate);
    });

    if (dates.length === 0) {
      return { rows: [], cols: [], dates: [] };
    }

    dates.sort();
    var dateList = [];
    var cursor = DateUtil.parse(dates[0]);
    var end = DateUtil.parse(dates[dates.length - 1]);
    while (cursor <= end) {
      dateList.push(DateUtil.format(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }

    var rows = [['任务名称'].concat(dateList.map(function(date) { return date.slice(5); }))];
    list.forEach(function(task) {
      if (getChildren(manager, list, task).length > 0) return;
      var range = getRange(manager, task);
      var row = [text(task.name)];
      dateList.forEach(function(date) {
        if (range.startDate && range.endDate && date >= range.startDate && date <= range.endDate) {
          row.push('■');
        } else {
          row.push('');
        }
      });
      rows.push(row);
    });

    var cols = [{ wch: 25 }];
    dateList.forEach(function() { cols.push({ wch: 4 }); });
    return { rows: rows, cols: cols, dates: dateList };
  }

  // ---- Sheet 4：当前视图 ---------------------------------------
  function indentName(row) {
    var depth = Number(row && row.depth);
    if (!isFinite(depth) || depth <= 0) return text(row && row.task ? row.task.name : '');
    var indent = '';
    for (var i = 0; i < depth; i++) indent += '  ';
    return indent + text(row.task ? row.task.name : '');
  }

  function viewCell(row, column) {
    var task = row.task || {};
    var key = column.key;
    if (key === 'name') return indentName(row);
    if (key === 'status') {
      var st = (row && row.status) || task.status;
      if (row && row.isSummary && typeof Progress !== 'undefined' && typeof Progress.rollupStatus === 'function') {
        var manager = resolveManager() || (typeof TaskManager !== 'undefined' ? TaskManager : null);
        if (manager && typeof manager.getChildren === 'function') {
          st = Progress.rollupStatus(task, manager.getChildren(task.id), function(id) { return manager.getChildren(id); });
        }
      }
      return viewStatus(st);
    }
    if (key === 'assignee') return text(task.assignee);
    if (key === 'startDate' || key === 'endDate') return text(row[key]);
    if (key === 'progress') return progressText(task.progress);
    if (key === 'plannedEndDate') return text(task.plannedEndDate);
    if (column && column.builtin === false) {
      var customVal = task.customFields ? task.customFields[key] : undefined;
      if (customVal === null || customVal === undefined || customVal === '') return '';
      if (column.type === 'select' && Array.isArray(column.options)) {
        for (var i = 0; i < column.options.length; i++) {
          if (column.options[i] && String(column.options[i].id) === String(customVal)) {
            return text(column.options[i].label);
          }
        }
      }
      return text(customVal);
    }
    return text(task[key]);
  }

  function buildViewRows(rows, columns) {
    var cols = visibleColumns(columns);
    var data = [cols.map(function(column) { return text(column.label); })];

    (Array.isArray(rows) ? rows : []).forEach(function(row) {
      if (!row) return;
      if (row.isGroupHeader) {
        var line = ['分组：' + text(row.label) + '（' + (Number(row.count) || 0) + '）'];
        while (line.length < cols.length) line.push('');
        data.push(line);
        return;
      }
      data.push(cols.map(function(column) { return viewCell(row, column); }));
    });

    return data;
  }

  function viewColumns(columns) {
    return visibleColumns(columns).map(function(column) {
      var width = Number(column.width);
      if (!isFinite(width) || width <= 0) width = 100;
      return { wch: Math.max(8, Math.round(width / 7)) };
    });
  }

  // ---- 工作簿 --------------------------------------------------
  function buildWorkbook(options) {
    options = options || {};
    var manager = resolveManager(options);
    var tasks = Array.isArray(options.tasks)
      ? options.tasks
      : (manager && typeof manager.getAllTasks === 'function' ? manager.getAllTasks() : []);
    var milestones = Array.isArray(options.milestones)
      ? options.milestones
      : (manager && typeof manager.getAllMilestones === 'function' ? manager.getAllMilestones() : []);
    var rows = Array.isArray(options.rows) ? options.rows : [];
    var columns = options.columns;

    var sheets = [];
    sheets.push({
      name: '任务列表',
      rows: buildTaskRows(tasks, options),
      cols: TASK_COLS
    });
    sheets.push({
      name: '里程碑',
      rows: buildMilestoneRows(milestones, tasks, options),
      cols: MILESTONE_COLS
    });

    var gantt = buildGanttRows(tasks, options);
    if (gantt.rows.length > 0) {
      sheets.push({ name: '甘特图', rows: gantt.rows, cols: gantt.cols });
    }

    sheets.push({
      name: VIEW_SHEET,
      rows: buildViewRows(rows, columns),
      cols: viewColumns(columns)
    });

    return {
      filename: filename(options.date),
      sheets: sheets,
      empty: gantt.rows.length === 0
    };
  }

  function exportToExcel(options) {
    if (typeof XLSX === 'undefined') {
      return { ok: false, reason: 'missing-xlsx', filename: null };
    }
    var built = buildWorkbook(options || {});
    if (built.empty) {
      return { ok: false, reason: 'empty', filename: built.filename };
    }

    var workbook = XLSX.utils.book_new();
    built.sheets.forEach(function(sheet) {
      var worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
      if (sheet.cols) worksheet['!cols'] = sheet.cols;
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
    });
    XLSX.writeFile(workbook, built.filename);
    return { ok: true, reason: null, filename: built.filename };
  }

  return {
    FILE_PREFIX: FILE_PREFIX,
    VIEW_SHEET: VIEW_SHEET,
    DEFAULT_COLUMNS: DEFAULT_COLUMNS,
    filename: filename,
    statusLabel: viewStatus,
    progressText: progressText,
    buildTaskRows: buildTaskRows,
    buildMilestoneRows: buildMilestoneRows,
    buildGanttRows: buildGanttRows,
    buildViewRows: buildViewRows,
    buildWorkbook: buildWorkbook,
    exportToExcel: exportToExcel
  };
})();
