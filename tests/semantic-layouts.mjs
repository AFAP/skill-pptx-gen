/** Validate every semantic layout against every current style preset. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileDeck } from '../core/compile-deck.mjs';
import { validateDeck } from '../core/dsl-validate.mjs';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const slides = [
  { layout: 'cover', title: '封面标题', subtitle: '封面副标题', metrics: [{ value: '42%', label: '指标' }] },
  { layout: 'section', number: '01', title: '章节标题', subtitle: '章节说明' },
  { layout: 'agenda', title: '目录', items: ['第一章', '第二章', '第三章'] },
  { layout: 'cards', title: '卡片页', items: [{ title: '观点一', body: '简短说明' }, { title: '观点二', body: '简短说明' }, { title: '观点三', body: '简短说明' }] },
  { layout: 'metrics', title: '指标页', items: [{ value: '18', label: '项目', detail: '同比提升' }, { value: '92%', label: '完成率', detail: '保持稳定' }], insight: '数据说明与行动建议。' },
  { layout: 'split', title: '图文页', image: { data: pixel }, contentTitle: '核心结论', body: '正文说明。', bullets: ['要点一', '要点二'] },
  { layout: 'comparison', title: '对比页', left: { title: '当前', items: ['问题一', '问题二'] }, right: { title: '目标', items: ['收益一', '收益二'] } },
  { layout: 'timeline', title: '时间线', items: [{ date: '01', title: '开始', body: '完成准备' }, { date: '02', title: '交付', body: '完成验证' }] },
  { layout: 'chart-insight', title: '图表页', chart: { chartType: 'bar', labels: ['A', 'B'], data: [{ name: '系列', values: [1, 2] }] }, insights: ['趋势向上', '重点关注 B'] },
  { layout: 'quote', quote: '一句值得强调的核心观点。', source: '示例来源' },
  { layout: 'ending', title: '感谢聆听', subtitle: '下一步开始行动' },
  { layout: 'raw', elements: [{ elType: 'shape-rect', x: 80, y: 80, width: 1120, height: 560, fill: '$surface' }] },
];

for (const style of ['navy-report', 'clean-minimal', 'tech-dark', 'warm-editorial', 'data-dashboard']) {
  const deck = { dslVersion: 3, style, slides };
  const result = validateDeck(deck);
  assert.equal(result.ok, true, `${style}: ${result.errors.join('; ')}`);
  assert.deepEqual(result.warnings, [], `${style}: ${result.warnings.join('; ')}`);
  const compiled = compileDeck(deck);
  assert.equal(compiled.deck.slides.length, slides.length);
  assert.ok(compiled.deck.slides.every(slide => slide.elements.length > 0));
}

// 正式示例是文档的一部分，必须保持 0 错误、0 告警。
const goldenExamples = [
  '南京埃斯顿深度研究报告-29页展示版.deck.json',
  '南京埃斯顿深度研究报告-AI创意版.deck.json',
];
for (const name of goldenExamples) {
  const file = new URL(`../examples/${name}`, import.meta.url);
  const deck = JSON.parse(await readFile(file, 'utf8'));
  const result = validateDeck(deck);
  assert.equal(result.ok, true, `${name}: ${result.errors.join('; ')}`);
  assert.deepEqual(result.warnings, [], `${name}: ${result.warnings.join('; ')}`);
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(packageJson.dependencies?.sharp, undefined, 'sharp 不应阻塞基础安装');
assert.equal(packageJson.optionalDependencies?.sharp, '^0.35.4');

console.log('✅ semantic layouts/styles passed');
