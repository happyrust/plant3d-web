# 仿 PMS 批注链路问题汇总与修复方案

> 记录时间：2026-04-20  
> 适用范围：`pms-review-simulator.html`、`src/debug/pmsReviewSimulator.ts`、`src/components/review/*`、`scripts/pms-plant3d-initiate-flow.ts`  
> 背景：已在本地仿 PMS 页真实跑通一条 **SJ 发起 -> SJ active -> JH 批注确认 -> SH agree -> PZ agree -> readonly reopen** 链路。结合本轮进一步确认：**仿 PMS 与真实 PMS 当前都应按 external 外部驱动模式理解**。

---

## 一、先看结论

本次仿 PMS 联调已经确认：

- **external / passive 主链可以走通**
- `JH` 阶段已经能真实执行：
  - 添加批注
  - `confirmData(...)`
  - `agree`
- 最终可以走到：
  - `readonly reopen`
- **仿 PMS 与真实 PMS 当前都不应把 `manual / internal` 当作默认验收入口**

因此，这次需要优先修的，不再是“强行把仿 PMS 拉到 internal”。  
真正值得优先收的，是下面 4 类问题：

1. **文档与诊断项仍容易让人误以为仿 PMS 应默认支持 `manual / internal`。**
2. **external 成功提示仍在说“未推进内部任务状态”，与当前实际行为不完全一致。**
3. **历史文档引用的临时证据脚本已经不在仓里，复跑入口漂移。**
4. **内部 automation 仍按旧按钮文案“提交”去找 reviewer 主按钮，但这已退化为本地调试债务，而不是 PMS 主链阻塞。**

---

## 二、问题 1：仿 PMS / 真实 PMS 的模式预期仍不够明确

### 现象

本轮一开始，我尝试按 `manual` 主线去跑，包括：

- 在仿 PMS 页 URL 上带 `?workflow_mode=manual`
- 在 automation 中设置：
  - `PMS_CDP_WORKFLOW_MODE=manual`

但实际运行时，`SJ openNew()` 后生成的 iframe URL 里，token claims 仍显示：

- `workflow_mode = external`

随后切到 `JH` 并 `reopenLast()`：

- 初始仍是 `sidePanelMode = readonly`
- 只有在 `SJ` 先执行一次外部 `active` 之后，`JH reopen` 才进入 `sidePanelMode = workflow`

结合用户最新确认，这并不是“仿 PMS 坏了”，而是说明：

> **仿 PMS 与真实 PMS 当前都属于外部驱动模式。**

### 影响

当前真正的问题不在于“internal 没打通”，而在于：

- 旧文档仍把仿 PMS 当作 `manual / internal` 主入口
- 使用者容易误判当前验收基线
- 后续排障时容易把精力花在错误方向上

### 修复建议

#### 修复 1A：把仿 PMS 的模式说明改成“external 为主”

建议统一以下文档口径：

- `docs/verification/三维校审批注与处理留痕操作教程.md`
- `docs/plans/2026-04-02-pms-review-simulator-full-ui-verification.md`
- 其他提到“仿 PMS = internal 验收入口”的说明文档

统一明确：

- 当前仿 PMS 与真实 PMS 默认都按 `external` 理解
- `manual / internal` 仅保留为本地工作台调试能力

#### 修复 1B：仿 PMS 页诊断区继续显式显示 mode 事实

建议在仿 PMS 侧边诊断中继续明确显示：

- 当前 workflow mode
- 本次 iframe token claims 中实际写出的 workflow mode
- 当前 sidePanelMode

目的不是强切 internal，而是避免再次出现“外层以为 manual，里层其实还是 external”的认知漂移。

---

## 三、问题 2：external 成功提示曾不够准确

### 现象

本轮问题整理时，旧成功提示曾类似：

- `workflow/sync active 提交成功（外部流程驱动，未推进内部任务状态）`
- `workflow/sync agree 提交成功（外部流程驱动，未推进内部任务状态）`

但真实跑通结果已经表明：

- `SJ active` 后，`JH` 可以 reopen 进入 `workflow`
- `JH / SH / PZ agree` 后，最终可以进入 `readonly` 终态

所以“未推进内部任务状态”这句在当前体验里已经容易误导使用者。

### 修复建议

建议统一把提示语收成更贴当前行为的口径，例如：

- `workflow/sync active 成功，已等待外部流程刷新当前状态`
- `workflow/sync agree 成功，已等待外部流程刷新当前状态`
- `workflow/sync return 成功，已等待外部流程刷新当前状态`
- `workflow/sync stop 成功，已等待外部流程刷新当前状态`

或在用户可见层统一收成：

- `已确认提交流转，当前状态将由外部流程同步刷新`
- `已确认驳回流转，当前状态将由外部流程同步刷新`

---

## 四、问题 3：历史文档引用的临时脚本已经不在仓里

### 现象

在：

- `D:/work/plant-code/plant3d-web/docs/plans/2026-04-02-pms-review-simulator-full-ui-verification.md`

里仍提到：

- `.tmp_check_pms_simulator_full_evidence.mjs`
- `.tmp_check_external_flow.mjs`

但本轮实查仓内：

- 这两个文件当前都不存在

### 影响

会导致后续同学照文档复跑时出现：

- 文档说有一键复跑入口
- 仓里却没有脚本

这会直接拉低仿 PMS 复验效率。

### 修复建议

#### 修复 3A：把临时脚本收编到 `scripts/` 或 `debug_scripts/`

推荐新增正式脚本，例如：

- `scripts/verify-pms-simulator-external.ts`
- `scripts/verify-pms-simulator-annotation.ts`

把这次已验证通过的 external 主链直接固化进去。

#### 修复 3B：文档只引用正式脚本

后续把文档里的：

- `.tmp_check_pms_simulator_full_evidence.mjs`
- `.tmp_check_external_flow.mjs`

统一替换成正式脚本路径，不再引用 `.tmp_*` 类型瞬时文件。

---

## 五、问题 4：内部 reviewer automation 仍按旧按钮文案查找

### 现象

当前：

- reviewer 主按钮文案已经逐步统一到：
  - `确认流转至校对`
  - `确认流转至审核`
  - `确认流转至批准`
  - `确认最终批准`

但脚本：

- `D:/work/plant-code/plant3d-web/scripts/pms-plant3d-initiate-flow.ts`

里的 `runPlant3dCheckerWorkflowOnRoot()` 仍在使用：

```ts
const submitBtn = root.locator('[data-guide="workflow-actions"] button').filter({ hasText: /提交/ }).first();
```

### 当前判断

这件事仍值得修，但优先级要下调。  
因为在 **仿 PMS / 真实 PMS 主链** 下，我们当前走的是 external 外部驱动，不是 internal reviewer 按钮链。

所以它更像：

- 本地工作台 smoke 的遗留债务
- 不是这次 PMS 主链的第一阻塞点

### 修复建议

当我们后续回头修本地 internal 调试链时，再统一把 locator 改成当前口径：

- `/确认流转至/`
- `/确认最终批准/`

过渡期可兼容旧文案：

```ts
/确认流转至|确认最终批准|提交到/
```

并同步清理旧注释与旧日志。

---

## 六、修复优先级建议

如果只按“最小投入、最大收益”排优先级，我建议这样排：

### P1：先修文档与诊断里的模式预期

原因：

- 当前最大的问题不是功能不通，而是使用者容易误判“仿 PMS 应该走 internal”
- 这会直接影响后续排障方向与验收口径

### P2：再修 external 成功提示语

原因：

- 不影响跑通
- 但会持续误导使用者对实际状态推进的理解

### P3：再把缺失的临时脚本收编

原因：

- 这是复验效率问题
- 不是主链功能阻塞，但对持续联调很关键

### P4：最后修 internal 按钮 automation

原因：

- 仍然有价值
- 但属于本地 internal 调试能力补账，不是 PMS 主链当前阻塞

---

## 七、建议的最小修复包

如果下一轮就开始动修复，我建议最小修复包只碰这几处：

- `D:/work/plant-code/plant3d-web/docs/verification/三维校审批注与处理留痕操作教程.md`
- `D:/work/plant-code/plant3d-web/docs/verification/仿PMS批注链路问题汇总与修复方案.md`
- `D:/work/plant-code/plant3d-web/docs/plans/2026-04-02-pms-review-simulator-full-ui-verification.md`
- `D:/work/plant-code/plant3d-web/src/debug/pmsReviewSimulator.ts`
- `D:/work/plant-code/plant3d-web/scripts/pms-plant3d-initiate-flow.ts`

先不扩散到别的模块。  
先把：

1. external 主链口径
2. external 成功提示语
3. 正式复跑脚本入口

这三件事收住，再继续下一轮。

---

## 八、当前结论

一句话总结这次问题汇总：

> **仿 PMS 结合批注的 external 主链已经能跑通；当前更需要修的是“external 主链的认知与文档漂移”，而不是继续把仿 PMS 往 internal 验收入口上拽。**
