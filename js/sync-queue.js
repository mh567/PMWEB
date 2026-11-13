// ============================================================
// SyncQueue: 基于 localStorage 的离线出站队列
// 纯数据操作，不直接发网络，不修改传入对象。
// 队列结构 { version, items: [OutboxItem] }。
// ============================================================
var SyncQueue = (function() {
  'use strict';

  var STORAGE_KEY = 'pmweb_sync_queue';
  var VERSION = 1;
  var DEFAULT_MAX_ATTEMPTS = 5;
  var DEFAULT_BASE_DELAY_MS = 1000;
  var DEFAULT_MAX_DELAY_MS = 60000;
  var OPS = ['create', 'update', 'delete'];
  var ENTITY_ALIASES = {
    task: 'tasks',
    milestone: 'milestones',
    link: 'links',
    comment: 'comments',
    activity: 'activity',
    attachment: 'attachments',
    view: 'views',
    setting: 'settings',
    settings: 'settings'
  };
  var configuredEntities = [
    'tasks', 'milestones', 'links', 'comments', 'activity',
    'attachments', 'views', 'settings'
  ];
  var sequence = 0;

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map(function(item) { return clone(item); });
    }
    var copy = {};
    Object.keys(value).forEach(function(key) {
      copy[key] = clone(value[key]);
    });
    return copy;
  }

  function createMemoryStorage() {
    var data = {};
    return {
      getItem: function(key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function(key, value) { data[key] = String(value); },
      removeItem: function(key) { delete data[key]; }
    };
  }

  function resolveStorage(storage) {
    if (storage && typeof storage.getItem === 'function' &&
        typeof storage.setItem === 'function') {
      return storage;
    }
    if (typeof localStorage !== 'undefined' && localStorage &&
        typeof localStorage.getItem === 'function') {
      return localStorage;
    }
    return createMemoryStorage();
  }

  function positiveInteger(value, fallback) {
    if (typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value > 0) {
      return value;
    }
    return fallback;
  }

  function nonNegativeNumber(value, fallback) {
    if (typeof value === 'number' && isFinite(value) && value >= 0) return value;
    return fallback;
  }

  function normalizeEntity(entity) {
    if (!isNonEmptyString(entity)) return null;
    var key = String(entity).trim();
    if (ENTITY_ALIASES[key]) return ENTITY_ALIASES[key];
    if (configuredEntities.indexOf(key) !== -1) return key;
    return null;
  }

  function errorMessage(error) {
    if (typeof error === 'string') return error;
    if (error && typeof error.message === 'string') return error.message;
    if (error === undefined || error === null) return '未知错误';
    try {
      return JSON.stringify(error);
    } catch (ignored) {
      return String(error);
    }
  }

  function copyItem(item) {
    return clone(item);
  }

  function create(options) {
    options = options || {};
    var key = isNonEmptyString(options.key) ? options.key : STORAGE_KEY;
    var storage = resolveStorage(options.storage);
    var maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    var baseDelayMs = nonNegativeNumber(options.baseDelayMs, DEFAULT_BASE_DELAY_MS);
    var maxDelayMs = nonNegativeNumber(options.maxDelayMs, DEFAULT_MAX_DELAY_MS);
    if (maxDelayMs < baseDelayMs) maxDelayMs = baseDelayMs;
    var clock = typeof options.now === 'function' ? options.now : function() {
      return Date.now();
    };

    function emptyState() {
      return { version: VERSION, items: [] };
    }

    function normalizeStored(raw) {
      if (!isPlainObject(raw) || !isNonEmptyString(raw.opId)) return null;
      var entity = normalizeEntity(raw.entity);
      if (!entity) return null;
      if (!isNonEmptyString(raw.entityId)) return null;
      if (OPS.indexOf(raw.op) === -1) return null;
      return {
        opId: raw.opId,
        projectId: raw.projectId === undefined ? null : raw.projectId,
        entity: entity,
        entityId: raw.entityId,
        op: raw.op,
        patch: raw.patch === undefined ? null : clone(raw.patch),
        baseRev: raw.baseRev === undefined ? null : raw.baseRev,
        clientAt: typeof raw.clientAt === 'number' ? raw.clientAt : clock(),
        attempts: typeof raw.attempts === 'number' && raw.attempts >= 0 ?
          Math.floor(raw.attempts) : 0,
        lastError: raw.lastError === undefined ? null : raw.lastError,
        nextAttemptAt: typeof raw.nextAttemptAt === 'number' ? raw.nextAttemptAt : 0,
        status: raw.status === 'dead' ? 'dead' : 'pending'
      };
    }

    function load() {
      var raw = null;
      try {
        raw = storage.getItem(key);
      } catch (error) {
        return emptyState();
      }
      if (!raw) return emptyState();
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return emptyState();
      }
      if (!isPlainObject(parsed) || !Array.isArray(parsed.items)) return emptyState();
      var items = [];
      var seen = {};
      parsed.items.forEach(function(candidate) {
        var item = normalizeStored(candidate);
        if (!item || seen[item.opId]) return;
        seen[item.opId] = true;
        items.push(item);
      });
      return { version: VERSION, items: items };
    }

    var state = load();

    function save() {
      try {
        storage.setItem(key, JSON.stringify(state));
        return true;
      } catch (error) {
        return false;
      }
    }

    function findIndex(opId) {
      if (!isNonEmptyString(opId)) return -1;
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].opId === opId) return i;
      }
      return -1;
    }

    function generateOpId() {
      sequence++;
      return 'op-' + clock().toString(36) + '-' + sequence.toString(36) + '-' +
        Math.random().toString(36).slice(2, 8);
    }

    function normalizeItem(item) {
      if (!isPlainObject(item)) {
        throw new TypeError('SyncQueue: 队列项必须是对象');
      }
      var entity = normalizeEntity(item.entity);
      if (!entity) {
        throw new TypeError('SyncQueue: entity 不合法');
      }
      if (!isNonEmptyString(item.entityId)) {
        throw new TypeError('SyncQueue: entityId 必须是非空字符串');
      }
      var op = item.op === undefined ? 'update' : item.op;
      if (OPS.indexOf(op) === -1) {
        throw new TypeError('SyncQueue: op 必须是 create、update 或 delete');
      }
      if (item.patch !== undefined && item.patch !== null && !isPlainObject(item.patch)) {
        throw new TypeError('SyncQueue: patch 必须是对象');
      }
      var opId = isNonEmptyString(item.opId) ? item.opId : generateOpId();
      return {
        opId: opId,
        projectId: item.projectId === undefined ? null : item.projectId,
        entity: entity,
        entityId: item.entityId,
        op: op,
        patch: item.patch === undefined ? null : clone(item.patch),
        baseRev: item.baseRev === undefined ? null : item.baseRev,
        clientAt: typeof item.clientAt === 'number' ? item.clientAt : clock(),
        attempts: 0,
        lastError: null,
        nextAttemptAt: 0,
        status: 'pending'
      };
    }

    function enqueue(item) {
      var normalized = normalizeItem(item);
      var existingIndex = findIndex(normalized.opId);
      if (existingIndex !== -1) {
        return { duplicate: true, item: copyItem(state.items[existingIndex]) };
      }
      state.items.push(normalized);
      save();
      return { duplicate: false, item: copyItem(normalized) };
    }

    function list() {
      return state.items.map(copyItem);
    }

    function get(opId) {
      var index = findIndex(opId);
      return index === -1 ? null : copyItem(state.items[index]);
    }

    function sameEntity(left, right) {
      return left.entity === right.entity && left.entityId === right.entityId;
    }

    function isBlocked(item, index) {
      for (var i = 0; i < index; i++) {
        if (sameEntity(state.items[i], item)) return true;
      }
      return false;
    }

    function peek(params) {
      params = params || {};
      var now = params.now === undefined ? clock() : Number(params.now);
      if (!isFinite(now)) now = clock();
      var includeDelayed = params.includeDelayed === true;
      var includeDead = params.includeDead === true;

      for (var i = 0; i < state.items.length; i++) {
        var item = state.items[i];
        if (!includeDead && item.status === 'dead') continue;
        if (!includeDelayed && item.nextAttemptAt && item.nextAttemptAt > now) continue;
        if (isBlocked(item, i)) continue;
        return copyItem(item);
      }
      return null;
    }

    function ack(opId) {
      var index = findIndex(opId);
      if (index === -1) return false;
      state.items.splice(index, 1);
      save();
      return true;
    }

    function backoffDelay(attempts) {
      var exponent = Math.min(Math.max(attempts - 1, 0), 30);
      var delay = baseDelayMs * Math.pow(2, exponent);
      return Math.min(delay, maxDelayMs);
    }

    function fail(opId, error) {
      var index = findIndex(opId);
      if (index === -1) return null;
      var item = state.items[index];
      item.attempts = (item.attempts || 0) + 1;
      item.lastError = errorMessage(error);
      if (item.attempts >= maxAttempts) {
        item.status = 'dead';
        item.nextAttemptAt = null;
      } else {
        item.status = 'pending';
        item.nextAttemptAt = clock() + backoffDelay(item.attempts);
      }
      save();
      return copyItem(item);
    }

    function clear() {
      var removed = state.items.length;
      state.items = [];
      save();
      return removed;
    }

    function size() {
      return state.items.length;
    }

    return {
      enqueue: enqueue,
      list: list,
      get: get,
      peek: peek,
      ack: ack,
      fail: fail,
      clear: clear,
      size: size,
      storageKey: function() { return key; },
      maxAttempts: function() { return maxAttempts; },
      baseDelayMs: function() { return baseDelayMs; },
      maxDelayMs: function() { return maxDelayMs; }
    };
  }

  var defaultQueue = null;

  function getDefault() {
    if (!defaultQueue) defaultQueue = create();
    return defaultQueue;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    VERSION: VERSION,
    DEFAULT_MAX_ATTEMPTS: DEFAULT_MAX_ATTEMPTS,
    DEFAULT_BASE_DELAY_MS: DEFAULT_BASE_DELAY_MS,
    DEFAULT_MAX_DELAY_MS: DEFAULT_MAX_DELAY_MS,
    create: create,
    enqueue: function(item) { return getDefault().enqueue(item); },
    list: function() { return getDefault().list(); },
    get: function(opId) { return getDefault().get(opId); },
    peek: function(params) { return getDefault().peek(params); },
    ack: function(opId) { return getDefault().ack(opId); },
    fail: function(opId, error) { return getDefault().fail(opId, error); },
    clear: function() { return getDefault().clear(); },
    size: function() { return getDefault().size(); },
    _resetDefault: function() { defaultQueue = null; }
  };
})();
