# 宿主（gen-model）管道与找墙这一侧的发现与修正（2026-11-11 23:53 – 11-12 01:55）

宿主（管道侧）代理（hostpipe）的交回，对应 [issue-triage](issue-triage.md)「新发现的缺口」第 1、3 条。岔路口自己定的，都列在「需要用户拍板的」里。

**口径**：管道（2425 条 BRAN）、设备（1163 台）没有重复计数。支架按扫描条目是 2556 个（按归属对象去重 2299 个），
土建 / 建筑 838 个。

**每条结论后面的括号**：「核对过数据」= 在整类对象上从 `.dat` 的原始属性、宿主输入或数据包里数出来的；「读代码推断」= 读
PML / Rust 源码得出、没有跑过。**PML 一行都没有实机跑过**（没有 E3D 环境），凡是「PML 会怎样」都是读源码。

## 1. 结论

任务书给的两条都查实、修了、在整类上验证了。查的过程里又发现两处管道侧的宿主缺口（任务书之外），其中一处影响面比原来
两条都大，也一并修了，各自单独一笔提交。

| # | 问题 | 影响（核对过数据） | 处理 |
|---|---|---|---|
| 1 | 管道 WELD 的 `DTXR` 按属性名读、读不到（任务 1） | 1234 条 WELD 的文字全空：413 条车间焊标成现场焊、395 条焊口号前缀错、全库唯一的调整焊认不出 | 已修 `eff7d5fbd` |
| 2 | **管道的 Head / Tail 交给求解器时是属主系的原值，不是世界系**（新发现） | 340 条 BRAN（14%）的首末点错位：少 536 条线性尺寸、多 360 条诊断、连接标签里的坐标写错 | 已修 `21bec9bdc` |
| 3 | 焊口号 UDA `:ZD_WLDN` 只给 WELD 读，ATTA / KD 管件不读（新发现） | AMS 没有这个 UDA，本库零影响；带它的项目上 ATTA 与 KD 的焊点永远没有编号（读代码推断） | 已修 `1308e46d7` |
| 4 | 找墙候选里混进模板世界的三面墙（任务 2） | 36 台设备、5 块楼板：34 台把模板墙当定位墙，真墙被挡在后面；1 块楼板多 15 个图元 | 已修 `2c50ea7a2` |

### 0. 离线这条路在整类上等同联调后端（核对过数据）

用**没改过的**宿主（`e8636c4a6`）编的导出工具从 `.dat` 直读全部对象的求解器输入，再用联调后端里的求解器版本（`47eb83e`）的
CLI 重算，与 22:11 全量扫描存下的联调后端的答复（`full-3\payloads`）深比较（只忽略 `input_refno` 与 `meta.source_version`，数值按 f32
相等比）：**管道 2425 / 2425、设备 1163 / 1163、支架 2556 / 2556、土建 / 建筑 838 / 838 相同**，共 6982 个。所以下面
「改动前」的数就是联调后端现在的样子，「改动后」是换上这四笔之后会变成的样子。

### 1. 管道 WELD 的 DTXR（任务 1）

**复核**（核对过数据，数与 triage 逐项相同）：

- 全部 2425 条 BRAN 的宿主输入里有 1234 条 WELD 成员，带 `dtxr` 的 0 条。
- 探针直接读这 1234 条 WELD 的 `DTXR` 属性：1234 条都是「模板里没有」（`UnknownAttribute`）。
- 沿目录链读：1234 条的 `SPRE` 都指到 SPCO（109 个不同的）；103 个 SPCO 的 `DETA` 指到 SDTE（7 个不同的），6 个 SPCO 没有
  `DETA`。按 `SPRE → SPCO.DETA → SDTE.RTEX`，有文字 1217 条：`WELD SITE` 614、`WELD SHOP` 395、`FIELD WELD` 121、
  `WELD FIELD FITTED` 39、`SITE WELD` 29、`SHOP WELD` 18、`FIELD AND ADJUST WELD` 1；另 17 条的 SPCO 没有 `DETA`。
- 含 `SHOP` 的 413 条：em9_pipe 395 条（117 条 BRAN）、em4_pipe 18 条（8 条 BRAN），共 125 条 BRAN。这 413 条 WELD 自己的
  `SHOP` 属性也全是 `true`（另有 28 条文字不含 SHOP 而属性是 `true`，都在 em4）。

**根因**（核对过数据）：`src/mbd/branch_query.rs` 对 WELD 用 `optional_text(&member, "DTXR")`。`DTXR` 是 E3D 查询时现算的
伪属性，设计元素的模板里没有；「可选属性」的读法把 `UnknownAttribute` 读成「没有」、不报错，所以一直安静地空着。支架那边
`support_query.rs::detail_text` 走的是对的（`SPRE` 是 SPCO 时取 `DETA` 的 `RTEX`）。

**PML 依据**（读代码；`vendor\MBD\markpipe\object\`）：

| 用处 | PML | 求解器 |
|---|---|---|
| 车间焊 / 现场焊 | `isobran.getwelds` L4209-4216：`!rtext = dtxr of $!mem wrt/*`，`match('SHOP') ne 0` 为车间焊 | `welds.rs::is_shop_dtxr`、`weld.rs::weld_type` |
| 仪表管焊口号前缀 | `getwelds` L4585-4591：`isinstpipe`（SITE 名含 INST，L226-233）时现场焊 `M<序号>`、车间焊 `A<序号>` | `welds.rs::number_welds` |
| 认调整焊 | `isobran.getadjustwelds` L2543-2550、`isoadjustweld.pmlobj` L26-32：WELD 且 `dtxr.match('ADJUST') ne 0` | `adjust_weld.rs::is_adjust_weld` |
| 调整焊符号 | `isoline.drawadjustweld` L2960-3039（类别「调整焊」，四条 aidline） | `adjust_symbol.rs` |
| 调整焊附加长度 | `lindim.pmlobj` L322-359（每段最多吃一个）、`isoline.plusAdjustLenInDim` L2070-2151（类别「调整焊附加长度」）；长度 `:PIPE-ADLONGTH`，没有按 50（`isoadjustweld.pmlobj` L187-193） | `adjust_weld.rs` |
| 管段切分 | `isobran.getcutparts` L5127、`getelementmaterials` L3510-3513：`dtxr` 含 `FIELD` | `cutpipe.rs::is_field_weld` |

**后果，也就是修完之后数据包变了什么**（核对过数据；同一版求解器 `94bf16b`，改动前 / 改动后的输入各算一遍，2425 条）：

- 2300 条数据包逐字节不变，125 条有变化（em9_pipe 117、em4_pipe 8）。
- 预期内：
  - `weld_mark.weld_type` `field → shop`：**413** 处 / 125 条 BRAN，逐条对过——都是目录文字含 SHOP 的 WELD；
    反过来，改动后目录文字含 SHOP 的 WELD 没有一条的焊点标记还是 `field`；
  - 仪表管焊口号 `M# → A#`：**395** 处 / 117 条 BRAN，序号不变、只换首字；
  - `24383_76302`：多 4 条「调整焊」（`aid_line`）与 1 条「调整焊附加长度」（`aid_text`，` +50`）。
- 预期之外、逐条解释过：**位置联动**。`A` 比 `M` 窄（求解器字宽表 0.6878 对 0.8523），焊口号的占位变了；直段画完后障碍会抄给
  下一条直段（`polar.carry_from`），后面的图元跟着重新找位。内容（文字、类别、对象）一个没变：
  - 焊口号：395 个改字的里 241 个同时换了位置、154 个没动；另有 33 个没改字的换了位置（原因都在同一条或前面的直段里）；
  - 焊口号的引线：36 条没了、14 条新出现（离焊点近了不带引线、远了带）；
  - 焊点以外 28 个图元换了位置：12 条尺寸（7 条 BRAN）、连接信息标签与引线各 5、弯头信息标签与引线各 3——28 个的前面
    直段里都有改了字或挪了位的焊口号（21 个在前一条、7 个在前两条），没有一个找不到原因。
- 用联调后端里的求解器 `47eb83e` 算是 412 / 394（124 / 116 条 BRAN）：少的那一条焊所在的直段在旧求解器里没画出来（D-PIPE-044）。
  triage 的 412 / 394 是这个口径。
- 没有变化的：诊断一条没多没少；管段号在这个库上本来就不出（没有图号 UDA），`FIELD` 这条路这次也没有产出。
- 17 条 SPCO 没有 `DETA` 的 WELD 仍然没有文字、按现场焊（全在 em9）。PML 在它们上面取 `dtxr` 回什么没核对。

**调整焊那一条**（全库唯一：BRAN `24383_76302` 打头的 WELD `24383_76303`，`FIELD AND ADJUST WELD`）：对着 PML 看过，画法对
（核对过数据 + 读代码；要先修第 2 条，否则 Head 错位、「+50」会落在一条不存在的「WELD—Head」尺寸段上）。

- 焊点就在管口上（修完 Head 之后两者距离 0）；本 BRAN 没有前一根管、`HREF` 为空，后一根隐式管身长 127.5、外径 33、以焊点
  为起点 → `dirup = false`、调整段是后一根管（`isoadjustweld.pmlobj` L43-85、L134-154）。
- 符号四条线与 `drawadjustweld` L3014-3026 的公式逐项相符：起点离管轴 16.5（`aod / 2`），斜引线轴向 11（`aod / 3`）、径向
  再 24.75（`¾ aod`），横线长 24.75，箭头两条各 5.95（回退 `3/20 aod`、侧距 `2/20 aod`），箭头朝下游。
- 「+50」落在以焊点为起点的主尺寸段 `Head--24383_76304` 上（`lindim.pmlobj` L338：恰在段端点、`dirup` 为假归后段）；段的两端
  不是「只挂 ATTA」，`plusAdjustLenInDim` L2123-2127 不跳过；字高 6 = 直段字高 10 × 0.6；位置与 L2141-2147 的公式相符
  （文字框中心离尺寸段中点：沿字头方向 9.5 = 0.25 × 10 + 0.4 × 10 + 半个小字高，沿文字方向 22.03 = 尺寸文字半宽 + 自身半宽）。
- 没法核对的：符号朝哪一侧（极坐标找位的结果）要 E3D 实机才能对。
- 顺带看到的两处模型数据：这条 BRAN 的 `HDIR` 与第一根管的实际走向差 2.7°，主尺寸读 149.81 而不是 150（PML 同样拿 `hdir` 当
  首直段的方向）；它在一个旧方案的备份 ZONE（`/1RCV-…-OLD-备用`，名字里的地名从略）里。

**别的成员有没有同样的坑**（核对过数据）：把管道侧所有「读不到就当没有」的属性在全部 24055 个元素（2425 条 BRAN + 21630 个
成员）上按类型数了一遍（`p04-attr-census.mjs`）。伪属性只有 `DTXR` 一个中招。其余「模板里没有」的都是项目 UDA
（`:ZD_WLDN`、`:PIPE-ADLONGTH`、`:ATTA-ADLONGTH`、`:YKSX`、`:ZD_GDWJ`、`:ZD_GDBR`、`:ZD_NBBM`、`:ZD_WJBM`——AMS 的字典里没有，
是数据不是缺陷）和成员自己的 `PARA`（代码已经退到目录件的 `PARA`，21630 个成员里 20621 个拿到了）。`BRAN.FLOW`
（`flow_direction`）全库 2425 条都是 0，这个字段在 AMS 上验证不了。

### 2. 管道的 Head / Tail 给错了坐标系（新发现，任务书之外）

**现象与根因**（核对过数据）：`HPOS / HDIR / TPOS / TDIR` 存在 BRAN 的属主系里，成员坐标是世界系。`branch_query.rs` 合成隐式
管身的那一半把它们折进了世界系，交给求解器的 `head_pos / head_dir / tail_pos / tail_dir` 却是原值。属主链是单位阵时两个系
相同；不是单位阵时，求解器拿到的 Head / Tail 虚拟成员就落在别处。

**PML 依据**（读代码）：一律 `hpos / hdir / tpos / tdir of $!this.branname wrt/*`——`isobran.pmlobj` L1493-1494、L1809-1812、
L4237 / L4255、L5109；`isoDim.pmlobj` L468 / L473、L617 / L619；`isoTag.pmlobj` L21 / L25；`isoline.pmlobj` L147。

**有多少**（核对过数据）：全部 2425 条 BRAN 的属主链（PIPE → ZONE → SITE）逐级读了 `POS / ORI`。879 个 PIPE 没有这两个
属性，9 个 SITE 都是零，32 个 ZONE 里 4 个不是单位阵，名下 340 条 BRAN：

| ZONE | POS / ORI | BRAN | 线性尺寸 | 空直段 | 诊断 |
|---|---|---|---|---|---|
| `/1RX02-LCT`（桥架） | POS 0 0 80 | 243 | 875 → 1331 | 686 → 479 | 819 → 590 |
| `/1RB07-MCT`（桥架） | POS 0 0 200 | 63 | 69 → 108 | 39 → 23 | 150 → 86 |
| 旧方案备份 ZONE（`/1RCV-…-OLD-备用`） | POS -300 -300 0 | 21 | 213 → 242 | 48 → 28 | 37 → 8 |
| `/Copy-of-2#主泵辅助管线`（仪表管） | ORI 绕 Z −120° | 13 | 131 → 143 | 23 → 8 | 39 → 1 |
| 合计 | | 340 | 1288 → 1824 | 796 → 538 | 1045 → 685 |

后三列是修完之后数据包的变化（同一版求解器 `94bf16b`）。旁证：改动前，输入里有 `Head~X` / `X~Tail` 隐式管身（宿主按世界系
合成）的 BRAN 中，管身端点与 `head_pos / tail_pos` 对不上的 64 处，全在这 4 个 ZONE 里；改动后 528 条 Head 管身、489 条 Tail
管身的端点与 `head_pos / tail_pos` 全部重合。最极端的 `24381_147888`：Head 原先给在 (−9558, 10541, 5860)，世界系是
(13908, 3007, 5860)，差二十多米。

**修完之后**（核对过数据；2425 条，只有这 340 条的数据包变了，其余 2085 条逐字节不变）：

- 输入只变了这 340 条的 `head_pos / tail_pos`（带转角那 13 条另有 `head_dir` 11 条、`tail_dir` 10 条），位移与各 ZONE 的
  `POS / ORI` 逐条相符（独立算的期望值与宿主给的残差为 0）。
- 一条尺寸都没有的 BRAN 55 → 26；尺寸变多的 198 条；变少的 5 条，少掉的是原先错出来的（例：`24383_76210` 是一根 5200 的
  直管，原先标成 411.66 + 4788.34 + 411.66 三段，现在是一条 5200；`24383_98349` 少了一条凭空的 80）。
- 全库管道的诊断：`isodim.member_off_axis` 594 → 374、`linear.point_off_axis` 300 → 149、`linear.segment_spans_kink` 7 → 5；
  `isodim.atta_before_first_point` 100 → 112、`isodim.segment_unreliable` 19 → 20（原先整条直段是空的，现在画出来了，才看得见
  这些）。**也就是说，triage 归到「模型画法」里的那两大类诊断，有 220 + 151 条是宿主这个错造成的。**
- 17 条 BRAN 的诊断变多：16 条是尺寸同时变多、空直段变少的（例：`24383_98675` 尺寸 0 → 6，多出来的是成员偏轴的
  `isodim.member_off_axis`）；另一条是 `24383_76334`——
- `24383_76334` 的 Tail 现在被 `linear.point_off_axis` 丢掉：它的 `TPOS` 折进世界系之后离末端成员 425 mm（宿主的
  `adapter.implied_tube_not_drawn` 前后都在报这一段）；原值碰巧与末端成员的世界坐标重合，原先看着「对」是错上加错。
- 340 条的 Head / Tail「连接信息」标签里写的 X / Y / PE 全变了（原先写的是属主系坐标）。
- 仪表管那 13 条的焊点 122 → 99：原先 Head / Tail 错位，离哪条焊都远，各补了一个焊点；现在与管口上的焊点重合，不再补
  （`getwelds` L4235-4270）。

### 3. 焊口号 `:ZD_WLDN` 只给 WELD 读（新发现，任务书之外；读代码推断，本库验证不了）

PML `isobran.getwelds` 的普通管道一支里，焊点表的三种来源都从各自的 `:ZD_WLDN` 领号：WELD（L4665）、ATTA 的护板 / 支腿 /
挡块焊点（一个 ATTA 一串号 `A1-3` / `M1;M2`，L4597-4649、L4693-4717）、KD 管件的几个焊口（`;` 分开，L4669-4691）。求解器
`welds::number_welds` 三种都从 `weld_number` 取，plant-mbd 的字段字典也写着「`weld_number`(ATTA / PCOM)」；宿主只给 WELD 读。
AMS 的字典里没有这个 UDA（WELD 1234、ATTA 6701、PCOM 5 读出来都是「模板里没有」，核对过数据），所以这里看不出来；
带它的项目上，ATTA 与 KD 的焊点永远没有编号。改成三种都读，对 AMS 的输入零影响（核对过数据）。

### 4. 找墙候选里的模板墙（任务 2）

**复核**（核对过数据，与 triage 一致）：`15201_379 / 380 / 381` 是 AvevaCatalogue 设计库 `acp7009`（MDB `/ALL` 里的一座 DESI 库）
里 `TPWL /Concrete_Template_World › TMAR /Concrete_Template_Area › TMPL /Y-Wall` 下的三面 STWALL，`SPRE` 为空、
`DESP [300, 2000]`、`POSS 0 0 0`，摆在世界原点。全部 1163 台设备里 36 台（em9 35、em4 1）的候选里有它们（105 个候选、
105 句「没有 SPRE：截面按 DESP…」）；34 台把 `15201_379` 当东西向定位墙、出一条写着 `/Y` 的「定位墙体」，其中 33 台的
墙脚离基准点不到 1 mm、定位尺寸判退化，1 台出了一条 129.51 的定位尺寸。全部 2556 个支架的候选里没有它们。另有 5 块楼板
（土建 2、建筑 3）的「板上的墙」里有它们（11 处、11 句说明），其中 `17496_100380` 因此多出 15 个量模板墙的图元
（7 条尺寸、8 个偏转角度图元）。105 + 11 = triage 数的 116 句。

**PML 的收法**（读代码）：`mbdlocation.getconindir` L702-707 是 `coll all (stwall gwall wall) within <体积>`，没有 `for`，范围是
整个 MDB，不分 WORL 与 TPWL。宿主读的 SPAMAP 就是 E3D `WITHIN VOLUME` 用的那张表，表里有这三面墙——所以**字面上 PML 也会
收到它们**（推断：没有实机跑）。

**但 PML 不会拿它们定位，原因不是「模板」，是「墙没有实体」**（读代码）：收到之后每面墙先 `markcivil(...)` +
`getDataOfCivil`。`markCivil.getDataOfCivil` L440-447 对 STWALL 先读 `prop thk`，读不出就 `handle any → return`，原注释
「处理墙没有实体的情况」——`SPRE` 为空的 STWALL 没有目录截面，`prop thk` 读不出，`profiles` 空着。回到 `getconindir`，
L726 `if !civil.profiles.set()`、L766 `elseif !civil.arcs.set()` 两支都不进，这面墙不算距离，只记进 `usedcons`，射线接着往外
环找。E3D 里这种墙应当也什么都不画（读代码推断：e3d-model 给 `SectionChain::NoSpre` 的注释是「E3D 只画中心线，不出实体」）。
宿主的墙面构造在它上面退回 `DESP [厚, 高]` 矩形——那是给土建视图出面用的退路，找墙跟着用了，等于凭空多出一堵贴在原点上的墙。

**判断与处理**：照 PML 的判据排除——`SPRE` 为空的 STWALL 不参与找墙（不看它在不在模板世界里），不需要另立裁决。
「楼板旁的墙」用同一条判据：建筑那边 PML 的 `drawarchwalls` L1823 带 `name of site` 过滤，这三面墙没有 SITE、过不了；土建
那边 L2942-2963 拿着空的 `lines` / `arcs` 往下走会报错，也不会出尺寸。两处都不留说明（PML 在这里是安静跳过）。

**修完之后**（核对过数据）：

| 36 台设备 | 改动前 | 改动后 |
|---|---|---|
| 33 台 | 东西向 = 模板墙，定位尺寸 0 条（退化） | 南北、东西各一面真墙，2 条定位尺寸，没有 `locate.*` 诊断 |
| `24381_102000` | 南北一面真墙（15934.34），东西没有 | 南北、东西各一面更近的真墙（7839.71、5875.4） |
| `24381_131991` | 东西向 = 模板墙，1 条定位尺寸 129.51 | 只有南北一面真墙（6219.69），东西向被弧墙挡住 |
| `24384_26549`（em4） | 候选里有、没用上 | 结果不变，只少两句说明 |

真墙原先被贴在基准点上的模板墙挡在后面。其余 1127 台设备、全部 2556 个支架的输入逐字节不变；838 个土建 / 建筑对象里只有
那 5 块楼板变了。

## 2. 改了什么

仓库 gen-model，工作树 `<gen-model 工作树>`，分支 `fix/mbd-weld-dtxr`（基于 `refactor` 的 `e8636c4a6`），
四笔本地提交，没合并、没 push。8 个文件，547 行增、24 行删。

| 提交 | 说明 | 文件 |
|---|---|---|
| `eff7d5fbd` | 管道 WELD 的 DTXR 沿目录链读 | `src/mbd/branch_query.rs`、`src/mbd/branch_query/fields.rs`、`src/mbd/support_query.rs`（`detail_text` 只改可见性）、`tests/mbd_branch_query.rs` |
| `21bec9bdc` | 管道交给求解器的 Head / Tail 折进世界系 | `src/mbd/branch_query.rs`、`tests/mbd_branch_query.rs` |
| `1308e46d7` | `:ZD_WLDN` 也给 ATTA 与 PCOM 读 | `src/mbd/branch_query.rs`、`tests/mbd_branch_query.rs` |
| `2c50ea7a2` | 没有 SPRE 的 STWALL 不参与找墙、不算板上的墙 | `src/mbd/civil_faces.rs`、`src/mbd/civil_query.rs`、`tests/mbd_equipment_query.rs`、`tests/mbd_civil_query.rs` |

- `dtxr` 复用支架那边的 `support_query::detail_text`，没有再写一份；读坏了只留空并记 `adapter.member_field_unreadable`，
  不让整条 BRAN 失败。
- Head / Tail：属主链是单位阵时原样给，数值逐位不变（2085 条 BRAN 的输入因此一个字节都没变）。
- 找墙：新加 `civil_faces::stwall_without_solid`，`locate_candidates` 与 `floor_walls` 各加一个跳过；墙板自己的面
  （`civil_shape_of` 的 DESP 退路）没动。
- 没碰：BRAN 回 422 的那条路、支架视图的行为、求解器（plant-mbd）、前端。
- 工作树里另有两处**只为验证、没有提交**的改动（与 host 代理同样的做法）：`Cargo.toml` 第 185 行指到我自己的求解器快照
  `vendor\plant-mbd-weldpin`；`src/data_interface/manual_update.rs` 一行（`refactor` 的 HEAD 自己编不过）。

## 3. 怎么验证的

离线这条路：导出工具（`examples/mbd_object_dump`）→ plant-mbd CLI（`layout --data-only`）→ 扫描脚本重放
（`scripts/mbd-live-sweep.mjs --payload-dir`）。脚本与数据都在 `.scratch\mbd-multitask\hostpipe\`。

### 输入对比（改动前的工具 `bin-before` 对最终的工具 `bin-after-final`，各导一遍全部对象）

| 类别 | 个数 | 不变 | 变了 | 差异按类（全部） |
|---|---|---|---|---|
| 管道 BRAN | 2425 | 1781 | 644 | `members[WELD].dtxr` 多出 1217 个（324 条）；`head_pos` / `tail_pos` 各 340 条、`head_dir` 11 条、`tail_dir` 10 条 |
| 设备 | 1163 | 1127 | 36 | `civil_candidates` 少 105 个（都是那三面墙）；36 个 `issues` 清空（105 句都在说那三面墙） |
| 支架 | 2556 | 2556 | 0 | — |
| 土建 / 建筑 | 838 | 833 | 5 | `walls` 少 11 个；5 个 `issues` 清空（11 句） |

多出的 1217 个 `dtxr` 与独立沿目录链读出来的文字逐条相同，目录链上有文字的 WELD 没有一条漏掉。没有任何别的字段变化。

### 数据包对比（同一版求解器，改动前 / 改动后的输入各算一遍）

分阶段（求解器 `94bf16b`，每一笔单独归因）见第 1 节各小节。合起来（最新的 READY `3b47289`，改动前对最终）：

| 类别 | 个数 | 不变 | 变了 |
|---|---|---|---|
| 管道 | 2425 | 1968 | 457（DTXR 的 125 条 ∪ Head / Tail 的 340 条） |
| 设备 | 1163 | 1127 | 36 |
| 土建 / 建筑 | 838 | 833 | 5 |

管道全库合计（两版求解器的数相同）：图元 131196 → 134099；尺寸类 51777 → 53411；流向 25947 → 27300；车间焊标记 em4
205 → 223、em9 1014 → 1409；焊口号 `A#` 1014 → 1409；调整焊 0 → 4、调整焊附加长度 0 → 1。

### 过前端（`scripts/mbd-live-sweep.mjs --payload-dir`，只读地跑主检出里的脚本）

| 数据包 | 走通 | 别的结局 | 说明 |
|---|---|---|---|
| 管道 2425（`3b47289`，最终） | 2425 | 0 | 契约拒收、映射拒收、退化都是 0；warning 2874 → 2514；画出的记录 57701 → 59422 |
| 设备 1163（`3b47289`，最终） | 1163 | 0 | 画不出东西的记录 87 → 2 |
| 土建 / 建筑 838（`3b47289`，最终） | 774 | 空包 64 | 与改动前的结局逐个相同（空包是求解器 / 模型那一侧的，不在这次范围里） |

分阶段的重放（`94bf16b`）：DTXR 之后 2425 / 2425 走通；再加 Head / Tail 之后 2425 / 2425 走通。调整焊的两类图元第一次过前端，
没有契约拒收、映射拒收或退化。

### 编译与测试

每条 cargo 都经 `with-cargo-lock.ps1 -Owner hostpipe -Heavy`、`-j 2`，没有 `cargo clean`。

| 求解器快照 | 跑了什么 | 结果 |
|---|---|---|
| `47eb83e`（联调后端的版本；提交出去的代码对应它） | 8 个 MBD 测试目标，HEAD `2c50ea7a2` | **80 / 80 通过** |
| `3b47289`（最新 READY） | 同上 | **80 / 80 通过** |
| `94bf16b` | 同上（楼板那一处还没加时跑的全量，当时 79 条）+ 加完之后的 `mbd_civil_query` / `mbd_equipment_query` | 78 / 79：`mbd_support_query::ams_centreline_support_without_spre` 是红的，与这次改动无关（那个支架的输入改动前后逐字节相同；`47eb83e`、`3b47289` 上是绿的，宿主一侧已记录）；后两个目标 28 / 28 |
| `94bf16b` | **变异检查**：把四处新判断同时改坏（按属性读 DTXR、Head / Tail 不折世界系、焊口号只认 WELD、`stwall_without_solid` 恒假） | 6 条守卫测试全红、其余全绿，各自红在对应的断言上；源文件已还原、与 HEAD 相同 |
| `3b47289` | **与 host 分支试合并**：`git merge-tree` 算出 `fix/mbd-weld-dtxr` + `fix/mbd-live-sweep-host`（`6527092ea`）的合并结果，无冲突；把合并后的 10 个文件铺到我的工作树里跑同样的 8 个目标，跑完按备份还原 | **94 / 94 通过**（没有产生任何合并提交，没有动任何分支） |

8 个目标：`mbd_branch_query`（9）、`mbd_branch_fields`（11）、`mbd_equipment_query`（11）、`mbd_support_query`（12）、
`mbd_civil_query`（17）、`mbd_object_classify`（18）、`mbd_object_endpoint`（1）、`mbd_http_endpoint`（1）。

新加的 6 条用例（都用真库，改坏必红）：

- `weld_detail_text_comes_from_the_catalogue_detail_not_from_a_design_attribute`：`24383/76302` 的七条 WELD 读出
  `FIELD AND ADJUST WELD` / `SHOP WELD`，端到端出车间焊标记、4 条调整焊符号、一条 ` +50`；
- `head_and_tail_are_given_in_world_coordinates_not_in_the_owner_frame`：位移的 ZONE（`24383/76302`）与带转角的 ZONE
  （`24381/147888`）各一条；
- `weld_numbers_are_read_for_welds_attas_and_kd_components`；
- `stwalls_without_a_section_are_not_locating_walls`：设备 `24381/101930`；
- `floor_walls_leave_out_stwalls_without_a_section`：楼板 `17496/100380`；
- 原有的 `direct_read_agrees_with_the_surreal_era_field_fixture` 里 Head 的断言改成按「原值 + ZONE 的 POS」比（那份
  Surreal 时期的 fixture 里 Head 是属主系的原值）。它在没有 `vendor/shared` 的工作树里会 SKIP；我放了一份 fixture 拷贝让它真跑
  过（通过、变异时变红），跑完删了。

四笔提交每一笔都单独检出编过、跑过 `mbd_branch_query`：`eff7d5fbd` 7 / 7（`94bf16b`）、`21bec9bdc` 8 / 8、`1308e46d7` 9 / 9
（`3b47289`），最后一笔就是上表的 HEAD。

**没有编译验证过的**：gen-model 别的测试目标（非 MBD 的）与 `cargo clippy` 没跑（全量太重）。

## 4. 没做到、没验证的

- **PML 没有实机跑**。「`coll … within` 会收到 TPWL 下的墙」「没有 SPRE 的 STWALL 上 `prop thk` 报错」「SPCO 没有 `DETA` 时
  `dtxr` 回什么」都是读源码推的。调整焊符号朝哪一侧（极坐标找位）没法对。
- **联调后端没换、页面没看**。全部结论在离线这条路上（已校准 6982 / 6982）。扫描脚本的相机是按包围盒摆的，「走通」不等于
  「画得对」。
- `:ZD_WLDN`（ATTA / PCOM）、`:PIPE-ADLONGTH`、管段号、`flow_direction`：AMS 没有这些数据，真库上验证不了。
- 合并之后只编译、跑了测试，没有在整类对象上重放。
- 土建这一侧只加了 `floor_walls` 的那一个跳过。没有 SPRE 的 STWALL 自己当归属对象时，宿主仍按 DESP 出面（PML 在它上面
  什么都不画）；本库扫到的归属对象里没有这种墙，没改。WALL（弧墙 / 直线 SPINE）没有 SPRE 时 PML 是直接报错
  （`getDataOfCivil` L527 没有 `handle`），宿主同样退回 DESP，本库没有这种候选，没改。
- 建筑楼板旁的墙，PML `drawarchwalls` L1823 另有一条「SITE 名不以 `/MDS` 开头」的过滤，宿主没有；有没有对象受影响没查。

## 5. 需要用户拍板的

1. **要不要收第 2、3 笔**（任务书之外）。Head / Tail 那一笔（`21bec9bdc`）改的是 340 条 BRAN 的首末点，证据最硬、影响最大，
   建议收；`:ZD_WLDN` 那一笔（`1308e46d7`）在 AMS 上验证不了，只有读代码的依据，对现有数据零影响。四笔互相独立，可以单独取舍。
2. **没有实体的墙被跳过时要不要留一句话**。现在照 PML 安静跳过（视图的 `issues` 只有 warning 一档，留了就是 36 台设备
   各多 2–3 条 warning）。要留的话得先给视图的说明加一档 info。
   另外：我没有按「在不在模板世界里」排除。模板世界（TPWL）里如果有**带截面**的墙，PML 字面上会拿它定位，宿主现在也会；
   本库没有这种墙（核对过数据：全部 6988 个输入的找墙候选、板上的墙、LNKI / DMF 墙板里出现过 660 块不同的墙板，属主链上
   有 TPWL / TMAR / TMPL 的只有这三面）。要不要再加一条「TPWL 下的一律不收」——那是偏离 PML 字面的做法，要登记裁决——由你定。
3. **金样要不要重导**。plant-mbd 的 `fixtures\field-24383_99996.json`（Surreal 时期导出）里 Head 的 Z 是 −3060，紧接着的首根
   FTUB 是 −2980：这条 BRAN 在 `/1RX02-LCT`（Z +80）下，Head 是属主系的。别的从真库导出的金样如果在那 4 个 ZONE 里同样偏。
   已写给求解器代理，他没动之前我没有碰 plant-mbd。
4. **合并与上线**。我的分支与 host 的分支（`fix/mbd-live-sweep-host`）都基于 `e8636c4a6`，试合并无冲突、合起来 94 条测试全绿。
   合并本身没有做；这四笔要换了联调后端才会生效，换不换、什么时候换是你的决定（联调后端现在仍是改动前的样子）。
5. triage 报告里「管道的 warning 九成在桥架上、是模型的画法」要改口：其中 `isodim.member_off_axis` 的 220 条、
   `linear.point_off_axis` 的 151 条是宿主 Head / Tail 的错。桥架要不要按管道标，仍然要你定，但依据的数变了。

### 需要求解器代理配合的（已写在 `status\hostpipe.md`）

1. 金样里的 Head 是属主系的（上面第 3 条）。
2. 「首尾在原点的 BRAN」那条规则别按 (0, 0, 0) 判：8 条里 `24383_97900`、`24383_99159` 在 `/1RX02-LCT` 下，修完之后到求解器
   手里是 (0, 0, 80)。
3. 调整焊在真实数据上第一次跑通，画法对；两处与 PML 字面不同的地方（`is_adjust_weld` 不分大小写、没有 `:PIPE-ADLONGTH` 时
   按 50 而 PML 会报错）是求解器有意的，只提一句。
4. 焊口号改字之后别的图元会挪位，不是问题，知会。
