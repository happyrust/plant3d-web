# SolveSpace 尺寸标注统一（方案B）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将全站“尺寸标注”绘制统一为已移植的 SolveSpace 风格三维标注（`LinearDimension3D` / `AngleDimension3D`），并清理残留的旧实现/样式，保证交互与单位缩放一致。

**Architecture:** 以 `src/utils/three/annotation/annotations/*Dimension3D.ts` 为唯一“尺寸标注几何与文字”的绘制实现；`useToolStore.dimensions` 与 MBD 后端 `dims` 均通过适配层创建/更新这些标注对象；Viewer 层只负责交互（拖拽/吸附）与数据写回 store。

**Tech Stack:** Vue 3 + Three.js（`Line2/LineMaterial`）+ `troika-three-text`（3D billboard text）+ Vitest + Playwright。

---

## Scope Clarification（本计划默认）

- “尺寸标注”指：线性尺寸、角度尺寸（以及 MBD 管道输出的 dims）。
- “测量 measurement（距离/角度）”仍保留 DOM overlay（不强制改为 3D 标注），避免范围外扩。

若你希望“测量”也统一成 SolveSpace 风格 3D 尺寸标注，可在执行前扩展任务集。

---

### Task 1: 代码基线验证（确保改动前可复现）

**Files:**
- Modify: (none)
- Test: `npm test`, `npm run type-check`

**Step 1: 运行单测**

Run: `npm test`
Expected: 全部 PASS（若失败，先记录失败用例与报错栈）。

**Step 2: 运行类型检查**

Run: `npm run type-check`
Expected: 0 errors.

---

### Task 2: 统一“偏移方向”计算为可复用工具（避免多处手写逻辑漂移）

**Files:**
- Create: `src/utils/three/annotation/utils/computeDimensionOffsetDir.ts`
- Modify: `src/components/dock_panels/ViewerPanel.vue`
- Modify: `src/composables/useDtxTools.ts`
- Modify: `src/composables/useMbdPipeAnnotationThree.ts`
- Test: `src/utils/three/annotation/utils/computeDimensionOffsetDir.test.ts`

**Step 1: 写失败测试（覆盖典型/退化场景）**

Create `src/utils/three/annotation/utils/computeDimensionOffsetDir.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computeDimensionOffsetDir } from './computeDimensionOffsetDir'

describe('computeDimensionOffsetDir', () => {
  it('returns a unit vector perpendicular-ish to segment when camera is provided', () => {
    const a = new THREE.Vector3(0, 0, 0)
    const b = new THREE.Vector3(1, 0, 0)
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(0, 0, 5)

    const d = computeDimensionOffsetDir(a, b, cam)
    expect(d).not.toBeNull()
    expect(Math.abs((d as THREE.Vector3).length() - 1)).toBeLessThan(1e-6)
  })

  it('falls back for near-zero segment', () => {
    const a = new THREE.Vector3(0, 0, 0)
    const b = new THREE.Vector3(0, 0, 0)
    const d = computeDimensionOffsetDir(a, b, null)
    expect(d).toBeNull()
  })
})
```

**Step 2: 运行测试确认失败（函数尚不存在）**

Run: `npm test -- src/utils/three/annotation/utils/computeDimensionOffsetDir.test.ts`
Expected: FAIL（module not found / export missing）。

**Step 3: 写最小实现**

Create `src/utils/three/annotation/utils/computeDimensionOffsetDir.ts`：

```ts
import * as THREE from 'three'

/**
 * 计算尺寸偏移方向（offsetDir）。
 * - 目标：尽量“面向相机”且与线段方向垂直，拖拽/自动布局更接近 SolveSpace 直觉。
 * - 返回 null 表示线段退化（不可用）。
 */
export function computeDimensionOffsetDir(
  start: THREE.Vector3,
  end: THREE.Vector3,
  camera: THREE.Camera | null
): THREE.Vector3 | null {
  const seg = end.clone().sub(start)
  if (seg.lengthSq() < 1e-12) return null
  seg.normalize()

  // cameraDir: from mid to camera
  const mid = start.clone().add(end).multiplyScalar(0.5)
  const camPos = (camera as any)?.position as THREE.Vector3 | undefined
  const camDir = camPos ? camPos.clone().sub(mid) : null
  if (!camDir || camDir.lengthSq() < 1e-12) {
    // fallback: XY perpendicular
    const perp = new THREE.Vector3(-seg.y, seg.x, 0)
    if (perp.lengthSq() < 1e-12) return new THREE.Vector3(1, 0, 0)
    return perp.normalize()
  }
  camDir.normalize()

  // n = seg x camDir, perp = n x seg
  let n = seg.clone().cross(camDir)
  if (n.lengthSq() < 1e-12) {
    const up = (camera as any)?.up ? new THREE.Vector3().copy((camera as any).up) : new THREE.Vector3(0, 1, 0)
    n = seg.clone().cross(up.normalize())
  }
  if (n.lengthSq() < 1e-12) return new THREE.Vector3(1, 0, 0)

  const perp = n.cross(seg)
  if (perp.lengthSq() < 1e-12) return new THREE.Vector3(1, 0, 0)
  return perp.normalize()
}
```

**Step 4: 运行测试确认通过**

Run: `npm test -- src/utils/three/annotation/utils/computeDimensionOffsetDir.test.ts`
Expected: PASS。

**Step 5: 替换重复逻辑调用点（不改行为边界）**

- `src/components/dock_panels/ViewerPanel.vue`：用 `computeDimensionOffsetDir` 替代 `computeDimensionOffsetDirectionByCamera`（或保留旧函数但内部转调）。
- `src/composables/useDtxTools.ts`：预览与落盘时用同一 helper，避免 preview 与最终方向不一致。
- `src/composables/useMbdPipeAnnotationThree.ts`：`renderDims` 的 `offsetDir` 计算改用该 helper（相机可用时优先相机；不可用时保持旧 XY fallback）。

**Step 6: 跑全量测试**

Run: `npm test`
Expected: PASS。

---

### Task 3: 统一 MBD 尺寸标注的绘制参数（SolveSpace 风格一致性）

**Files:**
- Modify: `src/composables/useMbdPipeAnnotationThree.ts`
- Test: `src/utils/three/annotation/annotations/LinearDimension3D.test.ts`（如需补充用例）

**Step 1: 明确策略（保持 KISS）**

- offset：从“固定 100（原坐标单位）”调整为“基于长度的比例 + 上下限”，使短段不至于偏移过大、长段不至于贴线难读。
- label：默认 `labelT=0.5` 不变。

**Step 2: 最小实现**

在 `src/composables/useMbdPipeAnnotationThree.ts` 的 `renderDims` 中：
- 用 `d.length`（或 `start.distanceTo(end)`）计算 `offset`，例如：

```ts
const dist = start.distanceTo(end)
const offset = Math.max(50, Math.min(500, dist * 0.15))
```

> 注：这里的数值上下限需按“后端坐标单位”校准（若后端单位为 mm，上限/下限也应以 mm 计）。

**Step 3: 手动回归**

- 在 Viewer 中加载一条 BRAN/HANG：确认 segment/chain/overall/port 四类 dims 都可见且偏移合理。
- 在“单位/重心”切换后：确认 `updateLabelPositions()` 与 `flyTo()` 不错位。

---

### Task 4: 清理方案B下的遗留 CSS（删除候选）

**Files:**
- Modify: `src/assets/main.scss`

**Step 1: 确认无引用**

检查（应为空或仅 main.scss 自身）：字符串 `mbd-label`。

**Step 2: 删除样式块**

删除 `src/assets/main.scss` 中：
- `.mbd-label*` 相关样式（MBD DOM label 已不再使用）。

**Step 3: 运行样式/构建回归**

Run: `npm run build-only`
Expected: build 成功。

---

### Task 5: E2E 冒烟（可选但推荐）

**Files:**
- Use existing: `e2e/` + `playwright.config.ts`

**Step 1: 跑 e2e**

Run: `npm run test:e2e`
Expected: PASS（至少确保 Viewer 能启动、维持渲染循环、无致命报错）。

---

## Completion Checklist

- dimensions（用户创建）与 MBD dims 均通过 `LinearDimension3D`/`AngleDimension3D` 绘制
- 拖拽 offset/labelT 写回 `store.dimensions` 正常（`ViewerPanel.vue`）
- `npm test` + `npm run type-check` 通过
- `mbd-label` 相关 CSS 已删除且无引用

