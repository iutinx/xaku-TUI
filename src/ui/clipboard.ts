import { spawn } from 'node:child_process';

/**
 * Build the OSC 52 "copy" escape sequence for `text`.
 * Terminals that honour it set the system clipboard; others discard it.
 */
export function osc52Sequence(text: string): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  return `\x1b]52;c;${b64}\x07`;
}

/** Platform clipboard helpers, in preference order. */
export function clipboardHelpers(platform = process.platform): Array<[string, string[]]> {
  if (platform === 'darwin') return [['pbcopy', []]];
  if (platform === 'win32') return [['clip', []]];
  return [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ];
}

function runHelper(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      done(false);
    }, 2000);
    timer.unref();

    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0));
    if (child.stdin) {
      child.stdin.on('error', () => done(false));
      child.stdin.end(text);
    } else {
      done(false);
    }
  });
}

/**
 * Copy text to the system clipboard.
 *
 * OSC 52 is attempted first because it also works over SSH and in terminals
 * that permit it; native helpers are the fallback for terminals that ignore the
 * sequence. Returns false when nothing accepted the write, so callers can tell
 * the user rather than failing silently.
 */
export async function copyToClipboard(
  text: string,
  write: (chunk: string) => void = (chunk) => process.stdout.write(chunk),
  platform = process.platform,
): Promise<boolean> {
  try {
    // OSC 52 carries no cursor movement, so it does not disturb the frame.
    write(osc52Sequence(text));
  } catch {
    // stdout may be closed during teardown; still try the native helpers.
  }

  for (const [cmd, args] of clipboardHelpers(platform)) {
    if (await runHelper(cmd, args, text)) return true;
  }
  return false;
}
