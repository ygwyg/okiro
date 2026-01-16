import { execa } from 'execa';
import chalk from 'chalk';

export interface TerminalSession {
  id: string;
  path: string;
}

function getTerminalProgram(): string | null {
  return process.env.TERM_PROGRAM || null;
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
  const termProgram = getTerminalProgram();
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

  const termProgram = getTerminalProgram();

  if (termProgram === 'iTerm.app') {
    await openWithIterm(sessions, agentCommands);
  } else if (await hasTmux()) {
    await openWithTmux(sessions, sessionName, agentCommands);
  } else if (termProgram === 'Apple_Terminal') {
    await openWithTerminalApp(sessions, agentCommands);
  } else if (process.platform === 'darwin') {
    await openWithTerminalApp(sessions, agentCommands);
  } else {
    printManualInstructions(sessions, agentCommands);
  }
}

async function openWithIterm(sessions: TerminalSession[], agentCommands?: string[]): Promise<void> {
  const script = `
    tell application "iTerm"
      activate
      tell current window
        ${sessions.map((session, i) => {
          const agentCmd = agentCommands?.[i];
          const fullCmd = agentCmd 
            ? `cd '${session.path}' && clear && echo '[ ${session.id} ]' && ${agentCmd}`
            : `cd '${session.path}' && clear && echo '[ ${session.id} ]'`;
          return `
          set newTab to (create tab with default profile)
          tell current session of newTab
            write text "${fullCmd.replace(/"/g, '\\"')}"
          end tell
        `;
        }).join('\n')}
      end tell
    end tell
  `;

  await execa('osascript', ['-e', script]);

  console.log(chalk.green(`\n✓ Opened ${sessions.length} iTerm tabs`));
  console.log(chalk.dim('Cmd+Shift+] to switch tabs. Run okiro commands from any tab.\n'));
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

async function openWithTerminalApp(sessions: TerminalSession[], agentCommands?: string[]): Promise<void> {
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const agentCmd = agentCommands?.[i];
    const fullCmd = agentCmd
      ? `cd '${session.path}' && clear && echo '[ ${session.id} ]' && ${agentCmd}`
      : `cd '${session.path}' && clear && echo '[ ${session.id} ]'`;
    
    const script = `
      tell application "Terminal"
        do script "${fullCmd.replace(/"/g, '\\"')}"
        activate
      end tell
    `;

    await execa('osascript', ['-e', script]);
  }

  console.log(chalk.green(`\n✓ Opened ${sessions.length} Terminal windows`));
  console.log(chalk.dim('Run okiro commands from any window.\n'));
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
