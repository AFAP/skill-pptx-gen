/**
 * ai-ppt-gen 预览核心（浏览器端）：PptxGenJS 演示对象 → HTML DOM 渲染
 *
 * 源自 PptxGenJS-Preview 的 pptxgenjs-preview.js（基于 PptxGenJS 3.12/4.0 内部结构），
 * 修复了原版 renderSlide 在循环内重复 appendChild 的 bug，移除调试日志，
 * 支持 LAYOUT_WIDE / 16x9 / 16x10 / 4x3 自动 DPI 适配。
 *
 * 用途：当你在浏览器中直接编写了原生 PptxGenJS 代码（而非 DSL），可用它预览
 * pptx 对象的真实结构（slide._slideObjects），与 writeFile 导出的效果一致。
 *
 * 用法：
 *   const pptx = new PptxGenJS(); pptx.layout='LAYOUT_WIDE';
 *   const s = pptx.addSlide(); s.addText('Hello', {x:1,y:1,w:5,h:1});
 *   PptxDomPreview.render(pptx, document.getElementById('stage'));
 */
(function (global) {
  'use strict';

  const CSS = `
.pp-slide{position:relative;overflow:hidden;margin:16px auto;background:#fff;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.10)}
.pp-box{position:absolute;box-sizing:border-box;display:flex;flex-wrap:wrap}
.pp-span{white-space:pre-wrap;word-break:break-word}
`;

  const LAYOUTS = {
    '9144000x5143500': { w: 960, h: 540, dpi: 96 },   // LAYOUT_16x9  10x5.625in
    '9144000x5715000': { w: 960, h: 600, dpi: 96 },   // LAYOUT_16x10 10x6.25in
    '9144000x6858000': { w: 960, h: 720, dpi: 96 },   // LAYOUT_4x3   10x7.5in
    '12192000x6858000': { w: 1280, h: 720, dpi: 96 }, // LAYOUT_WIDE  13.333x7.5in
  };

  const COLORS = {
    tx1: '#000000', tx2: '#44546A', bg1: '#FFFFFF', bg2: '#E7E6E6',
    accent1: '#4472C4', accent2: '#ED7D31', accent3: '#A5A5A5',
    accent4: '#FFC000', accent5: '#5B9BD5', accent6: '#70AD47',
  };

  const VALIGN2FLEX = { top: 'flex-start', ctr: 'center', middle: 'center', bottom: 'flex-end' };
  const ALIGN2JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end', justify: 'space-between' };
  const UNDERLINE2CSS = { none: '', sng: 'underline', dbl: 'underline double', heavy: 'underline', dotted: 'underline dotted', dashed: 'underline dashed', wavy: 'underline wavy' };

  let dpi = 96;
  const inch2px = v => (typeof v === 'string' && v.includes('%')) ? v : (v * dpi) + 'px';
  const pt2px = pt => (typeof pt !== 'number') ? pt : (pt * dpi / 72) + 'px';
  const emu2px = emu => Math.round(emu / 9525);

  function hex(c, alphaPct) {
    if (!c) return '';
    if (COLORS[c]) c = COLORS[c];
    const h6 = String(c).replace('#', '');
    if (alphaPct == null) return '#' + h6;
    const a = Math.round(Math.max(0, Math.min(100, alphaPct)) * 255 / 100);
    return '#' + h6 + a.toString(16).padStart(2, '0');
  }

  function applyBox(el, opt) {
    el.style.left = inch2px(opt.x || 0);
    el.style.top = inch2px(opt.y || 0);
    el.style.width = inch2px(opt.w || 0);
    el.style.height = inch2px(opt.h || 0);
    el.style.alignItems = VALIGN2FLEX[opt.valign] || 'center';
    el.style.justifyContent = ALIGN2JUSTIFY[opt.align] || 'flex-start';
    if (opt.margin) el.style.padding = opt.margin + 'px';
    if (opt.rotate) el.style.transform = `rotate(${opt.rotate}deg)`;
  }

  function applyShadow(el, s) {
    if (!s || s.type !== 'outer') return;
    const pxOff = emu2px(s.offset || 0);
    const pxBlur = emu2px(s.blur || 0);
    const rad = (s.angle || 0) * Math.PI / 180;
    const x = pxOff * Math.cos(rad), y = pxOff * Math.sin(rad);
    el.style.filter = `drop-shadow(${x}px ${y}px ${pxBlur}px ${hex(s.color, (s.opacity ?? 50))})`;
  }

  function applyShape(el, obj) {
    const opt = obj.options || {};
    const f = opt.fill;
    if (f && f.color) el.style.backgroundColor = hex(f.color, f.transparency != null ? 100 - f.transparency : undefined);
    const l = opt.line;
    if (l && l.color && l.width) {
      el.style.border = `${l.width}pt ${l.dashType === 'dash' ? 'dashed' : 'solid'} ${hex(l.color, l.transparency != null ? 100 - l.transparency : undefined)}`;
    }
    if (opt.shadow) applyShadow(el, opt.shadow);
    const shape = obj.shape || obj._type;
    if (shape === 'ellipse' || shape === 'oval') el.style.borderRadius = '50%';
    else if (shape === 'roundRect') el.style.borderRadius = '8px';
  }

  function renderBackground(dom, bg) {
    if (!bg) return;
    if (bg.color) dom.style.backgroundColor = hex(bg.color);
    if (bg.path || bg.data) {
      dom.style.backgroundImage = `url(${bg.path || ('data:image/png;base64,' + bg.data)})`;
      dom.style.backgroundSize = '100% 100%';
    }
  }

  function renderText(dom, obj) {
    const box = document.createElement('div');
    box.className = 'pp-box';
    applyBox(box, obj.options || {});
    applyShape(box, obj);
    (obj.text || []).forEach(t => {
      const o = t.options || {};
      const span = document.createElement('span');
      span.className = 'pp-span';
      span.style.color = hex(o.color);
      span.style.fontSize = pt2px(o.fontSize);
      span.style.fontWeight = o.bold ? 'bold' : 'normal';
      span.style.fontStyle = o.italic ? 'italic' : '';
      span.style.fontFamily = o.fontFace || '';
      span.style.width = o.breakLine ? '100%' : 'auto';
      if (o.underline && o.underline.style) span.style.textDecoration = UNDERLINE2CSS[o.underline.style] || 'underline';
      if (o.underline && o.underline.color) span.style.textDecorationColor = hex(o.underline.color);
      if (o.subscript) span.style.verticalAlign = 'sub';
      if (o.superscript) span.style.verticalAlign = 'super';
      if (o.shadow) applyShadow(span, o.shadow);
      span.textContent = t.text;
      box.appendChild(span);
    });
    dom.appendChild(box);
  }

  function renderImage(dom, obj) {
    const opt = obj.options || {};
    const img = document.createElement('img');
    img.className = 'pp-box';
    applyBox(img, opt);
    img.src = obj.image;
    img.style.objectFit = opt.sizing && opt.sizing.type === 'contain' ? 'contain' : 'fill';
    applyShape(img, obj);
    dom.appendChild(img);
  }

  function renderShapeBox(dom, obj) {
    const div = document.createElement('div');
    div.className = 'pp-box';
    applyBox(div, obj.options || {});
    applyShape(div, obj);
    const opt = obj.options || {};
    if ((obj._type === 'line') && opt.line) {
      div.style.background = hex(opt.line.color);
      div.style.height = pt2px(opt.line.width || 1);
      if (opt.line.dashType === 'dash') {
        div.style.background = 'none';
        div.style.borderTop = `${pt2px(opt.line.width || 1)} dashed ${hex(opt.line.color)}`;
      }
    }
    dom.appendChild(div);
  }

  const RENDERERS = {
    text: renderText,
    image: renderImage,
    line: renderShapeBox,
    ellipse: renderShapeBox,
    rect: renderShapeBox,
    roundRect: renderShapeBox,
  };

  function renderSlide(stage, slide, scale = 1) {
    const key = `${slide._presLayout.width}x${slide._presLayout.height}`;
    const layout = LAYOUTS[key] || LAYOUTS['12192000x6858000'];
    dpi = layout.dpi;

    const dom = document.createElement('div');
    dom.className = 'pp-slide';
    dom.style.width = layout.w + 'px';
    dom.style.height = layout.h + 'px';
    if (scale !== 1) {
      dom.style.transform = `scale(${scale})`;
      dom.style.transformOrigin = 'top center';
      dom.style.marginBottom = (layout.h * (scale - 1) + 16) + 'px';
    }
    renderBackground(dom, slide._background);
    for (const obj of slide._slideObjects || []) {
      const r = RENDERERS[obj._type];
      if (r) {
        try { r(dom, obj); } catch (e) { console.warn('[PptxDomPreview] 渲染失败:', obj._type, e); }
      }
    }
    stage.appendChild(dom); // 修复：原版在 forEach 内重复 append
  }

  /** 渲染整个 pptx 对象 */
  function render(pptx, container, opts = {}) {
    if (!document.getElementById('pp-style')) {
      const style = document.createElement('style');
      style.id = 'pp-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    container.innerHTML = '';
    (pptx.slides || []).forEach(slide => renderSlide(container, slide, opts.scale || 1));
  }

  global.PptxDomPreview = { render, renderSlide };
})(typeof window !== 'undefined' ? window : globalThis);
