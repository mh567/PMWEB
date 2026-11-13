'use strict';

// 无依赖测试入口：递归发现 tests 目录下的 *.test.js，逐个在独立 Node 进程中运行。
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var testsDir = __dirname;

function findTestFiles(dir) {
  var results = [];
  fs.readdirSync(dir).sort().forEach(function(name) {
    if (name === 'node_modules') return;
    var abs = path.join(dir, name);
    var stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      results = results.concat(findTestFiles(abs));
    } else if (/\.test\.js$/.test(name)) {
      results.push(abs);
    }
  });
  return results;
}

var files = findTestFiles(testsDir);
var failedFiles = [];

files.forEach(function(abs) {
  var relative = path.relative(testsDir, abs);
  console.log('\n== ' + relative + ' ==');
  var result = childProcess.spawnSync(process.execPath, [abs], { stdio: 'inherit' });
  if (result.error) {
    failedFiles.push(relative);
    console.log('FAILED: ' + relative + ' (' + result.error.message + ')');
  } else if (result.status !== 0) {
    failedFiles.push(relative);
    console.log('FAILED: ' + relative + (result.signal ? ' (signal ' + result.signal + ')' : ''));
  }
});

var failures = failedFiles.length;
console.log('\n' + (files.length - failures) + '/' + files.length + ' test files passed');
if (failures > 0) {
  console.log('Failed files:');
  failedFiles.forEach(function(file) { console.log('  ' + file); });
}
process.exit(failures === 0 ? 0 : 1);
