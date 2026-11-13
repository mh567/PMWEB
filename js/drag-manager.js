// ============================================================
// == DragManager: 时间轴任务条与里程碑拖拽
// ============================================================
var DragManager = {
  isDragging: false,
  dragType: null,
  dragTarget: null,
  dragElement: null,
  startX: 0,
  startY: 0,
  originalStartDate: null,
  originalEndDate: null,
  originalDate: null,
  tooltip: null,

  init: function() {
    var self = this;
    document.addEventListener('mousedown', function(e) { self._onMouseDown(e); });
    document.addEventListener('mousemove', function(e) { self._onMouseMove(e); });
    document.addEventListener('mouseup', function(e) { self._onMouseUp(e); });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && (self.isDragging || self._pendingDrag)) {
        self._cancelDrag();
      }
    });
    document.addEventListener('mouseleave', function(e) {
      if (!e.relatedTarget && (self.isDragging || self._pendingDrag)) {
        self._cancelDrag();
      }
    });
  },

  _findBody: function() {
    return document.querySelector('.gantt-body');
  },

  _dateToX: function(dateStr) {
    if (typeof TimelinePane !== 'undefined' && TimelinePane) {
      return TimelinePane.dateToX(dateStr, TimelinePane.cells, TimelinePane.cellWidth);
    }
    if (typeof GanttView !== 'undefined' && GanttView && GanttView._dateToX) {
      return GanttView._dateToX(dateStr);
    }
    return 0;
  },

  _xToDate: function(x) {
    if (typeof TimelinePane !== 'undefined' && TimelinePane) {
      return TimelinePane.xToDate(x, TimelinePane.cells, TimelinePane.cellWidth);
    }
    if (typeof GanttView !== 'undefined' && GanttView && GanttView._xToDate) {
      return GanttView._xToDate(x);
    }
    return DateUtil.format(new Date());
  },

  _rerender: function() {
    if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.render === 'function') {
      Workbench.render();
      return;
    }
    if (typeof App !== 'undefined' && App && typeof App.renderAll === 'function') {
      App.renderAll();
    }
  },

  _onMouseDown: function(e) {
    if (e.button !== 0) return;
    var target = e.target;
    if (!target || !target.closest) return;

    var milestoneEl = target.closest('.gantt-milestone');
    if (milestoneEl) {
      e.preventDefault();
      e.stopPropagation();
      var ms = TaskManager.getMilestone(milestoneEl.dataset.milestoneId);
      if (ms) this._startDrag(e, 'milestone', ms, milestoneEl);
      return;
    }

    var bar = target.closest('.gantt-bar');
    if (!bar) return;
    e.preventDefault();
    var task = TaskManager.getTask(bar.dataset.taskId);
    if (!task) return;

    var rect = bar.getBoundingClientRect();
    var offsetX = e.clientX - rect.left;
    if (offsetX < 4) {
      this._startDrag(e, 'resize-left', task, bar);
    } else if (offsetX > rect.width - 4) {
      this._startDrag(e, 'resize-right', task, bar);
    } else {
      this._startDrag(e, 'move', task, bar);
    }
  },

  _updateCursor: function(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var bar = target.closest('.gantt-bar');
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    var offsetX = e.clientX - rect.left;
    if (offsetX < 4 || offsetX > rect.width - 4) {
      bar.style.cursor = 'col-resize';
    } else {
      bar.style.cursor = 'grab';
    }
  },

  _startDrag: function(e, type, target, element) {
    this._pendingDrag = {
      type: type,
      target: target,
      element: element,
      startX: e.clientX,
      startY: e.clientY
    };

    if (type === 'move' || type === 'resize-left' || type === 'resize-right') {
      this._pendingDrag.originalStartDate = target.startDate;
      this._pendingDrag.originalEndDate = target.endDate;
    } else if (type === 'milestone') {
      this._pendingDrag.originalDate = target.date;
    }

    document.body.style.userSelect = 'none';
  },

  _activateDrag: function(pending) {
    this.isDragging = true;
    this.dragType = pending.type;
    this.dragTarget = pending.target;
    this.dragElement = pending.element;
    this.startX = pending.startX;
    this.startY = pending.startY;

    if (pending.type === 'move' || pending.type === 'resize-left' || pending.type === 'resize-right') {
      this.originalStartDate = pending.originalStartDate;
      this.originalEndDate = pending.originalEndDate;
    } else if (pending.type === 'milestone') {
      this.originalDate = pending.originalDate;
    }

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'gantt-drag-tooltip';
    document.body.appendChild(this.tooltip);

    this._createGhost(pending.element, pending.type);

    pending.element.style.opacity = '0.3';

    document.body.style.cursor = (pending.type === 'move' || pending.type === 'milestone') ? 'grabbing' : 'col-resize';
  },

  _createGhost: function(element, type) {
    var rect = element.getBoundingClientRect();
    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost';

    var bgColor = element.style.background || getComputedStyle(element).backgroundColor;

    if (type === 'milestone') {
      ghost.innerHTML = '<span class="drag-ghost-milestone">' + _timelineDragEscape(element.textContent) + '</span>';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      this._ghostOffsetX = this.startX - rect.left;
      this._ghostOffsetY = this.startY - rect.top;
    } else if (type === 'move') {
      ghost.innerHTML = '<div class="drag-ghost-bar" style="background:' + bgColor + ';width:' + rect.width + 'px;">' + _timelineDragEscape(element.textContent) + '</div>';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      this._ghostOffsetX = this.startX - rect.left;
      this._ghostOffsetY = this.startY - rect.top;
    } else {
      ghost.innerHTML = '<div class="drag-ghost-bar" style="background:' + bgColor + ';width:' + rect.width + 'px;">' + _timelineDragEscape(element.textContent) + '</div>';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      this._ghostFixedLeft = rect.left;
      this._ghostOriginalWidth = rect.width;
      this._ghostOffsetX = 0;
      this._ghostOffsetY = 0;
    }

    document.body.appendChild(ghost);

    this._ghost = ghost;
  },

  _snapContainer: function() {
    var ganttBody = this._findBody();
    if (!ganttBody) return null;
    return ganttBody.querySelector('.timeline-content') || ganttBody.firstElementChild;
  },

  _updateSnapLine: function(x) {
    if (this._snapLine && this._snapLine.parentNode) {
      this._snapLine.parentNode.removeChild(this._snapLine);
    }

    if (x <= 0) return;

    var container = this._snapContainer();
    if (!container) return;

    var line = document.createElement('div');
    line.className = 'snap-line';
    line.style.left = x + 'px';
    container.appendChild(line);
    this._snapLine = line;
  },

  _ghostToContentX: function(ghostX) {
    var ganttBody = this._findBody();
    if (!ganttBody) return 0;
    var rect = ganttBody.getBoundingClientRect();
    return ghostX - rect.left + ganttBody.scrollLeft;
  },

  _onMouseMove: function(e) {
    if (!this.isDragging && !this._pendingDrag) {
      this._updateCursor(e);
    }

    if (this._pendingDrag && !this.isDragging) {
      var dx = e.clientX - this._pendingDrag.startX;
      var dy = e.clientY - this._pendingDrag.startY;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      this._activateDrag(this._pendingDrag);
      this._pendingDrag = null;
    }

    if (!this.isDragging) return;

    var deltaX = e.clientX - this.startX;

    if (this._ghost) {
      if (this.dragType === 'milestone') {
        this._ghost.style.left = (e.clientX - this._ghostOffsetX) + 'px';
      } else if (this.dragType === 'move') {
        this._ghost.style.left = (e.clientX - this._ghostOffsetX) + 'px';
      } else if (this.dragType === 'resize-left') {
        var leftWidth = this._ghostOriginalWidth - deltaX;
        if (leftWidth >= 20) {
          this._ghost.style.left = (this._ghostFixedLeft + deltaX) + 'px';
          this._ghost.style.width = leftWidth + 'px';
          var leftBar = this._ghost.querySelector('.drag-ghost-bar');
          if (leftBar) leftBar.style.width = leftWidth + 'px';
          this._ghostValid = true;
        } else {
          this._ghostValid = false;
        }
      } else if (this.dragType === 'resize-right') {
        var rightWidth = this._ghostOriginalWidth + deltaX;
        if (rightWidth >= 20) {
          this._ghost.style.width = rightWidth + 'px';
          var rightBar = this._ghost.querySelector('.drag-ghost-bar');
          if (rightBar) rightBar.style.width = rightWidth + 'px';
          this._ghostValid = true;
        } else {
          this._ghostValid = false;
        }
      }
    }

    var addOneDay = function(dateStr) {
      return _timelineDragAddDays(dateStr, 1);
    };
    var subOneDay = function(dateStr) {
      return _timelineDragAddDays(dateStr, -1);
    };

    if (this.dragType === 'move') {
      var moveStartX = this._dateToX(this.originalStartDate);
      var moveEndX = this._dateToX(addOneDay(this.originalEndDate));

      var newStart = this._xToDate(moveStartX + deltaX);
      var newEndNextDay = this._xToDate(moveEndX + deltaX);
      var newEnd = subOneDay(newEndNextDay);

      this.tooltip.textContent = newStart + ' ~ ' + newEnd;
      this.dragTarget._tempStart = newStart;
      this.dragTarget._tempEnd = newEnd;

      if (this._ghostValid !== false && this._ghost) {
        this._updateSnapLine(this._ghostToContentX(parseFloat(this._ghost.style.left)));
      }
    } else if (this.dragType === 'resize-left') {
      var originalStartX = this._dateToX(this.originalStartDate);
      var displayStart = this._xToDate(originalStartX + deltaX);

      if (displayStart >= this.originalEndDate) {
        displayStart = subOneDay(this.originalEndDate);
      }
      this.tooltip.textContent = '开始: ' + this.originalStartDate + ' → ' + displayStart;
      this.dragTarget._tempStart = displayStart;

      if (this._ghostValid && this._ghost) {
        this._updateSnapLine(this._ghostToContentX(parseFloat(this._ghost.style.left)));
      }
    } else if (this.dragType === 'resize-right') {
      var originalEndX = this._dateToX(addOneDay(this.originalEndDate));
      var newEndNextDay = this._xToDate(originalEndX + deltaX);
      var displayEnd = subOneDay(newEndNextDay);

      if (displayEnd <= this.originalStartDate) {
        displayEnd = addOneDay(this.originalStartDate);
      }
      this.tooltip.textContent = '结束: ' + this.originalEndDate + ' → ' + displayEnd;
      this.dragTarget._tempEnd = displayEnd;

      if (this._ghostValid && this._ghost) {
        var ghostRight = parseFloat(this._ghost.style.left) + parseFloat(this._ghost.style.width);
        this._updateSnapLine(this._ghostToContentX(ghostRight));
      }
    } else if (this.dragType === 'milestone') {
      var originalX = this._dateToX(this.originalDate);
      var newDate = this._xToDate(originalX + deltaX);

      this.tooltip.textContent = newDate;
      this.dragTarget._tempDate = newDate;

      if (this._ghost) {
        var ghostCenter = parseFloat(this._ghost.style.left) + 10;
        this._updateSnapLine(this._ghostToContentX(ghostCenter));
      }
    }

    this.tooltip.style.left = (e.clientX + 12) + 'px';
    this.tooltip.style.top = (e.clientY - 30) + 'px';
  },

  _onMouseUp: function(e) {
    if (this._pendingDrag) {
      this._pendingDrag = null;
      document.body.style.userSelect = '';
      return;
    }
    if (!this.isDragging) return;

    var target = this.dragTarget;

    if (this.dragType === 'move') {
      if (target._tempStart && target._tempEnd) {
        TaskManager.updateTask(target.id, { startDate: target._tempStart, endDate: target._tempEnd });
      }
    } else if (this.dragType === 'resize-left') {
      if (target._tempStart) {
        TaskManager.updateTask(target.id, { startDate: target._tempStart });
      }
    } else if (this.dragType === 'resize-right') {
      if (target._tempEnd) {
        TaskManager.updateTask(target.id, { endDate: target._tempEnd });
      }
    } else if (this.dragType === 'milestone') {
      if (target._tempDate) {
        var task = TaskManager.getTask(target.taskId);
        if (task) {
          var range = TaskManager.getDateRange(task);
          if (range.startDate && range.endDate) {
            if (target._tempDate < range.startDate || target._tempDate > range.endDate) {
              this._cleanup();
              this._rerender();
              return;
            }
          }
        }
        TaskManager.updateMilestone(target.id, { date: target._tempDate });
      }
    }

    delete target._tempStart;
    delete target._tempEnd;
    delete target._tempDate;

    this._cleanup();
    this._rerender();
  },

  _cancelDrag: function() {
    if (this._pendingDrag) {
      this._pendingDrag = null;
      document.body.style.userSelect = '';
      return;
    }
    if (!this.isDragging) return;
    delete this.dragTarget._tempStart;
    delete this.dragTarget._tempEnd;
    delete this.dragTarget._tempDate;
    this._cleanup();
    this._rerender();
  },

  _cleanup: function() {
    this.isDragging = false;
    this.dragType = null;
    this._pendingDrag = null;

    if (this.dragElement) {
      this.dragElement.style.opacity = '';
    }
    this.dragElement = null;
    this.dragTarget = null;

    if (this._ghost && this._ghost.parentNode) {
      document.body.removeChild(this._ghost);
    }
    this._ghost = null;
    this._ghostValid = null;

    if (this._snapLine && this._snapLine.parentNode) {
      this._snapLine.parentNode.removeChild(this._snapLine);
    }
    this._snapLine = null;

    if (this.tooltip && this.tooltip.parentNode) {
      document.body.removeChild(this.tooltip);
    }
    this.tooltip = null;

    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }
};

function _timelineDragAddDays(dateStr, days) {
  var date = DateUtil.parse(dateStr);
  return DateUtil.format(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function _timelineDragEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
