import { describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';

import { MBD_FETCH_CONCURRENCY, createMbdExternalSync } from './useMbdExternalSync';

import type {
  MbdDiagnosticsSnapshot,
  MbdDiagnosticsStore,
} from './useMbdDiagnosticsStore';
import type { MbdExternalSyncDeps } from './useMbdExternalSync';
import type { MbdV2PipeData } from '@/dimension';

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

function contractPayload(
  overrides: Partial<MbdV2PipeData> = {},
): MbdV2PipeData {
  return {
    version: 'v2',
    input_refno: 'fixture',
    branch_refno: 'fixture',
    primitives: [{
      kind: 'linear_dim',
      id: 'dim-1',
      start: [0, 0, 0],
      end: [1, 0, 0],
      text: '1000',
      extension_lines: [
        { from: [0, 0, 0], to: [0, 0.1, 0] },
        { from: [1, 0, 0], to: [1, 0.1, 0] },
      ],
      arrow_lines: [
        { from: [0, 0, 0], to: [0.1, 0.05, 0] },
        { from: [1, 0, 0], to: [0.9, 0.05, 0] },
      ],
      label_anchor: [0.5, 0.1, 0],
    }],
    meta: {
      geometry_space: 'source_mm',
      source_to_design: IDENTITY,
      notes: [],
    },
    issues: [],
    ...overrides,
  };
}

function createDiagnostics(): MbdDiagnosticsStore {
  return {
    snapshot: shallowRef<MbdDiagnosticsSnapshot>({
      loadedAt: null,
      channel: null,
      sourceId: null,
      issues: [],
      skipped: [],
      layoutMode: null,
      notes: [],
      sourceVersion: null,
      isolines: [],
      loadError: null,
      sources: [],
    }),
    set: vi.fn(),
    clear: vi.fn(),
  };
}

function createHarness(input: {
  search: string;
  fetchPipeData?: MbdExternalSyncDeps['fetchPipeData'];
}) {
  const diagnostics = createDiagnostics();
  const emitToast = vi.fn();
  const fetchPipeData = input.fetchPipeData
    ?? vi.fn(async () => ({
      ok: true as const,
      data: contractPayload(),
      diagnostics: [],
    }));
  const sync = createMbdExternalSync({
    fetchPipeData,
    diagnostics,
    getSearch: () => input.search,
    emitToast,
  });
  const target = { replaceExternalSource: vi.fn() };
  return {
    sync,
    target,
    diagnostics,
    emitToast,
    fetchPipeData,
  };
}

describe('createMbdExternalSync', () => {
  it('uses the API channel when mbd_refno is present', async () => {
    const harness = createHarness({ search: '?mbd_refno=24381_145712' });

    await harness.sync.sync(harness.target);

    expect(harness.fetchPipeData).toHaveBeenCalledWith('24381_145712', { partial: false });
    expect(harness.target.replaceExternalSource).toHaveBeenCalledTimes(1);
    const [source, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(source).toBe('mbd');
    expect(records.map((record: { id: string }) => record.id)).toEqual(['dim-1']);
    expect(harness.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'api',
      sourceId: '24381_145712',
    }));
  });

  it('clears the source when only show_dbnum is present (parquet channel retired)', async () => {
    const harness = createHarness({ search: '?show_dbnum=250160' });

    await harness.sync.sync(harness.target);

    expect(harness.fetchPipeData).not.toHaveBeenCalled();
    expect(harness.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    expect(harness.diagnostics.clear).toHaveBeenCalledTimes(1);
  });

  it('clears the source and diagnostics when no channel params exist', async () => {
    const harness = createHarness({ search: '' });

    await harness.sync.sync(harness.target);

    expect(harness.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    expect(harness.diagnostics.clear).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics.set).not.toHaveBeenCalled();
  });

  it('discards stale results when a newer sync has started', async () => {
    let resolveFirst!: (value: Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>) => void;
    let resolveSecond!: (value: Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>) => void;
    const responses = [
      new Promise<Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>>((resolve) => {
        resolveFirst = resolve;
      }),
      new Promise<Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>>((resolve) => {
        resolveSecond = resolve;
      }),
    ];
    let call = 0;
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(() => responses[call++]!),
    });

    const first = harness.sync.sync(harness.target);
    const second = harness.sync.sync(harness.target);
    resolveSecond({
      ok: true,
      data: contractPayload({
        primitives: [{
          kind: 'linear_dim',
          id: 'dim-latest',
          start: [0, 0, 0],
          end: [2, 0, 0],
          text: '2000',
          extension_lines: [
            { from: [0, 0, 0], to: [0, 0.1, 0] },
            { from: [2, 0, 0], to: [2, 0.1, 0] },
          ],
          arrow_lines: [
            { from: [0, 0, 0], to: [0.1, 0.05, 0] },
            { from: [2, 0, 0], to: [1.9, 0.05, 0] },
          ],
          label_anchor: [1, 0.1, 0],
        }],
      }),
      diagnostics: [],
    });
    await second;
    resolveFirst({ ok: true, data: contractPayload(), diagnostics: [] });
    await first;

    expect(harness.target.replaceExternalSource).toHaveBeenCalledTimes(1);
    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records.map((record: { id: string }) => record.id)).toEqual(['dim-latest']);
  });

  it('records channel failures in diagnostics instead of clearing them', async () => {
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => {
        throw new Error('MBD V2 API responded with status 404');
      }),
    });

    await harness.sync.sync(harness.target);

    expect(harness.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    expect(harness.diagnostics.clear).not.toHaveBeenCalled();
    expect(harness.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'api',
      sourceId: 'A',
      loadError: 'MBD V2 API responded with status 404',
    }));
  });

  it('drops results after invalidate() and honours host cancellation', async () => {
    const harness = createHarness({ search: '?mbd_refno=A' });

    const pending = harness.sync.sync(harness.target);
    harness.sync.invalidate();
    await pending;
    expect(harness.target.replaceExternalSource).not.toHaveBeenCalled();

    await harness.sync.sync(harness.target, { isCancelled: () => true });
    expect(harness.target.replaceExternalSource).not.toHaveBeenCalled();
  });

  /**
   * 2026-11-02 多 BRAN 语义变更：原子拒绝从「掀翻全局」改成「逐包生效」。
   * 单 refno 时唯一一包被拒，可观察结果仍是整屏清空 + `['mbd', []]`，
   * 所以本用例不用改断言；跨包互不清场的语义见下方新增用例。
   */
  it('rejects an API payload atomically when any primitive fails to map', async () => {
    const goodPayload = contractPayload();
    const duplicated = contractPayload({
      primitives: [goodPayload.primitives[0]!, goodPayload.primitives[0]!],
      issues: [{
        id: 'issue-1',
        severity: 'warning' as const,
        category: 'split' as const,
        message: 'upstream warning kept for diagnostics',
      }],
    });
    const responses = [
      { ok: true as const, data: goodPayload, diagnostics: [] },
      { ok: true as const, data: duplicated, diagnostics: [] },
    ];
    let call = 0;
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => responses[call++]!),
    });

    await harness.sync.sync(harness.target);
    await harness.sync.sync(harness.target);

    const replaceCalls = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls;
    expect(replaceCalls).toHaveLength(2);
    expect(replaceCalls[0]![1].map((record: { id: string }) => record.id))
      .toEqual(['dim-1']);
    expect(replaceCalls[1]!).toEqual(['mbd', []]);

    const lastDiagnostics = (harness.diagnostics.set as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)![0];
    expect(lastDiagnostics.loadError).toContain('整包拒绝');
    expect(lastDiagnostics.loadError).toContain('dim-1');
    expect(lastDiagnostics.skipped).toEqual([{
      id: 'dim-1',
      reason: 'Duplicate primitive id within MBD payload',
    }]);
    expect(lastDiagnostics.issues).toEqual(duplicated.issues);
  });

  it('mbd_kinds keeps only the listed kinds and records the filter in diagnostics', async () => {
    const payload = contractPayload({
      primitives: [
        contractPayload().primitives[0]!,
        { kind: 'label', id: 'tag-1', text: 'PIPE-1', position: [0.5, 0.2, 0] },
      ],
    });
    const harness = createHarness({
      search: '?mbd_refno=A&mbd_kinds=linear_dim',
      fetchPipeData: vi.fn(async () => ({ ok: true as const, data: payload, diagnostics: [] })),
    });

    await harness.sync.sync(harness.target);

    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records.map((record: { id: string }) => record.id)).toEqual(['dim-1']);
    expect(harness.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      notes: [expect.stringContaining('mbd_kinds=linear_dim')],
    }));
  });

  it('mbd_lod=0 strips the level-of-detail hints and says so in diagnostics', async () => {
    const withLod = createHarness({ search: '?mbd_refno=A' });
    await withLod.sync.sync(withLod.target);
    const [, kept] = (withLod.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(kept[0].layout.lod).toEqual({ tier: 'primary', hideShort: true });

    const disabled = createHarness({ search: '?mbd_refno=A&mbd_lod=0' });
    await disabled.sync.sync(disabled.target);
    const [, stripped] = (disabled.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(stripped.map((record: { id: string }) => record.id)).toEqual(['dim-1']);
    expect(stripped[0].layout.lod).toBeUndefined();
    expect(stripped[0].layout.labelAnchor).toEqual(kept[0].layout.labelAnchor);
    expect(disabled.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      notes: [expect.stringContaining('mbd_lod=0')],
    }));
  });

  it('mbd_label=above opts into the above-the-line text and stays off by default', async () => {
    const payload = contractPayload({
      meta: { geometry_space: 'source_mm', source_to_design: IDENTITY, notes: [], cheight_mm: 27 },
    });
    const fetchPipeData = vi.fn(async () => ({ ok: true as const, data: payload, diagnostics: [] }));

    // Default: the field is absent, which is what keeps every existing
    // payload's pixels identical. Not `'interrupted'` — absent.
    const byDefault = createHarness({ search: '?mbd_refno=A', fetchPipeData });
    await byDefault.sync.sync(byDefault.target);
    const [, plain] = (byDefault.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(plain[0].layout.labelPresentation).toBeUndefined();
    expect(byDefault.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      notes: expect.not.arrayContaining([expect.stringContaining('mbd_label')]),
    }));

    // Opt-in: the mode reaches the layout verbatim, and says so.
    const above = createHarness({ search: '?mbd_refno=A&mbd_label=above', fetchPipeData });
    await above.sync.sync(above.target);
    const [, opted] = (above.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(opted[0].layout.labelPresentation).toBe('above');
    // Only that one field moves; geometry and LOD hints are untouched.
    expect(opted[0].layout.lines).toEqual(plain[0].layout.lines);
    expect(opted[0].layout.lod).toEqual(plain[0].layout.lod);
    expect(opted[0].layout.labelAnchor).toEqual(plain[0].layout.labelAnchor);
    expect(above.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      notes: [expect.stringContaining('mbd_label=above')],
    }));

    // Any other value is not the mode — `interrupted` stays the default.
    const bogus = createHarness({ search: '?mbd_refno=A&mbd_label=interrupted', fetchPipeData });
    await bogus.sync.sync(bogus.target);
    const [, other] = (bogus.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(other[0].layout.labelPresentation).toBeUndefined();
  });

  it('mbd_3d=0 strips the 3D presentation and falls back to the solver geometry', async () => {
    // The mapper only presents in 3D when the group declares a cheight.
    const payload = contractPayload({
      meta: { geometry_space: 'source_mm', source_to_design: IDENTITY, notes: [], cheight_mm: 27 },
    });
    const fetchPipeData = vi.fn(async () => ({ ok: true as const, data: payload, diagnostics: [] }));

    const enabled = createHarness({ search: '?mbd_refno=A', fetchPipeData });
    await enabled.sync.sync(enabled.target);
    const [, kept] = (enabled.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(kept[0].layout.dimension3d).toMatchObject({ from: [0, 0, 0], to: [1, 0, 0], row: 0 });

    const disabled = createHarness({ search: '?mbd_refno=A&mbd_3d=0', fetchPipeData });
    await disabled.sync.sync(disabled.target);
    const [, stripped] = (disabled.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(stripped.map((record: { id: string }) => record.id)).toEqual(['dim-1']);
    expect(stripped[0].layout.dimension3d).toBeUndefined();
    // Everything else (solver lines, LOD hints, cheight) is untouched.
    expect(stripped[0].layout.lines).toEqual(kept[0].layout.lines);
    expect(stripped[0].layout.lod).toEqual(kept[0].layout.lod);
    expect(stripped[0].layout.textHeightM).toEqual(kept[0].layout.textHeightM);
    expect(disabled.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      notes: [expect.stringContaining('mbd_3d=0')],
    }));
  });

  it('mbd_3d=0 strips label3d: an angle with a text plane goes flat into its plane (CT-15)', async () => {
    const payload = contractPayload({
      primitives: [{
        kind: 'angle_dim',
        id: 'angle-1',
        text: '30°',
        center: [0, 0, 0],
        x_axis: [1, 0, 0],
        normal: [0, 0, 1],
        radius: 1,
        start_angle_deg: 0,
        sweep_angle_deg: 90,
        leg_lines: [],
        label_anchor: [0.7, 0.7, 0],
        text_dir: [1, 0, 0],
        text_up: [0, 1, 0],
      }],
    });
    const fetchPipeData = vi.fn(async () => ({ ok: true as const, data: payload, diagnostics: [] }));
    const committed = async (search: string) => {
      const harness = createHarness({ search, fetchPipeData });
      await harness.sync.sync(harness.target);
      const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
        .mock.calls[0]!;
      return records;
    };

    // Default: the 3D run along the arc rides along with the flat label.
    const kept = await committed('?mbd_refno=A');
    expect(kept[0].layout.label3d.text).toBe('30°');
    expect(kept[0].layout.label3d.along[0]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(kept[0].layout.label3d.along[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(kept[0].layout.labelAlong).toEqual([1, 0, 0]);

    const flat = await committed('?mbd_refno=A&mbd_3d=0');
    expect(flat[0].layout).not.toHaveProperty('label3d');
    const { label3d: _label3d, ...flatPart } = kept[0].layout;
    expect(flat[0].layout).toEqual(flatPart);
  });

  it('mbd_polar=1 is retired: records match the switch-off ones in both presentations, only a note is added', async () => {
    // Same isoline on a linear_dim and a label, plus the isoline's od_mm:
    // every fact the retired front-end polar layer used to read.
    const payload = contractPayload({
      primitives: [
        {
          kind: 'linear_dim',
          id: 'dim-1',
          start: [0, 0, 0],
          end: [1, 0, 0],
          text: '1000',
          extension_lines: [
            { from: [0, 0, 0], to: [0, 0.1, 0] },
            { from: [1, 0, 0], to: [1, 0.1, 0] },
          ],
          arrow_lines: [],
          label_anchor: [0.5, 0.1, 0],
          isoline_idx: 0,
        },
        {
          kind: 'label',
          id: 'tag-1',
          text: 'X 1',
          position: [0.5, 0, 0],
          isoline_idx: 0,
        },
      ],
      meta: {
        geometry_space: 'source_mm',
        source_to_design: IDENTITY,
        notes: [],
        isolines: [{ index: 0, members: ['m'], cheight_mm: 13.5, od_mm: 0.5 }],
      },
    });
    const fetchPipeData = vi.fn(async () => ({ ok: true as const, data: payload, diagnostics: [] }));
    const run = async (search: string) => {
      const harness = createHarness({ search, fetchPipeData });
      await harness.sync.sync(harness.target);
      const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
        .mock.calls[0]!;
      return { records, diagnostics: harness.diagnostics };
    };

    const byDefault = await run('?mbd_refno=A');
    for (const record of byDefault.records) {
      expect(record.layout).not.toHaveProperty('polar');
      expect(record.layout).not.toHaveProperty('polarObstacle');
    }

    // 3D presentation: the label keeps its billboard `tag`.
    const in3d = await run('?mbd_refno=A&mbd_polar=1');
    expect(in3d.records).toEqual(byDefault.records);
    expect(in3d.records.find((record: { id: string }) => record.id === 'tag-1').layout.tag).toBeDefined();
    expect(in3d.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      notes: [expect.stringContaining('mbd_polar=1 已退役')],
    }));

    // The flat presentation the retired layer used to act on.
    const flat = await run('?mbd_refno=A&mbd_3d=0');
    const flatPolar = await run('?mbd_refno=A&mbd_3d=0&mbd_polar=1');
    expect(flatPolar.records).toEqual(flat.records);
    expect(flatPolar.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      notes: expect.arrayContaining([expect.stringContaining('mbd_polar=1 已退役')]),
    }));

    // Any other value is not the switch: no note either.
    const bogus = await run('?mbd_refno=A&mbd_polar=0');
    expect(bogus.records).toEqual(byDefault.records);
    expect(bogus.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({ notes: [] }));
  });

  /**
   * W3-2 / W3-6 消费侧：`meta.source_version`（数据时点）与 `meta.isolines`（直段表）
   * 原样进诊断 store，面板据此显示 dbnum@sesno、按直段分组；缺省时分别是 null / []。
   */
  it('passes meta.source_version and meta.isolines through to diagnostics', async () => {
    const version = {
      dbnum: 24381,
      sesno: 145,
      databases: [{ dbnum: 24381, sesno: 145, db_type: 'DESI' }],
    };
    const isolines = [{ index: 0, members: ['24381_145018'], cheight_mm: 25, od_mm: 114.3 }];
    const declared = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => ({
        ok: true as const,
        data: contractPayload({
          meta: {
            geometry_space: 'source_mm',
            source_to_design: IDENTITY,
            notes: [],
            source_version: version,
            isolines,
            coverage: ['linear_dim', 'label'],
          },
        }),
        diagnostics: [],
      })),
    });
    await declared.sync.sync(declared.target);
    expect(declared.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersion: version,
      isolines,
      sources: [expect.objectContaining({ refno: 'A', coverage: ['linear_dim', 'label'] })],
    }));

    const bare = createHarness({ search: '?mbd_refno=A' });
    await bare.sync.sync(bare.target);
    expect(bare.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersion: null,
      isolines: [],
      sources: [expect.objectContaining({ refno: 'A', coverage: null })],
    }));
  });

  // 2026-11-02 起原子拒绝按包生效：单 refno 时唯一一包被拒仍走整屏清空分支。
  it('mbd_kinds does not bypass atomic rejection of a broken payload', async () => {
    const good = contractPayload().primitives[0]!;
    const harness = createHarness({
      search: '?mbd_refno=A&mbd_kinds=label',
      fetchPipeData: vi.fn(async () => ({
        ok: true as const,
        data: contractPayload({ primitives: [good, good] }),
        diagnostics: [],
      })),
    });

    await harness.sync.sync(harness.target);

    expect(harness.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    const diagnostics = (harness.diagnostics.set as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)![0];
    expect(diagnostics.loadError).toContain('整包拒绝');
  });

  it('emits one error toast when backend issues contain error severity', async () => {
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => ({
        ok: true as const,
        data: contractPayload({
          issues: [
            {
              id: 'issue-1',
              severity: 'error' as const,
              category: 'data' as const,
              message: 'missing tubi geometry',
            },
            {
              id: 'issue-2',
              severity: 'warning' as const,
              category: 'avoidance' as const,
              message: 'lane overflow',
            },
          ],
        }),
        diagnostics: [],
      })),
    });

    await harness.sync.sync(harness.target);

    expect(harness.emitToast).toHaveBeenCalledTimes(1);
    expect(harness.emitToast).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
    }));
  });

  it('surfaces a failed sync as one error toast and dedupes repeats of the same refno', async () => {
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => {
        throw new Error('MBD V2 API responded with status 422');
      }),
    });

    await harness.sync.sync(harness.target);
    await harness.sync.sync(harness.target);
    await harness.sync.sync(harness.target);

    expect(harness.emitToast).toHaveBeenCalledTimes(1);
    expect(harness.emitToast).toHaveBeenCalledWith({
      message: 'MBD 标注装载失败：MBD V2 API responded with status 422',
      level: 'error',
    });
    // 去重只作用于弹窗：诊断每次都要照旧写入。
    expect(harness.diagnostics.set).toHaveBeenCalledTimes(3);
  });

  /**
   * A5（2026-10-29）：原子拒绝只留给「映射失败」。契约层的逐条诊断（A3 起是
   * 还不认识的图元 kind）不该让整条分支变空白——它们进 diagnostics.skipped
   * 与 notes，其余图元照常提交，也不弹错误 toast。
   */
  it('submits the rest when only the contract layer skipped units', async () => {
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => ({
        ok: true as const,
        data: contractPayload(),
        diagnostics: [{ id: 'future-1', reason: '还不认识的图元 kind：future_dim' }],
      })),
    });

    await harness.sync.sync(harness.target);

    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)!;
    expect(records.map((record: { id: string }) => record.id)).toEqual(['dim-1']);
    const diagnostics = (harness.diagnostics.set as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)![0];
    expect(diagnostics.loadError).toBeUndefined();
    expect(diagnostics.skipped).toEqual([
      { id: 'future-1', reason: '还不认识的图元 kind：future_dim' },
    ]);
    expect(diagnostics.notes).toEqual([expect.stringContaining('契约层跳过 1 个图元')]);
    expect(harness.emitToast).not.toHaveBeenCalled();
  });

  it('keeps the atomic rejection by default and submits everything with ?mbd_partial=1', async () => {
    const good = contractPayload().primitives[0]!;
    const broken = contractPayload({ primitives: [good, good] });
    const fetchPipeData = vi.fn(async () => ({
      ok: true as const,
      data: broken,
      diagnostics: [],
    }));

    // 缺省：一坏就整包不提交（ADR 0046）。
    const strict = createHarness({ search: '?mbd_refno=A', fetchPipeData });
    await strict.sync.sync(strict.target);
    expect(strict.target.replaceExternalSource).toHaveBeenLastCalledWith('mbd', []);
    expect((strict.diagnostics.set as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].loadError)
      .toContain('整包拒绝');

    // mbd_partial=1：可映射的那条照常提交，跳过的进诊断与 notes，且不算装载失败。
    const partial = createHarness({ search: '?mbd_refno=A&mbd_partial=1', fetchPipeData });
    await partial.sync.sync(partial.target);
    const [, records] = (partial.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)!;
    expect(records.map((record: { id: string }) => record.id)).toEqual(['dim-1']);
    const diagnostics = (partial.diagnostics.set as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)![0];
    // 成功路径不写 loadError（测试桩的 set 不做缺省填充，故是 undefined）。
    expect(diagnostics.loadError).toBeUndefined();
    expect(diagnostics.skipped).toEqual([{
      id: 'dim-1',
      reason: 'Duplicate primitive id within MBD payload',
    }]);
    expect(diagnostics.notes).toEqual([expect.stringContaining('mbd_partial=1')]);
    // 部分显示不是失败，不该弹错误提示。
    expect(partial.emitToast).not.toHaveBeenCalled();
    // 部分显示必须一路传到契约解析层，否则「不认识的 kind」在解析阶段就已整包失败。
    expect(partial.fetchPipeData).toHaveBeenCalledWith('A', { partial: true });
  });

  it('re-arms the failure toast after a successful sync', async () => {
    let fail = true;
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => {
        if (fail) throw new Error('boom');
        return { ok: true as const, data: contractPayload(), diagnostics: [] };
      }),
    });

    await harness.sync.sync(harness.target);
    expect(harness.emitToast).toHaveBeenCalledTimes(1);

    fail = false;
    await harness.sync.sync(harness.target);
    expect(harness.emitToast).toHaveBeenCalledTimes(1);

    fail = true;
    await harness.sync.sync(harness.target);
    expect(harness.emitToast).toHaveBeenCalledTimes(2);
  });

  /**
   * 2026-11-02 多 BRAN：`mbd_refno=A,B` 逐包取数、合并成**一次**
   * `replaceExternalSource`（整槽覆盖，逐包提交会互相顶掉）。两包图元
   * 同叫 `dim-1`：各包 id 编号空间独立，多包时按 `refno:` 前缀区分，
   * 否则 registry 的重复 id 校验会直接抛。
   */
  it('merges multiple refnos into a single replaceExternalSource call', async () => {
    const fetchPipeData = vi.fn(async (refno: string) => ({
      ok: true as const,
      data: contractPayload({ input_refno: refno, branch_refno: refno }),
      diagnostics: [],
    }));
    const harness = createHarness({ search: '?mbd_refno=A,B', fetchPipeData });

    await harness.sync.sync(harness.target);

    expect(fetchPipeData).toHaveBeenCalledWith('A', { partial: false });
    expect(fetchPipeData).toHaveBeenCalledWith('B', { partial: false });
    expect(harness.target.replaceExternalSource).toHaveBeenCalledTimes(1);
    const [source, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(source).toBe('mbd');
    expect(records.map((record: { id: string }) => record.id))
      .toEqual(['A:dim-1', 'B:dim-1']);
    expect(harness.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'api',
      sourceId: 'A,B',
    }));
  });

  /**
   * 真实后端的图元 id 本身已带 refno 前缀（`24381_145018:isoline:0:...`，见
   * `src/fixtures/mbd-v2/live-isodim-24381-145018.json`），跨 BRAN 天然不冲突。
   * 加前缀必须幂等：已带该 refno 的 id 原样保留，否则会得到
   * `24381_145018:24381_145018:isoline:...`，面板与 `sourceLabel` 里全是重复噪声。
   */
  it('does not double-prefix ids that already carry the refno', async () => {
    const fetchPipeData = vi.fn(async (refno: string) => ({
      ok: true as const,
      data: contractPayload({
        input_refno: refno,
        branch_refno: refno,
        primitives: [{
          ...contractPayload().primitives[0]!,
          id: `${refno}:isoline:0:main:Head--${refno}`,
        }],
      }),
      diagnostics: [],
    }));
    const harness = createHarness({ search: '?mbd_refno=A,B', fetchPipeData });

    await harness.sync.sync(harness.target);

    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records.map((record: { id: string }) => record.id))
      .toEqual(['A:isoline:0:main:Head--A', 'B:isoline:0:main:Head--B']);
    expect(records[0].sourceLabel).toBe('MBD: A:isoline:0:main:Head--A');
  });

  /**
   * 去重分组键在每包里各自编号（安装角度 `ang-1` 与它的方向小字同组），
   * 多包时要和 id 一起加前缀，否则两个 BRAN 的同名组会被当成一组同进同退。
   */
  it('prefixes declutter groups per refno', async () => {
    const fetchPipeData = vi.fn(async (refno: string) => ({
      ok: true as const,
      data: contractPayload({
        input_refno: refno,
        branch_refno: refno,
        primitives: [
          { kind: 'aid_text', id: 'ang-1:dirtext1', text: '-X', position: [0, 0, 0] },
        ],
      }),
      diagnostics: [],
    }));
    const harness = createHarness({ search: '?mbd_refno=A,B', fetchPipeData });

    await harness.sync.sync(harness.target);

    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    const layoutOf = (id: string) => records.find((record: { id: string }) => record.id === id).layout;
    for (const refno of ['A', 'B']) {
      expect(layoutOf(`${refno}:ang-1:dirtext1`).declutter).toEqual({ rank: 500, group: `${refno}:ang-1` });
    }
  });

  /**
   * 2026-11-02 逐包拒绝：A 包映射失败（重复图元 id）只剔除 A 自己，
   * B 包照常提交；失败原因进逐源诊断与聚合 loadError，并按 refno 弹提示。
   */
  it('rejects only the broken package and still submits the healthy ones', async () => {
    const good = contractPayload().primitives[0]!;
    const fetchPipeData = vi.fn(async (refno: string) => ({
      ok: true as const,
      data: contractPayload({
        input_refno: refno,
        branch_refno: refno,
        primitives: refno === 'A' ? [good, good] : [{ ...good, id: 'dim-b' }],
      }),
      diagnostics: [],
    }));
    const harness = createHarness({ search: '?mbd_refno=A,B', fetchPipeData });

    await harness.sync.sync(harness.target);

    expect(harness.target.replaceExternalSource).toHaveBeenCalledTimes(1);
    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records.map((record: { id: string }) => record.id)).toEqual(['B:dim-b']);

    const diagnostics = (harness.diagnostics.set as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)![0];
    expect(diagnostics.sourceId).toBe('A,B');
    expect(diagnostics.loadError).toContain('整包拒绝');
    expect(diagnostics.loadError).toContain('A');
    expect(diagnostics.skipped).toEqual([{
      id: 'dim-1',
      reason: 'Duplicate primitive id within MBD payload',
    }]);
    expect(diagnostics.sources).toHaveLength(2);
    expect(diagnostics.sources[0]).toEqual(expect.objectContaining({
      refno: 'A',
      loadError: expect.stringContaining('整包拒绝'),
    }));
    expect(diagnostics.sources[1]).toEqual(expect.objectContaining({
      refno: 'B',
      loadError: null,
    }));
    expect(harness.emitToast).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('整包拒绝'),
    }));
  });

  /**
   * 2026-11-02 并发上限：refno 多于 {@link MBD_FETCH_CONCURRENCY} 时先起
   * CONCURRENCY 个取数，有完成的才补位，不会一次性全部并发出去。
   */
  it('caps concurrent fetches at MBD_FETCH_CONCURRENCY', async () => {
    type FetchResult = Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>;
    const deferreds: { resolve: (value: FetchResult) => void }[] = [];
    const fetchPipeData = vi.fn(
      () => new Promise<FetchResult>((resolve) => {
        deferreds.push({ resolve });
      }),
    );
    const refnoCount = MBD_FETCH_CONCURRENCY + 2;
    const refnos = Array.from({ length: refnoCount }, (_, index) => `R${index}`);
    const harness = createHarness({
      search: `?mbd_refno=${refnos.join(',')}`,
      fetchPipeData,
    });

    const pending = harness.sync.sync(harness.target);
    // worker 池同步起第一批：正好 CONCURRENCY 个在途，多一个都不发。
    expect(fetchPipeData).toHaveBeenCalledTimes(MBD_FETCH_CONCURRENCY);

    deferreds[0]!.resolve({ ok: true, data: contractPayload(), diagnostics: [] });
    await vi.waitFor(() => {
      expect(fetchPipeData).toHaveBeenCalledTimes(MBD_FETCH_CONCURRENCY + 1);
    });

    // 逐个放行剩下的包，每轮都要等新的 deferred 出现。不能写成 `for (const d of
    // deferreds) d.resolve(...)`：resolve 只是排微任务，worker 补位要等这个同步
    // 循环退出后才发生，于是循环遍历的是「补齐之前」那份快照，末尾几个包永远不
    // 启动，`await pending` 挂死（超时 20s）。
    let resolved = 1;
    while (resolved < refnoCount) {
      await vi.waitFor(() => {
        expect(deferreds.length).toBeGreaterThan(resolved);
      });
      deferreds[resolved]!.resolve({ ok: true, data: contractPayload(), diagnostics: [] });
      resolved += 1;
    }
    await pending;
    expect(fetchPipeData).toHaveBeenCalledTimes(refnoCount);
    // 多包同 id（各包都叫 dim-1）靠 refno 前缀区分，合并不抛错。
    expect(harness.target.replaceExternalSource).toHaveBeenCalledTimes(1);
    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records).toHaveLength(refnoCount);
  });

  /** `mbd_refno` 值全空（解析成 `[]`）与参数缺失同路：整槽清空 + 清诊断。 */
  it('clears the source when mbd_refno parses to an empty list', async () => {
    const harness = createHarness({ search: '?mbd_refno=,,' });

    await harness.sync.sync(harness.target);

    expect(harness.fetchPipeData).not.toHaveBeenCalled();
    expect(harness.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    expect(harness.diagnostics.clear).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics.set).not.toHaveBeenCalled();
  });

  /**
   * 2026-11-02 聚合诊断：顶层字段是「所有源的聚合视图」——`sourceId` 逗号
   * 拼接、`issues`/`skipped`/`notes`/`isolines` 各源拼接、`layoutMode` 与
   * `sourceVersion` 取第一个非空；逐源明细进 `sources`，多源 notes 带
   * `refno：` 前缀归因。
   */
  it('aggregates per-source diagnostics into the snapshot fields', async () => {
    const version = {
      dbnum: 24381,
      sesno: 145,
      databases: [{ dbnum: 24381, sesno: 145, db_type: 'DESI' }],
    };
    const fetchPipeData = vi.fn(async (refno: string) => ({
      ok: true as const,
      data: contractPayload({
        input_refno: refno,
        branch_refno: refno,
        meta: refno === 'A'
          ? {
            geometry_space: 'source_mm' as const,
            source_to_design: IDENTITY,
            notes: ['note-a'],
            source_version: version,
            isolines: [{ index: 0, members: ['24381_145018'], cheight_mm: 25, od_mm: 114.3 }],
          }
          : {
            geometry_space: 'source_mm' as const,
            source_to_design: IDENTITY,
            notes: [],
            layout_mode: 'linear_mvp',
          },
        issues: [{
          id: `issue-${refno}`,
          severity: 'warning' as const,
          category: 'data' as const,
          message: `${refno} warning`,
        }],
      }),
      diagnostics: refno === 'B'
        ? [{ id: 'future-1', reason: '还不认识的图元 kind：future_dim' }]
        : [],
    }));
    const harness = createHarness({ search: '?mbd_refno=A,B', fetchPipeData });

    await harness.sync.sync(harness.target);

    const diagnostics = (harness.diagnostics.set as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)![0];
    expect(diagnostics.sourceId).toBe('A,B');
    expect(diagnostics.issues.map((issue: { id: string }) => issue.id))
      .toEqual(['issue-A', 'issue-B']);
    expect(diagnostics.skipped).toEqual([
      { id: 'future-1', reason: '还不认识的图元 kind：future_dim' },
    ]);
    expect(diagnostics.layoutMode).toBe('linear_mvp');
    expect(diagnostics.sourceVersion).toEqual(version);
    expect(diagnostics.isolines).toEqual([
      { index: 0, members: ['24381_145018'], cheight_mm: 25, od_mm: 114.3 },
    ]);
    expect(diagnostics.loadError).toBeUndefined();
    // 多源时逐源 notes 带 refno 前缀（A 的 meta.note、B 的契约层跳过提示）。
    expect(diagnostics.notes).toEqual(expect.arrayContaining([
      'A：note-a',
      expect.stringContaining('B：契约层跳过 1 个图元'),
    ]));
    expect(diagnostics.sources).toEqual([
      expect.objectContaining({ refno: 'A', loadError: null }),
      expect.objectContaining({ refno: 'B', loadError: null }),
    ]);
  });

  /**
   * 2026-11-02 失败提示按 refno 去重：A、B 各失败各的，互不把对方的去重
   * 记忆顶掉——单条记忆时第二次 sync 会漏报 B、或重复弹 A。
   */
  it('dedupes failure toasts per refno instead of sharing one slot', async () => {
    const fetchPipeData = vi.fn(async (refno: string) => {
      throw new Error(`boom-${refno}`);
    });
    const harness = createHarness({ search: '?mbd_refno=A,B', fetchPipeData });

    await harness.sync.sync(harness.target);
    await harness.sync.sync(harness.target);

    // A、B 各弹一次；第二轮同样的原因各自去重。
    expect(harness.emitToast).toHaveBeenCalledTimes(2);
    expect(harness.emitToast).toHaveBeenCalledWith({
      message: 'MBD 标注装载失败：boom-A',
      level: 'error',
    });
    expect(harness.emitToast).toHaveBeenCalledWith({
      message: 'MBD 标注装载失败：boom-B',
      level: 'error',
    });
    // 去重只作用于弹窗：每轮诊断照旧写入。
    expect(harness.diagnostics.set).toHaveBeenCalledTimes(2);
  });

  /**
   * 2026-11-02 多包竞态：第一批在途时被新 sync 顶替，老结果整体放弃，
   * 不提交半批；新 sync 正常合并。
   */
  it('discards the whole batch when a newer multi-refno sync starts', async () => {
    type FetchResult = Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>;
    const deferreds: { resolve: (value: FetchResult) => void }[] = [];
    const fetchPipeData = vi.fn(
      () => new Promise<FetchResult>((resolve) => {
        deferreds.push({ resolve });
      }),
    );
    const harness = createHarness({ search: '?mbd_refno=A,B', fetchPipeData });

    const first = harness.sync.sync(harness.target);
    const second = harness.sync.sync(harness.target);
    // 新 sync 又占满并发位：两批各两个在途。
    expect(fetchPipeData).toHaveBeenCalledTimes(4);
    for (const deferred of deferreds) {
      deferred.resolve({ ok: true, data: contractPayload(), diagnostics: [] });
    }
    await Promise.all([first, second]);

    // 只有新 sync 提交：A:dim-1 + B:dim-1 一批，不是两批叠出来的四条。
    expect(harness.target.replaceExternalSource).toHaveBeenCalledTimes(1);
    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records.map((record: { id: string }) => record.id))
      .toEqual(['A:dim-1', 'B:dim-1']);
  });
});
