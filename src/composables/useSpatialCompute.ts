import { computed, reactive, ref } from 'vue';

import type { ModelSourceKind } from '@/model-source/ports';

import {
  postSpaceFitting,
  postSpaceFittingOffset,
  postSpaceSteelRelative,
  postSpaceSuppoTrays,
  postSpaceTraySpan,
  postSpaceWallDistance,
  queryBranCenterlineNearestClearance,
  type BranNearestClearanceCandidate,
  type BranNearestClearanceGroupResult,
  type BranNearestClearanceResponse,
  type SpaceComputeFittingData,
  type SpaceComputeFittingOffsetData,
  type SpaceComputeSteelRelativeData,
  type SpaceComputeSuppoTrayData,
  type SpaceComputeTraySpanData,
  type SpaceComputeWallDistanceData,
  type SpaceEnvelope,
} from '@/api/genModelSpatialApi';
import { genModelV1SpatialNearestClearance } from '@/api/genModelV1Api';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { getModelSourceKind } from '@/model-source/kind';

export type SpatialComputeScenarioKey =
  | 'fittingOffset'
  | 'fitting'
  | 'wallDistance'
  | 'steelRelative'
  | 'suppoTrays'
  | 'traySpan'
  | 'branNearestClearance';

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
 * 进同一份结果时必须带着这个标签，表里与尺寸文字都按它标「估算」。
 */
export type BranClearanceProvenance = {
  method: 'centerline-to-aabb' | 'sampled-object';
  accuracyClass: 'approximate-bounds' | 'approximate-sampled';
};

export const SERVER_BRAN_CLEARANCE_PROVENANCE: BranClearanceProvenance = {
  method: 'centerline-to-aabb',
  accuracyClass: 'approximate-bounds',
};

export const INTERACTIVE_BRAN_CLEARANCE_PROVENANCE: BranClearanceProvenance = {
  method: 'sampled-object',
  accuracyClass: 'approximate-sampled',
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

type SpatialComputeResultData =
  | SpaceComputeFittingData
  | SpaceComputeFittingOffsetData
  | SpaceComputeWallDistanceData
  | SpaceComputeSteelRelativeData
  | SpaceComputeSuppoTrayData
  | SpaceComputeTraySpanData
  | null;

type SpatialComputeResultEnvelope = SpaceEnvelope<SpatialComputeResultData>;

/**
 * BRAN 净距是唯一按数据源分流的场景（plan `docs/plans/2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md`
 * §3.3，D5 取「`useSpatialCompute` 内按 kind 分流」）：其余六个场景只有旧后端 `/api/space/*` 一种实现。
 * legacy 打 `/api/sqlite-spatial/nearest-clearance`；gen-model-v1 打 `/api/v1/spatial/nearest-clearance`，两边出参同形。
 */
const BRAN_NEAREST_CLEARANCE_ENDPOINT: Record<ModelSourceKind, string> = {
  legacy: '/api/sqlite-spatial/nearest-clearance',
  'gen-model-v1': '/api/v1/spatial/nearest-clearance',
};

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
    key: 'fittingOffset',
    title: '支架与预埋板偏移',
    description: '返回 anchor、panel 与偏移向量。',
    endpoint: '/api/space/fitting-offset',
    exampleRefno: '24383/88342',
    sourceLabel: 'SUPPO Refno',
    sourceHelp: '格式示例：24383_88342',
    fields: ['tolerance'],
  },
  {
    key: 'fitting',
    title: '支架对应预埋板',
    description: '返回板件编号、中心点与匹配方式。',
    endpoint: '/api/space/fitting',
    exampleRefno: '24383/89904',
    sourceLabel: 'SUPPO Refno',
    sourceHelp: '格式示例：24383_89904',
    fields: ['tolerance'],
  },
  {
    key: 'wallDistance',
    title: '距墙 / 定位块',
    description: '返回最近目标与候选列表。',
    endpoint: '/api/space/wall-distance',
    exampleRefno: '24383/88342',
    sourceLabel: 'SUPPO Refno',
    sourceHelp: '格式示例：24383_88342',
    fields: ['searchRadius', 'targetNouns'],
  },
  {
    key: 'steelRelative',
    title: '与钢结构相对定位',
    description: '返回最近钢构点位与向量。',
    endpoint: '/api/space/steel-relative',
    exampleRefno: '24383/89904',
    sourceLabel: 'SUPPO Refno',
    sourceHelp: '格式示例：24383_89904',
    fields: ['searchRadius'],
  },
  {
    key: 'suppoTrays',
    title: '支架对应桥架',
    description: '返回命中的 BRAN / SCTN 列表。',
    endpoint: '/api/space/suppo-trays',
    exampleRefno: '24383/89904',
    sourceLabel: 'SUPPO Refno',
    sourceHelp: '格式示例：24383_89904',
    fields: ['tolerance'],
  },
  {
    key: 'traySpan',
    title: '桥架跨度',
    description: '返回同一 BRAN 上左右相邻支架。',
    endpoint: '/api/space/tray-span',
    exampleRefno: '24383/87412',
    sourceLabel: 'SUPPO Refno',
    sourceHelp: '格式示例：24383_87412',
    fields: ['neighborWindow'],
  },
  {
    key: 'branNearestClearance',
    title: 'BRAN 中心线最近清距',
    description: '沿 BRAN 中心线按类型找半径内最近的构件（墙 / 柱 / 设备 / 支架…），每类默认标注最近 1 条。',
    // 建 store 时按当前数据源换成对应后端的路径（见 `createSpatialComputeStore`）。
    endpoint: BRAN_NEAREST_CLEARANCE_ENDPOINT.legacy,
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
  fittingOffset: {
    suppoRefno: '24383/88342',
    tolerance: '',
    suppoType: '',
    searchRadius: '',
    targetNouns: '',
    excludeNouns: '',
    neighborWindow: '',
  },
  fitting: {
    suppoRefno: '24383/89904',
    tolerance: '',
    suppoType: '',
    searchRadius: '',
    targetNouns: '',
    excludeNouns: '',
    neighborWindow: '',
  },
  wallDistance: {
    suppoRefno: '24383/88342',
    tolerance: '',
    suppoType: 'S2',
    searchRadius: '5000',
    targetNouns: '',
    excludeNouns: '',
    neighborWindow: '',
  },
  steelRelative: {
    suppoRefno: '24383/89904',
    tolerance: '',
    suppoType: '',
    searchRadius: '8000',
    targetNouns: '',
    excludeNouns: '',
    neighborWindow: '',
  },
  suppoTrays: {
    suppoRefno: '24383/89904',
    tolerance: '',
    suppoType: '',
    searchRadius: '',
    targetNouns: '',
    excludeNouns: '',
    neighborWindow: '',
  },
  traySpan: {
    suppoRefno: '24383/87412',
    tolerance: '',
    suppoType: '',
    searchRadius: '',
    targetNouns: '',
    excludeNouns: '',
    neighborWindow: '5000',
  },
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

function normalizeSuppoRefno(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const wrapped = value.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? value;
  const core = wrapped.replace(/^pe:/i, '').replace(/^=/, '').trim();
  return core.replace(/,/g, '/').replace(/_/g, '/');
}

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

function extractResultRows(key: SpatialComputeScenarioKey, envelope: SpatialComputeResultEnvelope): SpatialComputeResultRow[] {
  if (envelope.status !== 'success' || !envelope.data) return [];
  const d = envelope.data;
  switch (key) {
    case 'fittingOffset': {
      const v = d as SpaceComputeFittingOffsetData;
      return [{
        refno: v.panel_refno,
        noun: 'PANEL',
        distanceMm: v.length,
        label: v.within ? '偏移在容差内' : '偏移超出容差',
      }];
    }
    case 'fitting': {
      const v = d as SpaceComputeFittingData;
      return [{
        refno: v.panel_refno,
        noun: 'PANEL',
        distanceMm: null,
        label: `${v.match_method} · ${v.covered ? '已覆盖' : '未覆盖'}`,
      }];
    }
    case 'wallDistance': {
      const v = d as SpaceComputeWallDistanceData;
      const rows: SpatialComputeResultRow[] = [];
      if (v.target) {
        rows.push({
          refno: v.target.refno,
          noun: v.target.noun,
          distanceMm: v.target.distance_mm,
          label: '最近目标',
        });
      }
      for (const c of v.candidates ?? []) {
        rows.push({
          refno: c.refno,
          noun: c.noun,
          distanceMm: c.distance_mm,
          label: '候选',
        });
      }
      return rows;
    }
    case 'steelRelative': {
      const v = d as SpaceComputeSteelRelativeData;
      return [{
        refno: v.steel_refno,
        noun: v.steel_noun,
        distanceMm: v.length,
        label: v.within ? '距离在范围内' : '距离超出范围',
      }];
    }
    case 'suppoTrays': {
      const v = d as SpaceComputeSuppoTrayData;
      return (v.trays ?? []).map((t) => ({
        refno: t.tray_section_refno,
        noun: 'SCTN',
        distanceMm: null,
        label: `BRAN ${t.bran_refno} · ${t.support_type}`,
      }));
    }
    case 'traySpan': {
      const v = d as SpaceComputeTraySpanData;
      const rows: SpatialComputeResultRow[] = [];
      if (v.left_suppo_refno) {
        rows.push({
          refno: v.left_suppo_refno,
          noun: 'SUPPO',
          distanceMm: v.left_distance ?? null,
          label: '左侧相邻支架',
        });
      }
      if (v.right_suppo_refno) {
        rows.push({
          refno: v.right_suppo_refno,
          noun: 'SUPPO',
          distanceMm: v.right_distance ?? null,
          label: '右侧相邻支架',
        });
      }
      return rows;
    }
    case 'branNearestClearance':
      return [];
  }
}

/** 一条候选在结果表 / 标注开关里的键：桶名 + refno（同一构件理论上只会落在一个桶里，带桶名只为稳妥）。 */
export function branCandidateKey(group: string, refno: string): string {
  return `${group}:${refno}`;
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
    return nearest ? [branCandidateKey(group.group, nearest.refno)] : [];
  });
}

/** 表里给非服务端候选看的来源字样（2026-09-11 收敛计划 PR0.2：`sampled-object` 显示「估算最近距离」）。 */
function provenanceLabel(provenance: BranClearanceProvenance | undefined): string {
  return provenance?.method === 'sampled-object' ? '估算最近距离（网格采样）' : '';
}

function toBranResultRow(
  group: string,
  candidate: BranNearestClearanceCandidate,
  drawn: boolean,
  provenance: BranClearanceProvenance | undefined,
): SpatialComputeResultRow {
  const segment = candidate.nearest?.source_segment_refno
    ? `${provenance?.method === 'sampled-object' ? '点选' : 'segment'} ${candidate.nearest.source_segment_refno}${candidate.nearest.source_segment_order != null ? `#${candidate.nearest.source_segment_order}` : ''}`
    : '';
  return {
    refno: candidate.refno,
    noun: candidate.noun,
    distanceMm: Number.isFinite(candidate.distance_mm) ? candidate.distance_mm : null,
    targetGroup: group,
    sourceSegmentRefno: candidate.nearest?.source_segment_refno ?? null,
    sourceSegmentOrder: candidate.nearest?.source_segment_order ?? null,
    candidateKey: branCandidateKey(group, candidate.refno),
    drawn,
    label: [candidate.intersects ? '相交' : '', provenanceLabel(provenance), segment].filter(Boolean).join(' · '),
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
      const key = branCandidateKey(group.group, candidate.refno);
      return toBranResultRow(group.group, candidate, drawn.has(key), state.candidateProvenance[key]);
    }),
  );
  state.annotationCandidates = visibleGroups.flatMap((group) =>
    group.candidates
      .map((candidate, index): BranNearestClearanceAnnotationCandidate => {
        const provenance = state.candidateProvenance[branCandidateKey(group.group, candidate.refno)];
        return provenance
          ? { targetGroup: group.group, candidate, index, provenance }
          : { targetGroup: group.group, candidate, index };
      })
      .filter((item) => drawn.has(branCandidateKey(group.group, item.candidate.refno))),
  );
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
 * 按数据源取 BRAN 净距。两条路径的响应同形（plan §3.2），这里统一按 legacy 的 `BranNearestClearanceResponse` 往下交，
 * v1 那一支的返回值赋给它就是这条「同形」契约的编译期检查。
 *
 * 请求口径两边一致：`source_mode=bran_centerline` 显式发（不吃服务端缺省）、`group_by=noun` 且不给任何目标 = 半径内全部类型
 * （负几何服务端默认剔）、`max_per_group` 每类多取几条供列表勾选、`scope=all_loaded`。`surface` 等 v1 独有的格留给服务端缺省
 * （D4 未拍板：净距是否缺省扣外径）。
 */
async function fetchBranNearestClearance(
  kind: ModelSourceKind,
  query: BranNearestClearanceQuery,
): Promise<BranNearestClearanceResponse> {
  if (kind === 'gen-model-v1') {
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
  return await queryBranCenterlineNearestClearance({
    source_refno: query.sourceRefno,
    group_by: 'noun',
    exclude_nouns: query.excludeNouns,
    radius: query.radius,
    max_per_group: BRAN_CLEARANCE_MAX_PER_NOUN,
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

function formatResponse(response: SpatialComputeResultEnvelope): string {
  return JSON.stringify(response, null, 2);
}

export function createSpatialComputeStore() {
  const viewerContext = useViewerContext();
  const selection = useSelectionStore();
  const panelMode = ref<'query' | 'compute'>('compute');
  const activeScenario = ref<SpatialComputeScenarioKey>('fittingOffset');
  const scenarioExpanded = ref(false);
  const requestTokens: Record<string, number> = {};
  let nextRequestToken = 0;
  // 数据源随页面加载定死（`?model_source=` / `VITE_MODEL_SOURCE`），建 store 时读一次即可；面板上显示的路径与实际请求同源。
  const sourceKind = getModelSourceKind();
  const scenarios = reactive<Record<SpatialComputeScenarioKey, SpatialComputeScenarioState>>({
    fittingOffset: createScenarioState('fittingOffset'),
    fitting: createScenarioState('fitting'),
    wallDistance: createScenarioState('wallDistance'),
    steelRelative: createScenarioState('steelRelative'),
    suppoTrays: createScenarioState('suppoTrays'),
    traySpan: createScenarioState('traySpan'),
    branNearestClearance: createScenarioState('branNearestClearance'),
  });

  const scenarioList: SpatialComputeScenarioMeta[] = SCENARIO_META.map((meta) =>
    meta.key === 'branNearestClearance' ? { ...meta, endpoint: BRAN_NEAREST_CLEARANCE_ENDPOINT[sourceKind] } : meta,
  );
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
      currentScenarioState.value.error = activeScenario.value === 'branNearestClearance'
        ? '请先在三维里选中一个 BRAN'
        : '请先在三维里选中一个支架';
      return;
    }
    currentScenarioState.value.suppoRefno = activeScenario.value === 'branNearestClearance'
      ? normalizeBranComputeRefno(selectedRefno)
      : normalizeSuppoRefno(selectedRefno);
    currentScenarioState.value.error = '';
  }

  async function submitScenario(key: SpatialComputeScenarioKey = activeScenario.value) {
    const state = scenarios[key];
    const refno = key === 'branNearestClearance'
      ? normalizeBranComputeRefno(state.suppoRefno)
      : normalizeSuppoRefno(state.suppoRefno);
    if (!refno) {
      state.error = key === 'branNearestClearance' ? '请输入完整 BRAN refno' : '请输入完整 suppo_refno';
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
      let response: SpatialComputeResultEnvelope;
      switch (key) {
        case 'fitting':
          response = await postSpaceFitting({
            suppo_refno: refno,
            tolerance: parseOptionalNumber(state.tolerance, 'tolerance'),
          });
          break;
        case 'fittingOffset':
          response = await postSpaceFittingOffset({
            suppo_refno: refno,
            tolerance: parseOptionalNumber(state.tolerance, 'tolerance'),
          });
          break;
        case 'wallDistance': {
          const targetNouns = state.targetNouns
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          response = await postSpaceWallDistance({
            suppo_refno: refno,
            search_radius: parseOptionalNumber(state.searchRadius, 'search_radius'),
            target_nouns: targetNouns.length > 0 ? targetNouns : undefined,
          });
          break;
        }
        case 'steelRelative':
          response = await postSpaceSteelRelative({
            suppo_refno: refno,
            search_radius: parseOptionalNumber(state.searchRadius, 'search_radius'),
          });
          break;
        case 'suppoTrays':
          response = await postSpaceSuppoTrays({
            suppo_refno: refno,
            tolerance: parseOptionalNumber(state.tolerance, 'tolerance'),
          });
          break;
        case 'traySpan':
          response = await postSpaceTraySpan({
            suppo_refno: refno,
            neighbor_window: parseOptionalNumber(state.neighborWindow, 'neighbor_window'),
          });
          break;
        case 'branNearestClearance': {
          const branResponse = await fetchBranNearestClearance(sourceKind, {
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
          return;
        }
      }
      if (requestTokens[key] !== token) return;
      state.responseText = formatResponse(response);
      state.resultRows = extractResultRows(key, response);
      state.annotationCandidates = [];
      if (response.status === 'error') {
        state.error = response.message || '请求失败';
      }
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
    const key = branCandidateKey(candidate.noun, candidate.refno);

    let group = state.branGroups.find((item) => item.group === candidate.noun);
    if (!group) {
      group = { group: candidate.noun, nouns: [candidate.noun], candidates: [] };
      state.branGroups.push(group);
    }
    const existingIndex = group.candidates.findIndex((item) => item.refno === candidate.refno);
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
