// ============================================================
// == RecycleBin: 持久回收站纯函数模型
// ============================================================
(function(root) {
  'use strict';

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function generateId(prefix) {
    return (prefix || 'trash') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  var RecycleBin = {
    /**
     * 收集工作区中所有被引用的附件实体 blobKey 集合
     * 覆盖所有活动项目、归档项目及所有回收站批次中的真实 blobKey 字段
     */
    referencedBlobKeys: function(workspace) {
      var set = new Set();
      if (!workspace) return set;

      // 1. 遍历所有项目（包括活动和归档）
      if (Array.isArray(workspace.projects)) {
        workspace.projects.forEach(function(project) {
          if (!project || !project.data) return;
          var atts = project.data.attachments;
          if (Array.isArray(atts)) {
            atts.forEach(function(att) {
              if (att && typeof att.blobKey === 'string' && att.blobKey) {
                set.add(att.blobKey);
              }
            });
          }
        });
      }

      // 2. 遍历回收站中所有批次
      if (Array.isArray(workspace.recycleBin)) {
        workspace.recycleBin.forEach(function(batch) {
          if (!batch || !batch.snapshot) return;

          // 任务批次快照中的附件
          if (Array.isArray(batch.snapshot.attachments)) {
            batch.snapshot.attachments.forEach(function(att) {
              if (att && typeof att.blobKey === 'string' && att.blobKey) {
                set.add(att.blobKey);
              }
            });
          }

          // 项目批次快照中的附件
          if (batch.snapshot.data && Array.isArray(batch.snapshot.data.attachments)) {
            batch.snapshot.data.attachments.forEach(function(att) {
              if (att && typeof att.blobKey === 'string' && att.blobKey) {
                set.add(att.blobKey);
              }
            });
          }
        });
      }

      return set;
    },

    /**
     * 删除任务及其子孙树进入回收站
     * 纯函数：不修改入参 workspace，返回新 workspace 与 batchId
     */
    removeTask: function(workspace, projectId, taskId) {
      if (!workspace || !projectId || !taskId) {
        throw new Error('removeTask: 参数无效');
      }

      var nextWorkspace = clone(workspace);
      var projects = nextWorkspace.projects || [];
      var project = null;
      for (var i = 0; i < projects.length; i++) {
        if (projects[i].id === projectId) {
          project = projects[i];
          break;
        }
      }

      if (!project) {
        throw new Error('未找到项目: ' + projectId);
      }
      if (project.archived) {
        throw new Error('已归档项目处于只读状态，不可删除任务');
      }

      var projectData = project.data;
      if (!projectData || !Array.isArray(projectData.tasks)) {
        throw new Error('项目数据不合法或无任务');
      }

      // 查找根任务
      var rootTask = null;
      for (var tIdx = 0; tIdx < projectData.tasks.length; tIdx++) {
        if (projectData.tasks[tIdx].id === taskId) {
          rootTask = projectData.tasks[tIdx];
          break;
        }
      }
      if (!rootTask) {
        throw new Error('未找到任务: ' + taskId);
      }

      // 收集子孙任务 ID
      var childrenByParent = {};
      projectData.tasks.forEach(function(t) {
        var pId = t.parentId || '__root__';
        if (!childrenByParent[pId]) childrenByParent[pId] = [];
        childrenByParent[pId].push(t);
      });

      var removedIds = new Set([taskId]);
      var queue = [taskId];
      while (queue.length > 0) {
        var curId = queue.shift();
        var children = childrenByParent[curId] || [];
        for (var c = 0; c < children.length; c++) {
          var ch = children[c];
          if (!removedIds.has(ch.id)) {
            removedIds.add(ch.id);
            queue.push(ch.id);
          }
        }
      }

      // 提取被移除业务数据快照并从活动业务数组移出
      var removedTasks = [];
      projectData.tasks = projectData.tasks.filter(function(t) {
        if (removedIds.has(t.id)) {
          removedTasks.push(t);
          return false;
        }
        return true;
      });

      var removedMilestones = [];
      projectData.milestones = (projectData.milestones || []).filter(function(m) {
        if (m && removedIds.has(m.taskId)) {
          removedMilestones.push(m);
          return false;
        }
        return true;
      });

      var removedLinks = [];
      projectData.links = (projectData.links || []).filter(function(l) {
        if (l && (removedIds.has(l.source) || removedIds.has(l.target))) {
          removedLinks.push(l);
          return false;
        }
        return true;
      });

      var removedComments = [];
      projectData.comments = (projectData.comments || []).filter(function(c) {
        if (c && removedIds.has(c.taskId)) {
          removedComments.push(c);
          return false;
        }
        return true;
      });

      var removedAttachments = [];
      projectData.attachments = (projectData.attachments || []).filter(function(a) {
        if (a && removedIds.has(a.taskId)) {
          removedAttachments.push(a);
          return false;
        }
        return true;
      });

      var removedActivity = [];
      projectData.activity = (projectData.activity || []).filter(function(act) {
        if (act && removedIds.has(act.taskId)) {
          removedActivity.push(act);
          return false;
        }
        return true;
      });

      project.updatedAt = new Date().toISOString();

      var batchId = generateId('trash');
      var batch = {
        id: batchId,
        kind: 'task',
        projectId: projectId,
        deletedAt: new Date().toISOString(),
        snapshot: {
          rootTaskId: taskId,
          originalParentId: rootTask.parentId || null,
          tasks: removedTasks,
          milestones: removedMilestones,
          links: removedLinks,
          comments: removedComments,
          attachments: removedAttachments,
          activity: removedActivity
        }
      };

      if (!Array.isArray(nextWorkspace.recycleBin)) {
        nextWorkspace.recycleBin = [];
      }
      nextWorkspace.recycleBin.push(batch);

      return {
        workspace: nextWorkspace,
        batchId: batchId
      };
    },

    /**
     * 删除整个项目进入回收站
     * 纯函数：不修改入参 workspace，保留项目完整 Project（含 data），旧任务批次继续关联 projectId
     */
    removeProject: function(workspace, projectId) {
      if (!workspace || !projectId) {
        throw new Error('removeProject: 参数无效');
      }

      var nextWorkspace = clone(workspace);
      var projects = nextWorkspace.projects || [];
      var projectIndex = -1;
      for (var i = 0; i < projects.length; i++) {
        if (projects[i].id === projectId) {
          projectIndex = i;
          break;
        }
      }

      if (projectIndex === -1) {
        throw new Error('未找到项目: ' + projectId);
      }

      var removedProject = projects.splice(projectIndex, 1)[0];

      // 启动偏好降级
      if (nextWorkspace.settings) {
        if (nextWorkspace.settings.defaultProjectId === projectId) {
          nextWorkspace.settings.defaultProjectId = null;
        }
        if (nextWorkspace.settings.lastProjectId === projectId) {
          nextWorkspace.settings.lastProjectId = null;
        }
      }

      var batchId = generateId('trash-proj');
      var batch = {
        id: batchId,
        kind: 'project',
        projectId: projectId,
        deletedAt: new Date().toISOString(),
        snapshot: removedProject
      };

      if (!Array.isArray(nextWorkspace.recycleBin)) {
        nextWorkspace.recycleBin = [];
      }
      nextWorkspace.recycleBin.push(batch);

      return {
        workspace: nextWorkspace,
        batchId: batchId
      };
    },

    /**
     * 恢复前预览与冲突/悬空检查
     */
    previewRestore: function(workspace, batchId) {
      if (!workspace || !batchId) {
        throw new Error('previewRestore: 参数无效');
      }

      var bin = workspace.recycleBin || [];
      var batch = null;
      for (var i = 0; i < bin.length; i++) {
        if (bin[i].id === batchId) {
          batch = bin[i];
          break;
        }
      }
      if (!batch) {
        throw new Error('未找到回收站批次: ' + batchId);
      }

      var preview = {
        canRestore: true,
        blockingReason: null,
        batchId: batchId,
        kind: batch.kind,
        projectId: batch.projectId,
        projectName: '',
        warnings: [],
        details: {
          taskCount: 0,
          milestoneCount: 0,
          linkCount: 0,
          commentCount: 0,
          attachmentCount: 0,
          activityCount: 0,
          missingParent: false,
          brokenLinks: [],
          idConflicts: []
        }
      };

      if (batch.kind === 'project') {
        var snapProj = batch.snapshot || {};
        preview.projectName = snapProj.name || batch.projectId;
        var existingProjects = workspace.projects || [];
        for (var p = 0; p < existingProjects.length; p++) {
          if (existingProjects[p].id === snapProj.id) {
            preview.warnings.push('存在相同 ID 的项目冲突 (' + snapProj.id + ')，恢复时将生成新项目 ID');
            preview.details.idConflicts.push(snapProj.id);
            break;
          }
        }
        if (snapProj.data) {
          preview.details.taskCount = (snapProj.data.tasks || []).length;
          preview.details.milestoneCount = (snapProj.data.milestones || []).length;
          preview.details.linkCount = (snapProj.data.links || []).length;
          preview.details.commentCount = (snapProj.data.comments || []).length;
          preview.details.attachmentCount = (snapProj.data.attachments || []).length;
          preview.details.activityCount = (snapProj.data.activity || []).length;
        }
        return preview;
      }

      // 任务恢复检查
      var targetProject = null;
      var currentProjects = workspace.projects || [];
      for (var cp = 0; cp < currentProjects.length; cp++) {
        if (currentProjects[cp].id === batch.projectId) {
          targetProject = currentProjects[cp];
          break;
        }
      }

      // 检查原项目是否仍处于回收站中（防止同 ID 的新无关项目导致误恢复）
      var binList = workspace.recycleBin || [];
      var taskBatchIndex = -1;
      for (var ti = 0; ti < binList.length; ti++) {
        if (binList[ti].id === batchId) {
          taskBatchIndex = ti;
          break;
        }
      }
      var projectBatchStillInBin = false;
      for (var b = 0; b < binList.length; b++) {
        var item = binList[b];
        if (item && item.kind === 'project' && item.snapshot && item.snapshot.id === batch.projectId) {
          var taskDelTime = new Date(batch.deletedAt || 0).getTime();
          var projDelTime = new Date(item.deletedAt || 0).getTime();
          if (taskDelTime <= projDelTime && (taskBatchIndex === -1 || b > taskBatchIndex)) {
            projectBatchStillInBin = true;
            break;
          }
        }
      }

      if (!targetProject || projectBatchStillInBin) {
        preview.canRestore = false;
        preview.blockingReason = '原项目已删除，需先恢复项目';
        return preview;
      }

      if (targetProject.archived) {
        preview.canRestore = false;
        preview.blockingReason = '原项目已归档处于只读状态，禁止恢复任务';
        return preview;
      }

      preview.projectName = targetProject.name;
      var snap = batch.snapshot || {};
      var snapTasks = Array.isArray(snap.tasks) ? snap.tasks : [];
      var snapLinks = Array.isArray(snap.links) ? snap.links : [];

      preview.details.taskCount = snapTasks.length;
      preview.details.milestoneCount = (snap.milestones || []).length;
      preview.details.linkCount = snapLinks.length;
      preview.details.commentCount = (snap.comments || []).length;
      preview.details.attachmentCount = (snap.attachments || []).length;
      preview.details.activityCount = (snap.activity || []).length;

      var existingTaskMap = new Map();
      (targetProject.data.tasks || []).forEach(function(t) {
        existingTaskMap.set(t.id, t);
      });

      var snapTaskIdSet = new Set(snapTasks.map(function(t) { return t.id; }));

      // 1. 父级检查
      snapTasks.forEach(function(t) {
        if (t.parentId) {
          if (!snapTaskIdSet.has(t.parentId) && !existingTaskMap.has(t.parentId)) {
            preview.details.missingParent = true;
          }
        }
      });
      if (snap.originalParentId && !existingTaskMap.has(snap.originalParentId) && !snapTaskIdSet.has(snap.originalParentId)) {
        preview.details.missingParent = true;
      }
      if (preview.details.missingParent) {
        preview.warnings.push('原父任务不存在，确认后将恢复为顶层任务');
      }

      // 2. 外部依赖检查
      snapLinks.forEach(function(l) {
        var sourceExists = snapTaskIdSet.has(l.source) || existingTaskMap.has(l.source);
        var targetExists = snapTaskIdSet.has(l.target) || existingTaskMap.has(l.target);
        if (!sourceExists || !targetExists) {
          preview.details.brokenLinks.push(l);
        }
      });
      if (preview.details.brokenLinks.length > 0) {
        preview.warnings.push('部分依赖任务不存在，悬空依赖关系将不会被恢复 (共 ' + preview.details.brokenLinks.length + ' 条)');
      }

      // 3. ID 冲突检查
      snapTasks.forEach(function(t) {
        if (existingTaskMap.has(t.id)) {
          preview.details.idConflicts.push(t.id);
        }
      });
      if (preview.details.idConflicts.length > 0) {
        preview.warnings.push('检测到 ' + preview.details.idConflicts.length + ' 个任务 ID 存在冲突，恢复时将自动生成新 ID 并同步引用');
      }

      return preview;
    },

    /**
     * 从回收站恢复批次
     * 纯函数：不修改入参 workspace，返回新 WorkspaceData
     */
    restore: function(workspace, batchId, options) {
      if (!workspace || !batchId) {
        throw new Error('restore: 参数无效');
      }
      options = options || {};

      var preview = this.previewRestore(workspace, batchId);
      if (!preview.canRestore) {
        throw new Error('无法恢复: ' + (preview.blockingReason || '未知限制'));
      }

      if (preview.warnings.length > 0 && !options.acceptWarnings) {
        throw new Error('存在警告需确认恢复: ' + preview.warnings.join('; '));
      }

      var nextWorkspace = clone(workspace);
      var bin = nextWorkspace.recycleBin || [];
      var batchIndex = -1;
      for (var i = 0; i < bin.length; i++) {
        if (bin[i].id === batchId) {
          batchIndex = i;
          break;
        }
      }
      if (batchIndex === -1) {
        throw new Error('未找到回收站批次: ' + batchId);
      }

      var batch = bin.splice(batchIndex, 1)[0];

      // 1. 恢复项目
      if (batch.kind === 'project') {
        var restoredProj = clone(batch.snapshot);
        var existingProjects = nextWorkspace.projects || [];
        var idConflict = false;
        for (var p = 0; p < existingProjects.length; p++) {
          if (existingProjects[p].id === restoredProj.id) {
            idConflict = true;
            break;
          }
        }
        var oldProjId = batch.snapshot.id;
        if (idConflict) {
          var newProjId = generateId('proj');
          restoredProj.id = newProjId;

          // 同步更新归属该旧项目的既有任务批次 projectId
          // 只有在项目删除前入队的任务批次（即原索引小于 batchIndex 且时间戳不晚于项目删除）才属于该旧项目
          if (Array.isArray(bin)) {
            var projDelTime = new Date(batch.deletedAt || 0).getTime();
            for (var bi = 0; bi < batchIndex && bi < bin.length; bi++) {
              var tb = bin[bi];
              if (tb && tb.kind === 'task' && tb.projectId === oldProjId) {
                var taskDelTime = new Date(tb.deletedAt || 0).getTime();
                if (taskDelTime <= projDelTime) {
                  tb.projectId = newProjId;
                }
              }
            }
          }
        }
        restoredProj.updatedAt = new Date().toISOString();
        nextWorkspace.projects.push(restoredProj);
        return nextWorkspace;
      }

      // 2. 恢复任务
      var targetProject = null;
      for (var tp = 0; tp < nextWorkspace.projects.length; tp++) {
        if (nextWorkspace.projects[tp].id === batch.projectId) {
          targetProject = nextWorkspace.projects[tp];
          break;
        }
      }
      if (!targetProject) {
        throw new Error('原项目已删除，需先恢复项目');
      }
      if (targetProject.archived) {
        throw new Error('原项目已归档处于只读状态，禁止恢复任务');
      }

      var pData = targetProject.data;
      if (!Array.isArray(pData.tasks)) pData.tasks = [];
      if (!Array.isArray(pData.milestones)) pData.milestones = [];
      if (!Array.isArray(pData.links)) pData.links = [];
      if (!Array.isArray(pData.comments)) pData.comments = [];
      if (!Array.isArray(pData.attachments)) pData.attachments = [];
      if (!Array.isArray(pData.activity)) pData.activity = [];

      var snap = clone(batch.snapshot || {});
      var tasks = snap.tasks || [];
      var milestones = snap.milestones || [];
      var links = snap.links || [];
      var comments = snap.comments || [];
      var attachments = snap.attachments || [];
      var activity = snap.activity || [];

      var existingTaskIds = new Set(pData.tasks.map(function(t) { return t.id; }));

      // ID 重映射
      var idMap = {};
      tasks.forEach(function(t) {
        if (existingTaskIds.has(t.id)) {
          var newTaskId = generateId('task');
          idMap[t.id] = newTaskId;
          t.id = newTaskId;
        }
      });

      // 同步内部引用
      tasks.forEach(function(t) {
        if (t.parentId && idMap[t.parentId]) {
          t.parentId = idMap[t.parentId];
        }
      });

      milestones.forEach(function(m) {
        if (idMap[m.taskId]) m.taskId = idMap[m.taskId];
        m.id = generateId('m');
      });

      links.forEach(function(l) {
        if (idMap[l.source]) l.source = idMap[l.source];
        if (idMap[l.target]) l.target = idMap[l.target];
        l.id = generateId('link');
      });

      comments.forEach(function(c) {
        if (idMap[c.taskId]) c.taskId = idMap[c.taskId];
        c.id = generateId('comment');
      });

      attachments.forEach(function(a) {
        if (idMap[a.taskId]) a.taskId = idMap[a.taskId];
        a.id = generateId('attachment');
      });

      activity.forEach(function(act) {
        if (idMap[act.taskId]) act.taskId = idMap[act.taskId];
      });

      // 缺失父级降级为顶层任务
      var allKnownTaskIds = new Set(pData.tasks.map(function(t) { return t.id; }));
      tasks.forEach(function(t) { allKnownTaskIds.add(t.id); });

      tasks.forEach(function(t) {
        if (t.parentId && !allKnownTaskIds.has(t.parentId)) {
          t.parentId = null;
        }
      });

      // 过滤悬空外依赖
      var validLinks = links.filter(function(l) {
        return allKnownTaskIds.has(l.source) && allKnownTaskIds.has(l.target);
      });

      // 合并入活动数据
      pData.tasks = pData.tasks.concat(tasks);
      pData.milestones = pData.milestones.concat(milestones);
      pData.links = pData.links.concat(validLinks);
      pData.comments = pData.comments.concat(comments);
      pData.attachments = pData.attachments.concat(attachments);
      pData.activity = pData.activity.concat(activity);

      targetProject.updatedAt = new Date().toISOString();

      return nextWorkspace;
    },

    /**
     * 永久删除批次并计算可释放的无引用 blobKey 集合
     * 纯函数：不修改入参 workspace，返回新 workspace 与待清理 blobKey 数组
     */
    purge: function(workspace, batchId) {
      if (!workspace || !batchId) {
        throw new Error('purge: 参数无效');
      }

      var bin = workspace.recycleBin || [];
      var batchIndex = -1;
      for (var i = 0; i < bin.length; i++) {
        if (bin[i].id === batchId) {
          batchIndex = i;
          break;
        }
      }
      if (batchIndex === -1) {
        throw new Error('未找到回收站批次: ' + batchId);
      }

      var targetBatch = bin[batchIndex];

      // 提取待删除批次中的附件 key 集合
      var candidateBlobKeys = new Set();
      if (targetBatch.kind === 'task') {
        var atts = targetBatch.snapshot && targetBatch.snapshot.attachments;
        if (Array.isArray(atts)) {
          atts.forEach(function(a) {
            if (a && typeof a.blobKey === 'string' && a.blobKey) {
              candidateBlobKeys.add(a.blobKey);
            }
          });
        }
      } else if (targetBatch.kind === 'project') {
        var pAtts = targetBatch.snapshot && targetBatch.snapshot.data && targetBatch.snapshot.data.attachments;
        if (Array.isArray(pAtts)) {
          pAtts.forEach(function(a) {
            if (a && typeof a.blobKey === 'string' && a.blobKey) {
              candidateBlobKeys.add(a.blobKey);
            }
          });
        }
      }

      var nextWorkspace = clone(workspace);
      nextWorkspace.recycleBin.splice(batchIndex, 1);

      // 计算移除该批次后，剩余工作区（包括所有活动项目、归档项目及其他回收站批次）中仍然被引用的 blobKey
      var remainingReferenced = this.referencedBlobKeys(nextWorkspace);

      var unreferencedBlobKeys = [];
      candidateBlobKeys.forEach(function(key) {
        if (!remainingReferenced.has(key)) {
          unreferencedBlobKeys.push(key);
        }
      });

      return {
        workspace: nextWorkspace,
        unreferencedBlobKeys: unreferencedBlobKeys
      };
    }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = RecycleBin;
  }
  if (root) {
    root.RecycleBin = RecycleBin;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
