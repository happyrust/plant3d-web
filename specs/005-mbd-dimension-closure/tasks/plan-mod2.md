# Implementation Plan: `mbd-batch-and-diagnostics-ux`（Spec 005 Module 2）

**Spec**: `specs/005-mbd-dimension-closure/SPEC-mbd-batch-and-diagnostics-ux.md`  
**Base**: `origin/main` @ `4f08e2a6209f`（工作树 `D:\work\plant-code\old\plant3d-web-land`，分支 `feat/mbd-batch-and-diagnostics-ux`）

---

## 1. 顺序切片与模块设计（Sequential Slices）

1. **Slice 1 — `#133` 全站提示条优先级防顶掉与排队控制器（`src/ribbon/toastQueue.ts`）**：
   - 抽出纯状态机 `createToastQueueController({ setTimer, clearTimer, onChange })`：
     - 定义级别优先级：`error (3) > warning (2) > success (1) / info (1)`；
     - 当前无提示显示时，立即弹出并启动自己的独立计时器（`error: 6000ms`、`warning: 4500ms`、`success/info: 2600ms`）；
     - 当前正在显示 `error` 或 `warning` 时：新来的任何提示（无论低优 `info/success` 还是同级/更高优）均不截断当前提示，而是入队（队列内高优排在低优前面、同级 FIFO，相同文本去重），当前计时自然到点或用户手动点关闭后再弹出下一条并重新完整计时！
     - 当前正在显示普通 `info` / `success` 时：若新来 `error` / `warning`，立即切上高优提示（确保告警零延迟可见）；若新来普通 `info` / `success` 则替换更新并重置计时，保持无告警时与原有丝滑体验完全一致。
   - `HierarchicalMenuBar.vue` 与 `RibbonBar.vue` 统一改为驱动 `createToastQueueController`。

2. **Slice 2 — `#135` 装载失败中文归因与面板诊断规则号展示**：
   - `src/dimension/adapters/mbdV2Contract.ts`：当 `meta` 校验失败（如第 `k` 号直段 `axis` 起终点重合）或图元契约校验失败（如标签 `text_height_mm` 为 0、`text_dir` 为零向量）时，返回带中文位置描述的清晰原因（指明第几号直段 / 哪个图元类别与标题文字 / 哪个字段及原因）；
   - `src/dimension/adapters/mbdV2ExternalAnnotations.ts`：当弧平面退化（`angle_dim` / `aid_circle` / `aid_arc` 半径过小或法向退化）等映射失败时，产出可读中文几何原因；
   - `src/api/mbdV2Api.ts`：对旧后端 422 根错误（如 `every branch member was skipped for missing geometry` 等英文后缀）做规则化中文翻译，保留 `not_annotatable` 原文不变；
   - `src/composables/useMbdExternalSync.ts`：单对象及多对象 `toastFailure` 均保证提示包含对象号 `refno`；
   - `src/dimension/ui/DimensionPanelDock.vue`：诊断明细列表每条 `issue` 显式渲染 `[issue.code]` 规则号标签。

3. **Slice 3 — `#136` 一次打开多对象时先装前 32 个对象，其余按需加载**：
   - `src/composables/useMbdDiagnosticsStore.ts`：快照补充 `deferredRefnos: readonly string[]`；
   - `src/composables/useMbdExternalSync.ts`：新增 `MBD_INITIAL_OBJECT_LIMIT = 32`（导出兼容别名 `MBD_INITIAL_BRAN_LIMIT`）与 `parseMbdObjectLimit`；按 `requestedRefnos.slice(0, limit)` 拉取，超出部分入 `deferredRefnos`，`multiRefnos = requestedRefnos.length > 1` 保证再加载前后已有记录 `id` 不变；
   - `src/dimension/ui/DimensionPanelDock.vue`（及右键 `writeMbdRefnos` 入口）：展示 `已显示 N / M 个对象的标注，其余 K 个按需加载` + `再加载 X 个` / `全部加载`（`history.pushState` 记一步历史）；当切换对象集合（`writeMbdRefnos` 或模型树打开新对象）时自动 `searchParams.delete('mbd_limit')` 复位回 32 个。

4. **Slice 4 — `#137` 多对象部分装载失败时尺寸面板常驻标出与定位**：
   - `src/dimension/ui/DimensionPanelDock.vue`：计算 `failedSources = mbdDiagnostics.sources.filter(s => s.loadError !== null)`；
   - 顶栏失败角标在 `failedSources.length > 0 || mbdDiagnostics.loadError !== null` 时即常驻展示：单对象场景显示 `! 装载失败`，多对象场景显示 `! N 个对象装载失败`（统一单角标不重复）；点击角标自动展开失败明细/诊断区并滚动聚焦到失败包列表（逐包列出 `refno — 中文原因`）。

5. **Slice 5 — `#138` 极小字高（`< 2 mm`）三维近景对焦出图门槛封顶**：
   - `src/dimension/kernel/layout/shared/lod.ts`：检查全量 6,732 个走通包中字高 `< 2 mm` 的三维标注在 `dimension3d.ts` / `tagBillboard.ts` / `explicit.ts` 的相机近裁剪面距离关系，为 `projectedSourceTextHeightPx` 引入仅用于远景隐藏门槛判定的设计空间源字高下限（例如 `LOD_MIN_SOURCE_TEXT_HEIGHT_M = 0.006`，并在全量重放包上实测对比默认整包视口上屏条数确保 0 膨胀且对焦距离 100% 可出图）。

---

## 2. 验证检查点（Verification Checkpoints）

- 每完成一个 Slice 跑对应 vitest 用例并独立提交；
- 5 个 Slice 全部完成后运行：`npm run type-check`、`npm run test:mbd`、全套新增单测、改动文件 `npx eslint`、`npm run build-only` 及 `mbd-live-sweep.mjs` 全量排版回归核对。
