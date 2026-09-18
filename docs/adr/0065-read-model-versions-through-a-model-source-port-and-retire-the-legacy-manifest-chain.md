---
status: proposed
date: 2026-09-18
depends_on: ADR-0045, ADR-0047
---

# 版本对比经模型来源端口取「模型版本」，legacy 的不可变 manifest 链随开关退役

版本对比（最小交付单元 A/B）今天整条取数链钉在 legacy `:3100` 上——`/api/model/units/{refno}/versions` 给版本表、两份不可变 parquet manifest 给几何、`fetchLatestDbnoManifest` 给环境；而 legacy 开关只保留一个发布周期。我们决定：给模型来源端口加第七个接口 `ModelVersionSource`（`listVersions` / `loadVersion`），面板与 ViewerPanel 只认它；`gen-model-v1` 适配器用 gen-model-refactor 新增的 `GET /api/v1/model/versions`（按会话链算，见该仓 ADR-081）取版本表、用已有的 `model/history/generate | query` 取 A/B 几何（两侧一律走历史投影，B 是最新也不例外），差异仍在前端按 `geo_hash + geo_index + matrix` 签名算；最新环境模型改为「打开对比时视口里已加载的该 dbnum 模型」冻住，不再整库加载。同时废掉另外两套并存的实现（release diff 面板、spec 004 版本时间线）——它们依赖的 `/api/model-version/*` 在任何后端源码里都不存在。ADR 0045 中「单元根限 BRAN / HANG / EQUI / WALL / FLOOR」那份清单作废：哪些类型算最小交付单元以后端项目配置为唯一口径，前端不再持类型表。

## Considered Options

- **后端算 diff**（`plan_update(A→B)` 限在单元）：变更检测只剩一套，但要新接口，赶不上 legacy 退役周期；对比展示的真值本就是「画出来的几何变了没变」，前端签名法够用。留作以后的可选项，不是前提。
- **B 侧直接用生产投影**：生产投影停在 `model_sesno`，常落后于文件最新，「最新」未必等于 B；两侧同源才对称。
- **给 `tree/*` 加 `sesno` 做全库版本树**：这条功能是单元尺度的，全库版本树是另一件事；单元子树在某 sesno 的结构从 `history/query tool=snapshot` 取。
- **续做 spec 004 / 找回 release API**：ADR 0045 已选 sesno 弃 release，release 路由在所有后端源码中都不存在。

## Consequences

- 历史投影不落库、重启即丢、单次 ≤ 100 000 元素 / 300 s：前端遇 404 自动重生一次，退出对比时 `DELETE` 快照。
- 删掉 release diff、版本时间线与 `IncrementalUpdatePanel` 的对比派发后，树内差异的事件通道会失去全部派发方；由单元版本对比面板补上唯一一条派发，事件改名 `plant3d:model-version-tree-diff`。
- 执行清单见 `docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md`。
