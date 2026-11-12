# MBD 全量联调扫描 2026-11-11T14:11:30.414Z

- 后端：{"version":"0.1.44","started_at":"2026-11-11T16:10:00.024815600+08:00","project":"AvevaMarineSample","mdb":"/ALL"}（模型树 http://127.0.0.1:8022，MBD http://127.0.0.1:8022）
- 扫了 7059 个对象，用时 85 秒；取数耗时 p50 / p90 / p99 / 最长 = 32 / 47 / 135 / 2883 ms
- 枚举：39 个 SITE，跳过 16 个（/Steel_Template_Site、/MDS/SPECIALS、/MDS/SPECIALS、/MDS/SPECIALS、/MDS-Standards-Site、/MDS-Standards-Supports、/MDS/TEMPLATES、/MDS/TEMPLATES/ORI …），tree 请求 6722 次、出错 0 次

## 标注类型 × 结局

| 类型 | 合计 | contract_rejected | degenerate | empty | http_error | mapping_rejected | not_annotatable | ok |
|---|---|---|---|---|---|---|---|---|
| (BRAN) | 6 | 0 | 0 | 0 | 6 | 0 | 0 | 0 |
| (REST) | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| (STRU) | 70 | 0 | 0 | 0 | 0 | 0 | 70 | 0 |
| arch | 104 | 0 | 0 | 59 | 0 | 0 | 0 | 45 |
| civil | 734 | 1 | 0 | 5 | 0 | 2 | 0 | 726 |
| em4_equi | 212 | 0 | 0 | 0 | 0 | 0 | 0 | 212 |
| em4_pipe | 1822 | 4 | 1 | 0 | 0 | 5 | 0 | 1812 |
| em4_supp | 2391 | 61 | 0 | 190 | 0 | 0 | 0 | 2140 |
| em9_equi | 951 | 0 | 0 | 0 | 0 | 0 | 0 | 951 |
| em9_pipe | 603 | 1 | 0 | 0 | 0 | 0 | 0 | 602 |
| em9_pipe_supp | 165 | 0 | 0 | 7 | 0 | 0 | 0 | 158 |

## 不是 ok 的原因（结局 | 类型 | 原因）

- 190 × empty | em4_supp | <n>，但一个图元都没有（例：24383_69177、24383_69211、24383_69213、24383_69355、24383_69357）
- 61 × contract_rejected | em4_supp | MBD V<n> payload has an invalid primitive label "<refno>:support:label:<n>"（例：24381_71247、24384_48、24384_78、24384_108、24384_138）
- 59 × empty | arch | <n>，但一个图元都没有（例：24381_37018、24381_37090、24381_37115、24381_37119、24381_37125）
- 49 × not_annotatable | (STRU) | <n> not_annotatable: STRU <refno> 没有 MBD 标注：STRU <name> 所在的 ZONE <name> 不是支架区（NAME 不含 ["SUPP"]，PURP NI 不在 ["SUPP"]），也不在 WALL / GWALL / STWALL / FLOOR 之下（例：17496_73858、24381_37112、17496_106408、24381_36959、24381_37809）
- 10 × not_annotatable | (STRU) | <n> not_annotatable: STRU <refno> 没有 MBD 标注：STRU <name> 所在的 ZONE <name> 不是支架区（NAME 不含 ["SUPP"]，PURP unset 不在 ["SUPP"]），也不在 WALL / GWALL / STWALL / FLOOR 之下（例：24381_779、24381_1163、24381_1515、24381_3949、24381_5011）
- 7 × empty | em9_pipe_supp | <n>，但一个图元都没有（例：24381_178965、24381_178968、24381_178987、24381_178990、24381_179009）
- 6 × http_error | (BRAN) | <n> precondition: BRAN <refno> 建不起可信的成员结点视图：every branch member was skipped for missing geometry（例：32573_1、24381_101408、24381_177395、24383_101287、24383_101220）
- 5 × not_annotatable | (STRU) | <n> not_annotatable: STRU <refno> 没有 MBD 标注：STRU <name> 所在的 ZONE <name>,<n>米新增钢平台模拟 不是支架区（NAME 不含 ["SUPP"]，PURP unset 不在 ["SUPP"]），也不在 WALL / GWALL / STWALL / FLOOR 之下（例：24381_177299、24381_177311、24381_177327、24381_177342、24381_177358）
- 5 × mapping_rejected | em4_pipe | <n> 个图元无法映射（首个：<refno>:isoline:<n>:angle:<refno>:<n> — degenerate arc frame: normal or x_axis collapses or they are parallel after source_to_design）（例：24383_97932、24383_97968、24383_99749、24383_99757、24383_100538）
- 5 × empty | civil | <n>，但一个图元都没有（例：17496_106456、17496_106500、17496_117236、24381_25747、24381_2162）
- 4 × contract_rejected | em4_pipe | MBD V<n> payload has invalid meta（例：24383_75665、24383_76345、24383_100161、24384_23032）
- 2 × not_annotatable | (STRU) | <n> not_annotatable: STRU <refno> 没有 MBD 标注：STRU <refno> 所在的 ZONE <name> 不是支架区（NAME 不含 ["SUPP"]，PURP NI 不在 ["SUPP"]），也不在 WALL / GWALL / STWALL / FLOOR 之下（例：24381_34112、24381_34464）
- 2 × not_annotatable | (STRU) | <n> not_annotatable: STRU <refno> 没有 MBD 标注：STRU <refno> 所在的 ZONE <refno> 不是支架区（NAME 不含 ["SUPP"]，PURP unset 不在 ["SUPP"]），也不在 WALL / GWALL / STWALL / FLOOR 之下（例：14195_4、24384_26202）
- 2 × mapping_rejected | civil | <n> 个图元无法映射（首个：<refno>:thick:top:circle<n> — degenerate arc frame: normal or x_axis collapses or they are parallel after source_to_design）（例：24381_2147、24381_4342）
- 1 × not_annotatable | (REST) | <n> not_annotatable: REST <refno> 没有 MBD 标注：REST <name> 所在的 ZONE <name> 不是支架区（NAME 不含 ["SUPP"]，PURP unset 不在 ["SUPP"]），也不在 WALL / GWALL / STWALL / FLOOR 之下（例：24381_622）
- 1 × not_annotatable | (STRU) | <n> not_annotatable: STRU <refno> 没有 MBD 标注：STRU <name>，禁止占用 所在的 ZONE <name>(含设备保温) 不是支架区（NAME 不含 ["SUPP"]，PURP unset 不在 ["SUPP"]），也不在 WALL / GWALL / STWALL / FLOOR 之下（例：24381_171354）
- 1 × not_annotatable | (STRU) | <n> not_annotatable: STRU <refno> 没有 MBD 标注：STRU <name> 所在的 ZONE <refno> 不是支架区（NAME 不含 ["SUPP"]，PURP unset 不在 ["SUPP"]），也不在 WALL / GWALL / STWALL / FLOOR 之下（例：24384_26205）
- 1 × contract_rejected | em9_pipe | MBD V<n> payload has invalid meta（例：24381_147426）
- 1 × degenerate | em4_pipe | 合契约，但画出来看不见：<n> 个弧 / 圈的半径小于 <n> mm（例：24383_91813）
- 1 × contract_rejected | civil | MBD V<n> payload has an invalid primitive label "<refno>:name:A"（例：24381_25804）

## 求解器 / 宿主 issues（级别 | 类型 | 类别 规则号 | 内容）

- 66108 × info | civil | suppress civil.member_off_face | PANE <refno>: centre is off its face or outside its outline (civilMem.checkifok L<n><n>)（例：17496_79591、17496_79598、17496_79604、17496_79610、17496_79648）
- 2943 × warning | civil | data civil.member_shape_missing | PANE <refno> has no usable shape (no edge lines / plate faces from the host); PML civilMem.getShape drops it silently (NRTO is never shaped, civilMem.pmlobj L<n>)（例：17496_106683、17496_106765、17496_107037、17496_106824、17496_105912）
- 1250 × info | em4_supp | other locate.no_wall | no STWALL / GWALL found within <n> m to locate against（例：24381_537、24381_549、24381_553、24381_567、24381_47185）
- 1149 × info | em4_supp | data support.part_geometry_missing | SCTN <refno> has no usable section data (POSS / POSE / section points); skipped（例：24383_80213、24383_80228、24383_80243、24383_80258、24383_80273）
- 1107 × info | em4_supp | data support.part_geometry_missing | PJOI <refno> has no usable bolt geometry; part skipped（例：24383_86102、24383_86118、24383_86131、24383_86144、24383_86157）
- 1083 × warning | em4_pipe | suppress adapter.implied_tube_not_drawn | implied tube <refno> -> <refno> (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24383_66479、24383_68131、24383_68351、24383_74823、24383_74875）
- 951 × info | em9_equi | data equipment.elconn_missing | no ELCONN position; the equipment origin is the base point (markEqui.pmlobj:<n>)（例：24381_101421、24381_101423、24381_101425、24381_101427、24381_101429）
- 950 × info | em4_supp | other support.em4_no_pipe_atta | the support has no point ATTA on its pipes: no wall search, no reference look direction and no near walls (PML errors on the unset mbdlocation, suiSupport.pmlobj:<n>)（例：24381_47844、24381_47868、24381_47892、24381_47916、24381_47940）
- 754 × info | em4_supp | other locate.near_wall | the nearest hit <n> mm away is a WALL; PML only records it as a near wall for supports and stops searching that direction, so no locating dimension is drawn there（例：24381_47185、24381_47161、24381_47231、24381_47255、24381_47301）
- 554 × info | em9_equi | other locate.near_wall | the nearest hit <n> mm away is a WALL; PML only records it as a near wall for supports and stops searching that direction, so no locating dimension is drawn there（例：24381_101423、24381_101427、24381_101429、24381_101433、24381_101435）
- 400 × warning | civil | data civil.member_shape_missing | FITT <refno> has no usable shape (no edge lines / plate faces from the host); PML civilMem.getShape drops it silently (NRTO is never shaped, civilMem.pmlobj L<n>)（例：17496_106424、17496_106428、17496_106430、17496_106457、17496_106460）
- 372 × info | em9_equi | other locate.no_wall | no STWALL / GWALL found within <n> m to locate against（例：24381_101558、24381_101618、24381_101622、24381_101691、24381_101824）
- 329 × warning | civil | suppress civil.dim_degenerate | 孔洞尺寸 <refno>:member:<refno>:dim:B:<n>: projected length <n> mm is below the reliable threshold（例：17496_79664、17496_79697、17496_79713、17496_79729、17496_79756）
- 327 × warning | em4_pipe | suppress adapter.implied_tube_not_drawn | implied tube <refno> -> Tail (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24383_66748、24383_66777、24383_66808、24383_68205、24383_68351）
- 281 × warning | civil | suppress civil.dim_degenerate | 孔洞尺寸 <refno>:member:<refno>:dim:A:<n>: projected length <n> mm is below the reliable threshold（例：17496_79591、17496_79610、17496_79648、17496_79697、17496_79713）
- 274 × warning | em4_pipe | suppress adapter.implied_tube_not_drawn | implied tube Head -> <refno> (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24381_583、24383_68131、24383_68351、24383_74015、24383_74403）
- 273 × warning | em4_pipe | suppress isodim.member_off_axis | ATTA origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24381_587、24381_598、24383_73930、24383_73985、24383_74019）
- 218 × warning | em4_pipe | suppress isodim.member_off_axis | BEND origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24383_76345、24383_82706、24383_82750、24383_82766、24383_82774）
- 205 × warning | em4_pipe | suppress linear.point_off_axis | dimension point Tail sits <n> mm across the isoline axis from its neighbour <refno> (max <n> mm = od × <refno>) with an undrawn slot between them, i.e. outside the pipe body; E<n>D draws no tube through such a kink, so t（例：24383_74015、24383_76094、24383_76113、24383_76122、24383_76127）
- 198 × info | em4_equi | other locate.near_wall | the nearest hit <n> mm away is a WALL; PML only records it as a near wall for supports and stops searching that direction, so no locating dimension is drawn there（例：24381_46869、24381_46897、24381_76570、24381_76566、24381_76574）
- 192 × info | em9_equi | suppress locate.civil_label_skipped | floor name label skipped: owner name "" has no second-to-last '-' part（例：24381_101824、24381_101826、24381_101866、24381_101868、24381_101870）
- 190 × warning | em9_equi | other locate.single_wall | only the east-west wall was found; PML draws nothing in this case (mbdlocation.pmlobj:<n>), the one locating dimension is kept（例：24381_101421、24381_101431、24381_101433、24381_101435、24381_101437）
- 188 × warning | em9_equi | data equipment.nozzle_without_p1 | nozzle has no complete P<n> (position, direction, bore); skipped as a rotation reference — PML fails the whole equipment here (mbdlocation.pmlobj:<n>)（例：24381_101957、24381_109449、24381_109456、24381_109463、24381_109470）
- 181 × info | em4_equi | data equipment.elconn_missing | no ELCONN position; the equipment origin is the base point (markEqui.pmlobj:<n>)（例：24381_31010、24381_31012、24381_31044、24381_46777、24381_46823）
- 175 × warning | civil | data civil.member_shape_missing | FIXING <refno> has no usable shape (no edge lines / plate faces from the host); PML civilMem.getShape drops it silently (NRTO is never shaped, civilMem.pmlobj L<n>)（例：17496_106765、17496_107037、17496_106824、17496_105930、17496_105935）
- 151 × info | em4_equi | other locate.no_wall | no STWALL / GWALL found within <n> m to locate against（例：24381_46777、24381_46823、24381_46869、24381_46895、24381_46897）
- 145 × info | civil | suppress civil.member_off_face | SBFI <refno> does not cross any face of the element（例：17496_106465、17496_106542、17496_106581、17496_106613、17496_118542）
- 117 × warning | em9_equi | other locate.single_wall | only the north-south wall was found; PML draws nothing in this case (mbdlocation.pmlobj:<n>), the one locating dimension is kept（例：24381_101423、24381_101560、24381_101562、24381_101564、24381_101594）
- 107 × warning | em4_supp | other locate.single_wall | only the north-south wall was found; PML draws nothing in this case (mbdlocation.pmlobj:<n>), the one locating dimension is kept（例：24381_77267、24381_77303、24381_77308、24381_77313、24381_77318）
- 103 × warning | em9_equi | data data.view_issue | STWALL <refno> 没有 SPRE：截面按 DESP [<n>, <n>] 矩形、原点对齐（例：24381_101930、24381_102000、24381_102014、24381_102032、24381_103000）
- 99 × info | civil | suppress civil.member_off_face | PANE <refno> does not cross any face of the element（例：24381_31194、24381_31261、24381_31253、24381_31377、24381_31378）
- 94 × warning | em4_pipe | suppress isodim.atta_before_first_point | ATTA sits before the first dimension point of its isoline; PML asks to check the ATTA's position<name> in the BRAN and draws nothing for this isoline（例：24383_66479、24383_66509、24383_82728、24383_82829、24383_82899）
- 84 × warning | civil | suppress civil.dim_degenerate | 尺寸标注 <refno>:edge:<n>: projected length <n> mm is below the reliable threshold（例：24381_15142、24381_15158、24381_15189、24381_15224、24381_15240）
- 81 × info | arch | suppress civil.member_off_face | NXTR <refno> does not cross any face of the element（例：24381_39088、24381_39319、24381_38695、24381_37018、24381_37054）
- 71 × info | civil | suppress civil.member_off_face | NXTR <refno> does not cross any face of the element（例：24381_44375、24381_15262、17496_79664、17496_79697、17496_79713）
- 61 × warning | em9_pipe | suppress adapter.implied_tube_not_drawn | implied tube <refno> -> <refno> (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24381_103389、24381_103433、24381_103506、24381_103882、24381_104483）
- 49 × warning | em4_supp | other locate.single_wall | only the east-west wall was found; PML draws nothing in this case (mbdlocation.pmlobj:<n>), the one locating dimension is kept（例：24381_77227、24381_77239、24381_77235、24381_78067、24381_78147）
- 48 × warning | em4_equi | data equipment.nozzle_without_p1 | nozzle has no complete P<n> (position, direction, bore); skipped as a rotation reference — PML fails the whole equipment here (mbdlocation.pmlobj:<n>)（例：24383_76360、24383_76459）
- 46 × warning | em4_pipe | suppress linear.point_off_axis | dimension point Tail sits <n> mm across the isoline axis from its neighbour Head (max <n> mm = od × <refno>) with an undrawn slot between them, i.e. outside the pipe body; E<n>D draws no tube through such a kink, so the （例：24383_75356、24383_92127、24383_92132、24383_92137、24383_85349）
- 40 × info | arch | suppress civil.arch_round_member | NXTR <refno> is round; the arch form skips round openings (markCivil.pmlobj L<n>)（例：24381_39796、24381_39319、24381_38695、24381_36962、24381_36990）
- 39 × warning | em4_pipe | suppress isodim.member_off_axis | ELBO origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24383_66479、24383_76094、24383_76113、24383_76122、24383_76127）
- 34 × info | em9_equi | suppress locate.dimension_degenerate | ew locating dimension skipped: the wall foot is within <n> mm of the base point（例：24381_101930、24381_102014、24381_102032、24381_103000、24381_103023）
- 31 × info | civil | suppress civil.member_off_face | NCYL <refno> does not cross any face of the element（例：24381_15320、24381_15331、17496_100019、17496_72959、17496_106114）
- 27 × warning | em9_pipe | suppress isodim.member_off_axis | ATTA origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24381_177462、24381_177439、24381_177475、24381_177600、24381_177646）
- 24 × warning | em4_equi | other locate.single_wall | only the north-south wall was found; PML draws nothing in this case (mbdlocation.pmlobj:<n>), the one locating dimension is kept（例：24381_90895、24381_100677、24381_100695、24381_100725、24384_24780）
- 22 × warning | em4_supp | data data.view_issue | SCTN <refno> 的截面目录链第 <n> 跳断在 <refno>（SPRE 悬空：db <n> 会话 <n> 的索引里没有 <refno>），没有截面点与目录原语（例：24384_24970、24384_24946、24384_24978、24384_25130、24384_25282）
- 21 × warning | em9_pipe | suppress adapter.implied_tube_not_drawn | implied tube <refno> -> Tail (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24381_101412、24381_104481、24381_105433、24381_105601、24381_105728）
- 21 × warning | em9_pipe | suppress linear.point_off_axis | dimension point Tail sits <n> mm across the isoline axis from its neighbour <refno> (max <n> mm = od × <refno>) with an undrawn slot between them, i.e. outside the pipe body; E<n>D draws no tube through such a kink, so t（例：24381_101412、24381_106467、24381_106505、24381_106790、24381_147828）
- 19 × warning | em4_pipe | suppress linear.member_off_axis | member leave direction deviates <n>° from the isoline axis (max <n>°); the running-dimension segment Head--Tail spanning it would be a foreshortened projection and is suppressed（例：24384_22528、24384_22775、24384_22784、24384_22788、24384_22797）
- 17 × warning | em4_pipe | data tag.branch_name_no_isoline | no isoline axis covers the pipe-name label anchor (PML: "Cant find good isoline"); the pipe-name label is not drawn（例：24383_84825、24383_84876、24383_85424、24383_92456、24383_92497）
- 16 × warning | em4_equi | other locate.single_wall | only the east-west wall was found; PML draws nothing in this case (mbdlocation.pmlobj:<n>), the one locating dimension is kept（例：24381_76570、24381_76578、24381_76640、24381_76665、24383_76459）
- 16 × warning | em9_pipe_supp | data data.view_issue | REST <name> 在 ZONE <name> 与全库都配不到 STRU（按名找过 <name>），以 REST 为归属对象（例：24381_177961、24381_177965、24381_178216、24381_178236、24381_178360）
- 15 × warning | civil | data civil.member_shape_missing | PFIT <refno> has no usable shape (no edge lines / plate faces from the host); PML civilMem.getShape drops it silently (NRTO is never shaped, civilMem.pmlobj L<n>)（例：24381_25769、24381_25870、24381_20484、24381_10624）
- 14 × warning | em9_pipe | suppress isodim.member_off_axis | WELD origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24381_147426、24381_147828、24381_147862、24381_147898、24381_147923）
- 14 × warning | em4_pipe | data kd_points.atta_side_missing | <name> needs the P<n> direction and PARA[<n>]; the ATTA takes its origin as a single dimension point（例：24383_68047、24383_74129、24383_74230、24383_74266、24383_74328）
- 12 × info | arch | other civil.arch_floor_only | the arch form only annotates FLOOR elements (markCivil.drawarch L<n>)（例：24381_37115、24381_37119、24381_38428、24381_38432、24381_38376）
- 10 × warning | em9_pipe | suppress adapter.implied_tube_not_drawn | implied tube Head -> <refno> (<n> mm) is not coaxial with its ports (<n>° off); E<n>D draws no tube here, so no tube length is dimensioned（例：24381_104746、24381_104806、24381_105433、24381_106156、24381_106188）
- 10 × warning | em4_pipe | suppress isodim.segment_unreliable | projected length <n> mm is below the reliable threshold（例：24383_67939、24383_67975、24383_74129、24383_74403、24383_74407）
- 9 × warning | em9_pipe | suppress isodim.segment_unreliable | projected length <n> mm is below the reliable threshold（例：24381_147955、24381_147970、24381_177565、24381_177600、24381_177852）
- 9 × warning | em4_pipe | suppress linear.point_off_axis | dimension point <refno> sits <n> mm across the isoline axis from its neighbour <refno> (max <n> mm = od × <refno>) with an undrawn slot between them, i.e. outside the pipe body; E<n>D draws no tube through such a kink, s（例：24383_84203、24383_84256、24383_97968、24383_98558、24383_98539）
- 8 × info | civil | suppress civil.member_off_face | NRTO <refno> does not cross any face of the element（例：17496_99813、17496_100202）
- 7 × warning | em9_pipe | suppress isodim.member_off_axis | BEND origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24381_147828、24381_147862、24381_147898、24381_147983、24381_147999）
- 7 × warning | arch | data data.view_issue | STWALL <refno> 没有 SPRE：截面按 DESP [<n>, <n>] 矩形、原点对齐（例：24381_39170、24381_39319、24381_38695）
- 7 × info | civil | suppress civil.member_off_face | FITT <refno> does not cross any face of the element（例：24381_25380、24381_25391、24381_25420、24381_15727、24381_15765）
- 6 × error | (BRAN) | data adapter.no_members_with_geometry | every branch member was skipped for missing geometry（例：32573_1、24381_101408、24381_177395、24383_101287、24383_101220）
- 6 × warning | em9_pipe | suppress isodim.atta_before_first_point | ATTA sits before the first dimension point of its isoline; PML asks to check the ATTA's position<name> in the BRAN and draws nothing for this isoline（例：24381_103633、24381_107276、24381_147504、24381_147511、24381_177376）
- 6 × warning | em9_pipe | suppress linear.point_off_axis | dimension point <refno> sits <n> mm across the isoline axis from its neighbour <refno> (max <n> mm = od × <refno>) with an undrawn slot between them, i.e. outside the pipe body; E<n>D draws no tube through such a kink, s（例：24381_105996、24381_106160、24381_106326、24381_106541、24381_177475）
- 6 × warning | em4_pipe | data linear.axis_inferred_from_neighbour | arrive port axis is missing from the catalogue; inferred as the reverse of <refno>'s facing port direction（例：24383_66799、24383_74015、24383_84721、24383_85844、24383_98289）
- 6 × warning | em4_pipe | suppress linear.point_off_axis | dimension point <refno> sits <n> mm across the isoline axis from its neighbour Tail (max <n> mm = od × <refno>) with an undrawn slot between them, i.e. outside the pipe body; E<n>D draws no tube through such a kink, so t（例：24383_94626、24383_95187、24383_98204、24383_98919、24383_99408）
- 5 × warning | em9_pipe | suppress linear.segment_spans_kink | dimension points <refno>--<refno> sit <n> mm apart across the isoline axis (max <n> mm = od × <refno>) and an undrawn slot lies between them; no tube runs there, so the segment would be a foreshortened projection and is （例：24381_177501、24381_177717、24381_177771、24381_177886、24381_177901）
- 5 × info | civil | suppress civil.member_off_face | NBOX <refno> does not cross any face of the element（例：17496_79785、17496_118542）
- 5 × warning | civil | data civil.member_shape_missing | SBFI <refno> has no usable shape (no edge lines / plate faces from the host); PML civilMem.getShape drops it silently (NRTO is never shaped, civilMem.pmlobj L<n>)（例：17496_105724、24381_31253、24381_5178、24381_5202）
- 4 × info | arch | suppress civil.member_off_face | NXTR <refno>: centre is off its face or outside its outline (civilMem.checkifok L<n><n>)（例：24381_36962、24381_36990、24381_37018、24381_37054）
- 4 × info | civil | suppress civil.member_off_face | FIXING <refno> does not cross any face of the element（例：17496_106765、17496_106212、24381_1932、24381_4302）
- 4 × warning | civil | data data.view_issue | STWALL <refno> 没有 SPRE：截面按 DESP [<n>, <n>] 矩形、原点对齐（例：17496_99203、17496_100380）
- 3 × warning | em9_pipe_supp | data data.view_issue | REST <name>(<n>)-of<n>TFA<n>MP-SUPP<n><name> 在 ZONE <name> 与全库都配不到 STRU（按名找过 <name>(<n>)-of<n>TFA<n>MP-SUPP<n><name>(<n>)-of<n>TFA<n>MP-SUPP<n>），以 REST 为归属对象（例：24381_178965、24381_178987、24381_179009）
- 3 × warning | em4_pipe | split split.geometry | missing leave_dir（例：24383_66799、24383_74015、24383_98919）
- 3 × warning | em4_pipe | suppress isodim.member_off_axis | WELD origin and both ports sit more than <n> mm (od × <refno>) off the isoline axis; PML asks to check its order<name> in the BRAN and takes no dimension point（例：24383_76213、24383_76345）
- 3 × warning | em4_pipe | suppress adapter.member_directions_missing | BEND port direction is missing; member kept without a direction（例：24383_84721、24383_98289、24383_98919）
- 3 × warning | em4_pipe | data linear.axis_inferred_from_neighbour | leave port axis is missing from the catalogue; inferred as the reverse of <refno>'s facing port direction（例：24383_84721、24383_85844、24383_98289）

## 各类型产出的图元 kind（图元数 / 有它的对象数）

- em4_supp（2391 个对象）：aid_circle 431/161，aid_line 3422/1441，angle_dim 7/7，label 2077/1554，leader_line 2077/1554，linear_dim 16166/2115
- em4_equi（212 个对象）：aid_line 25/25，aid_text 419/212，angle_dim 187/187，label 1080/212，leader_line 212/212，linear_dim 80/59
- em9_equi（951 个对象）：aid_line 257/257，aid_text 1813/951，angle_dim 694/694，label 5338/951，leader_line 951/951，linear_dim 816/546
- em9_pipe_supp（165 个对象）：linear_dim 1070/158
- em4_pipe（1822 个对象）：aid_line 40951/1690，aid_text 7862/1431，angle_dim 671/454，label 12782/1822，leader_line 12782/1822，linear_dim 8588/1687，slope_mark 242/91，weld_mark 559/183
- em9_pipe（603 个对象）：aid_line 14653/459，aid_text 5473/444，angle_dim 252/173，label 8392/603，leader_line 5861/603，linear_dim 7359/603，slope_mark 1228/228，weld_mark 3530/603
- arch（104 个对象）：aid_circle 402/27，aid_text 402/27，label 1953/45，leader_line 6/4，linear_dim 1424/34
- civil（734 个对象）：aid_arc 739/103，aid_circle 3604/710，aid_line 10238/729，aid_text 745/103，label 52976/729，leader_line 22509/659，linear_dim 20611/444
