/**
 * 两端一致性测试：把"网页预览与 PPTX 一致"这一产品承诺变成可执行的断言。
 *
 * 分三层：
 *  1. 选项映射层（快）：DSL 字段 → PptxGenJS 选项，验证单向字段已被打通；
 *  2. 能力注册表层：core/capabilities.mjs 必须对已知单向字段给出告警，且不得误报一致字段；
 *  3. OOXML 层（真值）：实际生成 PPTX 并解压，断言 preset 名、adj 调整值、srcRect 裁切、
 *     strike、wrap、对象名与虚线/箭头都真正写进了原生文件——这是"原生文件正确"的唯一证据。
 * 用法：node tests/parity.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { applyElement, resolveTheme, imageSizing, chartModel } from '../core/dsl-to-pptx.mjs';
import { buildPresentation, sanitizePptxBuffer } from '../core/ppt-core.mjs';
import { validateDeck } from '../core/dsl-validate.mjs';
import { capabilityIssues, fieldParity, capabilityStats, PARITY, FIELD_CAPABILITIES } from '../core/capabilities.mjs';
import { buildShape } from '../core/shape-geometry.mjs';
import { resolveDash } from '../core/style-map.mjs';
import { CHART_OPTION_KEYS, normalizeChartOptions, formatNumber, isSupportedFormatCode } from '../core/chart-options.mjs';

const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');
const theme = resolveTheme('navy-report');

/* ============ 1. 选项映射层：单向字段必须已经被打通 ============ */
const captured = [];
const mockPptx = {
  shapes: { CUSTOM_GEOMETRY: 'custom' },
  ShapeType: { rect: 'rect', ellipse: 'ellipse', line: 'line' },
  ChartType: { bar: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut', area: 'area', radar: 'radar', scatter: 'scatter' },
};
const mockSlide = {
  addShape: (type, opt) => captured.push({ type, opt }),
  addText: (text, opt) => captured.push({ type: 'text', text, opt }),
  addImage: opt => captured.push({ type: 'image', opt }),
  addChart: (type, data, opt) => captured.push({ type: 'chart', data, opt }),
};
const grab = elop => { captured.length = 0; applyElement(mockPptx, mockSlide, elop, theme); return captured; };

// 删除线：过去只在预览实现，现在必须写进 PPTX
const struck = grab({ elType: 'text', text: 'x', x: 0, y: 0, width: 100, height: 30, strike: true });
assert.equal(struck[0].opt.strike, true, 'strike 必须映射到 PPT 原生删除线');
assert.equal(grab({ elType: 'text', text: 'x', x: 0, y: 0, width: 100, height: 30, strike: 'dblStrike' })[0].opt.strike, 'dblStrike');
assert.equal(grab({ elType: 'text', text: 'x', x: 0, y: 0, width: 100, height: 30, strikethrough: true })[0].opt.strike, true, 'strikethrough 别名等价');

// 不换行：两端由 style-map 统一派生
assert.equal(grab({ elType: 'text', text: 'x', x: 0, y: 0, width: 100, height: 30, wrap: false })[0].opt.wrap, false);
assert.equal(grab({ elType: 'text', text: 'x', y: 0, x: 0, width: 100, height: 30 })[0].opt.wrap, undefined, '默认不写 wrap');

// 文本框底色圆角：映射为 roundRect，且 rectRadius 单位是英寸（pptxgenjs 按英寸换算 adj）
const boxed = grab({ elType: 'text', text: 'x', x: 0, y: 0, width: 260, height: 60, bgFill: '#EAEFF3', bgRadius: 16 })[0].opt;
assert.equal(boxed.shape, 'roundRect');
// pxToInch 保留 4 位小数，故按 1e-3 容差比较英寸值
const inch = px => px * 13.333 / 1280;
assert.ok(Math.abs(boxed.rectRadius - inch(16)) < 1e-3, `rectRadius 应为英寸: ${boxed.rectRadius}`);

// 形状库：preset 名 + 角度/厚度
const wedge = grab({ elType: 'shape-preset', shape: 'pie', x: 0, y: 0, width: 100, height: 100, angleRange: [30, 200], fill: '#000000' })[0];
assert.equal(wedge.type, 'pie');
assert.deepEqual(wedge.opt.angleRange, [30, 200]);
const blk = grab({ elType: 'shape-preset', shape: 'blockArc', x: 0, y: 0, width: 100, height: 100, arcThicknessRatio: 0.4, fill: '#000000' })[0];
assert.equal(blk.opt.arcThicknessRatio, 0.4);
// 弧段起止角是 [0,360] 内的绝对角度，扫角取有符号差；越界必须报错而不是被静默钳制
const neg = grab({ elType: 'shape-preset', shape: 'pie', x: 0, y: 0, width: 100, height: 100, angleRange: [270, 0], fill: '#000000' })[0];
assert.deepEqual(neg.opt.angleRange, [270, 0], 'arc 的 OOXML 默认 -270° 扫角必须原样保留');
assert.equal(grab({ elType: 'shape-preset', shape: 'pie', x: 0, y: 0, width: 100, height: 100, angleRange: [180, 360], fill: '#000000' })[0].opt.angleRange[1], 360, '360 不得折成 0');
// 无 preset 对应的边数走 customGeometry，两端共用顶点列
const hept = grab({ elType: 'shape-polygon', sides: 7, x: 0, y: 0, width: 100, height: 100, fill: '#000000' })[0];
assert.equal(hept.type, 'custom');
assert.equal(hept.opt.points.at(-1).close, true);
assert.equal(hept.opt.points.length, 8, '7 边形应有 7 个顶点 + close');

// 未知形状/未知箭头类型必须报错，不静默退化
assert.throws(() => grab({ elType: 'shape-preset', shape: 'nope', x: 0, y: 0, width: 10, height: 10 }), /未知或不支持的形状/);
assert.throws(() => grab({ elType: 'shape-line', pointArr: [{ x: 0, y: 0 }, { x: 10, y: 0 }], lineEndArrowType: 'laser' }), /未知 lineEndArrowType/);

// 虚线族：命名值统一解析，两端不各写一份
assert.equal(resolveDash('dashDot').pptx, 'dashDot');
assert.equal(resolveDash('longDash').pptx, 'lgDash', '别名归一到 PptxGenJS 命名');
assert.deepEqual(resolveDash('dashDot').konva, [8, 4, 2, 4]);
assert.equal(resolveDash('not-a-dash').pptx, null);
assert.equal(grab({ elType: 'shape-line', pointArr: [{ x: 0, y: 0 }, { x: 10, y: 0 }], dashType: 'sysDot' })[0].opt.line.dashType, 'sysDot');
assert.equal(grab({ elType: 'shape-line', pointArr: [{ x: 0, y: 0 }, { x: 10, y: 0 }], lineBeginArrowType: 'oval', lineEndArrowType: 'stealth' })[0].opt.line.beginArrowType, 'oval');
assert.equal(grab({ elType: 'shape-line', pointArr: [{ x: 0, y: 0 }, { x: 10, y: 0 }], lineBeginArrowType: 'none' })[0].opt.line.beginArrowType, undefined, 'none 不应写入');

// 对象名：默认取元素 id，便于在 PowerPoint 选择窗格定位
assert.equal(grab({ elType: 'shape-rect', id: 'panel', x: 0, y: 0, width: 10, height: 10 })[0].opt.objectName, 'panel');
assert.equal(grab({ elType: 'shape-rect', id: 'panel', objectName: '自定义名', x: 0, y: 0, width: 10, height: 10 })[0].opt.objectName, '自定义名');

// 图片裁切：0–1 比例（pptxgenjs 在 Node 下以图片框为参照换算 srcRect）
assert.equal(imageSizing({ type: 'crop' }), 'crop');
assert.equal(imageSizing('crop'), 'crop');
const crop = grab({ elType: 'image', data: 'data:image/png;base64,AA==', x: 0, y: 0, width: 200, height: 160, sizing: { type: 'crop', x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })[0].opt;
assert.equal(crop.sizing.type, 'crop');
assert.ok(Math.abs(crop.sizing.x - inch(200 * 0.25)) < 1e-3);
assert.ok(Math.abs(crop.sizing.w - inch(200 * 0.5)) < 1e-3);
assert.throws(() => grab({ elType: 'image', data: 'data:image/png;base64,AA==', x: 0, y: 0, width: 10, height: 10, sizing: { type: 'crop' } }), /需要 width\/height/);

/* ============ 2. 能力注册表：单向字段必须被告警，一致字段不得误报 ============ */
assert.equal(fieldParity('strike', 'text', true).parity, PARITY.BOTH, 'strike 已打通，应为两端一致');
assert.equal(fieldParity('wrap', 'text', false).parity, PARITY.BOTH);
assert.equal(fieldParity('bgRadius', 'text', 8).parity, PARITY.BOTH);
assert.equal(fieldParity('ellipsis', 'text', true).parity, PARITY.PREVIEW_ONLY);
assert.equal(fieldParity('adjust', 'shape-preset', 25000).parity, PARITY.PREVIEW_ONLY);
assert.equal(fieldParity('lineEndArrowType', 'shape-line', 'triangle').parity, PARITY.BOTH);
assert.equal(fieldParity('lineEndArrowType', 'shape-line', 'stealth').parity, PARITY.APPROXIMATE);
// 元数据类单向能力不产生告警（否则每页都要刷屏），但必须能被正确解析
for (const field of ['altText', 'objectName']) {
  assert.equal(fieldParity(field, 'image', 'x').parity, PARITY.PPTX_ONLY, `${field} 应解析为 pptx-only`);
}
assert.deepEqual(capabilityIssues({ elType: 'text', altText: 'x', objectName: 'y' }), []);
assert.equal(fieldParity('hyperlink', 'shape-rect', { url: 'x' }).parity, PARITY.PPTX_ONLY);
assert.ok(capabilityIssues({ elType: 'text', ellipsis: true }).some(i => i.code === 'CAPABILITY_PREVIEW_ONLY'));
assert.ok(capabilityIssues({ elType: 'text', hyperlink: { url: 'https://x' } }).some(i => i.code === 'CAPABILITY_PPTX_ONLY'));
assert.ok(capabilityIssues({ elType: 'shape-preset', shape: 'cloud', width: 10, height: 10 }).some(i => i.code === 'SHAPE_UNSUPPORTED'));
// 非等比包围盒下的星形告警（PowerPoint 有额外轴向缩放）
const starWide = capabilityIssues({ elType: 'shape-preset', shape: 'star5', width: 300, height: 100 });
assert.ok(starWide.some(i => i.code === 'SHAPE_ASPECT_SENSITIVE'), '非等比星形应告警');
assert.ok(!capabilityIssues({ elType: 'shape-preset', shape: 'star5', width: 120, height: 120 }).some(i => i.code === 'SHAPE_ASPECT_SENSITIVE'));
// 近似形状必须告警
assert.ok(capabilityIssues({ elType: 'shape-preset', shape: 'wedgeRectCallout', width: 100, height: 80 }).some(i => i.code === 'SHAPE_APPROXIMATE'));
// 两端一致的形状不得产生任何告警
assert.deepEqual(capabilityIssues({ elType: 'shape-preset', shape: 'hexagon', width: 180, height: 100 }), []);

const stats = capabilityStats();
assert.ok(stats.both >= 35, `两端一致字段偏少：${stats.both}`);
assert.ok(stats.oneSided <= 26, `单向字段过多，说明一致性在退化：${stats.oneSided}`);

/* ============ 3. 校验器：新能力必须可诊断 ============ */
const bad = validateDeck({ slides: [{ elements: [
  { elType: 'shape-preset', x: 0, y: 0, width: 100, height: 100 },
  { elType: 'shape-preset', shape: 'not-real', x: 0, y: 0, width: 100, height: 100 },
  { elType: 'shape-star', points: 9, x: 0, y: 0, width: 100, height: 100 },
  { elType: 'shape-line', pointArr: [{ x: 0, y: 0 }, { x: 10, y: 0 }], lineEndArrowType: 'laser' },
  { elType: 'image', data: 'data:image/png;base64,AA==', x: 0, y: 0, width: 50, height: 50, sizing: { type: 'crop', x: 0.8, y: 0, width: 0.5, height: 0.5 } },
] }] });
assert.ok(bad.errors.some(e => e.includes('shape-preset 缺少 shape')));
assert.ok(bad.errors.some(e => e.includes('未知形状')));
assert.ok(bad.errors.some(e => e.includes('仅支持 4/5/6/7/8/10/12/16/24/32 角')));
assert.ok(bad.errors.some(e => e.includes('lineEndArrowType')));
assert.ok(bad.errors.some(e => e.includes('x+width')), bad.errors.join('; '));
const badAngle = validateDeck({ slides: [{ elements: [
  { elType: 'shape-preset', shape: 'pie', x: 0, y: 0, width: 50, height: 50, angleRange: [-90, 45] },
] }] });
assert.ok(badAngle.errors.some(e => e.includes('必须在 0–360 之间')), badAngle.errors.join('; '));

// 单向字段在真实校准流程里必须产生告警（P0 之前它们是静默的）
const warnDeck = validateDeck({ slides: [{ elements: [
  { elType: 'text', text: 'a', x: 0, y: 0, width: 200, height: 40, fontSize: 18, ellipsis: true },
  { elType: 'shape-preset', shape: 'bentArrow', x: 0, y: 100, width: 200, height: 80, fill: '#EEEEEE' },
] }] });
assert.ok(warnDeck.warnings.some(w => w.includes('ellipsis')), warnDeck.warnings.join('; '));
assert.ok(warnDeck.warnings.some(w => w.includes('bentArrow')), warnDeck.warnings.join('; '));
assert.deepEqual(validateDeck({ slides: [{ elements: [{ elType: 'shape-preset', shape: 'hexagon', x: 0, y: 0, width: 100, height: 100, fill: '#EEEEEE' }] }] }).warnings, []);

/* ============ 4. OOXML 层：原生文件的真值断言 ============ */
const CRC = zlib.crc32;
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
/** 生成已知尺寸的 PNG，用于验证 crop 的 srcRect 百分比 */
function makePng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    for (let x = 0; x < w; x++) { raw[off + 1 + x * 3] = 40; raw[off + 2 + x * 3] = 90; raw[off + 3 + x * 3] = 160; }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ooxmlDeck = {
  meta: { title: 'P0 parity' },
  slides: [{ elements: [
    { elType: 'shape-preset', id: 'star', shape: 'star5', x: 40, y: 40, width: 160, height: 160, fill: '#F26322' },
    { elType: 'shape-preset', id: 'hex', shape: 'hexagon', x: 220, y: 40, width: 180, height: 100, fill: '#09192C' },
    { elType: 'shape-polygon', id: 'hept', sides: 7, x: 420, y: 40, width: 140, height: 140, fill: '#3B6F91' },
    { elType: 'shape-star', id: 'st6', points: 6, x: 580, y: 40, width: 120, height: 120, fill: '#8CA6B8' },
    { elType: 'shape-preset', id: 'blk', shape: 'blockArc', x: 720, y: 40, width: 160, height: 160, fill: '#F26322', angleRange: [180, 360], arcThicknessRatio: 0.4 },
    { elType: 'shape-preset', id: 'pie', shape: 'pie', x: 900, y: 40, width: 140, height: 140, fill: '#C7D1D9', angleRange: [30, 200] },
    { elType: 'shape-line', id: 'conn', pointArr: [{ x: 40, y: 260 }, { x: 400, y: 260 }], lineColor: '#09192C', lineWidth: 3,
      dashType: 'dashDot', lineBeginArrowType: 'oval', lineEndArrowType: 'diamond' },
    { elType: 'text', id: 'struck', text: '删除线', x: 40, y: 300, width: 240, height: 40, fontSize: 20, fill: '#09192C', strike: true },
    { elType: 'text', id: 'boxed', text: '圆角底色', x: 300, y: 300, width: 260, height: 60, fontSize: 18, fill: '#09192C', bgFill: '#EAEFF3', bgRadius: 16 },
    { elType: 'text', id: 'nowrap', text: '不换行文本', x: 600, y: 300, width: 200, height: 40, fontSize: 18, fill: '#09192C', wrap: false },
    { elType: 'image', id: 'cropped', data: 'data:image/png;base64,' + makePng(100, 80).toString('base64'),
      x: 40, y: 380, width: 200, height: 160, sizing: { type: 'crop', x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
  ] }],
};

const built = await buildPresentation(PptxGenJS, ooxmlDeck, { strict: true, prefetch: false });
assert.equal(built.report.summary.failed, 0);
assert.equal(built.report.summary.skipped, 0);
let buffer = await built.pptx.write({ outputType: 'nodebuffer' });
buffer = await sanitizePptxBuffer(buffer, { warn() {} });
const xml = await (await JSZip.loadAsync(buffer)).file('ppt/slides/slide1.xml').async('string');

const expect = (needle, label = needle) => assert.ok(xml.includes(needle), `OOXML 缺少 ${label}`);
expect('prst="star5"');
expect('prst="hexagon"');
expect('prst="star6"', 'shape-star points:6 → star6');
expect('prst="pie"');
expect('prst="roundRect"', 'bgRadius → roundRect');
expect('<a:custGeom>', '7 边形 → customGeometry');
expect('strike="sngStrike"', '删除线');
expect('wrap="none"', '不换行');

// 对象名写入选择窗格
for (const name of ['star', 'hex', 'hept', 'st6', 'blk', 'pie', 'conn', 'struck', 'boxed', 'nowrap', 'cropped']) {
  expect(`name="${name}"`, `对象名 ${name}`);
}

// 角度与厚度：pptxgenjs 按 度×60000 / 比例×50000 写入 adj
expect('<a:gd name="adj1" fmla="val 10800000" />', 'blockArc 起始角 180°');
expect('<a:gd name="adj2" fmla="val 21600000" />', 'blockArc 结束角 360°');
expect('<a:gd name="adj3" fmla="val 20000" />', 'blockArc 厚度 0.4');
expect('<a:gd name="adj1" fmla="val 1800000" />', 'pie 起始角 30°');
expect('<a:gd name="adj2" fmla="val 12000000" />', 'pie 结束角 200°');

// 虚线与两端箭头头部
expect('<a:prstDash val="dashDot"/>', 'dashDot');
expect('<a:headEnd type="oval"/>', '起点 oval 箭头');
expect('<a:tailEnd type="diamond"/>', '终点 diamond 箭头');

// 裁切：0.25/0.25/0.5/0.5 → l=r=t=b≈25000（英寸换算带来 ±5 的舍入）
const srcRect = xml.match(/<a:srcRect l="(\d+)" r="(\d+)" t="(\d+)" b="(\d+)"/);
assert.ok(srcRect, 'OOXML 缺少 srcRect（裁切未生效）');
for (const [i, key] of [[1, 'l'], [2, 'r'], [3, 't'], [4, 'b']]) {
  const value = Number(srcRect[i]);
  assert.ok(Math.abs(value - 25000) <= 5, `srcRect ${key}=${value} 应≈25000（比例 0.25）`);
}

/* ============ 5. 图表选项：一致性登记 + 选项映射 + OOXML 真值 ============ */

// 5a. 每个受支持的图表选项都必须在能力表登记，防止新增选项时漏掉一致性声明
for (const key of CHART_OPTION_KEYS) {
  assert.ok(FIELD_CAPABILITIES[key], `图表选项 ${key} 未在 core/capabilities.mjs 登记`);
  assert.deepEqual(FIELD_CAPABILITIES[key].elements, ['chart'], `${key} 的 elements 应为 ['chart']`);
}

// 5b. 归一化：缺省值齐备，非法值回落，枚举不接受未知项
const normalized = normalizeChartOptions({});
assert.equal(Object.keys(normalized).length, CHART_OPTION_KEYS.length, '归一化结果必须覆盖全部选项');
assert.equal(normalized.valAxisHidden, true, '数值轴默认隐藏（保持既有行为）');
assert.equal(normalized.valGridLine.style, 'none', '网格线默认关闭（保持既有行为）');
assert.equal(normalized.legendPos, 't');
assert.equal(normalizeChartOptions({ legendPos: 'nowhere' }).legendPos, 't', '未知枚举回落默认值');
assert.equal(normalizeChartOptions({ holeSize: 999 }).holeSize, 90, '数值越界被钳制');
assert.equal(normalizeChartOptions({ valAxisMaxVal: 6 }).valAxisMaxVal, 6, '显式值不被改写');
assert.equal(normalizeChartOptions({}).valAxisMaxVal, null, '未指定时交给数据域');

// 数字格式：只支持常见写法。百分号沿用 Excel 语义（把数值乘 100），
// 因此 0.37 + '0%' → '37%'，而 37 + '0%' → '3700%'。
assert.equal(formatNumber(6, 'General'), '6');
assert.equal(formatNumber(4.5, 'General'), '4.5');
assert.equal(formatNumber(0.125, '0.0%'), '12.5%');
assert.equal(formatNumber(0.37, '0%'), '37%');
assert.equal(formatNumber(1234.5, '#,##0.0'), '1,234.5');
assert.ok(isSupportedFormatCode('General') && isSupportedFormatCode('0.0%'));
assert.ok(!isSupportedFormatCode('yyyy-mm-dd'), '未知格式代码应被识别为不支持');

// 5c. 选项映射到 IChartOpts
const chartOpt = grab({
  elType: 'chart', chartType: 'bar', x: 0, y: 0, width: 400, height: 300,
  labels: ['A', 'B'], data: [{ name: 'S', values: [1, 2] }],
  valAxisMinVal: 0, valAxisMaxVal: 6, valAxisMajorUnit: 1, valAxisHidden: false,
  valGridLine: { style: 'solid', color: '#EEEEEE', size: 1 },
  catAxisLabelRotate: -30, catAxisHidden: true,
  barDir: 'bar', barGrouping: 'stacked', legendPos: 'b',
})[0].opt;
assert.equal(chartOpt.valAxisMaxVal, 6);
assert.equal(chartOpt.valAxisMinVal, 0);
assert.equal(chartOpt.valAxisMajorUnit, 1);
assert.equal(chartOpt.valAxisHidden, false);
assert.equal(chartOpt.valGridLine.style, 'solid');
assert.equal(chartOpt.valGridLine.color, 'EEEEEE');
assert.equal(chartOpt.catGridLine.style, 'none', '未指定时保持 none（既有行为）');
assert.ok(/^[0-9A-F]{6}$/.test(chartOpt.catGridLine.color), '网格线颜色应回落到主题边框色');
assert.equal(chartOpt.catAxisLabelRotate, -30);
assert.equal(chartOpt.catAxisHidden, true);
assert.equal(chartOpt.barDir, 'bar');
assert.equal(chartOpt.barGrouping, 'stacked');
assert.equal(chartOpt.legendPos, 'b');
// 横向条的分类轴在左侧，标签位置随之改变
assert.equal(chartOpt.catAxisLabelPos, 'nextTo');
assert.equal(grab({ elType: 'chart', chartType: 'bar', x: 0, y: 0, width: 400, height: 300,
  labels: ['A'], data: [{ name: 'S', values: [1] }] })[0].opt.catAxisLabelPos, 'low');
// 环形图的开孔与起始角
const doughnutOpt = grab({ elType: 'chart', chartType: 'doughnut', x: 0, y: 0, width: 300, height: 300,
  labels: ['A', 'B'], data: [{ name: 'S', values: [3, 7] }], holeSize: 70, firstSliceAng: 90 })[0].opt;
assert.equal(doughnutOpt.holeSize, 70);
assert.equal(doughnutOpt.firstSliceAng, 90);

// 5d. 校验器：未知选项键报错、非法枚举报错、未知格式代码告警
const badChartOpt = validateDeck({ slides: [{ elements: [
  { elType: 'chart', chartType: 'bar', x: 0, y: 0, width: 400, height: 300, labels: ['A'], data: [{ name: 'S', values: [1] }],
    valAxisMaxValue: 6, legendPos: 'middle', barDir: 'diagonal' },
] }] });
assert.ok(badChartOpt.errors.some(e => e.includes('valAxisMaxValue')), badChartOpt.errors.join('; '));
assert.ok(badChartOpt.errors.some(e => e.includes('legendPos')), badChartOpt.errors.join('; '));
assert.ok(badChartOpt.errors.some(e => e.includes('barDir')), badChartOpt.errors.join('; '));
const oddFormat = validateDeck({ slides: [{ elements: [
  { elType: 'chart', chartType: 'bar', x: 0, y: 0, width: 400, height: 300, labels: ['A'], data: [{ name: 'S', values: [1] }],
    dataLabelFormatCode: 'yyyy-mm' },
] }] });
assert.equal(oddFormat.ok, true);
assert.ok(oddFormat.warnings.some(w => w.includes('dataLabelFormatCode')), oddFormat.warnings.join('; '));
// 只调整受支持选项时不得产生任何告警
assert.deepEqual(validateDeck({ slides: [{ elements: [
  { elType: 'chart', chartType: 'bar', x: 0, y: 0, width: 400, height: 300, labels: ['A'], data: [{ name: 'S', values: [1] }],
    valAxisMinVal: 0, valAxisMaxVal: 6, valAxisMajorUnit: 1, valAxisHidden: false,
    valGridLine: { style: 'solid', color: '#E5E5E5', size: 1 }, legendPos: 'r', barGrouping: 'stacked' },
] }] }).warnings, []);

// 5e. 堆叠柱的数值域必须按"每类累计"计算。
// 回归背景：曾按单系列最大值定域，堆叠总高（5）超出轴上限（4.32），
// 预览把柱子画到绘图区之外、PPTX 的轴范围也不对。
const stackInput = {
  elType: 'chart', chartType: 'bar', labels: ['A', 'B', 'C'],
  data: [{ name: 'S1', values: [3, 2, 4] }, { name: 'S2', values: [2, 4, 1] }],
};
const stackedModel = chartModel({ ...stackInput, barGrouping: 'stacked' });
assert.ok(stackedModel.yDomain.max >= 5, `堆叠域须覆盖每类累计，实际 ${stackedModel.yDomain.max}`);
assert.equal(stackedModel.stacked, true);
const clusteredModel = chartModel({ ...stackInput, barGrouping: 'clustered' });
assert.ok(clusteredModel.yDomain.max < 5, `非堆叠仍按单系列最大值，实际 ${clusteredModel.yDomain.max}`);
assert.equal(clusteredModel.stacked, false);
const percentModel = chartModel({ ...stackInput, barGrouping: 'percentStacked' });
assert.deepEqual(percentModel.yDomain, { min: 0, max: 100 }, '百分比堆叠的轴按定义固定 0–100');
assert.equal(percentModel.percentStacked, true);

// 5f. OOXML 真值：选项必须真的写进原生图表
const chartDeck = {
  slides: [{ elements: [
    { elType: 'chart', id: 'axis', chartType: 'bar', x: 40, y: 40, width: 560, height: 340,
      labels: ['A', 'B', 'C', 'D'], data: [{ name: 'S1', values: [3, 5, 2, 6] }, { name: 'S2', values: [2, 1, 4, 3] }],
      valAxisMinVal: 0, valAxisMaxVal: 6, valAxisMajorUnit: 1, valAxisHidden: false, catAxisHidden: false,
      valGridLine: { style: 'solid', color: '#E5E5E5', size: 1 }, barGrouping: 'stacked', barDir: 'bar' },
    { elType: 'chart', id: 'ring', chartType: 'doughnut', x: 640, y: 40, width: 300, height: 300,
      labels: ['A', 'B'], data: [{ name: 'S', values: [3, 7] }], holeSize: 70, firstSliceAng: 90, showPercent: true },
    { elType: 'chart', id: 'trend', chartType: 'line', x: 40, y: 420, width: 560, height: 260,
      labels: ['A', 'B', 'C'], data: [{ name: 'S', values: [1, 3, 2] }], lineSmooth: true, lineSize: 2.5, lineDataSymbol: 'diamond' },
  ] }],
};
const chartBuilt = await buildPresentation(PptxGenJS, chartDeck, { strict: true, prefetch: false });
assert.equal(chartBuilt.report.summary.failed, 0);
let chartBuf = await chartBuilt.pptx.write({ outputType: 'nodebuffer' });
chartBuf = await sanitizePptxBuffer(chartBuf, { warn() {} });
const chartZip = await JSZip.loadAsync(chartBuf);
// 原生图表是独立部件（ppt/charts/chartN.xml），slide 里只有 graphicFrame 引用
const chartParts = Object.keys(chartZip.files).filter(f => /^ppt\/charts\/chart\d+\.xml$/.test(f)).sort();
assert.equal(chartParts.length, 3, `应有 3 个图表部件，实际 ${chartParts.length}`);
let chartXml = '';
for (const p of chartParts) chartXml += await chartZip.file(p).async('string');
const expectChart = (needle, label = needle) => assert.ok(chartXml.includes(needle), `图表 OOXML 缺少 ${label}`);
expectChart('<c:max val="6"/>', 'valAxisMaxVal → c:max');
expectChart('<c:min val="0"/>', 'valAxisMinVal → c:min');
expectChart('<c:majorUnit val="1"/>', 'valAxisMajorUnit → c:majorUnit');
expectChart('<c:majorGridlines>', 'valGridLine solid → c:majorGridlines');
expectChart('<c:delete val="0"/>', 'valAxisHidden:false → c:delete val=0');
expectChart('<c:barDir val="bar"/>', 'barDir → c:barDir');
expectChart('<c:grouping val="stacked"/>', 'barGrouping → c:grouping');
expectChart('<c:holeSize val="70"/>', 'holeSize → c:holeSize');
expectChart('<c:firstSliceAng val="90"/>', 'firstSliceAng → c:firstSliceAng');
expectChart('<c:smooth val="1"/>', 'lineSmooth → c:smooth');

console.log(`✅ parity tests passed（能力表 ${stats.total} 项：两端一致 ${stats.both}，近似 ${stats.approximate}，单向 ${stats.oneSided}；图表选项 ${CHART_OPTION_KEYS.length} 项）`);

