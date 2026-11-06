# Windows Platform Guide for xaku

This document covers Windows-specific considerations, known issues, and testing procedures.

## Platform Support Status

xaku is designed to be cross-platform and should work on:
- ✅ **macOS** (primary development platform, fully tested)
- ✅ **Linux** (fully tested)
- ⚠️ **Windows** (tested via unit tests, manual verification needed)

## Installation on Windows

### Prerequisites

1. **Node.js v25+** (required)
   - Download from: https://nodejs.org/
   - Verify: `node --version`

2. **Ollama** (required for model interaction)
   - Download from: https://ollama.ai/download/windows
   - Install and start the Ollama service

3. **Terminal** (recommended: Windows Terminal)
   - Download from: https://aka.ms/terminal
   - Provides better Unicode support and rendering

### Installation Steps

```powershell
# Clone the repository
git clone https://github.com/yourusername/xaku.git
cd xaku

# Install dependencies
npm install

# Build the project
npm run build

# Start xaku
npm run dev
```

## Windows-Specific Features

### 1. Shell Command Execution

xaku automatically detects the platform and uses the appropriate shell:
- **Windows**: `cmd.exe /c <command>`
- **Unix/Linux**: `/bin/sh -c <command>`

**Example:**
```
User: Run the command: dir
→ Windows: cmd.exe /c dir
→ Unix: /bin/sh -c dir
```

### 2. Path Handling

xaku uses Node.js `path` module which handles platform-specific path separators:
- **Windows**: Uses `\` as separator
- **Unix/Linux**: Uses `/` as separator

The workspace boundary check is cross-platform and works with:
- Forward slashes (`/`)
- Backslashes (`\`) on Windows
- Mixed separators (automatically normalized)
- Drive letters (e.g., `C:\workspace`)
- Relative paths (`.\file.txt`, `..\parent\file.txt`)

### 3. Symbol Fallback

Windows terminals may not support all Unicode symbols. xaku provides two modes:

**Unicode mode** (default):
- ✔ ✖ ↓ (checkmarks, crosses, arrows)
- ⠋ ⠙ ⠹ (braille spinners)
- ├ └ (tree connectors)

**Plain mode** (for terminals without Unicode support):
```powershell
$env:XAKU_PLAIN="1"
npm run dev
```

Or set permanently:
```powershell
[System.Environment]::SetEnvironmentVariable('XAKU_PLAIN', '1', 'User')
```

**Plain mode symbols:**
- `[ok]` `[x]` `[skip]`
- `|` `/` `-` `\` (ASCII spinners)
- `|-` `` `- `` (ASCII tree connectors)

## Known Windows Issues

### 1. Process Termination

**Issue**: On Windows, `process.kill()` behaves differently than Unix signals.

**Impact**: Tool cancellation (`Esc` key) may take slightly longer on Windows.

**Workaround**: xaku uses `SIGTERM` with a 1-second grace period before escalating to `SIGKILL`. This is handled automatically.

### 2. File Path Length

**Issue**: Windows has a default 260-character path limit (MAX_PATH).

**Impact**: Deeply nested files may not be accessible.

**Workaround**: 
- Use shorter workspace paths
- Enable long paths in Windows 10+: `Group Policy > Computer Configuration > Administrative Templates > System > Filesystem > Enable Win32 long paths`

### 3. Terminal Rendering

**Issue**: Some Windows terminals (especially older ones) may have rendering issues with:
- Unicode box-drawing characters
- ANSI color codes
- Rapid screen updates

**Impact**: Visual glitches or incorrect colors.

**Workaround**:
1. Use Windows Terminal (recommended)
2. Enable plain mode: `XAKU_PLAIN=1`
3. Update graphics drivers

### 4. SQLite File Locking

**Issue**: Windows uses mandatory file locking, unlike Unix's advisory locking.

**Impact**: If xaku crashes while a SQLite database is open, the file may remain locked.

**Workaround**:
- Always exit xaku cleanly (`Ctrl+C` or `/exit`)
- If database is locked, restart your terminal or computer
- xaku opens databases in read-only mode to minimize locking issues

## Testing on Windows

### Automated Tests

All unit tests should pass on Windows:

```powershell
npm test
```

Expected: 233 tests passing (18 files — unit + UI layout tests).

### Manual Tests

> For the UI-polish flows (row scrollback + mouse wheel, thinking-block click toggle + `Ctrl+T`) follow **Check 8 and Check 9** in `docs/MANUAL_TESTS.md` — Windows Terminal supports SGR mouse reporting, so the wheel and clicks should work there.

#### Test 1: Basic Chat

1. Start xaku: `npm run dev`
2. Send message: `Hello, what is 2+2?`
3. Expected: Model responds with answer
4. Verify: All text renders correctly (no garbled characters)

#### Test 2: Tool Execution

1. Create a test file:
   ```powershell
   echo "Hello from Windows" > test.txt
   ```

2. Start xaku and request:
   ```
   Read the file test.txt
   ```

3. Expected:
   - Tool call appears in right panel
   - Approval prompt: `[a] approve [d] deny`
   - After approval: file contents displayed

#### Test 3: Shell Command

1. Start xaku
2. Request:
   ```
   Run the command: dir
   ```

3. Expected:
   - `cmd.exe /c dir` executes
   - Directory listing displayed
   - No errors about shell not found

#### Test 4: Cancellation

1. Start xaku
2. Request a long-running command:
   ```
   Run the command: ping -n 10 localhost
   ```

3. While command is running, press `Esc`
4. Expected:
   - Command is cancelled
   - Tool panel shows "cancelled"
   - xaku returns to input prompt

#### Test 5: Plain Mode

1. Start xaku with plain mode:
   ```powershell
   $env:XAKU_PLAIN="1"
   npm run dev
   ```

2. Verify symbols:
   - No Unicode characters visible
   - All indicators use ASCII: `[ok]`, `|`, etc.
   - Layout is correct (no misalignment)

## Troubleshooting

### "Ollama not found" Error

**Problem**: xaku can't connect to Ollama.

**Solution**:
1. Ensure Ollama is installed and running
2. Check if Ollama is accessible: `curl http://localhost:11434/api/tags`
3. Restart Ollama service: `net stop ollama && net start ollama`

### "Command not found" Error

**Problem**: Shell commands fail with "not recognized".

**Solution**:
1. Ensure the command is in your PATH
2. Use full path: `C:\Windows\System32\cmd.exe`
3. Check command syntax for Windows (e.g., `dir` not `ls`)

### Garbled Text or Symbols

**Problem**: Unicode characters display incorrectly.

**Solution**:
1. Use Windows Terminal
2. Enable plain mode: `$env:XAKU_PLAIN="1"`
3. Check terminal font supports Unicode (e.g., Consolas, Cascadia Code)

### Database Locked Error

**Problem**: SQLite database is locked after crash.

**Solution**:
1. Close all xaku instances
2. Restart terminal
3. If still locked, delete the database file (you'll lose data)

### Build Errors

**Problem**: `npm run build` fails.

**Solution**:
1. Ensure Node.js v25+ is installed: `node --version`
2. Delete `node_modules` and reinstall:
   ```powershell
   Remove-Item -Recurse -Force node_modules
   npm install
   ```
3. Clear npm cache: `npm cache clean --force`

## Performance Considerations

### File System Operations

Windows file system operations are generally slower than Unix. Expect:
- 10-20% slower tool execution
- Longer startup times (especially with many files in workspace)

### Memory Usage

xaku uses similar memory on all platforms (~100-200MB). If you experience high memory usage:
- Reduce workspace size
- Clear session logs: `Remove-Item -Recurse ~/.config/xaku/logs/*`

## Windows-Specific Paths

### Configuration Files

- **Config**: `%APPDATA%\xaku\config.json`
- **Session logs**: `%APPDATA%\xaku\logs\session-*.jsonl`
- **Saved test cases**: `%APPDATA%\xaku\cases\*.json`

### Default Paths

- **Workspace**: Current directory (where you run `npm run dev`)
- **Ollama models**: `%USERPROFILE%\.ollama\models`

## Contributing

If you find Windows-specific issues:

1. Check existing issues: https://github.com/yourusername/xaku/issues
2. Create new issue with:
   - Windows version: `winver`
   - Node.js version: `node --version`
   - Terminal: Windows Terminal version or PowerShell version
   - Steps to reproduce
   - Expected vs actual behavior

## Resources

- [Node.js on Windows](https://nodejs.org/en/docs/guides/nodejs-vs-v8-on-windows/)
- [Windows Terminal Documentation](https://docs.microsoft.com/en-us/windows/terminal/)
- [Ollama Windows Installation](https://ollama.ai/download/windows)
- [PowerShell Best Practices](https://docs.microsoft.com/en-us/powershell/scripting/dev-cross-plat/writing-portable-modules)

---

**Last Updated**: Phase 8.3 - Windows Caution Pass  
**Platform Support**: macOS ✅ | Linux ✅ | Windows ⚠️
