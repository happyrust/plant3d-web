/**
 * 节点版本视图 · gen-model-v1 源真机回归（ADR 0066；后端 gen-model-refactor ADR-081 追记二 / 三）。
 *
 * 与 `model-version-compare-gen-model-v1.spec.ts` 的分工：那份守的是「单元 A / B 对比」这条老路（自动开面板 → 版本表 →
 * 对比 → 视口 → 树差异 → 关闭 DELETE 快照）；这份守 2026-09-18 起面板升级成「节点版本」之后多出来的那些：
 * 属性变化时间线（user / comment / 属性 n）、对比范围开关、属性对比 tab 的净差、容器节点的子树时间线（`node/versions`）、
 * 差异摘要与按单元分组的三维对比。
 *
 * 数字一律**取自服务端回执**，不写死：`element/versions` / `node/versions` 的行数、`diff-summary` 的单元数。夹具是 ams8000
 * 09-18 那三条腿留下的现场（FTUB 24384/23262 抬管 626 / 回 630，EQUI 24384/24776 加 BOX 628 / 删 632）：
 * 叶子 `NODE_VERSION_E2E_LEAF`（FTUB）与容器 `NODE_VERSION_E2E_CONTAINER`（SITE 24384/22399）。
 *
 * 前置：gen-model 在 `GEN_MODEL_V1_BASE_URL`（缺省 `http://127.0.0.1:8022`）且带 `node/versions`（gen-model-refactor a382b2cf3 起）；
 * 页面走 Playwright `baseURL` 的 Vite dev server。不满足就整文件跳过。`NODE_VERSION_E2E_EVIDENCE=<目录>` 时落截图 + 数字 JSON。
 *
 * 2026-09-22 按 09-21 收口计划补的真机断言：时间线两个勾选（P1-a）、属性对比 tab 每行「定位」（P1-b）、时间线缺省折 20 行（P1-c）、
 * 容器 `compare_a / compare_b` URL 直达套到子树时间线（P3-a）、多单元一起进三维 + A / B 卡列这一侧不存在的单元（P2-a）、
 * 换组分屏保持（P3-b）——后三条在第三个用例，夹具 PIPE `NODE_VERSION_E2E_MULTI_CONTAINER`（缺省 24384/23225，300 → 380 里 5 个单元变过）。
 * 阈值确认框（P2-b）要 > 20 组，ams8000 任何一段都到不了（SITE 全程 5 → 632 才 8 组），只在单测里。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const GEN_MODEL_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const DBNUM = Number(process.env.NODE_VERSION_E2E_DBNUM || '8000');
const PROJECT = process.env.NODE_VERSION_E2E_PROJECT || 'AvevaMarineSample';
const LEAF = process.env.NODE_VERSION_E2E_LEAF || '24384_23262';
const CONTAINER = process.env.NODE_VERSION_E2E_CONTAINER || '24384_22399';
/** 多单元一起进三维的夹具：容器 + 一段里 2..20 个单元变过的 A → B（README §8.4 那根管道：改 1 / 删 2 / 增 2） */
const MULTI_CONTAINER = process.env.NODE_VERSION_E2E_MULTI_CONTAINER || '24384_23225';
const MULTI_A = Number(process.env.NODE_VERSION_E2E_MULTI_A || '300');
const MULTI_B = Number(process.env.NODE_VERSION_E2E_MULTI_B || '380');
const EVIDENCE_DIR = process.env.NODE_VERSION_E2E_EVIDENCE || '';

type ElementVersionRow = { sesno: number; element_impact: string | null; unit_impact: string | null };
type ElementVersionsResponse = { noun: string; unit_root: string | null; versions: ElementVersionRow[]; truncated: boolean };
type NodeVersionRow = { sesno: number; impact: string; self_impact: string | null; units_changed: number };
type NodeVersionsResponse = { noun: string; unit_root: string | null; versions: NodeVersionRow[]; truncated: boolean };
type HistoryEntry = { sesno: number; user: string; comment: string; impact: string | null; changed_count: number; changes: { name: string }[] };
type HistoryResponse = { entries: HistoryEntry[] };
type DiffSummaryResponse = {
  units: { changed: number; unchanged: number; total: number };
  groups: { unit_root: string | null; unit_noun: string | null; geometry_changed: boolean; rows: { refno: string; status: string }[] }[];
  needs_confirm?: boolean;
};

test.setTimeout(420_000);

const slash = (refno: string) => refno.replace('_', '/');
const underscore = (refno: string) => refno.replace('/', '_');

async function getJson<T>(pathAndQuery: string): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${GEN_MODEL_BASE}/api/v1/${pathAndQuery}`);
  if (!response.ok) return { status: response.status, body: null };
  return { status: response.status, body: await response.json() as T };
}

let leafVersions: ElementVersionsResponse | null = null;
let leafHistory: HistoryResponse | null = null;
let containerSubtree: NodeVersionsResponse | null = null;
let containerSelf: NodeVersionsResponse | null = null;
let containerHistory: HistoryResponse | null = null;

/** 门：服务在、三条新路由都在、夹具形状够用。数字留给用例。 */
async function probe(): Promise<string | null> {
  try {
    const health = await fetch(`${GEN_MODEL_BASE}/api/v1/health`);
    if (!health.ok) return `gen-model health HTTP ${health.status}（${GEN_MODEL_BASE}）`;
  } catch {
    return `gen-model 不在 ${GEN_MODEL_BASE}`;
  }
  const subtree = await getJson<NodeVersionsResponse>(`node/versions?dbnum=${DBNUM}&refno=${slash(CONTAINER)}&scope=subtree&limit=5000`);
  if (subtree.status === 404) return '服务没有 node/versions 路由——要 gen-model-refactor a382b2cf3 起的构建';
  if (!subtree.body) return `node/versions HTTP ${subtree.status}`;
  if (subtree.body.unit_root !== null) return `${CONTAINER} 不是容器（所属单元 ${subtree.body.unit_root}），换一个 SITE / ZONE`;
  containerSubtree = subtree.body;
  containerSelf = (await getJson<NodeVersionsResponse>(`node/versions?dbnum=${DBNUM}&refno=${slash(CONTAINER)}&scope=self&limit=5000`)).body;
  containerHistory = (await getJson<HistoryResponse>(`element/attribute-history?dbnum=${DBNUM}&refno=${slash(CONTAINER)}&limit=5000`)).body;
  const versions = await getJson<ElementVersionsResponse>(`element/versions?dbnum=${DBNUM}&refno=${slash(LEAF)}&limit=5000`);
  if (!versions.body) return `element/versions HTTP ${versions.status}`;
  if (!versions.body.unit_root) return `${LEAF} 不在任何单元下，换一个构件当叶子夹具`;
  leafVersions = versions.body;
  const history = await getJson<HistoryResponse>(`element/attribute-history?dbnum=${DBNUM}&refno=${slash(LEAF)}&limit=5000`);
  if (history.status === 404) return '服务没有 element/attribute-history 路由——要 gen-model-refactor 2069a887a 起的构建';
  if (!history.body) return `element/attribute-history HTTP ${history.status}`;
  leafHistory = history.body;
  const selfRows = leafVersions.versions.filter((row) => row.element_impact !== null);
  if (selfRows.length < 2) return `${LEAF} 自身只变过 ${selfRows.length} 版，不够折净差`;
  if ((containerSubtree.versions.length) < 3) return `${CONTAINER} 子树只有 ${containerSubtree.versions.length} 版`;
  return null;
}

test.beforeEach(async () => {
  const reason = await probe();
  test.skip(reason !== null, reason ?? '');
});

type Opened = { pageErrors: string[]; apiRequests: { method: string; url: string }[] };

async function openPanel(page: Page, refno: string, extra: Record<string, string> = {}): Promise<Opened> {
  const pageErrors: string[] = [];
  const apiRequests: { method: string; url: string }[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (/\/api\/v1\/(node|element|model)\//.test(request.url())) apiRequests.push({ method: request.method(), url: request.url() });
  });
  const devHost = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:3101').host;
  await page.routeWebSocket((url) => url.host === devHost, () => {
    // 掐掉 Vite HMR：别的会话改代码时 dev server 会 full-reload，把半路的对比冲掉
  });
  const params = new URLSearchParams({
    model_source: 'gen-model-v1',
    gm_backend: GEN_MODEL_BASE,
    output_project: PROJECT,
    unit_refno: refno,
    compare_autorun: '1',
    ...extra,
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('model-unit-version-compare-panel')).toBeVisible({ timeout: 60_000 });
  return { pageErrors, apiRequests };
}

/** 相机先停到这个远点，再点「定位」——找不到构件时 `focusModelUnitVersionCompare` 直接 return，相机纹丝不动（与 model-version-compare 那份同一招）。 */
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

function cameraDistanceFromParked(page: Page): Promise<number> {
  return page.evaluate((parked) => {
    const position = (window as unknown as { __dtxViewer?: { camera: { position: { x: number; y: number; z: number } } } }).__dtxViewer?.camera.position;
    if (!position) return 0;
    return Math.hypot(position.x - parked.x, position.y - parked.y, position.z - parked.z);
  }, PARKED_CAMERA);
}

type CompareWindow = { __modelUnitVersionCompare?: { unitRefno?: string; units?: string[]; viewMode?: string } };
const compareState = (page: Page) => page.evaluate(() => (window as unknown as CompareWindow).__modelUnitVersionCompare ?? null);

const timelineRows = (page: Page) => page.locator('[data-testid="model-unit-compare-timeline"] > li');
const inScopeRows = (page: Page) => page.locator('[data-testid="model-unit-compare-timeline"] > li[data-in-scope="true"]');
const timelineRow = (page: Page, sesno: number) => page.locator(`[data-testid="model-unit-compare-timeline"] > li[data-sesno="${sesno}"]`);
/**
 * 2026-09-21 起时间线缺省只画最近 20 行，更早的折成一行「加载更早 n 版…」（设计稿 S1，收口计划 P1-c）：
 * 要数全表 / 点更早那几行前先点开；不够 20 行就没这一行，等 3 s 没等到就当没折。点开后换范围不再折回（换节点重载才折）。
 */
async function expandTimeline(page: Page): Promise<void> {
  await page.getByTestId('model-unit-compare-timeline-more').click({ timeout: 3_000 }).catch(() => undefined);
}

async function evidence(page: Page, name: string, data?: unknown): Promise<void> {
  if (!EVIDENCE_DIR) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
  if (data !== undefined) writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

async function waitForCompareSummary(page: Page): Promise<string> {
  await expect(page.getByTestId('model-unit-compare-summary')).toBeVisible({ timeout: 240_000 });
  return (await page.getByTestId('model-unit-compare-summary').textContent()) ?? '';
}

test('叶子构件：时间线带 user / comment / 属性 n，叶子缺省「仅自身」（「所有子节点」置灰），属性对比 tab 折出 (A, B] 的净差，所属单元的 A / B 自动对比', async ({ page }) => {
  const versions = leafVersions!;
  const history = leafHistory!;
  const selfRows = versions.versions.filter((row) => row.element_impact !== null);
  const b = selfRows.at(-1)!.sesno;
  const a = selfRows.at(-2)!.sesno;
  const { pageErrors, apiRequests } = await openPanel(page, LEAF);

  // 时间线：范围内行数 = element/versions 里它自己变过的行数（叶子没有成员 → 缺省「仅自身」、「所有子节点」置灰，Q10 c）；
  // 夹具要是带成员的构件，缺省就是「所有子节点」、行数 = 两列并起来的行数
  await expect(timelineRows(page).first()).toBeVisible({ timeout: 120_000 });
  // 缺省折起（叶子 FTUB 24384_23262 有 53 版；缺省 A / B 是最近两版，就在画出来的 20 行里）：先看得见「加载更早 n 版…」再点开数全表
  if (selfRows.length > 20) {
    await expect(page.getByTestId('model-unit-compare-timeline-more')).toContainText('加载更早');
    await expect(timelineRows(page)).toHaveCount(20);
  }
  await expandTimeline(page);
  await expect(page.getByTestId('model-unit-compare-timeline-more')).toHaveCount(0);
  const subtreeDisabled = await page.getByTestId('model-unit-compare-scope-subtree').isDisabled();
  if (subtreeDisabled) {
    await expect(page.getByTestId('model-unit-compare-scope-self')).toHaveAttribute('aria-pressed', 'true');
    await expect(inScopeRows(page)).toHaveCount(selfRows.length, { timeout: 120_000 });
    await expect(page.getByTestId('model-unit-compare-timeline-head')).toContainText(`本范围 ${selfRows.length} 版`);
  } else {
    await expect(page.getByTestId('model-unit-compare-scope-subtree')).toHaveAttribute('aria-pressed', 'true');
    await expect(timelineRows(page)).toHaveCount(versions.versions.length, { timeout: 120_000 });
  }
  // 属性变化时间线并进来：有 user / comment / 属性 n 的那几行
  const latestEntry = history.entries.at(-1)!;
  await expect(timelineRow(page, latestEntry.sesno)).toContainText(latestEntry.user);
  if (latestEntry.comment) await expect(timelineRow(page, latestEntry.sesno)).toContainText(latestEntry.comment.slice(0, 20));
  await expect(timelineRow(page, latestEntry.sesno)).toContainText(`属性 ${latestEntry.changed_count}`);
  await expect(page.getByTestId('model-unit-compare-history-missing')).toHaveCount(0);
  // 缺省 A / B = 范围内最近两版；自动跑的对比装的是所属单元
  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(a));
  await expect(page.getByTestId('model-unit-compare-b')).toHaveAttribute('data-sesno', String(b));
  const compareText = await waitForCompareSummary(page);
  await expect(page.getByTestId('model-unit-compare-summary')).toContainText(underscore(versions.unit_root!));
  await evidence(page, 'leaf-model-compare', { leaf: LEAF, unit: versions.unit_root, a, b, compareText });

  // 切「仅自身」（已是就不动）：只剩它自己变过的会话，A / B 保留
  if (!subtreeDisabled) await page.getByTestId('model-unit-compare-scope-self').click();
  await expect(inScopeRows(page)).toHaveCount(selfRows.length);
  await expect(page.getByTestId('model-unit-compare-timeline-head')).toContainText(`本范围 ${selfRows.length} 版`);
  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(a));
  await expect(page.getByTestId('model-unit-compare-b')).toHaveAttribute('data-sesno', String(b));

  // 属性对比 tab：(A, B] 折成净差，行名来自服务端那一版的 changes
  await page.getByTestId('model-unit-compare-tab-attributes').click();
  const table = page.getByTestId('model-unit-compare-attr-table');
  await expect(table).toBeVisible();
  const between = history.entries.filter((entry) => entry.sesno > a && entry.sesno <= b);
  const names = [...new Set(between.flatMap((entry) => entry.changes.map((change) => change.name)))];
  for (const name of names) await expect(table).toContainText(name);
  const attrText = (await page.getByTestId('model-unit-compare-attributes').textContent()) ?? '';
  await evidence(page, 'leaf-self-attr-compare', { leaf: LEAF, a, b, names, attrText });

  // 「退出」在模型对比 tab 的三维查看区里
  await page.getByTestId('model-unit-compare-tab-model').click();
  await page.getByTestId('model-unit-compare-close').click();
  expect(apiRequests.some((r) => /element\/attribute-history/.test(r.url))).toBe(true);
  expect(apiRequests.some((r) => /node\/versions/.test(r.url))).toBe(false);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('容器节点：子树时间线来自 node/versions（不再手填会话号），「所有子节点」下每行带「单元 n」，差异摘要按单元分组、逐组三维对比', async ({ page }) => {
  const subtree = containerSubtree!;
  const self = containerSelf!;
  const { pageErrors, apiRequests } = await openPanel(page, CONTAINER);

  // 容器缺省「仅自身」（Q10 c）；提示来自 node/versions；手填栏不再露出；自动跑不报「没有几何」
  await expect(page.getByTestId('model-unit-compare-scope-self')).toHaveAttribute('aria-pressed', 'true', { timeout: 120_000 });
  await expect(page.getByTestId('model-unit-compare-notice')).toContainText(`子树时间线 ${subtree.versions.length} 版来自 node/versions`, { timeout: 120_000 });
  await expect(page.getByTestId('model-unit-compare-manual-pair')).toHaveCount(0);
  await expect(page.getByTestId('model-unit-compare-error')).toHaveCount(0);
  // 「仅自身」的行 = 两条来源的并集：node/versions self（模型口径的记录变化）∪ attribute-history（任何属性变过，UDA 也算）；
  // 只在后者里的会话标「仅属性」，标题「本范围 n 版 · 仅属性 m」的 n 与 node/versions self 的行数对得上
  const nodeSelfSesnos = new Set<number>((self?.versions ?? subtree.versions.filter((row) => row.self_impact !== null)).map((row) => row.sesno));
  const historySesnos = (containerHistory?.entries ?? []).map((entry) => entry.sesno);
  const selfSesnos = new Set<number>([...nodeSelfSesnos, ...historySesnos]);
  const attributeOnly = historySesnos.filter((sesno) => !nodeSelfSesnos.has(sesno));
  const selfCount = selfSesnos.size;
  await expect(inScopeRows(page)).toHaveCount(selfCount);
  await expect(page.getByTestId('model-unit-compare-timeline-head')).toContainText(`本范围 ${nodeSelfSesnos.size} 版`);
  if (attributeOnly.length > 0) {
    await expect(page.getByTestId('model-unit-compare-timeline-head')).toContainText(`仅属性 ${attributeOnly.length}`);
    await expect(page.getByTestId('model-unit-compare-attribute-only')).toHaveCount(attributeOnly.length);
    await expect(timelineRow(page, attributeOnly[0]!)).toContainText('仅属性');
  }
  await evidence(page, 'container-self-timeline', { container: CONTAINER, noun: subtree.noun, selfCount, subtreeCount: subtree.versions.length });

  // 切「所有子节点」：每一行都在范围内，动过几何的行带「单元 n」
  await page.getByTestId('model-unit-compare-scope-subtree').click();
  const subtreeSesnos = new Set<number>([...subtree.versions.map((row) => row.sesno), ...selfSesnos]);
  // 版数 = node/versions subtree 的行数；只在属性时间线里的会话仍是「仅属性」
  const subtreeTableSesnos = new Set<number>(subtree.versions.map((row) => row.sesno));
  const subtreeAttributeOnly = historySesnos.filter((sesno) => !subtreeTableSesnos.has(sesno));
  await expect(page.getByTestId('model-unit-compare-timeline-head')).toContainText(`本范围 ${subtreeTableSesnos.size} 版`);
  // 子树 298 版缺省折起（标题的数字按全表；画出来的从最近那版连续到被选为 A / B 的行、至少 20 行）：点开再数行
  await expandTimeline(page);
  await expect(inScopeRows(page)).toHaveCount(subtreeSesnos.size);
  if (subtreeAttributeOnly.length > 0) await expect(page.getByTestId('model-unit-compare-timeline-head')).toContainText(`仅属性 ${subtreeAttributeOnly.length}`);
  const withUnits = subtree.versions.filter((row) => row.units_changed > 0);
  await expect(page.getByTestId('model-unit-compare-units-changed')).toHaveCount(withUnits.length);
  const sample = withUnits.at(-1)!;
  await expect(timelineRow(page, sample.sesno)).toContainText(`单元 ${sample.units_changed}`);

  // 挑一段服务端说「变了 ≥ 1 个单元」的 A → B：从最新往回找第一版 units_changed > 0 当 B，它的上一版当 A
  const pickIndex = subtree.versions.findLastIndex((row) => row.units_changed > 0);
  const bRow = subtree.versions[pickIndex]!;
  const aRow = subtree.versions[pickIndex - 1]!;
  const summary = (await getJson<DiffSummaryResponse>(`node/diff-summary?dbnum=${DBNUM}&refno=${slash(CONTAINER)}&a=${aRow.sesno}&b=${bRow.sesno}&scope=subtree`)).body!;
  await page.getByTestId(`model-unit-compare-pick-b-${bRow.sesno}`).click();
  await page.getByTestId(`model-unit-compare-pick-a-${aRow.sesno}`).click();
  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(aRow.sesno));
  await expect(page.getByTestId('model-unit-compare-b')).toHaveAttribute('data-sesno', String(bRow.sesno));

  // 2026-09-21 起（收口计划 P1-a，设计稿 S2）时间线头上两个勾选，各筛一维、被选为 A / B 的行永远留着（所以先选好 A / B 再勾——
  // 缺省 A / B 恰是容器自己那两行 noop / 仅属性，勾「只看几何变的」会被它们顶着看不出效果）：
  // 「只看自身变的」（只在「所有子节点」下露出）= 节点自身记录变过的会话（node/versions 的 self_impact ∪ 属性时间线，含只改属性的）；
  // 「只看几何变的」= 子树影响非 null / noop 的会话（只在属性时间线里的会话按它自己那一栏的 impact）
  const selectedNow = new Set<number>([aRow.sesno, bRow.sesno]);
  const selfOnlyBox = page.getByTestId('model-unit-compare-self-only');
  await expect(selfOnlyBox).toBeEnabled();
  await selfOnlyBox.check();
  const selfOnlyCount = new Set<number>([...selfSesnos, ...selectedNow]).size;
  await expect(timelineRows(page)).toHaveCount(selfOnlyCount);
  await evidence(page, 'container-subtree-self-only', { selfSesnos: [...selfSesnos], selected: [...selectedNow], rows: selfOnlyCount, all: subtreeSesnos.size });
  await selfOnlyBox.uncheck();
  await expect(timelineRows(page)).toHaveCount(subtreeSesnos.size);
  const subtreeImpactBySesno = new Map<number, string | null>(subtree.versions.map((row) => [row.sesno, row.impact]));
  for (const entry of containerHistory?.entries ?? []) if (!subtreeImpactBySesno.has(entry.sesno)) subtreeImpactBySesno.set(entry.sesno, entry.impact);
  const geometrySesnos = [...subtreeSesnos].filter((sesno) => {
    const impact = subtreeImpactBySesno.get(sesno) ?? null;
    return impact !== null && impact !== 'noop';
  });
  const geometryOnlyBox = page.getByTestId('model-unit-compare-geometry-only');
  await geometryOnlyBox.check();
  const geometryOnlyCount = new Set<number>([...geometrySesnos, ...selectedNow]).size;
  await expect(timelineRows(page)).toHaveCount(geometryOnlyCount);
  test.info().annotations.push({ type: 'timeline filters', description: `全表 ${subtreeSesnos.size} · 只看自身变的 ${selfOnlyCount} · 只看几何变的 ${geometryOnlyCount}（A ${aRow.sesno} / B ${bRow.sesno}）` });
  await geometryOnlyBox.uncheck();
  await expect(timelineRows(page)).toHaveCount(subtreeSesnos.size);
  // 勾选不折回时间线（换节点重载才折）
  await expect(page.getByTestId('model-unit-compare-timeline-more')).toHaveCount(0);

  // 属性对比 tab（所有子节点）：有变的构件清单 = 差异摘要里的行数
  const summaryRows = summary.groups.flatMap((group) => group.rows);
  await expect(page.locator('[data-testid="model-unit-compare-changed-elements"] > li').filter({ has: page.locator('button') })).toHaveCount(summaryRows.length, { timeout: 120_000 });
  const modifiedRow = summaryRows.find((row) => row.status === 'modified');
  if (modifiedRow) {
    await page.getByTestId(`model-unit-compare-element-${underscore(modifiedRow.refno)}`).click();
    // 点开就去拉它自己的属性时间线折净差
    await expect.poll(() => apiRequests.filter((r) => /element\/attribute-history/.test(r.url)).length, { timeout: 60_000 }).toBeGreaterThan(0);
  }
  // 2026-09-21 起（收口计划 P1-b，设计稿 S3）每行行尾一颗「定位」：还没「在三维中对比」时 B 版已删的构件当前模型里没有 → 置灰并说明；其余可点
  const locateButton = (refno: string) => page.getByTestId(`model-unit-compare-element-locate-${underscore(refno)}`);
  await expect(page.locator('[data-testid^="model-unit-compare-element-locate-"]')).toHaveCount(summaryRows.length);
  const deletedRow = summaryRows.find((row) => row.status === 'deleted');
  if (modifiedRow) await expect(locateButton(modifiedRow.refno)).toBeEnabled();
  if (deletedRow) {
    await expect(locateButton(deletedRow.refno)).toBeDisabled();
    await expect(locateButton(deletedRow.refno)).toHaveAttribute('title', /先「在三维中对比」再定位/);
  }
  await evidence(page, 'container-subtree-attr-compare', { a: aRow.sesno, b: bRow.sesno, rows: summaryRows });

  // 模型对比 tab：差异摘要（未生成几何）+ 按单元分组；容器自己没有几何 → 顶部按钮禁用；点一组「在三维中对比」装那个单元的 A / B
  await page.getByTestId('model-unit-compare-tab-model').click();
  await expect(page.getByTestId('model-unit-compare-run')).toBeDisabled();
  await expect(page.getByTestId('model-unit-compare-diff-summary')).toContainText(`变了的单元 ${summary.units.changed}`, { timeout: 120_000 });
  const geometryGroups = summary.groups.filter((group) => group.unit_root && group.geometry_changed);
  await expect(page.locator('[data-testid="model-unit-compare-groups"] > div')).toHaveCount(geometryGroups.length);
  await evidence(page, 'container-subtree-diff-summary', { a: aRow.sesno, b: bRow.sesno, units: summary.units, groups: geometryGroups.map((g) => g.unit_root) });

  const first = geometryGroups[0]!;
  await page.getByTestId(`model-unit-compare-run-group-${underscore(first.unit_root!)}`).click();
  const compareText = await waitForCompareSummary(page);
  await expect(page.getByTestId('model-unit-compare-summary')).toContainText(underscore(first.unit_root!));
  await expect(page.getByTestId(`model-unit-compare-run-group-${underscore(first.unit_root!)}`)).toContainText('三维中');
  await evidence(page, 'container-subtree-group-3d-compare', { unit: first.unit_root, a: aRow.sesno, b: bRow.sesno, compareText });

  // P1-b 的另一半：装好这组的 A / B 后，属性对比 tab 里 B 版已删的构件也能「定位」——它在 A 那一层里，相机飞过去（找不到时相机不动）
  const deletedInFirst = deletedRow && first.rows.some((row) => row.refno === deletedRow.refno) ? deletedRow : null;
  if (deletedInFirst) {
    await page.getByTestId('model-unit-compare-tab-attributes').click();
    await expect(locateButton(deletedInFirst.refno)).toBeEnabled();
    await expect(locateButton(deletedInFirst.refno)).toHaveAttribute('title', /A \/ B 那一版/);
    await parkCamera(page);
    await locateButton(deletedInFirst.refno).click();
    await expect.poll(() => cameraDistanceFromParked(page), { timeout: 15_000 }).toBeGreaterThan(1);
    await evidence(page, 'container-subtree-locate-deleted', { refno: deletedInFirst.refno, unit: first.unit_root });
    await page.getByTestId('model-unit-compare-tab-model').click();
  }

  // 2026-09-21 起（收口计划 P2-a）：不止一组时有一颗总按钮，变了的单元一起进三维；≤ 20 组且服务端没说要确认就直接装（多了会先弹确认框，这里不进那条路）
  if (geometryGroups.length > 1 && geometryGroups.length <= 20 && !summary.needs_confirm) {
    await page.getByTestId('model-unit-compare-run-groups').click();
    await expect(page.getByTestId('model-unit-compare-summary-title')).toContainText(`${geometryGroups.length} 个单元`, { timeout: 240_000 });
    await page.waitForFunction(
      (count) => (window as unknown as { __modelUnitVersionCompare?: { units?: string[] } }).__modelUnitVersionCompare?.units?.length === count,
      geometryGroups.length,
      { timeout: 120_000 },
    );
    await expect(page.getByTestId('model-unit-compare-run-groups')).toContainText('三维中');
    await expect(page.getByTestId('model-unit-compare-runtime-title')).toContainText(`${geometryGroups.length} 个单元`);
    await evidence(page, 'container-subtree-all-groups-3d-compare', { units: geometryGroups.map((g) => g.unit_root), a: aRow.sesno, b: bRow.sesno });
  }

  await page.getByTestId('model-unit-compare-close').click();
  expect(apiRequests.filter((r) => /node\/versions\?/.test(r.url)).length).toBeGreaterThanOrEqual(1);
  expect(apiRequests.some((r) => /node\/diff-summary/.test(r.url))).toBe(true);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

type MultiFixture = {
  selfSesnos: Set<number>;
  subtreeSesnos: Set<number>;
  summary: DiffSummaryResponse;
  geometryGroups: DiffSummaryResponse['groups'];
};

/** 第三个用例的门：夹具是容器、A / B 在它的子树时间线里、差异摘要 2..20 组几何变过且服务端没说要确认。 */
async function multiFixtureReason(): Promise<{ reason: string | null; fixture: MultiFixture | null }> {
  const subtree = await getJson<NodeVersionsResponse>(`node/versions?dbnum=${DBNUM}&refno=${slash(MULTI_CONTAINER)}&scope=subtree&limit=5000`);
  if (!subtree.body) return { reason: `${MULTI_CONTAINER} node/versions HTTP ${subtree.status}`, fixture: null };
  if (subtree.body.unit_root !== null) return { reason: `${MULTI_CONTAINER} 不是容器（所属单元 ${subtree.body.unit_root}）`, fixture: null };
  const subtreeSesnos = new Set<number>(subtree.body.versions.map((row) => row.sesno));
  if (!subtreeSesnos.has(MULTI_A) || !subtreeSesnos.has(MULTI_B)) {
    return { reason: `${MULTI_CONTAINER} 子树时间线里没有 ${MULTI_A} / ${MULTI_B} 这两版`, fixture: null };
  }
  const self = await getJson<NodeVersionsResponse>(`node/versions?dbnum=${DBNUM}&refno=${slash(MULTI_CONTAINER)}&scope=self&limit=5000`);
  const history = await getJson<HistoryResponse>(`element/attribute-history?dbnum=${DBNUM}&refno=${slash(MULTI_CONTAINER)}&limit=5000`);
  const selfSesnos = new Set<number>([
    ...(self.body?.versions ?? subtree.body.versions.filter((row) => row.self_impact !== null)).map((row) => row.sesno),
    ...(history.body?.entries ?? []).map((entry) => entry.sesno),
  ]);
  const summary = await getJson<DiffSummaryResponse>(`node/diff-summary?dbnum=${DBNUM}&refno=${slash(MULTI_CONTAINER)}&a=${MULTI_A}&b=${MULTI_B}&scope=subtree`);
  if (!summary.body) return { reason: `${MULTI_CONTAINER} node/diff-summary HTTP ${summary.status}`, fixture: null };
  const geometryGroups = summary.body.groups.filter((group) => group.unit_root && group.geometry_changed);
  if (geometryGroups.length < 2 || geometryGroups.length > 20 || summary.body.needs_confirm) {
    return { reason: `${MULTI_CONTAINER} ${MULTI_A} → ${MULTI_B} 有 ${geometryGroups.length} 组几何变过（needs_confirm=${summary.body.needs_confirm ?? false}），这条要 2..20 组且不用确认`, fixture: null };
  }
  return { reason: null, fixture: { selfSesnos, subtreeSesnos, summary: summary.body, geometryGroups } };
}

/** 单元根那一行的状态定这一侧在不在（`modelUnitGroupSideImpactKinds`）：B 时已删 → A / B 卡的 B 侧列它；A 时还没建 → A 侧列它 */
function absentUnitsBySide(groups: DiffSummaryResponse['groups']): { before: string[]; after: string[] } {
  const before: string[] = [];
  const after: string[] = [];
  for (const group of groups) {
    const root = group.rows.find((row) => row.refno === group.unit_root);
    if (root?.status === 'added') before.push(underscore(group.unit_root!));
    if (root?.status === 'deleted') after.push(underscore(group.unit_root!));
  }
  return { before, after };
}

test('容器 URL 直达 compare_a / compare_b → 全部变了的单元一起进三维 → 分屏 → 换成只看一组分屏保持（收口计划 P3-a / P2-a / P3-b）', async ({ page }) => {
  const { reason, fixture } = await multiFixtureReason();
  test.skip(reason !== null, reason ?? '');
  const { selfSesnos, subtreeSesnos, summary, geometryGroups } = fixture!;
  const { pageErrors, apiRequests } = await openPanel(page, MULTI_CONTAINER, { compare_a: String(MULTI_A), compare_b: String(MULTI_B) });

  // P3-a：URL 那对不在「仅自身」里、只在子树里有 → 自动切「所有子节点」把它们选上，落到模型对比 tab 即停（不装几何、不报错）
  const pairInSelf = selfSesnos.has(MULTI_A) && selfSesnos.has(MULTI_B);
  await expect(page.getByTestId(pairInSelf ? 'model-unit-compare-scope-self' : 'model-unit-compare-scope-subtree')).toHaveAttribute('aria-pressed', 'true', { timeout: 120_000 });
  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(Math.min(MULTI_A, MULTI_B)));
  await expect(page.getByTestId('model-unit-compare-b')).toHaveAttribute('data-sesno', String(Math.max(MULTI_A, MULTI_B)));
  await expect(page.getByTestId('model-unit-compare-tab-model')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('model-unit-compare-error')).toHaveCount(0);
  await expect(page.getByTestId('model-unit-compare-runtime')).toHaveCount(0);
  await expect(page.getByTestId('model-unit-compare-run')).toBeDisabled();
  // 被选为 A / B 的行一定在画出来的那段里（时间线缺省只画最近 20 行，切点顺延到更早的 A）
  await expect(timelineRow(page, MULTI_A)).toBeVisible();
  await expect(timelineRow(page, MULTI_B)).toBeVisible();
  if (subtreeSesnos.size > 20) await expect(page.getByTestId('model-unit-compare-timeline-more')).toContainText('加载更早');

  // 差异摘要 + 分组 + 总按钮（P2-a）
  await expect(page.getByTestId('model-unit-compare-diff-summary')).toContainText(`变了的单元 ${summary.units.changed}`, { timeout: 120_000 });
  await expect(page.locator('[data-testid="model-unit-compare-groups"] > div')).toHaveCount(geometryGroups.length);
  await expect(page.getByTestId('model-unit-compare-run-groups-row')).toContainText(`${geometryGroups.length} 个单元`);
  await evidence(page, 'multi-url-direct-diff-summary', { container: MULTI_CONTAINER, a: MULTI_A, b: MULTI_B, units: summary.units, groups: geometryGroups.map((g) => g.unit_root) });

  await page.getByTestId('model-unit-compare-run-groups').click();
  // 进度卡「正在生成历史投影 n / m」只在装的时候露出（> 2 份才画）；装得快就直接看到结果，两者之一必须出现
  const progress = page.getByTestId('model-unit-compare-progress');
  const summaryTitle = page.getByTestId('model-unit-compare-summary-title');
  await expect.poll(async () => (await progress.count()) > 0 || (await summaryTitle.count()) > 0, { timeout: 60_000 }).toBe(true);
  if (await progress.count()) {
    await expect(progress).toContainText('正在生成历史投影');
    await evidence(page, 'multi-all-groups-progress');
  }
  await expect(summaryTitle).toContainText(`${geometryGroups.length} 个单元`, { timeout: 240_000 });
  await expect.poll(async () => (await compareState(page))?.units?.length, { timeout: 120_000 }).toBe(geometryGroups.length);
  const state = await compareState(page);
  expect(new Set(state!.units)).toEqual(new Set(geometryGroups.map((group) => underscore(group.unit_root!))));
  expect(state!.unitRefno).toBe(MULTI_CONTAINER);
  await expect(page.getByTestId('model-unit-compare-runtime-title')).toContainText(`${geometryGroups.length} 个单元 · ${MULTI_CONTAINER} 下`);
  await expect(page.getByTestId('model-unit-compare-run-groups')).toContainText('三维中');
  for (const group of geometryGroups) {
    await expect(page.getByTestId(`model-unit-compare-run-group-${underscore(group.unit_root!)}`)).toContainText('三维中 · 只看这组');
  }
  // A / B 卡列这一侧不存在的单元：B 时已删 → B 卡「n 个单元该版本单元已删除：…」；A 时还没建 → A 卡「n 个单元该版本没有这个单元：…」
  const absent = absentUnitsBySide(geometryGroups);
  await expect(page.getByTestId('model-unit-compare-absent-before')).toHaveCount(absent.before.length ? 1 : 0);
  await expect(page.getByTestId('model-unit-compare-absent-after')).toHaveCount(absent.after.length ? 1 : 0);
  if (absent.before.length) {
    await expect(page.getByTestId('model-unit-compare-absent-before')).toContainText(`${absent.before.length} 个单元该版本没有这个单元`);
    for (const unit of absent.before) await expect(page.getByTestId('model-unit-compare-absent-before')).toContainText(unit);
  }
  if (absent.after.length) {
    await expect(page.getByTestId('model-unit-compare-absent-after')).toContainText(`${absent.after.length} 个单元该版本单元已删除`);
    for (const unit of absent.after) await expect(page.getByTestId('model-unit-compare-absent-after')).toContainText(unit);
  }
  const allText = (await page.getByTestId('model-unit-compare-summary').textContent()) ?? '';
  await evidence(page, 'multi-all-groups-3d-compare', { units: state!.units, absent, summaryText: allText });

  // P3-b：分屏后换成只看一组（面板 close → open），分屏跟过去，不掉回单视口
  await page.getByTestId('model-unit-compare-split-mode').click();
  await expect(page.getByTestId('model-unit-compare-split-summary')).toContainText(`左 A · sesno ${Math.min(MULTI_A, MULTI_B)}`);
  await expect.poll(async () => (await compareState(page))?.viewMode).toBe('split');
  const bothSides = geometryGroups.find((group) => {
    const root = group.rows.find((row) => row.refno === group.unit_root);
    return root?.status !== 'added' && root?.status !== 'deleted';
  }) ?? geometryGroups[0]!;
  const onlyUnit = underscore(bothSides.unit_root!);
  await page.getByTestId(`model-unit-compare-run-group-${onlyUnit}`).click();
  await expect.poll(async () => (await compareState(page))?.unitRefno, { timeout: 240_000 }).toBe(onlyUnit);
  await expect(page.getByTestId('model-unit-compare-summary')).toContainText(onlyUnit);
  expect((await compareState(page))!.units).toEqual([onlyUnit]);
  await expect(page.getByTestId('model-unit-compare-split-mode')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('model-unit-compare-split-summary')).toContainText(`右 B · sesno ${Math.max(MULTI_A, MULTI_B)}`);
  await expect(page.getByTestId('viewer-model-unit-split-overlay')).toContainText(`A · sesno ${Math.min(MULTI_A, MULTI_B)}`);
  expect((await compareState(page))!.viewMode).toBe('split');
  await expect(page.getByTestId(`model-unit-compare-run-group-${onlyUnit}`)).toHaveText(/^\s*三维中\s*$/);
  await expect(page.getByTestId('model-unit-compare-run-groups')).toContainText('在三维中对比');
  await expect(page.getByTestId('model-unit-compare-runtime-title')).toContainText(`${onlyUnit} · DB ${DBNUM}`);
  await evidence(page, 'multi-one-group-split-kept', { unit: onlyUnit, viewMode: (await compareState(page))!.viewMode });

  // 退出：运行态没了、五个组按钮全部回「在三维中对比」、生成过的历史快照有 DELETE
  await page.getByTestId('model-unit-compare-close').click();
  await expect(page.getByTestId('model-unit-compare-runtime')).toHaveCount(0);
  for (const group of geometryGroups) {
    await expect(page.getByTestId(`model-unit-compare-run-group-${underscore(group.unit_root!)}`)).toHaveText(/^\s*在三维中对比\s*$/);
  }
  const generated = apiRequests.filter((r) => r.method === 'POST' && /model\/history\/generate/.test(r.url)).length;
  const absentSides = absent.before.length + absent.after.length;
  // 第一发：每个单元两侧各一份、这一侧不存在的不生成（两侧几何承诺相同时那个单元只取一次，所以是上限）；第二发只看一组再来两份
  expect(generated).toBeGreaterThan(0);
  expect(generated).toBeLessThanOrEqual(geometryGroups.length * 2 - absentSides + 2);
  // 换组时上一轮的快照已经还回去，退出时这一轮的也还——生成过的每一份都有一条 DELETE
  await expect.poll(() => apiRequests.filter((r) => r.method === 'DELETE' && /model\/history\//.test(r.url)).length, { timeout: 15_000 }).toBe(generated);
  test.info().annotations.push({ type: 'history/generate', description: `${generated} 份（${geometryGroups.length} 组，${absentSides} 侧不存在）` });
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
