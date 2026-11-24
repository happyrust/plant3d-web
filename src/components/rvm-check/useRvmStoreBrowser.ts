/**
 * RVM 核对页的两个视图（节点核对 / 库内结果）和库内结果里点到了哪一层。模块级单例：停靠面板关掉再开、
 * 独立页的页头与正文，看到的是同一份。
 *
 * 层次：全部批次 → 一个批次（按上级根汇总）→ 一个上级根（它下面的单元）→ 一个单元（差异明细）。
 * 独立页（`?page=rvm-check`）把当前位置写进地址栏，链接可以直接发给别人；工作台里的停靠面板不动地址栏。
 */

import { computed, reactive, ref, watch } from 'vue';

import { RVM_STORE_PAGE_RUNS } from './useRvmStoreQueries';

export type RvmCheckView = 'check' | 'store';

/** 页头 / 面板顶上的两个页签：发起核对看结果，或者翻库里存着的结果 */
export const RVM_CHECK_VIEW_TABS: { id: RvmCheckView; label: string }[] = [
  { id: 'check', label: '节点核对' },
  { id: 'store', label: '库内结果' },
];

export type RvmStoreLevel = 'batches' | 'batch' | 'root' | 'run';

export type RvmStoreRunRef = {
  /** 根 / 单元自己的 refno，`a/b` */
  refno: string;
  runId: string | null;
};

export type RvmStorePlace = {
  /** 批次编号；`RVM_STORE_PAGE_RUNS` 是页面单根核对；null 是全部批次 */
  batchId: string | null;
  /** 上级根（SITE / APPLDW）的 refno */
  rootRefno: string | null;
  run: RvmStoreRunRef | null;
  /** 单元列表的终态筛选；从汇总行的终态标签点进来时预先带上 */
  unitStatus: string | null;
};

const PARAM_VIEW = 'rvm_view';
const PARAM_BATCH = 'rvm_batch';
const PARAM_ROOT = 'rvm_root';
const PARAM_UNIT = 'rvm_unit';
const PARAM_RUN = 'rvm_run';
const PARAM_STATUS = 'rvm_status';

function emptyPlace(): RvmStorePlace {
  return { batchId: null, rootRefno: null, run: null, unitStatus: null };
}

/** 地址栏参数 → 视图与位置。认不出的参数当没有。 */
export function parseRvmStoreUrl(search: string): { view: RvmCheckView; place: RvmStorePlace } {
  const params = new URLSearchParams(search);
  const text = (key: string) => params.get(key)?.trim() || null;
  const place = emptyPlace();
  place.batchId = text(PARAM_BATCH);
  if (place.batchId) {
    place.rootRefno = text(PARAM_ROOT);
    const unit = text(PARAM_UNIT);
    if (unit) place.run = { refno: unit, runId: text(PARAM_RUN) };
    else place.unitStatus = text(PARAM_STATUS);
  }
  return { view: text(PARAM_VIEW) === 'store' ? 'store' : 'check', place };
}

/** 视图与位置 → 地址栏参数；其余参数（`page`、`backendPort` …）原样留着。 */
export function writeRvmStoreUrl(search: string, view: RvmCheckView, place: RvmStorePlace): string {
  const params = new URLSearchParams(search);
  const put = (key: string, value: string | null | undefined) => {
    if (value) params.set(key, value);
    else params.delete(key);
  };
  const within = view === 'store' && !!place.batchId;
  put(PARAM_VIEW, view === 'store' ? 'store' : null);
  put(PARAM_BATCH, within ? place.batchId : null);
  put(PARAM_ROOT, within ? place.rootRefno : null);
  put(PARAM_UNIT, within ? place.run?.refno : null);
  put(PARAM_RUN, within ? place.run?.runId : null);
  put(PARAM_STATUS, within && !place.run ? place.unitStatus : null);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** 独立页上同一个位置的地址：工作台的停靠面板窄，带着当前位置开到独立页去看。 */
export function standaloneStoreUrl(href: string, place: RvmStorePlace): string {
  const url = new URL(href);
  url.searchParams.set('page', 'rvm-check');
  url.search = writeRvmStoreUrl(url.search, 'store', place);
  return url.toString();
}

function onStandalonePage(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('page')?.trim() === 'rvm-check';
}

const initial = onStandalonePage()
  ? parseRvmStoreUrl(window.location.search)
  : { view: 'check' as RvmCheckView, place: emptyPlace() };

const view = ref<RvmCheckView>(initial.view);
const place = reactive<RvmStorePlace>(initial.place);

const level = computed<RvmStoreLevel>(() => {
  if (!place.batchId) return 'batches';
  if (place.run) return 'run';
  if (place.rootRefno) return 'root';
  return 'batch';
});

/** 正在看的这次运行就是上级根自己那一行（整根），不是它下面的某个单元。 */
const runIsRoot = computed(() => !!place.run && place.run.refno === place.rootRefno);

const isPageRuns = computed(() => place.batchId === RVM_STORE_PAGE_RUNS);

function assign(next: RvmStorePlace): void {
  place.batchId = next.batchId;
  place.rootRefno = next.rootRefno;
  place.run = next.run;
  place.unitStatus = next.unitStatus;
}

function openBatches(): void {
  assign(emptyPlace());
}

function openBatch(batchId: string): void {
  assign({ ...emptyPlace(), batchId });
}

/** 进一个上级根的单元列表；`status` 预先筛到某个终态。 */
function openRoot(rootRefno: string, status: string | null = null): void {
  if (!place.batchId) return;
  assign({ batchId: place.batchId, rootRefno, run: null, unitStatus: status });
}

/** 进一次运行的差异明细。`rootRefno` 不给就留在当前上级根下。 */
function openRun(run: RvmStoreRunRef, rootRefno: string | null = place.rootRefno): void {
  if (!place.batchId) return;
  assign({ batchId: place.batchId, rootRefno, run, unitStatus: place.unitStatus });
}

function setUnitStatus(status: string | null): void {
  place.unitStatus = status;
}

/** 直接跳到库内结果的某个位置（别的面板带人过来时用）。 */
function showInStore(next: Partial<RvmStorePlace> = {}): void {
  assign({ ...emptyPlace(), ...next });
  view.value = 'store';
}

if (onStandalonePage()) {
  watch(
    () => writeRvmStoreUrl(window.location.search, view.value, place),
    (search) => {
      if (search === window.location.search) return;
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
    },
  );
}

export function useRvmStoreBrowser() {
  return {
    view,
    place,
    level,
    runIsRoot,
    isPageRuns,
    openBatches,
    openBatch,
    openRoot,
    openRun,
    setUnitStatus,
    showInStore,
  };
}
