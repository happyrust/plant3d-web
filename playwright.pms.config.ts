/**
 * 连接外网 PowerPMS 的 E2E 配置：不启动本地 Vite，避免与默认 e2e 的 webServer 冲突。
 *
 * 运行：npm run test:e2e:pms
 */
import { defineConfig } from '@playwright/test';

const base = process.env.PMS_E2E_BASE?.trim() || 'http://pms.powerpms.net:1801';

const longPms =
  process.env.PMS_E2E_FULL_FLOW === '1'
  || process.env.PMS_E2E_FULL_FLOW === 'true'
  || process.env.PMS_E2E_SUBMIT_REVIEW === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/pms-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: longPms ? 300_000 : 120_000,
  expect: { timeout: 25_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: base,
    // 本地默认有头便于看 PMS 与弹窗；CI 无头；可设 PMS_E2E_HEADLESS=1 强制无头
    headless: !!process.env.CI || process.env.PMS_E2E_HEADLESS === '1',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    ignoreHTTPSErrors: true,
  },
});
