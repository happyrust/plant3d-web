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
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const GEN_MODEL_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const DBNUM = Number(process.env.NODE_VERSION_E2E_DBNUM || '8000');
const PROJECT = process.env.NODE_VERSION_E2E_PROJECT || 'AvevaMarineSample';
const LEAF = process.env.NODE_VERSION_E2E_LEAF || '24384_23262';
const CONTAINER = process.env.NODE_VERSION_E2E_CONTAINER || '24384_22399';
const EVIDENCE_DIR = process.env.NODE_VERSION_E2E_EVIDENCE || '';

type ElementVersionRow = { sesno: number; element_impact: string | null; unit_impact: string | null };
type ElementVersionsResponse = { noun: string; unit_root: string | null; versions: ElementVersionRow[]; truncated: boolean };
type NodeVersionRow = { sesno: number; impact: string; self_impact: string | null; units_changed: number };
type NodeVersionsResponse = { noun: string; unit_root: string | null; versions: NodeVersionRow[]; truncated: boolean };
type HistoryEntry = { sesno: number; user: string; comment: string; changed_count: number; changes: { name: string }[] };
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

async function openPanel(page: Page, refno: string): Promise<Opened> {
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
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('model-unit-version-compare-panel')).toBeVisible({ timeout: 60_000 });
  return { pageErrors, apiRequests };
}

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

  // 属性对比 tab（所有子节点）：有变的构件清单 = 差异摘要里的行数
  const summaryRows = summary.groups.flatMap((group) => group.rows);
  await expect(page.locator('[data-testid="model-unit-compare-changed-elements"] > li').filter({ has: page.locator('button') })).toHaveCount(summaryRows.length, { timeout: 120_000 });
  const modifiedRow = summaryRows.find((row) => row.status === 'modified');
  if (modifiedRow) {
    await page.getByTestId(`model-unit-compare-element-${underscore(modifiedRow.refno)}`).click();
    // 点开就去拉它自己的属性时间线折净差
    await expect.poll(() => apiRequests.filter((r) => /element\/attribute-history/.test(r.url)).length, { timeout: 60_000 }).toBeGreaterThan(0);
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
