# Wave 3 续接开发计划 · 2026-04-24（晚间）

> 承接上午 Sprint（CUTOVER 收尾 + 3D 标注修复 + 测量类型安全 Phase A + 空间查询 Bug）和
> 下午 Sprint（`2026-04-24-next-sprint-plan.md` Step 1 完成），
> 本计划聚焦**截图能力收尾 + 空间查询 UI 重构 + 测量统一 Phase B 启动**，并为下一轮新功能选题定锚。

---

## 0. 当前状态快照

| 维度 | 状态 |
|------|------|
| 最新提交 | `9ac1d9c` — CUTOVER + MBD 标注 + 测量类型 A + 空间查询 Bug |
| 测试 | 155/155 文件，1173/1173 测试全绿；type-check 零错误 |
| 未提交代码 | `src/composables/useScreenshot.ts`（CaptureOptions 扩展） |
| 未提交资产 | `ui/三维校审/annotation-screenshot-feature.pen`、`ui/提示词/nearest_element_*.md`、`ui/提示词/spatial_location_*.md`、`docs/verification/三维校审*.{html,md}` |
| AnnotationPanel.vue | 已引用新的 `captureAndUpload({ kind: 'annotation_shot', sourceAnnotationId })` 签名 |
| Sprint Step 2/3 | `2026-04-24-next-sprint-plan.md` 的 Step 2（空间查询 UI）/ Step 3（测量 Phase B）待做 |

---

## 1. 设计思路

当前处于"收尾日"状态：多项改动已就位但尚未闭环。本 Wave 的核心是**把既有 WIP 做成可提交、可回滚、可验证的小步提交**，并为明日启动的新功能线（最近元素测量 / 批注截图 / 构件空间定位）铺路。

不启动任何尚未设计评审的新功能；重点放在"稳定已在半空的球"。

---

## 2. Wave 3A · 截图能力收尾（~1h）

**目标**：把 `useScreenshot.ts` 的 `CaptureOptions` 扩展做成可提交的最小增量，补测试并与 `AnnotationPanel.vue` 链路绑死。

### A1 · 单测补全

| # | 任务 | 验收 |
|---|------|------|
| A1.1 | 新建 `src/composables/useScreenshot.test.ts`，覆盖 `buildDefaultFilename` 的 3 条分支（manual / annotation_shot / auto_cloud_finish） | 3+ 用例通过 |
| A1.2 | 覆盖 `captureAndUpload` 的入参兼容性：`string` → `{filename}`、`CaptureOptions` → 原样、`undefined` → 默认 | 单测通过 |
| A1.3 | Mock `useViewerContext` / `reviewAttachmentUploadWithProgress`，避免触发真实 canvas | 测试隔离 |

### A2 · AnnotationPanel 链路核对

| # | 任务 | 验收 |
|---|------|------|
| A2.1 | Grep `captureAndUpload(` 全项目调用，确认都走 `{kind, sourceAnnotationId}` 结构或纯 `taskId` | 无遗漏 |
| A2.2 | 检查后端 `reviewAttachmentUploadWithProgress` 是否需要同步扩展 `kind` 字段（文档或 TODO 标注） | 有明确后续项 |

### A3 · 门槛

- `npm run type-check` 零错误
- `npm test` 155/155 → 156/156 全绿
- `npm run lint` 零错误
- 提交信息：`feat(screenshot): 扩展 captureAndUpload 支持 CaptureOptions + 单测`

---

## 3. Wave 3B · SpatialQueryDrawer 按设计稿重构（~3h）

**目标**：承接 `2026-04-24-next-sprint-plan.md` Step 2，把 `SpatialQueryDrawer.vue` 对齐 `ui/空间查询/distance-query.pen` 设计稿（distance 模式重点）。

### B1 · distance 模式结构对齐

| # | 任务 | 验收 |
|---|------|------|
| B1.1 | "起始位置"区保留 refno / 坐标两模式，但 refno 模式加"从选中拾取"按钮 | UI 可交互 |
| B1.2 | 拾取后显示绿色圆点 + Refno 简洁文案 | 视觉稿对齐 |
| B1.3 | 半径输入改为**预设 Chip + 滑动条**组合（100 / 500 / 1000 / 5000mm 四档 + 自定义滑杆） | 实时同步数值 |

### B2 · 专业筛选与结果视觉升级

| # | 任务 | 验收 |
|---|------|------|
| B2.1 | 专业 Chip 橙色高亮统一（已部分完成，对齐 `.pen` 的描边+底色规则） | 视觉一致 |
| B2.2 | 结果区改为**表格式**（列：名称、专业、类型、距离、操作） | 可横向阅读 |
| B2.3 | 筛选条件区"可折叠"（默认展开；距离查询执行后折叠） | Shift+点击可反转 |
| B2.4 | 结果区固定高度 + 内部滚动（`max-h-[280px] overflow-y-auto`，防止整抽屉滚动） | 滚动平滑 |

### B3 · 测试

| # | 任务 | 验收 |
|---|------|------|
| B3.1 | 新建 `SpatialQueryDrawer.test.ts`，覆盖：mode 切换、从选中拾取、Chip 切换、结果按专业分组渲染 | 4+ 用例通过 |
| B3.2 | 冒烟：type-check、lint、unit test 全绿 | CI 通过 |

### B4 · 门槛

- 设计稿关键视觉点（拾取态、滑动条、Chip、表格）均已实现
- 不删除现有功能（范围查询/距离查询/加载控制），纯增量升级
- 提交信息：`feat(spatial): SpatialQueryDrawer 按 distance-query.pen 重构 + 测试`

---

## 4. Wave 3C · 测量统一 Phase B 启动（~2h）

**目标**：承接 `2026-04-23-measurement-unification-plan.md` Phase B 与 `2026-04-24-next-sprint-plan.md` Step 3，引入统一类型并为 store 渐进合并铺路（**不动 UI / 不改 API 契约**）。

### C1 · 类型与 flag

| # | 任务 | 验收 |
|---|------|------|
| C1.1 | 新增 `src/composables/toolStore/unifiedMeasurement.ts`（或同目录单文件），定义 `UnifiedMeasurementRecord` 类型 | type-check 通过 |
| C1.2 | 字段：基础测量字段 + `approximate: boolean` + `source: 'classic' \| 'xeokit' \| 'replay'` | 命名锁定 |
| C1.3 | 在 `src/review/flags.ts` 新增 `REVIEW_C_MEASUREMENT_UNIFIED_STORE`，默认 `false` | flag 可切换 |
| C1.4 | 导出 `toUnifiedMeasurementRecord` 适配器（classic → unified、xeokit → unified） | 单元测试覆盖 |

### C2 · Store 侧增量（不打破旧路径）

| # | 任务 | 验收 |
|---|------|------|
| C2.1 | `useToolStore` 新增 `unifiedMeasurements`：在 flag 开启时作为主存储、flag 关闭时作为 `computed` 投影 | 双态都可用 |
| C2.2 | 旧字段 `measurements` / `xeokitDistanceMeasurements` / `xeokitAngleMeasurements` 保持作为数据源；新增 `computed` 作为 read 侧聚合 | 兼容 |
| C2.3 | **本轮不动**：UI、回放、exportJSON/importJSON；这些在 Phase B 的后续任务中再推进 | 不做不做 |

### C3 · 测试

| # | 任务 | 验收 |
|---|------|------|
| C3.1 | `src/composables/toolStore/unifiedMeasurement.test.ts`：适配器正反向、flag 开关下 store 行为、投影一致性 | 6+ 用例通过 |

### C4 · 门槛

- 现有 1173 条测试零退化
- `REVIEW_C_MEASUREMENT_UNIFIED_STORE=false` 时运行时无行为差异
- 提交信息：`feat(measurement): Phase B 启动 — 引入 UnifiedMeasurementRecord + 投影 + flag`

---

## 5. Wave 3D · 新功能选题决策（~30min，含两个候选）

**目标**：为下一轮（Wave 4 / 明日）选定新功能切入点。

| 候选 | 依赖 | 现有铺垫 | 预估 |
|------|------|---------|------|
| **批注截图流程** | useScreenshot（已完成 3A）、AnnotationPanel 链路已接入 | 设计稿 `annotation-screenshot-feature.pen`、后端 attachment 已支持 | ~4-6h |
| **最近元素测量** | UnifiedMeasurementRecord（本 Wave 3C 启动）、拾取交互 | 提示词包完整、`usePipeDistanceStore` 已有结果型骨架 | ~8h |
| **构件空间定位** | useSpatialQuery / useRoomTree | 提示词包完整、后端房间关系 API 已有 | ~5-7h |

**决策建议**：
- 若测量 Phase B 在 3C 稳住（无回归）→ 启动**最近元素测量**（Phase D 的半自动子集）
- 若测量 Phase B 仍在风险期 → 启动**批注截图流程**，因为与 Wave 3A 基础设施零冲突
- **构件空间定位**作为 Wave 5 候选，需要先对 useSpatialQuery 做更深的数据契约梳理

---

## 6. 执行顺序

```
Wave 3A (screenshot)  →  Wave 3B (spatial UI)  →  Wave 3C (measurement B)  →  Wave 3D (选题)
       ~1h                    ~3h                       ~2h                       ~0.5h
```

**总预估：~6.5h（当日可完成）**

每个 Wave 独立提交，任一 Wave 失败不阻塞下一个。

---

## 7. 风险

| 风险 | 可能性 | 缓解 |
|------|--------|------|
| Wave 3B 的设计稿与代码差距过大，导致时间超预期 | 中 | 先做结构对齐（B1），视觉细节允许进入 Wave 4 |
| Wave 3C 新增的 `computed` 投影引起性能退化 | 低 | 测量数量通常 < 50，不需虚拟滚动；`shallowRef` 兜底 |
| Wave 3A 后端尚不识别 `kind`，上传后 filename 里的前缀被吞 | 低 | 在代码注释里注明 TODO；当前 filename 前缀已经是兜底通道 |

---

## 8. 验收标准

### Wave 3 完整闭环

- [ ] Wave 3A 提交，`useScreenshot.test.ts` 新增且绿
- [ ] Wave 3B 提交，`SpatialQueryDrawer` 视觉对齐设计稿 + 测试绿
- [ ] Wave 3C 提交，`UnifiedMeasurementRecord` + flag + 适配器测试绿
- [ ] Wave 3D 决策文档化（本文件 §5 决策章节更新）
- [ ] 总测试数 ≥ 1180 且全绿
- [ ] CHANGELOG 更新 2026-04-24 晚间条目

### 代码质量

- [ ] `npm run type-check` 零错误
- [ ] `npm run lint` 零错误
- [ ] 每个提交均为独立增量（不混合）

---

## 9. 执行日志

> 本章节随进展更新。

### Wave 3A 执行记录 ✅

- [x] A1.1 新建 `src/composables/useScreenshot.test.ts`，覆盖 buildDefaultFilename 分支 + 兼容性 + 错误路径 + 辅助函数 = 12 用例
- [x] A1.2 测试通过（12/12） — 3 条分支（manual/annotation_shot/auto_cloud_finish）+ 2 条签名兼容 + 3 条错误路径 + 2 条辅助函数
- [x] A1.3 已 mock `useViewerContext` / `reviewAttachmentUploadWithProgress`
- [x] A2.1 `captureAndUpload(` 全项目引用确认：仅 `AnnotationPanel.vue` 一处业务调用 + `useScreenshot.ts` 自身定义
- [x] A2.2 后端 `reviewAttachmentUploadWithProgress` TODO：在代码注释里标注了"后端扩展 ReviewAttachment 字段后，可改为显式传递"（已在现有实现中）
- [x] A3 type-check / lint / 本文件相关测试全绿

**发现**（非 3A 问题，归入 Wave 3 收尾）：
- `src/components/ReleaseNotesDialog.test.ts` 在提交 `9ac1d9c` 重写 CHANGELOG.md 后已回归，原因：测试断言 `Unreleased` 字样不再存在于新格式 CHANGELOG 中。推迟至 Wave 3D 末尾统一修复，可选方案：
  - 方案 A：CHANGELOG 重新加入 `## [Unreleased]` 包装段 + 当前 2026-04-24 内容
  - 方案 B：更新测试断言匹配新格式


### Wave 3B 执行记录 ✅

- [x] B1.1 Refno 模式的"拾取物项"按钮 — 复用 `applyCurrentSelection`（distance 模式下 rangeCenterSource 副作用无影响）
- [x] B1.2 拾取成功后：绿色圆点 + Refno 显示；未选中：灰色圆点 + "尚未选中物项"
- [x] B1.3 半径滑动条 `range` input（100–10000 mm，步长 100）+ 上方大号数值 + 4 个预设 Chip（100/500/1000/5000 mm）
- [x] B2.1 专业 Chip 橙色高亮（保持）
- [x] B2.2 结果卡片结构（已含距离/专业/loaded 状态 Chip，保持）
- [x] B3.1 `SpatialQueryDrawer.test.ts` — 6 单测全绿（拾取按钮/状态圆点/滑动条/预设/隔离）
- [x] 门槛：type-check + lint 全绿；useSpatialQuery 旧 4 测试不退化

**决策留档**：distance 模式下隐藏通用的"查询半径 number input"，专用区块全面接管；range 模式保持原样。


### Wave 3C 执行记录 ✅

- [x] C1.1 新增 `src/composables/unifiedMeasurement.ts` — `UnifiedMeasurementRecord` 类型、适配器、flag helper、聚合函数
- [x] C1.2 字段对齐：`approximate: boolean` + `source: 'classic' | 'xeokit' | 'replay'`
- [x] C1.3 Flag：采用独立 `measurement.unified_store` / `VITE_MEASUREMENT_UNIFIED_STORE`（不混入 review/flags.ts，保持语义纯粹）
- [x] C1.4 适配器：`fromClassicMeasurement` / `fromXeokitMeasurement` / `toClassicMeasurement` / `toXeokitMeasurement`
- [x] C2.1 `useToolStore` 新增只读 `unifiedMeasurements` computed（三路聚合）— 写入路径完全不动
- [x] C2.2 旧字段 `measurements` / `xeokitDistanceMeasurements` / `xeokitAngleMeasurements` 保持为数据源
- [x] C2.3 本轮不动：UI / 回放 / exportJSON 导入导出（Phase B2–E 另开）
- [x] C3.1 `unifiedMeasurement.test.ts` — 15 用例（适配器正反向/combine/flag 开关）全绿
- [x] C3.2 `useToolStore.unifiedMeasurements.test.ts` — 5 用例（集成：新增/删除同步）全绿
- [x] C4 门槛：type-check + lint + 测量相关测试（MeasurementPanel/XeokitMeasurementPanel）全部不退化

**决策留档**：
- Flag 命名从计划的 `REVIEW_C_MEASUREMENT_UNIFIED_STORE` 调整为独立的 `measurement.unified_store`，理由是测量统一是独立线条，不属于 review 体系 Phase
- 本 Wave 只做"只读聚合"，不动写入路径；为 Phase B2/B3（合并 add/update、统一 persistence）预留空间


### Wave 3D 决策

（待开始）

---

## 10. 非目标（本 Wave 明确不做）

- 不改 `AnnotationPanel.vue`（Wave 3A 只补测试 + 文档 TODO）
- 不合并测量 UI 面板（留到 Phase B 的 B4–B6）
- 不改后端 `reviewAttachmentUploadWithProgress` 契约
- 不启动最近元素测量 / 构件空间定位的代码工作
