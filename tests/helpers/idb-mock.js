'use strict';

/**
 * 具有真实 oncomplete / onabort / onerror 异步时序的 IndexedDB 测试替身
 * 严格支持事务隔离、提交点及失败回滚，禁止仅用 Map 写成功冒充持久化。
 */
function createIndexedDBMock() {
  var dbs = new Map();
  var failOpen = false;
  var failOpenError = null;
  var failOnPutKey = null;
  var abortOnPutKey = null;
  var failOnTransaction = false;

  function IDBRequest() {
    this.result = undefined;
    this.error = null;
    this.source = null;
    this.transaction = null;
    this.onsuccess = null;
    this.onerror = null;
  }

  function IDBOpenDBRequest() {
    IDBRequest.call(this);
    this.onupgradeneeded = null;
    this.onblocked = null;
  }
  IDBOpenDBRequest.prototype = Object.create(IDBRequest.prototype);

  function cloneRecord(record) {
    if (!record || typeof record !== 'object') return record;
    var copy = {};
    Object.keys(record).forEach(function(k) {
      copy[k] = record[k];
    });
    return copy;
  }

  function MockObjectStore(db, tx, name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.transaction = tx;
    this._db = db;
    this._indexes = db._indexes[name] || {};
  }

  MockObjectStore.prototype.createIndex = function(name, keyPath, options) {
    this._db._indexes[this.name] = this._db._indexes[this.name] || {};
    this._db._indexes[this.name][name] = { name: name, keyPath: keyPath, options: options || {} };
  };

  MockObjectStore.prototype.index = function(name) {
    var self = this;
    return {
      getAll: function(value) {
        var req = new IDBRequest();
        req.source = self;
        req.transaction = self.transaction;
        self.transaction._schedule(function() {
          var storeData = self._db._stores[self.name] || new Map();
          var results = [];
          storeData.forEach(function(rec) {
            if (rec && rec[name] === value) {
              results.push(cloneRecord(rec));
            }
          });
          req.result = results;
          if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
        });
        return req;
      }
    };
  };

  MockObjectStore.prototype.put = function(value) {
    var req = new IDBRequest();
    req.source = this;
    req.transaction = this.transaction;
    var self = this;
    var key = (value && this.keyPath && value[this.keyPath]) || null;

    this.transaction._schedule(function() {
      if (failOnPutKey && key === failOnPutKey) {
        var err = new Error('注入的 IDB put 写入失败: ' + key);
        req.error = err;
        if (typeof req.onerror === 'function') req.onerror({ target: req });
        self.transaction._fail(err);
        return;
      }
      if (abortOnPutKey && key === abortOnPutKey) {
        self.transaction.abort();
        return;
      }
      // 在事务暂存区暂存变更
      self.transaction._stagedPuts.push({ storeName: self.name, key: key, value: cloneRecord(value) });
      req.result = key;
      if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
    });
    return req;
  };

  MockObjectStore.prototype.get = function(key) {
    var req = new IDBRequest();
    req.source = this;
    req.transaction = this.transaction;
    var self = this;

    this.transaction._schedule(function() {
      // 优先从已持久化的 store 读
      var storeData = self._db._stores[self.name] || new Map();
      var rec = storeData.get(key);
      req.result = rec ? cloneRecord(rec) : undefined;
      if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
    });
    return req;
  };

  MockObjectStore.prototype.delete = function(key) {
    var req = new IDBRequest();
    req.source = this;
    req.transaction = this.transaction;
    var self = this;

    this.transaction._schedule(function() {
      self.transaction._stagedDeletes.push({ storeName: self.name, key: key });
      req.result = undefined;
      if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
    });
    return req;
  };

  MockObjectStore.prototype.getAll = function() {
    var req = new IDBRequest();
    req.source = this;
    req.transaction = this.transaction;
    var self = this;

    this.transaction._schedule(function() {
      var storeData = self._db._stores[self.name] || new Map();
      var results = [];
      storeData.forEach(function(rec) {
        results.push(cloneRecord(rec));
      });
      req.result = results;
      if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
    });
    return req;
  };

  function MockTransaction(db, storeNames, mode) {
    this.db = db;
    this.mode = mode || 'readonly';
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._aborted = false;
    this._completed = false;
    this._tasks = [];
    this._stagedPuts = [];
    this._stagedDeletes = [];
    this._timer = null;

    var self = this;
    // 异步调度事务处理时序
    this._timer = setTimeout(function() {
      self._flush();
    }, 0);
  }

  MockTransaction.prototype.objectStore = function(name) {
    var keyPath = this.db._keyPaths[name] || 'blobKey';
    return new MockObjectStore(this.db, this, name, keyPath);
  };

  MockTransaction.prototype._schedule = function(task) {
    if (this._aborted || this._completed) return;
    this._tasks.push(task);
  };

  MockTransaction.prototype.abort = function() {
    if (this._aborted || this._completed) return;
    this._aborted = true;
    this._stagedPuts = [];
    this._stagedDeletes = [];
    var self = this;
    clearTimeout(this._timer);
    setTimeout(function() {
      if (typeof self.onabort === 'function') {
        self.onabort({ target: self });
      }
    }, 0);
  };

  MockTransaction.prototype._fail = function(error) {
    if (this._aborted || this._completed) return;
    this.error = error || new Error('IDB 事务失败');
    this.abort();
    if (typeof this.onerror === 'function') {
      this.onerror({ target: this });
    }
  };

  MockTransaction.prototype._flush = function() {
    if (this._aborted || this._completed) return;
    try {
      for (var i = 0; i < this._tasks.length; i++) {
        if (this._aborted) return;
        this._tasks[i]();
      }
      if (this._aborted) return;

      // 事务 oncomplete 之前应用所有暂存变更（提交点）
      var self = this;
      this._stagedPuts.forEach(function(item) {
        var storeData = self.db._stores[item.storeName] || new Map();
        storeData.set(item.key, item.value);
        self.db._stores[item.storeName] = storeData;
      });
      this._stagedDeletes.forEach(function(item) {
        var storeData = self.db._stores[item.storeName];
        if (storeData) storeData.delete(item.key);
      });

      this._completed = true;
      if (typeof this.oncomplete === 'function') {
        this.oncomplete({ target: this });
      }
    } catch (err) {
      this._fail(err);
    }
  };

  function MockDatabase(name, version) {
    this.name = name;
    this.version = version;
    this._stores = {};
    this._indexes = {};
    this._keyPaths = {};
    this.objectStoreNames = {
      contains: function(sName) {
        return !!this._stores[sName];
      }.bind(this)
    };
  }

  MockDatabase.prototype.createObjectStore = function(name, options) {
    this._stores[name] = this._stores[name] || new Map();
    this._keyPaths[name] = (options && options.keyPath) || null;
    return new MockObjectStore(this, null, name, this._keyPaths[name]);
  };

  MockDatabase.prototype.transaction = function(storeName, mode) {
    if (failOnTransaction) {
      throw new Error('注入的 IDB transaction 创建失败');
    }
    return new MockTransaction(this, storeName, mode);
  };

  MockDatabase.prototype.close = function() {};

  var api = {
    open: function(name, version) {
      var req = new IDBOpenDBRequest();
      if (failOpen) {
        setTimeout(function() {
          req.error = failOpenError || new Error('打开 IDB 失败');
          if (typeof req.onerror === 'function') req.onerror({ target: req });
        }, 0);
        return req;
      }

      setTimeout(function() {
        var db = dbs.get(name);
        var oldVersion = db ? db.version : 0;
        var needsUpgrade = !db || db.version !== version;
        if (!db) {
          db = new MockDatabase(name, version);
          dbs.set(name, db);
        }

        if (needsUpgrade && typeof req.onupgradeneeded === 'function') {
          req.result = db;
          req.onupgradeneeded({ target: req, oldVersion: oldVersion, newVersion: version });
        }

        req.result = db;
        if (typeof req.onsuccess === 'function') {
          req.onsuccess({ target: req });
        }
      }, 0);

      return req;
    },

    // 控制与断言接口
    setFailOpen: function(val, err) {
      failOpen = !!val;
      failOpenError = err || null;
    },
    setFailOnPutKey: function(key) {
      failOnPutKey = key || null;
    },
    setAbortOnPutKey: function(key) {
      abortOnPutKey = key || null;
    },
    setFailTransaction: function(val) {
      failOnTransaction = !!val;
    },
    getStoreData: function(dbName, storeName) {
      var db = dbs.get(dbName);
      if (!db || !db._stores[storeName]) return new Map();
      return db._stores[storeName];
    },
    reset: function() {
      dbs.clear();
      failOpen = false;
      failOpenError = null;
      failOnPutKey = null;
      abortOnPutKey = null;
      failOnTransaction = false;
    }
  };

  return api;
}

module.exports = {
  createIndexedDBMock: createIndexedDBMock
};
