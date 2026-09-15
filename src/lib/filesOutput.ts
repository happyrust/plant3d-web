/**
 * files/output 路径构造工具
 *
 * 约定：
 * - 未指定 output_project：使用 `/files/output/<rel>`（兼容旧目录结构）
 * - 指定 output_project：使用 `/files/output/<project>/<rel>`（多项目并存）
 */

import { buildBackendUrl } from '@/utils/apiBase';

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
      console.warn('[filesOutput] project path listener failed:', err);
    }
  }
}

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

export function buildFilesOutputUrl(relPath: string): string {
  const rel = String(relPath || '').replace(/^\/+/, '');
  const project = getOutputProjectFromUrl();
  const path = project
    ? `/files/output/${encodeURIComponent(project)}/${rel}`
    : `/files/output/${rel}`;
  return buildBackendUrl(path);
}

