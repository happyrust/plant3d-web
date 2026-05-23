# Plan · DTX 房间凸壳裁剪 · 双轨架构

> 阶段化拆分，每个 Phase 是一个可独立验收的里程碑；每个 Phase 内拆 PR-able task。
>
> 总览图：`assets/dtx-room-clip-dual-track-arch.png`、`assets/dtx-room-clip-shader-data-flow.png`
>
> trait 化数据源设计：`data-source-design.md`

---

## Phase 0.5 · trait 化数据源 + JSON fixture（基础设施）

**目标**：把"房间裁剪"算法层与数据源完全解耦。所有 P1-P3 的算法都通过 `RoomClipDataSource` trait 拿数据；fixture 让 CI / 离线环境也能跑同一份算法。设计风格 1:1 对齐 `plant-mbd` 的 `BranchDataSource` 模式。详细设计见 `data-source-design.md`。

| # | Task | 文件 | 工期 |
|---|---|---|---|
| 0.5.1 | 建模块骨架 `plant-model-gen/src/fast_model/room_clip/{mod,model,data_source,error}.rs` | 同名文件（新增） | 0.5d |
| 0.5.2 | `RoomClipDataSource` trait + `ClipDataError` | `data_source.rs` / `error.rs` | 0.5d |
| 0.5.3 | `MockRoomClipDataSource`（cube / l-shape / cylinder / sphere / freeform 5 个变体） | `mock.rs`（新增） | 1.5d |
| 0.5.4 | `JsonFixtureRoomClipDataSource` + serde schema | `fixture.rs`（新增） | 1d |
| 0.5.5 | 5 个 JSON fixture | `plant-model-gen/tests/fixtures/room-clip/*.json` | 1d |
| 0.5.6 | `SurrealRoomClipDataSource`（feature-gated 编译通过，不强求跑通） | `surreal.rs`（新增） + `Cargo.toml` feature | 1d |
| 0.5.7 | CLI 入口 `room_clip_cli` 含 `classify` / `extract-planes` / `bake-sdf` / `diff` 子命令骨架 | `plant-model-gen/src/bin/room_clip_cli.rs`（新增） | 1d |
| 0.5.8 | 导出工具 `export_room_clip_fixture`（从 surreal 抓样本→JSON） | `plant-model-gen/src/bin/export_room_clip_fixture.rs`（新增） | 1d |

**验收**：
- `cargo check -p plant_model_gen` 通过；
- `cargo check -p plant_model_gen --features surreal-clip` 通过；
- `cargo run --bin room_clip_cli -- summary --source mock` 列出 5 个 mock 变体；
- `cargo run --bin room_clip_cli -- classify --source mock --variant cube` 输出（待 P2 实装才会真正分类，本期只是 trait + Mock 跑通）。

**总工期**：~7.5 工作日

---

## Phase 1 · 单凸壳 shader 通路（最小可行）

**目标**：让单个立方体房间能在 shader 端通过 6 plane 实现"按边界裁剪显示"。先打通整条 pipe，不区分模式。

| # | Task | 文件 | 工期 |
|---|---|---|---|
| 1.1 | 后端 `extract_world_planes(hull, mat) → Vec<[f32;4]>` 辅助函数 | `plant-model-gen/src/fast_model/convex_decomp.rs` | 0.5d |
| 1.2 | 后端 API `GET /api/room/clip-config?ids=...`（暂只支持 CONVEX_HULLS 模式） | `plant-model-gen/src/web_server/room_api.rs` + `room_clip_api.rs`（新增） | 1d |
| 1.3 | 前端 API client `genModelRoomClipApi.ts` | `plant3d-web/src/api/genModelRoomClipApi.ts`（新增） | 0.5d |
| 1.4 | 前端 `DTXClipController`（仅 planes 路径） | `plant3d-web/src/utils/three/dtx/DTXClipController.ts`（新增） | 1.5d |
| 1.5 | `DTXMaterial` fragment shader 改造（加 `isInsideClipHulls()`，升 v12） | `DTXMaterial.ts` | 1d |
| 1.6 | `DTXPickingMaterial` 同步改造（升 v5） | `DTXPickingMaterial.ts` | 0.5d |
| 1.7 | `DTXLayer` 暴露 `getClipController()`、`DtxCompatViewer.setRoomClip()` | `DTXLayer.ts`、`DtxCompatViewer.ts` | 0.5d |
| 1.8 | `useRoomTree` 加 `clipByRoom(id)` / `clearClip()` | `useRoomTree.ts` | 0.5d |
| 1.9 | `RoomStatusPanelDock.vue` 右键 / 头部 toggle UI | 同名文件 | 0.5d |

**验收**：
- 选一个立方体房间 → 点"按边界裁剪" → 跨界 CYLI 在房间壁正好切断；
- 点击被裁掉的 CYLI 区域，picking 不应命中（验证 picking shader 同步）；
- toggle 关闭后管道完整恢复。

**总工期**：~6 工作日

---

## Phase 2 · 分类器 + AABB 模式

**目标**：把"立方体房间"识别出来，走最便宜的 6 plane 路径；普通多面体走 P1 的 hulls 路径。前端 UI 不变，后端透明分派。

| # | Task | 文件 | 工期 |
|---|---|---|---|
| 2.1 | `classify_room()` 实现（fill_ratio + normal_diversity + hull_count） | `plant-model-gen/src/fast_model/room_clip_classifier.rs`（新增） | 1d |
| 2.2 | `signed_volume(mesh)` + `compute_normal_diversity()` 辅助 | 同上 | 0.5d |
| 2.3 | API 升级：返回 `{ mode: "aabb" | "convex_hulls", ... }` | `room_clip_api.rs` | 0.5d |
| 2.4 | DB schema：`room_clip_mode` 表（mode + geo_hash + built_at） | `plant-model-gen/src/sqlite_index.rs` 或新表 | 1d |
| 2.5 | `classify_room` 集成进 `build_room_relations` 完成阶段 | `room_model.rs` | 0.5d |
| 2.6 | 前端 `DTXClipController.normalizeToPlanes` 把 AABB 模式展开为 6 plane | `DTXClipController.ts` | 0.5d |
| 2.7 | 阈值环境变量化（5 个） | `convex_decomp.rs` / `room_clip_classifier.rs` | 0.5d |

**验收**：
- 立方体房间 API 返回 `mode=aabb` + 6 plane（不是 hull 集合）；
- L 型 / 切角房间 API 返回 `mode=convex_hulls` + 多 hull；
- shader 表现完全等价于 P1（透明升级）；
- 用 curl + jq 验证 mode 分类符合预期。

**总工期**：~4 工作日

---

## Phase 3 · SDF 烘焙后端

**目标**：让弧面 / 球面 / 自由曲面房间能产 SDF 数据。本阶段只做后端 bake + 落盘，不动 shader。

| # | Task | 文件 | 工期 |
|---|---|---|---|
| 3.1 | 引入 `mesh_to_sdf` crate（或基于 parry3d `project_point` 自实现） | `Cargo.toml` + `plant-model-gen/Cargo.toml` | 0.5d |
| 3.2 | `bake_room_sdf(refno, panel_meshes, resolution) → RoomSdfFileV1` | `plant-model-gen/src/fast_model/room_sdf.rs`（新增） | 1.5d |
| 3.3 | `RoomSdfFileV1` rkyv 序列化 + 落盘 `{base}/sdf/{geo_hash}_sdf.rkyv` | 同上 | 0.5d |
| 3.4 | `pick_resolution(aabb_size, voxel_size)` 自适应 | 同上 | 0.5d |
| 3.5 | `build_room_clip_artifacts` 调度 stage（仅对 mode=SDF 的房间 bake） | `room_model.rs` 或新调度模块 | 1d |
| 3.6 | API `GET /api/room/sdf/{hash}` 返回 binary stream（`application/octet-stream`） | `room_clip_api.rs` | 0.5d |
| 3.7 | API `/clip-config` 支持 `mode=sdf` 输出 `{ resolution, sdf_url, aabb }` | `room_clip_api.rs` | 0.5d |
| 3.8 | 单元 CLI 工具：`cargo run --bin room_sdf_inspect -- --refno X`（dump 一个 z-slice 为 PNG 灰度图，肉眼验证） | `plant-model-gen/src/bin/` | 1d |

**验收**：
- 给定一个球罐房间，bake 完成 < 30s（128³）；
- CLI 输出 z-slice PNG，肉眼看起来是合理的距离场（边界处一圈渐变）；
- `sdf/{hash}.rkyv` 大小符合预期（128³ × 2 byte ≈ 4 MB）；
- 失效检测：手动修改房间 mesh → geo_hash 变化 → 重新 bake。

**总工期**：~5.5 工作日

---

## Phase 4 · SDF shader 通路

**目标**：DTXMaterial / DTXPickingMaterial 加 SDF 分支，前端能拉 binary + 上传到 `sampler2DArray`。

| # | Task | 文件 | 工期 |
|---|---|---|---|
| 4.1 | 前端 `DTXClipController.uploadSdfTextures(rooms)` | `DTXClipController.ts` | 1.5d |
| 4.2 | `fetch sdf_url + ArrayBuffer → DataTexture sampler2DArray R16F` | 同上 | 1d |
| 4.3 | `DTXMaterial` shader 加 `insideRoomSDF(i, p)` + mode 分派（升 v13） | `DTXMaterial.ts` | 1d |
| 4.4 | `DTXPickingMaterial` 同步加 SDF 分支（升 v6） | `DTXPickingMaterial.ts` | 0.5d |
| 4.5 | broad-phase AABB 剪枝写入 shader（所有模式通用） | `DTXMaterial.ts` | 0.5d |
| 4.6 | LRU 卸载：超过 32 房间时丢弃最久未用的 layer | `DTXClipController.ts` | 1d |
| 4.7 | `?clipDebugForceMode=sdf|hulls|aabb` URL 调试开关 | `useRoomTree.ts` | 0.5d |

**验收**：
- 球罐房间裁剪显示，曲面处没有"折面感"；
- 切到立方体房间又能秒切回 plane 模式；
- LRU 触发时不卡顿（DataTexture replace 不阻塞）；
- 强制模式覆盖能用，方便 debug 对比。

**总工期**：~6 工作日

---

## Phase 5 · 性能压测 + 兼容性 + 文档

| # | Task | 工期 |
|---|---|---|
| 5.1 | 5 类房间端到端验证（立方体 / L 型 / 圆柱罐 / 球罐 / 自由曲面） | 1d |
| 5.2 | FPS 对比测试（裁剪开/关）：选 3 种典型场景 | 0.5d |
| 5.3 | 不同 GPU 兼容性测试（Mac Intel HD / Windows NVIDIA / Linux Mesa） | 1d |
| 5.4 | `开发文档/三维校审/2026-XX-DTX房间凸壳裁剪.md` 撰写（含三张图） | 1d |
| 5.5 | E2E test：`e2e/room-clip-cdp.spec.ts` 用 CDP 验证渲染 + 截图差异 | 1d |

**验收**：
- `verification.md` 有完整命令 / 截图 / 性能数据；
- 所有目标浏览器/GPU 组合通过；
- 文档可作为团队知识库长期资产。

**总工期**：~4.5 工作日

---

## 总览

| Phase | 工期 | 风险 |
|---|---|---|
| P0.5 trait + fixture | 7.5d | 模块结构与 plant-mbd 不对齐 → review 拒绝 |
| P1 单凸壳通路 | 6d | shader cacheKey 漏升级 → 静默不生效 |
| P2 分类器 + AABB | 4d | normal_diversity 阈值需要真实数据调优 |
| P3 SDF 后端 | 5.5d | mesh_to_sdf 性能 / parry3d project_point 精度 |
| P4 SDF shader 通路 | 6d | sampler2DArray 驱动兼容性、binary 加载阻塞 |
| P5 验证 + 文档 | 4.5d | E2E 截图比较稳定性 |
| **合计** | **~33.5d** | 单人，7-8 周 calendar time（含会议、code review） |

并行机会：
- P0.5 后端 + P1 前端 shader 改造可并行（P1 前端可先用 hardcode plane 数据 mock）
- P1 + P2 后端可与 P3 后端并行
- P4 前端必须等 P3 后端完成

---

## PR 拆分建议

P0.5 拆 2 PR：
- PR-1：trait + model + Mock + 5 fixture（编译通过，CLI summary 跑通）
- PR-2：SurrealRoomClipDataSource（feature-gated）+ export_room_clip_fixture CLI

P1 拆 3 PR：
- PR-1：后端 plane 提取 + API 雏形（无前端调用）
- PR-2：前端 DTXClipController + shader 改造（mock 后端数据）
- PR-3：联调 + UI toggle

P2 单 PR（分类器内聚）

P3 拆 2 PR：
- PR-1：mesh_to_sdf 集成 + bake 函数 + CLI inspect 工具
- PR-2：调度集成 + API 输出

P4 拆 2 PR：
- PR-1：DTXClipController 加 SDF 上传路径
- PR-2：shader 加 SDF 分支 + 模式分派

P5 单 PR + 文档 commit
