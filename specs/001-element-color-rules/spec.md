# Feature Spec: 构件颜色规则（Element Color Rules / AutoColour）

- **Feature ID**: 001-element-color-rules
- **Status**: Draft（grill-me 已定 8 项核心决策）
- **Owner**: plant3d-web 渲染/材质
- **Created**: 2026-06-12
- **关联调研**: 见 `research.md`（AVEVA E3D AutoColour 逆向分析 + 调色板）

---

## 1. 概述（What / Why）

让用户能用**一组有序、带条件的规则**给三维模型里不同的构件（Element）自动上色，对齐 AVEVA E3D 的 **AutoColour** 行为：

> 「对每个构件，按规则列表从上往下找，第一条命中的规则决定它的颜色/透明度。」

### 为什么需要

- 现状只能按**单一 key**上色：`materialConfigs[noun]`（按类型）、`instanceConfigs[refno]`（按实例）、`disciplineOverrides[spec]`（按专业）、`themes.ownerOverrides[owner]`（按所属类型）。无法表达**组合条件**（如「owner 属于结构体系的 PANE」「专业=HVAC 的 BRAN」「PURP='CIV' 的 ZONE」）。
- 无法控制**优先级顺序**：多个 key 同时命中时，行为是固定的覆盖链，用户不可调。
- 无法**一键套用一套成体系的配色方案**（如 E3D 经典配色）。

### 价值

- 用一份可移植的规则表，复刻/自定义 E3D 风格的按专业、按类型、按属性配色。
- 规则可启停、可排序、可导入导出，便于在不同项目/评审场景间切换。

---

## 2. 术语

| 术语 | 含义 |
|---|---|
| **noun** | 构件类型（PDMS/E3D element type），如 `EQUI/PIPE/PANE/BRAN`。代码中已规范化大写 |
| **owner / ownerNoun** | 构件所属父元素的类型 |
| **spec_value** | 专业判别值（discipline），现有配置用 `0/3/4` 等，语义需在 research 中核实 |
| **refno** | 元素引用号（规范化后 `/`→`_`） |
| **purpose (PURP)** | E3D 元素的用途属性（如 ZONE 的 `CIV/PIPE/HVAC`），**本特性新增取数** |
| **ColorRule** | 一条「条件 → 外观」的规则 |
| **first-match** | 规则按顺序求值，第一条命中即生效 |

---

## 3. 用户故事与验收标准

### US-1：按构件类型批量上色（已可用能力的规则化）
**作为**模型浏览用户，**我想**把所有 `PIPE/TUBI/ELBO` 显示为绿色，**以便**快速区分管道。

- **AC-1.1** 在 `colorRules` 中加入 `{ when:{nouns:["PIPE","TUBI","ELBO"]}, color:"#00CC00" }` 后，加载/刷新模型，这些类型的构件渲染为 `#00CC00`。
- **AC-1.2** 未被任何规则命中的构件，外观与当前（noun/theme/default）解析结果一致，无回归。

### US-2：按组合条件上色（新增能力）
**作为**结构专业用户，**我想**只把「owner 是 STRU/FRMW/SUBS/SBFR 的 PANE」上成 wheat 且半透明，**以便**突出结构面板。

- **AC-2.1** 规则 `{ when:{nouns:["PANE"], owners:["STRU","FRMW","SUBS","SBFR"]}, color:"#F5DEB3", opacity:0.75 }` 仅对满足 owner 条件的 PANE 生效；其它 owner 下的 PANE 不变。
- **AC-2.2** 支持按 `spec_value` 命中（如 `specs:[4]` 命中 HVAC）。
- **AC-2.3** 支持按 `purpose` 命中（如 `purposes:["CIV"]` + `nouns:["ZONE"]`），属性取数到位。

### US-3：有序优先级（first-match）
**作为**用户，**我想**让靠前的规则覆盖靠后的，**以便**用「特例在前、通则在后」表达意图。

- **AC-3.1** 两条规则都命中同一构件时，**列表中靠前**的那条生效。
- **AC-3.2** 调整规则顺序后重新应用，颜色随之改变。

### US-4：全局开关（对齐 AUTOCOLOUR ON/OFF）
- **AC-4.1** `colorRules.enabled=false` 时，所有规则不参与，外观回退到现有解析链，与本特性上线前**逐像素一致**。
- **AC-4.2** 切换开关后无需重载模型即可重新着色（调用现有 apply 流程）。

### US-5：与选中高亮共存
- **AC-5.1** 选中/高亮态优先级**高于**任何 colorRule；取消选中后恢复规则色。

### US-6：内置 “E3D 经典” 预设
- **AC-6.1** 提供一份从 E3D 默认方案转换来的 `colorRules` 预设（设备/管道/结构/HVAC/电缆/支吊架等），用户可一键载入。
- **AC-6.2** 预设中的颜色取值来自 E3D 命名调色板（见 research 的 `_e3d_palette.json`，已降饱和，如 `red=#CC0000`）。

### US-7：可见性规则
- **AC-7.1** 规则可设 `hidden:true`，命中构件隐藏（复用 `setObjectVisible(false)`）；与现有 `hiddenNouns/hiddenRefnos` 行为不冲突（取「任一为真即隐藏」）。

### US-8：配置载体与可移植性
- **AC-8.1** 规则可写在项目级 `public/config/model-display.config.json`。
- **AC-8.2** 用户级修改存 localStorage 并在加载时叠加覆盖（复用 `saveLocalMaterialConfig`）。
- **AC-8.3** `buildExportConfig` 导出包含 `colorRules`，可在项目间迁移。

---

## 4. 范围

### In Scope（v1）
- `ColorRule` 数据模型 + JSON Schema。
- 规则匹配函数（first-match）与解析整合（`resolveMaterialWithRules`）。
- loader 取数扩展：新增 `purpose`、`name` 两列与对应 cache（决策 1=B）。
- 全局 `enabled` 开关；与 highlight/现有链路的优先级整合。
- 记忆化以保证大模型性能。
- “E3D 经典” 预设 JSON（由 research 工件转换）。
- 单元测试（matchColorRule / resolveMaterialWithRules）。

### Out of Scope（phase-2，单列任务但不阻塞 v1）
- 规则编辑 UI（`DtxMaterialConfigPanel.vue` 增 tab：增删/启停/拖拽/实时预览）。
- 描边 `edges`（接 `DTXOutlineHelper`）。
- 通用属性谓词表达式引擎（任意属性 + AND/OR/比较，对应 E3D `WITH(expr)` 全量）。
- 逐属性变更的动态实时重算（E3D dynamic autocolour）。

### Non-Goals
- 不改变几何加载/LOD/拾取逻辑。
- 不替换现有 `materialConfigs/instanceConfigs/themes`，仅在其**之上**叠加规则层。

---

## 5. 约束与依赖

- 渲染：three r0.162，材质经 `DTXLayer.setObjectMaterial({color,metalness,roughness,opacity})` 落地。
- 着色入口：`useDbnoInstancesDtxLoader.ts` 的 `applyMaterialConfigToLoadedDtx`（当前第 ~403 行调用 `resolveMaterialWithTheme`）。
- 配置：`materialConfig.ts` 的 `ModelDisplayConfig` / `loadModelDisplayConfig` / `saveLocalMaterialConfig` / `buildExportConfig`。
- 数据：实例来自 DuckDB/Parquet，取数在 `useDbnoInstancesDtxLoader.ts`（cache 字段见第 39–54 行）。新增列依赖底层表确有 `purpose/name`（**需在 research/任务 T2 中核实列名**）。
- 编码规范：2 空格、单引号、必须分号；导入置顶（仓库 ESLint + 工作区规则）。

---

## 6. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `spec_value` 语义不一致（注释 0=PIPE vs 代码 1=PIPE） | 按专业的规则误命中 | T2 核实，spec 文档显式标注，预设里少依赖 spec |
| 底层表无 `purpose/name` 列或命名不同 | US-2.3 落空 | T2 先查 schema；缺失则该字段降级为不可用并在 UI 提示 |
| 大模型逐对象跑规则性能 | 着色卡顿 | (noun\|owner\|spec\|purpose) 记忆化；规则数量上限软约束 |
| 与 themes/disciplineOverrides 叠加产生意外覆盖 | 颜色不符预期 | 明确单一优先级链（§US 与 plan §4）；`enabled=false` 可一键回退 |

---

## 7. 成功度量

- 打开 “E3D 经典” 预设后，设备/管道/结构/HVAC 的配色与 E3D 截图肉眼一致（抽样 ≥6 类）。
- `enabled=false` 与上线前渲染逐对象一致（回归测试用例）。
- 规则匹配在 10 万对象规模下单次全量重着色 < 现有 apply 耗时的 1.2×。
