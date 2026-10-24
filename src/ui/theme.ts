export interface Symbols {
  spinner: string[];
  success: string;
  failure: string;
  skipped: string;
  pending: string;
  treeBranch: string;
  treeLast: string;
  cursor: string;
}

export function isPlainMode(): boolean {
  if (process.env.XAKU_PLAIN === '1') return true;
  if (process.env.TERM === 'dumb') return true;
  return false;
}

function supportsUnicode(): boolean {
  if (isPlainMode()) return false;
  // Most modern terminals (including Windows Terminal) support Unicode box-drawing.
  return true;
}

const unicodeSymbols: Symbols = {
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  success: '✔',
  failure: '✖',
  skipped: '↓',
  pending: '○',
  treeBranch: '├',
  treeLast: '└',
  cursor: '▌',
};

const plainSymbols: Symbols = {
  spinner: ['|', '/', '-', '\\'],
  success: '[ok]',
  failure: '[x]',
  skipped: '[skip]',
  pending: '[ ]',
  treeBranch: '|-',
  treeLast: '`-',
  cursor: '|',
};

export function getSymbols(): Symbols {
  return supportsUnicode() ? unicodeSymbols : plainSymbols;
}

export const symbols = getSymbols();

export const theme = {
  primary: 'cyan',
  success: 'green',
  failure: 'red',
  warning: 'yellow',
  muted: 'gray',
  text: 'white',
  spinner: 'cyan',
} as const;
