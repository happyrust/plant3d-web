import { describe, expect, it, vi } from 'vitest';

import type { NodeModelStatusResponse } from '@/api/genModelV1Api';
import type { GenerationFillSummary, GenerationTreeNode } from '@/composables/generationFill';

import { nodeModelFactsOf, type NodeModelFacts } from '@/composables/nodeModelStatus';
import { decideNodeUpdate, describeNodeUpdateSummary, planNodeUpdateChunks } from '@/composables/nodeModelUpdate';

/** 7997：在后端的监听范围里，但没初始化——模型全是后端这次运行期间按需生成的 */
const LIBRARY_ON_DEMAND: NodeModelStatusResponse['library'] = {
  file_latest_sesno: 447, file_latest_time: '2026-11-07T19:43:00+08:00', applied_sesno: 0, model_sesno: 0, model_sesno_time: null,
  initialized: true, model_verdict: 'not_judged', model_verdict_reason: 'data_watermark_unestablished',
  model_source: 'memory', model_source_reason: 'data_watermark_unestablished',
  data_batch_running: false, model_task_running: false, in_watch_scope: true,
};
/** 7999：有模型水位，但不在后端的更新范围里（不参与） */
const LIBRARY_EXCLUDED: NodeModelStatusResponse['library'] = {
  file_latest_sesno: 236, file_latest_time: '2026-11-10T11:59:15+08:00', applied_sesno: 213, model_sesno: 213,
  model_sesno_time: '2026-10-27T01:02:57+08:00', initialized: true, model_verdict: 'in_sync', model_verdict_reason: null,
  model_source: 'database', model_source_reason: null, data_batch_running: false, model_task_running: false, in_watch_scope: false,
};
/** 8000：有模型水位、在更新范围里——落后的节点走库一级的更新 */
const LIBRARY_WATCHED: NodeModelStatusResponse['library'] = {
  ...LIBRARY_EXCLUDED, file_latest_sesno: 1146, applied_sesno: 1143, model_sesno: 1143, in_watch_scope: true,
};

/** 按需生成的库里一个落后的 SITE：21 个单元都生成过（会话 445），之后有 1 个被改到 */
const LAGGING: NodeModelStatusResponse = {
  refno: '24381/535', noun: 'SITE', dbnum: 7997, unit_root: null, verdict: 'lagging', verdict_reason: 'units_changed',
  library: LIBRARY_ON_DEMAND,
  units: { total: 21, generated: 21, missing: 0, failed: 0, lagging: 1, exact: true },
  generated_at: { sesno_min: 445, sesno_max: 445, time_min: null, time_max: null, basis: 'own_generation' },
  changes: { from_sesno: 445, to_sesno: 447, units_changed: 1, units_added: 0, units_removed: 0, elements: { added: 0, deleted: 0, modified: 3, noop: 0 }, unattributed: false },
  precheck: { units_to_generate: 0, needs_confirm: false, confirm_threshold_units: 20 },
};

function facts(patch: Partial<NodeModelStatusResponse> = {}): NodeModelFacts {
  return nodeModelFactsOf({ ...LAGGING, ...patch });
}

const SMALL = { units: { total: 8, generated: 8, missing: 0, failed: 0, lagging: 1, exact: true } } satisfies Partial<NodeModelStatusResponse>;
const REMOVED = {
  verdict_reason: 'other_changes',
  changes: { from_sesno: 445, to_sesno: 447, units_changed: 2, units_added: 0, units_removed: 2, elements: { added: 0, deleted: 9, modified: 0, noop: 0 }, unattributed: false },
} satisfies Partial<NodeModelStatusResponse>;

describe('decideNodeUpdate（点了节点一级的「更新」之后怎么办）', () => {
  it('没有单元被删：不带 force 的生成——不清几何，不踩 #142，后端声明没声明都不为这个问人', () => {
    for (const purgeKeepsShared of [false, true]) {
      const decision = decideNodeUpdate({ facts: facts(SMALL), purgeKeepsShared });
      expect(decision).toEqual({ kind: 'generate', unitsTotal: 8, unitsLagging: 1, unitsRemoved: 0, thresholdUnits: 20, confirm: null });
    }
  });

  it('没有单元被删、但单元多（超过后端给的阈值）：先说明要占用后端一段时间再做', () => {
    const decision = decideNodeUpdate({ facts: facts(), purgeKeepsShared: false });
    expect(decision.kind).toBe('generate');
    if (decision.kind !== 'generate') throw new Error('unreachable');
    expect(decision.confirm).toMatchObject({ kind: 'scale', title: '更新到最新', confirmText: '更新', cancelText: '取消' });
    expect(decision.confirm?.message).toBe(
      '这个库的模型按需生成，只能按节点更新：后端把这个节点下的 21 个单元逐个核对，不是库文件最新会话的重新生成（已是最新的跳过）。'
      + '要占用后端一段时间，状态栏有进度；做完自动换到屏幕上。',
    );
    // 阈值 0 = 从不要求确认
    const never = decideNodeUpdate({
      facts: facts({ precheck: { units_to_generate: 0, needs_confirm: false, confirm_threshold_units: 0 } }),
      purgeKeepsShared: false,
    });
    expect(never).toMatchObject({ kind: 'generate', confirm: null });
  });

  it('不在更新范围里的库（有模型水位）：同样走节点一级，话里写明是因为不参与', () => {
    const decision = decideNodeUpdate({
      facts: facts({
        library: LIBRARY_EXCLUDED, dbnum: 7999,
        units: { total: 3362, generated: 3362, missing: 0, failed: 0, lagging: 5, exact: true },
        generated_at: { sesno_min: 213, sesno_max: 213, time_min: null, time_max: null, basis: 'library_watermark' },
      }),
      purgeKeepsShared: false,
    });
    expect(decision).toMatchObject({ kind: 'generate', unitsTotal: 3362, unitsLagging: 5 });
    if (decision.kind !== 'generate') throw new Error('unreachable');
    expect(decision.confirm?.kind).toBe('scale');
    expect(decision.confirm?.message).toContain('这个库不在后端的更新范围里（不参与），只能按节点更新：后端把这个节点下的 3362 个单元逐个核对');
  });

  it('有单元被删：要先清后生成（带 force）；后端没声明 #142 已修时先确认，用给人看的话说清楚后果', () => {
    const decision = decideNodeUpdate({ facts: facts({ ...SMALL, ...REMOVED }), purgeKeepsShared: false });
    expect(decision).toMatchObject({ kind: 'regenerate', unitsTotal: 8, unitsRemoved: 2 });
    if (decision.kind !== 'regenerate') throw new Error('unreachable');
    expect(decision.confirm).toMatchObject({ kind: 'purge-risk', title: '更新到最新', confirmText: '知道风险，继续', cancelText: '取消' });
    expect(decision.confirm?.message).toBe(
      '这个节点下有 2 个单元已经被删掉。要把它们的旧模型一起清掉，只能先清后生成（同右键「重新生成模型」）：'
      + '这个节点范围内的模型先清掉，再把 8 个单元按库文件最新会话重新生成。'
      + '这个后端版本上，重新生成可能连带删掉别的构件、别的库共用的模型数据（标准图元和支管的管身；不报错，要整库重建才补得回来）。'
      + '确认要继续吗？取消的话模型保持现在的样子，等后端修好之后再点「更新」。',
    );
    // 给人看的话里不出现议题号、接口名这类内部叫法
    expect(decision.confirm?.message).not.toMatch(/#142|force|mesh_purge|capabilit/i);
  });

  it('有单元被删、后端声明了清几何不再带走别人共用的东西：不为这个问人；单元多时只说明要占用后端一段时间', () => {
    const small = decideNodeUpdate({ facts: facts({ ...SMALL, ...REMOVED }), purgeKeepsShared: true });
    expect(small).toMatchObject({ kind: 'regenerate', confirm: null });
    const large = decideNodeUpdate({ facts: facts(REMOVED), purgeKeepsShared: true });
    expect(large.kind).toBe('regenerate');
    if (large.kind !== 'regenerate') throw new Error('unreachable');
    expect(large.confirm?.kind).toBe('scale');
    expect(large.confirm?.message).toContain('有 2 个单元已经被删掉，要先清后生成');
    expect(large.confirm?.message).toContain('再把 21 个单元按库文件最新会话重新生成（中途不能停）');
    expect(large.confirm?.message).not.toContain('连带删掉');
  });

  it('后端此刻说已经最新（别处更新过了）：不生成，直接重载', () => {
    const decision = decideNodeUpdate({ facts: facts({ verdict: 'latest', verdict_reason: null, changes: null }), purgeKeepsShared: false });
    expect(decision).toEqual({ kind: 'reload', message: '后端说这个节点已经是最新（别处更新过了），直接按最新记录换上' });
  });

  it('这个库有库一级的更新可走（有模型水位、在更新范围里）：不按节点重新生成，指回行上的「更新」', () => {
    const decision = decideNodeUpdate({
      facts: facts({ library: LIBRARY_WATCHED, generated_at: { sesno_min: 1143, sesno_max: 1143, time_min: null, time_max: null, basis: 'library_watermark' } }),
      purgeKeepsShared: true,
    });
    expect(decision).toMatchObject({ kind: 'abort', level: 'info', recheck: true });
    // 在范围里、但模型全是按需生成的（没初始化）：库一级的更新没有水位可推进，仍然按节点
    expect(decideNodeUpdate({ facts: facts(SMALL), purgeKeepsShared: true }).kind).toBe('generate');
  });

  it('不该动的几种：没有接口、库正在更新、判不了、没有生成单元、已经不是「全部生成过」', () => {
    expect(decideNodeUpdate({ facts: null, purgeKeepsShared: false })).toMatchObject({ kind: 'abort', level: 'warning', recheck: false });
    expect(decideNodeUpdate({ facts: facts({ verdict: 'updating', verdict_reason: 'data_batch_running' }), purgeKeepsShared: false }))
      .toEqual({ kind: 'abort', level: 'info', message: '这个库正在更新，等它做完再看', recheck: true });
    expect(decideNodeUpdate({ facts: facts({ verdict: 'unknown', verdict_reason: 'changes_unreadable' }), purgeKeepsShared: false }))
      .toEqual({ kind: 'abort', level: 'warning', message: '后端判不了这个节点的状态（changes_unreadable），没有更新', recheck: true });
    expect(decideNodeUpdate({
      facts: facts({ verdict: 'empty', units: { total: 0, generated: 0, missing: 0, failed: 0, lagging: 0, exact: true }, generated_at: null, changes: null }),
      purgeKeepsShared: false,
    })).toMatchObject({ kind: 'abort', level: 'info', recheck: true });
    // 后端重启过：按需生成的模型不在了，节点变回「未生成 / 部分生成」——那是「生成」的事
    const lost = decideNodeUpdate({
      facts: facts({ verdict: 'partial', units: { total: 21, generated: 5, missing: 15, failed: 1, lagging: 0, exact: true } }),
      purgeKeepsShared: false,
    });
    expect(lost).toMatchObject({ kind: 'abort', level: 'info', recheck: true });
    if (lost.kind !== 'abort') throw new Error('unreachable');
    expect(lost.message).toContain('部分生成');
    expect(lost.message).toContain('21 个单元里 16 个没有模型');
  });
});

describe('planNodeUpdateChunks（不带 force 的那条路怎么分块）', () => {
  const zone = (refno: string, name: string, childrenCount: number | null): GenerationTreeNode => ({ refno, noun: 'ZONE', name, childrenCount });

  it('SITE：一个 ZONE 一块，没有子节点的 ZONE 不进块；每块的单元数是平摊的估计', async () => {
    const listChildren = vi.fn(async () => [zone('1_10', '/Z-A', 3), zone('1_11', '/Z-EMPTY', 0), zone('1_12', '/Z-B', null), zone('1_13', '/Z-C', 9)]);
    const plan = await planNodeUpdateChunks({ root: '1_2', rootNoun: 'site', unitsTotal: 31, thresholdUnits: 20, listChildren });
    expect(listChildren).toHaveBeenCalledWith('1_2');
    expect(plan.chunks).toEqual([
      { refno: '1_10', noun: 'ZONE', name: '/Z-A', units: 10 },
      { refno: '1_12', noun: 'ZONE', name: '/Z-B', units: 10 },
      { refno: '1_13', noun: 'ZONE', name: '/Z-C', units: 10 },
    ]);
    expect(plan).toMatchObject({ root: '1_2', units: 30, exact: false, needsConfirm: false, thresholdUnits: 20, skipped: [], rootFacts: null });
  });

  it('ZONE 及以下：节点自己一块，不去列子节点', async () => {
    const listChildren = vi.fn(async () => [zone('1_20', 'x', 1)]);
    const plan = await planNodeUpdateChunks({ root: '1_10', rootNoun: 'ZONE', unitsTotal: 7, thresholdUnits: 20, listChildren });
    expect(listChildren).not.toHaveBeenCalled();
    expect(plan.chunks).toEqual([{ refno: '1_10', noun: 'ZONE', name: '1_10', units: 7 }]);
    expect(plan).toMatchObject({ units: 7, exact: true });
  });

  it('SITE 的成员取不到、或只有一个有东西的成员：节点自己一块', async () => {
    const failing = await planNodeUpdateChunks({
      root: '1_2', rootNoun: 'SITE', unitsTotal: 5, thresholdUnits: 20,
      listChildren: async () => { throw new Error('tree children 查询失败'); },
    });
    expect(failing.chunks).toEqual([{ refno: '1_2', noun: 'SITE', name: '1_2', units: 5 }]);
    const single = await planNodeUpdateChunks({
      root: '1_2', rootNoun: 'SITE', unitsTotal: 5, thresholdUnits: 20,
      listChildren: async () => [zone('1_10', '/Z-A', 3), zone('1_11', '/Z-EMPTY', 0)],
    });
    expect(single.chunks).toEqual([{ refno: '1_2', noun: 'SITE', name: '1_2', units: 5 }]);
  });
});

describe('describeNodeUpdateSummary（做完之后的一句话）', () => {
  const outcome = (state: GenerationFillSummary['outcomes'][number]['state'], failedRoots: GenerationFillSummary['outcomes'][number]['failedRoots'] = []) => ({
    chunk: { refno: '1_10', noun: 'ZONE', name: '/Z-A', units: 5 }, state, refnos: [], attempts: 1, failedRoots, hint: null,
  });

  it('都做完：成功，说核对了多少个单元', () => {
    expect(describeNodeUpdateSummary({ outcomes: [outcome('done'), outcome('empty')], stopped: false, unitsDone: 21, shownRefnos: 0 }))
      .toEqual({ level: 'success', message: '后端已核对 21 个单元（落后的已重新生成）' });
  });

  it('后端还没做完的块、失败的生成根都点出来', () => {
    const report = describeNodeUpdateSummary({
      outcomes: [
        outcome('done'),
        outcome('pending'),
        outcome('partial', [{ root: '1_30', error: 'generation_failed: 几何坏了', retryable: false }, { root: '1_31', error: 'conflict: 根被占着', retryable: true }]),
      ],
      stopped: false, unitsDone: 12, shownRefnos: 0,
    });
    expect(report.level).toBe('warning');
    expect(report.message).toBe('后端已核对 12 个单元（落后的已重新生成）；1 块后端还没做完，稍后再点「更新」接着做；1 个生成根失败：1_30（generation_failed: 几何坏了）');
  });
});
