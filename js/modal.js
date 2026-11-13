// ============================================================
// == ModalManager
// ============================================================
const ModalManager = {
  overlay: null,
  content: null,
  _mouseDownOnOverlay: false,
  _lastFocused: null,
  _FOCUSABLE: 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',

  init: function() {
    var self = this;
    this.overlay = document.getElementById('modal-overlay');
    this.content = document.getElementById('modal-box');

    this.overlay.addEventListener('mousedown', function(e) {
      self._mouseDownOnOverlay = (e.target === self.overlay);
    });

    this.overlay.addEventListener('mouseup', function(e) {
      if (self._mouseDownOnOverlay && e.target === self.overlay) {
        self.close();
      }
      self._mouseDownOnOverlay = false;
    });

    document.addEventListener('keydown', function(e) {
      self._handleKeyDown(e);
    });
  },

  isOpen: function() {
    return !!(this.overlay && this.overlay.classList.contains('active'));
  },

  open: function(html) {
    if (this.isOpen()) {
      this.content.innerHTML = html;
    } else {
      this._lastFocused = document.activeElement;
      this.content.innerHTML = html;
      this.overlay.classList.add('active');
    }
    this._decorate();
    this._focusFirst();
  },

  close: function() {
    if (!this.overlay) return;
    var wasOpen = this.isOpen();
    this.overlay.classList.remove('active');
    this.content.innerHTML = '';
    this.content.removeAttribute('aria-labelledby');
    if (wasOpen && this._lastFocused && this._lastFocused.focus) {
      try {
        this._lastFocused.focus({ preventScroll: true });
      } catch (err) {
        this._lastFocused.focus();
      }
    }
    this._lastFocused = null;
  },

  _decorate: function() {
    if (!this.content) return;
    this.content.setAttribute('role', 'dialog');
    this.content.setAttribute('aria-modal', 'true');
    this.content.setAttribute('tabindex', '-1');
    var title = this.content.querySelector('.modal-title');
    if (title) {
      if (!title.id) title.id = 'modal-title';
      this.content.setAttribute('aria-labelledby', title.id);
      this.content.removeAttribute('aria-label');
    } else {
      this.content.removeAttribute('aria-labelledby');
      this.content.setAttribute('aria-label', '对话框');
    }
  },

  _focusable: function() {
    if (!this.content) return [];
    var nodes = this.content.querySelectorAll(this._FOCUSABLE);
    var result = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.disabled) continue;
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') continue;
      if (typeof node.offsetParent !== 'undefined' && node.offsetParent === null) continue;
      result.push(node);
    }
    return result;
  },

  _focusFirst: function() {
    var nodes = this._focusable();
    if (nodes.length === 0) {
      if (this.content && this.content.focus) this.content.focus();
      return;
    }
    if (this.content && this.content.contains(document.activeElement)) return;
    nodes[0].focus();
  },

  _shouldCloseForKey: function(key) {
    return key === 'Escape';
  },

  _nextFocusIndex: function(index, length, shift) {
    if (!length || length < 1) return -1;
    if (index < 0 || index >= length) return shift ? length - 1 : 0;
    if (shift) return index === 0 ? length - 1 : index - 1;
    return index === length - 1 ? 0 : index + 1;
  },

  _trapFocus: function(event) {
    var nodes = this._focusable();
    if (nodes.length === 0) {
      if (event.preventDefault) event.preventDefault();
      return;
    }
    var index = nodes.indexOf(document.activeElement);
    var shift = !!event.shiftKey;
    var next = this._nextFocusIndex(index, nodes.length, shift);
    if (next === -1) return;
    var wrap = index < 0 || index >= nodes.length ||
      (shift && index === 0) || (!shift && index === nodes.length - 1);
    if (!wrap) return;
    if (event.preventDefault) event.preventDefault();
    nodes[next].focus();
  },

  _handleKeyDown: function(event) {
    if (!this.isOpen()) return false;
    if (this._shouldCloseForKey(event.key)) {
      if (event.preventDefault) event.preventDefault();
      this.close();
      return true;
    }
    if (event.key === 'Tab') {
      this._trapFocus(event);
      return true;
    }
    return false;
  },

  confirm: function(message, onConfirm) {
    this.open(
      '<div class="modal-title">确认</div>'
      + '<p style="margin-bottom:16px;font-size:14px;">' + _escapeHtml(message) + '</p>'
      + '<div class="modal-actions">'
      + '<button onclick="ModalManager.close()">取消</button>'
      + '<button class="btn-danger" id="modal-confirm-btn">确定</button>'
      + '</div>'
    );
    document.getElementById('modal-confirm-btn').addEventListener('click', function() {
      ModalManager.close();
      onConfirm();
    });
  },

  // 解析换行/逗号分隔的日期输入，返回合法日期和非法项
  parseCalendarDates: function(text) {
    var tokens = String(text === null || text === undefined ? '' : text)
      .split(/[\s,，;；]+/)
      .filter(function(token) { return token.length > 0; });
    var dates = [];
    var invalid = [];
    tokens.forEach(function(token) {
      if (!_isCalendarDate(token)) {
        invalid.push(token);
        return;
      }
      if (dates.indexOf(token) === -1) dates.push(token);
    });
    dates.sort();
    return { dates: dates, invalid: invalid };
  },

  showWorkCalendarForm: function(config, onSave) {
    var normalized = (typeof WorkCalendar !== 'undefined' && WorkCalendar)
      ? WorkCalendar.createConfig(config || {})
      : { weekends: [0, 6], holidays: [], workdays: [] };
    var selected = {};
    normalized.weekends.forEach(function(day) { selected[day] = true; });

    var targetProjectId = (typeof Workspace !== 'undefined' && Workspace) ? Workspace.activeProjectId : null;
    var wsData = (typeof Workspace !== 'undefined' && Workspace && Workspace.data) ? Workspace.data : null;
    var calendarState = (wsData && wsData.calendar)
      ? wsData.calendar
      : ((typeof HolidaySource !== 'undefined' && HolidaySource) ? HolidaySource.createInitialCalendarState() : null);

    var weekdays = [
      { value: 1, label: '周一' },
      { value: 2, label: '周二' },
      { value: 3, label: '周三' },
      { value: 4, label: '周四' },
      { value: 5, label: '周五' },
      { value: 6, label: '周六' },
      { value: 0, label: '周日' }
    ];
    var boxes = weekdays.map(function(item) {
      return '<label class="calendar-weekend-item">'
        + '<input type="checkbox" data-work-weekend="' + item.value + '"'
        + (selected[item.value] ? ' checked' : '') + '>' + item.label + '</label>';
    }).join('');

    var textareaStyle = 'width:100%;padding:8px 12px;border:1px solid var(--color-border-strong);border-radius:8px;font-size:14px;resize:vertical;';
    var isSubscribed = calendarState ? (calendarState.subscribed !== false) : true;

    function renderStatusText(state) {
      if (!state) return '无订阅状态';
      var cachedYears = Object.keys(state.cacheByYear || {}).sort();
      var importedYears = Object.keys(state.importedByYear || {}).sort();
      var yearsText = cachedYears.length > 0 ? cachedYears.join(', ') : '暂无缓存';
      var impText = importedYears.length > 0 ? importedYears.join(', ') : '暂无导入';
      var currentYear = new Date().getFullYear();
      var attempt = state.lastAttemptByYear ? state.lastAttemptByYear[currentYear] : null;
      var updateText = '未尝试更新';
      if (attempt) {
        var timeStr = attempt.timestamp ? new Date(attempt.timestamp).toLocaleTimeString() : '';
        updateText = attempt.success ? ('更新成功 (' + timeStr + ')') : ('更新失败 (' + (attempt.error || '网络异常') + ')');
      }
      var subStatus = (state.subscribed !== false) ? '订阅正常启用' : '已暂停自动同步';
      return '订阅状态: ' + subStatus + '<br>'
        + '订阅源: ' + (state.source || '官方默认源') + '<br>'
        + '已缓存年份: ' + yearsText + '<br>'
        + '已导入年份: ' + impText + '<br>'
        + '当前年状态: ' + updateText;
    }

    this.open(
      '<div class="modal-title">工作日历与中国法定节假日</div>'
      + '<div class="calendar-section-title">中国法定节假日公开订阅</div>'
      + '<div style="margin-bottom:8px;">'
      + '<label><input type="checkbox" id="modal-calendar-subscribed"' + (isSubscribed ? ' checked' : '') + '> 启用中国法定节假日及调休订阅</label>'
      + ' <button type="button" class="btn" id="modal-calendar-refresh" style="margin-left:12px;padding:2px 8px;font-size:12px;">刷新当前年</button>'
      + '</div>'
      + '<div class="calendar-status-box" id="modal-calendar-status">' + renderStatusText(calendarState) + '</div>'

      + '<div class="calendar-section-title">导入法定节假日 (JSON)</div>'
      + '<div style="margin-bottom:6px;font-size:12px;color:var(--color-text-secondary);">'
      + '支持 year, region: "CN", dates 格式，确认后按年度替换旧导入批次。'
      + '</div>'
      + '<textarea id="modal-calendar-import-input" rows="3" style="' + textareaStyle + '" placeholder=\'{"year":2026,"region":"CN","dates":[{"date":"2026-01-01","name":"元旦","type":"public_holiday"}]}\'></textarea>'
      + '<div style="margin-top:6px;display:flex;gap:8px;align-items:center;">'
      + '<button type="button" class="btn" id="modal-calendar-import-preview-btn">校验预览</button>'
      + '<button type="button" class="btn btn-primary" id="modal-calendar-import-confirm" disabled>确认替换导入</button>'
      + '</div>'
      + '<div id="modal-calendar-import-preview" class="calendar-import-preview-box" style="display:none;"></div>'

      + '<div class="calendar-section-title">项目手工例外与普通周规则</div>'
      + '<div class="modal-field"><label>周末（勾选为非工作日）</label>'
      + '<div class="calendar-weekend-list">' + boxes + '</div></div>'
      + '<div class="modal-field"><label>项目节假日例外（每行一个 YYYY-MM-DD）</label>'
      + '<textarea id="modal-calendar-holidays" rows="3" style="' + textareaStyle + '" placeholder="2026-01-01">'
      + _escapeHtml(normalized.holidays.join('\n')) + '</textarea></div>'
      + '<div class="modal-field"><label>项目补班日例外（每行一个 YYYY-MM-DD）</label>'
      + '<textarea id="modal-calendar-workdays" rows="3" style="' + textareaStyle + '" placeholder="2026-01-04">'
      + _escapeHtml(normalized.workdays.join('\n')) + '</textarea></div>'
      + '<div class="modal-error" id="modal-calendar-error" role="alert" hidden></div>'
      + '<div class="modal-actions">'
      + '<button type="button" id="modal-calendar-cancel" onclick="ModalManager.close()">取消</button>'
      + '<button class="btn-primary" id="modal-calendar-save">保存</button>'
      + '</div>'
    );

    var self = this;
    var subCheckbox = document.getElementById('modal-calendar-subscribed');
    var statusBox = document.getElementById('modal-calendar-status');
    var refreshBtn = document.getElementById('modal-calendar-refresh');
    var importInput = document.getElementById('modal-calendar-import-input');
    var previewBtn = document.getElementById('modal-calendar-import-preview-btn');
    var previewBox = document.getElementById('modal-calendar-import-preview');
    var confirmBtn = document.getElementById('modal-calendar-import-confirm');
    var cancelBtn = document.getElementById('modal-calendar-cancel');

    var currentPreviewData = null;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        ModalManager.close();
      });
    }

    if (importInput) {
      importInput.addEventListener('input', function() {
        currentPreviewData = null;
        if (confirmBtn) confirmBtn.disabled = true;
        if (previewBox) {
          previewBox.style.display = 'none';
          previewBox.className = 'calendar-import-preview-box';
          previewBox.textContent = '';
        }
      });
    }

    if (subCheckbox) {
      if (typeof subCheckbox.checked === 'undefined') {
        Object.defineProperty(subCheckbox, 'checked', {
          get: function() { return this.hasAttribute('checked'); },
          set: function(val) {
            if (val) this.setAttribute('checked', 'checked');
            else this.removeAttribute('checked');
          },
          configurable: true
        });
      }
      subCheckbox.addEventListener('change', function() {
        if (typeof Workspace !== 'undefined' && Workspace && Workspace.data && Workspace.data.calendar) {
          if (!Workspace.isReadOnly()) {
            var nextWs = JSON.parse(JSON.stringify(Workspace.data));
            nextWs.calendar.subscribed = subCheckbox.checked;
            Workspace.commit(nextWs);
            calendarState = nextWs.calendar;
            if (statusBox) statusBox.innerHTML = renderStatusText(calendarState);
          }
        }
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() {
        if (typeof HolidaySource === 'undefined' || !HolidaySource) return;
        var yr = new Date().getFullYear();
        refreshBtn.disabled = true;
        refreshBtn.textContent = '更新中...';
        HolidaySource.refresh(yr, { force: true }).then(function(updated) {
          calendarState = updated;
          if (statusBox) statusBox.innerHTML = renderStatusText(updated);
          refreshBtn.disabled = false;
          refreshBtn.textContent = '刷新当前年';
        }).catch(function(err) {
          if (statusBox) statusBox.innerHTML = '更新失败: ' + (err && err.message ? err.message : err);
          refreshBtn.disabled = false;
          refreshBtn.textContent = '刷新当前年';
        });
      });
    }

    if (previewBtn && importInput) {
      previewBtn.addEventListener('click', function() {
        currentPreviewData = null;
        confirmBtn.disabled = true;
        if (typeof HolidaySource === 'undefined' || !HolidaySource) return;
        var text = importInput.value.trim();
        if (!text) {
          previewBox.style.display = 'block';
          previewBox.className = 'calendar-import-preview-box error';
          previewBox.textContent = '请输入导入 JSON 内容';
          return;
        }
        var res = HolidaySource.previewImport(text);
        previewBox.style.display = 'block';
        if (res.valid) {
          currentPreviewData = text;
          confirmBtn.disabled = false;
          previewBox.className = 'calendar-import-preview-box success';
          previewBox.textContent = '已识别 ' + res.year + ' 年 CN 数据，包含 ' + res.holidayCount + ' 天节假日，' + res.workdayCount + ' 天调休补班。';
        } else {
          previewBox.className = 'calendar-import-preview-box error';
          previewBox.textContent = '校验失败: ' + res.error;
        }
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', function() {
        if (!currentPreviewData || typeof HolidaySource === 'undefined' || !HolidaySource) return;
        try {
          var parsed = HolidaySource.parseAnnual(currentPreviewData);
          if (typeof Workspace !== 'undefined' && Workspace && Workspace.data) {
            if (Workspace.isReadOnly()) {
              alert('工作区处于只读状态，禁止导入日历');
              return;
            }
            var nextCalendar = HolidaySource.importAnnual(Workspace.data.calendar, parsed);
            var nextWs = JSON.parse(JSON.stringify(Workspace.data));
            nextWs.calendar = nextCalendar;
            Workspace.commit(nextWs);
            calendarState = nextCalendar;
            if (statusBox) statusBox.innerHTML = renderStatusText(calendarState);
            previewBox.className = 'calendar-import-preview-box success';
            previewBox.textContent = '成功导入 ' + parsed.year + ' 年数据，已按年度替换。';
            confirmBtn.disabled = true;
          }
        } catch (err) {
          previewBox.className = 'calendar-import-preview-box error';
          previewBox.textContent = '导入失败: ' + err.message;
        }
      });
    }

    document.getElementById('modal-calendar-save').addEventListener('click', function() {
      var weekends = [];
      document.querySelectorAll('[data-work-weekend]').forEach(function(input) {
        if (input.checked) weekends.push(Number(input.getAttribute('data-work-weekend')));
      });
      var holidays = self.parseCalendarDates(document.getElementById('modal-calendar-holidays').value);
      var workdays = self.parseCalendarDates(document.getElementById('modal-calendar-workdays').value);

      var invalid = holidays.invalid.concat(workdays.invalid);
      if (invalid.length > 0) {
        var message = '存在非法日期：' + invalid.join('、');
        var errorBox = document.getElementById('modal-calendar-error');
        if (errorBox) {
          errorBox.textContent = message;
          errorBox.hidden = false;
        } else {
          alert(message);
        }
        return;
      }

      var overridesResult = {
        weekends: weekends,
        holidays: holidays.dates,
        workdays: workdays.dates
      };

      var currentProjectId = (typeof Workspace !== 'undefined' && Workspace) ? Workspace.activeProjectId : null;
      if (targetProjectId && currentProjectId !== targetProjectId) {
        var errorBox = document.getElementById('modal-calendar-error');
        if (errorBox) {
          errorBox.textContent = '当前项目已切换，已取消保存手工例外';
          errorBox.hidden = false;
        }
        ModalManager.close();
        if (typeof onSave === 'function') {
          onSave(null);
        }
        return;
      }

      if (targetProjectId && typeof HolidaySource !== 'undefined' && HolidaySource && typeof HolidaySource.saveProjectCalendarOverrides === 'function') {
        try {
          HolidaySource.saveProjectCalendarOverrides(targetProjectId, overridesResult);
        } catch (ignoreErr) {
          // 只读模式或无权修改时由工作区防护
        }
      }

      ModalManager.close();
      onSave(overridesResult);
    });
  },

  showTaskForm: function(task, parentId, onSave) {
    var isEdit = !!task;
    var title = isEdit ? '编辑任务' : '新建任务';
    var name = isEdit ? task.name : '';
    var description = isEdit ? (task.description || '') : '';
    var assignee = isEdit ? (task.assignee || '') : '';
    var startDate = isEdit ? task.startDate : DateUtil.format(new Date());
    var endDate = isEdit ? task.endDate : (typeof DateUtil !== 'undefined' && typeof DateUtil.addDays === 'function' ? DateUtil.addDays(startDate, 7) : DateUtil.format(new Date(Date.now() + 7 * 86400000)));
    var status = isEdit ? task.status : 'todo';

    var rawCols = (typeof TaskManager !== 'undefined' && TaskManager && TaskManager.data && TaskManager.data.settings && TaskManager.data.settings.columns) || [];
    var allCols = (typeof ColumnConfig !== 'undefined' && ColumnConfig && typeof ColumnConfig.normalize === 'function')
      ? ColumnConfig.normalize(rawCols)
      : rawCols;
    var customCols = allCols.filter(function(col) { return col && col.builtin === false; });
    var taskCustom = (task && task.customFields) || {};

    var customFieldsHtml = '';
    customCols.forEach(function(col) {
      var val = taskCustom[col.key];
      customFieldsHtml += '<div class="modal-field"><label>' + _escapeHtml(col.label) + '</label>';
      if (col.type === 'select') {
        customFieldsHtml += '<select data-custom-field="' + _escapeHtml(col.key) + '">';
        customFieldsHtml += '<option value="">请选择</option>';
        (col.options || []).forEach(function(opt) {
          var sel = (val !== null && val !== undefined && String(opt.id) === String(val)) ? ' selected' : '';
          customFieldsHtml += '<option value="' + _escapeHtml(opt.id) + '"' + sel + '>' + _escapeHtml(opt.label) + '</option>';
        });
        customFieldsHtml += '</select>';
      } else if (col.type === 'date') {
        customFieldsHtml += '<input type="date" data-custom-field="' + _escapeHtml(col.key) + '" value="' + _escapeHtml(val || '') + '">';
      } else if (col.type === 'number') {
        customFieldsHtml += '<input type="number" step="any" data-custom-field="' + _escapeHtml(col.key) + '" value="' + _escapeHtml(val !== null && val !== undefined ? String(val) : '') + '" placeholder="请输入' + _escapeHtml(col.label) + '">';
      } else {
        customFieldsHtml += '<input type="text" data-custom-field="' + _escapeHtml(col.key) + '" value="' + _escapeHtml(val !== null && val !== undefined ? String(val) : '') + '" placeholder="请输入' + _escapeHtml(col.label) + '">';
      }
      customFieldsHtml += '</div>';
    });

    this.open(
      '<div class="modal-title">' + title + '</div>'
      + '<div class="modal-field"><label>任务名称</label>'
      + '<input type="text" id="modal-task-name" value="' + _escapeHtml(name) + '" placeholder="请输入任务名称"></div>'
      + '<div class="modal-field"><label>负责人</label>'
      + '<input type="text" id="modal-task-assignee" value="' + _escapeHtml(assignee) + '" placeholder="请输入负责人（可选）"></div>'
      + '<div class="modal-field"><label>描述/备注</label>'
      + '<textarea id="modal-task-desc" rows="3" style="width:100%;padding:8px 12px;border:1px solid var(--color-border-strong);border-radius:8px;font-size:16px;resize:vertical;" placeholder="请输入描述（可选）">' + _escapeHtml(description) + '</textarea></div>'
      + '<div class="modal-field"><label>开始日期</label>'
      + '<input type="date" id="modal-task-start" value="' + _escapeHtml(startDate || '') + '"></div>'
      + '<div class="modal-field"><label>结束日期</label>'
      + '<input type="date" id="modal-task-end" value="' + _escapeHtml(endDate || '') + '"></div>'
      + '<div class="modal-field"><label>状态</label>'
      + '<select id="modal-task-status">'
      + '<option value="todo"' + (status === 'todo' ? ' selected' : '') + '>未开始</option>'
      + '<option value="inProgress"' + (status === 'inProgress' ? ' selected' : '') + '>进行中</option>'
      + '<option value="thirdParty"' + (status === 'thirdParty' ? ' selected' : '') + '>第三方跟进</option>'
      + '<option value="done"' + (status === 'done' ? ' selected' : '') + '>已完成</option>'
      + '</select></div>'
      + customFieldsHtml
      + '<div class="modal-actions">'
      + '<button onclick="ModalManager.close()">取消</button>'
      + '<button class="btn-primary" id="modal-save-btn">保存</button>'
      + '</div>'
    );

    document.getElementById('modal-save-btn').addEventListener('click', function() {
      var nameVal = document.getElementById('modal-task-name').value.trim();
      var descVal = document.getElementById('modal-task-desc').value;
      var assigneeVal = document.getElementById('modal-task-assignee').value.trim();
      var startVal = document.getElementById('modal-task-start').value;
      var endVal = document.getElementById('modal-task-end').value;
      var statusVal = document.getElementById('modal-task-status').value;
      if (!nameVal) { alert('请输入任务名称'); return; }
      if (!startVal || !endVal) { alert('请选择日期'); return; }

      var customFields = Object.assign({}, task && task.customFields);
      var customInputs = document.querySelectorAll('[data-custom-field]');
      var customErrors = [];
      for (var i = 0; i < customInputs.length; i++) {
        var input = customInputs[i];
        var cKey = input.getAttribute('data-custom-field');
        var cDef = null;
        for (var c = 0; c < customCols.length; c++) {
          if (customCols[c].key === cKey) { cDef = customCols[c]; break; }
        }
        var rawV = input.value;
        if (cDef && typeof ColumnConfig !== 'undefined' && ColumnConfig && typeof ColumnConfig.validateValue === 'function') {
          var check = ColumnConfig.validateValue(cDef, rawV);
          if (!check.valid) {
            customErrors.push(cDef.label + '：' + (check.error || '格式错误'));
            continue;
          }
          if (check.value === null || check.value === undefined) {
            delete customFields[cKey];
          } else {
            customFields[cKey] = check.value;
          }
        } else {
          if (rawV === '') {
            delete customFields[cKey];
          } else {
            customFields[cKey] = rawV;
          }
        }
      }
      if (customErrors.length > 0) {
        alert(customErrors.join('\n'));
        return;
      }

      ModalManager.close();
      onSave({
        name: nameVal,
        description: descVal,
        assignee: assigneeVal,
        startDate: startVal,
        endDate: endVal,
        status: statusVal,
        parentId: parentId,
        customFields: customFields
      });
    });

    document.getElementById('modal-task-name').focus();
  },

  showMilestoneForm: function(milestone, parentInfo, onSave) {
    var isEdit = !!milestone;
    var title = isEdit ? '编辑里程碑' : '新建里程碑';
    var name = isEdit ? milestone.name : '';
    var date = isEdit ? milestone.date : DateUtil.format(new Date());
    var status = isEdit ? (milestone.status || 'pending') : 'pending';

    this.open(
      '<div class="modal-title">' + title + '</div>'
      + '<div class="modal-field"><label>里程碑名称</label>'
      + '<textarea id="modal-ms-name" rows="3" placeholder="请输入名称">' + _escapeHtml(name) + '</textarea></div>'
      + '<div class="modal-field"><label>日期</label>'
      + '<input type="date" id="modal-ms-date" value="' + _escapeHtml(date || '') + '"></div>'
      + '<div class="modal-field"><label>状态</label>'
      + '<select id="modal-ms-status">'
      + '<option value="pending"' + (status === 'pending' ? ' selected' : '') + '>□ 待办</option>'
      + '<option value="done"' + (status === 'done' ? ' selected' : '') + '>○ 已完成</option>'
      + '</select></div>'
      + '<div class="modal-actions">'
      + '<button onclick="ModalManager.close()">取消</button>'
      + '<button class="btn-primary" id="modal-save-btn">保存</button>'
      + '</div>'
    );

    document.getElementById('modal-save-btn').addEventListener('click', function() {
      var nameVal = document.getElementById('modal-ms-name').value.trim();
      var dateVal = document.getElementById('modal-ms-date').value;
      var statusVal = document.getElementById('modal-ms-status').value;
      if (!nameVal) { alert('请输入名称'); return; }
      if (!dateVal) { alert('请选择日期'); return; }
      ModalManager.close();
      onSave({ name: nameVal, date: dateVal, status: statusVal, taskId: parentInfo.taskId });
    });

    document.getElementById('modal-ms-name').focus();
  }
};

function _isCalendarDate(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return false;
  var year = parseInt(match[1], 10);
  var month = parseInt(match[2], 10);
  var day = parseInt(match[3], 10);
  var date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function _escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
