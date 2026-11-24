# 增量 RVM 校验 · 完善与验证记录（2026-11-07）

接 `incremental-rvm-check-2026-11-05.md`。那一轮把增量重算过的生成根接上了「待校验」角标、批量与自动校验；这一轮修掉在真实数据上用不起来的几处，并在 8022 rocksdb 后端 + dev 3101 上逐项核对。

## 改了什么

| 问题（11-05 版） | 现在 |
| --- | --- |
| 过期按时刻判：结论 `finished_at` 早于批次落地就算过期。后端每重启一次重新初始化，同一会话的批次再落地一次，已核对的根全部重新过期；核对开工后才落地的新会话反而漏判 | 同库按会话号判：结论核对的会话（报告 `sesno`，即核对开工时库文件的最新会话）早于这一轮的 `end_sesno` 才算过期；任一边缺会话号或库号对不上时退回比时刻（`incrementalRvmTargets.ts`） |
| 整库从头生成的批次（`model_only` + `model_start_sesno = 0`、`reinitialize`、全量重建、库第一次摄入）也算「增量」：7726 根全部挂「增量待校验」，模型树上几乎每个交付单元都有角标 | 这类批次是基线：没核对过的根不因它算待校验，只有结论落后于它的根算过期。增量记录上标「整库生成」「未核对 N」，整库核对指向「全部 SITE 依次核对」 |
| SITE 级核对（历史 136 次全是 SITE 级）通过后，子树里的增量根照样挂待校验 | 祖先节点核对**通过**且会话不早于这一轮，子树里的根算核对过（和自己的结论比谁新）。只给自己看来待校验的根查 `/api/v1/tree/ancestors`，按根缓存 |
| 任务来源：每 5 s 拉一次不分种类的 `/tasks?limit=200`；服务端实际封顶 160，`rvm_check` 和数据批次共用这个窗口，实测 160 条里 81 条是 `rvm_check`；响应约 9 MB | 按种类拉（`data_batch` / `model_rebuild` / `room_rebuild` / `dbnum_model_ensure` 各一页），终态任务按 task_id 缓存；之后靠 WS `task_started` / `task_progress` / `task_finished` 逐条补（按 task_id 拉那一条）；WS 在线时数据批次 120 s 兜底对账一次、不在线 30 s 一次，从最新一条翻起，翻到认识的终态任务就停；`rvm_check` 另拉 20 条小页（10 s 一次） |
| 自动校验按批次记账、入队即记完成；队列只在内存，刷新后没跑完的根永远不再自动入队；请求失败的根可能反复入队 | 按根、按轮记账（localStorage `rvm-check-incremental-auto-attempts`）：后端接下过的同一轮不再入队；请求失败最多重试 3 次；被取消的这一轮不再入队；排着队没开跑就刷新的，刷新后接着入队。一轮待校验超过 200 根不自动入队，只在增量记录里提示。祖先链没查到之前先不入队 |
| 发布方式 `unit`（ADR-080 单元级发布）显示成「整根重算」；提示暗示核对覆盖了刚体前移的发布结果 | `unit` 显示「单元级发布」；刚体前移 / 单元级发布的根在提示与增量记录里写明「核对按当前会话整根重新生成后与 E3D 导出比对，不直接检查这条便宜路的发布结果」 |
| 增量记录不认识 `room_rebuild`，「房间」筛选指向已退役的 `room_recalc` | `room_rebuild` / `room_recalc` 都归「房间重算」，`dbnum_model_ensure` 归「整库即时生成」 |

RVM 结果页「增量后过期」按这一份报告自己的会话号判（同一套规则）。

## 已跑

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run type-check` | 当前 0 条 / 基线 0 条 / 新增 0 |
| Lint | `npx eslint <本次改动的 11 个文件>` | No issues found |
| 相关单测 | `npx vitest run src/components/rvm-check src/components/model-tree src/components/increment src/composables/useIncrementalRvmCheck.integration.test.ts src/composables/useGenModelV1UpdateNotice.test.ts src/composables/useGenModelV1TaskFeed.test.ts src/composables/useModelGenerationAdmin.test.ts` | 15 个文件，183 通过 / 1 todo |
| 全量单测 | `npx vitest run` | 451 个文件里 7 个失败（10 条），全在校审模块（`useReviewStore.*`、`ReviewPanel*`、`form-binding`），这些文件在工作区里有他人未提交改动；单独重跑 5 个通过（并发跑时超时），剩 2 条（`useReviewStore.websocket` 订阅用例、`ReviewPanel.componentLinkage` 的 `@/ribbon/commandBus` mock 缺 `onCommand`）与本次改动无关，也不引用本次改动的模块 |

新增 / 改写的用例：`incrementalRvmTargets.test.ts`（会话号判过期、基线识别、按根归拢轮次、祖先覆盖、批次汇总、标注）、`useIncrementalRvmCheck.integration.test.ts`（18 条：四处同步、同会话重跑不过期、核对开工后落地的新会话算过期、基线不列待校验、SITE 通过覆盖 / 不覆盖、`rvm_check` 挤不掉数据批次、WS 在线不整页轮询且 `task_finished` 只拉那一条、WS 不在线对账翻到认识的终态任务就停、自动校验六种情形）。

## 真实数据推导（8022 rocksdb）

`npx vite-node .scratch/incremental-rvm/real-data.ts`：直接调用新的判定函数，读真实 `/api/v1/tasks` 与 `/api/v1/tree/ancestors`。

- `data_batch` 每页 160 条（`has_more = true`），整页 14,119,835 字节；其中带单元的 19 条：基线 16 条（会话 1→435 的 6772 根、1→1139 的 954 根，后端每次重启各落一次），真正的增量 3 条（库 8000 会话 1123、1124、1125→1126，每条 1 根，都是 EQUI `24384/24776`）。
- 窗口里共 7726 个生成根；`rvm_check` 136 条，39 个节点有结论。
- 旧规则（不分种类 160 条混排窗口 9,246,255 字节、按时刻判）：待校验 **7726**。
- 新规则：只看自己的结论待校验的只有 EQUI `24384/24776`（第 1126 轮增量，从没单独核对过）；它的祖先 SITE `/1RX03-EQUI`（`24384/22399`）今天 04:06 核对通过、会话 1139 ≥ 1126，覆盖 → 待校验 **0**。

## 浏览器核对（dev 3101 → 8022）

- RVM 核对独立页（`?page=rvm-check`）：祖先覆盖接上之前，「增量待校验 (1)」，分组「第 1126 轮增量 · 2026/11/4 20:50:31 · 1 根」，行内「EQUI 24384/24776 从未校验」，页脚是新说明；接上之后「增量待校验 (0)」，顶栏不再有待校验计数，整页只查了 1 次祖先链（`/api/v1/tree/ancestors?refno=24384%2F24776`）。
- RVM 核对树展开到 SITE `/1RX03-EQUI` → ZONE `/1RX03-CASE-DQ` → EQUI `/1-LNR-Q005-PJ 24384/24776`：EQUI 行不带角标，SITE 行是通过。
- 请求时间线（页面加载即注入的 fetch / WebSocket 记录器）：
  - 0.6 s 起：`rvm_check` 160 条 658,647 B、`data_batch` 160 条 14,119,835 B、`room_rebuild` 160 条 106,265 B、`dbnum_model_ensure` 5,737 B、`model_rebuild` 29 B，各一次；0.9 s WS 连上，之后没断。
  - 之后每 10 s 一次 `rvm_check&limit=20`（40,860 B）；71.5 s 小种类 `limit=20` 各一次；131.5 s 数据批次兜底对账 `data_batch&limit=1`（230,202 B，翻到认识的终态任务即停）。不再有整页数据批次请求。
  - 时间线中间有整 60 s 的空档：同一页面里一个裸 `setInterval(5s)` 也在 78 s 后停住，`document.hasFocus() = false`——是 Cursor 内置浏览器在页面失焦时把定时器限流，不是同步卡住（空档里没有任何请求挂着）。前台打开的页面不受影响。

## 真实 RVM 核对

（待补：E3D TTY 登录后对增量根 EQUI `24384/24776` 发起一次真实核对。）

## 已知限制

- 核对是「按当前会话把整根重新生成，再和 E3D 导出比对」，验证的是生成器在当前库状态下的结果，不是增量管线这一轮实际发布的记录；刚体前移 / 单元级发布这两条便宜路本身是否等价于整根重算，核对看不到（界面已写明）。
- `/tasks` 每类每页封顶 160 条；首次加载要整窗拉一次数据批次（这份数据约 14 MB，大头是重复落地的整库批次）。要再降，需要后端给列表一个不带单元明细的精简形态。
- 祖先覆盖只认「通过」：祖先不一致 / 种类不一致时分不出差在哪个根上，子树里的根仍按自己的结论判。
