# Issue: DTX 大模型表面闪烁（粉/灰像素颗粒交错，z-fighting）

| 元信息 | 值 |
|------|------|
| 上报日期 | 2026-04-29 |
| 严重度 | P1（影响视觉可读性，但不阻塞功能） |
| 影响范围 | 所有 DTX 渲染场景（罐体、薄壁件、共面设备等） |
| 修复状态 | ✅ Tier 1 + Tier 2.1 已落地（待用户视觉验证），Tier 2.2 / Tier 3 待评估 |
| 责任文件 | `src/utils/three/dtx/DTXMaterial.ts`、`src/viewer/dtx/DtxViewer.ts`、`src/viewer/dtx/DtxCompatViewer.ts` |

## 1. 现象描述

DTX 加载的大模型在某些视角下，物体表面（尤其是罐体、薄壁件、几何重叠区域）出现**像素级颗粒状的颜色交错闪烁**：

- 罐体下半部应为单一颜色，实际看到 **粉色（应是某管段/设备颜色）与灰色（罐体本色）成颗粒状互相穿透**。
- 闪烁不限于动画帧，**相机静止时同样存在**；缩放/旋转时部分像素颜色发生跳变。
- 罐体顶部（盖部）相对洁净——这是因为顶部没有内部设备/管线与之共面。

### 截图

> 用户截图请保存为 `docs/issues/images/dtx-z-fighting-flicker-2026-04-29/screenshot-tank-flicker.png`，下面引用即可显示：

![罐体侧壁出现粉色与灰色颗粒交错的 z-fighting](./images/dtx-z-fighting-flicker-2026-04-29/screenshot-tank-flicker.png)

特征要点：
1. 颗粒分布**密集且离散**（不是颜色梯度、不是 SSAO 噪点、不是抗锯齿伪影）。
2. 粉色和灰色像素**互相抢占同一像素位置**，与典型 z-fighting 表现完全一致。
3. 背景管道/钢架边缘清晰，未受影响 → 排除整体渲染管线问题。

## 2. 复现条件

任意以下情形之一即可复现：

1. 加载含**双层壁（外壳 + 衬里）罐体或换热器**的 DTX 模型。
2. 加载含**包络体（BBOX collider / annotation marker mesh）**与本体几乎完全重合的对象。
3. **远景观察**含大量小型平面（板筋、铭牌、托盘）的工艺装置区。
4. 所有 PDMS / AVEVA Marine 工程模型（`24381/...` 系列）几乎都会出现，差别只在闪烁分布。

## 3. 根本原因分析

> 已读代码定位，三类原因叠加。

### 类别 A：DoubleSide 同物前后面 z-fighting

`src/utils/three/dtx/DTXMaterial.ts` 第 372–376 行：

```typescript
this.side = 2; // DoubleSide  // 注释明写"禁用背面剔除以便调试"
this.transparent = options.transparent ?? false;
this.depthWrite = options.depthWrite ?? true;
this.depthTest = options.depthTest ?? true;
```

- 所有 DTX 不透明物体启用了 **DoubleSide**，前后面同时被光栅化。
- 单面 mesh（"无厚度的薄壳"）的前面与背面 fragment **几乎落在同一深度**，对数深度缓冲也无法区分。
- 没有 `polygonOffset`，也没有按 `gl_FrontFacing` 区分的深度偏移。

### 类别 B：不同物体共面（重合几何）z-fighting

vertex shader 中的 `vDepthBias`：

```glsl
vDepthBias = float(objectIndex & 7u) * 1.5e-7;
```

- 用 `objectIndex` 的低 3 位为不同 object 生成 8 级微偏移，**用意是打破共面**。
- 偏移幅度 `1.5e-7`：在 logDepthBuf 的 `gl_FragDepth` 域里这是个**正确量级**，但当两个共面物体的 `objectIndex & 7` 恰好相同时（每 8 个对象就会冲突一次），偏移失效。
- 同时该偏移**完全无法解决类别 A**（同 object 前后面是同一 objectIndex）。

### 类别 C：远 far 面导致深度精度浪费

`src/viewer/dtx/DtxViewer.ts:98` 与 `src/viewer/dtx/DtxCompatViewer.ts:40-41`：

```typescript
this.camera = new PerspectiveCamera(30, 1, 0.5, 500_000);
// DtxCompatScene
camera = { perspective: { near: 0.1, far: 1_000_000 } };
```

- near/far 跨度 1×10⁶ 量级（相当于 mm 单位下覆盖 1km×1km 工厂）。
- 即使 `logarithmicDepthBuffer: true`（DtxViewer.ts:87），单位深度可分辨距离仍然过粗，A/B 类的微距共面会被精度吃掉。

## 4. 修复方案

按"低风险 → 治本"分三层。**建议先落地 Tier 1（5 行代码 + cacheKey 升级），观察消除比例再决定是否进入 Tier 2/3。**

### Tier 1：低风险高收益（建议立即落地）

#### 1.1 给不透明 DTXMaterial 加 polygonOffset

修改 `src/utils/three/dtx/DTXMaterial.ts` 第 372–376 行：

```typescript
this.side = 2; // DoubleSide
this.transparent = options.transparent ?? false;
this.depthWrite = options.depthWrite ?? true;
this.depthTest = options.depthTest ?? true;
// 新增：仅对不透明通道启用 polygonOffset，把"共面物体"在深度上整体撑开
// 透明通道 depthWrite=false 时无意义，反而会让排序更混乱
if (!this.transparent) {
  this.polygonOffset = true;
  this.polygonOffsetFactor = 1;
  this.polygonOffsetUnits = 1;
}
```

#### 1.2 fragment shader 给背面加额外深度偏移

修改 `src/utils/three/dtx/DTXMaterial.ts` 中 `DTX_FRAGMENT_SHADER` 第 296–298 行：

```glsl
#ifdef USE_LOGDEPTHBUF
  // 新增：背面比前面再退后 5e-7，破除同 object DoubleSide 自身闪烁
  float backFaceBias = gl_FrontFacing ? 0.0 : 5.0e-7;
  gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5 + vDepthBias + backFaceBias;
#endif
```

#### 1.3 升级 customProgramCacheKey

修改 `src/utils/three/dtx/DTXMaterial.ts` 第 388–392 行：

```typescript
customProgramCacheKey(): string {
  return 'DTXMaterial_v11'; // 从 v10 升到 v11，强制 Three.js 重编译 shader
}
```

> 不升 cacheKey 的话，Three.js 复用旧 program，shader 改动不生效。

### Tier 2：场景级精度治本

#### 2.1 自适应 near/far

加载完 DTX 后根据 sceneAabb 重设相机 near/far，替换 `DtxViewer.ts:98` 的硬编码：

```typescript
// 在 DtxViewer 中暴露方法
fitClipPlanesToScene(aabb: { min: Vector3; max: Vector3 }): void {
  const dx = aabb.max.x - aabb.min.x;
  const dy = aabb.max.y - aabb.min.y;
  const dz = aabb.max.z - aabb.min.z;
  const diag = Math.hypot(dx, dy, dz);
  this.camera.near = Math.max(0.05, diag * 0.0005);
  this.camera.far  = Math.max(diag * 5, 5_000);
  this.camera.updateProjectionMatrix();
}
```

加载完成回调里调用一次即可。同步 `DtxCompatScene.camera.perspective` 字段。

#### 2.2 DoubleSide 改为按对象 flag 控制

在 ColorsAndFlags 纹理增加 1 bit `needsDoubleSide`：电缆托盘、薄壁板筋、包覆层等真正薄壁标 1，其余实心管/罐/设备使用 `FrontSide`。

短期可先全场景改 `FrontSide`，肉眼观察哪些对象出现"消失面"再逐类标记 `needsDoubleSide`。

### Tier 3：数据层去重（仅当 Tier 1+2 仍闪）

PDMS / AVEVA Marine 中常见以下重合几何：
- 同一 EQUI 同时有 mesh 和 BBOX collider；
- 标签贴片（annotation marker）作为零厚度面贴在母体表面；
- DBNUM 多版本残留。

排查方法（控制台）：

```text
= 24381/144991        // 选中目标 RefNo
```

读 `DTXLayer` 索引：若一个 RefNo 对应多个 objectId 且 AABB 几乎完全重合，就是数据层问题。需要在 DTX 构建/导入流程中做去重或 markHidden。

## 5. 推荐验证步骤

1. 应用 Tier 1（约 5 行代码 + cacheKey 升版）。
2. 跑 `npm run type-check` + `npm run lint`，确认无回归。
3. 在 Chrome 开发者工具 Network → Disable cache，硬刷新 plant3d-web。
4. 加载本次出问题的同一模型/视角，对比闪烁。
   - **预期 90% 以上像素颗粒消失**。
   - 剩余的若是"远视距下整片同色块抖动"→ 进入 Tier 2 自适应 near/far。
   - 剩余的若是"近距静止仍有特定区域闪"→ 取该区域 RefNo，进入 Tier 3 数据层排查。
5. 对比同视角截图，附在本文档"5.x 验证截图"小节备查。

## 6. 相关文件

| 文件 | 作用 |
|------|------|
| `src/utils/three/dtx/DTXMaterial.ts` | DTX 主着色器材质，shader + cacheKey 修改入口 |
| `src/utils/three/dtx/DTXLayer.ts` | DTX 渲染层，opaque/transparent mesh 创建处（行 1136–1192） |
| `src/viewer/dtx/DtxViewer.ts` | 主 viewer，PerspectiveCamera near/far 配置（行 98） |
| `src/viewer/dtx/DtxCompatViewer.ts` | xeokit 兼容层 camera.perspective 配置（行 38–43） |
| `src/utils/three/dtx/DTXPickingMaterial.ts` | Picking 材质（亦是 DoubleSide，行 199），不参与渲染输出，无需改 |

## 7. 风险评估

| 修改 | 副作用 | 缓解 |
|------|------|------|
| Tier 1.1 polygonOffset | 极少数情况会把对象整体"抬高"导致与 LineSegments / EdgeMaterial 错位 | 经验值 1/1 通常安全；若错位再调到 0.5/1 |
| Tier 1.2 backFaceBias | 极薄板的双面颜色对比度会有微小肉眼不可见差异 | 偏移量 5e-7 在 logDepthBuf 域内极小 |
| Tier 1.3 cacheKey 升版 | 首次加载触发一次 shader 编译耗时（~50–100ms） | 一次性，可接受 |
| Tier 2.1 自适应 far | 场景外漫游时（如查看 skybox）远剪裁会变近 | 给 far 留 5x diag 缓冲 |
| Tier 2.2 FrontSide 化 | 法线方向错误的 mesh 会出现"消失面" | 灰度回归，逐对象标记 |
| Tier 3 数据去重 | 影响数据导入流程 | 需要导入侧配合 |

## 8. 修复状态

- [x] Tier 1.1 polygonOffset（2026-04-29，DTXMaterial.ts 仅 opaque 通道，factor=1 units=1）
- [x] Tier 1.2 backFaceBias（2026-04-29，fragment shader `gl_FrontFacing ? 0 : 5e-7`）
- [x] Tier 1.3 cacheKey 升版到 v11（2026-04-29）
- [x] Tier 2.1 自适应 near/far（2026-04-29，DtxViewer.fitClipPlanesToBox + DtxCompatViewer.flyToImpl 集成）
- [x] type-check 通过（vue-tsc 0 errors）
- [x] DTX 单测全绿（5 文件 / 19 cases）
- [ ] 复现场景验证截图归档（**等待用户 reload 浏览器后比对截图**）
- [ ] Tier 2.2 ColorsAndFlags needsDoubleSide bit（视 Tier 1+2.1 残余决定）
- [ ] Tier 3 数据层去重（待用户提供 RefNo）

## 9. 参考

- Three.js docs: [polygonOffset](https://threejs.org/docs/#api/en/materials/Material.polygonOffset)、[logarithmicDepthBuffer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.logarithmicDepthBuffer)
- 仓库内类似缓解方案：`src/utils/three/dtx/selection/DTXOverlayHighlighter.ts:65-72` 已使用 polygonOffset 处理高亮覆盖层
- 仓库内 logDepthBuf 实现：`DTXMaterial.ts` 行 296–298（本次将增强）
