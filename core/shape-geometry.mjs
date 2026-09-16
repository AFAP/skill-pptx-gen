/**
 * OOXML preset geometry → 双端形状注册表
 *
 * 背景：PptxGenJS 的 `addShape(ShapeType.x, ...)` 只是把 preset 名称写进 OOXML，真正的
 * 几何由 PowerPoint 按 `presetShapeDefinitions.xml` 的 guide 公式计算。Konva 没有 preset
 * 概念，必须自己画出同一套几何，否则"新增形状"本身就会变成新的不一致来源。
 *
 * 本文件是把两端对齐的唯一位置：
 *   pptx  —— 交给 PptxGenJS 的 ShapeType 名称
 *    path  —— Konva.Path 的 data（局部坐标 0..w / 0..h，与 PowerPoint 的包围盒同构）
 *    exact —— 几何可信度，直接决定校验器是否告警：
 *      'preset'      两端几何由同一构造唯一确定（原生 preset，或 shape-polygon 的共享顶点列）
 *      'aspect'      顶点落在内切椭圆上；正方形包围盒下与 PowerPoint 一致，非等比时
 *                    PowerPoint 会施加额外轴向缩放，本实现不复制该缩放 → 告警
 *      'approximate' 曲线控制点或内部细节为等价构造而非原始公式 → 告警
 *
 * 角度约定与 OOXML 一致：0° 指向正右，顺时针为正（y 轴向下）。
 * 弧段一律展开为三次贝塞尔，不依赖 Konva 对 SVG `A` 指令的解释。
 * 需要挖洞的图形由"外圈正向 + 内圈反向"两条子路径构成（nonzero 填充规则）。
 */

const K = 0.5522847498307936; // 圆 → 三次贝塞尔的标准 kappa

const rnd = v => Math.round(v * 1000) / 1000;
const pt = (x, y) => `${rnd(x)} ${rnd(y)}`;
const deg = d => d * Math.PI / 180;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
/** OOXML 调整值：百分比整数（100000 = 100%），参考边为包围盒短边 ss */
function ratio(value, fallback) {
  return num(value, fallback) / 100000;
}
function adjPx(value, w, h, fallback) {
  return Math.min(w, h) * ratio(value, fallback);
}
function adjAt(value, fallback, index) {
  const list = Array.isArray(value) ? value : (value == null ? fallback : [value]);
  return num(list[index], fallback?.[index] ?? 0);
}

/**
 * 星形的内/外半径比。
 * OOXML 星形的 adj 满量程是 **50000**（`pin 0 adj 50000`），不是 100000：
 * 证据是 star6 的 28868/50000 = 0.57735 与 star7 的 34601/50000 = 0.69202，
 * 分别精确等于正六角星 {6/2}（cos60/cos30）与正七角星 {7/2}（cos(2π/7)/cos(π/7)）
 * 的几何比值。按 100000 解释会把星形画得过分尖锐（star5 会变成 0.191 而非 0.382）。
 */
function starRatio(value, fallback) {
  return num(value, fallback) / 50000;
}

/* ============================== 路径构造工具 ============================== */

/** 折线/多边形；close=false 得到开放的折线 */
function poly(points, close = true) {
  if (!points.length) return '';
  const head = `M ${pt(points[0][0], points[0][1])}`;
  const body = points.slice(1).map(([x, y]) => `L ${pt(x, y)}`).join(' ');
  return `${head} ${body}${close ? ' Z' : ''}`;
}

/** 椭圆；reverse=true 时反向绕行，用于在 nonzero 填充下挖洞 */
function ellipseAt(cx, cy, rx, ry, reverse = false) {
  const ox = rx * K, oy = ry * K;
  const x0 = cx - rx, x1 = cx + rx, y0 = cy - ry, y1 = cy + ry;
  const seg = reverse
    ? [
      `C ${pt(cx - ox, y0)} ${pt(x0, cy - oy)} ${pt(x0, cy)}`,
      `C ${pt(x0, cy + oy)} ${pt(cx - ox, y1)} ${pt(cx, y1)}`,
      `C ${pt(cx + ox, y1)} ${pt(x1, cy + oy)} ${pt(x1, cy)}`,
      `C ${pt(x1, cy - oy)} ${pt(cx + ox, y0)} ${pt(cx, y0)}`,
    ]
    : [
      `C ${pt(cx + ox, y0)} ${pt(x1, cy - oy)} ${pt(x1, cy)}`,
      `C ${pt(x1, cy + oy)} ${pt(cx + ox, y1)} ${pt(cx, y1)}`,
      `C ${pt(cx - ox, y1)} ${pt(x0, cy + oy)} ${pt(x0, cy)}`,
      `C ${pt(x0, cy - oy)} ${pt(cx - ox, y0)} ${pt(cx, y0)}`,
    ];
  return `M ${pt(cx, y0)} ${seg.join(' ')} Z`;
}

function ellipsePath(w, h, reverse = false) {
  return ellipseAt(w / 2, h / 2, w / 2, h / 2, reverse);
}

/** 弧：按 ≤90° 分段转三次贝塞尔。start==end 表示整圆（与 OOXML 的 swAng 规则一致）。 */
function arcCurves(cx, cy, rx, ry, startDeg, endDeg) {
  const a0in = startDeg;
  if (endDeg === startDeg) endDeg = startDeg + 360;
  const sweep = endDeg - startDeg;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 90));
  const step = sweep / steps;
  const k = (4 / 3) * Math.tan(deg(step) / 4);
  const curves = [];
  let a0 = startDeg;
  for (let i = 0; i < steps; i++) {
    const a1 = a0 + step;
    const t0 = deg(a0), t1 = deg(a1);
    const p0 = [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)];
    const p1 = [cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)];
    const d0 = [-rx * Math.sin(t0), ry * Math.cos(t0)];
    const d1 = [-rx * Math.sin(t1), ry * Math.cos(t1)];
    curves.push({
      c1: [p0[0] + k * d0[0], p0[1] + k * d0[1]],
      c2: [p1[0] - k * d1[0], p1[1] - k * d1[1]],
      p1,
    });
    a0 = a1;
  }
  const t0 = deg(a0in), t1 = deg(endDeg);
  return {
    start: [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)],
    end: [cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)],
    curves,
  };
}

const curvesToD = a => a.curves
  .map(c => `C ${pt(c.c1[0], c.c1[1])} ${pt(c.c2[0], c.c2[1])} ${pt(c.p1[0], c.p1[1])}`)
  .join(' ');

/** 开放弧（不闭合），供 arc 形状与 detail 描边使用 */
function arcPath(cx, cy, rx, ry, startDeg, endDeg) {
  const a = arcCurves(cx, cy, rx, ry, startDeg, endDeg);
  return `M ${pt(a.start[0], a.start[1])} ${curvesToD(a)}`;
}

/** 闭合弧（弦） */
function arcChordPath(cx, cy, rx, ry, startDeg, endDeg) {
  const a = arcCurves(cx, cy, rx, ry, startDeg, endDeg);
  return `M ${pt(a.start[0], a.start[1])} ${curvesToD(a)} Z`;
}

/** 圆角矩形（四角同半径） */
function roundRectPath(w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (rr <= 0.01) return poly([[0, 0], [w, 0], [w, h], [0, h]]);
  const k = rr * K;
  return [
    `M ${pt(rr, 0)}`,
    `L ${pt(w - rr, 0)}`,
    `C ${pt(w - rr + k, 0)} ${pt(w, rr - k)} ${pt(w, rr)}`,
    `L ${pt(w, h - rr)}`,
    `C ${pt(w, h - rr + k)} ${pt(w - rr + k, h)} ${pt(w - rr, h)}`,
    `L ${pt(rr, h)}`,
    `C ${pt(rr - k, h)} ${pt(0, h - rr + k)} ${pt(0, h - rr)}`,
    `L ${pt(0, rr)}`,
    `C ${pt(0, rr - k)} ${pt(rr - k, 0)} ${pt(rr, 0)}`,
    'Z',
  ].join(' ');
}

/** 仅圆部分角（胶囊、D 形等）；radii 顺序 [tl, tr, br, bl] */
function partialRoundPath(w, h, radii) {
  const lim = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map(r => Math.max(0, Math.min(num(r, 0), lim)));
  const parts = [`M ${pt(tl, 0)}`];
  parts.push(tr > 0.01
    ? `L ${pt(w - tr, 0)} C ${pt(w - tr + tr * K, 0)} ${pt(w, tr - tr * K)} ${pt(w, tr)}`
    : `L ${pt(w, 0)}`);
  parts.push(br > 0.01
    ? `L ${pt(w, h - br)} C ${pt(w, h - br + br * K)} ${pt(w - br + br * K, h)} ${pt(w - br, h)}`
    : `L ${pt(w, h)}`);
  parts.push(bl > 0.01
    ? `L ${pt(bl, h)} C ${pt(bl - bl * K, h)} ${pt(0, h - bl + bl * K)} ${pt(0, h - bl)}`
    : `L ${pt(0, h)}`);
  parts.push(tl > 0.01
    ? `L ${pt(0, tl)} C ${pt(0, tl - tl * K)} ${pt(tl - tl * K, 0)} ${pt(tl, 0)}`
    : `L ${pt(0, 0)}`);
  parts.push('Z');
  return parts.join(' ');
}

/** 星形：2n 个顶点交替落在内/外切椭圆上，起始角 -90° */
function starPolygon(w, h, points, innerRatio) {
  const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
  const step = Math.PI / points;
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + i * step;
    const f = i % 2 === 0 ? 1 : innerRatio;
    out.push([cx + rx * f * Math.cos(a), cy + ry * f * Math.sin(a)]);
  }
  return poly(out);
}

/** 正多边形 */
function regularPolygon(w, h, sides) {
  const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / sides;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return poly(out);
}

/** 圆柱：左壁 → 底部下半弧 → 右壁 → 顶部上半弧 */
function cylinderPath(w, h, capRatio) {
  const ry = Math.max(0.5, Math.min(h * ratio(capRatio, 25000), h / 2));
  const rx = w / 2;
  const bottom = arcCurves(rx, h - ry, rx, ry, 180, 0);
  const top = arcCurves(rx, ry, rx, ry, 360, 180);
  return `M ${pt(0, ry)} L ${pt(0, h - ry)} ${curvesToD(bottom)} L ${pt(w, ry)} ${curvesToD(top)} Z`;
}

/** 圆柱顶盖前沿（PowerPoint 以描边绘制，预览需补画） */
function cylinderLid(w, h, capRatio) {
  const ry = Math.max(0.5, Math.min(h * ratio(capRatio, 25000), h / 2));
  return [arcPath(w / 2, ry, w / 2, ry, 0, 180)];
}

const line = (x1, y1, x2, y2) => `M ${pt(x1, y1)} L ${pt(x2, y2)}`;

/* ============================== 形状表 ============================== */
/**
 * 每项：
 *   pptx   PptxGenJS ShapeType 名称
 *   exact  'preset' | 'aspect' | 'approximate'
 *   adj    默认调整值（百分比整数），可被元素的 adjust 覆盖
 *   angles 弧类形状的默认 [起始角, 结束角]（度）
 *   path   (w, h, adj, options) => path data
 *   detail (w, h, adj, options) => string[] 仅描边的补充路径
 */
export const SHAPE_GEOMETRY = {
  /* ---------- 基础 ---------- */
  rect: { pptx: 'rect', exact: 'preset', path: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]) },
  roundRect: { pptx: 'roundRect', exact: 'preset', adj: 16667, path: (w, h, a) => roundRectPath(w, h, adjPx(a, w, h, 16667)) },
  ellipse: { pptx: 'ellipse', exact: 'preset', path: (w, h) => ellipsePath(w, h) },
  triangle: { pptx: 'triangle', exact: 'preset', path: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]) },
  rtTriangle: { pptx: 'rtTriangle', exact: 'preset', path: (w, h) => poly([[0, 0], [w, h], [0, h]]) },
  diamond: { pptx: 'diamond', exact: 'preset', path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) },
  parallelogram: {
    pptx: 'parallelogram', exact: 'preset', adj: 25000,
    path: (w, h, a) => { const x = adjPx(a, w, h, 25000); return poly([[x, 0], [w, 0], [w - x, h], [0, h]]); },
  },
  trapezoid: {
    pptx: 'trapezoid', exact: 'preset', adj: 25000,
    path: (w, h, a) => { const x = adjPx(a, w, h, 25000); return poly([[x, 0], [w - x, 0], [w, h], [0, h]]); },
  },
  nonIsoscelesTrapezoid: {
    pptx: 'nonIsoscelesTrapezoid', exact: 'preset', adj: [25000, 25000],
    path: (w, h, a) => poly([
      [adjPx(adjAt(a, [25000, 25000], 0), w, h, 25000), 0],
      [w - adjPx(adjAt(a, [25000, 25000], 1), w, h, 25000), 0],
      [w, h], [0, h],
    ]),
  },
  hexagon: {
    pptx: 'hexagon', exact: 'preset', adj: 25000,
    path: (w, h, a) => { const x = adjPx(a, w, h, 25000); return poly([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]]); },
  },
  octagon: {
    pptx: 'octagon', exact: 'preset', adj: 29289,
    path: (w, h, a) => {
      const x = adjPx(a, w, h, 29289);
      return poly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]);
    },
  },
  pentagon: { pptx: 'pentagon', exact: 'aspect', path: (w, h) => regularPolygon(w, h, 5) },
  homePlate: {
    pptx: 'homePlate', exact: 'preset', adj: 50000,
    path: (w, h, a) => { const x = adjPx(a, w, h, 50000); return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h]]); },
  },
  plaque: {
    pptx: 'plaque', exact: 'preset', adj: 16667,
    path: (w, h, a) => { const r = adjPx(a, w, h, 16667); return partialRoundPath(w, h, [r, r, r, r]); },
  },
  frame: {
    pptx: 'frame', exact: 'preset', adj: 12500,
    path: (w, h, a) => {
      const x = adjPx(a, w, h, 12500);
      const outer = poly([[0, 0], [w, 0], [w, h], [0, h]]);
      const inner = poly([[x, x], [x, h - x], [w - x, h - x], [w - x, x]]); // 反向绕行 → 挖洞
      return `${outer} ${inner}`;
    },
  },
  halfFrame: {
    pptx: 'halfFrame', exact: 'approximate', adj: [33333, 33333],
    path: (w, h, a) => {
      const tx = w * ratio(adjAt(a, [33333, 33333], 1), 33333);
      const ty = h * ratio(adjAt(a, [33333, 33333], 0), 33333);
      return poly([[0, 0], [w, 0], [w, ty], [tx, ty], [tx, h], [0, h]]);
    },
  },
  corner: {
    pptx: 'corner', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const x = adjPx(adjAt(a, [50000, 50000], 0), w, h, 50000);
      const y = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000);
      return poly([[0, 0], [w, 0], [w, y], [x, y], [x, h], [0, h]]);
    },
  },
  diagStripe: {
    pptx: 'diagStripe', exact: 'preset', adj: 50000,
    path: (w, h, a) => { const x = adjPx(a, w, h, 50000); return poly([[0, 0], [x, 0], [w, h], [w - x, h]]); },
  },

  /* ---------- 箭头族 ---------- */
  rightArrow: {
    pptx: 'rightArrow', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const dy = h * ratio(adjAt(a, [50000, 50000], 0), 50000) / 2;
      const dx = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000), x1 = w - dx;
      return poly([[0, h / 2 - dy], [x1, h / 2 - dy], [x1, 0], [w, h / 2], [x1, h], [x1, h / 2 + dy], [0, h / 2 + dy]]);
    },
  },
  leftArrow: {
    pptx: 'leftArrow', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const dy = h * ratio(adjAt(a, [50000, 50000], 0), 50000) / 2;
      const dx = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000), x1 = dx;
      return poly([[w, h / 2 - dy], [x1, h / 2 - dy], [x1, 0], [0, h / 2], [x1, h], [x1, h / 2 + dy], [w, h / 2 + dy]]);
    },
  },
  upArrow: {
    pptx: 'upArrow', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const dx = w * ratio(adjAt(a, [50000, 50000], 0), 50000) / 2;
      const dy = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000), y1 = dy;
      return poly([[w / 2 - dx, y1], [w / 2 - dx, h], [w / 2 + dx, h], [w / 2 + dx, y1], [w, y1], [w / 2, 0], [0, y1]]);
    },
  },
  downArrow: {
    pptx: 'downArrow', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const dx = w * ratio(adjAt(a, [50000, 50000], 0), 50000) / 2;
      const dy = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000), y1 = h - dy;
      return poly([[w / 2 - dx, 0], [w / 2 - dx, y1], [0, y1], [w / 2, h], [w, y1], [w / 2 + dx, y1], [w / 2 + dx, 0]]);
    },
  },
  leftRightArrow: {
    pptx: 'leftRightArrow', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const dy = h * ratio(adjAt(a, [50000, 50000], 0), 50000) / 2;
      const dx = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000);
      const y1 = h / 2 - dy, y2 = h / 2 + dy;
      return poly([[0, h / 2], [dx, 0], [dx, y1], [w - dx, y1], [w - dx, 0], [w, h / 2], [w - dx, h], [w - dx, y2], [dx, y2], [dx, h]]);
    },
  },
  upDownArrow: {
    pptx: 'upDownArrow', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const dx = w * ratio(adjAt(a, [50000, 50000], 0), 50000) / 2;
      const dy = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000);
      const x1 = w / 2 - dx, x2 = w / 2 + dx;
      return poly([[w / 2, 0], [w, dy], [x2, dy], [x2, h - dy], [w, h - dy], [w / 2, h], [0, h - dy], [x1, h - dy], [x1, dy], [0, dy]]);
    },
  },
  notchedRightArrow: {
    pptx: 'notchedRightArrow', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const dy = h * ratio(adjAt(a, [50000, 50000], 0), 50000) / 2;
      const dx = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000), x1 = w - dx;
      return poly([[0, h / 2 - dy], [x1, h / 2 - dy], [x1, 0], [w, h / 2], [x1, h], [x1, h / 2 + dy], [0, h / 2 + dy], [dx / 2, h / 2]]);
    },
  },
  stripedRightArrow: {
    pptx: 'stripedRightArrow', exact: 'preset', adj: [50000, 50000],
    path: (w, h, a) => {
      const dy = h * ratio(adjAt(a, [50000, 50000], 0), 50000) / 2;
      const dx = adjPx(adjAt(a, [50000, 50000], 1), w, h, 50000), x1 = w - dx;
      const body = poly([[0, h / 2 - dy], [x1, h / 2 - dy], [x1, 0], [w, h / 2], [x1, h], [x1, h / 2 + dy], [0, h / 2 + dy]]);
      // 竖条纹是 preset 中独立的填充子路径，与箭身不相交，直接并列即可
      const sx = Math.max(0, x1 - dx / 2);
      const stripe = poly([[sx, h / 2 - dy], [sx + Math.max(1, dx / 12), h / 2 - dy], [sx + Math.max(1, dx / 12), h / 2 + dy], [sx, h / 2 + dy]]);
      return `${body} ${stripe}`;
    },
  },
  bentArrow: {
    pptx: 'bentArrow', exact: 'approximate', adj: [25000, 25000, 25000, 43750],
    path: (w, h, a) => {
      const th = h * ratio(adjAt(a, [25000, 25000, 25000, 43750], 0), 25000);
      const ah = w * ratio(adjAt(a, [25000, 25000, 25000, 43750], 3), 43750);
      const y1 = th, y2 = h - th;
      return poly([[0, y1], [w - ah, y1], [w - ah, 0], [w, (y1 + y2) / 2], [w - ah, y2], [0, y2]]);
    },
  },
  bentUpArrow: {
    pptx: 'bentUpArrow', exact: 'approximate', adj: [25000, 25000, 25000, 43750],
    path: (w, h, a) => {
      const tw = w * ratio(adjAt(a, [25000, 25000, 25000, 43750], 0), 25000);
      const ah = h * ratio(adjAt(a, [25000, 25000, 25000, 43750], 3), 43750);
      return poly([
        [tw, h], [0, h], [0, h - tw], [tw, h - tw], [tw, ah], [0, ah], [tw * 1.5, 0],
        [tw * 3, ah], [tw * 2, ah], [tw * 2, h - tw], [tw, h - tw],
      ]);
    },
  },
  quadArrow: {
    pptx: 'quadArrow', exact: 'approximate', adj: [22500, 22500, 22500],
    path: (w, h, a) => {
      const t = Math.min(w, h) * ratio(adjAt(a, [22500, 22500, 22500], 0), 22500);
      const cx = w / 2, cy = h / 2;
      return poly([
        [cx, 0], [cx + t / 2, t], [cx + t / 2, cy - t], [w, cy - t / 2], [w, cy + t / 2],
        [cx + t / 2, cy + t], [cx + t / 2, h - t], [cx, h], [cx - t / 2, h - t],
        [cx - t / 2, cy + t], [0, cy + t / 2], [0, cy - t / 2], [cx - t / 2, cy - t], [cx - t / 2, t],
      ]);
    },
  },
  leftUpArrow: {
    pptx: 'leftUpArrow', exact: 'approximate', adj: [25000, 25000, 25000],
    path: (w, h, a) => {
      const t = Math.min(w, h) * ratio(adjAt(a, [25000, 25000, 25000], 0), 25000);
      return poly([
        [0, 0], [w * 0.45, 0], [w * 0.45, t], [w, t], [w, h * 0.45], [w - t, h * 0.45],
        [w - t, h], [w * 0.35, h], [w * 0.35, h * 0.45], [t, h * 0.45], [t, h * 0.35], [0, h * 0.35],
      ]);
    },
  },
  leftRightUpArrow: {
    pptx: 'leftRightUpArrow', exact: 'approximate', adj: [25000, 25000, 25000],
    path: (w, h, a) => {
      const t = Math.min(w, h) * ratio(adjAt(a, [25000, 25000, 25000], 0), 25000);
      const cx = w / 2;
      return poly([
        [cx, 0], [cx + t, t], [cx + t / 2, t], [cx + t / 2, h * 0.62], [w - t / 2, h * 0.62],
        [w - t / 2, h * 0.62 - t], [w, h * 0.8], [w - t / 2, h * 0.98], [w - t / 2, h * 0.8],
        [cx - t / 2, h * 0.8], [cx - t / 2, h * 0.62], [t / 2, h * 0.62], [t / 2, h * 0.8],
        [0, h * 0.8], [t / 2, h * 0.62 - t], [t / 2, h * 0.62], [cx - t / 2, h * 0.62],
        [cx - t / 2, t], [cx - t, t],
      ]);
    },
  },

  /* ---------- 数学符号 ---------- */
  plus: {
    pptx: 'plus', exact: 'preset', adj: 25000,
    path: (w, h, a) => {
      const t = adjPx(a, w, h, 25000), cx = w / 2, cy = h / 2;
      return poly([
        [cx - t, 0], [cx + t, 0], [cx + t, cy - t], [w, cy - t], [w, cy + t], [cx + t, cy + t],
        [cx + t, h], [cx - t, h], [cx - t, cy + t], [0, cy + t], [0, cy - t], [cx - t, cy - t],
      ]);
    },
  },
  mathPlus: {
    pptx: 'mathPlus', exact: 'preset', adj: [23520, 5880],
    path: (w, h, a) => {
      const t = adjPx(adjAt(a, [23520, 5880], 0), w, h, 23520);
      const s = adjPx(adjAt(a, [23520, 5880], 1), w, h, 5880);
      const cx = w / 2, cy = h / 2;
      const vert = poly([[cx - s, 0], [cx + s, 0], [cx + s, h], [cx - s, h]]);
      const horiz = poly([[0, cy - s], [w, cy - s], [w, cy + s], [0, cy + s]]);
      return `${vert} ${horiz}`;
    },
  },
  mathMinus: {
    pptx: 'mathMinus', exact: 'preset', adj: 23520,
    path: (w, h, a) => {
      const s = adjPx(a, w, h, 23520);
      return poly([[0, h / 2 - s], [w, h / 2 - s], [w, h / 2 + s], [0, h / 2 + s]]);
    },
  },
  mathMultiply: {
    pptx: 'mathMultiply', exact: 'preset', adj: 23520,
    path: (w, h, a) => {
      const t = adjPx(a, w, h, 23520);
      const cx = w / 2, cy = h / 2;
      // 两条对角线构成叉形；各自为独立子路径
      const d1 = poly([[cx - t, 0], [cx, 0], [cx + t, h], [cx, h]]);
      const d2 = poly([[cx, 0], [cx + t, 0], [cx, h], [cx - t, h]]);
      void cy;
      return `${d1} ${d2}`;
    },
  },
  mathDivide: {
    pptx: 'mathDivide', exact: 'preset', adj: [23520, 5880],
    path: (w, h, a) => {
      const s = adjPx(adjAt(a, [23520, 5880], 1), w, h, 5880);
      const bar = poly([[0, h / 2 - s / 2], [w, h / 2 - s / 2], [w, h / 2 + s / 2], [0, h / 2 + s / 2]]);
      const r = Math.max(1, Math.min(w, h) * 0.06);
      const dot1 = ellipseAt(w / 2, h * 0.22, r, r);
      const dot2 = ellipseAt(w / 2, h * 0.78, r, r);
      return `${bar} ${dot1} ${dot2}`;
    },
  },
  mathEqual: {
    pptx: 'mathEqual', exact: 'preset', adj: [23520, 11760],
    path: (w, h, a) => {
      const s = adjPx(adjAt(a, [23520, 11760], 1), w, h, 11760) / 2;
      const gap = h * 0.12;
      const top = poly([[0, h / 2 - gap - s * 2], [w, h / 2 - gap - s * 2], [w, h / 2 - gap], [0, h / 2 - gap]]);
      const bot = poly([[0, h / 2 + gap], [w, h / 2 + gap], [w, h / 2 + gap + s * 2], [0, h / 2 + gap + s * 2]]);
      return `${top} ${bot}`;
    },
  },
  mathNotEqual: {
    pptx: 'mathNotEqual', exact: 'approximate', adj: [23520, 11760, 40000],
    path: (w, h, a) => {
      const s = adjPx(adjAt(a, [23520, 11760], 1), w, h, 11760) / 2;
      const gap = h * 0.12;
      const top = poly([[0, h / 2 - gap - s * 2], [w, h / 2 - gap - s * 2], [w, h / 2 - gap], [0, h / 2 - gap]]);
      const bot = poly([[0, h / 2 + gap], [w, h / 2 + gap], [w, h / 2 + gap + s * 2], [0, h / 2 + gap + s * 2]]);
      const slash = poly([[w * 0.62, 0], [w * 0.78, 0], [w * 0.38, h], [w * 0.22, h]]);
      return `${top} ${bot} ${slash}`;
    },
  },

  /* ---------- 弧 / 扇区 / 环 ---------- */
  pie: { pptx: 'pie', exact: 'preset', angles: [0, 270], path: (w, h, a, o) => piePath(w, h, o) },
  chord: { pptx: 'chord', exact: 'preset', angles: [45, 270], path: (w, h, a, o) => arcChordPath(w / 2, h / 2, w / 2, h / 2, ...anglesOf(o)) },
  arc: { pptx: 'arc', exact: 'preset', angles: [270, 0], path: (w, h, a, o) => arcPath(w / 2, h / 2, w / 2, h / 2, ...anglesOf(o)) },
  blockArc: { pptx: 'blockArc', exact: 'preset', angles: [180, 0], thickness: 0.5, path: (w, h, a, o) => blockArcPath(w, h, o) },
  donut: {
    pptx: 'donut', exact: 'preset', adj: 25000,
    path: (w, h, a) => {
      const t = adjPx(a, w, h, 25000);
      const inner = ellipseAt(w / 2, h / 2, Math.max(0.1, w / 2 - t), Math.max(0.1, h / 2 - t), true);
      return `${ellipsePath(w, h)} ${inner}`;
    },
  },

  /* ---------- 星形（非等比包围盒时 PowerPoint 另有轴向缩放） ---------- */
  star4: { pptx: 'star4', exact: 'aspect', adj: 12500, path: (w, h, a) => starPolygon(w, h, 4, starRatio(a, 12500)) },
  star5: { pptx: 'star5', exact: 'aspect', adj: 19098, path: (w, h, a) => starPolygon(w, h, 5, starRatio(a, 19098)) },
  star6: { pptx: 'star6', exact: 'aspect', adj: 28868, path: (w, h, a) => starPolygon(w, h, 6, starRatio(a, 28868)) },
  star7: { pptx: 'star7', exact: 'aspect', adj: 34601, path: (w, h, a) => starPolygon(w, h, 7, starRatio(a, 34601)) },
  star8: { pptx: 'star8', exact: 'aspect', adj: 19098, path: (w, h, a) => starPolygon(w, h, 8, starRatio(a, 19098)) },
  star10: { pptx: 'star10', exact: 'aspect', adj: 19098, path: (w, h, a) => starPolygon(w, h, 10, starRatio(a, 19098)) },
  star12: { pptx: 'star12', exact: 'aspect', adj: 19098, path: (w, h, a) => starPolygon(w, h, 12, starRatio(a, 19098)) },
  star16: { pptx: 'star16', exact: 'aspect', adj: 19098, path: (w, h, a) => starPolygon(w, h, 16, starRatio(a, 19098)) },
  star24: { pptx: 'star24', exact: 'aspect', adj: 19098, path: (w, h, a) => starPolygon(w, h, 24, starRatio(a, 19098)) },
  star32: { pptx: 'star32', exact: 'aspect', adj: 19098, path: (w, h, a) => starPolygon(w, h, 32, starRatio(a, 19098)) },

  /* ---------- 立体感基础形 ---------- */
  can: { pptx: 'can', exact: 'preset', adj: 25000, path: (w, h, a) => cylinderPath(w, h, a), detail: (w, h, a) => cylinderLid(w, h, a) },
  cube: {
    pptx: 'cube', exact: 'preset', adj: 25000,
    // 立方体轮廓是六边形：前面 / (0,t) 起，经顶面左上角 (t,0)、右上 (w,0)、右侧 (w,h-t)、
    // 右下 (w-t,h) 回到左下 (0,h)。内部只需两条前面棱线（顶棱与右棱）。
    path: (w, h, a) => {
      const t = adjPx(a, w, h, 25000);
      return poly([[0, t], [t, 0], [w, 0], [w, h - t], [w - t, h], [0, h]]);
    },
    detail: (w, h, a) => {
      const t = adjPx(a, w, h, 25000);
      return [line(0, t, w - t, t), line(w - t, t, w - t, h)];
    },
  },
  bevel: {
    pptx: 'bevel', exact: 'preset', adj: 12500,
    path: (w, h, a) => {
      const t = adjPx(a, w, h, 12500);
      const outer = poly([[0, 0], [w, 0], [w, h], [0, h]]);
      const inner = poly([[t, t], [t, h - t], [w - t, h - t], [w - t, t]]);
      return `${outer} ${inner}`;
    },
  },

  /* ---------- 标注（尾部指向由 adj 决定，这里固定为左下） ---------- */
  wedgeRectCallout: {
    pptx: 'wedgeRectCallout', exact: 'approximate', adj: [-20833, 62500],
    path: (w, h) => {
      const b = h * 0.78;
      return poly([[0, 0], [w, 0], [w, b], [w * 0.42, b], [w * 0.28, h], [w * 0.32, b], [0, b]]);
    },
  },
  wedgeRoundRectCallout: {
    pptx: 'wedgeRoundRectCallout', exact: 'approximate', adj: [-20833, 62500, 16667],
    path: (w, h, a) => {
      const b = h * 0.78;
      const r = Math.min(w, b) * ratio(adjAt(a, [-20833, 62500, 16667], 2), 16667);
      const body = partialRoundPath(w, b, [r, r, r, r]).replace(/ Z$/, '');
      return `${body} L ${pt(w * 0.42, b)} L ${pt(w * 0.28, h)} L ${pt(w * 0.32, b)} L ${pt(0, b)} Z`;
    },
  },
  wedgeEllipseCallout: {
    pptx: 'wedgeEllipseCallout', exact: 'approximate', adj: [-20833, 62500],
    path: (w, h) => {
      const b = h * 0.78;
      const body = ellipseAt(w / 2, b / 2, w / 2, b / 2).replace(/ Z$/, '');
      return `${body} L ${pt(w * 0.42, b)} L ${pt(w * 0.28, h)} L ${pt(w * 0.32, b)} Z`;
    },
  },

  /* ---------- 括号 ---------- */
  leftBrace: {
    pptx: 'leftBrace', exact: 'approximate', adj: [8333, 50000],
    path: (w, h) => {
      const t = w * 0.5;
      return `M ${pt(w, 0)} C ${pt(t, 0)} ${pt(t, h * 0.2)} ${pt(t, h * 0.35)}`
        + ` L ${pt(t, h * 0.44)} C ${pt(t, h * 0.48)} ${pt(0, h * 0.47)} ${pt(0, h * 0.5)}`
        + ` C ${pt(0, h * 0.53)} ${pt(t, h * 0.52)} ${pt(t, h * 0.56)}`
        + ` L ${pt(t, h * 0.65)} C ${pt(t, h * 0.8)} ${pt(t, h)} ${pt(w, h)}`;
    },
  },
  rightBrace: {
    pptx: 'rightBrace', exact: 'approximate', adj: [8333, 50000],
    path: (w, h) => {
      const t = w * 0.5;
      return `M ${pt(0, 0)} C ${pt(t, 0)} ${pt(t, h * 0.2)} ${pt(t, h * 0.35)}`
        + ` L ${pt(t, h * 0.44)} C ${pt(t, h * 0.48)} ${pt(w, h * 0.47)} ${pt(w, h * 0.5)}`
        + ` C ${pt(w, h * 0.53)} ${pt(t, h * 0.52)} ${pt(t, h * 0.56)}`
        + ` L ${pt(t, h * 0.65)} C ${pt(t, h * 0.8)} ${pt(t, h)} ${pt(0, h)}`;
    },
  },
  leftBracket: {
    pptx: 'leftBracket', exact: 'preset', adj: 8333,
    path: (w, h, a) => { const t = adjPx(a, w, h, 8333); return poly([[w, 0], [t, 0], [t, h], [w, h]]); },
  },
  rightBracket: {
    pptx: 'rightBracket', exact: 'preset', adj: 8333,
    path: (w, h, a) => { const t = w - adjPx(a, w, h, 8333); return poly([[0, 0], [t, 0], [t, h], [0, h]]); },
  },

  /* ---------- 流程图 ---------- */
  flowChartProcess: { pptx: 'flowChartProcess', exact: 'preset', path: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]) },
  flowChartAlternateProcess: { pptx: 'flowChartAlternateProcess', exact: 'preset', path: (w, h) => roundRectPath(w, h, Math.min(w, h) * 0.15) },
  flowChartDecision: { pptx: 'flowChartDecision', exact: 'preset', path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) },
  flowChartTerminator: { pptx: 'flowChartTerminator', exact: 'preset', path: (w, h) => partialRoundPath(w, h, [h / 2, h / 2, h / 2, h / 2]) },
  flowChartConnector: { pptx: 'flowChartConnector', exact: 'preset', path: (w, h) => ellipsePath(w, h) },
  flowChartDocument: {
    pptx: 'flowChartDocument', exact: 'approximate',
    path: (w, h) => {
      const b = h * 0.82;
      const wave = arcCurves(w / 2, b, w / 2, h - b, 180, 0);
      return `${poly([[0, 0], [w, 0], [w, b]], false)} ${curvesToD(wave)} Z`;
    },
  },
  flowChartPredefinedProcess: {
    pptx: 'flowChartPredefinedProcess', exact: 'preset',
    path: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]),
    detail: (w, h) => [line(w * 0.12, 0, w * 0.12, h), line(w * 0.88, 0, w * 0.88, h)],
  },
  flowChartInternalStorage: {
    pptx: 'flowChartInternalStorage', exact: 'preset',
    path: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]),
    detail: (w, h) => [line(w * 0.12, 0, w * 0.12, h), line(0, h * 0.14, w, h * 0.14)],
  },
  flowChartManualInput: { pptx: 'flowChartManualInput', exact: 'preset', path: (w, h) => poly([[0, h * 0.2], [w, 0], [w, h], [0, h]]) },
  flowChartManualOperation: { pptx: 'flowChartManualOperation', exact: 'preset', path: (w, h) => poly([[0, 0], [w, 0], [w * 0.82, h], [w * 0.18, h]]) },
  flowChartPreparation: {
    pptx: 'flowChartPreparation', exact: 'preset', adj: 50000,
    path: (w, h, a) => { const x = adjPx(a, w, h, 50000); return poly([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]]); },
  },
  flowChartOffpageConnector: { pptx: 'flowChartOffpageConnector', exact: 'preset', path: (w, h) => poly([[0, 0], [w, 0], [w, h * 0.72], [w / 2, h], [0, h * 0.72]]) },
  flowChartDelay: { pptx: 'flowChartDelay', exact: 'preset', path: (w, h) => partialRoundPath(w, h, [0, h / 2, h / 2, 0]) },
  flowChartDisplay: {
    pptx: 'flowChartDisplay', exact: 'preset',
    path: (w, h) => {
      const bx = Math.min(w * 0.2, h / 2);
      const body = partialRoundPath(w - bx, h, [0, h / 2, h / 2, 0]).replace(/^M [^L]*L\s*/, '');
      return `M ${pt(0, h / 2)} L ${pt(bx, 0)} L ${pt(w - h / 2, 0)} C ${pt(w - h / 2 + (h / 2) * K, 0)} ${pt(w, h / 2 - (h / 2) * K)} ${pt(w, h / 2)}`
        + ` C ${pt(w, h / 2 + (h / 2) * K)} ${pt(w - h / 2 + (h / 2) * K, h)} ${pt(w - h / 2, h)} L ${pt(bx, h)} Z`;
    },
  },
  flowChartMagneticDisk: { pptx: 'flowChartMagneticDisk', exact: 'preset', path: (w, h) => cylinderPath(w, h, 50000), detail: (w, h) => cylinderLid(w, h, 50000) },
  flowChartMagneticDrum: {
    pptx: 'flowChartMagneticDrum', exact: 'approximate',
    path: (w, h) => {
      const rx = w * 0.16;
      const right = arcCurves(w - rx, h / 2, rx, h / 2, 270, 90);
      const left = arcCurves(rx, h / 2, rx, h / 2, 90, 270);
      return `M ${pt(rx, 0)} ${curvesToD(right)} L ${pt(rx, h)} ${curvesToD(left)} Z`;
    },
  },
  flowChartMagneticTape: { pptx: 'flowChartMagneticTape', exact: 'approximate', path: (w, h) => partialRoundPath(w, h, [h * 0.5, h * 0.5, h * 0.18, h * 0.18]) },
  flowChartOnlineStorage: { pptx: 'flowChartOnlineStorage', exact: 'preset', path: (w, h) => partialRoundPath(w, h, [h / 2, 0, 0, h / 2]) },
  flowChartMultidocument: {
    pptx: 'flowChartMultidocument', exact: 'approximate',
    path: (w, h) => {
      const ox = w * 0.1, oy = h * 0.14;
      const back = poly([[ox, 0], [w, 0], [w, h - oy], [ox, h - oy]]);
      const front = poly([[0, oy], [w - ox, oy], [w - ox, h], [0, h]]);
      return `${back} ${front}`;
    },
  },
  flowChartSort: {
    pptx: 'flowChartSort', exact: 'preset',
    path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
    detail: (w, h) => [line(0, h / 2, w, h / 2)],
  },
  flowChartExtract: { pptx: 'flowChartExtract', exact: 'preset', path: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]) },
  flowChartMerge: { pptx: 'flowChartMerge', exact: 'preset', path: (w, h) => poly([[0, 0], [w, 0], [w / 2, h]]) },
  flowChartOr: {
    pptx: 'flowChartOr', exact: 'preset',
    path: (w, h) => ellipsePath(w, h),
    detail: (w, h) => [line(0, h / 2, w, h / 2), line(w / 2, 0, w / 2, h)],
  },
  flowChartSummingJunction: {
    pptx: 'flowChartSummingJunction', exact: 'preset',
    path: (w, h) => ellipsePath(w, h),
    detail: (w, h) => {
      const k = 0.1464;
      return [line(w * k, h * k, w * (1 - k), h * (1 - k)), line(w * (1 - k), h * k, w * k, h * (1 - k))];
    },
  },
  flowChartCollate: {
    pptx: 'flowChartCollate', exact: 'preset',
    path: (w, h) => `${poly([[0, 0], [w, 0], [w / 2, h / 2]])} ${poly([[w / 2, h / 2], [w, h], [0, h]])}`,
  },
  flowChartPunchedCard: { pptx: 'flowChartPunchedCard', exact: 'preset', path: (w, h) => poly([[w * 0.18, 0], [w, 0], [w, h], [0, h], [0, h * 0.22]]) },
  flowChartPunchedTape: {
    pptx: 'flowChartPunchedTape', exact: 'approximate',
    path: (w, h) => {
      const top = arcCurves(w / 2, h * 0.12, w / 2, h * 0.12, 180, 360);
      const bot = arcCurves(w / 2, h * 0.88, w / 2, h * 0.12, 0, 180);
      return `M ${pt(0, h * 0.12)} ${curvesToD(top)} L ${pt(w, h * 0.88)} ${curvesToD(bot)} Z`;
    },
  },
  flowChartOfflineStorage: { pptx: 'flowChartOfflineStorage', exact: 'approximate', path: (w, h) => poly([[w * 0.18, 0], [w, 0], [w, h], [0, h], [0, h * 0.22]]) },
};

/* ============================== 弧类形状 ============================== */

function anglesOf(options) {
  const r = Array.isArray(options?.angleRange) ? options.angleRange : null;
  return [clampAngle(r?.[0], 0), clampAngle(r?.[1], 270)];
}

function piePath(w, h, options) {
  const [start, end] = anglesOf(options);
  const a = arcCurves(w / 2, h / 2, w / 2, h / 2, start, end);
  return `M ${pt(w / 2, h / 2)} L ${pt(a.start[0], a.start[1])} ${curvesToD(a)} Z`;
}

function blockArcPath(w, h, options) {
  const [start, end] = anglesOf(options);
  // pptxgenjs 把 arcThicknessRatio 写成 adj3 = ratio × 50000，而 OOXML 的厚度是 hR × adj3 / 100000，
  // 故实际厚度为 ratio/2 × r；默认 0.5 对应 OOXML 默认 adj3=25000（厚度 0.25r）。
  const t = Math.max(0.05, Math.min(1, num(options?.arcThicknessRatio, 0.5))) / 2;
  const rx = w / 2, ry = h / 2;
  const outer = arcCurves(rx, ry, rx, ry, start, end);
  const inner = arcCurves(rx, ry, rx * (1 - t), ry * (1 - t), end, start);
  return `M ${pt(outer.start[0], outer.start[1])} ${curvesToD(outer)} L ${pt(inner.start[0], inner.start[1])} ${curvesToD(inner)} Z`;
}

/* ============================== 对外 API ============================== */

/** DSL 元素类型 → 形状名的糖衣映射（形状表里没有的边数走自定义路径） */
export function sugarShape(elop) {
  switch (elop.elType) {
    case 'shape-ellipse': return 'ellipse';
    case 'shape-wedge': return 'pie';
    case 'shape-arc': return 'arc';
    case 'shape-ring': return 'donut';
    case 'shape-star': {
      const p = num(elop.points, 5);
      return SHAPE_GEOMETRY[`star${p}`] ? `star${p}` : null;
    }
    // shape-polygon 一律走共享顶点列 + customGeometry（见 buildShape）：
    // 它的语义是"正多边形"，用顶点列能保证两端严格一致；要原生 preset 请用 shape-preset。
    default: return null;
  }
}

export const SHAPE_NAMES = Object.keys(SHAPE_GEOMETRY);
export const PRESET_SHAPE_TYPES = new Set(SHAPE_NAMES.map(n => SHAPE_GEOMETRY[n].pptx));

export function shapeInfo(name) {
  return SHAPE_GEOMETRY[name] || null;
}

/** 解析元素的有效形状名 */
export function resolveShape(elop) {
  return elop.elType === 'shape-preset' ? (elop.shape || null) : sugarShape(elop);
}

/** 元素是否为形状库成员（含 shape-preset 与糖衣类型） */
export function isShapeElement(elType) {
  return elType === 'shape-preset' || elType === 'shape-star' || elType === 'shape-ellipse'
    || elType === 'shape-wedge' || elType === 'shape-arc' || elType === 'shape-ring'
    || elType === 'shape-polygon';
}

/**
 * 形状名/参数能否映射到几何——不需要尺寸即可判定。
 * 与 buildShape 的接受条件保持一致，供校验器使用，避免两处判定漂移。
 */
export function isSupportedShape(elop) {
  if (elop.elType === 'shape-polygon') return Math.round(num(elop.sides, 6)) >= 3;
  const name = resolveShape(elop);
  return Boolean(name && SHAPE_GEOMETRY[name]);
}

function shapeOptions(elop, info) {
  const raw = Array.isArray(elop.angleRange) ? elop.angleRange : info.angles;
  // OOXML 的弧段语义：起止角是 [0,360] 内的绝对角度，扫角取**有符号差** end-start
  // （preset 自身默认值如 arc 的 [270,0] 就是 -270°，故负扫角是合法且必要的）。
  // 因此这里只做钳制，绝不把 360 折成 0——那会把 +180° 变成 -180°，画到另一半上去。
  const angleRange = raw ? [clampAngle(raw[0], 0), clampAngle(raw[1], 270)] : null;
  return {
    angleRange,
    arcThicknessRatio: num(elop.arcThicknessRatio, info.thickness ?? 0.5),
  };
}

function clampAngle(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(360, Math.max(0, n)) : fallback;
}

/** 正多边形的顶点列（局部坐标） */
export function polygonPoints(width, height, sides) {
  const n = Math.max(3, Math.round(num(sides, 6)));
  const cx = width / 2, cy = height / 2, rx = width / 2, ry = height / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/**
 * 生成形状的两端几何。
 * @returns {{ data, detail, exact, shape, pptx, points?, angleRange?, arcThicknessRatio? } | null}
 *   pptx 为 preset 名称；无 preset 对应时（任意边数多边形）改为返回 points，
 *   由导出端走 customGeometry——两端仍来自同一份顶点列，因此依然严格一致。
 */
export function buildShape(elop) {
  const w = num(elop.width, 0);
  const h = num(elop.height, 0);
  if (!(w > 0) || !(h > 0)) return null;

  // 任意边数的正多边形：一律使用共享顶点列，导出端走 customGeometry。
  // 这样两端几何完全相同，也避免依赖 OOXML 对非等比包围盒的轴向缩放。
  if (elop.elType === 'shape-polygon') {
    const sides = Math.max(3, Math.round(num(elop.sides, 6)));
    const points = polygonPoints(w, h, sides);
    return {
      data: poly(points.map(p => [p.x, p.y])),
      detail: [], exact: 'preset', shared: true, shape: `polygon${sides}`, pptx: null, points,
    };
  }

  const name = resolveShape(elop);
  if (!name) return null;
  const info = SHAPE_GEOMETRY[name];
  if (!info) return null;
  const options = shapeOptions(elop, info);
  const data = info.path(w, h, elop.adjust, options);
  const detail = typeof info.detail === 'function' ? info.detail(w, h, elop.adjust, options) : [];
  const out = { data, detail, exact: info.exact, shape: name, pptx: info.pptx };
  if (info.angles) out.angleRange = options.angleRange;
  if (name === 'blockArc') out.arcThicknessRatio = options.arcThicknessRatio;
  return out;
}

/** 自定义正多边形（无对应 OOXML preset 的边数）：自由路径表达，两端同样一致 */
export function customPolygonPath(width, height, sides) {
  return regularPolygon(width, height, Math.max(3, Math.round(num(sides, 6))));
}
