// ============================================================
// AttachmentStore: 附件二进制存储适配器
// 优先使用 IndexedDB，不可用时退回进程内内存 Map。
// 接口见 docs/design/11-collaboration.md 第 7 节。
// ============================================================
var AttachmentStore = (function() {
  'use strict';

  var DB_NAME = 'pmweb-attachments';
  var STORE_NAME = 'blobs';
  var DB_VERSION = 1;
  var memory = new Map();
  var dbPromise = null;
  var dbUnavailable = false;

  function indexedDbAvailable() {
    return !dbUnavailable &&
      typeof indexedDB !== 'undefined' && indexedDB &&
      typeof indexedDB.open === 'function';
  }

  function normalizeKey(key) {
    return typeof key === 'string' && key.length > 0 ? key : null;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function toRecord(blobKey, blob, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var size = opts.size;
    if (typeof size !== 'number' || !isFinite(size)) {
      size = blob && typeof blob.size === 'number' ? blob.size : 0;
    }
    return {
      blobKey: blobKey,
      blob: blob === undefined ? null : blob,
      size: size,
      type: typeof opts.type === 'string' ? opts.type : (blob && blob.type) || '',
      taskId: typeof opts.taskId === 'string' ? opts.taskId : '',
      createdAt: opts.createdAt || nowIso(),
      lastAccessAt: nowIso()
    };
  }

  function openDatabase() {
    if (!indexedDbAvailable()) {
      return Promise.reject(new Error('IndexedDB 不可用'));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
      var request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        dbUnavailable = true;
        reject(error);
        return;
      }
      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: 'blobKey' });
          store.createIndex('taskId', 'taskId', { unique: false });
        }
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() {
        dbUnavailable = true;
        reject(request.error || new Error('打开附件库失败'));
      };
    });
    return dbPromise;
  }

  function runTransaction(mode, run) {
    return openDatabase().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx;
        try {
          tx = db.transaction(STORE_NAME, mode);
        } catch (error) {
          reject(error);
          return;
        }
        var store = tx.objectStore(STORE_NAME);
        var result;
        try {
          result = run(store);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = function() { resolve(result); };
        tx.onerror = function() { reject(tx.error || new Error('附件库操作失败')); };
        tx.onabort = function() { reject(tx.error || new Error('附件库操作已取消')); };
      });
    });
  }

  function uniqueKeys(list) {
    var seen = new Set();
    var keys = [];
    list.forEach(function(key) {
      if (!key || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
    return keys;
  }

  function put(blobKey, blob, options) {
    var key = normalizeKey(blobKey);
    if (!key) return Promise.reject(new Error('blobKey 无效'));
    if (!indexedDbAvailable()) {
      return Promise.reject(new Error('IndexedDB 不可用，附件写入失败'));
    }
    var record = toRecord(blobKey, blob, options);
    return runTransaction('readwrite', function(store) {
      store.put(record);
    }).then(function() {
      memory.set(key, record);
    });
  }

  function get(blobKey) {
    var key = normalizeKey(blobKey);
    if (!key) return Promise.resolve(null);
    var cached = memory.get(key);
    if (cached && cached.blob) return Promise.resolve(cached.blob);
    if (!indexedDbAvailable()) return Promise.resolve(cached ? (cached.blob || null) : null);
    return openDatabase().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx;
        try {
          tx = db.transaction(STORE_NAME, 'readonly');
        } catch (err) {
          reject(err);
          return;
        }
        var store = tx.objectStore(STORE_NAME);
        var request = store.get(key);
        var value = null;
        request.onsuccess = function() {
          var record = request.result;
          if (record) {
            value = record.blob === undefined ? null : record.blob;
            memory.set(key, record);
          }
        };
        tx.oncomplete = function() { resolve(value); };
        tx.onerror = function() { reject(tx.error || new Error('读取附件失败')); };
        tx.onabort = function() { reject(tx.error || new Error('读取附件事务已中止')); };
      });
    }).catch(function() {
      return cached ? cached.blob || null : null;
    });
  }

  function remove(blobKey) {
    var key = normalizeKey(blobKey);
    if (!key) return Promise.resolve();
    memory.delete(key);
    if (!indexedDbAvailable()) return Promise.resolve();
    return runTransaction('readwrite', function(store) {
      store.delete(key);
    }).then(function() {
      memory.delete(key);
    }).catch(function() {
      return undefined;
    });
  }

  function listByTask(taskId) {
    if (typeof taskId !== 'string' || taskId.length === 0) return Promise.resolve([]);
    var memoryKeys = [];
    memory.forEach(function(record, key) {
      if (record && record.taskId === taskId) memoryKeys.push(key);
    });
    if (!indexedDbAvailable()) return Promise.resolve(uniqueKeys(memoryKeys));
    return openDatabase().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var keys = [];
        var source;
        try {
          source = store.index('taskId').getAll(taskId);
        } catch (error) {
          source = store.getAll();
        }
        source.onsuccess = function() {
          var records = source.result || [];
          records.forEach(function(record) {
            if (record && record.taskId === taskId) keys.push(record.blobKey);
          });
        };
        tx.oncomplete = function() { resolve(keys); };
        tx.onerror = function() { reject(tx.error || new Error('查询附件失败')); };
      });
    }).then(function(keys) {
      return uniqueKeys(memoryKeys.concat(keys));
    }).catch(function() {
      return uniqueKeys(memoryKeys);
    });
  }

  function has(blobKey) {
    var key = normalizeKey(blobKey);
    if (!key) return Promise.resolve(false);
    if (memory.has(key)) return Promise.resolve(true);
    return get(key).then(function(blob) { return blob !== null; });
  }

  function usage() {
    var count = 0;
    var bytes = 0;
    memory.forEach(function(record) {
      count++;
      if (record && typeof record.size === 'number' && isFinite(record.size)) bytes += record.size;
    });
    return Promise.resolve({ count: count, bytes: bytes });
  }

  function reset() {
    memory.clear();
    dbPromise = null;
    dbUnavailable = false;
    return Promise.resolve();
  }

  return {
    DB_NAME: DB_NAME,
    STORE_NAME: STORE_NAME,
    put: put,
    get: get,
    "delete": remove,
    listByTask: listByTask,
    has: has,
    usage: usage,
    reset: reset
  };
})();
