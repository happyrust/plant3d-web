# 批注视觉 Golden 回归设计

日期：2026-03-16

## 1. 背景

当前仓库已经有 [`e2e/dtx-annotation-visual.spec.ts`](/Volumes/DPC/work/plant-code/plant3d-web/e2e/dtx-annotation-visual.spec.ts) 这条批注视觉回归：

- 自动创建云线、矩形、OBB、文字批注
- 生成 PNG 截图到 `e2e/screenshots/annotation-visual/`
- 对关键 store 字段做行为断言

这条链路已经足够做“人工查看效果图”，但还没有真正的视觉基线能力。后续如果图钉、引线、卡片样式发生细微回归，现状只能靠人翻 PNG 判断，无法在 CI 中自动拦住。

## 2. 目标

在不推翻现有截图产出的前提下，为批注视觉回归增加原生 Playwright golden 对比能力：

1. 保留现有 `saveViewerShot(...)`
2. 新增 `toHaveScreenshot(...)`
3. 截图范围聚焦到 Viewer 区域，而不是整页
4. 让批注样式调整后可以直接通过 snapshot diff 看出回归

## 3. 方案比较

### 方案 A：直接用 Playwright 原生 `toHaveScreenshot`

做法：

- 在现有 e2e 用例里增加 `expect(locator).toHaveScreenshot(...)`
- baseline 交给 Playwright 管理
- 继续保留人工查看用 PNG

优点：

- 标准能力，维护成本最低
- diff 结果和更新基线流程都成熟
- 不需要引入新依赖

缺点：

- 需要额外做一点稳定化，避免动画或布局波动

### 方案 B：保留人工截图，再自己写 PNG 比对脚本

做法：

- 用 `pixelmatch` 或自研脚本比对 `e2e/screenshots/annotation-visual/` 下的 PNG

优点：

- 目录结构完全可控

缺点：

- 需要额外维护脚本和差异图逻辑
- 重复造轮子

### 方案 C：只保留人工 PNG，不做 golden

优点：

- 不需要新增代码

缺点：

- 无法自动拦截视觉回归
- 不满足“真正可回归”的目标

## 4. 选型

采用方案 A。

原则：

- `saveViewerShot(...)` 继续保留，用于人工查看
- `toHaveScreenshot(...)` 负责机器回归
- 只截 `ViewerPanel` 区域，减少 dock/panel 波动干扰

## 5. 设计细节

### 5.1 截图范围

使用 `.viewer-panel-container` 作为 golden 截图根节点。

原因：

- 批注图钉、引线、overlay label 都在这个容器内
- 避免整页截图把 dock 面板、提示卡片、其他无关区域带进基线

### 5.2 文件组织

继续保留：

- `e2e/screenshots/annotation-visual/*.png`

新增：

- Playwright 自动管理的 `*-snapshots/` 基线目录

命名建议：

- `annotation-visual-cloud.png`
- `annotation-visual-rect.png`
- `annotation-visual-obb.png`
- `annotation-visual-text-expanded.png`
- `annotation-visual-text-dragged.png`
- `annotation-visual-text-collapsed.png`
- `annotation-visual-text-reexpanded.png`

### 5.3 稳定化策略

为了降低 flake：

1. 截图前固定等待 DTX compiled 完成
2. 截图前等待关键 locator 可见
3. 对文字双击折叠/展开保留最小时间间隔
4. 使用 locator screenshot，而不是 full page screenshot
5. `animations: 'disabled'`

### 5.4 回归边界

这一步只给现有两条用例加 golden，不额外拆新 spec。

不在本轮处理：

- 矩形/OBB 内联编辑提交的更细粒度合同
- 单独的 diff HTML 报告页面
- 自定义像素容差脚本

## 6. 验证

最少验证：

- `npm run type-check`
- `PLAYWRIGHT_PORT=43177 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts --workers=1 --update-snapshots`
- `PLAYWRIGHT_PORT=43177 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts --workers=1`

成功标准：

- 首次生成 baseline 成功
- 第二次不更新 snapshot 时直接通过
- 现有人工 PNG 仍正常产出
