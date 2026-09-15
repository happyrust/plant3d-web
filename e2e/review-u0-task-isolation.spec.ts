/**
 * U0 任务隔离 · 异步回执守卫（计划 docs/plans/2026-09-14-review-next-steps-plan.md §4 V2，交互方案 §3.6，决策 d-565）。
 *
 * 场景：在任务 A 创建批注并输说明、云线自动截图与严重度保存两条请求都还在飞，人切到任务 B；
 * 迟到的回执到达时——
 * - B 的记录数、截图引用、选择、相机与切换前**逐字节相同**（`exportJSON` 字串直接比）；
 * - 截图 / 回滚各自落进 **A** 的本机容器（`plant3d-web-tools-v7:<A 的 scope key>`），不弹任何提示；
 * - 切回 A 才看到迟到的截图与回滚后的严重度；
 * - 切到任务作用域之前留在旧全局容器（`project=…|db=…`）里的草稿只显示为「未归属草稿」，不进 A 也不进 B。
 *
 * 跑法：`npx @playwright/test test e2e/review-u0-task-isolation.spec.ts`（`dtx_demo=primitives`，不依赖后端；
 * `/api/review/*` 全部 route mock）。
 *
 * 边界：primitives demo 下 Viewer 忽略 `showModelByRefnos`，所以相机 / 高亮那一路的守卫（`shouldApply` → `suppressed`）
 * 这里只能断言「相机 / 选择没被别的回执动过」，正向路径由 `src/composables/useViewerContext.test.ts` 与
 * `ViewerPanel` 的加载完再核一次覆盖；真机走查放 p0 live smoke。
 */
import { expect, test, type Page, type Route } from '@playwright/test';

const PROJECT = 'AvevaMarineSample';
const DEMO_OBJECTS = 50;
const DEMO_URL = `/?output_project=${PROJECT}&dtx_demo=primitives&dtx_demo_count=${DEMO_OBJECTS}`;
const V7_PREFIX = 'plant3d-web-tools-v7:';
const LEGACY_SCOPE = `project=${PROJECT}|db=__all__`;

type V7Container = {
  version: number;
  annotations: { id: string; description?: string; severity?: string; screenshot?: { attachmentId?: string; url?: string } }[];
  cloudAnnotations: { id: string; severity?: string; screenshot?: { attachmentId?: string; url?: string } }[];
};

type StoreSnapshot = {
  exportJSON: string;
  textIds: string[];
  cloudIds: string[];
  cloudScreenshots: (string | null)[];
  selection: string[];
  camera: number[];
};

function reviewTask(id: string, title: string) {
  const now = Date.now();
  return {
    id,
    title,
    description: '',
    modelName: PROJECT,
    status: 'in_review',
    priority: 'medium',
    requesterId: 'tester',
    requesterName: 'Tester',
    reviewerId: 'reviewer',
    reviewerName: 'Reviewer',
    components: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function waitForDtxReady(page: Page) {
  await page.waitForFunction(
    () => {
      const v = (window as any).__xeokitViewer;
      const layer = v && v.__dtxLayer;
      if (!layer || typeof layer.getStats !== 'function') return false;
      const stats = layer.getStats();
      return !!stats && stats.compiled === true && Number(stats.totalObjects) > 0;
    },
    null,
    { timeout: 60_000 },
  );
}

async function waitForToolStoreReady(page: Page) {
  await page.waitForFunction(
    () => typeof (window as any).__viewerToolStore?.clearAll === 'function',
    null,
    { timeout: 10_000 },
  );
}

/** 应用侧单例：Vite dev server 下同一模块 URL 就是同一实例，测试拿到的 store / session 与面板用的是同一份 */
async function installTestBridge(page: Page) {
  await page.evaluate(async () => {
    const w = window as any;
    const [{ useReviewStore }, { useAnnotationDraftSession }, { annotationScopeKey }, { ensurePanelAndActivate }, { onToast }, { saveAnnotationSeverity }] = await Promise.all([
      import(/* @vite-ignore */ '/src/composables/useReviewStore.ts'),
      import(/* @vite-ignore */ '/src/composables/useAnnotationDraftSession.ts'),
      import(/* @vite-ignore */ '/src/review/domain/annotationScope.ts'),
      import(/* @vite-ignore */ '/src/composables/useDockApi.ts'),
      import(/* @vite-ignore */ '/src/ribbon/toastBus.ts'),
      import(/* @vite-ignore */ '/src/composables/useAnnotationSeveritySync.ts'),
    ]);
    const toasts: { message: string; level?: string }[] = [];
    onToast((payload: { message: string; level?: string }) => {
      toasts.push({ message: payload.message, level: payload.level });
    });
    w.__u0 = {
      reviewStore: useReviewStore(),
      draftSession: useAnnotationDraftSession(),
      annotationScopeKey,
      ensurePanelAndActivate,
      saveAnnotationSeverity,
      toasts,
    };
  });
}

async function setCurrentTask(page: Page, task: ReturnType<typeof reviewTask> | null) {
  await page.evaluate((next) => {
    (window as any).__u0.reviewStore.currentTask.value = next;
  }, task);
}

async function readScope(page: Page): Promise<{ scopeKey: string | null; taskId: string | null; draftSessionId: string | null }> {
  return page.evaluate(() => {
    const store = (window as any).__viewerToolStore;
    const scope = store.getAnnotationDraftScope();
    return {
      scopeKey: scope ? (window as any).__u0.annotationScopeKey(scope) : null,
      taskId: scope?.taskId ?? null,
      draftSessionId: scope?.draftSessionId ?? null,
    };
  });
}

async function waitForTaskScope(page: Page, taskId: string): Promise<string> {
  await expect.poll(() => readScope(page).then((s) => s.taskId), { timeout: 10_000 }).toBe(taskId);
  const scope = await readScope(page);
  expect(scope.scopeKey).toBeTruthy();
  return scope.scopeKey as string;
}

async function readSnapshot(page: Page): Promise<StoreSnapshot> {
  return page.evaluate(() => {
    const store = (window as any).__viewerToolStore;
    const compat = (window as any).__xeokitViewer;
    const dtx = (window as any).__dtxViewer;
    return {
      exportJSON: store.exportJSON() as string,
      textIds: store.annotations.value.map((a: { id: string }) => a.id),
      cloudIds: store.cloudAnnotations.value.map((c: { id: string }) => c.id),
      cloudScreenshots: store.cloudAnnotations.value.map((c: { screenshot?: { attachmentId?: string } }) => c.screenshot?.attachmentId ?? null),
      selection: [...(compat?.scene?.selectedObjectIds ?? [])],
      camera: [...(dtx?.camera?.position?.toArray?.() ?? []), ...(dtx?.controls?.target?.toArray?.() ?? [])],
    };
  });
}

async function readContainer(page: Page, scopeKey: string): Promise<V7Container | null> {
  return page.evaluate(([prefix, key]) => {
    const raw = localStorage.getItem(`${prefix}${key}`);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }, [V7_PREFIX, scopeKey] as const) as Promise<V7Container | null>;
}

/**
 * 找一个既能拾中构件、又没有被浮层（批注工具条 / 云线提示等）盖住的屏幕点：
 * 校审面板开着时视口变窄，工具条会压在画布正中，光靠 pick 命中不够，还得 elementFromPoint 落在画布上。
 */
async function findPickablePoint(page: Page) {
  const point = await page.evaluate(() => {
    const v = (window as any).__xeokitViewer;
    const sel = v?.__dtxSelection;
    const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement | null;
    if (!sel || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratios = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];
    for (const ry of ratios) {
      for (const rx of ratios) {
        const x = rect.width * rx;
        const y = rect.height * ry;
        const pageX = rect.left + x;
        const pageY = rect.top + y;
        const top = document.elementFromPoint(pageX, pageY);
        if (top !== canvas) continue;
        const hit = sel.pick?.({ x, y });
        if (!hit?.objectId) continue;
        return { x: pageX, y: pageY, objectId: hit.objectId as string };
      }
    }
    return null;
  });
  expect(point).not.toBeNull();
  return point as { x: number; y: number; objectId: string };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/** 可以由测试决定何时放行的 route：请求进来先挂着，`release()` 之后才回响应 */
function heldRoute(fulfill: (route: Route) => Promise<void>) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let seen = 0;
  const handler = async (route: Route) => {
    seen += 1;
    await gate;
    await fulfill(route);
  };
  return { handler, release: () => release(), seenCount: () => seen };
}

test.describe('U0 任务隔离 · 异步回执守卫（计划 §4 V2）', () => {
  // 校审面板 + 三维查看器并排，给画布留够框选的空间
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDtxReady(page);
    await waitForToolStoreReady(page);
    await installTestBridge(page);
  });

  test('A 的迟到截图 / 保存回执到达时已在 B：B 逐字节不变、回执归属 A、旧全局草稿只显示为未归属', async ({ page }) => {
    // ── 0. 切到任务作用域之前，旧全局容器里已经躺着一条草稿 ──
    await page.evaluate(() => {
      const store = (window as any).__viewerToolStore;
      store.clearAll();
      store.addAnnotation({
        id: 'legacy-1',
        entityId: 'o:legacy-1',
        worldPos: [0, 0, 0],
        visible: true,
        glyph: '!',
        title: '旧容器里的草稿',
        description: '',
        createdAt: 1,
        refno: '=1/1',
      });
    });
    await expect.poll(() => readContainer(page, LEGACY_SCOPE).then((c) => c?.annotations.map((a) => a.id) ?? null), { timeout: 5_000 })
      .toEqual(['legacy-1']);

    // ── 1. 打开校审面板：scope 同步装上，容器切到本 tab 的 session 作用域，旧容器从此只读 ──
    await page.evaluate(() => (window as any).__u0.ensurePanelAndActivate('review'));
    await expect(page.locator('[data-panel="review"]')).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => readScope(page).then((s) => s.draftSessionId), { timeout: 10_000 }).toBeTruthy();
    expect((await readSnapshot(page)).textIds).toEqual([]);

    // ── 2. 进入任务 A：面板出工作区，旧全局草稿只显示为「未归属」，没有被导入 ──
    const taskA = reviewTask('task-A', 'U0 任务 A');
    const taskB = reviewTask('task-B', 'U0 任务 B');
    await setCurrentTask(page, taskA);
    const scopeKeyA = await waitForTaskScope(page, 'task-A');
    await expect(page.locator('[data-testid="reviewer-landing-workspace"]')).toBeVisible({ timeout: 15_000 });
    const notice = page.locator('[data-testid="annotation-unattributed-draft-notice"]');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice.locator('[data-testid="annotation-unattributed-draft-label"]')).toHaveText(`未归属草稿（项目 ${PROJECT}）`);
    await expect(notice).toContainText('文字 1');
    expect((await readSnapshot(page)).textIds).toEqual([]);

    // ── 3. 两条会迟到的请求：云线自动截图上传、严重度保存（失败 → 回滚）──
    const upload = heldRoute(async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          attachment: {
            id: 'att-late-A',
            url: '/uploads/att-late-A.png',
            name: 'att-late-A.png',
            mimeType: 'image/png',
            size: 1024,
            uploadedAt: Date.now(),
          },
        }),
      });
    });
    const severity = heldRoute(async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error_message: 'boom' }) });
    });
    await page.route('**/api/review/attachments', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await upload.handler(route);
    });
    await page.route('**/api/review/annotations/**', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await severity.handler(route);
    });

    // A 里：创建一条文字批注并输说明；再创建一条云线（真实框选，触发自动截图上传）
    await page.evaluate(() => {
      const store = (window as any).__viewerToolStore;
      store.addAnnotation({
        id: 'a-text',
        entityId: 'o:a-text',
        worldPos: [1, 0, 0],
        visible: true,
        glyph: '1',
        title: 'A 的批注',
        description: 'A 的说明',
        createdAt: 2,
        refno: '=1/2',
      });
      store.updateAnnotationSeverity('text', 'a-text', 'general');
    });
    const point = await findPickablePoint(page);
    await page.evaluate((refno) => {
      const store = (window as any).__viewerToolStore;
      store.setCloudTargetRefnos([refno]);
      store.setToolMode('annotation_cloud');
    }, point.objectId);
    const uploadRequest = page.waitForRequest((req) => req.url().includes('/api/review/attachments') && req.method() === 'POST', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y);
    await drag(page, { x: point.x - 70, y: point.y - 70 }, { x: point.x + 70, y: point.y + 70 });
    await uploadRequest;
    await expect.poll(() => readSnapshot(page).then((s) => s.cloudIds.length), { timeout: 10_000 }).toBe(1);
    const cloudId = (await readSnapshot(page)).cloudIds[0];

    // 严重度保存：乐观改成 principle，请求挂着
    const severityRequest = page.waitForRequest((req) => req.url().includes('/api/review/annotations/') && req.method() === 'PATCH', { timeout: 20_000 });
    await page.evaluate(() => {
      const w = window as any;
      w.__u0.severitySave = w.__u0.saveAnnotationSeverity('text', 'a-text', 'principle', { taskId: 'task-A' });
    });
    await severityRequest;
    expect(upload.seenCount()).toBe(1);
    expect(severity.seenCount()).toBe(1);
    const inA = await readSnapshot(page);
    expect(inA.textIds).toEqual(['a-text']);
    expect(inA.cloudScreenshots).toEqual([null]);

    // ── 4. 两条请求都还在飞：切到 B ──
    const toastCountBeforeSwitch = await page.evaluate(() => (window as any).__u0.toasts.length as number);
    await setCurrentTask(page, taskB);
    const scopeKeyB = await waitForTaskScope(page, 'task-B');
    expect(scopeKeyB).not.toBe(scopeKeyA);
    // A 的容器已经带着两条记录（principle 是乐观值）刷进去了
    const containerAAtSwitch = await readContainer(page, scopeKeyA);
    expect(containerAAtSwitch?.annotations.map((a) => [a.id, a.severity])).toEqual([['a-text', 'principle']]);
    expect(containerAAtSwitch?.cloudAnnotations.map((c) => c.id)).toEqual([cloudId]);
    const bBefore = await readSnapshot(page);
    expect(bBefore.textIds).toEqual([]);
    expect(bBefore.cloudIds).toEqual([]);
    await expect(notice).toBeVisible();

    // ── 5. 放行迟到的回执 ──
    upload.release();
    severity.release();
    await expect.poll(async () => {
      const saved = await page.evaluate(() => (window as any).__u0.severitySave);
      return saved;
    }, { timeout: 15_000 }).toBe(false);
    await expect.poll(() => readContainer(page, scopeKeyA).then((c) => c?.cloudAnnotations[0]?.screenshot?.attachmentId ?? null), { timeout: 15_000 })
      .toBe('att-late-A');

    // ── 6. B 逐字节不变；回执落在 A 的容器；一句提示都没弹 ──
    const bAfter = await readSnapshot(page);
    expect(bAfter.exportJSON).toBe(bBefore.exportJSON);
    expect(bAfter.selection).toEqual(bBefore.selection);
    expect(bAfter.camera).toEqual(bBefore.camera);
    expect(bAfter.textIds).toEqual([]);
    expect(bAfter.cloudIds).toEqual([]);
    const containerA = await readContainer(page, scopeKeyA);
    expect(containerA?.annotations.map((a) => [a.id, a.severity, a.description])).toEqual([['a-text', 'general', 'A 的说明']]);
    expect(containerA?.cloudAnnotations[0]?.screenshot).toMatchObject({ attachmentId: 'att-late-A', url: expect.stringContaining('/uploads/att-late-A.png') });
    const containerB = await readContainer(page, scopeKeyB);
    expect(containerB?.annotations ?? []).toEqual([]);
    expect(containerB?.cloudAnnotations ?? []).toEqual([]);
    const toastsAfterSwitch = await page.evaluate((from) => (window as any).__u0.toasts.slice(from) as { message: string }[], toastCountBeforeSwitch);
    expect(toastsAfterSwitch.filter((t) => /截图|严重度|回滚/.test(t.message))).toEqual([]);

    // ── 7. 切回 A：迟到的截图与回滚后的严重度跟着容器一起回来；旧全局草稿仍在旧容器、仍只是「未归属」 ──
    await setCurrentTask(page, taskA);
    await waitForTaskScope(page, 'task-A');
    await expect.poll(() => readSnapshot(page).then((s) => s.cloudScreenshots), { timeout: 10_000 }).toEqual(['att-late-A']);
    const backInA = await page.evaluate(() => {
      const store = (window as any).__viewerToolStore;
      const text = store.annotations.value.find((a: { id: string }) => a.id === 'a-text');
      return {
        textIds: store.annotations.value.map((a: { id: string }) => a.id),
        severity: text?.severity ?? null,
        description: text?.description ?? null,
        cloudScreenshot: store.getAnnotationScreenshot('cloud', store.cloudAnnotations.value[0]?.id),
      };
    });
    expect(backInA.textIds).toEqual(['a-text']);
    expect(backInA.severity).toBe('general');
    expect(backInA.description).toBe('A 的说明');
    expect(backInA.cloudScreenshot).toMatchObject({ attachmentId: 'att-late-A' });
    expect((await readContainer(page, LEGACY_SCOPE))?.annotations.map((a) => a.id)).toEqual(['legacy-1']);
    await expect(notice).toContainText('文字 1');
  });
});
