# 管道间距离标注 - 快速启动指南

## 当前实现架构

### 1. 数据流

```
后端 API → MbdPipeData (含 pipe_clearances) → renderBranch() → 3D 场景
```

### 2. 核心组件

- **ViewerPanel.vue**: 主视图，调用 MBD API 并渲染
- **MbdPipePanel.vue**: 控制面板，提供可见性开关
- **useMbdPipeAnnotationThree**: 渲染逻辑

## 启动方式

### 方式 1: 后端返回数据（推荐）

后端在 `/api/mbd/pipe/{refno}` 接口中返回 `pipe_clearances` 字段，前端自动渲染。

**后端示例**:
```rust
// 在后端检测多个 BRAN 的管道间距离
let pipe_clearances = detect_pipe_clearances(&branches);
response.pipe_clearances = Some(pipe_clearances);
```

**前端自动处理**:
```typescript
// ViewerPanel.vue 中已有逻辑
const resp = await fetchMbdPipe(refno);
mbdPipeVis.renderBranch(resp.data); // 自动渲染 pipe_clearances
```

### 方式 2: 前端手动检测

在已加载多个 BRAN 后，前端手动检测并添加标注。

```typescript
import { detectPipeClearances } from '@/utils/three/geometry/clearance';

// 收集多个 BRAN 的管段数据
const branches = {
  'bran1_refno': bran1Data.segments,
  'bran2_refno': bran2Data.segments,
};

// 检测平行管道
const clearances = detectPipeClearances(branches, 500, 5);

// 添加到数据并渲染
mbdData.pipe_clearances = clearances;
mbdPipeVis.renderBranch(mbdData);
```

### 方式 3: UI 控制面板

在 MbdPipePanel 中添加开关控制可见性：

```vue
<!-- MbdPipePanel.vue -->
<label>
  <input type="checkbox" v-model="vis.showPipeClearances.value" />
  管道间距离
</label>
```

## 控制可见性

```typescript
// 显示/隐藏
mbdPipeVis.showPipeClearances.value = true;

// 默认值：true（自动显示）
```

## 参数配置

```typescript
detectPipeClearances(
  branches,
  500,  // 最大距离阈值（mm）
  5     // 最大夹角（度）
)
```

## 完整示例

```typescript
// 在 ViewerPanel.vue 或其他组件中
async function loadMultipleBrans() {
  // 1. 加载多个 BRAN
  const bran1 = await fetchMbdPipe('24383_73962');
  const bran2 = await fetchMbdPipe('24383_73963');
  
  // 2. 检测管道间距离
  const branches = {
    [bran1.data.branch_refno]: bran1.data.segments,
    [bran2.data.branch_refno]: bran2.data.segments,
  };
  const clearances = detectPipeClearances(branches);
  
  // 3. 合并数据并渲染
  bran1.data.pipe_clearances = clearances;
  mbdPipeVis.renderBranch(bran1.data);
  
  // 4. 控制可见性
  mbdPipeVis.showPipeClearances.value = true;
}
```

## 调试

浏览器控制台：
```javascript
// 查看当前标注数据
window.__dtxViewer.scene.children
  .find(g => g.name === 'mbd-pipe-annotations')
  .children.filter(c => c.userData.pipeClearance)

// 切换可见性
window.__mbdPipeVis.showPipeClearances.value = !window.__mbdPipeVis.showPipeClearances.value
```
