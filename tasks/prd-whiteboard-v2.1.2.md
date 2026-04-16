# PRD: v2.1.2 渲染层降级与核心交互修复

## 1. 迭代背景与目标 (Overview)

经过前几轮重构，底层架构（Scene 与分层 Canvas）已初步建立，但表现层依然存在严重的交互 Bug。同时，基于性能和后续维护成本的考量，本期做出重大架构决策：**全面废除手绘风格**（移除 Rough.js 依赖），所有图形回归最标准的矢量几何样式（使用原生 Canvas 2D API 绘制）。

**本期迭代核心目标：**

- 完成渲染库降级，移除 Rough.js，统一使用原生 Canvas 2D 渲染
- 彻底修复鼠标向左拖拽失效的致命缺陷
- 彻底修复交互层严重拖尾现象
- 彻底修复选中状态下拉伸/缩放不稳定的问题

---

## 2. Goals

- 从项目中完全移除 Rough.js 依赖，降低 bundle 体积和维护成本
- 所有图形使用原生 Canvas 2D API 绘制，线条平滑顺直
- 交互层（Interactive Canvas）在 pointermove 渲染循环中不再产生拖尾残影
- 向任意方向拖拽（左/上/右/下）均能正常绘制图形
- 选中图形后，拖拽控制点（Handles）进行拉伸/缩放时行为稳定、可预测

---

## 3. User Stories

### US-001: 移除 Rough.js 依赖及粗糙度相关数据结构
**Description:** As a developer, I want to remove the Rough.js library and all roughness-related properties so that the project has fewer dependencies and a smaller bundle size.

**Acceptance Criteria:**
- [ ] `roughjs` package 从 `package.json` 中移除，`node_modules` 中不再存在
- [ ] `SceneElement` 接口中移除 `roughness`、`seed` 等与 Rough.js 相关的属性定义
- [ ] 所有引用这些属性的代码路径已清理，TypeScript 编译无报错
- [ ] 项目中无残留的 Rough.js import 语句

### US-002: 重写渲染函数为原生 Canvas 2D 绘制
**Description:** As a developer, I want to rewrite the `drawElement` (或等价渲染函数) to use native Canvas 2D APIs so that all shapes render as clean, standard vector geometry.

**Acceptance Criteria:**
- [ ] 矩形使用 `ctx.strokeRect()` 和 `ctx.fillRect()` 绘制
- [ ] 菱形使用 `ctx.beginPath()` + `ctx.moveTo()` + `ctx.lineTo()` + `ctx.closePath()` 构建标准路径
- [ ] 线条使用 `ctx.beginPath()` + `ctx.moveTo()` + `ctx.lineTo()` 绘制，线条平滑顺直
- [ ] 箭头使用标准路径绘制，带有明确的箭头头部（三角形），无手绘抖动感
- [ ] 所有图形在 Static 层和 Interactive 层均可正常渲染
- [ ] 图形描边颜色、填充颜色、线宽等样式属性仍可正确应用
- [ ] Typecheck 和 lint 通过

### US-003: 修复 Interactive 层拖尾残影问题
**Description:** As a user, I want the drawing canvas to not leave ghosting trails when I drag to create shapes, so that my workspace stays clean and responsive.

**Acceptance Criteria:**
- [ ] 在 `pointermove` 事件中触发 Interactive Canvas 重绘前，调用 `ctx.clearRect(0, 0, canvas.width, canvas.height)` 清空整个交互层
- [ ] 清空操作仅针对 Interactive 层，Static 层不受影响，其上已提交的图形不消失
- [ ] 拖拽绘制矩形/菱形/线条/箭头时，画布上只显示当前帧的 Draft 元素，无历史残影
- [ ] 绘制完成后（`pointerup`），图形正常提交到 Static 层并持久显示
- [ ] Typecheck 和 lint 通过
- [ ] Verify in browser using dev-browser skill

### US-004: 修复向左/向上拖拽无法绘制图形的问题
**Description:** As a user, I want to draw shapes by dragging the mouse in any direction (left, up, right, down), so that the drawing experience feels natural.

**Acceptance Criteria:**
- [ ] 鼠标从起点向左侧拖拽时，矩形/菱形正常绘制并显示
- [ ] 鼠标从起点向上方拖拽时，矩形/菱形正常绘制并显示
- [ ] 向任意对角线方向拖拽（如左上、左下、右上、右下）均正常绘制
- [ ] 坐标计算使用 `Math.min(startX, currentX)` 和 `Math.abs(currentX - startX)` 确保宽高始终为正数
- [ ] 最终提交的图形在 Static 层中的位置和尺寸与实际鼠标轨迹一致
- [ ] Typecheck 和 lint 通过
- [ ] Verify in browser using dev-browser skill

### US-005: 修复选中图形后拉伸/缩放不稳定的问题
**Description:** As a user, I want to reliably resize a selected shape by dragging its handles, so that I can precisely adjust shape dimensions.

**Acceptance Criteria:**
- [ ] 选中图形后，显示标准的控制点（Handles）在图形的边界框（Bounding Box）上
- [ ] 拖拽四角控制点（nw, ne, sw, se）时，图形的 `x, y, width, height` 根据鼠标移动差值正确更新
- [ ] 拖拽四边中点控制点（n, s, e, w）时，对应方向的尺寸正确调整
- [ ] 拉伸过程中图形边界框与鼠标光标位置保持一致，无跳动或错位
- [ ] 图形宽高被限制为不小于 1 像素，防止拉伸越过中轴线时的坐标翻转问题
- [ ] 松开鼠标后，调整后的图形正确提交到 Static 层
- [ ] Typecheck 和 lint 通过
- [ ] Verify in browser using dev-browser skill

---

## 4. Functional Requirements

- FR-1: 项目完全移除 `roughjs` 依赖，所有相关 import 和调用已清除
- FR-2: `SceneElement` 接口中不再包含 `roughness`、`seed` 等 Rough.js 专属属性
- FR-3: 渲染函数（如 `drawElement`）对所有图形类型使用原生 Canvas 2D API（`strokeRect`, `fillRect`, `beginPath`, `moveTo`, `lineTo`, `closePath`, `stroke`, `fill`）
- FR-4: Interactive 层每次重绘前必须执行 `ctx.clearRect(0, 0, canvas.width, canvas.height)`，不得遗漏
- FR-5: `clearRect` 操作仅作用于 Interactive Canvas，不得影响 Static Canvas
- FR-6: 拖拽创建图形时，使用 `Math.min(start, current)` 计算起始坐标，使用 `Math.abs(current - start)` 计算宽高
- FR-7: 图形控制点（Handles）基于标准数学 Bounding Box 定位，不再依赖 Rough.js 的松散包围盒
- FR-8: Resize 逻辑根据控制点位置，将鼠标 delta 映射到对应的 `x, y, width, height` 更新
- FR-9: 图形最小宽高限制为 1 像素，阻止拉伸越过中轴线的翻转行为

---

## 5. Non-Goals (Out of Scope)

- 不引入任何新的手绘风格或草图效果替代方案
- 不改变现有的 Scene 数据结构和分层 Canvas 架构
- 不新增图形类型（仅修复已有图形的渲染和交互）
- 不引入 Undo/Redo 功能的变更
- 不修改现有的工具栏 UI 或工具切换逻辑
- 不处理图形导出、序列化或持久化的变更
- 不引入图形旋转功能

---

## 6. Design Considerations

- 所有图形采用标准矢量几何样式，视觉上应保持简洁、精确、专业
- 控制点（Handles）样式沿用现有实现，但定位逻辑应基于精确的数学 Bounding Box
- 线条颜色、填充颜色、线宽等样式保持与现有设计一致
- 无 Rough.js 后，图形渲染性能应显著提升，尤其在高图形数量场景下

---

## 7. Technical Considerations

- **移除依赖:** `npm uninstall roughjs` 或 `pnpm remove roughjs`，确保 `package-lock.json` 同步更新
- **渲染层分离:** Static Canvas 存放已提交的持久图形，Interactive Canvas 仅渲染当前正在绘制/编辑的 Draft 元素，两者生命周期严格隔离
- **坐标系统:** 所有图形使用标准左上角 `(x, y)` + `width` + `height` 的矩形表示法，确保与 Canvas 2D API 一致
- **Resize 数学模型:** 对于每个控制点方向，维护一个映射表：deltaX/deltaY 如何影响 `x, y, width, height`
- **已知限制:** v2.1.2 不支持图形越过中轴线的翻转拉伸，宽高最小值为 1px

---

## 8. Success Metrics

- 绘制图形时零拖尾残影，用户肉眼不可见任何历史帧残留
- 向 8 个方向（上、下、左、右、左上、左下、右上、右下）拖拽均可正常绘制
- 选中图形后，拖拽任意控制点可平滑调整尺寸，无跳动或计算错误
- 移除 Rough.js 后，bundle 体积减少约 X KB（安装后可量化）
- 高图形数量场景下（如 100+ 个图形），画布交互帧率保持 60fps

---

## 9. Open Questions

- 是否需要为不同图形类型（矩形、菱形、线条、箭头）分别设置不同的默认描边颜色或线宽？
- 控制点（Handles）的最小尺寸是否需要在高 DPI 屏幕上做适配？
- Resize 越过中轴线的翻转行为是否需要在后续版本（v2.2+）中支持？
- 是否有其他图形类型（如圆形、椭圆、多边形）需要在本期中一并适配原生 Canvas 2D 渲染？
