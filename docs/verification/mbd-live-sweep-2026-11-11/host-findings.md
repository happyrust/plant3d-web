# 宿主（gen-model）这一侧的发现与修正（2026-11-11 22:42 – 11-12 01:27）

宿主代理（host）的交回，对应 [README](README.md)「失败的原因」第 1、6 行与「空包」表的三行。

> 2026-11-12 03:50 补：之后的汇合（两条宿主分支合并 + 求解器最终提交，全量重放）见 [integration](integration.md)，以它为准。

**口径**：全量扫描把 ZONE 下成对的 STRU 与 REST 各算了一次。下面的数默认按**扫描条目**（全库 7059），凡是换成
**归属对象去重**（全库 6802，em4_supp 2207、em9_pipe_supp 92）的都写明了。型钢那 337 个支架两种口径相同。

**每条结论后面的括号**：「核对过数据」= 在整类对象上从 `.dat` 的原始属性或宿主视图里数出来的；「读代码推断」= 读
PML / Rust 源码得出、没有跑过。

## 1. 结论

### A. 真实输入：导出工具、离线端点

- 没有现成编好的。gen-model 的 24 棵工作树的 `target\{debug,release}\examples\` 和 `<cargo 目标目录>\` 都查过，
  没有 `mbd_object_dump.exe` / `mbd_branch_dump.exe`（核对过数据）。自己建工作树编的，见第 2 节。
- **这条离线的路与联调后端的端点等价**（核对过数据）：
  - 导出视图 → plant-mbd CLI（联调后端里的求解器版本 `47eb83e`）→ 与联调后端的答复深比较：第一批 38 个对象 38 / 38 相同
    （只忽略 `input_refno` 与 `meta.source_version`，数值按 f32 相等比）。求解器代理后来在更大的范围上重复了这一步：
    civil / arch 838 / 838、支架 2556 / 2556、带安装角度的 BRAN 627 / 627（见 `status\solver.md`）。
  - 新加的 `examples/mbd_object_respond`（「离线端点」：对一批 refno 走 `GET /api/mbd/v2/object/{refno}` 的同一条主体
    `web_service::mbd::respond_object`，把状态码与正文落盘）：改动后的宿主 + 求解器 `47eb83e` 重放全部 7059 个对象，
    **6569 个答复与联调后端逐字节相同**（只忽略 `meta.source_version`），其余 490 个恰好是这一轮有意的改动（第 3 节）。
    7059 个对象 91 秒（debug 档、6 路并发）。有了它，改宿主或求解器之后不用换联调后端就能在整批对象上重放。
- 全部 7059 个对象的求解器输入都导出来了：`.scratch\mbd-multitask\fixtures\all\`（6988 个文件、621 MB；71 个不可标注的
  对象没有视图）。第一批 38 个在 `fixtures\`，其中 12 条管道另有切段成员形状的在 `fixtures\branch\`。
- 联调后端的二进制与 `refactor` HEAD 的 MBD 宿主代码相同：`git diff 2da4cd725 e8636c4a6 -- src/mbd src/web_service/mbd.rs
  examples/mbd_object_dump.rs examples/mbd_branch_dump.rs` 为空（核对过数据）。但 `.dat` 读取库不同：22:11 那一遍扫描时
  联调后端是 `e3d_model gb999e6cd1871.dirty`、`e3d_io g03414fd43e6f`，我编进去的是 `vendor\e3d-model` `9b74e66`（另有 9 处
  未提交改动）、`vendor\e3d-io` `71ac836`（2 处未提交改动）。上面「6569 个逐字节相同」说明这个差别对 MBD 没有影响。
  （23:14 联调后端换过一次二进制，`build_id` `0.1.44+ge8636c4a636f…dirty`，读取库
  正是 `9b74e66` / `71ac836`；换完之后全量重扫过，7059 个答复逐字节不变。）

### B. 型钢 SCTN「no usable section data」：337 个支架、1149 根

**根因：库里就没有截面规格，不是宿主读漏。**（核对过数据）

- 全部 2556 个支架条目的宿主视图里，SCTN 共 6225 根（没有 GENSEC），按求解器 `support/em4/members.rs::sctn_of` 的判据
  （有 section、定位线非零长、有 ori、截面点非空）：5076 根可用，**1149 根被跳过，原因全部是「没有 SPREF → 截面点为空」**；
  POSS / POSE、标架都在。预测会被跳过的集合与联调后端诊断里点名的 1149 根**逐个相同**（两边各多出 0 根）。
- 用探针（`examples/mbd_subtree_probe`）读这些支架子树的原始属性，5470 根不重复的 SCTN：

  | `SPRE` | 根数 | 其中被求解器跳过 |
  |---|---|---|
  | 指向读得到的 SPCO | 4321 | 0 |
  | Nulref | 1127 | 1127 |
  | 悬空（目标不在目录库 5052 的现行会话里） | 22 | 22 |

- 337 个支架（没有重复的归属对象）：
  - 328 个是 MDS 的 `SPECIAL / SPS` 电缆桥架支架（STRU 的 `DESC` 形如 `S2-82-550-HSS160X160X20-YMJ750X750X50` 248 个、
    `…-MGB…-FLOOR` 73 个、`S#-#-#` 7 个），在 `/1RX-ELECBJ` 未命名的 ZONE（124）、`/1RX03-PIPEBJ /1RX03-MSUP`（124）、
    `/1RX-ELECBJ /1RX02-LSUP`（80）。横担 `…-BAR-n`（GTYP BEAM，879 根）与立柱 `…-V1`（GTYP BOX，248 根）的 `SPRE` 是 Nulref。
    前两个区每个支架的 SCTN 全是这样（各 500 根全跳过）；`/1RX02-LSUP` 的 769 个支架、1223 根 SCTN 里只有 127 根。
  - 9 个是风管支架 `/-SR-CSV-S5001…S5006、S6124、S6125、S6137`（`/1CSV-HVACHB`），22 根 SCTN 的 `SPRE` 指向
    `13244/271598`、`271629`、`271645`，目录库 5052（`ams5052_0001`，会话 190）里没有这三个元素。它们是被删了还是从来
    没有，没查；附近的号（271560–271660）一个都不在。
- 按联调后端的结局：146 个因此空包、60 个被前端拒收（字高 0，那是求解器的缺口）、131 个走通但缺一部分型钢尺寸——与任务书的
  数相同。带上求解器最新的 `READY`（`3b47289`，修了字高退路）重放之后：146 个仍是空包；另外 191 个都走通，其中原先被拒收的
  60 个只有一条「管道信息」标签（56 个另有两条管道中心标识线；4 个读不到管外径，连中心标识也没有），**一条尺寸都没有**；
  原先走通的 131 个里 106 个有尺寸、25 个没有。
- gen-model 自己的测试早就写明了这两种情形：`tests/mbd_support_query.rs::ams_centreline_support_without_spre`
  （「SCTN ×3 没有 SPRE（E3D 只画中心线）」）与 `ams_hvac_support_reads_fitting_end_plates`（「SPRE 在 5052 里悬空」）；
  e3d-model `src/section.rs` 的模块注释也记着「ams8000 528 只里 500 只没有 SPRE……E3D 的 TTY 导出只给一根中心线」。
- **PML 在这种 SCTN 上标不出来**（读代码推断，没有在 E3D 里跑）：`supportSctn.pmlobj:130` 构造时调 `getPoss()`（L187）
  → `!!getSctnPoints`；`getSctnPoints.pmlfnc` L10 先调 `!!getsctnpos`，其中 L29
  `var !plins coll all plin with(pkey eq !jus) for pstref of catref of $!sctn`，L49-52 `gstref of catref of` 失败后退到
  `gmre of catref of`、再失败没有 handle。往上 `suiSupport.getSupportSctns`（L4195-4203）→ `getTypeData`（L3536）→
  `load`（L194）→ `draw`（L990）一路没有 handle：有一根这样的 SCTN，PML 整个支架出错停下。求解器现在「跳过这一根、其余
  照标」已经比 PML 宽。
- 所以按任务书的标准这不算宿主的缺陷。做了一处小改进：视图里每个支架点一句是哪几根 `SPRE` 是 Nulref（原先一声不响，
  只有悬空的才逐根留话），见第 2 节。

**修正之后有多少从空包 / 残缺变成完整标注：0 个。** 这 1149 根在库里没有截面，宿主给不出来。要让这 206 个支架
（146 空包 + 60 残缺）有型钢尺寸，只有两条路，都不在宿主：在 E3D 里给这些 SCTN 补 SPREF；或者求解器按中心线标长度
（PML 没有这种画法，要登记裁决——见「需要用户拍板的」第 2 条）。60 个残缺的，求解器代理修了字高退路（`3b47289`），
现在不再被前端拒收，但如上所说只有标签、没有型钢尺寸（核对过数据）。

**同一规则号下的「PJOI … has no usable bolt geometry」（1107 根、589 个支架）不是同一个原因**（核对过数据）：
这些 PJOI 有 SPREF，是目录件的 P 点集里没有 P5。全部 2156 个不重复的 PJOI：有 SPREF 且 P4 ≠ P5（成螺栓）321、
没有 SPREF（分类时就跳过，不出诊断）728、有 SPREF 但没有 P5 的 1107（P 点号是 `0,1,2,3,4` 的 1096、只有 `0` 的 10、
`0,1,2` 的 1）；预测集合与联调后端的 1107 根逐个相同。同一个目录件给的 P 点号总是同一组：`/ACP1000-ELEC-GB-…`、`-MGB-…`、
`-YMJ-…`、`-JT1`、`-JT3`、`-JT8`、`-LJJ-67B` 是 P1–P4，`-JT5` 是 P3–P5，`-JT7` 是 P1–P2，`-LJJ1` 一个都没有。PML
`suppbolt.pmlobj:27-33` 把 PJOI 一律当螺栓取 `p4 pos` / `p5 pos`，没有 handle，在这些件上同样出错（读代码推断）。只记这一笔。

### C. 另外三类

**C.1　44 个没有零件的 EM4 支架 = 23 个不同的支架**（22 个在 `/1WCC-PIPEBJ /1WCC-SUPP-RX`，1 个在 `/1RX02-LSUP`；
此前记的是 22 个，按 `subject.refno` 去重是 23：21 对 STRU + REST、1 个配不到 STRU 的 REST、1 个只有 STRU）。
本来就没有东西可标（核对过数据）：

- 23 个里有 SCTN / GENSEC 的 0 个、有 PANE 的 0 个、按名字找到管道附件的 0 个、HANG 下有 PCLA 以外的吊挂件的 0 个。
- 子树里只有空的 FRMW 与 HANG；5 个的 HANG 下有一个 PCLA（5 个 PCLA 都没有 SPRE，求解器分类时跳过）；12 个在 STRU 下
  直接画了 CYLI / CONE / RTOR 图元（MBD 不读这些；PML EM4 `suiSupport.pmlobj` 里的 33 处 `coll all …` 收的是 SCTN / GENSEC、
  FITT / PFIT、BOX、ANCI、按名字的 ATTA、HANG 的成员等，没有这三种——读代码，只查了这个文件的收集语句）。
- 6 个的 HANG.HREF 指着 ATTA（如 `/R330.016A`），但名字不以支架名（`/1WCC-R330.016`）开头。PML EM4 只按名字找管道附件
  （`suiSupport.pmlobj:3712-3713`：`var !allattas coll all atta with(matchwild(name,!tempstring))`，`!tempstring = suppName + '*'`），
  不看 HREF，所以不算这个支架的。全库 2207 个 EM4 支架里这种情形（按名字一个都没找到、HREF 指着名字不合约定的 ATTA）
  有 59 个；另有 25 个 HREF 的名字同样不合约定、但按名字找到了别的附件。
- 数据包里原先只有一条 `support.em4_no_pipe_atta`（44 条里 43 条如此，配不到 STRU 的那个 REST 另有一条「REST 配不到 STRU」），
  没有一句「这个支架没有可标注的构件」。已补：宿主在支架整包没有图元时加一条清点（第 2 节）。

**C.2　7 个 em9_pipe_supp 空包**（7 个不同的归属对象，都是配不到 STRU 的 REST）。本来就没有东西可标（核对过数据）：

- 6 个是 `/Copy-of-…/REST`、`/Copy-(2)-of-…/REST`（`/1TFA-LX-SUPP` 里复制出来的多余 REST，同区有不带 Copy 的原件
  `/1TFA021MP-SUPP-11`、`-12`、`-14` 的 STRU + REST）。下面只有一个 HANG + 一个 PCLA（`/PHB/SPEC/PCLA/1XP42`，单管夹）。
  一个构件之间没有尺寸可标。对照：同区另有 12 个同样配不到 STRU 的 REST，HANG 下多一个 HELE，出了 1–4 条尺寸、走通。
- 1 个（`24381_179219`，`/1TFA033MD-SUPP-01/REST`）REST 下什么都没有，已有求解器的 `support.no_parts`。
- 那 6 个的数据包里原先只有「REST 配不到 STRU」一条，求解器一条诊断都没有。已补清点。

**C.3　6 条回 422 的 BRAN**（核对过数据）：库里**一个成员都没有**的空支管——`/test-inc`、`/CODEX-ISSUE18-RETEST2`、
`/Copy-of-1RND003LP-IS/B1`、`/1RND003LP-IS/B1`、`/1TFA016MP-IS/B1`、一条没有名字的。5 条 HPOS = TPOS = `0 0 0`（缺省值），
`24381_177395` 只设了 HPOS，头尾之间 51953.6 mm、偏轴 116.94°，E3D 不画管。

- 「every branch member was skipped for missing geometry」这句话不对：没有成员被跳过，是根本没有成员。
- **判断：该回 200 的空包加一句说明，不该回 422。** 依据：（1）端点自己的状态语义（`web_service/mbd.rs` 头注）写着
  「可解的 BRAN，哪怕零尺寸也 200——抑制原因在 issues 里；不用 422 把诊断吞掉」，422 `precondition` 留给「视图不可信」；
  （2）求解器对空视图本来有现成的答复（`layout.rs`：零图元 + `data.empty_branch`「branch has no members; nothing to split」），
  是宿主在前面抢先拦成了根错误；（3）别的对象族「没有东西可标」都是 200（空 REST 的 `support.no_parts`、建筑窗体下的墙
  `civil.arch_floor_only`）。PML 对空支管没有明确的处理：`getbranmems`（`isobran.pmlobj` L236-246）得到 `[Head, Tail]`，
  `getisolines` 拼出一条 Head→Tail 的直段，头尾重合时后面多半出错（读代码推断）。
- 已改（第 2 节）：空支管回 200、零图元、一条求解器给的诊断（`id` 是 `data.empty_branch`，error 级，没有 `rule_id`；
  要不要降成 info、补规则号是求解器的事，已告诉它）。库里有成员而一个都没进视图的，仍是 422，原话不变。
  `/api/v1/spatial/centerline` 用的那个读取入口没有改状态，只把话换成「没有成员」。

### 求解器代理转来的几个疑点（`status\solver.md`「需要 host 配合」）

- **第 2 条　`24381_41097`（arch FLOOR）的 3 个 NXTR 在板下 860–1220 mm**：坐标没错，库里就这样（核对过数据）。
  FLOOR `POS z = 17180`，PLOO `HEIG 60`、`SJUS UTOP`（板 17120–17180）；三个 NXTR 的 `POS z = −920`（FLOOR 系）、
  `ORI` 把 z 翻向下、`HEIG 300`、LOOP 顶点在局部 z = 300——世界 z 15960–16260，离板底 860 mm，切不到板。
- **第 3 条　`24381_25804`（civil FLOOR）带 681 块 PANE**：收集范围是 PML 的，不是宿主多收（核对过数据 + 读代码）。
  PML `function/civil/getabakt.pmlfnc`（L11-91）按 FRMW 名 + `-AB / -AK / -AT`、再按 CWALL / CFLOOR 名把倒数第二段换成
  `AB / AK / T` 找框架，`coll all pane for` 整个框架；宿主 `civil_query::abakt_names` / `abakt_panes` 是它的移植。这块板在
  FRMW `/1SR-WF09-F-C` 下，681 块全在框架 `/1SR-WF09-F-AB-…` 里；同一个 CFLOOR 下的另一块板 `24381_25747` 拿到的是
  同样的 681 块。哪块板上有哪块埋板，PML 靠 `civilMem.checkifok` 逐块筛（静默丢），求解器每丢一块出一条
  `civil.member_off_face`，所以一个包 681 条——要不要并成一条是求解器的选择。
- **第 4 条　桥架支架 ATTA 的 `aod = 25` 而通径 500**：宿主照 E3D 的 CGETOD 口径取的是管材目录件的 `PARA[2]`，桥架的
  「管材」不是圆管（核对过数据）。全部 2814 个不重复的管道附件：`aod ≥ 通径` 192 个（真管道，`/1WCC`、`/1TFA`）；
  `aod < 通径` 2219 个，全在电缆桥架区，只有五种取值——`25 / 100`（1382）、`25 / 500`（498）、`25 / 300`（161）、
  `25 / 200`（65）、`21.3 / 50`（113）；`aod` 没有的 403 个（风管居多）。抽两条链读到底：`/ACP1000-Ventilated/ACP1000-TUBE:100`
  → SCOM `/ACP1000-TUBE-100`，`PARA = 100 25 …`（宽、侧高）；`/ACP1000-Trough/ACP1000-TUBE:50` → SCOM `/ACP1000-TUBE-16`，
  `PARA = 16 21.3 …`（规格指错了目录件）。E3D 的 `AOD` 伪属性在桥架上回什么没有验证过（没开 E3D）。求解器要是拿它当
  外径画，`aod < 通径` 时改用通径更稳，那是求解器的取舍。
- **第 1 条　房间号归哪块板**：没做，是规则问题，列在「需要用户拍板的」。
- 第 5 条是告知，不用查。

### 顺带查到的

- **`refactor` 的 HEAD（`e8636c4a6`）自己编不过**（核对过数据）：`src/data_interface/manual_update.rs:5237` 调用
  `fast_delete::wipe_dbnum_for_upgrade_on`，这个函数只在主检出**未提交**的 `fast_delete.rs` 里。调用是提交 `0890e488d`
  带进来的，`2da4cd725` 在它之后、`fast_delete.rs` 最后一次提交在它之前，所以联调后端那个提交多半同样单独编不过（按提交历史
  推断，没有去编）。我在自己的工作树里把那一行退回 HEAD 里有的 `wipe_dbnum_for_upgrade`，只为能编，没提交。
- 修过的求解器（`94bf16b`）在**全部**真实输入上第一次重算（同一份宿主视图，`47eb83e` 对 `94bf16b`）：7059 个里 79 个
  数据包有变化，其中 4 个不在已知的问题清单里——`24381_146345`、`24383_74413`、`24384_24281`（图元数不变、坐标有变）、
  `24381_177702`（图元 47 → 46、少一条 `polar.neighbour_bad`）。已告诉求解器代理，明细在
  `host\compare-solver-47eb83e-vs-94bf16b.json`。它 01:05 的 `READY`（`3b47289`）写明把变化的数据包逐类核对过了；我用离线
  端点独立重放得到的「`47eb83e` → `3b47289` 有变化的数据包」是 519 个，与它在 6988 个输入上数的 519 个相同。

## 2. 改了什么

仓库 gen-model，工作树 `<gen-model 工作树>`，分支 `fix/mbd-live-sweep-host`（基于 `refactor`
的 `e8636c4a6`），两笔本地提交，没有 push、没有合并：

- `bf638ed3e` `fix(mbd): 空支管回 200 的空包而不是 422；支架视图点明没有 SPRE 的型钢与名字不合约定的管道附件，整包没有
  图元时补一句清点`
  - `src/mbd/branch_query.rs`：`empty_view_verdict`（空支管 / 成员都被跳过 / 不空）、`EmptyBranch` 策略、
    `branch_query_for_layout`；空支管在只要成员序的入口上规则号改为 `adapter.branch_has_no_members`。
  - `src/mbd/mod.rs`、`src/mbd/object.rs`：`layout_pipe` 与 `layout_classified` 改走 `branch_query_for_layout`；
    `support_empty_package_issue`（规则号 `adapter.support_empty_package`，Info）。
  - `src/mbd/support_query.rs`：`no_spre_note`、`checks_href_naming` / `href_naming_note`、`empty_package_note`。
  - `src/web_service/mbd.rs`：只改了头注里的状态语义。
  - `examples/mbd_object_dump.rs`：管道视图跟着用 `branch_query_for_layout`。
  - `tests/mbd_branch_query.rs`（+5 条用例）、`tests/mbd_support_query.rs`（+9 条用例，另给 2 条已有的用例和 `assert_laid_out` 各加了断言）。
- `6527092ea` `chore(examples): mbd_object_respond 离线重放统一端点的答复，mbd_subtree_probe 把子树的原始属性打成 JSONL`
  - `examples/mbd_object_respond.rs`、`examples/mbd_subtree_probe.rs`（新文件）。

这两笔的**说明**在收尾时重写过一次，内容（树）没有变：00:51 提交时是 `473c7423d` / `0f1e51fe4`，第一笔的说明里有三处
写得不准——把 7059 个候选对象写成了「归属对象」（去重是 6802）、改坏试验 14 处写成了 15 处（把重试的那次也数了）、
把 196 个空包原先的诊断说成了「只有 `support.em4_no_pipe_atta` 或什么都没有」（实际 146 条另有逐根的 SCTN 诊断、
6 条是「REST 配不到 STRU」）。我用 `git commit-tree` 按原来的树重建了两笔，再用带旧值校验的 `git update-ref` 把自己的
分支指过去：`git diff 0f1e51fe4 6527092ea` 为空，工作树与索引没有动，旧的两笔还在对象库里（reflog 看得到），不在任何分支上。

工作树里另有两处**只为验证、没有提交**的改动：`Cargo.toml` 第 185 行指到求解器快照 `../vendor/plant-mbd-hostpin`；
`src/data_interface/manual_update.rs` 那一行（上面说的编不过）。**所以这个分支提交的状态与 `refactor` 一样，单独检出来
编不过**，要带着主检出那份未提交的 `fast_delete.rs`，或者照我的办法绕一下。

改动之后数据包里多出来的话（全库，求解器 `47eb83e`；括号里是按归属对象去重）：

| 诊断 | 条数 | 落在哪些对象上（联调后端结局） |
|---|---|---|
| `data.view_issue`「N 根型钢（SCTN / GENSEC）没有 SPRE（Nulref）：…」（warning） | 328（328） | 空包 146、走通 122、被拒 60 |
| `data.view_issue`「HANG 的 HREF 指着 N 个 ATTA（…），名字不以支架名 … 开头…」（warning） | 118（59） | 走通 106、空包 12 |
| `adapter.support_empty_package`「数据包里没有图元。支架的子树里有 …」（info） | 196（175） | 空包 196 |
| `data.empty_branch`（求解器的，error；原先被 422 挡在外面） | 6（6） | 422 的 6 条 BRAN |

没有改的：联调后端、`DbOption.toml`、别人的工作树与两个主检出里的已有文件。

## 3. 怎么验证的

都在真实数据上（AMS，MDB `/ALL`，29 个 DESI 库 + 五个目录库目录，只读 `.dat`），没有起后端。

**（1）离线端点对全部 7059 个对象重放，与联调后端逐个比**（`host\respond-objects.ps1` → `host\compare-payloads.mjs` 归类差异；
「逐字节相同」是 `host\byte-compare.mjs` 量的：把正文里 `"source_version":…` 那一段原样剪掉，剩下的文本不解析、逐字节比，
与解析后深比较得到的个数一致）：

| | 与联调后端逐字节相同 | 不同 | 不同的都是什么 |
|---|---|---|---|
| 改动后的宿主 + 求解器 `47eb83e`（联调后端的版本） | **6569** | 490 | 288 个多一条 `data.view_issue`；158 个多一条 `data.view_issue` + 一条清点；38 个多一条清点；6 条 BRAN 422 → 200。**没有别的** |
| 改动后的宿主 + 求解器 `94bf16b`（修过的） | 6550 | 509 | 上面 490 个，加求解器自己的 79 个里不重叠的那些（出口自检拿掉的图元、直段轴线、安装角度、三面墙） |
| 改动后的宿主 + 求解器 `3b47289`（01:05 的 `READY`，收尾时补跑） | 6110 | 949 | 上面 490 个（其中那 60 个原先被拒收的支架同时带着求解器的字高修正），加只有求解器在变的 459 个：394 个支架少两条零长的中心标识、多一条 `support.pipe_od_missing`；46 块建筑空楼板多一条 `civil.nothing_to_annotate`；其余 19 个是 15 条管道（直段轴线、安装角度）、三面墙、一个建筑对象改报 `civil.arch_floor_only` |

第一行同时证明了两件事：没被改动波及的对象（含全部设备 1163、土建 / 建筑 838、71 个不可标注的 422、未受影响的管道与
支架）答复一个字节都没变；有意的改动恰好落在预期的那些对象上，个数与第 1 节在整类上数出来的对得上
（328 + 118 = 446 条 `data.view_issue` = 288 + 158；196 条清点 = 158 + 38）。

**（2）过前端**（契约 `parseMbdV2PipeData`、映射、登记、内核排版；`host\mbd-live-sweep.host.mjs` 是主检出扫描脚本的拷贝，
只加了「按 index.jsonl 的状态码处理 422」，模型树仍只读地问 8022）。按扫描条目：

| | 走通 | 契约拒收 | 映射拒收 | 422 | 空包 | 退化 | 不可标注 |
|---|---|---|---|---|---|---|---|
| 联调后端（full-3） | 6646 | 67 | 7 | 6 | 261 | 1 | 71 |
| 改动后的宿主 + `47eb83e` | 6646 | 67 | 7 | **0** | **267** | 1 | 71 |
| 改动后的宿主 + `94bf16b` | **6716** | **0** | **0** | 0 | 267 | 5 | 71 |
| 改动后的宿主 + `3b47289`（最新的 `READY`） | **6721** | **0** | **0** | **0** | 267 | **0** | 71 |

按归属对象去重（6802）：走通 6410 → 6410 → 6480 → 6485；空包 240 → 246 → 246 → 246；其余各列与上表相同（67 / 7 / 6 / 1 / 71 →
67 / 7 / 0 / 1 / 71 → 0 / 0 / 0 / 5 / 71 → 0 / 0 / 0 / 0 / 71）。分类型的表在 `host\outcome-tables.md`。

宿主的改动对结局的影响只有一处：6 条空支管从「422」到「空包」。最后一行是把求解器到 01:05 为止的修正也算上之后的样子：
页面上整包失败的 80 个条目（契约 67、映射 7、422 6）和 1 个退化的全部不再失败；剩下的非走通只有 267 个空包
（em4_supp 190、em9_pipe_supp 7、arch 59、civil 5、空支管 6）和 71 个不可标注。**267 个空包的数据包里每个都至少有一条
诊断**（`host\analyze-final.mjs` 逐个看过）：宿主负责的 203 个（190 + 7 + 6）里 196 个有清点、1 个有 `support.no_parts`、
6 个有 `data.empty_branch`；建筑的 59 个是 `civil.nothing_to_annotate`（46）或 `civil.arch_floor_only`（13）；土建的 5 个是
`civil.geometry_missing`。

**（3）测试**（`-j 2`）：gen-model 的 8 个 MBD 测试文件
`cargo test -j 2 --test mbd_support_query --test mbd_branch_query --test mbd_object_endpoint --test mbd_http_endpoint
--test mbd_object_classify --test mbd_branch_fields --test mbd_equipment_query --test mbd_civil_query`：

- 求解器 `47eb83e`（`refactor` 提交的 `Cargo.toml` 指的 plant-mbd 主检出就是它）：**89 条全过**（`mbd_branch_fields` 11、`mbd_branch_query` 11、`mbd_civil_query` 16、`mbd_equipment_query` 10、`mbd_http_endpoint` 1、`mbd_object_classify` 18、`mbd_object_endpoint` 1、`mbd_support_query` 21）。
- 求解器 `94bf16b`：88 过、1 红——`mbd_support_query::ams_centreline_support_without_spre` 里**原有的**断言
  `assert_laid_out`（「出包里有尺寸链或标签」）：`/1RX03-MSUP-E0001` 的「管道信息」字高是 0，被 `94bf16b` 的出口自检拿掉了，
  只剩两条管道中心线。这是求解器代理在修的字高退路，不是这一轮宿主的改动造成的（同一份代码在 `47eb83e` 上是绿的）。
- 求解器 `3b47289`（01:05 的 `READY`，带字高退路）：**89 条全过**，上面那条转绿（日志 `host\build-test-3b47289.log`）。

**（4）改坏试验**：新加的判断逐个改坏、看测试红不红，14 处（`host\mutate.mjs` 的 A 组 8 处、B 组 4 处、C 组 2 处），每一处都有测试变红。
其中一处（清点里「有截面点的型钢」数反了）第一次没被抓住——用例里有截面点 / 没截面点的型钢各一根，数反了也是 1——
把用例改成 2 比 1 之后重试，抓住了（所以一共跑了 15 次）。

**（5）最终代码**（rustfmt 之后）重编出来的离线端点再跑一遍全部 7059 个：与格式化之前那一遍 7054 个整文件逐字节相同，
另外 5 个只差 `meta.source_version` 里「读过的库」清单（并发下先后顺序不同），其余相同。收尾时（01:05，求解器快照切回
`94bf16b` 重编之后）用工作树 `target\` 里现在的可执行文件又跑了一遍：7059 个与上一遍全部相同（7049 个整文件相同，10 个
只差那份清单的顺序）；这一遍的输出核对完就删了。

## 4. 没做到、没验证的

- **没有起旁路后端**（任务书里「重的那条路」）。离线端点走的是端点的同一个函数，HTTP 这一层只有 gen-model 原有的两条
  端点测试（`mbd_http_endpoint`、`mbd_object_endpoint`，都过了）覆盖；空支管经真 HTTP 回 200 没有单独打过。
- **PML 的行为都是读源码推断**，没有在 E3D 里跑过：SCTN 没有 SPREF 时出错、PJOI 没有 P5 时出错、空支管的走向。
- **E3D 里的事实只有旁证**：「SPRE 是 Nulref 的 SCTN 只画中心线」来自 e3d-model 的注释（它对过 E3D 的 RVM 导出），
  我核对的是 `.dat` 里的原值。
- 22 根悬空的 `SPRE` 指向的三个目录元素为什么不在 5052 里，没查。
- 求解器代理 01:05 的 `READY`（`3b47289`）已经带进重放与测试。它**还在途**的两项（安装角度半径不小于半个字长 D-PIPE-046；
  triage 并入的三条诊断修正）没有 `READY`，**没有带进来**。它们提交之后要再跑一遍：
  `git -C <plant-mbd 快照> checkout --detach <提交号>`，重编四个 example（约 2 分钟），再照
  第 3 节（1）（2）（重放 2 分钟、过前端 1 分钟）。
- 我的分支单独检出来编不过（见第 2 节），提交本身只在「带两处验证用改动」的工作树里编译、测试过。
- `mbd_branch_dump`（切段成员形状）对空支管仍然报根错误、不出文件，没改。

## 5. 需要用户拍板的

1. **空支管回 200 还是 422。** 我改成了 200（依据见 C.3）。如果要保持 422，把 `bf638ed3e` 里 `layout_pipe` /
   `layout_classified` 的 `branch_query_for_layout` 换回 `branch_query_with_diameters` 即可，那句话已经改对了。回 200 时数据包里
   那条 `data.empty_branch` 是求解器给的 **error** 级诊断（没有 `rule_id`）：空支管算不算「错误」、要不要降成 info，一并定。
2. **没有截面规格的型钢要不要按中心线标长度。** 206 个支架（146 空包 + 60 残缺）靠它才会有型钢尺寸。PML 在这种 SCTN 上
   出错、没有画法可依，要做得在求解器登记裁决（标什么：POSS–POSE 的长度？字高、偏移取多少？）。不做的话，这 206 个
   支架的最终状态是：146 个空包（数据包里说明了原因），60 个只有一条「管道信息」标签、没有尺寸。
3. **EM4 找管道附件只认名字（PML 原样）还是也认 HANG.HREF。** 59 个支架的 HREF 指着名字不合约定的 ATTA，现在按
   「没有管道附件」处理（没有管道信息标签、不找墙）。放宽是偏离 PML，要登记裁决。
4. **宿主新加的三句话的级别。** 两句 `data.view_issue` 是 warning（视图的话统一由求解器转成 warning），会让 228 个原先
   走通的条目多一条 warning（122 个缺截面 + 106 个 HREF）；带最新的求解器时是 288 个走通的条目（那 60 个不再被拒收的也
   带着「缺截面」这句：182 + 106）。觉得太吵可以把 HREF 那句去掉，或者只在空包时出。清点那句是 info。
5. **`refactor` 的 HEAD 单独编不过**（`manual_update.rs` 调用了只在未提交的 `fast_delete.rs` 里的函数）。不是这一轮的事，
   但任何人从干净检出编都会撞上。
6. **什么时候把这两个分支合进去、联调后端换不换。** 我没有合并、没有 push、没有动联调后端。合并时注意：hostpipe 代理的
   `fix/mbd-weld-dtxr` 也改 `src/mbd/branch_query.rs`（不同的段落）。
7. **房间号归哪块板**（求解器代理的第 1 条）：PML 字面在每块包围盒碰到房间的板上各写一遍，求解器按 D-CIVIL-017 只在标注点
   落进板顶轮廓的那块上写，于是建筑 152 个房间里 46 个、土建 135 个里 47 个一块板上都没有。要宿主给每个房间指定归属板，
   得先定规则（标注点所在的板？最近的板？）。我没有动。
