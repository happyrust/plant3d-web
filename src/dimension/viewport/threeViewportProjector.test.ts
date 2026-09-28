import { describe, expect, it } from 'vitest';

import {
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from 'three';

import { ThreeViewportProjector } from './threeViewportProjector';

function expectVecClose(
  actual: readonly number[],
  expected: readonly number[],
  digits = 8,
): void {
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, digits);
  });
}

describe('ThreeViewportProjector', () => {
  it('projects design coordinates through designToWorld in CSS pixels', () => {
    const camera = new OrthographicCamera(-2, 2, 1, -1, 0.1, 100);
    camera.position.set(10, 20, 10);
    camera.lookAt(10, 20, 0);
    camera.updateMatrixWorld(true);
    const projector = new ThreeViewportProjector({
      camera,
      designToWorld: new Matrix4().makeTranslation(10, 20, 0),
      widthCssPx: 800,
      heightCssPx: 400,
      dpr: 2,
    });

    expect(projector.project([0, 0, 0])).toMatchObject({
      x: 400,
      y: 200,
    });
    expect(projector.widthCssPx).toBe(800);
    expect(projector.heightCssPx).toBe(400);
    expect(projector.dpr).toBe(2);
  });

  it.each([
    new OrthographicCamera(-2, 2, 2, -2, 0.1, 100),
    new PerspectiveCamera(60, 2, 0.1, 100),
  ])('round-trips project and unproject', (camera) => {
    camera.position.set(2, 3, 8);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const designToWorld = new Matrix4()
      .makeRotationZ(Math.PI / 5)
      .setPosition(new Vector3(1, -2, 0.5));
    const projector = new ThreeViewportProjector({
      camera,
      designToWorld,
      widthCssPx: 1000,
      heightCssPx: 500,
      dpr: 1.5,
    });
    const designPoint = [0.25, -0.75, 0.4] as const;

    expectVecClose(
      projector.unproject(projector.project(designPoint)),
      designPoint,
    );
  });

  it('reports increasing world-per-pixel with perspective depth', () => {
    const camera = new PerspectiveCamera(60, 2, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const projector = new ThreeViewportProjector({
      camera,
      designToWorld: new Matrix4(),
      widthCssPx: 1000,
      heightCssPx: 500,
      dpr: 3,
    });

    expect(projector.worldPerPixelAt([0, 0, 0]))
      .toBeGreaterThan(projector.worldPerPixelAt([0, 0, 5]));
  });

  it('keeps projection and basis vectors independent of DPR', () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const create = (dpr: number) => new ThreeViewportProjector({
      camera,
      designToWorld: new Matrix4(),
      widthCssPx: 300,
      heightCssPx: 200,
      dpr,
    });

    expect(create(1).project([0.5, 0.5, 0])).toEqual(
      create(4).project([0.5, 0.5, 0]),
    );
    expect(create(1).right).toEqual(create(4).right);
    expect(create(1).up).toEqual(create(4).up);
    expect(create(1).forward).toEqual(create(4).forward);
  });
});
