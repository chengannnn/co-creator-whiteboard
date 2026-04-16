# PRD: v2.1.3 交互精准度提升与高级选择系统

## 1. 迭代背景与目标 (Overview)

在上个版本 (v2.1.2) 中，我们成功剥离了 Rough.js，重归原生 Canvas 2D 渲染，彻底解决了性能拖尾问题。本期 v2.1.3 的核心目标是：**攻克基础交互的"最后一公里"**。

我们将彻底修复坐标系反向拖拽和缩放锚点偏移的致命 Bug，并引入白板应用进阶的标志性功能：**鼠标框选（Marquee Selection）** 与 **对象组合（Grouping）**。

**本期迭代核心目标：**

- 彻底修复反向（向左/向上）拖拽绘制失效的遗留问题
- 修复图形缩放（Resize）失控与偏移的致命 Bug
- 引入鼠标框选（Marquee Selection）机制，支持批量选中
- 引入对象组合/打组（Grouping）功能，含完整的数据结构和 UI

---

## 2. Goals

- 坐标归一化：确保所有图形的 `x, y, width, height` 始终为规范值，宽/高永不为负数
- 精准缩放：拖拽控制点时，锚点锁死，鼠标光标时刻黏贴在控制点上，无相对位移偏差
- 框选：支持在空白处拖拽框选矩形，批量选中相交/包含的图形
- 组合：支持将多个图形打组，选中组内任意元素即选中全组，拖拽组时所有元素同步移动

---

## 3. User Stories

### US-001: 彻底修复反向拖拽绘制失效的遗留问题
**Description:** As a user, I want to draw shapes by dragging in any direction (including left/up), so that shapes never disappear or distort when I drag backwards.

**Acceptance Criteria:**
- [ ] 在 `pointermove`（生成 DraftElement）和 `pointerup`（固化 Element）环节均执行坐标归一化
- [ ] 使用 `Math.min(startX, currentX)` 计算 `x`，`Math.min(startY, currentY)` 计算 `y`
- [ ] 使用 `Math.abs(currentX - startX)` 计算 `width`，`Math.abs(currentY - startY)` 计算 `height`
- [ ] 矩形工具中，鼠标从 (500, 500) 拖拽到 (200, 200) 后松开，画布上留下完美的矩形，不消失不变形
- [ ] 菱形、箭头、线条等其他工具的拖拽绘制也应用相同的归一化逻辑
- [ ] 存入 SceneElement 的 `width` 和 `height` 绝不出现负数
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: 修复图形缩放（Resize）失控与偏移问题
**Description:** As a user, I want the shape edges to follow my cursor precisely when resizing via handles, so that I can accurately adjust shape dimensions.

**Acceptance Criteria:**
- [ ] 使用绝对坐标系计算法，弃用 `width += deltaX` 的相对累加写法
- [ ] 拖拽右下角 (se) 时，左上角 `(x, y)` 完全锁死：`newWidth = mouseX - originX`，`newHeight = mouseY - originY`
- [ ] 拖拽左上角 (nw) 时，右下角 `(x + width, y + height)` 完全锁死，反推新的 `x, y, width, height`
- [ ] 拖拽其他控制点（ne, sw, n, s, e, w）时，对应的对角锚点锁死，按相同绝对坐标法计算
- [ ] 鼠标坐标必须从 Screen 坐标正确转换为 World 坐标（考虑 panX, panY, zoom 等变换）
- [ ] 鼠标光标尖端时刻黏贴在控制点上，无相对位移偏差
- [ ] 强制限制最小 `width` 和 `height` 为 5px，阻止缩放越过中轴线导致的翻转
- [ ] 绘制一个矩形，拖拽右下角控制点向外拉再向内推，左上角完全不动
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: 实现鼠标框选（Marquee Selection）机制
**Description:** As a user, I want to drag a selection rectangle on empty canvas to batch-select multiple shapes, so I can efficiently work with many elements at once.

**Acceptance Criteria:**
- [ ] 仅在选择工具（Selection Tool）模式下生效
- [ ] `pointerdown` 击中空白画布（未命中任何现有图形）时触发框选模式
- [ ] `pointermove` 时在 Interactive Canvas 层绘制半透明蓝色矩形：填充 `rgba(0, 120, 255, 0.1)` + 蓝色虚线边框
- [ ] 框选矩形同样执行坐标归一化（`Math.min`, `Math.abs`）确保宽高为正
- [ ] `pointerup` 时计算框选矩形的 Bounding Box
- [ ] 遍历 Scene 中所有未删除元素，只要元素的 Bounding Box 与框选矩形相交或被完全包含，将其 ID 加入 `AppState.selectedElementIds`
- [ ] `pointerup` 后清空 Interactive Canvas 上的框选矩形
- [ ] 触发 Static Canvas 更新选中高亮状态
- [ ] 画三个分离的图形，从空白处拖拽框选矩形只覆盖其中两个图形的一部分，松开后这两个图形同时被选中
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: 在 SceneElement 中新增 groupIds 属性及相关数据结构
**Description:** As a developer, I need to add a `groupIds` array to the SceneElement interface so that shapes can be grouped and ungrouped.

**Acceptance Criteria:**
- [ ] `SceneElement` 接口新增 `groupIds: string[]` 属性（默认空数组）
- [ ] 现有元素创建逻辑中初始化 `groupIds: []`
- [ ] 序列化/反序列化（WebSocket 同步、持久化）中正确传递 `groupIds` 字段
- [ ] `groupIds` 使用数组结构，为未来多层嵌套组预留能力，当前版本仅使用数组第 0 项
- [ ] Typecheck passes

### US-005: 实现打组（Group）与解组（Ungroup）核心逻辑
**Description:** As a user, I want to group selected shapes together so that selecting one element selects the entire group, and I can move them as a unit.

**Acceptance Criteria:**
- [ ] **打组 (Group)：** 生成唯一 `groupId`（如 `crypto.randomUUID()` 或时间戳+随机），遍历所有当前选中的元素，将 `groupId` 推入它们的 `groupIds` 数组
- [ ] **解组 (Ungroup)：** 当仅选中一个"组对象"时，移除该组所有元素的对应 `groupId`
- [ ] **选中组：** 用户点击组内任意一个元素时，自动找到所有具有相同 `groupId` 的元素，全部加入 `selectedElementIds`
- [ ] **组包围盒：** 组被选中时，计算包围所有组内成员的**最大外包围盒 (Max Bounding Box)**，只画一个大的选中虚线框，不为组内每个元素画独立虚线框
- [ ] **拖拽组：** 拖拽组的选中框时，组内所有元素按相同偏移量（delta）移动，相对位置不改变
- [ ] 框选两个图形，点击组合按钮，取消选中后再次点击其中任意一个图形，即可同时选中两个
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: 实现组合/解组的 UI 按钮与状态机
**Description:** As a user, I want a Group button in the toolbar that intelligently enables/disables based on my selection, so I can group and ungroup shapes with a single click.

**Acceptance Criteria:**
- [ ] 在顶部工具栏第一行最右侧（圆角按钮右侧）新增「组合」按钮
- [ ] 图标采用指定 SVG（四个角带点的合并方块）
- [ ] **禁用态（置灰）：** 当选中图形数量 < 2 时，按钮禁用
- [ ] **可用态（正常）：** 当选中图形数量 >= 2 且未处于同一个组时，点击可打组
- [ ] **解组态：** 当仅选中一个"组对象"时，按钮切换为"解组"状态（可更换图标或保持原样但功能变为解组）
- [ ] 按钮状态随 `selectedElementIds` 变化实时更新
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## 4. Functional Requirements

- FR-1: 所有图形创建时（pointermove draft 和 pointerup commit）必须执行坐标归一化：`x = Math.min(start, current)`, `width = Math.abs(current - start)`
- FR-2: SceneElement 中 `width` 和 `height` 字段绝不允许为负数
- FR-3: Resize 使用绝对坐标计算法：锚点锁死，根据鼠标当前 World 坐标直接计算新 `x, y, width, height`
- FR-4: Resize 时鼠标坐标必须正确转换为 World 坐标（考虑 pan/zoom 变换）
- FR-5: 图形最小宽高限制为 5px，阻止越过中轴线的翻转
- FR-6: Selection Tool 模式下，pointerdown 命中空白画布时进入框选模式
- FR-7: 框选矩形使用 `rgba(0, 120, 255, 0.1)` 填充 + 蓝色虚线边框，绘制在 Interactive Canvas 层
- FR-8: 框选命中判定：元素 Bounding Box 与框选矩形相交或包含即视为选中
- FR-9: SceneElement 接口增加 `groupIds: string[]` 字段（默认 `[]`）
- FR-10: 打组时生成唯一 groupId 并推入所有选中元素的 `groupIds`
- FR-11: 点击组内元素时自动展开选中同组所有元素
- FR-12: 组的选中高亮使用最大外包围盒（Max Bounding Box），只画一个大框
- FR-13: 拖拽组时，组内所有元素同步移动相同 delta
- FR-14: 工具栏新增组合按钮，位置在圆角按钮右侧，根据选中状态自动切换禁用/打组/解组三种状态

---

## 5. Non-Goals (Out of Scope)

- 不支持多层嵌套组（`groupIds` 数组预留能力但本期仅使用第 0 项）
- 不支持缩放越过中轴线导致的翻转行为（最小宽高限制 5px）
- 不修改现有的 Undo/Redo 机制（但新增操作需兼容现有 HistoryManager）
- 不引入键盘快捷键（如 Ctrl+G 打组、Ctrl+Shift+G 解组）
- 不处理图形的锁定/解锁逻辑
- 不新增图形类型

---

## 6. Design Considerations

- 框选矩形样式：填充 `rgba(0, 120, 255, 0.1)`，边框为 1px 蓝色虚线 `#0078ff`
- 组合按钮 SVG 图标：四个角带点的合并方块（类似标准设计工具的 group icon）
- 组的选中虚线框沿用现有样式（蓝色虚线），但仅围绕最大外包围盒绘制
- 解组按钮可使用拆分图标（如带箭头的拆分方块）或保持原样
- 所有 UI 交互风格与 v2.1.2 保持一致

---

## 7. Technical Considerations

- **坐标归一化：** 建议封装为共享工具函数 `normalizeBBox(startX, startY, currentX, currentY)`，在 pointermove 和 pointerup 中复用
- **World 坐标转换：** 已有 panX, panY, zoom 等变换逻辑，需确保 resize handler 中正确应用逆变换将 screen 坐标转回 world 坐标
- **Resize 绝对坐标计算：** 为每个控制点方向维护映射表，确定哪个角锁死，哪个角可变。例如：
  - `se`: 锁 `(x, y)`，新 `width = mouseX - x`, `height = mouseY - y`
  - `nw`: 锁 `(x + width, y + height)`，新 `x = mouseX`, `y = mouseY`, `width = oldX + oldWidth - mouseX`, `height = oldY + oldHeight - mouseY`
- **Group 数据结构：** `groupIds: string[]` 是数组，方便未来嵌套，但本期只 `push/1` 个 ID
- **Group 选中展开：** 在 `pointerdown` 的 hit test 逻辑中增加组查找，找到同组元素后批量加入 `selectedElementIds`
- **Group Max Bounding Box：** 遍历组内所有元素，取 `min(x)`, `min(y)`, `max(x + width)`, `max(y + height)` 构建外包围盒
- **历史兼容性：** `groupIds` 为空数组不影响现有未分组的图形

---

## 8. Success Metrics

- 从任意方向拖拽绘制图形，100% 成功显示且不变形
- 缩放图形时，锚点完全固定，鼠标与控制点无可见位移偏差
- 框选三个分离图形中的两个，命中准确率 100%
- 打组后点击组内任意元素即可选中全组，拖拽组时所有元素同步移动
- 无回归：v2.1.2 修复的拖尾、原生渲染、向左拖拽等问题不复发

---

## 9. Open Questions

- 框选时，是否支持按住 Ctrl/Shift 键追加/移除选中元素？（本期可不实现，但需考虑扩展点）
- 组合后，双击进入"组内编辑模式"（可单独移动组内元素）是否需要在后续版本支持？
- 组的选中虚线框的控制点（Handles）是否也需要支持缩放整个组？（本期可暂定不支持，仅支持整体拖拽移动）
- `groupId` 生成策略：使用 `crypto.randomUUID()` 还是自定义的 `group_${Date.now()}_${random}` 格式？
