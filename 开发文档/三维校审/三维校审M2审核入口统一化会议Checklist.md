# 三维校审 M2 审核入口统一化会议 Checklist

> 用途：开会快速对齐 + 会后直接派单  
> 主设计源：`ui/三维校审/review-reviewer.pen`  
> 总览基线：`ui/三维校审/review-flow.pen`（仅用于跨角色流程对照）  
> 对应文档：`开发文档/三维校审/三维校审M2审核入口统一化任务单.md`

## 一、会议目标

- [ ] 对齐 M2 只做“审核入口统一化”，不扩到 M3 / M4
- [ ] 明确审核入口唯一主路径：待办列表 -> 工作台 -> 提交/打回
- [ ] 拍板新旧接口边界、待办过滤口径、WS 建链字段
- [ ] 会后可以直接按 owner 派单开工

## 二、会前必读

- [ ] 阅读 `开发文档/三维校审/三维校审M2审核入口统一化任务单.md`
- [ ] 阅读 `开发文档/三维校审/三维校审重构执行方案.md`
- [ ] 阅读 `开发文档/三维校审/三维校审M0页面接口字段映射表.md`
- [ ] 对照 `ui/三维校审/review-reviewer.pen` 确认审核入口列表与流转弹窗主设计
- [ ] 如需核对跨角色流转关系，再参考 `ui/三维校审/review-flow.pen`
- [ ] 前端确认范围页面：`ReviewerTaskList` / `WorkflowSubmitDialog` / `WorkflowReturnDialog`
- [ ] 后端准备任务列表过滤、submit/return、workflow、WS 接口现状

## 三、必须拍板项

- [ ] `reviewerId` 在 M2 是否继续作为兼容读字段参与待办过滤
- [ ] `GET /api/review/tasks` 中 `checker_id`、`approver_id`、`reviewer_id` 的正式语义
- [ ] `/submit` 是否为 M2 唯一正向推进接口
- [ ] `/return` 是否为 M2 唯一逆向退回接口
- [ ] `/start-review` 是否仍要求作为前置动作
- [ ] `targetNode` 在 M2 是否允许退回到任意前置节点
- [ ] 用户专属 WS 应按当前登录用户还是任务 `reviewerId` 建链

## 四、前端 Owner 清单

- [ ] FE1：统一“我的待办”定义与任务池过滤口径
- [ ] FE2：统一筛选项、状态文案、空态与按钮文案
- [ ] FE3：将“开始处理”改成标准入口动作，去掉 `setTimeout` 时序依赖
- [ ] FE4：统一当前任务切换、历史刷新、确认记录刷新、WS 切换
- [ ] FE5：统一 `WorkflowSubmitDialog` / `WorkflowReturnDialog` 入口
- [ ] FE6：统一节点权限判断 helper
- [ ] FE7：统一列表、详情、工作台之间的入口导航与落点

## 五、后端 Owner 清单

- [ ] BE1：冻结审核入口工作流契约
- [ ] BE2：明确旧 `/start-review` `/approve` `/reject` 与新 `/submit` `/return` 边界
- [ ] BE3：补齐最小 WS 事件载荷：`taskId/formId/currentNode/status/operatorId/timestamp`
- [ ] BE4：确认 M2 是否支持多级退回及 `targetNode` 合法值

## 六、联调 / 测试清单

- [ ] INT1：验证 checker / approver 与历史 reviewer 兼容场景下待办不串人
- [ ] INT2：验证“开始处理 -> submit/return -> 列表刷新 -> workflow 刷新”闭环
- [ ] INT3：验证弹窗可选内容与后端规则一致
- [ ] INT4：验证当前任务切换与 WS 订阅不会留在旧任务上
- [ ] INT5：抓包确认 M2 新入口只打 `/submit`、`/return`
- [ ] QA1：验证审核入口最小闭环
- [ ] QA1-视觉基线：审核入口列表、提交弹窗、打回弹窗按 `review-reviewer.pen` 验收
- [ ] QA2：验证待办筛选、状态口径、历史留痕

## 七、风险提醒

- [ ] 风险：`reviewerId` 不拍板，任务过滤和 WS 会继续返工
- [ ] 风险：`/start-review` 是否前置不明确，会破坏入口统一化
- [ ] 风险：多级退回规则不明确，会导致弹窗与后端能力不一致
- [ ] 风险：WS 若继续按 `reviewerId` 建链，当前任务切换会错刷
- [ ] 风险：列表与工作台各自维护权限判断，会造成“可见但不可处理”错态

## 八、会议结论模板

- [ ] M2 范围确认：
- [ ] 待办过滤口径：
- [ ] 新旧接口边界：
- [ ] 多级退回方案：
- [ ] WS 建链字段：
- [ ] 前端 owner / 截止时间：
- [ ] 后端 owner / 截止时间：
- [ ] 联调时间：
- [ ] 验收标准：
