# 参考图分析与落地协议

用户提供 PPT 截图、网页截图、设计稿或海报时，逐张查看后再生成内容。目标是提取可复用的视觉令牌和页面规律，而不是把截图中的偶然细节误判为完整品牌规范。

## 1. 先识别页面角色

记录每张图更接近 `cover`、`section`、`agenda`、`cards`、`metrics`、`split`、`comparison`、`timeline`、`chart-insight`、`quote` 或 `ending` 中的哪一种。多张截图要分别标注角色，不要把封面的规则直接套给数据页。

同时记录：

- 可以直接观察到的事实，例如背景色、标题位置、卡片间距、是否有页码。
- 只能推测的规律，例如未展示页面的布局；这些项要标为低置信度并沿用基础预设。
- 无法确认的字体或色值；选择最接近且跨端可用的替代值，不假装精确识别。

## 2. 提取样式令牌

内部使用下列结构即可，不必把分析过程写入交付物：

```json
{
  "baseStyle": "clean-minimal",
  "confidence": "high | medium | low",
  "themeOverrides": {
    "background": "#F6F7F9",
    "surface": "#FFFFFF",
    "surfaceAlt": "#EEF1F5",
    "primary": "#173B57",
    "accent": "#E86A33",
    "text": "#1F2933",
    "textSecondary": "#667085",
    "border": "#DCE1E7",
    "palette": ["#173B57", "#E86A33", "#4B7A9B", "#8AA7B8"],
    "fontFamily": "Microsoft YaHei",
    "radius": 12,
    "pagePadding": 64,
    "titleMarker": "line",
    "footer": true
  },
  "typography": {
    "heading": "左对齐、粗体、高对比",
    "body": "常规字重、短行",
    "observedSizes": "约 44/24/17 px"
  },
  "pageRules": {
    "cover": "左侧标题，右侧主视觉",
    "content": "三列卡片，20px 间距",
    "data": "白卡、大数字、弱网格线"
  },
  "recurringDecorations": ["标题下短线", "右下角页码"],
  "renderStrategy": {
    "mode": "elements | hybrid | full-raster",
    "rasterRegions": ["右侧插画"],
    "reason": "插画没有稳定的 PPT 原生等价物"
  }
}
```

优先从 [styles.md](styles.md) 选最接近的 `baseStyle`，再只覆盖确实观察到的字段。这样比从零生成整套 theme 更省 token，也更稳定。

## 3. 选择渲染策略

### elements（默认）

纯色背景、文字、线条、普通卡片、指标、表格和图表都使用可编辑元素。参考图即使很复杂，也不要因此把本可编辑的文字和数据一起变成图片。

### hybrid（复杂视觉的默认降级）

只把没有可靠 PPT 等价物的局部做成 SVG/PNG，例如摄影、3D、手绘、水墨、颗粒、纸张纹理、复杂渐变或插画。图片中不要包含必须准确显示的标题、正文、数字或图表标签；这些内容另用可编辑元素叠加。

若需要生成图片，提示词描述画面与留白位置，并明确 `no text, no letters, no numbers, no watermark`。生成后把实际资源路径写入 `path` 或 `data`，不能只留下 `prompt`。

### full-raster（仅显式接受时）

只有用户明确把“视觉像素还原”置于“可编辑、可访问、文字可靠”之上，并接受整页不可编辑时，才使用整页图片。中文或关键数字不得依赖图片生成模型准确书写。

## 4. 落地检查

- 色板、圆角、边框、页面边距和固定装饰在各页保持一致。
- 截图裁切、阴影或透视造成的颜色偏差不应变成新令牌。
- 一张截图没有展示的页面角色继续使用基础预设，不凭空发明规则。
- `build_all` 报告里的 `failed` 和 `skipped` 必须为 0；局部图片应明确显示为 `rasterized`。
- 与截图比较时优先检查信息层级、相对位置和节奏；字体替换与原生图表的小幅差异单独记录。

## 示例

参考图是深蓝底、金色细线、白色衬线标题，且只有封面：选择 `navy-report`，覆盖背景、强调色和字体；只把“封面左标题、金色短线”作为高置信度规则。内容页继续使用 `navy-report` 的默认结构，而不是推断所有页面都必须深色。
