import { expect, test } from '@playwright/test';

test('dimension_demo mounts the dimension system and starts a typed creation session', async ({ page }) => {
  // `dimension_demo` 在 `src/` 下已无读取点（ViewerPanel 无条件建尺寸系统）；
  // `dtx_demo=primitives` 让 ViewerPanel 跳过启动时的 db_meta_info 预拉，无后端也能起来。
  await page.goto('/?dtx_demo=primitives&dtx_demo_count=1');
  await page.waitForFunction(() => (
    (window as any).__viewerContext?.dimensionSystem?.value
    || typeof (window as any).__dimensionSystemError === 'string'
  ));
  expect(await page.evaluate(
    () => (window as any).__dimensionSystemError ?? null,
  )).toBeNull();

  await expect.poll(() => page.evaluate(() => {
    // ADR 0064：叠层在 viewport 自己的 scene 里（整帧后单独渲染），不在 __dtxViewer.scene 下。
    const overlay = (window as any).__viewerContext.dimensionSystem.value.viewport.overlayScene;
    const group = overlay?.getObjectByName?.('dimension-scene-overlay');
    const lines = group?.getObjectByName?.('dimension-scene-lines');
    const arrows = group?.getObjectByName?.('dimension-scene-arrows');
    return Boolean(
      overlay?.parent === null
      && group?.visible
      && lines?.visible
      && arrows?.visible,
    );
  }), { timeout: 30_000 }).toBe(true);
  // 「尺寸标注」既是 ribbon group 标签也是按钮文本，getByText 会 strict 违规；
  // 且默认菜单模式是 hierarchical，dropdown 未展开前该文本不存在。
  // 两套菜单都带 data-ribbon-tab / data-command，所以这条路径与菜单模式无关。
  await page.locator('[data-ribbon-tab="view"]').first().click();
  await page.locator('[data-command="panel.dimension"]').first().click();
  const linearButton = page.getByTestId('dimension.create.linear');
  await expect(linearButton).toBeVisible();
  await linearButton.click();

  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession
  ))).toBe(true);

  await page.getByTestId('dimension.cancel').click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession
  ))).toBe(false);
});
