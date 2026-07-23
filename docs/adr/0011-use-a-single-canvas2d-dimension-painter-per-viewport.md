---
status: superseded
superseded_by: 0048-render-dimensions-as-solvespace-style-scene-geometry
---

# 每个视口使用单一 Canvas2D 尺寸画家

首版 `DimensionViewport` 在 Three.js 画面之上维护一张透明、感知 devicePixelRatio 的 Canvas2D overlay，并把所有 `LayoutResult` 批量绘制到该画布；不再为每个尺寸创建 DOM、Object3D、Line2 或 Mesh。命中测试直接使用同一份布局图元而非 Canvas 像素，未来 SVG、打印或离屏导出通过新增画家复用布局结果。该选择用放弃模型深度遮挡换取更小的资源表面、确定的屏幕像素语义和更简单的清理生命周期。
