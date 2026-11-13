// ============================================================
// Backup — 完整备份、单项目导出、全内存校验与安全恢复
// 接口规范见 docs/superpowers/plans/2026-11-11-lightweight-multiproject.md Task 8
// ============================================================
var Backup = (function() {
  'use strict';

  var BACKUP_VERSION = 1;

  function generateId(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);
  }

  function clone(obj) {
    if (obj === undefined || obj === null) return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  // 二进制与 Base64 标准转换（原生实现，不引入外部库）
  function uint8ArrayToBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    var binary = '';
    var len = bytes.byteLength;
    var chunkSize = 8192;
    for (var i = 0; i < len; i += chunkSize) {
      var chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  var BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

  function base64ToUint8Array(base64) {
    if (typeof base64 !== 'string' || !BASE64_REGEX.test(base64)) {
      throw new Error('Base64 字符串包含非法字符或格式不规范');
    }
    if (typeof Buffer !== 'undefined') {
      var buf = Buffer.from(base64, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    var binary = atob(base64);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function createBlobFromBytes(bytes, type) {
    if (typeof Blob !== 'undefined') {
      return new Blob([bytes], { type: type || 'application/octet-stream' });
    }
    return {
      size: bytes.byteLength,
      type: type || 'application/octet-stream',
      arrayBuffer: function() {
        return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }
    };
  }

  // 精准排除会话凭据、token 与同步队列，保留其他所有业务扩展
  function sanitizeWorkspacePayload(wsData) {
    var cloned = clone(wsData);
    if (!cloned || typeof cloned !== 'object') return cloned;

    if (cloned.settings && typeof cloned.settings === 'object') {
      delete cloned.settings.token;
      delete cloned.settings.authToken;
      delete cloned.settings.accessToken;
      delete cloned.settings.credentials;
      delete cloned.settings.session;
      if (cloned.settings.syncConfig && typeof cloned.settings.syncConfig === 'object') {
        delete cloned.settings.syncConfig.token;
        delete cloned.settings.syncConfig.credentials;
      }
    }

    if (cloned.legacy && typeof cloned.legacy === 'object') {
      delete cloned.legacy.token;
      delete cloned.legacy.authToken;
      delete cloned.legacy.accessToken;
      delete cloned.legacy.credentials;
      delete cloned.legacy.session;
      delete cloned.legacy.syncQueue;
      delete cloned.legacy.sync_queue;
    }

    delete cloned.syncQueue;
    delete cloned.sync_queue;
    delete cloned.credentials;
    delete cloned.session;

    return cloned;
  }

  // 收集实体引用的附件元数据列表（去重前集合）
  function collectAttachmentMetas(scope) {
    var list = [];
    if (!scope) return list;

    function addList(atts) {
      if (Array.isArray(atts)) {
        for (var i = 0; i < atts.length; i++) {
          var a = atts[i];
          if (a && typeof a.blobKey === 'string' && a.blobKey) {
            list.push(a);
          }
        }
      }
    }

    // 1. 项目数据
    if (Array.isArray(scope.projects)) {
      scope.projects.forEach(function(p) {
        if (p && p.data) addList(p.data.attachments);
      });
    } else if (scope.data && Array.isArray(scope.data.attachments)) {
      addList(scope.data.attachments);
    } else if (Array.isArray(scope.attachments)) {
      addList(scope.attachments);
    }

    // 2. 回收站数据
    if (Array.isArray(scope.recycleBin)) {
      scope.recycleBin.forEach(function(batch) {
        if (!batch || !batch.snapshot) return;
        if (Array.isArray(batch.snapshot.attachments)) {
          addList(batch.snapshot.attachments);
        }
        if (batch.snapshot.data && Array.isArray(batch.snapshot.data.attachments)) {
          addList(batch.snapshot.data.attachments);
        }
      });
    }

    return list;
  }

  /**
   * 完整导出
   * Backup.exportPackage({ kind, projectId? }) -> Promise<BackupPackage>
   */
  function exportPackage(options) {
    options = options || {};
    var kind = options.kind;
    if (kind !== 'workspace' && kind !== 'project') {
      return Promise.reject(new Error('exportPackage: kind 必须是 "workspace" 或 "project"'));
    }

    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    if (!ws || !ws.data) {
      return Promise.reject(new Error('exportPackage: 当前工作区未初始化或无数据'));
    }

    var attStore = typeof AttachmentStore !== 'undefined' ? AttachmentStore : null;
    if (!attStore || typeof attStore.get !== 'function') {
      return Promise.reject(new Error('exportPackage: AttachmentStore 未就绪'));
    }

    // 在写锁保护下冻结快照，防止导出期间任何并发写操作污染快照
    return ws.withWriteLock('exportPackage:' + kind, async function(lockToken) {
      var payload = null;
      var metasToExport = [];
      var projectCount = 0;

      if (kind === 'workspace') {
        var frozenWs = sanitizeWorkspacePayload(ws.data);
        payload = frozenWs;
        projectCount = Array.isArray(frozenWs.projects) ? frozenWs.projects.length : 0;
        metasToExport = collectAttachmentMetas(frozenWs);
      } else {
        // 单项目导出
        var targetProjId = options.projectId;
        if (!targetProjId && ws.currentProject()) {
          targetProjId = ws.currentProject().id;
        }
        if (!targetProjId) {
          throw new Error('exportPackage: 未指定 projectId 且当前无选中项目');
        }

        var foundProj = null;
        if (Array.isArray(ws.data.projects)) {
          for (var p = 0; p < ws.data.projects.length; p++) {
            if (ws.data.projects[p].id === targetProjId) {
              foundProj = ws.data.projects[p];
              break;
            }
          }
        }
        if (!foundProj) {
          throw new Error('exportPackage: 未找到指定项目: ' + targetProjId);
        }

        var frozenProj = clone(foundProj);
        payload = { project: frozenProj };
        projectCount = 1;
        metasToExport = collectAttachmentMetas(frozenProj);
      }

      // 按 blobKey 去重并逐实体读取二进制内容
      var keyToMeta = new Map();
      metasToExport.forEach(function(meta) {
        if (!keyToMeta.has(meta.blobKey)) {
          keyToMeta.set(meta.blobKey, meta);
        }
      });

      var attachments = [];
      var missingList = [];
      var totalBytes = 0;

      var entries = Array.from(keyToMeta.entries());
      for (var i = 0; i < entries.length; i++) {
        var blobKey = entries[i][0];
        var meta = entries[i][1];

        var blob = await attStore.get(blobKey);
        if (!blob) {
          missingList.push({ blobKey: blobKey, name: meta.name || blobKey });
          continue;
        }

        var buf = await blob.arrayBuffer();
        var bytes = new Uint8Array(buf);

        // 校验声明长度与实际 bytes
        if (typeof meta.size === 'number' && meta.size !== bytes.byteLength) {
          console.warn('导出警告：附件声明大小与实际字节不符: ' + meta.name + ' (声明: ' + meta.size + ', 实际: ' + bytes.byteLength + ')');
        }

        var base64Str = uint8ArrayToBase64(bytes);
        attachments.push({
          key: blobKey,
          name: meta.name || blobKey,
          type: meta.type || (blob && blob.type) || 'application/octet-stream',
          size: bytes.byteLength,
          base64: base64Str
        });
        totalBytes += bytes.byteLength;
      }

      // 缺失附件实体时明确列出清单并拒绝完整导出
      if (missingList.length > 0) {
        var listStr = missingList.map(function(m) {
          return m.name + ' (' + m.blobKey + ')';
        }).join(', ');
        throw new Error('导出失败：附件实体缺失，拒绝完整导出。缺失清单: ' + listStr);
      }

      var pkg = {
        backupVersion: BACKUP_VERSION,
        kind: kind,
        exportedAt: new Date().toISOString(),
        payload: payload,
        attachments: attachments,
        summary: {
          projectCount: projectCount,
          attachmentCount: attachments.length,
          totalBytes: totalBytes
        }
      };

      return pkg;
    });
  }

  /**
   * 全内存包校验与预览
   * Backup.validatePackage(pkg) -> { valid, errors, preview }
   */
  function validatePackage(pkg) {
    var errors = [];
    var preview = {
      kind: null,
      projectCount: 0,
      projects: [],
      attachmentCount: 0,
      totalBytes: 0,
      recycleBinCount: 0,
      missingAttachments: [],
      invalidReferences: []
    };

    if (!pkg || typeof pkg !== 'object') {
      errors.push('备份包必须是非空对象');
      return { valid: false, errors: errors, preview: preview };
    }

    if (typeof pkg.backupVersion !== 'number') {
      errors.push('备份包缺少有效的 backupVersion');
    } else if (pkg.backupVersion > BACKUP_VERSION) {
      errors.push('数据版本过新（v' + pkg.backupVersion + '），请升级软件。当前支持最高版本：v' + BACKUP_VERSION);
    }

    if (pkg.kind !== 'workspace' && pkg.kind !== 'project') {
      errors.push('未知的备份类型: ' + pkg.kind);
    }
    preview.kind = pkg.kind;

    if (!pkg.payload || typeof pkg.payload !== 'object') {
      errors.push('备份包缺少有效 payload');
      return { valid: false, errors: errors, preview: preview };
    }

    if (!Array.isArray(pkg.attachments)) {
      errors.push('备份包缺少 attachments 数组');
      return { valid: false, errors: errors, preview: preview };
    }

    // 校验附件列表中的每一个实体及 base64 解码有效性
    var availableBlobKeys = new Set();
    var attMetaValidator = typeof AttachmentMeta !== 'undefined' ? AttachmentMeta : null;
    var maxSingleSize = (attMetaValidator && attMetaValidator.MAX_SIZE) || (10 * 1024 * 1024);

    for (var a = 0; a < pkg.attachments.length; a++) {
      var att = pkg.attachments[a];
      if (!att || typeof att !== 'object') {
        errors.push('attachments[' + a + '] 必须是对象');
        continue;
      }
      if (!att.key || typeof att.key !== 'string') {
        errors.push('attachments[' + a + '] 缺少合法 key');
      } else if (availableBlobKeys.has(att.key)) {
        errors.push('attachments[' + a + '] 存在重复的附件 key: ' + att.key);
      } else {
        availableBlobKeys.add(att.key);
      }

      if (typeof att.name !== 'string' || !att.name.trim()) {
        errors.push('attachments[' + a + '] 缺少合法 name');
      } else if (att.name.length > 255) {
        errors.push('attachments[' + a + '] name 超过 255 字符');
      } else if (/[\/\\\u0000-\u001f\u007f]/.test(att.name)) {
        errors.push('attachments[' + a + '] name 包含非法字符');
      }

      if (typeof att.size !== 'number' || att.size < 0) {
        errors.push('attachments[' + a + '] size 必须为非负整数');
      } else if (att.size > maxSingleSize) {
        errors.push('附件「' + att.name + '」超过单文件上限（10 MB）');
      }

      if (attMetaValidator && Array.isArray(attMetaValidator.ALLOWED_TYPES)) {
        if (attMetaValidator.ALLOWED_TYPES.indexOf(att.type) === -1) {
          errors.push('附件「' + att.name + '」文件类型不支持: ' + att.type);
        }
      }

      if (typeof att.base64 !== 'string') {
        errors.push('attachments[' + a + '] 缺少 base64 内容');
      } else if (!BASE64_REGEX.test(att.base64)) {
        errors.push('附件「' + (att.name || att.key || a) + '」Base64 包含非法字符或格式不规范');
      } else {
        try {
          var decoded = base64ToUint8Array(att.base64);
          if (typeof att.size === 'number' && decoded.byteLength !== att.size) {
            errors.push('附件「' + att.name + '」解码字节数（' + decoded.byteLength + '）与声明大小（' + att.size + '）不符');
          }
        } catch (decErr) {
          errors.push('附件「' + att.name + '」Base64 解析失败: ' + decErr.message);
        }
      }
    }

    preview.attachmentCount = pkg.attachments.length;
    preview.totalBytes = pkg.attachments.reduce(function(acc, item) {
      return acc + (item.size || 0);
    }, 0);

    // 校验实体与引用完整性
    var projectsToValidate = [];
    if (pkg.kind === 'workspace') {
      if (!Array.isArray(pkg.payload.projects)) {
        errors.push('全量备份 payload 缺少 projects 数组');
      } else {
        projectsToValidate = pkg.payload.projects;
      }
      if (Array.isArray(pkg.payload.recycleBin)) {
        preview.recycleBinCount = pkg.payload.recycleBin.length;
      }
    } else {
      var singleProj = pkg.payload.project || pkg.payload;
      if (singleProj && typeof singleProj === 'object') {
        projectsToValidate = [singleProj];
      } else {
        errors.push('单项目备份 payload 缺少 project 数据');
      }
    }

    preview.projectCount = projectsToValidate.length;

    var projectIdSet = new Set();
    var projectOptionMaps = new Map();

    projectsToValidate.forEach(function(proj, pIndex) {
      if (!proj || typeof proj !== 'object') {
        errors.push('projects[' + pIndex + '] 必须是对象');
        return;
      }
      if (proj.id) {
        if (projectIdSet.has(proj.id)) {
          errors.push('存在重复的项目 ID: ' + proj.id);
        } else {
          projectIdSet.add(proj.id);
        }
      }
      var pName = proj.name || '未命名项目';
      var pData = proj.data || {};
      var tasks = Array.isArray(pData.tasks) ? pData.tasks : [];
      var atts = Array.isArray(pData.attachments) ? pData.attachments : [];

      preview.projects.push({
        id: proj.id,
        name: pName,
        taskCount: tasks.length,
        attachmentCount: atts.length
      });

      // 任务 ID 索引、去重与内部引用检查
      var taskIdSet = new Set();
      tasks.forEach(function(t, tIndex) {
        if (!t || typeof t !== 'object') return;
        if (!t.id) {
          errors.push('项目「' + pName + '」任务[' + tIndex + '] 缺少合法 ID');
          return;
        }
        if (taskIdSet.has(t.id)) {
          errors.push('项目「' + pName + '」存在重复的任务 ID: ' + t.id);
        } else {
          taskIdSet.add(t.id);
        }
      });

      // 收集该项目自定义列中的合法选项 ID
      var validOptionMap = new Map();
      if (pData.settings && Array.isArray(pData.settings.columns)) {
        pData.settings.columns.forEach(function(col) {
          if (col && col.type === 'select' && Array.isArray(col.options)) {
            var optSet = new Set();
            col.options.forEach(function(opt) {
              if (opt && opt.id) optSet.add(opt.id);
            });
            validOptionMap.set(col.key, optSet);
          }
        });
      }
      if (proj.id) {
        projectOptionMaps.set(proj.id, validOptionMap);
      }

      tasks.forEach(function(t) {
        if (t && t.parentId !== null && t.parentId !== undefined && t.parentId !== '') {
          if (!taskIdSet.has(t.parentId)) {
            var badRef = '任务「' + (t.name || t.id) + '」引用了不存在的父级: ' + t.parentId;
            errors.push(badRef);
            preview.invalidReferences.push(badRef);
          }
        }
        if (t && t.customFields && typeof t.customFields === 'object') {
          Object.keys(t.customFields).forEach(function(cKey) {
            if (validOptionMap.has(cKey)) {
              var optVal = t.customFields[cKey];
              if (optVal !== null && optVal !== undefined && optVal !== '') {
                var allowedSet = validOptionMap.get(cKey);
                if (!allowedSet.has(optVal)) {
                  var badOptMsg = '任务「' + (t.name || t.id) + '」引用了不存在的列选项 ID: ' + optVal + ' (列: ' + cKey + ')';
                  errors.push(badOptMsg);
                  preview.invalidReferences.push(badOptMsg);
                }
              }
            }
          });
        }
      });

      // 依赖 source / target
      if (Array.isArray(pData.links)) {
        pData.links.forEach(function(l) {
          if (l) {
            if (!taskIdSet.has(l.source) || !taskIdSet.has(l.target)) {
              var badLink = '依赖 ' + l.id + ' 引用了不存在的任务';
              errors.push(badLink);
              preview.invalidReferences.push(badLink);
            }
          }
        });
      }

      // 里程碑与评论
      if (Array.isArray(pData.milestones)) {
        pData.milestones.forEach(function(m) {
          if (m && !taskIdSet.has(m.taskId)) {
            var badMs = '里程碑 ' + m.id + ' 引用了不存在的任务: ' + m.taskId;
            errors.push(badMs);
            preview.invalidReferences.push(badMs);
          }
        });
      }
      if (Array.isArray(pData.comments)) {
        pData.comments.forEach(function(c) {
          if (c && !taskIdSet.has(c.taskId)) {
            var badComm = '评论 ' + c.id + ' 引用了不存在的任务: ' + c.taskId;
            errors.push(badComm);
            preview.invalidReferences.push(badComm);
          }
        });
      }

      // 附件实体与 taskId
      atts.forEach(function(att) {
        if (!att) return;
        if (!taskIdSet.has(att.taskId)) {
          var badAttTask = '附件 ' + att.id + ' 引用了不存在的任务: ' + att.taskId;
          errors.push(badAttTask);
          preview.invalidReferences.push(badAttTask);
        }
        if (!availableBlobKeys.has(att.blobKey)) {
          var missingBlob = '附件「' + (att.name || att.id) + '」实体数据缺失 (blobKey: ' + att.blobKey + ')';
          errors.push(missingBlob);
          preview.missingAttachments.push({ id: att.id, name: att.name, blobKey: att.blobKey });
        }
      });
    });

    // 校验回收站中的附件与列选项引用
    if (pkg.kind === 'workspace' && Array.isArray(pkg.payload.recycleBin)) {
      pkg.payload.recycleBin.forEach(function(batch) {
        if (!batch || !batch.snapshot) return;
        var pOptMap = batch.projectId ? projectOptionMaps.get(batch.projectId) : null;
        if (pOptMap && Array.isArray(batch.snapshot.tasks)) {
          batch.snapshot.tasks.forEach(function(t) {
            if (t && t.customFields && typeof t.customFields === 'object') {
              Object.keys(t.customFields).forEach(function(cKey) {
                if (pOptMap.has(cKey)) {
                  var optVal = t.customFields[cKey];
                  if (optVal !== null && optVal !== undefined && optVal !== '') {
                    if (!pOptMap.get(cKey).has(optVal)) {
                      var badRecycleOpt = '回收站任务「' + (t.name || t.id) + '」引用了不存在的列选项 ID: ' + optVal;
                      errors.push(badRecycleOpt);
                      preview.invalidReferences.push(badRecycleOpt);
                    }
                  }
                }
              });
            }
          });
        }
        if (Array.isArray(batch.snapshot.attachments)) {
          batch.snapshot.attachments.forEach(function(att) {
            if (att && !availableBlobKeys.has(att.blobKey)) {
              var miss = '回收站任务批次附件「' + (att.name || att.id) + '」实体数据缺失 (blobKey: ' + att.blobKey + ')';
              errors.push(miss);
              preview.missingAttachments.push({ id: att.id, name: att.name, blobKey: att.blobKey });
            }
          });
        }
        if (batch.snapshot.data && Array.isArray(batch.snapshot.data.attachments)) {
          batch.snapshot.data.attachments.forEach(function(att) {
            if (att && !availableBlobKeys.has(att.blobKey)) {
              var missProj = '回收站项目批次附件「' + (att.name || att.id) + '」实体数据缺失 (blobKey: ' + att.blobKey + ')';
              errors.push(missProj);
              preview.missingAttachments.push({ id: att.id, name: att.name, blobKey: att.blobKey });
            }
          });
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      preview: preview
    };
  }

  /**
   * 安全导入与提交
   * Backup.importPackage(pkg, { target: 'new-project'|'replace-workspace', confirmed: boolean }) -> Promise<void>
   */
  async function importPackage(pkg, options) {
    options = options || {};
    if (options.confirmed !== true) {
      throw new Error('导入操作未确认，禁止执行写入');
    }

    // 1. 全内存严格校验结构与所有引用
    var check = validatePackage(pkg);
    if (!check.valid) {
      throw new Error('导入失败：数据包校验未通过。\n' + check.errors.join('\n'));
    }

    var target = (options.target === undefined)
      ? (pkg.kind === 'workspace' ? 'replace-workspace' : 'new-project')
      : options.target;
    if (target !== 'new-project' && target !== 'replace-workspace') {
      throw new Error('未知的导入目标类型: ' + target);
    }
    if (target === 'replace-workspace' && pkg.kind !== 'workspace') {
      throw new Error('导入失败：单项目备份包不支持作为全量工作区替换');
    }

    var ws = typeof Workspace !== 'undefined' ? Workspace : null;
    if (!ws) {
      throw new Error('importPackage: Workspace 未定义');
    }

    if (target === 'new-project' && (!ws.data || typeof ws.data !== 'object')) {
      throw new Error('导入新项目失败：当前工作区未初始化');
    }

    // 若当前工作区只读（损坏原文或更高版本），仅全量已确认替换允许作为修复恢复路径
    if (ws.isReadOnly() && target !== 'replace-workspace') {
      throw new Error('当前工作区处于只读状态，禁止导入新项目');
    }

    var attStore = typeof AttachmentStore !== 'undefined' ? AttachmentStore : null;
    if (!attStore || typeof attStore.put !== 'function') {
      throw new Error('importPackage: AttachmentStore 未就绪');
    }

    return await ws.withWriteLock('importPackage:' + target, async function(lockToken) {
      // 2. 映射表：旧 blobKey -> 本次独有的全新 stagedBlobKey（绝不覆旧键）
      var oldBlobKeyToStaged = new Map();
      for (var a = 0; a < pkg.attachments.length; a++) {
        var origKey = pkg.attachments[a].key;
        if (!oldBlobKeyToStaged.has(origKey)) {
          var stagedKey = generateId('blob-import');
          oldBlobKeyToStaged.set(origKey, stagedKey);
        }
      }

      // 3. 预写入暂存附件到真实 IDB，并逐一完成读回一致性校验
      var stagedKeysCreated = [];
      try {
        for (var i = 0; i < pkg.attachments.length; i++) {
          var attItem = pkg.attachments[i];
          var sKey = oldBlobKeyToStaged.get(attItem.key);
          var bytes = base64ToUint8Array(attItem.base64);
          var blobObj = createBlobFromBytes(bytes, attItem.type);

          await attStore.put(sKey, blobObj, {
            size: bytes.byteLength,
            type: attItem.type
          });
          stagedKeysCreated.push(sKey);

          // 读回确认持久化与字节一致
          var readBack = await attStore.get(sKey);
          if (!readBack) {
            throw new Error('暂存附件持久化读回失败: ' + attItem.name);
          }
          var rbBuf = await readBack.arrayBuffer();
          var rbBytes = new Uint8Array(rbBuf);
          if (rbBytes.byteLength !== bytes.byteLength) {
            throw new Error('暂存附件读回字节数不符: ' + attItem.name);
          }
          for (var bIdx = 0; bIdx < bytes.byteLength; bIdx++) {
            if (rbBytes[bIdx] !== bytes[bIdx]) {
              throw new Error('暂存附件读回字节内容不一致: ' + attItem.name);
            }
          }
        }
      } catch (stagingErr) {
        // 提交前任何失败：清理本次暂存的新键，旧主数据原文与旧附件完好无损
        await Promise.allSettled(stagedKeysCreated.map(function(k) {
          return attStore.delete(k);
        }));
        throw stagingErr;
      }

      // 4. 重映射业务 ID 与引用
      var nextWorkspaceData = null;
      var activatedProjectId = null;

      if (target === 'new-project') {
        var sourceProj = pkg.payload.project || (Array.isArray(pkg.payload.projects) ? pkg.payload.projects[0] : pkg.payload);
        var projClone = clone(sourceProj);

        var newProjectId = generateId('proj');
        projClone.id = newProjectId;
        projClone.createdAt = new Date().toISOString();
        projClone.updatedAt = new Date().toISOString();
        projClone.status = 'active';
        projClone.archived = false;

        var pData = projClone.data || {};
        var taskIdMap = new Map();
        var tasks = Array.isArray(pData.tasks) ? pData.tasks : [];

        // 任务 ID 重映射
        tasks.forEach(function(t) {
          var newTid = generateId('task');
          taskIdMap.set(t.id, newTid);
          t.id = newTid;
        });
        tasks.forEach(function(t) {
          if (t.parentId && taskIdMap.has(t.parentId)) {
            t.parentId = taskIdMap.get(t.parentId);
          } else if (t.parentId) {
            t.parentId = null;
          }
        });

        // 里程碑重映射
        if (Array.isArray(pData.milestones)) {
          pData.milestones.forEach(function(m) {
            m.id = generateId('ms');
            if (taskIdMap.has(m.taskId)) m.taskId = taskIdMap.get(m.taskId);
          });
        }

        // 依赖重映射
        if (Array.isArray(pData.links)) {
          pData.links.forEach(function(l) {
            l.id = generateId('link');
            if (taskIdMap.has(l.source)) l.source = taskIdMap.get(l.source);
            if (taskIdMap.has(l.target)) l.target = taskIdMap.get(l.target);
          });
        }

        // 评论重映射
        if (Array.isArray(pData.comments)) {
          pData.comments.forEach(function(c) {
            c.id = generateId('comm');
            if (taskIdMap.has(c.taskId)) c.taskId = taskIdMap.get(c.taskId);
          });
        }

        // 活动重映射
        if (Array.isArray(pData.activity)) {
          pData.activity.forEach(function(act) {
            act.id = generateId('act');
            if (taskIdMap.has(act.taskId)) act.taskId = taskIdMap.get(act.taskId);
          });
        }

        // 自定义列选项 ID 重映射与任务值同步
        var optionIdMap = new Map();
        if (pData.settings && Array.isArray(pData.settings.columns)) {
          pData.settings.columns.forEach(function(col) {
            if (Array.isArray(col.options)) {
              col.options.forEach(function(opt) {
                var newOptId = generateId('opt');
                optionIdMap.set(opt.id, newOptId);
                opt.id = newOptId;
              });
            }
          });
        }

        if (optionIdMap.size > 0) {
          tasks.forEach(function(t) {
            if (t && t.customFields && typeof t.customFields === 'object') {
              Object.keys(t.customFields).forEach(function(k) {
                var val = t.customFields[k];
                if (typeof val === 'string' && optionIdMap.has(val)) {
                  t.customFields[k] = optionIdMap.get(val);
                }
              });
            }
          });
        }

        // 附件重映射（ID 与 blobKey）
        if (Array.isArray(pData.attachments)) {
          pData.attachments.forEach(function(att) {
            att.id = generateId('att');
            if (taskIdMap.has(att.taskId)) att.taskId = taskIdMap.get(att.taskId);
            if (oldBlobKeyToStaged.has(att.blobKey)) {
              att.blobKey = oldBlobKeyToStaged.get(att.blobKey);
            }
          });
        }

        // 挂载到现有工作区（保留全局偏好与既有项目）
        nextWorkspaceData = clone(ws.data);
        if (!Array.isArray(nextWorkspaceData.projects)) nextWorkspaceData.projects = [];
        nextWorkspaceData.projects.push(projClone);
        activatedProjectId = newProjectId;

      } else {
        // replace-workspace
        var wsPayloadClone = clone(pkg.payload);

        // 重映射所有项目的附件 blobKey
        if (Array.isArray(wsPayloadClone.projects)) {
          wsPayloadClone.projects.forEach(function(proj) {
            if (proj && proj.data && Array.isArray(proj.data.attachments)) {
              proj.data.attachments.forEach(function(att) {
                if (att && oldBlobKeyToStaged.has(att.blobKey)) {
                  att.blobKey = oldBlobKeyToStaged.get(att.blobKey);
                }
              });
            }
          });
        }

        // 重映射回收站中的附件 blobKey
        if (Array.isArray(wsPayloadClone.recycleBin)) {
          wsPayloadClone.recycleBin.forEach(function(batch) {
            if (!batch || !batch.snapshot) return;
            if (Array.isArray(batch.snapshot.attachments)) {
              batch.snapshot.attachments.forEach(function(att) {
                if (att && oldBlobKeyToStaged.has(att.blobKey)) {
                  att.blobKey = oldBlobKeyToStaged.get(att.blobKey);
                }
              });
            }
            if (batch.snapshot.data && Array.isArray(batch.snapshot.data.attachments)) {
              batch.snapshot.data.attachments.forEach(function(att) {
                if (att && oldBlobKeyToStaged.has(att.blobKey)) {
                  att.blobKey = oldBlobKeyToStaged.get(att.blobKey);
                }
              });
            }
          });
        }

        nextWorkspaceData = wsPayloadClone;
      }

      // 5. 在写锁保护下，执行主数据的一次持久化写入（提交点）
      try {
        ws.commit(nextWorkspaceData, {
          lockToken: lockToken,
          recoveryConfirmed: (target === 'replace-workspace')
        });
      } catch (commitErr) {
        // 提交主数据失败：清理本次暂存的新键，旧主数据原文与旧附件完好无损
        await Promise.allSettled(stagedKeysCreated.map(function(k) {
          return attStore.delete(k);
        }));
        throw commitErr;
      }

      // 6. 提交点已达成：更新当前激活项目与撤销历史栈
      // 提交后任何后续错误绝不得伪报未提交而回滚或删除已生效的附件
      try {
        if (activatedProjectId) {
          ws.activate(activatedProjectId, { keepLastProjectId: true });
        } else if (target === 'replace-workspace') {
          var startId = ws.resolveStartup();
          if (startId) {
            ws.activate(startId);
          } else if (Array.isArray(ws.data.projects) && ws.data.projects.length > 0) {
            ws.activate(ws.data.projects[0].id);
          } else {
            ws.activate(null);
          }
        }

        var tm = typeof TaskManager !== 'undefined' ? TaskManager : null;
        var histMod = typeof History !== 'undefined' ? History : null;
        if (tm && histMod) {
          tm.history = histMod.create();
        }
      } catch (postCommitErr) {
        console.error('导入后状态切换告警:', postCommitErr);
      }
    });
  }

  return {
    BACKUP_VERSION: BACKUP_VERSION,
    exportPackage: exportPackage,
    validatePackage: validatePackage,
    importPackage: importPackage
  };
})();

if (typeof module === 'object' && module && module.exports) {
  module.exports = Backup;
}
if (typeof globalThis !== 'undefined') {
  globalThis.Backup = Backup;
}
