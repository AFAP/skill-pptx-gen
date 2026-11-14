---
name: ppt-gen
description: 把内容、文档、数据或报告制作成可编辑的 PPTX。用于制作 PPT、幻灯片、演示文稿、slide deck，或根据参考图还原版式；支持网页预览改字和再次导出。
version: "2.4.0"
display_name: AI PPT 生成器
display_name_en: AI PPT Generator
category: office
author: 阿富
description_zh: "把报告、文档和数据整理成可编辑 PPT，支持参考图版式还原、网页预览改字与导出；本地有生图技能时可按需生成局部配图。文字、形状、图表和表格可继续编辑，并附转换检查报告。"
description_en: "Turn reports, documents and data into editable PowerPoint slides. Recreate reference layouts, edit text in a web preview and optionally use an available local image-generation skill for illustrations. Export PPTX with a conversion report."
examples_zh:
  - "把这份报告整理成 10 页管理层汇报，保留关键数据与来源；本地有生图技能时按需配插画，交付可编辑 PPT 和网页预览。"
  - "参考这张截图还原一页 PPT，标题、正文和主要图形保持可编辑，复杂背景可以局部使用图片。"
  - "把这组季度数据做成 5 页分析汇报，使用可编辑图表，说明主要变化，并提供可改字的网页预览。"
examples_en:
  - "Turn this report into a 10-slide executive presentation. Preserve key data and sources, use a local image-generation skill for suitable illustrations if available, and deliver editable PPTX plus a web preview."
  - "Recreate this reference screenshot as a slide. Keep text and key shapes editable; use images for complex background details."
  - "Create a 5-slide analysis from this quarterly data, with editable charts, key findings and a web preview where I can edit text."
---

# 可编辑 PPT 创作

根据内容关系决定叙事和构图，通过统一编译器生成网页预览与 PPTX。默认用 Creative DSL；需要普通清单或快速交付时可用 Compact，同一套幻灯片可以混用。

## 开始前

在本 `SKILL.md` 所在目录运行命令，用户材料和输出路径使用绝对路径。首次使用或环境变化后先执行：

```bash
node tools/doctor.mjs
# 缺少基础依赖时：npm ci
```

Node.js 要求 **≥20.9.0**。需要 SVG 时预检加 `--require-svg`；需要 HTML 提取或浏览器实测时加 `--require-browser`，可同时使用。先解决必需能力的错误，再开始创作；诊断与安装方式见 [故障排查](references/troubleshooting.md)。

创作前同时查看当前 agent 的技能清单或技能发现工具：若本地有可调用的生图技能，读取其说明，并在适合的页面主动生成局部插画、场景或背景素材；没有则按现有方式继续。生图不是运行依赖，`doctor` 不负责检测 agent 技能。选页、提示词与图片落地见 [按需生图](references/image-generation.md)。

## 选择入口与参考

只读取当前任务需要的资料；多页新稿先看 [创作工作流](references/creative-authoring.md)。

| 当前任务 | 按需读取 |
| --- | --- |
| 关键结论、机制、关系或自由构图（Creative DSL） | [DSL 规范](references/dsl-schema.md)，用 `styleClass/group/repeat/anchor` 复用结构 |
| 普通目录、章节、列表（Compact） | [语义版式](references/layout-dsl.md) |
| HTML/CSS 构图或已有网页（WebSlide） | [WebSlide 协议](references/webslide.md)，只提取显式 `data-ppt` 节点 |
| 长文档、多章节报告 | [内容拆页](references/content-to-deck.md) |
| 参考图风格或精确复刻 | [参考图分析](references/reference-image-analysis.md)，按用户意图选择重新构图或复刻模式 |
| 本地有生图技能，部分页面适合插画、场景或氛围背景 | [按需生图](references/image-generation.md)，生成局部素材并叠加可编辑内容 |
| 图片版 PPT、截图还原成可编辑稿 | [图片版还原](references/image-to-editable-deck.md) |
| 标准图形 / 特殊几何 | [形状库](references/shape-library.md) / [几何配方](references/design-system.md)，只读所需部分 |
| 配色、字体和主题 | [样式](references/styles.md)；默认 `navy-report`，默认色板见 [主题令牌](references/builtin-template.md) |
| 转换差异、告警和降级 | [一致性契约](references/parity-contract.md) |
| 单步命令、可选参数、预览回写 | [命令与编辑](references/cli.md) |

## 执行与验收

1. 多页或长文档先做简短页面计划，写清每页结论、证据和表达方式；单页无需额外计划文件。
2. 建立共享主题与样式，按内容选择入口。保留用户要求覆盖的内容；事实、推断和假设分清，不为装饰编造数据。
3. HTML 先提取，其余入口直接保存为 `deck.json`：

   ```bash
   node tools/html_to_deck.mjs /absolute/slides.html -o /absolute/deck.json
   ```

4. 一键严格构建：

   ```bash
   node tools/build_all.mjs /absolute/deck.json -o /absolute/output
   ```

   可用 Chrome/Edge 时加 `--check-browser`；逐页 PNG 可用 `node tools/check_preview.mjs /absolute/output/deck.preview.html --screenshots /absolute/output/slides` 导出。

5. 检查整套缩略图和逐页全尺寸预览，处理或说明每条告警。报告的 `failed`、`skipped` 必须均为 0。实际渲染 PPTX 检查字体、换行和图表；缺少对应环境时明确说明未完成的视觉检查。
6. 交付 PPTX、预览和转换报告，并保留源 JSON 供后续修改。校验通过不代表内容或构图已经合格。

## 必要边界与修改

- 文字、关键数据、形状、图表和表格默认保持可编辑；照片、纹理、复杂背景可局部栅格化。不默认用含文字的整页图片代替可编辑稿。
- 严格构建失败时修复源文件或资源；仅在用户明确接受不完整输出时用 `--allow-partial`，不用 `--no-validate` 掩盖错误。
- 浏览器与 PPTX 字体度量、原生图表外观可能不同；转换边界以校验告警和一致性契约为准。
- 预览可双击有 `sourcePath` 的文字修改，保留数据类型并重新编译；混合插值、序号等派生文字只读。下载的新 JSON 保留主题与宏，但相对图片路径仍需对应原资源目录。
- 浏览器不会覆盖磁盘源文件。后续迭代更新源 JSON，再重建；不直接修改编译稿、内嵌 HTML 或 `sourcePath`。改字与导出细节见 [命令与编辑](references/cli.md)。
