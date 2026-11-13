'use strict';

const assert = require('node:assert');
const { validateData } = require('../../js/validate.js');

let passed = 0;
let failed = 0;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseData() {
  return {
    pmweb_version: 3,
    tasks: [
      {
        id: 't1',
        parentId: null,
        name: '需求设计',
        status: 'inProgress',
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        order: 0,
        progress: 40,
        plannedEndDate: '2026-01-12',
        assignee: '',
        description: ''
      },
      {
        id: 't2',
        parentId: 't1',
        name: '接口开发',
        status: 'thirdParty',
        startDate: '2026-01-05',
        endDate: '2026-01-20',
        order: 1,
        progress: 30,
        plannedEndDate: null,
        assignee: '',
        description: ''
      }
    ],
    milestones: [
      { id: 'm1', taskId: 't2', name: '联调', date: '2026-01-15', status: 'pending' }
    ],
    links: [],
    views: [],
    settings: {
      layoutVersion: 'workbench',
      gridWidth: 560,
      columns: null,
      statusFilter: { inProgress: true, thirdParty: true, done: true }
    }
  };
}

function expectValid(name, data) {
  try {
    const result = validateData(data);
    assert.strictEqual(result.valid, true, 'expected valid, got errors: ' + JSON.stringify(result.errors));
    assert.deepStrictEqual(result.errors, []);
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + '\n  ' + error.message);
  }
}

function expectError(name, data, expectedPath) {
  try {
    const result = validateData(data);
    assert.strictEqual(result.valid, false, 'expected invalid result');
    const matched = result.errors.some(function (error) {
      return error.path === expectedPath &&
        typeof error.message === 'string' &&
        error.message.length > 0;
    });
    assert.ok(matched, 'expected error at ' + expectedPath + ', got ' + JSON.stringify(result.errors));
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + '\n  ' + error.message);
  }
}

function expectCycle(name, data) {
  try {
    const result = validateData(data);
    assert.strictEqual(result.valid, false, 'expected invalid result');
    const matched = result.errors.some(function (error) {
      return /cycle/.test(error.message) && /parentId$/.test(error.path);
    });
    assert.ok(matched, 'expected a parent cycle error, got ' + JSON.stringify(result.errors));
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + '\n  ' + error.message);
  }
}

expectValid('合法 v3 数据通过', baseData());

const missingName = baseData();
delete missingName.tasks[0].name;
expectError('缺少 name 字段', missingName, 'tasks[0].name');

const missingStatus = baseData();
delete missingStatus.tasks[1].status;
expectError('缺少 status 字段', missingStatus, 'tasks[1].status');

const invalidStatus = baseData();
invalidStatus.tasks[0].status = 'blocked';
expectError('非法 status', invalidStatus, 'tasks[0].status');

const negativeProgress = baseData();
negativeProgress.tasks[0].progress = -1;
expectError('progress 小于 0', negativeProgress, 'tasks[0].progress');

const oversizedProgress = baseData();
oversizedProgress.tasks[1].progress = 101;
expectError('progress 大于 100', oversizedProgress, 'tasks[1].progress');

const orphanParent = baseData();
orphanParent.tasks[1].parentId = 'ghost';
expectError('孤儿 parentId', orphanParent, 'tasks[1].parentId');

const mutualCycle = baseData();
mutualCycle.tasks[0].parentId = 't2';
mutualCycle.tasks[1].parentId = 't1';
expectCycle('父子环', mutualCycle);

const selfCycle = baseData();
selfCycle.tasks[0].parentId = 't1';
expectCycle('自引用环', selfCycle);

const impossibleDate = baseData();
impossibleDate.tasks[0].plannedEndDate = '2026-02-30';
expectError('非法日期 2026-02-30', impossibleDate, 'tasks[0].plannedEndDate');

const wrongDateFormat = baseData();
wrongDateFormat.tasks[0].plannedEndDate = '2026/01/12';
expectError('非法日期格式', wrongDateFormat, 'tasks[0].plannedEndDate');

const orphanMilestone = clone(baseData());
orphanMilestone.milestones[0].taskId = 'missing-task';
expectError('里程碑指向不存在的任务', orphanMilestone, 'milestones[0].taskId');

const wrongVersion = baseData();
wrongVersion.pmweb_version = 2;
expectError('版本不是 3', wrongVersion, 'pmweb_version');

const badLinks = baseData();
badLinks.links = {};
expectError('links 不是数组', badLinks, 'links');

const badViews = baseData();
badViews.views = 'none';
expectError('views 不是数组', badViews, 'views');

const badSettings = baseData();
badSettings.settings = [];
expectError('settings 不是对象', badSettings, 'settings');

expectError('根节点不是对象', null, '$');

function baseWorkspace() {
  return {
    pmweb_version: 4,
    projects: [
      {
        id: 'p1',
        name: '项目一',
        status: 'active',
        archived: false,
        data: baseData()
      }
    ],
    settings: { startupMode: 'choose' },
    recycleBin: []
  };
}

expectValid('合法 v4 工作区数据通过', baseWorkspace());

const wsBadVersion = baseWorkspace();
wsBadVersion.pmweb_version = 5;
expectError('v4 工作区版本错误', wsBadVersion, 'pmweb_version');

const wsBadProjects = baseWorkspace();
wsBadProjects.projects = 'not-array';
expectError('projects 不是数组', wsBadProjects, 'projects');

const wsMissingProjName = baseWorkspace();
wsMissingProjName.projects[0].name = '';
expectError('项目名称为空', wsMissingProjName, 'projects[0].name');

const wsBadProjData = baseWorkspace();
delete wsBadProjData.projects[0].data.tasks[0].name;
expectError('项目内数据校验错误', wsBadProjData, 'projects[0].data.tasks[0].name');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exitCode = 1;
}
