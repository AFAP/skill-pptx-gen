# 图片版 PPT 还原为可编辑 deck

当输入是一张或多张 PPT 截图、图片版 PPT、扫描件或网页截图，并且目标是得到可编辑 PPTX 时，按本指南执行。

## 1. 核心目标

- 文字、KPI、正文、图表、表格保持可编辑。
- 只把照片、产品图、Logo、复杂图标和纹理局部栅格化。
- 不把整页截图直接当背景交付，除非用户明确接受不可编辑的视觉复刻。
- 允许字体、图表外观有小差异，但缺元素、错位、溢出、不可编辑必须视为失败。

## 2. 输入预处理

- 手机拍屏：先裁掉边框、桌面和反光区域，必要时做透视校正。
- 截图/导出图：确认画布比例是否为 16:9，必要时裁成 1280×720 逻辑画布。
- 多页材料：先按页拆分，每页单独记录标题、页面角色和信息密度。
- 模糊或低分辨率图：文字区域优先重新 OCR；图标和照片允许局部栅格化。
## 3. 视觉结构分析

先不要写坐标，先让模型输出：

- 页面角色：封面、目录、内容、数据、对比、流程、结尾。
- 区域结构：header / row / card / ribbon / banner / footer。
- 阅读顺序：上到下、左到右。
- 每个区域里的信息类型：标题、副标题、KPI、正文、备注、图表、图片、Logo。

建议先产出一份内部结构 JSON，例如：

```json
{
  "role": "content",
  "blocks": [
    { "type": "header", "title": "...", "subtitle": "..." },
    { "type": "row", "ribbon": "Business Opportunity", "items": ["KPI", "KPI", "image"] }
  ]
}
```

## 4. 元素分类

- 可编辑：标题、副标题、KPI 数字、单位、标签、正文、列表、页码。
- 可编辑几何：背景色块、卡片、箭头、缎带、分割线、Banner。
- 媒体对象：产品照片、人物、品牌 Logo、复杂插画、纹理。
- 图标：优先 `image-svg`；小图标也可用简单 SVG 几何。
- 图表/表格：有原始数据时重建为原生 chart/table，不要当图片。

## 5. 选择重建路线

- Creative DSL：固定复杂版式、箭头/缎带/KPI 行，可编辑性最好。
- WebSlide：CSS Grid/Flex 排三行结构更省力，提取后仍是 primitive。
- Hybrid：复杂照片或纹理做局部图片，文字和数据仍用可编辑元素。
## 6. 分层重建

按以下顺序放入 elements：

1. 背景全屏 shape-rect
2. 卡片、浅色内容区
3. 缎带、箭头、色块
4. 图标、Logo、产品图
5. 标题、KPI、正文、页脚
6. 分割线和装饰

三行结构优先用 group + repeat + styleClass，不要复制三遍坐标。

## 7. 坐标与几何

- 画布固定 1280×720。
- 左侧缎带用 shape-path；局部坐标时 minX≈0、minY≈0、maxX≈width、maxY≈height。
- 画布绝对坐标用 coordinateMode:"absolute"，构建器会自动重算外框。
- 卡片圆角和描边保持统一；KPI 数字和标签分开成独立 text。
- 页脚小字可以保留为 text，也可以局部图片化，但必须在报告中说明。
## 8. 构建与验证

node tools/check_deck.mjs deck.json --json
node tools/build_all.mjs deck.json -o output --check-browser

检查：
没有浏览器时说明未实测
- report.summary.failed = 0
- report.summary.skipped = 0
- 文字、形状、图表、表格为 editable
- 照片、图标、SVG 为 rasterized
- warning 逐条处理或在交付中说明

## 9. 视觉对比

- 打开 preview HTML，100% 或适应宽度检查。
- 有 Chrome/Edge 时运行：
  node tools/check_preview.mjs output/preview.html --json --screenshots output/screenshots
- 逐页看：标题层级、行高一致性、箭头形状、KPI 对齐、图标位置、图片裁切、页脚页码。
- 最后在 PowerPoint/WPS 打开 PPTX，确认无修复提示、对象可编辑、字体换行正常。

## 10. 常见错误

- 把整页截图当背景，导致全部文字不可编辑。
- 一个 text 塞整行，导致换行和局部对齐不可控。
- 箭头/缎带用图片代替，丢掉可编辑形状。
- 只 OCR 内容，不保留 KPI 层级和阅读顺序。
- 忽略 report 的 rasterized/skipped/failed。

## 11. 可直接给 AI 的提示词

把这张图片 PPT 还原成可编辑 PPTX，使用 ppt-gen skill。
要求：文字/KPI/正文/图表/表格可编辑；只把照片、Logo、复杂图标局部栅格化。
先做页面结构分析，再选择 Creative DSL 或 WebSlide；用 group/repeat/styleClass 复用重复结构。
运行 build_all，检查 failed=0 和 skipped=0，并逐页做视觉对比，最后在 PowerPoint/WPS 打开确认。

> 敏感项目的实际截图、deck 和产物不要提交到仓库；需要时在本地 output/ 或 .tmp/ 中生成并自行清理。
