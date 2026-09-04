/**
 * ai-ppt-gen 冒烟测试：覆盖转换核心/宏展开/校验器的高风险回归点。
 * 用法：node tests/smoke.mjs
 */
import assert from 'node:assert/strict';
import { parseColor, resolveTheme, resolveTokens, applyElement } from '../core/dsl-to-pptx.mjs';
import { expandConnectors, pointsToSvgPath } from '../core/connectors.mjs';
import { validateDeck } from '../core/dsl-validate.mjs';
import { compileDeck } from '../core/compile-deck.mjs';

// 1. 颜色解析与主题
assert.deepEqual(parseColor('#0C1B2E'), { color: '0C1B2E', transparency: 0 });
assert.equal(resolveTheme('navy-report').name, 'navy-report');
assert.equal(resolveTheme('business').name, 'business');
assert.equal(resolveTheme('business').accent, 'C9A96E');
assert.equal(resolveTokens({ a: { fill: '$1' } }, resolveTheme('navy-brief')).a.fill, '#0C1B2E');
assert.equal(resolveTokens({ a: { fill: '$accentText' } }, resolveTheme('navy-report')).a.fill, '#B83F08');

// 2. 多段 shape-arrow 导出必须带 stealth 箭头（回归：customGeometry 丢 tailEnd）
const captured = [];
const mockPptx = { shapes: { CUSTOM_GEOMETRY: 'custom' }, ShapeType: { line: 'line', ellipse: 'ellipse' }, ChartType: { bar: 'bar' } };
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

// 6. 校验器：null deck 友好失败、未知 chartType 必须报错、未解析令牌告警
assert.equal(validateDeck(null).ok, false);
const badChart = validateDeck({ slides: [{ elements: [{ elType: 'chart', chartType: 'waterfall', x: 0, y: 0, width: 100, height: 100, labels: ['A'], data: [{ name: 's', values: [1] }] }] }] });
assert.ok(badChart.errors.some(w => w.includes('waterfall')));
const badToken = validateDeck({ theme: 'navy-brief', slides: [{ elements: [{ elType: 'shape-rect', x: 0, y: 0, width: 10, height: 10, fill: '$7' }] }] });
assert.ok(badToken.warnings.some(w => w.includes('令牌无法解析')));
assert.ok(validateDeck({ style: 'does-not-exist', slides: [{ elements: [{ elType: 'shape-rect', x: 0, y: 0, width: 10, height: 10 }] }] }).errors.some(e => e.includes('未知样式')));
assert.ok(validateDeck({ dslVersion: 999, slides: [{ elements: [{ elType: 'shape-rect', x: 0, y: 0, width: 10, height: 10 }] }] }).errors.some(e => e.includes('高于当前支持版本')));
const duplicateIds = validateDeck({ slides: [{ elements: [
  { id: 'same', elType: 'shape-rect', x: 0, y: 0, width: 10, height: 10 },
  { id: 'same', elType: 'shape-rect', x: 20, y: 0, width: 10, height: 10 },
] }] });
assert.ok(duplicateIds.errors.some(e => e.includes('id "same" 重复')));
const badColumns = validateDeck({ slides: [{ layout: 'cards', title: '错误列数', columns: 0, items: [{ title: 'A' }] }] });
assert.ok(badColumns.errors.some(e => e.includes('columns 必须是 1–6 的整数')));
const customAccent = validateDeck({
  theme: { background: '#FFFFFF', surface: '#FFFFFF', accent: '#F26B21' },
  slides: [{ elements: [{ elType: 'shape-rect', x: 0, y: 0, width: 10, height: 10 }] }],
});
assert.ok(customAccent.warnings.some(w => w.includes('accentText')));

// 7. 文本框明显碰撞会告警；有意叠放可用 allowOverlap 显式豁免。
const overlapDeck = { slides: [{ elements: [
  { elType: 'text', text: '标题甲', x: 100, y: 100, width: 300, height: 60, fontSize: 24, fill: '$text' },
  { elType: 'text', text: '标题乙', x: 180, y: 110, width: 300, height: 60, fontSize: 24, fill: '$text' },
] }] };
assert.ok(validateDeck(overlapDeck).warnings.some(w => w.includes('文本框疑似重叠')));
overlapDeck.slides[0].elements[1].allowOverlap = true;
assert.ok(!validateDeck(overlapDeck).warnings.some(w => w.includes('文本框疑似重叠')));

// 8. pointsToSvgPath 能处理连接线宏产出的 cubic 点列
const d = pointsToSvgPath([{ x: 0, y: 0, moveTo: true }, { x: 10, y: 10, curve: { type: 'cubic', x1: 2, y1: 0, x2: 8, y2: 10 } }]);
assert.ok(d.startsWith('M 0 0') && d.includes('C '));

// 9. 语义 layout 编译为 primitive DSL，并保留文本回写 sourcePath
const compact = compileDeck({ style: 'clean-minimal', slides: [{ layout: 'cards', title: '三层', items: [{ title: '语义层', body: '短输入' }] }] });
assert.equal(compact.deck.slides[0]._sourceLayout, 'cards');
assert.ok(compact.deck.slides[0].elements.length >= 5);
assert.ok(compact.deck.slides[0].elements.some(e => e.sourcePath === '/slides/0/items/0/title'));
assert.equal(compact.theme.surface, 'FFFFFF');
const primitive = compileDeck({ slides: [{ elements: [{ elType: 'text', text: 'raw', x: 0, y: 0, width: 100, height: 30 }] }] });
assert.equal(primitive.theme.name, 'navy-report');
assert.equal(primitive.deck.slides[0].elements[0].id, 's0-raw-0');
assert.equal(primitive.deck.slides[0].elements[0].sourcePath, '/slides/0/elements/0/text');
assert.throws(() => compileDeck({ style: 'does-not-exist', slides: [{ elements: [] }] }), /未知样式/);
for (const style of ['navy-report', 'clean-minimal', 'tech-dark', 'warm-editorial', 'data-dashboard']) {
  const styled = validateDeck({ style, slides: [{ layout: 'timeline', title: '样式验证', items: [{ date: '01', title: '节点', body: '正文' }, { date: '02', title: '节点', body: '正文' }] }] });
  assert.equal(styled.ok, true, `${style}: ${styled.errors.join('; ')}`);
  assert.deepEqual(styled.warnings, [], `${style}: ${styled.warnings.join('; ')}`);
}

// 10. 图片 cornerRadius 不得误映射为椭圆 rounding；图表两端缺省都隐藏图例
captured.length = 0;
mockSlide.addImage = opt => captured.push({ type: 'image', opt });
applyElement(mockPptx, mockSlide, { elType: 'image', x: 0, y: 0, width: 100, height: 60, data: 'data:image/png;base64,AA==', cornerRadius: 12 }, resolveTheme('clean-minimal'));
assert.equal(captured[0].opt.rounding, undefined);
captured.length = 0;
mockSlide.addChart = (type, data, opt) => captured.push({ type, data, opt });
applyElement(mockPptx, mockSlide, { elType: 'chart', x: 0, y: 0, width: 200, height: 100, labels: ['A'], data: [{ name: 'S', values: [1] }] }, resolveTheme('clean-minimal'));
assert.equal(captured[0].opt.showLegend, false);
assert.throws(() => applyElement(mockPptx, mockSlide, { elType: 'chart', chartType: 'waterfall', x: 0, y: 0, width: 200, height: 100, data: [] }, resolveTheme('clean-minimal')), /未知 chartType/);

console.log('✅ smoke tests passed');
