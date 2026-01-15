import path from 'node:path';
import chalk from 'chalk';
import { getProjectConfig, resolveProjectPath } from '../lib/config.js';
import {
  listChangedFiles,
  getWorkspaceSize,
  formatBytes,
} from '../lib/workspace.js';

export async function status(): Promise<void> {
  const projectPath = resolveProjectPath();
  const projectName = path.basename(projectPath);
  const project = await getProjectConfig(projectPath);

  if (!project) {
    console.log(chalk.yellow('\nNo active variations for this project.'));
    console.log('Run `okiro 3` to create variations.\n');
    return;
  }

  console.log(chalk.bold(`\nVariations for ${projectName}:\n`));

  for (const variation of project.variations) {
    const changedFiles = await listChangedFiles(projectPath, variation.path);
    const diskUsage = await getWorkspaceSize(variation.path);

    console.log(`  ${chalk.cyan(variation.id)}`);
    console.log(`    Path: ${chalk.dim(variation.path)}`);
    console.log(`    Changed: ${changedFiles.length} files`);
    console.log(`    Size: ${formatBytes(diskUsage)}`);
    console.log('');
  }
}
