import type { Vec3 } from './types';

export type ViewportProjector = {
  readonly widthCssPx: number;
  readonly heightCssPx: number;
  readonly dpr: number;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
  project(point: Vec3): Readonly<{ x: number; y: number; depth: number }>;
  unproject(point: Readonly<{ x: number; y: number; depth: number }>): Vec3;
  worldPerPixelAt(point: Vec3): number;
}

export function alignToPixelGrid(point: Vec3, projector: ViewportProjector): Vec3 {
  const screen = projector.project(point);
  return projector.unproject({
    x: Math.round(screen.x),
    y: Math.round(screen.y),
    depth: screen.depth,
  });
}
