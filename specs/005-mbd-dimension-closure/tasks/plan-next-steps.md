# MBD 尺寸标注与共享尺寸子系统下一步开发与收口计划

**关联议题**：`plant3d-web#103`（MBD 全类型主票）、`plant3d-web#55`（Wayfinder 尺寸路线图：`#65, #66, #68, #71, #72, #73, #74, #75, #77, #78`）、`#143`、`#146–#149`  
**对应 PR**：`#192`、`#186`、`#187`、`#188`、`#189`、`#190`  
**当前主线基线**：`plant3d-web` `main` @ `0d9536da`（`npm run test:mbd` 77 文件 / 793 用例全过）、`gen-model` `refactor` @ `f3c6d7444`、`vendor/plant-mbd` `main` @ `3dbf13ae`

---

## 1. 背景与现状诊断

经对 `plant3d-web`、`gen-model` 与 `vendor/plant-mbd` 的全量代码与 Git 分支/PR 核查，当前 MBD 与尺寸标注子系统存在以下待收口项：

1. **MBD 前端核心加固分支滞留未合（PR `#192`：`origin/cursor/mbd-hardening-batch-778c` @ `652a2273`）**：
   - 当前 `main` 分支的 `src/dimension/ui/mbdAnnotationTypes.ts` 中，`expectedKindsFor()` 仍只对 `em4_pipe / em9_pipe` 返回期望图元集，其余 7 类（支架 3 类、设备 2 类、土建、建筑）返回 `null`，导致非管道标注包缺失 `meta.coverage` 类别时不触发「本分支标注不完整」横幅。
   - PR `#192` 已完成：
     - 补齐九类 `EXPECTED_KINDS_BY_ANNOTATION_TYPE`（与 `vendor/plant-mbd` 各模块 `PRODUCED_KINDS` 严格对齐）；
     - `src/composables/useMbdExternalSync.ts` 引入在途同步 `AbortController` 主动取消，以及多子构件指向同一归属对象 `subject.refno` 时的自动归并去重；
     - `src/dimension/kernel/layout/explicit.ts` 修复旋转附加文字 `texts[].stackIndex` 沿基线法向偏移，并汇总多库 `sourceVersionBadge`；
     - `src/api/mbdV2Api.ts` 新增 `POST /api/mbd/v2/objects` 批量取数（含老后端 404/405 自动回退逐对象 GET、流式字节上限守卫、`503 SOURCE_CHANGED` 按 `Retry-After` 退避重试）；
     - 清理退役的前端 `polar` / `polarObstacle` 死字段。
   - 预检结果：`git merge-tree --write-tree main origin/cursor/mbd-hardening-batch-778c` **0 冲突**。

2. **`gen-model` 后端尚未挂载 `POST /api/mbd/v2/objects` 批量路由**：
   - 当前 `gen-model/src/web_service/mod.rs` 仅注册了 `GET /api/mbd/v2/pipe/{refno}` 与 `GET /api/mbd/v2/object/{refno}`。
   - 当一次打开 32 个对象的 MBD 标注时，若后端原生提供 `POST /api/mbd/v2/objects`（上限 128 个 `refno`，复用 `mbd::object::layout_object_refno` 并按库复用 `DbSet`），可将首屏 32 次独立 HTTP 往返合并为 1 次批量请求，消除前端首次 404 探测回退。

3. **交互式用户尺寸 Wayfinder M4 的 5 个已完成 PR 停留在分支未合入 `main`（PR `#186–#190`）**：
   - **PR `#188`（`#73` `bc73b75f`）**：集中式长度/角度格式策略（`src/dimension/kernel/format.ts` 支持 `in / ft`、`rad`、去尾零 `trailingZeros: false`，保持 MBD 原文豁免）；
   - **PR `#190`（`#78` `94d46928`）**：`GRIDPL / GRIDCY` 轴网只读自动标注外部源（`src/dimension/adapters/gridAnnotations.ts`，随视线正对/侧看动态更新，不污染用户文档与撤销栈）；
   - **PR `#187`（`#72` `4a1e3289`）**：径向尺寸整圆重绑命令 `rebind-radial-circle` 并拒绝零半径 `DEGENERATE_RADIAL_RADIUS`；
   - **PR `#186`（`#71` `ebd7906b`）**：角度尺寸平面 `anglePlane` 持久化、创建会话 `place` 阶段与可选的近 90° 正交吸附（`set-angular-orthogonal-snap`）；
   - **PR `#189`（`#74` `e0570b64`）**：共享基线与参考方向的有序链式尺寸（`chain` 创建会话、`add-chain-anchor` / `remove-chain-anchor` 细粒度编辑命令、`src/dimension/kernel/layout/chain.ts`）。
   - 预检结果：单个分支对 `main` 均为 0 冲突；串联叠加时在 `commands.ts`、`reducer.ts`、`types.ts`、`validation.ts`、`editSession.ts`、`DimensionToolbar.vue`、`dimensionKernelDemo.ts` 存在联合类型追加冲突，按「先独立文件、后共享命令状态机」顺序合流即可无损并集。

4. **GitHub Issues 状态滞后（11 张票待同步关闭）**：
   - 已在 `main` 落地的 5 张票：`#65`（`e4f0e7f3`）、`#66`（`34e08f2b`）、`#68`（`a1dfd3ab`）、`#75`（`1ace56ba`）、`#77`（`decbb1fa`）仍处于 OPEN 状态；
   - 上述阶段一、阶段二合入后，`#71`、`#72`、`#73`、`#74`、`#78` 及对应 PR `#186–#190, #192` 可一并闭环。

---

## 2. 分阶段实施计划

### 阶段一：合入 PR `#192` 完成 MBD 前端核心加固（`plant3d-web`）

- **目标**：将 `origin/cursor/mbd-hardening-batch-778c`（`652a2273`）合入 `main`，收口全九类 `meta.coverage` 校验、在途请求取消、同归属 `subject.refno` 去重、批量取数客户端与旋转文字堆叠修复。
- **涉及文件**：
  - `src/dimension/ui/mbdAnnotationTypes.ts`（及 `.test.ts`）
  - `src/api/mbdV2Api.ts`（及 `.test.ts`）
  - `src/composables/useMbdExternalSync.ts`（及 `.test.ts`）
  - `src/composables/useMbdDiagnosticsStore.ts`
  - `src/dimension/kernel/layout/explicit.ts`（及 `.test.ts`）
  - `src/dimension/kernel/types.ts`、`src/dimension/ui/DimensionPanelDock.vue`（及 `.test.ts`）
  - `docs/architecture/mbd-dimension-annotation.md`、`e2e/dimension-mbd-v2-fixture.spec.ts`、`e2e/mbd-robustness.spec.ts`
- **门禁验证**：
  - `npm.cmd run type-check`（0 错误）
  - `npm.cmd run test:mbd`（全部通过）
  - `npx.cmd eslint --no-fix <改动文件>`（0 error / 0 warning）

---

### 阶段二：按无冲突拓扑序合入 Wayfinder M4 的 5 个交互式尺寸 PR（`#188 → #190 → #187 → #186 → #189`）

- **目标**：将交互式用户尺寸与 E3D 语义对齐的 5 个 PR 依次合入 `main`，完成 Wayfinder `#55` M4 全部前端能力闭环。
- **合入顺序与冲突消解策略**：
  1. **Step 2.1 — 合入 PR `#188`（`#73` 集中式单位/精度/去尾零格式策略）**：
     - 仅改 `src/dimension/kernel/format.ts`（及 `.test.ts`）、`dimensionKernelDemo.ts`、`e2e/dimension-canvas-smoke.spec.ts`，与其它模块零交集。
  2. **Step 2.2 — 合入 PR `#190`（`#78` `GRIDPL / GRIDCY` 只读自动标注外部源）**：
     - 新增 `src/dimension/adapters/gridAnnotations.ts`（及 `.test.ts`），接入 `createDimensionSystem.ts` 与 `viewerBindings.ts`。
  3. **Step 2.3 — 合入 PR `#187`（`#72` 径向尺寸整圆重绑 `rebind-radial-circle` 与零半径拒绝）**：
     - 扩展 `commands.ts`、`reducer.ts`、`validation.ts`、`editSession.ts`、`radial.ts`、`DimensionToolbar.vue`。
  4. **Step 2.4 — 合入 PR `#186`（`#71` 角度平面 `anglePlane` 持久化、`place` 阶段与近 90° 正交吸附）**：
     - 新增 `src/dimension/domain/angularPlane.ts`（及 `.test.ts`）；在与 Step 2.3 共享的 `commands.ts`、`reducer.ts`、`types.ts`、`validation.ts`、`editSession.ts`、`DimensionToolbar.vue` 中并集保留 `rebind-radial-circle` 与 `set-angular-orthogonal-snap` 两条命令分支。
  5. **Step 2.5 — 合入 PR `#189`（`#74` 共享基线与参考方向的有序链式尺寸 `chain`）**：
     - 新增 `src/dimension/kernel/layout/chain.ts`（及 `.test.ts`）；在领域层与交互层并集保留 `chain` 记录类型、`add-chain-anchor` / `remove-chain-anchor` 命令及工具栏入口。
- **门禁验证**：
  - 每步合入后执行对应单测，全部 5 个 PR 合完后执行：
    - `npm.cmd run type-check`（0 错误）
    - `npm.cmd run test:mbd` 及关联单测（全部通过）
    - `npx.cmd eslint --no-fix`（0 错误）
    - 推送 `origin/main` 并同步关闭已完成落地的 GitHub Issues（`#65, #66, #68, #71, #72, #73, #74, #75, #77, #78`）。

---

### 阶段三（可选协同项）：在 `gen-model` 后端补齐 `POST /api/mbd/v2/objects` 批量端点并真机联调

- **目标**：在 `D:\work\plant-code\old\gen-model\src\web_service\mbd.rs` 与 `mod.rs` 中原生实现 `POST /api/mbd/v2/objects`，与阶段一合入的前端 `fetchMbdV2ObjectsData` 契约无缝对接。
- **契约细节（严格对齐 `src/api/mbdV2Api.ts`）**：
  - 请求体：`{ "refnos": ["24381/145018", ...] }`（上限 `MBD_BATCH_MAX_SIZE = 128` 条，超出返回 `400 bad_request`）；
  - 响应体：`{ "items": [ { "refno": "...", "ok": true, "data": MbdV2PipeData } | { "refno": "...", "ok": false, "status": 404|422|..., "code": "...", "message": "...", "detail": ... } ] }`，顺序与请求 `refnos` 严格一一对应；
  - 内部实现：在 `spawn_blocking` 中复用 `mbd_v2_object` 的 `parse_refno` + `layout_object_refno`，同一 `dbnum` 的 `DbSet` 在单次批量请求内复用，避免重复打开同一库文件。
- **门禁验证**：
  - `cargo test --test mbd_*` 集成测试通过；
  - 前后端联调验证多对象首屏直接命中 `POST /api/mbd/v2/objects` 200 OK，无 404 回退。

---

## 3. 待确认决策项

1. 是否同意按 **阶段一（合入 PR `#192`） → 阶段二（依次合入 PR `#188, #190, #187, #186, #189` 并关闭已落地 Issues） → 阶段三（`gen-model` 补齐 `POST /api/mbd/v2/objects` 批量路由）** 的顺序执行？
2. 阶段三的 `gen-model` 后端批量端点是否在本次一并实现，还是仅先完成 `plant3d-web` 前端阶段一与阶段二的合流推送？

---

## 4. 执行结果（2026-11-24 执行，2026-11-27 复核）

三个阶段都已执行，第 3 节的两项决策随之落定：按阶段一、阶段二、阶段三的顺序做，`gen-model` 的批量端点同期实现。

| 阶段 | 结果 | 提交 |
|---|---|---|
| 阶段一：PR `#192` | 已合入 `main` | `c174b6c0` |
| 阶段二：PR `#188`、`#190`、`#187`、`#186`、`#189` | 已按序合入 `main` | `0aae0c3a`、`7e5dcc7e`、`468f8497`、`da4588aa`、`e3d19c2b` |
| 阶段二：关票 | `#65`、`#66`、`#68`、`#71–#75`、`#77`、`#78` 已于 11-24 关闭 | — |
| 阶段三：`POST /api/mbd/v2/objects` | 已在 `gen-model` `refactor`，不在 `publish` | `dc288f4b9` |

合入后 `npm run test:mbd` 是 80 个文件、820 条全过；合入前的基线是 77 个文件、793 条。

留下的事：

- M4 的各 PR 用的是工程默认值，`#70` 的尺寸侧 E3D 金样还没采，而 `#55` 的交付规则是 E3D parity 项没有 runtime golden 不得关闭。待复核的取值与代码位置列在 `#70` 的 2026-11-27 评论里。
- 这几个 PR 都没有在真实模型上拾过点，只有单测和演示页冒烟。
- `#78` 的视线钩子带来相机运动时的全量重排回归，见 `#197`。
- 批量端点还没有随 `publish` 发布。
