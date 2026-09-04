# PPT-DSL primitive 规范

这是编译后的底层 JSON 中间层，同时驱动 Konva 网页预览与 PptxGenJS PPTX 导出。普通页面优先使用 [紧凑语义版式](layout-dsl.md)，只有精确定位或局部覆盖时才直接写本规范，以减少 token 和重复坐标。

机器可读基础约束见 [deck.schema.json](deck.schema.json)；能力、资源和几何的严格检查以 `tools/check_deck.mjs` 为准。

## 顶层结构

```json
{
  "dslVersion": 2,
  "meta":  { "title": "演示标题", "author": "作者" },
  "style": "clean-minimal",
  "theme": "可选，字符串或主题对象；存在时覆盖 style",
  "slides": [
    {
      "background": "#FFFFFF",            // 可选，默认取 theme.background
      "notes": "演讲者备注",               // 可选
      "elements": [ /* elop 数组，按数组顺序叠放（后绘制在上层） */ ]
    }
  ]
}
```

## 坐标与单位

| 概念 | 值 |
| --- | --- |
| 画布 | 1280 × 720 **px**（16:9），原点左上 |
| 导出尺寸 | 13.333 × 7.5 inch（PPT LAYOUT_WIDE） |
| 换算 | 转换核心自动处理：px → inch（÷96）；fontSize px → pt（× theme.fontScale，默认 0.667） |
| 安全边距 | 左右 60-80px，上下 40-60px |

> fontScale 说明：视觉等大是 0.75（1280px 画布 = 960pt 宽）。默认 0.667 是经验值，
> 为 PowerPoint 中文字体的更大行高预留约 11% 余量，防止导出后文字溢出。
> 发现导出文字整体偏小，把 `theme.fontScale` 调到 0.72-0.75。

## 颜色与主题令牌

- 颜色值支持：`#RGB`、`#RRGGBB`、`#RRGGBBAA`（末两位透明度）、`rgb()/rgba()`。
- 令牌（元素任意颜色字段可用）：
  - `$primary` `$accent` `$accentText` `$onAccent` `$surface` `$surfaceAlt` `$border` `$bg` `$text` `$text2` `$white` `$black`
  - `$1`…`$9` → theme.palette 第 1~9 色（实际可用到 `$N` 取决于 palette 长度；内置主题均为 6-9 色）
  - `$light:$primary` → 某令牌/色值的浅填充版（HSL 提亮，适合做卡片底色）
- 令牌在构建/预览生成时解析为最终色值。

## 通用属性（所有元素）

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `elType` | string | 必填，元素类型（见下表） |
| `id` | string | 推荐，稳定元素 ID；用于报告和诊断 |
| `role` | string | 可选，title/body/footer 等语义角色 |
| `sourcePath` | string | 编译器生成的 JSON Pointer；预览改字时回写语义源 |
| `x` `y` | number(px) | 左上角（`shape-circle` 例外：圆心） |
| `width` `height` | number(px) | 尺寸 |
| `opacity` | 0-1 | 整体透明度 |
| `rotation` | number(deg) | 旋转 |
| `allowOverflow` | boolean | 明确允许元素越出 1280×720 时跳过边界告警；最终 PPTX 仍应实际渲染检查 |
| `allowOverlap` | boolean | 明确允许该文本框与其他文本框叠放时跳过疑似重叠告警 |
| `fill` | 颜色 / `{color, transparency}` / `{type:"gradient", stops:[{offset,color}], angle}` | 填充。**渐变仅预览显示真渐变；导出 PPTX 压平为首色**（可编辑性限制，校验器会提示），要真渐变用 `image-svg` 或图片 |
| `stroke` / `strokeWidth` | 颜色 / px | 描边 |
| `dashType` | `"dash"` | 虚线 |
| `shadowColor` `shadowBlur` `shadowOffsetX/Y` `shadowOpacity` | 阴影（Konva 风格） | 自动转换为 PPT outer shadow |
| `cornerRadius` | px | shape-rect 圆角；图片圆角仅预览可见，PPTX 不原生裁圆角 |
| `webUnsupported` | string[] | WebSlide 提取器记录的 CSS 降级项；校验器会告警 |

## 元素类型

### text — 文本
```json
{"elType":"text","text":"内容\n换行","x":60,"y":60,"width":600,"height":50,
 "fontSize":20,"fontStyle":"bold|italic|bold italic","fill":"$text",
 "fontFamily":"Georgia","align":"left|center|right","verticalAlign":"top|middle|bottom",
 "lineHeight":1.5,"letterSpacing":2,"padding":8,"underline":true}
```
- `fontStyle` 字符串含 `bold`/`italic` 即生效；也可用布尔 `bold`/`italic`。
- `lineHeight` 导出为 lineSpacingMultiple（0.5-3）。
- **`fill` 对 text 是字体颜色**（Konva 约定），不会成为文本框底色；
  需要带底色的文本框时用 `bgFill`（如 `"bgFill":"#1E3A5F"`），别用 `fill`。
- 浅色表面上的强调文字用 `$accentText`；`$accent` 主要用于装饰和填充；accent 色块上的文字用 `$onAccent`。
- 文本框可带 `stroke`/`shadow`。

### image — 图片
```json
{"elType":"image","path":"URL或本地路径或留空","prompt":"AI生图描述(英文)","ratio":"16:9",
 "x":60,"y":180,"width":540,"height":300,"sizing":{"type":"cover"}}
```
- 图片来源优先级：`path`/`url`（http(s) 下载、本地相对 deck.json 路径）→ 生成 base64 嵌入。
- 只有 `prompt` 时严格构建会失败。生图完成后必须补 `path` 或 `data`，不允许最终导出静默跳过。
- 也可直接给 `data`（data URI），预览/导出均支持。
- `sizing.type`: `cover`（默认裁满）/ `contain`（完整容纳）。
- `cornerRadius` 只在网页预览中裁切；需要 PPTX 也保留图片圆角时，先把透明圆角栅格化进图片本身。
- `rounding:true` 表示椭圆/圆形图片裁切，不等价于普通圆角矩形。

### image-svg — SVG 矢量图
```json
{"elType":"image-svg","x":100,"y":100,"width":64,"height":64,
 "svgXml":"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>...</svg>"}
```
- Node 端导出：由可选依赖 sharp 预栅格化为 PNG（2x）；未安装时该元素会记为失败，严格构建会中止。浏览器端导出由 pptxgenjs 栅格化 SVG，不受影响。

### shape-rect — 矩形/圆角矩形
```json
{"elType":"shape-rect","x":0,"y":0,"width":1280,"height":720,"fill":"$bg",
 "cornerRadius":16,"stroke":"#E2E8F0","strokeWidth":1.5,
 "shadowColor":"rgba(0,0,0,0.10)","shadowBlur":20,"shadowOffsetY":8}
```
- `cornerRadius` > 0 → PPT roundRect（可编辑），0/缺省 → rect。
- `shape-circle` 若只给 `width`，`height` 回退为 `width`；也支持 `radius`（半径）替代 width/height。

### shape-circle — 圆/椭圆（**x/y 为圆心**）
```json
{"elType":"shape-circle","x":640,"y":300,"width":56,"height":56,"fill":"$primary"}
```

### shape-line / shape-arrow — 直线/箭头
```json
{"elType":"shape-line","pointArr":[{"x":120,"y":300},{"x":1160,"y":300}],
 "lineColor":"#CBD5E1","lineWidth":3,"dashType":"dash","lineEndArrowType":"arrow"}
```
- `shape-arrow` 默认带 stealth 箭头（多段折线同样生效）；`shape-line` 指定 `lineEndArrowType` 时预览与导出都会画箭头。
- `lineEndArrowType`: `arrow|triangle|stealth|diamond|oval|none`。
- **多点折线**：pointArr 超过 2 点时，导出端自动走 customGeometry（全程折线，箭头尾端仍生效），与预览一致；两点时走原生 line。
- pointArr 的 x/y 为画布绝对坐标（shape-line/arrow 以点为锚；shape-path/curve-quadratic 的 x/y 是路径元素的参考原点，通常设 0,0 更直观）。

### curve-quadratic — 二次贝塞尔曲线（连接线）
```json
{"elType":"curve-quadratic","x":0,"y":0,"width":600,"height":200,"stroke":"$accent","strokeWidth":2,
 "pointArr":[{"x":0,"y":0},{"x":300,"y":100,"controlPoint":{"x":150,"y":0,"type":"quadratic"}}]}
```
- 导出为 PPT 自定义几何（可编辑顶点）。
- **脑图/hub 布局的连线不用手写 pointArr，用下面的连接线宏。**

### shape-path — 自由路径
- `pointArr`（同上，可含 `curve:{type:"arc",hR,wR,stAng,swAng}` 圆弧；hR/wR 单位 px，构建时自动换算）→ 导出自定义几何。
- `data`/`svgPath`（SVG path 字符串）只有预览支持，严格校验会报错；要导出 PPTX 必须改用 `pointArr` 或完整 `image-svg`。

## 连接线与弧形宏（构建期展开，源自原项目脑图布局函数）

脑图/辐射/轨道布局的连接线几何极易手写出错，用这三个宏即可——`core/connectors.mjs`
在构建/预览生成阶段展开为标准元素（curve-quadratic / shape-path），
Konva 预览与 PPTX 导出自动一致：

### connector-s — 脑图标准连接线（单条三次贝塞尔）
```json
{"elType":"connector-s","x1":640,"y1":240,"x2":320,"y2":380,
 "stroke":"$text2","strokeWidth":2,"dashType":"dash","orientation":"h"}
```
- 从 (x1,y1) 到 (x2,y2)，控制手柄按连线形态自适应，也可用 `orientation` 强制：
  - **强纵向**（|dy|≥2|dx|）或 `orientation:"v"`：竖直切线出入 → top-hub 布局的 S 下落
  - **强横向**（|dx|≥2|dy|）或 `orientation:"h"`：水平切线出入 → left-hub / 左右树形
  - **对角连接**（auto 默认）：手柄沿连线方向 → 柔和近直线（不会像轴对齐 S 那样甩成大圆弧）
- hub 脑图建议显式指定 `orientation` 并加 `dashType:"dash"`（虚线 S 是经典脑图视觉）。
- 中心主题向四周发散时，起点取主题边缘、终点取子卡片边缘。

### connector-elbow — 直角肘形连接线（组织架构图风格）
```json
{"elType":"connector-elbow","x1":640,"y1":360,"x2":900,"y2":520,
 "orientation":"h-first","stroke":"$text2","strokeWidth":2}
```
- `orientation`：`h-first` 先横后竖（|dx|>|dy| 时默认）/ `v-first` 先竖后横。

### arc-segment — 圆环扇段（弧形轨道流布局）
```json
{"elType":"arc-segment","cx":640,"cy":400,"rOuter":240,"rInner":175,
 "startAngle":-30,"endAngle":90,"fill":"$2","opacity":0.9}
```
- 角度制：0°=正右，顺时针为正。外弧顺时针扫过、内弧返回，闭合为甜甜圈扇区。
- 扫角自动归一化到 (0,360]：跨 0° 写法（如 startAngle:270, endAngle:25）自动按 +115° 处理；>360° 会取模。
- `arrow`（默认 true）在段尾生成箭头尖并在段首留 V 形缺口；`arrowAngle` 默认 6°。
- N 段轨道：startAngle 按 `i×(360/N)+缝隙角`、endAngle 按 `(i+1)×(360/N)-缝隙角` 分配，palette 循环填色。

### chart — 图表（导出为真实可编辑图表）
```json
{"elType":"chart","chartType":"bar|line|pie|doughnut|area|radar|scatter",
 "x":60,"y":180,"width":640,"height":420,
 "labels":["Q1","Q2","Q3"],
 "data":[{"name":"系列A","values":[12,18,26]},{"name":"系列B","values":[5,14,28]}],
 "chartColors":["#3182CE","#C9A96E"],"showLegend":true,"chartTitle":"标题","showTitle":true}
```
- `chartColors` 缺省取 theme.palette 前 6 色。
- pie/doughnut 只用第一个系列的 values。
- scatter 的 `values` 为 `[[x,y],...]` 数字对。
- `showLegend` 默认 `false`；只有显式写 `true` 才在预览和 PPTX 显示图例。
- `showValue:true` 可在柱/线/面积图上显示数值标签；预览同步绘制。

### table — 表格（导出为真实可编辑表格）
```json
{"elType":"table","x":120,"y":540,"width":1040,"height":160,"fontSize":14,
 "header":{"fill":"$primary","color":"#FFFFFF","bold":true},
 "stripeColor":"#F7FAFC","align":"left",
 "rows":[["表头1","表头2"],["数据","数据"]]}
```

### text-path — 路径文字
- 仅 Konva 预览支持，严格校验会报错。改用普通 `text`；若外观必须固定，将不含关键可编辑文字的局部预合成为 SVG/PNG。

## 常见陷阱

1. `shape-circle` 圆心坐标 ≠ 其他元素的左上角坐标。
2. 文本高度不足是最常见的导出翻车原因：估算 `行数 × fontSize × lineHeight ≤ height`。
3. 元素叠放顺序 = 数组顺序；背景元素放最前。
4. 每页都要有全屏背景 shape-rect（或 slide.background），否则预览默认白底、导出可能透出母版底色。
5. JSON 不允许注释、尾逗号、单引号。
6. emoji 在 Windows PowerPoint 中渲染为彩色、在部分 WPS/Mac 中风格不同；关键图标用 image-svg。
7. 未知 `chartType`、只有 prompt 的图片、`text-path` 和 SVG path data 都是严格错误，不会回退成别的对象。
8. `webUnsupported` 表示已知降级，必须逐条判断是接受、重做为原生元素，还是局部栅格化。
