
import type {
  PipeClearanceResponse,
  PointToSurfaceResponse,
  SpatialClearanceModelVersion,
  SpatialNearestClearanceResponse,
  SpatialPosition,
  SurfaceClearanceResponse,
} from '@/api/genModelV1Api';
import type { ComputationWarning } from '@/measurement/domain/computationProvenance';
import type { ComputationPoint } from '@/measurement/domain/measurementResult';

/**
 * gen-model 净距接口的运行时契约（#65）：四个端点（`nearest-clearance` / `surface-clearance` /
 * `point-to-surface` / `pipe-clearance`）的响应在这里统一过一遍——单位、方法、精度口径、坐标有限性。
 * 服务端换了口径（比如把近似标成精确）宁可拒收，也不让错的精度标签流进记录与尺寸。
 *
 * mm → m 也只在这里换：调用方拿到的 `ComputationPoint` 已是 design-world 米。
 */

export const MM_PER_M = 1000;

export function mmToM(mm: number): number {
  return mm / MM_PER_M;
}

export function pointMmToM(point: SpatialPosition): ComputationPoint {
  return Object.freeze([mmToM(point.x), mmToM(point.y), mmToM(point.z)]) as ComputationPoint;
}

export function vectorMmToM(vector: Readonly<{ dx: number; dy: number; dz: number }>): ComputationPoint {
  return Object.freeze([mmToM(vector.dx), mmToM(vector.dy), mmToM(vector.dz)]) as ComputationPoint;
}

/** 单位向量不换算（无量纲）。 */
export function unitVector(point: SpatialPosition): ComputationPoint {
  return Object.freeze([point.x, point.y, point.z]) as ComputationPoint;
}

export class ClearanceContractError extends Error {
  readonly endpoint: string;
  readonly field: string;

  constructor(endpoint: string, field: string, message: string) {
    super(`${endpoint} 响应不符合契约（${field}）：${message}`);
    this.name = 'ClearanceContractError';
    this.endpoint = endpoint;
    this.field = field;
  }
}

/**
 * `strict`（缺省）：违约即抛；`lenient`：违约降级为一条 `contract_violation` 警告继续走老路径——
 * 只给联调期服务端还没升级时临时用（`VITE_CLEARANCE_CONTRACT_MODE=lenient`）。
 */
export type ClearanceContractMode = 'strict' | 'lenient';

export function resolveClearanceContractMode(raw: unknown): ClearanceContractMode {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'lenient' ? 'lenient' : 'strict';
}

let modeOverride: ClearanceContractMode | null = null;

export function clearanceContractMode(): ClearanceContractMode {
  if (modeOverride) return modeOverride;
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  return resolveClearanceContractMode(env?.VITE_CLEARANCE_CONTRACT_MODE);
}

/** 测试用：`null` 恢复按环境变量。 */
export function setClearanceContractModeForTesting(mode: ClearanceContractMode | null): void {
  modeOverride = mode;
}

/** 跑一次契约校验；`lenient` 下违约变成警告返回，其余错误照抛。 */
export function enforceClearanceContract(
  check: () => void,
  mode: ClearanceContractMode = clearanceContractMode(),
): ComputationWarning[] {
  try {
    check();
    return [];
  } catch (error) {
    if (mode === 'lenient' && error instanceof ClearanceContractError) {
      return [Object.freeze({ code: 'contract_violation', message: error.message })];
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(value: unknown): value is SpatialPosition {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

type Checker = Readonly<{
  fail(field: string, message: string): never;
  literal(field: string, value: unknown, allowed: readonly string[]): void;
  distance(field: string, value: unknown): void;
  point(field: string, value: unknown): void;
  errorBound(value: unknown): void;
  warnings(value: unknown): void;
}>;

function checker(endpoint: string): Checker {
  const fail = (field: string, message: string): never => {
    throw new ClearanceContractError(endpoint, field, message);
  };
  return Object.freeze({
    fail,
    literal(field, value, allowed) {
      if (typeof value !== 'string' || !allowed.includes(value)) {
        fail(field, `只接受 ${allowed.join(' / ')}，收到 ${String(value)}`);
      }
    },
    distance(field, value) {
      if (!isFiniteNumber(value) || value < 0) fail(field, `必须是有限非负数，收到 ${String(value)}`);
    },
    point(field, value) {
      if (!isFinitePoint(value)) fail(field, '必须是有限坐标 {x,y,z}');
    },
    errorBound(value) {
      if (!isFiniteNumber(value) || value < 0 || value > 10) {
        fail('error_bound_mm', `必须在 [0, 10] mm 内，收到 ${String(value)}`);
      }
    },
    warnings(value) {
      if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
        fail('warnings', '必须是字符串数组');
      }
    },
  });
}

function checkEnvelope(check: Checker, response: unknown): asserts response is Record<string, unknown> {
  if (!isRecord(response)) check.fail('$', '不是对象');
  if (response.success !== true) check.fail('success', '不是 true');
  check.literal('unit', response.unit, ['mm']);
  check.warnings(response.warnings);
}

function checkModelVersion(check: Checker, field: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (
    !isRecord(value)
    || !Number.isInteger(value.dbnum) || (value.dbnum as number) < 0
    || !Number.isInteger(value.sesno) || (value.sesno as number) < 0
  ) {
    check.fail(field, '必须是 {dbnum, sesno} 非负整数');
  }
}

const NEAREST_DISTANCE_METHODS = Object.freeze([
  'centerline_aabb_clearance_mm',
  'centerline_surface_aabb_clearance_mm',
  'aabb_clearance_mm',
]);

/**
 * `nearest-clearance`：目标侧只有包围盒，`accuracy_class` 只能是 `approximate-aabb`（旧服务端缺这一格按它读）。
 * 每条候选的距离 / 端点必须有限，相交时距离为 0。
 */
export function assertNearestClearanceResponse(response: unknown): asserts response is SpatialNearestClearanceResponse {
  const check: Checker = checker('nearest-clearance');
  checkEnvelope(check, response);
  check.literal('distance_method', response.distance_method, NEAREST_DISTANCE_METHODS);
  if (response.accuracy_class !== undefined) {
    check.literal('accuracy_class', response.accuracy_class, ['approximate-aabb']);
  }
  checkModelVersion(check, 'model_version', response.model_version);
  if (response.truncated_candidates !== undefined && typeof response.truncated_candidates !== 'boolean') {
    check.fail('truncated_candidates', '必须是布尔');
  }
  const groups = response.nearest_by_group;
  if (!Array.isArray(groups)) check.fail('nearest_by_group', '必须是数组');
  groups.forEach((group: unknown, groupIndex: number) => {
    if (!isRecord(group) || typeof group.group !== 'string' || !Array.isArray(group.candidates)) {
      check.fail(`nearest_by_group[${groupIndex}]`, '必须是 {group, candidates[]}');
    }
    group.candidates.forEach((candidate: unknown, index: number) => {
      const field = `nearest_by_group[${groupIndex}].candidates[${index}]`;
      if (!isRecord(candidate) || typeof candidate.refno !== 'string' || !candidate.refno) {
        check.fail(field, '缺 refno');
      }
      check.distance(`${field}.distance_mm`, candidate.distance_mm);
      if (typeof candidate.intersects !== 'boolean') check.fail(`${field}.intersects`, '必须是布尔');
      if (candidate.intersects && candidate.distance_mm !== 0) check.fail(`${field}.distance_mm`, '相交时必须为 0');
      const annotation = candidate.annotation;
      if (!isRecord(annotation)) check.fail(`${field}.annotation`, '缺尺寸端点');
      check.point(`${field}.annotation.start_point`, annotation.start_point);
      check.point(`${field}.annotation.end_point`, annotation.end_point);
    });
  });
}

export type SurfaceClearanceExpectation = Readonly<{
  /** 垂直距口径（楼板类）：见证点只认 `vertical-*` 一族 */
  vertical?: boolean;
  /** 抽屉精算要求必须有结果；`null`（超出 maxDistance）由调用方决定是否接受 */
  requireResult?: boolean;
}>;

const VERTICAL_WITNESSES = Object.freeze(['vertical-ray', 'vertical-ray-miss', 'vertical-aabb']);

/** `surface-clearance`：只认 `surface_to_surface` / `exact-surface`，结果点有限、相交时距离为 0。 */
export function assertSurfaceClearanceResponse(
  response: unknown,
  expectation: SurfaceClearanceExpectation = {},
): asserts response is SurfaceClearanceResponse {
  const check: Checker = checker('surface-clearance');
  checkEnvelope(check, response);
  check.literal('method', response.method, ['surface_to_surface']);
  check.literal('accuracy_class', response.accuracy_class, ['exact-surface']);
  check.errorBound(response.error_bound_mm);
  const result = response.result;
  if (result === null || result === undefined) {
    if (expectation.requireResult) check.fail('result', '没有结果');
    return;
  }
  if (!isRecord(result)) check.fail('result', '必须是对象或 null');
  check.distance('result.distance_mm', result.distance_mm);
  if (typeof result.intersects !== 'boolean') check.fail('result.intersects', '必须是布尔');
  check.point('result.source_point', result.source_point);
  check.point('result.target_point', result.target_point);
  if (expectation.vertical) {
    if (result.vertical !== true) check.fail('result.vertical', '垂直距口径要求 vertical=true');
    check.literal('result.witness', result.witness, VERTICAL_WITNESSES);
  } else if (result.witness === 'aabb-overlap-center') {
    if (result.intersects !== true || result.distance_mm !== 0) {
      check.fail('result.witness', 'aabb-overlap-center 只在相交（距离 0）时成立');
    }
  } else {
    check.literal('result.witness', result.witness, ['closest-points']);
  }
}

/** `point-to-surface`：只认 `point_to_surface` / `exact-surface`。 */
export function assertPointToSurfaceResponse(response: unknown): asserts response is PointToSurfaceResponse {
  const check: Checker = checker('point-to-surface');
  checkEnvelope(check, response);
  check.literal('method', response.method, ['point_to_surface']);
  check.literal('accuracy_class', response.accuracy_class, ['exact-surface']);
  check.errorBound(response.error_bound_mm);
  check.point('query_point', response.query_point);
  const result = response.result;
  if (result === null || result === undefined) return;
  if (!isRecord(result)) check.fail('result', '必须是对象或 null');
  check.distance('result.distance_mm', result.distance_mm);
  check.point('result.target_point', result.target_point);
  if (result.normal !== null && result.normal !== undefined) check.point('result.normal', result.normal);
  check.literal('result.feature', result.feature, ['face', 'edge']);
}

/**
 * `pipe-clearance`：`exact-analytic` 或 `approximate-capsule`；相交时必须 `distance_mm = 0` 且给出非负
 * `penetration_mm`，不相交时 `penetration_mm` 为 null——不接受无说明的负距离。
 */
export function assertPipeClearanceResponse(response: unknown): asserts response is PipeClearanceResponse {
  const check: Checker = checker('pipe-clearance');
  checkEnvelope(check, response);
  check.literal('method', response.method, ['pipe_to_pipe_analytic']);
  check.literal('accuracy_class', response.accuracy_class, ['exact-analytic', 'approximate-capsule']);
  check.errorBound(response.error_bound_mm);
  for (const side of ['source', 'target'] as const) {
    const endpoint = response[side];
    if (!isRecord(endpoint) || typeof endpoint.refno !== 'string') check.fail(side, '缺 refno');
    checkModelVersion(check, `${side}.model_version`, endpoint.model_version);
  }
  const result = response.result;
  if (result === null || result === undefined) return;
  if (!isRecord(result)) check.fail('result', '必须是对象或 null');
  check.distance('result.distance_mm', result.distance_mm);
  check.distance('result.axis_distance_mm', result.axis_distance_mm);
  if (typeof result.intersects !== 'boolean') check.fail('result.intersects', '必须是布尔');
  if (result.intersects) {
    if (result.distance_mm !== 0) check.fail('result.distance_mm', '相交时必须为 0');
    check.distance('result.penetration_mm', result.penetration_mm);
  } else if (result.penetration_mm !== null && result.penetration_mm !== undefined) {
    check.fail('result.penetration_mm', '不相交时必须为 null');
  }
  for (const field of ['source_point', 'target_point', 'source_axis_point', 'target_axis_point'] as const) {
    check.point(`result.${field}`, result[field]);
  }
  for (const side of ['source_segment', 'target_segment'] as const) {
    const segment = result[side];
    if (!isRecord(segment) || typeof segment.refno !== 'string') check.fail(`result.${side}`, '缺 refno');
    check.distance(`result.${side}.outside_diameter_mm`, segment.outside_diameter_mm);
    check.distance(`result.${side}.effective_radius_mm`, segment.effective_radius_mm);
  }
}

/**
 * 服务端 warning 是一行文本，约定形如 `code: 说明`（`approximate_aabb: …`、`beyond_max_distance: …`）；
 * 没有这个前缀的归到 `server`。
 */
export function parseServerWarning(text: string): ComputationWarning {
  const match = /^([a-z][a-z0-9_]*)\s*:\s*(.+)$/is.exec(text.trim());
  if (match) {
    return Object.freeze({ code: match[1]!.toLowerCase(), message: match[2]!.trim() });
  }
  return Object.freeze({ code: 'server', message: text.trim() || 'unknown warning' });
}

/** 降级类告警（结果可用但精度 / 完整性打了折扣）：界面要醒目提示，不能混在普通说明里。 */
const DEGRADED_WARNING_LABELS: Readonly<Record<string, string>> = Object.freeze({
  approximate_aabb: '近似值：目标侧按包围盒量距，不是外表面净距',
  truncated_candidates: '候选被截断：半径内目标过多，可能漏掉更近的目标，请缩小半径',
  model_version_unavailable: '模型版本未知：结果无法与模型换版对账',
  capsule_end_approximation: '管端近似：最近点在管端，按胶囊体下界计，真实净距更大',
  contract_violation: '契约降级：服务端响应不符合约定，按宽松模式继续',
});

export type ClearanceWarningSummary = Readonly<{
  degraded: readonly string[];
  other: readonly string[];
}>;

/** 把服务端 warnings 分成降级告警（给可读措辞）与其余原文。 */
export function summarizeClearanceWarnings(warnings: readonly string[]): ClearanceWarningSummary {
  const degraded: string[] = [];
  const other: string[] = [];
  for (const text of warnings) {
    const { code } = parseServerWarning(text);
    const label = DEGRADED_WARNING_LABELS[code];
    if (label) {
      if (!degraded.includes(label)) degraded.push(label);
    } else {
      other.push(text);
    }
  }
  return Object.freeze({ degraded: Object.freeze(degraded), other: Object.freeze(other) });
}

export function modelVersionKey(version: SpatialClearanceModelVersion | null | undefined): string | null {
  return version ? `${version.dbnum}:${version.sesno}` : null;
}
