# PMWEB 轻量多项目与单文件交付最终验收报告 (A01 - A18)

## 验收结论概览

PMWEB 轻量多项目版本（v4）已通过全部 A01 至 A18 项的真实浏览器自动化与全量回归验收。所有 18 项核心验收指标均已在隔离真实浏览器环境中实测通过，无未验证项，无阻断缺陷。全量回归单测 53 个套件全部通过（100% 通过率）。

* **单文件交付产物**：`dist/index.html`（大小 1.81 MB，SHA-256: `4993909142c190ddfb72ed942d8031bdfbe8b1733566b15f93c038a01b7fc665`）
* **验收执行浏览器**：`ego-browser 0.6.2.9`（基于 Chromium 156 内核，配合独立 Profile 2 数据沙箱）
* **隔离测试环境**：
  * **环境 1（源环境）**：`file:///<项目根>/dist/index.html`（以本机检出路径替换 `<项目根>`）
  * **环境 2（独立目标 Origin）**：`http://127.0.0.1:8765/index.html`（具备独立的 LocalStorage 与 IndexedDB 存储域）

---

## A01 - A18 逐项验收实测清单

### A01: 项目数据完全隔离
* **状态**：Passed
* **浏览器真实操作**：
  1. 在项目 A（敏捷研发项目）中新增任务、配置专属自定义列「预估工时」、添加专属评论。
  2. 切换至项目 B（市场推广项目），核验项目 A 任务数、专属列及评论在项目 B 中完全不存在。
  3. 在项目 B 新增其专属任务与自定义列「投放渠道」。
  4. 切回项目 A，核验项目 A 专属数据完整无损，无任何项目 B 数据泄露或交叉污染。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A01_project_isolation`)
  * 截图证据：`browser-evidence/screenshots/a01-project-a.png`, `browser-evidence/screenshots/a01-project-b.png`
* **Node 与浏览器界限**：Node 单元测试基于内存模拟验证数据结构隔离；浏览器实测基于完整 DOM 渲染、UI 切换与事件总线验证实际视觉与数据隔离。
* **残留风险**：无。

### A02: 启动偏好模式（choose / last / fixed）与回退保护
* **状态**：Passed
* **浏览器真实操作**：
  1. 配置启动模式为 `last`，激活项目 B 后刷新页面，应用自动恢复激活项目 B。
  2. 配置启动模式为 `fixed` 指向项目 A，激活项目 B 后刷新页面，应用严格依据固定配置激活项目 A。
  3. 将项目 A 标记归档后刷新页面，固定目标失效，系统安全回退至项目选择界面（choose 模式），未发生白屏。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A02_startup_modes`)
* **Node 与浏览器界限**：Node 测试验证 `resolveStartup` 纯函数；浏览器实测涵盖真实页面 `page.reload()` 完整生命周期及持久化读取。
* **残留风险**：无。

### A03: 项目完工归档与只读保护
* **状态**：Passed
* **浏览器真实操作**：
  1. 将项目标记为完工状态（status='done'），任务数据保持完整可查。
  2. 将项目归档，项目自动从活跃项目下拉列表中退出。
  3. 在归档状态下尝试添加任务，系统抛出只读保护异常并安全拦截。
  4. 执行取消归档并重新激活，所有任务与历史完整还原。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A03_project_archive`)
  * 截图证据：`browser-evidence/screenshots/a03-archive-restore.png`
* **Node 与浏览器界限**：Node 测试验证底层 `assertWritable` 模型断言；浏览器实测验证 UI 层归档只读与恢复全流程。
* **残留风险**：无。

### A04: 列设置工具栏直达、显隐控制、改名、自定义四类型与拖拽/键盘排序
* **状态**：Passed
* **浏览器真实操作**：
  1. 点击顶部工具栏「列设置」按钮，弹出浮动列配置面板（修复了工具栏点击事件冒泡导致的自动关闭缺陷）。
  2. 修改内置列名称（将「负责人」重命名为「执行负责人」）。
  3. 新增四种类型的自定义列：文本（业务备注）、数值（难度指数）、日期（终审日期）、单选下拉（优先级评级）。
  4. 使用 Alt+Arrow 键盘快捷键及拖拽手势调整列顺序。
  5. 隐藏除名称外的全部列，验证空状态提示正常呈现；重新恢复全部列显示。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A04_column_config`), `drag-reorder-results.json`
  * 截图证据：`browser-evidence/screenshots/a04-column-modal.png`, `browser-evidence/screenshots/a04-column-drag-keyboard.png`
* **Node 与浏览器界限**：Node 验证 `ColumnConfig` 纯函数逻辑；浏览器实测验证真实 DOM 事件触发、面板焦点控制与表格重绘。
* **残留风险**：无。

### A05: 自定义列类型校验与单选选项删除保护
* **状态**：Passed
* **浏览器真实操作**：
  1. 为任务写入四种自定义列数据（文本、数值、合法日期字符串、已定义单选选项键值），校验全部合规通过。
  2. 尝试从单选列定义中删除已被任务引用的选项（`opt-p0`），`ColumnConfig.validateDraft` 准确识别正在使用的引用并阻断保存。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A05_custom_fields`)
* **Node 与浏览器界限**：Node 验证选项引用的深度校验规则；浏览器实测确保前端草稿验证与保存流程协同一致。
* **残留风险**：无。

### A06: 任务拖拽层级与顺序调整
* **状态**：Passed
* **浏览器真实操作**：
  1. 构造多任务列表，通过 `TaskManager.moveTask` 与拖拽事件调整任务顺序（将末尾任务移至首位）。
  2. 将同级任务拖拽调整为指定任务的子任务，层级结构与兄弟顺序即时更新。
  3. 验证树形视图与表格数据同步重绘。
* **实测证据**：
  * 数据记录：`browser-evidence/data/drag-reorder-results.json` (`A06_task_drag_reorder`)
  * 截图证据：`browser-evidence/screenshots/a06-task-drag-reorder.png`
* **Node 与浏览器界限**：Node 测试验证任务树拓扑排序与环路防护；浏览器实测结合真实 DOM 树节点位置与渲染呈现进行验证。
* **残留风险**：无。

### A07: 甘特图缩放保持日期中心与表格时间轴垂直滚动同步
* **状态**：Passed
* **浏览器真实操作**：
  1. 在甘特图视图下依次切换日/周/月/年时间粒度，任务开始与结束日期元数据严格保持不变。
  2. 对任务表格滚动容器注入垂直滚动位移（scrollTop = 50px），时间轴容器通过 scroll 联动精准同步至相同偏移量（偏差 <= 2px）。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A07_gantt_zoom_scroll`)
  * 截图证据：`browser-evidence/screenshots/a07-gantt-view.png`
* **Node 与浏览器界限**：Node 无法感知真实像素滚动与 CSS 布局；本项依赖浏览器原生布局引擎和滚动事件监听器真实闭环。
* **残留风险**：无。

### A08: 今日关键节点（里程碑）展示与完成状态切换
* **状态**：Passed
* **浏览器真实操作**：
  1. 为当前任务创建日期为当天的里程碑节点。
  2. 调用 `App.renderAll()`，检查侧边栏 `#todos-list` 正确渲染出该里程碑条目。
  3. 点击条目切换其状态，里程碑状态在数据模型与 DOM 标记中同步更新为已完成（done）。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A08_today_milestones`)
  * 截图证据：`browser-evidence/screenshots/a08-today-milestones.png`
* **Node 与浏览器界限**：Node 仅测试日期匹配过滤；浏览器实测验证跨组件事件委托、图标变换与列表重绘。
* **残留风险**：无。

### A09 & A10: 四种任务状态与相对到期快速筛选
* **状态**：Passed
* **浏览器真实操作**：
  1. 构造未开始（todo）、进行中（inProgress）、第三方（thirdParty）、已完成（done）四类任务，分别赋予过期、今日到期、未来7天到期等边界日期。
  2. 通过 `Views.filterRows` 与工具栏快速筛选器，逐一验证状态筛选（未开始/进行中/第三方/已完成）与到期筛选（已过期/今天到期/未来7天）的行过滤准确性。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A09_A10_status_and_filters`)
  * 截图证据：`browser-evidence/screenshots/a09-quick-filters.png`
* **Node 与浏览器界限**：Node 测试覆盖各条件排列组合；浏览器实测确保真实 RowModel 行投影与视图状态无缝衔接。
* **残留风险**：无。

### A11: 法定节假日网络订阅与本地离线回退
* **状态**：Passed
* **浏览器真实操作**：
  1. 在真实 `file://` 环境下触发 `HolidaySource.refresh('2026', { force: true })`，成功从公开源拉取 2026 年度法定节假日与调休补班数据（涵盖元旦、春节、清明、劳动节、端午、中秋、国庆全套法定日期）。
  2. 取消订阅后，系统自动停止向外发起网络请求。
  3. 离线状态下调用 `HolidaySource.resolveDate`，内置基础规则与本地缓存规则继续发挥作用。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A11_holiday_file_fetch`)
* **Node 与浏览器界限**：Node 环境无法完全模拟浏览器文件协议对网络请求的 CORS/安全策略；本测试在浏览器原生 `file://` 下实际发起并捕获真实网络响应。
* **残留风险**：无。

### A12 & A13: 持久回收站与删除保护闭环
* **状态**：Passed
* **浏览器真实操作**：
  1. 删除任务及关联评论，数据移入 `Workspace.data.recycleBin`。
  2. 刷新页面（`page.reload`），回收站批次数据跨会话完整持久保留。
  3. 执行回收站还原操作，任务及其关联字段在活动工作区中完整复原。
  4. 新增临时任务并删除，在回收站中执行永久删除（purge），批次从回收站彻底清除。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A12_A13_recycle_bin`)
* **Node 与浏览器界限**：Node 单元测试验证数据模型纯函数；浏览器实测验证整页刷新后的真实 LocalStorage 反序列化与 DOM 交互。
* **残留风险**：无。

### A14: 双隔离环境完整备份、跨域导入与附件逐 Byte 比对
* **状态**：Passed
* **浏览器真实操作**：
  1. **环境 1（file://）**：创建生产项目与支撑项目，为任务关联自定义列与真实二进制附件 `[0, 1, 127, 128, 255]`，归档支撑项目，删除废弃任务入回收站。
  2. 通过真实应用链导出全量备份 JSON（5 字节附件被标准 Base64 编码内嵌）。
  3. **环境 2（http://127.0.0.1:8765）**：启动干净的独立静态 HTTP 服务器提供全新 Origin，确保初始 LocalStorage 与 IndexedDB 为空。
  4. 在环境 2 执行全量工作区导入（`Backup.importPackage`），刷新页面验证两个项目、归档状态、回收站批次及自定义列全部持久还原。
  5. 从环境 2 IndexedDB 读出附件二进制实体，逐 Byte 比较（5 个字节完全匹配）并计算 SHA-256（`0150a92bb1212cd00516b65fde0704614760000963874fcbb11eaa734ee87809`），与预期哈希 100% 一致。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite3-backup-results.json` (`A14_backup_restore_and_dual_env`)
  * 附件产物：`browser-evidence/downloads/full-backup-source.json`, `browser-evidence/downloads/downloaded-evidence.bin`
  * 截图证据：`browser-evidence/screenshots/a14-env1-source-ready.png`, `browser-evidence/screenshots/a14-env2-imported.png`, `browser-evidence/screenshots/a14-env2-reloaded.png`
* **Node 与浏览器界限**：Node 环境缺乏真实浏览器 IndexedDB 实现；本项测试在真实 Chromium 原生 IndexedDB 数据库中真实写入、导出 Base64、在新域读出还原，实现全链路闭环。
* **残留风险**：无。

### A15: 异常防护、引用安全与故障兜底
* **状态**：Passed
* **浏览器真实操作**：
  1. 共享引用保护：创建新任务引用同一附件 BlobKey，彻底删除原任务并清理回收站批次，系统识别出活跃引用，严禁物理删除底层 Blob；待引用完全归零后才执行物理清理。
  2. 超前版本阻断：构造 `backupVersion: 999` 的备份包执行导入，系统在内存校验阶段阻断，未向存储写入任何数据，原工作区完好无损。
  3. 悬空引用防御：构造包含非法未声明 BlobKey 的备份包，系统严格校验不通过并中止写入。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite3-backup-results.json` (`blob_reference_protection`, `A15_edge_case_defense`)
* **Node 与浏览器界限说明**：真实物理磁盘耗尽等破坏性系统故障由 Node 单元测试通过打桩方式覆盖（`tests/backup.test.js`）；真实浏览器环境重点验证了业务层校验防御、超前版本阻断及引用计数保护。
* **残留风险**：无。

### A16: 历史单项目数据（v1 / v2 / v3）平滑迁移
* **状态**：Passed
* **浏览器真实操作**：
  1. 构造 v3 历史单项目数据结构，通过 `DataStore.migrate` 进行运行时升级。
  2. 输出数据自动升级至 `pmweb_version: 4` 工作区格式，原任务、列与元数据被安全包装并迁移至默认项目中，无任何数据丢失。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A16_legacy_migration`)
* **Node 与浏览器界限**：Node 负责算法级字段转换；浏览器实测验证迁移后的数据在整套前端应用中的挂载与展现兼容性。
* **残留风险**：无。

### A17: 高阶入口收敛、离线完整性与撤销重做
* **状态**：Passed
* **浏览器真实操作**：
  1. 界面元素核验：确认页面上已彻底移除旧版本遗留的同步（Sync）、云端（Cloud）、分享（Share）等外链按钮，所有数据管理入口统一收敛至本地工作区与项目管理菜单。
  2. 离线完整性：通过 `App.undo()` 与 `App.redo()` 执行任务操作的连续撤销与重做，任务列表状态精准回退与前移。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite2-functional-results.json` (`A17_convergence_and_delivery`)
* **Node 与浏览器界限**：Node 测试验证历史栈深度限制；浏览器实测结合工具栏按钮禁用态与快捷键完成用户操作链路验证。
* **残留风险**：无。

### A18: 响应式视口断点、搜索框计算样式与四种主视图开关组合
* **状态**：Passed
* **浏览器真实操作**：
  1. **响应式断点与 computedStyle 测量**：
     * **1280px 桌面视口**：搜索框宽度计算样式为 `152px`，`flex-grow: 0`，主要入口全部可见，今日节点正常停靠在右侧。
     * **728px 平板视口**：搜索框宽度计算样式为 `152px`，`flex-grow: 0`，今日节点自适应下沉到底部。
     * **390px 移动视口**：搜索框宽度计算样式为 `132px`，`flex-grow: 0`，主要入口紧凑排列无水平遮挡。
  2. **四种视图开关组合**：
     * 组合 1（仅甘特图）：表格 320px，时间轴 712px，日历隐藏。
     * 组合 2（仅日历）：表格 320px，月历 712px，时间轴隐藏。
     * 组合 3（两者双开）：甘特图与日历上下双开并存（各 317px 高）。
     * 组合 4（两者全关）：任务表格横向铺满全部可用宽度（1040px）。
  3. **菜单交互**：点击菜单正常展开，按 Esc 键安全关闭，点击外部区域安全关闭。
* **实测证据**：
  * 数据记录：`browser-evidence/data/suite1-layout-results.json`
  * 截图证据：`browser-evidence/screenshots/viewport-desktop-1280.png`, `browser-evidence/screenshots/viewport-tablet-728.png`, `browser-evidence/screenshots/viewport-mobile-390.png`, `browser-evidence/screenshots/combo1-gantt-only.png`, `browser-evidence/screenshots/combo2-calendar-only.png`, `browser-evidence/screenshots/combo3-dual-open.png`, `browser-evidence/screenshots/combo4-full-closed-table-expand.png`, `browser-evidence/screenshots/menu-open.png`
* **Node 与浏览器界限**：Node 无渲染树与盒模型，无法测量真实 CSS 样式计算值；本项测试完全由浏览器排版引擎直接测量输出。
* **残留风险**：无。

---

## 遗留项审定与核验说明

### 1. 保守子实体 ID 重配审定（TASK7-MINR02）
* **审定结论**：**明确接受，保留当前设计**。
* **审定细节**：在项目复制或数据恢复时，子实体（如子任务、评论、里程碑）被分配新的 UUID，属于防御性碰撞隔离设计。经核实，前端用户的业务引用、树形父子层级关系以及依赖链在重配过程中均由映射表同步更新，不影响任何用户维度的外部引用或业务检索，因此该机制安全有效。

### 2. 搜索框 computedStyle 实测核验（TASK9-MINR02）
* **核验结论**：**真实核验通过，指标完全达标**。
* **核验数据**：在 Suite 1 中对搜索输入框的计算样式进行了精确测量：
  * 移动视口（390px）：宽度 computedStyle 严格为 `132px`，flexGrow 为 `0`。
  * 平板视口（728px）：宽度 computedStyle 严格为 `152px`，flexGrow 为 `0`。
  * 桌面视口（1280px）：宽度 computedStyle 严格为 `152px`，flexGrow 为 `0`。
  三类视口下均无横向撑开或布局变形，符合视觉标准。

---

## 交付文件清单

1. 单文件交付应用：`L/task-10/delivery/index.html`（与源码构建产物逐字节完全一致）
2. 网站图标：`L/task-10/delivery/favicon.svg`
3. 使用指南说明：`L/task-10/delivery/README.md`
4. 校验清单：`L/task-10/delivery/sha256.txt`
5. 最终源码快照：`L/task-10/result-source/`（附 `result-source-manifest.sha256`）
6. 相对基线差异补丁：`L/task-10/diff.patch`
7. 变更清单说明：`L/task-10/change-manifest.json`
8. 浏览器证据集：`L/task-10/browser-evidence/`（包含全套截图、下载附件与结构化测量数据）
