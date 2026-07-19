# 尺寸创建通过注入的 SnapPort 获得锚点

模型与 viewer 层拥有 raycast、对象捕捉过滤、来源优先级、语义候选解析及到 Design Space 的坐标转换，并通过 `DimensionSnapPort` 返回强类型候选；尺寸创建控制器只声明当前阶段需要点、方向、圆或圆弧等能力并锁定候选。尺寸模块不得直接访问 DTX、Xeokit、ptset、primitive key points 或 Three.js 场景，从而把模型来源差异隔离在真实的适配 seam。
