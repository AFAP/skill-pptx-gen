#!/usr/bin/env node
/**
 * ai-ppt-gen 预览生成工具：deck.json → 自包含 preview.html（双击即可打开）
 *
 * 生成的 HTML 内嵌 Konva + 预览核心 + pptxgenjs + 已解析主题的 deck 数据，
 * 支持缩放适应窗口、双击文本就地编辑、一键浏览器端导出 PPTX。
 *
 * 用法：node tools/make_preview.mjs deck.json [-o preview.html] [--editable] [--scale 0.75]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '..');

const { resolveTheme, resolveTokens, prefetchImages } = await import('../core/ppt-core.mjs');

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
// 主题令牌在生成时解析，预览端拿到的就是最终颜色
const theme = resolveTheme(deck.theme);
const resolved = resolveTokens(deck, theme);
// 连接线/弧形宏展开为标准元素；shape-path 预合成 SVG data（预览端 Konva.Path 直接可用）
const { expandConnectors, pointsToSvgPath } = await import('../core/connectors.mjs');
expandConnectors(resolved);
for (const slide of resolved.slides || []) {
  for (const el of slide.elements || []) {
    if (el.elType === 'shape-path' && Array.isArray(el.pointArr) && !el.data) {
      el.data = pointsToSvgPath(el.pointArr) + (el.closePath !== false ? ' Z' : '');
    }
  }
}
if (args.prefetch) await prefetchImages(resolved, { baseDir: dirname(inputPath) });

// 内嵌 JS 时必须转义 </script>，否则源码注释/字符串中的 </script> 会提前闭合标签
const safeJs = s => s.replace(/<\/script/gi, '<\\/script');

const konvaSrc = safeJs(await readFile(resolve(SKILL_DIR, 'assets/konva.10.0.12.min.js'), 'utf-8'));
const pptxgenSrc = safeJs(await readFile(resolve(SKILL_DIR, 'assets/pptxgen.4.0.1.js'), 'utf-8'));
const previewCoreSrc = safeJs(await readFile(resolve(SKILL_DIR, 'core/ppt-preview-core.js'), 'utf-8'));

const deckJson = JSON.stringify(resolved).replace(/<\//g, '<\\/');
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
<script>
const DECK = ${deckJson};
const THEME_FONT = ${JSON.stringify(theme.fontFamily || '')};
let currentScale = ${args.scale || 'null'};
let stages = [];
let editCount = 0;

// 双击文本编辑 → 回写 DECK（随后"导出 PPTX / deck.json"都带修改）
function onTextEdit(node, newText) {
  if (node._elop) {
    node._elop.text = newText;
    editCount++;
    const btn = document.getElementById('btn-deck');
    btn.style.display = '';
    btn.textContent = '导出 deck.json（已改 ' + editCount + ' 处）';
  }
}

function exportDeck() {
  const blob = new Blob([JSON.stringify(DECK, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (DECK.meta?.title || 'deck') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function rerender() {
  const scale = currentScale || fitScale();
  stages = await PptPreview.renderDeck(DECK, document.getElementById('app'), {
    scale,
    editable: ${args.editable},
    fontFamily: THEME_FONT || undefined,
    onTextEdit,
  });
}
function fitScale() {
  return Math.min(1, (window.innerWidth - 64) / PptPreview.PPT_WIDTH);
}
function zoomIn() { currentScale = Math.min(2, (currentScale || fitScale()) + 0.1); rerender(); }
function zoomOut() { currentScale = Math.max(0.2, (currentScale || fitScale()) - 0.1); rerender(); }
function zoomFit() { currentScale = null; rerender(); }

// 浏览器端导出：DSL → PptxGenJS（与 Node 端 tools/build_pptx.mjs 同一套约定）
async function exportPptx() {
  const btn = document.querySelector('.toolbar button.primary');
  btn.disabled = true; btn.textContent = '导出中...';
  try {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'WIDE_1280', width: 13.333, height: 7.5 });
    pptx.layout = 'WIDE_1280';
    const PX2INCH = 13.333 / 1280;
    const FONT_SCALE = ${theme.fontScale};
    const px2in = v => Number((v * PX2INCH).toFixed(4));
    const col = c => { if (!c) return undefined; let s = String(c).trim().replace('#',''); if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map(x=>x+x).join(''); return s.slice(0,6).toUpperCase(); };
    const alphaOf = c => { const s = String(c||'').replace('#',''); return s.length === 8 ? Math.round((1 - parseInt(s.slice(6),16)/255) * 100) : 0; };

    for (const slideSpec of DECK.slides) {
      const slide = pptx.addSlide();
      if (slideSpec.background) slide.background = { color: col(slideSpec.background) };
      for (const el of slideSpec.elements) {
        try {
          const base = { x: px2in(el.x ?? 0), y: px2in(el.y ?? 0), w: px2in(el.width ?? 0), h: px2in(el.height ?? 0) };
          if (el.rotation || el.rotate) base.rotate = el.rotation ?? el.rotate;
          const fillOf = f => {
            if (!f) return undefined;
            const raw = typeof f === 'string' ? f : f.color;
            if (!raw) return undefined;
            const t = alphaOf(raw) || (el.opacity != null ? Math.round((1 - el.opacity) * 100) : 0);
            const out = { color: col(raw) };
            if (t) out.transparency = t;
            return out;
          };
          const lineOf = () => {
            const c = el.stroke || el.lineColor;
            if (!c) return undefined;
            const out = { color: col(c), width: el.strokeWidth ?? el.lineWidth ?? 2 };
            if (el.dashType === 'dash') out.dashType = 'dash';
            if (el.lineEndArrowType) out.endArrowType = el.lineEndArrowType;
            return out;
          };
          if (el.elType === 'text') {
            slide.addText(String(el.text ?? ''), {
              ...base,
              fontSize: Math.max(6, Math.round((el.fontSize || 18) * FONT_SCALE * 10) / 10),
              bold: el.bold || String(el.fontStyle || '').includes('bold'),
              italic: el.italic || String(el.fontStyle || '').includes('italic'),
              color: col(el.fill) || '111111',
              fontFace: (el.fontFamily || THEME_FONT || '').split(',')[0].trim() || undefined,
              align: el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : 'left',
              valign: { top: 'top', middle: 'middle', center: 'middle', bottom: 'bottom' }[el.verticalAlign || el.valign] || 'top',
              lineSpacingMultiple: el.lineHeight ? Math.min(3, Math.max(0.5, el.lineHeight)) : undefined,
              charSpacing: el.letterSpacing ? Math.round(el.letterSpacing * FONT_SCALE) : undefined,
              transparency: el.opacity != null && el.opacity < 1 ? Math.round((1 - el.opacity) * 100) : undefined,
              fill: fillOf(el.bgFill),
              margin: el.padding ? Math.round(el.padding * 0.75 * 10) / 10 : undefined,
            });
          } else if (el.elType === 'image') {
            const src = el._data || el.data || el.path || el.url;
            if (!src) continue;
            slide.addImage({ ...base, [src.startsWith('data:') ? 'data' : 'path']: src, rounding: !!(el.cornerRadius || el.rounding) });
          } else if (el.elType === 'image-svg') {
            slide.addImage({ ...base, data: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(el.svgXml || ''))) });
          } else if (el.elType === 'shape-rect') {
            const r = el.cornerRadius ?? el.rectRadius;
            slide.addShape(r ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { ...base, fill: fillOf(el.fill), line: lineOf(), rectRadius: r ? px2in(r) : undefined });
          } else if (el.elType === 'shape-circle') {
            slide.addShape(pptx.ShapeType.ellipse, { ...base, x: px2in((el.x ?? 0) - (el.width ?? 0) / 2), y: px2in((el.y ?? 0) - (el.height ?? 0) / 2), fill: fillOf(el.fill), line: lineOf() });
          } else if (el.elType === 'shape-line' || el.elType === 'shape-arrow') {
            const p = el.pointArr || [];
            if (p.length >= 2) {
              const opt = { x: px2in(p[0].x), y: px2in(p[0].y), w: px2in(p[1].x - p[0].x), h: px2in(p[1].y - p[0].y), line: lineOf() || { color: '333333', width: 2 } };
              // OOXML 不允许负尺寸：负 w/h 需换算为正尺寸 + flipH/flipV
              if (opt.w < 0) { opt.x += opt.w; opt.w = -opt.w; opt.flipH = true; }
              if (opt.h < 0) { opt.y += opt.h; opt.h = -opt.h; opt.flipV = true; }
              if (el.elType === 'shape-arrow') { opt.line.endArrowType = opt.line.endArrowType || 'stealth'; }
              slide.addShape(pptx.ShapeType.line, opt);
            }
          } else if (el.elType === 'curve-quadratic' || el.elType === 'shape-path') {
            if (Array.isArray(el.pointArr)) {
              slide.addShape(pptx.shapes.CUSTOM_GEOMETRY, {
                ...base, line: lineOf(), fill: fillOf(el.fill),
                points: el.pointArr.map(p => ({ x: px2in(p.x), y: px2in(p.y), ...(p.moveTo ? { moveTo: true } : {}), ...(p.controlPoint ? { curve: { type: 'quadratic', x1: px2in(p.controlPoint.x), y1: px2in(p.controlPoint.y) } } : {}), ...(p.curve ? { curve: Object.fromEntries(Object.entries(p.curve).map(([k, v]) => [k, typeof v === 'number' && k !== 'stAng' && k !== 'swAng' ? px2in(v) : v])) } : {}) })),
              });
            }
          } else if (el.elType === 'chart') {
            const typeMap = { bar: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut', area: 'area', radar: 'radar' };
            slide.addChart(pptx.ChartType[typeMap[el.chartType] || 'bar'],
              (el.data || []).map(s => ({ name: s.name || '', labels: s.labels || el.labels || [], values: s.values || [] })),
              { ...base, chartColors: (el.chartColors || []).map(col), showLegend: el.showLegend ?? true, showTitle: !!(el.showTitle && el.chartTitle), chartTitle: el.chartTitle });
          } else if (el.elType === 'table') {
            const hd = el.header || {};
            const rows = (el.rows || []).map((row, ri) => row.map(cell => {
              const isHd = hd.enabled !== false && ri === 0;
              return { text: String(cell ?? ''), options: { bold: isHd && hd.bold !== false, color: isHd ? (col(hd.color) || 'FFFFFF') : (col(el.color) || '1F2937'), fill: isHd ? { color: col(hd.fill) || '4A90E2' } : (ri % 2 && el.stripeColor ? { color: col(el.stripeColor) } : undefined), align: el.align || 'left', valign: 'middle' } };
            }));
            slide.addTable(rows, { ...base, fontSize: Math.max(6, Math.round((el.fontSize || 16) * FONT_SCALE * 10) / 10) });
          }
        } catch (err) { console.warn('元素导出失败', el.elType, err); }
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

window.addEventListener('resize', () => { if (currentScale === null) rerender(); });
rerender();
</script>
</body>
</html>`;

await writeFile(outputPath, html, 'utf-8');
console.log(`✅ 已生成预览 ${outputPath}（双击即可在浏览器打开）`);
