# xaku Development Walkthrough

A living record of everything discussed and built for xaku, the terminal workspace for chatting with, stress-testing, and reviewing local Ollama models. Keep this file updated as phases complete.

Last updated: 2026-10-24 (Phase 9: safe /retry with in-flight tools, auto-approve modes + `t` hotkey, streaming markdown; 123 tests passing)

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
| Markdown render | `marked` (lexer) → custom Ink renderer |
| Code highlighting | `highlight.js` core + language packs |
| Session log | JSONL files (`env-paths` app data dir) |
| CLI parsing | commander |
| SQLite | better-sqlite3 |
| Testing | Vitest + `ink-testing-library` |

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

### Phase 6 — Destructive tools, exports, cancellation, and fix/retry flows

**New tools** (all with workspace boundary enforcement via `path.resolve` + `fs.realpath` for symlink escapes):
- `write_file({ path, content })` — writes content, auto-creates parent directories within workspace
- `run_shell({ command })` — spawns shell with workspace as cwd, 30s timeout, 100KB output cap, cross-platform (`cmd.exe` on Windows, `/bin/sh -c` elsewhere)
- `query_db({ path, query })` — `better-sqlite3` read-only mode, validates `.sqlite`/`.db`/`.sqlite3` extension

**Tool infrastructure**:
- `ToolContext` expanded with `shellTimeoutMs`
- `src/tools/utils.ts`: shared `resolveWithinWorkspace()` (path + realpath checks) and `trimOutput()`
- `ToolPanel` previews: `write_file` shows file path + content preview, `run_shell` shows `$ command`, `query_db` shows db path + query

**Fix/retry flow completed**:
- `[f] fix`: sends error message back to model as tool result (labeled `fix` in log) so it can try a different approach
- `[r] retry`: re-executes the tool, sends result to model, resumes the turn
- `[s] skip`: sends "skipped by user" message, resumes the turn
- All choices logged as `tool_choice` events

**Cancellation**:
- `/cancel` command and `Esc` key abort in-flight generation
- `AbortController` plumbed through `streamCompletion`; `AbortError` caught cleanly
- Sets generating=false, clears partial/reasoning, adds "Generation cancelled." system message

**Missing slash commands implemented**:
- `/stats`: shows session statistics (messages, tokens, tool success/fail counts, model, temperature, log path)
- `/export`: generates `xaku-report-<timestamp>.md` + `.json` in workspace root (Markdown transcript + JSON data)
- `/save <name>`: saves last user prompt + system prompt as JSON to `casesDir`
- `/load <name>`: loads a saved test case into input + system prompt
- All 9 slash commands now fully functional

**Session logging fix**:
- `logger.close()` wired via `useEffect` cleanup → `session_end` event written on exit

**Tests**: 32 total, all passing (7 new tool tests + 7 new command tests)

### Phase 7 — Markdown + syntax highlighting (user-reported)

User feedback: *"the text format he is trying to apply does not work"* — model output contained LaTeX (`$ n $`, `\cdot`) and markdown (`**bold**`, code blocks) that was rendered as raw text.

- **Rendering approach**: opencode TUI reference — headings cyan+bold with `#` prefix, code blocks with `[lang]` label and left bar, blockquotes with left vertical bar, lists with `•`/`N.` bullets, bold/italic/inline code all styled.
- **`src/ui/MarkdownText.tsx`**: `marked.lexer` → custom renderer mapping block/inline tokens to Ink `<Text>` / `<Box>`. Only rendered on completed assistant messages (streaming `partial` stays plain to avoid flicker on unclosed markdown).
- **`src/ui/code-highlight.ts`**: `highlight.js/lib/core` with 13 languages registered (js/ts/py/bash/json/css/html/md/yaml/go/rust/sql). Parses the HTML span output via a stack-based tokenizer into `CodeSegment[]`; scope→color map uses xaku's dark palette (keyword=magenta, string=green, number=yellow, comment=gray, etc.). `splitSegmentsIntoLines()` converts flat segments into per-line segments for correct wrapping.
- **LaTeX handling** (`cleanLatex`, exported for tests): strips `$…$` / `$$…$$` delimiters (with `(?!\d)` lookaheads so `$5 to $10` currency is preserved); maps 100+ LaTeX commands to Unicode via a lookup table (`\cdot`→`·`, `\geq`→`≥`, `\infty`→`∞`, Greek letters, operators, big-operators, arrows, relations, set symbols); expands `\frac{a}{b}`→`(a)/(b)` and `\sqrt{x}`→`√(x)`; leaves unknown commands intact after stripping backslash.
- **Code blocks**: Ink's `borderStyle="single" borderLeft` for a clean vertical bar (no misaligned top/bottom when line widths differ); `[lang]` label above when language declared.
- **Tables**: monospace padding via `padEnd` per column — simple but readable.
- **ChatPanel**: assistant messages now render through `<MarkdownText />`; user/system/tool messages stay plain.
- **Tests**: added markdown tests (cleanLatex, isMathLike, highlightCode, splitSegmentsIntoLines, `<MarkdownText />` render via `ink-testing-library`) — **73 tests total, all passing**.

### Phase 8.1 — Tool cancellation via AbortController

**`ToolContext`**: added optional `abortSignal?: AbortSignal`.
**`ToolResult`**: added optional `cancelled?: boolean` to distinguish user-cancelled from execution errors.
**`ToolActivityStatus`**: added `'cancelled'` status.

**Behavior in `src/tools/run_shell.ts`**:
- If `abortSignal.aborted` on entry → return `{ cancelled: true }` immediately (no spawn)
- Register `abort` listener → on fire: SIGTERM the process, SIGKILL after 1s grace
- On `close` with cancelled flag set → return `{ error: 'Command cancelled', cancelled: true }`
- Always remove abort listener on finish (no leaks)

**Behavior in `src/tools/query_db.ts`**:
- Check `abortSignal.aborted` at three points: before opening DB, after `prepare()`, and after `all()`
- SQLite operations are synchronous so cancellation is only possible between phases, but covers the "already aborted" and "don't return huge results if cancelled mid-work" cases

**Wiring in `src/app.tsx`**:
- New `toolControllersRef: Map<string, AbortController>` tracks active tool executions keyed by `activityId`
- `executeToolActivity()` creates a controller before calling `executeToolCall`, deletes on completion
- `cancelGeneration()` now also: iterates the map, calls `.abort()` on each, and marks those activities as `'cancelled'`
- `ToolPanel.tsx` renders `'cancelled'` state with `↓ cancelled by user` in warning color

- **Tests**: 3 new (76 total, all passing):
  - Long-running `sleep 5` command cancels within 2s when aborted at 100ms
  - Already-aborted signal short-circuits both `run_shell` and `query_db` immediately
  - **Manual demo**: `scripts/md-demo.tsx` renders sample markdown (including the user's LaTeX report) for visual verification.

### Phase 8.2 — Spec §14 Acceptance Harness

**Goal**: Automated and manual verification of all 7 spec §14 acceptance criteria.

**New test files**:
- `src/logger.test.ts` — 2 tests for crash-safe session logging (Check 4)
- `src/commands/report.test.ts` — 3 tests for /export report structure and /stats consistency (Check 5)
- `src/ui/theme.test.ts` — 5 tests for Unicode/plain symbol fallback (Check 7)

**Theme.ts refactor**:
- Exported `getSymbols()` and `isPlainMode()` functions for testability
- `supportsUnicode()` now calls `isPlainMode()` to check `XAKU_PLAIN=1` and `TERM=dumb`
- All 5 symbol fallback tests verify ASCII-safe output in plain mode

**Acceptance harness** (`scripts/acceptance.ts`):
- Runs all automated checks (Checks 2, 3, 4, 5, 7) via unit tests
- Documents manual test procedures for Checks 1 and 6 (require Ollama)
- Provides pass/fail summary with actionable next steps

**Manual test documentation** (`MANUAL_TESTS.md`):
- Step-by-step procedures for all 7 acceptance checks
- Prerequisites (Ollama installation, model requirements)
- Troubleshooting guide for common issues
- Cross-platform path handling tests
- Long-running tool execution tests
- Session log integrity verification

**Test results**: 10 new tests (86 total, all passing)
- Check 2: Malformed tool calls labeled correctly ✅ (automated)
- Check 3: Workspace boundary enforced ✅ (automated)
- Check 4: Crash-safe logging with session_end ✅ (automated)
- Check 5: /export matches /stats ✅ (automated)
- Check 7: Symbol fallback works ✅ (automated)
- Check 1: Tool call approval flow ⚠️ (manual, requires Ollama)
- Check 6: Ollama disconnect handling ⚠️ (manual, requires Ollama)

### Phase 8.3 — Windows Caution Pass

**Goal**: Verify cross-platform path handling works correctly on Windows and document platform-specific considerations.

**New test file**:
- `src/tools/path.test.ts` — 10 tests for cross-platform path handling

**Tests added**:
1. Relative paths with forward slashes ✅
2. Relative paths with backslashes (Windows-style) ✅
3. Mixed separator handling ✅
4. Workspace boundary enforcement (`..` escapes) ✅
5. Absolute path blocking ✅
6. Paths within workspace ✅
7. Workspace root path ✅
8. Case-insensitive paths ✅
9. Drive letter paths (Windows-specific) ✅
10. Long paths on Windows ✅

**New documentation** (`WINDOWS.md`):
- Installation guide for Windows
- Platform-specific features (shell execution, path handling, symbol fallback)
- Known issues and workarounds (process termination, file locking, path length, terminal rendering)
- Manual testing procedures for Windows
- Troubleshooting guide
- Performance considerations
- Windows-specific paths and configuration

**Key findings**:
- Existing `resolveWithinWorkspace` implementation already handles Windows paths correctly via Node.js `path` module
- No code changes required — implementation was already cross-platform compatible
- Documented platform-specific behaviors: process termination, file locking, path length limits

**Test results**: 10 new tests (96 total, all passing)
- All existing 86 tests still passing
- Typecheck ✅
- Build ✅

**Documentation created**:
- `WINDOWS.md` — comprehensive Windows platform guide
- `docs/PHASE_8_3_SUMMARY.md` — phase summary and recommendations

### Phase 9 — Immediate pending items: safe /retry, auto-approve, streaming markdown

**1. `/retry` with in-flight tool calls (was unsafe)**:
- Root cause: `/retry` called `generate()` without aborting the running stream/tools; a cancelled generation left its `resumeGeneration` loop either suspended forever on an unresolved approval promise (leak) or continuing to stream and overwrite the new turn's state (race). Also, cancel mid-approval left assistant messages with `tool_calls` that never received tool results — sending a new prompt after those violates the OpenAI-compatible API contract.
- Fixes in `src/app.tsx`:
  - New `cleanupGeneration()` extracted from `cancelGeneration()`: bumps a `generationEpochRef`, aborts stream + all tool controllers, resolves any pending approval promises with `false`, marks running activities `cancelled`, resets state. `cancelGeneration()` = `cleanupGeneration()` + "Generation cancelled." message.
  - **Generation epoch guard**: every `resumeGeneration` loop captures `epoch = ++generationEpochRef.current` and bails at four checkpoints (top of while loop, after `streamCompletion` returns, after the approval promise, and the `finally` block only runs state resets if the epoch still matches). Stale loops can never clobber the current turn.
  - `/retry` handler now calls `cleanupGeneration()` (silent — no "cancelled" message) before regenerating. Old assistant/tool turns are deliberately **kept in history as context**; the retry appends a fresh copy of the last user prompt.
  - `fix`/`skip`/`retry` tool flows also call `cleanupGeneration()` first, so the still-streaming loop from the failed-turn continuation is invalidated rather than racing the resumed turn.
- New `fillMissingToolResults()` in `src/model/session.ts` (pure, tested): scans the history for assistant messages whose `tool_calls` lack matching `role:'tool'` results and inserts synthetic `Tool call was cancelled before completing.` messages right after the assistant message. Applied in `generate()` and `resumeGeneration()` so dangling calls can never reach the API.

**2. Auto-approve modes (spec §15)**:
- `Config.autoApprove: 'none' | 'read-only' | 'all'` (default `none`), settable via `--auto-approve <mode>` flag or `XAKU_AUTO_APPROVE` env; invalid values fail fast at startup with a clear message.
- Approval loop in `resumeGeneration()` checks `shouldAutoApprove(toolName)` before pausing: mode `all` approves everything, `read-only` uses the existing `ToolDefinition.isReadOnly` flag (`read_file`/`list_dir`/`query_db`). Auto-approved activities are marked `autoApproved` and logged as `tool_auto_approved` (with mode); manual flow unchanged.
- Toggle methods:
  - `/autoapprove [none|read-only|all]` slash command (alias `/auto`); bare `/autoapprove` reports the current mode.
  - **`[t]` hotkey** cycles none → read-only → all → none whenever a generation is in flight (same gating as `a/d/f/s/r`, so normal typing never conflicts). If the currently pending tool is covered by the newly selected mode, it is approved immediately — press `t` once for read-only, twice to release a pending `write_file`.
- UI: TopBar shows `· auto:read-only` (yellow) when active; ToolPanel renders `└ auto-approved` detail lines and the `[t] auto-approve` hint on pending prompts; input placeholder mentions the toggle.
- Mode changes are logged as `set_auto_approve` events (with `via: command|hotkey`).

**3. Streaming markdown**:
- `partial` now renders through `<MarkdownText />` live instead of staying plain until completion.
- `preprocessStreaming(text)` in `src/ui/MarkdownText.tsx` closes dangling constructs before lexing so the renderer never flickers on unclosed syntax: appends ` ``` ` when fence-opening lines are odd, closes unclosed inline code (`` ` ``), bold (`**`), strikethrough (`~~`) via odd-count detection (markers inside complete fenced/inline spans are ignored), and closes a trailing `[label](url` paren. Single `*`/`_` emphasis deliberately left alone (too ambiguous with bullets/words).
- `ChatPanel` streaming block restructured: `AssistantBlock` no longer wraps children in `<Text>` (Box-in-Text is invalid in Ink); the cursor `▌` is appended to the markdown content so it stays inline with the last line instead of popping to a new row.
- No debounce: `useMemo`-keyed re-lexing per content change is cheap at chat sizes and Ink diffs unchanged rows.

**Incidental fix**: `scripts/smoke.ts` and `scripts/tool-test.ts` still imported the pre-Phase-8 `src/ollama.js` path — updated to `src/model/ollama.js`. Re-verified live against Ollama: full tool round trip passes.

**Tests**: 27 new (123 total, all passing):
- `src/model/session.test.ts` — 6 tests: `fillMissingToolResults` identity/repair/ordering/custom-filler.
- `src/commands/commands.test.ts` — 5 new: `/autoapprove` modes, bare show, invalid mode, `/auto` alias, palette filtering.
- `src/ui/markdown.test.ts` — 14 new: 12 `preprocessStreaming` cases + 2 `ChatPanel` streaming renders.
- `src/tools/executor.test.ts` — 2 new: `isReadOnly` classification the auto-approve modes depend on.
- Typecheck ✅, build ✅, `scripts/tool-test.ts` live round trip ✅.

## 5. Current State

**Working & verified** (typecheck ✅, 123 tests ✅, PTY smoke ✅, real Ollama ✅ with qwen3:4b, spec §14 harness ✅):
- Fullscreen TUI: top bar, chat with live streaming + reasoning display, input with cursor/editing, stats bar pinned to the bottom.
- Responsive resize: expand/widen/shrink repaints cleanly.
- Streaming chat via Ollama; tok/s + context counters; connection status with retry.
- No hardcoded default model: silent auto-select of first installed model, `XAKU_MODEL` env or `-m` override, warn+fallback only for explicit-missing.
- Session logging (JSONL, crash-safe) with proper `session_end` on exit.
- All five tools: `read_file`, `list_dir`, `write_file`, `run_shell`, `query_db` — with workspace boundary (path + realpath), approval flow, fix/skip/retry choices.
- Cancellation: `/cancel` or `Esc` aborts in-flight generation AND running shell/database tools via per-tool `AbortController`.
- All nine slash commands: `/model`, `/temperature`, `/system`, `/clear`, `/retry`, `/stats`, `/export`, `/save`, `/load` — plus `/autoapprove` (alias `/auto`) from Phase 9.
- Command autocomplete palette with filtering, aliases, keyboard nav.
- Tool error flow: `fix` feeds error back to model, `retry` re-executes and resumes, `skip` sends skip message — all logged.
- Markdown rendering for assistant messages: headings, bold/italic, inline code, code blocks with syntax highlighting, lists, blockquotes, tables, links, images (as `[image: alt]`), strikethrough — plus LaTeX stripping with Unicode symbol substitution.
- Source organized into `src/commands/`, `src/model/`, `src/tools/`, `src/ui/` subfolders with 4 top-level files.
- Spec §14 acceptance harness: 5/7 checks automated, 2 require manual verification with Ollama (documented in `MANUAL_TESTS.md`).
- Safe `/retry` / cancel / fix-skip-retry with in-flight tools: generation-epoch guard stops stale loops from clobbering state; dangling tool calls are auto-filled before any new request (old turns kept as context).
- Auto-approve modes (`none` / `read-only` / `all`) via `--auto-approve`, `XAKU_AUTO_APPROVE`, `/autoapprove`, and the `[t]` hotkey; TopBar/ToolPanel indicators; all decisions logged.
- Live streaming markdown: partial output renders through the markdown pipeline with `preprocessStreaming` closing unclosed fences/spans/emphasis.

**Pending**:
- Windows manual verification (all 123 tests + install flow on a real Windows box; CI Windows runner recommended).
- Cross-platform CI (GitHub Actions matrix: macOS/Windows/Linux).

## 6. Later (designed for, per spec §15)
- Side-by-side model comparison (keep session/log model-agnostic).
- Custom tool-call format checkers; more DB types.
- UI polish roadmap (agreed to defer until core is done): collapsible tool sections, diff views, scrollback.

## 7. Reference: File Map

```
src/
  app.tsx              # state machine: chat loop, tool approvals, auto-approve modes, commands, hotkeys, cancellation, generation-epoch guard
  cli.tsx              # entry, alt-screen takeover, flags
  config.ts            # flags/env/defaults → Config (workspace, limits, paths, autoApprove)
  logger.ts            # JSONL session log
  logger.test.ts       # 2 tests (spec §14 Check 4)
  commands/            # Slash command system
    index.ts           # Command registry + parser (previously src/commands.ts)
    commands.test.ts   # 19 tests
    cases.ts           # /save & /load test case persistence
    report.ts          # /export: Markdown + JSON report builder
    report.test.ts     # 3 tests (spec §14 Check 5)
  model/               # Model connection layer
    ollama.ts          # Streaming client, model list, /api/show tool-support
    session.ts         # Message types, token estimation, fillMissingToolResults (dangling-call repair)
    session.test.ts    # 6 tests
  tools/               # Tool engine
    types.ts           # ErrorLabel, ToolResult, ToolContext
    utils.ts           # resolveWithinWorkspace (path+realpath), trimOutput
    registry.ts        # tool defs (read_file, list_dir, write_file, run_shell, query_db) + isReadOnly flags
    read_file.ts       # + workspace boundary, trimming
    list_dir.ts
    write_file.ts      # + auto-create parent dirs
    run_shell.ts       # + timeout, output cap, cross-platform
    query_db.ts        # + better-sqlite3 read-only
    executor.ts        # validate / execute / getToolDefinitions
    executor.test.ts   # 23 tests
  ui/                  # UI components
    theme.ts           # listr2-style symbols + unicode/plain fallback
    theme.test.ts      # 5 tests (spec §14 Check 7)
    MarkdownText.tsx   # marked lexer → Ink renderers + cleanLatex + preprocessStreaming
    code-highlight.ts  # highlight.js → CodeSegment[] with scope→color map + line splitter
    markdown.test.ts   # 55 tests
    TopBar.tsx  ChatPanel.tsx  InputLine.tsx  StatsBar.tsx
    CommandMenu.tsx  ToolPanel.tsx  ToolActivity.ts
scripts/
  smoke.ts             # manual: chat round-trip
  tool-test.ts         # manual: model→validate→execute→feedback
  md-demo.tsx          # manual: render sample markdown/LaTeX through <MarkdownText/>
  acceptance.ts        # spec §14 acceptance test harness (5 automated, 2 manual)
MANUAL_TESTS.md        # step-by-step procedures for manual acceptance checks
```

## 8. Change Log (append new entries at top)

- **2026-10-24 (later, 4)** — Phase 9: cleared the three long-standing pending items. (1) **Safe `/retry` / cancellation**: `cleanupGeneration()` extracted from `cancelGeneration()` — aborts stream + tools, resolves stuck approval promises, and bumps a `generationEpochRef` that every `resumeGeneration` loop checks at four points (loop top, after stream, after approval, guarded `finally`), so stale loops can no longer clobber a new turn or hang forever; `/retry` (and fix/skip/retry) clean up before regenerating, keeping old assistant/tool turns as context; new `fillMissingToolResults()` in `session.ts` repairs dangling `tool_calls` (assistant messages without matching tool results) before any request reaches the API. (2) **Auto-approve modes (spec §15)**: `Config.autoApprove` (`none`/`read-only`/`all`) via `--auto-approve` flag or `XAKU_AUTO_APPROVE` env; `/autoapprove` + `/auto` slash commands; **`[t]` hotkey** cycles modes during generation and immediately releases a pending tool that the new mode covers; leverages the existing `isReadOnly` tool flags; TopBar `auto:<mode>` indicator, ToolPanel `auto-approved` lines, `tool_auto_approved` / `set_auto_approve` log events. (3) **Streaming markdown**: live `partial` now renders through `<MarkdownText />` — `preprocessStreaming()` closes unclosed code fences, inline code, bold, strikethrough, and link parens (odd-count detection, markers inside complete spans ignored); cursor moved inline into the markdown so no pop-to-new-row; `AssistantBlock` fixed to not nest Box in Text. Incidental: `scripts/smoke.ts` + `scripts/tool-test.ts` imports repaired (stale pre-Phase-8 `src/ollama.js` path) and re-verified live end-to-end against Ollama. 27 new tests (123 total, all passing); typecheck ✅, build ✅.

- **2026-10-24 (later, 3)** — Phase 8.3: Windows Caution Pass. Added `src/tools/path.test.ts` with 10 tests for cross-platform path handling (forward slashes, backslashes, mixed separators, workspace boundaries, absolute paths, case-insensitivity, drive letters, long paths). Created `WINDOWS.md` with comprehensive Windows platform guide: installation, platform-specific features, known issues (process termination, file locking, path length, terminal rendering), manual testing procedures, troubleshooting, performance considerations. Key finding: existing `resolveWithinWorkspace` already handles Windows paths correctly via Node.js `path` module — no code changes required. 10 new tests (96 total, all passing).
- **2026-10-24 (later, 2)** — Phase 8.2: Spec §14 Acceptance Harness. Automated verification for 5/7 acceptance checks (Checks 2, 3, 4, 5, 7), with manual test procedures documented for Checks 1 and 6 (require Ollama). New test files: `src/logger.test.ts` (2 tests for crash-safe session logging), `src/commands/report.test.ts` (3 tests for /export structure and /stats consistency), `src/ui/theme.test.ts` (5 tests for Unicode/plain symbol fallback). Refactored `src/ui/theme.ts` to export `getSymbols()` and `isPlainMode()` for testability. Added `scripts/acceptance.ts` harness that runs automated checks and documents manual procedures. Created `MANUAL_TESTS.md` with step-by-step procedures for all 7 checks, troubleshooting guide, and cross-platform testing instructions. 10 new tests (86 total, all passing).
- **2026-10-24 (later)** — Phase 8.1: Tool cancellation. Added optional `abortSignal` to `ToolContext` and `cancelled` flag to `ToolResult`. `run_shell` listens for the signal, SIGTERMs the child process, escalates to SIGKILL after 1s. `query_db` checks the signal at three points (before open, before/after `all()`). New `toolControllersRef` map in `app.tsx` tracks active controllers; `cancelGeneration()` now aborts them too and marks their activities `'cancelled'`. Added `'cancelled'` status to `ToolActivity` and rendering in `ToolPanel`. 3 new tests (76 total).
- **2026-10-24** — Source reorganization. Root `src/` had 10 files; grouped into subfolders for clarity:
  - `src/commands/` — new folder containing `index.ts` (was `commands.ts`), `commands.test.ts`, `cases.ts`, `report.ts`
  - `src/model/` — new folder containing `ollama.ts` and `session.ts`
  - Root `src/` now has only 4 files: `app.tsx`, `cli.tsx`, `config.ts`, `logger.ts`
  - All import paths updated in `app.tsx`, `commands/*`, `model/*`, `ui/ChatPanel.tsx`, `ui/InputLine.tsx`, `ui/CommandMenu.tsx`, `ui/markdown.test.ts`. Typecheck ✅, 73 tests ✅, build ✅.
- **2026-10-21 (later, 2)** — LaTeX-stripping refinement. Replaced the `(?!\d)`/`(?<!\d)` currency guard in `cleanLatex` with an `isMathLike()` signal gate (exported for tests): strip `$…$` / `$$…$$` only when the inner content contains a math signal (Greek/Unicode math symbol, `^`, `\`command, parens-with-operator, or a lone/short variable letter). `$2π rh$` and `$2π r(r + h)$` now strip correctly while `costs $5 to $10` and `$1,234.56` stay intact as currency. Inline `$…$` now also crosses a single soft-wrap newline via `\n(?!\n)` so `…where r is\n the radius and h$` is stripped, while blank-line paragraph breaks stay isolated. 3 new tests (73 total).
- **2026-10-21 (later)** — Phase 7: Markdown rendering for assistant messages. `src/ui/MarkdownText.tsx` (marked lexer → Ink) with headings, bold/italic/strikethrough, inline code, code blocks with `highlight.js` syntax highlighting (13 languages registered), lists, blockquotes, tables, links, images. LaTeX: `cleanLatex` strips `$…$`/`$$…$$`, maps 100+ commands to Unicode (`\cdot`→`·`, `\geq`→`≥`, greek, arrows, operators), expands `\frac{a}{b}`→`(a)/(b)`, `\sqrt{x}`→`√(x)`. Streaming `partial` stays plain to avoid flicker; complete messages render markdown. 19 new tests. `scripts/md-demo.tsx` for manual visual check.
- **2026-10-21** — Phase 6: destructive tools (`write_file`, `run_shell`, `query_db`), `/cancel` + `Esc` abort, `/stats`, `/export` (Markdown+JSON), `/save`/`/load`, fix/retry/skip flows completed (feed back to model, resume turn), `logger.close()` wired, 32 tests passing.
- **2026-10-18 (later)** — Removed hardcoded default model (`qwen3:8b`): startup now auto-selects the first installed model silently (`Config.model: string | null`, logged as `set_model reason:auto`); added `XAKU_MODEL` env; explicit `-m`/env model still warns+falls back when missing; top bar shows `—` before resolution. Verified all three paths via PTY.
- **2026-10-18** — Responsive resize. User reported content duplicating when expanding the terminal. Root cause found: `height="100%"` on the root Box does NOT resolve (Ink calls `calculateLayout(undefined, undefined)` — no containing height), so the frame collapsed to content height (~5 lines), the stats bar floated mid-screen instead of pinning to the bottom, and Ink's line-count diff renderer (`log-update` eraseLines) couldn't keep up with terminal-side reflow after resize → stale/duplicated rows. An interim fix (manual `\x1b[2J` + forced repaint on resize) was tried and REVERTED: it raced Ink's own resize handler and the `output === lastOutput` guard skipped the redraw → blank screen. Final fix: track live terminal height via `useStdout()` + `resize` listener, set numeric `height={termRows}` on the root Box → frame always fills the screen → Ink takes its clearTerminal + full-repaint path (`outputHeight >= rows`) on every render, resize included; `overflow="hidden"` on root + middle row keeps tall chat/tool content from bleeding into the input/stats rows; `flexShrink={0}` on the InputLine wrapper. Bonus: stats bar now genuinely pins to the bottom. Verified with a `pty.fork()` + VT-emulator harness (top bar row 0, stats row `rows-1`, exactly once each) through expand/widen/shrink with a completed chat turn. Gotcha recorded: the PTY harness must drain master output WHILE typing or pty backpressure stalls the app's stdin handling (looked like broken Enter).
- **2026-10-17 (later)** — Phase 5: command palette with descriptions, filtering, aliases, keyboard nav; 7 tests added (16 total).
- **2026-10-17** — Phase 4: alt-screen fullscreen TUI; fixed macOS backspace (Ink DEL→key.delete), auto model fallback, error classification, `⠋ checking ollama…`, readline shortcuts, tool-prompt key gating, chat windowing.
- **2026-10-17 (earlier)** — Phases 0–3: bootstrap, streaming chat + stats bar, qwen3 thinking mitigations (reasoning display + default anti-thinking system prompt), JSONL session logging, core slash commands, read-only tool engine with approval flow, right-panel tool UI, 9 engine tests. Pulled `qwen3:4b`; verified real tool call round-trip.
- **2026-10-17 (planning)** — Read spec, locked 7 decisions, agreed build order; project renamed open-bench → xaku, command `runxaku`.
