/**
 * Pure kernel for the E3D **Graphics** pick filter (`EDGPICK.stdGraphics`,
 * `inMode = 'pickdetail'`): the picked detail of a drawn element is either a
 * **facet edge** (→ `3D_LINE`, `getLine()`) or a **facet** (→ `PLANE`, `getPlane()`).
 *
 * The Web has no PDMS graphics kernel to ask, so the details are derived from
 * the triangle mesh already loaded for rendering (plan 2026-09-12 Phase A,
 * "Graphics provider（前端本地，从已加载网格派生）"):
 *
 * - **Feature edges**: a mesh edge is a drawn edge when it is a boundary edge
 *   (one adjacent triangle), a non-manifold edge (three or more), or the dihedral
 *   angle between its two adjacent facets is at least `featureAngleDeg`
 *   (default 30°). Runs of collinear feature edges meeting at degree-2 vertices
 *   are merged into one segment, so a tessellated box edge is one line and a
 *   tessellated cylinder rim stays a polygon of short edges.
 * - **Facet plane**: the plane of the picked triangle. The **coplanar patch**
 *   (edge-connected triangles with the same plane) is returned for highlighting
 *   — a box face is one patch, a cylinder side is one flat quad of the
 *   tessellation, exactly the granularity E3D's `pickdetail` gives for facets.
 *
 * Evidence status: `static_expectation` from `edgpick.pmlobj` / `edgpicktype.pmlobj`
 * (`GRAPHICS` branch of `snap()`, `getLine()` / `getPlane()`); runtime golden
 * G7-02 (EDGE / PLANE capture geometry) is still to be observed on E3D.
 *
 * Coordinates: whatever frame `positions` (after `matrix`) are in; the caller
 * decides (scene world here). No three.js dependency so it can be unit-tested.
 */

export type GraphicsVec3 = readonly [number, number, number];

export type GraphicsSegment = Readonly<{ start: GraphicsVec3; end: GraphicsVec3 }>;

export type GraphicsPlane = Readonly<{ position: GraphicsVec3; normal: GraphicsVec3 }>;

export type MeshGraphicsInput = Readonly<{
  /** Vertex positions, xyz triplets. */
  positions: ArrayLike<number>;
  /** Triangle vertex indices; omitted → consecutive triplets. */
  indices?: ArrayLike<number> | null;
  /** Column-major 4×4 applied to every position before analysis (object → world). */
  matrix?: ArrayLike<number> | null;
  /** Dihedral angle (degrees) at or above which a shared edge is a drawn edge. Default 30. */
  featureAngleDeg?: number;
  /** Vertices closer than this (same units as positions) are welded. Default 1e-5. */
  weldTolerance?: number;
}>;

export type CoplanarPatch = Readonly<{
  plane: GraphicsPlane;
  /** Triangle indices of the patch (into the analysed mesh). */
  triangles: readonly number[];
  /** Boundary of the patch, collinear runs merged. */
  outline: readonly GraphicsSegment[];
}>;

export type MeshGraphicsFeatures = Readonly<{
  triangleCount: number;
  /** Drawn edges of the whole mesh, collinear runs merged. */
  edges: readonly GraphicsSegment[];
  /** Plane of triangle `index` (centroid + unit normal); `null` when degenerate. */
  facetPlane(index: number): GraphicsPlane | null;
  /** Coplanar patch containing triangle `index`; `null` when degenerate. */
  coplanarPatch(index: number): CoplanarPatch | null;
  /**
   * Triangle whose three vertices coincide (within the weld tolerance) with
   * `a / b / c` in any order — maps a raycast hit triangle back to the mesh. −1 if absent.
   */
  findTriangle(a: GraphicsVec3, b: GraphicsVec3, c: GraphicsVec3): number;
}>;

export const DEFAULT_GRAPHICS_FEATURE_ANGLE_DEG = 30;
export const DEFAULT_GRAPHICS_WELD_TOLERANCE = 1e-5;

/** |sin| below which two edge directions count as collinear when merging runs. */
const COLLINEAR_SIN = 1e-6;
/** cos of the angle under which two facet normals count as the same plane. */
const COPLANAR_COS = Math.cos((0.5 * Math.PI) / 180);
/** Distance (relative to the mesh extent) under which a centroid lies on the seed plane. */
const COPLANAR_DISTANCE_RATIO = 1e-6;
const DEGENERATE_AREA_SQ = 1e-30;

function sub(a: GraphicsVec3, b: GraphicsVec3): GraphicsVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: GraphicsVec3, b: GraphicsVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: GraphicsVec3, b: GraphicsVec3): GraphicsVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lengthSq(a: GraphicsVec3): number {
  return dot(a, a);
}

function normalize(a: GraphicsVec3): GraphicsVec3 | null {
  const length = Math.sqrt(lengthSq(a));
  return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : null;
}

function applyMatrix(matrix: ArrayLike<number> | null | undefined, x: number, y: number, z: number): GraphicsVec3 {
  if (!matrix || matrix.length !== 16) return [x, y, z];
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  const invW = w !== 0 ? 1 / w : 1;
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) * invW,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) * invW,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) * invW,
  ];
}

function edgeKey(a: number, b: number): number {
  // Vertex ids are dense and < 2^26 in practice; pack the ordered pair into one number.
  return a < b ? a * 67108864 + b : b * 67108864 + a;
}

/**
 * Merge chains of collinear segments that meet at vertices shared by exactly two
 * of the given edges. `edges` are pairs of welded vertex ids.
 */
function mergeCollinearRuns(
  edges: readonly (readonly [number, number])[],
  vertexAt: (id: number) => GraphicsVec3,
): GraphicsSegment[] {
  const byVertex = new Map<number, number[]>();
  edges.forEach(([a, b], index) => {
    if (a === b) return;
    (byVertex.get(a) ?? byVertex.set(a, []).get(a)!).push(index);
    (byVertex.get(b) ?? byVertex.set(b, []).get(b)!).push(index);
  });

  const consumed = new Uint8Array(edges.length);
  const out: GraphicsSegment[] = [];

  const direction = (from: number, to: number): GraphicsVec3 | null => normalize(sub(vertexAt(to), vertexAt(from)));

  const extend = (startVertex: number, dir: GraphicsVec3): number => {
    // Walk away from `startVertex` along `dir` while the far vertex is shared by
    // exactly two of the edges (degree 2) and the other one continues collinearly.
    let current = startVertex;
    for (;;) {
      const around = byVertex.get(current) ?? [];
      if (around.length !== 2) break;
      const next = around.find((index) => !consumed[index]);
      if (next === undefined) break;
      const [a, b] = edges[next]!;
      const far = a === current ? b : a;
      const nextDir = direction(current, far);
      if (!nextDir) break;
      const sin = Math.sqrt(lengthSq(cross(dir, nextDir)));
      if (sin > COLLINEAR_SIN || dot(dir, nextDir) <= 0) break;
      consumed[next] = 1;
      current = far;
    }
    return current;
  };

  edges.forEach(([a, b], index) => {
    if (consumed[index] || a === b) return;
    consumed[index] = 1;
    const dir = direction(a, b);
    if (!dir) return;
    const end = extend(b, dir);
    const start = extend(a, [-dir[0], -dir[1], -dir[2]]);
    out.push({ start: vertexAt(start), end: vertexAt(end) });
  });

  return out;
}

/**
 * Analyse a triangle mesh once; the returned object answers edge / facet / patch
 * queries for every pick on that mesh.
 */
export function analyseMeshGraphics(input: MeshGraphicsInput): MeshGraphicsFeatures {
  const featureAngleDeg = input.featureAngleDeg ?? DEFAULT_GRAPHICS_FEATURE_ANGLE_DEG;
  const weld = input.weldTolerance ?? DEFAULT_GRAPHICS_WELD_TOLERANCE;
  const featureCos = Math.cos((Math.min(180, Math.max(0, featureAngleDeg)) * Math.PI) / 180);

  // 1. Transform + weld vertices.
  const rawCount = Math.floor(input.positions.length / 3);
  const weldIdByKey = new Map<string, number>();
  const weldedPositions: GraphicsVec3[] = [];
  const weldIdOfRaw = new Int32Array(rawCount);
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;

  const keyOf = (p: GraphicsVec3): string =>
    `${Math.round(p[0] / weld)},${Math.round(p[1] / weld)},${Math.round(p[2] / weld)}`;

  for (let i = 0; i < rawCount; i += 1) {
    const p = applyMatrix(
      input.matrix,
      Number(input.positions[i * 3]),
      Number(input.positions[i * 3 + 1]),
      Number(input.positions[i * 3 + 2]),
    );
    if (!p.every(Number.isFinite)) {
      weldIdOfRaw[i] = -1;
      continue;
    }
    const key = keyOf(p);
    let id = weldIdByKey.get(key);
    if (id === undefined) {
      id = weldedPositions.length;
      weldIdByKey.set(key, id);
      weldedPositions.push(p);
      minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); minZ = Math.min(minZ, p[2]);
      maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); maxZ = Math.max(maxZ, p[2]);
    }
    weldIdOfRaw[i] = id;
  }
  const extent = weldedPositions.length > 0
    ? Math.max(maxX - minX, maxY - minY, maxZ - minZ, weld)
    : weld;
  const coplanarDistance = extent * COPLANAR_DISTANCE_RATIO;

  // 2. Triangles (welded ids, unit normals, centroids).
  const indexCount = input.indices ? input.indices.length : rawCount;
  const triangleCount = Math.floor(indexCount / 3);
  const triVertices = new Int32Array(triangleCount * 3);
  const triNormals: (GraphicsVec3 | null)[] = new Array(triangleCount);
  const triCentroids: (GraphicsVec3 | null)[] = new Array(triangleCount);
  const triangleByKey = new Map<string, number>();

  for (let t = 0; t < triangleCount; t += 1) {
    const ia = input.indices ? Number(input.indices[t * 3]) : t * 3;
    const ib = input.indices ? Number(input.indices[t * 3 + 1]) : t * 3 + 1;
    const ic = input.indices ? Number(input.indices[t * 3 + 2]) : t * 3 + 2;
    const a = ia >= 0 && ia < rawCount ? weldIdOfRaw[ia]! : -1;
    const b = ib >= 0 && ib < rawCount ? weldIdOfRaw[ib]! : -1;
    const c = ic >= 0 && ic < rawCount ? weldIdOfRaw[ic]! : -1;
    triVertices[t * 3] = a; triVertices[t * 3 + 1] = b; triVertices[t * 3 + 2] = c;
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) {
      triNormals[t] = null;
      triCentroids[t] = null;
      continue;
    }
    const pa = weldedPositions[a]!; const pb = weldedPositions[b]!; const pc = weldedPositions[c]!;
    const n = cross(sub(pb, pa), sub(pc, pa));
    if (lengthSq(n) <= DEGENERATE_AREA_SQ) {
      triNormals[t] = null;
      triCentroids[t] = null;
      continue;
    }
    triNormals[t] = normalize(n);
    triCentroids[t] = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    triangleByKey.set([a, b, c].sort((x, y) => x - y).join(','), t);
  }

  // 3. Edge → adjacent (non-degenerate) triangles.
  const trianglesByEdge = new Map<number, number[]>();
  const edgeEnds = new Map<number, readonly [number, number]>();
  for (let t = 0; t < triangleCount; t += 1) {
    if (!triNormals[t]) continue;
    const a = triVertices[t * 3]!; const b = triVertices[t * 3 + 1]!; const c = triVertices[t * 3 + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(u, v);
      const list = trianglesByEdge.get(key);
      if (list) list.push(t);
      else {
        trianglesByEdge.set(key, [t]);
        edgeEnds.set(key, [u, v]);
      }
    }
  }

  const isFeatureEdge = (key: number): boolean => {
    const tris = trianglesByEdge.get(key);
    if (!tris || tris.length === 0) return false;
    if (tris.length !== 2) return true;
    const n0 = triNormals[tris[0]!]!;
    const n1 = triNormals[tris[1]!]!;
    return dot(n0, n1) <= featureCos;
  };

  const featureEdgeKeys: number[] = [];
  for (const key of trianglesByEdge.keys()) {
    if (isFeatureEdge(key)) featureEdgeKeys.push(key);
  }
  const vertexAt = (id: number): GraphicsVec3 => weldedPositions[id]!;
  const edges = mergeCollinearRuns(featureEdgeKeys.map((key) => edgeEnds.get(key)!), vertexAt);

  const facetPlane = (index: number): GraphicsPlane | null => {
    const normal = triNormals[index];
    const centroid = triCentroids[index];
    return normal && centroid ? { position: centroid, normal } : null;
  };

  const coplanarPatch = (index: number): CoplanarPatch | null => {
    const seed = facetPlane(index);
    if (!seed) return null;
    const inPatch = new Set<number>([index]);
    const queue = [index];
    while (queue.length > 0) {
      const t = queue.pop()!;
      const a = triVertices[t * 3]!; const b = triVertices[t * 3 + 1]!; const c = triVertices[t * 3 + 2]!;
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
        const key = edgeKey(u, v);
        if (isFeatureEdge(key)) continue;
        for (const other of trianglesByEdge.get(key) ?? []) {
          if (inPatch.has(other)) continue;
          const n = triNormals[other];
          const centroid = triCentroids[other];
          if (!n || !centroid) continue;
          if (dot(n, seed.normal) < COPLANAR_COS) continue;
          if (Math.abs(dot(sub(centroid, seed.position), seed.normal)) > coplanarDistance) continue;
          inPatch.add(other);
          queue.push(other);
        }
      }
    }
    const boundary: (readonly [number, number])[] = [];
    for (const t of inPatch) {
      const a = triVertices[t * 3]!; const b = triVertices[t * 3 + 1]!; const c = triVertices[t * 3 + 2]!;
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
        const neighbours = trianglesByEdge.get(edgeKey(u, v)) ?? [];
        const inside = neighbours.filter((other) => inPatch.has(other)).length;
        if (inside === 1) boundary.push([u, v]);
      }
    }
    return {
      plane: seed,
      triangles: Array.from(inPatch).sort((x, y) => x - y),
      outline: mergeCollinearRuns(boundary, vertexAt),
    };
  };

  const findTriangle = (a: GraphicsVec3, b: GraphicsVec3, c: GraphicsVec3): number => {
    const ids = [a, b, c].map((p) => weldIdByKey.get(keyOf(p)));
    if (ids.every((id) => id !== undefined)) {
      const exact = triangleByKey.get((ids as number[]).sort((x, y) => x - y).join(','));
      if (exact !== undefined) return exact;
    }
    // Quantisation boundary miss: fall back to the nearest centroid within tolerance.
    const centroid: GraphicsVec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const tolerance = Math.max(10 * weld, coplanarDistance);
    let best = -1;
    let bestDistanceSq = tolerance * tolerance;
    for (let t = 0; t < triangleCount; t += 1) {
      const other = triCentroids[t];
      if (!other) continue;
      const d = lengthSq(sub(other, centroid));
      if (d < bestDistanceSq) {
        bestDistanceSq = d;
        best = t;
      }
    }
    return best;
  };

  return { triangleCount, edges, facetPlane, coplanarPatch, findTriangle };
}

/**
 * Point on `segment` nearest to the ray (the E3D control point of a line pick),
 * clamped to the segment extent, plus the ray parameter — the caller ranks edges
 * by how close the cursor ray passes them.
 */
export function nearestPointOnSegmentToRay(
  segment: GraphicsSegment,
  ray: Readonly<{ origin: GraphicsVec3; direction: GraphicsVec3 }>,
): Readonly<{ point: GraphicsVec3; distance: number }> | null {
  const u = sub(segment.end, segment.start);
  const v = ray.direction;
  const w0 = sub(segment.start, ray.origin);
  const a = dot(u, u); const b = dot(u, v); const c = dot(v, v);
  const d = dot(u, w0); const e = dot(v, w0);
  if (a <= 0 || c <= 0) return null;
  const denominator = a * c - b * b;
  let s: number;
  if (denominator <= 1e-18 * a * c) {
    // Ray parallel to the segment: any point works; take the start.
    s = 0;
  } else {
    s = (b * e - c * d) / denominator;
  }
  s = Math.min(1, Math.max(0, s));
  const point: GraphicsVec3 = [
    segment.start[0] + u[0] * s,
    segment.start[1] + u[1] * s,
    segment.start[2] + u[2] * s,
  ];
  let t = (b * s + e) / c;
  if (t < 0) t = 0;
  const onRay: GraphicsVec3 = [
    ray.origin[0] + v[0] * t,
    ray.origin[1] + v[1] * t,
    ray.origin[2] + v[2] * t,
  ];
  return { point, distance: Math.sqrt(lengthSq(sub(point, onRay))) };
}
