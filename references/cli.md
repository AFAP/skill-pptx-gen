# 命令与预览编辑

需要单步构建、调整参数或继续修改预览时读取。命令在技能目录执行；图片相对路径默认以源 deck 所在目录为基准。

## 常用命令

```bash
node tools/doctor.mjs --json
node tools/doctor.mjs --require-svg --require-browser
node tools/check_deck.mjs deck.json --json
node tools/make_preview.mjs deck.json -o preview.html
node tools/build_pptx.mjs deck.json -o out.pptx --report out.report.json
node tools/check_preview.mjs preview.html --json --screenshots output/slides
```

常规交付优先 `node tools/build_all.mjs deck.json -o output`；它总是先校验，并在全部成功后更新整套产物。

| 参数 | 作用 |
| --- | --- |
| `--base-dir <目录>` | 单步预览/构建的资源路径基准；`build_all` 自动使用原 deck 目录 |
| `--scale 0.75` | 预览显示比例，不改变画布或导出 |
| `make_preview --no-edit` | 纯审阅预览 |
| `make_preview --no-embed-images` | 预览不内嵌图片，依赖原路径可访问 |
| `build_all --check-browser` | 把真实浏览器预览检查纳入严格构建 |
| `html_to_deck --theme <名称>` | 提取主题；未指定且页面也未声明时使用 `clean-minimal` |
| `--browser <路径>` / 环境变量 `PPT_BROWSER` | 为 doctor、HTML 提取、预览检查指定 Chrome/Edge；`build_all` 使用环境变量 |
| `build_pptx --skip-images` | 跳过图片预取，仅调试，缺图记为失败 |
| `build_pptx --no-validate` | 仅定位构建问题；不能当作修复，`build_all` 不提供此参数 |

`--allow-partial` 仅限用户明确接受的不完整调试输出。

## 预览改字闭环

1. 打开 `*.preview.html`，双击可回写文字修改，导出 PPTX 或下载新 `deck.json`。
2. 源字段类型不变；数字、布尔值必须合法。重新编译会刷新依赖该字段的文字和几何，失败则回滚。
3. `repeat` 中直接绑定 `{{field}}`、`{{value}}` 的文字可以回写；序号、固定模板文字和混合插值没有唯一源字段，只读。
4. 普通图片仅改变显示尺寸时沿用已内嵌资源；SVG 栅格缓存按源与尺寸校验。
5. 下载稿保留原始主题令牌、版式和宏，但不会连同外部资源打包。继续构建时替换原位置源文件，或使用有效 `--base-dir`；需要跨目录携带时同时复制图片资源。
6. 浏览器不会静默覆盖原文件。继续迭代使用下载稿，不把生成的 HTML 重新喂给模型，也不直接改编译稿。
