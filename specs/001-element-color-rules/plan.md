# Implementation Plan: 构件颜色规则（001-element-color-rules）

> 与 `spec.md` 配套。本文件描述架构、数据模型、文件级改动与分阶段实施。任务清单见 `tasks.md`。

---

## 1. 架构总览

在现有「配置驱动材质解析」之上，**叠加一层有序规则**，不改几何/拾取/LOD：

```
加载实例(DuckDB/Parquet)
        │  refno, noun, owner, spec_value, [purpose, name(新增)]
        ▼
applyMaterialConfigToLoadedDtx (loader)            ← 着色总入口（已存在）
        │
        ▼
resolveMaterialWithRules(config, ctx)              ← 新增封装
        ├─ 若 colorRules.enabled 且 matchColorRule(ctx) 命中 ──► 用规则外观（未指定字段回退 base）
        └─ 否则 ──► resolveMaterialWithTheme(...)  ← 现有解析链（theme→instance→noun→default）
        ▼
DTXLayer.setObjectMaterial / setObjectVisible      ← 落地到 three（已存在）
```

选中高亮由 `DTXSelectionController/DTXOverlayHighlighter` 独立叠加，**优先级最高**，不在本链路内，无需改动即满足 US-5。

### 统一优先级链（从高到低）
1. 选中/高亮（现有，独立层）
2. `colorRule`（`enabled=true` 时，first-match）
3. `instanceConfigs[refno]`（现有，手选实例）
4. theme `ownerSpecOverrides` / `ownerOverrides`（现有）
5. `materialConfigs[noun]`（现有）
6. `disciplineOverrides[spec]`（现有，仅覆盖颜色）
7. `defaultMaterial`（现有）

> 说明：规则层只「命中即覆盖」，**未命中则完全走原链路**，因此 `enabled=false` 时与上线前逐对象一致（AC-4.1）。需要让某个手选实例颜色压过规则时，加一条 `when:{refnos:[...]}` 的规则置于列表顶部即可（统一进规则表）。

---

## 2. 数据模型（`materialConfig.ts` 新增）

```ts
// 条件：所有给定维度按「该维度内 OR、维度间 AND」匹配；省略的维度视为通配
export type ColorRuleWhen = {
  nouns?: string[]        // 构件类型
  owners?: string[]       // 所属类型
  specs?: number[]        // 专业 spec_value
  purposes?: string[]     // PURP（新增取数）
  refnos?: string[]       // 精确 refno
  refnoPrefix?: string[]  // refno 前缀
  namePattern?: string    // name 子串（大小写不敏感，v1 仅 contains）
}

export type ColorRuleAppearance = {
  color?: string | number
  opacity?: number
  metalness?: number
  roughness?: number
  hidden?: boolean
  // edges?: boolean       // phase-2
}

export type ColorRule = ColorRuleAppearance & {
  name: string            // 规则名（展示/调试用，对齐 E3D 规则名）
  when: ColorRuleWhen
  enabled?: boolean       // 单条启停，缺省 true
}

// ModelDisplayConfig 增字段：
//   colorRules?: ColorRule[]
//   colorRulesEnabled?: boolean   // 全局开关，缺省 true（对齐 AUTOCOLOUR ON）
```

匹配上下文（由 loader 提供）：

```ts
export type ColorRuleContext = {
  refno: string
  noun: string
  ownerNoun: string
  specValue?: number | null
  purpose?: string | null   // 新增
  name?: string | null      // 新增
}
```

---

## 3. 核心算法

```ts
export function matchColorRule(
  rules: ColorRule[] | undefined,
  ctx: ColorRuleContext,
): ColorRule | null {
  if (!rules || rules.length === 0) return null;
  const noun = normalizeNounKey(ctx.noun);
  const owner = normalizeNounKey(ctx.ownerNoun);
  const refnoKey = normalizeRefnoKey(ctx.refno);
  const purpose = (ctx.purpose ?? '').trim().toUpperCase();
  const name = (ctx.name ?? '').toUpperCase();
  for (const r of rules) {
    if (r.enabled === false) continue;
    const w = r.when || {};
    if (w.nouns && !w.nouns.map(normalizeNounKey).includes(noun)) continue;
    if (w.owners && !w.owners.map(normalizeNounKey).includes(owner)) continue;
    if (w.specs && (ctx.specValue == null || !w.specs.includes(ctx.specValue))) continue;
    if (w.purposes && !w.purposes.map((p) => p.trim().toUpperCase()).includes(purpose)) continue;
    if (w.refnos && !w.refnos.map(normalizeRefnoKey).includes(refnoKey)) continue;
    if (w.refnoPrefix && !w.refnoPrefix.some((p) => refnoKey.startsWith(normalizeRefnoKey(p)))) continue;
    if (w.namePattern && !name.includes(w.namePattern.toUpperCase())) continue;
    return r; // first-match
  }
  return null;
}

export function resolveMaterialWithRules(
  config: ModelDisplayConfig,
  ctx: ColorRuleContext,
  theme: DisplayTheme,
): ResolvedMaterial {
  if (config.colorRulesEnabled !== false) {
    const rule = matchColorRule(config.colorRules, ctx);
    if (rule) {
      const base = resolveMaterialForInstance(config, ctx.refno, ctx.noun, ctx.specValue);
      const fb = config.defaultMaterial?.color ?? '#90a4ae';
      return {
        color: rule.color != null ? toThreeColor(rule.color, fb) : base.color,
        metalness: typeof rule.metalness === 'number' ? clamp01(rule.metalness, base.metalness) : base.metalness,
        roughness: typeof rule.roughness === 'number' ? clamp01(rule.roughness, base.roughness) : base.roughness,
        opacity:   typeof rule.opacity   === 'number' ? clamp01(rule.opacity,   base.opacity)   : base.opacity,
        hidden: rule.hidden ?? base.hidden,
      };
    }
  }
  return resolveMaterialWithTheme(config, ctx.refno, ctx.noun, ctx.ownerNoun, theme, ctx.specValue);
}
```

`toThreeColor` / `clamp01` 为 `materialConfig.ts` 模块内现有私有函数，直接复用。

### 记忆化（性能）
- key = `${noun}|${owner}|${specValue}|${purpose}|${theme}|${rev}`；不含 refno/name（除非规则用到 refno/name，命中时退化为不缓存）。
- `rev` 在配置变化时自增使缓存失效。
- 缓存放 `applyMaterialConfigToLoadedDtx` 调用侧的局部 Map，单次全量 apply 内有效即可。

---

## 4. 文件级改动

| 文件 | 改动 | 阶段 |
|---|---|---|
| `src/utils/three/dtx/materialConfig.ts` | 新增 `ColorRule*` 类型、`matchColorRule`、`resolveMaterialWithRules`；`ModelDisplayConfig` 加 `colorRules?`、`colorRulesEnabled?`；`buildExportConfig` 带出 `colorRules`；`mergeConfigs` 合并本地 `colorRules` | v1 |
| `src/composables/useDbnoInstancesDtxLoader.ts` | cache 增 `refnoToPurpose`、`refnoToName`；取数 SQL 增 `purpose,name` 列并回填；`applyMaterialConfigToLoadedDtx` 改为构造 `ColorRuleContext` 调 `resolveMaterialWithRules`；加记忆化 | v1 |
| `public/config/model-display.config.json` | 增 `colorRulesEnabled`、`colorRules`（可空起步） | v1 |
| `public/config/presets/e3d-classic.colorRules.json` | E3D 经典预设（由 research 工件转换） | v1 |
| `src/utils/three/dtx/materialConfig.test.ts` | 增 `matchColorRule`/`resolveMaterialWithRules`/优先级/开关 用例 | v1 |
| `src/components/tools/DtxMaterialConfigPanel.vue` | 新增「颜色规则」tab：列表、增删、启停、拖拽排序、载入预设、实时 apply | phase-2 |
| `DTXOutlineHelper` 接线 | 规则 `edges` → 描边 | phase-2 |

> 取数 SQL 的确切位置与列名在 T2 核实后填入；若底层无 `purpose/name`，对应 `when` 维度在该项目降级为「不可用并 UI 灰显」。

---

## 5. 阶段划分

- **Phase 0｜核实**：底层实例表是否有 `purpose/name`；`spec_value` 真实语义。产出：research 补充 + 决定 B 的可达范围。
- **Phase 1｜引擎（v1，MVP）**：类型 + matchColorRule + resolveMaterialWithRules + loader 接线 + 记忆化 + 配置/导出 + 单测。JSON 驱动即可用。
- **Phase 2｜预设**：E3D 经典 colorRules 落地 + 一键载入。
- **Phase 3｜UI**：规则编辑器（增删/启停/拖拽/预览）。
- **Phase 4（可选）**：edges 描边、动态实时重算、通用谓词表达式。

---

## 6. 测试策略

- **单元（Vitest）**：`matchColorRule` 各维度命中/不命中/通配/首条命中顺序；`resolveMaterialWithRules` 在 `enabled=false`、命中、未命中三态；未指定外观字段回退 base。
- **回归**：构造若干实例，`enabled=false` 时与 `resolveMaterialWithTheme` 输出逐字段相等。
- **集成/手工**：载入 E3D 经典预设，对管道/设备/结构/HVAC 抽样核对颜色 = `_e3d_palette.json` 对应 hex。
- **性能**：对 N≈1e5 对象计时单次 `applyMaterialConfigToLoadedDtx`，对比 baseline。
- 遵循 AGENTS.md：优先 CLI/真实数据验证，非必要不新增大量 spec 文件。
