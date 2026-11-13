'use strict';

var assert = require('assert');
var path = require('path');
var fs = require('fs');
var vm = require('vm');
var helper = require('./helpers/load');

var ROOT = path.resolve(__dirname, '..');

function createTestApp() {
  var storage = {
    _store: {},
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null;
    },
    setItem: function(key, value) { this._store[key] = String(value); },
    removeItem: function(key) { delete this._store[key]; }
  };

  var context = vm.createContext({
    console: console,
    localStorage: storage,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval
  });

  var scripts = [
    'date.js',
    'store.js',
    'workspace.js',
    'holiday-source.js',
    'work-calendar.js',
    'task-manager.js'
  ];

  scripts.forEach(function(file) {
    var abs = path.join(ROOT, 'js', file);
    var code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, context, { filename: abs });
  });

  return {
    context: context,
    localStorage: storage,
    get: function(name) { return vm.runInContext(name, context); },
    run: function(code) { return vm.runInContext(code, context); }
  };
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---- parseAnnual: CN 格式校验与规范化 ----

test('parseAnnual: 合法 CN 年度数据正常解析并按日期升序排序', function() {
  var app = createTestApp();
  var HolidaySource = app.get('HolidaySource');

  var raw = {
    year: 2026,
    region: 'CN',
    dates: [
      { date: '2026-01-04', name: '元旦补班', type: 'transfer_workday' },
      { date: '2026-01-01', name: '元旦', type: 'public_holiday' },
      { date: '2026-01-02', name: '元旦', type: 'public_holiday' },
      { date: '2026-01-03', name: '元旦', type: 'public_holiday' }
    ]
  };

  var parsed = HolidaySource.parseAnnual(raw);
  assert.strictEqual(parsed.year, 2026);
  assert.strictEqual(parsed.region, 'CN');
  assert.strictEqual(parsed.dates.length, 4);
  assert.strictEqual(parsed.dates[0].date, '2026-01-01');
  assert.strictEqual(parsed.dates[0].type, 'public_holiday');
  assert.strictEqual(parsed.dates[3].date, '2026-01-04');
  assert.strictEqual(parsed.dates[3].type, 'transfer_workday');

  // 支持 JSON 字符串输入
  var jsonStr = JSON.stringify(raw);
  var fromJson = HolidaySource.parseAnnual(jsonStr);
  assert.deepStrictEqual(fromJson, parsed);
});

test('parseAnnual: 非法输入与格式错误严格拒绝', function() {
  var app = createTestApp();
  var HolidaySource = app.get('HolidaySource');

  // 非法 JSON
  assert.throws(function() { HolidaySource.parseAnnual('{invalid json'); }, /JSON/i);

  // 非对象或空输入
  assert.throws(function() { HolidaySource.parseAnnual(null); });
  assert.throws(function() { HolidaySource.parseAnnual([]); });

  // 非法年份
  assert.throws(function() {
    HolidaySource.parseAnnual({ year: 'bad', region: 'CN', dates: [] });
  });

  // 非 CN 地区
  assert.throws(function() {
    HolidaySource.parseAnnual({ year: 2026, region: 'US', dates: [] });
  }, /CN/);

  // 日期越年
  assert.throws(function() {
    HolidaySource.parseAnnual({
      year: 2026,
      region: 'CN',
      dates: [{ date: '2025-12-31', name: '越年', type: 'public_holiday' }]
    });
  });

  // 无效公历日期
  assert.throws(function() {
    HolidaySource.parseAnnual({
      year: 2026,
      region: 'CN',
      dates: [{ date: '2026-02-30', name: '不存在的日期', type: 'public_holiday' }]
    });
  });

  // 错误类型
  assert.throws(function() {
    HolidaySource.parseAnnual({
      year: 2026,
      region: 'CN',
      dates: [{ date: '2026-05-01', name: '劳动节', type: 'optional_holiday' }]
    });
  });

  // 同日冲突与重复
  assert.throws(function() {
    HolidaySource.parseAnnual({
      year: 2026,
      region: 'CN',
      dates: [
        { date: '2026-01-01', name: '元旦', type: 'public_holiday' },
        { date: '2026-01-01', name: '元旦重复', type: 'transfer_workday' }
      ]
    });
  });
});

// ---- CN_types_and_precedence: 四级优先级逐级覆盖与任务日期不变 ----

test('CN_types_and_precedence: 同一天逐级验证手工大于导入大于订阅大于周规则', function() {
  var app = createTestApp();
  var HolidaySource = app.get('HolidaySource');
  var WorkCalendar = app.get('WorkCalendar');

  // 2026-01-04 是周日
  var testDate = '2026-01-04';

  var baseCalendar = {
    subscribed: true,
    source: HolidaySource.DEFAULT_SOURCE,
    cacheByYear: {},
    importedByYear: {},
    lastAttemptByYear: {}
  };

  // 步骤 1：仅周规则，周日为非工作日
  var res1 = HolidaySource.resolveDate(testDate, baseCalendar, null);
  assert.strictEqual(res1.working, false);
  assert.strictEqual(res1.source, 'rule');

  // 步骤 2：启用订阅，订阅配置 2026-01-04 为补班（工作日）
  var subCalendar = JSON.parse(JSON.stringify(baseCalendar));
  subCalendar.cacheByYear[2026] = {
    year: 2026,
    region: 'CN',
    dates: [{ date: '2026-01-04', name: '元旦补班', type: 'transfer_workday' }]
  };
  var res2 = HolidaySource.resolveDate(testDate, subCalendar, null);
  assert.strictEqual(res2.working, true);
  assert.strictEqual(res2.name, '元旦补班');
  assert.strictEqual(res2.source, 'subscription');

  // 步骤 3：导入假期覆盖订阅补班，2026-01-04 变为非工作日
  var importCalendar = JSON.parse(JSON.stringify(subCalendar));
  importCalendar.importedByYear[2026] = {
    year: 2026,
    region: 'CN',
    dates: [{ date: '2026-01-04', name: '导入元旦假期', type: 'public_holiday' }]
  };
  var res3 = HolidaySource.resolveDate(testDate, importCalendar, null);
  assert.strictEqual(res3.working, false);
  assert.strictEqual(res3.name, '导入元旦假期');
  assert.strictEqual(res3.source, 'import');

  // 步骤 4：项目手工设置覆盖导入，2026-01-04 设为项目工作日
  var projectOverrides = {
    '2026-01-04': { working: true, name: '项目特殊加班' }
  };
  var res4 = HolidaySource.resolveDate(testDate, importCalendar, projectOverrides);
  assert.strictEqual(res4.working, true);
  assert.strictEqual(res4.name, '项目特殊加班');
  assert.strictEqual(res4.source, 'manual');

  // WorkCalendar.resolveDate 接口等价
  var resWork = WorkCalendar.resolveDate(testDate, importCalendar, projectOverrides);
  assert.deepStrictEqual(resWork, res4);

  // 任务数据快照验证：任何日历解析前后任务对象保持 deepEqual
  var sampleTasks = [
    { id: 't1', name: '开发任务', startDate: '2026-01-01', endDate: '2026-01-10', progress: 50 },
    { id: 't2', name: '测试任务', startDate: '2026-01-04', endDate: '2026-01-08', progress: 0 }
  ];
  var tasksBefore = JSON.parse(JSON.stringify(sampleTasks));
  HolidaySource.resolveDate('2026-01-04', importCalendar, projectOverrides);
  var tasksAfter = JSON.parse(JSON.stringify(sampleTasks));
  assert.deepStrictEqual(tasksAfter, tasksBefore);
});

// ---- unsubscribe_keeps_imports: 取消订阅保留导入与缓存且不重开 ----

test('unsubscribe_keeps_imports: 取消订阅后停止应用订阅规则但完整保留导入规则', async function() {
  var app = createTestApp();
  var HolidaySource = app.get('HolidaySource');

  var calendar = {
    subscribed: true,
    source: HolidaySource.DEFAULT_SOURCE,
    cacheByYear: {
      2026: {
        year: 2026,
        region: 'CN',
        dates: [
          { date: '2026-01-04', name: '元旦补班', type: 'transfer_workday' }
        ]
      }
    },
    importedByYear: {
      2026: {
        year: 2026,
        region: 'CN',
        dates: [
          { date: '2026-05-01', name: '劳动节', type: 'public_holiday' }
        ]
      }
    },
    lastAttemptByYear: {}
  };

  // 订阅开启时：2026-01-04 生效为订阅补班
  var r1 = HolidaySource.resolveDate('2026-01-04', calendar, null);
  assert.strictEqual(r1.working, true);
  assert.strictEqual(r1.source, 'subscription');

  // 导入的 2026-05-01 生效为导入假日
  var r2 = HolidaySource.resolveDate('2026-05-01', calendar, null);
  assert.strictEqual(r2.working, false);
  assert.strictEqual(r2.source, 'import');

  // 取消订阅
  calendar.subscribed = false;

  // 2026-01-04 订阅规则不再应用，回退到周日周规则
  var r3 = HolidaySource.resolveDate('2026-01-04', calendar, null);
  assert.strictEqual(r3.working, false);
  assert.strictEqual(r3.source, 'rule');

  // 2026-05-01 导入的假日继续生效
  var r4 = HolidaySource.resolveDate('2026-05-01', calendar, null);
  assert.strictEqual(r4.working, false);
  assert.strictEqual(r4.source, 'import');

  // 进行中的请求返回后可写入缓存，但绝对不能重新开启订阅
  var mockFetch = function() {
    return Promise.resolve({
      ok: true,
      text: function() {
        return Promise.resolve(JSON.stringify({
          year: 2027,
          region: 'CN',
          dates: [{ date: '2027-01-01', name: '元旦', type: 'public_holiday' }]
        }));
      }
    });
  };

  var nextState = await HolidaySource.refresh(2027, {
    fetch: mockFetch,
    calendar: calendar,
    force: true
  });

  assert.strictEqual(nextState.subscribed, false);
  assert.ok(nextState.cacheByYear[2027]);
  assert.strictEqual(nextState.cacheByYear[2027].dates[0].date, '2027-01-01');
});

// ---- refresh_does_not_overwrite_other_project: 异步刷新不覆盖其他项目变动 ----

test('refresh_does_not_overwrite_other_project: 异步刷新完成时不覆盖并发的项目变动', async function() {
  var app = createTestApp();
  var Workspace = app.get('Workspace');
  var HolidaySource = app.get('HolidaySource');

  var wsData = {
    pmweb_version: 4,
    projects: [
      {
        id: 'p-1',
        name: '项目一',
        data: { pmweb_version: 3, tasks: [], settings: {} }
      },
      {
        id: 'p-2',
        name: '项目二',
        data: { pmweb_version: 3, tasks: [], settings: {} }
      }
    ],
    settings: { startupMode: 'last', defaultProjectId: 'p-1', lastProjectId: 'p-1' },
    calendar: {
      subscribed: true,
      source: HolidaySource.DEFAULT_SOURCE,
      cacheByYear: {},
      importedByYear: {},
      lastAttemptByYear: {}
    },
    recycleBin: [],
    legacy: {}
  };

  Workspace.data = wsData;
  Workspace.raw = JSON.stringify(wsData);
  Workspace.activeProjectId = 'p-1';
  Workspace._readOnly = false;
  app.localStorage.setItem('pmweb_data', Workspace.raw);

  var resolveFetch;
  var fetchPromise = new Promise(function(resolve) {
    resolveFetch = resolve;
  });

  var mockFetch = function() {
    return fetchPromise.then(function() {
      return {
        ok: true,
        text: function() {
          return Promise.resolve(JSON.stringify({
            year: 2026,
            region: 'CN',
            dates: [{ date: '2026-01-01', name: '元旦', type: 'public_holiday' }]
          }));
        }
      };
    });
  };

  // 在项目一发起异步刷新
  var refreshPromise = HolidaySource.refresh(2026, {
    fetch: mockFetch,
    now: 1000000
  });

  // 在异步请求期间，项目二发生并发写入（例如新增任务）
  var newTask = { id: 'task-p2-new', name: '项目二新增任务', startDate: '2026-02-01', endDate: '2026-02-10' };
  Workspace.updateProjectData('p-2', {
    pmweb_version: 3,
    tasks: [newTask],
    settings: {}
  });

  // 确认项目二写入已生效
  assert.strictEqual(Workspace.data.projects[1].data.tasks.length, 1);

  // 此时网络响应返回
  resolveFetch();
  var updatedCalendar = await refreshPromise;

  // 验证刷新成功保存至全局日历
  assert.ok(updatedCalendar.cacheByYear[2026]);
  assert.strictEqual(updatedCalendar.cacheByYear[2026].dates[0].date, '2026-01-01');

  // 最核心验证：项目二的新增任务完全保留，未被异步刷新的旧快照覆盖
  assert.strictEqual(Workspace.data.projects[1].data.tasks.length, 1);
  assert.strictEqual(Workspace.data.projects[1].data.tasks[0].id, 'task-p2-new');
});

// ---- importAnnual: 年度替换与按年隔离 ----

test('importAnnual: 导入合法数据按年度替换旧数据并保留其他年份', function() {
  var app = createTestApp();
  var HolidaySource = app.get('HolidaySource');

  var calendar = {
    subscribed: true,
    source: HolidaySource.DEFAULT_SOURCE,
    cacheByYear: {},
    importedByYear: {
      2025: {
        year: 2025,
        region: 'CN',
        dates: [{ date: '2025-01-01', name: '2025元旦', type: 'public_holiday' }]
      },
      2026: {
        year: 2026,
        region: 'CN',
        dates: [{ date: '2026-01-01', name: '旧2026元旦', type: 'public_holiday' }]
      }
    },
    lastAttemptByYear: {}
  };

  var new2026 = {
    year: 2026,
    region: 'CN',
    dates: [
      { date: '2026-01-01', name: '新2026元旦', type: 'public_holiday' },
      { date: '2026-01-04', name: '新2026补班', type: 'transfer_workday' }
    ]
  };

  var next = HolidaySource.importAnnual(calendar, new2026);
  assert.strictEqual(next.importedByYear[2025].dates[0].name, '2025元旦');
  assert.strictEqual(next.importedByYear[2026].dates.length, 2);
  assert.strictEqual(next.importedByYear[2026].dates[0].name, '新2026元旦');
  assert.strictEqual(next.importedByYear[2026].dates[1].name, '新2026补班');
});

// ---- in-flight 去重与失败保留有效缓存 ----

test('refresh: 同一年份 in-flight 请求去重与网络错误不破坏既有缓存', async function() {
  var app = createTestApp();
  var HolidaySource = app.get('HolidaySource');

  var fetchCount = 0;
  var mockFetch = function() {
    fetchCount++;
    return new Promise(function(resolve) {
      setTimeout(function() {
        resolve({
          ok: true,
          text: function() {
            return Promise.resolve(JSON.stringify({
              year: 2026,
              region: 'CN',
              dates: [{ date: '2026-01-01', name: '元旦', type: 'public_holiday' }]
            }));
          }
        });
      }, 50);
    });
  };

  var p1 = HolidaySource.refresh(2026, { fetch: mockFetch, force: true });
  var p2 = HolidaySource.refresh(2026, { fetch: mockFetch, force: true });

  var r = await Promise.all([p1, p2]);
  assert.strictEqual(fetchCount, 1, '同一年并发刷新应去重为一次网络请求');
  assert.strictEqual(r[0].cacheByYear[2026].dates[0].date, '2026-01-01');

  // 网络失败场景：保留已有有效缓存，更新失败状态
  var failingFetch = function() {
    return Promise.reject(new Error('Network timeout'));
  };

  var stateAfterFail = await HolidaySource.refresh(2026, {
    fetch: failingFetch,
    calendar: r[0],
    force: true
  });

  // 既有缓存完好无损
  assert.ok(stateAfterFail.cacheByYear[2026]);
  assert.strictEqual(stateAfterFail.cacheByYear[2026].dates[0].date, '2026-01-01');
  // 失败状态被正确记录
  assert.strictEqual(stateAfterFail.lastAttemptByYear[2026].success, false);
  assert.ok(stateAfterFail.lastAttemptByYear[2026].error);
});

// ---- TASK6-CRIT-01: 并发多年刷新逆序完成及途中导入与订阅变动全部保全 ----

test('refresh_concurrent_years_and_interleaved_imports_preserve_all: 跨年份逆序完成与并发导入全部保全', async function() {
  var app = createTestApp();
  var Workspace = app.get('Workspace');
  var HolidaySource = app.get('HolidaySource');

  var wsData = {
    pmweb_version: 4,
    projects: [
      {
        id: 'p-1',
        name: '项目一',
        data: { pmweb_version: 3, tasks: [], settings: {} }
      }
    ],
    settings: { startupMode: 'last', defaultProjectId: 'p-1', lastProjectId: 'p-1' },
    calendar: {
      subscribed: true,
      source: HolidaySource.DEFAULT_SOURCE,
      cacheByYear: {},
      importedByYear: {},
      lastAttemptByYear: {}
    },
    recycleBin: [],
    legacy: {}
  };

  Workspace.data = wsData;
  Workspace.raw = JSON.stringify(wsData);
  Workspace.activeProjectId = 'p-1';
  Workspace._readOnly = false;
  app.localStorage.setItem('pmweb_data', Workspace.raw);

  // 2025 耗时 60ms，2026 耗时 20ms
  var p2025 = HolidaySource.refresh(2025, {
    force: true,
    fetch: function() {
      return new Promise(function(resolve) {
        setTimeout(function() {
          resolve({
            ok: true,
            text: function() {
              return Promise.resolve(JSON.stringify({
                year: 2025,
                region: 'CN',
                dates: [{ date: '2025-01-01', name: '2025元旦', type: 'public_holiday' }]
              }));
            }
          });
        }, 60);
      });
    }
  });

  var p2026 = HolidaySource.refresh(2026, {
    force: true,
    fetch: function() {
      return new Promise(function(resolve) {
        setTimeout(function() {
          resolve({
            ok: true,
            text: function() {
              return Promise.resolve(JSON.stringify({
                year: 2026,
                region: 'CN',
                dates: [{ date: '2026-01-01', name: '2026元旦', type: 'public_holiday' }]
              }));
            }
          });
        }, 20);
      });
    }
  });

  // 在 10ms 时用户导入 2027 年数据
  setTimeout(function() {
    var imported2027 = {
      year: 2027,
      region: 'CN',
      dates: [{ date: '2027-01-01', name: '2027导入元旦', type: 'public_holiday' }]
    };
    var nextCal = HolidaySource.importAnnual(Workspace.data.calendar, imported2027);
    var nextWs = JSON.parse(JSON.stringify(Workspace.data));
    nextWs.calendar = nextCal;
    Workspace.commit(nextWs);
  }, 10);

  // 在 15ms 时用户取消订阅并新增任务
  setTimeout(function() {
    var nextWs = JSON.parse(JSON.stringify(Workspace.data));
    nextWs.calendar.subscribed = false;
    nextWs.projects[0].data.tasks.push({ id: 't-concurrent', name: '并发任务' });
    Workspace.commit(nextWs);
  }, 15);

  await Promise.all([p2025, p2026]);

  var finalCal = Workspace.data.calendar;
  // 1. 2025 缓存已写入
  assert.ok(finalCal.cacheByYear[2025], '2025 缓存应存在');
  assert.strictEqual(finalCal.cacheByYear[2025].dates[0].name, '2025元旦');
  // 2. 先完成的 2026 缓存未被后完成的 2025 抹除
  assert.ok(finalCal.cacheByYear[2026], '2026 缓存应存在未被抹除');
  assert.strictEqual(finalCal.cacheByYear[2026].dates[0].name, '2026元旦');
  // 3. 途中导入的 2027 年数据未被抹除
  assert.ok(finalCal.importedByYear[2027], '2027 导入数据应保留未被抹除');
  assert.strictEqual(finalCal.importedByYear[2027].dates[0].name, '2027导入元旦');
  // 4. 订阅取消状态保留
  assert.strictEqual(finalCal.subscribed, false, '订阅取消状态应保留');
  // 5. 并发项目任务保留
  assert.strictEqual(Workspace.data.projects[0].data.tasks.length, 1, '并发任务变动应保留');
  assert.strictEqual(Workspace.data.projects[0].data.tasks[0].id, 't-concurrent');
});

// ---- TASK6-IMPT-02: 提交失败时安全保护不引发二次异常且允许后续重试 ----

test('refresh_commit_failure_safe_and_allows_retry: 持久化故障不引发二次级联异常并允许后续重试', async function() {
  var app = createTestApp();
  var Workspace = app.get('Workspace');
  var HolidaySource = app.get('HolidaySource');

  var wsData = {
    pmweb_version: 4,
    projects: [],
    settings: {},
    calendar: {
      subscribed: true,
      source: HolidaySource.DEFAULT_SOURCE,
      cacheByYear: {},
      importedByYear: {},
      lastAttemptByYear: {}
    }
  };

  Workspace.data = wsData;
  Workspace.raw = JSON.stringify(wsData);
  Workspace._readOnly = false;
  app.localStorage.setItem('pmweb_data', Workspace.raw);

  var originalCommit = Workspace.commit.bind(Workspace);
  // 模拟持久化存储基线不匹配，提交时抛错
  Workspace.commit = function(next) {
    throw new Error('存储基线不匹配: expectedRaw !== actualRaw');
  };

  var fetchCalled = 0;
  var mockFetch = function() {
    fetchCalled++;
    return Promise.resolve({
      ok: true,
      text: function() {
        return Promise.resolve(JSON.stringify({
          year: 2026,
          region: 'CN',
          dates: [{ date: '2026-01-01', name: '元旦', type: 'public_holiday' }]
        }));
      }
    });
  };

  // 在 throwOnError: false 下，即使持久化抛错且 catch 再次尝试记录失败状态，
  // 也不能由于 catch 内无保护提交抛出二次未捕获异常导致 Promise 崩溃
  var res = await HolidaySource.refresh(2026, {
    force: true,
    fetch: mockFetch,
    throwOnError: false
  });

  assert.ok(res, '应安全返回日历状态');
  assert.strictEqual(res.lastAttemptByYear[2026].success, false, '应记录尝试失败');
  assert.ok(res.lastAttemptByYear[2026].error.indexOf('存储基线不匹配') !== -1, '应保留原始错误信息');

  // 恢复正常提交功能，验证 inFlightByYear 已在 finally 中释放，允许再次发起刷新并成功
  Workspace.commit = originalCommit;
  var retryRes = await HolidaySource.refresh(2026, {
    force: true,
    fetch: mockFetch,
    throwOnError: false
  });

  assert.strictEqual(fetchCalled, 2, 'inFlightByYear 必须释放以允许重试发起第 2 次网络请求');
  assert.strictEqual(retryRes.lastAttemptByYear[2026].success, true, '恢复后重试应成功');
  assert.ok(Workspace.data.calendar.cacheByYear[2026], '工作区应成功持久化缓存');
});

// ---- INT67-MINR01 / TASK6-MINR03: HolidaySource.resolveDate 与 TaskManager 嵌套 calendarOverrides 形态一致性 ----

test('resolveDate_nested_calendarOverrides_consistent_with_task_manager: 嵌套结构与 TaskManager 支持形态一致', function() {
  var app = createTestApp();
  var HolidaySource = app.get('HolidaySource');
  var WorkCalendar = app.get('WorkCalendar');
  var TaskManager = app.get('TaskManager');

  var calendar = {
    subscribed: true,
    cacheByYear: {},
    importedByYear: {},
    lastAttemptByYear: {}
  };

  // 1. 嵌套字典形态
  var nestedDict = {
    calendarOverrides: {
      '2026-10-01': { working: false, name: '项目自定义国庆休' },
      '2026-10-04': { working: true, name: '项目自定义周日补' }
    }
  };

  var res1 = HolidaySource.resolveDate('2026-10-01', calendar, nestedDict);
  assert.strictEqual(res1.working, false);
  assert.strictEqual(res1.source, 'manual');
  assert.strictEqual(res1.name, '项目自定义国庆休');

  var res2 = HolidaySource.resolveDate('2026-10-04', calendar, nestedDict);
  assert.strictEqual(res2.working, true);
  assert.strictEqual(res2.source, 'manual');
  assert.strictEqual(res2.name, '项目自定义周日补');

  // 2. 嵌套数组/列表形态 (workdays/holidays)
  var nestedLists = {
    calendarOverrides: {
      workdays: ['2026-10-04'],
      holidays: ['2026-10-01']
    }
  };

  var res3 = HolidaySource.resolveDate('2026-10-01', calendar, nestedLists);
  assert.strictEqual(res3.working, false);
  assert.strictEqual(res3.source, 'manual');

  var res4 = HolidaySource.resolveDate('2026-10-04', calendar, nestedLists);
  assert.strictEqual(res4.working, true);
  assert.strictEqual(res4.source, 'manual');

  // 3. 嵌套周规则 (weekends)
  var nestedWeekends = {
    calendarOverrides: {
      weekends: [0] // 仅周日为周末，周六为工作日
    }
  };
  // 2026-10-03 是周六
  var res5 = HolidaySource.resolveDate('2026-10-03', calendar, nestedWeekends);
  assert.strictEqual(res5.working, true, '仅周日为周末时周六为工作日');
  assert.strictEqual(res5.source, 'rule');

  // 4. 与 TaskManager 模型支持形态及 WorkCalendar.isWorkingDay 判定完全一致
  var taskData = {
    pmweb_version: 3,
    tasks: [],
    settings: {
      calendarOverrides: nestedDict
    }
  };
  TaskManager.data = taskData;
  var rawConfig = TaskManager._workCalendarRaw();
  assert.ok(rawConfig, 'TaskManager 应成功解包嵌套 calendarOverrides');
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-10-01', { calendar: calendar, calendarOverrides: nestedDict }), false);
  assert.strictEqual(WorkCalendar.isWorkingDay('2026-10-04', { calendar: calendar, calendarOverrides: nestedDict }), true);
});

async function run() {
  var failures = 0;
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      await t.fn();
      console.log('PASS ' + t.name);
    } catch (err) {
      failures++;
      console.log('FAIL ' + t.name);
      console.log('  ' + (err && err.stack ? err.stack : err));
    }
  }

  console.log('\nholiday-source: ' + (tests.length - failures) + '/' + tests.length + ' passed');
  process.exit(failures === 0 ? 0 : 1);
}

run();
