// ============================================================
// SyncUI: PocketBase 云端同步与协作界面管理
// 负责服务端配置、账号登录、同步状态指示、本地数据首次上传与队列联动。
// ============================================================
var SyncUI = (function() {
  'use strict';

  var STORAGE_KEY = 'pmweb_sync_config';
  var DEFAULT_SERVER = 'http://127.0.0.1:8090';
  var DEFAULT_PROJECT = 'default';

  var config = {
    serverUrl: DEFAULT_SERVER,
    projectId: DEFAULT_PROJECT,
    token: null,
    user: null,
    autoSync: false,
    cursor: 0,
    lastSyncAt: null
  };

  var state = {
    status: 'offline', // 'offline' | 'idle' | 'syncing' | 'synced' | 'queued' | 'error'
    lastError: null,
    inFlight: false
  };

  var client = null;
  var queue = null;
  var storage = null;
  var transport = null;
  var isApplyingRemote = false;
  var syncTimer = null;
  var attachedTaskManager = null;

  function loadConfig() {
    if (!storage) return;
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim()) {
            config.serverUrl = parsed.serverUrl.trim();
          }
          if (typeof parsed.projectId === 'string' && parsed.projectId.trim()) {
            config.projectId = parsed.projectId.trim();
          }
          if (typeof parsed.token === 'string') {
            config.token = parsed.token;
          } else if (parsed.token === null) {
            config.token = null;
          }
          if (parsed.user && typeof parsed.user === 'object') {
            config.user = parsed.user;
          }
          if (typeof parsed.autoSync === 'boolean') {
            config.autoSync = parsed.autoSync;
          }
          if (typeof parsed.cursor === 'number') {
            config.cursor = parsed.cursor;
          }
          if (typeof parsed.lastSyncAt === 'string') {
            config.lastSyncAt = parsed.lastSyncAt;
          }
        }
      }
    } catch (e) {
      console.warn('SyncUI: 加载配置失败', e);
    }
  }

  function saveConfig() {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('SyncUI: 保存配置失败', e);
    }
  }

  function resolveStorage(options) {
    if (options && options.storage) return options.storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }

  function reinitClient() {
    if (typeof SyncClient === 'undefined' || !SyncClient) return;
    var clientOptions = {
      baseUrl: config.serverUrl,
      projectId: config.projectId,
      token: config.token
    };
    if (transport) clientOptions.transport = transport;
    client = SyncClient.createClient(clientOptions);
  }

  function initRealtime() {
    if (typeof RealtimeClient === 'undefined' || !RealtimeClient || !config.token) return;
    RealtimeClient.init({
      baseUrl: config.serverUrl,
      projectId: config.projectId,
      token: config.token,
      user: config.user,
      taskManager: attachedTaskManager,
      onBatchApplied: function() {
        if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.render === 'function') {
          Workbench.render();
        }
      },
      onReconnect: function() {
        syncNow();
      }
    });
    RealtimeClient.connect();
  }

  function stopRealtime() {
    if (typeof RealtimeClient !== 'undefined' && RealtimeClient && typeof RealtimeClient.disconnect === 'function') {
      RealtimeClient.disconnect();
    }
  }

  function determineStatus() {
    if (state.inFlight) return 'syncing';
    if (state.lastError) return 'error';
    if (queue && queue.size() > 0) return 'queued';
    if (!config.token) return 'offline';
    if (typeof RealtimeClient !== 'undefined' && RealtimeClient && typeof RealtimeClient.getState === 'function') {
      var rt = RealtimeClient.getState();
      if (rt && rt.status === 'reconnecting') return 'reconnecting';
    }
    if (config.lastSyncAt) return 'synced';
    return 'idle';
  }

  function updateStatus(newStatus, errorMsg) {
    if (newStatus !== undefined) state.status = newStatus;
    else state.status = determineStatus();
    if (errorMsg !== undefined) state.lastError = errorMsg;
    updateIndicators();
  }

  function formatRelativeTime(iso) {
    if (!iso) return '从未同步';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '从未同步';
      var pad = function(n) { return n < 10 ? '0' + n : n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch (e) {
      return '从未同步';
    }
  }

  function statusLabel(st) {
    switch (st) {
      case 'offline': return '未连接';
      case 'idle': return '已就绪';
      case 'syncing': return '同步中...';
      case 'synced': return '已同步';
      case 'queued': return '待同步';
      case 'error': return '同步失败';
      case 'reconnecting': return '重连中...';
      default: return '离线';
    }
  }

  function init(options) {
    options = options || {};
    storage = resolveStorage(options);
    if (options.transport) transport = options.transport;
    if (options.serverUrl) config.serverUrl = options.serverUrl;
    if (options.projectId) config.projectId = options.projectId;

    loadConfig();

    if (typeof SyncQueue !== 'undefined' && SyncQueue) {
      queue = options.queue || SyncQueue.create({ storage: storage });
    }

    reinitClient();
    state.status = determineStatus();

    if (options.taskManager) {
      attachTaskManager(options.taskManager);
    } else if (typeof TaskManager !== 'undefined' && TaskManager) {
      attachTaskManager(TaskManager);
    }

    bindDomElements();
    updateIndicators();
    if (config.token) {
      initRealtime();
    }
  }

  function attachTaskManager(tm) {
    if (!tm || attachedTaskManager === tm) return;
    attachedTaskManager = tm;

    function wrap(methodName, entity, opExtractor) {
      var orig = tm[methodName];
      if (typeof orig !== 'function') return;
      tm[methodName] = function() {
        var res = orig.apply(this, arguments);
        if (!isApplyingRemote && res !== false && res !== null) {
          try {
            var info = opExtractor.apply(this, arguments);
            if (info) {
              enqueueChange(entity, info.entityId, info.op, info.payload);
            }
          } catch (err) {
            console.warn('SyncUI: 记录变更异常', err);
          }
        }
        return res;
      };
    }

    wrap('addTask', 'tasks', function(task) {
      return { entityId: task && task.id, op: 'create', payload: task };
    });
    wrap('updateTask', 'tasks', function(id, patch) {
      return { entityId: id, op: 'update', payload: patch };
    });
    wrap('deleteTask', 'tasks', function(id) {
      return { entityId: id, op: 'delete', payload: null };
    });
    wrap('addMilestone', 'milestones', function(ms) {
      return { entityId: ms && ms.id, op: 'create', payload: ms };
    });
    wrap('deleteMilestone', 'milestones', function(id) {
      return { entityId: id, op: 'delete', payload: null };
    });
    wrap('addLink', 'links', function(link) {
      return { entityId: link && link.id, op: 'create', payload: link };
    });
    wrap('deleteLink', 'links', function(id) {
      return { entityId: id, op: 'delete', payload: null };
    });
  }

  function enqueueChange(entity, entityId, op, payload) {
    if (!queue || !entityId) return null;
    var patchObj = null;
    if (payload && typeof payload === 'object') {
      patchObj = payload;
    } else if (op === 'delete') {
      patchObj = null;
    } else {
      patchObj = {};
    }

    var item = {
      projectId: config.projectId,
      entity: entity,
      entityId: entityId,
      op: op,
      patch: patchObj
    };
    var res = queue.enqueue(item);
    if (typeof RealtimeClient !== 'undefined' && RealtimeClient && typeof RealtimeClient.trackLocalOp === 'function') {
      RealtimeClient.trackLocalOp(item.id || (res && res.id));
    }
    updateStatus();

    if (config.autoSync && config.token) {
      scheduleSync(1000);
    }
    return res;
  }

  function scheduleSync(delayMs) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function() {
      syncTimer = null;
      syncNow();
    }, delayMs || 500);
  }

  function setServerUrl(url) {
    var trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) trimmed = DEFAULT_SERVER;
    config.serverUrl = trimmed;
    saveConfig();
    reinitClient();
    updateStatus();
    return config.serverUrl;
  }

  function setProjectId(id) {
    var trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed) trimmed = DEFAULT_PROJECT;
    config.projectId = trimmed;
    if (client) client.setProjectId(config.projectId);
    saveConfig();
    updateStatus();
    return config.projectId;
  }

  function setAutoSync(enabled) {
    config.autoSync = !!enabled;
    saveConfig();
    if (config.autoSync && config.token) {
      scheduleSync(100);
    }
  }

  function login(identity, password) {
    if (!client) reinitClient();
    if (!client) return Promise.reject(new Error('同步客户端未就绪'));
    state.inFlight = true;
    updateStatus('syncing', null);

    return client.login(identity, password).then(function(res) {
      config.token = res.token;
      config.user = res.record || { identity: identity };
      saveConfig();
      state.inFlight = false;
      state.lastError = null;
      updateStatus('idle', null);
      initRealtime();
      if (config.autoSync) {
        scheduleSync(200);
      }
      return res;
    }).catch(function(err) {
      state.inFlight = false;
      var msg = (err && err.message) || '登录失败';
      updateStatus('error', msg);
      throw err;
    });
  }

  function logout() {
    stopRealtime();
    if (client) client.logout();
    config.token = null;
    config.user = null;
    saveConfig();
    state.lastError = null;
    updateStatus('offline', null);
    return true;
  }

  function uploadInitialData(customData) {
    if (!client) reinitClient();
    if (!client) return Promise.reject(new Error('同步客户端未就绪'));

    var data = customData;
    if (!data && attachedTaskManager && typeof attachedTaskManager.exportData === 'function') {
      data = attachedTaskManager.exportData();
    }
    if (!data) return Promise.reject(new Error('没有可上传的本地数据'));

    state.inFlight = true;
    updateStatus('syncing', null);

    return Promise.resolve().then(function() {
      var migrateResult = client.migrateLocalData(data, { projectId: config.projectId });
      var ops = [];
      var cols = migrateResult.collections || {};
      var order = migrateResult.order || Object.keys(cols);

      order.forEach(function(colName) {
        var items = cols[colName] || [];
        items.forEach(function(rec) {
          var id = rec.external_id || rec.client_id || rec.id;
          if (!id) return;
          ops.push({
            entity: colName,
            entityId: id,
            op: 'create',
            patch: rec
          });
        });
      });

      if (ops.length === 0) {
        state.inFlight = false;
        config.lastSyncAt = new Date().toISOString();
        saveConfig();
        updateStatus('synced', null);
        return { total: 0, success: 0, failed: 0, skipped: migrateResult.errors || [] };
      }

      return client.pushChanges(ops).then(function(pushRes) {
        var results = pushRes.results || [];
        var successCount = 0;
        var failCount = 0;
        results.forEach(function(r) {
          if (r.status === 'ok') successCount++;
          else failCount++;
        });

        config.lastSyncAt = new Date().toISOString();
        saveConfig();
        state.inFlight = false;
        if (failCount > 0) {
          updateStatus('error', '部分项目上传失败 (' + failCount + '/' + results.length + ')');
        } else {
          state.lastError = null;
          updateStatus('synced', null);
        }
        return {
          total: ops.length,
          success: successCount,
          failed: failCount,
          skipped: migrateResult.errors || []
        };
      });
    }).catch(function(err) {
      state.inFlight = false;
      var msg = (err && err.message) || '首次上传失败';
      updateStatus('error', msg);
      throw err;
    });
  }

  function applyRemoteChanges(changes) {
    if (!attachedTaskManager || !Array.isArray(changes) || changes.length === 0) return;
    isApplyingRemote = true;
    try {
      changes.forEach(function(ch) {
        var entity = ch.entity;
        var id = ch.entityId;
        var rec = ch.record;
        if (!entity || !id) return;

        if (entity === 'tasks') {
          if (ch.op === 'delete' || (rec && rec.deleted)) {
            if (attachedTaskManager.getTask(id)) {
              attachedTaskManager.deleteTask(id);
            }
          } else if (rec) {
            var existing = attachedTaskManager.getTask(id);
            if (existing) {
              attachedTaskManager.updateTask(id, rec);
            } else {
              attachedTaskManager.addTask(rec);
            }
          }
        } else if (entity === 'milestones') {
          if (ch.op === 'delete' || (rec && rec.deleted)) {
            attachedTaskManager.deleteMilestone(id);
          } else if (rec) {
            var allMs = attachedTaskManager.getAllMilestones();
            var found = allMs.some(function(m) { return m.id === id; });
            if (!found) attachedTaskManager.addMilestone(rec);
          }
        } else if (entity === 'links') {
          if (ch.op === 'delete' || (rec && rec.deleted)) {
            attachedTaskManager.deleteLink(id);
          } else if (rec) {
            var allLinks = attachedTaskManager.getAllLinks();
            var exists = allLinks.some(function(l) { return l.id === id; });
            if (!exists) attachedTaskManager.addLink(rec);
          }
        }
      });
    } finally {
      isApplyingRemote = false;
    }
  }

  function getEligibleQueueItems(maxLimit) {
    if (!queue) return [];
    var all = queue.list();
    var res = [];
    var limit = maxLimit || 50;
    for (var i = 0; i < all.length && res.length < limit; i++) {
      var it = all[i];
      if (it.status !== 'dead') {
        res.push(it);
      }
    }
    return res;
  }

  function syncNow() {
    if (state.inFlight) return Promise.resolve({ skipped: true });
    if (!client) reinitClient();
    if (!client) return Promise.reject(new Error('同步客户端未就绪'));

    state.inFlight = true;
    updateStatus('syncing', null);

    var pendingOps = getEligibleQueueItems(50);
    var pushPromise = Promise.resolve();

    if (pendingOps && pendingOps.length > 0) {
      pushPromise = client.pushChanges(pendingOps).then(function(pushRes) {
        var results = pushRes.results || [];
        results.forEach(function(r) {
          if (r.status === 'ok') {
            queue.ack(r.opId);
            if (typeof RealtimeClient !== 'undefined' && RealtimeClient && typeof RealtimeClient.trackLocalOp === 'function') {
              RealtimeClient.trackLocalOp(r.opId);
            }
          } else {
            queue.fail(r.opId, r.message || '服务端拒绝');
          }
        });
      });
    }

    return pushPromise.then(function() {
      return client.pullChanges({ since: config.cursor });
    }).then(function(pullRes) {
      if (pullRes && Array.isArray(pullRes.changes)) {
        applyRemoteChanges(pullRes.changes);
        if (typeof pullRes.cursor === 'number') {
          config.cursor = pullRes.cursor;
        }
      }
      config.lastSyncAt = new Date().toISOString();
      state.lastError = null;
      state.inFlight = false;
      saveConfig();
      updateStatus();
      return { success: true };
    }).catch(function(err) {
      state.inFlight = false;
      var msg = (err && err.message) || '同步遇到异常';
      updateStatus('error', msg);
      throw err;
    });
  }

  function clearQueue() {
    if (!queue) return 0;
    var count = queue.clear();
    updateStatus();
    return count;
  }

  // ---- UI DOM 绑定与 Modal 渲染 ----

  function bindDomElements() {
    if (typeof document === 'undefined') return;
    var toolbar = document.getElementById('toolbar');
    if (toolbar && !document.getElementById('btn-sync')) {
      var btn = document.createElement('button');
      btn.className = 'btn';
      btn.id = 'btn-sync';
      btn.title = '云端同步与协作设置 (PocketBase)';
      btn.innerHTML = '<span class="sync-dot offline" id="sync-toolbar-dot"></span> <span id="sync-toolbar-text">云端同步</span>';
      btn.addEventListener('click', function() { openModal(); });

      var anchor = document.getElementById('btn-add-root-task');
      if (anchor && toolbar.insertBefore) {
        toolbar.insertBefore(btn, anchor);
      } else {
        toolbar.appendChild(btn);
      }
    }

    var statusBar = document.getElementById('status-bar');
    if (statusBar && !document.getElementById('status-sync')) {
      var item = document.createElement('span');
      item.className = 'status-item sync-status-indicator';
      item.id = 'status-sync';
      item.title = '点击管理 PocketBase 同步';
      item.innerHTML = '<span class="sync-dot offline" id="sync-status-dot"></span><span id="sync-status-text">未连接</span>';
      item.addEventListener('click', function() { openModal(); });

      var spacer = statusBar.querySelector('.spacer');
      if (spacer && statusBar.insertBefore) {
        statusBar.insertBefore(item, spacer);
      } else {
        statusBar.appendChild(item);
      }
    }
  }

  function updateIndicators() {
    if (typeof document === 'undefined') return;
    var currentSt = state.status;
    var lbl = statusLabel(currentSt);
    var qSize = queue ? queue.size() : 0;
    if (currentSt === 'queued' || qSize > 0) {
      lbl = '待同步 (' + qSize + ')';
    }

    var tbDot = document.getElementById('sync-toolbar-dot');
    var tbText = document.getElementById('sync-toolbar-text');
    if (tbDot) {
      tbDot.className = 'sync-dot ' + currentSt;
    }
    if (tbText) {
      tbText.textContent = currentSt === 'synced' ? '已同步' : (currentSt === 'syncing' ? '同步中' : '云端同步');
    }

    var stDot = document.getElementById('sync-status-dot');
    var stText = document.getElementById('sync-status-text');
    if (stDot) {
      stDot.className = 'sync-dot ' + currentSt;
    }
    if (stText) {
      stText.textContent = lbl;
    }
  }

  function buildModalHtml() {
    var qSize = queue ? queue.size() : 0;
    var userLabel = config.user ? (config.user.email || config.user.username || config.user.identity || '已登录用户') : '未登录';
    var isAuth = !!config.token;

    var html = '<div class="sync-modal-box">' +
      '<h2 class="modal-title">云端同步与协作设置 (PocketBase)</h2>' +
      '<div class="sync-modal-body">' +

      // 实时状态卡片
      '<div class="sync-card">' +
        '<div class="sync-card-title">' +
          '<span>当前状态</span>' +
          '<span class="sync-badge ' + state.status + '" id="sync-modal-badge">' + statusLabel(state.status) + '</span>' +
        '</div>' +
        '<div class="sync-meta-grid">' +
          '<span class="sync-meta-label">已认证账号</span>' +
          '<span class="sync-meta-value" id="sync-modal-user">' + userLabel + '</span>' +
          '<span class="sync-meta-label">待同步队列</span>' +
          '<span class="sync-meta-value" id="sync-modal-queue">' + qSize + ' 项</span>' +
          '<span class="sync-meta-label">最近同步时间</span>' +
          '<span class="sync-meta-value" id="sync-modal-last-time">' + formatRelativeTime(config.lastSyncAt) + '</span>' +
        '</div>' +
      '</div>' +

      // 提示条
      '<div class="sync-alert" id="sync-modal-alert"></div>' +

      // 服务端与项目配置
      '<div class="sync-card">' +
        '<div class="sync-card-title">服务端连接</div>' +
        '<div class="modal-field">' +
          '<label for="sync-cfg-server">PocketBase 地址</label>' +
          '<input type="text" id="sync-cfg-server" value="' + (config.serverUrl || '') + '" placeholder="http://127.0.0.1:8090">' +
        '</div>' +
        '<div class="modal-field">' +
          '<label for="sync-cfg-project">项目 ID</label>' +
          '<input type="text" id="sync-cfg-project" value="' + (config.projectId || '') + '" placeholder="项目标识">' +
        '</div>' +
        '<div class="modal-field" style="display:flex;align-items:center;gap:8px;">' +
          '<input type="checkbox" id="sync-cfg-auto" ' + (config.autoSync ? 'checked' : '') + ' style="width:auto;margin:0;">' +
          '<label for="sync-cfg-auto" style="margin:0;cursor:pointer;">自动后台同步（任务变更后自动推送到云端）</label>' +
        '</div>' +
      '</div>' +

      // 登录认证
      '<div class="sync-card">' +
        '<div class="sync-card-title">账号认证</div>' +
        (isAuth ?
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<div>当前以 <strong>' + userLabel + '</strong> 身份连接</div>' +
            '<button class="btn btn-danger" id="sync-btn-logout">退出登录</button>' +
          '</div>'
          :
          '<div>' +
            '<div class="sync-form-row">' +
              '<div class="modal-field">' +
                '<label for="sync-login-identity">邮箱 / 用户名</label>' +
                '<input type="text" id="sync-login-identity" placeholder="user@example.com">' +
              '</div>' +
              '<div class="modal-field">' +
                '<label for="sync-login-password">密码</label>' +
                '<input type="password" id="sync-login-password" placeholder="••••••••">' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:12px;display:flex;justify-content:flex-end;">' +
              '<button class="btn btn-primary" id="sync-btn-login">登录并连接</button>' +
            '</div>' +
          '</div>'
        ) +
      '</div>' +

      // 操作功能区
      '<div class="sync-card">' +
        '<div class="sync-card-title">同步动作</div>' +
        '<div class="sync-actions-row">' +
          '<button class="btn btn-primary" id="sync-btn-sync-now">立即双向同步</button>' +
          '<button class="btn" id="sync-btn-upload-initial" title="把当前浏览器所有任务与依赖上传到 PocketBase 项目">首次上传本地数据到云端</button>' +
          '<button class="btn" id="sync-btn-clear-queue">清空本地待推队列</button>' +
        '</div>' +
      '</div>' +

      '</div>' + // sync-modal-body

      '<div class="modal-actions">' +
        '<button class="btn" id="sync-modal-close">关闭</button>' +
      '</div>' +
    '</div>';

    return html;
  }

  function showAlert(msg, kind) {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('sync-modal-alert');
    if (!el) return;
    el.className = 'sync-alert active ' + (kind || 'info');
    el.textContent = msg;
  }

  function openModal() {
    if (typeof ModalManager === 'undefined' || !ModalManager) return;
    ModalManager.open(buildModalHtml());
    bindModalEvents();
  }

  function bindModalEvents() {
    if (typeof document === 'undefined') return;

    var serverInput = document.getElementById('sync-cfg-server');
    var projectInput = document.getElementById('sync-cfg-project');
    var autoSyncCheck = document.getElementById('sync-cfg-auto');

    if (serverInput) {
      serverInput.addEventListener('change', function() {
        setServerUrl(serverInput.value);
        showAlert('服务端地址已更新', 'info');
      });
    }

    if (projectInput) {
      projectInput.addEventListener('change', function() {
        setProjectId(projectInput.value);
        showAlert('项目 ID 已更新为 ' + config.projectId, 'info');
      });
    }

    if (autoSyncCheck) {
      autoSyncCheck.addEventListener('change', function() {
        setAutoSync(autoSyncCheck.checked);
        showAlert(config.autoSync ? '已开启自动后台同步' : '已关闭自动同步', 'info');
      });
    }

    var loginBtn = document.getElementById('sync-btn-login');
    if (loginBtn) {
      loginBtn.addEventListener('click', function() {
        var identity = (document.getElementById('sync-login-identity') || {}).value;
        var pass = (document.getElementById('sync-login-password') || {}).value;
        if (!identity || !pass) {
          showAlert('请输入邮箱和密码', 'error');
          return;
        }
        if (serverInput) setServerUrl(serverInput.value);
        if (projectInput) setProjectId(projectInput.value);

        loginBtn.disabled = true;
        loginBtn.textContent = '登录中...';
        login(identity, pass).then(function() {
          showAlert('登录成功', 'success');
          setTimeout(function() { openModal(); }, 600);
        }).catch(function(err) {
          showAlert('登录失败: ' + ((err && err.message) || '网络或密码错误'), 'error');
          loginBtn.disabled = false;
          loginBtn.textContent = '登录并连接';
        });
      });
    }

    var logoutBtn = document.getElementById('sync-btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        logout();
        showAlert('已退出登录', 'info');
        setTimeout(function() { openModal(); }, 400);
      });
    }

    var syncNowBtn = document.getElementById('sync-btn-sync-now');
    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', function() {
        if (serverInput) setServerUrl(serverInput.value);
        if (projectInput) setProjectId(projectInput.value);
        syncNowBtn.disabled = true;
        syncNowBtn.textContent = '同步中...';

        syncNow().then(function() {
          showAlert('同步完成', 'success');
          setTimeout(function() { openModal(); }, 600);
        }).catch(function(err) {
          showAlert('同步失败: ' + ((err && err.message) || '未知错误'), 'error');
          syncNowBtn.disabled = false;
          syncNowBtn.textContent = '立即双向同步';
        });
      });
    }

    var uploadInitialBtn = document.getElementById('sync-btn-upload-initial');
    if (uploadInitialBtn) {
      uploadInitialBtn.addEventListener('click', function() {
        if (!config.token) {
          showAlert('请先登录账号，再上传数据', 'error');
          return;
        }
        if (serverInput) setServerUrl(serverInput.value);
        if (projectInput) setProjectId(projectInput.value);
        uploadInitialBtn.disabled = true;
        uploadInitialBtn.textContent = '正在上传数据...';

        uploadInitialData().then(function(res) {
          showAlert('成功上传 ' + res.success + ' 项数据至项目 [' + config.projectId + ']', 'success');
          setTimeout(function() { openModal(); }, 800);
        }).catch(function(err) {
          showAlert('上传数据失败: ' + ((err && err.message) || '请检查服务端权限与网络'), 'error');
          uploadInitialBtn.disabled = false;
          uploadInitialBtn.textContent = '首次上传本地数据到云端';
        });
      });
    }

    var clearQueueBtn = document.getElementById('sync-btn-clear-queue');
    if (clearQueueBtn) {
      clearQueueBtn.addEventListener('click', function() {
        var n = clearQueue();
        showAlert('已清空本地待推队列 (' + n + ' 项)', 'info');
        setTimeout(function() { openModal(); }, 400);
      });
    }

    var closeBtn = document.getElementById('sync-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        if (typeof ModalManager !== 'undefined' && ModalManager) {
          ModalManager.close();
        }
      });
    }
  }

  return {
    init: init,
    getConfig: function() {
      return JSON.parse(JSON.stringify(config));
    },
    getState: function() {
      return {
        status: state.status,
        lastError: state.lastError,
        inFlight: state.inFlight,
        queueSize: queue ? queue.size() : 0,
        user: config.user,
        serverUrl: config.serverUrl,
        projectId: config.projectId,
        autoSync: config.autoSync,
        lastSyncAt: config.lastSyncAt
      };
    },
    getClient: function() { return client; },
    getQueue: function() { return queue; },
    setServerUrl: setServerUrl,
    setProjectId: setProjectId,
    setAutoSync: setAutoSync,
    login: login,
    logout: logout,
    uploadInitialData: uploadInitialData,
    syncNow: syncNow,
    clearQueue: clearQueue,
    enqueueChange: enqueueChange,
    attachTaskManager: attachTaskManager,
    openModal: openModal,
    buildModalHtml: buildModalHtml,
    updateIndicators: updateIndicators,
    _resetForTesting: function() {
      config = {
        serverUrl: DEFAULT_SERVER,
        projectId: DEFAULT_PROJECT,
        token: null,
        user: null,
        autoSync: false,
        cursor: 0,
        lastSyncAt: null
      };
      state = {
        status: 'offline',
        lastError: null,
        inFlight: false
      };
      client = null;
      queue = null;
      storage = null;
      transport = null;
      isApplyingRemote = false;
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      attachedTaskManager = null;
    }
  };
})();
