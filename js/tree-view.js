// ============================================================
// == TreeView: 多层级任务树
// ============================================================
const TreeView = {
  container: null,
  contextMenu: null,
  collapsedTasks: new Set(),
  selectedTaskId: null,
  hoveredTaskId: null,
  statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true },

  init: function() {
    var self = this;
    this.container = document.getElementById('tree-container');
    this.contextMenu = document.getElementById('context-menu');
    document.addEventListener('click', function() { TreeView.hideContextMenu(); });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') TreeView.hideContextMenu();
    });

    // 加载过滤设置
    var savedFilter = TaskManager.getSetting('statusFilter');
    if (savedFilter) {
      this.statusFilter = savedFilter;
    }
    this._updateFilterCheckboxes();
    this._bindFilterEvents();
    this._bindEvents();
  },

  _updateFilterCheckboxes: function() {
    var cb0 = document.getElementById('filter-todo');
    var cb1 = document.getElementById('filter-inProgress');
    var cb2 = document.getElementById('filter-thirdParty');
    var cb3 = document.getElementById('filter-done');
    if (cb0) cb0.checked = this.statusFilter.todo !== false;
    if (cb1) cb1.checked = this.statusFilter.inProgress !== false;
    if (cb2) cb2.checked = this.statusFilter.thirdParty !== false;
    if (cb3) cb3.checked = this.statusFilter.done !== false;
  },

  _bindFilterEvents: function() {
    var self = this;
    var filterBtn = document.getElementById('btn-task-filter');
    var filterMenu = document.getElementById('filter-menu');

    if (filterBtn && filterMenu) {
      filterBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        filterMenu.classList.toggle('active');
      });

      filterMenu.addEventListener('click', function(e) {
        e.stopPropagation();
      });

      ['filter-todo', 'filter-inProgress', 'filter-thirdParty', 'filter-done'].forEach(function(id) {
        var cb = document.getElementById(id);
        if (cb) {
          cb.addEventListener('change', function() {
            var cbTodo = document.getElementById('filter-todo');
            var cbInProg = document.getElementById('filter-inProgress');
            var cbTP = document.getElementById('filter-thirdParty');
            var cbDone = document.getElementById('filter-done');
            self.statusFilter.todo = cbTodo ? cbTodo.checked : true;
            self.statusFilter.inProgress = cbInProg ? cbInProg.checked : true;
            self.statusFilter.thirdParty = cbTP ? cbTP.checked : true;
            self.statusFilter.done = cbDone ? cbDone.checked : true;
            TaskManager.setSetting('statusFilter', self.statusFilter);
            self.render();
            App.renderAll();
          });
        }
      });

      document.addEventListener('click', function() {
        filterMenu.classList.remove('active');
      });
    }
  },

  _isTaskVisible: function(task) {
    var children = TaskManager.getChildren(task.id);
    if (children.length === 0) {
      // 叶子任务：根据状态过滤
      return this.statusFilter[task.status] !== false;
    } else {
      // 父任务：如果有任何可见子任务则显示
      var self = this;
      return children.some(function(child) {
        return self._isTaskVisible(child);
      });
    }
  },

  render: function() {
    var activeEl = document.activeElement;
    var focusedRow = activeEl && activeEl.closest ? activeEl.closest('.tree-node-row') : null;
    var focusTaskId = focusedRow ? focusedRow.dataset.taskId : null;
    var focusStatus = activeEl && activeEl.closest ? !!activeEl.closest('.status-icon') : false;
    var roots = TaskManager.getRootTasks();
    if (roots.length === 0) {
      this.container.innerHTML = '<div style="padding:24px 16px;color:var(--color-text-light);font-size:var(--text-body-sm);text-align:center;">暂无任务<br>点击下方按钮新建</div>';
      return;
    }
    var html = '';
    var self = this;
    roots.forEach(function(task) {
      if (self._isTaskVisible(task)) {
        html += self._renderNode(task, 0);
      }
    });
    this.container.innerHTML = html;
    if (focusTaskId) {
      var restored = this._findRow(focusTaskId);
      var focusTarget = focusStatus && restored ? restored.querySelector('.status-icon') : restored;
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
  },

  _findRow: function(taskId) {
    if (!this.container || taskId === null || taskId === undefined) return null;
    var id = String(taskId);
    var rows = this.container.querySelectorAll('.tree-node-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-task-id') === id) return rows[i];
    }
    return null;
  },

  _renderNode: function(task, depth) {
    var children = TaskManager.getChildren(task.id);
    var hasChildren = children.length > 0;
    var isCollapsed = this.collapsedTasks.has(task.id);
    var isSelected = this.selectedTaskId === task.id;
    var isHighlighted = this.hoveredTaskId === task.id;
    var color = TaskManager.getEffectiveColor(task);

    var effectiveStatus = hasChildren ? TaskManager.getEffectiveStatus(task) : (task.status || 'todo');
    var statusKey = effectiveStatus === 'todo' ? 'todo' :
                    effectiveStatus === 'done' ? 'done' :
                    effectiveStatus === 'thirdParty' ? 'thirdParty' : 'inProgress';
    var statusLabel = statusKey === 'todo' ? '未开始' :
                      statusKey === 'done' ? '已完成' :
                      statusKey === 'thirdParty' ? '第三方' : '进行中';

    var rowCls = 'tree-node-row';
    if (isSelected) rowCls += ' selected';
    if (isHighlighted) rowCls += ' highlighted';

    var arrowCls = 'arrow';
    if (!hasChildren) arrowCls += ' empty';
    else if (isCollapsed) arrowCls += ' collapsed';

    var html = '<div class="tree-node" data-task-id="' + _escapeHtml(task.id) + '" data-depth="' + depth + '">';
    html += '<div class="' + rowCls + '" data-task-id="' + _escapeHtml(task.id) + '" draggable="true" tabindex="0" data-keyboard-activate>';
    html += '<span class="' + arrowCls + '">▼</span>';
    html += '<span class="color-dot" style="background:' + _safeColor(color) + '"></span>';
    html += '<span class="status-icon status-badge status-' + statusKey + '" role="button" tabindex="0" data-keyboard-activate title="点击切换状态"><span class="status-dot"></span>' + statusLabel + '</span>';
    html += '<span class="node-name">' + _escapeHtml(task.name) + '</span>';
    if (task.assignee) {
      html += '<span style="font-size:var(--text-label);color:var(--color-text-light);flex-shrink:0;margin-right:4px;">' + _escapeHtml(task.assignee) + '</span>';
    }
    html += '<span class="node-actions">';
    if (depth < 2) {
      html += '<button class="btn-add-child" data-task-id="' + _escapeHtml(task.id) + '" title="添加子任务">+</button>';
    }
    html += '<button class="btn-more" data-task-id="' + _escapeHtml(task.id) + '" title="更多操作">⋯</button>';
    html += '</span>';
    html += '</div>';

    if (hasChildren) {
      html += '<div class="tree-children' + (isCollapsed ? ' collapsed' : '') + '">';
      var self = this;
      children.forEach(function(child) {
        if (self._isTaskVisible(child)) {
          html += self._renderNode(child, depth + 1);
        }
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  },

  _bindEvents: function() {
    var self = this;
    var container = this.container;

    var getRow = function(target) {
      return target && target.closest ? target.closest('.tree-node-row') : null;
    };

    container.addEventListener('click', function(e) {
      var row = getRow(e.target);
      if (!row) return;
      var taskId = row.dataset.taskId;

      var addChildBtn = e.target.closest('.btn-add-child');
      if (addChildBtn) {
        e.stopPropagation();
        App.showAddTask(addChildBtn.dataset.taskId);
        return;
      }

      var moreBtn = e.target.closest('.btn-more');
      if (moreBtn) {
        e.stopPropagation();
        self._showRowMenu(moreBtn, taskId);
        return;
      }

      if (e.target.closest('.node-actions')) return;

      if (e.target.closest('.status-icon')) {
        e.stopPropagation();
        var task = TaskManager.getTask(taskId);
        if (!task) return;
        var newStatus = task.status === 'todo' ? 'inProgress' :
                        task.status === 'inProgress' ? 'thirdParty' :
                        task.status === 'thirdParty' ? 'done' : 'todo';
        TaskManager.updateTask(taskId, { status: newStatus });
        self.render();
        App.renderAll();
        return;
      }

      var children = TaskManager.getChildren(taskId);
      if (children.length > 0 && e.target.classList.contains('arrow')) {
        if (self.collapsedTasks.has(taskId)) {
          self.collapsedTasks.delete(taskId);
        } else {
          self.collapsedTasks.add(taskId);
        }
        self.render();
        return;
      }

      self.selectedTaskId = taskId;
      self.render();
      App.onTaskSelected(taskId);
    });

    container.addEventListener('dblclick', function(e) {
      var row = getRow(e.target);
      if (!row || e.target.closest('.node-actions')) return;
      App.showEditTask(row.dataset.taskId);
    });

    _bindHoverDelegate(container, '.tree-node-row', function(row) {
      self.hoveredTaskId = row.dataset.taskId;
      App.onTaskHovered(self.hoveredTaskId);
    }, function() {
      self.hoveredTaskId = null;
      App.onTaskHovered(null);
    });

    container.addEventListener('contextmenu', function(e) {
      var row = getRow(e.target);
      if (!row) return;
      e.preventDefault();
      self.showContextMenu(e.clientX, e.clientY, self._buildTaskMenuItems(row.dataset.taskId));
    });

    container.addEventListener('keydown', function(e) {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      var row = getRow(e.target);
      if (!row) return;
      e.preventDefault();
      var rect = row.getBoundingClientRect();
      self.showContextMenu(rect.left, rect.bottom, self._buildTaskMenuItems(row.dataset.taskId), true);
    });

    container.addEventListener('dragstart', function(e) {
      var row = getRow(e.target);
      if (row) self._dragStart(e, row);
    });

    container.addEventListener('dragend', function(e) {
      self._dragEnd(e);
    });

    container.addEventListener('dragover', function(e) {
      var row = getRow(e.target);
      if (!row) {
        self._removeInsertLine();
        return;
      }
      self._dragOver(e, row);
    });

    container.addEventListener('dragleave', function(e) {
      if (e.relatedTarget && container.contains(e.relatedTarget)) return;
      self._removeInsertLine();
    });

    container.addEventListener('drop', function(e) {
      var row = getRow(e.target);
      if (row) self._drop(e, row);
    });
  },

  _buildTaskMenuItems: function(taskId) {
    var self = this;
    var depth = TaskManager.getDepth(taskId);
    var items = [];
    if (depth < 2) {
      items.push({ label: '添加子任务', action: function() { App.showAddTask(taskId); } });
    }
    items.push({ label: '标记为未开始', action: function() { TaskManager.updateTask(taskId, { status: 'todo' }); self.render(); App.renderAll(); } });
    items.push({ label: '标记为正在进行', action: function() { TaskManager.updateTask(taskId, { status: 'inProgress' }); self.render(); App.renderAll(); } });
    items.push({ label: '标记为第三方跟进', action: function() { TaskManager.updateTask(taskId, { status: 'thirdParty' }); self.render(); App.renderAll(); } });
    items.push({ label: '标记为已完成', action: function() { TaskManager.updateTask(taskId, { status: 'done' }); self.render(); App.renderAll(); } });
    items.push({ label: '编辑任务', action: function() { App.showEditTask(taskId); } });
    items.push({ label: '设置颜色', action: function() { App.showColorPicker(taskId); } });
    items.push({ label: '删除任务', action: function() { App.deleteTask(taskId); }, danger: true });
    return items;
  },

  _showRowMenu: function(btn, taskId) {
    var rect = btn.getBoundingClientRect();
    this.showContextMenu(rect.left, rect.bottom, this._buildTaskMenuItems(taskId));
  },

  showContextMenu: function(x, y, items, focusFirst) {
    var self = this;
    this._menuReturnFocus = document.activeElement;
    var html = '';
    items.forEach(function(item) {
      var cls = item.danger ? ' danger' : '';
      html += '<div class="context-menu-item' + cls + '" role="menuitem" tabindex="0" data-keyboard-activate>' + _escapeHtml(item.label) + '</div>';
    });
    this.contextMenu.innerHTML = html;
    this.contextMenu.style.left = x + 'px';
    this.contextMenu.style.top = y + 'px';
    this.contextMenu.classList.add('active');

    // Boundary detection - adjust if menu overflows viewport
    var rect = this.contextMenu.getBoundingClientRect();
    var pad = 4;
    if (rect.right > window.innerWidth - pad) {
      this.contextMenu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight - pad) {
      this.contextMenu.style.top = (y - rect.height) + 'px';
    }

    this.contextMenu.querySelectorAll('.context-menu-item').forEach(function(el, i) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        self.hideContextMenu();
        items[i].action();
      });
    });

    if (focusFirst) {
      var firstItem = this.contextMenu.querySelector('.context-menu-item');
      if (firstItem) firstItem.focus({ preventScroll: true });
    }
  },

  hideContextMenu: function() {
    var focusWasInside = this.contextMenu.contains(document.activeElement);
    this.contextMenu.classList.remove('active');
    if (focusWasInside && this._menuReturnFocus && this._menuReturnFocus.focus) {
      this._menuReturnFocus.focus({ preventScroll: true });
    }
  },

  highlightTask: function(taskId) {
    this.selectedTaskId = taskId;
    this.render();
    var el = this._findRow(taskId);
    if (el) el.scrollIntoView({ block: 'nearest' });
  },

  setHoverHighlight: function(taskId) {
    var id = taskId === null || taskId === undefined ? null : String(taskId);
    this.container.querySelectorAll('.tree-node-row').forEach(function(el) {
      el.classList.toggle('highlighted', id !== null && el.getAttribute('data-task-id') === id);
    });
  },

  // Drag and drop methods
  _dragStart: function(e, rowEl) {
    var taskId = rowEl.dataset.taskId;
    this.draggedTaskId = taskId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    rowEl.style.opacity = '0.5';
  },

  _dragEnd: function(e) {
    this.draggedTaskId = null;
    this._removeInsertLine();
    document.querySelectorAll('.tree-node-row').forEach(function(el) {
      el.style.opacity = '';
    });
  },

  _getDropPosition: function(e, rowEl) {
    var targetTaskId = rowEl.dataset.taskId;
    var rect = rowEl.getBoundingClientRect();
    var y = e.clientY - rect.top;
    var targetDepth = TaskManager.getDepth(targetTaskId);

    // Determine drop position: 'before', 'after', 'child'
    var arrowArea = e.target.classList.contains('arrow') || e.target.closest('.arrow');

    if (arrowArea && targetDepth < 2) {
      return 'child';
    } else if (y < rect.height * 0.3) {
      return 'before';
    } else if (y > rect.height * 0.7) {
      return 'after';
    } else {
      return 'child';
    }
  },

  _dragOver: function(e, rowEl) {
    var targetTaskId = rowEl.dataset.taskId;
    e.preventDefault();
    if (this.draggedTaskId === targetTaskId) return;

    var position = this._getDropPosition(e, rowEl);
    var isValid = this._isValidDrop(this.draggedTaskId, targetTaskId, position);

    this._showInsertLine(rowEl, position, isValid);
    e.dataTransfer.dropEffect = isValid ? 'move' : 'none';
  },

  _drop: function(e, rowEl) {
    var targetTaskId = rowEl.dataset.taskId;
    e.preventDefault();
    this._removeInsertLine();

    if (!this.draggedTaskId || this.draggedTaskId === targetTaskId) return;

    var position = this._getDropPosition(e, rowEl);

    if (!this._isValidDrop(this.draggedTaskId, targetTaskId, position)) {
      return;
    }

    // Calculate new parent and order
    var newParentId, newOrder;
    var targetTask = TaskManager.getTask(targetTaskId);

    if (position === 'child') {
      newParentId = targetTaskId;
      var siblings = TaskManager.getChildren(targetTaskId);
      newOrder = siblings.length;
    } else {
      newParentId = targetTask.parentId;
      var siblings = newParentId ? TaskManager.getChildren(newParentId) : TaskManager.getRootTasks();
      var targetIndex = siblings.findIndex(function(t) { return t.id === targetTaskId; });
      newOrder = position === 'before' ? targetIndex : targetIndex + 1;
    }

    if (TaskManager.moveTask(this.draggedTaskId, newParentId, newOrder)) {
      this.render();
      App.renderAll();
    }
  },

  _isValidDrop: function(draggedId, targetId, position) {
    // Cannot drop on self
    if (draggedId === targetId) return false;

    // Cannot drop into descendant
    var descendants = TaskManager.getDescendants(draggedId);
    for (var i = 0; i < descendants.length; i++) {
      if (descendants[i].id === targetId) return false;
    }

    // Calculate new depth
    var newDepth = 0;
    if (position === 'child') {
      newDepth = TaskManager.getDepth(targetId) + 1;
    } else {
      var targetTask = TaskManager.getTask(targetId);
      newDepth = targetTask ? TaskManager.getDepth(targetTask.parentId) + 1 : 0;
      if (targetTask && targetTask.parentId) {
        newDepth = TaskManager.getDepth(targetTask.parentId) + 1;
      } else {
        newDepth = 0;
      }
    }

    // Check if dragged task has descendants that would exceed limit
    if (descendants.length > 0) {
      var maxDescendantDepth = 0;
      for (var i = 0; i < descendants.length; i++) {
        var d = TaskManager.getDepth(descendants[i].id);
        if (d > maxDescendantDepth) maxDescendantDepth = d;
      }
      var draggedDepth = TaskManager.getDepth(draggedId);
      var relativeDescendantDepth = maxDescendantDepth - draggedDepth;
      if (newDepth + relativeDescendantDepth > 2) return false;
    }

    // Check depth limit for position
    if (position === 'child') {
      var targetDepth = TaskManager.getDepth(targetId);
      if (targetDepth >= 2) return false;
    }

    return true;
  },

  _showInsertLine: function(targetEl, position, isValid) {
    this._removeInsertLine();

    var line = document.createElement('div');
    line.className = 'tree-insert-line' + (isValid ? '' : ' invalid') + (position === 'child' ? ' child' : '');
    line.style.position = 'absolute';
    line.style.left = '0';
    line.style.right = '0';
    line.style.height = '2px';
    line.style.zIndex = '100';
    line.style.pointerEvents = 'none';

    var rect = targetEl.getBoundingClientRect();
    var containerRect = this.container.getBoundingClientRect();

    if (position === 'before') {
      line.style.top = (rect.top - containerRect.top) + 'px';
    } else if (position === 'after') {
      line.style.top = (rect.bottom - containerRect.top) + 'px';
    } else {
      // 'child' - show border around the element
      line.style.top = (rect.top - containerRect.top) + 'px';
      line.style.height = rect.height + 'px';
    }

    this.container.appendChild(line);
    this._insertLine = line;
  },

  _removeInsertLine: function() {
    if (this._insertLine && this._insertLine.parentNode) {
      this._insertLine.parentNode.removeChild(this._insertLine);
    }
    this._insertLine = null;
  }
};

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _safeColor(color) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(color)) ? color : DEFAULT_TASK_COLOR;
}

function _bindHoverDelegate(container, selector, onEnter, onLeave) {
  container.addEventListener('mouseover', function(e) {
    var el = e.target.closest(selector);
    if (!el || el.contains(e.relatedTarget)) return;
    onEnter(el);
  });
  container.addEventListener('mouseout', function(e) {
    var el = e.target.closest(selector);
    if (!el || el.contains(e.relatedTarget)) return;
    onLeave(el);
  });
}

function _bindKeyboardActivation() {
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!e.target || !e.target.closest) return;
    var el = e.target.closest('[data-keyboard-activate]');
    if (!el) return;
    e.preventDefault();
    el.click();
  });
}
