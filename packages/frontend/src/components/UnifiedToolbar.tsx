import { useState, useRef, useCallback, useEffect } from 'react';
import type { ToolType, FillStyle, StrokeWidth, StrokeStyle, SceneElement } from '../types/element';
import { getThemeColors, type ThemeMode } from '../theme';

// Map strokeWidth values to eraser radius sizes
const ERASER_RADIUS_MAP: Record<number, number> = { 1: 10, 2: 20, 4: 40 };

/** SVG icon for selection tool (standard cursor pointer). */
const SelectIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
  </svg>
);

/** SVG icon for eraser tool (tilted classic eraser). */
const EraserIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.8 1.4c.8-.8 2-.8 2.8 0l5 5c.8.8.8 2 0 2.8L11 20" />
    <line x1="6" y1="16" x2="18" y2="4" />
  </svg>
);

/** SVG icon for group/ungroup (merged square with dots at four corners). */
const GroupIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    <circle cx="17" cy="7" r="1.5" fill="currentColor" />
    <circle cx="7" cy="17" r="1.5" fill="currentColor" />
    <circle cx="17" cy="17" r="1.5" fill="currentColor" />
  </svg>
);

/** SVG icon for Bring to Front — upward arrow with horizontal line above it (top barrier). */
const BringToFrontIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="5" x2="20" y2="5" />
    <polyline points="12 19 12 9" />
    <polyline points="8 13 12 9 16 13" />
  </svg>
);

/** SVG icon for Send to Back — downward arrow with horizontal line below it (bottom barrier). */
const SendToBackIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="12 5 12 15" />
    <polyline points="8 11 12 15 16 11" />
    <line x1="4" y1="19" x2="20" y2="19" />
  </svg>
);

/** SVG icon for Bring Forward — simple upward arrow. */
const BringForwardIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="8 9 12 5 16 9" />
    <line x1="12" y1="5" x2="12" y2="19" />
  </svg>
);

/** SVG icon for Send Backward — simple downward arrow. */
const SendBackwardIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="8 15 12 19 16 15" />
    <line x1="12" y1="5" x2="12" y2="19" />
  </svg>
);

/** SVG icon for Sharp Corner — rectangle with sharp 90-degree corners. */
const SharpCornerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="5" width="14" height="14" />
  </svg>
);

const UNIFIED_COLORS = [
  '#000000', // black
  '#e03131', // red
  '#1c7ed6', // blue
  '#2f9e44', // green
  '#6741d9', // purple
  '#e8590c', // orange
  '#a0522d', // brown
  '#868e96', // gray
  '#e84393', // pink
  '#00cec9', // cyan
];

type ShapeTool = {
  id: ToolType;
  label: string;
  icon: string | React.FC;
  shortcut: string;
  fillStyle?: FillStyle;
};

const TOOLS: ShapeTool[] = [
  { id: 'rectangle', label: 'Rectangle', icon: '▭', shortcut: 'R', fillStyle: 'none' },
  { id: 'rectangle-solid', label: 'Rectangle', icon: '▮', shortcut: 'R', fillStyle: 'solid' },
  { id: 'ellipse', label: 'Ellipse', icon: '○', shortcut: 'O', fillStyle: 'none' },
  { id: 'ellipse-solid', label: 'Ellipse', icon: '●', shortcut: 'O', fillStyle: 'solid' },
  { id: 'rhombus', label: 'Rhombus', icon: '◇', shortcut: 'D', fillStyle: 'none' },
  { id: 'rhombus-solid', label: 'Rhombus', icon: '◆', shortcut: 'D', fillStyle: 'solid' },
  { id: 'line', label: 'Line', icon: '╱', shortcut: 'L' },
  { id: 'arrow', label: 'Arrow', icon: '→', shortcut: 'A' },
  { id: 'freehand', label: 'Pencil', icon: '✏', shortcut: 'P' },
  { id: 'eraser', label: 'Eraser', icon: EraserIcon, shortcut: 'X' },
];

/** Check if all given elements share at least one common groupId. */
function areElementsInSameGroup(elements: SceneElement[]): boolean {
  if (elements.length < 2) return false;
  const firstGroupIds = elements[0]?.groupIds ?? [];
  if (firstGroupIds.length === 0) return false;
  return firstGroupIds.some((gid) =>
    elements.every((el) => el.groupIds.includes(gid)),
  );
}

/** Get the shared groupId if all selected elements belong to the same group. */
function getSharedGroupId(elements: SceneElement[]): string | null {
  if (elements.length === 0) return null;
  const firstGroupIds = elements[0]?.groupIds ?? [];
  if (firstGroupIds.length === 0) return null;
  const shared = firstGroupIds.find((gid) =>
    elements.every((el) => el.groupIds.includes(gid)),
  );
  return shared ?? null;
}

interface UnifiedToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onFillStyleChange: (fill: FillStyle) => void;
  onColorChange: (color: string) => void;
  unifiedColor: string;
  onClearCanvas: () => void;
  onImageInsert: (dataUrl: string) => void;
  style: {
    strokeWidth: StrokeWidth;
    strokeStyle: StrokeStyle;
  };
  onStyleChange: (style: { strokeWidth?: StrokeWidth; strokeStyle?: StrokeStyle }) => void;
  eraserRadius: number;
  onEraserRadiusChange: (radius: number) => void;
  locked: boolean;
  onLockChange: (locked: boolean) => void;
  onSave: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  isRoundCornerEnabled: boolean;
  onRoundCornerToggle: () => void;
  isSharpCornerEnabled: boolean;
  onSharpCornerToggle: () => void;
  selectedElements: SceneElement[];
  onGroup: () => void;
  onUngroup: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  allElements: SceneElement[];
}

export default function UnifiedToolbar({
  activeTool,
  onToolChange,
  onFillStyleChange,
  onColorChange,
  unifiedColor,
  onClearCanvas,
  onImageInsert,
  style,
  onStyleChange,
  eraserRadius,
  onEraserRadiusChange,
  locked,
  onLockChange,
  onSave,
  themeMode,
  onThemeChange,
  isRoundCornerEnabled,
  onRoundCornerToggle,
  isSharpCornerEnabled,
  onSharpCornerToggle,
  selectedElements,
  onGroup,
  onUngroup,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  allElements,
}: UnifiedToolbarProps) {
  const theme = getThemeColors(themeMode);
  const canRoundCorner = activeTool === 'rectangle' || activeTool === 'rectangle-solid' || activeTool === 'rhombus' || activeTool === 'rhombus-solid';

  // Group/Ungroup state machine
  const groupAction = selectedElements.length >= 2 && !areElementsInSameGroup(selectedElements)
    ? 'group'
    : selectedElements.length > 0 && getSharedGroupId(selectedElements)
      ? 'ungroup'
      : null;
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; toolbarX: number; toolbarY: number } | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      toolbarX: toolbarPos.x,
      toolbarY: toolbarPos.y,
    };
  }, [toolbarPos]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setToolbarPos({
        x: dragStart.current.toolbarX + dx,
        y: dragStart.current.toolbarY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStart.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleImageClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result && typeof ev.target.result === 'string') {
          onImageInsert(ev.target.result);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: `${12 + toolbarPos.y}px`,
        left: `calc(50% + ${toolbarPos.x}px)`,
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px 12px',
        backgroundColor: theme.panelBg,
        borderRadius: '12px',
        boxShadow: `0 2px 16px ${theme.panelShadow}`,
        zIndex: 10,
        backdropFilter: 'blur(8px)',
        transition: isDragging ? 'none' : 'all 0.2s ease',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { if (!isDragging) setIsHovered(false); }}
    >
      {/* Row 1: Tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {/* Drag handle */}
        <div
          onMouseDown={handleDragStart}
          style={{
            width: '32px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isDragging ? 'grabbing' : 'grab',
            fontSize: '14px',
            color: isDragging || isHovered ? theme.textPrimary : theme.textMuted,
            transition: 'color 0.15s ease',
            borderRadius: '6px',
            flexShrink: 0,
          }}
          title="Drag to move toolbar"
        >
          ⠿
        </div>

        {/* Lock toggle */}
        <button
          title={locked ? 'Unlock canvas' : 'Lock canvas'}
          onClick={(e) => {
            e.stopPropagation();
            onLockChange(!locked);
          }}
          style={{
            width: '32px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid transparent',
            borderRadius: '6px',
            backgroundColor: locked ? theme.btnActiveBg : theme.btnDefaultBg,
            cursor: 'pointer',
            fontSize: '14px',
            color: theme.textPrimary,
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = locked ? theme.btnActiveBg : theme.btnDefaultBg;
          }}
        >
          {locked ? '🔒' : '🔓'}
        </button>

        {/* Selection tool — immediately after lock toggle */}
        <button
          title="Select (V)"
          onClick={(e) => {
            e.stopPropagation();
            onToolChange('select');
          }}
          style={{
            width: '32px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: activeTool === 'select' ? `2px solid ${theme.btnActiveBorder}` : '1px solid transparent',
            borderRadius: '6px',
            backgroundColor: activeTool === 'select' ? theme.btnActiveBg : theme.btnDefaultBg,
            cursor: 'pointer',
            color: theme.textPrimary,
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'select') {
              (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = activeTool === 'select' ? theme.btnActiveBg : theme.btnDefaultBg;
          }}
        >
          <SelectIcon />
        </button>

        {/* Divider after lock/select controls, separating from drawing tools */}
        <div
          style={{
            width: '1px',
            height: '24px',
            backgroundColor: theme.divider,
            margin: '0 2px',
            flexShrink: 0,
          }}
        />

        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            title={`${tool.label} (${tool.shortcut})`}
            onClick={(e) => {
              e.stopPropagation();
              if (tool.fillStyle !== undefined) {
                onFillStyleChange(tool.fillStyle);
              }
              onToolChange(tool.id);
            }}
            style={{
              width: '40px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: activeTool === tool.id ? `2px solid ${theme.btnActiveBorder}` : '1px solid transparent',
              borderRadius: '6px',
              backgroundColor: activeTool === tool.id ? theme.btnActiveBg : theme.btnDefaultBg,
              cursor: 'pointer',
              fontSize: '16px',
              color: theme.textPrimary,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (activeTool !== tool.id) {
                (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
              }
            }}
            onMouseLeave={(e) => {
              if (activeTool !== tool.id) {
                (e.target as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
              }
            }}
          >
            {typeof tool.icon === 'function' ? <tool.icon /> : tool.icon}
          </button>
        ))}

        {/* Divider */}
        <div
          style={{
            width: '1px',
            height: '24px',
            backgroundColor: theme.divider,
            margin: '0 4px',
          }}
        />

        {/* Image button */}
        <button
          title="Insert Image (I)"
          onClick={(e) => {
            e.stopPropagation();
            handleImageClick();
          }}
          style={{
            width: '40px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid transparent',
            borderRadius: '6px',
            backgroundColor: theme.btnDefaultBg,
            cursor: 'pointer',
            fontSize: '16px',
            color: theme.textPrimary,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
          }}
        >
          🖼
        </button>

        {/* Sharp Corner button — immediately to the left of Round Corner */}
        <button
          title="Sharp Corner"
          disabled={!canRoundCorner}
          onClick={(e) => {
            e.stopPropagation();
            if (canRoundCorner) {
              onSharpCornerToggle();
            }
          }}
          style={{
            width: '40px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: canRoundCorner && isSharpCornerEnabled
              ? `2px solid ${theme.btnActiveBorder}`
              : '1px solid transparent',
            borderRadius: '6px',
            backgroundColor: canRoundCorner && isSharpCornerEnabled ? theme.btnActiveBg : theme.btnDefaultBg,
            cursor: canRoundCorner ? 'pointer' : 'not-allowed',
            color: canRoundCorner ? theme.textPrimary : theme.textMuted,
            opacity: canRoundCorner ? 1 : 0.4,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (canRoundCorner && !isSharpCornerEnabled) {
              (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = canRoundCorner && isSharpCornerEnabled
              ? theme.btnActiveBg
              : theme.btnDefaultBg;
          }}
        >
          <SharpCornerIcon />
        </button>

        {/* Round Corner button — rightmost of row 1 */}
        <button
          title="Round Corner"
          disabled={!canRoundCorner}
          onClick={(e) => {
            e.stopPropagation();
            if (canRoundCorner) {
              onRoundCornerToggle();
            }
          }}
          style={{
            width: '40px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: canRoundCorner && isRoundCornerEnabled
              ? `2px solid ${theme.btnActiveBorder}`
              : '1px solid transparent',
            borderRadius: '6px',
            backgroundColor: canRoundCorner && isRoundCornerEnabled ? theme.btnActiveBg : theme.btnDefaultBg,
            cursor: canRoundCorner ? 'pointer' : 'not-allowed',
            color: canRoundCorner ? theme.textPrimary : theme.textMuted,
            opacity: canRoundCorner ? 1 : 0.4,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (canRoundCorner && !isRoundCornerEnabled) {
              (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = canRoundCorner && isRoundCornerEnabled
              ? theme.btnActiveBg
              : theme.btnDefaultBg;
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12a8 8 0 0 1 8-8" />
          </svg>
        </button>

        {/* Group/Ungroup button — rightmost of row 1 */}
        <button
          title={groupAction === 'ungroup' ? 'Ungroup' : groupAction === 'group' ? 'Group' : 'Group/Ungroup'}
          disabled={!groupAction}
          onClick={(e) => {
            e.stopPropagation();
            if (groupAction === 'group') {
              onGroup();
            } else if (groupAction === 'ungroup') {
              onUngroup();
            }
          }}
          style={{
            width: '40px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: groupAction === 'ungroup'
              ? `2px solid ${theme.btnActiveBorder}`
              : '1px solid transparent',
            borderRadius: '6px',
            backgroundColor: groupAction ? theme.btnDefaultBg : theme.btnDefaultBg,
            cursor: groupAction ? 'pointer' : 'not-allowed',
            color: groupAction ? theme.textPrimary : theme.textMuted,
            opacity: groupAction ? 1 : 0.4,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (groupAction) {
              (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = groupAction === 'ungroup'
              ? theme.btnActiveBg
              : theme.btnDefaultBg;
          }}
        >
          <GroupIcon />
        </button>
      </div>

      {/* Row 2: Colors — Width — Style */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 4px 4px' }}>
        {/* Color buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          {UNIFIED_COLORS.map((color) => (
            <button
              key={color}
              title={color}
              onClick={(e) => {
                e.stopPropagation();
                onColorChange(color);
              }}
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                backgroundColor: color,
                border:
                  unifiedColor === color
                    ? `2px solid ${theme.btnActiveBorder}`
                    : '1px solid rgba(0,0,0,0.12)',
                cursor: 'pointer',
                padding: 0,
                transition: 'all 0.15s ease',
              }}
            />
          ))}
          {/* Custom color picker */}
          <label
            title="Custom color"
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              border: `1px solid ${theme.btnBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
              color: theme.textMuted,
              backgroundColor: theme.btnHoverBg,
            }}
          >
            +
            <input
              type="color"
              value={unifiedColor ?? '#000000'}
              onChange={(e) => {
                e.stopPropagation();
                onColorChange(e.target.value);
              }}
              style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
            />
          </label>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', backgroundColor: theme.divider }} />

        {/* Stroke Width / Eraser Size */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <span style={{ fontSize: '9px', color: theme.textMuted, lineHeight: 1 }}>
            {activeTool === 'eraser' ? 'Size' : 'Width'}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {([1, 2, 4] as const).map((w) => {
              const isEraser = activeTool === 'eraser';
              const isActive = isEraser
                ? eraserRadius === ERASER_RADIUS_MAP[w]
                : style.strokeWidth === w;
              return (
                <button
                  key={w}
                  title={isEraser ? `${ERASER_RADIUS_MAP[w]}px` : `${w}px`}
                  onClick={() => {
                    if (isEraser) {
                      onEraserRadiusChange(ERASER_RADIUS_MAP[w]);
                    } else {
                      onStyleChange({ strokeWidth: w });
                    }
                  }}
                  style={{
                    width: '28px',
                    height: '22px',
                    borderRadius: '4px',
                    border: isActive
                      ? `2px solid ${theme.btnActiveBorder}`
                      : `1px solid ${theme.btnBorder}`,
                    backgroundColor: isActive ? theme.btnActiveBg : theme.btnDefaultBg,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isEraser ? (
                    <div
                      style={{
                        width: `${ERASER_RADIUS_MAP[w] / 2}px`,
                        height: `${ERASER_RADIUS_MAP[w] / 2}px`,
                        backgroundColor: theme.textPrimary,
                        borderRadius: '50%',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '16px',
                        height: `${w}px`,
                        backgroundColor: theme.textPrimary,
                        borderRadius: '1px',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', backgroundColor: theme.divider }} />

        {/* Stroke Style */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <span style={{ fontSize: '9px', color: theme.textMuted, lineHeight: 1 }}>Style</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['solid', 'dashed'] as const).map((s) => (
              <button
                key={s}
                title={s === 'solid' ? 'Solid line' : 'Dashed line'}
                onClick={() => onStyleChange({ strokeStyle: s })}
                style={{
                  width: '32px',
                  height: '22px',
                  borderRadius: '4px',
                  border:
                    style.strokeStyle === s
                      ? `2px solid ${theme.btnActiveBorder}`
                      : `1px solid ${theme.btnBorder}`,
                  backgroundColor: style.strokeStyle === s ? theme.btnActiveBg : theme.btnDefaultBg,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                {s === 'dashed' ? (
                  <div
                    style={{
                      width: '20px',
                      height: '2px',
                      background: `repeating-linear-gradient(90deg, ${theme.textPrimary} 0, ${theme.textPrimary} 4px, transparent 4px, transparent 7px)`,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '20px',
                      height: '2px',
                      backgroundColor: theme.textPrimary,
                      borderRadius: '1px',
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', backgroundColor: theme.divider }} />

        {/* Layer management section */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <span style={{ fontSize: '9px', color: theme.textMuted, lineHeight: 1 }}>Layer</span>
          <div style={{ display: 'flex', gap: '2px' }}>
            {(() => {
              const isSingleElement = selectedElements.length === 1;
              const isGrouped = selectedElements.length === 1 && selectedElements[0].groupIds.length > 0;
              const canOperate = isSingleElement && !isGrouped;

              // Find the selected element's index in the allElements array
              const selectedIndex = canOperate
                ? allElements.findIndex((el) => el.id === selectedElements[0].id)
                : -1;

              const isFirst = selectedIndex === 0;
              const isLast = selectedIndex === allElements.length - 1;

              const layerButtonStyle = (
                disabled: boolean,
                isActive: boolean,
              ): React.CSSProperties => ({
                width: '24px',
                height: '22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: isActive ? `2px solid ${theme.btnActiveBorder}` : '1px solid transparent',
                borderRadius: '4px',
                backgroundColor: isActive ? theme.btnActiveBg : theme.btnDefaultBg,
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: disabled ? theme.textMuted : theme.textPrimary,
                opacity: disabled ? 0.4 : 1,
                transition: 'all 0.15s ease',
                padding: 0,
              });

              return (
                <>
                  {/* Bring Forward */}
                  <button
                    title="Bring Forward"
                    disabled={!canOperate || isLast}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canOperate) onBringForward();
                    }}
                    style={layerButtonStyle(!canOperate || isLast, false)}
                    onMouseEnter={(e) => {
                      if (canOperate && !isLast) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = theme.btnHoverBg;
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
                    }}
                  >
                    <BringForwardIcon />
                  </button>
                  {/* Send Backward */}
                  <button
                    title="Send Backward"
                    disabled={!canOperate || isFirst}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canOperate) onSendBackward();
                    }}
                    style={layerButtonStyle(!canOperate || isFirst, false)}
                    onMouseEnter={(e) => {
                      if (canOperate && !isFirst) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = theme.btnHoverBg;
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
                    }}
                  >
                    <SendBackwardIcon />
                  </button>
                  {/* Bring to Front */}
                  <button
                    title="Bring to Front"
                    disabled={!canOperate || isLast}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canOperate) onBringToFront();
                    }}
                    style={layerButtonStyle(!canOperate || isLast, false)}
                    onMouseEnter={(e) => {
                      if (canOperate && !isLast) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = theme.btnHoverBg;
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
                    }}
                  >
                    <BringToFrontIcon />
                  </button>
                  {/* Send to Back */}
                  <button
                    title="Send to Back"
                    disabled={!canOperate || isFirst}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canOperate) onSendToBack();
                    }}
                    style={layerButtonStyle(!canOperate || isFirst, false)}
                    onMouseEnter={(e) => {
                      if (canOperate && !isFirst) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = theme.btnHoverBg;
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
                    }}
                  >
                    <SendToBackIcon />
                  </button>
                </>
              );
            })()}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', backgroundColor: theme.divider }} />

        {/* Save/Export button */}
        <button
          title="Export as PNG"
          onClick={(e) => {
            e.stopPropagation();
            onSave();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            border: `1px solid ${theme.btnBorder}`,
            borderRadius: '4px',
            backgroundColor: theme.btnDefaultBg,
            cursor: 'pointer',
            fontSize: '11px',
            color: theme.textPrimary,
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Save
        </button>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', backgroundColor: theme.divider }} />

        {/* Clear Canvas button */}
        <button
          title="Clear Canvas"
          onClick={(e) => {
            e.stopPropagation();
            onClearCanvas();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '22px',
            border: `1px solid ${theme.btnBorder}`,
            borderRadius: '4px',
            backgroundColor: theme.btnDefaultBg,
            cursor: 'pointer',
            fontSize: '13px',
            color: theme.textSecondary,
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#fee2e2';
            (e.target as HTMLElement).style.color = '#dc2626';
            (e.target as HTMLElement).style.borderColor = '#fca5a5';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
            (e.target as HTMLElement).style.color = theme.textSecondary;
            (e.target as HTMLElement).style.borderColor = theme.btnBorder;
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', backgroundColor: theme.divider }} />

        {/* Theme toggle buttons */}
        {themeMode === 'light' ? (
          <button
            title="Switch to dark mode"
            onClick={(e) => {
              e.stopPropagation();
              onThemeChange('dark');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '22px',
              border: `1px solid ${theme.btnBorder}`,
              borderRadius: '4px',
              backgroundColor: theme.btnDefaultBg,
              cursor: 'pointer',
              color: theme.textSecondary,
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </button>
        ) : (
          <button
            title="Switch to light mode"
            onClick={(e) => {
              e.stopPropagation();
              onThemeChange('light');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '22px',
              border: `1px solid ${theme.btnBorder}`,
              borderRadius: '4px',
              backgroundColor: theme.btnDefaultBg,
              cursor: 'pointer',
              color: '#fbbf24',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = theme.btnHoverBg;
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
