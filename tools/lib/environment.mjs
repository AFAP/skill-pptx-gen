/** Dependency-free preflight: still runs when npm dependencies are missing. */
import { readFile } from 'node:fs/promises';
import { findBrowser, dumpDOM } from './browser.mjs';

export function supportsNode(version, minimum) {
  const parse = value => /^(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const current = parse(version), required = parse(minimum);
  if (!current || !required) return false;
  for (let i = 0; i < 3; i++) {
    if (current[i] !== required[i]) return current[i] > required[i];
  }
  return true;
}

export async function checkEnvironment({ requireBrowser = false, requireSvg = false, browser } = {}) {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const minimum = pkg.engines.node.replace(/^>=/, '');
  const checks = [];
  const add = (id, required, ok, message) => checks.push({ id, required, status: ok ? 'ok' : required ? 'error' : 'warning', message });
  add('node', true, supportsNode(process.versions.node, minimum), `Node ${process.versions.node}；要求 ${pkg.engines.node}`);
  for (const name of ['jszip', 'pptxgenjs']) {
    try {
      const module = await import(name);
      if (typeof module.default !== 'function') throw new Error('模块导出不可用');
      // Construction catches incomplete installations as well as missing packages.
      new module.default();
      add(name, true, true, `${name} 可加载`);
    } catch (error) { add(name, true, false, `${name} 不可用：${error.message}；请在技能目录执行 npm ci`); }
  }
  try {
    const sharp = (await import('sharp')).default;
    const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')).png().toBuffer();
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('SVG 未生成有效 PNG');
    add('svg', requireSvg, true, 'sharp 已通过 SVG → PNG 实测');
  } catch (error) { add('svg', requireSvg, false, `SVG 转换不可用：${error.message}；需要 SVG 时执行 npm ci --include=optional`); }
  try {
    const executable = findBrowser(browser);
    if (requireBrowser) {
      const { stdout } = await dumpDOM('data:text/html,<p id="ppt-doctor">ready</p>', { browser: executable, budget: 1000 });
      if (!stdout.includes('id="ppt-doctor">ready')) throw new Error('浏览器未返回预检页面');
    }
    add('browser', requireBrowser, true, `${requireBrowser ? '已实测启动' : '已找到（未启动）'} ${executable}`);
  } catch (error) { add('browser', requireBrowser, false, `${error.message}；需要 WebSlide/预览实测时配置 PPT_BROWSER 或 --browser`); }
  return { ok: checks.every(check => check.status !== 'error'), version: pkg.version, platform: process.platform, arch: process.arch, checks };
}
