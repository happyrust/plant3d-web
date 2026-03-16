# Changelog

## Unreleased

### Added

- ReviewerTaskList 加入筛选条件状态持久化与滚动位置恢复机制
- M5 阶段设计追踪 `.factory/` 质量控制配置调整与扩充

### Fixed

- 修复测量模式下零分量轴标签冗余和坐标重叠问题，支持缩放避让
- 在存在 `globalModelMatrix` 时转换 local 坐标进行测距运算并补充单测
- 修复若干现有测距与 Vue 组件遗留验证错误

### Fixed

- 解决模型显示“发白/像曝光过度”的观感问题：
  - Viewer 画布改为非透明渲染，避免与页面背景叠加导致整体发灰。
  - 背景清屏色从纯白调整为浅灰，提升对比度与层次感。
  - 预打包实例颜色 `colors` 支持自动归一化：当检测到 RGBA 分量大于 1 时，按 255 缩放到 0..1，避免颜色被 clamp 到 1 导致材质偏白。

### Changed

- 默认开启 xeokit 边线显示（`scene.edgeMaterial.edges = true`），并设置边线颜色/透明度/宽度为更适合 CAD/BIM 观感的默认值。
