# 管道间平行距离自动标注 - 实现总结

**日期**: 2026-03-11  
**状态**: ✅ 完成

## 实现内容

### 1. 核心几何计算 (`pipeClearance.ts`)

添加了 `computePipeToPipeClearance` 函数：
- 计算两根平行管道之间的最短距离
- 检查平行性（轴线夹角 < 5°）
- 返回两个管道外表面的最近点和净距

### 2. API 数据类型 (`mbdPipeApi.ts`)

添加了新的数据类型：
```typescript
export type MbdPipeClearanceDto = {
  id: string
  pipe1_refno: string
  pipe2_refno: string
  start: Vec3
  end: Vec3
  distance: number
  text: string
  layout_hint?: MbdLayoutHint | null
}
```

在 `MbdPipeData` 中添加：
```typescript
pipe_clearances?: MbdPipeClearanceDto[]
```

### 3. 自动检测逻辑 (`detectPipeClearances.ts`)

实现了 `detectPipeClearances` 函数：
- 遍历不同 BRAN 之间的管段对
- 检查平行性和距离阈值
- 生成标注数据

### 4. 渲染逻辑 (`useMbdPipeAnnotationThree.ts`)

添加了完整的渲染支持：
- `renderPipeClearances` 函数渲染标注
- `showPipeClearances` 控制可见性
- 橙色标注区分于管段尺寸
- 集成到 `renderBranch` 流程

### 5. 单元测试

创建了完整的测试覆盖：
- `pipeClearance.test.ts`: 几何计算测试
- `detectPipeClearances.test.ts`: 检测逻辑测试
- 所有测试通过 ✅

## 文件清单

**新增文件**:
- `src/utils/three/geometry/clearance/detectPipeClearances.ts`
- `src/utils/three/geometry/clearance/detectPipeClearances.test.ts`
- `src/utils/three/geometry/clearance/index.ts`
- `docs/features/pipe-clearance-annotation.md`

**修改文件**:
- `src/utils/three/geometry/clearance/pipeClearance.ts`
- `src/utils/three/geometry/clearance/pipeClearance.test.ts`
- `src/api/mbdPipeApi.ts`
- `src/composables/useMbdPipeAnnotationThree.ts`

## 测试结果

```
✓ pipeClearance.test.ts (3 tests)
✓ detectPipeClearances.test.ts (3 tests)
Total: 6 passed
```

## 使用方法

### 前端自动检测

```typescript
import { detectPipeClearances } from '@/utils/three/geometry/clearance';

const branches = {
  'bran1': bran1Data.segments,
  'bran2': bran2Data.segments,
};

const clearances = detectPipeClearances(branches, 500, 5);
mbdData.pipe_clearances = clearances;
mbdAnnotation.renderBranch(mbdData);
```

### 控制可见性

```typescript
mbdAnnotation.showPipeClearances.value = true;
```

## 技术特点

1. **最小化实现**: 仅添加必要代码，复用现有基础设施
2. **类型安全**: 完整的 TypeScript 类型定义
3. **测试覆盖**: 单元测试验证核心逻辑
4. **可配置**: 距离阈值和角度阈值可调整
5. **视觉区分**: 橙色标注区分于其他尺寸

## 后续优化（可选）

1. 空间索引优化（大量管道场景）
2. 后端 API 集成
3. 交互式调整标注位置
4. 性能监控和优化
