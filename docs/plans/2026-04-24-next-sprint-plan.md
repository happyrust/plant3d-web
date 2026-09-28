# 下一阶段 Sprint 计划 · 2026-04-24（下午）

> 承接上午 Sprint（CUTOVER 收尾 + 测试全绿 + 测量类型安全 Phase A + 空间查询 UI 设计），
> 本计划聚焦**空间查询 Bug 修复 + 空间查询 UI 实现 + 测量统一 Phase B 启动**。

---

## 0. 上午 Sprint 成果

| 维度 | 状态 |
|------|------|
| CUTOVER 验证与清理 | ✅ 零残留，436 测试全绿 |
| 10 个 3D 标注测试修复 | ✅ 含 semantic lane 实现修复 |
| 测量类型安全 Phase A | ✅ 5 文件从 unknown[] 收紧 |
| 空间查询 UI 设计 | ✅ distance-query.pen 完成 |
| GitHub Issue #22 | ✅ 已创建 |
| 测试状态 | ✅ 155/155 全绿，1173/1173 |

---

## 1. Step 1 · 空间查询 spec_values Bug 修复（~15min）

**目标**：修复 Refno 回退路径未传 spec_values 的问题。

| # | 任务 | 验收 |
|---|------|------|
| 1.1 | `useSpatialQuery.ts` L811-820：在 queryByIndex 调用中添加 spec_values 参数 | 编译通过 |
| 1.2 | 运行 spatial query 测试 | 全绿 |

---

## 2. Step 2 · 空间查询 UI 实现（~3h）

**目标**：按 distance-query.pen 设计稿实现 SpatialQueryDrawer 界面重构。

| # | 任务 | 验收 |
|---|------|------|
| 2.1 | 拾取物项按钮 + 状态显示（绿点 + Refno） | UI 可交互 |
| 2.2 | 距离滑动条组件（100-10000mm） | 实时更新数值 |
| 2.3 | 专业 Chip 按钮（管道/电气/仪表/暖通） | 多选 + 橙色高亮 |
| 2.4 | 搜索输入框 | 实时过滤 |
| 2.5 | 表格式结果展示 | 列：名称、专业、类型、距离 |
| 2.6 | 筛选条件可折叠 | 展开/收起 |
| 2.7 | 结果区域可折叠 + 固定高度滚动 | 滚动流畅 |

---

## 3. Step 3 · 测量统一 Phase B 启动（~2h，Phase B 的 B1-B2）

**目标**：定义 UnifiedMeasurementRecord 并开始 store 合并。

| # | 任务 | 验收 |
|---|------|------|
| 3.1 | 定义 `UnifiedMeasurementRecord` 类型 | type-check 通过 |
| 3.2 | `useToolStore` 添加 `unifiedMeasurements` ref | 编译通过 |
| 3.3 | 旧字段改为 computed 投影（兼容期） | 现有测试不退化 |
| 3.4 | 添加 feature flag `MEASUREMENT_UNIFIED_STORE` | 可回滚 |

---

## 4. 执行顺序

```
Step 1 (Bug fix)  →  Step 2 (UI 实现)  →  Step 3 (统一存储)
     ~15min              ~3h                  ~2h
```

**总预估：~5h**

**推荐立即执行 Step 1**（最小改动，最高 ROI）。

---

## 5. 执行日志

### Step 1 执行记录 ✅
- [x] 1.1 spec_values 参数添加 — `useSpatialQuery.ts` L812 queryByIndex 调用添加 spec_values
- [x] 1.2 测试验证 — type-check 零错误，2 文件 7 测试全绿
