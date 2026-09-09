# gen-model v1 接入：收口与下一步计划（两源对拍翻默认 · 批量 records · type-check 修复）

- 日期：2026-09-09
- 状态：**待拍板**（D8–D10）
- 前置：`docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md`（下称「母计划」，P0–P7 + P3-c + P2-4 + Q2 全部落地）
- 范围：plant3d-web（主）+ gen-model `src/web_service/`（P9 最小增补；该仓正被别的会话密集重构，见 §7 R1）

## 1. 进展审核结论（2026-09-09 复核）

**复核方式**：母计划 §8 各阶段记录逐条对 git——plant3d-web 工作树干净，提交链 `3f1c2e2 → 65cb31a → be0da07 → a920c82 → b7dafa2 → 9d580e7 → adf9065 → 8eb8c99 → 6d6e727 → d19b1bb → 7f5bcf4 → 6d3cffb` 与 §8.2–§8.12 一一对应；gen-model 侧三笔（P0 `1eefbd577`、Ref0 404 分型 `97e819a5a`、model_drain WS 事件 `80b0f330c`）都在主线 log 里。

**已完成**（细节见母计划 §8，不重复）：P0 服务端增补、P1 底座、P2 模型树、P3 三维加载（D6 对拍 ≤0.002 mm）、P4 属性、P5 实时同步、P6 文档与脚本、P7 浏览器实跑 + 一次显示一次 ensure、P3-c 进度弹窗与整库入口、P2-4 dbnum 徽标、Q2 告警色。新增单测约 110 条全绿，vitest 全量新增 fail 0。

**未收口**（母计划 §9「仍欠」+ 各节「未验证」，即本计划要做的事）：

| # | 欠项 | 卡在哪 |
| --- | --- | --- |
| 1 | 默认开关仍 `legacy`（`.env.development` 里 `VITE_MODEL_SOURCE` 注释着） | 闸门 = 两源对拍，需要旧后端 `:3100` 在跑；当前 `:3100` / `:8022` / `:18082` 都没有服务在听。旧后端仓在 `D:\work\plant-code\plant-model-gen`（不在 `old\` 下），起得来 |
| 2 | EQUI / SUPPO 两类从未对拍（BRAN / ZONE 只做过单源自洽） | 同上 |
| 3 | `is_invalid_tubi` 告警色浏览器肉眼核对 | 需要一条真实无效直管样本，样本里有没有还未知 |
| 4 | gen-model `97e819a5a` / `80b0f330c` 未 live 验证；model_drain 收口 → 前端自动重载的端到端一次没跑过 | 需要一个跑新代码的 gen-model 实例 + 触发一次真实 drain |
| 5 | 整库入口只是「安全概览」（200 根预算，13 SITE 跑 269 s，长尾全在一根一次 `model/records`） | gen-model 缺批量取 records 的口子，契约未定 |
| 6 | 仓级发现：`npm run type-check` 空转（`vue-tsc --noEmit` 对 `files:[]` 的根 tsconfig 一个文件不查），真查 `npx vue-tsc --build --force` 全仓 642 条既有错误 | 不属于母计划，但每轮「type-check 通过」都是假绿灯，该修 |

## 2. P8 · 两源对拍与翻默认（收官，前端仓为主）

| # | 任务 | 验收 |
| --- | --- | --- |
| P8-1 | 起环境：`:3100`（`plant-model-gen`）+ gen-model `:8022`（仓内 `DbOption.toml` 现成）。**长驻服务由用户在自己终端起**（会话内不跑长驻命令），本计划附启动命令清单 | 两端口在听；`scripts/verify-gen-model-v1.ps1` 11/11（§8 P11 给 meshes 加了 `.mesh` 直连一步，`-Ensure` 的逐 hash HEAD 也改走 `.mesh`） |
| P8-2 | 两源对拍：`?model_source=gen-model-v1` vs `?model_source=legacy&data_source=parquet` 两 tab，四类节点 BRAN `24381_145018` + EQUI + SUPPO + ZONE（后三个从树里现选），比 `loadedObjects`、`sceneBoundingBox` 逐轴 ≤ 1 mm、截图肉眼一致 | 结果记进母计划 §8.13；差异 >1 mm 停下查（先核两边数据是否同一代，见 R2） |
| P8-3 | `is_invalid_tubi` 样本：`verify-gen-model-v1.ps1 -Ensure` 的 records 输出里扫 `is_invalid_tubi=true`；有 → 浏览器肉眼核对琥珀色；没有 → 在 E3D 里造一条坏直管（两端重合）再验，或记「样本缺失维持未验证」 | 母计划 §8.12 的「未验证」销账或明确挂起 |
| P8-4 | live 验证 gen-model 两笔：`tree/children?refno=1/1` → 404 `not_found`（原 500）；触发一次真实 drain → WS `task_finished{kind:"model_drain"}` → 前端 15 s 内自动重载对应根 | 浏览器 network/console 证据记 §8.13 |
| P8-5 | 全绿后翻默认：`resolveModelSourceKind()` 缺省值 + `.env.development` / `.env.example` 改 `gen-model-v1`；legacy 开关保留一个发布周期；联调指南与 CONTEXT 各改一句 | 不带参数打开页面走 v1；`?model_source=legacy` 仍可回旧链路；vitest 全量新增 fail 0 |

P8-4 可选顺手项（拍板 D8 后定）：`useGenModelV1ModelSync` 按 `payload.kind === 'model_drain'` 直取 `detail.roots` 重载，REST 轮询从 15 s 拉长到分钟级（服务端 `80b0f330c` 已给事件，前端现在是「任何 task_finished 都触发一次 REST 对齐」，能用但粗）。

## 3. P9 · gen-model 批量 records（跨仓，契约先行）

一根一次 `model/records` 是整库的瓶颈（§8.9：200 根预算 269 s，单次 records 长尾 0.5 s–4 min）。

| # | 任务 | 验收 |
| --- | --- | --- |
| P9-1 | 定契约（D9）：推荐 `POST /api/v1/model/records` 请求体加可选 `generation_roots: ["a/b", …]`（≤64 根/次，与单根 `generation_root` 互斥），响应 items 平铺（`owner` 本来就是生成根，天然可分组），分页游标跨根连续；写进 `docs/specs/web-service-api.md` 草案段 | gen-model 侧会话/用户认可契约再动代码 |
| P9-2 | gen-model 实现 + 单测（写锁范围只在 `src/web_service/`，与在改会话协调，见 R1） | `cargo test --lib -- web_service` 全绿；单根旧调用不受影响 |
| P9-3 | 前端 `genModelV1/modelRecords.ts`：多根打包分批取，`recordsConcurrency` 语义改为「在飞批数」；整库预算 `DEFAULT_DBNUM_ROOTS_BUDGET` 从 200 提到不限（或大幅上调），`show_dbnum_full` 语义收编 | 同一整库 `show_dbnum=7997` 相对 §8.9 的 269 s 显著下降（目标 <60 s，服务端侧长尾另计）；新增 fail 0 |

## 4. P10 · type-check 修复（独立，可并行）

| # | 任务 | 验收 |
| --- | --- | --- |
| P10-1 | `package.json` 的 `type-check` 改 `vue-tsc --build --force`（真查 642 条会全红，所以同步给一条基线策略：错误清单落 `tmp/`或基线文件，脚本先比对「不新增」） | 注入一处故意类型错，脚本能红；HEAD 现状跑完不红（基线相等） |
| P10-2 | 642 条按文件分桶列清单，消化**另立计划**（本计划不消化） | 清单进 docs/plans 新档或 issue |

## 5. 需要拍板

> 推荐项**加粗**。

- **D8 翻默认的闸门**：**A. 按母计划 D2 原口径——P8-2 两源对拍全绿才翻**（旧后端就在本机，起得来，证据链完整）；B. 以已有证据（D6 数值对拍 ≤0.002 mm + P7/P3-c 浏览器实跑）直接翻，省一次起旧后端——但 EQUI/SUPPO 两类从没对过，legacy 在 `:3100` 不起时本来就是坏的，翻错也看不出来。
- **D9 批量 records 契约**：**A. `model/records` 请求体加 `generation_roots[]`（≤64/次），响应平铺**（改动最小，plant-ui 单根调用零影响）；B. 新端点 `model/records/batch`（契约更干净但多一套分页/错误分型）；C. 服务端不动，前端继续按根并发（现状，长尾吃满服务端仍是一根一算，不解决）。
- **D10 type-check**：**A. P10-1 改脚本 + 基线比对，642 条消化另立**；B. 本计划不动 type-check（继续假绿灯，但少一件事）。

## 6. 顺序与工作量

| 阶段 | 估算 | 依赖 |
| --- | --- | --- |
| P8 | 0.5–1 天（大头是起环境与四类节点对拍） | 用户起 `:3100` + `:8022`；D8 |
| P9 | 1.5 天（契约 0.5 + 服务端 0.5 + 前端 0.5） | D9；gen-model 仓协调（R1） |
| P10 | 0.25 天（P10-1），消化另立 | D10；与 P8/P9 无依赖 |

关键路径：P8（翻默认是母计划的验收终点）。P9/P10 可并行、可延后，不阻塞翻默认。

## 7. 风险

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | gen-model 仓正被多个会话重构（常驻房间模型 d-44/d-21、增量重构 d-34、S4b d-37；工作树大面积改动中，`store_mode` 默认已翻回 external `9ce2ef7e9`） | P9 动手前 `zhimo_tools recall/read_decisions` 再看一眼 + 拿 `src/web_service/` 写锁；只加字段不改既有形状 |
| R2 | 两源对拍的差异可能来自**数据不同代**（`:3100` 的 parquet 是旧导出，gen-model 是当前库），不是链路错 | 对拍前先记两边数据水位（parquet 导出时间 vs `/api/v1/dbnums` 水位）；差异出现先归因数据再查代码 |
| R3 | `store_mode=external`（新默认）下 `model/records` 走 `model-database`，与内存形态的细微差异（母计划 R2）现在成了主形态 | 对拍在 external 形态下做（就是翻默认后用户真实形态）；前端只依赖六个字段的约定不变 |
| R4 | 批量 records 单响应过大（64 根 × 每根几百条） | 契约里保留分页（游标跨根连续），`limit` 语义 = 总条数不变 |

## 8. 追记（2026-09-09）：P11 · `.mesh` 直连拍板并落地（决策 d-127）

**拍板**：gen-model-v1 源的网格不再经服务端转 GLB，改拉 `GET /api/v1/meshes/{hash}.mesh`
原样 rkyv 字节、前端手解；`.glb` 转换口径服务端保留一个发布周期。legacy 与
runtime/release 两条 GLB 链路不动。

**为什么敢手解 rkyv**（mesh_glb.rs 原注释的顾虑有界）：语料按内容寻址落盘（48,590 份 /
637 MB），rkyv 0.7.42 一升级连 gen-model 自己都读不了旧文件——格式事实上冻结。布局用
探针在**全量语料**上验过：aabbFirst 布局 48,588/48,590 全过（最大 aabb 偏差 2.8e-6，
另 2 份是 60 B 空网格，`.glb` 口径下同样 422），四个候选布局里其余三个 0 通过。
布局细节见 `src/utils/parseMeshGeometry.ts` 头注。

**落地清单**：
- plant3d-web：新增 `src/utils/parseMeshGeometry.ts`（rkyv 手解，与 `parseGlbGeometry`
  同一 `{positions, indices, normals?}` 契约、同一批拒收条件）+ 金样单测
  `parseMeshGeometry.test.ts`（fixture = 语料原件 `src/fixtures/meshes/`：单位盒 /
  单位球 / aabb=None 构件 / 60B 空网格，外加截断与索引越界负样）；
  `genModelV1MeshUrl` 换 `.mesh` 后缀；DTX 加载链按 URL 后缀选解析器
  （`useDbnoInstancesDtxLoader.ts`）；`verify-gen-model-v1.ps1` meshes 步改验两种口径、
  `-Ensure` 的逐 hash HEAD 改 `.mesh`；CONTEXT.md「数据源端口」词条、联调指南同步。
- gen-model（写锁下改，已释放）：`handlers.rs` `mesh_glb` 同一道门/同一次读盘后按后缀
  分支——`.mesh` 原样吐 `application/octet-stream`（不解析不转换），`.glb` 照旧现场转；
  `immutable`/`ETag` 两形态一致。源形测试补 `.mesh` 分支钉子
  （`mesh_raw_branch_serves_bytes_without_conversion`）。spec §4.11 重写为双口径。
  路由 `{file}` 本就通配，mod.rs（别的会话正在改）一行未动。

**验证**：
- plant3d-web：受影响 6 个测试文件 53/53 绿（parseMeshGeometry 6 条金样 +
  genModelV1Api URL + model-source 端口 + DTX 加载器 ×2 + useModelGeneration）。
  全量 vitest：1946 passed / 30 failed——failed 全部是 review/工作流/UI 域的**既有**
  失败：对同一批失败文件做 stash 前后对拍，HEAD 基线与本改动后都是 10 文件 / 18 条，
  逐项相同，**新增 fail 0**（与母计划各轮「全量新增 fail 0」同一口径）。
- gen-model：`cargo test --lib mesh` 103/103 绿（含新钉子）；Rust 侧
  `repository_unit_meshes_convert_end_to_end --nocapture` 打印的单位网格
  （36 顶点/12 三角、629/1080、包围盒 ±0.5）与 TS 解析器金样逐项一致——两个独立
  实现对同一批字节读数相同，布局契约两头钉死。
- **live 验证（2026-09-09 19:2x，用户起 gen-model `:8022` 后补齐）**：
  - `verify-gen-model-v1.ps1 -Ensure` **11/11 全过**（`1.mesh` 200/1068 B/immutable、
    `1.glb` 200/glTF 魔数、ensure Generated 22 实例、records 22 条、逐 hash HEAD
    `.mesh` 10/10）；
  - **位级对拍**（`tmp/verify-mesh-parity.mjs`）：BRAN 24381/145018 全部 10 个真实
    geo_hash，`.mesh` 手解 vs `.glb` accessor 两条解码路径 positions/indices/normals
    **逐 f32 位一致**（10/10，全带 normals）；
  - **浏览器整链 e2e**（`e2e/gen-model-v1-mesh-direct.spec.ts`，playwright 自起自停
    dev server）：`?model_source=gen-model-v1&show_refno=24381_145018` → 10 发
    `.mesh` 全 200、**0 发 `.glb`**、`__dtxLastLoadedDbno=7997`、无 pageerror；
    画面证据 `e2e/screenshots/gen-model-v1-mesh-direct.png`（22 对象、mesh 缺失 0）。
    gen-model 不在时该 e2e 自动 skip，不误报回归。
- P8-2 两源对拍在 `.mesh` 直连的最终形态上跑一次即可，比的是 loadedObjects/包围盒，
  天然覆盖新解析器。

**顺带发现**：当前语料 `wire_vertices` 全为空（探针全量扫描），「直连白拿硬边线」
目前只是格式能力、不是现成数据；aabb=None 占 10,332/48,590。

**对 §2–§4 的影响**：P8 流程不变（对拍在新形态上跑）；P9/P10 无影响。

## 9. 追记（2026-09-09 晚）：P8 跑完的实际形态——legacy 参照不成立，D8 待拍板

细节全在母计划 §8.13，这里只记对本计划各行的影响：

| # | 状态 | 一句话 |
| --- | --- | --- |
| P8-1 | **过** | 用户口径 legacy = plant-server（`:3100`，detached runtime，静态目录 `plant-model-gen/output`）；gen-model 0.1.21 `:8022`；`verify-gen-model-v1.ps1 -Ensure` 11/11 |
| P8-2 | **跑了，但 legacy 不能当参照** | 输出目录没有 `scene_tree_parquet/`（legacy 树与 `visible-insts` 空转，容器展不开）、parquet 只覆盖 ZONE 144870 的管道（EQUI 0 几何）、dbnum 7997 没有 SUPPO。数据级对拍：BRAN 对象数 22=22、构件集相同；ZONE legacy 1287 构件全在 v1 里（v1 多 54 个 legacy 无几何的构件），直管差 263 段是 legacy 原点到原点的画法伪影；EQUI v1 40 = 全部基本体。v1 浏览器 ↔ records 三类节点逐条相等（22/2024/40） |
| P8-3 | 样本缺失 | 2024 条记录里 `is_invalid_tubi=true` 0 条，维持「未验证」 |
| P8-4 | 半 | `tree/children?refno=1/1` → 404 `not_found` 已 live；drain → WS → 自动重载未触发 |
| P8-5 | **等 D8** | 闸门 A（浏览器两源全绿）在本机做不到——要先用旧导出链给 7997 补 `scene_tree_parquet`（而旧链路 plant-model-gen 已不再是用户的路线）；闸门 B 的证据比拍板时多了一层：数据级 v1 ⊇ legacy + 浏览器/records 互证 |

`e2e/gen-model-v1-two-source-parity.spec.ts` 入库（`.gitignore` 白名单）：用例一先 HEAD legacy 的树 parquet，缺就带原因 skip；
用例二「v1 浏览器对象数 == records 逐根条数」不依赖 legacy，是翻默认后可以一直跑的回归钉子。

**D8 建议**：按 B 翻——legacy 在本机既没有树也没有 EQUI/SUPPO 几何，A 口径的「全绿」在它上面永远拿不到；
真要 A，只能再起一遍 plant-model-gen 的导出链补树 parquet，那是回头维护已放弃的路线。翻的内容不变（P8-5 那一行）。
