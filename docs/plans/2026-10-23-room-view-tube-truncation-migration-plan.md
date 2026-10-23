# 房间视图直段截断（Room View Tube Truncation）从 `plant-ui` 到 `plant3d-web` 迁移计划

> 日期：2026-10-23
> 对照源仓：`../plant-ui`（ADR-0028、ADR-0029、计划 `docs/plans/2026-09-29-room-view-tube-truncation.md`、`crates/plant-room`、`crates/plant-ui-view3d/src/room_clip.rs`、`crates/plant-ui-app/src/main.rs`）
> 目标仓：`plant3d-web` + `gen-model`

---

## 0. 背景与问题定义

在 `plant3d-web` 当前的房间隔离能力中（模型树「房间」页签 `RoomTreePanel.vue` 的「隔离透明」、关联房间浮窗 `RoomInfoModal.vue` 的「隔离成员」、空间查询抽屉 `SpatialResultTree.vue`）：
1. **直管（`TUBI`）穿墙伸出房间外數米**：直管在 E3D 中没有独立 `refno`，挂在所属 `BRAN` / `HANG` 名下（`deliveryUnitScene.ts` 的方案 A）。隔离房间时为了不让房内管件悬空，把整条 `BRAN` 的直管全长带入，导致穿墙直管整根伸到房间外，画面像刺猬。
2. **同分支在房间外的管件被连带显示**：`withCompanions(refnos, branUnits)` 会把该 `BRAN` 下所有管件（含房间外的弯头、阀门、法兰）一并纳入隔离集。
3. **房间边界面板（`PANE`）缺乏独立的房间体半透明基准层**：用户看不清管道是在哪面墙被截断的。

`../plant-ui` 已通过 **ADR-0028（改写实例矩阵截断直段 + 洋红断口薄饼）** 与 **ADR-0029（`plant-room` 三射线奇偶投票 + 线段区间裁剪）** 完整解决了这一问题。本计划详细拆解 `plant-ui` 的实现机制，并制定面向 `plant3d-web`（Three.js + `DTXLayer` 大纹理合批架构）与 `gen-model` 的分步迁移方案。

---

## 1. `../plant-ui` 实现方式深度剖析

### 1.1 三个核心架构取舍（ADR-0028 & ADR-0029）

| 关键问题 | 备选方案 | `plant-ui` 最终方案与理由 |
|---|---|---|
| **如何截断穿墙直段？** | A. Shader `clip_distances` 平面裁剪<br>B. CPU 三角网布尔切割（CSG）<br>C. **改写直段实例变换矩阵（Instance Transform Remapping）** | **选 C（ADR-0028）**：<br>1. 房间面板可能是 L 形、凹多边形、带立柱缺口或多块闭合面板的并集（非凸体），6~8 个 Shader 裁剪平面无法表达凹房间，且会把穿墙法兰/阀门劈成两半；<br>2. 直段原型网格是沿局部 $+Z$ 轴拉伸的棱柱（圆柱 `CylinderV3` 或矩形风管 `BoxV1`），轴线段 $A \to B$ 被房间体截出的子区间 $[t_0, t_1] \subset [0, 1]$ 只需**改写实例矩阵的局部 Z 平移与 Z 缩放**即可精确表达，零新顶点、零新网格，关闭或退房时写回原矩阵即可复原。 |
| **如何处理管件（弯头/三通/阀门/法兰）？** | A. 对管件网格做平面/布尔切割<br>B. **精确成员隔离（Exact Member Isolation），管件不截断** | **选 B（计划 Q3）**：<br>E3D 的房间归属挂在构件级（`member_refnos`）。开启截断时改用**精确成员隔离**：房间外的管件不在 `member_refnos` 中，自然隐藏；嵌在墙里的穿墙法兰/套管已有房间归属，整件保留不断裂；只有挂在 `BRAN` / `HANG` 名下的隐式直管（`TUBI`）按房间体几何截断。 |
| **如何判定轴线段哪一截在房间内？** | A. 依赖渲染引擎 BVH（` parry3d`）射线投射<br>B. **独立纯几何算法（`crates/plant-room`）：顶点焊接 + f64 Möller–Trumbore + 三射线多数票** | **选 B（ADR-0029）**：<br>房间面板多为轴对齐长方体薄板，軸对齐射线在 BVH 节点相交中会触发 `0.0 * INF = NaN` 漏判；单条射线擦过三角面公共棱会偶发翻转奇偶性。因此用 f64 精度手写 Möller–Trumbore，配合 $0.01\text{ mm}$ 顶点焊接与 3 条偏斜射线 2/3 多数票。 |

---

### 1.2 纯几何裁剪算法（`crates/plant-room/src/predicate.rs` & `solid.rs`）

1. **面板网格预处理（`panel_tri_mesh`）**：
   - 将面板局部顶点经实例矩阵 `matrix` 变换到 PDMS 世界毫米系；
   - **顶点焊接（`PANEL_WELD_STEP_MM = 0.01`）**：按 $\text{round}(v / 0.01\text{ mm})$ 量化到整数网格去重，缝合导出网格中相邻三角形的微小浮点裂缝；
   - **剔除退化三角形（`PANEL_DEGENERATE_SIN = 1e-7`）**：过滤共点索引或 $\frac{\|(B-A)\times(C-A)\|}{\|B-A\|\cdot\|C-A\|} \le 10^{-7}$ 的零面积狭长三角形；
   - 预计算每个三角形的 AABB（`tri_aabbs`）及整块面板的世界 AABB。

2. **点在面板内判定（`point_inside_panel`）**：
   - 先做面板 AABB 快速排除；
   - 从待测点 $P$ 向 **3 个互不共面的偏斜方向**发射射线：
     - $D_1 = \text{normalize}([0.7730, 0.3319, 0.5411])$
     - $D_2 = \text{normalize}([-0.2000, 0.9000, 0.3000])$
     - $D_3 = \text{normalize}([0.1000, -0.4000, 0.8500])$
   - 每条射线先做 Ray-AABB 粗筛，再对候选三角形执行 **f64 Möller–Trumbore** 求交（重心容差 $\epsilon = 10^{-9}$，距离 $t > 10^{-5}\text{ mm}$），交点数为奇数记为「内」；
   - **3 票中至少 2 票判内**即认定点在该面板内。

3. **轴线段区间裁剪（`RoomSolid::inside_intervals(a, b) -> Vec<[f64; 2]>`）**：
   - 输入直段世界轴线两端点 $A, B$（毫米），若 $\|B - A\| \le 1.0\text{ mm}$（`MIN_PIECE_MM`）直接返回空；
   - **步骤 1（候选面板过滤）**：仅保留与线段 $\text{AABB}(A, B) \pm 10^{-6}\text{ mm}$ 相交的房间面板；
   - **步骤 2（收集穿墙参数 $t$）**：对每块候选面板，求线段 $A \to B$ 与所有三角形的交点参数 $t \in (10^{-7}, 1 - 10^{-7})$，拼入 `[0.0, ..., 1.0]` 后排序并按 $10^{-6}$ 去重；
   - **步骤 3（子区间中点判内）**：对相邻参数 $[t_0, t_1]$，若 $(t_1 - t_0)\cdot L \ge 10^{-4}\text{ mm}$，取中点 $M = A + \frac{t_0 + t_1}{2}(B - A)$ 调用 `point_inside_panel`，为真则收入该面板的内部区间；
   - **步骤 4（跨面板区间归并 `merge_intervals`）**：
     - 距两端 $0.0$ 或 $1.0$ 小于 $\text{end\_snap} = 1.0\text{ mm} / L$ 的截点直接吸附到 $0.0$ 或 $1.0$（防止贴墙直管因 $0.01\text{ mm}$ 浮点误差被误判为「切了一刀」并贴上洋红断口）；
     - 将所有面板的区间按起点排序，间隔 $\le 1.0\text{ mm} / L$ 的相邻或重叠区间合并为一段（同一房间由多块面板拼成时，穿过两块面板共面分界墙不会留下假断口）；
     - 丢弃长度 $< 1.0\text{ mm}$ 的碎段。

---

### 1.3 原型网格棱柱守卫与矩阵重映射（`crates/plant-ui-view3d/src/room_clip.rs`）

1. **棱柱守卫（`Prism::of(mesh)`）**：
   - 遍历原型网格所有顶点 $(x, y, z)$，求包围盒 $[x_{\min}, x_{\max}] \times [y_{\min}, y_{\max}] \times [z_0, z_1]$；
   - 校验所有顶点的 $z$ 坐标都落在端盖平面 $z_0$ 或 $z_1$ 的 $\epsilon_z = 10^{-4}(z_1 - z_0)$ 邻域内（排除弯头、球体、锥台等非柱体网格）；
   - 校验 $z \approx z_0$ 与 $z \approx z_1$ 两端盖的 XY 包围盒对齐（容差 $\epsilon_{xy} = 10^{-3}\max(\Delta X, \Delta Y)$）；
   - 记录截面中心 $c_x = \frac{x_{\min}+x_{\max}}{2}, c_y = \frac{y_{\min}+y_{\max}}{2}$ 与轴向跨度 $[z_0, z_1]$。
   - **关键经验（R7）**：绝不硬编码 $z \in [0, 1]$！虽然 `CylinderV3` 是 $z \in [0, 1]$，但 `BoxV1`（矩形风管直段）是 $z \in [-0.5, 0.5]$，直接读网格顶点的 $[z_0, z_1]$ 才能通吃圆管与风管。

2. **变换矩阵重映射公式**：
   - 设实例原变换矩阵为 $M$，局部轴线端点为 $P_0 = (c_x, c_y, z_0)$ 与 $P_1 = (c_x, c_y, z_1)$，世界轴线端点为 $A = M \cdot P_0$，$B = M \cdot P_1$，总长 $L = \|B - A\|$，局部跨度 $\Delta z = z_1 - z_0$；
   - **子段 $[t_0, t_1]$ 的矩阵 `piece_transform(M, prism, [t0, t1])`**：
     - 令 $z_a = z_0 + t_0 \Delta z$，$k = t_1 - t_0$；
     - 后乘局部 Z 仿射变换（将 $z_0 \mapsto z_a, z_1 \mapsto z_b$，XY 不变）：
       $$M_{\text{piece}} = M \cdot \begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \\ 0 & 0 & k & z_a - z_0 k \\ 0 & 0 & 0 & 1 \end{bmatrix}$$
   - **断口薄饼在截点 $t \in (0, 1)$ 的矩阵 `cap_transform(M, prism, length_mm, t)`**：
     - 断口厚度固定为 $2.0\text{ mm}$（`CAP_THICKNESS_MM = 2.0`），对应参数厚度 $k_{\text{cap}} = \min\left(\frac{2.0}{L}, 0.25\right)$；
     - 截面 XY 围绕 $(c_x, c_y)$ 放大 $s = 1.02$ 倍（`CAP_SCALE = 1.02`），使洋红封口圈比管壁略宽一丝，消除共面 Z-fighting；
     - 令 $z_{\text{mid}} = z_0 + t \Delta z$，$t_z = z_{\text{mid}} - \frac{z_0 + z_1}{2} k_{\text{cap}}$：
       $$M_{\text{cap}} = M \cdot \begin{bmatrix} s & 0 & 0 & c_x(1-s) \\ 0 & s & 0 & c_y(1-s) \\ 0 & 0 & k_{\text{cap}} & t_z \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

3. **四分支执行与复原契约**：
   - `Plan::Whole`（`[[0, 1]]`）：不动原对象，`whole += 1`；
   - `Plan::Hidden`（`[]`）：将原直段对象隐藏（记录原矩阵与可见态），`hidden += 1`；
   - `Plan::Cut(pieces)`：
     - `pieces[0]` 原位改写原直段对象的矩阵；
     - `pieces[1..]` 生成附加兄弟段（`RoomClipPiece`）；
     - 对每个内部截点（$t_0 > 0$ 时的 $t_0$，$t_1 < 1$ 时的 $t_1$）生成洋红色 `#D946EF` 断口（`RoomClipCap`）；
     - `cut += 1`；
   - **复原（Restore）**：把所有记过账的原直段写回原矩阵与可见态，清空附加兄弟段与洋红断口。

---

## 2. `plant3d-web` + `gen-model` 现状盘点与架构映射

### 2.1 现有基础（可直接复用）

1. **后端 `gen-model` 常驻房间模型**：
   - `src/fast_model/spatial_rooms.rs` 中 `ResidentRoomModel` 已经持有每间在册房间的 `RoomPanels { room: RefnoEnum, room_num: String, panels: Vec<RefnoEnum> }`。
2. **前端 `DTXLayer` 与 `useDbnoInstancesDtxLoader` 直管索引**：
   - `useDbnoInstancesDtxLoader.ts` 已维护了：
     - `cache.tubiObjectIds: Set<string>`（所有 `TUBI` 直段对象的 `objectId`）；
     - `cache.refnoToObjectIds: Map<string, string[]>`（`BRAN` / `HANG` refno $\to$ 其名下所有直段 `objectId`）；
     - `cache.objectIdToRefno: Map<string, string>`；
     - `cache.tubeObjectIdByKey: Map<string, string>` 与 `dtxHiddenTubeKeys`（逐段眼睛覆盖层）。
   - `DTXLayer.ts` 已在 CPU 内存常驻 `_geometries: Map<string, GeometryHandle>`、`_positionsBuffer: Float32Array`、`_indicesBuffer: Uint32Array`、`_matricesBuffer: Float32Array`。
3. **前端房间树与房间浮窗**：
   - `useRoomTree.ts`、`useRoomInfo.ts`、`SpatialResultTree.vue` 均已接入 `GET /api/v1/spatial/rooms/{refno}/tree?tubes=1`，能够拿到房间下的全量构件叶子（`memberRefnos`）及所有 `BRAN` 单元（`branUnitRefnos`）。

---

### 2.2 关键差异与必须解决的 4 个技术点

#### 技术点 1：`gen-model` 需在房间清单中暴露在册面板 `panel_refnos`
- **现状**：`GET /api/v1/spatial/rooms` 的 `RoomListItem` 只返回 `{ refno, room_num, name, dbnum, panel_count }`，未返回面板 `refno` 数组；前端不知道一间房由哪几块 `PANE` 围成。
- **方案**：在 `gen-model` 的 `RoomListItem`（`src/fast_model/spatial_rooms.rs` L106）新增字段：
  ```rust
  pub panel_refnos: Vec<String>,
  ```
  由 `room.panels.iter().map(|p| p.refno().to_string()).collect()` 直接填充。
- **优势**：
  - 每间房通常仅 1~6 块面板，响应体积增加不足 2 KB；
  - **完全不触碰 `nearby/tree` 与 `rooms/{refno}/tree` 的 40 条 HTTP 金样快照**；
  - 前端 `SpatialSource.rooms()` 在房间树和关联房间浮窗初始化时已拉取并缓存，零额外网络往返即可拿到 `panel_refnos`。

#### 技术点 2：`DTXLayer.setObjectMatrix` 的 GPU 纹理同步缺陷修复
- **现状（重要隐患）**：`DTXLayer.ts` L1947 的 `setObjectMatrix(objectId, matrix)` 目前只执行了 `matrix.toArray(this._matricesBuffer, obj.objectIndex * 16)` 并标记 `this._matricesTexture.needsUpdate = true`；但 `_createMatricesTexture`（L1072）创建的 `this._matricesTexture.image.data` 是一个**独立分配的 `Float32Array`**，且每个对象按 `objX = i % width, objY = Math.floor(i / width) * 4` 占 4 行像素！只改 `_matricesBuffer` 不会更新 `_matricesTexture.image.data`，也不会更新 `obj.boundingBox`（影响 CPU 射线拾取与聚焦盒）。
- **方案**：修复 `DTXLayer.setObjectMatrix(objectId, matrix)` 及新增批量版 `setObjectMatrices(entries)`：
  1. 写入 `this._matricesBuffer`；
  2. 若 `this._matricesTexture` 已创建，按 `objX = i % OBJECTS_TEXTURE_WIDTH`、`objY = Math.floor(i / OBJECTS_TEXTURE_WIDTH) * 4` 将 16 个 float 同步写入 `this._matricesTexture.image.data` 的 4 行对应偏移，并置 `this._matricesTexture.needsUpdate = true`；
  3. 用 `this._computeDynamicObjectBoundingBox(geoHandle, matrix)` 更新 `obj.boundingBox`；
  4. 递增 `this._visibilityRevision++`。
- **收益**：改写或复原任意数量直段的矩阵都是 **O(1) 内存拷贝 + 一次纹理上传，完全不需要调用 `dtxLayer.recompile()`**！

#### 技术点 3：混合渲染架构（`DTXLayer` 原位截断 + Three.js `RoomClipOverlay` 图层）
- **为什么不在 `DTXLayer` 里 `addObject` 新增洋红断口和补段？**
  - 在 `DTXLayer` 中 `addObject` 必须调 `dtxLayer.recompile()`，会整表重建全场景数万个对象的顶点/索引/矩阵 DataTexture 并触发显存重分配。
- **混合方案（零 `recompile`）**：
  - **首段 `pieces[0]` 与隐藏段 `Hidden`**：直接对 `DTXLayer` 中已有的直段对象调 `dtxLayer.setObjectMatrix(objectId, pieceMatrix)` 或 `dtxLayer.setObjectVisible(objectId, false)`。原对象保留在 `DTXLayer` 中，因此 GPU 颜色拾取、选中高亮描边、以及房间树「逐段眼睛（`setTubeSegmentsVisible`）」100% 原生工作！
  - **洋红断口薄饼（`#D946EF`）、多段补片（`pieces[1..]`）与半透明房间体（`RoomVolumeLayer`）**：在 `DtxViewer` 的 Three.js `scene` 下挂载专用的 `RoomClipOverlayGroup`（`THREE.Group`）：
    - **半透明房间体子组（`roomVolumeGroup`）**：用面板的 `BufferGeometry` + 双面半透明材质（`color: #38bdf8`, `opacity: 0.18`, `depthWrite: false`, `polygonOffset: true`）+ 轮廓边线绘制房间边界，设 `raycast = () => {}`（不可拾取，不挡鼠标点选房内构件）；
    - **洋红断口子组（`capGroup`）**：复用直段 `geoHash` 从 `DTXLayer` 提取的 `BufferGeometry`，材质固定为 `MeshBasicMaterial({ color: 0xD946EF, side: DoubleSide })`，施加 `M_cap` 矩阵，并在 `mesh.userData = { refno: branRefno, isRoomClipCap: true }` 上标记所属 `BRAN`（选中 `BRAN` 时断口保持洋红色不改色，点击断口可拾取 `BRAN`）；
    - **多段补片子组（`pieceGroup`）**：仅当凹房间/L 形房间导致一根直管被截成 $\ge 2$ 段时，为 `pieces[1..]` 创建 `THREE.Mesh`（复用原直段颜色与 `geoHash` 几何体）。

#### 技术点 4：开启/关闭截断时的双模式隔离契约
- **截断开启（默认 `truncate = true`）**：
  - **面板加载但从常规模型层隐藏**：调 `showModels(panelRefnos)` 确保在册面板的网格与矩阵已加载（供构建 `RoomSolid` 与 `roomVolumeGroup`），但在 `DtxCompatScene` 中将 `panelRefnos` 设为隐藏（避免实体灰墙与半透明房间体叠画重影）；若房间体构建失败（如面板缺模型），兜底保留实体面板可见；
  - **精确成员 + 直管载体隔离**：
    $$\text{keepRefnos} = (\text{memberRefnos} \setminus \text{panelRefnos}) \cup \text{tubeCarriers}$$
    **关键原理**：在 `plant3d-web` 的 `useDbnoInstancesDtxLoader` 中，`BRAN` 单元自身的 `refno` 名下**只挂载 `TUBI` 直管对象**，而弯头、三通、法兰、阀门等管件各自挂在自己的叶子 `refno` 名下！因此只把 `tubeCarriers`（`BRAN` 单元 refno）和房内构件 `memberRefnos` 放进隔离集（**不调 `withCompanions` 展开房外同分支管件**），就能天然实现：**房外管件全部隐藏、房内及穿墙管件完整保留、直管由 `RoomClipController` 精确截断到房间边界**！
- **截断关闭（`truncate = false`）**：
  - 复原所有被改写矩阵或被截断隐藏的直段对象，清空洋红断口与补片；
  - 隔离集切换回 `withCompanions(memberRefnos, branUnits) \setminus panelRefnos`，显示整根分支的全部管件与全长直管（半透明房间体仍保留作为空间参照）。

---

## 3. 分步实施计划（Milestones M0 – M5）

### M0：后端 `gen-model` 暴露房间在册面板列表（约 15 行 Rust）

- **修改文件**：
  - `gen-model/src/fast_model/spatial_rooms.rs`
  - `plant3d-web/src/api/genModelV1Api.ts`
  - `plant3d-web/src/api/genModelSpatialApi.ts`
  - `plant3d-web/src/model-source/genModelV1/spatialSource.ts`
- **具体改动**：
  1. `RoomListItem` 增加 `pub panel_refnos: Vec<String>`，`room_list_items()` 中填入 `room.panels.iter().map(|p| p.refno().to_string()).collect()`；
  2. 更新 `spatial_rooms.rs` 中的单元测试 `room_list_items_sorts_by_room_num_then_refno` 断言 `panel_refnos`；
  3. 前端 `SpatialRoomOption` / `GenModelV1RoomListItem` 类型增加 `panel_refnos?: string[]`（向后兼容旧后端）。

---

### M1：纯几何截断内核移植（`src/room-clip/`，零 Three.js 渲染耦合，纯函数可单测）

- **新增文件**：
  - `src/room-clip/predicate.ts`：移植 `plant-room/src/predicate.rs`
    - `panelTriMesh(vertices: Float32Array, indices: Uint32Array, worldMatrixMm: Float64Array | number[]): TriMesh | null`
      - 实现 `0.01 mm` 网格顶点焊接（`PANEL_WELD_STEP_MM = 0.01`）与退化三角形过滤（`PANEL_DEGENERATE_SIN = 1e-7`）；
      - 计算三角形 AABB 数组与面板总 AABB。
    - `pointInsidePanel(panel: TriMesh, pointMm: [number, number, number]): boolean`
      - 3 条偏斜射线 + JS `number`（IEEE 754 双精度 `f64`）Möller–Trumbore 求交 + 2/3 多数票。
  - `src/room-clip/roomSolid.ts`：移植 `plant-room/src/solid.rs`
    - `class RoomSolid`：
      - `static fromPanels(panels: TriMesh[]): RoomSolid | null`
      - `boundsMm(): { min: [number, number, number]; max: [number, number, number] }`
      - `insideIntervals(aMm: [number, number, number], bMm: [number, number, number]): Array<[number, number]>`
      - 完整保留 `MIN_PIECE_MM = 1.0` 端点吸附、跨面板共面墙无缝合并（gap $\le 1.0\text{ mm}$）、碎段剔除逻辑。
  - `src/room-clip/prism.ts`：移植 `room_clip.rs` 中的 `Prism` 与矩阵计算
    - `detectPrism(positions: Float32Array, vertexBase: number, vertexCount: number): Prism | null`（读取实际 `[z0, z1, cx, cy]`，通吃 `[0, 1]` 圆柱与 `[-0.5, 0.5]` 风管方管）；
    - `computeTubeEndpointsMm(matrix: Matrix4, prism: Prism): { a: [number, number, number]; b: [number, number, number]; lengthMm: number }`；
    - `buildPieceMatrix(originalMatrix: Matrix4, prism: Prism, interval: [number, number]): Matrix4`；
    - `buildCapMatrix(originalMatrix: Matrix4, prism: Prism, lengthMm: number, t: number): Matrix4`（`CAP_THICKNESS_MM = 2.0`, `CAP_SCALE = 1.02`）。
  - `src/room-clip/roomSolid.test.ts`：
    - 1:1 移植 `plant-room` 与 `room_clip.rs` 的全部几何单测：
      - 穿单面墙截留房内半截；
      - 穿整间房截留中间一截（两端各一枚断口）；
      - 整段在房内 `[[0, 1]]` / 整段在房外 `[]`；
      - 两块相邻面板拼接房（穿过公共隔墙合为一段、不留假断口）；
      - L 形凹房间（出房再进房返回两段 `[[0, 0.25], [0.75, 1.0]]`）；
      - 贴墙端点 `< 1 mm` 吸附为整段、不切碎；
      - `[0, 1]` 圆柱与 `[-0.5, 0.5]` 中心对称风管的矩阵重映射精度验证。

---

### M2：`DTXLayer` 矩阵热更新修复与 `RoomClipOverlay` 渲染层

- **修改 / 新增文件**：
  - `src/utils/three/dtx/DTXLayer.ts`
  - `src/composables/useDbnoInstancesDtxLoader.ts`
  - `src/room-clip/RoomClipOverlay.ts`
- **具体改动**：
  1. **`DTXLayer.ts`**：
     - 修复 `setObjectMatrix(objectId: string, matrix: Matrix4): boolean`：同步更新 `_matricesBuffer`、`_matricesTexture.image.data`（4 行像素）、`obj.boundingBox` 与 `_visibilityRevision`；
     - 新增只读方法 `getObjectMatrix(objectId: string, target?: Matrix4): Matrix4 | null`；
     - 新增只读方法 `getObjectGeoHash(objectId: string): string | null`；
     - 新增只读方法 `getGeometryRawSlice(geoHash: string): { positions: Float32Array; indices: Uint32Array } | null`（供 `RoomSolid` 提取面板网格、供 `Prism` 检测端盖）；
     - 新增 `getOrCreateBufferGeometry(geoHash: string): BufferGeometry | null`（复用 `_outlineGeometryCache` 构造标准 `BufferGeometry`，供房间体 X-Ray Mesh 与洋红断口 Mesh 共享）。
  2. **`useDbnoInstancesDtxLoader.ts`**：
     - 导出辅助查询 `resolveDtxTubiObjectIdsForCarriers(carrierRefnos: string[]): Array<{ objectId: string; carrierRefno: string; tubeKey: string | null }>`：从 `cachesByDbno` 中查找给定 `BRAN` / `HANG` 名下的所有 `tubiObjectIds`；
     - 导出辅助查询 `resolveDtxObjectIdsForRefnos(refnos: string[]): Map<string, string[]>`：查询面板 `PANE` 对应的 `DTXLayer` `objectId` 列表。
  3. **`src/room-clip/RoomClipOverlay.ts`**：
     - 管理挂载在 `DtxViewer.scene`（与 `dtxLayer` 同级，共享 `_globalModelMatrix` 毫米 $\to$ 场景世界变换）下的 `THREE.Group`：
       - `setRoomVolumeMeshes(panels: Array<{ geometry: BufferGeometry; matrix: Matrix4 }>)`：渲染半透明蓝青色房间体（`opacity: 0.18`, `depthWrite: false`, `DoubleSide`）+ 浅色边缘线（`EdgesGeometry`），`raycast = () => {}`；
       - `addSectionCap(geometry: BufferGeometry, matrix: Matrix4, carrierRefno: string)`：渲染 `#D946EF` 洋红断口薄饼；
       - `addExtraPiece(geometry: BufferGeometry, matrix: Matrix4, color: Color, carrierRefno: string)`：渲染多进房补片；
       - `clearCapsAndPieces()` / `clearAll()`：一键卸载并释放材质/几何引用。

---

### M3：房间截断控制器与双模式隔离编排（`src/composables/useRoomClip.ts`）

- **新增文件**：`src/composables/useRoomClip.ts`
- **状态机与接口设计**（与 `plant-ui` 的 `RoomClipStatus` / `RoomClipPhase` 对齐）：
  ```ts
  export type RoomClipPhase =
    | { kind: 'idle' }
    | { kind: 'loading-panels'; done: number; total: number }
    | { kind: 'loading-members'; done: number; total: number }
    | { kind: 'computing'; done: number; total: number }
    | { kind: 'ready'; cut: number; hidden: number; whole: number; skipped: number }
    | { kind: 'unavailable'; reason: string };
  ```
- **核心编排流程 `enterRoomView(options: { roomRefno: string; roomNum: string; panelRefnos: string[]; memberRefnos: string[]; tubeCarriers: string[] })`**：
  1. **世代号防串房（`generation = ++epoch`）**：连点两间房或中途退房时，旧世代异步回调自动丢弃；
  2. **先复原上一间房**：调 `restoreClippedTubes()` 将上一次改过矩阵或隐藏的直段全部原样写回 `DTXLayer`，清空 `RoomClipOverlay`；
  3. **确保面板与房间成员模型已加载**：
     - 检查 `panelRefnos` 与 `memberRefnos`（及 `tubeCarriers`）是否已在场景中加载；未加载的通过 `showModelByRefnosWithAck` 静默补齐；
  4. **构建 `RoomSolid` 与半透明房间体图层**：
     - 从 `DTXLayer` 读取每块 `panelRefno` 的 `objectId`、世界矩阵（毫米系）与网格顶点/索引；
     - 若存在面板无几何（`missing > 0`），按 `plant-ui` R5「宁可不截，也不按半个房间截」置为 `phase = { kind: 'unavailable', reason: '${missing} 块在册面板没有模型，房间体不全' }`，已有的面板仍画半透明；
     - 若全部面板就绪，合成 `RoomSolid`，渲染半透明房间体，并将相机对准房间体包围盒（`panelBoundsMm`）；
  5. **应用双模式隔离**：
     - 当 `truncateEnabled.value === true` 且 `RoomSolid` 可用：
       - 隔离集设为 `(memberRefnos \ panelRefnos) ∪ tubeCarriers`（排掉房外管件，隐藏原实体面板防重影）；
       - 启动分帧截断队列（每帧 `requestAnimationFrame` 处理 `TUBES_PER_FRAME = 256` 根直段）：
         - 对每根直段检测 `Prism`（按 `geoHash` 缓存 `Map<string, Prism | false>`）；
         - 调 `solid.insideIntervals(a, b)`；
         - 执行 `Whole` / `Hidden` / `Cut`：记录 `SavedTube { objectId, originalMatrix, originalVisible }`，改写矩阵或隐藏，生成 `#D946EF` 断口与补片；
         - 若某段此前已被用户通过「逐段眼睛（`isDtxTubeSegmentHidden`）」手动隐藏，尊重用户的手动隐藏状态；
     - 当 `truncateEnabled.value === false`：
       - 复原直段原矩阵与可见态，清空断口；
       - 隔离集设为 `withCompanions(memberRefnos, tubeCarriers) \ panelRefnos`（整根分支显示）。
  6. **拨动开关 `setTruncateEnabled(on: boolean)`**：
     - 写入 `localStorage`（键 `plant3d.roomView.truncateTubes`，默认 `true`）；
     - 立即在当前房间视图下切换隔离口径并执行截断或复原（耗时 $< 16\text{ ms}$）。
  7. **退出房间视图 `exitRoomView()`**：
     - 复原所有直段矩阵与可见态，撤除 `RoomClipOverlay` 半透明房间体与洋红断口，调 `sceneGraph.clearIsolation()` 恢复常规视图。

---

### M4：视口 HUD 横幅芯片与三处入口接入

- **修改 / 新增文件**：
  - `src/components/room/RoomViewHudBar.vue`（新增视口顶部中央 HUD 横幅组件）
  - `src/components/ViewerPanel.vue`（挂载 `RoomViewHudBar.vue`，并在模型增量加载完成钩子 `__dtxAfterInstancesLoaded` 中通知 `useRoomClip` 增量截断新到位的直段）
  - `src/composables/useRoomTree.ts` & `src/components/dock_panels/RoomTreePanel.vue`
  - `src/composables/useRoomInfo.ts` & `src/components/room/RoomInfoModal.vue`
- **UI 交互设计（对齐 `plant-ui` `canvas.rs` §4.2）**：
  1. **视口顶部 HUD 横幅 `RoomViewHudBar.vue`**：
     - 仅在房间视图激活时显示于三维视口顶部居中位置：
       `[门图标] 房间视图 · R432 · 成员 226   [ 截断直段 开 · 截断 38 段 ]   [ × 退出 ]`
     - **「截断直段」芯片四种状态**：
       - **开启就绪（青色强调态）**：`截断直段 开 · 截断 38 段`，悬停 tooltip 显示完整账本：`截断 38 段 · 房间外 99 段不画 · 整段在内 22 段`（如有跳过追加 `· 未能截断 K 段`），点击切换为关；
       - **加载 / 计算中（进度态）**：`截断直段 128/260…`，点击仍可随时关掉；
       - **关闭态（中性灰态）**：`截断直段 关`，悬停提示 `直段按整根分支显示；点击只保留房间体内的那一截`，点击开启；
       - **不可用态（琥珀告警态）**：`截断直段 不可用`，悬停显示具体原因（如 `1 块在册面板没有模型，房间体不全` 或 `房间没有在册面板`）。
  2. **三处入口无缝衔接**：
     - **模型树「房间」页签（`RoomTreePanel.vue`）**：点击房间节点的「隔离透明」按钮时，调用 `useRoomClip().enterRoomView(...)` 进入带房间体与直段截断的房间视图；点击「恢复显示」或 HUD 的「退出」同步退出；
     - **关联房间浮窗（`RoomInfoModal.vue`）**：点击「隔离成员」按钮时，同样调用 `useRoomClip().enterRoomView(...)`，并在浮窗工具栏同步显示「截断直段」开关状态；
     - **空间查询抽屉树态（`SpatialResultTree.vue`）**：当查询范围限定了单间在册房间并点击房间行的隔离动作时，同样接入房间截断视图。

---

### M5：测试与验证计划

1. **后端单元测试（`gen-model`）**：
   - `cargo test spatial_rooms`：验证 `RoomListItem.panel_refnos` 正确输出在册面板 `refno` 列表。
2. **前端单元测试（Vitest）**：
   - `src/room-clip/roomSolid.test.ts`：覆盖三射线奇偶投票、穿单墙、穿双墙、全内、全外、共面双面板无缝合并、L 形凹房间二次进房、`1 mm` 端点吸附、`[0, 1]` 与 `[-0.5, 0.5]` 棱柱矩阵重映射；
   - `src/utils/three/dtx/DTXLayer.setObjectMatrix.test.ts`：验证 `setObjectMatrix` 同步更新 `_matricesTexture.image.data` 的 4 行交错像素与 `obj.boundingBox`；
   - `src/composables/useRoomClip.test.ts`：验证开启/关闭截断时隔离集的切换（`Exact` vs `withCompanions`）、直段矩阵改写与复原、洋红断口生成与清除、缺面板降级 `unavailable`。
3. **浏览器端到端真机验证（Playwright）**：
   - 选定典型穿墙管道房间（如 `R432` / `R301`），进入房间隔离视图；
   - 验证「截断直段 开」时：穿墙直管在半透明房间墙壁处齐整截断、截点处呈现 `#D946EF` 洋红断口薄饼、房间外管件不显示、嵌在墙上的穿墙件完整保留；
   - 验证点击「截断直段 关」时：直管恢复全长穿出墙外、同分支房外管件一并显现；
   - 验证点击「退出」后：所有直管矩阵与可见性 100% 复原，半透明房间体与断口干净撤除。

---

## 4. 关键文件清单汇总

| 仓库 | 文件路径 | 变更性质 | 说明 |
|---|---|---|---|
| `gen-model` | `src/fast_model/spatial_rooms.rs` | 修改 | `RoomListItem` 增加 `panel_refnos: Vec<String>` |
| `plant3d-web` | `src/api/genModelV1Api.ts`、`src/api/genModelSpatialApi.ts` | 修改 | `SpatialRoomOption` 增加 `panel_refnos?: string[]` |
| `plant3d-web` | `src/room-clip/predicate.ts` | 新增 | 面板网格 $0.01\text{ mm}$ 焊接、三射线奇偶多数票判内 |
| `plant3d-web` | `src/room-clip/roomSolid.ts` | 新增 | `RoomSolid.insideIntervals` 轴线段求交与跨面板区间归并 |
| `plant3d-web` | `src/room-clip/prism.ts` | 新增 | `Prism` 端盖检测、子段矩阵 `buildPieceMatrix` 与断口矩阵 `buildCapMatrix` |
| `plant3d-web` | `src/room-clip/RoomClipOverlay.ts` | 新增 | 半透明房间体图层、`#D946EF` 洋红断口与多段补片的 Three.js Group 管理 |
| `plant3d-web` | `src/utils/three/dtx/DTXLayer.ts` | 修改 | 修复 `setObjectMatrix` 纹理同步与包围盒更新，新增网格切片只读访问器 |
| `plant3d-web` | `src/composables/useDbnoInstancesDtxLoader.ts` | 修改 | 导出按 `BRAN`/`HANG` 查直段 `objectId` 及按面板 `refno` 查 `objectId` 的辅助函数 |
| `plant3d-web` | `src/composables/useRoomClip.ts` | 新增 | 房间截断状态机、分帧截断队列（256 段/帧）、双模式隔离与复原编排 |
| `plant3d-web` | `src/components/room/RoomViewHudBar.vue` | 新增 | 视口顶部「房间视图 · 截断直段 开/关」HUD 横幅与芯片 |
| `plant3d-web` | `src/components/ViewerPanel.vue`、`src/composables/useRoomTree.ts`、`src/composables/useRoomInfo.ts` | 修改 | 挂载 HUD 横幅，将房间树与关联房间浮窗的房间隔离接入 `useRoomClip` |
| `plant3d-web` | `src/room-clip/roomSolid.test.ts`、`src/composables/useRoomClip.test.ts` | 新增 | 纯几何与控制器单元测试 |
