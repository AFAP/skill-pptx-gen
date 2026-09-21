/**
 * 图表选项：白名单 + 校验 + 归一化。
 *
 * 存在的理由与 style-map/shape-geometry 相同：图表选项的"默认值、枚举、两端语义"
 * 必须只有一份定义。这里给出白名单（未登记键一律报错，不静默传给 pptxgenjs），
 * 由 compile-deck 在编译期归一化并写入 `_chart`，两个渲染器读同一份结论。
 *
 * 键名**直接采用 PptxGenJS 的 IChartOpts 名称**（valAxis* / catAxis* / legend* /
 * dataLabel* / bar* / line* …），这样文档可以指着上游 API 说"同名同义"，映射代码几乎为零，
 * 模型也能直接对照 PptxGenJS 文档写。
 *
 * 仅依赖纯数据与算术，可安全打包进浏览器。
 */

/** 字段类型 → 校验与默认值 */
const F = {
  bool: defaultValue => ({ type: 'bool', default: defaultValue }),
  num: (defaultValue, extra = {}) => ({ type: 'num', default: defaultValue, ...extra }),
  str: defaultValue => ({ type: 'str', default: defaultValue }),
  text: defaultValue => ({ type: 'text', default: defaultValue }),
  enum: (values, defaultValue) => ({ type: 'enum', values, default: defaultValue }),
  /** 网格线：{ style, color, size } */
  gridLine: defaultValue => ({ type: 'gridLine', default: defaultValue }),
};

/**
 * 受支持的图表选项。未列出的键会被校验器判为错误——
 * 这比"传下去但 PowerPoint 忽略"或"预览不画"要诚实。
 */
export const CHART_OPTIONS = {
  /* ---- 数值轴 ---- */
  valAxisHidden: F.bool(true),
  valAxisMinVal: F.num(null),
  valAxisMaxVal: F.num(null),
  valAxisMajorUnit: F.num(null, { min: 0 }),
  valAxisLabelFontSize: F.num(7.5, { min: 1 }),
  valAxisLabelColor: F.str(null),
  valAxisLabelFormatCode: F.text('General'),
  valAxisTitle: F.text(''),
  showValAxisTitle: F.bool(false),
  valAxisTitleFontSize: F.num(8, { min: 1 }),

  /* ---- 分类轴 ---- */
  catAxisHidden: F.bool(false),
  catAxisLabelRotate: F.num(0, { min: -90, max: 90 }),
  catAxisLabelFontSize: F.num(7.5, { min: 1 }),
  catAxisLabelColor: F.str(null),
  catAxisTitle: F.text(''),
  showCatAxisTitle: F.bool(false),
  catAxisTitleFontSize: F.num(8, { min: 1 }),

  /* ---- 网格线与轴线 ---- */
  valGridLine: F.gridLine({ style: 'none', color: null, size: 1 }),
  catGridLine: F.gridLine({ style: 'none', color: null, size: 1 }),
  valAxisLineShow: F.bool(false),
  valAxisLineColor: F.str(null),
  valAxisLineSize: F.num(1, { min: 0 }),
  catAxisLineShow: F.bool(true),
  catAxisLineColor: F.str('CBD5E1'),
  catAxisLineSize: F.num(0.75, { min: 0 }),

  /* ---- 图例 ---- */
  legendPos: F.enum(['t', 'b', 'l', 'r', 'tr'], 't'),
  legendFontSize: F.num(8.25, { min: 1 }),
  legendColor: F.str(null),

  /* ---- 图表标题（showTitle / chartTitle 沿用原有扁平字段） ---- */
  titleFontSize: F.num(10.5, { min: 1 }),
  titleColor: F.str(null),
  titleAlign: F.enum(['left', 'center', 'right'], 'center'),
  titleBold: F.bool(false),

  /* ---- 数据标签 ---- */
  showSerName: F.bool(false),
  showCatName: F.bool(false),
  showPercent: F.bool(false),
  dataLabelPosition: F.enum(['ctr', 'inEnd', 'outEnd', 't', 'b', 'l', 'r', 'bestFit'], null),
  dataLabelFontSize: F.num(6.75, { min: 1 }),
  dataLabelColor: F.str(null),
  dataLabelFontBold: F.bool(false),
  dataLabelFormatCode: F.text('General'),

  /* ---- 柱/条 ---- */
  barDir: F.enum(['col', 'bar'], 'col'),
  barGrouping: F.enum(['clustered', 'stacked', 'percentStacked'], 'clustered'),
  barGapWidthPct: F.num(150, { min: 0, max: 500 }),

  /* ---- 折线 ---- */
  lineSize: F.num(1.5, { min: 0 }),
  lineSmooth: F.bool(false),
  lineDataSymbol: F.enum(['circle', 'dash', 'diamond', 'dot', 'none', 'square', 'triangle'], 'circle'),
  lineDataSymbolSize: F.num(5, { min: 0 }),

  /* ---- 饼/环 ---- */
  holeSize: F.num(55, { min: 1, max: 90 }),
  firstSliceAng: F.num(0, { min: 0, max: 360 }),
};

export const CHART_OPTION_KEYS = Object.keys(CHART_OPTIONS);

/** 数据标签/坐标轴数字格式：只支持常见写法，其余按原值输出并告警 */
const SUPPORTED_FORMAT_CODES = new Set(['General', 'general', '0', '0.0', '0.00', '0.000', '#,##0', '0%', '0.0%', '0.00%', '#%']);

export function isSupportedFormatCode(code) {
  return code == null || SUPPORTED_FORMAT_CODES.has(String(code));
}

/** Excel 风格数字格式化（子集）：General / 定点 / 百分比 / 千分位 */
export function formatNumber(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const c = String(code || 'General');
  if (c === 'General' || c === 'general') {
    if (Number.isInteger(n)) return String(n);
    return String(Number(n.toFixed(6)));
  }
  const percent = c.includes('%');
  const thousands = c.includes(',');
  const digits = (c.match(/\.(0+)/) || [, ''])[1].length;
  const scaled = percent ? n * 100 : n;
  let out = scaled.toFixed(digits);
  if (thousands) {
    const [int, frac] = out.split('.');
    out = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
  }
  return percent ? out + '%' : out;
}

function coerceNumber(value, spec) {
  const n = Number(value);
  if (!Number.isFinite(n)) return spec.default;
  if (spec.min != null && n < spec.min) return spec.min;
  if (spec.max != null && n > spec.max) return spec.max;
  return n;
}

function coerceGridLine(value, fallback) {
  if (value == null) return { ...fallback };
  if (typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  const style = ['solid', 'dash', 'dot', 'none'].includes(value.style) ? value.style : fallback.style;
  return {
    style,
    color: typeof value.color === 'string' ? value.color : fallback.color,
    size: Number.isFinite(Number(value.size)) ? Number(value.size) : fallback.size,
  };
}

/**
 * 把元素上的图表选项归一化为完整对象（缺省值已填好）。
 * 纯函数：同样的输入必得同样的输出，因此两端可各自调用而不会漂移。
 */
export function normalizeChartOptions(elop) {
  const out = {};
  for (const [key, spec] of Object.entries(CHART_OPTIONS)) {
    const raw = elop?.[key];
    if (raw == null) {
      out[key] = spec.type === 'gridLine' ? { ...spec.default } : spec.default;
      continue;
    }
    switch (spec.type) {
      case 'bool': out[key] = raw === true || raw === 'true'; break;
      case 'num': out[key] = coerceNumber(raw, spec); break;
      case 'str': out[key] = typeof raw === 'string' ? raw : spec.default; break;
      case 'text': out[key] = String(raw); break;
      case 'enum': out[key] = spec.values.includes(raw) ? raw : spec.default; break;
      case 'gridLine': out[key] = coerceGridLine(raw, spec.default); break;
      default: out[key] = spec.default;
    }
  }
  return out;
}

/** 元素上是否出现了未登记的图表选项键（校验器据此报错） */
export function unknownChartOptionKeys(elop) {
  return Object.keys(elop || {}).filter(key => {
    if (CHART_OPTION_KEYS.includes(key)) return false;
    // 仅拦截"看起来像图表选项"的键，避免把通用字段误判
    return /^(val|cat|legend|dataLabel|title|bar|line|hole|first).*/.test(key)
      && !['title', 'lineHeight', 'lineColor', 'lineWidth', 'lineCap', 'lineJoin'].includes(key);
  });
}
