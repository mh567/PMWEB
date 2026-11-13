'use strict';

const STATUSES = ['inProgress', 'thirdParty', 'done'];
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const REQUIRED_TASK_FIELDS = [
  'id',
  'parentId',
  'name',
  'status',
  'startDate',
  'endDate',
  'order',
  'progress',
  'plannedEndDate'
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isDate(value) {
  if (typeof value !== 'string') return false;
  const parts = DATE_PATTERN.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function hasField(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function detectCycles(tasks, add) {
  const byId = new Map();
  tasks.forEach(function (task) {
    if (isObject(task) && isNonEmptyString(task.id) && !byId.has(task.id)) {
      byId.set(task.id, task);
    }
  });

  const settled = new Set();
  const reported = new Set();

  tasks.forEach(function (task, index) {
    if (!isObject(task) || !isNonEmptyString(task.id)) return;

    const chain = [];
    const seen = new Map();
    let currentId = task.id;

    while (isNonEmptyString(currentId)) {
      if (seen.has(currentId)) {
        const cycle = chain.slice(seen.get(currentId));
        const key = cycle.slice().sort().join('\n');
        if (!reported.has(key)) {
          reported.add(key);
          add(
            'tasks[' + index + '].parentId',
            'parent cycle detected: ' + cycle.concat(currentId).join(' -> ')
          );
        }
        break;
      }
      if (settled.has(currentId)) break;
      const current = byId.get(currentId);
      if (!current) break;
      seen.set(currentId, chain.length);
      chain.push(currentId);
      currentId = current.parentId;
    }

    chain.forEach(function (id) {
      settled.add(id);
    });
  });
}

function validateData(data) {
  const errors = [];
  function add(path, message) {
    errors.push({ path: path, message: message });
  }

  if (!isObject(data)) {
    add('$', 'data must be an object');
    return { valid: false, errors: errors };
  }

  if (data.pmweb_version !== 3) {
    add('pmweb_version', 'must be 3');
  }

  const taskIds = new Set();
  const tasksIsArray = Array.isArray(data.tasks);

  if (!tasksIsArray) {
    add('tasks', 'must be an array');
  } else {
    data.tasks.forEach(function (task, index) {
      const base = 'tasks[' + index + ']';
      if (!isObject(task)) {
        add(base, 'must be an object');
        return;
      }

      REQUIRED_TASK_FIELDS.forEach(function (field) {
        if (!hasField(task, field)) {
          add(base + '.' + field, 'is required');
        }
      });

      if (hasField(task, 'id')) {
        if (!isNonEmptyString(task.id)) {
          add(base + '.id', 'must be a non-empty string');
        } else if (taskIds.has(task.id)) {
          add(base + '.id', 'duplicates task id "' + task.id + '"');
        } else {
          taskIds.add(task.id);
        }
      }

      if (hasField(task, 'name') && !isNonEmptyString(task.name)) {
        add(base + '.name', 'must be a non-empty string');
      }

      if (hasField(task, 'parentId') && task.parentId !== null && !isNonEmptyString(task.parentId)) {
        add(base + '.parentId', 'must be null or a non-empty string');
      }

      if (hasField(task, 'status') && STATUSES.indexOf(task.status) === -1) {
        add(base + '.status', 'must be one of ' + STATUSES.join(', '));
      }

      if (hasField(task, 'order') && (typeof task.order !== 'number' || !isFinite(task.order))) {
        add(base + '.order', 'must be a finite number');
      }

      if (hasField(task, 'progress')) {
        if (
          typeof task.progress !== 'number' ||
          !isFinite(task.progress) ||
          task.progress < 0 ||
          task.progress > 100
        ) {
          add(base + '.progress', 'must be a number between 0 and 100');
        }
      }

      ['startDate', 'endDate', 'plannedEndDate'].forEach(function (field) {
        if (!hasField(task, field)) return;
        if (task[field] !== null && !isDate(task[field])) {
          add(base + '.' + field, 'must be a YYYY-MM-DD date or null');
        }
      });
    });

    data.tasks.forEach(function (task, index) {
      if (!isObject(task)) return;
      if (isNonEmptyString(task.parentId) && !taskIds.has(task.parentId)) {
        add('tasks[' + index + '].parentId', 'references unknown task id "' + task.parentId + '"');
      }
    });

    detectCycles(data.tasks, add);
  }

  if (!Array.isArray(data.milestones)) {
    add('milestones', 'must be an array');
  } else {
    data.milestones.forEach(function (milestone, index) {
      const base = 'milestones[' + index + ']';
      if (!isObject(milestone)) {
        add(base, 'must be an object');
        return;
      }
      if (!hasField(milestone, 'taskId')) {
        add(base + '.taskId', 'is required');
      } else if (!isNonEmptyString(milestone.taskId)) {
        add(base + '.taskId', 'must be a non-empty string');
      } else if (tasksIsArray && !taskIds.has(milestone.taskId)) {
        add(base + '.taskId', 'references unknown task id "' + milestone.taskId + '"');
      }
    });
  }

  if (!Array.isArray(data.links)) {
    add('links', 'must be an array');
  }

  if (!Array.isArray(data.views)) {
    add('views', 'must be an array');
  }

  if (!isObject(data.settings)) {
    add('settings', 'must be an object');
  }

  return { valid: errors.length === 0, errors: errors };
}

module.exports = { validateData: validateData };
