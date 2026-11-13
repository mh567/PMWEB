// ============================================================
// Views: 筛选、排序、分组与视图序列化（纯函数）
// 输入是 RowModel 行数组，输出新的行数组，不修改任何输入。
// ============================================================
var Views = (function() {
  'use strict';

  var STATUS_VALUES = ['todo', 'inProgress', 'thirdParty', 'done'];
  var SORT_FIELDS = ['name', 'status', 'assignee', 'startDate', 'endDate', 'progress'];
  var GROUP_BY_VALUES = ['none', 'status', 'assignee'];
  var STATUS_RANK = { todo: 0, inProgress: 1, thirdParty: 2, done: 3 };
  var STATUS_LABELS = { todo: '未开始', inProgress: '进行中', thirdParty: '第三方', done: '已完成' };
  var DUE_VALUES = ['', 'overdue', 'today', 'next7'];
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function lower(value) {
    return text(value).trim().toLowerCase();
  }

  function isDate(value) {
    return typeof value === 'string' && DATE_PATTERN.test(value);
  }

  function taskOf(row) {
    return row && row.task ? row.task : {};
  }

  function isEmptyValue(value) {
    return value === '' || value === null || value === undefined;
  }

  function isGroupRow(row) {
    return !!(row && row.isGroupHeader);
  }

  function normalizeFilters(filters) {
    var source = filters && typeof filters === 'object' ? filters : {};
    var due = typeof source.due === 'string' ? source.due : '';
    if (['overdue', 'today', 'next7'].indexOf(due) === -1) {
      due = '';
    }
    return {
      status: STATUS_VALUES.indexOf(source.status) !== -1 ? source.status : '',
      assignee: text(source.assignee).trim(),
      search: text(source.search),
      startDate: isDate(source.startDate) ? source.startDate : '',
      endDate: isDate(source.endDate) ? source.endDate : '',
      due: due
    };
  }

  function rowMatches(row, filters, hasDateFilter, dueFilter, todayStr) {
    var task = taskOf(row);
    if (filters.status) {
      // 状态筛选只匹配叶子，父行仅随匹配后代保留上下文
      if (row.isSummary) return false;
      if (task.status !== filters.status) return false;
    }
    if (filters.assignee && lower(task.assignee) !== lower(filters.assignee)) return false;
    if (filters.search) {
      var haystack = lower(task.name) + '\n' + lower(task.description) + '\n' + lower(task.assignee);
      if (haystack.indexOf(lower(filters.search)) === -1) return false;
    }
    if (hasDateFilter) {
      // 汇总行的日期由子任务派生，日期筛选只看叶子，父行随子树保留。
      if (row.isSummary) return false;
      if (!row.startDate || !row.endDate) return false;
      if (filters.startDate && row.endDate < filters.startDate) return false;
      if (filters.endDate && row.startDate > filters.endDate) return false;
    }
    if (dueFilter) {
      // 快捷到期筛选只看叶子，父行随子树保留
      if (row.isSummary) return false;
      if (!task.endDate || task.status === 'done') return false;
      if (dueFilter === 'overdue') {
        if (task.endDate >= todayStr) return false;
      } else if (dueFilter === 'today') {
        if (task.endDate !== todayStr) return false;
      } else if (dueFilter === 'next7') {
        var next7End = (typeof DateUtil !== 'undefined' && typeof DateUtil.addDays === 'function')
          ? DateUtil.addDays(todayStr, 6)
          : todayStr;
        if (task.endDate < todayStr || task.endDate > next7End) return false;
      }
    }
    return true;
  }

  // ---- 筛选 ----------------------------------------------------
  function filterRows(rows, filters, today) {
    var list = Array.isArray(rows) ? rows : [];
    var normalized = normalizeFilters(filters);
    var hasDateFilter = !!(normalized.startDate || normalized.endDate);
    var dueFilter = normalized.due;
    var todayStr = isDate(today)
      ? today
      : (typeof DateUtil !== 'undefined' && typeof DateUtil.format === 'function')
        ? DateUtil.format(new Date())
        : new Date().toISOString().slice(0, 10);

    var kept = [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || isGroupRow(row)) {
        kept.push(false);
        continue;
      }
      kept.push(rowMatches(row, normalized, hasDateFilter, dueFilter, todayStr));
    }

    // 自底向上：父行只要有一个可见后代就保留。
    for (var j = list.length - 1; j >= 0; j--) {
      var current = list[j];
      if (!current || isGroupRow(current) || !current.isSummary || kept[j]) continue;
      for (var k = j + 1; k < list.length; k++) {
        var descendant = list[k];
        if (!descendant) continue;
        if (descendant.depth <= current.depth) break;
        if (kept[k]) {
          kept[j] = true;
          break;
        }
      }
    }

    var result = [];
    for (var m = 0; m < list.length; m++) {
      if (kept[m] && list[m] && !isGroupRow(list[m])) result.push(list[m]);
    }
    return result;
  }

  // ---- 排序 ----------------------------------------------------
  function sortValue(row, field) {
    var task = taskOf(row);
    if (field === 'name') return text(task.name);
    if (field === 'status') return text(task.status);
    if (field === 'assignee') return text(task.assignee);
    if (field === 'startDate') return text(row.startDate);
    if (field === 'endDate') return text(row.endDate);
    if (field === 'progress') {
      var numeric = Number(task.progress);
      return isFinite(numeric) ? numeric : 0;
    }
    return '';
  }

  function compareValues(field, a, b) {
    if (field === 'status') {
      var aRank = STATUS_RANK[a] === undefined ? 3 : STATUS_RANK[a];
      var bRank = STATUS_RANK[b] === undefined ? 3 : STATUS_RANK[b];
      return aRank - bRank;
    }
    if (field === 'progress') return a - b;
    return text(a).localeCompare(text(b), 'zh-CN');
  }

  function sortRows(rows, sort) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    var field = sort && SORT_FIELDS.indexOf(sort.field) !== -1 ? sort.field : '';
    if (!field) return list;
    var direction = sort && sort.direction === 'desc' ? -1 : 1;

    var decorated = [];
    for (var i = 0; i < list.length; i++) {
      if (isGroupRow(list[i])) continue;
      decorated.push({ row: list[i], index: i });
    }

    decorated.sort(function(a, b) {
      var aValue = sortValue(a.row, field);
      var bValue = sortValue(b.row, field);
      var aEmpty = isEmptyValue(aValue);
      var bEmpty = isEmptyValue(bValue);
      // 空值固定排最后，不随升降序翻转。
      if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return a.index - b.index;
        return aEmpty ? 1 : -1;
      }
      var compared = compareValues(field, aValue, bValue);
      if (compared !== 0) return compared * direction;
      return a.index - b.index;
    });

    var result = [];
    for (var j = 0; j < decorated.length; j++) result.push(decorated[j].row);
    return result;
  }

  // ---- 分组 ----------------------------------------------------
  function groupValue(row, groupBy) {
    var task = taskOf(row);
    if (groupBy === 'status') return text(task.status);
    if (groupBy === 'assignee') return text(task.assignee).trim();
    return '';
  }

  function groupLabel(groupBy, value) {
    if (groupBy === 'status') return STATUS_LABELS[value] || '未设置状态';
    if (groupBy === 'assignee') return value || '未分配';
    return '';
  }

  function groupHeader(groupBy, value, count) {
    return {
      id: '__group__' + groupBy + '__' + encodeURIComponent(value),
      kind: 'group',
      isGroupHeader: true,
      groupBy: groupBy,
      groupKey: value,
      label: groupLabel(groupBy, value),
      count: count,
      task: null,
      depth: 0,
      hasChildren: false,
      isCollapsed: false,
      isSummary: false,
      childCount: 0,
      startDate: null,
      endDate: null
    };
  }

  function groupRows(rows, groupBy) {
    var list = Array.isArray(rows) ? rows : [];
    if (groupBy !== 'status' && groupBy !== 'assignee') return list.slice();

    var order = [];
    var buckets = {};
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || isGroupRow(row)) continue;
      var value = groupValue(row, groupBy);
      if (!Object.prototype.hasOwnProperty.call(buckets, value)) {
        buckets[value] = [];
        order.push(value);
      }
      buckets[value].push(row);
    }

    var result = [];
    for (var j = 0; j < order.length; j++) {
      var key = order[j];
      result.push(groupHeader(groupBy, key, buckets[key].length));
      result = result.concat(buckets[key]);
    }
    return result;
  }

  // ---- 视图序列化 ----------------------------------------------
  function normalizeView(view) {
    var source = view && typeof view === 'object' ? view : {};
    var sort = source.sort && typeof source.sort === 'object' ? source.sort : {};
    return {
      name: text(source.name).trim(),
      filters: normalizeFilters(source.filters),
      sort: {
        field: SORT_FIELDS.indexOf(sort.field) !== -1 ? sort.field : '',
        direction: sort.direction === 'desc' ? 'desc' : 'asc'
      },
      groupBy: GROUP_BY_VALUES.indexOf(source.groupBy) !== -1 ? source.groupBy : 'none'
    };
  }

  function defaultView() {
    return normalizeView(null);
  }

  function apply(rows, view, today) {
    var normalized = normalizeView(view);
    return groupRows(
      sortRows(filterRows(rows, normalized.filters, today), normalized.sort),
      normalized.groupBy
    );
  }

  return {
    STATUS_VALUES: STATUS_VALUES,
    SORT_FIELDS: SORT_FIELDS,
    GROUP_BY_VALUES: GROUP_BY_VALUES,
    STATUS_LABELS: STATUS_LABELS,
    DUE_VALUES: DUE_VALUES,
    filterRows: filterRows,
    sortRows: sortRows,
    groupRows: groupRows,
    normalizeView: normalizeView,
    defaultView: defaultView,
    apply: apply
  };
})();
