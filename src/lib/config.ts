import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

export interface Variation {
  id: string;
  path: string;
  createdAt: string;
}

export interface ProjectConfig {
  originalPath: string;
  variationsDir: string;
  variations: Variation[];
  createdAt: string;
}

export interface OkiroConfig {
  version: string;
  projects: Record<string, ProjectConfig>;
}

const CONFIG_DIR = path.join(os.homedir(), '.okiro');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getOkiroDir(): string {
  return CONFIG_DIR;
}

export function getProjectDir(projectName: string): string {
  return path.join(CONFIG_DIR, 'projects', projectName);
}

async function ensureConfigDir(): Promise<void> {
  await fs.ensureDir(CONFIG_DIR);
}

export async function getConfig(): Promise<OkiroConfig> {
  await ensureConfigDir();

  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      version: '1.0.0',
      projects: {},
    };
  }
}

export async function saveConfig(config: OkiroConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function addProject(
  projectPath: string,
  variations: Variation[]
): Promise<ProjectConfig> {
  const config = await getConfig();
  const projectName = path.basename(projectPath);
  const variationsDir = getProjectDir(projectName);

  const projectConfig: ProjectConfig = {
    originalPath: projectPath,
    variationsDir,
    variations,
    createdAt: new Date().toISOString(),
  };

  config.projects[projectPath] = projectConfig;
  await saveConfig(config);

  return projectConfig;
}

export async function getProjectConfig(projectPath: string): Promise<ProjectConfig | null> {
  const config = await getConfig();
  return config.projects[projectPath] || null;
}

export async function removeProject(projectPath: string): Promise<void> {
  const config = await getConfig();
  delete config.projects[projectPath];
  await saveConfig(config);
}

export async function updateProjectVariations(
  projectPath: string,
  variations: Variation[]
): Promise<void> {
  const config = await getConfig();
  if (config.projects[projectPath]) {
    config.projects[projectPath].variations = variations;
    await saveConfig(config);
  }
}

export function resolveProjectPath(inputPath?: string): string {
  if (inputPath) {
    return path.resolve(inputPath);
  }
  return process.cwd();
}
