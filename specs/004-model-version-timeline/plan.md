# Implementation Plan: 模型版本时间线与历史模型树

**Branch**: `004-model-version-timeline` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-model-version-timeline/spec.md`

## Summary

为 plant3d-web 增加只读的版本管理前端能力：新增「版本时间线」dock 面板（发布版本主刻度 + 会话锚点细刻度、双轴状态徽章、懒加载差异摘要、A/B 钉选），在现有模型树上叠加版本差异标注（复用 `plant3d:incremental-version-compare` 事件通道），提供历史快照只读模式（锚点入口 + versionKey 缓存 + 410/404 降级）、双版本并排对比工作台与 3D 视口时间刻度条。数据全部来自 plant-model-gen 既有只读接口，不新增后端写路径。

## Technical Context

**Language/Version**: TypeScript + Vue 3 Composition API（Vite 7 工程）

**Primary Dependencies**: dockview-vue（面板体系）、@tanstack/vue-virtual（时间线与双树虚拟滚动）、Three.js（3D 版本场景/分色渲染，经 ViewerPanel 既有通道）、Vue refs/watchers；后端接口为 plant-model-gen `/api/model-version/*` 与 `/api/model-history/*`

**Storage**: N/A。时间线选中、A/B 钉选、快照模式均为会话级内存状态，不持久化；历史树数据仅做内存 LRU 缓存

**Testing**: Vitest + happy-dom（组件与 api 单测），`npm run type-check`；quickstart.md 提供接口直查与手工验证脚本

**Target Platform**: 浏览器三维工作台

**Project Type**: 前端 Web 应用（本 feature 纯前端只读）

**Performance Goals**: 时间线首屏（≤50 版本）2s 内；5000 条差异应用后交互响应 < 200ms（大差异合并移出主线程）；历史树缓存命中二次进入 < 500ms

**Constraints**: 会话级历史必须走锚点入口（resolve-anchor → snapshot）；410 Expired / 404 AnchorMissing 必须有降级 UI；未发布版本默认不可作为快照/对比目标；隔离质量态全入口警示；事件协议 `plant3d:incremental-version-compare` 只增不改；不修改 `src/components/review/`

**Scale/Scope**: 以 AMS DB1112 验证库为基准（数万组件、两个 quarantine release + 锚点序列）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Domain Contract First**: PASS。spec 将版本语义固定为后端双轴（lifecycle + quality）与锚点唯一入口；contracts 文件把 API/事件/守护条款写成 MUST 条款，实现不得自行放宽。
- **Preserve Existing Measurement Behavior**: PASS。本 feature 不触碰测量拾取、测量记录与 MBD 标注路径；差异/快照均为展示层叠加。
- **Source Separation**: PASS。时间线差异注入复用既有增量对比通道且只增字段；树的常规数据源与历史快照数据源以显式模式切换，互不混写。
- **Compatibility And Traceability**: PASS。全部只读；事件协议向后兼容；不改动持久化数据与后端契约。
- **Real Data Validation**: PASS。quickstart 以 AMS DB1112 真实 release/锚点数据为验证基线，接口直查先行，UI 验证对账 diff summary。

No constitution violations are expected.

## Project Structure

### Documentation (this feature)

```text
specs/004-model-version-timeline/
├── plan.md
├── research.md                  # 汇总决策（Decision/Rationale/Alternatives）
├── research/
│   ├── backend-api-facts.md     # 后端接口事实清单（含纠偏）
│   ├── frontend-integration-points.md  # 前端挂点盘点
│   ├── feature-feasibility-2026-07-19.md  # 可实现性分析（后端就绪度 A/B/C 分级）
│   └── task-briefs/             # 协同任务简报（过程文档）
├── prototypes/                  # 界面原型导出图 + FR 覆盖核对表（README.md）
├── data-model.md
├── quickstart.md
├── contracts/
│   └── version-timeline-ui-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md                     # 由任务拆解阶段生成
```

### Source Code (repository root)

```text
src/
├── api/
│   ├── modelVersionApi.ts                 # 新建：releases/diff/readiness/anchors/snapshot/runtime-scene 只读封装
│   └── modelVersionApi.test.ts            # 新建：含 410/404 分支单测
├── composables/
│   └── useVersionTimelineStore.ts         # 新建：时间线数据、A/B 钉选、快照模式、刻度条状态
├── components/
│   ├── model-version/
│   │   ├── VersionTimelinePanel.vue       # 新建：时间线面板（US1）
│   │   ├── VersionTimelinePanel.test.ts   # 新建
│   │   ├── VersionCompareWorkbench.vue    # 新建：双树并排对比（US4）
│   │   ├── VersionScrubber.vue            # 新建：视口时间刻度条（US5）
│   │   └── ModelVersionComparePanel.vue   # 扩展：参数来源从 URL 写死改为接受时间线 A/B
│   ├── model-tree/
│   │   └── ModelTreePanel.vue             # 扩展：差异筛选 chips、幽灵节点、快照模式横幅与数据源切换
│   ├── dock_panels/
│   │   └── ViewerPanel.vue                # 扩展：整版本场景加载（分页）、刻度条挂载、事件新增字段
│   └── DockLayout.vue                     # 扩展：versionTimeline 面板注册 + panel.versionTimeline 命令
└── ribbon/
    └── ribbonConfig.ts                    # 扩展：任务页签新增「版本时间线」按钮
```

**Structure Decision**: 版本能力集中在 `src/components/model-version/` 与新建的 api/store 层；模型树与视口只做扩展点接入（事件通道 + 数据源切换），避免把版本逻辑散进树/视口内部。UI 原型基线见 `specs/004-model-version-timeline/prototypes/`（10 帧导出图 + FR 覆盖核对表；Pencil 源文档见 `ui/版本管理/version-timeline-summary.md` 说明）。

## Phase 0: Research

研究结论汇总在 [research.md](./research.md)，事实依据在 [research/backend-api-facts.md](./research/backend-api-facts.md) 与 [research/frontend-integration-points.md](./research/frontend-integration-points.md)。关键结论：

- 时间线双层数据源：release 主刻度 + anchor 细刻度，按 dbnum 对齐。
- 双轴徽章：lifecycle（六态）与 quality（五态）不合并；legacy `release_status` 不用于新逻辑。
- 树内差异复用 `plant3d:incremental-version-compare` 通道，协议只增不改。
- 会话级历史只走锚点入口；410 Expired / 404 AnchorMissing 是一等降级路径。
- 大差异合并移出主线程；历史树按 versionKey LRU 缓存。
- 面板/命令沿用 dock + ribbon 既有注册模式；未发布/隔离版本按守护契约限制。

## Phase 1: Design & Contracts

设计产物：

- [data-model.md](./data-model.md)：ReleaseView/AnchorView/TimelineNode/ComparePair/SnapshotMode/TreeDiffEntry/ScrubberState 及验证规则、状态迁移、竞态横切规则。
- [contracts/version-timeline-ui-contract.md](./contracts/version-timeline-ui-contract.md)：modelVersionApi 导出面、事件契约（只增不改 + 新增可选字段）、面板/命令/data-testid 契约、守护契约。
- [quickstart.md](./quickstart.md)：接口直查命令、US1–US5 手工验证步骤、410/404 场景构造、收尾自动化检查。

## Implementation Approach

按 spec 分期推进（详细任务见 tasks.md）：

**Phase 1（US1 时间线 + US2 树内差异）**

1. 新建 `src/api/modelVersionApi.ts` + 单测：类型化封装与错误分类（ExpiredError/AnchorMissingError），全接口带竞态防护句柄。
2. 新建 `useVersionTimelineStore.ts`：releases/anchors 拉取与按天分组、粒度切换、diff 摘要懒加载缓存、A/B 钉选状态机。
3. 新建 `VersionTimelinePanel.vue`：虚拟滚动时间线、双轴徽章、卡片操作、底部对比栏；DockLayout/ribbonConfig 注册入口。
4. 树内差异：时间线派发 `plant3d:incremental-version-compare`（新增 source/pairKey 可选字段）；ModelTreePanel 增加差异筛选 chips、幽灵节点渲染与属性 before/after 面板；大差异走 worker/分帧合并。

**Phase 2（US3 历史快照 + 3D 联动）**

5. SnapshotMode：store 增加快照状态与 versionKey LRU 缓存；ModelTreePanel 数据源切换 + 只读横幅 + 写操作禁用；410/404 降级 UI。
6. ViewerPanel 整版本场景加载：runtime-scene 分页拉取（has_more/next_offset），时间线「3D 加载」与三方选中同步。

**Phase 3（US4 双树对比 + US5 刻度条）**

7. `VersionCompareWorkbench.vue`：readiness 前置检查、双树按 refno 对齐、占位行、滚动/展开联动、差异行分色。
8. ModelVersionComparePanel 升级：接受时间线 A/B 参数，保留 URL 参数兼容。
9. `VersionScrubber.vue`：刻度条、播放/暂停/倍速、加载等待不跳帧。
10. 收尾：type-check / lint / 相关 vitest；按 quickstart record 真实数据验证记录。

## Post-Design Constitution Check

- **Domain Contract First**: PASS。契约文件固化双轴枚举、锚点入口、事件字段与守护条款。
- **Preserve Existing Measurement Behavior**: PASS。无测量路径改动；树/视口扩展点不触碰测量拾取。
- **Source Separation**: PASS。常规树/历史快照/差异注入三种数据流有显式模式边界与清理规则（FR-013）。
- **Compatibility And Traceability**: PASS。事件只增不改；只读接口；无持久化变更。
- **Real Data Validation**: PASS。quickstart 全程以真实 release/锚点数据与接口直查对账。

## Complexity Tracking

无宪章违例。已知复杂度与外部依赖及其控制：

- 大差异集合并计算（FR-014）：以 2000 条为阈值切 worker/分帧，任务单列，避免过早引入 worker 基建。
- 历史整树还原：优先 runtime-scene 分页（默认 2000/页、上限 20000，AMS 规模 ≤2 页）；release 全树导出 HTTP 接口作为大库后备，需后端补（feasibility B1）。
- 属性 before/after：后端无组件级 attr-diff 接口，前端 `/api/model/incremental/attr-diff` 调用链是演示 fallback（feasibility C1）；短期用 versioned 站点 snapshot×2 前端做差，含「暂不可用」降级（B3）。
- 锚点粒度依赖站点 `versioned=true` 与 retention 配置（feasibility B2），作为 Phase 2/3 的环境前置，跟踪于 tasks.md T038。
