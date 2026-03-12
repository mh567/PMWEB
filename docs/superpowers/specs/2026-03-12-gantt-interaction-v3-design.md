# Gantt 交互改进设计规格

## 概述

对 PMWEB 甘特图的三项交互改进：右键菜单添加里程碑、拖拽视觉跟随、整体交互优化。基于现有架构最小化改动（方案 A：轻量增强）。

## 约束

- 单文件 HTML 应用，vanilla JS，零依赖
- 兼容 XinChuang Linux 浏览器（Chromium 86+）
- 不改变现有数据流和架构

---

## 1. 右键菜单添加里程碑

在甘特图任务条上右键，弹出上下文菜单，包含「添加里程碑」选项。

### 行为

- 任务条绑定 `contextmenu` 事件，`preventDefault()` 阻止浏览器默认菜单
- 菜单样式复用现有里程碑右键菜单的 CSS（`.context-menu`）
- 根据鼠标点击的 X 坐标反算日期，作为里程碑默认日期预填
- 点击菜单项后调用现有的里程碑添加流程（ModalManager 弹窗输入名称 + 日期）
- 点击其他区域或按 Esc 关闭菜单
- 菜单定位：出现在鼠标位置，边界检测防止溢出视口

### 不做

- 空白区域右键不弹菜单
- 不在菜单中添加其他操作项（仅「添加里程碑」）

---

## 2. 拖拽视觉跟随

任务条和里程碑在拖拽时，半透明克隆元素（ghost）跟随鼠标移动。

### 任务条拖拽

- mousedown 时克隆任务条元素，设置 `opacity: 0.6`，`position: fixed`，`pointer-events: none`，`z-index: 9999`
- mousemove 时更新 ghost 的 `left/top` 为鼠标坐标（减去初始偏移量，让抓取点不跳变）
- 原始任务条保持原位但降低透明度（`opacity: 0.3`），暗示"从这里拖走"
- 水平拖拽时在甘特图上显示日期吸附指示线（竖线），提示目标日期
- 垂直拖拽（行合并模式）时，ghost 跟随鼠标纵向移动，目标行高亮
- mouseup 时移除 ghost，恢复原始元素透明度，执行数据更新并重绘

### 里程碑拖拽

- 创建 ghost（菱形标记 + 名称），跟随鼠标水平移动
- 限制只能水平移动（里程碑不换行），ghost 的 `top` 保持不变
- 显示日期吸附指示线

### 通用处理

- ghost 元素 append 到 `document.body`，避免被容器 `overflow: hidden` 裁剪
- mouseup 或鼠标离开窗口时清理 ghost
- 拖拽期间 `cursor: grabbing`

---

## 3. 交互优化

### Cursor 状态

- 任务条和里程碑默认 `cursor: grab`，拖拽中切换为 `cursor: grabbing`
- 任务条右边缘（最后 4px）显示 `cursor: col-resize`（保留未来扩展）

### Hover 反馈

- 用 CSS `:hover` 替代 JS mouseenter/mouseleave 做高亮，减少事件开销
- 任务条 hover 时轻微上浮（`transform: translateY(-1px)`）+ 阴影加深
- 里程碑 hover 时放大（`transform: scale(1.2)`）

### 点击区域

- 里程碑添加透明 padding 区域扩大点击热区到 20x20px（视觉不变）
- 任务条最小宽度保证 20px

### 拖拽阈值

- mousedown 后移动超过 4px 才进入拖拽模式，避免误触
- 4px 内的移动视为点击，触发选中

### 右键菜单统一

- 里程碑的现有右键菜单保留「编辑」和「删除」项
- 菜单出现时其他交互暂停，菜单关闭后恢复
