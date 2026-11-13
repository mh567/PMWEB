// ============================================================
// History: 纯内存命令栈（撤销 / 重做）
// 命令结构 { label, undo(), redo() }。
// 不接触 localStorage、DOM 和任何全局状态。
// ============================================================
var History = (function() {
  'use strict';

  var DEFAULT_LIMIT = 100;

  function normalizeLimit(limit) {
    if (typeof limit !== 'number' || !isFinite(limit)) return DEFAULT_LIMIT;
    if (Math.floor(limit) !== limit) return DEFAULT_LIMIT;
    return limit > 0 ? limit : DEFAULT_LIMIT;
  }

  function checkCommand(command) {
    if (!command || typeof command !== 'object' ||
        typeof command.undo !== 'function' ||
        typeof command.redo !== 'function') {
      throw new TypeError('History: 命令必须包含 undo() 和 redo()');
    }
  }

  // 创建独立的命令栈，limit 为撤销栈上限，默认 100。
  function create(limit) {
    var maxSize = normalizeLimit(limit);
    var undoStack = [];
    var redoStack = [];

    function trim() {
      while (undoStack.length > maxSize) undoStack.shift();
    }

    function execute(command) {
      checkCommand(command);
      command.redo();
      undoStack.push(command);
      redoStack = [];
      trim();
      return command;
    }

    // 命令已由调用方执行过 redo 时直接入栈，避免重复应用
    function push(command) {
      checkCommand(command);
      undoStack.push(command);
      redoStack = [];
      trim();
      return command;
    }

    function undo() {
      if (undoStack.length === 0) return null;
      var command = undoStack[undoStack.length - 1];
      command.undo();
      undoStack.pop();
      redoStack.push(command);
      return command;
    }

    function redo() {
      if (redoStack.length === 0) return null;
      var command = redoStack[redoStack.length - 1];
      command.redo();
      undoStack.push(command);
      redoStack.pop();
      trim();
      return command;
    }

    return {
      execute: execute,
      push: push,
      undo: undo,
      redo: redo,
      canUndo: function() { return undoStack.length > 0; },
      canRedo: function() { return redoStack.length > 0; },
      size: function() { return undoStack.length; },
      clear: function() {
        undoStack = [];
        redoStack = [];
      }
    };
  }

  return {
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    create: create
  };
})();
