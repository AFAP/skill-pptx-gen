/**
 * Compact semantic layouts -> primitive PPT-DSL.
 *
 * These expanders intentionally produce only the same primitive elements consumed by
 * the preview/export cores.  The semantic source stays small, while the compiled deck
 * remains inspectable and can still be extended with raw `elements` overlays.
 */

export const LAYOUT_TYPES = [
  'cover', 'section', 'agenda', 'cards', 'metrics', 'split',
  'comparison', 'timeline', 'chart-insight', 'quote', 'ending', 'raw',
];

const LAYOUT_ALIASES = {
  catalog: 'agenda',
  'content-grid': 'cards',
  data: 'metrics',
  dashboard: 'metrics',
  'image-split': 'split',
  pipeline: 'timeline',
};

export function normalizeLayoutName(name) {
  const n = String(name || 'raw').trim().toLowerCase();
  return LAYOUT_ALIASES[n] || n;
}

export function isSemanticSlide(slide) {
  return Boolean(slide && typeof slide === 'object' && slide.layout);
}

function ptr(...parts) {
  return '/' + parts.map(p => String(p).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
}

function el(id, role, spec, sourcePath) {
  return { id, role, ...(sourcePath ? { sourcePath } : {}), ...spec };
}

function text(id, role, value, box, style = {}, sourcePath) {
  return el(id, role, {
    elType: 'text', text: String(value ?? ''),
    x: box.x, y: box.y, width: box.width, height: box.height,
    fontSize: style.fontSize ?? 18,
    fontStyle: style.fontStyle,
    fill: style.fill ?? '$text',
    align: style.align ?? 'left',
    verticalAlign: style.verticalAlign ?? 'top',
    lineHeight: style.lineHeight ?? 1.3,
    letterSpacing: style.letterSpacing,
    opacity: style.opacity,
    padding: style.padding,
  }, sourcePath);
}

function rect(id, role, box, style = {}) {
  return el(id, role, {
    elType: 'shape-rect', x: box.x, y: box.y, width: box.width, height: box.height,
    fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth,
    cornerRadius: style.cornerRadius, opacity: style.opacity,
    shadowColor: style.shadowColor, shadowBlur: style.shadowBlur,
    shadowOffsetY: style.shadowOffsetY, shadowOpacity: style.shadowOpacity,
    allowOverflow: style.allowOverflow,
  });
}

function circle(id, role, x, y, diameter, style = {}) {
  return el(id, role, {
    elType: 'shape-circle', x, y, width: diameter, height: diameter,
    fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth,
    opacity: style.opacity,
  });
}

function surface(theme) { return '#' + theme.surface; }
function surfaceAlt(theme) { return '#' + theme.surfaceAlt; }
function border(theme) { return '#' + theme.border; }

function header(slide, si, theme, titleValue = slide.title, eyebrowValue = slide.eyebrow) {
  const p = theme.pagePadding;
  const out = [];
  if (theme.titleMarker === 'bar') {
    out.push(rect(`s${si}-header-marker`, 'decoration', { x: p, y: 48, width: 6, height: 44 }, { fill: '$accent', cornerRadius: 3 }));
  } else {
    out.push(rect(`s${si}-header-marker`, 'decoration', { x: p, y: 105, width: 72, height: 3 }, { fill: '$accent', cornerRadius: 2 }));
  }
  const tx = theme.titleMarker === 'bar' ? p + 20 : p;
  if (eyebrowValue) {
    out.push(text(`s${si}-eyebrow`, 'eyebrow', eyebrowValue,
      { x: tx, y: 42, width: 500, height: 20 },
      { fontSize: 11, fill: '$text2', letterSpacing: 2.6, verticalAlign: 'middle' },
      ptr('slides', si, 'eyebrow')));
  }
  out.push(text(`s${si}-title`, 'title', titleValue,
    { x: tx, y: eyebrowValue ? 64 : 50, width: 1040, height: 48 },
    { fontSize: 30, fontStyle: 'bold', lineHeight: 1.1, verticalAlign: 'middle' },
    ptr('slides', si, 'title')));
  return out;
}

function footer(slide, si, pageCount, theme) {
  if (!theme.footer || slide.footer === false) return [];
  const p = theme.pagePadding;
  const label = slide.footerLabel || slide.brand || '';
  const out = [
    rect(`s${si}-footer-line`, 'footer', { x: p, y: 684, width: 1280 - p * 2, height: 1 }, { fill: border(theme) }),
    text(`s${si}-footer-page`, 'page-number', `${String(si + 1).padStart(2, '0')} / ${String(pageCount).padStart(2, '0')}`,
      { x: 1080, y: 691, width: 1280 - p - 1080, height: 18 },
      { fontSize: 10, fill: '$text2', opacity: 0.8, align: 'right' }),
  ];
  if (label) out.splice(1, 0, text(`s${si}-footer-label`, 'footer', label, { x: p, y: 691, width: 760, height: 18 }, { fontSize: 10, fill: '$text2', opacity: 0.8 }, ptr('slides', si, 'footerLabel')));
  return out;
}

function cover(slide, si, pageCount, theme) {
  const p = Math.max(72, theme.pagePadding + 12);
  const metrics = Array.isArray(slide.metrics) ? slide.metrics.slice(0, 4) : [];
  const dark = slide.dark !== false;
  const bg = slide.background || (dark ? '$primary' : '$bg');
  const fg = dark ? '#FFFFFF' : '$text';
  const sub = dark ? '#C9D2DF' : '$text2';
  const out = [
    rect(`s${si}-cover-orbit1`, 'decoration', { x: 920, y: 0, width: 360, height: 360 }, { fill: '#00000000', stroke: '$accent', strokeWidth: 2, cornerRadius: 180, opacity: 0.65 }),
    rect(`s${si}-cover-accent`, 'decoration', { x: p, y: 286, width: 64, height: 4 }, { fill: '$accent', cornerRadius: 2 }),
  ];
  if (slide.eyebrow) out.push(text(`s${si}-eyebrow`, 'eyebrow', slide.eyebrow, { x: p, y: 100, width: 760, height: 24 }, { fontSize: 12, fill: sub, letterSpacing: 3 }, ptr('slides', si, 'eyebrow')));
  out.push(text(`s${si}-title`, 'title', slide.title, { x: p, y: 190, width: 930, height: 96 }, { fontSize: 58, fontStyle: 'bold', fill: fg, lineHeight: 1.05, verticalAlign: 'middle' }, ptr('slides', si, 'title')));
  if (slide.subtitle) out.push(text(`s${si}-subtitle`, 'subtitle', slide.subtitle, { x: p, y: 318, width: 940, height: 64 }, { fontSize: 22, fill: sub, lineHeight: 1.4 }, ptr('slides', si, 'subtitle')));
  if (metrics.length) {
    const gap = 18, w = (1280 - p * 2 - gap * (metrics.length - 1)) / metrics.length;
    metrics.forEach((m, i) => {
      const x = p + i * (w + gap), y = 500;
      out.push(rect(`s${si}-metric-${i}-box`, 'card', { x, y, width: w, height: 126 }, { fill: dark ? '#FFFFFF10' : surface(theme), stroke: dark ? '#FFFFFF24' : border(theme), strokeWidth: 1, cornerRadius: theme.radius }));
      out.push(text(`s${si}-metric-${i}-value`, 'metric-value', m.value, { x: x + 18, y: y + 18, width: w - 36, height: 42 }, { fontSize: 30, fontStyle: 'bold', fill: i === 1 ? '$accent' : fg, align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'metrics', i, 'value')));
      out.push(text(`s${si}-metric-${i}-label`, 'metric-label', m.label, { x: x + 18, y: y + 70, width: w - 36, height: 32 }, { fontSize: 13, fill: sub, align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'metrics', i, 'label')));
    });
  }
  return { background: bg, elements: out };
}

function section(slide, si, pageCount, theme) {
  const out = [];
  const p = theme.pagePadding;
  if (slide.number != null) out.push(text(`s${si}-number`, 'decoration', slide.number, { x: p, y: 100, width: 260, height: 180 }, { fontSize: 120, fontStyle: 'bold', fill: '$accent', opacity: 0.22 }, ptr('slides', si, 'number')));
  out.push(rect(`s${si}-section-line`, 'decoration', { x: p, y: 305, width: 88, height: 5 }, { fill: '$accent', cornerRadius: 3 }));
  out.push(text(`s${si}-title`, 'title', slide.title, { x: p, y: 330, width: 1040, height: 86 }, { fontSize: 52, fontStyle: 'bold', verticalAlign: 'middle' }, ptr('slides', si, 'title')));
  if (slide.subtitle) out.push(text(`s${si}-subtitle`, 'subtitle', slide.subtitle, { x: p, y: 430, width: 920, height: 72 }, { fontSize: 22, fill: '$text2', lineHeight: 1.45 }, ptr('slides', si, 'subtitle')));
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function agenda(slide, si, pageCount, theme) {
  const items = Array.isArray(slide.items) ? slide.items.slice(0, 8) : [];
  const out = [...header(slide, si, theme, slide.title || '目录', slide.eyebrow || 'CONTENTS')];
  const p = theme.pagePadding, top = 150, rowH = Math.min(74, 470 / Math.max(1, items.length));
  items.forEach((item, i) => {
    const obj = typeof item === 'string' ? { title: item } : item;
    const y = top + i * rowH;
    out.push(text(`s${si}-agenda-${i}-num`, 'item-number', String(i + 1).padStart(2, '0'), { x: p, y, width: 64, height: rowH - 8 }, { fontSize: 16, fontStyle: 'bold', fill: '$accentText', verticalAlign: 'middle' }));
    out.push(text(`s${si}-agenda-${i}-title`, 'item-title', obj.title, { x: p + 82, y, width: 760, height: rowH - 8 }, { fontSize: 21, fontStyle: 'bold', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, typeof item === 'string' ? '' : 'title').replace(/\/$/, '')));
    if (obj.subtitle) out.push(text(`s${si}-agenda-${i}-sub`, 'item-body', obj.subtitle, { x: 900, y, width: 300, height: rowH - 8 }, { fontSize: 13, fill: '$text2', align: 'right', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'subtitle')));
    out.push(rect(`s${si}-agenda-${i}-line`, 'separator', { x: p, y: y + rowH - 8, width: 1280 - p * 2, height: 1 }, { fill: border(theme) }));
  });
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function cards(slide, si, pageCount, theme) {
  const items = Array.isArray(slide.items) ? slide.items.slice(0, 6) : [];
  const out = [...header(slide, si, theme)];
  const p = theme.pagePadding;
  const cols = slide.columns || (items.length <= 2 ? 2 : items.length === 4 ? 2 : 3);
  const rows = Math.ceil(items.length / cols);
  const compact = rows > 1;
  const gap = 20, top = 150, bottom = 660;
  const w = (1280 - p * 2 - gap * (cols - 1)) / cols;
  const h = (bottom - top - gap * Math.max(0, rows - 1)) / Math.max(1, rows);
  items.forEach((item, i) => {
    const r = Math.floor(i / cols), c = i % cols, x = p + c * (w + gap), y = top + r * (h + gap);
    out.push(rect(`s${si}-card-${i}-box`, 'card', { x, y, width: w, height: h }, { fill: surface(theme), stroke: border(theme), strokeWidth: 1, cornerRadius: theme.radius }));
    out.push(rect(`s${si}-card-${i}-cap`, 'decoration', { x, y, width: w, height: 4 }, { fill: i % 2 ? '$accent' : '$primary', cornerRadius: 2 }));
    if (item.icon) out.push(text(`s${si}-card-${i}-icon`, 'icon', item.icon, { x: x + 24, y: y + (compact ? 20 : 24), width: compact ? 58 : 48, height: compact ? 44 : 48 }, { fontSize: compact ? 18 : 28, align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'icon')));
    const titleX = x + (compact && item.icon ? 96 : 28);
    out.push(text(`s${si}-card-${i}-title`, 'item-title', item.title, { x: titleX, y: y + (compact ? 22 : 34 + (item.icon ? 54 : 0)), width: w - (titleX - x) - 28, height: compact ? 44 : 42 }, { fontSize: compact ? 19 : 21, fontStyle: 'bold', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'title')));
    if (item.body) {
      const bodyY = y + (compact ? 82 : 90 + (item.icon ? 54 : 0));
      const valueY = item.value ? y + h - 58 : y + h - 24;
      const bodyH = Math.max(36, valueY - bodyY - 12);
      out.push(text(`s${si}-card-${i}-body`, 'item-body', item.body, { x: x + 28, y: bodyY, width: w - 56, height: bodyH }, { fontSize: 14, fill: '$text2', lineHeight: 1.55 }, ptr('slides', si, 'items', i, 'body')));
    }
    if (item.value) out.push(text(`s${si}-card-${i}-value`, 'metric-value', item.value, { x: x + 28, y: y + h - 58, width: w - 56, height: 34 }, { fontSize: 22, fontStyle: 'bold', fill: '$accentText', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'value')));
  });
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function metrics(slide, si, pageCount, theme) {
  const items = Array.isArray(slide.items) ? slide.items.slice(0, 6) : [];
  const out = [...header(slide, si, theme)];
  const p = theme.pagePadding, gap = 18, top = 180;
  const w = (1280 - p * 2 - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length);
  items.forEach((item, i) => {
    const x = p + i * (w + gap);
    out.push(rect(`s${si}-metric-${i}-box`, 'card', { x, y: top, width: w, height: 230 }, { fill: surface(theme), stroke: i === 0 ? '$primary' : border(theme), strokeWidth: 1.3, cornerRadius: theme.radius }));
    out.push(text(`s${si}-metric-${i}-value`, 'metric-value', item.value, { x: x + 16, y: top + 42, width: w - 32, height: 62 }, { fontSize: items.length > 4 ? 34 : 44, fontStyle: 'bold', fill: '$accentText', align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'value')));
    out.push(text(`s${si}-metric-${i}-label`, 'metric-label', item.label, { x: x + 16, y: top + 112, width: w - 32, height: 34 }, { fontSize: 15, fontStyle: 'bold', align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'label')));
    if (item.detail) out.push(text(`s${si}-metric-${i}-detail`, 'metric-detail', item.detail, { x: x + 16, y: top + 158, width: w - 32, height: 44 }, { fontSize: 12, fill: '$text2', align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'detail')));
  });
  if (slide.insight) {
    out.push(rect(`s${si}-insight-box`, 'insight', { x: p, y: 444, width: 1280 - p * 2, height: 150 }, { fill: surfaceAlt(theme), stroke: border(theme), strokeWidth: 1, cornerRadius: theme.radius }));
    out.push(text(`s${si}-insight`, 'insight', slide.insight, { x: p + 32, y: 470, width: 1280 - p * 2 - 64, height: 100 }, { fontSize: 18, lineHeight: 1.55, verticalAlign: 'middle' }, ptr('slides', si, 'insight')));
  }
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function split(slide, si, pageCount, theme) {
  const out = [...header(slide, si, theme)];
  const p = theme.pagePadding, gap = 44, top = 150, h = 500, imageW = 520;
  const imageRight = slide.imageSide === 'right';
  const ix = imageRight ? 1280 - p - imageW : p;
  const tx = imageRight ? p : p + imageW + gap;
  const tw = 1280 - p - tx;
  const img = slide.image || {};
  out.push(el(`s${si}-image`, 'image', { elType: 'image', x: ix, y: top, width: imageW, height: h, path: img.path, url: img.url, data: img.data, prompt: img.prompt, sizing: { type: img.sizing || 'cover' } }));
  out.push(text(`s${si}-content-title`, 'item-title', slide.contentTitle || slide.heading || '', { x: tx, y: top + 32, width: tw, height: 58 }, { fontSize: 30, fontStyle: 'bold', verticalAlign: 'middle' }, ptr('slides', si, slide.contentTitle != null ? 'contentTitle' : 'heading')));
  if (slide.body) out.push(text(`s${si}-body`, 'body', slide.body, { x: tx, y: top + 110, width: tw, height: 120 }, { fontSize: 16, fill: '$text2', lineHeight: 1.6 }, ptr('slides', si, 'body')));
  const bullets = Array.isArray(slide.bullets) ? slide.bullets.slice(0, 5) : [];
  bullets.forEach((b, i) => {
    const y = top + 250 + i * 48;
    out.push(circle(`s${si}-bullet-${i}-dot`, 'bullet', tx + 8, y + 13, 8, { fill: '$accent' }));
    out.push(text(`s${si}-bullet-${i}`, 'bullet-text', b, { x: tx + 26, y, width: tw - 26, height: 34 }, { fontSize: 15, lineHeight: 1.4, verticalAlign: 'middle' }, ptr('slides', si, 'bullets', i)));
  });
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function comparison(slide, si, pageCount, theme) {
  const out = [...header(slide, si, theme)];
  const p = theme.pagePadding, gap = 40, top = 155, h = 480, w = (1280 - p * 2 - gap) / 2;
  [slide.left || {}, slide.right || {}].forEach((side, i) => {
    const x = p + i * (w + gap), dark = i === 1 && slide.contrast !== false;
    out.push(rect(`s${si}-side-${i}-box`, 'card', { x, y: top, width: w, height: h }, { fill: dark ? '$primary' : surface(theme), stroke: dark ? '$primary' : border(theme), strokeWidth: 1, cornerRadius: theme.radius }));
    out.push(text(`s${si}-side-${i}-title`, 'item-title', side.title, { x: x + 34, y: top + 34, width: w - 68, height: 48 }, { fontSize: 26, fontStyle: 'bold', fill: dark ? '#FFFFFF' : '$text', verticalAlign: 'middle' }, ptr('slides', si, i ? 'right' : 'left', 'title')));
    (side.items || []).slice(0, 5).forEach((item, j) => {
      const v = typeof item === 'string' ? item : item.text || item.title;
      const y = top + 112 + j * 64;
      out.push(circle(`s${si}-side-${i}-${j}-dot`, 'bullet', x + 42, y + 13, 10, { fill: dark ? '$accent' : '$primary' }));
      out.push(text(`s${si}-side-${i}-${j}-text`, 'bullet-text', v, { x: x + 64, y, width: w - 98, height: 46 }, { fontSize: 15, fill: dark ? '#E4EAF1' : '$text2', lineHeight: 1.45 }, ptr('slides', si, i ? 'right' : 'left', 'items', j, typeof item === 'string' ? '' : (item.text != null ? 'text' : 'title')).replace(/\/$/, '')));
    });
  });
  out.push(circle(`s${si}-vs-circle`, 'decoration', 640, 395, 64, { fill: '$accent', stroke: '#FFFFFF', strokeWidth: 4 }));
  out.push(text(`s${si}-vs`, 'decoration', slide.centerLabel || 'VS', { x: 608, y: 363, width: 64, height: 64 }, { fontSize: 18, fontStyle: 'bold', fill: '$onAccent', align: 'center', verticalAlign: 'middle' }, slide.centerLabel ? ptr('slides', si, 'centerLabel') : undefined));
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function timeline(slide, si, pageCount, theme) {
  const items = Array.isArray(slide.items) ? slide.items.slice(0, 6) : [];
  const out = [...header(slide, si, theme)];
  const p = theme.pagePadding, yLine = 320;
  const left = Math.max(p + 60, 110), right = Math.min(1280 - p - 60, 1170);
  out.push(el(`s${si}-timeline-line`, 'connector', { elType: 'shape-line', pointArr: [{ x: left, y: yLine }, { x: right, y: yLine }], lineColor: border(theme), lineWidth: 3 }));
  items.forEach((item, i) => {
    const x = items.length === 1 ? 640 : left + i * (right - left) / (items.length - 1);
    out.push(circle(`s${si}-timeline-${i}-node`, 'timeline-node', x, yLine, 52, { fill: i % 2 ? '$accent' : '$primary', stroke: '#FFFFFF', strokeWidth: 4 }));
    out.push(text(`s${si}-timeline-${i}-num`, 'item-number', String(i + 1), { x: x - 26, y: yLine - 26, width: 52, height: 52 }, { fontSize: 18, fontStyle: 'bold', fill: i % 2 ? '$onAccent' : '#FFFFFF', align: 'center', verticalAlign: 'middle' }));
    if (item.date) out.push(text(`s${si}-timeline-${i}-date`, 'item-date', item.date, { x: x - 90, y: 245, width: 180, height: 30 }, { fontSize: 13, fontStyle: 'bold', fill: '$accentText', align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'date')));
    out.push(text(`s${si}-timeline-${i}-title`, 'item-title', item.title, { x: x - 105, y: 370, width: 210, height: 38 }, { fontSize: 18, fontStyle: 'bold', align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'items', i, 'title')));
    if (item.body) out.push(text(`s${si}-timeline-${i}-body`, 'item-body', item.body, { x: x - 110, y: 420, width: 220, height: 92 }, { fontSize: 13, fill: '$text2', align: 'center', lineHeight: 1.45 }, ptr('slides', si, 'items', i, 'body')));
  });
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function chartInsight(slide, si, pageCount, theme) {
  const out = [...header(slide, si, theme)];
  const p = theme.pagePadding, chart = slide.chart || {};
  out.push(rect(`s${si}-chart-box`, 'card', { x: p, y: 150, width: 720, height: 490 }, { fill: surface(theme), stroke: border(theme), strokeWidth: 1, cornerRadius: theme.radius }));
  out.push(el(`s${si}-chart`, 'chart', { elType: 'chart', x: p + 26, y: 178, width: 668, height: 430, ...chart }));
  out.push(rect(`s${si}-insights-box`, 'card', { x: p + 750, y: 150, width: 1280 - p * 2 - 750, height: 490 }, { fill: surfaceAlt(theme), stroke: border(theme), strokeWidth: 1, cornerRadius: theme.radius }));
  out.push(text(`s${si}-insights-title`, 'item-title', slide.insightTitle || '关键解读', { x: p + 780, y: 184, width: 330, height: 40 }, { fontSize: 22, fontStyle: 'bold', verticalAlign: 'middle' }, slide.insightTitle ? ptr('slides', si, 'insightTitle') : undefined));
  (slide.insights || []).slice(0, 6).forEach((v, i) => {
    const y = 250 + i * 58;
    out.push(circle(`s${si}-insight-${i}-dot`, 'bullet', p + 790, y + 12, 8, { fill: i % 2 ? '$accent' : '$primary' }));
    out.push(text(`s${si}-insight-${i}`, 'bullet-text', v, { x: p + 810, y, width: 310, height: 44 }, { fontSize: 14, lineHeight: 1.45 }, ptr('slides', si, 'insights', i)));
  });
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function quote(slide, si, pageCount, theme) {
  const out = [
    rect(`s${si}-quote-top`, 'decoration', { x: 560, y: 150, width: 160, height: 3 }, { fill: '$accent' }),
    text(`s${si}-quote-mark`, 'decoration', '“', { x: 150, y: 190, width: 120, height: 100 }, { fontSize: 86, fill: '$accent', fontStyle: 'bold' }),
    text(`s${si}-quote`, 'quote', slide.quote || slide.text, { x: 220, y: 245, width: 840, height: 190 }, { fontSize: 34, fontStyle: 'bold', align: 'center', verticalAlign: 'middle', lineHeight: 1.45 }, ptr('slides', si, slide.quote != null ? 'quote' : 'text')),
  ];
  if (slide.source) out.push(text(`s${si}-quote-source`, 'quote-source', slide.source, { x: 260, y: 470, width: 760, height: 36 }, { fontSize: 15, fill: '$text2', align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'source')));
  out.push(rect(`s${si}-quote-bottom`, 'decoration', { x: 560, y: 540, width: 160, height: 3 }, { fill: '$accent' }));
  return { background: slide.background || '$bg', elements: [...out, ...footer(slide, si, pageCount, theme)] };
}

function ending(slide, si, pageCount, theme) {
  const dark = slide.dark !== false, fg = dark ? '#FFFFFF' : '$text', sub = dark ? '#C9D2DF' : '$text2';
  const out = [
    rect(`s${si}-ending-line`, 'decoration', { x: 590, y: 255, width: 100, height: 4 }, { fill: '$accent', cornerRadius: 2 }),
    text(`s${si}-title`, 'title', slide.title || '感谢聆听', { x: 190, y: 285, width: 900, height: 90 }, { fontSize: 52, fontStyle: 'bold', fill: fg, align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'title')),
  ];
  if (slide.subtitle) out.push(text(`s${si}-subtitle`, 'subtitle', slide.subtitle, { x: 220, y: 395, width: 840, height: 60 }, { fontSize: 20, fill: sub, align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'subtitle')));
  if (slide.contact) out.push(text(`s${si}-contact`, 'contact', slide.contact, { x: 220, y: 575, width: 840, height: 40 }, { fontSize: 14, fill: sub, align: 'center', verticalAlign: 'middle' }, ptr('slides', si, 'contact')));
  return { background: slide.background || (dark ? '$primary' : '$bg'), elements: out };
}

const EXPANDERS = { cover, section, agenda, cards, metrics, split, comparison, timeline, 'chart-insight': chartInsight, quote, ending };

function annotateRawElements(elements, si) {
  return (elements || []).map((raw, ei) => ({
    ...raw,
    id: raw.id || `s${si}-raw-${ei}`,
    ...(raw.elType === 'text' ? { sourcePath: raw.sourcePath || ptr('slides', si, 'elements', ei, 'text') } : {}),
  }));
}

/** Expand one semantic slide; raw overlays are appended after generated elements. */
export function expandLayoutSlide(slide, { slideIndex, pageCount, theme }) {
  const name = normalizeLayoutName(slide.layout);
  if (name === 'raw') {
    return { ...slide, layout: undefined, background: slide.background || '$bg', elements: annotateRawElements(slide.elements, slideIndex) };
  }
  const fn = EXPANDERS[name];
  if (!fn) throw new Error(`未知 layout: ${slide.layout}`);
  const generated = fn(slide, slideIndex, pageCount, theme);
  const overlays = annotateRawElements(slide.elements, slideIndex);
  return {
    id: slide.id || `slide-${slideIndex + 1}`,
    background: generated.background,
    notes: slide.notes,
    speakerNotes: slide.speakerNotes,
    elements: [...generated.elements, ...overlays],
    _sourceLayout: name,
  };
}
