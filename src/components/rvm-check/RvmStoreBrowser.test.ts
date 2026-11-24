/**
 * 库内结果一路点下去：全部批次 → 一个批次按上级根的汇总 → 上级根下的单元 → 单元的差异明细，
 * 以及加载中 / 没有数据 / 读不到三种状态、筛选和翻页各发出什么请求。接口全部打桩，数据形状取自真实库。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import RvmStoreBrowser from './RvmStoreBrowser.vue';
import { useRvmStoreBrowser } from './useRvmStoreBrowser';

import type {
  RvmStoreMismatch,
  RvmStoreMismatchFilter,
  RvmStoreReasonCount,
  RvmStoreRollupRow,
  RvmStoreRun,
  RvmStoreRunFilter,
} from '@/api/rvmCheckStoreApi';

import { GenModelV1ApiError } from '@/api/genModelV1Api';

const api = vi.hoisted(() => ({
  fetchRvmStoreRollup: vi.fn(),
  fetchRvmStoreRuns: vi.fn(),
  fetchRvmStoreMismatches: vi.fn(),
  fetchRvmStoreReasons: vi.fn(),
}));
const locateRow = vi.hoisted(() => vi.fn(async () => null));

vi.mock('@/api/rvmCheckStoreApi', () => ({ RVM_STORE_MAX_LIMIT: 5000, ...api }));
vi.mock('./useRvmMismatchLocate', () => ({
  useRvmMismatchLocate: () => ({ resolved: {}, locateRow, showProblems: vi.fn(), clear: vi.fn() }),
}));

const ZONE_BATCH = 'accept-20261110/7999-zone';
const ROOT_BATCH = 'rvm-check-fused/all';
const SITE = '24383/80211';

function rollupRow(overrides: Partial<RvmStoreRollupRow>): RvmStoreRollupRow {
  return {
    batch_id: ZONE_BATCH,
    dbnum: 7999,
    root_refno: SITE,
    root_noun: 'SITE',
    root_name: '/1RX-ELECBJ',
    mode: 'zone',
    runs: 120,
    units: { zone: 119, fallback: 1 },
    status: { pass: 115, empty: 2, fail: 2, 'no-baseline': 1 },
    clean: false,
    not_clean_runs: 3,
    not_clean: [{ refno: '24383/97823', noun: 'ZONE', name: '/1RX02-LCT', status: 'fail' }],
    counts: { both: 8829, exact: 8826, off: 3, only_baseline: 0, only_generated: 0, kind_differ: 0 },
    mismatch_total: 4,
    seconds: { resolve: 0, generate: 54, e3d_export: 17.1, compare: 0 },
    gen_peak_private_mb: 270,
    finished_at: '2026-11-10T11:58:56.149334+08:00',
    finished_unix_ms: 1794283136149,
    ...overrides,
  };
}

const ROLLUP: RvmStoreRollupRow[] = [
  rollupRow({}),
  rollupRow({
    batch_id: ROOT_BATCH,
    dbnum: 8000,
    root_refno: '24384/22399',
    root_name: '/1RX03-EQUI',
    mode: 'root',
    runs: 1,
    units: { root: 1 },
    status: { fail: 1 },
    not_clean_runs: 1,
    not_clean: [{ refno: '24384/22399', noun: 'SITE', name: '/1RX03-EQUI', status: 'fail' }],
    counts: { both: 1981, exact: 1979, off: 1, only_baseline: 1, only_generated: 38, kind_differ: 0 },
    mismatch_total: 40,
    finished_at: '2026-11-08T15:40:19.491359700+08:00',
    finished_unix_ms: 1794123619491,
  }),
  rollupRow({
    batch_id: ROOT_BATCH,
    dbnum: 8000,
    root_refno: '24384/26547',
    root_name: '/AIOS-INC-P79',
    mode: 'root',
    runs: 1,
    units: { root: 1 },
    status: { 'no-baseline': 1 },
    not_clean_runs: 1,
    not_clean: [{ refno: '24384/26547', noun: 'SITE', name: '/AIOS-INC-P79', status: 'no-baseline' }],
    counts: { both: 0 },
    mismatch_total: 1,
    finished_at: '2026-11-08T15:40:15.966060200+08:00',
    finished_unix_ms: 1794123615966,
  }),
];

function run(overrides: Partial<RvmStoreRun>): RvmStoreRun {
  return {
    run_id: `${ZONE_BATCH}/ams7999/24383_97823`,
    source: 'batch',
    batch_id: ZONE_BATCH,
    refno: '24383/97823',
    dbnum: 7999,
    noun: 'ZONE',
    name: '/1RX02-LCT',
    unit: 'zone',
    root_refno: SITE,
    root_noun: 'SITE',
    root_name: '/1RX-ELECBJ',
    verdict: 'pass',
    status: 'pass',
    stage: 'compare',
    message: '一致：1773 件全部对上',
    counts: { both: 1773, exact: 1773, off: 0, only_baseline: 0, only_generated: 0, kind_differ: 0 },
    mismatch_total: 0,
    mismatch_by_kind: {},
    mismatch_by_category: {},
    seconds: { resolve: 0, generate: 7.5, e3d_export: 0.9, compare: 0 },
    gen_peak_private_mb: 270,
    finished_at: '2026-11-10T11:58:56.149334+08:00',
    finished_unix_ms: 1794283136149,
    ...overrides,
  };
}

const FAILED_ROOT = run({
  run_id: `${ROOT_BATCH}/ams8000/24384_22399`,
  batch_id: ROOT_BATCH,
  refno: '24384/22399',
  dbnum: 8000,
  noun: 'SITE',
  name: '/1RX03-EQUI',
  unit: null,
  root_refno: null,
  verdict: 'fail',
  status: 'fail',
  message: '不一致：偏差 1，仅 E3D 1，仅生成 38，种类不同 0',
  counts: { both: 1981, exact: 1979, off: 1, only_baseline: 1, only_generated: 38, kind_differ: 0 },
  mismatch_total: 40,
  mismatch_by_kind: { aabb_shifted: 1, extra_in_generated: 38, missing_unnamed_element: 1 },
  mismatch_by_category: { off: 1, only_baseline: 1, only_generated: 38 },
  artifact_dir: 'D:\\out\\rvm-check-fused\\all\\ams8000\\24384_22399',
  files: ['e3d.rvm', 'compare.json', 'run.json'],
  gen_ledger: { visited: 4, generated: 1, skipped: 0, evidence_pending: { ATTA: 2 } },
});

const NO_BASELINE_ROOT = run({
  run_id: `${ROOT_BATCH}/ams8000/24384_26547`,
  batch_id: ROOT_BATCH,
  refno: '24384/26547',
  dbnum: 8000,
  noun: 'SITE',
  name: '/AIOS-INC-P79',
  unit: null,
  root_refno: null,
  verdict: 'fail',
  status: 'no-baseline',
  stage: 'e3d_export',
  message: '基准目录里没有 baselines\\ams8000_24384_26547.rvm',
  counts: { both: 0 },
  mismatch_total: 1,
  mismatch_by_kind: { e3d_export_failed: 1 },
  mismatch_by_category: { stage_failure: 1 },
});

function mismatch(overrides: Partial<RvmStoreMismatch>): RvmStoreMismatch {
  return {
    run_id: FAILED_ROOT.run_id,
    batch_id: ROOT_BATCH,
    refno: '24384/22399',
    dbnum: 8000,
    seq: 0,
    category: 'off',
    reason_kind: 'aabb_shifted',
    reason: '尺寸一致、位置偏移 (497.8, 43.594, 0.000) mm（最大轴差 497.8 mm，容差 0.500 mm）',
    severity: 'error',
    name: 'BOX 1 /1-LNR-Q005-PJ',
    noun: 'BOX',
    max_axis_delta_mm: 497.8250123527323,
    baseline_kinds: ['Box'],
    generated_kinds: ['Box'],
    baseline_aabb: [-652.825, -338.594, -275, -342.825, 251.406, 275],
    generated_aabb: [-155, -295, -275, 155, 295, 275],
    ...overrides,
  };
}

const FAILED_ROWS: RvmStoreMismatch[] = [
  mismatch({}),
  mismatch({
    seq: 1,
    category: 'only_baseline',
    reason_kind: 'missing_unnamed_element',
    reason: 'E3D 导出有、生成侧没有：BOX 1 of EQUIPMENT /1-LNR-Y302-PJ',
    name: 'BOX 1 of EQUIPMENT /1-LNR-Y302-PJ',
    noun: '',
    max_axis_delta_mm: undefined,
    baseline_kinds: [],
    generated_kinds: [],
    baseline_aabb: undefined,
    generated_aabb: undefined,
  }),
  mismatch({
    seq: 2,
    category: 'only_generated',
    reason_kind: 'extra_in_generated',
    reason: '生成侧多出、E3D 导出没有：/GENERATED/BOX 1 of EQUI /ADR079_EQUI BOX BOX 1 /ADR079_EQUI',
    name: '/GENERATED/BOX 1 of EQUI /ADR079_EQUI BOX BOX 1 /ADR079_EQUI',
    noun: '',
    max_axis_delta_mm: undefined,
    baseline_kinds: [],
    generated_kinds: [],
    baseline_aabb: undefined,
    generated_aabb: undefined,
  }),
];

const FAILED_KINDS: RvmStoreReasonCount[] = [
  { reason_kind: 'extra_in_generated', category: 'only_generated', severity: 'error', n: 38 },
  { reason_kind: 'aabb_shifted', category: 'off', severity: 'error', n: 1 },
  { reason_kind: 'missing_unnamed_element', category: 'only_baseline', severity: 'error', n: 1 },
];

const STAGE_FAILURE_ROW = mismatch({
  run_id: NO_BASELINE_ROOT.run_id,
  refno: '24384/26547',
  category: 'stage_failure',
  reason_kind: 'e3d_export_failed',
  reason: '基准目录里没有 baselines\\ams8000_24384_26547.rvm',
  name: '24384/26547',
  noun: 'SITE',
  max_axis_delta_mm: undefined,
  baseline_kinds: [],
  generated_kinds: [],
  baseline_aabb: undefined,
  generated_aabb: undefined,
});

/** 按请求条件回话的一台「服务端」；各用例按需改写 */
function installServer(): void {
  api.fetchRvmStoreRollup.mockImplementation(async (filter: RvmStoreRunFilter = {}) => {
    const roots = ROLLUP.filter((row) => (!filter.batch_id || row.batch_id === filter.batch_id)
      && (!filter.root_refno || row.root_refno === filter.root_refno));
    return { count: roots.length, scanned: 122, truncated: false, roots };
  });
  api.fetchRvmStoreRuns.mockImplementation(async (filter: RvmStoreRunFilter = {}) => {
    if (filter.batch_id === ROOT_BATCH) {
      const runs = [FAILED_ROOT, NO_BASELINE_ROOT].filter((row) => !filter.refno || row.refno === filter.refno);
      return { count: runs.length, runs };
    }
    return { count: 0, runs: [] };
  });
  api.fetchRvmStoreReasons.mockImplementation(async (filter: RvmStoreMismatchFilter = {}) => {
    if (filter.run_id === NO_BASELINE_ROOT.run_id) {
      return { count: 1, kinds: [{ reason_kind: 'e3d_export_failed', category: 'stage_failure', severity: 'error', n: 1 }] };
    }
    return { count: FAILED_KINDS.length, kinds: FAILED_KINDS };
  });
  api.fetchRvmStoreMismatches.mockImplementation(async (filter: RvmStoreMismatchFilter = {}) => {
    if (filter.run_id === NO_BASELINE_ROOT.run_id) return { count: 1, rows: [STAGE_FAILURE_ROW] };
    const rows = FAILED_ROWS.filter((row) => (!filter.reason_kind || row.reason_kind === filter.reason_kind)
      && (!filter.severity || row.severity === filter.severity));
    return { count: rows.length, rows };
  });
}

const browser = useRvmStoreBrowser();

function mount(props: { locatable?: boolean } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(RvmStoreBrowser, props) });
  app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }) });
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

const all = (host: HTMLElement, testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const one = (host: HTMLElement, testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const text = (host: HTMLElement, testId: string) => one(host, testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** 面包屑各级的文字；类型前缀（SITE / ZONE）和名称之间靠外边距隔开，这里拼成一个词 */
const crumbs = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-crumb]')].map((crumb) => crumb.textContent!.replace(/\s+/g, ''));
/** 标签上的文字；「没跑完」那一类的图标里有个感叹号，不算文字 */
const chipText = (chip: HTMLElement) => chip.textContent!.replace(/\s+/g, ' ').trim().replace(/^! /, '');

async function appear(host: HTMLElement, testId: string): Promise<HTMLElement> {
  await vi.waitFor(() => expect(one(host, testId)).not.toBeNull());
  return one(host, testId)!;
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  (element as HTMLElement).click();
  await nextTick();
}

async function choose(select: HTMLElement | null, value: string): Promise<void> {
  const element = select as HTMLSelectElement;
  element.value = value;
  element.dispatchEvent(new Event('change'));
  await nextTick();
}

let mounted: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  locateRow.mockClear();
  installServer();
  browser.openBatches();
  browser.view.value = 'store';
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('全部批次', () => {
  it('先是骨架，读到后一批一行，没过的单元数单独一列', async () => {
    mounted = mount();
    const { host } = mounted;
    expect(one(host, 'rvm-store-loading')).not.toBeNull();

    await appear(host, 'rvm-store-batch-row');
    const rows = all(host, 'rvm-store-batch-row');
    expect(rows.map((row) => row.dataset.batch)).toEqual([ZONE_BATCH, ROOT_BATCH]);
    const cells = [...rows[1]!.querySelectorAll('td')].map((cell) => cell.textContent!.replace(/\s+/g, ' ').trim());
    // 批次、跑法、库、上级根、单元、没过、终态、差异行
    expect(cells.slice(0, 6)).toEqual([ROOT_BATCH, '整根', '8000', '2', '2', '2']);
    expect(cells[6]).toContain('不一致 1');
    expect(cells[6]).toContain('缺基准 1');
    expect(cells[7]).toBe('41');
    expect(api.fetchRvmStoreRollup).toHaveBeenCalledWith({}, expect.anything());
    expect(crumbs(host)).toEqual(['全部批次']);
  });

  it('库里什么都没有时说明怎么才会有数据', async () => {
    api.fetchRvmStoreRollup.mockResolvedValue({ count: 0, scanned: 0, truncated: false, roots: [] });
    mounted = mount();
    const empty = await appear(mounted.host, 'rvm-store-empty');
    expect(empty.textContent).toContain('库里还没有批量核对的结果');
    expect(empty.textContent).toContain('rvm-check');
  });

  it('后端连不上时给出原因和先查哪里，重试能恢复', async () => {
    api.fetchRvmStoreRollup.mockRejectedValueOnce(new GenModelV1ApiError({
      code: 'network',
      status: 0,
      path: '/api/v1/rvm-check/rollup',
      message: 'gen-model 请求失败 GET http://localhost:8022/api/v1/rvm-check/rollup: Failed to fetch',
    }));
    mounted = mount();
    const { host } = mounted;
    const error = await appear(host, 'rvm-store-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('Failed to fetch');
    expect(error.textContent).toContain('8022');
    expect(one(host, 'rvm-store-batch-row')).toBeNull();

    await click(one(host, 'rvm-store-retry'));
    await appear(host, 'rvm-store-batch-row');
    expect(one(host, 'rvm-store-error')).toBeNull();
  });

  it('汇总被截断时说出来', async () => {
    api.fetchRvmStoreRollup.mockResolvedValue({ count: ROLLUP.length, scanned: 20000, truncated: true, roots: ROLLUP });
    mounted = mount();
    const notice = await appear(mounted.host, 'rvm-store-truncated');
    expect(notice.textContent).toContain('20,000');
  });

  it('只看有没过的 / 按编号过滤', async () => {
    api.fetchRvmStoreRollup.mockResolvedValue({
      count: 4,
      scanned: 123,
      truncated: false,
      roots: [...ROLLUP, rollupRow({ batch_id: 'accept-20261110/1112-site', mode: 'root', runs: 1, units: { root: 1 }, status: { pass: 1 }, clean: true, not_clean_runs: 0, not_clean: [], mismatch_total: 0 })],
    });
    mounted = mount();
    const { host } = mounted;
    await appear(host, 'rvm-store-batch-row');
    expect(all(host, 'rvm-store-batch-row')).toHaveLength(3);

    await click(one(host, 'rvm-store-batches-only-not-clean'));
    expect(all(host, 'rvm-store-batch-row').map((row) => row.dataset.batch)).toEqual([ZONE_BATCH, ROOT_BATCH]);

    const keyword = one(host, 'rvm-store-batches-keyword') as HTMLInputElement;
    keyword.value = 'fused';
    keyword.dispatchEvent(new Event('input'));
    await nextTick();
    expect(all(host, 'rvm-store-batch-row').map((row) => row.dataset.batch)).toEqual([ROOT_BATCH]);
  });
});

describe('一路点到差异明细', () => {
  it('整根只比了一次：批次 → 上级根汇总 → 直接进那次运行，看到每行的级别、分类、原因、构件、noun、偏差', async () => {
    mounted = mount();
    const { host } = mounted;
    await click((await appear(host, 'rvm-store-batch-row')).parentElement!.querySelector(`[data-batch="${ROOT_BATCH}"] [data-testid="rvm-store-batch-open"]`));

    // 一个批次：按上级根汇总
    await appear(host, 'rvm-store-root-row');
    expect(api.fetchRvmStoreRollup).toHaveBeenCalledWith({ batch_id: ROOT_BATCH }, expect.anything());
    expect(text(host, 'rvm-store-batch-summary')).toContain('2 个上级根 · 2 个单元 · 没过 2 · 差异 41 行');
    expect(all(host, 'rvm-store-root-row').map((row) => row.dataset.root)).toEqual(['24384/22399', '24384/26547']);

    await click(host.querySelector('[data-root="24384/22399"] [data-testid="rvm-store-root-open"]'));

    // 一次运行：横幅 + 差异
    await appear(host, 'rvm-store-mismatch-row');
    expect(api.fetchRvmStoreRuns).toHaveBeenCalledWith({ batch_id: ROOT_BATCH, refno: '24384/22399', limit: 10 }, expect.anything());
    expect(text(host, 'rvm-store-run-status')).toBe('不一致');
    expect(text(host, 'rvm-store-run-message')).toBe('不一致：偏差 1，仅 E3D 1，仅生成 38，种类不同 0');
    expect(text(host, 'rvm-store-run-counts')).toContain('1,981');
    expect(crumbs(host)).toEqual(['全部批次', ROOT_BATCH, 'SITE/1RX03-EQUI']);
    expect(api.fetchRvmStoreReasons).toHaveBeenCalledWith({ run_id: FAILED_ROOT.run_id, noun: undefined }, expect.anything());
    expect(api.fetchRvmStoreMismatches).toHaveBeenCalledWith(
      { run_id: FAILED_ROOT.run_id, category: undefined, severity: undefined, reason_kind: undefined, noun: undefined, limit: 100, offset: 0 },
      expect.anything(),
    );

    const first = [...all(host, 'rvm-store-mismatch-row')[0]!.querySelectorAll('td')].map((cell) => cell.textContent!.replace(/\s+/g, ' ').trim());
    expect(first).toEqual([
      '错误',
      '位置偏差',
      '整体偏移',
      '尺寸一致、位置偏移 (497.8, 43.594, 0.000) mm（最大轴差 497.8 mm，容差 0.500 mm）',
      'BOX 1 /1-LNR-Q005-PJ',
      'BOX',
      '497.8',
    ]);
    // 原因种类的说明挂在提示上
    expect(one(host, 'rvm-store-row-reason-kind')!.getAttribute('title')).toContain('aabb_shifted：尺寸一致，位置整体偏了');
    // 没有三维视图的页面不出「定位」
    expect(one(host, 'rvm-store-locate-row')).toBeNull();
    expect(text(host, 'rvm-store-pager-range')).toBe('第 1–3 条，共 40 条');
  });

  it('点开一行看两侧的图元种类和包围盒', async () => {
    browser.openBatch(ROOT_BATCH);
    browser.openRun({ refno: '24384/22399', runId: null }, '24384/22399');
    mounted = mount();
    const { host } = mounted;
    await appear(host, 'rvm-store-mismatch-row');
    expect(one(host, 'rvm-store-row-detail')).toBeNull();

    const toggle = one(host, 'rvm-store-row-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const detail = text(host, 'rvm-store-row-detail');
    expect(detail).toContain('E3D Box · 生成 Box');
    expect(detail).toContain('-652.8,-338.6,-275.0 → -342.8,251.4,275.0');
    expect(detail).toContain('-155.0,-295.0,-275.0 → 155.0,295.0,275.0');
    expect(detail).toContain('aabb_shifted');
    expect(detail).toContain(`${FAILED_ROOT.run_id} · 第 1 条`);
  });

  it('某一步没跑完的行一眼看出是哪一类，横幅把原始报错摆出来', async () => {
    browser.openBatch(ROOT_BATCH);
    browser.openRun({ refno: '24384/26547', runId: null }, '24384/26547');
    mounted = mount();
    const { host } = mounted;
    await appear(host, 'rvm-store-mismatch-row');

    expect(text(host, 'rvm-store-run-status')).toBe('缺基准');
    expect(text(host, 'rvm-store-run-failure')).toContain('缺基准');
    expect(text(host, 'rvm-store-run-failure')).toContain('基准目录里没有 baselines\\ams8000_24384_26547.rvm');
    expect(text(host, 'rvm-store-failure-class')).toBe('缺基准');
    const cells = [...one(host, 'rvm-store-mismatch-row')!.querySelectorAll('td')].map((cell) => cell.textContent!.replace(/\s+/g, ' ').trim());
    expect(cells[1]).toBe('没跑完');
    expect(cells[2]).toBe('没拿到 E3D 基准');
  });

  it('工作台里（有三维视图）差异行可以定位：拿构件名里的有名属主去找', async () => {
    browser.openBatch(ROOT_BATCH);
    browser.openRun({ refno: '24384/22399', runId: null }, '24384/22399');
    mounted = mount({ locatable: true });
    const { host } = mounted;
    await appear(host, 'rvm-store-mismatch-row');
    const buttons = all(host, 'rvm-store-locate-row');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.textContent).toContain('属主');
    await click(buttons[0]);
    expect(locateRow).toHaveBeenCalledWith('24384/22399', '/1-LNR-Q005-PJ');
  });
});

describe('筛选和翻页', () => {
  async function openFailedRun() {
    browser.openBatch(ROOT_BATCH);
    browser.openRun({ refno: '24384/22399', runId: null }, '24384/22399');
    mounted = mount();
    await appear(mounted.host, 'rvm-store-mismatch-row');
    return mounted.host;
  }

  it('按原因种类汇总：每种原因一行，点一行就按它筛明细', async () => {
    const host = await openFailedRun();
    const reasons = all(host, 'rvm-store-reason-row');
    expect(reasons.map((row) => row.dataset.reason)).toEqual(['extra_in_generated', 'aabb_shifted', 'missing_unnamed_element']);
    expect(reasons[0]!.textContent).toContain('生成侧多出');
    expect(reasons[0]!.textContent).toContain('我们生成了这一件，E3D 导出里没有');
    expect(reasons[0]!.textContent).toContain('38');

    await click(reasons[1]);
    await vi.waitFor(() => expect(api.fetchRvmStoreMismatches).toHaveBeenLastCalledWith(
      expect.objectContaining({ run_id: FAILED_ROOT.run_id, reason_kind: 'aabb_shifted', offset: 0 }),
      expect.anything(),
    ));
    await vi.waitFor(() => expect(all(host, 'rvm-store-mismatch-row')).toHaveLength(1));
    expect(text(host, 'rvm-store-pager-range')).toBe('第 1–1 条，共 1 条');
    expect((one(host, 'rvm-store-filter-reason') as HTMLSelectElement).value).toBe('aabb_shifted');

    await click(one(host, 'rvm-store-clear-filters'));
    await vi.waitFor(() => expect(all(host, 'rvm-store-mismatch-row')).toHaveLength(3));
  });

  it('按级别、分类筛：条件进请求，合计从汇总里算', async () => {
    const host = await openFailedRun();
    await choose(one(host, 'rvm-store-filter-category'), 'only_generated');
    await vi.waitFor(() => expect(api.fetchRvmStoreMismatches).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'only_generated', offset: 0 }),
      expect.anything(),
    ));
    expect(text(host, 'rvm-store-pager-range')).toContain('共 38 条');

    await choose(one(host, 'rvm-store-filter-severity'), 'error');
    await vi.waitFor(() => expect(api.fetchRvmStoreMismatches).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'only_generated', severity: 'error' }),
      expect.anything(),
    ));
  });

  it('按 noun 筛：汇总和明细都带上 noun 重新取', async () => {
    const host = await openFailedRun();
    const input = one(host, 'rvm-store-filter-noun') as HTMLInputElement;
    input.value = 'box';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await nextTick();
    await vi.waitFor(() => expect(api.fetchRvmStoreReasons).toHaveBeenLastCalledWith(
      { run_id: FAILED_ROOT.run_id, noun: 'BOX' },
      expect.anything(),
    ));
    await vi.waitFor(() => expect(api.fetchRvmStoreMismatches).toHaveBeenLastCalledWith(
      expect.objectContaining({ noun: 'BOX', offset: 0 }),
      expect.anything(),
    ));
  });

  it('一页装得下时翻页按钮都不可用', async () => {
    const host = await openFailedRun();
    expect(text(host, 'rvm-store-pager-range')).toBe('第 1–3 条，共 40 条');
    expect((one(host, 'rvm-store-prev') as HTMLButtonElement).disabled).toBe(true);
    expect((one(host, 'rvm-store-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('几千条差异：一次只取一页，下一页带偏移，换每页条数回到第一页', async () => {
    api.fetchRvmStoreReasons.mockResolvedValue({
      count: 1,
      kinds: [{ reason_kind: 'extra_in_generated', category: 'only_generated', severity: 'error', n: 7576 }],
    });
    const host = await openFailedRun();
    expect(text(host, 'rvm-store-pager-range')).toBe('第 1–3 条，共 7,576 条');
    const pageInput = () => one(host, 'rvm-store-page-input') as HTMLInputElement;
    const lastCall = (expected: Partial<RvmStoreMismatchFilter>) => vi.waitFor(() => expect(api.fetchRvmStoreMismatches).toHaveBeenLastCalledWith(
      expect.objectContaining({ run_id: FAILED_ROOT.run_id, ...expected }),
      expect.anything(),
    ));
    expect(pageInput().value).toBe('1');
    expect(text(host, 'rvm-store-pager')).toContain('/ 76 页');

    await click(one(host, 'rvm-store-next'));
    await lastCall({ limit: 100, offset: 100 });
    await vi.waitFor(() => expect((one(host, 'rvm-store-prev') as HTMLButtonElement).disabled).toBe(false));
    expect(pageInput().value).toBe('2');

    // 直接跳到末页、填页码跳到中间，不必一页页点
    await click(one(host, 'rvm-store-last'));
    await lastCall({ limit: 100, offset: 7500 });
    await vi.waitFor(() => expect((one(host, 'rvm-store-next') as HTMLButtonElement).disabled).toBe(true));
    pageInput().value = '30';
    pageInput().dispatchEvent(new Event('change'));
    await lastCall({ limit: 100, offset: 2900 });
    // 填过头的页码收到末页；看过的页在缓存里，不再发请求
    pageInput().value = '999';
    pageInput().dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(pageInput().value).toBe('76'));
    expect(text(host, 'rvm-store-pager-range')).toBe('第 7,501–7,503 条，共 7,576 条');
    await click(one(host, 'rvm-store-first'));
    await vi.waitFor(() => expect(pageInput().value).toBe('1'));
    expect((one(host, 'rvm-store-prev') as HTMLButtonElement).disabled).toBe(true);

    await choose(one(host, 'rvm-store-page-size'), '50');
    await vi.waitFor(() => expect(api.fetchRvmStoreMismatches).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 }),
      expect.anything(),
    ));
    // 没有一次请求要过全量
    for (const [filter] of api.fetchRvmStoreMismatches.mock.calls) expect((filter as RvmStoreMismatchFilter).limit).toBeLessThanOrEqual(100);
  });
});

describe('上级根下的单元', () => {
  /** 120 个 ZONE，完成时刻各差一秒，最新的在前 */
  const UNITS: RvmStoreRun[] = Array.from({ length: 120 }, (_, index) => run({
    run_id: `${ZONE_BATCH}/ams7999/24383_${90000 + index}`,
    refno: `24383/${90000 + index}`,
    name: `/ZONE-${index}`,
    status: index === 3 ? 'fail' : index === 5 ? 'no-baseline' : 'pass',
    verdict: index === 3 || index === 5 ? 'fail' : 'pass',
    message: index === 5 ? '基准目录里没有 ams7999_24383_90005.rvm' : '',
    mismatch_total: index === 3 ? 3 : index === 5 ? 1 : 0,
    finished_unix_ms: 1794283136149 - index * 1000,
  }));

  beforeEach(() => {
    api.fetchRvmStoreRuns.mockImplementation(async (filter: RvmStoreRunFilter = {}) => {
      const runs = UNITS
        .filter((row) => (!filter.status || row.status === filter.status) && (filter.before == null || row.finished_unix_ms < filter.before))
        .slice(0, filter.limit ?? 50);
      return { count: runs.length, runs };
    });
  });

  it('按 ZONE 跑的批次：点上级根进单元列表，一次一页，加载更多往回翻', async () => {
    browser.openBatch(ZONE_BATCH);
    mounted = mount();
    const { host } = mounted;
    await click((await appear(host, 'rvm-store-root-row')).querySelector('[data-testid="rvm-store-root-open"]'));

    await appear(host, 'rvm-store-unit-row');
    expect(api.fetchRvmStoreRuns).toHaveBeenCalledWith(
      { batch_id: ZONE_BATCH, root_refno: SITE, status: undefined, unit: undefined, before: undefined, limit: 100 },
      expect.anything(),
    );
    expect(text(host, 'rvm-store-root-summary')).toContain('SITE /1RX-ELECBJ 24383/80211');
    expect(text(host, 'rvm-store-root-summary')).toContain('120 个单元 · 没过 3');
    expect(all(host, 'rvm-store-unit-row')).toHaveLength(100);
    expect(text(host, 'rvm-store-unit-shown')).toBe('已显示 100 / 120 个');
    // 没过的单元把那句说明带出来
    expect(host.querySelector('[data-testid="rvm-store-unit-row"][data-status="no-baseline"]')!.textContent).toContain('基准目录里没有 ams7999_24383_90005.rvm');

    await click(one(host, 'rvm-store-unit-more'));
    await vi.waitFor(() => expect(all(host, 'rvm-store-unit-row')).toHaveLength(120));
    // 下一页从「不晚于上一页最后一行」起取，多取一行抵掉重叠；重叠的那一行不重复显示
    expect(api.fetchRvmStoreRuns).toHaveBeenLastCalledWith(
      expect.objectContaining({ before: UNITS[99]!.finished_unix_ms + 1, limit: 101 }),
      expect.anything(),
    );
    expect(text(host, 'rvm-store-unit-shown')).toBe('已显示 120 / 120 个');
    expect(one(host, 'rvm-store-unit-more')).toBeNull();
  });

  it('按终态筛：条件进请求，个数来自汇总；点单元进它的差异明细，面包屑能退回来', async () => {
    browser.openBatch(ZONE_BATCH);
    browser.openRoot(SITE);
    mounted = mount();
    const { host } = mounted;
    await appear(host, 'rvm-store-unit-row');
    const chips = all(host, 'rvm-store-status-chip');
    expect(chips.map(chipText)).toEqual(['不一致 2', '缺基准 1', '通过 115', '无可比内容 2']);

    await click(host.querySelector('[data-testid="rvm-store-status-chip"][data-status="no-baseline"]'));
    await vi.waitFor(() => expect(all(host, 'rvm-store-unit-row')).toHaveLength(1));
    expect(api.fetchRvmStoreRuns).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'no-baseline' }), expect.anything());
    expect(text(host, 'rvm-store-unit-shown')).toBe('已显示 1 / 1 个');
    expect(browser.place.unitStatus).toBe('no-baseline');

    await click(one(host, 'rvm-store-unit-open'));
    await appear(host, 'rvm-store-run-header');
    expect(text(host, 'rvm-store-run-status')).toBe('缺基准');
    expect(crumbs(host)).toEqual(['全部批次', ZONE_BATCH, 'SITE/1RX-ELECBJ', 'ZONE/ZONE-5']);
    // 列表里读到的那一行直接用，不为横幅再发一次请求
    expect(api.fetchRvmStoreRuns).not.toHaveBeenCalledWith(expect.objectContaining({ refno: '24383/90005' }), expect.anything());

    await click(host.querySelector('[data-testid="rvm-store-crumb"][data-crumb="root"]'));
    await appear(host, 'rvm-store-unit-row');
    // 退回来还是刚才那个筛选
    expect(all(host, 'rvm-store-unit-row')).toHaveLength(1);
  });

  it('从汇总行的终态标签直接进单元列表并筛到那个终态', async () => {
    browser.openBatch(ZONE_BATCH);
    mounted = mount();
    const { host } = mounted;
    await appear(host, 'rvm-store-root-row');
    await click(host.querySelector('[data-testid="rvm-store-root-row"] [data-status="fail"]'));
    await appear(host, 'rvm-store-unit-row');
    expect(browser.place).toMatchObject({ rootRefno: SITE, unitStatus: 'fail' });
    expect(api.fetchRvmStoreRuns).toHaveBeenLastCalledWith(expect.objectContaining({ root_refno: SITE, status: 'fail' }), expect.anything());
  });

  it('整批的差异与原因：跨单元看，点「所在单元」进那个单元', async () => {
    browser.openBatch(ZONE_BATCH);
    mounted = mount();
    const { host } = mounted;
    await appear(host, 'rvm-store-root-row');
    await click(host.querySelector('[data-testid="rvm-store-tab"][data-tab="mismatches"]'));
    await appear(host, 'rvm-store-mismatch-row');
    expect(api.fetchRvmStoreReasons).toHaveBeenCalledWith({ batch_id: ZONE_BATCH, noun: undefined }, expect.anything());
    expect(api.fetchRvmStoreMismatches).toHaveBeenCalledWith(expect.objectContaining({ batch_id: ZONE_BATCH, limit: 100, offset: 0 }), expect.anything());

    await click(one(host, 'rvm-store-row-unit'));
    expect(browser.place.run).toEqual({ refno: '24384/22399', runId: FAILED_ROOT.run_id });
  });
});

describe('页面单根核对', () => {
  it('不属于任何批次：直接列历次运行，按 source=page 取', async () => {
    api.fetchRvmStoreRuns.mockResolvedValue({
      count: 1,
      runs: [run({ run_id: 'rvm-check-20261110-1', source: 'page', batch_id: null, unit: null, root_refno: null, noun: 'SITE', name: '/1WCC-PIPEBJ', refno: '24383/66456' })],
    });
    mounted = mount();
    const { host } = mounted;
    await appear(host, 'rvm-store-batch-row');
    await click(one(host, 'rvm-store-open-page-runs'));
    await appear(host, 'rvm-store-unit-row');
    expect(api.fetchRvmStoreRuns).toHaveBeenCalledWith(
      { source: 'page', status: undefined, unit: undefined, before: undefined, limit: 100 },
      expect.anything(),
    );
    expect(crumbs(host)).toEqual(['全部批次', '页面单根核对']);
    expect(text(host, 'rvm-store-unit-shown')).toBe('已显示 1 个');

    await click(one(host, 'rvm-store-unit-open'));
    await appear(host, 'rvm-store-run-header');
    expect(crumbs(host)).toEqual(['全部批次', '页面单根核对', 'SITE/1WCC-PIPEBJ']);
  });
});
