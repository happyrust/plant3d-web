/**
 * 批注体系重构阶段用 feature flag。
 *
 * 命名规范：`REVIEW_<PHASE>_<FEATURE>_<STAGE>`
 *   - PHASE：`A`/`B`/`C`/`D`/`E`/`F`/`G`/`H`
 *   - FEATURE：小写短语（`snapshot_layer` / `comment_thread_store` 等）
 *   - STAGE：`SHADOW` / `DUAL_READ` / `CUTOVER`
 *
 * 优先级（高 → 低）：
 *   1. `localStorage['review.force_legacy']='1'` → 强制全部关闭
 *   2. `localStorage['review.flag.<NAME>']`（`'1'|'true'|'0'|'false'`）
 *   3. `import.meta.env.VITE_<NAME>`（`'1'|'true'`）
 *   4. 代码内默认值（见 `FLAG_DEFAULTS`）
 */

export type ReviewFlagName =
  | 'REVIEW_B_SNAPSHOT_LAYER_SHADOW'
  | 'REVIEW_B_SNAPSHOT_LAYER_CUTOVER'
  | 'REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ'
  | 'REVIEW_C_COMMENT_THREAD_STORE_CUTOVER'
  | 'REVIEW_C_EVENT_LOG'
  | 'REVIEW_D_ANNOTATION_KEY_V2'
  | 'REVIEW_D_REVIEW_ROUND_FIELDS'
  | 'REVIEW_E_DRAFT_CONFIRMED_STORE'
  | 'REVIEW_E_DUAL_LAYER_VIEWER'
  | 'REVIEW_F_COMMENT_SYNC_V2'
  | 'REVIEW_G_TASK_SCOPED_DRAFT';

const FLAG_DEFAULTS: Record<ReviewFlagName, boolean> = {
  REVIEW_B_SNAPSHOT_LAYER_SHADOW: false,
  REVIEW_B_SNAPSHOT_LAYER_CUTOVER: false,
  REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ: false,
  REVIEW_C_COMMENT_THREAD_STORE_CUTOVER: false,
  REVIEW_C_EVENT_LOG: false,
  REVIEW_D_ANNOTATION_KEY_V2: false,
  REVIEW_D_REVIEW_ROUND_FIELDS: false,
  REVIEW_E_DRAFT_CONFIRMED_STORE: false,
  REVIEW_E_DUAL_LAYER_VIEWER: false,
  REVIEW_F_COMMENT_SYNC_V2: false,
  REVIEW_G_TASK_SCOPED_DRAFT: false,
};

const FORCE_LEGACY_KEY = 'review.force_legacy';
const FLAG_OVERRIDE_PREFIX = 'review.flag.';

function safeReadLocal(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseBoolLike(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  const v = value.toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

function readEnvFlag(name: ReviewFlagName): boolean | null {
  const key = `VITE_${name}`;
  try {
    const metaEnv = (import.meta as ImportMeta).env as
      | Record<string, string | undefined>
      | undefined;
    if (metaEnv && metaEnv[key] !== undefined) {
      return parseBoolLike(metaEnv[key]);
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
      return parseBoolLike(process.env[key]);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function isReviewFlagEnabled(name: ReviewFlagName): boolean {
  if (safeReadLocal(FORCE_LEGACY_KEY) === '1') return false;

  const override = parseBoolLike(safeReadLocal(`${FLAG_OVERRIDE_PREFIX}${name}`));
  if (override !== null) return override;

  const env = readEnvFlag(name);
  if (env !== null) return env;

  return FLAG_DEFAULTS[name];
}

/**
 * 用于测试 / 运维排障：清理所有 localStorage 级覆盖。
 * 不影响环境变量与默认值。
 */
export function clearReviewFlagOverrides(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(FORCE_LEGACY_KEY);
    for (const name of Object.keys(FLAG_DEFAULTS) as ReviewFlagName[]) {
      localStorage.removeItem(`${FLAG_OVERRIDE_PREFIX}${name}`);
    }
  } catch {
    /* ignore */
  }
}

export const REVIEW_FLAG_NAMES: readonly ReviewFlagName[] = Object.freeze(
  Object.keys(FLAG_DEFAULTS) as ReviewFlagName[],
);
