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
    const slide = node.closest('[data-ppt-slide], .ppt-slide');
    let matrix = new DOMMatrix(), opacity = 1;
    const warnings = [];
    for (let current = node; current && current !== slide; current = current.parentElement) {
      const style = getComputedStyle(current);
      opacity *= Number(style.opacity || 1);
      if (style.transform !== 'none') matrix = new DOMMatrix(style.transform).multiply(matrix);
      if (['rotate', 'scale', 'translate'].some(k => style[k] && style[k] !== 'none')) warnings.push('individual-transform-properties');
      if (current !== node) {
        if (['filter', 'clipPath', 'maskImage', 'mixBlendMode'].some(k => style[k] && !['none', 'normal'].includes(style[k]))) warnings.push('ancestor-visual-effect');
        if (Number(style.opacity) < 1 && current.querySelectorAll('[data-ppt]').length > 1) warnings.push('group-opacity-compositing');
        if (style.zIndex !== 'auto' || style.isolation === 'isolate') warnings.push('nested-stacking-context');
        if (!current.hasAttribute('data-ppt') && (cleanColor(style.backgroundColor) || style.backgroundImage !== 'none')) warnings.push('unmarked-container-background');
        const clip = current.getBoundingClientRect();
        const clipsX = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX);
        const clipsY = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY);
        if ((clipsX && (r.left < clip.left - 0.5 || r.right > clip.right + 0.5)) || (clipsY && (r.top < clip.top - 0.5 || r.bottom > clip.bottom + 0.5))) warnings.push('ancestor-overflow-clip');
      }
    }
    const cs = getComputedStyle(node);
    const borderWidth = px(cs.width) + (cs.boxSizing === 'border-box' ? 0 : px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth));
    const borderHeight = px(cs.height) + (cs.boxSizing === 'border-box' ? 0 : px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth));
    const scaleX = Math.hypot(matrix.a, matrix.b), scaleY = Math.hypot(matrix.c, matrix.d);
    const orthogonal = Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) < 0.0001;
    if (!matrix.is2D || !orthogonal || matrix.a * matrix.d - matrix.b * matrix.c <= 0) warnings.push('transform-skew-reflection-or-3d');
    if (Math.abs(sx - sy) > 0.0001) warnings.push('non-uniform-slide-scale');
    const rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    // A rotated rectangle's bounding-box centre is its transformed centre.
    // Recover edge lengths; never rotate the already-expanded bounding box again.
    const width = (borderWidth || r.width) * scaleX * sx;
    const height = (borderHeight || r.height) * scaleY * sy;
    return {
      x: Math.round(((r.left + r.width / 2 - slideRect.left) * sx - width / 2) * 100) / 100,
      y: Math.round(((r.top + r.height / 2 - slideRect.top) * sy - height / 2) * 100) / 100,
      width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100,
      rotation: Math.round(rotation * 100) / 100, opacity,
      _sx: sx * scaleX, _sy: sy * scaleY, _warnings: warnings,
    };
  }

  function common(node, slideRect, index) {
    const g = geom(node, slideRect);
    const cs = getComputedStyle(node);
    return {
      id: node.id || node.dataset.pptId || `web-${index}`,
      x: g.x, y: g.y, width: g.width, height: g.height,
      opacity: g.opacity,
      rotation: g.rotation,
      _warnings: g._warnings,
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
    if (new Set([cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]).size > 1) out.push('non-uniform-radius');
    if (node.tagName === 'IMG' && cs.objectPosition !== '50% 50%') out.push('image-object-position');
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
    const percentageRadius = String(cs.borderTopLeftRadius).includes('%') && px(cs.borderTopLeftRadius) >= 50;
    const isEllipse = percentageRadius || (Math.abs(base.width - base.height) < 0.5 && radius >= base.width / 2);
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
    const unsupported = [...(base._warnings || []), ...visualWarnings(node, cs)];
    if (unsupported.length || out.webUnsupported?.length) out.webUnsupported = [...new Set([...(out.webUnsupported || []), ...unsupported])];
    delete out._sx; delete out._sy; delete out._warnings;
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
      const omitted = [];
      const elements = marked.map((node, i) => {
        const cs = getComputedStyle(node);
        if (!node.getClientRects().length || ['hidden', 'collapse'].includes(cs.visibility)) {
          omitted.push({ id: node.id || node.dataset.pptId || `web-${i}`, reason: 'css-hidden' });
          return null;
        }
        return nodeToElement(node, slideRect, i);
      }).filter(Boolean)
        .sort((a, b) => a._z - b._z || a._order - b._order)
        .map(el => { delete el._z; delete el._order; return el; });
      const slideWarnings = visualWarnings(slideNode, getComputedStyle(slideNode));
      return {
        id: slideNode.id || `slide-${si + 1}`,
        background: backgroundFrom(getComputedStyle(slideNode)),
        notes: slideNode.dataset.notes,
        ...(slideWarnings.length ? { webUnsupported: slideWarnings } : {}),
        ...(omitted.length ? { webOmitted: omitted } : {}),
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
