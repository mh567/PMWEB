// ============================================================
// == RecycleBinUI: 回收站界面组件
// ============================================================
(function(root) {
  'use strict';

  function _escapeHtml(val) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(val === null || val === undefined ? '' : val)
      .replace(/[&<>"']/g, function(ch) { return map[ch]; });
  }

  function formatBytes(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  var RecycleBinUI = {
    _filterProjectId: '',
    _notice: '',
    _confirmingPurgeBatchId: null,
    _previewBatchId: null,
    _currentPreview: null,

    init: function() {
      this._filterProjectId = '';
      this._notice = '';
      this._confirmingPurgeBatchId = null;
      this._previewBatchId = null;
      this._currentPreview = null;
    },

    open: function() {
      if (typeof ModalManager === 'undefined' || !ModalManager) {
        throw new Error('RecycleBinUI.open: ModalManager 未定义');
      }
      this._rerender();
    },

    close: function() {
      this._confirmingPurgeBatchId = null;
      this._previewBatchId = null;
      this._currentPreview = null;
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
      var recycleBin = (ws && ws.data && Array.isArray(ws.data.recycleBin)) ? ws.data.recycleBin : [];
      var projects = (ws && ws.data && Array.isArray(ws.data.projects)) ? ws.data.projects : [];

      var projectMap = {};
      projects.forEach(function(p) { projectMap[p.id] = p.name; });

      var self = this;
      var filterId = this._filterProjectId;
      var visibleBatches = recycleBin.filter(function(batch) {
        if (!filterId) return true;
        return batch.projectId === filterId;
      });

      // 计算统计
      var totalBatches = visibleBatches.length;
      var totalTasks = 0;
      var totalAttachmentBytes = 0;

      visibleBatches.forEach(function(batch) {
        if (batch.kind === 'task' && batch.snapshot) {
          totalTasks += (batch.snapshot.tasks || []).length;
          (batch.snapshot.attachments || []).forEach(function(a) {
            if (a && typeof a.size === 'number') totalAttachmentBytes += a.size;
          });
        } else if (batch.kind === 'project' && batch.snapshot && batch.snapshot.data) {
          totalTasks += (batch.snapshot.data.tasks || []).length;
          (batch.snapshot.data.attachments || []).forEach(function(a) {
            if (a && typeof a.size === 'number') totalAttachmentBytes += a.size;
          });
        }
      });

      var headerHtml = '<div class="modal-title" style="display:flex;justify-content:space-between;align-items:center;">'
        + '<span>回收站</span>'
        + '<button type="button" class="btn btn-sm" id="btn-close-recycle-bin-modal">关闭</button>'
        + '</div>';

      var noticeHtml = '';
      if (this._notice) {
        noticeHtml = '<div class="recycle-bin-notice-banner" id="recycle-bin-notice" role="alert" style="padding:8px 12px;margin-bottom:12px;background:#fef3c7;color:#92400e;border-radius:6px;font-size:14px;">'
          + _escapeHtml(this._notice) + '</div>';
      }

      // 项目选项
      var projectOptions = '<option value="">全部项目</option>';
      projects.forEach(function(p) {
        var selected = p.id === filterId ? ' selected' : '';
        projectOptions += '<option value="' + _escapeHtml(p.id) + '"' + selected + '>' + _escapeHtml(p.name) + '</option>';
      });

      var statsText = '共 ' + totalBatches + ' 个批次，包含 ' + totalTasks + ' 个任务，附件占用预估 ' + formatBytes(totalAttachmentBytes);

      var controlsHtml = '<div class="recycle-bin-controls" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">'
        + '<div style="display:flex;align-items:center;gap:8px;">'
        + '<label style="font-size:13px;font-weight:600;color:var(--color-text-secondary, #475569);">筛选项目：</label>'
        + '<select id="recycle-bin-project-filter" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">'
        + projectOptions
        + '</select>'
        + '</div>'
        + '<div id="recycle-bin-summary" style="font-size:13px;color:var(--color-text-secondary, #64748b);">'
        + _escapeHtml(statsText)
        + '</div>'
        + '</div>';

      var autoExpireHint = '<div style="font-size:12px;color:var(--color-text-tertiary, #94a3b8);margin-bottom:12px;">'
        + '提示：回收站内容不自动过期清理，支持按需恢复或永久释放空间。'
        + '</div>';

      // 弹层状态面板（恢复预览或永久删除确认）
      var subPanelHtml = '';
      if (this._previewBatchId && this._currentPreview) {
        var prev = this._currentPreview;
        var warnItems = '';
        if (prev.warnings.length > 0) {
          warnItems = '<div style="margin:8px 0;padding:10px;background:#fef2f2;border:1px solid #f87171;border-radius:6px;color:#991b1b;font-size:13px;">'
            + '<div style="font-weight:600;margin-bottom:4px;">恢复前警告提示：</div>'
            + '<ul style="margin:0;padding-left:18px;">';
          prev.warnings.forEach(function(w) {
            warnItems += '<li>' + _escapeHtml(w) + '</li>';
          });
          warnItems += '</ul></div>';
        }

        subPanelHtml = '<div class="recycle-bin-preview-card" style="padding:14px;border:1px solid #3b82f6;border-radius:8px;background:#eff6ff;margin-bottom:16px;">'
          + '<h4 style="margin:0 0 8px 0;font-size:15px;color:#1e40af;">恢复确认：' + _escapeHtml(prev.projectName || prev.projectId) + '</h4>'
          + '<div style="font-size:13px;color:#334155;margin-bottom:8px;">'
          + '待恢复内容：' + prev.details.taskCount + ' 个任务，'
          + prev.details.milestoneCount + ' 个里程碑，'
          + prev.details.linkCount + ' 条依赖，'
          + prev.details.commentCount + ' 条评论，'
          + prev.details.attachmentCount + ' 个附件'
          + '</div>'
          + warnItems
          + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">'
          + '<button type="button" class="btn btn-sm" data-action="cancel-preview">取消</button>'
          + '<button type="button" class="btn btn-sm btn-primary" data-action="confirm-restore">确认恢复</button>'
          + '</div>'
          + '</div>';
      } else if (this._confirmingPurgeBatchId) {
        subPanelHtml = '<div class="recycle-bin-purge-card" style="padding:14px;border:1px solid #ef4444;border-radius:8px;background:#fef2f2;margin-bottom:16px;">'
          + '<h4 style="margin:0 0 8px 0;font-size:15px;color:#991b1b;">永久删除确认</h4>'
          + '<div style="font-size:13px;color:#7f1d1d;margin-bottom:12px;">'
          + '永久删除将彻底清除此批次数据，并尽力释放未被其他项目引用的附件实体。该操作不可撤销，确定执行吗？'
          + '</div>'
          + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
          + '<button type="button" class="btn btn-sm" data-action="cancel-purge">取消</button>'
          + '<button type="button" class="btn btn-sm btn-danger" data-action="confirm-purge">确认永久删除</button>'
          + '</div>'
          + '</div>';
      }

      // 列表渲染
      var listHtml = '<div class="recycle-bin-list" id="recycle-bin-list" style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
      if (visibleBatches.length === 0) {
        listHtml += '<div style="padding:24px;text-align:center;color:#94a3b8;font-size:14px;">回收站暂无内容</div>';
      } else {
        visibleBatches.forEach(function(batch) {
          var title = '';
          var itemSummary = '';
          if (batch.kind === 'task') {
            var snapTasks = (batch.snapshot && batch.snapshot.tasks) || [];
            var rootTask = snapTasks.find(function(t) { return t.id === batch.snapshot.rootTaskId; }) || snapTasks[0] || {};
            title = rootTask.name || '未命名任务';
            if (snapTasks.length > 1) {
              title += ' (含 ' + (snapTasks.length - 1) + ' 个子任务)';
            }
            var attCount = ((batch.snapshot && batch.snapshot.attachments) || []).length;
            itemSummary = '包含 ' + snapTasks.length + ' 任务' + (attCount > 0 ? ('，' + attCount + ' 个附件') : '');
          } else if (batch.kind === 'project') {
            title = (batch.snapshot && batch.snapshot.name) || '未命名项目';
            var pTasks = (batch.snapshot && batch.snapshot.data && batch.snapshot.data.tasks) || [];
            itemSummary = '整项目删除，包含 ' + pTasks.length + ' 个任务';
          }

          var projName = projectMap[batch.projectId] || batch.projectId;
          var deletedTimeStr = batch.deletedAt ? new Date(batch.deletedAt).toLocaleString() : '';

          var kindBadge = batch.kind === 'project'
            ? '<span style="font-size:11px;background:#e0e7ff;color:#3730a3;padding:2px 6px;border-radius:4px;font-weight:600;">项目</span>'
            : '<span style="font-size:11px;background:#f1f5f9;color:#475569;padding:2px 6px;border-radius:4px;font-weight:600;">任务</span>';

          listHtml += '<div class="recycle-bin-item" data-batch-id="' + _escapeHtml(batch.id) + '" style="padding:12px;border:1px solid #e2e8f0;border-radius:6px;display:flex;justify-content:space-between;align-items:center;gap:12px;background:#ffffff;">'
            + '<div style="flex:1;min-width:0;">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
            + kindBadge
            + '<span style="font-weight:600;font-size:14px;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escapeHtml(title) + '</span>'
            + '</div>'
            + '<div style="font-size:12px;color:#64748b;display:flex;gap:12px;flex-wrap:wrap;">'
            + '<span>所属项目：' + _escapeHtml(projName) + '</span>'
            + '<span>' + _escapeHtml(itemSummary) + '</span>'
            + (deletedTimeStr ? ('<span>删除时间：' + _escapeHtml(deletedTimeStr) + '</span>') : '')
            + '</div>'
            + '</div>'
            + '<div style="display:flex;gap:6px;flex-shrink:0;">'
            + '<button type="button" class="btn btn-sm" data-action="restore-batch" data-batch-id="' + _escapeHtml(batch.id) + '">恢复</button>'
            + '<button type="button" class="btn btn-sm btn-danger" data-action="purge-batch" data-batch-id="' + _escapeHtml(batch.id) + '">永久删除</button>'
            + '</div>'
            + '</div>';
        });
      }
      listHtml += '</div>';

      return '<div class="recycle-bin-ui-container" style="min-width:320px;max-width:720px;width:100%;box-sizing:border-box;">'
        + headerHtml
        + noticeHtml
        + controlsHtml
        + autoExpireHint
        + subPanelHtml
        + listHtml
        + '</div>';
    },

    _bindEvents: function() {
      var doc = (typeof document !== 'undefined') ? document : null;
      if (!doc) return;

      var rootEl = doc.getElementById('modal-box') || doc.querySelector('#modal-box') || doc;
      var self = this;
      var ws = typeof Workspace !== 'undefined' ? Workspace : null;
      var bin = typeof RecycleBin !== 'undefined' ? RecycleBin : null;

      // 关闭按钮
      var closeBtn = rootEl.querySelector('#btn-close-recycle-bin-modal');
      if (closeBtn) {
        closeBtn.addEventListener('click', function() {
          self.close();
        });
      }

      // 项目筛选切换
      var filterSelect = rootEl.querySelector('#recycle-bin-project-filter');
      if (filterSelect) {
        filterSelect.addEventListener('change', function(e) {
          self._filterProjectId = (e && e.target && e.target.value) || filterSelect.value || '';
          self._rerender();
        });
      }

      // 点击恢复
      var restoreBtns = rootEl.querySelectorAll('[data-action="restore-batch"]');
      for (var r = 0; r < restoreBtns.length; r++) {
        restoreBtns[r].addEventListener('click', function() {
          var batchId = this.getAttribute('data-batch-id');
          if (!batchId || !ws || !bin) return;

          try {
            var preview = bin.previewRestore(ws.data, batchId);
            if (!preview.canRestore) {
              self._notice = '无法恢复: ' + (preview.blockingReason || '限制');
              self._rerender();
              return;
            }

            if (preview.warnings.length > 0) {
              self._previewBatchId = batchId;
              self._currentPreview = preview;
              self._notice = '';
              self._rerender();
              return;
            }

            // 无警告直接恢复
            var nextWs = bin.restore(ws.data, batchId, { acceptWarnings: false });
            ws.commit(nextWs);
            var manager = typeof TaskManager !== 'undefined' ? TaskManager : null;
            if (manager && typeof manager._refreshProjectData === 'function') {
              manager._refreshProjectData(ws.currentProject());
            }
            self._notice = '已成功恢复';
            self._rerender();
          } catch (err) {
            self._notice = '恢复失败: ' + (err.message || String(err));
            self._rerender();
          }
        });
      }

      // 确认警告并恢复
      var confirmRestoreBtn = rootEl.querySelector('[data-action="confirm-restore"]');
      if (confirmRestoreBtn) {
        confirmRestoreBtn.addEventListener('click', function() {
          if (!self._previewBatchId || !ws || !bin) return;
          try {
            var nextWs = bin.restore(ws.data, self._previewBatchId, { acceptWarnings: true });
            ws.commit(nextWs);
            var manager = typeof TaskManager !== 'undefined' ? TaskManager : null;
            if (manager && typeof manager._refreshProjectData === 'function') {
              manager._refreshProjectData(ws.currentProject());
            }
            self._previewBatchId = null;
            self._currentPreview = null;
            self._notice = '已确认恢复';
            self._rerender();
          } catch (err) {
            self._notice = '恢复失败: ' + (err.message || String(err));
            self._rerender();
          }
        });
      }

      // 取消恢复预览
      var cancelPreviewBtn = rootEl.querySelector('[data-action="cancel-preview"]');
      if (cancelPreviewBtn) {
        cancelPreviewBtn.addEventListener('click', function() {
          self._previewBatchId = null;
          self._currentPreview = null;
          self._rerender();
        });
      }

      // 点击永久删除
      var purgeBtns = rootEl.querySelectorAll('[data-action="purge-batch"]');
      for (var p = 0; p < purgeBtns.length; p++) {
        purgeBtns[p].addEventListener('click', function() {
          var batchId = this.getAttribute('data-batch-id');
          if (!batchId) return;
          self._confirmingPurgeBatchId = batchId;
          self._rerender();
        });
      }

      // 确认永久删除
      var confirmPurgeBtn = rootEl.querySelector('[data-action="confirm-purge"]');
      if (confirmPurgeBtn) {
        confirmPurgeBtn.addEventListener('click', function() {
          var batchId = self._confirmingPurgeBatchId;
          if (!batchId || !ws || !bin) return;

          self._confirmingPurgeBatchId = null;
          try {
            var purgeRes = bin.purge(ws.data, batchId);
            // 必须先提交工作区引用移除
            ws.commit(purgeRes.workspace);
            self._notice = '已永久删除该批次';
            self._rerender();

            // 尽力清理无引用的实体文件
            var attStore = typeof AttachmentStore !== 'undefined' ? AttachmentStore : null;
            if (attStore && typeof attStore.delete === 'function' && Array.isArray(purgeRes.unreferencedBlobKeys) && purgeRes.unreferencedBlobKeys.length > 0) {
              var cleanups = purgeRes.unreferencedBlobKeys.map(function(key) {
                return attStore.delete(key);
              });
              Promise.all(cleanups).catch(function() {
                self._notice = '批次已永久删除，但部分未引用附件空间未能完全释放';
                self._rerender();
              });
            }
          } catch (err) {
            self._notice = '永久删除失败: ' + (err.message || String(err));
            self._rerender();
          }
        });
      }

      // 取消永久删除
      var cancelPurgeBtn = rootEl.querySelector('[data-action="cancel-purge"]');
      if (cancelPurgeBtn) {
        cancelPurgeBtn.addEventListener('click', function() {
          self._confirmingPurgeBatchId = null;
          self._rerender();
        });
      }
    }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = RecycleBinUI;
  }
  if (root) {
    root.RecycleBinUI = RecycleBinUI;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
