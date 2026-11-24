# Plant3D-Web 架构与流程图

> 依据仓库现状（`main`，2026-10-31）从源码读出的分层与数据流。
> 生成方式：本机 `cursor-agent` 未登录（非交互调用被拒），改由主会话逐文件核对后成图。
> 图中路径均可点击核对。

## 1. 分层架构

```mermaid
flowchart TB
  subgraph L0["入口层 index.html → src/main.ts"]
    HTML["index.html:17<br/>/src/main.ts"]
    MAIN["src/main.ts<br/>createApp + 全局注册 23 个面板<br/>VueQueryPlugin + Vuetify"]
    APP["src/App.vue<br/>工程选择 / 嵌入 token / 引导"]
    LAYOUT["src/components/DockLayout.vue<br/>dockview 布局 / 面板编排 / 布局持久化"]
    HTML --> MAIN --> APP --> LAYOUT
  end

  subgraph L1["面板层 src/components/dock_panels (28)"]
    VP["ViewerPanel.vue<br/>三维视口 + 工具装配"]
    TREE["ModelTreePanelDock"]
    PROP["PropertiesPanelDock"]
    MEAS["MeasurementPanelDock"]
    DIM["DimensionPanelDock"]
    REVIEWP["ReviewPanelDock / InitiateReviewPanelDock<br/>ReviewerTaskListPanelDock / DesignerCommentHandlingPanelDock"]
    SPATIAL["SpatialComputePanelDock"]
    VERSION["ModelVersionComparePanelDock"]
  end
  LAYOUT --> L1

  subgraph L2["交互层 src/ribbon"]
    RIBBON["RibbonBar / HierarchicalMenuBar"]
    BUS["commandBus.ts 命令总线"]
    TOAST["toastBus.ts 提示总线"]
    RIBBON --> BUS
    RIBBON --> TOAST
  end
  LAYOUT --> L2
  BUS --> L1

  subgraph L3["状态层 src/composables (216)"]
    STORES["单例 store<br/>useReviewStore / useToolStore<br/>useSelectionStore / useUserStore<br/>useDisplayThemeStore / useRenderStyleStore"]
    VIEWCTX["useViewerContext.ts<br/>全局视口句柄"]
    LOADER["useDbnoInstancesDtxLoader.ts<br/>按库按需装入 DTX"]
    GEN["useModelGeneration.ts<br/>显式生成 / 整库收集"]
    TREEAPI["usePdmsOwnerTree / useModelTreeStore<br/>模型树取数"]
  end
  L1 --> L3

  subgraph L4["领域层（纯逻辑，少依赖 Vue）"]
    MEASD["src/measurement<br/>domain / kernel / pick / snap / aids"]
    DIMD["src/dimension<br/>domain / kernel / ports / interaction"]
    CLEAR["src/clearance<br/>domain / services / stores"]
    REVIEWD["src/review<br/>domain / adapters / services"]
    ROOM["src/room-clip"]
  end
  L3 --> L4

  subgraph L5["数据源层 src/model-source (26)"]
    PORTS["ports.ts<br/>TreeSource / ModelRecordSource / MeshSource<br/>AttributeSource / KeypointSource<br/>SpatialSource / ModelVersionSource"]
    ADAPTER["genModelV1/*<br/>treeSource / modelRecordSource / attributeSource<br/>keypointSource / spatialSource / versionSource<br/>collectDbnum / serviceLifecycle"]
    ENTRY["index.ts getModelSource()<br/>进程内唯一实例"]
    PORTS --> ADAPTER --> ENTRY
  end
  L3 --> L5

  subgraph L6["API 层 src/api (12)"]
    V1["genModelV1Api.ts<br/>/api/v1 唯一 HTTP 出口<br/>错误信封 code 分型 / refno 归一"]
    RV["reviewApi.ts<br/>编校审单 / 任务 / 认证 / 附件"]
    MBD["mbdV2Api.ts"]
    SPD["genModelSpatialApi.ts / genModelPdmsAttrApi.ts"]
  end
  L5 --> L6
  L1 --> L6

  subgraph L7["渲染层"]
    COMPAT["src/viewer/dtx/DtxCompatViewer.ts<br/>兼容门面：对象状态 / 可见性 / 选中"]
    VIEW["src/viewer/dtx/DtxViewer.ts<br/>Three.js 场景 / 相机 / OrbitControls / Gizmo"]
    DTX["src/utils/three/dtx<br/>DTXLayer / DTXGeometry / DTXMaterial"]
    TOOLS["useDtxTools + dtxTools/controllers<br/>拾取 / 测量 / 批注 / 云线"]
    COMPAT --> VIEW
    COMPAT --> DTX
    TOOLS --> COMPAT
  end
  L1 --> L7
  LOADER --> DTX

  subgraph L8["后端（同进程 gen-model / aios-database :8022）"]
    BE1["/api/v1 模型树 · records · meshes · pt set · spatial · history"]
    BE2["/api/review /api/auth /api/users"]
    BE3["/files/review_attachments"]
  end
  V1 --> BE1
  RV --> BE2
  RV --> BE3
```

## 2. 三维模型加载主链路

`gen-model-v1` 是唯一数据源（legacy `:3100` + parquet/DuckDB-WASM 已于 2026-09-20 退役，见 `src/model-source/ports.ts:35-38`）。

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant T as 模型树 usePdmsOwnerTree
  participant S as model-source<br/>getModelSource()
  participant A as genModelV1Api
  participant B as gen-model :8022
  participant G as useModelGeneration
  participant L as useDbnoInstancesDtxLoader
  participant D as DTXLayer / DtxViewer

  U->>T: 点开节点 / 点眼睛
  T->>S: tree.visibleInsts(refno)
  Note over S,A: visibleInsts 只查不生成（ports.ts:113-114，ADR 0069）
  S->>A: GET /api/v1/model/records?roots=…
  A->>B: 按祖先查 records（ADR-086）
  B-->>A: records（refno / geo_hash / world_transform / dbno）
  opt 用户右键显式重新生成
    U->>G: 右键「重新生成」
    G->>B: POST /api/v1/model/generate
    Note over G,B: 超 120 s 回 202 generation_pending<br/>不报失败，等后台跑完再点眼睛
  end
  A-->>S: ModelRecordsResponse
  S-->>L: Map<refno, InstanceEntry[]>
  L->>S: meshes.meshUrl(geoHash)
  L->>B: GET /api/v1/meshes/{hash}.mesh（rkyv 直连）
  L->>L: parseMeshGeometry → BufferGeometry
  L->>D: DTXLayer 建对象（材质按 useDisplayThemeStore）
  D-->>U: 视口出图
```

## 3. 端口契约（数据源唯一收口）

`src/model-source/ports.ts` 只放类型，运行时代码在 `genModelV1/`。

```mermaid
flowchart LR
  subgraph Consumer["消费方"]
    C1["usePdmsOwnerTree<br/>模型树"]
    C2["useDbnoInstancesDtxLoader<br/>几何装载"]
    C3["PropertiesPanel<br/>属性"]
    C4["usePtsetSnap<br/>测量捕捉"]
    C5["useSpatialQuery<br/>范围 / 距离查询"]
    C6["ModelVersionComparePanel<br/>版本对比"]
  end

  subgraph Port["ports.ts"]
    P1["TreeSource<br/>worldRoot / node / children<br/>ancestors / search<br/>subtreeRefnos / visibleInsts"]
    P2["ModelRecordSource<br/>instanceEntriesByRefnos"]
    P3["MeshSource<br/>meshUrl"]
    P4["AttributeSource<br/>uiAttr / typeInfo"]
    P5["KeypointSource<br/>ptset / memberPtsets<br/>primitiveKeypoints"]
    P6["SpatialSource<br/>nearby / nearbyRefnos / rooms<br/>roomsOf / tree / roomTree"]
    P7["ModelVersionSource<br/>listVersions / loadVersion<br/>attributeHistory / attributeDiff<br/>listNodeVersions / diffSummary"]
  end

  subgraph Impl["genModelV1 适配器"]
    I1["treeSource.ts"]
    I2["modelRecordSource.ts"]
    I3["index.ts meshes"]
    I4["attributeSource.ts"]
    I5["keypointSource.ts"]
    I6["spatialSource.ts"]
    I7["versionSource.ts"]
  end

  C1 --> P1 --> I1
  C2 --> P2 --> I2
  C2 --> P3 --> I3
  C3 --> P4 --> I4
  C4 --> P5 --> I5
  C5 --> P6 --> I6
  C6 --> P7 --> I7
  I1 & I2 & I3 & I4 & I5 & I6 & I7 --> API["src/api/genModelV1Api.ts"]
```

## 4. 编校审工作流

两套并存的枚举，不要混用：**岗位节点**（`WorkflowNode`）与**任务状态**（`ReviewTask.status`）。

- 岗位节点：`sj | jd | sh | pz` = 编制 / 校对 / 审核 / 批准（`src/types/auth.ts:153`、`:166-171`）
- 动作：`submit | return | approve | reject`（`src/types/auth.ts:158`）
- 任务状态：`draft | submitted | in_review | approved | rejected | cancelled`（`src/types/auth.ts:180`）

### 4.1 岗位节点流转（外部校验驱动）

```mermaid
stateDiagram-v2
  [*] --> sj
  sj --> jd: action=active<br/>useReviewStore.ts:1088-1089
  jd --> sh: action=agree<br/>useReviewStore.ts:1067-1068
  sh --> pz: action=agree<br/>useReviewStore.ts:1069
  jd --> sj: action=return
  sh --> sj: action=return
  pz --> sj: action=return
  note right of sj
    return 一律回 sj
    useReviewStore.ts:1091-1093
    （targetNode 未显式指定时）
  end note
```

### 4.2 任务状态

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted
  submitted --> in_review
  in_review --> approved
  in_review --> rejected
  draft --> cancelled
  submitted --> cancelled
  in_review --> cancelled
  approved --> [*]
  rejected --> [*]
  cancelled --> [*]
  note right of in_review
    转移条件由服务端校验接口给，
    前端只按回包更新
    （本条为结构示意，未逐条核实）
  end note
```

### 4.3 面板对应

| 角色 | 面板 |
| --- | --- |
| 校核人待办 | `ReviewerTaskListPanelDock` + `useUserStore.pendingReviewTasks` |
| 审核人待办 | `ReviewerTaskListPanelDock`（同面板按角色过滤） |
| 设计人返工 | `DesignerTaskListPanelDock` + `DesignerCommentHandlingPanelDock` |
| 批注表格 | `AnnotationTableView` / `AnnotationSheetWorkspace` |
| 发起 | `InitiateReviewPanelDock` |

## 5. 目录职责速查

| 目录 | 文件数 | 职责 |
| --- | --- | --- |
| `src/components` | 243 | 面板、审查 UI、模型树、工具栏、弹窗 |
| `src/components/dock_panels` | 28 | dockview 面板壳，`main.ts` 全局注册 |
| `src/components/review` | 118 | 审查面板、批注表格、嵌入模式、快照 |
| `src/composables` | 216 | 状态与流程编排（`useXxx` 单例） |
| `src/dimension` | 181 | 尺寸标注：domain / kernel / ports / interaction / ui |
| `src/measurement` | 59 | 测量：domain / kernel / pick / snap / aids / tubing |
| `src/review` | 47 | 审查领域模型、适配器、服务 |
| `src/clearance` | 29 | 净距 / 穿墙检查 |
| `src/viewer` | 29 | Three.js 视口、相机意图、e3d 外观、版本浏览桥 |
| `src/model-source` | 26 | 数据源端口 + gen-model-v1 适配器 |
| `src/utils` | 132 | 通用工具，含 `utils/three/dtx` 几何层 |
| `src/api` | 12 | REST 客户端（`genModelV1Api` / `reviewApi` / `mbdV2Api`） |
| `src/ribbon` | 9 | 功能区菜单、命令总线、提示总线 |

## 6. 关键约束（逐条带行号依据）

1. **单一数据源**：`MODEL_SOURCE_KINDS` 只有 `'gen-model-v1'`，`getModelSource()` 惰性单例并 `activate()` —— `src/model-source/ports.ts:54`、`src/model-source/index.ts:22-27`。
2. **七端口固定**：`ModelSource` = `tree / records / meshes / attributes / keypoints / spatial / versions` —— `src/model-source/ports.ts:653-662`；装配在 `src/model-source/genModelV1/index.ts:114-126`。
3. **HTTP 单一出口**：适配器不得自拼 URL，一律经 `src/api/genModelV1Api.ts` —— `genModelV1Api.ts:1-17`。
4. **显示与生成分离**：`visibleInsts` 只查 `model/records` 不生成 —— `ports.ts:113-114`；`model/generate` 仅显式触发 —— `genModelV1Api.ts:1000-1013`。
5. **自动补生成默认关闭**：仅 `?dtx_enable_auto_generation=1|true` 开启 —— `src/composables/useModelGeneration.ts:25-39`。
6. **网格直连**：`GET /api/v1/meshes/{geoHash}.mesh`（rkyv 原样），由装载链自行 fetch 后 `parseMeshGeometry` —— `genModelV1Api.ts:2848-2863`、`useDbnoInstancesDtxLoader.ts:574-590`。
7. **refno 归一**：服务端收发 `a/b` 与 `a_b`，本仓内部统一 `a_b`，转换只在 `genModelV1Api.ts` 做 —— `genModelV1Api.ts:20-27`。
8. **dev 代理**：前端 `:3101`，`/api` 与 `/gm` 默认打到 `http://localhost:8022`；旧 `:3100` 已退役 —— `vite.config.ts:42`、`:106-130`。

## 7. 分析方法与局限

本图由两条独立路径产出后交叉核对：

1. **主会话逐文件读取**：`main.ts`、`App.vue`、`DockLayout.vue`、`ports.ts`、`genModelV1/index.ts`、`genModelV1Api.ts`、`useDbnoInstancesDtxLoader.ts`、`useModelGeneration.ts`、`DtxViewer.ts`、`vite.config.ts`、`types/auth.ts`、`useReviewStore.ts`。
2. **cursor-agent 只读分析**（`--mode ask --trust`，账号 `daiwuyun145000@outlook.com`）：两轮独立输出，结论与主会话一致的部分才采纳。

已发现并修正的两处偏差：

- 早期版本写成「点眼睛会触发生成」，实际 `visibleInsts` 只查不生成（`ports.ts:113-114`），已改。
- cursor-agent 第二轮的 `return` 边写成 `sh→jd`、`pz→sh`，与源码 `useReviewStore.ts:1091-1093`（return 一律回 `sj`）冲突，按源码定稿。

未核实项（不臆断，明确标注）：

- `ReviewTask.status` 各转移的具体触发条件（服务端校验接口回包驱动），本文只列枚举，不画条件边。
- `DTXLayer` 内部几何装配的逐函数调用顺序，本文只到「装载器 → 视口」这一层。

