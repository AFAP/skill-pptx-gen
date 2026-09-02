/**
 * ai-ppt-gen 纯转换层：PPT-DSL → PptxGenJS 调用（无任何 Node/浏览器专有 API）
 *
 * Node 端（tools/build_pptx.mjs）与浏览器端（预览页的"导出 PPTX"按钮）共用同一份实现，
 * 保证 预览 = 导出（WYSIWYG）。Node 专有的图片预取/文件 IO 在 core/ppt-core.mjs。
 *
 * 画布约定：1280 × 720 px（16:9）→ PPT 13.333 × 7.5 inch（96 DPI）
 * 字体换算：pt = px × fontScale（默认 0.667，为中文行高留余量；0.75 为视觉等大）
 */

export const PPT_WIDTH = 1280;
export const PPT_HEIGHT = 720;
export const INCH_W = 13.333;
export const INCH_H = 7.5;
export const DEFAULT_FONT_SCALE = 2 / 3;

const PX2INCH = INCH_W / PPT_WIDTH;
/** 描边宽度/阴影的 px→pt（画布 1280px = 960pt，视觉等比缩放 0.75） */
const PX2PT = 0.75;
export function pxToInch(px) {
  return Number((px * PX2INCH).toFixed(4));
}
export function pxToPt(px) {
  return Number((px * PX2PT).toFixed(2));
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
  // 内置模版：藏青商务简报风（墨青 × 机械橙）。使用方式：theme: "navy-brief"
  'navy-brief': {
    palette: ['#0C1B2E', '#F26B21', '#4A7BA6', '#8FA3D9', '#C9CFDA', '#667085'],
    background: '#F7F6F3', text: '#17233B', textSecondary: '#667085',
    primary: '#0C1B2E', accent: '#F26B21', fontFamily: 'Microsoft YaHei',
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
    text: parseColor(custom.text || base.text || '#111111')?.color || '111111',
    textSecondary: parseColor(custom.textSecondary || base.textSecondary || '#444444')?.color || '444444',
    fontFamily: custom.fontFamily || base.fontFamily || '',
    fontScale: typeof custom.fontScale === 'number' ? custom.fontScale : DEFAULT_FONT_SCALE,
  };
}

/** 允许令牌替换的字段白名单（防止正文里恰好的 "$1"/"$primary" 字面量被误换成色值） */
const COLOR_KEYS = new Set(['fill', 'stroke', 'lineColor', 'shadowColor', 'bgFill', 'background', 'color', 'stripeColor', 'borderColor']);

/** 深拷贝并把颜色字段中的 $令牌 替换为主题色（只在白名单字段上解析） */
export function resolveTokens(obj, theme) {
  const map = {
    $primary: theme.primary, $accent: theme.accent, $bg: theme.background,
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
    if (p) out.fill = { color: p.color, transparency: opacity != null ? Math.round((1 - opacity) * 100) : p.transparency };
    return out;
  }
  const p = parseColor(elop.fill);
  if (p) {
    out.fill = { color: p.color };
    const t = opacity != null ? Math.round((1 - opacity) * 100) : p.transparency;
    if (t) out.fill.transparency = t;
  } else if (opacity != null && opacity < 1) {
    out.fill = { color: '000000', transparency: 100 };
  }
  return out;
}

function convertStroke(elop) {
  const colorRaw = elop.stroke ?? elop.lineColor;
  if (colorRaw == null && elop.strokeWidth == null && elop.lineWidth == null) return {};
  const p = parseColor(colorRaw || '#000000');
  if (!p) return {};
  const line = { color: p.color, width: pxToPt(elop.strokeWidth ?? elop.lineWidth ?? 2) };
  if (p.transparency) line.transparency = p.transparency;
  const dash = elop.dashType || elop.dash;
  if (dash === 'dash' || dash === true || (Array.isArray(dash) && dash.length)) line.dashType = 'dash';
  if (elop.lineEndArrowType) line.endArrowType = elop.lineEndArrowType;
  if (elop.lineBeginArrowType) line.beginArrowType = elop.lineBeginArrowType;
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
  Object.assign(opt, convertFill(elop), convertStroke(elop), convertShadow(elop));
  return normalizeRect(opt);
}

function textOptions(elop, theme) {
  const opt = baseOptions(elop);
  // 关键：text 的 fill 是"字体颜色"（Konva 约定），不是文本框填充；框底色用 bgFill
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
    if (elop._data) opt.data = elop._data;
      else if (elop.data) opt.data = elop.data; // 直接内嵌 data URI（预览/校验器同样支持）
    else if (elop.path || elop.url) opt.path = elop.path || elop.url; // 兜底：未预取时让 pptxgenjs 自行处理
    else return;
    // 默认 cover 裁满（与 Konva 预览一致），显式 contain 才完整容纳；不再默认 stretch 变形
    const sizingType = elop.sizing?.type === 'contain' ? 'contain' : 'cover';
    opt.sizing = { type: sizingType, w: opt.w, h: opt.h };
    if (elop.rounding || elop.cornerRadius) opt.rounding = true;
    slide.addImage(opt);
  } else if (t === 'image-svg') {
    const opt = baseOptions(elop);
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
    }
  } else if (t === 'shape-path' || t === 'curve-quadratic') {
    const opt = baseOptions(elop);
    if (Array.isArray(elop.pointArr)) {
      opt.points = applyClosePath(toGeometryPoints(elop.pointArr, 0, 0), elop, t);
      slide.addShape(pptx.shapes.CUSTOM_GEOMETRY, opt); // 注意：ShapeType.customGeometry 是 undefined
    } else if (elop.data || elop.svgPath) {
      throw new Error(`shape-path 的 SVG data 需预转为 pointArr（或改用 image-svg）`);
    }
  } else if (t === 'chart') {
    const typeMap = { bar: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut', area: 'area', radar: 'radar', scatter: 'scatter' };
    const chartType = pptx.ChartType[typeMap[elop.chartType] || 'bar'];
    const opt = baseOptions(elop);
    if (Array.isArray(elop.chartColors) && elop.chartColors.length) {
      opt.chartColors = elop.chartColors.map(c => parseColor(c)?.color).filter(Boolean);
    } else {
      opt.chartColors = theme.palette.slice(0, 6);
    }
    if (elop.showLegend != null) opt.showLegend = elop.showLegend; // 缺省隐藏（pptxgenjs 默认 false）
    if (elop.showTitle && (elop.chartTitle || elop.title)) { opt.showTitle = true; opt.title = elop.chartTitle || elop.title; } // pptxgenjs 的标题字段是 title
    opt.showValue = elop.showValue ?? false;
    const data = (elop.data || []).map(s => ({
      name: s.name || '',
      labels: s.labels || elop.labels || [],
      values: s.values || [],
    }));
    slide.addChart(chartType, data, opt);
  } else if (t === 'table') {
    const opt = baseOptions(elop);
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
