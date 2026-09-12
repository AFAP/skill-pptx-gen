# 故障排查

遇到构建失败、能力降级或环境缺失时读取。先修源文件或环境，再重新运行严格构建；不要用 `--no-validate` 或 `--allow-partial` 掩盖最终交付问题。

| 现象或报错 | 原因 | 处理方式 |
| --- | --- | --- |
| `image 仍只有 prompt` | 图片只有生成提示，没有实际资源 | 先生成图片，再填写本地 `path` 或内嵌 `data` |
| `未安装 sharp` / `image-svg` 失败 | Node 端 SVG 栅格化能力不可用 | 需要 SVG 时执行 `npm install sharp`；否则改用普通图片或可编辑 shape/path |
| `未找到 Chrome/Edge` | WebSlide 提取需要本机浏览器计算布局 | 安装 Chrome/Edge，或用 `--browser <path>` / `PPT_BROWSER` 指定可执行文件 |
| Compact `不会截断内容` | 列表超过当前语义版式容量 | 按报错的源路径拆页，或转为自由构图；不可删掉超限数据来掩盖问题 |
| `未定义` 插值变量 | 字段名拼错或嵌套 repeat 的作用域不匹配 | 检查当前 item 和父级字段，见 DSL 的嵌套绑定规则 |
| 改字要求 `有限数字` / `true 或 false` | 被编辑的字段原来是数字或布尔值 | 保持原数据类型；数字不带单位，单位另作派生文字，校验失败不会保存 |
| 渐变在 PPTX 中变成纯色 | primitive 渐变只能在预览中完整显示 | 改用纯色；必须保留时把无文字背景预合成为图片 |
| `text-path 不能导出` | PowerPoint 没有对应的稳定可编辑实现 | 改用普通文本；必须沿路径时转为 SVG/图片并接受栅格化 |
| `shape-path` 的 SVG data 不能导出 | PPTX 导出需要结构化 `pointArr` | 改用 `pointArr`，或使用 `image-svg` |
| `shape-path` 选中框在上面、图形跑下面 | x/y 与 pointArr 坐标系混用，或 width/height 不是路径包围盒 | 设置 `coordinateMode:"absolute"` 让工具重算外框，或把 pointArr 改成相对 x/y 的局部坐标 |
| `文本可能溢出` / `TEXT_OVERFLOW` | 字数、字号、行高与容器高度不匹配 | 扩大容器、调整排版或分页；按语境精简但不丢事实，用 `check_preview` 实测后仍需看实际 PPTX |
| 文字对比度不足 | 浅底上误用 `$accent` 或次级灰过浅 | 浅底强调文字用 `$accentText`，普通正文用 `$text`/`$text2`；色块上用 `$onAccent` |
| 图片读取或下载失败 | 相对路径基准错误、远程资源不可达或文件过大 | 使用相对 deck 文件的有效路径，优先本地资源；检查最终报告 |
| 网页与 PPTX 换行不同 | 浏览器与 PowerPoint/WPS 字体度量不同 | 使用本机常见字体、增加文本框余量，并渲染 PPTX 复检 |
| 浏览器端导出与 CLI 不一致 | 使用了旧预览，或没有用下载的新 JSON 重建 | 两端共用导出实现；从同一份新源文件重新生成预览和 PPTX，核对资源、主题及报告 |
| WebSlide 出现 `ancestor-overflow-clip` 等告警 | 祖先裁切、层叠或组合效果无法等价变成单个 PPT 对象 | 改写为显式叶子形状，或只栅格化该局部；当前提取器报告风险但不会自动实现裁切 |
| `拒绝用空白图片` | 媒体声明为 PNG，实际内容损坏或格式不符 | 修复资源类型与内容后重建；OOXML 修复不会把缺失内容伪装成成功 |
| 更新后 PPTX 字号变大 | 默认换算由 2/3 校正为 0.75，匹配网页 px | 新稿使用默认值；仅需旧稿兼容时设置 `theme.fontScale:0.6666666667` |
| `--check-browser` 失败后产物“全部消失” | 该检查属于严格管线：任一步失败即回滚，不发布半套产物（避免新预览配旧 PPTX） | 属预期行为。先修好浏览器环境再重跑，或先不加 `--check-browser` 拿到产物，随后单独跑 `check_preview` |
| `spawn EPERM` / 子进程无法启动 | 受限沙箱禁止管道 stdio（`spawn`/`execFile` 默认 `stdio:'pipe'`），`check_preview`、`test:browser` 与 `build_all --check-browser` 都受影响 | 这是环境限制而非构建错误。在允许子进程的环境重跑，或跳过浏览器相关步骤并说明未做实测 |

## 环境依赖

- `npm ci` 会安装 `jszip`、`pptxgenjs`；`sharp` 是 **optionalDependencies**，安装失败不会中断 `npm ci`，但 Node 端 `image-svg` 会记为失败。需要时可单独 `npm i sharp`。
- 浏览器相关能力（WebSlide 提取、`check_preview`、`test:browser`、`--check-browser`、浏览器端导出）需要本机 Chrome/Edge，可用 `--browser <path>` 或 `PPT_BROWSER` 指定。
- `npm test` 不需要浏览器，但它内部会 `spawn` 子进程跑一次真实构建；在禁止子进程的沙箱里该用例会失败。

## 最终检查

1. `node tools/check_deck.mjs deck.json --json` 无错误；canonical 交付应尽量无警告。
2. `node tools/build_all.mjs deck.json -o output --check-browser` 成功；无浏览器时不加该参数，但要说明未做浏览器实测。
3. `*.report.json` 中 `failed=0` 且 `skipped=0`。
4. 打开实际 PPTX 检查字体替换、文字换行、图表标签和画布边界。
