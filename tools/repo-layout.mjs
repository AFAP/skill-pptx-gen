/** Keep maintained project directories as flat as the marketplace package. */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const generatedDirectories = new Set(['node_modules', '.venv', '.npm-cache', 'dist', 'output']);

export async function checkRepoLayout(root) {
  const directories = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || generatedDirectories.has(entry.name)) continue;
    directories.push(entry.name);
    for (const child of await readdir(join(root, entry.name), { withFileTypes: true })) {
      if (child.isDirectory() || child.isSymbolicLink()) throw new Error(`目录层级超限: ${entry.name}/${child.name}；仓库维护文件应直接放在一级资源目录内`);
    }
  }
  return { maxDirectoryDepth: directories.length ? 2 : 1, directories: directories.sort() };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const layout = await checkRepoLayout(fileURLToPath(new URL('../', import.meta.url)));
    console.log(`✅ 仓库目录检查通过：${layout.directories.join(', ')} 均无嵌套子目录`);
  } catch (error) { console.error(`❌ ${error.message}`); process.exitCode = 1; }
}
