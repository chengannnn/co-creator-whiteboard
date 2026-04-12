import { useState, useEffect } from 'react';

interface RoomHeaderProps {
  roomId: string;
  userCount: number;
  wsStatus: 'connected' | 'disconnected' | 'reconnecting';
}

export default function RoomHeader({ roomId, userCount, wsStatus }: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);

  // Auto-hide "Copied!" after 2 seconds
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
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
    }
  };

  return (
    <>
      {/* Reconnecting banner */}
      {wsStatus !== 'connected' && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: '32px',
            backgroundColor: wsStatus === 'reconnecting' ? '#fef3c7' : '#fecaca',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 30,
            fontSize: '13px',
            fontWeight: 500,
            color: wsStatus === 'reconnecting' ? '#92400e' : '#991b1b',
          }}
        >
          {wsStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
        </div>
      )}

      {/* Room info bar */}
      <div
        style={{
          position: 'fixed',
          top: wsStatus !== 'connected' ? '32px' : '0',
          left: '56px', // offset for toolbar width
          right: '216px', // offset for properties panel width
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e0e0e0',
          zIndex: 20,
          fontSize: '14px',
          color: '#374151',
          transition: 'top 0.2s ease',
        }}
      >
        <span style={{ fontWeight: 600 }}>Room:</span>
        <code
          style={{
            backgroundColor: '#f3f4f6',
            padding: '4px 8px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '13px',
          }}
        >
          {roomId}
        </code>
        <button
          onClick={handleShare}
          style={{
            padding: '4px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            backgroundColor: copied ? '#dcfce7' : '#ffffff',
            color: copied ? '#16a34a' : '#374151',
            cursor: 'pointer',
            fontSize: '13px',
            transition: 'all 0.15s ease',
          }}
        >
          {copied ? 'Copied!' : 'Share'}
        </button>
        {/* Connection status dot */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor:
                wsStatus === 'connected' ? '#22c55e' : wsStatus === 'reconnecting' ? '#eab308' : '#ef4444',
            }}
          />
          <span style={{ color: '#6b7280', fontSize: '13px' }}>
            {userCount} {userCount === 1 ? 'user' : 'users'} online
          </span>
        </div>
      </div>
    </>
  );
}
