/**
 * 空间查询抽屉 · gen-model-v1 真机 e2e 的公共件（plan `docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md`
 * §7「功能测试记录（2026-09-14 01:30）」那批 `%TEMP%\spatial-ui-*.mjs` 脚本整理进仓）。
 *
 * 前置与其它 live 型 e2e 同一态度：gen-model 在 `GEN_MODEL_V1_BASE_URL`（缺省 `http://127.0.0.1:8022`）上运行、空间树 `ready`、
 * 且该服务认得夹具库 7997（AvevaMarineSample）；不满足就 `test.skip`，不把环境缺失误报成回归。
 * 页面对着 Playwright 的 `baseURL`（Vite dev server `:3101`），`?gm_backend=` 指到那台服务。
 */
import { expect, test, type Page, type Response } from '@playwright/test';

export const GEN_MODEL_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';

/** 夹具全部来自 plan §7 的真机记录（AvevaMarineSample，dbnum 7997）。 */
export const FIXTURE = {
  project: 'AvevaMarineSample',
  dbnum: 7997,
  /** BRAN：`show_refno` 夹具，生成后 12 refno / 22 对象在场景里；子树盒中心 ≈ (5963.8, 9972.2, 16552.0) mm */
  bran: '24381_145018',
  /** BRAN 的成员 VALV（叶子：查看器里它自己的盒 = 服务端 `refno_aabb_center` 用的盒） */
  leafValv: '24381_145035',
  /** BRAN 的父级 PIPE：自身与成员都没加载几何，「当前选中」要走 refno 兜底由服务端解中心 */
  ownerPipe: '24381_144975',
  /** 树里没有的 refno：服务端 404 `not_found` 折成「…还没生成过模型」 */
  missing: '1_1',
} as const;

export function toSlashRefno(refno: string): string {
  return refno.replace(/_/g, '/');
}

type SpatialTreeHealth = {
  state?: string;
  db_watermarks?: Record<string, unknown>;
  snapshot_watermarks?: Record<string, unknown>;
};

type GenModelHealth = {
  spatial_tree?: SpatialTreeHealth;
};

/**
 * live 前置探测：服务在、空间树 ready、且水位表里有夹具库（没有 7997 的服务连 `show_refno` 都生成不出来，
 * 跑下去只会把「环境不对」报成一串失败）。返回 null = 可以跑，否则是跳过原因。
 */
export async function probeGenModelForSpatialUi(): Promise<string | null> {
  let health: GenModelHealth;
  try {
    const response = await fetch(`${GEN_MODEL_BASE}/api/v1/health`);
    if (!response.ok) return `gen-model health HTTP ${response.status}（${GEN_MODEL_BASE}）`;
    health = await response.json() as GenModelHealth;
  } catch {
    return `gen-model 不在 ${GEN_MODEL_BASE}`;
  }
  const tree = health.spatial_tree;
  if (!tree) return 'health 里没有 spatial_tree（服务太旧，没有 /api/v1/spatial/*）';
  if (tree.state !== 'ready' && tree.state !== 'ready_empty') {
    return `spatial_tree.state = ${String(tree.state)}，不是 ready`;
  }
  const watermarks = tree.db_watermarks ?? tree.snapshot_watermarks;
  if (watermarks && String(FIXTURE.dbnum) in watermarks) return null;
  // 水位表只收进过树的库；夹具库一个模型都没生成过时不在里面，再问一次 /dbnums 才算数（这一发在服务端要扫库文件，只在这时打）
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const response = await fetch(`${GEN_MODEL_BASE}/api/v1/dbnums`, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!response.ok) return `/api/v1/dbnums HTTP ${response.status}`;
    const body = await response.json() as { dbnums?: { dbnum: number }[] };
    const dbnums = (body.dbnums ?? []).map((row) => row.dbnum);
    if (!dbnums.includes(FIXTURE.dbnum)) {
      return `${GEN_MODEL_BASE} 没有夹具库 ${FIXTURE.dbnum}（/dbnums：${dbnums.join(', ') || '空'}）`;
    }
    return null;
  } catch (error) {
    return `/api/v1/dbnums 取不到：${error instanceof Error ? error.message : String(error)}`;
  }
}

export type SpatialUiPageOptions = {
  /** 抽屉打开时的模式；`null` = 不主动打开（URL 入口用例自己会开） */
  mode?: 'range' | 'distance' | null;
  /** 页面带 `show_refno=<BRAN>` 并等它加载完（缺省 true）；只查服务端、不碰场景的用例可关 */
  withModel?: boolean;
  /** 追加到页面 URL 的参数 */
  extraParams?: Record<string, string>;
};

export type SpatialUiPage = {
  page: Page;
  /** 页面抛出的未捕获错误；用例末尾断言为空 */
  pageErrors: string[];
};

/**
 * 打开页面（gen-model-v1 源 + 夹具 BRAN），等场景与查看器就绪，再经 `openSpatialQuery` 事件把抽屉打开。
 * Vite HMR 的 websocket 不接到服务端：并行会话改 plant3d-web 时整页刷新会把查看器和抽屉一起拆掉（§7 22:32 的教训）。
 */
/**
 * 浏览器侧：把 `/src/x.ts` 解成页面实际加载的那个模块 URL。Vite dev 对 HMR 更新过的模块在 URL 上挂 `?t=<stamp>`，
 * 此后每次整页加载都用带戳的 URL；测试里裸 `import('/src/x.ts')` 会另起一份模块实例，模块级单例（`useSpatialQuery` /
 * `useViewerContext` / `useSelectionStore`）就不再是页面那一份——store 在 setup 之外重建还会撞上 vue-query 的注入上下文报错
 * （2026-09-20 在跑了一天的 dev :3111 上真机撞到）。没在资源表里（从没更新过）就还用裸路径。
 */
type AppModuleWindow = Window & { __appModuleUrl?: (path: string) => string };

async function installAppModuleResolver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as AppModuleWindow).__appModuleUrl = (path: string) => {
      const hit = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => {
        try {
          return new URL(name).pathname === path;
        } catch {
          return false;
        }
      });
      return hit ?? path;
    };
  });
}

export async function openSpatialUiPage(page: Page, options: SpatialUiPageOptions = {}): Promise<SpatialUiPage> {
  const withModel = options.withModel ?? true;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installAppModuleResolver(page);

  const devHost = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:3101').host;
  await page.routeWebSocket((url) => url.host === devHost, () => {
    // 不 connectToServer：Vite 客户端以为断线、只会轮询 ping，不再收到 full-reload
  });

  const params = new URLSearchParams({
    model_source: 'gen-model-v1',
    gm_backend: GEN_MODEL_BASE,
    output_project: FIXTURE.project,
    ...(withModel ? { show_refno: FIXTURE.bran } : {}),
    ...(options.extraParams ?? {}),
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await page.waitForFunction(() => !!(window as unknown as { __xeokitViewer?: { scene?: unknown } }).__xeokitViewer?.scene, null, { timeout: 60_000 });

  const onboardingClose = page.getByRole('button', { name: '关闭向导', exact: true });
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click({ force: true }).catch(() => undefined);
  }

  if (withModel) {
    await waitForModelLoaded(page);
  }

  if (options.mode !== null) {
    await openDrawer(page, options.mode ?? 'range');
  }
  return { page, pageErrors };
}

/** `show_refno` 链路收尾：`__dtxAfterInstancesLoaded` 写 `__dtxLastLoadedDbno`（与 mesh-direct / p5 同一探针）。 */
export async function waitForModelLoaded(page: Page, dbnum: number = FIXTURE.dbnum): Promise<void> {
  await expect.poll(
    async () => page.evaluate(() =>
      // 页面实际加载的那份模块（见 installAppModuleResolver）；裸路径会另起一份 viewerRef 为空的实例
      import((window as AppModuleWindow).__appModuleUrl?.('/src/composables/useViewerContext.ts') ?? '/src/composables/useViewerContext.ts').then((mod) => {
        const viewer = mod.useViewerContext().viewerRef.value as { __dtxLastLoadedDbno?: number } | null;
        return viewer?.__dtxLastLoadedDbno ?? null;
      }),
    ),
    { timeout: 180_000, intervals: [1000, 2000, 5000] },
  ).toBe(dbnum);
}

export async function openDrawer(page: Page, mode: 'range' | 'distance'): Promise<void> {
  await expect.poll(async () => {
    await page.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent('openSpatialQuery', { detail }));
    }, { mode });
    return page.getByRole('button', { name: '执行空间查询', exact: true }).isVisible().catch(() => false);
  }, { timeout: 30_000, intervals: [500, 1000] }).toBe(true);
  await page.getByRole('button', { name: mode === 'range' ? '范围查询' : '距离查询', exact: true }).click();
}

/** 「更多条件」折叠块：展开一次（已展开就不动）。 */
export async function expandAdvanced(page: Page): Promise<void> {
  const toggle = page.getByTestId('spatial-advanced-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(page.getByTestId('spatial-page-limit')).toBeVisible();
}

/** 结果区默认收起，点「查看结果」展开（已展开就不动）。 */
export async function expandResults(page: Page): Promise<void> {
  const toggle = page.getByTestId('spatial-results-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.textContent())?.includes('查看结果')) {
    await toggle.click();
  }
}

export async function setRadiusMeters(page: Page, meters: number): Promise<void> {
  await page.getByLabel(/查询半径/).fill(String(meters));
}

export async function setPageLimit(page: Page, limit: number): Promise<void> {
  await expandAdvanced(page);
  await page.getByTestId('spatial-page-limit').fill(String(limit));
}

/** 切到坐标输入（范围查询「手输坐标」/ 距离查询「通过坐标」）并填 X/Y/Z（mm）。 */
export async function fillCenter(
  page: Page,
  center: { x: number; y: number; z: number },
  options: { source?: '手输坐标' | '通过坐标' } = {},
): Promise<void> {
  await page.getByRole('button', { name: options.source ?? '手输坐标', exact: true }).click();
  await page.locator('label:has-text("X") input').fill(String(center.x));
  await page.locator('label:has-text("Y") input').fill(String(center.y));
  await page.locator('label:has-text("Z") input').fill(String(center.z));
}

export type NearbyResponseBody = {
  results?: { refno: string; noun: string; dbnum: number | null; name: string | null; distance: number; spec_value?: number }[];
  center?: { x: number; y: number; z: number; source: string };
  total_count?: number;
  returned_count?: number;
  page?: number;
  per_page?: number;
  has_more?: boolean;
  filter_options?: { nouns?: { value: string; count: number; is_negative: boolean }[] };
  groups?: { dbnum: number; count: number }[];
};

export type NearbyExchange = {
  params: URLSearchParams;
  status: number;
  body: NearbyResponseBody;
};

function isNearbyUrl(url: string): boolean {
  const pathname = new URL(url).pathname;
  return pathname.endsWith('/api/v1/spatial/nearby');
}

/**
 * 登记一次对 `GET /api/v1/spatial/nearby` 的等待（`/nearby/refnos` 与 `/negative-nouns` 不算），响应到了再等 store 落定
 * （合并 / 取全集 / 本地扫描都在响应之后，直接读摘要会读到上一轮的）。先登记再点按钮，免得响应比 `waitForResponse` 先到。
 */
export async function nextNearby(page: Page, predicate: (params: URLSearchParams) => boolean = () => true): Promise<NearbyExchange> {
  const response = await page.waitForResponse((candidate) => {
    if (!isNearbyUrl(candidate.url())) return false;
    return predicate(new URL(candidate.url()).searchParams);
  }, { timeout: 60_000 });
  const exchange = await readNearby(response);
  await waitForSettled(page);
  return exchange;
}

export async function readNearby(response: Response): Promise<NearbyExchange> {
  const body = response.ok() ? await response.json() as NearbyResponseBody : {};
  return { params: new URL(response.url()).searchParams, status: response.status(), body };
}

/** 等 store 从「查询中」回到 ready / error（点按钮那一刻 status 已同步离开 ready，这里不会把上一轮的 ready 当成这一轮的）。 */
export async function waitForSettled(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() =>
    import((window as AppModuleWindow).__appModuleUrl?.('/src/composables/useSpatialQuery.ts') ?? '/src/composables/useSpatialQuery.ts').then((mod) => mod.useSpatialQuery().status.value as string),
  ), { timeout: 60_000, intervals: [100, 250, 500] }).toMatch(/^(ready|error|idle)$/);
}

/** 点「执行空间查询」并拿到它发出的那一发 `/nearby`。 */
export async function submitAndCapture(page: Page, predicate?: (params: URLSearchParams) => boolean): Promise<NearbyExchange> {
  const pending = nextNearby(page, predicate);
  await page.getByRole('button', { name: '执行空间查询', exact: true }).click();
  return pending;
}

export type SummaryCounts = { total: number; currentPage: number; loaded: number; unloaded: number };

const SUMMARY_RE = /共\s*(\d+)\s*项，当前页\s*(\d+)\s*项，已加载\s*(\d+)\s*项，未加载\s*(\d+)\s*项/;

export function summaryLocator(page: Page) {
  return page.locator('text=/共\\s*\\d+\\s*项，当前页\\s*\\d+\\s*项，已加载\\s*\\d+\\s*项，未加载\\s*\\d+\\s*项/');
}

export async function readSummary(page: Page): Promise<SummaryCounts> {
  const summary = summaryLocator(page);
  await expect(summary).toBeVisible({ timeout: 60_000 });
  const matched = (await summary.textContent())?.match(SUMMARY_RE);
  expect(matched, '结果摘要应为「共 N 项，当前页 M 项，已加载 L 项，未加载 U 项」').toBeTruthy();
  return {
    total: Number(matched![1]),
    currentPage: Number(matched![2]),
    loaded: Number(matched![3]),
    unloaded: Number(matched![4]),
  };
}

/** 结果区当前页各行的 refno，按显示顺序（取每行「飞行定位」按钮的 `data-refno`）。 */
export async function resultRowRefnos(page: Page): Promise<string[]> {
  return page.locator('[data-testid="spatial-result-group"] [data-testid="locate-spatial-result"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.refno ?? ''));
}

/**
 * 结果区里某个 refno 的那一行（PR-B2 剪辑后是单行 `spatial-result-row`，`data-refno` 标 refno；有名字的构件行上显名字、
 * refno 只在 title 里，所以按属性找而不按文字找）。
 */
export function resultRow(page: Page, refno: string) {
  return page.locator(`[data-testid="spatial-result-row"][data-refno="${refno}"]`).first();
}

/**
 * 结果动作里的「复制 Refno」是一个按钮点开二选（PR-B2 剪辑）：点开菜单后返回「本页」/「全部」两个选项的定位器
 * （树态没有「本页」）。
 */
export async function openCopyRefnosMenu(page: Page) {
  await page.getByTestId('copy-refnos-menu').click();
  await expect(page.getByTestId('copy-refnos-options')).toBeVisible();
  return {
    currentPage: page.getByTestId('copy-current-page-refnos'),
    all: page.getByTestId('copy-all-returned-refnos'),
  };
}

export function errorBanner(page: Page) {
  return page.getByText(/查看器未就绪|无法解析当前选中构件的位置|空间查询失败|加载模型失败/);
}

/** 查看器里若干 refno 的状态（`window.__xeokitViewer.scene.objects`）。 */
export async function sceneObjectStates(page: Page, refnos: string[]): Promise<Record<string, { present: boolean; visible: boolean; xrayed: boolean; selected: boolean }>> {
  return page.evaluate((ids) => {
    const scene = (window as unknown as {
      __xeokitViewer: { scene: { objects: Record<string, { visible?: boolean; xrayed?: boolean; selected?: boolean } | undefined> } };
    }).__xeokitViewer.scene;
    const out: Record<string, { present: boolean; visible: boolean; xrayed: boolean; selected: boolean }> = {};
    for (const id of ids) {
      const object = scene.objects[id];
      out[id] = {
        present: !!object,
        visible: object?.visible !== false,
        xrayed: object?.xrayed === true,
        selected: object?.selected === true,
      };
    }
    return out;
  }, refnos);
}

/** 查看器里已加载（有几何）的 refno 集合与全部对象 id 的 X-Ray 状态。 */
export async function sceneOverview(page: Page): Promise<{ loadedRefnos: string[]; xrayedIds: string[]; objectIds: string[] }> {
  return page.evaluate(() => {
    const scene = (window as unknown as {
      __xeokitViewer: {
        scene: {
          objectIds: string[];
          objects: Record<string, { xrayed?: boolean } | undefined>;
          getLoadedRefnos?: () => string[];
        };
      };
    }).__xeokitViewer.scene;
    const objectIds = scene.objectIds.slice();
    return {
      loadedRefnos: scene.getLoadedRefnos ? scene.getLoadedRefnos() : objectIds,
      xrayedIds: objectIds.filter((id) => scene.objects[id]?.xrayed === true),
      objectIds,
    };
  });
}

/** 把某个 refno 设成全局选中（与查看器点选 / 模型树点选写的是同一个 store）。 */
export async function selectRefno(page: Page, refno: string): Promise<void> {
  await page.evaluate((id) =>
    import((window as AppModuleWindow).__appModuleUrl?.('/src/composables/useSelectionStore.ts') ?? '/src/composables/useSelectionStore.ts').then((mod) => {
      mod.setGlobalSelectedRefno(id);
    }), refno);
}

export type StoreResultItem = {
  refno: string;
  dbnum: number | null;
  matchedBy: 'viewer-local' | 'server-spatial-index' | 'merged';
  loaded: boolean;
  visible: boolean;
  distance: number | null;
  /** 服务端派生的专业值（ADR 0067 起 v1 也有；本地独有项由 store 补 0） */
  specValue: number;
};

export type StoreState = {
  center: { x: number; y: number; z: number };
  rangeCenterSource: string;
  selectedCenterRefno: string | null;
  items: StoreResultItem[];
  total: number | null;
  fullMatchesCount: number | null;
};

/** 抽屉 store 的几格状态（模块级单例，与页面里的抽屉同一份）。 */
export async function readStoreState(page: Page): Promise<StoreState> {
  return page.evaluate(() =>
    import((window as AppModuleWindow).__appModuleUrl?.('/src/composables/useSpatialQuery.ts') ?? '/src/composables/useSpatialQuery.ts').then((mod) => {
      const store = mod.useSpatialQuery();
      const items = (store.resultSet.value?.items ?? []) as StoreResultItem[];
      return {
        center: { ...store.draft.center },
        rangeCenterSource: store.draft.rangeCenterSource,
        selectedCenterRefno: store.selectedCenterRefno.value,
        items: items.map((item) => ({
          refno: item.refno,
          dbnum: typeof item.dbnum === 'number' ? item.dbnum : null,
          matchedBy: item.matchedBy,
          loaded: item.loaded,
          visible: item.visible,
          distance: item.distance,
          specValue: typeof item.specValue === 'number' ? item.specValue : 0,
        })),
        total: store.resultSet.value?.total ?? null,
        fullMatchesCount: store.resultSet.value?.fullMatches?.refnos.length ?? null,
      } satisfies StoreState;
    }),
  );
}

/**
 * 结果区的行序 = 分组（缺省**按专业**：spec_value 升序、0「其他」排最前——ADR 0067 起 v1 源有专业维度、抽屉缺省按专业分组；
 * 切到「按库」则 dbnum 升序、没库号的归「库未知」排最前）、组内保持 store 顺序（服务端页序 + 末尾的本地独有项）。
 * 用 store 的条目算出应有的 DOM 顺序，与 `resultRowRefnos` 对。
 */
export function expectedRowOrder(items: StoreResultItem[], dimension: 'spec' | 'dbnum' = 'spec'): string[] {
  const groups = new Map<number, string[]>();
  for (const item of items) {
    const key = dimension === 'dbnum' ? (item.dbnum ?? -1) : item.specValue;
    const list = groups.get(key) ?? [];
    list.push(item.refno);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]).flatMap(([, refnos]) => refnos);
}

/**
 * 直接问服务端某 refno 的 `refno_aabb_center`（读接口，不生成）。树里没有它回 null。
 * `show_refno` 刚把模型生成出来时空间树可能还没刷进去，`waitMs` > 0 就每秒再问，直到有盒或超时。
 */
export async function fetchServerCenter(refno: string, options: { waitMs?: number } = {}): Promise<{ x: number; y: number; z: number } | null> {
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  const params = new URLSearchParams({ refno: toSlashRefno(refno), radius: '1000', per_page: '1' });
  for (;;) {
    const response = await fetch(`${GEN_MODEL_BASE}/api/v1/spatial/nearby?${params.toString()}`);
    if (response.ok) {
      const body = await response.json() as NearbyResponseBody;
      if (body.center) return { x: body.center.x, y: body.center.y, z: body.center.z };
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * 一个生成根（BRAN）在 gen-model 记录里的全部 refno（`a_b`，含根自己——隐式直管 TUBI 就挂在根的 refno 上）。
 * 走 `POST model/records`（读接口；`show_refno` 已把这一根生成过，不用再 ensure）。「管件带直段」的 e2e 用它算命中管件所属 BRAN 的整体。
 */
export async function fetchGenerationRootRefnos(root: string): Promise<Set<string>> {
  const out = new Set<string>([root.replace(/\//g, '_')]);
  let cursor: number | null | undefined = undefined;
  for (;;) {
    const response = await fetch(`${GEN_MODEL_BASE}/api/v1/model/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation_root: toSlashRefno(root), limit: 5000, ...(cursor != null ? { cursor } : {}) }),
    });
    if (!response.ok) throw new Error(`model/records ${root} → HTTP ${response.status}`);
    const body = await response.json() as { items?: { refno?: string }[]; cursor?: number | null };
    for (const item of body.items ?? []) {
      const refno = String(item.refno ?? '').replace(/\//g, '_');
      if (refno) out.add(refno);
    }
    if (body.cursor == null) return out;
    cursor = body.cursor;
  }
}

export function expectPointClose(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }, toleranceMm = 1): void {
  expect(Math.abs(actual.x - expected.x), `x ${actual.x} vs ${expected.x}`).toBeLessThanOrEqual(toleranceMm);
  expect(Math.abs(actual.y - expected.y), `y ${actual.y} vs ${expected.y}`).toBeLessThanOrEqual(toleranceMm);
  expect(Math.abs(actual.z - expected.z), `z ${actual.z} vs ${expected.z}`).toBeLessThanOrEqual(toleranceMm);
}

export function paramPoint(params: URLSearchParams): { x: number; y: number; z: number } {
  return { x: Number(params.get('x')), y: Number(params.get('y')), z: Number(params.get('z')) };
}
