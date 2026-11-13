'use strict';

var assert = require('assert');
var helper = require('./helpers/load');

var app = helper.createApp(['date.js', 'arrows.js']);
var Arrows = app.get('Arrows');

var tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

// row 0 的条：y 10 到 30，中心 20；row 1 的条：y 50 到 70，中心 60
function sourceBox() {
  return Arrows.box(0, 100, 80, { top: 10, height: 20 });
}

function targetBox() {
  return Arrows.box(1, 220, 60, { top: 10, height: 20 });
}

function link(id, source, target, type, lag) {
  return { id: id, source: source, target: target, type: type, lag: lag === undefined ? 0 : lag };
}

// ---------- 盒子与端点 ----------

test('box 按行高计算 top 并保持条内偏移', function() {
  var box = Arrows.box(3, 120, 90, { top: 10, height: 20 });
  assert.strictEqual(box.left, 120);
  assert.strictEqual(box.width, 90);
  assert.strictEqual(box.top, 3 * 40 + 10);
  assert.strictEqual(box.height, 20);
  assert.strictEqual(box.rowIndex, 3);
});

test('box 对非法宽度做最小 20px 兜底', function() {
  assert.strictEqual(Arrows.box(0, 0, 4).width, 20);
});

test('endpoints 的 FS 从源右边缘指向目标左边缘', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'FS');
  assert.strictEqual(geo.x1, 180);
  assert.strictEqual(geo.y1, 20);
  assert.strictEqual(geo.x2, 220);
  assert.strictEqual(geo.y2, 60);
  assert.strictEqual(geo.from, 'right');
  assert.strictEqual(geo.to, 'left');
});

test('endpoints 覆盖 SS、FF、SF 三种类型', function() {
  var s = sourceBox();
  var t = targetBox();

  var ss = Arrows.endpoints(s, t, 'SS');
  assert.strictEqual(ss.x1, 100);
  assert.strictEqual(ss.x2, 220);
  assert.strictEqual(ss.exitDir, -1);
  assert.strictEqual(ss.entryDir, 1);

  var ff = Arrows.endpoints(s, t, 'FF');
  assert.strictEqual(ff.x1, 180);
  assert.strictEqual(ff.x2, 280);
  assert.strictEqual(ff.exitDir, 1);
  assert.strictEqual(ff.entryDir, -1);

  var sf = Arrows.endpoints(s, t, 'SF');
  assert.strictEqual(sf.x1, 100);
  assert.strictEqual(sf.x2, 280);
  assert.strictEqual(sf.exitDir, -1);
  assert.strictEqual(sf.entryDir, -1);
});

test('endpoints 对非法类型与缺失盒子返回 null', function() {
  assert.strictEqual(Arrows.endpoints(sourceBox(), targetBox(), 'XX'), null);
  assert.strictEqual(Arrows.endpoints(null, targetBox(), 'FS'), null);
  assert.strictEqual(Arrows.endpoints(sourceBox(), { left: 0, top: 0, width: NaN, height: 20 }, 'FS'), null);
});

test('endpoints 使用条的中心线而不是顶部', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'FS');
  assert.strictEqual(geo.y1, 20);
  assert.strictEqual(geo.y2, 60);
});

// ---------- 路径 ----------

test('FS 路径为正交折线并终结在目标左边缘', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'FS');
  assert.strictEqual(Arrows.path(geo, 12), 'M 180 20 H 192 V 40 H 208 V 60 H 220');
});

test('SS 路径从源左边缘出发', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'SS');
  assert.strictEqual(Arrows.path(geo, 12), 'M 100 20 H 88 V 40 H 208 V 60 H 220');
});

test('FF 路径终结在目标右边缘', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'FF');
  assert.strictEqual(Arrows.path(geo, 12), 'M 180 20 H 192 V 40 H 292 V 60 H 280');
});

test('SF 路径从源左边缘指向目标右边缘', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'SF');
  assert.strictEqual(Arrows.path(geo, 12), 'M 100 20 H 88 V 40 H 292 V 60 H 280');
});

test('path 默认使用 STUB 且缺失几何返回空字符串', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'FS');
  assert.strictEqual(Arrows.path(geo), 'M 180 20 H 192 V 40 H 208 V 60 H 220');
  assert.strictEqual(Arrows.path(null), '');
});

test('headPoints 指向目标条', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'FS');
  assert.strictEqual(Arrows.headPoints(geo, 8), '220,60 212,56.4 212,63.6');
});

// ---------- layout ----------

test('空 links 返回空数组', function() {
  assert.deepStrictEqual(plain(Arrows.layout([], {})), []);
  assert.deepStrictEqual(plain(Arrows.layout(null, {})), []);
});

test('layout 跳过缺失任务、自引用与非法类型', function() {
  var boxes = { a: sourceBox(), b: targetBox() };
  var layouts = Arrows.layout([
    link('l1', 'a', 'b', 'FS'),
    link('l2', 'a', 'ghost', 'FS'),
    link('l3', 'a', 'a', 'FS'),
    link('l4', 'a', 'b', 'XX')
  ], boxes);

  assert.strictEqual(layouts.length, 1);
  assert.strictEqual(layouts[0].id, 'l1');
  assert.strictEqual(layouts[0].source, 'a');
  assert.strictEqual(layouts[0].target, 'b');
  assert.strictEqual(layouts[0].type, 'FS');
  assert.ok(layouts[0].d.indexOf('M 180 20') === 0);
  assert.ok(layouts[0].head.length > 0);
});

test('layout 为四种类型各生成一条路径', function() {
  var boxes = { a: sourceBox(), b: targetBox() };
  var layouts = Arrows.layout([
    link('l1', 'a', 'b', 'FS', 0),
    link('l2', 'a', 'b', 'SS', 1),
    link('l3', 'a', 'b', 'FF', 2),
    link('l4', 'a', 'b', 'SF', -1)
  ], boxes);

  assert.strictEqual(layouts.length, 4);
  assert.deepStrictEqual(
    plain(layouts.map(function(item) { return item.type + ':' + item.lag; })),
    ['FS:0', 'SS:1', 'FF:2', 'SF:-1']
  );
});

test('layout 不修改 links 与 boxes', function() {
  var boxes = { a: sourceBox(), b: targetBox() };
  var links = [link('l1', 'a', 'b', 'FS', 2)];
  var linksBefore = JSON.stringify(links);
  var boxesBefore = JSON.stringify(boxes);

  Arrows.layout(links, boxes);

  assert.strictEqual(JSON.stringify(links), linksBefore);
  assert.strictEqual(JSON.stringify(boxes), boxesBefore);
});

test('path 接受 laneOffset 调整中间通道与短支宽度', function() {
  var geo = Arrows.endpoints(sourceBox(), targetBox(), 'FS');
  var normalPath = Arrows.path(geo, 12, 0);
  var offsetPath = Arrows.path(geo, 12, 6);

  assert.strictEqual(normalPath, 'M 180 20 H 192 V 40 H 208 V 60 H 220');
  assert.ok(offsetPath.indexOf('V 46') !== -1, '通道 Y 轴增加 6px 偏移');
});

test('layout 在启用 avoidOverlap 时为重叠通道的箭头分配不同通道偏移', function() {
  var boxes = {
    a: Arrows.box(0, 100, 80),
    b: Arrows.box(2, 220, 60),
    c: Arrows.box(0, 100, 80),
    d: Arrows.box(2, 240, 60)
  };
  var links = [
    link('l1', 'a', 'b', 'FS'),
    link('l2', 'c', 'd', 'FS')
  ];

  var layouts = Arrows.layout(links, boxes, { avoidOverlap: true });
  assert.strictEqual(layouts.length, 2);
  assert.notStrictEqual(layouts[0].laneOffset, layouts[1].laneOffset, '重叠箭头获得不同 laneOffset');
  assert.notStrictEqual(layouts[0].d, layouts[1].d, '重叠箭头折线路径互不遮挡');
});

var failures = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('PASS ' + t.name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + t.name);
    console.log('  ' + (err && err.message ? err.message : err));
  }
});

console.log('\narrows: ' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures === 0 ? 0 : 1);
