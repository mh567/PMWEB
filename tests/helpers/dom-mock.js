'use strict';

function createDomEnvironment() {
  var elements = {};
  var docInstance = null;

  function parseAttributes(attrStr) {
    var attrs = {};
    var re = /([a-zA-Z0-9_\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^ \t\r\n\/>]+)))?/g;
    var match;
    while ((match = re.exec(attrStr)) !== null) {
      var name = match[1];
      var val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : ''));
      attrs[name] = val;
    }
    return attrs;
  }

  var VOID_TAGS = {
    INPUT: true, IMG: true, BR: true, HR: true, META: true, LINK: true
  };

  function makeElement(tag, attrs, text) {
    tag = (tag || 'DIV').toUpperCase();
    attrs = attrs || {};
    var classes = new Set((attrs['class'] || '').split(/\s+/).filter(Boolean));
    var listeners = {};
    var children = [];

    var el = {
      tagName: tag,
      dataset: {},
      style: {},
      _attrs: attrs,
      _listeners: listeners,
      childNodes: children,
      parentNode: null,
      checked: attrs.checked !== undefined,
      disabled: attrs.disabled !== undefined,
      value: attrs.value || '',
      get id() { return attrs.id || ''; },
      set id(val) { attrs.id = String(val); elements[val] = el; },
      classList: {
        add: function(c) { classes.add(c); },
        remove: function(c) { classes.delete(c); },
        toggle: function(c, force) {
          if (force !== undefined) {
            if (force) classes.add(c); else classes.delete(c);
          } else {
            if (classes.has(c)) classes.delete(c); else classes.add(c);
          }
        },
        contains: function(c) { return classes.has(c); }
      },
      get className() { return Array.from(classes).join(' '); },
      set className(val) {
        classes.clear();
        String(val).split(/\s+/).filter(Boolean).forEach(function(c) { classes.add(c); });
      },
      setAttribute: function(k, v) {
        attrs[k] = String(v);
        if (k === 'id') elements[v] = el;
        if (k.indexOf('data-') === 0) {
          var camel = k.slice(5).replace(/-([a-z])/g, function(_, g) { return g.toUpperCase(); });
          el.dataset[camel] = String(v);
        }
      },
      getAttribute: function(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
      },
      removeAttribute: function(k) {
        delete attrs[k];
        if (k === 'id') delete elements[attrs.id];
      },
      hasAttribute: function(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k);
      },
      addEventListener: function(evt, fn) {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(fn);
      },
      removeEventListener: function(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(function(l) { return l !== fn; });
      },
      dispatchEvent: function(event) {
        event = event || {};
        event.target = event.target || el;
        if (event.bubbles === undefined) {
          event.bubbles = (event.type === 'click');
        }
        var stopped = false;
        var prevStop = event.stopPropagation;
        event.stopPropagation = function() {
          stopped = true;
          if (typeof prevStop === 'function') prevStop.call(event);
        };
        if (typeof event.preventDefault !== 'function') event.preventDefault = function() {};

        var cur = el;
        while (cur && !stopped) {
          var list = (cur._listeners && cur._listeners[event.type] || []).slice();
          for (var i = 0; i < list.length; i++) {
            list[i].call(cur, event);
          }
          if (stopped || !event.bubbles) break;
          cur = cur.parentNode;
        }

        if (!stopped && event.bubbles && docInstance && typeof docInstance._dispatchDirect === 'function') {
          docInstance._dispatchDirect(event);
        }
        return true;
      },
      click: function() {
        el.dispatchEvent({ type: 'click', bubbles: true });
      },
      focus: function() {
        if (doc && typeof doc._setFocusedElement === 'function') {
          doc._setFocusedElement(el);
        }
      },
      blur: function() {
        if (doc && typeof doc._setFocusedElement === 'function' && doc.activeElement === el) {
          doc._setFocusedElement(body);
        }
      },
      appendChild: function(c) {
        c.parentNode = el;
        children.push(c);
        return c;
      },
      removeChild: function(c) {
        var idx = children.indexOf(c);
        if (idx !== -1) children.splice(idx, 1);
        c.parentNode = null;
        return c;
      },
      insertBefore: function(newNode, refNode) {
        if (!refNode) return el.appendChild(newNode);
        var idx = children.indexOf(refNode);
        if (idx === -1) return el.appendChild(newNode);
        newNode.parentNode = el;
        children.splice(idx, 0, newNode);
        return newNode;
      },
      querySelector: function(sel) {
        return querySelectorInternal(el, sel);
      },
      querySelectorAll: function(sel) {
        var res = [];
        querySelectorAllInternal(el, sel, res);
        return res;
      },
      closest: function(sel) {
        var cur = el;
        while (cur) {
          if (matches(cur, sel)) return cur;
          cur = cur.parentNode;
        }
        return null;
      },
      contains: function(other) {
        var cur = other;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentNode;
        }
        return false;
      },
      getBoundingClientRect: function() {
        return { top: 10, left: 10, right: 110, bottom: 40, width: 100, height: 30 };
      }
    };

    Object.keys(attrs).forEach(function(k) {
      if (k.indexOf('data-') === 0) {
        var camel = k.slice(5).replace(/-([a-z])/g, function(_, g) { return g.toUpperCase(); });
        el.dataset[camel] = attrs[k];
      }
    });

    if (attrs.id) {
      elements[attrs.id] = el;
    }

    function serializeElement(node) {
      if (!node.childNodes || node.childNodes.length === 0) {
        return node._rawInner || '';
      }
      var res = '';
      for (var i = 0; i < node.childNodes.length; i++) {
        var child = node.childNodes[i];
        if (child.nodeType === 3 || child.tagName === '#TEXT') {
          res += child.textContent;
          continue;
        }
        var tag = child.tagName.toLowerCase();
        var attrsStr = '';
        if (child._attrs) {
          var keys = Object.keys(child._attrs);
          for (var k = 0; k < keys.length; k++) {
            attrsStr += ' ' + keys[k] + '="' + child._attrs[keys[k]] + '"';
          }
        }
        if (VOID_TAGS[child.tagName]) {
          res += '<' + tag + attrsStr + '>';
        } else {
          res += '<' + tag + attrsStr + '>' + serializeElement(child) + '</' + tag + '>';
        }
      }
      return res;
    }

    el._rawInner = text || '';

    // 与浏览器一致：把同组 radio 的 checked 置为 true 时自动取消同组其它单选。
    if (tag === 'INPUT' && attrs.type === 'radio' && attrs.name) {
      var checkedValue = attrs.checked !== undefined;
      Object.defineProperty(el, 'checked', {
        get: function() { return checkedValue; },
        set: function(value) {
          checkedValue = !!value;
          if (!checkedValue || !docInstance) return;
          var group = docInstance.querySelectorAll('input[type="radio"]');
          for (var r = 0; r < group.length; r++) {
            var other = group[r];
            if (other !== el && other.getAttribute && other.getAttribute('name') === attrs.name) {
              other.checked = false;
            }
          }
        }
      });
    }
    Object.defineProperty(el, 'innerHTML', {
      get: function() {
        if (children.length === 0) return el._rawInner;
        return serializeElement(el);
      },
      set: function(html) {
        el._rawInner = html;
        for (var d = 0; d < children.length; d++) {
          if (children[d]) children[d].parentNode = null;
        }
        children.length = 0;
        parseHtmlToDom(html, el);
      }
    });

    Object.defineProperty(el, 'textContent', {
      get: function() {
        if (children.length === 0) return (el._rawInner || '').replace(/<[^>]+>/g, '');
        return children.map(function(c) { return c.textContent; }).join('');
      },
      set: function(txt) {
        el._rawInner = String(txt);
        children.length = 0;
      }
    });

    return el;
  }

  function parseHtmlToDom(html, rootElement) {
    var tokenRe = /<!--[\s\S]*?-->|<([a-zA-Z0-9_\-]+)([^>]*?)(\/?)>|<\/([a-zA-Z0-9_\-]+)>|([^<]+)/g;
    var stack = [rootElement];
    var match;

    while ((match = tokenRe.exec(html)) !== null) {
      if (match[0].indexOf('<!--') === 0) {
        continue;
      }
      var openTag = match[1];
      var attrStr = match[2];
      var selfClosing = match[3];
      var closeTag = match[4];
      var text = match[5];

      var current = stack[stack.length - 1];

      if (openTag) {
        var tagUpper = openTag.toUpperCase();
        var isVoid = Boolean(selfClosing) || Boolean(VOID_TAGS[tagUpper]);
        var attrs = parseAttributes(attrStr || '');
        var el = makeElement(tagUpper, attrs, '');
        current.appendChild(el);
        if (!isVoid) {
          stack.push(el);
        }
      } else if (closeTag) {
        var closeUpper = closeTag.toUpperCase();
        for (var k = stack.length - 1; k > 0; k--) {
          if (stack[k].tagName === closeUpper) {
            stack.splice(k, stack.length - k);
            break;
          }
        }
      } else if (text && text.trim()) {
        current.appendChild({
          tagName: '#TEXT',
          nodeType: 3,
          textContent: text,
          parentNode: current,
          childNodes: []
        });
      }
    }
  }

  function matchesSingle(node, sel) {
    if (!sel || !node || !node.tagName || node.nodeType === 3 || node.tagName === '#TEXT') return false;
    sel = sel.trim();
    if (!sel) return false;

    var attrRe = /\[([a-zA-Z0-9_\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^ \t\r\n\/>\]]+)))?\]/g;
    var attrsToMatch = [];
    var stripped = sel.replace(attrRe, function(_, aName, v1, v2, v3) {
      var val = v1 !== undefined ? v1 : (v2 !== undefined ? v2 : v3);
      attrsToMatch.push({ name: aName, val: val });
      return '';
    });
    for (var i = 0; i < attrsToMatch.length; i++) {
      var a = attrsToMatch[i];
      if (typeof node.hasAttribute !== 'function' || typeof node.getAttribute !== 'function') return false;
      if (a.val === undefined) {
        if (!node.hasAttribute(a.name)) return false;
      } else {
        if (node.getAttribute(a.name) !== a.val) return false;
      }
    }

    var idMatch = stripped.match(/#([a-zA-Z0-9_\-]+)/);
    if (idMatch) {
      if (node.id !== idMatch[1]) return false;
      stripped = stripped.replace(idMatch[0], '');
    }

    var classMatches = stripped.match(/\.([a-zA-Z0-9_\-]+)/g);
    if (classMatches) {
      for (var j = 0; j < classMatches.length; j++) {
        var cls = classMatches[j].slice(1);
        if (!node.classList || !node.classList.contains(cls)) return false;
      }
      stripped = stripped.replace(/\.([a-zA-Z0-9_\-]+)/g, '');
    }

    stripped = stripped.trim();
    if (stripped && stripped !== '*') {
      if (node.tagName.toLowerCase() !== stripped.toLowerCase()) return false;
    }

    return true;
  }

  function matches(node, sel) {
    if (!sel || !node || !node.tagName || node.nodeType === 3 || node.tagName === '#TEXT') return false;
    sel = sel.trim();
    if (sel.indexOf(',') !== -1) {
      var parts = sel.split(',');
      for (var p = 0; p < parts.length; p++) {
        if (matches(node, parts[p].trim())) return true;
      }
      return false;
    }
    return matchesSingle(node, sel);
  }

  function querySelectorInternal(node, sel) {
    if (!sel) return null;
    sel = sel.trim();
    if (sel.indexOf(',') !== -1) {
      var parts = sel.split(',');
      for (var p = 0; p < parts.length; p++) {
        var found = querySelectorInternal(node, parts[p].trim());
        if (found) return found;
      }
      return null;
    }
    var spaceParts = sel.split(/\s+/);
    if (spaceParts.length > 1) {
      var currentNodes = [node];
      for (var s = 0; s < spaceParts.length; s++) {
        var subSel = spaceParts[s];
        var nextNodes = [];
        for (var c = 0; c < currentNodes.length; c++) {
          querySelectorAllInternal(currentNodes[c], subSel, nextNodes);
        }
        if (nextNodes.length === 0) return null;
        currentNodes = nextNodes;
      }
      return currentNodes[0] || null;
    }
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType !== 3 && child.tagName !== '#TEXT') {
        if (matches(child, sel)) return child;
        var f = querySelectorInternal(child, sel);
        if (f) return f;
      }
    }
    return null;
  }

  function querySelectorAllInternal(node, sel, acc) {
    if (!sel) return;
    sel = sel.trim();
    if (sel.indexOf(',') !== -1) {
      var parts = sel.split(',');
      for (var p = 0; p < parts.length; p++) {
        querySelectorAllInternal(node, parts[p].trim(), acc);
      }
      return;
    }
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType !== 3 && child.tagName !== '#TEXT') {
        if (matches(child, sel) && acc.indexOf(child) === -1) {
          acc.push(child);
        }
        querySelectorAllInternal(child, sel, acc);
      }
    }
  }

  var body = makeElement('BODY', { id: 'body' });
  var overlay = makeElement('DIV', { id: 'modal-overlay', class: 'modal-overlay' });
  var modalBox = makeElement('DIV', { id: 'modal-box', class: 'modal-box' });
  overlay.appendChild(modalBox);
  body.appendChild(overlay);

  var docListeners = {};
  var focusedEl = body;

  var doc = {
    nodeType: 9,
    body: body,
    documentElement: makeElement('HTML'),
    get activeElement() {
      return focusedEl;
    },
    _setFocusedElement: function(el) {
      focusedEl = el || body;
    },
    getElementById: function(id) {
      return elements[id] || body.querySelector('#' + id);
    },
    querySelector: function(sel) {
      return body.querySelector(sel);
    },
    querySelectorAll: function(sel) {
      return body.querySelectorAll(sel);
    },
    createElement: function(tag) {
      return makeElement(tag, {});
    },
    addEventListener: function(evt, fn) {
      if (!docListeners[evt]) docListeners[evt] = [];
      docListeners[evt].push(fn);
    },
    removeEventListener: function(evt, fn) {
      if (!docListeners[evt]) return;
      docListeners[evt] = docListeners[evt].filter(function(l) { return l !== fn; });
    },
    _dispatchDirect: function(event) {
      var list = (docListeners[event.type] || []).slice();
      for (var i = 0; i < list.length; i++) {
        list[i].call(doc, event);
      }
    },
    dispatchEvent: function(event) {
      event = event || {};
      event.target = event.target || body;
      if (typeof event.preventDefault !== 'function') event.preventDefault = function() {};
      if (typeof event.stopPropagation !== 'function') event.stopPropagation = function() {};
      this._dispatchDirect(event);
      return true;
    }
  };
  docInstance = doc;

  return {
    doc: doc,
    elements: elements,
    body: body,
    overlay: overlay,
    modalBox: modalBox,
    makeElement: makeElement
  };
}

module.exports = {
  createDomEnvironment: createDomEnvironment
};
