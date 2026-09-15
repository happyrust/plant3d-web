import { describe, expect, it } from 'vitest';

import {
  countKeptDrafts,
  mergeConfirmedReplayWithLocalDrafts,
  parseLayeredPayload,
} from './draftLayerMerge';

function v7(parts: Partial<Record<string, unknown[]>>): string {
  return JSON.stringify({
    version: 7,
    measurements: [],
    legacyMeasurements: [],
    annotations: [],
    obbAnnotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    ...parts,
  });
}

describe('parseLayeredPayload', () => {
  it('只认 version 7；缺省字段当空数组；非数组字段 / 坏 JSON / 非 7 → null', () => {
    expect(parseLayeredPayload(JSON.stringify({ version: 7, annotations: [{ id: 'a' }] }))?.annotations).toEqual([{ id: 'a' }]);
    expect(parseLayeredPayload(JSON.stringify({ version: 7 }))?.cloudAnnotations).toEqual([]);
    expect(parseLayeredPayload(JSON.stringify({ version: 7, annotations: 'nope' }))).toBeNull();
    expect(parseLayeredPayload(JSON.stringify({ version: 6, annotations: [] }))).toBeNull();
    expect(parseLayeredPayload('{not json')).toBeNull();
    expect(parseLayeredPayload(null)).toBeNull();
    expect(parseLayeredPayload('')).toBeNull();
  });
});

describe('mergeConfirmedReplayWithLocalDrafts（草稿 / 已确认分层）', () => {
  it('本机 id 不在已确认层的条目保留（排在已确认之后）；同 id 的被已确认层覆盖', () => {
    const confirmed = v7({
      annotations: [{ id: 'a-1', title: '服务端版本' }],
      cloudAnnotations: [{ id: 'c-1', title: 'cloud confirmed' }],
    });
    const local = v7({
      annotations: [{ id: 'a-1', title: '本机改过的旧副本' }, { id: 'a-draft', title: '本机草稿' }],
      cloudAnnotations: [{ id: 'c-draft' }],
      rectAnnotations: [{ id: 'r-draft' }],
      measurements: [{ id: 'm-draft', kind: 'distance' }],
    });

    const result = mergeConfirmedReplayWithLocalDrafts(confirmed, local);
    type Item = { id: string; title?: string };
    const merged = JSON.parse(result.payload) as {
      annotations: Item[]; cloudAnnotations: Item[]; rectAnnotations: Item[]; obbAnnotations: Item[]; measurements: Item[];
    };

    expect(merged.annotations).toEqual([{ id: 'a-1', title: '服务端版本' }, { id: 'a-draft', title: '本机草稿' }]);
    expect(merged.cloudAnnotations.map((c) => c.id)).toEqual(['c-1', 'c-draft']);
    expect(merged.rectAnnotations.map((r) => r.id)).toEqual(['r-draft']);
    expect(merged.measurements.map((m) => m.id)).toEqual(['m-draft']);
    expect(merged.obbAnnotations).toEqual([]);
    expect(result.keptDrafts).toEqual({
      measurements: 1, legacyMeasurements: 0, annotations: 1, obbAnnotations: 0, cloudAnnotations: 1, rectAnnotations: 1,
    });
    expect(countKeptDrafts(result)).toBe(4);
    expect(result.overriddenByConfirmed).toBe(1);
    expect(result.localPayloadIgnored).toBe(false);
  });

  it('已确认层为空（任务还没确认过）：本机草稿全部保留——不再 clearAll', () => {
    const result = mergeConfirmedReplayWithLocalDrafts(v7({}), v7({ annotations: [{ id: 'a-draft' }] }));
    expect(JSON.parse(result.payload).annotations).toEqual([{ id: 'a-draft' }]);
    expect(countKeptDrafts(result)).toBe(1);
  });

  it('本机没有草稿：合并结果就是已确认回放本身', () => {
    const confirmed = v7({ annotations: [{ id: 'a-1' }] });
    const result = mergeConfirmedReplayWithLocalDrafts(confirmed, v7({}));
    expect(JSON.parse(result.payload)).toEqual(JSON.parse(confirmed));
    expect(countKeptDrafts(result)).toBe(0);
  });

  it('本机 payload 解析不了 / 不是 V7：只回放已确认层并标 localPayloadIgnored', () => {
    const confirmed = v7({ annotations: [{ id: 'a-1' }] });
    for (const bad of ['{broken', JSON.stringify({ version: 6, annotations: [{ id: 'x' }] }), null, '']) {
      const result = mergeConfirmedReplayWithLocalDrafts(confirmed, bad);
      expect(result.payload).toBe(confirmed);
      expect(result.localPayloadIgnored).toBe(true);
      expect(countKeptDrafts(result)).toBe(0);
    }
  });

  it('没有 id 的本机条目当草稿保留；id 只比 trim 后的字串', () => {
    const confirmed = v7({ annotations: [{ id: 'a-1' }] });
    const local = v7({ annotations: [{ title: '无 id' }, { id: ' a-1 ' }, { id: 42 }] });
    const merged = JSON.parse(mergeConfirmedReplayWithLocalDrafts(confirmed, local).payload);
    expect(merged.annotations).toEqual([{ id: 'a-1' }, { title: '无 id' }, { id: 42 }]);
  });

  it('不改任一条目内容（不 normalize）：条目原样进出', () => {
    const weird = { id: 'a-draft', createdAt: 'not-a-number', extra: { nested: true } };
    const merged = JSON.parse(mergeConfirmedReplayWithLocalDrafts(v7({}), v7({ annotations: [weird] })).payload);
    expect(merged.annotations[0]).toEqual(weird);
  });
});
