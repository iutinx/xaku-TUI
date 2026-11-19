import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

let cachedBranch: string | null = null;
let lastFetch = 0;
const CACHE_TTL = 5000;

export async function getGitBranch(cwd: string): Promise<string | null> {
  const now = Date.now();
  if (cachedBranch !== null && now - lastFetch < CACHE_TTL) {
    return cachedBranch;
  }

  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      timeout: 3000,
    });
    cachedBranch = stdout.trim() || null;
    lastFetch = now;
    return cachedBranch;
  } catch {
    return null;
  }
}
