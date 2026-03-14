# PMWEB - 项目管理工具

一个轻量级的单页面项目管理应用，支持任务树管理和甘特图可视化。

## 功能特性

### 任务管理
- **多层级任务树** - 支持最多 3 层任务嵌套
- **拖拽排序** - 通过拖拽调整任务顺序和层级
- **状态管理** - 待办、进行中、已完成、已暂停
- **右键菜单** - 快速添加、编辑、删除任务

### 甘特图
- **时间轴视图** - 支持日/周/月/年四种粒度切换
- **任务拖拽** - 拖拽调整任务开始/结束日期
- **里程碑标记** - 在时间轴上标记关键节点
- **对齐线** - 拖拽时显示对齐辅助线

### 数据导入导出
- **JSON 导出/导入** - 完整数据备份与恢复
- **Excel 导出** - 导出任务列表为 Excel 文件

### 界面
- **可调整侧边栏** - 拖拽调整宽度 (180px - 500px)
- **响应式设计** - 适配不同屏幕尺寸

## 技术栈

- Vanilla JavaScript (无框架依赖)
- CSS 自定义变量主题
- SheetJS (Excel 导出)
- LocalStorage 数据持久化

## 快速开始

直接在浏览器中打开 `index.html` 即可使用：

```bash
# 克隆仓库
git clone https://github.com/mh567/PMWEB.git

# 打开应用
open index.html
```

或使用任意 HTTP 服务器：

```bash
python -m http.server 8000
# 访问 http://localhost:8000
```

## 数据存储

数据自动保存在浏览器的 LocalStorage 中，无需服务器。

## 文件结构

```
PMWEB/
├── index.html        # 主应用文件 (单页面应用)
├── xlsx.full.min.js  # Excel 导出库
└── .gitignore
```

## 许可证

MIT License
