# 紧凑语义版式

普通 PPT 默认使用这一层。它只描述页面角色和内容，`core/layouts.mjs` 会把它展开为 1280×720 primitive DSL。

## 顶层

```json
{
  "dslVersion": 2,
  "meta": { "title": "演示标题", "author": "作者" },
  "style": "navy-report",
  "slides": []
}
```

`theme` 与 `style` 都可指定样式；同时存在时以 `theme` 为准。完整示例见 `examples/deck-compact.json`。

编辑器需要机器可读约束时，可使用 [deck.schema.json](deck.schema.json)；命令行仍以 `tools/check_deck.mjs` 的严格检查为准。

## 共同字段

每页可有：

- `layout`：版式名，必填。
- `title`、`eyebrow`。
- `notes` 或 `speakerNotes`：写入 PowerPoint 演讲者备注；优先统一使用 `notes`。
- `footerLabel`：页脚左侧标签；`brand` 是兼容别名。
- `footer:false`：关闭当前页页脚，不影响其他页面。
- `background`：覆盖样式背景。
- `elements`：可选 primitive 覆盖层，编译后置于语义版式上方。
- `id`：可选稳定页 ID；未提供时自动生成。

生成的文本元素会携带 `sourcePath`。预览页双击改字会同时更新浏览器内的编译稿和原始语义稿；“导出 deck.json”会下载一份保留主题令牌和宏的新文件，不会自动覆盖磁盘原件。

## 版式

### cover

```json
{
  "layout": "cover",
  "eyebrow": "2026 ANNUAL REVIEW",
  "title": "年度经营回顾",
  "subtitle": "关键结论与下一阶段行动",
  "metrics": [
    { "value": "25.8 亿", "label": "营业收入" },
    { "value": "+31%", "label": "海外增长" }
  ]
}
```

`metrics` 建议 0–4 项；`dark:false` 可使用浅色封面。

### section

章节过渡页：`number`、`title`、`subtitle`。

### agenda

```json
{"layout":"agenda","title":"目录","items":["市场变化","经营结果","行动计划"]}
```

`catalog` 是兼容别名。`items` 也可为 `{title, subtitle}`。

### cards

适合 2–6 个并列观点：

```json
{
  "layout": "cards",
  "title": "核心能力",
  "columns": 3,
  "items": [
    { "icon": "01", "title": "能力一", "body": "说明", "value": "可选数据" }
  ]
}
```

别名：`content-grid`。

`columns` 控制列数，必须是 1–6 的整数；普通内容建议使用 2–3 列。

### metrics

适合 2–6 个指标：`items[].value/label/detail`，可加一段 `insight`。别名：`data`、`dashboard`。

### split

图文左右布局：

```json
{
  "layout": "split",
  "title": "产品能力",
  "imageSide": "left",
  "image": { "path": "product.png", "sizing": "cover" },
  "contentTitle": "一句话结论",
  "body": "简短说明",
  "bullets": ["要点一", "要点二"]
}
```

图片只有 `prompt` 时不能构建最终 PPTX；必须先生成资源并填写 `path` 或 `data`。别名：`image-split`。

`heading` 是 `contentTitle` 的兼容别名；新文件优先使用 `contentTitle`。

### comparison

```json
{
  "layout": "comparison",
  "title": "方案对比",
  "left": { "title": "当前", "items": ["问题一", "问题二"] },
  "right": { "title": "目标", "items": ["收益一", "收益二"] }
}
```

`contrast:false` 可取消右侧深色卡。

`centerLabel` 可替换中间圆形中的默认 `VS`。

### timeline

`items` 为 2–6 个 `{date,title,body}`。别名：`pipeline`。

### chart-insight

```json
{
  "layout": "chart-insight",
  "title": "收入趋势",
  "chart": {
    "chartType": "bar",
    "labels": ["Q1", "Q2"],
    "data": [{ "name": "收入", "values": [12, 18] }],
    "showLegend": false
  },
  "insightTitle": "关键解读",
  "insights": ["Q2 环比增长 50%", "增长主要来自海外"]
}
```

### quote

`quote` 或 `text` 为主体，`source` 可选。

### ending

`title`、`subtitle`、`contact`；`dark:false` 使用浅底。

### raw

完全使用 `elements`。需要 primitive 属性时读取 `dsl-schema.md`。

## 选择原则

- 同构内容优先 `cards` 或 `metrics`。
- 带过程顺序优先 `timeline`。
- 一张图和一组观点优先 `split`。
- 有数据图时优先 `chart-insight`，不要用手动画柱形替代真实图表。
- 语义层无法表达的装饰作为 `elements` 覆盖层，不要复制整页底层 JSON。
