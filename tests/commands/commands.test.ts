import { describe, expect, it } from 'vitest';
import { COMMANDS, getFilteredCommands, parseCommand } from '../../src/commands/index.js';

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

  it('parses /benchmark with explicit model list', () => {
    expect(parseCommand('/benchmark webtest qwen3:4b,qwen3:8b')).toEqual({
      type: 'benchmark',
      name: 'webtest',
      models: ['qwen3:4b', 'qwen3:8b'],
    });
  });

  it('parses /benchmark without models as all-installed', () => {
    expect(parseCommand('/benchmark webtest')).toEqual({ type: 'benchmark', name: 'webtest', models: undefined });
  });

  it('rejects /benchmark without a case name', () => {
    expect(parseCommand('/benchmark').type).toBe('error');
  });

  it('parses /compare with two models', () => {
    expect(parseCommand('/compare webtest qwen3:4b,qwen3:8b')).toEqual({
      type: 'compare',
      name: 'webtest',
      models: ['qwen3:4b', 'qwen3:8b'],
    });
  });

  it('rejects /compare with only one model', () => {
    const action = parseCommand('/compare webtest qwen3:4b');
    expect(action.type).toBe('error');
    if (action.type === 'error') {
      expect(action.message).toContain('2 models');
    }
  });

  it('rejects /compare with three models', () => {
    const action = parseCommand('/compare webtest a,b,c');
    expect(action.type).toBe('error');
    if (action.type === 'error') {
      expect(action.message).toContain('2 models');
    }
  });

  it('rejects /compare without a case name', () => {
    expect(parseCommand('/compare').type).toBe('error');
  });

  it('parses /compare with spaces in model list', () => {
    expect(parseCommand('/compare mytest modelA , modelB')).toEqual({
      type: 'compare',
      name: 'mytest',
      models: ['modelA', 'modelB'],
    });
  });

  it('parses /replay with and without an index', () => {
    expect(parseCommand('/replay')).toEqual({ type: 'replay' });
    expect(parseCommand('/replay 3')).toEqual({ type: 'replay', index: 3 });
    expect(parseCommand('/replay x').type).toBe('error');
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
