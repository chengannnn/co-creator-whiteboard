# Collaborative Whiteboard

一个基于前后端分离架构的实时协作白板应用，功能类似 Excalidraw。支持多人在同一画布上绘制图形、实时同步、图层管理与主题切换。

## ✨ 核心特性

- **原生 Canvas 2D 高性能渲染** — 三层 Canvas 架构（背景 / 静态 / 交互），杜绝多余的第三方渲染库
- **实时多人协作** — WebSocket 广播，支持多用户同时编辑、远程光标可见
- **基础几何图形与自由绘制** — 矩形、椭圆、菱形、线条、箭头、自由手绘
- **视口中心缩放与无限画布** — 鼠标滚轮缩放，始终锚定视口中心，支持 0.1× ~ 5×
- **高级对象操作** — 图层排序（置顶/置底/上移/下移）、编组与拆分、8 点拖拽缩放
- **白天 / 暗色模式主题** — 一键切换，笔触颜色自动适配暗色模式

## 📁 项目结构

```
collaborative-whiteboard/
├── packages/
│   ├── frontend/          # React + Vite 前端应用
│   │   ├── src/
│   │   │   ├── components/   # UI 组件（工具栏、底部面板等）
│   │   │   ├── core/         # 核心逻辑（Scene、History、工具处理器）
│   │   │   └── types/        # 数据类型定义
│   │   └── ...
│   └── backend/           # Express + WebSocket 后端服务
│       └── src/
│           └── index.ts      # 房间管理、状态同步、光标转发
├── archive/               # 旧版本代码备份
├── tasks/                 # 历史 PRD 与需求文档
├── scripts/               # 辅助脚本
├── ralph/                 # Ralph 自动化代理配置
├── .claude/               # Claude Code 工作区设置
├── ARCHITECTURE.md        # 面向 AI 助手的深度架构文档
└── package.json           # 根 package（npm workspaces）
```

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 · Vite 6 · TypeScript · Canvas API · React Router |
| **后端** | Node.js · Express · WebSocket (`ws`) · CORS |
| **测试** | Vitest · Testing Library |
| **构建** | npm workspaces · concurrently（并行启动前后端） |

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- npm ≥ 9

### 安装与启动

```bash
# 1. 安装所有依赖（根目录，自动安装 monorepo 各子包）
npm install

# 2. 同时启动前端和后端开发服务
npm run dev
```

执行 `npm run dev` 后：
- **后端**：运行在 `http://localhost:3001`（Express + WebSocket）
- **前端**：Vite 自动打开浏览器，默认访问 `http://localhost:5173`

前端页面会自动跳转到 `/room/<随机ID>`，复制该 URL 分享给他人即可进入同一房间协作。

### 其他常用命令

```bash
# 仅构建前端
npm run build

# 运行 ESLint 检查
npm run lint

# 运行 TypeScript 类型检查
npm run typecheck

# 运行前端测试套件
npm run test -w packages/frontend
```

## 📖 更多文档

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — 面向 AI 编程助手的深度架构文档，涵盖状态管理、渲染管线、坐标系规约与核心设计决策。
