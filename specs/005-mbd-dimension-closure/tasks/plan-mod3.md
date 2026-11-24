# Implementation Plan: `mbd-viewport-and-sync-integration`（Spec 005 Module 3）

**Spec**: `specs/005-mbd-dimension-closure/SPEC-mbd-viewport-and-sync-integration.md`  
**Base**: `origin/main` @ `f5e549c9f736`（工作树 `D:\work\plant-code\old\plant3d-web-land`，分支 `feat/mbd-viewport-and-sync-integration`）

---

## 1. 顺序切片与模块设计（Sequential Slices）

1. **Slice 1 — `T301`（`#139` 标注伸出模型很远时不被远裁剪面切掉）**：
   - 新增纯函数模块 `src/viewer/clipPlanes.ts`（及 `src/viewer/clipPlanes.test.ts`）：
     - 将 `ViewerPanel.vue` 原有的 `computeClipPlanesByDiag(diag)` 迁入并导出；
     - 新增 `computeSceneClipPlanes({ modelDiagM, combinedDiagM })`：当 `combinedDiagM` 未给出或 `<= modelDiagM`（标注全在模型内或无标注）时，与原 `computeClipPlanesByDiag(modelDiagM)` **逐位相等**；当 `combinedDiagM > modelDiagM`（如小设备本体 `< 1 m` 而 MBD 偏转角/原点伸出 `~19 m`）时，用 `combinedDiagM` 扩展 `far`（如 `20 m → 100 m`），同时保持 `near` 取小模型原档位并在 `far / near > 2e4` 时仅将 `near` 微抬至 `far / 2e4`（例：`100 / 0.01 = 10,000 <= 2e4`，`near` 甚至仍保持 `0.01 m` 完全不变！）。
   - 在 `src/components/dock_panels/ViewerPanel.vue`：
     - `applyDtxCameraClipByLayerBBox` 计算模型 `box` 的同时，若 `dimensionSystem` 存在已装 MBD 记录，将 `externalDimensionBounds(mbdRecords)` 经 `designToWorld` 变换后并入 `combinedBox` 取 `combinedDiagM`；
     - 在 `syncMbdExternalDimensions` 同步完成后一并调用 `applyDtxCameraClipByLayerBBox`，确保无论几何先到还是标注后到，远裁剪面都能即时包住外伸标注。

2. **Slice 2 — `T302`（`#140` 全量数一遍三维呈现下「对着看也不画」的三类记录）**：
   - 编写只读全量审计脚本 `scripts/mbd-closeup-unrendered-audit.mjs`：
     - 在 6,732 个走通候选包（6,490 个归属对象）上，用前端真内核跑全包默认整包视角 + 逐条记录多距离（`1.05×near`, `1.8×near`, `4×near`, `10×near`）× 多视线方向（顶俯视、正前斜视、正侧斜视、等轴测 4 个方向），统计：
       1. 在全部测试机位与方向下均因 `overlap` 被相压藏掉的记录（按九种标注类型、对象数、样本 refno 汇总）；
       2. 单列「主尺寸被相压藏掉、但挂在它上面的附加长度小字（如调整焊 `+50`）仍画在屏幕上」的记录与机位（含 `24383_76302`）；
       3. 被远裁剪面切掉的对象数（对比 `#139` 修复前 `3` 台复制设备 → 修复后 `0` 台）；
       4. 字高极小近不过近裁剪面的记录（验证 `#138` 合入后全量为 `0`）；
     - 将结果写入 `docs/verification/mbd-closeup-3class-audit-2026-11-18.md` 入库。

3. **Slice 3 — `T303`（`#141` 三维呈现读数相压先试候选位再隐藏 + 附加小字联动 + 修订 ADR 0057/0059/0061）**：
   - **主从联动（附加小字跟随主尺寸）**：
     - 识别调整焊附加长度小字（`aid_text` 且 `function === '调整焊附加长度'` 或 id 含 `:weld_len:` / 紧贴同直段同链 `linear_dim`），在 `ExplicitLayoutInput.declutter` 上挂 `parentDimensionId`；
     - 当主尺寸在 `declutterPolicy` 中被藏掉时，其从属附加小字同步标为 `lodHidden: 'overlap'` 隐去；当主尺寸读数沿尺寸线外移 `Δs` 时，从属附加小字同步平移，彻底消灭孤立 `+50`（`24383_76302`）。
   - **三维读数与角度文字候选避让（先挪后藏）**：
     - 在 `dimension3d.ts` 与 `explicit.ts`（`label3d` 角度文字，如 `24381_103704` 正对机位下的两个安装角度）为参与 `declutter` 的三维读数产出有序候选方案（0 = 原位居中；1/2 = 沿尺寸线向两端偏移或箭头与读数外置左/右侧；正对角度沿弧角错开）；
     - 在 `declutterPolicy.ts` / `layoutViewport.ts`：高优先级记录落位后，若低优先级记录原位 `quad` 与已留存记录相压，依次尝试其候选位，首个零重叠候选位即采用并输出对应 `LayoutResult`，全部候选仍相压才隐藏（`lodHidden: 'overlap'`）；`?mbd_3d=0` 平贴呈现完全不走三维候选挪位，保持原位 100% 不变；
     - 同步更新 `docs/adr/0057-*.md`、`0059-*.md`、`0061-*.md`，记录用户批准重开修订「先挪后藏 + 附加小字随主尺寸联动」的依据与 `#140` 全量计数前后对比。

4. **Slice 4 — `T304`（`#142`「取最新」之后已显示的 MBD 标注增量刷新协调器）**：
   - 新增零耦合模块 `src/composables/mbdLatestRefresh.ts`（及 `mbdLatestRefresh.test.ts`）并在 `useMbdExternalSync.ts` / `useMbdDiagnosticsStore.ts` / `DimensionPanelDock.vue` 接通能力接口：
     - 支持 `sync(target, { refreshOnlyRefnos, modelSessionsByDbnum })` 增量刷新：未受本次「取最新」影响的已装对象直接复用缓存快照不重复发 HTTP 请求，受影响对象重取最新标注包并更新位置；
     - 当重取返回 `404 not_found`（原先已装在视图里的对象在最新会话中被删除）时：撤下该对象的标注，在逐源诊断写入中文说明「对象已在最新会话中删除，标注已撤下」（标记 `deletedInLatest: true`），**不计入装载失败角标、不弹错误 Toast**；
     - 当宿主提供 `modelSessionsByDbnum`（模型所在会话号）且某标注包 `sourceVersion`（`dbnum@sesno`）与对应模型库会话不一致时，在尺寸面板版本徽标旁显式标出 `标注 db@S1 ≠ 模型 db@S2` 提示。

5. **Slice 5 — `T305`（`#145` 补齐 `CONTEXT.md` 13 个词条与 `AGENTS.md` 环境叫法 + 全门禁收口）**：
   - 在 `CONTEXT.md`「尺寸与测量」小节补齐 13 个词条（定义 + _Avoid_），核对与 ADR 0046 / 0071 一致；
   - 在 `AGENTS.md` 写明「联调后端」「服务器」两个环境叫法；
   - 运行 `npm run type-check`、`npm run test:mbd`、全部新增测试、分支全部改动文件 `npx eslint --max-warnings=0`、`npm run build-only` 及 `mbd-live-sweep.mjs` 7,059 包回归验证。
