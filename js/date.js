// ============================================================
// DateUtil: 统一日期解析与格式化，全部按本地时区处理
// ============================================================
var DEFAULT_TASK_COLOR = '#1e40af';

const DateUtil = {
  parse: function(str) {
    var parts = String(str).split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  },

  format: function(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  },

  addDays: function(str, days) {
    var parts = String(str).split('-');
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10) - 1;
    var day = parseInt(parts[2], 10);
    var d = new Date(year, month, day + Number(days), 12);
    return DateUtil.format(d);
  }
};

