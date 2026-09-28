# 三维校审批注单次主操作端到端验收计划

日期：2026-04-27  
前置实现：批注状态真源、evidence-only diff、单一处理表单、OBB 辅助证据标签已完成。  
当前阻塞：本地 PMS simulator 卡在启动/健康检查阶段；真实 PMS extended flow 需要外部环境变量。

## 1. 目标

在合并前补齐至少一条端到端证据，证明以下主路径成立：

1. SJ/JH/SH 角色链路可进入对应三维校审页面。
2. 批注处理使用单一处理表单完成状态提交。
3. 纯状态提交不会再触发“保存新增证据”阻塞。
4. 新增测量/几何证据仍需要保存。
5. 任务流转仍由后端 `reviewAnnotationCheck` 门禁控制。
6. OBB 当前作为辅助证据展示，不参与门禁阻塞。

## 2. 验收策略

优先级：

1. **本地 PMS simulator**：最适合开发期反复跑，避免真实 PMS 网络/账号不稳定。
2. **真实 PMS CDP extended flow**：最接近业务环境，适合作为最终人工或半自动验收。
3. **单元/组件回归**：已经通过，作为每次修复后的快速门禁。

最低合并前要求：

- 单元/组件回归 + `type-check` 必须通过。
- simulator 或真实 PMS extended flow 至少一种要形成可读输出。
- 如果两种 E2E 都被环境阻塞，必须在 PR/验收文档中明确阻塞原因和复跑命令。

## 3. Track A：修复 PMS simulator 卡住

### A1. 带 trace 复跑

```bash
PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

预期：

- 输出前端、后端、SurrealDB 启动步骤。
- 若卡住，能定位在具体 health check。

结果记录：

- 更新 `docs/verification/review-annotation-single-action-phase-d-2026-04-27.md`。
- 记录最后一条日志、耗时、是否生成 artifacts。

### A2. 分段确认依赖

确认前端：

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

确认后端：

```bash
cd ../plant-model-gen
cargo run --bin web_server -- db_options/DbOption-mac.toml
```

注意：

- 不运行 Rust test。
- 若只验证接口，优先用 HTTP JSON 请求。

确认 SurrealDB：

- 检查 simulator 使用的端口是否被占用。
- 检查 `DbOption-mac.toml` 中 `web_server.surreal_*` 配置是否可启动。

### A3. 若仍无日志，改进 simulator bootstrap 日志

建议在 `scripts/pms-simulator-bootstrap.ts` 中补充：

- 启动前打印前端/后端命令摘要。
- 每个 health check 打印目标 URL 和最近错误。
- 超时后输出 frontend/backend/surreal log path。

验收：

- 即使 simulator 失败，也能输出明确失败阶段，而不是 8 分钟无日志。

## 4. Track B：真实 PMS CDP extended flow

### B1. 准备环境变量

不要将真实密码写入仓库或提交信息。

```bash
export PMS_E2E_PASSWORD='***'
export PMS_EMBEDDED_SITE_SUBSTRING='***'
export PMS_E2E_USERNAME=SJ
export PMS_CHECKER_USERNAME=JH
```

可选：

```bash
export PMS_MOCK_PACKAGE_NAME="E2E-SINGLE-ACTION-$(date +%Y%m%d%H%M%S)"
export PMS_CDP_VERIFY_PMS_API=1
```

### B2. 执行 extended flow

```bash
npm run test:pms:cdp:extended
```

如果需要肉眼观察：

```bash
chmod +x scripts/launch-chrome-cdp.sh
./scripts/launch-chrome-cdp.sh
CHROME_CDP_URL=http://127.0.0.1:9222 npm run test:pms:cdp:attach:extended
```

### B3. 验收断言

至少人工确认：

- SJ 发起编校审成功。
- PMS 三维校审单列表可见本次包名。
- JH 打开三维页后能看到批注/测量工作台。
- 退回设计后，SJ 处理批注时看到单一处理表单。
- SJ 提交 `已修改` 后，不新增证据时不再被“保存新增证据”阻塞。
- JH 对处理结果执行 `同意` 或 `驳回` 时也使用单一处理表单。

记录：

- 命令输出摘要。
- 包名 / formId / taskId。
- 关键截图路径或视频路径。
- 若失败，记录失败页面 URL、错误文本和 Network/API 响应线索。

## 5. Track C：回归门禁

每次修复 simulator 或 PMS 脚本后执行：

```bash
npm test -- src/api/reviewApi.test.ts src/components/review/annotationWorkspaceModel.test.ts src/components/review/ReviewCommentsTimeline.test.ts src/components/review/reviewPanelActions.test.ts src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/ReviewPanel.test.ts src/components/review/AnnotationTableView.test.ts
npm run type-check
```

当前已知通过基线：

- 7 个测试文件通过。
- 129 个测试通过。
- `npm run type-check` 通过。

## 6. 证据归档

更新或新增：

- `docs/verification/review-annotation-single-action-phase-d-2026-04-27.md`
- 如真实 PMS 跑通，可新增：
  - `docs/verification/review-annotation-single-action-pms-extended-2026-04-27.md`

建议记录格式：

```md
## Command
...

## Result
...

## Evidence
- packageName:
- formId:
- taskId:
- screenshots:
- videos:

## Notes
...
```

## 7. 决策点

如果 simulator 修复成本超过预期：

- 可以先用真实 PMS CDP extended flow 作为最终验收。
- simulator bootstrap 日志增强作为后续技术债。

如果真实 PMS 受验证码、网络或账号限制：

- 以 simulator 跑通作为合并前 E2E。
- 在 PR 中明确真实 PMS 未跑原因。

如果两者都不可用：

- 不继续扩大代码改造范围。
- 保留当前本地验证证据。
- 将 E2E 环境修复作为单独任务排期。

## 8. 完成标准

- 至少一种 E2E 路径跑通并归档。
- 若未跑通，阻塞原因具体到“前端/后端/SurrealDB/PMS 登录/嵌入页/接口门禁”之一。
- 回归门禁通过。
- 验收文档更新到最新结果。
