// ============================================================
// AttachmentMeta: 附件元数据与校验纯数据模型
// 只处理元数据，不访问 IndexedDB / Blob / 文件系统
// IndexedDB 适配器接口见 docs/design/11-collaboration.md
// ============================================================
var AttachmentMeta = (function() {
  'use strict';

  var ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  var MAX_SIZE = 10 * 1024 * 1024;
  var MAX_NAME_LENGTH = 255;
  var ALLOWED_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
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
    return 'attachment-' + SEQUENCE.value.toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);
  }

  function isAllowedType(type) {
    return typeof type === 'string' && ALLOWED_TYPES.indexOf(type) !== -1;
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
    var diff = timeValue(a.createdAt) - timeValue(b.createdAt);
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id));
  }

  // 返回 { valid, errors: [{ field, code, message }] }。
  function validate(meta) {
    var errors = [];
    function add(field, code, message) {
      errors.push({ field: field, code: code, message: message });
    }

    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      add('$', 'INVALID_META', '附件元数据必须是对象');
      return { valid: false, errors: errors };
    }

    if (!isValidId(meta.taskId)) {
      add('taskId', 'INVALID_TASK_ID', 'taskId 必须匹配 ^[A-Za-z0-9_-]{1,128}$');
    }

    if (typeof meta.name !== 'string') {
      add('name', 'INVALID_NAME', 'name 必须是字符串');
    } else {
      var name = meta.name.trim();
      if (name.length === 0) {
        add('name', 'INVALID_NAME', 'name 不能为空');
      } else if (name.length > MAX_NAME_LENGTH) {
        add('name', 'NAME_TOO_LONG', 'name 长度不能超过 ' + MAX_NAME_LENGTH + ' 个字符');
      } else if (/[\/\\\u0000-\u001f\u007f]/.test(name)) {
        add('name', 'INVALID_NAME', 'name 不能包含路径分隔符或控制字符');
      }
    }

    if (typeof meta.size !== 'number' || !isFinite(meta.size) ||
        Math.floor(meta.size) !== meta.size || meta.size < 0) {
      add('size', 'INVALID_SIZE', 'size 必须是非负整数');
    } else if (meta.size > MAX_SIZE) {
      add('size', 'SIZE_EXCEEDED', 'size 不能超过 ' + MAX_SIZE + ' 字节');
    }

    if (!isAllowedType(meta.type)) {
      add('type', 'INVALID_TYPE', 'type 不在允许的文件类型白名单内');
    }

    if (!isNonEmptyString(meta.blobKey)) {
      add('blobKey', 'INVALID_BLOB_KEY', 'blobKey 必须是非空字符串');
    } else if (!ID_PATTERN.test(meta.blobKey)) {
      add('blobKey', 'INVALID_BLOB_KEY', 'blobKey 必须匹配 ^[A-Za-z0-9_-]{1,128}$');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // 生成新附件元数据；校验不通过时返回 null。
  // fileMeta 只读取 name、size、type、blobKey，不会被修改。
  function create(taskId, fileMeta, createdAt) {
    if (!fileMeta || typeof fileMeta !== 'object' || Array.isArray(fileMeta)) return null;

    var meta = {
      id: nextId(),
      taskId: taskId,
      name: typeof fileMeta.name === 'string' ? fileMeta.name.trim() : fileMeta.name,
      size: fileMeta.size,
      type: typeof fileMeta.type === 'string' ? fileMeta.type.toLowerCase() : fileMeta.type,
      createdAt: resolveTime(createdAt),
      blobKey: fileMeta.blobKey
    };

    var result = validate(meta);
    if (!result.valid) return null;
    return meta;
  }

  // 按 createdAt 升序返回指定任务的附件元数据副本。
  function listByTask(attachments, taskId) {
    if (!Array.isArray(attachments) || !isNonEmptyString(taskId)) return [];
    return attachments
      .filter(function(meta) {
        return meta && typeof meta === 'object' && meta.taskId === taskId;
      })
      .slice()
      .sort(compareEntries);
  }

  // 返回删除指定 id 后的新数组，入参 attachments 保持不变。
  function remove(attachments, id) {
    if (!Array.isArray(attachments)) return [];
    if (!isNonEmptyString(id)) return attachments.slice();
    return attachments.filter(function(meta) {
      return !(meta && meta.id === id);
    });
  }

  return {
    MAX_SIZE: MAX_SIZE,
    MAX_NAME_LENGTH: MAX_NAME_LENGTH,
    ALLOWED_TYPES: ALLOWED_TYPES.slice(),
    create: create,
    validate: validate,
    listByTask: listByTask,
    remove: remove
  };
})();
