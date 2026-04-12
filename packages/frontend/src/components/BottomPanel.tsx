import { useState, useEffect } from 'react';

interface BottomPanelProps {
  roomId: string;
  userCount: number;
  wsStatus: 'connected' | 'disconnected' | 'reconnecting';
  scale: number;
}

export default function BottomPanel({ roomId, userCount, wsStatus, scale }: BottomPanelProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const handleShare = async () => {
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
    }
  };

  const statusColor =
    wsStatus === 'connected' ? '#22c55e' : wsStatus === 'reconnecting' ? '#eab308' : '#ef4444';

  return (
    <>
      {/* Reconnecting banner */}
      {wsStatus !== 'connected' && (
        <div
          style={{
            position: 'fixed',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: wsStatus === 'reconnecting' ? '#fef3c7' : '#fecaca',
            borderRadius: '8px',
            padding: '6px 14px',
            zIndex: 20,
            fontSize: '13px',
            fontWeight: 500,
            color: wsStatus === 'reconnecting' ? '#92400e' : '#991b1b',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
          }}
        >
          {wsStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
        </div>
      )}

      {/* Bottom-right floating panel */}
      <div
        style={{
          position: 'fixed',
          bottom: '12px',
          right: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '6px 14px',
          backgroundColor: 'rgba(255, 255, 255, 0.92)',
          borderRadius: '8px',
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
          zIndex: 10,
          backdropFilter: 'blur(8px)',
          fontSize: '12px',
          color: '#6b7280',
          userSelect: 'none',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Room ID */}
        <span style={{ fontWeight: 500, color: '#374151' }}>{roomId}</span>

        {/* Share button */}
        <button
          onClick={handleShare}
          style={{
            padding: '2px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            backgroundColor: copied ? '#dcfce7' : '#ffffff',
            color: copied ? '#16a34a' : '#374151',
            cursor: 'pointer',
            fontSize: '11px',
            transition: 'all 0.15s ease',
          }}
        >
          {copied ? 'Copied!' : 'Share'}
        </button>

        {/* Divider */}
        <div style={{ width: '1px', height: '16px', backgroundColor: '#e5e7eb' }} />

        {/* User count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: statusColor,
            }}
          />
          <span>{userCount}</span>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '16px', backgroundColor: '#e5e7eb' }} />

        {/* Zoom level */}
        <span style={{ fontFamily: 'monospace', color: '#374151' }}>
          {Math.round(scale * 100)}%
        </span>
      </div>
    </>
  );
}
