import { computed, reactive, ref } from 'vue';

import {
  postSpaceFitting,
  postSpaceFittingOffset,
  postSpaceSteelRelative,
  postSpaceSuppoTrays,
  postSpaceTraySpan,
  postSpaceWallDistance,
  queryBranCenterlineNearestClearance,
  type BranNearestClearanceCandidate,
  type BranNearestClearanceResponse,
  type SpaceComputeFittingData,
  type SpaceComputeFittingOffsetData,
  type SpaceComputeSteelRelativeData,
  type SpaceComputeSuppoTrayData,
  type SpaceComputeTraySpanData,
  type SpaceComputeWallDistanceData,
  type SpaceEnvelope,
} from '@/api/genModelSpatialApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useViewerContext } from '@/composables/useViewerContext';

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
};

export type BranNearestClearanceAnnotationCandidate = {
  targetGroup: string;
  candidate: BranNearestClearanceCandidate;
  index: number;
};

type SpatialComputeScenarioState = {
  suppoRefno: string;
  tolerance: string;
  suppoType: string;
  searchRadius: string;
  targetNouns: string;
  neighborWindow: string;
  loading: boolean;
  error: string;
  responseText: string;
  resultRows: SpatialComputeResultRow[];
  annotationCandidates: BranNearestClearanceAnnotationCandidate[];
};

type SpatialComputeScenarioMeta = {
  key: SpatialComputeScenarioKey;
  title: string;
  description: string;
  endpoint: string;
  exampleRefno: string;
  sourceLabel: string;
  sourceHelp: string;
  fields: ('tolerance' | 'suppoType' | 'searchRadius' | 'targetNouns' | 'neighborWindow')[];
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
    description: '沿 BRAN 中心线查找墙、柱最近点并返回标注点对。',
    endpoint: '/api/sqlite-spatial/nearest-clearance',
    exampleRefno: '2013286704_476',
    sourceLabel: 'BRAN Refno',
    sourceHelp: 'BRAN 格式示例：2013286704_476 或 2013286704/476',
    fields: ['searchRadius', 'targetNouns'],
  },
];

const DEFAULT_STATE_BY_SCENARIO: Record<
  SpatialComputeScenarioKey,
  Omit<SpatialComputeScenarioState, 'loading' | 'error' | 'responseText' | 'resultRows' | 'annotationCandidates'>
> = {
  fittingOffset: {
    suppoRefno: '24383/88342',
    tolerance: '',
    suppoType: '',
    searchRadius: '',
    targetNouns: '',
    neighborWindow: '',
  },
  fitting: {
    suppoRefno: '24383/89904',
    tolerance: '',
    suppoType: '',
    searchRadius: '',
    targetNouns: '',
    neighborWindow: '',
  },
  wallDistance: {
    suppoRefno: '24383/88342',
    tolerance: '',
    suppoType: 'S2',
    searchRadius: '5000',
    targetNouns: '',
    neighborWindow: '',
  },
  steelRelative: {
    suppoRefno: '24383/89904',
    tolerance: '',
    suppoType: '',
    searchRadius: '8000',
    targetNouns: '',
    neighborWindow: '',
  },
  suppoTrays: {
    suppoRefno: '24383/89904',
    tolerance: '',
    suppoType: '',
    searchRadius: '',
    targetNouns: '',
    neighborWindow: '',
  },
  traySpan: {
    suppoRefno: '24383/87412',
    tolerance: '',
    suppoType: '',
    searchRadius: '',
    targetNouns: '',
    neighborWindow: '5000',
  },
  branNearestClearance: {
    suppoRefno: '2013286704_476',
    tolerance: '',
    suppoType: '',
    searchRadius: '5000',
    targetNouns: 'wall,column',
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
  };
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

function extractBranNearestRows(response: BranNearestClearanceResponse): SpatialComputeResultRow[] {
  if (!response.success) return [];
  return Object.entries(response.nearest_by_group ?? {}).flatMap(([targetGroup, candidates]) =>
    (candidates ?? []).map((candidate) => ({
      refno: candidate.refno,
      noun: candidate.noun,
      distanceMm: Number.isFinite(candidate.distance_mm) ? candidate.distance_mm : null,
      targetGroup,
      sourceSegmentRefno: candidate.nearest?.source_segment_refno ?? null,
      sourceSegmentOrder: candidate.nearest?.source_segment_order ?? null,
      label: [
        targetGroup,
        candidate.nearest?.source_segment_refno
          ? `segment ${candidate.nearest.source_segment_refno}${candidate.nearest.source_segment_order != null ? `#${candidate.nearest.source_segment_order}` : ''}`
          : '',
      ].filter(Boolean).join(' · '),
    })),
  );
}

function extractBranAnnotationCandidates(
  response: BranNearestClearanceResponse,
): BranNearestClearanceAnnotationCandidate[] {
  if (!response.success) return [];
  return Object.entries(response.nearest_by_group ?? {}).flatMap(([targetGroup, candidates]) =>
    (candidates ?? []).map((candidate, index) => ({ targetGroup, candidate, index })),
  );
}

function parseOptionalNumber(raw: string, fieldLabel: string): number | undefined {
  const text = raw.trim();
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
  const scenarios = reactive<Record<SpatialComputeScenarioKey, SpatialComputeScenarioState>>({
    fittingOffset: createScenarioState('fittingOffset'),
    fitting: createScenarioState('fitting'),
    wallDistance: createScenarioState('wallDistance'),
    steelRelative: createScenarioState('steelRelative'),
    suppoTrays: createScenarioState('suppoTrays'),
    traySpan: createScenarioState('traySpan'),
    branNearestClearance: createScenarioState('branNearestClearance'),
  });

  const scenarioList = SCENARIO_META;
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
      state.resultRows = [];
      state.annotationCandidates = [];
      return;
    }

    const token = ++nextRequestToken;
    requestTokens[key] = token;

    state.loading = true;
    state.error = '';
    state.responseText = '';
    state.resultRows = [];
    state.annotationCandidates = [];

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
          const targetGroups = state.targetNouns
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          const branResponse = await queryBranCenterlineNearestClearance({
            source_refno: refno,
            target_groups: targetGroups.length > 0 ? targetGroups : 'wall,column',
            radius: parseOptionalNumber(state.searchRadius, 'radius') ?? 5000,
            scope: 'same_dbnum',
          });
          if (requestTokens[key] !== token) return;
          state.responseText = JSON.stringify(branResponse, null, 2);
          state.resultRows = extractBranNearestRows(branResponse);
          state.annotationCandidates = extractBranAnnotationCandidates(branResponse);
          if (!branResponse.success) {
            state.error = branResponse.error || branResponse.message || '请求失败';
            state.resultRows = [];
            state.annotationCandidates = [];
          }
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
      state.resultRows = [];
      state.annotationCandidates = [];
    } finally {
      if (requestTokens[key] === token) {
        state.loading = false;
      }
    }
  }

  function toggleScenarioExpanded() {
    scenarioExpanded.value = !scenarioExpanded.value;
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
