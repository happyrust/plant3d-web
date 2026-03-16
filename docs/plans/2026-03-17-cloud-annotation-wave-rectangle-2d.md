# 云线矩形波浪线重构开发文档（2026-03-17）

## 目标
- 将原有云线批注的“椭圆/不规则泡泡”轮廓改为屏幕二维固定矩形，并在四条边缘加入连续波浪扰动。
- 保持现有的 3D 绑定关系不变：`anchor` 与 `leader` 仍使用世界坐标，轮廓在每帧按相机姿态生成 2D billboard。
- 不改 `AnnotationRecord` 存储结构，保持现有历史数据兼容。

## 关键实现
### 1) 统一二维波浪矩形生成
- 修改 `createCloudPath`：不再基于 `sin/cos` 生成椭圆，而是调用统一的矩形波浪底层函数。
- 增加内部方法 `buildCloudWavyRectanglePoints2D(cx, cy, width, height, options)`：
  - 按 4 条边独立采样；
  - `segmentsPerEdge = 16`，`wavesPerEdge = 4`；
  - 每条边法向方向施加小角度正弦扰动；
  - 幅度按 `edgeLength * 0.015` 计算，并限制在 `1~6px`（在 3D 版本中会换算为世界单位）；
  - 最小边长保护为 `12px`，避免退化。
- 生成结果仍转为 `M/L/Z` SVG path，并闭合。

### 2) 3D billboard 轮廓复用
- 修改 `buildCloudBillboardPolyline`：保留外部调用链与生命周期，仅替换路径采样策略为上述矩形波浪函数。
- 参数 `segments` 默认值保持 `16`；`width/height` 仍按 `cloudSize`（经 `computeCloudLayout` 限幅）推入。
- 引入 `worldPerPixel` 后，波幅在世界单位上按 `1~6px` 上下限回映射，视觉上保持“2D 屏幕风格”。
- 云线 outline 使用 `MeshLine` 渲染，提供更稳定且可感知的线宽（相较 `Line` 在 WebGL 下更可靠）。

### 3) overlay 更新链路不变
- `updateOverlayPositions` 不改流程，仍按 `anchor + right/up + width/height` 组装点列；
- 因此 zoom/rotate/pan 仍保持“屏幕外观稳定”，符合原有 anchor + leader 联动模型。

### 4) 就绪状态恢复链路
- `isDtxInteractionReady` 增加对 `stats.totalObjects > 0` 与 `layer.objectCount > 0` 的判定，兼容 `compiled=false` 时已加载对象仍可交互。
- `useDtxTools` 增加 `readyRevision` 与 `refreshReadyState()`，用于显式刷新依赖内部统计变化的 ready 状态。

## 影响文件
- `src/composables/useDtxTools.ts`
- `src/composables/useDtxTools.pickRefno.test.ts`

## 测试与验收
### 单测
- `computeCloudLayout`：`cloudPath` 结构为 `M ... L ... Z`，且坐标系为矩形波浪。
- `buildCloudBillboardPolyline`：
  - 闭合性；
  - 点数预期（`segments*4+2`）；
  - 包围盒范围与波浪后非退化；
  - 最小尺寸保护。
- `isDtxInteractionReady` 与 `useDtxTools.ready` 覆盖 `compiled=false` 但对象存在时可 ready 的场景。

### 运行命令
- `npm run test -- src/composables/useDtxTools.pickRefno.test.ts`
- `npm run lint -- src/composables/useDtxTools.ts`
- `npm run type-check`

## 验收说明
- 已补充/更新纯函数级单测（见 `useDtxTools.pickRefno.test.ts`）验证：
  - `computeCloudLayout` 返回的 `cloudPath` 为闭合路径。
  - `buildCloudBillboardPolyline` 的闭合与包围盒检查。
  - 最小尺寸保护不退化。
- 当前截图验收场景若有差异，通常是基线未按新形状更新导致；建议在确认形状后用 `PLAYWRIGHT_UPDATE_SNAPSHOTS=1` 进行同步更新。
