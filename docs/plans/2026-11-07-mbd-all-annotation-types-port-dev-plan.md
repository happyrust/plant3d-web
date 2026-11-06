# MBD 全标注类型尺寸移植开发计划（2026-11-07）

- 性质：开发计划（现行，与 [`2026-11-06-mbd-dimension-remaining-work-dev-plan.md`](2026-11-06-mbd-dimension-remaining-work-dev-plan.md)（下称「N 计划」）并行）。
- 依据：spec [#103](https://github.com/happyrust/plant3d-web/issues/103)（全标注类型外部尺寸移植）；逐文件算法与阈值清单在 vendor MBD 模块的开发文档目录（`MBD尺寸标注功能与算法文件清单.md`：§11 缺陷初始清单、§12 各类型取数清单、§13 单测样例），不入本仓。
- 分工：N 计划继续管管道收尾；本计划接管 N2-2 / N4-1 的极坐标口径（改为求解器唯一实现，见 D4），其余不重叠。
- 对照口径：plant3d-web `48fed2d9`、`vendor/plant-mbd` `3db2d92`、gen-model `972b06cfa`（`refactor`）。
- 编号：工作包 M0–M8；引用 N 计划写全（如「N2-2」）。
- 工作方式：三仓各一条 `feat/mbd-all-types` 集成分支（plant3d-web `plant3d-web-mbd-all`、plant-mbd `vendor/plant-mbd-all`、gen-model `gen-model-mbd-all` 三个 worktree）；并行车道各自 worktree 分支，落地后并回集成分支。三个主检出都有别的会话在改，**本计划不直接改主检出**，合并窗口单独协调。

## 0. 一句话

PML MBD 的全部尺寸标注——管道补齐、EM4 / EM9 支架、土建 / 建筑、设备定位——都按「宿主读数 → 纯求解器 → 冻结 V2 契约 → 前端只读呈现」的同一条链路接进来，以 PML 导出 JSON 为语义基准，按 M0 → M1 → (M2 ∥ M3 ∥ M4 ∥ M7) → M5 / M6 → M8 推进。

## 1. 现状与依据

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | 管道链路已通：gen-model `src/mbd/branch_query.rs` → plant-mbd `layout_branch` → `GET /api/mbd/v2/pipe/{refno}` → 前端尺寸内核；求解器产出 11 种 kind 里的 8 种 | spec #103 §现状；`layout.rs` `PRODUCED_KINDS` |
| F2 | PML 生产路径写死极坐标（`isoline.pmlobj` L134、`isobran.pmlobj` L195 / L214），plant-mbd 移植的是 PML 里不走的非极坐标选向；EM4 支架只走新路径（`suiSupport.pmlobj` L1003）；EM9 支架类型由 ZONE 名含 `RACK` 决定（`instSupport.pmlobj` L181） | 2026-11-06 抽查核实 |
| F3 | 支架 / 土建 / 设备在三层里都没有代码；`MbdV2PipeData` 是管道信封；前端模型树「查看尺寸标注」只对 `type === 'BRAN'` 放行；gen-model 对 EQUI 回 422 `NotRouteContainer` | `ModelTreePanel.vue` `contextNodeIsBran`；`branch_query.rs` |
| F4 | 极轴已修正（`48fed2d9` + `3db2d92`），但 `mbd_3d=0&mbd_polar=1` 的重叠读数不变（`24381_145018` 70 / 21 / 5），候选大多被屏幕校验退回原位 | `docs/verification/mbd-polar-axis-ab-2026-11-07/README.md` |
| F5 | 目录原语、截面、墙轴线、板环的求值已在 e3d-model 生成链：`section::evaluate_section_profile`、`profile::loop_profile`、`section::spine_path`、`catalogue::model_catalogue_member` 的参数层可复用；`model_element` 产出网格，不能当尺寸几何 | e3d-model `src/{section,profile,catalogue,elmodl}.rs` |
| F6 | `/api/v1/spatial/nearby` 只查**已生成**模型的 AABB 树，看不到未生成构件；房间拓扑 `room_topology.rs` 可从 `DbSet` 直读（FRMW / SBFR 按 feature）；专业规则键 `spec_value_rules` 未写进 `DbOption.toml`，跑的是代码缺省 | gen-model `src/fast_model/{spatial_query,room_topology,spatial_discipline}.rs` |
| F7 | gen-model 按字面量构造 `InMemoryDataSource { branches }`；plant-ui 只以 `..` 匹配契约变体（其测试里的字面量自 `fff0f6e` 起已落后） | `gen-model/src/mbd/mod.rs:50`；`plant-ui-app/src/dimension_layer.rs` |
| F8 | 本机内存紧：gen-model 构建与 vitest 全量都出现过 OOM；自制 `cargo` 把缓存放在 `D:\Rust\.cargo\targets\<包>-<hash>`、兄弟 worktree 共用，新 worktree 的 gen-model 构建约 3.5 分钟 | 2026-11-07 实测 |
| F9 | PML 金样导出环境未确认；在那之前各类型按过渡做法（PML 规则手推期望 + 自录金样 + 审阅）先行 | 本计划 D1 |

## 2. 目标与完成定义

1. 九种标注类型都能经 `layout_object` 出图：量哪些点、怎么分链、文字与 FUNCTION 类别与 PML 一致；摆位按 PML 规则，已知缺陷逐条裁决后修正（裁决带 PML `file:line`）。
2. gen-model 有与类型无关的端点 `GET /api/mbd/v2/object/{refno}`，按项目配置判定标注类型；`/pipe/{refno}` 保留为管道别名。
3. 前端模型树对支架 / 设备 / 墙 / 楼板也能「查看 / 加入尺寸标注」；面板按 FUNCTION 分组显隐。
4. 每类至少一份 PML 导出金样经 `plant-mbd-cli pml diff` 全绿（有意偏差全部引用裁决）；每类至少一个真实对象在页面呈现，三档截图落 `docs/verification/`。
5. 三仓门禁全绿：plant-mbd `cargo fmt --check` / `cargo test --workspace` / `golden diff`；gen-model MBD 测试；plant3d-web vitest（`src/dimension` 等）、`npm run type-check` 新增 0、eslint 0。

## 3. 阶段与依赖

```
M0 收口与决策
 │
M1 共享内核（text / lindim / geom）+ 契约信封 + 统一入口 + PML 比对器
 │
 ├─ M2a 管道极坐标进求解器 → M2b 管道缺失尺寸（墙体定位吃 M3 的土建面）
 ├─ M3 设备定位 + 找墙内核（locate）+ 土建面读取 ──┐
 ├─ M4 EM9 支架 + 出图平面摆位引擎 → M5 EM4 支架  │
 ├─ M7 通用端点 + 前端接入（骨架先行）            │
 └─────────────────────────────── M6 土建 / 建筑 ◄┘
                                       │
                                  M8 PML 金样验收 + 文档收口
```

| 工作包 | 仓 | 可并行 | 前置 |
| --- | --- | --- | --- |
| M0 | 三仓（文档） | — | 无 |
| M1 | plant-mbd（+ plant3d-web 契约接受） | M1-1/2 ∥ M1-3/4 ∥ M1-5 ∥ 前端 M1-3 | M0 |
| M2a / M2b | plant-mbd + gen-model | M2a 内部串行 | M1；M2b 的墙体定位需 M3 |
| M3 | plant-mbd + gen-model | 与 M2a / M4 / M7 并行 | M1 |
| M4 / M5 | plant-mbd + gen-model | M5 需 M4 的摆位引擎 | M1 |
| M6 | plant-mbd + gen-model | — | M3 的土建面 |
| M7 | gen-model + plant3d-web | 骨架与 M3 / M4 并行 | M1；接各类型时需对应读取器 |
| M8 | 三仓 | — | 全部 |

## 4. 工作包

### M0 收口与决策

| ID | 内容 | 验收 |
| --- | --- | --- |
| M0-1 | 合并 `feat/mbd-isoline-axis`（→ `48fed2d9`）与 plant-mbd `feat/isoline-axis`（→ `3db2d92`）；gen-model worktree 重编；按 r2 口径重跑 `mbd_3d=0&mbd_polar=1` A/B | 两仓 main 已快进；8023 下直段全带 `axis`；复测 README 落盘（结论：读数持平，见 F4）。**已完成（2026-11-07）** |
| M0-2 | 本计划落盘；N 计划顶部加互指 | 本文件；N 计划文首指针 |
| M0-3 | ADR 与术语：plant-mbd 0013（范围，修订 0001 与 `AGENTS.md`）、0014（PML 导出为金样基准，修订 0005）、0015（`MbdDataSource`，修订 0004）；本仓 0070（与标注类型无关的契约信封）；两仓 `CONTEXT.md` 补词条 | 四份 ADR 与词条入库 |
| M0-4 | 门禁跑法固化：vitest `--maxWorkers=2`（`npm run test:mbd`）；cargo 一律 `-j 2`；gen-model 全量构建只在 M0-1 / M7 / M8 三个集成点 | `package.json` 有 `test:mbd`；plant-mbd `AGENTS.md` 写明 `-j 2` |

### M1 共享内核、契约信封、统一入口、比对器

| ID | 内容 | owned_paths | 验收 |
| --- | --- | --- | --- |
| M1-1 | `text`：完整 126 项字宽表（修 x/X 槽位）、D2 去尾零、`good_cheight`；`lindim`：PML LINDIM 链（去 < 1 mm 点、`changeCheightAuto` 0.7、`sepSmallDim` 0.8、外叠 1.2·ch、「+N」0.6）；管道改走它 | plant-mbd `src/{text,lindim}.rs`、`isodim.rs` | 6 条管道金样逐字节不变；表驱动单测（清单 §13） |
| M1-2 | `geom`：投影 / 距离 / `wire` 去副本、容差化角度与范围区间、`PlaneFrame`（与点序无关的法向）、带倒圆的闭合轮廓、规整化、含边界的点在轮廓内、环形排序、象限外点、凸分解、包围盒中心 | plant-mbd `src/geom/**` | 表驱动单测；`direction.rs` 怪癖不动 |
| M1-3 | 契约信封（ADR 0070）：前端先接受，再 mirror，再产出 | 本仓 `adapters/mbdV2Contract.ts`、`adapters/mbdV2ExternalAnnotations.ts`、`ui/` 新分组模块、`src/fixtures/mbd-v2/envelope-fields.json`；plant-mbd `contract.rs`、`tests/contract_guard.rs`、`fixtures/contract/envelope-fields.json` | 两侧往返；管道负载逐字段不变；面板按 FUNCTION 分组 |
| M1-4 | `AnnotationType`、`ObjectLayoutRequest` + `LayoutParams::defaults_for`（PML 各窗体 setting 值）、`MbdDataSource` + `InMemoryMbdSource`、`layout_object` 分派；CLI / 金样能回放对象 fixture | plant-mbd `src/object.rs`、`support/` / `civil/` / `equipment/` 骨架、CLI 新模块 | 管道经 `layout_object` 的图元与 `layout_branch` 相同；桩类型各自信封正确 |
| M1-5 | `plant-mbd-cli pml diff`：PML `content`（N 点 `dim`、`lableLine` + `line`、`text` / `line` / `arc` / `circle` / `point`）↔ 契约图元；语义精确、摆位 1 mm / 0.1°；`rulings.json` 有意偏差；`fixtures/pml/<type>/<case>/` | plant-mbd-cli 新模块、`fixtures/pml/**` | 手写自测样例覆盖通过 / 语义失败 / 摆位失败 / 裁决豁免 |

### M2a 管道：极坐标摆位进求解器

PML `object/polarsystem/**` 移入 plant-mbd 新模块 `polar/`：直段柱坐标系（原点 = 直段起点、轴 = 走向、零向 = showdir）；horidir 的竖管参考与「与上段 < 45° / > 135° 跟随」、lookangle；环扇柱障碍（管身、真实外径件、支管圆柱 EM4 1·od / EM9 3·od、阀门 / 仪表 / PCOM 体积盒、文字带、尺寸带、相邻直段管身、跨段传递）；`getBestPosAndOri` 14 步、`getMainDimDir`、EM4 / EM9 两张罚分表；确定性 tie-break。修正 PML 缺陷（引线系数未生效、0° / 360° 接缝、EM9 不可达罚分行），「平行线不占径向」「小桶丢弃」先出裁决。尺寸方向改由主尺寸方向给出，标签 / 焊缝 / 角度 / 调整焊走 `getBestPosAndOri`，`direction.rs` 非极坐标选向退役。宿主补阀门 / 仪表 / PCOM 体积盒。

验收：金样语义部分（点、数值、分链）逐字节不变、位置部分逐条说明；本计划 F4 的生成器同口径复测；通过后前端 `kernel/layout/polar/place/**` 退役，N2-2 / N4-1 标记为被本包取代。

### M2b 管道：缺失尺寸能力（EM4 / EM9）

支管口尺寸（`drawteeolet`，偏移 0.6·aod）→ 流向（仅 EM4、主尺寸最长段、3·ch 箭杆、BOTH 双头）与伴热（`:ZD_GDBR`、0.8·ch 虚线）→ 管道附件分类（pipeatta：leg / lug / pad / elbopad）→ 直管支撑腿与弯头支撑腿尺寸（含 `:ATTA-ADLONGTH` 的「+N」）→ KD 件与按名称 / 类型取点 → ATTA 焊缝与 EM9 自动补焊 → 调整焊符号 → 墙体定位尺寸（DMFARR，吃 M3 的土建面）。EM9 由 SITE 名判定：标到 COUP 为止、不画流向 / 伴热 / 支腿、极坐标容差更宽、字高比例取 setting 值 3.0（D8）。宿主新增字段先进 plant-mbd `docs/field-dictionary.md`，再 `serde(default)` 进结构。每项一条 toy fixture + 金样审阅记录。

### M3 设备定位 + 找墙内核（首个非管道类型）

- 宿主 `equipment_query`：EQUI 世界 POS / ORI、包围盒、第一个 ELCONN、全部 NOZZ 的 P1 POS / DIR / BORE、UDA。
- 宿主 `civil_faces`：按配置的土建范围从 `DbSet` 直读候选 WALL / GWALL / STWALL / FLOOR（D7），用 `loop_profile` / `spine_path` / `evaluate_section_profile` 得到两张大面的世界坐标顶点、法向、厚度、高度、弧墙 spine 与 cbow，50 m 粗筛。
- 求解器 `locate`（设备、EM9 架装支架、EM4 支架参考视向共用）：E / N / W / S / D 细盒射线搜墙（面 1° 水平或竖直、垂足在面内、夹角 ≤ 90°、弧墙 10° 与墙高）、分槽（45° / 60°）、定位尺寸（零偏移、方向字 0.01°–5°）、墙名 / 楼板名、EL 与板厚。缺陷裁决：槽内墙永不替换、单墙不出尺寸（默认改为出单条并报 issue）、方向字类别命名不一致。
- 求解器 `equipment`：S1 名称 + X / Y / PE 坐标块 → S2 偏转角（复用 `angle.rs`）→ S3 两向定位 + 墙名 → S4 楼板 EL / h。

验收：四切片各一 toy 金样；真实库一台 EQUI 经 M7 骨架端点出图。

### M4 EM9 仪表支架 / 仪表管支架 + 出图平面摆位引擎

- 宿主 `support_query`：SUPPO / `:SUPP` → STRU / REST / SUPC / HANG 层级；SCTN（POSS / POSE / DRNS / DRNE / CUTL / DTXR / SPREF、截面轮廓 JUSL → PLIN）、GENSEC spine、PANE 环与 NCYL 孔、FITT SBOX、PJOI P4 / P5、HELE APOS / LPOS、PCLA P0 / P3 / P4 / PARA[2] / CATE、ATTA、LNKI.LREF 墙面、目录 SBOX / SPRO+SPVE / LCYL / SCYL / SSCY / SEXT+SLOO 按实例求值、UDA；类型由 ZONE 名含架装关键字判定（配置）。
- 求解器 `support/em9`：12 类零件分类 → 接触检测（面面 ≥ 179° 且 ≤ 50 mm、端点落面 2 mm、70°–110° 视为垂直）→ 尺寸链 → 合并（0.01° / 2 mm）、零散点并入、去重（1° / 2 mm，总尺寸保留）→ 材料球标与支架功能标签 → 架装支架找墙定位与位号 + 坐标标签 → RA 板兜底。修正接触漏检（类型名拼错）、附件整段取不到、放置失败沿用上一条、单标签失败中止全部。
- 求解器 `support/plane_layout`（EM4 / EM9 共用）：视向候选（相交尺寸线延长 100 mm 取叉积、1° / 5° 去重、投影紧凑度排序、斜向 ×1.5、禁用半球 1° / 70°）→ 至多三张出图平面 → 分组（10°）与拓扑排序 → 一维找空（2.25·ch 空隙、1.875·ch 缺省偏移、1.2 × maxlen 即接受、9000 强制模式、超大墙盒跳过）→ 标签二维找空 → 朝向修正。

验收：最小切片（无墙、无清单，只含 SCTN + 钢板 + PCLA 的仪表管支架）先比链的方向 / 点列 / 级别 / planedir（0.5 mm），再接摆位比 POS / ORI 与标签位置（D9）。

### M5 EM4 支架（复用 M4 引擎）

构件收集（型钢、板拼假型钢、自由板、护板、FITT 加强板、吊挂件、弹簧直径轴）→ 组线（≤ 1° 且 1 mm / 50 mm + 外扩 50 mm 并线；≤ 5 mm 吊挂件跳过；端板 30 mm 不标）→ 板交点、线线交点（≥ 20°，端点吸附 30 mm）、附件点入线（半径 / 10 且 < 1 mm）→ 管中心定位（85°–95° 型钢、对面 1.2 倍、偏轴 > 1 mm 加偏移、PCLA 回退 10 mm）→ 一级链 + 首末总长（「+N」挂总长）→ 纯管夹支架相邻附件定位尺寸 → 二级尺寸 → 标签 → 去重（0.5 mm 合点、2 mm 包含）。附件收集改为配置化范围；修正 SPRO 多轮廓叠加、FITT 偏移丢失、`.from()` / `.to()` 未赋回、首板重复二级尺寸、斜型钢区间。验收：单根水平梁 + 一个 ATTA 起步，先比尺寸点集，再加板与假型钢、标签。

### M6 土建结构 / 建筑

宿主 `civil_query`（扩展 M3）：STWALL / WALL / GWALL / FLOOR / PANE / NXTR 几何、孔洞与埋件（NBOX / NCYL / NPYR；FITT 经 CATREF → NLCY / NSBO / NSEX+SVER）、房间（FRMW / SBFR → PANE，`room_key_word`）、门、UDA、埋件框架命名配置化。求解器 `civil`：面坐标系与原点 → 墙面标注（名称、厚度双圈、强度等级、墙端 EL、局部坐标系）→ 孔洞尺寸 / 定位值 / 编号 → 板墙归属三条件 → 墙段链按相接侧分链（2000 mm / 10° / 1 mm）→ 偏角 → 弧墙极角与内外 R → 外露边 → 房间号（凸分解找内部点）→ 建筑附加（墙名 `part(-3)`、门、EL r / f、排水沟）。修正 `findarcgoodx` 变量名、NRTO 丢弃、`define` 笔误、门 `intertpoints`。验收：单面 STWALL + 1 个 NBOX；1 块 FLOOR + 3–4 面直墙含 T 接。

### M7 通用端点 + 前端接入

- gen-model：`GET /api/mbd/v2/object/{refno}`，按 `DbOption.toml` 新段 `mbd_type_rules`（SITE / ZONE 关键字，缺省表复刻 PML `getmbdtype`）判定类型 → 读取器 → `layout_object`；可解回 200 + issues，根错误 422 带 `detail.issues`；`/pipe/{refno}` 为管道别名；`tests/mbd_object_endpoint.rs`（样本库不在时跳过）；`examples/mbd_object_dump.rs` 导出各类型视图 fixture。
- 本仓：`src/api/mbdV2Api.ts` 增 `fetchMbdV2Data` 走通用端点；`useMbdExternalSync.ts` 的 `?mbd_refno=` 接受任意对象；`ModelTreePanel.vue` 右键放开 SUPPO / `:SUPP` 下 STRU、EQUI、WALL / GWALL / STWALL / FLOOR；面板「标注不完整」按类型期望集；`mbd_kinds` 扩到新类型。同步层与面板文件在主检出上有别的会话的未提交改动，**动这两个文件前先协调**。
- 性能：密集支架 + 土建场景跑 `e2e/dimension-perf.spec.ts`，对照 ADR 0040。

### M8 PML 金样验收与文档收口

每类在 E3D 里用 PML 窗体开「标注后生成文件」导出 → `fixtures/pml/<type>/`（管道也补一份）；比对器全绿、有意偏差全部引用裁决。每类至少一个真实对象走通用端点在页面呈现，三档截图落 `docs/verification/mbd-<type>-<date>/`。文档：plant-mbd `docs/MIGRATION.md`、`docs/field-dictionary.md`、`fixtures/golden/README.md`；本仓审计计划 §14 门禁行、N 计划互指、`docs/notes/README.md` 索引；清单 §11 裁决表回填。

## 5. 决策（默认值，可改）

| # | 决策 | 状态 |
| --- | --- | --- |
| D1 | 金样基准：PML 导出 JSON（plant-mbd ADR-0014）；导出到位前按过渡做法 | 已定 |
| D2 | 契约承载：不开 V3，扩可选信封字段（ADR 0070）；`branch_refno` 仍必填，非管道包填归一化主体 refno | 已定 |
| D3 | 数据源：`MbdDataSource: BranchDataSource` 多方法（plant-mbd ADR-0015） | 已定 |
| D4 | 极坐标唯一实现在求解器；复测通过后前端 `polar/place/**` 退役，N2-2 / N4-1 由 M2a 取代 | 已定 |
| D5 | PML 缺陷默认修正，每条带 PML 出处的裁决进清单 §11、plant-mbd `MIGRATION.md` 与 `fixtures/pml/rulings.json` | 已定 |
| D6 | 标注类型判定走项目配置 `mbd_type_rules`，缺省表复刻 PML `getmbdtype` | 已定 |
| D7 | 找墙候选由宿主从 `DbSet` 直读土建元素并解析面，不依赖已生成 AABB 树 | 已定 |
| D8 | EM9 仪表管字高比例取 setting 文件值 3.0（窗体打开即 `recoversetting()`，生产用的是它） | 已定 |
| D9 | EM9 支架金样以「修复接触漏检与附件读取之后」为准 | 已定 |

## 6. 风险

| # | 风险 | 处置 |
| --- | --- | --- |
| R1 | 内存紧（OOM 前科） | `-j 2`、vitest `--maxWorkers=2`、集成点才全量构建 |
| R2 | 三个主检出都有别的会话在改 | 全部在 worktree 分支做；每包声明 owned_paths；合并窗口协调；动 `useMbdExternalSync.ts` / `DimensionPanelDock.vue` 前先确认对方已提交 |
| R3 | 没有 E3D 导出环境，M8 卡住 | 比对器先用手写样例验证；各类型先按过渡金样推进；导出一到即切换 |
| R4 | 宿主取数缺口（目录负体、EQUI 包围盒、NOZZ P1、LNKI 墙面） | 读取器先在 AvevaMarineSample 上做 spike；缺失记 `adapter.*` issue，不猜 |
| R5 | 范围蔓延 | 按 spec「不在范围内」拒绝（见 §8） |

## 7. 验收命令

```powershell
# plant-mbd（集成分支或车道 worktree）
cargo fmt --all -- --check
cargo test --workspace -j 2
cargo clippy --workspace --all-targets -j 2
cargo run -p plant-mbd-cli -j 2 -- golden diff
cargo run -p plant-mbd-cli -j 2 -- pml diff --dir fixtures/pml

# gen-model（gen-model-mbd-all）
cargo test --test mbd_branch_query --test mbd_http_endpoint --test mbd_object_endpoint -j 2

# plant3d-web（路径用大写盘符 D:\，小写 d:\ 会让 vitest 加载两份模块）
npm run test:mbd
npm run type-check
npx eslint <改动文件>
npx playwright test --config=playwright.novideo.config.ts e2e/dimension-mbd-v2-fixture.spec.ts e2e/dimension-camera-baseline.spec.ts
```

## 8. 不做的事

材料 / 汇总材料 / 属性 / 直管段 / 在役检查等表格 JSON；材料编号标签；RVM / ATT / TXT 导出与 TPlant 上传；写回 E3D 模型库与 E3D 侧交互（拖标签、改字高、手动拾墙、手动定位点）；暖通 EM5 与电气 EM8；PML 死路径（支架旧路径、设备旧算法、三通线对象、按类型局部重画、设备极坐标定位、从已有标注反推状态）；桌面端接入（除保持契约兼容）。

## 9. 门禁基线（2026-11-07，只增不减）

| 仓 | 口径 | 数字 |
| --- | --- | --- |
| plant-mbd `3db2d92` | `cargo test --workspace` | lib 140、adjust_weld 3、contract_guard 7、golden_regression 1、isodim_rj_pcom 10、pcom_split 7 |
| plant3d-web `48fed2d9` | `src/dimension` + `useMbdExternalSync` | 86 文件 / 844 通过；type-check 0 / 新增 0 |

## 10. 提交记录

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | plant3d-web `48fed2d9` | 契约接受 `meta.isolines[].axis`，极轴改用它 |
| 2 | plant-mbd `3db2d92` | 直段表产出 `axis`；六条金样仅新增 `axis` |
| 3 | plant-mbd `1863a19`（`feat/mbd-all-types`） | ADR-0013 / 0014 / 0015、两份词条、`AGENTS.md` |
