// ============================================================
// Resources: 资源与工作量汇总纯函数
// 不读写 localStorage，不修改传入的任务数组和配置对象
// ============================================================
var Resources = (function() {
  'use strict';

  var MS_PER_DAY = 86400000;
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DEFAULT_CAPACITY = 8;
  var DEFAULT_HOURS_PER_DAY = 8;
  var ROUND_PRECISION = 1e6;

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

  function startOfWeekStamp(stamp) {
    var weekday = new Date(stamp).getUTCDay();
    var offset = (weekday + 6) % 7;
    return stamp - offset * MS_PER_DAY;
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function round(value) {
    return Math.round(value * ROUND_PRECISION) / ROUND_PRECISION;
  }

  function normalizeCapacity(value, fallback) {
    return isFiniteNumber(value) && value >= 0 ? value : fallback;
  }

  function normalizeHours(value, fallback) {
    return isFiniteNumber(value) && value > 0 ? value : fallback;
  }

  function normalizeAssignee(value) {
    if (typeof value !== 'string') return null;
    var name = value.trim();
    return name === '' ? null : name;
  }

  function durationDays(start, end) {
    return Math.round((end - start) / MS_PER_DAY) + 1;
  }

  function taskHours(task, days, defaultHoursPerDay) {
    if (isFiniteNumber(task.estimatedHours) && task.estimatedHours >= 0) {
      return task.estimatedHours;
    }
    return defaultHoursPerDay * days;
  }

  function findConflicts(workload, capacity) {
    if (!workload || typeof workload !== 'object' || !workload.byAssignee) return [];

    var factor = workload.granularity === 'week' ? 7 : 1;
    var override = isFiniteNumber(capacity) && capacity >= 0 ? capacity : null;
    var conflicts = [];
    var names = Object.keys(workload.byAssignee).sort();

    names.forEach(function(name) {
      var entry = workload.byAssignee[name];
      if (!entry || !entry.dates) return;

      var perDay = override !== null
        ? override
        : normalizeCapacity(entry.capacityPerDay, DEFAULT_CAPACITY);
      var limit = round(perDay * factor);

      Object.keys(entry.dates).sort().forEach(function(key) {
        var hours = entry.dates[key];
        if (!isFiniteNumber(hours)) return;
        if (hours <= limit) return;
        conflicts.push({
          assignee: name,
          date: key,
          hours: round(hours),
          capacity: limit,
          overtime: round(hours - limit)
        });
      });
    });

    return conflicts;
  }

  function buildWorkload(tasks, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var granularity = opts.granularity === 'week' ? 'week' : 'day';
    var defaultCapacity = normalizeCapacity(opts.capacity, DEFAULT_CAPACITY);
    var hoursPerDay = normalizeHours(opts.hoursPerDay, DEFAULT_HOURS_PER_DAY);
    var capacityByAssignee = opts.capacityByAssignee &&
      typeof opts.capacityByAssignee === 'object' ? opts.capacityByAssignee : null;

    var assigneeMap = new Map();
    var dateMap = new Map();

    function resolveCapacity(assignee) {
      if (capacityByAssignee &&
          Object.prototype.hasOwnProperty.call(capacityByAssignee, assignee)) {
        return normalizeCapacity(capacityByAssignee[assignee], defaultCapacity);
      }
      return defaultCapacity;
    }

    function ensureAssignee(assignee) {
      if (assigneeMap.has(assignee)) return assigneeMap.get(assignee);
      var entry = {
        assignee: assignee,
        capacityPerDay: resolveCapacity(assignee),
        dates: new Map(),
        totalHours: 0
      };
      assigneeMap.set(assignee, entry);
      return entry;
    }

    if (Array.isArray(tasks)) {
      tasks.forEach(function(task) {
        if (!task) return;

        var assignee = normalizeAssignee(task.assignee);
        if (!assignee) return;

        var start = parseDate(task.startDate);
        var end = parseDate(task.endDate);
        if (start === null || end === null || end < start) return;

        var days = durationDays(start, end);
        if (days <= 0) return;

        var entry = ensureAssignee(assignee);
        var total = taskHours(task, days, hoursPerDay);
        if (!isFiniteNumber(total) || total <= 0) return;
        var perDay = total / days;

        for (var stamp = start; stamp <= end; stamp += MS_PER_DAY) {
          var bucketStamp = granularity === 'week' ? startOfWeekStamp(stamp) : stamp;
          var key = formatStamp(bucketStamp);

          entry.dates.set(key, (entry.dates.get(key) || 0) + perDay);
          entry.totalHours += perDay;

          var bucket = dateMap.get(key);
          if (!bucket) {
            bucket = { date: key, totalHours: 0, byAssignee: new Map() };
            dateMap.set(key, bucket);
          }
          bucket.totalHours += perDay;
          bucket.byAssignee.set(assignee, (bucket.byAssignee.get(assignee) || 0) + perDay);
        }
      });
    }

    var byAssignee = {};
    Array.from(assigneeMap.values())
      .sort(function(a, b) {
        if (a.assignee < b.assignee) return -1;
        if (a.assignee > b.assignee) return 1;
        return 0;
      })
      .forEach(function(entry) {
        var dates = {};
        Array.from(entry.dates.keys()).sort().forEach(function(key) {
          dates[key] = round(entry.dates.get(key));
        });
        byAssignee[entry.assignee] = {
          assignee: entry.assignee,
          capacityPerDay: entry.capacityPerDay,
          dates: dates,
          totalHours: round(entry.totalHours)
        };
      });

    var byDate = {};
    Array.from(dateMap.keys()).sort().forEach(function(key) {
      var bucket = dateMap.get(key);
      var perAssignee = {};
      Array.from(bucket.byAssignee.keys()).sort().forEach(function(name) {
        perAssignee[name] = round(bucket.byAssignee.get(name));
      });
      byDate[key] = {
        date: key,
        totalHours: round(bucket.totalHours),
        byAssignee: perAssignee
      };
    });

    var workload = {
      granularity: granularity,
      byAssignee: byAssignee,
      byDate: byDate
    };
    workload.conflicts = findConflicts(workload);
    return workload;
  }

  function summarize(workload) {
    var result = {
      totalAssignees: 0,
      totalHours: 0,
      overloadedAssignees: 0,
      overloadedDates: 0
    };
    if (!workload || typeof workload !== 'object' || !workload.byAssignee) return result;

    var names = Object.keys(workload.byAssignee);
    result.totalAssignees = names.length;

    var total = 0;
    names.forEach(function(name) {
      var entry = workload.byAssignee[name];
      if (entry && isFiniteNumber(entry.totalHours)) total += entry.totalHours;
    });
    result.totalHours = round(total);

    var conflicts = Array.isArray(workload.conflicts)
      ? workload.conflicts
      : findConflicts(workload);
    var people = new Set();
    var dates = new Set();
    conflicts.forEach(function(conflict) {
      if (!conflict) return;
      people.add(conflict.assignee);
      dates.add(conflict.date);
    });
    result.overloadedAssignees = people.size;
    result.overloadedDates = dates.size;

    return result;
  }

  return {
    buildWorkload: buildWorkload,
    findConflicts: findConflicts,
    summarize: summarize
  };
})();
