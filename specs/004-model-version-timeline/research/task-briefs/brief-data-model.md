# 任务简报：撰写 004 data-model.md

仓库：`d:\work\plant-code\plant3d-web`（用绝对路径读写；你的当前工作区可能是 rs-core，不影响）。

## 必读输入

1. `specs/004-model-version-timeline/spec.md`（重点 Key Entities 与 FR-001…035）
2. `specs/004-model-version-timeline/research/backend-api-facts.md`（后端字段/枚举事实，不得臆造）
3. `specs/004-model-version-timeline/research/frontend-integration-points.md`
4. 结构与行文粒度参照 `specs/002-bran-flow-direction/data-model.md`

## 产出（只新建这一个文件）

`specs/004-model-version-timeline/data-model.md`，中文（保留英文 ID），至少覆盖：

### 实体

- **发布版本视图模型**：release_id / release_label / branch_id / dbnum / registered_at；
  - `release_lifecycle` 六态：staged / validating / assets_materialized / indexed / published / failed
  - `release_quality` 五态：complete_visual / quarantined_visual / degraded_visual / patch_only / non_visual
  - 给出「双轴徽章映射表」（每个枚举值 → 徽章文案/颜色语义）
- **会话锚点**：dbnum + sesno（唯一历史入口）
- **时间线节点**：kind = release | anchor，按天分组键，排序规则
- **版本对 ComparePair**：A/B 钉选 + compare-readiness 结论缓存（classification、production_ready、problems、warnings）
- **历史快照模式状态**：当前 versionKey、只读禁用集合、树缓存键
- **TreeDiffEntry**：refno 归一化、add/modified/deleted、beforeState/afterState、幽灵节点挂载规则（父节点也被删除时的处理）、属性 diff 懒加载句柄
- **刻度条播放状态**：播放/暂停/当前索引/加载中

### 验证规则

- 404 AnchorMissing、410 Expired 的降级路径
- 未发布版本不可作为快照/对比目标（FR-032）
- 隔离版本全入口警示（FR-031）

### 状态迁移

- 快照模式进入/退出；A/B 钉选状态机；差异模式开/关与清理（FR-013）；请求竞态取消（FR-034）

## 约束

- 不要修改其它任何文件。
- 完成后 `report_task(done)` 附一句话摘要。
