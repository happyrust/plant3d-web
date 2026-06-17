import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpatialComputeStore, normalizeBranComputeRefno, resetSpatialComputeStore } from './useSpatialCompute';

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: { value: null },
  }),
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: { value: '' },
  }),
}));

describe('useSpatialCompute BRAN nearest clearance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetSpatialComputeStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSpatialComputeStore();
  });

  it('exposes BRAN scenario with BRAN labels and defaults', () => {
    const store = createSpatialComputeStore();
    store.setActiveScenario('branNearestClearance');

    expect(store.currentScenarioMeta.value.title).toContain('BRAN');
    expect(store.currentScenarioMeta.value.sourceLabel).toBe('BRAN Refno');
    expect(store.currentScenarioMeta.value.sourceHelp).not.toContain('SUPPO');
    expect(store.currentScenarioState.value.targetNouns).toBe('wall,column');
    expect(store.currentScenarioState.value.searchRadius).toBe('5000');
  });

  it('submits BRAN nearest-clearance params and flattens nearest_by_group rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        nearest_by_group: [
          {
            group: 'wall',
            nouns: ['WALL', 'PANE', 'GWALL', 'STWALL'],
            candidates: [{
              refno: '24381_1',
              noun: 'WALL',
              distance_mm: 1200.4,
              nearest: {
                source_segment_refno: '24381_145019',
                source_segment_order: 3,
                source_point: { x: 1, y: 2, z: 3 },
                target_point: { x: 4, y: 5, z: 6 },
                vector: { dx: 3, dy: 3, dz: 3 },
              },
              annotation: {
                start_point: { x: 1, y: 2, z: 3 },
                end_point: { x: 4, y: 5, z: 6 },
                label_mm: 1200.4,
              },
            }],
          },
          {
            group: 'column',
            nouns: ['COLU', 'SCTN', 'GENSEC'],
            candidates: [{
              refno: '24381_2',
              noun: 'COLU',
              distance_mm: 0,
              nearest: {
                source_segment_refno: '24381_145020',
                source_segment_order: 4,
                source_point: { x: 7, y: 8, z: 9 },
                target_point: { x: 7, y: 8, z: 9 },
                vector: { dx: 0, dy: 0, dz: 0 },
              },
              annotation: {
                start_point: { x: 7, y: 8, z: 9 },
                end_point: { x: 7, y: 8, z: 9 },
                label_mm: 0,
              },
            }],
          },
        ],
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;
    state.suppoRefno = 'pe:<24381/145018>';

    await store.submitScenario('branNearestClearance');

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/sqlite-spatial/nearest-clearance');
    expect(url.searchParams.get('source_mode')).toBe('bran_centerline');
    expect(url.searchParams.get('source_refno')).toBe('24381_145018');
    expect(url.searchParams.get('target_groups')).toBe('wall,column');
    expect(url.searchParams.get('radius')).toBe('5000');
    expect(url.searchParams.get('scope')).toBe('same_dbnum');
    expect(state.error).toBe('');
    expect(state.resultRows).toEqual([
      expect.objectContaining({
        refno: '24381_1',
        noun: 'WALL',
        targetGroup: 'wall',
        distanceMm: 1200.4,
        sourceSegmentRefno: '24381_145019',
        sourceSegmentOrder: 3,
      }),
      expect.objectContaining({
        refno: '24381_2',
        noun: 'COLU',
        targetGroup: 'column',
        distanceMm: 0,
        sourceSegmentRefno: '24381_145020',
        sourceSegmentOrder: 4,
      }),
    ]);
    expect(state.annotationCandidates).toHaveLength(2);
    expect(state.annotationCandidates[0]?.candidate.annotation?.label_mm).toBe(1200.4);
  });

  it('also supports legacy object-shaped nearest_by_group responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        nearest_by_group: {
          wall: [{
            refno: '24381_3',
            noun: 'STWALL',
            distance_mm: 99,
          }],
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();

    await store.submitScenario('branNearestClearance');

    const state = store.scenarios.branNearestClearance;
    expect(state.resultRows).toEqual([
      expect.objectContaining({
        refno: '24381_3',
        noun: 'STWALL',
        targetGroup: 'wall',
        distanceMm: 99,
      }),
    ]);
    expect(state.annotationCandidates[0]?.targetGroup).toBe('wall');
  });

  it('parses success false as nearest-clearance error and clears stale payloads', async () => {
    const responses = [
      { success: true, nearest_by_group: { wall: [{ refno: 'old', noun: 'WALL', distance_mm: 1 }] } },
      { success: false, error: 'missing BRAN centerline data' },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[0]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[1]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;

    await store.submitScenario('branNearestClearance');
    expect(state.resultRows).toHaveLength(1);
    expect(state.annotationCandidates).toHaveLength(1);

    await store.submitScenario('branNearestClearance');
    expect(state.error).toBe('missing BRAN centerline data');
    expect(state.resultRows).toEqual([]);
    expect(state.annotationCandidates).toEqual([]);
  });

  it('does not allow an older slower response to overwrite newer rows', async () => {
    let resolveA!: (value: Response) => void;
    let resolveB!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveA = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveB = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const store = createSpatialComputeStore();
    const state = store.scenarios.branNearestClearance;

    const requestA = store.submitScenario('branNearestClearance');
    const requestB = store.submitScenario('branNearestClearance');
    resolveB(new Response(JSON.stringify({
      success: true,
      nearest_by_group: { column: [{ refno: 'new', noun: 'COLU', distance_mm: 2 }] },
    }), { status: 200 }));
    await requestB;
    resolveA(new Response(JSON.stringify({
      success: true,
      nearest_by_group: { wall: [{ refno: 'old', noun: 'WALL', distance_mm: 1 }] },
    }), { status: 200 }));
    await requestA;

    expect(state.resultRows).toHaveLength(1);
    expect(state.resultRows[0]?.refno).toBe('new');
    expect(state.annotationCandidates[0]?.candidate.refno).toBe('new');
  });

  it('normalizes BRAN refno inputs for compute state', () => {
    expect(normalizeBranComputeRefno('24381_145018')).toBe('24381_145018');
    expect(normalizeBranComputeRefno('24381/145018')).toBe('24381_145018');
    expect(normalizeBranComputeRefno('<24381/145018>')).toBe('24381_145018');
    expect(normalizeBranComputeRefno('=24381,145018')).toBe('24381_145018');
  });
});
