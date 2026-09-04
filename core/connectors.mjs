/**
 * ppt-gen 连接线与弧形宏（构建期展开）
 *
 * 源自 aippt 项目 utils.js 中脑图/hub 布局的连接线生成逻辑（S 型曲线、
 * getArcPoints、弧形轨道流 path 构造），升级为三个 DSL 宏。
 *
 * 这些"宏元素"不是渲染类型：在 Node 构建管线（build_pptx.mjs）与预览生成
 * （make_preview.mjs）阶段被 expandConnectors 展开为标准 DSL 元素
 * （curve-quadratic / shape-path），Konva 预览与 PPTX 导出因此天然一致。
 *
 * 宏一览：
 *   {"elType":"connector-s",     "x1":640,"y1":240,"x2":320,"y2":380, "stroke":"$text2","strokeWidth":2,"dashType":"dash"}
 *   {"elType":"connector-elbow", "x1":640,"y1":360,"x2":900,"y2":520, "orientation":"h-first", "stroke":"$text2"}
 *   {"elType":"arc-segment", "cx":640,"cy":380,"rOuter":240,"rInner":170,"startAngle":0,"endAngle":110, "fill":"$2"}
 */

/** 圆上一点（角度制：0°=正右，顺时针为正方向，屏幕坐标系 y 向下） */
export function arcPoint(cx, cy, r, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  return {
    x: Math.round((cx + r * Math.cos(rad)) * 100) / 100,
    y: Math.round((cy + r * Math.sin(rad)) * 100) / 100,
  };
}

// 宏只负责几何降级；对象身份、校验豁免和来源信息必须继续随图元流转。
// 否则预览端可定位的元素在导出前会丢失 id，越界装饰也无法显式声明。
function inheritMacroMetadata(el) {
  const out = {};
  for (const key of ['id', 'name', 'role', 'sourcePath', 'allowOverflow', 'allowOverlap']) {
    if (el[key] != null) out[key] = el[key];
  }
  return out;
}

/** 椭圆弧转为可被 Konva 与 PptxGenJS customGeometry 同时消费的 cubic 点列。 */
function arcToCubicPoints(cx, cy, rx, ry, a0Deg, a1Deg) {
  const sweep = a1Deg - a0Deg;
  const segs = Math.max(1, Math.ceil(Math.abs(sweep) / 90));
  const stepDeg = sweep / segs;
  const points = [];
  let a = a0Deg;
  const f = value => Math.round(value * 100) / 100;
  for (let i = 0; i < segs; i++) {
    const a2 = a + stepDeg;
    const r0 = a * Math.PI / 180, r1 = a2 * Math.PI / 180;
    const p0 = [cx + rx * Math.cos(r0), cy + ry * Math.sin(r0)];
    const p1 = [cx + rx * Math.cos(r1), cy + ry * Math.sin(r1)];
    const k = 4 / 3 * Math.tan((r1 - r0) / 4);
    const d0 = [-rx * Math.sin(r0), ry * Math.cos(r0)];
    const d1 = [-rx * Math.sin(r1), ry * Math.cos(r1)];
    points.push({
      x: f(p1[0]), y: f(p1[1]),
      curve: {
        type: 'cubic',
        x1: f(p0[0] + k * d0[0]), y1: f(p0[1] + k * d0[1]),
        x2: f(p1[0] - k * d1[0]), y2: f(p1[1] - k * d1[1]),
      },
    });
    a = a2;
  }
  return points;
}

/**
 * connector-s — 脑图标准连接线（单条三次贝塞尔）
 *
 * 手柄方向按连线形态自适应（脑图软件经典做法），也可用 orientation 强制：
 *   强纵向（|dy| ≥ 2|dx|）或 orientation:'v'：竖直切线出入 —— top-hub 布局的 S 下落
 *   强横向（|dx| ≥ 2|dy|）或 orientation:'h'：水平切线出入 —— left-hub / 左右树形
 *   对角连接（auto 才走这条）：手柄沿连线方向（35%/65% 处）—— 柔和近直线，
 *            不会像轴对齐 S 那样在对角场景甩成大圆弧（圆环错觉）
 */
function expandConnectorS(el) {
  const { x1, y1, x2, y2 } = el;
  const dx = x2 - x1, dy = y2 - y1;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  const w = ax, h = ay;
  let c1, c2;
  // orientation 可强制切线方向：'v' 竖直出入 / 'h' 水平出入（hub 布局常用）；默认 auto 三模式自适应
  const orient = el.orientation || 'auto';
  const mode = (orient === 'v' || orient === 'h') ? orient
    : ay >= ax * 2 ? 'v'
    : ax >= ay * 2 ? 'h'
    : 'diag';
  if (mode === 'v') {
    const my = (y1 + y2) / 2;
    c1 = { x: x1, y: my };
    c2 = { x: x2, y: my };
  } else if (mode === 'h') {
    const mx = (x1 + x2) / 2;
    c1 = { x: mx, y: y1 };
    c2 = { x: mx, y: y2 };
  } else {
    c1 = { x: x1 + dx * 0.35, y: y1 + dy * 0.35 };
    c2 = { x: x2 - dx * 0.35, y: y2 - dy * 0.35 };
  }
  const pointArr = [
    { x: x1 - x, y: y1 - y, moveTo: true },
    { x: x2 - x, y: y2 - y, curve: { type: 'cubic', x1: c1.x - x, y1: c1.y - y, x2: c2.x - x, y2: c2.y - y } },
  ];
  return {
    ...inheritMacroMetadata(el),
    elType: 'shape-path',
    x, y, width: w, height: h, pointArr, closePath: false,
    stroke: el.stroke || '#666666',
    strokeWidth: el.strokeWidth ?? 2,
    ...(el.dashType ? { dashType: el.dashType } : {}),
    ...(el.opacity != null ? { opacity: el.opacity } : {}),
    fill: '#00000000',
  };
}

/**
 * connector-elbow — 直角肘形连接线（组织架构图/脑图风格）
 * orientation: 'h-first'（先横后竖，默认当 |dx|>|dy|）| 'v-first'（先竖后横）
 */
function expandConnectorElbow(el) {
  const { x1, y1, x2, y2 } = el;
  const orientation = el.orientation || (Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 'h-first' : 'v-first');
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  const corner = orientation === 'h-first' ? { x: x2, y: y1 } : { x: x1, y: y2 };
  const pointArr = [
    { x: x1 - x, y: y1 - y, moveTo: true },
    { x: corner.x - x, y: corner.y - y },
    { x: x2 - x, y: y2 - y },
  ];
  return {
    ...inheritMacroMetadata(el),
    elType: 'shape-path',
    x, y, width: w, height: h, pointArr, closePath: false,
    stroke: el.stroke || '#666666',
    strokeWidth: el.strokeWidth ?? 2,
    ...(el.dashType ? { dashType: el.dashType } : {}),
    ...(el.opacity != null ? { opacity: el.opacity } : {}),
    fill: '#00000000',
  };
}

/**
 * arc-segment — 圆环扇段（弧形轨道流布局）
 * 外弧顺时针扫过 + 内弧逆时针返回，闭合为甜甜圈扇区。
 * 与原项目 handelArcOrbitalFlowOptions 的圆弧参数一致（角度制）。
 *
 * arrow（默认 true）：段尾前探箭头尖 + 段首内凹口（V 形），相邻段互相咬合
 * 指示流向——与原项目 handelArcOrbitalFlowOptions 的路径结构一致。
 */
function expandArcSegment(el) {
  const { cx, cy, rOuter, rInner = rOuter * 0.72, startAngle, endAngle } = el;
  // 扫角归一化到 (0,360]：跨 0° 的写法（如 270→25）自动修正为 +115 而非 -245
  let sweep = ((endAngle - startAngle) % 360 + 360) % 360 || 360; // 归一化到 (0,360]：跨 0° 取正向，>360 取模
  const arrow = el.arrow !== false;
  const arrowAngle = el.arrowAngle ?? 6;   // 箭头前探/凹口角度（与原项目 utils.js 一致）
  const rArrow = (rOuter + rInner) / 2;
  const p1 = arcPoint(cx, cy, rOuter, startAngle);
  const p2 = arcPoint(cx, cy, rOuter, endAngle);
  const p3 = arcPoint(cx, cy, rInner, endAngle);
  const p4 = arcPoint(cx, cy, rInner, startAngle);
  const x = cx - rOuter, y = cy - rOuter; // 元素原点 = 外接正方形左上
  const L = p => ({ x: +(p.x - x).toFixed(2), y: +(p.y - y).toFixed(2) });
  const localCubic = p => ({
    x: +(p.x - x).toFixed(2), y: +(p.y - y).toFixed(2),
    curve: {
      ...p.curve,
      x1: +(p.curve.x1 - x).toFixed(2), y1: +(p.curve.y1 - y).toFixed(2),
      x2: +(p.curve.x2 - x).toFixed(2), y2: +(p.curve.y2 - y).toFixed(2),
    },
  });
  const pointArr = [
    { ...L(p1), moveTo: true },
    ...arcToCubicPoints(cx, cy, rOuter, rOuter, startAngle, startAngle + sweep).map(localCubic),
  ];
  if (arrow) {
    const tip = arcPoint(cx, cy, rArrow, endAngle + arrowAngle); // 段尾箭头尖：中环半径、前探 arrowAngle
    pointArr.push(L(tip));
  }
  pointArr.push(L(p3));
  pointArr.push(...arcToCubicPoints(cx, cy, rInner, rInner, startAngle + sweep, startAngle).map(localCubic));
  if (arrow) {
    const notch = arcPoint(cx, cy, rArrow, startAngle + arrowAngle); // 段首凹口：闭合时形成 V 形缺口接收上一段箭头
    pointArr.push(L(notch));
  }
  return {
    ...inheritMacroMetadata(el),
    elType: 'shape-path',
    x, y, width: rOuter * 2, height: rOuter * 2, pointArr, closePath: true,
    fill: el.fill || '#4A90E2',
    ...(el.stroke ? { stroke: el.stroke, strokeWidth: el.strokeWidth ?? 1 } : {}),
    ...(el.opacity != null ? { opacity: el.opacity } : {}),
  };
}

const EXPANDERS = {
  'connector-s': expandConnectorS,
  'connector-elbow': expandConnectorElbow,
  'arc-segment': expandArcSegment,
};

export const MACRO_TYPES = Object.keys(EXPANDERS);

function normalizePathArcCurves(el) {
  if (!Array.isArray(el?.pointArr) || !el.pointArr.some(p => p?.curve?.type === 'arc')) return el;
  const pointArr = [];
  let cur = null;
  for (const p of el.pointArr) {
    if (p?.curve?.type === 'arc' && cur) {
      const { hR, wR, stAng, swAng } = p.curve;
      const r0 = stAng * Math.PI / 180;
      const cx = cur.x - wR * Math.cos(r0);
      const cy = cur.y - hR * Math.sin(r0);
      pointArr.push(...arcToCubicPoints(cx, cy, wR, hR, stAng, stAng + swAng));
    } else {
      pointArr.push(p);
    }
    cur = { x: p.x, y: p.y };
  }
  return { ...el, pointArr };
}

/** 展开单个元素；非宏类型原样返回 */
export function expandElement(el) {
  const fn = EXPANDERS[el?.elType];
  const expanded = fn ? fn(el) : el;
  return (expanded?.elType === 'shape-path' || expanded?.elType === 'curve-quadratic')
    ? normalizePathArcCurves(expanded)
    : expanded;
}

/** 原地展开 deck 中所有宏元素（在 resolveTokens 之后调用，颜色令牌已解析） */
export function expandConnectors(deck) {
  for (const slide of deck.slides || []) {
    if (Array.isArray(slide.elements)) {
      slide.elements = slide.elements.map(expandElement);
    }
  }
  return deck;
}

/** 预览端：把展开后的 pointArr 合成 SVG path data（Konva.Path 用） */
export function pointsToSvgPath(pointArr) {
  if (!Array.isArray(pointArr) || !pointArr.length) return '';
  let d = '';
  let cur = null; // 当前点（弧转贝塞尔需要起点反推圆心）
  for (let i = 0; i < pointArr.length; i++) {
    const p = pointArr[i];
    if (i === 0 || p.moveTo) {
      d += `M ${p.x} ${p.y} `;
      cur = { x: p.x, y: p.y };
      continue;
    }
    if (p.controlPoint && p.controlPoint.type === 'quadratic') {
      d += `Q ${p.controlPoint.x} ${p.controlPoint.y} ${p.x} ${p.y} `;
    } else if (p.curve && p.curve.type === 'cubic') {
      d += `C ${p.curve.x1} ${p.curve.y1} ${p.curve.x2} ${p.curve.y2} ${p.x} ${p.y} `;
    } else if (p.curve && p.curve.type === 'quadratic') {
      d += `Q ${p.curve.x1} ${p.curve.y1} ${p.x} ${p.y} `;
    } else if (p.curve && p.curve.type === 'arc' && cur) {
      // Konva 对 SVG A 命令解析不可靠：把圆弧转为三次贝塞尔逼近（C 命令处处可靠）
      // 圆心 = 起点 - (半径×cos/stAng, 半径×sin/stAng)（y 向下顺时针为正）
      const { hR, wR, stAng, swAng } = p.curve;
      const r0 = stAng * Math.PI / 180;
      const cx = cur.x - wR * Math.cos(r0);
      const cy = cur.y - hR * Math.sin(r0);
      d += arcToCubics(cx, cy, wR, hR, stAng, stAng + swAng);
    } else {
      d += `L ${p.x} ${p.y} `;
    }
    cur = { x: p.x, y: p.y };
  }
  return d.trim();
}

/** 椭圆弧（角度制，y 向下顺时针）→ 三次贝塞尔段（每段 ≤90°） */
function arcToCubics(cx, cy, rx, ry, a0Deg, a1Deg) {
  const sweep = a1Deg - a0Deg;
  const segs = Math.max(1, Math.ceil(Math.abs(sweep) / 90));
  const stepDeg = sweep / segs;
  let out = '';
  let a = a0Deg;
  for (let i = 0; i < segs; i++) {
    const a2 = a + stepDeg;
    const r0 = a * Math.PI / 180, r1 = a2 * Math.PI / 180;
    const p0 = [cx + rx * Math.cos(r0), cy + ry * Math.sin(r0)];
    const p1 = [cx + rx * Math.cos(r1), cy + ry * Math.sin(r1)];
    const k = 4 / 3 * Math.tan((r1 - r0) / 4);
    const d0 = [-rx * Math.sin(r0), ry * Math.cos(r0)];
    const d1 = [-rx * Math.sin(r1), ry * Math.cos(r1)];
    const c1 = [p0[0] + k * d0[0], p0[1] + k * d0[1]];
    const c2 = [p1[0] - k * d1[0], p1[1] - k * d1[1]];
    const f = v => Math.round(v * 100) / 100;
    out += `C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p1[0])} ${f(p1[1])} `;
    a = a2;
  }
  return out;
}
