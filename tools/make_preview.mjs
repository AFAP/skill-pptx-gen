#!/usr/bin/env node
/**
 * ai-ppt-gen 预览生成工具：deck.json → 自包含 preview.html（双击即可打开）
 *
 * 生成的 HTML 内嵌：Konva + 预览核心 + pptxgenjs + **共享转换层**（core/dsl-to-pptx.mjs
 * 与 Node 端 build_pptx.mjs 是同一份实现，内联进页面——从根上消除"预览导出 ≠ CLI 导出"）。
 *
 * 预览页能力：缩放（不重建 Stage）、双击文本就地编辑（回写原始 deck）、
 * 导出修改后的 deck.json（保留主题令牌）、浏览器端导出 PPTX。
 *
 * 用法：node tools/make_preview.mjs deck.json [-o preview.html] [--no-edit] [--scale 0.75] [--embed-images]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '..');

const { resolveTheme, resolveTokens } = await import('../core/dsl-to-pptx.mjs');
const { expandConnectors, pointsToSvgPath } = await import('../core/connectors.mjs');
const { prefetchImages } = await import('../core/ppt-core.mjs');

function parseArgs(argv) {
  const args = { input: null, output: null, editable: true, scale: null, prefetch: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a === '--no-edit') args.editable = false;
    else if (a === '--scale') args.scale = Number(argv[++i]);
    else if (a === '--embed-images') args.prefetch = true; // 把 URL/本地图片内嵌为 base64（文件变大但离线可看）
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.input) {
  console.error('用法: node tools/make_preview.mjs deck.json [-o preview.html] [--no-edit] [--scale 0.75] [--embed-images]');
  process.exit(2);
}

const inputPath = resolve(args.input);
const outputPath = resolve(args.output || basename(inputPath).replace(/\.json$/i, '') + '.preview.html');

const deck = JSON.parse(await readFile(inputPath, 'utf-8'));
// 主题令牌在生成时解析，预览端拿到的就是最终颜色；宏展开为标准元素
const theme = resolveTheme(deck.theme);
const resolved = resolveTokens(deck, theme);
expandConnectors(resolved);
// shape-path 预合成 SVG data（预览端 Konva.Path 直接可用；闭合规则与转换层一致）
for (const slide of resolved.slides || []) {
  for (const el of slide.elements || []) {
    if (el.elType === 'shape-path' && Array.isArray(el.pointArr) && !el.data) {
      const close = el.closePath === true || el.closePath == null; // shape-path 默认闭合
      el.data = pointsToSvgPath(el.pointArr) + (close ? ' Z' : '');
    }
  }
}
if (args.prefetch) await prefetchImages(resolved, { baseDir: dirname(inputPath) });

// 内嵌 JS 时必须转义 </script>，否则源码注释/字符串中的 </script> 会提前闭合标签
const safeJs = s => s.replace(/<\/script/gi, '<\\/script');
// 纯转换模块 → 浏览器脚本：去 import 行与 export 前缀（这两个模块零三方依赖）
const toBrowserJs = s => s.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+(?=(async\s+)?(function|const|let|class))/gm, '');

const konvaSrc = safeJs(await readFile(resolve(SKILL_DIR, 'assets/konva.10.0.12.min.js'), 'utf-8'));
const pptxgenSrc = safeJs(await readFile(resolve(SKILL_DIR, 'assets/pptxgen.4.0.1.js'), 'utf-8'));
const previewCoreSrc = safeJs(await readFile(resolve(SKILL_DIR, 'core/ppt-preview-core.js'), 'utf-8'));
const connectorsSrc = safeJs(toBrowserJs(await readFile(resolve(SKILL_DIR, 'core/connectors.mjs'), 'utf-8')));
const dslCoreSrc = safeJs(toBrowserJs(await readFile(resolve(SKILL_DIR, 'core/dsl-to-pptx.mjs'), 'utf-8')));

const deckJson = JSON.stringify(resolved).replace(/<\//g, '<\\/');
const deckRawJson = JSON.stringify(deck).replace(/<\//g, '<\\/');
const title = (deck.meta?.title || 'PPT 预览').replace(/</g, '&lt;');

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
  <span class="hint">${(deck.slides || []).length} 页${args.editable ? ' · 双击文本可编辑' : ''}</span>
  <button onclick="zoomOut()">−</button>
  <button onclick="zoomIn()">＋</button>
  <button onclick="zoomFit()">适应宽度</button>
  <button id="btn-deck" onclick="exportDeck()" style="display:none">导出 deck.json</button>
  <button class="primary" onclick="exportPptx()">导出 PPTX</button>
</div>
<div id="app"></div>
<script>${konvaSrc}</script>
<script>${pptxgenSrc}</script>
<script>${previewCoreSrc}</script>
<script>${connectorsSrc}</script>
<script>${dslCoreSrc}</script>
<script>
const DECK = ${deckJson};        // 已解析令牌+已展开宏（渲染与 PPTX 导出用）
const DECK_RAW = ${deckRawJson}; // 原始 deck（导出 deck.json 用，保留主题令牌与宏写法）
const THEME = resolveTheme(DECK.theme);
let stages = [];
let currentScale = ${args.scale || 'null'};
let editCount = 0;

// 双击文本编辑 → 同时回写解析稿（PPTX 导出用）与原始稿（deck.json 导出用）
function onTextEdit(node, newText) {
  if (node._elop) node._elop.text = newText;
  const p = node._editPath;
  if (p && DECK_RAW.slides[p.s] && DECK_RAW.slides[p.s].elements[p.e] && DECK_RAW.slides[p.s].elements[p.e].elType === 'text') {
    DECK_RAW.slides[p.s].elements[p.e].text = newText;
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
  stages = await PptPreview.renderDeck(DECK, document.getElementById('app'), {
    scale: currentScale || fitScale(),
    editable: ${args.editable},
    fontFamily: THEME.fontFamily || undefined,
    onTextEdit,
  });
}
function zoomIn() { currentScale = Math.min(2, (currentScale || fitScale()) + 0.1); PptPreview.applyZoom(stages, currentScale); }
function zoomOut() { currentScale = Math.max(0.2, (currentScale || fitScale()) - 0.1); PptPreview.applyZoom(stages, currentScale); }
function zoomFit() { currentScale = fitScale(); PptPreview.applyZoom(stages, currentScale); }

// 浏览器端导出：与 Node 端 tools/build_pptx.mjs 共用 core/dsl-to-pptx.mjs 同一份实现
async function exportPptx() {
  const btn = document.querySelector('.toolbar button.primary');
  btn.disabled = true; btn.textContent = '导出中...';
  try {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'WIDE_1280', width: 13.333, height: 7.5 });
    pptx.layout = 'WIDE_1280';
    if (DECK.meta?.title) pptx.title = DECK.meta.title;
    for (const slideSpec of DECK.slides) {
      const slide = pptx.addSlide();
      const bg = slideBackground(slideSpec.background, THEME);
      if (bg) slide.background = bg;
      for (const el of slideSpec.elements) {
        if (el._error) continue;
        try { applyElement(pptx, slide, el, THEME); } catch (err) { console.warn('元素导出失败', el.elType, err); }
      }
      if (slideSpec.notes || slideSpec.speakerNotes) slide.addNotes(slideSpec.notes || slideSpec.speakerNotes);
    }
    await pptx.writeFile({ fileName: (DECK.meta?.title || 'presentation') + '.pptx' });
  } catch (e) {
    alert('导出失败: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '导出 PPTX';
  }
}

window.addEventListener('resize', () => { if (currentScale === null) { zoomFit(); } });
render();
</script>
</body>
</html>`;

await writeFile(outputPath, html, 'utf-8');
console.log(`✅ 已生成预览 ${outputPath}（双击即可在浏览器打开）`);
