/**
 * ai-ppt-gen DSL 校验器
 *
 * 在渲染/导出前检查 deck JSON，输出 errors（必须修复）与 warnings（建议修复）。
 * 检查项：结构完整性、画布越界（宏先展开再查）、文本溢出估算、颜色格式、图片源、
 * 对比度（按透明度逐层混合实际背景）、文本框疑似重叠、图表/表格数据形态、渐变压平提示。
 */

import { PPT_WIDTH, PPT_HEIGHT, BUILTIN_THEMES, parseColor, resolveTheme } from './dsl-to-pptx.mjs';
import { MACRO_TYPES } from './connectors.mjs';
import { compileDeck, CURRENT_DSL_VERSION } from './compile-deck.mjs';
import { LAYOUT_TYPES, normalizeLayoutName } from './layouts.mjs';

const EL_TYPES = new Set([
  'text', 'image', 'image-svg', 'shape-rect', 'shape-circle',
  'shape-line', 'shape-arrow', 'shape-path', 'curve-quadratic', 'chart', 'table', 'text-path',
  ...MACRO_TYPES,
]);

const MACRO_REQUIRED = {
  'connector-s': ['x1', 'y1', 'x2', 'y2'],
  'connector-elbow': ['x1', 'y1', 'x2', 'y2'],
  'arc-segment': ['cx', 'cy', 'rOuter', 'startAngle', 'endAngle'],
};

const CHART_TYPES = new Set(['bar', 'line', 'pie', 'doughnut', 'area', 'radar', 'scatter']);

const DEFAULT_LINE_HEIGHT = 1.25; // 与渲染端（Konva / PPT 导出）默认一致

/** 文本在容器内自动换行后的估算高度（中文全宽、ASCII 0.55 宽） */
export function estimateWrappedHeight(text, fontSize, boxWidth, lineHeight = DEFAULT_LINE_HEIGHT) {
  const lines = String(text ?? '').split('\n');
  let total = 0;
  for (const ln of lines) {
    let u = 0;
    for (const ch of ln) u += ch.charCodeAt(0) > 255 ? 1 : 0.55;
    const lineUnits = u * fontSize;
    total += Math.max(1, Math.ceil(lineUnits / Math.max(1, boxWidth)));
  }
  return total * fontSize * lineHeight;
}

function estTextWidth(text, fontSize) {
  let u = 0;
  for (const ch of String(text)) u += ch.charCodeAt(0) > 255 ? 1 : 0.55;
  return u * fontSize;
}

function luminance(hex) {
  const p = parseColor(hex);
  if (!p) return 1;
  const f = i => {
    const c = parseInt(p.color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
}

/** 把 top 色按 alpha(0-1) 混合到 bottom 色上，返回混合后的 HEX */
function blendColor(bottomHex, topHex, alpha) {
  const b = parseColor(bottomHex), t = parseColor(topHex);
  if (!b || !t) return topHex || bottomHex;
  const ch = i => Math.round(parseInt(t.color.slice(i, i + 2), 16) * alpha + parseInt(b.color.slice(i, i + 2), 16) * (1 - alpha));
  return [0, 2, 4].map(i => ch(i).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function validateDeck(deck, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!deck || typeof deck !== 'object' || Array.isArray(deck)) {
    return { ok: false, errors: ['deck 必须是 JSON 对象'], warnings };
  }
  if (deck.dslVersion != null && (!Number.isInteger(deck.dslVersion) || deck.dslVersion < 1)) errors.push('dslVersion 必须是正整数');
  if (Number.isInteger(deck.dslVersion) && deck.dslVersion > CURRENT_DSL_VERSION) errors.push(`dslVersion ${deck.dslVersion} 高于当前支持版本 ${CURRENT_DSL_VERSION}`);
  if (deck.style != null && typeof deck.style !== 'string') errors.push('style 必须是内置样式名称字符串');
  const selectedTheme = deck.theme ?? deck.style;
  if (typeof selectedTheme === 'string' && !BUILTIN_THEMES[selectedTheme]) errors.push(`未知样式/主题 "${selectedTheme}"`);
  if (deck.theme != null && typeof deck.theme !== 'string' && (typeof deck.theme !== 'object' || Array.isArray(deck.theme))) errors.push('theme 必须是内置名称或主题对象');
  if (deck.theme && typeof deck.theme === 'object' && deck.theme.extends && !BUILTIN_THEMES[deck.theme.extends]) errors.push(`theme.extends 引用了未知样式 "${deck.theme.extends}"`);
  const theme = resolveTheme(deck.theme || deck.style);
  if (deck.theme && typeof deck.theme === 'object' && deck.theme.accent && !deck.theme.accentText) {
    const accentLum = luminance(deck.theme.accent);
    const backgrounds = [deck.theme.background || theme.background, deck.theme.surface || theme.surface];
    const minRatio = Math.min(...backgrounds.map(bg => {
      const bgLum = luminance(bg);
      return (Math.max(accentLum, bgLum) + 0.05) / (Math.min(accentLum, bgLum) + 0.05);
    }));
    if (minRatio < 4.5) warnings.push(`自定义 theme.accent 的最小文字对比度为 ${minRatio.toFixed(2)}；请显式提供 accentText`);
  }
  if (!Array.isArray(deck.slides) || deck.slides.length === 0) {
    errors.push('deck.slides 必须是非空数组');
    return { ok: false, errors, warnings };
  }
  if (deck.slides.length > 60) warnings.push(`页数 ${deck.slides.length} 较多，建议控制在 30 页以内`);

  // 第 0 遍（原始结构）：语义 layout、未知 elType、宏必填字段。
  const slideIds = new Set();
  deck.slides.forEach((slide, si) => {
    const where = `第${si + 1}页`;
    if (!slide || typeof slide !== 'object') { errors.push(`${where}: slide 必须是对象`); return; }
    if (slide.id) {
      if (slideIds.has(slide.id)) errors.push(`${where}: slide id "${slide.id}" 重复`);
      slideIds.add(slide.id);
    }
    if (slide.layout) {
      const layout = normalizeLayoutName(slide.layout);
      if (!LAYOUT_TYPES.includes(layout)) errors.push(`${where}: 未知 layout "${slide.layout}"`);
      if (!['quote', 'raw'].includes(layout) && !slide.title) errors.push(`${where}: layout ${layout} 缺少 title`);
      for (const key of ['title', 'subtitle', 'eyebrow', 'notes', 'speakerNotes', 'footerLabel', 'brand', 'contentTitle', 'heading', 'centerLabel']) {
        if (slide[key] != null && typeof slide[key] !== 'string') errors.push(`${where}: ${key} 必须是字符串`);
      }
      if (slide.footer != null && typeof slide.footer !== 'boolean') errors.push(`${where}: footer 必须是布尔值`);
      if (slide.columns != null && (!Number.isInteger(slide.columns) || slide.columns < 1 || slide.columns > 6)) errors.push(`${where}: columns 必须是 1–6 的整数`);
      for (const key of ['items', 'metrics', 'bullets', 'insights']) {
        if (slide[key] != null && !Array.isArray(slide[key])) errors.push(`${where}: ${key} 必须是数组`);
      }
      if (['agenda', 'cards', 'metrics', 'timeline'].includes(layout) && (!Array.isArray(slide.items) || !slide.items.length)) errors.push(`${where}: layout ${layout} 需要非空 items`);
      if (layout === 'quote' && !slide.quote && !slide.text) errors.push(`${where}: layout quote 需要 quote 或 text`);
      if (layout === 'comparison' && (!slide.left || !slide.right)) errors.push(`${where}: layout comparison 需要 left 和 right`);
      if (layout === 'raw' && (!Array.isArray(slide.elements) || !slide.elements.length)) errors.push(`${where}: layout raw 需要非空 elements`);
    }
    if (!Array.isArray(slide.elements)) return;
    slide.elements.forEach((el, ei) => {
      const at = `${where} 元素${ei + 1}${el?.elType ? `(${el.elType})` : ''}`;
      if (!el || !el.elType) { errors.push(`${at}: 缺少 elType`); return; }
      if (!EL_TYPES.has(el.elType)) { errors.push(`${at}: 未知 elType "${el.elType}"`); return; }
      if (MACRO_REQUIRED[el.elType]) {
        for (const k of MACRO_REQUIRED[el.elType]) {
          if (typeof el[k] !== 'number') errors.push(`${at}: 宏 ${el.elType} 缺少数字字段 ${k}`);
        }
        if (el.elType === 'arc-segment') {
          if (typeof el.rOuter === 'number' && el.rOuter <= 0) errors.push(`${at}: arc-segment rOuter 必须 > 0`);
          if (typeof el.rInner === 'number' && el.rInner <= 0) errors.push(`${at}: arc-segment rInner 必须 > 0`);
          if (typeof el.rOuter === 'number' && typeof el.rInner === 'number' && el.rInner > el.rOuter) errors.push(`${at}: arc-segment rInner(${el.rInner}) 不能大于 rOuter(${el.rOuter})`);
        }
        if ((el.elType === 'connector-s' || el.elType === 'connector-elbow') && el.orientation != null && !['auto', 'h', 'v', 'h-first', 'v-first'].includes(el.orientation)) {
          warnings.push(`${at}: ${el.elType} orientation "${el.orientation}" 无法识别（将使用默认值）`);
        }
      }
    });
  });

  if (errors.length) return { ok: false, errors, warnings, theme };

  let resolved;
  try {
    resolved = compileDeck(deck).deck;
  } catch (err) {
    errors.push(`编译失败: ${err.message}`);
    return { ok: false, errors, warnings, theme };
  }

  resolved.slides.forEach((slide, si) => {
    const where = `第${si + 1}页`;
    if (Array.isArray(slide.webUnsupported) && slide.webUnsupported.length) warnings.push(`${where}: HTML 页面使用了 PPTX 无等价实现的 CSS：${slide.webUnsupported.join(', ')}`);
    if (!Array.isArray(slide.elements) || slide.elements.length === 0) {
      errors.push(`${where}: elements 缺失或为空`);
      return;
    }
    // 背景色（用于对比度检查）
    const fillOf = f => {
      if (!f) return null;
      if (typeof f === 'string') return f;
      if (f.type === 'gradient' && Array.isArray(f.stops) && f.stops.length) {
        return f.stops[f.stops.length - 1].color; // 渐变取末端色近似
      }
      return f.color || null;
    };
    let bgHex = slide.background || theme.background;
    slide.elements.forEach(el => {
      if (el.elType === 'shape-rect' && el.x === 0 && el.y === 0 && el.width >= PPT_WIDTH && el.height >= PPT_HEIGHT) {
        const f = fillOf(el.fill);
        if (f) bgHex = f; // 全屏矩形视为实际背景
      }
    });

    // 找出文本/元素的"实际背景"：从底到顶依次混合覆盖其中心点的形状（考虑填充透明度）
    const effectiveBg = (el, upto) => {
      const cx = (el.x ?? 0) + (el.width ?? 0) / 2;
      const cy = (el.y ?? 0) + (el.height ?? 0) / 2;
      let bg = bgHex;
      for (let j = 0; j < upto; j++) {
        const s = slide.elements[j];
        if (!s || (s.elType !== 'shape-rect' && s.elType !== 'shape-circle' && s.elType !== 'image')) continue;
          const sw = s.elType === 'shape-circle' ? (s.width ?? (s.radius ? s.radius * 2 : 0)) : (s.width ?? 0);
          const sh = s.elType === 'shape-circle' ? (s.height ?? sw) : (s.height ?? 0);
          const sx = s.elType === 'shape-circle' ? (s.x ?? 0) - sw / 2 : (s.x ?? 0);
          const sy = s.elType === 'shape-circle' ? (s.y ?? 0) - sh / 2 : (s.y ?? 0);
          if (cx >= sx && cx <= sx + sw && cy >= sy && cy <= sy + sh) {
            const p = parseColor(fillOf(s.fill) || '');
            if (!p) continue;
          const a = (1 - (p.transparency ?? 0) / 100) * (s.opacity ?? 1); // 元素级 opacity 也参与混合
          if (a <= 0.01) continue; // 全透明填充不影响背景
          bg = blendColor(bg, p.color, a);
        }
      }
      return bg;
    };

    const elementIds = new Set();
    slide.elements.forEach((el, ei) => {
      const at = `${where} 元素${ei + 1}${el.elType ? `(${el.elType})` : ''}`;
        if (el.id) {
          if (elementIds.has(el.id)) errors.push(`${at}: 元素 id "${el.id}" 重复`);
          elementIds.add(el.id);
        }

        // 路径类元素必须有合法 pointArr；SVG path data 只有预览支持。
        const validatePointArr = (pa, label, local = false) => {
          if (!Array.isArray(pa) || pa.length < 2) {
            errors.push(`${at}: ${label} 缺少 pointArr（至少 2 个点）`);
            return;
          }
          pa.forEach((p, pi) => {
            if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') {
              errors.push(`${at}: ${label} pointArr[${pi}] 的 x/y 必须是数字`);
            }
          });
          const ox = local ? (el.x || 0) : 0, oy = local ? (el.y || 0) : 0;
          const xs = pa.map(p => typeof p.x === 'number' ? p.x + ox : p.x).filter(v => typeof v === 'number');
          const ys = pa.map(p => typeof p.y === 'number' ? p.y + oy : p.y).filter(v => typeof v === 'number');
          if (xs.length && ys.length) {
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
            if (minX < -1 || minY < -1 || maxX > PPT_WIDTH + 1 || maxY > PPT_HEIGHT + 1) {
              warnings.push(`${at}: ${label} 点列越界（${Math.round(minX)},${Math.round(minY)} → ${Math.round(maxX)},${Math.round(maxY)}）`);
            }
          }
        };
        if (['shape-line', 'shape-arrow', 'curve-quadratic'].includes(el.elType)) {
          validatePointArr(el.pointArr, el.elType, el.elType === 'curve-quadratic');
        }
        if (el.elType === 'shape-path') {
          if (Array.isArray(el.pointArr)) validatePointArr(el.pointArr, 'shape-path', true);
          else if (el.data || el.svgPath) errors.push(`${at}: shape-path 的 SVG data 仅预览可用，PPTX 导出要求 pointArr`);
          else errors.push(`${at}: shape-path 缺少 pointArr`);
        }

      // 几何检查（line/arrow/curve 用 pointArr，跳过矩形检查）
      if (!el.allowOverflow && !['shape-line', 'shape-arrow', 'curve-quadratic'].includes(el.elType)) {
        for (const k of ['x', 'y', 'width', 'height']) {
          if (el[k] != null && typeof el[k] !== 'number') errors.push(`${at}: ${k} 必须是数字`);
        }
        const x = el.x ?? 0, y = el.y ?? 0, w = el.width ?? 0, h = el.height ?? 0;
        if (el.elType === 'shape-circle') {
          // 圆心坐标；直径缺省 height 回退 width，与导出/预览一致
          const dw = el.radius != null ? el.radius * 2 : (w || 0);
          const dh = el.radius != null ? el.radius * 2 : (h || w || 0);
          if (x - dw / 2 < -1 || y - dh / 2 < -1 || x + dw / 2 > PPT_WIDTH + 1 || y + dh / 2 > PPT_HEIGHT + 1)
            warnings.push(`${at}: 圆形越界（圆心 ${x},${y} 半径 ${dw / 2}×${dh / 2}）`);
        } else {
            if (x < -1 || y < -1) warnings.push(`${at}: 起点越界 x=${x}, y=${y}`);
            if (x + w > PPT_WIDTH + 1 || y + h > PPT_HEIGHT + 1)
            warnings.push(`${at}: 超出画布（右缘 ${Math.round(x + w)}/${PPT_WIDTH}，下缘 ${Math.round(y + h)}/${PPT_HEIGHT}）`);
        }
      }

      // 渐变压平提示（预览显示真渐变，导出为可编辑首色）
      if (el.fill && typeof el.fill === 'object' && el.fill.type === 'gradient' && Array.isArray(el.fill.stops) && el.fill.stops.length > 1) {
        warnings.push(`${at}: 渐变填充导出 PPTX 时压平为首色（${el.fill.stops[0]?.color}），如需保留渐变请改用图片`);
      }
      if (Array.isArray(el.webUnsupported) && el.webUnsupported.length) {
        warnings.push(`${at}: HTML 使用了 PPTX 无等价实现的 CSS：${el.webUnsupported.join(', ')}`);
      }

      // 类型特定检查
      if (el.elType === 'text') {
        if (el.text == null || String(el.text) === '') warnings.push(`${at}: text 为空`);
        const fontSize = el.fontSize || 18;
        if (fontSize < 10) warnings.push(`${at}: fontSize ${fontSize}px 过小（<10px 在 PPT 中难以阅读）`);
        if (el.width > 0 && el.height > 0 && el.text) {
          const needH = estimateWrappedHeight(el.text, fontSize, el.width, el.lineHeight || DEFAULT_LINE_HEIGHT);
          if (needH > el.height * 1.15) {
            warnings.push(`${at}: 文本可能溢出（估算高 ${Math.round(needH)}px > 容器 ${el.height}px），建议缩减文案或加高容器`);
          }
        }
          // 对比度：先叠元素自身 bgFill，再把文字透明度混入前景后计算
          const fillParsed = parseColor(typeof el.fill === 'string' ? el.fill : el.fill?.color);
          const fill = fillParsed?.color;
          if (fill && el.opacity !== 0) {
            let under = effectiveBg(el, ei);
            if (el.bgFill) {
              const bgP = parseColor(typeof el.bgFill === 'string' ? el.bgFill : el.bgFill?.color);
              if (bgP) under = blendColor(under, bgP.color, (1 - (bgP.transparency ?? 0) / 100) * (el.bgOpacity ?? 1));
            }
            const alpha = (1 - (fillParsed.transparency ?? 0) / 100) * (el.opacity ?? 1);
            const tColor = alpha < 1 ? blendColor(under, fill, alpha) : fill;
            const tLum = luminance(tColor);
            const uLum = luminance(under);
            const contrast = (Math.max(tLum, uLum) + 0.05) / (Math.min(tLum, uLum) + 0.05);
            const isUtilityText = ['footer', 'page-number', 'eyebrow', 'decoration'].includes(el.role) || fontSize <= 11;
            const isBold = el.bold || String(el.fontStyle || '').includes('bold');
            const minContrast = fontSize >= 24 || (isBold && fontSize >= 16) ? 3 : 4.5;
            if (!isUtilityText && contrast < minContrast) warnings.push(`${at}: 文字色 ${fill} 与背景对比度 ${contrast.toFixed(2)} 低于建议值 ${minContrast}`);
          }
        }
        if (el.elType === 'text-path') {
          errors.push(`${at}: text-path 不能导出为可编辑 PPTX；请改用 text 或 image-svg`);
        }
        if (el.elType === 'image') {
          if (!el.path && !el.url && !el._data && !el.data && !el.prompt) {
            errors.push(`${at}: image 缺少 path/url/data（或用于 AI 生图的 prompt）`);
          }
          if (el.prompt && !el.path && !el.url && !el._data && !el.data) errors.push(`${at}: image 仍只有 prompt，构建前必须生成并填写 path/data`);
          if (el.cornerRadius && !el.rounding) warnings.push(`${at}: 可编辑 PPTX 不支持普通图片圆角；将按直角图片导出，或先把圆角栅格化到图片本身`);
          if ((el.width || 0) < 20 || (el.height || 0) < 20) warnings.push(`${at}: 图片尺寸过小`);
        }
        if (el.elType === 'image-svg' && !el.svgXml) errors.push(`${at}: image-svg 缺少 svgXml`);
        if (el.elType === 'chart') {
          const chartType = el.chartType || 'bar';
          if (!CHART_TYPES.has(chartType)) {
            errors.push(`${at}: chartType "${chartType}" 无法识别；禁止静默退化为 bar`);
          }
          if (!Array.isArray(el.data) || el.data.length === 0) {
            errors.push(`${at}: chart 缺少 data 数组`);
          } else {
            const labels = el.labels || el.data[0]?.labels || [];
            if (!labels.length && chartType !== 'pie' && chartType !== 'doughnut' && chartType !== 'scatter') {
              warnings.push(`${at}: chart 缺少 labels（分类轴标签）`);
            }
            el.data.forEach((s, i2) => {
              if (!Array.isArray(s.values) || s.values.length === 0) {
                errors.push(`${at}: chart data[${i2}].values 为空`);
              } else if (chartType === 'scatter') {
                s.values.forEach((pt, pi) => {
                  if (!Array.isArray(pt) || pt.length < 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
                    errors.push(`${at}: scatter data[${i2}].values[${pi}] 必须是 [x,y] 数字对`);
                  }
                });
              } else if (labels.length && s.values.length !== labels.length) {
                warnings.push(`${at}: chart data[${i2}] 数值数(${s.values.length})与标签数(${labels.length})不一致`);
              }
            });
          }
        }
      if (el.elType === 'table') {
        if (!Array.isArray(el.rows) || el.rows.length === 0) {
          errors.push(`${at}: table 缺少 rows`);
        } else {
          const cols = Math.max(...el.rows.map(r => r.length));
          el.rows.forEach((r, ri) => { if (r.length !== cols) warnings.push(`${at}: table 第${ri + 1}行列数(${r.length})与最多列(${cols})不一致`); });
          // 单元格文本溢出估算
          const cellW = (el.width || 600) / cols;
          const fs = el.fontSize || 16;
          el.rows.forEach((r, ri) => r.forEach((cell, ci) => {
            if (estTextWidth(String(cell ?? ''), fs) > cellW - 16) {
              warnings.push(`${at}: table 单元格[${ri + 1}][${ci + 1}] 文本可能超出列宽（"${String(cell).slice(0, 12)}…"）`);
            }
          }));
        }
      }
        const needsBox = ['text', 'image', 'image-svg', 'shape-rect', 'chart', 'table'].includes(el.elType);
        if (needsBox) {
          for (const key of ['x', 'y', 'width', 'height']) {
            if (typeof el[key] !== 'number') errors.push(`${at}: ${key} 为必填数字`);
          }
          if ((el.width || 0) <= 0 || (el.height || 0) <= 0) errors.push(`${at}: width/height 必须 > 0`);
        }
        // 颜色格式抽查（令牌已在前面解析，残留的 $xxx 视为未解析令牌）
        for (const key of ['fill', 'stroke', 'lineColor', 'shadowColor']) {
          const v = el[key];
          if (typeof v !== 'string' || v === 'transparent' || parseColor(v)) continue;
          if (v.startsWith('$')) warnings.push(`${at}: ${key} 令牌无法解析 "${v}"（请检查 theme.palette 长度或令牌名）`);
          else warnings.push(`${at}: ${key} 颜色值无法识别 "${v}"`);
        }
    });

    // 先只检查文本框之间的明显碰撞；背景卡、图标覆盖和连接线不参与，避免大量误报。
    if (opts.checkOverlap !== false) {
      const utilityRoles = new Set(['footer', 'page-number', 'eyebrow', 'decoration']);
      const textBoxes = slide.elements
        .map((el, index) => ({ el, index }))
        .filter(({ el }) => el.elType === 'text'
          && String(el.text ?? '').trim()
          && !el.allowOverlap
          && el.opacity !== 0
          && !utilityRoles.has(el.role)
          && (el.fontSize || 18) > 11
          && [el.x, el.y, el.width, el.height].every(Number.isFinite));
      for (let i = 0; i < textBoxes.length; i++) {
        for (let j = i + 1; j < textBoxes.length; j++) {
          const a = textBoxes[i], b = textBoxes[j];
          const overlapW = Math.min(a.el.x + a.el.width, b.el.x + b.el.width) - Math.max(a.el.x, b.el.x);
          const overlapH = Math.min(a.el.y + a.el.height, b.el.y + b.el.height) - Math.max(a.el.y, b.el.y);
          if (overlapW <= 6 || overlapH <= 6) continue;
          const overlapArea = overlapW * overlapH;
          const smallerArea = Math.min(a.el.width * a.el.height, b.el.width * b.el.height);
          if (smallerArea > 0 && overlapArea / smallerArea >= 0.2) {
            warnings.push(`${where}: 文本框疑似重叠（元素${a.index + 1} 与元素${b.index + 1}）；若为有意叠放请设置 allowOverlap:true`);
          }
        }
      }
    }
  });

  return { ok: errors.length === 0, errors, warnings, theme };
}

/** CLI 友好的格式化输出 */
export function formatReport(result) {
  const lines = [];
  if (result.errors?.length) {
    lines.push(`❌ ${result.errors.length} 个错误：`);
    result.errors.forEach(e => lines.push(`  - ${e}`));
  }
  if (result.warnings?.length) {
    lines.push(`⚠️  ${result.warnings.length} 个警告：`);
    result.warnings.forEach(w => lines.push(`  - ${w}`));
  }
  if (!lines.length) lines.push('✅ 校验通过，无错误无警告');
  return lines.join('\n');
}
