import path from 'node:path';
import chalk from 'chalk';
import express from 'express';
import open from 'open';
import { getProjectConfig, resolveProjectPath } from '../lib/config.js';
import { listChangedFiles, ChangedFile } from '../lib/workspace.js';
import { generateFileDiff } from '../lib/diff.js';

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
    
    .variation-tabs {
      display: flex;
      gap: 4px;
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
    <div class="variation-tabs" id="variationTabs"></div>
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
