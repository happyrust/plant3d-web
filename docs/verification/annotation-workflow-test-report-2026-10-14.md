# 三维校审批注与驳回流程测试报告

**测试日期**: 2026-10-14
**测试人员**: Droid (Factory AI)
**测试环境**: 本地开发环境 (Windows 11, 后端 127.0.0.1:8022, 前端 nginx)
**测试项目**: AvevaMarineSample
**测试 BRAN**: 24381_145018

---

## 1. 测试概述

本次测试验证三维校审流程中的批注功能，包括：

1. **多种批注类型**：针对同一 BRAN 添加不同类型的批注（文字/云线/矩形）
2. **批注状态管理**：批注的创建、查询、处理（已修改/同意）状态流转
3. **批注门禁**：有待处理批注时，流程推进被拦截
4. **完整驳回流程**：JH 添加批注 → 驳回 → SJ 处理 → 重提 → JH 同意 → 继续 → 批准

---

## 2. 测试用例

### TC-1: 3种批注类型（文字/云线/矩形）+ 完整驳回流程

**目标**: 验证针对同一 BRAN 添加多种类型批注，并走完整驳回流程

| 步骤 | 操作 | 预期结果 | 实际结果 |
|------|------|----------|----------|
| 1 | SJ 获取嵌入地址 | 获得 form_id | ✅ PASS |
| 2 | SJ 创建编校审任务 | 任务创建成功，状态 draft/sj | ✅ PASS |
| 3 | SJ 送审到 JH | 状态 submitted/jd | ✅ PASS |
| 4 | JH 创建3种批注（文字/云线/矩形） | 记录创建成功 | ✅ PASS |
| 5 | 查询批注状态 | 3条 open/pending | ✅ PASS |
| 6 | JH 预校验同意 | 被拦截（ANNOTATION_CHECK_FAILED） | ✅ PASS |
| 7 | JH 驳回到 SJ | 状态 draft/sj | ✅ PASS |
| 8 | SJ 处理3条批注（标记 fixed） | 状态变为 fixed/pending | ✅ PASS |
| 9 | SJ 创建新记录（fixed/pending） | 记录创建成功 | ✅ PASS |
| 10 | SJ 重提预校验 | 通过 | ✅ PASS |
| 11 | SJ 重提到 JH | 状态 submitted/jd | ✅ PASS |
| 12 | JH 同意3条批注（标记 agreed） | 状态变为 fixed/agreed | ✅ PASS |
| 13 | JH 预校验同意 | 通过 | ✅ PASS |
| 14 | JH 同意 → SH | 状态 in_review/sh | ✅ PASS |
| 15 | SH 同意 → PZ | 状态 in_review/pz | ✅ PASS |
| 16 | PZ 批准 | 状态 approved | ✅ PASS |
| 17 | 查询历史记录 | 6条流转记录 | ✅ PASS |

**小计**: 25/25 通过 (100%)

**批注详情**:
- 文字批注 (`ann-tc1-text-*`): 尺寸问题 - 法兰尺寸不符合规范
- 云线批注 (`ann-tc1-cloud-*`): 位置偏移 - 管道位置偏移 50mm
- 矩形批注 (`ann-tc1-rect-*`): 碰撞风险 - 与相邻管道存在碰撞风险

**历史流转记录**:
```
sj submit by SJ
jd return by JH
sj submit by SJ
jd approve by JH
sh approve by SH
pz approve by PZ
```

---

### TC-2: 完整驳回流程（2种批注类型）

**目标**: 验证驳回流程的完整链路，包括批注门禁拦截

| 步骤 | 操作 | 预期结果 | 实际结果 |
|------|------|----------|----------|
| 1 | SJ 获取嵌入地址 | 获得 form_id | ✅ PASS |
| 2 | SJ 创建编校审任务 | 任务创建成功 | ✅ PASS |
| 3 | SJ 送审到 JH | 状态 submitted/jd | ✅ PASS |
| 4 | JH 创建2条批注（文字+云线） | 记录创建成功 | ✅ PASS |
| 5 | 查询批注状态 | 2条 open/pending | ✅ PASS |
| 6 | JH 预校验同意 | 被拦截（ANNOTATION_CHECK_FAILED） | ✅ PASS |
| 7 | JH 预校验驳回 | 通过 | ✅ PASS |
| 8 | JH 驳回到 SJ | 状态 draft/sj | ✅ PASS |
| 9 | SJ 查询批注状态 | 2条 open/pending | ✅ PASS |
| 10 | SJ 直接重提 | 被拦截（ANNOTATION_CHECK_FAILED） | ✅ PASS |
| 11 | SJ 处理2条批注（标记 fixed） | 状态变为 fixed/pending | ✅ PASS |
| 12 | SJ 创建新记录（fixed/pending） | 记录创建成功 | ✅ PASS |
| 13 | SJ 重提预校验 | 通过 | ✅ PASS |
| 14 | SJ 重提到 JH | 状态 submitted/jd | ✅ PASS |
| 15 | JH 同意2条批注（标记 agreed） | 状态变为 fixed/agreed | ✅ PASS |
| 16 | JH 预校验同意 | 通过 | ✅ PASS |
| 17 | JH 同意 → SH | 状态 in_review/sh | ✅ PASS |
| 18 | SH 同意 → PZ | 状态 in_review/pz | ✅ PASS |
| 19 | PZ 批准 | 状态 approved | ✅ PASS |
| 20 | 查询历史记录 | 6条流转记录 | ✅ PASS |

**小计**: 23/23 通过 (100%)

**批注详情**:
- 文字批注 (`ann-tc2-text-*`): 问题1-尺寸不符
- 云线批注 (`ann-tc2-cloud-*`): 问题2-位置偏移

**历史流转记录**:
```
sj submit by SJ
jd return by JH
sj submit by SJ
jd approve by JH
sh approve by SH
pz approve by PZ
```

---

## 3. 测试结果汇总

| 测试用例 | 测试项数 | 通过 | 失败 | 通过率 |
|----------|----------|------|------|--------|
| TC-1: 3种批注类型+驳回流程 | 25 | 25 | 0 | 100% |
| TC-2: 2种批注类型+驳回流程 | 23 | 23 | 0 | 100% |
| **总计** | **48** | **48** | **0** | **100%** |

---

## 4. 关键发现

### 4.1 批注类型支持

系统支持以下批注类型（均针对同一 BRAN）:
- **文字批注** (`text`): 文字描述的问题
- **云线批注** (`cloud`): 云线标注的区域问题
- **矩形批注** (`rect`): 矩形框选的问题区域
- **OBB批注** (`obb`): 3D包围盒批注（辅助框选证据，不阻塞流转）

### 4.2 批注状态流转

```
open/pending (待处理)
    ↓ SJ 标记 fixed/wont_fix
fixed/pending (已修改待确认)
    ↓ JH 同意/驳回
fixed/agreed (已同意) / fixed/rejected (已驳回)
```

### 4.3 批注门禁规则

| 操作 | 检查意图 | 规则 |
|------|----------|------|
| SJ active（送审/重提） | ActiveSubmit | 要求 open == 0（所有批注都已被回复） |
| JH/SH/PZ agree（同意推进） | AgreeAdvance | 要求 0 open / 0 rejected / 0 pending |
| JH return（驳回） | ReturnReject | 要求 (open + rejected) >= 1（必须有问题批注） |

### 4.4 驳回流程关键点

1. **JH 驳回需要 next_step**: `action=return` 时必须指定 `next_step`（驳回目标，通常是 SJ）
2. **SJ 处理后需创建新记录**: 由于后端多轮次状态管理，SJ 处理批注后需要创建新记录（fixed/pending）才能让门禁检查通过
3. **JH 同意后流程继续**: JH 同意所有批注后，可以执行 `agree` 推进到 SH

---

## 5. 修复记录（2026-10-14 第二轮）

### 5.1 已修复：后端多轮次批注状态覆盖问题

**问题描述**: `load_annotation_states_by_task` 查询返回所有轮次的批注状态，没有按 `review_round` 过滤。`overlay_independent_states` 遍历时，旧轮次（r1: open）的状态可能覆盖新轮次（r2: fixed）的状态，导致门禁检查误判。

**修复方案**:
- **文件**: `gen-model/src/web_service/review/annotation_state.rs`
- **改动**: 
  1. SQL 添加 `ORDER BY review_round DESC, updated_at DESC`
  2. 添加 `dedup_latest_round` 辅助函数，每个 `annotation_id` 只保留最新轮次
  3. 添加 4 个单元测试验证去重逻辑

**修复前后对比**:

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| SJ 处理批注后重提 | 需创建新记录绕过 | **直接通过** ✅ |
| 门禁检查可靠性 | 可能误判（旧轮次覆盖） | **只使用最新轮次** ✅ |

**验证结果**:
- 单元测试: 4/4 通过
- 集成测试: 48/48 通过 (100%)
- 关键测试 `SJ 重提预校验通过（修复验证：直接通过）` ✅

---

## 6. 测试脚本

测试脚本位置: `scripts/test-annotation-workflow.mjs`

**运行方式**:
```bash
# 运行全部测试
node scripts/test-annotation-workflow.mjs all

# 只运行 TC-1
node scripts/test-annotation-workflow.mjs tc1

# 只运行 TC-2
node scripts/test-annotation-workflow.mjs tc2

# 只测试 API（跳过前端）
node scripts/test-annotation-workflow.mjs all --api-only
```

**环境变量**:
- `BACKEND_BASE`: 后端地址（默认 http://127.0.0.1:8022）
- `FRONTEND_BASE`: 前端地址（默认 http://127.0.0.1）
- `PROJECT`: 项目名（默认 AvevaMarineSample）
- `BRAN`: 测试 BRAN（默认 24381_145018）

---

## 7. 结论

✅ **所有测试通过 (48/48, 100%)**

三维校审的批注功能运行正常：
1. ✅ 支持针对同一 BRAN 添加多种类型批注（文字/云线/矩形）
2. ✅ 批注状态管理正常（open → fixed → agreed）
3. ✅ 批注门禁正常工作（有待处理批注时拦截流程推进）
4. ✅ 完整驳回流程正常（JH批注→驳回→SJ处理→重提→JH同意→继续→批准）
5. ✅ **已修复** 后端多轮次状态覆盖问题，SJ 处理批注后可直接重提

**修复文件清单**:
- `gen-model/src/web_service/review/annotation_state.rs` - 修改 `load_annotation_states_by_task`，添加排序和去重
- `plant3d-web/scripts/test-annotation-workflow.mjs` - 测试脚本（移除绕过逻辑）
- `plant3d-web/docs/verification/annotation-workflow-test-report-2026-10-14.md` - 本报告
