# 阶段 2（前端界面）Checkpoint 记录

- 日期：2026-10-29
- 分支：`plant3d-web` `main`
- 对应 `tasks.md`：15.1–15.8、16

## 本次落地的提交

```
ee0ff5f9 feat(version-scrub): 面板接入时间轴、浏览、子树确认与直达链接
ab6974d2 feat(version-scrub): 版本时间轴组件 VersionTimelineScrubber
29dc28ab feat(version-scrub): useVersionFrames 浏览主流程、单钉着色、子树与降级
```

## 命令与结果

### `npm run type-check`

```
type-check: 当前 440 条错误 / 127 个文件；基线 440 条；新增 0；已消失 0
```

基线未改动，新增 0。

### `npx vitest run`（全量）

```
Test Files  420 passed (420)
     Tests  4080 passed | 1 todo (4081)
  Duration  30.50s
```

### `npx eslint <本次改动的全部文件> --max-warnings 0`

```
Command completed successfully
```

覆盖：`src/components/model-version/`（含 `VersionTimelineScrubber.vue`、`ModelUnitVersionComparePanel.vue`、
`NodeVersionTimeline.vue` 与三个测试文件）、`src/viewer/versionBrowseBridge.ts`、
`src/composables/useVersionFrames{,.test,.property.test}.ts`、`src/components/dock_panels/ViewerPanel.vue`。

### `npm run lint`（全仓）

仍有 114 error / 16 warning，全部在既有文件：`src/harness/*.ts` 的 `vue/one-component-per-file` 警告，
以及若干历史文件的 `no-empty` / `prefer-for-of` / `no-dupe-keys` / `no-control-regex` 与一处压缩产物
（`1:598` 这类行号）。本次改动的文件不在其中，未触碰。

## 审核面板五套回归

本特性不改 `ReviewPanel.vue` / `DesignerCommentHandlingPanel.vue`，按 AGENTS.md 不需要跑那五套。

## 已知遗留

- `tasks.md` 的 17.1 / 17.2（性能埋点与 `e2e/version-scrub-perf.spec.ts`）与 7.1 / 7.2（联调脚本）
  仍待做；后者需要本机起 rocksdb 档 8022。
- `useVersionFrames` 的 `debug` 读数（`cacheKeys` / `inFlight`）已暴露，17.1 的性能脚本可直接读它。
