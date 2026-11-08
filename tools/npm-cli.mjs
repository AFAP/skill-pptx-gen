/** Locate npm's JavaScript entry point without assuming a Windows installation layout. */
import { realpath, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';

export async function findNpmCli({ nodePath = process.execPath, npmExecPath = process.env.npm_execpath, searchPath = process.env.PATH || '' } = {}) {
  const candidates = [npmExecPath];
  const roots = new Set([dirname(nodePath), ...searchPath.split(delimiter).filter(Boolean)]);
  try { roots.add(dirname(await realpath(nodePath))); } catch { /* Synthetic paths can be checked without a Node binary. */ }
  for (const root of roots) {
    candidates.push(join(root, 'node_modules/npm/bin/npm-cli.js'), join(root, '../lib/node_modules/npm/bin/npm-cli.js'));
    // Unix distro/Homebrew launchers commonly symlink npm to its actual JS entry point.
    try { candidates.push(await realpath(join(root, 'npm'))); } catch { /* Try the other installation layouts. */ }
  }
  for (const candidate of new Set(candidates.filter(Boolean))) {
    if (basename(candidate) !== 'npm-cli.js') continue;
    try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* Keep looking. */ }
  }
  throw new Error('未找到 npm-cli.js；请安装 npm，或通过 npm run release:verify 调用验收');
}
