import { afterEach, describe, expect, it, vi } from 'vitest';

import fc from 'fast-check';
import { Box3, PerspectiveCamera, Vector2, Vector3 } from 'three';

import { createModelUnitCompareController, type BrowseFrameDetail, type ModelUnitCompareHost } from './modelUnitCompareController';

import type { DTXLayer } from '@/utils/three/dtx';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

/**
 * Property 14: 相同 geometryKey 不重装（tasks.md 14.7）。
 *
 * Feature: model-version-timeline-scrub, Property 14: 相同 geometryKey 不重装
 *
 * *For any* 送入 `browseShow` 的帧序列，控制器重建隔离图层几何的次数等于序列中相邻两帧 `geometryKey` 不同
 * （或任一为空）的次数，其余只更新角标。
 *
 * 判定口径（与实现一致）：一帧里某个单元「要不要重装」只看**该单元自己**上一次装进去的键。所以属性按单元逐条成立：
 * 某个单元的装载次数 = 1（首次）+ 它后续每一次键与上一次不同（含上一次为空）的次数。
 */

type FakeObject = { id: string; visible: boolean; box: Box3 };

class FakeLayer {
  objects = new Map<string, FakeObject>();
  disposed = false;
  getAllObjectIds(): string[] { return [...this.objects.keys()]; }
  getVisibleObjectIds(): string[] { return [...this.objects.values()].filter((o) => o.visible).map((o) => o.id); }
  isObjectVisible(id: string): boolean { return this.objects.get(id)?.visible ?? false; }
  setObjectVisible(id: string, visible: boolean): void { const o = this.objects.get(id); if (o) o.visible = visible; }
  setObjectsVisible(ids: string[], visible: boolean): void { for (const id of ids) this.setObjectVisible(id, visible); }
  setAllVisible(visible: boolean): void { for (const o of this.objects.values()) o.visible = visible; }
  getObjectBoundingBoxInto(id: string, target: Box3): Box3 | null {
    const o = this.objects.get(id);
    return o ? target.copy(o.box) : null;
  }
  getBoundingBox(): Box3 | null {
    const box = new Box3();
    for (const o of this.objects.values()) box.union(o.box);
    return box.isEmpty() ? null : box;
  }
  raycastObject(): null { return null; }
  setObjectMaterial(): void { /* 属性测试不看着色 */ }
  dispose(): void { this.disposed = true; }
  asLayer(): DTXLayer { return this as unknown as DTXLayer; }
}

function fakeViewer(): DtxViewer {
  const camera = new PerspectiveCamera(50, 2, 0.1, 1000);
  camera.position.set(10, 10, 10);
  return {
    camera,
    controls: { target: new Vector3(), enabled: true, update: vi.fn() },
    renderer: { getContext: () => null, getSize: (v: Vector2) => v.set(800, 400), render: vi.fn() },
    scene: {},
    flyTo: vi.fn(),
    fitClipPlanesToBox: vi.fn(),
  } as unknown as DtxViewer;
}

function makeHarness() {
  const viewer = fakeViewer();
  const primary = new FakeLayer();
  for (const refno of ['1_2', '1_3']) {
    primary.objects.set(`o:${refno}:0`, { id: `o:${refno}:0`, visible: true, box: new Box3(new Vector3(), new Vector3(1, 1, 1)) });
  }
  const created: FakeLayer[] = [];
  /** 每次 `loadInstances` 带 `unit-browse:` 前缀的调用 = 一次单元重装 */
  const loads: { unitRefno: string; refnos: string[] }[] = [];
  const host: ModelUnitCompareHost = {
    viewer: () => viewer,
    primaryLayer: () => primary.asLayer(),
    createLayer: () => { const layer = new FakeLayer(); created.push(layer); return layer.asLayer(); },
    attachLayer: () => undefined,
    forgetLayer: () => undefined,
    loadInstances: vi.fn(async (layer, _dbnum, refnos, options) => {
      const prefix = options.objectIdPrefix ?? '';
      if (prefix.startsWith('unit-browse:')) {
        loads.push({ unitRefno: prefix.slice('unit-browse:'.length), refnos: [...refnos] });
      }
      const fake = layer as unknown as FakeLayer;
      for (const refno of refnos) {
        const id = `${prefix}:${refno}:0`;
        fake.objects.set(id, { id, visible: true, box: new Box3(new Vector3(), new Vector3(1, 1, 1)) });
      }
      return { loadedObjects: refnos.length };
    }),
    resolve: {
      refnoByObjectId: (_dbnum, objectId) => objectId.split(':')[1] ?? null,
      objectIdsByRefno: () => [],
      objectIdsByUnitRefno: () => [],
    },
    normalizeRefno: (raw) => String(raw ?? '').trim().replace('/', '_'),
    requestRender: vi.fn(),
    toast: vi.fn(),
    beforeSplit: vi.fn(),
    fitToBox: vi.fn(),
    renderOverlay: vi.fn(),
    selection: {
      clearSelection: vi.fn(),
      setSelectedRefno: vi.fn(),
      setSelectedDeletedRefno: vi.fn(),
      setSelectedRefnoAtVersion: vi.fn(),
      hasVersionPin: () => false,
      selectedIsDeleted: () => false,
      selectedRefno: () => null,
    },
    isDev: false,
  };
  return { controller: createModelUnitCompareController(host), loads, created, viewer };
}

/** 一帧：单元的 `geometryKey` 可能是 null（服务端没给摘要，等同于「一定重装」）。 */
const frameArb: fc.Arbitrary<{ sesno: number; keys: (string | null)[] }> = fc.record({
  sesno: fc.integer({ min: 1, max: 400 }),
  keys: fc.array(fc.option(fc.constantFrom('g:aaa', 'g:bbb', 'g:ccc'), { nil: null }), { minLength: 1, maxLength: 3 }),
});

describe('Property 14: 相同 geometryKey 不重装', () => {
  let harness: ReturnType<typeof makeHarness> | null = null;
  afterEach(() => { harness = null; });

  // Feature: model-version-timeline-scrub, Property 14
  it('任意帧序列：某单元的装载次数 = 1 + 它后续每次键与上一次不同（含上一次为空）的次数', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(frameArb, { minLength: 1, maxLength: 12 }), async (frames) => {
        const h = harness = makeHarness();
        const unitCount = Math.max(...frames.map((f) => f.keys.length));
        h.controller.browseEnter({
          dbnum: 8000,
          unitRefnos: Array.from({ length: unitCount }, (_, i) => `1_${i + 1}`),
        });

        const lastKey = new Map<string, string | null>();
        let expected = 0;
        for (const frame of frames) {
          const detail: BrowseFrameDetail = {
            dbnum: 8000,
            sesno: frame.sesno,
            sessionTime: null,
            units: frame.keys.map((key, i) => {
              const unitRefno = `1_${i + 1}`;
              const previous = lastKey.get(unitRefno);
              const mustReload = previous === undefined || key === null || previous === null || previous !== key;
              if (mustReload) expected += 1;
              lastKey.set(unitRefno, key);
              return { unitRefno, geometryKey: key, entries: new Map([[`1_${i + 10}`, []]]) };
            }),
          };
          await h.controller.browseShow(detail);
          // 角标跟着每一帧走：即使一个对象都没重装
          expect(h.controller.browse.value.sesno).toBe(frame.sesno);
        }

        expect(h.loads).toHaveLength(expected);
        // 每个单元的装载次数也各自对得上
        for (let i = 0; i < unitCount; i += 1) {
          const unitRefno = `1_${i + 1}`;
          let unitExpected = 0;
          let previous: string | null | undefined;
          for (const frame of frames) {
            const key = frame.keys[i];
            if (key === undefined) continue;
            if (previous === undefined || key === null || previous === null || previous !== key) unitExpected += 1;
            previous = key;
          }
          expect(h.loads.filter((load) => load.unitRefno === unitRefno)).toHaveLength(unitExpected);
        }
      }),
      { numRuns: 100 },
    );
  });
});
