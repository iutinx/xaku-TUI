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
  | { type: 'noop'; message?: string }
  | { type: 'clear' }
  | { type: 'set-system'; prompt: string | null }
  | { type: 'set-model'; model: string }
  | { type: 'set-temperature'; temperature: number }
  | { type: 'retry' }
  | { type: 'list-models' }
  | { type: 'not-implemented'; command: string }
  | { type: 'error'; message: string };

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
    case 'stats':
    case 'export':
    case 'save':
    case 'load':
      return { type: 'not-implemented', command: name };
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
