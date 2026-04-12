import { useState, useEffect } from 'react';
import { theme } from '../theme';

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
    wsStatus === 'connected' ? theme.statusConnected : wsStatus === 'reconnecting' ? theme.statusReconnecting : theme.statusDisconnected;

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
            backgroundColor: wsStatus === 'reconnecting' ? theme.copiedBg : '#fecaca',
            borderRadius: '8px',
            padding: '6px 14px',
            zIndex: 20,
            fontSize: '13px',
            fontWeight: 500,
            color: wsStatus === 'reconnecting' ? theme.copiedText : '#991b1b',
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
          backgroundColor: theme.panelBg,
          borderRadius: '8px',
          boxShadow: `0 2px 12px ${theme.panelShadow}`,
          zIndex: 10,
          backdropFilter: 'blur(8px)',
          fontSize: '12px',
          color: theme.textSecondary,
          userSelect: 'none',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Room ID */}
        <span style={{ fontWeight: 500, color: theme.textPrimary }}>{roomId}</span>

        {/* Share button */}
        <button
          onClick={handleShare}
          style={{
            padding: '2px 8px',
            border: `1px solid ${theme.btnBorder}`,
            borderRadius: '4px',
            backgroundColor: copied ? theme.copiedBg : theme.btnHoverBg,
            color: copied ? theme.copiedText : theme.textPrimary,
            cursor: 'pointer',
            fontSize: '11px',
            transition: 'all 0.15s ease',
          }}
        >
          {copied ? 'Copied!' : 'Share'}
        </button>

        {/* Divider */}
        <div style={{ width: '1px', height: '16px', backgroundColor: theme.divider }} />

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
        <div style={{ width: '1px', height: '16px', backgroundColor: theme.divider }} />

        {/* Zoom level */}
        <span style={{ fontFamily: 'monospace', color: theme.textPrimary }}>
          {Math.round(scale * 100)}%
        </span>
      </div>
    </>
  );
}
