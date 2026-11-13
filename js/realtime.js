// ============================================================
// RealtimeClient: PocketBase SSE 实时推送与协同在线状态管理
// 负责长连接管理、断线重连、自产生变更防回显、批量事件合并与协同心跳。
// ============================================================
var RealtimeClient = (function() {
  'use strict';

  var DEFAULT_HEARTBEAT_MS = 15000;
  var COLLABORATOR_TIMEOUT_MS = 45000;
  var BATCH_WINDOW_MS = 50;
  var OP_ID_EXPIRE_MS = 30000;

  var AVATAR_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#6366f1'
  ];

  var state = {
    status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    baseUrl: 'http://127.0.0.1:8090',
    projectId: 'default',
    clientId: null,
    token: null,
    currentUser: null,
    activeTaskId: null,
    collaborators: {}, // userId -> { id, name, email, avatarColor, activeTaskId, lastSeen }
    recentPushedOpIds: {}, // opId -> timestamp
    reconnectAttempts: 0
  };

  var transport = null;
  var connection = null;
  var reconnectTimer = null;
  var heartbeatTimer = null;
  var batchTimer = null;
  var pendingEvents = [];
  var onBatchApplied = null;
  var onReconnect = null;
  var attachedTaskManager = null;

  function safeSetTimeout(fn, ms) {
    if (typeof setTimeout !== 'undefined') return setTimeout(fn, ms);
    return null;
  }
  function safeClearTimeout(timer) {
    if (typeof clearTimeout !== 'undefined' && timer) clearTimeout(timer);
  }
  function safeSetInterval(fn, ms) {
    if (typeof setInterval !== 'undefined') return setInterval(fn, ms);
    return null;
  }
  function safeClearInterval(timer) {
    if (typeof clearInterval !== 'undefined' && timer) clearInterval(timer);
  }

  function pickColor(str) {
    var hash = 0;
    str = String(str || 'guest');
    for (var i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function getInitials(name) {
    if (!name || typeof name !== 'string') return '?';
    var trimmed = name.trim();
    if (trimmed.length <= 2) return trimmed;
    return trimmed.slice(0, 1).toUpperCase();
  }

  function pruneRecentOpIds() {
    var now = Date.now();
    var keys = Object.keys(state.recentPushedOpIds);
    keys.forEach(function(key) {
      if (now - state.recentPushedOpIds[key] > OP_ID_EXPIRE_MS) {
        delete state.recentPushedOpIds[key];
      }
    });
  }

  function trackLocalOp(opId) {
    if (!opId || typeof opId !== 'string') return;
    pruneRecentOpIds();
    state.recentPushedOpIds[opId] = Date.now();
  }

  function isLocalEcho(opId) {
    if (!opId || typeof opId !== 'string') return false;
    pruneRecentOpIds();
    return !!state.recentPushedOpIds[opId];
  }

  function init(options) {
    options = options || {};
    if (options.baseUrl) state.baseUrl = options.baseUrl;
    if (options.projectId) state.projectId = options.projectId;
    if (options.token) state.token = options.token;
    if (options.user) state.currentUser = options.user;
    if (options.transport) transport = options.transport;
    if (options.taskManager) attachedTaskManager = options.taskManager;
    if (typeof options.onBatchApplied === 'function') onBatchApplied = options.onBatchApplied;
    if (typeof options.onReconnect === 'function') onReconnect = options.onReconnect;

    renderCollaboratorBar();
  }

  function connect() {
    if (state.status === 'connected' || state.status === 'connecting') return;
    state.status = state.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
    updateIndicators();

    var sseUrl = state.baseUrl.replace(/\/+$/, '') + '/api/realtime';

    if (transport && typeof transport.connect === 'function') {
      connection = transport.connect(sseUrl, {
        onOpen: handleOpen,
        onMessage: handleMessage,
        onError: handleError
      });
      return;
    }

    if (typeof EventSource !== 'undefined') {
      try {
        var es = new EventSource(sseUrl);
        es.onopen = function() { handleOpen(); };
        es.onmessage = function(e) { handleMessage(e.data); };
        es.onerror = function() { handleError(); };
        connection = es;
      } catch (err) {
        handleError(err);
      }
    }
  }

  function disconnect() {
    if (connection) {
      if (typeof connection.close === 'function') connection.close();
      connection = null;
    }
    if (reconnectTimer) {
      safeClearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer) {
      safeClearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (batchTimer) {
      safeClearTimeout(batchTimer);
      batchTimer = null;
    }
    state.status = 'disconnected';
    state.clientId = null;
    updateIndicators();
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    var delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 15000);
    state.reconnectAttempts++;
    state.status = 'reconnecting';
    updateIndicators();

    reconnectTimer = safeSetTimeout(function() {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function handleOpen() {
    var wasReconnecting = (state.status === 'reconnecting' || state.reconnectAttempts > 0);
    state.status = 'connected';
    state.reconnectAttempts = 0;
    updateIndicators();

    // 开启协同心跳定时器
    if (!heartbeatTimer) {
      sendHeartbeat();
      heartbeatTimer = safeSetInterval(function() {
        sendHeartbeat();
        pruneCollaborators();
      }, DEFAULT_HEARTBEAT_MS);
    }

    // 断线恢复后触发增量补齐
    if (wasReconnecting && typeof onReconnect === 'function') {
      try {
        onReconnect();
      } catch (e) {
        console.warn('RealtimeClient: onReconnect 异常', e);
      }
    }
  }

  function handleError() {
    if (connection && typeof connection.close === 'function') {
      connection.close();
      connection = null;
    }
    state.status = 'reconnecting';
    updateIndicators();
    scheduleReconnect();
  }

  function handleMessage(rawData) {
    if (!rawData) return;
    var msg = rawData;
    if (typeof rawData === 'string') {
      try {
        msg = JSON.parse(rawData);
      } catch (e) {
        return;
      }
    }

    // 首次握手返回 clientId
    if (msg.clientId && !state.clientId) {
      state.clientId = msg.clientId;
      subscribeSubscriptions(msg.clientId);
      return;
    }

    // 心跳协同消息
    if (msg.type === 'presence' || (msg.record && msg.record.type === 'presence')) {
      var pres = msg.record || msg;
      updateCollaborator(pres);
      return;
    }

    // 变更推送
    if (msg.action && (msg.record || msg.entityId)) {
      var entity = msg.collection || msg.entity || 'tasks';
      var rec = msg.record || {};
      var opId = msg.opId || rec.opId;

      // 自产生回显过滤
      if (opId && isLocalEcho(opId)) {
        return;
      }

      pendingEvents.push({
        entity: entity,
        entityId: rec.client_id || rec.id || msg.entityId,
        op: msg.action,
        record: rec,
        rev: rec.rev,
        updated: rec.updated
      });

      scheduleBatchApply();
    }
  }

  function subscribeSubscriptions(cid) {
    // 真实环境下向 /api/realtime 发送 POST 订阅，此处使用 transport 或 fetch 封装
    if (transport && typeof transport.subscribe === 'function') {
      transport.subscribe(cid, ['tasks', 'milestones', 'links', 'comments', 'presence']);
    }
  }

  function scheduleBatchApply() {
    if (batchTimer) return;
    batchTimer = safeSetTimeout(function() {
      batchTimer = null;
      flushPendingBatch();
    }, BATCH_WINDOW_MS);
  }

  function flushPendingBatch() {
    if (pendingEvents.length === 0) return;
    var batch = pendingEvents.slice();
    pendingEvents = [];

    // 应用变更到本地 TaskManager
    if (attachedTaskManager) {
      applyBatchToTaskManager(batch);
    }

    if (typeof onBatchApplied === 'function') {
      try {
        onBatchApplied(batch);
      } catch (e) {
        console.warn('RealtimeClient: onBatchApplied 异常', e);
      }
    }
    renderCollaboratorBar();
  }

  function applyBatchToTaskManager(events) {
    var tm = attachedTaskManager;
    if (!tm) return;

    events.forEach(function(ev) {
      var entity = ev.entity;
      var id = ev.entityId;
      var rec = ev.record;
      if (!id) return;

      if (entity === 'tasks') {
        if (ev.op === 'delete' || (rec && rec.deleted)) {
          if (tm.getTask(id)) tm.deleteTask(id);
        } else if (rec) {
          if (tm.getTask(id)) tm.updateTask(id, rec);
          else tm.addTask(rec);
        }
      } else if (entity === 'milestones') {
        if (ev.op === 'delete' || (rec && rec.deleted)) {
          tm.deleteMilestone(id);
        } else if (rec) {
          var all = tm.getAllMilestones();
          if (!all.some(function(m) { return m.id === id; })) tm.addMilestone(rec);
        }
      } else if (entity === 'links') {
        if (ev.op === 'delete' || (rec && rec.deleted)) {
          tm.deleteLink(id);
        } else if (rec) {
          var links = tm.getAllLinks();
          if (!links.some(function(l) { return l.id === id; })) tm.addLink(rec);
        }
      }
    });
  }

  // ---- 协同在线状态 ----

  function updateCollaborator(pres) {
    if (!pres || !pres.userId) return;
    var uid = pres.userId;
    // 忽略自身上报
    if (state.currentUser && state.currentUser.id === uid) return;

    state.collaborators[uid] = {
      id: uid,
      name: pres.name || pres.email || '协作者',
      email: pres.email || '',
      avatarColor: pres.avatarColor || pickColor(uid),
      activeTaskId: pres.activeTaskId || null,
      lastSeen: Date.now()
    };
    renderCollaboratorBar();
  }

  function pruneCollaborators() {
    var now = Date.now();
    var keys = Object.keys(state.collaborators);
    var changed = false;
    keys.forEach(function(key) {
      if (now - state.collaborators[key].lastSeen > COLLABORATOR_TIMEOUT_MS) {
        delete state.collaborators[key];
        changed = true;
      }
    });
    if (changed) renderCollaboratorBar();
  }

  function sendHeartbeat(activeTaskId) {
    if (activeTaskId !== undefined) state.activeTaskId = activeTaskId;
    var user = state.currentUser || { id: 'local-user', name: '当前用户' };
    var payload = {
      type: 'presence',
      userId: user.id,
      name: user.name || user.email || '用户',
      email: user.email || '',
      avatarColor: pickColor(user.id),
      activeTaskId: state.activeTaskId,
      at: new Date().toISOString()
    };

    if (transport && typeof transport.sendPresence === 'function') {
      transport.sendPresence(payload);
    }
  }

  function getOnlineCollaborators() {
    pruneCollaborators();
    return Object.keys(state.collaborators).map(function(k) {
      return state.collaborators[k];
    });
  }

  function getCollaboratorForTask(taskId) {
    if (!taskId) return null;
    var list = getOnlineCollaborators();
    for (var i = 0; i < list.length; i++) {
      if (list[i].activeTaskId === taskId) return list[i];
    }
    return null;
  }

  // ---- UI 渲染与状态栏联动 ----

  function renderCollaboratorBar() {
    if (typeof document === 'undefined') return;
    var bar = document.getElementById('collaborators-bar');
    if (!bar) {
      var toolbar = document.getElementById('toolbar');
      if (toolbar) {
        bar = document.createElement('div');
        bar.id = 'collaborators-bar';
        var anchor = document.getElementById('btn-add-root-task');
        if (anchor && toolbar.insertBefore) {
          toolbar.insertBefore(bar, anchor);
        } else {
          toolbar.appendChild(bar);
        }
      }
    }
    if (!bar) return;

    var list = getOnlineCollaborators();
    if (list.length === 0) {
      bar.innerHTML = '';
      return;
    }

    var html = '';
    list.forEach(function(u) {
      var initial = getInitials(u.name);
      var taskDesc = u.activeTaskId ? ' (正在查看: ' + u.activeTaskId + ')' : '';
      html += '<div class="collaborator-avatar" style="background:' + u.avatarColor + ';" title="' + u.name + taskDesc + '">' +
        initial +
        '<span class="online-indicator"></span>' +
      '</div>';
    });
    html += '<span class="collaborators-count">' + list.length + ' 人在线</span>';
    bar.innerHTML = html;
  }

  function updateIndicators() {
    if (typeof document === 'undefined') return;
    var st = state.status;
    var dot = document.getElementById('sync-status-dot');
    var text = document.getElementById('sync-status-text');

    if (dot && text) {
      if (st === 'connected') {
        dot.className = 'sync-dot synced';
        text.textContent = '实时协同中';
      } else if (st === 'reconnecting') {
        dot.className = 'sync-dot queued';
        text.textContent = '重连中...';
      }
    }
  }

  return {
    init: init,
    connect: connect,
    disconnect: disconnect,
    trackLocalOp: trackLocalOp,
    isLocalEcho: isLocalEcho,
    handleMessage: handleMessage,
    sendHeartbeat: sendHeartbeat,
    updateCollaborator: updateCollaborator,
    getOnlineCollaborators: getOnlineCollaborators,
    getCollaboratorForTask: getCollaboratorForTask,
    getState: function() {
      return {
        status: state.status,
        clientId: state.clientId,
        reconnectAttempts: state.reconnectAttempts,
        collaboratorCount: Object.keys(state.collaborators).length,
        pendingCount: pendingEvents.length
      };
    },
    _flushPendingBatchForTesting: flushPendingBatch,
    _resetForTesting: function() {
      disconnect();
      state.status = 'disconnected';
      state.clientId = null;
      state.collaborators = {};
      state.recentPushedOpIds = {};
      state.reconnectAttempts = 0;
      pendingEvents = [];
      transport = null;
      onBatchApplied = null;
      onReconnect = null;
      attachedTaskManager = null;
    }
  };
})();
