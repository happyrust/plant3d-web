# RUS-238 测量路径显示闭环开发计划

> 日期：2026-04-30  
> 状态：待执行  
> 关联问题：RUS-238 `测量数据路径显示问题`  
> 上游文档：
> - `docs/plans/2026-04-29-rus-238-measurement-path-display-plan.md`
> - `docs/plans/2026-04-30-rus-238-measurement-path-followup-plan.md`
> - `docs/plans/2026-04-30-rus-238-measurement-path-acceptance-plan.md`

## 1. 当前判断

RUS-238 目前不能直接关闭，只能判定为“第一阶段展示修复已完成”。

已完成部分：

- `measurementDisplay` 已统一测量点位展示，把 `o:24381_145018:0`、`24381_145018`、`pe:=24381/145018` 等格式展示为 `24381/145018`。
- 测量列表、批注测量证据、确认测量回放已接入统一 formatter。
- 目标 Vitest、`type-check` 和定向 ESLint 已通过。

未闭环部分：

- Linear 仍为 `Backlog`，无验收评论。
- 尚未证明 PMS/编校审真实流程中“关闭后重新进入”可以正确恢复测量线。
- 尚未证明校核人员再次进入时右侧校审记录一定加载成功。
- `measurementPathLookup.ts` 已有完整模型树路径查询基础模块，但尚未接入 UI；是否需要完整路径仍待业务确认。

## 2. 问题拆分

原始工单实际包含三个可独立验收的问题：

| 子问题 | 当前状态 | 验收口径 |
|--------|----------|----------|
| A. 测量路径文本暴露内部 ID | 已修复 | UI 不再展示 `o:...:0`，统一展示 refno |
| B. 重新进入后 3D 测量路径未正确显示 | 待验收/可能待修复 | 关闭校审页后再次进入，场景中能恢复测量线和端点 |
| C. 校核人员右侧无校审记录 | 待验收/可能待修复 | 再次进入同一任务，右侧批注/确认记录/处理记录正常显示 |

本计划的目标是把 B、C 两项补齐，同时决定是否进入完整模型树路径展示增强。

## 3. 目标

- 用真实或可复现的 PMS/编校审流程确认 RUS-238 是否可以关闭。
- 如果 B 或 C 复现，定位到读路径、formId/taskId 作用域、确认记录恢复或评论线程合并中的具体断点。
- 在不改变测量记录持久化结构的前提下修复恢复和展示问题。
- 输出可附到 Linear/PR 的验收证据：角色、任务、BRAN/包名、操作步骤、页面结果、命令结果。

## 4. 非目标

- 不迁移历史确认记录。
- 不把展示路径反写到 `MeasurementRecord`。
- 不重构测量创建、定位、隐藏、删除、确认快照主流程。
- 不在业务未确认前强行把完整模型树路径作为主文案。
- 不用模拟数据替代最终真实流程验收。

## 5. 阶段计划

### Phase 0 · 锁定验收口径

任务：

- 确认本次关闭 RUS-238 的最低标准：
  - 仅要求 refno 展示一致；
  - 或要求完整模型树路径；
  - 或要求 refno 主文案 + raw/完整路径 tooltip。
- 确认目标验收环境：
  - 本地 `plant3d-web`；
  - PMS 嵌入页；
  - CDP 自动化脚本。
- 确认目标数据：
  - BRAN/refno；
  - 包名；
  - 任务 ID 或 PMS 列表记录；
  - 角色：校核、设计，必要时补审核/批准。

通过条件：

- 得到一句话结论：第一阶段可交付，或必须进入完整路径增强。
- 明确后续验收用的目标数据和页面入口。

### Phase 1 · 建立可复现流程

任务：

- 用校核账号进入三维校审页面。
- 创建距离测量和角度测量，并关联至少一个批注。
- 确认或提交后执行驳回。
- 关闭三维校审页面，回到 PMS/任务列表。
- 再次从同一入口进入该任务。
- 记录以下实际结果：
  - 3D 场景中测量线是否恢复；
  - 测量面板是否有记录；
  - 右侧批注/校审记录是否有数据；
  - 批注测量证据 summary 是否展示规范化 refno；
  - Network 中 `review records` / `comments` / `workflow` 接口是否返回数据。

建议记录字段：

| 字段 | 示例 |
|------|------|
| 角色 | JH / SJ |
| BRAN/refno | `24381_145018` |
| 包名 | 真实包名或测试包名 |
| 任务 ID | `task-...` |
| formId | 后端返回或 URL/任务上下文中的 form id |
| 记录接口 | `/api/review/records/by-task/{taskId}` |
| 评论接口 | `/api/review/comments/...` |
| 页面结果 | 有/无测量线，有/无右侧记录 |

通过条件：

- 能稳定复现或稳定证明不可复现。
- 有截图、命令输出或接口返回作为证据。

### Phase 2 · 读路径诊断

若 Phase 1 中测量线或右侧记录缺失，按以下顺序排查。

#### 2.1 确认记录读取

关注文件：

- `src/api/reviewApi.ts`
- `src/components/review/TaskReviewDetail.vue`
- `src/components/review/ReviewPanel.vue`
- `src/components/review/DesignerCommentHandlingPanel.vue`

检查点：

- `reviewRecordGetByTaskId(taskId, { formId })` 是否在相关入口都带上正确 `formId`。
- 不带 `formId` 和带 `formId` 的接口返回是否存在差异。
- 返回的 `records` 中是否包含 `measurements`、`annotations`、`cloudAnnotations`、`rectAnnotations`、`obbAnnotations`。
- 任务再次进入时 `taskId` 是否与创建记录时一致。

可能修复：

- 在需要按表单作用域读取的入口补齐 `formId` 参数。
- 对无 `formId` 的历史记录保持兼容：当前 formId 有值时仍允许未绑定记录参与恢复。
- 在 UI 中暴露加载失败提示，避免右侧静默为空。

#### 2.2 场景恢复

关注文件：

- `src/components/review/confirmedRecordsRestore.ts`
- `src/components/review/reviewRecordReplay.ts`
- `src/components/review/reviewPanelActions.ts`
- `src/composables/useToolStore.ts`

检查点：

- `createConfirmedRecordsRestorer()` 是否在再次进入时被触发。
- `lastRestoredSceneKey` 是否因为 key 未变化而跳过了必要恢复。
- `waitForViewerReady()` 是否在模型未 ready 时超时返回。
- `buildReviewRecordReplayPayload()` 是否把 confirmed record 中的 measurement 正确转入 `xeokitDistanceMeasurements` / `xeokitAngleMeasurements`。
- `toolStore.importJSON()` 后 `tools.syncFromStore()` 是否执行。

可能修复：

- 在任务切换、viewer ready、records 刷新、formId 变化时强制恢复一次。
- 对 viewer 延迟 ready 场景增加二次恢复触发，而不是仅依赖首次 watch。
- 补充恢复失败的调试日志或测试可观察状态。

#### 2.3 右侧记录和评论线程

关注文件：

- `src/components/review/annotationWorkspaceModel.ts`
- `src/components/review/ReviewCommentsPanel.vue`
- `src/components/review/ReviewCommentsTimeline.vue`
- `src/review/services/sharedStores.ts`
- `src/review/adapters/reviewRecordAdapter.ts`

检查点：

- 后端返回的 annotations 是否被 `formId` 过滤掉。
- comments 是否通过 `mergeFromSnapshot()` 进入 comment thread store。
- `sourceAnnotationId` / `sourceAnnotationType` 是否仍能把测量证据关联回批注。
- 设计侧和校核侧入口是否使用同一套 confirmed records restore 逻辑。

可能修复：

- 调整 workspace item scope：当前 formId 命中时展示，历史无 formId 记录可按兼容策略展示。
- 确保任务记录快照中的 comments 合并到读路径真源。
- 为“接口有数据但 UI 为空”补单元测试。

### Phase 3 · 完整路径展示决策

仅在业务明确要求“模型树完整路径”时执行。

现有基础：

- `src/components/review/measurementPathLookup.ts`
  - `resolveMeasurementEntityPath(rawEntityId)`
  - `clearMeasurementPathLookupCache()`
  - 失败 fallback 到规范化 refno。

接入方案：

- 新增只读 view model，不改变原始 measurement。
- 测量列表、批注测量证据、确认回放共享同一个 path display model。
- lookup 未完成时先展示 `formatMeasurementPath()` 的 refno 文案。
- lookup 成功后展示 `displayPath` 或在 tooltip 中展示，按 Phase 0 结论落地。
- lookup 失败时不报错、不阻塞页面。

需要补充测试：

- 非 PDMS refno fallback。
- ancestors 返回顺序不稳定时仍按 owner 链重建路径。
- 查询失败时仍显示 refno。
- 三个入口展示一致。

### Phase 4 · 修复实现

根据 Phase 2/3 的诊断结果，只做最小闭环修改。

优先级：

1. 先修复真实复现的重新进入恢复问题。
2. 再修复右侧记录加载/过滤问题。
3. 最后根据业务确认接入完整路径展示。

禁止事项：

- 不为当前分支未上线行为增加兼容 shim。
- 不把测量路径字符串写回后端。
- 不用全量清空再重建绕过数据作用域问题。

### Phase 5 · 回归验证

命令验证：

```bash
npm run type-check
npx eslint "src/components/review/measurementDisplay.ts" "src/components/review/measurementPathLookup.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/review/confirmedRecordsRestore.ts" "src/components/review/reviewRecordReplay.ts" "src/components/review/reviewPanelActions.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
npm test -- "src/components/review/measurementDisplay.test.ts" "src/components/review/annotationWorkspaceModel.test.ts" "src/components/review/confirmedRecordsRestore.test.ts" "src/components/review/reviewPanelActions.test.ts" "src/components/tools/MeasurementPanel.test.ts" "src/components/review/TaskReviewDetail.test.ts"
```

真实流程验证：

- 校核角色创建测量、驳回、关闭、重新进入。
- 设计角色打开退回任务，确认测量线和右侧记录可见。
- 如涉及审核/批准节点，补跑审核/批准入口的只读回放。
- 记录截图和关键接口返回。

通过条件：

- 重新进入后 3D 测量路径可见。
- 右侧校审记录、批注详情、测量证据均可见。
- 不再展示 `o:...:0` 内部 object id。
- 旧 confirmed record 无需迁移即可展示。
- 定位、隐藏、删除、确认回放不退化。

### Phase 6 · Linear/PR 收敛

任务：

- 在 RUS-238 评论中写明：
  - 修复范围；
  - 验收环境；
  - 角色和目标数据；
  - 命令验证结果；
  - 截图或录屏位置；
  - 已知限制。
- 如果真实流程通过，将 Linear 状态从 `Backlog` 推进到合适状态。
- 如果仍有完整路径需求未做，拆出后续 issue，不阻塞当前 refno 展示修复关闭。

## 6. 建议测试补充

若 Phase 2 发现缺口，优先补以下测试：

- `confirmedRecordsRestore.test.ts`
  - records 在 viewer ready 后延迟到达时会恢复场景。
  - formId 命中和历史无 formId 记录均能参与恢复。
- `reviewRecordReplay.test.ts`
  - confirmed record 中的 distance/angle measurement 会进入 xeokit replay 集合。
  - source annotation 信息在 replay 后不丢失。
- `annotationWorkspaceModel.test.ts`
  - 右侧记录按 formId scope 展示，同时兼容 unbound 历史记录。
- `ReviewPanel.test.ts` 或 `DesignerCommentHandlingPanel.test.ts`
  - 再次进入任务后 confirmed records zone 和 comments timeline 有数据。

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| PMS 数据不可控，难稳定复现 | 无法判断是否可关闭 | 先用本地任务复现，再用 PMS 真实数据补验收 |
| formId 过滤过严 | 右侧记录为空 | 明确当前 formId 与历史无 formId 兼容规则 |
| viewer ready 比 records 晚 | 测量线不恢复 | 增加 ready 后恢复触发和 force restore |
| 完整路径查询慢或失败 | 面板卡顿或空白 | lookup 只读异步，保留 refno fallback |
| 把展示修复误当完整修复 | Linear 过早关闭 | 按 A/B/C 子问题分别验收 |

## 8. 退出标准

满足以下条件后才建议关闭 RUS-238：

- A/B/C 三个子问题均有明确结论。
- 命令验证通过。
- PMS/编校审真实流程至少覆盖校核重新进入和设计退回查看。
- Linear 评论中有可复核证据。
- 如果完整模型树路径暂不做，已有业务确认或已拆后续 issue。

## 9. 本轮审核记录

已执行命令：

```bash
npm test -- "src/components/review/measurementDisplay.test.ts" "src/components/review/annotationWorkspaceModel.test.ts" "src/components/tools/MeasurementPanel.test.ts" "src/components/review/TaskReviewDetail.test.ts"
npm run type-check
npx eslint "src/components/review/measurementDisplay.ts" "src/components/review/measurementPathLookup.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

结果：

- 4 个目标测试文件通过，30 个测试通过。
- `vue-tsc --noEmit` 通过。
- 定向 ESLint 通过。

结论：

- 文本展示修复有效。
- 原始工单中的“重新进入恢复”和“右侧记录为空”仍需按本计划继续验收和修复。

## 10. 本轮开发执行记录

### 2026-04-30 · scoped 记录为空时兼容历史 task 级记录

根因假设：

- 再次进入任务时，`useReviewStore.loadConfirmedRecords()` 会按当前 `formId` 调用 `reviewRecordGetByTaskId(taskId, { formId })`。
- 如果后端 scoped 查询返回空，但同一 `taskId` 下存在历史无 `formId` 的确认记录，store 会得到空数组，进而导致场景恢复和右侧记录都没有数据。
- 这是 RUS-238 中“校核人员再次进入右侧无校审记录”和“测量路径无法恢复”的一个可测试高风险断点。

已完成：

- 在 `src/composables/useReviewStore.test.ts` 新增 RED 用例：
  - scoped 查询返回空时，回退到 task 级确认记录；
  - fallback 结果只接受当前 `formId` 或历史无 `formId` 记录；
  - 不把同一 task 下其他 `formId` 的记录带入当前页面。
- 在 `src/composables/useReviewStore.ts` 实现最小修复：
  - scoped 查询成功但记录为空，且当前存在 `formId` 时，再执行一次未带 `formId` 的 task 级查询；
  - fallback 结果过滤为当前 `formId` 或无 `formId`；
  - 不改变确认记录结构，不反写测量展示字段。

验证命令：

```bash
npm test -- "src/composables/useReviewStore.test.ts" "src/components/review/confirmedRecordsRestore.test.ts" "src/components/review/reviewRecordReplay.test.ts" "src/components/review/measurementDisplay.test.ts" "src/components/review/annotationWorkspaceModel.test.ts" "src/components/tools/MeasurementPanel.test.ts" "src/components/review/TaskReviewDetail.test.ts"
npm run type-check
npx eslint "src/composables/useReviewStore.ts" "src/composables/useReviewStore.test.ts" "src/components/review/confirmedRecordsRestore.ts" "src/components/review/reviewRecordReplay.ts" "src/components/review/measurementDisplay.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

结果：

- 7 个目标测试文件通过，44 个测试通过。
- `vue-tsc --noEmit` 通过。
- 定向 ESLint 通过。
- IDE lints 未发现新增问题。

剩余工作：

- 仍需 PMS/编校审真实流程验收，确认校核关闭后重新进入时 3D 测量线和右侧记录都能恢复。
- 如业务要求完整模型树路径，再按 Phase 3 接入 `measurementPathLookup.ts`。
