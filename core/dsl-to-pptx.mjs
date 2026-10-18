/**
 * ppt-gen 纯转换层：PPT-DSL → PptxGenJS 调用（无任何 Node/浏览器专有 API）
 *
 * Node 端（tools/build_pptx.mjs）与浏览器端（预览页的"导出 PPTX"按钮）共用同一份实现，
 * 保证两端使用同一转换语义；字体度量与原生图表外观仍可能因渲染器不同而有小幅差异。
 * Node 专有的图片预取/文件 IO 在 core/ppt-core.mjs。
 *
 * 画布约定：1280 × 720 px（16:9）→ PPT 13.333 × 7.5 inch（96 DPI）
 * 字体换算：pt = px × fontScale（默认 0.75，视觉等大；旧稿可显式设为 2/3）
 */

import { buildShape, isShapeElement, resolveShape } from './shape-geometry.mjs';
import { resolveDash, resolveArrowHead, resolveWrap, DEFAULT_LINE_COLOR, LINE_ELEMENT_TYPES } from './style-map.mjs';
import { normalizeChartOptions } from './chart-options.mjs';

export const PPT_WIDTH = 1280;
export const PPT_HEIGHT = 720;
export const INCH_W = 13.333;
export const INCH_H = 7.5;
export const DEFAULT_FONT_SCALE = 0.75;

const PX2INCH = INCH_W / PPT_WIDTH;
/** 描边宽度/阴影的 px→pt（画布 1280px = 960pt，视觉等比缩放 0.75） */
const PX2PT = 0.75;
/** OOXML `a:bodyPr/@vert` 的合法取值（与 pptxgenjs 的 ITextOpts.vert 一致） */
export const TEXT_VERT_VALUES = ['eaVert', 'horz', 'mongolianVert', 'vert', 'vert270', 'wordArtVert', 'wordArtVertRtl'];
export function pxToInch(px) {
  return Number((px * PX2INCH).toFixed(4));
}
export function pxToPt(px) {
  return Number((px * PX2PT).toFixed(2));
}

/**
 * 图片 sizing 统一解析为类型名。
 *
 * 历史上存在两种等价写法，都必须支持，否则 `{type:'contain'}` 会被包装成
 * `{type:{type:'contain'}}`，比对失败后静默退化为 cover 裁切：
 *   - 字符串：`sizing: "contain"`（raw primitive、layout-dsl.md）
 *   - 对象：  `sizing: { type: "contain" }`（dsl-schema.md 的示例）
 * 同时容忍已双层包装的输入，避免旧编译产物或手工 primitive 静默裁切。
 */
export function imageSizing(value) {
  let type = value;
  while (type && typeof type === 'object') type = type.type;
  if (type === 'contain') return 'contain';
  if (type === 'crop') return 'crop';
  return 'cover';
}

/** 跨端 UTF-8 → base64（Node 用 Buffer，浏览器用 TextEncoder+btoa） */
function utf8ToBase64(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf-8').toString('base64');
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* ============================== 颜色工具 ============================== */

export function normalizeHex(c) {
  if (c == null) return null;
  let hex = String(c).trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split('').map(ch => ch + ch).join('');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return hex.toUpperCase();
  return null;
}

/** #RGB/#RRGGBB/#RRGGBBAA/rgb()/rgba()/命名色 → { color: 'RRGGBB', transparency } */
export function parseColor(input) {
  if (input == null) return null;
  if (typeof input === 'object') {
    if (input.color) {
      const p = parseColor(input.color);
      if (!p) return null;
      return { color: p.color, transparency: input.transparency ?? p.transparency };
    }
    return null;
  }
  const s = String(input).trim();
  const rgba = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (rgba) {
    const hex = [rgba[1], rgba[2], rgba[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    const alpha = rgba[4] != null ? Number(rgba[4]) : 1;
    return { color: hex, transparency: Math.round((1 - alpha) * 100) };
  }
  const named = { white: 'FFFFFF', black: '000000', red: 'FF0000', green: '008000', blue: '0000FF', transparent: null };
  if (s.toLowerCase() in named) {
    const v = named[s.toLowerCase()];
    return v ? { color: v, transparency: 0 } : null;
  }
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
  // navy-brief 是 navy-report 的兼容旧名称；新文件统一使用 navy-report。
  'navy-brief': {
    palette: ['#0C1B2E', '#F26B21', '#4A7BA6', '#8FA3D9', '#C9CFDA', '#667085'],
    background: '#F7F6F3', text: '#17233B', textSecondary: '#667085',
    primary: '#0C1B2E', accent: '#F26B21', accentText: '#B83F08', fontFamily: 'Microsoft YaHei',
    surface: '#FFFFFF', surfaceAlt: '#EEF1F5', border: '#E8E4DC', radius: 14,
    pagePadding: 60, titleMarker: 'bar', footer: true,
  },
  // 完整样式预设。旧主题名继续可用；新预设除色板外还携带版式表面、圆角和页脚令牌。
  'navy-report': {
    palette: ['#0C1B2E', '#F26B21', '#4A7BA6', '#8FA3D9', '#C9CFDA', '#667085'],
    background: '#F7F6F3', text: '#17233B', textSecondary: '#667085',
    primary: '#0C1B2E', accent: '#F26B21', accentText: '#B83F08', fontFamily: 'Microsoft YaHei',
    surface: '#FFFFFF', surfaceAlt: '#EEF1F5', border: '#E8E4DC', radius: 14,
    pagePadding: 60, titleMarker: 'bar', footer: true,
  },
  'clean-minimal': {
    palette: ['#111827', '#2563EB', '#60A5FA', '#94A3B8', '#CBD5E1', '#E2E8F0'],
    background: '#FFFFFF', text: '#111827', textSecondary: '#64748B',
    primary: '#111827', accent: '#2563EB', fontFamily: 'Microsoft YaHei',
    surface: '#FFFFFF', surfaceAlt: '#F8FAFC', border: '#E2E8F0', radius: 10,
    pagePadding: 64, titleMarker: 'line', footer: true,
  },
  'tech-dark': {
    palette: ['#07111F', '#22D3EE', '#3B82F6', '#6366F1', '#14B8A6', '#94A3B8'],
    background: '#07111F', text: '#F8FAFC', textSecondary: '#A8B4C7',
    primary: '#07111F', accent: '#22D3EE', onAccent: '#06202B', fontFamily: 'Microsoft YaHei',
    surface: '#102033', surfaceAlt: '#162A40', border: '#274158', radius: 16,
    pagePadding: 60, titleMarker: 'line', footer: true,
  },
  'warm-editorial': {
    palette: ['#6B2D2D', '#D97757', '#B68A5A', '#9A826A', '#D9C7B8', '#7A6A5E'],
    background: '#FBF6EF', text: '#342923', textSecondary: '#76675D',
    primary: '#6B2D2D', accent: '#D97757', accentText: '#963C2C', fontFamily: 'Microsoft YaHei',
    surface: '#FFFDFC', surfaceAlt: '#F3E8DC', border: '#E4D4C6', radius: 8,
    pagePadding: 68, titleMarker: 'line', footer: true,
  },
  'data-dashboard': {
    palette: ['#123B5D', '#0E7490', '#22A06B', '#D97706', '#7C3AED', '#94A3B8'],
    background: '#F3F6F9', text: '#122230', textSecondary: '#5B6B78',
    primary: '#123B5D', accent: '#0E7490', fontFamily: 'Microsoft YaHei',
    surface: '#FFFFFF', surfaceAlt: '#EAF0F5', border: '#D8E1E8', radius: 12,
    pagePadding: 48, titleMarker: 'bar', footer: true,
  },
  // 源自 PptxGenJS-Preview utils.js 的经典主题色板（schema 示例使用的 business 也在此注册）
  business: {
    palette: ['#1E3A5F', '#2C5282', '#3182CE', '#C9A96E', '#D4AF37', '#B7943C', '#2D3748', '#4A5568', '#718096'],
    background: '#F7F6F3', text: '#17233B', textSecondary: '#667085',
    primary: '#1E3A5F', accent: '#C9A96E', fontFamily: 'Microsoft YaHei',
  },
  tech: {
    palette: ['#0F172A', '#1E293B', '#06B6D4', '#22D3EE', '#67E8F9', '#BAE6FD', '#3B82F6', '#6366F1', '#8B5CF6'],
    background: '#F5F7FA', text: '#0F172A', textSecondary: '#475569',
    primary: '#0F172A', accent: '#06B6D4', fontFamily: 'Microsoft YaHei',
  },
  health: {
    palette: ['#166534', '#15803D', '#10B981', '#34D399', '#6EE7B7', '#059669', '#3B82F6', '#0EA5E9', '#38BDF8'],
    background: '#F6F9F6', text: '#10241A', textSecondary: '#475569',
    primary: '#166534', accent: '#10B981', fontFamily: 'Microsoft YaHei',
  },
  education: {
    palette: ['#C2410C', '#EA580C', '#F97316', '#FB923C', '#84CC16', '#A3E635', '#CA8A04', '#EAB308', '#FACC15'],
    background: '#FFF8F0', text: '#2B1A0E', textSecondary: '#78716C',
    primary: '#C2410C', accent: '#F97316', fontFamily: 'Microsoft YaHei',
  },
  nature: {
    palette: ['#14532D', '#166534', '#22C55E', '#4ADE80', '#92400E', '#B45309', '#D97706', '#F59E0B', '#FBBF24'],
    background: '#F4F8F4', text: '#14291D', textSecondary: '#57534E',
    primary: '#14532D', accent: '#D97706', fontFamily: 'Microsoft YaHei',
  },
  creative: {
    palette: ['#581C87', '#7C3AED', '#8B5CF6', '#A78BFA', '#C084FC', '#EC4899', '#F472B6', '#FB7185', '#FDA4AF'],
    background: '#FBF7FD', text: '#241230', textSecondary: '#52525B',
    primary: '#581C87', accent: '#EC4899', fontFamily: 'Microsoft YaHei',
  },
  minimal: {
    palette: ['#18181B', '#27272A', '#3F3F46', '#52525B', '#71717A', '#A1A1AA', '#D4D4D8', '#E4E4E7', '#F4F4F5'],
    background: '#FAFAFA', text: '#18181B', textSecondary: '#71717A',
    primary: '#18181B', accent: '#52525B', fontFamily: 'Microsoft YaHei',
  },
  warm: {
    palette: ['#7F1D1D', '#991B1B', '#B91C1C', '#DC2626', '#EF4444', '#F87171', '#FCA5A5', '#FECACA', '#FEE2E2'],
    background: '#FFF7F5', text: '#2A0E0E', textSecondary: '#78716C',
    primary: '#7F1D1D', accent: '#DC2626', fontFamily: 'Microsoft YaHei',
  },
  dark: {
    palette: ['#0C0A09', '#1C1917', '#292524', '#44403C', '#57534E', '#78716C', '#A8A29E', '#D6D3D1', '#E7E5E4'],
    background: '#F5F5F4', text: '#0C0A09', textSecondary: '#57534E',
    primary: '#0C0A09', accent: '#78716C', fontFamily: 'Microsoft YaHei',
  },
};

/** 解析 deck 主题：deck.theme 可为字符串（内置主题名）或对象（可 extends 内置主题） */
export function resolveTheme(deckTheme) {
  let base = BUILTIN_THEMES.default;
  let custom = {};
  if (typeof deckTheme === 'string') {
    base = BUILTIN_THEMES[deckTheme] || BUILTIN_THEMES.default;
  } else if (deckTheme && typeof deckTheme === 'object') {
    if (deckTheme.extends && BUILTIN_THEMES[deckTheme.extends]) base = BUILTIN_THEMES[deckTheme.extends];
    custom = deckTheme;
  }
  return {
    name: typeof deckTheme === 'string' ? deckTheme : (custom.name || 'custom'),
    palette: (custom.palette || base.palette || BUILTIN_THEMES.default.palette).map(c => parseColor(c)?.color || c),
    background: parseColor(custom.background || base.background || '#FFFFFF')?.color || 'FFFFFF',
    primary: parseColor(custom.primary || custom.palette?.[0] || base.primary || base.palette[0])?.color || '4A90E2',
    accent: parseColor(custom.accent || custom.palette?.[2] || base.accent || base.palette[2] || base.palette[0])?.color || '31AB78',
    accentText: parseColor(custom.accentText || custom.accent || base.accentText || base.accent || '#2563EB')?.color || '2563EB',
    onAccent: parseColor(custom.onAccent || base.onAccent || '#FFFFFF')?.color || 'FFFFFF',
    text: parseColor(custom.text || base.text || '#111111')?.color || '111111',
    textSecondary: parseColor(custom.textSecondary || base.textSecondary || '#444444')?.color || '444444',
    fontFamily: custom.fontFamily || base.fontFamily || '',
    fontScale: typeof custom.fontScale === 'number' ? custom.fontScale : DEFAULT_FONT_SCALE,
    surface: parseColor(custom.surface || base.surface || '#FFFFFF')?.color || 'FFFFFF',
    surfaceAlt: parseColor(custom.surfaceAlt || base.surfaceAlt || '#F1F5F9')?.color || 'F1F5F9',
    border: parseColor(custom.border || base.border || '#E2E8F0')?.color || 'E2E8F0',
    radius: Number.isFinite(custom.radius) ? custom.radius : (Number.isFinite(base.radius) ? base.radius : 12),
    pagePadding: Number.isFinite(custom.pagePadding) ? custom.pagePadding : (Number.isFinite(base.pagePadding) ? base.pagePadding : 60),
    titleMarker: custom.titleMarker || base.titleMarker || 'bar',
    footer: custom.footer ?? base.footer ?? true,
  };
}

/** 允许令牌替换的字段白名单（防止正文里恰好的 "$1"/"$primary" 字面量被误换成色值） */
const COLOR_KEYS = new Set(['fill', 'stroke', 'lineColor', 'shadowColor', 'bgFill', 'background', 'color', 'stripeColor', 'borderColor']);

/** 深拷贝并把颜色字段中的 $令牌 替换为主题色（只在白名单字段上解析） */
export function resolveTokens(obj, theme) {
  const map = {
    $primary: theme.primary, $accent: theme.accent, $accentText: theme.accentText, $onAccent: theme.onAccent,
    $surface: theme.surface, $surfaceAlt: theme.surfaceAlt, $border: theme.border, $bg: theme.background,
    $text: theme.text, $text2: theme.textSecondary, $white: 'FFFFFF', $black: '000000',
  };
  theme.palette.forEach((c, i) => { map['$' + (i + 1)] = c; });
  const resolve = v => {
    if (map[v]) return '#' + map[v];
    if (v.startsWith('$light:')) {
      const c = map[v.slice(7)] || parseColor(v.slice(7))?.color;
      if (c) return '#' + lighten(c, 2);
    }
    return v;
  };
  const walk = (v, key) => {
    if (typeof v === 'string') return COLOR_KEYS.has(key) ? resolve(v) : v;
    if (Array.isArray(v)) {
      // chartColors 这类"颜色数组"：数组项是字符串色值
      if (key === 'chartColors') return v.map(item => typeof item === 'string' ? resolve(item) : item);
      return v.map(item => walk(item, key));
    }
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k], k);
      return out;
    }
    return v;
  };
  return walk(obj, '');
}

/* ============================== 元素转换 ============================== */

/** One data contract for validation, Konva coordinates and native chart export. */
export function chartModel(elop) {
  const type = elop.chartType || 'bar';
  if (!['bar', 'line', 'area', 'pie', 'doughnut', 'radar', 'scatter'].includes(type)) throw new Error(`未知 chartType: ${type}`);
  if (!Array.isArray(elop.data) || !elop.data.length) throw new Error('chart.data 必须是非空数组');
  const series = elop.data.map((s, index) => {
    if (!s || !Array.isArray(s.values) || !s.values.length) throw new Error(`chart.data[${index}].values 必须是非空数组`);
    s.values.forEach((value, vi) => {
      if (type === 'scatter' ? !Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite) : !Number.isFinite(value)) {
        throw new Error(`chart.data[${index}].values[${vi}] 必须是${type === 'scatter' ? '[x,y] 有限数字对' : '有限数字'}`);
      }
    });
    return { name: String(s.name ?? ''), values: s.values, labels: s.labels || elop.labels };
  });
  const domain = values => {
    let min = Math.min(0, ...values), max = Math.max(0, ...values);
    if (min === max) max = min + 1;
    // Keep native value labels away from chart/category boundaries.
    if (min < 0) min *= 1.08;
    if (max > 0) max *= 1.08;
    return { min, max };
  };
  if (type === 'scatter') {
    // PptxGenJS shares one X column. Sparse Y columns retain different X sets,
    // duplicate X values and every original point without coercion or truncation.
    const xs = series.flatMap(s => s.values.map(p => p[0]));
    let offset = 0;
    const nativeData = [{ name: 'X', values: xs }, ...series.map(s => {
      const values = Array(xs.length).fill(null);
      s.values.forEach((point, i) => { values[offset + i] = point[1]; });
      offset += s.values.length;
      return { name: s.name, values };
    })];
    return { type, series, labels: [], nativeData, xDomain: domain(xs), yDomain: domain(series.flatMap(s => s.values.map(p => p[1]))) };
  }
  const count = series[0].values.length;
  const labels = series[0].labels ?? Array.from({ length: count }, (_, i) => String(i + 1));
  if (!Array.isArray(labels) || labels.length !== count) throw new Error('chart.labels 数量必须与 values 一致');
  for (const s of series) {
    if (s.values.length !== count || (s.labels && JSON.stringify(s.labels) !== JSON.stringify(labels))) throw new Error('chart 各系列必须使用相同分类标签和数量');
  }
  if (['pie', 'doughnut'].includes(type) && series.length !== 1) throw new Error(`${type} 仅支持一个数据系列；多个系列请拆成多个图表`);
  const values = series.flatMap(s => s.values);
  if (['pie', 'doughnut', 'radar'].includes(type) && values.some(v => v < 0)) throw new Error(`${type} 不支持负数，请选择柱状图或折线图`);
  if (['pie', 'doughnut'].includes(type) && !values.some(v => v > 0)) throw new Error(`${type} 合计必须大于 0`);

  // 堆叠柱的数值域必须按"每类累计"计算：单系列最大值 ≠ 堆叠后的高度。
  // 若沿用单系列最大值，堆叠总高会顶出坐标轴上限——预览会画到绘图区之外，PPTX 的轴范围也会不对。
  // 两个渲染器共用本函数，所以在这里统一修正。
  const grouping = (elop._chart && elop._chart.barGrouping) || elop.barGrouping || 'clustered';
  const stacked = type === 'bar' && (grouping === 'stacked' || grouping === 'percentStacked');
  const percentStacked = stacked && grouping === 'percentStacked';
  const nativeData = series.map(s => ({ name: s.name, labels, values: s.values }));
  if (percentStacked) {
    // 百分比堆叠的坐标轴按定义固定为 0–100，不加 8% 余量，两端因此一致
    return { type, series, labels, nativeData, stacked, percentStacked, grouping, yDomain: { min: 0, max: 100 } };
  }
  let domainValues = values;
  if (stacked) {
    const n = series[0].values.length;
    domainValues = Array.from({ length: n }, (_, i) =>
      series.reduce((a, s) => a + Math.max(0, Number(s.values[i]) || 0), 0));
  }
  return {
    type, series, labels, nativeData, stacked, percentStacked, grouping,
    yDomain: domain(domainValues),
  };
}

function combinedTransparency(color, opacity = 1) {
  return Math.round((1 - (1 - (color?.transparency || 0) / 100) * opacity) * 100);
}

function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

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
  const offset = pxToPt(Math.sqrt(offsetX * offsetX + offsetY * offsetY));
  let angle = offset > 0 ? (Math.atan2(offsetY, offsetX) * 180 / Math.PI) : 45;
  if (angle < 0) angle += 360;
  return {
    shadow: {
      type: elop.shadowType || 'outer',
      blur: pxToPt(elop.shadowBlur || 8),
      offset: offset || pxToPt(4),
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
    // 渐变：pptxgenjs 不直接支持任意渐变，用首 stop 近似（可编辑性优先；多 stop 时校验器会提示）
    const first = elop.fill.stops[0];
    const p = parseColor(first?.color);
    if (p) out.fill = { color: p.color, transparency: combinedTransparency(p, opacity) };
    return out;
  }
  const p = parseColor(elop.fill);
  if (p) {
    out.fill = { color: p.color };
    const t = combinedTransparency(p, opacity);
    if (t) out.fill.transparency = t;
  } else if (opacity != null && opacity < 1) {
    out.fill = { color: '000000', transparency: 100 };
  }
  return out;
}

function convertStroke(elop) {
  // 线条/连接线必须可见：缺色时补默认色，与预览使用同一个常量（未编译的 deck 也一致）
  const isLine = LINE_ELEMENT_TYPES.includes(elop.elType);
  const colorRaw = elop.stroke ?? elop.lineColor ?? (isLine ? DEFAULT_LINE_COLOR : null);
  const dash = resolveDash(elop.dashType ?? elop.dash);
  const hasArrow = elop.lineEndArrowType != null || elop.lineBeginArrowType != null;
  if (colorRaw == null && elop.strokeWidth == null && elop.lineWidth == null && !hasArrow) return {};
  const p = parseColor(colorRaw || '#000000');
  if (!p) return {};
  const line = { color: p.color, width: pxToPt(elop.strokeWidth ?? elop.lineWidth ?? 2) };
  line.transparency = combinedTransparency(p, elop.opacity);
  if (dash.pptx && dash.pptx !== 'solid') line.dashType = dash.pptx;
  const end = resolveArrowHead(elop.lineEndArrowType);
  const begin = resolveArrowHead(elop.lineBeginArrowType);
  // 未识别的箭头类型不静默丢弃：严格模式直接失败。
  if (elop.lineEndArrowType != null && end === null) throw new Error(`未知 lineEndArrowType: ${elop.lineEndArrowType}`);
  if (elop.lineBeginArrowType != null && begin === null) throw new Error(`未知 lineBeginArrowType: ${elop.lineBeginArrowType}`);
  if (end && end !== 'none') line.endArrowType = end;
  if (begin && begin !== 'none') line.beginArrowType = begin;
  return { line };
}

/**
 * OOXML 不允许 <a:ext> 负尺寸：负宽/高必须换算为正尺寸 + flipH/flipV，
 * 否则 PowerPoint 打开时提示"内容有问题"并要求修复。
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

/** 通用几何/样式字段转换：px → inch */
function baseOptions(elop) {
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
  if (typeof pad === 'number') opt.margin = Math.round(pad * 0.75 * 10) / 10; // margin 单位 pt：px × 0.75
  // 选择窗格可读性：默认用元素 id 作为对象名，便于在 PowerPoint 里定位对象。
  const objName = elop.objectName || elop.id;
  if (objName) opt.objectName = String(objName);
  if (elop.altText) opt.altText = String(elop.altText);
  if (elop.hyperlink && typeof elop.hyperlink === 'object') opt.hyperlink = elop.hyperlink;
  Object.assign(opt, convertFill(elop), convertStroke(elop), convertShadow(elop));
  return normalizeRect(opt);
}

function textOptions(elop, theme) {
  const opt = baseOptions(elop);
  // 关键：text 的 fill 是"字体颜色"（Konva 约定），不是文本框填充；框底色用 bgFill
  delete opt.fill;
  if (elop.bgFill != null) {
    const bf = parseColor(elop.bgFill);
    if (bf) opt.fill = { color: bf.color, transparency: combinedTransparency(bf, elop.bgOpacity) };
  }
  const fontScale = theme.fontScale;
  opt.fontSize = Math.round((elop.fontSize ?? 18) * fontScale * 10) / 10;
  opt.margin = opt.margin ?? 0;
  const fontStyle = String(elop.fontStyle || '');
  if (elop.bold || fontStyle.includes('bold')) opt.bold = true;
  if (elop.italic || fontStyle.includes('italic')) opt.italic = true;
  const color = parseColor(elop.fill ?? elop.color);
  if (color) {
    opt.color = color.color;
    opt.transparency = combinedTransparency(color, elop.opacity);
  }
  if (elop.fontFamily || theme.fontFamily) opt.fontFace = String(elop.fontFamily || theme.fontFamily).split(',')[0].trim().replace(/^["']|["']$/g, '');
  const alignMap = { left: 'left', center: 'center', right: 'right', justify: 'justify' };
  if (elop.align && alignMap[elop.align]) opt.align = alignMap[elop.align];
  const valignMap = { top: 'top', middle: 'middle', center: 'middle', bottom: 'bottom' };
  const v = elop.verticalAlign ?? elop.valign;
  if (v && valignMap[v]) opt.valign = valignMap[v];
  if (typeof elop.lineHeight === 'number') opt.lineSpacingMultiple = Math.min(3, Math.max(0.5, elop.lineHeight));
  if (typeof elop.letterSpacing === 'number') opt.charSpacing = Math.max(0, Math.round(elop.letterSpacing * fontScale));
  if (elop.underline) opt.underline = { style: 'sng' };
  // 删除线：PPT 原生支持（过去只在预览实现，属单向渲染）
  const strike = elop.strike ?? elop.strikethrough;
  if (strike) opt.strike = strike === 'dblStrike' ? 'dblStrike' : true;
  // 换行开关：与预览共用 resolveWrap，避免 wrap:false 在两端表现不同
  if (!resolveWrap(elop.wrap).pptx) opt.wrap = false;
  // 文本框底色圆角：映射到 PPT 原生圆角矩形（过去只在预览实现）
  // 注意 rectRadius 单位是**英寸**：pptxgenjs 计算 adj = rectRadius × EMU × 100000 / min(cx,cy)，
  // 因此取值需与 shape-rect 保持一致用 pxToInch；adj 上限 50000 对应半径 min(w,h)/2。
  if (elop.bgRadius > 0 && opt.fill) {
    const cap = Math.min(opt.w ?? 0, opt.h ?? 0) / 2;
    const r = pxToInch(elop.bgRadius);
    opt.shape = 'roundRect';
    opt.rectRadius = cap > 0 ? Math.min(r, cap) : r;
  }
  // 文字描边：PPT 原生 <a:ln>（pptxgenjs 的文本 outline）。宽度按画布比例 px→pt，
  // 与预览的 Konva 文字描边取同一个 width 值，两端粗细一致。
  if (elop.outline && typeof elop.outline === 'object' && !Array.isArray(elop.outline)) {
    const oc = parseColor(elop.outline.color ?? elop.fill ?? elop.color);
    if (oc) opt.outline = { color: oc.color, size: Math.max(0.25, pxToPt(elop.outline.width ?? 1)) };
  }
  // 文字发光：PPT 原生 <a:glow>（pptxgenjs 的文本 glow）。
  // pptxgenjs 的 size 单位是 pt（内部 ×12700 写 rad），与预览的 Konva shadowBlur 近似同量级，
  // 故同样按 px→pt 换算；两端都是"字形外扩的柔光"，不承诺逐像素一致。
  if (elop.glow && typeof elop.glow === 'object' && !Array.isArray(elop.glow)) {
    const gc = parseColor(elop.glow.color);
    if (gc) {
      const opacity = Number(elop.glow.opacity);
      opt.glow = {
        color: gc.color,
        size: Math.max(1, pxToPt(elop.glow.blur ?? 8)),
        opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.75,
      };
    }
  }
  // 文字版式能力（只由 PPTX 实现，预览是画布，不做竖排/自动缩字/高亮/上下标/段距）。
  // 它们登记为 pptx-only，因此导出端**必须真的写进原生文件**：历史上这批字段
  // 被注册表声明为"仅 PPTX 生效"，而导出端根本没有读，用户看到告警后打开 PPTX 仍是空的。
  if (elop.fit != null) opt.fit = ['none', 'shrink', 'resize'].includes(elop.fit) ? elop.fit : 'shrink';
  const vert = elop.vert ?? elop.textDirection;
  if (vert != null && TEXT_VERT_VALUES.includes(vert)) opt.vert = vert;
  if (elop.highlight) {
    const hc = parseColor(typeof elop.highlight === 'object' ? elop.highlight.color : elop.highlight);
    if (hc) opt.highlight = hc.color; // pptxgenjs 的 highlight 是十六进制字符串
  }
  if (elop.subscript) opt.subscript = true;
  if (elop.superscript) opt.superscript = true;
  // 段前/段后距：DSL 与其它尺寸一样用 px，pptxgenjs 写 <a:spcPts> 的单位是 pt
  if (elop.paraSpaceBefore != null && Number.isFinite(Number(elop.paraSpaceBefore))) opt.paraSpaceBefore = pxToPt(Number(elop.paraSpaceBefore));
  if (elop.paraSpaceAfter != null && Number.isFinite(Number(elop.paraSpaceAfter))) opt.paraSpaceAfter = pxToPt(Number(elop.paraSpaceAfter));
  return opt;
}

/** 点列转 pptxgenjs customGeometry points（相对元素原点，px→inch，含曲线参数换算） */
function toGeometryPoints(pointArr, originX, originY) {
  return pointArr.map((p, i) => {
    const q = { x: pxToInch(p.x - originX), y: pxToInch(p.y - originY) };
    if (p.moveTo || i === 0) q.moveTo = true;
    if (p.controlPoint) q.curve = { type: 'quadratic', x1: pxToInch(p.controlPoint.x - originX), y1: pxToInch(p.controlPoint.y - originY) };
    if (p.curve) {
      const c = { ...p.curve };
      for (const k of ['hR', 'wR', 'x1', 'y1', 'x2', 'y2']) { // 曲线控制点/圆弧半径同为 px，需换算
        if (typeof c[k] === 'number') c[k] = pxToInch(c[k]);
      }
      q.curve = c;
    }
    return q;
  });
}

/**
 * 闭合规则（pptxgenjs 只认 points 里带 close 键的点，opt.closePath 是死代码）：
 * shape-path 默认闭合（弧段/扇区）；curve-quadratic 默认不闭合（连接线）；
 * 显式 closePath true/false 优先。
 */
function applyClosePath(points, elop, elType) {
  const close = elop.closePath === true || (elop.closePath == null && elType === 'shape-path');
  if (close) points.push({ close: true });
  return points;
}

/** 幻灯片背景：颜色 / 图片（data 或 path） */
export function slideBackground(bg, theme) {
  const val = bg || theme.background;
  const parsed = parseColor(val);
  if (parsed) return { color: parsed.color };
  if (typeof val === 'string') {
    if (val.startsWith('data:')) return { data: val };
    return { path: val };
  }
  return undefined;
}

/** 把单个 elop 应用到 pptxgenjs slide（image 需先经预取得到 _data；Node/浏览器共用此函数） */
export function applyElement(pptx, slide, elop, theme) {
  const t = elop.elType;
  if (t === 'text') {
    slide.addText(String(elop.text ?? ''), textOptions(elop, theme));
  } else if (t === 'image') {
    const opt = baseOptions(elop);
    opt.transparency = elop.transparency != null
      ? Math.min(100, Math.max(0, elop.transparency))
      : combinedTransparency(null, elop.opacity);
    if (elop._data) opt.data = elop._data;
      else if (elop.data) opt.data = elop.data; // 直接内嵌 data URI（预览/校验器同样支持）
    else if (elop.path || elop.url) opt.path = elop.path || elop.url; // 兜底：未预取时让 pptxgenjs 自行处理
    else throw new Error('image 缺少 path/url/data');
    // 默认 cover 裁满（与 Konva 预览一致），contain 完整容纳，crop 按源图像素精确裁切。
    // 兼容 `sizing:"contain"` 与 `sizing:{type:"contain"}` 两种写法（见 layouts.mjs imageSizing）
    const sizingType = imageSizing(elop.sizing);
    const sizingSpec = elop.sizing && typeof elop.sizing === 'object' ? elop.sizing : {};
    if (sizingType === 'crop') {
      // 裁剪框用 0–1 比例表达（相对源图）。原因：pptxgenjs 在 Node 下拿不到图片自然尺寸
      // （其 getSizeFromImage 未启用），crop 的 x/y/w/h 实际以**图片框**英寸尺寸为参照换算
      // srcRect 百分比；比例表达与图片框相乘后，两端裁切的是同一块区域，且无需知道图片像素数。
      if (!(sizingSpec.width > 0) || !(sizingSpec.height > 0)) {
        throw new Error('image sizing.crop 需要 width/height（相对源图的 0–1 比例）');
      }
      const fx = clamp01(sizingSpec.x ?? 0), fy = clamp01(sizingSpec.y ?? 0);
      const fw = Math.min(clamp01(sizingSpec.width), 1 - fx);
      const fh = Math.min(clamp01(sizingSpec.height), 1 - fy);
      opt.sizing = {
        type: 'crop',
        x: pxToInch((elop.width || 0) * fx),
        y: pxToInch((elop.height || 0) * fy),
        w: pxToInch((elop.width || 0) * fw),
        h: pxToInch((elop.height || 0) * fh),
      };
    } else {
      opt.sizing = { type: sizingType, w: opt.w, h: opt.h };
    }
    // PptxGenJS 的 rounding 是椭圆裁切，不等价于网页圆角；仅在显式 rounding=true 时启用。
    if (elop.rounding === true) opt.rounding = true;
    slide.addImage(opt);
  } else if (t === 'image-svg') {
    if (!elop._data && !elop.svgXml) throw new Error('image-svg 缺少 svgXml');
    const opt = baseOptions(elop);
    opt.transparency = combinedTransparency(null, elop.opacity);
    if (elop._data) {
      opt.data = elop._data; // Node 端：已预栅格化为 PNG（pptxgenjs 的 SVG 支持是纯浏览器功能）
    } else {
      opt.data = 'data:image/svg+xml;base64,' + utf8ToBase64(elop.svgXml || ''); // 浏览器端：pptxgenjs 会栅格化
    }
    slide.addImage(opt);
  } else if (t === 'shape-rect') {
    const opt = baseOptions(elop);
    const r = elop.cornerRadius ?? elop.rectRadius;
    if (r && r > 0) {
      opt.rectRadius = pxToInch(r);
      slide.addShape(pptx.ShapeType.roundRect, opt);
    } else {
      slide.addShape(pptx.ShapeType.rect, opt);
    }
  } else if (t === 'shape-circle') {
    const opt = baseOptions(elop);
    // DSL 约定：shape-circle 的 x/y 为圆心（Konva 习惯）
    const w = elop.width ?? (elop.radius ? elop.radius * 2 : 0);
    const h = elop.height ?? (elop.radius ? elop.radius * 2 : w);
    opt.w = pxToInch(w);
    opt.h = pxToInch(h);
    if (typeof elop.x === 'number') opt.x = pxToInch(elop.x - w / 2);
    if (typeof elop.y === 'number') opt.y = pxToInch(elop.y - h / 2);
    slide.addShape(pptx.ShapeType.ellipse, opt);
  } else if (t === 'shape-line' || t === 'shape-arrow') {
    const opt = baseOptions(elop);
    const pa = Array.isArray(elop.pointArr) ? elop.pointArr : [];
    if (pa.length > 2) {
      // 多段折线：走 customGeometry（箭头 tailEnd 仍生效），不再只取前两点
      const xs = pa.map(p => p.x), ys = pa.map(p => p.y);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      opt.x = pxToInch(minX);
      opt.y = pxToInch(minY);
      opt.w = pxToInch(Math.max(...xs) - minX);
      opt.h = pxToInch(Math.max(...ys) - minY);
      opt.points = toGeometryPoints(pa, minX, minY); // 开放折线，不闭合
      if (t === 'shape-arrow') {
        opt.line = opt.line || {};
        opt.line.endArrowType = opt.line.endArrowType || 'stealth';
      }
      slide.addShape(pptx.shapes.CUSTOM_GEOMETRY, opt);
    } else if (pa.length >= 2) {
      opt.x = pxToInch(pa[0].x);
      opt.y = pxToInch(pa[0].y);
      opt.w = pxToInch(pa[1].x - pa[0].x);
      opt.h = pxToInch(pa[1].y - pa[0].y);
      normalizeRect(opt); // 线段向左上绘制时 w/h 为负，OOXML 需正尺寸 + flip
      if (t === 'shape-arrow') {
        opt.line = opt.line || {};
        opt.line.endArrowType = opt.line.endArrowType || 'stealth';
      }
      slide.addShape(pptx.ShapeType.line, opt);
    } else if (typeof elop.width === 'number') {
      slide.addShape(pptx.ShapeType.line, opt);
    } else throw new Error(`${t} 缺少 pointArr`);
  } else if (t === 'shape-path' || t === 'curve-quadratic') {
    const opt = baseOptions(elop);
    if (Array.isArray(elop.pointArr)) {
      opt.points = applyClosePath(toGeometryPoints(elop.pointArr, 0, 0), elop, t);
      slide.addShape(pptx.shapes.CUSTOM_GEOMETRY, opt); // 注意：ShapeType.customGeometry 是 undefined
    } else if (elop.data || elop.svgPath) {
      throw new Error(`shape-path 的 SVG data 需预转为 pointArr（或改用 image-svg）`);
    } else throw new Error(`${t} 缺少 pointArr`);
  } else if (isShapeElement(t)) {
    // 形状库：DSL 形状名 → OOXML preset（PowerPoint 按 preset 公式绘制），
    // 预览侧使用同一套几何（见 core/shape-geometry.mjs），两端不再各写形状逻辑。
    const built = buildShape(elop);
    if (!built) throw new Error(`未知或不支持的形状: ${resolveShape(elop) ?? elop.shape ?? '(缺少 shape)'}`);
    const opt = baseOptions(elop);
    // 形状库的 x/y 为左上角（与 shape-rect 一致；shape-circle 的圆心约定不在此列）
    if (built.angleRange) opt.angleRange = built.angleRange;
    if (built.arcThicknessRatio != null) opt.arcThicknessRatio = built.arcThicknessRatio;
    if (built.pptx) {
      slide.addShape(pptx.ShapeType[built.pptx] ?? built.pptx, opt);
    } else if (Array.isArray(built.points)) {
      // 无 preset 对应的自由多边形（如任意边数正多边形）：两端共用同一顶点列
      opt.points = toGeometryPoints(built.points, 0, 0);
      opt.points.push({ close: true });
      slide.addShape(pptx.shapes.CUSTOM_GEOMETRY, opt); // 注意：ShapeType.customGeometry 是 undefined
    } else {
      throw new Error(`形状 ${built.shape} 既无 preset 也无顶点列`);
    }
  } else if (t === 'chart') {
    const typeMap = { bar: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut', area: 'area', radar: 'radar', scatter: 'scatter' };
    const typeKey = elop.chartType || 'bar';
    if (!typeMap[typeKey]) throw new Error(`未知 chartType: ${typeKey}`);
    const chartType = pptx.ChartType[typeMap[typeKey]];
    const opt = baseOptions(elop);
    // 选项在编译期已归一化；未编译的 deck 也走同一个纯函数，两端不会漂移
    const c = elop._chart || normalizeChartOptions(elop);
    if (Array.isArray(elop.chartColors) && elop.chartColors.length) {
      opt.chartColors = elop.chartColors.map(v => parseColor(v)?.color).filter(Boolean);
    } else {
      opt.chartColors = theme.palette.slice(0, 6);
    }
    const model = chartModel(elop);
    const isPie = ['pie', 'doughnut'].includes(typeKey);
    const color = (v, fallback) => (v ? parseColor(v)?.color : null) || fallback;

    // 标题
    const hasTitle = elop.showTitle === true && Boolean(elop.chartTitle || elop.title);
    opt.showTitle = hasTitle;
    if (hasTitle) opt.title = String(elop.chartTitle || elop.title);
    opt.titleFontFace = theme.fontFamily;
    opt.titleFontSize = c.titleFontSize;
    opt.titleColor = color(c.titleColor, theme.text);
    opt.titleAlign = c.titleAlign;
    opt.titleBold = c.titleBold;

    // 图例
    opt.showLegend = elop.showLegend === true; // 两端统一：缺省隐藏
    opt.legendPos = c.legendPos;
    opt.legendFontSize = c.legendFontSize;
    opt.legendColor = color(c.legendColor, theme.textSecondary);
    opt.legendFontFace = theme.fontFamily;

    // 数值轴
    opt.valAxisHidden = c.valAxisHidden;
    opt.valAxisMinVal = c.valAxisMinVal != null ? c.valAxisMinVal : model.yDomain.min;
    opt.valAxisMaxVal = c.valAxisMaxVal != null ? c.valAxisMaxVal : model.yDomain.max;
    if (c.valAxisMajorUnit != null) opt.valAxisMajorUnit = c.valAxisMajorUnit;
    opt.valAxisLabelFontSize = c.valAxisLabelFontSize;
    opt.valAxisLabelColor = color(c.valAxisLabelColor, theme.textSecondary);
    opt.valAxisLabelFormatCode = c.valAxisLabelFormatCode;
    opt.valAxisLineShow = c.valAxisLineShow;
    opt.valAxisLineColor = color(c.valAxisLineColor, theme.border);
    opt.valAxisLineSize = c.valAxisLineSize;
    opt.valAxisLabelFontFace = theme.fontFamily;
    if (c.showValAxisTitle && c.valAxisTitle) {
      opt.showValAxisTitle = true;
      opt.valAxisTitle = c.valAxisTitle;
      opt.valAxisTitleFontSize = c.valAxisTitleFontSize;
      opt.valAxisTitleColor = theme.textSecondary;
      opt.valAxisTitleFontFace = theme.fontFamily;
    }

    // 分类轴
    opt.catAxisHidden = c.catAxisHidden;
    opt.catAxisLabelRotate = c.catAxisLabelRotate;
    opt.catAxisLabelFontSize = c.catAxisLabelFontSize;
    opt.catAxisLabelColor = color(c.catAxisLabelColor, theme.textSecondary);
    opt.catAxisLabelPos = 'low';
    opt.catAxisLineShow = c.catAxisLineShow;
    opt.catAxisLineColor = color(c.catAxisLineColor, 'CBD5E1');
    opt.catAxisLineSize = c.catAxisLineSize;
    opt.catAxisMajorTickMark = opt.catAxisMinorTickMark = 'none';
    opt.catAxisLabelFontFace = theme.fontFamily;
    if (c.showCatAxisTitle && c.catAxisTitle) {
      opt.showCatAxisTitle = true;
      opt.catAxisTitle = c.catAxisTitle;
      opt.catAxisTitleFontSize = c.catAxisTitleFontSize;
      opt.catAxisTitleColor = theme.textSecondary;
      opt.catAxisTitleFontFace = theme.fontFamily;
    }

    // 网格线（style 为 none 时 pptxgenjs 不写 <c:majorGridlines>）
    opt.valGridLine = { style: c.valGridLine.style, color: color(c.valGridLine.color, theme.border), size: c.valGridLine.size };
    opt.catGridLine = { style: c.catGridLine.style, color: color(c.catGridLine.color, theme.border), size: c.catGridLine.size };

    // 数据标签
    opt.showValue = elop.showValue ?? false;
    opt.showSerName = c.showSerName;
    opt.showCatName = c.showCatName;
    opt.showPercent = c.showPercent;
    opt.dataLabelFormatCode = c.dataLabelFormatCode;
    opt.dataLabelFontFace = theme.fontFamily;
    opt.dataLabelFontSize = c.dataLabelFontSize;
    opt.dataLabelColor = color(c.dataLabelColor, theme.textSecondary);
    opt.dataLabelFontBold = c.dataLabelFontBold;
    opt.dataLabelPosition = c.dataLabelPosition || (isPie ? 'ctr' : typeKey === 'bar' ? 'outEnd' : 't');

    // 布局：为标题/图例/轴标签预留空间
    const titleH = hasTitle ? 22 : 0;
    const legendEdge = elop.showLegend === true ? c.legendPos : null;
    const legendT = legendEdge === 't' || legendEdge === 'tr' ? 26 : 0;
    const legendB = legendEdge === 'b' ? 22 : 0;
    const legendSide = legendEdge === 'l' || legendEdge === 'r' ? 46 : 0;
    const labelH = !isPie && !c.catAxisHidden && model.labels.length ? 18 : 0;
    opt.layout = {
      x: (10 + legendSide) / elop.width,
      y: (titleH + legendT + 6) / elop.height,
      w: (elop.width - 20 - legendSide) / elop.width,
      h: (elop.height - titleH - legendT - legendB - 6 - labelH - 8) / elop.height,
    };

    opt.lineSize = c.lineSize;
    opt.lineSmooth = c.lineSmooth;
    opt.lineDataSymbol = c.lineDataSymbol;
    opt.lineDataSymbolSize = c.lineDataSymbolSize; // OOXML marker size is an integer, even when other sizes are points.
    opt.holeSize = c.holeSize;
    opt.firstSliceAng = c.firstSliceAng;
    opt.showMarker = c.lineDataSymbol !== 'none';
    opt.chartColorsOpacity = (elop.opacity ?? 1) * 100;
    if (typeKey === 'area') opt.chartColorsOpacity *= 0.2;
    if (typeKey === 'scatter') {
      opt.catAxisMinVal = model.xDomain.min;
      opt.catAxisMaxVal = model.xDomain.max;
      opt.lineSize = 0;
    }
    if (typeKey === 'bar') {
      opt.barDir = c.barDir;
      opt.barGrouping = c.barGrouping;
      opt.barGapWidthPct = c.barGapWidthPct;
      // 横向条（barDir: 'bar'）的分类轴在左侧，标签位置随之改变
      opt.catAxisLabelPos = c.barDir === 'bar' ? 'nextTo' : 'low';
    }
    slide.addChart(chartType, model.nativeData, opt);
  } else if (t === 'table') {
    if (!Array.isArray(elop.rows) || !elop.rows.length) throw new Error('table 缺少 rows');
    const opt = baseOptions(elop);
    opt.fontSize = Math.max(6, Math.round((elop.fontSize || 16) * theme.fontScale * 10) / 10);
    if (theme.fontFamily || elop.fontFamily) opt.fontFace = String(elop.fontFamily || theme.fontFamily).split(',')[0].trim().replace(/^["']|["']$/g, '');
    const hd = elop.header || {};
    // 表格边框色：预览按 cell 描边绘制 borderColor，导出映射为 PPT 原生单元格边框（同色同粗细）。
    // 未显式设置时两端各自使用默认边框（预览 #E2E8F0 / PPT 666666），故这里只在显式给色时写入。
    const borderColor = parseColor(elop.borderColor);
    const cellBorder = borderColor ? { type: 'solid', pt: pxToPt(1), color: borderColor.color } : null;
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
          border: cellBorder || undefined,
        },
      };
    }));
    if (typeof elop.height === 'number' && rows.length) {
      opt.rowH = pxToInch(elop.height / rows.length);
      delete opt.h; // PptxGenJS 表格高度由 rowH 决定，h 容易造成预览/导出差异
    }
    slide.addTable(rows, opt);
  } else {
    throw new Error(`未知 elType: ${t}`);
  }
}
