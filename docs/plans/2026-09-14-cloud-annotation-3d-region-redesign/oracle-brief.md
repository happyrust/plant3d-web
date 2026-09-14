# plant3d-web 三维云线批注：现状分析与改进咨询简报

> 目的：请你（GPT-6 Pro）基于下面的真实代码现状，给出一套**更好的三维云线批注方案**——
> 用户能在三维视口里绘制云线，且 **camera 旋转 / 缩放 / 平移后，云线始终正确地"框住"它所指认的空间范围**。
> 要求给出：架构与表示法选型、核心算法（含 TypeScript 伪代码）、数据模型增量、边界情况处理、性能策略、分阶段落地与测试方案。

---

## 0. 项目背景

- 技术栈：Vue 3 + TypeScript + three.js。模型是电厂 / 化工厂 PDMS/E3D 导出的管道、设备、结构（几十万构件），
  用自研 **DTX 批渲染层**（`DTXLayer`）一次 draw call 画大量对象；每个对象 = `objectId (o:<refno>:n)` + 几何 `geoHash` +
  **放置矩阵 `matrix`**（存在 `_matricesBuffer`）+ **局部包围盒**（按 geoHash 缓存）+ 世界 AABB。
- 业务：三维校审。审查者在模型上做批注（text / cloud / rect / obb），批注随校审记录 JSON payload 持久化，
  经多条恢复链路回放（payload superset 原则：只增字段不改字段）。
- 领域词汇（CONTEXT.md）：
  - **批注锚点**：批注在模型空间的定位参考中心（图钉 + 引线起点），不构成关联。
  - **问题目标元素**：批注指认的有问题的模型元素（`bindings[].role === 'member'`）；统计/反查一律以它为准。
  - **代表截图**：挂在批注上的模型视角证据截图。
- 已有约束/决策（2026-07-28 定稿）：
  - 云线创建流程：**先显式选目标元素 → 点 mesh 选锚点 → 拖框绘制轮廓**；无目标不允许绘制。
  - 锚点可以不属于目标集合。
  - `CloudDrawMode = 'screen2d' | 'bbox3d'` 两种绘制模式共用同一流程，仅呈现不同。
  - 轮廓颜色归样式面板（用户可配），严重度用图钉 / 徽标表达。
  - 云线遮挡语义：**`depthTest:false` 永远置顶**（"被前景管道挡住的云线等于没有批注"）。
  - 记录 schema 只增不改（`screenOffset / cloudSize` 等旧字段不能搬）。

---

## 1. 现有数据模型（`src/composables/useToolStore.ts`）

```ts
export type Vec3 = [number, number, number];

export type CloudBindingRole = 'anchor' | 'member';
export type CloudElementBinding = { refno: string; role: CloudBindingRole; noun?: string; createdAt: number };

export type CloudAnnotationRecord = {
  id: string;
  objectIds: string[];
  anchorWorldPos: Vec3;             // 图钉位置（用户点 mesh 得到）
  anchorRefno?: string;
  leaderEndWorldPos?: Vec3;         // 引线终点 / 文字框位置（世界坐标）
  /** 框选构件合并 AABB，用于「三维包围盒」云线绘制（创建时快照） */
  selectionBbox?: { min: Vec3; max: Vec3 };
  screenOffset?: { x: number; y: number };   // 创建时拖框中心相对锚点投影的像素偏移
  cloudSize?: { width: number; height: number }; // 创建时拖框像素尺寸（clamp 72–220 × 48–180）
  visible: boolean;
  bindings?: CloudElementBinding[];  // 带角色的关联
  collapsed?: boolean;
  title: string; description: string; createdAt: number;
  refnos?: string[]; comments?: ...; reviewState?: ...; severity?: ...; authorId?: string; screenshot?: ...;
};

// rect / obb 批注：静态世界坐标线框盒；注意 computeAabbObbFromBox3 的 axes 恒为单位阵——"OBB" 其实就是 AABB
export type Obb = { center: Vec3; axes: [Vec3, Vec3, Vec3]; halfSize: Vec3; corners: [Vec3 x8] };
export type RectAnnotationRecord = { id; objectIds; obb: Obb; anchorWorldPos: Vec3; leaderEndWorldPos?: Vec3; ... };
export type ObbAnnotationRecord  = { id; objectIds; obb: Obb; labelWorldPos: Vec3; anchor: {kind:'top_center'}|{kind:'corner',cornerIndex}; ... };
```

## 2. 现有云线渲染管线（`src/composables/useDtxTools.ts`，每帧 `updateOverlayPositions()`）

### 2.1 目标 AABB 解析（500ms TTL 缓存，自愈）

```ts
export const CLOUD_TARGET_BBOX_TTL_MS = 500;
function resolveCloudTargetBbox(cloud: CloudOverlayEl): { min: Vec3; max: Vec3 } | null {
  const now = Date.now();
  if (cloud.targetBboxAt > 0 && now - cloud.targetBboxAt < CLOUD_TARGET_BBOX_TTL_MS) return cloud.targetBbox;
  const refnos = getCloudMemberRefnos(cloud.record);
  const live = refnos.length > 0 ? compatViewerRef.value?.scene.getAABB(refnos) ?? null : null; // 世界 AABB 并集
  cloud.targetBbox = live ? { min: [live[0], live[1], live[2]], max: [live[3], live[4], live[5]] }
                          : cloud.record.selectionBbox ?? null;                                  // 退回创建时快照
  cloud.targetBboxAt = now;
  return cloud.targetBbox;
}
```

### 2.2 每帧主循环（节选，逐条云线）

```ts
for (const cloud of cloudShapes.values()) {
  const drawMode = annotationStyleStore.cloudDrawMode.value;      // 'screen2d' | 'bbox3d'
  const sb = resolveCloudTargetBbox(cloud);
  let renderBbox3d = drawMode === 'bbox3d' && !!sb?.min && !!sb?.max;
  const anchorScreen = worldToOverlayPoint(camera, canvas, overlay, cloud.worldPos);       // {x,y,visible(ndcZ∈[-1,1]),ndcZ}
  const labelScreen  = worldToOverlayPoint(camera, canvas, overlay, cloud.labelWorldPos);

  // ---- bbox3d：AABB 12 条边各画正弦波浪线（LineSegments，depthTest:false）----
  if (renderBbox3d && sb) {
    const camPos = camera.getWorldPosition(new Vector3());
    const bboxPositions = buildWavySelectionBboxLinePositions(sb.min, sb.max, camPos, 10); // 每边 10 段、3 个波
    cloud.outline.visible = false;
    updateCloudBboxLineSegmentsGeometry(cloud.bboxEdges, bboxPositions);
    cloud.bboxEdges.visible = anchorScreen.visible;
    continue;
  }

  // ---- screen2d：屏幕空间贴合的 billboard 波浪矩形（MeshLine，sizeAttenuation:false，depthTest:false）----
  cloud.bboxEdges.visible = false; cloud.outline.visible = true;
  const minWidthPx  = clamp(cloud.record.cloudSize?.width  ?? 120, 72, 220);   // 拖框尺寸只作最小尺寸兜底
  const minHeightPx = clamp(cloud.record.cloudSize?.height ?? 72,  48, 180);
  let widthPx = minWidthPx, heightPx = minHeightPx;
  const off = cloud.record.screenOffset ?? { x: widthPx * 0.5 + 26, y: -(heightPx * 0.5 + 18) };
  let centerX = anchorScreen.x + off.x, centerY = anchorScreen.y + off.y, centerNdcZ = anchorScreen.ndcZ;
  let fitted = false;
  if (sb?.min && sb?.max) {
    const projectedCorners = boxCornersFromMinMaxVec(min, max).map((c) => worldToOverlayPoint(camera, canvas, overlay, c));
    if (projectedCorners.every((p) => p.visible)) {              // 任一角点越过近/远平面 → 放弃贴合，退回固定布局（会"跳"）
      const fittedRect = computeFittedCloudRectFromCorners(projectedCorners, CLOUD_FIT_PADDING_PX /*14px*/, { width: minWidthPx, height: minHeightPx });
      if (fittedRect) {
        widthPx = fittedRect.widthPx; heightPx = fittedRect.heightPx; centerX = fittedRect.centerX; centerY = fittedRect.centerY;
        centerNdcZ = worldToOverlayPoint(camera, canvas, overlay, aabbCenter).ndcZ;  // billboard 平面放在 AABB 中心深度
        fitted = true;
      }
    }
  }
  const cloudCenterWorld = overlayToWorld(camera, canvas, overlay, centerX, centerY, centerNdcZ);
  const worldPerPixel = worldPerPixelAt(camera, cloudCenterWorld, canvas.clientWidth, canvas.clientHeight);
  const cameraDir = camera.getWorldDirection(new Vector3()).normalize();
  let right = new Vector3().crossVectors(cameraDir, camera.up).normalize();
  const up = new Vector3().crossVectors(right, cameraDir).normalize();
  const wavesPerEdge = cloudWavesPerEdgeForSizePx(widthPx, heightPx);   // round((w+h)/2/52) clamp 4..40
  const positions = buildCloudBillboardPolyline(cloudCenterWorld, right, up, widthPx * worldPerPixel, heightPx * worldPerPixel,
                                                clamp(wavesPerEdge * 4, 16, 200), worldPerPixel, wavesPerEdge);
  (cloud.outline.geometry as MeshLineGeometry).setPoints(positions);   // 每帧重建几何
  cloud.outline.visible = fitted || (anchorScreen.visible && labelScreen.visible);
}
```

### 2.3 轮廓生成（正弦扰动的矩形；振幅 1–6 px 换算成世界单位）

```ts
export function computeFittedCloudRectFromCorners(corners: {x,y}[], paddingPx: number, minSize?): FittedCloudRect | null {
  // 2D 轴对齐外接矩形 + padding，再与最小尺寸取 max（中心不变）
}
export function buildCloudBillboardPolyline(anchor, right, up, width, height, segments = 16, worldPerPixel = 1, wavesPerEdge = 4): number[] {
  // 4 条边各 segments 段，wave = sin(t·2π·wavesPerEdge + i·0.35) · amp，amp = clamp(edgeLen·0.015, 1px, 6px)（世界单位）
  // 点 = anchor + right·x + up·y（billboard 平面）
}
function pushWavyEdgeLineSegmentPairs(v0, v1, cameraWorldPos, segments, waves, out) {
  // bbox3d：每条 AABB 边沿 binormal = edgeDir × (camPos - mid) 方向正弦扰动；amp = clamp(len·0.022, len·0.004, len·0.12)
  // —— 振幅是世界长度比例、binormal 随相机变：远看波浪消失、近看过大，转相机时波浪"游动"
}
```

### 2.4 创建（`endMarquee` in `annotation_cloud` 模式）

```ts
const targetRefnos = [...store.cloudTargetRefnos.value];     // 已显式选择的目标元素
const targetAabb = compat.scene.getAABB(targetRefnos);       // 可能为 null（目标未加载）
const anchorScreen = worldToOverlayPoint(camera, canvas, overlay, anchor);
const rec = createCloudAnnotationRecordFromAnchorAndMarquee({ ..., anchorScreen, rect /*拖框像素矩形*/, selectionBbox: targetAabb, bindings });
// → screenOffset = marqueeCenter - anchorScreen；cloudSize = clamp(rect 尺寸)；leaderEndWorldPos = overlayToWorld(labelX, labelY, anchorScreen.ndcZ)
store.addCloudAnnotation(rec); activateAnnotation('cloud', rec.id); void captureCreatedCloudScreenshot(rec);
```

### 2.5 现有单测锁定的性质（`useDtxTools.cloudFit.test.ts`）

- 决策③：「任意机位下目标 AABB 的 8 个投影角点都在云线矩形内」（5 个机位环绕/推拉验证）。
- 波峰数按像素边长折算（52px 一个波），小尺寸退回 4 峰。

## 3. 可用的底层能力（`DTXLayer` / `DtxCompatViewer`）

- `scene.getAABB(refnos): [minx,miny,minz,maxx,maxy,maxz] | null` —— 世界 AABB 并集（只并 `o:<refno>:n` 自身对象）。
- `scene.getSubtreeAABB(refnos)` —— 含子树（BRAN 下的 TUBI/ELBO/VALV 等）。
- `layer.getObjectBoundingBoxInto(objectId, box)` —— 世界 AABB（局部 bbox × matrix × globalModelMatrix）。
- **每个对象有放置矩阵 `matrix`（`_matricesBuffer`）与按 geoHash 缓存的局部 bbox** → 每个对象的**真 OBB**（局部 bbox × matrix）可零成本得到，对斜管 / 斜梁远比 AABB 紧。
- `layer.getObjectGeometryData(objectId): { geometry: BufferGeometry; matrix: Matrix4 }` —— 可取到顶点（有 LRU 缓存），用于轮廓 / 凸包。
- `layer.raycastObject(objectId, origin, dir)`、`selection.pickPoint(screenXY)` —— 拾取表面点。
- 相机：three.js `PerspectiveCamera`（也可能有正交）；overlay 用 `worldToOverlayPoint`（`ndcZ ∈ [-1,1]` 判可见）。
- 线：`MeshLine`（`sizeAttenuation:false` 常量像素线宽）、`LineSegments`（`LineBasicMaterial`，1px）。

## 4. 我（Claude）对现状问题的判断——请核实、补充或反驳

1. **贴合范围过松**：用世界 AABB 的 8 个角点投影再取 2D 轴对齐外接矩形，是"松上加松"——斜向管线 / 细长构件的世界 AABB 本身就大，
   投影矩形又包住了 AABB 在屏幕上的整个投影六边形。斜视角下云线框住大片空白，不是"框住构件"。
2. **贴合失效会跳变**：任一角点 `ndcZ` 越界（相机拉近、钻进 AABB、目标很大）就整体放弃贴合，退回"锚点 + 创建时像素偏移"的固定布局，
   云线瞬间跳到另一个位置与尺寸。同理，目标部分出屏时投影矩形可能极大。
3. **bbox3d 模式的波浪不稳定**：振幅与边长成比例、扰动方向随相机变 → 远看无波、近看过大，转相机时波浪"游动"；且仍是 AABB（不是 OBB）。
4. **文字框 / 引线与云线脱节**：`leaderEndWorldPos` 是固定世界点；相机转动后文字框可能落进云线内部或远离云线，引线起点固定在图钉而非云线边界。
5. **拖框只剩"最小尺寸"语义**：用户拖出的形状不再表达"我要圈的范围"；也没有自由形态（套索 / 多边形）云线。
6. **rect / obb 批注的 OBB 是伪 OBB**（axes 单位阵），没有用对象放置矩阵求真 OBB。
7. **性能**：相机不动也每帧对每条云线 `setPoints` 重建几何；没有相机矩阵 / 视口 / 目标版本的脏标记；多云线无合批。
8. **持久化里缺少"创建视点"**：没有存创建时的相机位姿，无法在需要时"回到创建视角看云线原貌"；也没有区分"视点绑定的二维标记"与"空间绑定的三维标记"。
9. **遮挡语义单一**：一律置顶，云线多时互相压盖、且与被圈构件的深度关系不可读（MBD 尺寸那边已经做了 inspection 模式：被遮挡淡化 α）。

## 5. 请你回答的问题（按优先级）

**A. 表示法与架构选型**
1. 云线到底应该绑定在什么几何上，才能在旋转/缩放/平移下"始终框住空间范围"？候选：
   (a) 目标集合的**世界 OBB 并集 / 凸包**，每帧投影成 2D 凸包再画屏幕空间云线；
   (b) 用户绘制的屏幕多边形（套索）**反投影成世界多边形 / 扫掠体**，作为三维几何随相机透视变形；
   (c) 混合：持久化世界空间"范围体"（OBB / 凸包 / 多边形柱体），呈现时按当前相机投影出 2D 轮廓再加云线波浪。
   请比较各方案在"框住语义正确性 / 视觉可读性 / 与二维图纸云线的一致性 / 实现复杂度 / 性能 / 持久化稳定性"上的优劣，给出推荐与理由。
   也请参考 Navisworks / BIM 360 / Revizto / Trimble Connect / Solibri / Autodesk Viewer markup 等业界做法（视点绑定 vs 空间绑定），说明为什么它们那样做、我们该不该一样。
2. `screen2d` / `bbox3d` 双模式是否值得保留？还是收敛成一种"三维范围体 + 屏幕空间云线呈现"的模式？

**B. 核心算法（给 TypeScript 伪代码）**
3. **紧贴合**：从目标对象集合（每个有 OBB 8 角点，必要时取顶点）求**屏幕空间 2D 凸包**（Andrew monotone chain）→ 在凸包外偏移 padding →
   沿凸包周长按**恒定像素弧长**布置**修订云线圆弧（AutoCAD revision cloud 风格）**或正弦波；如何让波浪相位在相机连续运动时**稳定不游动**（相位锚定到凸包的某个确定顶点 / 按累计像素弧长参数化）。
   是否需要"凸包 → 最小面积外接矩形 / 圆角矩形"作为更"图纸感"的替代？如何在两者间切换（凸包顶点数、面积比阈值）？
4. **近平面 / 相机钻入 / 部分出屏**：角点在相机背后或越过近平面时，如何做齐次裁剪（clip-space 多边形裁剪）再投影，而不是整体放弃贴合？目标投影超出视口很多时如何限制（与视口矩形求交 + 边缘提示）？目标投影极小（远景几像素）时的最小尺寸与"聚合为图标"策略？
5. **三维云线绘制交互**：用户在屏幕上画套索 / 多边形 / 矩形，如何转成世界"范围体"？（每个顶点沿视线 raycast 到模型表面得深度；无命中退回锚点深度平面；或用目标集合 OBB 深度范围做柱体扫掠）。然后在别的相机下如何呈现这个范围体（画柱体的投影凸包？画三维波浪多边形？）。
6. **文字框 / 引线**：引线起点如何取云线边界上最靠近文字框的点、文字框相对云线保持像素偏移（屏幕空间锚定 + 视口内夹紧）；与既有 `leaderEndWorldPos` 字段如何兼容（只增字段）。
7. **稳定的波浪参数**：波长 / 振幅按像素定义，如何随 `worldPerPixel` 换算到 billboard 平面并保证透视下视觉一致；正交相机的处理。

**C. 数据模型与兼容**
8. 在"只增不改"的约束下，`CloudAnnotationRecord` 应新增哪些字段（如 `region: { kind: 'obb-union' | 'hull' | 'lasso-prism'; ... }`、`createdViewpoint`、`labelScreenOffsetPx`），旧记录如何推导默认值，三条恢复链路（superset）如何不受影响。
9. rect / obb 批注是否应统一到同一个"范围体"抽象上（真 OBB 由放置矩阵求得）。

**D. 边界与性能**
10. 目标未加载 / refno 失效 / 模型版本切换时的降级（沿用 STALE 口径）。
11. 脏标记（相机 `matrixWorld` + `projectionMatrix` 版本、视口尺寸、目标 AABB 版本、样式版本）、多云线合批为单个 MeshLine / 自定义 shader 的可行性、上千条云线的 LOD（只画选中/激活，其余降为图钉）。
12. 遮挡语义：是否引入"被遮挡淡化"（探测云线中心 / 目标中心的射线是否被非目标几何挡住），与现有 MBD inspection 模式对齐。

**E. 落地**
13. 分阶段计划（每阶段可独立验收），每阶段的纯函数单测（几何算法用多机位断言"目标投影凸包 ⊂ 云线内部"）与 Playwright 多机位截图回归。
14. 指出我上面第 4 节判断中**你不同意**的地方。

请直接给出工程可执行的方案，不要泛泛而谈；关键算法请给 TypeScript 伪代码；对每个推荐说明取舍理由。
