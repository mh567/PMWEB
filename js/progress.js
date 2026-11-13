// ============================================================
// Progress: 任务进度汇总纯函数
// ============================================================
var Progress = (function() {
  'use strict';

  var MS_PER_DAY = 86400000;
  var MIN_THIRD_PARTY = 30;
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isNumber(value) {
    return typeof value === 'number' && value === value;
  }

  function clamp(value) {
    if (!isNumber(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 100) return 100;
    return value;
  }

  function parseDate(value) {
    if (typeof value !== 'string') return null;
    var match = DATE_PATTERN.exec(value);
    if (!match) return null;
    var year = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    var day = parseInt(match[3], 10);
    var stamp = Date.UTC(year, month - 1, day);
    var date = new Date(stamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }
    return stamp;
  }

  function hasRange(task) {
    return !!(task && parseDate(task.startDate) !== null && parseDate(task.endDate) !== null);
  }

  function durationWeight(task) {
    if (!task) return 1;
    var start = parseDate(task.startDate);
    var end = parseDate(task.endDate);
    if (start === null || end === null) return 1;
    var days = Math.round((end - start) / MS_PER_DAY) + 1;
    return days >= 1 ? days : 1;
  }

  function leafProgress(task) {
    if (!task) return 0;
    if (task.status === 'done') return 100;
    var value = clamp(task.progress);
    if (task.status === 'thirdParty') {
      return value < MIN_THIRD_PARTY ? MIN_THIRD_PARTY : value;
    }
    return value;
  }

  function rollupNode(task, children, getChildren, seen) {
    if (!task) return 0;

    var id = task.id;
    if (id !== undefined && id !== null) {
      if (seen.has(id)) return leafProgress(task);
      seen.add(id);
    }

    var list = Array.isArray(children) ? children : [];
    if (list.length === 0) return leafProgress(task);

    var allDated = true;
    for (var i = 0; i < list.length; i++) {
      if (!hasRange(list[i])) {
        allDated = false;
        break;
      }
    }

    var weighted = 0;
    var weightSum = 0;
    for (var j = 0; j < list.length; j++) {
      var child = list[j];
      if (!child) continue;
      var childChildren = getChildren ? getChildren(child.id) : [];
      if (!Array.isArray(childChildren)) childChildren = [];
      var childProgress = rollupNode(child, childChildren, getChildren, seen);
      var weight = allDated ? durationWeight(child) : 1;
      weighted += childProgress * weight;
      weightSum += weight;
    }

    if (weightSum <= 0) return leafProgress(task);
    return clamp(weighted / weightSum);
  }

  function rollupProgress(task, children, getChildren) {
    if (!task) return 0;
    var resolve = typeof getChildren === 'function' ? getChildren : null;
    var list = children;
    if (!Array.isArray(list)) {
      list = resolve ? resolve(task.id) : [];
      if (!Array.isArray(list)) list = [];
    }
    return rollupNode(task, list, resolve, new Set());
  }

  function computeRowProgress(rows, getChildren) {
    var result = new Map();
    if (!Array.isArray(rows)) return result;
    var resolve = typeof getChildren === 'function' ? getChildren : null;

    rows.forEach(function(row) {
      if (!row) return;
      var task = row.task;
      if (!task) return;
      var children = resolve ? resolve(task.id) : [];
      if (!Array.isArray(children)) children = [];
      var id = row.id !== undefined && row.id !== null ? row.id : task.id;
      result.set(id, rollupProgress(task, children, resolve));
    });

    return result;
  }

  function statusFromProgress(progress, currentStatus) {
    var value = clamp(progress);
    if (value >= 100) return 'done';
    if (value <= 0) return currentStatus === 'todo' ? 'todo' : 'inProgress';
    return currentStatus === 'thirdParty' ? 'thirdParty' : 'inProgress';
  }

  function rollupStatus(task, children, getChildren) {
    if (!task) return 'todo';
    var resolve = typeof getChildren === 'function' ? getChildren : null;
    var list = children;
    if (!Array.isArray(list)) {
      list = resolve ? resolve(task.id) : [];
      if (!Array.isArray(list)) list = [];
    }
    if (list.length === 0) return task.status || 'todo';

    var seen = new Set();
    function collect(t, directList) {
      var id = t.id;
      if (id !== undefined && id !== null) {
        if (seen.has(id)) return t.status || 'todo';
        seen.add(id);
      }
      var subs = Array.isArray(directList) ? directList : (resolve ? resolve(t.id) : []);
      if (!subs || subs.length === 0) return t.status || 'todo';

      var subStatuses = [];
      for (var i = 0; i < subs.length; i++) {
        var sub = subs[i];
        if (!sub) continue;
        subStatuses.push(collect(sub, resolve ? resolve(sub.id) : []));
      }
      if (subStatuses.length === 0) return t.status || 'todo';
      if (subStatuses.every(function(s) { return s === 'todo'; })) return 'todo';
      if (subStatuses.every(function(s) { return s === 'done'; })) return 'done';
      if (subStatuses.indexOf('thirdParty') !== -1 && subStatuses.indexOf('inProgress') === -1) {
        return 'thirdParty';
      }
      return 'inProgress';
    }

    return collect(task, list);
  }

  function computeRowStatus(rows, getChildren) {
    var result = new Map();
    if (!Array.isArray(rows)) return result;
    var resolve = typeof getChildren === 'function' ? getChildren : null;

    rows.forEach(function(row) {
      if (!row) return;
      var task = row.task;
      if (!task) return;
      var children = resolve ? resolve(task.id) : [];
      if (!Array.isArray(children)) children = [];
      var id = row.id !== undefined && row.id !== null ? row.id : task.id;
      result.set(id, rollupStatus(task, children, resolve));
    });

    return result;
  }

  return {
    clamp: clamp,
    leafProgress: leafProgress,
    durationWeight: durationWeight,
    rollupProgress: rollupProgress,
    computeRowProgress: computeRowProgress,
    statusFromProgress: statusFromProgress,
    rollupStatus: rollupStatus,
    computeRowStatus: computeRowStatus
  };
})();
