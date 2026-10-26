# plant3d-web 仓库健康审核（2026-10-26）

> 只读审核：所有命令在 `main 9fe0dae0`（含当日三笔离线发布提交）上跑，**没有改任何代码**。目的是给出主干现在能不能发、哪里在漏水、下一步先修什么。按严重级排序；每条带证据与建议处置。

## 结论先行

- **主干现在过不了自己的门**：`npm run type-check` 基线外新增 3 条（`npm run build` 会失败），`npm test` 有 1 个确定性失败。两条都来自 10-24 的最后两笔提交（`d4b1167c` room-clip 移植、`fc6f1264` 校审上传预览）。其中一条类型错误是**运行时 ReferenceError**（被 `try/catch` 吞掉，房间视图截管收不到实例加载通知）。
- **公开仓库里有联调账号的明文密码**（8 个文件，含 e2e 代码里的默认回退值）。删文件不够，密码已在历史里，要轮换。
- **没有 CI 门**：`.github/workflows` 只有手动部署；type-check / lint / test 全靠本地自觉，上面两条回归就是这样进主干的。
- 依赖审计 29 条（3 critical / 19 high / 7 moderate），绝大多数在开发工具链，全部有修复版本。
- 仓库卫生欠账明显：根目录 55 个追踪的草稿文件、与本仓无关的 `output/lactation-notes/`、28 MB 交付 docx、4.9 MB vendored `doc/xeokit-sdk.es.js`，pack 321 MB。

## 口径

| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm run type-check` | 474 条 / 132 文件；基线 471；**新增 3，消失 0** → 红 |
| 单测 | `npx vitest run` | 368 文件 / 3502 用例：**1 失败**（`src/components/review/form-binding.test.ts`，孤立重跑 2 次仍失败） |
| Lint（源码范围） | `npx eslint src e2e scripts`（不带 `--fix`） | 44 条（28 error / 16 warning） |
| Lint（全仓） | `npx eslint .` | 11 796 条，几乎全在 `deploy/offline/**` 构建产物（见 P1-6） |
| 依赖 | `npm audit` | 29 条：critical 3 / high 19 / moderate 7，全部 `fixAvailable` |
| 凭据 | `git grep` 密码字面量 | 8 个追踪文件命中（见 P0-3） |
| 体积 | `git count-objects -vH` / `git ls-tree -r -l` | pack 321 MB，追踪内容 375 MB，3 895 个文件 |

## P0 — 阻断发布 / 主干健康

### P0-1 主干过不了 `type-check`，`npm run build` 会失败（来源 `d4b1167c`）

基线外新增 3 条：

1. `src/components/dock_panels/ViewerPanel.vue(1589)` `TS2304: Cannot find name 'loadedRefnos'`——`notifyRoomClipInstancesLoaded(loadedRefnos)` 所在函数里没有这个变量（它定义在 3778 行另一个函数里）。**运行时是 ReferenceError**，外面那层 `try { … } catch { // ignore }` 把它吞了：这条路径上房间视图截管永远收不到「实例已加载」。
2. `src/composables/useRoomClip.ts(521)` `TS2339: Property 'color' does not exist on type 'DTXObject'`——`obj.color` 运行时是 `undefined`，`?.getHex?.()` 落到默认色 `0x94a3b8`：凹房间 / L 形房间的附加管段永远是灰色，不是构件本色。
3. `src/composables/useSpatialQuery.ts(2640)` `TS2322: 'DtxCompatViewer | ViewerLike' 不可赋给 'DtxCompatViewer | null | undefined'`——类型层面的，运行时未见影响。

**处置**：修这 3 条（第 1 条要把 `loadedRefnos` 从调用方传进来或在该函数里取；第 2 条用 `DTXObject` 真有的颜色来源），不要改基线放行（AGENTS.md 的纪律）。

### P0-2 `npm test` 有 1 个确定性失败（疑似来源 `fc6f1264`）

`src/components/review/form-binding.test.ts > InitiateReviewPanel form binding > allows adding components in external workflow mode`：期望页面出现「编校审单保存成功」，实际文本停在「正在保存...」。孤立重跑两次同样失败，不是并发抖动。该面板最近一次改动是 `fc6f1264`（10-24，Word/PDF 上传与分屏预览）。

**处置**：先判断是测试的 `flushAsyncWork()` 等不到新加的异步步骤，还是外部流程模式下保存回执真的不再渲染那句话；后者是产品行为变更，要连文案 / 用例一起改。

### P0-3 公开仓库里有联调账号明文密码与内网地址

仓库 `happyrust/plant3d-web` 是 **public**。PMS 联调账号密码明文出现在 8 个追踪文件：`AGENTS.md`（两处）、`e2e/helpers/pmsProductionReviewFlow.ts`（作为默认值）、`e2e/pms-powerpms-review-new.spec.ts`（`process.env.PMS_E2E_PASSWORD?.trim() || '<明文>'` 回退）、`debug_scripts/test_pms_dialog_performance.sh`、`docs/plans/2026-04-30-rus-238-post-push/{acceptance-inputs,progress}.md`、`docs/superpowers/plans/2026-05-07-rus-244-design-{a,b}-*.md`。同时写明了 PMS 主机端口与四个用户名。

**处置**（顺序重要）：① 在 PMS 侧**轮换**该密码——它已在 git 历史里，只删文件没有意义；② 代码里去掉默认回退：缺 `PMS_E2E_PASSWORD` 就直接失败，不要兜底成明文；③ 文档改成占位符（`<PMS_E2E_PASSWORD>`），AGENTS.md 只说「找管理员要」；④ 之后再考虑要不要清历史（改写公开仓历史代价大，先轮换即可）。

## P1 — 高

### P1-4 没有 CI 门

`.github/workflows/` 只有 `deploy-ubuntu.yml`（`workflow_dispatch`）。没有任何 push / PR 触发的 type-check、lint、test。P0-1 / P0-2 是这件事的直接后果。

**处置**：加一条 `ci.yml`：`push` 到 `main` + `pull_request`，`npm ci` → `npm run type-check` → `npx eslint src e2e scripts`（**不带** `--fix`）→ `npx vitest run`。E2E 与 PMS 联调仍留在本地 / 手动。

### P1-5 依赖安全审计 29 条

`npm audit`：critical 3（`vitest`、`@vitest/coverage-v8`、`shell-quote`），high 19，moderate 7。运行时直接依赖只有 `vue`（经 `@vue/server-renderer` 的 XSS 修复）；其余在 `vite` / `postcss` / `happy-dom` / `rollup` / eslint 依赖等开发链上。**全部有修复版本**。

**处置**：`npm audit fix`（`chrome-devtools-mcp` 需显式升到 1.12.0），然后重跑三门与一次 `npm run build`；三份锁文件要一起更新（见 P1-7）。

### P1-6 ESLint 没忽略离线构建产物

`eslint.config.js` 的 `ignores` 有 `dist` / `coverage`，但没有 `deploy/offline/**`。机器上一旦跑过离线出包，`deploy/offline/www/assets/*.js`、`deploy/offline/backend/web/pkg/rs-plant.js` 就会被全仓 lint 扫进去：11 796 条里 9 875 条 `no-unused-expressions`、1 045 条 `no-constant-condition` 全是压缩后的 bundle；`npm run lint` 带 `--fix` 还会去**改构建产物**。源码范围真正的问题只有 44 条。

**处置**：`ignores` 加 `deploy/offline/www/**`、`deploy/offline/backend/**`（或整个 `deploy/offline/**` 再放行源文件）。顺手清掉源码的 44 条：`import-x/order` 19、`vue/one-component-per-file` 16（`src/harness/*`、`src/debug/pmsReviewSimulator.ts`）、`quotes` 6、`@typescript-eslint/array-type` 2、`no-useless-escape` 1。

### P1-7 工具链漂移

- 三份锁文件并存：`package-lock.json`、`pnpm-lock.yaml`、`bun.lock`（AGENTS.md 只提到前两份）。CI 用 `npm ci`，以 `package-lock.json` 为准，其余两份要么删、要么说明只给本地加速。
- `package.json` 没有 `engines` / `packageManager`；本机 Node 26.1 vs `@types/node ~22`，AGENTS.md 说 Node 20+。建议写 `engines.node`。
- `@types/three ^0.182` 对 `three ^0.162`：类型与实现差 20 个小版本，Three.js 这期间删改了不少 API，类型会「看起来对、跑起来错」。应对齐到 `@types/three@0.162.x`，或连 `three` 一起升。
- `playwright ^1.58` 在 `dependencies`，应在 `devDependencies`（它只给 e2e / CDP 脚本用；`npm install --omit=dev` 场景会少装几十 MB 浏览器驱动）。

## P2 — 仓库卫生

### P2-8 根目录 55 个追踪的草稿文件

27 张截图（`bran-*.png`、`ams7997-*.png`、`comparison-*.png`、`whole-site-*.png`、`shot_*.png`、`screenshot-20260728-143059.png`，合计约 4 MB）、7 份 `*_REPORT.md` / `TEST_*.md` / `VERIFY_*.md`、10 个一次性脚本（`test_*.ts/.js`、`validation-*.mjs`、`verify-bran-*.mjs`）、`dist.tar.gz`（3 MB 构建产物）、`.sigmap-cache.json`（207 KB 工具缓存）、`.tmp_view_250164.mjs`、`response.json`、`history.txt`（SurrealDB 查询草稿）、`gh44-comments.txt`、`demo.html` / `embed-url-test.html` / `mbd-pipe-annotation-demo.html` / `pms-review-simulator.html`。

**处置**：截图与报告归入 `docs/verification/<主题-日期>/`，一次性脚本进 `scripts/`（受白名单约束）或删除，`dist.tar.gz` / `.sigmap-cache.json` / `.tmp_*` / `response.json` 直接 `git rm` 并补 `.gitignore`。

### P2-9 追踪了产物与无关内容

- `output/lactation-notes/`（13 个文件，其中 7 张 2 MB 背景图）——与本仓无关的内容，应移出。
- `outputs/plant3d_plan_20260713/`（21）、`outputs/review-attachment-testing/`（3）——产物目录，`.gitignore` 规则对已追踪文件不生效。
- `doc/xeokit-sdk.es.js`（4.9 MB vendored 库，仓里已无 xeokit 依赖，`doc/` 与 `docs/` 并存）。
- `交付文档/*.docx` 三份共 28 MB、`docs/guides/PMS…docx` 三份共 6.5 MB、`public/texture/skybox.png` 7.3 MB（这一个是真资产，可考虑压成 KTX2 / 更小的 PNG）。

**处置**：`git rm --cached` 这些目录 / 文件（历史保留），大 docx 走发布附件或 LFS。

### P2-10 文档陈旧

- `CLAUDE.md` 说技术栈含「Apache Arrow + Parquet + DuckDB WASM」，`package.json` 没有任何相关依赖（源码里仅 5 处 duckdb 字样）。
- `README.md` 指向不存在的 `llmdoc/index.md`。
- `CHANGELOG.md` 缺 0.2.5–0.2.7（0.2.8 已于今日补上；ReleaseNotesDialog 直接读这个文件）。
- `wiki/` 515 个文件、`开发文档/`、`doc/`、`docs/` 四处并行，找东西要猜目录。

### P2-11 超大文件与类型债

`src/composables/useDtxTools.ts` 6 594 行、`src/components/dock_panels/ViewerPanel.vue` 5 224、`src/composables/useXeokitMeasurementTools.ts` 4 187（xeokit 命名残留，69 个源文件还带这个词，仓里已无该依赖）、`src/debug/pmsReviewSimulator.ts` 4 005、`src/composables/useToolStore.ts` 3 366。类型基线 471 条压在 132 个文件上。这些是 P0-1 那类「在一个 5 000 行文件里引用了另一处的局部变量」的温床。

**处置**：按功能切出 composable，优先 `ViewerPanel.vue`（它同时是类型错误最多的文件之一）；类型债按文件逐个清零再收紧基线。

## 没问题的（也说一句）

- `src/debug/`、`src/harness/`、`src/testing/`、`src/fixtures/` 没有被生产代码 import（0 处），不会进 bundle。
- 单测覆盖面：`src/` 907 个 ts/vue 里 368 个 `*.test.ts`，3 502 个用例 25 s 跑完。
- `.env.*` 没入库（只有 `.env.example`）。
- 当日的离线发布改动（清单重建自检、dirty 拒绝出包、`.sha256`）已审、已修、已合（`94675769` / `0da6d530` / `9fe0dae0`）。

## 建议的处理顺序

1. P0-3 轮换密码 + 去掉代码默认回退（半天内）。
2. P0-1 / P0-2 修到 `type-check` / `vitest` 全绿，然后 P1-4 加 CI 门，别再漏。
3. P1-5 `npm audit fix`、P1-6 lint 忽略产物、P1-7 锁文件 / engines / @types/three。
4. P2 卫生分两三笔 `chore(repo)` 清掉。

## 处置记录（同日）

- P0-1 / P0-2：`6d71d9bf` / `fca7afb0`，主干三门全绿。
- P0-3：`3f24a268` 去掉代码默认回退与文档明文；**口令轮换仍待 PMS 侧执行**。
- P1-4 / P1-6：`2f59b291` + `ff968f00` CI 工作流（首次绿跑 40278390752），eslint 忽略 `deploy/offline/**`；`d00979c1` 源码范围 lint 错误清零。
- P1-5：`a2af783c` `npm audit fix`，29 → 6（剩 tailwind 4 / happy-dom 21 / chrome-devtools-mcp 1.x 三个大版本未动）；`3b769682` 适配 vitest 4.1 的 `vi.importMock` 行为变化。
- P1-7：`ce14372e` + `5aad47f8` engines / playwright → devDependencies / 删 bun.lock；`@types/three` 对齐到 0.162 试过（+44 / −22）回退，待单独清理；pnpm-lock.yaml 仍在（本机 pnpm 损坏）。
- P2-8 / P2-9：`8b8f775d` 根目录截图与报告归档到 `docs/verification/legacy-root-2026-10-26/`；`2e5fdb00` 删一次性脚本与杂物；`fed72035` history.txt / output / outputs 改为不跟踪；`a1e96627` 删 xeokit bundle 与 Word 锁文件。交付 docx 与 `docs/guides/*.docx` 未动。
- P2-10：README 去掉 `llmdoc` 链接，CLAUDE.md 技术栈说明改回实际；CHANGELOG 0.2.5–0.2.7 仍缺；`wiki/` / `doc/` / `开发文档/` 并行未动。
- P2-11：未动。
