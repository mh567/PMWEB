/// <reference path="../pb_data/types.d.ts" />

// P3-2 PocketBase schema: audit_log and share_links.
// Target API: PocketBase v0.23+ JS migrations.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const projects = app.findCollectionByNameOrId("projects");

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

  function managerWrite(projectExpr) {
    return roleWrite(["owner", "admin"], projectExpr);
  }

  // 1. audit_log
  app.save(new Collection({
    name: "audit_log",
    type: "base",
    listRule: memberRead("project"),
    viewRule: memberRead("project"),
    createRule: null, // 服务端写事务或 hook 写入，客户端不可直接伪造
    updateRule: null, // 禁止修改，保证防篡改审计
    deleteRule: null, // 禁止删除
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
        name: "actor",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      },
      {
        name: "actor_name",
        type: "text",
        max: 120
      },
      {
        name: "action",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["create", "update", "delete", "restore"]
      },
      {
        name: "entity_type",
        type: "text",
        required: true,
        max: 64
      },
      {
        name: "entity_id",
        type: "text",
        required: true,
        max: 128
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
        name: "request_id",
        type: "text",
        max: 128
      },
      {
        name: "at",
        type: "date",
        required: true
      }
    ],
    indexes: [
      "CREATE INDEX idx_audit_log_project_at ON audit_log (project, at)",
      "CREATE INDEX idx_audit_log_project_entity ON audit_log (project, entity_type, entity_id)"
    ]
  }));

  // 2. share_links
  app.save(new Collection({
    name: "share_links",
    type: "base",
    listRule: managerWrite("project"),
    viewRule: managerWrite("project"),
    createRule: managerWrite("project"),
    updateRule: managerWrite("project"),
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
        name: "token_hash",
        type: "text",
        required: true,
        max: 64
      },
      {
        name: "scope_json",
        type: "json"
      },
      {
        name: "role",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["viewer"]
      },
      {
        name: "expires_at",
        type: "date"
      },
      {
        name: "revoked_at",
        type: "date"
      },
      {
        name: "created_by",
        type: "relation",
        maxSelect: 1,
        collectionId: users.id,
        cascadeDelete: false
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_share_links_token ON share_links (token_hash)",
      "CREATE INDEX idx_share_links_project ON share_links (project)"
    ]
  }));
}, (app) => {
  const names = ["share_links", "audit_log"];
  for (let name of names) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (e) {
      // Collection is already gone.
    }
  }
});
