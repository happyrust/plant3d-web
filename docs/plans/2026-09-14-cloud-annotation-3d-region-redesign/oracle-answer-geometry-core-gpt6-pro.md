## A1．表示法：推荐“世界范围体＋当前视角的屏幕云线”

**推荐选（c），默认用（a）构造范围体；（b）仅作为显式的“自定义空间范围”创建方式。不要把一条反投影后的世界空间波浪线，当成能够从任意方向框住目标的范围体。**

先区分三个概念：`bindings.member` 决定问题目标；世界范围体决定批注覆盖哪里；云线只是当前相机下的表现。锚点不参与扩大目标范围，因为定稿已经明确允许锚点位于目标集合之外。

| 路线                  | 语义、视觉与图纸一致性                                                     | 复杂度、性能与持久化                                |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| **（a）对象盒并集→屏幕凸包**   | 适合“这些构件整体有问题”。恒像素波纹清楚，接近二维云线；但凸包会跨越构件之间的空白，不是精确可见轮廓             | 每对象先处理 8 角点及盒面，再求二维凸包；无需每帧计算三维凸包。范围来源容易解释 |
| **（b）屏幕套索→世界几何**    | 单纯反投影到一个平面，侧视时可能退化成线，不能表达体积；补充深度区间后才成为范围体。直接绘制世界波浪线，会随透视改变波长和振幅 | 必须解决深度歧义、凹多边形及跨表面问题；保存世界几何后稳定，但创建复杂       |
| **（c）统一世界范围体→投影表现** | 可以同时表达“目标整体”和“局部空间问题”，表现保持一致                                    | 比（a）多一个范围类型入口；投影、裁剪、波纹共用。**总体最合适**        |

定义默认轮廓的数学契约：

$$
H=\operatorname{conv}\left(\bigcup_i\pi(R_i\cap D)\right)
$$

其中 \(R_i\) 是对象盒或自定义范围的凸单元，\(D\) 是相机有效深度区间。**先裁剪，再投影，最后对所有单元取屏幕凸包。** 云线应包住 \(H\)；出屏时展示可见部分并明确提示截断，而不是伪造一个完整的小框。

```ts
// WorldCell：有面连接关系的凸多面体，不是无拓扑的角点列表。
// 所有矩阵、几何、视口均由调用方传入。
export function computeCloudFootprintFromRegion(
  cells: readonly WorldCell[],
  viewProjection: Mat4,
  viewport: { width: number; height: number },
): Projection {
  return projectCloudRegion(cells, viewProjection, viewport);
}
```

对 Navisworks、BIM 360、Revizto 等，附件不足以核实各版本的具体行为。这里可借鉴的是两种通用设计逻辑：**视点绑定标记**保留特定画面的证据，**空间绑定标记**允许换角度检查同一对象。前者不能替代本项目要求的后者；“回到创建视角”只能作为辅助能力。

---

## A2．双模式：保留入口，统一范围来源，不保留两套范围语义

**保留 `screen2d / bbox3d`。** 这是已存在且经过定稿的用户选择；源码中还是一个持久化的样式开关，默认 `screen2d`，不是记录级空间语义开关。

建议 `screen2d` 成为主审阅表现：范围投影＋恒像素云线。`bbox3d` 用于检查空间边界，显示同一范围体的真实盒边，而不是另一个屏幕 billboard。

把 `bbox3d` 从合并 AABB 升级为对象盒范围，是**本次提出的表现修订**，不是定稿文档已经包含的实现；定稿原文明确采用合并 AABB。两者仍共享目标选择、锚点和记录，不改变关联来源。

```ts
export function selectCloudPresentation(
  mode: 'screen2d' | 'bbox3d',
) {
  return {
    drawScreenContour: mode === 'screen2d',
    drawWorldRangeEdges: mode === 'bbox3d',
    depthTest: false,
  };
}
```

不建议继续把“随相机改变扰动方向的十二条波浪边”作为主要三维表达。空间边界的可信度，比每条边都具有云朵装饰更重要。

---

## B3．紧贴合：对象局部盒变换、屏幕凸包、外扩与稳定参数化

### 1．角点必须来自局部盒，不要从世界 AABB 反推 OBB

按对象生成：

$$
c_{\text{world}}=M_{\text{global}}M_{\text{instance}}c_{\text{localBBox}}
$$

**不能先得到世界 AABB，再把它的角点旋转成所谓 OBB。** 附件说明具备局部 bbox、实例矩阵和全局模型变换，但未提供 DTX 实现，不能据此确认某个返回矩阵是否已经包含全局变换；适配层必须保证只乘一次。

```ts
export function computeObjectBoxCorners(
  min: V3,
  max: V3,
  localToWorld: Mat4, // 已合成 global × instance，且只合成一次
): V3[] {
  const bits = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  return bits.map(b => transformPoint(
    localToWorld,
    b.map((v, axis) => v ? max[axis] : min[axis]) as V3,
  ));
}
```

严格说，变换后是否为“真 OBB”，取决于变换后的三个轴是否正交。刚体变换及保持正交的缩放成立；含剪切时得到的是**平行六面体**。此时保留八角点和六面即可，不要用正交化重建一个可能缩小的盒。

紧度收益来自去掉两次膨胀中的第一次：对象盒通常明显小于世界 AABB；再去掉屏幕轴对齐矩形，可以减少第二次膨胀。但对象局部盒仍不一定是最小体积包围盒。

### 2．凸包与 padding

Andrew 算法可直接用于裁剪后的有限屏幕坐标。下面采用 CSS 坐标；正有向面积在屏幕上看起来是顺时针，外法线为 `(dy, -dx)`。

```ts
export function convexHull2d(points: readonly P2[]): P2[] {
  if (points.some(p => !Number.isFinite(p.x + p.y)))
    throw new Error('invalid projection'); // 不能丢失支撑点后宣称包住

  const p = [...points]
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))
    .filter((v, i, a) =>
      i === 0 || v.x !== a[i - 1].x || v.y !== a[i - 1].y);

  const half = (src: P2[]) => {
    const out: P2[] = [];
    for (const q of src) {
      while (out.length >= 2 &&
        cross2(out.at(-2)!, out.at(-1)!, q) <= 0) out.pop();
      out.push(q);
    }
    return out;
  };

  return p.length < 3 ? p :
    [...half(p).slice(0, -1), ...half([...p].reverse()).slice(0, -1)];
}
```

推荐 padding 使用 **凸包与半径为 padding 的圆盘的 Minkowski 和**：直边作外平行线，顶点用以原顶点为圆心的圆弧连接相邻外法线。不要用“平均法线×padding”；锐角处会产生错误距离。

```ts
const path = buildRoundedConvexPath(projectedHull, 14);
// path.at(s) 提供位置及单位外法线；s 是累计 CSS 像素弧长。
// path.length = hullPerimeter + 2 * Math.PI * padding。
```

波纹只向外抬高。使用正负正弦时，波谷可能侵入要求的净空；单侧波纹更容易保证包住性质。

### 3．何时取网格顶点

优先用对象盒。只有盒对弯管、组合几何等仍明显过松，而且该云线值得精化时，才升级代理：

**建议初始精化预算为 256 点／对象、4096 点／云线，均为待调参数，不是实测性能结论。** 小网格可全量求局部凸包；大网格可首次扫描全部顶点，计算固定 26 个方向的支撑值，再取这些支撑半空间的交，得到保守外包多面体。

不能抽取前 256 个顶点就声称其凸包覆盖整个对象——那通常是内包。精化超预算就保留对象盒，不得丢弃目标。缓存按 `geoHash + geometryRevision` 保存局部代理及面连接；世界角点再由实例矩阵版本派生。**跨近平面时需要面／边拓扑，只有采样点不够。**

顶点精化也不能解决凸包填满 U 形内部或两个目标之间空白的问题，那是凸包语义本身。

### 4．相位与矩形替代

首次用确定的来源 ID，例如 `objectId + cornerIndex`，选择凸包特征；以后只要该特征仍在轮廓上就保留。**不要每帧重新选“最左上顶点”，也不要按顶点数组索引计算相位。**

特征消失时，选择相邻存活特征，并把旧轮廓在该处的相位转移过去：

```ts
// oldS / newS：同一存活特征在前后轮廓上的累计弧长。
export function transferPhase(
  old: PhaseFrame,
  oldLength: number,
  oldS: number,
  newS: number,
  newId: string,
): PhaseFrame {
  const phase = old.phaseAtAnchor +
    2 * Math.PI * mod(oldS - old.anchorS, oldLength) / old.wavelengthPx;

  return {
    ...old,
    anchorId: newId,
    anchorS: newS,
    phaseAtAnchor: mod(phase, 2 * Math.PI),
  };
}
```

没有共同特征时，在新轮廓上找最接近旧原点的边界点；近似并列候选使用前一帧弧长位置消歧。换手可用约 120 ms 的位移场过渡，但**底座始终采用当前轮廓**，不插值旧、新几何位置，否则可能暂时漏包目标。凸包插入共线点或采样点数变化，不应改变解析相位。

最小面积矩形仅作“图纸外观”选项：可取 `矩形面积/凸包面积 ≤ 1.12、顶点数 ≤ 8` 时进入，比例 `>1.25` 时退出。**不要在连续拖动相机时切换形状类别**；顶点数本身不是紧度指标。矩形角度近似并列时，选择最接近上一角度的候选。

---

## B4．近平面、相机进入范围体和出屏：裁剪范围体，不能裁掉“失败角点”

现有代码确实在任一角点深度不可见时放弃贴合。现有五机位测试又预先断言所有角点都位于有效深度范围，因此并未覆盖这个边界。 

### 1．齐次裁剪必须发生在透视除法之前

当前 WebGL 约定下，保留半空间为：

$$
w\ge\varepsilon,\qquad z+w\ge0,\qquad w-z\ge0
$$

侧面是 \(x+w\ge0,\;w-x\ge0,\;y+w\ge0,\;w-y\ge0\)。不要把负 `w` 取绝对值，也不要先除 `w` 再 clamp `ndcZ`。

```ts
type Plane4 = { id: string; n: V4; k: number };
// 距离：dot(n, clipPosition) + k；保留 >= 0。

export function clipFace4(
  face: readonly ClipVertex[],
  plane: Plane4,
): ClipVertex[] {
  const out: ClipVertex[] = [];

  for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    const da = eval4(plane, a), db = eval4(plane, b);

    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      // 同一个 t 插值 clip 四维坐标、world 坐标及来源信息。
      out.push(mixVertex(a, b, t, plane.id));
    }
    if (db >= 0) out.push(b);
  }
  return out;
}
```

**只裁原来的六个盒面还不够：每裁一次必须补截面封口，封口继续参与下一平面的裁剪。** 否则范围体完全包住视锥时，六个原始表面都可能在视锥之外，错误得到空结果。

```ts
export function clipClosedSolid4(
  faces: ClipSolid,
  planes: readonly Plane4[],
): ClipSolid {
  for (const plane of planes) {
    const intersections = collectCrossingVertices(faces, plane);
    const next = faces
      .map(face => clipFace4(face, plane))
      .filter(face => face.length >= 3);

    // 在截面的世界平面内建二维基、去重、求凸包排序。
    // 此处还不能用 x/w、y/w 排序。
    const cap = orderCapInWorldPlane(intersections);
    if (cap.length >= 3) next.push(cap);

    faces = next;
    if (!faces.length) break;
  }
  return faces;
}
```

主路径建议先对各单元裁**深度**，透视除法后求集合凸包，再与视口相交。不能先删除所有出屏对象再求集合凸包：两个分别位于左右屏外的目标，其整体包络仍可能穿过视口。

`ε` 是数值保护，不是新的可见距离；透视相机可从 `near` 的小比例推导，世界坐标去重容差另设。大型工程坐标应使用双精度并尽量采用相机相对坐标。

### 2．部分出屏、超大投影与相机进入

计算 `visibleHull = rawHull ∩ viewportRect`，但保留边界来源：

**真实范围边界画云线；视口截断产生的闭合边画边缘提示，不能伪装成真实云线边界。**

```ts
const visibleHull = intersectHullWithRect(rawHull, viewportRect);
const path = buildRoundedConvexPath(rawHull, paddingPx);

const fragments = buildVisibleCloudPolylines(
  path, phase, viewportRect, amplitudePx, 2, haloWidthPx,
);
// 内部先在 viewport 扩大 amplitude + haloWidth/2 后，
// 求可能可见的原路径弧长区间；仅采样这些区间。
// 保留全局 s，不在视口交点重新起相位。
```

超大投影不能先沿数百万像素周长生成波纹再裁。线段求矩形交区间；圆弧求与矩形四边的交角，筛选弧长区间即可。

当真实轮廓全部在屏外、范围却覆盖视口时，显示带方向缺口／箭头的视口边缘提示和“范围延伸至视口外”。只有世界点包含测试确认相机位于某个范围单元内，才显示“视点在范围内”；**全屏投影不等于相机在体内**。

全部落在有效深度之外时，显示不可见状态，不回退到旧的锚点偏移云线。

### 3．极小投影

建议以**裁视口前**的投影最大边长判断：低于 12 px 进入图标，高于 18 px 退出，防止抖动。不能只按面积判断，否则 `1×300 px` 的细长目标会被错误图标化。

激活的小目标可以用 `32×24 px` 最小提示框；它是非比例强调，不代表真实占地。点、线退化投影同样走此分支。旧 `computeFittedCloudRectFromCorners` 的最小尺寸行为可保留，新路径不必沿用它对所有远景目标强制大框的表现。

---

## B5．套索转世界范围：必须先解决深度，不要逐点拼接射线命中

**默认拖框继续只影响呈现，不能静默改成范围作者工具。** 定稿明确“框选只决定 `screenOffset/cloudSize`，不再决定关联”。新增局部范围必须是显式选择，且不能添加或删除 `member`。

推荐通过目标对象盒在**创建相机视空间**中的深度区间 `[d0,d1]`，将屏幕多边形扫掠成体。用户显式调整深度优先；目标 raycast 只用于辅助建议，不逐点固定到各自命中深度。

原因是相邻屏幕点可能分别命中前景管道、远处设备和空白。把这些点加上锚点平面兜底后连起来，容易产生非共面、折叠甚至穿过无关构件的“范围”。

这里的深度是相机前向轴上的距离，不是沿斜射线走过的长度：

```ts
export function pointOnViewDepth(
  ray: { origin: V3; direction: V3 },
  cameraPosition: V3,
  forward: V3, // 单位向量
  depth: number,
): V3 {
  const denominator = dot3(ray.direction, forward);
  if (denominator <= 1e-10)
    throw new Error('ray does not enter the depth slab');

  const originDepth = dot3(sub3(ray.origin, cameraPosition), forward);
  const t = (depth - originDepth) / denominator;
  if (t < 0) throw new Error('depth is behind ray origin');

  return add3(ray.origin, scale3(ray.direction, t));
}
```

透视相机射线共用眼点，生成的是**截锥形扫掠体**，不是平行柱体；正交相机射线方向相同、起点不同，才生成柱体。

```ts
export function buildLassoRegion(
  rays: readonly Ray[],
  triangles: readonly [number, number, number][],
  cameraPosition: V3,
  forward: V3,
  d0: number,
  d1: number,
): WorldCell[] {
  if (!(d0 > 0 && d1 > d0))
    throw new Error('invalid finite depth interval');

  // 每个三角形扫掠为：两个三角端面＋三个侧面。
  return buildLassoDepthCells(
    rays, triangles, cameraPosition, forward, d0, d1,
  );
}
```

套索先校验自交，再用耳切法三角化；凹多边形不能直接扇形连接，也不能不告知用户就取凸包。由多个凸单元保存范围，换相机后复用 B4→B3 的投影流程，不绘制原始三维波浪多边形。

没有可信深度时，可以明确创建“锚点平面上的平面标记”，但不能宣称已经恢复出体积。局部范围也不能继续承诺包住所有 member 的完整几何——**“目标整体”与“目标内局部问题范围”必须明确区分。**

---

## B7．恒像素波纹：固定弧长参数，局部收口；正交相机不能套透视公式

建议初值为 `λ=52 px、A=4 px、padding=14 px`。这些是产品参数，不是工程图纸强制规范。

闭环存在一个必须正视的约束：**周长连续变化时，严格固定波长、整圈整数波、所有波峰固定世界位置，三者不能同时满足。** 本方案选择恒像素观感、确定特征处不重置相位，用一小段收口区吸收闭合余量。

```ts
export function cloudHeightAt(
  s: number,
  length: number,
  frame: PhaseFrame,
  amplitudePx: number,
): number {
  const u = mod(s - frame.anchorS, length);
  const distanceToSeam = Math.min(u, length - u);
  const seamWidth = Math.min(frame.wavelengthPx, length / 4);

  const gate = smoothstep(distanceToSeam / seamWidth);
  const phase = 2 * Math.PI * u / frame.wavelengthPx
    + frame.phaseAtAnchor;

  return amplitudePx * gate * (1 - Math.cos(phase)) / 2;
}
```

这给出始终非负的外凸波纹，收口两侧高度及一阶变化归零。采样点按弧长生成，并包含所有直线／圆弧连接点；**采样点数只影响离散精度，不定义相位**。

需要圆弧造型时，直边上可用弦长 \(c\)、弓高 \(a\) 推出半径：

$$
R=\frac{c^2}{8a}+\frac a2
$$

但把这个抬高函数套到弯曲底座上，并不再是严格圆弧。首版推荐上述单侧余弦，避免同时引入圆弧拼接问题。

换手过渡应混合当前底座上的两个非负高度场，而不是混合新旧位置：

```ts
height = (1 - t) * mappedPreviousHeight(s) + t * currentHeight(s);
point = currentPath.at(s).position
      + currentPath.at(s).outwardNormal * height;
```

这样接受局部波形调整，但不出现数组重排、取整波数造成的整圈跳相；不承诺每个波峰都粘住同一个世界表面点。

### 像素到世界坐标

标准投影矩阵下：

$$
\begin{aligned}
\text{透视：}&\quad
wpp_x=\frac{2d}{|P_{00}|W},\quad
wpp_y=\frac{2d}{|P_{11}|H}\\
\text{正交：}&\quad
wpp_x=\frac{2}{|P_{00}|W},\quad
wpp_y=\frac{2}{|P_{11}|H}
\end{aligned}
$$

透视中的 \(d\) 是视空间深度，**不是中心到相机的欧氏距离**。正交结果与深度无关；直接读投影矩阵还能包含 `zoom`，不应再乘一次缩放。

更推荐先生成完整屏幕折线，再统一反投影到安全的固定 `ndcZ` 平面。这样不用假定横纵 `worldPerPixel` 相同，也避免 `camera.up` 构造基在特殊姿态下退化：

```ts
export function buildCloudBillboardPolylineFromScreen(
  points: readonly P2[],
  inverseViewProjection: Mat4,
  viewport: { width: number; height: number },
  ndcZ = 0,
): number[] {
  return points.flatMap(p => {
    const q = mul4(inverseViewProjection, [
      2 * p.x / viewport.width - 1,
      1 - 2 * p.y / viewport.height,
      ndcZ,
      1,
    ]);
    if (Math.abs(q[3]) < 1e-15)
      throw new Error('invalid unprojection');

    return [q[0] / q[3], q[1] / q[3], q[2] / q[3]];
  });
}
```

`ndcZ=0` 只决定置顶装饰线放在哪个安全 billboard 平面，**不定义世界范围**。整个几何内核统一使用 CSS 像素，设备像素比留给渲染适配层处理。

---

## E14．对第 4 节判断的反驳与限定

| 判断                           | 我的不同意见                                                       |
| ---------------------------- | ------------------------------------------------------------ |
| **① 框住空白就是没有框住构件**           | 不完全同意。合并范围的保守包络允许包含空白；问题是过松，不是必然语义错误。对象盒和二维凸包能改善，但不能承诺得到精确轮廓 |
| **④ 引线从图钉出发就是脱节**            | 图钉是刻意与目标解耦的参考点。布局可能需要改善，但不能仅凭视觉脱节就认定这种参考关系错误                 |
| **⑤ 拖框不再表达范围是缺陷**            | 这是定稿刻意选择的语义，不是绑定实现偏离要求。新增局部范围应明确扩展能力，不能重新把拖框变成隐式关联           |
| **⑥ 单位 axes 的 OBB 是“伪 OBB”** | AABB 是 OBB 的合法特例；准确说法是“没有利用对象方向取得更紧的盒”。另外，任意仿射变换后的局部盒也未必正交   |
| **⑧ 系统缺少创建视点**               | 只能确认本次记录节选没有相机字段；不能从这些附件证明整个校审／截图链路没有保存视点                    |
| **⑨ 一律置顶是缺陷**                | 不同意把既定可读性策略直接定性为缺陷。是否调整遮挡表现是另一项产品决定，不能据此推翻现有约束               |

上述争议对应简报原判断；定稿对拖框、锚点和双模式已经给出了明确口径。  

第②、③、⑦的风险总体成立，但代码节选只能支持局部行为，不能代替全仓性能结论。此外，第 3 节“零成本得到真 OBB”也应改为“可低成本构建变换盒”，原因见 B3。

**另有一个节选可直接证明的遗漏：`bbox3d` 使用 `anchorScreen.visible` 控制整个范围边线可见性。** 锚点允许不属于目标，因此目标仍在有效视域内、锚点越过深度裁面时，会错误隐藏云线。范围表现必须由范围投影结果决定，不能由锚点代判。

将这一原则收口为纯函数，避免任何裁剪状态重新落入“固定布局”：

```ts
export function chooseCloudFitPresentation(
  state: 'complete' | 'viewport-cut' | 'offscreen'
       | 'depth-empty' | 'missing-region',
) {
  switch (state) {
    case 'complete':       return 'contour';
    case 'viewport-cut':   return 'contour-and-cut-hints';
    case 'offscreen':      return 'edge-indicator';
    case 'depth-empty':    return 'depth-status-indicator';
    case 'missing-region': return 'legacy-layout';
  }
}
```

**核心边界是：有范围但被裁剪，与没有可用范围，是两种不同情况。前者绝不能通过旧布局兜底掩盖。**

附：[TypeScript 纯函数参考内核](sandbox:/mnt/data/cloud_annotation_geometry.ts) · [21 项隔离数值自检结果](sandbox:/mnt/data/cloud_geometry_selfcheck.json)。内核已通过 TypeScript 严格类型检查及这些自检；包含完整封口裁剪、圆角外扩、相位转移、可见弧长区间采样和正交换算。它不是现有项目补丁，未执行附件所属项目的 Vue／DTX／Vitest 测试。