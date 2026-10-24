import { describe, expect, it } from 'vitest';
import { COMMANDS, getFilteredCommands, parseCommand } from './index.js';

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
});
