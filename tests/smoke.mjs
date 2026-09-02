/**
 * ai-ppt-gen 冒烟测试：覆盖转换核心/宏展开/校验器的高风险回归点。
 * 用法：node tests/smoke.mjs
 */
import assert from 'node:assert/strict';
import { parseColor, resolveTheme, resolveTokens, applyElement } from '../core/dsl-to-pptx.mjs';
import { expandConnectors, pointsToSvgPath } from '../core/connectors.mjs';
import { validateDeck } from '../core/dsl-validate.mjs';

// 1. 颜色解析与主题
assert.deepEqual(parseColor('#0C1B2E'), { color: '0C1B2E', transparency: 0 });
assert.equal(resolveTheme('business').name, 'business');
assert.equal(resolveTheme('business').accent, 'C9A96E');
assert.equal(resolveTokens({ a: { fill: '$1' } }, resolveTheme('navy-brief')).a.fill, '#0C1B2E');

// 2. 多段 shape-arrow 导出必须带 stealth 箭头（回归：customGeometry 丢 tailEnd）
const captured = [];
const mockPptx = { shapes: { CUSTOM_GEOMETRY: 'custom' }, ShapeType: { line: 'line', ellipse: 'ellipse' } };
const mockSlide = { addShape: (type, opt) => captured.push({ type, opt }) };
applyElement(mockPptx, mockSlide, {
  elType: 'shape-arrow', pointArr: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }],
  lineColor: '#3182CE', lineWidth: 4,
}, resolveTheme('navy-brief'));
assert.equal(captured[0].type, 'custom');
assert.equal(captured[0].opt.line.endArrowType, 'stealth');

// 3. shape-circle 只给 width 时 height 回退 width（不再导出 h:0）
captured.length = 0;
applyElement(mockPptx, mockSlide, { elType: 'shape-circle', x: 640, y: 360, width: 80 }, resolveTheme('navy-brief'));
assert.ok(captured[0].opt.h > 0);

// 4. image 直接内嵌 data 不再被导出端丢弃
captured.length = 0;
mockSlide.addImage = opt => captured.push({ type: 'image', opt });
applyElement(mockPptx, mockSlide, {
  elType: 'image', x: 0, y: 0, width: 100, height: 100,
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
}, resolveTheme('navy-brief'));
assert.ok(captured[0].opt.data.startsWith('data:image/png;base64,'));

// 5. arc-segment 归一化：跨 0° 取正向、>360° 取模
const deckArc = { slides: [{ elements: [{ elType: 'arc-segment', cx: 640, cy: 360, rOuter: 100, startAngle: 270, endAngle: 25, fill: '$1' }] }] };
const resolvedArc = resolveTokens(structuredClone(deckArc), resolveTheme('navy-brief'));
expandConnectors(resolvedArc);
assert.equal(resolvedArc.slides[0].elements[0].pointArr[1].curve.swAng, 115);

// 6. 校验器：null deck 友好失败、未知 chartType 告警、未解析令牌告警
assert.equal(validateDeck(null).ok, false);
const badChart = validateDeck({ slides: [{ elements: [{ elType: 'chart', chartType: 'waterfall', x: 0, y: 0, width: 100, height: 100, labels: ['A'], data: [{ name: 's', values: [1] }] }] }] });
assert.ok(badChart.warnings.some(w => w.includes('waterfall')));
const badToken = validateDeck({ theme: 'navy-brief', slides: [{ elements: [{ elType: 'shape-rect', x: 0, y: 0, width: 10, height: 10, fill: '$7' }] }] });
assert.ok(badToken.warnings.some(w => w.includes('令牌无法解析')));

// 7. pointsToSvgPath 能处理连接线宏产出的 cubic 点列
const d = pointsToSvgPath([{ x: 0, y: 0, moveTo: true }, { x: 10, y: 10, curve: { type: 'cubic', x1: 2, y1: 0, x2: 8, y2: 10 } }]);
assert.ok(d.startsWith('M 0 0') && d.includes('C '));

console.log('✅ smoke tests passed');
