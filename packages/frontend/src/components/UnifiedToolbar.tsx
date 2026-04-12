import { ToolType, FillStyle, StrokeWidth, StrokeStyle } from '../types/shapes';
import { theme } from '../theme';

// Map strokeWidth values to eraser radius sizes
const ERASER_RADIUS_MAP: Record<number, number> = { 1: 10, 2: 20, 4: 40 };

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
  icon: string;
  shortcut: string;
  fillStyle?: FillStyle;
};

const TOOLS: ShapeTool[] = [
  { id: 'select', label: 'Select', icon: '◇', shortcut: 'V' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭', shortcut: 'R', fillStyle: 'none' },
  { id: 'rectangle-solid', label: 'Rectangle', icon: '▮', shortcut: 'R', fillStyle: 'solid' },
  { id: 'ellipse', label: 'Ellipse', icon: '○', shortcut: 'O', fillStyle: 'none' },
  { id: 'ellipse-solid', label: 'Ellipse', icon: '●', shortcut: 'O', fillStyle: 'solid' },
  { id: 'rhombus', label: 'Rhombus', icon: '◇', shortcut: 'D', fillStyle: 'none' },
  { id: 'rhombus-solid', label: 'Rhombus', icon: '◆', shortcut: 'D', fillStyle: 'solid' },
  { id: 'line', label: 'Line', icon: '╱', shortcut: 'L' },
  { id: 'arrow', label: 'Arrow', icon: '→', shortcut: 'A' },
  { id: 'freehand', label: 'Pencil', icon: '✏', shortcut: 'P' },
  { id: 'eraser', label: 'Eraser', icon: '◻', shortcut: 'X' },
];

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
}: UnifiedToolbarProps) {
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
        top: '12px',
        left: '50%',
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
        transition: 'all 0.2s ease',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Row 1: Tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
            {tool.icon}
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

        {/* Clear Canvas button */}
        <button
          title="Clear Canvas"
          onClick={(e) => {
            e.stopPropagation();
            onClearCanvas();
          }}
          style={{
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid transparent',
            borderRadius: '6px',
            backgroundColor: theme.btnDefaultBg,
            cursor: 'pointer',
            fontSize: '16px',
            color: theme.textSecondary,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#fee2e2';
            (e.target as HTMLElement).style.color = '#dc2626';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = theme.btnDefaultBg;
            (e.target as HTMLElement).style.color = theme.textSecondary;
          }}
        >
          🗑
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
      </div>
    </div>
  );
}
