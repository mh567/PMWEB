// ============================================================
// Baseline: 基线快照、校验与差异分析纯函数
// 不读写 localStorage，不修改传入对象
// ============================================================
var Baseline = (function() {
  'use strict';

  var VERSION = 1;
  var MS_PER_DAY = 86400000;
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
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

    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
      return null;
    }
    return stamp;
  }

  function normalizeDate(value) {
    return parseDate(value) === null ? null : value;
  }

  function normalizeProgress(value) {
    if (!isFiniteNumber(value)) return 0;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
  }

  function normalizeTask(task) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return null;
    if (typeof task.id !== 'string' || task.id === '') return null;

    return {
      id: task.id,
      name: typeof task.name === 'string' ? task.name : '',
      startDate: normalizeDate(task.startDate),
      endDate: normalizeDate(task.endDate),
      progress: normalizeProgress(task.progress)
    };
  }

  function compareId(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function collectTasks(tasks) {
    var map = new Map();
    if (!Array.isArray(tasks)) return map;

    tasks.forEach(function(task) {
      var normalized = normalizeTask(task);
      if (!normalized || map.has(normalized.id)) return;
      map.set(normalized.id, normalized);
    });

    return map;
  }

  // tasks: 任务数组，只读取 id、name、startDate、endDate、progress
  // capturedAt: ISO 时间字符串，省略时取当前时间
  // 返回按 id 升序排列的快照，同一 id 只保留首次出现的任务
  function createSnapshot(tasks, capturedAt) {
    var byId = collectTasks(tasks);
    var snapshotTasks = [];
    byId.forEach(function(task) {
      snapshotTasks.push({
        id: task.id,
        name: task.name,
        startDate: task.startDate,
        endDate: task.endDate,
        progress: task.progress
      });
    });
    snapshotTasks.sort(function(a, b) { return compareId(a.id, b.id); });

    return {
      version: VERSION,
      capturedAt: capturedAt === undefined ? new Date().toISOString() : capturedAt,
      tasks: snapshotTasks
    };
  }

  function buildIdSet(ids) {
    var set = new Set();
    if (Array.isArray(ids)) {
      ids.forEach(function(item) {
        if (typeof item === 'string') {
          set.add(item);
        } else if (item && typeof item.id === 'string') {
          set.add(item.id);
        }
      });
    } else if (ids && Object.prototype.toString.call(ids) === '[object Set]') {
      ids.forEach(function(id) {
        if (typeof id === 'string') set.add(id);
      });
    }
    return set;
  }

  // snapshot: 待校验快照
  // allowedIds: 可选白名单，数组、Set 或任务数组；提供时快照 id 必须全部在其中
  // 返回 { valid: boolean, errors: [{ index, code, message }] }
  function validateSnapshot(snapshot, allowedIds) {
    var errors = [];
    function add(index, code, message) {
      errors.push({ index: index, code: code, message: message });
    }

    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      add(null, 'INVALID_SNAPSHOT', '快照必须是对象');
      return { valid: false, errors: errors };
    }

    if (snapshot.version !== VERSION) {
      add(null, 'INVALID_VERSION', '版本必须是 ' + VERSION);
    }

    if (typeof snapshot.capturedAt !== 'string' || snapshot.capturedAt === '' ||
        isNaN(Date.parse(snapshot.capturedAt))) {
      add(null, 'INVALID_CAPTURED_AT', 'capturedAt 必须是可解析的时间字符串');
    }

    if (!Array.isArray(snapshot.tasks)) {
      add(null, 'INVALID_TASKS', 'tasks 必须是数组');
      return { valid: false, errors: errors };
    }

    var whitelist = allowedIds === undefined || allowedIds === null
      ? null
      : buildIdSet(allowedIds);
    var seen = new Set();

    for (var i = 0; i < snapshot.tasks.length; i++) {
      var task = snapshot.tasks[i];

      if (!task || typeof task !== 'object' || Array.isArray(task)) {
        add(i, 'INVALID_TASK', '任务快照必须是对象');
        continue;
      }

      if (typeof task.id !== 'string' || task.id === '') {
        add(i, 'INVALID_ID', '任务 id 必须是非空字符串');
      } else if (seen.has(task.id)) {
        add(i, 'DUPLICATE_ID', '任务 id "' + task.id + '" 重复');
      } else {
        seen.add(task.id);
        if (whitelist && !whitelist.has(task.id)) {
          add(i, 'NOT_IN_WHITELIST', '任务 id "' + task.id + '" 不在允许列表中');
        }
      }

      if (typeof task.name !== 'string') {
        add(i, 'INVALID_NAME', 'name 必须是字符串');
      }

      if (task.startDate !== null && parseDate(task.startDate) === null) {
        add(i, 'INVALID_DATE', 'startDate 必须是 YYYY-MM-DD 或 null');
      }

      if (task.endDate !== null && parseDate(task.endDate) === null) {
        add(i, 'INVALID_DATE', 'endDate 必须是 YYYY-MM-DD 或 null');
      }

      if (!isFiniteNumber(task.progress) || task.progress < 0 || task.progress > 100) {
        add(i, 'INVALID_PROGRESS', 'progress 必须是 0 到 100 的数字');
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // 当前日期相对基线的自然日差，正数表示延后，负数表示提前
  // 任一端缺失日期返回 null，两端都缺失返回 0
  function dateVariance(baselineDate, currentDate) {
    var baseline = parseDate(baselineDate);
    var current = parseDate(currentDate);

    if (baseline === null && current === null) return 0;
    if (baseline === null || current === null) return null;
    return Math.round((current - baseline) / MS_PER_DAY);
  }

  function makeEntry(id, baselineTask, currentTask) {
    var added = !baselineTask && !!currentTask;
    var removed = !!baselineTask && !currentTask;
    var compared = !added && !removed;

    var startVarianceDays = compared
      ? dateVariance(baselineTask.startDate, currentTask.startDate)
      : null;
    var endVarianceDays = compared
      ? dateVariance(baselineTask.endDate, currentTask.endDate)
      : null;
    var progressVariance = compared
      ? normalizeProgress(currentTask.progress) - normalizeProgress(baselineTask.progress)
      : null;

    var changed = compared && (
      baselineTask.name !== currentTask.name ||
      baselineTask.startDate !== currentTask.startDate ||
      baselineTask.endDate !== currentTask.endDate ||
      normalizeProgress(baselineTask.progress) !== normalizeProgress(currentTask.progress)
    );

    return {
      id: id,
      name: currentTask ? currentTask.name : baselineTask.name,
      baselineStartDate: baselineTask ? baselineTask.startDate : null,
      baselineEndDate: baselineTask ? baselineTask.endDate : null,
      baselineProgress: baselineTask ? baselineTask.progress : null,
      currentStartDate: currentTask ? currentTask.startDate : null,
      currentEndDate: currentTask ? currentTask.endDate : null,
      currentProgress: currentTask ? currentTask.progress : null,
      startVarianceDays: startVarianceDays,
      endVarianceDays: endVarianceDays,
      progressVariance: progressVariance,
      changed: changed,
      added: added,
      removed: removed
    };
  }

  // snapshot: createSnapshot 生成或已校验的快照
  // currentTasks: 当前任务数组
  // 返回 { tasks: entry[], added: id[], removed: id[] }，entry 按 id 升序
  function diff(snapshot, currentTasks) {
    var baselineById = collectTasks(snapshot && snapshot.tasks);
    var currentById = collectTasks(currentTasks);
    var ids = [];

    baselineById.forEach(function(task, id) { ids.push(id); });
    currentById.forEach(function(task, id) {
      if (!baselineById.has(id)) ids.push(id);
    });
    ids.sort(compareId);

    var entries = ids.map(function(id) {
      return makeEntry(id, baselineById.get(id) || null, currentById.get(id) || null);
    });

    var added = [];
    var removed = [];
    entries.forEach(function(entry) {
      if (entry.added) added.push(entry.id);
      if (entry.removed) removed.push(entry.id);
    });

    return { tasks: entries, added: added, removed: removed };
  }

  // diffResult: diff() 返回值
  // 返回变更、延期、提前、新增、删除的数量与平均延期天数
  // 延期/提前以 endVarianceDays 为准，平均延期只统计 endVarianceDays > 0 的任务
  function summarize(diffResult) {
    var entries = diffResult && Array.isArray(diffResult.tasks)
      ? diffResult.tasks
      : [];

    var changed = 0;
    var delayed = 0;
    var advanced = 0;
    var added = 0;
    var removed = 0;
    var delaySum = 0;

    entries.forEach(function(entry) {
      if (!entry) return;

      if (entry.added) {
        added++;
        return;
      }
      if (entry.removed) {
        removed++;
        return;
      }
      if (entry.changed) changed++;

      if (isFiniteNumber(entry.endVarianceDays)) {
        if (entry.endVarianceDays > 0) {
          delayed++;
          delaySum += entry.endVarianceDays;
        } else if (entry.endVarianceDays < 0) {
          advanced++;
        }
      }
    });

    return {
      total: entries.length,
      changed: changed,
      delayed: delayed,
      advanced: advanced,
      added: added,
      removed: removed,
      averageDelayDays: delayed > 0 ? Math.round((delaySum / delayed) * 100) / 100 : 0
    };
  }

  // 输出带符号的天数文本：+3、-2、0
  function formatVariance(days) {
    if (!isFiniteNumber(days)) return '0';
    var rounded = Math.round(days);
    if (rounded > 0) return '+' + rounded;
    if (rounded < 0) return String(rounded);
    return '0';
  }

  return {
    VERSION: VERSION,
    createSnapshot: createSnapshot,
    validateSnapshot: validateSnapshot,
    diff: diff,
    summarize: summarize,
    formatVariance: formatVariance
  };
})();
