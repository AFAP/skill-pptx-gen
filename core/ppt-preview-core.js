/**
 * ai-ppt-gen 预览核心（浏览器端）：PPT-DSL → Konva 渲染
 *
 * 与 Node 导出（core/dsl-to-pptx.mjs）保持 WYSIWYG 一致：
 * - 图片默认 cover 裁满（contain 完整容纳居中），与导出 sizing 一致
 * - text 的 bgFill 会在文字下垫同尺寸色块（导出端同样输出）
 * - chart 绘制坐标标签/图例/radar 蛛网/scatter 散点（导出为真实可编辑图表）
 *
 * 用法：
 *   const stages = PptPreview.renderDeck(deck, container, { scale, editable, onTextEdit })
 *   // 返回 [{ stage, layer, holder }]；缩放用 PptPreview.applyZoom(stages, scale)，无需重建
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

  function isColorStr(s) {
    return typeof s === 'string' && (/^#/.test(s) || /^rgb/.test(s) || ['white', 'black', 'transparent'].includes(s.toLowerCase()));
  }

  /** 颜色字符串/对象 → Konva fill（对象形式的 transparency 转成 rgba，与导出端一致） */
  function colorToFill(c) {
    if (c && typeof c === 'object') {
      if (!c.color) return null;
      let hex = String(c.color).replace('#', '');
      if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split('').map(ch => ch + ch).join('');
      const transparency = c.transparency != null ? c.transparency : 0;
      const alpha = Math.min(1, Math.max(0, 1 - transparency / 100));
      if (alpha >= 1) return '#' + hex.toUpperCase();
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    return typeof c === 'string' ? c : null;
  }

  /** 对象填充（含 transparency）与字符串填充统一交给 Konva */
  function fillAttr(c) {
    const v = colorToFill(c);
    return v ? { fill: v } : {};
  }


  /** 估算文本像素宽（中文全宽、ASCII 0.55） */
  function estTextWidth(text, fontSize) {
    let u = 0;
    for (const ch of String(text)) u += ch.charCodeAt(0) > 255 ? 1 : 0.55;
    return u * fontSize;
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
        shadowOpacity: elop.shadowOpacity ?? 0.3,
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
        return {
          fillLinearGradientStartPoint: { x: 0, y: 0 },
          fillLinearGradientEndPoint: { x: Math.cos(rad) * (elop.width || 0), y: Math.sin(rad) * (elop.height || 0) },
          fillLinearGradientColorStops: stops,
        };
      }
      return { fillRadialGradientStartPoint: { x: (elop.width || 0) / 2, y: (elop.height || 0) / 2 }, fillRadialGradientEndPoint: { x: (elop.width || 0) / 2, y: (elop.height || 0) / 2 }, fillRadialGradientStartRadius: 0, fillRadialGradientEndRadius: Math.max(elop.width || 0, elop.height || 0) / 2, fillRadialGradientColorStops: stops };
    }
    if (f && typeof f === 'object' && f.color) return fillAttr(f);
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

  async function renderImage(elop, group) {
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
      const sizing = elop.sizing?.type === 'contain' ? 'contain' : 'cover'; // 默认 cover，与导出一致
      const cfg = {
        x: elop.x, y: elop.y, rotation: elop.rotation || elop.rotate || 0,
        opacity: elop.opacity ?? 1, cornerRadius: elop.cornerRadius || 0, stroke: elop.stroke, strokeWidth: elop.strokeWidth,
        image: img, ...konvaShadow(elop),
      };
      if (sizing === 'contain') {
        // 完整容纳：等比缩放置中（不拉伸）
        const scale = Math.min(elop.width / img.width, elop.height / img.height);
        cfg.width = img.width * scale;
        cfg.height = img.height * scale;
        cfg.x = elop.x + (elop.width - cfg.width) / 2;
        cfg.y = elop.y + (elop.height - cfg.height) / 2;
      } else {
        // 裁满：居中裁剪
        const scale = Math.max(elop.width / img.width, elop.height / img.height);
        const cw = elop.width / scale, ch = elop.height / scale;
        cfg.width = elop.width;
        cfg.height = elop.height;
        cfg.crop = { x: (img.width - cw) / 2, y: (img.height - ch) / 2, width: cw, height: ch };
      }
      group.add(new Konva.Image(cfg));
    } catch (e) {
      const ph = new Konva.Rect({ x: elop.x, y: elop.y, width: elop.width, height: elop.height, fill: '#FEE2E2', stroke: '#FCA5A5', strokeWidth: 1 });
      const label = new Konva.Text({ x: elop.x, y: elop.y, width: elop.width, height: elop.height, text: '图片加载失败', fontSize: 13, fill: '#B91C1C', align: 'center', verticalAlign: 'middle' });
      group.add(ph, label);
    }
  }

  async function renderImageSvg(elop, group) {
    try {
      const img = await loadImage(svgToDataUri(elop.svgXml || ''));
      group.add(new Konva.Image({
        x: elop.x, y: elop.y, width: elop.width, height: elop.height, image: img,
        opacity: elop.opacity ?? 1, rotation: elop.rotation || elop.rotate || 0,
        ...konvaShadow(elop),
      }));
    } catch (e) { /* 忽略失败 svg */ }
  }

  function renderText(elop, group, layer, opts) {
    // 文本框底色（bgFill）：先垫同尺寸色块（含 transparency/rotation），与导出端一致
    if (elop.bgFill) {
      group.add(new Konva.Rect({
        x: elop.x, y: elop.y, width: elop.width, height: elop.height,
        ...fillAttr(elop.bgFill),
        cornerRadius: elop.bgRadius || 0,
        rotation: elop.rotation || elop.rotate || 0,
        opacity: elop.bgOpacity ?? 1,
      }));
    }
    const cfg = {
      x: elop.x, y: elop.y, width: elop.width, height: elop.height,
      text: String(elop.text ?? ''),
      fontSize: elop.fontSize || 18,
      fontFamily: elop.fontFamily || opts.fontFamily || 'Microsoft YaHei, PingFang SC, sans-serif',
      fontStyle: elop.fontStyle || (elop.bold ? 'bold' : '') + (elop.italic ? ' italic' : '') || 'normal',
      fill: colorToFill(elop.fill) || '#111111',
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
    node._elop = elop; // DSL 引用：双击编辑回写
    if (opts._slideIndex != null && opts._elementIndex != null) {
      node._editPath = { s: opts._slideIndex, e: opts._elementIndex }; // 原始 deck 回写路径
    }
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
    // DSL 约定：x/y 为圆心；width/height 分别为横/纵直径（缺省 height 回退为 width，与导出一致）
    const rw = elop.radius ?? (elop.width || 0) / 2;
    const rh = elop.radius ?? (elop.height || elop.width || 0) / 2;
    group.add(new Konva.Ellipse({
      x: elop.x, y: elop.y, radiusX: rw, radiusY: rh,
      opacity: elop.opacity ?? 1,
      rotation: elop.rotation || elop.rotate || 0,
      ...konvaFill(elop),
      stroke: elop.stroke, strokeWidth: elop.strokeWidth,
      dash: dashArray(elop),
      ...konvaShadow(elop),
    }));
  }

  function renderLine(elop, group) {
    const pts = (elop.pointArr || []).flatMap(p => [p.x, p.y]);
    if (pts.length < 4) return;
    const stroke = elop.lineColor || elop.stroke || '#333333';
    const strokeWidth = elop.lineWidth || elop.strokeWidth || 2;
    const endArrow = elop.lineEndArrowType;
    if (endArrow && endArrow !== 'none') {
      // 导出端 lineEndArrowType 会生成 tailEnd；预览用 Konva.Arrow 保持一致
      group.add(new Konva.Arrow({
        points: pts,
        pointerLength: strokeWidth * 2.4, pointerWidth: strokeWidth * 2.2,
        stroke, strokeWidth, fill: stroke,
        dash: dashArray(elop),
        opacity: elop.opacity ?? 1,
      }));
      return;
    }
    group.add(new Konva.Line({
      points: pts, // 多段折线全程渲染（导出端 >2 点走 customGeometry，一致）
      stroke, strokeWidth,
      dash: dashArray(elop),
      lineCap: 'round', lineJoin: 'round',
      opacity: elop.opacity ?? 1,
    }));
  }

  function renderArrow(elop, group) {
    const pts = (elop.pointArr || []).flatMap(p => [p.x, p.y]);
    if (pts.length < 4) return;
    const lw = elop.lineWidth || elop.strokeWidth || 2;
    const stroke = elop.lineColor || elop.stroke || '#333333';
    group.add(new Konva.Arrow({
      points: pts,
      pointerLength: lw * 2.4, pointerWidth: lw * 2.2,
      stroke, strokeWidth: lw, fill: stroke,
      dash: dashArray(elop),
      opacity: elop.opacity ?? 1,
    }));
  }

  function renderCurve(elop, group) {
    const pointArr = elop.pointArr || [];
    let d = '';
    if (typeof pointsToSvgPath === 'function') {
      d = pointsToSvgPath(pointArr); // 支持 quadratic/cubic/arc，与导出端同一套转换
    } else {
      pointArr.forEach((p, i) => {
        if (i === 0) d = `M ${p.x} ${p.y}`;
        else if (p.controlPoint && p.controlPoint.type === 'quadratic') d += ` Q ${p.controlPoint.x} ${p.controlPoint.y} ${p.x} ${p.y}`;
        else if (p.curve && p.curve.type === 'cubic') d += ` C ${p.curve.x1} ${p.curve.y1} ${p.curve.x2} ${p.curve.y2} ${p.x} ${p.y}`;
        else d += ` L ${p.x} ${p.y}`;
      });
    }
    if (!d) return;
    const close = elop.closePath === true;
    group.add(new Konva.Path({
      x: elop.x || 0, y: elop.y || 0, data: d + (close ? ' Z' : ''),
      stroke: elop.stroke || '#333333', strokeWidth: elop.strokeWidth || 2,
      dash: dashArray(elop), opacity: elop.opacity ?? 1,
      lineCap: 'round', lineJoin: 'round',
    }));
  }

  function renderPath(elop, group) {
    if (!elop.data) return;
    group.add(new Konva.Path({
      x: elop.x || 0, y: elop.y || 0, data: elop.data,
      rotation: elop.rotation || elop.rotate || 0,
      ...konvaFill(elop),
      stroke: elop.stroke, strokeWidth: elop.strokeWidth,
      dash: dashArray(elop), opacity: elop.opacity ?? 1,
      lineCap: elop.lineCap || 'butt', lineJoin: elop.lineJoin || 'round',
    }));
  }

  /* ---------- chart：原生 Konva 绘制（预览用；导出 PPTX 为真实可编辑图表） ---------- */
  function renderChart(elop, group, opts = {}) {
    const { x = 0, y = 0, width: w = 400, height: h = 300 } = elop;
    const series = Array.isArray(elop.data) ? elop.data : [];
    const labels = elop.labels || series[0]?.labels || [];
    const defaultColors = (opts.palette && opts.palette.length ? opts.palette : ['#4A90E2', '#6CC215', '#F5A623', '#9C27B0', '#00BCD4', '#ED7D31']);
    const colors = (elop.chartColors && elop.chartColors.length ? elop.chartColors : defaultColors)
      .map(c => typeof c === 'string' && !c.startsWith('#') && !c.startsWith('rgb') ? '#' + c : c);
    const type = elop.chartType || 'bar';
    const isPieLike = type === 'pie' || type === 'doughnut';
    const secondary = opts.textSecondary || '#667085';
    const gridColor = opts.gridColor || '#CBD5E1';

    // 标题（导出端 showTitle/chartTitle 也会输出）
    const chartTitle = elop.showTitle && (elop.chartTitle || elop.title) ? String(elop.chartTitle || elop.title) : '';
    const titleH = chartTitle ? 22 : 0;
    if (chartTitle) {
      group.add(new Konva.Text({
        x, y: y + 2, width: w, height: titleH,
        text: chartTitle, fontSize: 14, fontStyle: 'bold',
        fill: opts.text || '#111111', align: 'center', verticalAlign: 'middle',
      }));
    }

    // 图例：多系列或饼图时显示（预览默认给出以便核对文案）
    const legendNames = isPieLike ? labels : series.map(s => s.name).filter(Boolean);
    const wantLegend = elop.showLegend === true; // 与 PPTX 导出统一：缺省隐藏
    const legendH = wantLegend && legendNames.length ? 26 : 0;
    if (legendH) {
      let lx = x + 8;
      legendNames.forEach((name, i) => {
        const c = colors[i % colors.length];
        group.add(new Konva.Rect({ x: lx, y: y + titleH + 8, width: 10, height: 10, fill: c, cornerRadius: 2 }));
        const tw = estTextWidth(name, 11);
        group.add(new Konva.Text({ x: lx + 14, y: y + titleH + 6, width: tw + 8, height: 16, text: String(name), fontSize: 11, fill: secondary, verticalAlign: 'middle' }));
        lx += 14 + tw + 20;
      });
    }

    const labelH = isPieLike ? 0 : (labels.length ? 18 : 0); // 底部类目标签区
    const padL = 10, padT = titleH + legendH + 6, padB = labelH + 8;
    const cw = w - padL * 2, ch = h - padT - padB;
    const plotY = y + padT;

    const allVals = series.flatMap(s => s.values || []).flat().map(Number).filter(v => !isNaN(v));
    const maxV = Math.max(1e-9, ...allVals.map(v => Math.abs(v)));

    if (isPieLike) {
      const vals = (series[0]?.values || []).map(v => Number(v) || 0);
      const total = vals.reduce((a, b) => a + b, 0) || 1;
      const cx = x + w / 2, cy = plotY + ch / 2, r = Math.min(w, ch) / 2 - 4;
      let angle = -90;
      vals.forEach((v, i) => {
        const sweep = v / total * 360;
        group.add(new Konva.Wedge({ x: cx, y: cy, radius: r, angle: sweep, rotation: angle, fill: colors[i % colors.length] }));
        angle += sweep;
      });
      if (type === 'doughnut') {
        group.add(new Konva.Circle({ x: cx, y: cy, radius: r * 0.55, fill: opts.slideBackground || '#FFFFFF' }));
      }
      return;
    }

    if (type === 'radar') {
      const n = Math.max(3, labels.length || series[0]?.values?.length || 3);
      const cx = x + w / 2, cy = plotY + ch / 2, r = Math.min(w, ch) / 2 - 8;
      // 蛛网骨架
      for (let ring = 1; ring <= 3; ring++) {
        const rr = r * ring / 3;
        const pts = [];
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / n;
          pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
        }
        group.add(new Konva.Line({ points: pts, closed: true, stroke: '#E2E8F0', strokeWidth: 1 }));
      }
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / n;
        group.add(new Konva.Line({ points: [cx, cy, cx + r * Math.cos(a), cy + r * Math.sin(a)], stroke: '#E2E8F0', strokeWidth: 1 }));
        if (labels[i]) {
          group.add(new Konva.Text({
            x: cx + (r + 12) * Math.cos(a) - 40, y: cy + (r + 12) * Math.sin(a) - 8, width: 80, height: 16,
            text: String(labels[i]), fontSize: 10, fill: secondary, align: 'center',
          }));
        }
      }
      series.forEach((s, si) => {
        const pts = (s.values || []).map((v, i) => {
          const a = -Math.PI / 2 + i * 2 * Math.PI / n;
          const rr = r * (Number(v) || 0) / maxV;
          return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
        }).flat();
        const c = colors[si % colors.length];
        group.add(new Konva.Line({ points: pts, closed: true, stroke: c, strokeWidth: 2, fill: c + '33' }));
      });
      return;
    }

    if (type === 'scatter') {
      series.forEach((s, si) => {
        (s.values || []).forEach(pt => {
          const px = Array.isArray(pt) ? pt[0] : 0, py = Array.isArray(pt) ? pt[1] : 0;
          group.add(new Konva.Circle({
            x: x + padL + (px / maxV) * cw, y: plotY + ch - (py / maxV) * ch,
            radius: 4, fill: colors[si % colors.length],
          }));
        });
      });
      group.add(new Konva.Line({ points: [x + padL, plotY + ch, x + padL + cw, plotY + ch], stroke: gridColor, strokeWidth: 1 }));
      return;
    }

    if (type === 'line' || type === 'area') {
      const n = Math.max(2, labels.length || series[0]?.values?.length || 2);
      series.forEach((s, si) => {
        const pts = (s.values || []).map((v, i) => [
          x + padL + (cw * i) / (n - 1),
          plotY + ch - (Number(v) || 0) / maxV * ch,
        ]);
        const c = colors[si % colors.length];
        group.add(new Konva.Line({
          points: pts.flat(), stroke: c, strokeWidth: 2,
          lineCap: 'round', lineJoin: 'round', tension: 0.2,
          ...(type === 'area' ? { fill: c + '33', closed: true } : {}),
        }));
        pts.forEach(p => {
          group.add(new Konva.Circle({ x: p[0], y: p[1], radius: 3, fill: c }));
          if (elop.showValue) {
            group.add(new Konva.Text({ x: p[0] - 18, y: p[1] - 16, width: 36, height: 12, text: String(Number(s.values?.[i]) || 0), fontSize: 9, fill: secondary, align: 'center' }));
          }
        });
      });
    } else {
      // bar（默认）
      const n = labels.length || series[0]?.values?.length || 1;
      const slot = cw / n;
      const bw = Math.min(slot * 0.7 / Math.max(1, series.length), 60);
      for (let i = 0; i < n; i++) {
        series.forEach((s, si) => {
          const v = Number(s.values?.[i]) || 0;
          const bh = (v / maxV) * ch;
          const bx = x + padL + slot * i + slot / 2 - (bw * series.length) / 2 + si * bw;
          const by = plotY + ch - bh;
          group.add(new Konva.Rect({
            x: bx, y: by, width: bw * 0.9, height: bh,
            fill: colors[si % colors.length], cornerRadius: [3, 3, 0, 0],
          }));
          if (elop.showValue) {
            group.add(new Konva.Text({ x: bx - 10, y: by - 14, width: bw * 0.9 + 20, height: 12, text: String(v), fontSize: 9, fill: secondary, align: 'center' }));
          }
        });
      }
    }

    // 底部类目标签（bar/line/area/scatter 以外的类目轴）
    if (labelH) {
      const n = labels.length;
      for (let i = 0; i < n; i++) {
        group.add(new Konva.Text({
          x: x + padL + (cw * i) / n, y: y + h - labelH, width: cw / n, height: labelH - 4,
          text: String(labels[i]), fontSize: 10, fill: secondary, align: 'center', verticalAlign: 'top',
        }));
      }
    }
    // 轴线
    group.add(new Konva.Line({ points: [x + padL, plotY + ch, x + padL + cw, plotY + ch], stroke: gridColor, strokeWidth: 1 }));
    }

    /* ---------- table ---------- */
    function renderTable(elop, group, opts = {}) {
      const rows = elop.rows || [];
      if (!rows.length) return;
      const { x = 0, y = 0, width: w = 600, height: h = 200 } = elop;
      const cols = Math.max(...rows.map(r => r.length));
      const rh = h / rows.length, cw = w / cols;
      const fontSize = elop.fontSize || 16;
      const headerOn = elop.header?.enabled !== false;
      // 缺省表头/文字颜色取主题，与导出端一致；斑马纹与导出端同为奇数数据行（ri%2===1）
      const hdFill = colorToFill(elop.header?.fill) || (opts.primary || '#4A90E2');
      const hdColor = colorToFill(elop.header?.color) || '#FFFFFF';
      const bodyColor = colorToFill(elop.color) || opts.text || '#1F2937';
      rows.forEach((row, ri) => {
        for (let ci = 0; ci < cols; ci++) {
          const isHd = headerOn && ri === 0;
          const stripe = elop.stripeColor && ri % 2 === 1 ? colorToFill(elop.stripeColor) : null;
          const bg = isHd ? hdFill : (stripe || '#FFFFFF');
          group.add(new Konva.Rect({ x: x + ci * cw, y: y + ri * rh, width: cw, height: rh, fill: bg, stroke: colorToFill(elop.borderColor) || '#E2E8F0', strokeWidth: 1 }));
          group.add(new Konva.Text({
            x: x + ci * cw + 6, y: y + ri * rh, width: cw - 12, height: rh,
            text: String(row[ci] ?? ''), fontSize, fontFamily: opts.fontFamily,
            fontStyle: isHd && elop.header?.bold !== false ? 'bold' : 'normal',
            fill: isHd ? hdColor : bodyColor,
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

  /** 渲染一组元素到 Konva.Group（带元素索引，供编辑回写定位） */
  async function renderElements(elops, group, layer, opts = {}) {
    for (let i = 0; i < (elops || []).length; i++) {
      const elop = elops[i];
      const r = renderers[elop.elType];
      if (!r) { console.warn('[PptPreview] 未知 elType:', elop.elType); continue; }
      try { await r(elop, group, layer, { ...opts, _elementIndex: i }); } catch (e) { console.warn('[PptPreview] 渲染失败:', elop.elType, e); }
    }
    layer.batchDraw();
  }

  /**
   * 渲染整套 deck 到容器（每页一个 Stage，纵向排列）
   * @returns [{ stage, layer, holder }] —— 缩放用 applyZoom，无需重建
   */
  async function renderDeck(deck, container, opts = {}) {
    const scale = opts.scale || 1;
    const gap = opts.pageGap ?? 24;
    const theme = opts.theme || {};
    const palette = (opts.palette || theme.palette || []).map(c => typeof c === 'string' && !c.startsWith('#') ? '#' + c : c);
    const primary = opts.primary || (theme.primary ? '#' + theme.primary : '#4A90E2');
    const text = opts.text || (theme.text ? '#' + theme.text : '#111111');
    const textSecondary = opts.textSecondary || (theme.textSecondary ? '#' + theme.textSecondary : '#667085');
    container.innerHTML = '';
    const out = [];
    for (let i = 0; i < (deck.slides || []).length; i++) {
      const slideSpec = deck.slides[i];
      const holder = document.createElement('div');
      holder.style.cssText = `width:${PPT_WIDTH * scale}px;height:${PPT_HEIGHT * scale}px;margin:${gap / 2}px auto;box-shadow:0 4px 24px rgba(0,0,0,0.12);border-radius:4px;overflow:hidden;`;
      container.appendChild(holder);
      const stage = new Konva.Stage({ container: holder, width: PPT_WIDTH * scale, height: PPT_HEIGHT * scale, scaleX: scale, scaleY: scale });
      const layer = new Konva.Layer();
      stage.add(layer);
      // 背景：颜色直接铺底；缺省回退 theme.background（与导出端 slideBackground 一致）
      const bgSpec = slideSpec.background || (theme.background ? (String(theme.background).startsWith('#') ? theme.background : '#' + theme.background) : null);
      const bgColor = colorToFill(bgSpec);
      const bgIsColor = bgColor && isColorStr(bgColor);
      if (bgIsColor) {
        layer.add(new Konva.Rect({ x: 0, y: 0, width: PPT_WIDTH, height: PPT_HEIGHT, fill: bgColor }));
      } else if (typeof bgSpec === 'string' && bgSpec) {
        loadImage(bgSpec).then(img => {
          const s2 = Math.max(PPT_WIDTH / img.width, PPT_HEIGHT / img.height);
          const cw = PPT_WIDTH / s2, ch = PPT_HEIGHT / s2;
          const bgImg = new Konva.Image({ x: 0, y: 0, width: PPT_WIDTH, height: PPT_HEIGHT, image: img, crop: { x: (img.width - cw) / 2, y: (img.height - ch) / 2, width: cw, height: ch } });
          layer.add(bgImg);
          bgImg.moveToBottom();
          layer.batchDraw();
        }).catch(() => {
          const fallback = new Konva.Rect({ x: 0, y: 0, width: PPT_WIDTH, height: PPT_HEIGHT, fill: '#F1F5F9' });
          layer.add(fallback);
          fallback.moveToBottom(); // 失败占位不能盖住已渲染内容
          layer.batchDraw();
        });
      } else {
        layer.add(new Konva.Rect({ x: 0, y: 0, width: PPT_WIDTH, height: PPT_HEIGHT, fill: '#FFFFFF' }));
      }
      const slideOpts = { ...opts, _slideIndex: i, palette, primary, text, textSecondary, slideBackground: bgColor || '#FFFFFF' };
      await renderElements(slideSpec.elements, layer, layer, slideOpts);
      out.push({ stage, layer, holder });
    }
    return out;
  }

  /** 缩放（不重建 Stage）：直接调 scale 与尺寸 */
  function applyZoom(stages, scale) {
    for (const { stage, holder } of stages || []) {
      stage.scaleX(scale);
      stage.scaleY(scale);
      stage.width(PPT_WIDTH * scale);
      stage.height(PPT_HEIGHT * scale);
      holder.style.width = PPT_WIDTH * scale + 'px';
      holder.style.height = PPT_HEIGHT * scale + 'px';
      stage.batchDraw();
    }
  }

  global.PptPreview = { renderDeck, renderElements, applyZoom, PPT_WIDTH, PPT_HEIGHT };
})(typeof window !== 'undefined' ? window : globalThis);
