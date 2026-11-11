/**
 * 模型资产补齐的预检与分块执行（方案 2026-11-10 B3）。全部用假的「数子节点 / 生成 / 装载」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GENERATION_CONFIRM_THRESHOLD_UNITS,
  chunkResultFromCollect,
  describeGenerationConfirm,
  describeGenerationFillSummary,
  generationResumeTiming,
  isRetryableGenerationError,
  planModelGeneration,
  remainingGenerationChunks,
  runGenerationFill,
  type ChunkGenerateResult,
  type GenerationChunk,
  type GenerationFillProgress,
  type GenerationPlan,
  type GenerationTreeNode,
} from './generationFill';

import type { CollectRecordsResult } from '@/model-source/genModelV1/modelRecords';

const node = (refno: string, noun: string, childrenCount: number | null, name = refno): GenerationTreeNode => ({ refno, noun, name, childrenCount });

/** 7997 的 SITE 24381_535 那五个 ZONE（2026-11-11 实查）：两个已有模型，一个没有子节点，两个没有模型 */
const SITE_535: Record<string, GenerationTreeNode[]> = {
  '24381_535': [
    node('24381_179753', 'ZONE', 0, 'ZONE'),
    node('24381_179300', 'ZONE', 1, '/6ZBR-ITUB-NH'),
    node('24381_536', 'ZONE', 4, '/1RCV-SUPP-XX'),
    node('24381_571', 'ZONE', 1, '/1RCV-ITUB-XX'),
    node('24381_621', 'ZONE', 2, '/1RCV-RACK-XX'),
  ],
  '24381_536': [node('24381_537', 'STRU', 3), node('24381_549', 'REST', 1), node('24381_553', 'STRU', 3), node('24381_567', 'REST', 1)],
  '24381_571': [node('24381_572', 'PIPE', 5)],
  '24381_621': [node('24381_622', 'REST', 4), node('24381_631', 'STRU', 3)],
};

function treeOf(table: Record<string, GenerationTreeNode[]>) {
  return vi.fn(async (refno: string) => {
    const children = table[refno];
    if (!children) throw new Error(`no children for ${refno}`);
    return children;
  });
}

const ok = (refnos: string[], roots = refnos.length): ChunkGenerateResult => ({ refnos, roots, pending: false, failedRoots: [], hint: null });
const pendingResult = (refnos: string[] = []): ChunkGenerateResult => ({ refnos, roots: 0, pending: true, failedRoots: [], hint: null });

function planOf(chunks: GenerationChunk[]): GenerationPlan {
  const units = chunks.reduce((sum, chunk) => sum + chunk.units, 0);
  return { root: '24381_535', chunks, units, exact: false, needsConfirm: units > 20, thresholdUnits: 20, skipped: [] };
}
const chunk = (refno: string, units: number, name = refno): GenerationChunk => ({ refno, noun: 'ZONE', name, units });

const realTiming = { ...generationResumeTiming, delaysMs: [...generationResumeTiming.delaysMs] };
beforeEach(() => {
  generationResumeTiming.delaysMs = [3_000, 5_000, 8_000, 10_000];
  generationResumeTiming.budgetMs = 10 * 60_000;
});
afterEach(() => {
  generationResumeTiming.delaysMs = realTiming.delaysMs;
  generationResumeTiming.budgetMs = realTiming.budgetMs;
});

describe('planModelGeneration：沿树往下数两层（过渡办法，等节点模型状态接口）', () => {
  it('SITE 下没有模型的 ZONE：一个 ZONE 一块；单元数 = 子节点里交付单元各算 1、其余算它的子节点数', async () => {
    const listChildren = treeOf(SITE_535);
    const plan = await planModelGeneration({
      root: '24381_535', rootNoun: 'SITE', scopes: ['24381_179753', '24381_536', '24381_621'], listChildren,
      deliveryUnitTypes: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
    });
    expect(plan.chunks).toEqual([
      { refno: '24381_536', noun: 'ZONE', name: '/1RCV-SUPP-XX', units: 8 },
      { refno: '24381_621', noun: 'ZONE', name: '/1RCV-RACK-XX', units: 7 },
    ]);
    // 没有子节点的 ZONE 没有东西可生成：不进块，也不为它再发请求
    expect(plan.skipped).toEqual(['24381_179753']);
    expect(listChildren.mock.calls.map((call) => call[0]).sort()).toEqual(['24381_535', '24381_536', '24381_621']);
    expect(plan).toMatchObject({ units: 15, exact: false, needsConfirm: false, thresholdUnits: GENERATION_CONFIRM_THRESHOLD_UNITS });
  });

  it('管道 ZONE 自己（一块）：PIPE 不是交付单元，数它的 BRAN', async () => {
    const plan = await planModelGeneration({ root: '24381_571', rootNoun: 'ZONE', scopes: ['24381_571'], listChildren: treeOf(SITE_535) });
    expect(plan.chunks).toEqual([{ refno: '24381_571', noun: 'ZONE', name: '24381_571', units: 5 }]);
    expect(plan.needsConfirm).toBe(false);
  });

  it('子节点就是交付单元（EQUI / SUPPO）各算 1 个；没有子节点的普通构件算 1 个', async () => {
    const listChildren = treeOf({
      '1_1': [node('1_2', 'EQUI', 40), node('1_3', 'SUPPO', 9), node('1_4', 'SCTN', 0), node('1_5', 'PIPE', null)],
    });
    const plan = await planModelGeneration({ root: '1_1', rootNoun: 'ZONE', scopes: ['1_1'], listChildren });
    expect(plan.units).toBe(4);
  });

  it('节点自己就是交付单元（BRAN / EQUI）：1 个单元，不去数子节点', async () => {
    const listChildren = vi.fn();
    const plan = await planModelGeneration({ root: '24381_145018', rootNoun: 'BRAN', scopes: ['24381_145018'], listChildren });
    expect(plan.chunks).toEqual([{ refno: '24381_145018', noun: 'BRAN', name: '24381_145018', units: 1 }]);
    expect(listChildren).not.toHaveBeenCalled();
  });

  it('超过 20 个单元才要确认；刚好 20 个不用', async () => {
    const table = (count: number) => treeOf({ '1_1': [node('1_2', 'PIPE', count)] });
    const twenty = await planModelGeneration({ root: '1_1', rootNoun: 'ZONE', scopes: ['1_1'], listChildren: table(20) });
    expect(twenty).toMatchObject({ units: 20, needsConfirm: false });
    const more = await planModelGeneration({ root: '1_1', rootNoun: 'ZONE', scopes: ['1_1'], listChildren: table(21) });
    expect(more).toMatchObject({ units: 21, needsConfirm: true });
    // 阈值 0 = 从不要求确认（与后端 `MODEL_HISTORY_CONFIRM_UNITS = 0` 同义）
    const never = await planModelGeneration({ root: '1_1', rootNoun: 'ZONE', scopes: ['1_1'], listChildren: table(500), thresholdUnits: 0 });
    expect(never.needsConfirm).toBe(false);
  });

  it('没有子节点的 ZONE / SITE 自己：没有东西可生成，一块都没有', async () => {
    const plan = await planModelGeneration({ root: '24381_179753', rootNoun: 'ZONE', scopes: ['24381_179753'], listChildren: treeOf({ '24381_179753': [] }) });
    expect(plan.chunks).toEqual([]);
    expect(plan.skipped).toEqual(['24381_179753']);
    expect(plan.units).toBe(0);
  });

  it('数不出来（请求失败 / 类型不知道）：按 1 个单元算，照常去生成，不挡', async () => {
    const failing = vi.fn(async () => { throw new Error('HTTP 500'); });
    const single = await planModelGeneration({ root: '1_2', rootNoun: null, scopes: ['1_2'], listChildren: failing });
    expect(single.chunks).toEqual([{ refno: '1_2', noun: '', name: '1_2', units: 1 }]);
    const members = await planModelGeneration({ root: '1_1', rootNoun: 'SITE', scopes: ['1_3', '1_4'], listChildren: failing });
    expect(members.chunks.map((item) => [item.refno, item.noun, item.units])).toEqual([['1_3', 'ZONE', 1], ['1_4', 'ZONE', 1]]);
  });

  it('`/health` 还没给交付单元类型时用缺省的四种', async () => {
    const listChildren = treeOf({ '1_1': [node('1_2', 'HANG', 30), node('1_3', 'BRAN', 12)] });
    const plan = await planModelGeneration({ root: '1_1', rootNoun: 'ZONE', scopes: ['1_1'], listChildren, deliveryUnitTypes: [] });
    expect(plan.units).toBe(2);
  });
});

describe('describeGenerationConfirm', () => {
  const plan = planOf([chunk('24381_536', 12, '/1RCV-SUPP-XX'), chunk('24381_621', 14, '/1RCV-RACK-XX')]);

  it('已有的模型已经显示：写明还有多少个单元、分在几个 ZONE；选项是「生成并显示 / 只显示已有的」', () => {
    const dialog = describeGenerationConfirm(plan, true);
    expect(dialog.title).toBe('生成模型');
    expect(dialog.message).toContain('还有约 26 个单元没有模型');
    expect(dialog.message).toContain('分在 2 个 ZONE 里');
    expect(dialog.message).toContain('已有的模型已经显示');
    expect(dialog.message).toContain('做完一块显示一块');
    expect([dialog.confirmText, dialog.cancelText]).toEqual(['生成并显示', '只显示已有的']);
  });

  it('一个模型都没有：选项是「生成并显示 / 取消」；节点自己一块时不提「分在几个 ZONE」', () => {
    const whole: GenerationPlan = { ...planOf([{ refno: '24381_535', noun: 'ZONE', name: '24381_535', units: 33 }]) };
    const dialog = describeGenerationConfirm(whole, false);
    expect(dialog.message).toContain('这个节点还没有模型，要生成约 33 个单元');
    expect(dialog.message).not.toContain('分在');
    expect([dialog.confirmText, dialog.cancelText]).toEqual(['生成并显示', '取消']);
  });

  it('精确的单元数（以后由后端给）不写「约」', () => {
    expect(describeGenerationConfirm({ ...plan, exact: true }, true).message).toContain('还有 26 个单元没有模型');
  });
});

describe('chunkResultFromCollect：把记录层的结果读成一块的结论', () => {
  const base: CollectRecordsResult = {
    refno: '24381_536', generationRoots: [], items: [], pending: [], empty: [], truncatedRoots: [], errors: {}, statuses: {},
  };

  it('生成成功：构件、处理到的根数', () => {
    const result = chunkResultFromCollect('24381_536', {
      ...base, generationRoots: ['24381_537', '24381_549'], items: [{ refno: '24381_538' }, { refno: '24381_550' }, { refno: '24381_538' }] as never,
    });
    expect(result).toEqual({ refnos: ['24381_538', '24381_550'], roots: 2, pending: false, failedRoots: [], hint: null });
  });

  it('504 / 202：还在后台算', () => {
    expect(chunkResultFromCollect('24381_536', { ...base, pending: ['24381_536'], statuses: { '24381_536': 'timeout' } }).pending).toBe(true);
  });

  it('回执里的失败根原样带上；整块的错误按错误码分可不可重试；容器展开超限的也点名', () => {
    const result = chunkResultFromCollect('24381_536', {
      ...base,
      failedRoots: [
        { root: '24381_537', error: 'generation_failed: 截面数据损坏', retryable: false },
        { root: '24381_549', error: '根锁被占', retryable: true },
      ],
      errors: { '24381_536': 'conflict: 该库正被整库任务占用', '24381_553': 'generation_failed: 解析失败', '24381_537': 'internal: 重复的不再记' },
      truncatedRoots: ['24381_567'],
    });
    expect(result.failedRoots).toEqual([
      { root: '24381_537', error: 'generation_failed: 截面数据损坏', retryable: false },
      { root: '24381_549', error: '根锁被占', retryable: true },
      { root: '24381_536', error: 'conflict: 该库正被整库任务占用', retryable: true },
      { root: '24381_553', error: 'generation_failed: 解析失败', retryable: false },
      { root: '24381_567', error: '容器展开超出上限，这一根没有处理', retryable: false },
    ]);
  });

  it('空分组一类的说明带出来', () => {
    expect(chunkResultFromCollect('24381_145900', { ...base, empty: ['24381_145900'], hints: { '24381_145900': '分组为空' } }).hint).toBe('分组为空');
  });

  it.each([
    ['conflict: 库被占用', true],
    ['model_dependency_unavailable: 数据库暂时不可用', true],
    ['ref0_affiliation_unavailable: 缺库归属', true],
    ['initialization_not_ready: 初始化门没开', true],
    ['network: Failed to fetch', true],
    ['generation_failed: 数据损坏', false],
    ['internal: boom', false],
    ['没有错误码的一句话', false],
  ])('错误「%s」可重试 = %s', (message, retryable) => {
    expect(isRetryableGenerationError(message)).toBe(retryable);
  });
});

describe('runGenerationFill：一块一块生成，做完一块显示一块', () => {
  const plan = planOf([chunk('24381_536', 8, '/1RCV-SUPP-XX'), chunk('24381_621', 7, '/1RCV-RACK-XX')]);

  it('顺序执行：上一块装完才发下一块；进度里有第几块、已生成几个单元', async () => {
    const events: string[] = [];
    const progress: GenerationFillProgress[] = [];
    const summary = await runGenerationFill({
      plan,
      generateChunk: async (item) => {
        events.push(`generate ${item.refno}`);
        return item.refno === '24381_536' ? ok(['24381_538', '24381_550'], 8) : ok(['24381_623'], 7);
      },
      loadChunk: async (item, refnos) => { events.push(`load ${item.refno} ${refnos.join(',')}`); },
      onProgress: (item) => progress.push({ ...item }),
    });
    expect(events).toEqual([
      'generate 24381_536', 'load 24381_536 24381_538,24381_550',
      'generate 24381_621', 'load 24381_621 24381_623',
    ]);
    // 生成中：这一块按估计算进总数；回来了（正在显示）：这一块按实际的根数算，已生成的也加上它
    expect(progress.map((item) => [item.chunkIndex, item.chunkCount, item.phase, item.unitsDone, item.unitsTotal])).toEqual([
      [0, 2, 'generating', 0, 15], [0, 2, 'loading', 8, 15],
      [1, 2, 'generating', 8, 15], [1, 2, 'loading', 15, 15],
    ]);
    expect(summary).toMatchObject({ stopped: false, unitsDone: 15, shownRefnos: 3 });
    expect(summary.outcomes.map((outcome) => [outcome.chunk.refno, outcome.state, outcome.attempts])).toEqual([['24381_536', 'done', 1], ['24381_621', 'done', 1]]);
    expect(describeGenerationFillSummary(summary)).toEqual({ level: 'success', message: '已生成并显示 2 块（3 个构件）' });
    expect(remainingGenerationChunks(summary)).toEqual([]);
  });

  it('回执给的根数和估计不一样时，分子分母都按实际的修正，不会出现「已生成 12 / 8」', async () => {
    const progress: GenerationFillProgress[] = [];
    const summary = await runGenerationFill({
      plan,
      // 第一块估计 8 个、实际 12 个；第二块估计 7 个、实际 6 个（7997 的 SITE 24381_535 真机上是 7 和 6）
      generateChunk: async (item) => (item.refno === '24381_536' ? ok(['1_1'], 12) : ok(['1_2'], 6)),
      loadChunk: async () => {},
      onProgress: (item) => progress.push({ ...item }),
    });
    expect(progress.map((item) => [item.phase, item.unitsDone, item.unitsTotal])).toEqual([
      ['generating', 0, 15], ['loading', 12, 19],
      ['generating', 12, 19], ['loading', 18, 18],
    ]);
    expect(summary.unitsDone).toBe(18);
  });

  it('回执没给根数（旧后端 / 假接口）：这一块按估计数记', async () => {
    const summary = await runGenerationFill({
      plan,
      generateChunk: async (item) => ok([`${item.refno}_x`], 0),
      loadChunk: async () => {},
    });
    expect(summary.unitsDone).toBe(15);
  });

  it('某一块先回 504 再成功：隔几秒用同样的请求再问，不要人再点，最后装齐', async () => {
    const sleeps: number[] = [];
    const calls: [string, number][] = [];
    const progress: GenerationFillProgress[] = [];
    const answers: Record<string, ChunkGenerateResult[]> = {
      '24381_536': [pendingResult(), pendingResult(['24381_538']), ok(['24381_538', '24381_550'], 8)],
      '24381_621': [ok(['24381_623'], 7)],
    };
    const loaded: string[][] = [];
    const summary = await runGenerationFill({
      plan,
      generateChunk: async (item, attempt) => { calls.push([item.refno, attempt]); return answers[item.refno]!.shift()!; },
      loadChunk: async (_item, refnos) => { loaded.push(refnos); },
      onProgress: (item) => progress.push({ ...item }),
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(calls).toEqual([['24381_536', 1], ['24381_536', 2], ['24381_536', 3], ['24381_621', 1]]);
    expect(sleeps).toEqual([3_000, 5_000]);
    // 后台算出来一部分就先装一部分；之后只装新到的
    expect(loaded).toEqual([['24381_538'], ['24381_550'], ['24381_623']]);
    expect(progress.filter((item) => item.phase === 'waiting').map((item) => [item.attempt, item.waitMs, item.reason])).toEqual([
      [1, 3_000, '后端还在后台生成'], [2, 5_000, '后端还在后台生成'],
    ]);
    expect(summary.outcomes.map((outcome) => [outcome.state, outcome.attempts, outcome.refnos.length])).toEqual([['done', 3, 2], ['done', 1, 1]]);
    expect(describeGenerationFillSummary(summary).level).toBe('success');
  });

  it('409 库被占着 / 回执里有可重试的失败根：同样自动再问', async () => {
    const sleeps: number[] = [];
    const answers: ChunkGenerateResult[] = [
      { refnos: [], roots: 0, pending: false, failedRoots: [{ root: '24381_536', error: 'conflict: 该库正被整库任务占用', retryable: true }], hint: null },
      { refnos: ['24381_538'], roots: 8, pending: false, failedRoots: [{ root: '24381_549', error: '根锁被占', retryable: true }], hint: null },
      ok(['24381_538', '24381_550'], 8),
    ];
    const summary = await runGenerationFill({
      plan: planOf([chunk('24381_536', 8)]),
      generateChunk: async () => answers.shift()!,
      loadChunk: async () => {},
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(sleeps).toEqual([3_000, 5_000]);
    expect(summary.outcomes[0]).toMatchObject({ state: 'done', attempts: 3, refnos: ['24381_538', '24381_550'], failedRoots: [] });
  });

  it('一根失败（不可重试）：其余照常显示，失败的那根在结果里点名，不再重试', async () => {
    const generateChunk = vi.fn(async (item: GenerationChunk) => (item.refno === '24381_536'
      ? { refnos: ['24381_550'], roots: 8, pending: false, failedRoots: [{ root: '24381_537', error: 'generation_failed: 截面数据损坏', retryable: false }], hint: null }
      : ok(['24381_623'], 7)));
    const sleep = vi.fn(async () => {});
    const summary = await runGenerationFill({ plan, generateChunk, loadChunk: async () => {}, sleep });
    expect(generateChunk).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
    expect(summary.outcomes.map((outcome) => outcome.state)).toEqual(['partial', 'done']);
    expect(describeGenerationFillSummary(summary)).toEqual({
      level: 'warning',
      message: '已生成并显示 2 块（2 个构件）；1 个生成根失败：24381_537（generation_failed: 截面数据损坏）',
    });
    // 不可重试的失败不算「之后接着做」的
    expect(remainingGenerationChunks(summary)).toEqual([]);
  });

  it('整块失败、一个构件都没出来：记失败，后面的块照常做', async () => {
    const summary = await runGenerationFill({
      plan,
      generateChunk: async (item) => (item.refno === '24381_536'
        ? { refnos: [], roots: 0, pending: false, failedRoots: [{ root: '24381_536', error: 'generation_failed: 全部根失败', retryable: false }], hint: null }
        : ok(['24381_623'], 7)),
      loadChunk: async () => {},
    });
    expect(summary.outcomes.map((outcome) => outcome.state)).toEqual(['failed', 'done']);
    expect(describeGenerationFillSummary(summary).message).toBe('已生成并显示 1 块（1 个构件）；1 个生成根失败：24381_536（generation_failed: 全部根失败）');
  });

  it('等到预算用完后端还没算完：这一块记「还没做完」，后面的块照常做；之后可以接着做', async () => {
    generationResumeTiming.budgetMs = 10_000;
    let clock = 0;
    const sleeps: number[] = [];
    const summary = await runGenerationFill({
      plan,
      generateChunk: async (item) => (item.refno === '24381_536' ? pendingResult() : ok(['24381_623'], 7)),
      loadChunk: async () => {},
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
      now: () => clock,
    });
    // 3 秒、5 秒之后再等 8 秒就超过 10 秒的预算：不再等
    expect(sleeps).toEqual([3_000, 5_000]);
    expect(summary.outcomes.map((outcome) => [outcome.state, outcome.attempts])).toEqual([['pending', 3], ['done', 1]]);
    expect(remainingGenerationChunks(summary).map((item) => item.refno)).toEqual(['24381_536']);
    expect(describeGenerationFillSummary(summary)).toEqual({
      level: 'info',
      message: '已生成并显示 1 块（1 个构件）；1 块后端还没做完（/1RCV-SUPP-XX），稍后接着生成',
    });
  });

  it('再问的间隔 3、5、8 秒，之后每次 10 秒', async () => {
    const sleeps: number[] = [];
    const answers = [pendingResult(), pendingResult(), pendingResult(), pendingResult(), pendingResult(), ok(['1_1'])];
    await runGenerationFill({
      plan: planOf([chunk('24381_536', 1)]),
      generateChunk: async () => answers.shift()!,
      loadChunk: async () => {},
      sleep: async (ms) => { sleeps.push(ms); },
      now: () => 0,
    });
    expect(sleeps).toEqual([3_000, 5_000, 8_000, 10_000, 10_000]);
  });

  it('中途不要了（节点被隐藏 / 被叫停）：不再发后面的块，已经显示的留着', async () => {
    let stop = false;
    const generateChunk = vi.fn(async (item: GenerationChunk) => { if (item.refno === '24381_536') stop = true; return ok([`${item.refno}_x`]); });
    const summary = await runGenerationFill({ plan, generateChunk, loadChunk: async () => {}, shouldStop: () => stop });
    expect(generateChunk).toHaveBeenCalledTimes(1);
    expect(summary.stopped).toBe(true);
    expect(summary.outcomes.map((outcome) => outcome.state)).toEqual(['done', 'skipped']);
    expect(remainingGenerationChunks(summary).map((item) => item.refno)).toEqual(['24381_621']);
    expect(describeGenerationFillSummary(summary)).toEqual({ level: 'info', message: '已生成并显示 1 块（1 个构件）；已停止，1 块没有生成' });
  });

  it('等着再问的时候被叫停：不再问，这一块记「还没做完」', async () => {
    let stop = false;
    const generateChunk = vi.fn(async () => pendingResult());
    const summary = await runGenerationFill({
      plan: planOf([chunk('24381_536', 8)]),
      generateChunk,
      loadChunk: async () => {},
      sleep: async () => { stop = true; },
      shouldStop: () => stop,
    });
    expect(generateChunk).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ stopped: true });
    expect(summary.outcomes[0]!.state).toBe('pending');
  });

  it('跑过了但没有可显示的东西：记「空」，带上后端给的说明', async () => {
    const summary = await runGenerationFill({
      plan: planOf([chunk('24381_145900', 1)]),
      generateChunk: async () => ({ refnos: [], roots: 0, pending: false, failedRoots: [], hint: '分组为空' }),
      loadChunk: async () => {},
    });
    expect(summary.outcomes[0]).toMatchObject({ state: 'empty', hint: '分组为空' });
    expect(describeGenerationFillSummary(summary)).toEqual({ level: 'info', message: '分组为空' });
  });

  it('生成自己抛出来的（取消 / 服务换代）：整次一起停，原样往外抛', async () => {
    await expect(runGenerationFill({
      plan,
      generateChunk: async () => { throw new Error('gen-model 服务已换代'); },
      loadChunk: async () => {},
    })).rejects.toThrow('gen-model 服务已换代');
  });
});
