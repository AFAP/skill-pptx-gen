---
name: ppt-gen
description: 把内容、文档、数据或报告转为可编辑的 PPTX。当用户要求制作 PPT、幻灯片、演示文稿或 slide deck，或提供参考图要求复刻版式时使用。通过紧凑语义版式或受约束 WebSlide 生成统一 PPT-DSL，由网页预览与 PptxGenJS 共用转换层导出；文本、形状、图表和表格保持可编辑。
version: "2.2.0"
display_name: AI PPT 生成器
display_name_en: AI PPT Generator
category: office
author: 阿富
description_zh: "AI PPT 生成管线：生成 PPT-DSL → 网页预览（可双击编辑并导出修改后的 JSON）→ 导出可编辑 PPTX；支持参考图风格复刻和文字风格描述，默认使用 navy-report。"
description_en: "AI PPT generation pipeline: PPT-DSL → editable web preview with JSON export → editable PPTX. Supports reference-image style replication and text-described styling; defaults to navy-report."
---

# 可编辑 PPT 创作与编译管线

本技能的核心不是模板填充，而是给 AI 一个自由创作页面、又能可靠落地为 PPTX 的通道。AI 负责叙事、视觉隐喻、信息层级和构图；编译器负责把页面收敛为统一 primitive scene，再交给 Konva 与 PptxGenJS。两个渲染器不得各自维护一套页面逻辑。

## 选择创作模式

先读取 [references/creative-authoring.md](references/creative-authoring.md) 判断每页应使用哪种方式。整套 deck 可以混用：

- **Creative DSL（默认）**：重要结论页、机制图、关系图、数据故事和需要独特构图的页面。读取 [references/dsl-schema.md](references/dsl-schema.md)；用 `styleClass`、`group`、`repeat`、`anchor` 和路径宏降低自由构图的 token 成本。
- **Creative WebSlide**：用户给网页、参考图，或 HTML/CSS 更适合表达页面结构时使用。读取 [references/webslide.md](references/webslide.md)。Flex/Grid 只负责帮助 AI 排版，提取后的 primitive scene 才是最终视觉契约。
- **Compact**：目录、章节、普通列表，或语义版式已经能准确表达内容时使用。读取 [references/layout-dsl.md](references/layout-dsl.md)。按表达需要选择，不把效率模式当成创作上限。
- **Hybrid**：摄影、3D、纹理和复杂渐变可以局部转为图片；标题、正文、数据、图表、表格和关键关系默认保持可编辑。

按输入再读取对应参考：

- 长文档、研究报告或多章节材料：[references/content-to-deck.md](references/content-to-deck.md)。
- 参考截图：[references/reference-image-analysis.md](references/reference-image-analysis.md)。提取视觉语法后重新创作，不把单张截图当作整套母版。
- 图片版 PPT、PPT 截图或拍屏要还原成可编辑 PPTX：[references/image-to-editable-deck.md](references/image-to-editable-deck.md)。先做结构与元素分类，再按 Creative DSL / WebSlide / Hybrid 重建。
- 配色、字体、曲线和空间节奏：[references/styles.md](references/styles.md)。默认色板详见 [references/builtin-template.md](references/builtin-template.md)。样式是视觉语法，不是整页布局。
- 脑图、弧形轨道、四象限、金字塔、SWOT 等几何配方：[references/design-system.md](references/design-system.md)，只读取当前页面所需部分。
- 转换边界与降级：[references/parity-contract.md](references/parity-contract.md)。
- 构建故障：[references/troubleshooting.md](references/troubleshooting.md)。

## 标准工作流

1. 多页或长文档先做简短页面计划，写清 `message`、证据和导出策略；简单单页无需额外规划文件。
2. 逐页决定 Creative DSL、WebSlide、Compact 或 Hybrid，选择能准确表达内容、返工最少的入口。构图与视觉风格由 AI 和用户决定。
3. 先建立全局主题、`styleClasses` 或共享 CSS；复用视觉语言，不复制整页几何。
4. 若使用 HTML，先提取为 deck：

   ```bash
   cd <本 SKILL.md 所在目录>
   node tools/html_to_deck.mjs path/to/slides.html -o path/to/deck.json
   ```

5. 用单一命令完成严格校验、离线预览、PPTX 和报告：

   ```bash
   node tools/build_all.mjs path/to/deck.json -o path/to/output-dir
   ```

6. 检查 `*.preview.html`、`*.pptx`、`*.report.json`。最终交付的 `failed` 和 `skipped` 必须同时为 0；warning 要逐条处理或证明属于预期行为。
7. 先看整套缩略图判断节奏，再逐页全尺寸检查。不要因为校验通过就认定页面内容或构图已经合格。

有 Chrome/Edge 时给 `build_all` 加 `--check-browser`，执行实际预览渲染检查。也可运行 `node tools/check_preview.mjs preview.html --json` 检查实测文字溢出，或加 `--screenshots output-dir` 导出逐页 PNG。最终仍需实际渲染 PPTX 核对，浏览器检查不能替代 PowerPoint/WPS。

首次使用缺依赖时在技能目录执行 `npm ci`。Node.js 需 ≥18。

## 转换契约

- 默认严格构建：未知类型、无法导出的路径、未生成的图片 prompt、图片读取失败都会中止，不允许“成功但缺元素”。
- Compact 容量超限会给出源路径并报错；自行拆页或转 Creative DSL，工具不会截断内容。图表数据必须为有限数字，分类标签与数值逐项对应。
- `styleClass`、`group`、`repeat`、`anchor` 仅存在于源文件；构建前统一展开为 primitive，不进入两个渲染器的分支逻辑。
- 网页预览与 PPTX 共用编译后的 primitive DSL，但文字排版和原生图表仍受浏览器、PowerPoint/WPS 字体度量影响；不要声称像素级完全相同。
- HTML 仅转换带 `data-ppt` 的叶子元素。Flex/Grid 可用于计算位置；滤镜、遮罩、混合模式、复杂渐变等必须报告或局部栅格化。
- 不把含中文文字的整页生图当作默认降级。优先生成无文字背景/插画，再叠加可编辑文字。
- 图片属于媒体对象，报告标记为 `rasterized`；文本、形状、图表和表格应标记为 `editable`。
- primitive DSL 画布固定 1280×720；`shape-circle` 的 x/y 是圆心，其余几何通常以左上角为原点。
- `shape-path` 必须明确坐标模式：局部坐标用 `x/y` 作原点且 `pointArr` 匹配 `width/height`；画布绝对坐标设置 `coordinateMode:"absolute"`（建议 `x=y=0`），构建器会自动重算外框并转成局部坐标。
- 矩形、文字、图片和路径的 `rotation` 围绕元素框中心。字体默认按 `px × 0.75` 导出为 pt；旧稿需要旧字号时显式设置 `theme.fontScale:0.6666666667`，不再默认缩小全部文字。
- 浅色表面上的强调文字使用 `$accentText`；`$accent` 用于装饰、描边和填充；accent 色块上的文字使用 `$onAccent`。

## 内容与创作

- 视觉来自内容关系。先寻找冲突、因果、层级、流向、尺度、时间或不确定性，再选择图形语言。
- 字数、配色数量和版式配方都是可选建议，不是转换约束；不要为了套配方删掉用户要求保留的内容。
- 不为“看起来丰富”编造事实。推断、情景和假设必须与已知事实分开。
- 参考图提供视觉语法；除非用户要求逐页复刻，否则继续让 AI 根据新内容创造构图。

## 预览改字闭环

`make_preview` 和 `build_all` 生成的预览默认可编辑：

1. 浏览器打开 `*.preview.html`，双击有明确 `sourcePath` 的文字修改。
2. 直接导出 PPTX，或下载修改后的 `deck.json`；下载稿保留原始主题令牌、语义版式和宏。
3. 浏览器不会静默覆盖磁盘上的原文件；若要继续迭代，用下载稿替换或另存为新的源文件。
4. 只需审阅时可用 `--no-edit` 关闭编辑。

`repeat` 中直接绑定 `{{field}}` 或 `{{value}}` 的文本可回写；序号、固定模板文字和混合插值是派生结果，只读以防写错源数据。

改字先更新源数据、保留数字/布尔类型，再用同一编译器刷新所有关联文字和几何；校验失败则不保存。嵌套 `repeat/group` 同样适用。不要直接修改编译稿、内嵌 HTML 或 `sourcePath`。降低 token 应优先复用源数据和样式类，只读取报错指向的页面与字段，避免把生成的 HTML 重新喂给模型。

## 常用命令

```bash
node tools/check_deck.mjs deck.json --json
node tools/make_preview.mjs deck.json -o preview.html
node tools/build_pptx.mjs deck.json -o out.pptx --report out.report.json
node tools/check_preview.mjs preview.html --json
npm test
npm run test:browser
```

常用可选参数：

| 参数 | 作用 |
| --- | --- |
| `--base-dir <目录>` | 指定 `path`/`url` 相对路径的解析基准（默认 deck 文件所在目录）。`build_all` 自动传入原 deck 目录 |
| `--scale 0.75` | 缩放预览页显示比例（不改画布与导出） |
| `make_preview --no-edit` | 关闭双击改字，生成纯审阅预览 |
| `make_preview --no-embed-images` | 不把图片内嵌为 data URI，预览体积更小但依赖原路径可访问 |
| `build_pptx --skip-images` | 跳过图片预取（仅调试，缺图会记为失败） |
| `html_to_deck --theme <名称>` | 指定 WebSlide 提取时使用的主题 |
| `--no-validate` | 跳过校验直接构建。**不要用它掩盖转换错误**，只用于定位构建阶段问题 |

只有用户明确接受不完整输出时才使用 `--allow-partial`。不要把 `--no-validate` 当成修复手段。

## 关键文件

- `core/compile-deck.mjs`：语义版式、主题令牌和宏统一编译。
- `core/shape-path.mjs`：shape-path 的局部/绝对坐标校验与自动归一化。
- `references/image-to-editable-deck.md`：图片版 PPT / 截图还原为可编辑 deck 的流程、元素分类和验收清单。
- `core/dsl-validate.mjs`：严格校验器（边界、文本溢出估算、对比度、图表/表格形态、能力告警）；`check_deck` 的实现。
- `core/creative-expand.mjs`：Creative DSL 的样式类、分组、重复器与锚点展开。
- `core/layouts.mjs`：低 token 语义版式展开器。
- `core/webslide-extract.js`：浏览器计算后的 HTML/CSS → primitive DSL。
- `core/dsl-to-pptx.mjs`：primitive DSL → PptxGenJS（Node 与浏览器共用）。
- `core/ppt-preview-core.js`：primitive DSL → Konva 预览。
- `core/ppt-core.mjs`：Node 专有适配层（图片/背景预取、SVG 栅格化、构建编排）。
- `core/pptx-sanitize.mjs`：Node 与浏览器共用的 OOXML 修复。
- `core/source-edit.mjs`：类型安全的源数据修改与重新编译。
- `core/presentation.mjs`：Node/浏览器共用的 PPTX 构建与转换报告。
- `core/connectors.mjs`：`connector-s`、`connector-elbow`、`arc-segment` 宏展开。
- `tools/build_all.mjs`：推荐的一键严格管线。
- `examples/南京埃斯顿深度研究报告-AI创意版.deck.json`：以 Creative DSL 为主的内容驱动构图示例。
- `examples/deck-industrial-excellence.json` 与 `examples/industrial-excellence-out/`：从图片截图重建单页可编辑 PPT 的演示。
- `examples/南京埃斯顿深度研究报告-AI创意版.html`、`examples/南京埃斯顿深度研究报告-AI创意版.pptx`、`examples/南京埃斯顿深度研究报告-AI创意版-总览.png`：创意版的可编辑预览、成品与 23 页视觉总览。
