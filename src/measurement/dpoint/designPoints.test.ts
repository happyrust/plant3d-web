import { describe, expect, it } from 'vitest';

import { designPointHostChain, loadDesignPointsOfHost, type DesignPointLoaderDeps } from './designPointLoader';
import {
  designPointLocalDirection,
  designPointToWorld,
  isDesignPointHostStop,
  oriRotationColumns,
  parseDesignPointAttributes,
  parseE3dTriple,
} from './designPoints';

const close = (actual: readonly number[], expected: readonly number[], digits = 9): void => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, digits));
};

describe('parseE3dTriple', () => {
  it('reads number arrays, gen-model display strings and PDMS letter strings', () => {
    expect(parseE3dTriple([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseE3dTriple('0, 0, -86')).toEqual([0, 0, -86]);
    expect(parseE3dTriple('2600, -125, 500')).toEqual([2600, -125, 500]);
    expect(parseE3dTriple('E 100mm N 200mm U -86mm')).toEqual([100, 200, -86]);
    expect(parseE3dTriple('W 5mm S 2.5mm D 1mm')).toEqual([-5, -2.5, -1]);
    expect(parseE3dTriple('N 7mm U 1mm E 3mm')).toEqual([3, 7, 1]);
  });

  it('rejects incomplete or duplicated axes', () => {
    expect(parseE3dTriple('1, 2')).toBeNull();
    expect(parseE3dTriple('E 1mm E 2mm N 3mm')).toBeNull();
    expect(parseE3dTriple('')).toBeNull();
    expect(parseE3dTriple(undefined)).toBeNull();
  });
});

describe('parseDesignPointAttributes / oriRotationColumns', () => {
  it('takes NUMB / POS / ORI from the uiAttr map (real DPCA 23714/1127 shape)', () => {
    const parsed = parseDesignPointAttributes({
      BORE: 0, DCON: '', NUMB: '1', ORI: '0, 0, 0', OWNER: '23714/1126', POS: '0, 0, -86', TYPE: 'DPCA',
    });
    expect(parsed).toEqual({ number: 1, positionMm: [0, 0, -86], oriDeg: [0, 0, 0] });
    expect(parseDesignPointAttributes({ NUMB: '12', POS: [2600, -125, 500] })).toEqual({
      number: 12, positionMm: [2600, -125, 500], oriDeg: [0, 0, 0],
    });
    expect(parseDesignPointAttributes({ NUMB: 'x', POS: '0, 0, 0' })).toBeNull();
    expect(parseDesignPointAttributes({ NUMB: '1' })).toBeNull();
  });

  it('composes the stored ORI as Rz · Ry · Rx (angles_to_ori) and takes Z as the direction', () => {
    close(designPointLocalDirection([0, 0, 0]), [0, 0, 1]);
    // rotation about Z leaves Z alone (EQUI-style ORI (0, 0, -25))
    close(designPointLocalDirection([0, 0, -25]), [0, 0, 1]);
    // Rx(90): Z → -Y (south)
    close(designPointLocalDirection([90, 0, 0]), [0, -1, 0]);
    // Ry(90): Z → +X (east)
    close(designPointLocalDirection([0, 90, 0]), [1, 0, 0]);
    // Rz(90) · Ry(90): Z → +X → +Y
    close(designPointLocalDirection([0, 90, 90]), [0, 1, 0]);
    const [x, y, z] = oriRotationColumns([30, -45, 60]);
    // orthonormal right-handed
    expect(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]).toBeCloseTo(0, 12);
    expect(Math.hypot(...z)).toBeCloseTo(1, 12);
    close([
      x[1] * y[2] - x[2] * y[1],
      x[2] * y[0] - x[0] * y[2],
      x[0] * y[1] - x[1] * y[0],
    ], z);
  });
});

describe('designPointToWorld (DPPS / DPDI through the host world_transform)', () => {
  it('maps POS and the ORI Z axis with a column-major mm matrix', () => {
    // host rotated 90° about Z and moved to (1000, 2000, 3000)
    const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1000, 2000, 3000, 1];
    const world = designPointToWorld({ number: 3, positionMm: [100, 0, -86], oriDeg: [0, 90, 0] }, m);
    expect(world.number).toBe(3);
    close(world.positionMm, [1000, 2100, 2914]);
    // local Z → +X (Ry 90) → world +Y (Rz 90)
    close(world.direction!, [0, 1, 0]);
  });

  it('is the identity without a transform', () => {
    const world = designPointToWorld({ number: 1, positionMm: [0, 0, -86], oriDeg: [0, 0, 0] }, null);
    expect(world.positionMm).toEqual([0, 0, -86]);
    expect(world.direction).toEqual([0, 0, 1]);
  });
});

describe('designPointHostChain / loadDesignPointsOfHost', () => {
  const nodes: Record<string, { noun: string; owner?: string; children?: string[] }> = {
    '23714_1112': { noun: 'DDSE', owner: '23714_1111' },
    '23714_1123': { noun: 'FRMW', owner: '23714_1111', children: ['23714_1124'] },
    '23714_1124': { noun: 'SBFR', owner: '23714_1123', children: ['23714_1125'] },
    '23714_1125': { noun: 'SCTN', owner: '23714_1124' },
    '23714_1126': { noun: 'DPSE', owner: '23714_1111', children: ['23714_1127', '23714_1128'] },
    '23714_1127': { noun: 'DPCA', owner: '23714_1126' },
    '23714_1128': { noun: 'DPCY', owner: '23714_1126' },
    '23714_1111': { noun: 'STRU', owner: '23714_1110', children: ['23714_1112', '23714_1123', '23714_1126'] },
    '23714_1110': { noun: 'ZONE', owner: '23714_1', children: ['23714_1111'] },
    '23714_1': { noun: 'SITE', owner: '15522_0' },
    '15522_0': { noun: 'WORL' },
  };
  const attrs: Record<string, Record<string, unknown>> = {
    '23714_1127': { NUMB: '1', POS: '0, 0, -86', ORI: '0, 0, 0', PURP: 'CATT' },
    '23714_1128': { NUMB: '2', POS: '500, 0, 0', ORI: '0, 90, 0', PURP: '' },
  };
  const calls: string[] = [];
  const deps: DesignPointLoaderDeps = {
    tree: {
      async node(refno) {
        calls.push(`node:${refno}`);
        const entry = nodes[refno];
        return entry
          ? { success: true, node: { refno, name: refno, noun: entry.noun, owner: entry.owner ?? null } }
          : { success: false, node: null, error_message: 'missing' };
      },
      async children(refno) {
        calls.push(`children:${refno}`);
        const entry = nodes[refno];
        return {
          success: Boolean(entry),
          parent_refno: refno,
          children: (entry?.children ?? []).map((child) => ({ refno: child, name: child, noun: nodes[child]!.noun, owner: refno })),
          truncated: false,
        };
      },
      async ancestors(refno) {
        calls.push(`ancestors:${refno}`);
        const chain: string[] = [];
        let current = nodes[refno]?.owner;
        while (current) {
          chain.push(current);
          current = nodes[current]?.owner;
        }
        return { success: true, refnos: chain };
      },
    },
    attributes: {
      async uiAttr(refno) {
        calls.push(`uiAttr:${refno}`);
        const entry = attrs[refno];
        return entry ? { success: true, refno, attrs: entry } : { success: false, refno, attrs: {}, error_message: 'no attrs' };
      },
    },
    keypoints: {
      async ptset(_dbno, refno) {
        calls.push(`ptset:${refno}`);
        return {
          success: false,
          refno,
          ptset: [],
          world_transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1],
          error_code: 'PTSET_POINTS_MISSING',
        };
      },
    },
  };

  it('walks from the leaf up to the first administrative level, nearest host first', async () => {
    calls.length = 0;
    const hosts = await designPointHostChain('23714_1125', deps.tree);
    expect(hosts).toEqual([
      { refno: '23714_1125', noun: 'SCTN' },
      { refno: '23714_1124', noun: 'SBFR' },
      { refno: '23714_1123', noun: 'FRMW' },
      { refno: '23714_1111', noun: 'STRU' },
    ]);
    expect(calls.filter((call) => call.startsWith('node:'))).toEqual([
      'node:23714_1125', 'node:23714_1124', 'node:23714_1123', 'node:23714_1111', 'node:23714_1110',
    ]);
    expect(await designPointHostChain('23714_1110', deps.tree)).toEqual([]);
    expect(isDesignPointHostStop('zone')).toBe(true);
    expect(isDesignPointHostStop('EQUI')).toBe(false);
  });

  it('reuses a shared noun cache so a second leaf under the same owners re-reads only itself', async () => {
    const cache = new Map<string, string | null>();
    calls.length = 0;
    await designPointHostChain('23714_1125', deps.tree, cache);
    expect(calls.filter((call) => call.startsWith('node:'))).toHaveLength(5);
    calls.length = 0;
    // Another leaf under the same STRU: only itself and its own set are new; STRU and the ZONE stop are known.
    const hosts = await designPointHostChain('23714_1128', deps.tree, cache);
    expect(calls.filter((call) => call.startsWith('node:'))).toEqual(['node:23714_1128', 'node:23714_1126']);
    expect(hosts.map((host) => host.refno)).toEqual(['23714_1128', '23714_1126', '23714_1111']);
  });

  it('does not list the leaf twice when the ancestors port echoes it in the other refno spelling', async () => {
    // gen-model-v1 `tree.ancestors` starts the chain with the element itself, spelled `a_b`; the hover hands
    // the loader `a/b` (or vice versa) — the leaf must still appear once, nearest first.
    const echoing = {
      ...deps.tree,
      async ancestors(refno: string) {
        const base = await deps.tree.ancestors(refno.replace(/\//g, '_'));
        return { ...base, refnos: [refno.replace(/\//g, '_'), ...base.refnos] };
      },
      async node(refno: string) {
        return deps.tree.node(refno.replace(/\//g, '_'));
      },
    };
    const hosts = await designPointHostChain('23714/1125', echoing);
    expect(hosts.map((host) => host.refno)).toEqual(['23714/1125', '23714_1124', '23714_1123', '23714_1111']);
  });

  it('collects DPSE → DPCA / DPCY of a host, mapped through its world_transform, sorted by NUMB', async () => {
    calls.length = 0;
    const result = await loadDesignPointsOfHost({ refno: '23714_1111', noun: 'STRU' }, deps);
    expect(result.errors).toEqual([]);
    expect(result.points).toHaveLength(2);
    const [p1, p2] = result.points;
    expect(p1).toMatchObject({
      hostRefno: '23714_1111', hostNoun: 'STRU', setRefno: '23714_1126', pointRefno: '23714_1127',
      pointNoun: 'DPCA', number: 1, purpose: 'CATT',
    });
    close(p1!.worldMm, [10, 20, -56]);
    close(p1!.direction!, [0, 0, 1]);
    expect(p2).toMatchObject({ pointNoun: 'DPCY', number: 2, purpose: null });
    close(p2!.worldMm, [510, 20, 30]);
    close(p2!.direction!, [1, 0, 0]);
    // one children call for the host, one per set, one ptset for the transform, one uiAttr per point
    expect(calls).toEqual([
      'children:23714_1111', 'ptset:23714_1111', 'children:23714_1126', 'uiAttr:23714_1127', 'uiAttr:23714_1128',
    ]);
  });

  it('returns no points (and no transform call) for hosts without a DPSE, and errors instead of throwing', async () => {
    calls.length = 0;
    const none = await loadDesignPointsOfHost({ refno: '23714_1123', noun: 'FRMW' }, deps);
    expect(none).toEqual({ points: [], errors: [] });
    expect(calls).toEqual(['children:23714_1123']);

    const failing: DesignPointLoaderDeps = {
      ...deps,
      tree: { ...deps.tree, async children() { throw new Error('offline'); } },
    };
    const failed = await loadDesignPointsOfHost({ refno: '23714_1111', noun: 'STRU' }, failing);
    expect(failed.points).toEqual([]);
    expect(failed.errors).toEqual(['offline']);
  });
});
