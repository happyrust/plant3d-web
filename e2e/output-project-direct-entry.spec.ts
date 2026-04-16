import { expect, test } from '@playwright/test';

async function expectDirectWorkbench(
  page: import('@playwright/test').Page,
  project: string,
) {
  await page.goto(`/?output_project=${project}`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[title="三维校审导航"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Plant3D Web', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`output_project=${project}`));
}

test('output_project=AvevaMarineSample 时首屏直达主工作区', async ({ page }) => {
  await expectDirectWorkbench(page, 'AvevaMarineSample');
});

test('output_project 指向未注册项目时也不回退到项目选择页', async ({ page }) => {
  await expectDirectWorkbench(page, 'MissingButRequested');
});
