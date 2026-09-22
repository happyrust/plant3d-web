import { defineConfig } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT || '3101';
const baseURL = `http://127.0.0.1:${port}`;
/**
 * 显卡档位（版本对比分屏的描边合成器按显卡串自动退回，收口计划 P3-c；两档各跑一遍才算把那条验完，
 * 见 docs/verification/model-version-compare-gen-model-v1-2026-09-18/README.md §8.3）：
 * - `PLAYWRIGHT_GPU=1`：明确要真显卡（ANGLE → D3D11）。本机 Chrome 新 headless 缺省就已经拿到真显卡，这一档是把它钉死。
 * - `PLAYWRIGHT_SOFTWARE_GL=1`：钉死软渲染（ANGLE → SwiftShader），模拟远程桌面 / 虚拟机 / 无显卡驱动。
 * 两个都不给就按 Chrome 缺省。
 */
const gpuArgs = process.env.PLAYWRIGHT_SOFTWARE_GL
  ? ['--use-gl=angle', '--use-angle=swiftshader']
  : process.env.PLAYWRIGHT_GPU
    ? ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist']
    : [];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    headless: true,
    channel: 'chrome',
    launchOptions: { args: gpuArgs },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
