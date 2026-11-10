import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import type { ConversationMessage } from '../model/session.js';
import type { CompareSideResult, ComparisonScore } from '../model/compare.js';
import { DIMENSION_LABELS, DIMENSIONS, type Dimension } from '../model/compare.js';

export interface ExportStats {
  generatedTokens: number;
  toolSuccess: number;
  toolFail: number;
}

export interface ExportResult {
  mdPath: string;
  jsonPath: string;
}

export async function exportSession(
  config: Config,
  messages: ConversationMessage[],
  model: string,
  temperature: number,
  systemPrompt: string | null,
  stats: ExportStats,
): Promise<ExportResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = `xaku-report-${timestamp}`;
  const mdPath = path.join(config.workspace, `${baseName}.md`);
  const jsonPath = path.join(config.workspace, `${baseName}.json`);

  const transcript = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => {
      const role = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Model' : 'System';
      const content = typeof m.content === 'string' ? m.content : '';
      return `### ${role}\n\n${content}\n`;
    })
    .join('\n');

  const md = [
    `# xaku Session Report`,
    ``,
    `**Date:** ${new Date().toISOString()}`,
    `**Model:** ${model || '—'}`,
    `**Temperature:** ${temperature}`,
    `**Workspace:** ${config.workspace}`,
    `**System prompt:** ${systemPrompt ?? '(none)'}`,
    ``,
    `## Performance Statistics`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Generated tokens | ${stats.generatedTokens} |`,
    `| Tool successes | ${stats.toolSuccess} |`,
    `| Tool failures | ${stats.toolFail} |`,
    ``,
    `## Conversation Transcript`,
    ``,
    transcript,
  ].join('\n');

  const json = {
    date: new Date().toISOString(),
    model,
    temperature,
    workspace: config.workspace,
    systemPrompt,
    stats,
    messages,
  };

  writeFileSync(mdPath, md, 'utf-8');
  writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf-8');

  return { mdPath, jsonPath };
}

export interface ComparisonExportData {
  testCaseName: string;
  prompt: string;
  systemPrompt: string | null;
  leftModel: string;
  rightModel: string;
  leftResult: CompareSideResult;
  rightResult: CompareSideResult;
  score?: ComparisonScore;
}

export async function exportComparison(
  config: Config,
  data: ComparisonExportData,
): Promise<ExportResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = `xaku-compare-${timestamp}`;
  const mdPath = path.join(config.workspace, `${baseName}.md`);
  const jsonPath = path.join(config.workspace, `${baseName}.json`);

  const formatResponse = (result: CompareSideResult): string => {
    const lines = [
      `**${result.model}**`,
      '',
      result.responseText || '(no response)',
      '',
      `Time: ${(result.totalTimeMs / 1000).toFixed(1)}s · Tok/s: ${result.tokensPerSecond.toFixed(1)} · Tools: ${result.toolSuccess}/${result.toolCalls} ok`,
    ];
    if (result.toolActivities.length > 0) {
      lines.push('', '**Tool calls:**', '');
      for (const a of result.toolActivities) {
        lines.push(`- ${a.toolName}: ${a.status} (${(a.durationMs / 1000).toFixed(1)}s)`);
      }
    }
    return lines.join('\n');
  };

  const formatScoreTable = (score: ComparisonScore): string => {
    const rows = [
      '| Dimension | Model A | Model B |',
      '| --- | --- | --- |',
    ];
    for (const dim of DIMENSIONS) {
      const l = score.left.ratings[dim];
      const r = score.right.ratings[dim];
      rows.push(`| ${DIMENSION_LABELS[dim]} | ${l !== null ? `${l}/5` : '—'} | ${r !== null ? `${r}/5` : '—'} |`);
    }
    if (score.notes) {
      rows.push('', `**Notes:** ${score.notes}`);
    }
    return rows.join('\n');
  };

  const md = [
    `# xaku Comparison Report`,
    '',
    `**Date:** ${new Date().toISOString()}`,
    `**Test case:** ${data.testCaseName}`,
    `**Prompt:** ${data.prompt}`,
    `**System prompt:** ${data.systemPrompt ?? '(none)'}`,
    `**Workspace:** ${config.workspace}`,
    '',
    '## Responses',
    '',
    formatResponse(data.leftResult),
    '',
    '---',
    '',
    formatResponse(data.rightResult),
    '',
    '## Metrics',
    '',
    '| Metric | Model A | Model B |',
    '| --- | --- | --- |',
    `| Model | ${data.leftResult.model} | ${data.rightResult.model} |`,
    `| Time | ${(data.leftResult.totalTimeMs / 1000).toFixed(1)}s | ${(data.rightResult.totalTimeMs / 1000).toFixed(1)}s |`,
    `| Tok/s | ${data.leftResult.tokensPerSecond.toFixed(1)} | ${data.rightResult.tokensPerSecond.toFixed(1)} |`,
    `| Tools ok | ${data.leftResult.toolSuccess}/${data.leftResult.toolCalls} | ${data.rightResult.toolSuccess}/${data.rightResult.toolCalls} |`,
    `| Response length | ${data.leftResult.responseLength} | ${data.rightResult.responseLength} |`,
    '',
    data.score ? ['## Ratings', '', formatScoreTable(data.score)].join('\n') : '',
  ].filter(Boolean).join('\n');

  const json = {
    date: new Date().toISOString(),
    testCase: data.testCaseName,
    prompt: data.prompt,
    systemPrompt: data.systemPrompt,
    left: {
      model: data.leftResult.model,
      result: data.leftResult,
    },
    right: {
      model: data.rightResult.model,
      result: data.rightResult,
    },
    score: data.score,
  };

  writeFileSync(mdPath, md, 'utf-8');
  writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf-8');

  return { mdPath, jsonPath };
}
