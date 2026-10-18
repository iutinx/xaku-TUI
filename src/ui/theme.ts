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

function supportsUnicode(): boolean {
  if (process.env.XAKU_PLAIN === '1') return false;
  if (process.env.TERM === 'dumb') return false;
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

export const symbols = supportsUnicode() ? unicodeSymbols : plainSymbols;

export const theme = {
  primary: 'cyan',
  success: 'green',
  failure: 'red',
  warning: 'yellow',
  muted: 'gray',
  text: 'white',
  spinner: 'cyan',
} as const;
