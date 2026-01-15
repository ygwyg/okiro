import chalk from 'chalk';
import { getProjectConfig, resolveProjectPath } from '../lib/config.js';
import { listChangedFiles } from '../lib/workspace.js';
import { generateFileDiff, colorizeUnifiedDiff } from '../lib/diff.js';

export async function diff(var1?: string, var2?: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const project = await getProjectConfig(projectPath);

  if (!project) {
    console.log(chalk.yellow('\nNo active variations for this project.'));
    console.log('Run `okiro spawn <count>` to create variations.\n');
    return;
  }

  let sourcePath: string;
  let targetPath: string;
  let sourceLabel: string;
  let targetLabel: string;

  if (!var1 && !var2) {
    sourcePath = projectPath;
    sourceLabel = 'original';
    targetPath = project.variations[0].path;
    targetLabel = project.variations[0].id;
  } else if (var1 && !var2) {
    sourcePath = projectPath;
    sourceLabel = 'original';
    const variation = project.variations.find((v) => v.id === var1);
    if (!variation) {
      console.log(chalk.red(`\nVariation "${var1}" not found.`));
      console.log('Available:', project.variations.map((v) => v.id).join(', '));
      return;
    }
    targetPath = variation.path;
    targetLabel = variation.id;
  } else {
    if (var1 === 'original') {
      sourcePath = projectPath;
      sourceLabel = 'original';
    } else {
      const sourceVar = project.variations.find((v) => v.id === var1);
      if (!sourceVar) {
        console.log(chalk.red(`\nVariation "${var1}" not found.`));
        return;
      }
      sourcePath = sourceVar.path;
      sourceLabel = sourceVar.id;
    }

    if (var2 === 'original') {
      targetPath = projectPath;
      targetLabel = 'original';
    } else {
      const targetVar = project.variations.find((v) => v.id === var2);
      if (!targetVar) {
        console.log(chalk.red(`\nVariation "${var2}" not found.`));
        return;
      }
      targetPath = targetVar.path;
      targetLabel = targetVar.id;
    }
  }

  console.log(chalk.bold(`\nComparing ${sourceLabel} → ${targetLabel}\n`));

  const changedFiles = await listChangedFiles(sourcePath, targetPath);

  if (changedFiles.length === 0) {
    console.log(chalk.dim('No changes detected.\n'));
    return;
  }

  console.log(chalk.dim(`${changedFiles.length} file(s) changed:\n`));

  for (const file of changedFiles) {
    const fileDiff = await generateFileDiff(sourcePath, targetPath, file.path);
    console.log(colorizeUnifiedDiff(fileDiff.patch));
    console.log('');
  }
}
