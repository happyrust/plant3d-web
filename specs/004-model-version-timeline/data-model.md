# Data Model: 模型版本时间线与历史模型树

> 字段事实来源：`research/backend-api-facts.md`；本文件定义前端视图模型与状态，全部为会话级内存数据，不持久化。

## 发布版本视图模型（ReleaseView）

来自 `GET /api/model-version/releases` 的 `ModelReleaseRecord` 投影。

**Source fields**（后端原字段，只读）:

- `release_id`: 版本唯一标识，作为 versionKey 组成部分。
- `release_label`: 可选人类可读标签；缺省时 UI 回退显示 `release_id`。
- `project_name` / `branch_id` / `dbnum`: 归属与筛选维度。
- `registered_at`（必有）/ `created_at`（可选）: 时间线排序与按天分组依据，优先 `registered_at`。
- `release_lifecycle`: 工作流轴，枚举 `staged | validating | assets_materialized | indexed | published | failed`。
- `release_quality`: 质量轴，枚举 `complete_visual | quarantined_visual | degraded_visual | patch_only | non_visual`。
- `release_quality_reason` / `validation_flags`: 质量态悬浮提示内容。
- `release_status`: legacy 单轴字段，前端**不得**用于新逻辑（仅调试显示）。

**Derived fields**（前端派生）:

- `displayLabel`: `release_label ?? release_id`。
- `dayKey`: `registered_at` 的本地日期（yyyy-MM-dd），按天分组键。
- `sesnoHint`: 从 release_id 提取的 sesno 提示（如 `physical-(\d+)`），仅展示用，不作查询键。
- `diffSummary`（懒加载）: 相对上一版本的 `{added, changed, deleted}`，来自 `/api/model-version/diff` 的 summary，按需请求并缓存。

**双轴徽章映射表**:

| 轴 | 枚举值 | 徽章文案 | 颜色语义 |
|---|---|---|---|
| lifecycle | published | 已发布 | 绿 |
| lifecycle | staged / validating / assets_materialized / indexed | 未发布（悬浮显示具体阶段） | 灰 |
| lifecycle | failed | 失败 | 红 |
| quality | complete_visual | 完整 | 绿 |
| quality | degraded_visual | 降级 | 琥珀 |
| quality | quarantined_visual | 隔离 | 红（全入口警示，FR-031） |
| quality | patch_only | 补丁 | 灰 |
| quality | non_visual | 非可视 | 灰 |

## 会话锚点（AnchorView）

来自 `GET /api/model-history/anchors?dbnum=`。

**Fields**（后端 `AnchorHit` 结构，rs-core `version_query.rs:15-23` 已核实）:

- `dbnum` + `sesno`: 联合唯一键；锚点是会话级历史查询的唯一合法入口（FR-018）。
- `anchored_at`: RFC3339 字符串，前端派生 `anchoredAt`（时间线定位与 dayKey 分组）。
- `source`: 可选来源标注（悬浮提示展示）。
- `exact`: resolve-anchor 时 `true`=精确命中请求 sesno，`false`=回退到最近不大于的锚点（UI 需提示"已回退到 sesno N"）。

**Validation rules**:

- 任何 sesno 只有解析到固化锚点（`resolve-anchor` 命中）才可用于快照查询。
- `resolve-anchor` 404 AnchorMissing → 提示锚点缺失，提供"最近可用锚点 / 改用发布版本"回退（FR-020）。
- `snapshot` 410 Expired → 提示"历史已过期"，引导切换发布版本粒度（FR-019）。

## 时间线节点（TimelineNode）

时间线面板的渲染单元。

**Fields**:

- `kind`: `release | anchor`。
- `key`: release → `release:{release_id}`；anchor → `anchor:{dbnum}:{sesno}`。
- `timestamp`: 排序时间（release 用 registered_at，anchor 用 anchoredAt）。
- `dayKey`: 按天分组键。
- `payload`: ReleaseView 或 AnchorView。

**排序与分组规则**:

- 组间按 dayKey 倒序；组内按 timestamp 倒序。
- 粒度开关：`仅发布版本` 只渲染 kind=release；`含会话锚点` 两类混排。
- anchor 节点无 diff 摘要、无 A/B 钉选操作，仅提供"查看此时刻树（快照）"。

## 版本对（ComparePair）

**Fields**:

- `a` / `b`: 各为 `TimelineNode.key`（仅 release 可钉选）。
- `readiness`（懒加载缓存）: `compare-readiness` 响应投影 `{classification, production_ready, problems[], warnings[], recommended_action, diff_summary?}`。

**状态机**:

```text
empty ──设为A──> onlyA ──设为B──> ready ──进入对比──> comparing
  ^                │  ^                │
  └──清除A────────┘  └──替换A/B（保持 ready，readiness 缓存失效重查）
comparing ──关闭对比──> ready
```

**Validation rules**:

- `ready → comparing` 前必须完成 readiness 检查；`production_ready=false` 时展示 problems/warnings 与 recommended_action，用户显式确认"诊断查看"才可继续（FR-027）。
- a 或 b 为 quarantined_visual → 对比工作台常驻红色警示（FR-031）。
- a、b 跨 project 或跨 dbnum → 不可比，按后端结论呈现原因。

## 历史快照模式（SnapshotMode）

**Fields**:

- `active`: boolean，默认 false。
- `versionKey`: 当前查看的 `release:{id}` 或 `anchor:{dbnum}:{sesno}`。
- `enteredFrom`: 进入来源（时间线卡片 / 刻度条），退出后焦点返回处。
- `disabledCapabilities`: 只读禁用集合，至少含 `edit | generate | export | annotate`（FR-016/035）。
- `treeCache`: `Map<versionKey, HistoricalTreeData>`，LRU 上限（建议 8 个版本），命中即秒开（FR-017/SC-006）。

**状态迁移**:

- `enter(versionKey)`: 解析数据源（release → scene_tree/runtime-scene；anchor → resolve-anchor + snapshot）→ 填充树 → 显示只读横幅。
- `exit()`: 树切回最新数据源，横幅移除，禁用集合复原；缓存保留。
- 进入失败（410/404/网络）→ 保持当前模式不变，仅弹降级提示（不得留下半只读状态）。

## 树差异条目（TreeDiffEntry）

差异模式注入模型树的数据单元，经由 `plant3d:incremental-version-compare` 事件的 `models[]` 传递。

**Fields**:

- `refno`: 归一化元素标识（`refno_str` 中 `/` 替换为 `_`，与 ModelTreePanel 现有 normalize 规则一致）。
- `category`: 元素类别（noun）。
- `status`: `added | modified | deleted`。
- `beforeState` / `afterState`: `present | missing`（对齐 ModelVersionComparePanel 现有派发字段）。
- `sourceChangeCount` / `sourceNouns`: 摘要信息。
- `attrDiffHandle`（懒加载）: 点击时拉取属性 before/after。数据源策略（feasibility C1/B3）：
  - 首选：versioned 站点上经 `resolveAnchor + getSnapshot` 分别取 from/to 两个 sesno 的元素快照，前端对属性做差；
  - 不可用（非 versioned / 410 / 404）：属性差异区显示「属性差异暂不可用」及原因，不回落演示数据；
  - 禁用：`/api/model/incremental/attr-diff`（后端无此路由，仅演示 fallback）。

**幽灵节点挂载规则**（status=deleted）:

- 原父节点仍存在 → 以灰色删除线幽灵形态回插原父节点下，不可选中定位 3D（FR-010）。
- 原父节点也被删除 → 挂载到最近的仍存在祖先下，并在悬浮提示中标注原路径。
- 差异模式关闭 → 幽灵节点与全部徽章清除，树恢复常规（FR-013）。

## 刻度条播放状态（ScrubberState）

**Fields**:

- `visible`: boolean，默认 false。
- `nodes`: 有序 TimelineNode 列表（与时间线面板共享数据源）。
- `currentIndex`: 当前刻度。
- `playing`: boolean；`loading`: boolean（场景加载中）。
- `speed`: 播放倍速（1x/2x）。

**状态迁移**:

- `play()`: 从 currentIndex 依次推进；每步等待场景加载完成（loading=true 期间不推进，FR-030）；到末尾自动 `pause()`。
- `seek(i)`: 立即切换到第 i 个版本，取消进行中的旧加载。

## 请求竞态与取消（横切规则，FR-034）

- 所有版本数据请求（releases / diff / snapshot / runtime-scene / readiness）携带自增 requestId 或 AbortController。
- 响应返回时 requestId 不等于当前值 → 丢弃，不写入状态（与 ModelVersionComparePanel 现有 `provenanceRequestId/diffRequestId` 模式一致）。
- 面板关闭 / 版本切换 / 退出快照模式时 abort 进行中请求。
