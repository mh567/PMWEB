// ============================================================
// ColumnConfig: GridPane 列模型的纯函数
// 负责默认列、持久化状态合并、可见性、宽度、顺序以及自定义字段契约。
// ============================================================
var ColumnConfig = {
  DEFAULT_COLUMNS: [
    { key: 'name', label: '任务名称', width: 260, minWidth: 160, visible: true, type: 'name', builtin: true },
    { key: 'status', label: '状态', width: 110, minWidth: 80, visible: true, type: 'status', builtin: true },
    { key: 'assignee', label: '负责人', width: 100, minWidth: 70, visible: true, type: 'text', builtin: true },
    { key: 'startDate', label: '开始', width: 110, minWidth: 88, visible: true, type: 'date', builtin: true },
    { key: 'endDate', label: '结束', width: 110, minWidth: 88, visible: true, type: 'date', builtin: true },
    { key: 'plannedEndDate', label: '计划完成', width: 120, minWidth: 96, visible: true, type: 'date', builtin: true },
    { key: 'progress', label: '进度', width: 120, minWidth: 90, visible: true, type: 'progress', builtin: true },
    { key: 'description', label: '描述', width: 220, minWidth: 120, visible: true, type: 'text', builtin: true }
  ],

  cloneColumn: function(column) {
    if (!column) return null;
    var cloned = {
      key: column.key,
      label: column.label,
      width: column.width,
      minWidth: column.minWidth,
      visible: column.visible !== false,
      type: column.type,
      builtin: column.builtin !== false
    };
    if (Array.isArray(column.options)) {
      cloned.options = column.options.map(function(opt) {
        return { id: String(opt.id), label: String(opt.label) };
      });
    }
    return cloned;
  },

  defaultColumns: function() {
    var self = this;
    return this.DEFAULT_COLUMNS.map(function(c) {
      return self.cloneColumn(c);
    });
  },

  findColumn: function(columns, key) {
    var list = columns || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === key) return list[i];
    }
    return null;
  },

  isKnownColumn: function(key) {
    return !!this.findColumn(this.DEFAULT_COLUMNS, key);
  },

  clampWidth: function(column, width) {
    var min = column && column.minWidth ? column.minWidth : 60;
    var value = Number(width);
    if (!isFinite(value) || value <= 0) {
      return column && column.width ? column.width : min;
    }
    return Math.max(min, Math.round(value));
  },

  mergeColumn: function(column, override) {
    var merged = this.cloneColumn(column);
    if (override) {
      if (typeof override.label === 'string' && override.label.trim()) {
        merged.label = override.label.trim();
      }
      merged.width = this.clampWidth(column, override.width);
      merged.visible = override.visible !== false;
      if (override.type && !merged.builtin) {
        merged.type = override.type;
      }
      if (Array.isArray(override.options)) {
        merged.options = override.options.map(function(opt) {
          return { id: String(opt.id), label: String(opt.label) };
        });
      }
    }
    return merged;
  },

  normalize: function(saved) {
    var defaults = this.DEFAULT_COLUMNS;
    var result = [];
    var seenKeys = new Set();
    var self = this;

    if (Array.isArray(saved)) {
      saved.forEach(function(item) {
        if (!item || typeof item.key !== 'string' || !item.key.trim()) return;
        var key = item.key.trim();
        if (seenKeys.has(key)) return;

        var baseDefault = self.findColumn(defaults, key);
        if (baseDefault) {
          seenKeys.add(key);
          result.push(self.mergeColumn(baseDefault, item));
        } else if (item.builtin === false || (item.type && typeof item.label === 'string')) {
          seenKeys.add(key);
          var customCol = {
            key: key,
            label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : key,
            width: self.clampWidth(item, item.width || 120),
            minWidth: item.minWidth || 60,
            visible: item.visible !== false,
            type: item.type || 'text',
            builtin: false
          };
          if (Array.isArray(item.options)) {
            customCol.options = item.options.map(function(opt) {
              return { id: String(opt.id), label: String(opt.label) };
            });
          }
          result.push(customCol);
        }
      });
    }

    defaults.forEach(function(base) {
      if (!seenKeys.has(base.key)) {
        result.push(self.cloneColumn(base));
      }
    });

    return result;
  },

  getVisibleColumns: function(columns) {
    var list = columns || [];
    return list.filter(function(col) {
      return col && col.visible !== false;
    });
  },

  getColumnsWidth: function(columns) {
    return this.getVisibleColumns(columns).reduce(function(sum, col) {
      return sum + col.width;
    }, 0);
  },

  getState: function(columns) {
    var self = this;
    return (columns || []).map(function(col) {
      return self.cloneColumn(col);
    });
  },

  moveTo: function(columns, key, targetIndex) {
    var list = (columns || []).slice();
    var fromIndex = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === key) {
        fromIndex = i;
        break;
      }
    }
    if (fromIndex === -1) return list;
    var target = Number(targetIndex);
    if (!isFinite(target)) target = 0;
    if (target < 0) target = 0;
    if (target >= list.length) target = list.length - 1;
    if (fromIndex === target) return list;

    var item = list.splice(fromIndex, 1)[0];
    list.splice(target, 0, item);
    return list;
  },

  moveColumn: function(columns, key, offset) {
    var list = (columns || []).slice();
    var index = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === key) {
        index = i;
        break;
      }
    }
    var step = Number(offset);
    if (index === -1 || !isFinite(step) || step === 0) return list;
    var target = index + (step > 0 ? 1 : -1);
    if (target < 0 || target >= list.length) return list;
    var moved = list.splice(index, 1)[0];
    list.splice(target, 0, moved);
    return list;
  },

  isValidCalendarDate: function(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    var parts = value.split('-');
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    var date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
  },

  validateValue: function(column, value) {
    if (!column) {
      return { valid: false, value: null, error: '列定义不能为空' };
    }
    if (value === null || value === undefined || value === '') {
      return { valid: true, value: null, error: null };
    }

    var type = column.type;
    if (type === 'number') {
      if (typeof value === 'number') {
        if (!isFinite(value)) {
          return { valid: false, value: null, error: '数字必须是有限数值' };
        }
        return { valid: true, value: value, error: null };
      }
      var textNum = String(value).trim();
      var num = Number(textNum);
      if (textNum === '' || !isFinite(num)) {
        return { valid: false, value: null, error: '必须是有效数字' };
      }
      return { valid: true, value: num, error: null };
    }

    if (type === 'date') {
      var dateStr = String(value).trim();
      if (!this.isValidCalendarDate(dateStr)) {
        return { valid: false, value: null, error: '必须是有效公历日期（YYYY-MM-DD）' };
      }
      return { valid: true, value: dateStr, error: null };
    }

    if (type === 'select') {
      var optId = String(value);
      var options = Array.isArray(column.options) ? column.options : [];
      var matched = false;
      for (var i = 0; i < options.length; i++) {
        if (options[i] && String(options[i].id) === optId) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return { valid: false, value: null, error: '选项不存在' };
      }
      return { valid: true, value: optId, error: null };
    }

    if (type === 'name') {
      var nameStr = String(value).trim();
      if (nameStr === '') {
        return { valid: false, value: '', error: '名称不能为空' };
      }
      return { valid: true, value: nameStr, error: null };
    }

    if (type === 'status') {
      if (['todo', 'inProgress', 'thirdParty', 'done'].indexOf(value) !== -1) {
        return { valid: true, value: value, error: null };
      }
      return { valid: false, value: null, error: '状态不合法' };
    }

    if (type === 'progress') {
      var p = Number(value);
      if (!isFinite(p) || p < 0 || p > 100) {
        return { valid: false, value: null, error: '进度必须在 0 到 100 之间' };
      }
      return { valid: true, value: Math.round(p), error: null };
    }

    // text or other
    return { valid: true, value: String(value), error: null };
  },

  _extractTasksFromBatch: function(batch) {
    if (!batch) return [];
    var list = [];
    if (batch.snapshot) {
      if (Array.isArray(batch.snapshot.tasks)) {
        list = list.concat(batch.snapshot.tasks);
      } else if (batch.snapshot.data && Array.isArray(batch.snapshot.data.tasks)) {
        list = list.concat(batch.snapshot.data.tasks);
      } else if (batch.snapshot.customFields || batch.snapshot.id) {
        list.push(batch.snapshot);
      }
    }
    if (Array.isArray(batch.tasks)) {
      list = list.concat(batch.tasks);
    }
    return list;
  },

  validateDraft: function(columns, projectData, trashBatches) {
    var errors = [];
    if (!Array.isArray(columns)) {
      return { valid: false, errors: ['列配置草稿必须是数组'] };
    }

    var seenLabels = new Map();
    columns.forEach(function(col, idx) {
      if (!col) return;
      var rawLabel = col.label;
      if (typeof rawLabel !== 'string' || rawLabel.trim() === '') {
        errors.push('第 ' + (idx + 1) + ' 列列名不能为空');
        return;
      }
      var trimmed = rawLabel.trim();
      if (seenLabels.has(trimmed)) {
        errors.push('列名“' + trimmed + '”重复');
      } else {
        seenLabels.set(trimmed, true);
      }
    });

    var existingCols = (projectData && projectData.settings && Array.isArray(projectData.settings.columns))
      ? projectData.settings.columns
      : this.defaultColumns();
    var existingByKey = new Map();
    existingCols.forEach(function(col) {
      if (col && col.key) existingByKey.set(col.key, col);
    });

    var tasks = (projectData && Array.isArray(projectData.tasks)) ? projectData.tasks : [];

    // 从回收站提取属于当前目标项目的任务快照
    var targetId = projectData ? (projectData.id || projectData.projectId) : null;
    var trashTasks = [];
    if (Array.isArray(trashBatches)) {
      var self = this;
      trashBatches.forEach(function(batch) {
        if (!batch) return;
        if (targetId && batch.projectId && batch.projectId !== targetId) {
          return; // 跨项目隔离：其他项目批次不计入
        }
        trashTasks = trashTasks.concat(self._extractTasksFromBatch(batch));
      });
    }

    var self = this;
    columns.forEach(function(col) {
      if (!col || !col.key) return;
      var oldCol = existingByKey.get(col.key);
      if (!oldCol) return;

      // 1. 检查类型变更：活动任务或回收站快照中已有非空数据禁止改字段类型
      if (oldCol.type !== col.type) {
        var hasData = false;
        var allCandidateTasks = tasks.concat(trashTasks);
        for (var i = 0; i < allCandidateTasks.length; i++) {
          var t = allCandidateTasks[i];
          if (!t) continue;
          var val = col.builtin ? t[col.key] : (t.customFields ? t.customFields[col.key] : undefined);
          if (val !== null && val !== undefined && val !== '') {
            hasData = true;
            break;
          }
        }
        if (hasData) {
          errors.push('列“' + col.label + '”已有非空数据，不能直接修改字段类型');
        }
      }

      // 2. 检查单选选项删除：已被活动任务或回收站快照任务引用的选项禁止删除
      if (oldCol.type === 'select') {
        var oldOpts = Array.isArray(oldCol.options) ? oldCol.options : [];
        var newOptIds = new Set((Array.isArray(col.options) ? col.options : []).map(function(o) {
          return String(o.id);
        }));

        oldOpts.forEach(function(oldOpt) {
          if (!newOptIds.has(String(oldOpt.id))) {
            var optId = String(oldOpt.id);
            var referenced = false;

            // 检查活动任务引用
            for (var tIdx = 0; tIdx < tasks.length; tIdx++) {
              var task = tasks[tIdx];
              if (task && task.customFields && String(task.customFields[col.key]) === optId) {
                referenced = true;
                break;
              }
            }

            // 检查回收站任务快照引用
            if (!referenced) {
              for (var btIdx = 0; btIdx < trashTasks.length; btIdx++) {
                var bTask = trashTasks[btIdx];
                if (bTask && bTask.customFields && String(bTask.customFields[col.key]) === optId) {
                  referenced = true;
                  break;
                }
              }
            }

            if (referenced) {
              errors.push('选项“' + oldOpt.label + '”已被任务引用，不能删除');
            }
          }
        });
      }
    });

    return { valid: errors.length === 0, errors: errors };
  },

  removeColumnDefinition: function(columns, key) {
    var col = this.findColumn(columns, key);
    if (!col) return (columns || []).slice();
    if (col.builtin !== false) {
      throw new Error('内置列不允许删除');
    }
    return (columns || []).filter(function(c) {
      return c && c.key !== key;
    });
  },

  deleteCustomColumn: function(columns, key, projectData, trashBatches) {
    var nextColumns = this.removeColumnDefinition(columns, key);
    var targetId = projectData ? (projectData.id || projectData.projectId) : null;

    // 清理活动任务中的该列值
    if (projectData && Array.isArray(projectData.tasks)) {
      projectData.tasks.forEach(function(task) {
        if (task && task.customFields && Object.prototype.hasOwnProperty.call(task.customFields, key)) {
          delete task.customFields[key];
        }
      });
    }

    // 清理回收站批次中的该列值（严格仅清理目标项目）
    if (Array.isArray(trashBatches) && trashBatches.length > 0) {
      // 提取批次中所有的明确项目归属集合
      var batchProjectIds = new Set();
      trashBatches.forEach(function(b) {
        if (b && b.projectId) batchProjectIds.add(b.projectId);
      });

      trashBatches.forEach(function(batch) {
        if (!batch) return;

        // 1. 未知所属批次安全保留，绝不清理
        if (!batch.projectId) return;

        // 2. 跨项目隔离与缺失上下文防护：
        if (targetId) {
          // 若目标项目明确，其他项目的批次严禁清理
          if (batch.projectId !== targetId) return;
        } else {
          // 若缺少目标项目上下文（targetId 为空），严禁全库扩散清理：
          // 若批次集合中包含多个不同项目的批次，一律拦截跳过
          if (batchProjectIds.size > 1) return;
        }

        // 清理 v4 快照中的任务
        if (batch.snapshot) {
          if (Array.isArray(batch.snapshot.tasks)) {
            batch.snapshot.tasks.forEach(function(t) {
              if (t && t.customFields && Object.prototype.hasOwnProperty.call(t.customFields, key)) {
                delete t.customFields[key];
              }
            });
          }
          if (batch.snapshot.data && Array.isArray(batch.snapshot.data.tasks)) {
            batch.snapshot.data.tasks.forEach(function(t) {
              if (t && t.customFields && Object.prototype.hasOwnProperty.call(t.customFields, key)) {
                delete t.customFields[key];
              }
            });
          }
          if (batch.snapshot.customFields && Object.prototype.hasOwnProperty.call(batch.snapshot.customFields, key)) {
            delete batch.snapshot.customFields[key];
          }
        }

        // 兼容 batch.tasks 结构
        if (Array.isArray(batch.tasks)) {
          batch.tasks.forEach(function(task) {
            if (task && task.customFields && Object.prototype.hasOwnProperty.call(task.customFields, key)) {
              delete task.customFields[key];
            }
          });
        }
      });
    }

    return nextColumns;
  }
};
