# 转换一致性契约

“网页预览与 PPTX 共用数据源”不等于“两个渲染器像素完全相同”。本项目保证可追踪转换和明确降级，不隐藏差异。

## 能力矩阵

| 能力 | 网页预览 | PPTX | 处理原则 |
| --- | --- | --- | --- |
| 文本 | Konva/浏览器字体度量 | PowerPoint/WPS 字体度量 | 保持可编辑；预留文本框高度 |
| 矩形/圆/线 | 原生 | 原生 | 应保持可编辑 |
| 图片 | 浏览器图片 | PPT 图片 | 作为媒体对象报告 |
| SVG | 浏览器 SVG | Node 端转 PNG | 报告为 rasterized |
| 图表 | Konva 近似预览 | PowerPoint 原生图表 | 数据和显式选项一致，外观允许小差异 |
| 表格 | 固定网格预览 | PowerPoint 原生表格 | 显式 rowH，仍需检查换行 |
| 渐变 | 真渐变 | 首色近似 | 告警；需要时预合成图片/SVG |
| text-path | 可预览 | 不支持 | 严格模式报错 |
| shape-path SVG data | 可预览 | 不支持 | 必须改为 pointArr 或 SVG 图片 |
| 伪元素/富文本混合样式 | 浏览器原生 | 无一一对应 | 告警并拆成显式叶子节点 |

## 构建模式

默认是 `strict`：

- 校验错误立即中止。
- 图片下载/读取失败立即中止。
- 只有 prompt、没有实际图片资源时中止。
- 元素转换异常立即中止。

`--allow-partial` 只适合用户明确要调试中间结果时使用。最终交付不得有 `failed` 或 `skipped`。

## 转换报告

`build_pptx.mjs` 和 `build_all.mjs` 生成 `*.report.json`：

- `editable`：文本、形状、图表、表格等 PowerPoint 对象。
- `rasterized`：图片和 Node 端栅格化后的 SVG。
- `failed`：转换失败；严格模式不会产生最终文件。
- `skipped`：没有进入输出；最终交付必须为 0。

## 验证层级

1. `check_deck`：结构、资源声明、文本估算、边界、对比度和能力告警。
2. `make_preview`：自包含网页预览、文字回写和浏览器端导出。
3. `build_pptx`：严格转换、OOXML 修复和转换报告。
4. 可用 PowerPoint/LibreOffice 时，将 PPTX 渲染为图片，与网页截图做叠加检查。原生图表和字体允许小差异，缺元素、错位和溢出不允许。

## 字体

字体是跨端差异的最大来源。默认中文使用 Microsoft YaHei；跨平台交付时应选择双方都有的字体，或明确接受替换。不要依赖浏览器下载的临时 Web Font。
