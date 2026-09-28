# 任务简报：撰写 004 plan.md 与汇总版 research.md

仓库：`d:\work\plant-code\plant3d-web`（用绝对路径读写；你的当前工作区可能是 rs-core，不影响）。

## 必读输入

1. `specs/004-model-version-timeline/spec.md`
2. `specs/004-model-version-timeline/research/backend-api-facts.md`
3. `specs/004-model-version-timeline/research/frontend-integration-points.md`
4. 结构严格参照 `specs/002-bran-flow-direction/plan.md` 与 `specs/002-bran-flow-direction/research.md`（本仓无 `.specify/`，以 002 为模板）

## 产出（只新建这两个文件，中文）

### 1. `specs/004-model-version-timeline/plan.md`

章节依次为：

- **Summary**
- **Technical Context**：Vue 3 + TypeScript + Vite；dockview-vue 面板体系；@tanstack/vue-virtual 虚拟滚动；Three.js 视图；Vitest + happy-dom；存储：会话级状态不持久化
- **Constitution Check**：沿用 002 的五原则逐条评估（Domain Contract First / Preserve Existing Measurement Behavior / Source Separation / Compatibility And Traceability / Real Data Validation）
- **Project Structure**：文档树 + 源码树
  - 新建：`src/api/modelVersionApi.ts`、`src/composables/useVersionTimelineStore.ts`、`src/components/model-version/VersionTimelinePanel.vue`、`src/components/model-version/VersionCompareWorkbench.vue`、视口刻度条组件（如 `src/components/model-version/VersionScrubber.vue`）
  - 扩展：`src/components/model-tree/ModelTreePanel.vue`、`src/components/dock_panels/ViewerPanel.vue`、`src/components/DockLayout.vue`、`src/ribbon/ribbonConfig.ts`
- **Phase 0 研究结论摘要**（指向 research.md）
- **Phase 1 设计产物引用**（data-model.md、contracts/version-timeline-ui-contract.md、quickstart.md）
- **Implementation Approach**：按 spec 的 Phase 1/2/3 分期列约 10 步，每步落到具体文件
- **Post-Design Constitution Check**
- **Complexity Tracking**

### 2. `specs/004-model-version-timeline/research.md`（feature 根目录汇总版）

用 Decision / Rationale / Alternatives considered 格式，覆盖：

1. 时间线双层数据源（release 主刻度 + anchor 细刻度）
2. 双轴状态徽章（lifecycle 与 quality 不合并）
3. 树内差异复用 `plant3d:incremental-version-compare` 通道而非新协议
4. 会话级历史只走锚点入口（resolve-anchor 再 snapshot，410/404 降级）
5. 大差异集合并计算移出主线程（worker 或分帧）
6. 历史树数据按 versionKey 缓存
7. 面板沿用 dock 注册模式
8. 未发布/隔离版本守护策略

每条引用 `research/` 两份事实清单的具体小节作为依据。

## 约束

- 不要修改 AGENTS.md（总指挥会统一更新）与其它任何文件。
- 完成后 `report_task(done)` 附一句话摘要。
