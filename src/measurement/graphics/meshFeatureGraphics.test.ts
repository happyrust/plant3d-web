import { describe, expect, it } from 'vitest';

import {
  analyseMeshGraphics,
  nearestPointOnSegmentToRay,
  type GraphicsSegment,
  type GraphicsVec3,
} from './meshFeatureGraphics';

/** Axis-aligned box `[0,sx]×[0,sy]×[0,sz]` as 12 triangles with duplicated (un-welded) vertices per face. */
function boxMesh(sx: number, sy: number, sz: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const quad = (a: GraphicsVec3, b: GraphicsVec3, c: GraphicsVec3, d: GraphicsVec3): void => {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // Outward-facing (counter-clockwise seen from outside).
  quad([0, 0, 0], [0, sy, 0], [sx, sy, 0], [sx, 0, 0]); // -Z
  quad([0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz]); // +Z
  quad([0, 0, 0], [sx, 0, 0], [sx, 0, sz], [0, 0, sz]); // -Y
  quad([0, sy, 0], [0, sy, sz], [sx, sy, sz], [sx, sy, 0]); // +Y
  quad([0, 0, 0], [0, 0, sz], [0, sy, sz], [0, sy, 0]); // -X
  quad([sx, 0, 0], [sx, sy, 0], [sx, sy, sz], [sx, 0, sz]); // +X
  return { positions, indices };
}

/** Open cylinder side (no caps) around +Z, radius r, height h, n segments. */
function cylinderSide(r: number, h: number, n: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const base = positions.length / 3;
    positions.push(
      r * Math.cos(a0), r * Math.sin(a0), 0,
      r * Math.cos(a1), r * Math.sin(a1), 0,
      r * Math.cos(a1), r * Math.sin(a1), h,
      r * Math.cos(a0), r * Math.sin(a0), h,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, indices };
}

function segmentLength(segment: GraphicsSegment): number {
  return Math.hypot(
    segment.end[0] - segment.start[0],
    segment.end[1] - segment.start[1],
    segment.end[2] - segment.start[2],
  );
}

function sortedLengths(segments: readonly GraphicsSegment[]): number[] {
  return segments.map(segmentLength).map((v) => Number(v.toFixed(6))).sort((a, b) => a - b);
}

describe('analyseMeshGraphics · feature edges (E3D Graphics edge ≙ 3D_LINE)', () => {
  it('a box yields exactly its 12 edges; face diagonals (coplanar) are not drawn edges', () => {
    const mesh = boxMesh(2, 3, 4);
    const features = analyseMeshGraphics(mesh);
    expect(features.triangleCount).toBe(12);
    expect(features.edges).toHaveLength(12);
    expect(sortedLengths(features.edges)).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  });

  it('applies the column-major matrix before analysis (translated + scaled box)', () => {
    const mesh = boxMesh(1, 1, 1);
    // scale 2 on X, translate (10, 20, 30)
    const matrix = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
    const features = analyseMeshGraphics({ ...mesh, matrix });
    expect(sortedLengths(features.edges)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
    const allPoints = features.edges.flatMap((s) => [s.start, s.end]);
    expect(Math.min(...allPoints.map((p) => p[0]))).toBeCloseTo(10, 9);
    expect(Math.max(...allPoints.map((p) => p[0]))).toBeCloseTo(12, 9);
    expect(Math.min(...allPoints.map((p) => p[1]))).toBeCloseTo(20, 9);
    expect(Math.min(...allPoints.map((p) => p[2]))).toBeCloseTo(30, 9);
  });

  it('merges collinear runs: a boundary split by a mid vertex is one drawn edge', () => {
    // Flat 2×1 rectangle made of two unit quads side by side (4 triangles). The
    // interior edge x=1 is coplanar (not drawn); the top / bottom boundaries each
    // consist of two collinear unit edges meeting at a degree-2 vertex → merged.
    const positions: number[] = [];
    const indices: number[] = [];
    for (const x0 of [0, 1]) {
      const base = positions.length / 3;
      positions.push(x0, 0, 0, x0 + 1, 0, 0, x0 + 1, 1, 0, x0, 1, 0);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const features = analyseMeshGraphics({ positions, indices });
    expect(sortedLengths(features.edges)).toEqual([1, 1, 2, 2]);
  });

  it('does not merge through a vertex where three or more drawn edges meet', () => {
    // Two unit boxes glued along x=1: the shared face's edges are non-manifold
    // (four facets) and therefore drawn; the vertices at x=1 have degree 4, so the
    // outer X-direction edges stay as two unit segments each.
    const left = boxMesh(1, 1, 1);
    const right = boxMesh(1, 1, 1);
    const shifted = right.positions.map((v, i) => (i % 3 === 0 ? v + 1 : v));
    const positions = [...left.positions, ...shifted];
    const indices = [...left.indices, ...right.indices.map((i) => i + left.positions.length / 3)];
    const features = analyseMeshGraphics({ positions, indices });
    const unit = features.edges.filter((s) => Math.abs(segmentLength(s) - 1) < 1e-9);
    // 12 + 12 edges minus the 4 shared-face edges counted once = 20 unit edges …
    expect(unit).toHaveLength(20);
    // … plus the coincident faces' common diagonal, which is non-manifold (4 facets) and so drawn.
    const rest = features.edges.filter((s) => Math.abs(segmentLength(s) - 1) >= 1e-9);
    expect(rest).toHaveLength(1);
    expect(segmentLength(rest[0]!)).toBeCloseTo(Math.SQRT2, 9);
  });

  it('a coarse cylinder side (8 segments, 45° between facets) draws its generatrices and rims; 36 segments (10°) draws only the two rims', () => {
    const coarse = analyseMeshGraphics(cylinderSide(1, 2, 8));
    // 8 vertical generatrix edges (dihedral 45° ≥ 30°) + 8 + 8 rim edges (boundary).
    expect(coarse.edges).toHaveLength(24);
    const generatrices = coarse.edges.filter((s) => Math.abs(segmentLength(s) - 2) < 1e-9);
    expect(generatrices).toHaveLength(8);

    const fine = analyseMeshGraphics(cylinderSide(1, 2, 36));
    // Only the boundary rims remain: 36 edges each.
    expect(fine.edges).toHaveLength(72);
    expect(fine.edges.every((s) => Math.abs(segmentLength(s) - 2) > 1e-6)).toBe(true);
  });

  it('honours a custom feature angle', () => {
    const features = analyseMeshGraphics({ ...cylinderSide(1, 2, 36), featureAngleDeg: 5 });
    expect(features.edges).toHaveLength(72 + 36);
  });
});

describe('analyseMeshGraphics · facet plane and coplanar patch (E3D Graphics facet ≙ PLANE)', () => {
  it('maps a raycast triangle back to the mesh and returns its plane', () => {
    const mesh = boxMesh(2, 3, 4);
    const features = analyseMeshGraphics(mesh);
    // Triangle 2 belongs to the +Z face (quads are pushed in order; each quad = 2 triangles).
    const pick = (t: number): [GraphicsVec3, GraphicsVec3, GraphicsVec3] => {
      const ids = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
      return ids.map((id) => [mesh.positions[id * 3]!, mesh.positions[id * 3 + 1]!, mesh.positions[id * 3 + 2]!] as GraphicsVec3) as [
        GraphicsVec3, GraphicsVec3, GraphicsVec3,
      ];
    };
    const [a, b, c] = pick(2);
    const index = features.findTriangle(c, a, b); // any vertex order
    expect(index).toBe(2);
    const plane = features.facetPlane(index)!;
    expect(plane.normal.map((v) => Number(v.toFixed(9)))).toEqual([0, 0, 1]);
    expect(plane.position[2]).toBeCloseTo(4, 12);
  });

  it('the coplanar patch of a box face is the whole face (2 triangles) with a 4-segment outline', () => {
    const mesh = boxMesh(2, 3, 4);
    const features = analyseMeshGraphics(mesh);
    const patch = features.coplanarPatch(2)!;
    expect(patch.triangles).toEqual([2, 3]);
    expect(patch.outline).toHaveLength(4);
    expect(sortedLengths(patch.outline)).toEqual([2, 2, 3, 3]);
    expect(patch.plane.normal.map((v) => Number(v.toFixed(9)))).toEqual([0, 0, 1]);
  });

  it('on a tessellated cylinder the patch is one flat quad, not the whole side', () => {
    const features = analyseMeshGraphics(cylinderSide(1, 2, 36));
    const patch = features.coplanarPatch(10)!;
    expect(patch.triangles).toEqual([10, 11]);
    expect(patch.outline).toHaveLength(4);
  });

  it('degenerate triangles are skipped and unknown triangles map to -1', () => {
    const features = analyseMeshGraphics({
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0],
      indices: [0, 1, 2, 3, 4, 5],
    });
    expect(features.triangleCount).toBe(2);
    expect(features.facetPlane(0)).toBeNull();
    expect(features.coplanarPatch(0)).toBeNull();
    expect(features.facetPlane(1)).not.toBeNull();
    expect(features.findTriangle([9, 9, 9], [9, 9, 8], [9, 8, 9])).toBe(-1);
    // A lone triangle is all boundary → 3 drawn edges.
    expect(features.edges).toHaveLength(3);
  });
});

describe('nearestPointOnSegmentToRay', () => {
  it('returns the control point on the segment nearest the ray and its distance', () => {
    const segment: GraphicsSegment = { start: [0, 0, 0], end: [10, 0, 0] };
    const hit = nearestPointOnSegmentToRay(segment, { origin: [4, 5, 1], direction: [0, -1, 0] })!;
    expect(hit.point).toEqual([4, 0, 0]);
    expect(hit.distance).toBeCloseTo(1, 12);
  });

  it('clamps to the segment extent', () => {
    const segment: GraphicsSegment = { start: [0, 0, 0], end: [10, 0, 0] };
    const hit = nearestPointOnSegmentToRay(segment, { origin: [14, 5, 0], direction: [0, -1, 0] })!;
    expect(hit.point).toEqual([10, 0, 0]);
    expect(hit.distance).toBeCloseTo(4, 12);
  });

  it('rejects zero-length segments', () => {
    expect(nearestPointOnSegmentToRay({ start: [1, 1, 1], end: [1, 1, 1] }, { origin: [0, 0, 0], direction: [1, 0, 0] })).toBeNull();
  });
});
