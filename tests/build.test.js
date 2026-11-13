'use strict';

// build.js 测试：在临时目录构造最小工程，运行构建脚本检查产物。
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var BUILD = path.resolve(__dirname, '..', 'build.js');

var failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + name);
    console.log('  ' + (err && err.message ? err.message : err));
  }
}

function writeFile(root, rel, content) {
  var abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function createFixture() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmweb-build-'));

  writeFile(root, 'favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
  writeFile(root, 'css/a.css', 'body { color: red; }\n/* MARK:css-a */\n');
  writeFile(root, 'css/b.css', '.b::after { content: "</style>"; }\n/* MARK:css-b */\n');
  writeFile(root, 'js/one.js', '// MARK:one\nvar one = "</script>";\n');
  writeFile(root, 'js/two.js', '// MARK:two\nvar two = 2;\n');
  writeFile(root, 'xlsx.full.min.js', '// MARK:vendor\nvar XLSX = {};\n');
  writeFile(root, 'index.html', [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <title>fixture</title>',
    '  <link rel="icon" type="image/svg+xml" href="favicon.svg">',
    '  <link rel="stylesheet" href="css/a.css">',
    '  <link rel="stylesheet" href="./css/b.css">',
    '</head>',
    '<body>',
    '  <div id="app"></div>',
    '  <script src="js/one.js"></script>',
    '  <script src="js/two.js"></script>',
    '  <script src="xlsx.full.min.js"></script>',
    '  <script>',
    '    document.addEventListener("DOMContentLoaded", function() { window.ready = true; });',
    '  </script>',
    '</body>',
    '</html>',
    ''
  ].join('\n'));

  return root;
}

function runBuild(root, args) {
  return childProcess.spawnSync(process.execPath, [BUILD].concat(args || []), {
    cwd: root,
    encoding: 'utf8'
  });
}

function readDist(root) {
  return fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
}

function countMatches(text, re) {
  var matches = text.match(re);
  return matches ? matches.length : 0;
}

function listDist(root) {
  return fs.readdirSync(path.join(root, 'dist')).sort();
}

var defaultRoot = createFixture();
var defaultResult = runBuild(defaultRoot);

try {
  check('默认构建退出码为 0', function() {
    assert.strictEqual(defaultResult.status, 0, defaultResult.stderr || defaultResult.stdout);
    assert.ok(/index\.html/.test(defaultResult.stdout), '应输出产物路径');
  });

  check('生成 dist/index.html 并复制 favicon.svg', function() {
    assert.ok(fs.existsSync(path.join(defaultRoot, 'dist', 'index.html')), 'dist/index.html 应存在');
    assert.ok(fs.existsSync(path.join(defaultRoot, 'dist', 'favicon.svg')), 'favicon.svg 应复制到 dist');
  });

  check('dist 只包含单文件产物与 favicon（vendor 默认内联）', function() {
    assert.deepStrictEqual(listDist(defaultRoot), ['favicon.svg', 'index.html']);
  });

  check('没有残留本地 css/js 外链', function() {
    var html = readDist(defaultRoot);
    assert.strictEqual(countMatches(html, /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi), 0, '不应保留 stylesheet link');
    assert.strictEqual(countMatches(html, /<script\b[^>]*\bsrc\s*=/gi), 0, '不应保留带 src 的 script');
    assert.ok(!/href=["']\.?\/?css\//.test(html), '不应残留 css 路径');
    assert.ok(!/src=["']\.?\/?js\//.test(html), '不应残留 js 路径');
  });

  check('<style> 数量与源样式一致', function() {
    var html = readDist(defaultRoot);
    assert.strictEqual(countMatches(html, /<style\b/gi), 2);
    assert.ok(html.indexOf('MARK:css-a') !== -1, 'a.css 应内联');
    assert.ok(html.indexOf('MARK:css-b') !== -1, 'b.css 应内联');
  });

  check('脚本顺序与 index.html 一致', function() {
    var html = readDist(defaultRoot);
    var one = html.indexOf('MARK:one');
    var two = html.indexOf('MARK:two');
    var vendor = html.indexOf('MARK:vendor');
    assert.ok(one !== -1 && two !== -1 && vendor !== -1, '三个脚本都应内联');
    assert.ok(one < two, 'one.js 应在 two.js 之前');
    assert.ok(two < vendor, 'two.js 应在 xlsx 之前');
  });

  check('xlsx 默认内联', function() {
    var html = readDist(defaultRoot);
    assert.ok(html.indexOf('MARK:vendor') !== -1, 'vendor 内容应出现在产物中');
    assert.ok(html.indexOf('src="xlsx.full.min.js"') === -1, '不应保留 vendor 外链');
  });

  check('内联 JS 的 </script> 已转义', function() {
    var html = readDist(defaultRoot);
    assert.ok(html.indexOf('<\\/script') !== -1, '应出现 <\\/script');
    // 源文件共 4 个 script 结束标签，转义后不应多出提前闭合。
    assert.strictEqual(countMatches(html, /<\/script>/g), 4);
  });

  check('内联 CSS 的 </style> 已转义', function() {
    var html = readDist(defaultRoot);
    assert.ok(html.indexOf('<\\/style') !== -1, '应出现 <\\/style');
    assert.strictEqual(countMatches(html, /<\/style>/g), 2);
  });

  check('不引入 ES module', function() {
    var html = readDist(defaultRoot);
    assert.strictEqual(countMatches(html, /type=["']module["']/gi), 0);
    assert.strictEqual(countMatches(html, /<script\b[^>]*\bdefer\b/gi), 0);
  });

  check('保留原有行内 script', function() {
    var html = readDist(defaultRoot);
    assert.ok(html.indexOf('window.ready = true') !== -1, '行内脚本应原样保留');
  });
} finally {
  fs.rmSync(defaultRoot, { recursive: true, force: true });
}

var vendorRoot = createFixture();
var vendorResult = runBuild(vendorRoot, ['--no-inline-vendor']);

try {
  check('--no-inline-vendor 退出码为 0', function() {
    assert.strictEqual(vendorResult.status, 0, vendorResult.stderr || vendorResult.stdout);
  });

  check('--no-inline-vendor 保留 xlsx 外链', function() {
    var html = readDist(vendorRoot);
    assert.ok(/<script\b[^>]*src=["']xlsx\.full\.min\.js["']/i.test(html), '应保留 vendor script src');
    assert.strictEqual(html.indexOf('MARK:vendor'), -1, 'vendor 不应内联');
  });

  check('--no-inline-vendor 复制 vendor 到 dist 并内联其余脚本', function() {
    var html = readDist(vendorRoot);
    assert.deepStrictEqual(listDist(vendorRoot), ['favicon.svg', 'index.html', 'xlsx.full.min.js']);
    assert.ok(html.indexOf('MARK:one') !== -1, '普通脚本仍应内联');
    var copied = fs.readFileSync(path.join(vendorRoot, 'dist', 'xlsx.full.min.js'), 'utf8');
    assert.strictEqual(copied, '// MARK:vendor\nvar XLSX = {};\n');
  });

  check('--no-inline-vendor 下样式仍然内联', function() {
    var html = readDist(vendorRoot);
    assert.strictEqual(countMatches(html, /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi), 0);
    assert.strictEqual(countMatches(html, /<style\b/gi), 2);
  });
} finally {
  fs.rmSync(vendorRoot, { recursive: true, force: true });
}

// 真实工程产物构建断言：经典 script 全部内联、新模块在 dist 中、旧云端初始化无调用
var projectRoot = path.resolve(__dirname, '..');
var realDistPath = path.join(projectRoot, 'dist', 'index.html');
if (fs.existsSync(realDistPath)) {
  var realDistHtml = fs.readFileSync(realDistPath, 'utf8');

  check('工程产物经典 script 全部内联', function() {
    assert.strictEqual(countMatches(realDistHtml, /<script\b[^>]*\bsrc\s*=/gi), 0, '工程产物不应保留带 src 的 script 外链');
    assert.strictEqual(countMatches(realDistHtml, /type=["']module["']/gi), 0, '工程产物不应引入 ES module');
    assert.strictEqual(countMatches(realDistHtml, /<script\b[^>]*\bdefer\b/gi), 0, '工程产物不应包含 defer 脚本');
  });

  check('工程产物包含 backup/workspace/holiday/recycle 新模块', function() {
    assert.ok(/var\s+Backup\s*=|window\.Backup\s*=|Backup\s*=\s*\{/.test(realDistHtml), '工程产物应包含 Backup 模块');
    assert.ok(/var\s+Workspace\s*=|window\.Workspace\s*=|Workspace\s*=\s*\{/.test(realDistHtml), '工程产物应包含 Workspace 模块');
    assert.ok(/var\s+HolidaySource\s*=|window\.HolidaySource\s*=|HolidaySource\s*=\s*\{/.test(realDistHtml), '工程产物应包含 HolidaySource 模块');
    assert.ok(/var\s+RecycleBin\s*=|window\.RecycleBin\s*=|RecycleBin\s*=\s*\{/.test(realDistHtml), '工程产物应包含 RecycleBin 模块');
  });

  check('工程产物启动流程对旧云端 init 无调用', function() {
    var appInitMatch = realDistHtml.match(/\binit\s*:\s*function\s*\(\)\s*\{([\s\S]*?)\n\s*renderAll\s*:/);
    assert.ok(appInitMatch, '应在工程产物中找到 App.init 启动方法');
    var appInitBody = appInitMatch[1];
    assert.ok(!/\bSync\.init\b/.test(appInitBody), 'App.init 不应调用 Sync.init');
    assert.ok(!/\bRealtime\.init\b/.test(appInitBody), 'App.init 不应调用 Realtime.init');
    assert.ok(!/\bShareManager\.init\b/.test(appInitBody), 'App.init 不应调用 ShareManager.init');
    assert.ok(!/\bSyncUI\.init\b/.test(appInitBody), 'App.init 不应调用 SyncUI.init');
  });
}

console.log('');
if (failures > 0) {
  console.log('build: ' + failures + ' 项失败');
  process.exit(1);
}
console.log('build: 全部通过');
