import { execa } from 'execa';
import { writeFile, mkdir, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';

export interface TerminalSession {
  id: string;
  path: string;
}

async function hasTmux(): Promise<boolean> {
  try {
    await execa('which', ['tmux']);
    return true;
  } catch {
    return false;
  }
}

function isInsideVSCodeOrCursor(): boolean {
  const termProgram = process.env.TERM_PROGRAM || null;
  return termProgram === 'vscode' || termProgram === 'cursor';
}

export async function openTerminals(
  sessions: TerminalSession[],
  sessionName: string,
  agentCommands?: string[]
): Promise<void> {
  if (isInsideVSCodeOrCursor()) {
    printManualInstructions(sessions, agentCommands);
    return;
  }

  if (await hasTmux()) {
    await openWithTmux(sessions, sessionName, agentCommands);
    return;
  }

  const termProgram = process.env.TERM_PROGRAM;

  if (termProgram === 'iTerm.app') {
    await openWithIterm(sessions, agentCommands);
    return;
  }

  if (process.platform === 'darwin') {
    await openWithCommandFiles(sessions, sessionName, agentCommands);
    return;
  }

  printManualInstructions(sessions, agentCommands);
}

async function openWithIterm(sessions: TerminalSession[], agentCommands?: string[]): Promise<void> {
  const scriptDir = join(tmpdir(), `okiro-iterm-${Date.now()}`);
  await mkdir(scriptDir, { recursive: true });

  const scriptPaths: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const agentCmd = agentCommands?.[i];
    const scriptPath = join(scriptDir, `${session.id}.sh`);

    const scriptContent = agentCmd
      ? `#!/bin/bash
cd '${session.path}'
clear
echo '[ ${session.id} ]'
echo ''
${agentCmd}
echo ''
echo '✓ ${session.id} completed'
exec $SHELL`
      : `#!/bin/bash
cd '${session.path}'
clear
echo '[ ${session.id} ]'
exec $SHELL`;

    await writeFile(scriptPath, scriptContent);
    await chmod(scriptPath, 0o755);
    scriptPaths.push(scriptPath);
  }

  const script = `
    tell application "iTerm"
      activate
      tell current window
        ${scriptPaths.map((scriptPath) => `
          set newTab to (create tab with default profile)
          tell current session of newTab
            write text "${scriptPath}"
          end tell
        `).join('\n')}
      end tell
    end tell
  `;

  await execa('osascript', ['-e', script]);

  console.log(chalk.green(`\n✓ Opened ${sessions.length} iTerm tabs`));
  console.log(chalk.dim('Cmd+Shift+] to switch tabs.\n'));
}

async function openWithCommandFiles(
  sessions: TerminalSession[],
  sessionName: string,
  agentCommands?: string[]
): Promise<void> {
  const scriptDir = join(tmpdir(), `okiro-${sessionName}`);
  await mkdir(scriptDir, { recursive: true });

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const agentCmd = agentCommands?.[i];
    const scriptPath = join(scriptDir, `${session.id}.command`);

    const scriptContent = agentCmd
      ? `#!/bin/bash
cd '${session.path}'
clear
echo '[ ${session.id} ]'
echo ''
${agentCmd}
echo ''
echo '✓ ${session.id} completed'
exec $SHELL`
      : `#!/bin/bash
cd '${session.path}'
clear
echo '[ ${session.id} ]'
exec $SHELL`;

    await writeFile(scriptPath, scriptContent);
    await chmod(scriptPath, 0o755);
    await execa('open', [scriptPath]);
  }

  console.log(chalk.green(`\n✓ Opened ${sessions.length} terminal windows`));
  console.log(chalk.dim('Run okiro commands from any window.\n'));
}

async function openWithTmux(
  sessions: TerminalSession[],
  sessionName: string,
  agentCommands?: string[]
): Promise<void> {
  const existingSession = await checkTmuxSessionExists(sessionName);
  if (existingSession) {
    await execa('tmux', ['kill-session', '-t', sessionName]);
  }

  const firstSession = sessions[0];
  await execa('tmux', [
    'new-session',
    '-d',
    '-s', sessionName,
    '-c', firstSession.path,
    '-n', firstSession.id,
  ]);

  for (let i = 1; i < sessions.length; i++) {
    const session = sessions[i];
    await execa('tmux', [
      'new-window',
      '-t', sessionName,
      '-c', session.path,
      '-n', session.id,
    ]);
  }

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const agentCmd = agentCommands?.[i];
    const fullCmd = agentCmd
      ? `clear && echo "[ ${session.id} ]" && ${agentCmd}`
      : `clear && echo "[ ${session.id} ]"`;
    
    await execa('tmux', [
      'send-keys',
      '-t', `${sessionName}:${session.id}`,
      fullCmd,
      'Enter',
    ]);
  }

  await execa('tmux', ['select-window', '-t', `${sessionName}:${sessions[0].id}`]);

  console.log(chalk.green(`\n✓ Opening tmux session: ${sessionName}`));
  console.log(chalk.dim('Ctrl+B then N/P to switch windows. Run okiro commands from any window.\n'));

  await execa('tmux', ['attach-session', '-t', sessionName], {
    stdio: 'inherit',
  });
}

async function checkTmuxSessionExists(sessionName: string): Promise<boolean> {
  try {
    await execa('tmux', ['has-session', '-t', sessionName]);
    return true;
  } catch {
    return false;
  }
}

function printManualInstructions(sessions: TerminalSession[], agentCommands?: string[]): void {
  console.log(chalk.dim('\nOpen terminals manually:\n'));

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const agentCmd = agentCommands?.[i];
    if (agentCmd) {
      console.log(`  ${chalk.cyan(session.id)}: cd ${session.path} && ${agentCmd}`);
    } else {
      console.log(`  ${chalk.cyan(session.id)}: cd ${session.path}`);
    }
  }
  
  console.log(chalk.dim('\nRun okiro commands from any terminal.\n'));
}

export async function killTmuxSession(sessionName: string): Promise<boolean> {
  try {
    await execa('tmux', ['kill-session', '-t', sessionName]);
    return true;
  } catch {
    return false;
  }
}


