# PocketBase 后端骨架

P3-1 的 PocketBase 集合、权限规则和迁移说明。本目录只包含 schema 与运维文档，不包含前端同步代码。

## 1. 状态与边界

- 已交付：`pb_migrations/1794268800_init_pmweb_schema.js`、本 README、`docs/design/16-pocketbase-schema.md`。
- 未执行：没有下载或启动 PocketBase，没有连接数据库，没有做端到端验证。
- 已做检查：`node --check` 通过，只证明 JavaScript 可解析。
- 目标版本：PocketBase v0.23 及以上。迁移使用 `Collection.fields`、`app.save`、`app.delete`，旧版本的 `schema` 加 `Dao` 写法不兼容。
- 语法依据：PocketBase 官方 JS 迁移、集合操作、API rules、文件字段文档。所有规则仍需在 Dashboard 的 API Preview 中逐条验证。

## 2. 目录结构

```text
server/pocketbase/
  pb_migrations/
    1794268800_init_pmweb_schema.js
  pb_data/          # 运行时生成，保存 SQLite 与附件，禁止提交
  pb_public/        # 可选，前端静态文件，运行时创建
  pb_hooks/         # 可选，后续放服务端不变量校验
  pocketbase        # 可选，二进制文件，禁止提交
  README.md
```

本目录自带 `.gitignore`，忽略 `pb_data/`、`pb_public/`、二进制文件和日志。`pb_hooks/` 保存服务端代码，不忽略。根目录 `.gitignore` 是否需要补充由仓库维护者决定。

## 3. 下载与启动

不执行下载，只记录步骤。

1. 打开 `https://github.com/pocketbase/pocketbase/releases`，选择与操作系统和 CPU 架构匹配的压缩包。
2. 解压到 `server/pocketbase/`，确认可执行文件名为 `pocketbase`。
3. 在 `server/pocketbase/` 目录启动：

```bash
./pocketbase serve --http=127.0.0.1:8090
```

默认参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--http` | `127.0.0.1:8090` | 监听地址和端口 |
| `--dir` | `./pb_data` | SQLite、附件、日志和备份目录 |
| `--migrationsDir` | `./pb_migrations` | 迁移目录 |
| `--publicDir` | `./pb_public` | 静态文件目录，可把前端放到这里实现同源 |
| `--hooksDir` | `./pb_hooks` | JS hook 目录，当前为空 |

第一次启动会自动创建 `pb_data` 并执行 `pb_migrations` 中尚未应用的迁移。

## 4. 首次管理员与迁移

### 4.1 创建第一个超级用户

启动后打开 `http://127.0.0.1:8090/_/`，按页面提示创建超级用户。也可以在启动前使用 CLI：

```bash
./pocketbase superuser upsert admin@example.com '请替换为强密码'
```

CLI 子命令在不同版本间可能调整，执行前先运行 `./pocketbase superuser --help` 核对参数。超级用户只用于运维和后台管理，不参与项目成员权限。

### 4.2 执行迁移

`serve` 会自动应用新迁移。需要手动控制时：

```bash
./pocketbase migrate up
./pocketbase migrate down
```

手动执行迁移后需要重启 `serve`，让它重新加载集合缓存。不要修改已经应用过的迁移文件，需要变更时新增一个迁移。

`--automigrate` 默认开启。从 Dashboard 修改集合会在 `pb_migrations` 生成额外文件。开发阶段要及时清理中间迁移，或用 `./pocketbase migrate collections` 生成基线快照，避免生产环境重复执行历史变更。

### 4.3 回滚

`migrate down` 会删除本迁移创建的 8 个业务集合，属于破坏性操作。生产环境回滚前先备份 `pb_data`。`users` 集合可能来自 PocketBase 初始安装，回滚时保留，不删除认证用户。

## 5. 备份与恢复

需要备份三部分，恢复点必须一致：

1. `pb_data/data.db` 及同目录的 WAL 文件。
2. `pb_data/storage/` 中的附件二进制。
3. 迁移历史和审计数据，当前仍在 `data.db` 中。

推荐方式：

- 停止 `serve` 后整体复制 `pb_data/`，这是最简单且一致的方式。
- 或使用 Dashboard 的 Settings > Backups。该功能会生成一致性快照。
- 运行中直接复制 `data.db` 可能得到不一致的 WAL 状态，不推荐。

恢复步骤：

1. 停止 `serve`。
2. 备份当前 `pb_data/`，便于再次回退。
3. 用备份覆盖 `pb_data/`。
4. 启动 `serve`，确认迁移历史和集合数量正常。

## 6. 环境变量与端口

PocketBase 的配置以 CLI 参数为主。本仓库没有增加自定义环境变量层。

- 端口：默认 `8090`，内网部署可改为 `0.0.0.0:8090`，公网部署建议放在反向代理后面并启用 HTTPS。
- 数据目录：用 `--dir` 指向独立磁盘路径，便于备份和容量监控。
- 附件加密密钥：`--encryptionEnv=PB_ENCRYPTION_KEY` 会从同名环境变量读取密钥。密钥丢失后加密数据无法恢复，必须和备份分开保管。
- 静态前端：把 `index.html`、`css/`、`js/` 放到 `pb_public/` 后，前端和 API 同源，避免 `file://` 的跨域限制。
- 未提供 `docker-compose.yml`：官方没有固定镜像标签，第三方镜像和构建方式需要单独验证，避免提交未测试的部署文件。

## 7. 集合与权限概要

9 个集合：`users`、`projects`、`project_members`、`tasks`、`milestones`、`links`、`comments`、`activity`、`attachments`。

角色：`owner`、`admin`、`editor`、`viewer`。

规则概要：

- 项目成员可读项目内数据，`viewer` 只读。
- `editor` 及以上可写任务、里程碑、依赖、评论、活动和附件。
- `owner`、`admin` 可管理成员和项目信息。
- 只有 `owner` 可删除项目。
- 附件文件字段标记为受保护，访问时校验集合的 view 规则并需要短期 file token。

详细字段、规则原文和权限矩阵见 `docs/design/16-pocketbase-schema.md`。

## 8. 从 localStorage v3 导入

### 8.1 关键约束

PocketBase 记录 ID 固定为 15 位小写字母和数字。现有任务 ID 形如 `web-req-bench`，不能直接作为 PocketBase 记录 ID。每个实体增加 `client_id` 字段保存原始 ID，服务端内部使用自己的 15 位记录 ID。所有关系字段引用 PocketBase 记录 ID，导入时必须建立 `client_id -> record.id` 映射。

### 8.2 字段映射

| localStorage v3 | 服务端 | 说明 |
|-----------------|--------|------|
| `pmweb_version` | `projects.import_version` | 记录导入格式版本 |
| `settings` | `projects.settings` | JSON 整体保存 |
| `views[]` | 本次不建集合 | 需要后续迁移，见设计文档 |
| `tasks[].id` | `tasks.client_id` | 原始 ID 保留，不直接作为主键 |
| `tasks[].parentId` | `tasks.parent` | 先导入父任务，再回填关系 |
| `tasks[].name` | `tasks.name` | 必填，最长 500 |
| `tasks[].description` | `tasks.description` | 最长 5000 |
| `tasks[].assignee` | `tasks.assignee` | 显示名文本，暂不关联 users |
| `tasks[].color` | `tasks.color` | `null` 导入为空字符串 |
| `tasks[].startDate` | `tasks.start_date` | 文本，固定 `YYYY-MM-DD` |
| `tasks[].endDate` | `tasks.end_date` | 文本，固定 `YYYY-MM-DD` |
| `tasks[].plannedEndDate` | `tasks.planned_end_date` | 文本，固定 `YYYY-MM-DD` |
| `tasks[].progress` | `tasks.progress` | 0 到 100 的整数 |
| `tasks[].status` | `tasks.status` | `inProgress`、`thirdParty`、`done` |
| `tasks[].order` | `tasks.sort_order` | 原样保留 |
| `tasks[].ganttRow` | `tasks.gantt_row` | 可为空 |
| `tasks[].estimatedHours` | `tasks.estimated_hours` | 可为空，最小 0 |
| `tasks[].locked` | `tasks.locked` | 布尔值 |
| `milestones[].id` | `milestones.client_id` | 原样保留 |
| `milestones[].taskId` | `milestones.task` | 映射为任务记录 ID |
| `links[].id` | `links.client_id` | 原样保留 |
| `links[].source` / `target` | `links.source` / `target` | 映射为任务记录 ID |
| `links[].type` | `links.type` | `FS`、`SS`、`FF`、`SF` |
| `links[].lag` | `links.lag` | 数字，单位天 |
| `comments[].id` | `comments.client_id` | 原样保留 |
| `comments[].taskId` | `comments.task` | 映射为任务记录 ID |
| `comments[].author` | `comments.author_name` | 原文保留，能匹配用户时再写 `author` |
| `comments[].text` | `comments.text` | 最长 2000 |
| `comments[].createdAt` | `comments.created_at` | 保留原始时间，系统 `created` 记录导入时间 |
| `comments[].updatedAt` | `comments.updated_at` | 保留原始时间 |
| `activity[].id` | `activity.client_id` | 原样保留 |
| `activity[].taskId` | `activity.task` | 映射为任务记录 ID |
| `activity[].actor` | `activity.actor_name` | 原文保留，能匹配用户时再写 `actor` |
| `activity[].field` | `activity.field` | 变更字段名 |
| `activity[].before` / `after` | `activity.before_json` / `after_json` | 任意 JSON 值 |
| `activity[].at` | `activity.at` | 转为 PocketBase 日期格式 |
| `attachments[].id` | `attachments.client_id` | 原样保留 |
| `attachments[].taskId` | `attachments.task` | 映射为任务记录 ID |
| `attachments[].name` | `attachments.name` | 最长 255 |
| `attachments[].size` | `attachments.size` | 字节数，最大 10485760 |
| `attachments[].type` | `attachments.type` | MIME 小写 |
| `attachments[].blobKey` | `attachments.file` 和 `storage_key` | 二进制另行上传，原键保留在 `storage_key` |
| `attachments[].createdAt` | `attachments.created_at` | 保留原始时间 |
| 无 | `rev` | 导入时统一写 1 |
| 无 | `deleted_at` | 导入时留空 |

### 8.3 导入顺序

1. 先导出 JSON 备份，确认包含 `comments`、`activity`、`attachments`。
2. 预检：任务 ID 唯一、父级存在、依赖端点存在、日期合法、进度在 0 到 100。
3. 创建 `projects` 记录，`owner` 指向当前用户，`status` 写 `active`。
4. 为创建者插入 `project_members`，角色 `owner`。这一步依赖迁移中的自举规则。
5. 按邮箱或显示名匹配 `users`。匹配不到的评论作者和活动操作人只保留 `author_name`、`actor_name`。
6. 按父任务先于子任务的顺序写入 `tasks`，保存 `client_id -> id` 映射。
7. 回填 `parent`，再写入 `milestones`、`links`。
8. 写入 `comments`、`activity`。
9. 写入 `attachments` 元数据，然后用 multipart 上传二进制到 `file` 字段，回填 `checksum`。
10. 校验各实体数量、字段哈希和引用完整性，客户端保存 `projectId` 与 ID 映射。

### 8.4 注意事项

- `status` 没有数据库默认值。创建 `projects`、`tasks`、`milestones`、`links` 时必须显式提交合法的 select 值。
- `tasks.client_id` 加 `project` 有唯一索引。软删除后保留记录会占用原 ID，重新导入同一 ID 会失败。
- `deleted_at` 为空字符串表示未删除。读取规则会过滤已经软删除的记录。
- 日期字段 `start_date`、`end_date`、`planned_end_date` 使用文本保存 `YYYY-MM-DD`，避免时区换算。时间戳字段使用 PocketBase 日期格式 `YYYY-MM-DD HH:MM:SS.sssZ`。
- 附件二进制不随 JSON 导出，导入时必须单独上传。没有二进制的元数据行在界面上应标记为缺失。
- `views` 本次没有建表，`settings` 整体放入 `projects.settings`。
- 服务端不会自动递增 `rev`。P3-1 同步层必须带 `baseRev` 并在服务端校验，或者增加 hook。
- 迁移的 API 规则不能保证最后一个 `owner` 不被移除，也不能阻止跨项目引用父任务和依赖端点。这些需要用 `pb_hooks` 补充。

## 9. 未验证项

- 没有实际执行迁移，没有启动 PocketBase。
- 没有在 Dashboard 中验证任何 API 规则。
- `@collection` 别名语义依据官方文档编写，尚未用真实请求验证。
- 受保护文件的 file token 行为没有端到端验证。
- SQLite 写入并发、规则查询性能和附件容量没有实测。
- 日期字段对客户端 ISO 字符串的接受程度没有实测，导入脚本应显式格式化。
- 没有提供 hook，因此 `rev` 递增、最后一个 owner 保护、跨项目引用校验仍然缺失。
