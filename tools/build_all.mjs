#!/usr/bin/env node
/** One-command strict pipeline: validate -> self-contained preview -> PPTX + report. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { input: null, outDir: null, allowPartial: false, scale: null, checkBrowser: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--allow-partial') out.allowPartial = true;
    else if (a === '--scale') out.scale = argv[++i];
    else if (a === '--check-browser') out.checkBrowser = true;
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
  console.log('用法: node tools/build_all.mjs deck.json [-o output-dir] [--scale 0.75] [--check-browser] [--allow-partial]');
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
const stage = await mkdtemp(join(outDir, '.ppt-build-'));
const snapshot = join(stage, `${stem}.json`);
const manifest = resolve(outDir, `${stem}.build.json`);
const filenames = [basename(preview), basename(pptx), basename(report), basename(manifest)];
const previous = new Set(), published = [];
try {
  // Every step reads one immutable source snapshot; assets still resolve beside the original.
  const source = await readFile(input);
  await writeFile(snapshot, source);
  await run('check_deck.mjs', [snapshot], { allowFailure: args.allowPartial });
  await run('make_preview.mjs', [snapshot, '-o', join(stage, basename(preview)), '--base-dir', dirname(input), ...(args.scale ? ['--scale', args.scale] : []), ...common]);
  await run('build_pptx.mjs', [snapshot, '-o', join(stage, basename(pptx)), '--report', join(stage, basename(report)), '--base-dir', dirname(input), ...common]);
  if (args.checkBrowser) await run('check_preview.mjs', [join(stage, basename(preview))]);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const artifacts = {};
  for (const file of filenames.slice(0, -1)) artifacts[file] = hash(await readFile(join(stage, file)));
  await writeFile(join(stage, basename(manifest)), JSON.stringify({ source: input, sourceSha256: hash(source), artifacts, browserChecked: args.checkBrowser }, null, 2));
  // Keep the last complete bundle on a failed build; publish the hash manifest last.
  await mkdir(join(stage, 'previous'));
  for (const file of filenames) {
    try { await copyFile(join(outDir, file), join(stage, 'previous', file)); previous.add(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const file of filenames) { await rename(join(stage, file), join(outDir, file)); published.push(file); }
  console.log(`\n✅ 完整产物：\n  ${preview}\n  ${pptx}\n  ${report}\n  ${manifest}`);
} catch (err) {
  for (const file of published.reverse()) {
    if (previous.has(file)) await copyFile(join(stage, 'previous', file), join(outDir, file));
    else await rm(join(outDir, file), { force: true });
  }
  console.error(`\n❌ 管线中止：${err.message}`);
  process.exitCode = 1;
} finally { await rm(stage, { recursive: true, force: true }); }
