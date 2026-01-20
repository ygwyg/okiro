#!/usr/bin/env node

import { createRequire } from 'node:module';
import { program } from 'commander';
import { spawn } from './commands/spawn.js';
import { status } from './commands/status.js';
import { cleanup } from './commands/cleanup.js';
import { diff } from './commands/diff.js';
import { promote } from './commands/promote.js';
import { compare } from './commands/compare.js';
import { judge } from './commands/judge.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const firstArg = process.argv[2];
if (firstArg && /^\d+$/.test(firstArg)) {
  process.argv.splice(2, 0, 'spawn');
} else if (!firstArg) {
  process.argv.push('--help');
}

program
  .name('okiro')
  .description('Ephemeral code variation previews for AI-assisted development')
  .version(pkg.version);

program
  .command('spawn <count>')
  .description('Create variation workspaces')
  .option('-f, --force', 'Replace existing variations')
  .option('--no-terminal', 'Do not open terminal sessions')
  .option('--prompt [task]', 'Prompt for direction per variation')
  .option('--run [cli]', 'Auto-run AI agent (claude, opencode, or codex)')
  .option('--model [model]', 'Model to use: global model name, or true for per-variation prompts')
  .action(async (count: string, options) => {
    await spawn(parseInt(count, 10), {
      force: options.force,
      noTerminal: !options.terminal,
      prompt: options.prompt,
      run: options.run === true ? true : options.run,
      model: options.model === true ? true : options.model,
    });
  });

program
  .command('status')
  .description('Show active variations')
  .action(async () => {
    await status();
  });

program
  .command('diff [var1] [var2]')
  .description('Show diff between variations')
  .action(async (var1?: string, var2?: string) => {
    await diff(var1, var2);
  });

program
  .command('promote <variation>')
  .description('Apply variation changes to original codebase')
  .option('-f, --force', 'Skip confirmation')
  .option('-c, --commit [message]', 'Git commit after promoting')
  .action(async (variation: string, options) => {
    await promote(variation, { 
      force: options.force,
      commit: options.commit,
    });
  });

program
  .command('compare')
  .description('Open diff viewer UI in browser')
  .option('-p, --port <port>', 'Port for diff viewer', '6789')
  .option('--no-browser', 'Do not open browser automatically')
  .action(async (options) => {
    await compare({
      port: parseInt(options.port, 10),
      noBrowser: !options.browser,
    });
  });

program
  .command('judge')
  .description('AI-powered evaluation and ranking of variations')
  .option('--model [model]', 'Model to use for judging')
  .option('--cli [cli]', 'CLI to use: claude, opencode, or codex')
  .action(async (options) => {
    await judge({
      model: options.model,
      cli: options.cli,
    });
  });

program
  .command('cleanup')
  .description('Remove all variation workspaces')
  .option('-f, --force', 'Skip confirmation')
  .action(async (options) => {
    await cleanup({ force: options.force });
  });

program.addHelpText('after', `
Examples:
  $ okiro 3                           Create 3 variations
  $ okiro 3 --prompt                  Create 3 with AI directions
  $ okiro 3 --prompt --run            Create 3 and auto-run AI agents
  $ okiro 3 --run=claude              Force use Claude Code
  $ okiro 3 --run --model opus        Run all with opus model
  $ okiro 3 --run --model             Prompt for model per variation
  $ okiro status                      Show variation status  
  $ okiro diff var-1                  Diff original vs var-1
  $ okiro compare                     Open diff viewer
  $ okiro judge                       Evaluate and rank variations
  $ okiro promote var-2               Apply var-2 to codebase
  $ okiro cleanup                     Remove all variations
`);

program.parse();
