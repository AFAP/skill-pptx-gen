# WorkBuddy 市场发布

从仓库根目录运行。运行环境统一为 Node.js ≥20.9.0；版本号须同时更新 `SKILL.md`、`package.json`、`package-lock.json` 顶层和根包信息。

## 验证与打包

```bash
npm ci --include=optional
npm run check:layout
npm run doctor -- --require-svg --require-browser
npm test
npm run test:browser
npm run release:pack -- -o dist/ppt-gen.zip
npm run release:verify -- dist/ppt-gen.zip --check-browser
```

没有 Chrome/Edge 的构建机可省去浏览器测试及 `--check-browser`，验收报告会记录 `browserChecked:false`。发布验收始终要求 SVG 实测成功；普通用户只做无 SVG 的稿件时可以不安装 sharp。`PPT_BROWSER` 可指定浏览器，验收命令也支持 `--browser <路径>`。

`release:verify` 在系统临时目录解压 ZIP，重新联网执行 `npm ci --include=optional`，确认三个依赖都解析到解压包自己的 `node_modules`，再实测环境并从中文路径构建包含文字、相对路径 PNG、SVG、原生图表和表格的稿件。构建报告必须无失败、无跳过，OOXML 必须包含正文、表格和图表，并核对产物哈希。临时安装及验收产物结束后清理，不借用开发目录的依赖。

成功的发布产物：

- `dist/ppt-gen.zip`：以上命令生成的技能包，唯一根目录 `ppt-gen/`。不指定 `-o` 时默认文件名为 `ppt-gen-<当前版本>.zip`。
- `*.zip.sha256`：ZIP 的 SHA-256。
- `*.zip.verify.json`：验收结果、被验收 ZIP 的 SHA-256、环境诊断、浏览器检查状态及转换计数。失败同样尝试写入报告；报告目录无法写入时保留原始诊断、单独报告写入失败，并继续清理临时目录。
- ZIP 内 `package-manifest.json`：技能版本及逐文件 SHA-256。

源码改变后必须重新打包和验收。相同文件内容生成相同 ZIP（固定归档时间）；重新打包会先清除同名旧验收报告。验收报告里的 `ok:true` 和 ZIP 哈希必须匹配准备上传的文件。

验收也可直接运行 `node tools/verify_package.mjs <ZIP 路径>`。npm 定位依次考虑 npm 提供的入口、Node 安装目录、Unix 的 `lib/node_modules` 布局和 PATH 上的 npm 链接；找不到时给出安装 npm 或改用 `npm run release:verify` 的提示。

## 白名单范围

`tools/skill-package.mjs` 同时定义打包和验包白名单：

- `SKILL.md`、`package.json`、锁文件。
- `core/` 中的 `.mjs`/`.js`、`references/` 中的 `.md`/`.json`。
- 运行命令和所需的浏览器、环境预检工具库。
- 两个离线浏览器运行库及技能 Logo。

仓库与市场包采用相同的低层级结构：根目录下的资源目录都直接放文件，不再嵌套。运行及发布辅助模块统一放在 `tools/`；测试输入为 `tests/fixture-deck.mjs`、`tests/fixture-webslide.html`；示例图片直接放在 `examples/`。发布工具与测试仍按白名单排除，不通过移动目录改变打包范围。

`npm run check:layout` 检查仓库结构，`npm test` 与打包也会先执行该检查。Git 元数据等隐藏目录，以及 `node_modules/`、`dist/`、`output/` 等依赖和产物目录不属于维护文件的层级约束。

```text
ppt-gen/
├── SKILL.md
├── package.json
├── package-lock.json
├── package-manifest.json
├── core/          （直接放 .mjs/.js 文件）
├── tools/         （命令与运行时辅助文件平铺）
├── references/    （直接放 .md/.json 文件）
└── assets/        （运行库与 Logo）
```

官方技能结构示例见下方链接；两级深度限制同时以平台实际返回的“目录层级超限”错误为依据。打包、验包都会拒绝超深文件和空目录，并检查运行模块的相对 import 是否全部包含在 ZIP 中。验收报告的 `layout.maxDirectoryDepth` 记录实际目录级数。通过本地门禁后仍须提交平台解析，不能把本地运行验收等同于市场解析通过。

不打包 `.git/`、`.venv/`、`node_modules/`、测试材料、展示成品、历史截图、开发文档和发布工具。发布包中的 `package.json` 只保留实际随包提供的运行命令。开发仓库的 README 保留展示案例与维护说明，运行说明从技能入口按需路由到参考文件。

打包时检查市场必需字段、中英文使用案例、版本/Node 声明、两级目录结构、运行文件及相对导入完整性、文档本地链接和逐文件哈希。ZIP 路径或文件超出白名单、符号链接和哈希不符均拒绝验收。市场结构示例及字段参见 [WorkBuddy 官方技能规范](https://open.workbuddy.cn/docs/skill)。
