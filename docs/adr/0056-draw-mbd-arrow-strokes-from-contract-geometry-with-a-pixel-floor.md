---
status: accepted
---

# MBD 外部尺寸箭头按契约几何绘制，只设一个像素可读下限

MBD V2 `linear_dim` 自带的 `arrow_lines`（每翼一段，`from` 在尺寸线上的尖端、`to` 是翼底；求解器按组字高给长度 `0.96·cheight`、半宽 `0.28·cheight`，小段尺寸的翼已朝外）是**来源几何，不是提示**：适配层把它逐段 `source_to_design` 变换后 1:1 进内核 `ExplicitLayoutInput.arrowLines`，不再按尺寸线两端自造屏幕定尺的实心箭头头，也不再由 `sub_kind === 'small'` 推 `outside`。这是 ADR 0048 中「外部 MBD 已明确提供箭头线段时尊重源数据，不重复生成箭头」与 ADR 0007「显式来源可提供箭头」的实施口径——此前的实现与两条 ADR 相悖，本条把它扭回来并补上当时没写的可读性规则。

可读性规则在内核、不在适配层：`DimensionTheme.arrowLineMinLengthPx`（默认 13 px，= 用户尺寸实心头的 `arrowLengthPx`）是全部 `arrowLines` 的**下限**。一条翼投影到屏幕后 `L ≥ 下限` 原样绘制；`0 < L < 下限` 时翼底换成锚在尖端、带像素偏移 `Δ·下限/L` 的场景顶点——方向仍是来源几何的投影方向，长度停在下限，尖端仍钉在尺寸线上，相机再远也跟着走；`L ≈ 0`（翼与视线平行）不画，与任何侧视消失的线段一致。不设上限：近景大管的翼长到几十像素就是几何语义，延长线也如此。规则是主题级的，`slope_mark` 等一切显式箭头笔画同样受益；不做记录级 opt-in。

来源没有笔画（`arrow_lines: []`——老 parquet 行、手写数据、其它不产箭头的生产者）时退回旧路：内核按尺寸线两端画屏幕定尺实心头，`small` 仍翻到外侧。契约形状、plant-mbd 金样、SVG 导出（吃 `LayoutResult`，与视口天然同源）都不变。

被否决的替代：维持自绘屏幕箭头、只给契约字段加「3D 不消费」注释（零回归，但与 ADR 0048 §35 直接冲突，且求解器随字高缩放的箭头决策在主渲染路径上永远看不见）；从 `arrow_lines` 只取长度与半角、仍画实心三角（外观与用户尺寸统一，但那是消费参数不是几何，小段朝外等信息又得另推）；给翼同时加像素上限（近景把几何压成屏幕图元，与「几何为准」自相矛盾）；把契约里的 `arrow_lines` 删掉（破坏性：plant-mbd `contract.rs` + `contract_guard` 回环 + 5 个 fixture + 前端守卫，而离线对拍、金样重录确有消费方）。

依据：ADR 0007、ADR 0048 §35、ADR 0043（只经冻结契约形状）、ADR 0015（像素常数只进主题）；plant-mbd `isodim.rs` 模块头「箭头几何没有 PML 出处，本库把它显式化进契约」与提交 `f888a50`（箭头随组字高缩放）；issue `docs/issues/mbd-linear-dim-ignores-wire-arrow-lines-2026-09-09.md`；方案 `docs/plans/2026-09-10-mbd-linear-dim-consume-contract-arrow-lines-plan.md`（D1–D4 2026-09-10 全按推荐拍板）。落地：`483d1eb`（内核钳制）、`4cd9a13`（适配层）。
