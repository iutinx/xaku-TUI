import { diffLines } from 'diff';

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  unchanged: number;
  truncated: number;
}

export const MAX_DIFF_LINES = 40;

function splitLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function computeDiffLines(
  oldContent: string,
  newContent: string,
  maxLines = MAX_DIFF_LINES,
): DiffResult {
  const changes = diffLines(oldContent, newContent);
  const all: DiffLine[] = [];

  for (const change of changes) {
    const type: DiffLineType = change.added ? 'add' : change.removed ? 'del' : 'ctx';
    for (const text of splitLines(change.value)) {
      all.push({ type, text });
    }
  }

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of all) {
    if (line.type === 'add') added += 1;
    else if (line.type === 'del') removed += 1;
    else unchanged += 1;
  }

  return {
    lines: all.slice(0, maxLines),
    added,
    removed,
    unchanged,
    truncated: Math.max(0, all.length - maxLines),
  };
}

export function formatDiffSummary(diff: DiffResult, isNewFile: boolean): string {
  if (isNewFile) return `new file (+${diff.added} lines)`;
  if (diff.added === 0 && diff.removed === 0) return 'no changes';
  return `+${diff.added} -${diff.removed} ~${diff.unchanged}`;
}
