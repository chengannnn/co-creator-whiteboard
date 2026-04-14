import { useState, useEffect } from 'react';
import { getThemeColors, type ThemeMode } from '../theme';

interface BottomPanelProps {
  roomId: string;
  userCount: number;
  wsStatus: 'connected' | 'disconnected' | 'reconnecting';
  scale: number;
  themeMode: ThemeMode;
  onZoom: (value: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export default function BottomPanel({ roomId, userCount, wsStatus, scale, themeMode, onZoom, onUndo, onRedo, canUndo, canRedo }: BottomPanelProps) {
  const theme = getThemeColors(themeMode);
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

        {/* Undo/Redo buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: theme.zoomBg,
            borderRadius: '12px',
            padding: '2px',
            gap: '0px',
          }}
        >
          {/* Undo button */}
          <button
            onClick={onUndo}
            disabled={!canUndo}
            style={{
              width: '24px',
              height: '22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: '10px',
              backgroundColor: 'transparent',
              color: canUndo ? theme.textPrimary : theme.textMuted,
              cursor: canUndo ? 'pointer' : 'default',
              fontSize: '14px',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (canUndo) e.currentTarget.style.backgroundColor = theme.btnHoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          {/* Redo button */}
          <button
            onClick={onRedo}
            disabled={!canRedo}
            style={{
              width: '24px',
              height: '22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: '10px',
              backgroundColor: 'transparent',
              color: canRedo ? theme.textPrimary : theme.textMuted,
              cursor: canRedo ? 'pointer' : 'default',
              fontSize: '14px',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (canRedo) e.currentTarget.style.backgroundColor = theme.btnHoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
            </svg>
          </button>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '16px', backgroundColor: theme.divider }} />

        {/* Zoom control capsule */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: theme.zoomBg,
            borderRadius: '12px',
            padding: '2px',
            gap: '0px',
          }}
        >
          <button
            onClick={() => onZoom(Math.round((scale - 0.25) * 100) / 100)}
            style={{
              width: '24px',
              height: '22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: '10px',
              backgroundColor: 'transparent',
              color: theme.textPrimary,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              lineHeight: 1,
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.btnHoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            −
          </button>
          <span
            style={{
              fontFamily: 'monospace',
              color: theme.textPrimary,
              fontSize: '11px',
              padding: '0 6px',
              minWidth: '42px',
              textAlign: 'center',
              userSelect: 'none',
            }}
          >
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => onZoom(Math.round((scale + 0.25) * 100) / 100)}
            style={{
              width: '24px',
              height: '22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: '10px',
              backgroundColor: 'transparent',
              color: theme.textPrimary,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              lineHeight: 1,
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.btnHoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            +
          </button>
        </div>
      </div>
    </>
  );
}
