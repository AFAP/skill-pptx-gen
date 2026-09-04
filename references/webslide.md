# WebSlide HTML 入口

WebSlide 用浏览器计算 HTML/CSS 布局，再把显式标记的叶子节点提取为 primitive PPT-DSL。它适合模型先以网页方式构图，同时避免承诺任意网页无损转换。

## 最小结构

```html
<!doctype html>
<html data-ppt-theme="clean-minimal">
<head>
  <style>
    .ppt-slide { position: relative; width: 1280px; height: 720px; overflow: hidden; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  </style>
</head>
<body>
  <section class="ppt-slide" data-ppt-slide>
    <div class="grid">
      <article data-ppt="shape"><h2 data-ppt="text">标题</h2></article>
    </div>
  </section>
</body>
</html>
```

完整示例：`examples/webslide-basic.html`。

## 标记协议

每页使用 `[data-ppt-slide]` 或 `.ppt-slide`。只有带 `data-ppt` 的元素会进入 PPTX：

| 标记 | 输出 |
| --- | --- |
| `data-ppt="text"` | 可编辑文字 |
| `data-ppt="shape"` / `box` | 可编辑矩形/圆角矩形 |
| `data-ppt="image"` 或带标记的 `<img>` | 图片；也可读取节点的 CSS `background-image` |
| `data-ppt="svg"` 或带标记的 `<svg>` | SVG 图片 |
| `data-ppt="table"` | 可编辑表格 |
| `data-ppt="chart" data-chart='{"chartType":...}'` | 可编辑图表 |
| `data-ppt="line"` | 线段 |

Flex/Grid 容器可以不标记；标记需要转换的背景卡和文字叶子。DOM 顺序决定默认叠放顺序，CSS `z-index` 可覆盖。

可选属性：

- `data-ppt-id`：稳定元素 ID。
- `data-role`：title、body、footer 等语义角色。
- `data-valign="middle"`：文字垂直对齐。
- `data-notes`：页备注，放在 slide 节点。
- `data-ppt-text`：覆盖元素的 `innerText`。

## 支持的 CSS

浏览器可以自由使用 Flex/Grid 计算布局；提取器读取最终矩形和以下视觉属性：

- 字体、字号、粗体、斜体、颜色、行高、字距、对齐、统一 padding。
- 纯色背景、边框、圆角、透明度、旋转和简单阴影。
- `border-radius: 50%` 的形状会转换为圆/椭圆。
- 图片 `object-fit: cover/contain`。

以下没有稳定的 PowerPoint 等价物，会写入 `webUnsupported` 并由校验器告警：

- filter、clip-path、mask、mix-blend-mode。
- CSS 渐变及复杂多层阴影。
- 伪元素生成的重要内容、富文本节点中的混合样式。
- 文字节点的圆角底框、边框或非统一 padding；需要时拆成一个 shape 与一个 text。
- 表格合并单元格会被压平，形状上的 CSS 背景图不会当作形状填充导出。
- 依赖 JavaScript 动画后的中间状态。

需要这些视觉时，把局部效果预合成为 SVG/PNG；不要把整页文字一起栅格化。

## 命令

```bash
node tools/html_to_deck.mjs slides.html -o deck.json
node tools/build_all.mjs deck.json -o output
```

提取需要本机 Chrome 或 Edge。可用 `--browser <path>` 或环境变量 `PPT_BROWSER` 指定浏览器。HTML 应可离线加载；远程字体或资源会降低可复现性。

## 一致性建议

- 页面必须显式固定为 1280×720；不要依赖 viewport 百分比决定 slide 尺寸。
- 使用本机常见字体；网页字体与 PowerPoint 字体不一致时，文本换行必然变化。
- 标题和正文分别标记，避免一个节点混合多种字体样式。
- `data-ppt` 使用表格中的已知值；未知类型或非法 `data-chart` JSON 会立即中止提取。
- ID 必须在页内唯一；重复 `data-ppt-id` 会在严格校验中报错。
- SVG 应自包含 fill/stroke/font，不依赖页面外部 CSS。
- 图片圆角在普通 PPTX 图片中没有等价实现；若必须保留，先把圆角透明区域栅格化到图片本身。
