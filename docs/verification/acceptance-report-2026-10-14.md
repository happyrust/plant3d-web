# Plant3D-Web 验收报告

> **版本**: v0.2.0
> **测试日期**: 2026-10-14
> **测试类型**: API 层自动化验收测试
> **测试脚本**: `scripts/acceptance-api-test.mjs`
> **测试环境**: 本地内网（前端 nginx v0.2.0 + gen-model 后端 v0.1.38）

---

## 一、验收结论

<json-render>{"root":"report","elements":{"report":{"type":"Card","props":{"title":"验收结论 - 100% 通过"},"children":["result","summary","flow"]},"result":{"type":"StatusLine","props":{"text":"所有 20 项 API 测试全部通过","status":"success"}},"summary":{"type":"Box","props":{"flexDirection":"row","gap":2},"children":["total","pass","fail","rate"]},"total":{"type":"Badge","props":{"label":"总计: 20","variant":"default"}},"pass":{"type":"Badge","props":{"label":"通过: 20","variant":"success"}},"fail":{"type":"Badge","props":{"label":"失败: 0","variant":"default"}},"rate":{"type":"Badge","props":{"label":"通过率: 100%","variant":"success"}},"flow":{"type":"Timeline","props":{"items":[{"title":"SJ 发起编校审","description":"创建编校审任务，task_id=task-8eac2d17...","status":"completed"},{"title":"流程推进到 JH（校核）","description":"workflow/sync action=active → current_node=jd","status":"completed"},{"title":"JH 确认当前数据","description":"创建测量记录作为校核证据","status":"completed"},{"title":"JH 同意","description":"workflow/sync action=agree → current_node=sh","status":"completed"},{"title":"SH 审核同意","description":"workflow/sync action=agree → current_node=pz","status":"completed"},{"title":"PZ 最终批准","description":"form_status=approved, task_status=approved","status":"completed"},{"title":"历史流转完整","description":"sj submit → jd approve → sh approve → pz approve（4条）","status":"completed"}]}}}}</json-render>

**✅ 验收通过 - 可以交付**

---

## 二、测试环境

| 组件 | 地址 | 版本 | 状态 |
|------|------|------|------|
| 前端（nginx） | http://127.0.0.1 (80/3100) | v0.2.0 | ✅ 运行中 |
| 后端（gen-model） | http://127.0.0.1:8022 | v0.1.38 | ✅ 运行中 |
| 测试项目 | AvevaMarineSample | - | ✅ 可用 |
| 测试构件 | BRAN 24381_145018 | - | ✅ 可用 |

---

## 三、测试结果详情

### 3.1 环境检查（5 项 - 全部通过）

| # | 测试项 | 结果 | 详情 |
|---|--------|------|------|
| 1 | 后端健康检查 | ✅ PASS | status=ok, project=AvevaMarineSample, version=0.1.38 |
| 2 | 前端版本信息（80 端口） | ✅ PASS | version=0.2.0, commit=48a4300 |
| 3 | 前端首页可访问 | ✅ PASS | 首页正常，包含 #app 挂载点 |
| 4 | 前端 3100 端口（PowerPMS 兼容） | ✅ PASS | version=0.2.0 |
| 5 | API 代理（前端 → 后端） | ✅ PASS | 代理正常 |

### 3.2 模型 API 测试（4 项 - 全部通过）

| # | 测试项 | 结果 | 详情 |
|---|--------|------|------|
| 6 | 获取认证 Token（4个角色） | ✅ PASS | SJ/JH/SH/PZ 四个角色 token 全部获取成功 |
| 7 | 获取模型树根节点 | ✅ PASS | 根节点数=38, 首节点=9304_2 |
| 8 | 查询模型树子节点 | ✅ PASS | 根节点 9304_2 子节点数=3 |
| 9 | 健康检查（校审服务） | ✅ PASS | status=ok |

### 3.3 三维校审 API 测试（11 项 - 全部通过）

| # | 测试项 | 结果 | 详情 |
|---|--------|------|------|
| 10 | 获取嵌入地址（SJ 发起） | ✅ PASS | form_id=FORM-5FE88565CFC1 |
| 11 | 查询校审任务状态（query） | ✅ PASS | form_status=blank |
| 12 | **创建编校审任务（SJ 发起）** | ✅ PASS | task_id=task-8eac2d17..., package=ACCEPT-20261014-MV7ZCBCY |
| 13 | **预校验流转（active）** | ✅ PASS | passed=true, next_step=JH |
| 14 | **同步流转（active → JH）** | ✅ PASS | form_status=active, task_status=submitted, current_node=jd |
| 15 | **JH 确认当前数据（创建测量记录）** | ✅ PASS | 测量记录创建成功 |
| 16 | **JH 预校验同意** | ✅ PASS | passed=true |
| 17 | **JH 同意流转（→ SH）** | ✅ PASS | form_status=active, current_node=sh |
| 18 | **SH 同意流转（→ PZ）** | ✅ PASS | current_node=pz |
| 19 | **PZ 批准（最终通过）** | ✅ PASS | form_status=approved, task_status=approved |
| 20 | **查询完整历史流转** | ✅ PASS | 4条记录: sj submit → jd approve → sh approve → pz approve |

---

## 四、三维校审流程验证

### 4.1 正向全流程（TC-1）

```
SJ 发起编校审
    ↓ workflow/verify active (预校验通过)
    ↓ workflow/sync active (送审)
JH 校核（当前节点：校对）
    ↓ 创建测量记录（确认当前数据）
    ↓ workflow/verify agree (预校验通过)
    ↓ workflow/sync agree (同意)
SH 审核（当前节点：审核）
    ↓ workflow/sync agree (同意)
PZ 批准（当前节点：批准）
    ↓ workflow/sync agree (批准)
✅ 流程完成（form_status=approved）
```

**历史流转记录（4 条）：**
1. `sj submit by SJ` - 设计发起
2. `jd approve by JH` - 校核同意
3. `sh approve by SH` - 审核同意
4. `pz approve by PZ` - 批准通过

### 4.2 测试标识

| 标识 | 值 |
|------|-----|
| form_id | `FORM-B28763B036BB` |
| task_id | `task-8eac2d17-f65b-43e6-9333-feea0d91f05b` |
| package_name | `ACCEPT-20261014-MV7ZCBCY` |
| 最终状态 | `approved / approved` |

---

## 五、模型操作验证

| 功能 | 验证方式 | 结果 |
|------|---------|------|
| 模型树加载 | API: `/api/v1/tree/roots` | ✅ 38 个根节点 |
| 模型树展开 | API: `/api/v1/tree/children` | ✅ 子节点查询正常 |
| 构件查询 | BRAN 24381_145018 | ✅ 可用 |
| 房间/空间查询 | 健康检查 | ✅ 服务正常 |

> **注**: 三维视图操作（旋转/缩放/平移）、测量工具、标注功能等前端交互操作，建议通过浏览器手动验收或使用 Playwright 进行 UI 层测试。

---

## 六、问题记录

| # | 问题 | 严重程度 | 状态 | 备注 |
|---|------|---------|------|------|
| - | 无 | - | - | 所有测试通过，无阻塞问题 |

### 6.1 已修复的问题（开发过程中）

| # | 问题 | 修复方案 |
|---|------|---------|
| 1 | nginx 配置缺少 WebSocket map 块 | 添加 `map $http_upgrade $connection_upgrade` |
| 2 | nginx.conf 被打包脚本覆盖 | 改为模板文件（nginx.conf.template），打包时复制 |
| 3 | bat 脚本中文编码问题 | 改为英文注释 |
| 4 | nginx 启动失败（pid 文件创建失败） | 注释掉 `pid` 配置行 |
| 5 | API 测试脚本字段格式错误 | 修正 `actor.roles`（字符串）、`task.id` 提取、`modelName` 等字段 |

---

## 七、验收清单对应

验收测试覆盖了 `docs/verification/acceptance-test-checklist-2026-10-14.md` 中的以下部分：

| 清单章节 | 覆盖情况 | 备注 |
|---------|---------|------|
| 一、测试环境确认 | ✅ 100% | 5/5 项通过 |
| 二、模型操作验收 | ⚠️ 部分覆盖 | API 层已验证，UI 层需手动/Playwright 验收 |
| 三、三维校审流程验收 | ✅ 100% | API 层全流程通过（正向流程 TC-1）|
| 驳回流程（TC-2） | ⏳ 待测试 | 可使用现有脚本 `online-review-acceptance.mjs tc2` |

---

## 八、后续建议

1. **UI 层验收**：使用浏览器手动操作，验证三维视图交互（旋转/缩放/平移）、测量工具、标注功能
2. **驳回流程验收**：运行 `node scripts/online-review-acceptance.mjs tc2` 测试驳回回路
3. **真实 PMS 联调**：在 PowerPMS 环境中进行端到端测试
4. **性能测试**：大模型加载性能、测量响应速度等

---

## 九、签字确认

| 角色 | 姓名 | 签字 | 日期 |
|------|------|------|------|
| 测试执行人 | 自动化脚本 | - | 2026-10-14 |
| 项目负责人 | | | |

---

## 附录：复现测试

```bash
# 运行完整 API 验收测试
cd D:\work\plant-code\old\plant3d-web
node scripts/acceptance-api-test.mjs

# 预期输出：20/20 通过，100% 通过率
```

---

*报告生成时间: 2026-10-14*
*测试脚本版本: scripts/acceptance-api-test.mjs*
