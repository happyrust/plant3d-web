import { describe, expect, it } from 'vitest';

import {
  BINDING_RESOLVE_REASONS,
  buildBindingResolveKey,
  classifyBinding,
  getBindingResolveDisplay,
  isAnchorOutsideAabb,
  summarizeBindingResolve,
  type BindingResolveProbe,
} from './bindingResolve';

function probe(overrides: Partial<BindingResolveProbe> = {}): BindingResolveProbe {
  return {
    isLoaded: () => false,
    isKnown: () => false,
    isVerifiedMissing: () => false,
    ...overrides,
  };
}

describe('classifyBinding（ADR-0050 四态）', () => {
  it('几何已加载 → resolved（不带 reason）', () => {
    const entry = classifyBinding({ refno: '=1/1', role: 'member' }, probe({ isLoaded: () => true }), 42);
    expect(entry).toEqual({ state: 'resolved', checkedAt: 42 });
  });

  it('未加载但索引认识 → unloaded，reason 说「尚未加载」', () => {
    const entry = classifyBinding({ refno: '=1/1', role: 'member' }, probe({ isKnown: () => true }), 1);
    expect(entry.state).toBe('unloaded');
    expect(entry.reason).toBe(BINDING_RESOLVE_REASONS.unloadedKnown);
  });

  it('未加载且索引不认识 → 仍是 unloaded，但 reason 明说「存在性未验证」，不擅判 missing', () => {
    const entry = classifyBinding({ refno: '=1/1', role: 'member' }, probe(), 1);
    expect(entry.state).toBe('unloaded');
    expect(entry.reason).toBe(BINDING_RESOLVE_REASONS.unloadedUnknown);
  });

  it('有权威 missing 证据 → missing，优先级高于 loaded / known', () => {
    const entry = classifyBinding(
      { refno: '=1/1', role: 'member' },
      probe({ isLoaded: () => true, isKnown: () => true, isVerifiedMissing: () => true }),
      1,
    );
    expect(entry.state).toBe('missing');
    expect(entry.reason).toBe(BINDING_RESOLVE_REASONS.missing);
  });

  it('anchor 已加载且锚点漂离包围盒 → stale；member 不判漂移；无法判断（null）→ resolved', () => {
    const drifted = classifyBinding(
      { refno: '=1/1', role: 'anchor', anchorWorldPos: [0, 0, 0] },
      probe({ isLoaded: () => true, anchorDrift: () => true }),
      1,
    );
    expect(drifted.state).toBe('stale');
    expect(drifted.reason).toBe(BINDING_RESOLVE_REASONS.stale);

    const member = classifyBinding(
      { refno: '=1/1', role: 'member', anchorWorldPos: [0, 0, 0] },
      probe({ isLoaded: () => true, anchorDrift: () => true }),
      1,
    );
    expect(member.state).toBe('resolved');

    const unknownDrift = classifyBinding(
      { refno: '=1/1', role: 'anchor', anchorWorldPos: [0, 0, 0] },
      probe({ isLoaded: () => true, anchorDrift: () => null }),
      1,
    );
    expect(unknownDrift.state).toBe('resolved');
  });

  it('missing 的 reason 可拼上探针给的具体证据（定位回执错误文本）；空白 / 缺失时只出默认句', () => {
    const withDetail = classifyBinding(
      { refno: '=1/1', role: 'member' },
      probe({ isVerifiedMissing: () => true, missingReason: () => '  HTTP 404 model unit not found ' }),
      1,
    );
    expect(withDetail.reason).toBe(`${BINDING_RESOLVE_REASONS.missing}：HTTP 404 model unit not found`);

    const blank = classifyBinding(
      { refno: '=1/1', role: 'member' },
      probe({ isVerifiedMissing: () => true, missingReason: () => '   ' }),
      1,
    );
    expect(blank.reason).toBe(BINDING_RESOLVE_REASONS.missing);

    const asked: string[] = [];
    classifyBinding(
      { refno: '=1/1', role: 'member' },
      probe({ isVerifiedMissing: () => false, missingReason: (r) => { asked.push(r); return 'never'; } }),
      1,
    );
    expect(asked).toEqual([]);
  });

  it('refno 首尾空白在探针前被裁掉', () => {
    const seen: string[] = [];
    classifyBinding({ refno: '  =1/1 ', role: 'member' }, probe({ isLoaded: (r) => { seen.push(r); return true; } }), 1);
    expect(seen).toEqual(['=1/1']);
  });
});

describe('isAnchorOutsideAabb', () => {
  const box = { min: [0, 0, 0], max: [1000, 1000, 1000] };

  it('盒内与外扩带内都不算漂离；外扩量 = max(25% 对角线, minPad)', () => {
    expect(isAnchorOutsideAabb([500, 500, 500], box)).toBe(false);
    // 对角线 ≈ 1732，25% ≈ 433：1400 仍在带内
    expect(isAnchorOutsideAabb([1400, 500, 500], box)).toBe(false);
    expect(isAnchorOutsideAabb([1500, 500, 500], box)).toBe(true);
  });

  it('接受 scene.getAABB 的平铺 6 元数组', () => {
    expect(isAnchorOutsideAabb([500, 500, 500], [0, 0, 0, 1000, 1000, 1000])).toBe(false);
    expect(isAnchorOutsideAabb([-5000, 0, 0], [0, 0, 0, 1000, 1000, 1000])).toBe(true);
  });

  it('包围盒缺失 / 退化 / 坐标非法 → null，不判', () => {
    expect(isAnchorOutsideAabb([0, 0, 0], null)).toBeNull();
    expect(isAnchorOutsideAabb([0, 0, 0], [0, 0, 0])).toBeNull();
    expect(isAnchorOutsideAabb([0, 0, 0], { min: [0, 0, 0], max: [-1, 0, 0] })).toBeNull();
    expect(isAnchorOutsideAabb([Number.NaN, 0, 0], box)).toBeNull();
  });

  it('小构件用 minPad 兜底，点状包围盒旁 50 单位不算漂离', () => {
    expect(isAnchorOutsideAabb([50, 0, 0], { min: [0, 0, 0], max: [1, 1, 1] })).toBe(false);
    expect(isAnchorOutsideAabb([150, 0, 0], { min: [0, 0, 0], max: [1, 1, 1] })).toBe(true);
  });
});

describe('summarizeBindingResolve / getBindingResolveDisplay / buildBindingResolveKey', () => {
  it('汇总四态并算可用数（resolved + unloaded）', () => {
    const summary = summarizeBindingResolve([
      { state: 'resolved', checkedAt: 1 },
      { state: 'unloaded', checkedAt: 1 },
      { state: 'missing', checkedAt: 1 },
      { state: 'stale', checkedAt: 1 },
      undefined,
    ]);
    expect(summary).toEqual({ total: 4, resolved: 1, unloaded: 1, missing: 1, stale: 1, usable: 2 });
  });

  it('resolved 不出徽标且可定位；missing 出徽标且不可定位；unloaded / stale 出徽标仍可定位', () => {
    expect(getBindingResolveDisplay('resolved')).toMatchObject({ showBadge: false, canLocate: true });
    expect(getBindingResolveDisplay('missing')).toMatchObject({ showBadge: true, canLocate: false });
    expect(getBindingResolveDisplay('unloaded')).toMatchObject({ showBadge: true, canLocate: true });
    expect(getBindingResolveDisplay('stale')).toMatchObject({ showBadge: true, canLocate: true, label: expect.stringContaining('STALE') });
  });

  it('索引键含类型、记录、角色与裁边后的 refno', () => {
    expect(buildBindingResolveKey('cloud', 'c1', 'anchor', ' =1/1 ')).toBe('cloud:c1:anchor:=1/1');
  });
});
