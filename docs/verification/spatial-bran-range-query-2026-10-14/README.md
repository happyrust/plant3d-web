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

## 已知数据问题（非前端缺陷）

- 横幅「房间归属不是当前代：所在库的房间边还没对齐到当前房间模型，结果可能过期」如实展示——本机落盘 `room_relate` 边未对齐当前代（`library_alignment_current=false`）。
- 因此查询中心的 BRAN `24381_145018` 自身**没有出现在** `rooms=R749` 过滤的树里：内存判据（`e3d.room.lookup`、`rooms/24381_36506/tree`，后者正常显示 `R749 → 仪表系统 → BRAN → 24381_145018 → 3 构件 + 3 直段`）与落盘判据（`rooms=` 过滤路径）答案不一致。树渲染本身正确；待房间边重对齐后可复验该 BRAN 出现。
