import { computed, reactive, ref, watch } from 'vue';

import type {
  BranNearestClearanceCandidate,
  BranNearestClearanceGroupResult,
  BranNearestClearanceResponse,
  BranParallelSpacingDetail,
} from '@/api/genModelSpatialApi';

import { genModelV1SpatialNearestClearance, genModelV1SurfaceClearance } from '@/api/genModelV1Api';
import { cloneResultSnapshot } from '@/clearance/services/resultSnapshot';
import { createScopedResultPersistence } from '@/clearance/services/scopedResultPersistence';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useViewerContext } from '@/composables/useViewerContext';

/**
 * 「空间计算」Dock 只剩 BRAN 中心线最近清距一个场景。旧后端 `/api/space/*` 的六个支架场景
 * （预埋板偏移 / 对应预埋板 / 距墙 / 钢结构相对定位 / 对应桥架 / 桥架跨度）gen-model 没有对应接口，
 * 2026-09-20 随 legacy 退役一并拨掉（D1）。
 */
export type SpatialComputeScenarioKey = 'branNearestClearance';

export type SpatialComputeResultRow = {
  refno: string;
  noun: string;
  distanceMm: number | null;
  label: string;
  targetGroup?: string;
  sourceSegmentRefno?: string | null;
  sourceSegmentOrder?: number | null;
  /** BRAN 净距：这一行对应候选的键（`branCandidateKey`），给「标注」开关用 */
  candidateKey?: string;
  /** BRAN 净距：这一行此刻画在三维里 */
  drawn?: boolean;
  /** BRAN 净距：包围盒估算相交（可能只是盒比实体大，建议精算纠正） */
  intersects?: boolean;
};

/**
 * 一条净距候选是怎么算出来的（`docs/plans/2026-09-11-measurement-clearance-dimension-convergence-plan.md` D2：精度不是布尔值）。
 * 服务端候选是沿中心线量到候选**包围盒**（目标侧不是网格精算）；三维里点选管件得到的那条是 DTX 网格采样估算，
 * 进同一份结果时必须带着这个标签，表里与尺寸文字都按它标「估算」；两条 BRAN 平行直段的中心距是两条真实轴线之间的垂距，
 * 精确到中心线本身（`parallel-centerline / exact-centerline`），不标「≈」。
 */
export type BranClearanceProvenance = {
  status?: 'current' | 'stale';
  modelVersion?: { sourceSesno: number | null; targetSesno: number | null };
  method: 'centerline-to-aabb' | 'sampled-object' | 'parallel-centerline' | 'surface-to-surface';
  accuracyClass: 'approximate-bounds' | 'approximate-sampled' | 'exact-centerline' | 'exact-surface';
};

export const SERVER_BRAN_CLEARANCE_PROVENANCE: BranClearanceProvenance = {
  method: 'centerline-to-aabb',
  accuracyClass: 'approximate-bounds',
};

export type BranNearestClearanceAnnotationCandidate = {
  targetGroup: string;
  candidate: BranNearestClearanceCandidate;
  index: number;
  /** 缺省 = 服务端候选（`SERVER_BRAN_CLEARANCE_PROVENANCE`）；三维点选写进来的那几条带 `sampled-object` */
  provenance?: BranClearanceProvenance;
};

/**
 * BRAN 净距的类型 facet：一类一个 chip。`count` 是半径内该类候选总数（响应 `noun_counts`，`max_per_group` 截断之前），
 * `selected` 决定这一类的候选要不要进结果表与三维标注。
 */
export type BranNounFacet = {
  noun: string;
  count: number;
  selected: boolean;
};

export type SpatialComputeScenarioField = 'tolerance' | 'suppoType' | 'searchRadius' | 'targetNouns' | 'verticalNouns' | 'excludeNouns' | 'neighborWindow';

type SpatialComputeScenarioState = {
  structureCategory: 'all' | 'wall' | 'column' | 'beam' | 'slab';
  structuralAngleDeg: string;
  warnings: string[];
  refiningKeys: string[];
  queriedSourceRefno: string;
  suppoRefno: string;
  tolerance: string;
  suppoType: string;
  searchRadius: string;
  targetNouns: string;
  /** 垂直距口径的 NOUN 白名单（`vertical_nouns`）：命中的候选按 Z 向高差量（楼板类），精算同口径 */
  verticalNouns: string;
  excludeNouns: string;
  neighborWindow: string;
  loading: boolean;
  error: string;
  responseText: string;
  resultRows: SpatialComputeResultRow[];
  annotationCandidates: BranNearestClearanceAnnotationCandidate[];
  /**
   * 以下几格只有 BRAN 净距用：分桶（`group_by=noun`，一桶一类；服务端候选 + 三维点选写进来的估算候选）、由它派生的类型 facet、
   * 当前画在三维里的候选键、被剔掉的自身成员数、非服务端候选的来源标签（键 = `branCandidateKey`；没登记的就是服务端候选）。
   * `resultRows` / `annotationCandidates` 是 `branGroups × 勾选` 的派生结果。
   */
  branGroups: BranNearestClearanceGroupResult[];
  nounFacets: BranNounFacet[];
  drawnCandidateKeys: string[];
  excludedSelfMembers: number;
  candidateProvenance: Record<string, BranClearanceProvenance>;
};

type SpatialComputeScenarioMeta = {
  key: SpatialComputeScenarioKey;
  title: string;
  description: string;
  endpoint: string;
  exampleRefno: string;
  sourceLabel: string;
  sourceHelp: string;
  fields: SpatialComputeScenarioField[];
};

/** BRAN 净距的取数路径（plan `docs/plans/2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md` §3.3）。 */
const BRAN_NEAREST_CLEARANCE_ENDPOINT = '/api/v1/spatial/nearest-clearance';

/**
 * BRAN 净距按 `group_by=noun` 查：半径内每个 NOUN 自成一桶、按最近距离排桶，`noun_counts` 直接当类型 facet
 * （设计 fable-5-1-36 §UI：Dock 的「目标 chips」由 `noun_counts` 驱动，每类默认勾选、默认只画最近 1 条）。
 * 每桶多取几条留在列表里供逐条勾选，不然「默认 1 条」就没有「多画」的余地。
 */
export const BRAN_CLEARANCE_MAX_PER_NOUN = 3;
/** 默认剔掉的噪声类型：焊点与附着件几乎贴着每根管子，只会把 facet 刷满。面板里可改。 */
export const BRAN_CLEARANCE_DEFAULT_EXCLUDE_NOUNS = 'WELD,ATTA';
/**
 * 「全部构件类型」下的默认目标类型白名单：墙族（与服务端 `wall` 预置组同口径）+ 柱/梁截面（`column` 预置组，
 * SCTN/GENSEC 按世界轴线分管梁柱两侧）+ 楼板。管件邻居（FTUB/BEND/ELBO/FITT/COUP/TAPE…）本就不是「净距」要看的
 * 障碍类型，全标出来只剩一团线。面板 target_nouns 可改；留空回到半径内全类型。
 */
export const BRAN_CLEARANCE_DEFAULT_TARGET_NOUNS = 'WALL,PANE,GWALL,STWALL,FLOOR,COLU,SCTN,GENSEC';
/**
 * 垂直距口径的默认 NOUN：楼板板面是水平的，三维最近距会量到板边侧棱而不是设计要的
 * 「管底到板面净高」——命中的候选按 Z 向高差量（`vertical_nouns`），精算也走竖直射线网格测距。
 * 面板可改成逗号分隔清单；留空 = 不启用垂直口径。
 */
export const BRAN_CLEARANCE_DEFAULT_VERTICAL_NOUNS = 'FLOOR';

const SCENARIO_META: SpatialComputeScenarioMeta[] = [
  {
    key: 'branNearestClearance',
    title: 'BRAN 中心线最近清距',
    description: '按墙、柱、梁、板或指定类型集合（target_nouns，默认结构类）查找候选；先显示管表面到包围盒估算，可逐条精算实体外表面净距。',
    endpoint: BRAN_NEAREST_CLEARANCE_ENDPOINT,
    exampleRefno: '24381_145018',
    sourceLabel: 'BRAN Refno',
    sourceHelp: 'BRAN 格式示例：24381_145018 或 24381/145018',
    fields: ['searchRadius', 'targetNouns', 'verticalNouns', 'excludeNouns'],
  },
];

const DEFAULT_STATE_BY_SCENARIO: Record<
  SpatialComputeScenarioKey,
  Omit<
    SpatialComputeScenarioState,
    | 'loading'
    | 'error'
    | 'responseText'
    | 'resultRows'
    | 'annotationCandidates'
    | 'branGroups'
    | 'nounFacets'
    | 'drawnCandidateKeys'
    | 'excludedSelfMembers'
    | 'candidateProvenance'
    | 'warnings'
    | 'refiningKeys'
    | 'queriedSourceRefno'
  >
> = {
  branNearestClearance: {
    structureCategory: 'all',
    structuralAngleDeg: '5',
    suppoRefno: '24381_145018',
    tolerance: '',
    suppoType: '',
    searchRadius: '5000',
    targetNouns: BRAN_CLEARANCE_DEFAULT_TARGET_NOUNS,
    verticalNouns: BRAN_CLEARANCE_DEFAULT_VERTICAL_NOUNS,
    excludeNouns: BRAN_CLEARANCE_DEFAULT_EXCLUDE_NOUNS,
    neighborWindow: '',
  },
};

export function normalizeBranComputeRefno(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const wrapped = value.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? value;
  const core = wrapped.replace(/^pe:/i, '').replace(/^=/, '').trim();
  return core.replace(/,/g, '_').replace(/\//g, '_');
}

function createScenarioState(key: SpatialComputeScenarioKey): SpatialComputeScenarioState {
  const defaults = DEFAULT_STATE_BY_SCENARIO[key];
  return {
    ...defaults,
    loading: false,
    error: '',
    responseText: '',
    resultRows: [],
    annotationCandidates: [],
    branGroups: [],
    nounFacets: [],
    drawnCandidateKeys: [],
    excludedSelfMembers: 0,
    candidateProvenance: {},
    warnings: [],
    refiningKeys: [],
    queriedSourceRefno: '',
  };
}

/** 清掉一次计算的全部产出（表、标注候选、BRAN 分桶与 facet，含三维点选写进来的估算候选），输入格不动。 */
function clearScenarioResults(state: SpatialComputeScenarioState): void {
  state.resultRows = [];
  state.annotationCandidates = [];
  state.branGroups = [];
  state.nounFacets = [];
  state.drawnCandidateKeys = [];
  state.excludedSelfMembers = 0;
  state.candidateProvenance = {};
  state.warnings = [];
  state.refiningKeys = [];
  state.queriedSourceRefno = '';
}

/**
 * 一条候选在结果表 / 标注开关里的键：桶名 + refno（同一构件理论上只会落在一个桶里，带桶名只为稳妥）；
 * 前端交互写入的多条同目标候选（两条 BRAN 之间每对平行直段一条）再带 `#variant`。服务端候选没有 `variant`，键不变。
 */
export function branCandidateKey(group: string, candidate: Pick<BranNearestClearanceCandidate, 'refno' | 'variant'>): string {
  return candidate.variant ? `${group}:${candidate.refno}#${candidate.variant}` : `${group}:${candidate.refno}`;
}

/** 按 candidateKey 在分桶结果里反查候选——`annotationCandidates` 只含已画出的，反查要扫全部桶（如未标注行「跳转」）。 */
export function findBranCandidateByKey(
  groups: BranNearestClearanceGroupResult[],
  candidateKey: string,
): { group: BranNearestClearanceGroupResult; item: BranNearestClearanceCandidate } | undefined {
  for (const group of groups) {
    const item = group.candidates.find((entry) => branCandidateKey(group.group, entry) === candidateKey);
    if (item) return { group, item };
  }
  return undefined;
}

/** 两种响应形态都收：新的数组分桶（`group_by=noun` 一桶一类）与老的对象形态 `{ wall: [...] }`。 */
export function normalizeBranNearestGroups(
  nearestByGroup: BranNearestClearanceResponse['nearest_by_group'],
): BranNearestClearanceGroupResult[] {
  if (!nearestByGroup) return [];
  if (Array.isArray(nearestByGroup)) {
    return nearestByGroup.map((group) => ({ group: group.group, nouns: group.nouns, candidates: group.candidates ?? [] }));
  }
  return Object.entries(nearestByGroup).map(([group, candidates]) => ({ group, candidates: candidates ?? [] }));
}

/**
 * 由分桶派生类型 facet：桶序就是服务端的最近距离序；`count` 取截断前计数 `noun_counts`，老响应没有这一格就按桶内条数。
 * 全部默认勾选（用户要看的是「周围都有什么」，再把不关心的关掉）。
 */
export function buildBranNounFacets(
  groups: readonly BranNearestClearanceGroupResult[],
  nounCounts: Record<string, number> | undefined,
): BranNounFacet[] {
  return groups
    .filter((group) => group.candidates.length > 0)
    .map((group) => ({
      noun: group.group,
      count: Math.max(nounCounts?.[group.group] ?? 0, group.candidates.length),
      selected: true,
    }));
}

/** 默认标注：每类最近 1 条（桶内已按距离升序）。 */
export function defaultDrawnCandidateKeys(groups: readonly BranNearestClearanceGroupResult[]): string[] {
  return groups.flatMap((group) => {
    const nearest = group.candidates[0];
    return nearest ? [branCandidateKey(group.group, nearest)] : [];
  });
}

/**
 * 表里给非服务端候选看的来源字样（2026-09-11 收敛计划 PR0.2：`sampled-object` 显示「估算最近距离」；
 * `parallel-centerline` 显示「平行直段中心距」——这一行的距离是两条轴线的垂距，不是到包围盒的净距）。
 */
function provenanceMethodLabel(provenance: BranClearanceProvenance | undefined): string {
  switch (provenance?.method) {
    case 'sampled-object':
      return '估算最近距离（网格采样）';
    case 'parallel-centerline':
      return '平行直段中心距';
    case 'surface-to-surface':
      return '实体外表面净距（网格精算）';
    default:
      return '管表面到包围盒估算';
  }
}

function provenanceLabel(provenance: BranClearanceProvenance | undefined): string {
  return `${provenance?.status === 'stale' ? '（过期，待重算）' : ''}${provenanceMethodLabel(provenance)}`;
}

function formatMm(value: number): string {
  return `${Math.round(value)}mm`;
}

/** 平行直段候选的行标签明细：重叠长度、扣两侧外径的净距（外径不全就说明缺哪边）、源 / 目标直段。 */
function parallelDetailLabel(detail: BranParallelSpacingDetail): string[] {
  const diameters = [detail.source_outside_diameter_mm, detail.target_outside_diameter_mm]
    .map((value) => (value != null ? String(value) : '?'))
    .join('/');
  return [
    `重叠 ${formatMm(detail.overlap_mm)}`,
    detail.clearance_mm != null ? `净距 ${formatMm(detail.clearance_mm)}（外径 ${diameters}）` : `外径不全（${diameters}），净距未算`,
    `直段 ${detail.source_run_refno} ∥ ${detail.target_run_refno}`,
  ];
}

function toBranResultRow(
  group: string,
  candidate: BranNearestClearanceCandidate,
  drawn: boolean,
  provenance: BranClearanceProvenance | undefined,
): SpatialComputeResultRow {
  const segment = candidate.parallel
    ? ''
    : candidate.nearest?.source_segment_refno
      ? `${provenance?.method === 'sampled-object' ? '点选' : 'segment'} ${candidate.nearest.source_segment_refno}${candidate.nearest.source_segment_order != null ? `#${candidate.nearest.source_segment_order}` : ''}`
      : '';
  return {
    refno: candidate.refno,
    noun: candidate.noun,
    distanceMm: Number.isFinite(candidate.distance_mm) ? candidate.distance_mm : null,
    targetGroup: group,
    sourceSegmentRefno: candidate.nearest?.source_segment_refno ?? null,
    sourceSegmentOrder: candidate.nearest?.source_segment_order ?? null,
    candidateKey: branCandidateKey(group, candidate),
    drawn,
    intersects: candidate.intersects === true,
    label: [
      candidate.intersects ? '相交' : '',
      candidate.vertical === true ? '垂直高差' : '',
      provenanceLabel(provenance),
      ...(candidate.parallel ? parallelDetailLabel(candidate.parallel) : []),
      segment,
    ].filter(Boolean).join(' · '),
  };
}

/**
 * `branGroups × facet 勾选 × 标注开关` → `resultRows` / `annotationCandidates`。
 * 没勾的类型整桶不进表、不画；勾了的类型全部候选进表，只有开了「标注」的那几条进 `annotationCandidates`
 * （`ViewerPanel` 盯着它经 `bran-clearance` external source 画尺寸）。`index` 是桶内位置，与勾选无关，尺寸 id 才稳定。
 * 登记在 `candidateProvenance` 里的候选（三维点选的估算）把来源标签一起带出去，画尺寸时才知道要标「≈」。
 */
function applyBranSelection(state: SpatialComputeScenarioState): void {
  const selectedNouns = new Set(state.nounFacets.filter((facet) => facet.selected).map((facet) => facet.noun));
  const drawn = new Set(state.drawnCandidateKeys);
  const visibleGroups = state.branGroups.filter((group) => selectedNouns.has(group.group));
  state.resultRows = visibleGroups.flatMap((group) =>
    group.candidates.map((candidate) => {
      const key = branCandidateKey(group.group, candidate);
      return toBranResultRow(group.group, candidate, drawn.has(key), state.candidateProvenance[key]);
    }),
  );
  state.annotationCandidates = visibleGroups.flatMap((group) =>
    group.candidates
      .map((candidate, index): BranNearestClearanceAnnotationCandidate => {
        const provenance = state.candidateProvenance[branCandidateKey(group.group, candidate)];
        return provenance
          ? { targetGroup: group.group, candidate, index, provenance }
          : { targetGroup: group.group, candidate, index };
      })
      .filter((item) => drawn.has(branCandidateKey(group.group, item.candidate))),
  );
}

type BranNearestClearanceQuery = {
  structureCategory: SpatialComputeScenarioState['structureCategory'];
  structuralAngleDeg: number;
  /** 已归一成 `a_b` */
  sourceRefno: string;
  /** 「全部构件类型」下的目标 NOUN 白名单；空数组 = 半径内全部类型（单组分类时忽略） */
  targetNouns: string[];
  /** 垂直距口径的 NOUN 白名单（楼板类按 Z 向高差量）；空数组 = 全按三维最近距 */
  verticalNouns: string[];
  /** 目标过滤之后再剔掉的噪声类型；空数组 = 不剔 */
  excludeNouns: string[];
  radius: number;
};

/**
 * 取 BRAN 净距（gen-model-v1 `/api/v1/spatial/nearest-clearance`）。响应形状沿用 legacy 时代的 `BranNearestClearanceResponse`
 * （plan §3.2「两边同形」），v1 的返回值赋给它就是这条契约的编译期检查。
 *
 * 请求口径：`source_mode=bran_centerline` 显式发（不吃服务端缺省）、`group_by=noun` 且不给任何目标 = 半径内全部类型
 * （负几何服务端默认剔）、`max_per_group` 每类多取几条供列表勾选、`scope=all_loaded`、`surface=1`（2026-10-17 拍板：
 * 距离从管外表面起算、标注起点推到管表面——比中心线起算少报一个管半径；BRAN 无外径时服务端出 warning 退回中心线起算）。
 */
async function fetchBranNearestClearance(query: BranNearestClearanceQuery): Promise<BranNearestClearanceResponse> {
  return await genModelV1SpatialNearestClearance({
    sourceRefno: query.sourceRefno,
    sourceMode: 'bran_centerline',
    groupBy: query.structureCategory === 'all' ? 'noun' : 'target_groups',
    targetGroups: query.structureCategory === 'all' ? undefined : [query.structureCategory],
    // 白名单只在「全部构件类型」（group_by=noun）下生效；选了具体结构类别时它就是目标本身
    targetNouns: query.structureCategory === 'all' ? query.targetNouns : undefined,
    // 垂直口径与目标过滤无关：任何分桶下命中名单内的 noun 都按 Z 向高差量
    verticalNouns: query.verticalNouns,
    structuralAngleDeg: query.structuralAngleDeg,
    excludeNouns: query.excludeNouns,
    radius: query.radius,
    maxPerGroup: BRAN_CLEARANCE_MAX_PER_NOUN,
    scope: 'all_loaded',
    surface: true,
  });
}

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalNumber(raw: string | number | null | undefined, fieldLabel: string): number | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldLabel} 必须是数字`);
  }
  return value;
}

export type SpatialComputeStoreOptions = Readonly<{
  /**
   * 选中构件 → 所属 BRAN（点中管件也算「选中 BRAN」，与 `measure_pipe_to_structure` 同口径）。
   * 缺省用 DTX 实例缓存的 `findOwnerBranRefnoAcrossAllDbnos`（动态引入：该模块牵 three.js 加载链）。
   */
  resolveOwnerBran?: (refno: string) => string | null;
  /** 「跟随选中」防抖窗口（连点一串构件只发一次查询）；默认 350ms，测试给 0 */
  autoFollowDebounceMs?: number;
}>;

export function createSpatialComputeStore(options: SpatialComputeStoreOptions = {}) {
  const viewerContext = useViewerContext();
  const selection = useSelectionStore();
  const autoFollowDebounceMs = options.autoFollowDebounceMs ?? 350;
  /** 「跟随选中」开关：开着时选中 BRAN / 管件自动提交本场景；结果照常走 facet + 每类最近 1 条标注。 */
  const autoFollowSelection = ref(false);
  let autoFollowTimer: ReturnType<typeof setTimeout> | null = null;
  /** 自动模式最近一次触发查询的 BRAN：重选同一根不重复请求。 */
  let autoQueriedBranRefno = '';
  const panelMode = ref<'query' | 'compute'>('compute');
  const activeScenario = ref<SpatialComputeScenarioKey>('branNearestClearance');
  const scenarioExpanded = ref(false);
  const requestTokens: Record<string, number> = {};
  let nextRequestToken = 0;
  let calculationsAllowed = true;
  const scenarios = reactive<Record<SpatialComputeScenarioKey, SpatialComputeScenarioState>>({
    branNearestClearance: createScenarioState('branNearestClearance'),
  });
  /** 「范围显示」半径输入（mm 字符串，与面板输入框同形）；随快照持久化（D7 随 scope）。 */
  const branRangeDistance = ref('5000');

  function captureSnapshot() {
    const state = scenarios.branNearestClearance;
    return cloneResultSnapshot({ coordinateSpace: 'e3d-world-mm',
      inputs: { suppoRefno: state.suppoRefno, structureCategory: state.structureCategory, structuralAngleDeg: state.structuralAngleDeg,
        searchRadius: state.searchRadius, targetNouns: state.targetNouns, verticalNouns: state.verticalNouns, excludeNouns: state.excludeNouns },
      queriedSourceRefno: state.queriedSourceRefno, branGroups: state.branGroups, nounFacets: state.nounFacets,
      drawnCandidateKeys: state.drawnCandidateKeys, candidateProvenance: state.candidateProvenance,
      excludedSelfMembers: state.excludedSelfMembers, warnings: state.warnings,
      autoFollowSelection: autoFollowSelection.value,
      rangeDistanceMm: Number(branRangeDistance.value) || 5000 });
  }
  function prepareSnapshotRestore(value: unknown): () => void {
    const state = createScenarioState('branNearestClearance');
    if (value === null) return () => {
      Object.assign(scenarios.branNearestClearance, state);
      autoFollowSelection.value = false;
      branRangeDistance.value = '5000';
    };
    value = cloneResultSnapshot(value);
    const data = value as Record<string, unknown>;
    const inputs = data?.inputs as Record<string, unknown>;
    if (!data || data.coordinateSpace !== 'e3d-world-mm' || !inputs || !['all', 'wall', 'column', 'beam', 'slab'].includes(String(inputs.structureCategory))
        || !['suppoRefno', 'structuralAngleDeg', 'searchRadius', 'excludeNouns'].every(key => typeof inputs[key] === 'string')
        || (inputs.targetNouns !== undefined && typeof inputs.targetNouns !== 'string')
        || (inputs.verticalNouns !== undefined && typeof inputs.verticalNouns !== 'string')
        || typeof data.queriedSourceRefno !== 'string' || !Array.isArray(data.branGroups) || !Array.isArray(data.nounFacets)
        || !Array.isArray(data.drawnCandidateKeys) || !data.drawnCandidateKeys.every(key => typeof key === 'string')
        || !Array.isArray(data.warnings) || !data.warnings.every(warning => typeof warning === 'string')
        || typeof data.excludedSelfMembers !== 'number' || !Number.isInteger(data.excludedSelfMembers) || data.excludedSelfMembers < 0) throw new Error('BRAN净距保存格式无效');
    // 2026-10-17 新增两格：旧快照没有按缺省读，有就必须合型（开关布尔 / 半径 1–100000 mm）
    if (data.autoFollowSelection !== undefined && typeof data.autoFollowSelection !== 'boolean') throw new Error('BRAN净距保存格式无效');
    if (data.rangeDistanceMm !== undefined && (!Number.isFinite(data.rangeDistanceMm) || (data.rangeDistanceMm as number) < 1 || (data.rangeDistanceMm as number) > 100000)) throw new Error('BRAN净距保存格式无效');
    const groups = normalizeBranNearestGroups(data.branGroups as BranNearestClearanceGroupResult[]);
    const pointValid = (point: unknown) => {
      const p = point as { x?: unknown; y?: unknown; z?: unknown } | null;
      return !!p && [p.x, p.y, p.z].every(number => typeof number === 'number' && Number.isFinite(number));
    };
    const keys = new Set<string>();
    for (const group of groups) {
      if (typeof group.group !== 'string' || !group.group) throw new Error('BRAN净距分组无效');
      for (const candidate of group.candidates) {
        if (!candidate || typeof candidate.refno !== 'string' || !candidate.refno || typeof candidate.noun !== 'string'
            || !Number.isFinite(candidate.distance_mm) || candidate.distance_mm < 0 || typeof candidate.intersects !== 'boolean'
            || !candidate.annotation || candidate.annotation.label_mm !== candidate.distance_mm
            || !pointValid(candidate.annotation.start_point) || !pointValid(candidate.annotation.end_point)
            || (candidate.variant !== undefined && typeof candidate.variant !== 'string')
            || (candidate.vertical !== undefined && typeof candidate.vertical !== 'boolean')) throw new Error('BRAN净距结果或世界坐标无效');
        const key = branCandidateKey(group.group, candidate);
        if (keys.has(key)) throw new Error('BRAN净距标识重复');
        keys.add(key);
      }
    }
    const expectedAccuracy = { 'centerline-to-aabb': 'approximate-bounds', 'sampled-object': 'approximate-sampled',
      'parallel-centerline': 'exact-centerline', 'surface-to-surface': 'exact-surface' };
    const provenance = data.candidateProvenance as Record<string, BranClearanceProvenance>;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) throw new Error('BRAN净距来源无效');
    for (const item of Object.values(provenance)) {
      if (!item || typeof item.method !== 'string' || !Object.prototype.hasOwnProperty.call(expectedAccuracy, item.method)
          || expectedAccuracy[item.method] !== item.accuracyClass) throw new Error('BRAN净距精度口径无效');
      if (item.modelVersion && [item.modelVersion.sourceSesno, item.modelVersion.targetSesno].some(sesno => sesno !== null && (!Number.isInteger(sesno) || sesno < 0))) throw new Error('BRAN模型版本无效');
    }
    const facets = data.nounFacets as BranNounFacet[];
    if (facets.some(facet => !facet || typeof facet.noun !== 'string' || typeof facet.selected !== 'boolean'
        || !Number.isFinite(facet.count) || facet.count < 0 || !groups.some(group => group.group === facet.noun))) throw new Error('BRAN净距类型筛选无效');
    Object.assign(state, inputs);
    state.queriedSourceRefno = data.queriedSourceRefno;
    state.branGroups = groups;
    state.nounFacets = facets;
    state.drawnCandidateKeys = (data.drawnCandidateKeys as string[]).filter(key => keys.has(key));
    state.candidateProvenance = Object.fromEntries([...keys].map(key => [key, { ...(provenance[key] ?? SERVER_BRAN_CLEARANCE_PROVENANCE), status: 'stale' }]));
    state.excludedSelfMembers = data.excludedSelfMembers;
    state.warnings = [...data.warnings as string[], '已恢复本机结果，模型版本未核实；请重新查询或精算后验收。'];
    state.responseText = '已恢复本机结果，待重算';
    applyBranSelection(state);
    const restoredAutoFollow = data.autoFollowSelection === true;
    const restoredRange = typeof data.rangeDistanceMm === 'number' ? data.rangeDistanceMm : 5000;
    return () => {
      Object.assign(scenarios.branNearestClearance, state);
      // 直接置开关不走 setAutoFollowSelection：恢复的结果已全标 stale，不该立刻对当前选中发一次查询。
      autoFollowSelection.value = restoredAutoFollow;
      branRangeDistance.value = String(restoredRange);
    };
  }
  const persistence = createScopedResultPersistence({
    prefix: 'plant3d-bran-clearance-v1',
    sources: [() => scenarios.branNearestClearance],
    capture: captureSnapshot,
    restore: value => {
      const apply = prepareSnapshotRestore(value);
      apply();
      // 打开页面不自动绘制历史 BRAN 净距：本机恢复后清空已标注集合，需用户逐条点「标注」。
      // 校审回放走导出的 prepareSnapshotRestore，不经过这里，照旧显示。
      const scenario = scenarios.branNearestClearance;
      if (scenario.drawnCandidateKeys.length > 0) {
        scenario.drawnCandidateKeys = [];
        applyBranSelection(scenario);
      }
    },
    invalidate: allowed => {
      calculationsAllowed = allowed;
      requestTokens.branNearestClearance = ++nextRequestToken;
      scenarios.branNearestClearance.loading = false;
      scenarios.branNearestClearance.refiningKeys = [];
    },
  });

  const scenarioList: SpatialComputeScenarioMeta[] = [...SCENARIO_META];
  const currentScenarioMeta = computed(() => scenarioList.find((item) => item.key === activeScenario.value) ?? scenarioList[0]!);
  const currentScenarioState = computed(() => scenarios[activeScenario.value]);
  const isBusy = computed(() => Object.values(scenarios).some((item) => item.loading));
  const currentSummary = computed(() => {
    const state = currentScenarioState.value;
    if (state.error) return state.error;
    if (state.responseText) return '已返回结果';
    return `${currentScenarioMeta.value.endpoint} · 只需完整 Refno`;
  });

  function setPanelMode(mode: 'query' | 'compute') {
    panelMode.value = mode;
  }

  function setActiveScenario(key: SpatialComputeScenarioKey) {
    activeScenario.value = key;
  }

  function resetScenario(key: SpatialComputeScenarioKey = activeScenario.value) {
    requestTokens[key] = ++nextRequestToken;
    Object.assign(scenarios[key], createScenarioState(key));
    autoQueriedBranRefno = '';
  }

  function applyCurrentSelection() {
    const viewer = viewerContext.viewerRef.value;
    const selectedRefno = selection.selectedRefno.value || viewer?.scene.selectedObjectIds[0] || null;
    if (!selectedRefno) {
      currentScenarioState.value.error = '请先在三维里选中一个 BRAN';
      return;
    }
    currentScenarioState.value.suppoRefno = normalizeBranComputeRefno(selectedRefno);
    currentScenarioState.value.error = '';
  }

  async function submitScenario(key: SpatialComputeScenarioKey = activeScenario.value) {
    const state = scenarios[key];
    if (!calculationsAllowed) { state.error = '历史版本对比中不能使用当前模型查询净距，请退出对比后重算。'; return; }
    const token = ++nextRequestToken;
    requestTokens[key] = token;
    const refno = normalizeBranComputeRefno(state.suppoRefno);
    if (!refno) {
      state.loading = false;
      state.error = '请输入完整 BRAN refno';
      state.responseText = '';
      clearScenarioResults(state);
      return;
    }

    state.loading = true;
    state.error = '';
    state.responseText = '';
    clearScenarioResults(state);

    try {
      const structuralAngleDeg = parseOptionalNumber(state.structuralAngleDeg, '分类角度') ?? 5;
      if (structuralAngleDeg < 0 || structuralAngleDeg > 45) throw new Error('分类角度必须在 0 到 45 度之间');
      const branResponse = await fetchBranNearestClearance({
        structureCategory: state.structureCategory,
        structuralAngleDeg,
        sourceRefno: refno,
        targetNouns: splitCsv(state.targetNouns),
        verticalNouns: splitCsv(state.verticalNouns),
        excludeNouns: splitCsv(state.excludeNouns),
        radius: parseOptionalNumber(state.searchRadius, 'radius') ?? 5000,
      });
      if (requestTokens[key] !== token) return;
      state.responseText = JSON.stringify(branResponse, null, 2);
      if (!branResponse.success) {
        state.error = branResponse.error || branResponse.message || '请求失败';
        clearScenarioResults(state);
        return;
      }
      state.branGroups = normalizeBranNearestGroups(branResponse.nearest_by_group);
      state.queriedSourceRefno = refno;
      state.warnings = [...(branResponse.warnings ?? [])];
      state.nounFacets = buildBranNounFacets(state.branGroups, branResponse.noun_counts);
      state.drawnCandidateKeys = defaultDrawnCandidateKeys(state.branGroups);
      state.excludedSelfMembers = branResponse.excluded_self_members ?? 0;
      applyBranSelection(state);
    } catch (error) {
      if (requestTokens[key] !== token) return;
      state.error = error instanceof Error ? error.message : String(error);
      state.responseText = '';
      clearScenarioResults(state);
    } finally {
      if (requestTokens[key] === token) {
        state.loading = false;
      }
    }
  }

  async function refineBranCandidate(candidateKey: string) {
    const state = scenarios.branNearestClearance;
    if (!calculationsAllowed) { state.error = '历史版本对比中不能使用当前模型精算净距，请退出对比后重算。'; return; }
    const matched = findBranCandidateByKey(state.branGroups, candidateKey);
    const candidate = matched?.item;
    const ownerGroup = matched?.group;
    if (!candidate || !ownerGroup || candidate.parallel || !state.queriedSourceRefno || state.refiningKeys.includes(candidateKey)) return;
    const token = requestTokens.branNearestClearance;
    const sourceRefno = state.queriedSourceRefno;
    state.refiningKeys.push(candidateKey);
    state.error = '';
    try {
      // 垂直距候选（楼板类）的精算也走垂直口径：竖直射线网格测距，不是三维最近点。
      const response = await genModelV1SurfaceClearance({
        sourceRefno,
        targetRefno: candidate.refno,
        targetKind: 'any',
        vertical: candidate.vertical === true ? true : undefined,
      });
      if (requestTokens.branNearestClearance !== token) return;
      const result = response.result;
      const VERTICAL_WITNESSES = new Set(['vertical-ray', 'vertical-ray-miss', 'vertical-aabb']);
      const validWitness = candidate.vertical === true
        ? result?.vertical === true && VERTICAL_WITNESSES.has(result.witness ?? '')
        : result?.witness === 'closest-points'
          || (result?.witness === 'aabb-overlap-center' && result.intersects === true && result.distance_mm === 0);
      if (!response.success || response.unit !== 'mm' || response.accuracy_class !== 'exact-surface'
        || !Number.isFinite(response.error_bound_mm) || response.error_bound_mm < 0 || response.error_bound_mm > 10
        || !result || !Number.isFinite(result.distance_mm) || result.distance_mm < 0
        || !validWitness
        || [result.source_point, result.target_point].some((point) => !point || ![point.x, point.y, point.z].every(Number.isFinite))) {
        throw new Error('未取得可靠的外表面最近点，保留包围盒估算；请检查网格或相交状态。');
      }
      const samePoint = result.source_point.x === result.target_point.x
        && result.source_point.y === result.target_point.y
        && result.source_point.z === result.target_point.z;
      const startPoint = (samePoint && candidate.annotation?.start_point)
        ? { ...candidate.annotation.start_point }
        : { ...result.source_point };
      const endPoint = (samePoint && candidate.annotation?.end_point)
        ? { ...candidate.annotation.end_point }
        : { ...result.target_point };
      candidate.distance_mm = result.distance_mm;
      candidate.intersects = result.intersects;
      candidate.nearest = {
        source_segment_refno: normalizeBranComputeRefno(result.source_leaf_refno), source_segment_order: null,
        source_point: { ...result.source_point }, target_point: { ...result.target_point },
        vector: { dx: result.target_point.x - result.source_point.x, dy: result.target_point.y - result.source_point.y, dz: result.target_point.z - result.source_point.z },
      };
      candidate.annotation = { start_point: startPoint, end_point: endPoint, label_mm: result.distance_mm };
      ownerGroup.candidates.sort((a, b) => a.distance_mm - b.distance_mm);
      state.candidateProvenance[candidateKey] = { method: 'surface-to-surface', accuracyClass: 'exact-surface', status: 'current',
        modelVersion: { sourceSesno: response.model?.source_sesno ?? null, targetSesno: response.model?.target_sesno ?? null } };
      state.warnings = [...new Set([...state.warnings, ...(response.warnings ?? []), '精算采用当前实体网格外表面；保温层/包络口径及专业 10 mm 对照验收待确认。'])];
      applyBranSelection(state);
    } catch (error) {
      if (requestTokens.branNearestClearance === token) state.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (requestTokens.branNearestClearance === token) state.refiningKeys = state.refiningKeys.filter((key) => key !== candidateKey);
    }
  }

  const refiningAll = ref(false);
  /** 「全部精算」进度：done = 已处理（含失败）条数，total = 本次队列条数。 */
  const refineAllProgress = reactive({ done: 0, total: 0 });
  let refineAllCancelRequested = false;

  /**
   * 「全部精算」：把当前画在三维里的候选（`annotationCandidates`，即勾选类型 × 开了「标注」的那批）里
   * 还不是网格精算的逐条升级为 `surface-clearance`。并发受控（默认 3：单次精算 100–500ms、后端网格读有锁，
   * 并发太高收益递减还拖慢交互）；任一条失败只记 `state.error` 不阻塞其余；用 `requestTokens` 作 epoch，
   * 切 BRAN / reset / 进版本对比时队列自动作废；`cancelRefineAllDrawn` 让用户随时停。
   */
  async function refineAllDrawnCandidates(concurrency = 3) {
    const state = scenarios.branNearestClearance;
    if (refiningAll.value || !calculationsAllowed || !state.queriedSourceRefno) return;
    const keys = [...new Set(state.annotationCandidates
      .filter(item => !item.candidate.parallel)
      .map(item => branCandidateKey(item.targetGroup, item.candidate))
      .filter(key => (state.candidateProvenance[key] ?? SERVER_BRAN_CLEARANCE_PROVENANCE).method !== 'surface-to-surface'))];
    if (keys.length === 0) return;
    const token = requestTokens.branNearestClearance;
    refiningAll.value = true;
    refineAllCancelRequested = false;
    refineAllProgress.done = 0;
    refineAllProgress.total = keys.length;
    const queue = [...keys];
    const worker = async () => {
      for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
        if (refineAllCancelRequested || requestTokens.branNearestClearance !== token) return;
        await refineBranCandidate(key);
        refineAllProgress.done += 1;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), keys.length) }, () => worker()));
    } finally {
      refiningAll.value = false;
    }
  }

  function cancelRefineAllDrawn() {
    refineAllCancelRequested = true;
  }

  function toggleScenarioExpanded() {
    scenarioExpanded.value = !scenarioExpanded.value;
  }

  /** 勾 / 不勾某一类：整桶进出结果表与三维标注，不重新请求。 */
  function toggleBranNounFacet(noun: string) {
    const state = scenarios.branNearestClearance;
    const facet = state.nounFacets.find((item) => item.noun === noun);
    if (!facet) return;
    facet.selected = !facet.selected;
    applyBranSelection(state);
  }

  function setAllBranNounFacets(selected: boolean) {
    const state = scenarios.branNearestClearance;
    for (const facet of state.nounFacets) facet.selected = selected;
    applyBranSelection(state);
  }

  /** 单条候选的「标注」开关：默认只有每类最近 1 条是开的。 */
  function toggleBranCandidateDrawn(candidateKey: string) {
    const state = scenarios.branNearestClearance;
    const drawn = new Set(state.drawnCandidateKeys);
    if (drawn.has(candidateKey)) drawn.delete(candidateKey);
    else drawn.add(candidateKey);
    state.drawnCandidateKeys = [...drawn];
    applyBranSelection(state);
  }

  async function resolveOwnerBranRefno(refno: string): Promise<string | null> {
    const resolver = options.resolveOwnerBran
      ?? (await import('@/composables/useDbnoInstancesDtxLoader')).findOwnerBranRefnoAcrossAllDbnos;
    return resolver(refno);
  }

  function clearAutoFollowTimer() {
    if (autoFollowTimer !== null) {
      clearTimeout(autoFollowTimer);
      autoFollowTimer = null;
    }
  }

  /** 自动模式核心：选中（或其所属）BRAN 变了才重查；同一根重选、选中非 BRAN 都不动现有结果。 */
  async function autoSubmitForSelection(rawRefno: string | null): Promise<void> {
    const refno = rawRefno ? normalizeBranComputeRefno(rawRefno) : '';
    const branRefno = refno ? await resolveOwnerBranRefno(refno) : null;
    if (!autoFollowSelection.value || !branRefno || branRefno === autoQueriedBranRefno) return;
    autoQueriedBranRefno = branRefno;
    const state = scenarios.branNearestClearance;
    state.suppoRefno = branRefno;
    await submitScenario('branNearestClearance');
  }

  let suppressedAutoFollowRefno = '';
  let preservingResultsDepth = 0;

  /**
   * 结果行「跳转」选中目标构件时抑制单次跟随选中重查（D1a）：
   * 避免点击相邻管件目标行时把源 BRAN 切走并冲掉当前结果表。
   */
  function suppressAutoFollowOnce(refno: string) {
    const normalized = normalizeBranComputeRefno(refno);
    // 已经是当前选中 → 这次「跳转」不会触发选中 watcher，这枚武装会悬空：之后用户再手动选中
    // 同一构件时会被悬空武装吞掉一次跟随。此时不武装（本来也不会触发 watcher）。
    if (normalizeBranComputeRefno(selection.selectedRefno.value ?? '') !== normalized) {
      suppressedAutoFollowRefno = normalized;
    }
    // 已排队的防抖提交也要取消——否则武装 suppress 前那次选中的提交仍会在防抖窗内把 BRAN 切走
    clearAutoFollowTimer();
  }

  /**
   * 在按需补装几何（如「X 光查看 / 仅显示 / 跳转 / 范围显示」）期间保持现有净距结果与精算状态（F2）：
   * 回调执行期间触发的 `__dtxAfterInstancesLoaded -> handleInstancesLoaded()` 不重置当前结果。
   */
  async function runWithPreservedResults<T>(fn: () => Promise<T> | T): Promise<T> {
    preservingResultsDepth += 1;
    try {
      return await fn();
    } finally {
      preservingResultsDepth = Math.max(0, preservingResultsDepth - 1);
    }
  }

  const stopAutoFollowWatch = watch(
    () => selection.selectedRefno.value,
    (refno) => {
      const normalized = refno ? normalizeBranComputeRefno(refno) : '';
      if (suppressedAutoFollowRefno && normalized === suppressedAutoFollowRefno) {
        suppressedAutoFollowRefno = '';
        return;
      }
      suppressedAutoFollowRefno = '';
      if (!autoFollowSelection.value) return;
      clearAutoFollowTimer();
      autoFollowTimer = setTimeout(() => {
        autoFollowTimer = null;
        // 版本对比（calculationsAllowed=false）下静默跳过：对比里点 A/B 隔离图层也写选中，不能连发查询。
        if (calculationsAllowed) void autoSubmitForSelection(refno);
      }, autoFollowDebounceMs);
    },
  );

  /** 开 / 关「跟随选中」。打开时对当前选中立即评估一次（已是 BRAN 选中状态不用重新点）。 */
  function setAutoFollowSelection(enabled: boolean) {
    autoFollowSelection.value = enabled;
    clearAutoFollowTimer();
    if (!enabled) return;
    autoQueriedBranRefno = '';
    void autoSubmitForSelection(selection.selectedRefno.value);
  }

  /**
   * 新一批实例加载完成（范围显示、树按需加载、show_refno 等都会走 `__dtxAfterInstancesLoaded`）后的失效处理。
   * 返回 true = 结果保住（调用方据此跳过三维标注清屏），false = 已按失效语义重置。
   *
   * 已有生效结果（`queriedSourceRefno` 非空）时不再无条件清空（spec T2/F2）：
   * - 手动模式 或 已有用户精算记录 → 直接保留，重置只发生在用户切 BRAN / 点「执行计算」/ 切项目；
   * - 自动模式且全为初始估算 → 重置后静默重刷，重查锚定**产生结果的那根 BRAN**（`queriedSourceRefno`）——
   *   dim 点选 / 行跳转之后 `selectedRefno` 往往是目标构件而非 BRAN，按当前选中解析会静默放弃、结果永久丢失；
   *   拿不到锚点才退回按当前选中解析。
   */
  function handleInstancesLoaded(): boolean {
    if (preservingResultsDepth > 0) return true;
    const state = scenarios.branNearestClearance;
    const hasResults = Boolean(state.queriedSourceRefno);
    const hasRefined = Object.keys(state.candidateProvenance).length > 0;
    if (hasResults && (hasRefined || !autoFollowSelection.value)) return true;
    const anchorRefno = state.queriedSourceRefno;
    resetScenario('branNearestClearance');
    if (!autoFollowSelection.value || !calculationsAllowed) return false;
    clearAutoFollowTimer();
    autoFollowTimer = setTimeout(() => {
      autoFollowTimer = null;
      if (!calculationsAllowed) return;
      if (anchorRefno) {
        scenarios.branNearestClearance.suppoRefno = anchorRefno;
        autoQueriedBranRefno = normalizeBranComputeRefno(anchorRefno);
        void submitScenario('branNearestClearance');
      } else {
        void autoSubmitForSelection(selection.selectedRefno.value);
      }
    }, autoFollowDebounceMs);
    return false;
  }

  /**
   * 换模型（dbno 变了）：旧 BRAN 净距结果、标注候选与三维标注都属于另一个模型，必须一并作废。
   * 与 `handleInstancesLoaded()` 的区别：后者是**同一模型内**的增量补装（结果仍然有效、可静默重刷）；
   * 换模型时旧 BRAN 在新模型里未必存在——只作废、不自动重查。
   */
  function handleModelChanged(): boolean {
    resetScenario('branNearestClearance');
    return false;
  }

  const onProjectChanged = () => {
    autoQueriedBranRefno = '';
    if (persistence.hasPersistenceContext.value) return;
    // 换模型（工程路径变了，含 dbnum 目录）：BRAN 净距结果属于旧模型 → 硬作废、不自动重查
    handleModelChanged();
    for (const k of Object.keys(scenarios) as SpatialComputeScenarioKey[]) {
      if (k === 'branNearestClearance') continue; // 上面已作废
      requestTokens[k] = ++nextRequestToken;
      Object.assign(scenarios[k], createScenarioState(k));
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('modelProjectChanged', onProjectChanged);

  return {
    ...persistence,
    captureSnapshot,
    prepareSnapshotRestore: (value: unknown) => {
      const apply = prepareSnapshotRestore(value);
      return () => persistence.applyPreparedRestore(apply);
    },
    dispose: () => { persistence.dispose(); stopAutoFollowWatch(); clearAutoFollowTimer(); if (typeof window !== 'undefined') window.removeEventListener('modelProjectChanged', onProjectChanged); },
    panelMode,
    activeScenario,
    scenarioList,
    scenarios,
    scenarioExpanded,
    currentScenarioMeta,
    currentScenarioState,
    isBusy,
    currentSummary,
    setPanelMode,
    setActiveScenario,
    resetScenario,
    applyCurrentSelection,
    autoFollowSelection,
    setAutoFollowSelection,
    suppressAutoFollowOnce,
    runWithPreservedResults,
    handleInstancesLoaded,
    handleModelChanged,
    branRangeDistance,
    submitScenario,
    refineBranCandidate,
    refiningAll,
    refineAllProgress,
    refineAllDrawnCandidates,
    cancelRefineAllDrawn,
    toggleScenarioExpanded,
    toggleBranNounFacet,
    setAllBranNounFacets,
    toggleBranCandidateDrawn,
  };
}

let sharedSpatialComputeStore: ReturnType<typeof createSpatialComputeStore> | null = null;

export function useSpatialCompute() {
  if (!sharedSpatialComputeStore) {
    sharedSpatialComputeStore = createSpatialComputeStore();
  }
  return sharedSpatialComputeStore;
}

export function resetSpatialComputeStore() {
  sharedSpatialComputeStore?.dispose();
  sharedSpatialComputeStore = null;
}
