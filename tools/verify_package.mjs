#!/usr/bin/env node
/** Install and exercise the ZIP outside the checkout, without borrowing its node_modules. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { inspectSkillArchive, sha256 } from './lib/skill-package.mjs';
import { findNpmCli } from './lib/npm-cli.mjs';

const argv = process.argv.slice(2), options = { checkBrowser: false };
const usage = '用法: node tools/verify_package.mjs package.zip [--check-browser] [--browser path]';
if (argv.includes('--help')) { console.log(usage); process.exit(0); }
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--check-browser') options.checkBrowser = true;
  else if (arg === '--browser' && argv[i + 1] && !argv[i + 1].startsWith('-')) options.browser = argv[++i];
  else if (!arg.startsWith('-') && !options.input) options.input = resolve(arg);
  else { console.error(`参数无效: ${arg}\n${usage}`); process.exit(2); }
}
if (!options.input) { console.error(usage); process.exit(2); }

function run(script, args, cwd, { capture = false, timeout = 120000 } = {}) {
  return new Promise((ok, fail) => {
    const env = { ...process.env, NODE_PATH: '' };
    if (options.browser) env.PPT_BROWSER = resolve(options.browser);
    const child = spawn(process.execPath, [script, ...args], { cwd, env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeout);
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); fail(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !expired) ok(stdout);
      else fail(new Error(`${basename(script)} ${expired ? '超时' : `退出码 ${code}`}${stderr ? ': ' + stderr.slice(-3000) : ''}`));
    });
  });
}

let temp, verification = { ok: false };
try {
  const bytes = await readFile(options.input);
  verification.archiveSha256 = sha256(bytes);
  const { manifest, contents, layout } = await inspectSkillArchive(bytes);
  verification.version = manifest.version;
  verification.layout = layout;
  verification.fileCount = contents.size;
  temp = await mkdtemp(join(tmpdir(), 'ppt-package-check-'));
  const skill = join(temp, manifest.name);
  for (const [path, data] of contents) {
    const file = join(skill, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }
  const npmCli = await findNpmCli();
  console.log('1/3 解压包独立安装依赖（包含可选 SVG 依赖）');
  await run(npmCli, ['ci', '--include=optional', '--no-audit', '--no-fund'], skill, { timeout: 300000 });
  console.log('2/3 检查解压后的运行环境与 SVG 转换');
  const doctor = [join(skill, 'tools/doctor.mjs'), ['--json', '--require-svg', ...(options.checkBrowser ? ['--require-browser'] : [])]];
  verification.environment = JSON.parse(await run(...doctor, skill, { capture: true }));
  assert.equal(verification.environment.ok, true);
  const resolved = JSON.parse(await run('--input-type=module', ['-e', "console.log(JSON.stringify(['jszip','pptxgenjs','sharp'].map(name => import.meta.resolve(name))))"], skill, { capture: true }));
  // Resolved URLs must refer to this extracted installation, never the checkout.
  const { fileURLToPath } = await import('node:url');
  for (const url of resolved) assert.ok(fileURLToPath(url).startsWith(join(skill, 'node_modules') + (process.platform === 'win32' ? '\\' : '/')), '依赖解析到了解压包之外');
  console.log('3/3 严格构建文字、图片、SVG、原生图表和表格');
  const work = join(temp, '验收输入'), output = join(temp, '验收输出');
  await mkdir(work);
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await writeFile(join(work, 'asset.png'), Buffer.from(pixel.split(',')[1], 'base64'));
  const input = join(work, 'acceptance.json');
  const deck = { style: 'clean-minimal', slides: [{ notes: 'Packaged runtime acceptance', elements: [
    { elType: 'text', text: '发布包验收', x: 80, y: 60, width: 800, height: 60, fontSize: 32 },
    { elType: 'image', path: 'asset.png', x: 80, y: 160, width: 100, height: 100 },
    { elType: 'image-svg', x: 230, y: 160, width: 100, height: 100, svgXml: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="45" fill="#2468ac"/></svg>' },
    { elType: 'chart', chartType: 'bar', x: 500, y: 160, width: 600, height: 300, labels: ['A', 'B'], data: [{ name: 'Revenue', values: [10, 20] }] },
    { elType: 'table', x: 80, y: 500, width: 500, height: 100, rows: [['季度', '收入'], ['Q1', '10']] },
  ] }] };
  await writeFile(input, JSON.stringify(deck));
  await run(join(skill, 'tools/build_all.mjs'), [input, '-o', output, ...(options.checkBrowser ? ['--check-browser'] : [])], skill);
  const report = JSON.parse(await readFile(join(output, 'acceptance.report.json'), 'utf8'));
  assert.equal(report.summary.failed, 0); assert.equal(report.summary.skipped, 0);
  assert.equal(report.summary.editable, 3); assert.equal(report.summary.rasterized, 2);
  const pptx = await JSZip.loadAsync(await readFile(join(output, 'acceptance.pptx')));
  const slide = await pptx.file('ppt/slides/slide1.xml').async('string');
  assert.ok(slide.includes('发布包验收')); assert.ok(slide.includes('<a:tbl>'));
  assert.ok(pptx.file('ppt/charts/chart1.xml'));
  const build = JSON.parse(await readFile(join(output, 'acceptance.build.json'), 'utf8'));
  for (const [file, hash] of Object.entries(build.artifacts)) assert.equal(sha256(await readFile(join(output, file))), hash);
  const preview = await readFile(join(output, 'acceptance.preview.html'), 'utf8');
  const scene = JSON.parse(preview.match(/let DECK = (.*);/)[1]);
  assert.ok(scene.slides[0].elements.find(el => el.elType === 'image')._data.startsWith('data:image/png;base64,'));
  verification = { ...verification, ok: true, browserChecked: build.browserChecked, summary: report.summary };
  console.log('✅ 解压安装与构建验收通过');
} catch (error) {
  verification.error = error.message;
  console.error(`❌ 发布包验收失败: ${error.message}`);
  process.exitCode = 1;
} finally {
  const reportPath = options.input + '.verify.json';
  try {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(verification, null, 2) + '\n');
    console.log(`验收报告: ${reportPath}`);
  } catch (error) {
    console.error(`验收报告写入失败: ${error.message}`);
    process.exitCode = 1;
  }
  if (temp) {
    try {
      // Only remove the absolute directory exclusively allocated by this invocation.
      assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
      assert.ok(basename(temp).startsWith('ppt-package-check-'));
      await rm(temp, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      console.error(`验收临时目录清理失败: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
