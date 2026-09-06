/** Optional real Chromium acceptance test; no browser automation npm dependency. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dumpDOM } from '../tools/lib/browser.mjs';
import { pixel } from './fixtures/deck.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'ppt-browser-test-'));
const run = (tool, args) => exec(process.execPath, [join(root, 'tools', tool), ...args], { windowsHide: true, timeout: 60000 });
try {
  const source = { style: 'clean-minimal', slides: [{ elements: [
    { elType: 'repeat', id: 'r', items: [{ label: 'Before', value: 100 }], template: [
      { elType: 'text', id: 'label', text: '{{label}}', x: 100, y: 100, width: 400, height: 40 },
      { elType: 'text', id: 'derived', text: 'Derived {{label}}', x: 100, y: 150, width: 400, height: 40 },
      { elType: 'text', id: 'value', text: '{{value}}', x: 100, y: 200, width: 400, height: 40 },
      { elType: 'shape-rect', id: 'bar', x: 100, y: 250, width: '{{value}}', height: 40, fill: '$accent' },
    ] },
    { elType: 'chart', id: 'line', chartType: 'line', x: 600, y: 100, width: 500, height: 240, labels: ['A', 'B'], data: [{ name: 'S', values: [-10, 20] }], showValue: true },
    { elType: 'image', id: 'image', x: 100, y: 400, width: 100, height: 100, data: pixel },
  ] }] };
  const input = join(temp, 'source.json'), preview = join(temp, 'preview.html');
  await writeFile(input, JSON.stringify(source));
  await run('make_preview.mjs', [input, '-o', preview]);
  let html = await readFile(preview, 'utf8');
  html = html.replace('</body>', `<script>
  (async () => {
    const result = {};
    try {
      await window.PPT_PREVIEW_READY;
      const node = id => ({ _elop: DECK.slides[0].elements.find(e => e.id === id) });
      await onTextEdit(node('r-0-label'), 'After');
      await onTextEdit(node('r-0-value'), '200');
      result.texts = DECK.slides[0].elements.filter(e => e.elType === 'text').map(e => String(e.text));
      result.value = DECK_RAW.slides[0].elements[0].items[0].value;
      result.width = DECK.slides[0].elements.find(e => e.id === 'r-0-bar').width;
      result.stages = stages.length;
      result.image = DECK.slides[0].elements.find(e => e.id === 'image').data;
      const built = presentationFromScene(PptxGenJS, DECK, THEME);
      const bytes = await built.pptx.write({ outputType: 'arraybuffer' });
      const clean = await sanitizePptxData(JSZip, bytes, { outputType: 'uint8array' });
      const zip = await JSZip.loadAsync(clean.data);
      result.slideXml = await zip.file('ppt/slides/slide1.xml').async('string');
      result.chartXml = await zip.file('ppt/charts/chart1.xml').async('string');
      result.report = built.report.summary;
    } catch (error) { result.error = error.stack; }
    const pre = document.createElement('pre'); pre.id = '__RESULT__'; pre.textContent = encodeURIComponent(JSON.stringify(result)); document.body.appendChild(pre);
  })();
  </script></body>`);
  await writeFile(preview, html);
  const dom = await dumpDOM(pathToFileURL(preview).href, { budget: 20000 });
  const match = dom.stdout.match(/<pre id="__RESULT__">([^<]*)<\/pre>/);
  assert.ok(match, '浏览器未完成验收: ' + dom.stderr.slice(-500));
  const result = JSON.parse(decodeURIComponent(match[1]));
  assert.equal(result.error, undefined);
  assert.deepEqual(result.texts, ['After', 'Derived After', '200']);
  assert.equal(result.value, 200); assert.equal(result.width, 200); assert.equal(result.stages, 1);
  assert.equal(result.image, pixel);
  assert.ok(result.slideXml.includes('Derived After'));
  assert.ok(result.chartXml.includes('<c:v>-10</c:v>'));
  assert.equal(result.report.failed, 0);

  const extracted = join(temp, 'web.json');
  await run('html_to_deck.mjs', [join(root, 'tests/fixtures/webslide.html'), '-o', extracted]);
  const web = JSON.parse(await readFile(extracted, 'utf8'));
  const elements = web.slides[0].elements;
  const get = id => elements.find(e => e.id === id);
  assert.deepEqual([get('rotated').x, get('rotated').y, get('rotated').width, get('rotated').height, get('rotated').rotation], [100, 100, 200, 100, 30]);
  assert.equal(get('pill').elType, 'shape-rect'); assert.equal(get('pill').cornerRadius, 30);
  assert.equal(get('ellipse').elType, 'shape-circle');
  assert.equal(get('faded').opacity, 0.2);
  assert.ok(get('clipped').webUnsupported.includes('ancestor-overflow-clip'));
  assert.equal(get('hidden'), undefined);
  assert.equal(web.slides[0].webOmitted[0].id, 'hidden');
  console.log('✅ real browser passed (render, edit, JSON/PPTX, CSS extraction)');
} finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
