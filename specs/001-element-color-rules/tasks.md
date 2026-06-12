# Tasks: 构件颜色规则（001-element-color-rules）

> 配套 `spec.md` / `plan.md`。任务按依赖排序；`[P]` 表示可并行。每条含验收口径。

## Phase 0 — 核实（解除关键风险）

- [ ] **T1｜核实底层实例表列**
  - 在 `useDbnoInstancesDtxLoader.ts` 的取数 SQL（DuckDB/Parquet）确认是否存在 `purpose`(PURP) 与 `name` 列及其确切列名/类型。
  - 产出：在 `research.md` §「数据列核实」记录列名、样例值；若缺失，标注降级方案。
  - 验收：明确 `purposes`、`namePattern` 两个 `when` 维度在当前数据上是否可用。
- [ ] **T2｜核实 `spec_value` 语义** [P]
  - 交叉比对 `model-display.config.json.disciplineOverrides`（`0/3/4`）、代码注释（`0=PIPE,3=INST,4=HVAC`）与 `normalizeSpecOverrideKey`（`1=PIPE,4=HVAC`）的不一致。
  - 产出：`research.md` §「专业值映射」给出权威映射表（用真实数据抽样验证）。
  - 验收：预设里凡用 `specs` 的规则都基于核实后的值。

## Phase 1 — 引擎（v1 / MVP）

- [ ] **T3｜数据模型与类型**（依赖无）
  - `materialConfig.ts` 增 `ColorRuleWhen / ColorRuleAppearance / ColorRule / ColorRuleContext`；`ModelDisplayConfig` 增 `colorRules?: ColorRule[]`、`colorRulesEnabled?: boolean`。
  - 验收：`npm run type-check` 通过。
- [ ] **T4｜matchColorRule**（依赖 T3）
  - 实现 first-match 匹配（见 plan §3），维度内 OR、维度间 AND、省略维度通配；大小写规范化复用 `normalizeNounKey/normalizeRefnoKey`。
  - 验收：单测覆盖各维度命中/不命中/通配/顺序优先（AC-3.1/3.2）。
- [ ] **T5｜resolveMaterialWithRules**（依赖 T4）
  - 命中用规则外观、未指定字段回退 `resolveMaterialForInstance`；`colorRulesEnabled===false` 直接走 `resolveMaterialWithTheme`。
  - 验收：`enabled=false` 与现链路逐字段相等（AC-4.1）；命中/未命中三态单测。
- [ ] **T6｜loader 取数扩展**（依赖 T1）
  - cache 增 `refnoToPurpose`、`refnoToName`（`useDbnoInstancesDtxLoader.ts` 第 39–54 / 64–78 区域）；SQL 增列并在回填 refno 映射处写入（参考第 ~675–715 区域 `refnoToNoun.set` 等）。
  - 验收：随机抽 refno，`getCache` 中 purpose/name 与底层数据一致。
- [ ] **T7｜着色入口接线**（依赖 T5, T6）
  - `applyMaterialConfigToLoadedDtx` 内构造 `ColorRuleContext{refno,noun,ownerNoun,specValue,purpose,name}`，把第 ~403 行 `resolveMaterialWithTheme(...)` 换为 `resolveMaterialWithRules(config, ctx, theme)`。
  - 验收：加规则后刷新模型，命中构件变色（AC-1.1/2.1）；选中高亮仍压过规则（AC-5.1）。
- [ ] **T8｜记忆化**（依赖 T7）[P]
  - apply 内建 `Map<string,ResolvedMaterial>`，key 见 plan §3；规则用到 refno/name 时退化为不缓存。
  - 验收：N≈1e5 单次 apply < baseline×1.2（成功度量）。
- [ ] **T9｜配置合并/导出/本地覆盖**（依赖 T3）[P]
  - `mergeConfigs` 合并本地 `colorRules`（localStorage 覆盖项目级）；`buildExportConfig` 带出 `colorRules`/`colorRulesEnabled`；`saveLocalMaterialConfig` 接受 `colorRules`。
  - 验收：本地改规则→刷新仍在；导出 JSON 含规则（AC-8.*）。
- [ ] **T10｜可见性整合**（依赖 T7）[P]
  - 规则 `hidden:true` → `setObjectVisible(false)`，与 `hiddenNouns/hiddenRefnos` 取「任一为真」。
  - 验收：隐藏规则生效且不破坏既有隐藏（AC-7.1）。
- [ ] **T11｜单元测试**（依赖 T4,T5）
  - 扩 `materialConfig.test.ts`：matchColorRule 维度矩阵、优先级、开关、回退。
  - 验收：`npx vitest run src/utils/three/dtx/materialConfig.test.ts` 全绿。

## Phase 2 — E3D 经典预设

- [x] **T12｜调色板转 JSON** — `public/config/presets/e3d-classic.colorRules.json`（13 条，颜色取自 `assets/e3d-palette.json`）。HVAC 改走 noun 规避 T2 spec 语义不一致。
- [x] **T13｜预设载入入口** — 面板「载入 E3D 经典」按钮：`fetch('config/presets/e3d-classic.colorRules.json')` → 写入 `colorRules` → Apply。

## Phase 3 — UI（编辑器）

- [x] **T14｜规则编辑器 tab** — `DtxMaterialConfigPanel.vue` 新增「颜色规则」tab：规则列表（启停勾选 / 色块 / 上移下移 / 删除）+ 编辑区（name/color/opacity/hidden + when 的 nouns/owners/specs/purposes/refnoPrefix/namePattern）+ 全局启用开关 + 新增/载入预设；Save/Apply/Export 复用现有流程并带出 colorRules。

## Phase 4 — 可选增强

- [ ] **T15｜edges 描边**（依赖 T7）：规则 `edges:true` 接 `DTXOutlineHelper`。
- [ ] **T16｜动态实时重算**：监听属性/主题变更触发增量 apply（对齐 E3D dynamic autocolour）。
- [ ] **T17｜通用谓词表达式**：`when.expr` 安全求值（AND/OR/比较/inset），覆盖 E3D `WITH(expr)` 全量。

## 收尾校验（合并前）
- [ ] `npm run type-check`、`npm run lint`、`npm test` 通过。
- [ ] 回归：`colorRulesEnabled=false` 与上线前渲染一致（截图或逐对象对比）。
- [ ] 若动到 `ReviewPanel.vue`/`DesignerCommentHandlingPanel.vue`（本特性预期不会）则跑 AGENTS.md 规定的双胞胎面板回归。
