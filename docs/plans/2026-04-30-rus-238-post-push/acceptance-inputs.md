# RUS-238 验收输入清单

> 状态：等待填写。填写完成后按 `task_plan.md` Phase 1 -> Phase 4 执行。

## 必填输入

| 输入 | 当前值 | 说明 |
| --- | --- | --- |
| 目标 BRAN | `24381_145018` | 用于加载真实模型并验证路径 lookup 是否能 resolved |
| PMS 包名 / 任务单 | `SIM-APPROVED-1777533677538` / `FORM-1B27FE318DE6` | approved 仿 PMS 主链通过记录 |
| 验收角色 | `SJ -> JH -> SH -> PZ` | approved 场景覆盖发起、校核、审核、批准 |
| 验收入口 | 仿 PMS | 使用 `npm run test:pms:simulator` |
| 测量样例 | restore 场景生成 1 条确认测量 | `restore-before-confirmed-measurement` 通过 |

## 建议验收组合

| 场景 | 角色 | 入口 | 预期 |
| --- | --- | --- | --- |
| 本地测量列表 | 任意可操作用户 | 本地三维 | 完整路径 resolved 或 refno fallback |
| 批注测量证据 | SJ 或设计侧用户 | 本地 / 仿 PMS | 关联测量证据展示与测量列表一致 |
| 确认测量回放 | JH 或校核侧用户 | 任务详情 / 编校审入口 | 历史快照 fallback 正常 |
| PMS 复核 | JH | 真实 PMS / 仿 PMS | 不暴露 `o:...:0`，能复核 BRAN 与包名 |

## 已执行仿 PMS 验收

| 场景 | 命令 | 结果 | 报告 |
| --- | --- | --- | --- |
| 主链批准 | `PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=approved PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-238-post-push-approved-rerun-report.json npm run test:pms:simulator` | 通过，最终 `status=approved` / `node=pz` | `artifacts/rus-238-post-push-approved-rerun-report.json` |
| 刷新恢复 | `PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-238-post-push-restore-rerun-report.json npm run test:pms:simulator` | 通过，最终 `status=submitted` / `node=jd`，BRAN/测量/确认记录/评论正文 UI 均通过 | `artifacts/rus-238-post-push-restore-rerun-report.json` |
| Chrome CDP full | `PMS_E2E_PASSWORD='Admin@1234' PMS_EMBEDDED_SITE_SUBSTRING='123.57.182.243' PMS_TARGET_BRAN_REFNO='24381_145018' PMS_CDP_HEADLESS=1 PMS_CDP_FULL_FLOW=1 npm run test:pms:cdp:full` | 通过，退出码 0，嵌入站点接口命中包名或 BRAN | `artifacts/.tmp/rus-238-chrome-cdp-full-20260430-153301.log` |

## 验收记录模板

```text
BRAN:
包名 / 任务单:
角色:
入口:
测量类型:
测量列表展示:
批注证据展示:
确认回放展示:
是否 fallback:
截图 / 录屏:
结论:
```

## 执行判定

- 如果以上必填输入缺任意一项，只能执行文档准备，不能声称真实流程验收完成。
- 输入齐全后，先做本地真实模型验收，再进入 PMS/编校审入口验收。
