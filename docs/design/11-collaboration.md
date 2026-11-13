# P2-4 协作核心设计

## 1. 结论

协作能力由三个纯数据模型模块组成，全局对象分别为 `Comments`、`Activity`、`AttachmentMeta`：

- `js/comments.js`：任务评论的创建、更新、按任务查询和删除。
- `js/activity.js`：任务字段变更记录和前后任务差异比较。
- `js/attachment-meta.js`：附件元数据生成、校验、按任务查询和删除。

三个模块只处理数据，不读写 `localStorage`，不访问 IndexedDB，不操作 DOM，不生成 HTML，不修改传入对象。本阶段只交付模块、测试和本文档，不接入任何 UI。

## 2. 范围

本阶段包含：

- 评论数据结构与文本长度约束。
- 活动日志数据结构与字段差异生成。
- 附件元数据结构、大小上限和类型白名单。
- IndexedDB 存储适配器的接口约定。
- 容量与清理策略的设计说明。
- 与 UI 的后续接入点。

本阶段不包含：

- 评论列表、活动面板、附件上传控件的渲染。
- 真实文件上传、下载和预览。
- 用户身份、权限和实时协同。
- 后端同步和多端冲突合并。
- `index.html`、`TaskManager`、`GridPane`、`TimelinePane` 的修改。

## 3. 评论数据模型

一条评论的结构：

```js
Comment = {
  id: string,          // comment- 前缀，创建时生成
  taskId: string,      // 关联任务 ID
  author: string,      // 作者显示名，首尾空白已裁剪
  text: string,        // 评论文本，首尾裁剪，内部换行和空白保留
  createdAt: string,   // ISO 8601 时间或调用方给定的时间值
  updatedAt: string|null
}
```

### 3.1 API

| 函数 | 签名 | 返回值 | 说明 |
|------|------|--------|------|
| `create` | `create(taskId, author, text, createdAt)` | Comment \| null | 创建评论，非法输入返回 `null` |
| `update` | `update(comment, text, updatedAt)` | Comment \| null | 返回新评论，原对象不变 |
| `listByTask` | `listByTask(comments, taskId)` | Comment[] | 按 `createdAt` 升序的副本 |
| `remove` | `remove(comments, id)` | Comment[] | 删除后的新数组 |

### 3.2 约束

- `taskId` 必须匹配 `^[A-Za-z0-9_-]{1,128}$`。
- `author` 裁剪后不能为空，长度上限 `MAX_AUTHOR_LENGTH = 120`。
- `text` 裁剪后不能为空，长度上限 `MAX_TEXT_LENGTH = 2000`。
- 文本只裁剪首尾空白，内部换行、缩进和连续空格原样保存。
- `create` 拒绝 `null`、数字和非字符串文本。
- `update` 沿用同一套文本规则，文本不变时仍返回新对象并更新 `updatedAt`。
- `createdAt` 和 `updatedAt` 省略时使用当前时间的 ISO 字符串。
- `listByTask` 对相同时间按 `id` 排序，保证结果稳定。
- 所有函数都不修改传入的数组、评论对象或文本参数。

## 4. 活动日志数据模型

一条活动记录的结构：

```js
ActivityEntry = {
  id: string,          // activity- 前缀，创建时生成
  taskId: string,      // 关联任务 ID
  actor: string,       // 操作人显示名，首尾空白已裁剪
  field: string,       // 变更字段名
  before: any,         // 变更前的值
  after: any,          // 变更后的值
  at: string           // ISO 8601 时间或调用方给定的时间值
}
```

### 4.1 API

| 函数 | 签名 | 返回值 | 说明 |
|------|------|--------|------|
| `record` | `record(taskId, actor, field, before, after, at)` | ActivityEntry \| null | 值有变化才生成记录 |
| `listByTask` | `listByTask(activity, taskId)` | ActivityEntry[] | 按 `at` 升序的副本 |
| `diffTask` | `diffTask(beforeTask, afterTask, actor, at)` | ActivityEntry[] | 比较固定字段集合并生成记录 |

### 4.2 字段白名单

`diffTask` 只比较以下字段，顺序固定为：

```js
FIELDS = [
  'name', 'status', 'assignee', 'startDate',
  'endDate', 'plannedEndDate', 'progress'
]
```

`description`、`color`、`order`、`parentId` 等字段不进入活动日志。父级汇总产生的派生值也不记录，避免同一变更产生重复条目。

### 4.3 约束

- `taskId` 必须匹配 `^[A-Za-z0-9_-]{1,128}$`。
- `actor` 裁剪后不能为空，长度上限 `MAX_ACTOR_LENGTH = 120`。
- `field` 必须是非空字符串。
- `before` 与 `after` 严格相等时不生成记录。
- `undefined` 与 `null` 都表示空值，比较时视为相同。
- 数字、字符串、布尔值按原值保存，不做字符串化。
- `diffTask` 只为实际发生变化的字段生成记录，没有变化时返回空数组。
- `diffTask` 缺少任一任务对象时返回空数组。
- 所有函数都不修改传入的任务对象或数组。

## 5. 附件元数据模型

一条附件元数据的结构：

```js
AttachmentMeta = {
  id: string,          // attachment- 前缀，创建时生成
  taskId: string,      // 关联任务 ID
  name: string,        // 文件名，首尾裁剪
  size: number,        // 字节数，非负整数
  type: string,        // MIME 类型，已转小写
  createdAt: string,   // ISO 8601 时间或调用方给定的时间值
  blobKey: string      // IndexedDB 中的 Blob 键，匹配 ID 白名单
}
```

### 5.1 API

| 函数 | 签名 | 返回值 | 说明 |
|------|------|--------|------|
| `create` | `create(taskId, fileMeta, createdAt)` | AttachmentMeta \| null | 校验通过才返回元数据 |
| `validate` | `validate(meta)` | `{ valid, errors }` | 逐项返回错误码 |
| `listByTask` | `listByTask(attachments, taskId)` | AttachmentMeta[] | 按 `createdAt` 升序的副本 |
| `remove` | `remove(attachments, id)` | AttachmentMeta[] | 删除后的新数组 |

### 5.2 校验规则

| 字段 | 规则 | 错误码 |
|------|------|--------|
| `taskId` | 匹配任务 ID 白名单 | `INVALID_TASK_ID` |
| `name` | 非空、长度不超过 255、不含路径分隔符和控制字符 | `INVALID_NAME` |
| `name` | 长度上限 | `NAME_TOO_LONG` |
| `size` | 非负整数 | `INVALID_SIZE` |
| `size` | 不超过 `MAX_SIZE = 10485760` 字节（10 MB） | `SIZE_EXCEEDED` |
| `type` | 命中 MIME 白名单 | `INVALID_TYPE` |
| `blobKey` | 非空且匹配 `^[A-Za-z0-9_-]{1,128}$` | `INVALID_BLOB_KEY` |
| 整体 | 必须是普通对象 | `INVALID_META` |

MIME 白名单覆盖 PDF、Word、Excel、PowerPoint、纯文本、CSV、PNG、JPEG、GIF 和 WebP。`create` 会把 `type` 转为小写后再校验，因此 `Application/PDF` 会被规范化为 `application/pdf`。

文件名禁止 `/`、`\` 和 ASCII 控制字符，避免在下载或另存时被解释为路径。文件名只作为显示和下载名称，真实存储位置由 `blobKey` 决定。

## 6. 与任务 ID 白名单和转义规则的关系

协作数据通过 `taskId` 关联任务，任务 ID 的合法性沿用现有 `js/validate.js` 的规则：

```js
ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
```

三个模块内部各自复制了同一正则，避免模块加载顺序带来的依赖。任何不匹配的 `taskId` 都不会生成数据，`AttachmentMeta.validate` 会返回 `INVALID_TASK_ID`。

转义规则：

- 评论文本、作者名、活动操作人、附件名都按原始文本保存，模块不做 HTML 转义。
- 渲染层必须使用 `textContent` 或现有的 `escapeHtml` 工具写入 DOM，禁止把文本拼进 `innerHTML`。
- 评论需要保留换行时使用 `white-space: pre-wrap`，不能通过 `innerHTML` 加 `<br>`。
- 作者名和附件名可以出现在 `title`、`aria-label` 等属性中，属性值必须经过属性转义，不能直接拼接。
- `taskId`、`blobKey` 和记录 `id` 已受白名单限制，可以安全用作 `data-*` 属性值和查询键。
- 活动记录中的 `before` 和 `after` 是原始字段值，渲染前同样需要按字段类型转义。

## 7. IndexedDB 存储适配器接口

附件二进制内容不进入 `localStorage`，由 IndexedDB 保存。元数据模块只产出 `blobKey`，不直接调用 IndexedDB。适配器由后续接入层实现，接口约定如下：

```js
AttachmentStore = {
  put(blobKey, blob, options) -> Promise<void>,
  get(blobKey) -> Promise<Blob | null>,
  delete(blobKey) -> Promise<void>,
  has(blobKey) -> Promise<boolean>,
  listKeys() -> Promise<string[]>,
  usage() -> Promise<{ count: number, bytes: number }>,
  prune(options) -> Promise<{ removed: string[] }>
}
```

约定：

- 数据库名 `pmweb-attachments`，对象仓库 `blobs`，主键为 `blobKey`。
- 每个仓库记录保存 `blob`、`size`、`type`、`taskId`、`createdAt` 和 `lastAccessAt`。
- `put` 写入前再次调用 `AttachmentMeta.validate`，防止绕过 UI 的非法数据。
- `get` 命中时更新 `lastAccessAt`，失败时返回 `null`，不抛出业务异常。
- `delete` 对不存在的键幂等返回。
- 所有方法都返回 Promise，错误通过 reject 上报，由调用方决定是否提示用户。
- 适配器不缓存 Blob，避免页面长时间占用内存。

元数据数组建议保存在数据根节点的 `comments`、`activity`、`attachments` 字段中，与任务一起导入导出。二进制内容不随 JSON 导出，导出时需要明确提示附件不会被包含。

## 8. 容量与清理策略

- 单文件上限 10 MB，由 `AttachmentMeta.MAX_SIZE` 统一约束。
- 单任务附件数量建议不超过 20 个，单项目总容量软上限建议 200 MB。
- 写入前读取 `navigator.storage.estimate()`，剩余空间低于 20 MB 时拒绝新上传并提示用户。
- 删除任务时，先删除该任务的元数据和 Blob，再删除任务本身。
- 删除附件元数据后，如果 `blobKey` 不再被任何元数据引用，适配器应立即删除对应 Blob。
- 启动时执行一次孤儿清理：扫描元数据引用的 `blobKey` 集合，删除仓库中未被引用的记录。
- 空间不足时按 `lastAccessAt` 从旧到新清理，先清理孤儿记录，再清理超过 90 天未访问且不属于当前选中任务的附件。
- 清理只删除 Blob 时，保留元数据会导致附件标记为缺失；建议同时把元数据标记为 `missing` 或在确认后一并删除。
- `prune` 返回被删除的 `blobKey` 列表，调用方据此更新元数据或提示用户。

## 9. 与 UI 的接入点

本阶段不修改 UI。后续接入位置：

- 表格行右键菜单：新增“评论”“活动记录”“附件”入口，传入当前 `taskId`。
- 详情抽屉：分页展示 `Comments.listByTask` 和 `Activity.listByTask` 的结果。
- 评论输入框：提交时调用 `Comments.create`，编辑时调用 `Comments.update`，删除时调用 `Comments.remove`。
- 任务编辑提交：在 `TaskManager.updateTask` 前后取出任务快照，调用 `Activity.diffTask` 生成日志，再由 `TaskManager` 保存。
- 附件选择：先由 `AttachmentStore.put` 写入 Blob，再用返回的 `blobKey` 调用 `AttachmentMeta.create`，最后写入元数据数组。
- 附件删除：先调用 `AttachmentMeta.remove`，再在引用计数归零时调用 `AttachmentStore.delete`。
- 时间轴任务条：点击后打开同一详情抽屉，复用同一份评论、活动和附件列表。
- 状态栏：显示当前任务的评论数、附件数和最近活动时间。
- 渲染统一走 `textContent` 或 `escapeHtml`，遵守第 6 节的转义规则。
- 数据变更后由外层统一调用 `Workbench.render()` 或局部刷新，不允许模型模块直接操作 DOM。

## 10. 纯函数约束

- 不读取或写入 `localStorage`、IndexedDB、Cookie。
- 不访问 DOM、`window`、`TaskManager` 或其他全局状态。
- 不修改传入的数组、对象和字符串参数。
- 返回值都是新对象或新数组，调用方可安全修改。
- 内部自增序号只用于生成唯一 ID，不参与业务比较。
- 排序比较只依赖记录自身的时间值和 `id`，结果可重复。

## 11. 测试

测试文件为 `tests/collab.test.js`，通过 `node tests/collab.test.js` 运行，覆盖：

- 评论创建、作者和文本裁剪、时间戳默认值。
- 空文本、纯空白、超长文本、非法任务 ID、空作者和作者长度上限。
- 评论更新返回新对象，原对象保持不变。
- 评论按任务过滤、按时间排序、相同时间稳定排序和删除。
- 活动记录的值变化判断、`undefined` 与 `null` 等价、数字和布尔值变化。
- 非法任务 ID、空字段、空操作人。
- `diffTask` 的字段白名单、全部字段覆盖、无变化返回空数组、忽略白名单外字段。
- `diffTask` 不修改前后任务对象。
- 活动日志按任务过滤和按时间排序。
- 附件元数据生成、类型小写化、大小上限边界、数值合法性。
- 类型白名单、名称必填与路径字符、`blobKey` 必填与格式、非法任务 ID。
- `validate` 的逐项错误码和非对象输入。
- 附件按任务过滤、按时间排序和删除。
- 所有更新、删除和查询操作前后入参快照一致。

运行方式：

```bash
node --check js/comments.js
node --check js/activity.js
node --check js/attachment-meta.js
node tests/collab.test.js
```

## 12. 未覆盖项

- 浏览器中的评论列表、活动面板和附件上传交互。
- IndexedDB 适配器的真实实现、配额读取和清理任务。
- 附件下载、预览和同名文件处理。
- 用户身份、编辑权限和操作人来源。
- 多端同步、冲突合并和实时协作。
- 评论分页、搜索和大量数据下的性能。
- 活动日志的保留周期和自动归档。
- 导出 JSON 时附件 Blob 的处理方式。
