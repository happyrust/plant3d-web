import { projectionAxisVector, unitVec3 } from './directions';
import { isFiniteVec3 } from './invariants';

import type {
  DimensionAnchor,
  ProjectionAxisRef,
  SemanticAnchorRef,
  UserDimensionRecord,
  Vec3,
} from './types';

/**
 * 布局前的尺寸校验（#68，E3D `DMCHEK` 的同类判定）：几何走不通时给类型化错误，布局不再退回一份错的几何。
 * 纯函数；视向只作参数传入（瞬态），不读也不写记录。
 */
export type DimensionValidationCode =
  | 'DIMENSION_DIRECTION_PARALLEL_VIEW'
  | 'PROJECTION_DIRECTION_PARALLEL_VIEW'
  | 'PROJECTION_DIRECTION_PARALLEL_DIMENSION'
  | 'DEGENERATE_DIMENSION_DIRECTION'
  | 'DEGENERATE_PROJECTION_DIRECTION'
  | 'UNRESOLVED_DIMENSION_POINT'
  | 'INVALID_DIMENSION_POINT_TYPE'
  | 'CHAIN_TOO_SHORT';

export type DimensionValidationError = Readonly<{
  code: DimensionValidationCode;
  /** 出问题的槽位：锚点名（`a` / `b` / `vertex` …）或方向名（`axis` / `normal` / `dimensionDirection` …）。 */
  slot?: string;
}>;

export type DimensionValidationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; errors: readonly DimensionValidationError[] }>;

/**
 * 容差表。数值是工程默认，待 E3D 3.1 实机金样（#70）回填后在这里统一调，不散落在调用处。
 */
export type DimensionValidationTolerances = Readonly<{
  minDirectionLengthM: number;
  parallelViewDeg: number;
  parallelDimensionDeg: number;
}>;

export const DIMENSION_VALIDATION_TOLERANCES: DimensionValidationTolerances = Object.freeze({
  /** 方向向量的最小长度（设计系 m）：短于它当零向量（两端重合 / 轴未定）。1e-6 m = 0.001 mm。 */
  minDirectionLengthM: 1e-6,
  /** 尺寸线与视向的最小夹角（度）：小于它尺寸线在屏幕上缩成一点，DMCHEK 报「方向平行于视向」。 */
  parallelViewDeg: 1,
  /** 投影方向与尺寸方向的最小夹角（度）：小于它投影线与尺寸线重合，投影无意义。 */
  parallelDimensionDeg: 1,
});

export type DimensionValidationContext = Readonly<{
  /** 当前相机视向（设计系，任意长度）；不给就只做与视向无关的校验。 */
  viewDirection?: Vec3;
  tolerances?: DimensionValidationTolerances;
}>;

/** 能当「点」用的语义来源：方向不是点。 */
const POINT_SOURCES: ReadonlySet<SemanticAnchorRef['source']> = new Set([
  'p-point',
  'instance-origin',
  'primitive-key-point',
  'model-surface',
  'circle',
  'arc',
]);

/** 能定方向的语义来源：网格表面拾取点只是近似位置，定不了方向。 */
const DIRECTION_SOURCES: ReadonlySet<SemanticAnchorRef['source']> = new Set([
  'direction',
  'p-point',
  'primitive-key-point',
  'circle',
  'arc',
]);

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function nearlyParallel(a: Vec3, b: Vec3, toleranceDeg: number): boolean {
  const ua = unitVec3(a);
  const ub = unitVec3(b);
  if (!ua || !ub) return false;
  return Math.abs(dot(ua, ub)) >= Math.cos((toleranceDeg * Math.PI) / 180);
}

function checkPoints(
  anchors: Readonly<Record<string, DimensionAnchor>>,
  errors: DimensionValidationError[],
): void {
  for (const [slot, anchor] of Object.entries(anchors)) {
    if (anchor.semanticRef && !POINT_SOURCES.has(anchor.semanticRef.source)) {
      errors.push({ code: 'INVALID_DIMENSION_POINT_TYPE', slot });
    } else if (!isFiniteVec3(anchor.snapshot)) {
      errors.push({ code: 'UNRESOLVED_DIMENSION_POINT', slot });
    }
  }
}

function checkAxisSource(
  axis: ProjectionAxisRef,
  slot: string,
  errors: DimensionValidationError[],
): void {
  if (axis.kind === 'semantic-direction' && !DIRECTION_SOURCES.has(axis.semanticRef.source)) {
    errors.push({ code: 'INVALID_DIMENSION_POINT_TYPE', slot });
  }
}

function finiteOr(value: Vec3 | undefined, fallback: Vec3 | null): Vec3 | null {
  return value && isFiniteVec3(value) ? value : fallback;
}

/**
 * 与视向有关的那三条（相机一动就要重判，所以布局时用当帧视向调用；视向不入库）。
 * `dimensionDirection` / `projectionDirection` 为 null 时对应的检查跳过。
 */
export function checkDirectionsAgainstView(
  directions: Readonly<{ dimensionDirection: Vec3 | null; projectionDirection?: Vec3 | null }>,
  viewDirection: Vec3 | null | undefined,
  tolerances: DimensionValidationTolerances = DIMENSION_VALIDATION_TOLERANCES,
): DimensionValidationError[] {
  const errors: DimensionValidationError[] = [];
  const { dimensionDirection, projectionDirection } = directions;
  if (
    dimensionDirection
    && projectionDirection
    && nearlyParallel(projectionDirection, dimensionDirection, tolerances.parallelDimensionDeg)
  ) {
    errors.push({ code: 'PROJECTION_DIRECTION_PARALLEL_DIMENSION', slot: 'projectionDirection' });
  }
  const view = viewDirection && isFiniteVec3(viewDirection) && length(viewDirection) > tolerances.minDirectionLengthM
    ? viewDirection
    : null;
  if (!view) return errors;
  if (dimensionDirection && nearlyParallel(dimensionDirection, view, tolerances.parallelViewDeg)) {
    errors.push({ code: 'DIMENSION_DIRECTION_PARALLEL_VIEW', slot: 'dimensionDirection' });
  }
  if (projectionDirection && nearlyParallel(projectionDirection, view, tolerances.parallelViewDeg)) {
    errors.push({ code: 'PROJECTION_DIRECTION_PARALLEL_VIEW', slot: 'projectionDirection' });
  }
  return errors;
}

export function validateDimensionRecord(
  record: UserDimensionRecord,
  context: DimensionValidationContext = {},
): DimensionValidationResult {
  const tolerances = context.tolerances ?? DIMENSION_VALIDATION_TOLERANCES;
  const errors: DimensionValidationError[] = [];

  switch (record.kind) {
    case 'angular':
      checkPoints({ vertex: record.vertex, rayA: record.rayA, rayB: record.rayB }, errors);
      break;
    case 'radial': {
      checkPoints({ center: record.center, rim: record.rim }, errors);
      checkAxisSource(record.normal, 'normal', errors);
      const normal = projectionAxisVector(record.normal);
      if (!isFiniteVec3(normal) || length(normal) <= tolerances.minDirectionLengthM) {
        errors.push({ code: 'DEGENERATE_PROJECTION_DIRECTION', slot: 'normal' });
      }
      break;
    }
    case 'chain': {
      if (record.anchors.length < 2) {
        errors.push({ code: 'CHAIN_TOO_SHORT', slot: 'anchors' });
        break;
      }
      const anchors: Record<string, DimensionAnchor> = {};
      record.anchors.forEach((anchor, index) => {
        anchors[`chain:${index}`] = anchor;
      });
      checkPoints(anchors, errors);
      const resolved = record.anchors.map(anchor => anchor.snapshot).filter(isFiniteVec3);
      if (resolved.length < 2) break;
      const origin = resolved[0]!;
      const last = resolved[resolved.length - 1]!;
      const span = sub(last, origin);
      const direction = finiteOr(record.directions?.dimensionDirection, span);
      if (!direction || length(direction) <= tolerances.minDirectionLengthM) {
        errors.push({ code: 'DEGENERATE_DIMENSION_DIRECTION', slot: 'dimensionDirection' });
        break;
      }
      const unit = unitVec3(direction)!;
      for (let index = 0; index < resolved.length - 1; index += 1) {
        const segment = Math.abs(dot(sub(resolved[index + 1]!, resolved[index]!), unit));
        if (segment <= tolerances.minDirectionLengthM) {
          errors.push({ code: 'DEGENERATE_DIMENSION_DIRECTION', slot: `chain:${index + 1}` });
        }
      }
      errors.push(...checkDirectionsAgainstView(
        {
          dimensionDirection: direction,
          projectionDirection: record.directions?.projectionDirection ?? null,
        },
        context.viewDirection,
        tolerances,
      ));
      break;
    }
    case 'linear':
    case 'projected': {
      checkPoints({ a: record.a, b: record.b }, errors);
      const a = record.a.snapshot;
      const b = record.b.snapshot;
      const span = isFiniteVec3(a) && isFiniteVec3(b) ? sub(b, a) : null;
      let dimensionDirection: Vec3 | null;
      let measured: number | null;
      let projectionDirection: Vec3 | null = null;
      if (record.kind === 'linear') {
        dimensionDirection = finiteOr(record.directions?.dimensionDirection, span);
        measured = span ? length(span) : null;
      } else {
        checkAxisSource(record.axis, 'axis', errors);
        const axis = projectionAxisVector(record.axis);
        if (!isFiniteVec3(axis) || length(axis) <= tolerances.minDirectionLengthM) {
          errors.push({ code: 'DEGENERATE_PROJECTION_DIRECTION', slot: 'axis' });
          break;
        }
        dimensionDirection = finiteOr(record.directions?.dimensionDirection, axis);
        const unitAxis = unitVec3(axis)!;
        measured = span ? Math.abs(dot(span, unitAxis)) : null;
        projectionDirection = record.directions?.projectionDirection ?? null;
        if (projectionDirection && length(projectionDirection) <= tolerances.minDirectionLengthM) {
          errors.push({ code: 'DEGENERATE_PROJECTION_DIRECTION', slot: 'projectionDirection' });
          projectionDirection = null;
        }
      }
      const directionLength = dimensionDirection ? length(dimensionDirection) : 0;
      if (
        (measured !== null && measured <= tolerances.minDirectionLengthM)
        || (dimensionDirection && directionLength <= tolerances.minDirectionLengthM)
      ) {
        errors.push({ code: 'DEGENERATE_DIMENSION_DIRECTION', slot: 'dimensionDirection' });
        break;
      }
      if (!dimensionDirection) break;
      errors.push(...checkDirectionsAgainstView(
        { dimensionDirection, projectionDirection },
        context.viewDirection,
        tolerances,
      ));
      break;
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
