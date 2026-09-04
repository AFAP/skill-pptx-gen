/**
 * Browser-side extractor for the constrained WebSlide HTML contract.
 * Containers may use ordinary Flex/Grid; leaf nodes marked with data-ppt are converted.
 */
(function (global) {
  'use strict';

  function px(v) {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function cleanColor(v) {
    if (!v || v === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(v)) return null;
    return v;
  }

  function radiusPx(v, base) {
    if (String(v).includes('%')) return Math.min(base.width, base.height) * px(v) / 100;
    return px(v) * Math.min(base._sx, base._sy);
  }

  function rotationDeg(transform) {
    if (!transform || transform === 'none') return 0;
    const m = transform.match(/^matrix\(([^)]+)\)$/);
    if (!m) return 0;
    const parts = m[1].split(',').map(Number);
    return Math.round(Math.atan2(parts[1], parts[0]) * 180 / Math.PI * 100) / 100;
  }

  function boxShadow(cs) {
    const v = cs.boxShadow;
    if (!v || v === 'none') return {};
    const color = v.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/)?.[0];
    const nums = v.replace(/rgba?\([^)]+\)/, '').match(/-?[\d.]+px/g)?.map(px) || [];
    if (!color || nums.length < 2) return {};
    return { shadowColor: color, shadowOffsetX: nums[0], shadowOffsetY: nums[1], shadowBlur: nums[2] || 0, shadowOpacity: 1 };
  }

  function geom(node, slideRect) {
    const r = node.getBoundingClientRect();
    const sx = 1280 / slideRect.width, sy = 720 / slideRect.height;
    return {
      x: Math.round((r.left - slideRect.left) * sx * 100) / 100,
      y: Math.round((r.top - slideRect.top) * sy * 100) / 100,
      width: Math.round(r.width * sx * 100) / 100,
      height: Math.round(r.height * sy * 100) / 100,
      _sx: sx,
      _sy: sy,
    };
  }

  function common(node, slideRect, index) {
    const g = geom(node, slideRect);
    const cs = getComputedStyle(node);
    return {
      id: node.id || node.dataset.pptId || `web-${index}`,
      x: g.x, y: g.y, width: g.width, height: g.height,
      opacity: Number(cs.opacity || 1),
      rotation: rotationDeg(cs.transform),
      _sx: g._sx, _sy: g._sy,
      _z: Number.parseInt(cs.zIndex, 10) || 0,
      _order: index,
    };
  }

  function visualWarnings(node, cs) {
    const out = [];
    if (cs.filter && cs.filter !== 'none') out.push('filter');
    if (cs.clipPath && cs.clipPath !== 'none') out.push('clip-path');
    if (cs.maskImage && cs.maskImage !== 'none') out.push('mask');
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') out.push('mix-blend-mode');
    if (cs.backgroundImage && cs.backgroundImage.includes('gradient(')) out.push('gradient');
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient(') && (node.dataset.ppt === 'shape' || node.dataset.ppt === 'box')) out.push('background-image-on-shape');
    const shadowWithoutColors = String(cs.boxShadow || '').replace(/rgba?\([^)]+\)/g, '').replace(/#[0-9a-fA-F]{3,8}/g, '');
    if (shadowWithoutColors.includes(',')) out.push('multiple-box-shadows');
    const before = getComputedStyle(node, '::before')?.content;
    const after = getComputedStyle(node, '::after')?.content;
    if ((before && before !== 'none' && before !== 'normal' && before !== '""') || (after && after !== 'none' && after !== 'normal' && after !== '""')) out.push('pseudo-element-content');
    if ((node.dataset.ppt === 'shape' || node.dataset.ppt === 'box') && node.childElementCount) {
      const directText = Array.from(node.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      const unmarkedBranch = Array.from(node.children).some(child => !child.matches('[data-ppt]') && !child.querySelector('[data-ppt]'));
      if (directText || unmarkedBranch) out.push('unmarked-shape-content');
    }
    if (node.dataset.ppt === 'text') {
      if (node.childElementCount) out.push('rich-text-flattened');
      if (cleanColor(cs.backgroundColor) && px(cs.borderTopLeftRadius) > 0) out.push('text-background-radius');
      if ([cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].some(v => px(v) > 0)) out.push('text-box-border');
      const pads = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px);
      if (Math.max(...pads) - Math.min(...pads) > 0.5) out.push('non-uniform-text-padding');
    }
    const borderWidths = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
    if (Math.max(...borderWidths) - Math.min(...borderWidths) > 0.5) out.push('non-uniform-border');
    return out;
  }

  function textElement(node, base, cs) {
    const fontPx = px(cs.fontSize) * base._sx;
    const linePx = px(cs.lineHeight);
    const bg = cleanColor(cs.backgroundColor);
    return {
      ...base,
      elType: 'text', role: node.dataset.role || 'text',
      text: node.dataset.pptText ?? node.innerText ?? node.textContent ?? '',
      fontSize: Math.round(fontPx * 100) / 100,
      fontFamily: cs.fontFamily,
      bold: Number.parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold',
      italic: cs.fontStyle === 'italic',
      fill: cs.color,
      ...(bg ? { bgFill: bg } : {}),
      align: ['left', 'center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : 'left',
      verticalAlign: node.dataset.valign || 'top',
      lineHeight: linePx && px(cs.fontSize) ? Math.round(linePx / px(cs.fontSize) * 100) / 100 : 1.25,
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing) * base._sx,
      padding: Math.min(px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)) * base._sx,
      underline: cs.textDecorationLine?.includes('underline') || false,
      ...boxShadow(cs),
    };
  }

  function shapeElement(node, base, cs) {
    const fill = cleanColor(cs.backgroundColor) || '#00000000';
    const radius = radiusPx(cs.borderTopLeftRadius, base);
    const isEllipse = radius >= Math.min(base.width, base.height) / 2 - 0.5;
    return {
      ...base,
      ...(isEllipse ? { elType: 'shape-circle', x: base.x + base.width / 2, y: base.y + base.height / 2 } : { elType: 'shape-rect' }),
      role: node.dataset.role || 'shape', fill,
      stroke: cleanColor(cs.borderTopColor),
      strokeWidth: px(cs.borderTopWidth) * base._sx,
      ...(!isEllipse ? { cornerRadius: radius } : {}),
      ...boxShadow(cs),
    };
  }

  function imageElement(node, base, cs) {
    // Prefer the browser-resolved URL so a deck written to another directory still finds the source asset.
    const cssUrl = cs.backgroundImage?.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const src = node.currentSrc || node.src || node.getAttribute('src') || cssUrl;
    if (!src) throw new Error(`${base.id}: image 标记缺少 src 或 background-image`);
    return {
      ...base,
      elType: 'image', role: node.dataset.role || 'image',
      ...(String(src).startsWith('data:') ? { data: src } : { path: src }),
      sizing: { type: cs.objectFit === 'contain' || cs.backgroundSize === 'contain' ? 'contain' : 'cover' },
      cornerRadius: radiusPx(cs.borderTopLeftRadius, base),
      altText: node.getAttribute('alt') || '',
    };
  }

  function tableElement(node, base, cs) {
    const hasSpans = Boolean(node.querySelector('td[colspan],td[rowspan],th[colspan],th[rowspan]'));
    return {
      ...base,
      elType: 'table', role: node.dataset.role || 'table',
      rows: Array.from(node.querySelectorAll('tr')).map(row => Array.from(row.cells).map(cell => cell.innerText)),
      fontSize: px(cs.fontSize) * base._sx || 14,
      fontFamily: cs.fontFamily,
      header: { enabled: node.dataset.header !== 'false', fill: node.dataset.headerFill || '#123B5D', color: node.dataset.headerColor || '#FFFFFF' },
      stripeColor: node.dataset.stripeColor || '#F3F6F9',
      borderColor: cleanColor(cs.borderTopColor) || '#D8E1E8',
      ...(hasSpans ? { webUnsupported: ['table-span-flattened'] } : {}),
    };
  }

  function chartElement(node, base) {
    let cfg;
    try { cfg = JSON.parse(node.dataset.chart || '{}'); } catch { throw new Error(`${base.id}: data-chart 不是合法 JSON`); }
    return { ...base, elType: 'chart', role: node.dataset.role || 'chart', ...cfg };
  }

  function nodeToElement(node, slideRect, index) {
    const kind = String(node.dataset.ppt || '').toLowerCase();
    const base = common(node, slideRect, index);
    const cs = getComputedStyle(node);
    let out;
    if (kind === 'text') out = textElement(node, base, cs);
    else if (kind === 'shape' || kind === 'box') out = shapeElement(node, base, cs);
    else if (kind === 'image' || node.tagName === 'IMG') out = imageElement(node, base, cs);
    else if (kind === 'svg' || node.tagName === 'SVG') out = { ...base, elType: 'image-svg', role: node.dataset.role || 'icon', svgXml: node.outerHTML };
    else if (kind === 'table' || node.tagName === 'TABLE') out = tableElement(node, base, cs);
    else if (kind === 'chart') out = chartElement(node, base);
    else if (kind === 'line') out = { ...base, elType: 'shape-line', role: node.dataset.role || 'line', pointArr: [{ x: base.x, y: base.y }, { x: base.x + base.width, y: base.y + base.height }], lineColor: cs.color, lineWidth: Math.max(1, px(cs.borderTopWidth) * base._sx) };
    else throw new Error(`${base.id}: 未知 data-ppt 类型 "${kind || '(empty)'}"`);
    const unsupported = visualWarnings(node, cs);
    if (unsupported.length || out.webUnsupported?.length) out.webUnsupported = [...new Set([...(out.webUnsupported || []), ...unsupported])];
    delete out._sx; delete out._sy;
    return out;
  }

  function backgroundFrom(cs) {
    const image = cs.backgroundImage;
    if (image && image !== 'none' && !image.includes('gradient(')) {
      const m = image.match(/url\(["']?(.*?)["']?\)/);
      if (m) return m[1];
    }
    return cleanColor(cs.backgroundColor) || '#FFFFFF';
  }

  async function extractDeck(opts = {}) {
    if (document.fonts?.ready) await document.fonts.ready;
    const slideNodes = Array.from(document.querySelectorAll('[data-ppt-slide], .ppt-slide'));
    if (!slideNodes.length) throw new Error('未找到 [data-ppt-slide] 或 .ppt-slide');
    const slides = slideNodes.map((slideNode, si) => {
      const slideRect = slideNode.getBoundingClientRect();
      if (!slideRect.width || !slideRect.height) throw new Error(`第 ${si + 1} 个 slide 尺寸为 0`);
      const marked = Array.from(slideNode.querySelectorAll('[data-ppt]'));
      const elements = marked.map((node, i) => nodeToElement(node, slideRect, i)).filter(Boolean)
        .sort((a, b) => a._z - b._z || a._order - b._order)
        .map(el => { delete el._z; delete el._order; return el; });
      const slideWarnings = visualWarnings(slideNode, getComputedStyle(slideNode));
      return {
        id: slideNode.id || `slide-${si + 1}`,
        background: backgroundFrom(getComputedStyle(slideNode)),
        notes: slideNode.dataset.notes,
        ...(slideWarnings.length ? { webUnsupported: slideWarnings } : {}),
        elements,
      };
    });
    return {
      dslVersion: 3,
      meta: { title: opts.title || document.title || 'WebSlide', author: opts.author || '' },
      theme: opts.theme || document.documentElement.dataset.pptTheme || 'clean-minimal',
      slides,
    };
  }

  global.WebSlideExtract = { extractDeck };
})(typeof window !== 'undefined' ? window : globalThis);
