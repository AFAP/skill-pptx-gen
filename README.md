# skill-ppt-gen

中文 · [English](#english)

> AI PPT 生成管线：一套 PPT-DSL 中间层 + 双端渲染核心（Konva 网页预览 + PptxGenJS 可编辑导出），
> 让 AI 只产出 JSON，就能得到**网页可预览、可微调、可导出真实可编辑 PPTX** 的演示文稿。

---

## 这是什么

把"内容"变成 PPT 通常卡在两个地方：排版难维护、导出不可编辑。本项目的解法是**不直接生成 PPTX，而是让 AI 生成一层中间 DSL**：

```
内容/主题/参考图
   │
   ▼
deck.json（PPT-DSL，1280×720px 绝对定位）
   │
   ├─→ Konva 渲染 → 自包含预览 HTML（可缩放、双击改文本、可导出修改稿）
   └─→ PptxGenJS → 真实可编辑 .pptx（文本/形状/图表/表格均可在 PowerPoint/WPS 二次编辑）
```

同一份 DSL 驱动两端，预览即所得，导出即所见。

## 特性

- **单一数据源 PPT-DSL**：12 种元素类型（文本/图片/SVG/矩形/圆/直线/箭头/路径/曲线/图表/表格）+ 3 个连接线/弧形宏
- **主题令牌系统**：`$primary` `$accent` `$bg` `$text` `$1`~`$9` `$light:$primary`，换主题只改 theme 对象
- **内置工业风模版**（墨青 × 机械橙），支持参考图风格提取与文字描述风格定制
- **DSL 校验器**：越界检测、文本溢出估算、按透明度逐层混合的对比度检查
- **连接线宏**：`connector-s`（脑图标准 S 曲线，自适应切线方向）、`connector-elbow`（肘形）、`arc-segment`（带箭头的轨道环段）——脑图/辐射/循环布局开箱即用
- **预览即编辑器**：预览页双击文本就地修改，一键导出修改后的 deck.json 或直接浏览器端导出 PPTX
- **自包含预览 HTML**：Konva 与数据全部内嵌，双击即可打开，无需服务器

## 快速开始

```bash
npm install        # 仅需 pptxgenjs

# 校验 → 预览 → 构建
node tools/check_deck.mjs examples/deck-report.json
node tools/make_preview.mjs examples/deck-report.json   # 生成 *.preview.html
node tools/build_pptx.mjs examples/deck-report.json -o out.pptx
```

## 工作流

1. **生成 deck.json**：按 `references/dsl-schema.md` 编写（或让 AI 按 SKILL.md 生成）
2. **确定风格**（三选一）：
   - 不指定 → 内置 `navy-brief` 藏青商务简报风模版
   - 提供参考图 → 按 `references/reference-image-analysis.md` 提取色板/字体/卡片风格
   - 文字描述（如"科技深蓝"）→ 按 `references/builtin-template.md` 末尾速配公式生成 theme
3. **校验 → 预览 → 导出**：三条命令，预览页可先目视检查

## DSL 速览

| elType | 说明 | 关键字段 |
| --- | --- | --- |
| `text` | 文本（fill=字体颜色，框底色用 bgFill） | text, fontSize, align, verticalAlign, lineHeight |
| `image` | 图片（URL/本地路径自动预取为 base64） | path/url, prompt（AI 生图占位）, sizing |
| `image-svg` | SVG 矢量 | svgXml |
| `shape-rect` | 矩形/圆角矩形 | fill, stroke, cornerRadius, shadow* |
| `shape-circle` | 圆/椭圆（**x/y 为圆心**） | fill, stroke |
| `shape-line` / `shape-arrow` | 直线/箭头 | pointArr, lineColor, lineWidth |
| `curve-quadratic` / `shape-path` | 贝塞尔/自由路径 | pointArr（支持 quadratic/cubic/arc 曲线） |
| `chart` | 真实可编辑图表 | chartType: bar/line/pie/doughnut/area/radar, data |
| `table` | 真实可编辑表格 | rows, header, stripeColor |
| `connector-s`（宏） | 脑图 S 连接线 | x1,y1,x2,y2, orientation(h/v/auto), dashType |
| `connector-elbow`（宏） | 直角肘形连接线 | x1,y1,x2,y2, orientation(h-first/v-first) |
| `arc-segment`（宏） | 带箭头的圆环扇段 | cx,cy,rOuter,rInner,startAngle,endAngle,fill |

> 宏不是渲染类型：构建/预览生成阶段自动展开为标准元素，两端表现一致。
> 完整规范见 `references/dsl-schema.md`。

## 项目结构

```
root/
├── SKILL.md                     # DSH skill 主入口（AI 工作流指令）
├── package.json                 # 唯一依赖：pptxgenjs
├── core/                        # 转换核心
│   ├── ppt-core.mjs             #   Node：DSL → PptxGenJS
│   ├── ppt-preview-core.js      #   浏览器：DSL → Konva（含双击编辑回写）
│   ├── connectors.mjs           #   连接线/弧形宏（构建期展开）
│   ├── dsl-validate.mjs         #   DSL 校验器
│   └── pptxgenjs-preview.js     #   备用：PptxGenJS 对象 → DOM 预览
├── tools/
│   ├── check_deck.mjs           #   校验
│   ├── make_preview.mjs         #   生成自包含预览 HTML
│   └── build_pptx.mjs           #   构建可编辑 PPTX
├── references/                  # DSL 规范 / 设计系统 / 内置模版 / 参考图分析协议
├── assets/                      # konva + pptxgenjs 浏览器运行时
└── examples/                    # 示例：可直接看效果
```

## 作为 DSH Skill 使用

整个目录就是一个 skill（含 `SKILL.md`）。复制到 `~/.dsh/skills/` 下即可被 DSH 识别。

## 常见问题

- **导出的文字变成色块** → text 的 `fill` 是字体颜色；要框底色请用 `bgFill`
- **连接线/弧段不显示** → 自定义几何必须用 `pptx.shapes.CUSTOM_GEOMETRY`（`ShapeType.customGeometry` 是 undefined）
- **PPT 里文字偏小** → 调 `theme.fontScale`（默认 0.667，视觉等大是 0.75）

---

## <a id="english"></a>English

> An AI PPT generation pipeline: a PPT-DSL intermediate layer + dual rendering cores (Konva web preview + PptxGenJS editable export). The AI only produces JSON; you get a **web-previewable, lightly editable, truly editable PPTX** presentation.

### What it is

Instead of generating PPTX directly (hard to maintain, hard to edit), the AI generates an intermediate DSL:

```
Content / topic / reference image
   │
   ▼
deck.json (PPT-DSL, 1280×720px absolute positioning)
   │
   ├─→ Konva → self-contained preview HTML (zoom, dbl-click text edit, export edited JSON)
   └─→ PptxGenJS → truly editable .pptx (text/shapes/charts/tables editable in PowerPoint/WPS)
```

One DSL drives both ends: what you preview is what you export.

### Features

- **Single-source PPT-DSL**: 12 element types + 3 connector/arc macros
- **Theme token system**: `$primary`, `$accent`, `$1`–`$9`, `$light:…` — re-skin via the theme object only
- **Built-in industrial template** (ink navy × machine orange), plus reference-image style extraction and text-described style customization
- **DSL validator**: bounds check, text-overflow estimation, alpha-blended contrast analysis
- **Connector macros**: `connector-s` (mind-map S-curves with adaptive tangents), `connector-elbow`, `arc-segment` (orbital ring segments with arrow notches)
- **Preview doubles as editor**: dbl-click text to edit in place; export the edited deck.json or re-export PPTX right in the browser
- **Self-contained preview HTML**: Konva and data inlined — double-click to open, no server needed

### Quick start

```bash
npm install

node tools/check_deck.mjs examples/deck-report.json
node tools/make_preview.mjs examples/deck-report.json
node tools/build_pptx.mjs examples/deck-report.json -o out.pptx
```

### Workflow

1. Author `deck.json` per `references/dsl-schema.md`
2. Pick a style: built-in `navy-brief` template / extract from a reference image (`references/reference-image-analysis.md`) / describe in words
3. Check → preview → build

### Project structure

See the tree above. The conversion cores live in `core/`, CLIs in `tools/`, docs in `references/`, runnable examples in `examples/`.

### FAQ

- **Text turns into a color block** → for text, `fill` is the font color; use `bgFill` for box background
- **Connectors/arcs missing in exported PPTX** → custom geometry must use `pptx.shapes.CUSTOM_GEOMETRY` (`ShapeType.customGeometry` is undefined)
