# 形状库（OOXML preset geometry 双端对齐）

形状库解决的是"网页预览与 PPTX 画的是不是同一个形状"。它不同于 `shape-path` 那种自由路径：
这里每个形状都对应一个 OOXML preset 名称，PowerPoint 会按 `presetShapeDefinitions.xml` 的
guide 公式绘制，而预览端由 `core/shape-geometry.mjs` 用**同一套几何构造**画出等价路径。

```
shape-preset / shape-star / shape-polygon / shape-ellipse / shape-wedge / shape-arc / shape-ring
        │
        ├── core/shape-geometry.mjs  ── 唯一一份形状几何 ──┐
        │                                                  │
   编译期写入 _shapeData ──> Konva 预览        preset 名 ──> PptxGenJS ──> PowerPoint
```

两端不各写一份形状公式：几何只在 `core/shape-geometry.mjs` 定义，`compile-deck` 在编译期
把预览用的 path 算好（`_shapeData`），导出端则把 preset 名和调整值写进 OOXML。

## 用法

```json
{ "elType": "shape-preset", "shape": "star5", "x": 60, "y": 60, "width": 150, "height": 150, "fill": "$accent" }
```

糖衣类型把常见参数变成独立字段（等价写法，二选一）：

| 元素类型 | 等价于 | 参数 |
| --- | --- | --- |
| `shape-ellipse` | `shape-preset` + `shape:"ellipse"` | — |
| `shape-star` | `shape-preset` + `shape:"star5"` | `points`（4/5/6/7/8/10/12/16/24/32） |
| `shape-polygon` | 自由路径（无 preset） | `sides`（≥3） |
| `shape-wedge` | `shape-preset` + `shape:"pie"` | `angleRange` |
| `shape-arc` | `shape-preset` + `shape:"arc"` | `angleRange` |
| `shape-ring` | `shape-preset` + `shape:"donut"` | — |

- **坐标约定**：形状库的 `x`/`y` 是**左上角**，与 `shape-rect` 一致。
  （`shape-circle` 的 `x`/`y` 是圆心，那条旧约定不适用于形状库。）
- 公共样式字段都可用：`fill`、`stroke`、`strokeWidth`、`dashType`、`rotation`、`opacity`、
  `flipH`/`flipV`、`shadow*`、`objectName`、`hyperlink`。
- 未知形状名是**严格错误**，不会静默退化成别的图形。

`shape-polygon` 一律用共享顶点列导出为 customGeometry（而不是套用 preset），
因为它的语义是"正多边形"，顶点列能保证两端严格一致；需要原生 preset 请直接用 `shape-preset`。

## 几何可信度

校验器按每条形状的 `exact` 标注决定是否告警。**不是所有形状都能保证两端像素一致**，
这一点必须显式可见，而不是让用户以为所有形状都精确：

| 可信度 | 含义 | 校验器行为 |
| --- | --- | --- |
| `preset` | 两端几何由同一构造唯一确定（原生 preset，或 `shape-polygon` 的共享顶点列） | 不告警 |
| `aspect` | 顶点落在内切椭圆上；正方形包围盒下与 PowerPoint 一致，非等比包围盒时 PowerPoint 会施加额外轴向缩放 | 包围盒长短边比 < 0.85 时告警 |
| `approximate` | 曲线控制点或内部细节是等价构造，非 PowerPoint 原始公式 | 一律告警 |

当前分布：**严格一致 62 个，等比敏感 11 个（星形族 + pentagon），近似 18 个**。

已知的近似来源：

- **星形族**：内/外半径比取 OOXML 默认调整值（满量程 50000，例如 star5 = 19098/50000 = 0.382，
  即经典五角星）。PowerPoint 还对星形施加 `hf`/`vf` 轴向缩放，本实现不复制，
  故非正方形包围盒下会有可见差异——用接近正方形的包围盒即可。
- **`bentArrow`/`bentUpArrow`/`quadArrow`/`leftUpArrow`/`leftRightUpArrow`**：多调整值箭头，
  只实现了主轮廓。
- **标注（callout）族**：尾部指向由调整值决定，这里固定为左下。
- **花括号**：贝塞尔控制点为等价构造。
- **`flowChartDocument`/`flowChartPunchedTape`/`flowChartMultidocument`/`flowChartMagneticDrum`/
  `flowChartMagneticTape`/`flowChartOfflineStorage`**：波浪/立体弧为简化构造。
- **`halfFrame`**：以 L 形轮廓近似。

## 调整值（adjust）

```json
{ "elType": "shape-preset", "shape": "hexagon", "adjust": 35000, "x": 0, "y": 0, "width": 200, "height": 100, "fill": "$primary" }
```

**`adjust` 只影响预览。** PptxGenJS 的 `ShapeProps` 没有通用调整值入口——它只支持
`angleRange`、`rectRadius`、`arcThicknessRatio` 和 `points`，因此 PPTX 里 PowerPoint 仍按
preset 默认调整值绘制。不写 `adjust` 时两端一致（形状表里的默认值就是 OOXML 默认值）；
一旦覆盖，校验器会告警。

## 弧类形状：angleRange

`pie`、`chord`、`arc`、`blockArc` 用 `angleRange` 指定起止角：

```json
{ "elType": "shape-preset", "shape": "blockArc", "angleRange": [180, 360], "arcThicknessRatio": 0.4,
  "x": 620, "y": 260, "width": 170, "height": 170, "fill": "$primary" }
```

- 角度制：**0° 指向正右，顺时针为正**（y 轴向下），与 OOXML 一致。
- 每个角度必须在 **0–360** 之间；越界会报错，因为 OOXML 的 `pin` 会静默钳制，pptxgenjs 也不转换负角。
- 扫角取**有符号差** `end - start`（OOXML 的真实语义；preset 自身默认值如 `arc` 的
  `[270, 0]` 就是 −270°，因此负扫角是合法且必要的）。`end == start` 表示整圆。
- 想画顺时针跨 0° 的弧，请拆成两段（例如 `[300, 360]` 与 `[0, 60]`），不要写 `[300, 60]`。
- `blockArc` 的 `arcThicknessRatio` 映射到 OOXML `adj3 = 比例 × 50000`，
  实际环厚为 `比例/2 × 半径`（默认 0.5 即 OOXML 默认 `adj3=25000`）。

## 形状清单

以下为全部 91 个可用形状名（`shape-preset` 的 `shape` 取值）。

### 基础形（18）

| 形状 | 说明 | 可信度 |
| --- | --- | --- |
| `rect` | 矩形 | preset |
| `roundRect` | 圆角矩形（`adjust` 控制圆角） | preset |
| `ellipse` | 椭圆 | preset |
| `triangle` | 等腰三角（顶点在上） | preset |
| `rtTriangle` | 直角三角（直角在左下） | preset |
| `diamond` | 菱形 | preset |
| `parallelogram` | 平行四边形 | preset |
| `trapezoid` | 等腰梯形 | preset |
| `nonIsoscelesTrapezoid` | 非等腰梯形 | preset |
| `hexagon` | 六边形 | preset |
| `octagon` | 八边形 | preset |
| `pentagon` | 正五边形 | aspect |
| `homePlate` | 五边形（尖端在右） | preset |
| `plaque` | 圆角切角板 | preset |
| `frame` | 中空边框（挖洞） | preset |
| `halfFrame` | L 形半框 | approximate |
| `corner` | 左上角折角 | preset |
| `diagStripe` | 斜条纹 | preset |

### 箭头族（13）

| 形状 | 说明 | 可信度 |
| --- | --- | --- |
| `rightArrow` `leftArrow` `upArrow` `downArrow` | 单向箭头 | preset |
| `leftRightArrow` | 双向箭头 | preset |
| `upDownArrow` | 上下双向箭头 | preset |
| `notchedRightArrow` | 尾部凹口右箭头 | preset |
| `stripedRightArrow` | 带竖条右箭头 | preset |
| `bentArrow` | 折弯箭头 | approximate |
| `bentUpArrow` | 上折弯箭头 | approximate |
| `quadArrow` | 四向箭头 | approximate |
| `leftUpArrow` | 左+上箭头 | approximate |
| `leftRightUpArrow` | 左+右+上箭头 | approximate |

### 数学符号（7）

| 形状 | 说明 | 可信度 |
| --- | --- | --- |
| `plus` | 十字（粗） | preset |
| `mathPlus` | 数学加号 | preset |
| `mathMinus` | 数学减号 | preset |
| `mathMultiply` | 数学乘号 | preset |
| `mathDivide` | 数学除号（含两点） | preset |
| `mathEqual` | 等号 | preset |
| `mathNotEqual` | 不等号 | approximate |

### 弧 / 扇区 / 环（5）

| 形状 | 说明 | 可信度 |
| --- | --- | --- |
| `pie` | 扇形（默认 `[0,270]`） | preset |
| `chord` | 弓形（默认 `[45,270]`） | preset |
| `arc` | 弧线（默认 `[270,0]`，负扫角） | preset |
| `blockArc` | 环形扇段（`angleRange` + `arcThicknessRatio`） | preset |
| `donut` | 圆环（挖洞） | preset |

### 星形（10）

`star4` `star5` `star6` `star7` `star8` `star10` `star12` `star16` `star24` `star32` —— 全部为 `aspect` 可信度。

### 立体感（3）

| 形状 | 说明 | 可信度 |
| --- | --- | --- |
| `can` | 圆柱（顶盖前沿由预览补画） | preset |
| `cube` | 立方体（两条内部棱线由预览补画） | preset |
| `bevel` | 斜面框（挖洞） | preset |

### 标注（3，均为 approximate）

`wedgeRectCallout` `wedgeRoundRectCallout` `wedgeEllipseCallout`

### 括号（4）

| 形状 | 说明 | 可信度 |
| --- | --- | --- |
| `leftBrace` `rightBrace` | 花括号（开放路径） | approximate |
| `leftBracket` `rightBracket` | 方括号 | preset |

### 流程图（28）

| 形状 | 说明 | 可信度 |
| --- | --- | --- |
| `flowChartProcess` | 处理 | preset |
| `flowChartAlternateProcess` | 可选处理（圆角） | preset |
| `flowChartDecision` | 判定（菱形） | preset |
| `flowChartTerminator` | 起止（胶囊） | preset |
| `flowChartConnector` | 连接点（圆） | preset |
| `flowChartDocument` | 文档（波浪底） | approximate |
| `flowChartPredefinedProcess` | 预定义处理（双竖线） | preset |
| `flowChartInternalStorage` | 内部存储（十字线） | preset |
| `flowChartManualInput` | 手动输入（斜顶） | preset |
| `flowChartManualOperation` | 手动操作（倒梯形） | preset |
| `flowChartPreparation` | 准备（六边形） | preset |
| `flowChartOffpageConnector` | 页外连接（下尖） | preset |
| `flowChartDelay` | 延时（右半圆） | preset |
| `flowChartDisplay` | 显示（左尖右圆） | preset |
| `flowChartMagneticDisk` | 磁盘（圆柱） | preset |
| `flowChartMagneticDrum` | 磁鼓（横圆柱） | approximate |
| `flowChartMagneticTape` | 磁带 | approximate |
| `flowChartOnlineStorage` | 在线存储（左半圆） | preset |
| `flowChartMultidocument` | 多文档（叠层） | approximate |
| `flowChartSort` | 排序（菱形+横线） | preset |
| `flowChartExtract` | 提取（上三角） | preset |
| `flowChartMerge` | 合并（下三角） | preset |
| `flowChartOr` | 或（圆+十字） | preset |
| `flowChartSummingJunction` | 汇总连接（圆+叉） | preset |
| `flowChartCollate` | 对照（双三角） | preset |
| `flowChartPunchedCard` | 穿孔卡（切角） | preset |
| `flowChartPunchedTape` | 穿孔纸带 | approximate |
| `flowChartOfflineStorage` | 离线存储（切角） | approximate |

## 什么时候该用形状库，什么时候用 shape-path

- 内容关系能用**标准图形**表达（流程、层级、对比、汇聚）→ 形状库：可编辑性最好，
  也是一眼能认出的"PPT 原生图形"。
- 需要**独特轮廓或精确曲线**（自定义剖面、手绘轨迹）→ `shape-path` / `curve-quadratic`。
- 需要**完全自由的页面构图**（复杂插画、纹理）→ `image-svg` 或局部栅格化图片，
  但关键文字与数据必须另叠加为可编辑对象。
