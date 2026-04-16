# PRD: Whiteboard v2.1 — Bug Fixes & Feature Expansion

## 1. Overview

本项目为一款类似 Excalidraw 的白板画布应用。本次 v2.1 迭代的核心目标是修复当前版本中严重的画布状态丢失和图形绘制 Bug，并新增文件导出、画布清空、深浅色模式切换、以及底部的缩放与历史记录控制组件，进一步完善白板的基础体验。

---

## 2. Goals

- 修复图形绘制后无法保存在画布上的致命 Bug
- 修复部分按键无法绘制图形的问题
- 新增画布导出为 PNG 功能（导出所有图形的最小包围盒区域）
- 新增清空画布功能（无确认弹窗，但撤销必须稳定可靠）
- 新增深/浅色模式切换（渲染时反转笔画颜色）
- 新增右下角视图控制台（缩放步长 25% + 撤销/重做按钮）

---

## 3. Bug Fixes

### BF-001: 修复图形无法留存画布（Critical）

**问题描述：** 用户在画布上完成图形绘制（鼠标松开/结束拖拽）后，图形直接消失。

**根因分析：** `onMouseUp` 事件中缺少将临时图形（drafting element）固化到 `shapes` 数组的逻辑，导致图形仅存在于 canvas 的临时渲染层，未推入全局状态数组。

**验收标准：**
- [ ] 鼠标松开后，图形数据（坐标、尺寸、类型、样式等）正确推入 `shapes` 数组
- [ ] 图形被持久化在画布上，不再消失
- [ ] `pushHistory` 被正确调用，支持后续撤销/重做
- [ ] 所有图形类型（矩形、椭圆、菱形、直线、箭头、自由笔、图片、文字）均不受此 Bug 影响
- [ ] Typecheck passes
- [ ] Verify in browser：绘制矩形、椭圆、菱形、直线、箭头、自由笔，鼠标松开后图形不消失

### BF-002: 修复部分按键无法绘制图形（High）

**问题描述：** 点击工具栏中的部分图形按钮后，无法在画布上画出对应的图形。

**根因分析：** 可能存在以下原因：
1. 工具按钮的 `onToolChange` 事件未正确更新 `activeTool` 状态
2. `CanvasComponent` 的 `handleMouseDown` / `handleMouseMove` / `handleMouseUp` 中缺少对某些工具类型的处理分支
3. 工具快捷键映射不完整

**验收标准：**
- [ ] 所有工具按钮点击后正确切换 `activeTool` 状态
- [ ] 矩形（▭/▮）、椭圆（○/●）、菱形（◇/◆）均可绘制
- [ ] 直线（╱）、箭头（→）均可绘制
- [ ] 自由笔（✏）可绘制
- [ ] 橡皮擦可擦除
- [ ] 图片插入按钮可打开文件选择器
- [ ] 快捷键映射完整：V=Select, R=矩形, O=椭圆, D=菱形, L=直线, A=箭头, P=自由笔, I=图片, X=橡皮擦
- [ ] Typecheck passes
- [ ] Verify in browser：逐一测试每个工具按钮和快捷键

---

## 4. User Stories

### US-001: 导出/保存画布为 PNG（Save）
**Description:** As a user, I want to save the canvas as a PNG image so that I can share or archive my whiteboard content.

**Acceptance Criteria:**
- [ ] 功能栏第二行增加「保存」按钮（icon: 💾 或下载图标）
- [ ] 点击后将画布上**所有图形的最小包围盒区域**导出为 `.png` 文件
- [ ] 导出范围 = 包含所有 shape 的最小矩形区域 + 适当 padding（如 20px），确保无内容被裁剪
- [ ] 触发浏览器原生文件下载（`canvas.toBlob()` + `<a download>`）
- [ ] 导出图片包含所有可见图形、笔画、文字、图片元素
- [ ] 导出图片背景与当前画布主题（深/浅模式）保持一致
- [ ] 默认文件名格式：`whiteboard-{roomId}-{timestamp}.png`
- [ ] Typecheck passes
- [ ] Verify in browser：绘制若干图形后点击保存，下载的文件在图片查看器中能正常打开且内容完整

### US-002: 清空画布（Reset Canvas）
**Description:** As a user, I want to clear the entire canvas with one click so I can start fresh.

**Acceptance Criteria:**
- [ ] 功能栏第二行增加「垃圾桶」图标按钮
- [ ] 点击后**不弹出确认弹窗**，直接清空画布内所有笔画、图形和图片（清空 `shapes` 数组）
- [ ] **撤销必须稳定可靠：** 清空前将当前完整状态快照推入 `history` 栈，用户可通过 Ctrl+Z 或撤销按钮一步恢复到清空前的状态
- [ ] 清空后选中状态（`selectedIds`）重置为空
- [ ] WebSocket 协作：向其他用户广播所有形状的删除事件
- [ ] 连续多次清空+撤销/重做不会导致状态错乱
- [ ] Typecheck passes
- [ ] Verify in browser：清空画布后按 Ctrl+Z 确认内容完全恢复

### US-003: 深/浅色模式切换（Theme Toggle）
**Description:** As a user, I want to switch between light and dark canvas modes so I can work comfortably in different lighting conditions.

**Acceptance Criteria:**
- [ ] 功能栏第二行增加主题切换按钮：太阳图标（☀️ 白天模式）和月亮图标（🌙 黑天模式），二者互斥
- [ ] 白天模式：画布背景色为 `#FFFFFF`（白色）
- [ ] 黑天模式：画布背景色为 `#121212`（深色）
- [ ] 功能栏背景色、按钮颜色、文字颜色适配当前主题
- [ ] **可见性约束（核心）：** 无论什么模式下，画布上的笔画和图形都清晰可见
  - 使用**渲染时反转笔画颜色**方案：在 `drawShape` 中根据当前主题应用颜色映射表
  - 映射表示例：`#000000` → `#E0E0E0`（黑变浅灰白），`#333333` → `#E0E0E0`，`#1c7ed6` 等浅色保持不变
  - 已有图形和新绘制图形在主题切换后均应用映射
- [ ] 主题切换时触发画布重绘，所有已有元素立即适配新主题
- [ ] 导出 PNG 时背景与当前主题一致，笔画颜色按映射后渲染
- [ ] 主题状态存储在 `App.tsx` 的 state 中（非持久化，刷新后回到默认浅色）
- [ ] Typecheck passes
- [ ] Verify in browser：切换主题后确认所有图形清晰可见，深色模式下黑色笔画变为浅色

### US-004: 右下角缩放控制面板（Zoom Controls）
**Description:** As a user, I want zoom in/out buttons at the bottom-right corner so I can easily control the canvas scale.

**Acceptance Criteria:**
- [ ] 右下角悬浮面板左侧为胶囊形状的缩放控制组
- [ ] 从左到右布局：`[-]` 缩小按钮 → 当前缩放比例文本（如 `100%`）→ `[+]` 放大按钮
- [ ] 点击 `+` 按 **25% 步长**放大
- [ ] 点击 `-` 按 **25% 步长**缩小
- [ ] 缩放范围：最小 10%，最大 500%
- [ ] 中间文本实时显示当前缩放百分比（如 `25%`, `50%`, `100%`, `150%`）
- [ ] 缩放中心点为当前视口中心
- [ ] 鼠标坐标映射在缩放后依然准确（`screenToWorld` 需正确计算）
- [ ] 保留现有的滚轮缩放功能（与按钮缩放互不冲突）
- [ ] Typecheck passes
- [ ] Verify in browser：点击 + / - 按钮确认缩放流畅，百分比文本正确更新

### US-005: 右下角历史记录控制面板（Undo / Redo）
**Description:** As a user, I want undo/redo buttons at the bottom-right corner so I can easily navigate my editing history.

**Acceptance Criteria:**
- [ ] 右下角悬浮面板右侧为撤销/重做控制组，位于缩放组件旁边
- [ ] 向左弯曲箭头按钮（↶ 撤销）+ 向右弯曲箭头按钮（↷ 重做）
- [ ] **撤销 (Undo)：** 回退到上一个画布状态；无历史状态时按钮置灰禁用（`disabled` 状态）
- [ ] **重做 (Redo)：** 如果进行了撤销，可点击重做恢复；新的绘制/编辑动作清空重做栈（`forwardHistory`）
- [ ] 维护两个栈：`history`（撤销栈）和 `forwardHistory`（重做栈），存储画布全局状态快照
- [ ] 按钮点击与现有的 `Ctrl+Z`（撤销）和 `Ctrl+Y`（重做）快捷键行为完全一致
- [ ] 撤销/重做时同步更新形状选中状态（`selectedIds` 清空）
- [ ] 清空画布操作可被撤销一步完整恢复
- [ ] Typecheck passes
- [ ] Verify in browser：执行多次绘制→撤销→重做→新绘制，确认栈状态正确无错乱

---

## 5. Functional Requirements

- FR-1: 修复 `handleMouseUp` 中缺少将新图形推入 `shapes` 数组的逻辑
- FR-2: 修复所有工具按钮的 `activeTool` 状态切换链路
- FR-3: 导出 PNG 范围 = 所有图形的最小包围盒 + 20px padding
- FR-4: 清空画布不弹窗，但必须在清空前推入完整历史快照
- FR-5: 深/浅模式切换通过渲染时颜色映射反转笔画颜色（不使用 CSS filter）
- FR-6: 缩放按钮步长为 25%，范围 10%~500%
- FR-7: 撤销/重做按钮与现有 Ctrl+Z / Ctrl+Y 快捷键共享同一套 history/forwardHistory 逻辑
- FR-8: 快捷键映射：V=Select, R=矩形, O=椭圆, D=菱形, L=直线, A=箭头, P=自由笔, I=图片, X=橡皮擦

---

## 6. Non-Goals (Out of Scope)

- 不实现主题颜色持久化（刷新后回到默认浅色模式）
- 不实现 PNG 导出时选择保存目录（使用浏览器默认下载行为）
- 不实现画布局部导出（仅导出包含图形的最小包围盒区域）
- 不修改现有的 WebSocket 协作协议
- 不实现画笔颜色自动反转的高级算法（使用简单映射表即可）
- 清空画布不显示确认弹窗（用户明确要求无弹窗）

---

## 7. Design Considerations

### 功能栏布局（两行）

```
┌──────────────────────────────────────────────────────────┐
│ ⠿ 🔓 | ▭ ▮ ○ ● ◇ ◆ ╱ → ✏ 🖼 |           ← 第一行：拖拽+锁定+工具 │
│ ──────────────────────────────────────────────────────── │
│ ☀️ 🌙 | 💾 | ● ● ● ● ● ● ● ● ● ● ＋ | —  | ─ ┄┄  ← 第二行：主题+保存+颜色+宽度+线型 │
└──────────────────────────────────────────────────────────┘
```

### 右下角控制面板布局

```
┌──────────────┬──────────────┐
│  [ - ]  100%  [ + ]  │  ↶  ↷  │
└──────────────┴──────────────┘
  缩放控制(25%)     历史记录
```

### 颜色模式对比

| 元素 | 浅色模式 (Light) | 深色模式 (Dark) |
|------|-----------------|-----------------|
| 画布背景 | `#FFFFFF` | `#121212` |
| 功能栏背景 | `rgba(255, 253, 245, 0.92)` | `rgba(40, 40, 40, 0.92)` |
| 主文字色 | `#333333` | `#E0E0E0` |
| 笔画颜色映射 | 不反转 | 深色→浅色（映射表） |
| 功能栏边框 | `#f0e4c0` | `#333` |

### 主题切换时的笔画颜色映射

```typescript
// 渲染时反转：在 drawShape 中根据当前主题应用映射
const DARK_MODE_COLOR_MAP: Record<string, string> = {
  '#000000': '#E0E0E0',  // 黑色 → 浅灰白
  '#333333': '#E0E0E0',  // 深灰 → 浅灰白
  '#2f9e44': '#69db7c',  // 深绿 → 浅绿
  '#1c7ed6': '#74c0fc',  // 深蓝 → 浅蓝
  '#6741d9': '#b197fc',  // 深紫 → 浅紫
  '#e8590c': '#ffa94d',  // 深橙 → 浅橙
  '#a0522d': '#d4a574',  // 深棕 → 浅棕
  // 浅色（红、粉、青等）保持不变
};
```

---

## 8. Technical Considerations

### Bug 修复重点

1. **BF-001（图形不保存）：** 检查 `CanvasComponent.tsx` 的 `handleMouseUp` 函数：
   - 确认 `newShape` 被正确创建并推入 `shapes` 数组
   - 确认 `pushHistory([...shapes, newShape])` 被调用
   - 确认 `redrawCanvas()` 在 shape 数组更新后触发

2. **BF-002（按键不工作）：** 检查以下链路：
   - `UnifiedToolbar` 中每个按钮的 `onClick` → `onToolChange` → `setActiveTool`
   - `CanvasComponent` 中 `handleMouseDown` / `handleMouseMove` / `handleMouseUp` 对每个 `activeTool` 的处理分支
   - `App.tsx` 中快捷键 `handleKeyDown` 映射完整性

### 功能实现建议

- **导出 PNG：** 遍历所有 shape 计算最小包围盒 → 创建离屏 canvas → `ctx.drawImage` 渲染 → `toBlob()` 下载
- **主题切换：** 通过 `App.tsx` 的 `theme` state 传递到 `CanvasComponent`，在 `drawShape` 中根据主题应用颜色映射表反转深色笔画
- **缩放控制：** 复用现有的 `scale` state 和 `screenToWorld` 逻辑，按钮操作调用 `onScaleChange`，步长 25%
- **历史记录按钮：** 复用现有的 `history` 和 `forwardHistory` state，按钮点击调用现有的 `undo` 函数和对应的 redo 逻辑

### 现有组件变更

- 修改：`UnifiedToolbar.tsx`（新增保存、清空、主题切换按钮）
- 修改：`CanvasComponent.tsx`（修复 Bug，主题适配渲染，清空功能）
- 修改：`App.tsx`（新增主题 state，整合历史记录按钮）
- 修改：`BottomPanel.tsx`（新增缩放 +/- 按钮和撤销/重做按钮）
- 修改：`theme.ts`（新增深色模式颜色定义）

---

## 9. Story Dependencies

```
BF-001 (图形不保存) + BF-002 (按键不工作)  ← 必须先修复，否则后续功能无法正常测试
  └── US-001 (导出 PNG)
  └── US-002 (清空画布)
  └── US-003 (主题切换)
  └── US-004 (缩放控制)
  └── US-005 (历史记录按钮)
```

**建议执行顺序：** BF-001 → BF-002 → US-001 → US-002 → US-003 → US-004 → US-005

---

## 10. Success Metrics

- 所有图形绘制后能正确保留在画布上，不再消失
- 所有工具按钮和快捷键均能正常绘制对应图形
- 导出 PNG 包含所有图形的最小包围盒区域，文件可正常下载打开
- 清空画布功能正常，撤销可一步完整恢复清空前状态
- 深/浅色模式切换流畅，深色模式下黑色笔画自动变为浅色清晰可见
- 缩放按钮步长 25% 工作正常，百分比文本正确更新
- 撤销/重做按钮与快捷键行为一致，栈状态无错乱
- Typecheck 和 lint 通过
- 在浏览器中验证所有 UI 变更符合预期

---

## 11. Open Questions

- 颜色映射表是否需要覆盖更多颜色？（当前列出了常见深色，实际绘制时用户可能选择自定义颜色）
- 导出 PNG 的 padding 20px 是否合适？是否需要可配置？
- 缩放步长 25% 在极端缩放比（如 10% 或 500%）时是否需要特殊处理？
