# P1-5 撤销重做核心设计

## 结论

P1-5 新增纯内存命令栈 `History`，提供 `create`、`execute`、`undo`、`redo`、`canUndo`、`canRedo`、`size`、`clear`。栈本身不读写任务数据、localStorage 和 DOM，所有数据修改由命令的 `redo` 和 `undo` 回调完成。本阶段只交付模块、设计文档和 Node 测试，UI 接入放在后续阶段。

## 1. 目标

- 提供可复用的撤销重做命令栈，任务、里程碑、批量操作和拖拽共用一套。
- 命令结构与现有 `TaskManager` 解耦，接入时不需要修改栈的实现。
- 栈行为可预测：后进先出、新命令清空 redo、超限淘汰最旧命令。
- 异常安全：命令抛错时栈保持不变。
- 纯内存实现，浏览器直接双击 `index.html` 也能加载，不依赖构建步骤。

## 2. 非目标

- 不实现工具栏撤销重做按钮和 `Ctrl+Z` 快捷键。
- 不做历史持久化，刷新页面后历史清空。
- 不修改 `TaskManager`、`app.js`、`index.html` 和现有渲染代码。
- 不实现协同编辑、操作合并或冲突处理。

## 3. 命令结构

```js
Command = {
  label: string,
  undo: function(): void,
  redo: function(): void
}
```

- `label` 只用于菜单文案、状态栏提示和调试输出。
- `redo` 把数据从执行前状态带到执行后状态，`undo` 反向恢复。
- 命令内部保存执行前的快照，因此可以在任意时刻重复调用。
- 命令不得访问 DOM，也不得自行调用 `History`。渲染由接入层在命令执行后统一触发。
- 命令必须成对可用：只调用 `undo` 而不先 `redo` 时，结果应等价于回退到执行前状态。

## 4. 栈语义

| 方法 | 行为 | 返回值 |
|------|------|--------|
| `create(limit)` | 创建独立栈，`limit` 为撤销栈上限 | 栈对象 |
| `execute(command)` | 先调用 `command.redo()`，成功后压入撤销栈并清空重做栈 | 成功时返回 `command` |
| `undo()` | 取出撤销栈栈顶命令，调用 `command.undo()`，成功后移入重做栈 | 成功时返回 `command`，空栈返回 `null` |
| `redo()` | 取出重做栈栈顶命令，调用 `command.redo()`，成功后移回撤销栈 | 成功时返回 `command`，空栈返回 `null` |
| `canUndo()` | 撤销栈是否非空 | `boolean` |
| `canRedo()` | 重做栈是否非空 | `boolean` |
| `size()` | 撤销栈中的命令数量 | `number` |
| `clear()` | 清空两个栈 | `undefined` |

```text
execute(c):  c.redo() -> undoStack.push(c) -> redoStack = []
undo():      c = undoStack.top -> c.undo() -> undoStack.pop() -> redoStack.push(c)
redo():      c = redoStack.top -> c.redo() -> redoStack.pop() -> undoStack.push(c)
```

要点：

- `execute` 内先执行 `redo`，调用方不要再手动应用一次修改。
- 新命令只有在执行成功后才清空重做栈。执行失败时重做栈保留，用户可以继续重做旧操作。
- 撤销和重做都从栈顶取命令，符合后进先出。
- 每个栈实例相互独立，任务视图和时间轴如果各自需要历史，应各自 `create`，不要共享模块级单例。

使用示例：

```js
var history = History.create();

history.execute({
  label: '重命名任务',
  undo: function() { TaskManager.updateTask(taskId, { name: before }); },
  redo: function() { TaskManager.updateTask(taskId, { name: after }); }
});
```

## 5. 栈上限

- 默认上限 100，由 `History.DEFAULT_LIMIT` 暴露。
- `create(limit)` 可以覆盖，`limit` 必须是正整数。
- 非法值（`0`、负数、小数、`NaN`、`Infinity`、字符串、`null`、`undefined`）回退到默认值 100。
- 上限只约束撤销栈。执行成功后如果长度超过上限，从数组头部丢弃最旧命令。
- 被丢弃的命令不能再撤销，也无法通过重做恢复。
- 重做操作把命令移回撤销栈时同样执行上限检查，正常情况下不会触发，因为两边总量不超过上限。
- 大批量命令只占一个槽位，上限不会把同一次批量操作拆开。
- 内存估算：每条命令持有自己的快照。任务字段编辑只存变更字段，删除和批量操作持有完整快照，接入时需要按 100 条上限评估最坏情况。

## 6. 异常处理

| 场景 | 行为 |
|------|------|
| 命令缺少 `undo` 或 `redo` | `execute` 抛 `TypeError`，两个栈都不变 |
| `execute` 中 `redo` 抛错 | 不压栈、不清空重做栈，异常向上抛 |
| `undo` 中命令抛错 | 命令保留在撤销栈栈顶，重做栈不变 |
| `redo` 中命令抛错 | 命令保留在重做栈栈顶，撤销栈不变 |
| 空栈调用 `undo` 或 `redo` | 返回 `null`，不抛错 |
| `clear` | 无条件清空，不抛错 |

约束：

- `History` 不捕获和吞掉异常，由调用方决定如何提示用户。
- 命令自身保证原子性。先校验再写入，能在失败前拦截的错误不要写一半。
- 如果写入阶段可能中途失败，命令在 `catch` 中回滚已写入的部分再把异常抛出，让栈保持原状。
- 校验类错误（层级超限、日期倒置、依赖冲突）建议在构造命令前处理，避免产生无效历史。

## 7. 任务操作接入点

| 操作 | 命令快照 | undo | redo |
|------|----------|------|------|
| 新增任务 | 完整任务对象，含 `id`、`parentId`、`order` | 删除该任务 | 按原 `id` 和 `order` 重新插入 |
| 字段编辑 | 任务 id、变更字段的旧值和新值 | 写回旧值 | 写回新值 |
| 修改状态、负责人、进度、日期 | 同上，多字段合并为一条命令 | 写回旧值 | 写回新值 |
| 删除任务 | 任务本身、全部后代、相关里程碑和依赖 | 恢复整棵子树和关联数据 | 再次删除 |
| 移动任务 | `taskId`、旧 `parentId`、旧 `order`、新 `parentId`、新 `order` | 移回原位 | 移动到新位置 |
| 批量编辑 | 若干 `{ taskId, before, after }` | 逐条写回旧值 | 逐条写回新值 |

注意事项：

- `TaskManager.updateTask` 已经支持字段写入，字段编辑和状态修改可以直接使用。
- `TaskManager.addTask` 会生成新 `id`，撤销新增任务后重做需要恢复原 `id`。接入时给 `TaskManager` 补充按快照插入的接口。
- `TaskManager.deleteTask` 会级联删除后代、里程碑和依赖，命令必须在删除前采集完整快照，撤销时整棵恢复。现有 API 没有恢复接口，接入时需要补充 `restoreSubtree` 一类的接口。
- `TaskManager.moveTask` 会重排兄弟 `order`。连续撤销多次移动时，仅恢复单个任务的 `parentId` 和 `order` 可能不够，接入时按快照恢复整个兄弟列表，或把一次移动和兄弟重排合并进一条批量命令。
- 一次表单保存如果改了多个字段，合并为一条命令，避免一次保存产生多条历史。

## 8. 里程碑接入点

| 操作 | 命令快照 | undo | redo |
|------|----------|------|------|
| 新增里程碑 | 完整里程碑对象，含 `id` | 按 `id` 删除 | 按 `id` 重新插入 |
| 编辑里程碑 | `id` 和变更字段的旧值、新值 | 写回旧值 | 写回新值 |
| 删除里程碑 | `{ id, taskId, name, date, status }` | 按原 `id` 恢复 | 再次删除 |

- 里程碑和任务共用同一个栈，任务删除引起的里程碑级联删除可以和任务删除一起撤销。
- `TaskManager.addMilestone` 会生成新 `id` 并校验日期范围，撤销删除时不能复用它。接入时需要按快照插入的接口。
- 里程碑日期受任务日期范围约束。命令执行前先校验，避免撤销和重做时出现超出范围的数据。

## 9. 批量操作接入点

```js
var command = {
  label: '批量设置负责人',
  undo: function() {
    items.forEach(function(item) {
      TaskManager.updateTask(item.taskId, { assignee: item.before });
    });
  },
  redo: function() {
    items.forEach(function(item) {
      TaskManager.updateTask(item.taskId, { assignee: item.after });
    });
  }
};

items = [{ taskId: 't1', before: '张三', after: '李四' }];
```

- 批量编辑合并为一条命令，一次撤销恢复全部条目。
- 执行前统一校验全部条目，任何一条非法就整批不执行，避免半成功状态。
- 批量删除任务用一条命令，内部按子树快照恢复。
- 批量命令内部不调用 `History.execute`，只做数据写入，避免嵌套历史。

## 10. 拖拽接入点

- `pointerdown` 记录拖动前的日期和位置，用于生成快照。
- `pointermove` 只更新预览样式，不写 `TaskManager`，不调用 `History.execute`，避免每一帧产生命令。
- `pointerup` 计算最终日期，与起始值比较。没有变化时不生成命令。
- 校验失败（结束早于开始、层级超限、依赖冲突）时丢弃命令，数据和界面保持原状。
- 生成一条日期变更命令交给 `History.execute`，由 `redo` 完成写入。
- 取消拖拽（`Escape`、`pointercancel`）时恢复预览，不产生命令。
- 拖拽期间暂停 hover 同步，沿用 `01-workbench-split.md` 的约定。

```js
function commitBarDrag(taskId, before, after) {
  if (before.startDate === after.startDate && before.endDate === after.endDate) {
    return null;
  }
  return History.execute({
    label: '调整任务日期',
    undo: function() { TaskManager.updateTask(taskId, before); },
    redo: function() { TaskManager.updateTask(taskId, after); }
  });
}
```

拖拽场景的 UI 接入在后续阶段实现，本阶段只约定命令形态。

## 11. 与渲染和持久化的关系

- 命令内的写入统一走 `TaskManager`，接入层在命令执行后调用 `Workbench.render()` 重绘。
- `History` 不负责保存数据，`TaskManager._save` 仍然负责写入 localStorage。
- 历史本身不持久化。刷新页面后栈为空，这是本阶段的预期行为。
- 如果后续需要持久化，只保存命令类型和快照参数，启动时重建命令对象，不保存函数。
- 工具栏按钮状态由 `canUndo()` 和 `canRedo()` 驱动，不在模块内部维护 UI 状态。

## 12. 测试

`tests/history.test.js` 覆盖以下场景：

- `execute`、`undo`、`redo` 的调用顺序和返回值。
- 执行新命令清空重做栈。
- 默认上限 100、自定义上限淘汰最旧命令、非法上限回退。
- 空栈 `undo` 和 `redo` 返回 `null`。
- `execute`、`undo`、`redo` 中命令抛错时栈保持不变。
- `clear` 后 `canUndo()` 和 `canRedo()` 均为 `false`。
- 命令对象不被修改，两个栈实例互不影响。
- 在禁止访问 `localStorage`、`sessionStorage`、`document`、`window` 的沙箱中加载和执行不报错。

运行方式：

```bash
node --check js/history.js
node tests/history.test.js
node tests/run-all.js
```

## 13. 后续接入清单

- `TaskManager` 补充按快照恢复的接口：插入任务、插入里程碑、恢复子树。
- 工具栏增加撤销和重做按钮，状态由 `canUndo()` 和 `canRedo()` 驱动。
- 接入 `Ctrl+Z` 和 `Ctrl+Shift+Z`。
- 单元格编辑、删除确认、拖拽统一改为命令模式。
- 批量操作统一走批量命令，执行前做整批校验。
