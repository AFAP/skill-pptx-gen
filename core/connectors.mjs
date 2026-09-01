/**
 * ai-ppt-gen 连接线与弧形宏（构建期展开）
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
 */
/**
 * arc-segment — 圆环扇段（弧形轨道流布局）
 * 外弧顺时针扫过 + 内弧逆时针返回，闭合为甜甜圈扇区。
 * 与原项目 handelArcOrbitalFlowOptions 的圆弧参数一致（角度制）。
 *
 * arrow（默认 true）：段尾生成箭头缺口（外弧末端 → 中环箭头尖 → 内弧），
 * 箭头探入下一段的缝隙，指示流向——与原项目 handelArcOrbitalFlowOptions 一致。
 */
function expandArcSegment(el) {
  const { cx, cy, rOuter, rInner = rOuter * 0.72, startAngle, endAngle } = el;
  // 扫角归一化到 (0,360]：跨 0° 的写法（如 270→25）自动修正为 +115 而非 -245
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += 360;
  const arrow = el.arrow !== false;
  const arrowAngle = el.arrowAngle ?? 6;   // 箭头前探角度
  const rArrow = (rOuter + rInner) / 2;
  const p1 = arcPoint(cx, cy, rOuter, startAngle);
  const p2 = arcPoint(cx, cy, rOuter, endAngle);
  const p3 = arcPoint(cx, cy, rInner, endAngle);
  const p4 = arcPoint(cx, cy, rInner, startAngle);
  const x = cx - rOuter, y = cy - rOuter; // 元素原点 = 外接正方形左上
  const L = p => ({ x: +(p.x - x).toFixed(2), y: +(p.y - y).toFixed(2) });
  const pointArr = [
    { ...L(p1), moveTo: true },
    { ...L(p2), curve: { type: 'arc', hR: rOuter, wR: rOuter, stAng: startAngle, swAng: sweep } },
  ];
  if (arrow) {
    const tip = arcPoint(cx, cy, rArrow, endAngle + arrowAngle); // 箭头尖：中环半径、前探 arrowAngle
    pointArr.push(L(tip));
  }
  pointArr.push(L(p3));
  pointArr.push({ ...L(p4), curve: { type: 'arc', hR: rInner, wR: rInner, stAng: endAngle, swAng: -sweep } });
  return {
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

/** 展开单个元素；非宏类型原样返回 */
export function expandElement(el) {
  const fn = EXPANDERS[el?.elType];
  return fn ? fn(el) : el;
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
  for (let i = 0; i < pointArr.length; i++) {
    const p = pointArr[i];
    if (i === 0 || p.moveTo) {
      d += `M ${p.x} ${p.y} `;
      continue;
    }
    if (p.controlPoint && p.controlPoint.type === 'quadratic') {
      d += `Q ${p.controlPoint.x} ${p.controlPoint.y} ${p.x} ${p.y} `;
    } else if (p.curve && p.curve.type === 'cubic') {
      d += `C ${p.curve.x1} ${p.curve.y1} ${p.curve.x2} ${p.curve.y2} ${p.x} ${p.y} `;
    } else if (p.curve && p.curve.type === 'quadratic') {
      d += `Q ${p.curve.x1} ${p.curve.y1} ${p.x} ${p.y} `;
    } else if (p.curve && p.curve.type === 'arc') {
      const largeArc = Math.abs(p.curve.swAng) > 180 ? 1 : 0;
      const sweepFlag = p.curve.swAng >= 0 ? 1 : 0;
      d += `A ${p.curve.wR} ${p.curve.hR} 0 ${largeArc} ${sweepFlag} ${p.x} ${p.y} `;
    } else {
      d += `L ${p.x} ${p.y} `;
    }
  }
  return d.trim();
}
