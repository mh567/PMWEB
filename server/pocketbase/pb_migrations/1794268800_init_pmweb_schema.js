/// <reference path="../pb_data/types.d.ts" />

// P3-1 PocketBase schema.
// Target API: PocketBase v0.23+ JS migrations (Collection.fields, app.save, app.delete).
// TODO: verify every API rule against Dashboard > Collections > API Preview before production.
// TODO: the last-owner, cross-project parent/link and rev-increment invariants need pb_hooks,
// they cannot be expressed with collection API rules alone.

migrate((app) => {
  const ID_PATTERN = "^[A-Za-z0-9_-]{1,128}$";
  const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
  const MIME_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp"
  ];

  function createCollection(config) {
    app.save(new Collection(config));
    return app.findCollectionByNameOrId(config.name);
  }

  function memberRead(projectExpr) {
    return '@request.auth.id != "" && ' +
      '@collection.project_members:actor.user ?= @request.auth.id && ' +
      '@collection.project_members:actor.project ?= ' + projectExpr;
  }

  function roleWrite(roles, projectExpr) {
    let parts = [];
    for (let role of roles) {
      parts.push('@collection.project_members:actor.role = "' + role + '"');
    }
    return memberRead(projectExpr) + " && (" + parts.join(" || ") + ")";
  }

  function editorWrite(projectExpr) {
    return roleWrite(["owner", "admin", "editor"], projectExpr);
  }

  function managerWrite(projectExpr) {
    return roleWrite(["owner", "admin"], projectExpr);
  }

  function ownerWrite(projectExpr) {
    return roleWrite(["owner"], projectExpr);
  }

  function alive(rule) {
    return rule + ' && deleted_at = ""';
  }

  function keepProject(rule) {
    return rule + " && (@request.body.project:isset = false || @request.body.project = project)";
  }

  let users;
  try {
    users = app.findCollectionByNameOrId("users");
  } catch (e) {
    users = null;
  }

  if (!users) {
    users = createCollection({
      type: "auth",
      name: "users",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: "id = @request.auth.id",
      deleteRule: null,
      fields: [
        {
          name: "display_name",
          type: "text",
          max: 120
        }
      ]
    });
  } else {
    let hasDisplayName = false;
    try {
      hasDisplayName = users.fields.getByName("display_name") != null;
    } catch (e) {
      hasDisplayName = false;
    }
    if (!hasDisplayName) {
      users.fields.add(new TextField({
        name: "display_name",
        max: 120
      }));
    }
    users.listRule = '@request.auth.id != ""';
    users.viewRule = '@request.auth.id != ""';
    users.updateRule = "id = @request.auth.id";
    app.save(users);
  }

  const projects = createCollection({
    type: "base",
    name: "projects",
    listRule: alive(memberRead("id")),
    viewRule: alive(memberRead("id")),
    createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
    updateRule: managerWrite("id"),
    deleteRule: ownerWrite("id"),
    fields: [
      {
        name: "name",
        type: "text",
        required: true,
        max: 200
      },
      {
        name: "description",
        type: "text",
        max: 5000
      },
      {
        name: "owner",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["active", "archived"]
      },
      {
        name: "import_version",
        type: "number",
        onlyInt: true,
        min: 0
      },
      {
        name: "settings",
        type: "json"
      },
      {
        name: "rev",
        type: "number",
        onlyInt: true,
        min: 0
      },
      {
        name: "updated_by",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "deleted_at",
        type: "date"
      }
    ],
    indexes: [
      "CREATE INDEX idx_projects_owner ON projects (owner)",
      "CREATE INDEX idx_projects_status ON projects (status)"
    ]
  });

  createCollection({
    type: "base",
    name: "project_members",
    listRule: memberRead("project"),
    viewRule: memberRead("project"),
    createRule: '@request.auth.id != "" && (' +
      '(@request.body.role = "owner" && @request.body.user = @request.auth.id && ' +
      '@collection.projects:target.id ?= @request.body.project && ' +
      '@collection.projects:target.owner ?= @request.auth.id) || (' +
      managerWrite("@request.body.project") + "))",
    updateRule: keepProject(managerWrite("project")),
    deleteRule: managerWrite("project"),
    fields: [
      {
        name: "project",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: projects.id,
        cascadeDelete: true
      },
      {
        name: "user",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: true
      },
      {
        name: "role",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["owner", "admin", "editor", "viewer"]
      },
      {
        name: "invited_by",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_project_members_unique ON project_members (project, user)",
      "CREATE INDEX idx_project_members_user ON project_members (user)",
      "CREATE INDEX idx_project_members_role ON project_members (project, role)"
    ]
  });

  let tasks = createCollection({
    type: "base",
    name: "tasks",
    listRule: alive(memberRead("project")),
    viewRule: alive(memberRead("project")),
    createRule: editorWrite("project"),
    updateRule: keepProject(editorWrite("project")),
    deleteRule: editorWrite("project"),
    fields: [
      {
        name: "project",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: projects.id,
        cascadeDelete: true
      },
      {
        name: "client_id",
        type: "text",
        required: true,
        max: 128,
        pattern: ID_PATTERN
      },
      {
        name: "name",
        type: "text",
        required: true,
        max: 500
      },
      {
        name: "description",
        type: "text",
        max: 5000
      },
      {
        name: "assignee",
        type: "text",
        max: 120
      },
      {
        name: "color",
        type: "text",
        max: 32
      },
      {
        name: "start_date",
        type: "text",
        max: 10,
        pattern: DATE_PATTERN
      },
      {
        name: "end_date",
        type: "text",
        max: 10,
        pattern: DATE_PATTERN
      },
      {
        name: "planned_end_date",
        type: "text",
        max: 10,
        pattern: DATE_PATTERN
      },
      {
        name: "progress",
        type: "number",
        min: 0,
        max: 100,
        onlyInt: true
      },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["inProgress", "thirdParty", "done"]
      },
      {
        name: "sort_order",
        type: "number"
      },
      {
        name: "gantt_row",
        type: "number"
      },
      {
        name: "estimated_hours",
        type: "number",
        min: 0
      },
      {
        name: "locked",
        type: "bool"
      },
      {
        name: "rev",
        type: "number",
        onlyInt: true,
        min: 0
      },
      {
        name: "updated_by",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "deleted_at",
        type: "date"
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_tasks_project_client ON tasks (project, client_id)",
      "CREATE INDEX idx_tasks_project_status ON tasks (project, status)",
      "CREATE INDEX idx_tasks_project_sort ON tasks (project, sort_order)",
      "CREATE INDEX idx_tasks_project_assignee ON tasks (project, assignee)"
    ]
  });

  tasks.fields.add(new RelationField({
    name: "parent",
    maxSelect: 1,
    collectionId: tasks.id,
    cascadeDelete: false
  }));
  app.save(tasks);

  tasks = app.findCollectionByNameOrId("tasks");
  tasks.addIndex("idx_tasks_project_parent", false, "project, parent", "");
  app.save(tasks);

  createCollection({
    type: "base",
    name: "milestones",
    listRule: alive(memberRead("project")),
    viewRule: alive(memberRead("project")),
    createRule: editorWrite("project"),
    updateRule: keepProject(editorWrite("project")),
    deleteRule: editorWrite("project"),
    fields: [
      {
        name: "project",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: projects.id,
        cascadeDelete: true
      },
      {
        name: "client_id",
        type: "text",
        required: true,
        max: 128,
        pattern: ID_PATTERN
      },
      {
        name: "task",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: tasks.id,
        cascadeDelete: true
      },
      {
        name: "name",
        type: "text",
        required: true,
        max: 500
      },
      {
        name: "date",
        type: "text",
        max: 10,
        pattern: DATE_PATTERN
      },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["pending", "done"]
      },
      {
        name: "rev",
        type: "number",
        onlyInt: true,
        min: 0
      },
      {
        name: "updated_by",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "deleted_at",
        type: "date"
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_milestones_project_client ON milestones (project, client_id)",
      "CREATE INDEX idx_milestones_task ON milestones (task)",
      "CREATE INDEX idx_milestones_project_date ON milestones (project, date)"
    ]
  });

  createCollection({
    type: "base",
    name: "links",
    listRule: alive(memberRead("project")),
    viewRule: alive(memberRead("project")),
    createRule: editorWrite("project"),
    updateRule: keepProject(editorWrite("project")),
    deleteRule: editorWrite("project"),
    fields: [
      {
        name: "project",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: projects.id,
        cascadeDelete: true
      },
      {
        name: "client_id",
        type: "text",
        required: true,
        max: 128,
        pattern: ID_PATTERN
      },
      {
        name: "source",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: tasks.id,
        cascadeDelete: true
      },
      {
        name: "target",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: tasks.id,
        cascadeDelete: true
      },
      {
        name: "type",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["FS", "SS", "FF", "SF"]
      },
      {
        name: "lag",
        type: "number"
      },
      {
        name: "rev",
        type: "number",
        onlyInt: true,
        min: 0
      },
      {
        name: "updated_by",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "deleted_at",
        type: "date"
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_links_project_client ON links (project, client_id)",
      "CREATE INDEX idx_links_project_source ON links (project, source)",
      "CREATE INDEX idx_links_project_target ON links (project, target)"
    ]
  });

  createCollection({
    type: "base",
    name: "comments",
    listRule: alive(memberRead("project")),
    viewRule: alive(memberRead("project")),
    createRule: editorWrite("project") + ' && @request.body.author = @request.auth.id',
    updateRule: keepProject(editorWrite("project")),
    deleteRule: editorWrite("project"),
    fields: [
      {
        name: "project",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: projects.id,
        cascadeDelete: true
      },
      {
        name: "client_id",
        type: "text",
        required: true,
        max: 128,
        pattern: ID_PATTERN
      },
      {
        name: "task",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: tasks.id,
        cascadeDelete: true
      },
      {
        name: "author",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "author_name",
        type: "text",
        required: true,
        max: 120
      },
      {
        name: "text",
        type: "text",
        required: true,
        max: 2000
      },
      {
        name: "created_at",
        type: "date"
      },
      {
        name: "updated_at",
        type: "date"
      },
      {
        name: "rev",
        type: "number",
        onlyInt: true,
        min: 0
      },
      {
        name: "updated_by",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "deleted_at",
        type: "date"
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_comments_project_client ON comments (project, client_id)",
      "CREATE INDEX idx_comments_task_created ON comments (task, created_at)"
    ]
  });

  createCollection({
    type: "base",
    name: "activity",
    listRule: memberRead("project"),
    viewRule: memberRead("project"),
    createRule: editorWrite("project") + ' && @request.body.actor = @request.auth.id',
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "project",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: projects.id,
        cascadeDelete: true
      },
      {
        name: "client_id",
        type: "text",
        required: true,
        max: 128,
        pattern: ID_PATTERN
      },
      {
        name: "task",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: tasks.id,
        cascadeDelete: true
      },
      {
        name: "actor",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "actor_name",
        type: "text",
        required: true,
        max: 120
      },
      {
        name: "field",
        type: "text",
        required: true,
        max: 64
      },
      {
        name: "before_json",
        type: "json"
      },
      {
        name: "after_json",
        type: "json"
      },
      {
        name: "at",
        type: "date",
        required: true
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_activity_project_client ON activity (project, client_id)",
      "CREATE INDEX idx_activity_task_at ON activity (task, at)"
    ]
  });

  createCollection({
    type: "base",
    name: "attachments",
    listRule: alive(memberRead("project")),
    viewRule: alive(memberRead("project")),
    createRule: editorWrite("project"),
    updateRule: keepProject(editorWrite("project")),
    deleteRule: editorWrite("project"),
    fields: [
      {
        name: "project",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: projects.id,
        cascadeDelete: true
      },
      {
        name: "client_id",
        type: "text",
        required: true,
        max: 128,
        pattern: ID_PATTERN
      },
      {
        name: "task",
        type: "relation",
        required: true,
        maxSelect: 1,
        collectionId: tasks.id,
        cascadeDelete: true
      },
      {
        name: "name",
        type: "text",
        required: true,
        max: 255
      },
      {
        name: "size",
        type: "number",
        min: 0,
        max: 10485760,
        onlyInt: true
      },
      {
        name: "type",
        type: "text",
        max: 100
      },
      {
        name: "file",
        type: "file",
        maxSelect: 1,
        maxSize: 10485760,
        mimeTypes: MIME_TYPES,
        protected: true
      },
      {
        name: "checksum",
        type: "text",
        max: 64
      },
      {
        name: "storage_key",
        type: "text",
        max: 255
      },
      {
        name: "created_at",
        type: "date"
      },
      {
        name: "rev",
        type: "number",
        onlyInt: true,
        min: 0
      },
      {
        name: "updated_by",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "deleted_at",
        type: "date"
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_attachments_project_client ON attachments (project, client_id)",
      "CREATE INDEX idx_attachments_task ON attachments (task)",
      "CREATE INDEX idx_attachments_project ON attachments (project)"
    ]
  });
}, (app) => {
  const names = [
    "attachments",
    "activity",
    "comments",
    "links",
    "milestones",
    "tasks",
    "project_members",
    "projects"
  ];

  for (let name of names) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (e) {
      // Collection is already gone.
    }
  }
});
