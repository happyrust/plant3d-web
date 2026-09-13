---
status: accepted
---

# MBD 标签体避让管件包围盒与尺寸描边：宿主按设计空间区域交出构件包围盒，内核投影成凸包，标签按「先无侵入、再最少侵入」换位且不出屏

ADR 0058 的标签 billboard 放置 pass（`placeTagBillboards`）从只让开尺寸数字与其它标签，扩到同时让开**管件几何**与**三维尺寸线本身**（2026-09-13）。管件几何来自一条新的可选宿主缝：`DimensionViewerAdapter.queryLayoutObstacles(region: DesignBox): LayoutObstacle[]`——内核把这一视图所有标签候选位的屏幕包络反投到锚点深度平面、再沿视向前后各推一个包络对角线的距离，得到一个设计空间盒子（`tagObstacleRegion`）问宿主「这里面有哪些构件包围盒」；宿主回每个盒子的 **8 个角点**（任意朝向，设计空间米），内核投影 8 个角点取凸包（Andrew 单调链）作为该构件在屏幕上的障碍多边形（`projectObstacleOutline`），落在相机后方或远平面外的盒子丢弃。DTX 适配器用 `DTXLayer.collectObjectBoundsIntersecting(worldBox, { visibleOnly: true })` 实现这条缝：查询盒先经 designToWorld 变到场景世界，图层把它变回局部毫米空间逐对象做一次 AABB 相交测试、只回可见对象的**局部**包围盒，适配器再用「毫米→场景」与「设计→场景」同一对矩阵把角点送回设计空间——全局模型矩阵带旋转时得到的是盒子真实的角点而不是重新拟合的、更松的 AABB。宿主没有这条缝（`ViewerPanel` 之外的宿主、单测里的 facade）时标签只让开数字、描边与彼此，行为与 0058 相同。尺寸描边不需要宿主：本批里其它布局投影后的每条 `line` / `path` 段（尺寸线、尺寸界线、投影线、引线、弧、箭头三边）都是障碍线段（`dimensionStrokes`）；字形与 marker 不算描边——数字已由 `labelBounds` 覆盖。

放置规则：候选位按圈排列（standoff × 1 / 1.6 / 2.4 / 3.4，每圈绕首选方向 0 / ±30° / ±60° / ±90° / ±135° / 180°），只有前一圈整圈被挡才轮到下一圈；外圈是为近景准备的——阀门这类构件的投影包围盒在近景会吞掉近圈，标签需要引出去而不是压在阀体上。第一个**零侵入**（不压数字 / 已放标签、体内没有描边穿过、与任何构件凸包无重叠面积）的候选位胜出；没有零侵入的位置时取**加权侵入面积**最小者：数字与已放标签 4 / px²，描边按 4 px 宽的带计 2 / px²，构件凸包 1 / px²——包围盒本来就比构件本体大，而且标签本来就是要挂在模型上的，所以压盒子最轻；差距在 1e-6 px² 内算平手、先到的候选位赢，因此同一视图两次结果相同。**有整块在屏内的候选位时，标签只在这些位置里挑**：为了绕开障碍把标签体挪出视口（文字被裁）比压住任何障碍都差；锚点本身在屏外、一个候选位都不在屏内时才不受此限（沿用 0058「整体落在视口外是预期行为」）。几何计算集中在 `kernel/geometry/obstacleGeometry.ts`（凸包、多边形面积、Sutherland–Hodgman 矩形裁剪、矩形∩凸多边形面积、线段在矩形内的长度——裁剪交点直接落在边界坐标上，避免浮点噪声让相等的侵入比出高下）。

不做的：不用网格轮廓（内核拿不到网格，包围盒角点是宿主能便宜且确定地给出的全部）——透视近景里凸包会明显大于构件本体，标签可能压在凸包的空白边缘上，或在没有任何零侵入位置时以最少重叠压在本体上；引线不是障碍、也不避让构件（引线可以穿过阀体）；视口右上角的坐标 gizmo 是独立覆盖层，内核不知道它；不改契约、不改求解器、不搬动尺寸数字（数字位置是求解器的，ADR 0057）。

被否决的替代：读深度缓冲判遮挡（每次重排版要 GPU 回读，不同驱动结果不同，破坏确定性）；网格级轮廓 / 光栅化占用图（内核要拿几何，成本与分层都不合）；不做区域查询、每次把整库对象都投影（图层扫一遍对象本来就是 O(N)，但逐对象投影 8 角点取凸包的成本随对象数线性增长，区域查询让它只随标签附近的对象数增长）；把包围盒也当 4 / px² 的硬障碍（近景里所有候选位都压盒子，硬障碍会让标签为了少压几个像素跳到很远的位置）；只加大候选圈不限「不出屏」（远景里位号方框会为了躲开阀门包围盒被裁在视口右缘外，实测出现过）。

依据：用户 2026-09-12 23:21「让标签体也避让管件包围盒与三维尺寸线，近景尾端卡片不再压在阀体上」；ADR 0058「不做的」第一条；效果图 README「已知问题」第二条（卡片放置需考虑管件包围盒）；PRD §9.3。落地：`kernel/types.ts`（`DesignBox` / `LayoutObstacle` / `LayoutObstacleSource`）、`kernel/geometry/obstacleGeometry.ts`（新）、`kernel/layout/tagBillboard.ts`（`TagObstacles`、`tagObstacleRegion`、`projectObstacleOutline`、`dimensionStrokes`、`collectTagObstacles`、`placeTagBillboards` 加权侵入与不出屏、四圈候选位）、`kernel/viewport/layoutViewport.ts`（`ViewportLayoutOptions.obstacles`）、`viewport/dimensionViewport.ts`（透传）、`facade/createDimensionSystem.ts`（`queryLayoutObstacles` 缝）、`adapters/dtxDimensionViewerAdapter.ts`（`getDtxLayer` → 设计空间角点）、`utils/three/dtx/DTXLayer.ts`（`collectObjectBoundsIntersecting`）、`components/dock_panels/ViewerPanel.vue`（接 `getDtxLayer`）。实机验证：`docs/verification/mbd-3d-dimension-presentation-2026-09-12/`「标签避让管件包围盒与尺寸描边」段。
