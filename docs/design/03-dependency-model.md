# P1-1 依赖数据模型设计

## 1. 结论

依赖关系以 `{ id, source, target, type, lag }` 表示，存放在数据根节点的 `links` 数组中。`js/links.js` 提供全局对象 `Links`，只包含数据模型与图算法，全部为纯函数。Timeline 的箭头、拖拽和自动排期在后续任务接入，本阶段不修改任何 UI 文件。

## 2. 范围

本阶段包含：

- 依赖字段定义与类型语义。
- 结构校验、环检测、拓扑排序。
- 直接前驱与后继查询。
- 新增依赖的合法性检查。
- 四种依赖类型对目标日期的约束计算。

本阶段不包含：

- 箭头绘制与命中区域。
- 依赖创建交互与删除交互。
- 自动改期和关键路径。
- 工作日历与节假日扣除。
- `index.html` 脚本挂载。

## 3. 数据字段

```js
Link {
  id: string,      // 依赖唯一标识
  source: string,  // 前置任务 id
  target: string,  // 后置任务 id
  type: string,    // FS | SS | FF | SF
  lag: number      // 整数，单位：天
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 非空字符串，由 `Links.create` 生成，格式对调用方不透明 |
| `source` | string | 前置任务 id，必须指向 `tasks` 中存在的任务 |
| `target` | string | 后置任务 id，必须指向 `tasks` 中存在的任务 |
| `type` | string | 四种依赖类型之一，缺省为 `FS` |
| `lag` | number | 整数天，允许负数表示提前量，缺省为 `0` |

示例：

```js
var link = Links.create('task-a', 'task-b', 'FS', 2);
// { id: 'link-1-xxxxxxxx', source: 'task-a', target: 'task-b', type: 'FS', lag: 2 }
```

`create` 只构造新对象，不读写存储，不修改入参。`id` 由内部计数器和随机后缀组成，调用方不应解析其格式。

## 4. 依赖类型

| 类型 | 含义 | 约束对象 |
|------|------|----------|
| `FS` | Finish to Start，前置完成后后置开始 | 目标开始日期 |
| `SS` | Start to Start，前置开始后后置开始 | 目标开始日期 |
| `FF` | Finish to Finish，前置完成后后置完成 | 目标结束日期 |
| `SF` | Start to Finish，前置开始后后置完成 | 目标结束日期 |

同一对任务只允许一条依赖。`source` 与 `target` 的顺序表达方向，反向依赖视为另一条边，仍受成环检查约束。

## 5. lag 规则

- `lag` 按自然日计算，跨月、跨年直接累加，暂不扣除周末和节假日。
- `lag` 必须为有限整数，`1.5`、`'2'`、`NaN` 均视为非法。
- 正数表示延后，`0` 表示紧接，负数表示提前。
- 日期计算统一使用 UTC，避免本地时区夏令时造成偏移。
- 源任务缺少对应日期时，`computeConstraint` 返回 `null`。

## 6. 校验

```js
Links.validate(links, tasks) -> { valid: boolean, errors: Error[] }
```

`tasks` 可以是任务对象数组、任务 id 数组或 id 的 `Set`。不传 `tasks` 时跳过存在性检查，仍执行结构与重复检查。

错误项：

```js
{
  index: number | null,  // links 中的下标，整体错误为 null
  code: string,
  message: string
}
```

| code | 触发条件 |
|------|----------|
| `INVALID_LINKS` | `links` 不是数组 |
| `INVALID_LINK` | 数组项不是对象 |
| `INVALID_TYPE` | `type` 不属于 FS、SS、FF、SF |
| `INVALID_LAG` | `lag` 不是有限整数 |
| `INVALID_ENDPOINT` | `source` 或 `target` 不是非空字符串 |
| `SELF_REFERENCE` | `source` 与 `target` 相同 |
| `MISSING_SOURCE` | `source` 不在任务集合中 |
| `MISSING_TARGET` | `target` 不在任务集合中 |
| `DUPLICATE_EDGE` | 同一对 `source` 到 `target` 出现多次，类型不同也算重复 |

`validate` 只做结构校验，不检测环。环检测由 `detectCycle` 和 `topologicalOrder` 负责，调用方可以在保存前串行执行两步检查。

## 7. 环检测

```js
Links.detectCycle(links) -> string[] | null
```

- 无环返回 `null`。
- 有环返回环路节点数组，起点只出现一次，顺序从首次进入环的节点开始。
- 自引用返回 `['a']`。
- 使用深度优先搜索和三色标记，按 `links` 中输入边的顺序遍历，结果稳定。
- 非法端点会被忽略，不会抛错。

示例：`a -> b -> c -> a` 返回 `['a', 'b', 'c']`。

## 8. 拓扑排序

```js
Links.topologicalOrder(links, taskIds) -> {
  order: string[],
  cycle: string[] | null,
  error: string | null
}
```

- 输出包含 `taskIds` 中的全部节点，孤立节点保留。
- 多个可选节点同时就绪时，按 `taskIds` 中的原始顺序选取，保证结果稳定。
- `links` 中指向 `taskIds` 之外的边被忽略。
- 检测到环时 `order` 为空数组，`cycle` 返回环路节点，`error` 返回可读错误信息。
- `taskIds` 不传时，节点集合从 `links` 的端点按首次出现顺序推导。

## 9. 日期约束

```js
Links.computeConstraint(link, sourceTask) -> {
  type: string,
  lag: number,
  field: 'startDate' | 'endDate',
  date: 'YYYY-MM-DD',
  source: string,
  target: string
} | null
```

计算规则，`L` 为 `lag`：

| 类型 | 目标字段 | 公式 |
|------|----------|------|
| `FS` | `startDate` | `sourceTask.endDate + L` |
| `SS` | `startDate` | `sourceTask.startDate + L` |
| `FF` | `endDate` | `sourceTask.endDate + L` |
| `SF` | `endDate` | `sourceTask.startDate + L` |

以源任务 `2026-01-10` 到 `2026-01-20` 为例：

| 类型 | lag | 目标字段 | 结果 |
|------|-----|----------|------|
| `FS` | 3 | `startDate` | `2026-01-23` |
| `SS` | 2 | `startDate` | `2026-01-12` |
| `FF` | 5 | `endDate` | `2026-01-25` |
| `SF` | 4 | `endDate` | `2026-01-14` |
| `FS` | -2 | `startDate` | `2026-01-18` |

返回 `null` 的情况：

- `link` 或 `sourceTask` 为空。
- `link.type` 非法。
- 所需的基础日期缺失。
- 基础日期不是合法的 `YYYY-MM-DD`。

`computeConstraint` 只给出约束边界，不直接修改目标任务。是否把约束写回任务由上层决定，本阶段不做自动改期。

## 10. 查询与新增

```js
Links.successors(id, links)   -> string[]  // 直接后继，按首次出现顺序去重
Links.predecessors(id, links) -> string[]  // 直接前驱，按首次出现顺序去重
```

两者只返回直接邻居，多级遍历由调用方组合。

```js
Links.canAdd(links, source, target, type) -> {
  ok: boolean,
  code: string | null,
  reason: string | null
}
```

检查顺序：

1. 端点必须是非空字符串，否则 `INVALID_ENDPOINT`。
2. 类型必须合法，否则 `INVALID_TYPE`。
3. `source` 与 `target` 相同，返回 `SELF_REFERENCE`。
4. 已存在同一方向的依赖，返回 `DUPLICATE_EDGE`。
5. 从 `target` 可以到达 `source`，新增后成环，返回 `CYCLE`。
6. 全部通过返回 `{ ok: true, code: null, reason: null }`。

`canAdd` 只做判断，不写入 `links` 数组。

## 11. 纯函数约束

`js/links.js` 的所有导出函数满足：

- 不读取或写入 `localStorage`，不依赖 DOM。
- 不修改传入的 `links`、`tasks`、`taskIds`。
- 内部使用 `slice`、`Map`、`Set` 等新结构，不对输入排序。
- 输入为空或结构非法时不抛异常，返回空结果或错误列表。
- 唯一的非确定性来源是 `create` 生成的 `id`，它不影响其他计算。

## 12. 后续 Timeline 接入点

本阶段不修改 UI，后续接入按以下顺序进行：

1. **脚本挂载**：由工作台负责人在 `index.html` 中按 `date.js`、`store.js`、`links.js` 的顺序加入 `<script>`，保持经典脚本和 `file://` 双击可运行。
2. **数据来源**：`TaskManager.data.links` 作为唯一依赖数据源，读写仍通过 `DataStore.save` 和 `TaskManager` 完成。
3. **保存前校验**：导入、依赖创建和依赖修改后调用 `Links.validate`，再调用 `Links.detectCycle`。存在错误或环时阻止保存，并把 `errors[].message` 显示到状态栏。
4. **创建交互**：拖出依赖或选择前置任务时，先调用 `Links.canAdd`，失败时提示 `reason`，成功后再构造 link 并写入数据。
5. **渲染**：`Workbench.render()` 在 `RowModel.build()` 之后读取 `links`，用 `row.byId` 取得两端行位置，在时间轴覆盖层绘制箭头。箭头只是 overlay，不进入行模型，也不改变行高。
6. **日期约束**：Timeline 预览或自动排期时调用 `Links.computeConstraint`，把结果作为目标的 `startDate` 或 `endDate` 边界。父任务需要先通过 `TaskManager.getDateRange` 得到派生日期，再作为 `sourceTask` 传入。
7. **拖拽联动**：任务条拖拽结束后先更新 `TaskManager`，再重新校验并重绘箭头。拖拽过程中只做视觉预览，不写入依赖。
8. **排序与分组**：需要按依赖先后展示时，使用 `Links.topologicalOrder(links, taskIds)` 的 `order`，环存在时回退到默认顺序并提示错误。
9. **性能**：图算法均为线性或近似线性复杂度。200 行规模直接全量计算，后续虚拟化时只需对可见子集绘制箭头。

## 13. 测试

`tests/links.test.js` 覆盖：

- 四种类型常量与 `create` 的字段和唯一 id。
- 合法 FS 通过，非法类型和非法 lag 失败。
- 自引用、重复边、缺失任务、非数组输入失败。
- 简单环、多节点环、自引用环和环外边。
- 多根节点、孤立节点、未知端点的稳定拓扑序。
- 成环时 `topologicalOrder` 返回错误和环路。
- 直接前驱与后继的去重和顺序。
- `canAdd` 的自引用、重复、成环、非法类型和空端点。
- FS、SS、FF、SF 加 lag 的日期计算，含零 lag、负 lag、跨月、跨年。
- 所有函数不修改输入，空输入不抛错。

运行命令：

```bash
node --check js/links.js
node tests/links.test.js
```
