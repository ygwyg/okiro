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

export function buildAgentCommand(cli: AgentCLI, prompt: string): string {
  const escapedPrompt = wrapInSingleQuotes(prompt);
  
  switch (cli) {
    case 'claude':
      return `claude -p ${escapedPrompt} --dangerously-skip-permissions`;
    case 'opencode':
      return `opencode run ${escapedPrompt}`;
    case 'codex':
      return `codex exec ${escapedPrompt} --full-auto`;
  }
}
