#!/usr/bin/env node
import { checkEnvironment } from './environment.mjs';

const argv = process.argv.slice(2);
const usage = '用法: node tools/doctor.mjs [--json] [--require-svg] [--require-browser] [--browser path]';
if (argv.includes('--help')) { console.log(usage); process.exit(0); }
const options = {};
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--json') options.json = true;
  else if (arg === '--require-svg') options.requireSvg = true;
  else if (arg === '--require-browser') options.requireBrowser = true;
  else if (arg === '--browser' && argv[i + 1] && !argv[i + 1].startsWith('-')) options.browser = argv[++i];
  else { console.error(`参数无效: ${arg}\n${usage}`); process.exit(2); }
}
try {
  const result = await checkEnvironment(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`ppt-gen ${result.version} 环境预检（${result.platform}/${result.arch}）`);
    for (const check of result.checks) console.log(`${{ ok: '✅', warning: '⚠️', error: '❌' }[check.status]} ${check.message}`);
    console.log(result.ok ? '基础环境可用；按当前任务处理可选能力提示。' : '环境不满足要求，请处理错误后重跑。');
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) { console.error(`环境预检失败: ${error.message}`); process.exitCode = 1; }
