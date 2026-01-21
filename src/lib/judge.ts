import { execa } from 'execa';
import { AgentCLI } from './agent.js';

export interface FileDiff {
  filePath: string;
  status: 'M' | 'A' | 'D';
  patch: string;
  original: string;
  modified: string;
}

export interface VariationDiffs {
  variationId: string;
  diffs: FileDiff[];
}

export interface FileAnalysis {
  filePath: string;
  synopsis: string;
  scores: Record<string, number>;
  winner: string;
}

export interface JudgeRanking {
  variation: string;
  rank: number;
  strengths: string[];
  weaknesses: string[];
  fileWins: number;
  avgScore: number;
}

export interface JudgeResult {
  winner: string;
  rankings: JudgeRanking[];
  summary: string;
  fileAnalyses: FileAnalysis[];
}

export interface JudgeProgress {
  phase: 'analyzing' | 'synthesizing' | 'complete' | 'error';
  currentFile?: string;
  completedFiles: number;
  totalFiles: number;
  fileAnalyses: FileAnalysis[];
  result?: JudgeResult;
  error?: string;
}

interface ModelConfig {
  fast: string;
  synthesis: string;
}

const MODEL_CONFIGS: Record<AgentCLI, ModelConfig> = {
  claude: {
    fast: 'claude-3-5-haiku-latest',
    synthesis: 'claude-sonnet-4-20250514',
  },
  opencode: {
    fast: 'anthropic/claude-3-5-haiku-latest',
    synthesis: 'anthropic/claude-sonnet-4-20250514',
  },
  codex: {
    fast: 'claude-3-5-haiku-latest',
    synthesis: 'claude-sonnet-4-20250514',
  },
};

function buildFileAnalysisPrompt(
  filePath: string,
  variationDiffs: Array<{ variationId: string; diff: FileDiff | null }>
): string {
  const diffSections = variationDiffs
    .map(({ variationId, diff }) => {
      if (!diff) {
        return `### ${variationId}\nNo changes to this file.`;
      }
      return `### ${variationId}\nStatus: ${diff.status === 'A' ? 'Added' : diff.status === 'D' ? 'Deleted' : 'Modified'}\n\n\`\`\`diff\n${diff.patch}\n\`\`\``;
    })
    .join('\n\n');

  return `Examine the offerings. Judge them.

File: ${filePath}

${diffSections}

RESPOND WITH ONLY THIS JSON FORMAT:
{
  "synopsis": "Which is worthy and why (2-3 sentences)",
  "scores": { "var-1": 8, "var-2": 6 },
  "winner": "var-1"
}

Score 1-10. One must prevail. Silence (no changes) = 5.`;
}

function buildBatchAnalysisPrompt(
  files: Array<{
    filePath: string;
    variationDiffs: Array<{ variationId: string; diff: FileDiff | null }>;
  }>
): string {
  const fileSections = files
    .map(({ filePath, variationDiffs }) => {
      const diffParts = variationDiffs
        .map(({ variationId, diff }) => {
          if (!diff) return `  ${variationId}: (no changes)`;
          const status = diff.status === 'A' ? 'Added' : diff.status === 'D' ? 'Deleted' : 'Modified';
          const patch = diff.patch.length > 1500 ? diff.patch.slice(0, 1500) + '\n... (truncated)' : diff.patch;
          return `  ${variationId} [${status}]:\n\`\`\`diff\n${patch}\n\`\`\``;
        })
        .join('\n');
      return `## ${filePath}\n${diffParts}`;
    })
    .join('\n\n---\n\n');

  const fileList = files.map((f) => f.filePath).join(', ');

  return `Examine the offerings. Judge them.

Files: ${fileList}

${fileSections}

RESPOND WITH ONLY THIS JSON ARRAY:
[
  {
    "filePath": "path/to/file.ts",
    "synopsis": "Which is worthy and why (2-3 sentences)",
    "scores": { "var-1": 8, "var-2": 6 },
    "winner": "var-1"
  }
]

Score 1-10. One must prevail per file. Silence (no changes) = 5.`;
}

function buildSynthesisPrompt(
  fileAnalyses: FileAnalysis[],
  variations: string[]
): string {
  const stats: Record<string, { totalScore: number; fileWins: number; fileCount: number }> = {};
  for (const v of variations) {
    stats[v] = { totalScore: 0, fileWins: 0, fileCount: 0 };
  }

  for (const analysis of fileAnalyses) {
    for (const [varId, score] of Object.entries(analysis.scores)) {
      if (stats[varId]) {
        stats[varId].totalScore += score;
        stats[varId].fileCount++;
      }
    }
    if (stats[analysis.winner]) {
      stats[analysis.winner].fileWins++;
    }
  }

  const statsSummary = variations
    .map((v) => {
      const s = stats[v];
      const avg = s.fileCount > 0 ? (s.totalScore / s.fileCount).toFixed(1) : '0';
      return `- ${v}: avg score ${avg}/10, won ${s.fileWins}/${fileAnalyses.length} files`;
    })
    .join('\n');

  const analysisSummary = fileAnalyses
    .map((a) => `- ${a.filePath}: Winner=${a.winner} | ${a.synopsis}`)
    .join('\n');

  return `The offerings have been weighed. Now pass judgment.

${variations.length} variations sought to prove their worth. Each file was judged.

## The Scores
${statsSummary}

## File by File
${analysisSummary}

One shall be chosen. The rest found wanting.

RESPOND WITH ONLY THIS JSON FORMAT:
{
  "winner": "var-N",
  "rankings": [
    {
      "variation": "var-N",
      "rank": 1,
      "strengths": ["what made it worthy"],
      "weaknesses": ["where it faltered"]
    }
  ],
  "summary": "Why this one rises above (2-3 sentences)"
}`;
}

async function runAgentCommand(
  cli: AgentCLI,
  prompt: string,
  model: string
): Promise<string> {
  let args: string[];

  switch (cli) {
    case 'claude':
      args = ['-p', '-', '--print', '--model', model];
      break;
    case 'opencode':
      args = ['run', '-m', model];
      break;
    case 'codex':
      args = ['exec', '-', '-m', model];
      break;
  }

  try {
    const { stdout } = await execa(cli, args, { 
      timeout: 180_000,
      input: prompt,
    });
    return stdout;
  } catch (error: any) {
    if (error.message?.includes('model') || error.exitCode === 1) {
      const fallbackArgs = args.filter((a, i) => {
        if (a === '--model' || a === '-m') return false;
        if (i > 0 && (args[i - 1] === '--model' || args[i - 1] === '-m')) return false;
        return true;
      });
      
      const { stdout } = await execa(cli, fallbackArgs, { 
        timeout: 180_000,
        input: prompt,
      });
      return stdout;
    }
    throw error;
  }
}

function parseJsonResponse<T>(response: string): T {
  const jsonMatch = response.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }
  return JSON.parse(jsonMatch[0]);
}

const BATCH_SIZE = 5;

export async function runMultiAgentJudge(
  cli: AgentCLI,
  variationDiffs: VariationDiffs[],
  onProgress?: (progress: JudgeProgress) => void
): Promise<JudgeResult> {
  const models = MODEL_CONFIGS[cli];
  const variations = variationDiffs.map((v) => v.variationId);

  const fileMap = new Map<
    string,
    Array<{ variationId: string; diff: FileDiff | null }>
  >();

  for (const { variationId, diffs } of variationDiffs) {
    for (const diff of diffs) {
      if (!fileMap.has(diff.filePath)) {
        fileMap.set(diff.filePath, []);
      }
      fileMap.get(diff.filePath)!.push({ variationId, diff });
    }
  }

  for (const [, entries] of fileMap) {
    const presentVariations = new Set(entries.map((e) => e.variationId));
    for (const varId of variations) {
      if (!presentVariations.has(varId)) {
        entries.push({ variationId: varId, diff: null });
      }
    }
    entries.sort((a, b) => a.variationId.localeCompare(b.variationId));
  }

  const allFiles = Array.from(fileMap.keys()).sort();
  const totalFiles = allFiles.length;
  const fileAnalyses: FileAnalysis[] = [];

  const emitProgress = (
    phase: JudgeProgress['phase'],
    currentFile?: string,
    error?: string
  ) => {
    onProgress?.({
      phase,
      currentFile,
      completedFiles: fileAnalyses.length,
      totalFiles,
      fileAnalyses: [...fileAnalyses],
      error,
    });
  };

  const batches: string[][] = [];
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    batches.push(allFiles.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    emitProgress('analyzing', batch[0]);

    const batchData = batch.map((filePath) => ({
      filePath,
      variationDiffs: fileMap.get(filePath)!,
    }));

    try {
      let results: FileAnalysis[];

      if (batch.length === 1) {
        const prompt = buildFileAnalysisPrompt(
          batch[0],
          fileMap.get(batch[0])!
        );
        const response = await runAgentCommand(cli, prompt, models.fast);
        const parsed = parseJsonResponse<{
          synopsis: string;
          scores: Record<string, number>;
          winner: string;
        }>(response);
        results = [
          {
            filePath: batch[0],
            synopsis: parsed.synopsis,
            scores: parsed.scores,
            winner: parsed.winner,
          },
        ];
      } else {
        const prompt = buildBatchAnalysisPrompt(batchData);
        const response = await runAgentCommand(cli, prompt, models.fast);
        results = parseJsonResponse<FileAnalysis[]>(response);
      }

      fileAnalyses.push(...results);
      emitProgress('analyzing', batch[batch.length - 1]);
    } catch (error: any) {
      console.error(`Batch analysis failed for ${batch.join(', ')}:`, error.message);
      for (const filePath of batch) {
        fileAnalyses.push({
          filePath,
          synopsis: 'Analysis failed - treating as neutral',
          scores: Object.fromEntries(variations.map((v) => [v, 5])),
          winner: variations[0],
        });
      }
    }
  }

  emitProgress('synthesizing');

  const synthesisPrompt = buildSynthesisPrompt(fileAnalyses, variations);
  const synthesisResponse = await runAgentCommand(
    cli,
    synthesisPrompt,
    models.synthesis
  );

  const synthesisResult = parseJsonResponse<{
    winner: string;
    rankings: Array<{
      variation: string;
      rank: number;
      strengths: string[];
      weaknesses: string[];
    }>;
    summary: string;
  }>(synthesisResponse);

  const stats: Record<string, { totalScore: number; fileWins: number; count: number }> = {};
  for (const v of variations) {
    stats[v] = { totalScore: 0, fileWins: 0, count: 0 };
  }

  for (const analysis of fileAnalyses) {
    for (const [varId, score] of Object.entries(analysis.scores)) {
      if (stats[varId]) {
        stats[varId].totalScore += score;
        stats[varId].count++;
      }
    }
    if (stats[analysis.winner]) {
      stats[analysis.winner].fileWins++;
    }
  }

  const result: JudgeResult = {
    winner: synthesisResult.winner,
    rankings: synthesisResult.rankings.map((r) => ({
      ...r,
      fileWins: stats[r.variation]?.fileWins ?? 0,
      avgScore: stats[r.variation]?.count
        ? stats[r.variation].totalScore / stats[r.variation].count
        : 0,
    })),
    summary: synthesisResult.summary,
    fileAnalyses,
  };

  emitProgress('complete');
  onProgress?.({
    phase: 'complete',
    completedFiles: totalFiles,
    totalFiles,
    fileAnalyses,
    result,
  });

  return result;
}
