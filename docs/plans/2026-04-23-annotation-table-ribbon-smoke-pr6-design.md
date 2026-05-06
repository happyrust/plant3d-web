# 批注表格 Ribbon 冒烟 E2E · PR 6 设计 · 2026-04-23

> 本 PR 是 MVP 主线之外的**补强**：在 `npm run test:e2e` 下加一个冒烟测试，覆盖 Ribbon 批注表格按钮 → Dock 面板打开的端到端链路。

## 0. 目标

- 验证 PR 4 新增的 `panel.annotationTable` 命令在真实浏览器环境能被触发
- 验证 `designerCommentHandling` dock 面板能被激活并渲染
- **不** 验证表格内部交互（留给组件级单测）
- **不** 依赖后端返回真实任务数据（冒烟测试 · 只到面板开启为止）

## 1. 测试场景

### 1.1 smoke-1 · 批注表格按钮渲染

- 入口 URL：`/?output_project=AvevaMarineSample&show_dbnum=7997`（与 `review-initiate-ribbon.spec.ts` 一致）
- 切到校审 tab：`[data-ribbon-tab="review"]`
- 断言：`[data-command="panel.annotationTable"]` visible
- 断言：按钮 label 文本含 "批注表格"

### 1.2 smoke-2 · 点击按钮打开面板

- 延续 smoke-1 场景
- 点击按钮
- 断言：`[data-panel="designerCommentHandling"]` visible

## 2. 文件清单

| 文件 | 变更 |
|------|------|
| `e2e/annotation-table-ribbon.spec.ts` | 新 · 2 个 Playwright test |
| `CHANGELOG.md` | PR 6 段 |
| `docs/plans/2026-04-23-annotation-table-ribbon-smoke-pr6-design.md` | 本文件 |

## 3. 运行方式

```bash
npm run test:e2e -- --grep "annotation-table-ribbon"
```

## 4. 风险

| 风险 | 缓解 |
|------|------|
| `output_project` 路由需要鉴权 | 复用既有 `openReviewRibbon` 模式，其他 review-initiate-ribbon.spec.ts 已验证可用 |
| `showMyTasksEntry` gate 影响 review panel 可见 | 冒烟场景不依赖"我的编校审"，只看批注表格按钮 |
| CI / 本地环境差异 | 本 PR 只提交代码，不在 PR 内自动跑 CI（由用户按需运行） |

## 5. 非目标

- 不测表格内部的搜索 / 排序 / 分页
- 不测行单双击飞到 3D（需真实模型和 refno）
- 不测 embed 链路

## 6. 验收

- [ ] `e2e/annotation-table-ribbon.spec.ts` 通过 TypeScript 编译
- [ ] 本地执行 `npm run test:e2e -- annotation-table-ribbon` 两个 test 全过
- [ ] 其他 e2e 不破坏
- [ ] CHANGELOG PR 6 段
