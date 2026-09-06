/** Validate every semantic layout against every current style preset. */
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { compileDeck } from '../core/compile-deck.mjs';
import { validateDeck } from '../core/dsl-validate.mjs';
import { slides } from './fixtures/deck.mjs';

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
const goldenExamples = (await readdir(new URL('../examples/', import.meta.url))).filter(name => name.endsWith('.deck.json'));
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

// Documentation is executable guidance: local links must survive example cleanup.
const docs = ['SKILL.md', 'README.md', ...(await readdir(new URL('../references/', import.meta.url))).filter(name => name.endsWith('.md')).map(name => `references/${name}`)];
for (const name of docs) {
  const url = new URL(`../${name}`, import.meta.url);
  const content = await readFile(url, 'utf8');
  for (const [, target] of content.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    if (/^(?:[a-z]+:|#)/i.test(target)) continue;
    await assert.doesNotReject(() => access(new URL(target.split('#')[0], url)), `${name}: broken link ${target}`);
  }
}

console.log('✅ semantic layouts/styles passed');
