/** Bundle our named-export, dependency-free ESM core without a runtime CDN/build dependency. */
import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';

export async function browserBundle(root, entries) {
  const modules = new Map();
  const visit = async path => {
    const key = relative(root, path).replaceAll('\\', '/');
    if (modules.has(key)) return key;
    let source = await readFile(path, 'utf8');
    const imports = [...source.matchAll(/^import\s+(\{[^}]+\})\s+from\s+['"]([^'"]+)['"];?\s*$/gm)];
    for (const match of imports) {
      if (!match[2].startsWith('.')) throw new Error(`浏览器核心不能依赖 Node/三方模块: ${match[2]}`);
      const dependency = await visit(resolve(dirname(path), match[2]));
      source = source.replace(match[0], `const ${match[1].replace(/\bas\b/g, ':')} = __pptModules[${JSON.stringify(dependency)}];`);
    }
    const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(m => m[1]);
    source = source.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class))/gm, '');
    if (/^(?:import|export)\s/m.test(source)) throw new Error(`未支持的浏览器模块语法: ${key}`);
    modules.set(key, `__pptModules[${JSON.stringify(key)}] = (() => {\n${source}\nreturn { ${names.join(', ')} };\n})();`);
    return key;
  };
  for (const entry of entries) await visit(resolve(root, entry));
  return 'const __pptModules = Object.create(null);\n' + [...modules.values()].join('\n');
}
