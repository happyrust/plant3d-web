# MBD 全量联调扫描 2026-11-11T14:13:48.776Z

- 后端：{"version":"0.1.44","started_at":"2026-11-11T16:10:00.024815600+08:00","project":"AvevaMarineSample","mdb":"/ALL"}（模型树 http://127.0.0.1:8022，MBD http://127.0.0.1:8022）
- 扫了 75 个对象，用时 1 秒；取数耗时 p50 / p90 / p99 / 最长 = 0 / 0 / 0 / 0 ms

## 标注类型 × 结局

| 类型 | 合计 | degenerate | ok |
|---|---|---|---|
| civil | 3 | 0 | 3 |
| em4_pipe | 10 | 6 | 4 |
| em4_supp | 61 | 5 | 56 |
| em9_pipe | 1 | 0 | 1 |

## 不是 ok 的原因（结局 | 类型 | 原因）

- 6 × degenerate | em4_pipe | 合契约，但画出来看不见：<n> 个弧 / 圈的半径小于 <n> mm（例：24383_100538、24383_91813、24383_97932、24383_97968、24383_99749）
- 5 × degenerate | em4_supp | 合契约，但画出来看不见：<n> 个图元的全部点缩在 <n> mm 以内（例：24381_71247、24384_2250、24384_2265、24384_2280、24384_2295）

## 求解器 / 宿主 issues（级别 | 类型 | 类别 规则号 | 内容）

- 681 × info | civil | suppress civil.member_off_face | PANE <refno>: centre is off its face or outside its outline (civilMem.checkifok L<n><n>)（例：24381_25804）
- 195 × info | em4_supp | data support.part_geometry_missing | SCTN <refno> has no usable section data (POSS / POSE / section points); skipped（例：24384_108、24384_1194、24384_138、24384_1569、24384_1584）
- 122 × info | em4_supp | other locate.near_wall | the nearest hit <n> mm away is a WALL; PML only records it as a near wall for supports and stops searching that direction, so no locating dimension is drawn there（例：24381_71247、24384_108、24384_1194、24384_138、24384_1569）
- 61 × warning | em4_supp | data contract.invalid_primitive | label <refno>:support:label:<n> cannot be drawn and was dropped: text_height_mm = <n> is not a finite number of at least <n> mm（例：24381_71247、24384_108、24384_1194、24384_138、24384_1569）
- 55 × info | em4_supp | other locate.no_wall | no STWALL / GWALL found within <n> m to locate against（例：24381_71247、24384_108、24384_1194、24384_138、24384_1569）
- 22 × warning | em4_pipe | suppress adapter.implied_tube_not_drawn | implied tube <refno> -> <refno> (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24383_100161、24383_100538、24383_76345、24383_97932、24383_97968）
- 6 × warning | em4_supp | other locate.single_wall | only the north-south wall was found; PML draws nothing in this case (mbdlocation.pmlobj:<n>), the one locating dimension is kept（例：24384_440、24384_627、24384_747、24384_807、24384_828）
- 4 × warning | civil | data contract.invalid_primitive | aid_circle <refno>:thick:A:circle<n> cannot be drawn and was dropped: radius = <n> mm is below <n> mm, the arc collapses to its centre（例：24381_2147、24381_4342）
- 4 × warning | civil | data contract.invalid_primitive | aid_circle <refno>:thick:B:circle<n> cannot be drawn and was dropped: radius = <n> mm is below <n> mm, the arc collapses to its centre（例：24381_2147、24381_4342）
- 4 × warning | civil | data contract.invalid_primitive | aid_circle <refno>:thick:top:circle<n> cannot be drawn and was dropped: radius = <n> mm is below <n> mm, the arc collapses to its centre（例：24381_2147、24381_4342）
- 4 × warning | civil | data civil.member_shape_missing | FIXING <refno> has no usable shape (no edge lines / plate faces from the host); PML civilMem.getShape drops it silently (NRTO is never shaped, civilMem.pmlobj L<n>)（例：24381_4342）
- 4 × warning | em4_pipe | suppress linear.point_off_axis | dimension point Tail sits <n> mm across the isoline axis from its neighbour <refno> (max <n> mm = od × <refno>) with an undrawn slot between them, i.e. outside the pipe body; E<n>D draws no tube through such a kink, so t（例：24383_100161、24383_97932、24383_97968、24384_23032）
- 4 × info | em4_pipe | data contract.invalid_isoline | isoline <n> has an axis whose ends coincide or are not finite; sent without an axis（例：24383_100161、24383_75665、24383_76345、24384_23032）
- 3 × warning | civil | suppress civil.dim_degenerate | 尺寸标注 <refno>:edge:<n>: projected length <n> mm is below the reliable threshold（例：24381_25804）
- 3 × warning | em4_pipe | suppress adapter.implied_tube_not_drawn | implied tube <refno> -> Tail (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24383_76345、24383_97932、24384_23032）
- 3 × warning | em4_pipe | suppress isodim.member_off_axis | ELBO origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24383_97968、24383_99749、24383_99757）
- 2 × warning | em9_pipe | suppress adapter.implied_tube_not_drawn | implied tube <refno> -> <refno> (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24381_147426）
- 2 × warning | em9_pipe | suppress isodim.member_off_axis | WELD origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24381_147426）
- 2 × warning | em9_pipe | data welds.no_isoline | no isoline hosts this weld (PML: "Cant find good isoline"); it is not drawn（例：24381_147426）
- 2 × warning | civil | data contract.invalid_primitive | label <refno>:name:A cannot be drawn and was dropped: text_height_mm = <n>e<n> is not a finite number of at least <n> mm（例：24381_2147、24381_4342）
- 2 × warning | civil | data contract.invalid_primitive | label <refno>:thick:A cannot be drawn and was dropped: text_height_mm = <n>e<n> is not a finite number of at least <n> mm（例：24381_2147、24381_4342）
- 2 × warning | civil | data contract.invalid_primitive | label <refno>:name:B cannot be drawn and was dropped: text_height_mm = <n>e<n> is not a finite number of at least <n> mm（例：24381_2147、24381_4342）
- 2 × warning | civil | data contract.invalid_primitive | label <refno>:thick:B cannot be drawn and was dropped: text_height_mm = <n>e<n> is not a finite number of at least <n> mm（例：24381_2147、24381_4342）
- 2 × warning | civil | data contract.invalid_primitive | label <refno>:name:top cannot be drawn and was dropped: text_height_mm = <n>e<n> is not a finite number of at least <n> mm（例：24381_2147、24381_4342）
- 2 × warning | civil | data contract.invalid_primitive | label <refno>:thick:top cannot be drawn and was dropped: text_height_mm = <n>e<n> is not a finite number of at least <n> mm（例：24381_2147、24381_4342）
- 2 × warning | em4_pipe | suppress linear.point_off_axis | dimension point <refno> sits <n> mm across the isoline axis from its neighbour <refno> (max <n> mm = od × <refno>) with an undrawn slot between them, i.e. outside the pipe body; E<n>D draws no tube through such a kink, s（例：24383_100161、24383_97968）
- 2 × warning | em4_pipe | suppress isodim.member_off_axis | BEND origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24383_100538、24383_76345）
- 2 × warning | em4_pipe | suppress isodim.member_off_axis | COUP origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24383_76345）
- 1 × warning | em9_pipe | suppress isodim.member_off_axis | FLAN origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24381_147426）
- 1 × info | em9_pipe | data contract.invalid_isoline | isoline <n> has an axis whose ends coincide or are not finite; sent without an axis（例：24381_147426）
- 1 × warning | civil | data contract.invalid_primitive | label <refno>:name:A cannot be drawn and was dropped: text_dir is not a finite non-zero vector（例：24381_25804）
- 1 × warning | civil | data contract.invalid_primitive | label <refno>:name:B cannot be drawn and was dropped: text_dir is not a finite non-zero vector（例：24381_25804）
- 1 × warning | em4_pipe | suppress isodim.member_off_axis | WELD origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24383_76345）
- 1 × warning | em4_pipe | suppress adapter.implied_tube_not_drawn | implied tube Head -> <refno> (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24383_99749）
- 1 × warning | em4_pipe | suppress isodim.segment_unreliable | projected length <n> mm is below the reliable threshold（例：24383_99749）

## 各类型产出的图元 kind（图元数 / 有它的对象数）

- em9_pipe（1 个对象）：aid_line 4/1，label 8/1，leader_line 6/1，linear_dim 7/1，weld_mark 5/1
- civil（3 个对象）：aid_line 36/3，label 342/3，leader_line 166/2，linear_dim 137/3
- em4_supp（61 个对象）：aid_line 122/61
- em4_pipe（10 个对象）：aid_line 311/9，aid_text 69/9，angle_dim 17/8，label 103/10，leader_line 103/10，linear_dim 62/9，slope_mark 1/1，weld_mark 1/1
