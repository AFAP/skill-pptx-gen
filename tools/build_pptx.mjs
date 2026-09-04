#!/usr/bin/env node
/**
 * ai-ppt-gen 构建工具：deck.json → 可编辑 .pptx
 *
 * 用法：
 *   node tools/build_pptx.mjs deck.json [-o output.pptx] [--report output.report.json]
 *
 * 流程：读取 deck → 严格校验 → 预取图片 → PptxGenJS 构建 → OOXML 修复 → PPTX 与报告
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
  const args = { input: null, output: null, validate: true, prefetch: true, strict: true, report: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a === '--no-validate') args.validate = false;
    else if (a === '--skip-images') args.prefetch = false;
    else if (a === '--allow-partial') args.strict = false;
    else if (a === '--report') args.report = argv[++i];
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

const args = parseArgs(process.argv);

if (process.argv.includes('--help')) {
  console.log('用法: node tools/build_pptx.mjs deck.json [-o output.pptx] [--report report.json] [--allow-partial] [--no-validate] [--skip-images]');
  process.exit(0);
}
if (!args.input) {
  console.error('用法: node tools/build_pptx.mjs deck.json [-o output.pptx] [--report report.json] [--allow-partial] [--no-validate] [--skip-images]');
  process.exit(2);
}

const inputPath = resolve(args.input);
const baseDir = dirname(inputPath);
const outputPath = resolve(args.output || basename(inputPath).replace(/\.json$/i, '') + '.pptx');
const reportPath = resolve(args.report || outputPath.replace(/\.pptx$/i, '.report.json'));

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
  if (!report.ok && args.strict) {
    console.error('\n❌ 存在必须修复的错误，已中止。修复后重试；仅调试中间结果时可使用 --allow-partial。');
    process.exit(1);
  }
}

try {
  const { pptx, report } = await buildPresentation(PptxGenJS, deck, { prefetch: args.prefetch, baseDir, strict: args.strict });
  let data = await pptx.write({ outputType: 'nodebuffer' });
  data = await sanitizePptxBuffer(data); // 修复 image-svg 在 Node 端的 PNG 回退槽
  await writeFile(outputPath, data);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  const slideCount = (deck.slides || []).length;
  console.log(`✅ 已生成 ${outputPath}（${slideCount} 页，${(data.length / 1024).toFixed(0)} KB）`);
  console.log(`✅ 转换报告 ${reportPath}（可编辑 ${report.summary.editable}，图片/栅格 ${report.summary.rasterized}，失败 ${report.summary.failed}）`);
} catch (e) {
  if (e.report) {
    await writeFile(reportPath, JSON.stringify(e.report, null, 2), 'utf-8');
    console.error(`❌ 失败报告已写入 ${reportPath}`);
  }
  console.error(`❌ 构建失败: ${e.message}`);
  process.exit(1);
}
