# Data Source Design · trait 化数据源 + JSON fixture

> 把"房间裁剪"的算法层（classify / extract planes / bake SDF）与数据源完全解耦。
> 算法只看 trait，不关心数据来自 SurrealDB、JSON fixture、还是内存 Mock。
>
> 设计风格 1:1 对齐 `plant-mbd` 已落地的 `BranchDataSource` + `MockBranchDataSource` + `JsonFixtureDataSource` + `SurrealBranchDataSource` 边界（详见 `plant-mbd/docs/SurrealBranchDataSource边界设计.md`、`rs-core/MBD/docs/BRAN管道标注算法-trait骨架与文件规划.md`）。

---

## 1. 设计动机

| 问题 | 解决 |
|---|---|
| Phase 3 的 SDF bake 算法需要拿到房间 `panel_meshes` + `geo_hash` + 实例集合，传统做法是直接调 SurrealQL；新手 / 离线 / CI 环境很难复现 | trait 接口 + JSON fixture，无 DB 也能跑 |
| 真实工程数据库的房间样本（弧面 / 异形）少且敏感，不能进 CI | 抽样导出小 fixture，可控复现 |
| 后续 plant-model-gen 想换数据源（如改用 sqlite_index 直接读、或加 Redis 缓存层） | 算法不需要改 |
| Phase 5 验证需要"对同一个房间在 mock vs surreal 两路输出做 diff" | 用同一份算法 + 切换数据源 |

**不变式**（沿用 plant-mbd 设计原则）：

1. 算法 crate（`plant-model-gen` 的 `fast_model::room_clip_*`）**不引用** SurrealDB client、连接池、认证配置。
2. 数据源 adapter 把数据库记录映射为中性 domain 模型（`RoomPanelMesh`、`RoomConvexHull`、`PipeInstanceSnapshot`），与 SurrealDB schema 解耦。
3. 缺失可选数据返回空 vec 或 `ClipDataError::NotFound`，不要用零 mesh / 空 hull 兜底。
4. 缺失必需几何返回明确错误（`ClipDataError::MissingGeometry`），不用静默 fallback。
5. 批量接口必须由真实后端单独实现（避免 N+1 查询）；默认实现可以逐个调用，但 SurrealRoomClipDataSource 必须 override。

---

## 2. 中性 Domain 模型

文件：`plant-model-gen/src/fast_model/room_clip/model.rs`（新增）

```rust
use glam::{Mat4, Vec3};
use parry3d::bounding_volume::Aabb;
use smol_str::SmolStr;

pub type RoomRefno = SmolStr;       // 例如 "12345_1"
pub type InstRefno = SmolStr;       // 例如 "67890_5"
pub type GeoHash = SmolStr;

/// 房间一个 panel 网格（已转到世界坐标）。
#[derive(Debug, Clone)]
pub struct RoomPanelMesh {
    pub vertices: Vec<[f32; 3]>,
    pub indices: Vec<u32>,           // 三角面 flat
    pub world_aabb: Aabb,
}

/// 房间一个凸壳（已转到世界坐标）。
#[derive(Debug, Clone)]
pub struct RoomConvexHull {
    pub vertices: Vec<[f32; 3]>,
    pub world_aabb: Aabb,
}

/// 房间快照：mesh + 凸壳 + 整体 AABB + 关键标识。
#[derive(Debug, Clone)]
pub struct RoomSnapshot {
    pub room_refno: RoomRefno,
    pub panel_geo_hash: GeoHash,
    pub world_aabb: Aabb,
    pub panel_meshes: Vec<RoomPanelMesh>,
    pub convex_hulls: Vec<RoomConvexHull>,
}

/// 房间内的构件实例快照（仅与裁剪相关的字段）。
#[derive(Debug, Clone)]
pub struct PipeInstanceSnapshot {
    pub inst_refno: InstRefno,
    pub noun: SmolStr,               // "CYLI" / "TUBI" / "ELBO" / ...
    pub geo_hash: GeoHash,
    pub world_transform: Mat4,       // local geo → world
}

/// 端到端裁剪需要的最小信息打包。
#[derive(Debug, Clone)]
pub struct RoomClipBundle {
    pub room: RoomSnapshot,
    pub pipe_instances: Vec<PipeInstanceSnapshot>,
}
```

---

## 3. Trait 接口

文件：`plant-model-gen/src/fast_model/room_clip/data_source.rs`（新增）

```rust
use anyhow::Result;
use async_trait::async_trait;
use thiserror::Error;
use super::model::*;

#[derive(Debug, Error)]
pub enum ClipDataError {
    #[error("room not found: {0}")]
    NotFound(RoomRefno),
    #[error("missing geometry: {what} on {room}")]
    MissingGeometry { what: String, room: RoomRefno },
    #[error("backend: {0}")]
    Backend(String),
}

#[async_trait]
pub trait RoomClipDataSource: Send + Sync {
    /// 房间几何快照（mesh + 凸壳 + AABB + geo_hash）。
    async fn room_snapshot(&self, refno: &RoomRefno) -> Result<RoomSnapshot, ClipDataError>;
    
    /// 房间内所有管道实例（用于知道"哪些 instance 受裁剪影响"）。
    /// 默认实现可以返回空（裁剪是 shader 端 per-fragment，不一定需要 instance 列表）。
    async fn pipe_instances_in_room(
        &self,
        refno: &RoomRefno,
    ) -> Result<Vec<PipeInstanceSnapshot>, ClipDataError> {
        Ok(Vec::new())
    }
    
    /// 一次拿一组房间的 snapshot（批量接口，避免 N+1）。
    /// 真实后端必须 override 走批量 SurrealQL。
    async fn room_snapshots(
        &self,
        refnos: &[RoomRefno],
    ) -> Result<Vec<RoomSnapshot>, ClipDataError> {
        let mut out = Vec::with_capacity(refnos.len());
        for r in refnos {
            out.push(self.room_snapshot(r).await?);
        }
        Ok(out)
    }
    
    /// 一次拿一组房间 + 各自实例（端到端 bundle）。
    async fn room_clip_bundles(
        &self,
        refnos: &[RoomRefno],
    ) -> Result<Vec<RoomClipBundle>, ClipDataError> {
        let snapshots = self.room_snapshots(refnos).await?;
        let mut out = Vec::with_capacity(snapshots.len());
        for snapshot in snapshots {
            let pipe_instances = self.pipe_instances_in_room(&snapshot.room_refno).await?;
            out.push(RoomClipBundle { room: snapshot, pipe_instances });
        }
        Ok(out)
    }
}
```

---

## 4. 三种实现

### 4.1 `MockRoomClipDataSource`

文件：`plant-model-gen/src/fast_model/room_clip/mock.rs`（新增）

**用途**：单元 CLI 验证、教学示例、教学验收。完全无 I/O。

```rust
pub struct MockRoomClipDataSource {
    snapshots: std::collections::HashMap<RoomRefno, RoomSnapshot>,
    instances: std::collections::HashMap<RoomRefno, Vec<PipeInstanceSnapshot>>,
}

impl MockRoomClipDataSource {
    /// 立方体 10x5x3 + 一根穿过的 CYLI。
    pub fn cube_with_pipe() -> Self { /* … */ }
    
    /// L 型房间：两个长方体拼接。
    pub fn l_shape() -> Self { /* … */ }
    
    /// 球罐房间：球面 mesh + 凸分解。
    pub fn sphere_tank() -> Self { /* … */ }
    
    /// 圆柱罐区房间。
    pub fn cylinder_tank() -> Self { /* … */ }
    
    /// 任意自定义。
    pub fn builder() -> MockRoomClipDataSourceBuilder { /* … */ }
}

#[async_trait]
impl RoomClipDataSource for MockRoomClipDataSource {
    async fn room_snapshot(&self, refno: &RoomRefno) -> Result<RoomSnapshot, ClipDataError> {
        self.snapshots.get(refno).cloned()
            .ok_or_else(|| ClipDataError::NotFound(refno.clone()))
    }
    // …
}
```

### 4.2 `JsonFixtureRoomClipDataSource`

文件：`plant-model-gen/src/fast_model/room_clip/fixture.rs`（新增）

**用途**：CI 可复现、从真实库导出小样本后离线验证。

JSON schema（`tests/fixtures/room-clip/*.json`）：

```json
{
  "room_refno": "12345_1",
  "panel_geo_hash": "a1b2c3d4...",
  "world_aabb": {
    "min": [0.0, 0.0, 0.0],
    "max": [10.0, 5.0, 3.0]
  },
  "panel_meshes": [
    {
      "vertices": [[0,0,0], [10,0,0], [10,5,0], ...],
      "indices": [0, 1, 2, 0, 2, 3, ...]
    }
  ],
  "convex_hulls": [
    {
      "vertices": [[0,0,0], [10,0,0], [10,5,0], [0,5,0], [0,0,3], ...]
    }
  ],
  "pipe_instances": [
    {
      "inst_refno": "67890_5",
      "noun": "CYLI",
      "geo_hash": "abc123",
      "world_transform": [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        -2.0, 2.5, 1.5, 1.0
      ]
    }
  ]
}
```

```rust
pub struct JsonFixtureRoomClipDataSource {
    rooms: HashMap<RoomRefno, RoomClipBundleJson>,
}

impl JsonFixtureRoomClipDataSource {
    pub fn load_from_dir(dir: &Path) -> Result<Self, std::io::Error> { /* … */ }
    pub fn load_single(path: &Path) -> Result<Self, std::io::Error> { /* … */ }
}
```

### 4.3 `SurrealRoomClipDataSource`

文件：**独立模块**（避免污染算法层），推荐落在 `plant-model-gen/src/fast_model/room_clip/surreal.rs` 内，但用 `cfg(feature = "surreal-clip")` 隔离 client 依赖。

复用现有 SurrealDB schema（无需新建表）：

| 数据需求 | SurrealDB 来源 |
|---|---|
| 房间 mesh | `pe` (room) + `geo_relate` → 取 panel mesh 文件路径 → 现有 `load_panel_meshes` |
| 凸分解 | 直接复用 `convex_decomp::load_or_build_convex_runtime` |
| world AABB | `inst_relate.aabb` 字段（已有） |
| panel geo_hash | `pe.geo_hash` |
| 房间内实例 | `inst_relate` 表查 `room_refno = $X` |
| 实例 transform | `inst_geo` 表 |

```rust
#[cfg(feature = "surreal-clip")]
pub struct SurrealRoomClipDataSource {
    db: Arc<surrealdb::Surreal<Any>>,
    mesh_dir: PathBuf,
}

#[cfg(feature = "surreal-clip")]
#[async_trait]
impl RoomClipDataSource for SurrealRoomClipDataSource {
    async fn room_snapshot(&self, refno: &RoomRefno) -> Result<RoomSnapshot, ClipDataError> {
        // 1. SQL：SELECT room mesh path, geo_hash, aabb FROM pe WHERE refno = $refno
        // 2. load panel meshes from disk
        // 3. load convex runtime via load_or_build_convex_runtime
        // 4. transform to world via inst transform
        // 5. assemble RoomSnapshot
        // …
    }
    
    async fn room_snapshots(&self, refnos: &[RoomRefno]) -> Result<Vec<RoomSnapshot>, ClipDataError> {
        // 一次 SQL IN 查询拿所有房间元数据
        // 然后批量并发 load mesh + convex
        // 避免 N+1
        // …
    }
    
    async fn pipe_instances_in_room(&self, refno: &RoomRefno) -> Result<Vec<PipeInstanceSnapshot>, ClipDataError> {
        // SELECT * FROM inst_relate WHERE room_refno = $refno AND owner_noun IN ['CYLI', 'TUBI', 'PIPE']
        // JOIN inst_geo ON ...
        // …
    }
}
```

---

## 5. 算法层只看 trait

文件：`plant-model-gen/src/fast_model/room_clip/classifier.rs`、`extractor.rs`、`baker.rs`

```rust
use super::data_source::RoomClipDataSource;
use super::model::*;

pub async fn classify_room_via_source(
    source: &dyn RoomClipDataSource,
    refno: &RoomRefno,
) -> Result<RoomClipMode, ClipDataError> {
    let snap = source.room_snapshot(refno).await?;
    Ok(classify_room_from_snapshot(&snap))
}

pub fn classify_room_from_snapshot(snap: &RoomSnapshot) -> RoomClipMode {
    // ↓ 纯函数，便于单元测试和 CLI 跑 fixture
    let fill_ratio = compute_fill_ratio(snap);
    let normal_div = compute_normal_diversity(&snap.panel_meshes);
    // ...
}

pub async fn extract_world_planes_via_source(
    source: &dyn RoomClipDataSource,
    refno: &RoomRefno,
) -> Result<Vec<HullPlanes>, ClipDataError> {
    let snap = source.room_snapshot(refno).await?;
    Ok(extract_world_planes_from_snapshot(&snap))
}

pub async fn bake_sdf_via_source(
    source: &dyn RoomClipDataSource,
    refno: &RoomRefno,
    resolution: [u32; 3],
) -> Result<RoomSdfFileV1, ClipDataError> {
    let snap = source.room_snapshot(refno).await?;
    Ok(bake_sdf_from_snapshot(&snap, resolution))
}
```

**关键设计**：每个算法都拆成两层：

- `*_from_snapshot()`：**纯函数**，纯 in-memory 输入输出，单元测试和 CLI 用
- `*_via_source()`：**异步**，通过 trait 拿数据再调纯函数

这样 fixture 测试只测纯函数，trait 接口只用于真实环境调度。

---

## 6. CLI 验证入口

新增 `plant-model-gen/src/bin/room_clip_cli.rs`（或在现有 cli_modes.rs 加 subcommand）：

```bash
# 用 mock 数据：
cargo run --bin room_clip_cli -- classify --source mock --variant cube
# → mode = AABB
cargo run --bin room_clip_cli -- classify --source mock --variant sphere-tank
# → mode = SDF
cargo run --bin room_clip_cli -- extract-planes --source mock --variant l-shape
# → JSON 输出 plane 集合

# 用 fixture：
cargo run --bin room_clip_cli -- classify --source fixture \
  --path tests/fixtures/room-clip/cube-room.json
cargo run --bin room_clip_cli -- bake-sdf --source fixture \
  --path tests/fixtures/room-clip/sphere-tank.json \
  --resolution 128,128,128 \
  --out /tmp/sphere.rkyv

# 用真实 SurrealDB（带 surreal-clip feature）：
cargo run --bin room_clip_cli --features surreal-clip -- classify --source surreal \
  --refno 12345_1 \
  --db-url surrealkv://...

# Diff：mock 和 surreal 同一房间结果比对
cargo run --bin room_clip_cli --features surreal-clip -- diff \
  --left mock:cube \
  --right surreal:12345_1
```

---

## 7. 从 SurrealDB 导出 fixture 工具

新增 `cargo run --bin export_room_clip_fixture`：

```bash
cargo run --bin export_room_clip_fixture --features surreal-clip -- \
  --refno 12345_1 \
  --db-url ... \
  --mesh-dir /path/to/mesh \
  --out tests/fixtures/room-clip/sphere-tank-real.json
```

让团队能从生产库抽样真实房间，转成 fixture 进 CI。

---

## 8. 包结构与编译边界

```
plant-model-gen/src/fast_model/room_clip/
├── mod.rs              # re-export
├── model.rs            # 中性 domain 模型
├── data_source.rs      # RoomClipDataSource trait
├── error.rs            # ClipDataError
├── mock.rs             # MockRoomClipDataSource
├── fixture.rs          # JsonFixtureRoomClipDataSource
├── surreal.rs          # SurrealRoomClipDataSource（cfg(feature = "surreal-clip")）
├── classifier.rs       # classify_room_*
├── extractor.rs        # extract_world_planes_*
├── baker.rs            # bake_sdf_*
└── api_payload.rs      # 把算法输出序列化为 HTTP API JSON 的格式

plant-model-gen/tests/fixtures/room-clip/
├── cube-room.json
├── l-shape-room.json
├── cylinder-tank.json
├── sphere-tank.json
└── free-form-building.json
```

**feature 标志**：

```toml
[features]
default = []
surreal-clip = ["dep:surrealdb"]  # 可选
```

`surreal.rs` 用 `#[cfg(feature = "surreal-clip")]` 包住，默认 build 不依赖 surrealdb client。

---

## 9. 与 plant-mbd 的设计映射

| plant-mbd（已落地） | plant-model-gen room_clip（新设计） |
|---|---|
| `BranchDataSource` trait | `RoomClipDataSource` trait |
| `MockBranchDataSource` | `MockRoomClipDataSource` |
| `JsonFixtureDataSource` | `JsonFixtureRoomClipDataSource` |
| `SurrealBranchDataSource`（独立 crate 推荐） | `SurrealRoomClipDataSource`（feature-gated 内嵌） |
| `BranchAnnotationPipeline` | `RoomClipPipeline`（可选，pipeline 可视为简单调度，本期不强求） |
| `BranFixture` schema | `RoomClipBundleJson` schema |
| `tests/fixtures/bran/*.json` | `tests/fixtures/room-clip/*.json` |
| `cargo run --example bran_cli -- summary` | `cargo run --bin room_clip_cli -- summary` |
| Phase 7.3 边界设计 | 本文件 |

差异点：

- **bran 是独立 crate**（`plant-mbd`），房间裁剪还在 `plant-model-gen` 内（因为强依赖现有 `convex_decomp` 和 `inst_relate` 表），所以 `surreal.rs` 走 feature flag 而非独立 crate。
- **bran 已经做 Phase 0 骨架** → 房间裁剪可以同样从骨架开始（P0.5）。

---

## 10. 验收口径

P0.5 完成的标准：

1. `cargo check -p plant_model_gen` 通过（trait + Mock + Fixture）。
2. `cargo run --bin room_clip_cli -- classify --source mock --variant cube` 输出 `mode=AABB`。
3. `cargo run --bin room_clip_cli -- classify --source mock --variant sphere-tank` 输出 `mode=SDF`。
4. `cargo run --bin room_clip_cli -- extract-planes --source fixture --path tests/fixtures/room-clip/l-shape-room.json` 输出合理的 plane 集合 JSON。
5. fixtures 至少有 5 个房间样本，覆盖 5 类形状（立方体 / L 型 / 圆柱罐 / 球罐 / 自由曲面）。
6. `SurrealRoomClipDataSource` feature 启用后 `cargo check --features surreal-clip` 通过（不强求实际跑通，留到 P1 联调）。

---

## 11. 与原 plan.md 的衔接

本设计作为 **Phase 0.5（基础设施）** 插入到 P1 之前：

- P0.5 完成后，P1 的 "extract_world_planes" 直接用 `extract_world_planes_from_snapshot()` 纯函数，避免 P1 又写一遍数据访问。
- P2 的 classifier 同样落到 `classify_room_from_snapshot()`。
- P3 的 SDF bake 同样落到 `bake_sdf_from_snapshot()`。
- P4 前端不需要关心数据源；它只消费后端 API。

带来的好处：

- P1-P3 的所有算法都能在 fixture 上跑（不需要起 SurrealDB）
- 团队成员可以"我只负责算法"或"我只负责 SurrealQL"分工
- CI 可以跑算法层的所有 unit test 而不需要 DB 容器
- 任何房间问题都能"导出 fixture → 提 issue → 复现 → 修复"

---

## 12. 风险

1. **`load_or_build_convex_runtime` 当前不是 trait 化的**：会被 SurrealRoomClipDataSource 内部调用，意味着这个 adapter 仍然依赖 `convex_decomp` 模块。这是 OK 的（convex_decomp 本身是工具函数，不是算法），但要记录。
2. **PipeInstanceSnapshot 的 `world_transform` 在 SurrealDB 里可能需要多表 join**：`inst_relate` + `inst_geo` + `pe`。SurrealRoomClipDataSource 需要把这个 join 做好，并放到批量接口里避免 N+1。
3. **Mock 的 `sphere_tank()` 需要程序生成 sphere mesh + 跑 miniacd 凸分解**：需要小心，miniacd 在测试环境可能不可用；建议 Mock 用"预生成的凸分解结果"硬编码进代码。
4. **fixture 文件大小**：sphere tank mesh 可能数百 KB JSON。考虑用 `tests/fixtures/room-clip/big/` 区分大 fixture，不进 git。
