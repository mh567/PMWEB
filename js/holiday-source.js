// ============================================================
// HolidaySource: 中国法定节假日公开订阅、导入与一致日期标识
// 遵循纯函数与 Workspace 只读/并发保护
// ============================================================
(function(root) {
  'use strict';

  var DEFAULT_SOURCE = 'https://raw.githubusercontent.com/cg-zhou/holiday-calendar/main/data/CN/{year}.json';
  var inFlightByYear = {};
  var DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

  function parseDateParts(dateStr) {
    if (typeof dateStr !== 'string') return null;
    var match = DATE_REGEX.exec(dateStr);
    if (!match) return null;
    var year = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    var day = parseInt(match[3], 10);
    var stamp = Date.UTC(year, month - 1, day);
    var date = new Date(stamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }
    return {
      year: year,
      month: month,
      day: day,
      stamp: stamp,
      dayOfWeek: date.getUTCDay()
    };
  }

  function createInitialCalendarState(sourceState) {
    var base = {
      subscribed: true,
      source: DEFAULT_SOURCE,
      cacheByYear: {},
      importedByYear: {},
      lastAttemptByYear: {}
    };
    if (!sourceState || typeof sourceState !== 'object') return base;
    return {
      subscribed: sourceState.subscribed !== false,
      source: sourceState.source || DEFAULT_SOURCE,
      cacheByYear: sourceState.cacheByYear ? JSON.parse(JSON.stringify(sourceState.cacheByYear)) : {},
      importedByYear: sourceState.importedByYear ? JSON.parse(JSON.stringify(sourceState.importedByYear)) : {},
      lastAttemptByYear: sourceState.lastAttemptByYear ? JSON.parse(JSON.stringify(sourceState.lastAttemptByYear)) : {}
    };
  }

  function parseAnnual(input) {
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch (err) {
        throw new Error('parseAnnual: JSON 解析失败 - ' + err.message);
      }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('parseAnnual: 输入必须是非数组对象');
    }

    var year = Number(input.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new Error('parseAnnual: 非法年份: ' + input.year);
    }

    if (input.region !== 'CN') {
      throw new Error('parseAnnual: 只支持 CN 地区: ' + input.region);
    }

    if (!Array.isArray(input.dates)) {
      throw new Error('parseAnnual: dates 必须是数组');
    }

    var seen = new Set();
    var dates = [];

    for (var i = 0; i < input.dates.length; i++) {
      var item = input.dates[i];
      if (!item || typeof item !== 'object') {
        throw new Error('parseAnnual: dates 包含非法项');
      }
      var dateStr = String(item.date || '').trim();
      var parts = parseDateParts(dateStr);
      if (!parts) {
        throw new Error('parseAnnual: 无效公历日期: ' + dateStr);
      }
      if (parts.year !== year) {
        throw new Error('parseAnnual: 日期越年: ' + dateStr + ' 不属于 ' + year + ' 年度');
      }
      if (seen.has(dateStr)) {
        throw new Error('parseAnnual: 同日冲突与重复: ' + dateStr);
      }
      seen.add(dateStr);

      var type = String(item.type || '').trim();
      if (type !== 'public_holiday' && type !== 'transfer_workday') {
        throw new Error('parseAnnual: 非法日期类型: ' + type + '（仅允许 public_holiday 或 transfer_workday）');
      }

      var name = typeof item.name === 'string' && item.name.trim()
        ? item.name.trim()
        : (type === 'public_holiday' ? '法定节假日' : '调休补班');

      var dateObj = {
        date: dateStr,
        name: name,
        type: type
      };
      if (item.name_cn) dateObj.name_cn = item.name_cn;
      if (item.name_en) dateObj.name_en = item.name_en;
      dates.push(dateObj);
    }

    dates.sort(function(a, b) {
      return a.date.localeCompare(b.date);
    });

    return {
      year: year,
      region: 'CN',
      dates: dates
    };
  }

  function previewImport(input) {
    try {
      var parsed = parseAnnual(input);
      var holidayCount = 0;
      var workdayCount = 0;
      parsed.dates.forEach(function(item) {
        if (item.type === 'public_holiday') holidayCount++;
        else if (item.type === 'transfer_workday') workdayCount++;
      });
      return {
        valid: true,
        year: parsed.year,
        region: parsed.region,
        holidayCount: holidayCount,
        workdayCount: workdayCount,
        dates: parsed.dates
      };
    } catch (err) {
      return {
        valid: false,
        error: err.message
      };
    }
  }

  function importAnnual(calendar, annual) {
    var parsed = parseAnnual(annual);
    var state = createInitialCalendarState(calendar);
    var next = JSON.parse(JSON.stringify(state));
    if (!next.importedByYear) next.importedByYear = {};
    next.importedByYear[parsed.year] = parsed;
    return next;
  }

  function resolveDate(date, calendar, projectOverrides) {
    var parts = parseDateParts(date);
    if (!parts) {
      return { working: false, name: '', source: 'invalid' };
    }
    var year = parts.year;
    var dayOfWeek = parts.dayOfWeek;

    // 1. 项目手工例外优先级最高
    var ov = projectOverrides;
    while (ov && typeof ov === 'object' && !Array.isArray(ov) && ov.calendarOverrides && typeof ov.calendarOverrides === 'object') {
      ov = ov.calendarOverrides;
    }

    if (ov) {
      var manualMatch = null;
      if (typeof ov[date] !== 'undefined') {
        var rawVal = ov[date];
        if (typeof rawVal === 'boolean') {
          manualMatch = { working: rawVal, name: rawVal ? '项目工作日' : '项目休息日' };
        } else if (rawVal && typeof rawVal === 'object') {
          manualMatch = {
            working: Boolean(rawVal.working),
            name: rawVal.name || (rawVal.working ? '项目工作日' : '项目休息日')
          };
        }
      } else if (Array.isArray(ov)) {
        for (var i = 0; i < ov.length; i++) {
          if (ov[i] && ov[i].date === date) {
            manualMatch = {
              working: Boolean(ov[i].working),
              name: ov[i].name || (ov[i].working ? '项目工作日' : '项目休息日')
            };
            break;
          }
        }
      } else {
        if (Array.isArray(ov.workdays) && ov.workdays.indexOf(date) !== -1) {
          manualMatch = { working: true, name: '补班日' };
        } else if (Array.isArray(ov.holidays) && ov.holidays.indexOf(date) !== -1) {
          manualMatch = { working: false, name: '节假日' };
        }
      }

      if (manualMatch) {
        return {
          working: manualMatch.working,
          name: manualMatch.name,
          source: 'manual'
        };
      }
    }

    // 2. 导入假期与补班
    if (calendar && calendar.importedByYear && calendar.importedByYear[year]) {
      var importedList = calendar.importedByYear[year].dates;
      if (Array.isArray(importedList)) {
        for (var j = 0; j < importedList.length; j++) {
          if (importedList[j].date === date) {
            var impItem = importedList[j];
            return {
              working: impItem.type === 'transfer_workday',
              name: impItem.name || (impItem.type === 'transfer_workday' ? '调休补班' : '法定节假日'),
              source: 'import'
            };
          }
        }
      }
    }

    // 3. 启用订阅
    var isSubscribed = calendar ? (calendar.subscribed !== false) : true;
    if (isSubscribed && calendar && calendar.cacheByYear && calendar.cacheByYear[year]) {
      var cacheList = calendar.cacheByYear[year].dates;
      if (Array.isArray(cacheList)) {
        for (var k = 0; k < cacheList.length; k++) {
          if (cacheList[k].date === date) {
            var subItem = cacheList[k];
            return {
              working: subItem.type === 'transfer_workday',
              name: subItem.name || (subItem.type === 'transfer_workday' ? '调休补班' : '法定节假日'),
              source: 'subscription'
            };
          }
        }
      }
    }

    // 4. 周规则
    var weekends = [0, 6];
    var ovWeekends = (ov && Array.isArray(ov.weekends)) ? ov.weekends : (projectOverrides && Array.isArray(projectOverrides.weekends) ? projectOverrides.weekends : null);
    if (ovWeekends) {
      weekends = ovWeekends;
    } else if (calendar && Array.isArray(calendar.weekends)) {
      weekends = calendar.weekends;
    }

    var isWeekend = weekends.indexOf(dayOfWeek) !== -1;
    return {
      working: !isWeekend,
      name: isWeekend ? '周末' : '工作日',
      source: 'rule'
    };
  }

  function commitYearResultToWorkspace(year, parsed, attemptInfo) {
    var wsObj = (typeof Workspace !== 'undefined' && Workspace)
      ? Workspace
      : (typeof root !== 'undefined' && root.Workspace ? root.Workspace : null);

    if (wsObj && wsObj.data) {
      if (wsObj.isReadOnly()) return null;
      var currentWs = wsObj.data;
      var nextWs = JSON.parse(JSON.stringify(currentWs));
      if (!nextWs.calendar) {
        nextWs.calendar = createInitialCalendarState();
      }
      if (!nextWs.calendar.cacheByYear) {
        nextWs.calendar.cacheByYear = {};
      }
      if (!nextWs.calendar.lastAttemptByYear) {
        nextWs.calendar.lastAttemptByYear = {};
      }
      if (parsed) {
        nextWs.calendar.cacheByYear[year] = parsed;
      }
      if (attemptInfo) {
        nextWs.calendar.lastAttemptByYear[year] = attemptInfo;
      }
      wsObj.commit(nextWs);
      return nextWs.calendar;
    }
    return null;
  }

  function saveProjectCalendarOverrides(projectId, overrides) {
    var wsObj = (typeof Workspace !== 'undefined' && Workspace)
      ? Workspace
      : (typeof root !== 'undefined' && root.Workspace ? root.Workspace : null);

    if (!wsObj || !wsObj.data) return null;
    if (wsObj.isReadOnly()) {
      throw new Error('工作区处于只读状态，禁止保存项目日历覆盖');
    }
    var ws = wsObj.data;
    var nextWs = JSON.parse(JSON.stringify(ws));
    var project = null;
    if (Array.isArray(nextWs.projects)) {
      for (var i = 0; i < nextWs.projects.length; i++) {
        if (nextWs.projects[i].id === projectId) {
          project = nextWs.projects[i];
          break;
        }
      }
    }
    if (!project) {
      throw new Error('未找到项目: ' + projectId);
    }
    if (project.archived) {
      throw new Error('已归档项目处于只读状态，禁止保存项目日历覆盖');
    }
    if (!project.data) project.data = {};
    if (!project.data.settings) project.data.settings = {};
    project.data.settings.calendarOverrides = overrides;
    project.updatedAt = new Date().toISOString();
    wsObj.commit(nextWs);
    return project.data.settings.calendarOverrides;
  }

  function refresh(year, options) {
    year = Number(year);
    options = options || {};
    var force = Boolean(options.force);
    var nowVal = options.now !== undefined ? options.now : Date.now();
    var nowTs = typeof nowVal === 'number' ? nowVal : (nowVal instanceof Date ? nowVal.getTime() : Date.now());
    var nowIso = new Date(nowTs).toISOString();

    if (inFlightByYear[year]) {
      return inFlightByYear[year];
    }

    var wsObj = (typeof Workspace !== 'undefined' && Workspace)
      ? Workspace
      : (typeof root !== 'undefined' && root.Workspace ? root.Workspace : null);

    var calendarState;
    if (options.calendar) {
      calendarState = createInitialCalendarState(options.calendar);
    } else if (wsObj && wsObj.data && wsObj.data.calendar) {
      calendarState = createInitialCalendarState(wsObj.data.calendar);
    } else {
      calendarState = createInitialCalendarState();
    }

    if (!calendarState.subscribed && !force) {
      return Promise.resolve(calendarState);
    }

    if (!force && calendarState.cacheByYear[year] && calendarState.lastAttemptByYear[year]) {
      var lastTs = new Date(calendarState.lastAttemptByYear[year].timestamp).getTime();
      if (nowTs - lastTs < 86400000) {
        return Promise.resolve(calendarState);
      }
    }

    var fetchFn = options.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) {
      var noFetchErr = new Error('HolidaySource.refresh: 未提供有效的 fetch 接口');
      var failAttempt = {
        timestamp: nowIso,
        success: false,
        error: noFetchErr.message
      };
      calendarState.lastAttemptByYear[year] = failAttempt;
      if (options.calendar && typeof options.calendar === 'object') {
        if (!options.calendar.lastAttemptByYear) options.calendar.lastAttemptByYear = {};
        options.calendar.lastAttemptByYear[year] = failAttempt;
      }
      try {
        var failCommitted = commitYearResultToWorkspace(year, null, failAttempt);
        if (failCommitted) {
          calendarState = createInitialCalendarState(failCommitted);
        }
      } catch (commitErr) {}
      if (options.throwOnError) return Promise.reject(noFetchErr);
      return Promise.resolve(calendarState);
    }

    var sourceTemplate = calendarState.source || DEFAULT_SOURCE;
    if (sourceTemplate === 'cg-zhou/CN') sourceTemplate = DEFAULT_SOURCE;
    var url = sourceTemplate.replace('{year}', year).replace('${year}', year);

    var promise = Promise.resolve().then(function() {
      return fetchFn(url);
    }).then(function(response) {
      if (!response || !response.ok) {
        var status = response ? response.status : '网络错误';
        throw new Error('HTTP 状态异常: ' + status);
      }
      return response.text();
    }).then(function(text) {
      var parsed = parseAnnual(text);
      var succAttempt = {
        timestamp: nowIso,
        success: true
      };
      calendarState.cacheByYear[year] = parsed;
      calendarState.lastAttemptByYear[year] = succAttempt;
      if (options.calendar && typeof options.calendar === 'object') {
        if (!options.calendar.cacheByYear) options.calendar.cacheByYear = {};
        if (!options.calendar.lastAttemptByYear) options.calendar.lastAttemptByYear = {};
        options.calendar.cacheByYear[year] = parsed;
        options.calendar.lastAttemptByYear[year] = succAttempt;
      }
      var committedCal = commitYearResultToWorkspace(year, parsed, succAttempt);
      if (committedCal) {
        calendarState = createInitialCalendarState(committedCal);
      }
      return calendarState;
    }).catch(function(err) {
      var failAttempt = {
        timestamp: nowIso,
        success: false,
        error: err && err.message ? err.message : String(err)
      };
      calendarState.lastAttemptByYear[year] = failAttempt;
      if (options.calendar && typeof options.calendar === 'object') {
        if (!options.calendar.lastAttemptByYear) options.calendar.lastAttemptByYear = {};
        options.calendar.lastAttemptByYear[year] = failAttempt;
      }
      try {
        var failCommitted = commitYearResultToWorkspace(year, null, failAttempt);
        if (failCommitted) {
          calendarState = createInitialCalendarState(failCommitted);
        }
      } catch (commitErr) {
        // 忽略二次提交异常，保留初始错误与现有存储数据，防止级联未处理异常
      }
      if (options.throwOnError) throw err;
      return calendarState;
    }).finally(function() {
      delete inFlightByYear[year];
    });

    inFlightByYear[year] = promise;
    return promise;
  }

  function getStatus(calendar) {
    var state = createInitialCalendarState(calendar);
    return {
      subscribed: state.subscribed,
      source: state.source,
      cachedYears: Object.keys(state.cacheByYear || {}).map(Number).sort(),
      importedYears: Object.keys(state.importedByYear || {}).map(Number).sort(),
      lastAttemptByYear: state.lastAttemptByYear || {}
    };
  }

  var HolidaySource = {
    DEFAULT_SOURCE: DEFAULT_SOURCE,
    createInitialCalendarState: createInitialCalendarState,
    parseAnnual: parseAnnual,
    previewImport: previewImport,
    importAnnual: importAnnual,
    resolveDate: resolveDate,
    refresh: refresh,
    saveProjectCalendarOverrides: saveProjectCalendarOverrides,
    getStatus: getStatus
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = HolidaySource;
  }
  if (root) {
    root.HolidaySource = HolidaySource;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
