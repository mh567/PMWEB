// ============================================================
// Activity: 任务字段变更活动日志纯数据模型
// 不读写 localStorage，不修改传入对象，不生成 HTML
// ============================================================
var Activity = (function() {
  'use strict';

  var ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  var MAX_ACTOR_LENGTH = 120;
  var FIELDS = [
    'name',
    'status',
    'assignee',
    'startDate',
    'endDate',
    'plannedEndDate',
    'progress'
  ];
  var SEQUENCE = { value: 0 };

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function isValidId(value) {
    return typeof value === 'string' && ID_PATTERN.test(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function resolveTime(value) {
    return value === undefined || value === null ? nowIso() : value;
  }

  function nextId() {
    SEQUENCE.value++;
    return 'activity-' + SEQUENCE.value.toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);
  }

  function normalizeActor(actor) {
    if (typeof actor !== 'string') return null;
    var trimmed = actor.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_ACTOR_LENGTH) return null;
    return trimmed;
  }

  // undefined 与 null 都表示“字段为空”，比较时视为同一个值。
  function normalizeValue(value) {
    return value === undefined ? null : value;
  }

  function sameValue(a, b) {
    return a === b || (a !== a && b !== b);
  }

  function timeValue(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string') {
      var parsed = Date.parse(value);
      if (!isNaN(parsed)) return parsed;
    }
    return 0;
  }

  function compareEntries(a, b) {
    var diff = timeValue(a.at) - timeValue(b.at);
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id));
  }

  // 值没有变化时返回 null，不产生记录。
  function record(taskId, actor, field, before, after, at) {
    if (!isValidId(taskId)) return null;
    if (!isNonEmptyString(field)) return null;
    var normalizedActor = normalizeActor(actor);
    if (normalizedActor === null) return null;

    var beforeValue = normalizeValue(before);
    var afterValue = normalizeValue(after);
    if (sameValue(beforeValue, afterValue)) return null;

    return {
      id: nextId(),
      taskId: taskId,
      actor: normalizedActor,
      field: field,
      before: beforeValue,
      after: afterValue,
      at: resolveTime(at)
    };
  }

  // 按 at 升序返回指定任务的活动记录副本。
  function listByTask(activity, taskId) {
    if (!Array.isArray(activity) || !isNonEmptyString(taskId)) return [];
    return activity
      .filter(function(entry) {
        return entry && typeof entry === 'object' && entry.taskId === taskId;
      })
      .slice()
      .sort(compareEntries);
  }

  // 对固定字段集合逐个比较，只为发生变化的字段生成记录。
  function diffTask(beforeTask, afterTask, actor, at) {
    if (!beforeTask || typeof beforeTask !== 'object') return [];
    if (!afterTask || typeof afterTask !== 'object') return [];

    var entries = [];
    FIELDS.forEach(function(field) {
      var entry = record(beforeTask.id, actor, field, beforeTask[field], afterTask[field], at);
      if (entry) entries.push(entry);
    });
    return entries;
  }

  return {
    FIELDS: FIELDS.slice(),
    MAX_ACTOR_LENGTH: MAX_ACTOR_LENGTH,
    record: record,
    listByTask: listByTask,
    diffTask: diffTask
  };
})();
