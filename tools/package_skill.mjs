#!/usr/bin/env node
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillArchive, sha256 } from './skill-package.mjs';

const argv = process.argv.slice(2);
const usage = '用法: node tools/package_skill.mjs [-o output.zip]';
if (argv.includes('--help')) { console.log(usage); process.exit(0); }
let output;
for (let i = 0; i < argv.length; i++) {
  if (['-o', '--output'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('-')) output = argv[++i];
  else { console.error(`参数无效: ${argv[i]}\n${usage}`); process.exit(2); }
}
try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { bytes, manifest, layout } = await createSkillArchive(root);
  const path = resolve(output || resolve(root, 'dist', `${manifest.name}-${manifest.version}.zip`));
  await mkdir(dirname(path), { recursive: true });
  // A new archive requires a fresh verification even when the filename is reused.
  await rm(path + '.verify.json', { force: true });
  await writeFile(path, bytes);
  await writeFile(path + '.sha256', sha256(bytes) + '\n');
  console.log(`✅ 发布包: ${path}\n${Object.keys(manifest.files).length} 个运行文件；${bytes.length} 字节；最多 ${layout.maxDirectoryDepth} 级目录\nSHA-256: ${sha256(bytes)}`);
} catch (error) { console.error(`打包失败: ${error.message}`); process.exitCode = 1; }
