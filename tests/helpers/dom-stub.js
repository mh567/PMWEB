'use strict';

// 轻量 DOM 桩：只覆盖面板测试需要的节点创建、属性、类名、查询和事件。
// 不是完整浏览器实现，不涉及布局、样式计算和 HTML 解析。

function dataAttrToProp(name) {
  if (typeof name !== 'string' || name.length <= 5 || name.slice(0, 5).toLowerCase() !== 'data-') return null;
  return name.slice(5).toLowerCase().replace(/-([a-z0-9])/g, function(_, c) {
    return c.toUpperCase();
  });
}

function matchesSimple(node, selector) {
  selector = selector.trim();
  if (!selector) return false;

  var partRe = /(^[a-zA-Z0-9\-]+)|(\.[a-zA-Z0-9\-_]+)|(#[a-zA-Z0-9\-_]+)|(\[[^\]]+\])/g;
  var parts = selector.match(partRe);
  if (!parts || parts.join('') !== selector) {
    if (selector.charAt(0) === '#') return node.getAttribute('id') === selector.slice(1);
    if (selector.charAt(0) === '.') return node.classList.contains(selector.slice(1));
    return node.tagName.toLowerCase() === selector.toLowerCase();
  }

  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p.charAt(0) === '#') {
      if (node.getAttribute('id') !== p.slice(1)) return false;
    } else if (p.charAt(0) === '.') {
      if (!node.classList.contains(p.slice(1))) return false;
    } else if (p.charAt(0) === '[') {
      var inner = p.slice(1, -1);
      var eq = inner.indexOf('=');
      if (eq !== -1) {
        var key = inner.slice(0, eq).trim();
        var val = inner.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        if (node.getAttribute(key) !== val) return false;
      } else {
        if (!node.hasAttribute(inner.trim())) return false;
      }
    } else {
      if (node.tagName.toLowerCase() !== p.toLowerCase()) return false;
    }
  }
  return true;
}

function walk(node, visit) {
  if (!node || !Array.isArray(node.childNodes)) return;
  node.childNodes.forEach(function(child) {
    visit(child);
    walk(child, visit);
  });
}

function parseHtml(html) {
  var root = createElement('div');
  var stack = [root];
  var tagRe = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9\-]+)([^>]*)>|([^<]+)/g;
  var match;
  while ((match = tagRe.exec(html)) !== null) {
    if (match[0].slice(0, 4) === '<!--') continue;
    if (match[4]) {
      var text = match[4];
      if (text) stack[stack.length - 1].appendChild(createTextNode(text));
    } else if (match[2]) {
      var isClosing = Boolean(match[1]);
      var tagName = match[2];
      var rawAttrs = match[3] || '';
      var isSelfClosing = rawAttrs.slice(-1) === '/' || ['input', 'img', 'br', 'hr', 'col', 'meta', 'link'].indexOf(tagName.toLowerCase()) !== -1;
      if (isClosing) {
        if (stack.length > 1) {
          for (var i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName.toLowerCase() === tagName.toLowerCase()) {
              stack.splice(i);
              break;
            }
          }
        }
      } else {
        var el = createElement(tagName);
        var attrRe = /([a-zA-Z0-9\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
        var am;
        while ((am = attrRe.exec(rawAttrs)) !== null) {
          var k = am[1];
          if (k === '/') continue;
          var v = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '';
          el.setAttribute(k, v);
        }
        stack[stack.length - 1].appendChild(el);
        if (!isSelfClosing) {
          stack.push(el);
        }
      }
    }
  }
  return root.childNodes.slice();
}

function createElement(tagName) {
  var listeners = {};
  var attributes = {};
  var classSet = new Set();
  var datasetTarget = {};

  var dataset = new Proxy(datasetTarget, {
    set: function(target, prop, value) {
      target[prop] = String(value);
      var attrName = 'data-' + String(prop).replace(/([A-Z])/g, '-$1').toLowerCase();
      attributes[attrName] = String(value);
      return true;
    },
    deleteProperty: function(target, prop) {
      delete target[prop];
      var attrName = 'data-' + String(prop).replace(/([A-Z])/g, '-$1').toLowerCase();
      delete attributes[attrName];
      return true;
    }
  });

  var element = {
    tagName: String(tagName).toUpperCase(),
    nodeType: 1,
    parentNode: null,
    childNodes: [],
    style: {},
    dataset: dataset,
    _listeners: listeners,
    _attributes: attributes,

    classList: {
      add: function() {
        Array.prototype.forEach.call(arguments, function(name) { classSet.add(name); });
      },
      remove: function() {
        Array.prototype.forEach.call(arguments, function(name) { classSet.delete(name); });
      },
      contains: function(name) { return classSet.has(name); },
      toggle: function(name, force) {
        var shouldAdd = force === undefined ? !classSet.has(name) : Boolean(force);
        if (shouldAdd) classSet.add(name);
        else classSet.delete(name);
        return shouldAdd;
      }
    },

    get className() { return Array.from(classSet).join(' '); },
    set className(value) {
      classSet.clear();
      String(value).split(/\s+/).forEach(function(name) {
        if (name) classSet.add(name);
      });
    },

    get id() { return attributes.id || ''; },
    set id(value) { attributes.id = String(value); },

    get hidden() { return Object.prototype.hasOwnProperty.call(attributes, 'hidden') ? attributes.hidden !== 'false' : false; },
    set hidden(value) {
      if (value) attributes.hidden = 'true';
      else delete attributes.hidden;
    },

    get disabled() { return Object.prototype.hasOwnProperty.call(attributes, 'disabled') ? attributes.disabled !== 'false' : false; },
    set disabled(value) {
      if (value) attributes.disabled = 'true';
      else delete attributes.disabled;
    },

    get innerHTML() {
      if (element._rawHtml !== undefined) return element._rawHtml;
      return element.childNodes.map(function(child) {
        return child.nodeType === 3 ? child.data : (child.innerHTML || '');
      }).join('');
    },
    set innerHTML(value) {
      element.childNodes = [];
      element._rawHtml = String(value);
      var parsedChildren = parseHtml(String(value));
      parsedChildren.forEach(function(child) {
        element.appendChild(child);
      });
    },

    get textContent() {
      return element.childNodes.map(function(child) {
        return child.nodeType === 3 ? child.data : child.textContent;
      }).join('');
    },
    set textContent(value) {
      element.childNodes = [];
      if (String(value).length > 0) {
        element.appendChild(createTextNode(value));
      }
    },

    get children() {
      return element.childNodes.filter(function(child) { return child.nodeType === 1; });
    },

    setAttribute: function(name, value) {
      attributes[name] = String(value);
      var lower = String(name).toLowerCase();
      if (lower === 'class') {
        classSet.clear();
        String(value).split(/\s+/).forEach(function(c) { if (c) classSet.add(c); });
      }
      var prop = dataAttrToProp(name);
      if (prop) {
        datasetTarget[prop] = String(value);
      }
    },
    getAttribute: function(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    removeAttribute: function(name) {
      delete attributes[name];
      var lower = String(name).toLowerCase();
      if (lower === 'class') {
        classSet.clear();
      }
      var prop = dataAttrToProp(name);
      if (prop) {
        delete datasetTarget[prop];
      }
    },
    hasAttribute: function(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    },

    appendChild: function(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = element;
      element.childNodes.push(child);
      return child;
    },
    removeChild: function(child) {
      var index = element.childNodes.indexOf(child);
      if (index !== -1) element.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    append: function() {
      Array.prototype.forEach.call(arguments, function(child) {
        if (typeof child === 'string') child = createTextNode(child);
        element.appendChild(child);
      });
    },

    querySelector: function(selector) {
      var found = null;
      walk(element, function(node) {
        if (!found && node.nodeType === 1 && matchesSimple(node, selector)) found = node;
      });
      return found;
    },
    closest: function(selector) {
      var cur = element;
      while (cur && cur.nodeType === 1) {
        if (matchesSimple(cur, selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    },
    querySelectorAll: function(selector) {
      var found = [];
      walk(element, function(node) {
        if (node.nodeType === 1 && matchesSimple(node, selector)) found.push(node);
      });
      return found;
    },

    addEventListener: function(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener: function(type, handler) {
      var list = listeners[type] || [];
      var index = list.indexOf(handler);
      if (index !== -1) list.splice(index, 1);
    },
    dispatchEvent: function(event) {
      event.target = event.target || element;
      var stopped = false;
      event.stopPropagation = function() { stopped = true; };
      var cur = element;
      while (cur && !stopped) {
        if (cur._listeners && cur._listeners[event.type]) {
          cur._listeners[event.type].slice().forEach(function(handler) {
            handler.call(cur, event);
          });
        }
        cur = cur.parentNode;
      }
      return true;
    },
    click: function() { element.dispatchEvent({ type: 'click' }); },

    getBoundingClientRect: function() {
      return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
    }
  };

  return element;
}

function createTextNode(data) {
  return {
    nodeType: 3,
    parentNode: null,
    data: String(data),
    get textContent() { return String(data); }
  };
}

function createDocument() {
  var listeners = {};
  var document = {
    nodeType: 9,
    visibilityState: 'visible',
    _listeners: listeners,
    createElement: createElement,
    createTextNode: createTextNode,
    getElementById: function(id) { return document.body.querySelector('#' + id); },
    querySelector: function(selector) { return document.body.querySelector(selector); },
    querySelectorAll: function(selector) { return document.body.querySelectorAll(selector); },
    addEventListener: function(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener: function(type, handler) {
      var list = listeners[type] || [];
      var index = list.indexOf(handler);
      if (index !== -1) list.splice(index, 1);
    },
    dispatchEvent: function(event) {
      event.target = event.target || document;
      (listeners[event.type] || []).slice().forEach(function(handler) {
        handler.call(document, event);
      });
      return true;
    }
  };
  document.body = createElement('body');
  document.documentElement = createElement('html');
  document.documentElement.appendChild(document.body);
  return document;
}

module.exports = {
  createDocument: createDocument,
  createElement: createElement,
  createTextNode: createTextNode
};
