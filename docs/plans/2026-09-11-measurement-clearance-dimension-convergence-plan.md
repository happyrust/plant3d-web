# 测量、净距与尺寸收敛开发计划

日期：2026-09-11  
状态：Plannotator 已批准  
落地状态（2026-09-17 同步）：M1 的第一格已由「构件到墙最近距离」计划落地——`docs/plans/2026-09-17-component-to-wall-surface-clearance-plan.md`（决策 `d-428`）：gen-model `a0e307588`（`GET /api/v1/spatial/surface-clearance`，两侧真实网格 parry3d `closest_points`）+ plant3d-web `dbbda78`（`src/clearance/` 领域）/ `8402b2c`（入口）。PR0.1 的 `ClearanceRecord`、PR1.1 的 service / store / adapter、PR1.2 的 `surface_to_surface` 契约、PR1.3 第 3 / 4 项各有第一次实现；逐节状态见下文各 **2026-09-17 状态** 行，未点到的条目仍未动。  
范围：`plant3d-web`，以及净距精算与语义点导出所依赖的后端/模型生成仓库  
依据：当前源码审计、Oracle MCP 第二模型复核、IDA Bridge 对 Plant3 `Core3D.dll` / `core.dll` / `libgeom.dll` 的只读分析

## 1. 目标

把当前三条容易混淆的能力收敛成边界清晰、结果可追溯的产品：

1. **Measurement**：用户主动取点后得到距离、角度、标高或高差结果。
2. **Clearance**：系统对两个工程对象求最近点、中心线距离或外表面净空。
3. **Dimension**：用户明确创建并持久化的工程尺寸，拥有语义锚点、放置意图、编辑历史和校审所有权。

最终要求：

- 每一个显示给用户的数值都能回答“怎么算的、准不准、在哪个坐标系、基于哪个模型版本”。
- 近似值不得以“精确净距”或无标识的“最近点”呈现。
- Measurement/clearance 只有经过显式命令才能转成持久 Dimension。
- MBD、测量结果、净距结果和自动网格尺寸继续作为只读 external source，共享画家但不共享领域所有权。
- E3D 等价声明必须有实机金样，不以 IDA 静态证据代替运行时验收。

## 2. 非目标

本计划不包含：

- 面积测量、体积测量。当前 Web 没有产品入口，已连接 native IDB 也未发现明确用户级入口。
- 完整复制 E3D 的窗口布局、PowerWheel 或 Positioning Control。
- 未经真实数据验证就加入 IDA 中观察到的阈值、文字样式或单位格式常量。
- 把 QCLAS 碰撞报告直接塞进普通测量列表。
- 在本轮重写现有 Three.js dimension scene painter。

## 3. 已确认的基线

### 3.1 已可用

- 四类 Xeokit 测量：距离、角度、点标高、高差。
- 距离结果 Inspector：Distance、World X/Y/Z Offset、Direction 单位向量、起终点。
- P-Point、Item 原点、模型表面点、Primitive/semantic key point 捕捉。
- P-Point pending 保护、E3D/free-surface 模式、Repeat、连续距离、Esc 分层取消。
- 测量结果保留、直接尺寸线开关、列表、定位、隐藏、删除、清空、右键菜单。
- 点到构件表面距离会写入 classic measurement。
- 构件到构件最近点会写入 classic measurement，但算法为有限采样近似。
- 批量 BRAN 距离面板有后端 nearest-points 主路径和 DTX 轴线拟合 fallback。
- 用户尺寸系统已支持 linear/projected/angular/radial、undo/redo、恢复日志、Review API 持久化、CAS 冲突和 SVG。
- MBD、measurement、pipe-distance 已能以 external source 进入共享画家。

### 3.2 已接线但未闭环

- 交互式管—墙/柱与管—管只显示数值和 Toast，不生成可管理记录。
- 批量管道距离使用独立内存 store，不进入统一结果、校审快照或失效重算协议。
- `maxDistance` / `maxAngle` 只约束 DTX fallback，没有约束后端主路径。
- `centerline_aabb`、`aabb_aabb`、PCA 轴线距离和有限采样最近点可能被 UI 统称为“净距”。
- semantic snap loader 当前明确实现的是按 `instance_refno` 查询 PLINE start/end；TUBI LEAVE/ARRIVE、owner 查询、SPINE vertex/arc 尚未完整落地。
- unified measurement 已是内存写入真源，但仍向旧 V6 五数组投影，文件头注释与实际代码有漂移。

### 3.3 E3D/Plant3 静态证据

结构化证据见：

- `docs/reverse-engineering/e3d-dimension-ida-evidence.json`
- `docs/plans/2026-09-11-e3d-dimension-pr0-evidence-and-golden-corpus.md`

本轮重新用 IDA Bridge 复核：

- `LINDIM / DIMPPT / DIMPLI` 是持久语义尺寸结构。
- `DMCHEK` 在布局前验证尺寸方向、投影方向和视向。
- `DMLDAT / DPTDIR / DMPROJ` 证明 measured axis、dimension direction、projection direction 不能混用。
- `DPTPOS` 会从语义引用重新求锚点位置。
- `DMANGL / DPTANG / DTRAD / DOFFS / CHAIN / TXUVAL` 分别覆盖角度、径向、放置、链式和格式策略。
- `STRU_GridAnnotationsManager` 管理 GRIDPL/GRIDCY 自动标注生命周期。
- `QCLAS` 属于 clearance/report。
- Router、PMLProfile 和 libgeom 暴露最近点、垂足及点线面圆弧距离内核。
- NUC nearest-anchor/wall-edge 伪属性只注册给特定 noun，不能推导为通用 UI 能力。

静态证据不能确定完整 Measure Distance 窗体、事件顺序、所有文案或格式，仍需实机采集。

## 4. 冻结的架构决策

### D1：三个领域模型分离

新增或收口为三个明确模型：

```ts
type MeasurementRecord = {
  // 用户主动取点得到的结果
};

type ClearanceRecord = {
  // 两个工程对象之间可重算的最近关系
};

type DimensionDocument = {
  // 用户创建、可编辑、可持久化的尺寸文档
};
```

Clearance 不伪装成普通 Measurement。Measurement 或 Clearance 通过显式
`CreateDimensionFromResult` 命令生成新的 Dimension；生成后两者 ID 和所有权独立。

### D2：精度不是布尔值

废止只靠 `approximate: boolean` 表达算法事实的做法。所有距离类结果使用：

```ts
type AccuracyClass =
  | 'exact-semantic'
  | 'exact-surface'
  | 'approximate-bounds'
  | 'approximate-sampled'
  | 'approximate-axis';

type ComputationMethod =
  | 'semantic-point-pair'
  | 'point-to-triangle-mesh'
  | 'surface-to-surface'
  | 'pipe-surface-clearance'
  | 'centerline-to-aabb'
  | 'aabb-to-aabb'
  | 'sampled-object'
  | 'pca-axis';
```

结果还必须携带：

- `coordinateSpace`
- `sourceModelVersion`
- `warnings`
- 可得时的 `errorBoundM`
- 输入对象 refno 和实际命中的几何/segment ref

兼容层可以从 `accuracyClass` 派生旧 `approximate`，不能反向丢失方法信息。

### D3：统一设计空间和单位

- 领域层统一保存 design-world 米和弧度。
- API 返回的 mm 在 adapter 边界立即转换。
- scene-world/recenter 只存在于 viewer adapter。
- 每个转换只发生一次，并由测试锁定。

### D4：派生结果必须可失效

ClearanceRecord 保存“输入引用 + 算法 + 结果快照 + 模型版本”。

- 模型版本相同：可显示 snapshot。
- 模型版本变化：标记 stale，不静默沿用。
- 用户可重算；批量重算成功后原子替换快照。
- 语义引用解析失败时保留旧 snapshot，但不得继续标为 current/exact。

**2026-09-17 状态（D1–D4 第一次落地，`dbbda78`）**：`src/clearance/domain/clearanceRecord.ts` 的 `ClearanceRecord` = `inputs`（两个 refno）+ `provenance`（嵌 `ComputationProvenance`，缺 `method` / `accuracyClass` 直接拒收）+ `snapshot`（两最近点、E/N/U 分量、命中墙面分类、垂距、`errorBoundM`，design-world 米，mm → m 只在 `clearanceService` 转一次）+ `sourceModelVersion`（两侧 `model_sesno`）+ `status: current | stale | failed`；`useClearanceStore.markStaleByModelSesno` / `recompute` 对应 D4 的失效与重算。外部尺寸源 `clearance` 只画不拥有记录。**未动**：`CreateDimensionFromResult` 显式转尺寸命令；Review snapshot 落库。

### D5：扩展现有尺寸系统

E3D parity 在现有 `src/dimension` 上演进，不创建新的尺寸 runtime。

## 5. 里程碑 M0：领域合同与护栏

目标：不改变几何结果，先消除错误命名和不可追溯结果。

### PR0.1：结果合同

新增建议模块：

- `src/measurement/domain/measurementResult.ts`
- `src/clearance/domain/clearanceRecord.ts`
- `src/measurement/domain/computationProvenance.ts`

修改：

- `src/composables/unifiedMeasurement.ts`
- `src/composables/useToolStore.ts`
- `src/composables/useDtxTools.ts`
- `src/composables/usePipeDistanceStore.ts`
- Review snapshot adapters

任务：

1. 定义 accuracy/method/provenance/version 合同。
2. 为现有四类 Xeokit measurement 补齐来源与坐标空间。
3. 把 classic point-to-object 的写入转换到统一 measurement command。
4. 把 object-to-object 从 classic measurement 路径迁往 ClearanceRecord。
5. 为旧 V6 payload 提供单向迁移；未知旧算法统一标 `legacy-unknown`，不能猜 exact。
6. 修正 `unifiedMeasurement.ts` 过时注释。

**2026-09-17 状态**：三个模块都在——`measurementResult.ts` / `computationProvenance.ts` 早已落地；`clearance/domain/clearanceRecord.ts` 随 `dbbda78` 落地并复用同一份 `ComputationProvenance`（`surface-to-surface` / `exact-surface`）。任务 4（object-to-object 迁往 `ClearanceRecord`）只走到一半：空间查询抽屉「净距标注」已改走 `useClearanceStore.compute(targetKind any)`（`8402b2c`），`useDtxTools` 里三维点选的 object-to-object 采样路径未迁。

### PR0.2：产品文案和 UI 防误导

在精算未完成前：

- `sampled-object` 显示“估算最近距离”。
- `pca-axis` 显示“估算轴线距离”。
- `centerline-to-aabb` 显示“中心线至包围盒距离”。
- 只有 `pipe-surface-clearance` 才显示“外表面净距”。

**2026-09-17 状态**：这一条按 D2 的方法枚举补一格——`surface-to-surface`（两侧真实网格精算）同样显示“外表面净距”，其余方法只显示“净距”（`clearanceExternalDimensions.ts` 来源标签 / `formatClearanceToast`）；近似档前缀 `≈`，`stale` 前缀“（过期）”，相交显示“相交”。

### M0 验收

- 任一距离/净距结果缺 `method` 或 `accuracyClass` 时 reducer 拒收。
- 旧数据可读，且不会被误标 exact。
- Review snapshot 往返保留 provenance。
- 当前聚焦基线 68 个测试不回归，并新增合同迁移测试。
- `npm run type-check` 不新增基线外错误。

## 6. 里程碑 M1：Clearance 统一闭环

目标：四个入口共享一个结果模型和生命周期。

入口：

1. object-to-object
2. pipe-to-structure
3. interactive pipe-to-pipe
4. PipeDistanceDrawer batch

**2026-09-17 状态**：多出第 5 个入口——ribbon「构件→墙净距」拾取流（源 = 当前选中，`pick_refno` 只放行 CWALL / WALL / STWALL / GWALL / PANE，`8402b2c`），它和入口 1 的抽屉「净距标注」（`targetKind = any`）已共用 `useClearanceStore`；入口 2 / 3（`useDtxTools` 采样路径，结果写 Dock「BRAN 中心线最近清距」）与入口 4（`usePipeDistanceStore` → legacy `/api/space/nearest-points`，该后端 :3100 已不在跑）**未接**。

### PR1.1：Clearance service/store

新增建议模块：

- `src/clearance/services/clearanceService.ts`
- `src/clearance/stores/useClearanceStore.ts`
- `src/clearance/adapters/clearanceExternalDimensions.ts`

任务：

1. 将当前 `useDtxTools` 中的算法调用收口到 service。
2. 让交互式管—结构、管—管不再只 Toast，而是生成 ClearanceRecord。
3. 批量 Drawer 与交互入口共享 store、精度标签、选择、隐藏、删除和定位。
4. Clearance external source 只负责绘制，不拥有记录。
5. 将记录加入校审快照；模型版本变化时显示 stale。
6. 提供显式“创建尺寸”动作，不自动混入 DimensionDocument。

**2026-09-17 状态（`dbbda78` / `8402b2c`）**：三个模块按上面的建议路径原名落地。任务 4 ✓（外部尺寸源 `clearance` 只画，`useClearanceDimensionSync` → `replaceExternalSource('clearance')`）；任务 5 半 ✓（`markStaleByModelSesno` + stale 文字；**未**进校审快照）；任务 3 半 ✓（抽屉入口与拾取流共用 store 的记录 / 隐藏 / 清空，批量 Drawer 仍独立）；任务 1 / 2 / 6 **未动**。vitest：`src/clearance` 22 + API 1 + 入口 8。

### PR1.2：后端距离契约 v2

在修改后端前先定位 `/api/space/nearest-points` 的真实实现和几何数据可用性。

请求必须区分：

- `centerline_distance`
- `surface_clearance`
- `point_to_surface`
- `surface_to_surface`

响应必须返回：

- method/accuracy
- source/target points
- 输入与命中的 refno/segment
- 管外径、保温层或其它 clearance allowance 的使用情况
- candidate truncation 和 warnings

不允许用 `centerline_aabb` 响应满足 `surface_clearance` 请求。

**2026-09-17 状态**：定位完成——`/api/space/nearest-points` 的真实实现在 legacy 后端 plant-model-gen（`sqlite_spatial_api.rs` 3881–4240，只有 `centerline_aabb` / `aabb_aabb`），:3100 已不在跑，本轮**一字未动**；网格与 `model_sesno` 都在 gen-model。契约 v2 的第一条不是改它，而是 gen-model v1 新端点 **`GET /api/v1/spatial/surface-clearance`**（`a0e307588`，09-17 计划 §5）：响应带 `method = surface_to_surface`、`accuracy_class = exact-surface`、`error_bound_mm`、两侧最近点与 `vector`、输入 refno 与命中叶子 refno、`target_face`、`model.{source,target}_sesno`、`warnings`、`timing_ms`；失败走 HTTP 状态码（404 `no_model_mesh` / 422 `target_not_wall`）。**未覆盖**：`centerline_distance` / `point_to_surface` / 管外径与保温 allowance / candidate truncation（本端点一对一，没有候选集）。

### PR1.3：精算内核

优先级：

1. 直管—直管：解析中心线段与有效外半径，求解析外表面净距。
2. 点—三角网格：BVH 最近点。
3. 管—墙/柱：管中心线/外表面到目标真实网格。
4. 通用 mesh—mesh：BVH/三角形对或后端几何内核。
5. 弯头、异径和保温层：有权威参数后扩展。

无法精算时允许 fallback，但结果必须保持 approximate。

**2026-09-17 状态**：第 3 / 4 项先落地（顺序与上面不同，见 §13 第 3 条）——gen-model `fast_model/surface_clearance.rs`：两侧叶子网格（`inst_relate` / `tubi_relate` 按 `anc CONTAINS` 取齐，磁盘 `.mesh` 只读）拼成世界 mm `TriMesh`，`parry3d::query::closest_points`（TriMesh × TriMesh 嵌套 BVH，不自写 BVH）+ 叶子对 AABB 下界剪枝，命中墙主面再 `cast_local_ray_and_get_normal` 出垂距；`error_bound_mm = 0.5`（弦高容差）。源任意 noun（含 BRAN owner 的隐式管身），目标一期限墙族。第 1 项（直管—直管解析）、第 2 项（点—网格）、第 5 项（弯头 / 异径 / 保温）**未动**。实测（09-17 计划 §7.1）：单对 3–14 ms，CWALL owner 113 叶子首访 132 ms、热后 15 ms。

### M1 金样

- 两根平行直管，已知中心距和半径。
- 斜交直管。
- 相交管，净距为零或带 intersects 状态。
- 直管到平面墙。
- 管到柱。
- 弯管/异径，验证 fallback 标签。
- 后端 exact、现有 sampled、PCA axis 三路误差对比。

**2026-09-17 状态**：这一组里只有「直管到平面墙」有了对应实机——09-17 计划 §7 的 G1–G7（合成单测 G1–G6 全过；live：ELBO / BEND / BRAN owner × 弧墙 WALL 1、SCTN × 弧墙、BOX × 直墙 STWALL 1、BOX × CWALL owner 113 叶子、ELBO × BEND `target_kind=any`；PR-D 在 `:8024` 补齐 G4 穿墙 17 对——BEND `24384/24729` × GWALL `17496/118130` 等，0 + `intersects`）。**完整流真 UI 截图 ✓**（`e4b5d4a`；验证实例 `_runs\surface-clearance-8024` = 从 `a0e307588` 干净构建的 release mem 档，`:8022` / `:8023` 未动；dev `:3111` Playwright 真指针：选 ELBO `24384_22582` → 菜单「构件→墙净距」→ 一次点中墙 `17496_105912` → Enter → toast「外表面净距 64.4 mm（墙面外侧）」→ 外部尺寸源 `clearance` 0 → 1、`64mm ⊥`，`pageerror` 0）：五张截图 + HTTP 金样 `64.42777 mm` + summary / 扫描 jsonl 在 `docs/verification/component-to-wall-surface-clearance-2026-09-17/`。**G6「构件在洞里」仍无实机对**（扫过了，是数据里没有）：WALL 1 周边 126 对 AABB 相交的管 × 墙逐对打过，穿墙的 17 对全是没开洞的硬穿（即上面的 G4），38 个 FIXING 开洞周围无管件，FLOOR 无竖管贯穿——带洞路径：**合成几何单测 ✓**（09-18，gen-model-model-cache `82517dbd8`：带方孔直墙 + 穿孔的管报到洞壁 50 mm、不相交，同一根管对实心墙回 G4 作对照；`eabd16d5c`：洞壁单独分类 **`opening`**、算主面打垂距——判据 = 命中三角沿自身法向严格在墙 AABB 内部且沿法向再往前撞回本墙，四片洞壁都 `opening` / 垂距 50，台阶墙顶面与 350° 弧墙凹面不误判）+ **行解析单测 ✓**（`booled_id` 路）；前端 plant3d-web `554c6ca5`：`opening` 标签「洞口」、toast「垂直于洞壁」、尺寸文字保留 `⊥`；实机对仍缺，留待有穿孔数据的工程（09-17 计划 §7 G6 / §7.2 / §9 / §10）。平行 / 斜交 / 相交直管、管到柱、弯管异径 fallback、三路误差对比**未采**。

验收：

- 四个入口都能产生可管理记录。
- `maxDistance/maxAngle` 在主路径和 fallback 语义一致。
- UI 不再把中心线距离显示为外表面净距。
- 同一输入在交互和批量入口得到同一 method 和结果。

**2026-09-17 状态**：第 1 条 5 个入口里 2 个（抽屉「净距标注」+ 构件→墙拾取流）产生 `ClearanceRecord`；第 3 条在这两个入口成立（只有 `surface-to-surface` 叫“外表面净距”）；第 2 / 4 条未到（批量入口未接）。

## 7. 里程碑 M2：工程语义点与锚点重绑定

目标：把“看起来点到了”升级为可跨模型版本重解析的工程锚点。

### PR2.1：semantic snap contract v2

扩展 `semantic_snap_points`：

- TUBI `leave` / `arrive`
- PLINE 完整 PKEY，而不只 start/end
- `instance_refno_str` 与 `owner_refno_str`
- 稳定 `point_id`
- design-world 坐标和明确 unit metadata
- 可选 direction/circle/arc payload

### PR2.2：Web loader 和捕捉

修改：

- `src/composables/useDbnoInstancesParquetLoader.ts`
- `src/composables/useXeokitMeasurementTools.ts`
- `src/dimension/adapters/dtxDimensionSnapPort.ts`

任务：

1. 同时按 instance 和 owner 查询。
2. 区分 TUBI LEAVE/ARRIVE、PLINE PKEY 和通用 primitive label。
3. 保留重合候选的语义 ID，不按 XYZ 去重。
4. measurement 与 dimension 共用候选和 tie-break。
5. cache key 包含模型版本；切版本后旧候选不可复用。

### PR2.3：SPINE 可选扩展

在 TUBI/PLINE 金样通过后再做：

- `spine_vertex`
- `spine_arc` 的 center/rim/normal
- CUTLEN 或 path length 只作为属性结果，不新增“路径测量”类型

### M2 金样

- Parquet 原始行、Web candidate、最终 record 三者坐标一致。
- candidateId 跨重复导出稳定。
- local→design→scene 每层只转换一次。
- 模型版本变化后 anchor 批量重解析；失败记录标 stale。

## 8. 里程碑 M3：E3D Measure 参考系语义

目标：在现有结果 Inspector 上补工程语义，不复制 E3D 窗口。

### PR3.1：ReferenceFrameResolver

支持顺序：

1. World
2. Owner
3. CE
4. 具名元素/refno

输出：

- frame origin
- 正交基 U/V/W
- 轴显示名 X/Y/Z、E/N/U 或 U/V/W
- design↔frame 变换
- 解析来源和错误

### PR3.2：结果解释器

- Offset 由 resolver 投影，不再硬编码 Z/XYZ。
- Direction 内部仍保存单位向量，显示格式由 policy 产生。
- 标高和高差使用 frame 的垂直轴。
- 增加 measurement-session 单位覆盖，优先级高于全局显示设置。
- 实现 Perpendicular To，但只接受有语义方向且验证通过的对象。

### M3 前置实机 gate

必须采集：

- World 与旋转 Owner 下的 Offset 符号。
- Dire. 的实际格式。
- Units/precision/英制/尾零矩阵。
- Perpendicular To 的选择、错误和取消行为。
- ESC、右键、关闭窗体的分层行为。

没有上述金样时，代码只能提供 experimental flag，不能宣称 E3D parity。

## 9. 里程碑 M4：现有 Dimension 系统的 E3D parity

目标：把已有用户尺寸从“可用”推进到 E3D 语义尺寸。

### PR4.1：领域 schema 升级

为 linear/projected 记录分离：

- measured axis
- dimension direction
- projection direction
- dimension plane
- design-space placement offset

提供版本化迁移。旧记录缺方向时标 legacy-derived，不静默伪造 semantic direction。

### PR4.2：验证内核

实现稳定错误：

- `DIMENSION_DIRECTION_PARALLEL_VIEW`
- `PROJECTION_DIRECTION_PARALLEL_VIEW`
- `PROJECTION_DIRECTION_PARALLEL_DIMENSION`
- `DEGENERATE_DIMENSION_DIRECTION`
- `DEGENERATE_PROJECTION_DIRECTION`
- `UNRESOLVED_DIMENSION_POINT`
- `INVALID_DIMENSION_POINT_TYPE`

IDA 中观察到的阈值只进入 golden metadata；生产阈值由实机边界和浏览器数值测试共同确定。

### PR4.3：真实创建/编辑状态机

目标状态：

```text
pick-first
  -> pick-second / pick-third
  -> choose-axis-or-frame
  -> place
  -> ready
  -> commit
```

要求：

- pointer placement 生成 design-space offset。
- cancel/back 恢复编辑前状态。
- 一次完成动作只形成一个 undo 边界。
- radial 捕捉圆后也要进入 place，而不是直接 ready。

### PR4.4：扩展能力

按金样顺序实施：

1. chain dimension：ordered anchors + shared baseline/frame。
2. angle minor/major 与近 90° 策略。
3. radial radius/diameter 与 leader placement。
4. TXUVAL-compatible format policy。
5. GRIDPL/GRIDCY 自动尺寸 external source。

### M4 验收

执行 `docs/verification/e3d-dimension-golden-corpus.json` 的 14 组：

- 001–012 是 linear/angle/radial 开发 gate。
- 013 是 grid external source gate。
- 014 是创建、取消、编辑、undo gate。

## 10. PR 顺序和依赖

推荐顺序：

```text
PR0.1 结果合同
  -> PR0.2 防误导 UI
  -> PR1.1 Clearance store 闭环
  -> PR1.2 后端契约
  -> PR1.3 精算内核
  -> PR2.1/2.2 语义点
  -> PR3.1/3.2 参考系 Measure
  -> PR4.1/4.2/4.3 Dimension 核心
  -> PR4.4 扩展
```

可并行项：

- PR2 的上游导出可在 PR1 后端精算期间进行。
- E3D 实机金样采集可从 PR0 开始，不能等到 PR4 才启动。
- GRID 自动尺寸可在 PR4 核心 schema 稳定后独立开发。

## 11. 验证命令

每个 PR 最少：

```powershell
npm run type-check
npx vitest run `
  src/composables/useXeokitMeasurementTools.test.ts `
  src/components/tools/MeasurementPanel.test.ts `
  src/components/tools/MeasurementResultInspector.test.ts `
  src/composables/usePipeDistanceStore.detection.test.ts `
  src/composables/useDtxTools.objectMeasure.test.ts `
  src/utils/xeokitMeasurementFormat.test.ts `
  src/dimension/interaction/editSession.test.ts
```

涉及真实数据时：

```powershell
npm run test:smoke:p0:measurement
```

补充要求：

- 记录 baseline/after pass-fail 差量。
- 运行真实 AMS 样本时保存 API response、model version、refno、截图和结构化 expected。
- 单元测试不得发起未 mock 的 `localhost:3000` 请求；当前测试虽 68/68 通过，但存在连接拒绝噪声，应在 PR0 修复隔离。

## 12. 发布、迁移与回滚

- 新合同先双读旧 V6，单写新版本；稳定一个迭代后再删除旧投影。
- Clearance 新 UI 先挂 feature flag；旧 PipeDistanceDrawer 在结果一致前保留只读回退。
- 新 exact 后端失败时可回退 approximate，但 UI 必须展示降级原因。
- Dimension schema 升级前导出旧文档 fixture，迁移必须可重复且不改原始 snapshot。
- 任一模型版本不匹配的派生结果默认 stale，不允许通过隐藏 warning 的方式回滚。

## 13. 需要本次 Plannotator 拍板的事项

推荐默认值已列在前：

1. **Clearance 放在哪里？**  
   推荐独立 Clearance 面板；Measurement 面板只给入口和最近结果摘要。

2. **Clearance 是否默认写入 Review snapshot？**  
   推荐用户点击“保留结果”后写入；临时探测不自动污染校审记录。

3. **第一批 exact 范围？**  
   推荐直管—直管、点—网格、直管—墙；弯头/异径先保留 approximate。  
   **2026-09-17 实际**：用户在「构件到墙最近距离」考问里拍板（决策 `d-428`）第一批 exact = **任意构件（含 owner）— 墙**的通用 mesh—mesh 外表面净距（parry3d `closest_points`，弧墙 / 带洞墙同一条网格路径），弯头 / 管件因此**也已 exact**（与推荐的“先保留 approximate”不同）；直管—直管解析、点—网格仍待做。

4. **semantic snap 首批范围？**  
   推荐 TUBI LEAVE/ARRIVE + 完整 PLINE PKEY；SPINE 后置。

5. **M4 首个发布子集？**  
   推荐 linear + projected + DMCHEK-like validation + true place；chain/angle/radial/grid 分批。

6. **“创建尺寸”后的关系？**  
   推荐 Dimension 保存独立 ID，并保留 `derivedFromResultId` 只作追溯；后续编辑尺寸不反写原测量/净距。

## 14. 完成定义

本计划完成时：

- 四类 Measurement 结果方法与精度可追溯。
- 四个 Clearance 入口共享合同、生命周期和精度标签。
- 后端 exact 与 fallback 的边界可测试。
- TUBI/PLINE 语义点可稳定捕捉和跨版本重绑定。
- Measure 支持经实机验证的参考系结果。
- 用户 Dimension 具备 E3D 方向、放置、验证和链式语义。
- MBD、measurement、clearance、grid external source 与用户 Dimension 所有权清晰。
- 14 组 E3D dimension corpus 按各阶段 gate 完成。

## 15. GitHub 执行地图

GitHub Roadmap：
[Roadmap: 收敛测量、净距与 E3D 尺寸语义](https://github.com/happyrust/plant3d-web/issues/55)

已按小型 PR 拆为 23 个 native sub-issues：

- M0 合同与护栏：#60、#56、#59。
- M1 Clearance 闭环与精算：#57、#58、#63、#64、#61、#65。
- M2 工程语义点：#62、#66、#77。
- M3 WRT 与 Measure 语义：#67、#70、#69、#76。
- M4 E3D Dimension parity：#68、#75、#71、#72、#73、#74、#78。

所有前后置关系已使用 GitHub native `blocked by` 依赖，不只依赖正文约定。

当前可执行前沿：

- Agent：#60（provenance 合同）、#67（ReferenceFrameResolver）。
- 人工/跨仓：#62（semantic snap v2 导出）、#70（E3D 实机金样）。

本地仓库没有配置 git remote，因此本轮只创建/关联 Issues；
没有创建分支、提交、推送或空 PR。每个实现票正文均给出建议 PR 标题、
范围、非目标、验收标准和验证命令。
