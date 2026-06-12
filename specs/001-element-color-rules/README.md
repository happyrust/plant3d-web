# 001 · 构件颜色规则（Element Color Rules / AutoColour）

对齐 AVEVA E3D AutoColour 的「有序、带条件」构件着色规则系统。

## 目录

| 文件 | 内容 |
|---|---|
| `spec.md` | 需求规格：用户故事、验收标准、范围、风险 |
| `plan.md` | 实施方案：架构、数据模型、算法、文件级改动、阶段 |
| `tasks.md` | 任务清单：按依赖排序、可验收 |
| `research.md` | 依据：E3D 逆向分析（优先级/规则模型/调色板）+ 现状锚点 + 待核实项 |
| `contracts/color-rule.schema.json` | `colorRules` 的 JSON Schema |
| `assets/e3d-palette.json` | E3D 命名调色板 name→RGB（IDA 提取，61 色） |
| `assets/e3d-classic.colorRules.json` | E3D 经典配色预设（参考工件） |

## 一句话设计

着色入口 `applyMaterialConfigToLoadedDtx` 里，对每个构件先跑有序规则 `matchColorRule(ctx)`（first-match），命中即用规则外观，否则回退现有 `resolveMaterialWithTheme`；全局 `colorRulesEnabled` 对齐 `AUTOCOLOUR ON/OFF`，选中高亮始终优先。

## 决策记录（grill-me）

1. 匹配能力 = B：现有字段(noun/owner/spec/refno) + 新增 `purpose`/`name`。
2. 优先级：选中高亮 > colorRules > instance > theme > noun > disciplineOverride > default。
3. 求值：有序首条命中；v1 含 color/opacity/metalness/roughness/hidden；edges→phase2。
4. 载体：项目级 `model-display.config.json` + 用户级 localStorage 叠加 + 导出。
5. UI：v1 纯 JSON；规则编辑器 phase2。
6. 重算：复用 apply + (noun|owner|spec|purpose) 记忆化；动态监听 phase2。
7. 内置「E3D 经典」预设。
8. 本 spec kit 落 `specs/001-element-color-rules/`。

## 下一步

先做 Phase 0（T1/T2 核实数据列与 spec_value 语义），再做 Phase 1 引擎（T3–T11）。
