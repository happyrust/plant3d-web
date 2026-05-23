# DTX 房间凸壳裁剪 · 双轨架构

## Outcome

让 plant3d-web 在「按房间显示」时，把跨越房间边界的管道直段（CYLI / TUBI / PIPE 子件）按房间真实几何精准切断显示：

- 房间内的部分照常渲染；
- 房间外的部分完全消失（不是淡化，而是 per-fragment discard）；
- 立方体、多面体、含弧面的房间都要能用，性能不破坏 DTX 单 draw call 架构；
- 用户在 RoomStatusPanel / RoomTree 上能一键开启 / 关闭"按房间边界裁剪显示"。

最终交付：

1. 一份「双轨架构」实现（规则房间走 plane 集合，含曲面房间走 SDF 3D 距离场）；
2. **trait 化数据源** `RoomClipDataSource`（Mock / JsonFixture / Surreal 三实现，对齐 plant-mbd 的 BranchDataSource 设计），算法层完全不依赖具体数据库；详细见 `data-source-design.md`；
3. 后端 `/api/room/clip-config` + `/api/room/sdf/{hash}` 两个 endpoint；
4. 前端 `DTXClipController` + `DTXMaterial / DTXPickingMaterial` fragment shader 改造；
5. 一份覆盖立方体 / L 型 / 圆柱罐区 / 球罐 / 自由曲面 5 类房间的端到端验证文档（5 个 JSON fixture 可在 CI 跑）；
6. 三张配套架构图（已在 assets/）。

## Context

### 现状

- DTX 渲染层在 `src/utils/three/dtx/DTXLayer.ts` / `DTXMaterial.ts` / `DTXPickingMaterial.ts`，**完全没有任何 SectionPlane / clippingPlane / CSG 能力**。
- 现有 `fitClipPlanesToBox`（`src/viewer/dtx/DtxViewer.ts:237`）只是相机近远平面调节，与几何裁剪无关。
- 房间已经在 `plant-model-gen/src/fast_model/convex_decomp.rs` 做了 miniacd 凸分解 + parry3d TriMesh，每个房间 = `Vec<ConvexHull>` + 真实 `panel_meshes`。
- `component_overlaps_room()`（`convex_decomp.rs:602`）已经实现"任意重叠"判定，但只用于 inst_relate 关系入库。
- 前端 `useRoomTree`（`src/composables/useRoomTree.ts`）已支持 isolate / X-ray，但只能做对象级显隐——跨界 CYLI 要么整段显示要么整段隐藏，体验不好。

### 设计概览

整体路由（详见 `assets/dtx-room-clip-dual-track-arch.png`）：

```
TriMesh + ConvexRuntime
        │
   classify_room()
   ┌────┼─────┐
   ▼    ▼     ▼
 AABB HULLS  SDF
  │    │     │
  └─→ planes  sdf array
       │     │
  fragment shader 统一接口
```

- **AABB 模式**：立方体房间。6 个轴对齐平面，最便宜。
- **CONVEX_HULLS 模式**：多面体房间。N 个凸壳的 plane 集合，复用已有 `convex_decomp.rkyv`。
- **SDF 模式**：含弧面 / 复杂凹形房间。烘焙 128³ 距离场到 `sampler2DArray R16F`，shader 一次 texture sample 判定。

## Constraints

- **不破坏** DTX 单 draw call 架构；不引入额外 layer / pass（cap 等高保真效果可单独 overlay，但默认关闭）。
- shader 改造必须升级 `customProgramCacheKey`（DTXMaterial 当前 v11，DTXPickingMaterial 当前 v4），否则 three.js 会复用旧 program。
- `DTXPickingMaterial` 必须同步加裁剪逻辑，否则被裁的片元仍可被点中（语义不一致）。
- SDF bake 必须复用已有 `mesh_dir` 缓存目录约定（`{base}/sdf/{geo_hash}_sdf.rkyv`），不要新建独立缓存目录。
- 分类阈值（`FILL_RATIO_THRESHOLD = 0.95`、`HULL_COUNT_THRESHOLD = 16`、`TOTAL_PLANES_THRESHOLD = 256`、`NORMAL_DIVERSITY_THRESHOLD = 0.05`）必须可通过环境变量覆盖，方便线上调优。
- 后端任何房间 mesh / geo_hash 变化都必须触发对应缓存（plane meta + sdf）失效；优先复用 `convex_decomp` 的 geo_hash 失效机制。
- 前端不允许阻塞主线程做 SDF 解码：必须用 fetch + `ArrayBuffer` + `DataTexture.needsUpdate = true` 异步路径。
- 不动 `useRoomTree` 已有的 isolate / X-ray 语义；裁剪是新的并列动作，可以与 isolate 叠加。

## Non-Goals

- **不做切面封盖（cap）**。默认接受"切口看穿管子"。如未来产品确认要 cap，再单独做 overlay layer + stencil cap（方案 E 扩展）。
- 不做 manifold 真布尔切割。CPU 真切几何（方案 D）仅在极少数 SDF 也搞不定的开放壳体场景作为兜底，且本期不实现。
- 不重构现有 `convex_decomp` / `room_model` 关系判定逻辑；只新增"clip artifacts"分类与产出。
- 不改 BRAN/HANG 树结构；裁剪只对 CYLI / TUBI / PIPE 子件叶子节点生效（其他构件如设备、阀门也会被切，但典型工程场景不影响判断）。
- 不引入 WebGPU；本期严格 WebGL2 / GLSL3 / `sampler2DArray`。
- 不做"per-管道材质特殊处理"，所有 DTXMaterial 渲染的对象统一受裁剪影响。

## Ask Before

- 如果分类器把某类常见房间误判（如把 L 型房间分到 SDF），先停下来评估阈值，再决定是改算法还是改阈值。
- 如果发现后端 `convex_decomp` 现有数据在 panel 世界坐标转换上有口径不一致（比如有的房间 mesh 是局部坐标、有的是世界坐标），先确认再 bake，不要带病实施。
- 如果 SDF bake 总耗时超过现有 `rebuild_room_relations` 5 倍以上，先停下与用户讨论是否拆成独立 worker / 异步阶段。
- 如果 `sampler2DArray` 在目标浏览器（特别是 Windows Chromium GPU 老驱动）支持有问题，先报告并讨论降级路径，不要硬上。
- 如果发现裁剪与现有 X-ray / 选中高亮 / 透明渲染 pass 在 fragment 阶段有冲突，先记录 findings 再修。
- UI 设计：toggle 放在 RoomStatusPanel 头部还是 RoomTree 节点右键菜单？需要先和产品对齐。

## Done Means

- 用户在 plant3d-web 选中一个或多个房间后，可以一键开启"按边界裁剪显示"。
- 立方体房间：管道在房间壁正好切断，无视觉漏出。
- L 型 / 切角房间：凹角处也能正确切断。
- 圆柱罐 / 球罐 / 弧面房间：曲面处沿真实墙体形状切断，没有"折面感"。
- 性能：单次切换裁剪状态时 FPS drop ≤ 10%；启用裁剪后稳定帧率不低于关闭时的 90%。
- 后端 bake：单房间 128³ SDF bake < 30s（单核），增量更新只 bake 变化的房间。
- 前后端 API 契约稳定，未来增加新模式（如 KD-tree、BVH）不需要破坏 `/api/room/clip-config`。
- 五类房间端到端测试通过，verification.md 有命令 + 截图 + 性能数据记录。
- 三张架构图（`assets/`）能作为 RFC / 团队对齐 / 文档配图直接使用。

## Reference Assets

- `assets/dtx-room-clip-effect.png` — 3D BEFORE/AFTER 效果对比（业务汇报用）
- `assets/dtx-room-clip-dual-track-arch.png` — 双轨架构总览（团队对齐用）
- `assets/dtx-room-clip-shader-data-flow.png` — DataTexture 内存布局 + fragment shader fetch（实现细节用）

## 相关文档

- `data-source-design.md` — trait 化数据源 + JSON fixture 完整设计（Phase 0.5 的实施指南）
- 参考：`plant-mbd/docs/SurrealBranchDataSource边界设计.md`
- 参考：`rs-core/MBD/docs/BRAN管道标注算法-trait骨架与文件规划.md`
