# gen-model v1 接入：收口与下一步计划（两源对拍翻默认 · 批量 records · type-check 修复）

- 日期：2026-09-09
- 状态：D8 **已拍（B）并落地**（2026-09-09 晚，见 §10；翻后 live 整链 §11 已补齐）；D10 **已拍（A）并落地**（P10-1，§11）；D9 **已拍（A）并落地**：P9-1 契约 spec §4.5.2（§11）、P9-2 服务端（gen-model `2e9d65e91`，§13）、**P9-3 前端多根打包**（2026-09-10，§15；单测 / type-check / eslint 过，**live 提速未验**——本机没有跑新构建的 gen-model）；P5 模型变更同步已按用户口径整条下线（§12）；全量 vitest 既有失败已**全部修完**（第一批 §14、第二批 §16；2026-09-10 下午 **264 文件 / 1977 条 / 0 failed**）
- 前置：`docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md`（下称「母计划」，P0–P7 + P3-c + P2-4 + Q2 全部落地）
- 范围：plant3d-web（主）+ gen-model `src/web_service/`（P9 最小增补；该仓正被别的会话密集重构，见 §7 R1）

## 1. 进展审核结论（2026-09-09 复核）

**复核方式**：母计划 §8 各阶段记录逐条对 git——plant3d-web 工作树干净，提交链 `3f1c2e2 → 65cb31a → be0da07 → a920c82 → b7dafa2 → 9d580e7 → adf9065 → 8eb8c99 → 6d6e727 → d19b1bb → 7f5bcf4 → 6d3cffb` 与 §8.2–§8.12 一一对应；gen-model 侧三笔（P0 `1eefbd577`、Ref0 404 分型 `97e819a5a`、model_drain WS 事件 `80b0f330c`）都在主线 log 里。

**已完成**（细节见母计划 §8，不重复）：P0 服务端增补、P1 底座、P2 模型树、P3 三维加载（D6 对拍 ≤0.002 mm）、P4 属性、P5 实时同步、P6 文档与脚本、P7 浏览器实跑 + 一次显示一次 ensure、P3-c 进度弹窗与整库入口、P2-4 dbnum 徽标、Q2 告警色。新增单测约 110 条全绿，vitest 全量新增 fail 0。

**未收口**（母计划 §9「仍欠」+ 各节「未验证」，即本计划要做的事）：

| # | 欠项 | 卡在哪 |
| --- | --- | --- |
| 1 | ~~默认开关仍 `legacy`~~ **已翻 `gen-model-v1`**（2026-09-09 晚，D8 按 B，见 §10） | 闸门 = 两源对拍，需要旧后端 `:3100` 在跑；当前 `:3100` / `:8022` / `:18082` 都没有服务在听。旧后端仓在 `D:\work\plant-code\plant-model-gen`（不在 `old\` 下），起得来 |
| 2 | EQUI / SUPPO 两类从未对拍（BRAN / ZONE 只做过单源自洽） | 同上 |
| 3 | `is_invalid_tubi` 告警色浏览器肉眼核对 | 需要一条真实无效直管样本，样本里有没有还未知 |
| 4 | gen-model `97e819a5a` / `80b0f330c` 未 live 验证；model_drain 收口 → 前端自动重载的端到端一次没跑过 | 需要一个跑新代码的 gen-model 实例 + 触发一次真实 drain |
| 5 | 整库入口只是「安全概览」（200 根预算，13 SITE 跑 269 s，长尾全在一根一次 `model/records`） | gen-model 缺批量取 records 的口子，契约未定 |
| 6 | ~~仓级发现：`npm run type-check` 空转~~ **已修**（P10-1，§11）：`vue-tsc --build --force` + 基线比对，只对新增错误报红 | 既有 646 条（2026-09-09 基线）的消化另立计划（P10-2，清单 = `scripts/type-check-baseline.txt`） |

## 2. P8 · 两源对拍与翻默认（收官，前端仓为主）

| # | 任务 | 验收 |
| --- | --- | --- |
| P8-1 | 起环境：`:3100`（`plant-model-gen`）+ gen-model `:8022`（仓内 `DbOption.toml` 现成）。**长驻服务由用户在自己终端起**（会话内不跑长驻命令），本计划附启动命令清单 | 两端口在听；`scripts/verify-gen-model-v1.ps1` 11/11（§8 P11 给 meshes 加了 `.mesh` 直连一步，`-Ensure` 的逐 hash HEAD 也改走 `.mesh`） |
| P8-2 | 两源对拍：`?model_source=gen-model-v1` vs `?model_source=legacy&data_source=parquet` 两 tab，四类节点 BRAN `24381_145018` + EQUI + SUPPO + ZONE（后三个从树里现选），比 `loadedObjects`、`sceneBoundingBox` 逐轴 ≤ 1 mm、截图肉眼一致 | 结果记进母计划 §8.13；差异 >1 mm 停下查（先核两边数据是否同一代，见 R2） |
| P8-3 | `is_invalid_tubi` 样本：`verify-gen-model-v1.ps1 -Ensure` 的 records 输出里扫 `is_invalid_tubi=true`；有 → 浏览器肉眼核对琥珀色；没有 → 在 E3D 里造一条坏直管（两端重合）再验，或记「样本缺失维持未验证」 | 母计划 §8.12 的「未验证」销账或明确挂起 |
| P8-4 | live 验证 gen-model 两笔：`tree/children?refno=1/1` → 404 `not_found`（原 500）；~~触发一次真实 drain → WS `task_finished{kind:"model_drain"}` → 前端 15 s 内自动重载对应根~~（**不适用**，2026-09-09 深夜：前端不再订阅 drain / WS，见 §12） | 浏览器 network/console 证据记 §8.13 |
| P8-5 | 全绿后翻默认：`resolveModelSourceKind()` 缺省值 + `.env.development` / `.env.example` 改 `gen-model-v1`；legacy 开关保留一个发布周期；联调指南与 CONTEXT 各改一句 | 不带参数打开页面走 v1；`?model_source=legacy` 仍可回旧链路；vitest 全量新增 fail 0 |

~~P8-4 可选顺手项（拍板 D8 后定）：`useGenModelV1ModelSync` 按 `payload.kind === 'model_drain'` 直取 `detail.roots` 重载，REST 轮询从 15 s 拉长到分钟级。~~ → 作废：`useGenModelV1ModelSync` 已整条下线（§12）。

## 3. P9 · gen-model 批量 records（跨仓，契约先行）

一根一次 `model/records` 是整库的瓶颈（§8.9：200 根预算 269 s，单次 records 长尾 0.5 s–4 min）。

| # | 任务 | 验收 |
| --- | --- | --- |
| P9-1 | 定契约（D9）：推荐 `POST /api/v1/model/records` 请求体加可选 `generation_roots: ["a/b", …]`（≤64 根/次，与单根 `generation_root` 互斥），响应 items 平铺（`owner` 本来就是生成根，天然可分组），分页游标跨根连续；写进 `docs/specs/web-service-api.md` 草案段 | **草案已写**（2026-09-09 晚，D9 按 A，决策 d-181）：gen-model spec 新增 §4.5.2（单根现状补齐 + 批量草案，见 §11）；gen-model 侧会话/用户认可契约再动代码 |
| P9-2 | gen-model 实现 + 单测（写锁范围只在 `src/web_service/`，与在改会话协调，见 R1） | **过**（2026-09-09 深夜，gen-model `2e9d65e91`，见 §13）：`cargo test --lib -- web_service` 62 passed（+2）；单根请求 / 响应形状一字不改；**未 live**（本机 `:9099` 是 0.1.21 出厂包） |
| P9-3 | 前端 `genModelV1/modelRecords.ts`：多根打包分批取，`recordsConcurrency` 语义改为「在飞批数」；整库预算 `DEFAULT_DBNUM_ROOTS_BUDGET` 从 200 提到不限（或大幅上调），`show_dbnum_full` 语义收编 | **代码已落地**（2026-09-10，见 §15）：同 Ref0 切批 ≤64、旧服务端自动退回逐根、根预算不限 / 只守 50 000 构件、`show_dbnum_full=1` 全不设；新增 fail 0。**live 提速未验**（目标 <60 s，服务端侧长尾另计）——要起一个含 `2e9d65e91` 的 gen-model 才能量 |

## 4. P10 · type-check 修复（独立，可并行）

| # | 任务 | 验收 |
| --- | --- | --- |
| P10-1 | `package.json` 的 `type-check` 改 `vue-tsc --build --force`（真查 642 条会全红，所以同步给一条基线策略：错误清单落 `tmp/`或基线文件，脚本先比对「不新增」） | **过**（2026-09-09 晚，D10 按 A，决策 d-179，见 §11）：`scripts/type-check.mjs` + `scripts/type-check-baseline.txt`；注入故意类型错→红、HEAD→绿、两跑基线逐字相同 |
| P10-2 | 642 条按文件分桶列清单，消化**另立计划**（本计划不消化） | 清单 = 入库的基线文件本身（646 条，按文件排序、可 grep）+ §11 的分桶摘要；消化另立计划 |

## 5. 需要拍板

> 推荐项**加粗**。

- **D8 翻默认的闸门**：**A. 按母计划 D2 原口径——P8-2 两源对拍全绿才翻**（旧后端就在本机，起得来，证据链完整）；B. 以已有证据（D6 数值对拍 ≤0.002 mm + P7/P3-c 浏览器实跑）直接翻，省一次起旧后端——但 EQUI/SUPPO 两类从没对过，legacy 在 `:3100` 不起时本来就是坏的，翻错也看不出来。
- **D9 批量 records 契约**：**A. `model/records` 请求体加 `generation_roots[]`（≤64/次），响应平铺**（改动最小，plant-ui 单根调用零影响）；B. 新端点 `model/records/batch`（契约更干净但多一套分页/错误分型）；C. 服务端不动，前端继续按根并发（现状，长尾吃满服务端仍是一根一算，不解决）。
- **D10 type-check**：**A. P10-1 改脚本 + 基线比对，642 条消化另立**；B. 本计划不动 type-check（继续假绿灯，但少一件事）。

> **已拍**（2026-09-09 23:1x，用户「按推荐继续下一步」）：D9 按 A（决策 d-181）、D10 按 A（决策 d-179）。落地记录见 §11。

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
| P8-4 | 过（a）/ 不适用（b） | `tree/children?refno=1/1` → 404 `not_found` 已 live；drain → WS → 自动重载 **不适用**（前端不再订阅，§12） |
| P8-5 | **已翻**（D8 按 B，见 §10） | 闸门 A（浏览器两源全绿）在本机做不到——要先用旧导出链给 7997 补 `scene_tree_parquet`（而旧链路 plant-model-gen 已不再是用户的路线）；闸门 B 的证据比拍板时多了一层：数据级 v1 ⊇ legacy + 浏览器/records 互证 |

`e2e/gen-model-v1-two-source-parity.spec.ts` 入库（`.gitignore` 白名单）：用例一先 HEAD legacy 的树 parquet，缺就带原因 skip；
用例二「v1 浏览器对象数 == records 逐根条数」不依赖 legacy，是翻默认后可以一直跑的回归钉子。

**D8 建议**：按 B 翻——legacy 在本机既没有树也没有 EQUI/SUPPO 几何，A 口径的「全绿」在它上面永远拿不到；
真要 A，只能再起一遍 plant-model-gen 的导出链补树 parquet，那是回头维护已放弃的路线。翻的内容不变（P8-5 那一行）。

## 10. 追记（2026-09-09 晚）：D8 按 B 落地——缺省数据源翻到 `gen-model-v1`

用户以「继续未完的部分，不必重问」接过 §9 的 D8 建议，按 B 口径翻默认。改动与证据全文在母计划 §8.13 末条，这里记对本计划各行的影响：

| # | 状态 | 一句话 |
| --- | --- | --- |
| P8-5 | **过** | `DEFAULT_MODEL_SOURCE_KIND='gen-model-v1'`；`.env.example` / `.env.development` / `env.d.ts` / 三处头注 / 联调指南 / CONTEXT / ADR 0054 追记同步；legacy 开关保留一个发布周期，legacy 路径代码一行未动 |
| 验收「不带参数走 v1；`?model_source=legacy` 仍回旧链路」 | **过** | 新钉子 `e2e/model-source-default.spec.ts`（不依赖任何后端在跑）：`/` → kind `gen-model-v1`、`/api/v1/{health,tasks,dbnums}` 3 发、旧链路 0 发；`?model_source=legacy` → kind `legacy`、`/files/output/…/{db_meta_info.json,world_sites.parquet}` 2 发、`/api/v1` 0 发；2 passed |
| 验收「vitest 全量新增 fail 0」 | **过** | 翻后第一跑新增 28 fail 全出自 5 个测 legacy 链路、靠缺省隐式成立的文件，文件头显式钉 `?model_source=legacy` 后：1977 / 1952 passed / 25 failed，失败集 ⊆ HEAD 基线（1976 / 1946 / 30），新增 0 |
| ~~未验证~~ **已补齐** | **过** | 翻后带 gen-model 在跑的整链——见 §11 第一条：`:9099` 上的 0.1.21 出厂包实例到 22:5x 已有数据（`/dbnums` 有行、`model_publish_queue` generated 2908），拿它跑 `model-source-default` + `mesh-direct` + `two-source-parity`：4 passed / 1 skipped（skip 是 legacy 缺树 parquet 的设计内 skip） |

**对 §1 / §2 的影响**：§1 表第 1 行「默认开关仍 legacy」销账；P8 全部行有归宿（P8-3 样本缺失、P8-4b 未触发仍如 §9）。~~**下一步**只剩 D9（批量 records 契约）与 D10（type-check 修复）两件待拍板，互不阻塞。~~ → D9 / D10 已拍并推进，见 §11。

## 11. 追记（2026-09-09 深夜）：翻后 live 整链补齐；D10 按 A 落地（P10-1）；D9 按 A 出契约草案（P9-1）

用户以「按推荐继续下一步」接过 §10 末句，D9 / D10 均按推荐项 A 生效（决策 d-181 / d-179）。三件事：

**1. 翻默认后的 live 整链（§10「未验证」行销账）**

- 环境：legacy = plant-web-server `:3100`；gen-model = `D:\ams-local-0.1.21` 出厂包 `aios-database.exe serve`，**听 `:9099`**（出厂模板端口，`:8022` 无人听），`gen_model=false / gen_mesh=false`、`store_mode=spawned-rocksdb`，此刻 `/api/v1/health` 200、`/dbnums` 有行、`model_publish_queue` generated=handed_off=db_committed=2908。
- 跑法：playwright 自起自停 dev server `:3101`；Node 侧探针 `GEN_MODEL_V1_BASE_URL=http://127.0.0.1:9099`、页面侧 `VITE_GEN_MODEL_V1_BASE_URL=http://localhost:9099` 压过 `.env`（两个 e2e 的探针硬码默认 8022，不带就静默 skip——这是环境事实，不是回归）。
- 结果 **4 passed / 1 skipped（35.7 s）**：
  - `model-source-default.spec.ts` 2/2：`/` → kind `gen-model-v1`、只发 `/api/v1`；`?model_source=legacy` → 旧链路、`/api/v1` 0 发。
  - `gen-model-v1-mesh-direct.spec.ts` 1/1：`.mesh` 10 发全 200、`.glb` 0 发。
  - `gen-model-v1-two-source-parity.spec.ts`：用例一按设计 skip（legacy 无 `scene_tree_parquet/`）；用例二过——BRAN 22=22=22、ZONE 2024=2024=2024、EQUI 40=40=40（records = DTX 登记 = toast loadedObjects），bbox 有限。
  - 3101 跑完已释放；临时环境变量已清。
- 本机要不带参数直接打开页面连上 `:9099`：`.env.development`（git 忽略）里 `VITE_GEN_MODEL_V1_BASE_URL=http://localhost:9099`（22:5x 已改），或 URL 带 `?gm_backend_port=9099`；联调指南 §1 那句「端口不是 8022 时」已经覆盖这一情形，不另改文档。
- 仍未验证：P8-3 `is_invalid_tubi` 样本缺失。~~P8-4b drain → WS → 自动重载~~ → 随即按用户口径改记「不适用」（§12）。

**2. P10-1 落地（D10 按 A，决策 d-179）**

- `scripts/type-check.mjs`：跑 `vue-tsc --build --force --pretty false`，每条错误归一为 `文件|TS码|首行消息`（去行列号——挪一行代码不算新错），与 `scripts/type-check-baseline.txt` 的多重集合比：任一签名条数超基线 → 红（exit 1，列出具体行列）；基线里的错误消失 → 只提示收紧；没有基线文件、或 vue-tsc 报错却一条都解析不出 → 红（宁红勿绿）。vue-tsc 自己的噪音（`@vue/language-core` 3.1.6 在 2 个模板上抛 `TypeError … walkObjectLiteral`，非致命）按非错误行忽略。
- `package.json`：`type-check` → `node scripts/type-check.mjs`；新增 `type-check:update-baseline`。`build` 仍是 `run-p type-check build-only`，所以 **`npm run build` 现在会被新增类型错误挡下**（多 ~26 s）。`.gitignore` 白名单加两行；`AGENTS.md` 的 `type-check` 一句改口。
- **基线（2026-09-09，HEAD `c5aeaa5`）：646 条 / 172 文件**（比 09-08 记的 642 多 4）。分桶：`*.test.ts` 359、`src` 非测试 `.ts` 167、`.vue` 107、`scripts/` 10、`e2e/` 3；按目录 `components` 225 / `composables` 150 / `dimension` 122 / `utils` 52 / `debug` 25 / `review` 24 / `api` 12 / `types` 9；码 TS2322 133 / TS2532 105 / TS18048 87 / TS2345 86 / TS2339 53；最多的文件 `ViewerPanel.vue` 33、`useSpatialQuery.test.ts` 23、`lffParser.ts` 22、`pmsReviewSimulator.ts` 18、`ReviewPanel.vue` 17、`useDtxTools.ts` 16。这就是 P10-2 的清单（基线文件按文件排序、可 grep），消化另立计划。
- 验收（本轮跑过）：无基线 → 红；`--update-baseline` 建基线 646/172；HEAD 对基线 → 绿；**连跑两次基线逐字相同**（确定性）；注入一个故意类型错（临时新文件）→ 红并指到 `(1,14)`；删掉 → 绿；`eslint scripts/type-check.mjs` 0 错。

**3. P9-1 契约草案（D9 按 A，决策 d-181）**

- 写进 gen-model `docs/specs/web-service-api.md` 新增 **§4.5.2**（只动文档，`handlers.rs` 未碰——它正被别的会话改）：前半把今天在跑的单根 `model/records` 契约补齐（此前只散见 §4.12），后半是批量草案：`generation_roots[]`（1..=64、同库、与 `generation_root` 互斥，违者 400）；`items` 平铺、顺序 = 请求根序 × 每根稳定序、按 `owner` 分组；`cursor` 跨根连续、`limit` 仍是总条数；响应回显 `generation_roots` 并多一格 `roots:[{generation_root,total}]`（整批逐根总数，让「这根 0 条」显式可见）；内存形态任一根未 ensure → 整批 409 `not_generated:` 并列出缺的根；不开新端点。
- 下一步：gen-model 侧会话 / 用户认可 §4.5.2 后，P9-2（服务端，写锁 `src/web_service/`）→ P9-3（前端 `modelRecords.ts` 多根打包分批、`recordsConcurrency` 改「在飞批数」、整库预算上调）。

**未提交物 / 环境备注**：工作树里 `useDbnoInstancesDtxLoader.test.ts` / `useModelGeneration.loadScope.test.ts` 有两处纯行尾（CRLF）改动与 `docs/issues/mbd-*` 是别的会话的，本笔提交不带。

## 12. 追记（2026-09-09 深夜）：用户口径「树与三维数据全走 API 即时生成，不用库里的数据」——P5 模型变更同步整条下线

用户原话：「这里面的节点树和三维模型数据全部都是以 API 的数据形式提供。也就是说都是即时生成的。不需要去用数据库里面的数据。」随后拍板：**整条 `useGenModelV1ModelSync` 下线（轮询和 WS 都不要），前端只靠自己的 ensure**；P8-4b 记不适用；spec 草案去掉 rocksdb 字眼；记一条决策。

**对照现状**：前端取数链本来就是 `tree/*`（内存 MDB 骨架）→ `model/ensure`（即时生成）→ `model/records`（六个字段）→ `/meshes/{hash}.mesh`，从不区分 `model-memory` / `model-database`、不读库侧水位；唯一带「等库侧」味道的就是 P5：WS `tasks` + 15 s 轮询 `GET /tasks?kind=model_drain` → 与已加载根求交 → `reload`。

**改动（plant3d-web）**
- 删：`src/composables/useGenModelV1ModelSync.ts` + `.test.ts`、`src/api/genModelV1Ws.ts` + `.test.ts`（WS 客户端只有它一个用户）。
- `src/api/genModelV1Api.ts`：去掉 `GET /api/v1/tasks` 绑定（`TaskEntryDto` / `TasksResponse` / `GenModelV1TasksQuery` / `genModelV1Tasks`），留一行注释指回本节。
- `GenModelV1HealthBadge.vue`：去掉 sync 的挂起/停止、悬停「模型同步」行、右侧 WS 小点；只剩 `/health` + `/dbnums`。
- `useModelGeneration.ts`：`showModelByRefno` 去掉 `reload` 选项（它只有 P5 一个派发方）——早退条件只看 `regenerate`，v1 分支 `replace = regenerate`，状态文案 / toast 相应收拢；`ViewerPanel.vue` 去掉 `reload: detail.reload` 透传。
- `modelRecordSource.ts`：`collectedRoots / leavesOfRoot / invalidateRoot` 作为通用缓存操作**保留**（有单测、无 P5 依赖），只把注释里的 P5 / `model_drain` 字眼去掉。
- 文档：CONTEXT.md「模型变更同步」词条改写为「即时生成数据 (On-Demand Data)」；联调指南 §3 期望、§7 故障表「模型重算后场景没刷新」改为「这是设计」、§8 源码清单；母计划 §8.6 头注 + §8.13 P8-4b 改「不适用」；本计划 §2 P8-4 行、P8-4 顺手项作废、§9 P8-4 行、§11。
- e2e `model-source-default.spec.ts` 不用改：它只断言 v1 请求 > 0 且旧链路 0（首批现在是 `/health` + `/dbnums` 两发，少了 `/tasks`）。

**改动（gen-model，只动文档）**：spec §4.5.2 批量草案去掉 rocksdb / 内存形态的分叉措辞——同库约束保留（一个响应一个 `source`），加一句 plant3d-web 口径「只吃 ensure 即时生成、records 原样回的数据，不对存储形态作承诺」；`not_generated` 409 改为形态无关的表述。§5.3 `task_finished` 行加括注：plant3d-web 自 2026-09-09 起不消费该事件、不轮询 `/tasks`，事件保留给其它客户端。

**验证**：`npm run type-check` 646 / 基线 646 / 新增 0 / 已消失 0（删掉的文件本来就无基线错误）；触及 4 个源文件 ESLint 0 错；受影响 vitest 13 文件 101 条全绿（`useModelGeneration*`、`model-source/genModelV1/*`、`genModelV1Api`、`model-source/index`、`useGenModelV1Health`）；`e2e/model-source-default.spec.ts` 与全量 vitest 结果见下一行追记。

**不动的**：`useGenModelV1Health`（`/health` + `/dbnums` 三态徽标）保留——它只说「连上了没、库同步/滞后几个」，不驱动任何加载；gen-model 侧 `model_drain` WS 事件（`80b0f330c`）保留给其它客户端；legacy 链路一行未动。

## 13. 追记（2026-09-09 深夜）：P9-2 服务端落地——`POST /model/records` 收 `generation_roots[]`

用户拿定 spec §4.5.2 后开工。gen-model `2e9d65e91`（写锁只在 `src/web_service/handlers.rs`，`mod.rs` 路由未动；同文件里别的会话两处未提交 hunk 用反向 apply 从索引里摘出，没带进这笔）：

- `ModelRecordsReq`：`generation_root` 改 `Option`，新增 `generation_roots: Option<Vec<String>>`；`requested_generation_roots()` 判二选一 / 1..=64（`MAX_MODEL_RECORDS_ROOTS`）/ 不重复，违者 400。
- 所属库逐根解（`dbnum_for_roots`），跨库 400；一次 `route_for(dbnum)`；内存形态先把缺 receipt 的根收齐再**整批** 409 `not_generated:`（消息列出全部缺的根；单根消息原文不变）；逐根取记录（库形态 `records_of_root(SUL_DB)`，内存形态投影 → `GeomInstQuery`，映射抽成 `projection_record_to_query`，逐字搬自原闭包）；`page_records_across_roots()` 平铺切页——单根就是一根的特例，`skip/take` 语义与原来逐字相同。
- 响应：批量回显 `generation_roots` + `roots:[{generation_root,total}]`；单根仍只回 `generation_root`，其余字段两种形态相同。
- 单测 2 条：请求形态与上限（含 64 正好放行 / 65 拒、重复根拒）；跨根平铺切页（空根显式在 `roots` 里、一页跨根边界、末页 `next_cursor=null`、越界空页、单根特例）。`cargo test --lib -- web_service` **62 passed**（原 60）；`rustfmt --check` 干净；aios-database 自身 0 警告。
- spec §4.5.2 从「草案」改「已实现」，补不重复规则与实现说明。
- **未 live**：`:9099` 上是 0.1.21 出厂包，没有这段代码。起新构建后：`curl -X POST http://127.0.0.1:8022/api/v1/model/records -H 'content-type: application/json' -d '{"generation_roots":["24381/145018","24381/145052"],"limit":5}'` 应回 `generation_roots` + `roots[]` + 平铺 `items`、`next_cursor=5`；同库两根之外再塞一个别库的根应 400；单根请求回执与之前逐字段相同。
- **下一步 P9-3**（前端）：`modelRecords.ts` 多根打包分批（≤64/批）、`recordsConcurrency` 改「在飞批数」、`DEFAULT_DBNUM_ROOTS_BUDGET` 上调；`genModelV1Api.ts` 的 `genModelV1ModelRecords` 加 `generationRoots?: string[]`；`verify-gen-model-v1.ps1 -Ensure` 顺手加一步批量口径。

## 14. 追记（2026-09-10 凌晨）：全量 vitest 的既有失败——用户授权修测试文件，第一批落地

背景：全量 vitest 一直有一批与本计划无关的既有失败（review / dashboard / duckdb / pms 域），此前各轮都以「对 HEAD 基线新增 fail 0」交账。用户 2026-09-10 授权直接修这 19 个失败文件（只改测试与 vitest 配置，源码不动），随后拍板**验收口径 = 对 HEAD 基线新增 fail 0**、本趟按 done 收尾；已修完的照收。

**根因分两类**：
- **确定性失败 13 文件 / 25 条**——全是测试钉在旧行为上，源码早已改口：
  - 批注错误类型（`auth.severity.test.ts` 5、`useToolStore.severity.test.ts` 2）：源码是三档 `principle / general / drawing`（原则错误 × / 一般错误 △ / 图面错误 ○），测试还钉四档 `critical/severe/normal/suggestion` → 按三档重钉（含 symbol、rank 递增、旧四档当非法值）。顺带：源码 `compareAnnotationSeverity` 的注释仍写「致命 > 严重 > 一般 > 建议」，未动。
  - `versionInfo.test.ts` 1：期望值算错——10:00 UTC 是当天 18:00 北京时间，不是次日 02:00。
  - `duckdbBundles.test.ts` 1：`__DUCKDB_ASSET_VERSION__` 是 `vite.config.ts` 的 `define`，vitest 用独立的 `vitest.config.ts`、没有这个全局 → ReferenceError；测试还期望不带 `?v=` 的旧 URL。改为 `vi.stubGlobal` + 期望带内容哈希 `?v=` 的完整同源 URL，另加 extension repository 钉子。DuckDB 本体不动（legacy parquet 链路的底座，d-155 留一个发布周期）。
  - `DashboardLayout.test.ts` 1：背景色早已 `#F3F4F6 → #F1F5F9`。
  - `pmsSimulatorAutomation.test.ts` 1：场景清单 7 → 15 条，测试硬码旧快照；改钉「等于导出的 `PMS_SIMULATOR_CASE_ORDER`」+ 前 7 条主链不变。顺带发现源码常量里 `'bran-mixed'` 出现两次（第 3 与第 8 项），未动。
  - 其余 7 文件 / 14 条（`genModelE3dParquetApi` 2、`useUserStore.createReviewTask` 3、`useUserStore.pendingReviewTasks` 1、`reviewerTaskListActions` 1、`DockLayout` 3、`TaskReviewDetail` 3、`InitiateReviewPanel.minDeliveryUnit` 1）：review 域工作流 / 组件契约变了（Checker 从 `users.value` 解、jd/sj 节点过滤规则、embed bootstrap 载荷、测量端点文案、最小交付单元归一），修法同上，分派三路并行处理，结果见 §16。
- **超时型 flaky 6 文件 / 7 条**（`useReviewStore.*` 4、`useAnnotationStyleStore` 1、`AnnotationPanel` 1 ……）：每个文件的**首条**用例单跑就 1.1–1.2 s（冷加载 store / 组件），全量并行时被 5 s 缺省超时误杀；单跑全绿、与本仓任何改动无关。`vitest.config.ts` 加 `testTimeout / hookTimeout = 20_000`，不改用例。

**本批结果**（6 文件 + 配置）：6 文件 29/29 绿、eslint 0 错；全量 vitest **1970 / 1956 passed / 14 failed**——失败只剩上面那 7 个 review/parquet 文件（另一路在修），flaky 7 条全部转绿。type-check 门顺带收紧：三档重钉后基线里 15 条类型错误消失，`update-baseline` → **631 条 / 170 文件**。

## 15. 追记（2026-09-10 中午）：P9-3 前端多根打包落地——`records` 按批取、整库根预算不限、旧服务端自动退回逐根

接 §13 末行「下一步 P9-3」。只动 plant3d-web；gen-model 侧不碰（P9-2 已在 `2e9d65e91`）。

**改动**

- `src/api/genModelV1Api.ts`：`GenModelV1RecordsRequest` 改为 `generationRoot` / `generationRoots[]` **二选一**（两个都给、都不给、空数组、超 `MAX_MODEL_RECORDS_ROOTS = 64` 在客户端就抛 400 `bad_request`，不发请求）；批量体 `{ generation_roots: [a/b…], limit, cursor }`，单根体一字不改。`ModelRecordsResponse` 加回显字段 `generation_roots` / `roots[{generation_root,total}]`（上一会话已加）。新常量 `RECORDS_TIMEOUT_MS = 300_000`：`model/records` 此前吃 30 s 缺省超时，而服务端逐根长尾实测 0.5 s–4 min（母计划 §8.9），一批 64 根更长——30 s 会把慢根 / 大批误判成 `network` 错再逐根重打；调用方 `signal` 仍可提前取消。
- `src/model-source/genModelV1/modelRecords.ts`：
  - `planRecordsBatches(roots, batchSize, concurrency)`（导出）：**同 Ref0 才同批**（一个 Ref0 只属一个 dbnum，天然满足 spec「一批同库」；跨库 400 不会出现）；批大小 = `min(recordsBatchSize, ceil(根数 / recordsConcurrency))`——5 根 / 6 路仍是 5 个单根请求（与旧口径一字不差），17 根 → 6 批 3/3/3/3/3/2，335 根 → 6 批 ≤56，上千根才顶到 64 一批；小根集摊满并发路、进度也更细。
  - `recordsConcurrency`（缺省 6）语义改为**同时在飞的批数**；新 option `recordsBatchSize`（缺省 64；`1` = 逐根旧口径）。
  - 一批一次分页取完（`cursor` 跨根连续、翻页原样带同一批根），按 `owner`（= 生成根）归根；`owner` 不在批里的记录不丢（挂到批首根）。
  - **整批失败一律退回逐根**（这一路串行，一根一根），分型仍由逐根结果定：409 → pending、其它 → errors——一根的问题不拖垮同批其它 63 根。旧服务端（0.1.21 出厂包）不认识 `generation_roots`：axum 在 JSON 反序列化就拒，422 纯文本「Failed to deserialize … missing field `generation_root`」、无信封（本机 `:9099` 实测）→ `isBatchRecordsUnsupportedError`（422/400 + 消息含 `generation_root` + `missing field|unknown field|deserialize`）→ 按 **api 对象**（`WeakMap`，生产只有 `defaultModelRecordsApi` 一个）记「不支持」，此后直接逐根、不再试；新服务端对越界 / 重复 / 跨库回的 400 信封不算能力问题，只退这一批。`batchRecordsSupport(api)` 导出给诊断 / 单测。
  - `onRootDone` 仍每根一次（批成功后按批内顺序连发；逐根退路上每根一发），`total` 口径不变；结果仍按根顺序拼回。
- `src/model-source/genModelV1/collectDbnum.ts`：`DEFAULT_DBNUM_ROOTS_BUDGET` **200 → `Infinity`**（生成根数不再是瓶颈），新 `DEFAULT_DBNUM_REFNOS_BUDGET = 50_000` 是缺省唯一的守门（一次点击不该把整个大库拖进浏览器）。`useModelGeneration.showModelByDbnumGenModelV1`：`?show_dbnum_full=1` 现在把 `maxTotalRoots` 与 `maxRefnos` **一起**设成不限——这就是「`show_dbnum_full` 语义收编」：缺省 = 整库（撞 50 000 构件才是「安全概览」），`full` = 什么预算都不设。toast 文案不变。
- `scripts/verify-gen-model-v1.ps1 -Ensure`：逐根 `records` 之后加一步同一批根的多根批量 `records`——须回显 `generation_roots`、带 `roots[]`、平铺条数 == 逐根之和、`roots[].total` 之和 == 平铺条数；旧服务端 422「missing field」只记「服务端不支持多根批量（旧版）」不算失败。
- 文档：联调指南 `show_dbnum` 行与 `-Ensure` 说明、CONTEXT.md「生成根投影」词条各加一句；本节。

**验证（本轮跑过）**

- 单测：`modelRecords.test.ts` 假 `records` 改成同时认识单根与多根（照 spec 平铺切页、回显 `roots[]`）；新增 5 条（多根批量 + 跨根翻页 + 0 条根归 empty、旧服务端 422 退回逐根并记住、整批 409 / 400 信封 / 5xx 退回逐根只有真出问题的根归 pending / errors、owner 不在批里不丢、`planRecordsBatches` 2 条）；原「并发不超过 recordsConcurrency」用例改钉 `recordsBatchSize=1` 的逐根口径。`genModelV1Api.test.ts` +1（两种请求体形状 + 客户端 400）。`collectDbnum.test.ts` / `useModelGeneration.genModelV1.test.ts` / `modelRecordSource.test.ts` 按新缺省改钉。受影响 9 文件 **86/86 绿**。
- `npm run type-check`：631 / 基线 631 / 新增 0；触及 9 个源 / 测试文件 eslint 0 错。
- 全量 vitest：**1977 / 1963 passed / 14 failed**——失败仍是 §14 那 7 个 review/parquet 文件（14 条一条不多），对 HEAD 基线**新增 fail 0**（多出的 7 条全是本轮新增且全绿）。
- `verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:9099 -Refno 24381/145018 -Ensure`：12 步全过，新步骤在 0.1.21 上打「服务端不支持多根批量（HTTP 422，旧版；前端退回逐根）」——退路的判据就是这条真实响应。

**未验证（要一个跑着 `2e9d65e91` 的 gen-model）**

- 本机此刻 `:9099` 是 0.1.21 出厂包（没有批量代码），`:8022` 没人听，会话内不起长驻服务。起新构建后（在 `D:\work\plant-code\old\gen-model` 运行目录 `aios-database.exe serve`，`DbOption.toml` 的 `http_api_addr` 指 `:8022`）：
  1. `pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:8022 -Refno 24381/145018 -Ensure` → 批量那步应打 `roots=1 … records=22 (== 逐根之和) roots_total=22`；
  2. 浏览器 `http://localhost:3101/?show_dbnum=7997&gm_backend_port=8022`（或 `.env.development` 改指 8022）→ network 面板 `model/records` 请求体带 `generation_roots`（≤64 根一发）、控制台 `[model-load] gen-model-v1 dbnum=7997 … roots=N … ms=…`：与 §8.9 的 `roots=200 … ms=269039` 对比——**目标 <60 s**；现在缺省不限根数，roots 会是整库全部（§8.9 估「合计上千」），构件 ≤ 50 000；
  3. 服务端侧逐根长尾（单根 records 205 s 那种）批量救不了，仍「另计」。
- 整库跑出来太慢的话，可回退的旋钮都在 options：`recordsBatchSize`（批大小）、`recordsConcurrency`（在飞批数）、`collectDbnum` 的 `maxTotalRoots`（调用方传有限值就回到「安全概览」）——不用改契约。

## 16. 追记（2026-09-10 下午）：全量 vitest 既有失败第二批——7 个 review/parquet 文件重钉，全量 0 failed

接 §14「其余 7 文件 / 14 条 …… 结果另记」。用户 2026-09-10 确认口径：**源码当前行为就是契约**，只改测试、源码一行不动（含 §14 已点名的 `compareAnnotationSeverity` 旧注释与 `'bran-mixed'` 重复，只记不改）、不改 vitest 超时配置；每处改动在测试里注一句改了什么、为什么。

**逐文件根因与重钉**（7 文件 / 14 条，全是测试钉在旧行为上）

- `src/api/genModelE3dParquetApi.test.ts` 2：与 §14 `duckdbBundles` 同源——DuckDB 资产 URL 带 `?v=__DUCKDB_ASSET_VERSION__`，vitest 没有 vite `define` 全局 → ReferenceError → 每条 parquet 查询 `success:false`；另外连接建好后源码先发 `SET custom_extension_repository …`（`duckdbBundles.configureLocalDuckDBExtensions`），假 `query` 不认识这条 SQL。改：两个 describe 的 `beforeEach` 里 `vi.stubGlobal('__DUCKDB_ASSET_VERSION__', …)`，假 `query` 对 `SET custom_extension_repository` 回空。
- `src/composables/useUserStore.createReviewTask.test.ts` 3 / `useUserStore.pendingReviewTasks.test.ts` 1：本地回退（`buildLocalTask`）与 `switchUser` 都从本地 mock 名册 `users.value` 解人，名册 id 早已是 `SJ / JH / SH / PZ`（张校对员 = JH、李审核员 = SH），测试还用 `proofreader_001 / reviewer_001` → 「Checker not found」/ `switchUser` 直接返回、收件箱空。改：走回退路的用例改用名册 id，顺带钉住 `checkerName / approverName` 与「本地任务 `reviewerId` 兼容位 = checker」；走后端的用例不查名册，未动。
- `src/components/review/reviewerTaskListActions.test.ts` 1：`useUserStore.resolveEffectiveUserId` 现在原样回传 id（`reviewer_001 ↔ user-002` 本地别名映射已删）。改：用例改钉「收件匹配 = checkerId === 精确 user id；用别名 id 问什么都看不到」。
- `src/components/review/TaskReviewDetail.test.ts` 3：① 测量端点文案原样打 `entityId`（`formatMeasurementSummary` 不再把 DTX 对象 id / refno 归一成 `a/b`）；② `handleResubmit` 只走 `userStore.submitTaskToNextNode`，不再 import `./workflowBridge`（父窗口通知由 ReviewPanel / DesignerCommentHandlingPanel 负责）——用例反转为「桥接方即便声称接管也不许有一次桥接调用」；③ 退回信息卡只剩「退回节点 / 退回原因 + 再次提交」，原「当前单据已回到设计节点，可再次提交。」提示句已删。
- `src/components/DockLayout.test.ts` 3：`embedRoleLanding.resolveExternalFormFocusedLandingTarget` 原样回角色落点、不再把 SJ 强推到 reviewer——SJ + 外部流程 + `form_id` → `landingTarget = 'designer'`、`returnedDesignerTaskPanel = 'review'`；恢复出的任务是规范退回态（`isCanonicalReturnedTask`）才关 initiateReview / DCH、只开 review（落点状态 `primaryPanelId` 记 review，`target` 仍 designer）；单据没匹配到时 DCH 与 review 都不开、落点留 viewer。第三条「按需在三维查看器右侧创建单例文档预览面板」（`close` 期望 1 次实得 3 次）是前两条的连带：它们在 `mounted.unmount()` 之前断言失败，留下两个未卸载的 DockLayout 一起响应了 `FORM-NEXT`——前两条重钉后自绿，本身未改。顺带：该文件索引里原是 CRLF / LF 混排（`git ls-files --eol` = `i/mixed`，44 行裸 LF），这次编辑器统一成 CRLF，原始 diff 因此显得比实际大（实际 +34 / −10）。
- `src/components/review/InitiateReviewPanel.minDeliveryUnit.test.ts` 1：E2E 钩子 `__plant3dInitiateReviewE2E.addMockComponent` 是「无三维选区时注入一条模拟构件」的旁路——`ensureComponentSelected(normalizeReviewDeliveryRefno(ref), name)` 直接按 BRAN 入列，不查 `pdmsGetTypeInfo / pdmsGetUiAttr`、不做最小交付单元归并（归并只在真实「添加构件」路径上，同文件其余用例仍钉着）。改：用例改钉「只做 `a/b → a_b` 字符归一、同 refno 重复注入不重复入列」。

**验证（本轮跑过）**

- 7 文件单跑 **58/58 绿**；全量 vitest **264 文件 / 1977 passed / 0 failed**（HEAD `5ac41df` 是 1977 / 1963 / 14）。
- `npm run type-check`：631 / 基线 631 / 新增 0 / 消失 0；触及 7 个测试文件 eslint 0 错。
- 源码 0 改动、`vitest.config.ts` 未动：`git status` 里除这 7 个测试文件与本文档，只剩别的会话的 `useDbnoInstancesDtxLoader.test.ts` / `useModelGeneration.loadScope.test.ts`（纯 CRLF 归一）与 `docs/issues/mbd-*`，未带进提交。
- §14 顺带发现的两处源码瑕疵（`compareAnnotationSeverity` 注释仍写四档、`PMS_SIMULATOR_CASE_ORDER` 里 `'bran-mixed'` 出现两次）按口径仍**只记不改**。
