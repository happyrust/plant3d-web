# MBD 全量扫描：诊断逐类归类（2026-11-11）

只读调查，没有改代码、没有编译、没有提交。数据是 22:11 那一遍全量扫描（`.scratch/mbd-live-sweep/full-3`，7059 个候选、
6982 个数据包、82504 条诊断、34 种 `rule_id`）；归类时逐类看了求解器（`vendor/plant-mbd-livefix`）、宿主
（`gen-model/src/mbd`）与 PML（`vendor/MBD`）的源码，能在整类对象上数的都数了。每条结论后面标了核对程度：
**【数据】** = 在整类对象的负载 / 宿主输入 / 库属性上数过；**【代码】** = 读源码推出来的；**【未核对】** = 没有核对到。

配套：覆盖盘点、16 个模板站点、两套判型规则的对照在 [`coverage-inventory.md`](coverage-inventory.md)。

## 结论

1. **新发现一个真缺口（宿主）：管道焊缝的 DTXR 读不到，全库 1234 条 WELD 一条都没有。** 后果是 412 条车间焊被当成现场焊
   （125 条 BRAN；仪表管上 394 条的焊口号写成 `M#`，按 PML 该是 `A#`），1 条调整焊没被认出来——「调整焊」「调整焊附加长度」
   两类标注全库一次都没出现，原因是这个，不是库里没有数据。【数据】
2. **其余诊断没有再查出「该有却没有」的标注。** 条数最多的几类（`civil.member_off_face` 6.6 万条、`civil.member_shape_missing`、
   `locate.*`、`support.em4_no_pipe_atta`、`support.part_geometry_missing` 的 PJOI、`equipment.*`）逐类核对下来，都是 PML 在同样的
   数据上也不画，或者模型数据本身缺东西。依据见下面各节。
3. **诊断本身有三处说错了**：2943 条 `civil.member_shape_missing`（warning）其实是「这块埋板不在这面弧墙上」；
   `locate.single_wall` 对 EM4 支架说「保留了一条定位尺寸」而 EM4 支架根本不画墙定位尺寸；6 条 BRAN 的 422 说「成员都因缺几何被
   跳过」而这 6 条 BRAN 一个成员都没有。
4. **管道的 warning 九成在电缆桥架上。** 联调后端判成 `em4_pipe` 的 1822 条 BRAN 里 1382 条（76%）是电缆桥架（成员是 FTUB，
   等级 `/ACP1000-Trough`、`-Ventilated`、`-Ladder`…）；管道两类的 2878 条 warning 里 2569 条（89%）在它们身上。工艺管 440 条里
   带任何诊断的只有 58 条、没有线性尺寸的只有 1 条；桥架 1382 条里带诊断的 787 条、一条线性尺寸都没有的 134 条、44% 的直段是
   空的。桥架要不要按管道标，要用户定。
5. **扫描把同一个支架数了两遍。** ZONE 下的 REST 候选归到配对的 STRU，257 个 REST 候选的答复与 STRU 候选的相同。按归属对象
   去重：EM4 支架 2207 个（不是 2391），仪表管支架 92 个（不是 165），全库 6802 个归属对象（不是 7059）。

## 新发现的缺口与问题（按影响面排）

### 1. 管道 WELD 的 DTXR 宿主读不到（真缺口，在宿主修）

- 现象【数据】：导出全部 2425 条出了包的 BRAN 的宿主输入（`.dat` 直读，与联调后端同一份宿主代码），1234 条 WELD 的 `dtxr` 全是空。
  沿 PML 的口径 `SPRE → SPCO.DETA → SDTE.RTEX` 逐条读库：1217 条有文字——`WELD SITE` 614、`WELD SHOP` 395、`FIELD WELD` 121、
  `WELD FIELD FITTED` 39、`SITE WELD` 29、`SHOP WELD` 18、`FIELD AND ADJUST WELD` 1；另 17 条的 SPCO 没有 DETA。
- 原因【代码】：`gen-model/src/mbd/branch_query.rs` L359-362 对 WELD 用 `optional_text(&member, "DTXR")` 直接读属性。DTXR 是伪属性，
  库里不存；支架那一侧是对的（`support_query.rs::detail_text` 走 `SPRE → DETA → RTEX`）。
- 页面上的后果【数据，对着 `full-3` 的负载逐条数】：
  - 412 条车间焊（DTXR 含 `SHOP`；413 条里有 1 条本来就没有焊点标记）的 `weld_mark.weld_type` 是 `field`，涉及 125 条 BRAN
    （em9_pipe 394 条、em4_pipe 18 条）。PML `isobran.getwelds` L4209-4216 按 `dtxr of` 含 `SHOP` 判车间焊，L4585-4590 仪表管的
    焊口号车间焊写 `A`、其余写 `M`【都核对过】；求解器 `welds.rs` L102-106、L504 同。这 394 条现在写的是 `M2`、`M3`…，
    该是 `A2`、`A3`…。
    旁证：这 413 条 WELD 自己的 `SHOP` 属性也全是 `true`（另有 28 条 DTXR 不含 SHOP 而 `SHOP = true`）。
  - 1 条调整焊（BRAN `24383_76302` 的 WELD `24383_76303`，DTXR `FIELD AND ADJUST WELD`）没被认出来（PML `getadjustwelds`
    L2547-2548 按 `dtxr of` 含 `ADJUST` 认【核对过】）：这条 BRAN 没有「调整焊」符号（4 条 `aid_line`），主尺寸上也没有
    「调整焊附加长度」的「+N」。这两类 `function` 在全库是 0。
  - 管段号按现场焊切段也读 DTXR（含 `FIELD`），同样受影响；不过这个库没有图号 UDA，管段号本来就出不来（见覆盖盘点）。
- 建议：宿主把管道 WELD 的 DTXR 改成与支架同一条读法，补一条用真库的测试（`24383_76303` 该读出 `FIELD AND ADJUST WELD`）。

### 2. `civil.member_shape_missing` 有 2943 条报错了对象（诊断问题，在求解器修；不缺标注）

- 现象【数据】：这条 warning 共 3539 条 / 139 个土建对象，其中 2943 条落在 17 面弧墙（WALL）上、说的是 PANE（埋板）
  「has no usable shape (no edge lines / plate faces from the host)」。去重是 977 块板：这 977 块在别的墙板上全都被报过
  `civil.member_off_face`（说明宿主给了板面，面内检查都做过了），其中 736 块在别的墙板上标上了。
- 原因【代码】：`civil/members.rs::member_points` 对 AB 埋板走 `ab_plate`；埋板中心沿法向的探测线打不到这面弧墙的两道弧时
  `ab_plate` 返回 `None`，上层就报成「没有形状」。PML `civilMem.getABpanedata` L1907-1908 在同一处 `return`，构件没有 `cenpoints`、
  `markCivil.getDataOfMem` L1420 不收它——PML 是静默丢掉，与「不在面上」是一回事。
- 影响：标注没有少（这些板本来就不属于这面墙），但 17 面弧墙各带一两百条 warning，把真正要看的盖住了。
- 建议：`ab_plate` 返回 `None` 改报 `civil.member_off_face`（info），文字不要说宿主没给形状。

### 3. 三面墙模板被当成定位墙（模型数据 + 宿主候选没有排除模板世界，影响 34 台设备）

- 现象【数据】：`data.view_issue` 里 116 条「STWALL … 没有 SPRE：截面按 DESP [300, 2000] 矩形」说的只有三面墙：
  `15201_379`、`15201_380`、`15201_381`。它们在模板世界里（`TPWL /Concrete_Template_World › TMAR /Concrete_Template_Area ›
  TMPL /Y-Wall`，一个 Y 形墙的模板，放在原点）。35 台 em9 设备、1 台 em4 设备、3 块建筑楼板、2 块土建楼板的找墙候选里有它们。
- 后果【数据】：34 台 em9 设备（都是放在世界原点附近的复制件，坐标标签写 `X 0 / Y 0`）把 `15201_379` 当成东西向定位墙：
  各出一条写着 `/Y` 的「定位墙体」标签；33 台的垂足离基准点不到 1 mm，定位尺寸判退化（`locate.dimension_degenerate`），
  另一向没有墙，结果一条定位尺寸都没有。
- 归类：模型数据（复制件没摆位、模板放在原点）。PML `mbdlocation.getconindir` L704-706 的 `coll all (stwall gwall wall) within`
  会不会收到模板世界里的墙【未核对】；建筑的 `drawarchwalls` L1823 带 `name of site` 的过滤，没有 SITE 的元素过不了【代码】。
- 建议：宿主的找墙候选（`civil_faces::locate_candidates`、楼板旁的墙）排除属主链上有 TPWL / TMPL 的墙板；优先级低。

### 4. 首尾坐标是原点的 BRAN：连接标签写 `X 0 / Y 0 / PE 0`、引线拉到世界原点（模型数据，8 条）

- 【数据】宿主输入里 `head_pos` 或 `tail_pos` 是 `(0,0,0)` 的 BRAN 全库 8 条：`24381_101412`、`24381_177515`、`24381_177530`、
  `24383_84825`、`24383_84876`、`24383_85271`、`24383_97900`、`24383_99159`（5 条是桥架，4 条首尾都在原点）。8 条都出了
  锚在原点的「连接信息」标签。页面层代理从可疑 LOD 记录里看到了其中 3 条。
- 归类：模型数据（HPOS / TPOS 没设）。PML 同样取 `hpos / tpos of bran`【代码，`isoDim.addmem` L467-473】。要不要在求解器里
  对「端点在原点、且与相邻成员不相接」的 BRAN 不出端点标签、留一条诊断，由求解器代理判断。

### 5. 扫描口径：REST 候选与 STRU 候选是同一个支架

- 【数据】按 `annotation_type + subject.refno` 去重：em4_supp 2391 个数据包 = 2207 个归属对象（184 对 REST + STRU），
  em9_pipe_supp 165 = 92（73 对）。257 对的结局、图元数、诊断数两两相同。
- 对已有数字的影响：`empty_em4_supp_no_parts` 的 44 = 22 个支架；em4_supp 空包 190 = 169 个；em4_supp 走通 2140 = 1977 个；
  `support.em4_no_pipe_atta` 950 条 = 778 个支架。README 表里的支架两行是候选数，不是支架数。

### 6. 两处诊断文字不准（顺手改）

- `locate.single_wall`（warning）在 EM4 支架上出现 156 次，说「the one locating dimension is kept」。EM4 支架不画墙定位尺寸
  （PML `suiSupport.getdimlines` L1939 `needwalllocation = false`，求解器 `support/em4/mod.rs` 头注同）：找墙结果只用来定参考
  视向和收附近墙体。这 156 条 warning 没有对应任何图元。【代码 + 数据：2207 个 EM4 支架里只有 24 个有「定位尺寸」，
  那是没有组线时相邻附件之间的间距（class 5），不是到墙的尺寸；其中 22 个在型钢全被跳过的 `/1RX03-MSUP` 区】
- 6 条 BRAN 的 422（`adapter.no_members_with_geometry`）说「every branch member was skipped for missing geometry」。
  这 6 条 BRAN 在模型树里一个成员都没有（`GET /api/v1/tree/children` 返回 0 个；`32573_1`、`24381_101408`、`24381_177395`、
  `24383_101287`、`24383_101220`、`24384_26204`，后三条里两条名字是 `/CODEX-ISSUE18-RETEST2`、`/test-inc`）。【数据】
  空 BRAN 的首尾又连不成管（`24381_177395` 的信封里另有一条 `Head -> Tail 51953.6 mm, 116.94° off`），本来没有东西可标。

## 归类总表

四类：**(a)** 与 PML 一致的正常情况；**(b)** 宿主没给数据；**(c)** 求解器没实现或主动不画；**(d)** 模型数据本身的问题。
「对象数」是数据包数（支架含重复的 REST 候选，去重数写在括号里）。按「对象数」排。

| rule_id | 级别 | 条数 | 对象数（按类型） | 归类 | 页面上少了什么 | 依据与核对程度 |
|---|---|---|---|---|---|---|
| `locate.no_wall` | info | 1773 | 1773：em4_supp 1250（1238）、em9_equi 372、em4_equi 151 | (a) | 设备：没有到墙的定位尺寸与墙名（一条定位尺寸都没有的设备 em9 405 台、em4 153 台，含下两行的情形）；支架：不少任何图元 | 50 m 内五条射线上没有 STWALL / GWALL。PML `mbdlocation.getdimdata` L582-626 六环找墙、`drawenDim` L1213-1216 两面墙不齐就一条不出【代码，PML 行号核对过】。宿主候选有没有漏墙没有独立核对；设备找到的墙来自 1112、7997 两座库（另有模板墙），说明这两座库的 SPAMAP 都读到了【数据】 |
| `equipment.elconn_missing` | info | 1132 | em9_equi 951、em4_equi 181 | (a) | 不少：基准点退到设备原点 | PML `markEqui.pmlobj` L107-112 同一退路【代码，核对过】 |
| `locate.near_wall` | info | 1506 | 951：em9_equi 407、em4_supp 426、em4_equi 118 | (a) | 设备：这个方向没有定位尺寸；支架：不少 | 最近的是弧墙 WALL。PML `getconindir` L846-867 只把 WALL 记进 `nearwalls`、这个方向不再找【代码，核对过】 |
| `support.em4_no_pipe_atta` | info | 950 | em4_supp 950（778） | (a) + (d) | 没有「管道信息」「管道中心标识」，没有参考视向。PML 在这里整个支架报错停画 | PML `addattatopartobjects` L3709-3721 按名字前缀收 ATTA、读不到 SPREF 的跳过；`getlocationposition` L2336-2346 没有就不建 `mbdlocation`，L2388 在未设的对象上取 `getlookdir` 出错【代码，核对过】。整类核对【数据】：778 个里 746 个宿主输入没有任何管道附件、32 个只有带几何的附件；746 个里 133 个支架无名，524 个库里没有同名前缀的 ATTA，89 个（全是暖通支架）名下的 178 个 ATTA `SPRE` 全是空引用 |
| `support.part_geometry_missing` | info | 2258 | em4_supp 855（854） | 见下 | 见下 | 三种构件分开看 |
| 　└ SCTN：no usable section data | | 1149 | 337 个支架 | 宿主代理在查 | 型钢的一级尺寸（146 + 60 + 131 个，见 README） | 宿主输入里 `has_spref = false` 的 SCTN 正好 1149 根、分布在 337 个支架上【数据】，与宿主代理的初步发现一致。只计数，不深挖 |
| 　└ PJOI：no usable bolt geometry | | 1107 | 589 个支架 | (d) | **不少标注**：EM4 里构件对象只当摆位障碍与视向取点（PML `suiSupport.getparts` L1045-1072 → `planesystem`），不产生尺寸 | 宿主输入里这些 PJOI 的 P 点号是 `0,1,2,3,4` 1096 个、`0` 10 个、`0,1,2` 1 个，合计正好 1107，都没有 P5；有 P4 + P5 的 321 个不报【数据】。目录件是 `/ACP1000-ELEC-JT*`、`-GB-*`（桥架支架的节点、底板），不是螺栓。PML `suppbolt.pmlobj` L27-33 取 `p5 pos` 会出错【代码】 |
| 　└ HROD：no usable LCYL geometry | | 2 | 2 | 【未核对】 | 同上，不产生尺寸 | 没看 |
| `adapter.implied_tube_not_drawn` | warning | 1777 | 760：em4_pipe 691、em9_pipe 68、422 信封 1 | (d) | 这一段没有合成直管成员：坡度符号、管道名称不会落在这段上；两端的管件仍是尺寸点，尺寸照出（除非落到下面 `linear.point_off_axis`） | 宿主 `branch_query.rs::push_implied_tube` 按 e3d-model `slot_alignment`（横偏 < 1/1000 轴向且 ≤ 1 mm）判 E3D 画不画隐含管；阈值的依据是 e3d-model 注释里记的 RVM 对拍【未核对，引用】。1777 条里 1653 条在电缆桥架上；偏角 ≥ 90°（下一件的入口在上一件出口的后面）的 em4 有 1331 条。样本 `24383_82766` 的 `HPOS` 与首件 `POS` 相距正是诊断里的 360.5 mm【数据：读了原始属性】 |
| `locate.single_wall` | warning | 503 | em9_equi 307、em4_supp 156、em4_equi 40 | (a)，求解器比 PML 多画 | 不少。设备：PML 两条都不出，求解器照出找到的那一条（裁决 D-EQUI-002）；EM4 支架：文字不准，见上「6」 | PML `drawenDim` L1213-1216【代码，核对过】 |
| `civil.member_off_face` | info | 66565 | 456：civil 440、arch 16 | (a) | 这个构件不在这块墙板的面上，不标。去重 6470 个构件：5451 个在别的墙板上标上了，1019 个在任何扫到的墙板上都没标上（PANE 661、NXTR 156、SBFI 145、NCYL 31、NRTO 10、FITT 7、NBOX 5、FIXING 4） | 66565 条里 66207 条是 PANE：PML `getDataOfMem` L1365-1372 把 `!!getabakt` 找到的 AB / AK / AT 框架下的全部 PANE 都拿来试（同一组墙共用一批埋板，一块板被中位 12 块墙板各试一次），`civilMem.checkifok` L1754-1781 不在面上的清掉、L1420 不收【代码，核对过】。1019 个哪都没标上的，PML 是否同样全丢【未核对】 |
| `isodim.member_off_axis` | warning | 594 | 302：em4_pipe 278、em9_pipe 24 | (a) | 这个管件不进尺寸点（少一个点，相邻两段并成一段）；594 条里 318 条所在的直段最后没有任何尺寸 | PML `isoDim.addmem` L635-675：水平直段上原点与两端口都偏出 `od × 2/3` 时打「请检查该元件…顺序或坐标」后 `return true`、不进点【代码，核对过】。512 条在桥架上 |
| `linear.point_off_axis` | warning | 300 | 292：em4_pipe 262、em9_pipe 30 | (c)，已登记（ADR-0012）+ (d) | 断口对面的尺寸点（多半是 Tail）删掉；300 条里 272 条所在的直段最后没有尺寸 | 求解器主动不画：PML 会量出压缩投影（ADR-0012 的问题陈述）。251 条在桥架上。只读了 ADR，没有对 PML 复核 |
| `locate.civil_label_skipped` | info | 194 | em9_equi 192、em4_equi 2 | (a) | 没有「定位楼板」的楼板名（标高、厚度照出） | 楼板的属主是无名的 CFLOOR。PML `addConInfo` L1456-1457 取属主名倒数第二段，无名元素的名字是 `=w0/w1`（PML 自己在 `mbdStru.pmlobj` L112 / L126 按首字符 `=` 判无名），取不出这一段【代码】。PML 实际画出空字符串还是报错【未核对】 |
| `civil.member_shape_missing` | warning | 3539 | civil 139 | (a) + (d)；2943 条报错了对象 | 596 个目录件（FITT 400、FIXING 175、PFIT 15、SBFI 5、NXTR 1）不标孔洞尺寸、编号、名称；PANE 的 2943 条不少标注 | PANE 见上「2」。596 个目录件读了原始属性【数据】：443 个 `SPRE` 未设、109 个指到 TEXT `/FBAR-Profiles-GMSS`、36 个的目录件 `/CIR-W` 只有 SREV / NSRE、3 个 SPCO `/Openings-Spec/Circular/1` 没有 CATR、3 个门 `DESP[1] = 0`、1 个指到 SPRF、1 个 NXTR 的环没有顶点。PML `civilMem.getCataData` L1397-1418 只认 GMSE / NGMS 下的 NLCY、NSBO、NSEX，取不到就没有形状、L1400-1402 打「得不到形状」后跳过【代码，核对过】；宿主 `civil_query.rs::pick_primitives` 是同一套挑法【代码】 |
| `isodim.atta_before_first_point` | warning | 100 | 94：em4_pipe 88、em9_pipe 6 | (a) | 这条直段的尺寸整条不出（100 条里 98 条所在直段没有尺寸） | PML `isoline.getAttaDims` L1112-1118：ATTA 在首个尺寸点之前，打「请检查…Please check the position/order of ATTA」、记 `wronglines` 后返回【代码，核对过 L1112-1118；「整条直段不画」没有逐行核对】。92 条在桥架上 |
| `data.view_issue` | warning | 169 | 80 | 混合 | 见下 | 宿主视图的说明原样转出 |
| 　└ STWALL 没有 SPRE，按 DESP 矩形 | | 116 | 41 | (d) | 见上「3」 | 只有三面模板墙【数据】 |
| 　└ SCTN 的截面目录链断（SPRE 悬空） | | 22 | em4_supp 9 | (d)，宿主代理在查 | 这几根型钢没有截面 | 引用的目录件不在库 5052 的索引里。只计数 |
| 　└ REST 配不到 STRU | | 21 | em9_pipe_supp 19、em4_supp 2 | 宿主代理在查 | 7 个空包在其中 | 只计数 |
| 　└ 墙板的面读不出（环没有顶点、没有 PLOO、DESP 不全…） | | 10 | civil 7、arch 2 | 求解器 / 宿主代理在查 | civil / arch 空包 | 只计数 |
| `civil.dim_degenerate` | warning | 696 | civil 58（FLOOR 56） | (c) | 投影长度约为 0 的尺寸段不画（孔洞尺寸 610 条、墙段 / 外露边 86 条） | 求解器 `civil/emit.rs` L368-374：LINDIM 里长度不可靠的段不出、留一条诊断【代码】。PML 在零长度段上画什么【未核对】 |
| `locate.dimension_degenerate` | info | 37 | em9_equi 35、em4_equi 2 | (d) | 一条定位尺寸（垂足离基准点不到 1 mm） | 33 条是模板墙 `15201_379`，见上「3」【数据】 |
| `equipment.nozzle_without_p1` | warning | 236 | em9_equi 22、em4_equi 2 | (d) | 不少：这只管口不当偏转角的参照，换下一只或设备方位轴。PML 在这里整台设备不出 | 236 只管口读了原始属性：`CATR` 全是空引用【数据】。PML `getnozzdim` L639-641 取 `p1 dir` 没有 handle【代码，核对过】 |
| `linear.member_off_axis` | warning | 23 | em4_pipe 23 | (c)，已登记（ADR-0002） | 跨过偏轴成员的尺寸段不画；23 条直段都没有尺寸 | 全在桥架上【数据】。只读了诊断文字，没有对 PML 复核 |
| `civil.arch_round_member` | info | 40 | arch 18 | (a) | 圆形的 NXTR 建筑不标 | PML `getDataOfMem` L1404-1408【代码，核对过】 |
| `tag.branch_name_no_isoline` | warning | 17 | em4_pipe 17 | (a) | 没有管道名称标签 | PML `isobran.putintoisoline` L1195-1197「Cant find good isoline」后 `skip`【代码，核对过】。全在桥架上 |
| `isodim.segment_unreliable` | warning | 19 | 14：em4_pipe 9、em9_pipe 5 | (c) | 投影长度约为 0 的主尺寸段不画 | 【未核对】 |
| `civil.arch_floor_only` | info | 12 | arch 12 | (a) | 建筑窗体只标楼板，STWALL 不出图 | PML `markCivil.drawarch` L1679-1681【代码，核对过】 |
| `adapter.member_directions_missing` | warning | 10 | em4_pipe 9、em9_pipe 1 | (d) | 成员没有方向，轴从邻件推（下一行） | 10 个成员读了原始属性：`SPRE` 全是空引用【数据】 |
| `linear.axis_inferred_from_neighbour` | warning | 11 | 7 | (d) | 不少：端口轴从相邻件反推，留痕 | 同上那批成员【数据】 |
| `linear.segment_spans_kink` | warning | 7 | em9_pipe 5、em4_pipe 2 | (c)，已登记（ADR-0012） | 跨断口的一段尺寸不画 | 只读了 ADR |
| `kd_points.atta_side_missing` | warning | 14 | em4_pipe 6 | (d) | 挡块 ATTA 只取原点一个尺寸点，不取两侧 | 求解器要 P101 的方向与 `PARA[9]`。四种挡块目录件里查了两种（`/NPTD2Sch160-A`、`/NPTE6SchAPI-C`，占 14 条里的 10 条）：P 点集是 1–18 / 3–10，没有 P101【数据】 |
| `adapter.no_members_with_geometry` | error | 6 | 422 信封 6 | (d)；文字不准 | 空 BRAN，没有东西可标 | 见上「6」【数据】 |
| `civil.geometry_missing` | error | 6 | civil 5、arch 1 | 求解器 / 宿主代理在查 | 整块墙板空包 | 只计数 |
| `split.geometry` | warning | 3 | em4_pipe 3 | (d) | 同 `adapter.member_directions_missing` | 同一批没有 SPRE 的成员【数据】 |
| `support.atta_far_apart` | warning | 2 | em4_supp 2 | (a) | 不少：提示附件名字可能写错 | PML `getlocationposition` L2352-2362【代码，核对过】 |
| `welds.no_isoline` | warning | 2 | em9_pipe 1 | (a) | 2 个焊点不画 | PML L1250-1251「Cant find good isoline」【代码，核对过】 |
| `support.no_parts` | info | 1 | em9_pipe_supp 1 | 宿主代理在查 | 空包 | 只计数 |
| `polar.neighbour_bad` | warning | 1 | em9_pipe 1 | (a)，求解器比 PML 宽 | 不少：PML 整条 BRAN 失败，求解器只少放一组障碍 | PML `isobran.pmlobj` L1738 / L1767「pre isoline is bad」【代码，只核对了这句话在那里】 |
| `legs.no_isoline` | info | 1 | em4_pipe 1 | (a) | 1 条支腿尺寸 | 同「Cant find good isoline」 |

模板站点里另见一种这里没有的：`legs.geometry_missing`（warning，8 条 / 1 条 BRAN `23705_5150`）——支腿轴与 ATTA 的离开方向平行，
支腿尺寸不出；诊断说 PML 在这里整条 BRAN 停画【未核对】。

没有出现的：`layout.not_implemented`（一种标注类型还没有布局实现）一次都没出现；`contract.invalid_primitive` /
`contract.invalid_isoline` 是出口自检的规则，联调后端的求解器还没有它们。

## 按对象类别看

### 管道（em4_pipe 1822、em9_pipe 603；另 6 条 422）

用模型树逐条读了全部 2431 条 BRAN 的成员类型【数据】：1382 条含 FTUB，就是 `/1RX-ELECBJ`（823）、`/1RX03-EQUI`（449）、
`/1RX03-PIPEBJ`（110）三个站点里 LCT / MCT 区的电缆桥架，一条不多一条不少；等级全是 `/ACP1000-*`（Trough 522、Ventilated 355、
Ladder 231、Riser 118、Cable 56、各种 Divider 100）。gen-model `options.rs` 里把 ELEC 站点的 BRAN 留成 `em4_pipe` 的理由是
「金样 `24383_99996` 是真管道」——它是 `/LV-GR-1RX215-B`，成员是 10 根 `/ACP1000-Ventilated` 的 FTUB，是一条通风桥架。

| 群 | BRAN | 走通 | 直段 | 空直段 | 没有任何线性尺寸 | 带任何诊断 |
|---|---|---|---|---|---|---|
| em4 工艺管（`/1RCV-PIPEBJ` 238、`/1WCC-PIPEBJ` 193、其它 9） | 440 | 438 | 2073 | 315（15%） | 1 | 58 |
| em4 电缆桥架 | 1382 | 1374 | 5716 | 2490（44%） | 134 | 787 |
| em9：`/1PTU-INST23` 里复制的工艺管 | 573 | 572 | 4090 | 484（12%） | 0 | 67 |
| em9：`/1TTU-INST23` 的仪表管 | 30 | 30 | 266 | 12（5%） | 0 | 25 |

各条管道诊断在四群里的分布（对象数 / 条数）：

| rule_id | em4 工艺管 | em4 桥架 | em9 `/1PTU` | em9 `/1TTU` |
|---|---|---|---|---|
| `adapter.implied_tube_not_drawn` | 22 / 31 | 669 / 1653 | 49 / 70 | 19 / 22 |
| `isodim.member_off_axis` | 20 / 28 | 258 / 512 | 12 / 26 | 12 / 28 |
| `linear.point_off_axis` | 19 / 19 | 243 / 251 | 24 / 24 | 6 / 6 |
| `isodim.atta_before_first_point` | 2 / 2 | 86 / 92 | 4 / 4 | 2 / 2 |
| `linear.member_off_axis` | — | 23 / 23 | — | — |
| `tag.branch_name_no_isoline` | — | 17 / 17 | — | — |

桥架为什么这么多：样本 `24383_82766`（原始属性）`HPOS` 在标高 3300，第一根 FTUB 的 `POS` 在 3000、水平再差 200 mm，
尾端同样——BRAN 的首尾与成员不在一条线上，E3D 不画那段隐含管，后面的成员整体偏出首直段的轴。这是这批桥架模型的画法，
不是读错了（宿主算出的「360.5 mm」就是这两个原始坐标的距离）。只看了这一个样本，没有在 1382 条上逐条核对。

### 支架（em4_supp 2207 个归属对象、em9_pipe_supp 92 个）

- 没有点附件的 778 个、PJOI 的 589 个：见总表，都与 PML 一致或是模型数据，不缺标注。
- 型钢没有截面数据的 337 个：宿主代理在查。按区：`/1RX-ELECBJ` 无名 ZONE 124 个（全部空包）、`/1RX03-PIPEBJ /1RX03-MSUP`
  124 个（42 走通 / 22 空包 / 60 拒收，没有一个有一级尺寸）、`/1RX-ELECBJ /1RX02-LSUP` 80 个、暖通两个区 9 个。
- em9_pipe_supp 只出「一级尺寸」，没有标签：「支架功能」要的 `:ZD_BZBM` 这个库的字典里没有（见覆盖盘点）。

### 设备（em4_equi 212、em9_equi 951）

| 找墙结果 | em4_equi | em9_equi | 页面上 |
|---|---|---|---|
| 南北、东西两面墙都有 | 21 | 272 | 两条定位尺寸 + 两个墙名（em9 有 2 台只出了 1 条，另一条垂足与基准点重合） |
| 只有一面 | 40 | 307 | 一条定位尺寸 + 一个墙名（PML 不画，求解器保留）；其中 em4 2 台、em9 33 台垂足与基准点重合，尺寸判退化，0 条 |
| 一面都没有 | 151 | 372 | 没有定位尺寸；其中 em4 75 台、em9 128 台有方向被弧墙挡住（`locate.near_wall`） |

按定位尺寸条数：em4 0 / 1 / 2 条 = 153 / 38 / 21 台，em9 = 405 / 276 / 270 台。下方楼板：em4 196 台、em9 931 台找到了；
「定位楼板」名字 em4 194 台、em9 739 台（差的 2 + 192 台是无名 CFLOOR）。设备名、坐标、偏转角每台都有（em9 694 台、
em4 187 台是角度，em9 257 台、em4 25 台只有轴线）；24 台带 `nozzle_without_p1` 的也在其中。【数据】

### 土建 / 建筑（civil 734、arch 104）

- 构件类的两条大诊断见总表与上面「2」。
- 去重后被标注过的构件（孔洞、埋件、埋板、门）8850 个。
- 建筑：FLOOR 91 块里 45 块有图元；STWALL 13 面全是空包，其中 12 面是「建筑只标楼板」，1 面读不出面。

## 已有人在查的（只归类计数，没有深挖）

| 问题 | 数（候选 / 去重） | 我这边数到的 |
|---|---|---|
| SCTN 没有可用的截面数据 | 337 个支架，1149 条 | 宿主输入里 `SPRE` 未设的 SCTN 正好 1149 根 / 337 个支架 |
| 没有零件的 EM4 支架 | 44 / 22 | 22 个支架各被 STRU、REST 两个候选指到 |
| em9_pipe_supp 空包 | 7 / 7 | 都是配不到 STRU 的 REST |
| BRAN 422 | 6 | 6 条都没有成员 |
| EM4 支架字高 0、三面墙、arch / civil 空包 | 61（去重 61）、3、59 + 5 | 没有新增信息 |

## 没有核对到的

- e3d-model 判「E3D 不画这段隐含管」的阈值，引用的是它自己注释里的 RVM 对拍，我没有复核。
- 宿主找墙候选有没有漏墙（SPAMAP 没有表的库会被安静跳过）：只从「找到的墙来自哪些库」侧面看了，没有独立重算。
- 1019 个哪块墙板都没标上的土建构件（PANE 661 等）PML 是否同样全丢。
- PML 在这些情形下实际画什么：无名属主的楼板名、零长度的尺寸段、模板世界里的墙。
- `isodim.segment_unreliable`、`linear.member_off_axis`、`linear.segment_spans_kink`、HROD 的 2 条：只读了诊断文字或 ADR。
- 走通的对象画得对不对（位置、内容、遮挡）不在这份归类的范围里。

## 数据与脚本

都在 `.scratch/mbd-multitask/triage/`（没有入库）：

- `a01-issues.mjs` / `a02-print-patterns.mjs`：按 `rule_id` 汇总全部诊断与消息模式（`out/issues-by-rule.json`）。
- `a05-supports.mjs`：支架按归属去重、按区统计；`a07` / `a08` / `a10`：管道整类与分群；`a09`：逐条 BRAN 的成员类型；
  `a11`：设备找墙；`a12` / `a13`：土建构件去重与「标上 / 没标上」。
- `a14-support-views.mjs`：读宿主代理导出的全部支架输入（`host/views-all`）；`a18-bran-views.mjs`：读我导出的全部 BRAN 输入
  （`views-bran/`，用宿主代理的 `dump-objects.ps1`，`.dat` 直读）。
- `probes/*.jsonl`：用宿主代理的 `probe-subtree.ps1` 读的原始属性（89 个支架名下的 ATTA、596 个缺形状的目录件、236 只管口、
  1234 条 WELD 及其 SPCO / SDTE、几条目录链）；`a17` / `a19` / `a20` 是它们的汇总。
- 联调后端 23:14 换过一次二进制。上面的数都来自换之前的 `full-3`；换之后我抽了 619 个对象
  （全部不是走通的 + 每类 60 个走通的）重取，答复逐字节相同；全量重扫的结论也是 7059 个全部相同。
