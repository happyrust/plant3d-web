# 版本对比 · gen-model-v1 端到端复验（2026-09-18）

计划：`docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md` §5 A3 出口。
代码：plant3d-web `ec187960`（B + A1）、`961a3ea5`（A3）；gen-model-refactor `ef2284f12`（A2，ADR-081）。
后端：本机 `:8022` 15:32 换成 `d47d747fd` = `codex/model-projection-cache@7bcdd60df` + cherry-pick `ef2284f12`（见 `swap-record-d47d747fd.json`——
不能直接拿 gen-model-refactor 分支头，`:8022` 上别的会话在用的 surface-clearance 四条口径只在 model-projection-cache 那条线上）。
前端：dev `:3111`（别的会话起的 vite，工作树 = `961a3ea5` + 他们未提交的 clearance 文档），浏览器侧 `routeWebSocket` 掐掉 HMR 防中途整页刷新。
脚本：`old\.scratch\mvc-e2e-run.mjs`（Playwright headless chromium，一次性，不入库）。

## 1. 接口（curl 级）

| 请求 | 结果 |
|---|---|
| `GET /api/v1/model/versions?dbnum=8000&refno=24384/26480`（冷） | 200，2.35 s（服务端 2.20 s，release）；EQUI，latest 623；**11 版**：587 delivery → 9 × placement（589–602）→ 604 tombstone；与 09-15 证据文档「新建、挪、DELETE」一致 |
| 同一请求（`24384_26480` 写法） | 200，17 ms，`cached: true` |
| `refno=24384/1` | 404 `REFNO_NOT_FOUND` |
| `dbnum=7997&refno=24384/26480` | 400 `INVALID_REFNO` |
| `since_sesno=999999` | 404 `SESSION_NOT_FOUND` |
| `since_sesno=595&limit=2` | 200，`truncated: true`，`[596, 598]`（前端适配器据此连续拉） |

## 2. 浏览器端到端（两条场景）

入口 URL：`/?model_source=gen-model-v1&gm_backend_port=8022&unit_refno=24384_26480&compare_autorun=1[&compare_a=587&compare_b=602]`

| 检查点 | 场景 ① 缺省最近两版（602 → 604） | 场景 ② `compare_a=587&compare_b=602` |
|---|---|---|
| `compare_autorun` 打开面板（DockLayout） | ✅ | ✅ |
| 版本表（11 条，标签 `sesno · 时刻 · impact_kind`） | ✅ A=602 B=604 自动选中 | ✅ A=587 B=602 按 URL 选中 |
| 对比结果 | 新增 0 / **删除 1** / 修改 0（B 是 tombstone） | 新增 0 / 删除 0 / **修改 1**（BOX 24384/26481 被挪） |
| ViewerPanel（`__modelUnitVersionCompare`） | beforeObjects 1 / afterObjects 0；B 卡「该版本单元已删除」 | beforeObjects 1 / afterObjects 1 |
| 单视口切 A、双视口分屏 | ✅ 「左 A · sesno 602 · 右 B · sesno 604」 | ✅ 两个视口各一只盒子、位置不同（`a587-b602-04-split.png`） |
| 模型树差异模式（§1.4 桥接） | ✅ 「602 → 604 差异模式」，幽灵节点 `24384/26481（已删除）` | ✅ 「587 → 602 差异模式」，修改 1 |
| 关闭对比 | `DELETE /api/v1/model/history/{key}` × **1**（tombstone 侧没生成快照）；差异模式退出 | `DELETE` × **2**；差异模式退出 |
| 请求账 | versions 1 · generate 1 · tasks 1 · query 2 · DELETE 1 | versions 1 · generate 2 · tasks 2 · query 4 · DELETE 2 |
| pageerror | 0 | 0 |
| 控制台 error | 12 / 13 条，全是页面加载期 projects 404 / 401 与被掐掉的 vite websocket——与 11:54 swap 记录里同一批噪音 | 同 |

截图：`latest-two-0[1-5]-*.png`、`a587-b602-0[1-5]-*.png`；原始数据 `*-summary.json`。

## 3. 顺手看到的（不在本次范围）

- ~~幽灵节点回退挂在根上（「1 个变更未能定位到树」）~~ **15:5x 已补**：v1 适配器从 `history/query` 行的 `anc`（自身 → 顶层，打包 refno）拆出逐级
  直接属主表 `ModelVersionGeometry.ownerByRefno`，面板 `buildTreeDiffModels` 把被删节点的 `ownerRefno` 从 A 侧取、B 是 tombstone 时把单元根自己也作为
  deleted 模型给树。同一场景重跑（`ownerref/`）：差异模式「全部 2 / 删除 2」，SITE 1RX03-EQUI → ZONE 1RX03-CASE-DQ 各挂 2，不再有「未能定位」；
  legacy 侧只有 parquet 行的 `owner_refno`（尽力而为）。
- 右侧属性面板对已删除的 24384/26481 报 `not_found (404): dbnum 8000 会话 Some(623) 的索引里没有 24384/26481`——选中幽灵节点后按最新会话读属性，本就读不到；
  底部「属性差异暂不可用 · 锚点缺失（HTTP 404）」是 `ModelTreeAttrDiffPanel` 钉在 legacy `/api/model-history/*`（`:3100` 未起），Q7(ii) 已定不在本计划。
- `environmentLoadedRefnos: 0`：入口 URL 没带 `show_refno`，视口本来就是空的，「最新环境模型」按 Q12 = 已加载模型 = 空；不是缺陷。
