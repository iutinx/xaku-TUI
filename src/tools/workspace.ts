import { realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type WorkspaceResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Expand a leading `~` to the user's home directory. Terminals normally do this
 * for us, but slash-command input is read by xaku, not a shell.
 */
export function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/**
 * Replace the home-directory prefix of an absolute path with `~` so long paths
 * stay readable in the header and in messages.
 */
export function abbreviateHome(absPath: string): string {
  const home = os.homedir();
  if (absPath === home) return '~';
  if (absPath.startsWith(home + path.sep)) {
    return '~' + path.sep + absPath.slice(home.length + 1);
  }
  return absPath;
}

/**
 * Resolve and validate a candidate workspace directory. Relative paths resolve
 * against `from` (the current workspace), so `/cd src` walks down and
 * `/cd ..` walks up. Symlinks are resolved so the stored workspace always matches
 * what the tool sandbox compares against.
 */
export async function resolveWorkspace(
  requested: string,
  from: string,
): Promise<WorkspaceResult> {
  const expanded = expandHome(requested.trim());
  if (!expanded) return { ok: false, error: 'No path given.' };

  const candidate = path.resolve(from, expanded);

  let st;
  try {
    st = await stat(candidate);
  } catch {
    return { ok: false, error: `Not a directory: ${candidate}` };
  }

  if (!st.isDirectory()) {
    return { ok: false, error: `Not a directory: ${candidate}` };
  }

  try {
    return { ok: true, path: await realpath(candidate) };
  } catch (err) {
    return { ok: false, error: `Cannot resolve path: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Display a resolved absolute path relative to the workspace it was called from.
 * Paths outside the workspace keep their absolute form so the user can tell they
 * escaped the sandbox.
 */
export function relativeToWorkspace(absPath: string, workspace: string): string {
  const rel = path.relative(workspace, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return absPath;
  return rel;
}
