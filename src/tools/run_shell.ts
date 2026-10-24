import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';
import { trimOutput } from './utils.js';

const schema = z.object({
  command: z.string().describe('Shell command to run (executed with workspace as cwd)'),
});

async function execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { command } = args as { command: string };

  return new Promise<ToolResult>((resolve) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];

    const proc = spawn(shell, shellArgs, {
      cwd: ctx.workspace,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let resolved = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 3000);
    }, ctx.shellTimeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length + stderr.length > ctx.maxResultBytes * 2) {
        proc.kill('SIGTERM');
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stdout.length + stderr.length > ctx.maxResultBytes * 2) {
        proc.kill('SIGTERM');
      }
    });

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ error: err.message, label: 'execution_error' });
      }
    });

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);

      if (killed) {
        resolve({
          error: `Command timed out after ${ctx.shellTimeoutMs / 1000}s`,
          label: 'execution_error',
        });
        return;
      }

      const combined = [
        stdout ? `stdout:\n${stdout}` : '',
        stderr ? `stderr:\n${stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      if (code !== 0 && !combined) {
        resolve({
          error: `Command exited with code ${code}`,
          label: 'execution_error',
        });
        return;
      }

      const { output, trimmed } = trimOutput(combined || `Exit code: ${code}`, ctx.maxResultBytes);
      resolve({ output, trimmed });
    });
  });
}

export const run_shell = {
  name: 'run_shell',
  description: 'Run a shell command with workspace as the working directory',
  schema,
  execute,
  isReadOnly: false,
};
