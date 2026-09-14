# 三维云线批注：空间范围体 + 屏幕云线呈现重构方案（2026-09-14）

> 状态：**已拍板**（2026-09-14 20:50，§14 十项全部按推荐项定稿；用户口径「先补四项工程证据再进入 P0 兼容基线」）。四项工程证据已于同日核实，见 §15；证据带来的口径微调（`SourceStamp` 形状、`dtxLoaderRevision` 覆盖面、合批路线）已回写进对应章节并在 §15 逐条标注。
> 目标：用户在三维视口绘制云线后，**camera 旋转 / 缩放 / 平移时，云线始终正确地框住它所指认的空间范围**。
> 咨询来源：oracle CLI 浏览器模式，ChatGPT 模型标签 `Latest`（= GPT-6）+ 思考档 `Pro`，**关闭联网**，两路并行：
> - `plant3d-cloud-geometry-core`（A1 A2 B3 B4 B5 B7 E14，35 min，↑19.7k tokens）→ 表示法与几何内核；
> - `plant3d-cloud-data-perf-plan`（B6 C8 C9 D10 D11 D12 E13，18 min，↑20.1k ↓3.8k）→ 标签 / 数据 / 降级 / 性能 / 落地。
>
> 原文与送审简报存于同名目录 `2026-09-14-cloud-annotation-3d-region-redesign/`（`oracle-brief.md`、`oracle-answer-geometry-core-gpt6-pro.md`、`oracle-answer-data-perf-plan-gpt6-pro.md`）。此前一次单路咨询 `plant3d-cloud-annotation-3d-redesign` 因 GPT-6 Pro 联网搜索超 40 min 超时，无可用答案，已弃。
> 与同日《三维批注交互改进方案》（`2026-09-14-3d-annotation-interaction-redesign-proposal.md`，下称「交互方案」）的关系：**本文是交互方案 §3.4「投影包络」/ U4 的几何、数据与性能细化**，不改 U0–U3 的交互口径；两份文档字段口径冲突处在 §6.1 与 §13 收口。
> 标记：**[核对]** = 本会话在源码里查过的事实；**[评审]** = GPT-6 Pro 的判断；**[采纳 / 调整 / 后置]** = 本文口径。

## 0. 一句话结论

**把云线从「锚点 + 创建时像素偏移 + 每帧世界 AABB 贴合」改为「持久化世界空间范围体 → 每帧齐次裁剪 → 透视除法 → 屏幕凸包 → 圆角外扩 → 恒像素单侧波纹」；文字框与引线在屏幕空间按像素意图布局；记录只增字段、经 `normalizeCloudAnnotationRecord` 单一漏斗补齐；相机静止零重建；`depthTest:false` 置顶不变，遮挡淡化作为后置可选 inspection。**

四个概念从此分开，且**相机更新不能改写前三者** [评审，采纳]：

| 概念 | 落点 | 回答的问题 |
|---|---|---|
| 问题目标 | `bindings[].role === 'member'`（ADR-0049） | 批注指认了哪些元素 |
| 指认范围 | `regionV1`（世界空间范围体快照，本文新增） | 批注覆盖哪一块空间 |
| 呈现版本 | `presentationV1`（算法版本 + 像素参数） | 这块空间怎么画成云线 |
| 运行时布局 | 每帧派生，不持久化 | 当前相机下轮廓、文字框、引线落在哪 |

**核心边界** [评审，采纳]：「有范围但被裁剪 / 出屏」与「没有可用范围」是两种状态。前者绝不能通过旧的固定布局兜底掩盖；只有后者才回退旧布局。

---

## 1. 范围与不变量

- 对象：`plant3d-web` 云线批注（`CloudAnnotationRecord`）的几何表示、渲染管线、标签布局、数据字段与性能；rect / obb 只涉及 §7 的范围体共用。
- **不动**：07-28 定稿的创建流程「先显式选目标 → pick 锚点 → 拖框」（拖框继续只决定呈现，**不决定关联、不决定范围**）；锚点不可换（ADR-0051）；渲染只读坐标快照、不每帧在线解析 refno（ADR-0050）；云线 `depthTest:false` 永远置顶；记录 schema 只增不改；localStorage 容器版本不升（[核对] 当前已是 `PersistedStateV7`，07-28 文中的 V6 已由测量统一迁移升到 V7；V3–V7 全部分支都经 `normalizeCloudAnnotationRecord`）；payload superset；三条恢复链路；`useAnnotationStyleStore.cloudDrawMode` 开关（`screen2d | bbox3d`）保留；轮廓颜色归样式面板、严重度归图钉 / 徽标。
- 局部套索范围（§4.8）是**显式新增能力**，不是把拖框悄悄改回范围作者工具 [评审，采纳]。
- 本文不涉及交互方案的锚点先行 / 候选消歧 / 草稿保存（U0–U3）。

---

## 2. 现状与问题（[核对] + [评审] 裁定）

### 2.1 现有管线（`src/composables/useDtxTools.ts`）

- 数据：`CloudAnnotationRecord`（`useToolStore.ts:469–496`）= `anchorWorldPos` + `leaderEndWorldPos?` + `selectionBbox?`（创建时目标 AABB 快照）+ `screenOffset?`（拖框中心相对锚点投影的像素偏移）+ `cloudSize?`（拖框像素尺寸，clamp 72–220 × 48–180）+ `bindings?`。**没有任何相机 / 视点 / 范围体字段。**
- 每帧 `updateOverlayPositions()`（`:3810`）逐条云线：
  - `resolveCloudTargetBbox()`（`:3792`）：500 ms TTL 内复用，否则 `scene.getAABB(memberRefnos)` 取世界 AABB 并集，失败退回 `selectionBbox`；
  - `bbox3d`：在 AABB 12 条边上画正弦波（`buildWavySelectionBboxLinePositions` `:869` / `pushWavyEdgeLineSegmentPairs` `:828`），振幅按边长比例、扰动方向随相机变；**整体可见性由 `anchorScreen.visible` 决定（`:3861`）**；
  - `screen2d`：8 角点投影 → 全部 `ndcZ ∈ [-1,1]` 才 `computeFittedCloudRectFromCorners()`（`:778`，2D 轴对齐外接矩形 + `CLOUD_FIT_PADDING_PX = 14`）→ 否则退回「锚点 + `screenOffset`」固定布局 → `buildCloudBillboardPolyline()`（`:717`，正负正弦，振幅 1–6 px）→ `outlineGeometry.setPoints()`（`:3945`）**每帧重建**。
- 底层能力（`src/utils/three/dtx/DTXLayer.ts`）：
  - `getObjectBoundingBoxInto(objectId, box)`（`:1940`）= `obj.boundingBox × _globalModelMatrix`，是**世界 AABB**；
  - `getObjectGeometryData(objectId)`（`:1957`）返回 `{ geometry, matrix }`，其中 `matrix = instanceMatrix.premultiply(_globalModelMatrix)`（`:2014–2017`）——**已含全局矩阵**，`geometry.boundingBox` 是按 `geoHash` LRU 缓存的局部盒；
  - 局部盒 `_computeGeometryLocalBBox(handle)`（`:726` 调用处）目前是**私有**方法；
  - `collectObjectBoundsIntersecting(box, { visibleOnly })`（`:2401`）+ `raycastObject(objectId, origin, dir)`（`:2237`）——尺寸系统 inspection 模式的遮挡探测缝 `isSegmentBlocked` 已经建在它们之上（`src/dimension/adapters/dtxDimensionViewerAdapter.ts:121–170`，ADR-0061）。
- 单测 `useDtxTools.cloudFit.test.ts` 锁定：5 个机位下 8 个投影角点都在贴合矩形内——但用例**先断言所有角点 `ndcZ ∈ [-1,1]`**，未覆盖近平面 / 出屏边界 [评审 B4，核对属实]。

### 2.2 九条问题判断与外部裁定

| # | 简报判断 | GPT-6 Pro 裁定（E14） | 本文口径 |
|---|---|---|---|
| 1 | 世界 AABB → 投影 → 轴对齐矩形「松上加松」 | **限定**：保守包络允许含空白，问题是「过松」不是语义错误；对象盒 + 二维凸包能改善，但不承诺精确轮廓 | 采纳：目标是「更紧的保守包络」，不宣称「真实可见轮廓」（与交互方案 §3.4 一致） |
| 2 | 任一角点越界即放弃贴合 → 跳变 | 成立；现有测试未覆盖 | 采纳：齐次裁剪（§4.2），裁剪态**不得**回退旧布局 |
| 3 | `bbox3d` 波浪振幅按世界边长、方向随相机 → 游动 | 成立；另指出**遗漏**：`bbox3d` 用 `anchorScreen.visible` 控制整个范围边线可见性，锚点允许不属于目标，锚点越过近平面会错误隐藏云线 | 采纳：范围表现由范围投影结果决定，不由锚点代判 |
| 4 | 文字框 / 引线用固定世界点，转相机后脱节 | **部分不同意**：图钉是刻意解耦的参考点，不能仅凭视觉脱节判定参考关系错误 | 调整：引线起点改为「可见云线边界—文字框」最近点对（§5），图钉仍是独立参考中心 |
| 5 | 拖框只剩最小尺寸语义、无套索 | **不同意**：这是定稿刻意选择，不是缺陷；局部范围应作显式扩展 | 采纳：拖框语义不变；局部套索是显式新能力（§4.8，后置） |
| 6 | rect / obb 的 OBB 是伪 OBB（axes 单位阵） | **限定**：AABB 是 OBB 的合法特例；准确说法是「没有利用对象方向取得更紧的盒」；任意仿射变换后的局部盒也未必正交 | 采纳措辞；rect / obb 见 §7 |
| 7 | 相机不动也每帧 `setPoints`、无脏标记、无合批 | 成立（限于节选） | 采纳：§9 |
| 8 | 无创建视点持久化 | **限定**：只能确认记录节选无相机字段 | [核对] `useToolStore.ts` / `types/auth.ts` / `review/` 均无 viewpoint 字段（交互方案 §2.3 已核）；采纳交互方案 `viewpointV1.creation` |
| 9 | 一律置顶是缺陷 | **不同意**：既定可读性策略不是缺陷，是否调整是另一项产品决定 | 采纳：默认置顶不变；inspection 淡化为可选（§10） |

另：简报 §3「每个对象的真 OBB 可零成本得到」应改为「**可低成本构建变换盒**」——`getObjectGeometryData` 要切出 BufferGeometry（有 LRU），且变换后是否正交取决于矩阵（§4.1）[评审 B3，核对属实]。

---

## 3. 表示法与架构（A1 / A2）

### 3.1 路线比较与推荐 [评审，采纳]

| 路线 | 语义 / 视觉 / 与二维图纸一致性 | 复杂度 / 性能 / 持久化 |
|---|---|---|
| (a) 对象盒并集 → 屏幕凸包 | 适合「这些构件整体有问题」；恒像素波纹清楚、接近二维云线；凸包会跨越构件之间的空白 | 每对象 8 角点 + 6 面，二维凸包；无需三维凸包；范围来源易解释 |
| (b) 屏幕套索 → 世界几何 | 单纯反投影到一个平面，侧视退化成线；补深度区间后才成体；直接画世界波浪线会随透视改变波长振幅 | 要解决深度歧义、凹多边形、跨表面；保存后稳定但创建复杂 |
| **(c) 统一世界范围体 → 投影表现** | 同时表达「目标整体」与「局部空间问题」，表现一致 | 比 (a) 多一个范围类型入口；投影 / 裁剪 / 波纹共用。**总体最合适** |

**推荐 (c)；默认用 (a) 构造范围体（`origin:'members'`）；(b) 只作为显式的「自定义局部范围」创建方式（`origin:'user-volume'`）。** 不把一条反投影后的世界空间波浪线当成能从任意方向框住目标的范围体。

默认轮廓的数学契约：

\[
H=\operatorname{conv}\Bigl(\bigcup_i \pi\bigl(R_i\cap D\bigr)\Bigr)
\]

\(R_i\) 是对象盒或自定义范围的凸单元，\(D\) 是相机有效深度区间（视锥），\(\pi\) 是透视除法后的屏幕映射。**先裁剪，再投影，最后对所有单元取屏幕凸包。** 云线包住 \(H\)；出屏时展示可见部分并明确提示截断，不伪造一个完整的小框。

业界参照（Navisworks / BIM 360 / Revizto 等）：附件不足以核实各版本具体行为；可借鉴的是两种通用逻辑——**视点绑定标记**保留特定画面证据，**空间绑定标记**允许换角度检查同一对象。本项目要的是后者；「回到创建视角」只是辅助能力（交互方案 `viewpointV1.creation`）[评审，采纳]。

### 3.2 双模式：保留入口，统一范围来源，不保留两套范围语义 [评审，采纳；表现修订已拍板 §14 #2]

- `screen2d`（默认）= **主审阅表现**：范围体投影 + 恒像素云线。
- `bbox3d` = 检查空间边界：显示**同一范围体**的真实盒边（对象变换盒的 12 条边，多对象多盒），**不再是**「合并 AABB 12 条随相机游动的波浪边」。

```ts
export function selectCloudPresentation(mode: 'screen2d' | 'bbox3d') {
  return {
    drawScreenContour: mode === 'screen2d',
    drawWorldRangeEdges: mode === 'bbox3d',
    depthTest: false,
  };
}
```

> 07-28 附录决策 #8 写的是「bbox3d 用目标集合合并 AABB」。把它升级为「对象盒范围的真实边」是**本次提出的表现修订**，已于 §14 #2 拍板通过（2026-09-14 20:50），随 P2 一起落地；P2 上线前 bbox3d 行为不变。两模式仍共享目标选择、锚点与记录，不改关联来源。

### 3.3 管线总览

```
记录 regionV1（世界凸单元集合，创建时快照）
  │  modelEpoch / bindings 变化 → 重新验证（不自动改写快照，§8）
  ▼
每帧（脏标记门控，§9）
  clipConvexSolid4(cells, frustumPlanes)      齐次裁剪 + 截面封口（§4.2）
  → perspectiveDivide → convexHull2d          屏幕凸包（§4.3）
  → intersectHullWithRect(viewport)           可见部分 + 边界来源标记
  → buildRoundedConvexPath(hull, padding)     Minkowski 圆角外扩
  → phase frame（特征锚定 + 相位转移，§4.4）
  → cloudHeightAt(s) 单侧余弦波纹 → 屏幕折线
  → buildCloudBillboardPolylineFromScreen()   统一反投影到固定 ndcZ 的 billboard 平面（§4.5）
  → MeshLine setPoints（仅 shape 脏时）
  → layoutCloudLabel(frame, preference)       文字框 + 引线最近点对（§5）
```

纯函数内核落点：`src/review/domain/annotationProjection/`（交互方案 §3.4 点名的 `annotationProjection.ts` 作为入口；子模块 `clip4.ts` / `hull2d.ts` / `roundedPath.ts` / `wave.ts` / `labelLayout.ts`），签名风格与现有 `computeFittedCloudRectFromCorners` / `buildCloudBillboardPolyline` 一致：**纯函数、无 DOM / three 场景依赖、矩阵与视口由调用方传入、可被 Vitest 直接测**。`useDtxTools.ts` 只保留适配（取对象盒、读相机矩阵、喂 MeshLine）。

---

## 4. 几何内核（B3 / B4 / B5 / B7）

### 4.1 角点来源：局部盒 × 放置矩阵，只乘一次 [评审，采纳；核对]

\[
c_{\text{world}} = M_{\text{global}}\,M_{\text{instance}}\,c_{\text{localBBox}}
\]

- **不能先得到世界 AABB 再把角点旋转成所谓 OBB。**
- [核对] `DTXLayer.getObjectGeometryData().matrix` **已经是** `global × instance`（`:2014–2017`）——适配层若再乘 `_globalModelMatrix` 就乘了两次。
- [核对，§15 ①] `obj.boundingBox`（`getObjectBoundingBoxInto` 的来源）**不一定等于**局部盒 × 实例矩阵：`addObject` 走 `_resolveObjectBoundingBox`（`:730–780`），有服务端预算 AABB 且不「可疑」时直接采用预算盒。所以角点**不能**从 `getObjectBoundingBoxInto` 反推，必须走「按 geoHash 缓存的局部盒 `_geometryLocalBBoxes`（`addGeometry` `:452–461` 必填）+ `_matricesBuffer[objectIndex*16..]` + `_globalModelMatrix`」。新增公开访问器（P2 首项，零分配、不切 BufferGeometry）：

```ts
/** 局部盒 + 世界矩阵（global × instance，只乘一次）。返回 false = 对象不存在。 */
getObjectLocalBoxAndWorldMatrixInto(objectId: string, localBox: Box3, worldMatrix: Matrix4): boolean;
```
- 变换后三轴正交（刚体 + 保正交缩放）才是 OBB；含剪切时是**平行六面体**——保留 8 角点 + 6 面即可，不要用正交化重建一个可能缩小的盒。

```ts
export function computeObjectBoxCorners(min: V3, max: V3, localToWorld: Mat4): V3[] {
  const bits = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  return bits.map((b) => transformPoint(localToWorld, b.map((v, axis) => (v ? max[axis] : min[axis])) as V3));
}
```

紧度收益来自去掉两次膨胀中的第一次（对象盒通常明显小于世界 AABB），再由屏幕凸包去掉第二次（轴对齐矩形）。对象局部盒仍不一定是最小体积包围盒。

### 4.2 齐次裁剪：裁范围体，不裁掉「失败角点」 [评审，采纳]

裁剪必须发生在**透视除法之前**。WebGL 约定下保留半空间：

\[
w \ge \varepsilon,\qquad z + w \ge 0,\qquad w - z \ge 0,\qquad x \pm w \gtrless 0,\qquad y \pm w \gtrless 0
\]

不要把负 \(w\) 取绝对值，也不要先除 \(w\) 再 clamp `ndcZ`。

```ts
type Plane4 = { id: string; n: V4; k: number };          // 距离 = dot(n, clip) + k，保留 >= 0

export function clipFace4(face: readonly ClipVertex[], plane: Plane4): ClipVertex[] {
  const out: ClipVertex[] = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    const da = eval4(plane, a), db = eval4(plane, b);
    if ((da >= 0) !== (db >= 0)) out.push(mixVertex(a, b, da / (da - db), plane.id)); // 同一 t 插值 clip / world / 来源
    if (db >= 0) out.push(b);
  }
  return out;
}

export function clipConvexSolid4(faces: ClipSolid, planes: readonly Plane4[]): ClipSolid {
  for (const plane of planes) {
    const crossings = collectCrossingVertices(faces, plane);
    const next = faces.map((f) => clipFace4(f, plane)).filter((f) => f.length >= 3);
    const cap = orderCapInWorldPlane(crossings);   // 在截面的世界平面内建二维基、去重、凸包排序；此处不能用 x/w y/w
    if (cap.length >= 3) next.push(cap);
    faces = next;
    if (!faces.length) break;
  }
  return faces;
}
```

- **只裁六个盒面不够：每裁一次必须补截面封口，封口继续参与下一平面的裁剪。** 否则范围体完全包住视锥时（相机钻入），六个原始面都在视锥外，会错误得到空结果。所以 `regionV1` 存的是**有面连接关系的凸多面体**（`ConvexCell`），不是无拓扑角点列表。
- 主路径：各单元先裁**深度**（\(w\ge\varepsilon\)、近、远），透视除法后求集合凸包，再与视口求交。**不能先删除所有出屏对象再求集合凸包**——两个分别在左右屏外的目标，整体包络仍可能穿过视口。
- \(\varepsilon\) 是数值保护不是新的可见距离：设计值 \(\varepsilon_w = \max(10^{-6},\,10^{-3}\cdot\text{near})\)；世界坐标去重容差另设。大型工程坐标用双精度并尽量采用**相机相对坐标**。

### 4.3 屏幕凸包、圆角外扩、视口截断与状态机 [评审，采纳]

- Andrew monotone chain 直接用于裁剪后的有限屏幕坐标（CSS 像素）；输入含非有限值**抛错**，不能丢失支撑点后宣称包住。排序用 `x, y, id` 三键保证确定性。
- padding 用**凸包与半径 = padding 的圆盘的 Minkowski 和**：直边作外平行线，顶点处用以原顶点为圆心的圆弧连接相邻外法线。**不要用「平均法线 × padding」**（锐角处距离错误）。`path.length = hullPerimeter + 2π·padding`，`path.at(s)` 给位置与单位外法线，`s` 是累计 CSS 像素弧长。
- 视口求交保留边界来源：**真实范围边界画云线；视口截断产生的闭合边画边缘提示，不伪装成云线**。超大投影不先沿数百万像素周长生成波纹再裁：线段求与矩形的交区间、圆弧求与四边的交角，只采样可能可见的弧长区间；保留全局 `s`，不在视口交点重新起相位。
- 真实轮廓全部在屏外、范围却覆盖视口：显示带方向缺口 / 箭头的视口边缘提示与「范围延伸至视口外」；只有**世界点包含测试**确认相机位于某个范围单元内才显示「视点在范围内」——**全屏投影不等于相机在体内**。
- 全部落在有效深度之外：显示不可见状态，**不回退**旧锚点偏移云线。

```ts
export type CloudFitState = 'complete' | 'viewport-cut' | 'offscreen' | 'depth-empty' | 'missing-region';

export function chooseCloudFitPresentation(state: CloudFitState) {
  switch (state) {
    case 'complete':       return 'contour';
    case 'viewport-cut':   return 'contour-and-cut-hints';
    case 'offscreen':      return 'edge-indicator';
    case 'depth-empty':    return 'depth-status-indicator';
    case 'missing-region': return 'legacy-layout';           // 唯一允许走旧布局的状态
  }
}
```

极小投影 [评审，采纳]：以**裁视口前**的投影最大边长判断——低于 12 px 进入图标、高于 18 px 退出（滞回）；不能只按面积（`1×300 px` 细长目标会被错误图标化）。激活的小目标可用 `32×24 px` 最小提示框，它是非比例强调，不代表真实占地。旧 `computeFittedCloudRectFromCorners` 的最小尺寸兜底只留给 `legacy-v0`。

### 4.4 相位稳定：特征锚定 + 相位转移 + 收口区 [评审，采纳]

- 首次用确定的来源 ID（`objectId + cornerIndex` / `cellId + vertexIndex`）选择凸包上的锚定特征；只要该特征仍在轮廓上就保留。**不要每帧重选「最左上顶点」，也不要按顶点数组索引算相位。**
- 特征消失时选相邻存活特征，把旧轮廓在该处的相位转移过去：

```ts
export function transferPhase(old: PhaseFrame, oldLength: number, oldS: number, newS: number, newId: string): PhaseFrame {
  const phase = old.phaseAtAnchor + 2 * Math.PI * mod(oldS - old.anchorS, oldLength) / old.wavelengthPx;
  return { ...old, anchorId: newId, anchorS: newS, phaseAtAnchor: mod(phase, 2 * Math.PI) };
}
```

- 没有共同特征时，在新轮廓上找最接近旧原点的边界点；近似并列候选用前一帧弧长位置消歧。换手可用约 120 ms 的过渡，但**底座始终采用当前轮廓**——混合的是同一底座上的两个非负高度场，不插值新旧几何位置（否则可能暂时漏包目标）。凸包插入共线点或采样点数变化不改变解析相位。
- 闭环约束必须正视：**周长连续变化时，「严格固定波长」「整圈整数波」「所有波峰固定世界位置」三者不能同时满足。** 本方案选恒像素观感 + 确定特征处不重置相位，用一小段收口区吸收闭合余量：

```ts
export function cloudHeightAt(s: number, length: number, frame: PhaseFrame, amplitudePx: number): number {
  const u = mod(s - frame.anchorS, length);
  const distanceToSeam = Math.min(u, length - u);
  const seamWidth = Math.min(frame.wavelengthPx, length / 4);
  const gate = smoothstep(distanceToSeam / seamWidth);
  const phase = 2 * Math.PI * u / frame.wavelengthPx + frame.phaseAtAnchor;
  return amplitudePx * gate * (1 - Math.cos(phase)) / 2;      // 始终非负：波纹只向外抬高
}
```

- **波纹只向外抬高**（单侧余弦）：正负正弦的波谷会侵入净空，单侧更容易保证包住性质；收口两侧高度与一阶变化归零。采样点按弧长生成并包含所有直线 / 圆弧连接点；**采样点数只影响离散精度，不定义相位**。
- 修订云线圆弧造型（弦长 \(c\)、弓高 \(a\) → \(R = c^2/8a + a/2\)）套到弯曲底座上不再是严格圆弧；首版不做，列 §14 #4。
- 最小面积矩形仅作「图纸外观」选项：`矩形面积 / 凸包面积 ≤ 1.12 且顶点数 ≤ 8` 进入、`> 1.25` 退出；**连续拖动相机时不切换形状类别**；角度近似并列时取最接近上一角度的候选。

参数初值 [评审，采纳为产品参数]：`λ = 52 px`（与现有 `cloudWavesPerEdgeForSizePx` 的 52 px/波一致）、`A = 4 px`、`padding = 14 px`（= `CLOUD_FIT_PADDING_PX`）。

### 4.5 像素 ↔ 世界：直接读投影矩阵，统一反投影 [评审，采纳]

标准投影矩阵下（\(W,H\) 为 CSS 视口尺寸）：

\[
\text{透视：}\ wpp_x = \frac{2d}{|P_{00}|\,W},\ wpp_y = \frac{2d}{|P_{11}|\,H};\qquad
\text{正交：}\ wpp_x = \frac{2}{|P_{00}|\,W},\ wpp_y = \frac{2}{|P_{11}|\,H}
\]

透视中的 \(d\) 是**视空间深度**，不是中心到相机的欧氏距离；正交与深度无关；直接读投影矩阵已含 `zoom`，不再乘一次缩放。

更推荐：**先生成完整屏幕折线，再统一反投影到安全的固定 `ndcZ` 平面**，不假定横纵 `worldPerPixel` 相同，也避免现有 `camera.up` 构造基在特殊姿态下退化：

```ts
export function buildCloudBillboardPolylineFromScreen(points: readonly P2[], inverseViewProjection: Mat4, viewport: { width: number; height: number }, ndcZ = 0): number[] {
  return points.flatMap((p) => {
    const q = mul4(inverseViewProjection, [2 * p.x / viewport.width - 1, 1 - 2 * p.y / viewport.height, ndcZ, 1]);
    if (Math.abs(q[3]) < 1e-15) throw new Error('invalid unprojection');
    return [q[0] / q[3], q[1] / q[3], q[2] / q[3]];
  });
}
```

`ndcZ = 0` 只决定置顶装饰线放在哪个安全 billboard 平面，**不定义世界范围**。内核统一 CSS 像素，DPR 留给渲染适配层。

### 4.6 何时取网格顶点（顶点级代理） [评审，采纳为后置能力]

- 优先用对象盒。只有盒对弯管、组合几何仍明显过松、且该云线值得精化（激活 / 选中）时才升级代理。
- 预算初值：**256 点 / 对象、4096 点 / 云线**（待调参数，非实测结论）。小网格全量求局部凸包；大网格首次扫描全部顶点、计算固定 26 个方向的支撑值、取支撑半空间的交得保守外包多面体。
- **不能抽前 256 个顶点就声称其凸包覆盖对象**（那是内包）。超预算就保留对象盒，不得丢弃目标。
- 缓存按 `geoHash + geometryRevision` 保存局部代理及面连接；世界角点由实例矩阵版本派生。**跨近平面需要面 / 边拓扑，只有采样点不够。**
- 顶点精化不解决凸包填满 U 形内部或两目标之间空白的问题——那是凸包语义本身。

### 4.7 `bbox3d` 表现修订

对每个成员对象画其变换盒 12 条边（`LineSegments`，`depthTest:false`），不再画正弦扰动；多成员多盒，不合并 AABB；可见性由各盒裁剪结果决定，与锚点无关。剪切矩阵下按平行六面体画。

### 4.8 局部套索 → 范围体（显式能力，后置） [评审，采纳；§14 #3]

- **默认拖框继续只影响呈现**；新增「自定义局部范围」是显式选择，且**不能添加或删除 member**。
- 推荐通过目标对象盒在**创建相机视空间**中的深度区间 \([d_0, d_1]\) 把屏幕多边形扫掠成体；用户显式调整深度优先，目标 raycast 只作辅助建议，**不逐点固定到各自命中深度**（相邻点分别命中前景管道 / 远处设备 / 空白，连起来会产生折叠、穿过无关构件的「范围」）。
- 深度是相机前向轴上的距离，不是沿斜射线的长度；透视相机生成**截锥形扫掠体**，正交才是柱体。套索先校验自交，再耳切三角化，每个三角形扫掠为两端面 + 三侧面的凸单元（`kind:'lasso-prism'`，`cells: ConvexCell[]`）；换相机后复用 §4.2→§4.3 流程，**不绘制原始三维波浪多边形**。
- 没有可信深度时可以明确创建「锚点平面上的平面标记」，但不能宣称恢复出体积。局部范围也不再承诺包住所有 member 的完整几何——**「目标整体」与「目标内局部问题范围」必须明确区分**（`origin:'members' | 'user-volume'`，验收口径不同，§12）。

---

## 5. 文字框与引线（B6） [评审，采纳]

**推荐：文字框锚定到云线参考包围框，偏移用 CSS 像素；引线连接「实际可见云线边界 — 文字框边界」的最近点对。**

- 参考包围框取**加 padding、尚未加波浪的轮廓包围框**（不取瞬时波峰极值，否则文字随波浪抖动）。默认锚点右上角 `uv=[1,0]`，文字框左上角偏移 `{x:18, y:0}`。所有坐标相对 overlay 内容区，不混用 `clientX` / drawing-buffer 像素 / DPR。
- 布局顺序：期望位置 → 夹紧到视口安全区（inset 8 px）→ 若与云线内部重叠，尝试四侧候选、取偏离期望最小者（固定同分排序）。文本过大先限制文字框尺寸允许内部滚动；云线覆盖整个视口、没有外侧位置时允许带底色文字框覆盖显示，**隐藏引线**而不是画穿过文字的零长度 / 反向引线。
- 引线：枚举所有可见轮廓线段 × 文字矩形四边求线段间最近点对（不是最近顶点、不是距文字中心最近点）；`distanceSq ≤ 1` 或重叠时不画；最近距离相同时用稳定的线段身份排序，避免左右跳线。

```ts
type CloudFrame = {
  referenceBounds: RectPx;                  // 加 padding、未加波浪
  enclosure: readonly P2[];                 // 闭合区域，供包含 / 重叠判断
  visibleStrokes: readonly (readonly P2[])[]; // 每条可见 stroke 的连续线段；不含视口裁剪闭合边
};
type LabelPreference = { uv: readonly [number, number]; offsetPx: P2 };

export function layoutCloudLabel(frame: CloudFrame, preference: LabelPreference, measured: Size, viewport: RectPx) {
  const b = frame.referenceBounds;
  const desired = { x: b.x + b.width * preference.uv[0] + preference.offsetPx.x, y: b.y + b.height * preference.uv[1] + preference.offsetPx.y };
  const safe = insetRect(viewport, 8);
  const size = constrainLabelSize(measured, safe);
  const rect = chooseNearestFeasibleLabelRect({ desired, size, safeViewport: safe, enclosure: frame.enclosure });
  const pair = closestStrokeRectanglePair(frame.visibleStrokes, rect);
  const overlaps = polygonIntersectsRect(frame.enclosure, rect);
  return { rect, overlaps, leader: !overlaps && pair && pair.distanceSq > 1 ? { start: pair.onStroke, end: pair.onRectangle } : null };
}
```

- **持久化只保存 `offsetPx` 的意图值**：视口缩小产生的夹紧位移不回写；视口恢复后标签回到原偏移；只有用户明确拖动标签才更新偏移。
- 兼容：旧 `leaderEndWorldPos` 继续表示世界空间文字定位点，不改成像素值、不改成云线边界点。新建或明确拖动标签时可沿旧逻辑**双写一次**兼容世界点；相机移动、夹紧、普通回放绝不回写它。旧记录没有 `labelLayoutV1` 时仍走旧世界点布局。**不能把旧 `screenOffset` 当标签偏移**——它是拖框中心相对锚点投影的偏移。

---

## 6. 数据模型（C8 + 与交互方案 §6.1 的合并口径）

### 6.1 字段集合：一套，不是两套 [调整；§14 #1]

GPT-6 Pro 给的是 `region / createdViewpoint / labelLayoutVersion / labelAnchor / labelScreenOffsetPx / renderAlgorithmVersion / regionRender` 七个字段；交互方案 §6.1 已定义 `viewpointV1 { creation, representative }` 与 `presentationV1 { geometrySnapshot(parts: AABB), algorithm, paddingCssPx }`。两者重叠，**本文合并为四个可选字段**（名称以交互方案为主，形状以 GPT 的类型为主）：

| 字段 | 来源 | 内容 |
|---|---|---|
| `regionV1?` | GPT `region` | 世界空间范围体快照（凸单元集合）+ 来源身份 + origin。**替代**交互方案 `presentationV1.geometrySnapshot.parts`（AABB 列表是它的严格子集） |
| `presentationV1?` | 交互方案名 + GPT `regionRender` | 呈现算法版本与像素参数：`algorithm`、`contour`、`paddingPx`、`wavelengthPx`、`amplitudePx`、`phaseAnchor` |
| `viewpointV1?.creation` | 交互方案 `ViewSnapshotV1` | 创建视点（position / target / up / projection kind / viewportCss；本文补 `devicePixelRatio?`）。**替代** GPT `createdViewpoint`（矩阵形式） |
| `labelLayoutV1?` | GPT 三个标签字段合一 | `{ anchor: { kind:'contour-bounds'; uv; labelPoint:'top-left' }; offsetPx: P2 }` |

`renderAlgorithmVersion` 并入 `presentationV1.algorithm`（缺省即 `legacy-v0`）。

### 6.2 类型定义

```ts
type V3 = readonly [number, number, number];
type M4 = readonly number[];          // three.js 列主序 16 数（`Matrix4.elements`）
type Face = readonly [number, number, number, ...number[]];

/** 来源身份：缺失用 null，不能用当前打开模型的信息冒充创建来源。可得性与落点见 §15 ③ */
type SourceStamp = {
  projectKey: string | null;
  /**
   * 几何来源快照。三条加载路径各有现成身份，但加载器目前一律不落库（§15 ③）：
   * gen-model-v1 = `${dbnum}:epoch${snapshot_epoch}`（records 回包 `snapshot_epoch` / `session_vector`）；
   * parquet 环境 = manifestUrl + `generated_at`；单元版本 = `${dbnum}:${unit_refno}:ses${artifact_sesno}`。
   */
  modelSnapshotId: string | null;
  /**
   * 世界坐标系身份 = DTX `globalModelMatrix` 本身。它由 dbno × 单位缩放 × 是否重心归零决定，
   * 而重心平移取自该 dbno 首批加载内容的 bbox 中心，跨会话不稳定；只存键名对不上时无法补救，
   * 存矩阵才能在不一致时做 G_new · G_old⁻¹ 重映射（§8 补充 1、§15 ③）。
   */
  globalModelMatrix: M4 | null;
  /** 人可读键 `${dbno}:${scale}:${recenter ? 1 : 0}`（与 ViewerPanel `dtxGlobalTransformAppliedKey` 同形），只作展示与快速比对 */
  coordinateFrameId: string | null;
};

type ConvexCell = {
  id: string;                          // 稳定身份，供相位锚定（§4.4）
  memberRefno: string | null;          // 来源说明，不替代 bindings
  vertices: readonly V3[];             // 顺序持久稳定
  faces: readonly Face[];              // 顶点索引；封闭、朝向一致（§4.2 封口裁剪需要）
};

type ObbSnapshot = {
  id: string;
  memberRefno: string | null;
  center: V3;
  axes: readonly [V3, V3, V3];         // 必须单位化且相互正交；否则退成 ConvexCell（剪切矩阵）
  halfSize: V3;
};

type RegionV1 = {
  version: 1;
  space: 'world';
  source: SourceStamp;
  origin: 'members' | 'user-volume' | 'legacy-snapshot';
} & (
  | { kind: 'obb-union';  boxes: readonly ObbSnapshot[] }
  | { kind: 'hull';       hull: ConvexCell }                 // 顶点级代理（§4.6，后置）
  | { kind: 'lasso-prism'; cells: readonly ConvexCell[] }   // 截锥扫掠体（§4.8，后置）
);

type CloudPresentationV1 = {
  version: 1;
  algorithm: 'legacy-v0' | 'region-v1';
  contour: 'convex-hull' | 'screen-rect';
  paddingPx: number;                    // 14
  wavelengthPx: number;                 // 52
  amplitudePx: number;                  // 4
  phaseAnchor: { featureId: string; offsetPx: number } | null;   // 稳定的 cell / vertex 身份；legacy-v0 为 null
};

type CloudLabelLayoutV1 = {
  version: 1;
  anchor: { kind: 'contour-bounds'; uv: readonly [number, number]; labelPoint: 'top-left' };
  offsetPx: { x: number; y: number };
};

export type CloudAnnotationRecord = {
  // ……现有全部字段原样保留（anchorWorldPos / leaderEndWorldPos / selectionBbox / screenOffset / cloudSize / bindings / …）……
  regionV1?: RegionV1 | null;
  presentationV1?: CloudPresentationV1 | null;
  viewpointV1?: { creation?: ViewSnapshotV1; representative?: ViewSnapshotV1 };   // 交互方案 §6.1
  labelLayoutV1?: CloudLabelLayoutV1 | null;
};
```

`viewpointV1.creation` 保存的是**创建证据**而非当前相机缓存；恢复原貌时按创建宽高比等比适配或留边，直接用新视口比例覆盖原投影不能称为精确恢复 [评审，采纳]。

### 6.3 旧记录默认值（`normalizeCloudAnnotationRecord` 补齐规则） [评审，采纳]

| 缺失项 | 补齐规则 |
|---|---|
| `bindings` / `resolve` | 保持定稿规则（由 `refnos` / `anchorRefno` 派生；`resolve` 缺省 resolved——不等于完成当前模型验证） |
| `regionV1` | 有合法 `selectionBbox` → 派生单位轴 OBB，`origin:'legacy-snapshot'`，`source` 各项 `null`；没有 → `null` |
| `viewpointV1.creation` | `null`。**不能**从锚点、拖框尺寸或当前相机推回创建视点 |
| `labelLayoutV1` | `null`（走旧世界点布局）；`anchor` 可确定性补为右上角 |
| `presentationV1` | `{ algorithm:'legacy-v0', … }`。**有派生范围不意味着用户已同意改变旧记录观感** |
| 旧尺寸与偏移 | 原值保留；旧渲染仍用现有默认尺寸与 clamp，不把夹紧结果回写 |

- 只有显式「升级为空间云线」操作才把 `presentationV1.algorithm` 置为 `region-v1`，并确认范围、标签偏移与参数；历史未知的 `viewpointV1.creation` 仍为 `null`。只有像素框、没有范围快照的旧记录**不能无证据升级**（§14 #5）。
- 新建仍按旧含义**双写** `screenOffset / cloudSize`、成员 AABB 的 `selectionBbox` 及关联旧字段。**套索范围不能占用 `selectionBbox` 改写其语义**；旧客户端只能看到旧字段所能表达的近似表现。

### 6.4 单一漏斗与 superset [评审，采纳；核对]

[核对] 07-28 方案 §3.3 已核实：读写各只有一个漏斗（`normalizeCloudAnnotationRecord` ← localStorage V3–V6 normalizer 与三条恢复链路；`addCloudAnnotation` 写）；三条恢复链路整对象展开（`...record`），superset 成立。**本次继续扩展同一漏斗，不在三个 adapter 各补一套默认值。**

```ts
function normalizeCloudAnnotationRecord(raw: CloudWire): CloudWire {
  const out = structuredClone(raw);
  normalizeExistingBaseFieldsLosslessly(out);                 // 既有基字段处理；不白名单重建、不丢嵌套扩展对象
  const fill = (key: string, value: unknown) => { if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = value; };
  fill('bindings', deriveLegacyBindings(out));                // 使用记录时间；不读 Date.now()
  fill('resolve', { state: 'resolved' });
  fill('regionV1', deriveRegionFromValidSelectionBbox(out) ?? null);
  fill('presentationV1', { version: 1, algorithm: 'legacy-v0', contour: 'screen-rect', paddingPx: 14, wavelengthPx: 52, amplitudePx: 4, phaseAnchor: null });
  fill('labelLayoutV1', null);
  return out;
}
```

- 读取补齐**不额外触发保存**（补齐发生在同一次状态赋值里；持久化仍由既有 `watch` 在状态变化时进行，与 `bindings` 派生同一口径）；校验与渲染解释分开：**未知版本、非法扩展原样保留，但不交给几何执行器**，只用安全兼容显示并标示原因。必须校验有限数、OBB 正交性、面索引、封闭性与数量预算；**不能通过截掉成员或顶点来「修复」记录**。
- 锁定 `N(N(x)) = N(x)`、输入不被修改。
- **P0 落地位置**：类型与补齐纯函数在 `src/review/domain/cloudRegion.ts`（`fillCloudRegionFieldDefaults` / `deriveLegacySnapshotRegion` / `createLegacyCloudPresentationV1`），`useToolStore.normalizeCloudAnnotationRecord` 末尾调用并再导出四个类型；「缺失」= 字段不存在或 `undefined`，显式 `null` 保留。

### 6.5 round-trip 测试矩阵 [评审，采纳]

| 维度 | 必须断言 |
|---|---|
| 三入口（task_records / workflow_sync / import_package）× V3/V4/V5/V6 容器 | 旧字段不变；新范围 / 视点 / 参数完整保留；V1/V2 继续走原历史兼容测试 |
| 旧记录 / 完整新版 / 字段缺失 / 显式 `null` / 未知未来版本 | 默认值符合 §6.3；未知顶层及嵌套字段不丢 |
| 任意入口 A → 导出 → 入口 B（九种组合） | 批注业务字段语义相等；仅豁免明确列出的既有上下文注入字段 |
| 重复 ID / 去重 / 编辑标题后再保存 | 按既有优先级保留整条获胜记录，不能拼出「旧绑定 + 新范围」 |
| 当前端 ↔ 上一发布端往返 | 验证旧端保存是否丢新字段；**能读取不等于能无损保存**（交互方案 §2.2 同一提醒） |

---

## 7. rect / obb：统一范围体，不统一批注种类（C9） [评审，采纳；§14 #7]

- **共用 `RegionV1`、来源校验与缓存层，但保留三类记录、工具入口与各自呈现**：cloud 用投影轮廓，rect / obb 仍显示空间线框。不借数据统一把旧三维盒悄悄改成屏幕框。
- 旧 OBB 的 `axes` 是单位阵 → 旧数据按保存的盒恢复；**新创建**才用真实放置矩阵：

```ts
function primitiveFromPlacement(localBox: LocalBox, worldMatrix: Mat4 /* 已含 global，只乘一次 */): ObbSnapshot | ConvexCell {
  const corners = transformBoxCorners(localBox, worldMatrix);
  return hasNonDegenerateOrthogonalBasis(worldMatrix)
    ? obbFromOrthogonalAffineTransform(localBox, worldMatrix)
    : closedConvexCellFromTransformedBox(corners);          // 剪切：保留八角点凸体，不正交化冒充 OBB
}
```

- 多对象不能伪装成一个「精确 OBB」。迁移路径「旧记录适配读取 → 新建双写 → 显式升级旧记录」。不迁移的代价：长期维护两套坐标变换、身份校验、失效规则与缓存，且同一目标在 cloud 与 obb 中出现不同包围范围。

---

## 8. 未加载 / 失效 / 版本切换（D10） [评审，采纳；按 ADR-0050/0051 与现有实现调整]

**快照是回放权威；目标解析负责验证，不静默改写快照。** 普通模型加载可补足运行时信息；几何或版本变化不能偷偷把旧问题迁移到新位置。

[核对] ADR-0050 的最小运行时解析已于 2026-09-14 落地：`src/review/domain/bindingResolve.ts::classifyBinding` 四态 `resolved / unloaded / missing / stale`（`unloaded` 不擅判 `missing`；`missing` 只认权威证据；`stale` 仅对 anchor 按包围盒外扩带判），`useAnnotationBindingResolve.ts` 在 `dtxLoaderRevision` 变化后批量重算，结果只在内存。**本文沿用这套四态，不另建 `resolveState(Evidence)`**；GPT 的证据表映射为对现有探针的两项补充：

| 情况 | 状态与行为 |
|---|---|
| 同源、确认存在、尚未加载 | `unloaded`：按完整快照正常显示，可标「未加载」；高亮触发按需加载 |
| 权威查询确认当前版本已删除该目标 | `missing`：快照灰显，「元素不存在」 |
| 身份不明 / 版本不匹配 / 锚点重定位失败 | `stale`：按快照显示 + `STALE` 标签 |
| 部分成员加载成功 | **不用已加载子集缩小范围**；保留完整快照与逐成员状态 |
| 坐标系已变且无可信转换（`regionV1.source` 与当前不匹配） | 不把旧世界点硬贴到新模型；独立快照视图或代表截图，标明无法对齐 |

- **补充 1**：`regionV1.source` 与当前模型身份不匹配 → 范围整体判 `stale`（新增 probe `sourceMatches(source)`；身份不可得时不判）。坐标系一项单独处理：`source.globalModelMatrix` 与当前 DTX `getGlobalModelMatrix()` 不等时，**先用 G_new · G_old⁻¹ 把范围体重映射到当前世界系再投影**（这是唯一有可信转换的情形），不判 stale；矩阵缺失（旧记录）才落到「无可信转换」一行。[核对，§15 ③] ViewerPanel 目前在单位 / 重心设置变化时**清空全部批注**（`ViewerPanel.vue:1836–1869`），新版记录带矩阵后这条一期安全策略可对 `regionV1` 记录放宽为重映射——列为 P2 之后的独立事项，不在 P0 动。
- **补充 2**：`getAABB() == null` 不是删除证据；BRAN 自身无 mesh 也不能直接判 `missing`——成员是否含子树由采集契约（`getAABB` vs `getSubtreeAABB`）明确，不由加载是否命中决定。
- `missing / stale` 下的写操作只允许**移除失效 member（作为重绑提交的一部分，目标不得变空）或删除批注**。GPT 原文「重绑锚点只移动图钉」**与 ADR-0051 冲突，不采纳**：锚点不可换，锚点失效只能另建批注（`replacesAnnotation`，交互方案 §6.1 后置）。查看详情、截图不属于修改操作。
- 版本切换的 `modelEpoch` = [核对] `useDbnoInstancesDtxLoader.dtxLoaderRevision`；异步解析结果携带 `{ modelEpoch, bindingRevision }`，返回时不一致就丢弃。重绑 member 时**原子更新**绑定、范围、来源及兼容字段。

呈现状态（每帧，§4.3 `CloudFitState`）、绑定解析状态（模型加载后，四态）与来源校验（`SourceStamp`）三者正交，UI 分栏显示，不压进一个 status（交互方案 §2.2 同一提醒）。

---

## 9. 脏标记、合批与 LOD（D11） [评审，采纳]

### 9.1 脏标记按流水线阶段拆开

现有循环每帧 `setPoints`，目标 bbox 另有 500 ms TTL。**不能只加一个统一 `dirty`**，否则颜色变化仍会重建几何。

```ts
type Stamp = {
  cameraWorld: number; projection: number; viewportCss: number; overlayTransform: number; dpr: number;
  modelEpoch: number; targetBounds: number; bindings: number; effectiveRegion: number;
  shapeStyle: number; paintStyle: number; labelMetrics: number; labelPreference: number; presentation: number;
};

export function computeDirty(a: Stamp, b: Stamp) {
  const changed = (...keys: (keyof Stamp)[]) => keys.some((k) => a[k] !== b[k]);
  const resolve = changed('modelEpoch', 'targetBounds', 'bindings');
  const project = changed('cameraWorld', 'projection', 'viewportCss', 'overlayTransform', 'effectiveRegion');
  const shape = project || changed('shapeStyle', 'presentation');
  return { resolve, project, shape, label: shape || changed('labelMetrics', 'labelPreference'), paint: changed('paintStyle', 'presentation', 'dpr') };
}
```

- 版本号由适配层维护（three.js 相机没有矩阵版本计数：相机 `updateMatrixWorld` 后比较两组矩阵各 16 个元素；`modelEpoch` 用 `dtxLoaderRevision`；DTX 对象在两次 epoch 之间静态，`targetBounds` 随 epoch 推进即可）。目标变化先验证，只有有效范围变化才推进 `effectiveRegion`。
- [核对，§15 ④] `dtxLoaderRevision` 覆盖生产环境全部**几何**变更路径（实例加载 / 版本切换重载 / 重新生成 / AABB 代理盒都汇入两处 bump），但**不覆盖 `setGlobalModelMatrix`**（单位 / 重心变化，`ViewerPanel.vue:1703–1738`）。所以 `Stamp` 再加一项 `globalModelMatrix`（16 元素比较，与 `cameraWorld` 同法），归入 `project` 组；不另造一个全局 revision。另：版本对比的隔离图层（`isolated:true`）加载也会 bump，主模型未变却触发一次批注重解析——无害但浪费，P0 顺手让 `isolated` 加载跳过 bump。
- 颜色 / 透明度只更新材质；影响外包距离的线宽、halo、padding、波幅归 `shapeStyle`。标签文字、字体加载、折叠、实测尺寸都是 `labelMetrics` 依赖。TTL 只作事件遗漏的低频兜底，值未变化不触发重建。
- **验收：全部依赖静止时，投影、轮廓构建、`setPoints`、Buffer 上传计数均为零增量**，不只是「帧率看起来正常」。

### 9.2 合批：先减少工作，再减少 draw call

- **不要把多条云线直接拼进一个 MeshLine 点数组**——[核对，§15 ②] 本仓 `@lume/three-meshline@4.0.5` 的 `MeshLineGeometry.setPoints` 只会生成**一条连续线带**：`previous / next` 取整个数组的相邻点、索引对每个 `j < pointCount-1` 都连三角形对、闭合判定只看首尾两点、`counters / uv` 按整条归一化，**没有任何子路径 / 断点机制**。拼进去必然出现跨批注连接线与错乱的虚线相位。合批只能走自建索引线带几何（每条轮廓自己维护 `previous / next / side / width` 与索引范围，复用 MeshLineMaterial 的 shader 约定），同材质分组；halo 与主线可以是两次绘制，不追求「永远一次 draw call」。**结合 §9.3 的 64 条全轮廓预算，每云线一个 MeshLine（现状）= 最多 128 个 draw call（主线 + halo），大概率不构成瓶颈——合批列为 P4 中「按实测数据决定」项，不预先实施。**
- 顶点着色器可接收 `basePointPx / normal / arcLengthPx / phase / annotationId` 算波浪与线宽展开，但**凸包、裁剪、累计弧长、可变拓扑仍由 CPU 提供**；GPU 正弦不消灭这些成本，还要处理采样、拐角、透明叠加顺序与拾取——在性能数据证明波浪构建是瓶颈后再引入。

### 9.3 上千条时的 LOD

- 全轮廓只保留激活批注与有限选中集合，**初始预算 64 条**（后续实测调整）；其他降为图钉或屏幕网格聚合，并且**不计算凸包、不创建完整文字 DOM**。
- 隐藏记录仍隐藏；列表与成员统计完整保留；LOD 是运行时决策，**不能为省性能批量写 `visible=false`**（交互方案 §3.4 同一约束）。LOD 切换加滞回；拖动中的批注固定在高等级；图钉不宣称「包住范围」。

---

## 10. 遮挡淡化（D12） [评审，采纳为后置可选；核对补充]

- **默认仍 `always-on-top`；inspection 后置且独立开关。** 任何模式都保持 `depthTest:false`，inspection 只调透明度，不让深度测试把批注抹掉。
- 中心射线只能作启发式：云线中心可能在空洞、锚点可能属于非目标对象。先验证射线确实命中成员表面，再判断其前方是否有更近的非目标命中。未命中目标是 `unknown`，不是「被挡住」。

```ts
type Probe = 'clear' | 'blocked' | 'unknown';
export function inspectionFactor(mode: 'always-on-top' | 'inspection', probes: readonly Probe[], emphasized: boolean, snapshotInvalid: boolean): number {
  if (mode === 'always-on-top' || emphasized || snapshotInvalid) return 1;
  return probes.length > 0 && probes.every((p) => p === 'blocked') ? OCCLUDED_ALPHA : 1;   // 有可见或未知证据时保守保持可读
}
// OCCLUDED_ALPHA 取尺寸系统 theme.inspection.occludedAlpha（当前 0.35），不另定常量；GPT 原文写 0.4
```

- 对少量代表性成员采样，只有全部有效样本持续遮挡才淡化；激活云线、文字、STALE 提示保持可读。比较距离时排除目标自身，使用与渲染一致的隐藏 / 裁剪 / 透明策略。仅对高 LOD 批注、相机停止后且场景版本改变时查询；关闭 inspection 时射线调用数必须为零。
- [核对] GPT 说「尚不能证明存在廉价的全场景最近遮挡查询」——**本仓已有**：ADR-0061 的 `DimensionViewerAdapter.isSegmentBlocked(from, to, toleranceM, hints)`（`dtxDimensionViewerAdapter.ts:121–170`），用 `collectObjectBoundsIntersecting(segmentBox, { visibleOnly:true })` 筛候选再逐个 `raycastObject`，并支持 `hints.subject` 排除被点名构件自身、`onModel` 排除包着探测点的体。云线 inspection 应**复用这条缝**（把 member refno 作为 `subject`），α 与尺寸系统 `theme.inspection` 对齐（当前 0.65 / 0.35，ADR-0064 后），而不是再造一套常量。

---

## 11. 分阶段落地（E13） [评审，采纳；与交互方案 U4 对齐]

本文 P0–P4 **全部落在交互方案 U4「投影包络、当前问题优先、LOD」之内**（P3 的 rect / obb 部分是 U4 的扩展），不与已实施的 07-28 Phase 1+2、也不与 U0–U3 抢排期。阶段编号只针对本次演进。

| 阶段 | 开关 | 独立交付 | 验收与回退 |
|---|---|---|---|
| **P0 兼容基线**（✅ 2026-09-14 落地，§16） | — | 新增类型、漏斗补齐（§6.3–6.4）、三链路 round-trip（§6.5）、旧截图与调用计数基线；加载器 `DbnoRuntimeCache` 记录每次加载的来源身份（`snapshot_epoch` / manifest / `artifact_sesno`，§15 ③）供创建时填 `SourceStamp`；`isolated` 加载不 bump `dtxLoaderRevision`（§15 ④） | 旧记录输出不变；没有新呈现启用；来源身份只记不用 |
| **P1 标签 + 脏标记**（✅ 2026-09-14 落地，§17） | `cloudLabelLayoutV1`、`cloudDirtyCache` | 接入现有轮廓：像素意图标签与最近点对引线（§5）、分阶段脏标记（§9.1） | 最近点、夹紧可逆、旧世界点兼容、静止零重建；分别关开关回退 |
| **P2 范围体呈现** | `annotationUx.projectedEnvelope`（交互方案同名） | 首项 `DTXLayer.getObjectLocalBoxAndWorldMatrixInto`（§4.1）；并行几何内核（§4.1–4.5、4.7）、创建时写 `regionV1(obb-union, origin:'members')` + `viewpointV1.creation`；最小来源校验与 epoch 隔离、`globalModelMatrix` 重映射（§8） | 多机位包含、裁剪连续性、相位测试通过；目标范围不完整（`coverage` 不足）时不写新版记录；关闭后兼容显示，保留新字段 |
| **P2.5 局部套索（可选，后置）** | `cloudUserVolume` | §4.8 截锥扫掠体 + 深度调整交互 | 套索验收口径按 `origin:'user-volume'`；拒绝自交 |
| **P3 共享范围体** | `annotationSharedRegion` | rect / obb 新建走 `primitiveFromPlacement`（§7）；完整失效与重绑 member 交互（§8） | 真 OBB / 剪切分支、部分加载、版本切换、原子重绑；旧记录不自动迁移 |
| **P4 性能与显示** | `annotationUx.adaptiveLod`、`cloudBatching`、`cloudInspectionFade` | LOD（§9.3）→ 合批（§9.2）→ 按数据决定 GPU 波浪；inspection 最后单开（§10） | 合批前后几何等价、无跨线连接、调用预算；任一优化可退回 CPU 基线 |

回退不能绕过来源校验：新版来源不匹配时，即便退回旧外观也只能按快照降级，不能重新启用「当前模型 AABB 自愈」。

---

## 12. 测试（E13） [评审，采纳]

### 12.1 纯函数（Vitest，`src/review/domain/annotationProjection/*.test.ts`）

- **真实包围，不只矩形**：现有五机位测试先断言八角点在近远平面内再判矩形包含，没有证明穿越近平面或实际波浪轮廓的包围性质。新测试对 `renderRegionPure(region, camera, viewport, options)` 的输出：

```ts
it.each(cameraCases)('新版范围包围：$name', ({ camera, viewport }) => {
  const actual = renderRegionPure(region, camera, viewport, renderOptions);
  const targetHull = referenceVisibleTargetHull(sourceGeometry, camera, viewport);   // 独立参考裁剪器 / 解析 fixture，不复用被测函数自证
  expect(allCoordinatesFinite(actual)).toBe(true);
  expect(hasSelfIntersection(actual.enclosure)).toBe(false);
  expect(polygonDifferenceIsEmpty(targetHull, actual.enclosure, 0.5)).toBe(true);   // 目标边与内部没有被波谷切出
});

it('静止 120 帧不重建、不上传', () => {
  const result = simulateFrames(sameFrameInput, 120);
  expect(result.afterWarmup).toMatchObject({ projections: 0, contourBuilds: 0, setPoints: 0, bufferUploads: 0 });
});
```

- 机位集覆盖：正交、透视、roll、近平面穿越、相机进入范围体、部分出屏、极远小目标、视口与 DPR 变化。连续性仅对非退化小步轨迹设位移上界；真正消失或拓扑切换测「状态合理、无 NaN、没有跳回旧固定框」。
- 相位：整体平移、缓慢缩放跨波数阈值、稳定特征消失后的相位交接、闭合接缝——**不能把「波峰数不变」当稳定**。
- 有效 padding 应覆盖向内波幅（单侧余弦下为 0）、最大描边半宽与安全余量。
- 验收对象区分：`origin:'members'` 应包住成员几何；`user-volume` 应包住保存的用户范围。若业务要求套索也必须包含整个成员，则在创建时校验并拒绝，不能用改写绑定来通过测试。
- 数据：§6.5 矩阵 + 幂等 `N(N(x)) = N(x)` + 零写入。

### 12.2 Playwright（`e2e/`，复用 BRAN `24381_145018` 真机样本）

- 固定浏览器、字体、视口、DPR；等待模型完整就绪、字体完成、overlay 已处理指定相机版本，**不靠固定 sleep 截图**。每个确定机位同时保存截图与调试数据：轮廓坐标、文字框、最近点对、`CloudFitState`、LOD 等级、重建计数。
- 三条恢复链路使用同一记录与同一机位比较；另测缩小再恢复视口、卸载后重载成员、失效重绑、「旧版本加载请求晚于版本切换返回」。
- 保留 07-28 的一对一、一对多与目标 — 锚点解耦场景。
- **最终 Go 门：无损回放、真实轮廓包含、身份隔离、静止零重建四项同时通过**；截图负责发现观感退化，不能替代这四项正确性断言。

---

## 13. 与既有文档的冲突与裁决

| 冲突 | 裁决 |
|---|---|
| 07-28 附录决策 #8「bbox3d 用合并 AABB」 vs 本文 §3.2「同一范围体的真实盒边」 | 表现修订，**§14 #2 已拍板通过**，随 P2 落地；P2 上线前 bbox3d 行为不变 |
| GPT D10「重绑锚点只移动图钉」 vs ADR-0051「锚点不可换」 | **以 ADR-0051 为准**，不提供换锚点 |
| GPT C8 `region / createdViewpoint / labelAnchor…` vs 交互方案 §6.1 `presentationV1 / viewpointV1` | 合并为 §6.1 四字段；`presentationV1.geometrySnapshot` 由 `regionV1` 替代；交互方案 §6.1 待随本文同步修订 |
| GPT D12「尚无廉价遮挡查询」 vs ADR-0061 `isSegmentBlocked` | 本仓已有，复用（§10） |
| GPT D10 `resolveState(Evidence)` vs 已落地 `classifyBinding` 四态 | 沿用已落地实现，补两个探针（§8） |
| 简报判断 #4 #5 #6 #9 | 按 E14 修正措辞（§2.2） |
| 交互方案 §3.4 `presentationV1.algorithm:'projected-box-union-v1'`（AABB parts） | 升级为 `region-v1`（对象变换盒 + 凸包）；AABB parts 只作 `legacy-snapshot` 派生 |

---

## 14. 拍板项（2026-09-14 20:50 定稿：十项全部按「推荐」列）

> 决策记录：用户 2026-09-14 20:50 答复「§14 十项全按推荐拍板，先补四项工程证据再进入 P0 兼容基线」。下表「推荐」列即定稿口径；「不建议」列保留作为被否决方案的记录。

| # | 决策 | 推荐（= 定稿） | 不建议（已否决） |
|---|---|---|---|
| 1 | 新增字段口径 | §6.1 四字段（`regionV1 / presentationV1 / viewpointV1.creation / labelLayoutV1`），与交互方案 §6.1 合并 | GPT 七字段与交互方案两字段并存（同一事实两处存） |
| 2 | `bbox3d` 表现 | 改为同一范围体的真实盒边（多成员多盒），可见性由裁剪结果决定 | 保留合并 AABB 12 条随相机游动的波浪边 |
| 3 | 局部套索范围 | 后置 P2.5，独立开关；首版只做 `origin:'members'` | 与 P2 同批；或把拖框改回范围作者工具 |
| 4 | 波纹形态 | 单侧余弦（只向外抬高）+ 收口区；λ 52 / A 4 / padding 14 px | 保持双侧正弦（波谷侵入净空）；首版就做修订云线圆弧 |
| 5 | 旧记录呈现 | 保持 `legacy-v0`，显式「升级为空间云线」才切 `region-v1` | 一律自动升级（历史记录观感无声改变） |
| 6 | 遮挡淡化 | 后置可选 inspection，默认置顶；复用 ADR-0061 缝与 α | 本期实现；或改 `depthTest` |
| 7 | rect / obb | 共用 `RegionV1` 与来源校验；新建双写 + 显式升级，不自动迁移 | 三类记录合并为一类；或完全不统一 |
| 8 | 顶点级代理 | 首版不做，只留 `kind:'hull'` 类型与缓存接口；预算 256 / 4096 待实测 | 首版即做顶点凸包 |
| 9 | LOD 预算 | 64 条全轮廓 + 图钉 / 聚合，滞回 | 无上限或按 `visible=false` 省性能 |
| 10 | 引线起点 | 可见云线边界 — 文字框最近点对；重叠时隐藏引线 | 保持从图钉出发的固定世界点 |

实施前必须补的工程证据：① `DTXLayer` 新增局部盒 + 世界矩阵公开访问器（§4.1）；② MeshLine 是否支持独立子路径（§9.2）；③ 模型版本 / 坐标系可靠标识是否可得（`SourceStamp`，交互方案 §9 同一项）；④ 现有 `dtxLoaderRevision` 能否覆盖 `replaceExistingObjects` 之外的几何变更。→ **已核实，见 §15。**

---

## 15. 实施前工程证据核实（2026-09-14，[核对]）

四项全部只读核实源码，未改任何 `src/` 文件。每项给出：事实（文件:行）→ 结论 → 对方案的影响。

### ① `DTXLayer` 局部盒 + 世界矩阵访问器：**不存在，需新增；且不能拿 `getObjectBoundingBoxInto` 凑**

| 事实 | 位置 |
|---|---|
| 局部盒按 geoHash 缓存于私有 `_geometryLocalBBoxes`，`addGeometry` 时**必填**（全顶点扫描一次），`_computeGeometryLocalBBox` 只是兜底重算 | `DTXLayer.ts:308, 452–461, 709–724` |
| 实例矩阵存 `_matricesBuffer[objectIndex*16..+16]`；`getObjectGeometryData` 读出后 `premultiply(_globalModelMatrix)`——**已含全局矩阵** | `:2014–2017` |
| `obj.boundingBox` 由 `_resolveObjectBoundingBox` 决定：有服务端预算 AABB 且不「可疑」（中心偏离 > 2× 最大边或尺寸比 > 100）时**直接采用预算盒**，否则才是 局部盒 × 矩阵 | `:730–780, 649` |
| `getObjectBoundingBoxInto` = `obj.boundingBox × _globalModelMatrix`，是世界 AABB | `:1940–1944` |
| `replaceGeometry` 只 `_geometries.delete` 后重新 `addGeometry`，`_geometryLocalBBoxes` 被同 geoHash 新盒覆盖；旧对象仍指旧 handle（调用方已隐藏） | `:481–484` |
| 唯一取局部几何的公开口 `getObjectGeometryData` 要切 `positions / normals / indices` 三个 TypedArray 并建 BufferGeometry（LRU） | `:1957–2023` |

**结论**：现有公开 API 拿不到「局部盒 + 世界矩阵」这一对；`getObjectBoundingBoxInto` 的盒可能是服务端预算 AABB，从它反推角点会与真实变换盒不一致。新增 `getObjectLocalBoxAndWorldMatrixInto(objectId, localBox: Box3, worldMatrix: Matrix4): boolean`（读 `_geometryLocalBBoxes.get(obj.geoHash)` + `_matricesBuffer` + `_globalModelMatrix`，零分配）即可，**十行以内**。
**影响**：§4.1 补了这条事实与签名；P2 首项。`_computeGeometryLocalBBox` 保持私有。

### ② MeshLine 独立子路径：**不支持**

| 事实 | 位置 |
|---|---|
| 依赖 `@lume/three-meshline@^4.0.5`（实装 4.0.5） | `package.json` |
| `setPoints` 生成单条线带：`previous / next` 取整个数组的相邻点；索引对每个 `j < pointCount-1` 连两个三角形；无 NaN / 断点 / 多段协议 | `node_modules/@lume/three-meshline/src/MeshLineGeometry.ts:68–265` |
| 闭合判定 `#pointsAreEqual(0, pointCount-1)` 只看首尾两点 | `:160, 236, 297–305` |
| `counters = j / points.length`、`uv = j / (pointCount-1)` 按整条归一化（虚线 / 渐变相位依赖它） | `:135–137, 150–152, 193` |

**结论**：多条云线拼进一个 `MeshLineGeometry` 必然产生跨批注连接线，并打乱虚线相位与闭合判定。合批只能自建索引线带几何。
**影响**：§9.2 改写为「自建几何或不合批」；结合 §9.3 的 64 条预算，现状每云线一个 MeshLine 最多 128 个 draw call，**合批降为 P4「按实测数据决定」项**。

### ③ 模型版本 / 坐标系可靠标识：**数据在线路上都有，但加载器一律不落；坐标系身份 = `globalModelMatrix`，且跨会话不稳定**

| 路径 | 现成身份 | 落地情况 |
|---|---|---|
| gen-model-v1 records | `ModelRecordsResponse.snapshot_epoch?` + `session_vector?: {dbnum, sesno}[]` | `genModelV1Api.ts:495–509`；`src/model-source/` 未透传（grep `session_vector|sesno` 无命中） |
| parquet 环境包 | `manifestUrl` + `manifest.generated_at`（缺失会抛错） | `useDbnoInstancesParquetLoader.ts:236–237, 440–453` |
| 最小交付单元版本 | `getModelUnitCommit(dbno, unitRefno, sesno)` → `commit.artifact_sesno` + `manifest_url` | `modelUnitVersionApi.ts:11–19, 57`；`useModelGeneration.ts:1696–1719` 只写日志 |
| 运行时缓存 | `DbnoRuntimeCache` 字段里**没有任何来源 / 版本字段**（只有 refno ↔ objectId / noun / transform 映射） | `useDbnoInstancesDtxLoader.ts:75–96, 149–169` |
| 坐标系 | `globalModelMatrix` = `dbno × scale(单位 mm→0.001 / m→1 / URL 覆盖) × recenter(重心归零)`；recenter 平移取该 dbno **首批加载内容**的原始 bbox 中心 | `ViewerPanel.vue:1468–1500, 1703–1738` |
| 坐标系变化的现行策略 | 单位 / 重心设置变化 → **清空全部测量 / 批注 / 点集 / 清距标注**并 toast | `ViewerPanel.vue:1836–1869` |
| 项目身份 | 校审链路有 task / round；未见稳定 `projectKey` 概念 | — |

**结论**：`modelSnapshotId` 三条路径都能在加载那一刻拿到，但今天没人记；`coordinateFrameId` 若只存键名 `${dbno}:${scale}:${recenter}` 则 recenter 情形下**同键不同矩阵**（取决于加载顺序），对不上时无法补救。
**影响**：§6.2 `SourceStamp` 增加 `globalModelMatrix: M4 | null`（存矩阵本身，`coordinateFrameId` 降为展示键）；§8 补充 1 增加「矩阵不等 → G_new · G_old⁻¹ 重映射后投影」路径；P0 增加「`DbnoRuntimeCache` 记录每次加载的来源身份」；`projectKey` 首版填 `null`。ViewerPanel 那条「设置变化即清空」对带矩阵的新版记录可放宽，列 P2 之后独立事项。

### ④ `dtxLoaderRevision` 覆盖面：**几何变更全覆盖；坐标系变更不覆盖；隔离图层多 bump**

| 变更路径 | 走哪 | 是否 bump |
|---|---|---|
| 普通实例加载 / 版本切换重载（`replaceExistingObjects`）/ 重新生成（`forceRefreshGeometries` → `replaceGeometry`）/ 单元版本切换（`showModelUnitVersion` → `showModelByDbnum`） | 都汇入 `loadDbnoInstancesForVisibleRefnosDtx` | ✅ `:1201–1203`（`toLoad.length > 0`；抛错回滚路径不 bump，符合预期） |
| 空间查询 AABB 代理盒加载 | 代理加载器 | ✅ `:763` |
| 失败回滚 `rollbackObjectsAddedAfter` | 仅 `:1173` 失败分支 | 不 bump（索引已回滚，正确） |
| `setObjectMatrix` | **生产代码无调用**（仅测试） | — |
| 对象删除 | **不存在公开 API**；替换只隐藏旧对象 | — |
| `setGlobalModelMatrix`（单位 / 重心） | `ViewerPanel.vue:1713, 1717, 1735, 2495, 4636` | ❌ 不 bump（今天靠清空批注兜底） |
| 版本对比隔离图层（`isolated:true`，独立 `new DTXLayer`） | 同一加载器 | ⚠️ 会 bump，主模型未变却触发一次批注重解析 |

**结论**：`dtxLoaderRevision` 作 `modelEpoch` 成立；世界坐标系变化需另起依赖。
**影响**：§9.1 `Stamp` 增加 `globalModelMatrix`（16 元素比较）归 `project` 组，不另造全局 revision；P0 顺手让 `isolated` 加载跳过 bump。

### 证据带来的方案微调汇总

| 章节 | 微调 | 性质 |
|---|---|---|
| §4.1 | 补 `obj.boundingBox` 可能是预算 AABB 的事实；访问器签名改 `…Into(objectId, Box3, Matrix4): boolean` | 事实修正 |
| §6.2 | `SourceStamp` 增 `globalModelMatrix: M4 \| null`；`modelSnapshotId` 注明三路径来源 | 字段形状（仍在 §14 #1 四字段口径内） |
| §8 | 补充 1 增加矩阵重映射路径；点名 ViewerPanel 清空策略 | 行为补充 |
| §9.1 | `Stamp` 增 `globalModelMatrix`；`isolated` 不 bump | 行为补充 |
| §9.2 | 合批改为「自建几何或不合批」，降为按实测决定 | 优先级下调 |
| §11 | P0 增来源身份记录 + isolated 不 bump；P2 首项访问器 | 阶段内容 |

---

## 16. P0 兼容基线实施记录（2026-09-14）

用户 20:5x 确认「按五项 P0 范围开工（含加载器两小项）」。全部落地，**没有任何新呈现启用**，旧记录渲染路径一行未改。

| # | 内容 | 落点 |
|---|---|---|
| 1 | 类型：`SourceStamp / ConvexCell / ObbSnapshot / RegionV1 / CloudPresentationV1 / CloudLabelLayoutV1 / ViewSnapshotV1 / CloudViewpointV1 / CloudRegionFields(+Filled)`；`CloudAnnotationRecord` 增四个可选字段并再导出类型 | 新增 `src/review/domain/cloudRegion.ts`（纯类型 + 纯函数，无 three / Vue 依赖）；`src/composables/useToolStore.ts` |
| 2 | 漏斗补齐：`normalizeCloudAnnotationRecord` 末尾 `fillCloudRegionFieldDefaults`——`selectionBbox` 合法 → `legacy-snapshot` 单位轴 OBB 否则 `null`；`presentationV1` → `legacy-v0`（14 / 52 / 4 px，`phaseAnchor:null`）；`viewpointV1` / `labelLayoutV1` → `null`；显式 `null` 与未知版本原样保留；不改输入；幂等 | 同上 |
| 3 | round-trip 测试：域纯函数 8 例；store 漏斗 10 例（容器 V3/V4/V5/V6/V7 旧记录补齐、像素框不伪造范围、显式 null / 未知版本、add / update、export→import 深相等、`N(N(x))=N(x)` 字节相等）；三链路各 1 例（task_records 含同 id 整条获胜 + 进 store 闭环、workflow_sync、import_package） | `src/review/domain/cloudRegion.test.ts`、`src/composables/useToolStore.cloudRegion.test.ts`、`src/review/adapters/{toolStoreAdapter,workflowSyncAdapter,importSnapshotAdapter}.test.ts` |
| 4 | 加载器来源身份：`DtxLoadSourceStamp { dataSource, modelSnapshotId, manifestUrl, generatedAt, loadedAt }`，`DbnoRuntimeCache.refnoLoadSource` 随每个 `loadedRefnos.add` 写入、替换失败随快照回滚、AABB 代理盒同记；parquet 的 `generated_at` 由 `useDbnoInstancesParquetLoader` 新增 `lastRegisteredManifest` 暴露（钉住清单优先取 `parquetManifest.generated_at`）；访问器 `getDtxRefnoLoadSource(dbno, refno)` / `…AcrossAllDbnos(refno)` | `src/composables/useDbnoInstancesDtxLoader.ts`、`src/composables/useDbnoInstancesParquetLoader.ts` |
| 5 | `isolated` 加载不 bump `dtxLoaderRevision` | `useDbnoInstancesDtxLoader.ts` 尾部 |

**验证**（2026-09-14 21:3x，本机）：
- `npx vitest run`（全量）：313 个文件 / 2670 用例全绿，其中本次新增 8 + 10 + 3 + 3（loader）= 24 例。
- `npm run type-check`（vue-tsc + 基线比对）：本次改动文件 **0 条新增**；比对报告里剩余 8 条「基线外」错误全在未触碰文件（`ReviewPanel.test.ts` 4 条、`useDtxTools.{cloudCreation,objectMeasure,pickCandidateCycle}.test.ts` 4 条），已用 `git stash` 暂存本次改动复跑确认**同样存在**，属 HEAD 既有、与本次无关，未改基线。
- `npx eslint` 本次改动的 10 个文件：0 错误（修掉 2 处 `ReadonlyArray<T>` → `readonly T[]`）。
- 未运行 Playwright（P0 无 UI 变化）。**未提交**，等用户决定 commit 切分。

**遗留 / 后续**：
- gen-model-v1 路径的 `modelSnapshotId` 暂为 `null`：`ModelRecordsResponse.snapshot_epoch / session_vector` 在线路上有，但 `src/model-source` 的 `instanceEntriesByRefnos` 端口只回 `Map`，透传要改端口契约（`ports.ts` + `modelRecordSource.ts`），另起一小步，不混进 P0。
- `SourceStamp.projectKey` 首版 `null`（校审链路只有 task / round，无稳定项目键）。
- `globalModelMatrix` 进 `SourceStamp` 的**写入**在 P2 创建路径（P0 只定类型与补齐规则）。
- 字段一旦经保存回写，旧记录会带上 `presentationV1:{algorithm:'legacy-v0',…}` 与三个 `null`——这是 §6.3 的既定口径（旧端读取忽略未知字段即可；能读不等于能无损保存，见 §6.5 最后一行）。

P0 已提交：`af4b382`（15 文件；`useToolStore.ts` 只取云线 hunk）。

---

## 17. P1 标签 + 脏标记实施记录（2026-09-14）

用户确认「进入 P1：像素意图标签 + 最近点对引线 + 分阶段脏标记（开关 cloudLabelLayoutV1 / cloudDirtyCache）」。两个开关默认开、各自独立可关（URL `?cloud_render_flags=cloudLabelLayoutV1:0,cloudDirtyCache:0` 或 localStorage `plant3d.cloudRenderFlags`）。

| # | 内容 | 落点 |
|---|---|---|
| 1 | **纯函数内核**（§3.3 点名的目录）：`layoutCloudLabel(frame, preference, measured, viewport)`——参考包围框（加 padding 未加波浪）锚点 `uv` + 意图偏移 → 夹紧安全区（内缩 8 px）→ 与云线内部重叠则试右 / 左 / 下 / 上四侧候选取离期望最近者（同分固定顺序）→ 四侧都不行允许覆盖并隐藏引线；引线 = 「可见轮廓线段 × 文字框四边」最近**线段对**（`closestSegmentPair`），≤ 1 px 不画，同分取先遇到的；`labelOffsetFromTopLeft` 与 `desiredLabelTopLeft` 互逆供拖动提交 | 新增 `src/review/domain/annotationProjection/labelLayout.ts`（+ 13 例测试） |
| 2 | **分阶段脏标记**：`computeCloudDirty(prev, next)` 按 `resolve / project / shape / label / paint` 五组判脏（`shape ⊇ project`，`label ⊇ shape`）；`Stamp` 比方案多 `globalModelMatrix`（§15 ④）；`createArrayVersionTracker`（16 元素逐个比较）/ `createValueVersionTracker` 给相机矩阵、视口、目标 AABB、记录引用维护版本号 | 新增 `.../annotationProjection/dirty.ts`（+ 9 例） |
| 3 | **开关**：`isCloudRenderFlagEnabled / setCloudRenderFlag / resetCloudRenderFlagCache` | 新增 `src/composables/useCloudRenderFlags.ts`（+ 3 例） |
| 4 | **适配层** `useDtxTools.updateOverlayPositions`：帧级戳（相机 world / projection、视口、overlay 偏移、DPR、DTX 全局矩阵、`dtxLoaderRevision`、绘制模式 + padding、颜色 / 透明度 / 线宽）一帧算一次，逐云线加目标 AABB 六数、记录引用、文字框实测尺寸；`paint` 脏才写材质，`shape` 脏才重建轮廓 / `setPoints`，`label` 脏（或拖动中）才重排文字框。轮廓阶段把「加 padding 未加波浪」的屏幕矩形存成 `CloudFrame`（bbox3d 模式取 8 角点投影外接矩形，角点越界则本帧无 frame → 文字框退回旧布局）。V1 文字框 DOM 直接 `left/top` 定位（`transform:none`，通用「按 worldPos 投影」循环跳过 `layoutMode==='v1'`）；引线端点按 frame 深度反投影回世界后走原 `updateLeaderGeometry`；无引线时 `leader.root.visible=false`。图钉仍是独立参考中心不动 | `src/composables/useDtxTools.ts` |
| 5 | **拖动**：文字框拖柄 pointerdown 记「按住点 − 文字框左上角」；拖动中写 `render.labelDragTopLeft` 走 V1 布局（跟手且实时夹紧 / 避让）；松手 `commitDraggedCloudLabelLayoutV1` 把最终矩形反算成意图偏移写 `labelLayoutV1`，并按旧含义**双写一次** `leaderEndWorldPos`（文字框中心在 billboard 深度的世界点）。**旧记录第一次拖动即升级**为 V1（默认右上锚点）；相机移动 / 视口夹紧 / 回放绝不回写 | 同上 |
| 6 | **新建**：`createCloudAnnotationRecordFromAnchorAndMarquee` 增 `labelLayoutV1` 入参，`endMarquee` 在开关开时写默认 `{uv:[1,0], offsetPx:{18,0}}` | 同上 |
| 7 | **调试出口**：`debugCloudRenderStats()`（frames / contourBuilds / setPoints / labelLayouts / paintUpdates）、`resetCloudRenderStats()`、`debugCloudLabelLayouts()`；`begin/continue/endInlineOverlayAnnotationDrag` 暴露给测试 | 同上 |
| 8 | **验收测试**（§12.1）：静止 120 帧 `contourBuilds = setPoints = labelLayouts = paintUpdates = 0`，相机一动各 +1、paint 仍 0；关 `cloudDirtyCache` 回到每帧重建；只改标签意图 → 轮廓 0 次重建；V1 文字框位置 = 参考框右上 + 18 px、引线右边 → 左边；旧记录仍按 `leaderEndWorldPos` 投影；关 `cloudLabelLayoutV1` 回旧布局；拖动提交意图偏移 + 双写 | 新增 `src/composables/useDtxTools.cloudRender.test.ts`（7 例） |

**验证**（2026-09-14 22:1x，本机）：
- `npx vitest run` 全量：**317 文件 / 2702 用例全绿**（本次新增 13 + 9 + 3 + 7 = 32 例；`cloudFit` / `cloudCreation` 既有用例不动）。
- `npm run type-check`：本次改动文件 **0 条新增**。剩余 4 条基线外全在未触碰文件（`ReviewPanel.test.ts` 3、`resolveLabelCollisions.test.ts` 1），HEAD 既有。
- `npx eslint` 改动文件：0 错误（`--fix` 调了一次 import 顺序）。
- 未跑 Playwright；真机观感（拖动手感、引线端点贴合）待用户在浏览器里过一遍。

**顺手改的工具**（与本任务相关、单独说明）：`scripts/type-check.mjs` 的错误签名把 tsc 省略长类型时的 `... 39 more ...` 成员计数归一成 `... N more ...`（读基线时同样归一，基线文件不动）。原因：给 `useDtxTools` 返回对象加 6 个方法后，26 条与之无关的既有错误（`ViewerPanel.vue` 的 `hoverText` / `ToolsApi`、`useDtxTools.*.test.ts` 的 `Ref<DTXLayer>` mock 等）因计数从 33/39 变 40 被整体重新计成「新增」+「消失」，门禁失真。没有新增或放行任何错误。

**遗留 / 后续**：
- `labelMetrics` 每帧读一次 `offsetWidth/offsetHeight`（布局干净时不回流）；happy-dom / 首帧为 0 时用 240×96 兜底尺寸，只影响布局输入不写记录。
- 引线起点取的是**参考矩形边**上的最近点，与真实波浪轮廓差 ≤ 波幅（≤ 6 px）；P2 换成范围体投影轮廓后由 `visibleStrokes` 直接给真实可见 stroke。
- bbox3d 模式下角点越界时无 frame，文字框退回旧布局；P2 齐次裁剪落地后消失。
- `useToolStore` 未改；本阶段无记录 schema 变化。

---

## 附录 A：咨询材料索引

| 文件 | 内容 |
|---|---|
| `2026-09-14-cloud-annotation-3d-region-redesign/oracle-brief.md` | 送审简报：现状代码节选、可用底层能力、9 条判断、14 个问题 |
| `…/oracle-answer-geometry-core-gpt6-pro.md` | A1 A2 B3 B4 B5 B7 E14 原文（含 TypeScript 伪代码与数学契约） |
| `…/oracle-answer-data-perf-plan-gpt6-pro.md` | B6 C8 C9 D10 D11 D12 E13 原文 |
| `…/oracle-answer-geometry-kernel-gpt6-pro.md` | 追问回收的纯函数参考内核 `cloud_annotation_geometry.ts`（约 415 行：`buildObjectBoxCell` / `clipConvexSolid4` 封口裁剪 / `projectCloudRegion` / `intersectHullWithRect` / `buildRoundedConvexPath` Minkowski 圆角 / `transportCloudPhase` 相位转移 / `cloudHeightAt` / `visibleCloudPathIntervals` 可见弧长区间采样 / `buildLassoDepthCells` / `worldPerPixelFromProjection` / `liftScreenPolylineToBillboard`）+ 21 项自检清单 `cloud_geometry_selfcheck.json`。GPT 自述通过严格类型检查与全部自检；**不是本项目补丁，未跑本仓 Vue / DTX / Vitest**。落地时按 §3.3 目录拆子模块并补本仓测试 |

## 附录 B：现状 → 目标对照

| 维度 | 现状 | 目标 |
|---|---|---|
| 范围来源 | 每帧 `getAABB(refnos)` 并集（500 ms TTL）→ 失败退 `selectionBbox` | 创建时快照 `regionV1`（对象变换盒并集）；解析只验证不改写 |
| 贴合 | 8 角点全可见才轴对齐矩形 + 14 px | 齐次裁剪 + 封口 → 屏幕凸包 → Minkowski 圆角外扩 |
| 越界 | 任一角点越界 → 退回固定布局（跳变） | `viewport-cut / offscreen / depth-empty` 各有表现，不回退 |
| 波纹 | 双侧正弦；`bbox3d` 振幅按世界边长 | 单侧余弦、恒像素、特征锚定相位、收口区 |
| 标签 / 引线 | 固定世界点 `leaderEndWorldPos`，引线自图钉 | 像素意图偏移 + 视口夹紧；引线取可见边界最近点对 |
| 数据 | 无范围体 / 视点 / 标签布局字段 | 四个可选字段，漏斗补齐，superset 不变 |
| 性能 | 每帧 `setPoints`，无脏标记，无 LOD | 分阶段脏标记、静止零重建、64 条全轮廓预算 |
| 遮挡 | 永远置顶 | 默认置顶；可选 inspection 复用 ADR-0061 缝 |
