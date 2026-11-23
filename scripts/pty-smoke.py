#!/usr/bin/env python3
"""
Drive the real xaku TUI through a PTY and prove slash commands actually do
something.

Design constraints learned the hard way:

  * Cold start here is 40-90 s (tsx transpile + first Ollama round trip) and the
    box is slow enough that fixed sleeps either race ahead or waste minutes.
    Everything therefore synchronizes on an *event* the handler emits — a new
    session-log line, a file on disk, or a distinctive response string — never on
    a timer.
  * Asserting on scraped screen text is unreliable: the alt-screen paints each
    glyph into its own cell with cursor moves between them, so stripping escapes
    yields "c d" instead of "cd". Response text is matched on stable, unique
    substrings only ("launch directory", "Not a directory", "Exported:").
  * The model menu swallows every key except arrows/Enter/r/Esc, so the chat must
    be entered before typing commands.
  * Slash commands are submitted with a trailing space first: while the palette is
    open the first Enter only *inserts* the highlighted selection (the documented
    two-Enter flow), so a bare Enter after "/pwd" leaves the text in the input.

Run: python3 scripts/pty-smoke.py   (needs Ollama running)
Exit code is 0 only if every check passed.
"""
import glob
import json
import os
import pty
import re
import select
import shutil
import subprocess
import sys
import tempfile
import time

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANSI = re.compile(rb"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\x1b[<>]")

# env-paths('xaku', { suffix: '' }) location on macOS.
LOG_DIR = os.path.expanduser("~/Library/Application Support/xaku/logs")
CASES_DIR = os.path.expanduser("~/Library/Application Support/xaku/cases")


class Tui:
    def __init__(self, workspace):
        self.master, slave = pty.openpty()
        self.proc = subprocess.Popen(
            ["npx", "tsx", "src/cli.tsx", workspace],
            stdin=slave,
            stdout=slave,
            stderr=subprocess.STDOUT,
            cwd=SRC,
            env={**os.environ, "TERM": "xterm-256color", "NODE_NO_WARNINGS": "1"},
        )
        os.close(slave)
        self.buf = b""
        self.baseline = set(glob.glob(os.path.join(LOG_DIR, "session-*.jsonl")))
        self.events = []          # cumulative events from this session's log
        self.read = {}
        self._size(50, 140)

    def _own_log(self):
        fresh = [f for f in glob.glob(os.path.join(LOG_DIR, "session-*.jsonl")) if f not in self.baseline]
        return max(fresh, key=os.path.getmtime) if fresh else None

    def _size(self, rows, cols):
        import fcntl
        import struct
        import termios

        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def type(self, text, delay=0.09):
        for ch in text:
            os.write(self.master, ch.encode())
            time.sleep(delay)

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([self.master], [], [], 0.1)
            if r:
                try:
                    self.buf += os.read(self.master, 65536)
                except OSError:
                    break

    def screen(self):
        text = ANSI.sub(b"", self.buf).decode("utf8", "replace")
        # Collapse the per-cell spacing the alt-screen introduces so substrings match.
        compact = re.sub(r"\s+", " ", "".join(ch for ch in text if ch.isprintable() or ch in "\n "))
        return compact[-30000:]

    # --- synchronization primitives -------------------------------------------

    def refresh_events(self):
        log = self._own_log()
        if not log:
            return self.events
        start = self.read.get(log, 0)
        with open(log, "rb") as fh:
            fh.seek(start)
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    self.events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        self.read[log] = os.path.getsize(log)
        return self.events

    def wait_event(self, name, timeout=45):
        """Block until an event of `name` appears in this session's log."""
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.6)
            self.refresh_events()
            for e in reversed(self.events):
                if e.get("event") == name:
                    return e
        return None

    def wait_text(self, needle, timeout=45):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.6)
            if needle in self.screen():
                return True
        return False

    def submit(self, cmd, settle=1.2):
        self.type(cmd.rstrip() + " ")
        time.sleep(0.3)
        os.write(self.master, b"\r")
        self.pump(settle)

    def submit_wait(self, cmd, event, timeout=45):
        """Submit and block until the handler's log event lands."""
        before = len(self.events)
        self.submit(cmd)
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.6)
            self.refresh_events()
            for e in self.events[before:]:
                if e.get("event") == event:
                    return e
        return None

    def key(self, data, settle=0.8):
        os.write(self.master, data)
        self.pump(settle)

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
        os.close(self.master)


class Checks:
    def __init__(self):
        self.results = []

    def ok(self, name, passed, note=""):
        self.results.append((name, bool(passed)))
        if passed:
            print(f"  ok   {name}", flush=True)
        else:
            print(f" FAIL  {name}\n        {str(note)[-400:]}", flush=True)

    def summary(self):
        failed = [n for n, p in self.results if not p]
        print(f"\n{len(self.results) - len(failed)}/{len(self.results)} passed", flush=True)
        if failed:
            print("failed: " + ", ".join(failed))
        return 1 if failed else 0


def main():
    workspace = tempfile.mkdtemp(prefix="xaku-pty-ws-")
    os.makedirs(os.path.join(workspace, "src"), exist_ok=True)
    with open(os.path.join(workspace, "README.md"), "w") as fh:
        fh.write("# PTY workspace\n\nCreated by scripts/pty-smoke.py.\n")

    c = Checks()
    tui = Tui(workspace)
    try:
        # --- boot ---
        found = tui.wait_text("Ollama connected", timeout=180) or tui.wait_text("disconnected", timeout=20)
        c.ok("menu renders", found, tui.screen()[-300:])
        c.ok("menu shows the workspace path", tui.wait_text("workspace", timeout=20), tui.screen()[-300:])

        tui.key(b"\r")
        c.ok("entered chat", tui.wait_text("Ready to chat", timeout=120), tui.screen()[-300:])

        # Items 5 + 8: launch path visible in the header and at startup.
        c.ok("startup banner names the workspace", tui.wait_text("launch directory", timeout=20), tui.screen()[-400:])

        # --- /pwd ---
        ev = tui.submit_wait("/pwd", "command")
        c.ok("/pwd executed", ev is not None, tui.events[-3:])
        c.ok("/pwd shows current + launch dir", "launch directory" in tui.screen(), tui.screen()[-400:])

        # --- /cd ---
        ev = tui.submit_wait("/cd src", "set_workspace")
        c.ok("/cd accepts a relative path", ev is not None, tui.events[-3:])
        if ev:
            c.ok("/cd resolved to the real directory", ev.get("workspace", "").endswith("/src"), ev)

        ev = tui.submit_wait("/cd nope-missing-xyz", "workspace_error")
        c.ok("/cd rejects a missing directory", ev is not None, tui.events[-3:])
        if ev:
            c.ok("rejection names the bad path", "Not a directory" in str(ev.get("error", "")), ev)

        # Back to the temp root so /export lands in a directory we can inspect.
        ev = tui.submit_wait("/cd " + workspace, "set_workspace")
        c.ok("/cd accepts an absolute path", ev is not None, tui.events[-3:])

        # --- /stats ---
        tui.submit("/stats")
        tui.pump(2.0)
        scr = tui.screen()
        c.ok("/stats reports tool outcomes", "Tools:" in scr, scr[-600:])
        c.ok("/stats reports the log path", "Log:" in scr, scr[-600:])

        # --- /autoapprove ---
        ev = tui.submit_wait("/autoapprove read-only", "set_auto_approve")
        c.ok("/autoapprove sets the mode", ev is not None, tui.events[-3:])
        if ev:
            c.ok("autoapprove mode recorded", ev.get("mode") == "read-only", ev)

        tui.submit("/autoapprove bogus")
        tui.pump(1.5)
        c.ok("invalid mode prints usage", "Usage: /autoapprove" in tui.screen(), tui.screen()[-400:])
        tui.submit_wait("/autoapprove none", "set_auto_approve")

        # --- /save + /load need a prior user prompt ---
        ev = tui.submit_wait("/save pty-case", "command")
        tui.pump(1.5)
        c.ok("/save without a prompt explains itself",
             "send a prompt first" in tui.screen(), tui.screen()[-400:])

        # Send a real prompt, then cancel the generation; the user message stays.
        tui.type("What files are here?")
        time.sleep(0.3)
        os.write(tui.master, b"\r")
        user_ev = tui.wait_event("user_message", timeout=30)
        c.ok("user prompt recorded", user_ev is not None, tui.events[-2:])
        tui.key(b"\x03")
        tui.wait_event("generation_cancelled", timeout=20)

        saved = os.path.join(CASES_DIR, "pty-case.json")
        ev = tui.submit_wait("/save pty-case", "save_case")
        c.ok("/save records save_case", ev is not None, tui.events[-3:])
        c.ok("/save wrote the case file", os.path.exists(saved), saved)
        if os.path.exists(saved):
            body = json.load(open(saved))
            c.ok("case file holds the prompt", bool(body.get("prompt")), body)
            c.ok("case file records the launch workspace", "systemPrompt" in body, body)

        ev = tui.submit_wait("/load pty-case", "load_case")
        c.ok("/load records load_case", ev is not None, tui.events[-3:])
        tui.pump(1.0)
        # /load refills the input; clear it so it cannot leak into the next command.
        for _ in range(40):
            os.write(tui.master, b"\x7f")
        tui.pump(1.0)

        # --- /export ---
        before = set(glob.glob(os.path.join(workspace, "xaku-report-*")))
        ev = tui.submit_wait("/export", "export")
        c.ok("/export records the event", ev is not None, tui.events[-3:])
        after = set(glob.glob(os.path.join(workspace, "xaku-report-*")))
        new_md = sorted(after - before)
        c.ok("/export wrote files", len(new_md) >= 2, sorted(new_md))
        md = [f for f in new_md if f.endswith(".md")]
        if md:
            text = open(md[-1]).read()
            c.ok("report names the workspace", workspace in text, "missing")
            c.ok("report has Summary + Performance", "## Summary" in text and "## Performance" in text, "")
        js = [f for f in new_md if f.endswith(".json")]
        if js:
            data = json.load(open(js[-1]))
            c.ok("JSON twin exposes stats + activities", "stats" in data and "toolActivities" in data, "")
            if md:
                s = data["stats"]
                text = open(md[-1]).read()
                c.ok("report figures match /stats source",
                     str(s["toolCalls"]) in text and str(s["messages"]) in text, s)

        # --- deregistered commands must be honest ---
        tui.submit("/compare x a,b")
        tui.pump(1.5)
        c.ok("/compare reports unknown (deregistered)", "Unknown command /compare" in tui.screen(), tui.screen()[-400:])

        # --- palette reachability (match descriptions, not typed names) ---
        tui.type("/c")
        tui.pump(1.5)
        scr = tui.screen()
        c.ok("palette offers /cd", "Change the workspace folder" in scr, scr[-500:])
        c.ok("palette hides /benchmark", "Run a saved test case across models" not in scr, "")
        c.ok("palette hides /replay", "Step through a past session" not in scr, "")
        tui.key(b"\x1b")
        for _ in range(3):
            os.write(tui.master, b"\x7f")
        tui.pump(0.8)

        tui.type("/p")
        tui.pump(1.5)
        c.ok("palette offers /pwd", "Show the current workspace path" in tui.screen(), tui.screen()[-500:])
        tui.key(b"\x1b")
        for _ in range(3):
            os.write(tui.master, b"\x7f")
        tui.pump(0.8)

        # --- input-clear regression: each command must stand alone ---
        cmds = [e.get("command", "") for e in tui.events if e.get("event") == "command"]
        glued = [x for x in cmds if "\r" in x]
        c.ok("no submission was concatenated", bool(cmds) and not glued, glued[-3:])

        tui.submit_wait("/clear", "clear")
        tui.key(b"\x03")
        tui.pump(2.0)
        c.ok("survived the sweep", tui.proc.poll() is None, "app exited early")
    finally:
        tui.close()
        shutil.rmtree(workspace, ignore_errors=True)
        for f in glob.glob(os.path.join(CASES_DIR, "pty-case.json")):
            os.remove(f)

    return c.summary()



if __name__ == "__main__":
    sys.exit(main())
