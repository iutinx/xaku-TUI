import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { executeToolCall, validateToolCall } from './executor.js';
import type { ToolCall, ToolContext } from './types.js';

describe('Tool Engine', () => {
  let workspace: string;
  let ctx: ToolContext;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'xaku-test-'));
    ctx = { workspace, maxResultBytes: 100000 };
    
    // Create test files
    await writeFile(path.join(workspace, 'test.txt'), 'Hello, world!');
    await mkdir(path.join(workspace, 'subdir'));
    await writeFile(path.join(workspace, 'subdir', 'nested.txt'), 'Nested content');
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true });
  });

  describe('validateToolCall', () => {
    it('validates a correct read_file call', () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 'test.txt' }),
        },
      };
      const result = validateToolCall(call);
      expect(result.valid).toBe(true);
    });

    it('rejects unknown tool', () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'unknown_tool',
          arguments: '{}',
        },
      };
      const result = validateToolCall(call);
      expect(result.valid).toBe(false);
      expect(result.label).toBe('unknown_tool');
    });

    it('rejects malformed arguments', () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: 'not json',
        },
      };
      const result = validateToolCall(call);
      expect(result.valid).toBe(false);
      expect(result.label).toBe('malformed_call');
    });

    it('rejects invalid schema', () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 123 }), // path should be string
        },
      };
      const result = validateToolCall(call);
      expect(result.valid).toBe(false);
      expect(result.label).toBe('malformed_call');
    });
  });

  describe('read_file', () => {
    it('reads a file successfully', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 'test.txt' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.output).toBe('Hello, world!');
    });

    it('blocks path outside workspace', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: '../../../etc/passwd' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.label).toBe('blocked');
    });

    it('returns error for non-existent file', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 'missing.txt' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.label).toBe('execution_error');
      expect(result.error).toContain('not found');
    });
  });

  describe('list_dir', () => {
    it('lists directory contents', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'list_dir',
          arguments: JSON.stringify({ path: '.' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.output).toContain('file');
      expect(result.output).toContain('test.txt');
      expect(result.output).toContain('subdir');
    });

    it('blocks path outside workspace', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'list_dir',
          arguments: JSON.stringify({ path: '..' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.label).toBe('blocked');
    });
  });
});
