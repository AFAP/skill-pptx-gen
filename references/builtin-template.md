# 内置模版：navy-brief（藏青商务简报风）

skill 内置的唯一模版。用户未指定风格时默认使用；指定了参考图或风格描述时，按其提取/生成新 theme 替代。

## 使用方式

```json
"theme": "navy-brief"
```

或展开自定义（任一字段都可覆盖）：

```json
"theme": {
  "extends": "navy-brief",
  "palette": ["#0C1B2E", "#F26B21", "#4A7BA6", "#8FA3D9", "#C9CFDA", "#667085"],
  "primary": "#0C1B2E",
  "accent": "#F26B21",
  "background": "#F7F6F3",
  "text": "#17233B",
  "textSecondary": "#667085",
  "fontFamily": "Microsoft YaHei"
}
```

完整示例见 `examples/` 目录（多页财报示例，含图表/表格/深色页/明暗交替）。

## 设计令牌

| 角色 | 值 | 用法 |
| --- | --- | --- |
| 主色 primary | `#0C1B2E` 墨青 | 深色页背景、底部强调条、节标题文字、表格表头 |
| 强调 accent | `#F26B21` 机械橙 | **只**用于关键数字、序号圆、小节标记方块、图表当年系列 |
| 页面背景 | `#F7F6F3` 米白 | 内容页底色（`$bg`） |
| 卡片 | `#FFFFFF` + 边框 `#E8E4DC` 1px + 圆角 14，无阴影 | 内容卡 |
| 深色页卡片 | `rgba(255,255,255,0.05)` + 边框 `rgba(255,255,255,0.12)` | 封面/深色页数据卡 |
| 图表配色 | 当年 `#F26B21`、同期/次要 `#C9CFDA` | 两年对比图：橙色=当年，浅灰=上年 |

## 版式约定

- **明暗交替节奏**：深色封面 → 浅色内容页 → 中间插一页深色"数据聚焦页"（超大数字）→ 浅色内容页 → 深色结尾页
- **节头**：橙色小方块（60,52,6,42）+ 英文小标签（11px letterSpacing 3）+ 28px 粗体标题
- **页脚**：细线 y=688 + 左公司名 + 右页码（"ESTUN … · 0X / 10"）
- **装饰**：细线、轨道圆环（允许出血越界）、小色块，每页 ≤2 种
- 卡片顶部可加 4px 橙色帽线区分层级

## 从参考图 / 风格描述生成新模版

- **参考图**：`read_image` 查看 → 按 `reference-image-analysis.md` 协议提取（colorSystem / typography / cardStyle / decorationElements / pageArchetypes / renderStrategy）→ 转成 theme 对象 + 布局决策
- **文字描述**：直接按下方速配公式生成 theme 对象：

```
1. background = 页面底色（深色底 → text 必须浅色）
2. primary = 出现频率最高的品牌/装饰色
3. accent = 与 primary 对比的点缀色（对比色或金属色）
4. palette = primary 起 + 同色系 3-5 色 + 灰阶 2 色，共 6-9 个
5. text / textSecondary = 主文字色 + 浅一阶灰
6. fontFamily：商务无衬线 Microsoft YaHei；人文衬线 SimSun/Georgia 放首位
```

复杂视觉风格（手绘/水墨/摄影/3D 纹理等组件难以复刻的）→ 改用整页文生图模式，见 `reference-image-analysis.md` 的「image 模式」。
