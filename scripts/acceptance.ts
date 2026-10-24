#!/usr/bin/env node

/**
 * Spec §14 Acceptance Test Harness
 * 
 * This script verifies all 7 acceptance criteria for xaku v1.
 * Some checks are automated, others require manual verification with a running Ollama instance.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const PASS = '✓';
const FAIL = '✗';
const WARN = '⚠';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'manual' | 'skip';
  details?: string;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(message);
}

function recordResult(name: string, status: 'pass' | 'fail' | 'manual' | 'skip', details?: string) {
  results.push({ name, status, details });
  const icon = status === 'pass' ? PASS : status === 'fail' ? FAIL : status === 'manual' ? WARN : '○';
  log(`${icon}  ${name}${details ? `: ${details}` : ''}`);
}

async function runUnitTests() {
  log('\n📋 Running unit tests for automated checks...\n');
  try {
    execSync('npx vitest run src/logger.test.ts src/commands/report.test.ts src/ui/theme.test.ts src/tools/executor.test.ts', {
      stdio: 'pipe'
    });
    return true;
  } catch {
    return false;
  }
}

async function checkMalformedToolCalls() {
  log('\n🔍 Check 2: Malformed tool calls are labeled "malformed_call"');
  log('   Running validation tests...');
  
  // This is covered by executor.test.ts which tests:
  // - Invalid JSON arguments
  // - Schema validation failures
  // - Unknown tool names
  try {
    execSync('npx vitest run src/tools/executor.test.ts', { stdio: 'pipe' });
    recordResult('Malformed tool call labeling', 'pass', 'Covered by unit tests');
  } catch {
    recordResult('Malformed tool call labeling', 'fail', 'Unit tests failed');
  }
}

async function checkWorkspaceBoundary() {
  log('\n🔍 Check 3: File paths outside workspace are blocked');
  log('   Running workspace boundary tests...');
  
  // Covered by executor.test.ts which tests path resolution
  try {
    execSync('npx vitest run src/tools/executor.test.ts', { stdio: 'pipe' });
    recordResult('Workspace boundary enforcement', 'pass', 'Covered by unit tests');
  } catch {
    recordResult('Workspace boundary enforcement', 'fail', 'Unit tests failed');
  }
}

async function checkCrashSafeLogging() {
  log('\n🔍 Check 4: Crash-safe logging with session_end on exit');
  log('   Running logger tests...');
  
  try {
    execSync('npx vitest run src/logger.test.ts', { stdio: 'pipe' });
    recordResult('Crash-safe session logging', 'pass', 'Verified by unit tests');
  } catch {
    recordResult('Crash-safe session logging', 'fail', 'Unit tests failed');
  }
}

async function checkExportStatsConsistency() {
  log('\n🔍 Check 5: /export produces report matching /stats');
  log('   Running export tests...');
  
  try {
    execSync('npx vitest run src/commands/report.test.ts', { stdio: 'pipe' });
    recordResult('Export/stats consistency', 'pass', 'Verified by unit tests');
  } catch {
    recordResult('Export/stats consistency', 'fail', 'Unit tests failed');
  }
}

async function checkOllamaDisconnect() {
  log('\n🔍 Check 6: Graceful handling when Ollama stops mid-session');
  log('   This requires a running Ollama instance for full verification.');
  log('   Manual test steps:');
  log('   1. Start xaku: npm run dev');
  log('   2. Send a message and wait for response');
  log('   3. Kill Ollama: pkill ollama');
  log('   4. Send another message');
  log('   5. Verify: Error message shows, conversation preserved');
  log('   6. Restart Ollama and verify reconnection works');
  recordResult('Ollama disconnect handling', 'manual', 'Requires Ollama');
}

async function checkSymbolFallback() {
  log('\n🔍 Check 7: Symbol fallback for terminals without Unicode');
  log('   Running theme tests...');
  
  try {
    execSync('npx vitest run src/ui/theme.test.ts', { stdio: 'pipe' });
    recordResult('Symbol fallback (XAKU_PLAIN=1)', 'pass', 'Verified by unit tests');
    log('   Manual verification: XAKU_PLAIN=1 npm run dev');
  } catch {
    recordResult('Symbol fallback (XAKU_PLAIN=1)', 'fail', 'Unit tests failed');
  }
}

async function checkToolCallFlow() {
  log('\n🔍 Check 1: Tool call with approval and results');
  log('   This requires a running Ollama instance with tool-capable model.');
  log('   Manual test steps:');
  log('   1. Start xaku: npm run dev');
  log('   2. Send: "Read the file test.txt in the current directory"');
  log('   3. Verify: Tool call appears with [a] approve [d] deny prompt');
  log('   4. Press "a" to approve');
  log('   5. Verify: File contents appear in response');
  recordResult('Tool call approval flow', 'manual', 'Requires Ollama');
}

async function main() {
  log('╔═══════════════════════════════════════════════════════════╗');
  log('║  xaku v1 Spec §14 Acceptance Test Harness                ║');
  log('╚═══════════════════════════════════════════════════════════╝');
  
  const unitTestsPass = await runUnitTests();
  if (!unitTestsPass) {
    log('\n❌ Unit tests failed. Fix before proceeding.\n');
    process.exit(1);
  }
  
  log('\n✅ All unit tests passed\n');
  log('═══════════════════════════════════════════════════════════');
  log('Running acceptance checks...\n');
  
  await checkToolCallFlow();
  await checkMalformedToolCalls();
  await checkWorkspaceBoundary();
  await checkCrashSafeLogging();
  await checkExportStatsConsistency();
  await checkOllamaDisconnect();
  await checkSymbolFallback();
  
  log('\n═══════════════════════════════════════════════════════════');
  log('Summary:\n');
  
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const manual = results.filter(r => r.status === 'manual').length;
  
  log(`  ✓ Passed: ${passed}`);
  log(`  ✗ Failed: ${failed}`);
  log(`  ⚠ Manual: ${manual} (require Ollama)`);
  log(`  Total:  ${results.length}`);
  
  if (failed > 0) {
    log('\n❌ Some checks failed. Review the output above.\n');
    process.exit(1);
  } else if (manual > 0) {
    log('\n⚠️  Automated checks passed. Manual verification needed for full acceptance.\n');
  } else {
    log('\n✅ All checks passed!\n');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
