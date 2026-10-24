import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { executeToolCall, validateToolCall } from './executor.js';
import type { ToolCall, ToolContext } from './types.js';

describe('Tool Engine', () => {
  let workspace: string;
  let ctx: ToolContext;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'xaku-test-'));
    ctx = { workspace, maxResultBytes: 100000, shellTimeoutMs: 30000 };
    
    await writeFile(path.join(workspace, 'test.txt'), 'Hello, world!');
    await mkdir(path.join(workspace, 'subdir'));
    await writeFile(path.join(workspace, 'subdir', 'nested.txt'), 'Nested content');

    const db = new Database(path.join(workspace, 'test.db'));
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO users (name) VALUES ('Alice'), ('Bob')");
    db.close();
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

  describe('write_file', () => {
    it('writes a file successfully', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'newfile.txt', content: 'new content' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.output).toContain('File written');
      const content = await readFile(path.join(workspace, 'newfile.txt'), 'utf-8');
      expect(content).toBe('new content');
    });

    it('creates parent directories', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'deep/nested/file.txt', content: 'deep' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.output).toContain('File written');
      const content = await readFile(path.join(workspace, 'deep', 'nested', 'file.txt'), 'utf-8');
      expect(content).toBe('deep');
    });

    it('blocks path outside workspace', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: '../../../etc/evil.txt', content: 'bad' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.label).toBe('blocked');
    });
  });

  describe('run_shell', () => {
    it('runs a command and returns output', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'run_shell',
          arguments: JSON.stringify({ command: 'echo hello' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.output).toContain('hello');
    });

    it('captures stderr', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'run_shell',
          arguments: JSON.stringify({ command: 'echo error >&2' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.output).toContain('error');
    });

    it('reports non-zero exit code', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'run_shell',
          arguments: JSON.stringify({ command: 'exit 1' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.error).toContain('exit');
    });
  });

  describe('query_db', () => {
    it('queries a SQLite database', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'query_db',
          arguments: JSON.stringify({ path: 'test.db', query: 'SELECT * FROM users' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.output).toContain('Alice');
      expect(result.output).toContain('Bob');
    });

    it('blocks non-database file extensions', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'query_db',
          arguments: JSON.stringify({ path: 'test.txt', query: 'SELECT 1' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.label).toBe('blocked');
    });

    it('returns error for invalid SQL', async () => {
      const call: ToolCall = {
        id: '1',
        type: 'function',
        function: {
          name: 'query_db',
          arguments: JSON.stringify({ path: 'test.db', query: 'INVALID SQL' }),
        },
      };
      const result = await executeToolCall(call, ctx);
      expect(result.label).toBe('execution_error');
    });
  });
});
