# 三维校审下一步开发计划（2026-09-14）

> 状态：**已拍板，执行中**（2026-09-14 23:0x 用户拍板：§6 五项全按推荐，含交互方案 §9 十项；决策 d-565 / d-567 / d-569 / d-571 / d-573。U0 同日开工，见 §9）。
> 依据：`plant3d-web@b5fb047`（main）、后端唯一主线 `gen-model-refactor@9b972644e`（d-412）、共享决策库 d-398 / d-408 / d-410 / d-412、
> 两份 09-14 方案（`2026-09-14-3d-annotation-interaction-redesign-proposal.md`、`2026-09-14-cloud-annotation-3d-region-redesign.md`）、
> 后端 `docs/plans/2026-09-12-review-backend-port-plan.md` §11 与 `docs/plans/2026-09-14-review-closure-landing-plan.md` §10、`docs/adr/ADR-075-review-data-persistence.md`。
> 本文只定「现状、要什么、先做什么、怎样算完成」；实现细节以两份方案为准，凡改变口径处回写各自方案并另开 ADR。

## 0. 一句话

**后端校审域移植已闭环（gen-model 0.1.24），前端云线空间范围体 P0–P2 与四类 bindings / 失效解析已落地；接下来的主线是交互方案的 U0（任务隔离 + 真实保存反馈）→ U1（共享工作台 + 连续导航）→ U2（锚点先行），后端并行起 U3 的草稿 / 任务上下文接口；云线 P3 / P4 与实时通道按证据与拍板排在其后。**

## 1. 现状核对（2026-09-14 22:5x 全部核过，出处在括号里）

### 1.1 后端：校审后台移植**已闭环**

| 项 | 状态 | 出处 |
| --- | --- | --- |
| `plant-model-gen :3100` 校审域 → `gen-model :8022`（T1–T5） | 完成；`--no-ff` 合入主线 `afa0ecb69`，发 **0.1.24**（`80bee35e6`） | port-plan §11、landing-plan §10（P0–P4 全落地，V1–V8 全绿） |
| 四前缀 `/api/review` `/api/users` `/api/auth` `/files/review_attachments` | 37 条契约路由 + 静态附件 + PMS 6 条 + 集成 2 条 = **46/46**；源码护栏 `REVIEW_CONTRACT_ROUTES` | `docs/specs/review-api.md`、`src/web_service/review/*`（24 个 rs，约 20k 行） |
| 测试 | 校审域单测 152/152；全库 lib 2037 passed / 0 failed；A6 双重启持久化 PASS；A9 mem 拒绝 PASS；走查 U1 / U2 / U2 退回 / U3 PASS（`mock-used = mock-disabled = 0`） | `verification/review-closure-20260914/`、`scripts/review/walkthrough` |
| 持久化闸（ADR-075 × ADR-074） | 只认 `StoreMode::is_durable()`（仅 `rocksdb`）；出厂 `mem` 档四前缀 503 `review.persistence.refused` + 启动横幅；逃生门 `PLANT_REVIEW_ALLOW_EPHEMERAL_STORE=1` 仅演示 | d-398、d-410 |
| 前端切换 | `.env.development` 的 `VITE_GEN_MODEL_API_BASE_URL` 已翻到 `:8022`（本地、gitignore）；联调指南 §9 已提交 `ae1231b` | plant3d-web |

后端**尚未做 / 非目标**（按重要性）：

1. `/ws/review*` 实时通道从未存在（旧端也没有，port-plan N1）——前端 `useReviewStore` 的 WS、`useCommentThread` 订阅的 `comment_added` 全部空转，评论「实时」自 04-19 Gap G4 起到今天都不生效。
2. U3 草稿接口（交互方案 §6.2：`GET tasks/{id}/annotation-context`、`PATCH/GET tasks/{id}/annotation-drafts/{draftId}`、`/records` 前置条件字段）后端一行没有；`records.rs` 今天只有 slot 幂等的 `create_record` + owner 校验。
3. 04-19 Gap M4 后端字段（`annotation_key / workflow_node / review_round`）未扩，前端 adapter 预留字段永远 `undefined`。
4. `GET /api/review/collision-data` 数据源 `CollisionSource::Unavailable`，回显式空集 + `reason`（ADR-075 §未决，等碰撞生产者）。
5. 旧端 `:3100` 库迁移脚本没有（`review_attachment` 旧表 SCHEMAFULL 缺 `file_name / file_size / mime_type`，直接接会挡附件写入，ADR-075 §未决）；旧端保留一个发布周期（N5）。
6. `scripts/review/nginx-review-split.conf` 只随包进，未部署验证；`/api/dashboard/activities` P2 可选未接；`review_workflow_history` 无清理策略（G9）。
7. A2 / A5 / A10 只有 PASS-静态（旧端编不起来，d-408），不作门槛。
8. 工作树：`gen-model-refactor` 有约 30 个他人（rvm）在途改动；主工作树 `gen-model` detached 在 `02d445ba4` 当实验树（landing-plan Q4），**里面没有 review 代码**。

### 1.2 前端（plant3d-web）

**结构与体量**：

- 业务面板 `src/components/review/`（约 90 文件）：`ReviewPanel.vue` 2112 行、`InitiateReviewPanel.vue` 1166、`AnnotationTableView.vue` 1032、`AnnotationOverlayBar.vue`（`src/components/tools/`）1235、`DesignerCommentHandlingPanel.vue` 699（与 `ReviewPanel` 是「双胞胎面板」，AGENTS.md 要求 5 套回归守护）。
- 领域层 `src/review/`：`domain/`（`annotationKey` v1、`bindingResolve` 四态 + 记录级降级态、`cloudRegion` 范围体类型 + 漏斗、`annotationProjection/{annotationProjection,clip4,hull2d,roundedPath,wave,labelLayout,dirty}`、`commentThread`、`reviewSnapshot`）、`adapters/`（三条恢复链路 task_records / workflow_sync / import_package）、`services/`（commentThreadStore、reviewSnapshotService、sharedStores）。
- 状态与渲染：`useToolStore.ts` 3065 行（四类批注记录 + normalize 漏斗 + localStorage 容器 V6）、`useDtxTools.ts` 5000+ 行（云线创建 / 渲染 / 文字框 / 引线全在这里）、`useReviewStore.ts` 1019、`reviewApi.ts` 2491。
- 测试：vitest 全量全绿（P2 记录 51 例新增后 ≈ 2750 例）；type-check 基线 623 条既有错误只拦新增；e2e 有 `dtx-annotation-{creation,visual}`、`dtx-cloud-fit-enclosure`、`pms-*` 六个 spec，**没有** U2 级「真实 UI 创建流程」用例。

**04 月「批注体系重构 A–H」走到哪**（`src/review/flags.ts`）：

| Phase | flag | 状态 |
| --- | --- | --- |
| A 术语 / key / flags | — | 完成 |
| B ReviewSnapshot 中间层 | `REVIEW_B_SNAPSHOT_LAYER_SHADOW / CUTOVER` 默认关 | 中间层存在但**无消费者**，SHADOW 从未开过（G1） |
| C 评论 thread store | `REVIEW_C_COMMENT_THREAD_STORE_CUTOVER` **默认开** | 已 CUTOVER（M3-T8 完成） |
| D annotationKey v2 / 轮次字段 | 默认关 | v1 有但**无运行时调用方**（评论按 `annotationId` 归并）；轮次字段没有 |
| E draft/confirmed 双层、F 评论同步 v2、G task 级草稿隔离 | 默认关 | **flag 声明了、零消费者 = 未开始**；G 正是交互方案 U0 要吃的 G5「草稿串任务」 |
| H 日志抽屉 | 可选 | 完成 |

**09-14 当天落地（均在 main）**：

- `a883991` ADR-0049 四类批注统一带角色 `bindings`（text 推 anchor + member、rect / obb 推 member）。
- `2d7459d` ADR-0050 最小运行时解析：`bindingResolve` 四态 `resolved / unloaded / missing / stale`，模型加载 / 版本切换（`dtxLoaderRevision`）批量重算，详情卡降级；结果只在内存，`resolveDetailsV1` 不持久化。
- `f4764b3` ADR-0050 记录级降级态 `summarizeRecordDegrade` + 视口样式口径 `ANNOTATION_DEGRADE_VIEWPORT_STYLE`。
- `af4b382` 云线空间范围体 **P0 兼容基线**（`regionV1 / presentationV1 / viewpointV1 / labelLayoutV1` 四可选字段 + 漏斗 + 三链路 round-trip + `DtxLoadSourceStamp`）。
- `a9cc533` **P1** 像素意图文字框 + 最近点对引线 + 分阶段脏标记（`cloudLabelLayoutV1 / cloudDirtyCache` 默认开，静止 120 帧零重建）。
- `b5fb047` **P2** 范围体呈现（`cloudProjectedEnvelope` 默认开）：`DTXLayer.getObjectLocalBoxAndWorldMatrixInto`、纯函数几何内核、新建云线写 `regionV1(obb-union)` + `viewpointV1.creation`、`region-v1` 记录走新管线、bbox3d 画真实盒边；51 例测试；方案 §18 实施记录。

**工作树里在途未提交**（他人会话正在做，本计划不碰）：`useDtxTools.ts` +168（ADR-0050 视口降级**接线**：`applyMeshLineDegrade / applyLeaderDegrade / markPinElDegrade / createCloudDegradeBadgeEl` 等）；`useToolStore.ts` +27 与 `Measurement*` 属于测量会话，与校审无关。

### 1.3 两份方案的状态（决定接下来做什么的依据）

| 方案 | 拍板 | 落地 |
| --- | --- | --- |
| 交互改进方案（U0–U5） | **§9 十项待产品拍板，未拍板前不动代码** | 只先行落了 U0 要吃的 ADR-0049 / 0050；`annotationScope / useAnnotationDraftSession / useAnnotationSelection / annotationInteraction / annotationUx.*` 开关**一个都还没有** |
| 云线空间范围体方案（P0–P4，= U4） | §14 十项 20:50 已拍板 | P0 ✅ P1 ✅ P2 ✅；P2.5 / P3 / P4 后置 |

### 1.4 前端已知遗留（有出处）

1. 草稿 scope 只到 `project + db`，切任务互串（04-19 Gap G5 / issue `annotation-persist-on-new-task`）→ U0。
2. 「已保存」= localStorage 写入即绿勾，云端 / 本机 / 已确认三态不分 → U0 + U3。
3. 四入口各持一份「当前批注」，单击即飞行，没有上一条 / 下一条 → U1。
4. 云线创建「先选目标」、框选含背景、候选不可解释 → U2；PMS 两份操作指南仍写「点保存批注」（源码是松手即创建）→ U2 时重写。
5. `comment_added` 实时无效（后端无 WS）→ §3 B3 拍板。
6. `modelSnapshotId` 在 gen-model-v1 路径恒 `null`（`ports.ts + modelRecordSource.ts` 端口契约要改，P0 遗留）。
7. `ReviewPanel.vue` / `useDtxTools.ts` 体量（方案不变量：不一次性重写，随 U1 / U2 边界拆）。
8. Phase B / D / E / F 的 flag 是零消费者的死代码，与 U0 的新开关并存会形成第三套并行数据流。

## 2. 目标与非目标

**目标**

- G1. 用户始终知道「我正在改哪一条、它属于哪张单、改动到了哪里（本机 / 云端 / 已确认）、当前关联是什么」（交互方案 §2.1 结论），且 A 任务的迟到异步结果不能改 B 任务。
- G2. 任意入口选中同一条问题三端同步，有上一条 / 下一条，单击不意外飞行；窄 iframe 关键操作可达。
- G3. 云线创建改为锚点先行 → 关联显式确认 → 再圈范围；框选背景不自动绑定；四入口同一闸门。
- G4. 后端提供任务上下文与整快照草稿接口，前端「云端已保存」只在服务端 ACK 后出现；旧服务端不支持时退回「本机草稿 + 原确认链路」并明说。
- G5. 云线 P3 / P4 按方案 §11 完成 rect / obb 共享范围体与 LOD / 合批。
- G6. 每一批都有 Playwright / vitest 可独立验收，「双胞胎面板」5 套回归不新增 fail，type-check 0 新增。

**非目标**

- 渲染引擎、四节点流程 `sj→jd→sh→pz`、ADR-0049～0053、记录 schema 只增不改、容器 V6、payload superset、三条恢复链路（交互方案 §1 不变量）。
- 复活旧 `plant-model-gen` 做两端对拍（d-408）。
- 真实可见轮廓提取（U5）本轮不排期，按证据 Go / No-Go。
- 触屏。
- 旧端 `:3100` 库迁移——除非 §6 拍板要迁，否则不做脚本。

## 3. 分批计划

### F0 · 本周收口（前端 1–2 天）

| # | 任务 | 交付 / 验收 |
| --- | --- | --- |
| F0.1 | ADR-0050 视口降级接线（`useDtxTools.ts` 在途 +168）收口：云线 / 引线 / 图钉降级样式与左上角徽标、真机过一遍 `missing / stale` 两态 | 单独一个提交；`useDtxTools.*.test.ts` 补两态用例；type-check 0 新增 |
| F0.2 | 云线 P2 真机观感走查（方案 §18 遗留：拖动手感、引线贴合、bbox3d 真实盒边、近平面穿越） | 截图进 `docs/verification/`；有观感问题按 §12.2 补 Playwright 机位而不是先改参数 |
| F0.3 | **拍板交互方案 §9 十项**（推荐列已成形），拍完 `record_decision` 入库 | 没有这一步 U0–U2 不能开工 |

### 第 1 批 · U0 + U1（前端，约 2–3 周；交互方案定的「首批最小交付」）

**U0 任务隔离 + 真实保存反馈**（方案 §3.5 / §3.6 / §7 U0 行）

- 新增 `src/review/domain/annotationScope.ts`（scope = 项目 + canonical taskId + reviewRound + 当前用户；节点 / 流程修订 / `form_id` 作上下文校验；`scopeEpoch` 每次切换递增；未取得 taskId 的新建单据用 `draftSessionId`）、`src/composables/useAnnotationDraftSession.ts`（`localRevision / sentRevision / ackRevision`）。
- 本机草稿按 scope 命名空间存，容器仍 V6；旧全局 key 受控只读、显示「未归属草稿」、不默认导入。
- 所有异步回执（截图上传、保存、高亮、相机）发布前核对 `scopeEpoch` + 操作修订号。
- 状态三行「本机草稿 / 已确认到修订 N / 处理状态」分开显示，不压进 `reviewState`。
- 顺带定：`resolveDetailsV1` 写不写回记录（方案 §6.1）；Phase G 的 `REVIEW_G_TASK_SCOPED_DRAFT` 要么接到新开关要么删。
- 开关 `annotationUx.scopedDraftsV1`；回退可退状态条与草稿 UI，scope 校验不退成全局混用。
- **不换创建顺序**（那是 U2）。

**U1 共享工作台 + 连续导航 + 窄 iframe**（方案 §3.7 / §5 / §7 U1 行）

- 新增 `src/composables/useAnnotationSelection.ts`（`activeAnnotationHandle / filteredOrderedHandles / navigationSequence`）；视口图钉、`AnnotationWorkspace` 列表、`AnnotationTableView` 行、「当前模型关联批注」结果、上一条 / 下一条都调同一个 `selectAnnotation()`。
- 单击 = 选择不飞行；「回证据视角」与「定位目标」拆两个命令（`AnnotationInlineDetailCard.vue`）；「跟随定位」可开；表格双击飞行保留为兼容；导航序号在真正设置选择与 flyTo **之前**校验。
- `DesignerCommentHandlingPanel.vue` 变成同一详情组件的 sj 外壳；「标记已处理并下一条」状态接口成功后才切换；单条复核通过**不**推进节点。
- 窄 iframe 按 iframe 内部容器宽度判断降级（方案 §5.3）。
- 开关 `annotationUx.sharedWorkspace`、`annotationUx.continuousNavigation`；回退恢复旧布局与中央 tab，保留 selection service 与 scope guard。

**验收**（Playwright 落 `e2e/`）：A 中创建并输说明，延迟截图 / 保存响应后切 B，断言 B 的记录数、截图引用、选择、相机不被 A 改；覆盖同任务新轮次、登出换用户、新建未获 taskId、localStorage 写失败；快速 A→B 且 A 加载后完成，最终相机高亮属 B；状态变化使其不再符合筛选时不跳错索引；跨分页导航；文字图钉双击仍折叠；表格双击只飞一次；多种 iframe 宽高。四类记录 × 三链路 round-trip；「双胞胎面板」5 套回归 baseline vs after 不新增 fail。

### 第 2 批 · U2 锚点先行 + 候选消歧 + 快速说明（前端，约 2 周）

- 纯函数 reducer `src/review/domain/annotationInteraction.ts` + `annotationPickCandidates.ts` **可与 U0 并行先落 + vitest**（方案 §8 第 2 条）；接线 `useDtxTools` 四个边界（单击 / `beginMarquee` / 创建提交 / 子工具返回）等 U0 的 scope guard 就位再合。
- `src/components/review/AnnotationPickCandidates.vue`（候选可解释、Tab / Shift+Tab 切、Enter 确认、输入框内 Tab 不切）、`annotationTemplates.ts`（项目常用语，插入可编辑文本，不伪造规范数值）。
- 创建后聚焦说明；错误类型草稿可未选、确认前必选；自动截图创建后恰好一次 + 缩略图 + 重拍。
- 修改 `pendingTargets` 只使「目标确认」失效，**不清有效锚点**；锚点不可换（ADR-0051）。
- 同步重写 `docs/guides/pms-cloud-element-binding-interaction-guide.md` §4 与 `cloud-element-binding-user-guide.md` §一，删「保存批注」按钮描述。
- 开关 `annotationUx.anchorFirst`、`annotationUx.pickCandidatesV2`；关新入口恢复旧「先选目标」路径。

**验收**：BRAN `24381_145018` 真机样本 + 可控遮挡夹具：普通创建先取临时锚点；确认非空 member 后才能画圈；矩形范围不加 member；同 refno 双角色 member 数不重复；重复 pointerup 只一次 `addCloudAnnotation`；创建期间 `/records` 调用 0 次；框内背景不自动绑定；改 member 不清锚点；删空临时 member 不能提交；输入法 Enter 不完成批注；四入口同一闸门。

### 后端轨道（`gen-model-refactor` 校审域；spec 与第 1 批并行，第 2 批期间落地）

| # | 任务 | 交付 / 验收 |
| --- | --- | --- |
| B1 | **U3 四条接口**：`GET /api/review/tasks/{id}/annotation-context`（`task_id / project_id / form_id? / review_round / node / workflow_revision / record_revision / allowed_actions / capabilities.{draft_snapshot_patch, record_commit_preconditions, screenshot_compare_and_set}`）；`PATCH + GET /api/review/tasks/{id}/annotation-drafts/{draftId}`（If-Match 草稿修订、`client_mutation_id`、存**完整 JSON 快照**、仅作者可恢复、不进 task_records、不推进流程、受保护字段不被整 payload 覆盖）；`POST /records` 增 `draft_id / draft_revision / base_record_revision / expected_workflow_revision / client_mutation_id` 前置条件；新表 `review_annotation_drafts` 走 ADR-075 同一持久化闸 | `docs/specs/review-api.md` 新 §；`REVIEW_CONTRACT_ROUTES` 护栏；`scripts/review/acceptance.ps1` 加判据；walkthrough 加 u5（草稿 PATCH → 确认 → 节点变更后写入被拒）；单测覆盖 If-Match 冲突 / 旧草稿不覆盖较新评论 / 处理状态。**前置**：U0 把 scope 字段名定下来（方案 §6「字段名以实施时源码为准」） |
| B2 | M4 字段并进 B1：`review_records / review_comments` 加可空 `annotation_key / workflow_node / review_round`（annotation-context 本来就要回 round / node） | `DEFINE FIELD IF NOT EXISTS`，旧记录读出为 null；schema-parity 文档更新 |
| B3 | **实时通道拍板**（§6 #2）：`/ws/review` 仍是非目标（N1）；推荐改为「`annotation-context.record_revision` 变化驱动的轻量轮询」让评论 / 处理状态跨用户可见，并把前端空转的 WS 代码收掉；要真 WS 另开 ADR | 拍板记录；若取轮询，前端 `useCommentThread` 改成按 revision 重拉 |
| B4 | 运维闭环：nginx `nginx-review-split.conf` 部署 + `nginx -t` + 同源浏览器走查；旧端 `:3100` 下线时间点（一个发布周期 ≈ 0.1.25）；是否迁旧库（要则先出 SCHEMALESS 迁移脚本 + ADR）；`review_workflow_history` 清理策略（G9） | 部署方证据；ADR-075 §未决 相应条目关闭 |
| B5 | `collision-data` 真实数据源——等碰撞生产者定；否则保持显式空集 + `reason` | ADR-075 §未决 |
| B6 | `/api/dashboard/activities`（landing-plan Q3 P2 可选） | 按需 |

### 第 3 批 · U4 余量 = 云线 P2.5 / P3 / P4（前端，按数据决定）

| # | 任务 | 交付 / 验收（方案 §11） |
| --- | --- | --- |
| P3 | 共享范围体：rect / obb 新建走 `primitiveFromPlacement`（§7），完整失效与原子重绑 member 交互（§8），旧记录不自动迁移（§14 #7） | 真 OBB / 剪切分支、部分加载、版本切换、原子重绑；开关 `annotationSharedRegion` |
| P4 | LOD（64 条全轮廓 + 图钉 / 聚合、滞回，§9.3）→ 合批（§9.2）→ inspection 遮挡淡化（复用 ADR-0061 缝，默认置顶，§10） | 合批前后几何等价、无跨线连接、调用预算；任一优化可退回 CPU 基线；开关 `annotationUx.adaptiveLod / cloudBatching / cloudInspectionFade` |
| P2.5 | 局部套索 → 范围体（§4.8，可选） | `origin:'user-volume'`；拒绝自交；开关 `cloudUserVolume` |

**U5 真实可见性**：按方案 §7 U5 的 Go / No-Go 证据决定，不排期。

### 债务轨道（持续，随批次顺手）

- Phase B（ReviewSnapshot 中间层）**要么开 SHADOW 收一周 diff=0 证据、要么删**；Phase D / E / F 的 flag 接不上就删（`flags.ts` + `reviewSnapshotService.ts`），避免与 `annotationUx.*` 形成第三套并行数据流。
- type-check 基线 623 条按文件消化，每批用 `npm run type-check:update-baseline` 收紧；不得为放行新错误改基线。
- `useDtxTools.ts` 云线部分随 U2 / P3 边界抽到 `src/review/render/`；`ReviewPanel.vue` 随 U1 抽出编辑会话；都不一次性重写。
- `modelSnapshotId` 透传（`src/model-source/ports.ts + modelRecordSource.ts`）单独一小步。
- e2e：U0–U2 的 Playwright 落 plant3d-web `e2e/`；gen-model `scripts/review/walkthrough` 保持 API 契约走查，两套互不替代（方案 §8 第 7 条）。

## 4. 验收标准（第三方可独立判真假）

| # | 判据 | 怎么判 |
| --- | --- | --- |
| V1 | F0.3 拍板后决策库有一条覆盖交互方案 §9 十项的决策，方案文件头部状态由「待产品拍板」改为已拍板 | 决策 id + 文档 diff |
| V2 | U0：在任务 A 创建并输说明，延迟保存 / 截图回执到达时已切到 B，B 的记录数、截图引用、选择、相机与切换前逐字节相同；旧全局 key 的草稿显示为「未归属」且不进任何任务 | Playwright 用例 + 断言日志 |
| V3 | U1：任一入口选中同一条，视口图钉 / 列表 / 表格三端 `data-active` 同步；单击 0 次 flyTo；上一条 / 下一条在当前筛选内循环；快速 A→B 最终相机属 B | Playwright |
| V4 | U2：创建期间 `/api/review/records` 请求数 = 0；框选背景 refno 不进 `bindings.member`；重复 pointerup 只产生一条记录；改 member 后锚点坐标不变 | Playwright + network 断言 |
| V5 | B1：`annotation-context` 200 且键集与 spec 一致；草稿 PATCH If-Match 不匹配回 409；节点变更后 `/records` 带旧 `expected_workflow_revision` 被拒；重启后草稿可读（rocksdb 档）；mem 档草稿路由与四前缀同样 503 | `acceptance.ps1` 新判据 + walkthrough u5 |
| V6 | 每批：`npx vitest run` 全绿；`npm run type-check` 0 新增；「双胞胎面板」5 套回归 baseline vs after 不新增 fail；四类记录 × 三链路 round-trip 全绿 | 命令尾行贴进 §9 |
| V7 | P3 / P4：合批前后轮廓坐标逐点相等（容差 0.5 px）；LOD 超预算时业务数量不变；静止 120 帧零重建仍成立 | vitest + `debugCloudRenderStats()` |

## 5. 风险

| 风险 | 处置 |
| --- | --- |
| §9 十项迟迟不拍板，U0–U2 停在门口 | F0.3 放本周；推荐列已成形，全按推荐拍板即可开工 |
| U0 的 scope 字段名与 B1 的接口字段两边各起一套 | U0 先落 `annotationScope.ts` 定名，B1 spec 引用它；spec 草案先于实现进 `review-api.md` |
| `useDtxTools.ts` 同时被 P2 收口、ADR-0050 接线、U2 接线三方改 | U2 接线等 F0.1 提交后再开；接线前 `git log -- useDtxTools.ts` 对一次；协同组内走写锁 |
| 新开关 `annotationUx.*` 与旧 `REVIEW_*` flag 并存，形成三套并行数据流 | 债务轨道第一条：B / D / E / F 要么接上要么删，在 U0 合入前定 |
| 后端主线工作树有他人在途改动，B1 合入被脏树拒 | 按 landing-plan Q3 做法：在独立 worktree 上开发，合入时只带自己的路径 |
| 云端草稿上线后旧草稿覆盖较新评论 / 处理状态 | B1 服务端沿现有权威合成或明确返回冲突（方案 §6.2）；前端修订 7 的 ACK 到达时已编辑到 8 须继续显示「有未同步修改」 |
| mem 档下开发者以为校审坏了 | 已写进联调指南 §9 与 `.env.development` 注释；B1 的新路由沿同一 503 口径 |

## 6. 需要拍板

> **2026-09-14 23:0x 已拍板：五项全按「推荐」列（用户答复「§6 五项全按推荐拍板（含交互方案 §9 十项）」）。**「备选」列保留为被否决方案的记录；改任一项另起决策 supersede 对应 id。

| # | 决策 | 推荐（= 定稿） | 备选（已否决） | 决策 id |
| --- | --- | --- | --- | --- |
| 1 | 交互方案 §9 十项 | 全按方案推荐列 | 逐项另议（每项都会推迟 U0–U2 开工） | d-565 |
| 2 | 评论 / 处理状态的跨用户可见 | `annotation-context.record_revision` 驱动的轻量轮询，收掉前端空转 WS | 实现 `/ws/review`（要另开 ADR，改 N1） | d-567 |
| 3 | 旧端 `:3100` 库 | 不迁（新端从空库开始，旧端保留一个周期只读） | 出 SCHEMALESS 迁移脚本 + ADR 迁一次 | d-569 |
| 4 | Phase B / D / E / F 死 flag | 删（U0 合入前）；Phase G 由 U0 的 `annotationScope` 取代 | 开 SHADOW 收一周证据再定 | d-571 |
| 5 | `resolveDetailsV1` 是否写回记录 | 不写（结果只在内存，避免旧写端再保存时带上过期解析态） | 写回并带 `modelSnapshotId` | d-573 |

## 7. 顺序与依赖

```
F0.1 / F0.2（收口） → F0.3（拍板 §9）
  → U0 ∥ U2 纯函数 reducer ∥ B1 spec 草案
  → U1
  → U2 接线 ∥ B1 / B2 落地
  → U3（前后端合：云端草稿、确认修订、截图竞争）
  → P3 → P4（∥ P2.5 可选）
  → U5 按证据 Go / No-Go
B3 / B4 与第 1 批并行拍板与部署；B5 / B6 按需。
```

## 8. 参考

- 前端：`docs/plans/2026-09-14-3d-annotation-interaction-redesign-proposal.md`、`docs/plans/2026-09-14-cloud-annotation-3d-region-redesign.md`（§11 / §14 / §16–§18）、`docs/plans/2026-07-28-cloud-annotation-element-binding-plan.md`、`开发文档/三维校审/三维校审当前实现-Gap分析与完善建议-2026-04-19.md`、`src/review/flags.ts`、`src/review/domain/*`、`src/composables/{useToolStore,useDtxTools,useAnnotationBindingResolve,useCloudRenderFlags}.ts`
- 后端：`gen-model-refactor/docs/plans/2026-09-12-review-backend-port-plan.md`、`docs/plans/2026-09-14-review-closure-landing-plan.md`、`docs/adr/ADR-075-review-data-persistence.md`、`docs/specs/review-api.md`、`docs/evidence/2026-09-14-review-closure.md`、`src/web_service/review/*`、`scripts/review/{acceptance.ps1,walkthrough}`
- 联调：`docs/guides/gen-model-v1-local-dev.md` §9
- 决策：d-398（mem 档 503）、d-408（PASS-静态）、d-410（闸在单测里活着）、d-412（主线唯一 gen-model-refactor）

## 9. 落地记录

（随各批交付追加：日期 · 任务 · 改动文件 · 验收条目 · 与本文口径的偏离及 ADR 编号）

- 2026-09-14 · 本文起草（fable-5-1-33）：只读分析，未改业务代码；现状 §1 以 `plant3d-web@b5fb047`、`gen-model-refactor@9b972644e` 为准。提交 `fdcb525`。
- 2026-09-14 23:0x · **§6 五项全按推荐拍板**（用户，fable-5-1-33 会话记录）：d-565（交互方案 §9 十项）、d-567（revision 轮询，不建 WS）、d-569（旧库不迁）、d-571（删 B/D/E/F 死 flag，G 由 U0 取代）、d-573（`resolveDetailsV1` 不写回）。交互方案头部状态与 §9 表头同步改为已拍板。F0.3 ✅。
- 2026-09-14 23:4x · **U0 第一步：纯函数与单测先落，不接 UI**（fable-5-1-33）· 新增 `src/review/domain/annotationScope.ts`（scope = 项目 + canonical taskId / draftSessionId + reviewRound + 用户；`buildAnnotationScope` 两者皆无时抛错不退回全局；`annotationScopeKey` 五段 `v1|project=|task=/session=|round=|user=` 逐段转义可逆；旧 `project=…|db=…` / `__default__` 只识别为「未归属草稿」；`nextScopeEpoch` 同 scope 不递增；`judgeScopeStamp` 三种拒收 `no-scope / scope-changed / epoch-stale`；`diffScopeContext` 节点 / 流程修订 / form_id 只校验不进身份）、`src/composables/useAnnotationDraftSession.ts`（纯 reducer `applyDraftSessionEvent` 三维度：本机 `localRevision / persistedLocalRevision / 写失败`、云端 `sent / ack / mutationId 对账`、正式 `confirmedRevision`；`deriveDraftSaveStatus` 出三行状态文字，云端不可用时那一行为 null；不可能的事件原样返回旧状态；响应式外壳 `createAnnotationDraftSession` 的 `enterScope` 幂等 / 换 scope 重置 + epoch+1、`dispatch(event, stamp)` 带戳拒收）· 验证：`npx vitest run` 两个新文件 **36/36**；`npx eslint` 四文件 0 错误（`--fix` 调一次 import 顺序）；`npm run type-check` 本次改动文件 **0 新增**（唯一 1 条基线外在未触碰的 `resolveLabelCollisions.test.ts`，HEAD 既有）· 未做：接 `useToolStore` 草稿 key / `ReviewPanel` 状态条 / 截图与保存回执盖戳（U0 第二步）；`localStorage` 未碰。
- 2026-09-15 00:1x · **U0 第二步：草稿容器接 scope 命名空间 + 旧容器只读提示 + 开关**（fable-5-1-33）· 新增 `src/composables/useAnnotationUxFlags.ts`（`annotationUx.scopedDraftsV1` 默认开；URL `?annotation_ux=scopedDraftsV1:0` / localStorage `plant3d.annotationUxFlags`，与云线渲染开关两套）；`useToolStore.ts`：`annotationDraftScope` + `setAnnotationDraftScope(scope|null)`（幂等；变了先把内存状态刷进旧 key、再从新 key 载入——deep watch 异步刷盘，同 tick 最后一笔编辑不刷会跟进新容器）+ `resolveStorageScope()`（开关开 + 有 scope → `annotationScopeKey`，否则旧 `project=…|db=…`）+ `getUnattributedDraftSummary()`（只读窥视旧容器 V7/V6 原文数四类条数，不 normalize、不触发尺寸归档、不导入）+ 刷盘抽成 `writePersistedSnapshot(scope)`；新增 `src/composables/useAnnotationDraftScopeSync.ts`（任务 / 用户 / 项目 → scope，`flush:'sync'` 抢在面板 `watch(currentTask)` 的确认记录回放前切容器；没有任务用本 tab 的 `draftSessionId`（`sessionStorage` 记）顶替，旧容器在校审面板打开期间永远不再被写；round 只认任务显式 `reviewRound`（今天恒 0），**不**从 workflowHistory 数 return 推——列表 / 详情两路 history 有无不一致会劈 key；宿主卸载回 null）；新增 `src/components/review/UnattributedDraftNotice.vue`（`data-testid="annotation-unattributed-draft-notice"`，「未归属草稿（项目 x）：文字 n · 云线 m（共 N 条）—— 只读、不导入」，store mock 缺成员时静默）；`ReviewPanel.vue` 只加 3 行：import、`useAnnotationDraftScopeSync({ userId: () => currentReviewUserId.value })`、`<UnattributedDraftNotice />` 放在统一批注单上方 · 验证：新增 `useToolStore.draftScope.test.ts` 7 例（含「A→B 同 tick 最后一笔编辑刷进 A 的 key」「开关关只记不生效、开回 refresh 接上」）+ `useAnnotationDraftScopeSync.test.ts` 7 例；「双胞胎面板」5 套 + `ReviewPanel.componentLinkage` + 全部 `useToolStore.*` 共 **19 文件 / 238 例全绿**（baseline 无 fail、after 无 fail）；`npx eslint` 改动文件 0 错（`--fix` 两处 import 顺序 + 模板属性换行）；`npm run type-check` 本次改动文件 **0 新增**（2 条基线外分别在他人在途的 `useDtxTools.ts:4360` 与 HEAD 既有的 `resolveLabelCollisions.test.ts`）· 已知边界 / 未做：`DesignerCommentHandlingPanel` / `InitiateReviewPanel` 未装同步（sj 侧下一步）；`restoreConfirmedRecordsIntoScene` 仍是整份 `importJSON` 替换 / 空则 `clearAll`，任务切回时本机未确认草稿会被服务端确认记录顶掉——这是 U0「草稿 / 已确认分层合并」那一步要改的，本步不碰；URL 项目变化不重算 scope 的 projectId；截图 / 保存 / 高亮回执盖戳（`judgeScopeStamp`）未接。`useToolStore.ts` 只提交本步 9 个 hunk（他人在途的 `LineAngleMeasurementInfo` 两个 hunk 留在工作树）。
- 2026-09-15 05:3x · **d-571 落地：删 Phase B / D / E / F / G 零消费者 flag**（fable-5-1-38）· `src/review/flags.ts` 只剩 `REVIEW_C_COMMENT_THREAD_STORE_CUTOVER / REVIEW_C_EVENT_LOG / REVIEW_H_LOG_DRAWER`；删 `src/review/services/reviewSnapshotService.ts`（+ 测试）——它只为 B 的 SHADOW 双跑 diff 存在，三处调用（`confirmedRecordsRestore.ts` / `embedFormSnapshotRestore.ts` / `ToolManagerPanel.vue`）改为直接 `buildSnapshotFrom*`（这一支本来就是 `shadowResult?.snapshot ?? build…` 的兜底，行为不变）；`ReviewSnapshot` 域类型与三个 adapter 保留（Phase C 评论线程 store 的 `mergeFromSnapshot` 仍靠它们）。`flags.test.ts` 改用 `REVIEW_H_LOG_DRAWER` 当覆盖用例 + 一条「只剩 C / H」的断言 · 验证：`flags.test.ts` 9/9、`ToolManagerPanel.import.test.ts` 1/1、`confirmedRecordsRestore.test.ts` 8/8 · 留意：`REVIEW_C_EVENT_LOG` 也是零消费者（事件日志没门控），不在 d-571 范围，未动。
- 2026-09-15 05:3x · **U0 第三步：三行状态条 + 本机草稿流水 + sj 侧两面板装同步 + 多宿主**（fable-5-1-38）· `useToolStore.ts`：`writePersistedSnapshot` 改为回报 `{ ok } | { ok:false, error }`（不再吞 `QuotaExceededError` / 存储不可用）；新增 `annotationDraftJournal`（`revision` 四类批注数组每变一次 +1——用户编辑、程序性载入 / 导入 / 清空都算，它记的是「容器内容变了几次」；`persistedRevision / failedRevision / error / storageScope`），批注修订 watch 注册在刷盘 watch 之前，同一次 flush 先记「变了」再记「写进去了」；切 scope 前那次旧 key 刷盘也记流水。`useAnnotationDraftScopeSync.ts` 重写为**宿主登记表 + 一份共享同步**：ReviewPanel / DesignerCommentHandlingPanel / InitiateReviewPanel 在 dock 里同时开着各登记一次，最后一个卸载才回 null（原先任一面板卸载就把 scope 打回 null，会把还开着的面板踢回旧容器）；userId / projectId 按登记顺序取第一个给出值的宿主；`annotationDraftJournal` 每变一次派发进 `useAnnotationDraftSession`（`edit` / `local-persisted` / `local-persist-failed`，`flush:'sync'` 让旧容器刷盘回执落在旧 scope 会话里）。新增 `src/components/review/annotationDraftStatusRows.ts`（纯函数：三行文案与语气）+ `AnnotationDraftStatusBar.vue`：**本机**「无草稿 / 未存 / 已存 / 已存 · 未落库 / 写入失败 + 原因」——「未落库」只在与最近确认记录不一致时加；**云端草稿** U3 前 `capability='unavailable'` 那一行不显示；**已确认**「未确认 / 未确认 · 有待确认内容 / 已确认到修订 N（最近 HH:mm）/ … · 有未确认修改」，一致性按内容比（面板 `hasUnsavedChanges`，与「确认当前数据」按钮同口径），**U3 前「修订 N」= 本任务确认记录条数**，U3 后换服务端 `record_revision`。`ReviewPanel.vue` 加 4 行接线（状态条放「确认操作」块上方，`canCreateReviewEvidence && (currentTask || isExternalFormFocused)` 时显示）；`DesignerCommentHandlingPanel.vue` 装同步 + `<UnattributedDraftNotice />`；`InitiateReviewPanel.vue` 装同步（没任务时草稿落本 tab 的 `draftSessionId` 容器，不再写旧 project|db 容器）· 验证：`annotationDraftStatusRows.test.ts` 6 例、`useAnnotationDraftScopeSync.test.ts` 9 例（新增多宿主 / 流水→会话 两例）、`useToolStore.draftScope.test.ts` 8 例（新增流水成功 / 配额满失败 / 恢复）、`ReviewPanel.test.ts` +2 例（状态条空态 / 有确认记录报修订 1）；`src/review + src/components/review + src/components/tools + src/composables` 全量 **157 文件 / 1501 例**两次连跑全绿（其间一次 1 失败为网络 / 时序类偶发，第二、三次未复现）；`npx eslint` 改动文件 0 错；`npm run type-check` 本次改动文件 **0 新增**（唯一 1 条基线外仍是 HEAD 既有的 `resolveLabelCollisions.test.ts`）· 已知边界 / 未做：`restoreConfirmedRecordsIntoScene` 仍是整份 `importJSON` 替换（草稿 / 已确认分层合并，U0 下一步）；截图 / 保存 / 高亮 / 相机回执盖戳（`judgeScopeStamp`）未接——`restoreConfirmedRecordsIntoScene` 自带的 taskId / formId 复核是它目前唯一的守卫；URL 项目变化不重算 scope 的 projectId；`InitiateReviewPanel` 创建任务后 `resetForNewTask()` 的 `clearAll()` 清的是当时生效的容器（创建流程不改 `reviewStore.currentTask`，所以仍是 session 容器，行为与旧版一致）。`useToolStore.ts` 只提交本步 5 个 hunk（他人在途的 `LineAngleMeasurementInfo` 两个 hunk 仍留在工作树）。
