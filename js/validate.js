(function (root) {
  'use strict';

  var STATUSES = ['todo', 'inProgress', 'thirdParty', 'done'];
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  var ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  var REQUIRED_TASK_FIELDS = [
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

  function isValidId(value) {
    return typeof value === 'string' && ID_PATTERN.test(value);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function isDate(value) {
    if (typeof value !== 'string') return false;
    var parts = DATE_PATTERN.exec(value);
    if (!parts) return false;
    var year = Number(parts[1]);
    var month = Number(parts[2]);
    var day = Number(parts[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    var date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
  }

  function hasField(object, field) {
    return Object.prototype.hasOwnProperty.call(object, field);
  }

  function detectCycles(tasks, add) {
    var byId = new Map();
    tasks.forEach(function (task) {
      if (isObject(task) && isNonEmptyString(task.id) && !byId.has(task.id)) {
        byId.set(task.id, task);
      }
    });

    var settled = new Set();
    var reported = new Set();

    tasks.forEach(function (task, index) {
      if (!isObject(task) || !isNonEmptyString(task.id)) return;

      var chain = [];
      var seen = new Map();
      var currentId = task.id;

      while (isNonEmptyString(currentId)) {
        if (seen.has(currentId)) {
          var cycle = chain.slice(seen.get(currentId));
          var key = cycle.slice().sort().join('\n');
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
        var current = byId.get(currentId);
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

  function validateProjectData(data, prefix) {
    prefix = prefix || '';
    var errors = [];
    function add(path, message) {
      errors.push({ path: prefix ? (prefix + path) : path, message: message });
    }

    if (!isObject(data)) {
      add('$', 'data must be an object');
      return { valid: false, errors: errors };
    }

    if (data.pmweb_version !== 3) {
      add('pmweb_version', 'must be 3');
    }

    var taskIds = new Set();
    var tasksIsArray = Array.isArray(data.tasks);

    if (!tasksIsArray) {
      add('tasks', 'must be an array');
    } else {
      data.tasks.forEach(function (task, index) {
        var base = 'tasks[' + index + ']';
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
          } else if (!isValidId(task.id)) {
            add(base + '.id', 'must match ^[A-Za-z0-9_-]{1,128}$');
          } else if (taskIds.has(task.id)) {
            add(base + '.id', 'duplicates task id "' + task.id + '"');
          } else {
            taskIds.add(task.id);
          }
        }

        if (hasField(task, 'name') && !isNonEmptyString(task.name)) {
          add(base + '.name', 'must be a non-empty string');
        }

        if (hasField(task, 'parentId') && task.parentId !== null) {
          if (!isNonEmptyString(task.parentId)) {
            add(base + '.parentId', 'must be null or a non-empty string');
          } else if (!isValidId(task.parentId)) {
            add(base + '.parentId', 'must match ^[A-Za-z0-9_-]{1,128}$');
          }
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

        if (hasField(task, 'customFields') && task.customFields !== null && task.customFields !== undefined) {
          if (!isObject(task.customFields)) {
            add(base + '.customFields', 'must be an object or null');
          }
        }
      });

      data.tasks.forEach(function (task, index) {
        if (!isObject(task)) return;
        if (isNonEmptyString(task.parentId) && !taskIds.has(task.parentId)) {
          add('tasks[' + index + '].parentId', 'references unknown task id "' + task.parentId + '"');
        }
      });

      detectCycles(data.tasks, add);
    }

    var milestoneIds = new Set();
    if (!Array.isArray(data.milestones)) {
      add('milestones', 'must be an array');
    } else {
      data.milestones.forEach(function (milestone, index) {
        var base = 'milestones[' + index + ']';
        if (!isObject(milestone)) {
          add(base, 'must be an object');
          return;
        }
        if (!hasField(milestone, 'id')) {
          add(base + '.id', 'is required');
        } else if (!isValidId(milestone.id)) {
          add(base + '.id', 'must match ^[A-Za-z0-9_-]{1,128}$');
        } else if (milestoneIds.has(milestone.id)) {
          add(base + '.id', 'duplicates milestone id "' + milestone.id + '"');
        } else {
          milestoneIds.add(milestone.id);
        }
        if (!hasField(milestone, 'taskId')) {
          add(base + '.taskId', 'is required');
        } else if (!isNonEmptyString(milestone.taskId)) {
          add(base + '.taskId', 'must be a non-empty string');
        } else if (!isValidId(milestone.taskId)) {
          add(base + '.taskId', 'must match ^[A-Za-z0-9_-]{1,128}$');
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
    } else if (hasField(data.settings, 'columns') && data.settings.columns !== null && data.settings.columns !== undefined) {
      if (!Array.isArray(data.settings.columns)) {
        add('settings.columns', 'must be an array');
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  function validateWorkspace(data) {
    var errors = [];
    function add(path, message) {
      errors.push({ path: path, message: message });
    }

    if (!isObject(data)) {
      add('$', 'data must be an object');
      return { valid: false, errors: errors };
    }

    if (data.pmweb_version !== 4) {
      add('pmweb_version', 'must be 4');
    }

    if (!Array.isArray(data.projects)) {
      add('projects', 'must be an array');
    } else {
      var projectIds = new Set();
      data.projects.forEach(function (project, index) {
        var base = 'projects[' + index + ']';
        if (!isObject(project)) {
          add(base, 'must be an object');
          return;
        }
        if (!isNonEmptyString(project.id) || !isValidId(project.id)) {
          add(base + '.id', 'must match ^[A-Za-z0-9_-]{1,128}$');
        } else if (projectIds.has(project.id)) {
          add(base + '.id', 'duplicates project id "' + project.id + '"');
        } else {
          projectIds.add(project.id);
        }

        if (!isNonEmptyString(project.name)) {
          add(base + '.name', 'must be a non-empty string');
        }

        if (hasField(project, 'data')) {
          var projRes = validateProjectData(project.data, base + '.data.');
          if (!projRes.valid) {
            projRes.errors.forEach(function (err) {
              errors.push(err);
            });
          }
        } else {
          add(base + '.data', 'is required');
        }
      });
    }

    if (hasField(data, 'settings') && !isObject(data.settings)) {
      add('settings', 'must be an object');
    }

    if (hasField(data, 'recycleBin') && !Array.isArray(data.recycleBin)) {
      add('recycleBin', 'must be an array');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  function validateData(data) {
    if (!isObject(data)) {
      return { valid: false, errors: [{ path: '$', message: 'data must be an object' }] };
    }
    if (data.pmweb_version === 4) {
      return validateWorkspace(data);
    }
    if (data.pmweb_version === 3) {
      return validateProjectData(data, '');
    }
    return {
      valid: false,
      errors: [{ path: 'pmweb_version', message: 'must be 3 or 4' }]
    };
  }

  var api = {
    validateData: validateData,
    validateWorkspace: validateWorkspace,
    validateProjectData: validateProjectData,
    isValidId: isValidId,
    ID_PATTERN: ID_PATTERN
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PMWebValidate = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
