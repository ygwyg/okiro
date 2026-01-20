import chalk from 'chalk';
import ora from 'ora';
import { getProjectConfig, resolveProjectPath } from '../lib/config.js';
import { listChangedFiles } from '../lib/workspace.js';
import { generateFileDiff } from '../lib/diff.js';
import { detectAgentCLI, AgentCLI } from '../lib/agent.js';
import { runMultiAgentJudge, VariationDiffs, JudgeProgress } from '../lib/judge.js';

export interface JudgeOptions {
  model?: string;
  cli?: AgentCLI;
}

export async function judge(options: JudgeOptions): Promise<void> {
  const projectPath = resolveProjectPath();
  const project = await getProjectConfig(projectPath);

  if (!project) {
    console.log(chalk.yellow('\nNo active variations for this project.'));
    console.log('Run `okiro 3` to create variations.\n');
    return;
  }

  if (project.variations.length < 2) {
    console.log(chalk.yellow('\nNeed at least 2 variations to judge.'));
    console.log(`Currently have ${project.variations.length} variation(s).\n`);
    return;
  }

  const cli = options.cli || await detectAgentCLI();
  if (!cli) {
    console.log(chalk.red('\nNo AI CLI found (claude, opencode, or codex).'));
    console.log('Install one to use the judge feature.\n');
    return;
  }

  console.log(chalk.dim(`\nUsing ${cli} for multi-agent judgment...\n`));

  const spinner = ora('Gathering diffs from all variations...').start();

  const variationDiffs: VariationDiffs[] = await Promise.all(
    project.variations.map(async (variation) => {
      const changedFiles = await listChangedFiles(projectPath, variation.path);
      const diffs = await Promise.all(
        changedFiles.map(async (file) => {
          const diff = await generateFileDiff(projectPath, variation.path, file.path);
          return {
            filePath: diff.filePath,
            status: diff.status as 'M' | 'A' | 'D',
            patch: diff.patch,
            original: diff.original,
            modified: diff.modified,
          };
        })
      );
      return {
        variationId: variation.id,
        diffs,
      };
    })
  );

  const totalFiles = new Set(variationDiffs.flatMap((v) => v.diffs.map((d) => d.filePath))).size;
  spinner.succeed(`Found ${totalFiles} unique files across ${project.variations.length} variations\n`);

  const progressSpinner = ora('Starting analysis...').start();

  const handleProgress = (progress: JudgeProgress) => {
    if (progress.phase === 'analyzing') {
      progressSpinner.text = `Analyzing files... ${progress.completedFiles}/${progress.totalFiles} ${progress.currentFile ? chalk.dim(`(${progress.currentFile})`) : ''}`;
    } else if (progress.phase === 'synthesizing') {
      progressSpinner.text = 'Synthesizing final judgment...';
    } else if (progress.phase === 'complete') {
      progressSpinner.succeed('Analysis complete!\n');
    } else if (progress.phase === 'error') {
      progressSpinner.fail(`Error: ${progress.error}`);
    }
  };

  try {
    const result = await runMultiAgentJudge(cli, variationDiffs, handleProgress);

    console.log(chalk.bold.green(`\n  Winner: ${result.winner}\n`));
    console.log(chalk.dim('  ' + result.summary + '\n'));

    console.log(chalk.bold('  Rankings:\n'));
    for (const ranking of result.rankings) {
      const medal = ranking.rank === 1 ? '  ' : ranking.rank === 2 ? '  ' : ranking.rank === 3 ? '  ' : '   ';
      const color = ranking.rank === 1 ? chalk.green : ranking.rank === 2 ? chalk.yellow : chalk.dim;
      
      console.log(color(`${medal}#${ranking.rank} ${ranking.variation}`));
      console.log(chalk.dim(`      Avg: ${ranking.avgScore.toFixed(1)}/10 | File wins: ${ranking.fileWins}/${result.fileAnalyses.length}`));
      
      if (ranking.strengths.length > 0) {
        ranking.strengths.forEach((s) => console.log(chalk.green(`      + ${s}`)));
      }
      if (ranking.weaknesses.length > 0) {
        ranking.weaknesses.forEach((w) => console.log(chalk.red(`      - ${w}`)));
      }
      console.log();
    }

    console.log(chalk.dim('  Per-file breakdown:\n'));
    for (const analysis of result.fileAnalyses) {
      console.log(chalk.dim(`    ${analysis.filePath}`));
      console.log(chalk.dim(`      Winner: ${analysis.winner} | ${analysis.synopsis}`));
    }

    console.log(chalk.bold(`\n  To promote the winner: okiro promote ${result.winner}\n`));
  } catch (error: any) {
    progressSpinner.fail('Judgment failed');
    console.error(chalk.red(`\nError: ${error.message}\n`));
    throw error;
  }
}
