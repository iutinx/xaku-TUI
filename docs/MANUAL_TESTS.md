# xaku v1 Manual Test Procedures

This document describes manual testing procedures for acceptance checks that require a running Ollama instance.

## Prerequisites

1. Install Ollama: https://ollama.ai
2. Pull a tool-capable model:
   ```bash
   ollama pull qwen3:4b
   ```
3. Verify Ollama is running:
   ```bash
   ollama list
   ```

---

## Check 1: Tool Call with Approval and Results

**Objective:** Verify that tool calls are validated, require user approval, and results are sent back to the model.

### Test Steps

1. **Start xaku:**
   ```bash
   npm run dev
   ```

2. **Send a tool-calling prompt:**
   ```
   Read the file README.md in the current directory and tell me what it contains.
   ```

3. **Expected behavior:**
   - Tool activity panel appears (right side)
   - Shows: `read_file README.md` with `[a] approve [d] deny` prompt
   - Status shows: `⠋ awaiting approval`

4. **Approve the tool call:**
   - Press `a`

5. **Expected behavior:**
   - Tool status changes to `✔ success` with duration
   - Model continues and includes file contents in response
   - Response shows content from README.md

6. **Test denial (optional):**
   - Send another file read request
   - Press `d` to deny
   - Verify: Tool shows `✖ denied by user`, model receives denial message

### Pass Criteria
- ✅ Tool call appears with preview and approval prompt
- ✅ Approval allows tool execution
- ✅ Results are sent back to model
- ✅ Model includes tool results in response

---

## Check 6: Graceful Handling When Ollama Stops Mid-Session

**Objective:** Verify that xaku handles Ollama disconnection gracefully without crashing or losing conversation.

### Test Steps

1. **Start xaku:**
   ```bash
   npm run dev
   ```

2. **Send an initial message:**
   ```
   What is 2 + 2?
   ```

3. **Wait for response:**
   - Verify model responds normally

4. **Kill Ollama:**
   ```bash
   pkill ollama
   ```

5. **Send another message:**
   ```
   What is 3 + 3?
   ```

6. **Expected behavior:**
   - Error banner appears: "Connection error. Is Ollama running?"
   - Conversation history is preserved
   - UI remains responsive

7. **Restart Ollama:**
   ```bash
   ollama serve &
   ```

8. **Send a message:**
   ```
   What is 4 + 4?
   ```

9. **Expected behavior:**
   - Connection recovers automatically
   - Model responds normally
   - Full conversation history is maintained

### Pass Criteria
- ✅ Error banner shows when Ollama is down
- ✅ Conversation history is preserved
- ✅ No crash or data loss
- ✅ Automatic reconnection when Ollama restarts
- ✅ Full conversation context maintained

---

## Check 7: Model Label Renders as the Active Model

**Objective:** Verify assistant messages and the streaming tail show the real model name, not the kit's hardcoded "Claude".

### Test Steps

1. **Start xaku:**
   ```bash
   npm run dev
   ```

2. **Pick a model** in the setup menu (e.g. `qwen3:8b`).

3. **Send a short message:**
   ```
   Say hi in one word.
   ```

4. **Expected behavior:**
   - The streaming tail header reads `● qwen3:8b` (purple), **not** `● Claude`.
   - After completion, the persisted assistant bubble header is still `● qwen3:8b`.
   - The user bubble header reads `❯ You` (cyan).
   - System messages (e.g. `Model set to …`) are dimmed with no `●`/`❯` prefix.

5. **Switch models and re-check:**
   ```
   /model qwen3:4b
   ```
   Send another message. Header should now show `● qwen3:4b`.

### Pass Criteria
- ✅ Final assistant bubble shows the actual model name
- ✅ Streaming tail also shows the actual model name (no flash of "Claude")
- ✅ Header updates immediately after `/model` switches

---

## Check 8: Command Palette Alignment + Two-Enter Flow

**Objective:** Verify the slash-command palette is left-aligned, doesn't push the rest of the TUI around, and inserts on Enter rather than executing immediately.

### Test Steps

1. **Start xaku** with the kit UI.

2. **Open the palette** by typing:
   ```
   /
   ```
   Expected: a rounded purple-bordered panel appears between the message area and the input,
   showing the first 6 commands plus a `↓ 8 more` indicator (14 are registered). The total
   TUI height does not change (message viewport shrinks by exactly the palette height).

3. **Filter** by typing more characters, e.g. `/te`.
   Expected: only `/temperature` is shown, focused.

4. **Navigate** with ↑/↓.
   Expected: focus indicator (`❯`) moves; arrow keys do **not** cycle input history while the palette is open.

5. **Select** with Enter on `/temperature`.
   Expected: input now reads `/temperature ` (with trailing space). Palette closes. The command has **not** executed yet.

6. **Press Enter again.**
   Expected: command executes — system message `Temperature set to …` appears.

7. **Try Escape:**
   Type `/` again, press Esc. Expected: palette hides. Type another character (or change the slash query). Palette reappears.

8. **Check long descriptions:**
   Type `/c` to filter to `/clear`, `/cancel`, `/cd`, `/compact`.
   Expected: command names are column-aligned; descriptions do not wrap or spill past the right border; if a description exceeds terminal width it ends in `…`.

### Pass Criteria
- ✅ Palette panel is bounded, left-aligned, no description wrap
- ✅ Total TUI row count stable across palette open/close
- ✅ First Enter inserts `/cmd `, second Enter executes
- ✅ Esc dismisses; subsequent slash input reopens
- ✅ ↑/↓ navigate palette (not history) while open

---

## Check 9: Response Animation (Typewriter + Spinner + Blinking Cursor)

**Objective:** Verify streaming responses reveal letter-by-letter, show a spinner while waiting for the first token, and end with a blinking block cursor.

### Test Steps

1. **Start xaku**, pick a model.

2. **Send a question that takes a moment to start:**
   ```
   Explain how HTTPS works in three short paragraphs.
   ```

3. **Before the first token arrives:**
   - Streaming bubble header reads `● qwen3:8b is thinking…` (dim).
   - A `⠋ ⠙ ⠹ …` spinner occupies the body slot.
   - The header's left dot is `◐` (generating variant) instead of `◉`.

4. **As tokens arrive:**
   - Body text reveals letter-by-letter (≈3 chars every 20 ms).
   - The spinner disappears the moment the first content frame paints.
   - A purple `▌` cursor sits at the end of the last visible line and toggles roughly every 0.5 s.

5. **When the stream ends:**
   - Cursor disappears immediately.
   - Header `◐` reverts to `◉`.
   - Final bubble shows the full text once (no flicker, no duplication).

6. **Cancel mid-stream:**
   Press `Ctrl+C` while streaming.
   - Generation stops.
   - System message `Generation cancelled.` appears.
   - Cursor and spinner both stop.

### Pass Criteria
- ✅ Letter-by-letter reveal during streaming
- ✅ Spinner visible only when waiting for first content
- ✅ Blinking cursor at end of last streaming line, disappears on completion
- ✅ Header indicator swaps correctly between `◉`/`◐`
- ✅ Cancel stops all animation cleanly

---

## Check 10: Thinking Block Visibility Toggled by Ctrl+T

**Objective:** Verify reasoning from thinking-capable models is hidden by default, expandable with `Ctrl+T`, and not re-sent to the model.

Requires a reasoning-capable model (e.g. `qwen3:4b` or `qwen3:8b`, which stream `reasoning` deltas through Ollama).

### Test Steps

1. **Start xaku** and ask something reasoning-heavy:
   ```
   Think step by step: a train leaves Algiers at 90 km/h, another leaves
   Oran at 70 km/h toward each other, distance 450 km. When do they meet?
   ```

2. **After completion:**
   - The assistant bubble shows `✻ Thinking… (Ctrl+T to expand)` (purple, dim).
   - No reasoning text is shown by default.
   - The answer body is visible directly below.

3. **Press `Ctrl+T`:**
   - Reasoning body appears under the `✻ Thinking…` header in dimmed text.
   - Hint in `XakuHeader` flips to `^T hide thinking`.

4. **Press `Ctrl+T` again:**
   - Reasoning body hides; hint flips back to `^T show thinking`.

5. **API hygiene:**
   - Send a follow-up question.
   - Header `ctx` percentage should reflect tokens **without** the hidden reasoning.
   - The model continues the conversation coherently — reasoning is internal-only.

6. **No-thinking model:**
   Switch to a non-reasoning model (e.g. `llama3.2:3b`), ask another question.
   - No `✻ Thinking…` header appears.
   - `Ctrl+T` is still functional but does nothing visible.

### Pass Criteria
- ✅ Thinking collapsed by default; expandable with `Ctrl+T`
- ✅ Header hint text correctly reflects current state
- ✅ Hidden reasoning is not included in the next request payload
- ✅ Non-thinking models don't show a thinking header

---

## Additional Manual Tests

### Cross-Platform Path Handling

**Objective:** Verify workspace boundary works on different path formats.

1. **Test relative path escape:**
   ```
   Read the file ../../../etc/passwd
   ```
   Expected: `blocked` error, path outside workspace

2. **Test absolute path:**
   ```
   Read the file /etc/passwd
   ```
   Expected: `blocked` error

3. **Test valid relative path:**
   ```
   Read the file ./README.md
   ```
   Expected: Success if file exists in workspace

### Long-Running Tool Execution

**Objective:** Verify timeout and cancellation work for long-running tools.

1. **Start xaku**

2. **Request long-running operation:**
   ```
   Run the command: sleep 10
   ```

3. **Approve the tool call**

4. **Wait 5 seconds, then press Ctrl+C**

5. **Expected behavior:**
   - Tool is cancelled
   - Tool panel shows cancellation message
   - Generation stops
   - User can continue with new prompts

### Session Log Integrity

**Objective:** Verify crash-safe logging captures all events.

1. **Start xaku**

2. **Send several messages and tool calls**

3. **Kill xaku abruptly:**
   ```bash
   pkill -9 tsx
   ```

4. **Check log file:**
   ```bash
   # Find latest log
   ls -lt ~/.local/share/xaku/logs/ | head -5
   
   # View log
   tail -50 ~/.local/share/xaku/logs/session-*.jsonl
   ```

5. **Expected behavior:**
   - `session_start` event present
   - All user messages logged
   - All assistant responses logged
   - All tool calls logged (including validation results)
   - `session_end` event present (written on cleanup)

---

## Check 11: Workspace Path Visibility

**Objective:** Verify xaku shows where it was launched from, and that the workspace can be changed mid-session.

### Test Steps

1. **Start xaku from a specific folder:**
   ```bash
   cd ~/some/project && npm run dev
   ```

2. **Check the setup menu** (before picking a model):
   - Expected: a line reading `⌂ workspace <path>` under the Ollama status line.

3. **Pick a model and enter the chat.**
   - Expected: the header shows `⌂ <path>` on the right, next to the git branch.
   - Expected: a system line reads `Workspace: <path> · Model: <model>`.
   - Note: a long path is truncated from the left (`…/project/src`), the leaf stays visible.

4. **`/pwd`**
   - Expected: two lines — the current workspace and the original launch directory.

5. **`/cd src`** (relative)
   - Expected: `Workspace: <path>/src`, and a new value in the header.
   - Verify tools are now sandboxed there: ask the model to read a file that exists in the
     old root but not in `src/` → should be `blocked` / not found.

6. **`/cd ..`** then **`/cd /definitely/missing`**
   - Expected: the bad path is refused with `Workspace unchanged: Not a directory: …`
     and the previous workspace is preserved.

7. **`/cd <path>` while a generation is running**
   - Expected: refused — "Cannot change workspace while a generation or tool prompt is active."

8. **Click the `⌂` workspace segment in the header.**
   - Expected: flashes `copied ✓` and a system line confirms the clipboard write.
   - Requires a terminal with OSC 52 permission enabled or a native helper (`pbcopy`,
     `wl-copy`, `xclip`, `xsel`, `clip`). Without one it says the clipboard is unavailable
     rather than lying.

### Pass Criteria
- [ ] Workspace path visible at startup without scrolling, in menu + header + a system line
- [ ] `/pwd` shows current and launch directories
- [ ] `/cd` moves the sandbox and tool boundary follows it
- [ ] Invalid `/cd` is refused without changing state
- [ ] `/cd` blocked during an active turn
- [ ] Long paths truncate from the left, keeping the leaf readable

---

## Check 12: Tool Failure Choices (fix / skip / retry)

**Objective:** Verify spec §9 — every tool failure offers a choice, and nothing auto-retries.

### Test Steps

1. **Start xaku**, ensure `/autoapprove none`.

2. **Ask for a file that does not exist:**
   ```
   Use read_file to read definitely-missing.txt
   ```

3. **Approve the call with `a`.**
   - Expected: tool row shows `✖ failed`, and a prompt appears:
     `✖ read_file failed — [f] fix  [s] skip  [r] retry`
   - Expected: nothing happens on its own. The model must **not** receive the error until you choose.

4. **Press `r` (retry)**
   - Expected: the same call runs again, fails again, and the prompt returns.

5. **Press `f` (fix)**
   - Expected: the error is sent back to the model, which then tries a different approach.

6. **Press `s` (skip)**
   - Expected: the model receives "skipped by user" and continues.

7. **Malformed call check:** with a model that mis-formats arguments, verify the row shows
   `format check: ✖ <reason>` and the **turn pauses** for a choice rather than continuing
   with a dangling tool call.

8. **Cancel a long-running tool:** ask for `run_shell` with `sleep 30`, approve, then press `Ctrl+C`.
   - Expected: the process is killed promptly and the row shows `cancelled`.

### Pass Criteria
- [ ] Failures pause and offer `[f] [s] [r]`; no automatic retry or error feed-back
- [ ] `retry` re-executes the identical call
- [ ] `fix` feeds the error to the model
- [ ] `skip` continues the turn
- [ ] Malformed calls label `format check: ✖` and pause the turn
- [ ] `Ctrl+C` actually terminates a running shell tool

---

## Check 13: Command Palette Reachability

**Objective:** Verify every registered command can be reached, not just the first six.

### Test Steps

1. **Type `/`** to open the palette.
   - Expected: at most 6 rows plus a `↓ N more` indicator (14 commands are registered).

2. **Press `↓` repeatedly past 6 rows.**
   - Expected: the window scrolls so the focused row is **always visible**; you never have a
     cursor on a blank area.

3. **Arrow down to the last command and press Enter.**
   - Expected: the inserted `/… ` matches the visible highlighted row.

4. **Type `/c`** — expect `clear`, `cancel`, `cd`, `compact` only.
   **Type `/p`** — expect `pwd` only.

5. **Type `/benchmark`, `/compare` or `/replay` and Enter.**
   - Expected: `Unknown command /benchmark` — these are intentionally **deregistered** until
     their engines are rebuilt, and must not appear in the palette at all.

### Pass Criteria
- [ ] Scrolling window keeps focus visible for all 14 commands
- [ ] Filtered results are reachable, including rows past the 6th
- [ ] `/cd` and `/pwd` appear; `/benchmark`, `/compare`, `/replay` do not

---

## Troubleshooting

### Ollama Connection Issues

If tests fail due to connection issues:

1. Verify Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. Check Ollama logs:
   ```bash
   # macOS/Linux
   ps aux | grep ollama
   
   # Restart if needed
   ollama serve
   ```

3. Verify model is loaded:
   ```bash
   ollama list
   ```

### Tool Call Not Triggering

If the model doesn't make tool calls:

1. Verify model supports tools:
   ```bash
   ollama show qwen3:4b
   ```
   Look for "tools" in capabilities.

2. Try a more explicit prompt:
   ```
   Please use the read_file tool to read test.txt, then tell me what it contains.
   ```

3. Check tool definitions are sent:
   - Review logs for `tool_definitions` event

### Symbol Rendering Issues

If Unicode symbols don't render (e.g. `●`, `✻`, `▌`, braille spinner):

1. Check terminal supports Unicode:
   ```bash
   echo -e "\xe2\x9c\x94"  # Should show ✔
   ```

2. Check TERM environment variable:
   ```bash
   echo $TERM
   ```
   Should be `xterm-256color` or similar (not `dumb`).

Note: there is currently no ASCII-fallback mode — the kit UI assumes a Unicode-capable terminal. If you need plain ASCII, run inside `TERM=xterm-256color` with a font that contains braille and geometric glyphs.

---

## Acceptance Checklist

Before marking v1 as complete, verify:

- [x] All automated acceptance tests pass (`scripts/acceptance.ts` — 5 pass, 3 manual, 1 skipped)
- [ ] Check 1: Tool call approval flow works (manual)
- [ ] Check 6: Ollama disconnect handled gracefully (manual)
- [ ] Check 7: Model label renders as the active model (manual)
- [ ] Check 8: Command palette alignment + two-enter flow (manual)
- [ ] Check 9: Response animation — typewriter + spinner + blinking cursor (manual)
- [ ] Check 10: Thinking block visibility via `Ctrl+T` (manual, reasoning model)
- [ ] Check 11: Workspace path visibility, `/cd`, `/pwd`, click-to-copy (manual)
- [ ] Check 12: Tool failure choices — fix / skip / retry (manual)
- [ ] Check 13: Command palette reachability for all 14 commands (manual)
- [x] Cross-platform path handling verified (`tests/tools/path.test.ts`, `tests/tools/workspace.test.ts`)
- [ ] Long-running tools can be cancelled (Check 12 step 8)
- [x] Session logs capture all events
- [ ] No crashes or data loss in any test scenario

**Not currently achievable:** spec §14 Check 7 — "usable on a terminal without symbol
support using the fallback markers". The `XAKU_PLAIN=1` ASCII fallback was removed with
the bespoke UI in Phase 12 and has not been rebuilt; `scripts/acceptance.ts` reports this
as **skip** rather than passing it.

### Automated sweep

`scripts/pty-smoke.py` drives the real TUI through a PTY and asserts on artifacts
(session-log events, files written by `/export` and `/save`) rather than scraped pixels.
It covers Checks 11 and 13 plus the command-dispatch repairs. Cold start is 40–75 s, so
it polls for readiness instead of sleeping a fixed amount.

```bash
python3 scripts/pty-smoke.py
```

---

## Reporting Issues

If any manual test fails:

1. Document the exact steps to reproduce
2. Capture terminal output/screenshots
3. Note the environment (OS, terminal, Ollama version)
4. Check existing issues: https://github.com/yourusername/xaku/issues
5. Create new issue with label "acceptance-test"

---

**Last Updated:** 2026-11-19 — added Checks 11–13 for workspace visibility, tool-failure choices and palette reachability after the Phase 13 command repair (see [`PHASE_13_COMMAND_REPAIR.md`](./PHASE_13_COMMAND_REPAIR.md)); corrected Check 8's command count and noted the deregistered commands.
**Test Coverage:** 13 checks (5 automated + 1 PTY sweep, 7 manual). Spec §14 Check 7 (symbol fallback) is **not implemented** since Phase 12.
