import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  HANDLED_ACTION_TYPES,
  getFilteredCommands,
  parseCommand,
} from '../../src/commands/index.js';

describe('getFilteredCommands', () => {
  it('returns all commands for an empty query', () => {
    expect(getFilteredCommands('')).toHaveLength(COMMANDS.length);
  });

  it('filters by prefix', () => {
    const result = getFilteredCommands('mo');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('model');
  });

  it('matches aliases', () => {
    const result = getFilteredCommands('temp');
    expect(result.map((c) => c.name)).toEqual(['temperature']);
  });

  it('returns nothing for unknown prefixes', () => {
    expect(getFilteredCommands('zzz')).toEqual([]);
  });

  it('every command has a description', () => {
    for (const cmd of COMMANDS) {
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });
});

describe('parseCommand', () => {
  it('suggests the closest match for typos', () => {
    const action = parseCommand('/cl');
    expect(action.type).toBe('error');
    if (action.type === 'error') {
      expect(action.message).toContain('/clear');
    }
  });

  it('parses model switching', () => {
    const action = parseCommand('/model qwen3:4b');
    expect(action).toEqual({ type: 'set-model', model: 'qwen3:4b' });
  });

  it('parses /stats', () => {
    expect(parseCommand('/stats')).toEqual({ type: 'stats' });
  });

  it('parses /export', () => {
    expect(parseCommand('/export')).toEqual({ type: 'export' });
  });

  it('parses /save with name', () => {
    expect(parseCommand('/save mytest')).toEqual({ type: 'save', name: 'mytest' });
  });

  it('rejects /save without name', () => {
    const action = parseCommand('/save');
    expect(action.type).toBe('error');
  });

  it('parses /load with name', () => {
    expect(parseCommand('/load mytest')).toEqual({ type: 'load', name: 'mytest' });
  });

  it('rejects /load without name', () => {
    const action = parseCommand('/load');
    expect(action.type).toBe('error');
  });

  it('parses /cancel', () => {
    expect(parseCommand('/cancel')).toEqual({ type: 'cancel' });
  });

  it('parses /compact as a toggle', () => {
    expect(parseCommand('/compact')).toEqual({ type: 'toggle-compact' });
  });

  it('filters /compact by prefix', () => {
    expect(getFilteredCommands('comp')[0].name).toBe('compact');
  });

  it('treats the deregistered benchmark/compare/replay as unknown', () => {
    // Their engines and panels were deleted in Phase 12. They must not be
    // advertised in the palette while unhandled.
    for (const cmd of ['/benchmark x a,b', '/compare x a,b', '/replay 2']) {
      const action = parseCommand(cmd);
      expect(action.type).toBe('error');
      if (action.type === 'error') expect(action.message).toContain('Unknown command');
    }
  });

  it('parses /cd with a path', () => {
    expect(parseCommand('/cd ./src')).toEqual({ type: 'set-workspace', path: './src' });
    expect(parseCommand('/cd ~/projects')).toEqual({ type: 'set-workspace', path: '~/projects' });
  });

  it('rejects /cd without a path', () => {
    expect(parseCommand('/cd').type).toBe('error');
  });

  it('parses /pwd', () => {
    expect(parseCommand('/pwd')).toEqual({ type: 'show-workspace' });
  });

  it('parses /autoapprove with each valid mode', () => {
    expect(parseCommand('/autoapprove none')).toEqual({ type: 'set-autoapprove', mode: 'none' });
    expect(parseCommand('/autoapprove read-only')).toEqual({ type: 'set-autoapprove', mode: 'read-only' });
    expect(parseCommand('/autoapprove all')).toEqual({ type: 'set-autoapprove', mode: 'all' });
  });

  it('parses /autoapprove with no args as show-status', () => {
    expect(parseCommand('/autoapprove')).toEqual({ type: 'show-autoapprove' });
  });

  it('rejects invalid /autoapprove mode', () => {
    const action = parseCommand('/autoapprove destructively');
    expect(action.type).toBe('error');
    if (action.type === 'error') {
      expect(action.message).toContain('read-only');
    }
  });

  it('matches the /auto alias', () => {
    expect(parseCommand('/auto read-only')).toEqual({ type: 'set-autoapprove', mode: 'read-only' });
  });

  it('filters /autoapprove by prefix and alias', () => {
    expect(getFilteredCommands('auto')).toHaveLength(1);
    expect(getFilteredCommands('autoapprove')[0].name).toBe('autoapprove');
  });
});

/**
 * Regression guard. Phase 12 deleted the benchmark/compare/replay/report engines
 * but left them registered, so seven commands parsed into actions with no
 * handler and printed "Unknown command: export". Parser-level tests stayed green
 * the whole time. These two tests fail if the registry and the dispatcher ever
 * drift apart again.
 */
describe('command dispatch completeness', () => {
  /**
   * Arguments that make each required-argument command parse successfully.
   * A command with a `<required>` hint missing from here fails the test.
   */
  const SAMPLE_ARGS: Record<string, string> = {
    temperature: '0.5',
    autoapprove: 'none',
    cd: '.',
    save: 'my-case',
    load: 'my-case',
    model: 'qwen3:4b',
    system: 'be terse',
  };

  /** Both the bare and the argument form of every command. */
  function commandForms(cmd: (typeof COMMANDS)[number]): string[] {
    const forms = [`/${cmd.name}`];
    if (cmd.hint?.startsWith('<')) {
      const arg = SAMPLE_ARGS[cmd.name];
      expect(arg, `/${cmd.name} takes a required argument but tests have no sample for it`).toBeTruthy();
      forms.push(`/${cmd.name} ${arg}`);
    } else if (cmd.hint) {
      forms.push(`/${cmd.name} x`);
    }
    return forms;
  }

  it('every registered command parses to an action the app handles', () => {
    for (const cmd of COMMANDS) {
      for (const form of commandForms(cmd)) {
        const action = parseCommand(form);
        if (action.type === 'error') {
          // Optional-argument forms are allowed to ask for usage, but a
          // registered command must never fall through to the typo suggestion.
          expect(action.message, `${form} is registered but unparsed`).not.toContain('Unknown command');
          continue;
        }
        expect(
          HANDLED_ACTION_TYPES,
          `${form} yields action "${action.type}" which src/app.tsx does not handle`,
        ).toContain(action.type);
      }
    }
  });

  it('every handled action type is reachable from the registry', () => {
    const produced = new Set(
      COMMANDS.flatMap((cmd) => commandForms(cmd).map((form) => parseCommand(form).type)),
    );
    for (const handled of HANDLED_ACTION_TYPES) {
      // 'error' is produced by the default branch, not by a registered command.
      if (handled === 'error') continue;
      expect(produced, `action "${handled}" is handled but no command produces it`).toContain(handled);
    }
  });
});
