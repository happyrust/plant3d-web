## 问题描述

测量工具（距离等）hover 到构件时，会在该元素的 P-Point/关键点位置绘制绿色十字标记。这些十字按**世界坐标尺寸**绘制：

```ts
// usePtsetVisualizationThree.ts（修复前）
const crossSize = Math.max(0.2, pboreSceneSize * 0.15 || 0.6) / gmScale;
```

- `pbore=0`（无管径元素）走 `|| 0.6` 兜底 → 臂长 0.6m、**全幅 1.2m**
- 有管径时臂长至少 0.2m（全幅 0.4m）
- 候选点十字（`createCandidateCross`）同样是世界坐标三轴十字，臂长 0.38m / 0.18m

配合 `depthTest=false` + `renderOrder=980` 穿透渲染，近景时十字铺满屏幕，远看又缩没，且世界三轴六臂投影成一团斜线，读起来像坐标轴 gizmo 而非点标记——严重影响测量取点交互。

## 修复方案：屏幕空间恒定尺寸

### `src/composables/usePtsetVisualizationThree.ts`
- 十字几何改为原点居中、单位臂长的三轴 tick，`position` 挂到点坐标
- 新增 `updateMarkerScales()`：每帧用 `worldPerPixelAt()` 把 **8px 臂长（全幅 16px）**换算为当前深度的世界尺寸写入 `scale`——与 12px 吸附光圈、DOM 命中圆点同量级，任何缩放级别下大小恒定

### `src/composables/useXeokitMeasurementTools.ts`
- 候选点标记从世界三轴六臂改为**面向相机的屏幕 "+"**（相机 right/up 两笔）：`mesh_pick_point` 6px 臂长、其余点源 10px，随 pointermove 重建
- 透出 `updateMarkerScales()` 转发给 hover 可视化实例

### `src/components/dock_panels/ViewerPanel.vue`
- `renderFrame` 与 `renderFrameImmediate` 两条渲染路径均在 `updateLabelPositions` 旁调用 `xeokitMeasurementToolsRef.value?.updateMarkerScales?.()`（RAF 路径在验证中发现漏挂，已补）

## 验证

- 单测：`useXeokitMeasurementTools.test.ts` + `usePtsetSnap.test.ts` **70/70 通过**
- `npm run type-check`：新增错误 **0**（基线 476）；ESLint：0 警告
- 浏览器实测（PIPE `24381_572` `/1RCV013MN-A`，72 objects）：
  - hover 后 `dtx-ptset` 组生成 116 个标记，运行时 scale 随相机正确更新（实测 scale 经 `worldPerPixelAt` 反算 ≈ 8px/臂）
  - 截图：`docs/verification/measurement-ppoint-cross-after.jpg` —— 修复后 P-Point 为约 16px 的小十字，不再出现米级大十字
  - 复现 URL：`http://127.0.0.1:3101/?show_refno=24381_572&show_refno_select=0&output_project=AvevaMarineSample`

## 说明

- 截图中红色 X 状标记属于测量**尺寸线端头箭头**（`external` `#c81e1e`），与关键点十字无关，本次未改动
- 未改动吸附逻辑（仍按 12px 屏幕光圈捕捉）
