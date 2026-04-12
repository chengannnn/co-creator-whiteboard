import { useState } from 'react';
import { ToolType } from '../types/shapes';

const TOOLS: { id: ToolType; label: string; icon: string; shortcut: string }[] = [
  { id: 'select', label: 'Select', icon: '◇', shortcut: 'V' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭', shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: '○', shortcut: 'O' },
  { id: 'freehand', label: 'Pencil', icon: '✏', shortcut: 'P' },
  { id: 'text', label: 'Text', icon: 'T', shortcut: 'T' },
];

interface ToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
}

export default function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  const [minimized, setMinimized] = useState(false);

  return (
    <div
      style={{
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: minimized ? '6px 10px' : '8px 12px',
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        borderRadius: '10px',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
        zIndex: 10,
        backdropFilter: 'blur(8px)',
        transition: 'all 0.2s ease',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Minimize toggle */}
      <button
        title={minimized ? 'Expand toolbar' : 'Minimize toolbar'}
        onClick={() => setMinimized(!minimized)}
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          backgroundColor: '#ffffff',
          cursor: 'pointer',
          fontSize: '14px',
          color: '#6b7280',
          flexShrink: 0,
        }}
      >
        {minimized ? '▸' : '▾'}
      </button>

      {!minimized && (
        <>
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              title={`${tool.label} (${tool.shortcut})`}
              onClick={(e) => {
                e.stopPropagation();
                onToolChange(tool.id);
              }}
              style={{
                width: '40px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: activeTool === tool.id ? '2px solid #3b82f6' : '1px solid transparent',
                borderRadius: '6px',
                backgroundColor: activeTool === tool.id ? '#eff6ff' : 'transparent',
                cursor: 'pointer',
                fontSize: '16px',
                color: '#374151',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (activeTool !== tool.id) {
                  (e.target as HTMLElement).style.backgroundColor = '#f3f4f6';
                }
              }}
              onMouseLeave={(e) => {
                if (activeTool !== tool.id) {
                  (e.target as HTMLElement).style.backgroundColor = 'transparent';
                }
              }}
            >
              {tool.icon}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
