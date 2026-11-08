import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { supportsNode } from '../tools/environment.mjs';
import { createSkillArchive, inspectSkillArchive, isPackageFile, sha256 } from '../tools/skill-package.mjs';
import { findNpmCli } from '../tools/npm-cli.mjs';
import { checkRepoLayout } from '../tools/repo-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'ppt-tooling-test-'));
const exec = promisify(execFile);
try {
  for (const [version, expected] of [['18.20.0', false], ['20.8.9', false], ['20.9.0', true], ['20.10.0', true], ['22.0.0', true], ['invalid', false]]) assert.equal(supportsNode(version, '20.9.0'), expected);
  for (const path of ['.venv/bin/python', 'node_modules/jszip/index.js', 'tests/fixture-deck.mjs', 'examples/report.pptx', '测试数据/input.pptx', 'docs/releasing.md', 'tools/verify_package.mjs', 'core/.secret.js', '../SKILL.md', 'core/nested/module.mjs', 'references/nested/notes.md', 'tools/lib/browser.mjs']) assert.equal(isPackageFile(path), false, path);
  const sourceTree = join(temp, 'source-layout');
  await mkdir(join(sourceTree, 'tools'), { recursive: true });
  await mkdir(join(sourceTree, 'node_modules/package/internal'), { recursive: true });
  await mkdir(join(sourceTree, '.git/objects/internal'), { recursive: true });
  assert.equal((await checkRepoLayout(sourceTree)).maxDirectoryDepth, 2);
  await mkdir(join(sourceTree, 'tools/nested'));
  await assert.rejects(() => checkRepoLayout(sourceTree), /目录层级超限.*tools\/nested/);
  await assert.rejects(() => createSkillArchive(sourceTree), /目录层级超限/);
  const first = await createSkillArchive(root), second = await createSkillArchive(root);
  assert.deepEqual(first.bytes, second.bytes, 'unchanged sources must yield reproducible archives');
  const { contents, manifest, layout } = await inspectSkillArchive(first.bytes);
  assert.deepEqual(layout, { root: manifest.name, maxDirectoryDepth: 2 });
  const archiveEntries = Object.keys((await JSZip.loadAsync(first.bytes)).files);
  assert.ok(archiveEntries.every(path => path.split('/').length <= 3), 'market package must have only root/resource-directory/file');
  assert.ok(contents.has('tools/browser.mjs'));
  assert.ok(contents.has('tools/browser-bundle.mjs'));
  assert.ok(contents.has('tools/environment.mjs'));
  const packaged = JSON.parse(contents.get('package.json'));
  assert.equal(packaged.version, manifest.version);
  assert.ok(packaged.scripts.doctor);
  assert.equal(packaged.scripts.test, undefined, 'release scripts cannot point to omitted files');
  assert.equal(contents.has('examples/report.pptx'), false);
  const tampered = await JSZip.loadAsync(first.bytes);
  tampered.file(`${manifest.name}/core/source-edit.mjs`, 'tampered');
  await assert.rejects(() => inspectSkillArchive(tampered.generateAsync({ type: 'nodebuffer' })), /SHA-256/);
  const extra = await JSZip.loadAsync(first.bytes);
  extra.file(`${manifest.name}/.venv/secret`, 'unexpected');
  await assert.rejects(() => inspectSkillArchive(extra.generateAsync({ type: 'nodebuffer' })), /白名单/);

  // Reproduce the actual marketplace rejection, including empty nested directories.
  const nested = await JSZip.loadAsync(first.bytes);
  nested.file(`${manifest.name}/tools/lib/browser.mjs`, 'nested runtime', { createFolders: false });
  await assert.rejects(() => inspectSkillArchive(nested.generateAsync({ type: 'nodebuffer' })), /目录层级超限/);
  const nestedDirectory = await JSZip.loadAsync(first.bytes);
  nestedDirectory.folder(`${manifest.name}/tools/lib`);
  await assert.rejects(() => inspectSkillArchive(nestedDirectory.generateAsync({ type: 'nodebuffer' })), /目录层级超限/);
  const brokenImport = await JSZip.loadAsync(first.bytes);
  const badModule = "import './missing.mjs';\n";
  brokenImport.file(`${manifest.name}/tools/doctor.mjs`, badModule);
  const brokenManifest = structuredClone(manifest);
  brokenManifest.files['tools/doctor.mjs'] = sha256(badModule);
  brokenImport.file(`${manifest.name}/package-manifest.json`, JSON.stringify(brokenManifest));
  await assert.rejects(() => inspectSkillArchive(brokenImport.generateAsync({ type: 'nodebuffer' })), /模块引用未打包/);

  // Verify both common installation layouts, regardless of the test host's OS.
  for (const [name, suffix] of [['windows', 'node_modules/npm/bin/npm-cli.js'], ['unix', 'lib/node_modules/npm/bin/npm-cli.js']]) {
    const prefix = join(temp, name);
    const cli = join(prefix, suffix);
    await mkdir(dirname(cli), { recursive: true });
    await writeFile(cli, '// npm fixture');
    const nodePath = name === 'unix' ? join(prefix, 'bin/node') : join(prefix, 'node.exe');
    assert.equal(await findNpmCli({ nodePath, npmExecPath: null, searchPath: '' }), cli);
  }

  // Preflight must run and diagnose missing packages before any npm install.
  const clean = join(temp, 'clean');
  await mkdir(join(clean, 'tools'), { recursive: true });
  for (const path of ['package.json', 'tools/doctor.mjs', 'tools/environment.mjs', 'tools/browser.mjs']) await copyFile(join(root, path), join(clean, path));
  const run = args => exec(process.execPath, args, { windowsHide: true, timeout: 10000, env: { ...process.env, NODE_PATH: '' } });
  const expectFailure = async args => {
    try { await run(args); }
    catch (error) {
      if (error.code === 'EPERM' && !error.stdout) throw error;
      assert.equal(error.code, 1);
      return error;
    }
    assert.fail('command unexpectedly succeeded');
  };
  try {
    const failure = await expectFailure([join(clean, 'tools/doctor.mjs'), '--json', '--require-svg']);
    const diagnosed = JSON.parse(failure.stdout);
    assert.equal(diagnosed.ok, false);
    for (const id of ['jszip', 'pptxgenjs', 'svg']) assert.equal(diagnosed.checks.find(check => check.id === id).status, 'error', `${id}: missing dependency must be explicit`);

    const missing = join(temp, 'missing-parent', 'missing.zip');
    await expectFailure([join(root, 'tools/verify_package.mjs'), missing]);
    const missingReport = JSON.parse(await readFile(missing + '.verify.json', 'utf8'));
    assert.equal(missingReport.ok, false);
    assert.match(missingReport.error, /ENOENT/);
    const blocked = join(temp, 'not-a-directory');
    await writeFile(blocked, 'file');
    const blockedFailure = await expectFailure([join(root, 'tools/verify_package.mjs'), join(blocked, 'missing.zip')]);
    assert.match(blockedFailure.stderr, /发布包验收失败/);
    assert.match(blockedFailure.stderr, /验收报告写入失败/);
    assert.doesNotMatch(blockedFailure.stderr, /triggerUncaughtException/);

    const archive = join(temp, 'release.zip');
    await writeFile(archive + '.verify.json', JSON.stringify({ ok: true }));
    await run([join(root, 'tools/package_skill.mjs'), '-o', archive]);
    await access(archive);
    await assert.rejects(() => access(archive + '.verify.json'), { code: 'ENOENT' });
  } catch (error) {
    if (error.code === 'EPERM' && !error.stdout) console.warn('⚠️ skip child-process tooling checks: spawn EPERM; release verification still requires a permissive environment');
    else throw error;
  }
  console.log('✅ environment and release packaging passed (two-level layout, import closure, clean install diagnostics, allowlist, hashes, reproducibility)');
} finally {
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
  assert.ok(basename(temp).startsWith('ppt-tooling-test-'));
  await rm(temp, { recursive: true, force: true, maxRetries: 3 });
}
