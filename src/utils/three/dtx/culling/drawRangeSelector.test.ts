import { describe, expect, it } from 'vitest';

import { OrthographicCamera, PerspectiveCamera } from 'three';

import {
  drawRangeViewFromCamera,
  selectDrawRanges,
  type DrawRangeInput,
  type DrawRangeOutput,
} from './drawRangeSelector';

type Obj = { x: number; y: number; z: number; r: number; tris: number; visible?: boolean };

/** 构件按顺序首尾相接排三角形；gapTris 在每个构件后面插多少个「别人的」三角形 */
function build(objs: Obj[], camera: PerspectiveCamera | OrthographicCamera, opts: { minPx?: number; heightPx?: number; gap?: number } = {}): {
  input: DrawRangeInput;
  out: DrawRangeOutput;
} {
  const n = objs.length;
  const spheres = new Float32Array(n * 4);
  const triStart = new Uint32Array(n);
  const triCount = new Uint32Array(n);
  const flags = new Uint8Array(n * 16);
  let cursor = 0;
  objs.forEach((o, i) => {
    spheres.set([o.x, o.y, o.z, o.r], i * 4);
    triStart[i] = cursor;
    triCount[i] = o.tris;
    cursor += o.tris;
    flags[i * 16 + 2] = o.visible === false ? 0 : 1;
  });
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return {
    input: {
      objectCount: n,
      spheres,
      triStart,
      triCount,
      visibleFlags: flags,
      visibleStride: 16,
      visibleOffset: 2,
      view: drawRangeViewFromCamera(camera),
      viewportHeightPx: opts.heightPx ?? 1000,
      minPx: opts.minPx ?? 0,
      mergeGapTriangles: opts.gap,
    },
    out: { starts: new Int32Array(Math.max(1, n)), counts: new Int32Array(Math.max(1, n)) },
  };
}

function perspective(): PerspectiveCamera {
  // 相机在原点看 -Z，竖直 FOV 90°：projScaleY = 1，深度 d 处 1 个世界单位 ≈ H / (2d) px
  const cam = new PerspectiveCamera(90, 1, 0.1, 1000);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  return cam;
}

function segments(out: DrawRangeOutput, count: number): [number, number][] {
  return Array.from({ length: count }, (_, i) => [out.starts[i]!, out.counts[i]!]);
}

describe('selectDrawRanges', () => {
  it('视锥内的相邻构件并成一段，单位是顶点', () => {
    const { input, out } = build([
      { x: 0, y: 0, z: -10, r: 1, tris: 4 },
      { x: 1, y: 0, z: -10, r: 1, tris: 6 },
    ], perspective());
    const res = selectDrawRanges(input, out);
    expect(res).toEqual({ segmentCount: 1, triangleCount: 10, lodObjectCount: 0 });
    expect(segments(out, 1)).toEqual([[0, 30]]);
  });

  it('跳过视锥外（身后 / 侧面 / 远平面外）的构件', () => {
    const { input, out } = build([
      { x: 0, y: 0, z: -10, r: 1, tris: 100 },
      { x: 0, y: 0, z: 10, r: 1, tris: 100 },
      { x: 50, y: 0, z: -10, r: 1, tris: 100 },
      { x: 0, y: 0, z: -2000, r: 1, tris: 100 },
      { x: 0, y: 0, z: -20, r: 1, tris: 100 },
    ], perspective(), { gap: 0 });
    const res = selectDrawRanges(input, out);
    expect(res.segmentCount).toBe(2);
    expect(segments(out, 2)).toEqual([[0, 300], [1200, 300]]);
    expect(res.triangleCount).toBe(200);
  });

  it('包围球压在视锥边上的构件保留', () => {
    // 视锥右平面 x = -z（FOV 90°、aspect 1）；球心在 x = 10.5、z = -10，半径 1 跨过平面
    const { input, out } = build([{ x: 10.5, y: 0, z: -10, r: 1, tris: 3 }], perspective());
    expect(selectDrawRanges(input, out).segmentCount).toBe(1);
  });

  it('跳过隐藏构件，并按合并间隙决定拆段还是夹带', () => {
    const objs: Obj[] = [
      { x: 0, y: 0, z: -10, r: 1, tris: 50 },
      { x: 0, y: 0, z: -10, r: 1, tris: 10, visible: false },
      { x: 0, y: 0, z: -10, r: 1, tris: 50 },
    ];
    const merged = build(objs, perspective(), { gap: 20 });
    const a = selectDrawRanges(merged.input, merged.out);
    expect(a).toEqual({ segmentCount: 1, triangleCount: 110, lodObjectCount: 0 });
    expect(segments(merged.out, 1)).toEqual([[0, 330]]);

    const split = build(objs, perspective(), { gap: 5 });
    const b = selectDrawRanges(split.input, split.out);
    expect(b).toEqual({ segmentCount: 2, triangleCount: 100, lodObjectCount: 0 });
    expect(segments(split.out, 2)).toEqual([[0, 150], [180, 150]]);
  });

  it('像素阈值：透视下按深度换算直径', () => {
    // H = 1000、projScaleY = 1：直径 px = r × 1000 / depth
    const objs: Obj[] = [
      { x: 0, y: 0, z: -100, r: 0.5, tris: 10 }, // 5 px
      { x: 0, y: 0, z: -100, r: 2, tris: 10 }, // 20 px
    ];
    const none = build(objs, perspective(), { minPx: 0, gap: 0 });
    expect(selectDrawRanges(none.input, none.out).triangleCount).toBe(20);
    const px8 = build(objs, perspective(), { minPx: 8, gap: 0 });
    const res = selectDrawRanges(px8.input, px8.out);
    expect(res.triangleCount).toBe(10);
    expect(segments(px8.out, 1)).toEqual([[30, 30]]);
  });

  it('相机在包围球里时不按像素裁掉', () => {
    const { input, out } = build([{ x: 0, y: 0, z: -1, r: 0.0001, tris: 1 }, { x: 0, y: 0, z: -0.5, r: 5, tris: 1 }], perspective(), { minPx: 1e6, gap: 0 });
    const res = selectDrawRanges(input, out);
    expect(res.triangleCount).toBe(1);
    expect(segments(out, 1)).toEqual([[3, 3]]);
  });

  it('正交相机：视锥按盒裁，像素按 zoom 后的比例换算、与深度无关', () => {
    const cam = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);
    // projScaleY = 2 / 20 = 0.1，H = 1000 → 1 世界单位 = 100 px（直径 = r × 100）
    const objs: Obj[] = [
      { x: 0, y: 0, z: -500, r: 0.05, tris: 1 }, // 5 px
      { x: 0, y: 0, z: -900, r: 0.5, tris: 1 }, // 50 px
      { x: 500, y: 0, z: -10, r: 1, tris: 1 }, // 盒外（zoom 0.1 时盒宽 ±100，仍在外面）
    ];
    const r1 = build(objs, cam, { minPx: 8, gap: 0 });
    const res = selectDrawRanges(r1.input, r1.out);
    expect(res.segmentCount).toBe(1);
    expect(segments(r1.out, 1)).toEqual([[3, 3]]);

    cam.zoom = 0.1; // 缩小 10 倍：原来 50 px 的变成 5 px
    const r2 = build(objs, cam, { minPx: 8, gap: 0 });
    expect(selectDrawRanges(r2.input, r2.out).segmentCount).toBe(0);
  });

  it('半径为负（空包围盒）的构件总是画', () => {
    const { input, out } = build([{ x: 0, y: 0, z: 1000, r: -1, tris: 2 }], perspective(), { minPx: 100 });
    expect(selectDrawRanges(input, out)).toEqual({ segmentCount: 1, triangleCount: 2, lodObjectCount: 0 });
  });

  it('全部不可见或没有构件时返回 0 段', () => {
    const hidden = build([{ x: 0, y: 0, z: -10, r: 1, tris: 3, visible: false }], perspective());
    expect(selectDrawRanges(hidden.input, hidden.out)).toEqual({ segmentCount: 0, triangleCount: 0, lodObjectCount: 0 });
    const empty = build([], perspective());
    expect(selectDrawRanges(empty.input, empty.out)).toEqual({ segmentCount: 0, triangleCount: 0, lodObjectCount: 0 });
  });

  it('三角形数为 0 的构件不开段也不打断合并', () => {
    const { input, out } = build([
      { x: 0, y: 0, z: -10, r: 1, tris: 2 },
      { x: 0, y: 0, z: -10, r: 1, tris: 0 },
      { x: 0, y: 0, z: -10, r: 1, tris: 2 },
    ], perspective(), { gap: 0 });
    expect(selectDrawRanges(input, out)).toEqual({ segmentCount: 1, triangleCount: 4, lodObjectCount: 0 });
  });

  it('粗网格：小于 lodPx 的构件改画粗网格区段，粗网格段接在原网格段后面', () => {
    // 直径 px = r × 1000 / 100：A 5 px、B 20 px、C 5 px 但没有粗网格
    const objs: Obj[] = [
      { x: 0, y: 0, z: -100, r: 0.5, tris: 100 },
      { x: 0, y: 0, z: -100, r: 2, tris: 100 },
      { x: 0, y: 0, z: -100, r: 0.5, tris: 100 },
    ];
    const { input, out } = build(objs, perspective(), { gap: 0 });
    input.lod = {
      // 原网格共 300 个三角形，粗网格区从 300 起：A → [300, 310)，B → [310, 330)
      triStart: new Uint32Array([300, 310, 0]),
      triCount: new Uint32Array([10, 20, 0]),
      minPx: 10,
      state: new Uint8Array(3),
    };
    const res = selectDrawRanges(input, out);
    expect(res).toEqual({ segmentCount: 2, triangleCount: 210, lodObjectCount: 1 });
    // A 走粗网格；B、C 原网格相邻并成一段
    expect(segments(out, 2)).toEqual([[300, 600], [900, 30]]);
    expect(Array.from(input.lod.state)).toEqual([1, 0, 0]);
  });

  it('粗网格滞回：已在画粗网格的构件涨过 lodPx × 1.15 才换回原网格', () => {
    const objs: Obj[] = [{ x: 0, y: 0, z: -100, r: 1.1, tris: 100 }]; // 11 px
    const make = (state: number) => {
      const b = build(objs, perspective(), { gap: 0 });
      b.input.lod = { triStart: new Uint32Array([100]), triCount: new Uint32Array([10]), minPx: 10, state: new Uint8Array([state]) };
      return b;
    };
    const fresh = make(0);
    expect(selectDrawRanges(fresh.input, fresh.out).lodObjectCount).toBe(0);
    const sticky = make(1);
    expect(selectDrawRanges(sticky.input, sticky.out).lodObjectCount).toBe(1);
    expect(segments(sticky.out, 1)).toEqual([[300, 30]]);
  });

});

describe('selectDrawRanges —— 按通道选段', () => {
  // 五个构件首尾相接、各 10 个三角形，全在视野里
  const objs: Obj[] = Array.from({ length: 5 }, () => ({ x: 0, y: 0, z: -10, r: 1, tris: 10 }));

  function run(passFlags: number[] | undefined, pass: number | undefined, gap = 0) {
    const { input, out } = build(objs, perspective(), { gap });
    if (passFlags) input.passFlags = new Uint8Array(passFlags);
    input.pass = pass;
    const res = selectDrawRanges(input, out);
    return { res, segs: segments(out, res.segmentCount) };
  }

  it('不传 passFlags 时和改动前一致（pass 被忽略）', () => {
    expect(run(undefined, undefined)).toEqual(run(undefined, 1));
    expect(run(undefined, undefined).segs).toEqual([[0, 150]]);
  });

  it('混合场景：两张表各自只含本通道构件，合起来不重不漏', () => {
    const flags = [0, 1, 0, 0, 1];
    const opaque = run(flags, 0);
    const transparent = run(flags, 1);
    expect(opaque.segs).toEqual([[0, 30], [60, 60]]);
    expect(transparent.segs).toEqual([[30, 30], [120, 30]]);
    expect(opaque.res.triangleCount + transparent.res.triangleCount).toBe(50);
  });

  it('全不透明 / 全透明：另一通道为空', () => {
    expect(run([0, 0, 0, 0, 0], 0).segs).toEqual([[0, 150]]);
    expect(run([0, 0, 0, 0, 0], 1).res).toEqual({ segmentCount: 0, triangleCount: 0, lodObjectCount: 0 });
    expect(run([1, 1, 1, 1, 1], 1).segs).toEqual([[0, 150]]);
    expect(run([1, 1, 1, 1, 1], 0).res.segmentCount).toBe(0);
  });

  it('两张表都不进的构件（通道号 2）哪张表都不选', () => {
    const flags = [2, 0, 2, 1, 2];
    expect(run(flags, 0).segs).toEqual([[30, 30]]);
    expect(run(flags, 1).segs).toEqual([[90, 30]]);
  });

  it('合并间隙夹带另一通道构件：不超过间隙时并段，三角形数含夹带', () => {
    const flags = [0, 1, 0, 1, 1];
    const merged = run(flags, 0, 10);
    expect(merged.segs).toEqual([[0, 90]]);
    expect(merged.res.triangleCount).toBe(30);
    const split = run(flags, 0, 9);
    expect(split.segs).toEqual([[0, 30], [60, 30]]);
    expect(split.res.triangleCount).toBe(20);
  });
});

describe('selectDrawRanges —— 粗网格补充', () => {
  it('粗网格与拖动阈值同时开：先按 minPx 跳过，再按 lodPx 选档', () => {
    const objs: Obj[] = [
      { x: 0, y: 0, z: -100, r: 0.5, tris: 100 }, // 5 px：被 minPx 8 跳过
      { x: 0, y: 0, z: -100, r: 0.9, tris: 100 }, // 9 px：画粗网格
    ];
    const { input, out } = build(objs, perspective(), { gap: 0, minPx: 8 });
    input.lod = { triStart: new Uint32Array([200, 210]), triCount: new Uint32Array([10, 10]), minPx: 10, state: new Uint8Array(2) };
    expect(selectDrawRanges(input, out)).toEqual({ segmentCount: 1, triangleCount: 10, lodObjectCount: 1 });
    expect(segments(out, 1)).toEqual([[630, 30]]);
  });
});
