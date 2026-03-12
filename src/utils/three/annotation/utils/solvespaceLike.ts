import * as THREE from 'three';

const LENGTH_EPS = 1e-9;

export function alignToPixelGrid(
  camera: THREE.Camera,
  worldPoint: THREE.Vector3,
  viewportWidthPx: number,
  viewportHeightPx: number,
  out: THREE.Vector3 = new THREE.Vector3()
): THREE.Vector3 {
  // Three.js: project -> pixel -> round -> unproject (keeping NDC z)
  const ndc = out.copy(worldPoint).project(camera);
  const w = Math.max(1, viewportWidthPx);
  const h = Math.max(1, viewportHeightPx);

  const sx = (ndc.x * 0.5 + 0.5) * w;
  const sy = (-ndc.y * 0.5 + 0.5) * h;

  const sxR = Math.round(sx);
  const syR = Math.round(sy);

  ndc.x = (sxR / w) * 2 - 1;
  ndc.y = -((syR / h) * 2 - 1);

  return ndc.unproject(camera);
}

/**
 * Compute world distance for 1 device-pixel at `worldPoint` depth.
 * This is used to convert SolveSpace pixel sizes (e.g. 13px arrow) into world units.
 */
export function worldPerPixelAt(
  camera: THREE.Camera,
  worldPoint: THREE.Vector3,
  viewportWidthPx: number,
  viewportHeightPx: number,
  tmp?: {
    ndc: THREE.Vector3
    ndc2: THREE.Vector3
    p0: THREE.Vector3
    p1: THREE.Vector3
    p2: THREE.Vector3
  }
): number {
  const w = Math.max(1, viewportWidthPx);
  const h = Math.max(1, viewportHeightPx);

  const ndc = (tmp?.ndc ?? new THREE.Vector3()).copy(worldPoint).project(camera);
  const ndc2 = (tmp?.ndc2 ?? new THREE.Vector3()).copy(ndc);

  const p0 = (tmp?.p0 ?? new THREE.Vector3()).copy(ndc).unproject(camera);

  // +1px in X => +2/w in NDC
  ndc2.set(ndc.x + 2 / w, ndc.y, ndc.z);
  const p1 = (tmp?.p1 ?? new THREE.Vector3()).copy(ndc2).unproject(camera);

  // +1px in Y => +2/h in NDC
  ndc2.set(ndc.x, ndc.y + 2 / h, ndc.z);
  const p2 = (tmp?.p2 ?? new THREE.Vector3()).copy(ndc2).unproject(camera);

  const dx = p0.distanceTo(p1);
  const dy = p0.distanceTo(p2);
  return (dx + dy) * 0.5;
}

export type SolveSpaceTrimResultT = {
  /** 0: label within/over line; +1 closer to A; -1 closer to B */
  within: -1 | 0 | 1
  /** Parametric segments to draw along the original line: p(t)=a + (b-a)*t */
  segmentsT: [number, number][]
}

/**
 * Port of SolveSpace `Constraint::DoLineTrimmedAgainstBox` (but returns segments instead of drawing).
 *
 * There is a rectangular box aligned to display axes (gr/gu) centered at `ref`.
 * We want to draw a line from `a` to `b` (segment). If it intersects the box prism, trim to leave a gap.
 * If not, optionally extend the line to barely meet the box and return which end was extended.
 */
export function lineTrimmedAgainstBoxT(
  ref: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  gr: THREE.Vector3,
  gu: THREE.Vector3,
  swidth: number,
  sheight: number,
  extend = true
): SolveSpaceTrimResultT {
  const planes = [
    { n: gu.clone().multiplyScalar(-1), d: -(gu.dot(ref) + sheight / 2) },
    { n: gu.clone(), d: gu.dot(ref) - sheight / 2 },
    { n: gr.clone(), d: gr.dot(ref) - swidth / 2 },
    { n: gr.clone().multiplyScalar(-1), d: -(gr.dot(ref) + swidth / 2) },
  ];

  const dl = new THREE.Vector3().subVectors(b, a);
  const dlLenSq = dl.lengthSq();
  if (dlLenSq < 1e-12) {
    return { within: 0, segmentsT: [] };
  }

  let tmin = Number.POSITIVE_INFINITY;
  let tmax = Number.NEGATIVE_INFINITY;
  let anyIntersection = false;

  const p = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    const pi = planes[i]!;
    const denom = pi.n.dot(dl);
    if (Math.abs(denom) < 1e-12) continue;
    const t = (pi.d - pi.n.dot(a)) / denom;
    p.copy(a).addScaledVector(dl, t);

    let inside = true;
    for (let j = 0; j < 4; j++) {
      const pj = planes[j]!;
      const dd = pj.n.dot(p) - pj.d;
      if (dd < -LENGTH_EPS) { inside = false; break; }
    }
    if (!inside) continue;

    anyIntersection = true;
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }

  // Robustness: if we found no intersections, decide by testing point-in-box
  if (!anyIntersection) {
    let insideA = true;
    for (let j = 0; j < 4; j++) {
      const pj = planes[j]!;
      const dd = pj.n.dot(a) - pj.d;
      if (dd < -LENGTH_EPS) { insideA = false; break; }
    }
    return insideA ? { within: 0, segmentsT: [] } : { within: 0, segmentsT: [[0, 1]] };
  }

  const in01 = (t: number) => t >= 0.0 && t <= 1.0;

  // Both in range => trim middle gap
  if (in01(tmin) && in01(tmax)) {
    const segs: [number, number][] = [];
    if (tmin > 0) segs.push([0, tmin]);
    if (tmax < 1) segs.push([tmax, 1]);
    return { within: 0, segmentsT: segs };
  }

  // One intersection in range
  if (in01(tmin)) return { within: 0, segmentsT: [[0, tmin]] };
  if (in01(tmax)) return { within: 0, segmentsT: [[tmax, 1]] };

  // No intersection in range: optionally extend to meet label box
  if (tmax < 0.0) {
    return { within: 1, segmentsT: [[extend ? tmax : 0, 1]] };
  }
  if (tmin > 1.0) {
    return { within: -1, segmentsT: [[0, extend ? tmin : 1]] };
  }

  // Entire line within box (SolveSpace fallthrough)
  return { within: 0, segmentsT: [] };
}

