# RUS-238 测量路径验收与批注证据后续开发计划

> 日期：2026-04-30
> 状态：待执行
> 上游计划：`2026-04-30-rus-238-measurement-path-ui-integration-dev-plan.md`
> 当前基础：测量列表、确认测量回放与批注测量证据均已接入 `useMeasurementPathSummaries`，并保留同步 refno fallback

## 1. 当前状态

已完成：

- `measurementDisplay.ts` 提供同步 refno fallback formatter。
- `measurementPathLookup.ts` 提供只读完整路径查询、缓存和失败 fallback。
- `useMeasurementPathSummaries.ts` 提供 UI 层异步 summary：
  - 初始显示 `formatMeasurementPath()`。
  - lookup resolved 后显示完整路径。
  - lookup 失败继续显示 refno fallback。
- `MeasurementPanel.vue` 已接入测量列表完整路径展示。
- `TaskReviewDetail.vue` 已接入确认测量回放完整路径展示。
- `AnnotationWorkspace.vue` 已接入批注测量证据完整路径展示。

待收敛：

- 真实模型数据下 lookup resolved 的展示文案是否符合业务预期。
- PMS/编校审流程验收仍缺目标 BRAN、包名、角色和环境。

## 2. 下一步目标

- 用真实或可复现数据验证测量列表、确认回放和批注证据三类入口的展示一致性。
- 验证批注测量证据展示层异步完整路径是否符合业务预期。
- 补齐 PMS/编校审验收记录，为 PR 收敛提供可复核证据。
- 明确交付边界：完整路径成功时显示路径，失败时显示 refno，不影响测量定位、隐藏、删除和确认回放。

## 3. 非目标

- 不把完整路径写回确认记录或测量记录。
- 不把 `annotationWorkspaceModel.ts` 改成异步数据模型，除非先完成调用方影响评估。
- 不为了完整路径展示修改测量创建、存储、定位或工作流状态。
- 不在没有真实 PMS 输入的情况下声称 PMS/编校审验收完成。

## 4. 阶段计划

### Phase 0 · 验收输入准备

需要收集：

| 输入 | 用途 |
| --- | --- |
| 目标 BRAN | 创建或打开带测量数据的真实模型 |
| 包名 / 任务单 | PMS/编校审流程定位验收对象 |
| 角色 | 至少覆盖 SJ 发起、JH 校核入口 |
| 样例测量 | 距离、角度、历史确认记录 |
| 页面入口 | 本地三维、仿 PMS、真实 PMS 嵌入页 |

通过条件：

- 验收输入写入 `2026-04-30-rus-238-measurement-path-acceptance-plan.md`。
- 可以复现至少一条距离测量和一条角度测量。

### Phase 1 · 本地真实数据验收

任务：

- 打开本地 `plant3d-web` 页面，加载目标模型。
- 创建距离测量，确认起点、终点展示：
  - 初始 refno fallback 正常。
  - lookup resolved 后完整路径可读。
  - 长路径被截断时 `title` 可查看完整文本。
- 创建角度测量，确认起点、拐点、终点均可 fallback。
- 执行定位、隐藏、恢复、删除，确认行为不受展示增强影响。

通过条件：

- 测量列表不出现 `o:...:0`。
- 完整路径失败时仍显示 `24381/145018` 这类 refno。
- 操作行为无退化。

### Phase 2 · 确认回放验收

任务：

- 生成或打开包含测量证据的确认记录。
- 在 `TaskReviewDetail.vue` 中检查已确认测量回放。
- 对比测量列表和确认回放的同一测量点展示是否一致。
- 验证历史记录缺模型树上下文时仍能 fallback。

通过条件：

- 确认回放不暴露 raw object id。
- 同一测量点在测量列表和确认回放中的展示规则一致。
- 历史记录 lookup 失败不导致空白或报错。

### Phase 3 · 批注测量证据验收

当前 `annotationWorkspaceModel.ts` 仍同步生成 fallback summary：

```ts
const summary = `${measurement.kind === 'angle' ? '角度' : '距离'} · ${formatMeasurementPath(measurement)}`;
```

执行任务：

- 在 `AnnotationWorkspace.vue` 中选择带关联测量的批注。
- 检查批注证据初始 summary 是否仍为 refno fallback。
- lookup resolved 后检查完整路径是否与测量列表一致。
- 确认定位按钮仍使用原有 `LinkedMeasurementItem.id` / `engine`，不受展示增强影响。

通过条件：

- 批注列表加载不引入异步阻塞。
- lookup 失败时仍显示现有 summary。
- 不破坏批注与测量记录的关联、定位、显示/隐藏行为。

### Phase 4 · PMS/编校审验收

任务：

- 从 PMS 或仿 PMS 入口进入三维校审。
- 使用目标 BRAN 创建或打开测量相关记录。
- 发起编校审并生成确认记录。
- 以校核入口重新打开，检查：
  - 测量列表。
  - 批注测量证据。
  - 已确认测量回放。
- 记录包名、BRAN、角色、页面结果和截图。

通过条件：

- PMS/编校审流程中不出现内部 object id。
- 如果完整路径 lookup 成功，展示文案与本地验收一致。
- 如果 lookup 失败，fallback 文案仍可交付。

### Phase 5 · PR 收敛

任务：

- 更新验收计划执行记录。
- 整理验证命令、输入数据和页面结果。
- 在 PR 描述中明确：
  - 哪些入口已完整路径增强。
  - 哪些入口保留 refno fallback。
  - lookup 失败 fallback 行为。
  - PMS/编校审验收结果。
  - 回滚路径。

通过条件：

- 文档、验证记录和代码边界一致。
- 业务确认是否接受批注证据 refno fallback。
- PR 可解释“为什么没有改测量持久化结构”。

## 5. 文件级计划

| 文件 | 下一步 |
| --- | --- |
| `src/components/review/useMeasurementPathSummaries.ts` | 若本地验收发现请求过多，补并发限制或批量 lookup helper |
| `src/components/tools/MeasurementPanel.vue` | 真实数据验收；必要时微调长路径展示位置 |
| `src/components/review/TaskReviewDetail.vue` | 确认回放验收；必要时增加 raw tooltip |
| `src/components/review/annotationWorkspaceModel.ts` | 保持同步 summary，并携带只读测量记录给展示层 |
| `src/components/review/AnnotationWorkspace.vue` | 批注证据展示层复用 `useMeasurementPathSummaries`，继续保留定位行为 |
| `docs/plans/2026-04-30-rus-238-measurement-path-acceptance-plan.md` | 写入验收输入、执行结果和最终交付边界 |

## 6. 验证计划

静态验证：

```bash
npm run type-check
npx eslint "src/components/review/useMeasurementPathSummaries.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

页面验收：

- 本地三维：距离、角度、定位、隐藏、删除。
- 确认回放：历史记录与新确认记录。
- 批注证据：完整路径、fallback 与定位行为。
- PMS/编校审：记录 BRAN、包名、角色、截图和实际展示。

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 批注证据展示层接入后路径不一致 | 三个入口展示不统一 | 复用 `useMeasurementPathSummaries` 并用真实数据验收 |
| 真实模型树路径过长 | 列表可读性下降 | 保留截断和 `title`，必要时改为次级文案 |
| PMS 环境缺数据 | 无法完成验收 | 明确记录阻塞输入，不声称流程已验收 |
| lookup 请求过多 | 页面加载变慢 | 继续依赖缓存，必要时加并发限制 |
| 历史记录缺上下文 | 无法 resolved | fallback 到 refno，避免空白 |

## 8. 推荐执行顺序

1. 收集 BRAN、包名、角色和样例测量。
2. 先做本地真实数据验收，确认测量列表和确认回放展示稳定。
3. 验收批注证据完整路径、fallback 与定位行为。
4. 最后执行 PMS/编校审验收并更新验收计划。

## 9. 执行记录

### 2026-04-30 · 批注证据接入完成

已完成：

- `LinkedMeasurementItem` 增加可选 `pathDisplayId` 和 `measurement`。
- `buildLinkedMeasurementItems()` 继续生成原有 summary，同时把只读测量记录传给展示层。
- `AnnotationWorkspace.vue` 复用 `useMeasurementPathSummaries` 展示批注关联测量完整路径。

已验证：

```bash
npx eslint "src/components/review/annotationWorkspaceModel.ts" "src/components/review/AnnotationWorkspace.vue" "src/components/review/useMeasurementPathSummaries.ts"
npm run type-check
```

结果均通过。
