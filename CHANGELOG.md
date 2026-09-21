# 更新日志

## [未发布]

### 变更

- **版本对比的三维按「模型几何差异」着色，单视口加版本角标，新增「三维只看差异」** (2026-09-21)
  - 从前 A 整侧蓝、B 整侧绿，只说明版本身份，哪件变了三维里看不出（面板算好的 `rows` 进了 ViewerPanel 却没人用）。现在每一版内部按四态上色：修改琥珀 / 新增翠绿（只在 B）/ 删除玫红（只在 A）/ 未变石板灰，与面板徽章、模型树差异模式同一套色（ADR 0066「三维联动」的落地，CONTEXT「模型几何差异」加了一句）。
  - 视口角标：单视口一枚跟着当前显示的版本（「B · sesno 630」），分屏两枚照旧；角标下只读图例列四态计数，「只看差异」开着时多一枚标签。
  - 面板「三维查看」节新增「三维只看差异」：隔离图层里藏掉两版都没变的构件，只改显隐不重装几何，分屏两侧同样生效；没有几何差异时置灰。与列表「包含未变化」同一口径、各自开关。
  - 单视口里点到 A / B 那版的构件，右侧属性面板读的是**那一版**的属性（`history/query tool=attributes`，与树差异模式底部同一取数口），标题下注明「属性来自版本 A · sesno n」；从前隔离图层的构件根本点不到（GPU 拾取只认主图层）。`useSelectionStore` 新增「版本钉住」选中，任何正常选中复位，退出对比一并清掉。
  - 验证：vitest 39 过（纯函数 +2、面板 +1、属性面板钉住 +2、属性折算 +2）、type-check 基线外 0 新增、e2e `model-version-compare-gen-model-v1.spec.ts` 两个夹具各 4 过；真机截图 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/3d-diff-color/`（README §8 / §8.1，plan §11 / §11.1）。

- **legacy 模型数据源退役：前端只剩 gen-model `/api/v1`，旧后端 `:3100` 相关代码、依赖与 UI 入口一并删除** (2026-09-20)
  - 生产当天切到 gen-model（ADR 0054 2026-09-18 追记定的锚）：删 `src/model-source/legacy/` 与 `?model_source=` / `VITE_MODEL_SOURCE` 开关，`ModelSourceKind` 只剩 `'gen-model-v1'`，`getModelSource()` 进程内一份。
  - 删整条 parquet / DuckDB-WASM 链（`useDbnoInstancesParquetLoader`、`genModelE3dParquetApi`、`usePtsetRuntimeLookup`、`duckdbBundles`、`useDuckDBModelLoader`、`useParquetSqlStore`、`useSceneTreeLoader`、`public/duckdb`，依赖 `@duckdb/duckdb-wasm` `apache-arrow` `parquet-wasm` `surrealdb`）与 `.glb` 网格分支；`lib/filesOutput.ts` 只剩当前工程状态，改名 `lib/currentProject.ts`。
  - 删旧后端取数模块 `genModelE3dApi` / `genModelSearchApi` / `genModelIndexTreeApi` / `pipelineAnnotationApi`，`genModelPdmsAttrApi` 只留类型 + 由 v1 实现的 `pdmsGetTransform`；调用方（`useReviewDeliveryUnit` `measurementPathLookup` `measurementSnapLabel` `InitiateReviewPanel` `usePdmsConsoleCommands` `ViewerPanel` `PtsetPanelDock`）改走 `getModelSource()` 的 tree / attributes / keypoints 端口。`useModelProjects` 改读 `/api/v1/health.project`（gen-model 一个进程一个项目）。`usePipeDistanceStore.autoDetectBrans` 由旧后端 `/api/space/nearest-points` 一发算全部目标，改为逐对调 `/api/v1/spatial/surface-clearance`（`target_kind=any`），某一对 `result: null` 或 404 只记 warning、不拖垮整批。`genModelSpatialApi.ts` 只剩类型。「关于」对话框的后端版本改读 `/api/v1/health` 的 `version` + `build_id`（`<semver>+g<commit>.<unix 秒>`），旧 `/api/version` 在 gen-model 上是 404。
  - gen-model 没有对应接口的旧后端功能拨掉 UI 入口（D1）：房间树页签 / 房间计算 / 房型房间信息、`/api/space/*` 六个支架场景（「空间计算」Dock 只剩 BRAN 中心线净距，改名「中心线净距」）、MBD v2 外部尺寸（含 `useMbdExternalSync` / 诊断面板 / `mbd-v2` 夹具 / vite 夹具通道）、工作台 / 项目卡片首页、任务创建 / 监控 / 模型导出、增量更新面板、校审日志抽屉、站点注册、Parquet SQL 调试页签、SurrealDB 直连基准页（`BenchmarkView` / `?benchmark`）、模型树「过滤结果分组」；`usePanelZones.ZONE_PANELS` 同步到 DockLayout 实际注册的面板集合；`useModelGeneration` / `useSpatialQuery` / `useDbnoInstancesDtxLoader` 里 realtime / parquet / SSE 回退路径删除。
  - 配置与部署：`vite.config.ts` 去掉 DuckDB 资产管线与 MBD 夹具，dev `/api` 代理指 `:8022`；`deploy/nginx_remote.conf` `/api` → `:8022`，`/files/` 整前缀兜底到 `:8022`（附件那条 `/files/review_attachments/` 由后端分流片段 `aios-review-split.conf` 提供，站点文件不能再写同名 location——真机 `nginx -t` 报 duplicate location 后改成更短前缀兜底）；`deploy-ubuntu.yml` / `deploy_frontend_bundle.sh` / `deploy/README.md` 的 `BACKEND_ORIGIN` 缺省 `http://127.0.0.1:8022`。`tsconfig.app.json` 显式加 `"node"` types——此前 `@types/node`（含 `Array.prototype.at`）是被 DuckDB 依赖顺带拉进全局的。
  - 测试：删 legacy 专用用例（parity 的两源对拍、`?model_source=legacy` 路由、`spatial-query-real-bran` 真机、`dimension-real-ams-bran-version`、`dimension-mbd-v2-fixture`），其余改成 mock `getModelSource()`；`npm run type-check` 基线之外只剩 worktree 绝对路径 / 联合类型顺序两类签名差异（非新错误），vitest 全量与改前基线对比见提交说明。

- **云线批注改为世界锚定 billboard，并每帧贴合关联构件的屏幕投影** (2026-07-31)
  - `screen2d` 云线此前画在 HTML/SVG overlay 上，只有锚点参与相机投影：云线本身与三维层割裂，无法参与深度排序，尺寸恒定为拖框时的像素值。相机一转，被框住的构件就跑到云线外面，云线不再指认它所标记的东西。现在改为在 WebGL 里绘制世界锚定的 billboard 云线，与 `bbox3d` 同处一个渲染层。模式名与 `anchorWorldPos` / `screenOffset` / `cloudSize` 数据字段保持不变，数据模型未动。
  - `buildCloudBillboardPolyline()` 每帧用相机 right/up 基向量在世界空间展开波浪折线；`worldPerPixelAt()` 做像素→世界换算，使线宽与波幅在推拉相机时保持恒定像素观感。billboard 平面深度取关联 AABB 中心的 ndcZ，让像素→世界换算与投影落在同一深度。
  - 新增 `computeFittedCloudRectFromCorners()`：每帧把关联构件合并 AABB 的 8 个角投影到屏幕求 2D 外接矩形，再外扩 `CLOUD_FIT_PADDING_PX = 14`，保证任意机位下被绑定的构件都落在云线框内。**拖框尺寸由「云线尺寸」降级为最小尺寸兜底**；AABB 缺失、或有角点越过近/远平面（相机钻进目标内部）时，回退到锚点 + 偏移的固定尺寸布局。
  - 新增 `cloudWavesPerEdgeForSizePx()`：贴合矩形放大后波峰数按边长像素折算（钳制 4–40），避免大框上的波浪被拉成长弧；旧拖框尺寸区间（120×72 至 220×180）仍是 4 峰，观感不变。
  - `bbox3d` 的 `bboxEdges` 由 `depthTest: true` 改为 `false`，与 billboard 云线统一为常显语义。批注的职责是确定性地指认目标，被前景管道挡住的云线等于没有批注；密集管廊里这是常态而非边缘情况，空间纵深改由 `bbox3d` 自身的透视形变表达。
  - 删除替换后已无消费方的 SVG 残留 `createCloudPath()` 与 `CloudLayout.cloudPath`，以及 `useDtxTools.pickRefno.test.ts` 中针对该 SVG path 的断言。`computeCloudLayout()` 保留——创建云线时仍用它算 `screenOffset` 与引线终点。
  - 验证：新增 `useDtxTools.cloudFit.test.ts`（11 例），其中一组绕目标换 5 个机位、断言投影角点始终落在贴合矩形内。全量 `npx vitest run` 为 19 文件/45 用例失败，低于 CHANGELOG 记录的 22 文件/48 用例基线，失败集合全部落在校审流程、annotation severity、duckdb、parquet 等其他在建工作流，云线相关用例全绿；改动范围内 `eslint` 零问题（顺带修掉本次云线代码引入的 3 处 `@typescript-eslint/array-type`），`vue-tsc` 无新增问题。

- **几何数据源收口到 DuckDB WASM + parquet，删除 JSON 加载通道** (2026-07-31)
  - 几何实例此前有 parquet(DuckDB WASM) / backend / json 三条加载路径并存，`instances_{dbno}.json` 与 parquet 产物可能不同步，排查现场问题时很难判断当前渲染的是哪一份数据。现在只保留 DuckDB WASM 查 parquet 一条主路，backend 实时查库保留作为 parquet miss 的回填手段。
  - 删除 `composables/useDbnoInstancesJsonLoader.ts`。该文件名有误导性——一半内容是与 JSON 加载无关的 SSE 生成触发器，已先把 `triggerBatchGenerateSse` 及其类型拆到新增的 `api/genModelStreamGenerateApi.ts`（`useSpatialQuery` / `useModelGeneration` 在用）。随文件一并移除的 `triggerSubtreeGenerateSse`、`waitForDbnoInstancesFile`、`ensureDbnoInstancesAvailable`、`getDbnoInstancesMeta`、`setDbnoInstancesManifest` 均已无调用方。
  - `useDbnoInstancesDtxLoader`：`dataSource` 由 `'parquet' | 'backend' | 'json'` 收窄为 `'parquet' | 'backend'`，删除 json 分支。
  - `useModelGeneration`：删除 `prepareJsonManifestForFallback` 与整段 JSON 回退加载；parquet 不可用时直接抛错，不再静默降级到 JSON 后以"加载完成 (JSON)"收场。
  - `ViewerPanel`：`show_refno` / `debug_refno` 控制台命令的 `data_source` 参数只接受 `parquet|backend`，默认 parquet；`debug_refno` 原先会探测 parquet 可用性并回退 json，该逻辑一并移除。
  - `genModelE3dApi.getE3dSource()`：默认值由 `'backend'` 改为 `'parquet'`。带 `tree_sesno` 的版本模式仍强制走后端——parquet 产物只有 latest 态，历史版本树无法由它提供。
  - 后端配套改动见 `plant-model-gen` 同日条目：`/api/e3d/visible-insts` 同步去掉 JSON 与 SurrealDB 回退，改为 parquet 单源，与前端查询同一批产物。
  - 验证：全量 `npx vitest run` 与 HEAD 基线逐条对比，失败集合无新增（基线 22 文件/48 用例，改后相同，且 `FileUpload.test.ts` 反而转绿）；改动范围内 `vue-tsc` 与 `eslint` 零新增问题。

- **房间树交付单元继续展开 E3D 子层级** (2026-06-23)
  - 房间树支持 `room-item:{room}:{refno}` 虚拟节点，BRAN/EQUI 等最小交付单元下继续显示原始模型树子节点。
  - 房间树节点保留真实 `refno`，隐藏/显示、属性、点集和定位操作继续作用于真实模型节点。
  - AvevaMarineSample R301 验证：BRAN 下可展开到 `STRT/BEND/TEE/ATTA`，DOM `data-refno` 为真实 refno。

- **校审页日志抽屉 — 四类日志统一查看** (2026-06-11)
  - 新增 flag `REVIEW_H_LOG_DRAWER`(默认关闭)门控的日志抽屉:校审页右下角悬浮入口,tab 按类型切换,默认过滤当前 form_id/task_id,支持手动刷新、5s 轮询与游标加载更多
  - 类型 tab 由后端 `/api/logs/types` 按角色动态下发:校审流转历史(全部角色)、接口 request/response 日志、进程运行日志、站点文件日志 parse/generate/db/web/viewer(管理角色)
  - 接口日志条目可展开查看脱敏后的请求/响应体;站点日志无需传 site_id(后端默认当前站点),抽屉标题显示当前站点名(`/api/site/identity`,失败静默)
  - 新增 API 客户端 `src/api/logsApi.ts`(vitest 3 例)与组件 `src/components/review/LogDrawer.vue`;`ReviewPanel.vue` 挂载,flag 关闭零行为变化
  - 新增 Playwright 冒烟脚本 `debug_scripts/log-drawer-smoke.mjs`(开 flag → 打开抽屉 → 断言 tab 与数据 → 截图 artifacts/)
  - 对应后端 plant-model-gen specs/003~005(接口日志采集、统一查询 API、站点兜底、进程内运行日志)

- **移除 MBD 尺寸标注前端实现** (2026-06-02)
  - MBD 管线面板移除“尺寸”页签、尺寸统计、尺寸显示开关和相关设置项。
  - 三维标注渲染不再绘制 MBD segment/chain/overall/port 尺寸与弯头角度尺寸，交互层同步移除 `mbd_dim_*` 选中、拖拽和上下文菜单入口。
  - Ribbon 删除 MBD 尺寸命令组；MBD V2 前端类型契约移除 `linear_dim` / `angle_dim` 图元及类型守卫。
  - API 适配层忽略后端残留线性尺寸数据，避免旧数据继续进入前端 UI。

- **测量关键点(ptset)捕捉 — hover 显示 + 自动吸附** (2026-05-28)
  - 测量（距离/角度/点标高/高差）时，鼠标 hover 构件会按 refno 拉取其关键点（ptset：管端/法兰中心/喷嘴等连接点）并以绿色十字显示；光标靠近关键点时落点自动吸附到该点精确坐标
  - 新增吸附引擎 `usePtsetSnap` 与纯换算模块 `utils/three/ptsetTransform.ts`（场景坐标换算链与 `usePtsetVisualizationThree` 完全一致，保证吸附点与显示十字对齐），含 9 个单测
  - 吸附统一注入测量取点的唯一咽喉 `pickSurfacePoint`，预览与最终落点同时生效，四种测量模式通用；hover 取数带 80ms 防抖、按 refno 缓存与 in-flight 去重
  - `MeasurementPanel` 样式设置新增「关键点捕捉」开关与像素阈值（默认 12px），持久化到 `useXeokitMeasurementStyleStore`；吸附到关键点时标记/lens 用独立绿色并显示点号
  - 涉及文件：`composables/usePtsetSnap.ts`、`utils/three/ptsetTransform.ts`、`composables/useXeokitMeasurementTools.ts`、`composables/useXeokitMeasurementStyleStore.ts`、`composables/xeokitMeasurementUi.ts`、`components/tools/MeasurementPanel.vue`；设计文档 `goals/ptset-hover-measure-snap/`
  - 验证：全量 `npm run type-check` 通过；`usePtsetSnap`(9) 与 `xeokitMeasurementUi`(2) 单测通过

- **RUS-239 驳回后重新流转 — UX 增强与健壮性提升** (2026-05-08)
  - 设计批注处理面板新增**驳回原因提示框**：当任务被校核驳回时，在任务级动作区域顶部显示醒目的 amber 提示框，展示驳回原因并引导用户处理批注后点击「流转回校对」
  - 「流转回校对」按钮就绪态增加 ring 高亮效果，禁用态 title 属性说明具体原因（未处理批注 / 未保存证据）
  - 有未保存证据数据时额外显示 amber 警告提示
  - `workflowBridge.ts` 新增 `notifyParentWorkflowActionWithAck()`：发送 workflow action 后等待父窗口回执（`plant3d.workflow_action_ack`），5 秒超时返回 `'timeout'`，便于调用方在 PMS 未响应时回退到备选方案

- **校审外部流程默认模式与编译期开关** (2026-05-12)
  - 新增 `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE` 编译期开关，默认关闭；关闭时 `workflow_mode=manual/internal`、session/local storage 和 embed 参数都不会把前端切到内部主动模式
  - 发起编校审面板在外部流程模式下只保存 task 并发送 `plant3d.form_saved`，不再调用内部 `submitTaskToNextNode` 抢先把单据从 `sj` 推到 `jd`
  - `authGetToken` 与 PMS embed payload builder 不再发送 `workflow_mode`，公开校审 API 不再靠额外参数判断内部/外部模式
  - 保留内部主动模式作为显式编译产物能力：仅设置 `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE=1/true` 时兼容旧的 manual/internal 调试入口
  - 验证：`npm run type-check` 通过；后端默认/内部 feature 双向 HTTP smoke 均符合预期

- **RUS-239 驳回后重新流转修复** (2026-04-30)
  - 新增外部流程桥接判断，仅在 PMS/仿 PMS 嵌入模式下向父窗口发送 `plant3d.workflow_action`
  - 设计批注处理页“流转回校对”和任务详情“再次提交”接入 `workflow/sync active` 语义，避免外部流程场景继续走内部 submit
  - 仿 PMS runner 在发起后关闭额外 `3d-view` 页面并降低诊断等待耦合，`bran-mixed` 已验证通过至 `PZ approve`
  - 保留独立/内部模式的旧提交流转路径，并补充 RUS-239 计划、发现和执行记录

- **RUS-238 测量路径展示增强** (2026-04-30)
  - 测量列表、确认测量回放和批注测量证据支持异步展示模型树完整路径
  - 新增统一展示层 `useMeasurementPathSummaries`，保持 refno fallback，路径解析成功后再替换为完整路径
  - lookup 失败、模型树数据不可用或历史记录缺上下文时继续显示规范化 refno，不影响定位、隐藏、删除和回放行为
  - 补充 RUS-238 UI 接入、验收与 PMS/编校审后续验证计划文档

- **RUS-238 推送后验收规划** (2026-04-30)
  - 新增 planning-with-files 规划目录，沉淀任务计划、findings、progress、验收输入清单和工作区盘点
  - 新增自包含 HTML/SVG 流程图，说明从验收输入收集到 PMS/编校审验收与工作区收敛的路径
  - 明确真实验收继续依赖 BRAN、PMS 包名/任务单、角色和入口输入

- **RUS-238 仿 PMS 验收记录** (2026-04-30)
  - 使用 BRAN `24381_145018` 跑通 approved 主链，最终 `status=approved` / `node=pz`
  - restore 场景中 BRAN、测量和确认记录读回通过，剩余失败定位为刷新前评论内容 UI 断言
  - Chrome CDP full flow 通过真实 PMS 入口创建三维校审单，并在嵌入站点接口命中包名或 BRAN

- **批注错误类型替换** (2026-04-27)
  - 将批注"严重度"体系（致命/严重/一般/建议）替换为"错误类型"体系
  - 新增三种错误类型：原则错误（×）、一般错误（△）、图面错误（○）
  - 涉及文件：`auth.ts`、`AnnotationPanel.vue`、`AnnotationOverlayBar.vue`、`useToolStore.ts`

### 重构

- **审核面板 split / table 数据源统一** (2026-05-18)
  - `ReviewPanel.vue` 的卡片列表 split 视图与批注表格 table 视图共享单一原始来源 `scopedReviewerItems: AnnotationWorkspaceItem[]`
  - 删除本地 `AnnotationListItem` 类型定义、`allAnnotationItems` computed、`findAnnotationListItemFromWorkspace` 反向适配器（净 -81 行）
  - 卡片列表 handler `toggleAnnotationDetail` / `flyToAnnotationItem` / `getAnnotationReviewBadge` 入参类型迁移到 `AnnotationWorkspaceItem`
  - 行为不变：双胞胎面板 5 套件 baseline 33 fail / 56 pass → after 33 fail / 59 pass（仅新增早些补丁的 3 pass，0 新增 fail）
  - 消除 2026-05-18 早些补丁所对齐却未消除的"双轨"，让未来过滤维度扩展只需改一处
  - 关键文件：`src/components/review/ReviewPanel.vue`
  - 关联文档：`docs/plans/2026-05-18-reviewer-split-table-data-source-unification-plan.md`、`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §12

### 修复

- **评论列表里的 Debug 形态 id（`String("comment-…")`）解包成裸 id，时间线上删 / 改评论重新打得中** (2026-09-20)
  - gen-model 校审域三处把 SurrealDB 行主键按 Rust `Debug` 写进响应体（`GET /api/review/comments/by-annotation/*`、`GET /api/review/tasks/{id}/history`、workflow sync 的评论），后端用 `record_id_debug_shape_matches_the_legacy_sdk` 钉住了这个形态（旧端同形）；而建评论回执与 `DELETE|PATCH /api/review/comments/item/{id}` 认的都是裸 `comment-…`。前端 `normalizeAnnotationComment` 原样 `String(raw.id)`，时间线拿列表 id 去删 → 404「评论不存在」。
  - 新增 `unwrapRecordIdDebugShape()`：`String("x")` → `x`（Debug 转义按 JSON 解）、`Number(7)` → `7`，裸 id 原样；接在 `normalizeAnnotationComment`（`id` / `replyToId`）、`normalizeWorkflowSyncResponse`（records / annotationComments 的 id）与 `reviewTaskGetHistory` 上。
  - 验证：`reviewApi.test.ts` 新增 6 例（含 by-annotation → delete 的 fetch 级往返、history 解包）54/54；本机 gen-model `:8031`（0.1.27，`PLANT_REVIEW_ALLOW_EPHEMERAL_STORE=1`）真机：经前端 `reviewCommentGetByAnnotation` 取回的 id 与建评论回执逐字相同，再删 200；改前同一路径拿列表 id 删是 404。

- **Quicktest 模型加载离线化与聚焦修复** (2026-06-09)
  - DuckDB-WASM 初始化后统一设置 `custom_extension_repository` 到同源 `/duckdb/extensions`，`parquet_scan()` 不再访问公网 `extensions.duckdb.org` 下载 `parquet.duckdb_extension.wasm`
  - Vite 构建复制 `wasm_eh` / `wasm_mvp` / `wasm_threads` 三份 parquet extension 到 `dist/duckdb/extensions/v1.5.3/...`，开发服务器也支持同路径本地返回
  - DTX 模型自动聚焦新增鲁棒包围盒：当少量远端对象把全量 AABB 撑大时，按主体对象聚焦，不隐藏或删除模型数据
  - 验证：`npm run build` 通过；阻断 `https://extensions.duckdb.org/**` 后，`show_dbnum=250160` 仍加载 625/625 个对象并正常聚焦

- **零尺寸 BOX 无模型诊断与缓存状态修正** (2026-06-05)
  - `show_refno` 单模型加载路径在 `visible-insts` 为空或最终未绘制实例时，会查询 PDMS UI 属性并识别 `BOX` 的 `XLEN/YLEN/ZLEN` 是否全为 0。
  - 对零尺寸 `BOX` 在底部控制台输出明确原因：生成阶段不会写入 `inst_relate/geo_relate`，因此没有可绘制模型，避免只提示“可见实例为空”。
  - DTX loader 对 Parquet 无几何行的 refno 不再写入 `loadedRefnos` 缓存，避免后续点击误报“已存在于场景或缓存中”。
  - 验证：`npm run type-check` 通过；`show_refno=2013294900_6965` 页面控制台已显示零尺寸诊断。

- **外部 PMS 单据批注状态同步与启动健壮性增强（U011 整组）** (2026-05-19)
  - `useAnnotationReviewStateSync.ts` 新增 `pickLatestAnnotationStates`：同一批注的多轮记录按 `(reviewRound, updatedAt)` 去重，只应用最新一轮；避免上一轮的 `decision_status=rejected` 覆盖 SJ 二次处理后的 `fixed`
  - `ReviewPanel.vue` 的 `refreshAnnotationReviewStatesForCurrentTask` 与 `activeReviewFormId` watch 不再强依赖 `currentTask`：外部 form 聚焦时只凭 `activeReviewFormId` 也能按 `formId` 拉一次最新批注状态；`restoreConfirmedRecordsIntoScene` 与 `confirmCurrentData` 成功后追加一次主动刷新
  - `ReviewPanel.vue` 新增「外部 form 聚焦 + split 视图 + 仅 1 条作用域批注」自动展开 watch：解决 FORM-DE19AFADC087 默认折叠把 SJ 处理按钮（已修改 / 不需解决 / 提交处理结果）藏进卡片导致体感不可见的问题
  - `embedContextRestore.ts` PMS 嵌入打开 form-focused 单据时改为「`loadTaskByFormId` 直拉（8s 超时） + `loadReviewTasks` 后台 fire-and-forget」，并在 `resolveEmbedRestoreResult` 仍 missing 时回填 form-loader 命中结果；URL 已带可验证 form_id 时不再被「拉当前角色全量任务列表」阻塞
  - `useToolStore.ts` 把 `getReviewCommentThreadStore` / `getCommentsFromStore` / `liftAnnotationComment` 从运行时 lazy 引用重构为顶层 import + `_getThreadStore()` helper（符合项目 `no-inline-imports` 规则），让 `addCommentToAnnotation` 在 vitest 环境也能直接走共享 thread store
  - 新增 `useAnnotationReviewStateSync.test.ts` 1 条单测锁定多轮状态优先级；扩展 `useToolStore.persistence.test.ts` 1 条单测验证 `addCommentToAnnotation` 不依赖 runtime globals
  - 验证：`npm run type-check` 通过；6 个改动文件 `eslint` 0 error 0 warning；新增 + 扩展的两个测试 13/13 通过；双胞胎 4 套件 baseline 34 fail / 53 pass → after 34 fail / 53 pass（**0 新增 fail**，已对比 stash baseline）

- **JD/JH 可确认 SJ 已处理的驳回批注** (2026-05-18)
  - 外部 `form_id` 聚焦场景下，`ReviewPanel.vue` 同步批注处理状态改为按 `formId` 查询，不再强绑当前内部 `taskId`
  - 修复 SJ、JD、JH 在同一外部单据上恢复到不同内部 taskId 时，JD/JH 看不到 SJ 已提交的 `fixed/wont_fix`，导致“同意 / 驳回”被禁用的问题
  - 后端 `plant-model-gen` 已同步补充 `jh` 角色的 `agree/reject` 权限白名单，避免 JH token 被服务端拒绝
  - 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` 11/11 通过；`npm run build` 通过；后端本地 `cargo check` 因缺少 NASM 被环境阻断，线上部署后 `/api/health` 与 `/api/version` 均 HTTP 200

- **SJ 驳回单据批注处理确认入口恢复** (2026-05-18)
  - 修复 SJ 打开驳回/退回单据进入 `ReviewPanel` 后，评论线程调用 `buildCommentThreadKey()` 时报 `buildCommentThreadKey is not defined` 的运行时错误
  - `useToolStore.ts` 显式导入 `buildCommentThreadKey`，避免依赖 auto-import/global 类型声明导致类型层面通过但运行时未注入
  - 外部 SJ returned/rejected 场景保留 `designer-only` 时间线语义，恢复“已修改 / 不需解决 → 提交处理结果”入口，用于逐条确认批注已处理
  - 仍不开放校审侧“同意 / 驳回”动作，也不恢复新增批注/测量证据入口；“确认当前数据”继续只服务新增证据保存
  - 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` + `commentThread.test.ts` + `commentThreadStore.test.ts` 35/35 通过；`npm run build` 通过

- **SJ 外部单据仅在驳回/退回状态下进入校审面板** (2026-05-18)
  - 修正 `sj + 外部 form_id` 被无条件路由到 `ReviewPanel` 的问题：现在普通未驳回单据保持设计端落点，只有恢复到的任务确认为 canonical returned/rejected 时才显示校审面板
  - `embedRoleLanding.ts` 不再只凭 `sj + form_id` 把落点改为 reviewer；form_id 仍用于权限与批注 scope 判定
  - `embedContextRestore.ts` 新增 returned designer task panel 选择能力，供外部 SJ returned/rejected 场景路由到 `review`
  - `DockLayout.vue` 在任务恢复后结合 `isCanonicalReturnedTask()` 决定是否收敛到校审面板，避免未驳回单据也进入校审工作台
  - 验证：`embedRoleLanding.test.ts` + `embedContextRestore.test.ts` 35/35 通过；`npm run type-check` 通过；`git diff --check` 通过
  - 已知基线：面板大回归套件中 `ReviewPanel` / `DesignerCommentHandlingPanel` 仍有既有失败，本次聚焦落点逻辑未扩大修复范围

- **外部 form_id 收敛规则推广到任意 reviewer 角色（A2 升级）** (2026-05-18)
  - 产品规约：「不能跨 form_id 批注，看的就是对应单据的数据」。本次把 2026-05-18 早些只针对 SJ 的外部 form_id 收敛规则推广到任意 reviewer 角色（sj/jd/sh/pz）
  - `embedRoleLanding.ts` 新增 `isExternalFormFocusedMode(params)`，不再要求 `role === 'sj'`，只看 `isPassiveWorkflowMode + verifiedFormId`
  - `ReviewPanel.vue` 的 `scopedReviewerItems` form_id 过滤改用 `isExternalFormFocused`；原 `isExternalSjFormFocused` 保留用于 SJ 权限边界（`canCreateReviewEvidence` / `allow-review-actions`）
  - `DockLayout.vue` 的 `closeBlockedReviewPanels` 与 ribbon command 守卫（`panel.resubmissionTasks` / `designerCommentHandling` / `annotationTable`）改用更广义的 `inExternalFormFocusedMode`，保留 `inExternalSjFormFocusedMode` 用于 SJ 专用语义
  - `AnnotationOverlayBar` / `useDtxTools` 中按现有 `shouldUseDesignerPanel` 逻辑（DESIGNER 角色 + canonical returned task）对 jd/sh/pz 天然走 review 分支，无需额外升级
  - 新增 `ReviewPanel.test.ts` 用例：passive workflow + jd / sh 角色 + form_id → 表格按 form_id 收敛；原 manual workflow 用例改为「activeReviewFormId 为空时不过滤」更准确反映新规则
  - 回归差量：6 套件 33 fail / 67 pass（+1 pass，0 新增 fail）；type-check 0 error；ReviewPanel.vue + DockLayout.vue lint 0/0
  - 关键文件：`src/components/review/embedRoleLanding.ts`、`src/components/review/ReviewPanel.vue`、`src/components/DockLayout.vue`、`src/components/review/ReviewPanel.test.ts`

- **SJ 外部 form_id 入口全面收敛到 ReviewPanel** (2026-05-18)
  - SJ 经 PMS 外部流程打开带 form_id 的单据时，所有批注处理统一在审核侧 ReviewPanel 内完成，不再单独打开「批注处理」(DCH) / 「退回任务列表」/ 「发起编校审」/ 「待审核任务」面板
  - 新增 `isExternalSjFormFocusedMode()` helper，扩展 `closeBlockedReviewPanels`：SJ 外部 form_id 模式额外关闭 DCH/resubmissionTasks/initiateReview/reviewerTasks
  - Ribbon command `panel.resubmissionTasks` / `panel.designerCommentHandling` / `panel.annotationTable` 在 SJ 外部 form_id 模式下强制路由到 review
  - 重写 `DockLayout.test.ts` 中过时的「设计端被动恢复未匹配内部任务但 workflow/sync 有批注记录时仍进入批注处理」用例，改为锁定新策略「仍统一落到 review 面板，不再单独开 DCH」（转绿 1 条原 baseline fail）
  - 双胞胎 5 套件 + DockLayout 汇总：baseline 34 fail / 62 pass → after 33 fail / 66 pass（净 -1 fail / +4 pass，0 新增 fail）
  - 关键文件：`src/components/DockLayout.vue`、`src/components/DockLayout.test.ts`
  - 关联文档：`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §13、`.plannotator/plan-sj-reject-ui.md` §2 / §5

- **审核面板批注表格 form_id 收敛** (2026-05-18)
  - SJ 经 PMS 外部流程打开被驳回单据并切到「批注表格」时，不再显示其它 form_id 的批注
  - `ReviewPanel.vue` 的 `annotationWorkspaceItems` 改为先构造全集再按 `isExternalSjFormFocused` + `activeReviewFormId` 过滤，行为与同文件 `allAnnotationItems`（卡片列表）严格对齐，复用 `scopeAnnotationWorkspaceItemsByFormId` helper
  - 新增 3 条 vitest 用例锁定 form_id scope 行为（SJ 外部聚焦 / manual workflow / passive workflow+jd 角色），双胞胎面板 5 套件 baseline 33 fail / 56 pass → after 33 fail / 59 pass（0 新增 fail）
  - 关键文件：`src/components/review/ReviewPanel.vue`、`src/components/review/ReviewPanel.test.ts`
  - 关联文档：`docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md`、`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §11、`.plannotator/plan-sj-reject-ui.md` §6

- **审核面板「批注表格」视图回填** (2026-05-17)
  - 恢复 reviewer 工作台（`ReviewPanel.vue`）的「卡片列表 ⇄ 批注表格」tab 切换；ribbon `panel.annotationTable` 按钮在校核面板上重新生效
  - 直接复用 `buildAnnotationWorkspaceItems` 构造 `AnnotationWorkspaceItem[]` 喂给 `AnnotationTableView`，无须新增适配器
  - 表格视图为只读浏览：行单击=选中、行双击=飞到 3D + 自动切回卡片列表、右键=复制 RefNo / 整行文本
  - 视图模式持久化到 localStorage，独立 key `plant3d-web-nav-state-reviewer-workbench-v1`，刷新后保持
  - 根因：ccb8d08（PR 8）落地的能力在某次反向 rebase 中被 028de56 之前的 ReviewPanel 版本整段覆盖；后续 merge `6ad374b` 巩固损坏
  - 关键文件：`src/components/review/ReviewPanel.vue`
  - 关联文档：`docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` + `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md`

- **测量清空修复** (2026-04-29)
  - 修复顶部菜单“测量 → 清空”只按当前测量模式清理，导致画面上已有测量标签残留的问题
  - 统一清理普通测量、xeokit 测量、未完成测量草稿，以及测量模式生成的管-墙/柱距离标注
  - 保留普通“尺寸标注”，避免误删用户手动创建的尺寸内容

- **PMS 模拟器驳回流程修复** (2026-04-27)
  - 修复 `openWorkflowDialog` 和 `executeWorkflowAction` 中 `shouldUseSyncOnlyWorkflowAction` 使用过期的 `state.sidePanelMode` 导致 SH 节点无法执行 agree 操作的问题
  - 根因：`openIframe` 异步加载诊断数据（`refreshDiagnosticsSnapshot`）后才更新 `sidePanelMode`，但 `openWorkflowDialog` 在诊断加载完成前就读取了旧值 `'readonly'`，导致 `shouldUseSyncOnlyWorkflowAction` 返回 `false`，阻止了外部流程模式下的 workflow/sync 操作
  - 修复方式：在 `openWorkflowDialog` 和 `executeWorkflowAction` 中使用 `deriveSidePanelMode()` 实时计算最新的面板模式，取代可能过期的 `state.sidePanelMode`
  - 影响范围：PMS 模拟器中的三维校审驳回（return）流程，特别是 SH→PZ→SJ 的驳回链路
  - 验证：`PMS_SIMULATOR_CASE=return` 场景 17/17 断言全部通过
