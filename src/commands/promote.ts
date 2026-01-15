import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'node:readline';
import fs from 'fs-extra';
import { execa } from 'execa';
import { getProjectConfig, resolveProjectPath } from '../lib/config.js';
import { listChangedFiles } from '../lib/workspace.js';

export interface PromoteOptions {
  force?: boolean;
  commit?: boolean | string;
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

export async function promote(
  variationId: string,
  options: PromoteOptions
): Promise<void> {
  const projectPath = resolveProjectPath();
  const projectName = path.basename(projectPath);
  const project = await getProjectConfig(projectPath);

  if (!project) {
    console.log(chalk.yellow('\nNo active variations for this project.\n'));
    return;
  }

  const variation = project.variations.find((v) => v.id === variationId);
  if (!variation) {
    console.log(chalk.red(`\nVariation "${variationId}" not found.`));
    console.log('Available:', project.variations.map((v) => v.id).join(', '));
    return;
  }

  const changedFiles = await listChangedFiles(projectPath, variation.path);

  if (changedFiles.length === 0) {
    console.log(chalk.yellow('\nNo changes to promote.\n'));
    return;
  }

  console.log(chalk.bold(`\nPromoting ${variationId} to ${projectName}\n`));
  console.log('Changed files:');

  for (const file of changedFiles) {
    const icon = file.status === 'M' ? '~' : file.status === 'A' ? '+' : '-';
    const color =
      file.status === 'A'
        ? chalk.green
        : file.status === 'D'
          ? chalk.red
          : chalk.yellow;
    console.log(color(`  ${icon} ${file.path}`));
  }

  console.log('');

  if (!options.force) {
    const confirmed = await confirm('Apply these changes? [y/N] ');
    if (!confirmed) {
      console.log('Aborted.\n');
      return;
    }
  }

  const spinner = ora('Applying changes...').start();

  try {
    for (const file of changedFiles) {
      const srcPath = path.join(variation.path, file.path);
      const destPath = path.join(projectPath, file.path);

      if (file.status === 'D') {
        await fs.remove(destPath);
      } else {
        await fs.ensureDir(path.dirname(destPath));
        await fs.copy(srcPath, destPath);
      }
    }

    spinner.succeed(`Promoted ${changedFiles.length} files from ${variationId}`);

    if (options.commit) {
      const commitSpinner = ora('Committing changes...').start();
      try {
        await execa('git', ['add', ...changedFiles.map((f) => f.path)], {
          cwd: projectPath,
        });

        const defaultMessage = `feat: promote ${variationId} from okiro`;
        const commitMessage = typeof options.commit === 'string' 
          ? options.commit 
          : defaultMessage;

        await execa('git', ['commit', '-m', commitMessage], {
          cwd: projectPath,
        });

        commitSpinner.succeed(`Committed: "${commitMessage}"`);
      } catch (error) {
        commitSpinner.fail('Failed to commit (is this a git repository?)');
      }
    }
  } catch (error) {
    spinner.fail('Failed to promote changes');
    throw error;
  }

  console.log('');
}
