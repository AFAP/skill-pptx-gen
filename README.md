# ppt-gen

让 AI 用受约束网页或 Creative/Compact DSL 自由创作页面，再转成可检查的 Konva 网页预览和可编辑 PPTX。项目重点是让模型拥有构图自由，同时用统一 primitive scene 保证转换完整性与一致性；不承诺任意网页/CSS 的像素级无损转换。

## 管线

```text
Creative DSL ───┐
Compact DSL ────┼─> canonical primitive scene ─> Konva 预览
WebSlide HTML ──┘                           └─> PptxGenJS ─> PPTX + 转换报告
```

- Creative DSL 是重要页面的默认创作方式；`styleClass/group/repeat/anchor` 让自由构图保持低 token。
- WebSlide 适合网页式构图：Flex/Grid 负责布局，只有带 `data-ppt` 的节点进入 PPTX。
- Compact 语义版式适合目录、章节、普通列表和快速交付，不再承担整套 deck 的创作上限。
- primitive scene 是两端共用的唯一稳定中间层。
- 默认严格构建；不支持的元素、缺失图片和转换异常不会被静默丢弃。
- 文本、形状、图表、表格保持可编辑；图片与 SVG 会在报告中标为 `rasterized`。

## 快速开始

需要 Node.js 18 或更高版本。

```bash
npm ci

# 23 页 AI 创意示例：校验、预览、PPTX、报告一次生成
node tools/build_all.mjs examples/南京埃斯顿深度研究报告-AI创意版.deck.json -o output

# 受约束网页先提取为 deck，再构建
node tools/html_to_deck.mjs examples/埃斯顿2026中期报.html -o output/webslide.json
node tools/build_all.mjs output/webslide.json -o output
```

生成物包括 `*.preview.html`、`*.pptx` 和 `*.report.json`。最终交付要求报告的 `failed`、`skipped` 均为 0。

预览页默认支持双击有明确源路径的文字修改，可下载保留主题令牌和语义结构的新 `deck.json`，也可直接在浏览器导出 PPTX。循环序号、混合插值等派生文字为只读，避免错误回写；浏览器不会自动覆盖原始源文件。纯审阅可给 `make_preview` 传 `--no-edit`。

## 完整展示示例

[南京埃斯顿深度研究报告-AI创意版.deck.json](examples/南京埃斯顿深度研究报告-AI创意版.deck.json) 把同目录研究报告重构为 23 页内容驱动叙事。它不从固定模板出发，而是按每页的信息关系分别使用断裂曲线、竞争坐标、能力主轴、波形时间线、盈利桥、环形验证、激励阶梯、证据塔、情景扇面和风险树等构图；`styleClass/group/repeat/anchor` 负责压缩重复描述，最终仍统一编译为可编辑 primitive。

- [网页预览](examples/南京埃斯顿深度研究报告-AI创意版.html)：双击即可修改文字，也可下载修改后的 JSON。
- [可编辑 PPTX](examples/南京埃斯顿深度研究报告-AI创意版.pptx)：297 个可编辑对象、1 张说明性图片、失败 0。
- [23 页总览图](examples/南京埃斯顿深度研究报告-AI创意版-总览.png)：查看整套页面轮廓、节奏和布局变化。
- [转换报告](examples/南京埃斯顿深度研究报告-AI创意版.report.json)：逐元素记录 editable/rasterized/failed 状态。

## 输入方式

长文档、研究报告或多章节材料不要直接逐段塞进幻灯片。先按 [长文档拆页工作流](references/content-to-deck.md) 形成页面计划，再按 [AI 自由创作工作流](references/creative-authoring.md) 逐页选择 Creative DSL、WebSlide、Compact 或 Hybrid。

### Creative DSL

Creative DSL 直接组合可编辑 primitive，并在源文件中支持样式类、相对分组、数据重复器和锚点定位。它们在构建前统一展开，不会让 Konva 与 PPTX 产生两套实现。完整语法见 [PPT-DSL primitive 规范](references/dsl-schema.md)。

### 紧凑语义版式

```json
{
  "dslVersion": 3,
  "style": "clean-minimal",
  "slides": [
    {
      "layout": "cards",
      "title": "核心能力",
      "items": [
        { "title": "可编辑", "body": "文字、形状、图表和表格保留为 PPT 对象" },
        { "title": "可追踪", "body": "每个元素都有转换状态" }
      ]
    }
  ]
}
```

内置版式和字段见 [紧凑语义版式](references/layout-dsl.md)。

### WebSlide

```html
<section class="ppt-slide" data-ppt-slide>
  <article data-ppt="shape">
    <h2 data-ppt="text">可编辑标题</h2>
  </article>
</section>
```

WebSlide 只提取显式标记的节点。支持范围与降级规则见 [WebSlide 协议](references/webslide.md)。

## 默认样式

推荐的常用预设：`navy-report`、`clean-minimal`、`tech-dark`、`warm-editorial`、`data-dashboard`。样式只定义视觉令牌，不绑定版式；详细字段见 [默认样式](references/styles.md)。

未指定样式时默认使用 `navy-report`；`navy-brief` 仅作为旧名称兼容。

## 常用命令

```bash
node tools/check_deck.mjs deck.json --json
node tools/make_preview.mjs deck.json -o preview.html
node tools/build_pptx.mjs deck.json -o out.pptx --report out.report.json
npm test
```

`--allow-partial` 只用于用户明确接受不完整调试输出的情况。

## 一致性边界

网页与 PPTX 共用编译后的 DSL，但浏览器、PowerPoint 和 WPS 的字体度量与图表渲染并不相同，因此项目保证的是可追踪转换和明确降级，而不是虚假的像素级承诺。完整能力矩阵见 [转换一致性契约](references/parity-contract.md)。

参考截图默认采用“可编辑元素 + 局部无文字图片”的混合策略；不会把含中文和关键数据的整页生图作为常规方案。见 [参考图分析协议](references/reference-image-analysis.md)。

构建报错、缺少浏览器或可选 SVG 能力时，先查 [故障排查](references/troubleshooting.md)。复杂 primitive 构图按需查 [设计系统与版式配方](references/design-system.md)，不要在普通语义版式任务中整份加载。

## 目录

- `core/compile-deck.mjs`：所有创作入口到统一 primitive scene 的编译入口。
- `core/creative-expand.mjs`：样式类、分组、重复器与锚点展开。
- `core/layouts.mjs`：紧凑语义版式。
- `core/webslide-extract.js`：浏览器计算后的 HTML/CSS 提取。
- `core/dsl-to-pptx.mjs`：primitive DSL 到 PptxGenJS。
- `core/ppt-preview-core.js`：primitive DSL 到 Konva。
- `core/pptx-sanitize.mjs`：Node/浏览器共用 OOXML 修复。
- `tools/build_all.mjs`：推荐的一键管线。
- `examples/`：WebSlide 输入、原始研究报告、23 页创意案例、29 页工程覆盖案例及其交付物。
- `screenshot/`：历史实测截图，用于确认网页改字和 PowerPoint/WPS 对象可编辑。
