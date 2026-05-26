# Plan: 校审批注截图关联

## Solution Overview

为三维校审的每条批注增加“截取当前三维视图并保存为批注截图”的能力。用户在批注卡片或批注详情中点击截图入口后，系统先截取当前 viewer canvas 并展示预览；用户确认保存后再上传图片附件，并把返回的附件信息写入该批注 record 的 `screenshot` 字段。随后截图会跟随确认记录、workflow sync 恢复和批注详情展示，成为批注证据的一部分。

## Why This Approach

仓库已经把 `screenshot` 建模在四类批注 record 上，并且 snapshot adapter 已有“保留 screenshot payload”的测试。这说明最小风险路径不是新建一套截图业务对象，而是补齐现有模型的 UI、上传元数据和持久化边界。普通评论适合表达意见，截图是批注本身的视觉证据；把截图放在批注 record 上，能自然参与“确认当前数据”和历史回放。

## How It Will Work

实现分成四条线。

第零条是视觉对齐。执行者应先查看目标包里的两张 GPT Image 2 效果图，理解“批注卡片上的相机入口 + 保存确认弹窗”和“讨论时间线顶部的已关联截图卡片”两种关键状态。效果图是方向，不是逐像素规范；最终代码必须贴合现有 Vue/Tailwind review 面板。

第一条是截图 composable。`useScreenshot` 需要导出稳定的 `CaptureOptions`，支持 `kind`、`sourceAnnotationId`、`sourceAnnotationType`、`formId`、`description` 等业务元数据，并统一转换为 `reviewAttachmentUploadWithProgress` 的上传选项。默认文件名根据截图类型生成，例如 `annotation-<annotationId>-<timestamp>.png`。

第二条是前端交互。`AnnotationPanel` 和 `AnnotationWorkspace` 增加统一的 `captureAnnotationShot(type, id)` 流程。流程先从当前 viewer 取 blob/data URL，打开预览确认；用户确认后上传，上传成功后调用 `toolStore.setAnnotationScreenshot(type, id, screenshot)`。已有截图时走替换确认，替换成功后异步删除旧附件。

第三条是展示和恢复。`ReviewCommentsTimeline` 继续作为截图展示面，调用方必须传入当前批注的 screenshot。`AnnotationWorkspace` 的 `AnnotationListItem` 需要携带 `screenshot`，四类批注构造都要补齐。确认记录 payload 不应剔除 `screenshot`，workflow sync 和 replay 应继续保留。

第四条是持久化契约。草稿批注的截图可以随“确认当前数据”进入 `review_records`。对已确认/已流转批注，如果截图保存需要立即跨刷新生效，应补充后端 patch 契约；若当前后端已支持附件元数据和 annotation patch，则接入现有接口，否则必须在 blocker 中暂停。

## Slices

| Slice | Purpose | Main files or systems | Done when | Risks |
| --- | --- | --- | --- | --- |
| 0 | 视觉效果图对齐 | `goals/review-annotation-screenshots/assets/*.png` | 执行者确认截图入口、预览确认、时间线展示的目标形态 | 过度照搬效果图会偏离现有组件约束 |
| 1 | 收敛截图上传 API 与类型 | `src/composables/useScreenshot.ts`, `src/api/reviewApi.ts`, `src/composables/useScreenshot.test.ts` | `CaptureOptions` 存在，元数据正确透传，现有测试期望与实现一致 | 后端字段名不匹配会导致附件无法按批注追溯 |
| 2 | 抽统一批注截图流程 | `src/components/tools/AnnotationPanel.vue`, `src/composables/useToolStore.ts` | text/cloud/rect/obb 都能点击截图、预览、确认保存、替换旧图 | 旧云线截图逻辑可能被回归 |
| 3 | 补齐工作台详情展示 | `src/components/review/AnnotationWorkspace.vue`, `src/components/review/ReviewCommentsTimeline.vue` | 选中任意批注时能看到已保存截图并打开大图 | `AnnotationListItem` 漏字段会造成 UI 看不到已有关联 |
| 4 | 确认持久化与恢复 | `src/components/review/reviewPanelActions.ts`, `src/review/adapters/*`, 后端相关接口 | 刷新、workflow sync、确认记录回放后截图仍在对应批注上 | 已确认批注若不能 patch 后端，会产生“上传成功但关联丢失” |
| 5 | 回归测试与手工验证 | Vitest、review 面板回归、浏览器手工流 | 自动化覆盖关键逻辑，手工完成一次截图保存和恢复验证 | 3D canvas 在测试环境中需要 mock |

## Sequencing

- 先看 Slice 0 的效果图，确认 UI 方向和产品语言。
- 再做 Slice 1，因为后续 UI 都依赖稳定的截图上传入参和返回值。
- 再做 Slice 2，让所有批注类型拥有同一条截图保存流程，避免只修某一种类型。
- 接着做 Slice 3，把截图在批注详情和讨论时间线里显示出来。
- Slice 4 必须在声明完成前解决；如果需要后端支持，暂停等待用户确认。
- Slice 5 穿插进行：每完成一个 slice 补对应测试，最后跑完整回归。

## Phase Boundaries

- 本目标到“一条批注一张代表截图，可替换，可恢复”结束。
- 如果用户想要多图相册、截图标绘、图片压缩服务、附件审计后台或历史数据迁移，应另开新目标。
- 如果后端契约缺失较多，本目标可以先交付前端计划和接口草案，后端落地作为后续目标。

## Steering Notes

- 推荐默认把截图入口放在批注卡片/详情的证据区域，文案使用“添加截图 · 记录当前视角”；已有截图时显示缩略图和“重拍”。
- 推荐保存前必须出现预览确认，而不是点击后直接上传；这符合用户“确定是否保存”的要求。
- 推荐截图只作为批注证据，不作为评论附件，以免混淆“问题本体”和“讨论意见”。
- 视觉上应沿用当前 review 面板样式，不引入新的设计体系或大范围 UI 改版。
- GPT Image 2 效果图给的是交互目标：一张强调保存确认弹窗，一张强调详情时间线里的已关联截图卡片；实现时优先复用现有按钮、卡片和弹层样式。

## Acceptance Criteria

- [ ] text/cloud/rect/obb 四类批注均展示截图入口；点击后截取当前三维视图并展示预览确认。
- [ ] 实现前已查看并引用目标包中的 GPT Image 2 效果图，最终 UI 与效果图的关键交互状态一致。
- [ ] 用户取消保存时不触发附件上传，不修改批注 `screenshot` 字段。
- [ ] 用户确认保存后上传图片，并将 `url`、`attachmentId`、`name`、`capturedAt` 关联到正确的批注 record。
- [ ] 已有截图的批注可重新截图替换；替换成功后旧附件被删除或记录 warning。
- [ ] 批注详情/讨论时间线可展示缩略图，并可点击查看大图。
- [ ] 刷新页面或通过 workflow sync/confirmed records 恢复后，截图仍挂在原批注上。
- [ ] `useScreenshot` 的元数据透传测试通过，且不存在测试引用未导出的 `CaptureOptions`。
- [ ] review 面板指定回归测试不新增失败。

## Required Evidence

| Requirement | Evidence to inspect | Where evidence is recorded |
| --- | --- | --- |
| 视觉效果图对齐 | 两张 GPT Image 2 效果图路径，以及实现后的截图对比说明 | `progress.jsonl` |
| 四类批注截图入口 | UI 测试或组件测试断言 text/cloud/rect/obb 都可触发截图流程 | `progress.jsonl` 记录测试命令和结果 |
| 取消不上传 | `useScreenshot`/组件测试中 upload mock 未被调用 | `progress.jsonl` |
| 确认后关联 | 测试断言 `setAnnotationScreenshot(type, id, ...)` 收到正确类型和 id | `progress.jsonl` |
| 元数据透传 | `reviewAttachmentUploadWithProgress` mock 收到 sourceAnnotationId/sourceAnnotationType/fileType/formId | `progress.jsonl` |
| 持久恢复 | adapter/replay 测试保留 screenshot，或手工刷新截图仍存在 | `progress.jsonl` 和截图/录屏路径 |
| 回归守护 | 指定 Vitest review 面板测试 pass/fail baseline vs after | `progress.jsonl` |

## Completion Audit

Before marking the goal complete, Codex must map every explicit requirement, file, command, check, and deliverable to real evidence. If any item is missing, incomplete, weakly verified, or uncertain, the goal is not complete.
