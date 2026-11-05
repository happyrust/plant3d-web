/**
 * 极坐标放置层（T3.4a + T3.4b）barrel。
 *
 * 本目录放 `getBestPosAndOri` 依赖的辅助函数（`angles` / `dirAndCha` / `result`）、
 * 放置层类型契约（T3.4a），以及主流程本体 `polarPlace` / `balance` / `getDisEles`
 * （T3.4b，`polarsystem.pmlobj:1028-1296` 与其依赖的忠实移植）。
 * `kernel/index.ts` 暂不导出本目录，留给调用方按需直接从 `polar/place` 取用。
 */

export {
  angleInAnyRange,
  directionAngle,
  getAngleRange,
  getNormalDirs,
  getUsedAngles,
  isVerticalAxis,
  NORMAL_ANGLE_TOLERANCE_DEG,
  normalAngleRange,
  normalizeAngle,
  NOT_BEST_PLUS_ANGLE_DEG,
  polarArcFrame,
  VERTICAL_ANGLE_TOLERANCE_DEG,
} from './angles';
export { balance } from './balance';
export { DEFAULT_ANGLE_EPSILON_DEG, DEFAULT_MIN_GAP_DIVISOR, getDirAndCha, SHOWDIR_SAME_SIDE_FACTOR } from './dirAndCha';
export { getDisEles } from './disEles';
export { angleDeg, bisect, offset, opposite, sameDirection } from './geometry';
export { polarPlace } from './place';
export { angleOfDirection, getResult, getZDir } from './result';

export type { BalanceResult } from './balance';
export type { DirAndCha, DirAndChaOptions } from './dirAndCha';
export type { PolarPlacement } from './result';
export type {
  PolarCandidate,
  PolarNeeds,
  PolarPerDisBest,
  PolarPlaceDiagnostics,
  PolarPlaceOverrides,
  PolarPlaceParams,
  PolarPlaceResult,
  PolarTextOrientation,
} from './types';
