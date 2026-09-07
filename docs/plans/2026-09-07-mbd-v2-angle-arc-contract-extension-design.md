# 设计稿：MBD V2 契约补齐 `angle_dim` / `aid_arc` / `aid_circle` 几何（plant-mbd Phase 5 ⑤）

> 状态：**设计稿，待拍板**（2026-09-07）。只写方案，不改代码。
> 上游计划：gen-model `.planning/2026-09-06-plant-mbd-pipe-dimension/task_plan.md` Phase 5 ⑤（D2 契约 1:1、D7 两侧同版）。
> 本仓依据：ADR 0041（经内核渲染）、ADR 0042（内核只新增弧与点原语）、ADR 0043（只经冻结契约形状）、ADR 0046（fail-closed）、
> ADR 0044（外部文字按屏幕像素高）；审计 `2026-07-29-mbd-dimension-annotation-capability-audit.md` G1 与
> `2026-07-30-...-followup.md` §「角度/弧几何字段」已判定**堵点在契约，不在内核**。
> PML 事实源：`old/vendor/MBD/markpipe/object/isobran.pmlobj`（`getinstallationangles` L2563-2612、`getmemP3dirangle` L2635-2757、
> 对象顺序 L1133 / `putIntoIsoline` L1288-1289）、`isombdangle.pmlobj`（L26-104）、`isoline.pmlobj`（`drawangle` L2848-2937、
> `getgoodori` L2939-2958）、`object/polarsystem/polarsystem.pmlobj`（`getgoodradius` L683-930、`getgoodradiusfrombadradiuss` L969-1025）、
> `object/mbd/aidarc.pmlobj`（L18-30 / L48-68）、`object/mbd/aidcircle.pmlobj`（L1-11）。

## 0. 结论先行

1. 三个 kind 共用一套「弧框架」六个扁平字段：`center / x_axis / normal / radius / start_angle_deg / sweep_angle_deg`，
   与 PML `AIDARC` 的 `pos / ori(x, z) / radius / stangle / sweepAngle` **1:1**；`aid_circle` 只要 `center / normal / radius`。
2. `angle_dim` 走 `linear_dim` 同一路线——**显式几何**：弧（六字段）+ 两条腿 `leg_lines` + `text` + `label_anchor`；文字朝向由弧切向派生，
   前端不做任何摆位决定。
3. 两侧同版（D7）：**先**本仓（契约类型 + 校验 + 映射 + fixtures + 测试，`CONTRACT_INCOMPLETE_KINDS` 退役），**后** plant-mbd 同步
   `contract.rs` 并开始产出。fail-closed 保证顺序反了不会画出半截。
4. 六条现有金样**一条角度都不会出**（三个带 P3 的构件全是正交且正轴，见 §5.1 实算），所以契约上线后 `golden diff` 不变；
   求解器落地要靠新 toy fixture + 找一条带偏转手轮的真实 BRAN。

## 1. PML 事实：什么被标角度、怎么画

### 1.1 采集（`isobran.getinstallationangles` L2563-2612）

- 逐 BRAN 成员，跳过 Head / Tail；`type inset ('ATTA','ELBO','BEND')` **不进这条路**（ELBO / BEND 的角度已经是 Phase 5 ④ 的文字标签，
  ATTA 走 `pipeatta.attaobjects` 的 LUG / PAD / LEG 分类，L2616-2631，本期不迁——与 ATTA 焊缝同一原因）。
- `arrive eq 3 or leave eq 3` → 跳过（P3 在流路上，「角度会由坡度或尺寸体现」，L2581-2585）。
- 取不到 `p3 dir` → 跳过。P3 落在 P1 轴线上（`距离 < 1`）时要 `p3 bore` 非空非零，否则跳过（L2595-2600）；P3 不在轴线上时，
  若「P1 轴线到 P3 的垂足方向」与 `p3dir` 夹角 > 90° 就把 `p3dir` 换成那个方向（L2604-2607，防 P 点朝里）。

### 1.2 两种角度（`getmemP3dirangle` L2635-2757），容差 0.1°

参考系：`padir = adir`（取不到时 `ori.ydir`）；`xdir = padir ⟂ U` 的水平法向（`padir ∥ U` 时退到 `x is E, z is U`）；
`ydir = ori.ydir`（= `z × x`）；`plane(mempos, ori)` 是过原点、垂直管轴的平面。

| # | 名字（本稿） | 判据 | `dir1` | `dir2` | 含义 |
|---|---|---|---|---|---|
| (a) | **tilt**（对轴倾角） | `lineangle = angle(p1dir, p3dir)`，`|lineangle − 90| ∈ (0.1, 89.9)` | `p1dir`；`lineangle > 90` 时换 `p2dir`（若 `angle(p2dir, p3dir) ≤ 0.1` → 放弃，L2669-2671） | `p3dir` | 手轮 / 支管不垂直于管轴时，标它与管轴的夹角 |
| (b) | **rotation**（绕轴转角） | `projecteddir = p3dir` 投到垂直管轴的平面；与 `[xdir, ydir, −xdir, −ydir]` 的夹角升序，最小者 > 0.1° | 最近的那根轴；**最小夹角 < 30° 时改用次近的轴**（「避免太窄放不下文字」，L2725-2732） | `projecteddir` | 手轮 / 支管绕管轴偏离水平或竖直时，标偏转角 |

一个构件可以同时出 (a) 与 (b)。

### 1.3 数据对象 `isombdangle`（L26-72、`gettext` L74-104）

- `pos` = 构件原点；`aod` = `aod of mem`（ATTA 的 PAD / LUG 用 `2·(dist + routside)`，不迁）。
- `text` = `angle(dir1, dir2)` 按 `'d1'` 一位小数、`.real().string()` 去尾零，加 `°`（`45°` / `22.5°`）。
- `anglepos` = `pos.offset(dir2, aod/2 / |cos(angle(adir, dir2))|)`；`cos ≤ 0.01`（dir2 ⟂ 轴）时就是 `aod/2`（L59-71）。
  **注意**这不是几何上射线出管面的点（那该除以 sin），是 PML 的取法——照搬，写进 ADR。
- `linetext1 / linetext2` = `gettext(dir, 1)`：与 E / W / N / S / U / D 夹角 < 1° 给 `X / -X / Y / -Y / Z / -Z`；否则把 PML 方向串
  `E 45 N` 递归拆成 `X 45° Y`（五段串 `E 45 N 30 U` 先拆前三段再接 `30° Z`）。

### 1.4 绘制（`isoline.drawangle` L2848-2937）

- `radius = polarsystem.getgoodradius(object, cheight)`：以文字长 `textlen = mbdtextlen(text)·cheight` 为宽、沿 `bisect(dir1, dir2)` 延伸 `20·aod`
  的矩形当「可能放文字的区域」，收集与之相交的占位元素给出坏半径带；**没有障碍 → `textlen / 2`**（L923-925）；有障碍 →
  `getgoodradiusfrombadradiuss(bad, 1.2·cheight, textlen)`。后者 L1003-1015 的 `break` 结果在 L1018 被 `!goodradius = !diss2.last()`
  **无条件覆盖**——PML 实际行为是「半径 = 最外层坏带的外沿」。照搬还是按注释意图修正，见 §7 Q7。
- 两条腿：`anglepos → anglepos + dir·(radius + cheight/2)`，`dir ∈ {dir1, dir2}`（L2855-2856），对象 `mbdaidline`，function `元件偏转角度`。
- 弧：`arc(anglepos, ori(x = dir1, z = dir1 × dir2), 0, angle(dir1, dir2), radius)`（L2861-2864）→ `aidarc`。
- 角度文字：`anglepos + bisect·(radius + cheight/10)`，再沿 `offdir`（弧切向，按 `showdir` 选侧）挪半个文字长——因为 PML 文字原点是角点；
  再经 `getgoodori` 翻到可读的半圈（L2882-2888）。
- 两个方向小字（`linetext1 / 2`）：字高 `cheight/2`，位置 `anglepos + dir·(radius + cheight/2 + cheight/20)` 再挪半个字长（L2915-2936）。
- 进占位表的只有角度文字与两个小字（L2913 / L2935）；弧和腿不进（L2906-2908 注释掉了）。

### 1.5 优先级与归段

`getinstallationangles` 在 `draw` 里排第二（仅次于调整焊，L280-281）；`objects` 顺序 `adjustwelds → isombdangles → isoslopes → materials → tags →
welds → cutparts → branmlabel`（L1132-1140）；`putIntoIsoline` 把 ISOMBDANGLE **插到直段对象表最前**（L1288-1289，「让步」）——
即角度先画、主尺寸与标签绕开它。归段按成员：直通件归第一条含它的直段（与 Phase 5 ④ `assign_tag_owners` 同一规则）。

### 1.6 `aidarc` / `aidcircle` 与其它 producer

`aidarc {owner, name, pos, ori, radius, stangle, sweepAngle, function, desc}`（L18-30；`sweepangle = endangle − startangle`，L54）；
`aidcircle {pos, ori, radius, function, desc}`。管道范围里 `aidarc` 只有 `drawangle` 一个 producer；`aidcircle` 在 `markpipe` 下**没有** producer
（`markCivil` / `markEqui` / `suiSupport` / `instSupport` 用它画标号圈）。契约仍要一起定型：`CONTRACT_INCOMPLETE_KINDS` 三个一次清空，
不留第三次「半截契约」。

## 2. 本仓现状

- `src/dimension/adapters/mbdV2Contract.ts`：`MbdV2AngleDim { kind, id, text }`、`MbdV2AidArc { kind, id }`、`MbdV2AidCircle { kind, id }`（L73-109）；
  `isPrimitive` 对三者 `return false`（L254 / L265-267）；`CONTRACT_INCOMPLETE_KINDS`（L199-203）让拒收话术说「契约无几何」而不是「脏数据」。
- `mbdV2ExternalAnnotations.ts`：`isContractIncomplete` 防御跳过（L119-136 / L253-260），映射 switch 没有这三个 case。
- 内核已备：`ExplicitArcInput { center, normal, radiusM, startAngle?, endAngle?, part?, style? }`（`kernel/types.ts` L221-229，弧度；两角都省 = 整圆），
  `ExplicitLayoutInput.arcs`（L282），`layout/explicit.ts` L227-237 采样成 `scenePath`（`part ?? 'arc'`），painter / SVG / 命中 / 平移四处已接
  （verification 2026-07-20 M1）。**弧的 0° 参考轴是内核私有规则** `stablePlaneBasis(normal).u`（`geometry/planeBasis.ts`：法向偏离 Z 取 Z 否则取 X 的叉乘），
  文档写明「调整它必须同步 goldens」——契约不能依赖它，所以契约自带 `x_axis`，由适配层换算起始角。
- 用户尺寸侧另有 `angular` 归一化尺寸（`vertex / rayA / rayB / arcChoice`，`kernel/types.ts` L198-209，ADR 0024）；外部 MBD 尺寸与 `linear_dim`
  一样走 `ExplicitLayoutInput`，**不**复用 `angular`（那条会重新布局，违背「求解器决定摆位、前端 1:1 画」）。
- 测试现状：`mbdV2Contract.test.ts` L141 循环断言三 kind 被拒；`mbdV2ExternalAnnotations.test.ts` L56-66 断言 `contract-incomplete:` 话术；
  `DimensionPanelDock.test.ts` L174 / L188 用 `angle-1：contract-incomplete` 当 skipped 例子；`src/fixtures/mbd-v2/full-coverage.json` 三条只有 id。

## 3. 契约设计

### 3.1 共用弧框架（六个扁平字段）

| 字段 | 类型 | 单位 / 约束 | 含义 | PML 来源 |
|---|---|---|---|---|
| `center` | `Vec3` | `geometry_space` 坐标（现网 `source_mm`） | 弧心 | `aidarc.pos` = `arc.position`（角度尺寸 = `anglepos`） |
| `x_axis` | `Vec3` | 单位向量，非零 | 0° 方向 | `ori.xdir`（角度尺寸 = `dir1`） |
| `normal` | `Vec3` | 单位向量，非零，⟂ `x_axis` | 弧平面法向；正扫角从 `x_axis` 转向 `normal × x_axis`（右手） | `ori.zdir`（角度尺寸 = `dir1 × dir2`） |
| `radius` | `number` | 与 `center` 同单位，`> 0` 有限 | 半径 | `aidarc.radius` |
| `start_angle_deg` | `number` | 度，有限 | 起始角 | `stangle`（角度尺寸恒 0） |
| `sweep_angle_deg` | `number` | 度，`0 < sweep ≤ 360` | 扫角，`360` 即闭合 | `sweepAngle` = `endangle − startangle`（角度尺寸 = `angle(dir1, dir2)`） |

- **度**而不是弧度：PML / DB 属性 `STANGLE / SWEEPANGLE`、`text` 全是度，契约只在适配层换算一次；`linear_dim` 同理用 mm 而不是 m。
- 三个 kind 字段名相同，`isPrimitive` 共用一个 `isArcFrame(value)`，Rust 侧共用一个 `#[serde(flatten)] ArcFrame` 或直接展平字段（`contract.rs` 现有变体都是展平的）。

### 3.2 `angle_dim`（显式几何，与 `linear_dim` 同一路线）

```ts
export type MbdV2AngleDim = Readonly<{
  kind: 'angle_dim';
  id: string;
  text: string;                       // isombdangle.text，如 "45°" / "22.5°"
  center: MbdV2Vec3;                  // anglepos
  x_axis: MbdV2Vec3;                  // dir1
  normal: MbdV2Vec3;                  // dir1 × dir2
  radius: number;                     // getgoodradius 的结果
  start_angle_deg: number;            // 0
  sweep_angle_deg: number;            // angle(dir1, dir2)
  leg_lines: readonly MbdV2LineSegment[];   // 两条：anglepos → anglepos + dir·(radius + cheight/2)
  label_anchor: MbdV2Vec3;            // 文字中心：anglepos + bisect(dir1, dir2)·(radius + cheight/10)
  sub_kind?: string;                  // 'tilt' | 'rotation'（自由字段，与 linear_dim.sub_kind 同款；前端不解释）
}>;
```

- `label_anchor` 是**文字中心**（本仓 `ExplicitTextInput.anchor` 语义），PML 的「挪半个字长」不带进契约；`getgoodori` 的翻转由内核 `along` 自己做。
- 两个方向小字（`linetext1 / 2`）**不进** `angle_dim`：用现成的 `aid_text`（id `…:angle:<refno>:<sub_kind>:leg-text:1|2`）。理由：PML 本来就是独立
  `aidtext` 对象；内核 `texts` 没有字号（ADR 0044 一律屏幕像素高），「半字高」在本仓不可表达，塞进去也画不出区别。
- 不带 `reference`：PML 角度没有参考尺寸语义；`arrow_lines` / `arrows` 不带：PML 角度不画箭头。

### 3.3 `aid_arc`

```ts
export type MbdV2AidArc = Readonly<{
  kind: 'aid_arc';
  id: string;
  center: MbdV2Vec3; x_axis: MbdV2Vec3; normal: MbdV2Vec3;
  radius: number; start_angle_deg: number; sweep_angle_deg: number;
  style?: MbdV2AidLineStyle;          // 与 aid_line 同一枚举 solid | dashed | dash_dot
}>;
```

### 3.4 `aid_circle`

```ts
export type MbdV2AidCircle = Readonly<{
  kind: 'aid_circle';
  id: string;
  center: MbdV2Vec3; normal: MbdV2Vec3; radius: number;
  style?: MbdV2AidLineStyle;
}>;
```

### 3.5 Rust 侧（plant-mbd `contract.rs`，第二步同步）

```rust
AngleDim { id: String, text: String, center: Vec3V2, x_axis: Vec3V2, normal: Vec3V2, radius: f32,
           start_angle_deg: f32, sweep_angle_deg: f32, leg_lines: Vec<MbdV2LineSegment>, label_anchor: Vec3V2,
           #[serde(default, skip_serializing_if = "Option::is_none")] sub_kind: Option<String> },
AidArc   { id: String, center: Vec3V2, x_axis: Vec3V2, normal: Vec3V2, radius: f32, start_angle_deg: f32, sweep_angle_deg: f32,
           #[serde(default, skip_serializing_if = "Option::is_none")] style: Option<String> },
AidCircle{ id: String, center: Vec3V2, normal: Vec3V2, radius: f32,
           #[serde(default, skip_serializing_if = "Option::is_none")] style: Option<String> },
```

`tests/contract_guard.rs` 的 `FRONTEND_KINDS` 不变（还是 11 个 kind）；契约回环 fixture（`fixtures/contract/`）补三条带几何的样本，从本仓
`full-coverage.json` 拷贝——本仓 fixture 仍是权威（ADR 0043）。

### 3.6 校验（`parseMbdV2PipeData`）与映射（`mbdV2ToExternalRecords`）

校验（解析层，ADR 0046 fail-closed，只做结构与有限性，不做模糊几何）：`isVec3` × 各向量；`radius` 有限且 `> 0`；两个角有限；
`0 < sweep_angle_deg ≤ 360`；`x_axis` / `normal` 非零向量；`angle_dim.leg_lines` 是 `isLineSegmentArray`（长度不限，PML 给 2）；`style` 沿用 `isOptionalString`。
`CONTRACT_INCOMPLETE_KINDS` 变空后**删除**常量与 `primitiveRejection` 的那个分支（保留一个空数组只会留下死代码——followup 7-30 已经踩过一次「死代码话术」）。

映射：

| kind | `category` | `lines` | `arcs` | 文字 |
|---|---|---|---|---|
| `angle_dim` | `dimension`（`labelPinned: false`，与 `linear_dim` 同） | `leg_lines` → `part: 'extension'` | 一条，`part: 'dimension'` | `formattedLabel = text`，`labelAnchor = label_anchor`，`labelAlong` = 弧在中扫角处的切向 `normal × bisector` |
| `aid_arc` | `annotation` | — | 一条，`part: 'arc'`，`style` 经 `lineStyleFrom` | `formattedLabel: ''`，`labelAnchor` = 起点 `center + x_axis·radius`（同 `aid_line` 用 `start`） |
| `aid_circle` | `annotation` | — | 一条，两角都不给（内核整圆） | `formattedLabel: ''`，`labelAnchor = center` |

坐标变换（`source_to_design`，列主序 16 元素，`pointTransformer`）：`center` 走点变换；`x_axis` / `normal` 走方向变换（左上 3×3，再归一）；
`radius` = `|M₃ · (x_axis · radius)|`。现网矩阵只有 `diag(0.001)`；带旋转平移的钉子 fixture 是 `T·Rz·S(0.001)`（均匀缩放），
**非均匀缩放不在契约内**（那会把圆变椭圆，整包都不对，不单独为弧处理）。

角度换算：内核弧的 0° 在 `stablePlaneBasis(normal).u`，所以
`startAngle = atan2(x_axis·v, x_axis·u) + start_angle_deg·π/180`，`endAngle = startAngle + sweep_angle_deg·π/180`（`u / v` 来自变换后的 `normal`；
`x_axis` 先对 `normal` 做一次 Gram-Schmidt 再归一，平行退化只会来自内部构造的 payload，按防御跳过 `skipped` 处理，与现有 `Duplicate primitive id` 同一档）。
右手方向一致：内核 `v = n × u`，契约 `y = normal × x_axis`。

### 3.7 被否决的替代

| 替代 | 为什么不 |
|---|---|
| 三点弧 `start / end / center` | 扫角 ≥ 180° 歧义，仍要 `normal` 定向；与 PML 字段不 1:1，`aidarc.json` 的下游（TPlant）也是 pos / ori / radius / 角 |
| 嵌套 `arc: { … }` 子对象 | 与 `linear_dim` 的扁平风格不一致；TS / serde 两侧都要多一层校验；扁平 + 共用 `isArcFrame` 已经零重复 |
| 只给 `normal`、起始角相对内核参考轴 | 把内核私有规则（`planeBasis.referenceAxis`）钉进对外契约，内核一改 goldens 全世界跟着改 |
| `angle_dim` 语义式（`vertex / dir1 / dir2 / radius`，前端算腿与文字） | 前端要做摆位决定（腿长、文字位），违反 ADR 0043 / plant-mbd ADR-0003「排版确定性在求解器」；`linear_dim` 先例是显式几何 |
| 弧度 | PML / DB / 文字全是度，两侧各换一次反而多一次出错机会 |
| 腿拆成两条独立 `aid_line` | 一条角度散成 4 个图元，面板 / 命中 / 隐藏各自为政；`linear_dim` 把延长线打包的先例在前 |
| 复用用户尺寸的 `angular` 归一化尺寸 | 它会自己选优 / 劣弧与半径（ADR 0024），外部尺寸必须 1:1 |

## 4. 求解器侧（plant-mbd，契约落地后的第二步；本稿只定口径）

- 新模块 `angle.rs`：`collect_installation_angles(members) -> Vec<InstallationAngle { member, sub_kind: Tilt | Rotation, dir1, dir2, angle_pos, text, leg_texts }>`
  照 §1.1-1.3；`angle_primitives(...)` → 一条 `angle_dim` + 两条 `aid_text`。ids：`{bran}:isoline:{i}:angle:{refno}:tilt|rotation`、`…:leg-text:1|2`。
- **宿主要补一样数据**：`PPoint.bore: Option<f64>`（`serde(default)`；e3d-model `RoutePoint.bore` 已经有，`CataloguePoints::leave(member, Some(3))` 直接带出）——
  §1.1「P3 在 P1 轴线上要 bore 非零」用到。其余（P1 / P2 / P3 位置方向、`arrive_ppoint / leave_ppoint`、`arrive_dir`、`outside_diameter`）Phase 4 都有。
  ATTA 角度不做（要 `pipeatta` 的 PAD / LEG / LUG 几何分类，与 ATTA 焊缝同一未迁项）。
- 归段：直通件归第一条含它的直段（`layout::assign_tag_owners` 同款）。
- 顺序（L1288-1289）：在 `layout_isoline` 里 `seed_members` 之后、主尺寸 `best_placement` **之前**放角度，把角度文字与两个小字的文字框
  当非 basic 胶囊加进占位表（polar-lite `occupancy.rs`，ADR-0010）；弧与腿不进表（L2906-2908）。
- 半径：无障碍 `textlen / 2`；有障碍走 §1.4 的坏半径带——用占位表的元素代替 `getdiseles`，矩形 = `anglepos ± offdir·textlen/2` 沿 `bisect` 延伸 `20·aod`。
  `getgoodradiusfrombadradiuss` 的 L1018 覆盖问题见 Q7。
- `anglepos` 照搬 PML（`aod/2 / |cos(angle(adir, dir2))|`），ADR 写明它不是管面交点。
- 文字：`'d1'` 去尾零 + `°`（与 `format_dimension_text` 同族、一位小数）；方向小字按 `gettext` 规则（E/N/U → X/Y/Z，`E 45 N` → `X 45° Y`）。
- `meta.layout_mode` 不变（`isodim_main`），角度是附加图元。

## 5. 金样与测试

### 5.1 六条现有金样：零角度（实算，脚本按 §1.1-1.2 跑 `fixtures/field/*.json`）

| 金样 | 带 P3 的非 ATTA/ELBO/BEND 构件 | `angle(P1, P3)` | P3 方向 vs 参考轴 | 结果 |
|---|---|---|---|---|
| `24381_145018` | OLET `145032` | 90.00° | P3 = U，正落在 `ydir` | 不出 |
| `24381_145018` | VALV `145035` | 90.00° | P3 = E，正落在 `−xdir` | 不出 |
| `24384_26229` | VALV `26236` | 90.00° | P3 = U | 不出 |
| 其余三条 | 没有带 P3 的这类构件 | — | — | 不出 |

所以契约上线、求解器接上后，`golden diff` 六条**不变**；变的只有本仓 `full-coverage.json` 与 plant-mbd `fixtures/contract/`。

### 5.2 需要的新样本

- toy fixture `fixtures/p3-installation-angles.json`（plant-mbd）：① 手轮对轴倾 30°（tilt，dir1 = P1）；② 倾 120°（换 P2）；③ 绕轴转 45° 的手轮（rotation，
  从 X 量）；④ 转 20°（< 30° → 改从次近轴量 70°）；⑤ 90° 正轴（不出）；⑥ P3 在轴上无 bore（不出）；⑦ `arrive_ppoint = 3`（不出）；
  ⑧ 有主尺寸时角度文字先进表、主尺寸绕开。
- 真实金样候选：`24381_177565`（BEND 12 + COUP 4 + TEE + VALV，Phase 3 findings 列为候选）——`mbd_branch_dump` 导出后跑 §5.1 脚本看有没有偏转手轮；
  AvevaMarineSample 里可能一条都没有，那就 toy-only，写进金样 README。

### 5.3 本仓测试变化清单（契约那一笔）

| 文件 | 现在 | 改成 |
|---|---|---|
| `mbdV2Contract.test.ts` L141 | 三 kind 一律拒 | 缺几何拒（话术改为普通 `invalid primitive`）、合法接受；`sweep = 0 / > 360`、`radius ≤ 0`、零向量各一条拒收 |
| `mbdV2ExternalAnnotations.test.ts` L56-66 | `contract-incomplete:` 三条 skipped | 三条映射断言：`angle_dim` 出 1 arc + 2 extension lines + `labelAlong`；`aid_arc` 起始角换算（给一个 `x_axis` 与内核 `u` 不重合的例子，断言采样首点 = `center + x_axis·r`）；`aid_circle` 闭合 |
| `DimensionPanelDock.test.ts` L174 / L188 | `angle-1：contract-incomplete` | 换成 `Duplicate primitive id` 的 skipped 例子 |
| `src/fixtures/mbd-v2/full-coverage.json` | 三条只有 id | 补几何（`design_m`，米） |
| `source-to-design-translation.json` 用例 | 只测点 | 加一条 `aid_arc`：断言 `center` 走点变换、`normal` 只旋转不平移、`radius` 乘 0.001 |
| 内核 goldens | 弧原语 M1 时已有快照 | 若无 `part: 'dimension'` 的弧样例则补一张 |

## 6. 发布顺序（D7）

1. 本仓一笔：契约类型 + 校验 + 映射 + fixtures + 测试 + 新 ADR「MBD 弧类图元几何按 PML AIDARC 字段定型，起始角自带参考轴」；`CONTRACT_INCOMPLETE_KINDS` 退役。
2. plant-mbd 一笔：`contract.rs` 三个变体补字段、`fixtures/contract/` 从本仓拷新 fixture、`contract_guard` 回环；ADR-0011。此时求解器还不产出。
3. plant-mbd + gen-model 一笔：`angle.rs` + `PPoint.bore` + toy fixture + （若有）真实金样；`.planning` Phase 5 ⑤ 记录。
4. 顺序错了也不会画半截：前端没升级时求解器产出 `angle_dim` 会被 fail-closed 整包拒收（现有行为），所以 3 必须在 1 部署之后。

## 7. 待拍板

- **Q1** 角度单位：度（建议）/ 弧度。
- **Q2** 字段形状：扁平六字段（建议）/ 嵌套 `arc` 对象。
- **Q3** `angle_dim` 的腿：打包 `leg_lines`（建议）/ 独立 `aid_line`。
- **Q4** 方向小字：现成 `aid_text`（建议）/ 塞进 `angle_dim`。
- **Q5** `sweep_angle_deg` 允许 `= 360`（建议允许，但产出方对整圆一律用 `aid_circle`）/ 严格 `< 360`。
- **Q6** `CONTRACT_INCOMPLETE_KINDS`：删除（建议）/ 留空数组。
- **Q7** `getgoodradiusfrombadradiuss` L1018 无条件覆盖：照搬「半径 = 最外层坏带外沿」（PML 图纸对照口径）/ 按注释意图取第一个够宽的空隙（建议后者，记 ADR，因为前者会把角度弧推到离构件很远——与 ADR-0002「不出可能错的图元」同一取舍）。
