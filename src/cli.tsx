#!/usr/bin/env node
import { Command } from 'commander';
import { render } from '@claude-code-kit/ink-renderer';
import React from 'react';
import App from './app.js';
import { buildConfig } from './config.js';

const program = new Command();

program
  .name('runxaku')
  .description('Terminal workspace for local Ollama models')
  .argument('[workspace]', 'Workspace folder (default: current directory)', process.cwd())
  .option('-m, --model <model>', 'Model to use (env: XAKU_MODEL; default: first installed)')
  .option('-u, --base-url <url>', 'Ollama base URL (env: XAKU_BASE_URL)')
  .option('-t, --temperature <temp>', 'Sampling temperature (0-2)')
  .option(
    '--auto-approve <mode>',
    'Auto-approve tools without prompting: none | read-only | all (env: XAKU_AUTO_APPROVE)',
  )
  .parse();

const [workspaceArg] = program.args;
const options = program.opts();

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const SHOW_CURSOR = '\x1b[?25h';

buildConfig(workspaceArg, options)
  .then((config) => {
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      process.stdout.write(LEAVE_ALT_SCREEN + SHOW_CURSOR);
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    process.on('uncaughtException', (err) => {
      cleanup();
      console.error(err);
      process.exit(1);
    });

    process.stdout.write(ENTER_ALT_SCREEN + CLEAR_SCREEN);
    void render(React.createElement(App, { config }));
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
