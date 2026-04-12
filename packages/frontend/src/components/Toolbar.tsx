import { ToolType, FillStyle } from '../types/shapes';
import { theme } from '../theme';

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

interface ToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onFillStyleChange?: (fill: FillStyle) => void;
  onColorChange?: (color: string) => void;
  unifiedColor?: string;
  onClearCanvas?: () => void;
  onImageInsert?: (dataUrl: string) => void;
}

export default function Toolbar({ activeTool, onToolChange, onFillStyleChange, onColorChange, unifiedColor, onClearCanvas, onImageInsert }: ToolbarProps) {
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
          onImageInsert?.(ev.target.result);
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
                onFillStyleChange?.(tool.fillStyle);
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
        {onImageInsert && (
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
        )}

        {/* Clear Canvas button */}
        {onClearCanvas && (
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
        )}
      </div>

      {/* Row 2: Unified Color Picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '0 4px 4px' }}>
        {UNIFIED_COLORS.map((color) => (
          <button
            key={color}
            title={color}
            onClick={(e) => {
              e.stopPropagation();
              onColorChange?.(color);
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
              onColorChange?.(e.target.value);
            }}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
        </label>
      </div>
    </div>
  );
}
