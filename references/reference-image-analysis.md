# 参考图风格分析协议

用户提供参考图（PPT 截图、设计稿、网页截图、海报）时，先用 `read_image` 逐张查看，再按本协议提取风格，最后落地为 `deck.theme` 与布局决策。

## 第一步：提取风格 JSON

对照参考图，输出如下分析（内部思考即可，不必写文件）：

```json
{
  "colorSystem": {
    "background": "页面背景主色HEX",
    "primary": "主色调HEX（标题/重点元素）",
    "secondary": "辅助色HEX",
    "text": "主文字色HEX",
    "accent": "强调色HEX（按钮/高亮/装饰）",
    "textSecondary": "次要文字色HEX"
  },
  "typography": {
    "headingStyle": "标题风格（如 大字号粗体左对齐 / 居中衬线）",
    "bodyStyle": "正文风格",
    "fontSizePattern": "字号层级规律（如 标题48/副标24/正文16）"
  },
  "cardStyle": {
    "hasCard": true,
    "cornerRadius": "16px大圆角/8px小圆角/0直角",
    "shadow": "无阴影/柔和弥散/强烈投影",
    "border": "1px细边框/无边框/2px粗边框",
    "fill": "纯色/渐变/半透明/无填充"
  },
  "layoutStructure": ["封面特征", "内容页特征", "数据页特征"],
  "visualTexture": "一句话质感（如 极简商务白色卡片 / 深色科技感线框 / 新中式水墨意境）",
  "decorationElements": ["双色装饰线", "编号方块", "几何背景"],
  "pageArchetypes": {
    "cover": "封面构图规则", "catalog": "目录页节奏", "content": "内容页信息块组织",
    "data": "数据页处理", "pipeline": "流程页连接方式", "quote": "金句页留白", "ending": "结尾页处理"
  },
  "renderStrategy": {
    "generationMode": "elements 或 image",
    "reason": "判断原因",
    "componentRisks": ["复杂插画背景", "手绘纹理"],
    "imagePromptHints": ["英文风格关键词1", "英文风格关键词2"]
  }
}
```

## 第二步：判定渲染模式

**elements 模式（默认，输出可编辑元素）**：参考图由纯色背景、文字、圆角卡片、简单几何装饰构成。
**image 模式（整页文生图）**：出现以下任一信号 → 组件难以稳定复刻，改用整页图片：
手绘、粉笔、水墨、插画、摄影、照片、3D、立体、纹理、颗粒、纸张、撕纸、涂鸦、复古、赛博、霓虹、写实、人物场景、复杂背景。

## 第三步：落地

### elements 模式
1. colorSystem → `deck.theme`：
   - `background/primary/accent/text/textSecondary` 直接映射
   - `palette` = [primary, secondary, accent] + 同色系补充 + 灰阶，6-9 色
   - `fontFamily`：衬线感 → `"Georgia, SimSun, serif"`；现代无衬线 → `"Microsoft YaHei, PingFang SC, sans-serif"`
2. cardStyle → 所有卡片的 cornerRadius/shadow/stroke 参数
3. typography → 字号层级（映射到 design-system.md 的层级表）
4. pageArchetypes → 各页面角色的布局组织方式
5. decorationElements → 每页固定复现 1-2 种（保持一致性）

### image 模式
每页只输出一个全屏 image 元素：
```json
{"elements":[{"elType":"image","prompt":"...","ratio":"16:9","x":0,"y":0,"width":1280,"height":720}]}
```
prompt 必须英文、详尽到足以复刻风格，且中文标题/要点原文保留在引号中。结构：
- **Style**: 克隆的视觉风格、色板、纹理、字体气质、装饰语言
- **Canvas**: 16:9 presentation slide, clean composition, high readability
- **Title**: 页面中文标题原文
- **Content**: 各中文要点作为清晰文字块/标注出现
- **Layout**: 标题/内容块/数据/图标/线的位置
- **Details**: 纹理、阴影、边框、渐变、插画或摄影风格
- **Quality**: high-resolution, professional, readable Chinese text

按页面角色追加侧重：
- cover → 一个主导大标题 + 品牌氛围
- catalog → 章节节奏 + 大留白
- data → 大数字 + 信息图元素
- pipeline → 连接步骤/箭头/层级流
- quote → 单一核心观点 + 强负空间
- ending → 收束构图 + 行动号召

## 示例

参考图：深蓝底、金色细线、白色衬线大标题、右下角页码 →
```json
"theme": {"background":"#14213D","primary":"#FFFFFF","accent":"#C9A96E","text":"#FFFFFF","textSecondary":"#A8B2C8","palette":["#FFFFFF","#C9A96E","#3E5C8A","#8A9BB8","#E5E0D5"],"fontFamily":"Georgia, SimSun, serif"}
```
布局上每页固定：金色细线装饰 + 衬线标题 + 右下角页码。
