/**
 * ai-ppt-gen 预览核心（浏览器端）：PPT-DSL → Konva 渲染
 *
 * 源自 aippt 项目 canvas-lite.js，去除硬编码（图片 URL 前缀），新增：
 * chart（柱/线/饼/环形 原生 Konva 绘制）、table、渐变填充、文本溢出省略提示。
 *
 * 用法：
 *   <script src="assets/konva.10.0.12.min.js"></script>
 *   <script src="core/ppt-preview-core.js"></script>
 *   PptPreview.renderDeck(deck, document.getElementById('app'), { scale: 0.8, editable: true })
 *
 * 全局命名空间：window.PptPreview
 */
(function (global) {
  'use strict';

  const PPT_WIDTH = 1280;
  const PPT_HEIGHT = 720;

  /* ---------- 工具 ---------- */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败: ' + String(src).slice(0, 120)));
      img.src = src;
    });
  }

  function svgToDataUri(svgXml) {
    return 'data:image/svg+xml;base64,' + window.btoa(unescape(encodeURIComponent(svgXml)));
  }

  function konvaShadow(elop) {
    if (elop.shadow && typeof elop.shadow === 'object') {
      const rad = (elop.shadow.angle || 45) * Math.PI / 180;
      const off = elop.shadow.offset || 4;
      return {
        shadowColor: elop.shadow.color ? '#' + String(elop.shadow.color).replace('#', '') : '#000000',
        shadowBlur: elop.shadow.blur || 8,
        shadowOffsetX: Math.cos(rad) * off,
        shadowOffsetY: Math.sin(rad) * off,
        shadowOpacity: elop.shadow.opacity ?? 0.3,
        shadowEnabled: true,
      };
    }
    if (elop.shadowColor || elop.shadowBlur) {
      return {
        shadowColor: elop.shadowColor || 'rgba(0,0,0,0.3)',
        shadowBlur: elop.shadowBlur || 8,
        shadowOffsetX: elop.shadowOffsetX ?? elop.shadowOffset?.x ?? 0,
        shadowOffsetY: elop.shadowOffsetY ?? elop.shadowOffset?.y ?? 4,
        shadowOpacity: elop.shadowOpacity ?? 0.5,
        shadowEnabled: true,
      };
    }
    return { shadowEnabled: false };
  }

  function konvaFill(elop) {
    const f = elop.fill;
    if (f && typeof f === 'object' && f.type === 'gradient' && Array.isArray(f.stops) && f.stops.length >= 2) {
      const stops = [];
      f.stops.forEach(s => stops.push(s.offset, s.color));
      if (f.angle != null) {
        const rad = f.angle * Math.PI / 180;
        const w = elop.width || 0, h = elop.height || 0;
        return {
          fillLinearGradientStartPoint: { x: 0, y: 0 },
          fillLinearGradientEndPoint: { x: Math.cos(rad) * w, y: Math.sin(rad) * h },
          fillLinearGradientColorStops: stops,
        };
      }
      return { fillRadialGradientStartPoint: { x: (elop.width || 0) / 2, y: (elop.height || 0) / 2 }, fillRadialGradientEndPoint: { x: (elop.width || 0) / 2, y: (elop.height || 0) / 2 }, fillRadialGradientStartRadius: 0, fillRadialGradientEndRadius: Math.max(elop.width || 0, elop.height || 0) / 2, fillRadialGradientColorStops: stops };
    }
    if (f && typeof f === 'object' && f.color) return { fill: '#' + String(f.color).replace('#', '') };
    if (typeof f === 'string') return { fill: f };
    return {};
  }

  function dashArray(elop) {
    const d = elop.dashType || elop.dash;
    if (d === 'dash' || d === true) return [8, 6];
    if (Array.isArray(d) && d.length) return d;
    return undefined;
  }

  /* ---------- 元素渲染 ---------- */

  async function renderImage(elop, group, layer) {
    const src = elop._data || elop.data || elop.path || elop.url;
    if (!src) {
      // 仅有 prompt（AI 生图占位）：画占位框
      const ph = new Konva.Rect({
        x: elop.x, y: elop.y, width: elop.width, height: elop.height,
        fill: '#EEF2F7', stroke: '#CBD5E1', strokeWidth: 1, dash: [6, 6],
        cornerRadius: elop.cornerRadius || 0,
      });
      const label = new Konva.Text({
        x: elop.x, y: elop.y, width: elop.width, height: elop.height,
        text: '🖼 ' + (elop.prompt ? String(elop.prompt).slice(0, 40) + '…' : '待生成图片'),
        fontSize: 14, fill: '#94A3B8', align: 'center', verticalAlign: 'middle',
      });
      group.add(ph, label);
      return;
    }
    try {
      const img = await loadImage(src);
      const kimg = new Konva.Image({
        x: elop.x, y: elop.y, width: elop.width, height: elop.height,
        image: img, rotation: elop.rotation || elop.rotate || 0,
        opacity: elop.opacity ?? 1, cornerRadius: elop.cornerRadius || 0,
        ...konvaShadow(elop),
      });
      // cover 裁剪
      const sizing = elop.sizing;
      if (!sizing || sizing.type === 'cover') {
        const scale = Math.max(elop.width / img.width, elop.height / img.height);
        const cw = elop.width / scale, ch = elop.height / scale;
        kimg.crop({ x: (img.width - cw) / 2, y: (img.height - ch) / 2, width: cw, height: ch });
      }
      group.add(kimg);
    } catch (e) {
      const ph = new Konva.Rect({ x: elop.x, y: elop.y, width: elop.width, height: elop.height, fill: '#FEE2E2', stroke: '#FCA5A5', strokeWidth: 1 });
      const label = new Konva.Text({ x: elop.x, y: elop.y, width: elop.width, height: elop.height, text: '图片加载失败', fontSize: 13, fill: '#B91C1C', align: 'center', verticalAlign: 'middle' });
      group.add(ph, label);
    }
  }

  async function renderImageSvg(elop, group) {
    try {
      const img = await loadImage(svgToDataUri(elop.svgXml || ''));
      group.add(new Konva.Image({ x: elop.x, y: elop.y, width: elop.width, height: elop.height, image: img, opacity: elop.opacity ?? 1 }));
    } catch (e) { /* 忽略失败 svg */ }
  }

  function renderText(elop, group, layer, opts) {
    const cfg = {
      x: elop.x, y: elop.y, width: elop.width, height: elop.height,
      text: String(elop.text ?? ''),
      fontSize: elop.fontSize || 18,
      fontFamily: elop.fontFamily || opts.fontFamily || 'Microsoft YaHei, PingFang SC, sans-serif',
      fontStyle: elop.fontStyle || (elop.bold ? 'bold' : '') + (elop.italic ? ' italic' : '') || 'normal',
      fill: typeof elop.fill === 'string' ? elop.fill : (elop.fill?.color ? '#' + String(elop.fill.color).replace('#', '') : '#111111'),
      align: elop.align || 'left',
      verticalAlign: elop.verticalAlign || elop.valign || 'top',
      lineHeight: elop.lineHeight || 1.25,
      letterSpacing: elop.letterSpacing || 0,
      padding: elop.padding || 0,
      rotation: elop.rotation || elop.rotate || 0,
      opacity: elop.opacity ?? 1,
      wrap: elop.wrap || 'word',
      ellipsis: elop.ellipsis || false,
      ...konvaShadow(elop),
    };
    if (elop.underline) cfg.textDecoration = 'underline';
    if (elop.strikethrough) cfg.textDecoration = 'line-through';
    const node = new Konva.Text(cfg);
    node._elop = elop; // 保留 DSL 引用：双击编辑后可回写 deck（用于导出修改后的 deck.json）
    group.add(node);
    if (opts.editable) attachTextEditor(node, layer, opts);
    return node;
  }

  function renderTextPath(elop, group) {
    group.add(new Konva.TextPath(elop));
  }

  function renderRect(elop, group) {
    group.add(new Konva.Rect({
      x: elop.x, y: elop.y, width: elop.width, height: elop.height,
      cornerRadius: elop.cornerRadius ?? elop.rectRadius ?? 0,
      rotation: elop.rotation || elop.rotate || 0,
      opacity: elop.opacity ?? 1,
      ...konvaFill(elop),
      stroke: elop.stroke, strokeWidth: elop.strokeWidth,
      dash: dashArray(elop),
      ...konvaShadow(elop),
    }));
  }

  function renderCircle(elop, group) {
    const r = elop.radius || (elop.width || 0) / 2;
    group.add(new Konva.Circle({
      x: elop.x, y: elop.y, radius: r, // DSL 约定：x/y 为圆心
      opacity: elop.opacity ?? 1,
      ...konvaFill(elop),
      stroke: elop.stroke, strokeWidth: elop.strokeWidth,
      dash: dashArray(elop),
      ...konvaShadow(elop),
    }));
  }

  function renderLine(elop, group) {
    const pts = (elop.pointArr || []).flatMap(p => [p.x, p.y]);
    if (pts.length < 4) return;
    group.add(new Konva.Line({
      points: pts,
      stroke: elop.lineColor || elop.stroke || '#333333',
      strokeWidth: elop.lineWidth || elop.strokeWidth || 2,
      dash: dashArray(elop),
      lineCap: 'round', lineJoin: 'round',
      opacity: elop.opacity ?? 1,
    }));
  }

  function renderArrow(elop, group) {
    const pts = (elop.pointArr || []).flatMap(p => [p.x, p.y]);
    if (pts.length < 4) return;
    const lw = elop.lineWidth || 2;
    group.add(new Konva.Arrow({
      points: pts,
      pointerLength: lw * 2.4, pointerWidth: lw * 2.2,
      stroke: elop.lineColor || elop.stroke || '#333333',
      strokeWidth: lw,
      fill: elop.lineColor || elop.stroke || '#333333',
      opacity: elop.opacity ?? 1,
    }));
  }

  function renderCurve(elop, group) {
    let d = '';
    (elop.pointArr || []).forEach((p, i) => {
      if (i === 0) d = `M ${p.x} ${p.y}`;
      else if (p.controlPoint && p.controlPoint.type === 'quadratic') d += ` Q ${p.controlPoint.x} ${p.controlPoint.y} ${p.x} ${p.y}`;
      else d += ` L ${p.x} ${p.y}`;
    });
    if (!d) return;
    group.add(new Konva.Path({
      x: elop.x || 0, y: elop.y || 0, data: d,
      stroke: elop.stroke || '#333333', strokeWidth: elop.strokeWidth || 2,
      dash: dashArray(elop), opacity: elop.opacity ?? 1,
    }));
  }

  function renderPath(elop, group) {
    if (!elop.data) return;
    group.add(new Konva.Path({
      x: elop.x || 0, y: elop.y || 0, data: elop.data,
      ...konvaFill(elop),
      stroke: elop.stroke, strokeWidth: elop.strokeWidth,
      dash: dashArray(elop), opacity: elop.opacity ?? 1,
      lineCap: elop.lineCap || 'butt',
    }));
  }

  /* ---------- chart：原生 Konva 简绘（预览用，导出 PPTX 为真实可编辑图表） ---------- */
  function renderChart(elop, group) {
    const { x = 0, y = 0, width: w = 400, height: h = 300 } = elop;
    const series = Array.isArray(elop.data) ? elop.data : [];
    const labels = elop.labels || series[0]?.labels || [];
    const colors = (elop.chartColors && elop.chartColors.length ? elop.chartColors : ['#4A90E2', '#6CC215', '#F5A623', '#9C27B0', '#00BCD4', '#ED7D31'])
      .map(c => typeof c === 'string' && !c.startsWith('#') && !c.startsWith('rgb') ? '#' + c : c);
    const type = elop.chartType || 'bar';
    const padL = 8, padB = 8, padT = 8;
    const cw = w - padL * 2, ch = h - padT - padB;

    const allVals = series.flatMap(s => s.values || []);
    const maxV = Math.max(1, ...allVals.map(v => Math.abs(Number(v) || 0)));

    if (type === 'pie' || type === 'doughnut') {
      const vals = series[0]?.values || [];
      const total = vals.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2 - 6;
      let angle = -90;
      vals.forEach((v, i) => {
        const sweep = (Number(v) || 0) / total * 360;
        group.add(new Konva.Wedge({
          x: cx, y: cy, radius: r, angle: sweep, rotation: angle,
          fill: colors[i % colors.length],
          ...(type === 'doughnut' ? { innerRadius: r * 0.55 } : {}),
        }));
        angle += sweep;
      });
      if (type === 'doughnut') { /* Konva.Wedge 无 innerRadius，用白圆覆盖 */ 
        group.add(new Konva.Circle({ x: cx, y: cy, radius: r * 0.55, fill: elop._bg || '#FFFFFF' }));
      }
      return;
    }

    if (type === 'line' || type === 'area' || type === 'radar') {
      const n = Math.max(2, labels.length || series[0]?.values?.length || 2);
      series.forEach((s, si) => {
        const pts = (s.values || []).map((v, i) => [
          x + padL + (cw * i) / (n - 1),
          y + padT + ch - (Number(v) || 0) / maxV * ch,
        ]);
        group.add(new Konva.Line({
          points: pts.flat(), stroke: colors[si % colors.length], strokeWidth: 2,
          lineCap: 'round', lineJoin: 'round',
          ...(type === 'area' ? { closed: false, fill: colors[si % colors.length] + '33', tension: 0.2 } : { tension: 0.2 }),
        }));
        pts.forEach(p => group.add(new Konva.Circle({ x: p[0], y: p[1], radius: 3, fill: colors[si % colors.length] })));
      });
      return;
    }

    // bar（默认）
    const n = labels.length || series[0]?.values?.length || 1;
    const slot = cw / n;
    const bw = Math.min(slot * 0.7 / Math.max(1, series.length), 60);
    for (let i = 0; i < n; i++) {
      series.forEach((s, si) => {
        const v = Number(s.values?.[i]) || 0;
        const bh = (v / maxV) * ch;
        group.add(new Konva.Rect({
          x: x + padL + slot * i + slot / 2 - (bw * series.length) / 2 + si * bw,
          y: y + padT + ch - bh,
          width: bw * 0.9, height: bh,
          fill: colors[si % colors.length], cornerRadius: [3, 3, 0, 0],
        }));
      });
    }
    // 轴线
    group.add(new Konva.Line({ points: [x + padL, y + padT + ch, x + padL + cw, y + padT + ch], stroke: '#CBD5E1', strokeWidth: 1 }));
  }

  /* ---------- table ---------- */
  function renderTable(elop, group, opts) {
    const rows = elop.rows || [];
    if (!rows.length) return;
    const { x = 0, y = 0, width: w = 600, height: h = 200 } = elop;
    const cols = Math.max(...rows.map(r => r.length));
    const rh = h / rows.length, cw = w / cols;
    const fontSize = elop.fontSize || 16;
    const headerOn = elop.header?.enabled !== false;
    const hdFill = elop.header?.fill || '#4A90E2';
    const hdColor = elop.header?.color || '#FFFFFF';
    rows.forEach((row, ri) => {
      for (let ci = 0; ci < cols; ci++) {
        const isHd = headerOn && ri === 0;
        const bg = isHd ? hdFill : (ri % 2 === 0 && elop.stripeColor ? elop.stripeColor : '#FFFFFF');
        group.add(new Konva.Rect({ x: x + ci * cw, y: y + ri * rh, width: cw, height: rh, fill: bg, stroke: elop.borderColor || '#E2E8F0', strokeWidth: 1 }));
        group.add(new Konva.Text({
          x: x + ci * cw + 6, y: y + ri * rh, width: cw - 12, height: rh,
          text: String(row[ci] ?? ''), fontSize, fontFamily: opts.fontFamily,
          fontStyle: isHd && elop.header?.bold !== false ? 'bold' : 'normal',
          fill: isHd ? hdColor : (elop.color || '#1F2937'),
          align: elop.align || 'left', verticalAlign: 'middle',
        }));
      }
    });
  }

  /* ---------- 文本编辑（双击浮层） ---------- */
  function attachTextEditor(textNode, layer, opts) {
    textNode.on('dblclick dbltap', () => {
      const stage = textNode.getStage();
      if (!stage) return;
      const stageBox = stage.container().getBoundingClientRect();
      const pos = textNode.absolutePosition();
      const scale = stage.scaleX() || 1;
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      Object.assign(textarea.style, {
        position: 'fixed', zIndex: 9999,
        top: (stageBox.top + pos.y * scale) + 'px',
        left: (stageBox.left + pos.x * scale) + 'px',
        width: textNode.width() * scale + 'px',
        height: Math.max(textNode.height() * scale, 40) + 'px',
        fontSize: textNode.fontSize() * scale + 'px',
        fontFamily: textNode.fontFamily(), color: textNode.fill(),
        textAlign: textNode.align(), lineHeight: textNode.lineHeight() || 1.25,
        border: '2px solid #2563EB', borderRadius: '4px', background: 'rgba(255,255,255,0.98)',
        outline: 'none', resize: 'none', padding: '4px', margin: '0',
      });
      textarea.value = textNode.text();
      textarea.focus();
      const finish = commit => {
        if (commit) {
          textNode.text(textarea.value);
          layer.batchDraw();
          if (typeof opts.onTextEdit === 'function') opts.onTextEdit(textNode, textarea.value);
        }
        textarea.remove();
      };
      textarea.addEventListener('blur', () => finish(true));
      textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') finish(false);
      });
    });
  }

  /* ---------- 主入口 ---------- */

  const renderers = {
    'image': renderImage,
    'image-svg': renderImageSvg,
    'text': renderText,
    'text-path': renderTextPath,
    'shape-rect': renderRect,
    'shape-circle': renderCircle,
    'shape-line': renderLine,
    'shape-arrow': renderArrow,
    'curve-quadratic': renderCurve,
    'shape-path': renderPath,
    'chart': renderChart,
    'table': renderTable,
  };

  /** 渲染一组元素到 Konva.Group */
  async function renderElements(elops, group, layer, opts = {}) {
    for (const elop of elops || []) {
      const r = renderers[elop.elType];
      if (!r) { console.warn('[PptPreview] 未知 elType:', elop.elType); continue; }
      try { await r(elop, group, layer, opts); } catch (e) { console.warn('[PptPreview] 渲染失败:', elop.elType, e); }
    }
    layer.batchDraw();
  }

  /**
   * 渲染整套 deck 到容器（每页一个 Stage，纵向排列）
   * @param deck { slides: [{ elements, background? }] }
   * @param container DOM 容器
   * @param opts { scale, editable, onTextEdit, pageGap, fontFamily }
   * @returns stages 数组
   */
  async function renderDeck(deck, container, opts = {}) {
    const scale = opts.scale || 1;
    const gap = opts.pageGap ?? 24;
    container.innerHTML = '';
    const stages = [];
    for (let i = 0; i < (deck.slides || []).length; i++) {
      const slideSpec = deck.slides[i];
      const holder = document.createElement('div');
      holder.style.cssText = `width:${PPT_WIDTH * scale}px;height:${PPT_HEIGHT * scale}px;margin:${gap / 2}px auto;box-shadow:0 4px 24px rgba(0,0,0,0.12);border-radius:4px;overflow:hidden;`;
      container.appendChild(holder);
      const stage = new Konva.Stage({ container: holder, width: PPT_WIDTH * scale, height: PPT_HEIGHT * scale, scaleX: scale, scaleY: scale });
      const layer = new Konva.Layer();
      stage.add(layer);
      const bg = slideSpec.background || '#FFFFFF';
      layer.add(new Konva.Rect({ x: 0, y: 0, width: PPT_WIDTH, height: PPT_HEIGHT, fill: typeof bg === 'string' ? bg : '#FFFFFF' }));
      await renderElements(slideSpec.elements, layer, layer, opts);
      stages.push(stage);
    }
    return stages;
  }

  global.PptPreview = { renderDeck, renderElements, PPT_WIDTH, PPT_HEIGHT };
})(typeof window !== 'undefined' ? window : globalThis);
