# 第一批 MBD 票：求解器（plant-mbd）这一侧的交回（solver2，2026-11-12）

任务书 `.scratch\mbd-impl\BRIEF.md`；票的规格在 `.scratch\mbd-tickets\drafts\`（CIVIL-2 / CIVIL-3 在 `equipment-civil.md`，SUPP-1 在
`support.md`，PIPE-5 在 `pipe.md`）。临时文件与脚本在 `.scratch\mbd-impl\solver2\`，状态文件 `.scratch\mbd-impl\status\solver2.md`，
查出来要用户定的写成了票草稿 `.scratch\mbd-impl\solver2\new-tickets.md`。

**可靠程度**：「核对过数据」= 在宿主导出的全部真实输入（`fixtures\all` 叠 `all-final-changed`，6988 个）、最终数据包、`.dat` 原始属性上
数出来的，或用求解器 CLI 改一处输入试出来的；「读代码推断」= 读 PML / Rust 源码得出。**PML 一行都没有在 E3D 里跑过。**

## 1. 结论

**四张票都做完了：三笔提交（CIVIL-3、PIPE-5、SUPP-1 查出的一处修补）全过门禁、标了 READY；两张调查票都有结论；CIVIL-2 查出一处要用户
定容差的问题，写成了票草稿，没有改代码。**

### CIVIL-3：`civil.member_off_face` 每个数据包并成一条（`049deda`）

- **做成了什么**：每个包最多一条 Info，写总数；按构件类型分项（从多到少，每种列宿主交来的前 5 个 refno）；按原因分项（AB 埋板的探测线
  打不到两个面 / 棱线不过任何面 / 孔心不在面上或在轮廓外，与原先三种逐条的话一一对应）；按属主分项（埋板就是它所在的 AB / AK / AT 框架，
  列前 3 个、其余合一项、没有属主名的单列）。三种分项各自加起来都是总数。位置与 id 用原先第一条的，`refno` 照旧是墙板，`object_refno`
  不填。图元一个不变。按决定 CIVIL-D3 的推荐（B）。
- **信息不丢**：个数（总数与三种分项）、构件怎么查得到（属主框架名、每种类型的 refno 例子）都在这一条里；逐个的清单不进数据包，用求解器
  CLI `layout --fixture <宿主导出的视图> --case <refno> --verbose` 在 stderr 逐行打（库里是 `civil::layout_civil_with_members_off_face`），
  在 457 个包上与改前逐条的 refno 顺序逐个相同（核对过数据）。
- **先查的依赖**（读代码）：前端只把诊断当文字列出；诊断面板的「定位」按钮用的是诊断的 `refno`（土建的诊断都是墙板自己），不读
  `object_refno`，代码里没有认 `civil.member_off_face` 的地方——所以票草稿说的「面板上逐块『定位』按钮跟着没了」不成立，原先就没有逐块
  定位。gen-model（`92764a73d`）的代码与 8 个 MBD 测试目标都不认这条规则。
- **数**（核对过数据，全部 6988 个输入、与改前的 CLI 比）：457 个包变（土建 441、建筑 16），其余 6531 个逐字段不变；69508 条 → 457 条；
  `24381_25804` 的诊断 684 → 4 条，汇总那条写 681；`17496_98592` 写 924。图元、直段表、`meta` 一个字段都没变，别的诊断内容不变
  （`civil.member_shape_missing` 596、`civil.dim_degenerate` 696 等），46 个包里排在它后面的诊断 id 序号前移（`Out::issue` 按条数编号）。
  每条的总数、按类型、按原因、按属主、例子都与改前逐条的对过，没有不符。汇总那条最长 605 个字符。457 个包的负载 54.2 MB → 34.5 MB。

### SUPP-1：三个「分不清」的类别在真实数据上核实（调查）——三格都是「无数据」

| 类别 | 结论 | 依据 |
|---|---|---|
| EM4 螺栓孔角度 | 无数据：库里没有一块板满足 PML 画它的前提 | 全部 EM4 支架的 541 块 PANE（去重），第一个 PLOO 都只有 4 个 PAVE（`.dat` 原始属性逐块核对过）。有 NCYL 孔的 75 块（62 个支架）：53 块 2 孔 2 PFIT，PML 要求 PFIT 多于 2 个（L1805），到不了这一步，PML 相同；22 块（19 个支架、36 个候选）是 410 × 410 方底板、4 个 Φ21 孔排成方形、4 个 PFIT，过得了 PFIT 与「不在孔距链里的孔多于 2 个」两条，但 PML 取第一个 PLOO 的**第 5 个** PAVE 当圆心（L1877-1878），这些板只有 4 个——PML 在这里出错、整个支架不出图（读代码推断）。例：`24383_69262`（支架 `24383_69245`） |
| EM4 护板说明 | 无数据：库里没有弧形护板 | PML 只把「建 `supportpane` 时 `height` 没设」的 PANE 当护板（`getPaneSctns` L38-53），也就是没有 PLOO 的 PANE（`supportpane` L39-44，读代码）。541 块支架 PANE 都恰好有一个 PLOO（原始属性核对过：466 块只有 PLOO，53 块另有 2 NCYL + 2 PFIT，22 块另有 4 NCYL + 4 PFIT，没有 NBOX、NXTR）；宿主那条更宽的判法（NBOX 与 NCYL 同在）也一块都没有，宿主视图里没有一个 `pane_pad` |
| EM9 仪表管支架的二级尺寸 | 无数据：92 个仪表管支架一块能当板的构件都没有 | 二级尺寸只出在「单板」构件上（第一个接触点离板心比离边近，`chains::pane_lines`）。用求解器自己的构件分类（临时探针，跑完删了）在 165 个候选上数：只有型钢 340、螺栓 232、管夹 204、点 96（按候选计），没有一块板（单板 / 多板都没有） |

- **查出的毛病，已修（`751e0cd`，裁决 D-SUPP4-034）**：上面那 22 块板，PML 出错（读代码推断），求解器原先一声不响地不画、照出其余，与 PML
  不同却没有登记。修法清楚、不卡决定：检查先后改成与 PML 相同，照旧不画螺栓孔角度、其余图元一个不变，另留一条 Info
  `support.bolt_angle_centre_missing` 点名板、孔数与 PAVE 数，补登裁决。全量重算：36 个 EM4 支架候选各多 1 ~ 2 条（共 42 条），别的不变
  （核对过数据）。没有别的查出「该有却没有」，没有另开 bug 票。

### CIVIL-2：1019 个哪块墙板上都没标上的土建构件（调查）

在最终数据包（逐块点名的那一版）上复核：不在面上的构件去重 6470 个，5451 个在别的墙板上标上了，**1019 个哪都没标上**（PANE 661、NXTR 156、
SBFI 145、NCYL 31、NRTO 10、FITT 7、NBOX 5、FIXING 4），与票面相同（核对过数据）。逐个归因：几何按宿主给的墙板面（圆角按切圆取样）与构件
棱线 / 板面独立地算（核对过数据），PML 会怎样是读代码推断：

| 组 | 个数 | 是什么 | PML 会怎样 |
|---|---|---|---|
| 埋板贴在 GWALL 的 A / B 以外的面上 | 296 | 贴在被试过的 GWALL 的端面或多折墙的其它竖向面上（离面 ≤ 30 mm、在轮廓内） | 同样不标：`getABpanedata` 只拿前两张面探（L1845-1931） |
| 埋板贴在楼板侧面 | 127 | 立着的板，在被试过的楼板厚度范围里、在板边上 | 同样不标：楼板只有上下两张面 |
| 埋板贴着 A / B 面，按取面规则差一点 | 13 | 例：外侧板面离墙面 29.9 mm 对容差 30、板跨在轮廓边上 | 同一套算法，同样不标 |
| 埋板贴在一块从没拿它试过的墙板上 | 34 | 它的 AB 框架从那块墙板的名字找不到（20 块对着另一套重叠土建模型的墙） | 同样不标：AB 框架按名字收（`!!getabakt`） |
| 埋板哪块扫到的墙板上都不在 | 191 | 43 块只是在楼板 1000 mm 的宽容差里、并不贴着；130 块离某个面的平面近、却在轮廓外很远（中位 34 m）；18 块哪都不挨 | 同样不标 |
| 棱线 / 轴线与面平行 | 110 | NXTR 83（楼板里横着拉伸的开孔）、NCYL 27 | 同样不标：夹角 < 85° 才求交（L819） |
| 穿过面所在的平面、却在轮廓外（在墙板旁边） | 177 | SBFI 145（其中 111 个实际穿的是旁边的楼板，`coll all … for 墙板` 收在墙板名下）、NXTR 22、FITT 5、NCYL 4、NBOX 1 | 同样不标：交点不在面内 |
| 整个在面外（板上 / 板下 / 墙外） | 45 | NXTR 35（例：`24381_38722` 在建筑面层板下 80 mm）、NRTO 8、FITT 2 | 同样不标 |
| 整个埋在墙身里，哪个面都不到 | 13 | NXTR 9、NBOX 4 | 同样不标 |
| 过了面、孔心不在面上 / 在轮廓外 | 6 | NXTR 4、NRTO 2 | 同样不标（`checkifok`；NRTO 在 PML 里本来就没有形状） |
| 弧墙上的套管 | 4 | 3 根两端与弧面差 0.5 µm ~ 0.21 mm（长度正好等于墙厚），1 根整个在墙身里 | 那 1 根同样不标；3 根取决于 AVEVA `onprojected` 的容差（见下） |
| NXTR 正好在面轮廓边上 | 3 | 1 个大开孔沿 GWALL 的轮廓边、2 条 7.6 × 18 mm 的细条，差 0.01 ~ 0.1 mm | 取决于 AVEVA 轮廓边界的判法，判不准 |

合计 1019。**1013 个与 PML 一致**（PML 同样不标；套管挂错属主、埋板在侧面上这两类是 PML 的取面 / 收集范围之外，若要标得偏离 PML，写成了决定
CIVIL-D9，推荐保持）。**6 个落在端点 / 边界容差上**：其中 3 根弧墙套管核对过——求解器严格按交点参数落在 [0, 1] 判，端点各往外伸 0.001 mm
就标上了（CLI 试过）。容差取多大要用户定（AVEVA 的容差没有实机依据），写成决定 CIVIL-D8 与票 CIVIL-7，没有改代码：放到 0.01 mm 只动弧墙时全库只变
3 个包（3 根套管标上）；平面墙也放宽则 23 个包变，其中 19 个包里已标的孔轮廓跟着变，没有逐个核对，所以不直接做。

### PIPE-5（plant-mbd 那一半）：五份老 fixture 的首尾坐标系注明（`77cb238`）

- 求解器仓 `fixtures/field-*.json` 里落在属主链不是单位阵的 ZONE 的五份（按宿主的 340 条清单核对：4 份在 `/1RX02-LCT` 平移 (0, 0, 80)，
  `field-24383_76191` 在一个整体平移 (−300, −300, 0) 的旧方案备份 ZONE），与现在宿主导出的原值 / 世界系逐份对过（核对过数据）：
  **Head 是属主系原值**（与原值差 0）；**Tail 不是属主系**，是当时导出工具取的末成员出口点（世界系）——4 份与世界系的 TPOS 相差不到 0.01 mm，
  `24383_76191` 少了最后那段 2617 mm 的隐含直管、与现在的 Tail 不是同一个点。票面写的「首尾是属主系」与数据不符，按核对结果写。
- 金样 README 讲这批 fixture 的那一段补了逐份的表（ZONE、位移、Head / Tail 的值、「不要与现在的宿主导出直接比」）；`layout.rs` 读
  `field-24383_99996` 的单测注释原把「Head 比首根 FTUB 低 80 mm」说成源模型缺陷，改成属主系原值；README、MIGRATION 各一句。按决定 PIPE-D9 的
  选择（A：只注明，不改数据）。顺带：金样 README 里一处带地名的 ZONE 名换成中性说法加 ZONE 的 refno（公开仓库的规矩）。

## 2. 改了什么

- 仓库 plant-mbd，工作树 `<plant-mbd 工作树>`，分支 `fix/mbd-tickets-solver`（从 `509b759` 开），三笔本地提交，
  没有 push、没有合并：

| 提交 | 票 | 文件 |
|---|---|---|
| `049deda` | CIVIL-3 | `crates/plant-mbd/src/civil/{emit,members,mod,floor}.rs`、`crates/plant-mbd-cli/src/{main,object_case}.rs`、`crates/plant-mbd-cli/tests/layout_verbose.rs`（新）、`fixtures/object/civil-off-face.json`（新）、`docs/MIGRATION.md` |
| `77cb238` | PIPE-5 | `fixtures/golden/README.md`、`crates/plant-mbd/src/layout.rs`（只改注释）、`README.md`、`docs/MIGRATION.md` |
| `751e0cd` | SUPP-1 查出 | `crates/plant-mbd/src/support/em4/{dims,mod}.rs`、`fixtures/pml/rulings-support-em4.json`（D-SUPP4-034）、`docs/MIGRATION.md` |

- 金样一条都没改。别的仓库没有动。plant3d-web 主检出里只新加了本文件（不提交）。

## 3. 怎么验证的

- **门禁**（每笔各跑一遍，`-j 2`；脚本 `.scratch\mbd-impl\solver2\gate.ps1`，日志 `gate-*.log`）：

| | 基线 `509b759` | `049deda` | `77cb238` | `751e0cd` |
|---|---|---|---|---|
| `cargo fmt --all -- --check` | 干净 | 干净 | 干净 | 干净 |
| `cargo test --workspace -j 2` | 658 过 | 662 过（lib 520 → 522、CLI 37 → 38、新测试文件 1） | 662 过 | 663 过（lib 523） |
| `cargo run -q -p plant-mbd-cli -j 2 -- golden diff` | 49 一致 | 49 一致 | 49 一致 | 49 一致 |
| `cargo clippy --workspace --all-targets -j 2` | 原有 4 条 | 原有 4 条 | 原有 4 条 | 原有 4 条 |

- **全量「之前 / 之后」**：每笔的 CLI 在全部 6988 个最终输入上重算（`recompute-all.mjs`，约 40 秒），与上一笔的 CLI 逐对象比（f32 相等，
  去掉 `input_refno` 与 `meta.source_version`）。先校准：基线 CLI 与 `integ\final-payloads` 比，6792 个逐字段相同，196 个只差宿主端点另加的
  `adapter.support_empty_package`（CLI 这条路上没有），与汇合记录一致。结果（核对过数据，口径是候选；这几笔改的对象没有 STRU / REST 成对的
  重复问题——支架那 36 个候选是 19 个归属对象）：
  - `049deda`：457 个变，只差 `civil.member_off_face`（脚本 `civil3-compare.mjs`，逐条对账、`--verbose` 清单逐个对）。
  - `77cb238`：只改说明，测试与金样不变（没有重算的必要，CLI 代码与上一笔相同）。
  - `751e0cd`：36 个变，只多 `support.bolt_angle_centre_missing`（脚本 `rule-compare.mjs`：图元 / meta / 信封 / 别的诊断含 id 都不变）。
- **过前端**：主检出根目录 `node scripts/mbd-live-sweep.mjs --payload-dir <之前 / 之后的目录> --refnos <变了的对象> --save-payloads none
  --out .scratch/mbd-impl/solver2/sweep-*`（模型树只读地问 8022，只发 GET）。CIVIL-3 的 457 个、SUPP-1 修补的 36 个：结局（ok / empty）、
  记录数、排版结果逐个与之前相同，没有新增拒收（建筑 3 个空包之前就是空包）。
- **改坏试验**（`mutate-batch.ps1`，拷自 solver 的脚本，日志 `mutations.log`）：CIVIL-3 26 处（计数、例子个数、排序与并列、占位位置、级别、
  不点名构件、三种原因的对应、类型名与属主名的规整、返回清单、CLI 的类型过滤与打印），SUPP-1 修补 8 处（检查先后、记不记、孔数、PAVE 数、
  取第几个 PAVE、级别、点名、出不出）：全部被测试抓住。
- **调查用的**：SUPP-1 —— `supp1-scan.mjs`、`support-panes.mjs`、原始属性探针（`host\probe-subtree.ps1` + `integ\bin-d31a989` 的
  `mbd_subtree_probe`，只读 `.dat`，541 块 PANE 的子树）、一个临时求解器探针（EM9 构件分类，`examples/` 下未跟踪的文件，跑完删了，拷贝在
  `probe_supp1_em9.rs.txt`）。CIVIL-2 —— `civil2-scan.mjs`（复现 1019）、`civil2-geom.mjs` / `civil2-pane.mjs` / `civil2-where.mjs`
  （几何归因）、`civil2-arc*.mjs` 与 `exp-*.mjs`（用 CLI 改一处输入试）、容差试验（在 `751e0cd` 之上临时改代码编 CLI、全量重算，代码已改回，
  工作树与 HEAD 相同）。

## 4. 没做到、没验证的

- **页面没有看**，联调后端没有换：结论都在离线这条路上（CLI 与宿主端点在全部输入上逐字节等价是汇合时校准过的，这次又校准了一遍）。
- **gen-model 的 8 个 MBD 测试目标我没有跑**（归 host2，READY 行里写了提醒）。读代码看它们不断言这几条规则。
- **PML 的行为全是读代码推断**：螺栓孔角度取不到第 5 个 PAVE 时出错停画、`getABpanedata` 只探前两张面、AVEVA `onprojected` / 轮廓边界的容差。
- CIVIL-2 的几何归因是我在脚本里独立算的（圆角按 16 段切圆取样），离面轮廓一两毫米以内的个别构件可能归错组；「1013 个与 PML 一致」靠的是
  PML 的取面 / 收集规则（读代码）加这套几何，不是把 PML 跑一遍。191 块「哪块墙板上都不在」的埋板、27 个哪块都不穿的套管在模型里到底挂在哪、
  34 块埋板的框架为什么按名字找不到，没有逐个查。
- CIVIL-D8 放宽平面墙之后那 19 个包里孔轮廓的变化，没有逐个核对对错。
- SUPP-1 的仪表管支架结论用的是求解器自己的构件分类；若它与 PML 的分类不同，结论跟着变（没有理由认为不同，没有核对）。
- 汇总那条诊断的话是英文（与求解器别的诊断一致），中英混排的问题归第 4 人。

## 5. 需要用户拍板的（新冒出来的）

1. **CIVIL-D8：棱线端点贴着墙面的构件算不算穿过墙面（端点容差）。** 推荐 B：只放宽弧墙的求交（0.01 mm，与仓里对 PML `line.on` 的假定相同），
   全库只变 3 个包、3 根套管标上；平面墙一起放宽会动 23 个包、其中 19 个已标的孔轮廓变化，要先核对；也可以先等 CIVIL-6 在 E3D 里看。→ 票 CIVIL-7。
2. **CIVIL-D9：PML 取面 / 收集范围之外的埋板与套管要不要标。** 296 块埋板贴在 GWALL 其余面上、127 块贴在楼板侧面、111 个挂在墙板名下的套管
   实际穿过楼板；PML 都不标。推荐 A：保持 PML，套管挂错属主交给建模。选 B 才开备用票 CIVIL-8（偏离 PML，影响几百个包）。
3. 已做、可以整笔丢掉的（按推荐做的，用户不同意时撤）：`049deda`（CIVIL-3，按 CIVIL-D3 的推荐 B）；`751e0cd` 里那条新 Info（不要它的话只留
   裁决登记即可，图元不受影响）；`77cb238`（PIPE-5，按 PIPE-D9 的 A）。
