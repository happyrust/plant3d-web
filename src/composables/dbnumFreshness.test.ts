import { describe, expect, it } from 'vitest';

import { describeDbnumFreshness, judgeDbnumFreshness, type DbnumFreshnessKind } from './dbnumFreshness';

import type { DbnumRow } from '@/api/genModelV1Api';

/** 本机 `/dbnums`（轻量形态）2026-11-10 的实际行，只留判定用得到的格。 */
const ROW_1112: DbnumRow = {
  dbnum: 1112, db_type: 'DESI', initialized: true, not_in_project: false,
  file_latest_sesno: 748, applied_sesno: 738, model_sesno: 738,
  model_sesno_time: '2026-09-23T15:19:54', model_verdict: 'in_sync', model_verdict_reason: null, model_source: 'database', model_source_reason: null,
};
const ROW_7999: DbnumRow = {
  dbnum: 7999, db_type: 'DESI', initialized: true,
  file_latest_sesno: 236, applied_sesno: 213, model_sesno: 213, model_verdict: 'in_sync', model_source: 'database',
};
const ROW_7333: DbnumRow = {
  dbnum: 7333, db_type: 'DESI', initialized: true,
  file_latest_sesno: 1732, applied_sesno: 1724, model_sesno: 1724, model_verdict: 'in_sync', model_source: 'database',
};
const ROW_8000: DbnumRow = {
  dbnum: 8000, db_type: 'DESI', initialized: true,
  file_latest_sesno: 1143, applied_sesno: 1143, model_sesno: 1143, model_verdict: 'in_sync', model_source: 'database',
};
const ROW_7998: DbnumRow = {
  dbnum: 7998, db_type: 'DESI', initialized: true,
  file_latest_sesno: 645, applied_sesno: 645, model_sesno: 645, model_verdict: 'in_sync', model_source: 'database',
};
const ROW_7997: DbnumRow = {
  dbnum: 7997, db_type: 'DESI', initialized: false,
  file_latest_sesno: 447, applied_sesno: 0, model_sesno: 0,
  model_verdict: 'not_judged', model_source: 'memory', model_source_reason: 'data_watermark_unestablished',
};

function kindOf(row: DbnumRow): DbnumFreshnessKind {
  return judgeDbnumFreshness(row).kind;
}

describe('judgeDbnumFreshness（库一级按库文件最新会话判）', () => {
  it('模型与数据一致、但库文件已有新会话：是「有新会话未更新」，不是「最新」；差几个会话照 /dbnums 的数算', () => {
    expect(judgeDbnumFreshness(ROW_1112)).toMatchObject({ kind: 'file_ahead', sessionsNotApplied: 10, fileLatest: 748, applied: 738, model: 738 });
    expect(judgeDbnumFreshness(ROW_7999)).toMatchObject({ kind: 'file_ahead', sessionsNotApplied: 23 });
    expect(judgeDbnumFreshness(ROW_7333)).toMatchObject({ kind: 'file_ahead', sessionsNotApplied: 8 });
  });

  it('三枚水位对齐才是「最新」', () => {
    expect(judgeDbnumFreshness(ROW_8000)).toMatchObject({ kind: 'latest', sessionsNotApplied: 0, modelBehindData: false });
    expect(kindOf(ROW_7998)).toBe('latest');
  });

  it('数据水位没立过的库是「未初始化」；等人工初始化的单独一档', () => {
    expect(kindOf(ROW_7997)).toBe('uninitialized');
    expect(kindOf({ ...ROW_7997, awaiting_manual_initialization: true })).toBe('awaiting');
  });

  it('模型落后于已入库数据：后端判 lagging 就算；没表态时退回比两枚水位', () => {
    expect(judgeDbnumFreshness({ ...ROW_8000, model_sesno: 1140, model_verdict: 'lagging', model_source_reason: 'model_lagging' }))
      .toMatchObject({ kind: 'model_behind', modelBehindData: true, sessionsNotApplied: 0 });
    // 水位相等但还有根在追（后端 lagging）：照后端的判决
    expect(kindOf({ ...ROW_8000, model_verdict: 'lagging' })).toBe('model_behind');
    expect(kindOf({ ...ROW_8000, model_sesno: 1140, model_verdict: undefined })).toBe('model_behind');
    expect(kindOf({ ...ROW_8000, model_verdict: undefined })).toBe('latest');
  });

  it('模型落后于数据、库文件又有新会话：按「模型落后」画，新会话数照带', () => {
    expect(judgeDbnumFreshness({ ...ROW_1112, model_sesno: 730, model_verdict: 'lagging' }))
      .toMatchObject({ kind: 'model_behind', modelBehindData: true, sessionsNotApplied: 10 });
  });

  it('库正在被写是「更新中」：全量行看 write_state.status=writing，轻量行看 model_source_reason', () => {
    expect(kindOf({ ...ROW_1112, write_state: { status: 'writing', intent: 'apply_window' } })).toBe('updating');
    expect(kindOf({ ...ROW_1112, model_source: 'memory', model_source_reason: 'initialization_publishing' })).toBe('updating');
    // 写完了（finished）不算在写
    expect(kindOf({ ...ROW_8000, write_state: { status: 'finished' } })).toBe('latest');
    // 未初始化的库正在初始化：也是更新中
    expect(kindOf({ ...ROW_7997, write_state: { status: 'writing', intent: 'initialize' } })).toBe('updating');
  });

  it('阻断 / 不参与优先于其它判断', () => {
    expect(kindOf({ ...ROW_1112, blocked: true })).toBe('blocked');
    expect(kindOf({ ...ROW_1112, excluded: true, blocked: true })).toBe('excluded');
    expect(kindOf({ ...ROW_8000, not_in_project: true })).toBe('excluded');
  });

  it('判不了的不硬说：没有后端判决又缺模型水位、或模型水位反超数据水位', () => {
    expect(kindOf({ dbnum: 9, db_type: 'DESI', initialized: true, file_latest_sesno: 5, applied_sesno: 5 })).toBe('unknown');
    expect(kindOf({ ...ROW_8000, model_sesno: 1150, model_verdict: 'not_judged', model_source_reason: 'watermarks_inconsistent' })).toBe('unknown');
  });

  it('不生成模型的库（非 DESI）只比数据与库文件', () => {
    expect(kindOf({ dbnum: 1, db_type: 'CATA', initialized: true, file_latest_sesno: 9, applied_sesno: 9 })).toBe('latest');
    expect(kindOf({ dbnum: 1, db_type: 'CATA', initialized: true, file_latest_sesno: 9, applied_sesno: 7 })).toBe('file_ahead');
  });

  it('行上没写库类型、但带着模型判决：照有模型的库判，不把 lagging 吞掉', () => {
    expect(kindOf({ dbnum: 8000, initialized: true, model_verdict: 'lagging' })).toBe('model_behind');
    expect(kindOf({ dbnum: 8000, initialized: true, model_verdict: 'in_sync' })).toBe('latest');
  });

  it('initialized 整格缺席时按数据水位推断（立过数据水位就是初始化过）', () => {
    expect(kindOf({ dbnum: 3, db_type: 'DESI', file_latest_sesno: 5, applied_sesno: 5, model_sesno: 5 })).toBe('latest');
    expect(kindOf({ dbnum: 3, db_type: 'DESI', file_latest_sesno: 5 })).toBe('uninitialized');
  });
});

describe('describeDbnumFreshness（圆点提示与面板徽标共用的说法）', () => {
  it('有新会话未更新：写明差几个，措辞中性；带三枚水位和模型水位的保存时间', () => {
    const text = describeDbnumFreshness(judgeDbnumFreshness(ROW_1112));
    expect(text.headline).toBe('库有 10 个新会话未更新');
    expect(text.detail).toContain('尚未核对是否影响模型');
    expect(text.watermarks).toBe('模型 738（2026-09-23 15:19 保存） · 数据 738 · 库文件最新 748');
  });

  it('最新 / 未初始化 / 模型落后 / 更新中各有一句', () => {
    expect(describeDbnumFreshness(judgeDbnumFreshness(ROW_8000)).headline).toBe('模型已是最新');
    expect(describeDbnumFreshness(judgeDbnumFreshness(ROW_7997)).headline).toBe('库未初始化，模型按需生成');
    expect(describeDbnumFreshness(judgeDbnumFreshness({ ...ROW_8000, model_sesno: 1140, model_verdict: 'lagging' })).headline)
      .toBe('模型落后于已入库数据');
    expect(describeDbnumFreshness(judgeDbnumFreshness({ ...ROW_1112, write_state: { status: 'writing' } })).headline).toBe('库正在更新');
  });

  it('模型落后又有新会话：两件事都说', () => {
    const text = describeDbnumFreshness(judgeDbnumFreshness({ ...ROW_1112, model_sesno: 730, model_verdict: 'lagging' }));
    expect(text.headline).toBe('模型落后于已入库数据');
    expect(text.detail).toContain('库文件还有 10 个新会话未入库');
  });

  it('未初始化的库不报水位（模型 0 / 数据 0 不是事实陈述），只报库文件最新会话', () => {
    expect(describeDbnumFreshness(judgeDbnumFreshness(ROW_7997)).watermarks).toBe('库文件最新 447');
  });

  it('保存时间给不出或解析不了就不写时间，不编', () => {
    expect(describeDbnumFreshness(judgeDbnumFreshness(ROW_8000)).watermarks).toBe('模型 1143 · 数据 1143 · 库文件最新 1143');
    expect(describeDbnumFreshness(judgeDbnumFreshness({ ...ROW_8000, model_sesno_time: 'not-a-time' })).watermarks)
      .toBe('模型 1143 · 数据 1143 · 库文件最新 1143');
  });
});
