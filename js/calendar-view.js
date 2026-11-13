// ============================================================
// == CalendarView: 月历渲染
// ============================================================
var CalendarView = {
  container: null,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),

  init: function(container) {
    this.container = container;
    this._bindEvents();
  },

  render: function() {
    var year = this.currentYear;
    var month = this.currentMonth;
    var today = new Date();
    var todayStr = DateUtil.format(today);
    var self = this;
    var focus = this._captureFocus();

    var monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    var html = '<div class="calendar-container">';
    html += '<div class="calendar-nav">';
    html += '<button id="cal-prev-month">◀</button>';
    html += '<span class="month-label">' + year + '年 ' + monthNames[month] + '</span>';
    html += '<button id="cal-next-month">▶</button>';
    html += '</div>';

    html += '<div class="calendar-grid">';

    var weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    weekdays.forEach(function(d) {
      html += '<div class="calendar-weekday">' + d + '</div>';
    });

    var firstDay = new Date(year, month, 1);
    var startDay = new Date(firstDay);
    var dayOfWeek = (firstDay.getDay() + 6) % 7;
    startDay.setDate(startDay.getDate() - dayOfWeek);

    var allTasks = TaskManager.getAllTasks();
    var filter = TreeView.statusFilter;
    var leafTasks = allTasks.filter(function(t) {
      return TaskManager.getChildren(t.id).length === 0 && filter[t.status] !== false;
    });
    var allMilestones = TaskManager.getAllMilestones();

    var wsObj = (typeof Workspace !== 'undefined' && Workspace && Workspace.data) ? Workspace : null;
    var globalCalendar = wsObj ? wsObj.data.calendar : null;
    var projectOverrides = (typeof TaskManager !== 'undefined' && TaskManager && TaskManager.data && TaskManager.data.settings)
      ? (TaskManager.data.settings.calendarOverrides || TaskManager.data.settings.workCalendar)
      : null;

    if (globalCalendar && globalCalendar.subscribed !== false && (!globalCalendar.cacheByYear || !globalCalendar.cacheByYear[year])) {
      if (typeof HolidaySource !== 'undefined' && HolidaySource && typeof HolidaySource.refresh === 'function') {
        HolidaySource.refresh(year, { force: false }).then(function() {
          if (self.currentYear === year && self.currentMonth === month) {
            self.render();
          }
        }).catch(function() {});
      }
    }

    for (var i = 0; i < 42; i++) {
      var date = new Date(startDay);
      date.setDate(date.getDate() + i);
      var dateStr = DateUtil.format(date);
      var isCurrentMonth = date.getMonth() === month;
      var isToday = dateStr === todayStr;

      var dayInfo = (typeof HolidaySource !== 'undefined' && HolidaySource)
        ? HolidaySource.resolveDate(dateStr, globalCalendar, projectOverrides)
        : null;

      var isHoliday = false;
      var isMakeup = false;
      var isWeekend = false;
      var holidayName = '';

      if (dayInfo) {
        holidayName = dayInfo.name || '';
        if (dayInfo.source === 'subscription' || dayInfo.source === 'import') {
          if (dayInfo.working) isMakeup = true;
          else isHoliday = true;
        } else if (dayInfo.source === 'manual') {
          if (dayInfo.working) {
            if (date.getDay() === 0 || date.getDay() === 6) isMakeup = true;
          } else {
            isHoliday = true;
          }
        } else {
          isWeekend = !dayInfo.working;
        }
      } else {
        isWeekend = (date.getDay() === 0 || date.getDay() === 6);
      }

      var cls = 'calendar-day';
      if (!isCurrentMonth) cls += ' other-month';
      if (isToday) cls += ' today';
      if (isHoliday) cls += ' holiday';
      if (isMakeup) cls += ' makeup';
      if (isWeekend) cls += ' weekend';

      var badge = '';
      if (isHoliday) {
        badge = '<span class="calendar-day-badge holiday" title="' + _escapeHtml(holidayName || '法定节假日') + '">节</span>';
      } else if (isMakeup) {
        badge = '<span class="calendar-day-badge makeup" title="' + _escapeHtml(holidayName || '调休补班') + '">班</span>';
      }

      var dayTitle = holidayName ? (' title="' + _escapeHtml(holidayName) + '"') : '';
      html += '<div class="' + cls + '" data-date="' + dateStr + '"' + dayTitle + '>';
      html += '<div class="calendar-day-header"><span class="calendar-day-number">' + date.getDate() + '</span>' + badge + '</div>';

      leafTasks.forEach(function(task) {
        var range = TaskManager.getDateRange(task);
        if (!range.startDate || !range.endDate) return;
        if (dateStr >= range.startDate && dateStr <= range.endDate) {
          var color = TaskManager.getEffectiveColor(task);
          var statusStyle = task.status === 'done' ? 'opacity:0.45;filter:grayscale(0.8);' : task.status === 'thirdParty' ? 'filter:saturate(0.6);' : task.status === 'todo' ? 'opacity:0.75;' : '';
          var showName = dateStr === range.startDate || date.getDay() === 1;
          html += '<div class="calendar-task-bar status-' + (task.status || 'todo') + '" style="background:' + _safeColor(color) + ';' + statusStyle + '" role="button" tabindex="0" data-keyboard-activate data-task-id="' + _escapeHtml(task.id) + '" title="' + _escapeHtml(task.name) + '">' + (showName ? _escapeHtml(task.name) : '&nbsp;') + '</div>';
        }
      });

      allMilestones.forEach(function(ms) {
        if (ms.date === dateStr) {
          var msIcon = (ms.status === 'done') ? '○' : '□';
          var msClass = 'calendar-milestone-item' + (ms.status === 'done' ? ' done' : '');
          html += '<div class="' + msClass + '" role="button" tabindex="0" data-keyboard-activate data-milestone-id="' + _escapeHtml(ms.id) + '" title="' + _escapeHtml(ms.name) + '">' + msIcon + ' ' + _escapeHtml(ms.name) + '</div>';
        }
      });

      html += '</div>';
    }

    html += '</div></div>';
    this.container.innerHTML = html;
    this._restoreFocus(focus);
  },

  _bindEvents: function() {
    if (!this.container || this._boundContainer === this.container) return;
    this._boundContainer = this.container;
    var self = this;

    this.container.addEventListener('click', function(e) {
      if (!e || !e.target || !e.target.closest) return;

      var prevBtn = e.target.closest('#cal-prev-month');
      if (prevBtn) {
        e.stopPropagation();
        self.currentMonth--;
        if (self.currentMonth < 0) { self.currentMonth = 11; self.currentYear--; }
        self.render();
        return;
      }
      var nextBtn = e.target.closest('#cal-next-month');
      if (nextBtn) {
        e.stopPropagation();
        self.currentMonth++;
        if (self.currentMonth > 11) { self.currentMonth = 0; self.currentYear++; }
        self.render();
        return;
      }

      var bar = e.target.closest('.calendar-task-bar');
      if (bar) {
        e.stopPropagation();
        if (typeof App !== 'undefined' && App && typeof App.onGanttTaskClicked === 'function') {
          App.onGanttTaskClicked(bar.dataset.taskId);
        }
        return;
      }
      var milestone = e.target.closest('.calendar-milestone-item');
      if (milestone) {
        e.stopPropagation();
        if (typeof App !== 'undefined' && App && typeof App.toggleMilestoneStatus === 'function') {
          App.toggleMilestoneStatus(milestone.dataset.milestoneId);
        }
      }
    });

    _bindHoverDelegate(this.container, '.calendar-task-bar', function(bar) {
      bar.classList.add('highlight');
      TreeView.setHoverHighlight(bar.dataset.taskId);
    }, function(bar) {
      bar.classList.remove('highlight');
      TreeView.setHoverHighlight(null);
    });

    this.container.addEventListener('contextmenu', function(e) {
      var day = e.target.closest('.calendar-day');
      if (!day) return;
      e.preventDefault();
      var dateStr = day.dataset.date;
      var filter = TreeView.statusFilter;
      var leafTasks = TaskManager.getAllTasks().filter(function(t) {
        return TaskManager.getChildren(t.id).length === 0 && filter[t.status] !== false;
      });
      if (leafTasks.length === 0) return;
      var items = [];
      leafTasks.forEach(function(task) {
        var range = TaskManager.getDateRange(task);
        if (range.startDate && range.endDate && dateStr >= range.startDate && dateStr <= range.endDate) {
          items.push({
            label: '添加里程碑到「' + task.name.substring(0, 8) + '」',
            action: function() { App.showAddMilestoneAtDate(task.id, dateStr); }
          });
        }
      });
      if (items.length > 0) {
        TreeView.showContextMenu(e.clientX, e.clientY, items);
      }
    });
  },

  highlightBar: function(taskId) {
    this.container.querySelectorAll('.calendar-task-bar').forEach(function(el) {
      el.classList.toggle('highlight', el.dataset.taskId === taskId);
    });
  },

  clearHighlight: function() {
    this.container.querySelectorAll('.calendar-task-bar.highlight').forEach(function(el) {
      el.classList.remove('highlight');
    });
  },

  selectBar: function(taskId) {
    var id = taskId === null || taskId === undefined ? null : String(taskId);
    this.container.querySelectorAll('.calendar-task-bar').forEach(function(el) {
      el.classList.toggle('selected', id !== null && el.getAttribute('data-task-id') === id);
    });
  },

  _captureFocus: function() {
    var doc = typeof document !== 'undefined' ? document : null;
    var active = doc && doc.activeElement;
    if (!active || !this.container || !this.container.contains(active) || !active.closest) return null;
    var bar = active.closest('.calendar-task-bar');
    if (bar) return { type: 'task', id: bar.getAttribute('data-task-id') };
    var milestone = active.closest('.calendar-milestone-item');
    if (milestone) return { type: 'milestone', id: milestone.getAttribute('data-milestone-id') };
    return null;
  },

  _restoreFocus: function(focus) {
    if (!focus || !this.container) return;
    var selector = focus.type === 'milestone' ? '.calendar-milestone-item' : '.calendar-task-bar';
    var attr = focus.type === 'milestone' ? 'data-milestone-id' : 'data-task-id';
    var nodes = this.container.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute(attr) !== focus.id) continue;
      try {
        nodes[i].focus({ preventScroll: true });
      } catch (err) {
        nodes[i].focus();
      }
      return;
    }
  }
};
