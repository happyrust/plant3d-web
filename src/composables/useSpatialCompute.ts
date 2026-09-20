import { computed, reactive, ref } from 'vue';

import type {
  BranNearestClearanceCandidate,
  BranNearestClearanceGroupResult,
  BranNearestClearanceResponse,
  BranParallelSpacingDetail,
} from '@/api/genModelSpatialApi';

import { genModelV1SpatialNearestClearance } from '@/api/genModelV1Api';
import { type BranParallelRunPair, describeStraightRun } from '@/composables/branParallelSpacing';
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
};

/**
 * 一条净距候选是怎么算出来的（`docs/plans/2026-09-11-measurement-clearance-dimension-convergence-plan.md` D2：精度不是布尔值）。
 * 服务端候选是沿中心线量到候选**包围盒**（目标侧不是网格精算）；三维里点选管件得到的那条是 DTX 网格采样估算，
 * 进同一份结果时必须带着这个标签，表里与尺寸文字都按它标「估算」；两条 BRAN 平行直段的中心距是两条真实轴线之间的垂距，
 * 精确到中心线本身（`parallel-centerline / exact-centerline`），不标「≈」。
 */
export type BranClearanceProvenance = {
  method: 'centerline-to-aabb' | 'sampled-object' | 'parallel-centerline';
  accuracyClass: 'approximate-bounds' | 'approximate-sampled' | 'exact-centerline';
};

export const SERVER_BRAN_CLEARANCE_PROVENANCE: BranClearanceProvenance = {
  method: 'centerline-to-aabb',
  accuracyClass: 'approximate-bounds',
};

export const INTERACTIVE_BRAN_CLEARANCE_PROVENANCE: BranClearanceProvenance = {
  method: 'sampled-object',
  accuracyClass: 'approximate-sampled',
};

export const PARALLEL_BRAN_SPACING_PROVENANCE: BranClearanceProvenance = {
  method: 'parallel-centerline',
  accuracyClass: 'exact-centerline',
};

export type BranNearestClearanceAnnotationCandidate = {
  targetGroup: string;
  candidate: BranNearestClearanceCandidate;
  index: number;
  /** 缺省 = 服务端候选（`SERVER_BRAN_CLEARANCE_PROVENANCE`）；三维点选写进来的那几条带 `sampled-object` */
  provenance?: BranClearanceProvenance;
};

/**
 * 三维里点选管件算出的一条管-墙/柱估算净距（`useDtxTools.measure_pipe_to_structure`），写进 BRAN 净距结果用。
 * 两个点都要是 **E3D 世界 mm**（与服务端候选同一坐标系；scene → mm 的换算在 viewer 侧做完再交进来）。
 */
export type InteractiveBranClearanceInput = {
  /** 点选的管件 refno，进 `nearest.source_segment_refno` */
  sourceRefno: string;
  targetRefno: string;
  targetNoun: string;
  sourcePointMm: { x: number; y: number; z: number };
  targetPointMm: { x: number; y: number; z: number };
};

/**
 * 三维里点选两根管算出的「两条 BRAN 平行直段的间距」（`useDtxTools.measure_pipe_to_pipe`，plan 2026-09-16 §3.3 ④），
 * 一对平行直段一条候选，写进 BRAN 净距结果用。`pairs` 里的点都是 **E3D 世界 mm**（中心线接口给的就是）。
 */
export type BranParallelSpacingInput = {
  /** 先点的那一根所属 BRAN（`a_b` / `a/b` 都收） */
  sourceBranRefno: string;
  /** 后点的那一根所属 BRAN */
  targetBranRefno: string;
  pairs: readonly BranParallelRunPair[];
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

export type SpatialComputeScenarioField = 'tolerance' | 'suppoType' | 'searchRadius' | 'targetNouns' | 'excludeNouns' | 'neighborWindow';

type SpatialComputeScenarioState = {
  suppoRefno: string;
  tolerance: string;
  suppoType: string;
  searchRadius: string;
  targetNouns: string;
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

const SCENARIO_META: SpatialComputeScenarioMeta[] = [
  {
    key: 'branNearestClearance',
    title: 'BRAN 中心线最近清距',
    description: '沿 BRAN 中心线按类型找半径内最近的构件（墙 / 柱 / 设备 / 支架…），每类默认标注最近 1 条。',
    endpoint: BRAN_NEAREST_CLEARANCE_ENDPOINT,
    exampleRefno: '24381_145018',
    sourceLabel: 'BRAN Refno',
    sourceHelp: 'BRAN 格式示例：24381_145018 或 24381/145018',
    fields: ['searchRadius', 'excludeNouns'],
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
  >
> = {
  branNearestClearance: {
    suppoRefno: '24381_145018',
    tolerance: '',
    suppoType: '',
    searchRadius: '5000',
    targetNouns: '',
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
}

/**
 * 一条候选在结果表 / 标注开关里的键：桶名 + refno（同一构件理论上只会落在一个桶里，带桶名只为稳妥）；
 * 前端交互写入的多条同目标候选（两条 BRAN 之间每对平行直段一条）再带 `#variant`。服务端候选没有 `variant`，键不变。
 */
export function branCandidateKey(group: string, candidate: Pick<BranNearestClearanceCandidate, 'refno' | 'variant'>): string {
  return candidate.variant ? `${group}:${candidate.refno}#${candidate.variant}` : `${group}:${candidate.refno}`;
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
function provenanceLabel(provenance: BranClearanceProvenance | undefined): string {
  switch (provenance?.method) {
    case 'sampled-object':
      return '估算最近距离（网格采样）';
    case 'parallel-centerline':
      return '平行直段中心距';
    default:
      return '';
  }
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
    label: [
      candidate.intersects ? '相交' : '',
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

/** 两条 BRAN 之间平行直段候选的 `variant` 前缀：同一对（不分先后）再测一次就整组替换。 */
function parallelVariantPrefix(branA: string, branB: string): string {
  return `parallel:${[branA, branB].sort().join('~')}:`;
}

/**
 * 一对平行直段 → 与服务端同形的候选：`distance_mm` / `annotation.label_mm` 是中心距，两端点都在轴线上（重叠区中点），
 * `nearest.source_segment_refno/order` 是源直段的首段；明细进 `parallel`，`variant` 区分同一目标 BRAN 的多条。
 */
export function parallelSpacingCandidate(
  sourceBranRefno: string,
  targetBranRefno: string,
  pair: BranParallelRunPair,
  index: number,
): BranNearestClearanceCandidate {
  const source = pair.sourcePointMm;
  const target = pair.targetPointMm;
  const head = pair.source.segments[0];
  return {
    refno: targetBranRefno,
    noun: 'BRAN',
    distance_mm: pair.axisDistanceMm,
    intersects: pair.axisDistanceMm <= 1e-6,
    nearest: {
      source_segment_refno: head?.refno ?? sourceBranRefno,
      source_segment_order: head?.order ?? null,
      source_point: { ...source },
      target_point: { ...target },
      vector: { dx: target.x - source.x, dy: target.y - source.y, dz: target.z - source.z },
    },
    annotation: { start_point: { ...source }, end_point: { ...target }, label_mm: pair.axisDistanceMm },
    variant: `${parallelVariantPrefix(sourceBranRefno, targetBranRefno)}${index}`,
    parallel: {
      source_bran_refno: sourceBranRefno,
      source_run_refno: describeStraightRun(pair.source),
      target_run_refno: describeStraightRun(pair.target),
      overlap_mm: pair.overlapMm,
      angle_deg: pair.angleDeg,
      clearance_mm: pair.clearanceMm,
      source_outside_diameter_mm: pair.source.outsideDiameterMm,
      target_outside_diameter_mm: pair.target.outsideDiameterMm,
    },
  };
}

/**
 * 三维点选的一条管-墙/柱估算净距 → 与服务端同形的候选（`nearest` + `annotation` 两个端点齐全，尺寸系统直接画）。
 * refno 归一成 `a_b`；`source_segment_order` 为 null（点选的是一个管件，不是成员序里的哪一段）；距离由两点算，mm。
 */
export function interactiveBranClearanceCandidate(input: InteractiveBranClearanceInput): BranNearestClearanceCandidate {
  const source = input.sourcePointMm;
  const target = input.targetPointMm;
  const vector = { dx: target.x - source.x, dy: target.y - source.y, dz: target.z - source.z };
  const distance = Math.hypot(vector.dx, vector.dy, vector.dz);
  return {
    refno: normalizeBranComputeRefno(input.targetRefno),
    noun: String(input.targetNoun || '').trim().toUpperCase() || 'UNKNOWN',
    distance_mm: distance,
    intersects: distance <= 1e-6,
    nearest: {
      source_segment_refno: normalizeBranComputeRefno(input.sourceRefno),
      source_segment_order: null,
      source_point: { ...source },
      target_point: { ...target },
      vector,
    },
    annotation: { start_point: { ...source }, end_point: { ...target }, label_mm: distance },
  };
}

type BranNearestClearanceQuery = {
  /** 已归一成 `a_b` */
  sourceRefno: string;
  /** 目标过滤之后再剔掉的噪声类型；空数组 = 不剔 */
  excludeNouns: string[];
  radius: number;
};

/**
 * 取 BRAN 净距（gen-model-v1 `/api/v1/spatial/nearest-clearance`）。响应形状沿用 legacy 时代的 `BranNearestClearanceResponse`
 * （plan §3.2「两边同形」），v1 的返回值赋给它就是这条契约的编译期检查。
 *
 * 请求口径：`source_mode=bran_centerline` 显式发（不吃服务端缺省）、`group_by=noun` 且不给任何目标 = 半径内全部类型
 * （负几何服务端默认剔）、`max_per_group` 每类多取几条供列表勾选、`scope=all_loaded`。`surface` 等格留给服务端缺省
 * （D4 未拍板：净距是否缺省扣外径）。
 */
async function fetchBranNearestClearance(query: BranNearestClearanceQuery): Promise<BranNearestClearanceResponse> {
  return await genModelV1SpatialNearestClearance({
    sourceRefno: query.sourceRefno,
    sourceMode: 'bran_centerline',
    groupBy: 'noun',
    excludeNouns: query.excludeNouns,
    radius: query.radius,
    maxPerGroup: BRAN_CLEARANCE_MAX_PER_NOUN,
    scope: 'all_loaded',
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

export function createSpatialComputeStore() {
  const viewerContext = useViewerContext();
  const selection = useSelectionStore();
  const panelMode = ref<'query' | 'compute'>('compute');
  const activeScenario = ref<SpatialComputeScenarioKey>('branNearestClearance');
  const scenarioExpanded = ref(false);
  const requestTokens: Record<string, number> = {};
  let nextRequestToken = 0;
  const scenarios = reactive<Record<SpatialComputeScenarioKey, SpatialComputeScenarioState>>({
    branNearestClearance: createScenarioState('branNearestClearance'),
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
    const refno = normalizeBranComputeRefno(state.suppoRefno);
    if (!refno) {
      state.error = '请输入完整 BRAN refno';
      state.responseText = '';
      clearScenarioResults(state);
      return;
    }

    const token = ++nextRequestToken;
    requestTokens[key] = token;

    state.loading = true;
    state.error = '';
    state.responseText = '';
    clearScenarioResults(state);

    try {
      const branResponse = await fetchBranNearestClearance({
        sourceRefno: refno,
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

  /**
   * 三维里点选管件算出的管-墙/柱估算净距，写进**同一份** BRAN 净距结果（同一张表、同一组 facet、同一个 `bran-clearance`
   * external source），不再只 Toast（plan 2026-09-16 §3.3 ③，沿 2026-09-11 收敛计划 §6 M1）。
   * 落到目标类型那一桶的末尾（不重排，别的候选的桶内位置 / 尺寸 id 不变），同一目标再点一次就地替换；
   * 类型 chip 没有就加、有就计数 +1 并勾上；这一条默认开「标注」；来源登记为 `sampled-object`。
   * 下一次跑服务端查询（`submitScenario`）会连它一起清掉——它就是这一份结果的一部分。
   * 返回候选键（`branCandidateKey`）。
   */
  function recordInteractiveBranClearance(input: InteractiveBranClearanceInput): string {
    const state = scenarios.branNearestClearance;
    const candidate = interactiveBranClearanceCandidate(input);
    const key = branCandidateKey(candidate.noun, candidate);

    let group = state.branGroups.find((item) => item.group === candidate.noun);
    if (!group) {
      group = { group: candidate.noun, nouns: [candidate.noun], candidates: [] };
      state.branGroups.push(group);
    }
    // 只替换同目标的「单条」候选（服务端的或上一次点选的）；平行直段那些带 variant 的多条不在此列。
    const existingIndex = group.candidates.findIndex((item) => item.refno === candidate.refno && !item.variant);
    if (existingIndex >= 0) {
      group.candidates.splice(existingIndex, 1, candidate);
    } else {
      group.candidates.push(candidate);
    }

    const facet = state.nounFacets.find((item) => item.noun === candidate.noun);
    if (facet) {
      if (existingIndex < 0) facet.count += 1;
      facet.selected = true;
    } else {
      state.nounFacets.push({ noun: candidate.noun, count: 1, selected: true });
    }

    state.candidateProvenance = { ...state.candidateProvenance, [key]: INTERACTIVE_BRAN_CLEARANCE_PROVENANCE };
    if (!state.drawnCandidateKeys.includes(key)) {
      state.drawnCandidateKeys = [...state.drawnCandidateKeys, key];
    }
    // 上一次服务端查询的报错不该拦住这条画出来（`ViewerPanel` 见 error 就清空 `bran-clearance`）。
    state.error = '';
    applyBranSelection(state);
    activeScenario.value = 'branNearestClearance';
    return key;
  }

  /**
   * 三维里点选两根管算出的「两条 BRAN 平行直段的间距」写进**同一份** BRAN 净距结果（plan 2026-09-16 §3.3 ④）：
   * 一对平行直段一条候选，落进 `BRAN` 那一桶末尾、全部默认开「标注」，来源登记 `parallel-centerline / exact-centerline`。
   * 同一对 BRAN（不分先后）再测一次先把上一次那组整体摘掉再写（结果变了就换、没有平行直段了就清）；
   * 别的候选（服务端的、点选估算的、别的 BRAN 对）原位不动。下一次服务端查询连它们一起清。
   * 返回这次写进去的候选键。
   */
  function recordBranParallelSpacing(input: BranParallelSpacingInput): string[] {
    const state = scenarios.branNearestClearance;
    const sourceBran = normalizeBranComputeRefno(input.sourceBranRefno);
    const targetBran = normalizeBranComputeRefno(input.targetBranRefno);
    const prefix = parallelVariantPrefix(sourceBran, targetBran);
    const isSamePair = (candidate: BranNearestClearanceCandidate) => !!candidate.variant && candidate.variant.startsWith(prefix);

    // 摘掉上一次同一对的那组（哪一桶都看：反着点时目标是另一条 BRAN，也在 BRAN 桶，但别赌）。
    const removedKeys = new Set<string>();
    for (const group of state.branGroups) {
      const kept = group.candidates.filter((candidate) => {
        if (!isSamePair(candidate)) return true;
        removedKeys.add(branCandidateKey(group.group, candidate));
        return false;
      });
      const removed = group.candidates.length - kept.length;
      if (removed > 0) {
        group.candidates = kept;
        const facet = state.nounFacets.find((item) => item.noun === group.group);
        if (facet) facet.count = Math.max(kept.length, facet.count - removed);
      }
    }
    state.branGroups = state.branGroups.filter((group) => group.candidates.length > 0);
    state.nounFacets = state.nounFacets.filter((facet) => state.branGroups.some((group) => group.group === facet.noun));

    const candidates = input.pairs.map((pair, index) => parallelSpacingCandidate(sourceBran, targetBran, pair, index));
    const keys: string[] = [];
    if (candidates.length > 0) {
      let group = state.branGroups.find((item) => item.group === 'BRAN');
      if (!group) {
        group = { group: 'BRAN', nouns: ['BRAN'], candidates: [] };
        state.branGroups.push(group);
      }
      group.candidates.push(...candidates);
      const facet = state.nounFacets.find((item) => item.noun === 'BRAN');
      if (facet) {
        facet.count += candidates.length;
        facet.selected = true;
      } else {
        state.nounFacets.push({ noun: 'BRAN', count: candidates.length, selected: true });
      }
      for (const candidate of candidates) keys.push(branCandidateKey('BRAN', candidate));
    }

    const provenance = { ...state.candidateProvenance };
    for (const key of removedKeys) delete provenance[key];
    for (const key of keys) provenance[key] = PARALLEL_BRAN_SPACING_PROVENANCE;
    state.candidateProvenance = provenance;
    state.drawnCandidateKeys = [
      ...state.drawnCandidateKeys.filter((key) => !removedKeys.has(key)),
      ...keys,
    ];
    state.error = '';
    applyBranSelection(state);
    activeScenario.value = 'branNearestClearance';
    return keys;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('modelProjectChanged', () => {
      for (const k of Object.keys(scenarios) as SpatialComputeScenarioKey[]) {
        requestTokens[k] = ++nextRequestToken;
        Object.assign(scenarios[k], createScenarioState(k));
      }
    });
  }

  return {
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
    submitScenario,
    toggleScenarioExpanded,
    toggleBranNounFacet,
    setAllBranNounFacets,
    toggleBranCandidateDrawn,
    recordInteractiveBranClearance,
    recordBranParallelSpacing,
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
  sharedSpatialComputeStore = null;
}
