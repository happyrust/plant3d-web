/**
 * 三维批注交互改进方案（docs/plans/2026-09-14-3d-annotation-interaction-redesign-proposal.md §7）的阶段开关 `annotationUx.*`。
 * 每个阶段独立可回退：关掉 = 回到上一阶段行为；与云线渲染开关（`useCloudRenderFlags`）是两套，互不影响。
 *
 * - `scopedDraftsV1`（U0）：本机草稿容器按「项目 + canonical taskId / draftSessionId + reviewRound + 用户」隔离
 *   （`useToolStore.setAnnotationDraftScope` → 存储 key 换成 `annotationScopeKey`），旧 `project=…|db=…` 容器只读、
 *   在校审面板显示为「未归属草稿」、不默认导入。关掉后：存储 key 回到旧的 `project=…|db=…`（G5「草稿串任务」现状），
 *   已写进 scope key 的草稿保留不动，下次开回来还在。
 *
 * 默认全部开启。覆盖方式（优先级从高到低）：
 * 1. URL `?annotation_ux=scopedDraftsV1:0`
 * 2. localStorage `plant3d.annotationUxFlags` = `{"scopedDraftsV1":false}`
 * 3. 默认值
 */

export type AnnotationUxFlag = 'scopedDraftsV1';

export const ANNOTATION_UX_FLAG_STORAGE_KEY = 'plant3d.annotationUxFlags';
export const ANNOTATION_UX_FLAG_URL_PARAM = 'annotation_ux';

const DEFAULTS: Readonly<Record<AnnotationUxFlag, boolean>> = Object.freeze({
  scopedDraftsV1: true,
});

const FLAG_NAMES = Object.keys(DEFAULTS) as AnnotationUxFlag[];

let overrides: Partial<Record<AnnotationUxFlag, boolean>> | null = null;

function isFlagName(name: string): name is AnnotationUxFlag {
  return (FLAG_NAMES as string[]).includes(name);
}

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return null;
}

function readOverrides(): Partial<Record<AnnotationUxFlag, boolean>> {
  const out: Partial<Record<AnnotationUxFlag, boolean>> = {};
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(ANNOTATION_UX_FLAG_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      if (parsed && typeof parsed === 'object') {
        for (const [name, value] of Object.entries(parsed)) {
          if (isFlagName(name) && typeof value === 'boolean') out[name] = value;
        }
      }
    } catch {
      // 坏 JSON 当没设
    }
  }
  if (typeof window !== 'undefined' && typeof window.location?.search === 'string') {
    const raw = new URLSearchParams(window.location.search).get(ANNOTATION_UX_FLAG_URL_PARAM);
    if (raw) {
      for (const item of raw.split(',')) {
        const [name, value] = item.split(':');
        if (!name || !isFlagName(name.trim())) continue;
        const parsed = value === undefined ? true : parseBool(value);
        if (parsed !== null) out[name.trim() as AnnotationUxFlag] = parsed;
      }
    }
  }
  return out;
}

export function isAnnotationUxFlagEnabled(flag: AnnotationUxFlag): boolean {
  if (!overrides) overrides = readOverrides();
  return overrides[flag] ?? DEFAULTS[flag];
}

/** 运行时切换并持久化到 localStorage（URL 覆盖仍然优先）。 */
export function setAnnotationUxFlag(flag: AnnotationUxFlag, enabled: boolean): void {
  if (typeof localStorage !== 'undefined') {
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(localStorage.getItem(ANNOTATION_UX_FLAG_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    } catch {
      current = {};
    }
    current[flag] = enabled;
    localStorage.setItem(ANNOTATION_UX_FLAG_STORAGE_KEY, JSON.stringify(current));
  }
  overrides = null;
}

/** 丢掉已读缓存，下次访问重读 localStorage / URL（测试与调试用）。 */
export function resetAnnotationUxFlagCache(): void {
  overrides = null;
}
