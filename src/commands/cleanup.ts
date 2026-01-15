import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'node:readline';
import {
  getProjectConfig,
  removeProject,
  resolveProjectPath,
} from '../lib/config.js';
import {
  removeAllWorkspaces,
  getWorkspaceSize,
  formatBytes,
} from '../lib/workspace.js';
import { killTmuxSession } from '../lib/terminal.js';

export interface CleanupOptions {
  force?: boolean;
}

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

export async function cleanup(options: CleanupOptions): Promise<void> {
  const projectPath = resolveProjectPath();
  const projectName = path.basename(projectPath);
  const project = await getProjectConfig(projectPath);

  if (!project) {
    console.log(chalk.yellow('\nNo active variations to clean up.\n'));
    return;
  }

  let totalSize = 0;
  for (const variation of project.variations) {
    totalSize += await getWorkspaceSize(variation.path);
  }

  console.log(
    `\nThis will remove ${project.variations.length} variations (${formatBytes(totalSize)})`
  );

  if (!options.force) {
    const confirmed = await confirm('Continue? [y/N] ');
    if (!confirmed) {
      console.log('Aborted.\n');
      return;
    }
  }

  const sessionName = `okiro-${projectName}`;
  const killedSession = await killTmuxSession(sessionName);
  if (killedSession) {
    console.log(chalk.dim(`Killed tmux session: ${sessionName}`));
  }

  const spinner = ora('Removing variations...').start();

  try {
    await removeAllWorkspaces(projectPath);
    await removeProject(projectPath);
    spinner.succeed(
      `Removed ${project.variations.length} variations (freed ${formatBytes(totalSize)})`
    );
  } catch (error) {
    spinner.fail('Failed to clean up variations');
    throw error;
  }

  console.log('');
}
