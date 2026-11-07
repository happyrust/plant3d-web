---
status: accepted
date: 2026-11-07
depends_on: ADR-0043, ADR-0046, ADR-0055
---

# MBD V2 契约加一组与标注类型无关的可选信封字段，不开 V3

#103 要把 PML MBD 的全部九种标注类型（EM4 管道、EM9 仪表管、EM4 支架、EM9 仪表支架、EM9 仪表管支架、土建结构、建筑、EM4 / EM9 设备）接进同一条链路。它们画的都是同一层 PML 图元（LINDIM / MLABEL / AIDTEXT / AIDLIN / AIDARC / AIDCIR），所以契约的 11 种 kind 不变，缺的是「这是哪类对象的标注、每条图元属于哪个类别、尺寸链怎么还原、文字多高、贴在哪个平面上」。我们决定在冻结的 V2 形状上加**可选**字段，按 ADR 0055 D7 的顺序引入（前端先接受 → 求解器 mirror → 产出方产出）：

- **包级**：`annotation_type`，只有九个取值 `em4_pipe | em9_pipe | em4_supp | em9_inst_supp | em9_pipe_supp | civil | arch | em4_equi | em9_equi`（对应 PML drawtype），缺省即旧管道包，其它取值按 ADR 0046 整包拒绝；`subject: { refno, noun }` 是标注包的主体对象。`branch_refno` 仍必填——非管道包里填归一化的主体 refno（历史命名），桌面端与旧消费方不必改。
- **所有 kind 共有**（与 `object_refno` / `isoline_idx` 同级）：`function`（PML FUNCTION 类别原文，如「一级尺寸」「定位尺寸」「材料」「坐标信息」，每种标注类型一个封闭词表登记在 plant-mbd 字段字典，契约层只校验非空）、`node_refnos`（PML nodeNames 多归属，`object_refno` 仍是主归属）、`chain_id` + `chain_seq`（同一条 PML N 点 LINDIM 拆出的 N−1 段 `linear_dim` 共用 `chain_id`、按 `chain_seq` 排序；给了 `chain_seq` 必须同时给 `chain_id`）。
- **按 kind**：`text_height_mm` 扩到 `linear_dim` / `label` / `angle_dim` / `slope_mark`（`aid_text` 已有），字高三层规则不变（图元 > 直段 `cheight_mm` > `meta.cheight_mm`）；`text_up` 加在 `linear_dim` / `label` / `aid_text` / `slope_mark`，是文字的「向上」方向（PML ORI 的 y 轴），与 `text_dir` 一起定出文字平面。

前端把 `function` 透到外部记录上，面板按它分组并可整组临时隐藏（ADR 0028 的只读约束不变）；`chain_id` 留给按链选中与还原 PML 链。

## Considered Options

- **开 V3、按标注类型分出不同的负载结构**：违反 ADR 0043 的冻结形状；11 种 kind 的几何与映射要复制一遍。
- **按类型新增 kind（`support_dim`、`civil_label` …）**：kind 是呈现图元，不是领域类别；类别本来就是 PML 的 FUNCTION，放进 `function` 即可。
- **把这些字段嵌进每条图元的子对象**：与 ADR 0055 的扁平风格不一致，两侧各多一层校验。
- **让 `branch_refno` 在非管道包里缺省**：桌面端（plant-ui）与 gen-model 测试都按必填读它，改成可选是破坏性变更；有了 `subject` 之后它只是一个历史命名。

依据：ADR 0043（只经冻结契约形状）、ADR 0046（先完整校验再原子替换）、ADR 0055 D7（三步引入顺序）；plant-mbd ADR-0013（范围扩到全部标注类型）、ADR-0015（`MbdDataSource`）；spec #103；计划 `docs/plans/2026-11-07-mbd-all-annotation-types-port-dev-plan.md` M1-3。

## 后续

- **2026-11-07，管道包带上信封字段后管道呈现不变（CT-9 前端）**：求解器给管道图元发 `function`、`chain_id` / `chain_seq` / `node_refnos` 与逐图元 `text_height_mm`（管道名称 3 倍直段字高、切管段号 2 倍）之后，管道包（`em4_pipe` / `em9_pipe` / 缺 `annotation_type`，`isPipePackage`）的缺省呈现完全不变：
  - **字高**：管道包只认 `aid_text` 上的图元字高（安装角度方向小字的半字高，现状）；`linear_dim` / `label` / `angle_dim` / `slope_mark` 上的照收不用，记录仍跟直段 / 全局 `cheight_mm`。记录字高决定卡片的分级显示与近景行、三维尺寸的字高与外移、平贴字号，名称的 3 倍字高一进来，名字药丸就从三倍远处开始出现。PML 字高留在数据里，供以后出图 / 平贴用。非管道包照旧三层（图元 > 直段 > 数据包）。
  - **面板分组**：`mbdFunction` 在记录上只有面板分组一个消费者，适配层不给管道记录写它，管道面板照旧按直段分组；M2b 起已带 function 的支管口尺寸、流向、伴热、支撑腿、焊点、调整焊符号也回到直段分组。function 分组只给非管道包；`chainId` 照常透传。
  - **LOD**：`mbdFunctionLodTier` 对管道包本来就不发话，不变。
