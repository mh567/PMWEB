// ============================================================
// WorkCalendar: 工作日历纯函数
// 不读写 localStorage，不修改传入的配置对象
// ============================================================
var WorkCalendar = (function() {
  'use strict';

  var MS_PER_DAY = 86400000;
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DEFAULT_WEEKENDS = [0, 6];
  var MAX_SEARCH_DAYS = 3660;

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

  function normalizeWeekends(value) {
    if (!Array.isArray(value)) return DEFAULT_WEEKENDS.slice();

    var result = [];
    value.forEach(function(item) {
      if (typeof item !== 'number' || !isFinite(item)) return;
      if (item !== Math.floor(item) || item < 0 || item > 6) return;
      if (result.indexOf(item) === -1) result.push(item);
    });
    result.sort(function(a, b) { return a - b; });
    return result;
  }

  function normalizeDateList(value) {
    var result = [];
    var seen = {};
    if (value === undefined || value === null) return result;

    var items;
    if (Array.isArray(value)) {
      items = value;
    } else if (typeof value === 'object' && typeof value.forEach === 'function') {
      items = [];
      value.forEach(function(item) { items.push(item); });
    } else {
      return result;
    }

    items.forEach(function(item) {
      var stamp = parseDate(item);
      if (stamp === null) return;
      var canonical = formatStamp(stamp);
      if (seen[canonical]) return;
      seen[canonical] = true;
      result.push(canonical);
    });
    result.sort();
    return result;
  }

  // options: { weekends?: number[], holidays?: string[], workdays?: string[] }
  // weekends 为星期编号，0 表示周日，6 表示周六
  // holidays 为 YYYY-MM-DD 日期数组，workdays 为调休补班日期数组
  // workdays 优先级最高，可让周末或节假日变为工作日
  function createConfig(options) {
    var opts = options && typeof options === 'object' ? options : {};
    return {
      weekends: opts.weekends === undefined ? DEFAULT_WEEKENDS.slice() : normalizeWeekends(opts.weekends),
      holidays: normalizeDateList(opts.holidays),
      workdays: normalizeDateList(opts.workdays)
    };
  }

  function resolve(config) {
    var normalized = createConfig(config);
    var weekendSet = new Set();
    normalized.weekends.forEach(function(day) { weekendSet.add(day); });
    var holidaySet = new Set();
    normalized.holidays.forEach(function(day) { holidaySet.add(day); });
    var workdaySet = new Set();
    normalized.workdays.forEach(function(day) { workdaySet.add(day); });

    return {
      weekendSet: weekendSet,
      holidaySet: holidaySet,
      workdaySet: workdaySet
    };
  }

  function isWorkingStamp(stamp, resolved) {
    var key = formatStamp(stamp);
    if (resolved.workdaySet.has(key)) return true;
    if (resolved.holidaySet.has(key)) return false;
    var weekday = new Date(stamp).getUTCDay();
    return !resolved.weekendSet.has(weekday);
  }

  function isWorkingDay(dateStr, config) {
    var stamp = parseDate(dateStr);
    if (stamp === null) return false;
    if (config && (config.calendar || config.calendarOverrides)) {
      if (typeof HolidaySource !== 'undefined' && HolidaySource && typeof HolidaySource.resolveDate === 'function') {
        return HolidaySource.resolveDate(dateStr, config.calendar, config.calendarOverrides || config).working;
      }
    }
    return isWorkingStamp(stamp, resolve(config));
  }

  // 含首尾统计工作日；非法日期或结束早于开始时返回 0
  function workingDaysBetween(startDate, endDate, config) {
    var start = parseDate(startDate);
    var end = parseDate(endDate);
    if (start === null || end === null) return 0;
    if (end < start) return 0;

    var resolved = resolve(config);
    var count = 0;
    for (var stamp = start; stamp <= end; stamp += MS_PER_DAY) {
      if (isWorkingStamp(stamp, resolved)) count++;
    }
    return count;
  }

  // days 为正向后、为负向前；0 返回原日期
  function addWorkingDays(dateStr, days, config) {
    var stamp = parseDate(dateStr);
    if (stamp === null) return null;

    var steps = typeof days === 'number' && isFinite(days) ? Math.trunc(days) : 0;
    if (steps === 0) return formatStamp(stamp);

    var direction = steps > 0 ? 1 : -1;
    var remaining = Math.abs(steps);
    var resolved = resolve(config);
    var guard = 0;
    var limit = remaining * 7 + MAX_SEARCH_DAYS;

    while (remaining > 0) {
      stamp += direction * MS_PER_DAY;
      if (isWorkingStamp(stamp, resolved)) remaining--;
      guard++;
      if (guard > limit) return null;
    }
    return formatStamp(stamp);
  }

  // direction: forward/next 向后找，backward/prev/previous 向前找
  // 已是工作日时原样返回；找不到返回 null
  function adjustToWorkingDay(dateStr, direction, config) {
    var stamp = parseDate(dateStr);
    if (stamp === null) return null;

    var reversed = direction === 'backward' || direction === 'prev' ||
      direction === 'previous' || direction === 'before' || direction === -1;
    var step = reversed ? -1 : 1;
    var resolved = resolve(config);

    if (isWorkingStamp(stamp, resolved)) return formatStamp(stamp);

    for (var i = 1; i <= MAX_SEARCH_DAYS; i++) {
      var next = stamp + step * i * MS_PER_DAY;
      if (isWorkingStamp(next, resolved)) return formatStamp(next);
    }
    return null;
  }

  // 供进度汇总使用的工作日权重，至少 1
  function durationWeight(startDate, endDate, config) {
    var count = workingDaysBetween(startDate, endDate, config);
    return count >= 1 ? count : 1;
  }

  function resolveDate(date, calendar, projectOverrides) {
    if (typeof HolidaySource !== 'undefined' && HolidaySource && typeof HolidaySource.resolveDate === 'function') {
      return HolidaySource.resolveDate(date, calendar, projectOverrides);
    }
    var stamp = parseDate(date);
    if (stamp === null) return { working: false, name: '', source: 'invalid' };
    var dt = new Date(stamp);
    var day = dt.getUTCDay();
    var isWeekend = (day === 0 || day === 6);
    return {
      working: !isWeekend,
      name: isWeekend ? '周末' : '工作日',
      source: 'rule'
    };
  }

  return {
    createConfig: createConfig,
    isWorkingDay: isWorkingDay,
    workingDaysBetween: workingDaysBetween,
    addWorkingDays: addWorkingDays,
    adjustToWorkingDay: adjustToWorkingDay,
    durationWeight: durationWeight,
    resolveDate: resolveDate
  };
})();
