import { Matrix3, Matrix4, Vector3, type Camera } from 'three';

import type { ViewportProjector } from '../kernel/projector';
import type { Vec3 } from '../kernel/types';

function asTuple(vector: Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

export class ThreeViewportProjector implements ViewportProjector {
  readonly widthCssPx: number;
  readonly heightCssPx: number;
  readonly dpr: number;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;

  private readonly camera: Camera;
  private readonly designToWorld: Matrix4;
  private readonly worldToDesign: Matrix4;

  constructor(input: Readonly<{
    camera: Camera;
    designToWorld: Matrix4;
    widthCssPx: number;
    heightCssPx: number;
    dpr: number;
  }>) {
    assertPositiveFinite('widthCssPx', input.widthCssPx);
    assertPositiveFinite('heightCssPx', input.heightCssPx);
    assertPositiveFinite('dpr', input.dpr);

    this.camera = input.camera;
    this.camera.updateMatrixWorld(true);
    this.designToWorld = input.designToWorld.clone();
    this.worldToDesign = input.designToWorld.clone().invert();
    this.widthCssPx = input.widthCssPx;
    this.heightCssPx = input.heightCssPx;
    this.dpr = input.dpr;

    const worldToDesignDirection = new Matrix3().setFromMatrix4(this.worldToDesign);
    const elements = this.camera.matrixWorld.elements;
    const toDesignDirection = (vector: Vector3): Vec3 =>
      asTuple(vector.applyMatrix3(worldToDesignDirection).normalize());

    this.right = toDesignDirection(new Vector3(elements[0], elements[1], elements[2]));
    this.up = toDesignDirection(new Vector3(elements[4], elements[5], elements[6]));
    this.forward = toDesignDirection(this.camera.getWorldDirection(new Vector3()));
  }

  project(point: Vec3): Readonly<{ x: number; y: number; depth: number }> {
    const projected = new Vector3(...point)
      .applyMatrix4(this.designToWorld)
      .project(this.camera);
    return {
      x: ((projected.x + 1) * this.widthCssPx) / 2,
      y: ((1 - projected.y) * this.heightCssPx) / 2,
      depth: projected.z,
    };
  }

  unproject(point: Readonly<{ x: number; y: number; depth: number }>): Vec3 {
    const design = new Vector3(
      (point.x / this.widthCssPx) * 2 - 1,
      1 - (point.y / this.heightCssPx) * 2,
      point.depth,
    )
      .unproject(this.camera)
      .applyMatrix4(this.worldToDesign);
    return asTuple(design);
  }

  worldPerPixelAt(point: Vec3): number {
    const screen = this.project(point);
    const adjacent = this.unproject({
      x: screen.x + 1,
      y: screen.y,
      depth: screen.depth,
    });
    return Math.hypot(
      adjacent[0] - point[0],
      adjacent[1] - point[1],
      adjacent[2] - point[2],
    );
  }
}
