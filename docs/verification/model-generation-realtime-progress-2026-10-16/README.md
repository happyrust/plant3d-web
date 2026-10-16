# 「模型生成」实时进度前端实测（WS tasks feed + 节点路径回调，2026-10-16）

验证目标：生成期间前端能看到实时进度——进度条、「正在生成哪个构件」文字、失败计数、事件流状态。

## 环境

| 项 | 值 |
| --- | --- |
| 前端 | `npm run dev`，`http://localhost:3101/?gm_backend_port=9123&output_project=AvevaMarineSample` |
| 后端 | 本机 Node mock（HTTP `:9123` + WS `/api/v1/ws`），回放真实信封序列 `{type,seq,ts,task_id,payload}`：`task_started` → `data_batch_started/finished` → 6× `model_unit_started/finished`（其中 1 个 `success:false`）→ `task_finished` |
| 浏览器 | Chrome DevTools MCP 驱动真实页面 |

## ① 按库任务（`update/execute` → WS 逐单元事件）

操作：模型生成抽屉 →「按库」→ 勾 7997 →「初始化 / 更新所选」。任务卡每秒采样（cardText 为卡片 innerText 末段）：

```
t=0  运行中 · 数据摄入 · data_parse · 0/6            # REST 首拍快照
t=2  应用数据 sesno 301→357                          # WS data_batch_started 提示行
t=3  模型生成 · model_generate · 0/6 · 正在生成 BRAN 24381_101
t=4  模型生成 · model_generate · 1/6 · 正在生成 EQUI 24381_102
t=5  模型生成 · model_generate · 2/6 · 正在生成 BRAN 24381_103
t=6  3/6 · 正在生成 PIPE 24381_104 · 1 个单元生成失败：布尔运算失败：E2 截面退化
t=8  6/6（在飞单元清空，失败行保留）
t=9  已完成 · 房间归属 · task_end · 6/6              # WS task_finished + REST 终态对齐
```

- 卡头「实时」状态点（`model-generation-feed-status`）全程 live；WS 断开会落 `断开` 并自动重连，REST 轮询照常兜底。
- `正在生成 <noun> <refno>` 行只有 WS 能给出——REST `tasks/{id}` 无此明细。

## ② 按节点 / SITE（`generateThenCollect` 本地回调）

操作：「按节点 / SITE」→ 按库选 SITE（7997 → MOCK-SITE-A）→ 加入目标 → 重新生成选中目标。mock 对 SITE 回 `422 container`，前端逐层展开 3 个 BRAN 逐个 `model/generate`。目标 chip 采样：

```
SITE MOCK-SITE-A | 生成中 0/1 | 正在生成 24381_101（1/4）…
SITE MOCK-SITE-A | 生成中 1/4 | 正在生成 24381_102（2/4）…
SITE MOCK-SITE-A | 生成中 2/4 | 正在生成 24381_103（3/4）…
SITE MOCK-SITE-A | 2 实例 | 已生成，可点眼睛加载
```

- chip 内进度条按 `rootsDone/rootsTotal` 走；`onRootStart` 在发出 `model/generate` 前回调，`onRootDone` 回执后回调。
- 完成后 `model/records` 按祖先收回 2 条实例，chip 翻「2 实例」。

## ③ 静态验证

- `npm run lint`：干净（仅 import 顺序一次自动修复）。
- `npm run type-check`：基线外新增错误 0。
- `npx vitest run`（modelRecords / modelRecordSource / useModelGeneration.*）：87 个测试全过。

## 已知边界

- **`dbnum_model_ensure`（读透整库生成）不接 progress_sink**：该路径实测（真后端 8022，dbnum 250705）`state=running` 但 WS 零事件——逐构件明细只有在 `update/execute` 批次管线里有。前端按「WS 是增量、REST 是权威」兜底，不会卡住。
- WS `seq` 空洞 = 丢帧：前端把全部在飞单元清空重建（ADR-0005 口径：断线不编造状态），下一拍 `model_unit_started` / REST 对齐。
- 信封不回放：新任务登记才拉起 feed；`task_started` 若早于握手完成会漏，由 REST 首拍补上 `total_units`/state。
