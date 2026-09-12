/**
 * shape-path coordinate normalization and validation.
 * local: pointArr is relative to element x/y.
 * absolute: pointArr uses canvas coordinates and will be normalized.
 */
const TOL = 1;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function includeAnchor(box, p) {
  if (isNum(p.x)) {
    box.minX = Math.min(box.minX, p.x);
    box.maxX = Math.max(box.maxX, p.x);
  }
  if (isNum(p.y)) {
    box.minY = Math.min(box.minY, p.y);
    box.maxY = Math.max(box.maxY, p.y);
  }
}

function includeControl(box, p) {
  if (p.controlPoint) {
    if (isNum(p.controlPoint.x)) {
      box.minX = Math.min(box.minX, p.controlPoint.x);
      box.maxX = Math.max(box.maxX, p.controlPoint.x);
    }
    if (isNum(p.controlPoint.y)) {
      box.minY = Math.min(box.minY, p.controlPoint.y);
      box.maxY = Math.max(box.maxY, p.controlPoint.y);
    }
  }
  if (p.curve && p.curve.type !== 'arc') {
    for (const key of ['x1', 'y1', 'x2', 'y2']) {
      const v = p.curve[key];
      if (!isNum(v)) continue;
      if (key[0] === 'x') {
        box.minX = Math.min(box.minX, v);
        box.maxX = Math.max(box.maxX, v);
      } else {
        box.minY = Math.min(box.minY, v);
        box.maxY = Math.max(box.maxY, v);
      }
    }
  }
}
function bounds(pointArr, full) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pointArr || []) {
    if (!p) continue;
    includeAnchor(box, p);
    if (full) includeControl(box, p);
  }
  return Number.isFinite(box.minX) && Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) && Number.isFinite(box.maxY)
    ? box
    : null;
}

function translatePoint(p, dx, dy) {
  const q = { ...p };
  if (isNum(q.x)) q.x = round2(q.x - dx);
  if (isNum(q.y)) q.y = round2(q.y - dy);
  if (q.controlPoint) {
    q.controlPoint = { ...q.controlPoint };
    if (isNum(q.controlPoint.x)) q.controlPoint.x = round2(q.controlPoint.x - dx);
    if (isNum(q.controlPoint.y)) q.controlPoint.y = round2(q.controlPoint.y - dy);
  }
  if (q.curve && (q.curve.type === 'cubic' || q.curve.type === 'quadratic')) {
    q.curve = { ...q.curve };
    for (const key of ['x1', 'y1', 'x2', 'y2']) {
      if (isNum(q.curve[key])) q.curve[key] = round2(q.curve[key] - (key[0] === 'x' ? dx : dy));
    }
  }
  return q;
}

function hasArc(pointArr) {
  return (pointArr || []).some(function (p) {
    return p && p.curve && p.curve.type === 'arc';
  });
}
export function analyzeShapePath(el) {
  const mode = el.coordinateMode || 'auto';
  if (mode !== 'auto' && mode !== 'local' && mode !== 'absolute') {
    return { error: 'coordinateMode must be "local" | "absolute" | "auto"' };
  }
  if (!Array.isArray(el.pointArr) || el.pointArr.length < 2) {
    return { error: 'pointArr requires at least 2 points' };
  }
  const box = bounds(el.pointArr, false);
  const fullBox = bounds(el.pointArr, true) || box;
  if (!box) return { error: 'pointArr has no valid numeric x/y' };

  const width = Number.isFinite(el.width) ? el.width : 0;
  const height = Number.isFinite(el.height) ? el.height : 0;
  const localValid = box.minX >= -TOL && box.minY >= -TOL &&
    box.maxX <= width + TOL && box.maxY <= height + TOL;
  const zeroOrigin = Number(el.x || 0) === 0 && Number(el.y || 0) === 0;
  const arc = hasArc(el.pointArr);

  if (mode === 'local') {
    if (!localValid) {
      return { error: 'pointArr exceeds declared x/y/width/height; use local coords or coordinateMode:"absolute"' };
    }
    return { mode: 'local', box, fullBox, width, height };
  }

  if (mode === 'absolute') {
    if (arc) return { error: 'absolute mode does not support arc curves yet' };
    return { mode: 'absolute', box, fullBox, width, height };
  }

  if (localValid) return { mode: 'local', box, fullBox, width, height };
  if (zeroOrigin && !arc) return { mode: 'absolute', box, fullBox, width, height };
  if (arc) return { error: 'ambiguous absolute arc path; use local coords' };
  return { error: 'ambiguous shape-path coordinates; set coordinateMode:"local" or "absolute"' };
}

export function validateShapePathElement(el) {
  const info = analyzeShapePath(el);
  return info.error || null;
}
export function normalizeShapePathElement(el) {
  const info = analyzeShapePath(el);
  if (info.error) throw new Error(info.error + ' [' + (el.id || el.elType) + ']');
  if (info.mode === 'local') return el;

  const box = info.fullBox || info.box;
  const pad = Math.max(0, Number(el.strokeWidth || el.lineWidth || 0) / 2);
  const originX = round2(box.minX - pad);
  const originY = round2(box.minY - pad);
  const width = round2(box.maxX - box.minX + pad * 2);
  const height = round2(box.maxY - box.minY + pad * 2);

  return {
    ...el,
    x: originX,
    y: originY,
    width,
    height,
    pointArr: el.pointArr.map(function (p) { return translatePoint(p, originX, originY); }),
    coordinateMode: 'local',
    _resolvedCoordinateMode: 'absolute',
  };
}

export function normalizeShapePaths(deck) {
  for (const slide of deck.slides || []) {
    if (!Array.isArray(slide.elements)) continue;
    slide.elements = slide.elements.map(function (el) {
      if (!el || el.elType !== 'shape-path') return el;
      return normalizeShapePathElement(el);
    });
  }
  return deck;
}