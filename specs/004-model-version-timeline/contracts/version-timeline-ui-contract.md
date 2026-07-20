# Contract: 版本时间线 UI 与数据访问

## Purpose

定义版本时间线面板、模型树差异/快照模式、双版本对比、视口刻度条与 `modelVersionApi` 数据层之间的契约，供实现与测试共同遵守。

## API 客户端契约（新建 `src/api/modelVersionApi.ts`）

统一约定：

- **两个 API 家族的响应包装不同，MUST 分别处理**（事实来源：`model_version_api.rs:4458-4478` 与 `pe_att_history_api.rs:53-102`）：
  - `/api/model-version/*` → `{ success: boolean, message: string, data: T }`；`success === false` 视为业务失败，抛出携带 `message` 的错误。
  - `/api/model-history/*` → 成功 `{ ok: true, data: T }`；失败 `{ ok: false, error: { code, message } }`，`code` 取值 `Expired | AnchorMissing | QueryFailed | BadRequest`。
- 错误分类 MUST 可判别：`ExpiredError`（HTTP 410 / code `Expired`，snapshot 历史过期）、`AnchorMissingError`（HTTP 404 / code `AnchorMissing`，resolve-anchor 未命中）、其余为一般错误。调用方据此走降级分支（FR-019/020/033）。
- `listReleases` 返回的每条记录是 `ModelReleaseRecord` 的 serde flatten + 附加字段 `package_url / manifest_url / viewer_url / release_viewer_url`（`model_version_api.rs:498-505`），前端类型 MUST 容忍这些附加字段。
- 全部为只读 GET 封装；本 feature MUST NOT 新增任何后端写路径调用（FR-035）。

导出面：

| 函数 | 参数 | 返回要点 |
|---|---|---|
| `listReleases(project?)` | project 可选过滤 | `ModelReleaseRecord[]`（含 lifecycle/quality 双轴、branch_id、registered_at） |
| `getRelease(releaseId, project?)` | — | 单条 `ModelReleaseRecord` |
| `getReleaseEvents(releaseId)` | — | `{ release, events: [{release_status, reason, created_at}] }`，供版本卡片展开的事件流 |
| `getReleaseDiff(params)` | project, from_release_id, to_release_id, limit?, change_type?, component_key? | `{ rows: DiffRow[], summary: {added, changed, deleted, unchanged, emitted, total_old, total_new} }` |
| `getUnitDiff(params)` | 同上（单元粒度） | `ModelUnitDiffSummary` 与行集 |
| `getCompareReadiness(params)` | project, from_release_id, to_release_id | `{ classification, production_ready, problems[], warnings[], recommended_action, from, to }` |
| `listAnchors(dbnum, limit?)` | limit 0/缺省 = 不截断 | `{ dbnum, count, anchors[] }` |
| `resolveAnchor(dbnum, sesno, exactOnly?)` | — | 命中锚点或抛 `AnchorMissingError` |
| `getSnapshot(dbnum, sesno, refno, peKey?)` | — | 元素快照；历史过期抛 `ExpiredError` |
| `getRuntimeScene(releaseId, params)` | project?, component_key?, offset?, limit? | `ModelReleaseSceneResponse`；MUST 暴露 `has_more/next_offset` 供整树分页拉取 |

类型 MUST 与 `research/backend-api-facts.md` 中核实的后端结构一致，不得臆造字段。

## window 事件契约：`plant3d:incremental-version-compare`

现有 detail 字段（消费方：ModelTreePanel、ViewerPanel）——**只增不改**：

- `project: string`
- `dbnum: number`
- `fromSesno: number` / `toSesno: number`
- `fromReleaseId: string` / `toReleaseId: string`
- `mode: string`（如 `dtx`）
- `compare: boolean`
- `componentKey: string`
- `refnos: string[]`（归一化 refno，`/`→`_`）
- `models: Array<{ refno, componentKey?, refnoU64?, category, status, beforeState, afterState, sourceChangeCount, sourceNouns }>`

本 feature 新增的可选字段（消费方 MUST 容忍缺省）：

- `source?: 'versionTimeline' | 'incrementalPanel' | 'comparePanel'`（派发来源，便于调试与互斥处理）
- `pairKey?: string`（ComparePair 标识，用于结果与钉选状态对账）

## 面板 / 命令契约

- dock 面板 id：`versionTimeline`；组件名 `VersionTimelinePanel`；标题 `版本时间线`；默认停靠 viewer 右侧（与 `modelVersionCompare` 同模式，经 `addPanelSafely` 注册并加入面板 id 白名单）。
- ribbon 命令：`panel.versionTimeline`，按钮位于任务页签版本组（紧邻现有 `task.modelVersionCompare`），label `版本时间线`。
- 双版本对比工作台：沿用/升级 `modelVersionCompare` 面板；从时间线"进入对比"时 MUST 通过 `ensurePanelAndActivate` 激活。

**data-testid 清单**（e2e/vitest 选择器基线）：

| testid | 位置 |
|---|---|
| `version-timeline-panel` | 面板根 |
| `version-timeline-filter` | 项目/dbnum/分支筛选行 |
| `version-timeline-granularity` | 粒度切换（仅发布版本/含会话锚点） |
| `version-card` | 每张版本卡片（附 `data-release-id`） |
| `version-card-lifecycle-badge` / `version-card-quality-badge` | 双轴徽章 |
| `version-card-diff-summary` | 差异摘要 chips |
| `version-card-pin-a` / `version-card-pin-b` | 设为 A / 设为 B |
| `version-timeline-compare-bar` | 底部 A/B 钉选栏与进入对比按钮 |
| `anchor-node` | 锚点节点 |
| `tree-diff-filter` | 树差异筛选 chips（全部/新增/修改/删除） |
| `tree-diff-badge-added` / `-modified` / `-deleted` | 树节点徽章 |
| `tree-ghost-node` | 幽灵节点 |
| `attr-diff-table` | 属性 before/after 表 |
| `readonly-banner` | 历史快照只读横幅 |
| `snapshot-expired-hint` | 410 过期降级提示 |
| `anchor-missing-hint` | 404 锚点缺失提示 |
| `compare-workbench` | 双树对比工作台根 |
| `version-scrubber` | 视口刻度条 |

> 别名注记（2026-07-20，tasks.md Phase 4 纠偏）：契约 `tree-diff-filter` ↔ 实现 `model-tree-diff-chip-*`（`ModelTreePanel.vue` 实际 testid 为 `model-tree-diff-chip-all/-added/-modified/-deleted`，按 chip key 展开）；以现有实现 testid 为准，本注记仅作契约别名映射，不改代码不改测试。

## 守护契约

- 快照/对比目标默认仅接受 `release_lifecycle === 'published'`；其余生命周期 MUST 置灰并悬浮说明，诊断模式显式开启后方可选（FR-032）。
- `release_quality === 'quarantined_visual'` 的版本在时间线卡片、A/B 钉选、对比工作台、刻度条 MUST 展示红色警示（FR-031）。
- 快照模式激活期间：编辑/生成/导出/批注入口 MUST 禁用或拦截并提示只读（FR-016）；本 feature 全链路不修改源模型数据（FR-035）。
- 全部请求 MUST 具备竞态防护（requestId 或 AbortController；FR-034）。
