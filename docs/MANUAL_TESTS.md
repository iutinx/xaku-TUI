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

## Check 7: Symbol Fallback for Terminals Without Unicode

**Objective:** Verify that xaku works in terminals without Unicode support using ASCII fallback symbols.

### Test A: Automated Verification

```bash
# Run unit tests
npx vitest run tests/ui/theme.test.ts
```

Expected: All tests pass, verifying ASCII symbol rendering.

### Test B: Manual Visual Verification

1. **Start xaku with plain symbols:**
   ```bash
   XAKU_PLAIN=1 npm run dev
   ```

2. **Send a message:**
   ```
   Read the file test.txt
   ```

3. **Expected symbols:**
   - Success: `[ok]` (not `✔`)
   - Failure: `[x]` (not `✖`)
   - Skipped: `[skip]` (not `↓`)
   - Tree connectors: `|-` and `` `- `` (not `├` and `└`)
   - Spinner: `|`, `/`, `-`, `\` (not braille patterns)

4. **Verify tool panel:**
   - All status indicators use ASCII symbols
   - Text remains readable
   - Layout is correct

### Pass Criteria
- ✅ All Unicode symbols replaced with ASCII equivalents
- ✅ UI remains fully functional
- ✅ Layout and alignment correct
- ✅ All text readable

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

If Unicode symbols don't render:

1. Check terminal supports Unicode:
   ```bash
   echo -e "\xe2\x9c\x94"  # Should show ✔
   ```

2. Try plain mode:
   ```bash
   XAKU_PLAIN=1 npm run dev
   ```

3. Check TERM environment variable:
   ```bash
   echo $TERM
   ```
   Should be `xterm-256color` or similar (not `dumb`)

---

## Acceptance Checklist

Before marking v1 as complete, verify:

- [ ] All automated acceptance tests pass (`scripts/acceptance.ts`)
- [ ] Check 1: Tool call approval flow works (manual)
- [ ] Check 6: Ollama disconnect handled gracefully (manual)
- [ ] Check 7: Symbol fallback works (manual)
- [ ] Cross-platform path handling verified
- [ ] Long-running tools can be cancelled
- [ ] Session logs capture all events
- [ ] No crashes or data loss in any test scenario

---

## Reporting Issues

If any manual test fails:

1. Document the exact steps to reproduce
2. Capture terminal output/screenshots
3. Note the environment (OS, terminal, Ollama version)
4. Check existing issues: https://github.com/yourusername/xaku/issues
5. Create new issue with label "acceptance-test"

---

**Last Updated:** Phase 8.2 - Acceptance Harness  
**Test Coverage:** 7/7 checks (5 automated, 2 manual)
