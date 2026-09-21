/**
 * 版本对比 · gen-model-v1 源真机回归（ADR 0065 / gen-model-refactor ADR-081）。
 *
 * 由 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/` 那次一次性 Playwright 脚本整理而来，检查点逐条对应
 * 那份 README §2：URL `compare_autorun` 自动开面板 → 版本表 → 自动选 A/B → 对比结果 → ViewerPanel 两侧对象数 → 单视口切 A →
 * 双视口分屏 → 模型树差异模式（幽灵节点挂回原父）→ 关闭时 `DELETE` 历史快照、差异模式退出。
 *
 * 数字一律**取自服务端** `GET /api/v1/model/versions` 的回执（版本数、A/B 的 sesno、末版是不是 tombstone），不写死：
 * 夹具 EQUI 24384/26480（dbnum 8000）是 ADR-076 S5 那台「新建 → 挪 → DELETE」的现场，会话链只增不改，所以它的版本表稳定；
 * 换个项目就换 `MODEL_VERSION_E2E_UNIT` / `MODEL_VERSION_E2E_DBNUM`，用例按回执自适应。
 *
 * 前置：gen-model 在 `GEN_MODEL_V1_BASE_URL`（缺省 `http://127.0.0.1:8022`）且带 `model/versions` 路由（ef2284f12 起），
 * 该单元至少两版；页面走 Playwright `baseURL` 的 Vite dev server。不满足就整文件跳过。
 *
 * 状态：2026-09-18 15:5x 对 :8022（d47d747fd）+ dev :3111 真机跑过（同一批检查点，见上面那份 README）；
 * 2026-09-19 10:2x 跟着 `061c83b2`（面板升级成「节点版本」）改了选版那几条断言——A / B 不再是两个 `<select>`，
 * 而是版本时间线上的徽章（`model-unit-compare-a/b` 的 `data-sesno`）+ 每行一对 A / B 按钮，其余检查点原样。
 */
import { expect, test, type Page } from '@playwright/test';

const GEN_MODEL_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const UNIT = process.env.MODEL_VERSION_E2E_UNIT || '24384_26480';
const DBNUM = Number(process.env.MODEL_VERSION_E2E_DBNUM || '8000');
const PROJECT = process.env.MODEL_VERSION_E2E_PROJECT || 'AvevaMarineSample';

type VersionRow = { sesno: number; session_time: string | null; impact_kind: string };
type VersionsResponse = { unit_noun: string; file_latest_sesno: number; truncated: boolean; versions: VersionRow[] };

test.setTimeout(300_000);

let versions: VersionRow[] = [];

/** 门：服务在、有 `model/versions` 路由、夹具单元至少两版。数字留给用例用。 */
async function probe(): Promise<string | null> {
  try {
    const health = await fetch(`${GEN_MODEL_BASE}/api/v1/health`);
    if (!health.ok) return `gen-model health HTTP ${health.status}（${GEN_MODEL_BASE}）`;
  } catch {
    return `gen-model 不在 ${GEN_MODEL_BASE}`;
  }
  const url = `${GEN_MODEL_BASE}/api/v1/model/versions?dbnum=${DBNUM}&refno=${UNIT.replace('_', '/')}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    return `model/versions 打不通：${String(error)}`;
  }
  if (response.status === 404) return `服务没有 model/versions 路由或单元 ${UNIT} 不在 dbnum ${DBNUM}（HTTP 404）——要 gen-model-refactor ef2284f12 起的构建`;
  if (!response.ok) return `model/versions HTTP ${response.status}`;
  const body = await response.json() as VersionsResponse;
  versions = body.versions ?? [];
  if (versions.length < 2) return `单元 ${UNIT} 只有 ${versions.length} 版，不够对比`;
  return null;
}

test.beforeEach(async () => {
  const reason = await probe();
  test.skip(reason !== null, reason ?? '');
});

type ViewerCompareState = {
  beforeSesno: number;
  afterSesno: number;
  beforeObjects: number;
  afterObjects: number;
  activeSide: string;
  viewMode: string;
};

type OpenedPage = {
  pageErrors: string[];
  historyRequests: { method: string; url: string }[];
  /** 右侧「属性」面板拉当前会话的请求；差异模式里选中幽灵构件时这里必须一条都没有（发了只会 404） */
  elementAttributeRequests: string[];
};

async function openComparePage(page: Page, extra: Record<string, string>): Promise<OpenedPage> {
  const pageErrors: string[] = [];
  const historyRequests: { method: string; url: string }[] = [];
  const elementAttributeRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (/\/api\/v1\/model\/history\//.test(request.url())) historyRequests.push({ method: request.method(), url: request.url() });
    if (/\/api\/v1\/element\/attributes/.test(request.url())) elementAttributeRequests.push(request.postData() ?? '');
  });

  // 掐掉 Vite HMR：别的会话改代码时 dev server 会 full-reload，把半路的对比冲掉
  const devHost = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:3101').host;
  await page.routeWebSocket((url) => url.host === devHost, () => {
    // 不 connectToServer
  });

  const params = new URLSearchParams({
    model_source: 'gen-model-v1',
    gm_backend: GEN_MODEL_BASE,
    output_project: PROJECT,
    unit_refno: UNIT,
    compare_autorun: '1',
    ...extra,
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('model-unit-version-compare-panel')).toBeVisible({ timeout: 60_000 });
  return { pageErrors, historyRequests, elementAttributeRequests };
}

/** 相机先停到这个远点，再点「在 3D 中定位」——找不到构件时 `focusModelUnitVersionCompare` 直接 return，相机纹丝不动。 */
const PARKED_CAMERA = { x: 53_279, y: 62_579, z: 58_750 };

async function parkCamera(page: Page): Promise<void> {
  await page.evaluate((parked) => {
    const viewer = (window as unknown as { __dtxViewer?: { camera: { position: { set(x: number, y: number, z: number): void } }; controls: { target: { set(x: number, y: number, z: number): void }; update(): void } } }).__dtxViewer;
    if (!viewer) throw new Error('__dtxViewer 不在 window 上（只有 dev 构建才挂）');
    viewer.camera.position.set(parked.x, parked.y, parked.z);
    viewer.controls.target.set(0, 0, 0);
    viewer.controls.update();
  }, PARKED_CAMERA);
}

/** 相机离停放点多远；> 1 即「定位按钮真的把镜头飞过去了」 */
function cameraDistanceFromParked(page: Page): Promise<number> {
  return page.evaluate((parked) => {
    const position = (window as unknown as { __dtxViewer?: { camera: { position: { x: number; y: number; z: number } } } }).__dtxViewer?.camera.position;
    if (!position) return 0;
    return Math.hypot(position.x - parked.x, position.y - parked.y, position.z - parked.z);
  }, PARKED_CAMERA);
}

async function waitForCompare(page: Page): Promise<ViewerCompareState> {
  await expect(page.getByTestId('model-unit-compare-summary')).toBeVisible({ timeout: 240_000 });
  await page.waitForFunction(
    () => typeof (window as unknown as { __modelUnitVersionCompare?: { beforeObjects?: number } }).__modelUnitVersionCompare?.beforeObjects === 'number',
    null,
    { timeout: 120_000 },
  );
  return page.evaluate(() => (window as unknown as { __modelUnitVersionCompare: ViewerCompareState }).__modelUnitVersionCompare);
}

function summaryCounts(text: string): { added: number; deleted: number; modified: number; unchanged: number } {
  const pick = (label: string) => Number(new RegExp(`${label}\\s*(\\d+)`).exec(text)?.[1] ?? '-1');
  return { added: pick('新增'), deleted: pick('删除'), modified: pick('修改'), unchanged: pick('未变') };
}

test('缺省最近两版：compare_autorun 开面板、版本表来自服务端、A/B 自动选最近两版、对比结果与两侧对象数自洽、分屏、树差异、关闭 DELETE 快照', async ({ page }) => {
  const a = versions.at(-2)!;
  const b = versions.at(-1)!;
  const { pageErrors, historyRequests } = await openComparePage(page, {});

  // 版本表：条数与服务端回执一致，时间线每一行带 sesno 与 impact_kind
  const timelineRow = (sesno: number) => page.locator(`[data-testid="model-unit-compare-timeline"] > li[data-sesno="${sesno}"]`);
  await expect(page.locator('[data-testid="model-unit-compare-timeline"] > li')).toHaveCount(versions.length, { timeout: 120_000 });
  for (const version of versions) {
    await expect(timelineRow(version.sesno)).toContainText(version.impact_kind);
  }
  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(a.sesno));
  await expect(page.getByTestId('model-unit-compare-b')).toHaveAttribute('data-sesno', String(b.sesno));

  // 对比跑完：摘要四格都在；tombstone 末版 = 全部删除、B 侧 0 对象
  const state = await waitForCompare(page);
  const counts = summaryCounts((await page.getByTestId('model-unit-compare-summary').textContent()) ?? '');
  expect(Object.values(counts).every((n) => n >= 0)).toBe(true);
  expect(state.beforeSesno).toBe(a.sesno);
  expect(state.afterSesno).toBe(b.sesno);
  if (b.impact_kind === 'tombstone') {
    expect(counts.added).toBe(0);
    expect(counts.modified).toBe(0);
    expect(counts.deleted).toBeGreaterThan(0);
    expect(state.afterObjects).toBe(0);
    await expect(page.getByTestId('model-unit-compare-show-after')).toContainText('该版本单元已删除');
  } else {
    expect(state.afterObjects).toBeGreaterThan(0);
  }
  if (a.impact_kind !== 'tombstone') expect(state.beforeObjects).toBeGreaterThan(0);

  // 视口角标：单视口缺省显 B，角标跟 activeSide；图例四格与面板摘要同一份 rows（ADR 0066 三维联动）
  await expect(page.getByTestId('viewer-model-unit-side-badge')).toContainText(`B · sesno ${b.sesno}`);
  const legend = page.getByTestId('viewer-model-unit-compare-legend');
  await expect(legend).toContainText(`修改 ${counts.modified}`);
  await expect(legend).toContainText(`新增 ${counts.added}`);
  await expect(legend).toContainText(`删除 ${counts.deleted}`);
  await expect(legend).toContainText(`未变 ${counts.unchanged}`);
  // 「三维只看差异」（开关在面板「三维查看」节，视口图例只读回显）：有差异才能开；开 / 关都要在运行态与图例上看得见
  const hasDifference = counts.added + counts.deleted + counts.modified > 0;
  const panelDiffOnly = page.getByTestId('model-unit-compare-diff-only');
  if (hasDifference) {
    await expect(panelDiffOnly).toBeEnabled();
    await panelDiffOnly.click();
    await page.waitForFunction(() => (window as unknown as { __modelUnitVersionCompare?: { diffOnly?: boolean } }).__modelUnitVersionCompare?.diffOnly === true);
    await expect(legend).toHaveAttribute('data-diff-only', 'true');
    await expect(page.getByTestId('viewer-model-unit-compare-diff-only-tag')).toBeVisible();
    await panelDiffOnly.click();
    await page.waitForFunction(() => (window as unknown as { __modelUnitVersionCompare?: { diffOnly?: boolean } }).__modelUnitVersionCompare?.diffOnly === false);
    await expect(legend).toHaveAttribute('data-diff-only', 'false');
    await expect(page.getByTestId('viewer-model-unit-compare-diff-only-tag')).toHaveCount(0);
  } else {
    await expect(panelDiffOnly).toBeDisabled();
  }

  // 单视口切到 A，再进双视口分屏
  await page.getByTestId('model-unit-compare-show-before').click();
  await page.waitForFunction(() => (window as unknown as { __modelUnitVersionCompare?: { activeSide?: string } }).__modelUnitVersionCompare?.activeSide === 'before');
  await expect(page.getByTestId('viewer-model-unit-side-badge')).toContainText(`A · sesno ${a.sesno}`);
  await page.getByTestId('model-unit-compare-split-mode').click();
  await expect(page.getByTestId('model-unit-compare-split-summary')).toContainText(`左 A · sesno ${a.sesno}`);
  await expect(page.getByTestId('model-unit-compare-split-summary')).toContainText(`右 B · sesno ${b.sesno}`);
  await expect(page.getByTestId('viewer-model-unit-split-overlay')).toContainText(`A · sesno ${a.sesno}`);
  await expect(page.getByTestId('viewer-model-unit-split-overlay')).toContainText(`B · sesno ${b.sesno}`);
  await expect(page.getByTestId('viewer-model-unit-side-badge')).toHaveCount(0);

  // 模型树差异模式：桥接事件把非 unchanged 行送进树；tombstone 时单元根自己也进树
  await expect(page.getByTestId('model-tree-diff-bar')).toBeVisible();
  await expect(page.getByTestId('model-tree-diff-version-pill')).toContainText(`${a.sesno} → ${b.sesno}`);
  const changed = counts.added + counts.deleted + counts.modified + (b.impact_kind === 'tombstone' ? 1 : 0);
  await expect(page.getByTestId('model-tree-diff-chip-all')).toContainText(String(changed));
  // 幽灵节点挂回原父（anc 链）：没有「未能定位」提示
  await expect(page.getByTestId('model-tree-diff-unplaced')).toHaveCount(0);
  // 变更行自动定位到可见，不用手动点开容器：非删除节点展开到自身；删除节点的幽灵行挂在最近存活祖先下，
  // 且那个祖先自己也被展开（2026-09-18 真机 602→604：ZONE 挂着「2」却收着，幽灵行一行都看不见）
  await expect(page.getByTestId('model-tree-diff-resolving')).toHaveCount(0, { timeout: 60_000 });
  const badgeRows = page.locator('[data-testid="model-tree-row"][data-diff-status]');
  await expect(badgeRows.first()).toBeVisible({ timeout: 30_000 });
  if (b.impact_kind === 'tombstone') {
    const ghostRow = page.locator('[data-testid="model-tree-row"][data-ghost="true"]').first();
    await expect(ghostRow).toBeVisible();
    // B 版把它删了 → 行尾「已删除」（「当前已不在」是另一回事：B 版还在、之后才被删，见下面那条）
    await expect(ghostRow).toContainText('已删除');
    // 幽灵行进选中不得去拉当前会话的属性（拉了只会 404）
    await expect(page.getByTestId('properties-deleted-notice')).toBeVisible();
    // 「在 3D 中定位」：被删的构件只在 A 层有，两层并起来才找得到；找不到时相机不动
    await parkCamera(page);
    await page.getByTestId('attr-diff-locate').click();
    await expect.poll(() => cameraDistanceFromParked(page), { timeout: 15_000 }).toBeGreaterThan(1);
  }

  // 关闭：每份生成过的历史快照各一条 DELETE；差异模式退出
  const generated = historyRequests.filter((r) => r.method === 'POST' && /history\/generate/.test(r.url)).length;
  expect(generated).toBe([a, b].filter((v) => v.impact_kind !== 'tombstone').length);
  await page.getByTestId('model-unit-compare-close').click();
  await expect.poll(() => historyRequests.filter((r) => r.method === 'DELETE').length, { timeout: 15_000 }).toBe(generated);
  await expect(page.getByTestId('model-tree-diff-bar')).toHaveCount(0);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('compare_a / compare_b 指定两版：按 URL 选中、两侧都有几何时对象数都 > 0、结果非空', async ({ page }) => {
  const withGeometry = versions.filter((v) => v.impact_kind !== 'tombstone');
  test.skip(withGeometry.length < 2, `单元 ${UNIT} 有几何的版本不足两版`);
  const a = withGeometry[0]!;
  const b = withGeometry.at(-1)!;
  const { pageErrors, historyRequests } = await openComparePage(page, { compare_a: String(a.sesno), compare_b: String(b.sesno) });

  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(a.sesno), { timeout: 120_000 });
  await expect(page.getByTestId('model-unit-compare-b')).toHaveAttribute('data-sesno', String(b.sesno));
  const state = await waitForCompare(page);
  expect(state.beforeSesno).toBe(a.sesno);
  expect(state.afterSesno).toBe(b.sesno);
  expect(state.beforeObjects).toBeGreaterThan(0);
  expect(state.afterObjects).toBeGreaterThan(0);
  const counts = summaryCounts((await page.getByTestId('model-unit-compare-summary').textContent()) ?? '');
  // 两版之间至少有一处不同（否则服务端不会把它们都列成版本）；未变行不进树
  expect(counts.added + counts.deleted + counts.modified).toBeGreaterThan(0);
  await expect(page.getByTestId('model-unit-compare-error')).toHaveCount(0);
  await expect(page.getByTestId('model-tree-diff-version-pill')).toContainText(`${a.sesno} → ${b.sesno}`);

  await page.getByTestId('model-unit-compare-close').click();
  await expect.poll(() => historyRequests.filter((r) => r.method === 'DELETE').length, { timeout: 15_000 }).toBe(2);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

/**
 * 「B 版还在、当前会话已不在」的构件要另找一个现场：ams8000 里 EQUI `/1-LNR-Q005-PJ` = 24384/24776 下的
 * BOX 24384/26495 —— 628 建、632 又删。换库就跳过（不写死存在性）。
 */
const GHOST_UNIT = process.env.MODEL_VERSION_E2E_GHOST_UNIT || '24384_24776';
const GHOST_A = Number(process.env.MODEL_VERSION_E2E_GHOST_A || '618');
const GHOST_B = Number(process.env.MODEL_VERSION_E2E_GHOST_B || '628');

async function ghostFixtureReason(): Promise<string | null> {
  const url = `${GEN_MODEL_BASE}/api/v1/model/versions?dbnum=${DBNUM}&refno=${GHOST_UNIT.replace('_', '/')}`;
  let body: VersionsResponse;
  try {
    const response = await fetch(url);
    if (!response.ok) return `夹具单元 ${GHOST_UNIT} 版本表 HTTP ${response.status}`;
    body = await response.json() as VersionsResponse;
  } catch (error) {
    return `夹具单元 ${GHOST_UNIT} 版本表打不通：${String(error)}`;
  }
  const sesnos = new Set((body.versions ?? []).map((row) => row.sesno));
  if (!sesnos.has(GHOST_A) || !sesnos.has(GHOST_B)) {
    return `夹具单元 ${GHOST_UNIT} 没有 ${GHOST_A} / ${GHOST_B} 这两版——这条要「B 版新增、之后又被删」的现场`;
  }
  return null;
}

test('B 版之后又被删的构件：幽灵行标「当前已不在」且徽章仍是「增」、属性面板不拉当前会话、「在 3D 中定位」照样找得到', async ({ page }) => {
  const reason = await ghostFixtureReason();
  test.skip(reason !== null, reason ?? '');

  const { pageErrors, elementAttributeRequests } = await openComparePage(page, {
    unit_refno: GHOST_UNIT,
    compare_a: String(GHOST_A),
    compare_b: String(GHOST_B),
  });
  await waitForCompare(page);
  await expect(page.getByTestId('model-tree-diff-resolving')).toHaveCount(0, { timeout: 60_000 });

  // 树：解析不到它自己 → 按幽灵行挂到最近存活的祖先，徽章保留「增」、行尾标「当前已不在」，不再计「未能定位」
  const ghostRow = page.locator('[data-testid="model-tree-row"][data-diff-status="added"][data-ghost="true"]').first();
  await expect(ghostRow).toBeVisible({ timeout: 30_000 });
  await expect(ghostRow).toContainText('当前已不在');
  await expect(page.getByTestId('model-tree-diff-unplaced')).toHaveCount(0);

  // 右侧「属性」面板：当前会话里没有这个构件，给提示而不是去拉（拉了就是 404 红条）
  await ghostRow.click();
  await expect(page.getByTestId('properties-deleted-notice')).toBeVisible();
  expect(elementAttributeRequests, elementAttributeRequests.join('\n')).toEqual([]);

  // 「在 3D 中定位」：A / B 两个隔离图层并起来找（这个构件只在 B 层有），找不到时相机不动
  await parkCamera(page);
  await page.getByTestId('attr-diff-locate').click();
  await expect.poll(() => cameraDistanceFromParked(page), { timeout: 15_000 }).toBeGreaterThan(1);
  // 定位不得把「已删除」登记换成普通选中（换了就又去拉当前会话）
  await expect(page.getByTestId('properties-deleted-notice')).toBeVisible();
  expect(elementAttributeRequests, elementAttributeRequests.join('\n')).toEqual([]);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('URL 指定的版本不在版本表里：回落最近两版并在面板里说明', async ({ page }) => {
  const bogus = versions.at(-1)!.sesno + 100_000;
  await openComparePage(page, { compare_a: String(bogus), compare_b: String(versions.at(-1)!.sesno) });
  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(versions.at(-2)!.sesno), { timeout: 120_000 });
  await waitForCompare(page);
  await expect(page.getByTestId('model-unit-compare-error')).toContainText(`compare_a=${bogus}`);
  await page.getByTestId('model-unit-compare-close').click();
});
