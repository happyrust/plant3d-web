# 批注视觉 Golden 回归实施计划

日期：2026-03-16

## 任务 1：补 Viewer 区域 golden helper

文件：

- 修改：`e2e/dtx-annotation-visual.spec.ts`

步骤：

1. 新增 `expectViewerGolden(page, name)` helper
2. 使用 `.viewer-panel-container` 作为截图根节点
3. 为 golden 关闭动画并固定截图命名

## 任务 2：先写失败断言

文件：

- 修改：`e2e/dtx-annotation-visual.spec.ts`

步骤：

1. 在云线、矩形、OBB、文字批注关键节点后加入 `toHaveScreenshot`
2. 运行：

```bash
PLAYWRIGHT_PORT=43177 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts --workers=1
```

预期：

- 由于 baseline 缺失，测试失败

## 任务 3：生成 baseline

步骤：

1. 运行：

```bash
PLAYWRIGHT_PORT=43177 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts --workers=1 --update-snapshots
```

预期：

- 生成 `*-snapshots/` 基线文件

## 任务 4：二次回归

步骤：

1. 再次运行：

```bash
PLAYWRIGHT_PORT=43177 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts --workers=1
```

2. 同时运行：

```bash
npm run type-check
```

预期：

- e2e 通过
- type-check 通过
