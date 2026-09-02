#!/usr/bin/env node
/**
 * ai-ppt-gen 构建工具：deck.json → 可编辑 .pptx
 *
 * 用法：
 *   node tools/build_pptx.mjs deck.json [-o output.pptx] [--no-validate] [--skip-images]
 *
 * 流程：读取 deck → 校验（可用 --no-validate 跳过）→ 预取图片 → PptxGenJS 构建 → 写文件
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');

const { buildPresentation, sanitizePptxBuffer } = await import('../core/ppt-core.mjs');
const { validateDeck, formatReport } = await import('../core/dsl-validate.mjs');

function parseArgs(argv) {
  const args = { input: null, output: null, validate: true, prefetch: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a === '--no-validate') args.validate = false;
    else if (a === '--skip-images') args.prefetch = false;
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

const args = parseArgs(process.argv);

if (process.argv.includes('--help')) {
  console.log('用法: node tools/build_pptx.mjs deck.json [-o output.pptx] [--no-validate] [--skip-images]');
  process.exit(0);
}
if (!args.input) {
  console.error('用法: node tools/build_pptx.mjs deck.json [-o output.pptx] [--no-validate] [--skip-images]');
  process.exit(2);
}

const inputPath = resolve(args.input);
const baseDir = dirname(inputPath);
const outputPath = resolve(args.output || basename(inputPath).replace(/\.json$/i, '') + '.pptx');

let deck;
try {
  deck = JSON.parse((await readFile(inputPath, 'utf-8')).replace(/^\uFEFF/, '')); // 容忍 Windows BOM
} catch (e) {
  console.error(`❌ 读取 deck 失败: ${e.message}`);
  process.exit(1);
}

if (args.validate) {
  const report = validateDeck(deck);
  console.log(formatReport(report));
  if (!report.ok) {
    console.error('\n❌ 存在必须修复的错误，已中止。修复后重试，或加 --no-validate 强制构建。');
    process.exit(1);
  }
}

try {
  const { pptx } = await buildPresentation(PptxGenJS, deck, { prefetch: args.prefetch, baseDir });
  let data = await pptx.write({ outputType: 'nodebuffer' });
  data = await sanitizePptxBuffer(data); // 修复 image-svg 在 Node 端的 PNG 回退槽
  await writeFile(outputPath, data);
  const slideCount = (deck.slides || []).length;
  console.log(`✅ 已生成 ${outputPath}（${slideCount} 页，${(data.length / 1024).toFixed(0)} KB）`);
} catch (e) {
  console.error(`❌ 构建失败: ${e.message}`);
  process.exit(1);
}
