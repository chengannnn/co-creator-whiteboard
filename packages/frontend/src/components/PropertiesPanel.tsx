import { Shape, ShapeStyle, StrokeWidth, StrokeStyle, FillStyle } from '../types/shapes';

const PRESET_COLORS = [
  '#000000',
  '#ffffff',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

interface PropertiesPanelProps {
  selectedShape: Shape | null;
  onStyleChange: (style: ShapeStyle) => void;
  defaultStyle: ShapeStyle;
}

export default function PropertiesPanel({ selectedShape, onStyleChange, defaultStyle }: PropertiesPanelProps) {
  const style = selectedShape?.style ?? defaultStyle;

  const updateStyle = (updates: Partial<ShapeStyle>) => {
    onStyleChange({ ...style, ...updates });
  };

  const sectionStyle: React.CSSProperties = {
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: '8px',
    marginBottom: '8px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '4px',
  };

  if (!selectedShape) {
    return (
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: '200px',
          padding: '16px',
          backgroundColor: '#ffffff',
          borderLeft: '1px solid #e0e0e0',
          boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.05)',
          zIndex: 10,
          color: '#9ca3af',
          fontSize: '13px',
          textAlign: 'center',
        }}
      >
        Select a shape to edit properties
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        width: '200px',
        padding: '16px',
        backgroundColor: '#ffffff',
        borderLeft: '1px solid #e0e0e0',
        boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.05)',
        zIndex: 10,
        fontSize: '13px',
        color: '#374151',
      }}
    >
      {/* Stroke Color */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Stroke Color</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => updateStyle({ strokeColor: color })}
              style={{
                width: '24px',
                height: '24px',
                border: style.strokeColor === color ? '2px solid #3b82f6' : '1px solid #d1d5db',
                borderRadius: '4px',
                backgroundColor: color,
                cursor: 'pointer',
                padding: 0,
              }}
              title={color}
            />
          ))}
          <label
            style={{
              width: '24px',
              height: '24px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#6b7280',
            }}
            title="Custom color"
          >
            +
            <input
              type="color"
              value={style.strokeColor}
              onChange={(e) => updateStyle({ strokeColor: e.target.value })}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      {/* Fill Color */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Fill Color</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => updateStyle({ fillColor: color })}
              style={{
                width: '24px',
                height: '24px',
                border: style.fillColor === color ? '2px solid #3b82f6' : '1px solid #d1d5db',
                borderRadius: '4px',
                backgroundColor: color,
                cursor: 'pointer',
                padding: 0,
              }}
              title={color}
            />
          ))}
          <label
            style={{
              width: '24px',
              height: '24px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#6b7280',
            }}
            title="Custom color"
          >
            +
            <input
              type="color"
              value={style.fillColor}
              onChange={(e) => updateStyle({ fillColor: e.target.value })}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      {/* Stroke Width */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Stroke Width</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {([1, 2, 4] as StrokeWidth[]).map((width) => (
            <button
              key={width}
              onClick={() => updateStyle({ strokeWidth: width })}
              style={{
                flex: 1,
                padding: '6px 0',
                border: style.strokeWidth === width ? '2px solid #3b82f6' : '1px solid #d1d5db',
                borderRadius: '4px',
                backgroundColor: style.strokeWidth === width ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={`${width}px`}
            >
              <div
                style={{
                  width: '20px',
                  height: `${width}px`,
                  backgroundColor: '#374151',
                  borderRadius: '1px',
                }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Stroke Style */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Stroke Style</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['solid', 'dashed'] as StrokeStyle[]).map((s) => (
            <button
              key={s}
              onClick={() => updateStyle({ strokeStyle: s })}
              style={{
                flex: 1,
                padding: '6px 0',
                border: style.strokeStyle === s ? '2px solid #3b82f6' : '1px solid #d1d5db',
                borderRadius: '4px',
                backgroundColor: style.strokeStyle === s ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                fontSize: '12px',
                textTransform: 'capitalize',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Fill Style */}
      <div>
        <div style={labelStyle}>Fill</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['none', 'solid', 'hatch'] as FillStyle[]).map((f) => (
            <button
              key={f}
              onClick={() => updateStyle({ fillStyle: f })}
              style={{
                flex: 1,
                padding: '6px 0',
                border: style.fillStyle === f ? '2px solid #3b82f6' : '1px solid #d1d5db',
                borderRadius: '4px',
                backgroundColor: style.fillStyle === f ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                fontSize: '12px',
                textTransform: 'capitalize',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
