# Changelog

## Unreleased

### Changed

- **校审嵌入**：`reviewGetEmbedUrl` 请求模型中心时使用 JSON 键 **`workflow_role`**（本单据工作流角色），与 `plant-model-gen` 平台 API 对齐；`buildEmbedUrlPayload` / 仿 PMS 调试链同步使用 `workflow_role`。
- 嵌入 URL 清理逻辑继续剥离历史 query 键 `user_role` / `workflow_role`（与 token-primary 合同一致）。
