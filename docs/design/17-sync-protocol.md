# P3-1 同步协议与离线队列设计

## 1. 结论

P3-1 交付两个纯前端模块。

| 模块 | 全局对象 | 职责 |
|------|----------|------|
| `js/sync.js` | `SyncClient` | 认证、增量拉取、批量推送、v3 数据迁移、冲突合并、错误分类 |
| `js/sync-queue.js` | `SyncQueue` | localStorage 持久化出站队列、幂等键、指数退避、确认与失败处理 |

同步采用「本地缓存继续读，服务端为权威，出站队列异步写」的路径。前端不引入 PocketBase SDK，只使用 REST 和原生 `fetch`。传输层可注入，Node 测试用 fake transport 覆盖全部协议分支。

本轮只交付模块、协议文档和测试。`TaskManager`、`History`、`app.js`、`index.html` 的接入代码不在本轮修改范围内。

## 2. 范围

包含：

- PocketBase 认证与请求头约定。
- 按 `updated` 游标的增量拉取。
- 带 `opId` 幂等键的批量推送。
- localStorage v3 到 PocketBase 集合的迁移 payload。
- 字段级冲突合并与删除墓碑。
- 离线队列的持久化、重试和顺序约束。
- 与 `TaskManager`、`History` 的接入点和 P3-3 实时预留。

不包含：

- PocketBase 服务端 hook 的具体实现。
- 真实网络请求、浏览器端联调和部署验证。
- 附件二进制上传与下载。
- 实时订阅和在线状态。
- 权限、分享和审计接口。

## 3. 端点与认证

默认路径集中在 `createClient` 的配置项中，可以覆盖。

| 用途 | 方法 | 默认路径 | 可覆盖配置 |
|------|------|----------|------------|
| 登录 | POST | `/api/collections/users/auth-with-password` | `loginPath` |
| 增量拉取 | GET | `/api/sync/pull` | `pullPath` |
| 批量推送 | POST | `/api/sync/push` | `pushPath` |
| 实时订阅 | GET | 预留，见第 10 节 | 本轮未实现 |

`baseUrl` 末尾斜杠会被去掉。空字符串表示同源部署，适用于 PocketBase `pb_public` 托管前端。

请求头：

```http
Accept: application/json
Content-Type: application/json
Authorization: <PocketBase token>
```

PocketBase 的 `Authorization` 头直接放 token，不加 `Bearer` 前缀。登录请求不带旧 token。`logout()` 只清空客户端 token，符合 PocketBase 客户端登出语义，不发起网络请求。

登录请求体：

```json
{ "identity": "user@example.com", "password": "secret" }
```

登录响应至少包含 `token`，可选 `record`。客户端保存 token，后续请求自动携带。

## 4. 增量拉取

请求：

```http
GET /api/sync/pull?projectId=p1&since=17&collections=tasks,milestones,links,comments,activity,attachments
```

参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `projectId` | 是 | 项目标识，缺失时返回 `validation` 错误 |
| `since` | 否 | 非负整数游标，默认 `0` |
| `collections` | 否 | 逗号分隔集合列表，默认六个可读集合 |

可拉取集合固定为 `tasks`、`milestones`、`links`、`comments`、`activity`、`attachments`。`views`、`settings` 不参与增量拉取，未知集合返回 `validation` 错误。

响应：

```json
{
  "changes": [
    {
      "entity": "tasks",
      "entityId": "t1",
      "op": "update",
      "rev": 3,
      "updated": "2026-11-10T08:00:00.000Z",
      "record": { "external_id": "t1", "name": "任务 A" }
    }
  ],
  "cursor": 23,
  "hasMore": false
}
```

客户端返回：

```js
{
  changes: [{ entity, entityId, op, rev, updated, record }],
  cursor: number,
  hasMore: boolean
}
```

规则：

- `entity` 支持单数别名，返回时统一为集合名。
- `entityId` 优先取 `entityId`，其次 `id`，最后取 `record.external_id`。
- 缺失 `record` 时保留 `null`，调用方按删除或结构变更处理。
- 服务端游标单调递增，客户端保存 `cursor`，下次作为 `since`。
- `hasMore` 为真时循环拉取，直到为假。
- 客户端不使用本地时钟判断新旧，只使用服务端 `rev` 和 `updated`。

## 5. 批量推送

请求：

```json
{
  "projectId": "p1",
  "ops": [
    {
      "opId": "op-lz3k-1-a1b2c3",
      "entity": "tasks",
      "entityId": "t1",
      "op": "update",
      "baseRev": 2,
      "patch": { "name": "新名称" }
    },
    {
      "opId": "op-lz3k-2-d4e5f6",
      "entity": "tasks",
      "entityId": "t2",
      "op": "delete",
      "baseRev": 5,
      "patch": null
    }
  ]
}
```

字段：

| 字段 | 说明 |
|------|------|
| `opId` | 客户端幂等键，缺失时由客户端生成 |
| `entity` | 集合名，支持单数别名 |
| `entityId` | 客户端实体 ID |
| `op` | `create`、`update`、`delete` |
| `baseRev` | 本地修改基于的服务端修订号，可为空 |
| `patch` | 字段补丁，`delete` 时可为空 |

可推送集合：`tasks`、`milestones`、`links`、`comments`、`attachments`、`views`、`settings`。`activity` 由服务端生成，客户端不能推送。

响应：

```json
{
  "results": [
    { "opId": "op-lz3k-1-a1b2c3", "status": "ok", "rev": 3 },
    { "opId": "op-lz3k-2-d4e5f6", "status": "conflict", "current": { "rev": 6, "deleted_at": "..." } },
    { "opId": "op-lz3k-3-xyz", "status": "error", "error": { "message": "字段校验失败" } }
  ]
}
```

客户端统一返回：

```js
{
  results: [
    { opId, entity, entityId, status: 'ok'|'conflict'|'error', rev, current, error }
  ]
}
```

规则：

- `opId` 在服务端建唯一索引，重复推送返回同一结果。
- 同一批次按 `ops` 顺序处理，父任务先于子任务。
- 服务端缺少某条结果时，客户端对该条返回 `server` 错误，避免静默成功。
- `status` 接受 `ok`、`success`、`applied`、`conflict`、`error`、`failed`。未识别状态按 `error`、`current`、`ok` 的顺序推断。
- 推送响应中即使单条失败，HTTP 仍返回 2xx，由 `results` 表达逐条状态。整体 4xx 和 5xx 由错误分类处理。

## 6. 错误分类

所有异常统一为 `SyncError`，带 `kind`、`message`、`details`。`details.status` 保留 HTTP 状态，`details.body` 保留响应体。

| `kind` | HTTP 状态 | 触发场景 | 建议处理 |
|--------|-----------|----------|----------|
| `network` | 无响应 | 断网、DNS 失败、传输层抛错、响应结构无效 | 进入队列退避重试 |
| `auth` | 401、403 | token 失效、权限不足 | 停止推送，提示重新登录或只读 |
| `validation` | 400、404、422 | 参数错误、字段校验失败、实体不存在 | 不重试，标记需人工处理 |
| `conflict` | 409 | 修订号冲突、结构性变更被拒绝 | 拉取远端值，按策略合并 |
| `server` | 5xx 和其他状态 | 服务端异常、路径错误 | 退避重试，达到上限后标记 dead |

`SyncClient.classifyStatus(status)` 可直接查询状态映射。`SyncClient.isSyncError(error)` 用于跨环境判断。

## 7. 冲突合并

`SyncClient.resolveConflict(local, remote, strategy)` 返回：

```js
{
  record: Object,
  conflicts: ['name'],
  deleted: false,
  strategy: 'merge',
  source: 'local'|'remote'|'merge'
}
```

`strategy` 取值：

| 策略 | 行为 |
|------|------|
| `merge` | 默认，按 `updated` 和 `rev` 做字段级合并 |
| `local` | 本地记录整体胜出 |
| `remote` | 远端记录整体胜出 |

合并规则：

1. 双方都是墓碑时，保留较新墓碑，结果标记删除。
2. 远端是墓碑时，删除优先。只有本地带 `deleted: false` 且更新时间更晚，才视为显式恢复。
3. 本地是墓碑时，删除优先。远端带 `deleted: false` 且更新更晚时，按显式恢复处理。
4. `parentId`、`parent_id`、`order`、`sort_order` 属于结构性字段，始终采用远端值，差异写入 `conflicts`。
5. 双方都提供 `changed`、`changedFields` 或 `_changed` 字段集合时，按字段集合合并。
6. 不同字段各自应用。交集字段按较新的 `updated` 取胜，并写入 `conflicts`。
7. 没有显式字段集合时，按 `updated` 比较，`updated` 相同再比较 `rev`，仍然相同则采用远端。
8. `rev` 取双方最大值。下一次推送由服务端分配新的 `rev`。
9. 合并结果不修改入参，返回深拷贝。
10. `changed`、`changedFields`、`_changed` 只用于合并计算，不写入结果。

时间字段优先读 `updated`，缺失时读 `updated_at`。时间支持 ISO 字符串、毫秒时间戳和 `Date` 对象。

## 8. 删除墓碑

删除一律软删除，使用 `deleted_at` 字段，必要时同时写 `deleted: true`。

- 墓碑参与增量拉取和冲突合并。
- 结构性删除由远端裁决，客户端不能自动覆盖。
- 恢复必须显式设置 `deleted: false`，并带更晚的更新时间。
- 拉取到墓碑时，接入层从本地视图移除实体，但保留 `rev` 映射，避免后续重复创建。
- 附件删除先落墓碑，二进制由服务端清理任务处理。

## 9. 数据迁移

`SyncClient.migrateLocalData(localData, options)` 或 `client.migrateLocalData(localData)` 把 v3 数据转成集合 payload。

```js
{
  protocolVersion: 1,
  projectId: 'p1',
  sourceVersion: 3,
  generatedAt: '2026-11-10T00:00:00.000Z',
  order: ['tasks', 'milestones', 'links', 'comments', 'activity', 'attachments', 'views', 'settings'],
  counts: { tasks: 2, milestones: 1, links: 1, comments: 1, activity: 1, attachments: 1, views: 1, settings: 1 },
  errors: [{ path, code, message }],
  collections: {
    tasks: [],
    milestones: [],
    links: [],
    comments: [],
    activity: [],
    attachments: [],
    views: [],
    settings: []
  }
}
```

选项：

| 选项 | 说明 |
|------|------|
| `projectId` | 必填，客户端实例会自动使用 `createClient` 的 `projectId` |
| `now` | 导入时间，字符串或返回字符串的函数，默认当前时间 |
| `user` | 写入 `updated_by` 的导入者 |

主键约定：PocketBase 记录 ID 由服务端生成，客户端 ID 保留在 `external_id`。父子、依赖和任务引用统一使用 `external_id` 后缀字段，避免 PocketBase ID 字符集限制。

字段映射：

| 客户端 | 服务端 | 说明 |
|--------|--------|------|
| `tasks[].id` | `tasks.external_id` | 保留原 ID |
| `tasks[].parentId` | `tasks.parent_external_id` | 父任务缺失时置空并记录错误 |
| `tasks[].order` | `tasks.sort_order` | 默认 0 |
| `tasks[].ganttRow` | `tasks.gantt_row` | 可空 |
| `tasks[].startDate` | `tasks.start_date` | 空字符串转 `null` |
| `tasks[].endDate` | `tasks.end_date` | 空字符串转 `null` |
| `tasks[].plannedEndDate` | `tasks.planned_end_date` | 空字符串转 `null` |
| `tasks[].estimatedHours` | `tasks.estimated_hours` | 可空 |
| `tasks[].progress` | `tasks.progress` | 默认 0 |
| `tasks[].locked` | `tasks.locked` | 只有 `true` 视为锁定 |
| `milestones[].taskId` | `milestones.task_external_id` | 孤儿里程碑跳过 |
| `milestones[].status` | `milestones.status` | 默认 `pending` |
| `links[].source` | `links.source_external_id` | 端点必须存在 |
| `links[].target` | `links.target_external_id` | 端点必须存在 |
| `links[].type` | `links.type` | 默认 `FS` |
| `links[].lag` | `links.lag` | 默认 0，取整 |
| `comments[].author` | `comments.author_name` | 导入期保留显示名 |
| `comments[].createdAt` | `comments.created_at` | 缺失时用导入时间 |
| `comments[].updatedAt` | `comments.updated_at` | 可空 |
| `activity[].actor` | `activity.actor_name` | 历史记录保留显示名 |
| `activity[].before` | `activity.before_json` | 原值深拷贝 |
| `activity[].after` | `activity.after_json` | 原值深拷贝 |
| `activity[].at` | `activity.at` | 缺失时用导入时间 |
| `attachments[].blobKey` | `attachments.storage_key` | 二进制另行上传 |
| 无 | `attachments.checksum` | 导入时为空，后续上传回填 |
| `views[].config` | `views.config_json` | 缺失时为 `null` |
| `settings` | `settings.settings_json` | 整体保存，`external_id` 固定为 `settings` |
| 无 | `rev` | 导入时为 1 |
| 无 | `created_at`、`updated_at` | 导入时间 |
| 无 | `deleted_at` | 导入时为空 |

任务顺序：

- 迁移前按父子关系拓扑排序，父任务先于子任务。
- 同一层保持原始数组顺序。
- 父任务不存在时置空 `parent_external_id`，并写入 `MISSING_PARENT`。
- 父子成环时写入 `CYCLE`，相关任务仍保留，交给服务端二次校验。

引用完整性：

| 错误码 | 处理 |
|--------|------|
| `MISSING_PARENT` | 父引用置空，任务保留 |
| `CYCLE` | 任务保留，记录错误 |
| `ORPHAN_MILESTONE` | 里程碑跳过 |
| `ORPHAN_LINK` | 依赖跳过 |
| `ORPHAN_COMMENT` | 评论跳过 |
| `ORPHAN_ACTIVITY` | 活动跳过 |
| `ORPHAN_ATTACHMENT` | 附件元数据跳过 |
| `SELF_REFERENCE` | 自依赖跳过 |
| `INVALID_*` | 缺少合法 ID 的记录跳过 |

`errors` 不阻断迁移。调用方可以先用 dry-run 展示错误，再决定是否继续。迁移函数不修改 `localData`，返回全新对象。

附件二进制不在迁移 payload 中。P3-1 只迁移元数据，二进制上传由后续阶段按 `storage_key` 完成。

## 10. 离线队列

`SyncQueue` 使用 localStorage 键 `pmweb_sync_queue`，默认实例方法与实例方法同名。

```js
var queue = SyncQueue.create({
  storage: localStorage,
  key: 'pmweb_sync_queue',
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  now: function() { return Date.now(); }
});
```

存储结构：

```js
{
  version: 1,
  items: [
    {
      opId: 'op-lz3k-1-a1b2c3',
      projectId: 'p1',
      entity: 'tasks',
      entityId: 't1',
      op: 'update',
      patch: { name: '新名称' },
      baseRev: 2,
      clientAt: 1762732800000,
      attempts: 0,
      lastError: null,
      nextAttemptAt: 0,
      status: 'pending'
    }
  ]
}
```

方法：

| 方法 | 行为 | 返回值 |
|------|------|--------|
| `enqueue(item)` | 入队，按 `opId` 去重 | `{ duplicate, item }` |
| `list()` | 按入队顺序返回全部项副本 | `Array` |
| `get(opId)` | 返回单项副本 | `Object|null` |
| `peek(params)` | 返回最早可运行项 | `Object|null` |
| `ack(opId)` | 删除已确认项 | `boolean` |
| `fail(opId, error)` | 增加尝试次数并计算下次时间 | `Object|null` |
| `clear()` | 清空队列 | `number` |
| `size()` | 当前项数 | `number` |

规则：

- `opId` 是幂等键。重复入队返回 `duplicate: true`，保留原项，不覆盖补丁。
- 缺失 `opId` 时自动生成，格式为 `op-<时钟>-<序号>-<随机>`。
- 实体支持单数别名，存储时统一为集合名。
- `patch` 深拷贝，入队后修改原对象不会影响队列。
- `list()`、`get()`、`peek()` 返回副本，调用方修改返回值不会污染存储。
- 存储损坏、JSON 解析失败、结构非法时安全回退为空队列。
- 加载时按 `opId` 去重，剔除实体、操作或 ID 非法的项。
- 存储写入失败不抛错，入队仍在内存中生效，调用方可从 `size()` 观察状态。

退避：

```text
delay = min(baseDelayMs * 2^(attempts - 1), maxDelayMs)
nextAttemptAt = now + delay
```

默认 `baseDelayMs` 为 1000 毫秒，`maxDelayMs` 为 60000 毫秒，`maxAttempts` 为 5。第 1 次失败等待 1 秒，第 2 次 2 秒，依次翻倍，达到上限后不再增长。

达到 `maxAttempts` 后：

- `status` 置为 `dead`。
- `nextAttemptAt` 置为 `null`。
- 项保留在队列中，供人工排查。
- `peek()` 默认跳过 `dead` 项，`peek({ includeDead: true })` 可以读取。

顺序：

- 同一实体的前序项未确认时，后续同实体项不会越过它。
- 前序项因退避延后时，同实体后续项一起等待。
- 不同实体可以并行推进。
- `peek({ includeDelayed: true })` 忽略退避时间，用于调试。

时间注入：

- `now` 可以是函数，测试和重放时可以固定时钟。
- `peek` 也接受 `params.now` 覆盖单次判断时间。
- `nextAttemptAt` 使用毫秒时间戳，便于比较和序列化。

`SyncQueue` 不发起网络请求。它只负责数据排队和状态记录，发送由同步引擎调用 `SyncClient.pushChanges` 完成。

## 11. 与 TaskManager 和 History 的接入点

写入路径：

```text
用户操作
  -> TaskManager 更新内存模型并保存 localStorage
  -> 界面立即重绘
  -> 接入层把变更转成 OutboxItem
  -> SyncQueue.enqueue
  -> 批量 SyncClient.pushChanges
  -> 成功 ack，冲突进入冲突列表，失败 fail 退避
```

接入约束：

- `TaskManager` 仍然负责本地权威写入，`SyncClient` 不直接改 `TaskManager.data`。
- `History` 的命令继续只做本地 `redo` 和 `undo`。同步操作在命令之外生成，避免撤销时重复入队。
- 一次表单保存生成一条或多条 outbox 记录，同一实体的连续操作按入队顺序发送。
- 新建父子任务时先生成双方 ID，父任务先入队，子任务后入队。
- `TaskManager.addTask`、`updateTask`、`deleteTask`、`addMilestone`、`addLink` 等写操作返回后，接入层采集变更字段作为 `patch`。
- 删除任务时，任务、后代、里程碑和依赖分别生成墓碑操作，按父先子后排列。
- 冲突结果 `current` 交给 `resolveConflict`，合并结果再入队，避免静默覆盖。
- 拉取到远端变更后，接入层需要把远端记录转回本地 v3 结构，再调用 `TaskManager` 的写入接口或 `replaceData`。
- `History` 的撤销操作只回滚本地状态。同步模式下，撤销产生的反向变更同样进入 outbox。
- `History` 不持久化，刷新后队列仍然保留，未确认操作不会因为历史清空而丢失。

服务端结果里的 `rev` 需要按实体保存，供下一次 `baseRev` 使用。本轮没有新增本地 rev 映射的存储键。接入层可以在后续阶段决定使用独立 localStorage 键或 `settings` 字段，并在冲突处理前完成读写。

## 12. P3-3 实时协同预留

实时通道建议使用 PocketBase SSE。

```text
GET /api/realtime
```

订阅范围：

- 按 `projectId` 过滤。
- 只订阅当前视图需要的集合。
- 事件携带 `entity`、`entityId`、`rev`、`opId`、`updated` 和 `record`。

客户端处理顺序：

1. 重连后先调用 `pullChanges({ since: cursor })` 补齐增量。
2. 更新本地 `cursor`。
3. 再恢复订阅。
4. 收到事件时比较 `rev`，小于等于本地 `rev` 的忽略。
5. 自己产生的 `opId` 在回显时跳过，避免重复渲染。
6. 多条事件按短窗口合并，只触发一次重绘。

字段级 CRDT 留给 P3-3 的 `description` 和评论草稿。任务结构字段继续走服务端 `rev` 裁决，避免依赖环、父级层级和排期约束失效。

## 13. 测试覆盖

`tests/sync.test.js`：

- 登录请求体、token 保存、后续 Authorization 头、登出清空。
- 拉取参数、游标、集合过滤、结果规范化。
- 非法集合、非法 `since`、缺少 `projectId` 的拒绝。
- 批量推送请求体、逐条结果映射、缺失结果补错。
- 自动生成 `opId`，拒绝只读集合和非法操作。
- HTTP 状态到五类错误的映射，传输层抛错和无效响应的分类。
- 迁移字段映射、父先子后排序、孤儿引用、环路、错误码、计数、输入不被修改。
- 冲突合并的本地胜出、远端胜出、字段级合并、同字段冲突、结构性字段、墓碑、显式恢复、强制策略、输入不被修改。
- 模块加载不访问 localStorage 和 DOM。

`tests/sync-queue.test.js`：

- 入队持久化、跨实例读取、自动生成和显式 `opId`。
- 幂等去重，重复入队不覆盖原项。
- 实体别名、非法输入、输入不被修改、返回副本。
- 损坏存储回退、加载时去重和剔除非法项。
- 入队顺序、`peek` 顺序、同实体阻塞。
- 指数退避、最大重试、`dead` 标记、零延迟边界。
- `ack`、`clear`、`size`、默认键、默认实例委托。
- 队列不包含网络方法。

运行方式：

```bash
node --check js/sync.js
node --check js/sync-queue.js
node tests/sync.test.js
node tests/sync-queue.test.js
node tests/run-all.js
```

## 14. 未验证项

- 目标 PocketBase 版本的 `auth-with-password` 响应结构和 token 头格式。
- `/api/sync/pull`、`/api/sync/push` 自定义路由的 hook 实现和事务边界。
- PocketBase 集合字段名、唯一索引和批量写入的事务行为。
- 服务端 `opId` 幂等去重的具体实现。
- 真实网络下的超时、重试和连接复用表现。
- 浏览器 `fetch` 在 `file://` 下的跨域限制，协作模式需要同源部署。
- SSE 实时订阅的过滤语法、断线重连和消息顺序。
- 附件二进制上传、校验和回填和孤儿清理。
- 冲突结果写入界面的交互和提示文案。
- 本地 `rev` 映射和游标的持久化位置。
- 大项目下的拉取分页、批量大小和 localStorage 容量上限。
- 浏览器和真实 PocketBase 环境均未验证。
