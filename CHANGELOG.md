# Changelog

## Unreleased

### Changed

- **校审嵌入**：嵌入链路里的角色统一定义为按 `form_id` 动态指派的工作流角色；前端内部状态统一改名为 `workflowRole`，`reviewGetEmbedUrl` / `buildEmbedUrlPayload` 对外以 **`workflow_role`** 为正式字段，同时兼容旧 `role`。
- 嵌入 URL 清理逻辑继续剥离历史 query 键 `role` / `user_role` / `workflow_role`（与 token-primary 合同一致）。
