'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var printCssPath = path.join(ROOT, 'css', 'print.css');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('print.css 存在且包含 @media print 专用样式块', function() {
  assert.ok(fs.existsSync(printCssPath));
  var content = fs.readFileSync(printCssPath, 'utf8');

  assert.ok(content.indexOf('@media print') !== -1);
  assert.ok(content.indexOf('@page') !== -1);
  assert.ok(content.indexOf('#toolbar') !== -1);
  assert.ok(content.indexOf('#status-bar') !== -1);
  assert.ok(content.indexOf('page-break-inside: avoid') !== -1);
  assert.ok(content.indexOf('print-color-adjust: exact') !== -1);
});

test('print.css 包含只读横幅与审计日志表格类定义', function() {
  var content = fs.readFileSync(printCssPath, 'utf8');

  assert.ok(content.indexOf('#readonly-banner') !== -1);
  assert.ok(content.indexOf('.audit-table') !== -1);
  assert.ok(content.indexOf('.audit-badge') !== -1);
  assert.ok(content.indexOf('.share-link-input-group') !== -1);
});

async function run() {
  var passed = 0;
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      await t.fn();
      passed++;
      console.log('PASS ' + t.name);
    } catch (err) {
      console.error('FAIL ' + t.name);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log('\nprint: ' + passed + '/' + tests.length + ' passed');
}

run();
