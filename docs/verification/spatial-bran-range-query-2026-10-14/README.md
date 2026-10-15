# 空间范围查询 · BRAN 实测复核（2026-10-14）

审核「空间范围查询是否按 房间 → 专业 → 最小交付单元类型 → 单元 → 构件 展示」的实测记录；
上位金样 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/`。

## 环境

| 项 | 值 |
| --- | --- |
| 前端 | `npm run dev` → `http://localhost:3101`，页面 `?output_project=AvevaMarineSample` |
| 后端 | gen-model `http://localhost:8022`，`/health` `build_id = 0.1.38+gdbc0b7f5…`，`durable=true`，`delivery_unit_types=[BRAN,HANG,SUPPO,EQUI]` |
| 数据 | AMS `dbnum=7997`，`/ALL`；本次先 `POST /api/v1/model/generate` 生成测试 BRAN（22 实例），再 `dbnums/7997/model/ensure` 整库（6772 根） |

## 测试输入

- 查询中心：BRAN `24381_145018`（`/Copy-of-RCS0014-1R43012新`，生成后 `e3d.room.lookup` 判它归属 R749 / R640 / R540 / R511 四房）
- 半径：15 m；房间过滤：R749（`24381_36506`）
- 抽屉「范围查询」Tab 手输 refno → 执行 → 「查看结果」

## 看到

| # | 内容 | 证据 |
| --- | --- | --- |
| 1 | 摘要「共 179 项（去重）· 9 段直管 · 1 间房，已加载 0 项，未加载 179 项」+ 专业小计「163 仪表 · 16 土建」+ 中心 `5964, 9972, 16552 · refno_aabb_center` | `spatial-bran-tree.png` |
| 2 | 树第一层 = 房间 `R749 · 179` | `spatial-bran-tree2.png` |
| 3 | 第二层 = 专业：`仪表系统 · 163` / `土建系统 · 16` | 同上 |
| 4 | 第三层 = 单元类型：`BRAN · 4 个单元 · 16` / `EQUI · 18 个单元 · 147` | 同上 |
| 5 | 第四层 = 单元行：4 条 BRAN（`/Copy-of-RCS0011-1R43008新-缺温度计管座` 5 段直管 / 5 构件、`-1R43009新` 1 段 / 3、`-1R43010新` 2 段 / 4、`-1R43013新` 1 段 / 4）+ 18 条 EQUI | 同上 |
| 6 | 第五层 = 构件行 + 直段行：展开 BRAN `24381_144924` 得 5 条构件（`24381_144935 ELBO` 等，各带距离与眼睛/飞行）+ 5 条直段（`直管 ELBO → ELBO 3.69 m`、`OLET → VALV 400 mm` 等） | `spatial-bran-tree3.png` |
| 7 | 不属单元的构件走兜底：`土建系统 → 其他构件 · 16 → PANE → 16 条构件行`（按 noun 分组） | `spatial-bran-others.png` |

层级、计数、直段、兜底分组均与契约一致，`pageerror` 0。

## 模型初始化 + 周边显示（同日追加）

| 步 | 动作 | 结果 | 图 |
| --- | --- | --- | --- |
| 1 | URL 加 `show_refno=24381_145018` 重载 | 启动即装载 BRAN 本体 + 可见子实例、置选中、相机对焦；场景 240 个对象，属性面板 `/Copy-of-RCS0014-1R43012新 · TYPE BRAN · DUTY 反应堆冷却剂` | `init-bran-loaded.png` |
| 2 | 抽屉重跑同参查询（refno + 15 m + R749） | 「共 179 项（去重）· 9 段直管 · 1 间房，已加载 0 项，未加载 179 项」 | — |
| 3 | 点「加载未加载（整棵树）」（179 < 200 阈值，无确认弹窗） | 「已加载 179 项，未加载 0 项」；三维里 R749 米色墙板围出房间，黄色 EQUI 设备、紫色 BRAN 管线围绕中心 BRAN；`scene.getLoadedRefnos()` = **192**（179 周边 + 中心 BRAN 及其构件 / 直管），含 `24381_145018` | `init-surroundings-loaded.png` / `init-scene-final.png` |

加载入口：`ViewerPanel.vue` 的 `show_refno` URL 参数（`visibleInsts` + `loadDbnoInstancesForVisibleRefnosDtx`）；批量入口抽屉 `spatial-load-unloaded`（树态补整棵树）。

## 已知数据问题（非前端缺陷）—— 2026-10-15 复核修正

**修正此前诊断**：中心 BRAN 不出现在 `rooms=` 过滤树里**不是边缺失**，而是「查询中心子树默认剔除」的设计行为：

- 服务端 `spatial_tree_view.rs`：`exclude_subtree = !include_self && center.target_box.is_some()`，中心 BRAN 及其子树/直段默认不进自己的周边结果。
- 前端 `useSpatialQuery.ts::shouldIncludeSelf`：refno 为中心源时恒发 `include_self=false`，UI 没有开关。
- 实证：`nearby/tree?…&rooms=24381_36506&include_self=1` → `R749 → 仪表系统 → BRAN` 下出现 **5** 个单元（含 `24381_145018` 本体），total 179 → 182。
- `rooms/{refno}/tree`（以房间为范围的另一条路由）不排除中心，所以它一直能显示该 BRAN——两条路由语义不同，不是两套判据打架。

## 库初始化（2026-10-15 凌晨，`http://localhost:8022/setup.html` 第⑤步）

背景：8022 旧进程死前正给 7997 刷房间边（write-behind 半途中断）；之后被以 `AIOS_ROOM_MEMBERSHIP=0` 重启（房间体制关，无法准备房间数据）。处置：停掉该进程，以同目录 `aios-database.exe serve --watch-dbnum 7997,7998,8000` 重启（`DbOption.toml` 的 `watch_dbnums=[7998,8000]` 会把 7997 挡在摄入扫描外，命令行参数覆盖，不改用户文件）。

| 项 | 结果 |
| --- | --- |
| 4 个待初始化 DICT 库（7507 / 250206 / 250215 / 250216） | 全部 `succeeded`（无模型半边，秒级） |
| 7997 初始化任务 `db-20261015-003846-000000` | `succeeded`，窗口 `1..=357`：解析 170085 元素、整库模型 6772 根直写、水位一笔收口；步骤 data_parse→…→task_end 全 ok |
| 7997 水位 | `applied=357 / model=357 / file=357`，`model_verdict=in_sync`，`initialized=true` |
| 房间对齐 | `room_alignment.current=true`（`model_room_generation` = 常驻代 `72979202d292…`）；`e3d.room.lookup` 对 BRAN 回 `ready_nonempty`（R749/R640/R540/R511，`publication_status=current`） |
| 常驻房间模型 | ready，215 间房 / 230 块面板 |
| 空间树 | ready，68404 条，7997 水位 357/357 |

复验（`rooms=24381_36506` 过滤，`include_self=1`）：中心 BRAN 出现在 `R749 → 仪表系统 → BRAN → 24381_145018`（3 构件 + 3 直段），`room_status.source=durable`、`matched=187`、`unresolved=0`——**落盘边路径与内存判据现在一致**。

## 仍存在的提示（非 7997 问题）

`library_alignment_current=false` 横幅仍在：15 m 半径内的候选含 **dbnum 7999**（403 个元素，未初始化、不在 watch 名单 → 无房间边）与 8000（9 个，已对齐）。要消掉这条提示需把 7999 纳入监听并初始化（重启参数 `--watch-dbnum 7997,7998,7999,8000`），或接受「部分候选库未对齐」的如实提示。

## 最终闭环：范围显示全绿（2026-10-15 03:3x）

**问题根因链已修复完毕**：

1. `vh-serve` 外部启动包装器以 `AIOS_ROOM_MEMBERSHIP=0` 拉起后端 → 房间体制被压掉；
2. 房间关闭期间 BRAN 重新生成会「旧边照旧清」→ 房间边被抹（`ready_empty`）；
3. 候选含未初始化库 7999（403 元素无房间边）→ `library_alignment_current=false` 横幅。

**修复动作**：

- `Start-AMS.ps1`（deploy 包 + gen-model `verification/package-source` 模板）启动前清掉 `AIOS_ROOM_MEMBERSHIP` / `AIOS_SKIP_STARTUP_ROOM_BUILD` 两个临时覆盖，让 `DbOption.toml`（`room_membership = true`，与代码默认一致）说了算；
- 后端以 `--watch-dbnum 7997,7998,7999,8000` 重启，`update/execute` 初始化 7999：窗口 1..=205、34709 元素、4435 根直写、succeeded；
- 重新生成中心 BRAN（22 实例 durable），`e3d.room.lookup` 回 `ready_nonempty`（R749/R640/R540/R511）。

**端到端复验（浏览器真机）**：BRAN `24381_145018` + 15 m + 房间 R749：

- `library_alignment_current: true`、`room_status.source: durable`、`matched: 193`、`unresolved: 0`、警告横幅消失；
- 树层级 `R749 · 184 → 管道系统·5 / 仪表系统·163 / 土建系统·16 → BRAN/EQUI 单元行 → 构件行`，「其他构件 · 16」兜底照常；
- 「加载未加载（整棵树）」→ 184/184 全部入场景（424 对象），三维视图 R749 墙板 + BRAN 管线 + EQUI 设备正常显示；
- 控制台仅剩与功能无关的既有噪音（review-user 401、浏览器 ERR_CACHE_READ_FAILURE）。

| dbnum | applied/model/file | verdict | room_alignment |
| --- | --- | --- | --- |
| 7997 | 357/357/357 | in_sync | current |
| 7998 | 540/540/540 | in_sync | current |
| 7999 | 205/205/205 | in_sync | current |
| 8000 | 646/646/646 | in_sync | current |

## 「模型生成」面板实现与实测（2026-10-15）

新功能：客户端内嵌的模型生成/库初始化面板（设计稿 `docs/design/model-generation-panel.mock.html`）。

| 件 | 位置 |
| --- | --- |
| API | `src/api/genModelV1AdminApi.ts`：`genModelV1UpdateExecute`（`POST /api/v1/update/execute {dbnums}`）、`genModelV1ElementIdentity`；`DbnumRow` 扩展水位/状态字段 |
| 状态 | `src/composables/useModelGenerationAdmin.ts`（单例）：库列表/勾选/`update/execute`/只轮询本会话 `task_id`/节点目标 `generateThenCollect` |
| UI | `src/components/model-generation/ModelGenerationDrawer.vue`：「按节点/SITE」「按库」两 Tab + 五阶段任务卡 |
| 接线 | ribbon「视图 → 模型生成」→ `panel.modelGeneration` → `openModelGeneration` 事件 → `ViewerPanel` 挂载抽屉 |

实测（dev `localhost:3101` → gen-model `:8022`）：

- 「按节点」：使用当前选中 → chip `BRAN /Copy-of-RCS0014-1R43012新 24381_145018`（noun/name 走 `element/attributes`；`e3d.element.identity` 依赖本机 E3D TTY，不可用）→「重新生成选中目标」→ `22 实例 / 已生成`，与后端 `model/generate` 一致。
- 「按库」：46 库全量行（传 `project` 身份避免 bootstrap 骨架形）——20 行已同步（7997 `357/357/357`、7998 `540/540/540`、8000 `646/646/646`）+ 26 行「不参与」（不在 MDB）；勾 7507 执行 → 回执 `up_to_date=17` 正确渲染为「上次执行：最新 17」。
- `npm run type-check` 新增 0；eslint 触改动文件全过；`DockLayout.test.ts` + `ribbonConfig.test.ts` 28 过。

发现的坑：`ref([])` 数组里的目标对象必须 `reactive()` 包裹——异步回填 `noun` 时改原始对象绕过响应式代理，chip 不刷新。

注意：本次验证时 8022 已被外部以 `AIOS_ROOM_MEMBERSHIP=0` 重启（build `gabc4ae6804…`），房间体制又关着；面板本身不依赖它，但跑房间对齐验证前要再开回来。
