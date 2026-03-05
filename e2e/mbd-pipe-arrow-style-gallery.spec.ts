import { test, expect } from "@playwright/test";

const DEMO_BASE =
  "/?dtx_demo=mbd_pipe&mbd_pipe_case=rebarviz_beam&mbd_dim_mode=rebarviz&mbd_arrow_size=34&mbd_arrow_angle=24&mbd_line_width=4";

test("mbd pipe arrow style gallery", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });

  const styles = ["open", "filled", "tick"] as const;
  for (const style of styles) {
    await page.goto(`${DEMO_BASE}&mbd_arrow_style=${style}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const v = (window as any).__xeokitViewer;
            return !!v?.scene;
          }),
        { timeout: 20000, message: `等待 ${style} 样式 demo 初始化` },
      )
      .toBeTruthy();

    await page.waitForTimeout(4000);
    await page.screenshot({
      path: `e2e/screenshots/mbd-pipe-rebarviz-beam-${style}.png`,
      fullPage: false,
    });
  }
});
