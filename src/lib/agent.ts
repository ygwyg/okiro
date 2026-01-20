import { execa } from 'execa';

export type AgentCLI = 'claude' | 'opencode' | 'codex';

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execa('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

export async function detectAgentCLI(): Promise<AgentCLI | null> {
  if (await commandExists('claude')) return 'claude';
  if (await commandExists('opencode')) return 'opencode';
  if (await commandExists('codex')) return 'codex';
  return null;
}

export function wrapInSingleQuotes(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function buildAgentCommand(
  cli: AgentCLI,
  prompt: string,
  model?: string
): string {
  const escapedPrompt = wrapInSingleQuotes(prompt);
  
  switch (cli) {
    case 'claude':
      const claudeModel = model ? `--model ${model}` : '';
      return `claude -p ${escapedPrompt} ${claudeModel}`.trim();
    case 'opencode':
      const ocModel = model ? `-m ${model}` : '';
      return `opencode ${ocModel} --prompt ${escapedPrompt}`.trim();
    case 'codex':
      const codexModel = model ? `-m ${model}` : '';
      return `codex ${escapedPrompt} ${codexModel}`.trim();
  }
}

export async function showModelHelp(cli: AgentCLI): Promise<void> {
  switch (cli) {
    case 'claude':
      console.log('\nClaude Code supports shortnames: sonnet, opus, haiku');
      console.log('Or full model names like: claude-sonnet-4-5-20250929\n');
      break;
    case 'opencode':
      console.log('\nAvailable models:\n');
      await execa('opencode', ['models'], { stdio: 'inherit' });
      console.log('');
      break;
    case 'codex':
      console.log('\nCodex supports: o3, o4-mini, gpt-4o, etc.\n');
      break;
  }
}
