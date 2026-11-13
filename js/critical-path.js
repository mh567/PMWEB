// ============================================================
// CriticalPath: 关键路径纯函数
// 只使用 FS 依赖，可选使用 work-calendar.js 的工作日口径
// 不读写 localStorage，不修改传入的任务、依赖与配置
// ============================================================
var CriticalPath = (function() {
  'use strict';

  var MS_PER_DAY = 86400000;
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

  function parseDate(value) {
    if (typeof value !== 'string') return null;
    var match = DATE_PATTERN.exec(value);
    if (!match) return null;

    var year = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    var day = parseInt(match[3], 10);
    var stamp = Date.UTC(year, month - 1, day);
    var date = new Date(stamp);

    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
      return null;
    }
    return stamp;
  }

  function formatStamp(stamp) {
    var date = new Date(stamp);
    return date.getUTCFullYear() + '-' +
      String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(date.getUTCDate()).padStart(2, '0');
  }

  function isDate(value) {
    return parseDate(value) !== null;
  }

  function addNaturalDays(dateString, days) {
    var stamp = parseDate(dateString);
    if (stamp === null) return null;
    return formatStamp(stamp + days * MS_PER_DAY);
  }

  function isValidLag(lag) {
    return typeof lag === 'number' && isFinite(lag) && Math.floor(lag) === lag;
  }

  function resolveCalendar(config) {
    if (!config || typeof config !== 'object') return null;
    if (config.useWorkCalendar === false) return null;
    if (typeof WorkCalendar === 'undefined' || !WorkCalendar ||
        typeof WorkCalendar.createConfig !== 'function') {
      return null;
    }
    var source = Object.prototype.hasOwnProperty.call(config, 'workCalendar')
      ? config.workCalendar
      : config;
    if (!source || typeof source !== 'object') return null;
    return WorkCalendar.createConfig(source);
  }

  function shiftDate(dateString, days, calendar) {
    if (!isDate(dateString)) return null;
    if (!calendar) return addNaturalDays(dateString, days);
    return WorkCalendar.addWorkingDays(dateString, days, calendar);
  }

  function snapToWorkingDay(dateString, calendar) {
    if (!calendar || !isDate(dateString)) return dateString;
    var snapped = WorkCalendar.adjustToWorkingDay(dateString, 'forward', calendar);
    return snapped === null ? dateString : snapped;
  }

  function durationBetween(startDate, endDate, calendar) {
    if (!isDate(startDate) || !isDate(endDate)) return 1;
    var count;
    if (calendar) {
      count = WorkCalendar.workingDaysBetween(startDate, endDate, calendar);
    } else {
      count = Math.round((parseDate(endDate) - parseDate(startDate)) / MS_PER_DAY) + 1;
    }
    return count >= 1 ? count : 1;
  }

  function addDuration(startDate, duration, calendar) {
    return shiftDate(startDate, duration - 1, calendar);
  }

  function subtractDuration(endDate, duration, calendar) {
    return shiftDate(endDate, -(duration - 1), calendar);
  }

  // 返回 endDate - startDate 的天数，工作日模式下按工作日计
  function diffDays(startDate, endDate, calendar) {
    var start = parseDate(startDate);
    var end = parseDate(endDate);
    if (start === null || end === null) return null;
    if (start === end) return 0;

    if (!calendar) {
      return Math.round((end - start) / MS_PER_DAY);
    }

    if (end > start) {
      return WorkCalendar.workingDaysBetween(startDate, endDate, calendar) - 1;
    }
    return -(WorkCalendar.workingDaysBetween(endDate, startDate, calendar) - 1);
  }

  function makeError(code, message, taskId, linkId) {
    return {
      code: code,
      message: message,
      taskId: taskId || null,
      linkId: linkId || null
    };
  }

  function blankNode(id) {
    return {
      id: id,
      duration: 0,
      earliestStart: null,
      earliestFinish: null,
      latestStart: null,
      latestFinish: null,
      totalFloat: null,
      critical: false
    };
  }

  // 按 FS 依赖计算最早/最晚日期与总浮动
  // 返回 { nodes, criticalIds, totalDuration, errors }
  function compute(tasks, links, config) {
    var errors = [];
    var calendar = resolveCalendar(config);

    if (!Array.isArray(tasks)) {
      errors.push(makeError('INVALID_TASKS', 'tasks 必须是数组'));
      return { nodes: [], criticalIds: [], totalDuration: 0, errors: errors };
    }

    var list;
    if (links === undefined || links === null) {
      list = [];
    } else if (Array.isArray(links)) {
      list = links;
    } else {
      errors.push(makeError('INVALID_LINKS', 'links 必须是数组'));
      list = [];
    }

    var nodes = new Map();
    var order = [];
    var validIds = [];
    var valid = new Set();
    var plannedStart = new Map();

    tasks.forEach(function(task) {
      if (!task || typeof task !== 'object' || typeof task.id !== 'string') {
        errors.push(makeError('INVALID_TASK', '任务缺少有效的 id'));
        return;
      }
      if (nodes.has(task.id)) {
        errors.push(makeError('DUPLICATE_TASK', '任务 id 重复："' + task.id + '"', task.id));
        return;
      }

      var node = blankNode(task.id);
      nodes.set(task.id, node);
      order.push(task.id);

      var startOk = isDate(task.startDate);
      var endOk = isDate(task.endDate);
      if (!startOk || !endOk) {
        errors.push(makeError('MISSING_DATE',
          '任务 "' + task.id + '" 缺少有效的开始或结束日期', task.id));
        return;
      }
      if (task.endDate < task.startDate) {
        errors.push(makeError('INVALID_RANGE',
          '任务 "' + task.id + '" 的结束日期早于开始日期', task.id));
        return;
      }

      node.duration = durationBetween(task.startDate, task.endDate, calendar);
      plannedStart.set(task.id, snapToWorkingDay(task.startDate, calendar));
      valid.add(task.id);
      validIds.push(task.id);
    });

    var preds = new Map();
    var succs = new Map();
    var fsLinks = [];

    order.forEach(function(id) {
      preds.set(id, []);
      succs.set(id, []);
    });

    list.forEach(function(link) {
      if (!link || typeof link !== 'object') {
        errors.push(makeError('INVALID_LINK', '依赖必须是对象'));
        return;
      }
      if (link.type !== 'FS') return;
      fsLinks.push(link);

      if (!isValidLag(link.lag)) {
        errors.push(makeError('INVALID_LAG', 'FS 依赖的 lag 必须是以天为单位的整数', null, link.id));
        return;
      }

      var hasSource = nodes.has(link.source);
      var hasTarget = nodes.has(link.target);
      if (!hasSource) {
        errors.push(makeError('MISSING_SOURCE',
          '依赖引用了不存在的任务 "' + link.source + '"', link.source, link.id));
      }
      if (!hasTarget) {
        errors.push(makeError('MISSING_TARGET',
          '依赖引用了不存在的任务 "' + link.target + '"', link.target, link.id));
      }
      if (!hasSource || !hasTarget) return;
      if (!valid.has(link.source) || !valid.has(link.target)) return;

      preds.get(link.target).push({ id: link.source, lag: link.lag });
      succs.get(link.source).push({ id: link.target, lag: link.lag });
    });

    var indegree = new Map();
    var position = new Map();
    validIds.forEach(function(id, index) {
      indegree.set(id, preds.get(id).length);
      position.set(id, index);
    });

    var ready = validIds.filter(function(id) {
      return indegree.get(id) === 0;
    });
    var topo = [];

    while (ready.length > 0) {
      ready.sort(function(a, b) {
        return position.get(a) - position.get(b);
      });
      var current = ready.shift();
      topo.push(current);

      var targets = succs.get(current);
      for (var i = 0; i < targets.length; i++) {
        var next = targets[i].id;
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) ready.push(next);
      }
    }

    if (topo.length !== validIds.length) {
      var cycle = (typeof Links !== 'undefined' && Links &&
        typeof Links.detectCycle === 'function') ? Links.detectCycle(fsLinks) : null;
      errors.push(makeError('CYCLE', cycle && cycle.length > 0
        ? 'FS 依赖存在环路：' + cycle.join(' -> ')
        : 'FS 依赖存在环路，无法计算关键路径'));
      return {
        nodes: order.map(function(id) { return nodes.get(id); }),
        criticalIds: [],
        totalDuration: 0,
        errors: errors
      };
    }

    topo.forEach(function(id) {
      var node = nodes.get(id);
      var earliestStart = plannedStart.get(id);
      var incoming = preds.get(id);

      for (var i = 0; i < incoming.length; i++) {
        var pred = nodes.get(incoming[i].id);
        var candidate = shiftDate(pred.earliestFinish, incoming[i].lag, calendar);
        if (!candidate) {
          errors.push(makeError('INVALID_DATE',
            '无法计算任务 "' + incoming[i].id + '" 到 "' + id + '" 的约束日期', id));
          continue;
        }
        candidate = snapToWorkingDay(candidate, calendar);
        if (candidate > earliestStart) earliestStart = candidate;
      }

      var earliestFinish = addDuration(earliestStart, node.duration, calendar);
      if (!earliestFinish) {
        errors.push(makeError('INVALID_DATE',
          '无法计算任务 "' + id + '" 的最早结束日期', id));
        return;
      }

      node.earliestStart = earliestStart;
      node.earliestFinish = earliestFinish;
    });

    var projectStart = null;
    var projectEnd = null;

    validIds.forEach(function(id) {
      var node = nodes.get(id);
      if (node.earliestStart && (!projectStart || node.earliestStart < projectStart)) {
        projectStart = node.earliestStart;
      }
      if (node.earliestFinish && (!projectEnd || node.earliestFinish > projectEnd)) {
        projectEnd = node.earliestFinish;
      }
    });

    if (!projectStart || !projectEnd) {
      return {
        nodes: order.map(function(id) { return nodes.get(id); }),
        criticalIds: [],
        totalDuration: 0,
        errors: errors
      };
    }

    for (var i = topo.length - 1; i >= 0; i--) {
      var id = topo[i];
      var node = nodes.get(id);
      var outgoing = succs.get(id);
      var latestFinish = projectEnd;

      for (var j = 0; j < outgoing.length; j++) {
        var successor = nodes.get(outgoing[j].id);
        var candidate = shiftDate(successor.latestStart, -outgoing[j].lag, calendar);
        if (candidate === null) {
          errors.push(makeError('INVALID_DATE',
            '无法计算任务 "' + id + '" 的最晚结束日期', id));
          continue;
        }
        if (candidate < latestFinish) latestFinish = candidate;
      }

      var latestStart = subtractDuration(latestFinish, node.duration, calendar);
      if (!latestStart) {
        errors.push(makeError('INVALID_DATE',
          '无法计算任务 "' + id + '" 的最晚开始日期', id));
        continue;
      }

      node.latestFinish = latestFinish;
      node.latestStart = latestStart;

      var totalFloat = diffDays(node.earliestStart, latestStart, calendar);
      if (totalFloat === null || totalFloat < 0) totalFloat = 0;
      node.totalFloat = totalFloat;
      node.critical = totalFloat === 0;
    }

    var criticalIds = order.filter(function(id) {
      var node = nodes.get(id);
      return !!node && node.critical === true;
    });

    return {
      nodes: order.map(function(id) { return nodes.get(id); }),
      criticalIds: criticalIds,
      totalDuration: durationBetween(projectStart, projectEnd, calendar),
      errors: errors
    };
  }

  function criticalTaskIds(tasks, links, config) {
    return compute(tasks, links, config).criticalIds;
  }

  return {
    compute: compute,
    criticalTaskIds: criticalTaskIds
  };
})();
