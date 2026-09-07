# plant3d-web 三维尺寸标注能力审核：能否满足 rs-core/MBD 的尺寸标注功能

日期：2026-07-29
性质：能力审核 + 差距分析（grill-with-docs 会话产物，无代码变更）
参照基准：`rs-core/MBD`（PML，需求事实源）· `rs-mbd`（Rust 算法单源）· `plant-web-server`（宿主 API）· 本仓尺寸标注系统

## 0. 审核判据（会话已确认的六项决策）

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 评判口径 | 分层审核：呈现层能力与端到端现状分别评判，差距归属到仓 |
| 2 | 专业范围 | rs-core/MBD 全部 8 个专业入基准，分级给结论 |
| 3 | 手动标注 | 手动尺寸/标签（正交/对齐尺寸、MLabel）入基准；施工辅助几何（手动点/线/弧/圆/圆角绘制交互）不入 |
| 4 | 焊缝/位号/材料号 | 按 PML 实际绘制行为入基准（算 MBD 标注交付物）；rs-mbd ADR 0001 与 ROADMAP/契约的表述矛盾由 rs-mbd 文档消解（本次已在其 CONTEXT.md 增补词条） |
| 5 | 格式开关 | `setmbdfmt`/`recoverfmt`（隐藏/显示小数与单位）的对等责任在 rs-mbd 发射端；Web 只对用户尺寸负责（ADR 0013/0036 插槽已备） |
| 6 | 交付物落点 | 本报告落本仓 `docs/plans/`；术语澄清落 `rs-mbd/CONTEXT.md` |

## 1. 参照系：迁移链路已定型

```
rs-core/MBD (PML, E3D 内运行)          ← 需求事实源（算法行为基准，rs-core/src/mbd 已删除）
        │  算法移植（绿场，BRAN-only 起步）
        ▼
rs-mbd (Rust, 冻结 V2 契约 contract.rs) ← 排版算法唯一归属（本仓 ADR 0002：呈现共享、领域不移交）
        │  MbdV2PipeData JSON
        ▼
plant-web-server GET /api/mbd/v2/pipe/{refno}
        │
        ▼
plant3d-web 尺寸标注系统（外部尺寸/外部标注图元，只读，ADR 0028/0041/0043/0046）
```

任何"plant3d-web 能否满足 MBD"的提问都必须拆成两问：**呈现层能不能画**（本仓责任）与**上游能不能算出来、送进来**（rs-mbd / plant-web-server 责任）。

## 2. 呈现层能力矩阵（V2 契约 11 种图元）

| V2 图元 | 契约几何字段 | Web 渲染现状 | PML 对应物 | 差距归属 |
| --- | --- | --- | --- | --- |
| `linear_dim` | 完整（start/end/text/sub_kind/extension_lines/arrow_lines/label_anchor/reference） | ✅ 完整映射（尺寸线/延长线/箭头线/标签锚点/参考角色） | LINDIM（isoDim → lindim） | 无 |
| `angle_dim` | ❌ 仅 id/text（Phase 0 占位） | ⛔ 原子跳过（契约无几何可画） | isombdangle | rs-mbd 契约 |
| `label` | 完整 | ✅ 多行拆分渲染 | isoTag / mlabel | 无（上游未产出） |
| `leader_line` | 完整 | ✅ leader 线型 | 引线 | 无 |
| `aid_line` | 完整（含 solid/dashed/dash_dot 线型） | ✅ | mbdaidline / AIDLIN | 无 |
| `aid_arc` | ❌ 仅 id | ⛔ 原子跳过 | aidarc（AIDARC：pos/ori/radius/stangle/sweepAngle） | rs-mbd 契约 |
| `aid_circle` | ❌ 仅 id | ⛔ 原子跳过 | aidcircle（AIDCIR） | rs-mbd 契约 |
| `aid_point` | 完整 | ✅ 十字标记 | aidpoint（AIDPOI） | 无 |
| `aid_text` | 完整 | ✅ 多行 | aidtext（AIDTEX） | 无 |
| `weld_mark` | 完整（position/weld_type） | ✅ 圆圈，现场焊加十字 | isoWeldText（另含焊口编号文本，可由 label 表达） | 无（上游未产出） |
| `slope_mark` | 完整（start/end/text） | ✅ 线 + 箭头 + 文本 | isoSlope（**三角形符号** + `slope X%` 文本） | 呈现形状差异，见 G9 |

**关键判断：三种被跳过的图元不是本仓缺能力。** 呈现内核已具备原生弧/圆/点原语（ADR 0042，`ExplicitArcInput`：center/normal/radiusM/startAngle/endAngle——与 PML AIDARC 的 pos/ori/radius/stangle/sweepAngle 一一对应），角度尺寸另有用户尺寸侧的成熟角度布局（优/劣弧，ADR 0024）。堵点是 rs-mbd Phase 0 契约尚未给这三类定义几何字段；补齐字段后本仓只需扩展映射函数。

## 3. 手动标注基准对照（决策 3 口径）

| rs-core/MBD 手动能力 | Web 对应 | 判定 |
| --- | --- | --- |
| 正交尺寸（LINDIM，E3D 原生） | 投影线性尺寸（沿稳定设计轴/语义轴投影，ADR 0025） | ✅ 语义覆盖 |
| 对齐尺寸（LinDimAligned） | 线性尺寸（锚点对齐距离） | ✅ 语义覆盖 |
| 文本标签 MLabel（挂任意设计元素） | 文字批注/云线批注（校审批注域）+ 外部 `label` 图元 | ✅ 分域覆盖（不在尺寸文档，符合本仓领域边界） |
| E3D 链式连标（一条 LINDIM 多个 dimpos） | 用户尺寸按锚点对逐个创建（内核尺寸为 pairwise） | ⚠️ 体验差异（见 G10），非能力缺失 |
| 施工辅助几何绘制交互（点/线/弧/圆/圆角） | 无用户绘制工具（内核可渲染同类只读图元） | 决策 3 明确不入基准 |

配套能力本仓已超出 PML 基准的部分：捕捉点源（P-Point/实例原点/表面点）、编辑会话与单意图命令（ADR 0027）、作者/管理员权限（ADR 0033）、随校审工作流持久化与乐观版本（ADR 0019/0020/0034）、失效尺寸降级（ADR 0029）、语义列表可达性（ADR 0030）、PNG/SVG 合成导出（ADR 0031）、500 可见尺寸 60fps 与大厂区规模目标（ADR 0018/0040）。

## 4. 端到端现状（今天用户实际能得到什么）

- ✅ 已验证最小纵切：`rs-mbd-cli` fixture JSON → 严格 V2 校验 → 只读外部尺寸 → 场景渲染 → SVG 导出（fixture E2E 绿，2026-07-22 计划 M1–M3 已实施）；无效负载原子拒收（ADR 0046）。
- ⛔ 生产 API 是占位：`plant-web-server` 已有 `GET /api/mbd/v2/pipe/{refno}` 路由，但返回空 welds/slopes 与提示文本（"full MBD pipe semantics still require the model-core adapter"），未接 rs-mbd solver。
- ⛔ rs-mbd 算法面：仅 BRAN 线性尺寸落地（直段拆分/尺寸方向/链式排列/小尺寸/抑制）；weld、slope、tag、bend 分期未做；Polar 邻段、标签避让与引线改道未做；金样批次回归未建。
- ⛔ `DIMENSION_V2_CUTOVER` 保持关闭，生产切换以 ADR 0039 完整验收为门。
- ⚠️ parquet 离线通道只覆盖线性尺寸列（ADR 0043 已声明的短期代价）。

**端到端结论：今天不能替代 E3D 里的 MBD。** 用户现在能在 Web 看到的只有注入式管道线性尺寸样例；任何一个真实分支的完整标注（含焊缝/坡度/位号/角度）都还产不出来。

## 5. 八专业分级结论（决策 2 口径）

| 专业 | rs-mbd 路线 | 呈现层评估 | 分级结论 |
| --- | --- | --- | --- |
| 工艺管道 | 主攻通道（Phase 2 部分完成） | 图元级就绪（8/11，3 项待契约） | **部分满足**：呈现层就绪，卡在上游算法与接线 |
| 仪表管道 | 同 BRAN solver，金样批次含仪表管样本（Phase 4 计划内） | 同管道 | **路径明确未落地** |
| 工艺支架 / 仪表管支架 / 仪表支架 | Phase 4"另目录，勿混 BRAN solver"，未启动 | 图元大概率通用，但契约无支架类型（`MbdV2PipeData` 管道专属，带 `branch_refno`） | **上游未启动 + 契约需扩展** |
| 工艺设备 / 仪控设备 | Phase 4 提及，未启动 | 同上 | **上游未启动 + 契约需扩展** |
| 土建结构 / 建筑 | **任何路线图均未提及** | 同上 | **无迁移路径**（需求悬空，需立项决策） |

## 6. 差距清单（编号 · 归属 · 定性）

| # | 差距 | 归属 | 定性 |
| --- | --- | --- | --- |
| G1 | `angle_dim`/`aid_arc`/`aid_circle` 契约几何字段未定义；Web 内核原语已备（AIDARC 字段与 `ExplicitArcInput` 1:1） | rs-mbd（契约） | 阻塞角度/弧类标注全链路 |
| G2 | weld / slope / tag / bend 算法未移植（ROADMAP Phase 2 分期项） | rs-mbd（算法） | 阻塞完整管道交付物 |
| G3 | Polar 邻段、标签避让、引线改道未移植 | rs-mbd（算法） | 影响密集场景可读性 |
| G4 | `/api/mbd/v2/pipe/{refno}` 为占位实现，未接 solver | plant-web-server | 阻塞端到端 |
| G5 | parquet 离线通道仅线性列 | plant3d-web | 已知代价（ADR 0043），随契约推进补列 |
| G6 | `DIMENSION_V2_CUTOVER` 关闭，Gate 5 未过 | plant3d-web | 按 ADR 0039 推进，非缺陷 |
| G7 | 支架/设备/土建/建筑无契约类型与 solver | rs-mbd（契约+算法） | 土建/建筑连路线图都没有，需立项决策 |
| G8 | rs-mbd ADR 0001（"焊点/位号非输出"）与 ROADMAP Phase 2（weld/tag 待办）、冻结契约（`weld_mark`/`label` kind）表述矛盾 | rs-mbd（文档） | 本次已在 rs-mbd/CONTEXT.md 增补「MBD 标注交付物」词条消解（决策 4） |
| G9 | slope 呈现差异：PML 画三角形符号，Web 画线+箭头 | plant3d-web（待确认） | 按 rs-mbd「语义对齐」词条不要求像素复刻，留金样人工审阅裁决 |
| G10 | E3D 链式连标 vs Web 逐锚点对创建 | plant3d-web | 手动标注体验差异，非能力缺失；如需链式可后续立项 |
| G11 | 尺寸格式开关（隐藏小数/单位）需成为 rs-mbd 发射配置；外部文本对 Web 不透明 | rs-mbd（配置） | 决策 5 已定责；切格式需重拉 JSON，无前端即时切换 |

## 7. 总结论

1. **呈现层：基本满足，且架构性就绪。** 冻结契约 11 种图元中 8 种已可只读渲染并纳入命中/截图/SVG 同一链路；其余 3 种堵在上游契约字段而非内核能力。手动尺寸/标签基准由用户尺寸（投影线性/线性/角度/径向）与批注域分域覆盖。
2. **端到端：尚不满足。** 今天只有管道线性尺寸的 fixture 级纵切；生产 API 占位、weld/slope/tag/angle 未产出、支架/设备未启动、土建/建筑无路线。
3. **差距重心不在本仓。** 11 项差距中 7 项归属 rs-mbd（契约 2、算法 3、文档 1、配置 1）、1 项归属 plant-web-server；本仓自身仅 G5/G6/G9/G10，且均为已声明代价或待确认项。
4. **建议的推进顺序**（与 rs-mbd ROADMAP 一致，此处仅汇总）：G4 接线打通真实 BRAN 纵切 → G2 补 weld/slope/tag → G1 定角度/弧契约 → 金样批次回归（顺带裁决 G9）→ G7 支架/设备立项，土建/建筑单独决策。

## 8. 相关文档

- 本仓：ADR 0002 / 0025 / 0028 / 0039 / 0041 / 0042 / 0043 / 0046 / 0048；`docs/plans/2026-07-22-rs-mbd-linear-json-web-loading-plan.md`
- rs-mbd：`docs/ROADMAP.md`、`docs/adr/0001-pipe-dimension-scope.md`、`docs/adr/0002-semantic-parity-with-layout-tolerance.md`、`CONTEXT.md`（含本次新增「MBD 标注交付物」词条）
- 需求事实源：`rs-core/MBD/开发文档/MBD模块架构与数据接口.md`、`rs-core/MBD/开发文档/管道标注绘制流程.md`、`rs-core/MBD/mbd.uic`
