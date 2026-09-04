# ai-ppt-gen

把受约束网页或紧凑语义 JSON 转成可检查的网页预览和可编辑 PPTX。项目重点是转换完整性、一致性与低 token 输入，不负责替代模型的视觉设计判断，也不承诺任意网页/CSS 的像素级无损转换。

## 管线

```text
语义 deck.json ─┐
                ├─> primitive PPT-DSL ─> Konva 预览
WebSlide HTML ──┘                     └─> PptxGenJS ─> PPTX + 转换报告
```

- 语义版式适合普通汇报：只写页面角色和内容，减少绝对坐标与重复样式。
- WebSlide 适合网页式构图：Flex/Grid 负责布局，只有带 `data-ppt` 的节点进入 PPTX。
- primitive DSL 是两端共用的稳定中间层，可作为语义版式的局部覆盖层。
- 默认严格构建；不支持的元素、缺失图片和转换异常不会被静默丢弃。
- 文本、形状、图表、表格保持可编辑；图片与 SVG 会在报告中标为 `rasterized`。

## 快速开始

需要 Node.js 18 或更高版本。

```bash
npm ci

# 低 token 语义示例：校验、预览、PPTX、报告一次生成
node tools/build_all.mjs examples/deck-compact.json -o output

# 受约束网页先提取为 deck，再构建
node tools/html_to_deck.mjs examples/webslide-basic.html -o output/webslide.json
node tools/build_all.mjs output/webslide.json -o output
```

生成物包括 `*.preview.html`、`*.pptx` 和 `*.report.json`。最终交付要求报告的 `failed`、`skipped` 均为 0。

预览页默认支持双击文字修改，可下载保留主题令牌和语义结构的新 `deck.json`，也可直接在浏览器导出 PPTX。浏览器不会自动覆盖原始源文件；纯审阅可给 `make_preview` 传 `--no-edit`。

## 输入方式

长文档、研究报告或多章节材料不要直接逐段塞进幻灯片。先按 [长文档拆页工作流](references/content-to-deck.md) 形成页面计划，再选择语义版式或 WebSlide。

### 紧凑语义版式

```json
{
  "dslVersion": 2,
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

- `core/compile-deck.mjs`：语义版式、主题令牌和连接宏编译。
- `core/layouts.mjs`：紧凑语义版式。
- `core/webslide-extract.js`：浏览器计算后的 HTML/CSS 提取。
- `core/dsl-to-pptx.mjs`：primitive DSL 到 PptxGenJS。
- `core/ppt-preview-core.js`：primitive DSL 到 Konva。
- `core/pptx-sanitize.mjs`：Node/浏览器共用 OOXML 修复。
- `tools/build_all.mjs`：推荐的一键管线。
- `examples/`：两种输入模式的示例。
- `screenshot/`：人工检查网页预览与 PPTX 实际效果的截图。
- `对比/`：历史修复前后产物，仅用于回归对照，不作为新 deck 的输入模板。

本目录本身也是 Codex skill；入口与 agent 工作流见 [SKILL.md](SKILL.md)。
