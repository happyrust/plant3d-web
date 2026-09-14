# 现状简报：plant3d-web 三维校审的「三维批注」交互（2026-09-14）

> 本文由接手会话依据源码与设计文档整理，供外部评审模型阅读。附件里的其它文件是仓库里的原始设计文档 / ADR，本文是它们与当前代码状态的汇总。

## 1. 系统与场景

- 前端 `plant3d-web`：Vue 3 + TypeScript + Three.js（自研 DTX 查看器，`DTXSelectionController` 负责拾取/选择集），测量工具部分接 xeokit。批注渲染是 **HTML overlay（CSS2D 风格的 div 卡片 / 图钉）+ 场景内 MeshLine 线条** 的混合。
- 后端 `gen-model-refactor`（Rust/axum + SurrealDB）：校审域 REST `/api/review/*`（tasks / records / comments / annotations / annotation-states / attachments / embed-url / workflow）、`/api/auth/token`、`/files/review_attachments`。
- 宿主：**PowerPMS 以 iframe 嵌入**三维校审页（`user_token + form_id` 落地，按角色自动打开对应工作台）；也可独立站点使用。桌面浏览器为主，无触屏 / 移动端支持。
- 工作流四节点 **sj 编制 → jd 校对 → sh 审核 → pz 批准**，可驳回到任一前置节点。角色：设计人员（sj，发起、处理批注）、校对 / 审核 / 批准（jd/sh/pz，创建批注、确认数据、流转 / 驳回）。
- 多人协作：WebSocket 刷新任务 / 历史；同一任务同时通常只有一个节点负责人在动。

## 2. 四类批注（数据模型见 `useToolStore.ts`）

| 类型 | 创建方式 | 几何 / 表现 | 备注 |
|---|---|---|---|
| `text` 文字批注 | 点击模型表面一次 | 图钉（世界点 `worldPos`）+ 可拖动文字卡片（`labelWorldPos`）+ 引线；双击图钉折叠 / 展开；标题 / 描述在卡片内联编辑 | 命中构件同时写 anchor+member 两条绑定（ADR-0049） |
| `cloud` 云线批注 | 三步：选目标元素 → 点模型取锚点 → 拖矩形 | **屏幕空间**波浪矩形（`anchorWorldPos + screenOffset + cloudSize` 每帧 billboard 重建）；另有 `bbox3d` 模式用目标集合合并 AABB 画三维波浪框 | 带角色绑定 `bindings[{refno, role:'anchor'|'member', noun}]`；创建后可增删 member，锚点不可换（ADR-0051） |
| `rect` 矩形批注 | 点击一个对象 | 该对象 OBB 包围框 + 引线 + 卡片 | |
| `obb` | 同上（选择集 OBB） | OBB + 标签锚点（top_center / corner） | |

公共字段：`title / description / severity / reviewState / comments[] / authorId / screenshot / collapsed / visible / refnos`。

- **严重度（错误类型）** `AnnotationSeverity = 'principle' 原则错误(×红) | 'general' 一般错误(△橙) | 'drawing' 图面错误(○蓝)`。云线轮廓颜色归样式面板（用户可配三套预设），severity 只通过图钉 / 徽标 / 色点表达（不接管轮廓色）。
- **处理状态** `reviewState { resolutionStatus, decisionStatus, history[] }`：设计人员标「已处理 fixed」，校核人「同意 agree / 驳回 reject」，每步带操作人与备注；后端 `POST /api/review/annotation-states/apply`。
- **评论线程** `comments[]` 多角色（`useCommentThread`，`/api/review/comments`）。
- **代表截图**：云线创建完成后**立即自动**从 WebGL 主画布截一张（编号徽标 A1/C… 画进场景，ADR-0052），每条批注仅一张，可「重拍」覆盖，删批注级联删附件（ADR-0053）。
- 可以在批注详情里「补一条测量」（距离 / 角度 / 标高 / 标高差）挂到批注上。

## 3. 云线创建的现行交互（最核心、也最重的一条）

浮动工具条（`AnnotationOverlayBar.vue`，可拖动，默认右上）在云线模式下展开一张向导卡：

1. **步骤条**：① 选目标 → ② 取锚点 → ③ 拖框。有「重选锚点」回退到 ②。
2. **选择层级**开关：`element`（命中即元件 COUP/BEND/VALV…）/ `branch`（上溯到整条 BRAN）。
3. **关联元素 N** 区块，四个按钮：「使用当前选择」（读模型树 / 视口当前选择集）、「点选目标」（进入 `pick_refno`，连续点击累积，光标处重叠构件 **Tab 轮换**，Enter 确认 / Esc 取消）、「框选目标」（进入 `pick_refno_box`，松手即确认，**会把矩形内所有投影元素含被遮挡 / 背景元素都收进来**；设计稿要求弹候选确认列表，默认全勾按 noun 分组）、「清空」。已选目标以标签显示，可逐个定位 / 移除。
4. **闸门**集中在工具层 `useDtxTools`（进入云线模式有四个入口：批注面板、浮动工具条、校审工作台、校审面板）：目标为空 → 不能取锚点也不能拖框，toast「请先关联至少一个目标元素」；无锚点拖框 → toast「请先在模型上点击一处锚点」。对应步骤闪红。
5. 拖框完成 → 立即创建记录 + **自动截图** → 卡片显示「云线已创建（共 N 条），请填写错误类型与描述，再到『待保存证据』保存」，卡内直接给 severity 三选 + 描述 textarea。
6. **持久化是攒批次的**：批注先进 `useToolStore`（localStorage V6 版本化持久），点右侧面板「确认当前数据」→ 确认浮层核对数量 → `POST /api/review/records`（payload superset，`cloud_annotations` 等数组内嵌 JSON）。三条恢复链路（task_records / workflow_sync / import_package）都以 payload 为权威。
7. Esc 语义：点选 / 框选中 Esc 返回云线工具（保留已确认目标）；云线工具中 Esc 清空本次目标、锚点、预览并退出；切换工具 = 全部清理；创建成功后清空目标与锚点但保留云线工具。
8. 状态条文案（`useDtxTools.statusText`）：`云线批注：请先选择目标元素` / `已选 N 个目标元素，请点击模型选择锚点` / `锚点已就绪，请拖拽绘制云线轮廓`。

## 4. 查看 / 处理侧的现有界面

- **右侧「批注与测量」面板** `AnnotationPanel.vue`（~55KB）：按类型分区列表、severity 概览 / 过滤、文字批注折叠开关、定位 / 高亮。
- **校审工作台** `AnnotationWorkspace.vue` + `AnnotationInlineDetailCard.vue`：列表 ↔ 详情；详情含 bindings 列表（逐个定位 / 移除 / 添加 member / 定位全部）、截图查看 / 重拍、补测量、评论、处理状态。
- **批注表格视图** `AnnotationTableView.vue`：列 = 序号 | 错误标记 | 校核发现问题 | 处理情况 | 操作；搜索 / 排序 / 状态筛选 / CSV 导出 / 分页 / 右键菜单；**单击行 = 右侧 Drawer，双击行 = 飞到三维构件**；与三维查看器互斥切换（中央 tab）。
- **设计人员批注处理面板** `DesignerCommentHandlingPanel.vue`：sj 处理被驳回单据的批注（标记已处理、回复）。
- 视口内「**当前模型关联云线**」入口：选中模型元素 → 反查其 member 绑定的云线（锚点不参与反查，ADR-0049）。
- 首次使用向导 `useOnboardingGuide`（按钮说明式，未自动触发）。

## 5. 已落地的架构决策（不可推翻，方案须兼容）

- ADR-0049 关联统一为带角色绑定（anchor / member），反查只看 member。
- ADR-0050 模型加载 / 版本切换后批量重解析绑定，失效进 `stale/missing/unloaded` 降级态，仅允许重绑或移除，不静默删。
- ADR-0051 创建后可增删 member，**锚点构件不可换**（锚点几何签名参与 `annotationKey`，用于跨快照评论归并）。
- ADR-0052 截图直接读 WebGL 画布，编号徽标画进场景；文字不进截图。
- ADR-0053 每批注一张代表截图，云线创建即拍。
- 记录 schema 只增不改（`refnos/anchorRefno` 双写保留），localStorage 容器版本不升；payload superset；三条恢复链路不得改成列表语义。
- 团队工程风格：小步、可回退、每步有 vitest + Playwright 证据；不一次性重写 `useDtxTools.ts`（约 4900 行）/ `ViewerPanel.vue`；新交互先做纯函数状态机再接线。
- 视觉方向：把视觉元素画进场景（矢量字形、徽标），不用 DOM 合成截图。

## 6. 观察到的摩擦点（接手方的初步判断，请评审者独立验证或反驳）

1. **一条云线要 3 步 + 1 次保存 + 至少 5 次点击**，且「先选目标」要求用户在还没标出问题位置前就决定关联对象；工程校审的自然动作是「看到问题 → 圈出来 → 顺手说明」。
2. **入口四处、面板四处**（浮动工具条向导卡、右侧批注面板、校审工作台详情、表格视图 Drawer）都能改同一条批注，语义重复、状态同步成本高，新手不知去哪儿。
3. **屏幕空间云线**：相机一转，波浪框仍按固定像素尺寸围着锚点重建，可能盖住无关几何；`bbox3d` 又过大过方。缺少「随构件轮廓 / 随可见投影自适应」的表现。
4. **拾取困难**：密集管线下点选靠 Tab 轮换重叠候选，框选会收进被遮挡 / 背景元素（设计稿的候选确认列表可缓解但仍打断流程）。
5. **草稿 vs 已确认状态不可见**：批注创建后存 localStorage，要另点「确认当前数据」才落库；刷新 / 切任务 / 新建单据曾出现串批注（issue: annotation-persist-on-new-task）。用户不知道哪些已保存。
6. **一张自动截图**在创建瞬间拍，用户往往还没把视角调好；文字不进截图，PMS 端表单要靠表格。
7. **批注导航**：多条批注间没有「上一条 / 下一条 + 飞行 + 高亮当前」的连贯浏览，表格双击飞行是唯一跨批注导航。
8. 工具模式极多（10+ 种测量 + 4 种批注 + 拾取），共用一条 pointer 管线，切模式即清状态，误切代价高。
9. 无触屏 / 小视口适配；PMS iframe 可能很窄。
10. 渲染是 HTML overlay 为主：卡片多时遮挡、层级混乱、截图不含卡片。

## 7. 评审者可以假定的能力边界

- 可以新增：纯前端状态机 / 组件 / 记录字段（只增）/ 后端新只读端点或 PATCH（需排期）。
- 可以调整：交互顺序、快捷键、默认值、视觉表现、面板分工、保存时机（但三条恢复链路与 payload 权威不变）。
- 不可以：换渲染引擎、推翻 ADR-0049～0053、破坏 PMS 嵌入落地与四节点流程、一次性大重写。
