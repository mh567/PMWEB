# G5 单文件构建方案

## 1. 结论

新增 `build.js`，零依赖，只用 Node 内置模块。执行 `node build.js` 读取仓库根目录的 `index.html`，把 8 个本地样式表和 32 个本地经典脚本内联，输出 `dist/index.html`，并复制 `favicon.svg`。产物保持 `file://` 双击可运行，不引入 ES module，不移除 `index.html` 的开发方式。

默认把 `xlsx.full.min.js` 一起内联，产物为单个 HTML。需要保留 vendor 外链时加 `--no-inline-vendor`，构建会把该文件复制到 `dist/`，产物仍是可运行目录。

## 2. 范围

本阶段包含：

- `build.js`：解析 `index.html`，内联本地样式与脚本，复制图标，输出体积和资源清单。
- `tests/build.test.js`：在临时目录构造最小工程，校验产物、顺序、vendor 开关和结束标签转义。
- `.gitignore` 追加 `dist/`。
- 本文档。

本阶段不包含：

- `index.html`、`js/**`、`css/**`、`server/**` 的任何修改。
- 压缩、混淆、Tree Shaking、Source Map。
- 引入 npm 依赖、打包器或 ES module 转换。
- 部署脚本和 CI 接入。

## 3. 构建前结构

```
PMWEB/
├── index.html             5.2 KB，引用 8 个 CSS 与 32 个 script
├── css/                   8 个文件，70.5 KB
├── js/                    31 个文件，468.8 KB
├── xlsx.full.min.js       922.4 KB
├── favicon.svg            574 B
├── build.js
└── tests/
```

`index.html` 的加载顺序固定：8 个 `<link rel="stylesheet">` 在 `<head>`，32 个 `<script src>` 在 `<body>` 末尾，其中 31 个来自 `js/`，1 个是 vendor。最后一个行内 script 注册 `DOMContentLoaded` 并调用 `App.init()`。所有脚本都是经典 script，共享顶层全局作用域，顺序即加载顺序。

本地开发时浏览器发起 42 个本地请求。每个文件独立解析，`file://` 与 HTTP 行为一致。

## 4. 构建命令与输出

```bash
node build.js                    # 默认内联 vendor，输出单文件
node build.js --no-inline-vendor # 保留 xlsx 外链，复制到 dist/
node build.js --help             # 查看用法
```

命令在仓库根目录执行，构建根目录取 `process.cwd()`。脚本先删除并重建 `dist/`，再写入产物，避免遗留上一次的复制文件。资源缺失、路径越出仓库根目录、未知参数都会以非零码退出并给出文件名。

输出示例，节选：

```
PMWEB build
  root   /path/to/PMWEB
  output /path/to/PMWEB/dist/index.html

资源
  内联  css/base.css            3.2 KB -> <style>
  ...
  内联  js/app.js               59.6 KB -> <script>
  内联  xlsx.full.min.js        922.4 KB -> <script> (vendor)
  复制  favicon.svg             574 B

汇总
  8 个样式，32 个脚本（其中 vendor 1 个），1 个复制资源
  index.html  5.2 KB -> 1.43 MB
  输出文件    /path/to/PMWEB/dist/index.html  1.43 MB
```

构建后结构：

```
dist/
├── index.html      1,501,132 B，包含全部样式与脚本
└── favicon.svg     574 B
```

`--no-inline-vendor` 时：

```
dist/
├── index.html          556,660 B
├── xlsx.full.min.js    944,491 B
└── favicon.svg         574 B
```

## 5. 内联实现

1. 用正则扫描 `<link>` 与 `<script>` 标签，按文档顺序替换，因此脚本执行顺序与 `index.html` 完全一致。
2. 只处理本地引用。带协议或 `//` 开头的外链原样保留，并在构建输出中列出。
3. 样式替换为 `<style>`，脚本替换为 `<script>`，去掉 `href` 与 `src`，保留原有缩进。
4. 每个文件单独一个 `<style>` 或 `<script>` 块，便于在产物里定位来源文件，也避免 CSS 级联边界变化。
5. `<link rel="icon">` 不改写，`favicon.svg` 复制到 `dist/`，相对路径继续有效。
6. 已经存在的行内 script 原样保留，`DOMContentLoaded` 入口不变。

### 5.1 结束标签转义

内联内容中的 `</script>` 与 `</style>` 会让 HTML 解析器提前闭合容器。构建时替换为 `<\/script>` 与 `<\/style>`：

- JS 中 `<\/script` 在字符串、模板字符串、正则和注释中的语义与 `</script` 相同。
- CSS 中 `<\/style` 只可能出现在字符串或注释中，语义不变。

当前仓库源码里没有这两个片段，vendor 的 4 处 `<!--` 全部位于正则字面量中，内联后行为不变。测试用 fixture 显式覆盖了两种转义和标签计数。

### 5.2 不做的事情

- 不合并多个 `<script>` 块，避免改变顶层绑定与执行边界。
- 不压缩 CSS 和 JS。压缩会引入额外工具链，收益主要在网络传输，单文件场景下 HTTP gzip 已能覆盖。
- 不重写相对资源路径。当前 CSS 没有 `url()` 与 `@import`，需要时再补。

## 6. 内联 vendor 的取舍

| 维度 | 默认内联 | `--no-inline-vendor` |
|------|----------|----------------------|
| 产物形态 | 单个 HTML，1.43 MB | HTML 543.6 KB 加 vendor 922.4 KB |
| 双击可用 | 是 | 是，复制后仍可用 |
| 请求数 | 2 个（HTML 与 favicon） | 3 个 |
| 首次打开 | 一次读取 1.43 MB HTML | HTML 与 vendor 分开传输 |
| 缓存 | 单个文件，改动即整份失效 | vendor 可长期缓存，业务改动只失效 HTML |
| 分发 | 一个文件即可发送和归档 | 需要保持目录结构 |
| 解析成本 | vendor 与业务代码在同一份文档内 | 浏览器分别解析 |

默认选择内联的原因：

1. 主要交付目标是双击可运行的单文件，分发和归档只需一个 HTML。
2. vendor 只在导出 Excel 时使用，体积换请求数和分发简单在当前规模可以接受。
3. 内联后 `dist/index.html` 是完整自包含产物，不依赖目录结构。

保留选项的原因：

1. 通过 HTTP 提供页面时，vendor 可以设置长缓存，业务改动不会让浏览器重新下载 922 KB。
2. 需要把 vendor 放到统一 CDN 或替换版本时，外链更直接。
3. 单文件 HTML 超过 1 MB 时，部分聊天工具、邮件和附件渠道会截断或拒绝。

## 7. 保留无构建开发方式

`index.html` 继续直接引用 `css/` 与 `js/`，`node build.js` 只是可选的发布步骤。原因：

1. 当前测试通过 `tests/helpers/load.js` 直接加载 `js/*.js`，不依赖打包产物。保留源文件引用，测试与调试的加载模型一致。
2. `file://` 下双击 `index.html` 仍是最低成本的运行方式，构建失败也不影响开发和演示。
3. 经典 script 的全局作用域是现有模块边界，构建只做文本拼接，不引入模块系统，回滚只需删除 `dist/`。
4. 产物由源码生成，`dist/` 不进入版本控制，避免源码与产物双向漂移。

## 8. 与 P3 后端静态托管的配合

`docs/design/15-backend-options.md` 推荐 PocketBase 同源托管静态文件，并在 `pb_public` 下提供前端。`dist/` 正好可以整体作为静态目录内容：

- 把 `dist/index.html` 与 `dist/favicon.svg` 复制到 `pb_public/`，前端与 API 同源，`file://` 的 `origin: null` 限制消失，同步请求可用。
- 默认单文件产物对静态托管最省事，只需要两条路由，不需要配置 41 个静态资源。
- 使用 `--no-inline-vendor` 时，给 `xlsx.full.min.js` 配置长缓存，给 `index.html` 配置短缓存或 `no-cache`，发布流程只需替换 HTML。
- 自建 Node 或 Fastify 时同理，把 `dist/` 作为 root，`/` 指向 `index.html`。

需要注意三点：

1. 内联脚本意味着以后加 CSP 时不能只写 `script-src 'self'`，需要 `'unsafe-inline'`、hash 或 nonce。当前方案没有 CSP，接入时要在构建阶段生成 hash。
2. 单文件 HTML 的缓存粒度是整个页面。发布频率高且流量大时，改用 `--no-inline-vendor` 并对 vendor 单设缓存更合适。
3. 单机模式继续用源 `index.html` 或 `dist/index.html` 双击打开，服务端功能通过 `settings.syncMode` 控制，两条路径共用同一份业务代码。

## 9. 测试与验收

```bash
node build.js
node tests/build.test.js
node tests/run-all.js
```

`tests/build.test.js` 在系统临时目录创建最小工程，通过子进程运行 `build.js`，覆盖：

- 生成 `dist/index.html`，复制 `favicon.svg`。
- 本地样式与脚本外链全部消失。
- 脚本内联顺序与源 `index.html` 一致。
- `<style>` 数量与源样式数量一致。
- vendor 默认内联，`--no-inline-vendor` 保留外链并复制文件。
- `</script>` 与 `</style>` 转义后原生结束标签数量正确。
- 不出现 `type="module"` 与 `defer`。
- 原有行内 script 保留。

每个用例结束后删除临时目录，失败时以非零码退出，可被 `tests/run-all.js` 自动发现。

浏览器验收使用 ego-browser，打开 `dist/index.html` 的本地服务器地址，检查首屏渲染、工作台行列、控制台无错误。具体结果记录在提交说明和构建记录中。

## 10. 未验证项与限制

- 33 个内联脚本放在同一文档中，首次解析和执行的耗时没有单独测量，也没有与多请求版本做对比。
- 没有测量 gzip 与 brotli 后的传输体积。
- Safari、Firefox 与移动端没有做浏览器验收。
- 内联后 `document.currentScript` 在所有脚本中为 `null`，当前代码没有依赖该属性，未做全量静态排查。
- CSP、SRI、缓存头只在方案层面描述，没有落地配置。
- 构建不做 HTML 压缩，产物保留源文件缩进与换行。
