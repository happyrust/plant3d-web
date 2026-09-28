# typing-cleanup Batch 6 执行计划（2026-04-25）

> 承接 `2026-04-25-typing-cleanup-plan.md` 的 Batch 6（"测试层 Object-possibly-undefined 批量清理"）。
> 主计划仅给出"-40+ 条"的目标范围与候选文件名单；本文件锁定具体落地范围、修复策略、提交边界。

## 一、基线（2026-04-25 实测）

`vue-tsc --noEmit -p tsconfig.app.json`：

| 时刻 | errors | 备注 |
|------|--------|------|
| 主 plan 截止（Batch 5a 后） | 345 | commit `86b4741` 记录值 |
| 本批开工实测 | **337** | 工作树已有两 test 改动 -8（属本批预热） |

按错误码 TOP：
- TS2322 = 97（类型不可赋值）
- TS2345 = 52（实参类型不匹配）
- TS2740/41 = 46（类型缺属性）
- TS2339 = 25（属性不存在）
- TS18048 + TS2532 = 44（possibly undefined）

## 二、本批锁定范围

| 文件 | 错误数 | 处置 | 修法 |
|------|--------|------|------|
| `src/components/tools/AnnotationPanel.test.ts` | 2 | 已在工作树预热 | `[0].x` → `[0]!.x` |
| `src/composables/useDbnoInstancesParquetLoader.test.ts` | 6 | 已在工作树预热 | `[0]?.uniforms.x` → `[0]!.uniforms!.x` |
| `src/types/mbdV2.test.ts` | 11 | 本批做 | 删 `commonFields()` 的 `as const`（让 `node_names: []` 不再窄化为 `readonly []`，能赋给目标 `string[]`） |
| `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts` | 8 | 本批做（其中 1 条改 fixture） | 6 处 `?? 0` / `!`；1 处 `weld_type: 'BW'` → `'Butt'`（fixture 过期，类型已演进为 `'Butt' \| 'Fillet' \| 'Socket' \| 0 \| 1 \| 2`）；1 处 `(annotation: any) =>` |
| `src/components/review/ReviewPanel.test.ts` | 7 | 本批做 | 4 处 spread 参数：`(...args: unknown[])` → `(...args: any[])`（mock 签名改宽）；1 处 `mockImplementationOnce` 用 `as any`；2 处 `toolStoreMock.annotations.value: any[]` 类型放宽 |

**预期消减**：2 + 6 + 11 + 8 + 7 = **34 条**，337 → **303**。

### 不在本批处理（Batch 6.5/7 候选）

| 文件 | 错误数 | 暂缓原因 |
|------|--------|---------|
| `src/utils/three/annotation/text/SolveSpaceBillboardVectorText.test.ts` | 9 | 9 条 TS2740：测试用 `LineBasicMaterial` 给 `materialNormal/Hovered/Selected`，但构造器要 `LineMaterial`。同 Batch 5b "annotation 渲染传错 material" 一类，需要先与渲染开发对齐：测试改成 `new LineMaterial(...)` 还是构造器入参放宽。**deferred 到 Batch 6.5** |
| `src/composables/useReviewStore.confirm.test.ts` | 7 | 新发现，未在主 plan 名单 |
| `src/composables/useReviewStore.websocket.test.ts` | 6 | 同上 |
| `src/composables/useUserStore.test.ts` | 6 | 同上 |
| `src/composables/useUserStore.createReviewTask.test.ts` | 6 | 同上 |
| `src/components/review/embedRoleLanding.test.ts` | 6 | 同上 |
| `src/components/DockLayout.test.ts` | 6 | 同上 |
| `src/components/site/SiteDashboardPanel.test.ts` | 6 | 同上 |
| `src/utils/three/annotation/annotations/RadiusDimension.test.ts` | 6 | 同上 |
| `src/components/review/confirmedRecordsRestore.test.ts` | 6 | 同上 |
| `scripts/pms-contract-sequence.ts` | 10 | 不在 src/ 下，单独处理 |

> Batch 6.5：上面 8 个新发现的测试文件（共 49 条）都是同类的 `!` / 放宽 mock 签名活；执行模式与 Batch 6 一致，目标再消 40+ 条。

## 三、修复策略细则

### 3.1 mbdV2.test.ts（11 → 0）

根因：`commonFields(id)` 返回的对象用了 `as const`，导致 `node_names: []` 被推断为 `readonly []`，`MbdPrimitive` 的 `node_names: string[]`（mutable）拒收。

修法：去掉 `as const`：

```ts
function commonFields(id: string) {
  return {
    id,
    node_names: [] as string[],
    visible: true,
  };
}
```

### 3.2 useMbdPipeAnnotationThree.flyTo.test.ts（8 → 0）

| 行 | 错误码 | 修法 |
|----|--------|------|
| 726 | TS18048 | `params?.direction.angleTo(...)` → `params?.direction!.angleTo(...)` |
| 2834 | TS2322 | `weld_type: 'BW'` → `weld_type: 'Butt'`（类型已演进，fixture 过期） |
| 3000 / 3006 | TS18048 | `initialParams.offset + 200` 和 `expect(...offset).toBe(initialParams.offset + 200)` —— `initialParams` 是 `getParams()` 返回，offset 类型是 `number \| undefined`；改成 `initialParams.offset! + 200` |
| 3017 | TS2345 | `toBeCloseTo(initialParams.offset, 6)` → `toBeCloseTo(initialParams.offset!, 6)` |
| 3159 / 3182 | TS2345 | `toBeCloseTo(chainParamsBefore.offset, 6)` / `toBeCloseTo(cutParamsBefore.offset, 6)` → 同上加 `!` |
| 3290 | TS7006 | `(annotation) => ...` → `(annotation: any) => ...` |

### 3.3 ReviewPanel.test.ts（7 → 0）

| 行 | 错误码 | 修法 |
|----|--------|------|
| 92 / 103 / 104 / 160 | TS2556 | mock 签名 `(...args: unknown[]) => xxxMock(...args)` → `(...args: any[]) => xxxMock(...args)`；或者干脆 `() => xxxMock()` 不转发 |
| 422 | TS2345 | `restoreEmbedFormSnapshotContextMock` hoisted 时类型签名是 `() => Promise<...>`，但实现里取了 `options` 参数。把 hoisted mock 改成接收 `options: any`，或者把 `mockImplementationOnce(callback)` 包一层 `(callback as any)` |
| 764 / 797 | TS2322 | `toolStoreMock.annotations.value` 等被 hoisted 推断成 `{ value: never[] }`，赋值时拒收。把 hoisted `toolStoreMock` 里相应字段显式标 `{ value: [] as any[] }` |

### 3.4 工作树预热（已就绪，不改）

`AnnotationPanel.test.ts` + `useDbnoInstancesParquetLoader.test.ts` 是用户/前轮已经写好的 `!` 收窄改动，本批一并打包提交。

## 四、执行顺序

```
0. 删除工作树误重定向产物：(({i, stdout, x.text.includes('指南'))
1. 修 mbdV2.test.ts                    → 局部 vue-tsc 探测（仅检查文件错误）
2. 修 flyTo.test.ts (含 BW→Butt)        → 局部探测
3. 修 ReviewPanel.test.ts              → 局部探测
4. 全量 vue-tsc                         → 验证 337 → ~303
5. git add 6 个测试文件，commit Batch 6
6. 删 stdout.tsc.txt（自己产生的临时文件）
7. 更新 typing-cleanup-plan.md 进度表
```

## 五、提交规范

- 单 commit：`test(typing): tighten ! / fix mock signatures (Batch 6)`
- body 说明本批 6 个文件、消减 34 条、337→303
- 与主 plan 的进度表保持同步（`86b4741` 之后下一笔进度）

## 六、验证

- `vue-tsc --noEmit -p tsconfig.app.json` 错误数 = **303**（误差 ±2，受其他工作树噪音影响）
- 6 个改动文件无新错误
- 不跑 vitest（按 plant3d-web AGENTS.md 约定，Batch 6 是纯类型修，不需要 runtime 验证；如果 import 顺序错或 fixture 类型错，type-check 已经会报）

## 七、风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| flyTo.test.ts L2834 BW → Butt 实际是真 bug（业务期望 'BW'） | 低 | `MbdWeldType = 'Butt' \| 'Fillet' \| 'Socket' \| 0 \| 1 \| 2` 已经显式列举，'BW' 不在其中是历史 fixture，没有 runtime 影响 |
| ReviewPanel.test.ts L422 mock 签名改宽掩盖真实类型不匹配 | 低 | hoisted mock 本来就是测试基础设施，业务类型严格性靠 `restoreEmbedFormSnapshotContext` 的源声明保证 |
| 全量 vue-tsc 数字飘动（其他文件被改） | 低 | 工作树仅 6 个测试文件 + .cursor/mcp.json + 几个临时文件，无业务改动 |
