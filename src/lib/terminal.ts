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
  sessionName: string
): Promise<void> {
  if (isInsideVSCodeOrCursor()) {
    printManualInstructions(sessions);
    return;
  }

  const termProgram = getTerminalProgram();

  if (termProgram === 'iTerm.app') {
    await openWithIterm(sessions);
  } else if (await hasTmux()) {
    await openWithTmux(sessions, sessionName);
  } else if (termProgram === 'Apple_Terminal') {
    await openWithTerminalApp(sessions);
  } else if (process.platform === 'darwin') {
    await openWithTerminalApp(sessions);
  } else {
    printManualInstructions(sessions);
  }
}

async function openWithIterm(sessions: TerminalSession[]): Promise<void> {
  const script = `
    tell application "iTerm"
      activate
      tell current window
        ${sessions.map((session) => `
          set newTab to (create tab with default profile)
          tell current session of newTab
            write text "cd '${session.path}' && clear && echo '[ ${session.id} ]'"
          end tell
        `).join('\n')}
      end tell
    end tell
  `;

  await execa('osascript', ['-e', script]);

  console.log(chalk.green(`\n✓ Opened ${sessions.length} iTerm tabs`));
  console.log(chalk.dim('Cmd+Shift+] to switch tabs. Run okiro commands from any tab.\n'));
}

async function openWithTmux(
  sessions: TerminalSession[],
  sessionName: string
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

  for (const session of sessions) {
    await execa('tmux', [
      'send-keys',
      '-t', `${sessionName}:${session.id}`,
      `clear && echo "[ ${session.id} ]"`,
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

async function openWithTerminalApp(sessions: TerminalSession[]): Promise<void> {
  for (const session of sessions) {
    const script = `
      tell application "Terminal"
        do script "cd '${session.path}' && clear && echo '[ ${session.id} ]'"
        activate
      end tell
    `;

    await execa('osascript', ['-e', script]);
  }

  console.log(chalk.green(`\n✓ Opened ${sessions.length} Terminal windows`));
  console.log(chalk.dim('Run okiro commands from any window.\n'));
}

function printManualInstructions(sessions: TerminalSession[]): void {
  console.log(chalk.dim('\nOpen terminals manually:\n'));

  for (const session of sessions) {
    console.log(`  ${chalk.cyan(session.id)}: cd ${session.path}`);
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
