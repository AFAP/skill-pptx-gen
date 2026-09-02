# 设计系统：版式库 × 字号层级 × 配色节奏

所有坐标基于 1280×720 画布，直接可用；按内容微调。

## 字号层级（px，导出自动 ×fontScale 转 pt）

| 层级 | px | 用途 |
| --- | --- | --- |
| Display | 54-68 | 封面主标题、超大数字（数据页可到 100） |
| H1 | 36-42 | 页面标题 |
| H2 | 24-28 | 副标题、区块标题 |
| H3 | 20-26 | 卡片标题 |
| Body | 14-18 | 正文 |
| Caption | 10-13 | 注释、来源、页码（不低于 10） |

英文小标签（如 "CONTENTS"）：12px + `letterSpacing: 3` + accent 色，是提升设计感的廉价手段。

## 节奏与密度

- 单页 ≤ 6 个要点；正文总量 ≤ 120 字；标题 8-12 字。
- 同一版式不连续超过 2 页；每 3-4 页插入变化页（数据/金句/对比/整页图）。
- 内容多宁分页不堆砌。
- 页面动线：Z 型（标题左上 → 内容区 → 右下落点）或 F 型。

## 配色规则

- 每页主色 ≤ 3 种，从 palette 顺序循环取。
- 卡片编号/图标底色交替 `$primary` ↔ `$accent`。
- 卡片底色三选一：纯白 + 边框 + 柔和阴影（浅色背景）｜`$light:$primary` 浅填充（白底）｜比背景亮/暗一阶的纯色（深色背景）。
- 装饰线、分隔线：`$primary`/`$accent`，高 2-4px，宽 60-80px。

---

## 版式库

### 1. cover 封面
```
背景: 全屏 rect($bg) 或 $primary 深底
顶部: 可选色条 (0,0,1280,8, $primary)
装饰线: (80,220, 64,4, $accent)
主标题: (80,250, 900,90) Display 60 bold $primary(深底用#FFF)
副标题: (80,350, 800,44) H2 24 $text2
底部信息条: (80,620, 1120,48) $light:$primary 圆角24 + 居中14px文字
变体: 左文右图（图 x=760,y=120,w=440,h=480 圆角16）；居中式（标题 x=190,y=280 居中）
```

### 2. catalog 目录
```
左: 竖图或色块 (0,0,405,720)
右: 章节列表从 y=100 起，每项高 100，间距均分
  每项 = 圆角色块(编号) + 标题 24 bold
  x = 505, 宽 600
```

### 3. content-grid 卡片网格（最常用）
```
标题组: 见 SKILL.md 速查（y=40~127）
3卡横排: 宽373, 间距20, x=60/453/846, y=180, 高420
4卡横排: 宽280, 间距26.7, x=60+i×306.7
2×2: 宽568, 高260, x=60/652, y=180/464
卡片内部（以3卡为例，相对卡片左上+32）:
  编号方块: (0,0,52,52) $primary 圆角12 + 白色数字
  标题: (0,76, 309,36) 26 bold
  正文: (0,124, 309,130) 15 $text2 lineHeight1.6
  底部亮点数据: (0,308, 309,28) 14 bold $accent
```

### 4. content-list 垂直列表（3-5 条）
```
每条: 序号圆(shape-circle 直径40) + 标题 20 bold + 描述 15 $text2
y 从 180 起，每条高 90-110
```

### 5. data 数据页
```
标题组同上
大数字卡 (2-4个): 卡 (60+i×370,180, 270,180)
  数字: 48-72 bold $primary 居中
  标签: 16 $text2 居中
图表区: chart 元素 (60,180, 640,420) + 右侧解读文字 (760,180,460,...)
底部: 数据来源 12px opacity0.7
```

### 6. pipeline / timeline 流程页
```
横向时间轴: shape-line (120,300)→(1160,300) #CBD5E1 3px
节点: shape-circle 直径56 填充 palette 循环, 圆心 y=300, x 均分
  序号: 白字 22 bold（覆盖圆心区域，注意 shape-circle 是圆心坐标）
  阶段标题: 20 bold 居中 (节点x-100, 380, 200, 32)
  描述: 14 $text2 居中 (节点x-120, 420, 240, 80) lineHeight1.5
纵向: 左侧时间轴线 x=200, 节点交替左右
```

### 7. comparison 左右对比
```
左卡: (60,160, 560,460) 浅底
右卡: (660,160, 560,460) 深底($primary)或对比色
中间: "VS" 圆 (610,360, 60,60)
各侧: 标题 24 bold + 3-4 条 (图标+标题18 bold+描述14)
```

### 8. hub 中心辐射
```
中心: shape-circle 直径120-160 $primary (圆心 640,380)
分支: 3-6 个卡片沿圆周分布 (半径220)
连接: connector-s 宏（对角模式自动柔和）
```

### 9. pyramid 金字塔（3-4 层）
```
三层梯形(用 shape-rect 宽度递减居中):
  顶: (490,180, 300,110)   palette[0]
  中: (390,300, 500,110)   palette[1]
  底: (290,420, 700,110)   palette[2]
每层内白字 18 bold; 右侧配说明文字块
```

---

## 脑图/辐射布局配方（原项目验证版式，用连接线宏实现）

以下配方来自经过验证的原项目版式，连接线一律用 `connector-s` / `connector-elbow` / `arc-segment` 宏，不要手写 pointArr。

### A. left-hub 左侧主卡脑图（适合 3-5 分支 + 每支 1-2 条要点）

```
主卡: shape-rect (60, 362-50, 200,100) $light:$primary 填充+主色描边+圆角16
      图标 emoji 30px (左 64px 宽) + 标题 20 bold
子卡: shape-rect (340, cy-30, 210,60) × N, $light:$i 马卡龙填充 + $i 描边 + 圆角12
      图标 22px + 标题 16 bold
主卡→子卡: connector-s (260,362)→(340,cy), orientation:"h", dashType:"dash", strokeWidth 1.5
子卡右侧文本: text (620, cy±, 600, 34) 13px $text2 —— 每条子卡挂 1-2 行
子卡→文本: connector-s 短桩 (550,cy)→(620,cy), orientation:"h", dashType:"dash", 1px
子卡纵向分布: cy = 190 + i×115（N=4 时）
完整示例: examples/ 目录下的脑图示例第 1 页
```

### B. top-hub 顶部主卡脑图（中心主题 + 横向分支）

```
主卡: shape-rect (540,160, 200,100) 居中, 图标(28)+标题(20)
子卡: shape-rect × N 横排 (y=主卡底+150, 高100), 图标42+标题24+要点2条
主卡→子卡: connector-s (640,主卡底)→(子卡中心x,子卡顶), orientation:"v", dashType:"dash"
```

### C. 弧形轨道流（环形流程/循环机制，带箭头）

```
圆心: (640,390); 环: rOuter=200, rInner=140
N 段: 每段扫角 = (360 - N×缝隙角5°) / N，从 -90°(顶部) 起顺时针
  arc-segment(cx,cy,rOuter,rInner, start=-85+i×(step+5), end=start+step, fill=$i+1)
  —— 默认自带段尾箭头（arrowAngle 6°），探入下一段缝隙指示流向
数字徽章: 每段中角 mid=(start+end)/2，中环半径 rMid=(rOuter+rInner)/2
  位置 = arcPoint(cx, cy, rMid, mid)  →  shape-circle 40px + 白底彩边数字
标签卡: 每段中角外侧 r≈300 处放说明卡（左/右/下三方）
中心: shape-circle 150px $primary + 白色标题
```

### D. 双圆环形对峙对比（问题 vs 方案 / 现状 vs 目标，原版精确参数）

```
圆心线 ORIGIN_Y = 420（标题区 120 之下居中）
左主圆: shape-circle 圆心(540,420) r=88, fill=左色, stroke=左色+99, strokeWidth 15
右主圆: 圆心(740,420) r=88, 右色同理
背景光晕: 左右各一个 shape-circle r=250, fill=对应色, opacity 0.08（圆心与主圆同）
外轮廓弧（开口装饰）: shape-path 开放弧 r=240 stroke 2px
  左: 圆心(540,420) 角度 105°→255°；右: 圆心(740,420) 角度 285°→75°(跨0°)
  pointArr=[{起点,moveTo:true},{终点,curve:{type:"arc",hR:240,wR:240,stAng:起点角,swAng:扫角}}], closePath:false
主圆内: 图标 48px 白色 + 标题 21px bold 白色
条目胶囊: 在圆环 r=290 上按角度均布（左半 150° 区间 / 右半镜像）
  shape-rect (w=220,h=32) fill=对应色 cornerRadius 16 + 白字 18px bold
  角度: childAngle = 90 + 10 + (150/(N+1))×(i+1)，位置 = 主圆圆心 + arcPoint(290, childAngle)
  每条胶囊下挂说明文本 (w=320, 15px, $text2)
```

### E. 四象限 + 中心环（多维平衡/SWOT 变体，原版精确参数）

```
原点 (640,420)；四象限卡（虚线框 + 顶部 6px 色条）:
  boxW=580, boxH=270; 左上(50,140) 右上(650,140) 左下(50,430) 右下(650,430)
  每卡: shape-rect 白底 stroke=$3 1px dashType:"dash" + 顶条(高6,fill=$3)
  标题 24 bold（左卡左对齐/右卡右对齐）+ 2 段「标签 21 bold + 内容 15」
中心环（4 段 90° 扇区，arc-segment 宏）:
  arc-segment(cx=640, cy=420, rOuter=126, rInner=50, arrow:false, fill=$3):
    i0 左上: 180°→270°   i1 右上: 270°→360°   i2 左下: 90°→180°   i3 右下: 0°→90°
中心: shape-circle r=70 白色 + 其上 r=95 白色 opacity0.34 + 图标 60px
注意：原版环上的弧形文字标签（收益平衡…）是 text-path——仅预览有效、PPT 导出会跳过；
  需要出片时改为各象限内的直排标签。
```

### F. 金字塔（真三角分层，原版精确参数）

```
总高 H=500，左边距 x=50，塔顶 y=170（720 内居中于标题区下）
局部坐标（相对塔身原点 x=50,y=170）：顶点(250,0) 左底(0,500) 右底(500,500)
N 层: layerH = (510/N) - 10；层间距 10
第 i 层（shape-path，pointArr 直角点，默认闭合）:
  topW = (layerH+10)×i, botW = layerH + (layerH+10)×i
  i=0 三角形: points [(botW/2,0),(0,layerH),(botW,layerH)]
  i>0 梯形: points [((botW-topW)/2,0),(0,layerH),(botW,layerH),(topW+(botW-topW)/2,0)]
  x = 300 - botW/2, y = 170 + (layerH+10)×i, fill=palette[i]
  图标: 居中于该层, fontSize = layerH×0.4, 白色
右侧说明卡（逐层阶梯右移）:
  x = 层x + 层宽 + 32, w=500, 高=layerH
  fill=palette[i] opacity 0.2 cornerRadius 8 + 标题 18 bold + 内容 15px
```

### G. SWOT 字母列

```
4 列等宽: colW = (1280-100)/4 = 295
字母块: shape-rect (50+i×295, 180, 295, 150) fill=palette[i] opacity 0.3, 直角
字母: S/W/O/T 80px bold 居中 $text
内容: text (50+i×295, 330, 295, 余下高度) 18px $text2, 条目间空行
```

### H. 三环循环（中心 + 环绕三点）

```
中心: shape-circle r=80 fill=$primary (圆心 640,440) + 图标 42px + 标题 24px 白
点状装饰环: image-svg（SVG 多层 stroke-dasharray:"0 25" 点线圈, 见 examples）
环绕小圆 ×3: r=48, 圆心 = 中心 + arcPoint(198, -60°+120°×i), fill=palette[i]
  图标 36px 白色居中
标签胶囊: 小圆左侧或右侧（按 x 正负自适应）shape-rect (280,40) cornerRadius 30
  fill=palette[i]+"11", stroke=palette[i], 标题 18 bold
  胶囊下挂说明文本 15px
```

### I. 垂直流程（纵向步骤链）

```
节点圆: shape-circle d=56 圆心 x=88, 纵向 startY + i×76, fill=palette[i]
  内编号/图标 22-28px 白色
连接条: shape-rect (86, 节点底, 3, 20) fill=palette[i]+"88"（最后节点不画）
右侧: 标题 24-28 bold (x=136) + 内容 18px $text2
纵向居中: startY = 标题区底 + (可用高 - N×56 - (N-1)×20)/2
```

### J. 聚焦强调页（超大字 + 双装饰线）

```
图标(可选): 64px 居中 (0,240,1280,80)
上装饰线: shape-rect (580,当前y-20, 120,4) $primary cornerRadius 2
核心文字: Display 54px bold 居中 (60,当前y+10,1160,110)
下装饰线: 同上位置镜像
副文案(可选): H2 24px $text2 居中
```

### K. 数据仪表盘（大数字卡行）

```
卡片宽 = (1280 - 80 - 24×(N-1))/N，y 居中于标题区下
每卡: shape-rect 高200 fill=palette[i]+"15" stroke=palette[i] 2px cornerRadius 16
  大数字 48-72px bold palette[i] + 标签 16px + 趋势 14px（涨跌色）
```

---

### 10. quote 金句页
```
深底或浅底皆可
上装饰线: (560,200, 160,2, $accent)
大引号: "“" Georgia 64 $accent (180,230,80,80)
金句: (200,300, 880,120) 34 $text 居中 lineHeight1.5
出处: (200,450, 880,30) 16 opacity0.75 居中
下装饰线: (560,510, 160,2)
```

### 11. image-split 图文页
```
左图右文: image (60,120, 540,480 圆角16) | 文字区 x=660 宽560
右图左文: 镜像
文字区: 标题 36 bold + 分隔线 + 3-4 要点 (圆点+文字)
```

### 12. ending 结尾
```
顶部色条 + 居中主文案 48 bold $primary (190,280,900,80)
副文案 22 $text2 (190,380,900,40)
装饰线 (590,460,100,3 $accent)
底部联系信息 14 (190,640,900,30)
```

## 装饰元素库（适度使用，每页 ≤ 2 种）

- 双色装饰线（标题下方）
- 英文大写小标签 + letterSpacing
- 超低透明度大字符水印（`fontSize:480, opacity:0.06`）
- 角落几何点缀（小圆/方块，opacity 0.1-0.3）
- 页码 `01 / 04` 右下角 11-12px
- 细分割线 1px opacity 0.15-0.25

## 禁用清单

- 彩虹渐变、高饱和撞色堆砌
- 一页超过 3 种主色
- 正文小于 12px、注释/页码小于 10px、行高小于 1.2
- 元素贴边（违反安全边距）
- 大段文字（>120 字/页）
- 无意义阴影（深色背景上的黑阴影）
