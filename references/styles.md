# 默认样式预设

样式定义视觉令牌和推荐的视觉语法，不决定页面内容和整页版式。使用 `"style":"名称"` 或 `"theme":"名称"`。

| 名称 | 适用场景 | 特征 |
| --- | --- | --- |
| `navy-report` | 财报、咨询、经营汇报 | 藏青、机械橙、米白底、14px 圆角 |
| `clean-minimal` | 通用汇报、产品说明 | 白底、蓝色强调、轻边框、紧凑留白 |
| `tech-dark` | AI、技术架构、平台方案 | 深蓝黑底、青色强调、深色卡片 |
| `warm-editorial` | 品牌、人文、故事表达 | 暖米色、酒红与陶土色、较克制圆角 |
| `data-dashboard` | 指标、图表、运营看板 | 冷灰底、白卡、高信息密度 |

## 推荐视觉语法

这些是创作方向，不是编译器强制模板：

| 名称 | 空间与形状 | 线条与曲线 | 图片与数据 |
| --- | --- | --- | --- |
| `navy-report` | 非对称编辑式构图，少量圆角 | 深色粗线配机械橙细线，适合轨迹与剖面 | 冷调工业图片，图表突出单一橙色系列 |
| `clean-minimal` | 高留白、平面结构、弱容器 | 直线和短引导线，少用封闭卡片 | 图片保持自然色，图表减少网格线 |
| `tech-dark` | 深底分层、节点网络、局部发光 | 青色细线、拓扑线与柔和 S 曲线 | 深色处理图片，数据标签高对比 |
| `warm-editorial` | 杂志式错位、窄栏文字、柔和色块 | 陶土色短线与缓弧，避免机械网格 | 人文摄影或纸张质感，图表颜色克制 |
| `data-dashboard` | 高密度但平面化，数字优先 | 细网格、阈值线和对齐基线 | 原生图表与表格优先，减少装饰图片 |

AI 应复用一套字体、颜色、描边、圆角和曲线习惯，同时让每页轮廓随内容改变。不要把“统一”理解为所有页面使用同一列数、同一组卡片或同一个标题区。

未指定样式时使用 `navy-report`。`navy-brief` 是相同色值的旧名称兼容项，不再用于新示例。其他兼容旧名称：`business`、`tech`、`health`、`education`、`nature`、`creative`、`minimal`、`warm`、`dark`。

完整预设除颜色外还包含：

- `surface` / `surfaceAlt` / `border`
- `accentText`（浅色表面上的可访问强调文字色；装饰仍用 `accent`）
- `onAccent`（位于 accent 色块之上的文字色）
- `radius`
- `pagePadding`
- `titleMarker`
- `footer`

## 自定义

```json
{
  "theme": {
    "extends": "clean-minimal",
  "primary": "#173B57",
  "accent": "#E86A33",
  "accentText": "#A33A12",
  "onAccent": "#FFFFFF",
    "background": "#F7F5F1",
    "surface": "#FFFFFF",
    "surfaceAlt": "#EFECE6",
    "border": "#DDD8CF",
    "text": "#1F2933",
    "textSecondary": "#667085",
    "radius": 10,
    "pagePadding": 64,
    "fontFamily": "Microsoft YaHei"
  }
}
```

修改 `accent` 时应同时给出 `accentText` 和 `onAccent`。浅色表面上的强调文字用 `accentText`，accent 填充上的文字用 `onAccent`；`accent` 本身主要用于装饰、描边、色块和图表系列。

需要 `navy-report` 的详细配色节奏和页面约定时，再读取 [builtin-template.md](builtin-template.md)。

参考截图只应覆盖观察得到的令牌；单张截图无法证明的页面规则沿用所选基础样式，不要凭空扩展成完整品牌系统。
