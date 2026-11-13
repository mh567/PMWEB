// ============================================================
// SyncClient: PocketBase 同步客户端
// 传输层可注入，默认使用 fetch，不依赖 PocketBase SDK。
// 不读写 localStorage，不访问 DOM。
// ============================================================
var SyncClient = (function() {
  'use strict';

  var VERSION = '1.0.0';
  var PROTOCOL_VERSION = 1;
  var PULL_COLLECTIONS = ['tasks', 'milestones', 'links', 'comments', 'activity', 'attachments'];
  var PUSH_COLLECTIONS = ['tasks', 'milestones', 'links', 'comments', 'attachments', 'views', 'settings'];
  var COLLECTIONS = PULL_COLLECTIONS.concat(['views', 'settings']);
  var COLLECTION_ORDER = [
    'tasks', 'milestones', 'links', 'comments', 'activity', 'attachments', 'views', 'settings'
  ];
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
  var OPS = ['create', 'update', 'delete'];
  var STRUCTURAL_FIELDS = {
    parentId: true,
    parent_id: true,
    order: true,
    sort_order: true,
    deleted: true,
    deleted_at: true
  };
  var META_FIELDS = {
    rev: true,
    updated: true,
    updated_at: true,
    created_at: true,
    updated_by: true,
    deleted: true,
    deleted_at: true,
    changed: true,
    changedFields: true,
    _changed: true
  };
  var opSequence = 0;

  function SyncError(kind, message, details) {
    this.name = 'SyncError';
    this.kind = kind;
    this.message = message;
    this.details = details === undefined ? null : details;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, SyncError);
    } else {
      this.stack = new Error(message).stack;
    }
  }
  SyncError.prototype = Object.create(Error.prototype);
  SyncError.prototype.constructor = SyncError;

  function isSyncError(error) {
    return error instanceof SyncError || !!(error && error.name === 'SyncError' && error.kind);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      !(value instanceof Date);
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

  function unique(list) {
    var seen = {};
    var result = [];
    list.forEach(function(item) {
      if (seen[item]) return;
      seen[item] = true;
      result.push(item);
    });
    return result;
  }

  function numberOr(value, fallback) {
    if (typeof value === 'number' && isFinite(value)) return value;
    return fallback;
  }

  function integerOr(value, fallback) {
    if (typeof value === 'number' && isFinite(value)) return Math.floor(value);
    return fallback;
  }

  function nullOrValue(value) {
    return value === undefined || value === null || value === '' ? null : value;
  }

  function normalizeBaseUrl(value) {
    var url = typeof value === 'string' ? value.trim() : '';
    while (url.length > 1 && url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    return url;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function resolveNow(value) {
    if (typeof value === 'function') return resolveNow(value());
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.length > 0) return value;
    return nowIso();
  }

  function generateOpId() {
    opSequence++;
    return 'op-' + Date.now().toString(36) + '-' + opSequence.toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function appendQuery(url, query) {
    if (!query) return url;
    var parts = [];
    Object.keys(query).forEach(function(key) {
      var value = query[key];
      if (value === undefined || value === null || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    if (parts.length === 0) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
  }

  function classificationForStatus(status) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 409) return 'conflict';
    if (status === 400 || status === 404 || status === 422) return 'validation';
    return 'server';
  }

  function classifyStatus(status) {
    return classificationForStatus(Number(status));
  }

  function errorMessageFromBody(body, status) {
    if (body && typeof body === 'object') {
      if (isNonEmptyString(body.message)) return body.message;
      if (isNonEmptyString(body.error)) return body.error;
    }
    if (typeof body === 'string' && body.length > 0) return body;
    return '请求失败：HTTP ' + status;
  }

  function errorFromResponse(status, body) {
    var kind = classificationForStatus(status);
    return new SyncError(kind, errorMessageFromBody(body, status), {
      status: status,
      body: body
    });
  }

  function fetchTransport(request) {
    if (typeof fetch !== 'function') {
      return Promise.reject(new SyncError('network', '当前环境没有 fetch，必须注入传输层'));
    }
    var init = {
      method: request.method,
      headers: request.headers
    };
    if (request.body !== null && request.body !== undefined) {
      init.body = JSON.stringify(request.body);
    }
    return fetch(request.url, init).then(function(response) {
      return response.text().then(function(text) {
        var data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (error) {
            data = text;
          }
        }
        return {
          status: response.status,
          data: data,
          headers: response.headers
        };
      });
    });
  }

  function normalizeEntity(entity) {
    if (!isNonEmptyString(entity)) return null;
    var key = String(entity).trim();
    if (ENTITY_ALIASES[key]) return ENTITY_ALIASES[key];
    if (COLLECTIONS.indexOf(key) !== -1) return key;
    return null;
  }

  function resolveChangedFields(record) {
    var candidates = [record.changed, record.changedFields, record._changed];
    for (var i = 0; i < candidates.length; i++) {
      var list = candidates[i];
      if (!Array.isArray(list)) continue;
      return unique(list.filter(function(field) {
        return typeof field === 'string' && field.length > 0;
      }));
    }
    return null;
  }

  function isTombstone(record) {
    if (!record || typeof record !== 'object') return false;
    if (record.deleted === true) return true;
    return record.deleted_at !== undefined && record.deleted_at !== null &&
      record.deleted_at !== '';
  }

  function timeValue(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string' && value.length > 0) {
      var parsed = Date.parse(value);
      if (!isNaN(parsed)) return parsed;
    }
    return null;
  }

  function revValue(record) {
    if (!record) return 0;
    var value = record.rev !== undefined ? record.rev : record.revision;
    return numberOr(value, 0);
  }

  function isNewer(left, right) {
    var leftTime = timeValue(left.updated);
    if (leftTime === null) leftTime = timeValue(left.updated_at);
    var rightTime = timeValue(right.updated);
    if (rightTime === null) rightTime = timeValue(right.updated_at);
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return leftTime > rightTime;
    }
    var leftRev = revValue(left);
    var rightRev = revValue(right);
    if (leftRev !== rightRev) return leftRev > rightRev;
    return false;
  }

  function sameValue(left, right) {
    if (left === right) return true;
    return left !== left && right !== right;
  }

  function makeTombstone(record) {
    var copy = clone(record);
    copy.deleted = true;
    if (copy.deleted_at === undefined || copy.deleted_at === null || copy.deleted_at === '') {
      if (copy.updated !== undefined && copy.updated !== null) {
        copy.deleted_at = copy.updated;
      } else if (copy.updated_at !== undefined && copy.updated_at !== null) {
        copy.deleted_at = copy.updated_at;
      }
    }
    return copy;
  }

  function resolveOutcome(record, conflicts, deleted, strategy, source) {
    return {
      record: record,
      conflicts: unique(conflicts),
      deleted: !!deleted,
      strategy: strategy,
      source: source
    };
  }

  // 按 updated / revision 做字段级合并，删除一律落成墓碑。
  function resolveConflict(local, remote, strategy) {
    if (!local && !remote) {
      throw new SyncError('validation', 'local 和 remote 至少需要一个对象');
    }
    if (local && !isPlainObject(local)) {
      throw new SyncError('validation', 'local 必须是普通对象');
    }
    if (remote && !isPlainObject(remote)) {
      throw new SyncError('validation', 'remote 必须是普通对象');
    }

    var choice = strategy === undefined || strategy === null ? 'merge' : strategy;
    if (choice !== 'local' && choice !== 'remote' && choice !== 'merge') {
      throw new SyncError('validation', 'strategy 必须是 local、remote 或 merge');
    }

    if (!local) {
      var remoteOnly = isTombstone(remote) ? makeTombstone(remote) : clone(remote);
      return resolveOutcome(remoteOnly, [], isTombstone(remote), choice, 'remote');
    }
    if (!remote) {
      var localOnly = isTombstone(local) ? makeTombstone(local) : clone(local);
      return resolveOutcome(localOnly, [], isTombstone(local), choice, 'local');
    }

    var localDeleted = isTombstone(local);
    var remoteDeleted = isTombstone(remote);

    if (choice === 'local') {
      var localPreferred = localDeleted ? makeTombstone(local) : clone(local);
      return resolveOutcome(localPreferred, [], localDeleted, choice, 'local');
    }
    if (choice === 'remote') {
      var remotePreferred = remoteDeleted ? makeTombstone(remote) : clone(remote);
      return resolveOutcome(remotePreferred, [], remoteDeleted, choice, 'remote');
    }

    if (localDeleted && remoteDeleted) {
      var tombSource = isNewer(local, remote) ? local : remote;
      return resolveOutcome(makeTombstone(tombSource), [], true, choice, 'merge');
    }

    if (remoteDeleted) {
      if (local.deleted === false && isNewer(local, remote)) {
        var restored = clone(local);
        delete restored.deleted;
        delete restored.deleted_at;
        return resolveOutcome(restored, ['deleted_at'], false, choice, 'local');
      }
      return resolveOutcome(makeTombstone(remote), ['deleted_at'], true, choice, 'remote');
    }

    if (localDeleted) {
      if (remote.deleted === false && isNewer(remote, local)) {
        var restoredRemote = clone(remote);
        delete restoredRemote.deleted;
        delete restoredRemote.deleted_at;
        return resolveOutcome(restoredRemote, ['deleted_at'], false, choice, 'remote');
      }
      return resolveOutcome(makeTombstone(local), ['deleted_at'], true, choice, 'local');
    }

    var merged = clone(remote);
    delete merged.changed;
    delete merged.changedFields;
    delete merged._changed;
    var conflicts = [];

    Object.keys(STRUCTURAL_FIELDS).forEach(function(field) {
      if (field === 'deleted' || field === 'deleted_at') return;
      if (!(field in local) && !(field in remote)) return;
      if (sameValue(local[field], remote[field])) return;
      conflicts.push(field);
      merged[field] = clone(remote[field]);
    });

    var localChanged = resolveChangedFields(local);
    var remoteChanged = resolveChangedFields(remote);
    var source = 'merge';

    if (localChanged && remoteChanged) {
      var overlap = localChanged.filter(function(field) {
        return remoteChanged.indexOf(field) !== -1 &&
          !META_FIELDS[field] && !STRUCTURAL_FIELDS[field];
      });
      localChanged.forEach(function(field) {
        if (META_FIELDS[field] || STRUCTURAL_FIELDS[field]) return;
        if (overlap.indexOf(field) !== -1) return;
        merged[field] = clone(local[field]);
      });
      overlap.forEach(function(field) {
        conflicts.push(field);
        merged[field] = isNewer(local, remote) ? clone(local[field]) : clone(remote[field]);
      });
    } else if (isNewer(local, remote)) {
      Object.keys(local).forEach(function(field) {
        if (META_FIELDS[field] || STRUCTURAL_FIELDS[field]) return;
        merged[field] = clone(local[field]);
      });
      source = 'local';
    } else {
      source = 'remote';
    }

    var newer = isNewer(local, remote) ? local : remote;
    if (newer.updated !== undefined) merged.updated = newer.updated;
    if (newer.updated_at !== undefined) merged.updated_at = newer.updated_at;
    merged.rev = Math.max(revValue(local), revValue(remote));

    return resolveOutcome(merged, conflicts, false, choice, source);
  }

  // ---- 迁移 ----

  function orderTasks(tasks, errors, now, user, project) {
    var byId = new Map();
    tasks.forEach(function(task) {
      if (task && typeof task.id === 'string' && !byId.has(task.id)) {
        byId.set(task.id, task);
      }
    });

    var ordered = [];
    var visited = new Set();
    var visiting = new Set();

    function visit(task) {
      if (!task || typeof task.id !== 'string') {
        ordered.push(task);
        return;
      }
      if (visited.has(task.id)) return;
      if (visiting.has(task.id)) {
        errors.push({
          path: 'tasks.' + task.id + '.parentId',
          code: 'CYCLE',
          message: '任务父子关系存在环路：' + task.id
        });
        return;
      }
      visiting.add(task.id);
      if (task.parentId !== null && task.parentId !== undefined) {
        if (byId.has(task.parentId)) {
          visit(byId.get(task.parentId));
        } else {
          errors.push({
            path: 'tasks.' + task.id + '.parentId',
            code: 'MISSING_PARENT',
            message: '父任务不存在：' + task.parentId
          });
        }
      }
      visiting.delete(task.id);
      visited.add(task.id);
      ordered.push(task);
    }

    tasks.forEach(visit);
    tasks.forEach(function(task) {
      if (task && typeof task.id === 'string' && !visited.has(task.id)) {
        visited.add(task.id);
        ordered.push(task);
      }
    });

    return ordered.map(function(task) {
      var parentId = task.parentId;
      if (parentId !== null && parentId !== undefined && !byId.has(parentId)) {
        parentId = null;
      }
      return {
        external_id: task.id,
        project: project,
        parent_external_id: parentId === undefined ? null : parentId,
        name: task.name,
        description: task.description === undefined ? '' : clone(task.description),
        assignee: task.assignee === undefined ? '' : clone(task.assignee),
        color: task.color === undefined ? null : clone(task.color),
        start_date: nullOrValue(task.startDate),
        end_date: nullOrValue(task.endDate),
        status: task.status === undefined ? 'inProgress' : task.status,
        sort_order: integerOr(task.order, 0),
        gantt_row: task.ganttRow === undefined ? null : clone(task.ganttRow),
        progress: numberOr(task.progress, 0),
        planned_end_date: nullOrValue(task.plannedEndDate),
        estimated_hours: task.estimatedHours === undefined ? null : clone(task.estimatedHours),
        locked: task.locked === true,
        rev: 1,
        created_at: now,
        updated_at: now,
        updated_by: user,
        deleted_at: null
      };
    });
  }

  function migrateLocalData(localData, options, defaultProjectId) {
    options = options || {};
    if (!isPlainObject(localData)) {
      throw new SyncError('validation', 'localData 必须是普通对象');
    }

    var projectId = options.projectId || defaultProjectId;
    if (!isNonEmptyString(projectId)) {
      throw new SyncError('validation', '迁移需要 projectId');
    }
    var now = resolveNow(options.now);
    var user = options.user === undefined ? null : options.user;
    var errors = [];

    var taskList = Array.isArray(localData.tasks) ? localData.tasks.filter(function(task) {
      if (isPlainObject(task) && isNonEmptyString(task.id)) return true;
      errors.push({ path: 'tasks', code: 'INVALID_TASK', message: '任务缺少合法 id，已跳过' });
      return false;
    }) : [];

    var taskIds = new Set();
    taskList.forEach(function(task) { taskIds.add(task.id); });

    var tasks = orderTasks(taskList, errors, now, user, projectId);

    var milestones = [];
    (Array.isArray(localData.milestones) ? localData.milestones : []).forEach(function(milestone) {
      if (!isPlainObject(milestone) || !isNonEmptyString(milestone.id)) {
        errors.push({ path: 'milestones', code: 'INVALID_MILESTONE', message: '里程碑缺少合法 id，已跳过' });
        return;
      }
      if (!taskIds.has(milestone.taskId)) {
        errors.push({
          path: 'milestones.' + milestone.id + '.taskId',
          code: 'ORPHAN_MILESTONE',
          message: '里程碑引用了不存在的任务：' + String(milestone.taskId)
        });
        return;
      }
      milestones.push({
        external_id: milestone.id,
        project: projectId,
        task_external_id: milestone.taskId,
        name: milestone.name,
        date: nullOrValue(milestone.date),
        status: milestone.status === undefined ? 'pending' : milestone.status,
        rev: 1,
        created_at: now,
        updated_at: now,
        updated_by: user,
        deleted_at: null
      });
    });

    var links = [];
    (Array.isArray(localData.links) ? localData.links : []).forEach(function(link) {
      if (!isPlainObject(link) || !isNonEmptyString(link.id)) {
        errors.push({ path: 'links', code: 'INVALID_LINK', message: '依赖缺少合法 id，已跳过' });
        return;
      }
      if (!taskIds.has(link.source) || !taskIds.has(link.target)) {
        errors.push({
          path: 'links.' + link.id,
          code: 'ORPHAN_LINK',
          message: '依赖端点引用了不存在的任务'
        });
        return;
      }
      if (link.source === link.target) {
        errors.push({
          path: 'links.' + link.id,
          code: 'SELF_REFERENCE',
          message: '依赖的 source 与 target 不能相同'
        });
        return;
      }
      links.push({
        external_id: link.id,
        project: projectId,
        source_external_id: link.source,
        target_external_id: link.target,
        type: link.type === undefined ? 'FS' : link.type,
        lag: integerOr(link.lag, 0),
        rev: 1,
        created_at: now,
        updated_at: now,
        updated_by: user,
        deleted_at: null
      });
    });

    var comments = [];
    (Array.isArray(localData.comments) ? localData.comments : []).forEach(function(comment) {
      if (!isPlainObject(comment) || !isNonEmptyString(comment.id)) {
        errors.push({ path: 'comments', code: 'INVALID_COMMENT', message: '评论缺少合法 id，已跳过' });
        return;
      }
      if (!taskIds.has(comment.taskId)) {
        errors.push({
          path: 'comments.' + comment.id + '.taskId',
          code: 'ORPHAN_COMMENT',
          message: '评论引用了不存在的任务：' + String(comment.taskId)
        });
        return;
      }
      comments.push({
        external_id: comment.id,
        project: projectId,
        task_external_id: comment.taskId,
        author_name: comment.author === undefined ? '' : clone(comment.author),
        text: comment.text === undefined ? '' : clone(comment.text),
        created_at: comment.createdAt === undefined ? now : comment.createdAt,
        updated_at: comment.updatedAt === undefined ? null : comment.updatedAt,
        deleted_at: null
      });
    });

    var activity = [];
    (Array.isArray(localData.activity) ? localData.activity : []).forEach(function(entry) {
      if (!isPlainObject(entry) || !isNonEmptyString(entry.id)) {
        errors.push({ path: 'activity', code: 'INVALID_ACTIVITY', message: '活动记录缺少合法 id，已跳过' });
        return;
      }
      if (!taskIds.has(entry.taskId)) {
        errors.push({
          path: 'activity.' + entry.id + '.taskId',
          code: 'ORPHAN_ACTIVITY',
          message: '活动记录引用了不存在的任务：' + String(entry.taskId)
        });
        return;
      }
      activity.push({
        external_id: entry.id,
        project: projectId,
        task_external_id: entry.taskId,
        actor_name: entry.actor === undefined ? '' : clone(entry.actor),
        field: entry.field === undefined ? '' : clone(entry.field),
        before_json: entry.before === undefined ? null : clone(entry.before),
        after_json: entry.after === undefined ? null : clone(entry.after),
        at: entry.at === undefined ? now : entry.at
      });
    });

    var attachments = [];
    (Array.isArray(localData.attachments) ? localData.attachments : []).forEach(function(meta) {
      if (!isPlainObject(meta) || !isNonEmptyString(meta.id)) {
        errors.push({ path: 'attachments', code: 'INVALID_ATTACHMENT', message: '附件元数据缺少合法 id，已跳过' });
        return;
      }
      if (!taskIds.has(meta.taskId)) {
        errors.push({
          path: 'attachments.' + meta.id + '.taskId',
          code: 'ORPHAN_ATTACHMENT',
          message: '附件引用了不存在的任务：' + String(meta.taskId)
        });
        return;
      }
      attachments.push({
        external_id: meta.id,
        project: projectId,
        task_external_id: meta.taskId,
        name: meta.name,
        size: meta.size,
        type: meta.type,
        storage_key: meta.blobKey === undefined ? null : clone(meta.blobKey),
        checksum: null,
        created_at: meta.createdAt === undefined ? now : meta.createdAt,
        deleted_at: null
      });
    });

    var views = [];
    (Array.isArray(localData.views) ? localData.views : []).forEach(function(view) {
      if (!isPlainObject(view) || !isNonEmptyString(view.id)) {
        errors.push({ path: 'views', code: 'INVALID_VIEW', message: '视图缺少合法 id，已跳过' });
        return;
      }
      var config = view.config !== undefined ? view.config :
        (view.settings !== undefined ? view.settings : null);
      views.push({
        external_id: view.id,
        project: projectId,
        name: view.name === undefined ? '' : clone(view.name),
        config_json: clone(config),
        rev: 1,
        created_at: now,
        updated_at: now,
        updated_by: user,
        deleted_at: null
      });
    });

    var settings = [{
      external_id: 'settings',
      project: projectId,
      settings_json: clone(localData.settings || {}),
      rev: 1,
      created_at: now,
      updated_at: now,
      updated_by: user,
      deleted_at: null
    }];

    var collections = {
      tasks: tasks,
      milestones: milestones,
      links: links,
      comments: comments,
      activity: activity,
      attachments: attachments,
      views: views,
      settings: settings
    };

    var counts = {};
    COLLECTION_ORDER.forEach(function(name) {
      counts[name] = collections[name].length;
    });

    return {
      protocolVersion: PROTOCOL_VERSION,
      projectId: projectId,
      sourceVersion: localData.pmweb_version === undefined ? null : localData.pmweb_version,
      generatedAt: now,
      order: COLLECTION_ORDER.slice(),
      counts: counts,
      errors: errors,
      collections: collections
    };
  }

  // ---- 请求规范化 ----

  function normalizeCollections(value) {
    if (value === undefined || value === null) return PULL_COLLECTIONS.slice();
    if (!Array.isArray(value)) {
      throw new SyncError('validation', 'collections 必须是数组');
    }
    var seen = {};
    var result = [];
    value.forEach(function(item) {
      var entity = normalizeEntity(item);
      if (!entity) {
        throw new SyncError('validation', '未知集合：' + String(item));
      }
      if (PULL_COLLECTIONS.indexOf(entity) === -1) {
        throw new SyncError('validation', '集合不支持增量拉取：' + entity);
      }
      if (seen[entity]) return;
      seen[entity] = true;
      result.push(entity);
    });
    return result;
  }

  function normalizeSince(value) {
    if (value === undefined || value === null || value === '') return 0;
    var parsed = typeof value === 'number' ? value : Number(value);
    if (!isFinite(parsed) || parsed < 0 || Math.floor(parsed) !== parsed) {
      throw new SyncError('validation', 'since 必须是非负整数');
    }
    return parsed;
  }

  function normalizeChange(change) {
    if (!isPlainObject(change)) {
      throw new SyncError('validation', '同步变更必须是对象');
    }
    var entity = normalizeEntity(change.entity || change.collection);
    if (!entity) {
      throw new SyncError('validation', '变更缺少合法 entity');
    }
    var record = isPlainObject(change.record) ? clone(change.record) : null;
    var entityId = change.entityId || change.id || (record && (record.external_id || record.id)) || null;
    if (!isNonEmptyString(entityId)) {
      throw new SyncError('validation', '变更缺少 entityId');
    }
    return {
      entity: entity,
      entityId: String(entityId),
      op: change.op === undefined ? 'update' : change.op,
      rev: change.rev === undefined ? null : change.rev,
      updated: change.updated === undefined ? null : change.updated,
      record: record
    };
  }

  function normalizePushOp(change, index) {
    if (!isPlainObject(change)) {
      throw new SyncError('validation', '第 ' + index + ' 条变更必须是对象');
    }
    var entity = normalizeEntity(change.entity || change.collection);
    if (!entity || PUSH_COLLECTIONS.indexOf(entity) === -1) {
      throw new SyncError('validation', '第 ' + index + ' 条变更的 entity 不支持推送');
    }
    if (!isNonEmptyString(change.entityId)) {
      throw new SyncError('validation', '第 ' + index + ' 条变更缺少 entityId');
    }
    var op = change.op === undefined ? 'update' : change.op;
    if (OPS.indexOf(op) === -1) {
      throw new SyncError('validation', '第 ' + index + ' 条变更的 op 必须是 create、update 或 delete');
    }
    var patch = change.patch === undefined ? null : change.patch;
    if (patch !== null && !isPlainObject(patch)) {
      throw new SyncError('validation', '第 ' + index + ' 条变更的 patch 必须是对象');
    }
    var opId = isNonEmptyString(change.opId) ? change.opId : generateOpId();
    return {
      opId: opId,
      entity: entity,
      entityId: change.entityId,
      op: op,
      baseRev: change.baseRev === undefined ? null : change.baseRev,
      patch: clone(patch)
    };
  }

  function normalizeResults(data, ops) {
    var raw = data;
    if (isPlainObject(data) && Array.isArray(data.results)) raw = data.results;
    if (!Array.isArray(raw)) raw = [];

    var byOpId = {};
    raw.forEach(function(result) {
      if (isPlainObject(result) && isNonEmptyString(result.opId)) {
        byOpId[result.opId] = result;
      }
    });

    return ops.map(function(op) {
      var result = byOpId[op.opId];
      if (!result) {
        return {
          opId: op.opId,
          entity: op.entity,
          entityId: op.entityId,
          status: 'error',
          rev: null,
          current: null,
          error: { kind: 'server', message: '服务端响应缺少该操作的结果' }
        };
      }
      var status = result.status;
      if (status === 'success' || status === 'applied') status = 'ok';
      if (status === 'failed' || status === 'error') status = 'error';
      if (status !== 'ok' && status !== 'conflict' && status !== 'error') {
        if (result.error) status = 'error';
        else if (result.current) status = 'conflict';
        else status = 'ok';
      }
      return {
        opId: op.opId,
        entity: op.entity,
        entityId: op.entityId,
        status: status,
        rev: result.rev === undefined ? null : result.rev,
        current: result.current === undefined ? null : clone(result.current),
        error: result.error === undefined ? null : clone(result.error)
      };
    });
  }

  function createClient(options) {
    options = options || {};
    var baseUrl = normalizeBaseUrl(options.baseUrl || '');
    var projectId = isNonEmptyString(options.projectId) ? options.projectId : null;
    var token = isNonEmptyString(options.token) ? options.token : null;
    var transport = typeof options.transport === 'function' ? options.transport : fetchTransport;
    var loginPath = options.loginPath || '/api/collections/users/auth-with-password';
    var pullPath = options.pullPath || '/api/sync/pull';
    var pushPath = options.pushPath || '/api/sync/push';

    function buildHeaders(skipAuth) {
      var headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      if (!skipAuth && token) headers.Authorization = token;
      return headers;
    }

    function request(method, path, config) {
      config = config || {};
      var payload = {
        method: method,
        url: appendQuery(baseUrl + path, config.query),
        headers: buildHeaders(config.skipAuth === true),
        body: config.body === undefined ? null : config.body
      };
      return Promise.resolve()
        .then(function() { return transport(payload); })
        .then(function(response) {
          if (!response || typeof response.status !== 'number') {
            throw new SyncError('network', '传输层返回了无效响应', { response: response });
          }
          var data = response.data !== undefined ? response.data : response.body;
          if (response.status >= 200 && response.status < 300) return data;
          throw errorFromResponse(response.status, data);
        })
        .catch(function(error) {
          if (isSyncError(error)) throw error;
          throw new SyncError('network', error && error.message ? error.message : '网络请求失败', {
            cause: error
          });
        });
    }

    function requireProject() {
      if (!isNonEmptyString(projectId)) {
        throw new SyncError('validation', '缺少 projectId');
      }
      return projectId;
    }

    function login(email, password) {
      return Promise.resolve().then(function() {
        if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
          throw new SyncError('validation', '邮箱和密码不能为空');
        }
        return request('POST', loginPath, {
          skipAuth: true,
          body: { identity: email, password: password }
        });
      }).then(function(data) {
        if (!isPlainObject(data) || !isNonEmptyString(data.token)) {
          throw new SyncError('auth', '登录响应缺少 token', { response: data });
        }
        token = data.token;
        return {
          token: token,
          record: data.record === undefined ? null : clone(data.record)
        };
      });
    }

    function logout() {
      token = null;
      return true;
    }

    function setToken(value) {
      token = isNonEmptyString(value) ? value : null;
      return token;
    }

    function pullChanges(params) {
      params = params || {};
      return Promise.resolve().then(function() {
        var project = requireProject();
        var since = normalizeSince(params.since);
        var collections = normalizeCollections(params.collections);
        return request('GET', pullPath, {
          query: {
            projectId: project,
            since: since,
            collections: collections.join(',')
          }
        }).then(function(data) {
          var raw = [];
          if (Array.isArray(data)) raw = data;
          else if (isPlainObject(data) && Array.isArray(data.changes)) raw = data.changes;
          return {
            changes: raw.map(normalizeChange),
            cursor: isPlainObject(data) && data.cursor !== undefined ? data.cursor : since,
            hasMore: !!(isPlainObject(data) && data.hasMore)
          };
        });
      });
    }

    function pushChanges(changes) {
      return Promise.resolve().then(function() {
        var project = requireProject();
        if (!Array.isArray(changes)) {
          throw new SyncError('validation', 'changes 必须是数组');
        }
        var ops = changes.map(normalizePushOp);
        if (ops.length === 0) return { results: [] };
        return request('POST', pushPath, {
          body: { projectId: project, ops: ops }
        }).then(function(data) {
          return { results: normalizeResults(data, ops) };
        });
      });
    }

    function migrate(localData, migrateOptions) {
      var merged = {};
      if (migrateOptions && typeof migrateOptions === 'object') {
        Object.keys(migrateOptions).forEach(function(key) {
          merged[key] = migrateOptions[key];
        });
      }
      if (merged.projectId === undefined && projectId) merged.projectId = projectId;
      return migrateLocalData(localData, merged, projectId);
    }

    return {
      login: login,
      logout: logout,
      setToken: setToken,
      getToken: function() { return token; },
      getProjectId: function() { return projectId; },
      setProjectId: function(value) {
        projectId = isNonEmptyString(value) ? value : null;
        return projectId;
      },
      pullChanges: pullChanges,
      pushChanges: pushChanges,
      migrateLocalData: migrate,
      resolveConflict: resolveConflict
    };
  }

  return {
    VERSION: VERSION,
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    COLLECTIONS: COLLECTIONS.slice(),
    PULL_COLLECTIONS: PULL_COLLECTIONS.slice(),
    PUSH_COLLECTIONS: PUSH_COLLECTIONS.slice(),
    SyncError: SyncError,
    isSyncError: isSyncError,
    classifyStatus: classifyStatus,
    createClient: createClient,
    migrateLocalData: function(localData, options) {
      return migrateLocalData(localData, options, null);
    },
    resolveConflict: resolveConflict
  };
})();
