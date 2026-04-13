// Warm light palette for the whiteboard application.
const lightTheme = {
  // Canvas
  canvasBg: '#FFFFFF',

  // Toolbar & panels
  panelBg: 'rgba(255, 253, 245, 0.92)',
  panelBorder: '#f0e4c0',
  panelShadow: 'rgba(180, 150, 80, 0.10)',

  // Buttons
  btnActiveBg: '#FFF3C4',
  btnActiveBorder: '#e0c870',
  btnHoverBg: '#FFF8E1',
  btnDefaultBg: 'transparent',
  btnBorder: '#e8dbb8',

  // Text
  textPrimary: '#333333',
  textSecondary: '#6b5e45',
  textMuted: '#9a8c6e',

  // Dividers
  divider: '#f0e4c0',

  // Text editor overlay
  textEditorBg: 'rgba(255, 255, 255, 0.95)',
  textEditorBorder: '#e0c870',

  // Status colors (remote cursor compatibility)
  statusConnected: '#22c55e',
  statusReconnecting: '#eab308',
  statusDisconnected: '#ef4444',

  // Copied state
  copiedBg: '#fef3c7',
  copiedText: '#92400e',
};

// Dark palette for the whiteboard application.
const darkTheme = {
  // Canvas
  canvasBg: '#121212',

  // Toolbar & panels
  panelBg: 'rgba(40, 40, 40, 0.92)',
  panelBorder: '#444444',
  panelShadow: 'rgba(0, 0, 0, 0.30)',

  // Buttons
  btnActiveBg: '#333333',
  btnActiveBorder: '#555555',
  btnHoverBg: '#2a2a2a',
  btnDefaultBg: 'transparent',
  btnBorder: '#444444',

  // Text
  textPrimary: '#E0E0E0',
  textSecondary: '#AAAAAA',
  textMuted: '#777777',

  // Dividers
  divider: '#444444',

  // Text editor overlay
  textEditorBg: 'rgba(40, 40, 40, 0.95)',
  textEditorBorder: '#555555',

  // Status colors (remote cursor compatibility)
  statusConnected: '#22c55e',
  statusReconnecting: '#eab308',
  statusDisconnected: '#ef4444',

  // Copied state
  copiedBg: '#422006',
  copiedText: '#fbbf24',
};

// Stroke color mapping for dark mode — render-time inversion
// Dark strokes become light, light colors become darker for visibility
const DARK_MODE_COLOR_MAP: Record<string, string> = {
  '#000000': '#E0E0E0',
  '#333333': '#CCCCCC',
  '#e03131': '#ff6b6b',
  '#1c7ed6': '#5c9ce6',
  '#2f9e44': '#51cf66',
  '#6741d9': '#9775fa',
  '#e8590c': '#ff922b',
  '#a0522d': '#d4a76a',
  '#868e96': '#adb5bd',
  '#e84393': '#f783ac',
  '#00cec9': '#48dbdb',
};

export type ThemeMode = 'light' | 'dark';

export function getThemeColors(mode: ThemeMode): typeof lightTheme {
  return mode === 'dark' ? darkTheme : lightTheme;
}

export function getStrokeColor(color: string, mode: ThemeMode): string {
  if (mode === 'light') return color;
  return DARK_MODE_COLOR_MAP[color] ?? color;
}
