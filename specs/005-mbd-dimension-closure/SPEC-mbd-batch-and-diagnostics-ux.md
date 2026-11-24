# Spec: MBD 前端提示条防覆盖、中文失败归因、32 对象分批加载与极小字高可读性收口（`mbd-batch-and-diagnostics-ux`）— V1

**Capability Map**: `specs/005-mbd-dimension-closure/CAPABILITY-MAP.md`（Module 2 of 4）  
**Module ID**: `mbd-batch-and-diagnostics-ux`  
**Depends on**: `mbd-mainline-convergence`（已合入远端主线：`plant3d-web` `4f08e2a6`、`plant-mbd` `3dbf13a`、`gen-model` `229f50329`）  
**Created**: 2026-11-18  
**Status**: Approved（已按推荐默认项批准，进入 Plan / Tasks / Implement）  
**Tracking**: `plant3d-web#133`, `#135`, `#136`, `#137`, `#138`

---

## 0. ASSUMPTIONS I'M MAKING（前置假设暴露，如有出入请立即指正）

1. **在干净落地工作树（`D:\work\plant-code\old\plant3d-web-land`，基于最新 `origin/main` `4f08e2a6`）开发与验门禁**：不动 `plant3d-web` 主检出中评审/RVM 等其他会话的 ~70 个未提交文件；对主检出里那份未提交的 `MBD_INITIAL_BRAN_LIMIT = 32` 原型，将其逻辑升级为全标注类型中立的「按对象个数」版本（`#136`）纳入本分支。
2. **全站提示条（`#133`）抽离统一状态机**：`HierarchicalMenuBar.vue` 与 `RibbonBar.vue` 当前各自监听 `onToast` 并用单变量直接覆盖 `snackbarText`，提取为共用的纯状态控制器 `createToastQueueController`（`error / warning` 期间低优 `info / success` 入队等待不顶掉；同级或同拍多条按序排队各自停满时长）。
3. **装载失败中文归因（`#135`）不改后端/求解器响应原文**：求解器与服务端的英文原文保留在面板底部诊断明细中并补显 `code`（规则号）；前端在契约校验（`mbdV2Contract.ts`）、图元映射（`mbdV2ExternalAnnotations.ts`）与 422 信封翻译层统一生成带「对象号 + 具体位置（第几号直段 / 哪个图元类别与文本 / 字段名）+ 中文原因」的可读说明。
4. **极小字高出图门槛封顶（`#138`）不改契约负载与金样**：在 `src/dimension/kernel/layout/shared/lod.ts`（及关联布局入口）对参与 `secondary-far` / `detail-far` 分级判定的有效源字高设设计空间下限（如 `LOD_EFFECTIVE_SOURCE_TEXT_MIN_M`），保证 `0.4 mm ~ 2 mm` 标注在相机近裁剪面之外的对焦距离一定能跨过 `18 px` 门槛出图，同时保持默认中远景上屏条数不变。

---

## 1. Objective（目标与五项子能力验收准则）

在 `mbd-mainline-convergence` 已清零整库契约/映射异常的基础上，彻底解决大房间同屏加载、地址栏直入、多对象混开及极小构件近景对焦时的 5 项前端交互体验断点（严格按 `#133 → #135 → #136 → #137 → #138` 顺序推进，避免同改 `DimensionPanelDock.vue` 互相冲突）：

### Feature 1 — `#133` 全站提示条优先级保护与同拍排队（Toast Queue）
- **Acceptance 1.1**：当 `error`（默认 6s）或 `warning`（默认 4.5s）提示正在显示时，后续到达的 `info` / `success` 提示排入队列等待当前提示自然结束后再展示，绝不提前截断或顶掉高优提示。
- **Acceptance 1.2**：同级提示或同一事件拍内连续发出的多条提示（如空包 `warning` + 存在 error 诊断 `error`）按序排队依次停满各自时长（或高优先行、全部展示不丢失）；无高优提示显示时普通提示时序与改前一致。
- **Acceptance 1.3**：`HierarchicalMenuBar.vue` 与 `RibbonBar.vue` 共用同一份 `createToastQueueController` 逻辑。

### Feature 2 — `#135` 装载失败中文归因与诊断区规则号展示
- **Acceptance 2.1**：契约拒收（如 `24383_75665` 直段轴线两端重合、`24381_71247`「管道信息」标签字高为 0、`24381_25804` 墙名标签文字方向为零向量）、映射拒收（如 `24383_97932` 安装角度弧半径过小建不出弧平面）及旧 422 根错误（如 `32573_1` 支管成员缺几何）均输出包含**对象号、具体位置与中文原因**的清晰提示；`not_annotatable`（如 `17496_73858`）保持现有中文提示不变。
- **Acceptance 2.2**：尺寸面板「MBD 诊断」列表中每条 `issue` 显式展示其规则号（`issue.code`）。

### Feature 3 — `#136` 多对象同屏先装前 32 个对象，其余按需加载
- **Acceptance 3.1**：默认单次最多先拉取并显示前 `MBD_INITIAL_OBJECT_LIMIT = 32` 个对象（不分管道/设备/支架/墙板），文案统一写「对象」（如 `已显示 32 / 310 个对象的标注，其余 278 个按需加载`），提供「再加载 N 个」与「全部加载」按钮。
- **Acceptance 3.2**：URL `?mbd_limit=<正整数|all>` 驱动上限；切换对象选择（`writeMbdRefnos` 右键查看/替换或清空列表）时自动清除地址栏 `mbd_limit` 参数，重新从 32 个开始；「再加载」前后已有记录的 `id`（`multiRefnos` 判定基于 `requestedRefnos.length > 1`）保持不变。

### Feature 4 — `#137` 多对象部分装载失败时尺寸面板常驻标出
- **Acceptance 4.1**：将面板顶部的 `! 装载失败` 角标从「仅在总记录数为 0 时出现」升级为**「只要任一已请求对象 `loadError !== null` 即常驻出现」**：单对象失败显示 `! 装载失败`，多对象中 N 包失败显示 `! N 个对象装载失败`（不出现双重复标记）；点击即可展开并定位到失败对象的 `refno` 与原因。
- **Acceptance 4.2**：全部对象装载成功时不显示失败标记；多对象中混入 `422 not_annotatable` 时的角标行为与单对象口径严格一致。

### Feature 5 — `#138` 极小字高（`< 2 mm`）近景对焦出图门槛封顶
- **Acceptance 5.1**：在三维呈现（及共享 LOD 层级判定）中，对极小 `textHeightM`（如建筑楼板 `24381_38695` 上 `24381_38940` 的 `0.4 mm` 尺寸与 `0.6 mm` 卡片、EM9 管道 `1~2 mm` 坡度标记）封顶其出图相机距离门槛，确保在相机近裁剪面之外的正常对焦距离下 `secondary` 与 `detail` 层级一定能跨过 `lodSecondaryMinPx` / `lodDetailMinPx`（`18 px`）显示出来，字高小于 `1 mm` 且拉到最近仍永不出图的记录数降为 **0**。
- **Acceptance 5.2**：默认全局视角与「对到整包标注上」中远景两档的上屏记录条数保持不变（不引入中远景杂乱）。

---

## 2. Tech Stack

- Vue 3 Composition API + TypeScript 5（严格模式，`type-check` 0 错误）
- Vitest（纯函数单测 + 组件挂载单测 + 变异防护断言）+ ESLint 9

---

## 3. Commands

```powershell
# 在 D:\work\plant-code\old\plant3d-web-land（大写盘符 D:\）执行：
npm run type-check
npm run test:mbd
npx vitest run --maxWorkers=2 src/ribbon src/components/ribbon/HierarchicalMenuBar.test.ts src/api/mbdV2Api.test.ts src/api/mbdV2Api.objectEndpoint.test.ts
npx eslint <本次改动的全部 .ts / .vue 文件>
npm run build-only
```

---

## 4. Project Structure

```text
src/
  ├── ribbon/
  │   ├── toastBus.ts                    → 保持发布/订阅接口兼容
  │   ├── toastQueue.ts                  → （新增）纯状态优先级排队控制器 createToastQueueController (#133)
  │   └── toastQueue.test.ts             → （新增）高优防顶掉、同级排队、同拍双提示单测 (#133)
  ├── components/ribbon/
  │   ├── HierarchicalMenuBar.vue        → 接入 createToastQueueController (#133)
  │   └── RibbonBar.vue                  → 接入 createToastQueueController (#133)
  ├── api/
  │   └── mbdV2Api.ts                    → 422 根错误半中半英信封的规则化中文转译 (#135)
  ├── dimension/
  │   ├── adapters/
  │   │   ├── mbdV2Contract.ts           → 契约拒收错误附字段路径、第几号直段/图元类别与中文说明 (#135)
  │   │   └── mbdV2ExternalAnnotations.ts→ 映射拒收错误附中文几何原因 (#135)
  │   ├── kernel/layout/shared/
  │   │   └── lod.ts                     → 极小源字高分级门槛下限保护 (#138)
  │   └── ui/
  │       ├── DimensionPanelDock.vue     → 诊断规则号展示 (#135)、前 32 对象按需加载条 (#136)、多对象部分失败常驻角标与定位 (#137)
  │       └── mbdFailureReasons.ts       → （新增）422 / 契约 / 映射失败中文格式化纯函数 (#135)
  └── composables/
      ├── useMbdDiagnosticsStore.ts      → 新增 deferredRefnos 状态快照 (#136)
      └── useMbdExternalSync.ts          → MBD_INITIAL_OBJECT_LIMIT=32、对象号归因前缀与空包+error 同拍协调 (#133, #135, #136)
```

---

## 5. Code Style

遵循仓库纯函数先行与显式只读类型风格（业务逻辑抽离到 `.ts` 纯函数模块，Vue 组件只做薄绑定）：

```ts
export const MBD_INITIAL_OBJECT_LIMIT = 32;
/** 兼容旧引用别名 */
export const MBD_INITIAL_BRAN_LIMIT = MBD_INITIAL_OBJECT_LIMIT;

export function parseMbdObjectLimit(raw: string | null): number {
  const value = raw?.trim().toLowerCase();
  if (value === 'all') return Number.POSITIVE_INFINITY;
  const parsed = value !== undefined && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : MBD_INITIAL_OBJECT_LIMIT;
}
```

---

## 6. Testing Strategy

1. **逐票专属单测与回归基准**：
   - `#133`：`toastQueue.test.ts` 用假时钟 `vi.useFakeTimers()` 精确断言 `error`（6000ms）/ `warning`（4500ms）显示期间 `info` 来袭不抢占、结束后接续显示，同拍 `warning + error` 依次完整展示；
   - `#135`：注入 `24383_75665`、`24381_71247`、`24383_97932`、`24381_25804`、`32573_1`、`17496_73858` 载荷断言中文提示包含对象号、具体位置与原因，断言面板渲染 `issue.code`；
   - `#136`：310 个对象列表首屏截断 32 → 再加载 64 → 全部加载 310 且记录 `id` 不变，切换对象清除 `mbd_limit`；
   - `#137`：多对象「3 成功 + 1 失败」「全成功」「全失败」「混入 422 not_annotatable」四种组合断言面板头部常驻失败角标与点击展开定位；
   - `#138`：断言 `0.4 mm` / `0.6 mm` 标注在对焦相机距离下不再被 `detail-far` / `secondary-far` 永久拦截，同时对全量 6,732 个走通包验证默认整包视角上屏条数不退化。
2. **全仓门禁**：`npm run type-check`（0 错）、`npm run test:mbd`（全绿）、改动文件 `npx eslint`（0 错 0 警告）、`npm run build-only` 通过。

---

## 7. Boundaries

- **Always（必须遵守）**：
  - 按 `#133 → #135 → #136 → #137 → #138` 顺序独立分提交落盘，每笔提交各自带单测；
  - 任何对 `lod.ts`（`#138`）的门槛调整必须用 `mbd-live-sweep.mjs` 在默认整包视角下核对中远景上屏总数不发生膨胀；
  - 对改动文件只跑 `npx eslint <files>`，严禁运行会全仓改写的 `npm run lint`。
- **Ask first（需先确认）**：
  - 5 张票在本地落地分支全部通过门禁后，推送 `origin/main` 及评论关闭对应 GitHub 子票（`#133, #135, #136, #137, #138`）前先列清单请您确认。
- **Never（严禁触碰）**：
  - 严禁修改 `plant-mbd` 求解器的金样数值或契约字段结构；
  - 严禁触碰 `plant3d-web` 主检出里的未提交改动。

---

## 8. Success Criteria

- **SC-001**：地址栏直开含错误或空包对象时，错误/警告提示条完整停满 6s / 4.5s，零次被模型装载 `info` 提示提前顶掉（`#133`）。
- **SC-002**：5 类历史失败样本（`24383_75665`、`24381_71247`、`24383_97932`、`24381_25804`、`32573_1`）提示全中文且指明对象号与出错项，面板诊断每行显示规则号（`#135`）。
- **SC-003**：超过 32 个对象的任意类型集合首屏仅装 32 个，支持再加载/全部加载且换对象自动复位 `mbd_limit`（`#136`）；多对象任一包失败在面板顶部常驻显示 `N 个对象装载失败` 并可点击定位（`#137`）。
- **SC-004**：全量标注包中字高 `< 1 mm` 且近景对焦仍无法出图的记录降为 **0**，且默认整包视角上屏条数不变（`#138`）。

---

## 9. Out of Scope (Deferred)

- 视口相机远裁剪面 `#139`、三维直段尺寸相压计数与避让 `#140/#141`、「取最新」联动刷新 `#142`、覆盖声明警示条 `#144` → 归 **Module 3 (`mbd-viewport-and-sync-integration`)**。

---

## 10. Open Questions（请确认以下 2 项即可进入 Phase 2–4 实现）

1. **`#136`「再加载 / 全部加载」写地址栏历史策略（推荐：`pushState` 记一步历史，与面板显隐类别/允许部分显示一致）**：点「再加载 32 个」时使用 `history.pushState`（用户点浏览器后退可退回 32 个），并在切换新对象（`writeMbdRefnos`）时自动删掉 `mbd_limit`，是否同意？
2. **`#138` 极小源字高出图门槛设计空间封顶值（推荐：`6 mm`，即 `0.006 m`）**：在正常近景对焦距离（约 `0.25~0.4 m` 视距，`metresPerPixel ≈ 0.3 mm/px`）下，`6 mm` 有效分级字高正好投射为 `~20 px > 18 px`（`lodDetailMinPx`），既能让 `0.4 mm` 细缝尺寸与 `1~2 mm` 坡度标在拉近对焦时稳稳画出，又保证在 `> 1.5 m` 的常规整包中远景下仍低于 `4 px` 不提前冒出。是否认可采用这一封顶口径（并用全量 6,732 包实测默认视角上屏数零膨胀验证）？
