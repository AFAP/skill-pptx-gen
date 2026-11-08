/** One allowlist for creating and inspecting the marketplace runtime package. */
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join, posix } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const files = new Set([
  'SKILL.md', 'package.json', 'package-lock.json',
  'assets/konva.10.0.12.min.js', 'assets/pptxgen.4.0.1.js', 'assets/logo.png',
  ...['build_all', 'build_pptx', 'check_deck', 'check_preview', 'html_to_deck', 'make_preview', 'doctor'].map(name => `tools/${name}.mjs`),
  ...['browser', 'browser-bundle', 'environment'].map(name => `tools/lib/${name}.mjs`),
]);
const trees = { core: new Set(['.mjs', '.js']), references: new Set(['.md', '.json']) };
const runtimeScripts = new Set(['check', 'build', 'build:all', 'html', 'preview', 'doctor']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function isPackageFile(path) {
  if (path.includes('\\') || path.startsWith('/') || path.split('/').some(part => !part || part.startsWith('.'))) return false;
  if (files.has(path)) return true;
  return Object.entries(trees).some(([dir, extensions]) => path.startsWith(`${dir}/`) && extensions.has(posix.extname(path)));
}

async function readRegularFile(root, path) {
  const file = join(root, path), stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`发布文件必须是普通文件: ${path}`);
  return readFile(file);
}

export async function createSkillArchive(root) {
  root = resolve(root);
  const paths = new Set(files);
  const walk = async (directory, path) => {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`发布目录不接受符号链接: ${child}`);
      if (entry.isDirectory()) await walk(directory, child);
      else if (isPackageFile(child)) paths.add(child);
    }
  };
  for (const tree of Object.keys(trees)) await walk(tree, tree);
  const payload = new Map();
  for (const path of [...paths].sort()) payload.set(path, await readRegularFile(root, path));
  const pkg = JSON.parse(payload.get('package.json'));
  pkg.scripts = Object.fromEntries(Object.entries(pkg.scripts).filter(([name]) => runtimeScripts.has(name)));
  payload.set('package.json', Buffer.from(JSON.stringify(pkg, null, 2) + '\n'));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pkg.name)) throw new Error('技能名称不适合作为 ZIP 根目录');
  const manifest = { formatVersion: 1, name: pkg.name, version: pkg.version,
    files: Object.fromEntries([...payload].map(([path, bytes]) => [path, sha256(bytes)])) };
  const zip = new JSZip();
  const options = { date: new Date('2000-01-01T00:00:00Z'), createFolders: false, unixPermissions: 0o100644 };
  for (const [path, bytes] of payload) zip.file(`${pkg.name}/${path}`, bytes, options);
  zip.file(`${pkg.name}/package-manifest.json`, JSON.stringify(manifest, null, 2) + '\n', options);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
  await inspectSkillArchive(bytes);
  return { bytes, manifest };
}

export async function inspectSkillArchive(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const contents = new Map();
  let root;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const path = entry.name;
    if (entry.unsafeOriginalName !== path || path.includes('\\') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`ZIP 路径非法: ${path}`);
    if ((Number(entry.unixPermissions) & 0o170000) === 0o120000) throw new Error(`ZIP 不接受符号链接: ${path}`);
    const [prefix, ...parts] = path.split('/');
    root ??= prefix;
    const relative = parts.join('/');
    if (root !== prefix || (relative !== 'package-manifest.json' && !isPackageFile(relative))) throw new Error(`ZIP 包含白名单外文件: ${path}`);
    contents.set(relative, await entry.async('nodebuffer'));
  }
  if (!contents.has('package-manifest.json')) throw new Error('ZIP 缺少 package-manifest.json');
  const manifest = JSON.parse(contents.get('package-manifest.json'));
  if (manifest.formatVersion !== 1 || manifest.name !== root || !manifest.files || typeof manifest.files !== 'object') throw new Error('发布清单无效');
  const payload = new Map(contents); payload.delete('package-manifest.json');
  if (payload.size !== Object.keys(manifest.files).length) throw new Error('ZIP 文件数与清单不符');
  for (const path of files) if (!payload.has(path)) throw new Error(`ZIP 缺少运行文件: ${path}`);
  for (const [path, data] of payload) if (manifest.files[path] !== sha256(data)) throw new Error(`SHA-256 不匹配: ${path}`);
  const pkg = JSON.parse(payload.get('package.json')), lock = JSON.parse(payload.get('package-lock.json'));
  const skill = payload.get('SKILL.md').toString('utf8');
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1];
  if (!header) throw new Error('SKILL.md 缺少 frontmatter');
  for (const key of ['name', 'version', 'display_name', 'display_name_en', 'description', 'description_zh', 'description_en', 'author', 'examples_zh', 'examples_en']) {
    if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(header) && !new RegExp(`^${key}:\\s*\\r?\\n +-[ ]`, 'm').test(header)) throw new Error(`缺少市场字段: ${key}`);
  }
  const skillVersion = /^version:\s*["']?([^\s"']+)/m.exec(header)?.[1];
  const skillName = /^name:\s*["']?([^\s"']+)/m.exec(header)?.[1];
  if (pkg.name !== root || skillName !== root || pkg.version !== manifest.version || skillVersion !== pkg.version || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('技能、package、lock 与清单版本不一致');
  if (lock.packages[''].engines?.node !== pkg.engines?.node) throw new Error('Node 版本要求不一致');
  for (const path of payload.keys()) {
    if (!path.endsWith('.md')) continue;
    const markdown = payload.get(path).toString('utf8');
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const linked = posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(target)));
      if (!payload.has(linked)) throw new Error(`文档引用未打包: ${path} → ${target}`);
    }
  }
  return { manifest, contents };
}
