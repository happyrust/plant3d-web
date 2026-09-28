# 三维校审批注“单次主操作”Phase D 验收记录

日期：2026-04-27  
范围：批注处理状态真源、单一处理表单、证据保存门禁、OBB 辅助证据策略。

## 1. 本地自动化回归

已执行：

```bash
npm test -- src/api/reviewApi.test.ts src/components/review/annotationWorkspaceModel.test.ts src/components/review/ReviewCommentsTimeline.test.ts src/components/review/reviewPanelActions.test.ts src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/ReviewPanel.test.ts src/components/review/AnnotationTableView.test.ts
```

结果：

- 7 个测试文件通过。
- 129 个测试通过。
- `ReviewPanel.test.ts` 中出现多条既有 stderr：`Viewer panel did not become ready in time for task filtering`，但不影响测试结果。

覆盖点：

- 后端 `AnnotationReviewStateView.history[].timestamp` 被正确映射为前端 `createdAt`。
- 非法 history action 被过滤，但顶层状态仍可展示。
- 批注处理状态以后端 state 为真源，不再本地合成第二份状态。
- evidence-only diff 忽略纯 `reviewState` 变化。
- 纯 OBB 变化不阻塞任务提交。
- OBB 在 UI 中显示为 `包围盒（辅助证据）`。
- 时间线动作区采用“选择处理结果 + 填写说明 + 单一提交按钮”。
- 表格操作列详情按钮直接打开处理详情。

## 2. 类型检查

已执行：

```bash
npm run type-check
```

结果：通过。

## 3. Lint / IDE 诊断

ReadLints 检查范围：

- `src/api/reviewApi.ts`
- `src/api/reviewApi.test.ts`
- `src/components/review/ReviewCommentsTimeline.vue`
- `src/components/review/ReviewCommentsTimeline.test.ts`
- `src/components/review/annotationWorkspaceModel.ts`
- `src/components/review/annotationWorkspaceModel.test.ts`
- `docs/verification/review-annotation-state-api-samples-2026-04-27.md`

结果：无诊断。

## 4. 本地 PMS Simulator 尝试

已尝试：

```bash
npm run test:pms:simulator
```

结果：未完成。

现象：

- 命令启动后 8 分钟以上没有输出后续日志。
- 判断卡在 simulator bootstrap 的前置服务启动或健康检查阶段。
- 已手动停止该进程，避免继续占用资源。

结论：

- 本轮无法用 simulator 形成完整 SJ/JH/SH 真实流程证据。
- 不将 simulator 失败视为代码回归，因为当前没有明确失败日志或断言失败；属于环境/启动链路阻塞。

后续复跑建议：

```bash
PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

如仍卡住，建议分别确认：

1. 前端 Vite 端口是否可启动。
2. 后端 `plant-model-gen` web server 是否能按 simulator 预期启动。
3. SurrealDB 本地端口和数据目录是否可用。
4. simulator bootstrap 是否需要更详细的 health-check 日志。

## 5. 真实 PMS 验收阻塞

真实 PowerPMS CDP/E2E 需要外部环境变量，不应把密码写入仓库或日志：

```bash
export PMS_E2E_PASSWORD='***'
export PMS_EMBEDDED_SITE_SUBSTRING='***'
npm run test:pms:cdp:extended
```

当前未执行原因：

- 需要真实联调环境密码和嵌入站点地址。
- 该类命令会访问外部 PMS，并可能依赖验证码、网络、线上部署版本。

建议在具备环境后执行：

```bash
PMS_CDP_FULL_FLOW=1 PMS_CDP_EXTENDED_FLOW=1 npm run test:pms:cdp:extended
```

验收重点：

1. SJ 发起编校审。
2. JH 创建批注与测量证据。
3. JH 保存新增证据并退回设计。
4. SJ 使用单一处理表单提交 `已修改` 或 `不需解决`。
5. 未新增证据时，不再被“保存新增证据”阻塞。
6. SJ 流转回校对。
7. JH 使用单一处理表单提交 `同意` 或 `驳回`。
8. 后续流转仍由 `reviewAnnotationCheck` 门禁控制。

## 6. 当前验收结论

本地可验证部分已通过：

- 单元/组件回归通过。
- 类型检查通过。
- IDE 诊断无问题。
- 协议文档已记录后端状态 API 与 OBB 门禁现状。

未完成的外部验收：

- 本地 PMS simulator：启动/健康检查阶段卡住，需要环境排查。
- 真实 PowerPMS extended flow：需要外部密码、部署地址和网络环境。

在进入合并前，建议至少补跑一次 simulator 或真实 PMS extended flow，并将输出补充到本文档。
