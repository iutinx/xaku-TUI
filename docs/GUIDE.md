# Open-BenchTUI v1 Spec

*Build-ready specification for a developer or AI coder. Status: draft v1, based on the product brief and the planning decisions made in discussion.*

## 1. Overview

Open-BenchTUI is a terminal application for chatting with, stress-testing, and reviewing a local AI model, with a focus on how reliably the model uses tools. It connects to a model running in Ollama, streams the conversation, shows every tool call the model makes in a dedicated panel, lets the user approve each action before it runs, and records the whole session for later review.

**Primary job for v1:** let the developer see how a fine-tuned model performs: response quality, speed, and tool-use correctness.

**Launch command:** `open-bench` opens a fullscreen terminal workspace.

## 2. Goals and non-goals

### Goals (v1)

- Chat with a local Ollama model with live streaming output.
- Show tool calls separately from conversation text, with a format check on each one.
- Require user approval for every tool action before it executes.
- Provide nine slash commands (section 7).
- Show a live stats bar (speed, context length, tool results, connection).
- Log every session automatically and export a report on demand.
- Run on macOS first, with Windows and Linux supported.

### Non-goals (later versions)

- Side-by-side comparison of two models answering the same prompt (design for it, do not build it).
- Custom (non-standard) tool-call formats.
- Database types other than SQLite.
- Remote or cloud model providers beyond any OpenAI-compatible endpoint the user points at.

## 3. Technology stack

| Area | Choice |
| --- | --- |
| Language | Node.js with TypeScript |
| Layout (panels, input, stats bar) | Ink (React for terminals) |
| Tool activity list and visual style | listr2 look and feel (see section 6) |
| Model connection | Official `openai` npm package pointed at Ollama |
| Session log | JSONL files |
| Reports | Markdown plus a JSON copy of the raw data |
| Database tool | SQLite |

The developer should confirm each library’s current version and fit when starting. If listr2 cannot be embedded inside an Ink layout cleanly, reproduce its visual language (icons, colors, spinners, indented detail lines) with Ink components rather than dropping the style.

## 4. Architecture

```
User input → Open-BenchTUI → Ollama (default http://localhost:11434) → Qwen / fine-tuned model
                  ↑                                                        │
                  └──── streamed text, tool calls, timing, token counts ───┘
```

Modules (suggested):

- **Connection layer:** talks to the model server, handles streaming, errors, and reconnects.
- **Session manager:** holds conversation history, active model, temperature, and system prompt.
- **Tool engine:** validates tool calls, requests approval, executes, and returns results.
- **Event log:** appends every event to the session log file.
- **UI layer:** renders the screen from session and log state.
- **Command handler:** parses and runs slash commands.

## 5. Model connection

### 5.1 Protocol

Use the OpenAI-compatible chat completions endpoint exposed by Ollama (`/v1`), including the `tools` parameter and streaming. This keeps the app compatible with other servers that speak the same protocol.

### 5.2 Configuration

- Default base URL: `http://localhost:11434/v1`.
- Overridable by config file, environment variable, or command-line flag, so the model can run on another machine on the local network.
- If the server is unreachable at launch or mid-session, show a clear error with the hint to start Ollama, and retry on user request.

### 5.3 Models

- `/model` lists installed models from the server and lets the user pick one.
- On selection, check whether the model supports tools (for example through Ollama’s model-info endpoint; the developer should verify the exact field in the installed Ollama version). If not, show a visible warning in the tool panel: the model cannot use tools.
- Recommended starter models for development on a 16 GB Mac: `qwen3:8b` (main) and `qwen3:4b` (quick tests). Check the Ollama library for newer Qwen releases that carry the Tools label.
- The user’s fine-tuned model does not exist yet. It will be imported into Ollama later (for example from a GGUF file through a Modelfile and `ollama create`) and will then appear in `/model` like any other model. The spec requires no special handling for it.

### 5.4 Stats sources

- **Tokens per second:** tokens generated divided by generation time, measured client-side from the first streamed token. Where the server reports its own timing, prefer or cross-check against it.
- **Context length:** tokens currently in the conversation history, using server-reported token counts where available (request usage reporting on streamed responses) and a local estimate otherwise.

## 6. Screen layout and visual style

### 6.1 Layout

```
┌─ Open-BenchTUI · qwen-ft-v1 · temp 0.2 · system set ────────────────────────────────┐
│ CHAT                                       │ TOOL ACTIVITY                          │
│                                            │                                        │
│ you                                        │ ✔ list_dir ./src              0.4s     │
│ Look inside my project folder and read     │ ✖ read_file ./missing.md      0.1s     │
│ the README file.                           │   └ file not found                     │
│                                            │     [f] fix  [s] skip  [r] retry       │
│ model                                      │ ⠹ read_file ./README.md                │
│ Sure, I'll open the README to see what     │   ├ format check: ✔ valid              │
│ the project is about.▌                     │   └ awaiting approval                  │
│                                            │     [a] approve  [d] deny              │
│                                            │ ↓ run_query                  skipped   │
├────────────────────────────────────────────┴────────────────────────────────────────┤
│ > /                                                                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ⠹ generating · 42.3 tok/s · context 1,208 · tools ✔ 3  ✖ 1 · ✔ ollama connected    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** product name, active model, temperature, whether a system prompt is set.
- **Left panel (Chat):** conversation with character-by-character streaming and a live cursor.
- **Right panel (Tool activity):** appears when the model makes its first tool call. Until then the chat may use the full width (open to design review). Each entry shows status icon, tool name, arguments, format-check result, timing, and any action keys.
- **Input line:** typing `/` opens a menu of the nine commands.
- **Bottom bar (Stats):** always visible.

### 6.2 Visual language (listr2 style, whole app)

- Spinner (animated) for anything in progress: generating, awaiting approval, running.
- Green ✔ for success, red ✖ for failure, yellow ↓ for skipped.
- Detail lines indented under each item with tree connectors (├ and └).
- Dark theme.
- **Fallback:** detect terminals that cannot render these symbols (notably some Windows terminals) and switch to plain markers such as `[ok]`, `[x]`, `[skip]`, and a simple text spinner.

## 7. Slash commands

| Command | Behavior |
| --- | --- |
| `/model` | List installed models and switch the active one. Runs the tool-support check. |
| `/temperature <0–2>` | Set sampling temperature. Show the current value in the top bar. |
| `/system` | Set or edit the system prompt. |
| `/export` | Build the report from the session log (section 11). |
| `/clear` | Start a fresh conversation. The previous session’s log is kept. |
| `/retry` | Re-send the last user prompt with the current settings. |
| `/stats` | Show detailed speed and tool statistics for the session. |
| `/save <name>` | Save the current prompt (or system prompt plus prompt) as a reusable test case. |
| `/load <name>` | Load a saved test case. |

Unknown commands show a short error and suggest the closest match.

## 8. Tool system

### 8.1 Format

Use the standard tool-call format (the one the OpenAI-compatible API and Qwen models on Ollama already support). Design the validator so that a custom format checker can be added later.

### 8.2 Built-in tools

| Tool | Purpose | Risk |
| --- | --- | --- |
| `read_file` | Read a file’s contents | Low |
| `list_dir` | List files in a folder | Low |
| `write_file` | Create or change a file | Can change data |
| `run_shell` | Run a terminal command | Can change data |
| `query_db` | Run a query on a SQLite database | Low by default (read-only) |

Each tool has a declared name, description, and argument schema that is sent to the model with every request.

### 8.3 Execution flow

1. The model returns a tool call.
2. The app validates it: the tool exists, the arguments parse, and they match the schema. The result (✔ valid or ✖ with the reason) is shown in the right panel.
3. If valid, the app shows a full preview and waits for approval: `[a] approve` or `[d] deny`.
4. On approval, the tool runs. The result is shown and sent back to the model as the tool result.
5. On denial, the model receives a message saying the user denied the action.
6. Every step is written to the session log.

**Every action requires approval.** There is no auto-run mode in v1.

### 8.4 Safety rules

- **Workspace folder:** the user selects a workspace folder at launch (default: the current directory). All file tools are restricted to it. Paths that resolve outside it (including through `..` or symbolic links) are rejected.
- **Full preview before approval:** exact path for reads, full new contents for writes, exact command for shell, exact query for the database.
- **Shell limits:** a timeout (configurable, with a sensible default) and capped output size.
- **Result trimming:** very large file or query results are trimmed before being sent back to the model, and the log records that trimming happened.
- **Database:** `query_db` opens the SQLite file in read-only mode by default.
- **Cross-platform paths:** handle both `/` and `\` path styles and normalize before checking the workspace boundary.

## 9. Error handling

Tool and format problems must be clearly labeled so the developer can tell a confused model from a mistyped command.

| Label | Meaning |
| --- | --- |
| `unknown_tool` | Model called a tool that does not exist |
| `malformed_call` | Arguments are not valid JSON or fail the schema |
| `denied` | User denied the action |
| `blocked` | Rejected by a safety rule (outside workspace, read-only, and similar) |
| `execution_error` | The tool ran and failed (file not found, query error, timeout) |
| `no_tool_support` | Selected model does not support tools |

On any failure the app shows the error in the tool panel and offers the user a choice every time:

- `[f] fix`: send the error back to the model so it can try again.
- `[s] skip`: mark the call skipped and continue.
- `[r] retry`: run the same call again.

The app never auto-retries or auto-feeds errors back without the user choosing. Connection errors (Ollama not running, timeouts) show a banner with a retry option and never lose the conversation.

## 10. Session logging

- One log file per session, written automatically as events happen (append-only, one JSON object per line).
- Events to record: session start (model, settings, workspace), system prompt changes, each user message, each streamed model reply with token counts and timing, each tool call (raw, validation result, preview), approval or denial, tool result or error label, the user’s fix, skip, or retry choice, setting changes, and session end.
- Crash safety: write each event immediately so an unexpected exit loses nothing.
- Location: the standard per-user application data folder for each operating system, shown to the user on request, with a way to delete logs.
- Privacy: logs may contain file contents and query results the model saw. They stay on the local machine only.

## 11. Export and saved prompts

### 11.1 `/export`

Builds from the session log, so the report always matches `/stats`. Outputs two files in the workspace folder (or a chosen path):

- **Markdown report:** session summary (model, settings, date), performance statistics, a conversation transcript, a tool-call table (tool, arguments, validation, approval, result or error label, timing), and a list of failures with their labels.
- **JSON file:** the same data in structured form.

### 11.2 Saved test cases

`/save` and `/load` store reusable prompts as small files in the app data folder, separate from session logs.

## 12. Cross-platform requirements

- Supported: macOS (primary), Windows, Linux.
- Normalize file paths and shell invocation per operating system.
- Symbol and spinner fallback for limited terminals (section 6.2).
- Config, logs, and saved prompts use each system’s standard application folders.
- Document setup for each system: install Ollama, pull a model, install and run `open-bench`.

## 13. Suggested build order

1. Connect to Ollama, stream a basic chat, show the stats bar.
2. Add the full layout and listr2-style visuals with fallback symbols.
3. Add session logging.
4. Add the tool engine with `read_file` and `list_dir`, validation, and the approval flow.
5. Add error labels and fix, skip, and retry.
6. Add `write_file`, `run_shell`, and `query_db` with all safety rules.
7. Add slash commands: `/model`, `/temperature`, `/system`, `/clear`, `/retry`.
8. Add `/stats`, `/export`, `/save`, and `/load`.
9. Cross-platform testing on Windows and Linux.

## 14. Acceptance checks for v1

- With Ollama running `qwen3:8b`, a prompt asking to read a README produces a valid tool call, an approval prompt, and the file contents sent back to the model.
- A deliberately malformed tool call is labeled `malformed_call` and offers fix, skip, and retry.
- A file path outside the workspace is blocked.
- Closing the terminal mid-session leaves a complete log up to the last event.
- `/export` produces a Markdown report and a JSON file whose numbers match `/stats`.
- Stopping Ollama mid-session shows a banner and does not crash the app or lose the conversation.
- The app is usable on a terminal without symbol support using the fallback markers.

## 15. Later (designed for, not built in v1)

- Side-by-side comparison: run two models on the same prompt in a split view. Keep the session and log structures model-agnostic so a second session can run in parallel.
- Custom tool-call format checkers.
- Additional database types.
- Optional auto-approve modes for trusted read-only tools.

## 16. Open items to confirm during build

- Whether the right panel is hidden until the first tool call.
- Default values for shell timeout and result size limits.
- Exact method for the tool-support check in the installed Ollama version.
- Whether listr2 can be embedded in Ink directly or its style should be reproduced.
