import { ShapeStyle } from '../types/shapes';
import { theme } from '../theme';

const STROKE_COLORS = [
  '#000000', // black
  '#e03131', // red
  '#1c7ed6', // blue
  '#2f9e44', // green
  '#6741d9', // purple
  '#e8590c', // orange
  '#a0522d', // brown
  '#868e96', // gray
];

interface PropertiesPanelProps {
  style: ShapeStyle;
  onStyleChange: (style: ShapeStyle) => void;
}

export default function PropertiesPanel({ style, onStyleChange }: PropertiesPanelProps) {
  const updateStyle = (patch: Partial<ShapeStyle>) => {
    onStyleChange({ ...style, ...patch });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '62px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 14px',
        backgroundColor: theme.panelBg,
        borderRadius: '10px',
        boxShadow: `0 2px 12px ${theme.panelShadow}`,
        zIndex: 10,
        backdropFilter: 'blur(8px)',
        transition: 'all 0.2s ease',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Stroke Color */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', color: theme.textMuted, lineHeight: 1 }}>Stroke</span>
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {STROKE_COLORS.map((color) => (
            <button
              key={color}
              title={color}
              onClick={() => updateStyle({ strokeColor: color })}
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '4px',
                backgroundColor: color,
                border:
                  style.strokeColor === color
                    ? `2px solid ${theme.btnActiveBorder}`
                    : '1px solid rgba(0,0,0,0.12)',
                cursor: 'pointer',
                padding: 0,
                transition: 'all 0.15s ease',
              }}
            />
          ))}
          <label
            title="Custom stroke color"
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '4px',
              border: `1px solid ${theme.btnBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '12px',
              color: theme.textMuted,
              backgroundColor: theme.btnHoverBg,
            }}
          >
            +
            <input
              type="color"
              value={style.strokeColor}
              onChange={(e) => updateStyle({ strokeColor: e.target.value })}
              style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
            />
          </label>
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '32px', backgroundColor: theme.divider }} />

      {/* Stroke Width */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', color: theme.textMuted, lineHeight: 1 }}>Width</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {([1, 2, 4] as const).map((w) => (
            <button
              key={w}
              title={`${w}px`}
              onClick={() => updateStyle({ strokeWidth: w })}
              style={{
                width: '28px',
                height: '22px',
                borderRadius: '4px',
                border:
                  style.strokeWidth === w
                    ? `2px solid ${theme.btnActiveBorder}`
                    : `1px solid ${theme.btnBorder}`,
                backgroundColor: style.strokeWidth === w ? theme.btnActiveBg : theme.btnDefaultBg,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
            >
              <div
                style={{
                  width: '16px',
                  height: `${w}px`,
                  backgroundColor: theme.textPrimary,
                  borderRadius: '1px',
                }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '32px', backgroundColor: theme.divider }} />

      {/* Stroke Style */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', color: theme.textMuted, lineHeight: 1 }}>Style</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['solid', 'dashed'] as const).map((s) => (
            <button
              key={s}
              title={s === 'solid' ? 'Solid line' : 'Dashed line'}
              onClick={() => updateStyle({ strokeStyle: s })}
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
  );
}
