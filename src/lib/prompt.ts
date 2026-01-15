import readline from 'node:readline';
import fs from 'fs-extra';
import path from 'node:path';

export async function promptForInput(message: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptForVariationDirections(
  count: number,
  basePrompt?: string
): Promise<string[]> {
  const directions: string[] = [];

  console.log('');
  if (basePrompt) {
    console.log(`Base task: ${basePrompt}\n`);
  }
  console.log('Enter a direction/style for each variation (or press Enter to skip):\n');

  for (let i = 1; i <= count; i++) {
    const direction = await promptForInput(`  var-${i}: `);
    directions.push(direction);
  }

  return directions;
}

export async function writeAIConfigFiles(
  variationPath: string,
  variationId: string,
  direction: string,
  basePrompt?: string
): Promise<void> {
  if (!direction && !basePrompt) return;

  const configContent = buildAIConfigContent(variationId, direction, basePrompt);

  await fs.writeFile(
    path.join(variationPath, 'AGENTS.md'),
    configContent
  );

  const cursorDir = path.join(variationPath, '.cursor');
  await fs.ensureDir(cursorDir);
  await fs.writeFile(
    path.join(cursorDir, 'rules'),
    configContent
  );
}

function buildAIConfigContent(
  variationId: string,
  direction: string,
  basePrompt?: string
): string {
  const lines: string[] = [
    `# Okiro Variation: ${variationId}`,
    '',
    'You are working on an isolated variation of this project.',
    'Your changes will be compared against other variations.',
    '',
  ];

  if (basePrompt) {
    lines.push('## Task');
    lines.push('');
    lines.push(basePrompt);
    lines.push('');
  }

  if (direction) {
    lines.push('## Direction for this variation');
    lines.push('');
    lines.push(direction);
    lines.push('');
  }

  return lines.join('\n');
}
