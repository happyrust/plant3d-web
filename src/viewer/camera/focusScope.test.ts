import { describe, expect, it, vi } from 'vitest';

import { __resetCameraIntentForTests, currentCameraIntent } from './cameraIntent';
import { flyToScope, resolveFocusScope } from './focusScope';

import type { Aabb6, DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

const BOX: Aabb6 = [0, 0, 0, 10, 10, 10];

type FakeViewer = {
  viewer: DtxCompatViewer;
  flyTo: ReturnType<typeof vi.fn>;
  getAABB: ReturnType<typeof vi.fn>;
  getSubtreeAABB: ReturnType<typeof vi.fn>;
  objects: Record<string, { id: string }>;
};

function fakeViewer(options: {
  direct?: Aabb6 | null;
  subtree?: Aabb6 | null;
  objects?: string[];
} = {}): FakeViewer {
  const objects: Record<string, { id: string }> = {};
  for (const refno of options.objects ?? []) objects[refno] = { id: refno };

  const flyTo = vi.fn();
  const getAABB = vi.fn(() => (options.direct === undefined ? null : options.direct));
  const getSubtreeAABB = vi.fn(() => (options.subtree === undefined ? null : options.subtree));

  const viewer = {
    scene: { objects, getAABB, getSubtreeAABB },
    cameraFlight: { flyTo },
  } as unknown as DtxCompatViewer;

  return { viewer, flyTo, getAABB, getSubtreeAABB, objects };
}

describe('resolveFocusScope', () => {
  it('没有 viewer 就是 no-viewer', async () => {
    const result = await resolveFocusScope(null, { refnos: ['1_2'], source: 'tree' });
    expect(result).toEqual({ ok: false, reason: 'no-viewer' });
  });

  it('既没有 refnos 也没有 scopeRefnos 就是 no-target', async () => {
    const h = fakeViewer();
    const result = await resolveFocusScope(h.viewer, { source: 'tree' });
    expect(result).toEqual({ ok: false, reason: 'no-target' });
  });

  it('构件自己的对象能算出来就用 direct，不查子树', async () => {
    const h = fakeViewer({ direct: BOX });
    const result = await resolveFocusScope(h.viewer, { refnos: ['1_2'], source: 'toolbar' });
    expect(result).toEqual({ ok: true, aabb: BOX, refnos: ['1_2'], via: 'direct' });
    expect(h.getSubtreeAABB).not.toHaveBeenCalled();
  });

  it('构件没几何时退到子树并集（SITE / ZONE / PIPE 这一档）', async () => {
    const h = fakeViewer({ direct: null, subtree: BOX });
    const result = await resolveFocusScope(h.viewer, {
      refnos: ['24384_24776'],
      scopeRefnos: ['24384_24776'],
      source: 'tree',
    });
    expect(result).toEqual({ ok: true, aabb: BOX, refnos: ['24384_24776'], via: 'subtree-aabb' });
  });

  it('只有 scopeRefno 也能靠子树并集定位（属主树静默不动那条路）', async () => {
    const h = fakeViewer({ subtree: BOX });
    const result = await resolveFocusScope(h.viewer, { scopeRefnos: ['100_1'], source: 'tree' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.via).toBe('subtree-aabb');
  });

  it('三级都空就回 no-geometry，不静默返回成功', async () => {
    const h = fakeViewer({ direct: null, subtree: null });
    const result = await resolveFocusScope(h.viewer, { refnos: ['1_2'], source: 'tree' });
    expect(result).toEqual({ ok: false, reason: 'no-geometry' });
  });

  it('允许查子树清单时，查回来的 refno 有几何就能定位', async () => {
    const h = fakeViewer({ direct: null, subtree: null });
    // 第一次 getAABB 给 null（原始 refnos），第二次给盒（查回来的成员）
    h.getAABB.mockReturnValueOnce(null).mockReturnValueOnce(BOX);
    const lookup = vi.fn(async () => ['1_2', '1_3']);
    const result = await resolveFocusScope(h.viewer, {
      refnos: ['1_2'],
      allowSubtreeQuery: true,
      lookupSubtreeRefnos: lookup,
      source: 'tree',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.via).toBe('subtree-query');
      expect(result.refnos).toEqual(['1_2', '1_3']);
    }
    expect(lookup).toHaveBeenCalledWith('1_2');
  });

  it('子树查询抛错不把异常甩给调用方，落到 no-geometry', async () => {
    const h = fakeViewer({ direct: null, subtree: null });
    const lookup = vi.fn(async () => {
      throw new Error('subtree 500');
    });
    const result = await resolveFocusScope(h.viewer, {
      refnos: ['1_2'],
      allowSubtreeQuery: true,
      lookupSubtreeRefnos: lookup,
      source: 'tree',
    });
    expect(result).toEqual({ ok: false, reason: 'no-geometry' });
  });
});

describe('flyToScope', () => {
  it('解析成功才飞，并登记一次相机意图', async () => {
    __resetCameraIntentForTests();
    const h = fakeViewer({ direct: BOX });
    const before = currentCameraIntent();
    const result = await flyToScope(h.viewer, { refnos: ['1_2'], source: 'toolbar' });
    expect(result.ok).toBe(true);
    expect(h.flyTo).toHaveBeenCalledTimes(1);
    expect(h.flyTo).toHaveBeenCalledWith({ aabb: BOX, duration: 0.8, fit: true });
    expect(currentCameraIntent()).toBeGreaterThan(before);
  });

  it('解析失败不飞也不登记意图', async () => {
    __resetCameraIntentForTests();
    const h = fakeViewer({ direct: null, subtree: null });
    const before = currentCameraIntent();
    const result = await flyToScope(h.viewer, { refnos: ['1_2'], source: 'toolbar' });
    expect(result.ok).toBe(false);
    expect(h.flyTo).not.toHaveBeenCalled();
    expect(currentCameraIntent()).toBe(before);
  });
});
