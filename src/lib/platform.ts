import { execa } from 'execa';
import os from 'node:os';

export type Platform = 'macos' | 'linux' | 'windows';

export interface PlatformInfo {
  platform: Platform;
  supportsApfsClone: boolean;
  supportsBtrfsReflink: boolean;
  hasTmux: boolean;
  hasIterm2: boolean;
  shell: string;
}

let cachedPlatformInfo: PlatformInfo | null = null;

export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (cachedPlatformInfo) {
    return cachedPlatformInfo;
  }

  const nodePlatform = os.platform();
  let platform: Platform;

  if (nodePlatform === 'darwin') {
    platform = 'macos';
  } else if (nodePlatform === 'linux') {
    platform = 'linux';
  } else if (nodePlatform === 'win32') {
    platform = 'windows';
  } else {
    platform = 'linux';
  }

  const [supportsApfsClone, supportsBtrfsReflink, hasTmux, hasIterm2] = await Promise.all([
    checkApfsCloneSupport(),
    checkBtrfsReflinkSupport(),
    checkTmuxAvailable(),
    checkIterm2Available(),
  ]);

  cachedPlatformInfo = {
    platform,
    supportsApfsClone,
    supportsBtrfsReflink,
    hasTmux,
    hasIterm2,
    shell: process.env.SHELL || '/bin/bash',
  };

  return cachedPlatformInfo;
}

async function checkApfsCloneSupport(): Promise<boolean> {
  if (os.platform() !== 'darwin') {
    return false;
  }

  try {
    const { stdout } = await execa('sw_vers', ['-productVersion']);
    const [major, minor] = stdout.trim().split('.').map(Number);
    return major > 10 || (major === 10 && minor >= 13);
  } catch {
    return false;
  }
}

async function checkBtrfsReflinkSupport(): Promise<boolean> {
  if (os.platform() !== 'linux') {
    return false;
  }

  try {
    await execa('cp', ['--help']);
    return true;
  } catch {
    return false;
  }
}

async function checkTmuxAvailable(): Promise<boolean> {
  try {
    await execa('which', ['tmux']);
    return true;
  } catch {
    return false;
  }
}

async function checkIterm2Available(): Promise<boolean> {
  if (os.platform() !== 'darwin') {
    return false;
  }

  try {
    await execa('test', ['-d', '/Applications/iTerm.app']);
    return true;
  } catch {
    return false;
  }
}

export function isMacOS(): boolean {
  return os.platform() === 'darwin';
}

export function isLinux(): boolean {
  return os.platform() === 'linux';
}

export function isWindows(): boolean {
  return os.platform() === 'win32';
}
