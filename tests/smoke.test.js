'use strict';

// 工作台冒烟检查：校验 fixture、index.html 结构与脚本/样式挂载顺序。
// 工作台尚未合并时以 PENDING 退出，避免并行分支误报。
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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

function hasId(id) {
  return new RegExp('id\\s*=\\s*["\']' + id + '["\']').test(html);
}

function collectSrcs(pattern) {
  var srcs = [];
  var re = new RegExp(pattern, 'gi');
  var match;
  while ((match = re.exec(html)) !== null) {
    srcs.push(match[1].replace(/^\.\//, ''));
  }
  return srcs;
}

var scriptSrcs = collectSrcs('<script\\b[^>]*\\bsrc\\s*=\\s*["\']([^"\']+)["\'][^>]*>');
var linkHrefs = collectSrcs('<link\\b[^>]*\\bhref\\s*=\\s*["\']([^"\']+)["\'][^>]*>');

[
  { file: 'tests/fixtures/tasks-3-level.json', count: 27 },
  { file: 'tests/fixtures/tasks-200.json', count: 200 }
].forEach(function(fixture) {
  check(fixture.file + ' 可解析且为 v3，任务数 ' + fixture.count, function() {
    var data = JSON.parse(fs.readFileSync(path.join(ROOT, fixture.file), 'utf8'));
    assert.strictEqual(data.pmweb_version, 3, 'pmweb_version 应为 3');
    assert.ok(Array.isArray(data.tasks), 'tasks 应为数组');
    assert.strictEqual(data.tasks.length, fixture.count, '任务数应为 ' + fixture.count);
  });
});

if (!hasId('workbench')) {
  if (failures > 0) {
    console.log('\nsmoke: ' + failures + ' 项失败');
    process.exit(1);
  }
  console.log('PENDING: workbench not merged yet');
  process.exit(0);
}

['workbench', 'grid-pane', 'timeline-pane', 'workbench-splitter'].forEach(function(id) {
  check('index.html 包含 #' + id, function() {
    assert.ok(hasId(id), '缺少 id="' + id + '"');
  });
});

['js/grid-pane.js', 'js/timeline-pane.js', 'js/workbench.js', 'js/realtime.js', 'js/workspace.js', 'js/recycle-bin.js', 'js/holiday-source.js', 'js/backup.js'].forEach(function(src) {
  check(src + ' 已挂载且在 js/app.js 之前', function() {
    var index = scriptSrcs.indexOf(src);
    var appIndex = scriptSrcs.indexOf('js/app.js');
    assert.notStrictEqual(index, -1, '缺少 <script src="' + src + '">');
    assert.notStrictEqual(appIndex, -1, '缺少 <script src="js/app.js">');
    assert.ok(index < appIndex, src + ' 应位于 js/app.js 之前');
  });
});

['css/workbench.css', 'css/grid.css', 'css/timeline.css', 'css/realtime.css'].forEach(function(href) {
  check(href + ' 已挂载', function() {
    assert.notStrictEqual(linkHrefs.indexOf(href), -1, '缺少 <link href="' + href + '">');
  });
});

console.log('\nsmoke: ' + (failures === 0 ? '全部通过' : failures + ' 项失败'));
process.exit(failures === 0 ? 0 : 1);
