import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'node:path';
import { getPlatformInfo } from './platform.js';
import { getProjectDir } from './config.js';

export interface CloneOptions {
  excludeNodeModules?: boolean;
  excludeGitDir?: boolean;
}

export async function createWorkspace(
  sourcePath: string,
  destPath: string,
  options: CloneOptions = {}
): Promise<void> {
  const platformInfo = await getPlatformInfo();

  await fs.ensureDir(path.dirname(destPath));

  if (platformInfo.supportsApfsClone) {
    await createApfsClone(sourcePath, destPath);
  } else if (platformInfo.supportsBtrfsReflink) {
    await createReflinkCopy(sourcePath, destPath);
  } else {
    await createRsyncCopy(sourcePath, destPath, options);
  }
}

async function createApfsClone(source: string, dest: string): Promise<void> {
  await execa('cp', ['-c', '-R', source, dest]);
}

async function createReflinkCopy(source: string, dest: string): Promise<void> {
  await execa('cp', ['-r', '--reflink=auto', source, dest]);
}

async function createRsyncCopy(
  source: string,
  dest: string,
  options: CloneOptions
): Promise<void> {
  const excludes: string[] = [];

  if (options.excludeGitDir) {
    excludes.push('--exclude=.git');
  }

  await execa('rsync', [
    '-a',
    '--delete',
    ...excludes,
    source + '/',
    dest + '/',
  ]);
}

export async function removeWorkspace(workspacePath: string): Promise<void> {
  await fs.remove(workspacePath);
}

export async function removeAllWorkspaces(projectPath: string): Promise<void> {
  const projectName = path.basename(projectPath);
  const projectDir = getProjectDir(projectName);

  if (await fs.pathExists(projectDir)) {
    await fs.remove(projectDir);
  }
}

export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D';
}

export async function listChangedFiles(
  originalPath: string,
  variationPath: string
): Promise<ChangedFile[]> {
  const changedFiles: ChangedFile[] = [];

  async function compareDir(relPath: string): Promise<void> {
    const origDir = path.join(originalPath, relPath);
    const varDir = path.join(variationPath, relPath);

    const [origExists, varExists] = await Promise.all([
      fs.pathExists(origDir),
      fs.pathExists(varDir),
    ]);

    if (!origExists && !varExists) return;

    const origFiles = origExists ? await fs.readdir(origDir) : [];
    const varFiles = varExists ? await fs.readdir(varDir) : [];

    const allFiles = new Set([...origFiles, ...varFiles]);

    for (const file of allFiles) {
      if (shouldSkipFile(file)) continue;

      const relFilePath = path.join(relPath, file);
      const origFilePath = path.join(originalPath, relFilePath);
      const varFilePath = path.join(variationPath, relFilePath);

      const [origStat, varStat] = await Promise.all([
        fs.stat(origFilePath).catch(() => null),
        fs.stat(varFilePath).catch(() => null),
      ]);

      if (origStat?.isDirectory() || varStat?.isDirectory()) {
        await compareDir(relFilePath);
        continue;
      }

      if (!origStat && varStat) {
        changedFiles.push({ path: relFilePath, status: 'A' });
      } else if (origStat && !varStat) {
        changedFiles.push({ path: relFilePath, status: 'D' });
      } else if (origStat && varStat) {
        const [origContent, varContent] = await Promise.all([
          fs.readFile(origFilePath),
          fs.readFile(varFilePath),
        ]);

        if (!origContent.equals(varContent)) {
          changedFiles.push({ path: relFilePath, status: 'M' });
        }
      }
    }
  }

  await compareDir('');

  return changedFiles.sort((a, b) => a.path.localeCompare(b.path));
}

function shouldSkipFile(filename: string): boolean {
  const skipPatterns = [
    'node_modules',
    '.git',
    '.DS_Store',
    'dist',
    'build',
    '.next',
    '.nuxt',
    '.cache',
    'coverage',
    'AGENTS.md',
    '.cursor',
  ];
  return skipPatterns.includes(filename);
}

export async function getWorkspaceSize(workspacePath: string): Promise<number> {
  try {
    const { stdout } = await execa('du', ['-sk', workspacePath]);
    const sizeKb = parseInt(stdout.split('\t')[0], 10);
    return sizeKb * 1024;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}
