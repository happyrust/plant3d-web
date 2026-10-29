# Requirements Document

## Introduction

本特性在现有「节点版本」面板（ADR 0066）上增加**可拖拽的版本时间轴**：用户能快速看到一个节点的版本分布，拖动游标即在三维中看到该节点（及其最小交付单元）在不同会话（sesno）下的模型，并能把任意两个时刻钉住做 A / B 对比。

历史模型改为**同步实时查询**：前端发一次请求，gen-model 由 e3d-model 按 e3d-io 提供的会话链即时算出该最小交付单元在该会话下的几何，在同一个响应里返回 `instances` 与 `tubes`。新路径不再有生成任务、轮询、`snapshot_key`，也没有前端可见的快照存储。

废弃的 `specs/004-model-version-timeline/` 不作为依据；现行依据是 `docs/adr/0066-…summary-first.md` 与 `docs/guides/MODEL_VERSION_VIEW_TUTORIAL.md`，后端为 `gen-model` `refactor` 分支（HEAD `d82cd90ce`）。后端改动落在 `refactor`，用 rocksdb 档在本地验证；发布部署不在本特性范围内。

### 现状分析

**后端（gen-model `/api/v1`，按需算、不落库，ADR-081）**

| 能力 | 路由 | 现状 |
|---|---|---|
| 单元版本表 | `GET model/versions` | 由会话链算出，每行 `sesno` / `session_time` / `impact_kind`；进程内缓存 64 张表；`since_sesno` + `limit`（缺省 500、上限 5000）翻页 |
| 构件 / 任意节点版本表 | `GET element/versions`、`GET node/versions?scope=` | 同上口径，`node/versions` 支持「仅自身 / 所有子节点」 |
| 属性时间线 / 属性净差 | `GET element/attribute-history`、`GET element/attribute-diff` | 毫秒级，不需快照 |
| 差异摘要 | `GET node/diff-summary` | 按单元分组的构件级差异 + 成本判定，不生成几何 |
| 历史投影 | `POST model/history/generate` → `GET tasks/{id}` 轮询 → `POST model/history/query`（`instances` / `tubes` / `attributes` / `snapshot`）→ `DELETE model/history/{key}` | 一次只生成**一个单元 × 一个会话**；后台任务，超时 300 s；选择器已支持 `sesno` 或 `time`（`TIME_BEFORE_OLDEST_SESSION` 等错误码）；快照存进程内投影存储，最多 16 格（`model_historical_snapshots_max`），超出按最近一次 generate 淘汰最旧一格 |

历史投影的计算本身与快照无关：`generate_historical` 先用 `E3dModelService::generate_snapshot_source(dbnum, refno, sesno, …)` 从会话链算出该单元的构件几何，再用 `apply_geometry_delta_on(ProjectionScope::Historical(snapshot_key), …)` 写进进程内投影存储（网格文件按 `mesh_id` 写入共享网格目录），之后才能 query。计算阶段已有的约束：refno 所属库必须等于请求的 dbnum（否则 `INVALID_SELECTOR`）、访问构件数上限 100 000（`GENERATION_LIMIT_EXCEEDED`）、单元根必须是交付单元（`NOT_A_DELIVERY_UNIT_ROOT`，422）、sesno 不在会话链上为 `SESSION_NOT_FOUND`（404）。

**前端（plant3d-web）**

- `NodeVersionTimeline.vue` + `useNodeVersionTimeline.ts` + `utils/nodeVersionTimeline.ts`：时间线是**纵向列表**，缺省只画最近 20 行，每行点 A / B 按钮选两版；没有按时间排布的轴，也没有拖拽。
- `NodeVersionModelTab.vue` → `modelUnitCompareLoader.ts` → `versionSource.loadVersion`：对 A、B 各跑一次 generate → 500 ms 轮询 → query `instances` + `tubes` → 映射成 `GeomInstQuery`；`geometryKey` 相同时只装一份。
- `viewer/modelUnitCompareController.ts`：两个隔离图层（A / B），四态着色、单视口切换、双视口分屏、只看差异；`open` / `clear` 是整轮装卸。
- 换 A / B 会先退出上一轮（卸图层、`DELETE` 快照）再重跑，已生成的历史投影不复用。

### 差距

1. **没有时间轴视图**：版本只能按列表行看，看不出时间分布与疏密，长历史要点「加载更早」。
2. **没有「单游标浏览」模式**：三维只能装 A / B 两版，看第三版必须重选再整轮重跑。
3. **历史模型无法实时查询**：历史模型必须走 generate → 轮询 → query → DELETE 的快照流程，每次切版本都要建任务、轮询、全量 query、重建图层，首次几秒到十几秒；快照占用服务端 16 格上限，前端还要管理快照的创建与删除。前端也没有帧缓存与预取。本特性引入同步的实时历史模型查询，并在前端加帧缓存与预取。
4. **没有时间点查询的只读口**：generate 已能按 `time` 解析会话，但没有不生成几何就把「某时刻 → 生效 sesno」告诉前端的路由，时间轴拖到两版之间时无法确认落在哪一版。
5. **没有游标的直达链接**：URL 只有 `compare_a` / `compare_b`。

### 时间轴排布口径

时间轴按**会话链顺序（sesno 由小到大）**排布，Session_Time 只作标注，不决定横向位置。原因：会话链上的 Session_Time 不单调。AvevaMarineSample 的 423 / 443 库中，会话 1 的时间晚于链上其余会话，最大倒退 13.6 年；按时间排布会让刻度顺序与会话链顺序不一致，拖动、相邻版本与 A / B 先后都会错乱。时间点解析沿用后端现有 `select_session_at` 的会话链顺序规则（Requirement 8）。

环境仍是「混合时间视图」：只有被查节点所属的最小交付单元显示历史版本，其余场景是最新模型（CONTEXT Q12）。本特性不改变这一点。

## Glossary

- **Node_Version_Panel（节点版本面板）**：前端现有的「节点版本」面板（`ModelUnitVersionComparePanel.vue` 及其子 tab），本特性在其中加时间轴。
- **Timeline_Scrubber（版本时间轴）**：Node_Version_Panel 中按 Chain_Order 横向排布版本刻度、可拖动游标的控件。
- **Version_Tick（版本刻度）**：Timeline_Scrubber 上代表一个版本（一行版本表记录）的标记。
- **Chain_Order（会话链顺序）**：版本按 sesno 由小到大的顺序。Timeline_Scrubber 的排布、游标移动、相邻版本、「最早 / 最新」与 A / B 先后都以 Chain_Order 为准。
- **Tick_Ordinal（刻度序号）**：Version_Tick 在当前 Compare_Scope 版本表 Chain_Order 中的位置，从 0 开始；Timeline_Scrubber 的横坐标与缩放范围以 Tick_Ordinal 计。
- **Time_Anomaly_Marker（时间异常标记）**：Session_Time 早于 Chain_Order 中前一个带 Session_Time 的版本时，Timeline_Scrubber 在该 Version_Tick 上显示的「时间异常」标记。
- **Tick_Cluster（簇刻度）**：Timeline_Scrubber 在当前缩放下把水平间距小于 4 px 的多个 Version_Tick 合并显示成的一个刻度，标注其包含的刻度数。
- **Version_Cursor（版本游标）**：Timeline_Scrubber 上用户拖动的指针，任一时刻指向恰好一个 Version_Tick。
- **Cursor_Version（游标版本）**：Version_Cursor 当前指向的版本的 sesno。
- **Pinned_Version（钉住版本）**：用户从 Version_Cursor 钉住作为对比参照的版本，分为 A 钉与 B 钉。
- **Browse_Mode（版本浏览模式）**：三维中只显示 Cursor_Version 一版历史模型、随游标切换的显示模式。
- **Compare_Mode（版本对比模式）**：三维中按现有 A / B 两版装载、四态着色的显示模式（即 ADR 0066 的「模型对比」）。
- **Version_Service（版本服务）**：gen-model `/api/v1` 中提供版本表、实时历史模型查询、属性与差异的服务端；历史几何由其中的 e3d-model 按 e3d-io 提供的会话链计算。
- **Realtime_History_Query（实时历史模型查询）**：Version_Service 的一个同步只读路由（例如 `GET /api/v1/model/history/geometry?dbnum=&unit_refno=&sesno=` 或 `&time=`），在同一个 HTTP 响应中返回一个 Delivery_Unit 在一个会话下的历史几何；不创建任务、不产生 `snapshot_key`。
- **History_Geometry_Response（历史几何响应）**：Realtime_History_Query 成功时的响应体，包含解析后的 sesno、Session_Time、`geometryKey`、`instances` 与 `tubes`。
- **Geometry_Key（几何摘要）**：History_Geometry_Response 中的 `geometryKey`，由该单元该会话的几何内容算出的摘要；几何内容相同则摘要相同，几何内容不同则摘要不同。
- **History_Query_Timeout（历史查询超时）**：前端等待一次 Realtime_History_Query 响应的最长时间，缺省 60 s，可配置。
- **Realtime_Concurrency_Limit（实时查询并发上限）**：Version_Service 同时进行的 Realtime_History_Query 计算数上限，缺省 4，可配置。
- **Realtime_Result_Cache（实时结果缓存）**：Version_Service 内部可选的 History_Geometry_Response 内存缓存，仅用于加速，对前端不可见。
- **Legacy_History_Path（旧版历史投影流程）**：现有 `model/history/generate` → `tasks/{id}` 轮询 → `model/history/query` → `DELETE model/history/{snapshot_key}` 流程；该流程在服务端留下由 `snapshot_key` 标识的历史快照。本特性只在旧服务端降级时使用该流程（Requirement 10）。
- **Version_Frame（版本帧）**：某个最小交付单元在某个 sesno 下的历史几何，由 History_Geometry_Response（降级时由 Legacy_History_Path 的 query 结果）转换为可装进隔离图层的实例数据。
- **Frame_Cache（帧缓存）**：前端保存 Version_Frame 的内存缓存。
- **Frame_Prefetcher（帧预取器）**：前端在 Version_Cursor 附近提前请求 Version_Frame 的逻辑。
- **Compare_Viewport（对比视口）**：现有 `modelUnitCompareController` 驱动的三维隔离图层与角标。
- **Delivery_Unit（最小交付单元）**：几何生成的最小单位（BRAN / EQUI 等，由项目 `delivery_unit_types` 判定）。
- **Compare_Scope（对比范围）**：ADR 0066 定义的「仅自身 / 所有子节点」开关。
- **Session_Time（会话时间）**：版本表行的 `session_time` 字段，E3D 保存会话的时间。Session_Time 沿 Chain_Order 不保证单调，也可能缺失。
- **Changed_Unit（变化单元）**：在「所有子节点」范围下，相邻两版之间几何有变化的 Delivery_Unit。

## Requirements

### Requirement 1: 显示版本时间轴

**User Story:** 作为校审 / 设计人员，我想打开节点版本面板就看到一条按时间排布的版本轴，以便一眼看出这个节点在什么时候变得多、变了什么。

#### Acceptance Criteria

1. WHEN Node_Version_Panel 取得当前 Compare_Scope 下的版本表, THE Timeline_Scrubber SHALL 为版本表中的每一行渲染一个 Version_Tick，Version_Tick 数（簇刻度按其包含的刻度数计）等于版本表行数。
2. THE Timeline_Scrubber SHALL 按 Chain_Order 从左到右等距排布 Version_Tick，每个 Version_Tick 的横坐标只由其 Tick_Ordinal 决定，与 Session_Time 无关；Session_Time 只作为轴上的次级标注、悬停提示与游标标注显示，缺少 Session_Time 的版本在这些位置显示「无时间」。
3. IF 一个版本的 Session_Time 早于 Chain_Order 中前一个带 Session_Time 的版本的 Session_Time, THEN THE Timeline_Scrubber SHALL 在该 Version_Tick 上显示 Time_Anomaly_Marker，悬停时同时显示该版本与前一个带 Session_Time 的版本的 sesno 与 Session_Time。
4. THE Timeline_Scrubber SHALL 让版本表中出现的每一种 `impact_kind` 取值使用一种互不相同的刻度颜色，在轴旁显示列出每种颜色对应 `impact_kind` 的图例，并让「仅属性」会话的 Version_Tick 使用空心刻度、几何变化会话的 Version_Tick 使用实心刻度。
5. WHEN 用户把指针悬停在一个 Version_Tick 上, THE Timeline_Scrubber SHALL 显示该版本的 sesno、Session_Time、保存人、备注与影响类型，并在版本表行缺少某一字段时把该字段显示为「—」。
6. WHEN 版本表含 500 行, THE Timeline_Scrubber SHALL 在版本表数据到达后 500 ms 内完成首次渲染。
7. WHILE 多个 Version_Tick 在当前缩放下的水平间距小于 4 px, THE Timeline_Scrubber SHALL 把这些刻度合并为一个簇刻度，簇刻度上标注其包含的刻度数，悬停时显示簇内 sesno 最小与最大版本的 sesno 与 Session_Time，簇内任一 Version_Tick 带 Time_Anomaly_Marker 时簇刻度也显示该标记。
8. WHEN 用户在 Timeline_Scrubber 上执行缩放手势（滚轮或双指）, THE Timeline_Scrubber SHALL 以指针所在的 Tick_Ordinal 位置为中心缩放可见的 Tick_Ordinal 范围，缩小不超过版本表全部 Version_Tick 的范围，放大到可见范围不少于 5 个 Version_Tick（版本表不足 5 行时为全部行）为止，并展开缩放后间距达到 4 px 的簇刻度。
9. WHEN Compare_Scope 切换, THE Timeline_Scrubber SHALL 用新范围的版本表重绘 Version_Tick，并保留 Version_Cursor 与 Pinned_Version 的 sesno。
10. IF Version_Cursor 或 Pinned_Version 的 sesno 不在新范围的版本表中, THEN THE Timeline_Scrubber SHALL 在该 sesno 按 Chain_Order 应处的位置（新范围版本表中 sesno 小于它的最后一个 Version_Tick 与 sesno 大于它的第一个 Version_Tick 之间）以灰色标记显示，并标注「本范围无变化」。
11. IF 当前 Compare_Scope 下的版本表有 0 行, THEN THE Timeline_Scrubber SHALL 不渲染 Version_Tick 和 Version_Cursor，并在轴区域显示「该范围没有版本记录」。
12. IF Version_Service 返回版本表请求失败（`model/versions` 路由缺失除外，按 Requirement 10 第 3 条处理）, THEN THE Timeline_Scrubber SHALL 在轴区域显示 Version_Service 返回的错误码与消息和一个「重试」按钮，并保留切换前已显示的 Version_Cursor 与 Pinned_Version 的 sesno。
13. WHEN 用户点击一个簇刻度, THE Timeline_Scrubber SHALL 把可见范围缩放到该簇 sesno 最小与最大版本的 Tick_Ordinal 之间，直到簇内刻度间距达到 4 px 或可见范围达到第 8 条的 5 个 Version_Tick 下限。

### Requirement 2: 拖动版本游标

**User Story:** 作为校审人员，我想拖动时间轴上的游标在版本之间移动，以便不用逐行点选就能浏览历史。

#### Acceptance Criteria

1. WHILE 当前 Compare_Scope 下的版本表至少含 1 行, THE Timeline_Scrubber SHALL 显示恰好一个 Version_Cursor，且该 Version_Cursor 指向版本表中恰好一个版本。
2. WHEN Node_Version_Panel 首次为一个节点显示 Timeline_Scrubber, THE Timeline_Scrubber SHALL 把 Version_Cursor 放在当前 Compare_Scope 版本表中 sesno 最大的版本上。
3. WHILE 用户拖动 Version_Cursor, THE Timeline_Scrubber SHALL 把 Version_Cursor 吸附到距指针水平距离最近的 Version_Tick；距离相等时吸附到 sesno 较大的 Version_Tick；指针超出轴左端或右端时分别吸附到 Chain_Order 中第一个或最后一个 Version_Tick。
4. WHEN 用户松开拖动中的指针（包括在 Timeline_Scrubber 区域之外松开）, THE Timeline_Scrubber SHALL 把 Version_Cursor 固定在松开前最后一次吸附到的 Version_Tick，并以该版本的 sesno 作为 Cursor_Version。
5. WHILE Timeline_Scrubber 获得键盘焦点, WHEN 用户按下左方向键或右方向键, THE Timeline_Scrubber SHALL 把 Version_Cursor 移到按 Chain_Order 相邻的前一个或后一个 Version_Tick；Version_Cursor 已在 Chain_Order 第一个（左键）或最后一个（右键）Version_Tick 时保持不动，Cursor_Version 不变。
6. WHEN 用户点击一个 Version_Tick, THE Timeline_Scrubber SHALL 把 Version_Cursor 移到该 Version_Tick；被点击的是簇刻度时，Timeline_Scrubber 同时按 Requirement 1 第 13 条缩放可见范围，并把 Version_Cursor 移到簇内 sesno 最大的版本。
7. WHILE Version_Cursor 指向一个版本, THE Timeline_Scrubber SHALL 在游标旁显示 Cursor_Version 的 sesno 与 Session_Time；该版本缺少 Session_Time 时只显示 sesno 并在时间位置标注「无时间」；该版本带 Time_Anomaly_Marker 时在游标标注中同时显示「时间异常」。
8. WHEN Cursor_Version 改变, THE Node_Version_Panel SHALL 在 300 ms 内在纵向版本列表中高亮 Cursor_Version 对应的行并将其滚动到可见区域；该行尚未在列表中加载时，先加载到包含该行为止再高亮。
9. WHERE 用户勾选「只看几何变的」, THE Timeline_Scrubber SHALL 让 Version_Cursor 的拖动吸附、方向键移动与点击定位只落在 `impact_kind` 表示几何有变化的 Version_Tick 上，点击「仅属性」刻度时 Version_Cursor 不动。
10. WHERE 用户勾选「只看几何变的」, IF 勾选时 Version_Cursor 正指向「仅属性」版本, THEN THE Timeline_Scrubber SHALL 把 Version_Cursor 移到 sesno 不大于当前值的最后一个几何变化版本；不存在这样的版本时，移到 sesno 最小的几何变化版本。
11. IF 当前 Compare_Scope 的版本表为空，或勾选「只看几何变的」时版本表中没有几何变化版本, THEN THE Timeline_Scrubber SHALL 不显示 Version_Cursor、停用拖动与方向键操作，并在轴上显示「当前范围没有可浏览的版本」。

### Requirement 3: 版本浏览模式下随游标显示模型

**User Story:** 作为校审人员，我想拖到哪一版三维里就显示那一版的模型，以便直观看到模型随时间的变化。

#### Acceptance Criteria

1. WHEN 用户在 Node_Version_Panel 中点击「浏览」进入 Browse_Mode, THE Compare_Viewport SHALL 在隔离图层中装入当前节点所属 Delivery_Unit 在 Cursor_Version 下的 Version_Frame，并隐藏环境中同一 Delivery_Unit 的当前几何，环境中其余 Delivery_Unit 保持显示最新几何。
2. WHILE Browse_Mode 激活, THE Compare_Viewport SHALL 在视口角标中显示「浏览 · sesno <Cursor_Version> · <Session_Time>」，且角标中的 sesno 与隔离图层中实际装入的 Version_Frame 的 sesno 一致。
3. WHILE 用户按住指针拖动 Version_Cursor, THE Node_Version_Panel SHALL 仅在 Version_Cursor 连续 150 ms 吸附在同一个 Version_Tick 上之后，才为 Frame_Cache 中没有的 Cursor_Version 发起 Realtime_History_Query；停留不足 150 ms 就经过的 Version_Tick SHALL 不发起请求。
4. WHEN 用户松开拖动、点击 Version_Tick 或按方向键使 Cursor_Version 改变, THE Node_Version_Panel SHALL 立即为 Frame_Cache 中没有的 Cursor_Version 发起 Realtime_History_Query，不等待 150 ms。
5. WHEN Cursor_Version 改变且其 Version_Frame 已在 Frame_Cache 中, THE Compare_Viewport SHALL 在 Cursor_Version 改变后 300 ms 内把隔离图层内容切换为该 Version_Frame，且不向 Version_Service 发起 Realtime_History_Query。
6. WHILE Cursor_Version 的 Realtime_History_Query 尚未返回, THE Compare_Viewport SHALL 保持显示上一个已装入的 Version_Frame，并在角标中显示「正在加载 sesno <Cursor_Version>」；若进入 Browse_Mode 后尚无已装入的 Version_Frame，THE Compare_Viewport SHALL 保持隔离图层为空并显示同一角标。
7. WHEN 一个 Realtime_History_Query 成功返回时 Cursor_Version 已改为其他 sesno, THE Node_Version_Panel SHALL 把转换得到的 Version_Frame 存入 Frame_Cache 而不装入 Compare_Viewport，Compare_Viewport SHALL 只装入当前 Cursor_Version 的 Version_Frame。
8. WHEN 前后两次装入的 Version_Frame 具有相同 `geometryKey`, THE Compare_Viewport SHALL 保留已装入的几何不重新装载，只更新角标中的 sesno 与 Session_Time。
9. WHILE Browse_Mode 激活, THE Compare_Viewport SHALL 在 Version_Frame 切换时保持相机位置、朝向与缩放不变；只在每次进入 Browse_Mode 后装入第一个 Version_Frame 时，把相机调整到 Delivery_Unit 包围盒完整显示在视口内。
10. WHEN 用户在 Browse_Mode 中点选隔离图层里的构件, THE Node_Version_Panel SHALL 直接向 Version_Service 查询该构件在 Cursor_Version 下的属性（Requirement 6 第 13 条，不经过任何历史快照），把属性面板显示的属性改为查询结果，并显示横幅「属性来自 sesno <Cursor_Version>」；Cursor_Version 再次改变时，横幅与属性 SHALL 随新的 Cursor_Version 重新查询并更新。
11. IF Realtime_History_Query 返回 `UNIT_NOT_PRESENT`, THEN THE Compare_Viewport SHALL 清空隔离图层，环境中同一 Delivery_Unit 的当前几何保持隐藏，并在角标中显示：响应原因为 `not-yet`（Cursor_Version 早于该单元首次出现的版本）时显示「该版本没有这个单元」，原因为 `deleted`（Cursor_Version 晚于该单元被删除的版本）时显示「该版本单元已删除」。
12. IF Realtime_History_Query 返回错误，或在 History_Query_Timeout（缺省 60 s）内没有返回, THEN THE Node_Version_Panel SHALL 中止该请求，在 Timeline_Scrubber 上把该 Version_Tick 标为失败，在面板中显示 Version_Service 返回的错误码与消息（超时显示「查询超时」；`REFNO_NOT_IN_CHAIN` 等未单列的错误码按同一通用方式显示），并保持显示上一个已装入的 Version_Frame。`HISTORY_BUSY` 按第 16 条处理，重试用尽后才按本条标为失败。
13. WHEN Version_Cursor 移到一个标为失败的 Version_Tick 且用户点击「重试」, THE Node_Version_Panel SHALL 为该 sesno 重新发起一次 Realtime_History_Query，并在请求开始时清除该 Version_Tick 的失败标记。
14. WHEN 用户退出 Browse_Mode, THE Compare_Viewport SHALL 卸下隔离图层并恢复显示环境中该 Delivery_Unit 的当前几何，同时移除浏览角标与属性横幅。
15. WHEN Cursor_Version 改变时上一个 Cursor_Version 的 Realtime_History_Query 仍未返回, THE Node_Version_Panel SHALL 在上一个 sesno 位于新 Cursor_Version 前后各 2 个版本范围内且进行中的预取请求少于 2 个时，把该请求转为预取请求继续执行（计入 Requirement 4 第 5 条的上限）；其他情况下中止该请求并关闭对应的 HTTP 连接，被中止的请求不标为失败。
16. IF Cursor_Version 的 Realtime_History_Query 返回 `HISTORY_BUSY`（Requirement 7 第 1 条）, THEN THE Node_Version_Panel SHALL 按响应的 `Retry-After` 等待后自动重发该请求，最多重发 3 次，等待期间角标保持显示「正在加载 sesno <Cursor_Version>」；第 3 次重发仍为 `HISTORY_BUSY` 时按第 12 条把该 Version_Tick 标为失败。Cursor_Version 在等待期间改变时，THE Node_Version_Panel SHALL 按第 15 条处理该请求。

### Requirement 4: 帧缓存与预取

**User Story:** 作为校审人员，我想来回拖动时已看过的版本立即出现、相邻版本提前准备好，以便对比时不用每次等待查询。

#### Acceptance Criteria

1. WHEN 一个 Realtime_History_Query 成功返回且其 `instances` 与 `tubes` 已转换为可装进隔离图层的实例数据, THE Frame_Cache SHALL 以（dbnum, Delivery_Unit refno, sesno）为键保存该 Version_Frame 及其 `geometryKey`；返回错误、超时或被中止的请求不写入 Frame_Cache。
2. THE Frame_Cache SHALL 按最近使用顺序（一个键被写入或被装入 Compare_Viewport 时记为一次使用）保留最多 12 个键；超出时淘汰最久未使用的一个键，被淘汰的键不得是当前装入 Compare_Viewport 的 Version_Frame、A 钉或 B 钉对应的 Version_Frame。12 个上限按键计：在「所有子节点」范围下一个 Cursor_Version 可对应多个键，按 Requirement 9 第 3 条选择「全部加载」使键数超过 12 时，Frame_Cache 先淘汰不属于当前 Cursor_Version 的键；剩余键都属于当前 Cursor_Version 或 A / B 钉时，Frame_Cache 暂时超出 12 个上限，直到 Cursor_Version 改变后再淘汰到 12 个。
3. WHEN Version_Cursor 在一个版本上停留满 300 ms, THE Frame_Prefetcher SHALL 按与 Cursor_Version 的刻度距离由近到远（距离相同时先前后后）依次请求 Cursor_Version 之前与之后各最多 2 个尚未缓存、也未在请求中的 Version_Frame；到达版本表首端或末端、某侧不足 2 个版本时只请求该侧现有的版本。
4. WHILE 一个 Cursor_Version 的 Version_Frame 请求在进行, THE Frame_Prefetcher SHALL 不发起新的预取请求，已在进行的预取请求继续执行；该 Cursor_Version 请求结束（成功或失败）后，Frame_Prefetcher SHALL 按第 3 条规则恢复预取。
5. THE Frame_Prefetcher SHALL 保证同时进行中的预取 Version_Frame 请求不超过 2 个（Cursor_Version 自身的请求不计入此数）。
6. WHEN 用户退出 Browse_Mode 或关闭 Node_Version_Panel, THE Node_Version_Panel SHALL 清空 Frame_Cache，并中止全部进行中的 Realtime_History_Query（包括预取请求）、关闭对应的 HTTP 连接；退出后 Frame_Cache 中的键数为 0。
7. WHEN Frame_Cache 中两个键的 Version_Frame 具有相同 `geometryKey`, THE Frame_Cache SHALL 只保存一份几何数据供两个键共用，每个键仍计入第 2 条的 12 个上限；该份几何数据只在最后一个引用它的键被淘汰时释放。
8. WHEN Version_Cursor 移动到新版本, THE Frame_Prefetcher SHALL 取消尚未开始、且不在新 Cursor_Version 前后各 2 个版本范围内的预取请求，并中止已在进行、且不在该范围内的预取 Realtime_History_Query（关闭对应的 HTTP 连接）；被取消或中止的预取不标为失败，之后游标回到附近时可再次预取。
9. IF 一个预取的 Realtime_History_Query 返回错误或超过 History_Query_Timeout, THEN THE Frame_Prefetcher SHALL 在 Timeline_Scrubber 上把对应 Version_Tick 标为失败，不在 Compare_Viewport 中改变已装入的内容，并在本次面板会话内不再自动预取该版本；用户把 Version_Cursor 移到该版本时按 Requirement 3 第 12 条处理。
10. WHEN Node_Version_Panel 为一个 Delivery_Unit 发起 Realtime_History_Query 且 Compare_Viewport 中已装入该 Delivery_Unit 的 Version_Frame, THE Node_Version_Panel SHALL 在请求中带上已装入 Version_Frame 的 `geometryKey` 作为 `If-None-Match`；收到 HTTP 304 时，Frame_Cache SHALL 用响应头给出的 sesno 与 Session_Time 新建该键，并按第 7 条与已装入的 Version_Frame 共用同一份几何数据。
11. IF 一个预取的 Realtime_History_Query 返回 `HISTORY_BUSY`（Requirement 7 第 1 条）, THEN THE Frame_Prefetcher SHALL 不把该版本标为失败，并在下一次 Version_Cursor 停留满 300 ms 时按第 3 条规则重新请求该版本。

### Requirement 5: 从游标钉住版本做快速对比

**User Story:** 作为校审人员，我想把当前看到的版本钉成参照，再拖到另一版直接看差异，以便快速对比任意两个时刻。

#### Acceptance Criteria

1. WHEN 用户在 Browse_Mode 中点击「钉为 A」或「钉为 B」, THE Timeline_Scrubber SHALL 把 Cursor_Version 设为对应一侧的 Pinned_Version，替换该侧原有的 Pinned_Version（若有），并在该 Version_Tick 上以蓝色（A）或绿色（B）标记显示；同一侧任一时刻最多一个钉。
2. WHEN 一次钉住或拖动钉标记后 A 钉与 B 钉同时存在且 A 钉的 sesno 大于 B 钉的 sesno, THE Timeline_Scrubber SHALL 交换 A 钉与 B 钉的 sesno，使 A 钉在 Chain_Order 中始终位于 B 钉之前（不按 Session_Time 比较），并同步交换两侧标记颜色所对应的版本。
3. IF 用户要把 A 钉与 B 钉设为同一个 sesno, THEN THE Timeline_Scrubber SHALL 拒绝该操作、保留原有两个 Pinned_Version 不变，并在时间轴旁显示提示「A 与 B 不能是同一版本」。
4. WHILE Browse_Mode 激活且恰好只有一个 Pinned_Version 存在（A 钉或 B 钉）, THE Compare_Viewport SHALL 以该 Pinned_Version 为参照、Cursor_Version 为比较侧，按现有四态（修改 / 新增 / 删除 / 未变）给 Cursor_Version 的构件着色；当 Cursor_Version 等于该 Pinned_Version 时全部构件按「未变」着色。
5. WHILE A 钉与 B 钉未同时存在, THE Node_Version_Panel SHALL 把「对比 A / B」按钮显示为禁用状态。
6. WHEN A 钉与 B 钉都存在且用户点击「对比 A / B」, THE Node_Version_Panel SHALL 进入 Compare_Mode，对 Frame_Cache 中已有的 A、B Version_Frame 直接装载而不重新查询，只为 Frame_Cache 中缺失的一侧发起 Realtime_History_Query。
7. IF 进入 Compare_Mode 或替换一侧时该侧 Realtime_History_Query 失败, THEN THE Node_Version_Panel SHALL 保持 Pinned_Version 不变、保持另一侧已装入的 Version_Frame，并在面板中显示 Version_Service 返回的错误码与消息。
8. WHEN 用户拖动 A 钉或 B 钉标记并在另一个 Version_Tick 上松开, THE Node_Version_Panel SHALL 把对应的 Pinned_Version 更新为该 Version_Tick 的 sesno，并在 Compare_Mode 下只替换被拖动那一侧的 Version_Frame，另一侧图层保持不重新装载。
9. WHEN 任一 Pinned_Version 改变且 A 钉与 B 钉都存在, THE Node_Version_Panel SHALL 用新的 A / B sesno 重新请求并刷新「属性对比」与「差异摘要」两个 tab。
10. WHEN 用户点击「与上一版比」, THE Timeline_Scrubber SHALL 把 A 钉设为当前范围版本表中按 Chain_Order 位于 Cursor_Version 之前的一版、B 钉设为 Cursor_Version。
11. WHEN 用户点击「与最新比」, THE Timeline_Scrubber SHALL 把 A 钉设为 Cursor_Version、B 钉设为当前范围内 sesno 最大的一版。
12. IF Cursor_Version 是当前范围内 sesno 最小或 sesno 最大的版本, THEN THE Timeline_Scrubber SHALL 分别把「与上一版比」或「与最新比」显示为禁用状态。
13. WHEN 用户点击「清除钉」, THE Node_Version_Panel SHALL 移除两个 Pinned_Version 及其时间轴标记、退出 Compare_Mode（若处于该模式），并回到以 Cursor_Version 显示且不带四态着色的 Browse_Mode。

### Requirement 6: 后端实时历史模型查询

**User Story:** 作为前端开发者，我需要一次同步请求就拿到某个 Delivery_Unit 在某个会话下的历史几何，以便拖动时间轴时不用建任务、轮询和管理快照。

#### Acceptance Criteria

1. WHEN Version_Service 收到一个 Realtime_History_Query，且请求含一个 dbnum、一个 Delivery_Unit refno，以及 `sesno` 与 `time` 两者中恰好一个，且请求通过第 2 至 8 条的全部校验, THE Version_Service SHALL 由 e3d-model 按 e3d-io 提供的会话链即时计算该 Delivery_Unit 在该会话下的几何，并在同一个 HTTP 200 响应中返回 History_Geometry_Response。响应包含解析后的 sesno、Session_Time（会话无时间时为 null）、`geometryKey`、`instances` 与 `tubes`。该 Delivery_Unit 在该会话下存在但没有任何几何时，`instances` 与 `tubes` 为空数组，仍返回 HTTP 200 与 `geometryKey`。
2. IF 请求同时带 `sesno` 与 `time`、两者都不带、`sesno` 不是 1 到 2^31−1 之间的整数，或 `time` 不是合法的 ISO 8601 时间, THEN THE Version_Service SHALL 返回 HTTP 400 与错误码 `INVALID_SELECTOR`，并在错误响应中指明无效的参数名（`sesno` 或 `time`；两者都带或都不带时同时指明两者）。
3. WHEN 请求以 `time` 选择会话, THE Version_Service SHALL 按 Requirement 8 第 1 条的会话链顺序规则，在该 Delivery_Unit「仅自身」范围的版本表中解析 sesno。没有任何带 Session_Time 的版本满足 Session_Time ≤ 时间点时，返回 HTTP 422 与错误码 `TIME_BEFORE_OLDEST_SESSION`（与 Requirement 8 第 3 条一致）。该版本表中没有任何带 Session_Time 的行时，返回 HTTP 422 与错误码 `NO_RESOLVABLE_SESSION`（与 Requirement 8 第 6 条一致）。这两种情况都不返回 sesno 与几何。
4. IF 请求的 sesno 不在该 Delivery_Unit 所在库的会话链上, THEN THE Version_Service SHALL 返回 HTTP 404 与错误码 `SESSION_NOT_FOUND`。
5. IF 请求的 Delivery_Unit 在解析出的会话下不存在, THEN THE Version_Service SHALL 返回 HTTP 404、错误码 `UNIT_NOT_PRESENT` 与原因字段。会话早于该单元首次出现的会话时，原因为 `not-yet`；会话晚于或等于该单元被删除的会话时，原因为 `deleted`。refno 在该库会话链的任何会话中都不存在时，THE Version_Service SHALL 返回 HTTP 404 与错误码 `REFNO_NOT_IN_CHAIN`，说明会话链中没有该 refno（前端按 Requirement 3 第 12 条以通用错误显示）。
6. IF 请求缺少 dbnum 或 refno、refno 不是由下划线或斜杠连接的两个正整数，或 refno 所属库与请求的 dbnum 不一致, THEN THE Version_Service SHALL 返回 HTTP 400 与指明无效字段的错误码。refno 格式错误或库不一致时为 `INVALID_REFNO`，缺字段时为 `INVALID_FIELD`。错误响应中写明字段名（`dbnum` 或 `refno`）。
7. IF 请求的 refno 在解析出的会话下存在，但其类型不在项目 `delivery_unit_types` 中, THEN THE Version_Service SHALL 返回 HTTP 422 与错误码 `NOT_A_DELIVERY_UNIT_ROOT`（沿用现有状态码）。
8. IF 计算访问的构件数超过 100 000（现有 `MAX_HISTORY_ELEMENTS`）, THEN THE Version_Service SHALL 停止计算，返回 HTTP 413 与错误码 `GENERATION_LIMIT_EXCEEDED`，且不返回任何部分几何。
9. IF 一次计算超过服务端历史查询超时仍未完成, THEN THE Version_Service SHALL 停止该计算，返回 HTTP 504 与错误码 `HISTORY_QUERY_TIMEOUT`，且不返回任何部分几何。该超时可配置，范围 1 s 至 600 s，缺省 60 s；配置值超出范围时，服务端启动时使用缺省值并在启动日志中提示。
10. THE Version_Service SHALL 对相同的（dbnum, Delivery_Unit refno, 解析后 sesno）与相同的源文件返回相同的 `geometryKey`。对同一请求连续调用两次（包括 Realtime_Result_Cache 命中与未命中各一次），返回的 `instances` 与 `tubes` 按 refno 排序后逐项相等（确定性）。
11. THE Version_Service SHALL 让两个 History_Geometry_Response 的 `geometryKey` 相等，当且仅当两者的 `instances` 与 `tubes` 按 refno 排序后的几何内容逐项相等（`geometryKey` 是几何内容摘要）。
12. THE Version_Service SHALL 在处理 Realtime_History_Query 时不创建任务、不产生 `snapshot_key`、不改变 `/health.model_cache.historical` 报告的快照数，也不改变当前模型的投影与持久化数据。`instances` 引用的网格文件按 `mesh_id` 写入现有共享网格目录，不算作快照。成功与失败的请求都适用本条。
13. WHEN Version_Service 收到构件属性时点查询（一个构件 refno 与一个 sesno）, THE Version_Service SHALL 由会话链直接返回该构件在该 sesno 下的属性，不依赖任何历史快照。构件在该会话下不存在时，返回错误码 `REFNO_NOT_FOUND_AT_SESSION`；sesno 不在会话链上时，返回 HTTP 404 与 `SESSION_NOT_FOUND`；refno 格式错误时，返回 HTTP 400 与 `INVALID_REFNO`。
14. WHEN 客户端在 Realtime_History_Query 返回前断开连接, THE Version_Service SHALL 在 2 s 内停止该计算并释放其占用的并发名额（Requirement 7 第 1 条），且不把未完成的结果写入 Realtime_Result_Cache。
15. FOR ALL（Delivery_Unit, sesno）组合, Realtime_History_Query 返回的 `instances` 与 `tubes` SHALL 与 Legacy_History_Path 对同一组合 generate 后 query 得到的 `instances` 与 `tubes` 逐项相等（等价性质）。比较时两者都按 refno 排序，并去掉与 `snapshot_key` 相关的字段。Legacy_History_Path 对某组合返回错误时，Realtime_History_Query 对该组合也 SHALL 返回错误（错误码按本 Requirement 的映射，Legacy 的 `REFNO_NOT_FOUND_AT_SESSION` 对应 `UNIT_NOT_PRESENT`）。
16. IF 一个请求同时触发多条校验错误, THEN THE Version_Service SHALL 只返回优先级最高的一条错误。优先级从高到低为：缺字段或 refno 无效（第 6 条）、选择器无效（第 2 条）、会话不存在或时间点无法解析（第 3、4 条）、单元不存在（第 5 条）、不是 Delivery_Unit（第 7 条）。
17. IF Realtime_History_Query 以任一错误结束（第 2 至 9、14、16 条）, THEN THE Version_Service SHALL 不在响应中返回 `instances`、`tubes` 或 `geometryKey`，不把该请求写入 Realtime_Result_Cache，并在响应返回时释放该请求占用的并发名额。

### Requirement 7: 后端实时查询的并发与缓存

**User Story:** 作为运维 / 开发者，我需要实时历史查询的计算量可控、重复查询更快，并能从健康检查看到运行状况，以便多人拖动时间轴时服务端不过载。

#### Acceptance Criteria

1. IF 收到 Realtime_History_Query、Realtime_Result_Cache 中没有该请求的条目，且进行中的计算数已达到 Realtime_Concurrency_Limit（缺省 4，可配置范围 1 至 64）, THEN THE Version_Service SHALL 在 100 ms 内返回 HTTP 503、错误码 `HISTORY_BUSY` 与 `Retry-After` 响应头（取值为 1 至 5 之间的整数秒），不开始计算，不改变进行中的计算数，也不计入 Realtime_Result_Cache 的命中数或未命中数。
2. WHERE Realtime_Result_Cache 启用（容量可配置，范围 0 至 1024 条，缺省 32 条，容量为 0 表示停用）, THE Version_Service SHALL 以（dbnum, Delivery_Unit refno, 解析后 sesno, 源文件指纹）为键，只缓存 HTTP 200 的 History_Geometry_Response，不缓存错误响应、超时响应或因客户端断开而未完成的结果；条目数达到容量时，先淘汰最久未使用的一条再写入新条目，任一时刻的条目数不超过配置的容量。
3. THE Version_Service SHALL 让同一请求在 Realtime_Result_Cache 命中与未命中时返回相同的状态码、相同的响应体与相同的 `ETag` 响应头。
4. WHEN 源文件指纹改变（Delivery_Unit 所在库的源文件内容发生变化）, THE Version_Service SHALL 从指纹改变后收到的第一个 Realtime_History_Query 起，不再用旧指纹下的 Realtime_Result_Cache 条目响应任何请求，改为按新源文件重新计算，并且不再把旧指纹的条目计入第 5 条报告的条目数。
5. THE Version_Service SHALL 在 `/health.model_cache` 中以非负整数报告以下各项：Realtime_Result_Cache 的当前条目数与容量；命中数与未命中数，两者从服务进程启动时的 0 开始只增不减；进行中的 Realtime_History_Query 计算数，该数在任一时刻不超过 Realtime_Concurrency_Limit；以及 Realtime_Concurrency_Limit 本身。
6. THE Version_Service SHALL 在每个 HTTP 200 的 History_Geometry_Response 中带 `ETag` 响应头，值为该响应的 `geometryKey`。
7. WHEN Realtime_History_Query 带有 `If-None-Match`、请求参数通过 Requirement 6 第 2 至 7 条的全部校验，且 `If-None-Match` 中某个值等于解析后会话的 `geometryKey`, THE Version_Service SHALL 返回 HTTP 304、空响应体、值为该 `geometryKey` 的 `ETag` 响应头，并在响应头中给出解析后的 sesno 与 Session_Time（会话无时间时标明为空）。
8. IF Realtime_History_Query 的 `If-None-Match` 中没有任何值等于解析后会话的 `geometryKey`, THEN THE Version_Service SHALL 按第 6 条返回带完整 History_Geometry_Response 的 HTTP 200。
9. IF 带有 `If-None-Match` 的 Realtime_History_Query 未通过 Requirement 6 第 2 至 9 条中任一条的校验或计算, THEN THE Version_Service SHALL 返回该条规定的错误状态码与错误码，不返回 HTTP 304。

### Requirement 8: 后端时间点解析

**User Story:** 作为校审人员，我想按日期时间定位到当时生效的版本，以便回答「某天的模型是什么样」。

#### Acceptance Criteria

1. WHEN Version_Service 收到一个时间点解析请求，请求包含一个节点 refno、一个 Compare_Scope（「仅自身」或「所有子节点」）和一个 ISO 8601 时间点 t, THE Version_Service SHALL 沿用现有 `select_session_at` 的会话链顺序规则：在该 Compare_Scope 的版本表中按 Chain_Order 从 sesno 最大的版本向前逐行检查，跳过没有 Session_Time 的行，返回第一个 Session_Time ≤ t 的版本的 sesno 与 Session_Time。比较精确到秒；t 不带时区偏移时，按该版本表中 Chain_Order 第一条带 Session_Time 的行所用的时区偏移解释（Realtime_History_Query 的 `time` 选择器与 Requirement 10 第 2 条的前端降级解析同此规则）。由于 Session_Time 沿 Chain_Order 不单调，返回的版本是满足 Session_Time ≤ t 的版本中 sesno 最大的一个，不一定是 Session_Time 最接近 t 的版本。
2. WHEN 多个版本的 Session_Time 相同且都满足第 1 条条件, THE Version_Service SHALL 返回其中 sesno 最大的版本（第 1 条规则的直接结果）。
3. IF 该 Compare_Scope 版本表中没有任何带 Session_Time 的版本满足 Session_Time ≤ t（即 t 早于所有带时间版本中最小的 Session_Time）, THEN THE Version_Service SHALL 返回 HTTP 422 与错误码 `TIME_BEFORE_OLDEST_SESSION`，且不返回任何 sesno。
4. IF 时间点字符串不是合法的 ISO 8601 时间，或 Compare_Scope 不是「仅自身」或「所有子节点」, THEN THE Version_Service SHALL 返回 HTTP 400 与错误码 `INVALID_SELECTOR`，且不返回任何 sesno。
5. IF 请求的节点 refno 不存在, THEN THE Version_Service SHALL 返回 HTTP 404 与错误码 `NODE_NOT_FOUND`，且不返回任何 sesno。
6. IF 节点存在但该 Compare_Scope 版本表中没有任何带 Session_Time 的行, THEN THE Version_Service SHALL 返回 HTTP 422 与错误码 `NO_RESOLVABLE_SESSION`，且不返回任何 sesno。
7. FOR ALL 版本表中带 Session_Time 的版本 v，用 v 的 Session_Time 做时间点解析 SHALL 返回版本 w，w 是 Chain_Order 中满足 Session_Time ≤ v 的 Session_Time 的 sesno 最大的版本，且 w 的 sesno ≥ v 的 sesno；当 v 之后（sesno 更大）的所有带时间版本的 Session_Time 都晚于 v 的 Session_Time 时，w 等于 v（往返性质）。
8. WHEN 用户在 Timeline_Scrubber 的日期输入框中输入时间点并按回车确认, THE Timeline_Scrubber SHALL 把 Version_Cursor 移到解析得到的 sesno 对应的 Version_Tick，并按 Requirement 2 第 7 条在游标旁显示该版本的 sesno 与 Session_Time。
9. IF 日期输入框中的时间点无法解析，或 Version_Service 返回 `TIME_BEFORE_OLDEST_SESSION`、`INVALID_SELECTOR`、`NODE_NOT_FOUND` 或 `NO_RESOLVABLE_SESSION`, THEN THE Timeline_Scrubber SHALL 保持 Version_Cursor 原位置不变，保留输入框中的文本，并在输入框旁显示一条错误信息，说明失败原因（格式无效、早于最早版本、节点不存在或没有可解析的版本）。
10. FOR ALL Delivery_Unit refno 与时间点, Realtime_History_Query 以 `time` 解析出的 sesno（Requirement 6 第 3 条）SHALL 等于时间点解析请求对同一 refno、Compare_Scope「仅自身」与同一时间点返回的 sesno（一致性质）。

### Requirement 9: 容器节点（所有子节点范围）的拖拽浏览

**User Story:** 作为校审人员，我想在 PIPE / ZONE 这类容器上拖动时间轴看子树模型的变化，以便检查一片区域在一段时间内的演变。

#### Acceptance Criteria

1. WHILE Compare_Scope 为「所有子节点」, THE Timeline_Scrubber SHALL 使用 `node/versions?scope=subtree` 的版本表，并在每个 Version_Tick 的悬停提示中显示该会话相对版本表中前一版本的 Changed_Unit 数（只改了属性的会话显示 0）。
2. WHILE Compare_Scope 为「所有子节点」且 Browse_Mode 激活, WHEN Cursor_Version 改变, THE Compare_Viewport SHALL 按 Version_Service 差异摘要（`node/diff-summary`，Cursor_Version 对比范围内最新版本）列出的、几何有变化的 Delivery_Unit 逐个装入该单元在 Cursor_Version 下的 Version_Frame，其余 Delivery_Unit 显示当前几何；Cursor_Version 就是最新版本时不装入任何 Version_Frame，并在角标中显示「最新版本，无历史差异」。
3. IF 一次游标移动需要查询的 Version_Frame 数（Frame_Cache 中尚没有的单元数）超过 Version_Service 差异摘要给出的成本阈值或超过 20 个, THEN THE Node_Version_Panel SHALL 在发起任何 Realtime_History_Query 前弹出对话框，提供「全部加载」「先装变化最大的 20 个」「取消」三个选项；「变化最大」按差异摘要中该单元的变化构件数从多到少排序，变化构件数相同时按 refno 升序。Frame_Cache 的 12 个上限按（dbnum, Delivery_Unit refno, sesno）键计，选择「全部加载」可能超出该上限，此时按 Requirement 4 第 2 条先淘汰不属于当前 Cursor_Version 的键。
4. WHILE Compare_Scope 为「所有子节点」, THE Frame_Prefetcher SHALL 只预取 Requirement 4 第 3 条所列的相邻版本中，需要装入的 Changed_Unit 不超过 5 个的版本；超过 5 个的版本不预取，等游标停在该版本上再按本 Requirement 第 2、3 条处理。
5. WHILE 当前节点是叶子构件且 Compare_Scope 为「仅自身」, THE Compare_Viewport SHALL 装入该构件所属 Delivery_Unit 在 Cursor_Version 下的 Version_Frame，只高亮该构件，同一 Delivery_Unit 内的其他构件不加高亮。
6. IF 用户在第 3 条的对话框中选择「取消」, THEN THE Node_Version_Panel SHALL 不发起任何 Realtime_History_Query，Compare_Viewport 保持显示上一次装入的 Version_Frame，并在角标中显示「sesno <Cursor_Version> 未加载（已取消）」。
7. IF Version_Service 对差异摘要请求返回错误, THEN THE Node_Version_Panel SHALL 不发起任何 Realtime_History_Query，在面板中显示 Version_Service 返回的错误码与消息，并让 Compare_Viewport 保持显示上一次装入的 Version_Frame。
8. IF 一次游标移动中部分 Changed_Unit 的 Realtime_History_Query 失败, THEN THE Compare_Viewport SHALL 照常显示查询成功的 Version_Frame，查询失败的 Delivery_Unit 仍显示当前几何，并在角标中显示失败单元数；Node_Version_Panel SHALL 列出每个失败单元的 refno 以及 Version_Service 返回的错误码与消息。
9. WHILE 一次游标移动需要为 N 个 Changed_Unit 各发起一个 Realtime_History_Query, THE Node_Version_Panel SHALL 保持同时进行中的这类请求不超过 Version_Service 在 `/health.model_cache` 中报告的 Realtime_Concurrency_Limit（未取得时按 4），其余请求排队，在前一请求结束后依次发出。
10. IF 第 9 条中的某个请求返回 `HISTORY_BUSY`, THEN THE Node_Version_Panel SHALL 按响应的 `Retry-After` 等待后重发该请求，最多重发 3 次；仍为 `HISTORY_BUSY` 时按第 8 条把该单元记为失败。

### Requirement 10: 旧服务端降级

**User Story:** 作为运维 / 开发者，我希望前端接上没有新路由的旧 gen-model 构建时仍能拖拽浏览，以便前后端可以分开发布。

#### Acceptance Criteria

1. IF Version_Service 对 Realtime_History_Query 路由返回 HTTP 404 或 405, THEN THE Node_Version_Panel SHALL 在本次 Node_Version_Panel 打开期间不再请求该路由，改为对每个需要的 sesno 走 Legacy_History_Path 获取 Version_Frame，并在面板底部持续显示「服务端没有实时历史查询，改用逐版生成」，直到 Node_Version_Panel 关闭或 `gm_backend` 改变。
2. IF Version_Service 对时间点解析路由返回 HTTP 404 或 405, THEN THE Timeline_Scrubber SHALL 用当前 Compare_Scope 下已取回的版本表在前端解析时间点，解析规则与 Requirement 8 第 1 至 3 条一致（按 Chain_Order 从 sesno 最大的版本向前逐行检查，跳过没有 Session_Time 的行，取第一个 Session_Time ≤ 时间点的版本），并用得到的 sesno 移动 Version_Cursor；没有版本满足条件、版本表中没有带 Session_Time 的行，或时间点不是合法的 ISO 8601 时间时，Version_Cursor 保持原位，并在日期输入框旁显示对应原因的错误提示（「早于最早版本」「没有可解析的版本」或「时间格式无效」）。
3. IF Version_Service 对 `model/versions` 路由返回 HTTP 404 或 405, THEN THE Node_Version_Panel SHALL 沿用现有错误提示「服务端还没有 model/versions」，隐藏 Timeline_Scrubber，并不提供进入 Browse_Mode 的入口。
4. WHILE Legacy_History_Path 降级生效, THE Node_Version_Panel SHALL 保持同时进行的预取 `model/history/generate` 任务不超过 2 个（Cursor_Version 自身的任务不计入，与 Requirement 4 第 5 条一致），以 300 s（`model/history/generate` 任务超时）代替 History_Query_Timeout，并照常执行 Requirement 3 第 3、7 条（停留 150 ms 后发起请求、只装入最后一个 Cursor_Version）与 Requirement 4 第 3 至 5 条（前后各 2 版预取、游标请求进行中暂停预取）的规则。
5. WHILE Legacy_History_Path 降级生效, WHEN Frame_Cache 淘汰一个键，或用户退出 Browse_Mode、关闭 Node_Version_Panel, THE Node_Version_Panel SHALL 向 Version_Service 请求删除本次面板会话通过 Legacy_History_Path 创建、且对应键已移出 Frame_Cache 的 `snapshot_key`；删除请求失败或超过 10 s 未返回时只记录日志，不阻塞后续 Version_Frame 的装载与预取。
6. IF Version_Service 对 Realtime_History_Query 或时间点解析路由返回 HTTP 404 和 405 以外的错误，或请求因网络错误失败, THEN THE Node_Version_Panel SHALL 不进入对应的降级路径，在面板中显示 Version_Service 返回的错误码与消息（网络错误时显示「无法连接服务端」），保持显示上一个已装入的 Version_Frame，并在下一次需要该路由时重新请求新路由。

### Requirement 11: 直达链接

**User Story:** 作为校审人员，我想把「这个节点、拖到这一版、钉了这两版」分享给同事，以便对方打开就看到同样的画面。

#### Acceptance Criteria

1. WHEN 用户点击「复制链接」, THE Node_Version_Panel SHALL 生成一个 URL 并写入系统剪贴板。该 URL 包含 `unit_refno`、`scope`（当前 Compare_Scope）和 `cursor`（Cursor_Version）。存在 A 钉时附带 `compare_a`，存在 B 钉时附带 `compare_b`，不存在的钉不出现对应参数。`gm_backend` 等其他现有参数保留原值。写入成功后，面板显示「链接已复制」提示。
2. WHEN 页面以带 `cursor` 参数的 URL 打开, THE Node_Version_Panel SHALL 依次完成以下动作：打开 `unit_refno` 对应的节点；切到 `scope` 指定的 Compare_Scope，URL 未带 `scope` 时使用面板对该节点的缺省 Compare_Scope；把 Version_Cursor 放在 `cursor` 指定的版本上；按 `compare_a` / `compare_b` 恢复 A 钉与 B 钉；进入 Browse_Mode。若恢复出的 A 钉 sesno 大于 B 钉 sesno，按 Requirement 5 第 2 条交换 A 与 B。
3. IF URL 中的 `cursor` 是整数但不在版本表中, THEN THE Node_Version_Panel SHALL 把 Version_Cursor 放在 sesno 不大于该值的最后一个版本上，并显示「链接中的版本 <cursor> 不在本范围，已定位到 <sesno>」。若版本表中没有 sesno 不大于该值的版本，THE Node_Version_Panel SHALL 把 Version_Cursor 放在本范围 sesno 最小的版本上，并显示同一格式的提示。
4. FOR ALL 合法的面板状态（节点、范围、游标、A / B 钉，每个钉可有可无）, 由状态生成 URL 再解析该 URL SHALL 得到相同的面板状态（往返性质）。
5. IF 写入剪贴板失败（浏览器拒绝剪贴板权限或剪贴板接口不可用）, THEN THE Node_Version_Panel SHALL 在面板中以可全选的文本框显示完整 URL，并给出「复制失败，请手动复制」的提示。
6. IF URL 中的 `unit_refno` 找不到对应节点、`scope` 不是「仅自身」或「所有子节点」，或者 `cursor` 不是整数, THEN THE Node_Version_Panel SHALL 不进入 Browse_Mode。面板显示一条错误消息，指明是哪个参数无效。若节点能打开，Version_Cursor 放在当前范围最新的版本上。
7. IF URL 中的 `compare_a` 或 `compare_b` 不是整数，或不在本范围版本表中, THEN THE Timeline_Scrubber SHALL 不恢复该钉，并显示「链接中的钉 <compare_a/compare_b 值> 不在本范围，已忽略」。另一个有效的钉和 Version_Cursor 照常恢复。
8. IF URL 中的 `compare_a` 与 `compare_b` 是同一个 sesno, THEN THE Timeline_Scrubber SHALL 只恢复 A 钉，并按 Requirement 5 第 3 条显示提示「A 与 B 不能是同一版本」。

### Requirement 12: 性能与验证口径

**User Story:** 作为项目负责人，我需要明确、可复测的速度指标，以便判断「快速对比」是否达成。

#### Acceptance Criteria

1. WHEN 对 AvevaMarineSample dbnum 8000 中的 BRAN `24384_23257`，在 Frame_Cache 已含 Cursor_Version 前后各 2 版 Version_Frame 的情况下，用户在 Timeline_Scrubber 获得焦点时按方向键逐版移动 Version_Cursor 共 20 次, THE Compare_Viewport SHALL 在每一次移动中，从按键使 Cursor_Version 改变起，到隔离图层完成新 Version_Frame 的首帧渲染、角标显示新 sesno 为止，用时不超过 300 ms，20 次中任何一次超出即判为不通过。
2. WHEN 对同一 BRAN，在 Realtime_Result_Cache 已含目标 sesno 的条目但 Frame_Cache 为空的情况下，用户用方向键逐版移动 Version_Cursor 共 10 次, THE Compare_Viewport SHALL 在每一次移动中，从 Cursor_Version 改变起（方向键触发时不等待 150 ms，见 Requirement 3 第 4 条），到隔离图层完成新 Version_Frame 的首帧渲染为止，用时不超过 500 ms，10 次中任何一次超出即判为不通过。
3. WHEN 对同一 BRAN，在 Realtime_Result_Cache 停用（容量 0）且 Frame_Cache 为空的情况下，用户用方向键逐版移动 Version_Cursor 共 10 次, THE Compare_Viewport SHALL 在每一次移动中，从 Cursor_Version 改变起到隔离图层完成新 Version_Frame 的首帧渲染为止，用时不超过 2 s，10 次中任何一次超出即判为不通过。
4. WHEN 对同一 BRAN，在 Realtime_Result_Cache 已含目标版本条目的情况下，Version_Cursor 从一个已装入的版本移到一个 Frame_Cache 中没有、但 `geometryKey` 与已装入版本相同的版本（例如「仅属性」会话）, THE Node_Version_Panel SHALL 收到 HTTP 304（Requirement 7 第 7 条），并在 Cursor_Version 改变后 200 ms 内让角标显示新 sesno；测 10 次，任何一次超出即判为不通过。
5. WHILE 用户在 3 s 到 5 s 之内按住指针连续拖动 Version_Cursor 跨越 30 个 Version_Tick, THE Timeline_Scrubber SHALL 在拖动期间每一个连续 1 s 的时间窗内保持浏览器渲染帧率不低于 30 fps，且 Version_Cursor 每次吸附到 Version_Tick 后 100 ms 内在游标旁显示新的 sesno 与 Session_Time。
6. WHILE Browse_Mode 激活连续 10 分钟，且用户在至少 20 个 Version_Tick 的范围内持续来回拖动 Version_Cursor, THE Node_Version_Panel SHALL 在每隔 60 s 采样一次的每个采样点上保持 Frame_Cache 中的 Version_Frame 数不超过 12；同一采样点上 `/health.model_cache` 报告的进行中 Realtime_History_Query 计算数 SHALL 不超过 Realtime_Concurrency_Limit，Realtime_Result_Cache 条目数 SHALL 不超过其容量，`/health.model_cache.historical` 报告的快照数 SHALL 等于测试开始时的值。
7. WHEN 第 6 条的 10 分钟测试结束后用户退出 Browse_Mode, THE Node_Version_Panel SHALL 在 1 s 内使 Frame_Cache 中的 Version_Frame 数与前端进行中的 Realtime_History_Query 数都为 0，且 `/health.model_cache` 报告的进行中计算数 SHALL 在退出后 5 s 内回到测试开始时的值。

> 验证口径：以上指标在 rocksdb 档的 gen-model 后端（`AIOS_STORE_MODE=rocksdb`，8022）上实测，不用 mem 档；后端为本地构建的 `refactor` 分支。第 2 条与第 4 条先对目标 sesno 各发一次 Realtime_History_Query 让 Realtime_Result_Cache 命中（服务端只有算出或缓存了该会话的 `geometryKey` 才能比对 `If-None-Match`，缓存未命中时 304 仍要先算完几何，只省传输不省计算，第 4 条的 200 ms 不覆盖未命中情形）；第 3 条以 Realtime_Result_Cache 容量 0 启动服务端。第 2、3 条的 2 s / 500 ms 为本版拟定目标，首次实测后若需调整须在验证记录中注明理由。被测 BRAN `24384_23257` 在版本表中至少要有 25 个版本，其中至少 5 个版本的 `impact_kind` 表示几何有变化；达不到时先记录实际版本数，再换一个满足条件的 BRAN 并注明。每条指标都记录执行的命令、输入节点、所用 sesno 序列、每一次的耗时（或每个采样点的帧率与计数）以及通过 / 不通过结论。
