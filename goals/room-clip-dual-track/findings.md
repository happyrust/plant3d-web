# Findings · DTX 房间凸壳裁剪

## 架构现状

### 渲染层（plant3d-web）

| 文件 | 关键事实 |
|---|---|
| `src/utils/three/dtx/DTXLayer.ts` | 单 draw call + GPU 纹理打包架构；`maxObjects`、`maxVertices`、`maxIndices` 可配置；所有 mesh 数据预打包 |
| `src/utils/three/dtx/DTXMaterial.ts` | 自研 ShaderMaterial（GLSL3）；`customProgramCacheKey() = 'DTXMaterial_v11'`；fragment shader 已有 `vWorldPosition` varying（**直接可用于裁剪判定**） |
| `src/utils/three/dtx/DTXPickingMaterial.ts` | 自研 picking shader；`'DTXPickingMaterial_v4'`；同样有 `vWorldPosition`（在主 shader 里有，picking 里目前没暴露——需补） |
| `src/viewer/dtx/DtxViewer.ts:237` | `fitClipPlanesToBox` 仅调相机近远平面，**与几何裁剪无关**，不要混淆 |
| `src/viewer/dtx/DtxCompatViewer.ts` | 提供 `scene.objects[id].visible`、`setObjectsVisible/XRayed`，是当前唯一的对象级显隐入口 |
| `src/composables/useSceneGraph.ts:115-134` | `isolate()` 用 `setObjectsXRayed(all, true) + setObjectsXRayed(keep, false)` 实现"半透明保留" |
| `src/composables/useRoomTree.ts:489-497` | `isolateXray(id)` 已经能"按房间 isolate"，但是对象级，没有按几何边界裁剪 |
| `src/components/dock_panels/RoomStatusPanelDock.vue` | 房间面板 dock，未来 toggle "按边界裁剪" 加在这里 |

**结论**：DTX 整个体系**完全没有 SectionPlane / ClippingPlane / CSG 能力**。`grep -ri 'sectionPlane\|clippingPlane'` 在 src 下零命中。新增能力必须靠 shader 端 fragment discard + DataTexture 上传房间几何元数据。

### 房间几何（plant-model-gen）

| 文件 | 关键事实 |
|---|---|
| `src/fast_model/convex_decomp.rs` | miniacd 凸分解后落盘到 `{base_mesh_dir}/convex/{geo_hash}_convex.rkyv`；`ConvexRuntime { geo_hash, hulls: Vec<ConvexHullRuntime> }`；`ConvexHullRuntime` 含 `local_aabb` + `vertices` + `sample_points_local` |
| `src/fast_model/convex_decomp.rs:602-645` | `component_overlaps_room(panel_meshes, panel_world_aabb, component_mat, component_hulls, tolerance)`：A) 点在体内 OR B) 边界相交 双路判定 |
| `src/fast_model/room_model.rs` (~200KB) | `cal_room_refnos`、`build_room_panels_relate_for_query`、`build_room_relations_*`；房间关系入 `inst_relate` 表；含 `RoomBuildStats` / `RoomComputeOptions` 等管理结构 |
| `src/fast_model/room_model.rs:345` | 空间索引覆盖的 noun 列表：`["BRAN", "HANG", "PIPE", "EQUI", "STRU", "FRMW", "SBFR", "ZONE"]` |
| `src/web_server/room_api.rs` | 已有 `/api/room/rebuild-relations`、`/api/room/worker/status`、`/api/room/status`、`query_room_by_point`、`batch_query_rooms` 等 endpoint |
| `src/web_api/room_tree_api.rs` | `/api/room-tree/root`、`/children/{id}`、`/ancestors/{id}`、`/search` |
| `src/fast_model/convex_decomp.rs:170-220` | `load_or_build_convex_runtime` 已经有按需 build + 落盘 + 缓存全套机制，可直接复用 |

**结论**：后端凸分解数据已经是高质量的房间几何表达（不是简单 AABB），方案 C 的 plane 集合**完全可以从 `ConvexHullRuntime.vertices` 反算出来**（用 `parry3d::shape::ConvexPolyhedron::from_convex_hull` + `face_normals()`）。

### 房间 - 构件粒度

| 项 | 当前 |
|---|---|
| 管道层级 | BRAN/HANG（父分支）→ CYLI/TUBI/PIPE/ELBO/FLAN/VALV/... 等子件叶子 |
| 直段 (CYLI/TUBI) | 每件独立 refno + 独立 `inst_transform` + 独立 `geo_hash`；几何是局部坐标（圆柱沿 Z 轴） |
| 房间-构件关系 | 已经离线判定并入 `inst_relate` 表；线上查询走 SQLite 空间索引 |
| 房间对象 ID | `useRoomTree` 里用正则 `/^\d+_\d+(,\d+)?$/` 识别（`useRoomTree.ts:25-27`） |

**结论**：DTX 渲染时不需要区分"哪些是管道哪些不是"——shader 裁剪对所有 fragment 生效。如果只想裁管道，需要在 `colorsAndFlagsTexture` 加一个"是否参与裁剪"的 flag bit（本期不做，所有可见构件统一裁）。

## 关键技术决策

### D1 · shader 端 plane 集合用 DataTexture 而非 uniform 数组

- **理由**：uniform 数组上限通常 256 个 vec4（部分驱动 1024），plane 集合可能上千个；DataTexture 没有上限，只受显存。
- **代价**：每次裁剪状态变化需要刷 DataTexture（数 KB / 房间），有一次 `gl.texSubImage2D` 开销，但 < 1ms。

### D2 · SDF 用 `sampler2DArray` 而非真正的 `sampler3D`

- **理由**：`sampler3D` 在 WebGL2 上虽然支持但驱动一致性差；`sampler2DArray` 兼容性最好，每个 layer 一个房间的 2D slice（其实 SDF 在 layer 维是离散的 voxel z-slice 重组）。
- **替代**：如果 z 方向也要 trilinear 插值，shader 端手动做两次 2D sample + lerp。
- **关键限制**：`sampler2DArray` 所有 layer 必须同尺寸。所以**所有 SDF 房间统一烘焙到 128²（或 64²）单 layer**，不能每个房间不同分辨率。z 维度由多个连续 layer 拼成。

### D3 · 分类阈值是可调环境变量

```
DTX_ROOM_CLIP_FILL_RATIO_THRESHOLD=0.95
DTX_ROOM_CLIP_HULL_COUNT_THRESHOLD=16
DTX_ROOM_CLIP_TOTAL_PLANES_THRESHOLD=256
DTX_ROOM_CLIP_NORMAL_DIVERSITY_THRESHOLD=0.05
DTX_ROOM_CLIP_SDF_VOXEL_SIZE=0.1
```

线上调参不需要发版。

### D4 · `DTXPickingMaterial` 必须同步

被裁的 fragment 在 picking shader 里也要 discard，否则用户点到"看不见的"管道仍会被选中，语义不一致。

### D5 · 失效检测复用 `geo_hash`

- 房间 panel mesh 变化 → `geo_hash` 变化 → `convex_decomp` rkyv 失效（已有机制）→ SDF rkyv 同步失效
- 实现：SDF rkyv 文件名也用 `{geo_hash}_sdf.rkyv`，与 convex 共用 hash 命名

### D6 · broad-phase AABB 是性能命脉

- 实测预期：80%+ 片元命中 AABB miss 提前返回，不进 narrow-phase
- 后端必须把每个房间的 world AABB 也返回（不只 hulls / sdf），让 shader 第一步剪枝

## 已验证的陷阱

- **`fitClipPlanesToBox` 与几何裁剪无关**：grep `clipPlane` 时唯一命中点。不要被名字误导。
- **`useRoomTree.isolate` 用 X-ray 实现**：被"隔离"的对象其实还在画面里（半透明），不是真隐藏。如果用户期待"硬隐藏"，需要做 `setObjectsVisible(false)` 而不是 setObjectsXRayed。本期裁剪也叠加在 X-ray 之上即可。
- **`useRoomTree.ts:25` 的 room ID 正则**：`^\d+_\d+(,\d+)?$` —— 子树扫描时如果碰到非这个格式的节点会跳过；新增 clip API 时房间 refno 必须符合这个格式。
- **`DTXMaterial` shader 已有 `vWorldPosition`**：直接拿来做裁剪判定，不需要在 shader 里重算。
- **`gl_FragDepth` 自定义路径**：DTX 走对数深度缓冲 + per-object depth bias（`vDepthBias = float(objectIndex & 7u) * 1.5e-7`）。裁剪 `discard` 不影响这个，但要确保 `discard` 在 `gl_FragDepth` 写入之前。
- **DTX double-side 渲染**：`material.side = 2`，背面也会跑 fragment。裁剪判定对正反面一致，没问题。

## 待澄清

| 问题 | 状态 |
|---|---|
| 房间 panel mesh 是否始终在世界坐标？ | 待确认 |
| 弧面房间在你们当前项目占比？ | 待用户回答 |
| bake SDF 是否能放进 `rebuild_room_relations` 异步阶段？ | 待用户确认时机 |
| toggle UI 位置：RoomStatusPanel 头部 vs RoomTree 节点右键？ | 待产品对齐 |
| 多房间同时裁剪时上限：64 房间够吗？ | 待业务场景反馈 |

## 关键代码锚点速查

```
后端：
  plant-model-gen/src/fast_model/convex_decomp.rs:91          ConvexRuntime / ConvexHullRuntime
  plant-model-gen/src/fast_model/convex_decomp.rs:166         load_or_build_convex_runtime
  plant-model-gen/src/fast_model/convex_decomp.rs:602         component_overlaps_room
  plant-model-gen/src/fast_model/room_model.rs:1822           RoomComputeOptions
  plant-model-gen/src/fast_model/room_model.rs:2091           build_room_relations
  plant-model-gen/src/web_server/room_api.rs:1771             create_room_api_routes
  plant-model-gen/src/web_api/room_tree_api.rs                room tree HTTP

前端：
  plant3d-web/src/utils/three/dtx/DTXLayer.ts:164             DTXLayer class
  plant3d-web/src/utils/three/dtx/DTXMaterial.ts:333          DTXMaterial class（v11）
  plant3d-web/src/utils/three/dtx/DTXPickingMaterial.ts:177   DTXPickingMaterial class（v4）
  plant3d-web/src/viewer/dtx/DtxCompatViewer.ts               viewer 入口
  plant3d-web/src/composables/useRoomTree.ts:29               useRoomTree
  plant3d-web/src/composables/useSceneGraph.ts:36             useSceneGraphOps
  plant3d-web/src/api/genModelRoomTreeApi.ts                  room-tree API client
  plant3d-web/src/api/genModelRoomComputeApi.ts               room-compute API client
```
