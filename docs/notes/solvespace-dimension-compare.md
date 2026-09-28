# SolveSpace 1:1 尺寸标注 — 手工对比步骤

目的：
- 用同一组几何点位，在 **SolveSpace** 与 **plant3d-web** 中截图对齐对比，验证 1:1 细节是否达标：
  - 矢量线字体（`unicode.lff`）
  - V 形箭头
  - 文字外接框留白断开
  - 颜色（洋红 / hover 黄 / selected 红）
  - 参考尺寸虚线
  - 像素网格对齐（抖动/虚焦）

---

## 1) plant3d-web（WebGL 3D 尺寸标注）

### 1.1 启动

```bash
cd D:/work/plant-code/plant3d-web
npm run dev
```

打开浏览器进入：
- `/?dtx_demo=mbd_pipe`

该模式会在 Viewer 中注入一套固定的 L 形管段几何（单位 mm），便于复现与截图对比。

### 1.2 创建尺寸（建议用“尺寸工具”，而不是 demo 自带的 MBD dims）

在 Viewer 顶部工具栏中：
- 创建 **线性尺寸**：
  - 选取两点（例如：`(0,0,0)` → `(1000,0,0)`）
  - 创建后拖拽 **offset** 调整尺寸线位置，拖拽 **label** 调整文字位置
- 创建 **角度尺寸**：
  - 选取三点（例如：`origin=(0,0,0)`, `corner=(1000,0,0)`, `target=(1000,800,0)`）

### 1.3 参考尺寸（虚线）

- 对尺寸标注 **右键** 打开上下文菜单
- 点击：`设为参考尺寸`
- 预期：尺寸线/界线/弧变为 **虚线**，箭头仍为 **实线 V 形**

### 1.4 颜色与交互

对同一条尺寸标注验证：
- **正常**：SolveSpace 洋红（`ssConstraintMagenta`）
- **hover**：黄色（`ssHovered`）
- **selected**：红色（`ssSelected`）

### 1.5 留白与像素网格对齐

- 把文字拖到尺寸线/圆弧上方
  - 预期：线段在文字外接框处 **断开留白**（类似 SolveSpace `DoLineTrimmedAgainstBox`）
- 缓慢旋转相机 / 缩放
  - 预期：线条与文字的抖动显著减少（`AlignToPixelGrid`）

建议截图：
- 正常态 / hover / selected（同一尺寸）
- 参考尺寸（虚线）+ 非参考尺寸（实线）对比
- 文字在尺寸线中间（有留白）/ 文字拖到线外（无留白或只在相交时留白）

---

## 2) SolveSpace（作为 1:1 参考）

### 2.1 创建几何（与 demo 对齐）

在 SolveSpace 新建草图（单位 mm），画三段折线：
- 段1：`(0,0)` → `(1000,0)`
- 段2：`(1000,0)` → `(1000,800)`
- 段3：`(1000,800)` → `(2200,800)`

### 2.2 添加约束（对应 Web 侧尺寸）

- 对三段分别加 **距离约束**：`1000`、`800`、`1200`
- 在拐角（`(1000,0)`）处，对两条边加 **角度约束**：应为 `90°`

### 2.3 对齐对比项

重点对齐以下视觉细节（SolveSpace 为“金标准”）：
- **文字**：矢量线字体轮廓（非填充），粗细一致
- **箭头**：开口 V 形，角度与长度一致
- **留白**：约束线经过文字时断开，留白宽度与文字外接框一致
- **颜色**：默认洋红，hover 黄，selected 红
- **参考尺寸**：虚线/点划线表现
- **像素对齐**：轻微缩放/拖拽时不出现明显“糊边”和抖动

---

## 3) 常见偏差排查提示

- **文字不显示/显示为空**：
  - 检查 `public/fonts/unicode.lff.gz` 是否存在
  - 检查浏览器是否支持 `DecompressionStream('gzip')`
- **虚线不生效**：
  - 检查是否调用了 `computeLineDistances()`
  - 检查 dashed material 的 `dashSize/gapSize` 是否按 `worldPerPixel` 更新
- **hover/selected 没覆盖到文字**：
  - 检查 `onHighlightChanged()` 是否调用 `textLabel.setInteractionState(this.interactionState)`

