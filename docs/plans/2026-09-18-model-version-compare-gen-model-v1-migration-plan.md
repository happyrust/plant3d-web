# 版本对比收口并迁到 gen-model-v1（gen-model-refactor）· 执行清单

- 日期：2026-09-18 ｜ 状态：**B / A1 / A2 / A3 四期 + 版本对比 legacy 链退役（§7，用户拍板不等部署锚）全部提交并真机验过（§5）**；`model_source=legacy` 开关本体与 legacy 其余链路按 §7.1 的锚另退
- 决策来源：grill 第 1–4 轮（Q1–Q25）用户逐条拍板；共识登记 d-165（导向）、d-167（术语）、d-179（历史投影不入库）、第 4 轮退役锚见 §7
- ADR：本仓 `docs/adr/0065`（草案）；gen-model-refactor `docs/adr/ADR-081`（草案）
- 词汇：`CONTEXT.md`「模型版本查看」——**最小交付单元 / 模型版本 / 模型版本对 / 无几何变化提交 / 已删除单元版本 /
  最新环境模型 / 单视口版本切换 / 双视口分屏版本视图 / 模型几何差异**。下文只用这些词。
- 后端仓：`../gen-model-refactor`（= 本仓 `model_source=gen-model-v1`，`:8022`）。`old/gen-model`、`plant-model-gen` 不再是目标。

## 0. 拍板摘要

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 导向 | **B → A**：先收口删死代码，再把取数迁到 gen-model-refactor |
| Q2 | 「历史模型」 | 正名「模型版本」，身份 `(dbnum, unit_refno, sesno)`；「历史模型 / 历史投影」进 _Avoid_ |
| Q3 | 边界 | 功能 = ① 单元 sesno 对比 + 树内差异（`useTreeVersionDiff`）+ 差异事件通道；② release diff、`IncrementalUpdatePanel` 对比模式 = 包袱 |
| Q4 | release 线 | 放弃，不找回；不另立 ADR（ADR 0045 已覆盖），spec 004 加横幅 |
| Q5 | legacy 寿命 | 必须在 legacy 保留的那一个发布周期内迁完 |
| Q6 | 最小交付单元类型集 | 以 gen-model-refactor 项目配置为唯一口径，前端不硬编码 |
| Q7 | 删除清单 | 见 §1；spec 004 留 + 横幅；`ModelTreeAttrDiffPanel` 不在本次范围 |
| Q8 | 前端形状 | 模型来源端口新增 `ModelVersionSource`（第七个端口） |
| Q9 | 版本列表接口 | gen-model-refactor 新增；impact 五态沿用；noop 会话列出 |
| Q10 | diff 在哪算 | 前端签名法（现状），后端不做 diff 接口 |
| Q11 | A/B 三维取数 | 两侧都走 `model/history/generate`；404 自动重生、退出 DELETE |
| Q12 | 最新环境模型 | = 打开对比时视口里已加载的该 dbnum 模型，冻住；不整库加载 |
| Q13 | 树的 sesno 模式 | 不做全库版本树；当前树 + 差异徽章 / 幽灵节点；单元子树结构取 `history/query tool=snapshot` |
| Q14 | 版本列表代价 | 按需算 + 进程内缓存 + `since_sesno` / `limit`；不建表 |
| Q15 | 分屏两侧网格缓存 | 不动，各自取；先量 A/B 重复 geo_hash 比例再说，不进本计划 |
| Q16 | URL 入口 | 保留 `unit_refno`，加 `compare_a` / `compare_b` / `compare_autorun`（照 `spatial_*` 前缀体例） |
| Q17 | `limit` 截断 | v1 适配器按 `since_sesno` 连续拉到 `truncated=false`（上限 20 页），端口永远给全表 |
| Q18 | 主层「加载某版本」死路 | 删（`showModelUnitVersion` / `getModelUnitCommit` / ViewerPanel `{dbnum, sesno}` 分支） |
| Q19 | `?tree_sesno=` 残留 | 随 legacy 退役一起删 |
| Q20 | 退役时点的锚 | **生产部署**：第一次用 `deploy-ubuntu.yml` 把默认 v1 的构建部到生产 = 周期起点，下一次生产部署 = 可删；硬条件「那次部署时生产 `:3100` 已停」（tag 自 `v0.1.26` 2026-05-14 起没打过，不能当锚） |
| Q21 | 两处已死项 | **现在删**：`showModelByDbnum({manifestUrl, replaceRefnos})` + `mergeVersionReplacementRefnos`；`e2e/dimension-real-ams-bran-version.spec.ts` 第 2 条（旧事件形状） |
| Q22 | parquet 版本取数删到哪层 | 「不可变清单」分叉随链一起删（parquet loader `manifestUrl / pinnedManifest / lastRegisteredManifest`，DTX loader `parquetManifestUrl / parquetManifest / pinnedByCaller` 例外 / `sourceStamp` 三格）；parquet loader 本体留给 legacy 整体退役 |
| Q23 | 端口里 legacy 专用格 | 删 `assetSesno` + 3 处 artifact 文案 + `ModelVersionEnvironmentLoaderOptions` parquet 三格（`pinLatestEnvironment` 整个拿掉）；**留** `geometryKey`、`handle`；词条「无几何变化提交」「模型几何差异」改口 |
| Q24 | 退役出口 | `rg` 零命中 + vitest 全绿 + type-check 基线收紧 + v1 e2e 3 过 + `?model_source=legacy` 下面板给明确空态；**legacy 对拍不做**（791/898 vs 332，无共同地面） |
| Q25 | `ModelTreeAttrDiffPanel`（链外） | 随 legacy 退役一起删（面板 + `modelHistoryApi` + 测试）；「属性历史对比」记成 gen-model-refactor 候选需求 |

## 1. 收口：删除清单（阶段 B）

### 1.1 整文件删除

| 文件 | 为什么 | 连带 |
|---|---|---|
| `src/components/model-version/ModelVersionComparePanel.vue` + `.test.ts` | release diff，直连 `/api/model-version/diff \| compare-readiness`，后端不存在；只在 harness 挂过 | `src/harness/mvc.ts`、`harness/mvc.html`、`harness/mvc.shots.mjs`、`harness/README.md` 两行 |
| `src/components/model-version/VersionTimelinePanel.vue` + `.test.ts` | spec 004 半成品：未注册进 `DockLayout` / ribbon / `main.ts`，用户点不到；release 双轴徽章 | `src/harness/vt.ts`、`harness/vt.html`、`harness/vt.shots.mjs`、`harness/README.md` 两行 |
| `src/composables/useVersionTimelineStore.ts` + `.test.ts` | 只服务 `VersionTimelinePanel` | 它定义的 `INCREMENTAL_COMPARE_EVENT` 常量随之消失（见 §1.4） |

### 1.2 文件内删除

| 位置 | 删什么 | 留什么 |
|---|---|---|
| `src/api/modelVersionApi.ts` | `/api/model-version/*` 家族：`listReleases` / `getRelease` / `getReleaseEvents` / `getReleaseDiff` / `getUnitDiff` / `getCompareReadiness` / `getRuntimeScene` 及其类型与 `{success,message,data}` 信封解析 | `/api/model-history/*` 家族：`listAnchors` / `resolveAnchor` / `getSnapshot`、`AnchorMissingError` / `ExpiredError`、`ModelHistoryAnchor` / `ModelHistorySnapshot`。**文件改名 `modelHistoryApi.ts`**，`ModelTreeAttrDiffPanel.vue/.test.ts` 与 `modelVersionApi.test.ts`（只留 model-history 用例、同步改名）跟着改 import |
| `src/components/dock_panels/ViewerPanel.vue` | 整个 `incrementalCompare*` 簇（约 104 处引用）：:5219 监听 `plant3d:incremental-version-compare` 的 `handleIncrementalCompare` → `applyIncrementalCompareState`（:215）、proxy / mini-scene 渲染（:317–:520）、`loadIncrementalCompareReleaseDtx`（:729，含 `release-local-side-by-side`）、`loadIncrementalCompareRefno`（:865）、`closeIncrementalCompareOverlay`（:889）、状态 ref / computed（:1350–:1375）、模板覆盖层（:6075–:6130）。边界画法：**只从这个事件可达的都删**，执行时按引用图收敛 | `handleModelUnitVersionCompare`（:2986）整条链、`refreshModelUnitCompareEnvironment`（:2604）——阶段 A 改造它们，不删 |
| `src/components/incremental/IncrementalUpdatePanel.vue` | :1007 那条 `plant3d:incremental-version-compare` 派发（对比模式入口）；其后端 `/api/model/incremental/*` 不存在 | 面板其余部分不动——整面板去留不在本计划 |
| `src/components/model-version/ModelUnitVersionComparePanel.vue` | :27 `ROOT_NOUNS` 硬编码（Q6）；`artifact_sesno` / `manifest_url` 的直接读写——**两处都留到阶段 A1**：`ROOT_NOUNS` 要等适配器能把后端 `NOT_A_DELIVERY_UNIT_ROOT` 翻译出来再拆，阶段 B 拆了会改 legacy 行为 | 其余 UI 与事件契约 |

### 1.3 留下并标注

| 位置 | 处置 |
|---|---|
| `specs/004-model-version-timeline/` | 留。`spec.md` 与 `README.md` 顶部加一行：「**已废弃（2026-09-18）**：release 线放弃，见 ADR 0045 / 0065；本目录只作史料」 |
| `docs/adr/0045`、`0047` | 不改正文；0065 在 `depends_on` 里引用并声明 0045 里「BRAN / HANG / EQUI / WALL / FLOOR」那份清单作废 |
| `DockLayout.vue:907` `component: 'ModelVersionComparePanel'`、`main.ts:66` | 这是活的 ① 的 dock 注册（实际组件 `ModelVersionComparePanelDock` → `ModelUnitVersionComparePanel`），**留**；名字与被删面板同名只是历史巧合，本轮不改名 |

### 1.4 收口后的一个缺口：差异事件通道会变成零派发方

`plant3d:incremental-version-compare` 今天的三个派发方（`ModelVersionComparePanel`、`useVersionTimelineStore`、
`IncrementalUpdatePanel:1007`）在 §1.1 / §1.2 之后**一个都不剩**，`ModelTreePanel` 的树内差异模式（徽章 / 幽灵节点 /
筛选，`useTreeVersionDiff`）就再也进不去。而 Q3 已把树内差异算进「功能」。补法：

- 事件常量搬到 `useTreeVersionDiff.ts`，改名 `MODEL_VERSION_TREE_DIFF_EVENT = 'plant3d:model-version-tree-diff'`
  （旧名里的 "incremental" 指的是已死的增量面板）；`ModelTreePanel` 是**唯一**消费者。
- `ModelUnitVersionComparePanel.runCompare` 成功后，把 `rows`（`ModelUnitGeometryDiff[]`）映成 `TreeDiffContext`
  （`dbnum` / `fromSesno` / `toSesno` / `refnos` / `models[{refno, status}]`；幽灵节点的 `ownerRefno` 从快照结构取，见 §4.3）派发一次，
  `closeCompare` 时派发空上下文退出差异模式。
- 这是唯一一处**新增**行为；其余都是删。

### 1.5 收口验证

- `npx vitest run src/components/model-version src/utils/modelUnitVersionCompare.test.ts src/api src/components/model-tree` 全绿；
- `npx vue-tsc --noEmit`（或仓内等价脚本）无未引用 / 缺失导出；
- `rg -n "model-version/|compare-readiness|release-local-side-by-side|INCREMENTAL_COMPARE_EVENT|incremental-version-compare" src harness` 只剩 §1.4 的新名字；
- 手工：`?model_source=legacy` 下功能区「任务 → 版本对比」输入一个 BRAN 根参考号，A/B 对比、切侧、分屏、树内差异徽章都在——收口不改行为。

**执行记录（2026-09-18，阶段 B 已做）**：§1.1 / §1.2 / §1.3 / §1.4 全部落地；`ViewerPanel.vue` 净删 831 行（6197 → 5366）；
`modelVersionApi.ts` → `modelHistoryApi.ts`（错误类改名 `ModelHistoryApiError`）；桥接事件 `plant3d:model-version-tree-diff`
+ `dispatchTreeDiffContext()`，`ModelTreePanel` 收到空上下文即 `treeDiff.clear()`，`ModelUnitVersionComparePanel` 新增 1 条用例覆盖。
验证：全仓 vitest 345 文件 / 3067 用例全绿；`node scripts/type-check.mjs` 基线内错误消失 74 条、**新增 1 条但不在本次改动范围**
（`useSpatialQuery.test.ts:1969`，来自同日另一条会话的提交 `a9a2b3f7`），基线未重写以免把它放行；ESLint 对 10 个触及文件零告警；
`rg` 残留只剩 `scripts/type-check-baseline.txt` 里已删文件的旧条目。手工项**未验证**（本轮没有起 legacy `:3100` 与浏览器）。

## 2. 前端契约：`ModelVersionSource`（`src/model-source/ports.ts` 第七个端口）

与既有六个端口同一条纪律：形状**故意贴着**今天 `ModelUnitVersionComparePanel.snapshotsFor` 的产出，legacy 适配器是零逻辑委托。

```ts
/** 与 legacy `impact_kind` 同一词表（ADR 0045 起前端与词汇表都在用）。 */
export type ModelVersionImpactKind = 'mesh' | 'placement' | 'delivery' | 'noop' | 'tombstone';

/** 一个模型版本（CONTEXT.md「模型版本」）。身份 = (dbnum, unitRefno, sesno)，其余是展示信息。 */
export type ModelVersion = {
  dbnum: number;
  /** 本仓内部键 `a_b` */
  unitRefno: string;
  unitNoun: string;
  sesno: number;
  /** RFC3339；legacy 给 `generated_at`，gen-model-v1 给会话时刻；解不出为 null */
  sessionTime: string | null;
  impactKind: ModelVersionImpactKind;
  /**
   * 「几何相同」承诺键：两个版本的键相等 ⇒ 适配器保证几何逐条相同，面板可以只加载一次。
   * legacy = `${dbnum}:${artifact_sesno}`（无几何变化提交复用资产）；gen-model-v1 不给（undefined）。
   */
  geometryKey?: string;
};

export type ModelVersionGeometry = {
  /** 该版本下单元子树里有几何的 refno（`a_b`），tombstone 为空 */
  refnos: string[];
  /** 喂 `geometrySnapshotsFromInstanceEntries` / DTX 层的形状，与 `ModelRecordSource` 同型 */
  entries: Map<string, InstanceEntry[]>;
  /** 释放服务端资源：gen-model-v1 = `DELETE /api/v1/model/history/{snapshot_key}`；legacy 空操作 */
  release(): Promise<void>;
};

export type ModelVersionSource = {
  /**
   * 该最小交付单元的全部模型版本，按 sesno 升序。refno 不是最小交付单元根 → 抛 `NotDeliveryUnitRootError`（带 noun），
   * 由适配器从后端答复翻译，前端不再持类型清单（Q6）。
   */
  listVersions(dbnum: number, unitRefno: string): Promise<ModelVersion[]>;
  /** 一个版本的几何。impactKind === 'tombstone' 返回空集而不是抛错（「已删除单元版本」）。 */
  loadVersion(version: ModelVersion, options?: { signal?: AbortSignal }): Promise<ModelVersionGeometry>;
};
```

- `ModelSource` 增加 `readonly versions: ModelVersionSource`。
- **legacy 适配器**（`src/model-source/legacy/versionSource.ts`）：`listVersions` = `listModelUnitCommits` 逐条映射（`generated_at → sessionTime`、
  `artifact_sesno → geometryKey`）；`loadVersion` = 今天 `snapshotsFor` 那两句 parquet 调用原样搬入；`release` 空。
- **gen-model-v1 适配器**（`src/model-source/genModelV1/versionSource.ts`）：`listVersions` = §3.1；`loadVersion` =
  `POST /model/history/generate {dbnum, refno, sesno}` → 轮询 `/tasks/{id}` 到 `snapshot_key` → `POST /model/history/query {snapshot_key, tool:'instances'}`
  → 经 `instanceMapping.ts` 映成 `InstanceEntry[]`（与 `modelRecordSource` 同一条映射，不另写）；`release` = DELETE。
  快照 404（进程重启后丢失）→ 重新 generate 一次再查，只重试一次。
- **调用方改动**：`ModelUnitVersionComparePanel` 只认 `ModelVersion` / `ModelVersionGeometry`；
  `ModelUnitVersionSide`（事件 detail）里的 `artifactSesno` / `manifestUrl` 换成 `geometryKey?` 与 `refnos`，ViewerPanel 加载 A/B 图层改走
  `source.versions.loadVersion(version)`，不再直接 `useDbnoInstancesParquetLoader`。

**执行记录（2026-09-18，阶段 A1 已做）**：`ports.ts` 新增 `ModelVersionImpactKind / ModelVersion / ModelVersionGeometry /
ModelVersionEnvironmentPin / ModelVersionSource`，`ModelSource.versions` 就位；与 §2 初稿相比多了三格——`assetSesno`（legacy `artifact_sesno`，
面板「复用 N」「artifact N」文案照旧）、`handle`（适配器私有句柄，legacy 放 manifest URL）、`pinLatestEnvironment()`（「最新环境模型」也进端口：
legacy 回钉住的最新 manifest 与 `dataSource:'parquet'`，gen-model-v1 回空选项 → 加载器走 records + forceRefresh，Q12 的终态）。
`legacy/versionSource.ts` 三个方法逐句对应从前面板 / ViewerPanel 的内联调用（4 条单测锁参数）；`genModelV1/versionSource.ts` 的
`listVersions` / `loadVersion` 抛 `GenModelV1ModelVersionsNotReadyError`（A2 / A3 接入前），`pinLatestEnvironment` 已是终态。
调用方：`ModelUnitVersionComparePanel` 只认 `ModelVersion` / `ModelVersionGeometry`，持有几何并在关闭时 `release()`；事件 `ModelUnitVersionSide`
改为 `{ version, sesno, refnos, entries(markRaw) }`，**ViewerPanel 不再回源取几何**，A/B 隔离图层直接装事件带来的 `entries`（`instanceEntriesByRefno`），
网格 URL 仍按页面级 `MeshSource`；环境刷新经 `pinLatestEnvironment`。`ROOT_NOUNS` 按 §1.2 仍留。
验证：全仓 vitest 346 文件 / 3071 用例全绿；`type-check` 基线内消失 76 条、基线外仅剩那条与本计划无关的 `useSpatialQuery.test.ts:1969`；ESLint 零告警。
legacy 下与从前的可见差别只有一处、且不可见于用户：A/B 隔离图层的 `DtxLoadSourceStamp.modelSnapshotId` 从 `${dbno}:parquet:${generated_at}`
变为 `null`（几何由调用方钉入、加载器不再自己读 manifest）——隔离缓存的印记本就不经 `getDtxRefnoLoadSource` 暴露。手工项未验证（未起 `:3100` 与浏览器）。

**执行记录（2026-09-18，阶段 A3 已做；A2 见 gen-model-refactor `ef2284f12`）**：
- `genModelV1/versionSource.ts` 成为真适配器：`listVersions` = `GET /api/v1/model/versions`，`truncated` 时按最后一条 `sesno` 作
  `since_sesno` 连续拉到全表（Q17，上限 20 页）；422 `NOT_A_DELIVERY_UNIT_ROOT` 翻成 `NotDeliveryUnitRootError`（`src/model-source/modelVersionErrors.ts`，
  noun 与项目类型集来自 `detail`）。`loadVersion` = `history/generate` → 轮询 `tasks/{id}`（500 ms，300 s 预算）→ `history/query` `instances` + `tubes`
  → `historyRowsToGeomInstQueries`（gen-model `projection_record_to_query` 的 TS 对偶：规范基本体带 `local_transform`、烘焙件单位阵 + `has_neg`、
  直管挂 `container_refno`）→ `groupInstanceEntriesByRefno`；tombstone 不打后端；`release()` = `DELETE history/{key}`（幂等）。
  `genModelV1Api.ts` 补 `DELETE` 方法与四个 wrapper（`genModelV1ModelVersions / ModelHistoryGenerate / ModelHistoryQuery / ModelHistoryDelete`）及 DTO。
- Q16 URL 入口：`readModelUnitVersionCompareUrl` / `shouldOpenModelUnitVersionCompareFromUrl`（`utils/modelUnitVersionCompare.ts`）；
  `DockLayout.onReady` 非嵌入模式下按 `unit_refno + compare_autorun` 打开面板；面板 `autorunFromUrl` 查版本 → 按 `compare_a/b` 选（不在表里回落最近两版并提示）→ 跑对比。
- Q18：删 `useModelGeneration.showModelUnitVersion` / `loadedUnitVersionRefnos`、`modelUnitVersionApi.getModelUnitCommit`、ViewerPanel `showModelByRefnos {dbnum, sesno}` 分支。
- Q6：面板 `ROOT_NOUNS` 硬编码删除，单元根合法性交给模型来源（v1 由服务端 422 翻译；legacy 无此判定，非根参考号只会得到「至少需要两个模型提交」）。
- 验证：全仓 vitest 347 文件 / 3084 用例全绿（适配器 9 条、URL 入口 2 + 1 条新增）；`type-check` 基线外仍只剩 `useSpatialQuery.test.ts:1969`；ESLint 零告警。
  **真机（15:32 追记）**：`:8022` 换成含 `ef2284f12` 的 `d47d747fd` 后，`GET model/versions` 冷 2.2 s / 缓存 17 ms（release，623 会话）；dev `:3111`
  两条场景（602→604 tombstone、587→602 placement）端到端全过——面板自动开、11 版、A/B、单视口 / 分屏、树内差异、退出 DELETE 快照；
  证据 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/`。legacy 对拍仍未做（`:3100` 未起）。

## 3. 后端契约（gen-model-refactor，ADR-081）

### 3.1 新增 `GET /api/v1/model/versions`

- 与 `/tree/*` 同一套请求身份：`ProjectReq`（`project` / `mdb`）+ `dbnum` + `refno`（`a/b` 或 `a_b`，同 `TreeReq` 归一）+
  可选 `since_sesno`（只列 `> since_sesno` 的会话）+ `limit`（默认 500，尾部截断并回 `truncated: true`）。
- 200：

```json
{
  "dbnum": 8000,
  "unit_refno": "24381/145018",
  "unit_noun": "BRAN",
  "file_latest_sesno": 285,
  "truncated": false,
  "versions": [
    { "sesno": 12,  "session_time": "2026-03-01T09:12:00+08:00", "impact_kind": "delivery" },
    { "sesno": 40,  "session_time": "2026-03-07T15:02:31+08:00", "impact_kind": "mesh" },
    { "sesno": 41,  "session_time": null,                        "impact_kind": "noop" },
    { "sesno": 260, "session_time": "2026-08-30T10:00:00+08:00", "impact_kind": "placement" },
    { "sesno": 285, "session_time": "2026-09-16T18:20:00+08:00", "impact_kind": "tombstone" }
  ]
}
```

- 错误（沿 `ApiError` 现有码位）：`400 INVALID_REFNO`；`404 REFNO_NOT_FOUND`；`422 NOT_A_DELIVERY_UNIT_ROOT`（响应带 `noun` 与
  项目当前的 MDU 类型集）；`503 SOURCE_NOT_FOUND`（库文件不在）。
- **算法**（全部复用现有积木，不新建表）：`db_file_header::session_chain(path)` 取整条链 → 逐会话取该会话写入的元素集
  （e3d-io 会话页 `index_root` 差分，即增量管线已在用的 `WindowDiff`）→ 每个元素沿 `OWNER` 上溯到最近的 MDU 根，只留等于目标单元根的
  → 该会话的 `impact_kind` = 元素级 `classify_operation_impact` 取最重：单元根本身 `Add` → `delivery`、`Deleted` → `tombstone`、
  任一 `Regen` → `mesh`、否则任一 `TransformOnly` → `placement`、全 `Skip` → `noop`。
- **缓存**：进程内 `(dbnum, unit_refno, source_fingerprint)` → 版本表，文件指纹变了整条重算；不落库、不跨重启（与 `HistoricalModelStore` 同一态度）。
- **不做**：diff 接口（Q10）、带 `sesno` 的 `tree/*`（Q13）、逐单元版本索引表（Q14）、release（Q4）。

### 3.2 已有、直接用

| 接口 | 用途 |
|---|---|
| `POST /api/v1/model/history/generate {dbnum, refno, sesno}` → 202 `{task_id}` | 生成某版本的单元子树几何投影（`Historical(<refno>@<sesno>)` 命名空间；≤ 100 000 元素、300 s） |
| `GET /api/v1/tasks/{id}` | 等 `snapshot_key` |
| `POST /api/v1/model/history/query {snapshot_key, tool}` | `instances` → A/B 几何；`snapshot` → 单元子树结构（幽灵节点的 `ownerRefno`、Q13 的单元级结构） |
| `DELETE /api/v1/model/history/{snapshot_key}` | 退出对比时释放 |
| `GET /api/v1/meshes/{file}` | `.mesh` rkyv，与主层同一条 `MeshSource` |

## 4. 三维与树的口径（Q11–Q13）

### 4.1 A/B 图层
两侧一律 `loadVersion`（即使 B 是文件最新）。理由：生产投影停在 `model_sesno`，常落后于文件最新，「最新」未必等于 B；
两侧同源才对称。`geometryKey` 相等只加载一次（legacy 的复用提示保留）。

### 4.2 最新环境模型
= 打开对比时视口里**已加载**的该 dbnum 模型，冻住到对比结束；隐藏目标单元子树。「刷新环境」= 对已加载 refno 走
`source.records.instanceEntriesByRefnos(dbno, loadedRefnos, { forceRefresh: true })` 重钉一次（legacy 下今天就是只重载已加载 refno，
`refreshModelUnitCompareEnvironment`），**不**整库加载。`CONTEXT.md`「最新环境模型」按此改一句。

### 4.3 树
不做全库版本树，不做 `?tree_sesno=` 整页刷新。当前树 + `useTreeVersionDiff` 的徽章 / 幽灵节点 / 筛选；
幽灵节点回插位置的 `ownerRefno` 从 A 侧几何的属主表取（**已做，15:5x**：gen-model-v1 用 `history/query` 行自带的 `anc` 拆成逐级直接属主表
`ModelVersionGeometry.ownerByRefno`，不必再打 `snapshot`；legacy 用 parquet 行的 `owner_refno`）；B 是 tombstone 时单元根自己也进树当 deleted 模型
（`buildTreeDiffModels`）。

## 5. 分期

| 期 | 内容 | 出口 |
|---|---|---|
| B | §1 全部 + §1.4 桥接 | §1.5 四条 |
| A1（前端）✅ | §2 端口 + legacy 适配器 + 面板 / ViewerPanel 改走端口 | `model_source=legacy` 行为逐字节不变（面板旧用例一字未改全过）——plant3d-web `ec187960` |
| A2（后端）✅ | §3.1 | 真库探针 ams7997 BRAN / ams8000 EQUI 与证据文档一致；legacy 逐条对拍**不做**（Q24：legacy 版本表算自另一份库副本——旧 e2e 期待 7997 BRAN 24381_145018 有 sesno 791 / 898，现在这份 ams7997 只有 332 个会话、该单元 1 版，没有共同地面；v1 真值以 ADR-081 探针为准）——gen-model-refactor `ef2284f12` |
| A3（前端）✅ | gen-model-v1 `listVersions` / `loadVersion` 接线 + Q16 URL 入口 + Q18 删死路 + Q6 拆 `ROOT_NOUNS` | 单测全绿；**真机端到端 ✅**（15:32 `:8022` 换成 `d47d747fd` 后，dev `:3111` 两条场景全过：`docs/verification/model-version-compare-gen-model-v1-2026-09-18/`）——plant3d-web `961a3ea5`；一次性脚本已整理成 `e2e/model-version-compare-gen-model-v1.spec.ts`（3 条，数字取自服务端回执；`PLAYWRIGHT_PORT=3111 npx playwright test e2e/model-version-compare-gen-model-v1.spec.ts` 真机 3 过） |
| Q21 预清 ✅ | 两处与 legacy 存亡无关、今天已死的：`showModelByDbnum({manifestUrl, replaceRefnos})` 分支 + `mergeVersionReplacementRefnos`（+ `loadScope.test` 那组、`genModelV1.test` 那条）；`e2e/dimension-real-ams-bran-version.spec.ts` 第 2 条（按 A1 之前的事件形状派发，`ec187960` 起跑不通） | 全仓 vitest 347 / 3084 全绿（第 2 遍；另两遍 `review/form-binding.test.ts` 一条超时抖动、单跑过、无关）、type-check 基线外仍只剩无关那条、ESLint 零告警——plant3d-web `c6e1fdd3` |
| 退役（版本对比 legacy 链）✅ | §7.2 第 1–5 组（用户 16:5x 拍板「不等部署锚，现在就删」）；第 6 组（链外 `ModelTreeAttrDiffPanel`）与 `model_source=legacy` 开关本体仍按 §7.1 的锚 | §7.3 五条全过，见 §7.4 执行记录 |

## 6. 明确不做

- 不做后端 diff 接口；不给 `tree/*` 加 `sesno`；不建版本索引表；不找回 release API；不续做 spec 004。
- `ModelTreeAttrDiffPanel`（属性历史，钉在 legacy `/api/model-history/*`，gen-model-refactor 无对应路由）**不在这条链里做**；Q25 定它随 legacy 退役一起删（§7.2 第 6 组），「属性历史对比」记成 gen-model-refactor 的候选需求。
- `IncrementalUpdatePanel` 整面板去留不在本计划。
- legacy 版本表逐条对拍不做（Q24，原因见 §5 A2 行）。
- 分屏两侧网格缓存共享不做（Q15）。

## 7. legacy 退役：这条链要删的清单与时点（第 4 轮，Q20–Q25）

### 7.1 时点（Q20）

- **锚 = 生产部署，不是 tag**：仓里最后一个版本 tag 是 `v0.1.26`（2026-05-14），之后 283 个提交没打过；`deploy-ubuntu.yml` 2026-09-18（`81ea1d68`）才入库。
  「开关保留一个发布周期」（2026-09-09，P8-5 / ADR 0054 追记）按下面数：
  1. **周期起点** = 第一次用 `deploy-ubuntu.yml` 把默认 `gen-model-v1` 的构建部署到生产；
  2. **可删** = 其后的下一次生产部署；
  3. **硬条件** = 那次部署时生产环境的 legacy `:3100` 已经停掉（没人再需要 `?model_source=legacy` 的可观测证据）。
- 这条链的退役与 legacy 整体退役（整个 `legacy/` 适配器、parquet loader 本体、DuckDB-WASM、`genModelE3dApi.ts` 等）**可以同一个 PR，也可以先走**——§7.2 的边界画的就是「不等整体也能单独删干净」。

### 7.2 删除清单（逐文件）

第 1 组 · 适配器与 API（整文件删）
- `src/model-source/legacy/versionSource.ts`、`src/model-source/legacy/versionSource.test.ts`
- `src/api/modelUnitVersionApi.ts`（`listModelUnitCommits`，legacy `/api/model/units/{refno}/versions`；唯一消费方就是上面那个文件）
- `src/model-source/legacy/index.ts`：去掉 `versions: legacyModelVersionSource`（若 legacy 适配器整体同时退役，整个文件一起走）

第 2 组 · parquet「不可变清单」分叉（Q22；parquet loader 本体不动）
- `src/composables/useDbnoInstancesParquetLoader.ts`：`fetchLatestDbnoManifest` + `LatestDbnoManifest` 型；`queryAllRefnosByDbno` / `queryInstanceEntriesByRefnos` 的 `manifestUrl` / `pinnedManifest` 选项与分叉；`assertManifestIdentity` 的 `expectedRootRefno` 校验分叉；`lastRegisteredManifest`。`expectedRootRefno` 作为 `InstanceEntryQueryOptions` 的一格**留**（v1 路径也传）。
- `src/composables/useDbnoInstancesDtxLoader.ts`：选项 `parquetManifestUrl` / `parquetManifest`；`pinnedByCaller` 改写例外收成只看 `instanceEntriesByRefno`；`sourceStamp.modelSnapshotId / manifestUrl / generatedAt` 三格与 `parquetGeneratedAt`；头注里「不可变清单，版本对比」那句。`replaceExistingObjects` / `isolated` / `instanceEntriesByRefno` **留**（环境刷新与 v1 A/B 图层都在用）。

第 3 组 · 端口与面板里只有 legacy 会填的格（Q23）
- `src/model-source/ports.ts`：`ModelVersion.assetSesno`；`ModelVersionEnvironmentLoaderOptions`、`ModelVersionEnvironmentPin`、`ModelVersionSource.pinLatestEnvironment`（v1 已是终态：环境 = 视口里已加载的，重钉不带 pin）。**留** `geometryKey`（v1 以后可给 noop 版本填上一版的键，同样省一次加载）与 `handle`（适配器私有句柄是端口的通用形状）。
- `src/model-source/genModelV1/versionSource.ts`：删 `pinLatestEnvironment` 实现。
- `src/components/dock_panels/ViewerPanel.vue` `refreshModelUnitCompareEnvironment`：不再问适配器，直接按页面级开关走 records + forceRefresh。
- `src/components/model-version/ModelUnitVersionComparePanel.vue`：「复用 N」「artifact N」「A/B 复用 artifact_sesno N」三处文案与 `assetSesno` 读取；`sameGeometry` 只加载一次那条**留**（吃 `geometryKey`）。
- `src/utils/modelUnitVersionCompare.ts` / 面板测试 / `legacy/versionSource.test.ts` 夹具里的 `assetSesno`。

第 4 组 · `tree_sesno`（Q19；文件留、只删 sesno 三件）
- `src/api/genModelE3dApi.ts`：`getTreeSesno` / `withTreeVersion` / `getE3dSource` 里「版本模式只能走 backend」那条例外。文件本身另有 5 个绕过端口的直接调用方（`usePdmsConsoleCommands` / `usePdmsOwnerTree` / `useReviewDeliveryUnit` / `InitiateReviewPanel` / `measurementPathLookup`），留给 legacy 整体退役。
- `src/components/model-tree/ModelTreePanel.vue`：`treeVersionContext` / `returnToLatestTree`（:1497–:1518）与模板横幅 `model-tree-version-banner`（「历史模型树 / 回到最新」，:1824–:1836）。

第 5 组 · 文档与词汇
- `CONTEXT.md`「无几何变化提交」「模型几何差异」：去掉“复用较早模型资产 / 模型资产引用相同”这套 legacy artifact 说法，改为“sesno 推进但几何未变（v1 `impact_kind=noop`）→ 不产生模型几何差异”；「模型来源」词条按整体退役改口。
- ADR 0054 追记退役日（§7.1 的锚落地那天）；ADR 0065 状态 proposed → accepted 并追记「legacy 链已删」；本计划 §5 退役行打勾。
- `e2e/dimension-real-ams-bran-version.spec.ts` 剩下那条（MBD 行数 = 0）与版本无关，随 legacy 整体退役处理，不在这条链。

第 6 组 · 链外、同死于退役（Q25）
- `src/components/model-tree/ModelTreeAttrDiffPanel.vue` / `.test.ts`、`src/api/modelHistoryApi.ts` / `.test.ts`（legacy `/api/model-history/*`：anchors / resolve-anchor / snapshot，gen-model-refactor 无对应路由）+ `ModelTreePanel` 里挂它的入口。留一个没有后端的面板就是第二个 spec 004。
- 「属性历史对比」记成 gen-model-refactor 候选需求：需要 anchors / snapshot 的 v1 对应物（会话链 + `ReadOnlyEngine::open_at` 都有，接口未立）。

### 7.3 出口（Q24）

1. `rg` 在 `src / e2e / docs/guides / CONTEXT.md` 零命中：`manifest_url | artifact_sesno | assetSesno | listModelUnitCommits | fetchLatestDbnoManifest | parquetManifestUrl | pinnedManifest | pinLatestEnvironment | tree_sesno | model-history`。
2. 全仓 vitest 全绿；`scripts/type-check-baseline.txt` 收紧（把已删文件的旧条目一并清掉，基线外不得新增）；ESLint 触及文件零告警。
3. `PLAYWRIGHT_PORT=3111 npx playwright test e2e/model-version-compare-gen-model-v1.spec.ts` 3 过。
4. 若 `?model_source=legacy` 开关本体还在：该开关下打开版本对比面板要给明确的「legacy 已退役，请去掉 `model_source=legacy`」空态，不能白屏；开关本体也一起删则此条不适用。
5. 不做 legacy 版本表对拍（§5 A2 行）。

### 7.4 执行记录（2026-09-18 17:1x，第 1–5 组已删；第 6 组按锚另退）

- **第 1 组**：`legacy/versionSource.ts` / `.test.ts`、`api/modelUnitVersionApi.ts` / `.test.ts` 整文件删；`legacy/index.ts` 的 `versions` 换成两个都抛
  `LegacyModelVersionsRetiredError`（新增于 `model-source/modelVersionErrors.ts`）的 stub，`index.test.ts` 加一条钉住。
- **第 2 组**：parquet loader 删 `fetchLatestDbnoManifest` + `LatestDbnoManifest`、`assertManifestIdentity` / `normalizeManifestRefno`、`fetchManifest` 的
  `manifestUrl` 分叉（含 `baseDirUrl`、`_bucket_index`）、`registerDbno` / `queryAllRefnosByDbno` / `queryInstanceEntriesByRefnos` 的
  `manifestUrl / expectedRootRefno / pinnedManifest` 选项、`tryFetchBucketIndex(strict)`，以及只有单元 manifest 才会命中的 `legacy-rows` 矩阵布局
  （`TransformStorageLayout` / `RegisteredDbno.transformLayout`）；`lastRegisteredManifest` 去掉 `manifestUrl` 格但**保留**（当前环境的
  `generated_at` 还喂批注来源身份 `modelSnapshotId`，那是 legacy 整体的事）。DTX loader 删 `parquetManifestUrl / parquetManifest` 选项、
  `pinnedByCaller` 只看 `instanceEntriesByRefno`、`DtxLoadSourceStamp.manifestUrl`；`modelSnapshotId / generatedAt` **保留**（同上）。
  对应测试：parquet loader 删 6 条 + 改 1 条（bucket index 优先那条改走当前环境路径），DTX loader 删 1 条 + 改 1 条。
- **第 3 组**：`ports.ts` 删 `ModelVersion.assetSesno`、`ModelVersionEnvironmentLoaderOptions` / `ModelVersionEnvironmentPin` /
  `ModelVersionSource.pinLatestEnvironment`、`InstanceEntryQueryOptions.manifestUrl`（`expectedRootRefno` 留，注明两个适配器都不校验）；
  v1 适配器删 `pinLatestEnvironment`；ViewerPanel `refreshModelUnitCompareEnvironment` 不再问适配器，直接按页面级开关重取已加载 refno，
  `environment.generatedAt` 连同调试字段一起去掉；面板删三处 artifact 文案（noop 文案改「A/B 几何相同，只加载了一次」）、`sameGeometry`
  只加载一次那条保留吃 `geometryKey`；面板测试从 legacy 夹具改成可编程的 `ModelVersionSource` mock。
- **第 4 组**：`genModelE3dApi.ts` 删 `getTreeSesno / withTreeVersion` 与 `getE3dSource` 的 backend 例外（文件留给 5 个直接调用方）；
  `ModelTreePanel.vue` 删 `treeVersionContext / returnToLatestTree` 与「历史模型树 / 回到最新」横幅。
- **第 5 组**：CONTEXT「无几何变化提交」「模型几何差异」改口（`impact_kind = noop`，几何与上一版相同；「复用资产 / artifact_sesno」进 _Avoid_）；
  ADR 0065 proposed → accepted + 追记；ADR 0054 追记补一句「这条链已先删」。
- **§7.3 第 4 条的补法**：面板一进来就按 `getModelSourceKind() === 'legacy'` 给退役提示、查询不碰库元数据——不这样的话 legacy 的
  `ensureDbMetaInfoLoaded` 会先报 `[db_meta] 未命中`，把真正的原因盖住。
- **出口**：① `rg` 在 `src / e2e / docs/guides / CONTEXT.md` 对 `manifest_url | artifact_sesno | assetSesno | listModelUnitCommits |
  fetchLatestDbnoManifest | parquetManifestUrl | pinnedManifest | pinLatestEnvironment | tree_sesno` 零命中（只剩 CONTEXT 那行 _Avoid_）；
  `model-history` 仍有命中 = 第 6 组，按锚另退。② vitest 全仓 345 文件 / 3070 用例全绿（C: 盘满，`TEMP` 指到 D: 才跑得起来）；
  `type-check-baseline.txt` 620 → 542 收紧（`--update-baseline` 后手工把另一会话那条 `useSpatialQuery.test.ts:1969` 从基线里拿掉，
  它仍是唯一一条基线外错误、没有被放行）；ESLint 16 个触及文件 0。③ `PLAYWRIGHT_PORT=3111 npx playwright test
  e2e/model-version-compare-gen-model-v1.spec.ts` 3 过（12.3 s，`:8022 d47d747fd`）。④ `?model_source=legacy` 真机：面板给退役提示、
  无版本下拉、pageerror 0（`docs/verification/model-version-compare-gen-model-v1-2026-09-18/legacy-retired/`）。⑤ 对拍不做。
