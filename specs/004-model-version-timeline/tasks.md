# Tasks: 模型版本时间线与历史模型树

**Input**: Design documents from `/specs/004-model-version-timeline/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/version-timeline-ui-contract.md](./contracts/version-timeline-ui-contract.md), [quickstart.md](./quickstart.md)

**Tests**: 包含测试任务；新组件与 api 封装按契约先写用例（410/404 分支、差异应用/清除回归为硬性要求）。

**Organization**: 按用户故事分组；US1+US2 为 MVP（spec Phase 1），US3 为 spec Phase 2，US4+US5 为 spec Phase 3。

**范围提示**: 本 feature 不修改 `src/components/review/` 下任何文件，无需运行「双胞胎面板」回归套件（AGENTS.md 约定仅针对 review 面板改动）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与同阶段其它 [P] 任务并行（不同文件、无未完成依赖）。
- **[Story]**: 对应 spec.md 的用户故事。
- 每个任务给出精确文件路径与验收标准（关联 FR/SC）。

## Phase 1: Setup（现状确认）

- [X] T001 通读 `src/components/model-version/ModelVersionComparePanel.vue` 现有 diff/readiness 调用与事件派发字段，确认与 `contracts/version-timeline-ui-contract.md` 事件清单一致（2026-07-19 核实：事件 detail 字段与契约一致；消费 `data.diff` / `data.readiness`；requestId 竞态防护模式可沿用）
- [X] T002 [P] 通读 `src/components/model-tree/ModelTreePanel.vue` 的 `IncrementalCompareContext` 解析（:39-50、:1057+）与 refno 归一化规则（`normalizeRefnoKeyLike`：`/`与`,`→`_`，兼容 `pe:⟨…⟩` 包装）
- [X] T003 [P] 通读 `src/components/dock_panels/ViewerPanel.vue` 的 `fetchReleaseRuntimeScene`（:598-611）与双版本渲染路径（:677-724）（from 蓝 0x2563eb / to 绿 0x10b981，`mv:{releaseId}:{geo_hash}` 几何缓存）
- [X] T004 [P] 通读 `src/components/DockLayout.vue` 面板注册白名单与 `togglePanel` 命令分发模式（:616-625、:905-913、:1308+）（新面板需三处：白名单数组 + addPanelSafely 分支 + `panel.*` command case）

---

## Phase 2: Foundational（阻塞性基础设施）

**CRITICAL**: 所有用户故事实现前必须完成。

- [X] T005 新建 `src/api/modelVersionApi.ts`：按契约实现 listReleases / getRelease / getReleaseEvents / getReleaseDiff / getUnitDiff / getCompareReadiness / listAnchors / resolveAnchor / getSnapshot / getRuntimeScene（分页），统一 `{success,data,message}` 判定与 `ExpiredError` / `AnchorMissingError` 错误分类，全部支持 AbortSignal（FR-033/034）（2026-07-19 完成；双包装分别处理：model-version `{success,message,data}` / model-history `{ok,data|error{code,message}}`）
- [X] T006 新建 `src/api/modelVersionApi.test.ts`：正常路径 + `success:false` + HTTP 410 → ExpiredError + HTTP 404 resolve-anchor → AnchorMissingError + abort 后不写状态（验收：用例全绿，覆盖契约错误分类表）（15 用例全绿）
- [X] T007 新建 `src/composables/useVersionTimelineStore.ts`：releases/anchors 加载、按 dayKey 分组排序（data-model「时间线节点」规则）、粒度切换、diff 摘要懒加载缓存、A/B 钉选状态机（empty→onlyA→ready→comparing）、请求竞态防护（FR-034）（2026-07-19 完成；含双轴徽章映射 lifecycleBadge/qualityBadge 导出，供 T011 面板复用）
- [X] T008 [P] 新建 `src/composables/useVersionTimelineStore.test.ts`：分组排序、粒度过滤、钉选状态机迁移、readiness 缓存失效（验收：与 data-model 状态机图一致）（14 用例全绿；`npm run type-check` 0 错误、eslint 通过）

**Checkpoint**: api 与 store 可独立测试通过，无 UI。

---

## Phase 3: User Story 1 - 浏览版本时间线（Priority: P1）

**Goal**: 版本时间线面板可打开，按天分组展示版本卡片与双轴徽章，差异摘要懒加载，支持筛选与粒度切换。

**Independent Test**: 打开面板 → 卡片分组/徽章/摘要与后端一致（quickstart US1 步骤）。

### Tests for User Story 1

- [ ] T009 [P] [US1] 新建 `src/components/model-version/VersionTimelinePanel.test.ts`：默认渲染（分组倒序、`version-card` 数量）、双轴徽章文案映射（data-model 徽章表逐值断言）、隔离版本红色警示（FR-004/FR-031、SC-007）
- [ ] T010 [P] [US1] 同文件补用例：空态/加载中/失败重试三态（FR-008）、diff 摘要懒加载不阻塞列表（SC-002）、粒度切换含锚点节点（FR-007）

### Implementation for User Story 1

- [ ] T011 [US1] 新建 `src/components/model-version/VersionTimelinePanel.vue`：虚拟滚动时间线（@tanstack/vue-virtual）、按天分组、版本卡片（displayLabel/时间/双轴徽章/懒加载摘要 chips）、筛选行（项目/dbnum/分支）、粒度切换、data-testid 按契约清单（FR-001…008）
- [ ] T012 [US1] 卡片操作区：查看此版本树 / 设为 A / 设为 B / 3D 加载 四操作接入 store（锚点节点仅保留快照入口），底部 A/B 钉选栏 + 进入对比按钮（`version-timeline-compare-bar`）
- [ ] T013 [US1] `src/components/DockLayout.vue`：注册 `versionTimeline` 面板（addPanelSafely + 白名单 + `panel.versionTimeline` 命令分发）
- [ ] T014 [P] [US1] `src/ribbon/ribbonConfig.ts`：任务页签版本组（紧邻 :269 现有 `task.modelVersionCompare`）新增「版本时间线」按钮（`task.versionTimeline` → `panel.versionTimeline`），并扩展 `src/ribbon/ribbonConfig.test.ts` 配置测试

**Checkpoint**: US1 独立可验收（quickstart US1 全步骤通过）。

---

## Phase 4: User Story 2 - 树内差异标注（Priority: P1）

**Goal**: 时间线选定版本对后模型树标注增/删/改，支持筛选与属性 before/after，退出后完全清理。

**Independent Test**: quickstart US2 步骤；徽章计数与 `/api/model-version/diff` summary 对账（SC-003）。

> **现状纠偏（2026-07-19 核实）**：树侧差异 UI 基建已存在——`useTreeVersionDiff.ts`（筛选 chips 计数/幽灵节点回插/祖先汇总/路径解析 MAX_PATH_RESOLVE=500）、`ModelTreePanel.vue` 差异工具条（`model-tree-diff-bar`/`-chip-*`/`-exit`）、`ModelTreeRow.vue` 徽章（`model-tree-diff-badge`/`-count`）、`ModelTreeAttrDiffPanel.vue` 属性表。**T018 的大部分已实现**，剩余工作集中在：T017（时间线派发、真数据源）、T019（属性差异从假的 `loadIncrementalAttrDiff` 换成 `resolveAnchor+getSnapshot×2` 前端做差 + 「暂不可用」降级，现组件在后端 404 时回落演示数据并标「示例」——必须去掉）、T015/T016（测试）、T020（>500 条路径解析上限与 ≥2000 条合并性能复核）。现有 testid 与契约清单不同名（`model-tree-diff-chip-*` vs 契约 `tree-diff-filter`），实现时以**现有 testid 为准**并在契约文件补记别名，不要双改。

### Tests for User Story 2

- [ ] T015 [P] [US2] 扩展 `src/components/model-tree/ModelTreePanel` 相关测试（新建 `ModelTreePanel.versionDiff.test.ts`）：注入 compare 事件后徽章渲染、幽灵节点回插（含父节点也被删除 → 挂最近存活祖先）、筛选保留祖先路径、退出清理（FR-010/011/013）
- [ ] T016 [P] [US2] 属性差异用例：点击修改节点 → snapshot×2 做差路径调用参数正确、before/after 行渲染；非 versioned / 410 / 404 时渲染「属性差异暂不可用」而非演示数据（FR-012；数据源策略见 data-model TreeDiffEntry 与 research/feature-feasibility C1/B3）

### Implementation for User Story 2

- [ ] T017 [US2] 时间线派发：store 的 ComparePair ready 后组装 `plant3d:incremental-version-compare` detail（含新增可选字段 source/pairKey，现有字段只增不改），经 `getReleaseDiff` rows 映射 TreeDiffEntry（refno 归一化沿用现有规则）
- [ ] T018 [US2] `src/components/model-tree/ModelTreePanel.vue`：差异筛选 chips（全部/新增/修改/删除 + 计数，`tree-diff-filter`）、增/改/删徽章、幽灵节点渲染（灰色删除线、不可选中定位 3D）
- [ ] T019 [US2] 属性 before/after 区：选中变更节点时经 `modelVersionApi` 的 `resolveAnchor + getSnapshot`×2 前端做差懒加载（不得使用后端不存在的 `/api/model/incremental/attr-diff`），变更前红/变更后绿，含「暂不可用」降级态（`attr-diff-table`）
- [ ] T020 [US2] 大差异合并优化：≥2000 条时 worker 或分帧合并 + 虚拟滚动验证（FR-014；验收：5000 条注入后交互 < 200ms，SC-004；记录测量方式）

**Checkpoint**: MVP（US1+US2）完成，可独立交付。

---

## Phase 5: User Story 3 - 历史快照模式 + 3D 联动（Priority: P2）

**Goal**: 整树切换到历史版本（只读），410/404 有降级；3D 可加载所选版本场景并三方同步。

**Independent Test**: quickstart US3 步骤（含缓存命中计时与降级场景）。

### Tests for User Story 3

- [ ] T021 [P] [US3] store 快照模式用例：enter/exit 状态迁移、versionKey LRU 缓存命中、进入失败不留半只读态（data-model SnapshotMode 规则）
- [ ] T022 [P] [US3] 降级用例：ExpiredError → `snapshot-expired-hint` 渲染与「用发布版本」回退；AnchorMissingError → `anchor-missing-hint` 与最近锚点回退（FR-019/020、SC-008）

### Implementation for User Story 3

- [ ] T023 [US3] store：SnapshotMode 状态 + 数据源解析（release → runtime-scene 分页/scene_tree；anchor → resolveAnchor → getSnapshot）+ LRU 缓存（FR-015/017/018）
- [ ] T024 [US3] `src/components/model-tree/ModelTreePanel.vue`：历史数据源切换、只读横幅（`readonly-banner`，含版本标识与「回到最新」）、写操作入口禁用（FR-016；验收 SC-005：写入口 100% 禁用）
- [ ] T025 [US3] `src/components/dock_panels/ViewerPanel.vue`：整版本场景加载（runtime-scene 按 has_more/next_offset 分页拉全量）、时间线「3D 加载」接入、时间线/树/3D 选中同步（FR-021/022）

**Checkpoint**: 时间旅行闭环可演示。

---

## Phase 6: User Story 4 - 双版本并排对比（Priority: P2）

**Goal**: A/B 进入双树对齐对比，readiness 前置检查，3D 分色联动。

**Independent Test**: quickstart US4 步骤。

### Tests for User Story 4

- [ ] T026 [P] [US4] 新建 `src/components/model-version/VersionCompareWorkbench.test.ts`：按 refno 对齐与占位行、滚动/展开联动、差异行分色、readiness 不可比原因展示、隔离警示（FR-024…028、FR-031）

### Implementation for User Story 4

- [ ] T027 [US4] 新建 `src/components/model-version/VersionCompareWorkbench.vue`：readiness 前置检查（getCompareReadiness，problems/warnings/recommended_action 呈现）、双树虚拟滚动对齐、占位行、联动滚动/展开、差异筛选复用 US2 语义（`compare-workbench`）
- [ ] T028 [US4] `src/components/model-version/ModelVersionComparePanel.vue`：参数来源扩展为「时间线 A/B 优先，URL 参数兼容」，进入对比经 `ensurePanelAndActivate`（FR-024）
- [ ] T029 [US4] 3D 并排：对比工作台「在 3D 中并排显示」接入 ViewerPanel 现有 from 蓝/to 绿双版本渲染，选中行联动定位（FR-023）

---

## Phase 7: User Story 5 - 视口时间刻度条（Priority: P3）

**Goal**: 视口底部 scrubber 逐版本切换与播放。

**Independent Test**: quickstart US5 步骤。

### Tests for User Story 5

- [ ] T030 [P] [US5] 新建 `src/components/model-version/VersionScrubber.test.ts`：刻度渲染与当前高亮、seek 取消旧加载、播放推进等待 loading、末尾自动停止（FR-029/030）

### Implementation for User Story 5

- [ ] T031 [US5] 新建 `src/components/model-version/VersionScrubber.vue`：刻度点/当前点/tooltip/播放暂停/倍速（`version-scrubber`），数据源复用 store 的 TimelineNode 列表
- [ ] T032 [US5] `src/components/dock_panels/ViewerPanel.vue`：刻度条挂载与场景切换接线（seek → 版本场景加载，播放等待加载完成；FR-030），时间线面板选中同步（FR-022）

---

## Phase 8: Polish & Cross-Cutting

- [ ] T033 隔离/未发布守护复查：时间线、A/B 钉选、对比、快照、刻度条五入口逐一核对 FR-031/032（quarantined 警示 100% 覆盖，SC-007；非 published 默认置灰 + 诊断模式开关）
- [ ] T038 后端/rs-core 对齐（跟踪项，见 research/feature-feasibility-2026-07-19.md）：① release 全树导出 HTTP 接口（大库历史快照后备）；② 组件级属性 attr-diff 接口（替代 snapshot×2 前端做差）；③ 确认验证环境 versioned=true 站点与 retention 配置（决定锚点粒度可演示范围）。未就绪不阻塞 Phase 1/2 交付
- [ ] T034 [P] 运行 `npm run type-check`（验收：0 错误）
- [ ] T035 [P] 运行 `npm run lint`（验收：不新增错误）
- [ ] T036 运行 `npx vitest run src/api/modelVersionApi.test.ts src/composables/useVersionTimelineStore.test.ts src/components/model-version/ src/components/model-tree/ModelTreePanel.versionDiff.test.ts`（验收：全绿）
- [ ] T037 按 `quickstart.md` 走 US1–US5 手工验证并在其 Validation Record 追加真实命令/数据/结果记录（含 SC-003 对账数字与 SC-004/006 计时）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖。
- **Foundational (Phase 2)**: 依赖 Setup；阻塞全部用户故事。
- **US1 (Phase 3)**: 依赖 Phase 2。MVP 入口。
- **US2 (Phase 4)**: 依赖 Phase 2 与 US1 的 A/B 钉选（T012）。
- **US3 (Phase 5)**: 依赖 Phase 2；树内改造建议在 US2 落地后进行（同文件 ModelTreePanel）。
- **US4 (Phase 6)**: 依赖 US1 钉选与 US2 差异语义。
- **US5 (Phase 7)**: 依赖 US3 的版本场景加载（T025）。
- **Polish (Phase 8)**: 依赖全部所选故事。

### 关键并行机会

- T002/T003/T004 并行；T006/T008 并行；T009/T010 与 T014 并行。
- T015/T016 并行（不同测试文件）；T021/T022 并行；T026/T030 并行。
- 同文件任务禁止并行：ModelTreePanel（T018/T019/T024）、ViewerPanel（T025/T029/T032）按序执行。

### Implementation Strategy

1. **MVP 先行**：Phase 1→2→3→4，交付时间线 + 树内差异并验证 SC-001…004。
2. **增量交付**：Phase 5（时间旅行）→ Phase 6（对比工作台）→ Phase 7（刻度条），每期结束跑 Phase 8 的自动化检查。
3. **守护不后置**：FR-031/032 的警示与置灰在各故事实现时同步做，T033 只做复查。
