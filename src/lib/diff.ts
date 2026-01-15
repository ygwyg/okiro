import { createTwoFilesPatch } from 'diff';
import fs from 'fs-extra';
import path from 'node:path';
import { ChangedFile } from './workspace.js';

export interface FileDiff {
  filePath: string;
  status: 'M' | 'A' | 'D';
  original: string;
  modified: string;
  patch: string;
}

export async function generateFileDiff(
  originalPath: string,
  variationPath: string,
  relativeFilePath: string
): Promise<FileDiff> {
  const origFile = path.join(originalPath, relativeFilePath);
  const varFile = path.join(variationPath, relativeFilePath);

  const [origContent, varContent] = await Promise.all([
    fs.readFile(origFile, 'utf-8').catch(() => ''),
    fs.readFile(varFile, 'utf-8').catch(() => ''),
  ]);

  let status: 'M' | 'A' | 'D';
  if (!origContent && varContent) {
    status = 'A';
  } else if (origContent && !varContent) {
    status = 'D';
  } else {
    status = 'M';
  }

  const patch = createTwoFilesPatch(
    `a/${relativeFilePath}`,
    `b/${relativeFilePath}`,
    origContent,
    varContent,
    '',
    ''
  );

  return {
    filePath: relativeFilePath,
    status,
    original: origContent,
    modified: varContent,
    patch,
  };
}

export async function generateAllDiffs(
  originalPath: string,
  variationPath: string,
  changedFiles: ChangedFile[]
): Promise<FileDiff[]> {
  const diffs = await Promise.all(
    changedFiles.map((file) =>
      generateFileDiff(originalPath, variationPath, file.path)
    )
  );

  return diffs;
}

export function colorizeUnifiedDiff(patch: string): string {
  const lines = patch.split('\n');
  const coloredLines = lines.map((line) => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return `\x1b[1m${line}\x1b[0m`;
    }
    if (line.startsWith('+')) {
      return `\x1b[32m${line}\x1b[0m`;
    }
    if (line.startsWith('-')) {
      return `\x1b[31m${line}\x1b[0m`;
    }
    if (line.startsWith('@@')) {
      return `\x1b[36m${line}\x1b[0m`;
    }
    return line;
  });

  return coloredLines.join('\n');
}
