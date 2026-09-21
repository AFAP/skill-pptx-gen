# 转换一致性契约

“网页预览与 PPTX 共用数据源”不等于“两个渲染器像素完全相同”。本项目保证可追踪转换和明确降级，不隐藏差异。

**能力清单的唯一真相源是代码，不是本文档**：`core/capabilities.mjs` 声明每个字段的两端情况，
`core/dsl-validate.mjs` 据此**自动**为所有非 `both` 字段生成告警。本文档只解释原则与已知差异，
新增能力时请改注册表（并让测试守住），不要只改这里——那正是历史上出现"预览画了、PPTX 丢了"
却无人告警的原因。

## 能力矩阵

| 能力 | 网页预览 | PPTX | 处理原则 |
| --- | --- | --- | --- |
| 文本 | Konva/浏览器字体度量 | PowerPoint/WPS 字体度量 | 保持可编辑；预留文本框高度 |
| 矩形/圆/椭圆 | 原生 | 原生 | 应保持可编辑 |
| **形状库（preset）** | 同一套几何构造 | OOXML preset | 见 `references/shape-library.md`；`preset`/`aspect`/`approximate` 三级可信度，后两级告警 |
| 自由路径 / 弧段 | 原生 | customGeometry | 两端共用点列，应保持可编辑 |
| 图片 | 浏览器图片 | PPT 图片 | 作为媒体对象报告；`sizing: cover/contain/crop` 两端一致 |
| SVG | 浏览器 SVG | Node 端转 PNG | 报告为 rasterized |
| 图表 | Konva 近似预览 | PowerPoint 原生图表 | 数据和显式选项一致，外观允许小差异 |
| **图表选项** | 同一份归一化选项 | 原生 IChartOpts | 键名与 PptxGenJS 同名；数值轴范围/网格线/图例位置/轴标题/数据标签组成/柱形方向与堆叠/环形开孔等 **49 项两端一致**（数字格式、标签位置、平滑曲线、标记造型为等价近似） |
| 表格 | 固定网格预览 | PowerPoint 原生表格 | 显式 rowH，仍需检查换行 |
| 渐变 | 真渐变 | 首色近似 | 告警；需要时预合成图片/SVG |
| text-path | 可预览 | 不支持 | 严格模式报错 |
| shape-path SVG data | 可预览 | 不支持 | 必须改为 pointArr 或 SVG 图片 |
| 伪元素/富文本混合样式 | 浏览器原生 | 无一一对应 | 告警并拆成显式叶子节点 |

### 已打通为两端一致（历史单向项）

以下字段过去只在单侧生效。它们现在都在两端实现，并由能力注册表标注为 `both`
（`tests/parity.mjs` 会断言这一点，防止回退）：

| 字段 | 过去的问题 | 现在 |
| --- | --- | --- |
| `strike` / `strikethrough` | 只有预览画删除线，PPTX 丢失 | 导出 `strike="sngStrike"`/`"dblStrike"` |
| `lineBeginArrowType` | 只有导出生效，预览不画起点箭头 | 预览按类型绘制（`arrow/triangle` 严格一致，`stealth/diamond/oval` 近似） |
| `bgRadius` | 只有预览生效 | 导出为 `roundRect` + `rectRadius`（单位英寸） |
| `wrap: false` | 预览忽略（仍换行） | 预览 `wrap="none"`、PPTX `bodyPr wrap="none"` |
| `ellipsis` | 单向且**无任何告警** | 仍为单向（PPTX 无截断），但校验器现在会告警 |
| 线条缺省色 | 预览 `#333333`，PPTX 不写 `<a:ln>`（走 PowerPoint 默认色） | 编译期统一补默认色 |
| 虚线族 | 只识别 `dash` | 完整族：`dash/dashDot/lgDash/lgDashDot/lgDashDotDot/sysDash/sysDot` |
| `objectName` | 未写入 | 所有导出对象默认带元素 `id` 作为对象名，便于选择窗格定位 |

### 仍然单向的能力（必须显式标注）

这些不是缺陷，而是取舍；注册表会告警，`impact: metadata` 的则不告警（避免刷屏）：

- **仅 PPTX**：`ellipsis`（PPTX 无截断）、`fit`、`textDirection`/`vert`、`glow`/`outline`/`highlight`、
  上下标、段前段后距、`hyperlink`、`altText`、`objectName`、图片 `rounding`（椭圆裁切）。
- **仅预览**：`lineCap`/`lineJoin`、图片 `cornerRadius`、表格 `borderColor`、
  形状 `adjust`（PptxGenJS 无通用调整值入口）。
- **近似**：渐变压平、`stealth/diamond/oval` 箭头头部造型、`image-svg` 栅格化、
  `adjust` 未覆盖时的星形 `hf`/`vf` 缩放。

## 构建模式

默认是 `strict`：

- 校验错误立即中止。
- 图片下载/读取失败立即中止。
- 只有 prompt、没有实际图片资源时中止。
- 元素转换异常立即中止。
- 未知形状名、未知箭头类型、越界 `angleRange`、非法图片裁切框立即中止；不会静默退化。
- 语义容量超限、非法图表数据和未定义插值立即中止；不会截断内容。
- 预览运行时异常可见并阻止正常导出；损坏的 PNG 不会被静默替换为空白图片。

`--allow-partial` 只适合用户明确要调试中间结果时使用。最终交付不得有 `failed` 或 `skipped`。

## 转换报告

`build_pptx.mjs` 和 `build_all.mjs` 生成 `*.report.json`：

- `editable`：文本、形状、图表、表格等 PowerPoint 对象。
- `rasterized`：图片和 Node 端栅格化后的 SVG。
- `failed`：转换失败；严格模式不会产生最终文件。
- `skipped`：没有进入输出；最终交付必须为 0。

逐元素记录 `originPath`，可回写文字另有 `sourcePath`。计数描述的是编译后的对象，不等于对全部事实或文字的完整性证明；必须同时检查源内容和图表数据。

`build_all` 从同一份源快照构建，完整生成后才更新交付物；失败时保留上一份完整产物。`*.build.json` 记录源与交付物的 SHA-256，可区分旧文件和本次输出。浏览器改字与 CLI 使用相同编译、导出编排及 OOXML 修复代码。

## 验证层级

1. `check_deck`：结构、资源声明、文本估算、边界、对比度、形状可信度与**能力注册表派生的一致性告警**。
2. `make_preview`：自包含网页预览、文字回写和浏览器端导出。
3. `build_pptx`：严格转换、OOXML 修复和转换报告。
4. `check_preview`：真实 Chrome/Edge 渲染、资源加载、实测文字高度，支持输出逐页 PNG。`build_all --check-browser` 可接入该检查。
5. 可用 PowerPoint/LibreOffice 时，将 PPTX 渲染为图片，与网页截图核对。原生图表的标签避让和字体抗锯齿允许小差异，缺元素、数据失真和溢出不允许。

回归测试分工：

- `npm test`：`smoke` / `shapes` / `semantic-layouts` / `integration` / `parity` / `regressions`，均不依赖浏览器。
  - `shapes`：91 个形状的几何自检（坐标必须落在包围盒内、曲线上点严格校验、`exact` 分类分布）与**文档防漂移**。
  - `parity`：选项映射 + 能力注册表 + **真实生成的 OOXML 断言**（preset 名、adj 调整值、`srcRect` 裁切百分比、
    `strike`、`wrap`、对象名、虚线、箭头头部，以及图表 `c:max`/`c:majorGridlines`/`c:barDir`/`c:holeSize`/`c:smooth`）——"原生文件正确"的唯一证据。
  - 每个受支持的图表选项都必须在能力注册表登记，`parity` 会逐个断言，防止新增选项时漏掉一致性声明。
- `npm run test:browser`：额外执行真实浏览器改字导出与 CSS 提取。

## 字体

字体是跨端差异的最大来源。默认中文使用 Microsoft YaHei；跨平台交付时应选择双方都有的字体，或明确接受替换。不要依赖浏览器下载的临时 Web Font。

默认 `fontScale:0.75` 对应视觉等大。旧版统一缩小字体的行为可用 `fontScale:0.6666666667` 显式恢复。静态高度估算不能替代实际字体测量，测量通过也不能保证另一台电脑上的字体完全相同。

**文字换行是当前唯一无法靠架构消除的不一致源**：Konva 与 PowerPoint 是两套文本引擎，
`estimateWrappedHeight` 只做估算。这是校验通过后仍必须实际打开 PPTX 核对的首要原因。
