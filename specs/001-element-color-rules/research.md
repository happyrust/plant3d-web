# Research: AVEVA E3D 着色机制（为颜色规则特性提供依据）

> 来源：对 `D:/AVEVA/Everything3D2.10` 的逆向分析（PML/数据层 + IDA 反编译 `core.dll`/`Core3D.dll`/`udNet.dll`）。本特性的规则模型直接对齐于此。

## 1. E3D 的着色优先级（绘制时取色）

证据：`Core3D.dll` 的 `DES_DrawList::getColour / getPrimitiveOrTOPFColour / getHighlightColour / updateAutoColour`（后者调用 `CT_get_actual_rgb(293,...)`）。

优先级（高→低）：
1. **选中/高亮**（HIGHLIGHT，走色号 24；`getHighlightColour`）
2. **AutoColour 规则命中**（`AUTOCOLOUR ON` 时，按规则顺序首条命中）
3. **构件自身 `Colour` 属性**（未设则沿 owner 层级继承）
4. **VISIBLE 默认色**（默认 lightgrey）

→ 本特性映射：highlight（现有独立层）＞ colorRules ＞ instance/noun/default（现有链路）。

## 2. AutoColour 规则模型（核心）

证据：PML `gphautocolour.pmlobj` / `rule.pmlobj` / `gphcolopt.pmlobj` 与默认数据文件。

- 规则 = `ALL ( <types> ) WITH ( <attr expr> )`：`types` 是元素类型集合，`WITH` 是可选属性谓词。
- 每条规则映射到「颜色（固定色号或逐元素表达式）+ 半透明 + 描边(EDGES)」。
- 引擎命令：`AUTOCOLOUR <ruleString> COLOUR <col> TRANSLUCENCY <t> EDGES <on/off>`；`AUTOCOLOUR ON/OFF/RESET/COMPONENT/DYNAMIC` 控制开关。
- 匹配语义：按列表顺序，**首条命中生效**。

数据文件位置（默认 DFLTS）：
- 规则定义：`D:\AVEVA\Everything3D\Data2.10\DFLTS\des-element-rules.pmldat`
- 规则→配色：`D:\AVEVA\Everything3D\Data2.10\DFLTS\des-col.pmldat`

### 默认方案中可直接转成本特性的代表规则

| E3D 规则名 | types | WITH 条件 | 颜色 | → 本特性 when |
|---|---|---|---|---|
| All Equipment | EQUI | — | gold | `{nouns:["EQUI"]}` |
| All Pipes | PIPE | — | green | `{nouns:["PIPE"]}` |
| All Sections | SCTN GENSEC | — | tan | `{nouns:["SCTN","GENSEC"]}` |
| Structural Panels | PANE | TYPE OF OWNER inset (STRU,SUBS,FRMW,SBFR) | wheat(透25) | `{nouns:["PANE"],owners:["STRU","SUBS","FRMW","SBFR"]}` |
| All Hangers/Supports | HANG/ATTA | — | orangered | `{nouns:["HANG","ATTA"]}` |
| All Handrails | HANDRA | — | powderblue | `{nouns:["HANDRA"]}` |
| All HVAC | HVAC | — | yellowgreen | `{nouns:["HVAC"]}` |
| All Civil | ZONE | PURP EQ 'CIV' | lightgrey | `{nouns:["ZONE"],purposes:["CIV"]}` |
| All Piping-HVAC | BRAN | PURP OF ZONE eq 'HVAC' | yellowgreen | `{nouns:["BRAN"],specs:[<HVAC>]}`（按 T2 映射）|
| Cable | CABLE | — | mauve | `{nouns:["CABLE"]}` |

> `PURP OF CE`/`TYPE OF OWNER` 这类要么映射到本特性的 `purposes`/`owners`，要么（更深的 `OF ZONE`/多级 owner）落到 phase-4 通用谓词。v1(B) 用 `nouns/owners/specs/purposes/refno*/name` 可覆盖上表绝大多数。

## 3. 命名调色板（name → RGB）

证据：`core.dll` 内置结构体数组（`0x10C80428` 起，每条 0x20 字节 `{char* name; uint32 number; double R,G,B}`，RGB 为 0~1），IDA(idalib) 提取共 61 个命名色。完整表见同目录 `assets/e3d-palette.json`。

要点：E3D 基础色是**降饱和**的（`red=#CC0000`、`green=#00CC00`、`yellow=#CCCC00`），满饱和叫 `brightX`（`brightred=#FF0000`）。常用：

| 名称 | hex | | 名称 | hex |
|---|---|---|---|---|
| red | #CC0000 | | green | #00CC00 |
| brightred | #FF0000 | | forestgreen | #238E23 |
| gold | #EDC932 | | yellowgreen | #99CC32 |
| orange | #ED9A00 | | cyan | #00EDED |
| orangered | #FF7F00 | | royalblue | #4876FF |
| tan | #BD8D7E | | powderblue | #B0E0E6 |
| wheat | #F5DEB3 | | steelblue | #008DBD |
| khaki | #9F9F5F | | mauve | #660099 |
| magenta | #DE00DE | | lightgrey | #C0C0C0 |

`MIX Red r Green g Blue b` 表示任意色；系统色号 305–354 为「系统色」。颜色名→色号由 CT 颜色表库（`udNet.dll` 导出的 `CT_*`）在注册时分配，复刻时**直接用 name→RGB 即可**，不依赖色号。

## 4. 数据列核实（Phase 0 结论 / 2026-06-12）

依据 `useDbnoInstancesParquetLoader.ts` 的实例查询 SQL（`queryInstanceEntriesByRefnos`，~第 811–907 行）：

- 实例 `i` 实际 SELECT 的列：`refno_str, noun, owner_refno_str, owner_noun, cata_hash, spec_value, has_neg, trans_hash, aabb_hash`。
- **`purpose`(PURP)**：当前 SQL **未取**，`uniforms` 中无该字段 → 规则 `purposes` 维度暂不可命中。
- **`name`**：`uniforms.name` 当前**硬编码为 `''`**（两处构造 InstanceEntry 处），SQL 未取 → 规则 `namePattern` 暂不可命中。
- **`spec_value`**：`parseSpecValue` 仅做数值化（`Number()`），未做语义归类。配置里 `disciplineOverrides` 用 `0/3/4`，而 `normalizeSpecOverrideKey` 用 `1=PIPE,4=HVAC`——**语义不一致未解**，需用真实数据抽样核实后再在规则里使用 `specs`。

**结论与已落地处理**：
- v1 引擎**已支持** `purposes/namePattern/specs` 维度（matcher + context + cache 就绪），但 `purpose/name` 在当前数据下取不到值，命中需后续在 `useDbnoInstancesParquetLoader.ts` 的 SELECT 增列并写入 `uniforms`（前提：确认 `instances.parquet` 确有对应列）。loader 已**防御式读取** `uniforms.purpose/purp/name`，有值即生效，无值不报错。
- “E3D 经典” 预设里 HVAC 等改用 **noun**（`HVAC/HSPOOL`）命中，不依赖 `spec_value`，规避 T2 不一致风险。

### 启用 purpose/name 的后续步骤（未做，留待确认数据列后）
1. 确认 `instances.parquet` 是否含 PURP/name 列及列名。
2. 在 `queryInstanceEntriesByRefnos` 的 `SELECT` 增 `i.<purpose列>`, `i.<name列>`，并写入 `uniforms.purpose`、`uniforms.name`（替换当前 `name:''`）。
3. 无需改 DTX loader（已从 `uniforms` 读取并写入 cache）。

## 5. plant3d-web 现状锚点（实现对接）

- 着色入口：`src/composables/useDbnoInstancesDtxLoader.ts` → `applyMaterialConfigToLoadedDtx`（第 ~382–420 行，第 ~403 行调 `resolveMaterialWithTheme`）。
- 材质解析：`src/utils/three/dtx/materialConfig.ts`（`resolveMaterialForInstance` / `resolveMaterialWithTheme` / `resolveThemeOwnerOverride` / `buildExportConfig` / `saveLocalMaterialConfig` / `toThreeColor` / `clamp01` / `normalize*`）。
- 可用字段（cache，第 39–54 行）：`refnoToNoun / refnoToOwnerNoun / refnoToOwnerRefno / refnoToSpecValue / objectIdToSpecValue / refnoToObjectIds`。
- 配置文件：`public/config/model-display.config.json`（`materialConfigs / instanceConfigs / disciplineOverrides / themes`）。
- UI：`src/components/tools/DtxMaterialConfigPanel.vue`。
- 落地：`DTXLayer.setObjectMaterial({color,metalness,roughness,opacity})` / `setObjectVisible`；描边 `DTXOutlineHelper`。
