/** End-to-end build: semantic deck -> PptxGenJS -> OOXML sanitizer -> ZIP assertions. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildPresentation, sanitizePptxBuffer } from '../core/ppt-core.mjs';
import { compileDeck } from '../core/compile-deck.mjs';
import { validateDeck } from '../core/dsl-validate.mjs';

const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');
const deck = JSON.parse(await readFile(new URL('../examples/南京埃斯顿深度研究报告-29页展示版.deck.json', import.meta.url), 'utf-8'));
const validation = validateDeck(deck);
assert.equal(validation.ok, true, validation.errors.join('\n'));

const examplesDir = fileURLToPath(new URL('../examples/', import.meta.url));
const { pptx, report, compiledDeck } = await buildPresentation(PptxGenJS, deck, { strict: true, prefetch: true, baseDir: examplesDir });
let buffer = await pptx.write({ outputType: 'nodebuffer' });
buffer = await sanitizePptxBuffer(buffer, { warn() {} });
assert.ok(buffer.length > 10_000);
assert.equal(report.summary.failed, 0);
assert.equal(compiledDeck.slides.length, deck.slides.length);

function pointerExists(root, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return false;
  const parts = pointer.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current = root;
  for (const part of parts) {
    if (current == null || !Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = current[part];
  }
  return true;
}

function assertWritablePathsExist(sourceDeck, resultDeck) {
  for (const slide of resultDeck.slides) {
    for (const element of slide.elements) {
      if (element.sourcePath) {
        assert.ok(pointerExists(sourceDeck, element.sourcePath), `${element.id || element.elType}: invalid sourcePath ${element.sourcePath}`);
      }
    }
  }
}

assertWritablePathsExist(deck, compiledDeck);
const creativeDeck = JSON.parse(await readFile(new URL('../examples/南京埃斯顿深度研究报告-AI创意版.deck.json', import.meta.url), 'utf-8'));
assertWritablePathsExist(creativeDeck, compileDeck(creativeDeck).deck);

const zip = await JSZip.loadAsync(buffer);
const slideFiles = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p));
assert.equal(slideFiles.length, deck.slides.length);
const contentTypes = await zip.file('[Content_Types].xml').async('string');
const overrideTargets = [...contentTypes.matchAll(/<Override\b[^>]*\bPartName="\/?([^"]+)"/g)].map(match => match[1]);
assert.ok(overrideTargets.every(path => zip.file(path)), '[Content_Types].xml contains a missing target');
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
