import { useState } from 'react';
import { ToolType } from '../types/shapes';
import { theme } from '../theme';

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
        backgroundColor: theme.panelBg,
        borderRadius: '10px',
        boxShadow: `0 2px 12px ${theme.panelShadow}`,
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
          border: `1px solid ${theme.btnBorder}`,
          borderRadius: '6px',
          backgroundColor: theme.btnHoverBg,
          cursor: 'pointer',
          fontSize: '14px',
          color: theme.textMuted,
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
        </>
      )}
    </div>
  );
}
