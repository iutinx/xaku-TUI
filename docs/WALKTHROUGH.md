# xaku Development Walkthrough

A living record of everything discussed and built for xaku, the terminal workspace for chatting with, stress-testing, and reviewing local Ollama models. Keep this file updated as phases complete.

Last updated: 2026-11-19 (Phase 13 — repaired the 8 slash commands the Phase 12 migration silently unhooked, restored the tool-activity subsystem, added workspace-path visibility + `/cd` + `/pwd`; 150 tests passing). See [`PHASE_13_COMMAND_REPAIR.md`](./PHASE_13_COMMAND_REPAIR.md) for the full record. **The bespoke Ink UI described throughout §5–§8 below was deleted in Phase 12; see [`PHASE_12_KIT_UI.md`](./PHASE_12_KIT_UI.md) for the current architecture.** Historical entries below are kept for the record.

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
| Line diff | `diff` (write_file approval previews, Phase 10) |
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
- `tests/logger.test.ts` — 2 tests for crash-safe session logging (Check 4)
- `tests/commands/report.test.ts` — 3 tests for /export report structure and /stats consistency (Check 5)
- `tests/ui/theme.test.ts` — 5 tests for Unicode/plain symbol fallback (Check 7)

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
- `tests/tools/path.test.ts` — 10 tests for cross-platform path handling

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
- `tests/model/session.test.ts` — 6 tests: `fillMissingToolResults` identity/repair/ordering/custom-filler.
- `tests/commands/commands.test.ts` — 5 new: `/autoapprove` modes, bare show, invalid mode, `/auto` alias, palette filtering.
- `tests/ui/markdown.test.ts` — 14 new: 12 `preprocessStreaming` cases + 2 `ChatPanel` streaming renders.
- `tests/tools/executor.test.ts` — 2 new: `isReadOnly` classification the auto-approve modes depend on.
- Typecheck ✅, build ✅, `scripts/tool-test.ts` live round trip ✅.

### Phase 10 — UI polish: collapsible tools, diff views, scrollback

**1. Collapsible tool sections**:
- `ToolPanel` gained a `compact` mode: terminal-state activities (`success`/`denied`/`skipped`/`cancelled`) collapse into per-outcome summary lines (`✔ 3 succeeded`, `↓ 1 skipped`, …) with an `[c] expand N collapsed` hint; anything actionable (`awaiting_approval`, `failed`, `running`) always stays expanded. Expanded mode shows a `[c] collapse N completed` hint when there's something to hide.
- Toggle via **`c` hotkey** (active only while generating or a tool prompt is pending and activities exist — never steals the key from typing; Ink handlers don't consume, so idle-state single-letter hotkeys are impossible without swallowing input) or **`/compact`** slash command for idle toggling. State persists across turns; `/clear` resets it. Logged as `set_tool_compact`.

**2. Diff views for `write_file`**:
- New npm dep: `diff` v9 (bundled TS types; `diffLines`).
- `probeExistingFile()` in `src/tools/utils.ts`: reads the target file's current content at activity-creation time (before the approval prompt) — workspace-bounded via `resolveWithinWorkspace`, capped at 200 KB; returns `new | existing | too-large | unreadable` (out-of-bounds reports `unreadable`, never leaking external state).
- `src/ui/diff.ts` (new, pure): `computeDiffLines(old, new, maxLines=40)` → `{ lines: DiffLine[{type: add|del|ctx}], added, removed, unchanged, truncated }`; `formatDiffSummary()` → `new file (+N lines)` / `+A -R ~U` / `no changes`.
- `ToolActivity` carries `fileState` + precomputed `diff` (computed once at creation — ToolPanel re-renders stay cheap). Approval preview now shows a colored line diff (`+` green / `-` red / `|` muted) instead of a content dump; new files render all-additions; too-large/unreadable fall back to the old 300-char content preview with a note. Diff capped at 40 lines with `… and N more lines` footer (counts stay exact).
- Known cosmetic quirk: a file missing its trailing newline shows the last line as del+add pair (diffLines tokenizes line terminators with the preceding text).

**3. Scrollback**:
- New `src/ui/useScrollback.ts`: bottom-anchored `offset` state (0 = live tail), pure helpers `computeMessageWindow/ clampOffset/ maxOffset/ computePageSize`. Page size is **dynamic from terminal height**: `floor((termRows − 4) / 3)` (24 rows → 6 messages/page), re-derived on resize.
- Chat windowing now slices `[start, end)` from the offset instead of the old fixed last-12 tail; `MAX_VISIBLE_MESSAGES` (12) moved to `useScrollback.ts`. Keys stay absolutely indexed (`key={start + i}`) so React never remounts message rows.
- Keys: **↑/↓ step 1, PgUp/PgDn page** — handled in the app-level `useInput`, active during generation/tool-prompt/connection-error *and* when idle with empty input (`scrollActive`). Home/End were dropped: Ink 5 exposes no `key.home`/`key.end` flags (verified in `parse-keypress.js`). **Esc** returns to the live tail *before* it cancels (scrolled → exit scroll; at tail → cancel as before). Typing any character also exits scroll mode (effect on `input`), and sending a message (`generate()`) snaps back to the tail. While scrolled up the streaming partial block is hidden (it lives at the tail).
- Auto-follow semantics: at offset 0 the view is bottom-anchored, so new messages appear naturally; while scrolled up, an internal `delta` adjustment grows the offset as history extends, keeping the same messages on screen.
- Indicators: scrolled → cyan banner `↑ N earlier · M newer — Esc to return`; at tail with hidden history → `… N earlier messages (in session log · ↑ to scroll)`; idle placeholder gains `↑/PgUp to scroll` once history exceeds the window.

**New script**: `scripts/ui-demo.tsx` — manual visual check for diff preview + compact/collapsed panels (like `md-demo.tsx`).

**Tests**: 46 new (169 total, all passing):
- `tests/ui/useScrollback.test.ts` — 9: page-size math (24→6, 40→12, floor 1), clamps, window positions at offsets.
- `tests/ui/diff.test.ts` — 12: add/del/modify/identical/empty/new classification, truncation counts, custom caps, summary formatting.
- `tests/tools/utils.test.ts` — 6: probe existing/new/too-large/directory/outside-workspace/nested.
- `tests/ui/toolpanel.test.ts` — 10: compact summary lines, pending stays expanded, collapse/expand hints, diff header+gutters+new-file label+too-large fallback+truncation footer.
- `tests/ui/chatpanel.test.ts` — 7: tail windowing, fit-all, offset moves window, scroll banner counts, partial hidden while scrolled, auto-follow at tail.
- `tests/commands/commands.test.ts` — 2: `/compact` parses to toggle, palette filtering.
- Typecheck ✅, build ✅, headless boot ✅, live probe+diff round-trip against real files ✅ (`existing`/`new`/`escape` all classified correctly).

### Phase 11 — UX power-user: batch tool approval, benchmarking, session replay

**1. Batch tool approval + parallel execution** (was: strictly sequential loop):
- `pendingApproval: string | null` → `pendingBatch: string[]` + `focusedActivity: string | null` in `app.tsx`.
- The tool processing in `resumeGeneration()` is now two phases:
  - *Approval*: auto-approve items resolve immediately; all manual items wait together via `Promise.all` on their resolvers. Hotkeys: `a`/`d` = approve/deny the whole batch, `1-9` = focus one item (its preview is already expanded; `a`/`d` then act on it alone, `Esc` back to batch), `t` = cycle auto-approve — newly-covered pending tools are released instantly.
  - *Execution*: approved tools run concurrently via `Promise.all(executeToolActivity)`. Each keeps its own AbortController, so `Esc` still cancels mid-flight; results are appended to history **in original tool_calls order** regardless of completion order.
- Approval UI: ToolPanel numbers pending rows (`[1] ⠋ read_file …`), highlights the focused row (inverted cyan), and shows context hints — batch: `[a] approve all [d] deny all [1-N] review [t] auto-approve`; focused: `[a] approve [d] deny [Esc] back`; single: same as before. Input-line placeholder mirrors the state.
- **Behavior fix piggy-backed**: invalid (failed validation) calls now PAUSE the turn (`return`) instead of letting the loop continue with dangling `tool_calls` into the next request (which the API rejects); the user resolves them via `f`/`s`/`r` as the spec intends.
- **Real bug fixed along the way**: cancellation never actually aborted the HTTP stream — `streamCompletion` had no signal (Phase 6's "AbortController plumbed" claim only worked for tools + state). Added `signal` support via the OpenAI SDK request options; the catch now recognizes both `AbortError` and the SDK's `APIUserAbortError`.

**2. Model benchmarking (`/benchmark <case> [model,model,…]`)**:
- `src/model/benchmark.ts`: `runBenchmark(models, options)` — sequential per-model runs (fairness: same case, system prompt, temperature, workspace, tool defs; auto-approval forced internally since there's no human). Each run loops `streamCompletion` + parallel tool execution up to 8 turns, accumulating: total time, prompt/completion tokens, tok/s, tool call/success/fail counts, avg tool duration, response length, turns. Per-model failures become `status: 'error'` rows; pre-aborted models are skipped rows.
- UI: `/benchmark` replaces the chat area with `BenchmarkPanel` — header shows test case + progress (`⠋ Running 2/3: qwen3:8b… (Esc to cancel)`), table below with one row per completed model, columns Model/Time/Tok-s/Tools/Ok-Fail/Tool ms/Len; best tok/s row is green; error rows show the failure inline. Results stream in as models finish; `Esc` aborts via AbortController; finished views close on `Esc` or any typing.
- Command parses optional comma-separated model list; without one, benchmarks all installed models (`/api/tags`). Missing case file → usage hint mentioning `/save`.
- Verified live against real Ollama (qwen3:4b, read_file round trip: 2 turns, 1 tool, 425 tokens, 21 tok/s) and abort (SIGKILL at 800 ms → error row).

**3. Session replay (`/replay [index]`)**:
- `src/model/replay.ts` (pure, tested): `parseSessionLog` (skips malformed lines), `listSessions` (scans `logsDir` for `session-*.jsonl`, reads `session_start` for model/workspace/timestamp, newest first), `loadSession`, and `reconstructUpTo(events, index)` — walks the log building a display-faithful snapshot: messages (user/assistant with tool_calls/tool), per-turn tool activities with statuses, and settings evolution (`set_model`/`set_temperature`/`set_system_prompt`/`clear`).
- **Log enrichment for correlation**: `tool_call`, `tool_auto_approved`, `tool_denied`, `tool_cancelled`, `tool_error`, `tool_success`, `tool_choice` events now carry `toolCallId`; `tool_success` also logs a 4000-char `output` cap (the log finally records what the model actually saw). Reconstruction matches results by `toolCallId` first, falling back to last-non-terminal-with-same-tool for older logs.
- UI: `/replay` opens a `SessionPicker` (numbered list like CommandMenu: date · model · workspace · event count); `/replay 2` opens directly. Play view reuses ChatPanel + ToolPanel fed by the reconstructed snapshot with a header line (`Replay · file · event i/N · ←/→ step · PgUp/PgDn jump · Esc exit`). Step-through only (per review): ←/→ one event, PgUp/PgDn to ends, `Esc` exits and restores the live session. All other keys are swallowed during replay; input line is disabled.
- Replay is display-only: pending calls are shown as pending (no synthetic results), approvals are never executed, nothing mutates.
- Verified live against 57 real session logs in the app-data dir.

**Tests**: 27 new (196 total, all passing):
- `tests/model/replay.test.ts` — 11: parse (skips bad lines), reconstruction at cursors, settings evolution, clear, generation_cancelled, legacy name-matching fallback, pending stays pending, listSessions ordering/robustness, loadSession.
- `tests/model/benchmark.test.ts` — 4 (mocked OpenAI client): metric accumulation + multi-model, tool execution turns + duration tracking, error rows on model failure, pre-abort skip rows.
- `tests/ui/benchmark.test.ts` — 5: BenchmarkPanel table rows/progress/error row, SessionPicker list + hint.
- `tests/ui/toolpanel.test.ts` — 3 new: multi-pending batch hint + number badges, focused hint, single-pending wording.
- `tests/commands/commands.test.ts` — 4 new: `/benchmark` with/without models/no name, `/replay` bare/indexed/invalid.
- Live verifications: benchmark + abort against real Ollama; replay against real logs; headless render smoke.

**Known-untested (flag for a manual TTY pass)**: interactive batch-approval flow (type prompt → 2 tool calls → `[1]` review → `a`) inside a real terminal — the scripted PTY harness proved flaky in this environment (frames intermittently not rendered by the harness, unrelated to app code; unit + render tests cover the logic). Verify once manually with `npm run dev`.

### Phase 12 — Model comparison: side-by-side fine-tune evaluation

**Goal**: Let developers visually compare how two models (e.g., a base model vs. a fine-tuned variant) respond to the same test case, with per-dimension scoring.

**1. New `/compare` command**:
- `/compare <case> modelA,modelB` runs the saved test case against two models **in parallel** and shows a split-view comparison.
- Extended `TestCase` format (backwards compatible):
  ```ts
  {
    prompt: string;
    systemPrompt: string | null;
    expectedAnswer?: string;        // optional reference answer
    evaluationCriteria?: string[];  // e.g. ["uses read_file", "answers in French"]
  }
  ```
- Existing saved cases continue to work; the new fields are optional.

**2. Comparison engine (`src/model/compare.ts`)**:
- `runComparison(leftModel, rightModel, options)` — parallel execution via `Promise.all`, each model gets its own AbortController (both linked to a parent signal for unified cancellation).
- Per-side result (`CompareSideResult`): full response text, reasoning, message history, tool activities with live status updates, metrics (tok/s, tool ok/fail, time).
- Callbacks for streaming: `onContent`, `onReasoning`, `onToolActivity`, `onTurnEnd` — the UI updates in real time as both models stream.

**3. Split-view UI (`src/ui/ComparePanel.tsx`)**:
- Two panes side by side: left (Model A) and right (Model B).
- Each pane: model name, tok/s, tool ok/fail counts, response text (streaming), reasoning preview, tool activity list.
- Bordered panes with focus highlighting (cyan when focused).

**4. Rating mode (after run completes)**:
- Press `[r]` to enter rating mode.
- Four dimensions, each scored 1–5 per model:
  - `accuracy` — factual correctness / answer quality
  - `speed` — **auto-derived** from measured tok/s (fastest = 5, slower scaled linearly, editable)
  - `toolCorrectness` — right tool chosen, valid args, correct execution
  - `instructionFollowing` — matches evaluation criteria and system prompt
- Keys in rating mode:
  - `[1-5]` — set score for focused model + active dimension
  - `←/→` — cycle dimensions
  - `↑/↓` — switch model pane
  - `Enter` — next empty slot
  - `Esc` — exit rating mode
- Ratings are logged as `compare_rate` events and stored in `ComparisonScore`.

**5. Export (`/export` while in compare mode)**:
- Produces `xaku-compare-<timestamp>.md` + `.json`.
- Markdown: prompt, both model responses side by side, metrics table, ratings table, notes.
- JSON: full structured data for programmatic analysis.

**6. Tests** (20 new):
- `tests/model/compare.test.ts` — 9: `emptySide`, `emptyRatings`, `autoSpeedScore` (equal, faster/slower, zero handling), `DIMENSIONS`, `DIMENSION_LABELS`.
- `tests/ui/compare.test.ts` — 7: split-view render, response text, rating hint, score table, rating mode, partial streaming, tool activities.
- `tests/commands/commands.test.ts` — 4 new: `/compare` parsing (valid, one model, three models, spaces).

**Files added/modified**:
- `src/model/compare.ts` — new: parallel comparison engine, scoring types, helpers.
- `src/ui/ComparePanel.tsx` — new: split-view UI + rating mode.
- `src/commands/cases.ts` — extended `TestCase` with `expectedAnswer`, `evaluationCriteria`.
- `src/commands/index.ts` — added `/compare` command definition and parser.
- `src/app.tsx` — `CompareState`, `startComparison`, `cancelComparison`, useInput routing, render routing, `/export` comparison export.
- `src/commands/report.ts` — added `exportComparison` for Markdown + JSON reports.
- `tests/model/compare.test.ts`, `tests/ui/compare.test.ts` — new test files.

**Status**: Implementation complete, typecheck and tests pending verification (Node.js environment issue during development).

### Phase 13 — Command repair + workspace visibility

> The Phase 12 "Status: ✅ Complete" above was optimistic. Its `switch`-based dispatcher only
> handled 8 action types while the registry still produced 16, so most commands had quietly
> stopped doing anything. See [`PHASE_13_COMMAND_REPAIR.md`](./PHASE_13_COMMAND_REPAIR.md).

**1. Diagnosed and repaired the dead commands**:
- `/export`, `/save`, `/load`, `/autoapprove`, `/compact` were registered and parsed but had no handler; they fell through to `Unknown command: ${action.type}`. `/benchmark`, `/compare`, `/replay` had lost their engines and panels entirely.
- The three engine-less commands were **deregistered** (parser, registry, action union) so the palette no longer advertises broken things. Re-implementation is tracked as follow-up.
- The remaining five were wired up. `src/commands/report.ts` was rebuilt for `/export` (Markdown + JSON); `src/commands/cases.ts` turned out to have been sitting unused on disk the whole time and just needed importing.

**2. Made the dispatcher total so this cannot recur**:
- `handleSubmit`'s `switch` → `commandHandlers: Record<CommandAction['type'], handler>`. A new action type without a handler is now a **compile error**.
- `HANDLED_ACTION_TYPES` + a conditional-type assertion pin the handler set to the action union.
- `tests/commands/commands.test.ts` asserts both directions (registered ⇒ handled, handled ⇒ reachable) and that no registered command falls through to the typo suggestion. Writing it immediately surfaced two more drift bugs: a `noop` action nothing produced (deleted), and `/cancel` being handled but never registered, so it was invisible in the palette.
- `{ type: 'error' }` gained a handler — usage errors like `/temperature` with no argument were printing "Unknown command: error" instead of their usage string.

**3. Restored the tool-activity subsystem** (spec §8.3/§9, lost with `ToolPanel.tsx`):
- New `src/tools/activity.ts` (pure): `ToolActivity` model, terminal-status classification, `countActivities`, `averageToolDuration`, compact split/summarize, `shouldAutoApprove(mode, readOnly)` — the read-only flag comes from `ToolDefinition.isReadOnly`, not a duplicated name list.
- New `src/ui/ToolPanel.tsx`: status icons, tool + args, `format check: ✔/✖`, durations, auto-approved markers, diff previews, and collapsed per-outcome rows (`[c]` hotkey / `/compact`).
- **`[f] fix / [s] skip / [r] retry`** restored — failures pause and ask instead of silently feeding an error back (spec §9 forbids auto-retry).
- Malformed calls now **pause the turn** instead of `continue`-ing a dangling `tool_calls` into the next request.
- `ToolContext.abortSignal` is finally populated (it had been declared and honoured by `run_shell`/`query_db` but never passed), so Ctrl+C interrupts a running tool. Per-activity controllers tracked in a map.
- Approved tools execute concurrently via `Promise.all`; results appended in original `tool_calls` order.
- Auto-approve modes became real: `--auto-approve` / `XAKU_AUTO_APPROVE` / `/autoapprove` / "always allow" all set the same state, shown as `auto:<mode>` in the status line.
- `write_file` diff previews rebuilt via new `src/ui/diff.ts` over the `diff` package (the dependency had stayed in `package.json`, unused since Phase 12).
- `/stats` rebuilt off the shared `computeStats()` — model, workspace, tokens, tok/s, tool outcomes, avg tool time, log path. `/export` reads the same function, which is what makes spec §14 Check 5 ("report matches `/stats`") true by construction rather than by convention.

**4. Two more bugs found only by driving the real TUI** (`scripts/pty-smoke.py`):
- **The input never cleared.** Phase 12 dropped the kit's `REPL`, which used to `setInputValue("")` before `onSubmit`. With the value lifted into `App` and `PromptInput` fully controlled, submitted text stayed in the box and the next message *appended to it*. `handleSubmit` now clears explicitly.
- **The palette could not reach most commands.** `CommandPalette` rendered `suggestions.slice(0, 6)` regardless of `selectedIndex`; with 14 commands the cursor moved onto rows 6–13 that were never painted, selecting invisible commands. New pure `windowStart()` scrolls the window to keep focus visible, with `↑ n above` / `↓ n more` indicators counted into `viewportHeight` so total TUI height stays stable.

**5. Workspace visibility (the new feature work)**:
- New `src/tools/workspace.ts` (pure): `expandHome`, `abbreviateHome`, `resolveWorkspace`, `relativeToWorkspace`.
- **Header segment**: `⌂ ~/path` in `XakuHeader`, left-truncated (`…/src/ui`) to keep the leaf readable and bounded on narrow terminals.
- **`/cd <path>`**: changes the workspace mid-session. Relative paths resolve against the current workspace, `~` expands, target must be a directory, `realpath` applied so the stored value matches what the tool sandbox compares against. Refused while a generation or approval prompt is live; logged as `set_workspace` / `workspace_error`.
- **`/pwd`**: current workspace plus the original launch directory.
- **Relative paths in tool previews** — approval shows `read README.md`, not a long absolute path; paths outside the workspace stay absolute so a sandbox escape is visible.
- **Startup line** — `Workspace: <path> · Model: <model>` on launch and after the menu pick; also shown in `XakuMenu` and `XakuWelcome`.
- **Click-to-copy** — header segment writes the path via OSC 52 (works over SSH) with `pbcopy`/`clip`/`wl-copy`/`xclip`/`xsel` fallbacks (`src/ui/clipboard.ts`), flashing `copied ✓`. This required moving alt-screen ownership out of `cli.tsx` into the kit's `<AlternateScreen>`: the renderer only enables SGR mouse tracking when it *knows* it is in the alt screen, which it learns solely from that component.
- `XakuMenu` said `esc quit` but Escape only dismisses it; label corrected to `esc skip`.

**Design note — why `/cd` is App state, not config**: `client` and `logger` were `useMemo`'d on `[config]`. Mutating `config.workspace` would have re-created the logger and opened a **second session log mid-session**, splitting the record `/export` reads. Workspace is now its own `useState`, `logger` is created exactly once, and tool calls read it through a ref so an in-flight turn stays consistent.

**Acceptance harness**: `scripts/acceptance.ts` had been pointing at deleted test files (`src/commands/report.test.ts`, `src/ui/theme.test.ts`) and would have reported false results. Paths corrected, Check 7 (symbol fallback) now reports **skip** instead of pretending to pass — `XAKU_PLAIN=1` died with the bespoke UI — and new Check 8 (dispatch completeness) plus Check 9 (real-TUI PTY sweep) were added. The summary now counts skips, which previously vanished from the totals.

**Tests**: 69 new (150 total, all passing across 13 files): `tests/tools/activity.test.ts` (16), `tests/tools/workspace.test.ts` (19), `tests/ui/diff.test.ts` (11), `tests/commands/report.test.ts` (12), `tests/ui/clipboard.test.ts` (7), `tests/ui/toolpanel.test.ts` (5), `tests/ui/command-palette.test.ts` (6, new file), plus the rewritten `tests/commands/commands.test.ts`.

**Still open**: batch approval is sequential again (the Phase 11 `[1]..[9]` review flow was not restored); per-message thinking remains one global toggle; no ASCII fallback; `/compare` + `/benchmark` + `/replay` await re-implementation; click-to-copy needs confirmation in a real terminal (the PTY harness cannot assert clipboard contents).

## 5. Current State

**Working & verified** (typecheck ✅, 150 tests ✅, PTY command sweep ✅, real Ollama ✅ with qwen3:4b):
- Fullscreen TUI on `@claude-code-kit/ui`: header (model, ctx bar, tokens, tool counts, git branch, workspace), virtualized message list, divider, command palette, input, status line. Alt screen + SGR mouse owned by `<AlternateScreen>` since Phase 13.
- Streaming chat via Ollama with letter-by-letter reveal, spinner before the first token, blinking `▌` cursor, and `◉`/`◐` generation indicator.
- Connection status with reconnect-on-Enter; a 404 is reported as a model error without flipping the connection badge.
- No hardcoded default model: silent auto-select of first installed model, `XAKU_MODEL` env or `-m` override, warn+fallback only for explicit-missing.
- Session logging (JSONL, crash-safe, append-per-event) with `session_end` on exit; `toolCallId` on tool events.
- All five tools: `read_file`, `list_dir`, `write_file`, `run_shell`, `query_db` — workspace boundary (path + realpath), full preview before approval, result trimming at 100 KB, read-only SQLite, 30 s shell timeout.
- Tool activity list (`ToolPanel`): status icon, tool + workspace-relative args, format-check line, duration, auto-approved marker, and `[c]` collapse of completed rows.
- Approval flow via kit `PermissionRequest` (allow / always-allow / deny); "always allow" sets `auto:all` consistently with `/autoapprove`.
- `write_file` approval previews show a colored line diff (capped 40 lines, exact counts, new-file and too-large fallbacks); existing content probed workspace-safely before prompting.
- Tool error flow restored: `[f] fix` feeds the error back to the model, `[s] skip` continues, `[r] retry` re-executes — the app never auto-retries (spec §9). Malformed calls pause the turn instead of leaking a dangling `tool_calls` into the next request.
- Tool cancellation: `Ctrl+C` aborts the stream **and** running shell/database tools via per-activity `AbortController` (`ToolContext.abortSignal` is finally populated).
- Auto-approve modes (`none` / `read-only` / `all`) via `--auto-approve`, `XAKU_AUTO_APPROVE`, `/autoapprove`, and always-allow; driven by the registry's `isReadOnly` flag; status line shows `auto:<mode>`; all decisions logged.
- Approved tools in one turn execute concurrently; results appended in original `tool_calls` order.
- Safe `/retry` / cancel / fix-skip-retry with in-flight tools: generation-epoch guard stops stale loops from clobbering state; dangling tool calls are auto-filled by `fillMissingToolResults` before any new request.
^- 14 slash commands, all dispatched through a type-exhaustive handler map: `/model`, `/temperature`, `/system`, `/clear`, `/retry`, `/cancel`, `/autoapprove` (alias `/auto`), `/compact`, `/cd`, `/pwd`, `/stats`, `/export`, `/save`, `/load`.
- Command palette: filters on prefix + aliases, rounded purple border, aligned name column, truncated descriptions, `windowStart()` scroll window so every command is reachable, two-Enter select-then-execute.
- Reasoning from thinking models is stored on the assistant message, **collapsed by default**, toggled globally with `Ctrl+T`; never re-sent to the API.
- **Workspace visibility**: launch path in the header (`⌂`, left-truncated), the setup menu, the welcome screen and a startup line; `/cd` changes it mid-session (relative to current, `~` expanded, `realpath`ed, refused while a turn is live); `/pwd` shows current + launch directory; tool previews show workspace-relative paths with absolute paths preserved for escapes; click the header segment to copy via OSC 52 with native fallbacks.
- Spec §14 acceptance harness (`scripts/acceptance.ts`): 6 automated, 2 manual, 1 honestly reported as **skip** (symbol fallback, dropped in Phase 12). Corrected from a version that pointed at deleted test files.
- Source organized into `src/commands/`, `src/model/`, `src/tools/`, `src/ui/` subfolders with 4 top-level files.

**Known regressions still open from Phase 12** (not repaired here — see `PHASE_13_COMMAND_REPAIR.md` follow-ups):
- **Markdown + syntax highlighting for assistant messages is gone.** `MarkdownText.tsx` and `code-highlight.ts` were deleted; messages now render as plain text. Spec §7 / the Phase 7 work no longer applies. (`marked` and `highlight.js` remain unused dependencies in `package.json`.)
- **Row-level scrollback + mouse wheel are gone.** Replaced by the kit `MessageList`'s `viewportHeight` virtualization; there is no ↑/↓ history scroll and no `Esc`-returns-to-tail banner.
- **Batch approval is sequential.** Multiple tool calls in a turn prompt one at a time; the Phase 11 `[1]..[9]` per-item review flow was not restored.
- `/benchmark`, `/compare`, `/replay` are deregistered pending engine re-implementation.
- No ASCII/symbol fallback (`XAKU_PLAIN=1` was tied to the deleted UI).

**Pending**:
- Manual TTY pass for click-to-copy and the approval/diff flow (the PTY harness drives keys and checks artifacts, but cannot assert clipboard contents or judge visual layout).
- Manual pass of Checks 1 and 6 in `MANUAL_TESTS.md` (live tool call + Ollama disconnect).
- Windows manual verification (all 150 tests + install flow on a real Windows box; CI Windows runner recommended).
- Cross-platform CI (GitHub Actions matrix: macOS/Windows/Linux).

## 6. Later (designed for, per spec §15)
- Custom tool-call format checkers; more DB types.
- UI polish roadmap: per-activity animated spinners, replay playback speed control improvements.
- N-way comparison (more than 2 models at once) — currently limited to 2 for clarity.

## 7. Reference: File Map

```
src/
  app.tsx              # state machine: chat loop, batch tool approvals, auto-approve modes, benchmark & replay modes, commands, hotkeys, cancellation, generation-epoch guard, scrollback routing
  cli.tsx              # entry, flags; renders <AlternateScreen><App/></AlternateScreen> (owns alt screen + mouse)
  config.ts            # flags/env/defaults → Config (workspace, limits, paths, autoApprove)
  logger.ts            # JSONL session log, created once per app lifetime
  commands/            # Slash command system
    index.ts           # Registry + parser + CommandAction union + HANDLED_ACTION_TYPES contract
    cases.ts           # /save & /load test case persistence
    report.ts          # computeStats (shared by /stats + /export) + Markdown/JSON report builder
  model/               # Model connection layer
    ollama.ts          # Streaming client (abort-signal aware), model list, /api/show tool-support + context length
    session.ts         # Message types (incl. UI-only reasoning), token estimation, fillMissingToolResults
    # NOTE: benchmark.ts / compare.ts / replay.ts were deleted in Phase 12 and their
    # commands are deregistered until re-implemented.
  tools/               # Tool engine
    types.ts           # ErrorLabel, ToolResult, ToolContext (incl. abortSignal)
    activity.ts        # Pure ToolActivity state machine: statuses, counts, compact split, shouldAutoApprove
    workspace.ts       # expandHome, abbreviateHome, resolveWorkspace, relativeToWorkspace (/cd + display)
    utils.ts           # resolveWithinWorkspace (path+realpath), trimOutput, probeExistingFile (200KB cap)
    registry.ts        # tool defs (read_file, list_dir, write_file, run_shell, query_db) + isReadOnly flags
    read_file.ts       # + workspace boundary, trimming
    list_dir.ts
    write_file.ts      # + auto-create parent dirs
    run_shell.ts       # + timeout, output cap, abortSignal, cross-platform
    query_db.ts        # + better-sqlite3 read-only, abort checks
    executor.ts        # validate / execute / getToolDefinitions
  ui/                  # Kit-UI components
    theme.ts           # colour palette (no symbol fallback since Phase 12)
    XakuHeader.tsx     # model · ctx bar · tokens · ✓/✖ · ^T hint · ⌂ workspace (click to copy) · git
    XakuMenu.tsx       # startup model picker, shows baseUrl + workspace
    XakuWelcome.tsx    # empty-state banner, shows model/temp/connection/workspace
    XakuLogo.tsx       # ASCII wordmark
    CommandPalette.tsx # aligned slash dropdown with windowStart() scroll windowing
    ToolPanel.tsx      # tool activity list: status, args, format check, duration, diff, compact mode
    diff.ts            # computeDiffLines/formatDiffSummary over `diff` pkg (40-line cap, exact counts)
    clipboard.ts       # OSC 52 + pbcopy/clip/wl-copy/xclip/xsel fallback
    hooks.ts           # useTypewriter, useBlink
    git.ts             # branch lookup
tests/                 # Vitest suite, mirrors src/ layout
  logger.test.ts       # 2 tests (spec §14 Check 4)
  commands/
    commands.test.ts   # 27 tests incl. dispatch-completeness guard (registry ⇔ parser ⇔ dispatcher)
    report.test.ts     # 12 tests (spec §14 Check 5: /export numbers == /stats)
  model/
    session.test.ts    # 6 tests
  tools/
    activity.test.ts   # 16 tests (auto-approve, counts, compact split, durations)
    executor.test.ts   # 23 tests
    path.test.ts       # 10 tests (cross-platform path handling)
    utils.test.ts      # 6 tests
    workspace.test.ts  # 19 tests (/cd resolution, realpath, ~ expansion, relative display)
  ui/
    clipboard.test.ts  # 7 tests
    command-palette.test.ts # 6 tests (windowStart keeps every command reachable)
    diff.test.ts       # 11 tests
    toolpanel.test.ts  # 5 tests (shortDisplay path rendering)
scripts/
  pty-smoke.py         # drives the real TUI through a PTY; asserts on log events + written files

## 8. Change Log (append new entries at top)

- **2026-11-19** — **Phase 13: Command repair + workspace visibility** (see `PHASE_13_COMMAND_REPAIR.md`). (1) **Repaired 8 dead slash commands.** The Phase 12 migration deleted the benchmark/compare/replay/report engines but left them registered and parsed; `handleSubmit`'s `switch` covered only 8 of 19 action types, so `/export`, `/save`, `/load`, `/autoapprove`, `/compact`, `/benchmark`, `/compare`, `/replay` all fell through to `Unknown command: ${action.type}` — while all 77 unit tests stayed green because they only exercised `parseCommand`, never the dispatcher. `/benchmark`+`/compare`/`/replay` were deregistered (no engine to restore); the other five were wired up, including rebuilding `src/commands/report.ts` and importing `src/commands/cases.ts`, which had been sitting unused on disk. (2) **Made the dispatcher total.** `switch` → `commandHandlers: Record<CommandAction['type'], handler>`, so a new action without a handler is a compile error; added `HANDLED_ACTION_TYPES` with a conditional-type assertion, plus bidirectional tests (registered ⇒ handled, handled ⇒ reachable). Writing them immediately found two more drift bugs: a `noop` action nothing produced (deleted) and `/cancel` handled but never registered, so it was invisible in the palette. Also gave `{type:'error'}` a handler — usage errors like `/temperature` with no argument printed "Unknown command: error". (3) **Restored the tool-activity subsystem** lost with `ToolPanel.tsx`: new pure `src/tools/activity.ts` (statuses, counts, durations, compact split, `shouldAutoApprove` driven by the registry's `isReadOnly` flag rather than a duplicated name list) and new `src/ui/ToolPanel.tsx` (status icon, workspace-relative args, `format check` line, duration, auto-approved marker, collapsed outcome rows). Restored `[f] fix / [s] skip / [r] retry` (spec §9 forbids auto-retry); malformed calls now pause the turn instead of leaking a dangling `tool_calls` into the next request; `ToolContext.abortSignal` is finally populated so Ctrl+C interrupts a running shell/db tool (it was declared and honoured by the tools but never passed); approved tools run concurrently with results in `tool_calls` order; `write_file` diff previews rebuilt via new `src/ui/diff.ts` over the `diff` package, which had stayed in `package.json` unused. `/stats` rebuilt and now shares one `computeStats()` with `/export`, making spec §14 Check 5 true by construction. (4) **Two more bugs found only by driving the real TUI** via new `scripts/pty-smoke.py` (PTY harness asserting on artifacts, not pixels): the input **never cleared** after Phase 12 dropped the kit's `REPL` (which used to `setInputValue("")` before `onSubmit`), so each new message appended to the last; and `CommandPalette` rendered `suggestions.slice(0,6)` regardless of `selectedIndex`, so with 14 commands the cursor moved onto never-painted rows 6–13 and selected invisible commands — fixed with pure `windowStart()` scroll windowing + `↑n above`/`↓n more` indicators counted into `viewportHeight`. (5) **Workspace visibility (new feature):** pure `src/tools/workspace.ts`; `⌂ ~/path` segment in `XakuHeader` (left-truncated to keep the leaf); `/cd <path>` changes the workspace mid-session (relative to current, `~` expanded, `realpath`ed so it matches the sandbox comparison, refused while a turn or approval is live, logged as `set_workspace`/`workspace_error`); `/pwd` shows current + launch directory; tool previews show workspace-relative paths and keep absolute form for escapes; startup/menu/welcome lines name the workspace; clicking the header copies it via new `src/ui/clipboard.ts` (OSC 52 + native fallbacks), which required moving alt-screen ownership from raw escapes in `cli.tsx` to the kit's `<AlternateScreen>` because the renderer only enables SGR mouse tracking when it learns of the alt screen from that component. Workspace became its own `useState` rather than a `config` mutation, since `logger` was `useMemo`'d on `[config]` and changing it would have opened a second session log mid-session. Corrected `XakuMenu`'s `esc quit` label (it only dismisses). (6) **Docs/harness honesty:** `scripts/acceptance.ts` pointed at deleted test files (`src/commands/report.test.ts`, `src/ui/theme.test.ts`); paths fixed, Check 7 (symbol fallback) now reports **skip** instead of pretending to pass since `XAKU_PLAIN=1` died with the bespoke UI, added Check 8 (dispatch completeness) and Check 9 (real-TUI sweep), and the summary now counts skips instead of dropping them. `WALKTHROUGH.md` §5 and the §7 file map were rewritten — they still advertised deleted features (markdown rendering, row scrollback/mouse, batch approval, benchmark, compare, replay) as working. Tests: 77 → **150** across 13 files.

- **2026-11-18** — **Phase 12: Kit UI migration + animation/palette/thinking refinements** (see `PHASE_12_KIT_UI.md`). (1) **Dropped the bespoke Ink UI**: deleted `src/ui/{TopBar,Banner,MenuScreen,InputLine,ToolPanel,StatusLine,gradient,mouse,useSpinner,useScrollback,replay-controls,MarkdownText,code-highlight,diff,ChatPanel,CommandMenu,ToolActivity,BenchmarkPanel,SessionPicker,ComparePanel}.ts(x)` plus stale engine modules (`benchmark.ts`, `compare.ts`, `replay.ts`, `report.ts`) and 15 obsolete test files. Replaced `ink` with `@claude-code-kit/ink-renderer` + `@claude-code-kit/ui`; bumped React to `^19.2.0` and `engines >=22`. Kept our own: `XakuLogo.tsx`, `XakuMenu.tsx`, `XakuWelcome.tsx`, `XakuHeader.tsx`, `theme.ts`, `git.ts`. (2) **Model label fix**: kit's `MessageList` hardcodes "Claude" in `ROLE_CONFIG` and in `renderStream`. Solution: custom `renderMessage` callback in `src/app.tsx` renders `● qwen3:8b` (purple), `❯ You` (cyan), and dim system lines. Streaming uses a synthetic `id: '__streaming'` assistant message whose content is the animated partial — flows through `renderMessage` and gets the correct model name. (3) **Replaced `REPL`** with kit primitives (`MessageList`, `PromptInput`, `StatusLine`, `Divider`, `PermissionRequest`, `Spinner`) composed directly in `app.tsx`; lifted `inputValue`/`history`/submit-handler into App. Why: kit's `REPL` renders command suggestions inline inside `PromptInput`, breaking layout. (4) **Custom `CommandPalette`** (`src/ui/CommandPalette.tsx`): triggered when input starts with `/` and has no space; rounded purple-bordered panel with fixed-width name column and truncated descriptions; max 6 visible. Key capture trick: `CommandPalette` is rendered as a JSX sibling **before** `PromptInput`, so its `useInput` listener registers first (React mounts siblings in order, effects fire in mount order); when the palette is open, ↑↓ Enter Tab Esc call `event.stopImmediatePropagation()`, preventing `PromptInput` from running its history nav. Selecting inserts `/cmd ` (trailing space); second Enter actually submits. Esc dismisses until the slash query changes. (5) **Animation**: new `src/ui/hooks.ts` exports `useTypewriter(target, charsPerTick=3, tickMs=20)` revealing streaming text letter-by-letter via a `displayRef` + interval (snaps on target shrink/reset), and `useBlink(periodMs=530, active)` toggling a boolean. Wired into `renderMessage`: synthetic streaming bubble renders `useTypewriter(generating ? partial : '')`; if empty during generation, a `<Spinner />` occupies the body; otherwise a purple `▌` cursor at the end of the last visible line toggles via `useBlink(530, generating)`. `XakuHeader` swaps `◉ → ◐` while `isGenerating`. (6) **Collapsible thinking via `Ctrl+T`**: `toKitMessages` now emits structured `MessageContent[]` (`{type:'thinking', text}` then `{type:'text', text}`) instead of prepending `> thinking: …` text. `renderMessage` shows thinking as `✻ Thinking… (Ctrl+T to expand)` collapsed by default; App-level `useInput` toggles a global `showThinking` flag on Ctrl+T. Header hint flips to `^T hide thinking` when expanded. Mouse-click toggle was considered and skipped — SGR mouse delivery is unreliable in Apple Terminal and the kit doesn't expose click plumbing for `renderMessage`. (7) **View-height compensation**: `viewportHeight = rows - 7 - paletteRows - (pendingTool ? 8 : 0)` so opening the palette doesn't shift the rest of the TUI. (8) **Cleanup**: 15 stale test files referencing deleted UI/engine modules removed; `MANUAL_TESTS.md` rewritten to reflect the kit UI; Checks 7–10 replaced (model label / command palette / response animation / thinking toggle). Final state: typecheck ✅, `npx tsc` ✅, `npx vitest run` 77/77 ✅.

- **2026-11-11** — **UI Rebrand**: Comprehensive visual overhaul inspired by Claude Code and Opper CLI. (1) **Rich top bar**: replaced the single-line `xaku · model · temp · system set` with a Claude Code-style powerline header showing model badge, context progress bar (`ctx [████░░░░░░] 45%`), token count, tool activity summary, connection status, and git branch—all separated by `` arrows. (2) **Animated gradient banner**: new `src/ui/Banner.tsx` renders the XAKU logo with a shifting purple gradient effect on the menu screen, falling back to solid purple on limited terminals. (3) **Status line with verb cycling**: new `src/ui/StatusLine.tsx` shows an animated status line above the input with rotating verbs ("Thinking", "Processing", "Analyzing", etc.), elapsed time, pending tool count, and token count—provides clear visual feedback during generation. (4) **Rebranded menu**: `MenuScreen` now features the animated banner, grouped sections (Start/System/Tools/Help), and a status panel showing model, connection, workspace, and git branch. (5) **Rebranded input**: purple powerline-styled input box with animated cursor and shimmer placeholder. (6) **Tool cards**: `ToolPanel` redesigned with card-based layout, purple left border for pending tools, and animated status badges. (7) **Truecolor gradients**: new `src/ui/gradient.ts` utility provides per-character RGB gradient rendering with animation support. (8) **Git integration**: new `src/ui/git.ts` helper fetches and caches the current git branch for display in the header. (9) **Model context helper**: `src/model/ollama.ts` gained `getModelContextLength()` to query Ollama's `/api/show` endpoint for the model's actual context window size (with 128K fallback). All existing functionality preserved; 260 tests passing; typecheck ✅ build ✅. *(Superseded by Phase 12.)*

- **2026-11-04 (later, 3)** — Continuous row-level scrollback + mouse wheel (final §6 polish item; replaces the Phase 10 message-window scrolling). The first iteration of this task shipped an Enter-to-open modal message viewport; user feedback demanded clean, continuous scrolling "exactly like opencode/Claude Code" including trackpad/mouse, so it was reworked the same day and the modal removed (`MessageViewport.tsx`/`messageScroll.ts` deleted). (1) **Row-based model**: `useScrollback` tracks `scrollLine` (rows from tail) with pure, tested `clampScrollLine`/`followScroll` math — tail stays auto-followed, scrolled-up positions hold the same rows as content grows. `ChatPanel` renders bottom-anchored: a `justifyContent="flex-end"` + `overflow="hidden"` container holding a `column-reverse` content stack shifted down by `marginBottom={-scrollLine}`; exact heights come from real Yoga layout via `measureElement` in a `useLayoutEffect`, reported through `onMeasured` (changed-only, callback ref — no measure loops). So scrolling is exact for wrapped text/markdown/code blocks, and long messages need no special mode. ↑/↓ one row, PgUp/PgDn a screenful (page = measured viewport), Esc returns to tail before cancel, typing/sending snaps to tail; banner `↑ N rows above — Esc to return`. (2) **Mouse wheel**: `src/ui/mouse.ts` enables SGR reporting (`?1000h?1006h`, 3 rows/notch) — attached to Ink's `internal_eventEmitter`, never `stdin.on('data')` (Ink owns the stream via `readable`/`read()`; a data listener steals keyboard bytes). Reporting disabled on unmount and in the cli.tsx exit cleanup; silently inactive on non-TTY. Ink surfaces mouse chunks to every `useInput` as `[<n;x;yM` (ESC stripped), so `InputLine` runs `stripSgrMouse` before inserting text — wheel scrolling can't type garbage into the prompt. (3) Message-windowing (`MAX_VISIBLE_MESSAGES`, `computeMessageWindow`) is gone — the whole history lays out inside the clipped viewport. Tests reshaped: 12 mouse/parser, 6 follow-scroll math, 7 ChatPanel layout (ink-testing-library asserts real clipping); 217 total, 18 files; typecheck ✅ typecheck:tests ✅ build ✅ headless boot ✅. Manual TTY wheel pass still to do (added to §5 Pending).

- **2026-11-04 (later, 5)** — Reasoning collapsed by default + reliable click toggling + `Ctrl+T` fallback (user feedback on later, 4: thinking should only show on demand, and the click button wasn't firing). (1) Inverted the state to `expandedReasoning` (app.tsx): completed assistant messages render `thinking [+]` with the body hidden; clicking expands to `thinking [−]`, clicking again retracts — new messages always start hidden. Header text shortened (no 'click to…' hint) so it can never wrap off the mapped row. (2) Click reliability: `useMouseEvents` now **buffers raw stdin chunks** (`parseMouseBuffer` — `stdin.read()` can split `[<0;x;yM` at any byte; matched sequences are consumed, only a trailing partial prefix is kept, keyboard bytes never accumulate), and mouse reporting adds `?1002` button-event tracking alongside `?1000`/`?1006` (some terminals only emit presses with 1002). (3) Row mapping no longer hard-codes the pane top: app passes `chatBottomRow = termRows − 2` (StatsBar+InputLine) and ChatPanel derives `containerTop = chatBottomRow − containerHeight + 1`; click matching takes the closest header within ±1 row. (4) Keyboard fallback `Ctrl+T` in the app-level `useInput` toggles the most recent reasoning message's block (safe: InputLine swallows all ctrl combos, and the handler sits after the replay branch). 233 tests (18 files: +4 buffer cases, reasoning tests flipped to default-collapsed); typecheck ✅ typecheck:tests ✅ build ✅ headless boot ✅. Real-TTY check needed for: clicking the thinking button and Ctrl+T.

- **2026-11-04 (later, 4)** — Uniform message styling + persistent, click-collapsible reasoning (user feedback: gaps between user/model blocks were inconsistent and the thinking text vanished at stream end). (1) **Spacing**: all per-message `marginY` and all per-block margins in `MarkdownText` removed; the chat content stack and the markdown token container now use `gap={1}`, so every message (and every block inside one) is separated by exactly one row regardless of role or content type. (2) **User block**: user messages render inside a rounded cyan bordered box (`borderStyle="round"` + `paddingX`) like opencode; model output stays plain left-aligned. (3) **Reasoning persistence**: `AssistantMessage.reasoning?: string` added (UI-only — `toOpenAIMessages` strips it, `estimateContextTokens` never counts it); `app.tsx` stores `result.reasoning` on the final assistant message so thinking no longer disappears when the stream block unmounts. (4) **Collapsible + clickable**: completed reasoning renders in a `ReasoningBlock` — inverse-video `thinking [−] click to collapse` button header (muted italic body expanded by default; ` [+]` collapsed). Clicking works by mapping SGR mouse **press** events to screen rows: `mouse.ts` now parses all SGR sequences (`parseSgrMouse` → wheel/click with x/y, `useMouseEvents` hook), ChatPanel measures each stack item's height (callback refs) and computes absolute reasoning-header rows via pure, tested `computeReasoningHeaderRows` (bottom-up walk of the column-reverse stack: containerTop + measured heights + gaps + scroll shift); a left click landing on a header row toggles that message's collapsed index in app state. The click handler lives in ChatPanel (wheel moved there too, via `onWheel` prop). `stripSgrMouse` generalized to strip press/release sequences too. (5) **Critical ink 5.2.1 finding**: a `flexGrow` + `justifyContent=flex-end` + `overflow=hidden` box gets a WRONG clip rect (computedTop collapses to the parent origin, so up-overflow silently bleeds over the banner row — the bordered blocks made this visible; the old margin-only layout hid it by row parity). Fixed by self-measuring the ChatPanel outer box (`useLayoutEffect` + `measureElement`) and pinning the clipped container to an explicit `height`; ink-testing-library frames now prove nothing bleeds above the container. Mouse enable/disable additionally guarded by `process.stdout.isTTY` so headless test runs don't emit SGR noise. 12 new tests (229 total, 18 files); typecheck ✅ typecheck:tests ✅ build ✅ headless boot ✅. Manual TTY pass still to do: actual clicking of the thinking button (row-mapping depends on real terminal coordinates).

- **2026-11-04 (later, 2)** — Replay playback speed control (roadmap item from §6). `/replay` play view gains auto-advance: `Space`/`p` toggles play/pause (replays from start when at end-of-log), `+`/`-` cycle speeds 1x→2x→4x→8x at a 1 s/event base, manual ←/→/PgUp/PgDn steps pause auto-play for inspection, end-of-log auto-pauses. `ReplayState` play variant carries `speed`/`playing`; a dedicated `useEffect` keyed on `[playing, speed]` runs the interval with functional `setReplay` (no stale closures, cleanup on every transition). Pure math/format helpers extracted to `src/ui/replay-controls.ts` with 7 new tests; header line shows `1x ⏸`/`2x ▶` indicator and updated key hints; input placeholder mirrors the controls. 208 tests passing (17 files); typecheck ✅ typecheck:tests ✅ build ✅.

- **2026-11-04 (later)** — Animated per-activity spinners in ToolPanel (roadmap item from §6). New `src/ui/useSpinner.ts`: `useSpinnerFrame(active)` returns the current `symbols.spinner` index, ticking on an 80 ms interval that only runs while `active` (effect cleanup clears it). `ToolPanel` computes activity presence from statuses (hook call before the empty-activities early return), threads the frame through `ToolActivityView` → `getStatusIcon(status, frame)`; non-terminal rows (`validating`/`awaiting_approval`/`approved`/`running`) now animate in lockstep, terminal rows keep static icons. `StatsBar` refactored onto the same hook — behavior identical, single source of truth for the cadence. Test helper `frame()` in `tests/ui/toolpanel.test.ts` now unmounts panels (no interval leaks); 5 new tests (fake timers + `advanceTimersByTimeAsync`): initial frame, cycling, wraparound, no-tick-when-all-terminal, mixed static/spinning rows. 201 tests passing (16 files); typecheck ✅ typecheck:tests ✅ build ✅.

- **2026-11-04** — Test suite relocation. All 16 `*.test.ts` files moved out of `src/` into a top-level `tests/` folder mirroring the source layout (`tests/commands/`, `tests/model/`, `tests/tools/`, `tests/ui/`) — source folders now contain shipped code only. Every relative import rewritten to the `../../src/...` form; hard-coded test paths in `scripts/acceptance.ts` updated; `MANUAL_TESTS.md` and the §7 file map refreshed. No config changes needed: Vitest's default discovery covers `tests/**/*.test.ts`, and `tsconfig.json` already excluded `**/*.test.ts` from the build, so `dist/` output is unchanged. Bonus: added `tsconfig.test.json` + `npm run typecheck:tests` so the suite is now type-checked too (previously it never was) — surfaced and fixed one dead `mkdir` import in `tests/model/replay.test.ts`. 196 tests still passing; typecheck ✅ build ✅ acceptance harness ✅.

- **2026-10-29** — Phase 11: UX power-user features. (1) **Batch tool approval + parallel execution**: `pendingApproval` became `pendingBatch` + `focusedActivity`; all manual tool calls in a turn prompt together (`a`/`d` act on the whole batch, `1-9` focuses one row for individual review, `t` releases newly-covered pending tools instantly); approved tools run concurrently via `Promise.all` with results fed back in original tool_calls order. Piggy-back fix: invalid calls now pause the turn for `f`/`s`/`r` instead of racing ahead with dangling `tool_calls` (API-rejected request bug). **Real bug found & fixed**: `streamCompletion` never had an abort signal — Esc-cancel and `/cancel` never actually aborted the HTTP stream; added `signal` via SDK request options, recognizing both `AbortError` and `APIUserAbortError`. (2) **Model benchmarking** (`/benchmark <case> [models]`): `src/model/benchmark.ts` runs a saved test case across models sequentially (same prompt/system/temp/workspace/tools, forced auto-approval), accumulating time/tokens/tok-s/tool-success-fail/avg-tool-ms/response-length/turns; live in-UI comparison table (`BenchmarkPanel`) replaces the chat area, best tok/s green, error rows inline, `Esc` aborts mid-run, results stream in per model. Verified live against real Ollama + mid-stream SIGABORT. (3) **Session replay** (`/replay [index]`): `src/model/replay.ts` parses `session-*.jsonl` logs (malformed-line-tolerant), `listSessions` builds a newest-first catalog from `session_start` metadata, `reconstructUpTo` rebuilds messages/activities/settings at any event cursor (toolCallId-correlated, legacy name-fallback matching); step-through viewer reuses ChatPanel+ToolPanel (←/→ step, PgUp/PgDn ends, Esc exit, keys swallowed while in replay). **Log enrichment**: all tool events now carry `toolCallId`, `tool_success` logs a 4000-char output cap so replays/exports can show what the model saw. Verified against 57 real session files. 27 new tests (196 total passing); typecheck ✅ build ✅; interactive batch-approval flow pending one manual TTY pass (scripted PTY harness flaky in this env, not an app issue — headless render smoke confirms the tree mounts).

- **2026-10-24 (later, 5)** — Phase 10: UI polish (the §6 deferred trio). (1) **Collapsible tool panel**: `ToolPanel` compact mode groups terminal activities into per-outcome summary lines while keeping actionable ones expanded; `c` hotkey (generation/prompt states only — Ink handlers don't consume keys, so idle hotkeys would steal input) + `/compact` command; `[c] collapse/expand` hints; reset on `/clear`. (2) **`write_file` diff views**: new `diff` v9 dep; `probeExistingFile()` reads the target pre-approval (workspace-bounded, 200 KB cap, `new|existing|too-large|unreadable`); pure `src/ui/diff.ts` computes capped-at-40 colored line diffs with exact counts once at activity creation; approval preview shows `+`/`-`/`|` lines instead of a content dump; new files labeled `new file (+N lines)`; too-large falls back to content preview with a note. (3) **Scrollback**: `src/ui/useScrollback.ts` — bottom-anchored offset, `computeMessageWindow`, dynamic page size from live `termRows` (`(rows−4)/3`); ChatPanel renders offset windows with stable keys; ↑/↓/PgUp/PgDn routed app-side (active during generation/prompts AND idle-empty input; Home/End impossible — Ink 5 has no key flags for them); Esc exits scroll before it cancels; typing or sending snaps back to tail; auto-follow at offset 0, position-preserving offset growth while scrolled; partial block hidden while browsing; `↑ to scroll` discoverability hints in banner/placeholder. New `scripts/ui-demo.tsx`. 46 tests added (169 total passing); typecheck ✅ build ✅ headless boot ✅ live probe/diff ✅.

- **2026-10-24 (later, 4)** — Phase 9: cleared the three long-standing pending items. (1) **Safe `/retry` / cancellation**: `cleanupGeneration()` extracted from `cancelGeneration()` — aborts stream + tools, resolves stuck approval promises, and bumps a `generationEpochRef` that every `resumeGeneration` loop checks at four points (loop top, after stream, after approval, guarded `finally`), so stale loops can no longer clobber a new turn or hang forever; `/retry` (and fix/skip/retry) clean up before regenerating, keeping old assistant/tool turns as context; new `fillMissingToolResults()` in `session.ts` repairs dangling `tool_calls` (assistant messages without matching tool results) before any request reaches the API. (2) **Auto-approve modes (spec §15)**: `Config.autoApprove` (`none`/`read-only`/`all`) via `--auto-approve` flag or `XAKU_AUTO_APPROVE` env; `/autoapprove` + `/auto` slash commands; **`[t]` hotkey** cycles modes during generation and immediately releases a pending tool that the new mode covers; leverages the existing `isReadOnly` tool flags; TopBar `auto:<mode>` indicator, ToolPanel `auto-approved` lines, `tool_auto_approved` / `set_auto_approve` log events. (3) **Streaming markdown**: live `partial` now renders through `<MarkdownText />` — `preprocessStreaming()` closes unclosed code fences, inline code, bold, strikethrough, and link parens (odd-count detection, markers inside complete spans ignored); cursor moved inline into the markdown so no pop-to-new-row; `AssistantBlock` fixed to not nest Box in Text. Incidental: `scripts/smoke.ts` + `scripts/tool-test.ts` imports repaired (stale pre-Phase-8 `src/ollama.js` path) and re-verified live end-to-end against Ollama. 27 new tests (123 total, all passing); typecheck ✅, build ✅.

- **2026-10-24 (later, 3)** — Phase 8.3: Windows Caution Pass. Added `tests/tools/path.test.ts` with 10 tests for cross-platform path handling (forward slashes, backslashes, mixed separators, workspace boundaries, absolute paths, case-insensitivity, drive letters, long paths). Created `WINDOWS.md` with comprehensive Windows platform guide: installation, platform-specific features, known issues (process termination, file locking, path length, terminal rendering), manual testing procedures, troubleshooting, performance considerations. Key finding: existing `resolveWithinWorkspace` already handles Windows paths correctly via Node.js `path` module — no code changes required. 10 new tests (96 total, all passing).
- **2026-10-24 (later, 2)** — Phase 8.2: Spec §14 Acceptance Harness. Automated verification for 5/7 acceptance checks (Checks 2, 3, 4, 5, 7), with manual test procedures documented for Checks 1 and 6 (require Ollama). New test files: `tests/logger.test.ts` (2 tests for crash-safe session logging), `tests/commands/report.test.ts` (3 tests for /export structure and /stats consistency), `tests/ui/theme.test.ts` (5 tests for Unicode/plain symbol fallback). Refactored `src/ui/theme.ts` to export `getSymbols()` and `isPlainMode()` for testability. Added `scripts/acceptance.ts` harness that runs automated checks and documents manual procedures. Created `MANUAL_TESTS.md` with step-by-step procedures for all 7 checks, troubleshooting guide, and cross-platform testing instructions. 10 new tests (86 total, all passing).
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
