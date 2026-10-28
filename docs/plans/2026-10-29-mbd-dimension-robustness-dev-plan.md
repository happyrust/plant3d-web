# MBD 尺寸标注：健壮性修复开发计划（2026-10-29）

- 性质：开发计划（本轮未改任何业务代码）
- 上游依据：[`2026-10-28-mbd-3d-dimension-annotation-audit-and-plan.md`](2026-10-28-mbd-3d-dimension-annotation-audit-and-plan.md)（该文负责 PML 算法搬迁与呈现层重构）
- 本文定位：**只覆盖「数据链路的失败面与契约容错」**，与上游 §7 的 T3.3–T3.6 / T4 / T5 / T6 互补，不重复
- 缺陷来源：[`docs/investigation/mbd-dimension-issues-2026-10-29.md`](../investigation/mbd-dimension-issues-2026-10-29.md)
- 关键前提更新：**后端已在负载中发送 `offset` / `suppressed_reason`**（用户 2026-10-29 确认）→ 契约整包拒绝已从「未来风险」变为**现网故障**

## 0. 方法与限制（先声明）

| 项 | 状态 |
| --- | --- |
| `plannatator` skill | **本环境不存在**：`~/.claude/skills` 仅 `archify`，`~/.cursor/skills` 为空，`~/.factory/skills` 仅 `ct` / `devin`，`where /r %USERPROFILE% plannatator*` 无结果。`2026-10-28` 计划亦记录同一结论。本文沿用该计划的人工编排格式（阶段 → 任务 → 验收），未伪造 skill 产物 |
| 证据方式 | 全部 `文件:行` 由本轮只读排查逐条核出；未跑实机渲染，未跑测试 |
| 结论强度 | 契约拒绝规则、死代码、空参数、无超时为**代码直读确认**；影响面（多少 BRAN 会空白）未实测，依赖阶段 A 的取数 |

## 1. 结论先行

1. **P0：现网可能正在丢标注。** `mbdV2Contract.ts:322-324` 要求 `linear_dim.offset === undefined && suppressed_reason === undefined`，而 `:452-459` 只要有一条图元不合法就整包 `ok:false`，`useMbdExternalSync.ts:148` 随即清空来源。后端一旦发这两个字段，**该 BRAN 全部标注消失**，且 `?mbd_kinds` 无法兜底（过滤在校验之后）。
2. **P0：失败对用户不可见。** `emitToast` 只在成功路径的 error 级 issue 上调用（`:193`）；`catch`（`:201-212`）只写诊断与 `console.warn`。视口空白 + 无提示 = 现场无法区分「没有标注」和「取数失败」。
3. **P1：契约没有向前兼容策略。** 未知 `kind` 走 `default: false`（`:304-350`），新增图元 = 整包拒绝。需要区分「不认识的图元」与「认识的图元字段非法」。
4. **P1：三处零成本清理**（死代码、空参数、恒空诊断通道）可一次性做掉，降低后续排查噪音。
5. **P2：资源与安全护栏缺失**（无超时/取消、无体积上限、`?mbdBackend` 可指向任意主机），以及指针交互触发的全量重排与无上限诊断 DOM。

## 2. 现状基线（本计划的对照基准）

| 项 | 数值 / 位置 |
| --- | --- |
| 单元测试基线 | `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **70 文件 / 471 通过**（见上游 §12.7 累计门禁；2026-10-29 复现确认；本轮 B1/B4/C3/D3 落地后为 **71 文件 / 487 通过**，含 `mbdV2Api.test.ts`） |
| 跑测前置条件（2026-10-29 实测） | **必须在盘符大写的路径下执行**：`cd /d D:\work\plant-code\old\plant3d-web` 后再跑 vitest。若从 `d:\...`（小写）启动，Node ESM 会把 `file:///d:/...` 与 `file:///D:/...` 当成两个模块，`@vitest/runner` 被加载两份，`runner` 模块级变量为空 → 全部用例在 `describe()` 处报 `TypeError: Cannot read properties of undefined (reading 'config')`（`initSuite` → `validateTags(runner.config, …)`），表现为 **70/70 文件失败、no tests**。这是环境问题，不是用例问题，与代码无关。 |
| 类型基线 | `npm run type-check` → **440 条 / 127 文件**，验收要求**新增 0、已消失 0**（2026-10-29 复现确认：新增 0 / 已消失 0） |
| e2e 环境坑 | 默认 `playwright.config.ts` 的 `video: 'retain-on-failure'` 在本机会 teardown 超时；尺寸 e2e 一律加 `--config=playwright.novideo.config.ts` |
| 相关契约测试 | `mbdV2Contract.test.ts`（9.5 KB）、`useMbdExternalSync.test.ts`（存在，含原子拒绝用例） |

## 3. 阶段与任务

### 阶段 A：契约容错（P0，先取证再改）

> 目标：把「一条图元坏 → 全丢」改成「坏的那条进诊断，其余照常」；同时保留一个可开启的严格模式供 CI 守住格式。

| ID | 任务 | 改动面 | 验收 |
| --- | --- | --- | --- |
| A1 | **真实负载取证**：抓一条含 `offset` / `suppressed_reason` 的 `GET /api/mbd/v2/pipe/{refno}` 响应，脱敏后存为 fixture（`src/dimension/adapters/__fixtures__/mbd-v2-suppressed.json`） | 仅新增 fixture + 说明 | fixture 能被 `parseMbdV2PipeData` 读到；当前实现应**失败**（红），作为 A2 的回归锚点 |
| A2 | **未知字段容忍**：`isPrimitive` 改为「已知必填字段校验 + 未知字段忽略」；`linear_dim` 接受可选 `offset?: number`、`suppressed_reason?: string`（进 `MbdV2LinearDim` 类型） | `mbdV2Contract.ts:63-92`、`:304-350` | A1 的 fixture 解析 **ok:true**；`offset` 不影响几何（先忽略），`suppressed_reason` 的图元进入 `diagnostics` 并**不渲染** |
| A3 | **未知 kind 降级**：`default` 分支由 `false` 改为「记录一条 `unsupported_kind` 诊断并跳过」，不再让整包失败 | `mbdV2Contract.ts:304-350`、`:427-474` | 新增用例：payload 含 2 条 `future_dim` + 3 条 `linear_dim` → `ok:true`、`primitives` 保留 3 条、`diagnostics` 报告 2 条 |
| A4 | **严格模式开关**：`MbdV2ParseOptions.strict`（默认 false）；`strict: true` 时未知 kind / 未知字段仍整包拒绝，供契约回归与后端联调用 | 同上 + 调用方 `VideoPanel` 侧不传即默认宽松 | 同一 fixture 在 `strict` 下 `ok:false`、在默认下 `ok:true`；两条用例并存 |
| A5 | **原子拒绝的边界重定义**：契约层不再抛整包错误；`useMbdExternalSync.ts:148` 的整包拒绝只保留给「映射阶段产生 skipped」与 `strict` 模式 | `useMbdExternalSync.ts:142-157` | 既有原子拒绝用例仍绿（strict 路径）；新增用例：映射 skipped 非空 → 来源清空；契约 diagnostics 非空 → 照常提交其余记录 |

**回滚点**：A2/A3 只放宽、不收紧；若线上出现「画错」投诉，把 `strict` 打开即可回到旧行为。

### 阶段 B：失败可见与部分显示（P0/P1）

| ID | 任务 | 改动面 | 验收 |
| --- | --- | --- | --- |
| B1 | **失败必弹提示**：`catch` 分支按 `loadError` 弹一次 toast（沿用 `describeMbdV2HttpFailure` 的中文 message），同一 refno 去重避免刷屏 | `useMbdExternalSync.ts:201-212` | 单测：fetch reject → `emitToast` 恰好 1 次；同 refno 连续失败 3 次只弹 1 次 |
| B2 | **视口角标**：标注为 0 且有 `loadError` 时，在尺寸面板入口显示 `!` 角标（读 `diagnostics.loadError`），点击展开诊断 | `DimensionPanelDock.vue`（头部区域） | 组件测试：写入 loadError → 角标出现；清空 → 消失 |
| B3 | **部分显示模式**：面板开关「允许部分显示（N 条被跳过）」；打开时 `useMbdExternalSync` 不再因 `skipped` 清空来源，而是提交可用记录并在诊断里保留 `skipped` | `useMbdExternalSync.ts:148-157`、`DimensionPanelDock.vue` | 单测：开关关闭时旧行为（清空）；开关打开时提交 N 条且 `diagnostics.skipped.length > 0` |
| B4 | **零成本清理**：删死代码（`useMbdExternalSync.ts:198-200`）、删空参数 `forceRefresh`（`:28` 与 `ViewerPanel.vue:2856`）、`MbdV2ParseResult.diagnostics` 落实为真实产出（A3 已产出则补类型注释） | 三处文件 | `vitest` 全绿；`eslint` 0；全仓无 `forceRefresh` 残留 |

### 阶段 C：资源与安全护栏（P1）

| ID | 任务 | 改动面 | 验收 |
| --- | --- | --- | --- |
| C1 | **超时与取消**：`fetchMbdV2PipeData` 内部建 `AbortController`（默认 15s，可配）；`sync` 传 `signal`，`invalidate()` 时 abort 在途请求 | `mbdV2Api.ts:92-115`、`useMbdExternalSync.ts:143` | 单测：超时 → `ok:false` 且 message 含「超时」；`invalidate()` 后 in-flight 请求被 abort（spy） |
| C2 | **体积上限**：`fetchMbdV2PipeData` 先看 `Content-Length`，超阈值（默认 20 MB）直接返回 `ok:false`，不做 `text()` | `mbdV2Api.ts` | 单测：构造 `Content-Length: 30MB` 响应 → 不调用 `parseJsonResponse` |
| C3 | **`?mbdBackend` 收紧**：仅 `import.meta.env.DEV` 或域名白名单内生效；生产构建忽略该参数并 `console.warn` 一次 | `mbdV2Api.ts:32-56` | 单测：`DEV=false` + `?mbdBackend=https://evil.example` → 回落到 `buildBackendUrl` |

### 阶段 D：性能与面板承载（P2）

| ID | 任务 | 改动面 | 验收 |
| --- | --- | --- | --- |
| D1 | **量化先行**：用现成的 `onFrame` 指标（`dimensionViewport.ts:552-560` 附近）在 2k 记录场景记录 `layoutMs` 分布，写进 `docs/verification/` | 仅采集脚本 + 记录文档 | 产出 P50/P95 数字；本任务**不改渲染逻辑** |
| D2 | **裁剪重排触发**：`flushProjection()`（`:347-354`）不再强制 `{'camera'}` 全量重排，改为「若投影矩阵未变则跳过」；命中索引（`layoutViewport.ts:107`）只在几何真正变化时重建 | `dimensionViewport.ts`、`layoutViewport.ts` | 单测：同矩阵连续 `flushProjection` 两次 → `layoutViewport` 只调用 1 次；既有快照不变 |
| D3 | **诊断列表承载**：`DimensionPanelDock.vue:728-740` 按 severity 默认截断（例如各 50 条）+「显示全部」 | 面板 | 组件测试：注入 200 条 issue → DOM 行数 ≤ 50 |

### 阶段 E：覆盖补齐（P2）

| ID | 任务 | 验收 |
| --- | --- | --- |
| E1 | `pipeInformation.ts`（23 KB）、`normalizeUserDimensions.ts` 补单测（至少覆盖空值、缺字段、单位换算） | 两个新测试文件通过；不依赖 DOM |
| E2 | refno 归一化收口：抽出 `normalizeRefno`（认 `\ / _ -` 与多段），`ViewerPanel.vue:227-233` 与 `DimensionPanelDock.vue` 写 URL 处共用 | 单测覆盖 `A/B`、`A\B`、`A-B`、`A_B`、`A/B/C`；两处行为一致 |
| E3 | e2e 回归：`?mbd_refno` 指向「含未知 kind / 一条非法图元」的 mock 分支，断言仍有标注且角标可见 | `npx playwright test --config=playwright.novideo.config.ts e2e/mbd-robustness.spec.ts` 绿 |

## 4. 依赖与并行度

```
A1 ─→ A2 ─┐
      A3 ─┼─→ A5 ─→ B3 ─→ E3
      A4 ─┘
B1 ─→ B2 （独立，可先做）
B4 （独立，随时可做）
C1 → C2 （同文件，串行）
C3 （独立）
D1 → D2 ；D3 （独立）
E1 ；E2 （独立）
```

- 可并行的最小安全批次：`B1 + B4 + C3 + D3 + E1`（互不触及同一文件）。
- 必须串行：`A1→A2→A3→A4→A5`（同一文件与同一语义）；`C1→C2`（同一函数）。

## 5. 门禁（每个阶段结束都要跑）

```
cd /d D:\work\plant-code\old\plant3d-web   # 盘符必须大写，否则 vitest 全套报 reading 'config'（见 §2）
npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts
npm run type-check                      # 新增 0 / 已消失 0（基线 440 条 / 127 文件）
npx eslint <触及文件>
npx playwright test --config=playwright.novideo.config.ts   # 触及 e2e 时
```

准入标准：单测数量只增不减（当前 471）；`type-check` 零新增；改动文件 `eslint` 零问题；触及 `/api/mbd` 时必须有新用例。

## 6. 风险

| 风险 | 应对 |
| --- | --- |
| A2 若误判 `offset` 语义，可能画出错误偏移的尺寸线 | 阶段 A 明确「先忽略几何、只保证不丢标注」；`offset` 的真实语义与后端核对后，另开任务实现 |
| A3 放宽后，后端格式错误会变成「静默少画」 | 诊断计数进面板 + B2 角标；`strict` 开关供 CI 守住 |
| B3 部分显示可能让使用者误以为图完整 | 开关默认关闭；打开时面板必须显示「N 条被跳过」的常驻提示 |
| 与本仓库无关的工作区脏改动（`.gitignore`、`ui/剧本管理/version-timeline.pen`、`.impeccable/`、`.kiro/`）混入提交 | 提交时按文件白名单，逐次 `git status --short` 核对 |
| 后端同期改契约 | A4 的 `strict` 双模式即为此准备；A1 的 fixture 是双方共同锚点 |

## 7. 明确不做

- 不在此计划里做 PML 算法搬迁（属上游 T3.3–T3.6 / T4 / T5 / T6）。
- 不改渲染外观（主题、字高、去重叠策略）。
- 不做 2k 规模的分帧渲染（D1 只量化，D2 只剪触发条件）。
- 不为 `offset` 造前端派生几何——语义未确认前只做「不丢数据」。

## 8. 完成定义（DoD）

1. 含 `offset` / `suppressed_reason` 的真实负载在默认模式下**不再整包失败**，其余标注照常渲染。
2. 任何取数失败都会在界面上有一次可见提示，且同 refno 不刷屏。
3. 未知 kind 只影响它自己，不再影响整条分支；`strict` 模式下仍能整包拒绝。
4. 单测 ≥ 471 + 本计划新增，`type-check` 零新增，`eslint` 干净。
5. 上述每一条都有对应的回归用例（fixture 或单测或 e2e）。

## 9. 执行记录

### 第一轮（2026-10-29）：快速清理批次 B1 + B4 + C3 + D3

| ID | 状态 | 改动文件 | 验收 |
| --- | --- | --- | --- |
| B1 | 完成 | `src/composables/useMbdExternalSync.ts` | 失败走一次 `emitToast`（`MBD 标注装载失败：<原因>`，error 级），同 refno 同原因去重、成功/换源后复位；新增 2 条用例（「三次连续失败只弹一次且诊断仍写 3 次」「成功一次后重新武装」） |
| B4 | 完成 | `useMbdExternalSync.ts`、`ViewerPanel.vue`、`mbdV2Contract.ts` | 删死代码 + 删 `forceRefresh` 参数与传参（MBD 链路内 0 残留）；`MbdV2ParseResult.diagnostics` 补类型注释说明当前恒空、等 A3 |
| C3 | 完成（含偏离） | `src/api/mbdV2Api.ts` | `?mbdBackend` 缺省忽略，仅 `import.meta.env.DEV` 或构建期 `VITE_MBD_ALLOW_QUERY_BACKEND=1` 生效，忽略时 `console.warn` 一次；新增 2 条用例。**偏离说明**：原计划只写「DEV 或域名白名单」，实现改为「DEV + 构建期开关」——离线包若真用 `?mbdBackend` 指向前置 MBD 服务，一个构建变量即可放行，不必改域名白名单逻辑 |
| D3 | 完成 | `src/dimension/ui/DimensionPanelDock.vue` | 诊断每组截断 50 条 + 「显示全部（还有 N 条）」；`skipped` 同样截断；标题仍报全量。新增 1 条组件用例（200 条 issue → 50 行 → 展开 200 行） |

门禁结果：`vitest run src/dimension src/composables/useMbdExternalSync.test.ts src/api/mbdV2Api.test.ts` → **71 文件 / 487 用例全绿**；`npm run type-check` → **440 条 / 127 文件，新增 0、已消失 0**；`npx eslint`（8 个触及文件）→ 0 问题。

回滚方式：四处改动互不依赖，可逐个 `git checkout -- <file>` 回退；C3 若影响现网联调，先设 `VITE_MBD_ALLOW_QUERY_BACKEND=1` 而不是回退代码。

**未做（下一轮候选）**：阶段 A（A1 fixture 待用户提供真实负载）、B2/B3、C1/C2、D1/D2、E1–E3。

### 与工作区其他改动的边界（勿混提交）

本轮改动**只有这 8 个文件**：`src/api/mbdV2Api.ts`、`src/api/mbdV2Api.test.ts`、`src/composables/useMbdExternalSync.ts`、`src/composables/useMbdExternalSync.test.ts`、`src/dimension/adapters/mbdV2Contract.ts`、`src/dimension/ui/DimensionPanelDock.vue`、`src/dimension/ui/DimensionPanelDock.test.ts`、`src/components/dock_panels/ViewerPanel.vue`，外加 `docs/` 下三份文档。

同一工作区里**不属于本轮**的未提交改动（提交时按文件白名单挑选）：`package.json` / `package-lock.json`（新增 `fast-check` 依赖）、`src/model-source/modelVersionErrors.ts`、`src/model-source/ports.ts`、`.gitignore`、`ui/剧本管理/version-timeline.pen`，以及未跟踪的 `.archify/`、`.impeccable/`、`.kiro/`。

另：审计取证时的 HEAD 是 `62be3e9`，本轮结束时 HEAD 已前进到 `99308e7`（两个 e2e 截图生成器 / 截图基线提交，**未触及** `src/dimension`、`mbdV2Api.ts`、`useMbdExternalSync.ts`、`ViewerPanel.vue`），所以文档里的 `文件:行` 证据仍然有效。
