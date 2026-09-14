import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_USER_ID,
  AnnotationScopeError,
  annotationScopeKey,
  buildAnnotationScope,
  canonicalizeReviewRound,
  canonicalizeTaskId,
  classifyStoredScopeKey,
  createDraftSessionId,
  describeUnattributedDraft,
  diffScopeContext,
  isSameAnnotationScope,
  judgeScopeStamp,
  LEGACY_DEFAULT_STORAGE_SCOPE,
  nextScopeEpoch,
  parseAnnotationScopeKey,
  parseLegacyStorageScope,
  stampForScope,
} from './annotationScope';

describe('buildAnnotationScope（方案 §3.6：项目 + canonical taskId + reviewRound + 用户）', () => {
  it('四字段归一：trim、NFC、round 取整、用户缺省 anonymous', () => {
    const scope = buildAnnotationScope({
      projectId: '  ams8000 ',
      taskId: ' task-abc ',
      reviewRound: '2.9',
      userId: undefined,
    });
    expect(scope).toEqual({
      version: 1,
      projectId: 'ams8000',
      taskId: 'task-abc',
      draftSessionId: null,
      reviewRound: 2,
      userId: ANONYMOUS_USER_ID,
    });
  });

  it('有 taskId 时 draftSessionId 被丢弃——同一条草稿只有一个身份', () => {
    const scope = buildAnnotationScope({ taskId: 'task-1', draftSessionId: 'ds-x', userId: 'JH' });
    expect(scope.taskId).toBe('task-1');
    expect(scope.draftSessionId).toBeNull();
  });

  it('没有 taskId 用 draftSessionId 顶替；项目拿不到落 __default__', () => {
    const scope = buildAnnotationScope({ draftSessionId: 'ds-1', userId: 'SJ' });
    expect(scope.taskId).toBeNull();
    expect(scope.draftSessionId).toBe('ds-1');
    expect(scope.projectId).toBe(LEGACY_DEFAULT_STORAGE_SCOPE);
  });

  it('taskId 与 draftSessionId 都没有 → 抛 AnnotationScopeError，不退回全局 scope（G5 根因）', () => {
    expect(() => buildAnnotationScope({ projectId: 'p', userId: 'u' })).toThrowError(AnnotationScopeError);
    expect(() => buildAnnotationScope({ taskId: '   ', draftSessionId: '' })).toThrowError(/拒绝退回全局 scope/);
  });

  it('reviewRound 非法值一律 0（与 useAnnotationReviewStateSync 同口径）', () => {
    expect(canonicalizeReviewRound(undefined)).toBe(0);
    expect(canonicalizeReviewRound(-3)).toBe(0);
    expect(canonicalizeReviewRound(Number.NaN)).toBe(0);
    expect(canonicalizeReviewRound('abc')).toBe(0);
    expect(canonicalizeReviewRound(' 4 ')).toBe(4);
  });

  it('canonicalizeTaskId 不折叠大小写、只 trim', () => {
    expect(canonicalizeTaskId(' Task-ABC ')).toBe('Task-ABC');
    expect(canonicalizeTaskId(42)).toBeNull();
    expect(canonicalizeTaskId('')).toBeNull();
  });
});

describe('annotationScopeKey / parseAnnotationScopeKey（存储命名空间）', () => {
  it('key 固定五段、带 v1 前缀，与 useToolStore 旧形制 project=…|db=… 不可能撞', () => {
    const scope = buildAnnotationScope({ projectId: 'ams', taskId: 'task-1', reviewRound: 1, userId: 'JH' });
    expect(annotationScopeKey(scope)).toBe('v1|project=ams|task=task-1|round=1|user=JH');
    expect(classifyStoredScopeKey(annotationScopeKey(scope))).toBe('scoped');
    expect(classifyStoredScopeKey('project=ams|db=7997')).toBe('legacy');
  });

  it('含 | = % 的字段逐段转义并可逆', () => {
    const scope = buildAnnotationScope({ projectId: 'a|b=c%d', taskId: 'x=y|z', reviewRound: 0, userId: 'u%1' });
    const key = annotationScopeKey(scope);
    expect(key.split('|')).toHaveLength(5);
    expect(parseAnnotationScopeKey(key)).toEqual(scope);
  });

  it('draftSessionId 身份用 session= 段，round-trip 相等', () => {
    const scope = buildAnnotationScope({ projectId: 'p', draftSessionId: 'ds-9', reviewRound: 3, userId: 'SJ' });
    const key = annotationScopeKey(scope);
    expect(key).toBe('v1|project=p|session=ds-9|round=3|user=SJ');
    expect(parseAnnotationScopeKey(key)).toEqual(scope);
  });

  it('isSameAnnotationScope ⇔ key 相等；null 只与 null 相等', () => {
    const a = buildAnnotationScope({ projectId: 'p', taskId: 't', reviewRound: 1, userId: 'u' });
    const b = buildAnnotationScope({ projectId: ' p ', taskId: 't ', reviewRound: 1.7, userId: 'u' });
    const c = buildAnnotationScope({ projectId: 'p', taskId: 't', reviewRound: 2, userId: 'u' });
    expect(isSameAnnotationScope(a, b)).toBe(true);
    expect(annotationScopeKey(a)).toBe(annotationScopeKey(b));
    expect(isSameAnnotationScope(a, c)).toBe(false);
    expect(isSameAnnotationScope(null, null)).toBe(true);
    expect(isSameAnnotationScope(a, null)).toBe(false);
  });

  it('不是 v1 形制、缺段、task 与 session 并存、round 非数字 → null（不猜）', () => {
    expect(parseAnnotationScopeKey('project=ams|db=7997')).toBeNull();
    expect(parseAnnotationScopeKey('v1|project=p|task=t|round=1')).toBeNull();
    expect(parseAnnotationScopeKey('v1|project=p|task=t|session=s|round=1|user=u')).toBeNull();
    expect(parseAnnotationScopeKey('v1|project=p|task=t|round=x|user=u')).toBeNull();
    expect(parseAnnotationScopeKey('v1|project=p|task=|round=1|user=u')).toBeNull();
    expect(parseAnnotationScopeKey('v1|project=p|bogus=t|round=1|user=u')).toBeNull();
    expect(classifyStoredScopeKey('whatever')).toBe('unknown');
  });
});

describe('旧全局 key 的受控识别（不默认导入，只显示「未归属草稿」）', () => {
  it('project=…|db=… 认出项目与库；__default__ / __all__ 视为拿不到', () => {
    expect(parseLegacyStorageScope('project=ams|db=7997')).toEqual({ kind: 'legacy', projectId: 'ams', dbnum: '7997' });
    expect(parseLegacyStorageScope('project=__default__|db=__all__')).toEqual({ kind: 'legacy', projectId: null, dbnum: null });
    expect(parseLegacyStorageScope('__default__')).toEqual({ kind: 'legacy', projectId: null, dbnum: null });
    expect(parseLegacyStorageScope('v1|project=p|task=t|round=1|user=u')).toBeNull();
    expect(parseLegacyStorageScope('junk')).toBeNull();
  });

  it('展示文字：认出项目就带项目名，否则只写「未归属草稿」', () => {
    expect(describeUnattributedDraft(parseLegacyStorageScope('project=ams|db=7997'))).toBe('未归属草稿（项目 ams）');
    expect(describeUnattributedDraft(parseLegacyStorageScope('__default__'))).toBe('未归属草稿');
    expect(describeUnattributedDraft(null)).toBe('未归属草稿');
  });
});

describe('scopeEpoch 与回执守卫', () => {
  const a = buildAnnotationScope({ projectId: 'p', taskId: 'A', reviewRound: 1, userId: 'u' });
  const b = buildAnnotationScope({ projectId: 'p', taskId: 'B', reviewRound: 1, userId: 'u' });

  it('同一 scope 不递增 epoch；换 scope（含首次进入）+1', () => {
    expect(nextScopeEpoch(0, null, a)).toBe(1);
    expect(nextScopeEpoch(1, a, a)).toBe(1);
    expect(nextScopeEpoch(1, a, b)).toBe(2);
    expect(nextScopeEpoch(2, b, a)).toBe(3);
  });

  it('A 任务迟到的回执在 B 里被拒（scope-changed）；A→B→A 回来后 A 的旧回执按 epoch 拒（epoch-stale）', () => {
    const stampA1 = stampForScope(a, 1);
    // 切到 B
    expect(judgeScopeStamp(stampA1, b, 2)).toEqual({ accept: false, reason: 'scope-changed' });
    // 切回 A（epoch 3）
    expect(judgeScopeStamp(stampA1, a, 3)).toEqual({ accept: false, reason: 'epoch-stale' });
    expect(judgeScopeStamp(stampForScope(a, 3), a, 3)).toEqual({ accept: true, reason: 'current' });
  });

  it('没有 scope 或没有戳一律拒（no-scope）', () => {
    expect(judgeScopeStamp(null, a, 1)).toEqual({ accept: false, reason: 'no-scope' });
    expect(judgeScopeStamp(stampForScope(a, 1), null, 1)).toEqual({ accept: false, reason: 'no-scope' });
  });
});

describe('diffScopeContext（节点 / 流程修订 / form_id 只校验不进身份）', () => {
  it('两边都给且不同才算不一致；一边缺省不算', () => {
    expect(diffScopeContext({ node: 'jd', workflowRevision: 7, formId: 'F1' }, { node: 'jd', workflowRevision: 7, formId: ' F1 ' })).toEqual([]);
    expect(diffScopeContext({ node: 'jd' }, { node: 'sh', workflowRevision: 9 })).toEqual([
      { field: 'node', expected: 'jd', actual: 'sh' },
    ]);
    expect(diffScopeContext({ workflowRevision: 7, formId: 'F1' }, { workflowRevision: 8, formId: 'F2' })).toEqual([
      { field: 'workflowRevision', expected: 7, actual: 8 },
      { field: 'formId', expected: 'F1', actual: 'F2' },
    ]);
    expect(diffScopeContext(null, { node: 'jd' })).toEqual([]);
    expect(diffScopeContext({ workflowRevision: Number.NaN }, { workflowRevision: 3 })).toEqual([]);
  });
});

describe('createDraftSessionId', () => {
  it('可注入时钟与随机源，形如 ds-<base36 时间>-<token>', () => {
    expect(createDraftSessionId(() => 1_000_000, () => 'abc')).toBe(`ds-${(1_000_000).toString(36)}-abc`);
    expect(createDraftSessionId()).toMatch(/^ds-[0-9a-z]+-[0-9a-z]+$/);
  });
});
