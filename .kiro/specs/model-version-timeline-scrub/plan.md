# 开发计划：模型版本时间轴拖拽浏览

在现有「节点版本」面板上加横向时间轴、单游标浏览、帧缓存与预取、钉 A / B。历史几何走同步 `GET /api/v1/model/history/geometry`，同一个响应返回 `instances` 与 `tubes`。没有新的生成任务、轮询或 `snapshot_key`。旧服务端没有这条路由时，本面板会话退回现有 `loadVersion`（generate → 轮询 → query → DELETE）。

验收以本目录 `requirements.md` 为准，模块划分以 `design.md` 为准。界面对照 `ui/版本管理/version-timeline.pen` 的六帧，但刻度排布以需求为准（见下节），不以稿里按日历疏密的那一版为准。

环境仍是混合时间视图：只有被查的最小交付单元换成历史几何，其余场景保持最新模型。

## 开工前先对齐一处契约

需求已经定了排布规则（`requirements.md`「时间轴排布口径」、Requirement 1 第 2、8、13 条）：

- 刻度按会话链顺序（sesno 从小到大）等距排列，横坐标只由刻度序号决定。
- Session_Time 只做轴上标注、悬停和游标标签。缺时间显示「无时间」。
- 某一版的时间早于链上前一个有时间的版本时，刻度标「时间异常」。
- 缩放以刻度序号为中心，放大下限是可见不少于 5 个刻度（不足 5 行则全部），不是 60 秒。

`design.md` §2.1、§2.3 与属性 1、2、5 曾写着按时间 / 按 sesno 二选一、时间模式最小跨度 60 秒、钉顺序「有时间按时间」；2026-10-29 已改成刻度序号等距、时间异常标记、缩放下限 5 个刻度、钉只按 sesno 排序（见 design.md「设计决策摘要」与 §2.1 / §2.3），与现行需求一致。

- [x] 改 `design.md` §2.1、§2.3 和属性 1、2、5：删掉时间轴模式，改成刻度序号等距、时间异常标记、缩放下限 5 个刻度。属性测试按改后的条文写。（已完成；`tickLayout` / `pins` 的属性测试即按改后条文写）
- [x] `ui/版本管理/version-timeline.pen` 的第 1、4 帧改成等距链序，并补一颗「时间异常」刻度。第 2、3、5、6 帧的交互不用改。（已完成，见 tasks.md 1.1）

设计里另外三处假设直接采用，不再另开讨论：Requirement 8.5 用 404 `NODE_NOT_FOUND` 与 422 `NO_RESOLVABLE_SESSION`；会话链里从未出现的 refno 用 404 `REFNO_NOT_IN_CHAIN`，前端按通用错误显示；游标自己的请求遇到 `HISTORY_BUSY` 按 `Retry-After` 自动重发最多 3 次、等待期间角标保持「正在加载」、用尽后才标失败（Requirement 3.16、design §2.10 `retryOnBusy`）；预取遇忙不标失败，下次停留时重新计划（Requirement 4.11）；子树单元请求同样最多重发 3 次（Requirement 9.10）。

## 阶段 1：gen-model `refactor`（后端）

不在本仓。不发布、不合 `publish`。本地用 rocksdb 档 8022 验证。计算与 Legacy 共用抽出的投影函数，实时路不 `commit`、不 `publish`，所以不增加历史快照数。

- [ ] 在 e3d-model 给子树 DFS 加协作式停止钩子。空钩子的输出与现有 `generate_subtree_with_cache` 逐项相同。
- [ ] 抽出 `project_historical_records`（bake + project）。Legacy 继续 commit；实时路对 `upserts` 按 `record_id` 留最后一条，再 `instance_json` / `tube_json`，去掉 `snapshot_key`。
- [ ] 实时计算不拿 `db_generation_lock`，放进 `spawn_blocking`，用 `CancelToken` 在每个元素处停止。先核实共享网格目录的并发写是否安全；不安全就在验证记录里写明并改成串行写网格。
- [ ] 新建只给历史用的输入缓存，键 `(dbnum, sesno, identity)`，缺省 4 条。不替换当前模型那份输入。
- [ ] `geometryKey` = `g:` + 规范化行的 SHA-256 前 16 字节。规范化时去掉 `snapshot_key` 和 `direct_model.sesno`，按 `(source_refno, id)` 排序。
- [ ] 实现 `GET /api/v1/model/history/geometry`（`sesno` 与 `time` 二选一）、结果缓存、并发闸（缺省 4，满了 503 `HISTORY_BUSY` + `Retry-After`）、`If-None-Match` → 304、`ETag`。
- [ ] 抽出与 `select_session_at` 同一规则的时间解析，供会话链和节点版本表共用。实现 `GET /api/v1/node/versions/resolve`。
- [ ] 实现 `GET /api/v1/element/attributes-at`。不读历史快照，错误码按 Requirement 6.13。
- [ ] `/health.model_cache.realtime_history` 报告条目数、容量、命中、未命中、进行中计算数、并发上限。实时请求不改变 `historical.snapshots`。
- [ ] 属性测试按 `design.md` 属性 27–36（proptest，各 100 次）。共享样例 `docs/fixtures/version-time-resolve-cases.json`，前后端各读一次对拍。
- [ ] 按 `design.md`「阶段 1 后端集成验证」在 8022 上跑 curl：缓存命中字节相同、304、time 与 resolve 的 sesno 一致、错误码、断开后 `in_flight` 回落、快照数不变。
- [ ] `scripts/verify/realtime-history-smoke.ps1`（上一条的 curl 清单）与 `scripts/verify/realtime-vs-legacy.ps1`：BRAN `24384_23257` 与另一个 EQUI 的每个 sesno，实时结果与 Legacy query 去掉 `snapshot_key` 后一致。6 个并行冷查询里能看到 503，且 `in_flight` 不超过 4。两个脚本放 plant3d-web `scripts/verify/`（只调 HTTP，不依赖后端源码），记录写 plant3d-web `docs/verification/`，与 tasks.md Notes 一致。

阶段 1 完成的标志：上述 curl 与等价脚本通过，`cargo test` 通过。前端还没接上也能独立合并进 `refactor`。

## 阶段 2：plant3d-web（前端）

纯函数和组件可以在阶段 1 的路由还没有时先写、先测。接到真实路由、做浏览联调，等阶段 1 在 8022 上可用之后。

### 纯函数

放在 `src/utils/versionScrub/`，无 Vue、无 DOM、无网络。新增 devDependency `fast-check`。属性测试文件 `*.property.test.ts`，标签 `// Feature: model-version-timeline-scrub, Property N: …`，各 100 次。

- [ ] `tickLayout.ts`：链序等距、簇（间距 &lt; 4px）、点击簇的视口、滚轮缩放（下限 5 个刻度）、五态配色（`noop` 空心）、时间异常标记。属性 1、2、3、5。
- [ ] `scrubFormat.ts`：悬停与游标标签，缺字段写「—」，缺时间写「无时间」，时间异常写进游标标注。属性 4。
- [ ] `cursorNav.ts`：吸附、方向键、点簇取 sesno 最大、初始游标为最大 sesno、「只看几何变的」迁移。属性 7、8、9、10。
- [ ] `dwellGate.ts`：拖动 150ms 才触发，方向键 / 点击 / 松开不经这道门。属性 11。
- [ ] `pins.ts`：A 不晚于 B（按 sesno），同一 sesno 拒绝，与上一版比 / 与最新比。属性 19、20。
- [ ] `frameCache.ts`：最多 12 个键，保护当前帧和 A/B 钉，同 `geometryKey` 只留一份几何。属性 14。
- [ ] `prefetchPlan.ts`：前后各 2 版、游标请求进行中不新开预取、并发预取 ≤ 2、游标移走时重分配。属性 16、17。
- [ ] `timeResolve.ts`：与后端同一规则，供时间解析路由 404/405 时降级。属性 27、28、29 的前端部分。
- [ ] `scrubUrl.ts`：`unit_refno`、`scope`、`cursor`、有钉才写 `compare_a` / `compare_b`，保留 `gm_backend` 等其余参数。属性 24、25、26。
- [ ] `subtreeFramePlan.ts`：超过成本阈值或 20 个单元则确认；「变化最大」按变化构件数降序、refno 升序。属性 22、23。
- [ ] `compareModelUnitGeometry(x, x)` 全是「未变」。属性 21。

### 接线

- [ ] `versionSource.ts` 增加 `queryHistoryGeometry`、`attributesAtSesno`、`resolveNodeTime`。200 / 304 / 带错误码的 404 / 无码 404 / 405 / 503 / 网络错误 / 超时各有一例。只有无码 404 和 405 抛 `ModelVersionRouteUnavailableError`。
- [ ] `useVersionScrubber.ts` 吃现有 `useNodeVersionTimeline` 的 `rows`，不另取版本表。切范围保留游标和钉的 sesno。属性 6。
- [ ] `useNodeVersionTimeline.ts` 增加 `setPins`，允许一端为 null。`pairReady` 不变，所以只有一钉时「对比 A / B」禁用。
- [ ] `useVersionFrames.ts`：只装当前游标的帧；相同 `geometryKey` 只改角标；304 与已装入帧共享几何；退出时中止请求并清空缓存。Legacy 降级时才删除本会话的 `snapshot_key`。属性 12、15、18。
- [ ] `modelUnitCompareController` 增加 `browseEnter` / `browseShow` / `browsePending` / `browseMissing` / `browseBadge` / `replaceSide` / `browseExit`。复用 A 侧隔离图层。进入后第一帧 `fitToBox`，之后不改相机。属性 13，并补例子：只隐藏该单元、叶子只高亮自身、`replaceSide` 不重建另一侧。

### 界面

挂到 `ModelUnitVersionComparePanel.vue`，纵向列表保留。`model/versions` 路由不存在时不渲染时间轴，沿用现有错误文案。

- [ ] `VersionTimelineScrubber.vue`：SVG 轴、图例、簇、游标、A/B 钉、悬停、日期框、浏览 / 钉住 / 对比 / 与上一版比 / 与最新比 / 清除钉 / 复制链接 / 只看几何变的。拖动用 `setPointerCapture`，指针事件每帧最多吸附一次。例子测试覆盖空表、版本表失败与重试、时间异常、图例、区域外松开、日期错误、按钮禁用、剪贴板失败。
- [ ] 浏览：点「浏览」后装当前游标那一帧，角标「浏览 · sesno …」。拖动停满 150ms 才请求；松开、点击、方向键立即请求。加载中保留上一帧，角标「正在加载 sesno N」。
- [ ] 单钉：以钉为参照、游标为比较侧，用现有四态着色。双钉后点「对比 A / B」走现有 `open`；拖某一侧的钉只换那一侧。清除钉回到不着色的浏览。
- [ ] 点隔离图层里的构件，属性横幅「属性来自 sesno N」，游标移动后重取。Legacy 降级时仍走快照上的 `attributesAt`。
- [ ] 纵向列表跟随游标高亮；行在折叠段里就先展开再滚到可见。
- [ ] 子树：`node/diff-summary` 列出变了的单元。超过 20 个或成本阈值时弹出「全部加载 / 先装变化最大的 20 个 / 取消」。取消不发请求，角标「sesno N 未加载（已取消）」。
- [ ] URL 带 `cursor` 时：打开节点、切范围、放游标、恢复钉、进入浏览。非法 `scope` 或 `cursor` 不进浏览。`compare_a` / `compare_b` 无效只忽略该钉。现有 `compare_autorun` 用例保持通过。
- [ ] 实时路由 404/405：底部持续显示「服务端没有实时历史查询，改用逐版生成」，本面板会话改走 `loadVersion`。其它 HTTP 错误和网络错误不降级。

阶段 2 完成的标志：`npm run type-check` 不新增基线外错误，`npm run lint` 与 `npm test` 通过。不跑审核面板那五套回归。

## 阶段 3：联调与性能

前端接 8022 的 rocksdb 档。Playwright 脚本 `e2e/version-scrub-perf.spec.ts` 只手动跑，不进 CI。被测 BRAN `24384_23257` 至少 25 个版本、其中至少 5 个几何有变化；不够就换 BRAN 并写明。

- [ ] 缓存已有前后各 2 版时，方向键 20 次，每次从按键到首帧和角标更新 ≤ 300ms。
- [ ] 服务端结果缓存已热、前端缓存是空的，方向键 10 次，每次 ≤ 500ms。
- [ ] 服务端缓存容量 0、前端缓存是空的，方向键 10 次，每次 ≤ 2s。
- [ ] 移到几何相同的「仅属性」会话，收到 304，角标在 200ms 内更新，测 10 次。
- [ ] 3–5 秒内拖过 30 个刻度，每个 1 秒窗口 ≥ 30fps，吸附后 100ms 内更新游标标签。
- [ ] 浏览连续 10 分钟：前端缓存键数 ≤ 12，`in_flight` 不超过并发上限，结果缓存不超过容量，历史快照数等于开始时的值。退出后 1 秒内前端进行中的请求为 0，5 秒内 `in_flight` 回到初值。
- [ ] 500 行版本表首次渲染 ≤ 500ms。
- [ ] 每条记下命令、节点、sesno 序列、每次耗时和通过与否，写入 `docs/verification/`。

## 不做

- 不把整个库拨回某一天，也不同时看三版以上。
- 不改 Legacy 路径的快照淘汰策略。降级只是调用它，然后删掉本会话创建的键。
- 不实现已废弃的 `specs/004-model-version-timeline/`。
- 不把性能脚本放进 CI。
- 后端验证通过后只合入 gen-model `refactor`，不在本计划里部署。
