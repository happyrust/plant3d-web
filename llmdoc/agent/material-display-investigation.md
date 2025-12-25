<!-- Deep Investigation Report: Material Display Implementation in Plant3D Web -->

### Code Sections (The Evidence)

#### 1. Viewer 初始化和渲染配置

- `src/components/viewer.vue` (onMounted hook, lines 262-294): Viewer 实例化，设置非透明渲染、SAO、边线、相机参数。包括：
  - `transparent: false` - 非透明渲染画布（修复发白问题）
  - `saoEnabled: true` - 启用屏幕空间环境遮挡（SAO）
  - 边线配置：`edgeColor = [0.0, 0.0, 0.0]`（黑色），`edgeAlpha = 0.1`（微妙），`edgeWidth = 1`
  - SAO 配置：intensity=0.25, bias=0.5, scale=1000.0, kernelRadius=100, maxOcclusion=0.02, numSamples=10

- `src/components/dock_panels/ViewerPanel.vue` (onMounted hook, lines 614-627): 在 ViewerPanel 中的 Viewer 初始化：
  - `transparent: false` - 同样的非透明设置
  - 边线配置：`edgeColor = [0.15, 0.18, 0.22]`（深灰），`edgeAlpha = 0.35`（更明显），`edgeWidth = 1`

#### 2. 预打包模型加载时的颜色归一化

- `src/aios-prepack-bundle-loader.ts` (lines 191-204): `normalizeRgbaMaybe()` 函数 - 颜色归一化逻辑：
  - 检测 RGBA 分量中任何值 > 1.0
  - 若 max > 1.0，则除以 255 以转换为 0..1 范围
  - 防止颜色被 clamp 到 1 导致偏白问题

- `src/aios-prepack-bundle-loader.ts` (lines 1499-1515): 模型加载时的材质参数设置：
  - 调用 `normalizeRgbaMaybe()` 处理颜色索引对应的 RGBA
  - BRAN 类元件：固定蓝色 [0.2, 0.45, 0.85]
  - 其他元件：使用归一化后的颜色或默认灰色 [0.85, 0.85, 0.85]
  - 透明度：从归一化的 alpha 值提取，默认 1
  - createMesh 调用参数：`metallic: 0`, `roughness: 1`（完全非金属、完全粗糙）

- `src/aios-prepack-bundle-loader.ts` (lines 1536-1545): 非延迟加载模式下 mesh 创建：
  - 同样的颜色/透明度/金属度/粗糙度参数传递给 createMesh

- `src/aios-prepack-bundle-loader.ts` (lines 663-671): LazyEntityManager.showEntity() 中的延迟加载：
  - 从 InstanceData 读取预计算的 color 和 opacity
  - createMesh 参数：`metallic: 0`, `roughness: 1`

#### 3. 选中状态材质

- `src/composables/useXeokitTools.ts` (lines 638-655): `configureSelectionMaterial()` 函数：
  - fillColor: [1.0, 1.0, 0.0]（黄色）
  - fillAlpha: 0.3（半透明）
  - edgeColor: [1.0, 0.5, 0.0]（橙色）
  - edgeAlpha: 1.0（完全不透明）
  - edgeWidth: 3（较粗）
  - glowThrough: true（透过其他对象发光）

#### 4. Ptset 可视化材质

- `src/composables/usePtsetVisualization.ts` (lines 320-327): 十字星 LineSet 创建：
  - color: [0.2, 0.8, 0.3]（绿色）
  - opacity: 1.0

- `src/composables/usePtsetVisualization.ts` (lines 340-347): 方向箭头 LineSet 创建：
  - color: [1, 0.5, 0]（橙色）
  - opacity: 1.0

- `src/assets/main.scss` (lines 128-144): Ptset 标签样式：
  - 背景：`rgba(0, 0, 0, 0.75)`（深透明黑）
  - 点号颜色：#4ade80（绿色）
  - 坐标颜色：#d1d5db（浅灰）
  - 外径颜色：#fbbf24（金黄）

#### 5. OBB 批注材质

- `src/composables/useXeokitTools.ts` (lines 1787-1800): OBB 选择网格创建：
  - PhongMaterial：diffuse: [1, 1, 1]（白色）
  - opacity: 0.01（几乎不可见，用于拾取）

#### 6. 标注和测量工具的几何体颜色

- `src/composables/useXeokitTools.ts` (lines 1278-1279): 矩形批注线框：
  - color: [1, 1, 0]（黄色）
  - opacity: 1.0

- `src/composables/useXeokitTools.ts` (lines 1762-1763): 云形批注：
  - color: [0.1, 0.9, 1.0]（青色）
  - opacity: 1.0

- `src/composables/useXeokitTools.ts` (lines 1918-1919): 另一个批注：
  - color: [1, 1, 0]（黄色）
  - opacity: 1.0

---

### Report (The Answers)

#### result

##### 1. 材质配置全景

**Viewer 初始化渲染设置（两个位置）：**

在 `src/components/viewer.vue` 中：
- Viewer canvas：非透明渲染（`transparent: false`）
- SAO（屏幕空间环境遮挡）：启用，intensity=0.25, bias=0.5, scale=1000.0, kernelRadius=100, maxOcclusion=0.02, numSamples=10
- 边线：启用，黑色 [0.0, 0.0, 0.0]，透明度 0.1，宽度 1

在 `src/components/dock_panels/ViewerPanel.vue` 中（备用初始化）：
- Viewer canvas：非透明渲染（`transparent: false`）
- 边线：启用，深灰 [0.15, 0.18, 0.22]，透明度 0.35，宽度 1

两处都设置了 Z-up 坐标系（CAD/BIM 标准）。

**模型加载时的材质：**

在 `src/aios-prepack-bundle-loader.ts` 中处理预打包模型实例：
- BRAN 类（分支管道）：固定蓝色 [0.2, 0.45, 0.85]
- 其他类型：从 colors 数组使用颜色索引，通过 `normalizeRgbaMaybe()` 自动归一化
- 默认灰色：[0.85, 0.85, 0.85]
- 所有 mesh 创建：metallic=0（完全非金属），roughness=1（完全粗糙）
- 透明度：从颜色的 alpha 通道或默认 1.0

**选中状态（交互）：**

在 `src/composables/useXeokitTools.ts` 中的 selectedMaterial 配置：
- 填充颜色：黄色 [1.0, 1.0, 0.0]，半透明 0.3
- 边线：橙色 [1.0, 0.5, 0.0]，完全不透明，宽度 3
- glowThrough：true（透过其他对象可见）

**Ptset 可视化标记：**

在 `src/composables/usePtsetVisualization.ts` 中：
- 十字星：绿色 [0.2, 0.8, 0.3]，完全不透明
- 方向箭头：橙色 [1, 0.5, 0]，完全不透明
- HTML 标签（在 main.scss）：黑色半透明背景，绿/灰/金黄文字

**批注工具：**

- 矩形/OBB 边框：黄色 [1, 1, 0]，完全不透明
- 云形批注：青色 [0.1, 0.9, 1.0]，完全不透明
- OBB 拾取网格：白色，opacity 0.01（隐形拾取用）

##### 2. 颜色归一化实现细节

核心函数 `normalizeRgbaMaybe()` 位置：`src/aios-prepack-bundle-loader.ts:191-204`

```
检查逻辑：
1. 提取 RGBA 四个分量（默认值都是 1）
2. 校验所有值都是有限的数字
3. 找出最大值 max = Math.max(r, g, b, a)
4. 如果 max > 1.0，则除以 255：[r/255, g/255, b/255, a/255]
5. 否则直接返回：[r, g, b, a]
```

这个函数在两个地方被调用：
- 行 1501：加载预打包模型时，从颜色数组中获取实例的 RGBA
- 行 1264：加载 V1.0 哈希包时，处理实例颜色

**应用场景：**

当后端导出的颜色数据为 [R, G, B, A] 格式且值在 0-255 范围时（如从 PDMS/CAD 导出），自动检测并缩放到 0-1 范围，避免被 WebGL clamped 到 1。

##### 3. 现有问题及修复代码

根据 CHANGELOG.md 第 7-10 行，存在的"发白/曝光过度"问题及其修复：

**问题原因：**
- Viewer 画布设置为透明 (`transparent: true`)，与页面白色背景叠加导致整体发灰
- 预打包实例颜色未进行边界检查，RGBA > 1 的值被 WebGL clamped 到 1，导致材质偏白

**修复代码：**

1. 画布非透明设置：`src/components/viewer.vue:269` 和 `src/components/dock_panels/ViewerPanel.vue:616`
   - 改为 `transparent: false`

2. 背景清屏色（推测在 xeokit Viewer 内部）：通过 SAO 参数调整和相机配置优化对比度

3. 颜色归一化：`src/aios-prepack-bundle-loader.ts:191-204` 和应用点 1501, 1264
   - 检测 > 1 自动除以 255

4. 边线优化：
   - viewer.vue：黑色微妙边线，alpha=0.1，强化模型轮廓而不喧宾夺主
   - ViewerPanel.vue：深灰边线，alpha=0.35，更平衡的可见性

##### 4. 材质归一化的完整流程

```
API 返回 colors 数组 (每个元素可能 [R, G, B, A] 0-255)
  ↓
flattenInstances() 收集实例，每个实例有 color_index
  ↓
查表 colors[color_index] 得到 rgba 数组
  ↓
normalizeRgbaMaybe(rgba) 检查并转换：
  - 若 max(r,g,b,a) > 1.0，除以 255
  - 返回 [r', g', b', a'] 都在 0-1 范围
  ↓
提取前三个分量作为 RGB，第四个作为 opacity
  ↓
createMesh() 时传入 color=[r,g,b], opacity=a
```

特殊处理：
- BRAN 元件覆盖：如果 ownerNoun === 'BRAN' 或 category === 'BRAN'，使用蓝色 [0.2, 0.45, 0.85]
- 无颜色情况：使用默认灰色 [0.85, 0.85, 0.85]

##### 5. 可能的材质显示问题点

根据代码分析，以下情况可能导致材质显示异常：

**问题1：颜色数据来源不匹配**
- 位置：`src/aios-prepack-bundle-loader.ts:1500-1505`
- 症状：某些模型显示颜色错误或全部偏白
- 原因：colors 数组索引超出范围，或颜色值格式不符合预期
- 代码逻辑：如果 colorIndex 无效，使用默认灰色（这是正确的防御）

**问题2：透明度混合**
- 位置：所有 createMesh 调用使用 `opacity: inst.opacity` 或 `opacity: 1.0`
- 症状：模型显示不完整或透明
- 原因：normalizeRgbaMaybe() 提取的 alpha 值可能异常，或 xeokit 的混合模式
- 修复建议：检查 colors[index][3] 是否总是有效的

**问题3：边线视觉冲突**
- 位置：`src/components/viewer.vue:276` 和 `src/components/dock_panels/ViewerPanel.vue:622`
- 症状：两处 Viewer 初始化边线配置不一致，可能导致某个视图边线显示不对
- 观察：viewer.vue 边线更微妙（alpha=0.1），ViewerPanel 更明显（alpha=0.35）
- 原因：可能有两个独立的 Viewer 实例，或 ViewerPanel 是备用代码

**问题4：SAO 过度或不足**
- 位置：`src/components/viewer.vue:281-290` 的 SAO 参数
- 症状：模型显示过暗或缺乏立体感
- 当前配置：intensity=0.25（中等），kernelRadius=100（较大）
- 可调参数：intensity（默认 1.0，目前 0.25），maxOcclusion（0.02）

**问题5：Z-up 坐标系与相机的交互**
- 位置：`src/components/viewer.vue:296-300` 和 `src/components/dock_panels/ViewerPanel.vue:630-634`
- 症状：模型方向错误或相机行为异常
- 代码：都设置了相同的 Z-up 配置，应该是一致的

##### 6. 材质相关的代码文件完整清单

| 文件 | 行号 | 功能 |
|------|------|------|
| `src/components/viewer.vue` | 262-294 | Viewer 初始化（SAO、边线、相机） |
| `src/components/dock_panels/ViewerPanel.vue` | 614-627 | 备用 Viewer 初始化 |
| `src/aios-prepack-bundle-loader.ts` | 191-204 | 颜色归一化函数 |
| `src/aios-prepack-bundle-loader.ts` | 1457-1551 | 预打包模型加载与颜色应用 |
| `src/aios-prepack-bundle-loader.ts` | 663-671 | 延迟加载时的 mesh 创建 |
| `src/composables/useXeokitTools.ts` | 638-655 | 选中状态材质配置 |
| `src/composables/usePtsetVisualization.ts` | 320-350 | Ptset 可视化标记颜色 |
| `src/assets/main.scss` | 110-144 | Ptset 标签样式 |
| `CHANGELOG.md` | 7-10 | 材质问题修复记录 |

---

### conclusions

1. **材质显示架构**
   - 非透明 canvas 渲染是关键，避免与页面背景混合导致发灰
   - SAO（屏幕空间环境遮挡）用于增强立体感，intensity=0.25 是中等强度配置
   - 边线渲染默认启用，有两套不同的配置（viewer.vue 微妙，ViewerPanel 明显）

2. **颜色管理体系**
   - 后端导出的颜色数据（0-255）通过 normalizeRgbaMaybe() 自动检测并转换为 0-1 范围
   - BRAN 元件特殊处理为蓝色 [0.2, 0.45, 0.85]，其他使用索引查表或默认灰色
   - 所有 mesh 的 metallic=0（非金属）和 roughness=1（完全粗糙）是标准配置

3. **选中和交互状态**
   - selectedMaterial 使用黄色填充 + 橙色边线，半透明填充但边线完全不透明
   - Ptset 可视化使用绿色十字星 + 橙色箭头，高对比度便于视觉定位
   - 批注工具使用黄色/青色，与选中状态形成视觉区分

4. **已知的显示问题及修复**
   - "发白"问题根源：transparent=true + RGBA > 1 clamping
   - 修复方案：transparent=false + normalizeRgbaMaybe() 自动检测
   - 两处 Viewer 初始化的边线配置不同，可能存在历史遗留或多视图场景

5. **潜在风险点**
   - 颜色数组超界：缺乏 colors.length 的有效性检查（代码中有防御但未显式验证边界）
   - 两套渲染初始化：viewer.vue 和 ViewerPanel.vue 可能会冲突，需明确哪个是主流程
   - SAO 参数硬编码：intensity=0.25 固定，无法动态调整满足不同场景需求

---

### relations

**数据流关系：**

1. **模型加载 → 颜色应用**
   - `loadAiosPrepackBundle()` 读取 instanceManifest.colors 数组
   - `flattenInstances()` 为每个 instance 关联 color_index
   - `normalizeRgbaMaybe()` 对 colors[index] 进行 0-1 范围归一化
   - `createMesh()` 将归一化的 color 和 opacity 作为参数

2. **Viewer 初始化 → 默认渲染**
   - `src/components/viewer.vue:onMounted()` 创建 Viewer 并配置 SAO/边线
   - 在加载任何模型前，已设定全局渲染参数
   - `configureSelectionMaterial()` 在模型加载完成后配置选中效果

3. **Ptset 可视化 → 覆盖层渲染**
   - `usePtsetVisualization.renderPtset()` 创建 LineSet（十字星、箭头）
   - LineSet 使用固定的绿色/橙色，不受模型颜色影响
   - HTML 标签层在 xeokitOverlay 容器中，通过 CSS 样式独立控制

4. **选中状态 → 交互反馈**
   - `useXeokitTools.configureSelectionMaterial()` 配置 selectedMaterial
   - 用户点击模型时自动应用黄色填充 + 橙色边线
   - `syncFromStore()` 监听选中状态变化并更新视觉反馈

5. **批注工具 → 临时几何体**
   - 每个批注（矩形、云形、OBB）创建独立的 LineSet 或 Mesh
   - 使用特定的颜色标识不同的批注类型
   - 与模型原始材质无交集，通过 z-index/opacity 分层显示

**关键依赖：**

- `src/aios-prepack-bundle-loader.ts` 中的 `normalizeRgbaMaybe()` 是颜色显示的关键函数，被 4 处调用（两次在 flattenInstances 处理 V2/V1，两次在模型加载中）
- `src/components/viewer.vue` 的 Viewer 初始化配置影响全局渲染质量，与 ViewerPanel.vue 配置可能冲突
- `src/composables/useXeokitTools.ts` 的 `configureSelectionMaterial()` 在 model 加载后 lazy 调用一次，需确保每个 Viewer 实例都被配置

