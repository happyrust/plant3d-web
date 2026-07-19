# Quickstart: 模型版本时间线与历史模型树

## 前置条件

- 本仓依赖已安装（`npm install` 或 `pnpm install`）。
- plant-model-gen 后端已启动并含版本数据（默认验证库：AvevaMarineSample DB1112，两个 release：`codex-ams1112-physical-791-quarantine`、`codex-ams1112-physical-897-quarantine`）。
- 前端开发服务器：`npm run dev`（接口经 vite 代理转发到后端）。

## 接口直查验证（实现前先确认数据可用）

```bash
# 1. 版本列表：应返回 releases[]，每条含 release_lifecycle 与 release_quality 双轴字段
curl "http://127.0.0.1:<backend-port>/api/model-version/releases"

# 2. 版本 diff：应返回 rows[] 与 summary{added,changed,deleted,...}
curl "http://127.0.0.1:<backend-port>/api/model-version/diff?project=AvevaMarineSample&from_release_id=codex-ams1112-physical-791-quarantine&to_release_id=codex-ams1112-physical-897-quarantine&limit=10"

# 3. 可比性检查：应返回 classification / production_ready / recommended_action
curl "http://127.0.0.1:<backend-port>/api/model-version/compare-readiness?project=AvevaMarineSample&from_release_id=codex-ams1112-physical-791-quarantine&to_release_id=codex-ams1112-physical-897-quarantine"

# 4. 会话锚点：应返回 { dbnum, count, anchors[] }
curl "http://127.0.0.1:<backend-port>/api/model-history/anchors?dbnum=1112"

# 5. 元素快照（sesno/refno 取上一步锚点数据）
curl "http://127.0.0.1:<backend-port>/api/model-history/snapshot?dbnum=1112&sesno=<anchor-sesno>&refno=<refno>"
```

**410 过期场景构造**：将站点 `version_retention` 配置为有限窗口（如 `30d`）并重启后端，请求窗口外的 sesno 快照，应返回 HTTP 410 `Expired`（详见 `research/backend-api-facts.md` §2/§3）。retention 默认 0（无限保留）时该场景不会出现，可跳过或用配置副本站点验证。

**404 锚点缺失场景**：`/api/model-history/resolve-anchor?dbnum=1112&sesno=1&exact_only=true` 请求一个未固化的 sesno，应返回 404 `AnchorMissing`。

## US1 版本时间线面板（SC-001/002/007）

1. 打开前端 → 功能区任务页签点击「版本时间线」→ 面板在 viewer 右侧停靠打开。
2. 预期：版本按天分组、倒序排列；每张卡片显示标签/时间与**两个**独立徽章（生命周期 + 质量态）。
3. 展开任一卡片 → 差异摘要（+n ~m -k）懒加载出现，列表滚动不被阻塞。
4. 切换粒度到「含会话锚点」→ 锚点节点以小刻度出现在发布版本之间。
5. 检查 quarantine release（791）卡片 → 出现红色「隔离」徽章与警示（SC-007）。
6. 断开后端 → 面板显示错误态与重试入口（FR-008/033）。

## US2 树内差异标注（SC-003/004）

1. 在时间线上对 896 卡片点「设为 A」、897 卡片点「设为 B」→ 底部钉选栏出现 A→B。
2. 应用差异到模型树 → 树中出现 增/改/删 徽章；被删元素以灰色删除线幽灵节点出现在原父节点下。
3. 用「新增/修改/删除」筛选 chips → 树只保留对应类别及其祖先路径。
4. 点击一个「改」节点 → 属性差异表显示变更前(红)/变更后(绿)。注意：属性差异依赖 versioned 站点的 snapshot×2 做差（feasibility B3）；非 versioned 站点应显示「属性差异暂不可用」而非演示数据。
5. 与接口直查第 2 步的 summary 数字对账：树内徽章计数 MUST 与后端 diff 一致（SC-003）。
6. 退出差异模式 → 徽章与幽灵节点全部清除，树搜索/类型过滤/选中联动恢复正常（FR-013）。

## US3 历史快照模式（SC-005/006/008）

1. 时间线卡片点「查看此版本树」→ 树整体切换为该版本快照，顶部出现只读横幅。
2. 检查编辑/生成/导出入口 → 全部禁用或拦截（SC-005）。
3. 切到另一历史版本再切回 → 二次进入 < 500ms（缓存命中，SC-006）。
4. 点「回到最新」→ 树恢复最新版本，与切换前一致。
5. 构造 410/404 场景（见上）→ 出现「历史已过期 / 锚点缺失」提示与可执行回退选项（SC-008）。

## US4 双版本并排对比

1. A/B 已钉选 → 点「进入对比」→ 先看到可比性结论；791 为隔离版本时出现红色警示。
2. 双树按 refno 对齐；单侧缺失的元素在另一侧显示占位行。
3. 滚动/展开一侧 → 另一侧联动。
4. 点「在 3D 中并排显示」→ 视口分色渲染（A 蓝 / B 绿），选中差异行联动定位。

## US5 视口时间刻度条

1. 视口底部展开刻度条 → 每个版本一个刻度点，当前版本放大高亮。
2. 点击/拖动任一刻度 → 3D 场景切换到该版本，时间线面板选中同步（FR-022）。
3. 点播放 → 按时间顺序逐版本推进；加载慢时等待不跳帧；到末尾自动停止。

## 收尾自动化检查

```bash
npm run type-check
npm run lint
npx vitest run src/api/modelVersionApi.test.ts src/components/model-version/VersionTimelinePanel.test.ts
```

预期：无类型错误、无新增 lint 错误、相关单测全绿（用例见 tasks.md 测试任务）。

## Validation Record

（实现完成后在此追加实际验证记录：命令、输入数据、返回结果、截图引用。）
