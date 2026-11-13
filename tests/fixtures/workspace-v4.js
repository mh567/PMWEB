'use strict';

function makeWorkspace() {
  return {
    pmweb_version: 4,
    projects: [
      {
        id: 'p-a',
        name: '项目 A',
        description: '测试项目 A',
        createdAt: '2026-11-11T00:00:00.000Z',
        updatedAt: '2026-11-11T00:00:00.000Z',
        status: 'active',
        archived: false,
        data: {
          pmweb_version: 3,
          tasks: [
            {
              id: 't-a',
              parentId: null,
              name: '任务 A',
              status: 'todo',
              startDate: '2026-11-11',
              endDate: '2026-11-15',
              plannedEndDate: '2026-11-15',
              order: 0,
              progress: 0,
              assignee: '',
              description: ''
            },
            {
              id: 't-a-child',
              parentId: 't-a',
              name: '子任务 A',
              status: 'inProgress',
              startDate: '2026-11-12',
              endDate: '2026-11-14',
              plannedEndDate: '2026-11-14',
              order: 0,
              progress: 50,
              assignee: '',
              description: ''
            }
          ],
          milestones: [
            { id: 'm-a', taskId: 't-a', name: '节点 A', date: '2026-11-15', status: 'pending' }
          ],
          links: [],
          views: [],
          comments: [
            { id: 'c-a', taskId: 't-a', author: 'tester', text: '评论 A', createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z' }
          ],
          activity: [],
          attachments: [
            { id: 'a-a', taskId: 't-a', name: '附件 A.txt', size: 100, type: 'text/plain', blobKey: 'blob-a', createdAt: '2026-11-11T00:00:00.000Z' }
          ],
          settings: {
            layoutVersion: 'workbench',
            gridWidth: 560,
            columns: null,
            statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true }
          }
        }
      },
      {
        id: 'p-b',
        name: '项目 B',
        description: '测试项目 B',
        createdAt: '2026-11-11T00:00:00.000Z',
        updatedAt: '2026-11-11T00:00:00.000Z',
        status: 'active',
        archived: false,
        data: {
          pmweb_version: 3,
          tasks: [
            {
              id: 't-b',
              parentId: null,
              name: '任务 B',
              status: 'inProgress',
              startDate: '2026-11-10',
              endDate: '2026-11-20',
              plannedEndDate: '2026-11-20',
              order: 0,
              progress: 20,
              assignee: '',
              description: ''
            }
          ],
          milestones: [],
          links: [],
          views: [],
          comments: [],
          activity: [],
          attachments: [],
          settings: {
            layoutVersion: 'workbench',
            gridWidth: 560,
            columns: null,
            statusFilter: { todo: true, inProgress: true, thirdParty: true, done: true }
          }
        }
      }
    ],
    settings: {
      startupMode: 'choose',
      defaultProjectId: null,
      lastProjectId: null
    },
    calendar: {
      subscribed: true,
      source: 'cg-zhou/CN',
      cacheByYear: {},
      importedByYear: {},
      lastAttemptByYear: {}
    },
    recycleBin: [],
    legacy: {}
  };
}

module.exports = {
  makeWorkspace: makeWorkspace
};
