/**
 * U0 任务隔离 · 异步回执守卫（计划 docs/plans/2026-09-14-review-next-steps-plan.md §4 V2，交互方案 §3.6，决策 d-565）。
 *
 * 主场景：在任务 A 创建批注并输说明、云线自动截图与严重度保存两条请求都还在飞，人切到任务 B；迟到的回执到达时——
 * - B 的记录数、截图引用、选择、相机与切换前**逐字节相同**（`exportJSON` 字串直接比）；
 * - 截图 / 回滚各自落进 **A** 的本机容器（`plant3d-web-tools-v7:<A 的 scope key>`），不弹任何提示；
 * - 切回 A 才看到迟到的截图与回滚后的严重度；
 * - 切到任务作用域之前留在旧全局容器（`project=…|db=…`）里的草稿只显示为「未归属草稿」，不进 A 也不进 B。
 *
 * 四个变体（计划 §3 U0 验收列）：同任务新轮次 / 登出换用户 / 新建未获 taskId / localStorage 写失败。
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
const DRAFT_SESSION_ID_STORAGE_KEY = 'plant3d.review.draftSessionId';

type V7Annotation = { id: string; description?: string; severity?: string; screenshot?: { attachmentId?: string; url?: string } };
type V7Container = {
  version: number;
  annotations: V7Annotation[];
  cloudAnnotations: V7Annotation[];
};

type StoreSnapshot = {
  exportJSON: string;
  textIds: string[];
  cloudIds: string[];
  cloudScreenshots: (string | null)[];
  selection: string[];
  camera: number[];
};

type ScopeInfo = { scopeKey: string | null; taskId: string | null; draftSessionId: string | null; userId: string | null; reviewRound: number | null };

function reviewTask(id: string, title: string, extra: Record<string, unknown> = {}) {
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
    ...extra,
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

/** 应用侧单例：Vite dev server 下同一模块 URL 就是同一实例，测试拿到的 store / session / 用户库与面板用的是同一份 */
async function installTestBridge(page: Page) {
  await page.evaluate(async () => {
    const w = window as any;
    const [
      { useReviewStore },
      { useAnnotationDraftSession },
      { annotationScopeKey },
      { ensurePanelAndActivate },
      { onToast },
      { saveAnnotationSeverity },
      { useUserStore },
    ] = await Promise.all([
      import(/* @vite-ignore */ '/src/composables/useReviewStore.ts'),
      import(/* @vite-ignore */ '/src/composables/useAnnotationDraftSession.ts'),
      import(/* @vite-ignore */ '/src/review/domain/annotationScope.ts'),
      import(/* @vite-ignore */ '/src/composables/useDockApi.ts'),
      import(/* @vite-ignore */ '/src/ribbon/toastBus.ts'),
      import(/* @vite-ignore */ '/src/composables/useAnnotationSeveritySync.ts'),
      import(/* @vite-ignore */ '/src/composables/useUserStore.ts'),
    ]);
    const toasts: { message: string; level?: string }[] = [];
    onToast((payload: { message: string; level?: string }) => {
      toasts.push({ message: payload.message, level: payload.level });
    });
    w.__u0 = {
      reviewStore: useReviewStore(),
      userStore: useUserStore(),
      draftSession: useAnnotationDraftSession(),
      annotationScopeKey,
      ensurePanelAndActivate,
      saveAnnotationSeverity,
      toasts,
    };
  });
}

async function bootDemo(page: Page) {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await waitForDtxReady(page);
  await waitForToolStoreReady(page);
  await installTestBridge(page);
}

async function setCurrentTask(page: Page, task: ReturnType<typeof reviewTask> | null) {
  await page.evaluate((next) => {
    (window as any).__u0.reviewStore.currentTask.value = next;
  }, task);
}

async function setCurrentUserId(page: Page, userId: string | null) {
  await page.evaluate((next) => {
    (window as any).__u0.userStore.currentUserId.value = next;
  }, userId);
}

async function readScope(page: Page): Promise<ScopeInfo> {
  return page.evaluate(() => {
    const store = (window as any).__viewerToolStore;
    const scope = store.getAnnotationDraftScope();
    return {
      scopeKey: scope ? (window as any).__u0.annotationScopeKey(scope) : null,
      taskId: scope?.taskId ?? null,
      draftSessionId: scope?.draftSessionId ?? null,
      userId: scope?.userId ?? null,
      reviewRound: scope?.reviewRound ?? null,
    };
  });
}

async function waitForScope(page: Page, match: (scope: ScopeInfo) => boolean): Promise<string> {
  await expect.poll(() => readScope(page).then((s) => match(s)), { timeout: 10_000 }).toBe(true);
  const scope = await readScope(page);
  expect(scope.scopeKey).toBeTruthy();
  return scope.scopeKey as string;
}

async function waitForTaskScope(page: Page, taskId: string): Promise<string> {
  return waitForScope(page, (s) => s.taskId === taskId);
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

async function readToastCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__u0.toasts.length as number);
}

async function readToastsSince(page: Page, from: number): Promise<{ message: string }[]> {
  return page.evaluate((start) => (window as any).__u0.toasts.slice(start) as { message: string }[], from);
}

/** 打开校审面板：scope 同步随之装上，容器切到本 tab 的 session 作用域 */
async function openReviewPanel(page: Page) {
  await page.evaluate(() => (window as any).__u0.ensurePanelAndActivate('review'));
  await expect(page.locator('[data-panel="review"]')).toBeAttached({ timeout: 15_000 });
  await expect.poll(() => readScope(page).then((s) => s.draftSessionId), { timeout: 10_000 }).toBeTruthy();
}

async function addTextDraft(page: Page, draft: { id: string; title: string; description?: string; severity?: string }) {
  await page.evaluate((d) => {
    const store = (window as any).__viewerToolStore;
    store.addAnnotation({
      id: d.id,
      entityId: `o:${d.id}`,
      worldPos: [1, 0, 0],
      visible: true,
      glyph: '1',
      title: d.title,
      description: d.description ?? '',
      createdAt: Date.now(),
      refno: '=1/2',
    });
    if (d.severity) store.updateAnnotationSeverity('text', d.id, d.severity);
  }, draft);
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

/** 云线自动截图上传：POST 挂起，放行后回一个附件 */
async function installHeldUploadRoute(page: Page, attachmentId: string) {
  const upload = heldRoute(async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        attachment: {
          id: attachmentId,
          url: `/uploads/${attachmentId}.png`,
          name: `${attachmentId}.png`,
          mimeType: 'image/png',
          size: 1024,
          uploadedAt: Date.now(),
        },
      }),
    });
  });
  await page.route('**/api/review/attachments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await upload.handler(route);
  });
  return upload;
}

/** 严重度 / 标题保存：PATCH 挂起，放行后回 500（触发回滚） */
async function installHeldSeverityRoute(page: Page) {
  const severity = heldRoute(async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error_message: 'boom' }) });
  });
  await page.route('**/api/review/annotations/**', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await severity.handler(route);
  });
  return severity;
}

/** 真实框选创建一条云线，等到自动截图的上传请求发出去（还没回来）；返回云线 id */
async function createCloudAwaitingUpload(page: Page): Promise<string> {
  const point = await findPickablePoint(page);
  const before = (await readSnapshot(page)).cloudIds;
  await page.evaluate((refno) => {
    const store = (window as any).__viewerToolStore;
    store.setCloudTargetRefnos([refno]);
    store.setToolMode('annotation_cloud');
  }, point.objectId);
  const uploadRequest = page.waitForRequest((req) => req.url().includes('/api/review/attachments') && req.method() === 'POST', { timeout: 20_000 });
  await page.mouse.click(point.x, point.y);
  await drag(page, { x: point.x - 70, y: point.y - 70 }, { x: point.x + 70, y: point.y + 70 });
  await uploadRequest;
  await expect.poll(() => readSnapshot(page).then((s) => s.cloudIds.length), { timeout: 10_000 }).toBe(before.length + 1);
  const after = (await readSnapshot(page)).cloudIds;
  return after.find((id) => !before.includes(id)) as string;
}

/** 乐观改严重度并把 PATCH 挂起；结果 promise 放在 window.__u0.severitySave 上 */
async function startHeldSeveritySave(page: Page, annotationId: string, severity: string, taskId?: string) {
  const severityRequest = page.waitForRequest((req) => req.url().includes('/api/review/annotations/') && req.method() === 'PATCH', { timeout: 20_000 });
  await page.evaluate(([id, next, task]) => {
    const w = window as any;
    w.__u0.severitySave = w.__u0.saveAnnotationSeverity('text', id, next, task ? { taskId: task } : undefined);
  }, [annotationId, severity, taskId ?? null] as const);
  await severityRequest;
}

async function awaitSeveritySaveResult(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__u0.severitySave as Promise<boolean>);
}

test.describe('U0 任务隔离 · 异步回执守卫（计划 §4 V2）', () => {
  // 校审面板 + 三维查看器并排，给画布留够框选的空间
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ page }) => {
    await bootDemo(page);
  });

  test('A 的迟到截图 / 保存回执到达时已在 B：B 逐字节不变、回执归属 A、旧全局草稿只显示为未归属', async ({ page }) => {
    // ── 0. 切到任务作用域之前，旧全局容器里已经躺着一条草稿 ──
    await page.evaluate(() => (window as any).__viewerToolStore.clearAll());
    await addTextDraft(page, { id: 'legacy-1', title: '旧容器里的草稿' });
    await expect.poll(() => readContainer(page, LEGACY_SCOPE).then((c) => c?.annotations.map((a) => a.id) ?? null), { timeout: 5_000 })
      .toEqual(['legacy-1']);

    // ── 1. 打开校审面板：scope 同步装上，容器切到本 tab 的 session 作用域，旧容器从此只读 ──
    await openReviewPanel(page);
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
    const upload = await installHeldUploadRoute(page, 'att-late-A');
    const severity = await installHeldSeverityRoute(page);

    // A 里：创建一条文字批注并输说明；再创建一条云线（真实框选，触发自动截图上传）
    await addTextDraft(page, { id: 'a-text', title: 'A 的批注', description: 'A 的说明', severity: 'general' });
    const cloudId = await createCloudAwaitingUpload(page);
    // 严重度保存：乐观改成 principle，请求挂着
    await startHeldSeveritySave(page, 'a-text', 'principle', 'task-A');
    expect(upload.seenCount()).toBe(1);
    expect(severity.seenCount()).toBe(1);
    const inA = await readSnapshot(page);
    expect(inA.textIds).toEqual(['a-text']);
    expect(inA.cloudScreenshots).toEqual([null]);

    // ── 4. 两条请求都还在飞：切到 B ──
    const toastCountBeforeSwitch = await readToastCount(page);
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
    expect(await awaitSeveritySaveResult(page)).toBe(false);
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
    const toastsAfterSwitch = await readToastsSince(page, toastCountBeforeSwitch);
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

  test('变体 · 同任务新轮次：round 变了就是另一个容器，第 0 轮的迟到截图只归第 0 轮', async ({ page }) => {
    await openReviewPanel(page);
    const round0 = reviewTask('task-R', 'U0 轮次任务');
    const round1 = reviewTask('task-R', 'U0 轮次任务', { reviewRound: 1 });

    await setCurrentTask(page, round0);
    const scopeKeyR0 = await waitForScope(page, (s) => s.taskId === 'task-R' && s.reviewRound === 0);
    expect(scopeKeyR0).toContain('|round=0|');
    await addTextDraft(page, { id: 'r0-text', title: '第 0 轮的批注', description: '第 0 轮说明' });
    const upload = await installHeldUploadRoute(page, 'att-late-r0');
    const cloudId = await createCloudAwaitingUpload(page);

    // 同一任务进入第 1 轮：新容器，什么都没有；第 0 轮的两条留在第 0 轮容器里
    await setCurrentTask(page, round1);
    const scopeKeyR1 = await waitForScope(page, (s) => s.taskId === 'task-R' && s.reviewRound === 1);
    expect(scopeKeyR1).toContain('|round=1|');
    expect(scopeKeyR1).not.toBe(scopeKeyR0);
    const r1Before = await readSnapshot(page);
    expect(r1Before.textIds).toEqual([]);
    expect(r1Before.cloudIds).toEqual([]);
    expect((await readContainer(page, scopeKeyR0))?.cloudAnnotations.map((c) => c.id)).toEqual([cloudId]);

    const toastMark = await readToastCount(page);
    upload.release();
    await expect.poll(() => readContainer(page, scopeKeyR0).then((c) => c?.cloudAnnotations[0]?.screenshot?.attachmentId ?? null), { timeout: 15_000 })
      .toBe('att-late-r0');
    const r1After = await readSnapshot(page);
    expect(r1After.exportJSON).toBe(r1Before.exportJSON);
    expect((await readContainer(page, scopeKeyR1))?.cloudAnnotations ?? []).toEqual([]);
    expect((await readToastsSince(page, toastMark)).filter((t) => /截图/.test(t.message))).toEqual([]);

    // 回到第 0 轮：截图在
    await setCurrentTask(page, round0);
    await waitForScope(page, (s) => s.taskId === 'task-R' && s.reviewRound === 0);
    await expect.poll(() => readSnapshot(page).then((s) => s.cloudScreenshots), { timeout: 10_000 }).toEqual(['att-late-r0']);
    expect((await readSnapshot(page)).textIds).toEqual(['r0-text']);
  });

  test('变体 · 登出换用户：同一任务下不同用户各一个容器，登出后是 anonymous；迟到截图只归出发时那个用户', async ({ page }) => {
    await openReviewPanel(page);
    const task = reviewTask('task-U', 'U0 用户任务');
    // demo 里当前用户是 mock 用户 SJ；同一份 mock 用户表里还有 JH
    await setCurrentUserId(page, 'SJ');
    await setCurrentTask(page, task);
    const scopeKeySJ = await waitForScope(page, (s) => s.taskId === 'task-U' && s.userId === 'SJ');
    await addTextDraft(page, { id: 'sj-text', title: 'SJ 的批注' });
    const upload = await installHeldUploadRoute(page, 'att-late-sj');
    const cloudId = await createCloudAwaitingUpload(page);

    // 换成 JH：同任务、另一个容器，里面什么都没有
    await setCurrentUserId(page, 'JH');
    const scopeKeyJH = await waitForScope(page, (s) => s.taskId === 'task-U' && s.userId === 'JH');
    expect(scopeKeyJH).not.toBe(scopeKeySJ);
    const jhBefore = await readSnapshot(page);
    expect(jhBefore.textIds).toEqual([]);
    expect(jhBefore.cloudIds).toEqual([]);
    expect((await readContainer(page, scopeKeySJ))?.cloudAnnotations.map((c) => c.id)).toEqual([cloudId]);

    const toastMark = await readToastCount(page);
    upload.release();
    await expect.poll(() => readContainer(page, scopeKeySJ).then((c) => c?.cloudAnnotations[0]?.screenshot?.attachmentId ?? null), { timeout: 15_000 })
      .toBe('att-late-sj');
    expect((await readSnapshot(page)).exportJSON).toBe(jhBefore.exportJSON);
    expect((await readContainer(page, scopeKeyJH))?.cloudAnnotations ?? []).toEqual([]);
    expect((await readToastsSince(page, toastMark)).filter((t) => /截图/.test(t.message))).toEqual([]);

    // 登出：用户成了 anonymous，又是一个空容器；SJ / JH 的都不在这里
    await setCurrentUserId(page, null);
    const scopeKeyAnon = await waitForScope(page, (s) => s.taskId === 'task-U' && s.userId === 'anonymous');
    expect(scopeKeyAnon).not.toBe(scopeKeySJ);
    expect(scopeKeyAnon).not.toBe(scopeKeyJH);
    expect((await readSnapshot(page)).textIds).toEqual([]);

    // 再以 SJ 登录：自己的草稿和迟到的截图都在
    await setCurrentUserId(page, 'SJ');
    await waitForScope(page, (s) => s.taskId === 'task-U' && s.userId === 'SJ');
    await expect.poll(() => readSnapshot(page).then((s) => s.cloudScreenshots), { timeout: 10_000 }).toEqual(['att-late-sj']);
    expect((await readSnapshot(page)).textIds).toEqual(['sj-text']);
  });

  test('变体 · 新建未获 taskId：草稿落本 tab 的 session 容器，不进旧全局容器；迟到回滚只归 session；刷新不丢', async ({ page }) => {
    await openReviewPanel(page);
    const scope0 = await readScope(page);
    expect(scope0.taskId).toBeNull();
    expect(scope0.draftSessionId).toBeTruthy();
    const scopeKeySession = scope0.scopeKey as string;
    expect(scopeKeySession).toContain(`|session=${scope0.draftSessionId}|`);
    const storedSessionId = await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_SESSION_ID_STORAGE_KEY);
    expect(storedSessionId).toBe(scope0.draftSessionId);

    // 没有任务时创建的草稿：进 session 容器，旧全局容器没有它
    await addTextDraft(page, { id: 'new-form-text', title: '新单据的批注', description: '还没拿到 taskId', severity: 'general' });
    await expect.poll(() => readContainer(page, scopeKeySession).then((c) => c?.annotations.map((a) => a.id) ?? null), { timeout: 5_000 })
      .toEqual(['new-form-text']);
    expect((await readContainer(page, LEGACY_SCOPE))?.annotations ?? []).toEqual([]);

    // 保存挂着，人进了任务 A；回执（失败 → 回滚）只能写进 session 容器
    const severity = await installHeldSeverityRoute(page);
    await startHeldSeveritySave(page, 'new-form-text', 'principle');
    const taskA = reviewTask('task-A', 'U0 任务 A');
    await setCurrentTask(page, taskA);
    const scopeKeyA = await waitForTaskScope(page, 'task-A');
    expect(scopeKeyA).not.toBe(scopeKeySession);
    const aBefore = await readSnapshot(page);
    expect(aBefore.textIds).toEqual([]);
    expect((await readContainer(page, scopeKeySession))?.annotations.map((a) => [a.id, a.severity])).toEqual([['new-form-text', 'principle']]);

    const toastMark = await readToastCount(page);
    severity.release();
    expect(await awaitSeveritySaveResult(page)).toBe(false);
    await expect.poll(() => readContainer(page, scopeKeySession).then((c) => c?.annotations[0]?.severity ?? null), { timeout: 15_000 }).toBe('general');
    expect((await readSnapshot(page)).exportJSON).toBe(aBefore.exportJSON);
    expect((await readToastsSince(page, toastMark)).filter((t) => /严重度|回滚/.test(t.message))).toEqual([]);

    // 回到没有任务：session 容器载回来
    await setCurrentTask(page, null);
    await waitForScope(page, (s) => s.taskId === null && s.draftSessionId === scope0.draftSessionId);
    await expect.poll(() => readSnapshot(page).then((s) => s.textIds), { timeout: 10_000 }).toEqual(['new-form-text']);

    // 同一 tab 刷新：draftSessionId 从 sessionStorage 回来，还是同一个容器，草稿不丢
    await bootDemo(page);
    await openReviewPanel(page);
    const scopeAfterReload = await readScope(page);
    expect(scopeAfterReload.draftSessionId).toBe(scope0.draftSessionId);
    expect(scopeAfterReload.scopeKey).toBe(scopeKeySession);
    await expect.poll(() => readSnapshot(page).then((s) => s.textIds), { timeout: 10_000 }).toEqual(['new-form-text']);
    expect(await page.evaluate(() => (window as any).__viewerToolStore.annotations.value[0]?.severity ?? null)).toBe('general');
  });

  test('变体 · localStorage 写失败：状态条报「本机写入失败」+ 原因，恢复后回到已存；写不进去的迟到截图删附件不留孤儿', async ({ page }) => {
    await openReviewPanel(page);
    const taskA = reviewTask('task-A', 'U0 任务 A');
    const taskB = reviewTask('task-B', 'U0 任务 B');
    await setCurrentTask(page, taskA);
    const scopeKeyA = await waitForTaskScope(page, 'task-A');
    const localRow = page.locator('[data-testid="annotation-draft-status-local"]');
    await expect(localRow).toBeVisible({ timeout: 15_000 });
    // 进任务时容器能写：不管此刻是「无草稿」还是「已存 · 未落库」，都不是写失败
    await expect(localRow).not.toHaveAttribute('data-state', 'write-failed');
    await expect(localRow).not.toHaveAttribute('data-state', 'unsaved');

    // 让本机容器写不进去（模拟配额满）
    await page.evaluate((prefix) => {
      const w = window as any;
      w.__u0.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function patched(this: Storage, key: string, value: string) {
        if (String(key).startsWith(prefix)) {
          const err = new Error('QuotaExceededError: 模拟本机存储配额已满');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return w.__u0.originalSetItem.call(this, key, value);
      };
    }, V7_PREFIX);
    await addTextDraft(page, { id: 'quota-text', title: '写不进去的批注' });
    await expect(localRow).toHaveAttribute('data-state', 'write-failed', { timeout: 10_000 });
    await expect(localRow).toContainText('本机写入失败');
    await expect(localRow).toContainText('配额已满');
    // 内存里有，容器里没有
    expect((await readSnapshot(page)).textIds).toEqual(['quota-text']);
    expect((await readContainer(page, scopeKeyA))?.annotations ?? []).toEqual([]);

    // 恢复存储：下一次内容变化就写进去，状态回到已存
    await page.evaluate(() => {
      const w = window as any;
      Storage.prototype.setItem = w.__u0.originalSetItem;
    });
    await addTextDraft(page, { id: 'quota-text-2', title: '恢复后的批注' });
    await expect(localRow).toHaveAttribute('data-state', /^saved/, { timeout: 10_000 });
    await expect.poll(() => readContainer(page, scopeKeyA).then((c) => c?.annotations.map((a) => a.id) ?? null), { timeout: 5_000 })
      .toEqual(['quota-text', 'quota-text-2']);

    // 迟到截图回来时出发的那个容器写不进去：删掉刚上传的附件，不留孤儿，也不碰当前任务
    const upload = await installHeldUploadRoute(page, 'att-late-quota');
    const deleted: string[] = [];
    await page.route('**/api/review/attachments/*', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      deleted.push(route.request().url());
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    const cloudId = await createCloudAwaitingUpload(page);
    await setCurrentTask(page, taskB);
    await waitForTaskScope(page, 'task-B');
    expect((await readContainer(page, scopeKeyA))?.cloudAnnotations.map((c) => c.id)).toEqual([cloudId]);
    const bBefore = await readSnapshot(page);
    await page.evaluate((prefix) => {
      const w = window as any;
      Storage.prototype.setItem = function patched(this: Storage, key: string, value: string) {
        if (String(key).startsWith(prefix)) throw new Error('QuotaExceededError: 模拟本机存储配额已满');
        return w.__u0.originalSetItem.call(this, key, value);
      };
    }, V7_PREFIX);
    upload.release();
    await expect.poll(() => deleted.length, { timeout: 15_000 }).toBe(1);
    expect(deleted[0]).toContain('/api/review/attachments/att-late-quota');
    expect((await readContainer(page, scopeKeyA))?.cloudAnnotations[0]?.screenshot ?? null).toBeNull();
    expect((await readSnapshot(page)).exportJSON).toBe(bBefore.exportJSON);
    await page.evaluate(() => {
      const w = window as any;
      Storage.prototype.setItem = w.__u0.originalSetItem;
    });
  });
});
