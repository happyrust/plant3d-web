接受方案 **(c)**。建议明确四个边界：**`bindings` 决定问题目标，`region` 保存指认范围，呈现版本决定如何画，运行时布局负责当前相机下的文字和引线。** 相机更新不能改写前三者。

下文是增量设计建议，不是已实现结论。附件提供了 normalizer、恢复链路和 MBD inspection 的说明，但没有这些模块的完整实现；相关兼容性和运行结果应通过后述测试验收，不能仅凭说明判定通过。

## B6｜文字框与引线：保存布局意图，不保存每帧布局结果

**推荐：文字框锚定到云线参考包围框，偏移使用 CSS 像素；引线连接“实际可见云线边界—文字框边界”的最近点对。**

参考包围框取**加 padding、尚未加波浪的轮廓包围框**，不要取瞬时波峰极值，否则文字会随波浪变化抖动。默认锚点取右上角，文字框左上角偏移 `{x:18,y:0}`。所有坐标均相对 overlay 内容区，不直接混用 `clientX`、drawing-buffer 像素或 DPR。

布局顺序是：计算期望位置 → 夹紧到视口安全区 → 若与云线内部重叠，尝试四侧候选位置，选择偏离期望位置最小者。文本过大时先限制文字框尺寸并允许内部滚动；云线覆盖整个视口、没有可用外侧位置时，允许带底色的文字框覆盖显示，**隐藏引线，而不是绘制穿过文字的零长度或反向引线**。

```ts
type P2 = Readonly<{ x: number; y: number }>;
type RectPx = Readonly<{
  x: number; y: number; width: number; height: number;
}>;

type CloudFrame = {
  referenceBounds: RectPx;             // 加 padding、未加波浪
  enclosure: readonly P2[];            // 闭合区域，供包含/重叠判断
  visibleStrokes: readonly (readonly P2[])[];
  // 每条 stroke 的连续线段已显式给出；不含仅用于闭合的视口裁剪边
};

type LabelPreference = {
  uv: readonly [number, number];       // 默认 [1, 0]
  offsetPx: P2;                       // 相对参考点的期望偏移
};

function layoutCloudLabel(
  frame: CloudFrame,
  preference: LabelPreference,
  measured: { width: number; height: number },
  viewport: RectPx,
) {
  const b = frame.referenceBounds;
  const desired = {
    x: b.x + b.width * preference.uv[0] + preference.offsetPx.x,
    y: b.y + b.height * preference.uv[1] + preference.offsetPx.y,
  };

  // 以下辅助函数均为纯函数；候选位置使用固定的同分排序。
  const size = constrainLabelSize(measured, insetRect(viewport, 8));
  const rect = chooseNearestFeasibleLabelRect({
    desired, size, safeViewport: insetRect(viewport, 8),
    enclosure: frame.enclosure,
  });

  // 枚举所有可见轮廓线段 × 文字矩形四边，求线段之间的最近点对。
  // 不是“最近顶点”，也不是“距文字中心最近的点”。
  const pair = closestStrokeRectanglePair(frame.visibleStrokes, rect);
  const overlaps = polygonIntersectsRect(frame.enclosure, rect);

  return {
    rect,
    overlaps,
    leader: !overlaps && pair && pair.distanceSq > 1
      ? { start: pair.onStroke, end: pair.onRectangle }
      : null,
  };
}
```

**持久化只保存 `offsetPx` 的意图值。** 视口缩小时产生的夹紧位移不回写；视口恢复后，标签自动回到原偏移。只有用户明确拖动标签时才更新偏移。最近点距离相同时使用稳定的线段身份排序，避免左右跳线。

兼容方面，旧 `leaderEndWorldPos` 继续表示世界空间文字定位点，不改成像素值，也不改成云线边界点。新建或明确拖动标签时，可沿旧逻辑双写一次兼容世界点；相机移动、夹紧和普通回放绝不回写它。旧记录没有新版标签布局时，仍走旧世界点布局。尤其不能把旧 `screenOffset` 当标签偏移：附件明确它是**拖框中心相对锚点投影的偏移**。

---

## C8｜数据模型：字段增量、确定性补齐、无损传输

### 新增字段及类型

建议使用下面的最小完整结构。矩阵按 three.js 的列主序存储；世界范围必须携带来源身份，缺失身份用 `null`，不能用当前打开模型的信息冒充创建来源。

```ts
type V3 = readonly [number, number, number];
type M4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

type SourceStamp = {
  projectKey: string | null;
  modelRevisionKey: string | null;
  coordinateFrameKey: string | null;
};

type Face = readonly [number, number, number, ...number[]];

type ConvexCell = {
  id: string;
  vertices: readonly V3[];             // 数组顺序持久稳定
  faces: readonly Face[];             // 顶点索引；封闭、朝向一致
};

type ObbSnapshot = {
  id: string;
  memberRefno: string | null;          // 来源说明，不替代 bindings
  center: V3;
  axes: readonly [V3, V3, V3];         // 必须单位化且相互正交
  halfSize: V3;
};

type RegionV1 = {
  version: 1;
  space: 'world';
  source: SourceStamp;
  origin: 'members' | 'user-volume' | 'legacy-snapshot';
} & (
  | { kind: 'obb-union'; boxes: readonly ObbSnapshot[] }
  | { kind: 'hull'; hull: ConvexCell }
  | { kind: 'lasso-prism'; cells: readonly ConvexCell[] }
);
// lasso-prism 存封闭凸分块，可表达透视截体；不强迫近远截面等大。

type CreatedViewpointV1 = {
  version: 1;
  cameraType: 'perspective' | 'orthographic';
  matrixWorld: M4;
  projectionMatrix: M4;
  controlsTarget: V3 | null;
  viewportCss: { width: number; height: number };
  devicePixelRatio: number;
  source: SourceStamp;
};

type CloudAdditions = {
  region?: RegionV1 | null;
  createdViewpoint?: CreatedViewpointV1 | null;

  labelLayoutVersion?: 0 | 1;
  labelAnchor?: {
    kind: 'contour-bounds';
    uv: readonly [number, number];
    labelPoint: 'top-left';
  };
  labelScreenOffsetPx?: P2 | null;

  renderAlgorithmVersion?: 'legacy-v0' | 'region-v1';
  regionRender?: {
    contour: 'convex-hull' | 'screen-rect';
    paddingPx: number;
    wavelengthPx: number;
    amplitudePx: number;
    phaseAnchor: {
      featureId: string;              // 稳定的 box/cell/vertex 身份
      offsetPx: number;
    };
  };
};

type CloudAnnotationRecordNext =
  CloudAnnotationRecord & CloudAdditions; // 原类型全部字段保留
```

`createdViewpoint` 保存创建证据，而非当前相机缓存。恢复原貌时按创建宽高比等比适配或留边；直接用新视口比例覆盖原投影矩阵，不能称为精确恢复。

### 旧记录默认值

| 缺失项                  | 推荐补齐规则                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `bindings`、`resolve` | 保持定稿规则：由 `refnos` 与 `anchorRefno` 派生角色；缺省 `resolve={state:'resolved'}`。该默认值不等于完成当前模型验证。   |
| `region`             | 有合法 `selectionBbox`：派生单位轴 OBB，标记 `origin:'legacy-snapshot'`，来源身份未知部分为 `null`；没有则为 `null`。 |
| `createdViewpoint`   | `null`。不能从锚点、拖框尺寸或当前相机推回创建视点。                                                             |
| 标签字段                 | 默认 `labelLayoutVersion:0`、`labelScreenOffsetPx:null`，保留旧布局；`labelAnchor` 可确定性补为右上角。       |
| 呈现版本                 | 默认 `legacy-v0`。有派生范围不意味着用户已经同意改变旧记录观感。                                                    |
| 旧尺寸与偏移               | 原值保留；旧渲染有效值仍采用现有默认尺寸及 clamp，不把夹紧结果回写。                                                     |

显式“升级为空间云线”操作才启用 `region-v1`，并确认范围、标签偏移和参数；历史未知的 `createdViewpoint` 仍保持 `null`。只有像素框、没有范围快照的旧记录，不能无证据升级。

新建仍按旧含义双写 `screenOffset/cloudSize`、成员 AABB 的 `selectionBbox` 和关联旧字段。**套索范围不能占用 `selectionBbox` 改写其语义**；旧客户端只能看到旧字段所能表达的近似表现，不承诺看见同样的套索。

### 单一漏斗与 superset

定稿要求保持 `PersistedStateV6`，所有读写汇入 `normalizeCloudAnnotationRecord`；三条恢复链路整对象透传的结论来自该计划的既有核实。此次应扩展同一漏斗，而非在三个 adapter 各补一套默认值。

```ts
type CloudWire = Record<string, unknown>;

function normalizeCloudAnnotationRecord(raw: CloudWire): CloudWire {
  const out = structuredClone(raw);

  normalizeExistingBaseFieldsLosslessly(out);
  // 保留既有基字段处理；不得白名单重建整条记录或嵌套扩展对象。

  const fill = (key: string, value: unknown) => {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = value;
  };

  fill('bindings', deriveLegacyBindings(out)); // 使用记录时间；不读 Date.now()
  fill('resolve', { state: 'resolved' });
  fill('region', deriveRegionFromValidSelectionBbox(out) ?? null);
  fill('createdViewpoint', null);
  fill('labelLayoutVersion', 0);
  fill('labelAnchor', {
    kind: 'contour-bounds', uv: [1, 0], labelPoint: 'top-left',
  });
  fill('labelScreenOffsetPx', null);
  fill('renderAlgorithmVersion', 'legacy-v0');
  return out;
}
```

以上是漏斗内部伪代码，不意味着附件已存在这些辅助函数。读取补齐不触发自动保存；校验与渲染解释分开：**未知版本、非法扩展原样保留，但不交给几何执行器**，只使用安全兼容显示并标示原因。必须校验有限数、OBB 正交性、面索引、封闭性和数量预算，不能通过截掉成员或顶点来“修复”记录。

round-trip 必须穿过真实序列化和恢复入口：

| 测试维度                           | 必须断言                                  |
| ------------------------------ | ------------------------------------- |
| 三入口 × V3/V4/V5/V6 容器           | 旧字段不变，新范围、视点、参数完整保留；V1/V2 继续走原历史兼容测试。 |
| 旧记录、完整新版、字段缺失、显式 `null`、未知未来版本 | 默认值符合上表；未知顶层及嵌套字段不丢。                  |
| 任意入口 A → 导出 → 入口 B，共九种组合       | 批注业务字段语义相等；仅豁免明确列出的既有上下文注入字段。         |
| 重复 ID、去重、编辑标题后再保存              | 按既有优先级保留整条获胜记录，不能拼出“旧绑定＋新范围”。         |
| 当前端与上一发布端往返                    | 验证旧端保存是否丢新字段；**能读取不等于能无损保存**。         |

另锁定 `N(N(x)) = N(x)`、输入不被修改，以及加载过程零持久化写入。

---

## C9｜rect / obb：统一范围，不统一批注种类

**推荐共用 `RegionV1`、来源校验和缓存层，但保留三类记录、工具入口及各自呈现。** cloud 使用投影轮廓，rect/obb 仍可显示空间线框；不要借数据统一把旧三维盒悄悄改成屏幕框。

附件指出旧 OBB 的轴为单位阵，同时提供了局部 bbox 与放置矩阵能力；因此旧数据应按保存的盒恢复，新创建才使用真实变换。 

```ts
type RangeAnnotation =
  | (RectAnnotationRecord & { region?: RegionV1 | null })
  | (ObbAnnotationRecord  & { region?: RegionV1 | null });

function primitiveFromPlacement(
  localBox: LocalBox,
  objectMatrix: M4,
  globalModelMatrix: M4,
): ObbSnapshot | ConvexCell {
  const world = multiply(globalModelMatrix, objectMatrix);
  const corners = transformBoxCorners(localBox, world);

  return hasNonDegenerateOrthogonalBasis(world)
    ? obbFromOrthogonalAffineTransform(localBox, world)
    : closedConvexCellFromTransformedBox(corners);
}
```

关键限定：合成矩阵存在剪切时，三个变换轴不能只归一化后冒充 OBB，应保留八角点凸体。多对象也不能伪装成一个“精确 OBB”。

迁移采用“旧记录适配读取 → 新建双写 → 显式升级旧记录”。不迁移并非立即错误，但会持续维护两套坐标变换、身份校验、失效规则和缓存，且同一目标在 cloud 与 obb 中出现不同包围范围。

---

## D10｜未加载、失效与版本切换：快照不能被错误“自愈”

**推荐快照为回放权威，目标解析负责验证，不负责静默改写快照。** 普通模型加载可以补足运行时信息；几何或版本变化不能偷偷将旧问题迁移到新位置。

定稿明确区分 `unloaded`、`missing`、`stale`，不是所有查不到 AABB 的情况都叫 STALE。

| 情况                 | 状态与行为                                  |
| ------------------ | -------------------------------------- |
| 同源、确认存在、尚未加载       | `unloaded`：按完整快照正常显示，可标“未加载”；高亮触发按需加载。 |
| 权威查询确认当前版本已删除该目标   | `missing`：快照灰显，显示“元素不存在”。              |
| 身份不明、版本不匹配、锚点重定位失败 | `stale`：按快照显示并加 STALE 标签。              |
| 部分成员加载成功           | 不用已加载子集缩小范围；保留完整快照和逐成员状态。              |
| 坐标系已变，且没有可信转换      | 不把旧世界点硬贴到新模型；改用独立快照视图或代表截图，标明无法对齐。     |

本轮按你的严格门禁，`missing/stale` 的写操作只允许**重绑或删除**；移除失效成员作为重绑提交的一部分，且目标不得变空。查看详情、截图不属于修改操作。

```ts
type Evidence = {
  identityConflict: boolean;
  frameAlignment: 'trusted' | 'unknown';
  existence: 'present' | 'deleted-confirmed' | 'unknown';
  revisionMatches: boolean;
  fullyLoaded: boolean;
  anchorCheck: 'ok' | 'failed' | 'not-required';
};

function resolveState(e: Evidence): CloudResolveState {
  if (e.identityConflict || e.frameAlignment !== 'trusted') return 'stale';
  if (e.existence === 'deleted-confirmed') return 'missing';
  if (!e.revisionMatches || e.existence === 'unknown') return 'stale';
  if (e.anchorCheck === 'failed') return 'stale';
  return e.fullyLoaded ? 'resolved' : 'unloaded';
}
```

`getAABB()==null` 不是删除证据；BRAN 自身无 mesh 也不能直接判 missing。成员是否包含子树，必须由采集契约明确，不能由加载是否命中决定。

版本切换增加 `modelEpoch`；异步解析结果携带 `{modelEpoch,bindingRevision}`，返回时不一致就丢弃。重绑目标时原子更新绑定、范围、来源及兼容字段；**重绑锚点只移动图钉，不改变 members 或新版范围体**。这也是新版空间语义与旧锚点布局的明确差别。

---

## D11｜脏标记、合批与千条 LOD

### 脏标记：按流水线阶段拆开

附件当前循环每帧调用 `setPoints`，目标 bbox 另有 500ms TTL；不能仅给这段代码加一个统一 `dirty`，否则颜色变化仍会重建几何。 

```ts
type Stamp = {
  cameraWorld: number; projection: number;
  viewportCss: number; overlayTransform: number; dpr: number;
  modelEpoch: number; targetBounds: number; bindings: number;
  effectiveRegion: number;
  shapeStyle: number; paintStyle: number;
  labelMetrics: number; labelPreference: number;
  presentation: number;
};

function computeDirty(a: Stamp, b: Stamp) {
  const changed = (...keys: (keyof Stamp)[]) =>
    keys.some(k => a[k] !== b[k]);

  const resolve = changed('modelEpoch', 'targetBounds', 'bindings');
  const project = changed(
    'cameraWorld', 'projection', 'viewportCss',
    'overlayTransform', 'effectiveRegion',
  );
  const shape = project || changed('shapeStyle', 'presentation');

  return {
    resolve, project, shape,
    label: shape || changed('labelMetrics', 'labelPreference'),
    paint: changed('paintStyle', 'presentation', 'dpr'),
  };
}
```

这些版本号需要适配层维护，不是假定相机或 DTX 已有相应 API。相机完成矩阵更新后比较两组矩阵各 16 个元素；目标版本覆盖对象矩阵、局部 bbox/几何、全局矩阵、实例及子树集合变化。目标变化先验证，只有有效范围变化才推进 `effectiveRegion`。

标签文字、字体加载、折叠和实际测量尺寸也是依赖。颜色与透明度只更新材质；影响外包距离的线宽、halo、padding、波幅归 `shapeStyle`。TTL 只作事件遗漏的低频兜底，值未变化不能触发重建。

验收应是：**全部依赖静止时，投影、轮廓构建、`setPoints`、Buffer 上传计数均为零增量**，而不只是“帧率看起来正常”。

### 合批：先减少工作，再减少 draw call

不要把多条云线直接拼进一个 MeshLine 点数组：必须确认当前实现支持独立子路径，否则会产生跨批注连接线。建议先做独立索引线带合批，每条轮廓独立维护邻接点、闭合关系和 ID 范围；同材质分组，halo 与主线可以是两次绘制，不追求不真实的“永远一次 draw call”。

顶点着色器可接收 `basePointPx / normal / arcLengthPx / phase / annotationId`，计算波浪与线宽展开。但**凸包、裁剪、累计弧长和可变拓扑仍主要由 CPU 提供**；GPU 正弦计算不会消灭这些成本。还需处理足够采样、拐角连接、透明叠加顺序和拾取，建议在性能数据证明波浪构建是瓶颈后再引入。

上千条时，全轮廓仅保留激活批注和有限选中集合，建议初始预算 64 条，后续实测调整；其他降为图钉或屏幕网格聚合，并且不计算其凸包、不创建完整文字 DOM。隐藏记录仍隐藏，列表和成员统计完整保留。LOD 切换加滞回，拖动中的批注固定在高等级；图钉不宣称具备“包住范围”的保证。

---

## D12｜遮挡淡化：值得作为可选 inspection，不改变置顶基线

**推荐默认仍为 `always-on-top`，inspection 后置且独立开关。** 无论模式如何，保持 `depthTest:false`；inspection 只调透明度，不让深度测试把批注抹掉。附件明确置顶决策，并说明 MBD 已有淡化模式，但未提供可复用实现。 

中心射线只能作为启发式。云线中心可能在空洞，锚点还可能属于非目标对象；因此先验证射线确实命中成员表面，再判断其前方是否存在更近的非目标命中。未命中目标是 `unknown`，不是“被挡住”。

```ts
type Probe = 'clear' | 'blocked' | 'unknown';

function inspectionFactor(
  mode: 'always-on-top' | 'inspection',
  probes: readonly Probe[],
  emphasized: boolean,
  snapshotInvalid: boolean,
): number {
  if (mode === 'always-on-top' || emphasized || snapshotInvalid) return 1;
  return probes.length > 0 && probes.every(p => p === 'blocked')
    ? 0.4
    : 1; // 有可见或未知证据时，保守保持可读
}
```

建议对少量代表性成员采样，只有全部有效样本持续遮挡才淡化；激活云线、文字和 STALE 提示保持可读。比较距离时排除目标自身，使用与渲染一致的隐藏、裁剪及透明对象策略。

附件只明确了逐对象 raycast 和点拾取能力，**尚不能证明存在廉价的全场景最近遮挡查询**。先验证适配器能返回距离、对象身份及完整性，再开启此模式。仅对高 LOD 批注、相机停止后且场景版本改变时查询；关闭 inspection 时射线调用数必须为零。MBD 对齐的是模式语义和可读性，不是未经核实地复用其常量或内部接口。

---

## E13｜分阶段验收与可回退计划

下面阶段编号仅针对本次演进，不替代附件已经定稿的业务 Phase 1–4。

| 阶段与开关                                     | 独立交付内容                                  | 验收与回退                                          |
| ----------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| P0：兼容基线                                   | 新增类型、无损漏斗、三链路 round-trip、旧截图和调用计数       | 旧记录输出不变；没有新呈现启用。                               |
| P1：`cloudPixelLabels` / `cloudDirtyCache` | 接入现有轮廓，独立验证标签与缓存                        | 最近点、夹紧可逆、旧世界点兼容、静止零重建；分别关闭开关回退。                |
| P2：`cloudRegionV1`                        | 接入并行几何内核、创建范围与视点；包含最小来源校验和 epoch 隔离     | 多机位包含、裁剪、相位测试通过；目标范围不完整时不创建新版记录。关闭后兼容显示，保留新字段。 |
| P3：`annotationSharedRegion`               | rect/obb 新建适配、完整失效及重绑交互                 | 真 OBB/剪切分支、部分加载、版本切换、原子重绑；旧记录不自动迁移。            |
| P4：独立性能与显示开关                              | LOD → 合批 → 按数据决定 GPU 波浪；inspection 最后单开 | 合批前后几何等价、无跨线连接、调用预算；任一优化可退回 CPU 基线。            |

回退不能绕过来源校验：新版来源不匹配时，即便退回旧外观，也只能按快照降级，不能重新启用当前模型 AABB 的错误“自愈”。

### 纯函数测试：校验真实包围，不只校验矩形

现有五机位测试先确认八角点全部位于近远平面内，再判断拟合矩形包含角点；它没有证明穿越近平面或实际波浪轮廓的包围性质。

```ts
it.each(cameraCases)('新版范围包围：$name', ({ camera, viewport }) => {
  const actual = renderRegionPure(region, camera, viewport, renderOptions);

  // 独立参考裁剪器或解析 fixture，不复用被测投影函数自证。
  const targetHull = referenceVisibleTargetHull(
    sourceGeometry, camera, viewport,
  );

  expect(allCoordinatesFinite(actual)).toBe(true);
  expect(hasSelfIntersection(actual.enclosure)).toBe(false);
  expect(
    polygonDifferenceIsEmpty(targetHull, actual.enclosure, 0.5),
  ).toBe(true);
});

it('静止 120 帧不重建、不上传', () => {
  const result = simulateFrames(sameFrameInput, 120);
  expect(result.afterWarmup).toMatchObject({
    projections: 0, contourBuilds: 0, setPoints: 0, bufferUploads: 0,
  });
});
```

不能只判断目标凸包顶点在内：波浪轮廓可能非凸，还要检查目标边及内部没有被波谷切出。有效 padding 应覆盖向内波幅、最大描边半宽和安全余量。

测试集覆盖正交、透视、roll、近平面穿越、相机进入范围、部分出屏、极远小目标、视口与 DPR 变化。连续性仅对非退化小步轨迹设位移上界；真正消失或拓扑切换测试状态合理、无 NaN、没有跳回旧固定框。相位测试覆盖整体平移、缓慢缩放跨波数阈值、稳定特征消失后的相位交接及闭合接缝，不能把“波峰数不变”当稳定。

还需区分验收对象：`origin:'members'` 应包住成员几何；局部套索应包住保存的用户范围。若业务要求套索也必须包含整个成员，则应在创建时校验并拒绝不满足者，不能用改写绑定来通过测试。

### Playwright：复用 fixture，但等待确定状态

按定稿复用 `bran_24381_145018`，保留一对一、一对多及目标—锚点解耦场景。

固定浏览器、字体、视口和 DPR，等待模型完整就绪、字体完成以及 overlay 已处理指定相机版本，**不靠固定 sleep 截图**。每个确定机位同时保存截图与调试数据：轮廓坐标、文字框、最近点对、状态、LOD、重建计数。三条恢复链路使用同一记录和同一机位比较；另测缩小再恢复视口、卸载后重载成员、失效重绑，以及“旧版本加载请求晚于版本切换返回”。

最终 Go 门应是：**无损回放、真实轮廓包含、身份隔离、静止零重建四项同时通过**。截图负责发现观感退化，不能替代这四项正确性断言。
