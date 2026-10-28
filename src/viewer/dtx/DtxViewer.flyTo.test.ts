import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Vector3 } from 'three';

import { DtxViewer } from './DtxViewer';

/**
 * `flyTo` 的调度语义：两次并发飞行只有后者生效。
 *
 * 真 `DtxViewer` 构造要 WebGL（`WebGLRenderer`），这里只借它的 `flyTo` / `cancelFlyTo` 两个方法，
 * 用 `Object.create` 拿原型、手工补 `camera` / `controls` / `_debug` / `_flyRafId`。
 * 被测的是「新飞行撤旧飞行」这条约束——它是 plant3d-web 侧所有取景修复的地基：
 * 不撤旧的话两个 step 循环会各写各的插值，最后一帧谁先谁后决定相机落点。
 */

type FakeVec = {
  x: number;
  y: number;
  z: number;
  clone: () => FakeVec;
  copy: (v: { x: number; y: number; z: number }) => void;
  lerpVectors: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) => void;
};

type FakeCamera = {
  position: FakeVec;
};

type FakeViewer = {
  camera: FakeCamera;
  controls: { target: FakeVec; update: () => void };
  _flyRafId: number | null;
  _debug: boolean;
  flyTo: (position: Vector3, target: Vector3, options?: { duration?: number }) => void;
  cancelFlyTo: () => void;
};

function makeViewer() {
  // `Object.create` 拿原型：真构造要 WebGL，这里只测 flyTo / cancelFlyTo 的调度
  const viewer = Object.create(DtxViewer.prototype) as unknown as FakeViewer;

  const makeVec = (): FakeVec => ({
    x: 0,
    y: 0,
    z: 0,
    clone() {
      const next = makeVec();
      next.x = this.x;
      next.y = this.y;
      next.z = this.z;
      return next;
    },
    copy(v: { x: number; y: number; z: number }) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
    },
    lerpVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) {
      this.x = a.x + (b.x - a.x) * t;
      this.y = a.y + (b.y - a.y) * t;
      this.z = a.z + (b.z - a.z) * t;
    },
  });

  viewer.camera = { position: makeVec() };
  viewer.controls = { target: makeVec(), update: vi.fn() };
  viewer._flyRafId = null;
  viewer._debug = false;
  return viewer;
}

/** 手动驱动的 raf：把回调排队，`flush()` 一次跑完当前队列。 */
function installFakeRaf() {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();

  const requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  const cancelAnimationFrame = vi.fn((id: number) => {
    pending.delete(id);
  });

  vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
  // Node 环境没有 window：DtxViewer 用的是 window.requestAnimationFrame
  vi.stubGlobal('window', {
    requestAnimationFrame,
    cancelAnimationFrame,
  });

  return {
    requestAnimationFrame,
    cancelAnimationFrame,
    pending,
    /** 跑掉当前队列里所有帧（每帧回调可能再排一帧，所以循环到空）。 */
    flush(rounds = 100) {
      for (let i = 0; i < rounds; i += 1) {
        const batch = [...pending.entries()];
        if (batch.length === 0) return;
        pending.clear();
        for (const [, cb] of batch) cb(performance.now());
      }
    },
  };
}

describe('DtxViewer.flyTo 调度', () => {
  let raf: ReturnType<typeof installFakeRaf>;

  beforeEach(() => {
    raf = installFakeRaf();
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('duration 为 0 时直接落位，不排帧', () => {
    const viewer = makeViewer();
    viewer.flyTo(new Vector3(1, 2, 3), new Vector3(4, 5, 6), { duration: 0 });
    expect(viewer.camera.position).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(viewer.controls.target).toMatchObject({ x: 4, y: 5, z: 6 });
    expect(raf.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('起新飞行会撤掉在途的那一次', () => {
    const viewer = makeViewer();
    viewer.flyTo(new Vector3(100, 0, 0), new Vector3(100, 0, 0), { duration: 800 });
    const firstRaf = viewer._flyRafId;
    expect(firstRaf).not.toBeNull();

    viewer.flyTo(new Vector3(0, 100, 0), new Vector3(0, 100, 0), { duration: 800 });
    expect(raf.cancelAnimationFrame).toHaveBeenCalledWith(firstRaf);
    expect(viewer._flyRafId).not.toBe(firstRaf);
  });

  it('cancelFlyTo 之后在途动画不再推进相机', () => {
    const viewer = makeViewer();
    viewer.flyTo(new Vector3(100, 0, 0), new Vector3(100, 0, 0), { duration: 800 });
    // 走一帧
    vi.spyOn(performance, 'now').mockReturnValue(200);
    raf.flush(1);
    const positionAfterFirstFrame = { ...viewer.camera.position };
    expect(positionAfterFirstFrame.x).toBeGreaterThan(0);

    viewer.cancelFlyTo();
    expect(viewer._flyRafId).toBeNull();

    // 再推时间、再跑帧：队列已空，相机不再动
    vi.spyOn(performance, 'now').mockReturnValue(800);
    raf.flush();
    expect({ ...viewer.camera.position }).toEqual(positionAfterFirstFrame);
  });

  it('只有最后一次飞行的目标会被走到（模拟两次定位抢相机）', () => {
    const viewer = makeViewer();
    // 第一次飞向 x=1000
    viewer.flyTo(new Vector3(1000, 0, 0), new Vector3(1000, 0, 0), { duration: 800 });
    // 用户立刻点了别处：第二次飞向 y=500
    viewer.flyTo(new Vector3(0, 500, 0), new Vector3(0, 500, 0), { duration: 800 });

    // 时间推过第一次的 800ms 与第二次的 800ms
    vi.spyOn(performance, 'now').mockReturnValue(2000);
    raf.flush();

    // 落点必须是第二次的目标，而不是第一次的 x=1000
    expect(viewer.camera.position).toMatchObject({ x: 0, y: 500, z: 0 });
    expect(viewer.camera.position.x).not.toBe(1000);
  });

  it('自然飞完后清掉 raf 句柄', () => {
    const viewer = makeViewer();
    viewer.flyTo(new Vector3(10, 0, 0), new Vector3(10, 0, 0), { duration: 800 });
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    raf.flush();
    expect(viewer._flyRafId).toBeNull();
  });
});
