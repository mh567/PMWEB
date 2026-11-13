# P3 后端与协同方案设计

## 1. 结论

本轮只做方案设计与取舍，不写业务代码。结论如下。

| 项 | 选择 | 一句话理由 |
|----|------|-----------|
| 首选 | PocketBase | 单二进制自带 SQLite、auth、REST、realtime、文件存储，和当前无构建静态前端最匹配 |
| 备选 | 自建 Node/Fastify + SQLite，规模上来后换 PostgreSQL | 权限、审计和同步语义完全可控，不受 BaaS 规则表达力限制 |
| 协同增量 | Yjs 只在 P3-3 接入，作为字段级协同层 | CRDT 解决并发编辑，不解决权限、审计、查询和排期约束 |
| 第五种参考 | Appwrite / Nhost 自托管 BaaS | 需要 Postgres 加内置 auth 和存储时，填补 PocketBase 与 Supabase 之间的空档 |
| 明确不选 | 把 Yjs 当作唯一后端 | 无法承载成员权限、只读分享、审计和附件管理 |

阶段划分：

- P3-1 同步与权限：PocketBase 集合、项目成员、角色、增量拉取与推送、离线队列。
- P3-2 审计与分享：服务端追加式审计日志、只读分享链接、打印视图。
- P3-3 实时协同：先做项目级实时推送和在线状态，出现真实单元格级并发后再引入 Yjs。

数据迁移采用「一次性导入 + 本地缓存继续读 + 出站队列异步写」的路径，不做两套权威同时写。冲突策略是字段级合并加服务端修订号，结构性变更（改父级、排序、删除）走服务端裁决。

## 2. 范围

本阶段包含：

- 四种以上后端路线的能力与代价比较。
- 从 localStorage v3 到服务端表的迁移映射。
- 权限模型、实时协同、冲突策略、附件存储、审计与分享的设计取舍。
- P3-1、P3-2、P3-3 的分阶段落地路径和验收指标。
- 风险、待决策项、未验证项。

本阶段不包含：

- 任何 `js/**`、`css/**`、`index.html`、`tests/**` 的修改。
- 数据库建表、接口实现、部署脚本、依赖安装。
- 具体的性能压测数字和价格测算。
- 分支合并、推送、发布。

## 3. 现状与约束

### 3.1 当前数据模型

`DataStore` 使用 `localStorage` 的 `pmweb_data` 键，当前版本 `pmweb_version: 3`。根节点结构：

```js
{
  pmweb_version: 3,
  tasks: [],
  milestones: [],
  links: [],
  views: [],
  settings: {
    lastView, lastGranularity, statusFilter, layoutVersion,
    gridWidth, columns, currentUser, resourceCapacity,
    resourceCapacityByAssignee, workCalendar, savedViews
  },
  comments: [],
  activity: [],
  attachments: []
}
```

`comments`、`activity`、`attachments` 三个数组由 `TaskManager._ensureCollaboration()` 在初始化时补空数组，并已在 P2 阶段写入数据根节点。`validate.js` 目前只校验 `tasks`、`milestones`、`links`、`views`、`settings`，不校验这三个协作数组，服务端导入时需要补上校验。

任务字段：

```js
Task = {
  id, parentId, name, description, assignee, color,
  startDate, endDate, status, order, ganttRow,
  progress, plannedEndDate, estimatedHours, locked
}
```

里程碑字段：`id`、`taskId`、`name`、`date`、`status`。

依赖字段：`id`、`source`、`target`、`type`、`lag`。

协作字段：

- `Comment = { id, taskId, author, text, createdAt, updatedAt }`
- `ActivityEntry = { id, taskId, actor, field, before, after, at }`
- `AttachmentMeta = { id, taskId, name, size, type, createdAt, blobKey }`

附件二进制由 `AttachmentStore` 存入 IndexedDB 数据库 `pmweb-attachments`、对象仓库 `blobs`，键为 `blobKey`。IndexedDB 不可用时退回进程内内存 `Map`，刷新即丢失。

### 3.2 当前约束

- 前端是经典 script 加 CSS，无构建步骤，`index.html` 直接引用 `js/*.js`。
- 双击 `index.html` 即可运行，`file://` 下没有同源后端。
- 导入校验以 `pmweb_version` 为准，版本号不一致会拒绝或触发迁移。
- 所有写操作最终经过 `TaskManager`，再调用 `DataStore.save()` 全量写入 localStorage。
- 撤销重做由 `History` 在内存中维护命令栈，不做持久化。
- 任务 ID 已受 `^[A-Za-z0-9_-]{1,128}$` 白名单约束，可以直接作为服务端主键的一部分。
- 附件单文件上限 10 MB，类型白名单固定。

### 3.3 引入后端后的硬约束

`file://` 页面的 origin 是 `null`，跨域请求会被浏览器拦截。可用路径只有两条：

1. 由后端同源托管静态文件，前端通过 `http://host/` 打开。PocketBase 的 `pb_public` 目录可以直接承担这一角色，自建 Node 服务也可以。
2. 保留 `file://` 作为纯单机模式，同步功能只在同源部署下启用，通过 `settings.syncMode` 切换。

文档推荐第 2 条作为兼容策略：单机双击继续可用，协作模式要求通过服务地址访问。这样不会为了后端牺牲现有的离线优势。

## 4. 候选方案

### 4.1 PocketBase

技术形态：Go 编写的单二进制服务，内置 SQLite、用户认证、集合管理后台、REST 风格 API、SSE 实时订阅和文件字段。前端静态文件可以放进 `pb_public` 与 API 同源。

适合本项目的点：

- 部署只要一个二进制加一个数据目录，备份就是复制目录或调用备份接口。
- 自带邮箱密码认证，后续可以接 OAuth2。
- 集合字段和 API 规则可在后台配置，无需先写整套服务端代码。
- SSE 实时订阅可以直接支撑 P3-3 的项目级推送。
- 文件字段可直接保存附件，避免另建对象存储。

需要重点验证的点：

- API 规则能否表达「项目成员才能读写该项目任务」这种关系型判断。PocketBase 规则支持关联字段过滤，但多层成员关系可能需要自定义 Go 或 JS hook。
- 目标版本的 S3 兼容文件存储支持程度，需要以官方文档为准。
- SQLite 的写入并发上限，多人高频编辑时需要评估是否换 Postgres。

### 4.2 自建 Node/Fastify/Express + SQLite 或 PostgreSQL + WebSocket

技术形态：Fastify 或 Express 提供 REST，`better-sqlite3` 或 `pg` 访问数据库，`ws` 提供实时通道，静态前端由同一进程托管。

适合本项目的点：

- 权限、审计、同步协议、冲突策略都可以按本文档精确定义，不受 BaaS 规则限制。
- 可以复用当前 `validate.js` 的校验语义，服务端做同一套规则的加强版。
- SQLite 阶段部署成本接近 PocketBase，迁移到 PostgreSQL 时只需替换驱动和少量 SQL。
- 审计日志可以在同一事务内写入，保证写操作和审计一致。

代价：

- 需要自己实现认证、会话、密码重置、限流、文件上传和备份脚本。
- 实时通道、断线重连、消息去重都要自己处理。
- 服务端代码量和长期维护成本明显高于 PocketBase。

### 4.3 Supabase

技术形态：PostgreSQL 加 GoTrue 认证、Realtime 服务、Storage 对象存储、PostgREST 自动 API，权限通过行级安全策略（RLS）表达。

适合本项目的点：

- RLS 是表达「项目成员、角色、只读分享」最成熟的方案之一。
- Postgres 的约束、索引、事务和审计能力完整。
- Storage 自带签名上传和下载，附件方案成熟。
- Realtime 支持表级变更订阅。

代价：

- 自托管是一组容器，组件多，升级和备份复杂度高。
- 托管模式涉及数据驻留、网络可达性和持续费用，离线能力弱。
- 前端需要引入 Supabase 客户端库，与当前「无构建、经典 script」的约束有摩擦，需要额外打包或用 ESM CDN。
- RLS 策略写错会造成越权或误拒，需要完整测试矩阵。

### 4.4 Yjs/CRDT 本地优先协同

技术形态：Yjs 文档加 `y-websocket` 或 `y-webrtc` 同步，`y-indexeddb` 做本地持久化，Awareness 提供在线状态和光标。

适合本项目的点：

- 离线优先能力最强，本地编辑天然可合并。
- 多人同时编辑同一描述或评论时不会互相覆盖。
- 在线状态和光标共享开箱可用。

不合适的点：

- CRDT 只保证文档收敛，不保证业务约束。任务依赖不能成环、自动排期、关键路径这些规则需要一个中心裁决者。
- 权限、只读分享、审计、附件元数据仍需要服务端和数据库。
- 把整棵任务树放进一个 Yjs 文档，会让现有的 `TaskManager` 索引、撤销栈、`validate.js` 全部需要重写。
- 冲突自动合并意味着「谁改了什么」不再直观，审计和追责变难。

结论：Yjs 适合作为 P3-3 的字段级协同层，不适合作为唯一后端。

### 4.5 补充：Appwrite / Nhost 自托管 BaaS

加入理由：当用户明确要求「自托管 + Postgres + 内置认证和存储」时，PocketBase 的 SQLite 上限和 Supabase 的组件重量都不理想。Appwrite 与 Nhost 都提供自托管、认证、数据库、存储和函数，Nhost 直接以 Postgres 为底座。它们填补了 4.1 和 4.3 之间的空档，值得放进备选清单。

代价与 Supabase 类似：前端要引入 SDK，运维组件多于单二进制，具体能力以目标版本官方文档为准。

## 5. 维度对比

### 5.1 自托管与离线能力

| 方案 | 自托管 | 离线能力 | 说明 |
|------|--------|----------|------|
| PocketBase | 单二进制，最容易 | 前端需 Service Worker 缓存应用壳，数据缓存放 IndexedDB | 服务不可达时进入只读或队列模式 |
| 自建 Fastify | 容器或进程，容易 | 与 PocketBase 相同，需自建缓存层 | 离线策略完全自己控制 |
| Supabase | 多容器，较重 | 依赖客户端缓存，托管模式离线弱 | 需要额外做本地优先层 |
| Yjs | 需要同步服务和持久化 | 最强，`y-indexeddb` 原生支持 | 仍需中心服务做鉴权和校验 |
| Appwrite/Nhost | 多容器，中等偏重 | 依赖客户端缓存 | 与 Supabase 类似 |

离线不是后端自带的属性，四种方案都需要补一层客户端缓存。差别在于 Yjs 的缓存是模型的一部分，其他方案需要额外设计。

### 5.2 部署复杂度、备份和升级

| 方案 | 部署 | 备份 | 升级 |
|------|------|------|------|
| PocketBase | 一个二进制加数据目录 | 复制 `pb_data` 或调用备份接口 | 替换二进制，执行迁移，先在副本上演练 |
| 自建 Fastify + SQLite | 一个进程加数据文件 | 停写复制或 `VACUUM INTO` | 执行 SQL 迁移，需自建版本表 |
| 自建 Fastify + PostgreSQL | 进程加数据库 | `pg_dump` 加附件目录或对象存储 | 迁移脚本加回滚脚本 |
| Supabase | Docker Compose 多服务 | `pg_dump` 加 Storage 备份 | 组件分别升级，风险最高 |
| Yjs | 同步服务加持久化存储 | 文档快照加增量日志 | 依赖库升级，需回归合并语义 |

备份必须覆盖三类数据：结构化数据、附件二进制、审计日志。三者的恢复点需要一致，否则会出现元数据指向不存在文件的悬挂引用。

### 5.3 数据模型迁移

共同原则：

- 保留客户端已有 ID，服务端只增加项目维度和修订字段。
- 主键统一为 `(project_id, id)`，避免不同项目的任务 ID 冲突。
- 增加 `rev`、`created_at`、`updated_at`、`updated_by`、`deleted_at`。
- `settings`、`views` 的配置部分用 JSON 列保存，不拆成大量稀疏列。
- 删除一律软删除，保留 `deleted_at` 供同步和审计使用。

方案差异：

- PocketBase：集合字段在后台定义，JSON 字段和关联字段都支持；迁移通过集合 schema 和 hook 完成。
- 自建：完全用 SQL 迁移文件控制，最容易表达复合主键和唯一约束。
- Supabase：标准 Postgres，迁移能力最强，RLS 策略需要独立版本管理。
- Yjs：不存在传统表迁移，任务树如果进入文档需要一次性序列化，迁移成本最高。

### 5.4 权限模型

需要的角色：

| 角色 | 读 | 建/改任务 | 删任务 | 评论 | 传附件 | 改设置/视图 | 管成员 | 看审计 | 导出 |
|------|----|-----------|--------|------|--------|-------------|--------|--------|------|
| owner | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| editor | 是 | 是 | 是 | 是 | 是 | 是 | 否 | 否 | 是 |
| commenter | 是 | 否 | 否 | 是 | 是 | 否 | 否 | 否 | 是 |
| viewer | 是 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 是 |
| share-viewer | 受限读 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 按分享配置 |

方案能力：

- PocketBase：集合级 API 规则加关联过滤，可覆盖大部分场景；复杂成员判断可能需要 hook。
- 自建：中间件加 SQL 查询，表达力最强，测试也最直接。
- Supabase：RLS 是原生能力，表达力强，但策略调试成本高。
- Yjs：本身不提供业务权限，需要在同步服务握手阶段做鉴权。

只读分享在四种方案里都需要单独设计，不能只靠「给个 URL」。推荐做法是生成高熵令牌，服务端只存哈希，兑换成短期只读会话，支持过期和撤销。

### 5.5 实时协同方式和冲突策略

| 方案 | 实时通道 | 默认冲突策略 |
|------|----------|--------------|
| PocketBase | SSE 订阅集合变更 | 服务端修订号加字段级合并 |
| 自建 | WebSocket 或 SSE，自建协议 | 自定义，推荐修订号加字段级合并 |
| Supabase | Realtime 表订阅 | 乐观并发加 RLS，冲突需应用层处理 |
| Yjs | WebSocket 或 WebRTC | CRDT 自动合并 |

关键判断：任务表适合「服务端裁决的乐观并发」，描述和评论适合 CRDT。原因是任务字段之间有业务约束，依赖环、父级层级、自动排期都需要统一校验；纯 CRDT 允许多个副本各自收敛到非法状态。

### 5.6 附件存储

| 方案 | 二进制位置 | 元数据位置 | 离线 |
|------|-----------|-----------|------|
| PocketBase | 数据目录文件字段，S3 支持待验证 | SQLite | IndexedDB 缓存 |
| 自建 | 本地磁盘按项目分目录，或 S3/MinIO | 数据库表 | IndexedDB 缓存 |
| Supabase | Storage 对象存储 | Postgres | 需自建缓存 |
| Yjs | 不涉及，需外部存储 | 不涉及 | `y-indexeddb` 不存大文件 |

不建议把二进制存进数据库。10 MB 单文件上限意味着一次备份可能包含大量二进制，数据库膨胀后备份和恢复都会变慢。

推荐分层：

- 元数据进数据库，字段沿用现有 `AttachmentMeta`。
- 二进制进文件系统或对象存储，键使用 `project_id/blobKey`。
- 客户端保留 IndexedDB 作为离线缓存和待上传队列。
- 上传后计算 SHA-256，用于去重和完整性校验。

### 5.7 审计、分享、打印与 PDF

审计：

- 现有 `Activity` 是面向用户的活动日志，由客户端生成，`actor` 来自 `settings.currentUser`，可被篡改。
- 服务端需要独立的 `audit_log`，由服务端在写事务内生成，记录操作者、动作、实体、前后值和请求标识。
- `Activity` 保留用于界面展示，但 `actor` 必须改为认证身份，服务端同时写 `audit_log`。
- 审计日志追加式写入，不提供修改接口。

分享：

- 只读分享链接支持项目级和视图级两种范围。
- 令牌只存哈希，支持有效期、撤销、访问次数限制（可选）。
- 分享视图复用现有渲染管线，隐藏编辑入口。

打印与 PDF：

- 现有前端已有打印样式基础，保留客户端 `window.print()` 路径。
- 服务端生成 PDF 需要无头浏览器，资源开销大，作为可选能力，具体成本待验证。
- 分享页提供打印按钮，输出与只读视图一致。

### 5.8 许可、成本与锁定风险

| 方案 | 许可 | 成本结构 | 锁定风险 |
|------|------|----------|----------|
| PocketBase | MIT（以仓库 LICENSE 为准） | 自托管服务器成本 | 低，SQLite 数据可直接导出 |
| 自建 Fastify | MIT 生态 | 服务器加运维人力 | 最低，代码和数据都在自己手里 |
| Supabase | Apache-2.0 核心（以仓库为准） | 托管按用量计费，自托管为服务器成本 | 中，RLS 和客户端 SDK 有迁移成本 |
| Yjs | MIT | 同步服务成本 | 低，文档可导出 |
| Appwrite/Nhost | 以各自仓库 LICENSE 为准 | 自托管服务器成本 | 中 |

本文档不写具体价格和性能数字，全部以官方报价和实测为准。

## 6. 推荐方案

### 6.1 首选：PocketBase

理由按重要性排序：

1. 部署形态与当前项目最匹配。一个二进制加一个数据目录，前端放 `pb_public` 后同源，直接解决 `file://` 跨域问题。
2. 内置认证、REST、SSE 实时和文件存储，P3-1 和 P3-2 的大部分基础能力不需要自己写。
3. SQLite 单文件便于备份和迁移，后续需要 Postgres 时数据模型可以平移。
4. 前端仍然是无构建经典 script，只需要新增一个同步模块，不需要引入打包器。
5. MIT 许可，数据和 schema 可导出，锁定风险低。

适用边界：单项目或中小团队、内网或单机自托管、写入频率中等。若出现持续高并发写入或复杂多租户合规要求，切换到备选。

### 6.2 备选：自建 Fastify + SQLite，规模上来后换 PostgreSQL

触发条件：

- PocketBase 的 API 规则无法表达成员权限，需要大量 hook。
- 需要严格的事务性审计、复杂查询或自定义同步语义。
- 需要与现有系统做 SSO 或组织架构集成。
- 写入并发超过 SQLite 的舒适区。

选择理由：

- 权限和同步协议可以完全按本文档实现，行为可测试、可解释。
- 可以先 SQLite，后 Postgres，迁移路径清晰。
- 不依赖任何 BaaS 的版本节奏。

代价是服务端代码量和运维工作量更高，需要评估团队维护能力。

### 6.3 不推荐作为主方案

- Supabase 托管：数据驻留、网络依赖和持续费用需要确认，且与无构建前端有摩擦。
- Supabase 自托管：组件多，运维复杂度高于收益。
- Yjs 作为唯一后端：无法承载权限、审计、附件和排期约束。

## 7. 分阶段落地

### 7.1 P3-1 同步与权限

目标：

- 项目、成员、角色的服务端模型。
- 增量拉取与推送接口。
- 客户端同步模块、离线队列和冲突提示。
- 单机模式与协作模式切换。

服务端集合或表：

- `users`：认证用户。
- `projects`：项目。
- `project_members`：成员与角色。
- `tasks`、`milestones`、`links`、`views`、`settings`。
- `comments`、`attachments`（元数据）。

接口约定：

```text
POST /api/sync/push
  请求: { projectId, ops: [{ opId, entity, entityId, op, baseRev, patch }] }
  响应: { results: [{ opId, status, rev?, current?, error? }] }

GET /api/sync/pull?projectId=...&since=<server_seq>
  响应: { changes: [...], cursor, hasMore }

POST /api/import
  请求: 现有 DataStore.exportJSON 产物
  响应: { projectId, counts, errors }
```

同步语义：

- 每个实体有单调递增 `rev`。
- `push` 按 `opId` 幂等，重复请求返回同一结果。
- `pull` 用项目级 `server_seq` 游标，客户端保存游标。
- 服务端时间戳为准，客户端时间只用于展示。

验收：

- 导入后各实体数量与字段哈希一致，0 条校验错误。
- 离线操作恢复网络后按序送达，重复推送不产生重复记录。
- 角色矩阵测试全部符合预期，越权返回 403。
- 单机模式下列表、编辑、导出、打印不回归。

回滚：

- `settings.syncMode` 切回 `local`，服务端项目标记归档。
- localStorage 保留迁移前快照，保留期待定。

### 7.2 P3-2 审计与分享

目标：

- 服务端追加式审计日志。
- 项目级和视图级只读分享链接。
- 只读打印视图。

服务端集合或表：

- `audit_log`：`project_id`、`actor_id`、`action`、`entity_type`、`entity_id`、`before_json`、`after_json`、`at`、`request_id`。
- `share_links`：`id`、`project_id`、`token_hash`、`scope_json`、`role`、`expires_at`、`revoked_at`、`created_by`。

规则：

- 审计由服务端在写事务内生成，客户端不能写入。
- `before` 和 `after` 由服务端从存储值计算，不接受客户端上报。
- 分享令牌高熵随机，只存哈希，兑换短期只读会话。
- 分享视图走同一套读接口，权限降级为只读。
- 撤销后立即失效，不依赖缓存过期。

验收：

- 每个成功写请求生成一条审计，失败请求不生成。
- 审计记录不可修改，接口层面无更新和删除入口。
- 无账号浏览器可以打开只读分享，撤销后返回 403。
- 打印输出与只读视图一致。

### 7.3 P3-3 实时协同

分三步，按需推进。

第一步：项目级实时推送。

- 订阅项目变更，收到后按 `rev` 判断是否需要刷新。
- 过滤自己产生的 `opId` 回显。
- 断线重连后先用 `pull` 补齐，再恢复订阅。

第二步：在线状态。

- 心跳或 presence 表记录当前在线成员。
- 展示在线列表和最后活动时间。
- 心跳超时自动移除。

第三步：字段级 CRDT（可选）。

- 只对 `description` 和评论草稿启用 Yjs，任务字段仍走服务端裁决。
- 每个项目一个 Yjs 文档，房间名用 `project_id`。
- 持久化用文档快照加增量更新。
- 权限在握手阶段校验，只读用户不授予写权限。

验收：

- 两个标签页同时编辑不同任务，互不覆盖。
- 同时编辑同一字段时，冲突可见或按策略合并，无静默丢失。
- 断网编辑后恢复，变更最终一致。
- 排期、依赖、关键路径在并发编辑后仍然合法。

## 8. 数据迁移详细设计

### 8.1 目标表

```text
projects(id, name, owner_id, created_at, deleted_at)
project_members(project_id, user_id, role, created_at)
project_settings(project_id, settings_json, rev, updated_at, updated_by)
tasks(project_id, id, parent_id, name, description, assignee, color,
      start_date, end_date, status, sort_order, gantt_row,
      progress, planned_end_date, estimated_hours, locked,
      rev, created_at, updated_at, updated_by, deleted_at)
milestones(project_id, id, task_id, name, date, status,
           rev, created_at, updated_at, updated_by, deleted_at)
links(project_id, id, source, target, type, lag,
      rev, created_at, updated_at, updated_by, deleted_at)
views(project_id, id, name, config_json,
      rev, created_at, updated_at, updated_by, deleted_at)
comments(project_id, id, task_id, author_id, author_name, text,
         created_at, updated_at, deleted_at)
activity(project_id, id, task_id, actor_id, actor_name, field,
         before_json, after_json, at)
attachments(project_id, id, task_id, name, size, type, storage_key,
            checksum, created_at, deleted_at)
audit_log(id, project_id, actor_id, action, entity_type, entity_id,
          before_json, after_json, at, request_id)
share_links(id, project_id, token_hash, scope_json, role,
            expires_at, revoked_at, created_by)
```

主键约定：`tasks`、`milestones`、`links`、`views`、`comments`、`attachments` 使用 `(project_id, id)` 复合主键。

### 8.2 字段映射

| 客户端 | 服务端 | 规则 |
|--------|--------|------|
| `pmweb_version` | 不落库 | 作为导入格式版本，写入 `projects.import_version` 便于追溯 |
| `tasks[].id` | `tasks.id` | 原样保留，受 ID 白名单约束 |
| `tasks[].parentId` | `tasks.parent_id` | 空值转 `NULL`，导入后校验引用存在 |
| `tasks[].order` | `tasks.sort_order` | 原样保留 |
| `tasks[].status` | `tasks.status` | 白名单内原样保留 |
| `tasks[].progress` | `tasks.progress` | 0 到 100 |
| `tasks[].plannedEndDate` | `tasks.planned_end_date` | 空值转 `NULL` |
| `tasks[].estimatedHours` | `tasks.estimated_hours` | 可空 |
| `settings` | `project_settings.settings_json` | 整体保存 |
| `views[]` | `views` | 每个视图一行，配置存 `config_json` |
| `links[].source/target` | `links.source/target` | 导入后校验端点存在且无环 |
| `comments[].author` | `comments.author_name` | 导入期保留显示名，后续写 `author_id` |
| `activity[].actor` | `activity.actor_name` | 历史记录保留显示名，新记录写 `actor_id` |
| `attachments[].blobKey` | `attachments.storage_key` | 二进制另行上传，键加项目前缀 |
| 无 | `rev` | 导入时为 1 |
| 无 | `created_at` / `updated_at` | 导入时间，历史时间可从 `at` 或 `createdAt` 回填 |
| 无 | `deleted_at` | 导入时为空 |

### 8.3 迁移步骤

1. 客户端提示导出 JSON 备份，`DataStore.exportJSON` 已经包含 `comments`、`activity`、`attachments`。
2. 服务端提供 dry-run 导入，返回实体计数、校验错误和引用问题，不写入。
3. 客户端确认后执行正式导入，服务端在单事务内写入项目、成员、任务、里程碑、链接、视图、设置、评论、活动、附件元数据。
4. 服务端重新校验：任务 ID 唯一、父级引用存在、依赖端点存在、依赖无环、日期格式合法、进度范围合法。
5. 客户端保存 `projectId`、`rev` 映射和 `server_seq` 游标，切换 `syncMode` 为 `remote`。
6. 客户端保留迁移前 localStorage 快照，作为短期回滚点。
7. 附件二进制由客户端逐个上传，服务端按 `storage_key` 落盘并回填 `checksum`。

### 8.4 迁移校验

- 实体计数一致：任务、里程碑、依赖、视图、评论、活动、附件。
- 字段哈希一致：对每个任务按固定字段顺序拼接后哈希，客户端与服务端比对。
- 引用完整：没有孤儿父级、孤儿里程碑、孤儿依赖、孤儿评论。
- 依赖无环：复用 `Links` 的环检测规则。
- 附件完整：每个元数据都有对应二进制，校验 SHA-256。
- 回滚演练：从快照恢复后，客户端可继续在单机模式工作。

## 9. 双写、离线队列与冲突

### 9.1 明确不做双权威

同时把 localStorage 和服务端当权威会产生不可收敛的分叉。采用「单一权威加本地缓存」：

- 单机模式：localStorage 是权威。
- 协作模式：服务端是权威，localStorage 降级为读缓存和待发送队列的持久化位置。
- 不在协作模式下把本地写入直接当最终状态。

### 9.2 写入路径

```text
用户操作
  -> TaskManager 更新内存模型
  -> 立即渲染，界面不等待网络
  -> SyncEngine.enqueue(op)
  -> 出站队列持久化（IndexedDB 优先，localStorage 兜底）
  -> 批量 push
  -> 服务端返回结果
  -> 成功：更新 rev，移除队列项
  -> 冲突：进入冲突队列，界面标记
  -> 失败：退避重试
```

出站记录：

```js
OutboxItem = {
  opId, projectId, entity, entityId, op,
  baseRev, patch, clientAt, attempts, lastError
}
```

### 9.3 队列规则

- `opId` 客户端生成，服务端唯一索引，保证幂等。
- 同一实体的操作按入队顺序发送。
- 新建父任务和子任务时，客户端先生成双方 ID，再在同一批次按父先子后发送，避免悬挂引用。
- 队列达到上限时停止接受新的离线写入并提示，避免无限增长。
- 重试用指数退避，设置最大间隔和最大次数，超过后标记为需人工处理。
- 队列持久化优先用 IndexedDB，避免 localStorage 容量和同步阻塞。

### 9.4 冲突解决

字段级合并：

- 服务端比较 `baseRev` 与当前 `rev`。
- `baseRev` 等于当前 `rev` 时直接应用，`rev` 加一。
- 不相等时，比较本地修改字段集合与服务端自 `baseRev` 以来变更的字段集合。
- 两个集合不相交时合并应用。
- 相交时返回冲突，携带服务端当前值，由客户端决定保留本地、接受远端或生成副本。

结构性变更：

- `parentId`、`order`、删除、恢复不做自动合并。
- 服务端优先，客户端收到冲突提示，展示「已被他人修改」。
- 删除优先于编辑，除非显式恢复。

文本字段：

- `description` 和评论在 P3-1 使用最后写入胜出，同时保留冲突副本。
- P3-3 引入 Yjs 后改为 CRDT 合并。

时间与顺序：

- 服务端分配 `updated_at` 和项目级 `server_seq`。
- 排序和「最新修改」展示一律使用服务端时间，避免客户端时钟漂移。

## 10. 权限与分享细节

### 10.1 成员与角色

- 项目创建者自动成为 `owner`。
- 每个项目至少保留一个 `owner`，降级或移除最后一个 `owner` 时拒绝。
- 成员邀请支持按邮箱或用户 ID，邀请状态为 `pending`、`active`、`revoked`。
- 角色变更立即生效，不依赖客户端刷新。

### 10.2 只读分享

```js
ShareLink = {
  id, projectId, tokenHash, role: 'viewer',
  scope: { type: 'project' } | { type: 'view', viewId },
  expiresAt, revokedAt, createdBy, createdAt
}
```

规则：

- 令牌使用密码学随机源生成，长度足够抵抗枚举，具体位数待定。
- 数据库只存哈希，明文只在创建时返回一次。
- 兑换接口返回短期只读会话，避免长期令牌出现在日志和分享历史里。
- 撤销立即生效，服务端每次请求校验状态。
- 分享视图不返回成员列表、审计日志和附件原始路径。
- 附件通过带签名的短期地址下载，不暴露存储键。

### 10.3 与现有模块的关系

- `TaskManager._activityActor()` 目前回退到 `本机用户`，接入认证后改为服务端身份。
- `Comments.create` 的 `author` 改为认证显示名，服务端再记录 `author_id`。
- `AttachmentMeta` 的字段基本可复用，只增加 `checksum` 和 `storageKey` 映射。
- `validate.js` 的规则作为服务端校验的基础，服务端增加协作数组和权限校验。

## 11. 实时与离线策略

### 11.1 在线

- 建立连接后先 `pull` 获取增量，再订阅变更。
- 收到变更时比较 `rev`，小于等于本地 `rev` 的忽略。
- 自己的操作通过 `opId` 过滤，避免重复渲染。
- 渲染节流，短时间多条变更合并为一次重绘。

### 11.2 离线

- 应用壳通过 Service Worker 缓存，保证刷新后仍能打开。
- 数据缓存放 IndexedDB，容量上限和清理策略待定。
- 离线期间允许编辑，操作进入出站队列。
- 离线期间不显示为「已保存」，状态栏显示「待同步 N 条」。
- 恢复网络后按项目和实体的顺序排空队列。

### 11.3 只读降级

- 会话过期或权限被撤销时，界面进入只读并提示。
- 只读状态下保留本地未发送的操作，避免丢失。
- 重新获得权限后再次尝试发送。

## 12. 附件存储方案

### 12.1 首选 PocketBase 文件字段

- 附件元数据存集合字段，二进制由文件字段管理。
- 文件落在数据目录，备份与数据库一起完成。
- 单文件 10 MB 沿用 `AttachmentMeta.MAX_SIZE`。
- 需要确认目标版本的 S3 兼容存储能力，若支持则优先对象存储。

### 12.2 备选自建存储

- 本地磁盘路径 `data/<project_id>/<blobKey>`，按项目隔离。
- 或 S3/MinIO，使用预签名 URL 直传，服务端只存元数据。
- 写入后计算 SHA-256，重复文件可去重。
- 删除先软删元数据，再由清理任务删除二进制。

### 12.3 客户端缓存

- `AttachmentStore` 继续使用 IndexedDB，作为离线缓存和待上传队列。
- 协作模式下 IndexedDB 不再是唯一副本。
- 清理策略保留现有的按最后访问时间回收，增加「已同步」标记。

## 13. 审计、分享与打印

- `activity` 服务用户可读的活动流，`audit_log` 服务安全审计，两者分开存储。
- `audit_log` 只追加，接口不暴露更新和删除。
- 审计字段包含 `request_id`，便于与访问日志关联。
- 分享页复用现有网格和时间轴渲染，隐藏编辑入口。
- 打印使用现有打印样式，补充只读分享页的页眉页脚和分页。
- 服务端 PDF 作为可选增强，是否引入取决于对导出样式一致性的要求。

## 14. 验收指标

以下为实施后的验收标准，本阶段不产生实测结果。

| 指标 | 目标 |
|------|------|
| 迁移完整性 | 各实体计数一致，字段哈希一致，0 条校验错误 |
| 幂等性 | 同一 `opId` 重复推送只产生一次效果 |
| 离线队列 | 断网操作恢复网络后全部送达，顺序正确 |
| 冲突可见性 | 所有冲突进入冲突列表，无静默丢失 |
| 权限正确性 | 角色与动作矩阵全部通过，越权返回 403 |
| 分享时效 | 撤销后立即失效，无缓存绕过 |
| 审计完整性 | 每个成功写操作一条审计，失败写操作零条 |
| 附件完整性 | 上传下载校验和一致，删除后无悬挂元数据 |
| 备份恢复 | 从备份恢复后数据校验一致 |
| 回归 | 单机模式下列表、编辑、依赖、排期、导出、打印不回归 |

性能指标需要实测后填写，本文档不预设数字。

## 15. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| PocketBase 规则表达力不足 | 成员权限需写 hook，增加复杂度 | 先做权限原型，验证后再定方案 |
| SQLite 写入并发受限 | 多人高频编辑时排队或失败 | 批量推送、单写者、WAL，预留 Postgres 迁移 |
| 实时推送量过大 | 前端重绘抖动 | 项目级订阅、渲染节流、按 `rev` 去重 |
| 迁移 ID 冲突 | 跨项目主键碰撞 | 复合主键 `(project_id, id)` |
| 客户端时钟漂移 | 排序和冲突判断错误 | 服务端时间加 `server_seq` |
| 出站队列膨胀 | 存储占满、同步变慢 | 队列上限、退避重试、人工处理入口 |
| `file://` 跨域 | 协作模式无法请求 API | 同源托管前端，保留单机 `file://` 模式 |
| 分享令牌泄漏 | 未授权读取 | 只存哈希、短期会话、可撤销、可设过期 |
| 审计被篡改 | 追责失效 | 服务端生成、追加式、无更新接口 |
| CRDT 引入过早 | 模型重写、约束失效 | 只在 P3-3 对文本字段启用 |
| 附件与元数据不一致 | 悬挂引用或丢失文件 | 校验和、事务写入、孤儿清理任务 |
| 前端无构建与 SDK 冲突 | 引入打包步骤 | 优先 REST 加原生 `fetch`，避免重 SDK |

## 16. 待用户决策

1. 部署形态：单机自托管 PocketBase、内网自建服务、还是托管 Supabase。
2. 身份来源：本地账号密码、企业 SSO/OIDC、还是仅分享链接。
3. 是否必须保留双击 `index.html` 的单机运行方式。这决定是否需要 Service Worker 和双模式设计。
4. 使用范围：单项目自用、单团队、还是多租户。直接影响表结构和权限复杂度。
5. 只读分享的范围、有效期和是否需要访问密码。
6. 附件规模：是否需要对象存储，单项目容量上限。
7. 是否需要服务端生成 PDF，还是浏览器打印即可。
8. 审计保留周期和合规要求。
9. 实时协同是否必须做到单元格级并发编辑。这决定是否引入 Yjs。
10. 是否需要与企业现有系统集成，例如组织架构、单点登录、消息通知。

## 17. 未验证项

- PocketBase 目标版本的 S3 兼容文件存储支持范围。
- PocketBase API 规则对多级成员关系的表达能力和性能。
- PocketBase 实时订阅的过滤语法、连接数和消息频率上限。
- PocketBase 内置备份接口的粒度和恢复流程细节。
- Supabase 自托管所需组件版本、资源占用和升级路径。
- Appwrite、Nhost 在目标版本下的自托管能力和许可条款。
- 各方案在真实项目规模下的写入吞吐、延迟和内存占用。
- 各方案的商业托管价格和免费额度。
- 浏览器 IndexedDB 配额、Service Worker 生命周期和离线行为的跨浏览器差异。
- 服务端 PDF 生成的资源成本和样式一致性。
- 分享令牌的推荐长度和过期策略在目标合规要求下的具体取值。
- 现有 `activity` 历史数据回填 `actor_id` 的准确率。

## 18. 参考

- 当前数据层：`js/store.js`、`js/validate.js`、`js/task-manager.js`
- 协作模型：`docs/design/11-collaboration.md`、`js/comments.js`、`js/activity.js`、`js/attachment-meta.js`
- 附件存储：`js/attachment-store.js`
- 资源与工作量：`docs/design/12-resources.md`
- 排期与依赖：`docs/design/03-dependency-model.md`、`docs/design/13-scheduler.md`
- 法与许可信息以各项目官方仓库的 LICENSE 和官方文档为准。
