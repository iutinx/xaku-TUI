import { Box, Text } from 'ink';
import type { BenchmarkResult } from '../model/benchmark.js';
import { theme } from './theme.js';

export interface BenchmarkPanelProps {
  testCaseName: string;
  models: string[];
  results: BenchmarkResult[];
  running: boolean;
  currentModel: string | null;
}

const COLS = [
  { key: 'model', header: 'Model', width: 22, align: 'left' as const },
  { key: 'time', header: 'Time(s)', width: 9, align: 'right' as const },
  { key: 'tps', header: 'Tok/s', width: 8, align: 'right' as const },
  { key: 'tools', header: 'Tools', width: 8, align: 'right' as const },
  { key: 'okfail', header: 'Ok/Fail', width: 9, align: 'right' as const },
  { key: 'avgtool', header: 'Tool ms', width: 10, align: 'right' as const },
  { key: 'len', header: 'Len', width: 7, align: 'right' as const },
];

function cell(result: BenchmarkResult, key: string): string {
  switch (key) {
    case 'model':
      return result.model.length > 22 ? result.model.slice(0, 21) + '…' : result.model;
    case 'time':
      return (result.totalTimeMs / 1000).toFixed(1);
    case 'tps':
      return result.tokensPerSecond.toFixed(1);
    case 'tools':
      return String(result.toolCalls);
    case 'okfail':
      return `${result.toolSuccess}/${result.toolFail}`;
    case 'avgtool':
      return result.avgToolDurationMs.toFixed(0);
    case 'len':
      return String(result.responseLength);
    default:
      return '';
  }
}

export function BenchmarkPanel({ testCaseName, models, results, running, currentModel }: BenchmarkPanelProps) {
  const bestTps = results
    .filter((r) => r.status === 'ok')
    .reduce((max, r) => Math.max(max, r.tokensPerSecond), 0);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={theme.primary}>
        Benchmark · {testCaseName}
      </Text>
      <Text color={theme.muted}>
        {running
          ? `⠋ Running ${results.length + 1}/${models.length}: ${currentModel ?? '—'}…  (Esc to cancel)`
          : `Done · ${results.length}/${models.length} models  (Esc to close)`}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {COLS.map((c) => pad(c.header, c.width, c.align)).join(' ')}
        </Text>
        <Text color={theme.muted}>{'─'.repeat(COLS.reduce((n, c) => n + c.width + 1, 0) - 1)}</Text>
        {results.map((r) =>
          r.status === 'error' ? (
            <Text key={r.model} color={theme.failure}>
              {pad(r.model, 22, 'left')} ✖ {r.error ? (r.error.length > 50 ? r.error.slice(0, 49) + '…' : r.error) : 'failed'}
            </Text>
          ) : (
            <Text key={r.model}>
              {COLS.map((c) => {
                const text = pad(cell(r, c.key), c.width, c.align);
                if (c.key === 'tps' && r.tokensPerSecond === bestTps && bestTps > 0) {
                  return <Text key={c.key} color={theme.success}>{text}</Text>;
                }
                return <Text key={c.key}>{text}</Text>;
              })}
            </Text>
          ),
        )}
        {running && currentModel && (
          <Text color={theme.muted}>{pad(currentModel, 22, 'left')} ⠋ running…</Text>
        )}
      </Box>
    </Box>
  );
}

function pad(text: string, width: number, align: 'left' | 'right'): string {
  return align === 'left' ? text.padEnd(width) : text.padStart(width);
}
