import { test, expect } from '@playwright/test';

/**
 * 验证 MBD pipe 标注加载：
 * 打开 ?output_project=AvevaMarineSample&mbd_pipe=24381/145018
 * 期望后端 /api/mbd/pipe/ 返回 success:true 且前端无报错
 */
test('mbd pipe annotation loads successfully via URL param', async ({ page }) => {
  // 收集控制台错误
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // 拦截 MBD pipe API 请求，记录响应
  let apiResponse: any = null;
  page.on('response', async resp => {
    if (resp.url().includes('/api/mbd/pipe/')) {
      try {
        apiResponse = await resp.json();
      } catch { /* ignore */ }
    }
  });

  // 打开页面
  await page.goto(
    '/?output_project=AvevaMarineSample&mbd_pipe=24381/145018',
    { waitUntil: 'domcontentloaded', timeout: 30_000 },
  );

  // 等待 API 响应到达（最多 20 秒）
  await expect.poll(() => apiResponse, {
    message: '等待 /api/mbd/pipe/ 响应',
    timeout: 20_000,
  }).toBeTruthy();

  // 验证 API 返回成功
  expect(apiResponse.success).toBe(true);
  expect(apiResponse.data).toBeTruthy();
  expect(apiResponse.data.segments.length).toBeGreaterThan(0);
  expect(apiResponse.data.dims.length).toBeGreaterThan(0);

  // 验证没有 [mbd-pipe] 相关的控制台错误
  const mbdErrors = consoleErrors.filter(e => e.includes('mbd-pipe'));
  expect(mbdErrors).toHaveLength(0);
});
