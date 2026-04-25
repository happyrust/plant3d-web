# plant3d-web 类型错误清零计划（2026-04-25 起）

> 2026-04-24 Sprint 期间 `vue-tsc -p tsconfig.app.json` 基线固定为 **537 条错误**；
> 这些错误全部是 pre-existing，不是本轮新增，但基数太大会遮蔽真正的新错误。
> 本计划目标：把 537 降到 50 以下，形成稳定信号；单个 PR/commit 做一个类别，
> 便于回滚。

## 一、基线分类

`vue-tsc --noEmit -p tsconfig.app.json` 2026-04-25 基线：537 条错误。

### 按错误码（TOP 8，覆盖 92%）

| Code | Count | 含义 | 主要根因 |
|------|-------|------|---------|
| TS18048 | 123 | "X is possibly 'undefined'" | `noUncheckedIndexedAccess: true` + 未收窄的 optional prop |
| TS2322 | 107 | 类型不可赋值 | 返回值缺失 guard、外部库类型错配 |
| TS2532 | 94 | "Object is possibly 'undefined'" | 同 TS18048 |
| TS2345 | 52 | 实参类型不匹配 | 常见于测试、mock 调用 |
| TS2339 | 33 | 属性不存在 | 缺 declare module（e.g. troika-three-text）、@types/three 版本错配 |
| TS2740 | 28 | 类型缺少属性 | |
| TS2741 | 18 | 类型缺少属性 | |
| TS2556 | 15 | Spread 实参错误 | |

### 按文件（TOP 15，覆盖 45%）

| File | Count |
|------|-------|
| `src/utils/matrixUtils.ts` | **146** |
| `src/composables/useToolStore.persistence.test.ts` | 15 |
| `src/debug/pmsReviewSimulator.ts` | 15 |
| `src/composables/useToolStore.severity.test.ts` | 11 |
| `src/types/mbdV2.test.ts` | 11 |
| `src/composables/useDtxTools.ts` | 11 |
| `src/utils/pdmsOrientation.ts` | 11 |
| `src/composables/useMbdPipeAnnotationThree.ts` | 10 |
| `src/components/dock_panels/ViewerPanel.vue` | 10 |
| `src/components/review/InitiateReviewPanel.vue` | 9 |
| `src/utils/three/annotation/text/SolveSpaceBillboardVectorText.test.ts` | 9 |
| `src/composables/useDbnoInstancesParquetLoader.test.ts` | 8 |
| `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts` | 8 |
| `src/debug/injectMbdPipeDemo.ts` | 7 |
| `src/components/review/ReviewPanel.test.ts` | 7 |

## 二、治理策略与分批

每批一个 commit，每次 commit 后重跑 vue-tsc 记录减少量。

### Batch 1：matrixUtils.ts ✅ 已完成（-152 行）

- 改 `TransformMatrix` 从 `number[]` → 16 元 tuple（literal 索引 `m[0]…m[15]` 立刻拿到 `number`）
- `multiplyMat4` 里 variable 索引用 `Float64Array` + `!` 断言（长度已知，安全）
- 其他 consumer 文件无需改，因为他们只调 `extractPosition / extractEulerAngles / computeRelativeTransform` 不做索引

### Batch 2：declare module for `troika-three-text`（估 -5~-10）

- 新增 `src/types/troika-three-text.d.ts`，最小 `declare module 'troika-three-text' { export const Text: any; ... }`
- 消 `TroikaBillboardText.ts(2,22) error TS7016`

### Batch 3：useToolStore.persistence.test + severity.test（估 -26）

- 两个测试文件共 26 条 TS2532 "Object is possibly 'undefined'"
- 典型：`const map = new Map(); map.get(key).field` → 改成 `map.get(key)!.field` 或 `expect(map.get(key)).toBeDefined()` 之后缩窄
- 不改业务代码，只改测试断言

### Batch 4：pdmsOrientation.ts（估 -11）

- 我 2026-04-24 P0 Batch 4 新写的文件；里面有 `axes.find()` 返回 undefined 的 guard 缺失
- 认领我自己的债

### Batch 5：LineMaterial.scale + materialConfig.disciplineOverrides 等 three.js 类型错配（估 -20~-30）

- `three/examples/jsm/lines/LineMaterial` 的 `scale` 属性在 @types/three 里缺失；加一个 `.d.ts` augmentation
- `ModelDisplayConfig.disciplineOverrides` 走业务 type 修

### Batch 6：测试层 Object-possibly-undefined 批量清理

- `SolveSpaceBillboardVectorText.test.ts`、`useDbnoInstancesParquetLoader.test.ts`、`useMbdPipeAnnotationThree.flyTo.test.ts`、`mbdV2.test.ts`、`ReviewPanel.test.ts` 等测试里一批 `!` / `toBeDefined` 收窄

### Batch 7：业务代码的 TS2322 收敛

- `useDtxTools.ts` / `ViewerPanel.vue` / `useMbdPipeAnnotationThree.ts` / `InitiateReviewPanel.vue` / `pmsReviewSimulator.ts`
- 这一批是真正的业务修，需要一块一块看

### Batch 8（stretch）：在 `plant3d-web/package.json` 加 `"type-check:strict"` 走 tsconfig.app.json；CI 上卡 0 errors

- 避免后续回归又累积

## 三、进度追踪

| Batch | 预估 | 实际 | 新基线 | commit |
|-------|-----|------|-------|--------|
| 1 matrixUtils（16-tuple + Float64Array） | -146 | **-152** | 537 → 385 | `cb5ea4b` |
| 2 troika declare | -5~-10 | **-1**（仅 1 处 import；vi.mock 不走声明） | 385 → 384 | `d401b2b` (与 Batch 4 合并) |
| 4 pdmsOrientation 空集守卫 + `!` | -11 | **-5**（matrixUtils 修完后只剩 5 条函数内部） | 384 → 379 | `d401b2b` (与 Batch 2 合并) |
| 3 `useToolStore.*.test.ts` 批量加 `!` | -26 | **-26** | 379 → 353 | `84776fc` |
| 5a LineMaterial.scale augment | -8 | **-8** | 353 → 345 | `3ba6553` |
| 5b LineBasicMaterial→LineMaterial 类型不匹配 | ~-30 | **deferred**（看起来是真 bug，需人工裁定） | - | - |
| 6 mbdV2 / flyTo / ReviewPanel / AnnotationPanel / parquetLoader 测试 | -40+ | **-34**（含工作树预热 -8 + 本批 -26；详见 `2026-04-25-typing-cleanup-batch6-execution.md`） | 345 → 311 | `40da2e1` |
| 6.5 SolveSpaceBillboardVectorText.test + 8 个新发现测试 | -49 | (未执行) | - | - |
| 7 业务 TS2322 | -50+ | | | |

**当前累计**：537 → 311（**-226，-42%**）

**本轮发现的待人工裁定项**：
- AlignedDimension / AngleDimension / LinearDimension / SlopeAnnotation / WeldAnnotation / LeaderAnnotation / RadiusDimension 等文件里 `new Line2(geometry, this.materialSet.line)` 传的是 `LineBasicMaterial`，但 `Line2` 要 `LineMaterial` —— 这可能是真 bug：`AnnotationMaterialSet` 里有 `line: LineBasicMaterial` 和 `fatLine: LineMaterial`，这些位置也许本应传 `.fatLine`。不在本自动化清零轮次里处理，交回给做 annotation 渲染的开发。

## 四、风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 改 `TransformMatrix` 类型破坏 consumer | 低 | Batch 1 已验证：`pdmsOrientation.ts / usePdmsConsoleCommands.ts / useSurrealModelQuery.ts` 三个 consumer 不做索引，不受影响 |
| 测试文件加 `!` 断言后掩盖真实 undefined bug | 中 | 只改明确应当非空的位置（e.g. 用 `toBeDefined` 或前置 `set` 过的 key）；不做"所有 get().X 改成 get()!.X"式粗暴替换 |
| three.js d.ts augmentation 跟未来 @types/three 升级冲突 | 低 | augmentation 写在单独 `src/types/` 下，升级时 grep 一下就能发现 |

## 五、完成定义

- 7 个 Batch 各有独立 commit
- `vue-tsc --noEmit -p tsconfig.app.json` 从 537 降到 ≤ 50
- `package.json` 新增 `type-check:strict` 指向 `tsconfig.app.json`（Batch 8）
- 未来新 PR 的 CI 失败与否，能对应到真实的类型错误，而不是 537 条噪音里的一条
