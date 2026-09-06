import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { compileDeck } from '../core/compile-deck.mjs';
import { validateDeck } from '../core/dsl-validate.mjs';
import { editDeckText } from '../core/source-edit.mjs';
import { applyElement, chartModel, resolveTheme } from '../core/dsl-to-pptx.mjs';
import { buildPresentation, prefetchImages } from '../core/ppt-core.mjs';
import { sanitizePptxData } from '../core/pptx-sanitize.mjs';
import { browserBundle } from '../tools/lib/browser-bundle.mjs';
import { pixel } from './fixtures/deck.mjs';

const box = { x: 80, y: 80, width: 400, height: 200 };
const deckOf = (...elements) => ({ slides: [{ elements }] });
const text = value => ({ elType: 'text', ...box, text: value });
const chart = (type, values) => ({ elType: 'chart', ...box, chartType: type, labels: ['A', 'B'], data: [{ name: 'S', values }], showValue: true });

// Capacity errors are raised before any content disappears, including direct builds.
for (const [layout, field, limit] of [['cards', 'items', 6], ['metrics', 'items', 6], ['agenda', 'items', 8], ['cover', 'metrics', 4], ['timeline', 'items', 6], ['split', 'bullets', 5], ['chart-insight', 'insights', 6]]) {
  const source = { slides: [{ layout, title: 'Capacity', [field]: Array.from({ length: limit + 1 }, () => ({ title: 'Keep me', value: '42', label: 'Metric' })) }] };
  assert.equal(validateDeck(source).ok, false);
  assert.throws(() => compileDeck(source), /不会截断内容/);
  await assert.rejects(() => buildPresentation(PptxGenJS, source, { prefetch: false }), /不会截断内容/);
}
assert.throws(() => compileDeck({ slides: [{ layout: 'comparison', title: 'C', left: { items: Array(6).fill('Keep') }, right: {} }] }), /left\/items/);

// All entry points preserve nested lexical scope and real edit pointers.
const repeat = { elType: 'repeat', id: 'r', items: [{ label: 'outer', children: [{ label: 'inner', value: 100 }] }], template: {
  elType: 'group', id: 'g', elements: [text('{{label}}'), { elType: 'repeat', id: 'nested', items: '{{children}}', template: [
    text('{{label}}'), { ...text('{{value}}'), id: 'value' }, { ...text('Derived {{value}}'), id: 'derived' },
    { elType: 'shape-rect', id: 'bar', ...box, width: '{{value}}' },
  ] }],
} };
for (const layout of [undefined, 'raw', 'cards']) {
  const source = { slides: [{ layout, title: 'Bindings', items: [{ title: 'Card' }], elements: [repeat] }] };
  const result = compileDeck(source).deck;
  const elements = result.slides[0].elements;
  assert.ok(elements.some(e => e.text === 'inner'));
  const valueNode = elements.find(e => e.id?.endsWith('-value'));
  const derived = elements.find(e => e.id?.endsWith('-derived'));
  assert.equal(derived.sourcePath, undefined);
  assert.equal(valueNode.sourcePath, '/slides/0/elements/0/items/0/children/0/value');
  const edited = editDeckText(source, valueNode.sourcePath, '200', result);
  assert.equal(edited.source.slides[0].elements[0].items[0].children[0].value, 200);
  assert.ok(edited.deck.slides[0].elements.some(e => e.text === 'Derived 200'));
  assert.equal(edited.deck.slides[0].elements.find(e => e.id?.endsWith('-bar')).width, 200);
  assert.deepEqual(edited.deck, compileDeck(edited.source).deck);
  assert.throws(() => editDeckText(source, valueNode.sourcePath, 'not a number', result), /有限数字/);
  assert.equal(source.slides[0].elements[0].items[0].children[0].value, 100);
}
assert.equal(validateDeck(deckOf(text('{{missing}}'))).ok, false);
assert.equal(validateDeck(deckOf({ elType: 'repeat', items: [{ x: 100 }], template: { elType: 'connector-s', x1: '{{x}}', y1: 100, x2: 200, y2: 200 } })).ok, true);

// Malformed inputs return diagnostics rather than throwing or accepting NaN/Infinity.
for (const input of [
  { theme: { palette: 5 }, ...deckOf(text('x')) },
  deckOf({ elType: 'group', elements: {} }),
  deckOf({ elType: 'table', ...box, rows: [null] }),
  deckOf({ elType: 'table', ...box, rows: [[]] }),
  deckOf({ elType: 'shape-rect', ...box, width: Infinity, allowOverflow: true }),
  deckOf(chart('line', [null, 'oops'])),
  deckOf({ ...chart('pie', [1, 2]), data: [{ values: [1, 2] }, { values: [3, 4] }] }),
  deckOf(chart('pie', [0, 0])),
]) assert.equal(validateDeck(input).ok, false, JSON.stringify(input));

const split = compileDeck({ slides: [{ layout: 'split', title: 'Image right', imageSide: 'right', image: { data: pixel }, contentTitle: 'Text' }] }).deck.slides[0];
const splitImage = split.elements.find(e => e.elType === 'image');
const splitText = split.elements.find(e => e.role === 'item-title');
assert.ok(splitText.x + splitText.width < splitImage.x);

// Alpha composition must not turn an invisible fill into a black box.
let options;
const mockSlide = { addShape: (_, opt) => { options = opt; }, addImage: opt => { options = opt; } };
applyElement({ ShapeType: { rect: 'rect' } }, mockSlide, { elType: 'shape-rect', ...box, fill: '#00000000', stroke: '#F26B21', opacity: 0.65 }, resolveTheme());
assert.equal(options.fill.transparency, 100);
assert.equal(options.line.transparency, 35);
applyElement({}, mockSlide, { elType: 'image', ...box, data: pixel, opacity: 0.4 }, resolveTheme());
assert.equal(options.transparency, 60);

// Execute the actual renderer. A caught exception is not an acceptable preview.
const drawn = [];
class Node { constructor(attrs = {}) { this.attrs = attrs; this.children = []; drawn.push(this); } add(...nodes) { this.children.push(...nodes); } batchDraw() {} }
const Konva = Object.fromEntries(['Rect', 'Text', 'Circle', 'Line', 'Wedge', 'Ellipse', 'Group'].map(name => [name, class extends Node { constructor(attrs) { super(attrs); this.kind = name; } }]));
const ctx = vm.createContext({ Konva, chartModel, console });
vm.runInContext(await readFile(new URL('../core/ppt-preview-core.js', import.meta.url), 'utf8'), ctx);
for (const type of ['bar', 'line', 'area', 'pie', 'doughnut', 'radar', 'scatter']) {
  drawn.length = 0;
  const element = chart(type, type === 'scatter' ? [[-1, 10], [2, -20]] : type === 'bar' || type === 'line' || type === 'area' ? [-10, 20] : [10, 20]);
  await ctx.PptPreview.renderElements([element], new Node(), new Node(), { palette: ['#FF00FF'] });
  assert.ok(drawn.some(n => n.attrs.fill === '#FF00FF' || n.attrs.stroke === '#FF00FF'), `${type}: theme lost`);
  for (const n of drawn.filter(n => n.kind === 'Rect')) assert.ok(n.attrs.height >= 0, `${type}: negative height`);
}
await assert.rejects(() => ctx.PptPreview.renderElements([{ elType: 'unknown' }], new Node(), new Node()), /未知/);

// Native scatter XML must contain both original series and their finite points.
const scatter = { ...chart('scatter', [[-1, 2], [3, 4]]), data: [{ name: 'A', values: [[-1, 2], [3, 4]] }, { name: 'B', values: [[2, -3], [2, 5]] }] };
const built = await buildPresentation(PptxGenJS, deckOf(scatter), { prefetch: false });
const zip = await JSZip.loadAsync(await built.pptx.write({ outputType: 'nodebuffer' }));
const chartXml = await zip.file('ppt/charts/chart1.xml').async('string');
assert.equal((chartXml.match(/<c:ser>/g) || []).length, 2);
assert.equal((chartXml.match(/<c:xVal>/g) || []).length, 2);
for (const value of [-1, 2, 3, 4, -3, 5]) assert.ok(chartXml.includes(`<c:v>${value}</c:v>`));
// OOXML ST_MarkerSize is an integer; fractional sizes make real PowerPoint refuse the file.
const markerSizes = [...chartXml.matchAll(/<c:size val="([^"]+)"/g)].map(match => Number(match[1]));
assert.ok(markerSizes.length > 0);
assert.ok(markerSizes.every(size => Number.isInteger(size) && size >= 2 && size <= 72));
assert.ok(chartXml.includes('formatCode="General"'), 'data labels must not round to integers');
const corrupt = new JSZip(); corrupt.file('ppt/media/image1.png', 'not a png');
await assert.rejects(() => sanitizePptxData(JSZip, corrupt.generateAsync({ type: 'nodebuffer' })), /拒绝用空白图片/);

// Browser and Node really use the same compiler and edit transaction.
const bundled = await browserBundle(fileURLToPath(new URL('../', import.meta.url)), ['core/source-edit.mjs', 'core/presentation.mjs', 'core/pptx-sanitize.mjs']);
const browser = vm.createContext({ structuredClone, console });
vm.runInContext(bundled, browser);
const browserCompiler = vm.runInContext("__pptModules['core/compile-deck.mjs'].compileDeck", browser);
const source = deckOf(repeat);
assert.equal(JSON.stringify(browserCompiler(source).deck), JSON.stringify(compileDeck(source).deck));
const browserEditor = vm.runInContext("__pptModules['core/source-edit.mjs'].editDeckText", browser);
assert.equal(JSON.stringify(browserEditor(source, '/slides/0/elements/0/items/0/children/0/value', '200').deck), JSON.stringify(editDeckText(source, '/slides/0/elements/0/items/0/children/0/value', '200').deck));

const svg = deckOf({ elType: 'image-svg', ...box, svgXml: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>' });
await prefetchImages(svg, { svgMode: 'browser' });
assert.equal(svg.slides[0].elements[0]._error, undefined);

// Text edits retain prefetched resources; changes to asset geometry invalidate the cache.
const resources = { slides: [{ background: 'bg.png', elements: [text('Before'), { elType: 'image', ...box, path: 'asset.png' }] }] };
const cached = compileDeck(resources).deck;
Object.assign(cached.slides[0], { _backgroundSource: 'bg.png', _backgroundMedia: true, background: pixel });
cached.slides[0].elements[1]._data = pixel;
const retained = editDeckText(resources, '/slides/0/elements/0/text', 'After', cached).deck;
assert.equal(retained.slides[0].background, pixel);
assert.equal(retained.slides[0].elements[1]._data, pixel);
const resized = structuredClone(resources); resized.slides[0].elements[1].width++;
assert.equal(editDeckText(resized, '/slides/0/elements/0/text', 'After', cached).deck.slides[0].elements[1]._data, undefined);

// An export failure must not leave a new preview beside an old PPTX.
const work = await mkdtemp(join(tmpdir(), 'ppt-build-test-'));
try {
  const input = join(work, 'input.json'), output = join(work, 'output');
  const source = deckOf(text('Stable'), { elType: 'image', x: 600, y: 80, width: 100, height: 100, path: 'asset.png' });
  await writeFile(join(work, 'asset.png'), Buffer.from(pixel.split(',')[1], 'base64'));
  await writeFile(input, JSON.stringify(source));
  const build = () => spawnSync(process.execPath, [fileURLToPath(new URL('../tools/build_all.mjs', import.meta.url)), input, '-o', output], { encoding: 'utf8', timeout: 45000, windowsHide: true });
  const first = build(); assert.equal(first.status, 0, first.stderr || first.stdout);
  const names = await readdir(output), bytes = await Promise.all(names.map(name => readFile(join(output, name))));
  const manifest = JSON.parse(await readFile(join(output, 'input.build.json'), 'utf8'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(manifest.sourceSha256, hash(await readFile(input)));
  for (const [name, expected] of Object.entries(manifest.artifacts)) assert.equal(hash(await readFile(join(output, name))), expected);
  source.slides[0].elements[0].text = 'Do not publish';
  await writeFile(input, JSON.stringify(source));
  await writeFile(join(work, 'asset.png'), 'invalid png');
  const second = build(); assert.notEqual(second.status, 0);
  assert.deepEqual(await readdir(output), names, 'staging directory leaked after failure');
  for (let i = 0; i < names.length; i++) assert.deepEqual(await readFile(join(output, names[i])), bytes[i], `${names[i]} changed on failed build`);
} finally { await rm(work, { recursive: true, force: true }); }
console.log('✅ regression contracts passed (content, nesting, edits, charts, alpha, browser bundle, transactional build)');
