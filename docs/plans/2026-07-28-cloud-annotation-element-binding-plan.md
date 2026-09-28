# 云线与模型元素绑定工程化方案（2026-07-28）

> 需求来源（开发计划表，逐字）：
> 「云线与模型元素绑定：绘制云线前选择目标模型，云线保存后可定位并高亮关联元素（一对一、一对多）」，
> 子项：云线的绘制 / 云线的关联存储 / 云线的关联显示。
>
> 本方案基于对现有代码的核实（`useToolStore.ts` / `useDtxTools.ts` / `AnnotationPanel.vue` /
> `review/domain/reviewSnapshot.ts` / `review/adapters/*` / `reviewApi.ts`），并经外部模型
> （Oracle GPT-5.5 Pro，会话 `cloud-annotation-element-binding`）评审后整理。
>
> **定稿说明（2026-07-28）**：全部 10 项设计决策已经逐题审问（grilling）确认，
> 决策记录见文末附录。本期交付范围锁定 **Phase 1 + Phase 2（后端不动）**。

## 0. 结论摘要

现有云线实现已经完成了**几何表现层绑定**（世界锚点 + 屏幕空间波浪矩形 + 每帧重建），
但尚未完成**工程语义绑定**。本方案不推翻现有渲染与两阶段创建模型，只做四件事：

1. 交互：把「框选即关联」改为「先显式选择目标元素，再绘制云线」；
2. 数据：引入 `bindings`（带角色的关联结构）与锚点设计坐标快照，支持失效检测；
3. 存储：批注 payload superset 原则不变，后端增加 annotation↔element **关联投影索引**支持反查；
4. 显示：定位/高亮升级为双向联动 + 失效降级显示（对齐尺寸系统 STALE 模式）。

方案分两个层次：**MVP（满足计划表验收）** 与 **工程完备（反查索引、失效治理）**，可分期交付。
**本期范围已定：Phase 1（创建交互重构）+ Phase 2（关联编辑），后端零改动；Phase 3/4 后置。**

---

## 1. 现状与差距（已核实代码）

### 1.1 现状

- 创建（`useDtxTools.ts`）：`annotation_cloud` 模式两阶段——先点击 mesh pick 锚点
  （`pendingCloudAnchor{worldPos, refno, entityId}`），再拖屏幕框选；`collectRefnosInScreenRect`
  把矩形内**所有投影元素**收进 `refnos`，同时由 marquee 得出 `screenOffset + cloudSize`，
  经 `createCloudAnnotationRecordFromAnchorAndMarquee` 生成记录。
- 数据（`useToolStore.ts` `CloudAnnotationRecord`）：`id / objectIds[] / anchorWorldPos /
  anchorRefno? / leaderEndWorldPos? / selectionBbox? / screenOffset? / cloudSize? / visible /
  collapsed? / title / description / createdAt / refnos?[] / comments? / reviewState? /
  severity? / authorId? / screenshot?`；localStorage 版本化持久（V1–V6 兼容读取）。
- 校审存储：批注数组作为 JSON payload 内嵌在校审记录里（`POST /api/review/records`，
  字段如 `cloud_annotations`）；`ReviewSnapshot` 统一三类恢复入口（task_records /
  workflow_sync / import_package），payload superset 不丢字段。
- 显示（`AnnotationPanel.vue`）：「定位」= `flyToCloudAnnotation`（refnos 合并 AABB flyTo）；
  「高亮」= `highlightAnnotationTargets`（`showModelByRefnos` 确保加载 → `ensureRefnos` →
  `setObjectsSelected` → flyTo）。

### 1.2 差距

| # | 差距 | 工程影响 |
|---|------|----------|
| 1 | 关联集合来自屏幕框选，含被遮挡/背景无关元素 | 关联不可控、不可预检，不符合「先选目标再绘制」 |
| 2 | 创建后关联不可查看/增删，锚点不可重绑 | 关联错了只能删除重画 |
| 3 | 关联埋在 JSON payload，后端无法按元素反查 | 无法支撑「元素 → 云线」「按元素统计问题」 |
| 4 | `anchorWorldPos` 一次性世界坐标，无失效检测 | 模型版本更新后云线漂移/悬空无治理 |
| 5 | 显示单向（云线→元素），无逐元素导航、无状态色 | 一对多校审体验差 |

---

## 2. 交互设计

### 2.1 创建状态机

```ts
type CloudCreateState =
  | 'idle'                // 未进入云线工具
  | 'selecting_targets'   // 正在收集目标元素（一对一/一对多）
  | 'targets_selected'    // 目标集合确认，等待 pick 锚点
  | 'picking_anchor'      // （可选合并进上一步）点击 mesh 记录锚点
  | 'drawing_cloud'       // 拖框确定云线屏幕轮廓（不再收集关联）
  | 'editing';            // 保存后进入批注编辑/关联编辑
```

流程：进入 `annotation_cloud` → 选择目标元素 → 确认目标集合 → pick 锚点 →
拖框绘制云线（**框选只决定 `screenOffset/cloudSize`，不再决定关联**）→ 填写内容保存。

**已确认**：未选择任何目标元素时禁止进入绘制，状态条提示「请先选择目标元素」，
保证每条云线都有绑定（不提供"无绑定云线"开关）。

**闸门落点（2026-07-28 复核修正）**：进入 `annotation_cloud` 的入口有**四处**，
校验若做在任一面板内都会漏网，必须集中在工具层：

| 入口 | 位置 |
|------|------|
| 批注面板工具按钮 | `src/components/tools/AnnotationPanel.vue:850` |
| 视口浮动工具条 | `src/components/tools/AnnotationOverlayBar.vue:582` |
| 校审工作台 | `src/components/review/AnnotationWorkspace.vue:305`（emit `start-tool`） |
| 校审面板 | `src/components/review/ReviewPanel.vue:1111`（直接 `setToolMode`） |

统一落点为 `useDtxTools.beginMarquee`（`useDtxTools.ts:3811`），该处已有
`if (mode === 'annotation_cloud' && !pendingCloudAnchor.value) return;`，
把「目标集合判空」并排加入即可一次覆盖四个入口；状态条文案由工具层单一来源提供。

回退语义（统一在 `cancelCloudCreation()` 清理 pendingAnchor / pendingTargets / marquee / 预览）：

- `selecting_targets` 按 Esc：清空本次已选目标，回 `idle`；
- `targets_selected` 按 Esc：保留目标集合，仅退出工具（再次进入可复用）；
- `drawing_cloud` 按 Esc：丢弃预览，回 `targets_selected`（保留目标与锚点，便于重拖）；
- 切换工具模式：等价于 Esc 到底，全部清理。

### 2.2 目标选择的四种入口（组合使用，均写入同一 pendingTargets 集合）

| 入口 | 复用/新增 | 语义 | 本期 |
|------|-----------|------|------|
| 三维点选 | 复用 `pick_refno`（`addPickedRefno`，支持 noun 过滤） | 逐个点击累积/再点取消 | ✅ |
| 三维框选 | 复用 `pick_refno_box`，**语义改为候选集** | 见下方确认交互 | ✅ |
| 当前选择集导入 | 新增「从当前选择创建云线」 | 把 viewer 当前 selectedObjectIds 一键导入 | ✅ |
| 模型树勾选 | 需在 `ModelTreePanel.vue` 新增行内操作/多选 | refno 明确、不受遮挡影响 | ⏳ 后置 |

**框选候选确认（已确认）**：框选结束一律弹候选确认列表——默认全勾、按 noun 分组
（可整组取勾）、Enter 即确认加入。理由：屏幕框选会把矩形内所有投影元素（含被遮挡、
背景无关元素）收进来，确认列表同时承担「预检」职责；一律弹出保证行为一致可预期，
默认全勾 + Enter 让流畅成本趋近于零。不采用阈值式（行为不一致）与遮挡剔除
（逐元素深度判定实现复杂、边界模糊）。

一对一与一对多不做模式区分：目标集合恰好 1 个即一对一；UI 在 `targets_selected`
态显示目标列表（可勾除）。

### 2.3 锚点与目标解耦（已确认）

- 锚点（图钉/参考中心）**允许不属于目标集合**（工程场景：图钉放在附近梁柱上，
  实际问题对象是管线+阀门）。锚点仅作视觉参考中心，不自动并入目标集合，
  也不强制校验其属于目标；沿用现有「pick 锚点」交互，顺序调整为目标选择之后。
- 锚点记录 `refno + 设计坐标快照 + 世界坐标`，为失效治理留钩子（见 §3）。

### 2.4 云线绘制形态（已确认：双模式统一流程）

事实核实：`useAnnotationStyleStore.ts` 已存在 `CloudDrawMode = 'screen2d' | 'bbox3d'`
双绘制模式开关（localStorage 持久）。**两种绘制模式共用同一「先选目标 → pick 锚点」流程**：

- `screen2d`（默认）：保持现有屏幕空间模型（`anchorWorldPos + screenOffset + cloudSize`
  每帧 billboard 重建，波浪矩形轮廓），拖框只决定屏幕轮廓尺寸；
- `bbox3d`：**改为直接使用目标集合的合并 AABB** 生成三维波浪线，不再依赖屏幕框选结果
  （`selectionBbox` 字段由目标集合计算写入）。

从此两模式交互语义一致、关联来源一致，仅轮廓呈现不同。

### 2.5 保存后的关联编辑（Phase 2）

`AnnotationPanel` 云线详情增加「关联元素」区块：

- 列表显示每个绑定元素（refno + noun + 解析状态），支持单个移除；
- 「添加元素」重新进入 `selecting_targets`（增量模式）；
- 「重绑锚点」重新进入 pick 锚点态，只替换 anchor 不动 members；
- 所有编辑通过 store action 落到 record，随既有校审记录链路保存。

---

## 3. 数据模型设计（记录 schema V7）

> **命名口径（2026-07-28 复核）**：下文的「V7」指 **`CloudAnnotationRecord` 记录 schema 的代次标签**，
> **不是** localStorage 持久化容器的版本号。容器版本保持 `PersistedStateV6` 不变，理由见 §3.3。

### 3.1 新增类型

```ts
export type CloudBindingRole = 'anchor' | 'member';

export type CloudElementBinding = {
  refno: string;
  role: CloudBindingRole;
  noun?: string;              // 创建时快照，便于列表显示与过滤
  designPosition?: Vec3;      // 设计坐标快照（失效检测/重绑参考）
  createdAt: number;
};

export type CloudResolveState = 'resolved' | 'stale' | 'missing' | 'unloaded';

export type CloudBindingResolve = {
  state: CloudResolveState;
  checkedAt?: number;
  staleReason?: string;
};
```

### 3.2 `CloudAnnotationRecord` 演进原则：**只增不改，不搬字段**

在现有 record 上新增：

```ts
export type CloudAnnotationRecord = {
  // ……现有全部字段原样保留（anchorWorldPos / anchorRefno / screenOffset /
  //   cloudSize / refnos / objectIds / selectionBbox / …）……

  /** V7：带角色的关联结构，权威字段；缺失时由 refnos/anchorRefno 推导 */
  bindings?: CloudElementBinding[];
  /** V7：锚点设计坐标快照（anchorWorldPos 继续作为渲染坐标） */
  anchorDesignPos?: Vec3;
  /** V7：关联解析状态（运行时刷新，持久化最后一次结果） */
  resolve?: CloudBindingResolve;
};
```

> 注：外部评审稿曾建议把 `screenOffset/cloudSize` 重组为 `screenLayout`。**不采纳**——
> 渲染链每帧读取这两个字段，改名属于破坏性搬家，收益不抵风险；V7 只做增量。

### 3.3 迁移与兼容（2026-07-28 复核修正：**不升容器版本**）

初稿写的是「localStorage V6 → V7」。复核读写链路后确认**不需要新增 `PersistedStateV7`**：

- **读只有一个漏斗**：`normalizeCloudAnnotationRecord` 覆盖全部恢复路径——
  localStorage 的 V3/V4/V5/V6 分支（`normalizeV3/V4/V5/V6Bridge` 都 map 到它）；
  三条校审恢复链路（task_records / workflow_sync / import_package）经
  `toolStoreAdapter` → `buildReviewRecordReplayPayload` → `store.importJSON`
  → `normalizeV*`，同样汇入它。
- **写也只有一个漏斗**：`addCloudAnnotation`（`useToolStore.ts:1518`）调用同一函数。
- 因此 `bindings` 的派生逻辑**只写进 `normalizeCloudAnnotationRecord` 一处即可全覆盖**。
  真去新增容器 V7 需要一个新 storage key + 改写 6 个 normalizer，换不到功能收益，**不做**。

落地规则：

- 读取时 `normalizeCloudAnnotationRecord` 补齐——`bindings` 缺失时由 `refnos[]`（role=member）
  \+ `anchorRefno`（role=anchor）推导；`resolve` 缺省 `{ state: 'resolved' }`。
  **不回写、不修改旧数据**；持久化仍写 `version: 6`。
- V1–V5 历史链路不变（本就不含 cloud 或经既有 normalize 兜底）。
- 校审记录 payload：新旧字段并存（superset），旧客户端仍读 `refnos`，新客户端优先 `bindings`。
- `ReviewSnapshot`：**superset 已实测成立**——`normalizeReplayRecords` 与 `injectContextIntoItems`
  均整对象展开（`...record`），`dedupeReplayItems` 保留整对象，`buildReviewRecordReplayPayload`
  原样序列化。`bindings` 无需任何 adapter 改动即可穿过三条恢复链路；adapter 侧只需补
  round-trip 测试锁住这一行为。

---

## 4. 存储设计

### 4.1 方向评估与推荐

| 方向 | 说明 | 评估 |
|------|------|------|
| A：payload 内嵌 + 后端投影索引 | 批注仍存于校审记录 JSON；写入时后端解析 bindings 同步到投影表 | 改动小、兼容 ReviewSnapshot、索引可随时全量重建；一致性靠同步（可重建兜底） |
| B：一等关联表 | annotation 与 binding 拆为独立表 | 反查天然，但离线导入/快照/三链路恢复全要重做，破坏 payload superset 惯例 |

**推荐：A + 预留 B。** 当前批注体系围绕「payload superset + 三类恢复入口」构建，
方向 B 的收益（强一致反查）可由投影索引 + 可重建性覆盖。

### 4.2 后端投影表（Phase 4）

```sql
-- annotation_binding_projection（可整表重建）
annotation_id    text      -- 批注 id
annotation_type  text      -- 'cloud'（预留 text/rect/obb 复用）
refno            text      -- 关联元素
role             text      -- 'anchor' | 'member'
task_id          text      -- 校审任务
review_round     int       -- 校审轮次
created_at       timestamp
-- 索引：(refno) 反查；(annotation_id) 正查；(task_id, review_round) 范围清理
```

写入时机：`POST /api/review/records` 保存 payload 后，同步解析 cloud bindings 更新投影；
离线导入包（import_package）在导入落库时执行同一解析；提供管理端「重建投影」任务兜底。

### 4.3 API 草案

云线创建**不新开独立端点**，沿用现有校审记录写入链路（payload 内含 V7 字段）。新增：

```
GET /api/review/elements/{refno}/annotations?type=cloud&taskId=...
→ 200
[
  { "id": "cloud-001", "annotationType": "cloud", "title": "阀门与管线间距不足",
    "severity": "serious", "reviewState": "open", "taskId": "t-1", "reviewRound": 2,
    "role": "member" }
]

PATCH /api/review/annotations/{annotationId}/bindings?type=cloud
{ "add": [ { "refno": "=24381/145020", "role": "member" } ],
  "remove": [ "=24381/145019" ],
  "rebindAnchor": { "refno": "=24381/145018" } }   // 可选
→ 200 { "ok": true, "bindings": [ ...最新完整列表... ] }
```

行为约定：三条恢复链路（task_records / workflow_sync / import_package）都以 payload
为权威来源恢复 bindings；投影索引仅服务反查/统计，不参与恢复。

---

## 5. 显示设计

### 5.1 双向联动

- 云线 → 元素（保持并增强）：「定位」「高亮」逻辑不变；一对多时详情区增加
  **逐元素导航**（`1/5 · 下一个 ▸`，对单个 refno 做 ensure + select + flyTo）。
- 元素 → 云线（Phase 4）：点选模型元素或模型树节点 → 先查本地 store（当前会话
  内存索引 `Map<refno, cloudId[]>`），再查后端反查 API → 面板按元素过滤云线列表，
  视口中命中的云线轮廓做强调（加粗/闪烁一次）。

### 5.2 失效降级（对齐尺寸系统「失效尺寸」模式）

| 状态 | 判定 | 表现 |
|------|------|------|
| `unloaded` | refno 合法但模型未加载 | 正常显示云线；「高亮」时先 `showModelByRefnos` 触发按需加载 |
| `missing` | 元素在当前模型版本中已删除 | 云线灰显 + 列表警示「⚠ 元素不存在」；仅允许移除绑定或重绑 |
| `stale` | refno 无法解析/锚点无法重定位 | 按最后 `anchorWorldPos` 显示 + `STALE` 标签；只允许重绑或删除 |

解析入口 `resolveCloudBindings()`：模型加载完成、版本切换、打开批注面板时批量执行，
结果写入 `record.resolve`（带 `checkedAt`）。

### 5.3 视觉语义（已确认：徽标方案）

事实核实：云线轮廓颜色是**用户可配置项**（`useAnnotationStyleStore.ts`，默认红
0xef4444，含 soft/clear/bold 三套预设）。因此 severity **不接管轮廓颜色**：

- 轮廓颜色继续归样式面板管理（用户配置优先）；
- severity（致命=红、严重=橙、一般=黄、建议=蓝）通过**图钉着色 / 详情徽标 /
  列表色点**表达；reviewState 用图标/徽标表达。
- 颜色通道互不打架：轮廓=用户样式，图钉/徽标=严重度，图标=校审状态。

### 5.4 性能要点

- 禁止每帧 `getAABB(refnos)`：新增 `Map<refno, AABB>` 缓存，模型增删时失效对应项；
- `ensureRefnos` 调用先去重合并（`unique(refnos)` 批量一次）；
- 云线数量分级：< 500 全量每帧重建；500–2000 仅重建 `visible === true`；
  > 2000 列表完整显示但视口仅渲染选中/激活云线（LOD）。

---

## 6. 落地计划

> 本期 = Phase 1 + Phase 2（已确认）；Phase 3/4 后置，另行排期。

### Phase 1 — MVP（满足计划表验收）【本期】

- 落点：`useToolStore.ts`（记录 schema V7 类型 + `normalizeCloudAnnotationRecord`
  派生 bindings + pendingTargets 状态与 action，**不新增容器版本**）、`useDtxTools.ts`
  （创建状态机：select targets → pick anchor → draw；`beginMarquee` 集中闸门；
  框选与关联解耦；候选确认列表；bbox3d 模式改用目标集合 AABB）、
  `src/components/tools/AnnotationPanel.vue`（目标列表显示、一对多导航、severity 徽标）。
- 四个工具入口（见 §2.1 表）本身**不改校验逻辑**，只需在无目标时让状态条呈现工具层给出的提示。
- 验收（Vitest 纯函数）：V6 record 读取推导出正确 bindings；新建 record 的
  anchor/bindings 正确；框选只影响 screenOffset/cloudSize；未选目标不允许创建。
- 验收（Playwright e2e，**复用 `bran_24381_145018` 既有模型 fixture**）：
  选择元素（点选 + 框选候选确认）→ 画云线 → 保存 → 列表点「定位」「高亮」→
  断言相机 AABB 与 selected 状态 + 截图回归；一对一与一对多各一条用例。

### Phase 2 — 关联编辑【本期】

- `AnnotationPanel` 关联元素区块：增删元素、重绑锚点。
- 保存链路（已确认）：**纯前端**——编辑 store record，随既有校审记录整体保存链路；
  PATCH bindings API 留到 Phase 4 与后端一并排期。
- 验收：删除一个 refno 保存后重新载入不回弹；重绑锚点后云线跟随新锚点。

### Phase 3 — 失效治理【后置】

- `resolveCloudBindings()` + 三态降级显示 + `STALE` 标签；模型版本切换钩子；
  模型树勾选入口一并纳入。
- 验收：构造 refno 不存在 fixture → 显示 missing/stale 降级；unloaded 时高亮触发按需加载。

### Phase 4 — 元素反查（工程完备）【后置】

- 后端投影表 + 反查 API + PATCH bindings API + 重建任务；
  前端「元素 → 云线」联动与模型树徽标。
- 验收：点击模型元素显示其全部关联云线；重建投影后结果一致。

### 风险与回退

| 风险 | 影响 | 回退策略 |
|------|------|----------|
| payload 新字段影响旧端 | 历史记录解析异常 | 只增不改 + 保留 refnos 双写，旧端按旧字段读 |
| 投影索引与 payload 不同步 | 反查结果错误 | 投影可整表重建；payload 永远是权威 |
| 旧云线无 bindings/anchor 快照 | 位置/关联缺失 | normalize 推导 + 按 anchorWorldPos 显示 |
| 大量云线性能下降 | 帧率下降 | AABB 缓存 + 分级渲染（LOD）回退 |
| 模型版本变化漂移 | 云线悬空 | STALE 降级，只允许重绑/删除 |

---

## 7. 完成标准（对照计划表）

- 绘制云线前必须先显式选择目标模型元素（本期三入口任一：点选/框选确认/选择集导入），
  未选目标不允许进入绘制；
- 云线保存后，列表与详情可对关联元素**定位并高亮**，一对一与一对多行为一致且一对多可逐元素导航；
- 关联结构随校审记录持久化（bindings），V1–V6 历史数据与既有校审记录 payload 兼容读取；
- 单测 + 类型检查 + e2e 截图回归（bran_24381_145018 fixture）通过。

---

## 附录：设计决策记录（2026-07-28 grilling 定稿）

| # | 决策点 | 结论 | 答复方式 |
|---|--------|------|----------|
| 1 | 本期交付范围 | Phase 1+2，后端不动 | 手动确认 |
| 2 | 目标选择入口 | 点选 + 框选候选确认 + 选择集导入；模型树后置 | 超时授权采纳推荐 |
| 3 | 框选确认交互 | 一律弹候选列表：默认全勾、noun 分组、Enter 确认 | 超时授权采纳推荐 |
| 4 | 锚点与目标关系 | 允许解耦，锚点可不在目标集合内 | 手动确认 |
| 5 | bindings 结构 | 统一数组含 role:'anchor'\|'member'，旧字段双写 | 手动确认 |
| 6 | 未选目标绘制 | 禁止，状态条提示 | 手动确认 |
| 7 | severity 视觉 | 徽标方案：轮廓色归样式面板，severity 用图钉/徽标/色点 | 手动确认 |
| 8 | bbox3d 模式 | 与 screen2d 统一流程，bbox3d 用目标集合合并 AABB | 手动确认 |
| 9 | Phase 2 保存链路 | 纯前端，随既有校审记录保存；PATCH API 留 Phase 4 | 手动确认 |
| 10 | e2e 验收 | 复用 bran_24381_145018 fixture，一对一+一对多用例+截图回归 | 手动确认 |

## 附录：实施前代码复核修正（2026-07-28）

定稿后按实施口径重新核对代码，修正三处与真实代码不符的表述：

| # | 初稿表述 | 修正 | 依据 |
|---|----------|------|------|
| A | Phase 1 UI 落点只列 `AnnotationPanel.vue` | 进入云线工具有四个入口，闸门必须集中在 `useDtxTools.beginMarquee` | 见 §2.1 入口表 |
| B | localStorage `V6 → V7` 容器版本升级 | 不升容器版本；`bindings` 派生只写进 `normalizeCloudAnnotationRecord` 即全覆盖 | 读写各只有一个漏斗，见 §3.3 |
| C | payload superset 不丢字段（假设） | 已实测成立，无需 adapter 改动 | replay 链路整对象展开，见 §3.3 |
