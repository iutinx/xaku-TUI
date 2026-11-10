import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';

export interface TestCase {
  prompt: string;
  systemPrompt: string | null;
  expectedAnswer?: string;
  evaluationCriteria?: string[];
}

export async function saveTestCase(
  config: Config,
  name: string,
  prompt: string,
  systemPrompt: string | null,
  extra?: { expectedAnswer?: string; evaluationCriteria?: string[] },
): Promise<void> {
  mkdirSync(config.casesDir, { recursive: true });
  const filePath = path.join(config.casesDir, `${name}.json`);
  const testCase: TestCase = {
    prompt,
    systemPrompt,
    ...(extra?.expectedAnswer ? { expectedAnswer: extra.expectedAnswer } : {}),
    ...(extra?.evaluationCriteria?.length ? { evaluationCriteria: extra.evaluationCriteria } : {}),
  };
  writeFileSync(filePath, JSON.stringify(testCase, null, 2), 'utf-8');
}

export async function loadTestCase(
  config: Config,
  name: string,
): Promise<TestCase> {
  const filePath = path.join(config.casesDir, `${name}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as TestCase;
}
