/**
 * 能力注册表：**"哪些字段两端一致"的唯一真相源**
 *
 * 这个技能的产品价值是"网页预览与 PPTX 一致"，但"哪些能力两端都支持"这一知识过去
 * 分散在文档、两个渲染器和开发者记忆里，于是出现了若干静默的单向渲染字段
 * （预览画了、PPTX 丢了，或反之），而校验器一无所知。
 *
 * 这里把该知识编码成数据。收益：
 *   1. core/dsl-validate.mjs 据此**自动**为所有非 both 字段生成告警，不再依赖人肉清单；
 *   2. 两个渲染器实现新字段时以本表为验收依据，减少漏实现；
 *   3. 文档与测试可以从本表派生，防止三者漂移。
 *
 * parity 取值：
 *   'both'         两端语义一致
 *   'approximate'  两端都实现，但外观/精度存在已知差异
 *   'pptx-only'    只有 PPTX 生效
 *   'preview-only' 只有预览生效
 *
 * impact 决定是否告警（避免元数据字段刷屏）：
 *   'visual'   看起来不一样 → 告警
 *   'behavior' 交互/行为不一样 → 告警
 *   'metadata' 不影响观感（altText/objectName 等） → 不告警
 *
 * values 用于"同一字段不同取值可信度不同"的情形（如箭头头部造型）。
 */
import { buildShape, isShapeElement, resolveShape } from './shape-geometry.mjs';

export const PARITY = {
  BOTH: 'both',
  APPROXIMATE: 'approximate',
  PPTX_ONLY: 'pptx-only',
  PREVIEW_ONLY: 'preview-only',
};

const BOTH = { parity: PARITY.BOTH };
const APPROX = (note) => ({ parity: PARITY.APPROXIMATE, note });
const PPTX = (note, impact = 'visual') => ({ parity: PARITY.PPTX_ONLY, impact, note });
const PREVIEW = (note, impact = 'visual') => ({ parity: PARITY.PREVIEW_ONLY, impact, note });

/**
 * 字段级能力表。elements 为适用的 elType 列表，'*' 表示任意元素。
 * 只有出现在本表里的字段才会被告警——不在此表中说明该字段属于几何/内部约定。
 */
export const FIELD_CAPABILITIES = {
  /* ---- 文本 ---- */
  bold: { elements: ['text', 'table'], ...BOTH },
  italic: { elements: ['text', 'table'], ...BOTH },
  underline: { elements: ['text', 'table'], ...BOTH },
  strike: { elements: ['text', 'table'], ...BOTH },
  fontFamily: { elements: ['text', 'table'], ...BOTH },
  fontSize: { elements: ['text', 'table', 'chart'], ...BOTH },
  align: { elements: ['text', 'table'], ...BOTH },
  verticalAlign: { elements: ['text', 'table'], ...BOTH },
  lineHeight: { elements: ['text'], ...BOTH },
  letterSpacing: { elements: ['text'], ...BOTH },
  padding: { elements: ['text'], ...BOTH },
  wrap: { elements: ['text'], ...BOTH },
  bgFill: { elements: ['text'], ...BOTH },
  bgOpacity: { elements: ['text'], ...BOTH },
  bgRadius: { elements: ['text'], ...BOTH }, // 导出映射为 roundRect + rectRadius
  ellipsis: { elements: ['text'], ...PREVIEW('PPTX 无省略号截断：导出后文字会溢出而不是显示 …') },
  fit: { elements: ['text'], ...PPTX('PPTX 的自动缩放由 PowerPoint 在编辑/重排后才计算，预览不做等效缩字', 'behavior') },
  textDirection: { elements: ['text'], ...PPTX('竖排/堆叠文字未在预览实现') },
  vert: { elements: ['text'], ...PPTX('竖排/堆叠文字未在预览实现') },
  glow: { elements: ['text'], ...PPTX('文字发光未在预览实现') },
  outline: { elements: ['text'], ...PPTX('文字描边未在预览实现') },
  highlight: { elements: ['text'], ...PPTX('文字高亮底色未在预览实现') },
  subscript: { elements: ['text'], ...PPTX('上下标未在预览实现') },
  superscript: { elements: ['text'], ...PPTX('上下标未在预览实现') },
  paraSpaceBefore: { elements: ['text'], ...PPTX('段前距未在预览实现') },
  paraSpaceAfter: { elements: ['text'], ...PPTX('段后距未在预览实现') },
  hyperlink: { elements: ['*'], ...PPTX('预览是位图式画布，不提供可点击链接', 'behavior') },
  altText: { elements: ['*'], ...PPTX('仅写入 PPTX 无障碍信息', 'metadata') },
  objectName: { elements: ['*'], ...PPTX('仅写入 PPTX 选择窗格名称', 'metadata') },

  /* ---- 形状库参数 ---- */
  // PptxGenJS 的 ShapeProps 只有 angleRange / rectRadius / arcThicknessRatio / points，
  // 没有通用调整值入口，因此 adjust 只影响预览；不改 adjust 时用的就是 OOXML 默认值。
  adjust: {
    elements: ['shape-preset', 'shape-star', 'shape-ellipse', 'shape-polygon', 'shape-wedge', 'shape-arc', 'shape-ring'],
    ...PREVIEW('PptxGenJS 无通用调整值参数，PPTX 使用 preset 默认几何；未显式设置 adjust 时两端一致'),
  },
  angleRange: { elements: ['shape-preset', 'shape-wedge', 'shape-arc'], ...BOTH },
  arcThicknessRatio: { elements: ['shape-preset'], ...BOTH },
  sides: { elements: ['shape-polygon'], ...BOTH },
  points: { elements: ['shape-star'], ...BOTH },
  shape: { elements: ['shape-preset'], ...BOTH },

  /* ---- 几何与外观（两端一致的基线） ---- */
  rotation: { elements: ['*'], ...BOTH },
  rotate: { elements: ['*'], ...BOTH },
  opacity: { elements: ['*'], ...BOTH },
  flipH: { elements: ['shape-preset', 'shape-star', 'shape-ellipse', 'shape-polygon', 'image', 'text'], ...BOTH },
  flipV: { elements: ['shape-preset', 'shape-star', 'shape-ellipse', 'shape-polygon', 'image', 'text'], ...BOTH },
  shadow: { elements: ['*'], ...BOTH },
  shadowColor: { elements: ['*'], ...BOTH },
  shadowBlur: { elements: ['*'], ...BOTH },
  shadowOffset: { elements: ['*'], ...BOTH },

  /* ---- 填充与描边 ---- */
  fill: { elements: ['*'], ...BOTH },
  stroke: { elements: ['*'], ...BOTH },
  strokeWidth: { elements: ['*'], ...BOTH },
  lineCap: { elements: ['shape-preset', 'shape-path', 'curve-quadratic', 'shape-line'], ...PREVIEW('PPTX 线端帽由形状默认值决定，未映射') },
  lineJoin: { elements: ['shape-preset', 'shape-path', 'curve-quadratic', 'shape-line'], ...PREVIEW('PPTX 线连接由形状默认值决定，未映射') },
  dashType: { elements: ['shape-preset', 'shape-path', 'curve-quadratic', 'shape-line', 'shape-arrow', 'shape-rect'], ...BOTH },
  dash: { elements: ['shape-preset', 'shape-path', 'curve-quadratic', 'shape-line', 'shape-arrow'], ...BOTH },
  lineBeginArrowType: {
    elements: ['shape-line', 'shape-arrow', 'curve-quadratic'],
    values: { none: PARITY.BOTH, arrow: PARITY.BOTH, triangle: PARITY.BOTH, stealth: PARITY.APPROXIMATE, diamond: PARITY.APPROXIMATE, oval: PARITY.APPROXIMATE },
    note: 'stealth/diamond/oval 头部造型为等价近似（PowerPoint 各有默认尺寸比例）',
    impact: 'visual',
  },
  lineEndArrowType: {
    elements: ['shape-line', 'shape-arrow', 'curve-quadratic'],
    values: { none: PARITY.BOTH, arrow: PARITY.BOTH, triangle: PARITY.BOTH, stealth: PARITY.APPROXIMATE, diamond: PARITY.APPROXIMATE, oval: PARITY.APPROXIMATE },
    note: 'stealth/diamond/oval 头部造型为等价近似（PowerPoint 各有默认尺寸比例）',
    impact: 'visual',
  },

  /* ---- 图片 ---- */
  sizing: { elements: ['image'], ...BOTH },
  rounding: { elements: ['image'], ...PPTX('PPTX 的 rounding 是椭圆裁切，预览按直角图片绘制') },
  cornerRadius: {
    elements: ['image'],
    ...PREVIEW('PPTX 不支持普通图片圆角：请先把圆角栅格化到图片本身'),
  },
  transparency: { elements: ['image'], ...BOTH },
  prompt: { elements: ['image'], ...PPTX('生图提示词本身不出现在 PPTX 中', 'metadata') },

  /* ---- 图表与表格 ---- */
  chartColors: { elements: ['chart'], ...BOTH },
  showLegend: { elements: ['chart'], ...BOTH },
  showValue: { elements: ['chart'], ...BOTH },
  showTitle: { elements: ['chart'], ...BOTH },
  chartTitle: { elements: ['chart'], ...BOTH },
  chartType: { elements: ['chart'], ...BOTH },
  header: { elements: ['table'], ...BOTH },
  stripeColor: { elements: ['table'], ...BOTH },
  borderColor: { elements: ['table'], ...PREVIEW('PPTX 表格边框取原生默认值，未映射 borderColor') },
  rows: { elements: ['table'], ...BOTH },

  /* ---- 图表选项（键名与 PptxGenJS IChartOpts 同名，白名单见 core/chart-options.mjs） ---- */
  valAxisHidden: { elements: ['chart'], ...BOTH },
  valAxisMinVal: { elements: ['chart'], ...BOTH },
  valAxisMaxVal: { elements: ['chart'], ...BOTH },
  valAxisMajorUnit: { elements: ['chart'], ...BOTH },
  valAxisLabelFontSize: { elements: ['chart'], ...BOTH },
  valAxisLabelColor: { elements: ['chart'], ...BOTH },
  valAxisLabelFormatCode: { elements: ['chart'], ...APPROX('数字格式只支持常见写法（General/定点/百分比/千分位），其余代码两端可能不一致') },
  valAxisTitle: { elements: ['chart'], ...BOTH },
  showValAxisTitle: { elements: ['chart'], ...BOTH },
  valAxisTitleFontSize: { elements: ['chart'], ...BOTH },
  catAxisHidden: { elements: ['chart'], ...BOTH },
  catAxisLabelRotate: { elements: ['chart'], ...APPROX('旋转锚点略有差异') },
  catAxisLabelFontSize: { elements: ['chart'], ...BOTH },
  catAxisLabelColor: { elements: ['chart'], ...BOTH },
  catAxisTitle: { elements: ['chart'], ...BOTH },
  showCatAxisTitle: { elements: ['chart'], ...BOTH },
  catAxisTitleFontSize: { elements: ['chart'], ...BOTH },
  valGridLine: { elements: ['chart'], ...BOTH },
  catGridLine: { elements: ['chart'], ...BOTH },
  valAxisLineShow: { elements: ['chart'], ...BOTH },
  valAxisLineColor: { elements: ['chart'], ...BOTH },
  valAxisLineSize: { elements: ['chart'], ...BOTH },
  catAxisLineShow: { elements: ['chart'], ...BOTH },
  catAxisLineColor: { elements: ['chart'], ...BOTH },
  catAxisLineSize: { elements: ['chart'], ...BOTH },
  legendPos: { elements: ['chart'], ...BOTH },
  legendFontSize: { elements: ['chart'], ...BOTH },
  legendColor: { elements: ['chart'], ...BOTH },
  titleFontSize: { elements: ['chart'], ...BOTH },
  titleColor: { elements: ['chart'], ...BOTH },
  titleAlign: { elements: ['chart'], ...BOTH },
  titleBold: { elements: ['chart'], ...BOTH },
  showSerName: { elements: ['chart'], ...BOTH },
  showCatName: { elements: ['chart'], ...BOTH },
  showPercent: { elements: ['chart'], ...BOTH },
  dataLabelPosition: { elements: ['chart'], ...APPROX('标签位置为等价布局；原生图表的避让与偏移由 PowerPoint 计算') },
  dataLabelFontSize: { elements: ['chart'], ...BOTH },
  dataLabelColor: { elements: ['chart'], ...BOTH },
  dataLabelFontBold: { elements: ['chart'], ...BOTH },
  dataLabelFormatCode: { elements: ['chart'], ...APPROX('同 valAxisLabelFormatCode：仅支持常见数字格式代码') },
  barDir: { elements: ['chart'], ...BOTH },
  barGrouping: { elements: ['chart'], ...BOTH },
  barGapWidthPct: { elements: ['chart'], ...BOTH },
  lineSize: { elements: ['chart'], ...BOTH },
  lineSmooth: { elements: ['chart'], ...APPROX('预览用样条张力近似，控制点与 PowerPoint 不同') },
  lineDataSymbol: { elements: ['chart'], ...APPROX('符号造型为等价近似（PowerPoint 各标记有默认尺寸）') },
  lineDataSymbolSize: { elements: ['chart'], ...BOTH },
  holeSize: { elements: ['chart'], ...BOTH },
  firstSliceAng: { elements: ['chart'], ...BOTH },
};

/** 元素级能力（不是某个字段，而是该元素在两端的一致程度） */
export const ELEMENT_NOTES = {
  'image-svg': {
    parity: PARITY.APPROXIMATE,
    note: 'Node 端导出会栅格化为 PNG（报告标记 rasterized），浏览器端由 pptxgenjs 栅格化',
    impact: 'metadata',
  },
  gradient: {
    parity: PARITY.APPROXIMATE,
    note: '渐变填充导出 PPTX 时压平为首色（可编辑性优先）；需要真渐变请用 image-svg 或图片',
    impact: 'visual',
  },
};

function fieldEntry(field, elType) {
  const entry = FIELD_CAPABILITIES[field];
  if (!entry) return null;
  // elements 既接受字符串（含 '*'）也接受数组；数组里同样允许 '*'
  const list = Array.isArray(entry.elements) ? entry.elements : [entry.elements];
  if (!list.includes('*') && !list.includes(elType)) return null;
  return entry;
}

/** 单字段的有效 parity（考虑 values 细分） */
export function fieldParity(field, elType, value) {
  const entry = fieldEntry(field, elType);
  if (!entry) return null;
  if (entry.values) {
    const key = String(value);
    return { parity: entry.values[key] ?? PARITY.APPROXIMATE, note: entry.note, impact: entry.impact || 'visual' };
  }
  return { parity: entry.parity, note: entry.note, impact: entry.impact || 'visual' };
}

/**
 * 收集一个（已编译的 primitive）元素的能力告警。
 * @returns {Array<{code:string, field?:string, parity:string, message:string}>}
 */
export function capabilityIssues(elop) {
  const out = [];
  const elType = elop.elType;

  for (const field of Object.keys(FIELD_CAPABILITIES)) {
    if (elop[field] == null) continue;
    const eff = fieldParity(field, elType, elop[field]);
    if (!eff || eff.parity === PARITY.BOTH) continue;
    if (eff.impact === 'metadata') continue; // 不影响观感，不制造噪声
    const label = eff.parity === PARITY.APPROXIMATE ? '两端外观存在已知差异'
      : eff.parity === PARITY.PPTX_ONLY ? '仅 PPTX 生效' : '仅网页预览生效';
    out.push({
      code: `CAPABILITY_${eff.parity.toUpperCase().replace('-', '_')}`,
      field,
      parity: eff.parity,
      message: `${field}：${label}${eff.note ? `；${eff.note}` : ''}`,
    });
  }

  // 形状库的可信度
  if (isShapeElement(elType)) {
    const built = buildShape(elop);
    if (!built) {
      out.push({
        code: 'SHAPE_UNSUPPORTED',
        field: 'shape',
        parity: 'error',
        message: `未知或不支持的形状 "${resolveShape(elop) ?? elop.shape ?? ''}"；可选形状见 references/shape-library.md`,
      });
    } else if (built.exact === 'aspect') {
      const ratio = Math.min(elop.width, elop.height) / Math.max(elop.width, elop.height);
      if (ratio < 0.85) {
        out.push({
          code: 'SHAPE_ASPECT_SENSITIVE',
          field: 'shape',
          parity: PARITY.APPROXIMATE,
          message: `${built.shape} 的顶点落在内切椭圆上：非等比包围盒（${Math.round(elop.width)}×${Math.round(elop.height)}）下 PowerPoint 会施加额外轴向缩放，与预览存在差异；建议使用接近正方形的包围盒`,
        });
      }
    } else if (built.exact === 'approximate') {
      out.push({
        code: 'SHAPE_APPROXIMATE',
        field: 'shape',
        parity: PARITY.APPROXIMATE,
        message: `${built.shape} 的预览几何是等价构造（曲线控制点/内部细节与 PowerPoint 原始公式不同），外形可能有可见差异`,
      });
    }
  }

  // 渐变压平
  const fill = elop.fill;
  if (fill && typeof fill === 'object' && fill.type === 'gradient' && Array.isArray(fill.stops) && fill.stops.length > 1) {
    out.push({
      code: 'GRADIENT_FLATTENED',
      field: 'fill',
      parity: PARITY.APPROXIMATE,
      message: `渐变填充导出 PPTX 时压平为首色（${fill.stops[0]?.color}）；需要真渐变请改用 image-svg 或图片`,
    });
  }

  return out;
}

/** 供测试与文档使用的一致性矩阵 */
export function capabilityMatrix() {
  return Object.entries(FIELD_CAPABILITIES).map(([field, entry]) => ({
    field,
    elements: entry.elements,
    parity: entry.parity ?? (entry.values ? PARITY.APPROXIMATE : PARITY.BOTH),
    values: entry.values,
    impact: entry.impact || 'visual',
    note: entry.note,
  }));
}

/** 统计：两端一致的字段占比，便于测试守住"不要悄悄扩大单向能力" */
export function capabilityStats() {
  const all = capabilityMatrix();
  const both = all.filter(e => e.parity === PARITY.BOTH && !e.values).length;
  const oneSided = all.filter(e => e.parity === PARITY.PPTX_ONLY || e.parity === PARITY.PREVIEW_ONLY).length;
  return { total: all.length, both, oneSided, approximate: all.filter(e => e.parity === PARITY.APPROXIMATE).length };
}
