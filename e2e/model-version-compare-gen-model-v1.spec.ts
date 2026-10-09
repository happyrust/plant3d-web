/**
 * 版本对比 · gen-model-v1 源真机回归（ADR 0065 / gen-model-refactor ADR-081）。
 *
 * 由 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/` 那次一次性 Playwright 脚本整理而来，检查点逐条对应
 * 那份 README §2：URL `compare_autorun` 自动开面板 → 版本表 → 选 A/B → 对比结果 → ViewerPanel 两侧对象数 → 单视口切 A →
 * 双视口分屏 → 模型树差异模式（幽灵节点挂回原父）→ 关闭时 `DELETE` 历史快照、差异模式退出。
 *
 * 夹具**钉死版本对**（2026-10-09，版本对比审核计划 P1-2 / F7）：之前缺省绑「夹具单元的最近两版」，活库一长、单元一删，断言就跟着漂。
 * 现在走全量检查点的用例 A / B 都是明确的会话号，跑前先拿服务端 `element/versions` 探这对在不在该单元的链上——不在就 `skip`，
 * 把链尾是哪几版、该换哪个环境变量写进跳过理由，不让数据漂移变成红：
 * - 主夹具 `MODEL_VERSION_E2E_UNIT` / `_A` / `_B`（缺省 BRAN 24384/23257 626 → 630：09-18「FTUB 24384/23262 抬管 626 / 放回 630」
 *   留下的现场，两版都有几何、修改 1 / 未变 8）——第一条全量检查点；
 * - 整单元被删 `MODEL_VERSION_E2E_TOMBSTONE_UNIT` / `_A` / `_B`（缺省 EQUI 24384/26480 602 → 604：ADR-076 S5「新建 → 挪 → DELETE」，
 *   604 之后链不再长）——同一套检查点走 tombstone 分支（B 侧 0 对象、幽灵行「已删除」、只 DELETE 有几何的那一份）；
 * - 「B 版之后又被删」`MODEL_VERSION_E2E_GHOST_UNIT` / `_A` / `_B`（缺省 EQUI 24384/24776 618 → 628）照旧。
 * 「不传 compare_a / compare_b 自动选最近两版」与「URL 那对不在时间线里回落最近两版」天生要跟活库的最近两版比，只留轻断言
 * （选中的是时间线最新两行、对比跑完、关闭时 DELETE = generate），几何 / 树差异的细节不压在这两条上。
 *
 * 数字一律**取自服务端**回执，不写死：`model/versions`（面板 A / B 与对比按它）、`element/versions` ∪ `element/attribute-history`
 * （面板时间线画出来的行：只改属性的会话标「仅属性」、不计版；见 `expectedTimeline`）。换个库就换上面那几个环境变量，用例按回执自适应。
 *
 * 前置：gen-model 在 `GEN_MODEL_V1_BASE_URL`（缺省 `http://127.0.0.1:8022`）且带 `model/versions`（ef2284f12 起）与
 * `element/versions`（6cb37395f 起）；页面走 Playwright `baseURL` 的 Vite dev server。不满足就整文件跳过。
 * 跑在哪：隔离联调环境（审核计划 D5）——`history/generate` 会在服务端建快照，不对生产跑；`--workers=1`（几条用例共用同一单元的快照键）。
 *
 * 状态：2026-09-18 15:5x 对 :8022（d47d747fd）+ dev :3111 真机跑过（同一批检查点，见上面那份 README）；
 * 2026-09-19 10:2x 跟着 `061c83b2`（面板升级成「节点版本」）改了选版那几条断言——A / B 不再是两个 `<select>`，
 * 而是版本时间线上的徽章（`model-unit-compare-a/b` 的 `data-sesno`）+ 每行一对 A / B 按钮，其余检查点原样。
 * 2026-09-22 加了分屏描边合成器按显卡串自动退回那条（P3-c）：`PLAYWRIGHT_SOFTWARE_GL=1`（SwiftShader）与 `PLAYWRIGHT_GPU=1`（真显卡）各跑一遍。
 * 2026-10-09 钉死版本对（本段开头）；改完还没有隔离环境可跑，等 M2 / M3 同版部署后把两份 spec 各跑一遍（审核计划 P1-2）。
 */
import { expect, test, type Page } from '@playwright/test';

import { formatModelUnitVersionTime } from '../src/utils/modelUnitVersionCompare';
import { isSoftwareRendererName } from '../src/utils/three/webglRendererInfo';

const GEN_MODEL_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const DBNUM = Number(process.env.MODEL_VERSION_E2E_DBNUM || '8000');
const PROJECT = process.env.MODEL_VERSION_E2E_PROJECT || 'AvevaMarineSample';
/** 主夹具：链上稳定的单元根 + 明确的 A / B（两版都有几何；BRAN 24384/23257 626 → 630 = 修改 1 / 未变 8） */
const UNIT = process.env.MODEL_VERSION_E2E_UNIT || '24384_23257';
const PINNED_A = Number(process.env.MODEL_VERSION_E2E_A || '626');
const PINNED_B = Number(process.env.MODEL_VERSION_E2E_B || '630');
/** 整单元被删的现场：B 版是 tombstone（EQUI 24384/26480 在 604 被 DELETE，链到此为止） */
const TOMBSTONE_UNIT = process.env.MODEL_VERSION_E2E_TOMBSTONE_UNIT || '24384_26480';
const TOMBSTONE_A = Number(process.env.MODEL_VERSION_E2E_TOMBSTONE_A || '602');
const TOMBSTONE_B = Number(process.env.MODEL_VERSION_E2E_TOMBSTONE_B || '604');
/** 「B 版还在、当前会话已不在」的构件：ams8000 里 EQUI `/1-LNR-Q005-PJ` = 24384/24776 下的 BOX 24384/26495，628 建、632 又删 */
const GHOST_UNIT = process.env.MODEL_VERSION_E2E_GHOST_UNIT || '24384_24776';
const GHOST_A = Number(process.env.MODEL_VERSION_E2E_GHOST_A || '618');
const GHOST_B = Number(process.env.MODEL_VERSION_E2E_GHOST_B || '628');

type VersionRow = { sesno: number; session_time: string | null; impact_kind: string };
type VersionsResponse = { unit_noun: string; file_latest_sesno: number; truncated: boolean; versions: VersionRow[] };
type ElementVersionRow = { sesno: number; element_impact: string | null; unit_impact: string | null };
type ElementVersionsResponse = { noun: string; unit_root: string | null; versions: ElementVersionRow[]; truncated: boolean };
type HistoryResponse = { entries: { sesno: number; impact: string | null }[] };

/** 一个单元夹具在服务端的样子；用例里的数字都从这里来 */
type UnitFixture = {
  unit: string;
  /** `model/versions`：面板 A / B 与对比按这张表；每行 sesno / impact_kind / session_time */
  versions: VersionRow[];
  /** `element/versions` 的每一行（左列 = 节点自身、右列 = 所属单元；旧 → 新）：行上那颗徽章按范围显示哪一列（`rowImpact`） */
  elementRows: ElementVersionRow[];
  /** `element/versions` 的会话号（两列并起来，旧 → 新）：钉死的 A / B 要在这条链上 */
  chain: number[];
  /** `element/versions` 里节点自身记录变过的会话（左列非空）：范围「仅自身」时只画这些 */
  selfSesnos: number[];
  /** 属性变化时间线里有 impact 的会话：版本表没算成一版的那些在面板上标「仅属性」、照画但不计版；旧服务端没有这条路由时为空 */
  attributeSesnos: number[];
};

test.setTimeout(300_000);

const slash = (refno: string) => refno.replace('_', '/');
const underscore = (refno: string) => refno.replace('/', '_');

type Probe<T> = { status: number; body: T | null; error?: string };

async function getJson<T>(pathAndQuery: string): Promise<Probe<T>> {
  let response: Response;
  try {
    response = await fetch(`${GEN_MODEL_BASE}/api/v1/${pathAndQuery}`);
  } catch (error) {
    return { status: 0, body: null, error: String(error) };
  }
  if (!response.ok) return { status: response.status, body: null };
  return { status: response.status, body: await response.json() as T };
}

/** 门 1：服务在。 */
async function serviceReason(): Promise<string | null> {
  try {
    const health = await fetch(`${GEN_MODEL_BASE}/api/v1/health`);
    if (!health.ok) return `gen-model health HTTP ${health.status}（${GEN_MODEL_BASE}）`;
  } catch {
    return `gen-model 不在 ${GEN_MODEL_BASE}`;
  }
  return null;
}

/** 链尾几版，写进跳过理由，换夹具时照着挑 */
function chainTail(chain: number[], count = 6): string {
  const tail = chain.slice(-count).join(' / ');
  return chain.length > count ? `… ${tail}` : tail;
}

/**
 * 门 2：读一个单元夹具。先 `element/versions`——它给整条链（钉死的 A / B 在不在就看它），顺带说这个 refno 属于哪个单元
 * （所属单元不是它自己 = 叶子，这份 spec 要单元根）；再 `model/versions`（面板 A / B 与对比按它；容器 / 非单元根这里拿不到）
 * 与属性变化时间线（面板时间线多出来的「仅属性」行）。回 string 就是跳过的原因。
 */
async function loadUnitFixture(unit: string): Promise<UnitFixture | string> {
  const element = await getJson<ElementVersionsResponse>(`element/versions?dbnum=${DBNUM}&refno=${slash(unit)}&limit=5000`);
  if (element.error) return `element/versions 打不通：${element.error}`;
  if (element.status === 404) return `服务没有 element/versions 路由或 ${unit} 不在 dbnum ${DBNUM}（HTTP 404）——要 gen-model-refactor 6cb37395f 起的构建`;
  if (!element.body) return `${unit} element/versions HTTP ${element.status}`;
  if (element.body.unit_root === null) {
    return `${unit}（${element.body.noun}）不在任何最小交付单元下（容器）：这份 spec 的夹具要单元根，容器走 node-version-view 那份 spec`;
  }
  if (underscore(element.body.unit_root) !== unit) {
    return `${unit}（${element.body.noun}）不是单元根，所属单元是 ${underscore(element.body.unit_root)}——夹具换成它`;
  }
  if (element.body.truncated) return `${unit} 的 element/versions 被截断（limit=5000 还不够），这份 spec 按一页数全表`;
  const rows = [...element.body.versions].sort((x, y) => x.sesno - y.sesno);
  const chain = rows.map((row) => row.sesno);
  if (chain.length < 2) return `单元 ${unit} 只有 ${chain.length} 版，不够对比`;

  const unitTable = await getJson<VersionsResponse>(`model/versions?dbnum=${DBNUM}&refno=${slash(unit)}`);
  if (unitTable.error) return `model/versions 打不通：${unitTable.error}`;
  if (unitTable.status === 404) return '服务没有 model/versions 路由（HTTP 404）——要 gen-model-refactor ef2284f12 起的构建';
  // 不是最小交付单元根时服务端回 422（线上 10-09 对 SITE 24384/22399 实测）
  if (!unitTable.body) return `${unit}（${element.body.noun}）model/versions HTTP ${unitTable.status}${unitTable.status === 422 ? '：不是最小交付单元根' : ''}`;
  if (unitTable.body.truncated) return `${unit} 的 model/versions 被截断，这份 spec 按一页数全表`;

  // 旧服务端没有 attribute-history（404）：面板只画版本表那一半，这里也照样
  const history = await getJson<HistoryResponse>(`element/attribute-history?dbnum=${DBNUM}&refno=${slash(unit)}&limit=5000`);
  return {
    unit,
    versions: unitTable.body.versions ?? [],
    elementRows: rows,
    chain,
    selfSesnos: rows.filter((row) => row.element_impact !== null).map((row) => row.sesno),
    attributeSesnos: (history.body?.entries ?? []).filter((entry) => entry.impact !== null).map((entry) => entry.sesno),
  };
}

/** 钉死的 A / B 在不在这个夹具的链上（且单元表里有这两版）；不在就说清楚链尾与该换的环境变量 */
function pinnedPairReason(fixture: UnitFixture, a: number, b: number, envPrefix: string, need: string): string | null {
  const missing = [a, b].filter((sesno) => !fixture.chain.includes(sesno) || !fixture.versions.some((row) => row.sesno === sesno));
  if (missing.length === 0) return null;
  return `单元 ${fixture.unit} 的版本链上没有 ${missing.join(' / ')}（共 ${fixture.chain.length} 版，链尾 ${chainTail(fixture.chain)}）`
    + `——活库数据漂了，${need}，换 ${envPrefix}_UNIT / ${envPrefix}_A / ${envPrefix}_B`;
}

function rowOf(fixture: UnitFixture, sesno: number): VersionRow {
  const row = fixture.versions.find((version) => version.sesno === sesno);
  if (!row) throw new Error(`单元 ${fixture.unit} 的 model/versions 里没有 ${sesno}`);
  return row;
}

/**
 * 面板时间线在某一范围下画出来的行与「本范围 n 版」（`buildNodeTimelineRows` / `countNodeTimeline` 的服务端对偶）：
 * - 「所有子节点」= `element/versions` 的每一行（单元根的子树 ≈ 单元）；「仅自身」= 左列非空的那些；
 * - 属性变化时间线里的会话照画，版本表没算成一版的标「仅属性」、不计入 n；
 * - 被选为 A / B 的行不在范围内也留着（灰掉）。
 */
function expectedTimeline(fixture: UnitFixture, scope: 'self' | 'subtree', selected: number[]): { sesnos: Set<number>; versions: number } {
  const inScope = scope === 'subtree' ? fixture.chain : fixture.selfSesnos;
  return {
    sesnos: new Set<number>([...inScope, ...fixture.attributeSesnos, ...selected]),
    versions: inScope.length,
  };
}

/** 面板缺省 A / B = 范围内最近两版（`defaultNodeVersionPair`）；本范围不足两版时为 null（面板选不出 A，这两条轻用例跳过） */
function latestTwo(fixture: UnitFixture, scope: 'self' | 'subtree'): { a: number; b: number } | null {
  const [b, a] = [...expectedTimeline(fixture, scope, []).sesnos].sort((x, y) => y - x);
  return a === undefined || b === undefined ? null : { a, b };
}

function latestTwoReason(fixture: UnitFixture, scope: 'self' | 'subtree'): string {
  return `单元 ${fixture.unit} 在面板落的范围「${scope === 'self' ? '仅自身' : '所有子节点'}」里不足两版，缺省 A / B 选不出来——换一个有成员的单元根`;
}

let main: UnitFixture | null = null;

test.beforeEach(async () => {
  const service = await serviceReason();
  test.skip(service !== null, service ?? '');
  const fixture = await loadUnitFixture(UNIT);
  test.skip(typeof fixture === 'string', typeof fixture === 'string' ? fixture : '');
  main = fixture as UnitFixture;
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

async function openComparePage(page: Page, unit: string, extra: Record<string, string> = {}): Promise<OpenedPage> {
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
    unit_refno: unit,
    compare_autorun: '1',
    ...extra,
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('model-unit-version-compare-panel')).toBeVisible({ timeout: 60_000 });
  return { pageErrors, historyRequests, elementAttributeRequests };
}

/** 等时间线列出来，读面板实际落的对比范围（单元根有成员 → 「所有子节点」；探不出成员 / 没成员 → 「仅自身」） */
async function activeScope(page: Page): Promise<'self' | 'subtree'> {
  await expect(page.locator('[data-testid="model-unit-compare-timeline"] > li').first()).toBeVisible({ timeout: 120_000 });
  const pressed = await page.getByTestId('model-unit-compare-scope-subtree').getAttribute('aria-pressed');
  return pressed === 'true' ? 'subtree' : 'self';
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

/**
 * 钉死 A / B 的全量检查点（README §2 那一串）：两版都有几何与 B 版 tombstone 两种现场共用，按 `impact_kind` 分支。
 */
async function runPinnedCompare(page: Page, fixture: UnitFixture, aSesno: number, bSesno: number): Promise<void> {
  const a = rowOf(fixture, aSesno);
  const b = rowOf(fixture, bSesno);
  const { pageErrors, historyRequests } = await openComparePage(page, fixture.unit, { compare_a: String(a.sesno), compare_b: String(b.sesno) });

  // 时间线：画出来的行与「本范围 n 版」按面板实际落的范围从服务端两张表算（`expectedTimeline`）；每一行那颗徽章显示的列也按范围
  // （「所有子节点」看单元列、「仅自身」看自身列，与面板 `rowImpact` 同一口径）
  // （2026-09-21 起时间线缺省只画最近 20 行、更早的折成「加载更早 n 版…」——数全表前先点开；不够 20 行就没这一行）
  const timelineRow = (sesno: number) => page.locator(`[data-testid="model-unit-compare-timeline"] > li[data-sesno="${sesno}"]`);
  const scope = await activeScope(page);
  const timeline = expectedTimeline(fixture, scope, [a.sesno, b.sesno]);
  await page.getByTestId('model-unit-compare-timeline-more').click({ timeout: 3_000 }).catch(() => undefined);
  await expect(page.locator('[data-testid="model-unit-compare-timeline"] > li')).toHaveCount(timeline.sesnos.size, { timeout: 120_000 });
  await expect(page.getByTestId('model-unit-compare-timeline-head')).toContainText(`本范围 ${timeline.versions} 版`);
  for (const row of fixture.elementRows.filter((item) => timeline.sesnos.has(item.sesno))) {
    const shown = scope === 'self' ? row.element_impact : row.unit_impact ?? row.element_impact;
    await expect(timelineRow(row.sesno)).toContainText(shown ?? '未变');
  }
  test.info().annotations.push({
    type: 'timeline',
    description: `${fixture.unit} 范围 ${scope} · 画出 ${timeline.sesnos.size} 行 · 本范围 ${timeline.versions} 版 · A ${a.sesno}（${a.impact_kind}）/ B ${b.sesno}（${b.impact_kind}）`,
  });
  // A / B 按 URL 选中，不是最近两版
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
  await expect(page.getByTestId('viewer-model-unit-side-badge')).toContainText(`B · ${formatModelUnitVersionTime(b.session_time ?? '')}`);
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
  await expect(page.getByTestId('viewer-model-unit-side-badge')).toContainText(`A · ${formatModelUnitVersionTime(a.session_time ?? '')}`);
  // 复现拖框工具遗留的禁用状态：进分屏必须归还 OrbitControls，左右任一半操作同一台 camera。
  await page.evaluate(() => {
    const viewer = (window as unknown as { __dtxViewer?: { controls: { enabled: boolean } } }).__dtxViewer;
    if (!viewer) throw new Error('__dtxViewer 不在 window 上');
    viewer.controls.enabled = false;
  });
  await page.getByTestId('model-unit-compare-split-mode').click();
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __dtxViewer?: { controls: { enabled: boolean } } }).__dtxViewer?.controls.enabled
  ))).toBe(true);
  await expect(page.getByTestId('model-unit-compare-split-summary')).toContainText(`左 A · sesno ${a.sesno}`);
  await expect(page.getByTestId('model-unit-compare-split-summary')).toContainText(`右 B · sesno ${b.sesno}`);
  await expect(page.getByTestId('viewer-model-unit-split-overlay')).toContainText(`A · ${formatModelUnitVersionTime(a.session_time ?? '')}`);
  await expect(page.getByTestId('viewer-model-unit-split-overlay')).toContainText(`B · ${formatModelUnitVersionTime(b.session_time ?? '')}`);
  await expect(page.getByTestId('viewer-model-unit-side-badge')).toHaveCount(0);

  const cameraPosition = () => page.evaluate(() => {
    const position = (window as unknown as { __dtxViewer?: { camera: { position: { toArray(): number[] } } } }).__dtxViewer?.camera.position;
    if (!position) throw new Error('__dtxViewer.camera 不在 window 上');
    return position.toArray();
  });
  const cameraDistance = () => page.evaluate(() => {
    const viewer = (window as unknown as { __dtxViewer?: {
      camera: { position: { x: number; y: number; z: number } };
      controls: { target: { x: number; y: number; z: number } };
    } }).__dtxViewer;
    if (!viewer) throw new Error('__dtxViewer 不在 window 上');
    const { position } = viewer.camera;
    const { target } = viewer.controls;
    return Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
  });
  const canvas = page.locator('canvas.viewer');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox, '三维画布没有可操作区域').toBeTruthy();
  const cameraBeforeLeft = await cameraPosition();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.25, canvasBox!.y + canvasBox!.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.35, canvasBox!.y + canvasBox!.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await cameraPosition())).not.toBe(JSON.stringify(cameraBeforeLeft));
  const cameraBeforeRight = await cameraPosition();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.75, canvasBox!.y + canvasBox!.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.65, canvasBox!.y + canvasBox!.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await cameraPosition())).not.toBe(JSON.stringify(cameraBeforeRight));
  const distanceBeforeWheel = await cameraDistance();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.75, canvasBox!.y + canvasBox!.height * 0.55);
  await page.mouse.wheel(0, -600);
  await expect.poll(cameraDistance).not.toBe(distanceBeforeWheel);

  // 分屏每格走不走描边合成器按这块 WebGL 上下文的显卡串定（2026-09-21 收口计划 P3-c，D6「留，但软渲染自动退回」）：
  // 软渲染（`PLAYWRIGHT_SOFTWARE_GL=1` 钉死 SwiftShader）→ 直接 render，分屏摘要下照实说一句（带显卡串）；
  // 真显卡（`PLAYWRIGHT_GPU=1` 钉死 ANGLE → D3D11；本机 Chrome 新 headless 缺省也拿得到）→ 合成器、没那一句。
  // 两档各跑一遍才算把这条验完；跑的是哪档记进 annotations。
  const splitOutline = await page.evaluate(
    () => (window as unknown as { __modelUnitVersionCompare?: { splitOutline?: { compositor: boolean; renderer: string | null } } }).__modelUnitVersionCompare?.splitOutline,
  );
  expect(splitOutline, '__modelUnitVersionCompare.splitOutline 没就位').toBeTruthy();
  test.info().annotations.push({ type: 'splitOutline', description: JSON.stringify(splitOutline) });
  const software = isSoftwareRendererName(splitOutline!.renderer);
  expect(splitOutline!.compositor).toBe(!software);
  const directRenderNote = page.getByTestId('model-unit-compare-split-direct-render');
  await expect(directRenderNote).toHaveCount(software ? 1 : 0);
  if (software) await expect(directRenderNote).toContainText(splitOutline!.renderer!);
  if (process.env.PLAYWRIGHT_GPU) expect(software, `PLAYWRIGHT_GPU=1 却落在软渲染：${splitOutline!.renderer}`).toBe(false);
  if (process.env.PLAYWRIGHT_SOFTWARE_GL) expect(software, `PLAYWRIGHT_SOFTWARE_GL=1 却认成真显卡：${splitOutline!.renderer}`).toBe(true);

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
}

test('钉死的 A / B（缺省 BRAN 24384_23257 626 → 630）：compare_a / compare_b 开面板、时间线与版本表来自服务端、A/B 按 URL 选中、对比结果与两侧对象数自洽、角标 / 图例 / 只看差异、分屏、树差异、关闭 DELETE 快照', async ({ page }) => {
  const reason = pinnedPairReason(main!, PINNED_A, PINNED_B, 'MODEL_VERSION_E2E', '这条要两版都有几何的一对');
  test.skip(reason !== null, reason ?? '');
  await runPinnedCompare(page, main!, PINNED_A, PINNED_B);
});

test('钉死的整单元被删现场（缺省 EQUI 24384_26480 602 → 604，B 版 tombstone）：B 侧 0 对象且全部删除、幽灵行「已删除」、属性面板不拉当前会话、「在 3D 中定位」飞得动、关闭只 DELETE 有几何的那一份', async ({ page }) => {
  const fixture = TOMBSTONE_UNIT === UNIT ? main! : await loadUnitFixture(TOMBSTONE_UNIT);
  test.skip(typeof fixture === 'string', typeof fixture === 'string' ? fixture : '');
  const tombstone = fixture as UnitFixture;
  const reason = pinnedPairReason(tombstone, TOMBSTONE_A, TOMBSTONE_B, 'MODEL_VERSION_E2E_TOMBSTONE', '这条要「整单元被删」的现场');
  test.skip(reason !== null, reason ?? '');
  const kind = rowOf(tombstone, TOMBSTONE_B).impact_kind;
  test.skip(kind !== 'tombstone', `单元 ${tombstone.unit} 的 ${TOMBSTONE_B} 是 ${kind}、不是 tombstone——这条要「整单元被删」的现场，换 MODEL_VERSION_E2E_TOMBSTONE_UNIT / _A / _B`);
  await runPinnedCompare(page, tombstone, TOMBSTONE_A, TOMBSTONE_B);
});

test('不传 compare_a / compare_b：A / B 自动选时间线最近两版（跟活库走，只留轻断言）、对比跑完、两侧对象数与 tombstone 口径自洽、关闭 DELETE = generate', async ({ page }) => {
  const fixture = main!;
  const { pageErrors, historyRequests } = await openComparePage(page, fixture.unit);
  const scope = await activeScope(page);
  const pair = latestTwo(fixture, scope);
  test.skip(pair === null, latestTwoReason(fixture, scope));
  const { a, b } = pair!;
  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(a), { timeout: 120_000 });
  await expect(page.getByTestId('model-unit-compare-b')).toHaveAttribute('data-sesno', String(b));

  const state = await waitForCompare(page);
  expect(state.beforeSesno).toBe(a);
  expect(state.afterSesno).toBe(b);
  // 只改属性的会话不在单元表里：几何同它前一版，按「有几何」算
  const kindOf = (sesno: number) => fixture.versions.find((row) => row.sesno === sesno)?.impact_kind ?? 'attribute-only';
  const kinds = { a: kindOf(a), b: kindOf(b) };
  if (kinds.b === 'tombstone') expect(state.afterObjects).toBe(0);
  else expect(state.afterObjects).toBeGreaterThan(0);
  if (kinds.a !== 'tombstone') expect(state.beforeObjects).toBeGreaterThan(0);
  await expect(page.getByTestId('model-unit-compare-error')).toHaveCount(0);
  test.info().annotations.push({ type: 'latest-two', description: `${fixture.unit} 范围 ${scope} · A ${a}（${kinds.a}）→ B ${b}（${kinds.b}）· 对象 ${state.beforeObjects} / ${state.afterObjects}` });

  // 关闭：有几何的每一侧至多生成一份（两版几何承诺相同时只取一份），生成过的每一份都有一条 DELETE
  const generated = historyRequests.filter((r) => r.method === 'POST' && /history\/generate/.test(r.url)).length;
  const withGeometry = [kinds.a, kinds.b].filter((kind) => kind !== 'tombstone').length;
  expect(generated).toBeGreaterThanOrEqual(Math.min(withGeometry, 1));
  expect(generated).toBeLessThanOrEqual(withGeometry);
  await page.getByTestId('model-unit-compare-close').click();
  await expect.poll(() => historyRequests.filter((r) => r.method === 'DELETE').length, { timeout: 15_000 }).toBe(generated);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('B 版之后又被删的构件：幽灵行标「当前已不在」且徽章仍是「增」、属性面板不拉当前会话、「在 3D 中定位」照样找得到', async ({ page }) => {
  const fixture = GHOST_UNIT === UNIT ? main! : await loadUnitFixture(GHOST_UNIT);
  test.skip(typeof fixture === 'string', typeof fixture === 'string' ? fixture : '');
  const ghost = fixture as UnitFixture;
  const reason = pinnedPairReason(ghost, GHOST_A, GHOST_B, 'MODEL_VERSION_E2E_GHOST', '这条要「B 版新增、之后又被删」的现场');
  test.skip(reason !== null, reason ?? '');

  const { pageErrors, elementAttributeRequests } = await openComparePage(page, ghost.unit, {
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

test('URL 指定的版本不在时间线里：回落最近两版并在面板里说明', async ({ page }) => {
  const fixture = main!;
  const latest = Math.max(...fixture.chain, ...fixture.attributeSesnos);
  const bogus = latest + 100_000;
  await openComparePage(page, fixture.unit, { compare_a: String(bogus), compare_b: String(latest) });
  const scope = await activeScope(page);
  const pair = latestTwo(fixture, scope);
  test.skip(pair === null, latestTwoReason(fixture, scope));
  const { a, b } = pair!;
  await expect(page.getByTestId('model-unit-compare-a')).toHaveAttribute('data-sesno', String(a), { timeout: 120_000 });
  await expect(page.getByTestId('model-unit-compare-b')).toHaveAttribute('data-sesno', String(b));
  await waitForCompare(page);
  await expect(page.getByTestId('model-unit-compare-error')).toContainText(`compare_a=${bogus}`);
  await page.getByTestId('model-unit-compare-close').click();
});
