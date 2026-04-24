# 测量体系统一与增强开发计划 · 2026-04-23

> 承接批注体系重构（M3 PROMOTE 已闭环）与批注表格 MVP++ 落地后的下一阶段，
> 本计划聚焦**测量功能的架构统一、类型安全强化和缺失能力补全**。

---

## 0. 当前状态摘要

| 维度 | 状态 |
|------|------|
| 测量类型 | 距离 + 角度（无面积） |
| 存储架构 | `measurements`（经典）+ `xeokitDistanceMeasurements` / `xeokitAngleMeasurements`（Xeokit）双轨 |
| 回放策略 | 经典 → Xeokit 归一化，`approximate: false`，避免双重渲染 |
| 管到结构 | 已实现，但走 `dimensions` 路径而非 `measurements` |
| 管到管 | 仅接线，未实现核心算法 |
| 测试覆盖 | 20 测试全绿（5 文件） |
| 类型安全 | `ConfirmedRecordData.measurements` 为 `unknown[]`，`ReviewSnapshotMeasurementPayload` 为宽松 `Record` |
| 独立 API | 无，嵌入在 `review/records` 确认记录中 |

---

## 1. 问题分析

### 1.1 经典/Xeokit 双轨增加维护成本

两套类型定义（`MeasurementRecord` vs `XeokitMeasurementRecord`）除了 `approximate` 字段外几乎相同。
store 中有两组独立的 add/update/remove 方法，UI 面板也有两套（`MeasurementPanel` vs `XeokitMeasurementPanel`）。
回放时需要 `toXeokitMeasurement` 做转换，invalid 条目落入 `fallbackMeasurements` 成为 `unknown[]` 不透明数据。

### 1.2 管到结构走 dimensions 路径

`measure_pipe_to_structure` 的结果是 `LinearDistanceDimensionRecord`（通过 `store.addDimension`），
与用户理解的"测量"产品语义不一致。校审确认快照收集 measurements 但不收集 dimensions，
导致管到结构的结果可能不在确认记录中。

### 1.3 管到管未实现

`measure_pipe_to_pipe` 仅完成模式接线，无核心算法。产品上有明确需求。

### 1.4 确认记录中的测量类型宽松

`ConfirmedRecordData.measurements` 为 `unknown[]`，`ReviewSnapshotMeasurementPayload` 为
`Record<string, unknown> & { id, kind?, visible?, createdAt? }`，缺乏编译期保护。

---

## 2. 目标

1. **统一存储模型**：消除经典/Xeokit 双轨，收口为单一测量类型体系
2. **类型安全强化**：确认记录、快照、回放链路的测量类型从 `unknown[]` 升级为强类型
3. **产品语义对齐**：管到结构结果纳入测量体系（或明确文档化为 dimension）
4. **管到管实现**：完成 `measure_pipe_to_pipe` 核心算法
5. **测试覆盖加固**：为统一后的路径补充回归测试

---

## 3. 非目标（本期明确不做）

- 面积/体积测量（无产品需求）
- 独立测量 REST API（当前嵌入确认记录足够）
- 测量实时协同（依赖 M3 CUTOVER 后的评论同步基础设施）
- 深色模式测量样式

---

## 4. 分阶段实施

### Phase A · 类型安全强化（~3h）

**目标**：不改运行时行为，仅收紧类型定义。

| 任务 | 文件 | 说明 |
|------|------|------|
| A1 | `src/api/reviewApi.ts` | `ConfirmedRecordData.measurements` 从 `unknown[]` 改为 `MeasurementRecord[]` |
| A2 | `src/review/domain/reviewSnapshot.ts` | `SnapshotMeasurement` 强化为基于 `MeasurementRecord` 的明确类型 |
| A3 | `src/components/review/reviewRecordReplay.ts` | `buildReplayMeasurements` 入参从 `unknown[]` 改为 `MeasurementRecord[]`，`fallbackMeasurements` 改为 `MeasurementRecord[]` |
| A4 | 相关测试 | 确认 20 条现有测试不退化 + 补充类型兼容性测试 |

**门槛**：`npm run type-check` 全绿 + 现有 20 条测量测试通过。

### Phase B · 统一测量存储模型（~6h）

**目标**：消除双轨，合并为单一 `UnifiedMeasurementRecord`。

| 任务 | 说明 |
|------|------|
| B1 | 定义 `UnifiedMeasurementRecord`：在现有字段基础上加 `approximate: boolean`（经典默认 `false`）、`source: 'dtx' \| 'xeokit' \| 'replay'` |
| B2 | `useToolStore` 将三个 ref 合并为 `unifiedMeasurements: ref<UnifiedMeasurementRecord[]>`；旧字段改为 computed 投影（兼容期） |
| B3 | `exportJSON` 升级为 v6 payload，`importJSON` 兼容 v1–v6 |
| B4 | `useMeasurementAnnotation.ts` 和 `useXeokitMeasurementTools.ts` 读取统一 ref |
| B5 | UI 面板合并：`MeasurementPanel` 和 `XeokitMeasurementPanel` 合并为统一面板 |
| B6 | `reviewRecordReplay.ts` 中的 `toXeokitMeasurement` 简化为直接读取统一记录 |
| B7 | 保留 feature flag `MEASUREMENT_UNIFIED_STORE`，兼容期可回滚 |

**门槛**：所有测量测试通过 + 确认/回放/嵌入恢复链路功能不退化。

### Phase C · 管到结构产品语义对齐（~2h）

**目标**：明确管到结构测量在确认记录中的归属。

| 任务 | 说明 |
|------|------|
| C1 | 评估将 `pipe_to_structure` 结果从 `dimensions` 转为 `measurements` 的可行性 |
| C2 | 若可行：`runPipeToStructureMeasurement` 改为 `store.addMeasurement` |
| C3 | 若不可行：文档化 dimension 与 measurement 的产品边界，确认快照中补充 `dimensions` 收集 |
| C4 | 补充单测覆盖 |

**门槛**：管到结构结果在确认记录中可追溯。

### Phase D · 管到管实现（~8h）

**目标**：实现 `measure_pipe_to_pipe` 核心算法。

| 任务 | 说明 |
|------|------|
| D1 | 设计管到管算法：基于已有 `runPipeToStructureMeasurement` 的最近点计算基础设施，扩展为管-管双阶段（选管1 → 选管2 → 计算最近距离） |
| D2 | 实现 `runPipeToPipeMeasurement`，复用 `pipeMeasureBusy` / `pipeMeasureStatus` 状态 |
| D3 | 结果存为 `UnifiedMeasurementRecord`（或 dimension，取决于 Phase C 决策） |
| D4 | 更新 UI 状态文案，移除"尚未启用"提示 |
| D5 | 补充单测 + E2E（或降级集成测试） |

**门槛**：两根管道间最近距离可正确测量并显示。

### Phase E · 回放路径简化 + 旧字段清理（~2h）

**目标**：Phase B 稳定后，移除兼容投影。

| 任务 | 说明 |
|------|------|
| E1 | 移除 `measurements` / `xeokitDistanceMeasurements` / `xeokitAngleMeasurements` 旧 ref |
| E2 | 移除 `MEASUREMENT_UNIFIED_STORE` flag |
| E3 | `buildReplayMeasurements` 简化（不再需要经典→Xeokit 转换） |
| E4 | 更新 CHANGELOG |

**门槛**：全量测试通过 + 无运行时回归。

---

## 5. 执行顺序

```
Phase A (类型安全) → Phase B (统一存储) → Phase C (管-结构对齐) → Phase D (管-管实现)
       ↓                    ↓                    ↓                       ↓
     ~3h                  ~6h                  ~2h                     ~8h
                                                                        ↓
                                                              Phase E (清理) ~2h
```

**总预估：~21h（约 3 个工作日）**

Phase A 和 Phase C 可并行。Phase D 依赖 Phase C 决策。Phase E 依赖 Phase B 稳定一个迭代。

---

## 6. 风险与缓解

| 风险 | 可能性 | 缓解 |
|------|--------|------|
| v5→v6 payload 迁移导致旧数据丢失 | 中 | `importJSON` 保留 v1–v5 全兼容读取；v6 为增量扩展 |
| 统一 ref 导致 UI 面板渲染性能下降 | 低 | 测量数量通常 < 50，不需要虚拟滚动 |
| 管到管算法精度问题（曲面管道） | 中 | 先实现圆柱近似，后续迭代支持弯管 |
| Phase B 影响确认/回放链路 | 高 | feature flag 保护 + 保留旧字段 computed 投影 |

---

## 7. 验收标准

### 功能验收

- [ ] 距离测量创建/显示/删除正常
- [ ] 角度测量创建/显示/删除正常
- [ ] 管到结构测量结果在确认记录中可查
- [ ] 管到管测量可正确测量并显示
- [ ] 确认记录恢复后测量数据完整
- [ ] 嵌入恢复后测量数据完整
- [ ] v5 旧数据可正常导入

### 代码验收

- [ ] 测量类型定义统一，无 `unknown[]`
- [ ] 双轨存储消除，单一 `unifiedMeasurements` ref
- [ ] `npm run type-check` 零错误
- [ ] 测量相关测试覆盖 ≥ 30 条（当前 20 条 + Phase A/B/C/D 新增）

---

## 8. 建议的立即动作

**Phase A 可立即开始**（零运行时风险，纯类型收紧）。
