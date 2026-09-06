#!/usr/bin/env node
/** Render constrained WebSlide HTML in Chromium/Edge and extract computed layout to deck.json. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dumpDOM, findBrowser } from './lib/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { input: null, output: null, browser: null, theme: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a === '--browser') args.browser = argv[++i];
    else if (a === '--theme') args.theme = argv[++i];
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.input || process.argv.includes('--help')) {
  console.log('用法: node tools/html_to_deck.mjs slides.html [-o deck.json] [--theme clean-minimal] [--browser path]');
  process.exit(args.input ? 0 : 2);
}

const input = resolve(args.input);
const output = resolve(args.output || input.replace(/\.html?$/i, '') + '.deck.json');
let browser;
try { browser = findBrowser(args.browser); }
catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

const sourceHtml = await readFile(input, 'utf-8');
const extractor = (await readFile(resolve(here, '../core/webslide-extract.js'), 'utf-8')).replace(/<\/script/gi, '<\\/script');
const base = pathToFileURL(dirname(input) + '/').href;
const themeArg = JSON.stringify(args.theme || '');
const injection = `
<script>${extractor}</script>
<script>
window.addEventListener('load', async () => {
  try {
    const deck = await WebSlideExtract.extractDeck({ theme: ${themeArg} || undefined });
    const payload = encodeURIComponent(JSON.stringify(deck));
    document.documentElement.innerHTML = '<body><pre id="__PPT_DECK__">' + payload + '</pre></body>';
  } catch (e) {
    document.documentElement.innerHTML = '<body><pre id="__PPT_ERROR__">' + encodeURIComponent(e.stack || e.message) + '</pre></body>';
  }
});
</script>`;
const withBase = /<base\b/i.test(sourceHtml)
  ? sourceHtml
  : /<head\b[^>]*>/i.test(sourceHtml)
    ? sourceHtml.replace(/<head\b[^>]*>/i, match => `${match}\n<base href="${base}">`)
    : `<base href="${base}">\n${sourceHtml}`;
const html = /<\/head>/i.test(withBase)
  ? withBase.replace(/<\/head>/i, injection + '\n</head>')
  : injection + withBase;

const tempDir = await mkdtemp(join(tmpdir(), 'webslide-'));
const tempHtml = join(tempDir, basename(input));
try {
  await writeFile(tempHtml, html, 'utf-8');
  const { stdout, stderr } = await dumpDOM(pathToFileURL(tempHtml).href, { browser });
  const err = stdout.match(/<pre id="__PPT_ERROR__">([^<]*)<\/pre>/i);
  if (err) throw new Error(decodeURIComponent(err[1]));
  const match = stdout.match(/<pre id="__PPT_DECK__">([^<]*)<\/pre>/i);
  if (!match) throw new Error(`浏览器没有返回 deck 数据${stderr ? `：${stderr.slice(0, 300)}` : ''}`);
  const deck = JSON.parse(decodeURIComponent(match[1]));
  await writeFile(output, JSON.stringify(deck, null, 2), 'utf-8');
  const unsupported = deck.slides.flatMap(s => s.elements || []).filter(e => e.webUnsupported?.length);
  console.log(`✅ 已提取 ${output}（${deck.slides.length} 页，${deck.slides.reduce((n, s) => n + s.elements.length, 0)} 个元素）`);
  if (unsupported.length) console.warn(`⚠️  ${unsupported.length} 个元素包含 PowerPoint 无等价实现的 CSS；运行 check_deck 查看详情`);
} catch (err) {
  console.error(`❌ HTML 提取失败: ${err.message}`);
  process.exitCode = 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
