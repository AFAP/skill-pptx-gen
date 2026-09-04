#!/usr/bin/env node
/** One-command strict pipeline: validate -> self-contained preview -> PPTX + report. */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { input: null, outDir: null, allowPartial: false, scale: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--allow-partial') out.allowPartial = true;
    else if (a === '--scale') out.scale = argv[++i];
    else if (!a.startsWith('-') && !out.input) out.input = a;
  }
  return out;
}

function run(script, args, { allowFailure = false } = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [resolve(here, script), ...args], { stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', code => code === 0 || allowFailure ? ok(code) : fail(new Error(`${script} 退出码 ${code}`)));
  });
}

const args = parseArgs(process.argv);
if (!args.input || process.argv.includes('--help')) {
  console.log('用法: node tools/build_all.mjs deck.json [-o output-dir] [--scale 0.75] [--allow-partial]');
  process.exit(args.input ? 0 : 2);
}

const input = resolve(args.input);
const stem = basename(input).replace(/\.(json|ya?ml)$/i, '');
const outDir = resolve(args.outDir || dirname(input));
await mkdir(outDir, { recursive: true });
const preview = resolve(outDir, `${stem}.preview.html`);
const pptx = resolve(outDir, `${stem}.pptx`);
const report = resolve(outDir, `${stem}.report.json`);
const common = args.allowPartial ? ['--allow-partial'] : [];

try {
  await run('check_deck.mjs', [input], { allowFailure: args.allowPartial });
  await run('make_preview.mjs', [input, '-o', preview, ...(args.scale ? ['--scale', args.scale] : []), ...common]);
  await run('build_pptx.mjs', [input, '-o', pptx, '--report', report, ...common]);
  console.log(`\n✅ 完整产物：\n  ${preview}\n  ${pptx}\n  ${report}`);
} catch (err) {
  console.error(`\n❌ 管线中止：${err.message}`);
  process.exit(1);
}
