import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function findBrowser(explicit) {
  const paths = [explicit, process.env.PPT_BROWSER];
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.LOCALAPPDATA]) {
      if (root) paths.push(join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else if (process.platform === 'darwin') paths.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  else paths.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  const browser = paths.filter(Boolean).find(existsSync);
  if (!browser) throw new Error('未找到 Chrome/Edge；用 --browser 或 PPT_BROWSER 指定浏览器');
  return browser;
}

export async function dumpDOM(url, { browser, budget = 10000 } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'ppt-browser-'));
  try {
    return await exec(findBrowser(browser), [
      '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', '--window-size=1400,900', `--user-data-dir=${profile}`,
      `--virtual-time-budget=${budget}`, '--dump-dom', url,
    ], { maxBuffer: 100 * 1024 * 1024, windowsHide: true, timeout: 45000 });
  } finally {
    // profile is exclusively owned by this invocation, created by mkdtemp above.
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
