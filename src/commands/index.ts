import { AUTO_APPROVE_MODES, isAutoApproveMode, type AutoApproveMode } from '../config.js';

export interface CommandDef {
  name: string;
  description: string;
  hint?: string;
  aliases?: string[];
}

export const COMMANDS: CommandDef[] = [
  {
    name: 'model',
    description: 'List installed models and switch the active one',
    hint: '[name]',
  },
  {
    name: 'temperature',
    description: 'Set sampling temperature (0-2)',
    hint: '<0-2>',
    aliases: ['temp'],
  },
  {
    name: 'system',
    description: 'Set or clear the system prompt',
    hint: '[prompt]',
  },
  {
    name: 'clear',
    description: 'Start a fresh conversation (keeps session log)',
  },
  {
    name: 'retry',
    description: 'Re-send the last prompt with current settings',
  },
  {
    name: 'cancel',
    description: 'Abort the in-flight generation and any running tool',
  },
  {
    name: 'autoapprove',
    description: 'Auto-approve trusted tools without prompting',
    hint: '<none|read-only|all>',
    aliases: ['auto'],
  },
  {
    name: 'compact',
    description: 'Collapse or expand completed tool activities',
  },
  {
    name: 'cd',
    description: 'Change the workspace folder tools operate in',
    hint: '<path>',
  },
  {
    name: 'pwd',
    description: 'Show the current workspace path',
  },
  {
    name: 'stats',
    description: 'Show detailed speed and tool statistics',
  },
  {
    name: 'export',
    description: 'Export the session report (Markdown + JSON)',
  },
  {
    name: 'save',
    description: 'Save the current prompt as a reusable test case',
    hint: '<name>',
  },
  {
    name: 'load',
    description: 'Load a saved test case',
    hint: '<name>',
  },
];

export function getFilteredCommands(query: string): CommandDef[] {
  const q = query.toLowerCase();
  if (!q) return COMMANDS;
  return COMMANDS.filter(
    (cmd) => cmd.name.startsWith(q) || cmd.aliases?.some((a) => a.startsWith(q)),
  );
}

export type CommandAction =
  | { type: 'clear' }
  | { type: 'set-system'; prompt: string | null }
  | { type: 'set-model'; model: string }
  | { type: 'set-temperature'; temperature: number }
  | { type: 'retry' }
  | { type: 'list-models' }
  | { type: 'set-autoapprove'; mode: AutoApproveMode }
  | { type: 'show-autoapprove' }
  | { type: 'toggle-compact' }
  | { type: 'set-workspace'; path: string }
  | { type: 'show-workspace' }
  | { type: 'stats' }
  | { type: 'export' }
  | { type: 'save'; name: string }
  | { type: 'load'; name: string }
  | { type: 'cancel' }
  | { type: 'error'; message: string };

export type CommandActionType = CommandAction['type'];

/**
 * The action types `src/app.tsx` dispatches. Declared here so the registry, the
 * parser and the dispatcher can be checked against each other: app.tsx builds a
 * `Record<CommandActionType, …>` handler map, so a new action without a handler
 * is a compile error, and the tests assert every registered command lands on a
 * type in this list.
 */
export const HANDLED_ACTION_TYPES = [
  'clear',
  'set-system',
  'set-model',
  'set-temperature',
  'retry',
  'list-models',
  'set-autoapprove',
  'show-autoapprove',
  'toggle-compact',
  'set-workspace',
  'show-workspace',
  'stats',
  'export',
  'save',
  'load',
  'cancel',
  'error',
] as const satisfies readonly CommandActionType[];

/** Every CommandAction type must be listed above. */
type _AllActionsHandled = Exclude<CommandActionType, (typeof HANDLED_ACTION_TYPES)[number]> extends never
  ? true
  : { ERROR: 'add the missing action type to HANDLED_ACTION_TYPES and a handler in app.tsx' };
const _assertActionsHandled: _AllActionsHandled = true;
void _assertActionsHandled;

export function parseCommand(input: string): CommandAction {
  const trimmed = input.trim();
  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  const args = rest.join(' ').trim();

  switch (name.toLowerCase()) {
    case 'clear':
      return { type: 'clear' };
    case 'system':
      return { type: 'set-system', prompt: args || null };
    case 'model':
      if (args) return { type: 'set-model', model: args };
      return { type: 'list-models' };
    case 'temperature':
    case 'temp': {
      if (!args) return { type: 'error', message: 'Usage: /temperature <0-2>' };
      const value = Number(args);
      if (Number.isNaN(value) || value < 0 || value > 2) {
        return { type: 'error', message: 'Temperature must be a number between 0 and 2' };
      }
      return { type: 'set-temperature', temperature: value };
    }
    case 'retry':
      return { type: 'retry' };
    case 'compact':
      return { type: 'toggle-compact' };
    case 'cd':
      if (!args) return { type: 'error', message: 'Usage: /cd <path>' };
      return { type: 'set-workspace', path: args };
    case 'pwd':
      return { type: 'show-workspace' };
    case 'autoapprove':
    case 'auto': {
      if (!args) return { type: 'show-autoapprove' };
      const mode = args.toLowerCase();
      if (!isAutoApproveMode(mode)) {
        return {
          type: 'error',
          message: `Usage: /autoapprove <${AUTO_APPROVE_MODES.join('|')}>`,
        };
      }
      return { type: 'set-autoapprove', mode };
    }
    case 'stats':
      return { type: 'stats' };
    case 'export':
      return { type: 'export' };
    case 'save':
      if (!args) return { type: 'error', message: 'Usage: /save <name>' };
      return { type: 'save', name: args };
    case 'load':
      if (!args) return { type: 'error', message: 'Usage: /load <name>' };
      return { type: 'load', name: args };
    case 'cancel':
      return { type: 'cancel' };
    default: {
      const known = COMMANDS.map((c) => c.name);
      const closest = known.find((c) => c.startsWith(name.toLowerCase()));
      return {
        type: 'error',
        message: closest ? `Unknown command /${name}. Did you mean /${closest}?` : `Unknown command /${name}`,
      };
    }
  }
}
