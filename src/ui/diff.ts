import { diffLines } from 'diff';
import type { DiffLine, FileDiff } from '../tools/activity.js';

const DEFAULT_MAX_LINES = 40;

/**
 * Line diff for `write_file` approval previews. Counts are always exact, even
 * when the rendered lines are truncated, so the summary can say "+12 -3 ~40"
 * while showing only the first `maxLines` hunks.
 */
export function computeDiffLines(
  oldText: string,
  newText: string,
  maxLines = DEFAULT_MAX_LINES,
): FileDiff {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  let truncated = false;

  for (const part of diffLines(oldText, newText)) {
    const type: DiffLine['type'] = part.added ? 'add' : part.removed ? 'del' : 'ctx';
    const parts = splitLines(part.value);

    for (const text of parts) {
      if (type === 'add') added += 1;
      else if (type === 'del') removed += 1;
      else unchanged += 1;

      if (lines.length < maxLines) lines.push({ type, text });
      else truncated = true;
    }
  }

  return { lines, added, removed, unchanged, truncated };
}

/** Trailing newlines are not their own line. */
function splitLines(value: string): string[] {
  const out = value.split('\n');
  if (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

export function formatDiffSummary(diff: FileDiff, fileState?: string): string {
  if (fileState === 'new') return `new file (+${diff.added} lines)`;
  if (diff.added === 0 && diff.removed === 0) return 'no changes';
  return `+${diff.added} -${diff.removed} ~${diff.unchanged}`;
}
