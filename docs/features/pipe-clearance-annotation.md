# 管道间平行距离自动标注

## 功能概述

自动检测不同 BRAN 之间平行且距离较近的管道，并在 3D 场景中显示距离标注。

## 使用方法

### 1. 后端集成（可选）

如果需要后端计算管道间距离，可以在后端 API 中使用检测逻辑：

```rust
// 在后端计算并返回 pipe_clearances
// 前端会自动渲染这些标注
```

### 2. 前端自动检测

前端可以自动检测已加载的多个 BRAN 之间的管道距离：

```typescript
import { detectPipeClearances } from '@/utils/three/geometry/clearance/detectPipeClearances';

// 准备多个 BRAN 的管段数据
const branches = {
  'bran1_refno': bran1Data.segments,
  'bran2_refno': bran2Data.segments,
};

// 检测平行管道（距离 < 500mm，夹角 < 5°）
const clearances = detectPipeClearances(branches, 500, 5);

// 将结果添加到 MbdPipeData 中
mbdData.pipe_clearances = clearances;

// 渲染
mbdAnnotation.renderBranch(mbdData);
```

### 3. 控制可见性

```typescript
// 显示/隐藏管道间距离标注
mbdAnnotation.showPipeClearances.value = true;
```

## 技术细节

### 检测算法

1. **平行判定**：管道轴线夹角 < 5°（可配置）
2. **距离计算**：管道外表面之间的最短距离
3. **距离阈值**：默认 500mm（可配置）

### 标注样式

- **颜色**：橙色（区分于管段尺寸）
- **箭头**：与当前 MBD 模式一致
- **文字**：显示净距（单位：mm）

## API 参考

### detectPipeClearances

```typescript
function detectPipeClearances(
  branches: Record<string, MbdPipeSegmentDto[]>,
  maxDistance?: number,  // 默认 500mm
  maxAngleDeg?: number,  // 默认 5°
): MbdPipeClearanceDto[]
```

### MbdPipeClearanceDto

```typescript
type MbdPipeClearanceDto = {
  id: string
  pipe1_refno: string
  pipe2_refno: string
  start: Vec3  // pipe1 外表面点
  end: Vec3    // pipe2 外表面点
  distance: number
  text: string
  layout_hint?: MbdLayoutHint | null
}
```

## 示例场景

### 场景 1：两根平行管道

```
BRAN1: ====== (DN100)
           ↕ 150mm
BRAN2: ====== (DN80)
```

系统自动标注 150mm 的净距。

### 场景 2：多根管道

```
BRAN1: ======
BRAN2: ======
BRAN3: ======
```

系统检测所有管道对，标注距离 < 500mm 的管道对。

## 性能优化

- 使用空间索引优化大量管道场景
- 仅检测不同 BRAN 之间的管道
- 可配置距离阈值减少标注数量
