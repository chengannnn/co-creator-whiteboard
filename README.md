# Collaborative Whiteboard

一个基于前后端分离架构的实时协作白板应用，功能类似 Excalidraw。支持多人在同一画布上绘制图形、实时同步、图层管理与主题切换。

## ✨ 核心特性

- **原生 Canvas 2D 高性能渲染** — 三层 Canvas 架构（背景 / 静态 / 交互），杜绝多余的第三方渲染库，帧率稳定流畅
- **实时多人协作** — WebSocket 全双工广播，多用户同时编辑、远程光标实时可见、跨端即时同步
- **无惧刷新的 5 分钟断线保护** — 房间空置后保留 5 分钟宽限期，用户断线重连或刷新页面即可无缝恢复画布状态
- **支持跨端时空隔离的本地 Undo/Redo** — 每端独立的 300 步快照式历史栈，撤销/重做不受网络延迟或其他用户操作干扰，撤销后再修改自动清空重做栈
- **基于逻辑删除的丝滑协作** — 前后端均采用 `isDeleted: true` 逻辑删除，绝不物理擦除数据；Undo 可随时复活任何已删除元素，后端 `shape_update` 内置 Upsert 机制保障撤销复活跨端生效
- **防内存溢出的智能垃圾回收** — 前端基于 300 步历史栈的精准 GC（只清理无法被任何快照复活僵尸节点），后端每 10 分钟定时清扫死数据 + 新用户加入时自动过滤已删元素，内存占用始终可控
- **基础几何图形与自由绘制** — 矩形、椭圆、菱形、线条、箭头、自由手绘，支持实线 / 虚线、轮廓 / 实心 / 斜纹填充
- **视口中心缩放与无限画布** — 鼠标滚轮缩放始终锚定视口中心，支持 0.1× ~ 5× 无级缩放
- **高级对象操作** — 图层排序（置顶 / 置底 / 上移一层 / 下移一层）、编组与拆分、8 点拖拽缩放、圆角切换
- **Inline 文本编辑** — 双击文字直接编辑，新建文本与编辑已有文本统一为单次撤销操作
- **白天 / 暗色模式主题** — 一键切换，笔触颜色自动适配暗色模式
- **Canvas 锁定模式** — 一键锁定画布，禁止绘制/选择/移动，仅保留平移和缩放，适合演示场景
- **PNG 导出** — 一键将整个画布导出为 PNG 图片

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
| **前端** | React 19 · TypeScript · 原生 Canvas 2D 引擎 · React Router |
| **后端** | Node.js · Express · WebSocket (`ws`) · CORS |
| **构建** | Vite 6 · npm workspaces · concurrently（前后端并行启动） |
| **代码质量** | ESLint · Vitest · Testing Library |
| **架构** | Monorepo（packages/frontend + packages/backend） |

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
