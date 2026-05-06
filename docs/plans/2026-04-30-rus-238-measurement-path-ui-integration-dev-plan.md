# RUS-238 测量完整路径 UI 接入开发计划

> 日期：2026-04-30
> 状态：执行中，测量列表、确认回放与批注证据已接入
> 上游计划：`2026-04-30-rus-238-measurement-path-followup-plan.md`、`2026-04-30-rus-238-measurement-path-acceptance-plan.md`
> 基础实现：`src/components/review/measurementPathLookup.ts`
> 范围：测量列表、批注测量证据、确认测量回放中的只读展示增强

## 1. 当前结论

RUS-238 已完成第一阶段“规范化 refno 展示”，并新增只读基础模块 `measurementPathLookup`：

- raw `entityId`、DTX object id、历史确认快照中的 refno 已可规范化为 `24381/145018` 这类业务可读格式。
- `resolveMeasurementEntityPath(rawEntityId)` 已能基于 `e3dGetAncestors()` 与 `e3dGetNode()` 查询模型树路径，并在失败时 fallback 到现有 refno 展示。
- 当前尚未接入 UI，因此线上展示行为仍停留在第一阶段，不会因为 lookup 失败影响测量面板、批注或确认回放。

下一步不是直接大改测量记录结构，而是先确认业务是否要求“完整模型树路径”作为主文案或辅助信息。若业务确认需要，再把 `measurementPathLookup` 接入展示层。

## 2. 目标

- 在不修改 `MeasurementRecord` / `XeokitMeasurementRecord` 持久化结构的前提下，为测量点展示补充完整模型树路径。
- 三个入口保持一致：
  - 测量列表：`MeasurementPanel.vue`
  - 批注测量证据：`annotationWorkspaceModel.ts`
  - 确认测量回放：`TaskReviewDetail.vue`
- lookup 未完成或失败时，继续展示第一阶段 refno 文案，不阻塞页面渲染。
- 保留可回滚路径：撤回完整路径 UI 接入时，第一阶段 refno formatter 仍然可交付。

## 3. 非目标

- 不迁移历史确认记录。
- 不把 `displayPath` 反写到测量记录。
- 不重构测量创建、定位、隐藏、删除、确认快照的数据流。
- 不绕过或替换现有测量定位逻辑。
- 不在业务未确认前默认把完整路径作为所有入口的主文案。

## 4. 前置决策

执行开发前需要确认以下决策：

| 决策项 | 选项 | 建议 |
| --- | --- | --- |
| 主文案 | 仅 refno / 完整路径 / 名称 + refno | 若路径较长，主文案保留 refno 或 leaf name，完整路径放次级文案或 tooltip |
| tooltip | 无 / raw entityId / 完整路径 + raw | 建议 tooltip 同时包含完整路径与 raw `entityId`，便于排查 |
| lookup 时机 | 页面打开即查 / 行可见时查 / 用户展开时查 | 首版建议页面打开后异步批量触发，UI 先显示 fallback |
| 失败展示 | 静默 fallback / 显示错误徽标 | 建议静默 fallback，诊断信息仅放开发日志或 tooltip |
| PMS 验收范围 | 不覆盖 / 人工截图 / CDP 自动化 | 若本次 PR 声明覆盖 PMS，必须记录 BRAN、包名、角色和页面结果 |

若业务确认“规范化 refno 已满足交付”，本计划后续 UI 接入阶段应暂停，仅执行真实流程验收和 PR 收敛。

## 5. 推荐实现方案

### Phase 0 · 确认展示契约

任务：

- 准备 3 组样例给业务确认：
  - `24381_145018` -> `24381/145018`
  - `o:24381_145018:0` -> `24381/145018`
  - lookup resolved -> `区域 / 管线 / 24381/145018` 或对应模型树名称链
- 明确测量列表、批注 summary、确认回放三处展示规则。
- 明确 tooltip 是否展示 raw `entityId`。

通过条件：

- 有可写入 PR 描述的一句话展示结论。
- 明确是否继续执行 Phase 1-3。

### Phase 1 · 统一异步展示模型

任务：

- 新增轻量 view model helper，负责把同步 formatter 与异步 lookup 结果组合起来。
- 推荐输出结构：

```ts
export type MeasurementPathDisplayPoint = {
  rawEntityId: string;
  fallbackLabel: string;
  displayLabel: string;
  displayPath: string;
  status: 'fallback' | 'loading' | 'resolved' | 'error';
};
```

- 对距离和角度统一输出：
  - 距离：起点、终点
  - 角度：起点、拐点、终点
- 初始值必须由 `formatMeasurementPath()` 生成，lookup 返回后再替换展示细节。

通过条件：

- 三个 UI 入口可以复用同一套点位展示模型。
- lookup 失败不会改变现有 refno fallback。
- 不需要修改测量记录类型。

### Phase 2 · 接入测量列表

任务：

- 在 `MeasurementPanel.vue` 中为可见测量记录触发 `resolveMeasurementEntityPath()`。
- 使用组件级缓存保存 `record.id + pointKey -> result`，避免每次渲染重复 promise。
- UI 先展示现有 `formatMeasurementPath(record)`。
- resolved 后按 Phase 0 决策展示完整路径或 tooltip。
- 组件卸载或模型切换时调用 `clearMeasurementPathLookupCache()` 或清理组件级状态。

通过条件：

- 打开测量面板不等待 lookup。
- 列表中距离和角度都能显示一致文案。
- 定位、隐藏、删除、清空测量行为不退化。

### Phase 3 · 接入批注测量证据与确认回放

任务：

- `annotationWorkspaceModel.ts` 当前是同步模型构造，首版不应在这里直接 `await` lookup。
- 建议把批注 summary 继续保留 refno fallback，并在展示组件层补充异步完整路径。
- 若必须在 summary 内展示完整路径，需要先把测量证据构造改成异步流程，并评估所有调用方影响。
- `TaskReviewDetail.vue` 可按确认记录加载完成后触发 lookup，并在回放卡片中展示完整路径或 tooltip。

通过条件：

- 批注 summary 和确认回放至少保持第一阶段 refno 一致。
- 完整路径增强不会让批注列表加载变慢或出现空白。
- 历史确认记录缺少模型树上下文时仍正常 fallback。

### Phase 4 · PMS/编校审验收

任务：

- 获取目标 BRAN、包名、角色和验收环境。
- 覆盖至少一条距离测量和一条角度测量。
- 从 PMS 或仿 PMS 入口进入三维校审，检查测量列表、批注证据、确认回放。
- 记录：
  - 输入 BRAN / 包名
  - 当前角色
  - 页面入口
  - 实际展示文本
  - 是否出现 `o:...:0` 或内部 object id

通过条件：

- PMS/编校审流程不暴露内部 object id。
- 历史确认记录展示与测量列表一致。
- 若完整路径为交付项，真实流程中至少有一处 resolved 成功证据。

### Phase 5 · 收敛与回滚

任务：

- 更新 `2026-04-30-rus-238-measurement-path-acceptance-plan.md` 的执行记录。
- 在 PR 描述中写清楚：
  - 展示规则
  - 影响入口
  - 验证命令
  - PMS/编校审验收结果
  - fallback 和回滚说明
- 回滚时只撤回 UI 接入与异步状态，保留 `measurementDisplay` 的 refno formatter 修复。

通过条件：

- 业务确认、真实数据验收、风险说明齐全。
- 没有修改测量持久化结构。

## 6. 文件级改动计划

| 文件 | 计划 |
| --- | --- |
| `src/components/review/measurementPathLookup.ts` | 保持只读 lookup 边界，必要时补充并发限制或批量 helper |
| `src/components/review/measurementDisplay.ts` | 保留同步 fallback formatter，避免引入异步依赖 |
| `src/components/tools/MeasurementPanel.vue` | 首个 UI 接入口，增加异步 lookup 状态和 tooltip / 次级文案 |
| `src/components/review/annotationWorkspaceModel.ts` | 默认不改为异步；仅保留 fallback summary，完整路径放展示层处理 |
| `src/components/review/TaskReviewDetail.vue` | 对确认记录回放补充异步 lookup 展示 |
| `docs/plans/2026-04-30-rus-238-measurement-path-acceptance-plan.md` | 记录业务确认和执行结果 |

## 7. 验证计划

优先使用静态检查、真实页面和可复核流程验证：

```bash
npm run type-check
npx eslint "src/components/review/measurementPathLookup.ts" "src/components/review/measurementDisplay.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/annotationWorkspaceModel.ts" "src/components/review/TaskReviewDetail.vue"
```

人工或 CDP 验收：

- 打开测量面板，确认 lookup 前后文案稳定。
- 创建距离和角度测量，确认起点、拐点、终点都可 fallback。
- 在批注中关联测量证据，确认 summary 不暴露内部 ID。
- 打开确认记录回放，确认历史快照展示一致。
- PMS/编校审如纳入交付，记录 BRAN、包名、角色和页面截图。

如后续确需自动化覆盖，应优先扩展现有最小范围组件验证，避免新增与真实流程脱节的大型测试。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 路径查询 N+1 | 测量列表加载慢 | 使用 lookup 缓存，必要时增加并发限制或批量 helper |
| 模型树数据源不可用 | 完整路径无法 resolved | 始终展示 refno fallback，不阻塞 UI |
| 路径过长 | 列表可读性下降 | 主文案保守，完整路径放 tooltip 或次级文案 |
| 批注 summary 同步构造 | 难以直接 await lookup | 保持 summary fallback，把异步增强放展示组件 |
| 历史记录缺 raw 上下文 | 无法补全完整路径 | 展示第一阶段 refno，tooltip 标注 raw 值 |

## 9. 下一步执行顺序

1. 先拿到展示文案和 PMS 验收输入。
2. 如果 refno 已可交付，只执行真实流程验收和 PR 收敛。
3. 如果需要完整路径，先实现 Phase 1 的统一异步展示模型。
4. 优先接入 `MeasurementPanel.vue`，确认性能与交互没有退化。
5. 再评估批注证据和确认回放是否按同一模型接入。
6. 最后执行 PMS/编校审验收，并更新验收计划执行记录。

## 10. 执行记录

### 2026-04-30 · 最小 UI 接入

已完成：

- 新增 `src/components/review/useMeasurementPathSummaries.ts`：
  - 统一抽取距离/角度测量点。
  - 初始展示复用 `formatMeasurementPath()` fallback。
  - 异步调用 `resolveMeasurementEntityPath()` 后替换为 `displayPath`。
  - 按记录 ID、点位和 raw `entityId` 缓存展示结果。
- `src/components/tools/MeasurementPanel.vue` 已接入：
  - 测量列表先显示 refno fallback。
  - lookup resolved 后显示完整路径。
  - summary `title` 同步使用最终展示文本，便于查看被截断的长路径。
- `src/components/review/TaskReviewDetail.vue` 已接入：
  - 确认测量回放按确认记录 ID + 测量 ID 生成稳定 lookup key。
  - 历史记录 lookup 失败时继续显示 refno fallback。

后续补充：

- 批注测量证据已按计划在展示层接入完整路径：
  - `annotationWorkspaceModel.ts` 只额外携带原始测量记录和稳定 `pathDisplayId`。
  - `AnnotationWorkspace.vue` 复用 `useMeasurementPathSummaries` 异步替换 summary。
  - lookup 失败时继续显示原有 summary fallback。

已验证：

```bash
npx eslint "src/components/review/useMeasurementPathSummaries.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
npm run type-check
```

结果均通过。
### 2026-04-30 · 批注证据展示层接入

已完成：

- 扩展 `LinkedMeasurementItem`，增加可选 `pathDisplayId` 和 `measurement` 字段。
- `buildLinkedMeasurementItems()` 保留原有 `summary`，同时把只读测量记录传给展示层。
- `AnnotationWorkspace.vue` 对批注关联测量复用 `useMeasurementPathSummaries`：
  - 初始展示原有 summary。
  - lookup resolved 后显示完整路径 summary。
  - summary `title` 同步使用最终展示文本。

已验证：

```bash
npx eslint "src/components/review/annotationWorkspaceModel.ts" "src/components/review/AnnotationWorkspace.vue" "src/components/review/useMeasurementPathSummaries.ts"
npm run type-check
```

结果均通过。
