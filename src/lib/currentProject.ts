/**
 * 当前模型工程（`output_project` URL 参数 / `useModelProjects.applyProject` 落下的那一个）的进程内状态。
 *
 * 原先住在 `lib/filesOutput.ts`，跟旧后端 `/files/output/<project>/…` 的 URL 构造放在一起；2026-09-20 legacy 退役后
 * 只剩这份「现在是哪个工程」的状态——批注草稿 scope、工具 store 的持久化键、尺寸文档的存储 scope 都按它分桶。
 */

let currentProjectPath: string | null = null;

type ProjectPathListener = (path: string | null) => void;
const projectPathListeners = new Set<ProjectPathListener>();

/**
 * 当前工程路径变了就通知（值没变不通知）。`useModelProjects.applyProject` 每次落工程都会来这里——
 * 包括首屏 `emitChangeEvent=false`、不派发 `modelProjectChanged` 的那一次，所以想跟着工程走的东西
 * （批注草稿 scope 的 projectId 等）订阅这里比只听事件可靠。返回取消订阅函数。
 */
export function onCurrentProjectPathChange(listener: ProjectPathListener): () => void {
  projectPathListeners.add(listener);
  return () => {
    projectPathListeners.delete(listener);
  };
}

export function setCurrentProjectPath(path: string | null) {
  const next = path && path.trim() ? path : null;
  if (next === currentProjectPath) return;
  currentProjectPath = next;
  for (const listener of projectPathListeners) {
    try {
      listener(next);
    } catch (err) {
      console.warn('[currentProject] project path listener failed:', err);
    }
  }
}

/** 当前工程：先看 `setCurrentProjectPath` 落下的，再看 URL `output_project`；都没有为 null。 */
export function getOutputProjectFromUrl(): string | null {
  if (currentProjectPath) return currentProjectPath;

  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = q.get('output_project');
    const s = raw ? String(raw).trim() : '';
    return s ? s : null;
  } catch {
    return null;
  }
}
