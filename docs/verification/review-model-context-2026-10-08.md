# 校审模型版本上下文保存（开发阶段）

确认快照新增独立 `modelContext`：schemaVersion、项目、库、任务/单据、流程节点；有历史对比时保存容器参考号、A/B 会话、各交付单元的两侧会话、分屏/单视口、当前侧及只看差异开关。保存在校审确认记录中，不保存令牌、场景矩阵或几何缓存。

前端 Viewer 提供当前上下文。确认记录提交、按任务查询及 PMS workflow 查询保留该字段；保存回执必须完整匹配，旧后端忽略字段时显示错误，不冒充成功。上下文单独变化也纳入未保存检查和送审前阻挡。切换任务后迟到的记录加载/保存不能导入新任务，原任务的保存须重开核对。

后端四条写入路径（创建、更新尺寸文档、保留尺寸文档、同快照重试）均保存 `model_context`；快照哈希包含该上下文。旧客户端不传时保留原上下文。任务/单据/当前节点不匹配、会话倒置或重复单元被拒绝，避免旧页面写入新节点。workflow 查询返回该字段。校审记录表本身为 SCHEMALESS，无新表或破坏性迁移。

验证：

```text
npm exec vitest run src/composables/useReviewStore.test.ts src/api/reviewApi.test.ts src/components/review/reviewPanelActions.test.ts src/components/review/reviewRecordReplay.test.ts
npm test
npm run build
npm exec eslint -- . --ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts
cargo test --lib web_service::review::records::tests -- --nocapture
cargo test --lib web_service::review::platform::workflow_sync::tests -- --nocapture
```

前端全量 338 文件 / 3124 项通过，构建通过，规范 0 错误 / 16 个截图 harness 警告。修正回放边界类型后既有类型错误从 503 减为 501；相对原 539 基线新增 0，并仅删除已消失的 38 条基线签名，收紧至 501。

记录模块 8 项检查通过，包含实际隔离 `mem://` 数据库写入/读回并序列化的完整版本上下文；验证不同 A/B 会话改变快照哈希、错误节点/任务及重复单元被拒绝。前端 API 与 store 检查使用模拟响应，不能据此声称真实 PMS 或线上云端已验收。

workflow 模块 17 项检查通过，验证记录行转换和查询列保留版本上下文。确认记录端点输出 `modelContext`，workflow 端点沿用既有蛇形字段约定输出 `model_context`；前端均归一为同一类型，并拒绝无效内容。

仍未完成：

1. 重开时按保存项目/库和每个交付单元会话重新加载对应历史几何，并在导入批注前确认版本就绪；缺历史投影时需明确报错，不能回落最新版。
2. 三条净距路径的结果快照完整接入云端确认记录及跨设备恢复；本机保存仍不等于云端。
3. 终态只读回放的提示口径、二次保存并发保护、旧页面跨节点写入与工作流流转同时发生时的原子保护，以及记录删除/清空的节点和终态权限保护。
4. 新后端部署、真实 PMS 四角色流程、真实业务样例、专业 10 mm 对照和最终签字。

A13/A14、D14 继续进行中，19 项最终验收均保持待验收。
