# 任务简报：撰写 004 contracts 与 quickstart.md

仓库：`d:\work\plant-code\plant3d-web`（用绝对路径读写；你的当前工作区可能是 rs-core，不影响）。

## 必读输入

1. `specs/004-model-version-timeline/spec.md`
2. `specs/004-model-version-timeline/research/backend-api-facts.md`（接口路由/参数/响应/410 与 404 语义，以此为准，不得臆造）
3. `specs/004-model-version-timeline/research/frontend-integration-points.md`（第 1 节事件 detail 字段）
4. 风格参照 `specs/002-bran-flow-direction/contracts/flow-direction-ui-renderer-contract.md` 与 `specs/002-bran-flow-direction/quickstart.md`

## 产出（只新建这两个文件）

### 1. `specs/004-model-version-timeline/contracts/version-timeline-ui-contract.md`（中文 MUST 条款式）

- 计划新建的 `src/api/modelVersionApi.ts` 导出面：listReleases / getRelease / getReleaseEvents / getReleaseDiff / getUnitDiff / getCompareReadiness / listAnchors / resolveAnchor / getSnapshot / getRuntimeScene（分页）——每个函数的参数、返回类型要点、错误语义（410 Expired → 降级提示；404 AnchorMissing → 回退选项；统一 `{success,data,message}` 包装判断）
- window 事件契约 `plant3d:incremental-version-compare`：现有 detail 字段逐个列出并声明「只增不改」；新增可选字段单独列表
- 面板/命令契约：dock 面板 id `versionTimeline`、ribbon 命令 `panel.versionTimeline`、主要 data-testid 清单（version-timeline-panel / version-card / pin-a / pin-b / readonly-banner / diff-filter 等）
- 只读约束：本 feature 不得新增后端写路径（FR-035）

### 2. `specs/004-model-version-timeline/quickstart.md`

- 前置条件：`npm run dev` + plant-model-gen 后端
- 接口直查验证（curl 或浏览器）：
  - `/api/model-version/releases`
  - `/api/model-version/diff?project=AvevaMarineSample&from_release_id=codex-ams1112-physical-791-quarantine&to_release_id=codex-ams1112-physical-897-quarantine`
  - `/api/model-history/anchors?dbnum=1112`
  - snapshot 410 过期场景的构造说明
- US1–US5 逐个用户故事的 UI 手工验证步骤与预期结果（对应 SC-001…008）
- 引用 contracts / data-model 而非重复内容；不写实现代码

## 约束

- 不要修改其它任何文件。
- 完成后 `report_task(done)` 附一句话摘要。
