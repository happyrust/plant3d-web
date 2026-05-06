# RUS-238 下一步验收执行计划

> 日期：2026-04-30
> 状态：待执行
> 上游计划：`2026-04-30-rus-238-measurement-path-followup-plan.md`
> 范围：测量路径展示文案确认、真实数据验收、PMS/编校审流程记录

## 1. 目标

本计划用于推进 RUS-238 第一阶段修复后的下一步交付验收，目标是回答两个问题：

- 当前“统一 refno 展示”的修复是否已经满足业务交付。
- 如果不满足，完整模型树路径增强需要哪些数据源、接口和 UI 展示规则。

## 2. 需要的输入

| 输入 | 说明 | 负责人 |
|------|------|--------|
| 展示文案选择 | 仅 refno / 完整模型树路径 / refno + tooltip/raw 信息 | 业务或产品 |
| 目标 BRAN | 用于 PMS 和编校审验收的数据编号 | 业务或测试 |
| 测量样例 | 至少包含距离、角度、历史确认记录三类数据 | 开发或测试 |
| 验收环境 | 本地页面、PMS 嵌入页面或 CDP 自动化环境 | 开发或测试 |

缺少以上输入时，不应直接进入完整路径实现，以免把展示文案和数据源假设固化到代码里。

## 3. 执行步骤

### Step 1 · 展示文案确认

准备 3 组样例给业务确认：

| 场景 | 原始值 | 当前展示 | 待确认 |
|------|--------|----------|--------|
| classic refno | `24381_145018` | `24381/145018` | 是否可交付 |
| DTX object id | `o:24381_145018:0` | `24381/145018` | 是否隐藏尾部 idx |
| 历史确认记录 | 旧 raw `entityId` | 规范化 refno | 是否需要 raw tooltip |

输出：

- 一句话结论：第一阶段可交付，或需要完整路径增强。
- 主文案、tooltip、详情页三处展示规则。

### Step 2 · 本地真实数据验收

在 `plant3d-web` 页面中完成：

- 创建距离测量，检查起点和终点展示。
- 创建角度测量，检查起点、拐点、终点展示。
- 在批注中关联测量证据，检查 summary 展示。
- 打开确认记录回放，检查历史测量快照展示。
- 点击测量定位、隐藏、删除，确认行为不受展示 formatter 影响。

建议记录：

- 输入模型或 BRAN。
- 测量类型。
- 页面入口。
- 实际展示文本。
- 是否出现内部 object id。

### Step 3 · PMS/编校审流程验收

如本次交付需要覆盖 PMS 入口，执行：

- 从 PMS 页面进入三维编校审。
- 使用目标 BRAN 创建或打开测量相关记录。
- 发起编校审并生成确认记录。
- 回到 PMS 或校核入口，检查测量路径展示。
- 记录包名、BRAN、角色、页面结果和截图。

通过条件：

- PMS/编校审流程中不再出现 `o:...:0` 这类内部 ID。
- 历史确认记录展示与测量列表一致。
- 校核入口可正常回放测量证据。

### Step 4 · 完整路径增强决策

如果业务明确要求完整模型树路径，进入技术设计：

- 确认 refno 到模型树路径的数据源。
- 设计只读查询封装，不反写 `MeasurementRecord`。
- 设计缓存策略，避免列表重复查询。
- 定义失败 fallback：路径缺失时展示规范化 refno。
- 明确 tooltip 是否保留 raw `entityId`。

如果业务确认 refno 已满足交付，则跳过完整路径增强，进入 PR 收敛。

## 4. 验证命令

当前阶段只要求静态验证，不运行测试命令：

```bash
npm run type-check
npx eslint "src/components/review/measurementDisplay.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

已在 2026-04-30 执行并通过。

## 5. 验收标准

- 业务确认测量路径最终展示文案。
- 真实数据下距离、角度、批注测量证据、确认回放四类入口展示一致。
- PMS/编校审流程如纳入交付范围，需有可复核的页面结果。
- 不改变测量记录持久化结构。
- 若进入完整路径增强，先完成数据源与查询方案评审。

## 6. 当前状态

已完成：

- 创建后续计划文件。
- 运行 `npm run type-check`，通过。
- 运行定向 ESLint，通过。
- 完成完整路径增强的前置技术预研。
- 新增只读基础模块 `src/components/review/measurementPathLookup.ts`，提供 refno 路径查询、缓存和 fallback；暂未接入 UI。

待推进：

- 获取展示文案确认。
- 获取 PMS/编校审验收输入。
- 根据确认结果决定是否把 `measurementPathLookup` 接入测量列表、批注测量证据和确认回放。

## 7. 技术预研记录

### 7.1 可复用能力

- `src/api/genModelE3dApi.ts`
  - `e3dGetNode(refno)` 可返回 `TreeNodeDto`，包含 `refno`、`name`、`noun`、`owner`。
  - `e3dGetAncestors(refno)` 可返回祖先 refno 列表。
  - `e3dGetChildren(refno)`、`e3dGetSubtreeRefnos(refno)` 已用于模型树加载和可见实例范围查询。
- `src/api/genModelE3dParquetApi.ts`
  - Parquet 数据源下也有 `e3dParquetGetNode()`、`e3dParquetGetAncestors()`、`e3dParquetGetChildren()`，能从 `pdms_tree` parquet 中读取 `name`、`noun`、`owner_refno_str`。
- `src/composables/usePdmsOwnerTree.ts`
  - `focusNodeById()` 已使用 `e3dGetAncestors()` 展开模型树并定位节点。
  - 该 composable 内部维护 `nodesById`，但没有暴露通用的“refno -> 完整显示路径”查询方法。
- `src/composables/useDbnoInstancesDtxLoader.ts`
  - 已缓存 `refno -> noun`、`refno -> owner_refno`、`refno -> owner_noun`、`refno -> spec_value`。
  - 该缓存依赖已加载实例，适合作为 fallback 或局部补充，不适合作为全量路径事实源。

### 7.2 建议技术方案

若业务确认需要完整模型树路径，建议新增只读 lookup 层，而不是把路径逻辑塞进同步 formatter：

- 使用 `src/components/review/measurementPathLookup.ts`。
- 输入 raw `entityId`，先复用或抽出 `measurementDisplay` 的 refno 规范化逻辑。
- 对规范化 refno 做内存缓存，缓存项包含：
  - `refno`
  - `displayName`
  - `displayPath`
  - `rawEntityId`
  - `lookupStatus`
- 查询流程：
  1. `e3dGetAncestors(refno)` 获取祖先 refno。
  2. 将祖先 refno 与自身 refno 合并去重。
  3. 批量或并发限制调用 `e3dGetNode(refno)` 获取 `name`、`noun`、`owner`。
  4. 用 `owner` 关系重建 root -> leaf 顺序，避免依赖祖先接口返回顺序。
  5. 以 `name || refno` 生成展示路径，失败时 fallback 到规范化 refno。
- UI 接入时保持主记录不可变：
  - 测量列表、批注测量证据、确认回放只读使用 lookup 结果。
  - lookup 未完成时先展示当前 refno 文案。
  - lookup 失败时不报错、不阻塞面板。

### 7.3 风险

- `e3dGetAncestors()` 的返回顺序在 backend 与 parquet 数据源下可能不同，不能直接拼接成路径。
- `e3dGetNode()` 对多个测量点逐个查询可能造成 N+1 请求，需要缓存和并发限制。
- `useDbnoInstancesDtxLoader` 的 owner 缓存只覆盖已加载对象，不能作为历史确认记录的完整路径来源。
- `InstanceEntry.uniforms.name` 在 Parquet 查询路径中当前为空，不能直接依赖实例缓存展示名称。
- 完整路径依赖模型树数据源可用；不可用时必须 fallback 到第一阶段已经实现的 refno 展示。

### 7.4 基础实现记录

已新增 `measurementPathLookup.ts`：

- `resolveMeasurementEntityPath(rawEntityId)`：
  - 复用 `normalizeMeasurementEntityId()` 解析 raw `entityId`。
  - 非 PDMS refno 直接返回 fallback。
  - 调用 `e3dGetAncestors()` 与 `e3dGetNode()` 获取祖先和节点信息。
  - 通过 `node.owner` 重建 root -> leaf 路径，避免依赖 ancestors 返回顺序。
  - 失败时返回当前 refno 展示，不抛给 UI。
- `clearMeasurementPathLookupCache()`：
  - 提供缓存清理入口，供后续 UI 生命周期或测试使用。

验证：

```bash
npx eslint "src/components/review/measurementPathLookup.ts"
npm run type-check
```

结果均通过。

未完成：

- 已把完整路径展示接入测量列表、确认测量回放和批注测量证据；三处均保留 refno fallback。
- 尚未执行 PMS/编校审真实流程验收。

### 2026-04-30 · UI 接入执行

已完成：

- 新增 `src/components/review/useMeasurementPathSummaries.ts`，统一提供测量路径异步展示 summary。
- `src/components/tools/MeasurementPanel.vue` 接入完整路径 lookup：
  - 初始仍显示 `formatMeasurementPath()` refno fallback。
  - resolved 后显示 `measurementPathLookup` 返回的完整路径。
  - summary 的 `title` 展示同一文本，避免长路径截断后无法查看。
- `src/components/review/TaskReviewDetail.vue` 接入确认测量回放完整路径 lookup。

边界：

- `annotationWorkspaceModel.ts` 仍保持同步 summary 构造，仅携带原始测量记录给展示层；批注证据在 `AnnotationWorkspace.vue` 中异步接入完整路径。
- lookup 失败、模型树数据不可用或历史记录缺上下文时，UI 继续展示 refno fallback。

验证：

```bash
npx eslint "src/components/review/useMeasurementPathSummaries.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
npm run type-check
```

结果均通过。

### 2026-04-30 · 批注证据展示层接入

已完成：

- 扩展 `LinkedMeasurementItem` 的可选字段 `pathDisplayId` 与 `measurement`。
- `AnnotationWorkspace.vue` 对关联测量证据复用 `useMeasurementPathSummaries`。
- 批注测量证据初始显示原有 summary，lookup resolved 后显示完整路径，失败时继续 fallback。

验证：

```bash
npx eslint "src/components/review/annotationWorkspaceModel.ts" "src/components/review/AnnotationWorkspace.vue" "src/components/review/useMeasurementPathSummaries.ts"
npm run type-check
```

结果均通过。
