export const colors = {
  accent: '#BD5579',
  accentDim: '#601D49',
  accentBright: '#EA9D9D',
  highlight: '#FFEBB8',
  success: '#EA9D9D',
  error: '#BD5579',
  warning: '#FFEBB8',
  text: '#E0E0E0',
  dimText: '#666666',
  border: '#444444',
  background: '#0a0a0a',
} as const;

export type Color = (typeof colors)[keyof typeof colors];
