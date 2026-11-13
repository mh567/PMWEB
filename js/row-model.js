// ============================================================
// RowModel: 只读行投影，表格与时间轴共享同一份行数组
// ============================================================
var RowModel = {
  // options: { collapsed: Set<string>, statusFilter: { todo, inProgress, thirdParty, done } }
  // returns: { rows: Row[], byId: Map<string, Row> }
  build: function(options) {
    options = options || {};
    var collapsed = options.collapsed;
    var statusFilter = options.statusFilter || {};
    var taskManager = this._resolveTaskManager();

    var rows = [];
    var byId = new Map();

    function passesFilter(task) {
      return statusFilter[task.status] !== false;
    }

    function makeRow(task, depth, info) {
      var range = taskManager.getDateRange(task);
      return {
        id: task.id,
        task: task,
        depth: depth,
        hasChildren: info.hasChildren,
        isCollapsed: info.isCollapsed,
        isSummary: info.isSummary,
        childCount: info.childCount,
        startDate: range.startDate,
        endDate: range.endDate
      };
    }

    // DFS 前序：父行在子行之前。返回 null 表示该子树没有可见行。
    function visit(task, depth) {
      var children = taskManager.getChildren(task.id);
      var isSummary = children.length > 0;

      if (!isSummary) {
        if (!passesFilter(task)) return null;
        return [makeRow(task, depth, {
          hasChildren: false,
          isCollapsed: false,
          isSummary: false,
          childCount: 0
        })];
      }

      var childRows = [];
      var anyVisible = false;
      for (var i = 0; i < children.length; i++) {
        var childResult = visit(children[i], depth + 1);
        if (childResult) {
          anyVisible = true;
          childRows = childRows.concat(childResult);
        }
      }

      if (!anyVisible) return null;

      var isCollapsed = !!(collapsed && collapsed.has(task.id));
      var row = makeRow(task, depth, {
        hasChildren: true,
        isCollapsed: isCollapsed,
        isSummary: true,
        childCount: children.length
      });

      return isCollapsed ? [row] : [row].concat(childRows);
    }

    var roots = taskManager.getRootTasks();
    for (var r = 0; r < roots.length; r++) {
      var rootResult = visit(roots[r], 0);
      if (rootResult) rows = rows.concat(rootResult);
    }

    rows.forEach(function(row) {
      byId.set(row.id, row);
    });

    return { rows: rows, byId: byId };
  },

  _resolveTaskManager: function() {
    if (typeof TaskManager !== 'undefined') return TaskManager;
    throw new Error('RowModel.build requires TaskManager');
  }
};
