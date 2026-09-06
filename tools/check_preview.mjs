#!/usr/bin/env node
/** Execute generated previews in Chromium. Optionally export every Konva slide as PNG. */
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dumpDOM } from './lib/browser.mjs';

const argv = process.argv.slice(2);
if (!argv[0] || argv.includes('--help')) {
  console.log('用法: node tools/check_preview.mjs preview.html [--json] [--screenshots output-dir] [--browser path]');
  process.exit(argv.includes('--help') ? 0 : 2);
}
const option = key => argv.includes(key) ? argv[argv.indexOf(key) + 1] : null;
const input = resolve(argv[0]);
const temp = await mkdtemp(join(tmpdir(), 'ppt-preview-check-'));
try {
  let html = await readFile(input, 'utf8');
  // Preserve relative assets when the preview was generated without embedding images.
  if (!/<base\b/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}<base href="${pathToFileURL(dirname(input) + '/').href}">`);
  const instrument = `<script>
  (async () => {
    const result = { ok: false, errors: [], warnings: [], slides: 0 };
    try {
      if (!window.PPT_PREVIEW_READY) throw new Error('请用当前 make_preview 重新生成预览');
      await window.PPT_PREVIEW_READY;
      result.slides = stages.length;
      for (const diagnostic of previewDiagnostics) result[diagnostic.severity === 'error' ? 'errors' : 'warnings'].push(diagnostic);
      if (${Boolean(option('--screenshots'))}) {
        PptPreview.applyZoom(stages, 1);
        result.images = stages.map(({stage}) => stage.toDataURL({ pixelRatio: 1 }));
      }
      result.ok = result.errors.length === 0;
    } catch (error) { result.errors.push({ message: error.message }); }
    const pre = document.createElement('pre'); pre.id = '__PPT_CHECK__';
    pre.textContent = encodeURIComponent(JSON.stringify(result)); document.body.appendChild(pre);
  })();</script>`;
  html = html.replace('</body>', instrument + '</body>');
  const file = join(temp, 'preview.html');
  await writeFile(file, html);
  const { stdout, stderr } = await dumpDOM(pathToFileURL(file).href, { browser: option('--browser'), budget: 20000 });
  const match = stdout.match(/<pre id="__PPT_CHECK__">([^<]*)<\/pre>/);
  if (!match) throw new Error('浏览器未返回检查结果: ' + stderr.slice(-400));
  const result = JSON.parse(decodeURIComponent(match[1]));
  if (result.images) {
    const dir = resolve(option('--screenshots')); await mkdir(dir, { recursive: true });
    for (const [index, data] of result.images.entries()) await writeFile(join(dir, `slide-${String(index + 1).padStart(2, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
    delete result.images;
  }
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.ok ? '✅' : '❌'} 预览实测：${result.slides} 页，${result.errors.length} 错误，${result.warnings.length} 告警`);
    for (const item of [...result.errors, ...result.warnings]) console.log(`${item.sourcePath || ''} ${item.message}`);
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
