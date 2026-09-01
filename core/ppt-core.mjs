/**
 * ai-ppt-gen 转换核心（Node 端）：PPT-DSL → PptxGenJS 可编辑 PPTX
 *
 * 源自 aippt 项目的 pptx-lite.js / utils.js，去除硬编码（URL 前缀、主题色、字体缩放），
 * 增加：主题令牌解析、图片异步预取（URL/本地/base64 统一为 data URI）、校验钩子、
 * 渐变填充、表格元素、幻灯片背景、演讲者备注。
 *
 * 画布约定：1280 × 720 px（16:9）→ PPT LAYOUT_WIDE 13.333 × 7.5 inch（96 DPI）
 * 字体换算：pptx pt = px × fontScale（默认 0.667，即原项目 px/1.5 经验值，
 *   视觉等大是 0.75；0.667 为中文排版留出约 11% 的行高余量，防止 PPT 中溢出）
 */

export const PPT_WIDTH = 1280;
export const PPT_HEIGHT = 720;
export const INCH_W = 13.333;
export const INCH_H = 7.5;

export const DEFAULT_FONT_SCALE = 2 / 3; // px → pt（1280px 画布 → 960pt 宽，经验防溢出值）

const PX2INCH = INCH_W / PPT_WIDTH; // ≈ 0.010416

export function pxToInch(px) {
  return Number((px * PX2INCH).toFixed(4));
}

/* ============================== 颜色工具 ============================== */

export function normalizeHex(c) {
  if (c == null) return null;
  let hex = String(c).trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split('').map(ch => ch + ch).join('');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return hex.toUpperCase(); // RRGGBBAA
  return null;
}

/** #RRGGBB / #RRGGBBAA / rgb()/rgba()/命名色 → { color: 'RRGGBB', transparency } */
export function parseColor(input) {
  if (input == null) return null;
  if (typeof input === 'object') {
    // 已是 pptxgenjs fill 形式 { color, transparency }
    if (input.color) {
      const p = parseColor(input.color);
      if (!p) return null;
      return { color: p.color, transparency: input.transparency ?? p.transparency };
    }
    return null;
  }
  let s = String(input).trim();
  const rgba = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (rgba) {
    const hex = [rgba[1], rgba[2], rgba[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    const alpha = rgba[4] != null ? Number(rgba[4]) : 1;
    return { color: hex, transparency: Math.round((1 - alpha) * 100) };
  }
  const named = { white: 'FFFFFF', black: '000000', red: 'FF0000', green: '008000', blue: '0000FF', transparent: null };
  if (named[s.toLowerCase()] === null) return null;
  if (named[s.toLowerCase()]) return { color: named[s.toLowerCase()], transparency: 0 };
  const hex = normalizeHex(s);
  if (!hex) return null;
  if (hex.length === 8) {
    const alpha = parseInt(hex.slice(6), 16) / 255;
    return { color: hex.slice(0, 6), transparency: Math.round((1 - alpha) * 100) };
  }
  return { color: hex, transparency: 0 };
}

/** 由主色生成浅填充色（HSL 提亮），level: 1略浅 2明显浅 3极浅 */
export function lighten(hexColor, level = 2) {
  const p = parseColor(hexColor);
  if (!p) return 'F1F5F9';
  const r = parseInt(p.color.slice(0, 2), 16) / 255;
  const g = parseInt(p.color.slice(2, 4), 16) / 255;
  const b = parseInt(p.color.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const cfg = { 1: [0.7, 0.4], 2: [0.35, 0.75], 3: [0.25, 0.88] }[level] || [0.35, 0.75];
  const ns = Math.max(s * cfg[0], 0.05);
  const nl = l + (1 - l) * cfg[1];
  const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns;
  const pp = 2 * nl - q;
  const hue2rgb = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return pp + (q - pp) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return pp + (q - pp) * (2 / 3 - t) * 6;
    return pp;
  };
  const to2 = v => Math.round(hue2rgb(v) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `${to2(h + 1 / 3)}${to2(h)}${to2(h - 1 / 3)}`;
}

/* ============================== 主题系统 ============================== */

export const BUILTIN_THEMES = {
  default: { palette: ['#4A90E2', '#6CC215', '#31AB78', '#F5A623', '#9C27B0', '#A86900', '#00BCD4', '#3B7500'], background: '#FFFFFF', text: '#111111', textSecondary: '#444444' },
  // 内置模版：藏青商务简报风（墨青 × 机械橙）。使用方式：theme: "navy-brief"
  'navy-brief': {
    palette: ['#0C1B2E', '#F26B21', '#4A7BA6', '#8FA3D9', '#C9CFDA', '#667085'],
    background: '#F7F6F3', text: '#17233B', textSecondary: '#667085',
    primary: '#0C1B2E', accent: '#F26B21', fontFamily: 'Microsoft YaHei',
  },
};

/**
 * 解析 deck 主题：deck.theme 可为字符串（内置主题名）或对象。
 * 返回统一主题对象，元素中的颜色令牌（$primary/$accent/$bg/$text/$text2/$1..$9）由 resolveTokens 替换。
 */
export function resolveTheme(deckTheme) {
  let base = BUILTIN_THEMES.default;
  let custom = {};
  if (typeof deckTheme === 'string') {
    base = BUILTIN_THEMES[deckTheme] || BUILTIN_THEMES.default;
  } else if (deckTheme && typeof deckTheme === 'object') {
    if (deckTheme.extends && BUILTIN_THEMES[deckTheme.extends]) base = BUILTIN_THEMES[deckTheme.extends];
    custom = deckTheme;
  }
  const theme = {
    name: typeof deckTheme === 'string' ? deckTheme : (custom.name || 'custom'),
    palette: (custom.palette || base.palette || BUILTIN_THEMES.default.palette).map(c => parseColor(c)?.color || c),
    background: parseColor(custom.background || base.background || '#FFFFFF')?.color || 'FFFFFF',
    primary: parseColor(custom.primary || custom.palette?.[0] || base.palette[0])?.color || '4A90E2',
    accent: parseColor(custom.accent || custom.palette?.[2] || base.palette[2] || base.palette[0])?.color || '31AB78',
    text: parseColor(custom.text || base.text || '#111111')?.color || '111111',
    textSecondary: parseColor(custom.textSecondary || base.textSecondary || '#444444')?.color || '444444',
    fontFamily: custom.fontFamily || base.fontFamily || '',
    fontScale: typeof custom.fontScale === 'number' ? custom.fontScale : DEFAULT_FONT_SCALE,
  };
  return theme;
}

/** 深拷贝并把字符串颜色值中的 $令牌 替换为主题色 */
export function resolveTokens(obj, theme) {
  const map = {
    $primary: theme.primary, $accent: theme.accent, $bg: theme.background,
    $text: theme.text, $text2: theme.textSecondary, $white: 'FFFFFF', $black: '000000',
  };
  theme.palette.forEach((c, i) => { map['$' + (i + 1)] = c; });
  const walk = v => {
    if (typeof v === 'string') {
      if (map[v]) return '#' + map[v];
      if (v.startsWith('$light:')) { // $light:$primary → 主色浅填充
        const key = v.slice(7);
        const c = map[key] || parseColor(key)?.color;
        if (c) return '#' + lighten(c, 2);
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return walk(obj);
}

/* ============================== 元素转换 ============================== */

function convertShadow(elop) {
  const has = elop.shadowColor || elop.shadowBlur || elop.shadow;
  if (!has) return {};
  if (elop.shadow && typeof elop.shadow === 'object' && elop.shadow.type) return { shadow: elop.shadow };
  let shadowColor = elop.shadowColor || '#000000';
  let shadowOpacity = elop.shadowOpacity ?? 0.3;
  const parsed = parseColor(shadowColor);
  if (parsed) {
    shadowColor = parsed.color;
    if (parsed.transparency) shadowOpacity = 1 - parsed.transparency / 100;
  }
  let offsetX = 0, offsetY = 4;
  if (elop.shadowOffset && typeof elop.shadowOffset === 'object') {
    offsetX = elop.shadowOffset.x || 0;
    offsetY = elop.shadowOffset.y ?? 4;
  } else if (typeof elop.shadowOffset === 'number') {
    offsetY = elop.shadowOffset;
  }
  if (elop.shadowOffsetX !== undefined) offsetX = elop.shadowOffsetX;
  if (elop.shadowOffsetY !== undefined) offsetY = elop.shadowOffsetY;
  const offset = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
  let angle = offset > 0 ? (Math.atan2(offsetY, offsetX) * 180 / Math.PI) : 45;
  if (angle < 0) angle += 360;
  return {
    shadow: {
      type: elop.shadowType || 'outer',
      blur: elop.shadowBlur || 8,
      offset: offset || 4,
      angle: Math.round(angle),
      color: shadowColor,
      opacity: Math.min(1, Math.max(0, shadowOpacity)),
    },
  };
}

function convertFill(elop) {
  const out = {};
  const opacity = elop.opacity;
  if (elop.fill && typeof elop.fill === 'object' && elop.fill.type === 'gradient' && Array.isArray(elop.fill.stops)) {
    // 渐变：pptxgenjs 不直接支持任意渐变，用主 stop 近似（可编辑性优先）
    const first = elop.fill.stops[0];
    const p = parseColor(first?.color);
    if (p) out.fill = { color: p.color, transparency: opacity != null ? Math.round((1 - opacity) * 100) : p.transparency };
    return out;
  }
  const p = parseColor(elop.fill);
  if (p) {
    out.fill = { color: p.color };
    const t = opacity != null ? Math.round((1 - opacity) * 100) : p.transparency;
    if (t) out.fill.transparency = t;
  } else if (opacity != null && opacity < 1) {
    // 无填充但带透明度 → 透明填充
    out.fill = { color: '000000', transparency: 100 };
  }
  return out;
}

function convertStroke(elop) {
  const colorRaw = elop.stroke ?? elop.lineColor;
  if (colorRaw == null && elop.strokeWidth == null && elop.lineWidth == null) return {};
  const p = parseColor(colorRaw || '#000000');
  if (!p) return {};
  const line = { color: p.color, width: elop.strokeWidth ?? elop.lineWidth ?? 2 };
  if (p.transparency) line.transparency = p.transparency;
  const dash = elop.dashType || elop.dash;
  if (dash === 'dash' || dash === true || (Array.isArray(dash) && dash.length)) line.dashType = 'dash';
  if (elop.lineEndArrowType) line.endArrowType = elop.lineEndArrowType;
  if (elop.lineBeginArrowType) line.beginArrowType = elop.lineBeginArrowType;
  return { line };
}

/** 通用几何/样式字段转换：px → inch，fontSize px → pt */
function baseOptions(elop, theme) {
  const opt = {};
  if (typeof elop.x === 'number') opt.x = pxToInch(elop.x);
  if (typeof elop.y === 'number') opt.y = pxToInch(elop.y);
  const w = elop.width ?? elop.w;
  const h = elop.height ?? elop.h;
  if (typeof w === 'number') opt.w = pxToInch(w);
  if (typeof h === 'number') opt.h = pxToInch(h);
  if (elop.rotate != null || elop.rotation != null) opt.rotate = elop.rotate ?? elop.rotation;
  if (elop.flipH) opt.flipH = true;
  if (elop.flipV) opt.flipV = true;
  const pad = elop.padding ?? elop.inset;
  if (typeof pad === 'number') opt.margin = Math.round(pad * 0.75 * 10) / 10; // margin 单位为 pt：px × 0.75（96dpi）
  Object.assign(opt, convertFill(elop), convertStroke(elop), convertShadow(elop));
  return normalizeRect(opt);
}

/**
 * OOXML 不允许 <a:ext> 负尺寸：负宽/高必须换算为正尺寸 + flipH/flipV，
 * 否则 PowerPoint 打开时提示"内容有问题"并要求修复。
 * 几何最终确定后（含 pointArr 派生的 w/h）都要调用一次。
 */
function normalizeRect(opt) {
  if (typeof opt.w === 'number' && opt.w < 0) {
    opt.x = (opt.x || 0) + opt.w;
    opt.w = -opt.w;
    opt.flipH = !opt.flipH;
  }
  if (typeof opt.h === 'number' && opt.h < 0) {
    opt.y = (opt.y || 0) + opt.h;
    opt.h = -opt.h;
    opt.flipV = !opt.flipV;
  }
  return opt;
}

function textOptions(elop, theme) {
  const opt = baseOptions(elop, theme);
  // 关键：text 元素的 fill 是"字体颜色"（Konva 约定），不能当作文本框填充，
  // 否则会出现"白底框+白字"的隐形文字。框底色需用 bgFill 显式指定。
  delete opt.fill;
  if (elop.bgFill != null) {
    const bf = parseColor(elop.bgFill);
    if (bf) opt.fill = { color: bf.color, ...(bf.transparency ? { transparency: bf.transparency } : {}) };
  }
  const fontScale = theme.fontScale;
  if (typeof elop.fontSize === 'number') opt.fontSize = Math.max(6, Math.round(elop.fontSize * fontScale * 10) / 10);
  const fontStyle = String(elop.fontStyle || '');
  if (elop.bold || fontStyle.includes('bold')) opt.bold = true;
  if (elop.italic || fontStyle.includes('italic')) opt.italic = true;
  const color = parseColor(elop.fill ?? elop.color);
  if (color) {
    opt.color = color.color;
    if (color.transparency) opt.transparency = color.transparency;
  }
  if (elop.opacity != null && elop.opacity < 1) opt.transparency = Math.round((1 - elop.opacity) * 100);
  if (elop.fontFamily || theme.fontFamily) opt.fontFace = String(elop.fontFamily || theme.fontFamily).split(',')[0].trim().replace(/^["']|["']$/g, '');
  const alignMap = { left: 'left', center: 'center', right: 'right', justify: 'justify' };
  if (elop.align && alignMap[elop.align]) opt.align = alignMap[elop.align];
  const valignMap = { top: 'top', middle: 'middle', center: 'middle', bottom: 'bottom' };
  const v = elop.verticalAlign ?? elop.valign;
  if (v && valignMap[v]) opt.valign = valignMap[v];
  if (typeof elop.lineHeight === 'number') opt.lineSpacingMultiple = Math.min(3, Math.max(0.5, elop.lineHeight));
  if (typeof elop.letterSpacing === 'number') opt.charSpacing = Math.max(0, Math.round(elop.letterSpacing * fontScale));
  if (elop.underline) opt.underline = { style: 'sng' };
  return opt;
}

/** 把单个 elop 应用到 pptxgenjs slide（同步部分；image 需先经 prefetchImages 解析为 data） */
export function applyElement(pptx, slide, elop, theme) {
  const t = elop.elType;
  if (t === 'text') {
    const opt = textOptions(elop, theme);
    slide.addText(String(elop.text ?? ''), opt);
  } else if (t === 'image') {
    const opt = baseOptions(elop, theme);
    if (elop._data) opt.data = elop._data;
    else if (elop.path || elop.url) opt.path = elop.path || elop.url; // 兜底：未预取时让 pptxgenjs 自行处理
    else return;
    if (elop.sizing && typeof elop.sizing === 'object') {
      opt.sizing = { type: elop.sizing.type === 'contain' ? 'contain' : 'cover' };
      if (typeof elop.sizing.w === 'number') opt.sizing.w = pxToInch(elop.sizing.w);
      if (typeof elop.sizing.h === 'number') opt.sizing.h = pxToInch(elop.sizing.h);
    }
    if (elop.rounding || elop.cornerRadius) opt.rounding = true;
    slide.addImage(opt);
  } else if (t === 'image-svg') {
    const opt = baseOptions(elop, theme);
    const svg = elop.svgXml || '';
    opt.data = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf-8').toString('base64');
    slide.addImage(opt);
  } else if (t === 'shape-rect') {
    const opt = baseOptions(elop, theme);
    const r = elop.cornerRadius ?? elop.rectRadius;
    if (r && r > 0) {
      opt.rectRadius = pxToInch(r);
      slide.addShape(pptx.ShapeType.roundRect, opt);
    } else {
      slide.addShape(pptx.ShapeType.rect, opt);
    }
  } else if (t === 'shape-circle') {
    const opt = baseOptions(elop, theme);
    // DSL 约定：shape-circle 的 x/y 为圆心（Konva 习惯）
    if (typeof elop.x === 'number') opt.x = pxToInch(elop.x - (elop.width ?? elop.radius * 2 ?? 0) / 2);
    if (typeof elop.y === 'number') opt.y = pxToInch(elop.y - (elop.height ?? elop.radius * 2 ?? 0) / 2);
    slide.addShape(pptx.ShapeType.ellipse, opt);
  } else if (t === 'shape-line' || t === 'shape-arrow') {
    const opt = baseOptions(elop, theme);
    if (Array.isArray(elop.pointArr) && elop.pointArr.length >= 2) {
      opt.x = pxToInch(elop.pointArr[0].x);
      opt.y = pxToInch(elop.pointArr[0].y);
      opt.w = pxToInch(elop.pointArr[1].x - elop.pointArr[0].x);
      opt.h = pxToInch(elop.pointArr[1].y - elop.pointArr[0].y);
    }
    normalizeRect(opt); // 线段向左上绘制时 w/h 为负，OOXML 需正尺寸 + flip
    if (t === 'shape-arrow') {
      opt.line = opt.line || {};
      opt.line.endArrowType = opt.line.endArrowType || 'stealth';
    }
    slide.addShape(pptx.ShapeType.line, opt);
  } else if (t === 'shape-path' || t === 'curve-quadratic') {
    const opt = baseOptions(elop, theme);
    if (Array.isArray(elop.pointArr)) {
      // 二次曲线点列 → CUSTOM_GEOMETRY
      const points = elop.pointArr.map(p => {
        const q = { x: pxToInch(p.x), y: pxToInch(p.y) };
        if (p.moveTo) q.moveTo = true;
        if (p.controlPoint) q.curve = { type: 'quadratic', x1: pxToInch(p.controlPoint.x), y1: pxToInch(p.controlPoint.y) };
        if (p.curve) {
          const c = { ...p.curve };
          for (const k of ['hR', 'wR', 'x1', 'y1', 'x2', 'y2']) { // 曲线控制点/圆弧半径同为 px，需换算
            if (typeof c[k] === 'number') c[k] = pxToInch(c[k]);
          }
          q.curve = c;
        }
        return q;
      });
      opt.points = points;
      if (elop.closePath !== false && elop.elType === 'shape-path') opt.closePath = true;
      slide.addShape(pptx.shapes.CUSTOM_GEOMETRY, opt); // 注意：ShapeType.customGeometry 是 undefined，必须用 shapes.CUSTOM_GEOMETRY
    } else if (elop.data || elop.svgPath) {
      // SVG path 字符串：pptxgenjs 不支持直接 path，退化为提示
      throw new Error(`shape-path 的 SVG data 需预转为 pointArr（或改用 image-svg）`);
    }
  } else if (t === 'chart') {
    const typeMap = { bar: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut', area: 'area', radar: 'radar', scatter: 'scatter' };
    const chartType = pptx.ChartType[typeMap[elop.chartType] || 'bar'];
    const opt = baseOptions(elop, theme);
    if (Array.isArray(elop.chartColors) && elop.chartColors.length) {
      opt.chartColors = elop.chartColors.map(c => parseColor(c)?.color).filter(Boolean);
    } else {
      opt.chartColors = theme.palette.slice(0, 6);
    }
    if (elop.showLegend != null) opt.showLegend = elop.showLegend;
    if (elop.showTitle && elop.chartTitle) { opt.showTitle = true; opt.chartTitle = elop.chartTitle; }
    opt.showValue = elop.showValue ?? false;
    const data = (elop.data || []).map(s => ({
      name: s.name || '',
      labels: s.labels || elop.labels || [],
      values: s.values || [],
    }));
    slide.addChart(chartType, data, opt);
  } else if (t === 'table') {
    const opt = baseOptions(elop, theme);
    opt.fontSize = Math.max(6, Math.round((elop.fontSize || 16) * theme.fontScale * 10) / 10);
    if (theme.fontFamily || elop.fontFamily) opt.fontFace = String(elop.fontFamily || theme.fontFamily).split(',')[0].trim();
    const hd = elop.header || {};
    const rows = (elop.rows || []).map((row, ri) => row.map(cell => {
      const isHd = hd.enabled !== false && ri === 0;
      const cellColor = parseColor(isHd ? (hd.fill || '#' + theme.primary) : (ri % 2 && elop.stripeColor ? elop.stripeColor : null));
      return {
        text: String(cell ?? ''),
        options: {
          bold: isHd && hd.bold !== false,
          color: isHd ? (parseColor(hd.color)?.color || 'FFFFFF') : (parseColor(elop.color)?.color || theme.text),
          fill: cellColor ? { color: cellColor.color } : undefined,
          align: elop.align || 'left',
          valign: 'middle',
        },
      };
    }));
    slide.addTable(rows, opt);
  } else {
    throw new Error(`未知 elType: ${t}`);
  }
}

/* ============================== 图片预取 ============================== */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

async function fetchAsDataUri(src, baseDir) {
  if (src.startsWith('data:')) return src;
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}: ${src}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }
  // 本地文件：相对路径基于 deck JSON 所在目录
  const { resolve } = await import('node:path');
  const filePath = baseDir ? resolve(baseDir, src) : src;
  const buf = await readFile(filePath);
  const mime = MIME[extname(filePath).toLowerCase()] || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** 遍历 deck，把所有 image 元素的 path/url 预取为 _data（base64 data URI） */
export async function prefetchImages(deck, { baseDir = '', logger = console } = {}) {
  const tasks = [];
  for (const slide of deck.slides || []) {
    for (const el of slide.elements || []) {
      if (el.elType === 'image' && !el._data) {
        const src = el.path || el.url;
        if (!src) continue;
        tasks.push(
          fetchAsDataUri(src, baseDir)
            .then(data => { el._data = data; })
            .catch(err => { logger.warn(`[image] ${src} → ${err.message}（该图将被跳过）`); el._error = err.message; })
        );
      }
    }
  }
  await Promise.all(tasks);
}

/* ============================== 主构建入口 ============================== */

/**
 * 由 deck JSON 构建 PptxGenJS 实例。
 * @param {object} PptxGenJS pptxgenjs 模块（import 后传入，便于 CJS/ESM 兼容）
 * @param {object} deck { meta?, theme?, slides: [{ elements: [], notes?, background? }] }
 * @param {object} opts { prefetch: bool, baseDir, logger }
 */
export async function buildPresentation(PptxGenJS, deck, opts = {}) {
  const logger = opts.logger || console;
  const theme = resolveTheme(deck.theme);
  const resolved = resolveTokens(deck, theme);
  const { expandConnectors } = await import('./connectors.mjs');
  expandConnectors(resolved); // 连接线/弧形宏 → 标准元素（curve-quadratic / shape-path）
  if (opts.prefetch !== false) await prefetchImages(resolved, { baseDir: opts.baseDir, logger });

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE_1280', width: INCH_W, height: INCH_H });
  pptx.layout = 'WIDE_1280';
  if (deck.meta?.title) pptx.title = deck.meta.title;
  if (deck.meta?.author) pptx.author = deck.meta.author;

  for (const slideSpec of resolved.slides || []) {
    const slide = pptx.addSlide();
    const bg = slideSpec.background || theme.background;
    const bgParsed = parseColor(bg);
    if (bgParsed) slide.background = { color: bgParsed.color };
    else if (typeof bg === 'string' && (bg.startsWith('data:') || /\.(png|jpe?g|gif|webp)$/i.test(bg))) {
      slide.background = { path: bg };
    }
    for (const elop of slideSpec.elements || []) {
      if (elop._error) continue;
      try {
        applyElement(pptx, slide, elop, theme);
      } catch (err) {
        logger.warn(`[element] ${elop.elType} 渲染失败: ${err.message}`);
      }
    }
    if (slideSpec.notes || slideSpec.speakerNotes) slide.addNotes(slideSpec.notes || slideSpec.speakerNotes);
  }
  return { pptx, theme };
}
