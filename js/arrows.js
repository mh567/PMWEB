// ============================================================
// Arrows: 依赖箭头几何计算
// 纯函数模块，不读写 DOM，不修改传入对象
// ============================================================
var Arrows = {
  ROW_HEIGHT: 40,
  STUB: 12,
  HEAD_SIZE: 8,

  // 依赖类型决定箭头的出边与入边
  SIDES: {
    FS: { from: 'right', to: 'left' },
    SS: { from: 'left', to: 'left' },
    FF: { from: 'right', to: 'right' },
    SF: { from: 'left', to: 'right' }
  },

  // 生成任务条盒子：left 为时间轴横坐标，top 为时间轴纵坐标
  box: function(rowIndex, left, width, options) {
    options = options || {};
    var rowHeight = typeof options.rowHeight === 'number' ? options.rowHeight : this.ROW_HEIGHT;
    var top = typeof options.top === 'number' ? options.top : 10;
    var height = typeof options.height === 'number' ? options.height : 20;
    var index = typeof rowIndex === 'number' && isFinite(rowIndex) ? rowIndex : 0;
    return {
      left: typeof left === 'number' && isFinite(left) ? left : 0,
      width: typeof width === 'number' && isFinite(width) ? Math.max(width, 20) : 20,
      top: index * rowHeight + top,
      height: height,
      rowIndex: index
    };
  },

  // 返回箭头的起止点和出入方向，类型非法或盒子缺失时返回 null
  endpoints: function(source, target, type) {
    var sides = this.SIDES[type];
    if (!sides) return null;
    if (!this._validBox(source) || !this._validBox(target)) return null;

    var fromLeft = sides.from === 'left';
    var toLeft = sides.to === 'left';
    var x1 = fromLeft ? source.left : source.left + source.width;
    var x2 = toLeft ? target.left : target.left + target.width;

    return {
      type: type,
      from: sides.from,
      to: sides.to,
      x1: x1,
      y1: source.top + source.height / 2,
      x2: x2,
      y2: target.top + target.height / 2,
      exitDir: fromLeft ? -1 : 1,
      entryDir: toLeft ? 1 : -1
    };
  },

  // 正交折线：出边短支、行间通道、入边短支，支持多箭头通道避让偏移
  path: function(geo, stub, laneOffset) {
    if (!geo) return '';
    var s = typeof stub === 'number' && isFinite(stub) && stub > 0 ? stub : this.STUB;
    var offset = 0;
    if (typeof laneOffset === 'number' && isFinite(laneOffset)) {
      offset = laneOffset;
    } else if (laneOffset && typeof laneOffset.laneOffset === 'number') {
      offset = laneOffset.laneOffset;
    }
    var extraStub = offset !== 0 ? Math.min(Math.abs(offset) * 0.4, 12) : 0;
    var exitX = geo.x1 + geo.exitDir * (s + extraStub);
    var entryOutX = geo.x2 - geo.entryDir * (s + extraStub);
    var midY = (geo.y1 + geo.y2) / 2 + offset;

    return 'M ' + _arrowRound(geo.x1) + ' ' + _arrowRound(geo.y1)
      + ' H ' + _arrowRound(exitX)
      + ' V ' + _arrowRound(midY)
      + ' H ' + _arrowRound(entryOutX)
      + ' V ' + _arrowRound(geo.y2)
      + ' H ' + _arrowRound(geo.x2);
  },

  // 箭头三角形顶点，指向目标条
  headPoints: function(geo, size) {
    if (!geo) return '';
    var s = typeof size === 'number' && isFinite(size) && size > 0 ? size : this.HEAD_SIZE;
    var baseX = geo.x2 - geo.entryDir * s;
    var half = s * 0.45;
    return _arrowRound(geo.x2) + ',' + _arrowRound(geo.y2)
      + ' ' + _arrowRound(baseX) + ',' + _arrowRound(geo.y2 - half)
      + ' ' + _arrowRound(baseX) + ',' + _arrowRound(geo.y2 + half);
  },

  // 批量计算可见箭头；boxes 为 { taskId: box }，端点缺失的依赖被跳过
  layout: function(links, boxes, options) {
    options = options || {};
    var stub = options.stub || this.STUB;
    var avoidOverlap = !!options.avoidOverlap;
    var result = [];

    if (!Array.isArray(links) || !boxes) return result;

    var validItems = [];
    links.forEach(function(link) {
      if (!link || typeof link.id !== 'string') return;
      if (link.source === link.target) return;

      var source = boxes[link.source];
      var target = boxes[link.target];
      if (!source || !target) return;

      var geo = Arrows.endpoints(source, target, link.type);
      if (!geo) return;

      validItems.push({ link: link, geo: geo, source: source, target: target });
    });

    var offsets = {};
    if (avoidOverlap && validItems.length > 1) {
      var groups = {};
      validItems.forEach(function(item) {
        var midYKey = Math.round((item.geo.y1 + item.geo.y2) / 2);
        var dirKey = item.geo.from + '->' + item.geo.to;
        var groupKey = midYKey + '|' + dirKey;
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(item);
      });

      Object.keys(groups).forEach(function(k) {
        var group = groups[k];
        if (group.length > 1) {
          var step = 6;
          group.forEach(function(item, idx) {
            var sign = (idx % 2 === 1) ? 1 : -1;
            var mag = Math.ceil(idx / 2) * step;
            offsets[item.link.id] = idx === 0 ? 0 : sign * mag;
          });
        }
      });
    }

    validItems.forEach(function(item) {
      var link = item.link;
      var geo = item.geo;
      var laneOffset = offsets[link.id] || 0;

      result.push({
        id: link.id,
        source: link.source,
        target: link.target,
        type: link.type,
        lag: link.lag,
        laneOffset: laneOffset,
        d: Arrows.path(geo, stub, laneOffset),
        head: Arrows.headPoints(geo),
        x1: geo.x1,
        y1: geo.y1,
        x2: geo.x2,
        y2: geo.y2
      });
    });

    return result;
  },

  _validBox: function(box) {
    if (!box || typeof box !== 'object') return false;
    return ['left', 'top', 'width', 'height'].every(function(key) {
      return typeof box[key] === 'number' && isFinite(box[key]);
    });
  }
};

function _arrowRound(value) {
  var rounded = Math.round(value * 10) / 10;
  return String(rounded);
}
