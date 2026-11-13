// ============================================================
// Links: 任务依赖数据模型与图算法
// 纯函数模块，不读写 localStorage，不修改传入对象
// ============================================================
var Links = {
  TYPES: ['FS', 'SS', 'FF', 'SF'],

  _seq: 0,

  // source、target 为任务 id，type 缺省为 FS，lag 缺省为 0（单位：天）
  create: function(source, target, type, lag) {
    return {
      id: this._nextId(),
      source: source,
      target: target,
      type: type === undefined ? 'FS' : type,
      lag: lag === undefined ? 0 : lag
    };
  },

  // 返回 { valid: boolean, errors: [{ index, code, message }] }
  validate: function(links, tasks) {
    var errors = [];
    var add = function(index, code, message) {
      errors.push({ index: index, code: code, message: message });
    };

    if (!Array.isArray(links)) {
      add(null, 'INVALID_LINKS', 'links 必须是数组');
      return { valid: false, errors: errors };
    }

    var hasTaskSet = tasks !== undefined && tasks !== null;
    var taskIds = this._taskIdSet(tasks);
    var seenEdges = new Map();

    for (var i = 0; i < links.length; i++) {
      var link = links[i];

      if (!link || typeof link !== 'object' || Array.isArray(link)) {
        add(i, 'INVALID_LINK', '依赖必须是对象');
        continue;
      }

      if (typeof link.type !== 'string' || this.TYPES.indexOf(link.type) === -1) {
        add(i, 'INVALID_TYPE', '依赖类型必须是 FS、SS、FF、SF 之一');
      }

      if (typeof link.lag !== 'number' || !isFinite(link.lag) ||
          Math.floor(link.lag) !== link.lag) {
        add(i, 'INVALID_LAG', 'lag 必须是以天为单位的整数');
      }

      var hasSource = typeof link.source === 'string' && link.source !== '';
      var hasTarget = typeof link.target === 'string' && link.target !== '';

      if (!hasSource) add(i, 'INVALID_ENDPOINT', 'source 必须是非空字符串');
      if (!hasTarget) add(i, 'INVALID_ENDPOINT', 'target 必须是非空字符串');

      if (hasSource && hasTarget && link.source === link.target) {
        add(i, 'SELF_REFERENCE', 'source 与 target 不能相同');
      }

      if (hasSource && hasTarget && hasTaskSet) {
        if (!taskIds.has(link.source)) {
          add(i, 'MISSING_SOURCE', 'source 引用了不存在的任务 "' + link.source + '"');
        }
        if (!taskIds.has(link.target)) {
          add(i, 'MISSING_TARGET', 'target 引用了不存在的任务 "' + link.target + '"');
        }
      }

      if (hasSource && hasTarget) {
        var key = link.source + '\u0000' + link.target;
        if (seenEdges.has(key)) {
          add(i, 'DUPLICATE_EDGE',
            '与第 ' + seenEdges.get(key) + ' 条依赖重复，同一对任务只允许一条依赖');
        } else {
          seenEdges.set(key, i);
        }
      }
    }

    return { valid: errors.length === 0, errors: errors };
  },

  // 返回 null，或构成环路的节点数组（不含重复的起点）
  detectCycle: function(links) {
    var graph = this._buildGraph(links);
    var state = new Map();
    var stack = [];
    var stackIndex = new Map();
    var found = null;

    function visit(id) {
      state.set(id, 1);
      stackIndex.set(id, stack.length);
      stack.push(id);

      var targets = graph.adjacency.get(id) || [];
      for (var i = 0; i < targets.length; i++) {
        var next = targets[i];
        var nextState = state.get(next) || 0;
        if (nextState === 0) {
          visit(next);
          if (found) return;
        } else if (nextState === 1) {
          found = stack.slice(stackIndex.get(next));
          return;
        }
      }

      stack.pop();
      stackIndex.delete(id);
      state.set(id, 2);
    }

    for (var i = 0; i < graph.order.length; i++) {
      var node = graph.order[i];
      if ((state.get(node) || 0) === 0) visit(node);
      if (found) break;
    }

    return found;
  },

  // 返回 { order, cycle, error }；存在环时 order 为空数组
  topologicalOrder: function(links, taskIds) {
    var nodes = [];
    var index = new Map();

    function addNode(id) {
      if (typeof id !== 'string' || index.has(id)) return;
      index.set(id, nodes.length);
      nodes.push(id);
    }

    if (Array.isArray(taskIds)) {
      taskIds.forEach(addNode);
    } else if (taskIds instanceof Set) {
      taskIds.forEach(addNode);
    } else {
      this._buildGraph(links).order.forEach(addNode);
    }

    var indegree = new Map();
    var adjacency = new Map();
    nodes.forEach(function(id) {
      indegree.set(id, 0);
      adjacency.set(id, []);
    });

    var list = Array.isArray(links) ? links : [];
    for (var i = 0; i < list.length; i++) {
      var link = list[i];
      if (!link || !index.has(link.source) || !index.has(link.target)) continue;
      adjacency.get(link.source).push(link.target);
      indegree.set(link.target, indegree.get(link.target) + 1);
    }

    var ready = [];
    nodes.forEach(function(id) {
      if (indegree.get(id) === 0) ready.push(id);
    });

    var order = [];
    while (ready.length > 0) {
      ready.sort(function(a, b) {
        return index.get(a) - index.get(b);
      });
      var current = ready.shift();
      order.push(current);

      var targets = adjacency.get(current);
      for (var t = 0; t < targets.length; t++) {
        var next = targets[t];
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) ready.push(next);
      }
    }

    if (order.length !== nodes.length) {
      var cycle = this.detectCycle(links) || [];
      return {
        order: [],
        cycle: cycle,
        error: cycle.length > 0 ? 'cycle detected: ' + cycle.join(' -> ') : 'cycle detected'
      };
    }

    return { order: order, cycle: null, error: null };
  },

  // 直接后继，按 links 中的首次出现顺序去重
  successors: function(id, links) {
    var result = [];
    var seen = new Set();
    var list = Array.isArray(links) ? links : [];
    for (var i = 0; i < list.length; i++) {
      var link = list[i];
      if (!link || link.source !== id) continue;
      if (seen.has(link.target)) continue;
      seen.add(link.target);
      result.push(link.target);
    }
    return result;
  },

  // 直接前驱，按 links 中的首次出现顺序去重
  predecessors: function(id, links) {
    var result = [];
    var seen = new Set();
    var list = Array.isArray(links) ? links : [];
    for (var i = 0; i < list.length; i++) {
      var link = list[i];
      if (!link || link.target !== id) continue;
      if (seen.has(link.source)) continue;
      seen.add(link.source);
      result.push(link.source);
    }
    return result;
  },

  // 返回 { ok: boolean, code: string|null, reason: string|null }
  canAdd: function(links, source, target, type) {
    var resolvedType = type === undefined ? 'FS' : type;

    if (typeof source !== 'string' || source === '' ||
        typeof target !== 'string' || target === '') {
      return {
        ok: false,
        code: 'INVALID_ENDPOINT',
        reason: 'source 与 target 必须是非空字符串'
      };
    }

    if (typeof resolvedType !== 'string' || this.TYPES.indexOf(resolvedType) === -1) {
      return {
        ok: false,
        code: 'INVALID_TYPE',
        reason: '依赖类型必须是 FS、SS、FF、SF 之一'
      };
    }

    if (source === target) {
      return {
        ok: false,
        code: 'SELF_REFERENCE',
        reason: 'source 与 target 不能相同'
      };
    }

    var list = Array.isArray(links) ? links : [];
    for (var i = 0; i < list.length; i++) {
      var link = list[i];
      if (!link) continue;
      if (link.source === source && link.target === target) {
        return {
          ok: false,
          code: 'DUPLICATE_EDGE',
          reason: '同一对任务只允许一条依赖'
        };
      }
    }

    if (this._reaches(target, source, list)) {
      return {
        ok: false,
        code: 'CYCLE',
        reason: '新增依赖会形成环路'
      };
    }

    return { ok: true, code: null, reason: null };
  },

  // 根据 sourceTask 的日期计算目标任务的约束
  // 返回 { type, lag, field: 'startDate'|'endDate', date: 'YYYY-MM-DD', source, target }
  // 缺少必要日期时返回 null
  computeConstraint: function(link, sourceTask) {
    if (!link || !sourceTask) return null;
    if (this.TYPES.indexOf(link.type) === -1) return null;

    var lag = typeof link.lag === 'number' && isFinite(link.lag) ? link.lag : 0;
    var startDate = sourceTask.startDate || null;
    var endDate = sourceTask.endDate || null;
    var baseDate;
    var field;

    if (link.type === 'FS') {
      field = 'startDate';
      baseDate = endDate;
    } else if (link.type === 'SS') {
      field = 'startDate';
      baseDate = startDate;
    } else if (link.type === 'FF') {
      field = 'endDate';
      baseDate = endDate;
    } else {
      field = 'endDate';
      baseDate = startDate;
    }

    if (!baseDate) return null;
    var date = this._addDays(baseDate, lag);
    if (!date) return null;

    return {
      type: link.type,
      lag: lag,
      field: field,
      date: date,
      source: link.source,
      target: link.target
    };
  },

  _nextId: function() {
    this._seq++;
    return 'link-' + this._seq.toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);
  },

  _taskIdSet: function(tasks) {
    var ids = new Set();
    if (!tasks) return ids;

    if (tasks instanceof Set) {
      tasks.forEach(function(id) {
        if (typeof id === 'string') ids.add(id);
      });
      return ids;
    }

    if (Array.isArray(tasks)) {
      tasks.forEach(function(task) {
        if (typeof task === 'string') {
          ids.add(task);
        } else if (task && typeof task.id === 'string') {
          ids.add(task.id);
        }
      });
      return ids;
    }

    if (typeof tasks === 'object') {
      Object.keys(tasks).forEach(function(key) {
        ids.add(key);
      });
    }
    return ids;
  },

  _buildGraph: function(links) {
    var adjacency = new Map();
    var order = [];
    var seen = new Set();

    function addNode(id) {
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
    }

    var list = Array.isArray(links) ? links : [];
    for (var i = 0; i < list.length; i++) {
      var link = list[i];
      if (!link) continue;
      if (typeof link.source !== 'string' || link.source === '') continue;
      if (typeof link.target !== 'string' || link.target === '') continue;
      addNode(link.source);
      addNode(link.target);
      if (!adjacency.has(link.source)) adjacency.set(link.source, []);
      adjacency.get(link.source).push(link.target);
    }

    return { order: order, adjacency: adjacency };
  },

  _reaches: function(from, to, links) {
    var graph = this._buildGraph(links);
    var seen = new Set();
    var queue = [from];

    while (queue.length > 0) {
      var current = queue.shift();
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);

      var targets = graph.adjacency.get(current) || [];
      for (var i = 0; i < targets.length; i++) {
        if (!seen.has(targets[i])) queue.push(targets[i]);
      }
    }

    return false;
  },

  _addDays: function(dateString, days) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString));
    if (!match) return null;

    var year = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    var day = parseInt(match[3], 10);
    var base = Date.UTC(year, month - 1, day);
    var check = new Date(base);

    if (check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day) {
      return null;
    }

    var shifted = new Date(base + days * 86400000);
    return shifted.getUTCFullYear() + '-' +
      String(shifted.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(shifted.getUTCDate()).padStart(2, '0');
  }
};
