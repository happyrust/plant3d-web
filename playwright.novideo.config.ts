/**
 * 本地调试用的 Playwright 配置：在 `playwright.config.ts` 基础上关掉录像。
 *
 * 保留理由：本机录像收尾（ffmpeg）会卡住 `browserContext.close`，跑增量联动这组长用例时 runner 退不出来，
 * 只能看到超时看不到用例结果。这份配置只用于 `npx playwright test -c playwright.novideo.config.ts`，
 * CI 仍走基线配置（`video: 'retain-on-failure'`）。不需要录像调试时可以直接删掉本文件。
 */
import { defineConfig } from '@playwright/test';

import base from './playwright.config';

export default defineConfig({ ...base, use: { ...(base.use ?? {}), video: 'off' } });
