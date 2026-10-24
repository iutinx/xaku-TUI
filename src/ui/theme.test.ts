import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSymbols, isPlainMode } from './theme.js';

describe('Spec §14 Acceptance: Symbol Fallback', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment before each test
    delete process.env.XAKU_PLAIN;
    delete process.env.TERM;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  it('Check 7: Default mode uses Unicode symbols', () => {
    expect(isPlainMode()).toBe(false);
    const symbols = getSymbols();
    expect(symbols.success).toBe('✔');
    expect(symbols.failure).toBe('✖');
    expect(symbols.skipped).toBe('↓');
    expect(symbols.treeBranch).toBe('├');
    expect(symbols.treeLast).toBe('└');
    expect(symbols.spinner[0]).toBe('⠋');
  });

  it('Check 7: XAKU_PLAIN=1 uses plain ASCII symbols', () => {
    process.env.XAKU_PLAIN = '1';
    
    expect(isPlainMode()).toBe(true);
    const symbols = getSymbols();
    expect(symbols.success).toBe('[ok]');
    expect(symbols.failure).toBe('[x]');
    expect(symbols.skipped).toBe('[skip]');
    expect(symbols.treeBranch).toBe('|-');
    expect(symbols.treeLast).toBe('`-');
    expect(symbols.spinner[0]).toBe('|');
  });

  it('Check 7: TERM=dumb uses plain ASCII symbols', () => {
    process.env.TERM = 'dumb';
    
    expect(isPlainMode()).toBe(true);
    const symbols = getSymbols();
    expect(symbols.success).toBe('[ok]');
    expect(symbols.failure).toBe('[x]');
  });

  it('Check 7: All plain symbols are ASCII-safe', () => {
    process.env.XAKU_PLAIN = '1';
    
    const symbols = getSymbols();
    
    // All plain symbols should only contain ASCII characters
    const asciiRegex = /^[\x00-\x7F]*$/;
    
    for (const spinner of symbols.spinner) {
      expect(spinner).toMatch(asciiRegex);
    }
    expect(symbols.success).toMatch(asciiRegex);
    expect(symbols.failure).toMatch(asciiRegex);
    expect(symbols.skipped).toMatch(asciiRegex);
    expect(symbols.pending).toMatch(asciiRegex);
    expect(symbols.treeBranch).toMatch(asciiRegex);
    expect(symbols.treeLast).toMatch(asciiRegex);
    expect(symbols.cursor).toMatch(asciiRegex);
  });

  it('Check 7: Unicode symbols contain non-ASCII characters', () => {
    delete process.env.XAKU_PLAIN;
    delete process.env.TERM;
    
    const symbols = getSymbols();
    
    // Unicode symbols should contain non-ASCII characters (like ✔, ✖, etc.)
    const hasNonAscii = (str: string) => /[^\x00-\x7F]/.test(str);
    
    expect(hasNonAscii(symbols.success)).toBe(true);
    expect(hasNonAscii(symbols.failure)).toBe(true);
    expect(hasNonAscii(symbols.spinner[0])).toBe(true);
  });
});
