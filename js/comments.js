// ============================================================
// Comments: 任务评论纯数据模型
// 不读写 localStorage，不修改传入对象，不生成 HTML
// ============================================================
var Comments = (function() {
  'use strict';

  var ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  var MAX_TEXT_LENGTH = 2000;
  var MAX_AUTHOR_LENGTH = 120;
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
    return 'comment-' + SEQUENCE.value.toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);
  }

  function normalizeText(text) {
    if (typeof text !== 'string') return null;
    var trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TEXT_LENGTH) return null;
    return trimmed;
  }

  function normalizeAuthor(author) {
    if (typeof author !== 'string') return null;
    var trimmed = author.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_AUTHOR_LENGTH) return null;
    return trimmed;
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

  // 生成新评论；taskId、作者或文本均非法时返回 null。
  // 文本只做首尾空白裁剪，内部换行和空白原样保留。
  function create(taskId, author, text, createdAt) {
    if (!isValidId(taskId)) return null;
    var normalizedAuthor = normalizeAuthor(author);
    if (normalizedAuthor === null) return null;
    var normalizedText = normalizeText(text);
    if (normalizedText === null) return null;

    return {
      id: nextId(),
      taskId: taskId,
      author: normalizedAuthor,
      text: normalizedText,
      createdAt: resolveTime(createdAt),
      updatedAt: null
    };
  }

  // 返回更新后的新评论，入参 comment 保持不变。
  function update(comment, text, updatedAt) {
    if (!comment || typeof comment !== 'object' || Array.isArray(comment)) return null;
    var normalizedText = normalizeText(text);
    if (normalizedText === null) return null;

    var next = {};
    Object.keys(comment).forEach(function(key) {
      next[key] = comment[key];
    });
    next.text = normalizedText;
    next.updatedAt = resolveTime(updatedAt);
    return next;
  }

  // 按 createdAt 升序返回指定任务的评论副本。
  function listByTask(comments, taskId) {
    if (!Array.isArray(comments) || !isNonEmptyString(taskId)) return [];
    return comments
      .filter(function(comment) {
        return comment && typeof comment === 'object' && comment.taskId === taskId;
      })
      .slice()
      .sort(compareEntries);
  }

  // 返回删除指定 id 后的新数组，入参 comments 保持不变。
  function remove(comments, id) {
    if (!Array.isArray(comments)) return [];
    if (!isNonEmptyString(id)) return comments.slice();
    return comments.filter(function(comment) {
      return !(comment && comment.id === id);
    });
  }

  return {
    MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
    MAX_AUTHOR_LENGTH: MAX_AUTHOR_LENGTH,
    create: create,
    update: update,
    listByTask: listByTask,
    remove: remove
  };
})();
