# 第一批 MBD 票：宿主（gen-model）一侧——host2 交回（2026-11-12）

做的人：host2。票的规格在 `.scratch\mbd-tickets\drafts\`（equipment-civil、support、pipe 三份），任务书 `.scratch\mbd-impl\BRIEF.md`。
同时做的还有 solver2（plant-mbd，见 `batch1-solver2.md`）与 tools（扫描脚本，见 `batch1-tools.md`）。

**口径**：「候选」= 全量扫描的 7059 个条目，「归属对象」= 按 `subject.refno` 去重的 6802 个。「核对过数据」= 在整类对象上数过或逐个比过；
「读代码推断」= 读 PML / Rust 源码得出、没有跑过。**PML 一行都没有在 E3D 里跑过。**「AMS 全库」= MDB `/ALL` 的 29 个设计库，用一个临时
探针从各库的 WORLD 整树走一遍（只读 `.dat`）。

## 1. 结论

| 票 | 做成了什么 | 依据 |
|---|---|---|
| CIVIL-5 | 没有截面（`SPRE` 没设）的 STWALL / WALL 作为土建归属对象被直接打开时，不交求解器，回空包 + 一条 Info `adapter.civil_wall_without_solid`（「没有截面，在 E3D 里没有实体，不标」）。 | 现状核对过数据：模板墙 `15201_379` 改前回 200、35 个凭空的图元（厚度、标高、局部坐标系，按 DESP 矩形）；改后两版求解器上都是空包 + 这一条，过前端是「空包」。AMS 全库没有 SPRE 的 STWALL / WALL 只有 `15201_379/380/381` 三面，都不在 838 个土建 / 建筑归属对象里。PML 在这种墙上不出图是读代码推断。 |
| CIVIL-4 | 建筑楼板旁的墙照 PML L1823 不收 SITE 名以 `/MDS` 开头的墙、不收没有 SITE 的墙。 | AMS 全库（核对过数据）：842 块墙板里在 `/MDS…` 站点下的 0 块；没有 SITE 的 4 块都在模板世界（三面没有 SPRE 的 STWALL 本来就被挡着，另一块是没有几何的 FLOOR `23393_4`，FLOOR 不算板旁的墙）。**对 AMS 零影响**：838 个土建 / 建筑对象的输入重导后逐字节相同，数据包也逐字节相同。没有 SITE 的墙 PML 不收是读代码推断（等 CIVIL-6）。 |
| SUPP-3 | 空的支架包只留一条「为什么空」：求解器已经说了 `support.nothing_to_annotate`（或 `support.no_parts`）宿主就不再补清点；配旧版求解器时照旧补。 | 核对过数据：配 `509b759` / `751e0cd`，197 个空支架候选（176 个归属对象：EM4 190 / 169，仪表管支架 7 / 7）每个有且只有一条「为什么空」（`nothing_to_annotate` 196、`no_parts` 1），`adapter.support_empty_package` 0 条；例 `24383_80213`、`24383_69177`、`24381_178965` 是前者，`24381_179219` 是后者。配 `47eb83e`：196 个候选的清点照旧在，全部 7059 个答复与改动前相同。 |
| EQUI-1 | 设备的基准点（第一个 ELCONN，否则原点）离自身几何的包围盒超过 5 m 时，宿主在数据包最后补一条 Warning `adapter.equipment_base_far_from_geometry`，写明距离（0.1 m）与基准点取的是什么，图元不动。 | 核对过数据：恰好 68 台、全是 em9_equi、都没有 ELCONN，5.9–27.7 m，中位 14.1 m；em4_equi 0 台；`24381_103159` 24.3、`24381_127703` 21.5、`24381_133122` 20.7、`24381_101930` 23.1 m，与票面相差不到 0.05 m；1–5 m 的 20 台（最远 `24381_31010` 4.95 m）没有。**先核对了包围盒包全了几何**：这 68 台的实体图元在 SPAMAP 里都有条目（没有条目的只是负体、SUBE、EXTR 的环与顶点）；另用 e3d-model 给每个实体图元建网格取包围盒，超过 5 m 的同样是这 68 台，网格都在宿主的包围盒里。 |
| EQUI-2（调查） | **没有漏库**，不改代码。 | 核对过数据，下面的表：29 个设计库里有墙板的 4 个（1112、6003、7009、7997），都有 SPAMAP 表、都参与找墙与楼板查询；没有 SPAMAP 表的 4 个（7027、7334、7353、7741）墙板 0、房间面板 0。墙板 842 块里 837 块在 SPAMAP 里有条目，没有条目的 5 块都没有几何（`17496_106456`、`17496_117236`、`24381_2162` 三块 GWALL，`24381_25747`、`23393_4` 两块 FLOOR：没有环，或环里没有顶点）。房间面板 230 块（7997 229、8000 1）全有条目。设备找墙、EM4 / EM9 支架找墙用的是同一个 `locate_candidates`，结论对支架同样成立（读代码）。 |
| PIPE-5（gen-model 一半） | 判型缺省表的注释不再说「金样 `24383_99996` 是真管道」，改成：它由 10 根 `/ACP1000-Ventilated` FTUB 组成、是通风电缆桥架；表照旧、桥架怎么判待定。 | 只改注释。`24383_99996` 的成员 FTUB 10、ATTA 14、TUBI 5、BEND 4、ELBO 3（核对过数据）；ELEC 站点只有一个，823 条 BRAN（核对过数据），都是桥架（PIPE 草稿核对过）。 |

**EQUI-2 的表**（核对过数据；「参与」= 宿主找墙、楼板旁的墙、房间三路都按库查 SPAMAP，有表才参与）：

| 库 | 元素 | 墙板（WALL / GWALL / STWALL / FLOOR） | SPAMAP 里有条目的墙板 | 房间面板 | SPAMAP 表 | 条目 | 参与 |
|---|---|---|---|---|---|---|---|
| 1112 | 30939 | 293（14 / 122 / 76 / 81） | 291 | 0 | 有 | 5139 | 是 |
| 6003 | 19 | 1（0 / 0 / 0 / 1） | 1 | 0 | 有 | 3 | 是 |
| 7009 | 545 | 4（0 / 0 / 3 / 1） | 3 | 0 | 有 | 68 | 是 |
| 7011 | 451 | 0 | 0 | 0 | 有 | 133 | 是 |
| 7015 | 12041 | 0 | 0 | 0 | 有 | 2328 | 是 |
| 7022 | 8572 | 0 | 0 | 0 | 有 | 3504 | 是 |
| 7027 | 157 | 0 | 0 | 0 | **没有** | 0 | 否 |
| 7048 | 10033 | 0 | 0 | 0 | 有 | 1280 | 是 |
| 7321 | 482 | 0 | 0 | 0 | 有 | 309 | 是 |
| 7324 | 13947 | 0 | 0 | 0 | 有 | 4419 | 是 |
| 7326 | 35855 | 0 | 0 | 0 | 有 | 28656 | 是 |
| 7327 | 42249 | 0 | 0 | 0 | 有 | 34210 | 是 |
| 7329 | 12762 | 0 | 0 | 0 | 有 | 4060 | 是 |
| 7330 | 3577 | 0 | 0 | 0 | 有 | 964 | 是 |
| 7331 | 3179 | 0 | 0 | 0 | 有 | 844 | 是 |
| 7332 | 3179 | 0 | 0 | 0 | 有 | 844 | 是 |
| 7333 | 199095 | 0 | 0 | 0 | 有 | 158818 | 是 |
| 7334 | 707 | 0 | 0 | 0 | **没有** | 0 | 否 |
| 7350 | 14793 | 0 | 0 | 0 | 有 | 4853 | 是 |
| 7352 | 199 | 0 | 0 | 0 | 有 | 48 | 是 |
| 7353 | 4 | 0 | 0 | 0 | **没有** | 0 | 否 |
| 7354 | 3861 | 0 | 0 | 0 | 有 | 1264 | 是 |
| 7356 | 2275 | 0 | 0 | 0 | 有 | 1083 | 是 |
| 7741 | 19 | 0 | 0 | 0 | **没有** | 0 | 否 |
| 7997 | 170082 | 544（48 / 133 / 170 / 193） | 542 | 229 | 有 | 51698 | 是 |
| 7998 | 1 | 0 | 0 | 0 | 有 | 0 | 是 |
| 7999 | 34706 | 0 | 0 | 0 | 有 | 21257 | 是 |
| 8000 | 6640 | 0 | 0 | 1 | 有 | 3629 | 是 |
| 250705 | 1038 | 0 | 0 | 0 | 有 | 40 | 是 |
| 合计 | 611407 | 842 | 837 | 230 | 25 有 / 4 没有 | | |

「所钉会话」是离线端点的口径（各库最新会话），与联调后端服务端按 MDB 钉的是否一致没有核对。

**做的时候查到、票面没写对的两处**（读代码）：

- CIVIL-4 票面与决定 CIVIL-D6 说「土建窗体两处收墙（L2942、L3204）没有 SITE 条件」。这两段都在 `$( … $)` 注释块里（L2934–3189、
  L3192–3257）；土建窗体对楼板实际走 `.draw()` → `getwallsonfloor()` → L3266 `getonwallindices()`，与建筑窗体同一个方法，同样带 L1823 的
  `/MDS*` 条件。按票只改了建筑楼板，代码注释写明了差别；土建楼板这一半是**票 32 的另一半（决定 #24 选 A 时一并做）**（第 5 节）。hostpipe 在
  `2c50ea7a2` 的注释里引的「土建 L2948-2963」同样在注释块里，这次顺带改正了那句注释。
- EQUI-1 票面写「plant-mbd 出这条诊断、gen-model 不动」；任务书把它分给宿主。做在宿主：出包后追加一条（与支架空包的清点同一处），规则号按
  宿主的惯例用 `adapter.*`。好处是新旧两版求解器上一样；代价是「宿主视图 → 求解器 CLI」那条离线路（求解器金样、归因网格）上看不到它，
  与 `adapter.support_empty_package` 相同。

**页面复查 N2 要的数（核对过数据，最终数据包）**：基准点离自身包围盒超过 1 m 的设备 88 台，其中带定位尺寸的 54 台、共 102 条
（与页面复查的数相同）；超过 5 m、带这条 warning 的 68 台里，带定位尺寸的 39 台、共 73 条；1–5 m 的 20 台里 15 台带、共 29 条，没有
warning。`2c50ea7a2` 动过的 36 台设备里 33 台在超过 1 m 的那 88 台里（27 台超过 5 m）。没有改这些尺寸（新的决定 #34 未定）。

## 2. 改了什么

仓库 gen-model，工作树 `gen-model-mbd-tickets`（与 plant3d-web 主检出同一个父目录），分支 `fix/mbd-tickets-host`，起点 `92764a73d`
（`integ/mbd-live-sweep`），五笔本地提交，没有 push、没有合并：

| 票 | 提交 | 文件 |
|---|---|---|
| PIPE-5（gen-model 一半） | `3d7d8eae2` docs(mbd) | `src/options.rs`（`default_mbd_type_rules` 的注释） |
| SUPP-3（决定 SUPP-D3 的推荐 B） | `c0c84c65a` fix(mbd) | `src/mbd/object.rs`（`support_empty_package_issue` 也认 `support.nothing_to_annotate`）、`src/mbd/support_query.rs`（文档）、`tests/mbd_support_query.rs` |
| CIVIL-5 | `17299b471` fix(mbd) | `src/mbd/civil_faces.rs`（`wall_without_solid`、`lacks_solid`）、`src/mbd/object.rs`（`layout_classified` 先判、`wall_without_solid_package`、`RULE_CIVIL_WALL_WITHOUT_SOLID`）、`tests/mbd_civil_query.rs` |
| CIVIL-4（决定 CIVIL-D6 的推荐 A） | `ff07dbc68` fix(mbd) | `src/mbd/civil_query.rs`（`floor_wall_site`、`floor_wall_site_admits`、`floor_wall_site_passes`，`floor_walls` 在建筑楼板上先过这一条）、`tests/mbd_civil_query.rs` |
| EQUI-1（决定 EQUI-D1 的推荐 A） | `15ea6df3f` feat(mbd) | `src/mbd/equipment_query.rs`（`base_offset`）、`src/mbd/object.rs`（`equipment_base_far_issue`、`RULE_EQUIPMENT_BASE_FAR_FROM_GEOMETRY`、`EQUIPMENT_BASE_FAR_MM`）、`tests/mbd_equipment_query.rs` |
| EQUI-2 | 没有 | 调查，没有查出要改的 |

- **每一笔都能单独丢掉**：对分支头逐笔做反向的三方合并检查（`git apply --check -R --3way`，`git revert` 用的就是三方合并），五笔都没有
  冲突。中途为此重排过后三笔（`commit-tree` + 带旧值校验的 `update-ref`，树的内容只是挪了几处代码与注释的位置）；之前的提交号
  `b05bf36c2`、`b19a6a8ed`、`6353dcd6d`、`e7bdd435e`、`00c7f775b` 已不在分支上。
- 规则号：`adapter.civil_wall_without_solid`（Info）、`adapter.equipment_base_far_from_geometry`（Warning），都是宿主出的，同
  `adapter.support_empty_package`，没有在求解器仓登记（求解器仓没有宿主规则号的登记处）。
- 工作树里两处只为验证、没提交：`Cargo.toml` 第 185 行指到求解器快照；`src/data_interface/manual_update.rs` 一行（`refactor` 一系 HEAD
  单独编不过，照 `status\host.md` 的办法）。联调后端的配置、8022、别人的工作树都没碰。

## 3. 怎么验证的

都在真实数据上（AMS，29 个设计库 + 五个目录库目录，只读 `.dat`），没有起后端。cargo 每条都带 `-j 2`。

**（1）gen-model 的 8 个 MBD 测试目标**（`mbd_support_query`、`mbd_branch_query`、`mbd_object_endpoint`、`mbd_http_endpoint`、
`mbd_object_classify`、`mbd_branch_fields`、`mbd_equipment_query`、`mbd_civil_query`），最终的树，`--nocapture`，放了
`field-24383_99996.json` 的副本让那条读老 fixture 的用例真跑（跑完删了），没有一条 SKIP：

| 求解器 | 结果 | 各目标 |
|---|---|---|
| `47eb83e`（联调后端） | **101 / 101** | 11 / 14 / 21 / 13 / 1 / 18 / 1 / 22 |
| `751e0cd`（solver2 最新 READY，含 `049deda`、`77cb238`） | **101 / 101** | 同上 |

原先 94 条（`integration.md` 第 3 节），新增 7 条：支架 1、土建 4、设备 2。中途在 `509b759` 上也跑过一遍，101 / 101。支架那条真库用例
`ams_skeleton_support_says_what_it_holds` 按编进来的求解器各走一支：`47eb83e` 上「求解器没说，宿主的清点就是那一条」，`509b759` /
`751e0cd` 上「求解器说了，清点不出」。

**（2）改坏试验**（10 处，三批编，每批里各处的改坏只会让各自的用例红）：

| 改坏 | 红的用例 |
|---|---|
| SUPP-3：判断里去掉 `support.nothing_to_annotate` | `the_inventory_is_not_repeated_after_the_solver_said_why_the_package_is_empty`、`ams_skeleton_support_says_what_it_holds`（`509b759` 上两条「为什么空」） |
| CIVIL-5：`lacks_solid` 只认 STWALL | `only_stwalls_and_walls_without_spre_lack_a_solid` |
| CIVIL-5：入口的判断改成建筑 | `a_wall_without_a_section_opened_directly_is_an_empty_package`（35 个图元回来了） |
| CIVIL-4：没有 SITE 的墙判成收 | `the_floor_wall_site_condition_follows_pml`、`arch_floor_walls_leave_out_mds_and_siteless_walls` |
| CIVIL-4：前缀改成 `/MDS-` | 同上两条 |
| CIVIL-4：「只在建筑楼板」反过来 | `arch_floor_walls_leave_out_mds_and_siteless_walls` |
| EQUI-1：`>` 改成 `>=` | `a_base_point_far_from_the_equipment_box_is_called_out`（刚好 5 m 那一条） |
| EQUI-1：出包后不追加 | `ams_copied_equipment_far_from_its_origin_is_called_out` |
| EQUI-1：基准点标成原点 | `a_base_point_far_from_the_equipment_box_is_called_out`（ELCONN 那一条） |
| EQUI-1：原点优先于 ELCONN | 同上 |

CIVIL-4 原先在 `floor_walls` 里的那句「只在建筑楼板才筛」在 AMS 上没有能触发它的墙，改坏不会红；为此把它收进
`floor_wall_site_passes`，用真库元素在两种楼板上各测一遍，改坏就红（上表第 6 行）。

**（3）离线端点全量重放**（`examples/mbd_object_respond`，走 `GET /api/mbd/v2/object/{refno}` 的同一个函数，全部 7059 个候选；
比较时剪掉 `meta.source_version`）：

| 比的是 | 相同 | 不同 | 不同的都是什么 |
|---|---|---|---|
| 改动后 vs 改动前，求解器都是 `47eb83e` | 6991 | 68 | 68 台 em9_equi 只在最后多一条 `adapter.equipment_base_far_from_geometry`，别的逐字节相同 |
| 改动后（`509b759`）vs `integ\final-payloads` | 6795 | 264 | 196 个支架空包（em4_supp 190、em9_pipe_supp 6）只少一条 `adapter.support_empty_package`；68 台设备只多那条 warning。状态码一个没变 |
| 改动后，`751e0cd` vs `509b759` | 6566 | 493 | 全是 solver2 那几笔：457 个土建 / 建筑包的 `civil.member_off_face` 并成一条，36 个 EM4 支架多 `support.bolt_angle_centre_missing`；没有图元变化 |

CIVIL-4、CIVIL-5、PIPE-5 在 7059 个里一个都不动（预期如此）。另用导出工具把 838 个土建 / 建筑对象的视图（求解器输入）重导一遍，与
`.scratch\mbd-multitask\fixtures`（`all` 叠上 `all-final-changed`）逐个比：**838 个逐字节相同**（CIVIL-4「输入逐字节不变」那一条）。
不在 7059 里的模板墙单独重放：`15201_379/380/381` 改前 200、35 个图元，改后 200、0 个图元、恰好一条 `adapter.civil_wall_without_solid`
（两版求解器相同）；`23393_4`（没有几何的模板 FLOOR）不变，仍是 `civil.geometry_missing`。

重排后三笔之后，最终的树在两版求解器上重编、重放：`751e0cd` 上 7059 个与重排前逐字节相同；`47eb83e` 上改动涉及的 68 个与模板墙 4 个
逐字节相同。

**（4）过前端**（用 tools 分支上的新扫描脚本，认 `index.jsonl`，自己 scratch 下的 Vite 缓存目录，不连 8022）：

- 最终状态（宿主 `15ea6df3f` 的树 + `751e0cd`）全部 7059 个：按候选 走通 6721 / 空包 267 / 不可标注 71，按归属对象 6485 / 246 / 71，
  契约 / 映射拒收、退化都是 0；排版 239387 条记录，关掉 LOD 仍画不出来 0 条，非有限数 0，带 LOD 一条都不画的 8 个（7 个支架、1 块建筑
  楼板）——与 tools 在 `final-payloads` 上的基线逐项相同。
  与汇合时的前端结果逐对象比：7059 个的结局、图元数、记录数、排版统计全部相同。诊断条数 info 78374 → 9169（solver2 的 CIVIL-3 −69051、
  SUPP-1 +42，SUPP-3 −196），warning 4865 → 4933（EQUI-1 +68），error 11 → 11。
- 改动涉及的对象另用主检出的脚本按 `--refnos` 过了一遍（都是 200）：`509b759` 上 264 个、`47eb83e` 上 68 个，结局、图元数、记录数、排版与
  改动前逐个相同；模板墙三面改前「走通」（35 个图元），改后「空包」，没有拒收。

**（5）EQUI-1 的包围盒核对**、**EQUI-2 的全库清点**：临时探针 `examples/mbd_host2_probe.rs`（没提交，源码留在
`.scratch\mbd-impl\host2\mbd_host2_probe.rs`），结果 `probe-inventory.jsonl`、`probe-equi.jsonl`、`probe-equi-model.jsonl`。

**（6）rustfmt**：动过的文件 `rustfmt --edition 2024 --check` 干净。clippy 没跑（gen-model 全量太重，与之前各代理相同）。

## 4. 没做到、没验证的

- **PML 的行为都是读代码推断**：没有截面的墙 PML 不出图、没有 SITE 的墙 PML 不收、`matchwild` 分大小写（宿主照求解器 `kd_points::matchwild`
  按大小写原样比）。CIVIL-4 里「没有 SITE 的墙不收」这一支照票以 CIVIL-6 的实机结果为准。
- **页面没看、联调后端没换**。新包在页面上的样子（诊断面板里这两条新的话）没有看。
- 没有截面的 **WALL**：判据守住了（合成用例），AMS 没有这种墙，真库上没验证过。找墙与楼板旁的墙仍只挡 STWALL（`stwall_without_solid`），
  没有截面的 WALL 在那两处仍按 DESP 参与——票没要求，AMS 没有，记在 `.scratch\mbd-impl\host2\new-tickets.md` 的「还没弄清的」。
- 建筑模式下打开没有截面的墙照旧是求解器的 `civil.arch_floor_only`（本来就是空包 + 一条 Info），没有换成新的说法。
- EQUI-2 的「所钉会话」是离线端点的口径（各库最新会话），没有核对联调后端服务端按 MDB 钉的会话是不是同一个。
- 中间几笔提交单独检出各自编不编得过没有逐个编（只编了最终的树）；按构造各笔之间没有代码依赖，且逐笔反向三方合并都没有冲突。
- 「宿主视图 → 求解器 CLI」那条离线路看不到 EQUI-1 与 SUPP-3 的宿主侧变化（它们在出包之后），金样与归因网格里也就没有。
- gen-model 其余测试目标与 clippy 没跑。

## 5. 需要用户拍板的（新冒出来的）

1. **土建楼板的 SITE 条件——不是新决定，是票 32 的另一半（决定 #24 选 A 时一并做）。** PML 的土建窗体与建筑窗体收板旁的墙是同一句
   （L1823），票面的「土建没有」是把注释块当成了生效代码（读代码）。整合清单第二轮已把决定 #24 的范围更正成建筑与土建两种楼板，票 32 的
   交付也写的是两种楼板；第一批只做了建筑那一半。土建这一半现在不做，等 #24 的答复（选 A：宿主去掉「只在建筑楼板」一处、改一条用例，
   AMS 上零影响，184 块土建楼板输入不变）。记录：`.scratch\mbd-impl\host2\new-tickets.md`。（原先这里用的两个编号已被另一件事用掉，作废。）
2. **（转述，已立为决定 #34）原点离几何很远的设备要不要画定位尺寸**：第 1 节末的数供参考——warning 的 5 m 阈值盖住带定位尺寸的
   54 台里的 39 台，另 15 台（1–5 m）没有 warning。
3. EQUI-1 做在宿主而不是求解器（任务书的分工，票面写的是求解器）：如果希望离线 CLI / 金样里也有这条，以后要挪到求解器——不急，列出来。
