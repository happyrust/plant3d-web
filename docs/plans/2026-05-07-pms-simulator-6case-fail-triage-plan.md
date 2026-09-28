# 仿 PMS 全 6 case 回归全失败 · 诊断与修复开发方案

> 日期：2026-05-07  
> 状态：待评审  
> 关联进度：task="仿 PMS 本地调试 6 case regression"  
> 关联文档：`docs/plans/2026-05-07-return-stop-scenario-fix-plan.md`（前一轮 return/stop 修复，已闭环）

---

## 0. 一句话定位

`npm run test:pms:simulator` 全 6 case 失败：approved 卡在 plant3d "嵌入链接校验失败 / Failed to fetch"，后续 return/stop/restore/gate-block/gate-return 5 case 全部 `ERR_CONNECTION_REFUSED`（vite 中途挂掉）。

---

## 1. 问题概述

### 1.1 本次执行结果

| Phase | 结果 |
|---|---|
| Contract smoke（auth/embed/seed/verify/sync/cache/delete）| **7/7 PASS** |
| `approved` | FAIL — 超时未找到 `[data-testid=designer-landing-workspace]` |
| `return` / `stop` / `restore` / `gate-block` / `gate-return` | FAIL — `page.goto: net::ERR_CONNECTION_REFUSED` |

### 1.2 与上轮 6/6 PASS 的差异

| 维度 | 上轮（progress 存档） | 本轮 |
|---|---|---|
| `npm run test:pms:simulator` 结果 | 6/6 PASS | 6/0 FAIL |
| frontend dev server | 健康 | approved 中途挂 |
| approved 失败点 | —— | iframe `Server Error` + `Failed to fetch` |
| 是否有 working tree 改动 | 已提交闭环 | 6 文件未提交（见 §2.2） |

---

## 2. 现场证据

### 2.1 关键截图（已落档）

`artifacts/pms-simulator-artifacts/pms-simulator-artifacts/screenshots/approved-page-1.png`：

- 仿 PMS simulator 已打开 `form_id=FORM-F18A76610435` 编辑窗口
- 内嵌 iframe 顶部红条：**"嵌入链接校验失败：认证请求异常 Server Error"**
- iframe 中央：**"三维查看器初始化失败 Failed to fetch"**
- 右侧诊断面板显示 `task_id=--`、`current_node=--`，说明流程节点尚未推进

### 2.2 当前 working tree（6 个未提交修改）

| 文件 | 改动概要 |
|---|---|
| `pms-review-simulator.html` | 新增"全屏 / 应用全屏"按钮；side-panel 折叠/展开；`#simulator-layout` id |
| `src/debug/pmsReviewSimulator.ts` | `openIframe(skipIframeSrc?: boolean)` 与 `SimulatorTestApi.openByFormId(skipIframeSrc?)` |
| `src/debug/pmsReviewSimulatorState.ts` | 新增 `WorkflowVerifyDiagnostics` + `summarizeWorkflowVerifyDiagnostics()` |
| `src/components/dock_panels/ViewerPanel.vue` | ESC 行为重构：抽出 `isAnnotationToolMode` / `isClassicMeasureToolMode`；ESC 退 classic measure 时补 `setToolMode('none')` |
| `src/components/review/DesignerCommentHandlingPanel.vue` | 列表容器加 `data-testid="designer-comment-annotation-list"` |
| `src/components/review/InitiateReviewPanel.vue` | E2E API 暴露 `submit()` |

直觉：以上修改都不应直接破坏 `embed-url 认证` 或 `三维查看器初始化 fetch`。但存在间接影响的可能（dev-time HMR 状态、依赖重新解析等）。

### 2.3 进程清单（探测时刻）

| PID | 进程 | 端口 | 备注 |
|---|---|---|---|
| 27540 | web_server.exe | 3100 LISTEN | 用户先前手动启的 backend，存活至本轮 |
| 75084 | surreal.exe | 8020 LISTEN | 同上 |
| —— | node.exe (vite) | 3101 ❌ | 跑到 approved 中途挂掉 |

### 2.4 日志异象

- `artifacts/pms-simulator-artifacts/frontend.log` **0 字节** → bootstrap 启动时 `isUrlHealthy(simulatorUrl) === true`，认为 vite 已就绪，自身没启 vite，因此没接管它的 stdout/stderr。挂之后没有重启逻辑兜底
- `artifacts/pms-simulator-artifacts/backend.log` 最后停在 `17:06:58` —— 同理，bootstrap 复用已存在的 backend 进程，没接管输出
- `pms-simulator-report.json::environment.frontendAutoStarted=false`、`backendAutoStarted=false` —— 与上面一致

### 2.5 contract smoke 7/7 PASS 的含义

后端核心契约链路（auth/embed/seed/verify/sync/cache/delete）全部 HTTP 200，`form_id=FORM-7152538F9605` 创建并清理成功。**这表明 backend + Surreal 在跑且数据库正常**，问题更可能在：

- 前端 vite dev server 稳定性
- 嵌入页面（`/review/3d-view?...`）首屏调用的某个**非契约链路接口**返回 5xx 或被 vite 中转出错

---

## 3. 假设清单（按可能性排序）

### H1（高）：vite dev server 中途挂掉，触发"嵌入认证 fetch"失败

证据：
- frontend.log 0 字节 → bootstrap 没接管 stdout，看不到 vite 自己的崩溃信息
- approved-page-1.png 的 "Failed to fetch" 文案与 vite 失联表现一致
- 后续 5 case 100% `ERR_CONNECTION_REFUSED` 是直接证据
- `node.exe` 进程列表里数百个 worker，没有任何一个监听 3101

可能触发：
- 上轮 PASS 后用户自己改了 6 文件，HMR 链路某次失败导致 vite worker 卡死
- approved case 的 Playwright 多 page 同时操作（仿 PMS 主页 + plant3d 子页）造成模块解析竞争
- 内存压力（系统大量 node 进程残留）

### H2（中）：plant3d 嵌入页首屏调一个非契约接口失败

`/review/3d-view?...` 加载后会调多个非 PMS 契约的内部接口（如 `/api/auth/verify`、`/api/review/embed-context`、`/files/...` 静态模型资源等）。如果某个返 5xx，UI 就会显示"嵌入链接校验失败"。

证据：
- contract smoke 用 `output_project=AvevaMarineSample` 通过，但 plant3d UI 渲染可能依赖不同 endpoint
- 模型资源（GLB/parquet）走 `/files`，路径配置出错也会触发 `Failed to fetch`

### H3（中）：working tree 6 改动间接破坏

候选嫌疑：
- `pmsReviewSimulator.ts` 新增 `skipIframeSrc` 路径未被默认覆盖，可能首次打开 iframe 时 `src` 没设置，导致空白页
- `pmsReviewSimulatorState.ts` 新增 `lastDiagnostics` 字段未在某处初始化兼容旧 snapshot

但这两个都不应导致 plant3d 内部"认证请求异常"。

### H4（低）：Surreal WS 局部失稳

`backend.log` 17:04 已有 `校审数据库上下文切换超时` + `Failed to send query results to channel`。本轮 contract smoke 7/7 PASS 但 plant3d UI 路径可能命中另一个 SurrealDB 操作。

---

## 4. 候选方案对比

### 方案 A：先抓现场，再决修法（推荐）

**步骤**：
1. 杀掉残留 vite/node 进程，腾出 3101
2. 直接 `npm run dev` 启动一个**前台 vite**，stdout/stderr 完整可见
3. 用 cursor-app-control（或手动）打开 plant3d 嵌入 URL，开 DevTools 看 console error + network panel
4. 定位"嵌入链接校验失败"的具体 5xx 接口与"Failed to fetch"的具体 URL
5. 根据现场决定是修 backend、修 dev server 配置、还是回滚 working tree 改动

**优点**：直击根因，避免盲修。  
**缺点**：需要交互式 chromium。

### 方案 B：git stash 6 改动后回归

**步骤**：
1. `git stash push` 把 6 改动暂存
2. 重跑 `npm run test:pms:simulator`
3. 若 6/6 PASS → 确认是 working tree 引起，逐文件 pop 二分定位
4. 若仍 FAIL → 问题与 working tree 无关，转方案 A

**优点**：自动化、客观、能彻底排除"改动嫌疑"。  
**缺点**：每轮 ~5 分钟，二分最坏 4 轮 = 20 分钟，且仍可能落到方案 A。

### 方案 C：bootstrap 接管 vite 输出

**步骤**：改 `scripts/pms-simulator-bootstrap.ts::ensureFrontend` 里 `isUrlHealthy(simulatorUrl)` 之后，仍然 spawn vite 并 attach 到现有端口（不可行）；或更现实：默认行为改为**先 kill 现有 vite 再启**，以保证 stdout/stderr 受脚本管理。

**优点**：未来类似事故能自动收日志。  
**缺点**：本轮根因还在，并不能直接修复 6 case，只是观测能力升级。

### 推荐顺序

**A（5–10 分钟）→ 必要时切 B（10–20 分钟）→ 最后做 C（30 分钟，工具化沉淀）**

A 先做，因为：
- 我们已有 `approved-page-1.png` 这一份强力线索，浏览器现场看 Network 一击即中的概率高
- B 只回答"是不是 working tree 引起"，A 能更快回答"问题到底是什么"
- C 是基础设施改进，应在根因清楚后做，避免改 bootstrap 又顺手破坏其他 case

---

## 5. 推荐方案 A 详细任务拆解

### S1. 环境隔离（5 min）

- [ ] **S1.1** `tasklist | findstr node` 抓出所有遗留 node 进程；`taskkill /PID … /F` 杀 vite 占位进程（保留 web_server / surreal / cursor 自身需要的 node）
- [ ] **S1.2** `netstat -ano | findstr ":3101"` 确认 3101 已释放
- [ ] **S1.3** 复核 `web_server.exe (PID 27540)` 健康：`curl http://127.0.0.1:3100/api/health`

退出条件：3101 无监听 + backend `/api/health` 200。

### S2. 前台启 vite + 抓现场（10 min）

- [ ] **S2.1** 在工程根 `npm run dev`（前台），等 `Local: http://127.0.0.1:3101/` 打印
- [ ] **S2.2** 打开浏览器（cursor-app-control 或手动 chromium），开 DevTools，访问：
      `http://127.0.0.1:3101/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=AvevaMarineSample`
- [ ] **S2.3** 切到"PMS 用户=SJ + 项目=AvevaMarineSample"，点新增；等 iframe 加载
- [ ] **S2.4** Network 面板筛选 `xhr`+`fetch`，逐个看 status：
      - 期望：3100 上的 `auth/token` `embed-url` `review/embed-context` 200
      - 抓到 ≠2xx 的接口，记 url + payload + response body
- [ ] **S2.5** Console 抓"嵌入链接校验失败"的来源，定位前端调用栈

退出条件：拿到 1 条具体失败接口（含 url + status + 响应 body）。

### S3. 根因分支决策（5 min）

依 S2.5 的失败接口选支线：

| 失败位置 | 走支线 |
|---|---|
| `/api/auth/verify` 等 PMS 契约接口 5xx | T1：backend 修复 |
| `/files/*.glb` `/files/*.parquet` 等静态资源 4xx/5xx | T2：vite proxy 或 backend `/files` 检查 |
| 来自 vite dev server 内部 `transform` 报错 | T3：dev server 模块解析（可能与 working tree 改动相关） |
| 直接 `Failed to fetch` 无 5xx（network 层断开） | T4：vite worker 异常 / dev server 超时 |

### S4. 修复实施（15 min，按 S3 选择）

- **T1（backend 修复）**：依失败接口走 rs-core 仓修；`docs/plans/2026-05-07-return-stop-scenario-fix-plan.md` §4 已铺底备选方案 A/B/C，可参考
- **T2（静态资源）**：检查 `vite.config.ts::server.proxy['/files']` 是否被工程改动破坏；用 `curl http://127.0.0.1:3101/files/<sample>` 直查
- **T3（HMR 解析）**：把 6 改动暂时 stash，重启 vite 复测；若恢复则二分回 working tree
- **T4（vite 异常）**：升级 dev server 退避策略；查 `node --inspect` 或 `vite --debug` stdout

### S5. 重跑回归 + 验证（10 min）

- [ ] **S5.1** `npm run test:pms:simulator`（依然让脚本 spawn 自己的 vite，但要确认 `frontend.log` 这次有内容）
- [ ] **S5.2** 期望产出：`pms-simulator-report.json::scenarios[*].ok = true`
- [ ] **S5.3** 失败时把 `frontend.log` / `backend.log` / 截图一并归档到本计划的 §6

### S6. 回退路径

任一步发现修复风险高（影响生产代码且不能局部隔离），立即：
- 切方案 B 走"git stash 6 改动 + 回归对比"，把 working tree 改动当独立工作流处理（独立 PR / 独立 plan）
- 把 vite 中途挂的现象记为已知缺陷，单独写方案 C 的工具化升级

---

## 6. 风险登记

| ID | 风险 | 触发概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | DevTools 抓 Network 时 Playwright/cursor-app-control 与 chromium 抢端口 | 中 | A 阶段卡 | 用普通 chromium，不挂 Playwright |
| R2 | 修 backend 引入新 contract 不一致 | 低 | 触发上一轮已修的 return/stop 链路回退 | 修后必跑 contract smoke 与 6 case |
| R3 | working tree 6 改动里仅 1 个是无害 dead-code，stash 比对结论歧义 | 低 | B 路径无效 | A 拿到具体接口失败可独立证伪 |
| R4 | bootstrap.ts spawn 不接管输出，未来再翻车看不到 vite log | 高 | 重复事故 | 完成方案 C |

---

## 7. 决策检查点（人在环上）

| 节点 | 何时上汇 | 决策项 |
|---|---|---|
| S2.5 完成 | 拿到失败接口后 | 选 T1/T2/T3/T4 哪个支线 |
| S4 完成 | 修复合上 | 是否立即跑 S5 回归，或先 commit 再跑 |
| S5 失败 | 修后仍未 6/6 PASS | 是否切方案 B 二分 working tree |

---

## 8. 不做的事（YAGNI）

- 不动 simulator HTML 已有的全屏 / 折叠新功能（这些是改进，不是引入失败的嫌疑）
- 不为本次诊断单独写 unit test / playwright spec（CLI + 真实接口验证已足够，AGENTS.md 也明确不要为联调写一次性测试）
- 不动 rs-core 的 SurrealDB 上下文切换（除非 S2.5 直接定位到 `/api/review/workflow/sync` 或 `embed-url` 5xx）
- 不试图把 `frontendAutoStarted=false` 的诊断逻辑塞进 bootstrap.ts（方案 C 单独做）

---

## 9. 关联文件

```
d:/work/plant-code/plant3d-web/
├── pms-review-simulator.html
├── scripts/
│   ├── pms-simulator-bootstrap.ts            # 启动编排，本次 ensureFrontend 假阳性
│   ├── pms-simulator-runner.ts               # 6 case scenario 实现
│   ├── pms-plant3d-initiate-flow.ts          # waitForReviewerWorkbenchAcrossContext()
│   └── pms-contract-sequence.ts              # 7/7 PASS 的契约链路
├── src/
│   ├── components/review/InitiateReviewPanel.vue   # designer-landing-workspace 在 line 912
│   ├── components/review/DesignerCommentHandlingPanel.vue
│   ├── components/dock_panels/ViewerPanel.vue
│   └── debug/
│       ├── pmsReviewSimulator.ts              # openIframe(skipIframeSrc?)
│       ├── pmsReviewSimulatorState.ts         # WorkflowVerifyDiagnostics
│       └── pmsSimulatorAutomation.ts          # PMS_SIMULATOR_CASE_ORDER
└── artifacts/pms-simulator-artifacts/
    ├── frontend.log                           # 0 字节（关键）
    ├── backend.log                            # 17:06 截止（关键）
    ├── pms-simulator-report.json
    └── pms-simulator-artifacts/screenshots/
        ├── approved-page-1.png                # 失败现场强证据
        └── approved-pages.json
```

---

## 10. 下一步动作

**立即执行**：S1 → S2，目标产出 §3 假设清单的最终选定 H1/H2/H3/H4，并把失败接口写入本文件的更新条目。

**评审请关注**：

1. 是否同意"先抓现场（A）→ 必要时回归对比（B）→ 再做基础设施（C）"的顺序
2. 抓现场用 cursor-app-control 还是直接打开本机 Chrome（用户偏好）
3. 若根因落到 backend，是否允许在 plant-model-gen 仓做改动（与 rs-core 同步规则需确认）

---

## 11. 执行结果（2026-05-07 02:27，方案 A 落地）

### 11.1 现场抓取与定位

- **S1**：3101 已无监听、`backend /api/health=200`，环境隔离 OK
- **S2**：前台 `npm run dev` 启动 vite v7.2.7（ready 319ms），随即报：
      ```
      02:22:53 [vite] http proxy error: /api/projects
      Error: socket hang up
      ```
- **S2 直探后端**：
      - `curl -m 15 http://127.0.0.1:3100/api/projects` → `(52) Empty reply from server`，code=000，0.006s
      - `curl http://127.0.0.1:3101/api/projects` → 500（vite proxy 把 socket hang up 翻译成 5xx）
      - 同期 `/api/health=200` → backend 进程活、个别 handler hang

### 11.2 根因确认

**SurrealDB WS 全局单例 OnceCell 的连接 idle 后被远端关闭，`project_primary_db().query(sql).await` 永久 hang，handler 不返回 → axum 不发 response → curl 52 / vite proxy socket hang up。**

证据链：

| # | 证据 | 来源 |
|---|---|---|
| 1 | 旧 backend (PID 27540) 已跑 ≥ 1.5 小时 | `tasklist` |
| 2 | `backend.log` 17:05 已记录 `校审数据库上下文切换超时` 与 `Failed to send query results to channel: SendError(..)` | `artifacts/pms-simulator-artifacts/backend.log:714,723` |
| 3 | 17:06 后无日志 = backend idle | 同上 |
| 4 | `/api/health` 不查 SurrealDB → 200；`/api/auth/token` 走 JWT → 200；`/api/projects` 必查 `project_primary_db` → hang | handlers.rs:436-577 |
| 5 | 重启 backend 后 `/api/projects=200, 9ms, 4 项目` | curl |
| 6 | 重启后重跑 simulator 6/6 PASS, 84s | `artifacts/pms-simulator-report.json` |

### 11.3 方案选择

落点是 **§5 S3 决策表**中的 T1（backend 修复）但**仅短期**：直接重启 backend 即恢复，本轮 PMS regression 已闭环。

**没有走的支线**：
- ~~T2 vite proxy /files~~：未触发，证据显示问题在 backend
- ~~T3 working tree 6 改动 stash~~：6/6 PASS 反证 working tree 无关
- ~~T4 vite worker 异常~~：vite ready 后稳定，是 proxy 透传 backend hang

### 11.4 6 case 通过详情

| case | status | final node | form_id | 含义 |
|---|---|---|---|---|
| approved | approved | pz | FORM-B17B65870EB0 | 主链通过到 pz 批准 |
| return | draft | sj | FORM-C02A98F3CBC7 | 驳回回到 sj |
| stop | cancelled | jd | FORM-6857D11E73D2 | 终止于 jd |
| restore | submitted | jd | FORM-BAFA8E0C3555 | 校核刷新恢复 jd |
| gate-block | submitted | jd | FORM-C4C124EB3963 | 注释门禁阻塞 |
| gate-return | in_review | sh | FORM-8A83E14037FB | 注释门禁驳回到 sh |

### 11.5 长期改进 backlog（不在本任务 scope）

写到 backlog，等单独立项：

- **B1**（rs-core / aios-database）：`project_primary_db` / `review_primary_db` 等 OnceCell 连接加 **idle 检测 + 自动重连**；或迁到连接池
- **B2**（rs-core）：所有 `surrealdb::query.await` 调用必须显式 `tokio::time::timeout()` 包裹，避免 handler 永 hang，给客户端可用的 5xx
- **B3**（plant3d-web）：`scripts/pms-simulator-bootstrap.ts::ensureFrontend`、`ensureBackend` 不复用既有进程，每次 PMS regression 默认 fresh restart（或加"健康嗅探序列"判定 idle SurrealDB）
- **B4**（plant3d-web）：bootstrap.ts 当 `frontendAutoStarted=false` 时也尝试 `pm tail` 既有 vite 控制台到 `frontend.log`（事故复盘可视性）
- **B5**（rs-core）：`api_get_projects` 内 `Err(_) => {}` 改成 `Err(e) => warn!(...)`，避免吞错

### 11.6 不留尾巴

- working tree 6 改动确认与本失败无关，可按原计划继续走
- 旧 backend (PID 27540) 已被 taskkill；新 backend (PID 56592) 在 3100 LISTEN，状态健康
- 旧 surreal (PID 75084) 复用为 8020，新 backend 自启的第二份 surreal (PID 93400) 端口冲突自然退出
- artifacts/pms-simulator-report.json 已被 18:27 跑覆盖为 6/6 PASS 的最新结果

