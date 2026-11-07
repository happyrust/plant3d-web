/**
 * 交互时临时降画质的判定（E3D 外观管线 + 小构件裁剪）：不再「相机一动就降」，而是按实测帧耗时（p90）
 * 分三档逐级关效果；交互结束宽限 `graceMs` 后回到全画质，恢复那一帧由宿主补画
 * （按需出帧不会自己再画）。
 *
 * 档位：
 *
 * | 档 | normalDepth | AO | HLR | declutter | 小构件裁剪 |
 * |----|-------------|----|-----|-----------|-----------|
 * | 0  | ✓ | ✓ | ✓ | ✓ | 不裁 |
 * | 1  | ✓ | ✓ | ✗ | ✗ | 启用 |
 * | 2  | ✗ | ✗ | ✗ | ✗ | 启用 |
 *
 * 档 1 必须保留 normalDepth：`SglFramePasses.normalDepth` 是 AO / HLR / 去杂的共同前置，
 * HLR 读 `_ndRT`，关掉就等于 HLR 也画不出来。所以「先降 HLR」这一档只能保留 normalDepth。
 *
 * 同一次交互（从开始动到回 L0）里只升档、不降档：p90 超过阈值就升一档（每帧最多一档），
 * 耗时回落也不升回来，画质统一在松手宽限后恢复。升档本来就会让耗时变低，
 * 若按升档后的耗时决定回退，会在两档之间周期性来回跳（HLR 边线一闪一闪）。
 *
 * 起步档：上一次交互结束后 `warmMs` 内再动，直接从上一次的档位开始，
 * 免得重场景每次拖动开头都先卡几帧；超过 `warmMs` 从 `floorLevel` 重新试。
 *
 * 只按着不动（点选）不降级；降级之后按着不放则保持降级，避免拖拖停停时离屏图反复重建。
 */

import {
  FRAME_BUDGET_MIN_SAMPLES,
  createFrameBudgetState,
  frameBudgetP90,
  resetFrameBudget,
  stepFrameBudget,
  type FrameBudgetState,
} from './frameBudget';

/** 停手后保持当前档位的时间；到点回全画质并补画一帧 */
export const DRAG_DOWNGRADE_GRACE_MS = 200;

/** 预算帧耗时（ms）：60fps */
export const DEFAULT_FRAME_BUDGET_MS = 16.7;

/** 升档倍数：p90 > 预算 × 它 就降一档 */
export const DEFAULT_DOWNGRADE_RATIO = 1.3;

/** 上一次交互结束后这么久内再动，沿用上一次的档位（ms） */
export const DEFAULT_WARM_START_MS = 3000;

/** 0 = 全画质，1 = 关 HLR/去杂，2 = 只画颜色 */
export type SglDowngradeLevel = 0 | 1 | 2;

export interface DragDowngradeOptions {
  /** 停手后保持当前档位的时间 */
  graceMs: number;
  /** 预算帧耗时（ms） */
  budgetMs: number;
  /** 升档倍数 */
  upRatio: number;
  /** 起步档沿用时长（ms）；0 = 每次都从 floorLevel 起步 */
  warmMs: number;
}

export const DEFAULT_DRAG_DOWNGRADE_OPTIONS: DragDowngradeOptions = {
  graceMs: DRAG_DOWNGRADE_GRACE_MS,
  budgetMs: DEFAULT_FRAME_BUDGET_MS,
  upRatio: DEFAULT_DOWNGRADE_RATIO,
  warmMs: DEFAULT_WARM_START_MS,
};

export interface DragDowngradeState {
  level: SglDowngradeLevel;
  /** 最近一次「相机在动 / 降级中按着」的时间戳（ms）；没有过为 -Infinity */
  lastActiveAt: number;
  /** 交互帧耗时窗口（非交互时清空） */
  budget: FrameBudgetState;
  /** 是否在一次交互里（从开始动到回 L0） */
  inGesture: boolean;
  /** 本次交互里由实测引起的升档次数；下一次交互开始才清零，松手后也能查看 */
  flips: number;
  /** 上一次交互结束时的档位（只升不降，所以就是那次到过的最高档） */
  warmLevel: SglDowngradeLevel;
  /** `warmLevel` 的有效期（时间戳 ms）；-Infinity = 没有 */
  warmUntil: number;
}

export interface DragDowngradeInput {
  /** 开关（`dtx_drag_downgrade=0` 关闭） */
  enabled: boolean;
  /** 档位有没有用处：走 SGL 管线，或小构件裁剪开着；都没有就整体停摆 */
  pipelineActive: boolean;
  /** 鼠标 / gizmo 是否按着（OrbitControls、gizmo 的 start..end） */
  held: boolean;
  /** 这一帧相机是否变了（含阻尼惯性、flyTo、滚轮） */
  cameraMoving: boolean;
  /** 上一帧的耗时样本（ms）；没有（早退、链条断开）传 null，不记样本也不清窗口 */
  frameMs: number | null;
  /** 交互中的最低档：非 E3D 样式传 1（相机一动就裁小构件）；缺省 0 */
  floorLevel?: SglDowngradeLevel;
  /** 显示器刷新周期（ms）；有效预算取 max(budgetMs, refreshMs)。缺省 / null 不参与 */
  refreshMs?: number | null;
  now: number;
}

export interface DragDowngradeStep {
  state: DragDowngradeState;
  /** 本步生效的档位（= state.level），宿主要喂给管线 */
  level: SglDowngradeLevel;
  /** 本步档位变了（宿主需要重新下发） */
  changed: boolean;
  /** 本步从降级回到全画质：宿主要补画一帧 */
  restored: boolean;
  /** 还在降级、但已经不活跃：宿主要在这个时刻再走一步（之前按需出帧可能已经停了） */
  restoreAt: number | null;
  /** 本步用于判断的 p90（ms）；没有样本为 null，便于调试打点 */
  p90: number | null;
}

export function createDragDowngradeState(): DragDowngradeState {
  return {
    level: 0,
    lastActiveAt: -Infinity,
    budget: createFrameBudgetState(),
    inGesture: false,
    flips: 0,
    warmLevel: 0,
    warmUntil: -Infinity,
  };
}

/** 有效预算（ms）：页面被限帧（如 30Hz）时，一个刷新周期已经是最快的出帧，不算掉帧 */
export function effectiveBudgetMs(budgetMs: number, refreshMs?: number | null): number {
  if (refreshMs === null || refreshMs === undefined || !Number.isFinite(refreshMs) || refreshMs <= 0) {
    return budgetMs;
  }
  return Math.max(budgetMs, refreshMs);
}

function maxLevel(a: SglDowngradeLevel, b: SglDowngradeLevel): SglDowngradeLevel {
  return a > b ? a : b;
}

/** 交互结束：回 L0、清窗口，记下起步档 */
function endGesture(prev: DragDowngradeState, now: number, opts: DragDowngradeOptions): DragDowngradeState {
  return {
    level: 0,
    lastActiveAt: prev.lastActiveAt,
    budget: prev.budget.count === 0 ? prev.budget : resetFrameBudget(prev.budget),
    inGesture: false,
    flips: prev.flips,
    warmLevel: prev.level,
    warmUntil: opts.warmMs > 0 ? now + opts.warmMs : -Infinity,
  };
}

export function stepDragDowngrade(
  prev: DragDowngradeState,
  input: DragDowngradeInput,
  options: Partial<DragDowngradeOptions> = {},
): DragDowngradeStep {
  const opts: DragDowngradeOptions = { ...DEFAULT_DRAG_DOWNGRADE_OPTIONS, ...options };

  // 开关关闭 / 档位没用处：立刻回全画质，窗口和起步档都清空
  if (!input.enabled || !input.pipelineActive) {
    return {
      state: createDragDowngradeState(),
      level: 0,
      changed: prev.level !== 0,
      restored: prev.level !== 0,
      restoreAt: null,
      p90: null,
    };
  }

  const active = input.cameraMoving || (input.held && prev.level > 0);

  if (!active) {
    if (!prev.inGesture) {
      return { state: prev, level: prev.level, changed: false, restored: false, restoreAt: null, p90: null };
    }
    // L0 停手就结束这次交互；降级中要等宽限期满再回全画质
    const restoreAt = prev.level === 0 ? input.now : prev.lastActiveAt + opts.graceMs;
    if (input.now >= restoreAt) {
      return {
        state: endGesture(prev, input.now, opts),
        level: 0,
        changed: prev.level !== 0,
        restored: prev.level !== 0,
        restoreAt: null,
        p90: null,
      };
    }
    return { state: prev, level: prev.level, changed: false, restored: false, restoreAt, p90: null };
  }

  const floor = input.floorLevel ?? 0;
  let level: SglDowngradeLevel;
  let budget: FrameBudgetState;
  let flips: number;
  let sampleUsable: boolean;
  if (prev.inGesture) {
    level = maxLevel(prev.level, floor);
    budget = prev.budget;
    flips = prev.flips;
    sampleUsable = true;
  } else {
    const warm = input.now <= prev.warmUntil ? prev.warmLevel : 0;
    level = maxLevel(floor, warm);
    budget = prev.budget.count === 0 ? prev.budget : resetFrameBudget(prev.budget);
    flips = 0;
    // 这一帧拿到的样本是交互前那张静止帧（按 L0 画的），起步档不是 L0 时不能算进窗口
    sampleUsable = level === 0;
  }

  let p90 = frameBudgetP90(budget);
  let count = budget.count;
  if (input.frameMs !== null && sampleUsable) {
    const sampled = stepFrameBudget(budget, { frameMs: input.frameMs, interacting: true });
    budget = sampled.state;
    p90 = sampled.p90;
    count = sampled.samples;
  }

  // 样本不够就不作判断；够了且超标就升一档（每帧最多一档），升完清窗口重新攒样本
  const measured = count >= FRAME_BUDGET_MIN_SAMPLES ? p90 : null;
  const upMs = effectiveBudgetMs(opts.budgetMs, input.refreshMs) * opts.upRatio;
  if (measured !== null && measured > upMs && level < 2) {
    level = (level + 1) as SglDowngradeLevel;
    budget = resetFrameBudget(budget);
    p90 = null;
    flips += 1;
  }

  return {
    state: {
      level,
      lastActiveAt: input.now,
      budget,
      inGesture: true,
      flips,
      warmLevel: prev.warmLevel,
      warmUntil: prev.warmUntil,
    },
    level,
    changed: level !== prev.level,
    // 交互中不会回全画质，恢复只发生在上面的宽限分支
    restored: false,
    restoreAt: null,
    p90,
  };
}

/** URL `?dtx_drag_downgrade=0` 或 localStorage `dtx_drag_downgrade=0` 关闭；URL 优先，默认开 */
export function isDragDowngradeEnabled(query: URLSearchParams, stored: string | null): boolean {
  const raw = query.get('dtx_drag_downgrade') ?? stored;
  return raw === null || raw.trim() !== '0';
}

/** 帧耗时样本的口径：`interval` = CPU 耗时与出帧间隔取大（默认），`cpu` = 只用 CPU 耗时 */
export type FrameMetric = 'interval' | 'cpu';

/** URL `?dtx_frame_metric=cpu` 或同名 localStorage 项退回只用 CPU 耗时；URL 优先 */
export function readFrameMetric(
  query: URLSearchParams,
  stored: (key: string) => string | null,
): FrameMetric {
  const raw = query.get('dtx_frame_metric') ?? stored('dtx_frame_metric');
  return raw !== null && raw.trim().toLowerCase() === 'cpu' ? 'cpu' : 'interval';
}

function readNumber(raw: string | null, fallback: number, accept: (n: number) => boolean): number {
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && accept(n) ? n : fallback;
}

/**
 * 读帧预算参数：`dtx_frame_budget_ms`（默认 16.7）、`dtx_downgrade_ratio`（默认 1.3）、
 * `dtx_downgrade_warm_ms`（默认 3000，0 关闭起步档）。URL 优先，其次 localStorage，非法值退回默认。
 */
export function readDragDowngradeOptions(
  query: URLSearchParams,
  stored: (key: string) => string | null,
): DragDowngradeOptions {
  const pick = (key: string) => query.get(key) ?? stored(key);
  return {
    ...DEFAULT_DRAG_DOWNGRADE_OPTIONS,
    budgetMs: readNumber(pick('dtx_frame_budget_ms'), DEFAULT_FRAME_BUDGET_MS, n => n > 0),
    upRatio: readNumber(pick('dtx_downgrade_ratio'), DEFAULT_DOWNGRADE_RATIO, n => n > 0),
    warmMs: readNumber(pick('dtx_downgrade_warm_ms'), DEFAULT_WARM_START_MS, n => n >= 0),
  };
}
