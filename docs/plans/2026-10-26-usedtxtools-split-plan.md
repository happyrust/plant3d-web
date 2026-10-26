# `useDtxTools.ts` 拆分方案（7169 行 → 按职责分模块，公开 API 不变）

> 日期：2026-10-26
> 对象：`src/composables/useDtxTools.ts`（审核报告 `docs/investigation/repo-health-audit-2026-10-26.md` P2-11）
> 状态：方案，待拍板；本文不动代码
> 兜底测试：`src/composables/useDtxTools.*.test.ts` 12 个文件 / 4264 行

---

## 0. 结论先行

- 这个文件是两个东西粘在一起：**前 2411 行**是模块级纯函数和类型（约 160 个顶层声明，其中 54 个 `export`，含类型），**2412–7169 行**是一个 4758 行的闭包 `useDtxTools()`，里面 145 个内部函数、52 个闭包级状态、10 个 `watch`。
- 拆法：纯函数按主题搬进 `src/composables/dtxTools/*.ts`（零风险，先做）；闭包按「谁拥有哪些状态」切成 10 个 `createXxx(ctx)` 控制器，共享状态进一个显式的 `DtxToolsContext`；`useDtxTools.ts` 退化为组装器（目标 ≈ 400 行）。
- 不变量：`useDtxTools(options)` 的入参和返回对象形状**一字不改**——`ViewerPanel.vue` 与 `useViewerContext.ts` 不动；12 个测试文件在前 9 步里不改一行；每步独立提交、CI 三门绿、`type-check` 基线只许收紧。
- 分 10 步，每步可以独立停下来；最重的两刀（`syncFromStore` 475 行、`updateOverlayPositions` 505 行）放在第 8 步，前面 7 步把周边清干净后它们才好切。

## 1. 现状

### 1.1 调用方

| 调用方 | 用法 |
|---|---|
| `src/components/dock_panels/ViewerPanel.vue` L3872 | 唯一的 `useDtxTools({...})` 调用；直接用到的成员：`onCanvasPointerDown / Move / Up / Cancel`、`updateOverlayPositions`、`refreshReadyState`、`statusText`、`cyclePickCandidate`、`rollbackCloudCreationStep`、`cancelMeasurementInteraction`、`removeMeasurement`、`dispose` |
| `src/composables/useViewerContext.ts` | 只取类型 `ReturnType<typeof useDtxTools>`，把 `tools` 作为 `ShallowRef` 分发给各面板 |
| 12 个 `useDtxTools.*.test.ts` | 9 个走 `useDtxTools({...stub})` 跑真实闭包；`cloudFit`、`pipeMeasure` 只测纯函数，`pickRefno` 大半也是 |
| `useAnnotationStyleStore.test.ts` | 动态 import `buildAnnotationLeaderStyle` |

返回对象 55 个成员（L7089–7168），分五组：状态（`ready / statusText / objectToObjectUiState / pendingCloudAnchor / cloudGateBlock / pickCandidates / pickCandidateIndex / selectionStore`）、面板动作（`flyTo* / remove* / highlight*`）、云线创建闸门、指针钩子，以及 **17 个 `debug*` / 测试钩子**（`debugCloud*`、`setHoveredCloudAnnotation`、`beginInlineOverlayAnnotationDrag` 系列等）。

### 1.2 文件分段（按当前行号）

模块级部分：

| 行段 | 内容 | 行数 |
|---|---|---|
| 1–137 | import（约 50 个来源：vue / three / meshline / 13 个 store 与 composable / review domain / dimension / clearance） | 137 |
| 139–669 | 云线渲染缓存与快照类型（`CloudRenderCache`、`CloudOverlayEl`、`Cloud*DebugSnapshot`），范围体工具（`createCloudRenderCache`、`buildMembersRegionV1`、`captureCreationViewSnapshot`、`buildCloudSourceStamp`、`resolveRegionObjectIdsForRefno`） | 531 |
| 670–734 | 小工具（`nowId`、`clamp`、`measureLabelSize`、`escapeAnnotationLabelText`、`vec3ToTuple`、`aabbFromPoints`、`parseRefnoFromDtxObjectId`） | 65 |
| 735–1015 | 管道测量纯算法（`PipeMeasure*` 类型、`collectOrderedPipeReferencePointSeeds`、`choosePipeMeasureBetterSeed`、`computeApproxNearestBetweenObjects`、`collectApproxNearestSeedPoints`） | 281 |
| 1016–1175 | pick_refno 候选纯逻辑（`resolvePickedRefnoForFilter`、`resolveBoxPickRefnos`、`buildPickRefnoCandidates`、`buildPickTubeCandidates`、`isTubePickFilter`、`nextPickCandidateIndex`、`isSamePickAnchor`、`isSamePickCandidateSequence`） | 160 |
| 1176–1230 | 画布 ↔ 世界坐标换算（`getCanvasPos`、`worldToOverlay`、`worldToOverlayPoint`、`overlayToWorld`） | 55 |
| 1231–1505 | 云线屏幕几何（`buildCloudBillboardPolyline`、`computeFittedCloudRectFromCorners`、`cloudWavesPerEdgeForSizePx`、波纹包围盒线段、`buildCloudWavyRectanglePoints2D`、`computeCloudLayout`、`CLOUD_*` 常量） | 275 |
| 1506–1642 | 记录构造与文字批注点击状态机（`createCloudAnnotationRecordFromAnchorAndMarquee`、`getDefaultTextAnnotationLabelWorldPos`、`resolveTextAnnotationMarker*ClickAction`、`isDtxInteractionReady`） | 137 |
| 1643–1747 | 引线（`buildAnnotationLeaderStyle`、`createAnnotationLeader`、`createTextAnnotationLeader`、`updateLeaderGeometry`、`setAnnotationLeaderResolution`） | 105 |
| 1748–1903 | 标签 / 图钉 / 卡片的 HTML 与样式串（`buildAnnotationLabelHtml`、`buildTextAnnotationMarkerHtml`、`buildInlineAnnotationCardHtml`、`resolveAnnotationLabelClickAction` 等） | 156 |
| 1904–2315 | 三维可视件工厂（`createCloudAnnotationVisual`、`createRectAnnotationVisual`、`createObbAnnotationVisual`、线框几何、`createRectAnnotationRecordFromObb`、`computeAabbObbFromBox3`、`disposeObject3d`、`clearGroup`） | 412 |
| 2316–2411 | DOM 工厂（`ensureDiv`、`makeMarkerEl`、`makeTextAnnotationMarkerEl`、`makeLabelEl`、`makeTextAnnotationCardEl`、`makeInlineAnnotationCardEl`、`repaintMarkerDegrade`） | 96 |
| **2412–7169** | **闭包 `useDtxTools()`** | **4758** |

闭包内部：

| 行段 | 职责 | 内部函数 | 自有状态 |
|---|---|---|---|
| 2422–2497 | 取 8 个 store / composable；共享范围体（`resolveMemberRegionBoxes`、`buildSharedRegionForMembers`） | 2 | `readyRevision` |
| 2498–3034 | 批注交互：激活、打开处理页 / 编辑器、内联草稿、文字批注与 overlay 标签两套拖拽 | 34 | `inlineTextAnnotationDrafts`、`textAnnotationDrag`、`inlineOverlayAnnotationDrag`、`clickTracker` |
| 3035–3167 | pick 高亮与候选轮换 | 8 | `pickedHighlightByBran`、`pickedHighlightPinned`、`pickCandidates`、`pickCandidateIndex` |
| 3168–3943 | 测量：对象–对象、管–管、管–结构（`runPipeToStructureMeasurement` 一个函数 290 行） | 20 | `pointToObjectStart`、`objectToObject*`（5 个）、`pipeMeasure*`、`pipeToPipeSourceCandidate`、`statusText`、`objectToObjectUiState` |
| 3944–4342 | 云线创建状态机（目标 → 锚点 → 拖框）、toolsGroup / marquee DOM、云线标签挂载与卸载、悬停 | 20 | `pendingCloudAnchor`、`cloudGateBlock`、`marqueeState`、`marqueeDiv`、`labels / markers / cloudShapes / rectShapes / obbShapes / textLeaders` |
| 4343–4645 | P4 LOD 计划与 pin 图钉屏幕聚合（簇徽标、弹层、飞到一组） | 10 | `cloudLodLevels`、`clusterBadges`、`clusterHiddenMarkerIds` |
| 4646–4795 | P4 inspection 遮挡淡化 | 9 | 帧级缓存在 `CloudRenderCache` 里 |
| 4796–5288 | **`syncFromStore`**：按 Text / Cloud / Rect / OBB 四段重建 DOM 与几何（L4819 / 4930 / 5003 / 5129 四个分段注释） | 1（475 行） | — |
| 5289–5794 | **`updateOverlayPositions`**：帧级版本戳 → LOD 切档 → 范围体管线 → 盒边几何 → 文字框 + 引线（L5309–5707 七个分段注释） | 2（505 行） | — |
| 5795–6035 | 绑定降级就地换装、9 个 `debug*` 快照 | 9 | — |
| 6036–6172 | 面板动作：`flyTo*`、`remove*`、`highlight*`、`clearAllInScene`、`dispose` | 14 | — |
| 6173–6621 | 拾取与框选几何：`pickSurfacePoint`、平面求交、矩形预览、屏幕矩形收集、`begin / move / endMarquee`（`endMarquee` 240 行） | 11 | `rectDrag`、`rectPreviewLine`、`boxSelectState` |
| 6622–6924 | 画布指针事件分发（`onCanvasPointerUp` 230 行）、`cancelMeasurementInteraction` | 5 | — |
| 6925–7088 | 10 个 `watch`（工具模式、记录集合、解析表、样式、单位…） | — | — |
| 7089–7168 | `return {…}` 60 个成员 | — | — |

### 1.3 为什么现在拆得动

- 闭包内 145 个函数**没有一个**用 `this`，全靠闭包捕获；把捕获的变量改成 `ctx.xxx` 是机械替换，TypeScript 会把漏掉的每一处都标出来（`Cannot find name`）。
- 12 个测试文件只经公开返回对象和 export 的纯函数进入（`as unknown as` 在这些测试里出现 11 次，全是 canvas / viewer 桩，没有伸进闭包拿私有函数），所以内部搬家不需要测试改一行。
- 两个 500 行巨函数内部已经有清晰的分段注释（§9.1 / §9.3 / §10 / §3.3 / §5 / ADR-0050），切口是现成的。

## 2. 目标结构

```
src/composables/
  useDtxTools.ts                   # 组装器：建 ctx → 装控制器 → 挂 watch → return（形状不变）；≈ 400 行
  dtxTools/
    context.ts                     # DtxToolsContext 类型 + createContext(options)
    types.ts                       # DragRect / MarkerMeta / LabelEl / *OverlayEl / ScreenPoint / PendingCloudAnchor / AnnotationOverlayKind …
    geometry.ts                    # 670–734 + 1176–1230：小工具与画布↔世界换算
    cloudGeometry.ts               # 1231–1505：云线屏幕几何 + CLOUD_* 常量
    cloudRegion.ts                 # 139–669：渲染缓存、范围体、快照、来源戳
    pickCandidates.ts              # 1016–1175
    pipeMeasureMath.ts             # 735–1015
    annotationRecords.ts           # 1506–1642 + createRectAnnotationRecordFromObb / computeAabbObbFromBox3
    leaderVisual.ts                # 1643–1747
    overlayHtml.ts                 # 1748–1903：HTML / 样式串 / 标签点击动作
    overlayDom.ts                  # 2316–2411：ensureDiv / make*El / repaintMarkerDegrade
    visuals.ts                     # 1904–2315：三维可视件工厂、线框几何、dispose
    controllers/
      annotationInteraction.ts     # 2498–3034
      pickCandidateController.ts   # 3035–3167
      measureController.ts         # 3168–3943 + cancelMeasurementInteraction
      overlayHost.ts               # 4138–4342：toolsGroup、marquee div、标签挂载、悬停
      cloudCreationFlow.ts         # 3944–4137 + 6345–6621（marquee 三段与框选几何）
      cloudLod.ts                  # 4343–4645
      cloudInspection.ts           # 4646–4795
      overlaySync.ts               # syncFromStore + updateOverlayPositions（第 8b 步再按 kind 拆成 textOverlay / cloudOverlay / boxOverlay）
      panelActions.ts              # 6036–6172 + 5795–6035 的 debug*
      pointerDispatcher.ts         # 6622–6924
```

命名用 `createXxx(ctx, deps)` 返回普通对象（不是 composable，不叫 `useXxx`）：它们只在 `useDtxTools()` 里被调用一次，也不该各自再去 `useStore()`——store 全部在 `context.ts` 里取一次放进 ctx。

## 3. 共享状态怎么处理

规则只有两条：

1. **只被一个控制器读写的状态留在该控制器闭包里**（例如测量的 `objectToObject*`、LOD 的 `cloudLodLevels`）。
2. **被两个以上控制器读写的状态放进 `ctx`，并在 `context.ts` 里注明所有者**；别的控制器只读，要改就调所有者暴露的方法。

按现状要进 ctx 的：

| ctx 字段 | 所有者 | 其他读者 |
|---|---|---|
| `options`（6 个 Ref + `requestRender` + `suppressStoreOverlays`） | 组装器 | 所有 |
| `stores`（selection / review / draftSession / user / unitSettings / clearance / annotationStyle / bindingResolve / `captureAndUpload`） | 组装器 | 所有 |
| `ready`、`readyRevision`、`refreshReadyState()` | 组装器 | 指针分发、创建流、测量 |
| `renderCache: CloudRenderCache` | overlaySync | LOD、inspection、debug |
| `overlays`：`labels / markers / cloudShapes / rectShapes / obbShapes / textLeaders` | overlaySync | 交互（拖拽改位置）、LOD（图钉显隐）、面板动作（flyTo 取锚点）、host（卸载） |
| `toolsGroup`、`overlayRoot`、`marqueeDiv` | overlayHost | 创建流、框选 |
| `pendingCloudAnchor`、`cloudGateBlock` | cloudCreationFlow | 指针分发、return |
| `pickCandidates`、`pickCandidateIndex` | pickCandidateController | 指针分发、return |
| `statusText`（computed）、`objectToObjectUiState` | measureController | return |

Vue 相关：ctx 是普通对象，里面放 `Ref`，**不要** `reactive(ctx)`（会把 Ref 解包，测试里 `tools.pendingCloudAnchor.value` 的用法就全错了）。`statusText` 这类 computed 仍在所有者里建，挂到 ctx 上只是引用。

## 4. 迁移步骤

每一步：一个提交；改前后 `npx vitest run src/composables/useDtxTools*.test.ts src/components` 与全量各跑一次；`npm run type-check` 新增必须为 0（基线只能收）；`npx eslint src/composables`；步骤 1 和 8 后各跑一次 `npm run build` 看 Vite 的循环依赖警告。

| 步 | 做什么 | 预计从主文件移出 | 兜底测试 |
|---|---|---|---|
| 0 | 加 `useDtxTools.apiShape.test.ts`：`Object.keys(useDtxTools(stub)).sort()` 做内联快照，锁住 55 个成员；记下基线数字（7169 行 / 145 函数） | 0 | 新测试 |
| 1 | 纯函数与类型按 §2 搬进 `dtxTools/*.ts`；`useDtxTools.ts` 顶部用 `export { … } from './dtxTools/…'` 把原来 54 个 export 原样再导出，实现一行不改 | ≈ 2270 行 | `cloudFit`、`pipeMeasure`、`pickRefno`、`useAnnotationStyleStore`（它们 import 的名字和路径都不变） |
| 2 | `panelActions.ts`：`flyTo* / remove* / highlight* / clearAllInScene / dispose` + 9 个 `debug*`，只读 ctx | ≈ 380 行 | `bindingDegrade`、`cloudLod`、`cloudRegion`（都靠 debug 快照断言） |
| 3 | `measureController.ts`：3168–3943 整段 + `cancelMeasurementInteraction`；对外暴露 `handlePointerUp(canvas, e, mode)`、`handleTreeObjectMeasureSelection`、`cancel()`、`statusText`、`uiState` | ≈ 780 行 | `objectMeasure`（582 行，覆盖对象–对象全流程）、`pipeMeasure` |
| 4 | `pickCandidateController.ts`：高亮 + 候选轮换 | ≈ 130 行 | `pickCandidateCycle`、`pickRefno` |
| 5 | `annotationInteraction.ts`：激活 / 编辑器 / 内联草稿 / 两套拖拽 | ≈ 540 行 | `cloudRender`（V1 标签拖拽）、`AnnotationOverlayBar.test` |
| 6 | `overlayHost.ts` + `cloudCreationFlow.ts`：toolsGroup、marquee、标签挂载；创建状态机 + `begin / move / endMarquee` + 框选几何 | ≈ 850 行 | `cloudCreation`、`cloudRegion`、`sharedRegion` |
| 7 | `cloudLod.ts`、`cloudInspection.ts` | ≈ 450 行 | `cloudLod`（540 行，含静止 120 帧零重建）、`cloudInspection` |
| 8a | `overlaySync.ts`：`syncFromStore`、`updateOverlayPositions`、`applyBindingDegrade` 整体搬出，签名不变 | ≈ 1050 行 | 全部 12 个 |
| 8b | 第二刀：按 kind 拆 `textOverlay.ts`（4819–4929 + 文字框引线段）、`cloudOverlay.ts`（4930–5002 + 5309–5706 范围体管线）、`boxOverlay.ts`（Rect 5003–5128 + OBB 5129–5270 + 盒边 5692–5706），每个导出 `sync(records, ctx)` 与 `updatePositions(frame, ctx)`；`overlaySync.ts` 只剩帧级版本戳与调用顺序 | 主文件不变；`overlaySync.ts` 1050 → ≈ 250 | 同上 |
| 9 | `pointerDispatcher.ts`：四个 `onCanvasPointer*` 只做模式分流，调各控制器；10 个 `watch` 按所有者搬进控制器的 `install()`（跨控制器的留在组装器） | ≈ 300 行 | `cloudCreation`、`objectMeasure`、`pickCandidateCycle`（都从指针事件进） |
| 10（可选） | 测试改从 `dtxTools/*` 直接 import 纯函数，`useDtxTools.ts` 删掉再导出层 | — | 全部 |

步骤 1–9 做完，`useDtxTools.ts` 预计 ≈ 400 行（import、`createContext`、10 个 `create*`、跨控制器 watch、return）。

### 4.1 第 8b 步的切口（最难的一刀，先写清楚）

`updateOverlayPositions` 现在每帧按下面顺序走，分段注释已经在文件里：

1. L5309 帧级版本戳（开关 `cloudDirtyCache`）→ 留在 `overlaySync.ts`，产出 `frame` 对象（相机世界戳、模型代次、视口、`pixelRatio`）；
2. L5338 LOD 计划 → 调 `cloudLod.planForFrame(frame)`；
3. L5340 inspection 模式 → 调 `cloudInspection.modeForFrame()`；
4. L5345 pin 档整条跳过 → `cloudOverlay.updatePositions` 内部第一行；
5. L5378 / L5472 范围体校验 + 齐次裁剪 → 屏幕凸包 → 波纹 → billboard → `cloudOverlay.ts`；
6. L5692 盒边几何与虚线节拍 → `boxOverlay.ts`；
7. L5707 文字框 + 引线 → `textOverlay.ts`（云线的 V1 文字框也放这里，因为它和文字批注共用 `LabelEl` 与引线逻辑）。

每段的输入输出今天都是闭包变量；8a 搬出去时先原样保留，8b 才把每段改成 `(frame, ctx)` 入参——两刀分开，出问题能定位到哪一刀。

## 5. 验证

- 自动：上面每步的 vitest / type-check / eslint；步骤 0 的 API 形状快照到最后一步仍须一字不差。
- 构建：`npm run build` 两次（步骤 1、8 后）；`dist` 里 `index-*.js` 体积应与拆分前一致（±1 KB，Vite 会把这些模块打回同一个 chunk）。
- 手工（步骤 6、8、9 后各一次，在 ViewerPanel 里）：pick_refno 点选与候选轮换；对象–对象测量两次（含去重）；管–管、管–结构各一次；云线三步创建、撤一步、Esc 取消；云线 LOD（≥ 90 条时图钉聚合、点簇徽标）；拖文字框；校审页解析表变化后的灰虚线降级；窗口缩放后文字框跟随。
- 性能：`updateOverlayPositions` 是每帧路径；拆分只多一层对象属性访问，可忽略；禁止把热路径里的闭包变量改成 getter / computed。`cloudLod.test` 的「静止 120 帧零重建」（`debugCloudRenderStats()`）当回归哨兵。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 漏掉某个闭包变量的隐式共享（A 控制器改了，B 控制器读到旧值） | 全部走 ctx 显式字段；搬家时把被搬段落里出现的每个外层标识符列一遍（tsc 的 `Cannot find name` 就是清单） |
| 控制器之间初始化顺序（watch 在依赖建好之前触发） | `createContext` → 全部 `create*` → 最后统一 `install()` 挂 watch；`watch` 不在 `create*` 里直接注册 |
| `reactive()` 解包 Ref | ctx 用普通对象，加 `// 不要 reactive(ctx)` 注释和一个类型断言测试 |
| 云线 V1 文字框拖拽（`beginInlineOverlayAnnotationDrag` 系列）跨了「交互」和「overlay 渲染」两边 | 拖拽状态归 `annotationInteraction`，它只改 `ctx.overlays.*` 的位置字段并 `requestRender()`；渲染端不持有拖拽状态 |
| `src/assets/tailwind.css` L99 与若干文档按文件名引用 `makeInlineAnnotationCardEl / makeTextAnnotationCardEl` | 步骤 1 顺手把注释改成新路径 |
| 新文件多了，`type-check` 基线的「文件\|TS 码\|消息」签名会随代码换文件名 | 搬完先 `npm run type-check`：若「新增」正好是「消失」的同一批换了文件名，就 `npm run type-check:update-baseline`；对不上的才是真回归 |
| ViewerPanel 以外还有人经 `useViewerContext().tools` 调成员 | 返回形状不变所以安全；步骤 10 若想删 debug 钩子，先 `git grep` e2e 与 `src/debug` |

## 7. 非目标

- 不改任何行为、不改 `useToolStore`、不改 `ViewerPanel.vue`（它 5699 行是下一个候选，另立计划）。
- 不顺手修里面已知的 `any`（`camera: any`、`vec3ByMatrix(matrix: any)`）——留给拆完后的类型收紧，否则一步里混两件事。
- 不把 `useXeokitMeasurementTools.ts`（4446 行，xeokit 路径）纳入；它和本文件是并行实现，若 xeokit 已退役应整个删除而不是拆分。

## 8. 拍板项

1. 目录名 `src/composables/dtxTools/`（还是 `src/viewer/dtxTools/`？本文按前者，和 `useDtxTools.ts` 挨着）。
2. 步骤 1 一次性搬 2270 行是否接受为单个提交（纯移动，`git diff --color-moved` 能看出全是搬运），还是按 §2 的 11 个文件拆成 11 个提交。
3. 步骤 10（测试改 import、删再导出层）做不做。