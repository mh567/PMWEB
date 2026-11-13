// ============================================================
// == ProjectUI: 项目选择、管理与启动偏好界面组件
// ============================================================
(function(root) {
  'use strict';

  function _escapeHtml(val) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(val === null || val === undefined ? '' : val)
      .replace(/[&<>"']/g, function(ch) { return map[ch]; });
  }

  var ProjectUI = {
    onSelect: null,
    _showArchived: false,
    _searchQuery: '',
    _creating: false,
    _editingProjectId: null,
    _notice: '',

    init: function(options) {
      options = options || {};
      this.onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
      this._showArchived = false;
      this._searchQuery = '';
      this._creating = false;
      this._editingProjectId = null;
      this._notice = '';
    },

    open: function() {
      if (typeof ModalManager === 'undefined' || !ModalManager) {
        throw new Error('ProjectUI.open: ModalManager 未定义');
      }
      this._rerender();
    },

    close: function() {
      if (typeof ModalManager !== 'undefined' && ModalManager) {
        ModalManager.close();
      }
    },

    _rerender: function() {
      if (typeof ModalManager === 'undefined' || !ModalManager) return;
      var html = this._buildHtml();
      ModalManager.open(html);
      this._bindEvents();
    },

    _buildHtml: function() {
      var ws = typeof Workspace !== 'undefined' ? Workspace : null;
      var projects = (ws && ws.data && Array.isArray(ws.data.projects)) ? ws.data.projects : [];
      var activeId = ws ? ws.activeProjectId : null;
      var isReadOnly = ws && ws.isReadOnly && ws.isReadOnly();

      var settings = (ws && ws.data && ws.data.settings) ? ws.data.settings : {};
      var startupMode = settings.startupMode || 'choose';
      var defaultProjId = settings.defaultProjectId || '';

      var query = (this._searchQuery || '').toLowerCase().trim();
      var showArchived = Boolean(this._showArchived);

      var noticeHtml = '';
      if (this._notice) {
        noticeHtml = '<div class="project-notice-banner" id="project-action-notice" role="alert" style="padding:8px 12px;margin-bottom:12px;background:#fef3c7;color:#92400e;border-radius:6px;font-size:14px;">'
          + _escapeHtml(this._notice) + '</div>';
      }

      var readOnlyBanner = '';
      if (isReadOnly) {
        readOnlyBanner = '<div class="project-readonly-banner" style="padding:8px 12px;margin-bottom:12px;background:#fee2e2;color:#991b1b;border-radius:6px;font-size:14px;">'
          + '当前工作区处于只读状态（可能由于数据损坏或版本过高），禁止新建或修改项目。'
          + '</div>';
      }

      var headerHtml = '<div class="modal-title" style="display:flex;justify-content:space-between;align-items:center;">'
        + '<span>项目管理</span>'
        + '<button type="button" class="btn btn-sm" id="btn-close-project-modal" style="font-size:13px;">关闭</button>'
        + '</div>';

      var controlsHtml = '<div class="project-controls-bar" style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">'
        + '<input type="text" id="project-search-input" placeholder="搜索项目..." value="' + _escapeHtml(this._searchQuery || '') + '" style="padding:6px 10px;border:1px solid var(--color-border-strong, #ccc);border-radius:6px;font-size:14px;flex:1;min-width:140px;">'
        + '<label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;white-space:nowrap;">'
        + '<input type="checkbox" id="toggle-show-archived"' + (showArchived ? ' checked' : '') + '> 显示已归档'
        + '</label>'
        + '<button type="button" class="btn btn-primary" id="btn-new-project"' + (isReadOnly ? ' disabled' : '') + '>+ 新建项目</button>'
        + '</div>';

      var newFormHtml = '';
      if (this._creating) {
        newFormHtml = '<div class="project-new-panel" style="padding:14px;border:1px solid var(--color-primary, #2563eb);border-radius:8px;background:var(--color-bg-subtle, #f8fafc);margin-bottom:16px;">'
          + '<h4 style="margin:0 0 10px 0;font-size:15px;">新建项目</h4>'
          + '<div class="modal-field" style="margin-bottom:10px;">'
          + '<label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">项目名称（必填）</label>'
          + '<input type="text" id="new-project-name" placeholder="请输入项目名称" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;">'
          + '</div>'
          + '<div class="modal-field" style="margin-bottom:10px;">'
          + '<label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">项目描述（可选）</label>'
          + '<textarea id="new-project-desc" rows="2" placeholder="请输入项目描述" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;resize:vertical;"></textarea>'
          + '</div>'
          + '<div class="modal-error" id="project-form-error" role="alert" style="color:#dc2626;font-size:13px;margin-bottom:8px;" hidden></div>'
          + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
          + '<button type="button" class="btn" id="btn-cancel-new-project">取消</button>'
          + '<button type="button" class="btn btn-primary" id="btn-save-new-project">创建并进入</button>'
          + '</div>'
          + '</div>';
      }

      var listHtml = '<div class="project-list" id="project-list" style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">'
        + this._renderListInnerHtml()
        + '</div>';

      var nonArchived = projects.filter(function(p) { return !p.archived; });
      var defaultOptions = '<option value="">-- 请选择默认项目 --</option>';
      for (var j = 0; j < nonArchived.length; j++) {
        var opt = nonArchived[j];
        var isSelected = opt.id === defaultProjId ? ' selected' : '';
        defaultOptions += '<option value="' + _escapeHtml(opt.id) + '"' + isSelected + '>' + _escapeHtml(opt.name) + '</option>';
      }

      var startupHtml = '<div class="project-startup-settings" style="padding-top:12px;border-top:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'
        + '<label style="font-size:13px;color:#475569;font-weight:600;">启动偏好：</label>'
        + '<select id="project-startup-mode" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">'
        + '<option value="choose"' + (startupMode === 'choose' ? ' selected' : '') + '>每次启动时选择项目</option>'
        + '<option value="last"' + (startupMode === 'last' ? ' selected' : '') + '>自动进入上次打开的项目</option>'
        + '<option value="fixed"' + (startupMode === 'fixed' ? ' selected' : '') + '>固定进入默认项目</option>'
        + '</select>'
        + '<select id="project-default-select" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;' + (startupMode === 'fixed' ? '' : 'display:none;') + '">'
        + defaultOptions
        + '</select>'
        + '</div>';

      return '<div class="project-ui-container" style="min-width:320px;max-width:680px;width:100%;box-sizing:border-box;">'
        + headerHtml
        + readOnlyBanner
        + noticeHtml
        + controlsHtml
        + newFormHtml
        + listHtml
        + startupHtml
        + '</div>';
    },

    _renderListInnerHtml: function() {
      var ws = typeof Workspace !== 'undefined' ? Workspace : null;
      var data = ws && ws.data ? ws.data : { projects: [] };
      var projects = Array.isArray(data.projects) ? data.projects : [];
      var activeId = ws ? ws.activeProjectId : null;
      var isReadOnly = ws && ws.isReadOnly && ws.isReadOnly();

      var query = (this._searchQuery || '').toLowerCase().trim();
      var showArchived = Boolean(this._showArchived);

      var filtered = projects.filter(function(p) {
        if (!showArchived && p.archived) return false;
        if (query) {
          var nameMatch = p.name && p.name.toLowerCase().indexOf(query) !== -1;
          var descMatch = p.description && p.description.toLowerCase().indexOf(query) !== -1;
          if (!nameMatch && !descMatch) return false;
        }
        return true;
      });

      var listHtml = '';
      if (filtered.length === 0) {
        listHtml += '<div class="project-empty-state" style="padding:24px;text-align:center;color:#64748b;font-size:14px;background:#f8fafc;border-radius:8px;">'
          + (projects.length === 0 ? '暂无项目，请新建项目或导入备份' : '未找到匹配的项目')
          + (projects.length === 0 ? '<div style="margin-top:12px;display:flex;gap:10px;justify-content:center;">'
            + '<button type="button" class="btn btn-primary" id="btn-new-project-empty">+ 新建项目</button>'
            + '<button type="button" class="btn" id="btn-import-backup-empty">导入备份</button>'
            + '</div>' : '')
          + '</div>';
      } else {
        for (var i = 0; i < filtered.length; i++) {
          var p = filtered[i];
          var isEditing = this._editingProjectId === p.id;

          if (isEditing) {
            listHtml += '<div class="project-item project-item-editing" style="padding:12px;border:1px solid #3b82f6;border-radius:8px;background:#f8fafc;" data-project-id="' + _escapeHtml(p.id) + '">'
              + '<div style="margin-bottom:8px;">'
              + '<label style="font-size:12px;color:#475569;">项目名称</label>'
              + '<input type="text" id="edit-project-name-' + _escapeHtml(p.id) + '" value="' + _escapeHtml(p.name) + '" style="width:100%;box-sizing:border-box;padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:14px;">'
              + '</div>'
              + '<div style="margin-bottom:8px;">'
              + '<label style="font-size:12px;color:#475569;">说明描述</label>'
              + '<textarea id="edit-project-desc-' + _escapeHtml(p.id) + '" rows="2" style="width:100%;box-sizing:border-box;padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:14px;resize:vertical;">' + _escapeHtml(p.description || '') + '</textarea>'
              + '</div>'
              + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
              + '<button type="button" class="btn btn-sm" data-action="cancel-edit-project" data-project-id="' + _escapeHtml(p.id) + '">取消</button>'
              + '<button type="button" class="btn btn-sm btn-primary" data-action="save-edit-project" data-project-id="' + _escapeHtml(p.id) + '">保存修改</button>'
              + '</div>'
              + '</div>';
          } else {
            var badges = '';
            if (p.id === activeId) {
              badges += '<span class="project-badge badge-active" style="display:inline-block;padding:2px 6px;border-radius:4px;background:#dbeafe;color:#1e40af;font-size:12px;margin-left:6px;">当前项目</span>';
            }
            if (p.status === 'completed') {
              badges += '<span class="project-badge badge-completed" style="display:inline-block;padding:2px 6px;border-radius:4px;background:#dcfce7;color:#166534;font-size:12px;margin-left:6px;">已完成</span>';
            }
            if (p.archived) {
              badges += '<span class="project-badge badge-archived" style="display:inline-block;padding:2px 6px;border-radius:4px;background:#f1f5f9;color:#475569;font-size:12px;margin-left:6px;">[已归档]</span>';
            }

            var statusBtnText = p.status === 'completed' ? '恢复进行中' : '标记完成';
            var archiveBtnText = p.archived ? '恢复归档' : '归档';
            var selectBtnText = p.archived ? '查看(只读)' : '进入项目';

            listHtml += '<div class="project-item" style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;" data-project-id="' + _escapeHtml(p.id) + '">'
              + '<div style="flex:1;min-width:0;margin-right:12px;">'
              + '<div style="display:flex;align-items:center;font-weight:600;font-size:15px;color:#1e293b;word-break:break-all;">'
              + '<span class="project-title">' + _escapeHtml(p.name) + '</span>'
              + badges
              + '</div>'
              + (p.description ? '<div style="font-size:13px;color:#64748b;margin-top:4px;word-break:break-all;">' + _escapeHtml(p.description) + '</div>' : '')
              + '</div>'
              + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
              + '<button type="button" class="btn btn-sm btn-primary" data-action="select-project" data-project-id="' + _escapeHtml(p.id) + '">' + selectBtnText + '</button>'
              + (!p.archived ? '<button type="button" class="btn btn-sm" data-action="edit-project" data-project-id="' + _escapeHtml(p.id) + '"' + (isReadOnly ? ' disabled' : '') + '>编辑</button>' : '')
              + (!p.archived ? '<button type="button" class="btn btn-sm" data-action="toggle-status" data-project-id="' + _escapeHtml(p.id) + '"' + (isReadOnly ? ' disabled' : '') + '>' + statusBtnText + '</button>' : '')
              + '<button type="button" class="btn btn-sm" data-action="toggle-archive" data-project-id="' + _escapeHtml(p.id) + '"' + (isReadOnly ? ' disabled' : '') + '>' + archiveBtnText + '</button>'
              + '<button type="button" class="btn btn-sm btn-danger" data-action="delete-project" data-project-id="' + _escapeHtml(p.id) + '">删除</button>'
              + '</div>'
              + '</div>';
          }
        }
      }
      return listHtml;
    },

    _updateList: function() {
      var doc = (typeof document !== 'undefined') ? document : null;
      if (!doc) return;
      var listEl = doc.getElementById('project-list') || doc.querySelector('.project-list');
      if (!listEl) {
        this._rerender();
        return;
      }
      listEl.innerHTML = this._renderListInnerHtml();
      this._bindListEvents(listEl);
    },

    _bindListEvents: function(container) {
      var self = this;
      var doc = (typeof document !== 'undefined') ? document : null;
      var rootEl = container || doc;
      if (!rootEl) return;
      var ws = typeof Workspace !== 'undefined' ? Workspace : null;

      var selectBtns = rootEl.querySelectorAll('[data-action="select-project"]');
      for (var s = 0; s < selectBtns.length; s++) {
        selectBtns[s].addEventListener('click', function(e) {
          var targetEl = e.target.closest ? e.target.closest('[data-project-id]') : e.target;
          var pId = targetEl.getAttribute('data-project-id') || (targetEl.dataset && targetEl.dataset.projectId);
          if (pId) {
            if (ws && typeof ws.activate === 'function') {
              ws.activate(pId);
            }
            self.close();
            if (self.onSelect) {
              self.onSelect(pId);
            }
          }
        });
      }

      var editBtns = rootEl.querySelectorAll('[data-action="edit-project"]');
      for (var ed = 0; ed < editBtns.length; ed++) {
        editBtns[ed].addEventListener('click', function(e) {
          if (ws && ws.isReadOnly && ws.isReadOnly()) {
            self._notice = '工作区处于只读状态，无法修改项目';
            self._rerender();
            return;
          }
          var targetEl = e.target.closest ? e.target.closest('[data-project-id]') : e.target;
          var pId = targetEl.getAttribute('data-project-id') || (targetEl.dataset && targetEl.dataset.projectId);
          var proj = (ws && ws.data && ws.data.projects) ? ws.data.projects.find(function(p) { return p.id === pId; }) : null;
          if (proj && proj.archived) {
            self._notice = '已归档项目处于只读状态，需修改请先恢复归档';
            self._updateList();
            return;
          }
          self._editingProjectId = pId;
          self._updateList();
        });
      }

      var cancelEditBtns = rootEl.querySelectorAll('[data-action="cancel-edit-project"]');
      for (var ce = 0; ce < cancelEditBtns.length; ce++) {
        cancelEditBtns[ce].addEventListener('click', function() {
          self._editingProjectId = null;
          self._updateList();
        });
      }

      var saveEditBtns = rootEl.querySelectorAll('[data-action="save-edit-project"]');
      for (var se = 0; se < saveEditBtns.length; se++) {
        saveEditBtns[se].addEventListener('click', function(e) {
          var targetEl = e.target.closest ? e.target.closest('[data-project-id]') : e.target;
          var pId = targetEl.getAttribute('data-project-id') || (targetEl.dataset && targetEl.dataset.projectId);
          if (!pId) return;

          var nameIn = doc.getElementById('edit-project-name-' + pId);
          var descIn = doc.getElementById('edit-project-desc-' + pId);
          var nameVal = nameIn ? nameIn.value.trim() : '';
          var descVal = descIn ? descIn.value : '';

          if (!nameVal) {
            self._notice = '项目名称不能为空';
            self._rerender();
            return;
          }

          try {
            ws.updateProject(pId, { name: nameVal, description: descVal });
            self._editingProjectId = null;
            self._notice = '';
            self._rerender();
          } catch (err) {
            self._notice = err.message || '更新项目失败';
            self._rerender();
          }
        });
      }

      var statusBtns = rootEl.querySelectorAll('[data-action="toggle-status"]');
      for (var st = 0; st < statusBtns.length; st++) {
        statusBtns[st].addEventListener('click', function(e) {
          if (ws && ws.isReadOnly && ws.isReadOnly()) {
            self._notice = '工作区处于只读状态，无法修改项目';
            self._rerender();
            return;
          }
          var targetEl = e.target.closest ? e.target.closest('[data-project-id]') : e.target;
          var pId = targetEl.getAttribute('data-project-id') || (targetEl.dataset && targetEl.dataset.projectId);
          if (!pId) return;

          var proj = (ws && ws.data && ws.data.projects) ? ws.data.projects.find(function(p) { return p.id === pId; }) : null;
          if (!proj) return;
          if (proj.archived) {
            self._notice = '已归档项目处于只读状态，无法修改状态';
            self._updateList();
            return;
          }

          var nextStatus = proj.status === 'completed' ? 'active' : 'completed';
          try {
            ws.updateProject(pId, { status: nextStatus });
            self._notice = '';
            self._updateList();
          } catch (err) {
            self._notice = err.message || '操作失败';
            self._rerender();
          }
        });
      }

      var archiveBtns = rootEl.querySelectorAll('[data-action="toggle-archive"]');
      for (var ar = 0; ar < archiveBtns.length; ar++) {
        archiveBtns[ar].addEventListener('click', function(e) {
          if (ws && ws.isReadOnly && ws.isReadOnly()) {
            self._notice = '工作区处于只读状态，无法修改项目';
            self._rerender();
            return;
          }
          var targetEl = e.target.closest ? e.target.closest('[data-project-id]') : e.target;
          var pId = targetEl.getAttribute('data-project-id') || (targetEl.dataset && targetEl.dataset.projectId);
          if (!pId) return;

          var proj = (ws && ws.data && ws.data.projects) ? ws.data.projects.find(function(p) { return p.id === pId; }) : null;
          if (!proj) return;

          var nextArchived = !proj.archived;
          try {
            ws.updateProject(pId, { archived: nextArchived });
            self._notice = '';
            self._rerender();
          } catch (err) {
            self._notice = err.message || '操作失败';
            self._rerender();
          }
        });
      }

      var deleteBtns = rootEl.querySelectorAll('[data-action="delete-project"]');
      for (var d = 0; d < deleteBtns.length; d++) {
        deleteBtns[d].addEventListener('click', function() {
          var pId = this.getAttribute('data-project-id');
          if (!pId || !ws) return;
          if (ws.isReadOnly && ws.isReadOnly()) {
            self._notice = '工作区处于只读状态，无法删除项目';
            self._rerender();
            return;
          }
          var targetProj = null;
          var projs = (ws.data && Array.isArray(ws.data.projects)) ? ws.data.projects : [];
          for (var pi = 0; pi < projs.length; pi++) {
            if (projs[pi].id === pId) {
              targetProj = projs[pi];
              break;
            }
          }
          var projName = targetProj ? targetProj.name : pId;
          var ok = (typeof confirm === 'function') ? confirm('确定将项目「' + projName + '」移入回收站吗？可在回收站中恢复。') : true;
          if (!ok) return;

          try {
            var wasActive = ws.activeProjectId === pId;
            ws.deleteProject(pId);
            self._notice = '项目已移入回收站，可在回收站中随时恢复';
            if (wasActive && typeof self.onSelect === 'function') {
              self.onSelect(null);
            }
            self._rerender();
          } catch (err) {
            self._notice = '删除失败: ' + (err.message || String(err));
            self._rerender();
          }
        });
      }

      var btnNewEmpty = rootEl.querySelector('#btn-new-project-empty') || doc.getElementById('btn-new-project-empty');
      if (btnNewEmpty) {
        btnNewEmpty.addEventListener('click', function() {
          if (ws && ws.isReadOnly && ws.isReadOnly()) {
            self._notice = '工作区处于只读状态，无法新建项目';
            self._rerender();
            return;
          }
          self._creating = true;
          self._notice = '';
          self._rerender();
        });
      }

      var btnImportEmpty = rootEl.querySelector('#btn-import-backup-empty') || doc.getElementById('btn-import-backup-empty');
      if (btnImportEmpty) {
        btnImportEmpty.addEventListener('click', function() {
          self._notice = '完整备份导入功能将在后续服务（Task 8/9）接入';
          self._rerender();
        });
      }
    },

    _bindEvents: function() {
      var self = this;
      var doc = (typeof document !== 'undefined') ? document : null;
      if (!doc) return;

      var ws = typeof Workspace !== 'undefined' ? Workspace : null;

      var btnClose = doc.getElementById('btn-close-project-modal');
      if (btnClose) {
        btnClose.addEventListener('click', function() {
          self.close();
        });
      }

      var searchInput = doc.getElementById('project-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', function(e) {
          self._searchQuery = e.target.value || '';
          self._updateList();
        });
      }

      var toggleArchived = doc.getElementById('toggle-show-archived');
      if (toggleArchived) {
        toggleArchived.addEventListener('change', function(e) {
          self._showArchived = Boolean(e.target.checked);
          self._updateList();
        });
      }

      var btnNew = doc.getElementById('btn-new-project');
      if (btnNew) {
        btnNew.addEventListener('click', function() {
          if (ws && ws.isReadOnly && ws.isReadOnly()) {
            self._notice = '工作区处于只读状态，无法新建项目';
            self._rerender();
            return;
          }
          self._creating = true;
          self._notice = '';
          self._rerender();
          var input = doc.getElementById('new-project-name');
          if (input && input.focus) input.focus();
        });
      }

      var btnCancelNew = doc.getElementById('btn-cancel-new-project');
      if (btnCancelNew) {
        btnCancelNew.addEventListener('click', function() {
          self._creating = false;
          self._rerender();
        });
      }

      var btnSaveNew = doc.getElementById('btn-save-new-project');
      if (btnSaveNew) {
        btnSaveNew.addEventListener('click', function() {
          if (ws && ws.isReadOnly && ws.isReadOnly()) {
            var errEl = doc.getElementById('project-form-error');
            if (errEl) {
              errEl.textContent = '工作区处于只读状态，无法新建项目';
              errEl.hidden = false;
            }
            return;
          }
          var nameInput = doc.getElementById('new-project-name');
          var descInput = doc.getElementById('new-project-desc');
          var errBox = doc.getElementById('project-form-error');

          var nameVal = nameInput ? nameInput.value.trim() : '';
          var descVal = descInput ? descInput.value : '';

          if (!nameVal) {
            if (errBox) {
              errBox.textContent = '项目名称不能为空';
              errBox.hidden = false;
            }
            if (nameInput && nameInput.focus) nameInput.focus();
            return;
          }

          try {
            var newProj = ws.createProject({ name: nameVal, description: descVal });
            self._creating = false;
            if (ws && typeof ws.activate === 'function') {
              ws.activate(newProj.id);
            }
            self.close();
            if (self.onSelect) {
              self.onSelect(newProj.id);
            }
          } catch (err) {
            if (errBox) {
              errBox.textContent = err.message || '创建项目失败';
              errBox.hidden = false;
            }
          }
        });
      }

      var listEl = doc.getElementById('project-list') || doc.querySelector('.project-list');
      if (listEl) {
        this._bindListEvents(listEl);
      }

      var startupSelect = doc.getElementById('project-startup-mode');
      var defaultSelect = doc.getElementById('project-default-select');
      if (startupSelect) {
        startupSelect.addEventListener('change', function(e) {
          if (ws && ws.isReadOnly && ws.isReadOnly()) {
            self._notice = '工作区处于只读状态，无法修改启动偏好';
            self._rerender();
            return;
          }
          var modeVal = e.target.value;
          if (defaultSelect) {
            defaultSelect.style.display = (modeVal === 'fixed') ? '' : 'none';
          }
          var projId = defaultSelect ? defaultSelect.value : null;
          try {
            ws.setStartup({ mode: modeVal, projectId: projId });
          } catch (err) {
            self._notice = err.message || '设置启动偏好失败';
            self._rerender();
          }
        });
      }

      if (defaultSelect) {
        defaultSelect.addEventListener('change', function(e) {
          if (ws && ws.isReadOnly && ws.isReadOnly()) return;
          var modeVal = startupSelect ? startupSelect.value : 'fixed';
          var projId = e.target.value;
          try {
            ws.setStartup({ mode: modeVal, projectId: projId });
          } catch (err) {}
        });
      }
    }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = ProjectUI;
  }
  if (root) {
    root.ProjectUI = ProjectUI;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
