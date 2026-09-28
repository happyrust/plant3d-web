# 管道距离测量与标注增强 · 实施计划 · 2026-05-18

> 用户反馈：审核「管道与管道之间的测量」当前体验，**希望支持框选一批 BRAN 自动批量计算并标注它们的平行距离**。本计划在仓库现有 `PipeDistanceDrawer` + `usePipeDistanceStore` + `detectPipeClearances` + `usePipeDistanceAnnotationThree` + `LinearDimension3D` 基础上做 4 项可独立交付的增强，避开大重构、保持现有契约不变。
>
> **执行者：** 任意熟悉 Vue 3 + Three.js + Vitest 的工程师 / agent。每个 PR 内步骤 ≈ 5–15 分钟，TDD + 高频 commit。
> **范围：** 单仓 `plant3d-web`，**不**触 `plant-model-gen` 或 `rs-core`。
> **关键依赖：** 本会话之前已落地的「云线 / 矩形 / OBB 双击图钉 collapsed」commit `359932d` / `2d3d0a7`，验收基线复用其 vitest 与 lint 工作流。

---

## 0. 背景

### 0.1 现状

入口：Ribbon「MBD 标注」段「管道距离」按钮（`ribbonConfig.ts:254` commandId `panel.pipeDistance`）→ 右侧抽屉 `PipeDistanceDrawer.vue`（320px）。

| 层级 | 文件 | 当前能力 |
|---|---|---|
| 算法 | `src/utils/three/geometry/clearance/detectPipeClearances.ts` | 输入 `Record<branRefno, segments[]>` + maxDistance + maxAngle，输出 `Clearance[]{ id, distance(mm), pipe1_refno, pipe2_refno, start, end }` |
| Store | `src/composables/usePipeDistanceStore.ts` | `selectedBranRefnos: string[]` / `maxDistance` / `maxAngle` / `results` / `runDetection()`（拉 `getMbdPipeAnnotations`，再调算法）/ `activeResultIndex` |
| 3D 标注 | `src/composables/usePipeDistanceAnnotationThree.ts` | 每个 result 实例化一个 `LinearDimension3D({ start, end, text: '${distance}', color: 0xff6b00 })` 加入 `viewer.scene` |
| 抽屉 UI | `src/components/pipe-distance/PipeDistanceDrawer.vue` | 「选择 BRAN 管道」按钮 → `startPickRefno(['BRAN'], cb)`（**单点点击**模式）；参数表单；检测按钮；结果列表（距离 + 管道对 + 点击飞行定位） |
| 拾取 | `src/composables/useToolStore.ts:1033` `startPickRefno(nounFilter, onConfirm)` | 进入 `toolMode='pick_refno'`，单点点击累加 refnos，Enter 确认回调 |

### 0.2 现有 UX 痛点

1. **缺乏框选**：当前只能逐根点击 BRAN，10 根以上极其低效；抽屉文案"框选 BRAN 管道"实际是误导（实为点击）
2. **告警语义弱**：5 条距离结果全用 `#FF6B00`，无视严重度梯度；用户难以一眼识别"小于安全净距"的危险对
3. **标注可读性**：`LinearDimension3D` 默认 label 无背景填充，叠在深色管道上反差不足；text 仅显示整数，缺单位 `mm` 后缀
4. **批量管理弱**：检测结果只能"清空"或"全部显示"，不能按距离阈值筛选、不能逐条关闭

### 0.3 框选能力技术储备（仓库已有）

- `DTXSelectionController.boxSelect(rect)` (`src/utils/three/dtx/selection/DTXSelectionController.ts:290`)：视锥框选所有 objectId，已被 `DtxCompatViewer.spec.ts:38/56` 覆盖
- `useDtxTools.boxSelectState` + `onCanvasPointerDown/Move/Up` 框选事件框架，目前只接到 `annotation_obb` / `annotation_cloud` 两个工具模式
- `useToolStore.startPickRefno` 的 `pickRefnoFilter` 已经支持 `nounFilter` 数组（例如 `['BRAN']`），可以复用

### 0.4 关联规约 / 文档

- `开发文档/三维校审/screenshots/2026-04-19-pms-review/cdp/` 系列截图与本主题无关，仅作为 viewer 风格参照
- `assets/pipe-distance-annotation-aveva-e3d-2026-05-18.png` 本次方案的视觉目标效果图（AVEVA E3D 风格、含告警色升级、含 HUD 二级菜单）

---

## 1. 目标 / 非目标

### 1.1 目标

1. **PR-1（标注视觉对齐效果图）**：`LinearDimension3D` label 加 mm 单位后缀、加实心矩形背景白字，与效果图对齐；零迁移成本，独立交付。
2. **PR-2（距离严重度颜色分级）**：按距离梯度自动选 3 档颜色——`<100mm` 红橙告警 `#FF3D00`、`100–300mm` 默认橙 `#FF6B00`、`>300mm` 暖白提示 `#FFB74D`；与上层批注 severity 概念对齐但不耦合。
3. **PR-3（框选 BRAN 拾取）**：新增 `toolMode='pick_refno_box'` + `startBoxPickRefno(nounFilter, onConfirm)` action；在 `useDtxTools` 接入 marquee → `DTXSelectionController.boxSelect` → 按 nounFilter 过滤的完整链路；`PipeDistanceDrawer` 加「拖框选择 BRAN」按钮。
4. **PR-4（结果筛选 / 逐条切换）**：抽屉结果区加「距离阈值滑块」与「单条隐藏 / 显示开关」，让用户能聚焦关心的距离范围。
5. **不引入新增 fail**：双胞胎 5 套件 + DockLayout + cloudCollapsed + 新增 pipe-distance 用例汇总相对本计划起点 baseline 不新增 fail。
6. **零跨仓改动**：不动 plant-model-gen 后端 `mbdPipeApi`；不动 surrealdb schema；不动 rsync 部署脚本。

### 1.2 非目标

- **不**改 `detectPipeClearances` 算法本身（保持几何契约）
- **不**改 `getMbdPipeAnnotations` 后端接口
- **不**把 collapsed 概念引入管道距离结果（与批注 collapsed 是两套语义）
- **不**在 viewer 里新加可拖动 label（保留 `LinearDimension3D` 静态位置）
- **不**在本计划同时做"标注持久化到任务"（属另一个工程主题）
- **不**改 `usePipeDistanceStore` 的 `results` ref 形状（增量加可选字段允许，破坏性改动不允许）

---

## 2. 架构方案

### 2.1 PR 拆分总览

| PR | 主题 | 文件数 | 估算行数 | 估算工时 | 风险 |
|---|---|---|---|---|---|
| PR-1 | label 视觉对齐：mm 单位 + 实心背景 | 1 | +5/−2 | 20 min | 低 |
| PR-2 | 距离严重度三档配色 | 2 | +30/−2 | 40 min | 低 |
| PR-3 | 框选 BRAN 拾取链路 | 5 | +120/−10 | 1.5 h | 中 |
| PR-4 | 结果筛选 + 单条开关 | 2 | +80/−5 | 1 h | 中 |
| **合计** | — | **6 个独立文件** | **+235/−19** | **~3.5 h** | — |

每个 PR 都可以独立 merge / push / 部署，前后无强依赖（PR-2 与 PR-1 可并行；PR-3 与 PR-4 可并行）。

### 2.2 关键决策

#### PR-1 视觉对齐：选 A·改 LinearDimension3D 调用方

候选：
- A. 在 `usePipeDistanceAnnotationThree.ts` 调用处把 `text: '${distance}'` 改成 `text: '${distance} mm'`，并新加 `labelBackgroundColor: 0xff6b00` / `labelTextColor: 0xffffff` 两个可选 props，让 `LinearDimension3D` 支持背景填充。
- B. 改 `LinearDimension3D` 默认行为加白字 + 实心背景（影响所有调用方）。

**选 A**：本计划只影响管道距离场景，不引发跨调用方意外回归。`LinearDimension3D` 已被 `measurement` / `dimension` / `pipeClearance` 多处用，全局默认变更风险高。

#### PR-2 颜色梯度：选 B·算法层提供严重度建议 + 视觉层映射颜色

候选：
- A. 在 `detectPipeClearances` 输出加 `severity: 'critical' | 'normal' | 'info'` 字段。
- B. 在 `usePipeDistanceAnnotationThree` 层根据 distance 阈值映射颜色，store 与算法不变。

**选 B**：保持算法层纯几何契约，UI 层做语义判定；阈值 100mm / 300mm 写在 composable 顶部常量，易调；后续若要让 store 也用 severity 字段，再走 A 升级。

#### PR-3 框选拾取：选 A·新增独立 `pick_refno_box` 工具模式

候选：
- A. 新增 `toolMode='pick_refno_box'` 与原 `pick_refno` 并存；触发后用户拖框 → frustum → 按 nounFilter 过滤 → 累加进 `pickedRefnos` → Enter 确认。
- B. 改造 `pick_refno` 让它同时支持单击 + 拖框，按事件长度判断。

**选 A**：与现有 `annotation_obb` / `annotation_cloud` 拖框模式的事件路由结构一致，`onCanvasPointerDown/Move/Up` 仅追加一个 `case`；事件含义清晰，不会与单击拾取产生混淆；测试单元也独立。

#### PR-4 结果筛选：选 A·UI-only

候选：
- A. 在 `PipeDistanceDrawer` 内部用 computed 过滤 `store.results.value`；store 不变；3D 标注响应 hidden 集合。
- B. 在 `usePipeDistanceStore` 加 `hiddenResultIds` 与 `distanceFilter` ref，UI 与 3D 都从 store 读。

**选 B**（修正）：3D `usePipeDistanceAnnotationThree` 当前 watch `results / showAnnotations`，需要 store-level 状态才能联动 hide；如果只在 UI 层过滤，3D 标注不会同步。因此 store 加 `hiddenResultIds: Set<string>` + `distanceFilter: { min, max } | null` 两个 ref；composable 渲染时过滤；UI 也读同一份。

### 2.3 数据与类型补充

```ts
// usePipeDistanceStore.ts 增量字段（PR-2 / PR-4）
type PipeDistanceResult = {
  // 现有字段不变
  id: string;
  distance: number;
  pipeA: string;
  pipeB: string;
  start: Vec3;
  end: Vec3;
};

// PR-4：新增 store-level 控制
const hiddenResultIds = ref<Set<string>>(new Set());
const distanceFilter = ref<{ min: number; max: number } | null>(null);

// PR-2：纯函数（不入 store，UI 层计算）
function resolvePipeDistanceSeverityColor(distance: number): {
  lineColor: number;
  labelColor: number;
  severity: 'critical' | 'normal' | 'info';
} {
  if (distance < 100) return { lineColor: 0xff3d00, labelColor: 0xff3d00, severity: 'critical' };
  if (distance > 300) return { lineColor: 0xffb74d, labelColor: 0xffb74d, severity: 'info' };
  return { lineColor: 0xff6b00, labelColor: 0xff6b00, severity: 'normal' };
}
```

---

## 3. 文件级变更清单

| 文件 | PR | 操作 | 估算行数 |
|---|---|---|---|
| `src/composables/usePipeDistanceAnnotationThree.ts` | PR-1 / PR-2 | 修改 | +25/−5 |
| `src/composables/usePipeDistanceStore.ts` | PR-4 | 修改 | +40/−2 |
| `src/components/pipe-distance/PipeDistanceDrawer.vue` | PR-3 / PR-4 | 修改 | +90/−8 |
| `src/composables/useToolStore.ts` | PR-3 | 修改 | +30/−2 |
| `src/composables/useDtxTools.ts` | PR-3 | 修改 | +50/−0 |
| `src/utils/three/annotation/LinearDimension3D.ts`（如需新 props） | PR-1 | 修改 | +15/−0 |
| `src/composables/usePipeDistanceStore.severity.test.ts`（新） | PR-2 | 新增 | +50 |
| `src/composables/useToolStore.boxPickRefno.test.ts`（新） | PR-3 | 新增 | +60 |
| `docs/CHANGELOG.zh-CN.md` | 全部 | 修改 | +35 |
| `docs/plans/2026-05-18-pipe-distance-annotation-enhancement-plan.md` | 本文件 | 新增 | +400 |

⚠️ **不修改**：`detectPipeClearances.ts` / `mbdPipeApi.ts` / `usePipeDistanceAnnotationThree.test.ts`（如已存在）默认不动。

---

## 4. 实施步骤（TDD · 每步可独立 commit）

### Task 1 · 起点 baseline 锁定

- [ ] **Step 1.1** 跑 baseline 测试套
  ```bash
  npx vitest run \
    src/composables/useToolStore.cloudCollapsed.test.ts \
    src/composables/useDtxTools.pickRefno.test.ts \
    src/components/DockLayout.test.ts \
    src/components/review/ReviewPanel.test.ts \
    src/components/review/DesignerCommentHandlingPanel.test.ts \
    2>&1 | tee .tmp-vitest-pipe-distance-baseline.txt
  ```
  记录 baseline pass/fail；以本计划起点 commit `3ca20ec` 为基线。

- [ ] **Step 1.2** type-check 全工程：`npm run type-check`。预期 0 error；非 0 必须先处理再继续。

---

### Task 2 · PR-1 标注视觉对齐（label mm 单位 + 实心矩形背景）

- [ ] **Step 2.1** 读 `src/utils/three/annotation/LinearDimension3D.ts`，定位 label 渲染处的颜色 / 背景配置。
- [ ] **Step 2.2** 给 `LinearDimension3D` 加可选 props `labelBackgroundColor?: number` / `labelTextColor?: number`；默认 undefined 时保持当前行为（向后兼容）。
- [ ] **Step 2.3** 修改 `usePipeDistanceAnnotationThree.ts`：
  ```ts
  const dim = new LinearDimension3D({
    start: new Vector3(...result.start),
    end: new Vector3(...result.end),
    text: `${result.distance} mm`, // PR-1：加单位后缀
    color: 0xff6b00,
    textColor: 0xffffff,            // PR-1：实心背景搭配白字
    labelBackgroundColor: 0xff6b00, // PR-1：新增 props
  });
  ```
- [ ] **Step 2.4** `npm run type-check` + `npx eslint src/composables/usePipeDistanceAnnotationThree.ts src/utils/three/annotation/LinearDimension3D.ts`，0 error 0 warning。
- [ ] **Step 2.5** commit
  ```
  git commit -m "feat(pipe-distance): add mm suffix and solid label background to clearance annotations"
  ```

---

### Task 3 · PR-2 距离严重度三档配色

- [ ] **Step 3.1** 写失败的单测 `src/composables/usePipeDistanceStore.severity.test.ts`：
  ```ts
  describe('resolvePipeDistanceSeverityColor', () => {
    it('distance < 100 → critical 红橙', () => {
      const r = resolvePipeDistanceSeverityColor(85);
      expect(r.severity).toBe('critical');
      expect(r.lineColor).toBe(0xff3d00);
    });
    it('100 ≤ distance ≤ 300 → normal 主橙', () => {
      const r = resolvePipeDistanceSeverityColor(200);
      expect(r.severity).toBe('normal');
      expect(r.lineColor).toBe(0xff6b00);
    });
    it('distance > 300 → info 暖白', () => {
      const r = resolvePipeDistanceSeverityColor(320);
      expect(r.severity).toBe('info');
      expect(r.lineColor).toBe(0xffb74d);
    });
    it('边界 100 / 300 含端取 normal', () => {
      expect(resolvePipeDistanceSeverityColor(100).severity).toBe('normal');
      expect(resolvePipeDistanceSeverityColor(300).severity).toBe('normal');
    });
  });
  ```
- [ ] **Step 3.2** 跑测试验证 RED：4 条 fail（function 未导出）。
- [ ] **Step 3.3** 在 `usePipeDistanceAnnotationThree.ts` 顶部加 `resolvePipeDistanceSeverityColor` 纯函数并 export；渲染时替换硬编码 `0xff6b00` 为 `resolvePipeDistanceSeverityColor(result.distance)`。
- [ ] **Step 3.4** 跑测试验证 GREEN。
- [ ] **Step 3.5** type-check + lint。
- [ ] **Step 3.6** commit
  ```
  git commit -m "feat(pipe-distance): severity-based color grading (<100/<300/≥300mm) for clearance lines"
  ```

---

### Task 4 · PR-3 框选 BRAN 拾取（核心 UX 提升）

- [ ] **Step 4.1** 写失败的单测 `src/composables/useToolStore.boxPickRefno.test.ts`：
  ```ts
  describe('startBoxPickRefno', () => {
    it('设置 toolMode 为 pick_refno_box 与 nounFilter', () => {
      const store = useToolStore();
      const cb = vi.fn();
      store.startBoxPickRefno(['BRAN', 'EQUI'], cb);
      expect(store.toolMode.value).toBe('pick_refno_box');
      expect(store.pickRefnoFilter.value).toEqual(['BRAN', 'EQUI']);
    });
    it('confirmPickRefno 在 box 模式下也清空并回调', () => {
      const store = useToolStore();
      const cb = vi.fn();
      store.startBoxPickRefno(['BRAN'], cb);
      store.pickedRefnos.value = ['BRAN-001', 'BRAN-002'];
      store.confirmPickRefno();
      expect(cb).toHaveBeenCalledWith(['BRAN-001', 'BRAN-002']);
      expect(store.toolMode.value).toBe('none');
    });
  });
  ```
- [ ] **Step 4.2** 在 `useToolStore.ts` 加 `startBoxPickRefno(nounFilter, onConfirm)` action；与 `startPickRefno` 共享 `pickedRefnos / pickRefnoFilter / pickRefnoCallback`。
- [ ] **Step 4.3** 在 `useDtxTools.ts` 的 `onCanvasPointerDown/Move/Up` 加 `case 'pick_refno_box'` 分支：
  - PointerDown：`beginMarquee(canvas, e, 'pick_refno_box')`
  - PointerMove：`moveMarquee`
  - PointerUp：`endMarquee` 后调 `compatViewer.scene.boxSelect(rect)`，对返回的 objectIds 用 `parseRefnoFromDtxObjectId` 解析 refno，按 `store.pickRefnoFilter.value` 过滤 noun，全部 push 进 `store.pickedRefnos`
- [ ] **Step 4.4** `PipeDistanceDrawer.vue` 在「选择 BRAN 管道」按钮旁加「拖框选择 BRAN」按钮：
  ```vue
  <button @click="startBoxPickBran">
    <SquareDashed class="h-4 w-4" />
    拖框选择 BRAN
  </button>
  ```
  对应 handler 调 `toolStore.startBoxPickRefno(['BRAN'], (refnos) => refnos.forEach((r) => store.addBranRefno(r)))`。
- [ ] **Step 4.5** 跑测试验证 GREEN（boxPickRefno 单测）。
- [ ] **Step 4.6** type-check + lint。
- [ ] **Step 4.7** 本地手测：
  - 打开「管道距离」抽屉 → 点击「拖框选择 BRAN」→ 在 viewer 拖框 → 观察被框中的 BRAN 全部进入抽屉列表 → 点「重新检测」→ 看到尺寸标注
- [ ] **Step 4.8** commit
  ```
  git commit -m "feat(pipe-distance): box-select BRAN pipes via marquee drag (pick_refno_box mode)"
  ```

---

### Task 5 · PR-4 结果筛选与单条切换

- [ ] **Step 5.1** `usePipeDistanceStore.ts` 加 `hiddenResultIds: Ref<Set<string>>` 与 `distanceFilter: Ref<{ min, max } | null>`；加 helpers `toggleResultVisible(id)` / `clearHidden()` / `setDistanceFilter(min, max)` / `clearDistanceFilter()`。
- [ ] **Step 5.2** 在 `runDetection` 末尾 reset `hiddenResultIds.value = new Set(); distanceFilter.value = null;`，每次重新检测清空旧筛选。
- [ ] **Step 5.3** `usePipeDistanceAnnotationThree.ts` 渲染前过滤：
  ```ts
  const filtered = results.value.filter((r) => {
    if (hiddenResultIds.value.has(r.id)) return false;
    if (distanceFilter.value) {
      if (r.distance < distanceFilter.value.min) return false;
      if (r.distance > distanceFilter.value.max) return false;
    }
    return true;
  });
  ```
- [ ] **Step 5.4** `PipeDistanceDrawer.vue` 结果区上方加双向滑块控件（距离 min/max），结果行末尾加 eye 图标按钮 toggle hidden。
- [ ] **Step 5.5** type-check + lint。
- [ ] **Step 5.6** commit
  ```
  git commit -m "feat(pipe-distance): distance range filter + per-row visibility toggle"
  ```

---

### Task 6 · 跨主题回归

- [ ] **Step 6.1** 双胞胎 5 套件 + DockLayout + cloudCollapsed + 新增管道用例汇总
  ```bash
  npx vitest run \
    src/components/review/ReviewPanel.test.ts \
    src/components/review/DesignerCommentHandlingPanel.test.ts \
    src/components/review/AnnotationTableView.test.ts \
    src/components/review/reviewerWorkbenchViewModeBus.test.ts \
    src/components/review/annotationWorkspaceModel.test.ts \
    src/components/DockLayout.test.ts \
    src/composables/useToolStore.cloudCollapsed.test.ts \
    src/composables/usePipeDistanceStore.severity.test.ts \
    src/composables/useToolStore.boxPickRefno.test.ts \
    2>&1 | tee .tmp-vitest-pipe-distance-after.txt
  ```
  与 baseline diff，确认 0 新增 fail。
- [ ] **Step 6.2** `npm run type-check` 0 error。
- [ ] **Step 6.3** `npm run lint`：原 baseline 499 errors 集中在 wiki/ 归档，不新增即可。
- [ ] **Step 6.4** 本地手测路径（按 PR 验收）：
  - PR-1：检测后看到 label 含 "85 mm" 单位 + 橙色实心矩形背景白字
  - PR-2：85 mm 红橙，215 mm 主橙，320 mm 暖白
  - PR-3：拖框可批量选 BRAN
  - PR-4：调滑块到 100–300 仅显示中段距离；点 eye 隐藏单条

---

### Task 7 · 文档 / CHANGELOG / 部署

- [ ] **Step 7.1** `docs/CHANGELOG.zh-CN.md` 2026-05-18 段顶部加新主题块：
  ```markdown
  ### 管道距离测量与标注增强

  - PR-1 label 加 mm 单位后缀 + 实心橙色矩形背景白字（与设计稿 `assets/pipe-distance-annotation-aveva-e3d-2026-05-18.png` 对齐）
  - PR-2 距离严重度三档配色：<100mm 红橙告警 / 100–300mm 主橙 / >300mm 暖白
  - PR-3 拖框选择 BRAN：新增 `toolMode='pick_refno_box'` + `startBoxPickRefno`，在 PipeDistanceDrawer 增加「拖框选择 BRAN」按钮
  - PR-4 结果筛选 + 单条切换：抽屉加距离范围滑块与每行 eye 显隐按钮
  - 验证：双胞胎 5 + DockLayout + cloudCollapsed + 新增 pipe-distance 用例汇总 0 新增 fail；type-check 0 error
  ```
- [ ] **Step 7.2** 单独 commit doc
  ```
  git commit -m "docs(pipe-distance): record pipe distance annotation enhancement plan in zh-CN changelog"
  ```
- [ ] **Step 7.3** push origin/main 所有 commit
- [ ] **Step 7.4** 触发 GitHub Actions `Deploy Frontend To Ubuntu` workflow，等 1m30s 验证 `http://123.57.182.243/version.json` commit 同步

---

## 5. 验收清单（合并前必过）

- [ ] `npm run type-check` 0 error
- [ ] 新增 `usePipeDistanceStore.severity.test.ts` + `useToolStore.boxPickRefno.test.ts` 全 PASS
- [ ] 汇总测试套件相对 baseline 0 新增 fail
- [ ] PR-1 / PR-2 / PR-3 / PR-4 4 项手测路径全部通过
- [ ] `docs/CHANGELOG.zh-CN.md` 已更新
- [ ] 部署到 123.57.182.243，`/version.json` commit 同步
- [ ] 提交历史清晰：6 条独立 commit（4 PR + 测试 commit 可并入对应 PR + 1 doc）
- [ ] PR 描述写明 baseline vs after pass/fail 差量

---

## 6. 风险与缓解

| 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|
| `LinearDimension3D` 新增 props 让其他调用方意外渲染白字 | 中 | 低 | 默认 undefined，保持向后兼容；只在 `usePipeDistanceAnnotationThree` 显式传值 |
| `pick_refno_box` 与已有 `annotation_obb` / `annotation_cloud` marquee 互相干扰 | 中 | 中 | 三个 case 互斥不可并存（toolMode 单一），事件路由按 mode switch case；测试覆盖 mode 切换 |
| `boxSelect` 返回 objectId 中含非 BRAN noun（如 EQUI / VALV） | 中 | 高 | `pickRefnoFilter.value` 在 useDtxTools 内显式过滤 noun 再 push 进 pickedRefnos |
| 大量 BRAN 框选导致 `getMbdPipeAnnotations` 并发拉取阻塞 | 中 | 中 | 不在本计划处理；后续 PR 可加 batch endpoint 或并发数限制 |
| 距离阈值常量（100mm / 300mm）写死可能与某些项目规范不符 | 低 | 中 | 写在 composable 顶部常量，未来可改为 store-level configurable |
| 拖框模式下 viewer 自身的相机操作（中键旋转 / 滚轮缩放）冲突 | 中 | 低 | 复用现有 marquee 机制（已与 obb / cloud 共存，已验证）；左键拖框，中键 / 滚轮不拦截 |

---

## 7. 回滚预案

每个 PR 独立 commit 可单独 revert。最坏情况：

```bash
# 全部回滚（按 commit 倒序）
git revert <commit-doc> <commit-pr4> <commit-pr3> <commit-pr2> <commit-pr1>
```

回滚后管道距离功能回到现状（单点拾取 + 单一橙色 + 无单位 + 无筛选）。无破坏性数据迁移。

---

## 8. 后续建议（不在本计划范围）

- **下一 PR · 批量 API**：`getMbdPipeAnnotations` 增加 batch endpoint，一次拉多个 BRAN 的 segments，减少并发数。
- **下一 PR · 算法 severity 字段**：把 PR-2 的 `resolvePipeDistanceSeverityColor` 提到算法层，给 `Clearance` 加 `severity` 字段，让 PMS 联调 / 后端持久化都能识别。
- **下一 PR · 距离阈值可配置**：阈值常量 100mm / 300mm 提到 store 或项目级 settings，按行业规范覆盖默认值。
- **下一 PR · 结果导出**：抽屉加「导出 CSV」按钮，对齐 `AnnotationTableView` 的导出能力。
- **下一 PR · 标注与批注联动**：管道距离 critical 项自动生成一条 cloud annotation，纳入校审流程。
- **CI 升级**：把本计划新增的 `usePipeDistanceStore.severity.test.ts` + `useToolStore.boxPickRefno.test.ts` 加入 PR check 必跑列表。

---

## 9. 关键文件锚点速查

| 用途 | 文件:行 |
|---|---|
| 算法（不动） | `src/utils/three/geometry/clearance/detectPipeClearances.ts` |
| Store（PR-4 改） | `src/composables/usePipeDistanceStore.ts` |
| 3D 渲染（PR-1 / PR-2 改） | `src/composables/usePipeDistanceAnnotationThree.ts:24-30` |
| LinearDimension3D 类（PR-1 改） | `src/utils/three/annotation/LinearDimension3D.ts` |
| 抽屉 UI（PR-3 / PR-4 改） | `src/components/pipe-distance/PipeDistanceDrawer.vue:40-46 / :137-169` |
| 拾取 store action（PR-3 改） | `src/composables/useToolStore.ts:1033-1061` |
| DTX 框选控制器（不动） | `src/utils/three/dtx/selection/DTXSelectionController.ts:290-322` |
| useDtxTools 事件路由（PR-3 改） | `src/composables/useDtxTools.ts:4338-4430` |
| Ribbon 入口（不动） | `src/ribbon/ribbonConfig.ts:254` |
| Viewer 挂载点（不动） | `src/components/dock_panels/ViewerPanel.vue:23, :4734` |
| 效果图（视觉目标） | `assets/pipe-distance-annotation-aveva-e3d-2026-05-18.png` |

---

## 10. 时间估算

| Task | 估时 |
|---|---|
| 1 · Baseline | 15 min |
| 2 · PR-1 label 视觉对齐 | 20 min |
| 3 · PR-2 严重度配色 + RED-GREEN | 40 min |
| 4 · PR-3 框选 BRAN + RED-GREEN | 1.5 h |
| 5 · PR-4 结果筛选 + 单条切换 | 1 h |
| 6 · 跨主题回归 | 25 min |
| 7 · 文档 + CHANGELOG + 部署 | 25 min |
| **合计** | **~4 h**（含 review buffer） |

---

## 11. 执行记录（占位）

> 实施后按 `docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` §11 的格式填入：每个 PR 的 commit hash / baseline vs after pass/fail / 手测截图 / 部署 commit。

---

> **执行结束后：** 用户在「管道距离」抽屉里可以拖框批量选 BRAN，自动计算并渲染分级配色的 mm 单位尺寸标注；可滑动调距离阈值或单条隐藏；视觉效果对齐 `assets/pipe-distance-annotation-aveva-e3d-2026-05-18.png` 设计稿。
