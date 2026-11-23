import { describe, expect, it } from 'vitest';
import {
  averageToolDuration,
  countActivities,
  isTerminal,
  patchActivity,
  shouldAutoApprove,
  splitCollapsed,
  summarizeCollapsed,
  type ToolActivity,
} from '../../src/tools/activity.js';

function activity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: 'a1',
    callId: 'call_1',
    toolName: 'read_file',
    args: { path: 'README.md' },
    status: 'success',
    formatValid: true,
    ...overrides,
  };
}

describe('shouldAutoApprove', () => {
  it('never auto-approves in none mode', () => {
    expect(shouldAutoApprove('none', true)).toBe(false);
    expect(shouldAutoApprove('none', false)).toBe(false);
  });

  it('read-only mode approves only read-only tools', () => {
    expect(shouldAutoApprove('read-only', true)).toBe(true);
    expect(shouldAutoApprove('read-only', false)).toBe(false);
  });

  it('all mode approves everything', () => {
    expect(shouldAutoApprove('all', true)).toBe(true);
    expect(shouldAutoApprove('all', false)).toBe(true);
  });

  it('drives off the registry isReadOnly flag rather than the tool name', () => {
    // The caller passes tools[name].isReadOnly, so a new read-only tool is
    // covered automatically with no change needed here.
    expect(shouldAutoApprove('read-only', true)).toBe(true);
  });
});

describe('activity status helpers', () => {
  it('classifies terminal vs actionable statuses', () => {
    expect(isTerminal('success')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('denied')).toBe(true);
    expect(isTerminal('skipped')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('awaiting_approval')).toBe(false);
    expect(isTerminal('running')).toBe(false);
  });

  it('patches a single activity by id without touching the rest', () => {
    const list = [activity({ id: 'a1' }), activity({ id: 'a2' })];
    const next = patchActivity(list, 'a2', { status: 'failed', error: 'boom' });
    expect(next[0].status).toBe('success');
    expect(next[1]).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('ignores a patch for an unknown id', () => {
    const list = [activity()];
    expect(patchActivity(list, 'nope', { status: 'failed' })).toEqual(list);
  });
});

describe('countActivities', () => {
  it('counts each outcome bucket', () => {
    const list = [
      activity({ id: '1', status: 'success' }),
      activity({ id: '2', status: 'success' }),
      activity({ id: '3', status: 'failed' }),
      activity({ id: '4', status: 'denied' }),
      activity({ id: '5', status: 'skipped' }),
      activity({ id: '6', status: 'cancelled' }),
      activity({ id: '7', status: 'awaiting_approval' }),
      activity({ id: '8', status: 'running' }),
    ];
    expect(countActivities(list)).toEqual({
      success: 2,
      failed: 1,
      denied: 1,
      skipped: 1,
      cancelled: 1,
      pending: 2,
    });
  });

  it('returns zeros for an empty list', () => {
    expect(countActivities([])).toEqual({
      success: 0,
      failed: 0,
      denied: 0,
      skipped: 0,
      cancelled: 0,
      pending: 0,
    });
  });
});

describe('averageToolDuration', () => {
  it('averages recorded durations', () => {
    const list = [
      activity({ id: '1', durationMs: 100 }),
      activity({ id: '2', durationMs: 300 }),
    ];
    expect(averageToolDuration(list)).toBe(200);
  });

  it('ignores activities without a duration', () => {
    const list = [activity({ id: '1', durationMs: 200 }), activity({ id: '2' })];
    expect(averageToolDuration(list)).toBe(200);
  });

  it('returns null when nothing has been timed', () => {
    expect(averageToolDuration([activity()])).toBeNull();
    expect(averageToolDuration([])).toBeNull();
  });
});

describe('compact view split', () => {
  const list = [
    activity({ id: '1', status: 'success' }),
    activity({ id: '2', status: 'awaiting_approval' }),
    activity({ id: '3', status: 'failed' }),
    activity({ id: '4', status: 'running' }),
    activity({ id: '5', status: 'skipped' }),
  ];

  it('collapses terminal rows and keeps actionable rows visible', () => {
    const { collapsed, visible } = splitCollapsed(list);
    expect(collapsed.map((a) => a.id)).toEqual(['1', '3', '5']);
    expect(visible.map((a) => a.id)).toEqual(['2', '4']);
  });

  it('summarizes collapsed rows per outcome', () => {
    const { collapsed } = splitCollapsed(list);
    expect(summarizeCollapsed(collapsed)).toEqual([
      { status: 'success', count: 1 },
      { status: 'failed', count: 1 },
      { status: 'skipped', count: 1 },
    ]);
  });

  it('omits zero counts and keeps a stable order', () => {
    const only = [activity({ id: '1', status: 'denied' }), activity({ id: '2', status: 'success' })];
    expect(summarizeCollapsed(only)).toEqual([
      { status: 'success', count: 1 },
      { status: 'denied', count: 1 },
    ]);
  });

  it('summarizes to nothing when everything is still pending', () => {
    const pending = [activity({ id: '1', status: 'awaiting_approval' })];
    expect(summarizeCollapsed(splitCollapsed(pending).collapsed)).toEqual([]);
  });
});
