// ============================================================
// Scheduler: 自动排期纯函数
// 依赖 links.js 的依赖口径，可选使用 work-calendar.js
// 不读写 localStorage，不修改传入的任务、依赖与配置
// ============================================================
var Scheduler = (function() {
  'use strict';

  var MS_PER_DAY = 86400000;
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  var TYPES = ['FS', 'SS', 'FF', 'SF'];

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

  // config 省略时为自然日；传入日历配置对象时启用工作日模式
  // 支持 { workCalendar: {...} }、直接传 { weekends, holidays, workdays }
  // { workCalendar: null } 或 { useWorkCalendar: false } 强制自然日
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

  function cloneTask(task) {
    var copy = {};
    Object.keys(task).forEach(function(key) {
      copy[key] = task[key];
    });
    return copy;
  }

  function isLocked(task) {
    return !!(task && (task.locked === true || task.manualLock === true));
  }

  function indexTasks(tasks) {
    var map = new Map();
    if (!tasks) return map;

    if (tasks instanceof Map) {
      tasks.forEach(function(value, key) {
        if (value && typeof value === 'object') map.set(key, value);
      });
      return map;
    }

    if (Array.isArray(tasks)) {
      tasks.forEach(function(task) {
        if (task && typeof task === 'object' && typeof task.id === 'string') {
          map.set(task.id, task);
        }
      });
      return map;
    }

    if (typeof tasks === 'object') {
      Object.keys(tasks).forEach(function(key) {
        if (tasks[key] && typeof tasks[key] === 'object') map.set(key, tasks[key]);
      });
    }
    return map;
  }

  function pushError(errors, code, message, linkId, taskId) {
    errors.push({
      code: code,
      message: message,
      linkId: linkId || null,
      taskId: taskId || null
    });
  }

  // 计算单个任务在依赖约束下的日期，返回新对象，不修改入参
  // 返回 { task, changed, errors }
  function scheduleTask(task, links, tasks, config) {
    var errors = [];

    if (!task || typeof task !== 'object') {
      pushError(errors, 'INVALID_TASK', 'task 必须是任务对象');
      return { task: null, changed: false, errors: errors };
    }

    var calendar = resolveCalendar(config);
    var index = indexTasks(tasks);
    var copy = cloneTask(task);
    var list = Array.isArray(links) ? links : [];
    var incoming = [];

    for (var i = 0; i < list.length; i++) {
      var link = list[i];
      if (link && link.target === task.id) incoming.push(link);
    }

    if (incoming.length === 0) {
      return { task: copy, changed: false, errors: errors };
    }

    var hasStart = task.startDate !== undefined && task.startDate !== null && task.startDate !== '';
    var hasEnd = task.endDate !== undefined && task.endDate !== null && task.endDate !== '';
    var start = isDate(task.startDate) ? task.startDate : null;
    var end = isDate(task.endDate) ? task.endDate : null;

    if (hasStart && !start) {
      pushError(errors, 'INVALID_DATE', '任务 "' + task.id + '" 的开始日期无效', null, task.id);
    }
    if (hasEnd && !end) {
      pushError(errors, 'INVALID_DATE', '任务 "' + task.id + '" 的结束日期无效', null, task.id);
    }
    if ((hasStart && !start) || (hasEnd && !end)) {
      return { task: copy, changed: false, errors: errors };
    }

    var startBound = null;
    var endBound = null;

    incoming.forEach(function(link) {
      if (link.source === link.target) {
        pushError(errors, 'SELF_REFERENCE', '依赖的 source 与 target 不能相同', link.id, task.id);
        return;
      }
      if (TYPES.indexOf(link.type) === -1) {
        pushError(errors, 'INVALID_TYPE', '依赖类型必须是 FS、SS、FF、SF 之一', link.id, task.id);
        return;
      }
      if (!isValidLag(link.lag)) {
        pushError(errors, 'INVALID_LAG', 'lag 必须是以天为单位的整数', link.id, task.id);
        return;
      }

      var source = index.get(link.source);
      if (!source) {
        pushError(errors, 'MISSING_SOURCE',
          '依赖引用了不存在的任务 "' + link.source + '"', link.id, link.source);
        return;
      }

      var baseField = (link.type === 'FS' || link.type === 'FF') ? 'endDate' : 'startDate';
      var base = source[baseField];
      if (!isDate(base)) {
        pushError(errors, 'MISSING_DATE',
          '前置任务 "' + link.source + '" 缺少有效的 ' + baseField, link.id, link.source);
        return;
      }

      var constraint = shiftDate(base, link.lag, calendar);
      if (!constraint) {
        pushError(errors, 'INVALID_DATE',
          '无法计算前置任务 "' + link.source + '" 的约束日期', link.id, link.source);
        return;
      }
      constraint = snapToWorkingDay(constraint, calendar);

      var field = (link.type === 'FS' || link.type === 'SS') ? 'startDate' : 'endDate';
      if (field === 'startDate') {
        if (!startBound || constraint > startBound) startBound = constraint;
      } else if (!endBound || constraint > endBound) {
        endBound = constraint;
      }
    });

    var duration = (start && end) ? durationBetween(start, end, calendar) : 1;
    var changed = false;

    if (startBound && (!start || start < startBound)) {
      start = startBound;
      end = addDuration(start, duration, calendar);
      changed = true;
    }

    if (endBound && (!end || end < endBound)) {
      end = endBound;
      start = subtractDuration(end, duration, calendar);
      changed = true;
    }

    if (start && !end) {
      end = addDuration(start, duration, calendar);
      changed = true;
    }
    if (end && !start) {
      start = subtractDuration(end, duration, calendar);
      changed = true;
    }

    if (start && end && start > end) {
      pushError(errors, 'CONFLICT',
        '任务 "' + task.id + '" 的依赖约束互相冲突', null, task.id);
      end = addDuration(start, duration, calendar);
    }

    if (!start || !end) {
      pushError(errors, 'INVALID_DATE',
        '任务 "' + task.id + '" 的日期无法排期', null, task.id);
      return { task: copy, changed: false, errors: errors };
    }

    copy.startDate = start;
    copy.endDate = end;
    changed = changed || copy.startDate !== task.startDate || copy.endDate !== task.endDate;

    return { task: copy, changed: changed, errors: errors };
  }

  // 按拓扑序批量排期，跳过锁定任务，返回 { tasks, changed, errors }
  // 输出保持入参任务顺序，不修改入参
  function scheduleAll(tasks, links, config) {
    var errors = [];
    var seen = new Set();

    function addError(code, message, linkId, taskId) {
      var key = code + '|' + (linkId || '') + '|' + (taskId || '');
      if (seen.has(key)) return;
      seen.add(key);
      errors.push({
        code: code,
        message: message,
        linkId: linkId || null,
        taskId: taskId || null
      });
    }

    function merge(list) {
      (list || []).forEach(function(error) {
        addError(error.code, error.message, error.linkId, error.taskId);
      });
    }

    if (!Array.isArray(tasks)) {
      addError('INVALID_TASKS', 'tasks 必须是数组');
      return { tasks: [], changed: false, errors: errors };
    }

    var list;
    if (links === undefined || links === null) {
      list = [];
    } else if (Array.isArray(links)) {
      list = links;
    } else {
      addError('INVALID_LINKS', 'links 必须是数组');
      return { tasks: tasks.map(cloneTask), changed: false, errors: errors };
    }

    var working = new Map();
    var order = [];

    tasks.forEach(function(task) {
      if (!task || typeof task !== 'object') {
        addError('INVALID_TASK', 'tasks 中存在非任务项');
        return;
      }
      if (typeof task.id === 'string') {
        if (working.has(task.id)) {
          addError('DUPLICATE_TASK', '任务 id 重复：' + task.id, null, task.id);
        } else {
          working.set(task.id, cloneTask(task));
          order.push(task.id);
        }
      }
      if (task.startDate !== undefined && task.startDate !== null &&
          task.startDate !== '' && !isDate(task.startDate)) {
        addError('INVALID_DATE', '任务 "' + task.id + '" 的开始日期无效', null, task.id);
      }
      if (task.endDate !== undefined && task.endDate !== null &&
          task.endDate !== '' && !isDate(task.endDate)) {
        addError('INVALID_DATE', '任务 "' + task.id + '" 的结束日期无效', null, task.id);
      }
    });

    list.forEach(function(link) {
      if (!link || typeof link !== 'object') {
        addError('INVALID_LINK', '依赖必须是对象');
        return;
      }
      if (TYPES.indexOf(link.type) === -1) {
        addError('INVALID_TYPE', '依赖类型必须是 FS、SS、FF、SF 之一', link.id);
      }
      if (!isValidLag(link.lag)) {
        addError('INVALID_LAG', 'lag 必须是以天为单位的整数', link.id);
      }
      if (typeof link.source !== 'string' || link.source === '' ||
          typeof link.target !== 'string' || link.target === '') {
        addError('INVALID_ENDPOINT', 'source 与 target 必须是非空字符串', link.id);
        return;
      }
      if (!working.has(link.source)) {
        addError('MISSING_SOURCE',
          '依赖引用了不存在的任务 "' + link.source + '"', link.id, link.source);
      }
      if (!working.has(link.target)) {
        addError('MISSING_TARGET',
          '依赖引用了不存在的任务 "' + link.target + '"', link.id, link.target);
      }
    });

    var succ = new Map();
    var indegree = new Map();
    var position = new Map();

    order.forEach(function(id, index) {
      succ.set(id, []);
      indegree.set(id, 0);
      position.set(id, index);
    });

    list.forEach(function(link) {
      if (!link || typeof link !== 'object') return;
      if (!working.has(link.source) || !working.has(link.target)) return;
      succ.get(link.source).push(link.target);
      indegree.set(link.target, indegree.get(link.target) + 1);
    });

    var ready = order.filter(function(id) {
      return indegree.get(id) === 0;
    });
    var sorted = [];

    while (ready.length > 0) {
      ready.sort(function(a, b) {
        return position.get(a) - position.get(b);
      });
      var current = ready.shift();
      sorted.push(current);

      var targets = succ.get(current);
      for (var i = 0; i < targets.length; i++) {
        var next = targets[i];
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) ready.push(next);
      }
    }

    if (sorted.length !== order.length) {
      var cycle = (typeof Links !== 'undefined' && Links &&
        typeof Links.detectCycle === 'function') ? Links.detectCycle(list) : null;
      addError('CYCLE', cycle && cycle.length > 0
        ? '依赖存在环路：' + cycle.join(' -> ')
        : '依赖存在环路，无法自动排期');
      return { tasks: tasks.map(cloneTask), changed: false, errors: errors };
    }

    var changed = false;

    sorted.forEach(function(id) {
      var current = working.get(id);
      if (!current || isLocked(current)) return;

      var result = scheduleTask(current, list, working, config);
      merge(result.errors);
      if (result.changed && result.task) {
        working.set(id, result.task);
        changed = true;
      }
    });

    var output = tasks.map(function(task) {
      if (task && typeof task === 'object' && typeof task.id === 'string' &&
          working.has(task.id)) {
        return working.get(task.id);
      }
      return task && typeof task === 'object' ? cloneTask(task) : task;
    });

    return { tasks: output, changed: changed, errors: errors };
  }

  return {
    scheduleTask: scheduleTask,
    scheduleAll: scheduleAll
  };
})();
