import { ToolType } from '../types/shapes';

const TOOLS: { id: ToolType; label: string; icon: string }[] = [
  { id: 'select', label: 'Select', icon: '◇' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', icon: '○' },
  { id: 'freehand', label: 'Pencil', icon: '✏' },
  { id: 'text', label: 'Text', icon: 'T' },
];

interface ToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
}

export default function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px',
        backgroundColor: '#ffffff',
        borderRight: '1px solid #e0e0e0',
        boxShadow: '2px 0 8px rgba(0, 0, 0, 0.05)',
        zIndex: 10,
      }}
    >
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          title={tool.label}
          onClick={() => onToolChange(tool.id)}
          style={{
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: activeTool === tool.id ? '2px solid #3b82f6' : '1px solid #d1d5db',
            borderRadius: '6px',
            backgroundColor: activeTool === tool.id ? '#eff6ff' : '#ffffff',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#374151',
            transition: 'all 0.15s ease',
          }}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
