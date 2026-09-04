---
name: ppt-gen
description: 把内容、文档、数据或报告转为可编辑的 PPTX。当用户要求制作 PPT、幻灯片、演示文稿或 slide deck，或提供参考图要求复刻版式时使用。通过紧凑语义版式或受约束 WebSlide 生成统一 PPT-DSL，由网页预览与 PptxGenJS 共用转换层导出；文本、形状、图表和表格保持可编辑。
version: "1.2.1"
display_name: AI PPT 生成器
display_name_en: AI PPT Generator
category: office
author: 阿富
description_zh: "AI PPT 生成管线：生成 PPT-DSL → 网页预览（可双击编辑并导出修改后的 JSON）→ 导出可编辑 PPTX；支持参考图风格复刻和文字风格描述，默认使用 navy-report。"
description_en: "AI PPT generation pipeline: PPT-DSL → editable web preview with JSON export → editable PPTX. Supports reference-image style replication and text-described styling; defaults to navy-report."
---

# AI PPT 生成管线

本技能解决转换与一致性问题。底层 PPT-DSL 是稳定中间表示；优先让模型生成更短的语义版式或受约束网页，不直接重复书写大量绝对坐标。

## 选择输入模式

根据任务只读取对应参考：

- 输入是长文档、研究报告或多章节材料：先读取 [references/content-to-deck.md](references/content-to-deck.md)，只生成页面计划后再写 deck，避免边读边堆页。
- 普通汇报、报告、培训或数据演示：使用紧凑语义版式，读取 [references/layout-dsl.md](references/layout-dsl.md)。这是默认模式，token 最少。
- 用户给网页、要求发挥 HTML/CSS 布局能力，或参考截图更适合网页复刻：使用 WebSlide，读取 [references/webslide.md](references/webslide.md)。
- 需要自由路径、精确坐标或语义版式无法表达的局部：读取 [references/dsl-schema.md](references/dsl-schema.md)，用 primitive `elements` 作为覆盖层。
- 需要脑图、弧形轨道、四象限、金字塔、SWOT、循环图等复杂构图：额外读取 [references/design-system.md](references/design-system.md)，只取与当前页面有关的配方，不加载整套版式。
- 用户提供参考截图：额外读取 [references/reference-image-analysis.md](references/reference-image-analysis.md)。复杂背景可生图，但文字、数字和图表默认保持可编辑。
- 需要选择默认视觉：读取 [references/styles.md](references/styles.md)。样式与版式分开选择；要了解默认 `navy-report` 的细节与令牌职责，再读取 [references/builtin-template.md](references/builtin-template.md)。
- 遇到预览与 PPTX 差异或降级：读取 [references/parity-contract.md](references/parity-contract.md)。
- 构建失败、环境缺失或出现转换告警：读取 [references/troubleshooting.md](references/troubleshooting.md)。

## 标准工作流

1. 先形成页面计划：每页写清页面角色、单一结论、证据和表达形式；单页超载时分页，不靠缩小字号硬塞。
2. 选择输入模式并生成源文件：优先 `deck.json` 语义版式，网页任务生成带 `data-ppt` 标记的 HTML。
3. 若是 HTML，先提取为 deck：

   ```bash
   cd <本 SKILL.md 所在目录>
   node tools/html_to_deck.mjs path/to/slides.html -o path/to/deck.json
   ```

4. 用单一命令完成严格校验、离线预览、PPTX 和报告：

   ```bash
   node tools/build_all.mjs path/to/deck.json -o path/to/output-dir
   ```

5. 检查三个交付物：`*.preview.html`、`*.pptx`、`*.report.json`。最终交付的 `failed` 和 `skipped` 必须同时为 0；warning 要逐条处理或明确证明属于预期行为。

首次使用缺依赖时在技能目录执行 `npm ci`。Node.js 需 ≥18。

## 转换契约

- 默认严格构建：未知类型、无法导出的路径、未生成的图片 prompt、图片读取失败都会中止，不允许“成功但缺元素”。
- 网页预览与 PPTX 共用编译后的 primitive DSL，但文字排版和原生图表仍受浏览器、PowerPoint/WPS 字体度量影响；不要声称像素级完全相同。
- HTML 仅转换带 `data-ppt` 的叶子元素。Flex/Grid 可用于计算位置；滤镜、遮罩、混合模式、复杂渐变等必须报告或局部栅格化。
- 不把含中文文字的整页生图当作默认降级。优先生成无文字背景/插画，再叠加可编辑文字。
- 图片属于媒体对象，报告标记为 `rasterized`；文本、形状、图表和表格应标记为 `editable`。
- primitive DSL 画布固定 1280×720；`shape-circle` 的 x/y 是圆心，其余几何通常以左上角为原点。
- 浅色表面上的强调文字使用 `$accentText`；`$accent` 用于装饰、描边和填充；accent 色块上的文字使用 `$onAccent`。

## 预览改字闭环

`make_preview` 和 `build_all` 生成的预览默认可编辑：

1. 浏览器打开 `*.preview.html`，双击文字修改。
2. 直接导出 PPTX，或下载修改后的 `deck.json`；下载稿保留原始主题令牌、语义版式和宏。
3. 浏览器不会静默覆盖磁盘上的原文件；若要继续迭代，用下载稿替换或另存为新的源文件。
4. 只需审阅时可用 `--no-edit` 关闭编辑。

## 常用命令

```bash
node tools/check_deck.mjs deck.json --json
node tools/make_preview.mjs deck.json -o preview.html
node tools/build_pptx.mjs deck.json -o out.pptx --report out.report.json
npm test
```

只有用户明确接受不完整输出时才使用 `--allow-partial`。不要用 `--no-validate` 掩盖转换错误。

## 关键文件

- `core/compile-deck.mjs`：语义版式、主题令牌和宏统一编译。
- `core/layouts.mjs`：低 token 语义版式展开器。
- `core/webslide-extract.js`：浏览器计算后的 HTML/CSS → primitive DSL。
- `core/dsl-to-pptx.mjs`：primitive DSL → PptxGenJS。
- `core/ppt-preview-core.js`：primitive DSL → Konva 预览。
- `core/pptx-sanitize.mjs`：Node 与浏览器共用的 OOXML 修复。
- `tools/build_all.mjs`：推荐的一键严格管线。
- `examples/deck-compact.json`、`examples/webslide-basic.html`：两种输入模式的最小示例。
