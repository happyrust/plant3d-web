# 类型基线 439 条清零计划（已完成）

- 日期：2026-11-01
- 状态：已完成，基线 `scripts/type-check-baseline.txt` 已收紧到 **0 条 / 0 个文件**
- 分支：`main`（未推送）

## 一、这件事的收益口径

先把话说清楚，避免夸大：

- `npm run build` 只比对基线，**这 439 条并不挡构建**。清掉它们不会让构建从红变绿。
- 真实收益是两条：**还技术债**（此后任何新增类型错误直接报红，不再被 439 条噪声淹没），以及**挖出藏在类型错误后面的真缺陷**。
- 本次实际挖出 **3 处真缺陷**，见第四节。这是本计划最有价值的部分。

## 二、分批策略

先测试后源码，高风险文件留最后。每批修完跑 `npm run type-check:update-baseline` 收紧基线，**只收紧不放宽**。

| 批次 | 范围 | 条数 / 文件 | 提交 |
|---|---|---|---|
| B1a | `src/composables/*.test.ts` | 82 / 16 | `d1b3ee69` |
| B1b | `src/components/review/*.test.ts` + `src/review/**/*.test.ts` | 80 / 21 | `7d474c25` |
| B1c | `src/dimension/**/*.test.ts` | 72 / 19 | `18098f2` |
| B1d | 其余测试文件 | 36 / 12 | `db444418` |
| B2a | `src/debug/*` + `scripts/pms-contract-sequence.ts` | 34 / 4 | `4efc9680` |
| B2b | `src/dimension` 下源码（非测试） | 34 / 6 | `bed13cde` |
| B2c | review 与其余源码 | 84 / 43 | `e2938caf` |
| B3 | `ViewerPanel.vue` / `ReviewPanel.vue` / `InitiateReviewPanel.vue` / `AnnotationOverlayBar.vue` | 13 / 5 | `7aa2a143` |

基线收紧：`7fd718ee`。

## 三、核心工具：`@/testing/present`

新增 `src/testing/present.ts`：

```ts
present(value, what?)
```

取值即断言——缺了当场抛错并带位置说明。**用它替代非空断言 `!`**，是本计划贯穿始终的做法。

之所以不用 `!`：`!` 会把「这里本不该是 undefined」的假设藏进类型系统，运行时该崩还是崩，且崩了没有位置信息。`present` 让同一个假设变成一句可读的运行时检查。

## 四、挖出的 3 处真缺陷

三处都已按「一处一个 `fix(...)` 提交」拆开。

### 1. `hoverText` 死分支（`ViewerPanel.vue:735`，`79e201a5`）

`activeMeasureHoverText` 读 `toolsRef.value?.hoverText`，但 `useDtxTools` **从未提供该字段**。可选链让它自 `ac38b804`（2026-03-17「unify default measurement UI to xeokit mode」）起就一直静默返回空串。

修法：显式 `if (!isXeokitMeasureMode.value) return '';`，删掉那条永不生效的分支。

### 2. toast 字段名写错（`ReviewPanel.vue:1029`，`a2f313fd`）

用了 `type: 'warning'`，而 `ToastPayload`（`src/ribbon/toastBus.ts:4-8`）的字段是 `level`。等级没传进去，会退回默认级别，琥珀色告警提示丢失。

修法：改 `level: 'warning'`。

### 3. addLog 枚举写错（`ViewerPanel.vue:4177`、`:4203`，`a78509a9`）

`consoleStore.addLog('warn', ...)`，而 `LogType`（`src/composables/useConsoleStore.ts:3`）是 `'input' | 'output' | 'error' | 'info' | 'warning'`，没有 `'warn'`。落进 `ConsolePanelDock.vue:103` 的 `'warning'` 分支之外，丢琥珀色样式。

修法：改 `'warning'`。

## 五、值得记住的几处判断

- **`InitiateReviewPanel.vue:425` 手写局部类型**：手写了一份 `embedModeParams` 子集，漏了 `workflowRole` / `launchInput` / `workflowMode` / `externalWorkflowMode`。而 `:129`、`:400-405` 真实解析并填充 `launchInput`，`DockLayout.vue:1493-1501` 的读取是有效的——只是类型上看不见。改用共享的 `EmbedModeParams`，一处解决 3 条。
- **`AnnotationOverlayBar` 的 `ToolsApi`**：`ready` / `statusText` 由 `useDtxTools` 以 `computed()` 给出（`ComputedRef`），声明成可写 `Ref` 会让返回对象不满足类型。改 `Readonly<Ref<>>`，同时收下 `ComputedRef` 与测试里的 `ref()`。
- **`ReviewConfirmSnapshotPayload` 的 `unknown[]` 是有意设计**（`src/api/reviewApi.ts:294-298` 有注释：后端历史记录结构可能更旧）。不要为了消错误去改它；照 `ReviewConfirmation.vue:153-159` 的写法，在写入侧按 Store 真实类型标注。
- **`lffParser.ts:270` 的 `boundingWidth: bounds.maxX`** 按字面应为 `maxX - minX`，但与参考实现 `SolveSpaceVectorFont.ts:463` 一致，全仓无其他读取方，判定为照搬的既有约定，**未改**。
- **lib 停在 ES2020**：`String.prototype.replaceAll`、`Object.hasOwn`、`ErrorOptions` 都不可用。等价替换为 `replace(/x/g, ...)`、`Object.prototype.hasOwnProperty.call`、去掉 `super()` 第二参数。

## 六、验证

```
npx vue-tsc --build --force --pretty false   → 0 error
npx vitest run                               → 423 files / 4170 passed, 0 failed
npm run type-check                           → 当前 0 条 / 基线 0 条 / 新增 0
```

双胞胎面板 5 套回归（AGENTS.md 要求）每批都跑，baseline 与 after 同为 137 passed，**无新增 fail**。

收尾又补了两项（2026-11-02）：

```
npm run build        → ✓ built in 23.07s，末尾「当前 0 条错误 / 基线 0 条 / 新增 0」
npx eslint <本计划改过的 81 个文件> --max-warnings 0  → exit 0，无输出
```

**关于 `npm run lint` 全量跑出的 114 error**：全部来自未跟踪的 `.cursor/skills/impeccable/scripts/*.js`（`git ls-files` 查不到该路径，属本机工具脚本，不入库）。另外 `src/harness/*` 的 13 条是 `vue/one-component-per-file` **warning**，HEAD 就存在（`annotTools.ts` 那 3 条已用文件级 `eslint-disable` 注明理由）。这两类都与本计划无关，**没有为它们改代码**。

## 七、边界

- 未碰别人未提交的 `.kiro/specs/.../design.md`、`src/dimension/kernel/layout/polar/place/`。
- `src/dimension/viewport/dimensionViewport.ts` 与其测试里有别人未提交的 W4-1 节流改动，**已从暂存中剔除**，未提交；该改动后由另一会话以 `42f50b29` 单独提交。
- 未改任何 `tsconfig*.json`，未用 `as any` / `as unknown as` / `!` / `@ts-expect-error`。
- 未推送、未合 `publish`、未部署。
