'use strict';

// 无依赖单文件构建：把 index.html 引用的本地 CSS 和经典 script 内联到
// dist/index.html，保持 file:// 双击可运行。只用 Node 内置模块。

var fs = require('fs');
var path = require('path');

var ROOT = process.cwd();
var DIST = path.join(ROOT, 'dist');
var VENDOR_SCRIPTS = ['xlsx.full.min.js'];

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function parseArgs(argv) {
  var options = { inlineVendor: true, help: false };
  argv.forEach(function(arg) {
    if (arg === '--no-inline-vendor') {
      options.inlineVendor = false;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error('未知参数: ' + arg + '（可用: --no-inline-vendor, --help）');
    }
  });
  return options;
}

function printHelp() {
  console.log([
    '用法: node build.js [--no-inline-vendor]',
    '',
    '在仓库根目录执行，读取 index.html，输出 dist/index.html 并复制 favicon.svg。',
    '',
    '  --no-inline-vendor   保留 xlsx.full.min.js 外链，并把该文件复制到 dist/',
    '  --help               显示本帮助'
  ].join('\n'));
}

function isLocalReference(ref) {
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) && ref.indexOf('//') !== 0;
}

function normalizeReference(ref) {
  return ref.split('#')[0].split('?')[0].replace(/^\.\//, '');
}

function readLocal(rel, label) {
  var abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && abs.indexOf(ROOT + path.sep) !== 0) {
    throw new Error(label + ' 越过仓库根目录: ' + rel);
  }
  var stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    throw new Error(label + ' 引用的文件不存在: ' + rel);
  }
  if (!stat.isFile()) throw new Error(label + ' 引用的路径不是文件: ' + rel);
  return { abs: abs, content: fs.readFileSync(abs, 'utf8'), size: stat.size };
}

function getAttribute(tag, name) {
  var re = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i');
  var match = tag.match(re);
  if (!match) return null;
  return match[1] !== undefined ? match[1] : match[2];
}

function indentAt(html, index) {
  var lineStart = html.lastIndexOf('\n', index - 1) + 1;
  var prefix = html.slice(lineStart, index);
  return /^[ \t]*$/.test(prefix) ? prefix : '';
}

// 内联内容里的结束标签会提前闭合容器。JS 用 <\/script，CSS 用 <\/style，
// 两者在字符串和正则中的语义与原字符一致。
function escapeScriptEnd(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function escapeStyleEnd(css) {
  return css.replace(/<\/style/gi, '<\\/style');
}

function build(options) {
  options = options || {};
  var inlineVendor = options.inlineVendor !== false;

  var indexPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error('在 ' + ROOT + ' 找不到 index.html，请在仓库根目录运行');
  }

  var html = fs.readFileSync(indexPath, 'utf8');
  var originalSize = Buffer.byteLength(html, 'utf8');
  var resources = [];
  var external = [];
  var vendorToCopy = [];

  var styleTagRe = /<link\b[^>]*>/gi;
  html = html.replace(styleTagRe, function(tag, offset) {
    var rel = (getAttribute(tag, 'rel') || '').toLowerCase();
    var href = getAttribute(tag, 'href');
    if (rel !== 'stylesheet' || !href || !isLocalReference(href)) return tag;

    var ref = normalizeReference(href);
    var asset = readLocal(ref, 'stylesheet');
    resources.push({ kind: 'css', path: ref, size: asset.size, mode: 'inline' });

    var indent = indentAt(html, offset);
    return '<style>\n' + escapeStyleEnd(asset.content) + '\n' + indent + '</style>';
  });

  var scriptTagRe = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  html = html.replace(scriptTagRe, function(tag, offset) {
    var src = getAttribute(tag, 'src');
    if (!src) return tag;
    if (!isLocalReference(src)) {
      external.push({ kind: 'script', path: src });
      return tag;
    }

    var ref = normalizeReference(src);
    var asset = readLocal(ref, 'script');
    var isVendor = VENDOR_SCRIPTS.indexOf(path.basename(ref)) !== -1;

    if (isVendor && !inlineVendor) {
      resources.push({ kind: 'js', path: ref, size: asset.size, mode: 'copy' });
      vendorToCopy.push(ref);
      return tag;
    }

    resources.push({
      kind: 'js',
      path: ref,
      size: asset.size,
      mode: 'inline',
      vendor: isVendor
    });

    var indent = indentAt(html, offset);
    return '<script>\n' + escapeScriptEnd(asset.content) + '\n' + indent + '</script>';
  });

  var iconTagRe = /<link\b[^>]*>/gi;
  var iconHref = null;
  var iconMatch;
  while ((iconMatch = iconTagRe.exec(html)) !== null) {
    var rel = (getAttribute(iconMatch[0], 'rel') || '').toLowerCase();
    var href = getAttribute(iconMatch[0], 'href');
    if (href && isLocalReference(href) && /(^|\s)icon(\s|$)/.test(rel.replace('apple-touch-icon', 'icon'))) {
      iconHref = normalizeReference(href);
      break;
    }
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  var outPath = path.join(DIST, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  var outSize = Buffer.byteLength(html, 'utf8');

  var copied = [];
  if (iconHref) {
    var icon = readLocal(iconHref, 'favicon');
    fs.copyFileSync(icon.abs, path.join(DIST, path.basename(iconHref)));
    resources.push({ kind: 'asset', path: iconHref, size: icon.size, mode: 'copy' });
    copied.push({ path: iconHref, size: icon.size });
  }
  vendorToCopy.forEach(function(ref) {
    var asset = readLocal(ref, 'script');
    fs.copyFileSync(asset.abs, path.join(DIST, path.basename(ref)));
  });

  printReport({ resources: resources, external: external, copied: copied, originalSize: originalSize, outSize: outSize, outPath: outPath });

  return { outPath: outPath, outSize: outSize, resources: resources };
}

function printReport(report) {
  var width = 0;
  report.resources.forEach(function(item) {
    width = Math.max(width, item.path.length);
  });

  console.log('PMWEB build');
  console.log('  root   ' + ROOT);
  console.log('  output ' + report.outPath);
  console.log('');
  console.log('资源');
  report.resources.forEach(function(item) {
    var label = item.mode === 'inline' ? '内联' : '复制';
    var note = '';
    if (item.kind === 'css') note = ' -> <style>';
    else if (item.kind === 'js') note = ' -> <script>' + (item.vendor ? ' (vendor)' : '');
    console.log('  ' + label + '  ' + item.path + new Array(Math.max(1, width - item.path.length + 3)).join(' ') + formatSize(item.size) + note);
  });

  var cssCount = 0;
  var jsCount = 0;
  var vendorCount = 0;
  report.resources.forEach(function(item) {
    if (item.kind === 'css') cssCount++;
    if (item.kind === 'js') {
      jsCount++;
      if (item.vendor) vendorCount++;
    }
  });

  console.log('');
  console.log('汇总');
  console.log('  ' + cssCount + ' 个样式，' + jsCount + ' 个脚本（其中 vendor ' + vendorCount + ' 个），' + report.copied.length + ' 个复制资源');
  console.log('  index.html  ' + formatSize(report.originalSize) + ' -> ' + formatSize(report.outSize));
  console.log('  输出文件    ' + report.outPath + '  ' + formatSize(report.outSize));

  if (report.external.length > 0) {
    console.log('');
    console.log('保留的外链');
    report.external.forEach(function(item) {
      console.log('  ' + item.path);
    });
  }
}

function main() {
  var options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error('build: ' + err.message);
    process.exit(2);
  }
  if (options.help) {
    printHelp();
    return;
  }
  try {
    build(options);
  } catch (err) {
    console.error('build: ' + err.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { build: build };
