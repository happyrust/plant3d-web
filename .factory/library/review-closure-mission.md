# Review Closure Mission Notes

## Scope

本 mission 聚焦四个闭环能力：

1. 每次流程流转手动指定下一处理人
2. 单任务统一闭环时间线
3. 带流程上下文的批注线程与历史回放
4. refno/refnos 维度的问题台账

任务级统一时间线优先于 refno 视角，但二者必须共享同一套底层事实。

## Cross-Repo Boundaries

- 前端仓库：`D:\work\plant-code\plant3d-web`
- 后端仓库：`D:\work\plant-code\plant-model-gen`
- 前端负责 UI、store、normalization、交互路径和浏览器可见行为
- 后端负责 workflow 契约、聚合查询、seed 场景和持久化模型

如果某项能力需要真实联调，不允许长期只在前端用占位或 mock 掩盖后端缺口。

## Core Truth Rules

- `submit` 必须可以指定下一处理人，并真正影响下一节点任务归属。
- `return` 必须保留清晰的节点语义，不能让状态与节点互相冲突。
- 统一时间线是任务级主视图，必须聚合 workflow、审批意见、确认记录、批注、回复。
- refno 台账是构件级视图，必须和任务级时间线保持一致，不可形成第二套真相。
- 批注线程必须能表达流程上下文，不能只剩 `annotationId` 粘合关系。

## Validation Guidance

- 浏览器用户表面验证使用 `chrome-devtools-mcp`
- 验证地址：`http://127.0.0.1:3101`
- 后端地址：`http://127.0.0.1:3100`
- 优先验证：
  1. 发起 -> submit 指派下一处理人
  2. reviewer -> designer -> reviewer 连续性
  3. 统一时间线节点内容
  4. 历史节点下批注与确认快照回看
  5. refno 台账与任务详情互跳

## Seed Requirement

最终验收依赖 deterministic seed 场景。缺少 seeded tasks、seeded threads 或 refno 聚合样本时，应记为环境 blocker，而不是产品通过。
