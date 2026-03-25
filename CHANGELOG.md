# Changelog

## Unreleased

### Added

- 审核工作台（Review Panel）全面模块化重构升级，引入灵活的微件系统，支持自由加载/卸载审核子模块（任务监控、处理、发起、设计记录等）并在本地持久化视图偏好
- 测量与批注（Measurement & Annotation）面板的菜单独立组件抽离（`MeasurementOverlayBar`、`AnnotationOverlayBar`），改善核心 UI 组件代码结构与交互一致性
- E2E 测试环境深度集成视觉截图对比回归能力（Visual Comparisons），增加三维模型批注、标注工具及不同框选交互的快照测试以验证渲染变更
- 补充 M4 和 M5 阶段多模块架构设计相关的规范文档、路线图与执行方案
- ReviewerTaskList 加入筛选条件状态持久化与滚动位置恢复机制
- M5 阶段设计追踪 `.factory/` 质量控制配置调整与扩充

### Changed

- 默认开启 xeokit 边线显示（`scene.edgeMaterial.edges = true`），并设置边线颜色/透明度/宽度为更适合 CAD/BIM 观感的默认值。
- 新增/优化 embed 模式启动链路：按 `form_id + 角色` 恢复工作台落点（设计侧保留发起提资，校核/审核/批准侧进入审核面板），并支持 `form_id` 无任务匹配时展示明确空态。
- 拆分并接入 embed 恢复 helper（`embedContextRestore`），统一处理 reviewer/myTasks 任务恢复与落点激活策略，避免项目切换时误入 viewer/modelTree。

### Fixed

- 优化三维视口中标注字体失真与锯齿问题，对 `SolveSpaceBillboardVectorText` 底层渲染由基本轴线切换至高质量抗锯齿粗线材质 `LineMaterial`，有效提升 3D 文字批注的渲染清晰度
- 修复某些树节点在解析不到独立包围盒实体时导致的 `flyTo` 失效，引入按关联几何对象 `refnos` 包围盒组合计算的后备兜底寻址方案
- 修正项目中 URL 强制重定向拦截 `show_dbnum` 参数缺陷，调整逻辑以优先保留手动或 E2E 赋予在 URL 中用于数据库定位的强制编码，不再隐式被环境配置顶替
- 修复测量模式下零分量轴标签冗余和坐标重叠问题，支持缩放避让
- 在存在 `globalModelMatrix` 时转换 local 坐标进行测距运算并补充单测
- 解决模型显示“发白/像曝光过度”的观感问题：
  - Viewer 画布改为非透明渲染，避免与页面背景叠加导致整体发灰。
  - 背景清屏色从纯白调整为浅灰，提升对比度与层次感。
  - 预打包实例颜色 `colors` 支持自动归一化：当检测到 RGBA 分量大于 1 时，按 255 缩放到 0..1，避免颜色被 clamp 到 1 导致材质偏白。
- 修复若干现有测距与 Vue 组件遗留验证错误
- 优化 `useUserStore` 的 embed 用户身份收口逻辑：若后端 canonical user 已就绪，不再直接覆盖为 URL 中 `user_id`，降低 reviewer 任务查询因身份错配导致的 `form_id` 恢复失败。
- Reviewer 与设计侧 embed 空态展示增强：`ReviewPanel` 与 `InitiateReviewPanel` 增加 form lineage、当前任务摘要与未绑定任务提示，提升打开单据时的可识别性。
- 修正 embed 初始化时任务恢复顺序，先完成用户与任务加载再做 restore，确保 `form_id` 命中后的 `currentTask` 恢复稳定。
