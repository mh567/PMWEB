// ============================================================
// == TimelinePane: 行模型驱动的时间轴视图
// ============================================================
var TimelinePane = {
  ROW_HEIGHT: 40,
  BAR_TOP: 10,
  BAR_HEIGHT: 20,
  MILESTONE_TOP: 10,
  SUMMARY_TOP: 14,
  SUMMARY_HEIGHT: 12,
  BASELINE_TOP: 32,
  BASELINE_HEIGHT: 5,
  WINDOW_OVERSCAN: 3,

  header: null,
  body: null,
  rows: [],
  granularity: 'day',
  cells: [],
  cellWidth: 45,
  parentGroups: [],
  startDate: null,
  endDate: null,
  selectedTaskId: null,
  hoveredTaskId: null,
  baselineById: null,
  criticalIds: null,
  windowStart: 0,
  windowEnd: 0,
  _rowsEl: null,
  _totalWidth: 0,
  _cellsHtml: null,
  _cellsHtmlCells: null,
  _cellsHtmlWidth: 0,
  _windowRaf: 0,
  _pendingFocus: null,

  init: function(options) {
    options = options || {};
    this.header = options.header || null;
    this.body = options.body || null;

    if (this.header) {
      this.header.classList.add('timeline-header-wrap');
    }
    if (this.body) {
      this.body.classList.add('gantt-body');
      this.body.classList.add('timeline-body');
    }
    this._bindEvents();
  },

  // ---- 纯函数：日期范围与单元格 ----
  calcDateRange: function(rows, granularity, extraDates) {
    granularity = granularity || 'day';
    var dates = [];

    (rows || []).forEach(function(row) {
      if (!row) return;
      if (row.startDate) dates.push(row.startDate);
      if (row.endDate) dates.push(row.endDate);
    });
    (extraDates || []).forEach(function(date) {
      if (date) dates.push(date);
    });

    if (dates.length === 0) {
      var now = new Date();
      return {
        startDate: new Date(now.getFullYear(), now.getMonth(), 1),
        endDate: new Date(now.getFullYear(), now.getMonth() + 2, 0)
      };
    }

    dates.sort();
    var min = DateUtil.parse(dates[0]);
    var max = DateUtil.parse(dates[dates.length - 1]);
    var pad = granularity === 'month' ? 60 : granularity === 'week' ? 14 : 7;

    var start = new Date(min.getFullYear(), min.getMonth(), min.getDate() - pad);
    var end = new Date(max.getFullYear(), max.getMonth(), max.getDate() + pad);

    if (granularity === 'month') {
      start = new Date(start.getFullYear(), start.getMonth(), 1);
      end = new Date(end.getFullYear(), end.getMonth() + 1, 0);
    } else if (granularity === 'week') {
      var startOffset = (start.getDay() + 6) % 7;
      start = new Date(start.getFullYear(), start.getMonth(), start.getDate() - startOffset);
      var endOffset = (end.getDay() + 6) % 7;
      end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + (6 - endOffset));
    }

    return { startDate: start, endDate: end };
  },

  generateCells: function(startDate, endDate, granularity, config) {
    granularity = granularity || 'day';
    var cellWidth = _timelineCellWidth(granularity);
    var calendarMarks = _timelineCalendarMarks(config);
    var cells = [];

    if (!startDate || !endDate) {
      return { cells: cells, cellWidth: cellWidth, parentGroups: [] };
    }

    var limit = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    var cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

    if (granularity === 'month') {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      while (cursor <= limit) {
        var monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        var nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
        var monthEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 0);
        cells.push({
          label: (monthStart.getMonth() + 1) + '月',
          start: monthStart,
          end: monthEnd,
          days: monthEnd.getDate(),
          year: monthStart.getFullYear(),
          groupLabel: monthStart.getFullYear() + '年'
        });
        cursor = nextMonth;
      }
    } else if (granularity === 'week') {
      var offset = (cursor.getDay() + 6) % 7;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - offset);
      while (cursor <= limit) {
        var weekStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        var weekEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 6);
        cells.push({
          label: 'W' + _timelineWeekNumber(weekStart),
          start: weekStart,
          end: weekEnd,
          days: 7,
          year: weekStart.getFullYear(),
          groupLabel: weekStart.getFullYear() + '年' + (weekStart.getMonth() + 1) + '月'
        });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
      }
    } else {
      while (cursor <= limit) {
        var dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        var dayOfWeek = dayStart.getDay();
        var dateStr = _timelineDateString(dayStart);

        var isMakeup = false;
        var isHoliday = false;
        var isWeekend = false;
        var holidayName = '';

        if (typeof HolidaySource !== 'undefined' && HolidaySource && config && (config.calendar || config.calendarOverrides)) {
          var resolved = HolidaySource.resolveDate(dateStr, config.calendar, config.calendarOverrides);
          holidayName = resolved.name || '';
          if (resolved.source === 'subscription' || resolved.source === 'import') {
            if (resolved.working) isMakeup = true;
            else isHoliday = true;
          } else if (resolved.source === 'manual') {
            if (resolved.working) {
              if (dayOfWeek === 0 || dayOfWeek === 6) isMakeup = true;
            } else {
              isHoliday = true;
            }
          } else {
            isWeekend = !resolved.working;
          }
        } else {
          isMakeup = calendarMarks.workdaySet.has(dateStr);
          isHoliday = !isMakeup && calendarMarks.holidaySet.has(dateStr);
          isWeekend = !isMakeup && calendarMarks.weekendSet.has(dayOfWeek);
        }

        cells.push({
          label: (dayStart.getMonth() + 1) + '/' + _timelinePad2(dayStart.getDate()),
          weekday: _timelineWeekday(dayOfWeek),
          date: dateStr,
          start: dayStart,
          end: new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()),
          days: 1,
          isWeekend: isWeekend,
          isHoliday: isHoliday,
          isMakeup: isMakeup,
          holidayName: holidayName,
          year: dayStart.getFullYear(),
          groupLabel: dayStart.getFullYear() + '年' + (dayStart.getMonth() + 1) + '月'
        });
        cursor = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
      }
    }

    return {
      cells: cells,
      cellWidth: cellWidth,
      parentGroups: _timelineBuildGroups(cells)
    };
  },

  dateToX: function(dateStr, cells, cellWidth) {
    if (!cells || cells.length === 0 || !dateStr) return 0;
    cellWidth = cellWidth || 45;

    var targetDay = _timelineDayNumber(DateUtil.parse(dateStr));

    for (var i = 0; i < cells.length; i++) {
      var startDay = _timelineDayNumber(cells[i].start);
      var endDay = _timelineDayNumber(_timelineEndExclusive(cells[i]));
      if (targetDay >= startDay && targetDay < endDay) {
        var span = endDay - startDay;
        return (i + (targetDay - startDay) / span) * cellWidth;
      }
    }

    var first = cells[0];
    var firstStart = _timelineDayNumber(first.start);
    if (targetDay < firstStart) {
      var firstSpan = _timelineDayNumber(_timelineEndExclusive(first)) - firstStart;
      return -((firstStart - targetDay) / firstSpan) * cellWidth;
    }

    var last = cells[cells.length - 1];
    var lastEnd = _timelineDayNumber(_timelineEndExclusive(last));
    var lastSpan = lastEnd - _timelineDayNumber(last.start);
    return (cells.length + (targetDay - lastEnd) / lastSpan) * cellWidth;
  },

  xToDate: function(x, cells, cellWidth) {
    if (!cells || cells.length === 0) return DateUtil.format(new Date());
    cellWidth = cellWidth || 45;

    var precise = x / cellWidth;
    var index = Math.floor(precise);
    if (index < 0) index = 0;
    if (index >= cells.length) index = cells.length - 1;

    var ratio = precise - index;
    if (ratio < 0) ratio = 0;
    if (ratio >= 1) ratio = 0.999999;

    var cell = cells[index];
    var span = _timelineDayNumber(_timelineEndExclusive(cell)) - _timelineDayNumber(cell.start);
    var offset = Math.floor(ratio * span + 1e-6);
    if (offset >= span) offset = span - 1;
    if (offset < 0) offset = 0;

    return DateUtil.format(new Date(
      cell.start.getFullYear(),
      cell.start.getMonth(),
      cell.start.getDate() + offset
    ));
  },

  classifyRow: function(row) {
    if (!row || !row.task) return 'empty';
    if (!row.startDate || !row.endDate) return 'empty';
    return row.isSummary ? 'summary' : 'leaf';
  },

  // ---- 可视窗口 ----
  // 纯函数：按滚动位置计算需要挂载的行区间，返回左闭右开区间和内容总高度。
  computeWindow: function(scrollTop, viewportHeight, rowHeight, rowCount, overscan) {
    var height = Number(rowHeight);
    if (!isFinite(height) || height <= 0) height = TimelinePane.ROW_HEIGHT;

    var count = Number(rowCount);
    count = isFinite(count) && count > 0 ? Math.floor(count) : 0;

    var totalHeight = count * height;
    if (count === 0) {
      return { start: 0, end: 0, offsetTop: 0, totalHeight: 0, rowHeight: height };
    }

    var view = Number(viewportHeight);
    if (!isFinite(view) || view < 0) view = 0;

    var top = Number(scrollTop);
    if (!isFinite(top) || top < 0) top = 0;

    var maxTop = Math.max(0, totalHeight - view);
    if (top > maxTop) top = maxTop;

    var pad = Number(overscan);
    pad = isFinite(pad) && pad > 0 ? Math.floor(pad) : 0;

    var first = Math.floor(top / height);
    if (first > count - 1) first = count - 1;

    var visible = view > 0 ? Math.ceil((top + view) / height) - first : 1;
    if (visible < 1) visible = 1;

    var start = first - pad;
    if (start < 0) start = 0;

    var end = first + visible + pad;
    if (end > count) end = count;
    if (end <= start) end = Math.min(count, start + 1);

    return {
      start: start,
      end: end,
      offsetTop: start * height,
      totalHeight: totalHeight,
      rowHeight: height
    };
  },

  windowRows: function(rows, win) {
    var list = Array.isArray(rows) ? rows : [];
    if (!win) return [];
    var start = Math.max(0, Math.floor(win.start || 0));
    var end = Math.min(list.length, Math.floor(win.end || 0));
    if (end <= start) return [];
    return list.slice(start, end);
  },

  _calendarConfig: function() {
    var wsData = (typeof Workspace !== 'undefined' && Workspace && Workspace.data) ? Workspace.data : null;
    var globalCalendar = wsData ? wsData.calendar : null;
    var rawProject = (typeof TaskManager !== 'undefined' && TaskManager && TaskManager.data && TaskManager.data.settings)
      ? (TaskManager.data.settings.calendarOverrides || TaskManager.data.settings.workCalendar)
      : null;
    var baseConfig = null;
    if (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getWorkCalendar === 'function') {
      baseConfig = TaskManager.getWorkCalendar();
    } else if (typeof WorkCalendar !== 'undefined' && WorkCalendar) {
      baseConfig = WorkCalendar.createConfig();
    }
    return {
      calendar: globalCalendar,
      calendarOverrides: rawProject,
      weekends: (baseConfig && baseConfig.weekends) || (rawProject && rawProject.weekends) || [0, 6],
      holidays: (baseConfig && baseConfig.holidays) || (rawProject && rawProject.holidays) || [],
      workdays: (baseConfig && baseConfig.workdays) || (rawProject && rawProject.workdays) || []
    };
  },

  // 优先使用 TaskManager 的工作日权重汇总，缺失时退回 Progress 的自然日口径
  _computeProgress: function(rows) {
    if (typeof TaskManager !== 'undefined' && TaskManager &&
        typeof TaskManager.computeRowProgress === 'function') {
      return TaskManager.computeRowProgress(rows);
    }
    if (typeof Progress !== 'undefined' && Progress &&
        typeof Progress.computeRowProgress === 'function') {
      return Progress.computeRowProgress(rows, function(id) {
        return TaskManager.getChildren(id);
      });
    }
    return null;
  },

  // 配置工作日历后，在任务条提示里补充工作日工期
  _durationText: function(row) {
    if (!row || !row.task) return '';
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.taskDurationWeight !== 'function') return '';
    var weight = TaskManager.taskDurationWeight(row.task);
    if (typeof weight !== 'number' || !isFinite(weight)) return '';
    return ' · 工期 ' + weight + ' 个工作日';
  },

  // ---- 基线 ----
  // map: Map<taskId, Baseline.diff() 条目>，null 表示未保存基线
  setBaseline: function(map) {
    this.baselineById = map && typeof map.get === 'function' ? map : null;
    return this.baselineById;
  },

  _baselineEntry: function(row) {
    if (!this.baselineById || !row || row.id === null || row.id === undefined) return null;
    var entry = this.baselineById.get(String(row.id));
    if (!entry || !entry.baselineStartDate || !entry.baselineEndDate) return null;
    return entry;
  },

  // ---- 关键路径高亮 ----
  // set: Set<taskId>，null 表示关闭高亮；只切 class，不改变行高和条形位置
  setCriticalIds: function(set) {
    this.criticalIds = set && typeof set.has === 'function' ? set : null;
    this.syncCriticalDom();
    return this.criticalIds;
  },

  isCritical: function(taskId) {
    if (!this.criticalIds || taskId === null || taskId === undefined) return false;
    return this.criticalIds.has(String(taskId));
  },

  syncCriticalDom: function() {
    if (!this.body) return;
    var self = this;
    this.body.querySelectorAll('.timeline-row, .gantt-bar, .gantt-summary-bar').forEach(function(el) {
      var id = el.getAttribute('data-task-id');
      el.classList.toggle('critical', self.isCritical(id));
    });
  },

  // ---- 渲染 ----
  render: function(rows) {
    this.rows = rows || [];
    this._progressById = this._computeProgress(this.rows);
    if (!this.body) return;

    var focus = this._captureFocus();
    var savedCenterDate = null;
    if (this.cells.length > 0 && this.body.clientWidth > 0) {
      savedCenterDate = TimelinePane.xToDate(
        this.body.scrollLeft + this.body.clientWidth / 2,
        this.cells,
        this.cellWidth
      );
    }

    var extraDates = this._collectMilestoneDates();
    var range = TimelinePane.calcDateRange(this.rows, this.granularity, extraDates);
    this.startDate = range.startDate;
    this.endDate = range.endDate;

    var generated = TimelinePane.generateCells(
      this.startDate,
      this.endDate,
      this.granularity,
      this._calendarConfig()
    );
    this.cells = generated.cells;
    this.cellWidth = generated.cellWidth;
    this.parentGroups = generated.parentGroups;
    this._syncLegacyGantt();

    if (this.rows.length === 0) {
      if (this.header) this.header.innerHTML = this._renderZoomControls();
      this.body.innerHTML = '<div class="gantt-empty">暂无任务，请先创建任务</div>';
      this._rowsEl = null;
      this.windowStart = 0;
      this.windowEnd = 0;
      this._pendingFocus = null;
      return;
    }

    var totalWidth = this.cells.length * this.cellWidth;
    this._totalWidth = totalWidth;
    if (this.header) this.header.innerHTML = this._renderHeader(totalWidth);
    this.body.innerHTML = this._renderBodyShell(totalWidth);
    this._rowsEl = this.body.querySelector('.timeline-rows');
    this._pendingFocus = null;
    this._updateWindow(true);
    if (!this.body.clientHeight) this.scheduleWindowUpdate();

    var todayX = TimelinePane.dateToX(DateUtil.format(new Date()), this.cells, this.cellWidth);
    if (savedCenterDate) {
      var centerX = TimelinePane.dateToX(savedCenterDate, this.cells, this.cellWidth);
      this.body.scrollLeft = Math.max(0, centerX - this.body.clientWidth / 2);
    } else if (todayX >= 0 && todayX <= totalWidth) {
      this.body.scrollLeft = Math.max(0, todayX - this.body.clientWidth / 2);
    } else {
      var firstStartX = null;
      for (var i = 0; i < this.rows.length; i++) {
        if (this.rows[i] && this.rows[i].startDate) {
          firstStartX = TimelinePane.dateToX(this.rows[i].startDate, this.cells, this.cellWidth);
          break;
        }
      }
      if (firstStartX !== null) {
        this.body.scrollLeft = Math.max(0, firstStartX - this.body.clientWidth / 4);
      }
    }

    this.syncHeader();
    if (focus && !this._restoreFocus(focus)) this._pendingFocus = focus;
  },

  syncHeader: function() {
    if (!this.header || !this.body) return;

    var inner = this.header.querySelector('.timeline-header');
    if (inner) {
      inner.style.transform = 'translateX(' + (-this.body.scrollLeft) + 'px)';
    }

    var scrollLeft = this.body.scrollLeft;
    this.body.querySelectorAll('.gantt-bar').forEach(function(bar) {
      var label = bar.querySelector('.gantt-bar-label');
      if (!label) return;
      var barLeft = parseFloat(bar.dataset.barLeft);
      if (!isFinite(barLeft)) {
        label.style.marginLeft = '0';
      } else if (barLeft < scrollLeft) {
        label.style.marginLeft = (scrollLeft - barLeft) + 'px';
      } else {
        label.style.marginLeft = '0';
      }
    });
  },

  setGranularity: function(granularity) {
    if (granularity !== 'day' && granularity !== 'week' && granularity !== 'month') return;
    this.granularity = granularity;
    this.render(this.rows);
  },

  updateSelection: function(taskId) {
    var id = taskId === null || taskId === undefined ? null : String(taskId);
    this.selectedTaskId = id;
    if (!this.body) return;

    this.body.querySelectorAll('.timeline-row, .gantt-bar, .gantt-summary-bar, .gantt-baseline-bar').forEach(function(el) {
      el.classList.toggle('selected', id !== null && el.getAttribute('data-task-id') === id);
    });
    this._setArrowState('selected', id);
  },

  updateHover: function(taskId) {
    var id = taskId === null || taskId === undefined ? null : String(taskId);
    this.hoveredTaskId = id;
    if (!this.body) return;

    this.body.querySelectorAll('.timeline-row').forEach(function(el) {
      el.classList.toggle('hovered', id !== null && el.getAttribute('data-task-id') === id);
    });
    this.body.querySelectorAll('.gantt-bar, .gantt-summary-bar, .gantt-baseline-bar').forEach(function(el) {
      el.classList.toggle('highlight', id !== null && el.getAttribute('data-task-id') === id);
    });
    this._setArrowState('hovered', id);
  },

  // 焦点仍在时间轴内，或落在 body 上（被卸载后浏览器回收），才保留待恢复焦点
  _keepsPendingFocus: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    var active = doc && doc.activeElement;
    if (!active) return false;
    if (active === doc.body || active === doc.documentElement) return true;
    return !!(this.body && this.body.contains(active));
  },

  _captureFocus: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    var active = doc && doc.activeElement;
    if (!active || !this.body || !this.body.contains(active) || !active.closest) return null;
    var el = active.closest('.gantt-bar, .gantt-summary-bar, .gantt-milestone, .timeline-row');
    if (!el) return null;
    var taskId = el.getAttribute('data-task-id');
    if (!taskId) return null;
    var kind = el.classList.contains('gantt-bar') ? 'bar'
      : el.classList.contains('gantt-summary-bar') ? 'summary'
      : el.classList.contains('gantt-milestone') ? 'milestone'
      : 'row';
    return {
      taskId: taskId,
      kind: kind,
      milestoneId: el.getAttribute('data-milestone-id')
    };
  },

  _restoreFocus: function(focus) {
    if (!focus || !this.body) return false;
    var selector = focus.kind === 'bar' ? '.gantt-bar'
      : focus.kind === 'summary' ? '.gantt-summary-bar'
      : focus.kind === 'milestone' ? '.gantt-milestone'
      : '.timeline-row';
    var nodes = this.body.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-task-id') !== focus.taskId) continue;
      if (focus.kind === 'milestone' && focus.milestoneId &&
          nodes[i].getAttribute('data-milestone-id') !== focus.milestoneId) {
        continue;
      }
      try {
        nodes[i].focus({ preventScroll: true });
      } catch (err) {
        nodes[i].focus();
      }
      return true;
    }
    return false;
  },

  // ---- 内部渲染 ----
  _renderZoomControls: function() {
    var gran = this.granularity || 'day';
    var isDay = gran === 'day';
    var isMonth = gran === 'month';
    var granLabel = isDay ? '日' : (gran === 'week' ? '周' : '月');
    return '<div class="gantt-zoom-controls">'
      + '<button type="button" id="btn-gantt-zoom-out" class="btn-gantt-zoom" aria-label="缩小时间粒度" title="缩小时间粒度 (减号)"' + (isMonth ? ' disabled="disabled"' : '') + '>−</button>'
      + '<span id="gantt-granularity-label" class="gantt-granularity-label">' + granLabel + '</span>'
      + '<button type="button" id="btn-gantt-zoom-in" class="btn-gantt-zoom" aria-label="放大时间粒度" title="放大时间粒度 (加号)"' + (isDay ? ' disabled="disabled"' : '') + '>+</button>'
      + '</div>';
  },

  _renderHeader: function(totalWidth) {
    var self = this;
    var html = '<div class="timeline-header" style="width:' + totalWidth + 'px;">';

    html += '<div class="timeline-header-row timeline-header-parent">';
    this.parentGroups.forEach(function(group) {
      html += '<div class="timeline-header-group" style="width:' + (group.count * self.cellWidth) + 'px;">'
        + _timelineEscape(group.label) + '</div>';
    });
    html += '</div>';

    html += '<div class="timeline-header-row">';
    this.cells.forEach(function(cell) {
      var cls = 'timeline-header-cell';
      if (cell.isWeekend) cls += ' weekend';
      if (cell.isHoliday) cls += ' holiday';
      if (cell.isMakeup) cls += ' makeup';
      var weekday = cell.weekday
        ? '<div class="weekday">' + _timelineEscape(cell.weekday) + '</div>'
        : '';
      var markerTitle = cell.holidayName ? (' title="' + _timelineEscape(cell.holidayName) + '"') : '';
      var marker = cell.isHoliday
        ? '<span class="timeline-calendar-marker holiday"' + markerTitle + '>节</span>'
        : cell.isMakeup
          ? '<span class="timeline-calendar-marker makeup"' + markerTitle + '>班</span>'
          : '';
      var cellTitle = cell.holidayName ? (' title="' + _timelineEscape(cell.holidayName) + '"') : '';
      html += '<div class="' + cls + '" style="width:' + self.cellWidth + 'px'
        + _timelineCellBackground(cell) + ';"' + cellTitle + '>'
        + weekday + '<div>' + _timelineEscape(cell.label) + marker + '</div></div>';
    });
    html += '</div>';

    html += '</div>';
    return html + this._renderZoomControls();
  },

  // 全量结构：内容容器、今日线、行容器、依赖箭头。行本身由 _updateWindow 挂载。
  _renderBodyShell: function(totalWidth) {
    var totalHeight = this.rows.length * TimelinePane.ROW_HEIGHT;
    var html = '<div class="timeline-content" style="width:' + totalWidth + 'px;height:'
      + totalHeight + 'px;">';

    var todayX = TimelinePane.dateToX(DateUtil.format(new Date()), this.cells, this.cellWidth);
    if (todayX >= 0 && todayX <= totalWidth) {
      html += '<div class="gantt-today-line" style="left:' + todayX + 'px;"></div>';
    }

    html += '<div class="timeline-rows"></div>';
    html += this._renderArrows(this.rows, totalWidth);
    html += '</div>';
    return html;
  },

  // 全量行 HTML：保留给直接渲染与测试，不经过窗口计算。
  _renderBody: function(totalWidth) {
    var totalHeight = this.rows.length * TimelinePane.ROW_HEIGHT;
    var html = '<div class="timeline-content" style="width:' + totalWidth + 'px;min-height:'
      + totalHeight + 'px;">';

    var todayX = TimelinePane.dateToX(DateUtil.format(new Date()), this.cells, this.cellWidth);
    if (todayX >= 0 && todayX <= totalWidth) {
      html += '<div class="gantt-today-line" style="left:' + todayX + 'px;"></div>';
    }

    html += this._renderRowsHtml(0, this.rows.length, totalWidth);
    html += this._renderArrows(this.rows, totalWidth);
    html += '</div>';
    return html;
  },

  // 日期网格单元在所有行中完全相同，只生成一次并复用，避免窗口更新时重复拼接。
  _gridCellsHtml: function() {
    if (this._cellsHtml && this._cellsHtmlCells === this.cells &&
        this._cellsHtmlWidth === this.cellWidth) {
      return this._cellsHtml;
    }
    var html = '';
    for (var c = 0; c < this.cells.length; c++) {
      var cell = this.cells[c];
      var cellCls = 'timeline-grid-cell';
      if (cell.isWeekend) cellCls += ' weekend';
      if (cell.isHoliday) cellCls += ' holiday';
      if (cell.isMakeup) cellCls += ' makeup';
      html += '<div class="' + cellCls + '" style="width:' + this.cellWidth + 'px'
        + _timelineCellBackground(cell) + ';"></div>';
    }
    this._cellsHtml = html;
    this._cellsHtmlCells = this.cells;
    this._cellsHtmlWidth = this.cellWidth;
    return html;
  },

  // 渲染 [start, end) 行，top 使用绝对行号，保证窗口切换时行位置稳定。
  _renderRowsHtml: function(start, end, totalWidth) {
    var self = this;
    var rowHeight = TimelinePane.ROW_HEIGHT;
    var from = Math.max(0, Math.floor(start || 0));
    var to = Math.min(this.rows.length, Math.floor(end === undefined ? this.rows.length : end));
    var html = '';

    for (var index = from; index < to; index++) {
      var row = this.rows[index];
      if (!row) continue;

      var rowCls = 'timeline-row';
      if (row.id === self.selectedTaskId) rowCls += ' selected';
      if (row.id === self.hoveredTaskId) rowCls += ' hovered';
      if (self.isCritical(row.id)) rowCls += ' critical';

      html += '<div class="' + rowCls + '" data-task-id="' + _timelineEscape(row.id)
        + '" data-row-index="' + index + '" style="top:' + (index * rowHeight)
        + 'px;width:' + totalWidth + 'px;height:' + rowHeight + 'px;">';
      html += this._gridCellsHtml();
      html += this._renderBar(row, index);
      html += this._renderBaselineBar(row);
      html += this._renderMilestones(row);
      html += '</div>';
    }

    return html;
  },

  // ---- 窗口更新 ----
  // 滚动只替换行容器内容，表头、今日线和依赖箭头保持不动。
  // 同步刷新一次窗口，用于恢复滚动位置等一次性场景，不等待下一帧。
  refreshWindow: function() {
    return this._updateWindow(false);
  },

  scheduleWindowUpdate: function() {
    if (this._windowRaf) return;
    var self = this;
    var raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : function(callback) { return setTimeout(callback, 16); };
    this._windowRaf = raf(function() {
      self._windowRaf = 0;
      self._updateWindow(false);
    });
  },

  _updateWindow: function(force) {
    if (!this._rowsEl || !this.body) return false;
    if (!force && this._isDragging()) return false;

    var scrollTop = this.body.scrollTop || 0;
    var viewport = this.body.clientHeight || 0;
    var win = TimelinePane.computeWindow(
      scrollTop,
      viewport,
      TimelinePane.ROW_HEIGHT,
      this.rows.length,
      TimelinePane.WINDOW_OVERSCAN
    );

    if (force) {
      this._pendingFocus = null;
    } else {
      var focus = this._captureFocus();
      if (focus) this._pendingFocus = focus;
      else if (!this._keepsPendingFocus()) this._pendingFocus = null;
      if (win.start === this.windowStart && win.end === this.windowEnd) {
        return false;
      }
    }

    this.windowStart = win.start;
    this.windowEnd = win.end;
    this._rowsEl.innerHTML = this._renderRowsHtml(win.start, win.end, this._totalWidth);
    this.syncHeader();

    if (this._pendingFocus && this._restoreFocus(this._pendingFocus)) {
      this._pendingFocus = null;
    }
    return true;
  },

  _barBox: function(row, index) {
    var kind = TimelinePane.classifyRow(row);
    if (kind === 'empty') return null;

    var startX = TimelinePane.dateToX(row.startDate, this.cells, this.cellWidth);
    var endX = TimelinePane.dateToX(_timelineAddDays(row.endDate, 1), this.cells, this.cellWidth);
    var isSummary = kind === 'summary';

    return {
      left: startX,
      width: Math.max(endX - startX, 20),
      top: index * TimelinePane.ROW_HEIGHT + (isSummary ? TimelinePane.SUMMARY_TOP : TimelinePane.BAR_TOP),
      height: isSummary ? TimelinePane.SUMMARY_HEIGHT : TimelinePane.BAR_HEIGHT,
      rowIndex: index
    };
  },

  _renderArrows: function(rows, totalWidth) {
    if (typeof Arrows === 'undefined' || !Arrows) return '';
    if (typeof TaskManager === 'undefined' || !TaskManager ||
        typeof TaskManager.getLinks !== 'function') {
      return '';
    }

    var links = TaskManager.getLinks();
    if (!Array.isArray(links) || links.length === 0) return '';

    var boxes = {};
    (rows || []).forEach(function(row, index) {
      var box = TimelinePane._barBox(row, index);
      if (box) boxes[row.id] = box;
    });

    var layouts = Arrows.layout(links, boxes, { avoidOverlap: true });
    if (layouts.length === 0) return '';

    var width = typeof totalWidth === 'number'
      ? totalWidth
      : this.cells.length * this.cellWidth;
    var height = (rows || []).length * TimelinePane.ROW_HEIGHT;

    var html = '<svg class="dep-arrows" width="' + width + '" height="' + height
      + '" viewBox="0 0 ' + width + ' ' + height
      + '" aria-hidden="true" focusable="false">';

    layouts.forEach(function(item) {
      var linkId = _timelineEscape(item.id);
      html += '<g class="dep-arrow" data-link-id="' + linkId
        + '" data-source="' + _timelineEscape(item.source)
        + '" data-target="' + _timelineEscape(item.target) + '">'
        + '<path class="dep-arrow-hit" data-link-id="' + linkId + '" d="' + item.d + '"></path>'
        + '<path class="dep-arrow-line dep-arrow-' + _timelineEscape(item.type)
        + '" data-link-id="' + linkId + '" d="' + item.d + '"></path>'
        + '<polygon class="dep-arrow-head" points="' + item.head + '"></polygon>'
        + '</g>';
    });

    html += '</svg>';
    return html;
  },

  _setArrowState: function(className, taskId) {
    if (!this.body) return;
    var id = taskId === null || taskId === undefined ? null : String(taskId);
    this.body.querySelectorAll('.dep-arrow').forEach(function(group) {
      if (!group.classList || !group.classList.contains('dep-arrow')) return;
      var match = id !== null && (group.getAttribute('data-source') === id ||
        group.getAttribute('data-target') === id);
      group.classList.toggle(className, match);
    });
  },

  _renderBar: function(row) {
    var kind = TimelinePane.classifyRow(row);
    if (kind === 'empty') return '';

    var startX = TimelinePane.dateToX(row.startDate, this.cells, this.cellWidth);
    var endX = TimelinePane.dateToX(_timelineAddDays(row.endDate, 1), this.cells, this.cellWidth);
    var width = Math.max(endX - startX, 20);
    var selectedCls = row.id === this.selectedTaskId ? ' selected' : '';
    var hoverCls = row.id === this.hoveredTaskId ? ' highlight' : '';
    var criticalCls = this.isCritical(row.id) ? ' critical' : '';
    var title = _timelineEscape(row.task.name) + ' (' + _timelineEscape(row.startDate)
      + ' ~ ' + _timelineEscape(row.endDate) + ')' + this._durationText(row)
      + (row.task.locked ? ' · 已锁定' : '');

    var effectiveStatus = (typeof TaskManager !== 'undefined' && TaskManager && typeof TaskManager.getEffectiveStatus === 'function')
      ? TaskManager.getEffectiveStatus(row.task)
      : (row.task && row.task.status || 'todo');
    var statusCls = effectiveStatus === 'todo' ? ' status-todo'
      : effectiveStatus === 'done' ? ' status-done'
      : effectiveStatus === 'thirdParty' ? ' status-thirdParty'
      : ' status-inProgress';

    if (kind === 'summary') {
      var summaryProgress = this._progressValue(row);
      return '<div class="gantt-summary-bar' + statusCls + selectedCls + hoverCls + criticalCls + '" data-task-id="'
        + _timelineEscape(row.id) + '" style="left:' + startX + 'px;top:' + TimelinePane.SUMMARY_TOP
        + 'px;width:' + width + 'px;" title="' + title + '">'
        + '<span class="gantt-summary-progress" style="width:' + summaryProgress + '%"></span>'
        + '</div>';
    }

    var task = row.task;
    var color = _timelineSafeColor(TaskManager.getEffectiveColor(task));
    var progress = this._progressValue(row);
    var assigneeText = task.assignee ? ' [' + _timelineEscape(task.assignee) + ']' : '';
    var label = _timelineEscape(task.name)
      + ' <span class="gantt-bar-dates">(' + _timelineEscape(row.startDate.slice(5))
      + ' ~ ' + _timelineEscape(row.endDate.slice(5)) + ')</span>';

    return '<div class="gantt-bar' + statusCls + selectedCls + hoverCls + criticalCls
      + '" data-task-id="' + _timelineEscape(row.id) + '" data-bar-left="' + startX
      + '" style="left:' + startX + 'px;width:' + width + 'px;top:' + TimelinePane.BAR_TOP
      + 'px;background:' + color + ';" role="button" tabindex="0" data-keyboard-activate'
      + ' title="' + title + assigneeText + '">'
      + '<span class="gantt-bar-progress" style="width:' + progress + '%"></span>'
      + '<span class="gantt-bar-label">' + label + '</span></div>';
  },

  _renderBaselineBar: function(row) {
    var entry = this._baselineEntry(row);
    if (!entry) return '';

    var startX = TimelinePane.dateToX(entry.baselineStartDate, this.cells, this.cellWidth);
    var endX = TimelinePane.dateToX(_timelineAddDays(entry.baselineEndDate, 1), this.cells, this.cellWidth);
    var width = Math.max(endX - startX, 12);
    var variance = entry.endVarianceDays;

    var cls = 'gantt-baseline-bar';
    if (typeof variance === 'number' && isFinite(variance)) {
      if (variance > 0) cls += ' is-delayed';
      else if (variance < 0) cls += ' is-advanced';
      else cls += ' is-flat';
    }
    if (row.id === this.selectedTaskId) cls += ' selected';
    if (row.id === this.hoveredTaskId) cls += ' highlight';

    var varianceText = typeof variance === 'number' && isFinite(variance)
      ? (typeof Baseline !== 'undefined' && Baseline &&
          typeof Baseline.formatVariance === 'function'
          ? Baseline.formatVariance(variance)
          : String(Math.round(variance))) + ' 天'
      : '不可比较';
    var title = '基线 ' + entry.baselineStartDate + ' ~ ' + entry.baselineEndDate
      + '，结束偏差 ' + varianceText;

    return '<div class="' + cls + '" data-task-id="' + _timelineEscape(row.id)
      + '" style="left:' + startX + 'px;top:' + TimelinePane.BASELINE_TOP
      + 'px;width:' + width + 'px;" title="' + _timelineEscape(title) + '"></div>';
  },

  progressPercent: function(task) {
    var value = task && typeof task.progress === 'number' ? task.progress : 0;
    if (!isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return Math.round(value);
  },

  _progressValue: function(row) {
    var value = row && row.task ? row.task.progress : 0;
    if (this._progressById && row && this._progressById.has(row.id)) {
      value = this._progressById.get(row.id);
    }
    var numeric = Number(value);
    if (!isFinite(numeric)) numeric = 0;
    if (numeric < 0) numeric = 0;
    if (numeric > 100) numeric = 100;
    return Math.round(numeric);
  },

  _renderMilestones: function(row) {
    if (typeof TaskManager === 'undefined' || !TaskManager || !TaskManager.getMilestonesByTask) {
      return '';
    }

    var self = this;
    var milestones = TaskManager.getMilestonesByTask(row.id) || [];
    var html = '';

    milestones.forEach(function(ms) {
      var startX = TimelinePane.dateToX(ms.date, self.cells, self.cellWidth);
      var endX = TimelinePane.dateToX(_timelineAddDays(ms.date, 1), self.cells, self.cellWidth);
      var x = (startX + endX) / 2;
      var done = ms.status === 'done';
      var icon = done ? '○' : '□';

      html += '<div class="gantt-milestone' + (done ? ' done' : '') + '" data-milestone-id="'
        + _timelineEscape(ms.id) + '" data-task-id="' + _timelineEscape(row.id)
        + '" style="left:' + x + 'px;top:' + TimelinePane.MILESTONE_TOP
        + 'px;" role="button" tabindex="0" data-keyboard-activate title="'
        + _timelineEscape(ms.name) + ' (' + _timelineEscape(ms.date) + ')">' + icon + '</div>';
    });

    return html;
  },

  _collectMilestoneDates: function() {
    if (typeof TaskManager === 'undefined' || !TaskManager || !TaskManager.getMilestonesByTask) {
      return [];
    }
    var dates = [];
    this.rows.forEach(function(row) {
      TaskManager.getMilestonesByTask(row.id).forEach(function(ms) {
        if (ms.date) dates.push(ms.date);
      });
    });
    return dates;
  },

  _syncLegacyGantt: function() {
    if (typeof GanttView === 'undefined' || !GanttView) return;
    GanttView.cells = this.cells;
    GanttView.cellWidth = this.cellWidth;
    GanttView.granularity = this.granularity;
  },

  // ---- 事件委托 ----
  _bindEvents: function() {
    var self = this;

    if (this.header && this._boundHeader !== this.header) {
      this._boundHeader = this.header;
      this.header.addEventListener('click', function(e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var btnIn = target.closest('#btn-gantt-zoom-in');
        if (btnIn && !btnIn.disabled) {
          e.stopPropagation();
          var nextIn = self.granularity === 'month' ? 'week' : self.granularity === 'week' ? 'day' : 'day';
          if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setGranularity === 'function') {
            Workbench.setGranularity(nextIn);
          } else {
            self.setGranularity(nextIn);
          }
          if (typeof TaskManager !== 'undefined' && typeof TaskManager.setSetting === 'function') {
            try { TaskManager.setSetting('lastGranularity', nextIn); } catch (err) {}
          }
          return;
        }
        var btnOut = target.closest('#btn-gantt-zoom-out');
        if (btnOut && !btnOut.disabled) {
          e.stopPropagation();
          var nextOut = self.granularity === 'day' ? 'week' : self.granularity === 'week' ? 'month' : 'month';
          if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setGranularity === 'function') {
            Workbench.setGranularity(nextOut);
          } else {
            self.setGranularity(nextOut);
          }
          if (typeof TaskManager !== 'undefined' && typeof TaskManager.setSetting === 'function') {
            try { TaskManager.setSetting('lastGranularity', nextOut); } catch (err) {}
          }
          return;
        }
      });
    }

    if (!this.body || this._boundBody === this.body) return;
    this._boundBody = this.body;

    this.body.addEventListener('scroll', function() {
      self.syncHeader();
      self.scheduleWindowUpdate();
    });
    this.body.addEventListener('click', function(e) { self._onClick(e); });
    this.body.addEventListener('dblclick', function(e) { self._onDblClick(e); });
    this.body.addEventListener('mouseover', function(e) { self._onMouseOver(e); });
    this.body.addEventListener('mouseout', function(e) { self._onMouseOut(e); });
    this.body.addEventListener('contextmenu', function(e) { self._onContextMenu(e); });
  },

  _onClick: function(e) {
    var target = e.target;
    if (!target || !target.closest) return;

    var arrow = target.closest('.dep-arrow-hit');
    if (arrow) {
      e.stopPropagation();
      var linkId = arrow.getAttribute('data-link-id');
      if (linkId && typeof App !== 'undefined' && App && typeof App.deleteLink === 'function') {
        App.deleteLink(linkId);
      }
      return;
    }

    var milestone = target.closest('.gantt-milestone');
    if (milestone) {
      e.stopPropagation();
      if (typeof App !== 'undefined' && App && typeof App.toggleMilestoneStatus === 'function') {
        App.toggleMilestoneStatus(milestone.dataset.milestoneId);
      }
      return;
    }

    var hit = target.closest('.gantt-bar, .gantt-summary-bar, .timeline-row');
    if (!hit) return;

    var taskId = hit.dataset.taskId;
    if (taskId) this._select(taskId);
  },

  _onDblClick: function(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    if (target.closest('.gantt-milestone')) return;

    var hit = target.closest('.gantt-bar, .gantt-summary-bar, .timeline-row');
    if (!hit || !hit.dataset.taskId) return;
    if (typeof App !== 'undefined' && App && typeof App.showEditTask === 'function') {
      App.showEditTask(hit.dataset.taskId);
    }
  },

  _onMouseOver: function(e) {
    if (this._isDragging()) return;
    var row = e.target && e.target.closest ? e.target.closest('.timeline-row') : null;
    if (!row || row.contains(e.relatedTarget)) return;
    this._hover(row.dataset.taskId);
  },

  _onMouseOut: function(e) {
    if (this._isDragging()) return;
    var row = e.target && e.target.closest ? e.target.closest('.timeline-row') : null;
    if (!row || row.contains(e.relatedTarget)) return;
    this._hover(null);
  },

  _onContextMenu: function(e) {
    var target = e.target;
    if (!target || !target.closest) return;

    if (typeof TreeView === 'undefined' || !TreeView || typeof TreeView.showContextMenu !== 'function') {
      return;
    }

    var arrowHit = target.closest('.dep-arrow-hit');
    if (arrowHit) {
      e.preventDefault();
      e.stopPropagation();
      var arrowLinkId = arrowHit.getAttribute('data-link-id');
      TreeView.showContextMenu(e.clientX, e.clientY, [
        { label: '删除依赖', danger: true, action: function() {
          if (typeof App !== 'undefined' && App && App.deleteLink) App.deleteLink(arrowLinkId);
        } }
      ]);
      return;
    }

    var milestone = target.closest('.gantt-milestone');
    if (milestone) {
      e.preventDefault();
      e.stopPropagation();
      var milestoneId = milestone.dataset.milestoneId;
      TreeView.showContextMenu(e.clientX, e.clientY, [
        { label: '编辑里程碑', action: function() {
          if (typeof App !== 'undefined' && App && App.showEditMilestone) App.showEditMilestone(milestoneId);
        } },
        { label: '删除里程碑', danger: true, action: function() {
          if (typeof App !== 'undefined' && App && App.deleteMilestone) App.deleteMilestone(milestoneId);
        } }
      ]);
      return;
    }

    var bar = target.closest('.gantt-bar');
    if (!bar) return;

    e.preventDefault();
    e.stopPropagation();
    var taskId = bar.dataset.taskId;
    var rect = this.body.getBoundingClientRect();
    var x = e.clientX - rect.left + this.body.scrollLeft;
    var dateAtClick = TimelinePane.xToDate(x, this.cells, this.cellWidth);

    TreeView.showContextMenu(e.clientX, e.clientY, [
      { label: '添加里程碑', action: function() {
        if (typeof App !== 'undefined' && App && App.showAddMilestoneAtDate) App.showAddMilestoneAtDate(taskId, dateAtClick);
      } },
      { label: '添加依赖', action: function() {
        if (typeof App !== 'undefined' && App && App.showAddDependency) App.showAddDependency(taskId);
      } },
      { label: '删除依赖', action: function() {
        if (typeof App !== 'undefined' && App && App.showDeleteDependency) App.showDeleteDependency(taskId);
      } }
    ]);
  },

  _isDragging: function() {
    return typeof DragManager !== 'undefined' && DragManager
      && (DragManager.isDragging || !!DragManager._pendingDrag);
  },

  _select: function(taskId) {
    if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setSelected === 'function') {
      Workbench.setSelected(taskId);
    } else if (typeof App !== 'undefined' && App && typeof App.onTaskSelected === 'function') {
      App.onTaskSelected(taskId);
    } else {
      this.updateSelection(taskId);
    }
  },

  _hover: function(taskId) {
    if (typeof Workbench !== 'undefined' && Workbench && typeof Workbench.setHovered === 'function') {
      Workbench.setHovered(taskId);
    } else if (typeof App !== 'undefined' && App && typeof App.onTaskHovered === 'function') {
      App.onTaskHovered(taskId);
    } else {
      this.updateHover(taskId);
    }
  }
};

function _timelineCellWidth(granularity) {
  if (granularity === 'month') return 80;
  if (granularity === 'week') return 60;
  return 45;
}

function _timelinePad2(value) {
  return String(value).padStart(2, '0');
}

function _timelineDateString(date) {
  return date.getFullYear() + '-' + _timelinePad2(date.getMonth() + 1) + '-' + _timelinePad2(date.getDate());
}

// 把工作日历配置拆成集合，配置缺失或非法时回退到默认周末
function _timelineCalendarMarks(config) {
  var marks = {
    weekendSet: new Set([0, 6]),
    holidaySet: new Set(),
    workdaySet: new Set()
  };
  if (!config || typeof config !== 'object') return marks;

  if (Array.isArray(config.weekends)) {
    marks.weekendSet = new Set();
    config.weekends.forEach(function(day) {
      if (typeof day !== 'number' || !isFinite(day)) return;
      if (day !== Math.floor(day) || day < 0 || day > 6) return;
      marks.weekendSet.add(day);
    });
  }
  if (Array.isArray(config.holidays)) {
    config.holidays.forEach(function(day) {
      if (typeof day === 'string') marks.holidaySet.add(day);
    });
  }
  if (Array.isArray(config.workdays)) {
    config.workdays.forEach(function(day) {
      if (typeof day === 'string') marks.workdaySet.add(day);
    });
  }
  return marks;
}

// 节假日和补班日使用不同底色，周末沿用样式表
function _timelineCellBackground(cell) {
  if (!cell) return '';
  if (cell.isHoliday) return ';background:rgba(220,38,38,0.10)';
  if (cell.isMakeup) return ';background:rgba(22,163,74,0.10)';
  return '';
}

function _timelineWeekday(dayOfWeek) {
  var weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return weekdays[(dayOfWeek + 6) % 7];
}

function _timelineWeekNumber(date) {
  var target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  target.setDate(target.getDate() + 3 - (target.getDay() + 6) % 7);
  var week1 = new Date(target.getFullYear(), 0, 4);
  return 1 + Math.round(((target - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function _timelineBuildGroups(cells) {
  var groups = [];
  var current = null;

  cells.forEach(function(cell, index) {
    if (!current || current.label !== cell.groupLabel) {
      if (current) groups.push(current);
      current = { label: cell.groupLabel, startIndex: index, count: 1 };
    } else {
      current.count++;
    }
  });
  if (current) groups.push(current);

  return groups;
}

function _timelineDayNumber(date) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function _timelineEndExclusive(cell) {
  return new Date(cell.end.getFullYear(), cell.end.getMonth(), cell.end.getDate() + 1);
}

function _timelineAddDays(dateStr, days) {
  var date = DateUtil.parse(dateStr);
  return DateUtil.format(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function _timelineEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _timelineSafeColor(color) {
  var taskColor = '#1e40af';
  return /^#[0-9a-fA-F]{3,8}$/.test(String(color)) ? color : taskColor;
}
