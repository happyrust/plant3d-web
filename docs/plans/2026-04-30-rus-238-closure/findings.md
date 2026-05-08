# RUS-238 闭环 Findings

> 本文件只记录已经验证或从代码/文档中确认的事实，不记录未验证猜测。

## 已确认事实

- `[展示]` `measurementDisplay.ts` 已提供同步 refno fallback formatter，可把 `o:24381_145018:0`、`24381_145018`、`pe:=24381/145018` 等规范化展示为 `24381/145018`。
- `[完整路径]` `measurementPathLookup.ts` 已提供只读完整路径查询能力，失败时 fallback 到规范化 refno。
- `[UI 接入]` 现有计划文档记录测量列表、确认回放、批注测量证据已接入 `useMeasurementPathSummaries`，但真实 PMS/编校审验收仍缺输入。
- `[读路径]` `useReviewStore.loadConfirmedRecords()` 原先在带 `formId` scoped 查询返回空时不会回退 task 级历史记录，可能导致右侧记录和场景恢复拿不到历史无 `formId` 的确认记录。
- `[修复]` 已补充 scoped-empty fallback：当 scoped 查询成功但 records 为空，且当前存在 `formId` 时，再执行 task 级查询，并只保留当前 `formId` 或无 `formId` 的记录。
- `[验证]` RUS-238 相关 7 个测试文件共 44 个测试已通过；`npm run type-check` 通过；定向 ESLint 通过。
- `[fallback]` 在无本地 e3d 服务时，完整路径 lookup 会出现 `localhost:3000/api/e3d/ancestors` 连接失败日志；目标测试仍通过，说明当前 UI 能在 lookup 失败时回退到 refno 展示。
- `[仿 PMS]` `PMS_SIMULATOR_CASE=restore` 已执行，平台 API 契约烟测 7/7 通过，但 restore 场景失败在 `POST /api/review/records` 超时，清理 `POST /api/review/delete` 也超时 - `artifacts/rus-238-closure-restore-report.json`。
- `[仿 PMS]` restore 截图显示页面已进入校核视图，右侧任务信息可见；失败发生在保存确认记录阶段，尚未进入“关闭后重新进入恢复”的最终验收判定 - `artifacts/pms-simulator-artifacts/pms-simulator-artifacts/screenshots/restore.png`。
- `[复测]` 重启 backend 后 `/api/health` 返回 200 且 `database=healthy`；`scripts/review-annotation-flow-contract.ts --verbose` 35/35 通过，说明 fresh backend 下 `/api/review/records` 保存链路可用。
- `[修复]` restore 自动化在读取 UI 评论正文前，若已看到恢复批注标题但未看到评论正文，会先点击该批注标题，确保详情线程挂载后再断言正文 - `scripts/pms-simulator-runner.ts`。
- `[通过]` `PMS_SIMULATOR_CASE=restore` 已通过，报告为 `artifacts/rus-238-closure-restore-click-report.json`；覆盖刷新/重新进入后 confirmed record、confirmed measurement、批注标题、评论正文与 BRAN/refno 恢复。
- `[Linear]` 已向 RUS-238 追加验收进展评论，commentId=`d3499aac-a85f-4e4c-9fcd-4d72d08c2d8a`；随后将 issue 状态从 `Backlog` 调整为 `In Progress`，未标记 `Done`。
- `[Browser Use]` 使用 `agent-browser` 打开仿 PMS 并进入 Plant3D：SJ 新增可生成 `form_id=FORM-41539A21AF5E`，可添加 `24381_145018`；JH 直接重开 `FORM-16DAE75C9081` 可见右侧校审记录、4 条批注与 `BRAN 24381_145018` RefNo 展示。截图：`artifacts/rus-238-browser-use/screenshot-1777536381876.png`。
- `[风险]` browser use 手工链路中本地 `plant-model-gen` 后端两次出现 `/api/projects`、`/api/review/tasks?limit=5000` 或 embed-url 请求超时，重启 `web_server` 后恢复；该现象与既有 backend mpsc/channel 挂起风险一致，真实验收前需要保持后端干净或单独修复后端稳定性。
- `[Browser Use - 新建单据]` 按要求改用新建单据验证：已创建并保留 `FORM-37C372A7407F` / `task-1104fb4f-8787-4ff9-9aee-3125ecb452ff`，包名 `COMMENT-THREAD-REGRESSION-1777537147388`，状态 `submitted`，节点 `jd`，组件包含 `BRAN 24381_145018`。
- `[阻塞]` 新建单据重开时右侧记录显示为 0；网络/控制台显示 `/api/review/records/by-task/{taskId}?form_id=...`、`/api/review/tasks/{taskId}/history`、`/api/review/workflow/sync` 返回 500 或超时。直接 curl 也表现为 `/api/health` 正常但 review API 查询超时，说明阻塞在后端 review 查询链路，而不是前端未新建单据。
- `[根因确认]` 独立 `surreal sql` 直连同一 `review_tasks`、`review_records`、`review_comments` SQL 均毫秒级返回，确认数据和 SQL 正常；阻塞点是 `review_primary_db` 池化 ws client 命中挂起连接。
- `[后端修复]` 已在 sibling 仓 `plant-model-gen` 添加 `fresh_review_db()`，并将新建单据验收依赖的 review/form/workflow 读路径切换到短连接，规避已挂死 ws client 池连接。
- `[Browser Use - 新建单据通过]` patched backend 重启后，Cursor browser 打开 `FORM-37C372A7407F` 可见审核记录 `1`、历史流转 `1`、批注 `1`、待处理 `1`；批注卡片显示 `RefNo 24381/145018, 24381_145018`，模型视图显示批注与 `1.00 m` 测量标记，关键网络请求均为 200。

## 待验证事实

- `[真实流程]` JH 校核人员关闭三维校审页面后，从列表再次进入同一任务时，3D 测量线是否稳定恢复。
- `[真实流程]` JH 再次进入时右侧批注/校审记录是否稳定可见。
- `[真实流程]` SJ 设计人员打开退回任务时，模型测量线、右侧记录和批注证据是否一致可见。
- `[路径展示]` 真实模型数据下完整路径 resolved 文案是否过长，是否需要改为 tooltip 或次级文案。
- `[性能]` 测量点较多时 `measurementPathLookup` 是否会产生过多请求，是否需要并发限制或批量查询。
- `[环境]` 真实验收应使用可访问 e3d 模型树接口的环境，否则只能验证 fallback，不能验证完整路径 resolved。

## 决策记录

- 不修改测量持久化结构，所有路径增强都保持只读展示。
- 不把完整路径反写到 confirmed record 或 measurement record。
- PMS/编校审验收未完成前，不建议关闭 RUS-238。
- 如果业务只接受 refno 展示，则完整路径可作为增强能力保留，不作为关闭 RUS-238 的必要条件。

## 关键文件

- `src/composables/useReviewStore.ts`
- `src/composables/useReviewStore.test.ts`
- `src/components/review/measurementDisplay.ts`
- `src/components/review/measurementPathLookup.ts`
- `src/components/review/useMeasurementPathSummaries.ts`
- `src/components/review/confirmedRecordsRestore.ts`
- `src/components/review/reviewRecordReplay.ts`
- `src/components/review/AnnotationWorkspace.vue`
- `src/components/tools/MeasurementPanel.vue`
- `src/components/review/TaskReviewDetail.vue`
- `scripts/pms-simulator-runner.ts`
- `scripts/pms-plant3d-initiate-flow.ts`
- `artifacts/rus-238-closure-restore-click-report.json`
