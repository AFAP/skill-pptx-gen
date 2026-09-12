# PPT-DSL primitive 规范

这是底层 JSON 中间层，同时驱动 Konva 网页预览与 PptxGenJS PPTX 导出。可直接使用本规范和 Creative DSL 自由构图；能用 [紧凑语义版式](layout-dsl.md) 准确表达的页面也可采用 Compact 节省 token。

机器可读基础约束见 [deck.schema.json](deck.schema.json)；能力、资源和几何的严格检查以 `tools/check_deck.mjs` 为准。

## 顶层结构

```json
{
  "dslVersion": 3,
  "meta":  { "title": "演示标题", "author": "作者" },
  "style": "clean-minimal",
  "styleClasses": { "body": { "fontSize": 18, "fill": "$text" } },
  "slides": [
    {
      "background": "#FFFFFF",
      "notes": "演讲者备注",
      "elements": [{ "elType": "text", "styleClass": "body", "text": "正文", "x": 80, "y": 100, "width": 800, "height": 60 }]
    }
  ]
}
```

## 坐标与单位

| 概念 | 值 |
| --- | --- |
| 画布 | 1280 × 720 **px**（16:9），原点左上 |
| 导出尺寸 | 13.333 × 7.5 inch（PPT LAYOUT_WIDE） |
| 换算 | 转换核心自动处理：px → inch（÷96）；fontSize px → pt（× theme.fontScale，默认 0.75） |
| 安全边距 | 左右 60-80px，上下 40-60px |

默认 `fontScale:0.75` 保持视觉等大，不用全局缩小字体掩盖溢出。旧稿若需要原有大小，可显式设置 `theme.fontScale:0.6666666667`。字体、字号、行高与 padding 的默认值在共同编译层补齐；不同应用的字体度量仍需实测。

## Creative DSL 组合层

`styleClass`、`group`、`repeat` 和 `anchor` 只存在于源 deck。`compile-deck` 会先把它们展开成普通 primitive，再执行颜色解析、Konva 预览和 PPTX 导出。两个渲染器不会分别解释这些宏。

### styleClass — 复用视觉属性

```json
{
  "styleClasses": {
    "node": { "fill": "$surface", "stroke": "$border", "strokeWidth": 1, "cornerRadius": 12 },
    "nodeTitle": { "fontSize": 20, "fontStyle": "bold", "fill": "$text" }
  },
  "slides": [{
    "elements": [
      { "elType": "shape-rect", "styleClass": "node", "x": 80, "y": 160, "width": 280, "height": 140 },
      { "elType": "text", "styleClass": ["nodeTitle"], "text": "核心能力", "x": 108, "y": 190, "width": 220, "height": 36 }
    ]
  }]
}
```

类按书写顺序合并，元素自身字段最后覆盖。未知类在严格校验中报错。样式类可以保存常用尺寸，但优先用它复用视觉属性，不要借此把整页布局隐藏成不可读模板。

### group — 相对坐标分组

```json
{
  "elType": "group", "id": "product", "x": 120, "y": 180, "scale": 1,
  "defaults": { "fontFamily": "Microsoft YaHei" },
  "elements": [
    { "elType": "shape-circle", "id": "core", "x": 80, "y": 80, "width": 120, "height": 120, "fill": "$primary" },
    { "elType": "text", "id": "label", "text": "控制器", "x": 30, "y": 55, "width": 100, "height": 50, "fill": "$white", "align": "center" }
  ]
}
```

子元素坐标相对 group 原点。`scale` 会同时缩放位置、尺寸、字号和描边；`opacity` 乘到所有子元素；`defaults` 为子元素提供公共字段。编译后 ID 变为 `product-core`、`product-label`，便于锚点引用。

### repeat — 数据驱动重复

```json
{
  "elType": "repeat", "id": "milestones",
  "x": 120, "y": 220, "stepX": 220,
  "items": [
    { "year": "2024", "label": "验证" },
    { "year": "2025", "label": "放量" }
  ],
  "template": [
    { "elType": "shape-circle", "id": "dot", "x": 20, "y": 20, "width": 40, "height": 40, "fill": "$accent" },
    { "elType": "text", "id": "year", "text": "{{year}}", "x": 0, "y": 55, "width": 100, "height": 30 },
    { "elType": "text", "id": "label", "text": "{{label}}", "x": 0, "y": 92, "width": 150, "height": 36 }
  ]
}
```

- `{{field}}` 读取当前 item；`{{index}}` 从 0 开始，`{{number}}` 从 1 开始。
- `columns` 配合 `stepX/stepY` 可生成网格；没有 `columns` 时两个 step 都按索引累加。
- 模板中的 ID 自动变为 `milestones-0-dot` 等。
- 文本完全等于 `{{field}}`、`{{item}}`，或 primitive item 对应的 `{{value}}` 时，会保留到 `items[n]` 对应字段的编辑回写路径。
- `{{index}}`、`{{number}}`、固定模板文字和混合插值（如 `第 {{number}} 项`）都是派生结果，没有唯一源字段，因此在网页预览中只读；这样不会把改字错误写进模板或展开后的虚假路径。
- `repeat` 与 `group` 可以嵌套；内层 item 的同名字段覆盖外层，`index/number/item` 是当前循环的保留变量。内层 `items:"{{children}}"` 可直接读取父 item 数组。未定义变量立即报错。
- 网页修改绑定文字后会保留源字段类型、重新编译所有依赖对象；数字输入无效或新布局不合法时拒绝修改。嵌套模板也会保留真实 item 路径。

### anchor — 相对定位

```json
{
  "elType": "text", "id": "detail", "text": "下一层说明",
  "width": 240, "height": 50,
  "anchor": { "to": "hero", "edge": "bottom", "align": "left", "gap": 20 }
}
```

`to` 必须引用本页前面已经出现且具有边界的元素。`edge` 为 `left/right/top/bottom/center`，`align` 控制另一轴的 `left/right/top/bottom/center`，还可用 `dx/dy` 微调。group 内默认引用同组 ID；以 `#` 开头可引用本页的绝对 ID，例如 `"to":"#hero"`。

### 使用边界

- 组合宏只减少重复，不替 AI 决定页面构图。
- 元素数组仍决定最终叠放顺序；需要在节点后面的连接线应在展开前安排好层级。
- group 不支持旋转整个子树；需要旋转时对具体 primitive 设置 `rotation`。
- anchor 不做通用约束求解，目标必须先出现，避免循环依赖和两端实现差异。

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
| `originPath` | string | 编译器生成的来源位置，用于转换报告和诊断；并不表示该字段可编辑 |
| `x` `y` | number(px) | 左上角（`shape-circle` 例外：圆心） |
| `width` `height` | number(px) | 尺寸 |
| `opacity` | 0-1 | 整体透明度 |
| `rotation` | number(deg) | 围绕元素框中心旋转；圆/椭圆绕圆心 |
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
 "fontFamily":"Georgia","align":"left|center|right|justify","verticalAlign":"top|middle|bottom|center",
 "lineHeight":1.5,"letterSpacing":2,"padding":8,"underline":true}
```
- `fontStyle` 字符串含 `bold`/`italic` 即生效；也可用布尔 `bold`/`italic`。
- `verticalAlign` 接受 `center` 作为 `middle` 的别名（WebSlide 提取器可能产出任一种）。
- `lineHeight` 导出为 lineSpacingMultiple（0.5-3）。
- **`fill` 对 text 是字体颜色**（Konva 约定），不会成为文本框底色；
  需要带底色的文本框时用 `bgFill`（如 `"bgFill":"#1E3A5F"`），别用 `fill`。
- 浅色表面上的强调文字用 `$accentText`；`$accent` 主要用于装饰和填充；accent 色块上的文字用 `$onAccent`。
- 文本框可带 `shadow`（预览与导出均生效）。`stroke`/`strokeWidth` 只写入 PPTX，Konva 预览不绘制文字描边——需要预览也可见时改用 shape 叠加或图片。

### image — 图片
```json
{"elType":"image","path":"URL或本地路径或留空","prompt":"AI生图描述(英文)",
 "x":60,"y":180,"width":540,"height":300,"sizing":{"type":"cover"}}
```
- 图片来源优先级：`path`/`url`（http(s) 下载、本地相对 deck.json 路径）→ 生成 base64 嵌入。
- 只有 `prompt` 时严格构建会失败。生图完成后必须补 `path` 或 `data`，不允许最终导出静默跳过。
- 也可直接给 `data`（data URI），预览/导出均支持。
- `sizing.type`: `cover`（默认裁满）/ `contain`（完整容纳）。也接受简写字符串 `"sizing":"contain"`；语义版式 `split.image.sizing` 同样两种写法都可。
- 图片宽高比由 `width`/`height` 与 `sizing` 决定，没有独立的 `ratio` 字段。
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
- shape-line/arrow 的 pointArr x/y 为画布绝对坐标；curve-quadratic/shape-path 的坐标模式见各自小节，不能把绝对坐标和 x/y 混用。

### curve-quadratic — 二次贝塞尔曲线（连接线）
```json
{"elType":"curve-quadratic","x":0,"y":0,"width":600,"height":200,"stroke":"$accent","strokeWidth":2,
 "pointArr":[{"x":0,"y":0},{"x":300,"y":100,"controlPoint":{"x":150,"y":0,"type":"quadratic"}}]}
```
- 导出为 PPT 自定义几何（可编辑顶点）。
- **脑图/hub 布局的连线不用手写 pointArr，用下面的连接线宏。**

### shape-path — 自由路径
- `pointArr`（同上，可含 `curve:{type:"arc",hR,wR,stAng,swAng}` 圆弧；hR/wR 单位 px）→ 构建层先统一转换为 cubic，再导出自定义几何，避免 Konva 与 PowerPoint 对圆弧指令的解释差异。
- `data`/`svgPath`（SVG path 字符串）只有预览支持，严格校验会报错；要导出 PPTX 必须改用 `pointArr` 或完整 `image-svg`。
- 必须声明 `coordinateMode`：`local`（推荐）或 `absolute`；缺省 `auto` 会按点列是否超出声明外框自动判定。详见文末「shape-path 坐标约束」。

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
- 角度制：0°=正右，顺时针为正。外弧顺时针扫过、内弧返回，闭合为甜甜圈扇区；宏会在共同编译层展开为三次贝塞尔点列，两端使用同一几何。
- 扫角自动归一化到 (0,360]：跨 0° 写法（如 startAngle:270, endAngle:25）自动按 +115° 处理；>360° 会取模。
- `arrow`（默认 true）在段尾生成箭头尖并在段首留 V 形缺口；`arrowAngle` 默认 6°。
- 一个 `arc-segment` 元素只生成**一段**扇区；`startAngle`/`endAngle` 是必填字段，宏不会自行等分圆环。
  多段轨道由调用方自己按 `i×(360/N)+缝隙角` … `(i+1)×(360/N)-缝隙角` 计算每段角度，并逐段指定 `fill`
  （建议用 `$1`…`$9` 或显式色值；宏不会循环取 palette）。
- `rInner` 缺省为 `rOuter × 0.72`；`fill` 缺省为硬编码的 `#4A90E2`（不是主题色），建议显式指定。

### chart — 图表（导出为真实可编辑图表）
```json
{"elType":"chart","chartType":"bar|line|pie|doughnut|area|radar|scatter",
 "x":60,"y":180,"width":640,"height":420,
 "labels":["Q1","Q2","Q3"],
 "data":[{"name":"系列A","values":[12,18,26]},{"name":"系列B","values":[5,14,28]}],
 "chartColors":["#3182CE","#C9A96E"],"showLegend":true,"chartTitle":"标题","showTitle":true}
```
- `chartColors` 缺省取 theme.palette 前 6 色。
- pie/doughnut 只接受一个系列，必须非负且总和大于 0；多个系列会报错，不会忽略。
- scatter 的 `values` 为 `[[x,y],...]` 有限数字对。不同系列可以具有不同 X 值及重复 X；导出适配器会保存所有点。
- 其他图表的 values 必须是有限数字，所有系列使用相同分类标签和数量。缺省标签使用 1、2、3…；提供标签时数量必须匹配。
- 柱、线、面积图支持负数，预览与原生图表共用坐标范围。数值标签用 General 格式保留小数，不默认四舍五入为整数。
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

## 字段别名与次要属性

转换层接受以下别名与附加字段；新文件建议使用左列的主名称。

| 主名称 | 可用别名 / 附加字段 | 说明 |
| --- | --- | --- |
| `width` / `height` | `w` / `h` | 通用几何简写 |
| `rotation` | `rotate` | 同上，度 |
| `fill`（text） | `color` | text 的字体颜色两种写法都接受 |
| `verticalAlign` | `valign` | `center` 等价 `middle` |
| `dashType` | `dash` | 虚线 |
| `cornerRadius` | `rectRadius` | 矩形圆角 |
| `padding` | `inset` | 通用内边距 |
| `shadowColor`/`shadowBlur`/… | `shadow:{type,blur,offset,angle,color,opacity}`、`shadowType` | Konva 风格标量字段与对象式任选其一 |
| — | `flipH` / `flipV` | 水平/垂直翻转 |
| — | `lineBeginArrowType` | 线段起点箭头；**仅导出生效，预览只画终点箭头** |
| — | `closePath` | `shape-path` 是否闭合，默认闭合 |
| — | `bgOpacity` | `bgFill` 底色的不透明度（预览与导出均生效） |
| — | `bgRadius` / `strikethrough` / `wrap` / `ellipsis` | **仅预览生效**，导出忽略 |

`table` 额外支持 `header.enabled`（是否输出表头行）与 `height`（作为 `rowH`）；`borderColor` 仅预览生效。

`x`/`y`/`width`/`height`/`stepX`/`stepY`/`columns`/`scale`/`gap`/`dx`/`dy` 都接受**直接字段绑定**（如 `"height":"{{value}}"`），但只支持单个字段名——**不支持算式、函数或过滤器**（`{{320 - value}}` 会报错）。绑定只写在源文件，编译后即展开为字面量。

## 常见陷阱

1. `shape-circle` 圆心坐标 ≠ 其他元素的左上角坐标。
2. 文本高度不足是最常见的导出翻车原因：估算 `行数 × fontSize × lineHeight ≤ height`。
3. 元素叠放顺序 = 数组顺序；背景元素放最前。
4. `slide.background` 可以是颜色**或图片路径/URL**（后者同样预取并计入报告的 `rasterized`）；省略时两端使用 theme.background，不必额外添加全屏矩形。
5. 图片 `sizing` 两种写法等价：`"contain"` 与 `{"type":"contain"}`；语义版式 `split.image.sizing` 亦然。
6. JSON 不允许注释、尾逗号、单引号。
7. emoji 在 Windows PowerPoint 中渲染为彩色、在部分 WPS/Mac 中风格不同；关键图标用 image-svg。
8. 未知 `chartType`、只有 prompt 的图片、`text-path` 和 SVG path data 都是严格错误，不会回退成别的对象。
9. `webUnsupported` 表示已知降级，必须逐条判断是接受、重做为原生元素，还是局部栅格化。


## shape-path 坐标约束

`shape-path` 同时有外框和路径几何，必须明确坐标模式：

- `local`（推荐）：`pointArr` 是相对 `x/y` 的局部坐标；`minX≈0`、`minY≈0`、`maxX≈width`、`maxY≈height`。描边会向外扩 `strokeWidth/2`，要让选中框包住描边，`width/height` 应包含这部分。
- `absolute`：`pointArr` 是 1280×720 画布绝对坐标；建议 `x=0,y=0`。构建器会自动按点列包围盒 + `strokeWidth/2` 重算 `x/y/width/height`，并把点列转成局部坐标。
- 缺省 `auto`：点列在声明外框内时按 local；`x=0,y=0` 且点列超出声明外框时按 absolute 自动归一化；其余歧义直接报错。
绝对坐标示例（构建器会自动归一化）：

```json
{
  "elType": "shape-path",
  "coordinateMode": "absolute",
  "x": 0,
  "y": 0,
  "width": 0,
  "height": 0,
  "fill": "$primary",
  "strokeWidth": 16,
  "pointArr": [
    { "x": 68, "y": 144 },
    { "x": 210, "y": 144 },
    { "x": 260, "y": 202 },
    { "x": 210, "y": 260 },
    { "x": 68, "y": 260 }
  ]
}
```

编译后会得到：`x=60, y=136, width=208, height=132`，`pointArr` 变为 `(8,8),(150,8),(200,66),(150,124),(8,124)`。

常见错误：x/y=0 但 pointArr 使用画布绝对坐标，且 width/height 与包围盒不一致。请设置 coordinateMode:"absolute"，或把 pointArr 改成局部坐标。
