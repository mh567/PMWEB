'use strict';

var fs = require('fs');
var path = require('path');

var FIXTURE_DIR = __dirname;
var SMALL_FILE = path.join(FIXTURE_DIR, 'tasks-3-level.json');
var LARGE_FILE = path.join(FIXTURE_DIR, 'tasks-200.json');

var BASE_DATE = '2026-01-05';
var STATUSES = ['inProgress', 'thirdParty', 'done'];
var MILESTONE_STATUSES = ['pending', 'done'];
var ROOT_COLORS = ['#1e40af', '#7e22ce', '#9a3412', '#0f766e'];
var ASSIGNEES = ['张伟', '李娜', '王芳', '陈强', '刘洋', '赵敏', '周涛', '孙悦'];
var REQUIRED_TASK_FIELDS = [
  'id', 'parentId', 'name', 'description', 'assignee', 'color',
  'startDate', 'endDate', 'plannedEndDate', 'progress', 'status', 'order'
];

var SMALL_TREE = [
  {
    id: 'root-web',
    name: '官网改版',
    description: '公司官网整体改版，覆盖信息架构、视觉设计与前端实现',
    assignee: '张伟',
    color: '#1e40af',
    startDate: '2026-01-05',
    endDate: '2026-03-27',
    plannedEndDate: '2026-03-31',
    progress: 62,
    status: 'inProgress',
    children: [
      {
        id: 'web-req',
        name: '需求调研',
        description: '竞品分析与用户访谈，输出改版需求文档',
        assignee: '李娜',
        color: null,
        startDate: '2026-01-05',
        endDate: '2026-01-30',
        plannedEndDate: '2026-01-30',
        progress: 100,
        status: 'done',
        children: [
          {
            id: 'web-req-bench',
            name: '竞品分析',
            description: '收集五家同类产品的栏目结构与交互方式',
            assignee: '李娜',
            color: null,
            startDate: '2026-01-05',
            endDate: '2026-01-14',
            plannedEndDate: '2026-01-14',
            progress: 100,
            status: 'done'
          },
          {
            id: 'web-req-interview',
            name: '用户访谈',
            description: '完成十二位客户的需求访谈并整理结论',
            assignee: '周涛',
            color: null,
            startDate: '2026-01-15',
            endDate: '2026-01-30',
            plannedEndDate: '2026-01-28',
            progress: 100,
            status: 'done'
          }
        ]
      },
      {
        id: 'web-design',
        name: '视觉设计',
        description: '首页与内页视觉方案，建立组件规范',
        assignee: '王芳',
        color: null,
        startDate: '2026-02-02',
        endDate: '2026-02-27',
        plannedEndDate: '2026-02-27',
        progress: 70,
        status: 'inProgress',
        children: [
          {
            id: 'web-design-home',
            name: '首页设计',
            description: '完成首页桌面端与移动端视觉稿',
            assignee: '王芳',
            color: null,
            startDate: '2026-02-02',
            endDate: '2026-02-13',
            plannedEndDate: '2026-02-13',
            progress: 100,
            status: 'done'
          },
          {
            id: 'web-design-system',
            name: '组件规范',
            description: '整理颜色、字体、间距和常用组件',
            assignee: '王芳',
            color: null,
            startDate: '2026-02-16',
            endDate: '2026-02-27',
            plannedEndDate: '2026-03-02',
            progress: 45,
            status: 'inProgress'
          }
        ]
      },
      {
        id: 'web-frontend',
        name: '前端开发',
        description: '按视觉稿完成响应式页面与交互联调',
        assignee: '陈强',
        color: null,
        startDate: '2026-03-02',
        endDate: '2026-03-27',
        plannedEndDate: '2026-03-31',
        progress: 30,
        status: 'thirdParty',
        children: [
          {
            id: 'web-frontend-layout',
            name: '响应式布局',
            description: '实现断点布局与导航折叠',
            assignee: '陈强',
            color: null,
            startDate: '2026-03-02',
            endDate: '2026-03-13',
            plannedEndDate: '2026-03-13',
            progress: 30,
            status: 'thirdParty'
          },
          {
            id: 'web-frontend-interaction',
            name: '交互联调',
            description: '对接表单与动画，修复跨浏览器问题',
            assignee: '孙悦',
            color: null,
            startDate: '2026-03-16',
            endDate: '2026-03-27',
            plannedEndDate: '2026-03-31',
            progress: 20,
            status: 'inProgress'
          }
        ]
      }
    ]
  },
  {
    id: 'root-data',
    name: '数据中台',
    description: '统一数据接口与权限模型，完成灰度上线演练',
    assignee: '刘洋',
    color: '#7e22ce',
    startDate: '2026-02-02',
    endDate: '2026-04-24',
    plannedEndDate: '2026-04-30',
    progress: 45,
    status: 'thirdParty',
    children: [
      {
        id: 'data-api',
        name: '接口梳理',
        description: '盘点存量接口并完成字段映射',
        assignee: '刘洋',
        color: null,
        startDate: '2026-02-02',
        endDate: '2026-02-27',
        plannedEndDate: '2026-02-27',
        progress: 40,
        status: 'thirdParty',
        children: [
          {
            id: 'data-api-inventory',
            name: '接口盘点',
            description: '登记全部对外接口和调用方',
            assignee: '刘洋',
            color: null,
            startDate: '2026-02-02',
            endDate: '2026-02-13',
            plannedEndDate: '2026-02-13',
            progress: 50,
            status: 'thirdParty'
          },
          {
            id: 'data-api-mapping',
            name: '字段映射',
            description: '对齐新旧字段并输出映射表',
            assignee: '周涛',
            color: null,
            startDate: '2026-02-16',
            endDate: '2026-02-27',
            plannedEndDate: '2026-02-27',
            progress: 100,
            status: 'done'
          }
        ]
      },
      {
        id: 'data-permission',
        name: '权限模型',
        description: '定义角色与资源权限，实现校验逻辑',
        assignee: '赵敏',
        color: null,
        startDate: '2026-03-02',
        endDate: '2026-03-27',
        plannedEndDate: '2026-03-31',
        progress: 55,
        status: 'inProgress',
        children: [
          {
            id: 'data-permission-role',
            name: '角色定义',
            description: '整理管理员、编辑和只读角色',
            assignee: '赵敏',
            color: null,
            startDate: '2026-03-02',
            endDate: '2026-03-13',
            plannedEndDate: '2026-03-13',
            progress: 100,
            status: 'done'
          },
          {
            id: 'data-permission-check',
            name: '权限校验',
            description: '在接口层接入统一权限校验',
            assignee: '陈强',
            color: null,
            startDate: '2026-03-16',
            endDate: '2026-03-27',
            plannedEndDate: '2026-03-31',
            progress: 30,
            status: 'inProgress'
          }
        ]
      },
      {
        id: 'data-release',
        name: '上线演练',
        description: '完成灰度发布和回滚预案验证',
        assignee: '刘洋',
        color: null,
        startDate: '2026-04-06',
        endDate: '2026-04-24',
        plannedEndDate: '2026-04-24',
        progress: 100,
        status: 'done',
        children: [
          {
            id: 'data-release-gray',
            name: '灰度发布',
            description: '按部门分批放量并观察指标',
            assignee: '刘洋',
            color: null,
            startDate: '2026-04-06',
            endDate: '2026-04-17',
            plannedEndDate: '2026-04-17',
            progress: 100,
            status: 'done'
          },
          {
            id: 'data-release-rollback',
            name: '回滚预案',
            description: '演练数据回滚与流量切换',
            assignee: '孙悦',
            color: null,
            startDate: '2026-04-20',
            endDate: '2026-04-24',
            plannedEndDate: '2026-04-24',
            progress: 100,
            status: 'done'
          }
        ]
      }
    ]
  },
  {
    id: 'root-app',
    name: '移动端 App',
    description: '完成性能优化与应用商店发布',
    assignee: '赵敏',
    color: '#9a3412',
    startDate: '2025-11-03',
    endDate: '2025-12-19',
    plannedEndDate: '2025-12-19',
    progress: 100,
    status: 'done',
    children: [
      {
        id: 'app-performance',
        name: '性能优化',
        description: '降低启动耗时并裁剪安装包体积',
        assignee: '陈强',
        color: null,
        startDate: '2025-11-03',
        endDate: '2025-11-28',
        plannedEndDate: '2025-11-28',
        progress: 100,
        status: 'done',
        children: [
          {
            id: 'app-performance-startup',
            name: '启动耗时',
            description: '冷启动时间从三秒降到一点五秒',
            assignee: '陈强',
            color: null,
            startDate: '2025-11-03',
            endDate: '2025-11-14',
            plannedEndDate: '2025-11-14',
            progress: 100,
            status: 'done'
          },
          {
            id: 'app-performance-size',
            name: '包体裁剪',
            description: '移除未使用资源和重复依赖',
            assignee: '孙悦',
            color: null,
            startDate: '2025-11-17',
            endDate: '2025-11-28',
            plannedEndDate: '2025-11-28',
            progress: 100,
            status: 'done'
          }
        ]
      },
      {
        id: 'app-store',
        name: '应用商店',
        description: '准备商店素材并完成审核提交',
        assignee: '王芳',
        color: null,
        startDate: '2025-12-01',
        endDate: '2025-12-19',
        plannedEndDate: '2025-12-19',
        progress: 100,
        status: 'done',
        children: [
          {
            id: 'app-store-assets',
            name: '素材准备',
            description: '更新截图、描述和隐私说明',
            assignee: '王芳',
            color: null,
            startDate: '2025-12-01',
            endDate: '2025-12-10',
            plannedEndDate: '2025-12-10',
            progress: 100,
            status: 'done'
          },
          {
            id: 'app-store-review',
            name: '审核提交',
            description: '提交商店审核并跟踪结果',
            assignee: '赵敏',
            color: null,
            startDate: '2025-12-11',
            endDate: '2025-12-19',
            plannedEndDate: '2025-12-19',
            progress: 100,
            status: 'done'
          }
        ]
      }
    ]
  }
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseDate(value) {
  var parts = String(value).split('-');
  return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function formatDate(ms) {
  var date = new Date(ms);
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function addDays(value, days) {
  return formatDate(parseDate(value) + days * 86400000);
}

function createTask(fields) {
  return {
    id: fields.id,
    parentId: fields.parentId === undefined ? null : fields.parentId,
    name: fields.name,
    description: fields.description || '',
    assignee: fields.assignee || '',
    color: fields.color === undefined ? null : fields.color,
    startDate: fields.startDate,
    endDate: fields.endDate,
    plannedEndDate: fields.plannedEndDate,
    progress: fields.progress,
    status: fields.status,
    order: fields.order,
    ganttRow: null
  };
}

function flattenTree(nodes, parentId, depth, tasks) {
  nodes.forEach(function(node, index) {
    tasks.push(createTask({
      id: node.id,
      parentId: parentId,
      name: node.name,
      description: node.description,
      assignee: node.assignee,
      color: node.color,
      startDate: node.startDate,
      endDate: node.endDate,
      plannedEndDate: node.plannedEndDate,
      progress: node.progress,
      status: node.status,
      order: index
    }));
    if (node.children && node.children.length) {
      flattenTree(node.children, node.id, depth + 1, tasks);
    }
  });
}

function createFixture(tasks, milestones) {
  return {
    pmweb_version: 3,
    tasks: tasks,
    milestones: milestones,
    links: [],
    views: [],
    settings: {
      lastView: 'gantt',
      lastGranularity: 'day',
      statusFilter: { inProgress: true, thirdParty: true, done: true },
      layoutVersion: 'workbench',
      gridWidth: 560,
      columns: null
    }
  };
}

function rangeOf(tasks) {
  var startDate = null;
  var endDate = null;
  tasks.forEach(function(task) {
    if (!startDate || task.startDate < startDate) startDate = task.startDate;
    if (!endDate || task.endDate > endDate) endDate = task.endDate;
  });
  return { startDate: startDate, endDate: endDate };
}

function averageProgress(tasks) {
  if (!tasks.length) return 0;
  var total = tasks.reduce(function(sum, task) {
    return sum + task.progress;
  }, 0);
  return Math.round(total / tasks.length);
}

function progressFor(status, index) {
  if (status === 'done') return 100;
  if (status === 'thirdParty') return 20 + ((index * 7) % 40);
  return 10 + ((index * 13) % 85);
}

function buildLargeTree() {
  var roots = [];
  var leafIndex = 0;

  for (var r = 0; r < 8; r++) {
    var rootStatus = STATUSES[r % STATUSES.length];
    var root = {
      id: 't200-root-' + pad2(r + 1),
      name: '项目 ' + pad2(r + 1),
      description: '200 行性能测试根任务 ' + pad2(r + 1),
      assignee: ASSIGNEES[r % ASSIGNEES.length],
      color: ROOT_COLORS[r % ROOT_COLORS.length],
      status: rootStatus,
      children: []
    };

    for (var c = 0; c < 4; c++) {
      var child = {
        id: 't200-child-' + pad2(r + 1) + '-' + (c + 1),
        name: '阶段 ' + pad2(r + 1) + '-' + (c + 1),
        description: '根任务 ' + pad2(r + 1) + ' 的第 ' + (c + 1) + ' 个子任务',
        assignee: ASSIGNEES[(r + c + 1) % ASSIGNEES.length],
        color: null,
        status: rootStatus,
        children: []
      };

      for (var g = 0; g < 5; g++) {
        leafIndex++;
        var startDate = addDays(BASE_DATE, r * 20 + c * 5 + g);
        var endDate = addDays(startDate, 3 + (leafIndex % 6));
        var leafStatus = rootStatus;
        child.children.push({
          id: 't200-leaf-' + pad2(r + 1) + '-' + (c + 1) + '-' + (g + 1),
          name: '任务 ' + pad2(r + 1) + '-' + (c + 1) + '-' + (g + 1),
          description: '200 行性能测试叶子任务 ' + leafIndex,
          assignee: ASSIGNEES[(r + c + g) % ASSIGNEES.length],
          color: null,
          status: leafStatus,
          progress: progressFor(leafStatus, leafIndex),
          startDate: startDate,
          endDate: endDate,
          plannedEndDate: addDays(endDate, leafIndex % 4)
        });
      }

      var childRange = rangeOf(child.children);
      child.startDate = childRange.startDate;
      child.endDate = childRange.endDate;
      child.plannedEndDate = addDays(childRange.endDate, 2);
      child.progress = averageProgress(child.children);
      root.children.push(child);
    }

    var rootRange = rangeOf(root.children);
    root.startDate = rootRange.startDate;
    root.endDate = rootRange.endDate;
    root.plannedEndDate = addDays(rootRange.endDate, 3);
    root.progress = averageProgress(root.children);
    roots.push(root);
  }

  return roots;
}

function buildThreeLevelFixture() {
  var tasks = [];
  flattenTree(SMALL_TREE, null, 0, tasks);

  var milestones = [
    {
      id: 'ms-web-launch',
      taskId: 'root-web',
      name: '官网改版上线',
      date: '2026-03-27',
      status: 'pending'
    },
    {
      id: 'ms-data-gray',
      taskId: 'data-release-gray',
      name: '数据中台灰度完成',
      date: '2026-04-17',
      status: 'done'
    }
  ];

  return createFixture(tasks, milestones);
}

function buildLargeFixture() {
  var roots = buildLargeTree();
  var tasks = [];
  flattenTree(roots, null, 0, tasks);

  var milestones = [0, 2, 5, 7].map(function(rootIndex, index) {
    var root = roots[rootIndex];
    return {
      id: 't200-ms-' + (index + 1),
      taskId: root.id,
      name: '里程碑 ' + (index + 1),
      date: addDays(root.startDate, 10),
      status: MILESTONE_STATUSES[index % MILESTONE_STATUSES.length]
    };
  });

  return createFixture(tasks, milestones);
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var parts = value.split('-');
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  return date.getUTCFullYear() === Number(parts[0]) &&
    date.getUTCMonth() === Number(parts[1]) - 1 &&
    date.getUTCDate() === Number(parts[2]);
}

function collectChildren(tasks) {
  var childrenByParent = new Map();
  tasks.forEach(function(task) {
    if (!childrenByParent.has(task.parentId)) childrenByParent.set(task.parentId, []);
    childrenByParent.get(task.parentId).push(task);
  });
  return childrenByParent;
}

function getDepth(task, byId) {
  var depth = 0;
  var cursor = task;
  var guard = 0;
  while (cursor.parentId && guard++ < 100) {
    cursor = byId.get(cursor.parentId);
    if (!cursor) return -1;
    depth++;
  }
  return depth;
}

function validateFixture(data, options) {
  var errors = [];
  var label = options.label;

  function assert(condition, message) {
    if (!condition) errors.push(message);
  }

  assert(data && data.pmweb_version === 3, label + ': pmweb_version 必须为 3');
  assert(Array.isArray(data.tasks), label + ': tasks 必须是数组');
  assert(Array.isArray(data.milestones), label + ': milestones 必须是数组');
  assert(Array.isArray(data.links), label + ': links 必须是数组');
  assert(Array.isArray(data.views), label + ': views 必须是数组');
  assert(data.links && data.links.length === 0, label + ': links 必须为空数组');

  var settings = data.settings || {};
  assert(settings.layoutVersion === 'workbench', label + ': settings.layoutVersion 必须为 workbench');
  assert(typeof settings.gridWidth === 'number' && settings.gridWidth > 0, label + ': settings.gridWidth 必须为正数');
  assert(settings.columns === null, label + ': settings.columns 必须为 null');
  assert(settings.lastView === 'gantt', label + ': settings.lastView 必须为 gantt');
  assert(settings.lastGranularity === 'day', label + ': settings.lastGranularity 必须为 day');
  assert(settings.statusFilter &&
    settings.statusFilter.inProgress === true &&
    settings.statusFilter.thirdParty === true &&
    settings.statusFilter.done === true,
    label + ': statusFilter 三项必须为 true');

  var tasks = data.tasks || [];
  assert(tasks.length === options.expectedTasks,
    label + ': 任务数应为 ' + options.expectedTasks + '，实际 ' + tasks.length);

  var byId = new Map();
  tasks.forEach(function(task) {
    assert(!byId.has(task.id), label + ': 任务 id 重复 ' + task.id);
    byId.set(task.id, task);
  });

  var childrenByParent = collectChildren(tasks);
  var depthCounts = { 0: 0, 1: 0, 2: 0 };
  var statuses = new Set();
  var statusesByDepth = { 0: new Set(), 1: new Set(), 2: new Set() };
  var roots = [];
  var childrenCount = 0;
  var leavesCount = 0;

  tasks.forEach(function(task) {
    REQUIRED_TASK_FIELDS.forEach(function(field) {
      assert(Object.prototype.hasOwnProperty.call(task, field),
        label + ': 任务 ' + task.id + ' 缺少字段 ' + field);
    });

    assert(typeof task.id === 'string' && task.id.length > 0, label + ': 任务 id 必须为非空字符串');
    assert(task.parentId === null || typeof task.parentId === 'string',
      label + ': 任务 ' + task.id + ' 的 parentId 必须为 null 或字符串');
    if (task.parentId !== null) {
      assert(byId.has(task.parentId), label + ': 任务 ' + task.id + ' 的 parentId 不存在');
    }
    assert(typeof task.name === 'string' && task.name.length > 0, label + ': 任务 ' + task.id + ' 的 name 不能为空');
    assert(typeof task.description === 'string', label + ': 任务 ' + task.id + ' 的 description 必须为字符串');
    assert(typeof task.assignee === 'string' && task.assignee.length > 0,
      label + ': 任务 ' + task.id + ' 的 assignee 不能为空');
    assert(task.color === null || /^#[0-9a-fA-F]{6}$/.test(task.color),
      label + ': 任务 ' + task.id + ' 的 color 必须为 null 或十六进制颜色');
    assert(STATUSES.indexOf(task.status) !== -1,
      label + ': 任务 ' + task.id + ' 的 status 非法 ' + task.status);
    assert(typeof task.progress === 'number' && isFinite(task.progress) &&
      task.progress >= 0 && task.progress <= 100 && task.progress % 1 === 0,
      label + ': 任务 ' + task.id + ' 的 progress 必须为 0 到 100 的整数');
    assert(typeof task.order === 'number' && task.order >= 0 && task.order % 1 === 0,
      label + ': 任务 ' + task.id + ' 的 order 必须为非负整数');

    assert(isValidDateString(task.startDate), label + ': 任务 ' + task.id + ' 的 startDate 非法');
    assert(isValidDateString(task.endDate), label + ': 任务 ' + task.id + ' 的 endDate 非法');
    assert(isValidDateString(task.plannedEndDate), label + ': 任务 ' + task.id + ' 的 plannedEndDate 非法');
    if (isValidDateString(task.startDate) && isValidDateString(task.endDate)) {
      assert(task.startDate <= task.endDate, label + ': 任务 ' + task.id + ' 的结束日期早于开始日期');
    }
    if (isValidDateString(task.startDate) && isValidDateString(task.plannedEndDate)) {
      assert(task.plannedEndDate >= task.startDate, label + ': 任务 ' + task.id + ' 的计划完成早于开始日期');
    }

    var depth = getDepth(task, byId);
    assert(depth >= 0 && depth <= 2, label + ': 任务 ' + task.id + ' 层级超过 3 层');
    if (depth >= 0 && depth <= 2) {
      depthCounts[depth]++;
      statusesByDepth[depth].add(task.status);
    }
    statuses.add(task.status);

    if (task.parentId === null) roots.push(task);

    var children = childrenByParent.get(task.id) || [];
    if (children.length === 0) {
      leavesCount++;
    } else if (depth < 2) {
      var minStart = children.map(function(child) { return child.startDate; }).sort()[0];
      var maxEnd = children.map(function(child) { return child.endDate; }).sort().pop();
      assert(task.startDate === minStart,
        label + ': 父任务 ' + task.id + ' 的 startDate 应等于子任务最早开始日期');
      assert(task.endDate === maxEnd,
        label + ': 父任务 ' + task.id + ' 的 endDate 应等于子任务最晚结束日期');
    }
  });

  function validateSiblingOrders(key, list) {
    var sorted = list.slice().sort(function(a, b) { return a.order - b.order; });
    sorted.forEach(function(task, index) {
      assert(task.order === index,
        label + ': ' + key + ' 下任务 ' + task.id + ' 的 order 应为 ' + index + '，实际 ' + task.order);
    });
  }

  validateSiblingOrders('根任务', roots);
  childrenByParent.forEach(function(list, parentId) {
    if (parentId !== null) validateSiblingOrders('父任务 ' + parentId, list);
  });

  assert(roots.length === options.expectedRoots,
    label + ': 根任务数应为 ' + options.expectedRoots + '，实际 ' + roots.length);
  assert(depthCounts[0] === options.expectedRoots,
    label + ': 深度 0 任务数应为 ' + options.expectedRoots + '，实际 ' + depthCounts[0]);
  assert(depthCounts[1] === options.expectedChildren,
    label + ': 深度 1 任务数应为 ' + options.expectedChildren + '，实际 ' + depthCounts[1]);
  assert(depthCounts[2] === options.expectedLeaves,
    label + ': 深度 2 任务数应为 ' + options.expectedLeaves + '，实际 ' + depthCounts[2]);
  assert(leavesCount === options.expectedLeaves,
    label + ': 叶子任务数应为 ' + options.expectedLeaves + '，实际 ' + leavesCount);

  STATUSES.forEach(function(status) {
    assert(statuses.has(status), label + ': 未覆盖状态 ' + status);
    if (options.requireDepthStatusCoverage) {
      [0, 1, 2].forEach(function(depth) {
        assert(statusesByDepth[depth].has(status),
          label + ': 深度 ' + depth + ' 未覆盖状态 ' + status);
      });
    }
  });

  var milestones = data.milestones || [];
  assert(milestones.length === options.expectedMilestones,
    label + ': 里程碑数应为 ' + options.expectedMilestones + '，实际 ' + milestones.length);
  var milestoneIds = new Set();
  milestones.forEach(function(milestone) {
    assert(typeof milestone.id === 'string' && milestone.id.length > 0,
      label + ': 里程碑 id 不能为空');
    assert(!milestoneIds.has(milestone.id), label + ': 里程碑 id 重复 ' + milestone.id);
    milestoneIds.add(milestone.id);
    assert(typeof milestone.name === 'string' && milestone.name.length > 0,
      label + ': 里程碑 ' + milestone.id + ' 的 name 不能为空');
    assert(MILESTONE_STATUSES.indexOf(milestone.status) !== -1,
      label + ': 里程碑 ' + milestone.id + ' 的 status 非法 ' + milestone.status);
    assert(isValidDateString(milestone.date), label + ': 里程碑 ' + milestone.id + ' 的 date 非法');
    var task = byId.get(milestone.taskId);
    assert(!!task, label + ': 里程碑 ' + milestone.id + ' 的 taskId 不存在');
    if (task && isValidDateString(milestone.date)) {
      assert(milestone.date >= task.startDate && milestone.date <= task.endDate,
        label + ': 里程碑 ' + milestone.id + ' 的日期超出任务范围');
    }
  });

  var visibleRows = 0;
  (function countVisible(parentId) {
    var list = parentId === null ? roots : (childrenByParent.get(parentId) || []);
    list.forEach(function(task) {
      visibleRows++;
      countVisible(task.id);
    });
  })(null);
  assert(visibleRows === options.expectedRows,
    label + ': 展开状态可见行数应为 ' + options.expectedRows + '，实际 ' + visibleRows);

  if (errors.length) {
    throw new Error(label + ' 校验失败：\n- ' + errors.slice(0, 40).join('\n- '));
  }
}

function writeFixture(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

if (require.main === module) {
  var small = buildThreeLevelFixture();
  var large = buildLargeFixture();

  validateFixture(small, {
    label: 'tasks-3-level.json',
    expectedTasks: 27,
    expectedRows: 27,
    expectedRoots: 3,
    expectedChildren: 8,
    expectedLeaves: 16,
    expectedMilestones: 2,
    requireDepthStatusCoverage: true
  });
  validateFixture(large, {
    label: 'tasks-200.json',
    expectedTasks: 200,
    expectedRows: 200,
    expectedRoots: 8,
    expectedChildren: 32,
    expectedLeaves: 160,
    expectedMilestones: 4,
    requireDepthStatusCoverage: false
  });

  writeFixture(SMALL_FILE, small);
  writeFixture(LARGE_FILE, large);

  console.log('写出 ' + path.relative(process.cwd(), SMALL_FILE) +
    '：' + small.tasks.length + ' 个任务，' + small.milestones.length + ' 个里程碑');
  console.log('写出 ' + path.relative(process.cwd(), LARGE_FILE) +
    '：' + large.tasks.length + ' 个任务，' + large.milestones.length + ' 个里程碑');
  console.log('fixture 校验通过');
}

module.exports = {
  buildThreeLevelFixture: buildThreeLevelFixture,
  buildLargeFixture: buildLargeFixture,
  validateFixture: validateFixture,
  addDays: addDays
};
