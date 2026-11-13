# 多 worktree 多 agent 并行开发方案

## 1. 结论

可以并行，但不能现在直接把 25 个任务全部丢进多个 worktree。原因有三个：

1. 当前工作区有 1900 多行未提交改动，worktree 从提交创建时不会带上这些改动。
2. 绝大多数任务都修改同一个 `index.html`，并行编辑会产生大量冲突。
3. P0-1 是基础依赖，列配置、行内编辑、汇总、依赖箭头都建立在统一行模型之上。

正确做法是先完成一个阻塞式 Wave 0：检查点提交、拆分为多文件、建立行模型接口。Wave 0 合并后，再按文件所有权创建 Wave 1 的多个 worktree 和 agent。

## 2. 当前阻塞

| 阻塞 | 影响 | 解决 |
|------|------|------|
| 工作区未提交 | 新 worktree 不包含当前改动 | 先做检查点提交 |
| 单文件 `index.html` | 多 agent 同时编辑会冲突 | Wave 0 拆成经典 script 和 CSS 文件 |
| 无 CI、无测试脚本 | 并行结果无法自动验证 | Wave 0 建立 node 测试和语法检查 |
| 任务强依赖 | 后置任务无法提前并行 | 按依赖分波，先合并基础 |

说明：使用经典 `<script src="...">`，不使用 ES module，保持 `file://` 双击可运行。

## 3. 目标文件所有权

Wave 0 完成后，每个 worktree 只允许修改自己名下的文件。

| 模块 | 文件 | 负责内容 |
|------|------|---------|
| 基础日期 | `js/date.js` | `DateUtil`、默认颜色常量 |
| 存储 | `js/store.js` | `DataStore`、v3 迁移、导入导出 |
| 任务数据 | `js/task-manager.js` | 任务与里程碑 CRUD、索引、设置 |
| 行模型 | `js/row-model.js` | 展平、折叠、筛选、汇总投影 |
| 表格 | `js/grid-pane.js` | 列渲染、列宽、行内编辑、表格事件 |
| 时间轴 | `js/timeline-pane.js` | 时间轴表头、任务条、里程碑、坐标映射 |
| 工作台 | `js/workbench.js` | 双面板、滚动同步、分割条、选中与 hover |
| 拖拽 | `js/drag-manager.js` | 任务条和里程碑拖拽 |
| 日历 | `js/calendar-view.js` | 月历视图 |
| 弹窗 | `js/modal.js` | 表单和确认框 |
| 应用 | `js/app.js` | 初始化、工具栏、视图切换 |
| 样式 | `css/base.css`、`css/layout.css`、`css/grid.css`、`css/timeline.css` | 按模块拆分 |
| 测试 | `tests/*.test.js` | 纯函数和迁移测试 |
| 文档 | `docs/**` | 设计、任务计划、进度 |

`index.html` 在 Wave 0 之后只由工作台负责人修改，用于挂载脚本和结构调整。

## 4. 依赖图

```text
W0-1 检查点提交
  -> W0-2 拆分为多文件
  -> W0-3 数据 v3 + RowModel + 测试
       -> W1-A GridPane 列与表格
       -> W1-B TimelinePane 行化改造
       -> W1-C Workbench 双面板与滚动同步
       -> W1-D 测试工具与 fixtures
       -> W1-E 文档与验收清单
            -> W2-1 依赖 links 与箭头
            -> W2-2 进度汇总
            -> W2-3 筛选、排序、分组、保存视图
            -> W2-4 键盘、多选、批量操作
            -> W2-5 按视图导出
                 -> W3-1 基线
                 -> W3-2 工作日历与自动排期
                 -> W3-3 关键路径
                 -> W3-4 评论、日志、附件
                 -> W3-5 资源与工作量
```

## 5. 分波计划

### Wave 0：基础，串行

分支：`feat/w0-foundation`

任务：

1. 检查点提交当前 `index.html`、`task_plan.md`、`findings.md`、`progress.md`、`docs/`。
2. 把 `index.html` 拆成经典 script 文件和 CSS 文件，保持功能不变。
3. 建立 `DateUtil`、`DataStore`、`TaskManager`、`RowModel` 的稳定接口。
4. 数据版本升到 v3，补 `progress`、`plannedEndDate`、`links`、`views`、`gridWidth`。
5. 建立 `tests/row-model.test.js`、`tests/migration.test.js` 和 `npm test` 等价脚本，不引入依赖，直接用 `node`。
6. 回归现有导入、导出、拖拽、日历、键盘操作。

验收：

- 双击 `index.html` 仍可运行。
- 拆分前后功能一致。
- `node --check` 和 node 测试通过。
- `RowModel` 可以被 GridPane、TimelinePane、Workbench 单独引用。

### Wave 1：工作台骨架，四个 worktree 并行

分支与所有权：

| Worktree | 分支 | 独占文件 | 任务 |
|----------|------|---------|------|
| `wt/w1-grid` | `feat/w1-grid` | `js/grid-pane.js`、`css/grid.css`、`tests/grid.test.js` | 默认列、列宽、表格行渲染、列显隐 |
| `wt/w1-timeline` | `feat/w1-timeline` | `js/timeline-pane.js`、`css/timeline.css`、`tests/timeline.test.js` | 把甘特图改为消费行模型、汇总条、表头同步 |
| `wt/w1-workbench` | `feat/w1-workbench` | `js/workbench.js`、`css/layout.css`、`index.html` 挂载结构 | 双面板、滚动同步、分割条、选中与 hover |
| `wt/w1-tests` | `feat/w1-tests` | `tests/fixtures/**`、`tests/helpers/**`、`tests/smoke.test.js` | 三层任务 fixtures、200 行数据、滚动同步检查脚本 |

合并顺序：

1. `feat/w1-workbench` 提供 DOM 骨架和接口桩。
2. `feat/w1-grid` 接入行渲染。
3. `feat/w1-timeline` 接入时间轴。
4. `feat/w1-tests` 最后补齐回归。

### Wave 2：计划能力，四个 worktree 并行

| Worktree | 分支 | 独占文件 | 任务 |
|----------|------|---------|------|
| `wt/w2-links` | `feat/w2-links` | `js/links.js`、`js/arrows.js`、`css/links.css` | 依赖 links、FS 箭头、环路检测 |
| `wt/w2-progress` | `feat/w2-progress` | `js/progress.js`、`tests/progress.test.js` | 百分比输入、父级工期加权汇总 |
| `wt/w2-views` | `feat/w2-views` | `js/views.js`、`css/views.css` | 筛选、排序、分组、保存视图 |
| `wt/w2-export` | `feat/w2-export` | `js/export.js`、`tests/export.test.js` | 按当前视图导出 Excel |

键盘、多选、批量操作依赖 GridPane，放到 Wave 2 后半段或单独 worktree。

### Wave 3：高级能力，按需并行

| Worktree | 分支 | 独占文件 | 任务 |
|----------|------|---------|------|
| `wt/w3-baseline` | `feat/w3-baseline` | `js/baseline.js` | 基线快照、计划与实际双条 |
| `wt/w3-calendar` | `feat/w3-calendar` | `js/work-calendar.js`、`js/scheduler.js` | 工作日历、节假日、自动排期 |
| `wt/w3-critical-path` | `feat/w3-critical-path` | `js/critical-path.js` | 关键路径 |
| `wt/w3-collab` | `feat/w3-collab` | `js/collab.js`、`js/attachments.js` | 评论、活动日志、附件 |
| `wt/w3-resources` | `feat/w3-resources` | `js/resources.js` | 资源与工作量 |

评论、附件、权限和实时协同引入后端后再独立成阶段。

## 6. Agent 任务模板

每个 agent 的 brief 必须包含：

```text
仓库：/path/to/worktree
分支：feat/w1-grid
只允许修改：js/grid-pane.js、css/grid.css、tests/grid.test.js
禁止修改：index.html、js/row-model.js、js/workbench.js、其他 worktree 文件

必读：
- docs/design/01-workbench-split.md
- docs/design/02-parallel-development.md
- task_plan.md
- findings.md

接口契约：
- RowModel.build(options) 返回 rows 和 byId
- 每行必须有 id、task、depth、hasChildren、isCollapsed、isSummary
- 固定行高 40px，表头 64px

验收：
- node --check 通过
- 对应 node 测试通过
- 不修改其他模块文件
- 提交前报告 git status

提交信息：
feat(grid): <summary>
```

## 7. 合并与评审

- 每个 worktree 完成后提交到自己的分支，不开 PR，先本地合并到 `feat/workbench-integration`。
- 合并顺序按依赖，不按完成时间。
- 每个分支合并前跑：
  - `node --check` 对应脚本
  - `node tests/row-model.test.js`
  - `node tests/smoke.test.js`
  - 手动打开 `index.html` 检查控制台
- 冲突处理原则：文件所有权优先，跨文件接口变更必须回到 Wave 0 或单独开接口变更任务。
- 每个合并节点由另一个 agent 做一次 code review，重点看接口越界和回归。

## 8. 风险控制

| 风险 | 控制 |
|------|------|
| worktree 丢失未提交改动 | 先检查点提交 |
| 多 agent 改同一文件 | 文件所有权矩阵，禁止跨文件修改 |
| 拆分后行为回归 | Wave 0 逐项回归，保留旧代码开关 |
| 滚动同步抖动 | 固定行高、同步锁、requestAnimationFrame |
| 无 CI | 每个 worktree 自带 node 测试和手动检查清单 |
| 并行时间过长 | 每波结束合并一次，不跨波堆积 |
| 模型或 provider 不可用 | 启动前先查 orchestrator capabilities，不临时切换 |

## 9. 立即执行顺序

1. 获得检查点提交许可。
2. 在 `feat/w0-foundation` 完成拆分、v3 迁移、RowModel 和测试。
3. 合并 Wave 0 到 `feat/workbench-integration`。
4. 从 Wave 0 的最新提交创建四个 Wave 1 worktree。
5. 按文件所有权并行开发，按合并顺序收口。
6. Wave 1 验收后进入 Wave 2。

## 10. 不建议的做法

- 不先提交就直接建 worktree，当前改动会全部丢失。
- 让多个 agent 同时编辑 `index.html`。
- 一开始就建二十多个 worktree，依赖没解除，合并成本高于收益。
- 在 worktree 里再改接口定义，导致其他分支全部返工。
