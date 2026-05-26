# Blockers: 校审批注截图关联

## Open Questions

- 后端 `/api/review/attachments` 是否已经保存并返回 `sourceAnnotationId/sourceAnnotationType/formId/taskId/fileType/description`？如果没有，需要决定是扩展附件表还是仅在前端 record 中保存关联。
- 对已确认/已流转的历史批注，截图保存后是否要求立即持久化，还是允许等下一次“确认当前数据”写入 `review_records`？
- OBB 批注在 reviewer 路径当前被弱化/隐藏时，是否仍要求在主 UI 中暴露截图入口，还是只保证数据模型和可访问入口支持？
- 截图保存失败时的产品口径：是否允许保留本地预览草稿，还是必须完全回滚？

## Stop And Ask

- 需要新增、删除或迁移后端数据库字段、附件表、review_records 历史数据时，暂停并让用户确认。
- 发现截图只能上传成功但无法持久关联到已确认批注时，暂停并提出后端契约方案。
- 需要改变校审流转门禁、确认记录结构主键、评论 thread store 语义时，暂停确认。
- 任何测试显示现有批注、测量、评论、流转行为被破坏时，暂停定位根因，不继续堆叠改动。
- 需要使用真实 PMS 账号、真实生产数据、真实外部环境或敏感凭证时，暂停让用户处理环境。

## Dangerous Or High-Risk Actions

- 删除历史附件或批量清理文件存储。
- 修改后端 schema、SurrealDB 表结构、附件持久化结构或历史 review_records。
- 改动鉴权、token、PMS embed/postMessage 权限边界。
- 大范围重构 review snapshot、comment thread store、workflow sync 或确认记录格式。
- 引入新的图片处理依赖、上传服务或压缩管线。

## Known Blockers

- 当前已知 `useScreenshot.ts` 与 `useScreenshot.test.ts` 对 `CaptureOptions` 的期望不一致；执行前应先修正类型和元数据透传。
- 当前已知 `AnnotationWorkspace` 的 `AnnotationListItem` 未携带 `screenshot`；展示链路需要补字段。
- 当前已知只有云线批注有截图按钮；四类批注入口需要统一。
- 当前尚未确认后端是否能持久保存“已确认批注 -> 截图附件”的直接 patch；这是完成持久关联前的关键检查点。
