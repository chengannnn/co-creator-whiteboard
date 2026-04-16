# PRD: Whiteboard v2.1.1 — 交互层缺陷修复与工具栏完善

## 1. Overview

本次 v2.1.1 迭代是在 v2.1 核心渲染引擎重构完成后的修复与完善版本。目标是清理交互层（Interactive Layer）的遗留 Bug（快照残留、负坐标渲染异常），重构橡皮擦为对象级擦除，优化工具栏 UI 图标，并引入具备"双重行为模式"的圆角控制按钮。

**范围约束：** 不改变核心渲染架构（三层 Canvas、Scene、ToolHandler 管线保持不变），仅在现有架构上修复缺陷、扩展状态与 UI。

---

## 2. Goals

- 消除 pointermove 过程中 Interactive Canvas 上的草稿快照残留
- 修复向左/上方拖拽绘制矩形/菱形/椭圆失效的 Bug
- 将橡皮擦重构为对象级擦除（触碰命中即标记，pointerup 统一删除）
- 替换选择工具与橡皮擦工具的 SVG 图标
- 新增圆角按钮，支持禁用/可用/按下三种状态
- 圆角双重行为：全局预设 + 选中图形批量修改器
- TypeScript 严格模式编译通过

---

## 3. Bug Fixes

### BF-001: 修复绘制过程中的"快照残留" (High)

**问题描述：** 在画布上拖拽绘制图形时，Interactive Canvas 上留下之前帧的图形草稿快照残留，画面出现一排重叠虚影。

**根因分析：** `pointermove` 事件中重新绘制草稿元素前，未对 Interactive Canvas 调用完整的 `clearRect`。`pointerup` 后也未将 `draft` 状态置空。

**修复要求：**
- [ ] `pointermove` 每一帧绘制草稿前，必须先 `interactiveCtx.clearRect(0, 0, canvas.width, canvas.height)`
- [ ] `pointerup` 图形提交到 Static Canvas 后，清空 Interactive Canvas
- [ ] `pointerup` 后将当前 `draft` 状态置空（`currentDraft = null`）

**验收标准：**
- [ ] 拖拽绘制过程中，Interactive Canvas 上仅显示当前帧的单一草稿图形，无残影
- [ ] pointerup 后草稿完全消失，仅 Static Canvas 上的正式图形可见
- [ ] Typecheck passes

### BF-002: 修复向左/上方拖拽绘制图形失效 (High)

**问题描述：** 向右下方拖拽绘制矩形正常，但向左或向上拖拽时，图形无法生成。直线和箭头无此问题。

**根因分析：** 原生 Canvas 2D 的 `rect(x, y, width, height)` API 不支持负数宽高。当前 ToolHandler 计算 width/height 时未取绝对值，起点坐标也未修正。

**修复要求：**
- [ ] 规范宽高计算：`width = Math.abs(currentX - startX)`，`height = Math.abs(currentY - startY)`
- [ ] 规范起点坐标：`x = Math.min(startX, currentX)`，`y = Math.min(startY, currentY)`
- [ ] 将上述逻辑封装到对应的 ToolHandler 或通用坐标计算 Helper 中
- [ ] 适用图形：RectangleHandler、EllipseHandler、RhombusHandler

**验收标准：**
- [ ] 向任意方向（左上、右上、左下、右下）拖拽绘制矩形、椭圆、菱形均可正常生成
- [ ] 生成的图形位置、尺寸准确，与拖拽方向无关
- [ ] Typecheck passes

### BF-003: 重构橡皮擦为对象级擦除 (Critical)

**问题描述：** 当前橡皮擦完全失效。

**期望行为：** `activeTool = eraser` 时，鼠标在画布上移动，光标触碰 SceneElement 的包围盒或轮廓线，该对象被视觉高亮标记。pointerup 时，所有被标记的元素统一被逻辑删除（`isDeleted = true`），仅推入一条历史快照。

**修复要求：**
- [ ] EraserHandler 的 `pointermove` 中实现碰撞检测（Hit Testing）
- [ ] 实现 `pointInBoundingBox(px, py, element)` 函数：判断鼠标世界坐标是否落在元素 Bounding Box 内
- [ ] 遍历 Scene 中所有 `isDeleted === false` 的元素，判断是否命中
- [ ] 命中的元素在 Interactive Canvas 上做视觉反馈（降低透明度或红色高亮）
- [ ] `pointerup` 时，将所有命中元素的 `isDeleted` 标记为 `true`
- [ ] 仅推入一条历史快照到撤销栈（一次擦除动作 = 一步撤销）
- [ ] 触发 Static Canvas 重绘
- [ ] 清空擦除草稿状态

**验收标准：**
- [ ] 橡皮擦光标触碰图形时，图形立即呈现高亮/半透明视觉反馈
- [ ] pointerup 后所有触碰到的图形被整块擦除
- [ ] Ctrl+Z 可一步恢复本次擦除的所有元素
- [ ] Typecheck passes

---

## 4. User Stories

### US-001: 修复 pointermove 草稿快照残留
**Description:** As a user, I want the Interactive canvas to show only the current frame's draft shape while drawing, so I don't see ghost trails of previous frames.

**Acceptance Criteria:**
- [ ] PointerEventProcessor `pointermove` handler clears Interactive Canvas with `clearRect(0, 0, canvas.width, canvas.height)` before each draft redraw
- [ ] `pointerup` handler clears Interactive Canvas and sets `currentDraft = null` after committing the shape
- [ ] Dragging to draw shows only one live draft shape, no overlapping ghost trails
- [ ] After mouse release, draft disappears completely, only the committed shape remains on Static Canvas
- [ ] Typecheck passes
- [ ] Verify in browser: drag-draw rectangle, ellipse, freehand — no ghost trails visible during drag

### US-002: 修复负坐标拖拽绘制失效
**Description:** As a user, I want to draw shapes by dragging in any direction (including left/up), so my drawing workflow feels natural.

**Acceptance Criteria:**
- [ ] RectangleHandler uses `width = Math.abs(currentX - startX)`, `height = Math.abs(currentY - startY)`, `x = Math.min(startX, currentX)`, `y = Math.min(startY, currentY)`
- [ ] EllipseHandler uses the same absolute-value logic for bounding box
- [ ] RhombusHandler uses the same absolute-value logic for 4 vertex calculation
- [ ] Coordinate normalization logic is encapsulated in a shared helper function or within each handler
- [ ] Dragging in all 4 diagonal directions (NW, NE, SW, SE) produces correctly positioned and sized shapes
- [ ] Typecheck passes
- [ ] Verify in browser: drag in all directions for rectangle, ellipse, rhombus — shapes appear correctly

### US-003: 重构橡皮擦为对象级擦除
**Description:** As a user, I want to erase shapes by touching them with the eraser cursor, so I can quickly remove unwanted elements one by one or in batches.

**Acceptance Criteria:**
- [ ] Add `hitTesting.ts` helper with `pointInBoundingBox(px, py, element)` function that checks if a point is inside an element's bounding box
- [ ] EraserHandler `pointermove` traverses all non-deleted Scene elements and checks hit against each
- [ ] Hit elements are visually highlighted on Interactive Canvas (e.g., semi-transparent overlay or red border)
- [ ] `pointerup` sets `isDeleted = true` for all hit elements
- [ ] Exactly one history snapshot is pushed for the entire eraser stroke (one undo restores all erased elements)
- [ ] Static Canvas redraws after deletion
- [ ] Eraser draft state is cleared after pointerup
- [ ] Typecheck passes
- [ ] Verify in browser: erase single shape with click, erase multiple shapes with drag sweep, undo restores all

### US-004: 更新工具栏 SVG 图标
**Description:** As a user, I want standard SVG icons for the selection and eraser tools, so the toolbar looks professional and familiar.

**Acceptance Criteria:**
- [ ] Selection tool button: replace current icon with standard cursor/pointer SVG icon
- [ ] Selection tool button position: immediately to the right of the lock toggle, with a vertical divider `|` separating it from drawing tools
- [ ] Eraser tool button: replace current rectangle/block icon with standard eraser SVG icon (tilted, classic eraser shape)
- [ ] Icons render correctly in both light and dark themes
- [ ] Typecheck passes
- [ ] Verify in browser: icons display correctly in both themes

### US-005: 新增圆角按钮 — 状态机设计
**Description:** As a user, I want a corner-rounding toggle button that intelligently enables/disables based on the active tool, so I can draw rounded rectangles and diamonds.

**Acceptance Criteria:**
- [ ] Add "Round Corner" button at the rightmost position of the toolbar first row
- [ ] **Disabled state** (semi-transparent/gray): Active tool is NOT one of `rectangle`, `rectangle-solid`, `rhombus`, `rhombus-solid`. Button is non-interactive.
- [ ] **Enabled state** (normal appearance): Active tool IS one of `rectangle`, `rectangle-solid`, `rhombus`, `rhombus-solid`. Button is clickable.
- [ ] **Toggled on state** (highlighted/pressed): User clicks the button while enabled, button shows pressed visual feedback.
- [ ] Button state updates reactively when `AppState.activeTool` changes
- [ ] `AppState` adds `isRoundCornerEnabled: boolean` field
- [ ] `ToolType` enum includes `rectangle`, `rectangle-solid`, `rhombus`, `rhombus-solid` as distinct values (verify existing; add if missing)
- [ ] Typecheck passes
- [ ] Verify in browser: switching tools correctly enables/disables the round corner button; clicking toggles highlight

### US-006: 圆角双重行为 — 全局预设模式
**Description:** As a user, I want the round corner toggle to act as a global preset for newly drawn shapes, so all my subsequent rectangles/diamonds have rounded corners.

**Acceptance Criteria:**
- [ ] When `isRoundCornerEnabled = true`, newly drawn `RectangleElement` or `RhombusElement` get `borderRadius = 12` (fixed preset value in pixels)
- [ ] When `isRoundCornerEnabled = false`, newly drawn shapes get `borderRadius = 0`
- [ ] Applies to all 4 shape types: `rectangle`, `rectangle-solid`, `rhombus`, `rhombus-solid`
- [ ] `borderRadius` is stored in `SceneElement` and persists across redraws
- [ ] Static Canvas renders rounded corners using roughjs `borderRadius` option on `rc.rectangle()` and `rc.polygon()`
- [ ] Typecheck passes
- [ ] Verify in browser: enable round corner, draw rectangle — shows rounded corners; disable, draw another — shows sharp corners

### US-007: 圆角双重行为 — 属性修改器模式
**Description:** As a user, I want to apply round corners to already-selected shapes with a single click on the round corner button, so I can toggle rounding on existing elements.

**Acceptance Criteria:**
- [ ] When the round corner button is clicked, check `AppState.selectedElementIds` for currently selected shapes
- [ ] If any selected shapes are `RectangleElement` or `RhombusElement`, update their `borderRadius` to `12` (toggled on) or `0` (toggled off)
- [ ] Auto-filter: only rectangle and rhombus types receive the borderRadius change; other selected types (ellipse, line, freehand, etc.) are skipped
- [ ] Multi-select supported: if multiple eligible shapes are selected, all receive the borderRadius update
- [ ] Update triggers `Scene.updateElement()` for each modified element (version increment)
- [ ] Push one history snapshot for the batch update
- [ ] Trigger Static Canvas redraw
- [ ] Typecheck passes
- [ ] Verify in browser: select multiple rectangles/diamonds, click round corner button — all eligible shapes update; undo restores previous state

---

## 5. Functional Requirements

- FR-1: `pointermove` 必须在每帧草稿重绘前对 Interactive Canvas 调用 `clearRect(0, 0, canvas.width, canvas.height)`
- FR-2: `pointerup` 必须清空 Interactive Canvas 并将 `currentDraft` 置为 `null`
- FR-3: RectangleHandler、EllipseHandler、RhombusHandler 必须使用 `Math.abs` 计算宽高、`Math.min` 计算起点
- FR-4: 橡皮擦使用 `pointInBoundingBox(px, py, element)` 进行包围盒碰撞检测
- FR-5: 橡皮擦 pointermove 命中元素时在 Interactive Canvas 上高亮显示
- FR-6: 橡皮擦 pointerup 时将所有命中元素的 `isDeleted` 设为 `true`，仅推入一条历史快照
- FR-7: 选择工具图标替换为标准 cursor/pointer SVG，位于锁定按钮右侧，与绘图工具间有竖线分隔符
- FR-8: 橡皮擦图标替换为标准 eraser SVG
- FR-9: 圆角按钮位于工具栏第一行最右侧
- FR-10: 圆角按钮状态机：`rectangle`/`rectangle-solid`/`rhombus`/`rhombus-solid` 时可用，其余工具时禁用（半透明）
- FR-11: 圆角全局预设：开启后新绘制的矩形/菱形 `borderRadius = 12`（固定值），关闭后 `borderRadius = 0`
- FR-12: 圆角属性修改器：点击时批量修改已选中的矩形/菱形的 `borderRadius`，自动过滤非适用类型
- FR-13: `AppState` 新增 `isRoundCornerEnabled: boolean` 字段
- FR-14: `ToolType` 包含 `rectangle`、`rectangle-solid`、`rhombus`、`rhombus-solid` 作为独立枚举
- FR-15: 圆角修改器支持多选中批量修改，仅推入一条历史快照
- FR-16: Typecheck 通过

---

## 6. Non-Goals (Out of Scope)

- 不实现圆角半径值的选择器或输入框（固定 12px 预设）
- 不实现像素级橡皮擦路径检测（仅包围盒碰撞）
- 不实现椭圆的圆角功能（椭圆本身已是曲线）
- 不改变三层 Canvas 的渲染架构
- 不修改 WebSocket 协议或后端
- 不实现橡皮擦的笔画宽度（触碰即命中整个元素）
- 不实现圆角属性的撤销/重做单独快照（合并到圆角按钮点击的一次快照中）

---

## 7. Design Considerations

### AppState 新增字段

```typescript
// 在现有 AppState 中新增:
interface AppState {
  // ... existing fields ...
  isRoundCornerEnabled: boolean;  // 圆角开关，默认 false
}
```

### ToolType 枚举（确认/新增）

```typescript
type ToolType =
  | 'select'
  | 'rectangle'
  | 'rectangle-solid'
  | 'ellipse'
  | 'ellipse-solid'
  | 'rhombus'
  | 'rhombus-solid'
  | 'line'
  | 'arrow'
  | 'freehand'
  | 'eraser'
  | 'image';
```

### 圆角按钮状态机

```
┌──────────────────────────────────────────────────────────────┐
│  Active Tool                     │  Button State              │
├──────────────────────────────────────────────────────────────┤
│  rectangle / rect-solid          │  Enabled (clickable)       │
│  rhombus / rhombus-solid         │  Enabled (clickable)       │
│  ellipse / ellipse-solid         │  Disabled (grayed out)     │
│  line / arrow / freehand         │  Disabled (grayed out)     │
│  eraser / select / image         │  Disabled (grayed out)     │
├──────────────────────────────────────────────────────────────┤
│  When Enabled + Clicked:                                     │
│    → Toggled ON:  borderRadius = 12 (highlighted button)     │
│    → Toggled OFF: borderRadius = 0  (normal button)          │
│                                                              │
│  When Toggled ON + Selected shapes exist:                    │
│    → Apply borderRadius = 12 to selected rect/rhombus        │
│    → Push ONE history snapshot                               │
│    → Redraw Static Canvas                                    │
└──────────────────────────────────────────────────────────────┘
```

### 橡皮擦碰撞检测

```typescript
function pointInBoundingBox(px: number, py: number, element: SceneElement): boolean {
  const { x, y, width, height } = element;
  return px >= x && px <= x + width && py >= y && py <= y + height;
}
```

对于 freehand 元素，使用其 points 数组的最小/最大 x/y 计算包围盒。
对于 line/arrow 元素，使用 startX/Y 和 endX/Y 的 min/max 计算包围盒。

### 坐标计算 Helper

```typescript
function normalizeBounds(
  startX: number, startY: number,
  currentX: number, currentY: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}
```

### 圆角 SVG 按钮图标

```
┌─────┐
│  ╭─╮ │  ← 圆角矩形示意图标
│  │ │ │
│  ╰─╯ │
└─────┘
```

---

## 8. Technical Considerations

### roughjs 圆角渲染

roughjs 的 `rc.rectangle(x, y, w, h, { borderRadius })` 原生支持 `borderRadius` 选项。直接传递即可。

对于 `rc.polygon()` 绘制的菱形，需要手动将 4 个尖角替换为圆弧过渡。如果 roughjs 不直接支持 polygon 的 borderRadius，可使用 `rc.path()` 手动绘制带圆弧的菱形路径。

### 橡皮擦高亮渲染

在 Interactive Canvas 上，对命中的元素绘制一层半透明覆盖层：
- 方案 A：降低元素 opacity 至 0.3（元素变淡表示即将删除）
- 方案 B：在元素外围绘制红色虚线边框（高亮表示即将删除）

推荐方案 B（红色虚线边框），视觉反馈更明确，不干扰元素本身的可见性。

### 圆角修改器的批量更新

点击圆角按钮时的完整流程：
1. 读取 `selectedElementIds`
2. 遍历选中元素，过滤出 `type === 'rectangle' | 'rectangle-solid' | 'rhombus' | 'rhombus-solid'`
3. 对每个匹配元素调用 `scene.updateElement(id, { borderRadius: newValue })`
4. 推入一条历史快照 `pushHistory(scene.snapshot())`
5. 触发 Static Canvas 重绘

---

## 9. Success Metrics

- 绘制过程中 Interactive Canvas 无草稿残影，画面干净
- 向任意方向拖拽绘制矩形/椭圆/菱形均可正常生成
- 橡皮擦触碰图形即高亮标记，松手后批量擦除，一步撤销恢复
- 圆角按钮在正确的工具下可用，在其他工具下正确禁用
- 开启圆角后绘制的矩形/菱形带有圆角，关闭后为直角
- 选中多个矩形/菱形点击圆角按钮，批量应用圆角
- TypeScript 严格模式零错误
- 在浏览器中逐一验证所有修复与功能

---

## 10. Story Dependencies

```
BF-001 (快照残留) + BF-002 (负坐标)  ← 独立修复，可并行
  └── US-001 (修复快照残留)
  └── US-002 (修复负坐标)

BF-003 (橡皮擦重构)  ← 依赖 hitTesting helper
  └── US-003 (对象级擦除)

UI 优化  ← 依赖现有 ToolType 枚举确认
  └── US-004 (更新 SVG 图标)
  └── US-005 (圆角按钮状态机)
  └── US-006 (圆角全局预设)
  └── US-007 (圆角属性修改器)

推荐执行顺序:
  US-001 + US-002 (并行) → US-003 → US-004 → US-005 → US-006 → US-007
```

---

## 11. Open Questions

- roughjs 的 `rc.polygon()` 是否支持 `borderRadius`？如果不支持，菱形的圆角需要用 `rc.path()` 手动绘制圆弧路径，工作量是否可接受？
- 橡皮擦红色虚线边框的粗细和颜色是否需要适配深浅色模式？
- 圆角预设值 12px 在所有缩放级别下是否需要等比缩放？（如 200% 缩放时是否应为 24px？）
- 如果用户选中了 0 个图形但圆角按钮已处于"按下"状态，新绘制的图形仍应用圆角 — 这个行为是否符合预期？
