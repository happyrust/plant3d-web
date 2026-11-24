# Task Breakdown: `mbd-batch-and-diagnostics-ux`（Spec 005 Module 2）

**Spec**: `specs/005-mbd-dimension-closure/SPEC-mbd-batch-and-diagnostics-ux.md`  
**Plan**: `specs/005-mbd-dimension-closure/tasks/plan-mod2.md`

---

## Tasks

- [x] **T201 — `#133` 全站提示条优先级防顶掉与排队控制器**（已提交 `1bf7b075`）
  - **Acceptance**: `error / warning` 显示期间新来的 `info / success` 入队不顶掉；同级或同拍发出的多条提示依次完整显示各自时长；`HierarchicalMenuBar.vue` 与 `RibbonBar.vue` 共用同一控制器。
  - **Verify**: `npx vitest run src/ribbon/toastQueue.test.ts` 全过。
  - **Files**: `src/ribbon/toastQueue.ts`, `src/ribbon/toastQueue.test.ts`, `src/components/ribbon/HierarchicalMenuBar.vue`, `src/components/ribbon/RibbonBar.vue`

- [x] **T202 — `#135` 装载失败中文归因与面板诊断规则号展示**（已提交 `149330a8`）
  - **Acceptance**: 契约拒收（直段轴线重合、标签字高 0、文字方向零向量等）、映射拒收（安装角度弧半径退化等）及旧 422 根错误均带对象号、具体位置与中文原因；`not_annotatable` 原文保持不变；面板诊断区每条 `issue` 显示 `[category · rule_id]`。
  - **Verify**: 历史失败样本（`24383_75665`, `24381_71247`, `24383_97932`, `24381_25804`, `32573_1`, `17496_73858`）单测全过。
  - **Files**: `src/dimension/adapters/mbdRuleWordings.ts`, `src/dimension/ui/mbdEmptyReasons.ts`, `src/dimension/adapters/mbdV2Contract.ts`, `src/dimension/adapters/mbdV2ExternalAnnotations.ts`, `src/api/mbdV2Api.ts`, `src/composables/useMbdExternalSync.ts`, `src/dimension/ui/DimensionPanelDock.vue`（及对应 `.test.ts`）

- [x] **T203 — `#136` 一次打开多对象时先装前 32 个对象，其余按需加载**（已提交 `86bff376`、`f5e549c9`）
  - **Acceptance**: 上限按全类型对象数计（默认 32，文案写「个对象」），`?mbd_limit=` 覆盖；面板提供「再加载 N 个 / 全部加载」（`pushState`）；切换对象集合（右键查看/加入、面板增删清空）时自动清除 `mbd_limit` 复位至 32；再加载前后已有记录 `id` 不变。
  - **Verify**: `useMbdExternalSync.test.ts` 与 `DimensionPanelDock.test.ts` 分批加载单测全过。
  - **Files**: `src/composables/useMbdDiagnosticsStore.ts`, `src/composables/useMbdExternalSync.ts`, `src/dimension/ui/DimensionPanelDock.vue`, `src/components/model-tree/ModelTreePanel.vue`

- [x] **T204 — `#137` 多对象里任一包装载失败时尺寸面板常驻标出与定位**（已提交 `a98d555f`）
  - **Acceptance**: 多对象同屏只要有 ≥ 1 包失败，面板顶部即常驻 `! N 个对象装载失败`（单对象失败合并为单一 `! 装载失败` 不出双标），点击展开并定位到失败包与原因；全成功不出标记；混入 `422 not_annotatable` 与单对象判据一致。
  - **Verify**: 多对象部分失败（`24383_93306 + 24384_24829 + 24381_46633 + 24383_97932` 登记 104 条 + 常驻失败角标定位）/ 全成功 / 全失败 / 混入 `422 not_annotatable` 单测全过。
  - **Files**: `src/dimension/ui/DimensionPanelDock.vue`, `src/dimension/ui/DimensionPanelDock.test.ts`

- [x] **T205 — `#138` 字高极小（`< 2 mm`）的三维标注近景对焦出图门槛封顶与全量零膨胀校验**（已提交 `7117dbf4`）
  - **Acceptance**: 字高 `< 1 mm`（全部 125 条，含 `24381_38695` 构件 `24381_38940` 的卡片与 `0.42 mm` 尺寸）及 `1~2 mm`（全部 98 条）在相机近裁剪面之外的对焦距离下永不出图数降为 **0**；全量 7,059 候选包（6,732 走通包）默认整包视角与基准 **7,059 / 7,059（`113,707` 条画出）零差异**。
  - **Verify**: `type-check`（0 错）、`test:mbd`（758/758）、新增与关联测试、全分支改动文件 `npx eslint --max-warnings=0`（0 错 0 警告）、`build-only` 全部通过。
  - **Files**: `src/dimension/kernel/layout/shared/lod.ts`, `src/dimension/kernel/layout/dimension3d.ts`, `src/dimension/kernel/layout/tagBillboard.ts`, `src/dimension/kernel/layout/explicit.ts`（及对应 `.test.ts`）
