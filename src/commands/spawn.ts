import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  addProject,
  getProjectConfig,
  getProjectDir,
  resolveProjectPath,
  Variation,
} from '../lib/config.js';
import { createWorkspace, removeAllWorkspaces } from '../lib/workspace.js';
import { openTerminals, TerminalSession } from '../lib/terminal.js';
import {
  promptForVariationDirections,
  writeAIConfigFiles,
} from '../lib/prompt.js';
import {
  AgentCLI,
  detectAgentCLI,
  buildAgentCommand,
} from '../lib/agent.js';

export interface SpawnOptions {
  force?: boolean;
  noTerminal?: boolean;
  prompt?: boolean | string;
  run?: boolean | AgentCLI;
}

export async function spawn(
  count: number,
  options: SpawnOptions
): Promise<void> {
  const projectPath = resolveProjectPath();
  const projectName = path.basename(projectPath);

  const existingProject = await getProjectConfig(projectPath);
  if (existingProject && !options.force) {
    console.log(
      chalk.yellow(
        `\nProject already has ${existingProject.variations.length} active variations.`
      )
    );
    console.log('Run with --force to replace them, or run `okiro cleanup` first.\n');
    return;
  }

  if (existingProject) {
    const cleanupSpinner = ora('Cleaning up existing variations...').start();
    await removeAllWorkspaces(projectPath);
    cleanupSpinner.succeed('Cleaned up existing variations');
  }

  const variationsDir = getProjectDir(projectName);
  const variations: Variation[] = [];
  const sessions: TerminalSession[] = [];

  let directions: string[] = [];
  if (options.prompt) {
    const basePrompt = typeof options.prompt === 'string' ? options.prompt : undefined;
    directions = await promptForVariationDirections(count, basePrompt);
  }

  console.log(chalk.bold(`\nCreating ${count} variations for ${projectName}\n`));

  for (let i = 1; i <= count; i++) {
    const varId = `var-${i}`;
    const varPath = path.join(variationsDir, varId);

    const spinner = ora(`Creating ${varId}...`).start();

    try {
      await createWorkspace(projectPath, varPath);

      const direction = directions[i - 1] || '';
      const basePrompt = typeof options.prompt === 'string' ? options.prompt : undefined;
      if (direction || basePrompt) {
        await writeAIConfigFiles(varPath, varId, direction, basePrompt);
      }

      spinner.succeed(`Created ${varId} at ${chalk.dim(varPath)}`);

      variations.push({
        id: varId,
        path: varPath,
        createdAt: new Date().toISOString(),
      });

      sessions.push({
        id: varId,
        path: varPath,
      });
    } catch (error) {
      spinner.fail(`Failed to create ${varId}`);
      throw error;
    }
  }

  await addProject(projectPath, variations);

  console.log(chalk.green(`\n✓ Created ${count} variations\n`));

  if (!options.noTerminal) {
    let agentCommands: string[] | undefined;
    
    if (options.run) {
      const requestedCLI = typeof options.run === 'string' ? options.run : undefined;
      const detectedCLI = requestedCLI || await detectAgentCLI();
      
      if (detectedCLI) {
        const basePrompt = typeof options.prompt === 'string' ? options.prompt : '';
        agentCommands = sessions.map((_, i) => {
          const direction = directions[i] || '';
          const fullPrompt = direction 
            ? `${basePrompt}\n\nDirection: ${direction}`.trim()
            : basePrompt;
          return fullPrompt ? buildAgentCommand(detectedCLI, fullPrompt) : '';
        });
        console.log(chalk.cyan(`Running agents with ${detectedCLI}...\n`));
      } else {
        console.log(chalk.yellow('No AI CLI found (claude, opencode, or codex). Opening terminals only.\n'));
      }
    }
    
    await openTerminals(sessions, `okiro-${projectName}`, agentCommands);
  }
}
