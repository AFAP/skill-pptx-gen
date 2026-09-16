/**
 * 共享样式映射：把 DSL 的样式名解析成**两端各自的等价表示**。
 *
 * 存在的理由：PPTX 用命名虚线（dashType: 'dashDot'），Konva 用数值 dash 数组。若两个
 * 渲染器各写一份映射表，迟早会漂移。这里定义唯一一份，并在编译期把 Konva 侧的数值
 * 预先算好（`_dashArray`），使渲染器不做任何样式分支——与既有的"宏在编译期展开"一致。
 *
 * 仅依赖纯数据与算术，可安全打包进浏览器。
 */

/** 命名虚线 → PptxGenJS dashType + Konva dash 数组（数值为画布 px） */
export const DASH_FAMILIES = {
  solid: { pptx: 'solid', konva: null },
  dash: { pptx: 'dash', konva: [8, 6] },
  dashDot: { pptx: 'dashDot', konva: [8, 4, 2, 4] },
  lgDash: { pptx: 'lgDash', konva: [14, 6] },
  lgDashDot: { pptx: 'lgDashDot', konva: [14, 6, 2, 6] },
  lgDashDotDot: { pptx: 'lgDashDotDot', konva: [14, 6, 2, 6, 2, 6] },
  sysDash: { pptx: 'sysDash', konva: [4, 3] },
  sysDot: { pptx: 'sysDot', konva: [2, 3] },
  dot: { pptx: 'sysDot', konva: [2, 3] },
  dotDash: { pptx: 'dashDot', konva: [8, 4, 2, 4] },
  longDash: { pptx: 'lgDash', konva: [14, 6] },
  roundDot: { pptx: 'sysDot', konva: [2, 3] },
};

export const DASH_NAMES = Object.keys(DASH_FAMILIES);

/** 箭头头部类型（PptxGenJS ShapeLineProps begin/endArrowType 的全集） */
export const ARROW_HEADS = ['none', 'arrow', 'triangle', 'stealth', 'diamond', 'oval'];

/**
 * 未指定描边色时的默认线色。
 * 过去预览回退到 #333333、导出端却完全不写 <a:ln>（PowerPoint 用自己的默认色），
 * 属于静默的两端不一致；现在在编译期统一补齐，两个渲染器读同一个值。
 */
export const DEFAULT_LINE_COLOR = '#333333';

/** 需要"必然可见描边"的元素类型：连接线与线条缺色时必须补默认色 */
export const LINE_ELEMENT_TYPES = ['shape-line', 'shape-arrow', 'curve-quadratic'];

/** 两端造型严格一致的箭头类型（其余为等价近似，见 capabilities.mjs） */
export const EXACT_ARROW_HEADS = new Set(['none', 'arrow', 'triangle']);

/**
 * 解析 DSL 的 dashType / dash 字段。
 * @param {*} value 命名虚线、true（等价 dash）、或显式数值数组
 * @returns {{pptx: string|null, konva: number[]|null, name: string|null}}
 */
export function resolveDash(value) {
  if (value == null || value === false) return { pptx: null, konva: null, name: null };
  if (value === true) return { ...DASH_FAMILIES.dash, name: 'dash' };
  if (Array.isArray(value)) {
    const konva = value.map(Number).filter(Number.isFinite);
    return { pptx: konva.length ? 'dash' : null, konva: konva.length ? konva : null, name: 'custom' };
  }
  const key = String(value).trim();
  const family = DASH_FAMILIES[key];
  if (family) return { ...family, name: key };
  if (key === 'none') return { pptx: 'solid', konva: null, name: 'solid' };
  return { pptx: null, konva: null, name: null };
}

/** 归一化箭头类型；无法识别时返回 null（由校验器报错，不静默退化） */
export function resolveArrowHead(value) {
  if (value == null) return null;
  const key = String(value).trim();
  return ARROW_HEADS.includes(key) ? key : null;
}

/**
 * 文本换行：DSL 用 `wrap: false` 表示不换行。
 * 导出为 PPTX 的 wrap、预览为 Konva 的 wrap，两端必须由同一处派生。
 */
export function resolveWrap(value) {
  if (value === false || value === 'none' || value === 'off') return { pptx: false, konva: 'none' };
  if (value === 'char') return { pptx: true, konva: 'char' };
  return { pptx: true, konva: 'word' };
}
