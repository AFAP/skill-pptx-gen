/**
 * ai-ppt-gen DSL 校验器
 *
 * 在渲染/导出前检查 deck JSON，输出 errors（必须修复）与 warnings（建议修复）。
 * 检查项：结构完整性、画布越界、文本溢出估算、颜色格式、图片源、对比度、元素重叠提示。
 */

import { PPT_WIDTH, PPT_HEIGHT, parseColor, resolveTheme, resolveTokens } from './ppt-core.mjs';

const EL_TYPES = new Set([
  'text', 'image', 'image-svg', 'shape-rect', 'shape-circle',
  'shape-line', 'shape-arrow', 'shape-path', 'curve-quadratic', 'chart', 'table', 'text-path',
  // 构建期宏（connectors.mjs 展开为标准元素）
  'connector-s', 'connector-elbow', 'arc-segment',
]);

const MACRO_REQUIRED = {
  'connector-s': ['x1', 'y1', 'x2', 'y2'],
  'connector-elbow': ['x1', 'y1', 'x2', 'y2'],
  'arc-segment': ['cx', 'cy', 'rOuter', 'startAngle', 'endAngle'],
};

/** 估算文本渲染尺寸（与 Konva/PPT 近似）：中文按全宽、ASCII 按 0.55 宽 */
export function estimateTextBox(text, fontSize, lineHeight = 1.2) {
  const lines = String(text ?? '').split('\n');
  let maxUnits = 0;
  for (const ln of lines) {
    let u = 0;
    for (const ch of ln) u += ch.charCodeAt(0) > 255 ? 1 : 0.55;
    maxUnits = Math.max(maxUnits, u);
  }
  return { width: maxUnits * fontSize, height: lines.length * fontSize * lineHeight, maxUnits, lines: lines.length };
}

/** 文本在容器内自动换行后的估算高度 */
export function estimateWrappedHeight(text, fontSize, boxWidth, lineHeight = 1.2) {
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
  const theme = resolveTheme(deck.theme);
  const resolved = resolveTokens(deck, theme);

  if (!resolved || typeof resolved !== 'object') {
    return { ok: false, errors: ['deck 必须是 JSON 对象'], warnings };
  }
  if (!Array.isArray(resolved.slides) || resolved.slides.length === 0) {
    errors.push('deck.slides 必须是非空数组');
    return { ok: false, errors, warnings };
  }
  if (resolved.slides.length > 60) warnings.push(`页数 ${resolved.slides.length} 较多，建议控制在 30 页以内`);

  resolved.slides.forEach((slide, si) => {
    const where = `第${si + 1}页`;
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
    const bgLum = luminance(bgHex);

    // 找出文本/元素的"实际背景"：从底到顶依次混合覆盖其中心点的形状（考虑填充透明度）
    const effectiveBg = (el, upto) => {
      const cx = (el.x ?? 0) + (el.width ?? 0) / 2;
      const cy = (el.y ?? 0) + (el.height ?? 0) / 2;
      let bg = bgHex;
      for (let j = 0; j < upto; j++) {
        const s = slide.elements[j];
        if (!s || (s.elType !== 'shape-rect' && s.elType !== 'shape-circle' && s.elType !== 'image')) continue;
        const sx = s.elType === 'shape-circle' ? (s.x ?? 0) - (s.width ?? 0) / 2 : (s.x ?? 0);
        const sy = s.elType === 'shape-circle' ? (s.y ?? 0) - (s.height ?? 0) / 2 : (s.y ?? 0);
        if (cx >= sx && cx <= sx + (s.width ?? 0) && cy >= sy && cy <= sy + (s.height ?? 0)) {
          const p = parseColor(fillOf(s.fill) || '');
          if (!p) continue;
          const a = 1 - (p.transparency ?? 0) / 100;
          if (a <= 0.01) continue; // 全透明填充不影响背景
          bg = blendColor(bg, p.color, a);
        }
      }
      return bg;
    };

    slide.elements.forEach((el, ei) => {
      const at = `${where} 元素${ei + 1}${el.elType ? `(${el.elType})` : ''}`;
      if (!el.elType) { errors.push(`${at}: 缺少 elType`); return; }
      if (!EL_TYPES.has(el.elType)) { errors.push(`${at}: 未知 elType "${el.elType}"`); return; }

      // 宏元素字段检查（几何检查不适用：宏由 connectors.mjs 在构建期展开定位）
      if (MACRO_REQUIRED[el.elType]) {
        for (const k of MACRO_REQUIRED[el.elType]) {
          if (typeof el[k] !== 'number') errors.push(`${at}: 宏 ${el.elType} 缺少数字字段 ${k}`);
        }
        return;
      }

      // 几何检查（line/arrow 用 pointArr，跳过）
      if (!['shape-line', 'shape-arrow', 'curve-quadratic'].includes(el.elType)) {
        for (const k of ['x', 'y', 'width', 'height']) {
          if (el[k] != null && typeof el[k] !== 'number') errors.push(`${at}: ${k} 必须是数字`);
        }
        const x = el.x ?? 0, y = el.y ?? 0, w = el.width ?? 0, h = el.height ?? 0;
        if (el.elType === 'shape-circle') {
          // 圆心坐标
          if (x - w / 2 < -1 || y - h / 2 < -1 || x + w / 2 > PPT_WIDTH + 1 || y + h / 2 > PPT_HEIGHT + 1)
            warnings.push(`${at}: 圆形越界（圆心 ${x},${y} 半径 ${w / 2}）`);
        } else {
          if (x < -1 || y < -1) warnings.push(`${at}: 起点越界 x=${x}, y=${y}`);
          if (x + w > PPT_WIDTH + 1 || y + h > PPT_HEIGHT + 1)
            warnings.push(`${at}: 超出画布（右缘 ${Math.round(x + w)}/${PPT_WIDTH}，下缘 ${Math.round(y + h)}/${PPT_HEIGHT}）`);
        }
      }

      // 类型特定检查
      if (el.elType === 'text') {
        if (el.text == null || String(el.text) === '') warnings.push(`${at}: text 为空`);
        const fontSize = el.fontSize || 18;
        if (fontSize < 10) warnings.push(`${at}: fontSize ${fontSize}px 过小（<10px 在 PPT 中难以阅读）`);
        if (el.width > 0 && el.height > 0 && el.text) {
          const needH = estimateWrappedHeight(el.text, fontSize, el.width, el.lineHeight || 1.25);
          if (needH > el.height * 1.15) {
            warnings.push(`${at}: 文本可能溢出（估算高 ${Math.round(needH)}px > 容器 ${el.height}px），建议缩减文案或加高容器`);
          }
        }
        // 对比度（与该位置实际承载它的形状填充色比较）
        const fill = typeof el.fill === 'string' ? el.fill : el.fill?.color;
        if (fill && el.opacity !== 0) {
          const under = effectiveBg(el, ei);
          const tLum = luminance(fill);
          const uLum = luminance(under);
          const contrast = (Math.max(tLum, uLum) + 0.05) / (Math.min(tLum, uLum) + 0.05);
          if (contrast < 1.6) warnings.push(`${at}: 文字色 ${fill} 与背景对比度过低（${contrast.toFixed(2)}）`);
        }
      }
      if (el.elType === 'image') {
        if (!el.path && !el.url && !el._data && !el.data && !el.prompt) {
          errors.push(`${at}: image 缺少 path/url/data（或用于 AI 生图的 prompt）`);
        }
        if ((el.width || 0) < 20 || (el.height || 0) < 20) warnings.push(`${at}: 图片尺寸过小`);
      }
      if (el.elType === 'image-svg' && !el.svgXml) errors.push(`${at}: image-svg 缺少 svgXml`);
      if (el.elType === 'chart') {
        if (!Array.isArray(el.data) || el.data.length === 0) errors.push(`${at}: chart 缺少 data 数组`);
        else el.data.forEach((s, i2) => {
          if (!Array.isArray(s.values) || s.values.length === 0) errors.push(`${at}: chart data[${i2}].values 为空`);
        });
      }
      if (el.elType === 'table') {
        if (!Array.isArray(el.rows) || el.rows.length === 0) errors.push(`${at}: table 缺少 rows`);
        else {
          const cols = el.rows[0]?.length || 0;
          el.rows.forEach((r, ri) => { if (r.length !== cols) warnings.push(`${at}: table 第${ri + 1}行列数(${r.length})与首行(${cols})不一致`); });
        }
      }
      // 颜色格式抽查
      for (const key of ['fill', 'stroke', 'lineColor', 'shadowColor']) {
        const v = el[key];
        if (typeof v === 'string' && v !== 'transparent' && !parseColor(v) && !v.startsWith('$')) {
          warnings.push(`${at}: ${key} 颜色值无法识别 "${v}"`);
        }
      }
    });
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
