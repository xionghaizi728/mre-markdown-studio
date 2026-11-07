# MRE · Markdown 读写工作台

一个跑在本机的 Markdown 编辑器：Node 后端负责读写 `docs/` 目录下的文件，浏览器里直接编辑、实时预览、保存。

## 快速开始

```bash
# 方式一：直接运行（推荐，无需安装任何依赖）
node server.js

# 方式二：用 npm 脚本
npm start
```

启动后打开 <http://127.0.0.1:3000>，左侧选文件，中间编辑，右侧实时预览，`Ctrl + S` 保存。

换端口：`PORT=3010 node server.js`（PowerShell 里写成 `$env:PORT=3010; node server.js`）。
换文档目录：`DOCS_DIR=D:\notes node server.js`。

> 本项目**零第三方依赖**，不需要 `npm install`。本机当前的 npm 组件本身报 `ERR_INVALID_PACKAGE_CONFIG`（npm 自带的 semver 文件损坏），所以 `npm start` 可能无法执行；用 `node server.js` 不受影响。

## 目录结构

```
MRE/
├── server.js              # 零依赖 Node 后端（http + fs）
├── package.json           # 仅供 npm start / 元信息，无 dependencies
├── public/
│   ├── index.html         # 页面骨架
│   ├── styles.css         # 样式
│   ├── app.js             # 前端逻辑
│   └── vendor/
│       └── marked.min.js  # 本地内置的 Markdown 渲染库（不依赖外网）
├── docs/                  # 你的 Markdown 文档目录（后端只读写这里）
│   └── 欢迎使用.md
└── README.md
```

## 功能

- 文件列表（递归扫描子目录），支持按文件名搜索
- 新建（可带子目录，如 `笔记/周报.md`）、重命名/移动、删除
- 三种视图：纯编辑 / 分栏 / 纯预览，中间分隔条可拖动调宽度
- 实时预览：GFM 表格、任务列表、代码块、引用、链接
- 手动保存 + 自动保存开关（停止输入 1.2 秒后写盘）
- 未保存提醒：切换文件、关闭页面时提示
- 快捷键：`Ctrl+S` 保存、`Ctrl+B` 加粗、`Ctrl+I` 斜体、`Ctrl+N` 新建、`Tab` 插入两空格
- 工具栏：加粗、斜体、标题、链接、行内代码、列表、引用、表格
- 状态栏：行列位置、字符数、保存状态、预计阅读时长
- 渲染结果做了基础防注入处理（剔除 script/iframe 与 on* 属性）

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查，返回文档目录 |
| GET | `/api/files` | 列出全部 Markdown 文件 |
| GET | `/api/file?path=` | 读取单个文件 |
| PUT | `/api/file` | 保存，body：`{"path":"a.md","content":"..."}` |
| POST | `/api/file` | 新建，body 同上，可加 `"overwrite":true` |
| POST | `/api/rename` | 重命名/移动，body：`{"from":"a.md","to":"b.md"}` |
| DELETE | `/api/file?path=` | 删除 |

## 安全边界

- 所有路径都基于 `docs/` 解析，`..`、绝对路径、非 `.md/.markdown` 文件一律拒绝
- 只允许写入 `docs/` 目录内部，不会碰到项目其他文件
- 默认只监听 `127.0.0.1`，不对外网开放
- 请求体上限 10MB，单文件按 UTF-8 读写

## 后续可扩展

- 文件树折叠、拖拽排序
- 代码块语法高亮（引入 highlight.js 到 `public/vendor/`）
- 全文搜索、版本历史（每次保存前备份到 `docs/.history/`）
- 导出 HTML / PDF
