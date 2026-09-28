# RUS-238 推送后开发方案 Progress

## 2026-04-30 · 初始化 planning-with-files

已完成：

- 创建 `task_plan.md`，拆分验收输入、本地验收、批注/确认回放验收、PMS/编校审验收、二次开发判断和工作区收敛。
- 创建 `findings.md`，记录已确认事实、阻塞、风险和决策。
- 创建 `rus-238-post-push-flow.html`，用自包含 HTML/SVG 展示推送后开发与验收流程。
- 在 `task_plan.md` 中补充流程图链接。

当前状态：

- 代码提交已推送：`0819772 feat(measurement): 展示测量完整路径`。
- 真实验收未开始，等待外部输入。

下一步：

- 等待目标 BRAN、PMS 包名/任务单、角色和入口后，进入 Phase 1。

## 验收记录模板

| 项 | 记录 |
| --- | --- |
| BRAN | 待填写 |
| 包名 / 任务单 | 待填写 |
| 角色 | 待填写 |
| 入口 | 待填写 |
| 测量类型 | 待填写 |
| 测量列表展示 | 待填写 |
| 批注证据展示 | 待填写 |
| 确认回放展示 | 待填写 |
| 是否 fallback | 待填写 |
| 截图 / 录屏 | 待填写 |

## 2026-04-30 · 仿 PMS approved 主链验收

命令：

```bash
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=approved PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-238-post-push-approved-report.json npm run test:pms:simulator
```

结果：

- 契约烟测：通过，7/7。
- 仿 PMS 自动化：通过。
- 注入 BRAN：`24381_145018`。
- package：`SIM-APPROVED-1777533677538`。
- form：`FORM-1B27FE318DE6`。
- task：`task-8a2ae0c9-0c83-4662-938e-72f2841db666`。
- 流程：`SJ active -> JH agree -> SH agree -> PZ agree`。
- 最终状态：`approved`。
- 最终节点：`pz`。
- 报告：`artifacts/rus-238-post-push-approved-report.json`。

2026-04-30 复跑：

- 命令：`PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=approved PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-238-post-push-approved-rerun-report.json npm run test:pms:simulator`
- 契约烟测：通过，7/7。
- 仿 PMS 自动化：通过。
- package：`SIM-APPROVED-1777544306641`。
- form：`FORM-F098FFEEEB31`。
- task：`task-6293a343-62c9-497f-acc6-e356cedd02c7`。
- 流程：`SJ active -> JH agree -> SH agree -> PZ agree`。
- 最终状态：`approved`。
- 最终节点：`pz`。
- 报告：`artifacts/rus-238-post-push-approved-rerun-report.json`。

结论：

- 仿 PMS 主链在目标 BRAN `24381_145018` 下通过。
- 该场景证明 PMS 外部流程的主链流转可用，但不覆盖确认测量回放。

## 2026-04-30 · 仿 PMS restore 刷新恢复验收

命令：

```bash
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-238-post-push-restore-report.json npm run test:pms:simulator
```

结果：

- 契约烟测：通过，7/7。
- 仿 PMS 自动化：失败。
- form：`FORM-F29E5A3D35E3`。
- task：`task-d070e2e3-93e1-41cd-bb06-a7685339b958`。
- 通过断言：
  - `restore-task-contains-bran-24381_145018`
  - `restore-before-annotation`
  - `restore-before-measurement`
  - `restore-before-confirmed-record`
  - `restore-before-confirmed-measurement`
  - `restore-ui-bran-refno`
  - `restore-comment-content-after-refresh`
- 失败断言：
  - `restore-ui-comment-content`，刷新前 UI 未找到评论内容，detail 为 `title_found=true comment_found=false bran_found=true`。
- 报告：`artifacts/rus-238-post-push-restore-report.json`。

结论：

- 与 RUS-238 相关的 BRAN、测量、确认记录读回和 UI BRAN 可见性均通过。
- 场景整体失败来自评论内容刷新前展示时机，当前判断不是测量路径展示失败。

## 2026-04-30 · Obscura 安装与页面 smoke

安装：

```bash
gh release download v0.1.1 --repo h4ckf0r0day/obscura --pattern "obscura-aarch64-macos.tar.gz" --dir ".tmp/obscura-bin" --clobber
shasum -a 256 ".tmp/obscura-bin/obscura-aarch64-macos.tar.gz"
tar -xzf ".tmp/obscura-bin/obscura-aarch64-macos.tar.gz" -C ".tmp/obscura-bin"
```

结果：

- 安装路径：`.tmp/obscura-bin/obscura`。
- 版本包：`v0.1.1` / `obscura-aarch64-macos.tar.gz`。
- sha256：`8ceddcc4bc31bad8237fc6e0e44f5ac82a1467ae40fa8ff9af66dd086fd891ab`，与 GitHub release asset digest 一致。
- `https://example.com` smoke：返回 `Example Domain`。

本地仿 PMS 测试：

```bash
.tmp/obscura-bin/obscura fetch "http://127.0.0.1:3101/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=AvevaMarineSample" --eval "document.title"
```

结果：

- 失败：Obscura 拦截本地地址，报错 `Access to private/internal IP address 127.0.0.1 is not allowed`。
- 当前 `fetch` / `serve` help 未提供允许 localhost 的参数。

本地 LAN IP 测试：

```bash
LOCAL_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || true)
.tmp/obscura-bin/obscura fetch "http://${LOCAL_IP}:3101/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=AvevaMarineSample" --eval "document.title"
curl -sS -o /dev/null -w "http_code=%{http_code} content_type=%{content_type} url=%{url_effective}\n" "http://${LOCAL_IP}:3101/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=AvevaMarineSample"
```

结果：

- 本机 LAN IP：`192.168.31.22`。
- Obscura 失败：`Access to private/internal IP address 192.168.31.22 is not allowed`。
- 普通 HTTP 请求成功：`http_code=200 content_type=text/html`。
- 结论：本地 IP 入口可达，失败来自 Obscura 私网地址拦截。

公网仿 PMS smoke：

```bash
.tmp/obscura-bin/obscura fetch "http://123.57.182.243/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=AvevaMarineSample" --eval "JSON.stringify({title: document.title, app: !!document.querySelector('#app'), bodyLen: document.body?.innerText?.length || 0})"
```

结果：

- 成功访问页面，title 为 `plant3d-web - 3D 模型查看`。
- DOM 有 `#app`。
- `bodyLen=10`，`#app` 未挂载出 Vue 内容。

Obscura CDP smoke：

- 启动 `.tmp/obscura-bin/obscura serve --port 9334`。
- 使用 Playwright `chromium.connectOverCDP('ws://127.0.0.1:9334/devtools/browser')` 访问公网仿 PMS 页面。
- 结果与 `fetch` 一致：能拿到 title 和 `#app`，但 `#app` 为空。

结论：

- Obscura 已安装可用，公共静态页面 smoke 通过。
- 当前 Obscura v0.1.1 不能直接访问 localhost，且对当前 plant3d-web/Vite/Vue 公网页面未能完成 SPA 挂载。
- 因此 Obscura 只能作为本轮页面可达性 smoke，不足以替代 Playwright/PMS simulator 的业务验收。

## 2026-04-30 · Chrome CDP full 真实入口验收

命令：

```bash
PMS_E2E_PASSWORD='Admin@1234' PMS_EMBEDDED_SITE_SUBSTRING='123.57.182.243' PMS_TARGET_BRAN_REFNO='24381_145018' PMS_CDP_HEADLESS=1 PMS_CDP_FULL_FLOW=1 npm run test:pms:cdp:full
```

结果：

- 退出码：0。
- 入口：`http://pms.powerpms.net:1801/sysin.html`。
- 用户：`SJ`。
- 嵌入站点：`123.57.182.243`。
- 注入 BRAN：`24381_145018`。
- form：`FORM-8E21B92E202E`。
- task：`task-ef778bef-fd75-49b4-9b5b-63a718620587`。
- package：`E2E-PKG-1777534597672`。
- PMS 候选记录中找到 `FORM-8E21B92E202E`，并按该 form 重新打开 PMS 记录。
- 严格校验阶段通过：嵌入站点接口在 JSON 响应中发现编校审包名或测试 BRAN。
- 日志：`artifacts/.tmp/rus-238-chrome-cdp-full-20260430-153301.log`。

结论：

- Chrome CDP full flow 在 BRAN `24381_145018` 下通过。
- 这次验证覆盖真实 PMS 登录入口、三维校审单新增、plant3d 发起编校审、PMS 列表回看和嵌入站点接口命中。

## 2026-04-30 · Phase 1 启动执行

已完成：

- 创建 `acceptance-inputs.md`，列出真实验收所需 BRAN、包名/任务单、角色、入口和样例测量。
- 在 `task_plan.md` 中记录 Phase 1 已进入“等待输入”状态。

当前阻塞：

- 仍缺目标 BRAN。
- 仍缺 PMS 包名或任务单。
- 仍缺验收角色。
- 仍缺验收入口。

下一步：

- 输入齐全后，按 `acceptance-inputs.md` 的组合先执行本地真实模型验收，再执行 PMS/编校审验收。

## 2026-04-30 · Phase 6 工作区收敛盘点

已完成：

- 执行只读工作区状态计数：`M=95 / D=31 / ??=76`。
- 创建 `workspace-triage.md`，将当前脏工作区按 RUS-238 规划、PMS/编校审联调、批注/Review UI、空间查询/DTX/Viewer、配置/临时产物/文档归档五组拆分。
- 更新 `task_plan.md`，记录 Phase 6 已启动。
- 更新 `findings.md`，记录脏工作区规模和“只读盘点、不删除、不回滚、不批量暂存”的决策。

下一步：

- 若需要提交规划文件，只显式暂存 RUS-238 post-push 规划目录。
- 若需要收敛整个工作区，先逐组审阅 diff，再分别决定保留、提交或清理。

## 2026-04-30 · Phase 6 分组计数

已完成：

- 在 `workspace-triage.md` 中补充各主题分组的状态计数：
  - RUS-238 后续规划：`??=2`
  - PMS / 编校审联调：`M=14 / ??=38`
  - 批注 / Review UI：`M=34 / ??=4`
  - 空间查询 / DTX / Viewer：`M=8`

下一步：

- 若继续收敛工作区，优先从最小的 RUS-238 后续规划文件开始决定是否提交。
- PMS 与 Review UI 分组规模较大，需要单独任务处理。

## 2026-04-30 · 可执行项收敛

当前结论：

- Phase 1 已推进到验收输入清单，继续需要 BRAN、包名/任务单、角色和入口。
- Phase 6 已完成只读盘点与主题分组，继续需要明确提交规划文件或拆分/清理工作区的授权。
- 在缺少上述输入或授权前，不继续扩大代码改动、不提交未请求的规划文件、不清理现有脏工作区。

## 2026-04-30 · restore 场景复核

命令：

```bash
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-238-post-push-restore-rerun-report.json npm run test:pms:simulator
```

执行调整：

- 去掉 restore 场景额外打开的独立 reviewer `3d-view` 页面，只使用 simulator iframe 中的 JH 校核工作区，避免重复页面放大后端读写负载。
- 为 automation reviewer hook 增加 `refreshAnnotationCommentThread()`，runner 在后端直接注入评论后显式刷新当前批注评论线程，避免 UI 仍停留在注入前的空评论快照。

结果：

- 契约烟测：通过，7/7。
- 仿 PMS 自动化：通过。
- form：`FORM-F0293ED94C05`。
- task：`task-78e2843b-1401-44e9-a620-6debf4ccccdc`。
- package：`COMMENT-THREAD-REGRESSION-1777541596967`。
- 最终状态：`submitted`。
- 最终节点：`jd`。
- 确认记录写入和读回恢复：`HTTP 200 records=1 matched=1 annotations=1 measurements=1`。
- 评论线程 UI 恢复通过：`restore-ui-comment-content=true`，detail 为 `title_found=true comment_found=true bran_found=true`。
- 通过的 RUS-238 相关断言：`restore-before-measurement`、`restore-before-confirmed-measurement`、`restore-confirmed-measurement-count`、`restore-ui-bran-refno`。
- 后端评论读回通过：`restore-comment-content-after-refresh=true`，且无 comment thread / dock panel console 错误。
- 报告：`artifacts/rus-238-post-push-restore-rerun-report.json`。

补充静态 / 单测验证：

```bash
npm test -- src/components/review/ReviewPanel.test.ts -t "automation hook refreshes a persisted comment thread"
npm test -- src/components/review/ReviewPanel.test.ts --testTimeout=10000
npx eslint src/components/review/ReviewPanel.vue src/components/review/ReviewPanel.test.ts scripts/pms-simulator-runner.ts
npm run type-check
```

结果：

- automation hook 单测通过，覆盖 `refreshAnnotationCommentThread()` 使用正式 `formId/taskId` 刷新指定批注评论线程。
- `ReviewPanel.test.ts` 全文件 34 个用例在 `--testTimeout=10000` 下通过，确认新增 hook 覆盖不影响同文件其他行为。
- 目标 lint 通过。
- TypeScript 类型检查通过。

结论：

- RUS-238 测量路径、确认测量回放和 BRAN fallback 均未回归。
- restore 场景已从“评论正文刷新前 UI 未展示”收敛为全链路通过；根因是 simulator 后端直写评论后缺少前端评论线程刷新信号。
