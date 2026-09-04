#!/usr/bin/env node
/**
 * ppt-gen 校验工具：只检查 deck.json，不构建
 *
 * 用法：node tools/check_deck.mjs deck.json [--json]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { validateDeck, formatReport } = await import('../core/dsl-validate.mjs');

if (process.argv.includes('--help')) {
  console.log('用法: node tools/check_deck.mjs deck.json [--json]');
  process.exit(0);
}

const input = process.argv[2];
const asJson = process.argv.includes('--json');
if (!input) {
  console.error('用法: node tools/check_deck.mjs deck.json [--json]');
  process.exit(2);
}

let deck;
try {
  deck = JSON.parse((await readFile(resolve(input), 'utf-8')).replace(/^\uFEFF/, '')); // 容忍 Windows BOM
} catch (e) {
  console.error(`❌ 读取 deck 失败: ${e.message}`);
  process.exit(1);
}

const report = validateDeck(deck);
if (asJson) {
  console.log(JSON.stringify({ ok: report.ok, errors: report.errors, warnings: report.warnings }, null, 2));
} else {
  console.log(formatReport(report));
}
process.exit(report.ok ? 0 : 1);
