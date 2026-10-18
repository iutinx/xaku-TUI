import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import envPaths from 'env-paths';

export interface CliOptions {
  baseUrl?: string;
  model?: string;
  temperature?: string;
}

export interface Config {
  baseUrl: string;
  /** Explicitly configured model, or null to auto-select the first installed model. */
  model: string | null;
  temperature: number;
  systemPrompt: string | null;
  workspace: string;
  dataDir: string;
  logsDir: string;
  casesDir: string;
  shellTimeoutMs: number;
  maxResultBytes: number;
}

const DEFAULT_BASE_URL = process.env.XAKU_BASE_URL ?? 'http://localhost:11434/v1';
const DEFAULT_TEMPERATURE = 0.2;

export async function buildConfig(
  workspaceArg: string | undefined,
  options: CliOptions,
): Promise<Config> {
  const rawWorkspace = workspaceArg ? path.resolve(workspaceArg) : process.cwd();
  let workspace: string;
  try {
    const st = await stat(rawWorkspace);
    if (!st.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${rawWorkspace}`);
    }
    workspace = await realpath(rawWorkspace);
  } catch (err) {
    throw new Error(`Invalid workspace: ${err instanceof Error ? err.message : String(err)}`);
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = options.model ?? process.env.XAKU_MODEL ?? null;
  const temperature = parseTemperature(options.temperature);

  const paths = envPaths('xaku', { suffix: '' });

  return {
    baseUrl,
    model,
    temperature,
    systemPrompt: 'You are a helpful assistant. Answer directly and concisely.',
    workspace,
    dataDir: paths.data,
    logsDir: path.join(paths.data, 'logs'),
    casesDir: path.join(paths.data, 'cases'),
    shellTimeoutMs: 30_000,
    maxResultBytes: 100_000,
  };
}

function parseTemperature(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TEMPERATURE;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid temperature: ${raw}`);
  }
  return Math.max(0, Math.min(2, value));
}
