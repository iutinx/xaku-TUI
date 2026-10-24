import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import type { ConversationMessage } from '../model/session.js';

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
