# 阶段 1 · 共享网格目录并发写安全性（任务 2.4）

- 日期：2026-10-29
- 结论：**安全**。实时历史几何路径**不加**按 `mesh_id` 的细粒度锁，也不拿每库 `db_generation_lock`。
- 依据工作树：`gen-model-timeline-scrub` @ `feat/version-time-resolve-cases`（`d82cd90ce` + 未提交改动），`vendor/e3d-model` `main` @ `f1f98b8`
- 代码位置：`src/fast_model/e3d_mesh_store.rs`、`src/fast_model/e3d_model_service.rs`

## 两个问题

### 问题一：写入是否「临时文件 + 原子重命名」

是，而且比单纯的 rename 更强。链路（`src/fast_model/e3d_mesh_store.rs:114-152`）：

1. **目标已存在** → 直接 `verify_mesh_file` 比对；一致返回 `MeshWrite::Reused`，不一致走 `repair_mesh_file`（`:192-222`）。
2. **目标不存在** → `create_dir_all(parent)` 后 `stage_mesh_file`（`:155-188`）在**同一个目录**里写 `.{file_name}.{pid}.{seq}.tmp`，顺序是 `PlantMesh::ser_to_file` → `verify_mesh_file`（读回逐位比对）→ `File::sync_all`。任何一步失败都删掉临时文件返回错误，目标名始终没有被碰过。
3. **发布**用 `std::fs::hard_link(&temp, path)`（`:126`）：同目录硬链接是原子的 create-if-absent，**不会顶掉并发胜者**。源码注释点明这是 Windows 特意绕开的坑——Windows 的 `rename` 会覆盖已有目标，不能当 create-if-absent 用。
4. 链接成功 → 删掉私有临时名，`#[cfg(unix)]` 再 `sync_all` 父目录（POSIX 下文件 fsync 不覆盖目录项）。
5. 链接失败但 `path.exists()` → 判定「别的写者抢先发布」：删临时文件，对既有文件重做 `verify_mesh_file`，一致就是 `Reused`，不一致转 `repair_mesh_file`。
6. `repair_mesh_file` 用**进程内全局 `static REPAIRS: Mutex<()>`** 串行化（`:203-206`），加锁后先复核一次（可能前一个已经修好），再 `stage` + `std::fs::rename` 原子替换，最后读回校验。

所以不存在「半个文件被读到」的窗口：读者要么看到旧文件，要么看到完整新文件。

### 问题二：同一 `mesh_id` 的内容是否相同

是，`mesh_id` 是内容寻址，两条产出路径都拿内容做摘要（`e3d_mesh_store.rs:81-99`）：

| 函数 | 摘要输入 | 用途 |
|---|---|---|
| `baked_mesh_id` | `BAKED_MESH_DOMAIN` + `TESSELLATION_POLICY_VERSION` + 顶点/法线/索引全部字节（`update_mesh_digest`，`:224-238`）的 SHA-256 | 非标准图元（`local_generated_mesh`） |
| `canonical_mesh_id` | `PrimitiveMeshKey` 的 JSON + 同一份 mesh 字节摘要，取前 8 字节转 `u64`，`.max(1)` 转十进制 | 标准图元（`canonical_primitive_mesh`） |

`bake_element`（`e3d_model_service.rs:3989-4052`）按 `primitive_instance` 是否为空二选一，两条都走 `ensure_mesh_file`。同 id 即同内容，所以「同 id 不同内容」在正常情况下不可能出现；即便出现（见下方残余风险），`ensure_mesh_file` 的复核分支也会把它修成与**本次**内容一致，而不是留下半截文件。

## 对实时路径的意义

`project_historical_records`（`e3d_model_service.rs:4576-4596`）→ `bake_element` → `ensure_mesh_file`，与当前模型生成走的是同一段写盘代码。实时路径不加每库锁（`realtime_compute_source`，`:3026-3043`，不取 `db_generation_lock`）时：

- 与生成并发写**同一个** `mesh_id`：一方 hard_link 成功，另一方 hard_link 失败 → 复核 → `Reused`。两份内容相同，读回校验通过。
- 与生成并发写**不同** `mesh_id`：文件名不同，互不干扰。
- 与 `repair_mesh_file` 并发：全局 `REPAIRS` 互斥，且加锁后复核，后到者看到已修好的文件即返回 `Reused`。

## 残余风险（不构成本特性新增风险）

1. `canonical_mesh_id` 只有 64 位，理论上存在碰撞；碰撞时后到者会触发 `repair` 把文件改成自己的内容。这是当前模型生成路径**既有**的契约（同 8 字节前缀即同身份），实时路径沿用同一函数，不引入新的碰撞面。
2. 跨进程（多个后端实例共享同一 `mesh_dir`）时 `REPAIRS` 只在进程内互斥。多实例部署下仍靠 hard_link 的 create-if-absent 语义兜底：输的一方复核后 `Reused` 或 `Repair`，最终内容仍与 id 一致。本阶段只跑单实例（rocksdb 档 8022），不涉及。
3. 实时查询被取消时，已经写下的网格文件是内容寻址的孤儿，无害，等可达性 GC（`e3d_model_service.rs:3978-3984` 已写明这是内容寻址契约而非新风险）。

## 验收动作

- 读代码即可确认，无需新增测试；并发与修复语义已有既有用例钉住（`e3d_mesh_store.rs` 的 `mod tests`）：
  - `:404` `concurrent_publish_writes_once_and_every_writer_verifies_the_winner`
  - `:447` `a_damaged_content_addressed_file_is_rewritten_in_place`
  - `:482` `concurrent_repairs_rewrite_once_and_nobody_fails`
  - `:359` `baked_id_covers_vertices_normals_and_indices_exactly`、`:379` `a_baked_mesh_must_still_hash_to_its_own_id`
- `tasks.md` 的 2.4 勾 `[x]`，并把 `[~]` 改掉。
- W1 实现 `query_realtime` 时**不加**网格锁。
