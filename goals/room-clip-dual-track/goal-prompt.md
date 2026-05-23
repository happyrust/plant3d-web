# Goal Prompt · DTX 房间凸壳裁剪

> 给后续 agent 用：拿到本目录后第一时间执行的引导 prompt。

---

## 目标

实现 plant3d-web 的「按房间边界精准切断管道直段」渲染特性，采用「双轨架构」：

- 规则房间（立方体 / 多面体）→ **plane 集合 shader 裁剪**
- 不规则房间（弧面 / 球罐 / 自由曲面）→ **SDF 距离场 shader 裁剪**

详细：见 `brief.md` 和 `plan.md`。

## 启动步骤

1. **先读 brief.md**（5 分钟）：搞清 Outcome / Constraints / Non-Goals / Ask Before / Done Means。
2. **再读 findings.md**（10 分钟）：搞清现有架构、关键代码锚点、已知陷阱、已沉淀的技术决策。
3. **再读 plan.md**（10 分钟）：搞清 Phase 拆分、每个 task 的范围、PR 拆分建议。
4. **看 assets/ 的三张图**（5 分钟）：建立视觉直觉。
5. **决定当前要执行哪个 Phase 的哪个 task**，写进 `progress.jsonl` 一条 `"start": "<task_id>"`。
6. 开始动手。

## 关键提示

- **shader 改造一定要升 cacheKey**（`DTXMaterial_v11 → v12`、`DTXPickingMaterial_v4 → v5`），否则 three.js 会复用旧 program 导致新代码不生效。这是项目历史踩过的坑。
- **DTXPickingMaterial 必须同步改**（不要只改 main shader），否则被裁的片元仍可点中，语义错乱。
- **CLI + curl 验证优先**：参考 `AGENTS.md`，针对后端用 `cargo run` 启动 web_server 然后 `curl` 测试 API；不要新增 `#[cfg(test)]` 端到端测试。
- **不要 `cargo clean`** / **不要 `cargo test`**（仓库 AGENTS.md 强制要求）；用 `cargo check -p plant_model_gen` 验证可编译。
- **分类阈值** 必须可通过环境变量覆盖，便于线上调参（见 `findings.md` D3）。
- **失效检测复用 `geo_hash`**：SDF rkyv 文件名也用 `{geo_hash}_sdf.rkyv` 与 convex 共享 hash 命名（见 `findings.md` D5）。

## 进度跟踪

每完成一个 task：
- 写一条 `progress.jsonl`（一行 JSON，含 `timestamp`、`phase`、`task`、`status`、`commit`、`notes`）
- 必要时把验证证据（截图、curl 输出）放进 `verification.md`
- 阻塞先记录在 `blockers.md`，不要带病推进

## 截止标准

`brief.md` 的 "Done Means" 全部满足后，把本目录 archive 到 `goals/_done/`，并把核心结论搬到：

- 团队级架构文档：`开发文档/三维校审/2026-XX-DTX房间凸壳裁剪.md`
- 项目级 README 或 CLAUDE.md（指向新文档）

## Ask Before（必须先问用户的事项）

详见 `brief.md` 的 Ask Before 章节。摘要：

- 分类器误判某类常见房间 → 先评估
- panel mesh 世界坐标 vs 局部坐标口径异常 → 先确认
- SDF bake 总耗时 > rebuild_room_relations 5 倍 → 先讨论
- `sampler2DArray` 浏览器兼容问题 → 先讨论降级
- 与 X-ray / 选中高亮 fragment pass 冲突 → 先记 findings
- UI toggle 位置 → 先和产品对齐
