# 故障排查

遇到构建失败、能力降级或环境缺失时读取。先修源文件或环境，再重新运行严格构建；不要用 `--no-validate` 或 `--allow-partial` 掩盖最终交付问题。

| 现象或报错 | 原因 | 处理方式 |
| --- | --- | --- |
| `image 仍只有 prompt` | 图片只有生成提示，没有实际资源 | 先生成图片，再填写本地 `path` 或内嵌 `data` |
| `未安装 sharp` / `image-svg` 失败 | Node 端 SVG 栅格化能力不可用 | 需要 SVG 时执行 `npm install sharp`；否则改用普通图片或可编辑 shape/path |
| `未找到 Chrome/Edge` | WebSlide 提取需要本机浏览器计算布局 | 安装 Chrome/Edge，或用 `--browser <path>` / `PPT_BROWSER` 指定可执行文件 |
| 渐变在 PPTX 中变成纯色 | primitive 渐变只能在预览中完整显示 | 改用纯色；必须保留时把无文字背景预合成为图片 |
| `text-path 不能导出` | PowerPoint 没有对应的稳定可编辑实现 | 改用普通文本；必须沿路径时转为 SVG/图片并接受栅格化 |
| `shape-path` 的 SVG data 不能导出 | PPTX 导出需要结构化 `pointArr` | 改用 `pointArr`，或使用 `image-svg` |
| `文本可能溢出` | 字数、字号、行高与容器高度不匹配 | 优先缩短文案、扩大容器或分页，不把正文缩到 12px 以下 |
| 文字对比度不足 | 浅底上误用 `$accent` 或次级灰过浅 | 浅底强调文字用 `$accentText`，普通正文用 `$text`/`$text2`；色块上用 `$onAccent` |
| 图片读取或下载失败 | 相对路径基准错误、远程资源不可达或文件过大 | 使用相对 deck 文件的有效路径，优先本地资源；检查最终报告 |
| 网页与 PPTX 换行不同 | 浏览器与 PowerPoint/WPS 字体度量不同 | 使用本机常见字体、增加文本框余量，并渲染 PPTX 复检 |
| 浏览器端导出与 CLI 不一致 | 图片未嵌入、字体或原生图表渲染器不同 | 预览使用默认嵌图；最终以 CLI 严格构建和 PPTX 实际渲染为准 |

## 最终检查

1. `node tools/check_deck.mjs deck.json --json` 无错误；canonical 交付应尽量无警告。
2. `node tools/build_all.mjs deck.json -o output` 成功。
3. `*.report.json` 中 `failed=0` 且 `skipped=0`。
4. 打开实际 PPTX 检查字体替换、文字换行、图表标签和画布边界。

