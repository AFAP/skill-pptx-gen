---
name: ppt-gen
description: 把内容变成可编辑的 PPTX 演示文稿。当用户要求制作 PPT/幻灯片/演示文稿/slide deck，或将文档/数据/报告转为 .pptx 时使用。用户可指定参考图（分析其风格并复刻）或用文字描述风格；未指定时使用内置主题（默认 navy-brief，另有 business/tech/health/education/nature/creative/minimal/warm/dark）。核心是一条多库搭配管线：你生成 PPT-DSL（JSON）→ Konva 渲染网页预览（可双击改文本、导出修改后的 JSON）→ PptxGenJS 导出真实可编辑的 PPTX（文本/形状/图表/表格均可在 PowerPoint/WPS 二次编辑）。
---

# AI PPT 生成管线（ppt-gen）

## 这个 skill 解决什么

**不是设计问题，而是工程问题**：通过多个库的搭配，实现 网页内容生成 → 展示 → 网页内容修改（少量）→ 可编辑 PPTX 生成。设计决策由你（AI）在使用时完成；本 skill 提供转换核心与工具链，**禁止重写核心库**。

```
① 生成   你产出 deck.json（PPT-DSL，1280×720px 绝对定位）
② 展示   tools/make_preview.mjs → 自包含 HTML：Konva 渲染、缩放、双击改文本
③ 修改   两条路：a) 用户在预览页双击改字 → 点"导出 deck.json"拿回修改稿；
                 b) 你直接改 deck.json 字段重跑（结构调整推荐这条）
④ 导出   tools/build_pptx.mjs → 真实可编辑 .pptx（预览页内也可浏览器端导出）
```

## 标准工作流

### 1. 确定输入
- **内容**：主题、大纲、文档或数据（PDF/长文先自行提炼要点）。
- **风格**（三选一）：
  - 未指定 → 用内置模版 `theme: "navy-brief"`（藏青商务简报风）。内置主题还有 `business/tech/health/education/nature/creative/minimal/warm/dark`，见 `references/builtin-template.md`
  - **参考图** → `read_image` 查看，按 `references/reference-image-analysis.md` 提取风格（色板/字体/卡片/装饰/页面原型），转成 `deck.theme` 对象并指导布局；回复中说明提取的风格要点
  - **文字描述**（如"科技深蓝""苹果极简"）→ 按 `references/builtin-template.md` 末尾的速配公式直接生成 theme 对象

### 2. 规划页面
按 `references/design-system.md` 的版式库组织：封面 → 目录(可选) → 内容页×N → 变化页（数据/金句/对比）→ 结尾。同版式不连续超 2 页；单页 ≤6 要点。

### 3. 生成 deck.json
- 画布固定 **1280×720 px**，元素绝对定位；安全边距：左右 60-80px，上下 40-60px。
- **颜色一律用主题令牌**：`$primary` `$accent` `$bg` `$text` `$text2` `$1`~`$9`（具体可用到 `$N` 取决于 theme.palette 长度）`$light:$primary`，换主题一键完成。
- 元素类型与属性见 `references/dsl-schema.md`；常用片段见本文末尾。
- 需要插图：`{"elType":"image","prompt":"英文生图描述","x":..,"y":..,"width":..,"height":..}`，有生图工具就生成后补 `path`；没有则保留 prompt（预览显示占位框，导出跳过）。也可直接给 `data`（data URI）。

### 4. 校验 → 预览 → 构建（三步都跑）
```bash
cd <本 SKILL.md 所在目录>
node tools/check_deck.mjs path/to/deck.json --json       # ① 校验：结构化报告（errors/warnings），也便于程序读取
node tools/make_preview.mjs path/to/deck.json -o preview.html [--no-edit] [--scale 0.75] [--embed-images]  # ② 自包含预览 HTML（可双击改字）
node tools/build_pptx.mjs path/to/deck.json -o out.pptx [--no-validate] [--skip-images]  # ③ 可编辑 PPTX
```
- error 必须修；warning（越界/溢出/对比度/未解析令牌等）逐条审视，涉及设计红线的一律修正。
- 生成预览后用浏览器打开自查（环境支持截图则截图自查，否则交付用户确认）。
- 首轮使用若缺依赖：在 skill 目录执行 `npm install`。必装 `pptxgenjs`（已锁 4.0.1，与 assets 一致）和 `jszip`；`sharp` 用于 Node 端 SVG 栅格化，缺失会自动告警跳过。

## 设计红线（违反必返工）

1. 元素不得越界（装饰圆环等出血元素除外，校验器会提示但可放行）。
2. 字号层级（px）：封面主标 54-68 / 页面标题 28-42 / 副标 20-28 / 卡片标题 16-26 / 正文 12-18 / 注释 10-13。**正文不得低于 12px**。
3. 文本框高度必须容纳文字：`行数 × fontSize × lineHeight ≤ height`（校验器自动查）。
4. 每页主色 ≤3 种；深底白字、浅底深字（校验器对比文字与实际承载形状）。
5. `shape-circle` 的 x/y 是**圆心**；其余元素是左上角。
6. text 的 `fill` 是**字体颜色**；文本框要底色用 `bgFill`。
7. 每页第一个元素通常是全屏背景 `shape-rect`（x:0,y:0,1280×720,fill:`$bg`），或设 `slide.background`。
8. JSON 必须合法：双引号、无尾逗号、无注释。

## 常用片段

> 下面两个代码块中的 `//` 注释仅作示意；实际 deck.json 必须去掉全部注释。


```jsonc
// 节头（橙色标记 + EN 标签 + 标题）
{"elType":"shape-rect","x":60,"y":52,"width":6,"height":42,"fill":"$accent"},
{"elType":"text","text":"OVERVIEW","x":80,"y":48,"width":400,"height":18,"fontSize":11,"fill":"$text2","letterSpacing":3},
{"elType":"text","text":"页面标题","x":80,"y":66,"width":800,"height":40,"fontSize":28,"fontStyle":"bold","fill":"$text","verticalAlign":"middle"},

// 白卡 + 顶部帽线
{"elType":"shape-rect","x":60,"y":140,"width":560,"height":380,"fill":"#FFFFFF","stroke":"#E8E4DC","strokeWidth":1,"cornerRadius":14},
{"elType":"shape-rect","x":60,"y":140,"width":560,"height":4,"fill":"$accent","cornerRadius":2},

// 图表（导出为真实可编辑图表；两年对比：当年橙、上年灰）
{"elType":"chart","chartType":"bar","x":80,"y":160,"width":580,"height":400,"labels":["A","B"],"data":[{"name":"2026H1","values":[21,4]},{"name":"2025H1","values":[20,5]}],"chartColors":["#F26B21","#C9CFDA"],"showLegend":true},

// 页脚
{"elType":"shape-rect","x":60,"y":688,"width":1160,"height":1,"fill":"#E5E1D8"},
{"elType":"text","text":"02 / 10","x":1120,"y":696,"width":100,"height":18,"fontSize":10,"fill":"#9AA0AF","align":"right"}
```

```jsonc
// 脑图/hub 布局：S 型连接线（宏，构建期自动展开为曲线元素，别手写 pointArr）
{"elType":"connector-s","x1":580,"y1":330,"x2":320,"y2":230,"stroke":"$text2","strokeWidth":2,"dashType":"dash"},
// 弧形轨道流：圆环扇段（宏）
{"elType":"arc-segment","cx":640,"cy":400,"rOuter":240,"rInner":175,"startAngle":-30,"endAngle":90,"fill":"$2"}
```
脑图示例见 `examples/` 目录下的脑图/轨道流示例；宏细节见 `references/dsl-schema.md`「连接线与弧形宏」。

## 文件地图

| 路径 | 作用 |
| --- | --- |
| `core/dsl-to-pptx.mjs` | **纯转换层（Node 与浏览器共用）**：DSL → PptxGenJS；主题令牌解析（颜色字段白名单）、负尺寸归一化、图片 sizing 默认 cover、closePath→`<a:close/>`、多点折线→customGeometry、图表/表格/阴影 |
| `core/ppt-core.mjs` | Node 适配层：图片/背景预取为 base64（含 5MB 体积守卫）、构建编排（re-export 纯转换层） |
| `core/ppt-preview-core.js` | **预览核心（浏览器）**：DSL → Konva；chart 标签/图例/radar/scatter 原生绘制、bgFill 垫底、双击文本编辑并回写原始 deck |
| `core/connectors.mjs` | **连接线/弧形宏**（源自原项目脑图布局函数）：connector-s、connector-elbow、arc-segment（带箭头），构建期展开为标准元素 |
| `core/dsl-validate.mjs` | 校验器：宏展开后查越界/溢出估算/对比度（按透明度逐层混合）/chart/table 形态/渐变提示 |
| `tools/build_pptx.mjs` | deck.json → .pptx（先校验后构建） |
| `tools/make_preview.mjs` | deck.json → 自包含预览 HTML（内嵌 Konva + 共享转换层；可双击编辑、导出 deck.json / PPTX、缩放不重建） |
| `tools/check_deck.mjs` | 只校验 |
| `assets/` | konva.10.0.12.min.js、pptxgen.4.0.1.js（浏览器端运行时，与 npm 依赖同版本） |
| `references/dsl-schema.md` | DSL 全量规范（元素属性、单位换算、令牌、连接线宏、陷阱） |
| `references/builtin-template.md` | 内置 navy-brief + business/tech/health/education/nature/creative/minimal/warm/dark 主题，以及从参考图/描述生成新风格的公式 |
| `references/design-system.md` | 版式库与设计规范（字号层级/边距/节奏/装饰元素库） |
| `references/reference-image-analysis.md` | 参考图风格提取协议（含复杂风格的整页文生图模式） |
| `tests/smoke.mjs` | 冒烟测试（`npm test`）：覆盖箭头/椭圆/data URI/宏归一化/校验器回归点 |
| `examples/` | 参考样例（非运行时必需；文件名可能变化——先 `ls examples/` 看有哪些） |

## 故障排除

- **`npm install` 报缓存目录权限错**：加 `--cache <工作区内临时目录>`。
- **PowerPoint 提示"内容有问题"**：转换核心已自动归一化负尺寸（flipH/flipV）；若仍遇到，解压 pptx 查 `<a:ext>` 负值并反馈。
- **导出文字"消失"（变成色块）**：text 的 `fill` 是字体色；框底色请用 `bgFill`。
- **PPT 中文本偏小/偏大**：调 `theme.fontScale`（默认 0.667；0.75 为视觉等大）。
- **emoji 变黑白**：平台渲染差异，正式场合用 `image-svg` 图标。
- **headless 截图失败**（Windows 沙箱命名管道限制）：用真实浏览器打开预览页确认；也可用 PowerPoint COM 导出 PNG 验证——注意 **COM 验证必须用有窗口模式**（`Presentations.Open(file, -1, 0, -1)`），无窗口模式（WithWindow:false）无法解码图片，含图片的 pptx 会误报"打不开"。
- **连接线/弧段在导出的 PPTX 里不显示**：自定义几何必须用 `pptx.shapes.CUSTOM_GEOMETRY`——`pptx.ShapeType.customGeometry` 是 undefined（枚举键名是 `custGeom`），写错会产出不可见形状。两个导出路径均已用正确引用。
- **渐变填充导出走样**：PPTX 导出压平为首色（可编辑性限制，校验器会提示）；预览页显示真渐变。要真渐变请用 `image-svg` 或图片。
- **image-svg 在 Node 端**：pptxgenjs 的 SVG 支持是纯浏览器功能；Node 端由 `sharp` 预栅格化为 PNG（2x 分辨率；package.json 已含 sharp，若精简安装时未装则跳过并告警）。浏览器端导出由 pptxgenjs 自行栅格化。
- **Node 版本**：需 ≥18（fetch/AbortSignal.timeout）。
