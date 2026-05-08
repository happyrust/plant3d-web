# RUS-238 推送后开发方案 Findings

## 已确认事实

- [实现] 提交 `0819772` 已推送到 `origin/main`，包含测量完整路径展示增强。
- [实现] `useMeasurementPathSummaries` 是 UI 展示层统一入口，负责初始 fallback、异步 lookup 和 resolved 后替换。
- [实现] `measurementPathLookup` 是只读查询层，不修改 `MeasurementRecord` 或确认记录。
- [实现] `AnnotationWorkspace` 只在展示层消费完整路径，定位链路仍使用原有 `LinkedMeasurementItem.engine/id`。
- [验证] 定向 ESLint、`npm run type-check`、`git diff --cached --check` 在提交前通过。
- [文档] `CHANGELOG.md` 与 `docs/CHANGELOG.zh-CN.md` 已记录 RUS-238 变更。
- [仿 PMS] `PMS_SIMULATOR_CASE=approved` 使用 BRAN `24381_145018` 通过，最终 `status=approved` / `node=pz`。
- [仿 PMS] approved 复跑使用 BRAN `24381_145018` 通过，form `FORM-F098FFEEEB31` / task `task-6293a343-62c9-497f-acc6-e356cedd02c7`，最终 `status=approved` / `node=pz`。
- [仿 PMS] `PMS_SIMULATOR_CASE=restore` 使用 BRAN `24381_145018` 时，BRAN/测量/确认记录相关断言通过，整体失败在刷新前评论内容 UI 断言。
- [仿 PMS] restore 复核去掉额外独立 reviewer `3d-view` 后，`POST /api/review/records` 恢复为 HTTP 200；测量和确认记录断言继续通过，唯一失败仍为 `restore-ui-comment-content`。
- [仿 PMS] restore 增加 automation 评论线程显式刷新后通过，最终 `status=submitted` / `node=jd`，`restore-ui-comment-content` detail 为 `title_found=true comment_found=true bran_found=true`。
- [Obscura] `obscura` v0.1.1 已安装到 `.tmp/obscura-bin/obscura`，release sha256 校验通过。
- [Obscura] `fetch` 不允许访问 `127.0.0.1`，公网仿 PMS 页面可拿到 title 但 Vue `#app` 未挂载。
- [Obscura] 使用本机 LAN IP `192.168.31.22` 访问本地仿 PMS 仍被私网地址策略拦截；普通 `curl` 验证该入口 HTTP 200。
- [Chrome CDP] full flow 使用 BRAN `24381_145018` 通过，真实 PMS 入口创建 form `FORM-8E21B92E202E` / task `task-ef778bef-fd75-49b4-9b5b-63a718620587`，嵌入站点接口命中包名或 BRAN。

## 当前阻塞

- [阻塞] 仿 PMS 已有 BRAN 输入；真实 PMS 入口仍缺少真实 PMS 包名或任务单。
- [阻塞] 真实 PMS 入口验收仍缺少可操作环境与截图窗口。

## 风险

- [风险] 完整路径可能过长，测量列表和批注证据中需要依赖截断和 `title`。
- [风险] 多测量点可能触发多次 `e3dGetNode()`，当前依赖缓存兜底；真实数据若慢，需要补并发限制或批量查询。
- [风险] 历史确认记录可能缺少模型树上下文，应继续依赖 refno fallback。
- [风险] 当前工作区有大量无关脏变更，后续 RUS-238 补丁必须继续显式暂存。
- [风险] 当前脏工作区规模为 `M=95 / D=31 / ??=76`，必须按主题拆分处理。
- [风险] Obscura v0.1.1 当前不足以替代 Playwright/PMS simulator 做 plant3d-web 业务验收。

## 决策

- [决策] 真实验收前不继续扩大代码范围。
- [决策] 若要做展示微调，优先改 UI 表达，不改测量持久化结构。
- [决策] 若 PMS/编校审无法 resolved，但 fallback 满足业务文案，可作为已知限制交付。
- [决策] 工作区收敛先做只读盘点，不删除、不回滚、不批量暂存。
- [决策] RUS-238 restore 验收同时覆盖测量路径、确认测量回放、BRAN fallback 和评论线程 UI 恢复；runner 的 out-of-band 后端注入需显式刷新评论线程。
