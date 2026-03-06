# DTX Overlay Edge/Outline Design

**日期：** 2026-03-07

**目标：**
让透明选中填充不再显示内部 mesh 的 `edge` 边线，同时在选中时额外显示外轮廓 `outline`，并且默认不启用全局工程边线。

**现状：**
- `DTXOverlayHighlighter` 固定使用 `EdgesGeometry` 为高亮对象生成边线。
- `ViewerPanel` 默认开启全局工程边线。
- 选中态当前使用 `highlightMode: "overlay"`，因此透明填充和 `edge` 同时存在。

**决策：**
1. 在 `DTXOverlayHighlighter` 上增加 `showEdges` 开关。
2. 选中态改为 `highlightMode: "both"`，即：
   - `overlay` 只负责半透明填充；
   - `outline` 负责选中的外轮廓；
   - `overlay` 不再绘制 `EdgesGeometry`。
3. 全局工程边线默认关闭，但保留现有开关能力，便于按需开启。

**不做的事：**
- 不尝试在 `EdgesGeometry` 层面做“仅保留外部轮廓”的几何合并。
- 不改动 DTX 主渲染材质或透明排序策略。

**验收标准：**
- 未选中时，默认不显示全局工程边线。
- 选中对象时，可见半透明填充。
- 选中对象时，可见 outline 外轮廓。
- 选中对象时，不再出现内部 mesh 的 `edge` 线框。
