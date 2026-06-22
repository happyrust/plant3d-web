import { describe, expect, it } from 'vitest';

import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { SolveSpaceBillboardVectorText } from './SolveSpaceBillboardVectorText';

const fakeFont = {
  getWidth: (_capHeight: number, text: string) => Math.max(1, text.length * 6),
  getCapHeight: (capHeight: number) => capHeight,
  trace2D: (
    _capHeight: number,
    originX: number,
    originY: number,
    _text: string,
    cb: (ax: number, ay: number, bx: number, by: number) => void,
  ) => {
    cb(originX, originY, originX + 4, originY + 6);
  },
};

describe('SolveSpaceBillboardVectorText', () => {
  it('应在 solvespace/rebarviz 风格间正确切换', async () => {
    const normal = new THREE.LineBasicMaterial({ color: 0x22c55e });
    const hovered = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const selected = new THREE.LineBasicMaterial({ color: 0xff0000 });

    const label = new SolveSpaceBillboardVectorText({
      text: '1000',
      materialNormal: normal,
      materialHovered: hovered,
      materialSelected: selected,
      renderStyle: 'solvespace',
      font: Promise.resolve(fakeFont as any),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(label.getRenderStyle()).toBe('solvespace');
    expect(label.getExtentsPx().height).toBeCloseTo(16, 2);
    expect((label as any).line?.visible).toBe(true);
    expect((label as any).haloLine?.visible).toBe(false);
    expect((label as any).line?.renderOrder).toBe(910);
    expect(
      ((label as any).line?.material as THREE.LineBasicMaterial)?.depthTest,
    ).toBe(true);

    label.setRenderStyle('rebarviz');

    expect(label.getRenderStyle()).toBe('rebarviz');
    expect(label.getExtentsPx().height).toBeGreaterThanOrEqual(14);
    expect((label as any).bgMesh?.visible).toBe(false);
    expect((label as any).haloLine?.visible).toBe(false);
    expect((label as any).line?.visible).toBe(true);
    expect((label as any).spriteMesh).toBe(null);
    expect((label as any).line?.renderOrder).toBe(922);
    expect((label as any).haloLine?.renderOrder).toBe(921);
    expect(
      ((label as any).line?.material as THREE.LineBasicMaterial)?.depthTest,
    ).toBe(false);

    label.dispose();
    normal.dispose();
    hovered.dispose();
    selected.dispose();
  });

  it('rebarviz 风格应完全禁用 halo 避免重复文字效果', async () => {
    const normal = new THREE.LineBasicMaterial({ color: 0x22c55e });
    const hovered = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const selected = new THREE.LineBasicMaterial({ color: 0xff0000 });

    const label = new SolveSpaceBillboardVectorText({
      text: '1000',
      materialNormal: normal,
      materialHovered: hovered,
      materialSelected: selected,
      renderStyle: 'rebarviz',
      font: Promise.resolve(fakeFont as any),
    });

    await Promise.resolve();
    await Promise.resolve();

    // Verify halo exists but is NOT visible for rebarviz
    expect((label as any).haloLine).toBeTruthy();
    expect((label as any).haloLine?.visible).toBe(false);

    // Verify text line is visible
    expect((label as any).line?.visible).toBe(true);

    label.dispose();
    normal.dispose();
    hovered.dispose();
    selected.dispose();
  });

  it('编号框线宽应比文字线宽更轻', async () => {
    const normal = new LineMaterial({ color: 0x7f1d1d, linewidth: 5 });
    const hovered = new LineMaterial({ color: 0xffff00, linewidth: 5 });
    const selected = new LineMaterial({ color: 0xff0000, linewidth: 5 });

    const label = new SolveSpaceBillboardVectorText({
      text: '2',
      materialNormal: normal,
      materialHovered: hovered,
      materialSelected: selected,
      renderStyle: 'rebarviz',
      font: Promise.resolve(fakeFont as any),
    });

    await Promise.resolve();
    await Promise.resolve();

    label.setOutlineBoxVisible(true, 4, 24);

    const textLineWidth = Number(((label as any).line?.material as any)?.linewidth);
    const frameLineWidth = Number(
      ((label as any).frameBoxLine?.material as any)?.linewidth,
    );

    expect((label as any).frameBoxLine?.visible).toBe(true);
    expect(textLineWidth).toBeCloseTo(2, 2);
    expect(textLineWidth).toBeLessThan(5);
    expect(frameLineWidth).toBeGreaterThanOrEqual(1);
    expect(frameLineWidth).toBeLessThan(textLineWidth);

    label.dispose();
    normal.dispose();
    hovered.dispose();
    selected.dispose();
  });

  it('应按传入的三维文字 frame 放置文字，而不是 billboard 跟随相机', async () => {
    const normal = new THREE.LineBasicMaterial({ color: 0x22c55e });
    const hovered = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const selected = new THREE.LineBasicMaterial({ color: 0xff0000 });

    const label = new SolveSpaceBillboardVectorText({
      text: '1000',
      materialNormal: normal,
      materialHovered: hovered,
      materialSelected: selected,
      renderStyle: 'solvespace',
      font: Promise.resolve(fakeFont as any),
    });

    await Promise.resolve();
    await Promise.resolve();

    label.setWorldPerPixel(2);
    label.setFrame(
      new THREE.Vector3(10, 20, 30),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    );

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(5, 6, 7);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    label.update(camera);
    label.object3d.updateMatrixWorld(true);

    expect(label.object3d.position.toArray()).toEqual([10, 20, 30]);
    expect(label.object3d.scale.toArray()).toEqual([2, 2, 2]);

    const q = label.object3d.quaternion.clone();
    const expected = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(1, 0, 0),
      ),
    );
    expect(q.angleTo(expected)).toBeLessThan(1e-6);

    label.dispose();
    normal.dispose();
    hovered.dispose();
    selected.dispose();
  });
});
