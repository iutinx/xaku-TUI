import { describe, expect, it } from 'vitest';
import { fillMissingToolResults, type ConversationMessage } from '../../src/model/session.js';

function toolCall(id: string): ConversationMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
  };
}

describe('fillMissingToolResults', () => {
  it('returns the array unchanged when there are no tool calls', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(fillMissingToolResults(history)).toBe(history);
  });

  it('returns the array unchanged when every tool call has a result', () => {
    const history: ConversationMessage[] = [
      toolCall('call_1'),
      { role: 'tool', tool_call_id: 'call_1', content: 'contents' },
    ];
    expect(fillMissingToolResults(history)).toBe(history);
  });

  it('fills a synthetic tool result for a dangling tool call', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: 'read it' },
      toolCall('call_1'),
    ];
    const out = fillMissingToolResults(history);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'Tool call was cancelled before completing.',
    });
  });

  it('fills only the missing call when some already have results', () => {
    const multi: ConversationMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        { id: 'call_b', type: 'function', function: { name: 'list_dir', arguments: '{}' } },
      ],
    };
    const history: ConversationMessage[] = [
      multi,
      { role: 'tool', tool_call_id: 'call_a', content: 'done' },
    ];
    const out = fillMissingToolResults(history);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ role: 'tool', tool_call_id: 'call_b' });
    expect(out[2]).toBe(history[1]);
  });

  it('places synthetic results right after the assistant message', () => {
    const history: ConversationMessage[] = [
      toolCall('call_1'),
      { role: 'user', content: 'next turn' },
    ];
    const out = fillMissingToolResults(history);
    expect(out.map((m) => m.role)).toEqual(['assistant', 'tool', 'user']);
  });

  it('accepts a custom filler message', () => {
    const history: ConversationMessage[] = [toolCall('call_1')];
    const out = fillMissingToolResults(history, 'denied');
    expect(out[1]).toMatchObject({ content: 'denied' });
  });
});
