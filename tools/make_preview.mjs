#!/usr/bin/env node
/**
 * ppt-gen 预览生成工具：deck.json → 自包含 preview.html（双击即可打开）
 *
 * 生成的 HTML 内嵌：Konva + 预览核心 + pptxgenjs + **共享转换层**（core/dsl-to-pptx.mjs
 * 与 Node 端 build_pptx.mjs 是同一份实现，内联进页面——从根上消除"预览导出 ≠ CLI 导出"）。
 *
 * 预览页能力：缩放（不重建 Stage）、双击有明确源路径的文本就地编辑（回写原始 deck）、
 * 导出修改后的 deck.json（保留主题令牌）、浏览器端导出 PPTX。
 *
 * 用法：node tools/make_preview.mjs deck.json [-o preview.html] [--no-edit] [--scale 0.75] [--embed-images]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserBundle } from './lib/browser-bundle.mjs';
import { sceneResourceErrors } from '../core/presentation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '..');

const { compileDeck } = await import('../core/compile-deck.mjs');
const { prefetchImages } = await import('../core/ppt-core.mjs');
const { validateDeck, formatReport } = await import('../core/dsl-validate.mjs');

function parseArgs(argv) {
  const args = { input: null, output: null, editable: true, scale: null, prefetch: true, strict: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a === '--no-edit') args.editable = false;
    else if (a === '--scale') args.scale = Number(argv[++i]);
    else if (a === '--embed-images') args.prefetch = true;
    else if (a === '--no-embed-images') args.prefetch = false;
    else if (a === '--allow-partial') args.strict = false;
    else if (a === '--base-dir') args.baseDir = argv[++i];
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

const args = parseArgs(process.argv);

if (process.argv.includes('--help')) {
  console.log('用法: node tools/make_preview.mjs deck.json [-o preview.html] [--no-edit] [--scale 0.75] [--no-embed-images] [--allow-partial]');
  process.exit(0);
}
if (!args.input) {
  console.error('用法: node tools/make_preview.mjs deck.json [-o preview.html] [--no-edit] [--scale 0.75] [--no-embed-images] [--allow-partial]');
  process.exit(2);
}

const inputPath = resolve(args.input);
const outputPath = resolve(args.output || basename(inputPath).replace(/\.json$/i, '') + '.preview.html');

const deck = JSON.parse((await readFile(inputPath, 'utf-8')).replace(/^\uFEFF/, '')); // 容忍 Windows BOM
const validation = validateDeck(deck);
if (!validation.ok || validation.warnings.length) console.warn(formatReport(validation));
if (!validation.ok && args.strict) process.exit(1);
// 语义 layout → primitive DSL；主题令牌与连接线宏也在此统一展开。
const { deck: resolved, theme } = compileDeck(deck);
if (args.prefetch) await prefetchImages(resolved, { baseDir: args.baseDir ? resolve(args.baseDir) : dirname(inputPath), svgMode: 'browser' });
const resourceErrors = sceneResourceErrors(resolved);
if (args.strict && resourceErrors.length) throw new Error(resourceErrors.join('\n'));

// 内嵌 JS 时必须转义 </script>，否则源码注释/字符串中的 </script> 会提前闭合标签
const safeJs = s => s.replace(/<\/script/gi, '<\\/script');

const konvaSrc = safeJs(await readFile(resolve(SKILL_DIR, 'assets/konva.10.0.12.min.js'), 'utf-8'));
const pptxgenSrc = safeJs(await readFile(resolve(SKILL_DIR, 'assets/pptxgen.4.0.1.js'), 'utf-8'));
const jszipSrc = safeJs(await readFile(resolve(SKILL_DIR, 'node_modules/jszip/dist/jszip.min.js'), 'utf-8'));
const previewCoreSrc = safeJs(await readFile(resolve(SKILL_DIR, 'core/ppt-preview-core.js'), 'utf-8'));
const runtimeSrc = safeJs(await browserBundle(SKILL_DIR, ['core/source-edit.mjs', 'core/presentation.mjs', 'core/pptx-sanitize.mjs']));

const deckJson = JSON.stringify(resolved).replace(/<\//g, '<\\/');
const deckRawJson = JSON.stringify(deck).replace(/<\//g, '<\\/');
const title = (deck.meta?.title || 'PPT 预览')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - 预览</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #525659; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; min-height: 100vh; }
  .toolbar {
    position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 100;
    display: flex; align-items: center; gap: 12px; padding: 0 16px;
    background: rgba(32,33,36,0.95); color: #e8eaed; backdrop-filter: blur(8px);
  }
  .toolbar .title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .toolbar button {
    padding: 6px 14px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
    background: #3c4043; color: #e8eaed;
  }
  .toolbar button:hover { background: #4a4e51; }
  .toolbar button.primary { background: #0B57D0; }
  .toolbar button.primary:hover { background: #1b66d8; }
  .toolbar .hint { font-size: 12px; color: #9aa0a6; }
  #app { padding: 64px 0 40px; }
</style>
</head>
<body>
<div class="toolbar">
  <span class="title">${title}</span>
  <span class="hint">${(deck.slides || []).length} 页${args.editable ? ' · 双击可回写文本进行编辑' : ''}</span>
  <button onclick="zoomOut()">−</button>
  <button onclick="zoomIn()">＋</button>
  <button onclick="zoomFit()">适应宽度</button>
  <button id="btn-deck" onclick="exportDeck()" style="display:none">导出 deck.json</button>
  <button class="primary" onclick="exportPptx()">导出 PPTX</button>
</div>
<div id="app"></div>
<script>${konvaSrc}</script>
<script>${pptxgenSrc}</script>
<script>${jszipSrc}</script>
<script>${previewCoreSrc}</script>
<script>${runtimeSrc}</script>
<script>
const { resolveTheme, chartModel } = __pptModules['core/dsl-to-pptx.mjs'];
const { pointsToSvgPath } = __pptModules['core/connectors.mjs'];
const { editDeckText } = __pptModules['core/source-edit.mjs'];
const { presentationFromScene } = __pptModules['core/presentation.mjs'];
const { sanitizePptxData } = __pptModules['core/pptx-sanitize.mjs'];
let DECK = ${deckJson};
let DECK_RAW = ${deckRawJson};
let THEME = resolveTheme(DECK.theme);
let stages = [];
let currentScale = ${args.scale || 'null'};
let editCount = 0;
let previewDiagnostics = [];

// 双击文本编辑 → 同时回写解析稿（PPTX 导出用）与原始稿（deck.json 导出用）
async function onTextEdit(node, newText) {
  const result = editDeckText(DECK_RAW, node._elop?.sourcePath, newText, DECK);
  const previous = { source: DECK_RAW, deck: DECK, theme: THEME };
  DECK_RAW = result.source; DECK = result.deck; THEME = result.theme;
  try { await render(); }
  catch (error) {
    DECK_RAW = previous.source; DECK = previous.deck; THEME = previous.theme;
    await render();
    throw error;
  }
  editCount++;
  const btn = document.getElementById('btn-deck');
  btn.style.display = '';
  btn.textContent = '导出 deck.json（已改 ' + editCount + ' 处）';
}

function exportDeck() {
  const blob = new Blob([JSON.stringify(DECK_RAW, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (DECK.meta?.title || 'deck') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function fitScale() {
  return Math.min(1, (window.innerWidth - 64) / PptPreview.PPT_WIDTH);
}
async function render() {
  const scroll = window.scrollY;
  for (const old of stages) old.stage.destroy();
  previewDiagnostics = [];
  stages = await PptPreview.renderDeck(DECK, document.getElementById('app'), {
    scale: currentScale || fitScale(),
    editable: ${args.editable},
    fontFamily: THEME.fontFamily || undefined,
    theme: THEME,
    palette: THEME.palette,
    strict: ${args.strict},
    onDiagnostic: diagnostic => previewDiagnostics.push(diagnostic),
    onTextEdit,
  });
  window.scrollTo(0, scroll);
}
function zoomIn() { currentScale = Math.min(2, (currentScale || fitScale()) + 0.1); PptPreview.applyZoom(stages, currentScale); }
function zoomOut() { currentScale = Math.max(0.2, (currentScale || fitScale()) - 0.1); PptPreview.applyZoom(stages, currentScale); }
function zoomFit() { currentScale = fitScale(); PptPreview.applyZoom(stages, currentScale); }

// 浏览器端导出：与 Node 端 tools/build_pptx.mjs 共用 core/dsl-to-pptx.mjs 同一份实现
async function exportPptx() {
  const btn = document.querySelector('.toolbar button.primary');
  btn.disabled = true; btn.textContent = '导出中...';
  try {
    const { pptx } = presentationFromScene(PptxGenJS, DECK, THEME);
    const raw = await pptx.write({ outputType: 'arraybuffer' });
    const sanitized = await sanitizePptxData(JSZip, raw, { outputType: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(sanitized.data);
    a.download = (DECK.meta?.title || 'presentation') + '.pptx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    alert('导出失败: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '导出 PPTX';
  }
}

window.addEventListener('resize', () => { if (currentScale === null) { zoomFit(); } });
window.PPT_PREVIEW_READY = render().catch(error => {
  document.querySelector('.toolbar button.primary').disabled = true;
  const notice = document.createElement('pre');
  notice.textContent = '预览失败，导出已停用：' + error.message;
  document.getElementById('app').prepend(notice);
  console.error(error);
  throw error;
});
</script>
</body>
</html>`;

await writeFile(outputPath, html, 'utf-8');
console.log(`✅ 已生成预览 ${outputPath}（双击即可在浏览器打开）`);
