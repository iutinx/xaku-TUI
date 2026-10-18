# xaku Development Walkthrough

A living record of everything discussed and built for xaku, the terminal workspace for chatting with, stress-testing, and reviewing local Ollama models. Keep this file updated as phases complete.

Last updated: 2026-10-18 (Phases 0–5 complete, tool UI integrated, responsive resize fixed, no-default-model auto-select)

---

## 1. Overview & Naming

- The original spec (`docs/GUIDE.md`, "Open-BenchTUI v1") was renamed throughout: **everything "open-bench" is now "xaku"**.
- Launch command: `runxaku`
- npm package name: `xaku-tui`
- Primary job for v1: let the developer see how a fine-tuned model performs — response quality, speed, and tool-use correctness.

## 2. Locked Decisions (from spec §16 open items)

| # | Item | Decision |
|---|------|----------|
| 1 | Right panel | Hidden until first tool call, then ~50/50 split |
| 2 | Shell timeout | 30 s |
| 3 | Result trim limit | 100 KB sent back to model |
| 4 | Tool-support check | Ollama `/api/show` → `capabilities` array (verified on Ollama 0.40.5: `["completion","tools","thinking"]`) |
| 5 | Visual style | Reproduce listr2 look (tree connectors, ✔ ✖ ↓, spinners) with custom Ink components, don't embed listr2 |
| 6 | SQLite library | `better-sqlite3` |
| 7 | Testing | Vitest for engine/validator/logger/export logic |
| 8 | Default model | None. `Config.model: string \| null`; startup auto-selects the first installed model silently. Override with `-m` flag or `XAKU_MODEL` env; explicit-but-missing model → warn + fall back |

## 3. Tech Stack

| Area | Choice |
|------|--------|
| Language | Node.js (v25) + TypeScript (ESM, `NodeNext`) |
| UI | Ink 5 + React 18 |
| Model connection | official `openai` npm package pointed at Ollama `/v1` |
| Validation | Zod + `zod-to-json-schema` |
| Session log | JSONL files (`env-paths` app data dir) |
| CLI parsing | commander |
| SQLite | better-sqlite3 (pending Phase 6 use) |

Config resolution order: CLI flags → env (`XAKU_BASE_URL`, `XAKU_MODEL`) → defaults (`http://localhost:11434/v1`, temp `0.2`). No default model: if neither `-m` nor `XAKU_MODEL` is set, xaku quietly uses the first installed model at startup; the "not installed / switched" warning only appears when the user explicitly configured a missing model.

## 4. What Was Built, Phase by Phase

### Phase 0 — Bootstrap
- `package.json` (bin: `runxaku`), `tsconfig.json`, `.gitignore`, npm deps installed.
- Scripts: `npm run dev` (tsx), `npm run build`, `npm test`, `npm run typecheck`.

### Phase 1 — Basic chat + stats
- Connection layer (`src/ollama.ts`): OpenAI-compatible streaming with `stream_options: { include_usage: true }`, tool-call delta aggregation, model list via `/api/tags`, tool-support check via `/api/show`.
- Layout (`src/app.tsx`, `src/ui/*`): top bar (model · temp · system-prompt indicator), chat panel, input line with block cursor, always-visible stats bar (tok/s, context length, tool ✔/✖ counters, connection status).
- **Qwen3 discovery**: qwen3 models emit a long `reasoning` stream before `content`, and can spend the whole token budget thinking. Two mitigations shipped:
  1. `reasoning` is captured and displayed live (dim italic) so the UI never looks frozen.
  2. Default system prompt *"You are a helpful assistant. Answer directly and concisely."* dramatically reduces thinking overhead. (`enable_thinking:false` did NOT pass through the openai client — unknown params are stripped.)
- Smoke harness: `scripts/smoke.ts` (chat), `scripts/tool-test.ts` (full tool-call round trip).

### Phase 2 — Session logging
- `src/logger.ts`: append-only JSONL, one file per session (`$APpdata/logs/session-<ts>.jsonl`), each event written immediately (crash-safe).
- Events logged: session_start, user_message, assistant_message (incl. reasoning, tool calls, tokens), tool_call, tool_success, tool_denied, tool_error, command, setting changes, model_not_found, connection_error.

### Phase 3 — Tool engine (read-only tools)
- `src/tools/types.ts`: `ErrorLabel` (`unknown_tool | malformed_call | denied | blocked | execution_error | no_tool_support`), `ToolResult`, `ToolContext`.
- `src/tools/registry.ts` + `read_file.ts` + `list_dir.ts`: Zod schemas, workspace-boundary enforcement (path.resolve prefix check → `blocked`), result trimming at 100 KB.
- `src/tools/executor.ts`: `validateToolCall()` (unknown tool / bad JSON / schema fail), `executeToolCall()`, `getToolDefinitions()` (JSON schema for the API).
- Approval flow in `app.tsx`: tool calls pause generation, render in the right panel, resolve via a promise per activity (`approvalResolvers`), results sent back as `role:'tool'` messages, then the loop re-queries the model until it finishes.
- UI: `ToolPanel.tsx` (listr2-style statuses: `⠋ awaiting approval / ✔ success + duration / ✖ failed / ↓ skipped`, indented detail lines, preview), `ToolActivity.ts` types.
- Verified end-to-end with `scripts/tool-test.ts`: model called `read_file({path:"test.txt"})` → validated → executed → result fed back → final answer.
- 9 Vitest tests: validation labels, read/list success, ENOENT, workspace escape blocked.

### Phase 4 — Fullscreen TUI + input fixes (user-reported)
User feedback: *"it's not really like a claude code or opencode tui… the terminal clears and the whole interface is a TUI"* and *"i can't delete what i say"*.

Four fixes:
1. **Alternate screen buffer** (`cli.tsx`): enters `\x1b[?1049h` + clears on launch, restores `\x1b[?1049l` + cursor on exit/SIGINT/uncaughtException. Terminal takeover like Claude Code/opencode.
2. **macOS backspace** (`InputLine.tsx`): Ink maps `\x7f` (the bytes macOS terminals send for Backspace) to `key.delete`, not `key.backspace`. We treated `key.delete` as forward-delete with the cursor at end-of-line → silent no-op. Now plain `key.delete` deletes **backward**; `meta+delete` (⌥⌫) deletes the previous word.
   - Note: earlier PTY "verification" was a false positive — piped bytes arrive as one chunk and echo raw DELs. Re-tested with realistic per-keystroke timing.
   - Known trade-off: real forward-delete (`Fn+⌫`, `\x1b[3~`) is indistinguishable via Ink's useInput, so it also deletes backward (same as ink-text-input).
3. **Auto model selection**: startup connection check lists installed models and picks one automatically — no more `404 qwen3:8b not found` dead-ends. Refined later (2026-10-18): with nothing configured, the first installed model is used *silently*; the "not installed / switched to…" chat warning appears only when the user explicitly configured a missing model via `-m` or `XAKU_MODEL` (see §2 #8).
4. **Error classification**: a 404 is now shown as a model error (with `ollama pull …` hint) without flipping the connection badge; only network errors mark "disconnected" (with Enter-to-retry banner). Added `⠋ checking ollama…` startup state in the stats bar.

Also in this phase:
- Global hotkeys (`a/d/f/s/r`) now only capture keys while a tool prompt is pending — normal typing never conflicts.
- Readline shortcuts: `Ctrl+W` (word), `Ctrl+U` (line), `Ctrl+A/E` (home/end).
- Coalesced input chunks (paste/key-repeat) applied char-by-char.
- Chat panel windows the last 12 messages ("… N earlier messages (in session log)") to keep the fixed layout stable.
- `/model <name>` runs the tool-support check and warns if absent.

### Phase 5 — Slash-command palette (user-reported)
User feedback: *"/models has no popup like opencode… a menu showing what you can type and a description"*.

- `commands.ts` is now a registry: `COMMANDS: CommandDef[]` with name, description, hint (`<0-2>`, `[name]`), aliases (`temp` → `temperature`), plus `getFilteredCommands()`.
- `CommandMenu.tsx`: bordered popup above the input; selected row highlighted cyan/inverted; footer hint `↑↓ navigate · Tab complete · Enter run · Esc close`; scrolls a max-8-row window to keep the selection visible.
- Behavior: typing `/` opens the full list; prefix filters live (aliases included); `Tab` completes to `/name `; `Enter` runs an exact match or completes a partial one; `Esc` dismisses; menu auto-hides once arguments are typed.
- 7 more Vitest tests (filtering, aliases, typo suggestion, parsing) — **16 tests total, all passing**.

## 5. Current State

**Working & verified** (typecheck ✅, 16 tests ✅, PTY smoke ✅, real Ollama ✅ with qwen3:4b):
- Fullscreen TUI: top bar, chat with live streaming + reasoning display, input with cursor/editing, stats bar pinned to the bottom.
- Responsive resize: expand/widen/shrink repaints cleanly (numeric `height={termRows}` via `useStdout()` resize listener; no duplicated or blank frames).
- Streaming chat via Ollama; tok/s + context counters; connection status with retry.
- No hardcoded default model: silent auto-select of first installed model, `XAKU_MODEL` env or `-m` override, warn+fallback only for explicit-missing (`Config.model: string | null`).
- Session logging (JSONL, crash-safe).
- Tools `read_file` + `list_dir` with validation, workspace safety, approval flow (`[a]/[d]`), results fed back to the model.
- Commands: `/model` (list + switch + tool-support warning), `/temperature`, `/system`, `/clear`, `/retry`, plus the autocomplete palette for all nine.

**Pending**:
- Tool panel error choices (`[f] fix` feeds error back to model — currently fix≈skip; `[r]` retry executes but doesn't yet resume the model turn).
- Tools: `write_file`, `run_shell`, `query_db` + their safety rules (full preview, symlink/realpath checks, timeout, read-only SQLite).
- Commands: `/stats`, `/export` (Markdown + JSON matching stats), `/save`, `/load`.
- `/retry` after tool turns, and mid-session Ollama-kill banner test (spec §14).
- Cross-platform: Windows path normalization + shell invocation, plain-symbol fallback (`XAKU_PLAIN=1` exists, untested on Windows terminals).
- No way to cancel an in-flight generation yet.

## 6. Later (designed for, per spec §15)
- Side-by-side model comparison (keep session/log model-agnostic).
- Custom tool-call format checkers; more DB types; optional auto-approve for trusted read-only tools.
- UI polish roadmap (agreed to defer until core is done): markdown rendering (biggest visual win, ~1h), syntax-highlighted code blocks, collapsible tool sections, diff views, scrollback.

## 7. Reference: File Map

```
src/
  cli.tsx              # entry, alt-screen takeover, flags
  config.ts            # flags/env/defaults → Config (workspace, limits, paths)
  app.tsx              # state machine: chat loop, tool approvals, commands, hotkeys
  ollama.ts            # streaming client, model list, /api/show tool-support
  session.ts           # message types, token estimation
  logger.ts            # JSONL session log
  commands.ts          # command registry + parser
  tools/
    types.ts           # ErrorLabel, ToolResult, ToolContext
    registry.ts        # tool defs (read_file, list_dir)
    read_file.ts       # + workspace boundary, trimming
    list_dir.ts
    executor.ts        # validate / execute / getToolDefinitions
    executor.test.ts   # 9 tests
  commands.test.ts     # 7 tests
  ui/
    theme.ts           # listr2-style symbols + unicode/plain fallback
    TopBar.tsx  ChatPanel.tsx  InputLine.tsx  StatsBar.tsx
    CommandMenu.tsx  ToolPanel.tsx  ToolActivity.ts
scripts/
  smoke.ts             # manual: chat round-trip
  tool-test.ts         # manual: model→validate→execute→feedback
```

## 8. Change Log (append new entries at top)

- **2026-10-18 (later)** — Removed hardcoded default model (`qwen3:8b`): startup now auto-selects the first installed model silently (`Config.model: string | null`, logged as `set_model reason:auto`); added `XAKU_MODEL` env; explicit `-m`/env model still warns+falls back when missing; top bar shows `—` before resolution. Verified all three paths via PTY.
- **2026-10-18** — Responsive resize. User reported content duplicating when expanding the terminal. Root cause found: `height="100%"` on the root Box does NOT resolve (Ink calls `calculateLayout(undefined, undefined)` — no containing height), so the frame collapsed to content height (~5 lines), the stats bar floated mid-screen instead of pinning to the bottom, and Ink's line-count diff renderer (`log-update` eraseLines) couldn't keep up with terminal-side reflow after resize → stale/duplicated rows. An interim fix (manual `\x1b[2J` + forced repaint on resize) was tried and REVERTED: it raced Ink's own resize handler and the `output === lastOutput` guard skipped the redraw → blank screen. Final fix: track live terminal height via `useStdout()` + `resize` listener, set numeric `height={termRows}` on the root Box → frame always fills the screen → Ink takes its clearTerminal + full-repaint path (`outputHeight >= rows`) on every render, resize included; `overflow="hidden"` on root + middle row keeps tall chat/tool content from bleeding into the input/stats rows; `flexShrink={0}` on the InputLine wrapper. Bonus: stats bar now genuinely pins to the bottom. Verified with a `pty.fork()` + VT-emulator harness (top bar row 0, stats row `rows-1`, exactly once each) through expand/widen/shrink with a completed chat turn. Gotcha recorded: the PTY harness must drain master output WHILE typing or pty backpressure stalls the app's stdin handling (looked like broken Enter).
- **2026-10-17 (later)** — Phase 5: command palette with descriptions, filtering, aliases, keyboard nav; 7 tests added (16 total).
- **2026-10-17** — Phase 4: alt-screen fullscreen TUI; fixed macOS backspace (Ink DEL→key.delete), auto model fallback, error classification, `⠋ checking ollama…`, readline shortcuts, tool-prompt key gating, chat windowing.
- **2026-10-17 (earlier)** — Phases 0–3: bootstrap, streaming chat + stats bar, qwen3 thinking mitigations (reasoning display + default anti-thinking system prompt), JSONL session logging, core slash commands, read-only tool engine with approval flow, right-panel tool UI, 9 engine tests. Pulled `qwen3:4b`; verified real tool call round-trip.
- **2026-10-17 (planning)** — Read spec, locked 7 decisions, agreed build order; project renamed open-bench → xaku, command `runxaku`.
