// == GanttView: 甘特图渲染、时间轴计算、粒度切换
// ============================================================
const GanttView = {
  container: null,
  granularity: 'day',
  cellWidth: 40,
  startDate: null,
  endDate: null,
  cells: [],
  parentGroups: [],

  init: function(container) {
    this.container = container;
    this._bindEvents();
  },

  setGranularity: function(g) {
    this.granularity = g;
    this.render();
  },

  _calcDateRange: function() {
    var allTasks = TaskManager.getAllTasks();
    var milestones = TaskManager.getAllMilestones();
    var allDates = [];

    var self = this;
    allTasks.forEach(function(t) {
      var range = TaskManager.getDateRange(t);
      if (range.startDate) allDates.push(range.startDate);
      if (range.endDate) allDates.push(range.endDate);
    });
    milestones.forEach(function(m) { allDates.push(m.date); });

    if (allDates.length === 0) {
      var now = new Date();
      this.startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      this.endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      return;
    }

    allDates.sort();
    var minDate = DateUtil.parse(allDates[0]);
    var maxDate = DateUtil.parse(allDates[allDates.length - 1]);

    var pad = this.granularity === 'month' ? 60 : this.granularity === 'week' ? 14 : 7;
    this.startDate = new Date(minDate);
    this.startDate.setDate(this.startDate.getDate() - pad);
    this.endDate = new Date(maxDate);
    this.endDate.setDate(this.endDate.getDate() + pad);

    // 根据粒度对齐起始日期
    if (this.granularity === 'month') {
      // 对齐到月初
      this.startDate = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    } else if (this.granularity === 'week') {
      // 对齐到周一
      var day = this.startDate.getDay();
      this.startDate.setDate(this.startDate.getDate() - ((day + 6) % 7));
    }
    // day视图不需要特殊对齐
  },

  _generateCells: function() {
    this.cells = [];
    this.parentGroups = []; // 用于存储父级分组信息
    var d = new Date(this.startDate);

    if (this.granularity === 'month') {
      // 月视图：每个单元格 = 1月，上方显示年份
      this.cellWidth = 80;
      d.setDate(1);
      var currentYear = null;
      var yearStartIndex = 0;
      while (d <= this.endDate) {
        var year = d.getFullYear();
        var month = d.getMonth();
        var start = new Date(d);
        d.setMonth(d.getMonth() + 1);
        var end = new Date(d);
        end.setDate(end.getDate() - 1);
        var days = this._daysBetween(start, end) + 1;
        var label = (month + 1) + '月';
        this.cells.push({ label: label, start: start, end: end, days: days, year: year });
        // 记录年份分组
        if (year !== currentYear) {
          if (currentYear !== null) {
            this.parentGroups.push({ label: currentYear + '年', startIndex: yearStartIndex, count: this.cells.length - yearStartIndex });
          }
          currentYear = year;
          yearStartIndex = this.cells.length;
        }
      }
      // 添加最后一个年份分组
      if (currentYear !== null) {
        this.parentGroups.push({ label: currentYear + '年', startIndex: yearStartIndex, count: this.cells.length - yearStartIndex });
      }
    } else if (this.granularity === 'week') {
      // 周视图：每个单元格 = 1周，上方显示月份
      this.cellWidth = 60;
      // 对齐到周一
      var day = d.getDay();
      d.setDate(d.getDate() - ((day + 6) % 7));
      var currentMonth = null;
      var monthStartIndex = 0;
      while (d <= this.endDate) {
        var start = new Date(d);
        d.setDate(d.getDate() + 7);
        var end = new Date(d);
        end.setDate(end.getDate() - 1);
        var weekNum = this._getWeekNumber(start);
        var month = start.getMonth();
        var year = start.getFullYear();
        var label = 'W' + weekNum;
        this.cells.push({ label: label, start: start, end: end, days: 7, month: month, year: year });
        // 记录月份分组
        var monthKey = year + '-' + month;
        if (monthKey !== currentMonth) {
          if (currentMonth !== null) {
            this.parentGroups.push({ label: (parseInt(currentMonth.split('-')[1]) + 1) + '月', startIndex: monthStartIndex, count: this.cells.length - monthStartIndex });
          }
          currentMonth = monthKey;
          monthStartIndex = this.cells.length;
        }
      }
      // 添加最后一个月份分组
      if (currentMonth !== null) {
        this.parentGroups.push({ label: (parseInt(currentMonth.split('-')[1]) + 1) + '月', startIndex: monthStartIndex, count: this.cells.length - monthStartIndex });
      }
    } else {
      // 日视图：每个单元格 = 1天，上方显示星期几
      this.cellWidth = 45; // 需要45px宽度容纳"3/24"格式
      var weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      while (d <= this.endDate) {
        var start = new Date(d);
        var dayOfWeek = d.getDay();
        var weekdayLabel = weekdays[(dayOfWeek + 6) % 7];
        var label = (d.getMonth() + 1) + '/' + String(d.getDate()).padStart(2, '0');
        this.cells.push({ label: label, weekday: weekdayLabel, start: start, end: new Date(d), days: 1, isWeekend: dayOfWeek === 0 || dayOfWeek === 6 });
        d.setDate(d.getDate() + 1);
      }
      // 日视图不使用 parentGroups，每个单元格独立显示星期
    }
  },

  _dateToX: function(dateStr) {
    // 统一基准：基于 cells 进行精确比例映射
    if (this.cells.length === 0) return 0;
    var targetTime = DateUtil.parse(dateStr).getTime();

    for (var i = 0; i < this.cells.length; i++) {
      var cellStartTime = this.cells[i].start.getTime();
      // 单元格的结束边界是下一天的凌晨 00:00:00
      var cellEndTime = this.cells[i].end.getTime() + 86400000;

      if (targetTime >= cellStartTime && targetTime < cellEndTime) {
        // 精确计算在这个单元格内的百分比进度
        var ratio = (targetTime - cellStartTime) / (cellEndTime - cellStartTime);
        return (i + ratio) * this.cellWidth;
      }
    }

    // 越界保护（Fallback）：基于第一个或最后一个单元格做线性外推
    var firstCellTime = this.cells[0].start.getTime();
    if (targetTime < firstCellTime) {
      var diff = firstCellTime - targetTime;
      var duration = this.cells[0].end.getTime() + 86400000 - firstCellTime;
      return -(diff / duration) * this.cellWidth;
    } else {
      var lastCell = this.cells[this.cells.length - 1];
      var lastCellTime = lastCell.end.getTime() + 86400000;
      var diff = targetTime - lastCellTime;
      var duration = lastCellTime - lastCell.start.getTime();
      return (this.cells.length + (diff / duration)) * this.cellWidth;
    }
  },

  _xToDate: function(x) {
    // 统一基准：基于 cells 进行精确比例映射
    if (this.cells.length === 0) return DateUtil.format(new Date());

    var preciseIndex = x / this.cellWidth;
    var cellIndex = Math.floor(preciseIndex);

    // 限制索引在有效格子范围内
    if (cellIndex < 0) cellIndex = 0;
    if (cellIndex >= this.cells.length) cellIndex = this.cells.length - 1;

    var ratio = Math.max(0, Math.min(1, preciseIndex - cellIndex));

    var cell = this.cells[cellIndex];
    var cellStartTime = cell.start.getTime();
    var cellEndTime = cell.end.getTime() + 86400000;

    // 根据比例映射回具体的时间戳
    var targetTime = cellStartTime + ratio * (cellEndTime - cellStartTime);
    return DateUtil.format(new Date(targetTime));
  },

  _daysBetween: function(d1, d2) {
    var t1 = new Date(d1).setHours(0, 0, 0, 0);
    var t2 = new Date(d2).setHours(0, 0, 0, 0);
    return Math.round((t2 - t1) / 86400000);
  },

  _getWeekNumber: function(d) {
    var date = new Date(d);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    var week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  },

  _buildRows: function(leafTasks) {
    // Build rows based on tree order (DFS traversal)
    // Each leaf task gets its own row
    var rows = [];
    leafTasks.forEach(function(task) {
      rows.push([task]);
    });
    return rows;
  },

  _getLeafTasksInTreeOrder: function() {
    // Get leaf tasks in DFS tree order, filtered by status
    var result = [];
    var filter = TreeView.statusFilter;

    function traverse(taskId) {
      var children = TaskManager.getChildren(taskId);
      if (children.length === 0) {
        var task = TaskManager.getTask(taskId);
        if (task && filter[task.status] !== false) {
          result.push(task);
        }
      } else {
        children.forEach(function(child) {
          traverse(child.id);
        });
      }
    }

    var roots = TaskManager.getRootTasks();
    roots.forEach(function(root) {
      traverse(root.id);
    });

    return result;
  },

  render: function() {
    // 保存当前滚动位置对应的日期（如果是重新渲染）
    var prevGanttBody = this.container.querySelector('.gantt-body');
    var savedDate = null;
    if (prevGanttBody && prevGanttBody.scrollLeft > 0) {
      // 记录当前滚动位置对应的日期
      savedDate = this._xToDate(prevGanttBody.scrollLeft + prevGanttBody.clientWidth / 2);
    }

    this._calcDateRange();
    this._generateCells();

    // Get leaf tasks in tree order (DFS traversal)
    var leafTasks = this._getLeafTasksInTreeOrder();

    if (leafTasks.length === 0) {
      this.container.innerHTML = '<div class="gantt-empty">暂无任务，请先创建任务</div>';
      return;
    }

    var totalWidth = this.cells.length * this.cellWidth;
    var today = DateUtil.format(new Date());
    var self = this;

    // 生成时间轴头部（支持两行显示）
    var headerHtml = '<div class="gantt-header-wrapper"><div class="gantt-header" style="width:' + totalWidth + 'px;">';

    // 日视图特殊处理：上行显示星期几，下行显示日期
    if (this.granularity === 'day') {
      // 第一行：星期几
      headerHtml += '<div class="gantt-header-row">';
      this.cells.forEach(function(cell) {
        var cls = 'gantt-header-cell';
        if (cell.isWeekend) cls += ' weekend';
        headerHtml += '<div class="' + cls + '" style="width:' + self.cellWidth + 'px;"><div>' + cell.weekday + '</div></div>';
      });
      headerHtml += '</div>';
      // 第二行：日期
      headerHtml += '<div class="gantt-header-row">';
      this.cells.forEach(function(cell) {
        var cls = 'gantt-header-cell';
        if (cell.isWeekend) cls += ' weekend';
        headerHtml += '<div class="' + cls + '" style="width:' + self.cellWidth + 'px;"><div>' + cell.label + '</div></div>';
      });
      headerHtml += '</div>';
    } else {
      // 其他视图：第一行显示父级粒度信息
      if (this.parentGroups.length > 0) {
        headerHtml += '<div class="gantt-header-row gantt-header-parent">';
        this.parentGroups.forEach(function(group) {
          var width = group.count * self.cellWidth;
          headerHtml += '<div class="gantt-header-group" style="width:' + width + 'px;">' + group.label + '</div>';
        });
        headerHtml += '</div>';
      }
      // 第二行：当前粒度信息
      headerHtml += '<div class="gantt-header-row">';
      this.cells.forEach(function(cell) {
        var cls = 'gantt-header-cell';
        if (cell.isWeekend) cls += ' weekend';
        var weekdayHtml = cell.weekday ? '<div class="weekday">' + cell.weekday + '</div>' : '';
        headerHtml += '<div class="' + cls + '" style="width:' + self.cellWidth + 'px;">' + weekdayHtml + '<div>' + cell.label + '</div></div>';
      });
      headerHtml += '</div>';
    }
    headerHtml += '</div></div>';

    var rows = this._buildRows(leafTasks);
    var bodyHtml = '<div class="gantt-body"><div style="position:relative;width:' + totalWidth + 'px;min-height:' + (rows.length * 36) + 'px;">';

    var todayX = this._dateToX(today);
    if (todayX >= 0 && todayX <= totalWidth) {
      bodyHtml += '<div class="gantt-today-line" style="left:' + todayX + 'px;"></div>';
    }

    rows.forEach(function(row, rowIndex) {
      bodyHtml += '<div class="gantt-row" style="width:' + totalWidth + 'px;top:' + (rowIndex * 36) + 'px;position:absolute;left:0;" data-row-index="' + rowIndex + '">';
      self.cells.forEach(function(cell) {
        var cls = cell.isWeekend ? ' weekend' : '';
        bodyHtml += '<div class="gantt-grid-cell' + cls + '" style="width:' + self.cellWidth + 'px;"></div>';
      });
      bodyHtml += '</div>';

      row.forEach(function(task) {
        var range = TaskManager.getDateRange(task);
        if (!range.startDate || !range.endDate) return;

        var color = TaskManager.getEffectiveColor(task);

        // 精确左边缘（统一基准法）
        var barX = self._dateToX(range.startDate);
        // endDate 是包含当天的，为了拿到右边缘坐标，计算 endDate + 1 天的坐标
        var nextDayTime = DateUtil.parse(range.endDate).getTime() + 86400000;
        var endX = self._dateToX(DateUtil.format(new Date(nextDayTime)));
        // 最小宽度限制为 20px 保证可视性
        var barW = Math.max(endX - barX, 20);

        var effectiveStatus = (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getEffectiveStatus === 'function')
          ? TaskManager.getEffectiveStatus(task)
          : (task.status || 'todo');
        var statusCls = effectiveStatus === 'todo' ? ' status-todo' : effectiveStatus === 'done' ? ' status-done' : effectiveStatus === 'thirdParty' ? ' status-thirdParty' : ' status-inProgress';
        var selectedCls = (TreeView.selectedTaskId === task.id) ? ' selected' : '';
        var assigneeText = task.assignee ? ' [' + _escapeHtml(task.assignee) + ']' : '';

        // 格式化短日期（MM-DD）用于任务条显示
        var shortStartDate = range.startDate.slice(5);  // 去掉年份
        var shortEndDate = range.endDate.slice(5);
        var barLabel = _escapeHtml(task.name) + ' <span class="gantt-bar-dates">(' + shortStartDate + ' ~ ' + shortEndDate + ')</span>';

        bodyHtml += '<div class="gantt-bar' + statusCls + selectedCls + '" style="left:' + barX + 'px;width:' + barW + 'px;top:' + (rowIndex * 36 + 8) + 'px;background:' + _safeColor(color) + ';" role="button" tabindex="0" data-keyboard-activate data-task-id="' + task.id + '" data-bar-left="' + barX + '" title="' + _escapeHtml(task.name) + assigneeText + ' (' + _escapeHtml(range.startDate) + ' ~ ' + _escapeHtml(range.endDate) + ')"><span class="gantt-bar-label">' + barLabel + '</span></div>';

        var milestones = TaskManager.getMilestonesByTask(task.id);
        milestones.forEach(function(ms) {
          // 里程碑位置：日视图放在单元格中间，其他视图精确日期位置
          var msX;
          if (self.granularity === 'day') {
            // 日视图：里程碑放在当天单元格中间
            msX = self._dateToX(ms.date) + self.cellWidth / 2;
          } else {
            // 周/月视图：里程碑放在精确日期位置（当天中午12点）
            var msNoon = new Date(DateUtil.parse(ms.date).getTime() + 12 * 3600000);
            msX = self._dateToX(DateUtil.format(msNoon));
          }
          var msIcon = (ms.status === 'done') ? '○' : '□';
          var msClass = 'gantt-milestone' + (ms.status === 'done' ? ' done' : '');
          bodyHtml += '<div class="' + msClass + '" style="left:' + msX + 'px;top:' + (rowIndex * 36 + 4) + 'px;" role="button" tabindex="0" data-keyboard-activate data-milestone-id="' + ms.id + '" data-task-id="' + task.id + '" title="' + _escapeHtml(ms.name) + ' (' + _escapeHtml(ms.date) + ')">' + msIcon + '</div>';
        });
      });
    });

    bodyHtml += '</div></div>';

    this.container.innerHTML = '<div class="gantt-container">' + headerHtml + bodyHtml + '</div>';
    this._setupScrollSync();
    this._setupColumnHighlight();

    var ganttBody = this.container.querySelector('.gantt-body');
    if (ganttBody) {
      if (savedDate) {
        // 恢复到之前滚动位置对应的日期
        var newX = this._dateToX(savedDate);
        ganttBody.scrollLeft = Math.max(0, newX - ganttBody.clientWidth / 2);
      } else if (todayX > 0) {
        // 仅在初始渲染时滚动到今天
        ganttBody.scrollLeft = Math.max(0, todayX - ganttBody.clientWidth / 2);
      }
      // 初始触发一次滚动同步，确保标签位置正确
      if (this._scrollSyncHandler) this._scrollSyncHandler();
    }
  },

  _setupScrollSync: function() {
    var self = this;
    var ganttBody = this.container.querySelector('.gantt-body');
    var ganttHeader = this.container.querySelector('.gantt-header');
    if (!ganttBody || !ganttHeader) return;

    // Remove existing listener if any
    if (this._scrollSyncHandler) {
      ganttBody.removeEventListener('scroll', this._scrollSyncHandler);
    }

    this._scrollSyncHandler = function() {
      // 使用 transform 移动 header 内容，因为 header 有 overflow:hidden 且 width=totalWidth
      ganttHeader.style.transform = 'translateX(' + (-ganttBody.scrollLeft) + 'px)';

      // 固定任务标签：当任务条左侧超出可视区域时，标签固定在左边缘
      var scrollLeft = ganttBody.scrollLeft;
      var visibleWidth = ganttBody.clientWidth;
      self.container.querySelectorAll('.gantt-bar').forEach(function(bar) {
        var barLeft = parseFloat(bar.dataset.barLeft) || parseFloat(bar.style.left);
        var label = bar.querySelector('.gantt-bar-label');
        if (label) {
          if (barLeft < scrollLeft) {
            // 任务条起点在可视区域外，标签固定在左边缘
            label.style.marginLeft = (scrollLeft - barLeft) + 'px';
          } else {
            // 任务条在可视区域内，正常显示
            label.style.marginLeft = '0';
          }
        }
      });
    };
    ganttBody.addEventListener('scroll', this._scrollSyncHandler);
  },

  _setupColumnHighlight: function() {
    var self = this;
    var ganttBody = this.container.querySelector('.gantt-body');
    var ganttHeader = this.container.querySelector('.gantt-header');
    if (!ganttBody || !ganttHeader) return;

    // Remove existing highlights and listeners
    var existingHighlight = ganttBody.querySelector('.gantt-column-highlight');
    if (existingHighlight) existingHighlight.remove();
    var existingHeaderHighlight = ganttHeader.querySelector('.gantt-header-highlight');
    if (existingHeaderHighlight) existingHeaderHighlight.remove();

    if (this._columnHighlightHandlers) {
      ganttBody.removeEventListener('mousemove', this._columnHighlightHandlers.mousemove);
      ganttBody.removeEventListener('mouseleave', this._columnHighlightHandlers.mouseleave);
    }

    // Create column highlight overlay
    var highlightCol = document.createElement('div');
    highlightCol.className = 'gantt-column-highlight';
    highlightCol.style.cssText = 'position:absolute;top:0;bottom:0;width:' + this.cellWidth + 'px;background:rgba(74,144,217,0.08);pointer-events:none;display:none;z-index:1;';
    ganttBody.appendChild(highlightCol);

    // Create header column highlight
    var headerHighlight = document.createElement('div');
    headerHighlight.className = 'gantt-header-highlight';
    headerHighlight.style.cssText = 'position:absolute;top:0;bottom:0;width:' + this.cellWidth + 'px;background:rgba(74,144,217,0.12);pointer-events:none;display:none;z-index:1;';
    ganttHeader.style.position = 'relative';
    ganttHeader.appendChild(headerHighlight);

    var mousemoveHandler = function(e) {
      var rect = ganttBody.getBoundingClientRect();
      var x = e.clientX - rect.left + ganttBody.scrollLeft;
      var colIndex = Math.floor(x / self.cellWidth);

      highlightCol.style.left = (colIndex * self.cellWidth) + 'px';
      highlightCol.style.display = 'block';

      headerHighlight.style.left = (colIndex * self.cellWidth) + 'px';
      headerHighlight.style.display = 'block';
    };

    var mouseleaveHandler = function() {
      highlightCol.style.display = 'none';
      headerHighlight.style.display = 'none';
    };

    ganttBody.addEventListener('mousemove', mousemoveHandler);
    ganttBody.addEventListener('mouseleave', mouseleaveHandler);

    // Store handlers for cleanup
    this._columnHighlightHandlers = {
      mousemove: mousemoveHandler,
      mouseleave: mouseleaveHandler
    };
  },

  _bindEvents: function() {
    var self = this;

    this.container.addEventListener('click', function(e) {
      var bar = e.target.closest('.gantt-bar');
      if (bar) {
        if (e.detail === 0 || e.detail === 1) App.onGanttTaskClicked(bar.dataset.taskId);
        return;
      }
      var milestone = e.target.closest('.gantt-milestone');
      if (milestone) {
        e.stopPropagation();
        App.toggleMilestoneStatus(milestone.dataset.milestoneId);
      }
    });

    this.container.addEventListener('dblclick', function(e) {
      var bar = e.target.closest('.gantt-bar');
      if (bar) App.showEditTask(bar.dataset.taskId);
    });

    _bindHoverDelegate(this.container, '.gantt-bar', function(bar) {
      TreeView.setHoverHighlight(bar.dataset.taskId);
    }, function() {
      TreeView.setHoverHighlight(null);
    });

    this.container.addEventListener('contextmenu', function(e) {
      var milestone = e.target.closest('.gantt-milestone');
      if (milestone) {
        e.preventDefault();
        e.stopPropagation();
        var milestoneId = milestone.dataset.milestoneId;
        TreeView.showContextMenu(e.clientX, e.clientY, [
          { label: '编辑里程碑', action: function() { App.showEditMilestone(milestoneId); } },
          { label: '删除里程碑', action: function() { App.deleteMilestone(milestoneId); }, danger: true }
        ]);
        return;
      }

      var bar = e.target.closest('.gantt-bar');
      if (!bar) return;
      e.preventDefault();
      e.stopPropagation();
      var taskId = bar.dataset.taskId;
      var ganttBody = self.container.querySelector('.gantt-body');
      if (!ganttBody) return;
      var rect = ganttBody.getBoundingClientRect();
      var clickX = e.clientX - rect.left + ganttBody.scrollLeft;
      var dateAtClick = self._xToDate(clickX);
      TreeView.showContextMenu(e.clientX, e.clientY, [
        { label: '添加里程碑', action: function() { App.showAddMilestoneAtDate(taskId, dateAtClick); } }
      ]);
    });
  },

  highlightBar: function(taskId) {
    this.container.querySelectorAll('.gantt-bar').forEach(function(el) {
      el.classList.toggle('highlight', el.dataset.taskId === taskId);
    });
  },

  clearHighlight: function() {
    this.container.querySelectorAll('.gantt-bar.highlight').forEach(function(el) {
      el.classList.remove('highlight');
    });
  },

  selectBar: function(taskId) {
    this.container.querySelectorAll('.gantt-bar.selected').forEach(function(el) {
      el.classList.remove('selected');
    });
    if (taskId) {
      var el = this.container.querySelector('.gantt-bar[data-task-id="' + taskId + '"]');
      if (el) {
        el.classList.add('selected');
        // 不做水平滚动，避免跳转
      }
    }
  }
};
