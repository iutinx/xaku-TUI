#!/usr/bin/env node
import { Command } from 'commander';
import { render, AlternateScreen } from '@claude-code-kit/ink-renderer';
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

const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const SHOW_CURSOR = '\x1b[?25h';

buildConfig(workspaceArg, options)
  .then((config) => {
    let cleaned = false;
    // Safety net only: <AlternateScreen> owns entering/exiting the alt screen and
    // enabling mouse tracking, so its own unmount (and the renderer's signal-exit
    // hook) normally does this. These handlers cover a hard exit before unmount.
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l' + LEAVE_ALT_SCREEN + SHOW_CURSOR);
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

    // Entering the alt screen here by hand used to be how xaku took over the
    // terminal, but the renderer only enables SGR mouse tracking (and therefore
    // only delivers onClick) when it knows it is in the alt screen, which it
    // learns solely from <AlternateScreen>. Mouse-driven affordances like
    // click-to-copy the workspace path were dead until this was switched over.
    void render(
      React.createElement(AlternateScreen, null, React.createElement(App, { config })),
    );
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
