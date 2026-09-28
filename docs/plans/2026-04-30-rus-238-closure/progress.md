# RUS-238 闭环执行日志

## 2026-04-30 14:55 · 文件化规划启动

触发：

- 收到要求：使用 `planning-with-files` 和 diagram 技能，用中文规划开发方案。

已完成：

- 创建工作目录：`docs/plans/2026-04-30-rus-238-closure/`。
- 创建主计划：`task_plan.md`。
- 创建事实记录：`findings.md`。
- 创建执行日志：`progress.md`。
- 准备生成流程图：`rus-238-closure-flow.mmd`。

当前状态：

- 代码侧已有一轮修复：`useReviewStore` scoped 查询为空时兼容历史 task 级确认记录。
- 命令验证已通过：7 个目标测试文件 44 个测试、`type-check`、定向 ESLint。
- 真实 PMS/编校审验收仍缺输入。

下一步：

- 生成并校验 Mermaid 流程图。
- 如拿到 BRAN、包名、角色和入口，按 `task_plan.md` Phase 0 -> Phase 2 执行真实验收。

## 2026-04-30 14:55 · 流程图生成完成

已完成：

- 创建 Mermaid 源文件：`rus-238-closure-flow.mmd`。
- 使用 Mermaid 技能校验并渲染 SVG：`rus-238-closure-flow.svg`。

验证命令：

```bash
"/Users/dongpengcheng/.agents/skills/mermaid/tools/validate.sh" "docs/plans/2026-04-30-rus-238-closure/rus-238-closure-flow.mmd" "docs/plans/2026-04-30-rus-238-closure/rus-238-closure-flow.svg"
```

结果：

- Mermaid 语法校验通过。
- SVG 已生成。

## 验收输入记录

| 输入 | 当前值 | 备注 |
| --- | --- | --- |
| 目标 BRAN/refno | 待提供 | 用于真实模型验收 |
| PMS 包名/任务单 | 待提供 | 用于定位同一校审单 |
| 角色 | 待提供 | 至少 SJ、JH |
| 入口 | 待确认 | 本地、仿 PMS 或真实 PMS |
| 样例测量 | 待创建/定位 | 距离、角度、批注证据 |

## 命令记录

已通过：

```bash
npm test -- "src/composables/useReviewStore.test.ts" "src/components/review/confirmedRecordsRestore.test.ts" "src/components/review/reviewRecordReplay.test.ts" "src/components/review/measurementDisplay.test.ts" "src/components/review/annotationWorkspaceModel.test.ts" "src/components/tools/MeasurementPanel.test.ts" "src/components/review/TaskReviewDetail.test.ts"
npm run type-check
npx eslint "src/composables/useReviewStore.ts" "src/composables/useReviewStore.test.ts" "src/components/review/confirmedRecordsRestore.ts" "src/components/review/reviewRecordReplay.ts" "src/components/review/measurementDisplay.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

## 2026-04-30 15:03 · 开始执行 Phase 0 / 静态验证

执行范围：

- Phase 0 输入复核。
- RUS-238 目标测试。
- TypeScript 类型检查。
- 定向 ESLint。

Phase 0 结果：

| 输入 | 当前值 | 结论 |
| --- | --- | --- |
| 目标 BRAN/refno | 待提供 | 阻塞真实模型验收 |
| PMS 包名/任务单 | 待提供 | 阻塞 PMS/编校审复核 |
| 角色 | 待提供 | 阻塞 SJ/JH 角色链路验收 |
| 入口 | 待确认 | 需确认本地、仿 PMS 或真实 PMS |
| 样例测量 | 待创建/定位 | 需覆盖距离、角度、批注证据 |

已执行命令：

```bash
npm test -- "src/composables/useReviewStore.test.ts" "src/components/review/confirmedRecordsRestore.test.ts" "src/components/review/reviewRecordReplay.test.ts" "src/components/review/measurementDisplay.test.ts" "src/components/review/annotationWorkspaceModel.test.ts" "src/components/tools/MeasurementPanel.test.ts" "src/components/review/TaskReviewDetail.test.ts"
npm run type-check
npx eslint "src/composables/useReviewStore.ts" "src/composables/useReviewStore.test.ts" "src/components/review/confirmedRecordsRestore.ts" "src/components/review/reviewRecordReplay.ts" "src/components/review/measurementDisplay.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

结果：

- 7 个测试文件通过，44 个测试通过。
- `npm run type-check` 通过。
- 定向 ESLint 通过。

观察：

- 目标测试期间出现 `localhost:3000/api/e3d/ancestors` 连接失败日志，这是当前测试环境没有 e3d 服务时触发的完整路径 lookup fallback。
- 测试最终通过，说明 lookup 失败时 UI 仍能回退到 refno 展示，没有阻塞测量列表或确认回放渲染。

下一步：

- 等待真实验收输入到位。
- 输入到位后执行 Phase 1 本地真实模型验收，再执行 Phase 2 PMS/编校审流程验收。

## 2026-04-30 15:06 · 仿 PMS restore 场景执行

执行命令：

```bash
PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_OUTPUT=artifacts/rus-238-closure-restore-report.json npm run test:pms:simulator
```

结果：

- 命令失败，报告文件：`artifacts/rus-238-closure-restore-report.json`。
- 平台 API 契约烟测通过：7/7。
- restore 场景失败：`POST http://127.0.0.1:3100/api/review/records 超时`。
- 场景结束后清理也失败：`POST http://127.0.0.1:3100/api/review/delete 超时`。
- 截图：`artifacts/pms-simulator-artifacts/pms-simulator-artifacts/screenshots/restore.png`。

报告摘录：

| 项 | 值 |
| --- | --- |
| projectId | `AvevaMarineSample` |
| frontend | `http://127.0.0.1:3101` |
| backend | `http://127.0.0.1:3100` |
| caseIds | `restore` |
| contractSmoke | passed |
| restore ok | false |
| failureMessage | `POST http://127.0.0.1:3100/api/review/records 超时` |

后端日志观察：

- restore 前 backend health 正常：`health ok auth=76ms tasks=75ms count=1`。
- 自动化创建了任务：`task-64cf8cc8-3165-4085-9413-5f93d32da4e1`。
- 使用的 form：`FORM-36EF604A1595`。
- 日志显示多次 `Getting records for task: task-64cf8cc8-3165-4085-9413-5f93d32da4e1`。
- 在超时窗口内未看到保存确认记录成功的日志。

阶段结论：

- 当前仿 PMS restore 验收尚未通过，但失败点不在前端路径展示 formatter，也不在本轮 `useReviewStore` scoped fallback。
- 当前阻塞在后端 `/api/review/records` 写入超时，需要先诊断后端确认记录保存链路或复用已有后端 deadlock/timeout 排查计划。
- 本轮尚不能声明 RUS-238 的“重新进入恢复”已通过仿 PMS 验收。

补充诊断：

- 已读取 `docs/issues/backend-mpsc-channel-deadlock-2026-04-29.md`，本次现象符合其中记录的 review DB / SurrealDB ws client mpsc channel 锁死模式：
  - token、embed、workflow 等轻量或短查询链路可通过；
  - 走 review DB 查询/写入的 `/api/review/records`、`/api/review/delete` 可能超时；
  - backend 日志中历史上已多次出现 `Failed to send query results to channel: SendError(..)`。
- 已读取 `plant-model-gen/src/web_api/review_api.rs` 的 `create_record()`：
  - 保存前会 `lookup_task_record_context()`；
  - 之后多次调用 `review_primary_db()` 查询/UPSERT `review_records`；
  - 成功后还会调用 `sync_annotation_states_from_snapshot()`，该函数也继续使用 `review_primary_db()` 写 `review_annotation_states`。
- 自动化结束后执行轻量 health 探针：

```bash
node -e "const c=new AbortController(); setTimeout(()=>c.abort(),5000); fetch('http://127.0.0.1:3100/api/health',{signal:c.signal}).then(async r=>{console.log(r.status, await r.text())}).catch(e=>{console.error(e.name+': '+e.message); process.exit(1)})"
```

结果：

- `TypeError: fetch failed`
- 说明本次 simulator bootstrap 结束后自动停止了它启动的 backend，当前 3100 不再可用；需要重新启动 backend 或换健康环境后才能继续接口级复测。

## 2026-04-30 15:10 · 重启 backend 并复测记录保存链路

启动 backend：

```bash
"/Volumes/DPC/work/plant-code/plant-model-gen/target/debug/web_server" --config "db_options/DbOption-mac"
```

注意：

- 第一次误传 `db_options/DbOption-mac.toml`，程序自动追加 `.toml` 后查找 `DbOption-mac.toml.toml`，启动失败。
- 使用无后缀 `db_options/DbOption-mac` 后启动成功。

健康探针：

```bash
node -e "const c=new AbortController(); setTimeout(()=>c.abort(),5000); fetch('http://127.0.0.1:3100/api/health',{signal:c.signal}).then(async r=>{console.log(r.status, await r.text())}).catch(e=>{console.error(e.name+': '+e.message); process.exit(1)})"
```

结果：

- HTTP 200
- body 包含 `{"status":"ok","database":"healthy"}`

HTTP 合同脚本：

```bash
PLANT3D_API_BASE=http://127.0.0.1:3100 npx tsx scripts/review-annotation-flow-contract.ts --verbose
```

结果：

- 35 passed / 0 failed。
- 覆盖任务创建、`POST /api/review/records` 保存确认记录、独立批注状态查询、评论创建/查询、批注状态流转、评论删除权限与 form 隔离。

阶段结论：

- fresh backend 下 `/api/review/records` 保存链路可用。
- 上一轮 restore 的 `/api/review/records` 超时更像 backend 运行态/连接通道进入不健康状态，而不是接口逻辑必然失败。

## 2026-04-30 15:11 · 重跑仿 PMS restore 场景

执行命令：

```bash
PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_OUTPUT=artifacts/rus-238-closure-restore-rerun-report.json npm run test:pms:simulator
```

结果：

- 命令失败，但失败点已从 `/api/review/records` 超时推进到 UI 评论正文断言。
- 报告文件：`artifacts/rus-238-closure-restore-rerun-report.json`。

关键通过项：

| 断言 | 结果 | 说明 |
| --- | --- | --- |
| `restore-task-contains-bran-24381_145018` | 通过 | 新建任务详情包含目标 BRAN |
| `restore-before-annotation` | 通过 | 刷新前存在批注 |
| `restore-before-measurement` | 通过 | 刷新前存在测量 |
| `restore-before-confirmed-record` | 通过 | 后端读回 confirmed record=1 |
| `restore-before-confirmed-measurement` | 通过 | 后端读回 measurement=1 |
| `restore-form-preserved` | 通过 | 刷新后 formId 保持一致 |
| `restore-annotation-count` | 通过 | 刷新后确认批注仍可读 |
| `restore-confirmed-record-count` | 通过 | 刷新后确认记录仍可读 |
| `restore-confirmed-measurement-count` | 通过 | 刷新后确认测量仍可读 |
| `restore-ui-annotation-count` | 通过 | UI 能看到批注 |
| `restore-ui-annotation-title` | 通过 | UI 能看到批注标题 |
| `restore-ui-bran-refno` | 通过 | UI 能看到 BRAN/refno |
| `restore-comment-after-refresh` | 通过 | 后端刷新后评论仍存在 |
| `restore-comment-content-after-refresh` | 通过 | 后端评论正文读回成功 |

失败项：

| 断言 | expected | actual | detail |
| --- | --- | --- | --- |
| `restore-ui-comment-content` | `true` | `false` | `title_found=true comment_found=false bran_found=true` |

阶段结论：

- 对 RUS-238 的测量恢复主链路而言，本轮仿 PMS restore 已证明后端确认记录和测量记录刷新后可读，UI 也能看到批注标题和 BRAN/refno。
- 自动化整体仍失败，因为评论正文没有出现在 reviewer UI body 文本中；这属于批注评论线程展示/刷新问题，需要单独按评论面板链路继续诊断。
- 本轮仍不能把 restore 自动化标记为全绿，也不能据此关闭 RUS-238；但可把 RUS-238 相关的测量/记录恢复证据作为部分通过证据。

补充评论线程目标测试：

```bash
npm test -- "src/components/review/ReviewCommentsTimeline.test.ts" "src/review/services/commentThreadStore.test.ts" "src/review/domain/commentThread.test.ts"
```

结果：

- 3 个测试文件通过。
- 34 个测试通过。

结论：

- 评论线程基础 store、key、timeline 刷新行为的单元测试通过。
- restore 场景的 `restore-ui-comment-content` 失败暂未能由单元测试复现；下一步若继续追，应聚焦页面自动化里的选中态、详情面板可见性或 body 文本读取范围。

## 2026-04-30 15:39 · restore 评论正文断言修复与通过

根因判断：

- `restore-ui-comment-content` 失败时，报告显示：
  - 后端评论读回成功；
  - UI 能看到批注标题和 BRAN/refno；
  - UI body 未看到评论正文。
- 历史通过报告 `artifacts/comment-thread-pms-restore-bran-24381_145018-retry2.json` 显示同一断言曾通过。
- 本次失败更像刷新后详情线程未挂载或未激活对应批注详情，而不是后端数据丢失。

自动化修正：

- `scripts/pms-simulator-runner.ts`
  - 在 `readRestoreCounts()` 中，如果页面已出现恢复批注标题但未出现评论正文，先点击该批注标题，再等待评论正文出现。
  - 这样断言目标从“左侧列表文本已出现”推进到“详情评论线程确实渲染”。
- `scripts/pms-plant3d-initiate-flow.ts`
  - 增加可选 `urlIncludes` 参数用于后续精确筛选页面根；本轮最终没有在 restore 主路径使用该过滤，以避免直达页未就绪时误判。

验证命令：

```bash
npx eslint "scripts/pms-plant3d-initiate-flow.ts" "scripts/pms-simulator-runner.ts"
npm run type-check
PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_OUTPUT=artifacts/rus-238-closure-restore-click-report.json npm run test:pms:simulator
```

结果：

- 定向 ESLint 通过。
- `npm run type-check` 通过。
- restore 场景通过。

restore 通过报告：

| 项 | 值 |
| --- | --- |
| 报告 | `artifacts/rus-238-closure-restore-click-report.json` |
| formId | `FORM-EFC6A720B837` |
| taskId | `task-712392cb-9966-4f68-8fb7-c3f45deb3478` |
| packageName | `COMMENT-THREAD-REGRESSION-1777535048226` |
| finalNode | `jd` |
| finalStatus | `submitted` |

关键通过断言：

- `restore-before-confirmed-record`
- `restore-before-confirmed-measurement`
- `restore-form-preserved`
- `restore-confirmed-record-count`
- `restore-confirmed-measurement-count`
- `restore-ui-annotation-title`
- `restore-ui-comment-content`
- `restore-ui-bran-refno`
- `restore-comment-content-after-refresh`
- `restore-console-no-comment-thread-errors`

阶段结论：

- 仿 PMS restore 已通过，覆盖刷新/重新进入后 confirmed record、measurement、批注标题、评论正文与 BRAN/refno 的恢复。
- 这为 RUS-238 的“关闭后重新进入仍能看到测量/记录”提供了自动化通过证据。
- 仍需真实 PMS 环境的 BRAN、包名、角色入口输入，才能完成最终真实流程验收。

## 2026-04-30 15:48 · Linear 回填

已回填 Linear RUS-238 评论：

- commentId: `d3499aac-a85f-4e4c-9fcd-4d72d08c2d8a`
- issue: `RUS-238`
- 内容：仿 PMS restore 通过证据、验证命令、报告路径、form/task/package 信息、真实 PMS 验收仍需输入。

Linear 当前状态：

- 已追加验收进展评论后，将 issue 状态从 `Backlog` 调整为 `In Progress`。
- 未标记 `Done`：真实 PMS 环境验收仍缺目标 BRAN、包名/任务单、角色链路和入口输入。

## 2026-04-30 16:06 · Cursor Browser Use 仿 PMS 手工验证

使用 `agent-browser` 对仿 PMS / Plant3D 进行可见浏览器验证：

- 打开仿 PMS：`http://127.0.0.1:3101/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=AvevaMarineSample`
- 首次打开时 `/api/projects` 超时，仿 PMS 项目列表停留在“项目列表加载中…”，重启本地 `web_server` 后恢复。
- SJ 角色点击“新增”成功打开 Plant3D 发起页，生成 `form_id=FORM-41539A21AF5E`。
- 在 Plant3D 发起页输入并添加 `24381_145018`，页面识别为 `/Copy-of-RCS0014-1R43012新 RefNo: 24381_145018`。
- 保存/验证发起数据后，仿 PMS 外层再次出现 `/api/review/tasks?limit=5000` 与 embed-url 超时，需要再次重启本地 `web_server`。
- 重启后直接使用 JH token 打开现有可用单据 `FORM-16DAE75C9081`，右侧校审面板可见：
  - 标题：`BRAN-MIXED-REGRESSION-1777535346043`
  - 批注列表：4 条待处理批注
  - 当前选中：`BRAN 24381_145018 混合流程批注`
  - RefNo 展示：`24381/145018, 24381_145018`

截图证据：

- `artifacts/rus-238-browser-use/screenshot-1777536381876.png`

补充观察：

- `FORM-EFC6A720B837` 是早前 restore 报告中的 form，但当前后端状态下已无法绑定内部任务，页面显示“内部 review_tasks 中尚未找到对应任务”。
- 本轮 browser use 证明仿 PMS/Plant3D 可见页面能重新进入并显示右侧校审记录与 RefNo；但也再次暴露本地 `plant-model-gen` 后端在手工链路中会出现请求超时/挂起，需要单独处理或在验收前保持干净后端进程。

## 2026-04-30 17:25 · 新建单据 browser use 续测

按要求改为“新建单据”路径，不复用旧单据：

- 通过仿 PMS restore 自动化创建并保留了新单据：
  - `form_id=FORM-37C372A7407F`
  - `task_id=task-1104fb4f-8787-4ff9-9aee-3125ecb452ff`
  - `packageName=COMMENT-THREAD-REGRESSION-1777537147388`
  - 状态：`submitted`
  - 当前节点：`jd`
  - 组件：`BRAN 24381_145018`
- 自动化创建阶段成功，失败点发生在随后写入 `/api/review/records`：`POST /api/review/records 超时`。
- 重启后端后，手动为新单据写入 confirmed record 与评论：
  - annotationId: `browser-new-annot-1777537253737`
  - comment: `新建单据 browser use 评论 1777537253737`
  - measurement: `distance`
- 使用 Cursor browser 打开新单据 JH 校审页时，页面能识别新 task 标题 `COMMENT-THREAD-REGRESSION-1777537147388`，但右侧显示 `全部 0 / 待处理 0`。
- 控制台/网络显示核心失败：
  - `GET /api/review/records/by-task/task-1104fb4f-8787-4ff9-9aee-3125ecb452ff?form_id=FORM-37C372A7407F` 返回 500 或超时。
  - `GET /api/review/tasks/task-1104fb4f-8787-4ff9-9aee-3125ecb452ff/history` 返回 500。
  - `POST /api/review/workflow/sync` 返回 500。
  - 直接 curl 同一 task/records/comments API 时 `/api/health` 正常，但 review API 查询超时。

阶段结论：

- 新建单据本身已成功创建，且后端 task 详情曾可查询并包含 `BRAN 24381_145018`。
- 当前阻塞不是“没有新建单据”，而是本地 `plant-model-gen` 后端 review 查询链路挂起/500，导致新建单据重开时右侧记录无法恢复显示。
- 该阻塞与既有 `backend-mpsc-channel-deadlock-2026-04-29.md` 描述的 mpsc/channel 挂起风险一致，建议单独作为后端稳定性问题处理；否则 RUS-238 新建单据 browser 验收无法稳定完成。

## 2026-04-30 17:36 · 后端阻塞修复后新建单据验收通过

根因复核：

- 用独立 `surreal sql` 直连查询同一数据，`review_tasks`、`review_records`、`review_comments` 均在毫秒级返回。
- 数据库中确认存在：
  - task: `task-1104fb4f-8787-4ff9-9aee-3125ecb452ff`
  - record: `slot-8cbfc9391389e157502d91ee98d7de38dc36fed05ccd9c23d43f714a363492d6`
  - annotation: `browser-new-annot-1777537253737`
  - measurement: `browser-new-measure-1777537253737`
  - comment: `新建单据 browser use 评论 1777537253737`
- 结论：SQL 和数据本身正常，失败点在 `review_primary_db` 池化 ws client 挂起。

已在 sibling 后端仓 `plant-model-gen` 做最小修复：

- `src/web_api/review_db.rs`：新增 `fresh_review_db()`，每次创建独立 SurrealDB ws client，并复用 ns/db 选择逻辑。
- `src/web_api/review_api.rs`：将新建单据验收依赖的读接口改为 fresh client：
  - `/api/review/tasks`
  - `/api/review/tasks/{id}`
  - `/api/review/tasks/{id}/history`
  - `/api/review/tasks/{id}/workflow`
  - `/api/review/records/by-task/{task_id}`
  - `/api/review/comments/by-annotation/{annotation_id}`
- `src/web_api/platform_api/review_form.rs`、`src/web_api/platform_api/workflow_sync.rs`：将 form/task 查询与 workflow query 读路径切到 fresh client，避免页面进入时命中已挂起池连接。

验证：

- `cargo fmt -- src/web_api/review_db.rs src/web_api/review_api.rs src/web_api/platform_api/review_form.rs src/web_api/platform_api/workflow_sync.rs`
- `cargo check --bin web_server --features web_server` 通过（仅既有依赖 warning）。
- `cargo build --bin web_server --features web_server` 通过。
- 重启 patched backend 后 direct API 全部恢复 200：
  - `GET /api/review/tasks/task-1104fb4f-8787-4ff9-9aee-3125ecb452ff`
  - `GET /api/review/records/by-task/task-1104fb4f-8787-4ff9-9aee-3125ecb452ff?form_id=FORM-37C372A7407F`
  - `GET /api/review/comments/by-annotation/browser-new-annot-1777537253737?form_id=FORM-37C372A7407F&task_id=task-1104fb4f-8787-4ff9-9aee-3125ecb452ff`
  - `GET /api/review/tasks/task-1104fb4f-8787-4ff9-9aee-3125ecb452ff/workflow`

Cursor browser 新建单据验收：

- 使用 fresh JH external token 打开：
  - `FORM-37C372A7407F`
  - `task-1104fb4f-8787-4ff9-9aee-3125ecb452ff`
- 页面显示：
  - 审核记录 `1`
  - 历史流转 `1`
  - 批注 `1`
  - 待处理 `1`
  - 卡片显示 `RefNo 24381/145018, 24381_145018`
  - 中间模型视图显示 `browser use 新建单据批注` 与 `1.00 m` 测量标记。
- Browser network 关键请求全部 200：
  - task detail
  - records by task
  - comments by annotation
  - workflow sync
  - workflow history
  - visible insts / type-info / mesh/parquet 资源。

结论：

- RUS-238 的核心验收项（新建单据重开后测量/批注关联路径展示 `24381/145018` 与 `24381_145018`）已在仿 PMS + Cursor browser 中通过。
- 本轮还修复了阻塞验收的后端 review 查询挂起问题；该修复位于 sibling 仓 `plant-model-gen`，合入时需要与前端 RUS-238 证据一起提交/说明。

## 2026-04-30 18:02 · planning-with-files 中文方案与架构图

按要求使用 file-based planning 补齐中文开发方案，并结合 diagram skill 输出架构图：

- 新增 `task_plan.md`：整理 RUS-238 新建单据测量路径显示的目标、阶段、风险与验证清单。
- 新增 `review-query-fresh-client-architecture.html`：自包含 HTML/SVG 架构图，展示仿 PMS → Plant3D → review API → `fresh_review_db()` → SurrealDB 的读路径，以及旧池化 ws client 的后续治理风险。
- 图使用项目已定制的 `plant3d-web` 浅蓝灰风格 token，未使用默认 neutral/rust 皮肤。

规划结论：

- 当前短连接读路径是最小可交付修复，已满足 RUS-238 新建单据验收。
- 长期治理仍应补 `review_primary_db` 连接池健康检查、熔断、恢复或升级 SurrealDB client。
- 提交前需要确认 `plant3d-web` 文档证据与 sibling 仓 `plant-model-gen` 后端补丁的跨仓边界。

## 2026-04-30 18:08 · 跨仓 diff 边界复核

执行规划后的边界检查：

- `plant3d-web`：RUS-238 范围是新增 `docs/plans/2026-04-30-rus-238-closure/`，用于计划、发现、进度和架构图证据。
- `plant-model-gen`：RUS-238 后端补丁集中在 `fresh_review_db()` 与关键 review/form/workflow 读路径切换。
- 注意：`plant-model-gen` 当前工作区还有大量其它 staged/unstaged 改动，且同一文件里混有 RUS-241/workflow agree 相关内容（如 `WorkflowVerifyNextStepDiagnostic`、`normalize_pms_human_code`、verify diagnostics）。这些不是 RUS-238 的 fresh client 补丁，不应在提交说明中归因到 RUS-238。

已将边界明细写入 `task_plan.md` 的“跨仓变更边界”小节，并把“提交前确认跨仓 diff 边界”检查项标记完成。

## 2026-04-30 18:12 · 提交拆分交接

继续执行拆分准备：

- 复核 `plant-model-gen` staged diff，确认已有 staged 内容包括：
  - `review_db` 单 client → pool 的既有改动。
  - `review_form` schema OnceCell 既有改动。
  - `review_api` due_date 兼容、probe cap 既有改动。
- 这些是本轮 fresh client 补丁的基础或相关前置，但不是本轮新增的全部内容。
- 新增 `handoff.md`，明确建议拆成：
  - `plant3d-web` 文档与证据提交。
  - `plant-model-gen` RUS-238 fresh client 后端补丁提交。
  - RUS-241/workflow agree 相关改动单独提交或保留原任务分支。

拆分禁忌已记录：不要全量 `git add .`，不要用 destructive 清理命令，未确认 staged 归属前不要合并说明。

## 2026-04-30 18:16 · 后端 mpsc 问题文档补充

继续执行长期治理待办，更新 `docs/issues/backend-mpsc-channel-deadlock-2026-04-29.md`：

- 将修复状态从“待 backend 开发者落地”更新为“已有 RUS-238 验收级缓解，长期池健康治理待落地”。
- 补充 RUS-238 新建单据复核证据：
  - `FORM-37C372A7407F`
  - `task-1104fb4f-8787-4ff9-9aee-3125ecb452ff`
  - 页面进入时 records/history/workflow 曾 500 或超时。
  - 独立 `surreal sql` 直连毫秒级返回，确认数据和 SQL 正常。
- 记录已落地的 short-lived client 读路径缓解范围，以及 patched backend direct API / Cursor browser 验收结果。
- 明确该缓解不等于连接池长期问题已彻底消失，仍需后续池健康检查、熔断、恢复或升级 SurrealDB client。

## 2026-04-30 18:14 · 架构图渲染验证

补齐 diagram 产物可视验证：

- `file://` 直接打开被 Cursor browser 安全策略拒绝，改用本地临时 HTTP 服务验证。
- 使用 `python3 -m http.server 8765 --bind 127.0.0.1` 服务 `docs/plans/2026-04-30-rus-238-closure/`。
- 打开 `http://127.0.0.1:8765/review-query-fresh-client-architecture.html` 成功。
- 浏览器截图确认：
  - 页面标题 `RUS-238 Review 查询稳定化架构图` 正常。
  - 主图展示 frontend/backend/surrealdb 三个边界。
  - `fresh_review_db()`、旧池化 ws client、validation/next 区域均可见。
- 控制台仅有 Cursor browser native dialog override warning，无 HTML 页面错误。
- 验证后已关闭临时 HTTP 服务。
