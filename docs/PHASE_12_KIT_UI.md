# Phase 12: Claude Code Kit UI Migration — Summary

**Date**: 2026-11-18
**Status**: ✅ Complete
**Tests**: 77/77 passing
**Supersedes**: `docs/PHASE_11_UI_REBRAND.md` (the bespoke Ink UI it describes was deleted)

## Overview

Replaced the hand-rolled Ink UI with `@claude-code-kit/ui` + `@claude-code-kit/ink-renderer`, then progressively refined the chat experience to fix layout, label, animation, and reasoning-visibility issues. The engine (`src/model/`, `src/tools/`, `src/commands/`, `src/logger.ts`) is unchanged.

## What Changed

### 1. Kit migration (drop bespoke UI)

- Deleted `src/ui/` files for the old Ink UI: `TopBar.tsx`, `Banner.tsx`, `MenuScreen.tsx`, `InputLine.tsx`, `ToolPanel.tsx`, `StatusLine.tsx`, `gradient.ts`, `mouse.ts`, plus scrollback hooks.
- Deleted stale engine modules that were only used by old UI: `benchmark.ts`, `compare.ts`, `replay.ts`, `report.ts`.
- Replaced `ink` with `@claude-code-kit/ink-renderer`; added `@claude-code-kit/ui`.
- Upgraded React to `^19.2.0`; bumped `engines` to `>=22.0.0`.
- New UI files kept from the rebrand work: `XakuLogo.tsx` (ASCII banner), `XakuMenu.tsx` (centered Ollama model setup screen), `XakuWelcome.tsx`, `XakuHeader.tsx`, `theme.ts`, `git.ts`.

### 2. Model label fix (Claude → real model name)

The kit's `MessageList` hardcodes the assistant label as `Claude` in `ROLE_CONFIG` **and** in its streaming renderer.

**Fix:**
- Custom `renderMessage` callback in `src/app.tsx` renders assistant messages with `● <model>` (purple accent), user messages with `❯ You` (cyan), system messages dimmed.
- During streaming, instead of using the kit's `streamingContent` prop (which also says "Claude"), we append a synthetic assistant message `id: '__streaming'` to `kitMessages` whose content is the animated partial. That synthetic message flows through our `renderMessage` like any other, so the model name is correct.

### 3. Replaced `REPL` with kit primitives

The kit's `REPL` renders command suggestions inline inside `PromptInput`, pushing the rest of the layout down and breaking alignment.

**Fix:** Drop `REPL`. Compose the chat from lower-level kit components we control:

| Slot | Component |
|---|---|
| Top | `XakuHeader` (model, ctx bar, tokens, tool counts, git, hint slots) |
| History | `MessageList` with `viewportHeight` (virtualized) |
| Divider | `Divider` |
| Palette | `CommandPalette` (new, see below) |
| Input | `PromptInput` (with our own `value`/`onChange` lifted into App) |
| Approval | `PermissionRequest` (replaces PromptInput while pending) |
| Divider | `Divider` |
| Status | `StatusLine` |

Input value, history, and submit handler are now owned by `App`, so we have a clean place to intercept slash input.

### 4. Custom command palette (`src/ui/CommandPalette.tsx`)

- Triggered when input starts with `/` and has no space and is not dismissed.
- Filters via `getFilteredCommands()` from `src/commands/index.ts` (14 commands: model, temperature, system, clear, retry, autoapprove, compact, benchmark, compare, replay, stats, export, save, load).
- Layout: rounded purple border, fixed-width `name` column (padded), description column truncated to fit terminal width with `…`, hints in purple.
- Max 6 visible; arrow keys wrap.
- **Key capture trick:** `CommandPalette` is rendered as a JSX sibling **before** `PromptInput`. React's effect mount order is siblings-first, so `CommandPalette`'s `useInput` listener is registered before `PromptInput`'s. When the palette is open, our handler calls `event.stopImmediatePropagation()` on ↑ ↓ Enter Tab Esc, cleanly preventing `PromptInput` from running its history navigation on the same keystroke. When the palette is closed, our handler is a no-op (the listener is always attached because `useInput` doesn't unsubscribe on `isActive === false`).
- Selecting inserts `/cmd ` (trailing space) into the input. Second Enter actually submits. Matches user expectation: "select from dropdown, then press Enter again to execute."
- Esc dismisses until the slash query changes.

### 5. Response animation (`src/ui/hooks.ts`)

Two small hooks used by `app.tsx`:

- **`useTypewriter(target, charsPerTick = 3, tickMs = 20)`** — reveals the streaming target character-by-character. Internally keeps `displayRef` so the interval always sees the latest value; snaps to target when target shrinks (e.g. on cancel) or when target grows past what's already displayed.
- **`useBlink(periodMs = 530, active = true)`** — toggles a boolean on a `setInterval`; only runs while `active`.

Wired into `renderMessage`:

- Synthetic streaming message's content is `useTypewriter(generating ? partial : '')` — text appears letter-by-letter as the model streams.
- When the typewriter is still empty but generation has started, render `<Spinner />` so the user sees "working" feedback before any tokens arrive.
- A purple `▌` cursor at the end of the streaming text toggles visibility via `useBlink(530, generating)`.
- `XakuHeader` swaps `◉` for `◐` while `isGenerating`.

### 6. Collapsible thinking (`Ctrl+T`)

Reasoning text from thinking-capable models (e.g. `qwen3:4b`) used to be prepended as plain `> thinking: …` text. Now:

- `toKitMessages` emits structured `MessageContent[]`: `{type:'thinking', text}` block followed by `{type:'text', text}` block.
- `renderMessage` shows thinking as `✻ Thinking… (Ctrl+T to expand)` collapsed by default; only the body is rendered when expanded.
- App-level `useInput` toggles a global `showThinking` flag on `Ctrl+T`. Header shows `^T show/hide thinking` hint when any thinking is present in the transcript.
- Reasoning is preserved on the `ConversationMessage` but never re-sent to the model (`toOpenAIMessages` strips it).

### 7. Header updates

`XakuHeader.tsx` now accepts:

```ts
isGenerating?: boolean;     // swaps ◉ → ◐
showThinking?: boolean;     // controls the ^T hint text
hasThinking?: boolean;      // only show the hint when thinking exists
```

Layout uses `justifyContent="space-between"` so the model/context info sits on the left and the git branch + thinking hint sit on the right.

## Technical Details

### New files

- `src/ui/CommandPalette.tsx` — custom aligned slash-command dropdown.
- `src/ui/hooks.ts` — `useTypewriter`, `useBlink`.

### Modified files

- `src/app.tsx` — major refactor: drop `REPL`, lift input state, structured thinking content blocks, custom renderMessage, palette + global key handlers (Ctrl+T, Ctrl+C), dynamic viewport height.
- `src/ui/XakuHeader.tsx` — added generation indicator and thinking hint slots.
- `src/model/ollama.ts` — kept `getModelContextLength()` (now consumed in App for the ctx bar).
- `package.json` — React 19.2, `engines >=22`, dependencies on `@claude-code-kit/ui` and `@claude-code-kit/ink-renderer`.

### Deleted files

- All old `src/ui/` Ink components (`TopBar`, `Banner`, `MenuScreen`, `InputLine`, `ToolPanel`, `StatusLine`, `gradient.ts`, `mouse.ts`, etc.).
- Unused engine modules (`benchmark.ts`, `compare.ts`, `replay.ts`, `report.ts`).
- 15 stale test files under `tests/ui/` and three under `tests/model/` and `tests/commands/` referencing the deleted code.

## Behavior Notes

- **Layout stability.** `viewportHeight = rows - 7 - paletteRows - (pendingTool ? 8 : 0)`. When the palette opens, message viewport shrinks by exactly the palette height; when it closes, viewport expands. Total TUI rows never change.
- **Two-Enter command flow.** First Enter on a highlighted suggestion inserts `/cmd ` into the input. The palette closes (because of the trailing space). A second Enter actually submits.
- **Blink cursor only while streaming.** `useBlink(530, generating)` stops the interval once generation ends.
- **Thinking is global, not per-message.** `Ctrl+T` toggles visibility for every thinking block currently in the transcript. Clicking was considered but rejected — SGR mouse delivery is inconsistent across terminals (Apple Terminal does not report it at all).
- **Raw TTY requirement.** The new TUI still requires a real TTY. Backgrounded runs fail with `Raw mode is not supported on the current process.stdin`.

## Verification

- ✅ `npm run typecheck` — clean.
- ✅ `npx tsc` (build) — clean.
- ✅ `npx vitest run` — 77/77 passing across 6 files.
- ✅ Manual run: model label correct, palette aligned, streaming animates letter-by-letter with blinking `▌`, spinner visible during "thinking" phase before first token, `Ctrl+T` toggles reasoning body.

## Open / Follow-up

- Per-message thinking expand state (currently a single global toggle).
- Mouse-clickable thinking in terminals that support SGR (iTerm2, Kitty, WezTerm, Ghostty, Windows Terminal).
- Long-description command hints currently truncate with `…` — could surface as a tooltip on the focused row instead.
