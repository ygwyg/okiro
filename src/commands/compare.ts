import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import express from 'express';
import open from 'open';
import { getProjectConfig, resolveProjectPath } from '../lib/config.js';
import { listChangedFiles, ChangedFile } from '../lib/workspace.js';
import { generateFileDiff } from '../lib/diff.js';
import { detectAgentCLI } from '../lib/agent.js';
import { runMultiAgentJudge, VariationDiffs } from '../lib/judge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CompareOptions {
  port?: number;
  noBrowser?: boolean;
}

interface FileWithVariations extends ChangedFile {
  variations: string[];
}

export async function compare(options: CompareOptions): Promise<void> {
  const projectPath = resolveProjectPath();
  const project = await getProjectConfig(projectPath);

  if (!project) {
    console.log(chalk.yellow('\nNo active variations for this project.'));
    console.log('Run `okiro 3` to create variations.\n');
    return;
  }

  const app = express();
  const port = options.port ?? 6789;

  app.use(express.json());

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  app.get('/api/project', (_req, res) => {
    res.json({
      name: path.basename(projectPath),
      originalPath: projectPath,
      variations: project.variations.map((v) => ({
        id: v.id,
        createdAt: v.createdAt,
      })),
    });
  });

  app.get('/api/all-files', async (_req, res) => {
    const fileMap = new Map<string, FileWithVariations>();

    for (const variation of project.variations) {
      const files = await listChangedFiles(projectPath, variation.path);

      for (const file of files) {
        const existing = fileMap.get(file.path);
        if (existing) {
          existing.variations.push(variation.id);
          if (file.status === 'A' && existing.status !== 'A') {
            existing.status = file.status;
          }
        } else {
          fileMap.set(file.path, {
            ...file,
            variations: [variation.id],
          });
        }
      }
    }

    const allFiles = Array.from(fileMap.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    res.json(allFiles);
  });

  app.get('/api/files/:variation', async (req, res) => {
    const variationId = req.params.variation;

    if (variationId === 'original') {
      res.json([]);
      return;
    }

    const variation = project.variations.find((v) => v.id === variationId);
    if (!variation) {
      res.status(404).json({ error: 'Variation not found' });
      return;
    }

    const files = await listChangedFiles(projectPath, variation.path);
    res.json(files);
  });

  app.get('/api/diff/:variation', async (req, res) => {
    const variation = req.params.variation;
    const file = req.query.file as string;

    if (!file) {
      res.status(400).json({ error: 'Missing file query param' });
      return;
    }

    const varConfig = project.variations.find((v) => v.id === variation);
    if (!varConfig) {
      res.status(404).json({ error: 'Variation not found' });
      return;
    }

    const diff = await generateFileDiff(projectPath, varConfig.path, file);
    res.json(diff);
  });

  app.get('/', (_req, res) => {
    res.send(getCompareHtml(project.variations.map((v) => v.id)));
  });

  const judgeAnimationPath = path.resolve(__dirname, '../judge/judge-animation');
  app.use('/judge-animation', express.static(judgeAnimationPath));

  app.get('/judge', (_req, res) => {
    res.send(getJudgeHtml(project.variations.map((v) => v.id)));
  });

  app.get('/api/judge/stream', async (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const cli = await detectAgentCLI();
      if (!cli) {
        sendEvent('error', { message: 'No AI CLI found (claude, opencode, or codex)' });
        res.end();
        return;
      }

      sendEvent('init', { cli, variations: project.variations.map((v) => v.id) });
      console.log(chalk.dim(`  Using ${cli} for multi-agent judgment...`));

      const variationDiffs: VariationDiffs[] = await Promise.all(
        project.variations.map(async (variation) => {
          const changedFiles = await listChangedFiles(projectPath, variation.path);
          const diffs = await Promise.all(
            changedFiles.map(async (file) => {
              const diff = await generateFileDiff(projectPath, variation.path, file.path);
              return {
                filePath: diff.filePath,
                status: diff.status as 'M' | 'A' | 'D',
                patch: diff.patch,
                original: diff.original,
                modified: diff.modified,
              };
            })
          );
          return { variationId: variation.id, diffs };
        })
      );

      const result = await runMultiAgentJudge(cli, variationDiffs, (progress) => {
        sendEvent('progress', progress);
      });

      sendEvent('complete', result);
      console.log(chalk.green('  ✓ Multi-agent judgment complete'));
    } catch (error: any) {
      console.error('Judge error:', error?.message || error);
      sendEvent('error', { message: error?.message || 'Failed to judge variations' });
    }

    res.end();
  });

  app.listen(port, () => {
    console.log(chalk.green(`\n✓ Diff viewer at http://localhost:${port}\n`));

    if (!options.noBrowser) {
      open(`http://localhost:${port}`);
    }
  });
}

function getCompareHtml(variations: string[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>okiro</title>
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link href="https://cdn.jsdelivr.net/npm/iosevka@31.1.0/iosevka.min.css" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    :root {
      --rp-base: #191724;
      --rp-surface: #1f1d2e;
      --rp-overlay: #26233a;
      --rp-muted: #6e6a86;
      --rp-subtle: #908caa;
      --rp-text: #e0def4;
      --rp-love: #eb6f92;
      --rp-gold: #f6c177;
      --rp-rose: #ebbcba;
      --rp-pine: #31748f;
      --rp-foam: #9ccfd8;
      --rp-iris: #c4a7e7;
      --rp-highlight-low: #21202e;
      --rp-highlight-med: #403d52;
      --rp-highlight-high: #524f67;
    }
    
    body {
      font-family: 'Iosevka Web', 'Iosevka', monospace;
      background: var(--rp-base);
      color: var(--rp-text);
      min-height: 100vh;
      font-size: 13px;
    }
    
    header {
      padding: 12px 20px;
      border-bottom: 1px solid var(--rp-overlay);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--rp-surface);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    
    .header-left {
      display: flex;
      align-items: center;
      gap: 24px;
    }
    
    h1 { 
      font-size: 13px; 
      font-weight: 600;
      color: var(--rp-iris);
      letter-spacing: 1px;
    }
    
    .view-toggle {
      display: flex;
      gap: 2px;
      background: var(--rp-base);
      padding: 2px;
      border-radius: 4px;
    }
    
    .view-toggle button {
      padding: 4px 10px;
      background: transparent;
      border: none;
      color: var(--rp-muted);
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      border-radius: 3px;
      transition: all 0.15s;
    }
    
    .view-toggle button:hover {
      color: var(--rp-subtle);
    }
    
    .view-toggle button.active {
      background: var(--rp-overlay);
      color: var(--rp-text);
    }
    
    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    
    .variation-tabs {
      display: flex;
      gap: 4px;
    }
    
    .judge-btn {
      padding: 5px 14px;
      background: linear-gradient(135deg, #7c6fdc22, #7c6fdc11);
      border: 1px solid #7c6fdc55;
      border-radius: 4px;
      color: #c4a7e7;
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 1px;
      text-transform: uppercase;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .judge-btn:hover {
      background: linear-gradient(135deg, #7c6fdc33, #7c6fdc22);
      border-color: #7c6fdc88;
      color: #e0def4;
      box-shadow: 0 0 12px rgba(124, 111, 220, 0.3);
    }
    
    .variation-tab {
      padding: 5px 12px;
      background: var(--rp-base);
      border: 1px solid var(--rp-overlay);
      border-radius: 4px;
      color: var(--rp-muted);
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }
    
    .variation-tab:hover {
      border-color: var(--rp-highlight-med);
      color: var(--rp-subtle);
    }
    
    .variation-tab.active {
      background: var(--rp-overlay);
      color: var(--rp-text);
      border-color: var(--rp-highlight-high);
    }
    
    .variation-tab.hidden {
      display: none;
    }
    
    main { 
      display: flex; 
      height: calc(100vh - 49px); 
    }
    
    .sidebar {
      width: 280px;
      min-width: 280px;
      border-right: 1px solid var(--rp-overlay);
      overflow-y: auto;
      background: var(--rp-base);
    }
    
    .sidebar-header {
      padding: 10px 14px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--rp-muted);
      border-bottom: 1px solid var(--rp-overlay);
      position: sticky;
      top: 0;
      background: var(--rp-base);
    }
    
    .file-list { 
      list-style: none; 
    }
    
    .file-item {
      padding: 8px 14px;
      cursor: pointer;
      border-bottom: 1px solid var(--rp-highlight-low);
      transition: background 0.1s;
    }
    
    .file-item:hover { 
      background: var(--rp-surface); 
    }
    
    .file-item.selected { 
      background: var(--rp-overlay);
    }
    
    .file-item-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .status { 
      font-weight: 600; 
      font-size: 11px;
      width: 14px;
      text-align: center;
    }
    
    .status.M { color: var(--rp-gold); }
    .status.A { color: var(--rp-foam); }
    .status.D { color: var(--rp-love); }
    
    .file-path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--rp-text);
      font-size: 12px;
    }
    
    .file-variations {
      margin-top: 3px;
      margin-left: 22px;
      font-size: 10px;
      color: var(--rp-muted);
    }
    
    .file-variations span {
      margin-right: 6px;
    }
    
    .diff-view {
      flex: 1;
      overflow: auto;
      background: var(--rp-base);
    }
    
    .diff-wrapper {
      min-height: 100%;
    }
    
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--rp-muted);
      font-size: 12px;
    }

    #diffContainer {
      height: 100%;
    }

    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    ::-webkit-scrollbar-track {
      background: var(--rp-base);
    }
    
    ::-webkit-scrollbar-thumb {
      background: var(--rp-overlay);
      border-radius: 4px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: var(--rp-highlight-med);
    }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <h1>OKIRO</h1>
      <div class="view-toggle">
        <button id="splitBtn" class="active">Split</button>
        <button id="unifiedBtn">Unified</button>
      </div>
    </div>
    <div class="header-right">
      <div class="variation-tabs" id="variationTabs"></div>
      <a href="/judge" class="judge-btn">Judge</a>
    </div>
  </header>
  <main>
    <aside class="sidebar">
      <div class="sidebar-header">Changed Files</div>
      <ul class="file-list" id="fileList"></ul>
    </aside>
    <section class="diff-view" id="diffView">
      <div class="empty-state">Select a file to view diff</div>
    </section>
  </main>
  <script type="module">
    import { FileDiff } from 'https://esm.sh/@pierre/diffs@1.0.5';

    const variations = ${JSON.stringify(variations)};
    const fileList = document.getElementById('fileList');
    const diffView = document.getElementById('diffView');
    const variationTabs = document.getElementById('variationTabs');
    const splitBtn = document.getElementById('splitBtn');
    const unifiedBtn = document.getElementById('unifiedBtn');

    let selectedFile = null;
    let selectedVariation = variations[0];
    let allFiles = [];
    let diffStyle = 'split';
    let diffInstance = null;

    splitBtn.addEventListener('click', () => {
      diffStyle = 'split';
      splitBtn.classList.add('active');
      unifiedBtn.classList.remove('active');
      if (diffInstance) {
        diffInstance.setOptions({ diffStyle: 'split' });
        diffInstance.rerender();
      }
    });

    unifiedBtn.addEventListener('click', () => {
      diffStyle = 'unified';
      unifiedBtn.classList.add('active');
      splitBtn.classList.remove('active');
      if (diffInstance) {
        diffInstance.setOptions({ diffStyle: 'unified' });
        diffInstance.rerender();
      }
    });

    async function loadAllFiles() {
      const response = await fetch('/api/all-files');
      allFiles = await response.json();
      renderFileList();
    }

    function renderFileList() {
      fileList.innerHTML = allFiles.map(f => \`
        <li class="file-item" data-path="\${f.path}">
          <div class="file-item-header">
            <span class="status \${f.status}">\${f.status}</span>
            <span class="file-path">\${f.path}</span>
          </div>
          <div class="file-variations">
            \${f.variations.map(v => \`<span>\${v}</span>\`).join('')}
          </div>
        </li>
      \`).join('');

      document.querySelectorAll('.file-item').forEach(item => {
        item.addEventListener('click', () => selectFile(item.dataset.path));
      });

      if (allFiles.length > 0 && !selectedFile) {
        selectFile(allFiles[0].path);
      }
    }

    function selectFile(filePath) {
      selectedFile = filePath;

      document.querySelectorAll('.file-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.path === filePath);
      });

      const fileData = allFiles.find(f => f.path === filePath);
      
      renderVariationTabs(fileData?.variations || []);
      
      if (fileData && !fileData.variations.includes(selectedVariation)) {
        selectedVariation = fileData.variations[0];
      }
      updateVariationTabs();

      loadDiff();
    }

    function renderVariationTabs(fileVariations) {
      variationTabs.innerHTML = fileVariations.map(v => 
        \`<button class="variation-tab" data-var="\${v}">\${v}</button>\`
      ).join('');
      
      variationTabs.querySelectorAll('.variation-tab').forEach(tab => {
        tab.addEventListener('click', () => selectVariation(tab.dataset.var));
      });
    }

    function selectVariation(varId) {
      selectedVariation = varId;
      updateVariationTabs();
      if (selectedFile) {
        loadDiff();
      }
    }

    function updateVariationTabs() {
      document.querySelectorAll('.variation-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.var === selectedVariation);
      });
    }

    async function loadDiff() {
      if (!selectedFile || !selectedVariation) return;

      const fileData = allFiles.find(f => f.path === selectedFile);
      if (!fileData || !fileData.variations.includes(selectedVariation)) {
        diffView.innerHTML = '<div class="empty-state">No changes in ' + selectedVariation + '</div>';
        return;
      }

      diffView.innerHTML = '<div class="empty-state">Loading...</div>';

      const response = await fetch(\`/api/diff/\${selectedVariation}?file=\${encodeURIComponent(selectedFile)}\`);
      const diff = await response.json();

      renderDiff(diff);
    }

    function renderDiff(diff) {
      diffView.innerHTML = '<div id="diffContainer"></div>';
      
      if (diffInstance) {
        diffInstance.cleanUp();
      }

      diffInstance = new FileDiff({
        theme: 'rose-pine',
        themeType: 'dark',
        diffStyle: diffStyle,
        diffIndicators: 'classic',
        overflow: 'scroll',
      });

      diffInstance.render({
        oldFile: { name: diff.filePath, contents: diff.original },
        newFile: { name: diff.filePath, contents: diff.modified },
        containerWrapper: document.getElementById('diffContainer'),
      });
    }

    loadAllFiles();
  </script>
</body>
</html>`;
}

function getJudgeHtml(variations: string[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>okiro - judge</title>
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link href="https://cdn.jsdelivr.net/npm/iosevka-webfont@14.0.0/iosevka.css" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    
    :root {
      --void: #08070a;
      --abyss: #0c0b0f;
      --shadow: #12111a;
      --depths: #1a1823;
      --muted: #3d3a4d;
      --subtle: #5c5872;
      --text: #a09caf;
      --bright: #d4d0e0;
      --accent: #7c6fdc;
      --accent-dim: #5a4fb3;
      --success: #6b9e78;
      --gold: #f6c177;
      --love: #eb6f92;
    }
    
    html { font-size: 14px; }
    
    body {
      font-family: 'Iosevka Web', 'Iosevka', monospace;
      background: var(--void);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    
    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 9999;
      opacity: 0.035;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
      background-repeat: repeat;
      background-size: 256px 256px;
    }
    
    ::selection { background: var(--accent); color: var(--void); }
    
    .container {
      max-width: 720px;
      margin: 0 auto;
      padding: 40px 24px 100px;
      position: relative;
    }
    
    .back-link {
      position: absolute;
      top: 24px; left: 24px;
      color: var(--muted);
      text-decoration: none;
      font-size: 12px;
      letter-spacing: 1px;
      transition: color 0.15s;
    }
    
    .back-link:hover { color: var(--bright); }
    
    .hero {
      text-align: center;
      margin-bottom: 32px;
      padding-top: 40px;
      animation: fadeIn 0.8s ease-out;
    }
    
    .hero-graphic {
      margin-bottom: 0;
      display: flex;
      justify-content: center;
      overflow: hidden;
      padding: 16px;
      border: 1px solid var(--shadow);
      background: var(--abyss);
    }
    
    .ascii-art {
      font-family: 'Iosevka Web', 'Iosevka', monospace;
      font-size: 4px;
      line-height: 1.4;
      letter-spacing: 3px;
      white-space: pre;
      background: transparent;
      margin: 0;
      opacity: 0;
      transition: opacity 0.5s;
    }
    
    .ascii-art.loaded { opacity: 1; }
    .ascii-art .r { display: block; }
    
    .judge-title {
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: var(--muted);
      margin-top: 16px;
      opacity: 0;
      transition: opacity 0.3s, color 0.3s;
    }
    
    .judge-title.visible { opacity: 1; color: var(--gold); }
    .judge-title.complete { color: var(--success); }
    
    .state { display: none; animation: fadeIn 0.5s ease-out; }
    .state.active { display: block; }
    
    .start-state { text-align: center; }
    
    .start-btn {
      background: var(--abyss);
      border: 1px solid var(--accent-dim);
      color: var(--bright);
      padding: 14px 32px;
      font-family: inherit;
      font-size: 13px;
      letter-spacing: 2px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 16px;
    }
    
    .start-btn:hover { background: var(--accent-dim); border-color: var(--accent); }
    .start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .start-btn.hidden { display: none; }
    
    .progress-section {
      margin-top: 24px;
      border: 1px solid var(--shadow);
      background: var(--abyss);
      text-align: left;
    }
    
    .progress-header {
      padding: 12px 20px;
      border-bottom: 1px solid var(--shadow);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .progress-title { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: var(--muted); }
    .progress-count { font-size: 12px; color: var(--subtle); }
    
    .progress-bar-container {
      height: 4px;
      background: var(--shadow);
    }
    
    .progress-bar {
      height: 100%;
      background: var(--accent);
      width: 0%;
      transition: width 0.3s ease-out;
    }
    
    .progress-log {
      max-height: 240px;
      overflow-y: auto;
      padding: 12px 20px;
      font-size: 11px;
    }
    
    .log-entry {
      padding: 4px 0;
      color: var(--subtle);
      display: flex;
      gap: 12px;
      text-align: left;
    }
    
    .log-entry.complete { color: var(--success); }
    .log-entry.current { color: var(--gold); }
    .log-entry .file { flex: 1; text-align: left; }
    .log-entry .winner { color: var(--accent); text-align: right; }
    
    .results { text-align: left; }
    
    .winner-card {
      background: var(--abyss);
      border: 2px solid var(--accent);
      padding: 24px;
      margin-bottom: 24px;
      animation: glowPulse 2s ease-in-out infinite;
      text-align: left;
    }
    
    @keyframes glowPulse {
      0%, 100% { box-shadow: 0 0 20px rgba(124, 111, 220, 0.2); }
      50% { box-shadow: 0 0 40px rgba(124, 111, 220, 0.4); }
    }
    
    .winner-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 3px;
      color: var(--accent);
      margin-bottom: 4px;
    }
    
    .winner-name {
      font-size: 24px;
      font-weight: 500;
      color: var(--bright);
      letter-spacing: 2px;
    }
    
    .winner-summary {
      margin-top: 12px;
      font-size: 13px;
      color: var(--subtle);
      line-height: 1.7;
    }
    
    .rankings {
      margin-top: 32px;
      border: 1px solid var(--shadow);
      background: var(--abyss);
      text-align: left;
    }
    
    .ranking-item {
      padding: 16px 20px;
      border-bottom: 1px solid var(--shadow);
    }
    
    .ranking-item:last-child { border-bottom: none; }
    
    .ranking-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    
    .ranking-position {
      font-size: 18px;
      font-weight: 500;
      color: var(--muted);
      width: 28px;
    }
    
    .ranking-position.first { color: var(--gold); }
    .ranking-position.second { color: var(--subtle); }
    
    .ranking-name {
      font-size: 14px;
      color: var(--bright);
      flex: 1;
      margin-left: 12px;
    }
    
    .ranking-stats {
      font-size: 11px;
      color: var(--muted);
    }
    
    .ranking-details { margin-left: 40px; }
    
    .strengths, .weaknesses { font-size: 11px; margin-top: 6px; }
    .strengths span { color: var(--success); margin-right: 4px; }
    .weaknesses span { color: var(--love); margin-right: 4px; }
    .strength-item, .weakness-item {
      color: var(--subtle);
      display: block;
      padding-left: 16px;
      margin-top: 2px;
    }
    
    .file-breakdown {
      margin-top: 32px;
      border: 1px solid var(--shadow);
      background: var(--abyss);
      text-align: left;
    }
    
    .breakdown-header {
      padding: 12px 20px;
      border-bottom: 1px solid var(--shadow);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--muted);
    }
    
    .breakdown-item {
      padding: 10px 20px;
      border-bottom: 1px solid var(--shadow);
      font-size: 12px;
    }
    
    .breakdown-item:last-child { border-bottom: none; }
    .breakdown-file { color: var(--text); margin-bottom: 4px; }
    .breakdown-synopsis { color: var(--subtle); font-size: 11px; }
    .breakdown-winner { color: var(--accent); font-size: 11px; }
    
    .actions {
      margin-top: 32px;
      display: flex;
      gap: 16px;
      justify-content: flex-start;
    }
    
    .action-btn {
      background: var(--abyss);
      border: 1px solid var(--shadow);
      color: var(--text);
      padding: 12px 24px;
      font-family: inherit;
      font-size: 12px;
      letter-spacing: 1px;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
    }
    
    .action-btn:hover { border-color: var(--accent-dim); color: var(--bright); }
    .action-btn.primary { border-color: var(--accent-dim); color: var(--bright); }
    .action-btn.primary:hover { background: var(--accent-dim); }
    
    .error-state { text-align: center; color: var(--love); }
    .error-message { font-size: 13px; margin-bottom: 24px; }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <a href="/" class="back-link">← back to compare</a>
  
  <div class="container">
    <header class="hero">
      <div class="hero-graphic">
        <pre class="ascii-art" id="asciiArt"></pre>
      </div>
      <div class="judge-title" id="judgeTitle"></div>
    </header>

    <div class="state active" id="startState">
      <div class="start-state">
        <button class="start-btn" id="startBtn">Begin Judgment</button>
        
        <div class="progress-section" id="progressSection" style="display: none;">
          <div class="progress-header">
            <span class="progress-title" id="progressPhase">Analyzing files</span>
            <span class="progress-count" id="progressCount">0/0</span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar" id="progressBar"></div>
          </div>
          <div class="progress-log" id="progressLog"></div>
        </div>
      </div>
    </div>

    <div class="state" id="resultsState">
      <div class="results">
        <div class="winner-card">
          <div class="winner-label">Winner</div>
          <div class="winner-name" id="winnerName"></div>
          <div class="winner-summary" id="winnerSummary"></div>
        </div>

        <div class="rankings" id="rankings"></div>
        
        <div class="file-breakdown" id="fileBreakdown">
          <div class="breakdown-header">Per-File Analysis</div>
        </div>

        <div class="actions">
          <a href="/" class="action-btn">Back to Compare</a>
          <button class="action-btn primary" id="promoteBtn">Promote Winner</button>
        </div>
      </div>
    </div>

    <div class="state" id="errorState">
      <div class="error-state">
        <div class="error-message" id="errorMessage"></div>
        <button class="start-btn" id="retryBtn">Try Again</button>
      </div>
    </div>
  </div>

  <script>
    const variations = ${JSON.stringify(variations)};
    const totalFrames = 122;
    const frameDelay = 80;
    
    let renderedFrames = [];
    let asciiEl = document.getElementById('asciiArt');
    let judgeTitle = document.getElementById('judgeTitle');
    let animationInterval = null;
    let framesLoaded = false;
    let judgeResult = null;

    function showState(stateId) {
      document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
      document.getElementById(stateId).classList.add('active');
    }

    async function loadFrames() {
      const basePath = '/judge-animation';
      
      try {
        const metaRes = await fetch(\`\${basePath}/ascii-metadata.json\`);
        const meta = await metaRes.json();
        const chars = meta.asciiChars;
        
        function renderFrame(frame) {
          const { cols, rows, data } = frame;
          let html = '';
          let idx = 0;
          
          for (let y = 0; y < rows; y++) {
            let row = '<span class="r">';
            let currentColor = null;
            let run = '';
            
            for (let x = 0; x < cols; x++) {
              const [charIdx, r, g, b] = data[idx++];
              const char = chars[charIdx] || ' ';
              const color = \`rgb(\${r},\${g},\${b})\`;
              
              if (color === currentColor) {
                run += char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : char;
              } else {
                if (run) row += \`<span style="color:\${currentColor}">\${run}</span>\`;
                currentColor = color;
                run = char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : char;
              }
            }
            
            if (run) row += \`<span style="color:\${currentColor}">\${run}</span>\`;
            row += '</span>';
            html += row;
          }
          return html;
        }
        
        const frame0Res = await fetch(\`\${basePath}/ascii-frame-000.json\`);
        const frame0 = await frame0Res.json();
        renderedFrames = [renderFrame(frame0)];
        asciiEl.innerHTML = renderedFrames[0];
        asciiEl.classList.add('loaded');
        
        const framePromises = [];
        for (let i = 1; i < totalFrames; i++) {
          const frameNum = String(i).padStart(3, '0');
          framePromises.push(
            fetch(\`\${basePath}/ascii-frame-\${frameNum}.json\`).then(r => r.json())
          );
        }
        
        const remainingFrames = await Promise.all(framePromises);
        remainingFrames.forEach(f => renderedFrames.push(renderFrame(f)));
        framesLoaded = true;
      } catch (e) {
        console.error('Failed to load animation frames:', e);
        asciiEl.textContent = 'OKIRO JUDGE';
        asciiEl.classList.add('loaded');
      }
    }

    function playAnimationToEnd(callback) {
      if (!framesLoaded || renderedFrames.length === 0) {
        if (callback) callback();
        return;
      }

      let currentFrame = 0;
      
      animationInterval = setInterval(() => {
        currentFrame++;
        
        if (currentFrame >= renderedFrames.length) {
          clearInterval(animationInterval);
          animationInterval = null;
          asciiEl.innerHTML = renderedFrames[renderedFrames.length - 1];
          if (callback) callback();
          return;
        }
        
        asciiEl.innerHTML = renderedFrames[currentFrame];
      }, frameDelay);
    }

    function runJudgment() {
      const startBtn = document.getElementById('startBtn');
      const progressSection = document.getElementById('progressSection');
      const progressPhase = document.getElementById('progressPhase');
      const progressCount = document.getElementById('progressCount');
      const progressBar = document.getElementById('progressBar');
      const progressLog = document.getElementById('progressLog');
      
      startBtn.classList.add('hidden');
      progressSection.style.display = 'block';
      progressLog.innerHTML = '';
      
      judgeTitle.classList.add('visible');
      judgeTitle.classList.remove('complete');
      judgeTitle.textContent = 'Judging...';

      const eventSource = new EventSource('/api/judge/stream');
      const fileResults = new Map();

      eventSource.addEventListener('init', () => {
      });

      eventSource.addEventListener('progress', (e) => {
        const progress = JSON.parse(e.data);
        
        if (progress.phase === 'analyzing') {
          progressPhase.textContent = 'Analyzing files';
          progressCount.textContent = \`\${progress.completedFiles}/\${progress.totalFiles}\`;
          progressBar.style.width = \`\${(progress.completedFiles / progress.totalFiles) * 100}%\`;
          
          for (const analysis of progress.fileAnalyses) {
            if (!fileResults.has(analysis.filePath)) {
              fileResults.set(analysis.filePath, analysis);
              const entry = document.createElement('div');
              entry.className = 'log-entry complete';
              entry.innerHTML = \`<span class="file">\${analysis.filePath}</span><span class="winner">\${analysis.winner}</span>\`;
              progressLog.appendChild(entry);
              progressLog.scrollTop = progressLog.scrollHeight;
            }
          }
          
          if (progress.currentFile && !fileResults.has(progress.currentFile)) {
            const existing = progressLog.querySelector('.current');
            if (existing) existing.remove();
            
            const entry = document.createElement('div');
            entry.className = 'log-entry current';
            entry.innerHTML = \`<span class="file">\${progress.currentFile}</span><span class="winner">analyzing...</span>\`;
            progressLog.appendChild(entry);
            progressLog.scrollTop = progressLog.scrollHeight;
          }
        } else if (progress.phase === 'synthesizing') {
          progressPhase.textContent = 'Synthesizing';
          progressCount.textContent = 'Final judgment';
          progressBar.style.width = '100%';
          judgeTitle.textContent = 'Synthesizing...';
          
          const existing = progressLog.querySelector('.current');
          if (existing) existing.remove();
          
          const entry = document.createElement('div');
          entry.className = 'log-entry current';
          entry.innerHTML = '<span class="file">Running final synthesis...</span>';
          progressLog.appendChild(entry);
        }
      });

      eventSource.addEventListener('complete', (e) => {
        eventSource.close();
        judgeResult = JSON.parse(e.data);
        
        judgeTitle.textContent = 'Judgment Complete';
        judgeTitle.classList.add('complete');
        
        playAnimationToEnd(() => {
          showResults(judgeResult);
        });
      });

      eventSource.addEventListener('error', (e) => {
        eventSource.close();
        try {
          const data = JSON.parse(e.data);
          document.getElementById('errorMessage').textContent = data.message;
        } catch {
          document.getElementById('errorMessage').textContent = 'Connection lost. Try again.';
        }
        showState('errorState');
        startBtn.classList.remove('hidden');
        judgeTitle.classList.remove('visible');
      });

      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) return;
        eventSource.close();
        document.getElementById('errorMessage').textContent = 'Connection lost. Try again.';
        showState('errorState');
        startBtn.classList.remove('hidden');
        judgeTitle.classList.remove('visible');
      };
    }

    function showResults(result) {
      document.getElementById('winnerName').textContent = result.winner;
      document.getElementById('winnerSummary').textContent = result.summary;

      const rankingsHtml = result.rankings.map((r, i) => {
        const posClass = i === 0 ? 'first' : i === 1 ? 'second' : '';
        const strengthsHtml = r.strengths?.map(s => \`<span class="strength-item">+ \${s}</span>\`).join('') || '';
        const weaknessesHtml = r.weaknesses?.map(w => \`<span class="weakness-item">- \${w}</span>\`).join('') || '';
        
        return \`
          <div class="ranking-item">
            <div class="ranking-header">
              <span class="ranking-position \${posClass}">#\${r.rank}</span>
              <span class="ranking-name">\${r.variation}</span>
              <span class="ranking-stats">\${r.avgScore?.toFixed(1) || '?'}/10 avg | \${r.fileWins || 0} file wins</span>
            </div>
            <div class="ranking-details">
              \${strengthsHtml ? \`<div class="strengths"><span>+</span>\${strengthsHtml}</div>\` : ''}
              \${weaknessesHtml ? \`<div class="weaknesses"><span>-</span>\${weaknessesHtml}</div>\` : ''}
            </div>
          </div>
        \`;
      }).join('');

      document.getElementById('rankings').innerHTML = rankingsHtml;
      
      const breakdownHtml = result.fileAnalyses.map(a => \`
        <div class="breakdown-item">
          <div class="breakdown-file">\${a.filePath}</div>
          <div class="breakdown-winner">Winner: \${a.winner}</div>
          <div class="breakdown-synopsis">\${a.synopsis}</div>
        </div>
      \`).join('');
      
      document.getElementById('fileBreakdown').innerHTML = '<div class="breakdown-header">Per-File Analysis</div>' + breakdownHtml;
      
      document.getElementById('promoteBtn').onclick = () => {
        if (judgeResult?.winner) {
          alert(\`To promote the winner, run:\\n\\nokiro promote \${judgeResult.winner}\`);
        }
      };

      showState('resultsState');
    }

    document.getElementById('startBtn').addEventListener('click', runJudgment);
    document.getElementById('retryBtn').addEventListener('click', () => {
      showState('startState');
      document.getElementById('startBtn').classList.remove('hidden');
      document.getElementById('progressSection').style.display = 'none';
      judgeTitle.textContent = '';
      judgeTitle.classList.remove('visible', 'complete');
      if (renderedFrames.length > 0) {
        asciiEl.innerHTML = renderedFrames[0];
      }
    });

    loadFrames();
  </script>
</body>
</html>`;
}
