# RUS-238 推送后开发方案 Findings

## 已确认事实

- [实现] 提交 `0819772` 已推送到 `origin/main`，包含测量完整路径展示增强。
- [实现] `useMeasurementPathSummaries` 是 UI 展示层统一入口，负责初始 fallback、异步 lookup 和 resolved 后替换。
- [实现] `measurementPathLookup` 是只读查询层，不修改 `MeasurementRecord` 或确认记录。
- [实现] `AnnotationWorkspace` 只在展示层消费完整路径，定位链路仍使用原有 `LinkedMeasurementItem.engine/id`。
- [验证] 定向 ESLint、`npm run type-check`、`git diff --cached --check` 在提交前通过。
- [文档] `CHANGELOG.md` 与 `docs/CHANGELOG.zh-CN.md` 已记录 RUS-238 变更。

## 当前阻塞

- [阻塞] 缺少目标 BRAN，无法验证真实模型树路径是否能 resolved。
- [阻塞] 缺少 PMS 包名或任务单，无法复核真实 PMS/编校审入口。
- [阻塞] 缺少验收角色，无法覆盖 SJ/JH 等真实角色视角。
- [阻塞] 缺少验收入口选择，无法确定使用本地、仿 PMS 还是真实 PMS。

## 风险

- [风险] 完整路径可能过长，测量列表和批注证据中需要依赖截断和 `title`。
- [风险] 多测量点可能触发多次 `e3dGetNode()`，当前依赖缓存兜底；真实数据若慢，需要补并发限制或批量查询。
- [风险] 历史确认记录可能缺少模型树上下文，应继续依赖 refno fallback。
- [风险] 当前工作区有大量无关脏变更，后续 RUS-238 补丁必须继续显式暂存。
- [风险] 当前脏工作区规模为 `M=95 / D=31 / ??=76`，必须按主题拆分处理。

## 决策

- [决策] 真实验收前不继续扩大代码范围。
- [决策] 若要做展示微调，优先改 UI 表达，不改测量持久化结构。
- [决策] 若 PMS/编校审无法 resolved，但 fallback 满足业务文案，可作为已知限制交付。
- [决策] 工作区收敛先做只读盘点，不删除、不回滚、不批量暂存。
