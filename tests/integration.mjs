/** End-to-end build: semantic deck -> PptxGenJS -> OOXML sanitizer -> ZIP assertions. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { buildPresentation, sanitizePptxBuffer } from '../core/ppt-core.mjs';
import { validateDeck } from '../core/dsl-validate.mjs';

const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');
const deck = JSON.parse(await readFile(new URL('../examples/deck-compact.json', import.meta.url), 'utf-8'));
const validation = validateDeck(deck);
assert.equal(validation.ok, true, validation.errors.join('\n'));

const { pptx, report, compiledDeck } = await buildPresentation(PptxGenJS, deck, { strict: true, prefetch: true, baseDir: new URL('../examples/', import.meta.url).pathname });
let buffer = await pptx.write({ outputType: 'nodebuffer' });
buffer = await sanitizePptxBuffer(buffer, { warn() {} });
assert.ok(buffer.length > 10_000);
assert.equal(report.summary.failed, 0);
assert.equal(compiledDeck.slides.length, deck.slides.length);

const zip = await JSZip.loadAsync(buffer);
const slideFiles = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p));
assert.equal(slideFiles.length, deck.slides.length);
for (const path of slideFiles) {
  const xml = await zip.file(path).async('string');
  assert.equal(xml.includes('<a:stretch/>'), false, `${path} contains invalid empty a:stretch`);
}

const missingImageDeck = {
  slides: [{ elements: [{ elType: 'image', id: 'missing-image', x: 0, y: 0, width: 100, height: 100, prompt: 'not generated yet' }] }],
};
await assert.rejects(
  () => buildPresentation(PptxGenJS, missingImageDeck, { strict: true, prefetch: false }),
  err => err.report?.summary.failed === 1 && /尚未生成/.test(err.message),
);
const partial = await buildPresentation(PptxGenJS, missingImageDeck, { strict: false, prefetch: false });
assert.equal(partial.report.summary.failed, 1);
assert.equal(partial.report.summary.skipped, 0);

console.log('✅ integration build passed');
