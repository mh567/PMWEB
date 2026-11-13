// ============================================================
// ShareManager: 项目只读分享、服务端审计日志查看与打印控制
// ============================================================
var ShareManager = (function() {
  'use strict';

  var STORAGE_KEY = 'pmweb_share_links';
  var forcedReadonly = false;
  var storage = null;

  // 纯 JavaScript SHA-256 实现，无需外部依赖，同步可用
  function pureSha256(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var lengthProperty = 'length';
    var i, j;
    var result = '';
    var words = [];
    var asciiBitLength = ascii[lengthProperty] * 8;
    var hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    var k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    var compositeBitLength = asciiBitLength;
    ascii += '\x80';
    while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
      j = ascii.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words[lengthProperty]] = ((compositeBitLength / maxWord) | 0);
    words[words[lengthProperty]] = (compositeBitLength);

    for (j = 0; j < words[lengthProperty];) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);

      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
        var s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
        var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
        var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
        var temp1 = (hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + (
          i < 16 ? w[i] : (
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
          )
        )) | 0;
        var temp2 = ((rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj) | 0;

        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }

      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }

    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16 ? '0' : '') + b.toString(16));
      }
    }
    return result;
  }

  function hashToken(token) {
    if (typeof token !== 'string') return '';
    if (typeof require === 'function') {
      try {
        var nodeCrypto = require('crypto');
        if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
          return nodeCrypto.createHash('sha256').update(token).digest('hex');
        }
      } catch (e) {}
    }
    return pureSha256(token);
  }

  function generateToken() {
    var chars = '0123456789abcdef';
    var res = '';
    for (var i = 0; i < 32; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  }

  function resolveStorage(options) {
    if (options && options.storage) return options.storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }

  function getStoredLinks() {
    if (!storage) return [];
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  }

  function saveStoredLinks(links) {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(links));
    } catch (e) {}
  }

  function createShareLink(options) {
    options = options || {};
    var projId = options.projectId || 'default';
    var token = generateToken();
    var tokenHash = hashToken(token);
    var now = new Date();
    var expiresAt = null;

    if (typeof options.expiresInDays === 'number' && options.expiresInDays > 0) {
      var exp = new Date(now.getTime() + options.expiresInDays * 24 * 3600 * 1000);
      expiresAt = exp.toISOString();
    }

    var link = {
      id: 'share-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      projectId: projId,
      token: token,
      tokenHash: tokenHash,
      role: 'viewer',
      scope: options.scope || {},
      note: options.note || '只读访客分享',
      createdAt: now.toISOString(),
      expiresAt: expiresAt,
      revokedAt: null
    };

    var list = getStoredLinks();
    list.unshift(link);
    saveStoredLinks(list);

    var baseUrl = '';
    if (typeof window !== 'undefined' && window.location) {
      baseUrl = window.location.origin + window.location.pathname;
    }
    link.url = baseUrl + '?share=' + encodeURIComponent(token);
    return link;
  }

  function listShareLinks(projectId) {
    var list = getStoredLinks();
    if (!projectId) return list.slice();
    return list.filter(function(l) { return l.projectId === projectId; });
  }

  function revokeShareLink(linkId) {
    var list = getStoredLinks();
    var target = null;
    list.forEach(function(l) {
      if (l.id === linkId) {
        l.revokedAt = new Date().toISOString();
        target = l;
      }
    });
    if (target) saveStoredLinks(list);
    return target;
  }

  function validateToken(token, projectId) {
    if (!token || typeof token !== 'string') {
      return { valid: false, link: null, reason: '缺少令牌' };
    }
    var tokenH = hashToken(token);
    var list = getStoredLinks();
    var matched = null;

    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.token === token || it.tokenHash === tokenH) {
        if (!projectId || it.projectId === projectId) {
          matched = it;
          break;
        }
      }
    }

    if (!matched) {
      return { valid: false, link: null, reason: '分享链接不存在' };
    }
    if (matched.revokedAt) {
      return { valid: false, link: matched, reason: '该分享链接已被撤销' };
    }
    if (matched.expiresAt) {
      var expTime = new Date(matched.expiresAt).getTime();
      if (!isNaN(expTime) && Date.now() > expTime) {
        return { valid: false, link: matched, reason: '该分享链接已过期' };
      }
    }
    return { valid: true, link: matched, reason: null };
  }

  function isReadonly() {
    if (forcedReadonly) return true;
    if (typeof window === 'undefined' || !window.location || !window.location.search) {
      return false;
    }
    var search = window.location.search;
    if (search.indexOf('readonly=1') !== -1) return true;
    if (search.indexOf('share=') !== -1) return true;
    return false;
  }

  function setReadonly(val) {
    forcedReadonly = !!val;
    if (typeof document !== 'undefined') {
      applyReadonlyMode();
    }
  }

  function applyReadonlyMode() {
    if (typeof document === 'undefined') return;
    var ro = isReadonly();
    var banner = document.getElementById('readonly-banner');

    if (ro) {
      document.body.classList.add('readonly-mode');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'readonly-banner';
        banner.className = 'active';
        banner.innerHTML = '<div class="banner-text"><span>🔒 只读分享预览模式（编辑与导入已被锁定）</span></div>' +
          '<div class="banner-actions">' +
            '<button class="btn btn-primary" id="btn-print-banner">打印 / 导出PDF</button>' +
          '</div>';
        document.body.insertBefore(banner, document.body.firstChild);
        var printBtn = banner.querySelector('#btn-print-banner');
        if (printBtn) {
          printBtn.addEventListener('click', function() { print(); });
        }
      } else {
        banner.className = 'active';
      }

      // 隐藏或禁用写入口控件
      var hideIds = [
        'btn-add-root-task',
        'btn-import',
        'btn-undo',
        'btn-redo',
        'btn-work-calendar',
        'btn-auto-schedule'
      ];
      hideIds.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      // 禁用行内编辑：挂钩 GridPane._startEdit
      if (typeof GridPane !== 'undefined' && GridPane) {
        GridPane._readonly = true;
      }
      // 禁用拖拽排期：挂钩 DragManager
      if (typeof DragManager !== 'undefined' && DragManager) {
        DragManager.enabled = false;
      }
    } else {
      document.body.classList.remove('readonly-mode');
      if (banner) banner.className = '';
    }
  }

  function getAuditLogs(filter) {
    filter = filter || {};
    var raw = [];
    if (typeof TaskManager !== 'undefined' && TaskManager && TaskManager.data) {
      raw = TaskManager.data.activity || [];
    }

    var result = raw.slice().map(function(item) {
      var fieldName = item.field || '';
      var fieldLabel = fieldName;
      if (fieldName === 'name') fieldLabel = '任务名称';
      else if (fieldName === 'status') fieldLabel = '任务状态';
      else if (fieldName === 'progress') fieldLabel = '进度百分比';
      else if (fieldName === 'startDate') fieldLabel = '开始日期';
      else if (fieldName === 'endDate') fieldLabel = '完成日期';
      else if (fieldName === 'assignee') fieldLabel = '负责人';

      var detail = '';
      if (item.before !== undefined || item.after !== undefined) {
        detail = String(item.before === null ? '无' : item.before) + ' ➔ ' +
                 String(item.after === null ? '无' : item.after);
      }

      return {
        id: item.id,
        taskId: item.taskId,
        actor: item.actor || '本地操作者',
        action: item.action || 'update',
        field: fieldName,
        fieldLabel: fieldLabel,
        before: item.before,
        after: item.after,
        detail: detail,
        at: item.at || new Date().toISOString()
      };
    });

    if (filter.taskId) {
      result = result.filter(function(it) { return it.taskId === filter.taskId; });
    }
    if (filter.action) {
      result = result.filter(function(it) { return it.action === filter.action; });
    }

    // 按时间倒序（最新在最前面）
    result.sort(function(a, b) {
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    });
    return result;
  }

  function print() {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  }

  function buildShareModalHtml() {
    var links = listShareLinks();
    var auditLogs = getAuditLogs();

    var linksRowsHtml = '';
    if (links.length === 0) {
      linksRowsHtml = '<tr><td colspan="4" style="text-align:center;color:var(--color-slate);padding:14px;">暂无历史分享链接</td></tr>';
    } else {
      links.forEach(function(l) {
        var statusText = l.revokedAt ? '已撤销' : (l.expiresAt && new Date(l.expiresAt).getTime() < Date.now() ? '已过期' : '有效');
        var expText = l.expiresAt ? l.expiresAt.slice(0, 10) : '永久有效';
        var actionBtn = l.revokedAt ? '' : '<button class="btn btn-danger btn-sm" data-revoke-id="' + l.id + '" style="padding:2px 8px;font-size:11px;">撤销</button>';
        linksRowsHtml += '<tr>' +
          '<td><code>' + l.token.slice(0, 8) + '...</code></td>' +
          '<td>' + expText + '</td>' +
          '<td>' + statusText + '</td>' +
          '<td>' + actionBtn + '</td>' +
        '</tr>';
      });
    }

    var auditRowsHtml = '';
    if (auditLogs.length === 0) {
      auditRowsHtml = '<tr><td colspan="5" style="text-align:center;color:var(--color-slate);padding:14px;">暂无审计日志记录</td></tr>';
    } else {
      auditLogs.slice(0, 20).forEach(function(log) {
        var timeStr = log.at ? log.at.slice(5, 19).replace('T', ' ') : '';
        auditRowsHtml += '<tr>' +
          '<td>' + timeStr + '</td>' +
          '<td>' + log.actor + '</td>' +
          '<td><span class="audit-badge ' + log.action + '">' + log.action + '</span></td>' +
          '<td>' + log.fieldLabel + '</td>' +
          '<td class="audit-diff" title="' + log.detail + '">' + log.detail + '</td>' +
        '</tr>';
      });
    }

    return '<div class="share-modal-box">' +
      '<h2 class="modal-title">项目分享与审计日志</h2>' +
      '<div class="sync-modal-body">' +

      // 分享链接创建卡片
      '<div class="sync-card">' +
        '<div class="sync-card-title">创建只读分享链接</div>' +
        '<div style="display:flex;gap:10px;align-items:flex-end;">' +
          '<div class="modal-field" style="margin-bottom:0;flex:1;">' +
            '<label for="share-expires-select">有效期</label>' +
            '<select id="share-expires-select">' +
              '<option value="7">7 天</option>' +
              '<option value="30">30 天</option>' +
              '<option value="0">永久有效</option>' +
            '</select>' +
          '</div>' +
          '<button class="btn btn-primary" id="btn-create-share-link">生成分享链接</button>' +
        '</div>' +
        '<div id="share-link-result-box" style="display:none;margin-top:10px;">' +
          '<label style="font-size:12px;font-weight:500;">只读链接地址（带高熵凭证）：</label>' +
          '<div class="share-link-input-group">' +
            '<input type="text" id="share-link-url" readonly>' +
            '<button class="btn" id="btn-copy-share-url">复制</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // 历史分享链接管理
      '<div class="sync-card">' +
        '<div class="sync-card-title">已生成的分享链接</div>' +
        '<div class="audit-list-container" style="max-height:160px;">' +
          '<table class="audit-table">' +
            '<thead><tr><th>凭证</th><th>到期时间</th><th>状态</th><th>操作</th></tr></thead>' +
            '<tbody id="share-links-tbody">' + linksRowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      // 审计日志表格
      '<div class="sync-card">' +
        '<div class="sync-card-title">操作变更审计日志 (最近 20 条)</div>' +
        '<div class="audit-list-container">' +
          '<table class="audit-table">' +
            '<thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>字段</th><th>变更明细</th></tr></thead>' +
            '<tbody>' + auditRowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '</div>' + // sync-modal-body

      '<div class="modal-actions">' +
        '<button class="btn btn-primary" id="btn-modal-print">一键打印 / 导出PDF</button>' +
        '<button class="btn" id="share-modal-close">关闭</button>' +
      '</div>' +
    '</div>';
  }

  function openModal() {
    if (typeof ModalManager === 'undefined' || !ModalManager) return;
    ModalManager.open(buildShareModalHtml());
    bindModalEvents();
  }

  function bindModalEvents() {
    if (typeof document === 'undefined') return;

    var createBtn = document.getElementById('btn-create-share-link');
    var resBox = document.getElementById('share-link-result-box');
    var urlInput = document.getElementById('share-link-url');
    var copyBtn = document.getElementById('btn-copy-share-url');
    var expSelect = document.getElementById('share-expires-select');

    if (createBtn) {
      createBtn.addEventListener('click', function() {
        var days = expSelect ? parseInt(expSelect.value, 10) : 7;
        var link = createShareLink({ expiresInDays: days });
        if (resBox && urlInput) {
          resBox.style.display = 'block';
          urlInput.value = link.url;
        }
      });
    }

    if (copyBtn && urlInput) {
      copyBtn.addEventListener('click', function() {
        urlInput.select();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(urlInput.value);
          } else {
            document.execCommand('copy');
          }
          copyBtn.textContent = '已复制!';
          setTimeout(function() { copyBtn.textContent = '复制'; }, 1500);
        } catch (e) {
          copyBtn.textContent = '已选中';
        }
      });
    }

    var linksTbody = document.getElementById('share-links-tbody');
    if (linksTbody) {
      linksTbody.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-revoke-id]');
        if (btn) {
          var id = btn.getAttribute('data-revoke-id');
          revokeShareLink(id);
          openModal();
        }
      });
    }

    var printBtn = document.getElementById('btn-modal-print');
    if (printBtn) {
      printBtn.addEventListener('click', function() {
        print();
      });
    }

    var closeBtn = document.getElementById('share-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        if (typeof ModalManager !== 'undefined' && ModalManager) {
          ModalManager.close();
        }
      });
    }
  }

  function init(options) {
    options = options || {};
    storage = resolveStorage(options);

    // 检查只读模式并应用
    if (isReadonly()) {
      applyReadonlyMode();
    }

    // 绑定工具栏按钮
    if (typeof document !== 'undefined') {
      var toolbar = document.getElementById('toolbar');
      if (toolbar) {
        if (!document.getElementById('btn-share')) {
          var shareBtn = document.createElement('button');
          shareBtn.className = 'btn';
          shareBtn.id = 'btn-share';
          shareBtn.title = '分享只读链接与审计日志';
          shareBtn.textContent = '分享与审计';
          shareBtn.addEventListener('click', function() { openModal(); });

          var anchor = document.getElementById('btn-add-root-task');
          if (anchor && toolbar.insertBefore) {
            toolbar.insertBefore(shareBtn, anchor);
          } else {
            toolbar.appendChild(shareBtn);
          }
        }

        if (!document.getElementById('btn-print')) {
          var printBtn = document.createElement('button');
          printBtn.className = 'btn';
          printBtn.id = 'btn-print';
          printBtn.title = '打印或导出为 PDF 文件';
          printBtn.textContent = '打印';
          printBtn.addEventListener('click', function() { print(); });

          var anchor2 = document.getElementById('btn-add-root-task');
          if (anchor2 && toolbar.insertBefore) {
            toolbar.insertBefore(printBtn, anchor2);
          } else {
            toolbar.appendChild(printBtn);
          }
        }
      }
    }
  }

  return {
    init: init,
    generateToken: generateToken,
    hashToken: hashToken,
    createShareLink: createShareLink,
    listShareLinks: listShareLinks,
    revokeShareLink: revokeShareLink,
    validateToken: validateToken,
    isReadonly: isReadonly,
    setReadonly: setReadonly,
    applyReadonlyMode: applyReadonlyMode,
    getAuditLogs: getAuditLogs,
    print: print,
    openModal: openModal,
    buildShareModalHtml: buildShareModalHtml,
    _resetForTesting: function() {
      forcedReadonly = false;
      storage = null;
    }
  };
})();
