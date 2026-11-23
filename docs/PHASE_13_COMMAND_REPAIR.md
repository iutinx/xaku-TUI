# Phase 13: Command Repair + Workspace Visibility

**Date**: 2026-11-19
**Status**: ✅ Complete
**Tests**: 150 passing across 13 files (was 77 across 6)

## Overview

Two things happened at once:

1. **Repair.** The Phase 12 migration to `@claude-code-kit/ui` had silently broken
   most of the slash-command surface, plus several tool-engine behaviours that the
   bespoke UI used to provide. This phase found and fixed them.
2. **Feature.** xaku now shows *where it was launched from* — the workspace path is
   visible in the header, the menu, the welcome screen and a startup line, can be
   changed mid-session with `/cd`, and is copied to the clipboard on click.

## Why the breakage was invisible

`src/commands/index.ts` registers commands and `parseCommand()` returns an action for
each. `src/app.tsx` dispatches those actions. **Nothing connected the two at compile
time or test time.**

Commit `567759f` deleted the benchmark/compare/replay/report engines and the tool
panel, but left the registry and parser intact. `handleSubmit()`'s `switch` had cases
for only 8 of the 19 action types, so everything else fell through to a `default:` branch that
printed `Unknown command: ${action.type}`. The 77 unit tests only called
`parseCommand()`, never the dispatcher — so they stayed green while 8 of the 14
registered commands went nowhere. (`/cancel` was the mirror image: handled, but never
registered, so it worked only if you already knew it existed.)

Dead before this phase: `/export`, `/save`, `/load`, `/autoapprove`, `/compact`,
`/benchmark`, `/compare`, `/replay` — three because their engines were deleted, five
because their handlers simply weren't written.

## Part 1 — Repairs

### Deregistered the commands with no engine

`/benchmark`, `/compare`, `/replay` were removed from `COMMANDS`, `parseCommand()` and
`CommandAction`. They now correctly report `Unknown command`. Restoring them means
rebuilding parallel streaming, scoring and step-through playback — deliberately out of
scope here and tracked as future work.

### Made the dispatcher total

`handleSubmit()`'s `switch` became a `Record<CommandAction['type'], handler>` lookup:

```ts
const commandHandlers: Record<CommandAction['type'], (action: CommandAction) => void | Promise<void>> = { … };
await commandHandlers[action.type](action);
```

TypeScript now **refuses to compile** if an action type has no handler, and
`HANDLED_ACTION_TYPES` + a conditional-type assertion refuse a handler set that drifts
from the union. `tests/commands/commands.test.ts` asserts both directions:

- every registered command parses to a handled action;
- every handled action is reachable from a registered command.

Writing that test immediately found two more drift bugs: a `noop` action nothing
produced (deleted), and `/cancel` being handled but never registered, so it was
invisible in the palette (registered).

### Restored commands

| Command | Was | Now |
|---|---|---|
| `/export` | "Unknown command" | Writes `xaku-report-<ts>.md` + `.json` via new `src/commands/report.ts` |
| `/save` | "Unknown command" | Wired to `src/commands/cases.ts`, which existed but was never imported |
| `/load` | "Unknown command" | Loads the case into the input |
| `/autoapprove` | "Unknown command" | Sets the mode; approval actually consults it |
| `/compact` | "Unknown command" | Collapses completed tool rows (needed the activity list first) |
| `/stats` | 4-line stub | Model/workspace/tokens/speed/tool outcomes/avg tool time/log path |
| `/model <name>` | set the name only | Verifies it is installed and runs the tool-support check |

`/export` and `/stats` both derive from one `computeStats()` call, which is what
spec §11.1 means by "the report always matches `/stats`". `tests/commands/report.test.ts`
asserts every figure appears in the Markdown and equals the JSON twin.

### Restored tool-engine behaviour

`src/tools/activity.ts` (new, pure) models the activity list the migration deleted.

- **Tool activity list** — `src/ui/ToolPanel.tsx` renders status icon, tool + args,
  `format check: ✔/✖`, duration, auto-approved note and diff previews.
- **`[f] fix / [s] skip / [r] retry`** — spec §9. Failures now pause and ask; the app
  never auto-feeds an error back or auto-retries.
- **Malformed calls pause the turn** — they used to `continue`, letting a dangling
  `tool_calls` message reach the next request.
- **`abortSignal` is passed to tools** — `ToolContext.abortSignal` existed and
  `run_shell`/`query_db` honoured it, but `app.tsx` never populated it, so Ctrl+C
  could not interrupt a running `sleep 10`. Per-activity controllers are tracked in a
  map and aborted on cancel.
- **Parallel execution** — approved tools run via `Promise.all`; results are appended
  in original `tool_calls` order regardless of completion order.
- **Auto-approve is real** — `shouldAutoApprove(mode, isReadOnly)` takes the flag from
  the registry rather than a duplicated tool-name list, so a new read-only tool is
  covered automatically. `--auto-approve` / `XAKU_AUTO_APPROVE` now do what they claim.
- **`write_file` diff preview** — `src/ui/diff.ts` rebuilt on the `diff` package (the
  dependency had stayed in `package.json`, unused) over `probeExistingFile()`.
- **`[c]` hotkey** collapses completed rows during a turn.
- **Usage errors are visible** — `/temperature` with no argument printed
  "Unknown command: error" instead of its usage string. `{ type: 'error' }` now has a
  handler, as does `{ type: 'noop' }`… which was then removed as dead.

### Two more bugs found by driving the real TUI

Verified with `scripts/pty-smoke.py` (a PTY harness that types into the actual app),
because unit tests could not see either of these:

1. **The input never cleared.** Phase 12 dropped the kit's `REPL`, which used to call
   `setInputValue("")` before `onSubmit`. With the value lifted into `App` and
   `PromptInput` fully controlled, submitted text stayed in the box and the *next*
   message appended to it. `handleSubmit()` now clears explicitly.
2. **The palette could not reach most commands.** `CommandPalette` rendered
   `suggestions.slice(0, 6)` regardless of `selectedIndex`. With 14 commands registered,
   arrow keys moved the cursor onto rows 6-13 that were never painted, so invisible
   commands were being selected. `windowStart()` now scrolls a window to keep the focus
   visible, with `↑ n above` / `↓ n more` indicators, and `app.tsx`'s row budget accounts
   for those rows so total TUI height stays stable.

## Part 2 — Workspace visibility

`src/tools/workspace.ts` (new, pure): `expandHome`, `abbreviateHome`,
`resolveWorkspace`, `relativeToWorkspace`.

- **Header segment** — `⌂ ~/path` on the right of `XakuHeader`, truncated from the left
  (`…/src/ui`) so the leaf stays readable, with a narrow-terminal budget.
- **`/cd <path>`** — changes the workspace mid-session. Relative paths resolve against
  the current workspace, `~` expands, the target must exist and be a directory, and
  `realpath` is applied so the stored value matches what the tool sandbox compares
  against. Refused while a generation or approval prompt is live, and logged as
  `set_workspace` / `workspace_error`.
- **`/pwd`** — prints the current workspace and the original launch directory.
- **Relative paths in tool previews** — approval shows `read README.md`, not a long
  absolute path; anything outside the workspace stays absolute so a sandbox escape is
  visible rather than hidden.
- **Startup line** — `Workspace: <path> · Model: <model>` on launch and after the menu
  pick; also shown in `XakuMenu` and `XakuWelcome`.
- **Click to copy** — clicking the header segment writes the path to the clipboard via
  OSC 52 (works over SSH) with `pbcopy`/`clip`/`wl-copy`/`xclip`/`xsel` fallbacks
  (`src/ui/clipboard.ts`), flashes `copied ✓`, and reports failure honestly when a
  terminal ignores both paths.

### Design note: why `/cd` is App state

`client` and `logger` were `useMemo`'d on `[config]`. Mutating `config.workspace` for
`/cd` would have re-created the logger and opened a **second session log file
mid-session**, splitting the record `/export` reads. Workspace is therefore its own
`useState`, `logger` is created exactly once, and tool calls read it through a ref so
an in-flight turn always sees a consistent value.

### Also fixed

`XakuMenu` said `esc quit` but Escape only dismisses the menu. Label now reads
`esc skip`.

## Files

New: `src/tools/activity.ts`, `src/tools/workspace.ts`, `src/ui/ToolPanel.tsx`,
`src/ui/diff.ts`, `src/ui/clipboard.ts`, `src/commands/report.ts`,
`scripts/pty-smoke.py`.
Modified: `src/app.tsx`, `src/commands/index.ts`, `src/ui/XakuHeader.tsx`,
`src/ui/XakuMenu.tsx`, `src/ui/XakuWelcome.tsx`, `src/ui/CommandPalette.tsx`.
Tests: `tests/tools/activity.test.ts`, `tests/tools/workspace.test.ts`,
`tests/ui/diff.test.ts`, `tests/ui/clipboard.test.ts`, `tests/ui/toolpanel.test.ts`,
`tests/ui/command-palette.test.ts`, `tests/commands/report.test.ts`,
`tests/commands/commands.test.ts`.

## Verification

- `npm run typecheck` clean; `tsc` build clean.
- `npx vitest run` — 150/150 across 13 files.
- `python3 scripts/pty-smoke.py` — drives the real TUI through a PTY against live
  Ollama and asserts on artifacts (session-log events, files written by `/export` and
  `/save`) rather than scraped pixels.

## Entry point: alt-screen ownership moved

`cli.tsx` used to write `ESC[?1049h` by hand to take over the terminal. The renderer
only enables SGR mouse tracking — and therefore only delivers `onClick` — when it
*knows* it is in the alt screen, which it learns exclusively from the kit's
`<AlternateScreen>`. So click-to-copy could not have worked without this change, and
`<AlternateScreen>` now wraps `App` instead. `cli.tsx` keeps a reduced raw-exit cleanup
as a hard-exit safety net.

Consequence worth knowing: mouse reporting is now on, so drag-selection is handled by
the kit's in-app selection (with copy-on-select) rather than the terminal's native
rectangle select. Hold the terminal's Option/Shift override to do a native selection.

### Design review catches in this phase's own code

Re-reading the newly written turn loop turned up three defects in code added during this
phase, fixed before merge:

1. **`generationMs` double-counted across tool turns.** The accumulator used a single
   `turnStartedAt` captured before the `while (true)` stream loop and added
   `Date.now() - turnStartedAt` after *every* iteration. A three-turn tool loop therefore
   counted the same wall-clock span three times, deflating the tok/s figure that both
   `/stats` and `/export` report. Each stream leg now stamps its own start.
2. **`resolveFailure` could emit two tool messages for one `tool_call_id`.** After a failed
   execution the loop had already appended the error as that call's tool result; the
   `fix`/`skip`/`retry` handler then appended a *second* message with the same id, which
   OpenAI-compatible endpoints reject. Both paths now go through `upsertToolResult()`,
   which replaces the existing entry — and correctly appends for the malformed-call path,
   where no result exists yet because the turn paused before execution.
3. **Compact toggle read stale state.** `setCompact(v => !v)` was paired with
   `logger.log({ compact: !compact })`, mixing a functional update with a closure read, so
   the logged value could disagree with the rendered one. Both the command and the `[c]`
   hotkey now compute the next value once.

### Dead code removed

`activityIsActionable` was exported but never imported; `noop` in the action union was
unreachable (the completeness test caught it, not a human); the
`awaiting_approval`/`running` arms of `summarizeCollapsed` were dead since it only receives
terminal rows.

## Known limitations

- **Markdown rendering is gone, not just degraded.** Assistant messages now render as
  plain text: `MarkdownText.tsx` and `code-highlight.ts` were deleted in Phase 12 and
  nothing replaced them. Consequences: code blocks lose syntax highlighting, LaTeX is no
  longer converted to Unicode (the `\cdot` → `·` mapping etc.), and tables/lists render as
  raw markdown. This is the single largest remaining regression and it is why
  `scripts/md-demo.tsx` was deleted — it demoed a component that no longer exists (it
  remains in git history if the renderer comes back).
- **Row-level scrollback and mouse-wheel scrolling are gone**, replaced by the kit
  `MessageList` virtualization.
- **Batch approval is sequential.** Multiple tool calls in one turn prompt one at a
  time; the old Phase 11 `[1]..[9]` review-and-batch flow was not restored.
- **Per-message thinking** is still one global `Ctrl+T` toggle (unchanged from Phase 12).
- No ASCII/symbol fallback (dropped with the bespoke UI; spec §14 Check 7 now reports
  **skip** rather than passing).
- **Dead dependencies left by the migration:** `marked`, `highlight.js` and `chalk` are no
  longer imported anywhere in `src/`, `tests/` or `scripts/`. `marked` and `chalk` are also
  declared by the kit itself, so the top-level entries are redundant; `highlight.js` is
  purely unused. Not removed here because that is a packaging decision, not a fix — but
  `diff` **is** live again (it backs the `write_file` previews).
- `scripts/ui-rebrand-demo.tsx` is an **untracked** leftover from Phase 11 that imports
  `ink` (no longer installed) and five deleted modules. It cannot run. Left in place rather
  than deleted because it is untracked, but it should be removed.

## Follow-up work

1. Re-implement `/compare` (flagship spec §15 feature), then `/benchmark`, then `/replay`.
2. Restore batch approval + parallel prompting.
3. Click-to-copy should be confirmed in a real terminal — the PTY harness cannot assert
   clipboard contents, and OSC 52 permission prompts vary by terminal.
4. Cross-platform CI matrix (macOS/Windows/Linux) so `WINDOWS.md`'s "needs manual
   verification" can be retired.
